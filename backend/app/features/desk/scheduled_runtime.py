"""Single-owner background scheduler with durable claims and fail-closed execution."""

import hashlib
import json
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from threading import Event, Thread
from typing import Any

from .credentials import ProfileStore
from .report_settings import report_settings
from .scheduled_lock import SchedulerLock
from .scheduled_progress import ReportProgress
from .scheduled_recovery import RecoveryRequired, canonical_response, continuation_safe
from .scheduled_report import validate_response
from .scheduled_schemas import ScheduledTask
from .scheduled_store import ScheduledStore
from .schemas import InvokeRequest, ReportDelivery
from .transport import AgentTransport


class ScheduledRuntime:
    def __init__(self, profiles: ProfileStore, identity: Callable[[], Any],
                 executor: Callable[..., dict[str, Any]] | None = None,
                 clock: Callable[[], datetime] | None = None) -> None:
        self.profiles, self.identity = profiles, identity
        self._store: ScheduledStore | None = None
        self.lifecycle_lock = SchedulerLock(profiles.root / "scheduled.lock")
        self.executor = executor or self.execute
        self.clock = clock or (lambda: datetime.now(UTC))
        self.stop_event = Event()
        self.thread: Thread | None = None
        self.worker: Thread | None = None
        self.transport: AgentTransport | None = None

    @property
    def store(self) -> ScheduledStore:
        if self._store is None:
            self._store = ScheduledStore(self.profiles.root / "scheduled.sqlite3")
        return self._store

    def supported(self, profile: str) -> bool:
        if profile == "demo":
            return self.identity() is None
        testing = profile.startswith("test:")
        saved_id = profile[5:] if testing else profile
        saved = next((item for item in self.profiles.list() if item.id == saved_id), None)
        if saved is None:
            return False
        settings = report_settings(self.profiles, saved_id)
        if not (settings.test if testing else settings.prod):
            return False
        if testing:
            return bool(saved.instance_id and saved.workspace_id)
        return saved.surface == "PROD"

    def target_id(self, profile_id: str, surface: str) -> str:
        stored_test = any(profile.id == profile_id and profile.surface == "TEST" for profile in self.profiles.list())
        return "test:" + profile_id if surface == "TEST" or stored_test else profile_id

    def candidates(self) -> list[str]:
        result = ["demo"]
        for profile in self.profiles.list():
            if profile.surface != "TEST":
                result.append(profile.id)
            if profile.surface == "TEST" or profile.instance_id and profile.workspace_id:
                result.append("test:" + profile.id)
        return result

    def permitted(self, owner: str, profile: str) -> bool:
        if not self.supported(profile):
            return False
        identity = self.identity()
        if identity is None:
            return owner == "local"
        user = next((user for user in identity.store.users() if user["id"] == owner and user["enabled"]), None)
        return (user is not None and (not profile.startswith("test:") or user["role"] == "admin")
                and identity.store.permitted(user, profile.removeprefix("test:")))

    def start(self) -> None:
        if any(thread is not None and thread.is_alive() for thread in (self.thread, self.worker)):
            return
        self.profiles.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lifecycle_lock.acquire()
        try:
            self.store.recover()
            self.stop_event.clear()
            self.thread = Thread(target=self.loop, name="desk-scheduled-tasks", daemon=True)
            self.worker = Thread(target=self.worker_loop, name="desk-report-worker", daemon=True)
            self.thread.start()
            self.worker.start()
        except BaseException:
            self.lifecycle_lock.release()
            raise

    def stop(self) -> None:
        self.stop_event.set()
        if self.transport is not None:
            self.transport.close()
        for thread in (self.thread, self.worker):
            if thread is not None:
                thread.join(timeout=5)
        if not any(thread is not None and thread.is_alive() for thread in (self.thread, self.worker)):
            self.lifecycle_lock.release()

    def loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                self.store.schedule_due(self.clock())
            except (OSError, ValueError, sqlite3.Error):
                pass
            self.stop_event.wait(2)

    def worker_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                self.execute_next()
            except (OSError, ValueError, sqlite3.Error):
                # A failed persistence step keeps the claim for explicit startup recovery.
                pass
            self.stop_event.wait(0.2)

    def tick(self) -> None:
        self.store.schedule_due(self.clock())
        self.execute_next()

    def execute_next(self) -> None:
        job = self.store.claim()
        if job is None:
            return
        response = None
        error = None
        try:
            task = ScheduledTask.model_validate_json(job["definition"])
            if not self.permitted(job["owner"], task.agentId):
                raise ValueError("El propietario ya no tiene permiso o el agente no admite informes.")
            template = json.loads(job["template"]) if job["template"] else None
            response = self.executor(task, job, template)
            self.provenance(response, task, job)
            validate_response(response, task.id, job["id"], template)
        except RecoveryRequired as pending:
            self.store.interrupt(job, pending.control, str(pending))
            return
        except Exception:
            response = None
            error = "No se pudo generar un informe válido. Revisa conexión, permisos y capacidades del agente."
        self.store.finish(job, response, error, interrupted=self.stop_event.is_set())

    def execute(self, task: ScheduledTask, job: dict[str, Any], template: dict[str, Any] | None) -> dict[str, Any]:
        if task.agentId == "demo":
            return demo_response(task, job["id"], template)
        if not self.supported(task.agentId):
            raise ValueError("El destino no tiene habilitada la capacidad de informes.")
        testing = task.agentId.startswith("test:")
        saved_id = task.agentId[5:] if testing else task.agentId
        session = hashlib.sha256(f'{job["owner"]}\0{task.id}\0{job["version"]}'.encode()).hexdigest()
        value = InvokeRequest(request_id=job["id"], session_id=session, profile_id=saved_id,
                              surface="TEST" if testing else "PROD",
                              action="replay" if job.get("recovery_mode") == "replay" else "research",
                              question=task.instructions, delivery=ReportDelivery.model_validate({
                                  "mode": "report", "task_id": task.id, "task_run_id": job["id"],
                                  **({"template": template} if template else {})}))
        progress = ReportProgress(job["id"], lambda activity: self.store.progress(job, activity))
        for continuations in range(3):
            transport = AgentTransport(self.profiles, value)
            transport.deadline_seconds = 1800
            self.transport = transport
            try:
                response = canonical_response(transport.packets(), job["id"], projection=progress)
            finally:
                transport.close()
                self.transport = None
            if response.get("status") in ("complete", "completed", "partial"):
                return response
            if self.stop_event.is_set():
                raise RecoveryRequired(response)
            if continuations < 2 and continuation_safe(response, job["id"]):
                value = value.model_copy(update={"action": "research", "after_sequence": 0})
                continue
            if response.get("status") == "pending" or response.get("resumable") is True:
                raise RecoveryRequired(response)
            return response
        raise RecoveryRequired()

    def provenance(self, response: dict[str, Any], task: ScheduledTask, job: dict[str, Any]) -> None:
        report = response.get("report")
        if not isinstance(report, dict) or not isinstance(report.get("source_request_id"), str):
            return
        source = report["source_request_id"]
        if source == job["id"] or self.store.known_source(job["owner"], task.id, task.agentId, source):
            return
        identity = self.identity()
        if identity is not None:
            with identity.store.connect() as db:
                prior = db.execute("SELECT client_request FROM requests WHERE user_id=? AND profile_id=? "
                                   "AND native_request=?", (job["owner"], task.agentId, source)).fetchone()
            if prior is not None:
                report["source_request_id"] = prior[0]
                return
        limitations = report.get("limitations")
        if not isinstance(limitations, list) or len(limitations) >= 40:
            raise ValueError("No se puede registrar la limitación de procedencia.")
        report.pop("source_request_id")
        limitations.append("No se pudo verificar la solicitud de origen para este usuario y agente; "
                           "se omitió su identificador de procedencia.")


def demo_response(task: ScheduledTask, run_id: str, template: dict[str, Any] | None) -> dict[str, Any]:
    layout = template or {"template_id": "demo-report", "version": 1, "sections": [
        {"section_id": "summary", "title": "Resumen", "visibility": "always"}]}
    markdown = "Demostración local determinista. No se consultaron fuentes ni se realizó una investigación real."
    return {"status": "completed", "markdown": markdown, "references": [], "artifacts": [], "report": {
        "schema_version": "1.0", "report_id": "report-" + run_id, "task_id": task.id, "task_run_id": run_id,
        "title": task.name, "template": layout, "sections": [
            {"section_id": item["section_id"], "markdown": markdown, "evidence_ids": []}
            for item in layout["sections"] if item["visibility"] == "always"],
        "limitations": ["Contenido de demostración; no contiene datos reales."]}}
