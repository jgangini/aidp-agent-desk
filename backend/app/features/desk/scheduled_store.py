"""Private durable task definitions and execution ledger for one Desk instance."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

from .scheduled_schedule import next_occurrence, utc_text
from .scheduled_schemas import (
    ReportPresentation,
    ScheduledRun,
    ScheduledTask,
    ScheduledTaskView,
    TemplateChange,
)


def now_text() -> str:
    return utc_text(datetime.now(UTC))


class ScheduledStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.connect() as db:
            if db.execute("PRAGMA user_version").fetchone()[0] not in (0, 1, 2, 3):
                raise RuntimeError("Unsupported scheduled task database version")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS tasks (
                    owner TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
                    definition TEXT NOT NULL, next_at TEXT, PRIMARY KEY(owner,id)
                );
                CREATE TABLE IF NOT EXISTS versions (
                    owner TEXT NOT NULL, task_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
                    definition TEXT NOT NULL, template TEXT,
                    PRIMARY KEY(owner,task_id,version),
                    FOREIGN KEY(owner,task_id) REFERENCES tasks(owner,id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS runs (
                    owner TEXT NOT NULL, task_id TEXT NOT NULL, version INTEGER NOT NULL,
                    id TEXT NOT NULL, occurrence TEXT NOT NULL,
                    trigger TEXT NOT NULL CHECK(trigger IN ('initial','manual','scheduled')),
                    status TEXT NOT NULL CHECK(status IN ('queued','running','completed','partial','failed','interrupted')),
                    created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, error TEXT, response TEXT,
                    PRIMARY KEY(owner,task_id,id), UNIQUE(owner,task_id,version,occurrence),
                    FOREIGN KEY(owner,task_id,version) REFERENCES versions(owner,task_id,version) ON DELETE CASCADE
                );
                CREATE UNIQUE INDEX IF NOT EXISTS running_task ON runs(owner,task_id) WHERE status='running';
                CREATE INDEX IF NOT EXISTS queued_runs ON runs(status,created_at);
                CREATE INDEX IF NOT EXISTS task_history ON runs(owner,task_id,created_at);
                CREATE TABLE IF NOT EXISTS presentations (
                    owner TEXT NOT NULL, task_id TEXT NOT NULL, version INTEGER NOT NULL,
                    layout TEXT NOT NULL,
                    PRIMARY KEY(owner,task_id,version),
                    FOREIGN KEY(owner,task_id,version) REFERENCES versions(owner,task_id,version) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS hidden_reports (
                    owner TEXT NOT NULL, task_id TEXT NOT NULL, run_id TEXT NOT NULL, deleted_at TEXT NOT NULL,
                    PRIMARY KEY(owner,task_id,run_id),
                    FOREIGN KEY(owner,task_id,run_id) REFERENCES runs(owner,task_id,id) ON DELETE CASCADE
                );
            """)
            columns = {row["name"] for row in db.execute("PRAGMA table_info(runs)")}
            if "recovery_mode" not in columns:
                db.execute("ALTER TABLE runs ADD COLUMN recovery_mode TEXT NOT NULL DEFAULT 'research' "
                           "CHECK(recovery_mode IN ('research','replay'))")
            db.execute("PRAGMA user_version=3")
        self.path.chmod(0o600)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def recover(self) -> None:
        with self.connect() as db:
            running = db.execute("SELECT r.*,v.definition FROM runs r JOIN versions v ON "
                                 "(r.owner,r.task_id,r.version)=(v.owner,v.task_id,v.version) "
                                 "WHERE r.status='running'").fetchall()
            db.execute("UPDATE runs SET status='interrupted',finished_at=?,error=? WHERE status='running'",
                       (now_text(), "La ejecución se interrumpió; no se reintentó automáticamente."))
            for job in running:
                self.pause_once(db, dict(job))

    def recover_run(self, owner: str, task_id: str, run_id: str) -> ScheduledRun:
        with self.connect() as db:
            row = db.execute("SELECT status,started_at FROM runs WHERE owner=? AND task_id=? AND id=?",
                             (owner, task_id, run_id)).fetchone()
            if row is None:
                raise KeyError(run_id)
            if row["status"] not in ("queued", "running"):
                if row["status"] != "interrupted" or row["started_at"] is None:
                    raise ValueError("Esta ejecución no admite recuperación de su solicitud original.")
                db.execute("UPDATE runs SET status='queued',finished_at=NULL,error=NULL,recovery_mode='replay' "
                           "WHERE owner=? AND task_id=? AND id=?", (owner, task_id, run_id))
        return self.run(owner, task_id, run_id)

    def interrupt(self, job: dict[str, Any], control: dict[str, Any], error: str) -> None:
        with self.connect() as db:
            row = db.execute("SELECT response FROM runs WHERE owner=? AND task_id=? AND id=?",
                             (job["owner"], job["task_id"], job["id"])).fetchone()
            if row and row["response"] and (activity := json.loads(row["response"]).get("activity")):
                control = {**control, "activity": activity}
            updated = db.execute("UPDATE runs SET status='interrupted',finished_at=?,error=?,response=? "
                       "WHERE owner=? AND task_id=? AND id=? AND status='running'",
                       (now_text(), error, json.dumps(control, ensure_ascii=False),
                        job["owner"], job["task_id"], job["id"]))
            if updated.rowcount:
                self.pause_once(db, job)

    def progress(self, job: dict[str, Any], activity: list[dict[str, Any]]) -> None:
        control = {"status": "pending", "resumable": True, "activity": activity}
        with self.connect() as db:
            db.execute("UPDATE runs SET response=? WHERE owner=? AND task_id=? AND id=? AND status='running'",
                       (json.dumps(control, ensure_ascii=False), job["owner"], job["task_id"], job["id"]))

    @staticmethod
    def retained_activity(db: sqlite3.Connection, job: dict[str, Any]) -> dict[str, Any] | None:
        prior = db.execute("SELECT response FROM runs WHERE owner=? AND task_id=? AND id=?",
                           (job["owner"], job["task_id"], job["id"])).fetchone()
        if prior and prior["response"] and (activity := json.loads(prior["response"]).get("activity")):
            return {"activity": activity}
        return None

    @staticmethod
    def view(row: sqlite3.Row) -> ScheduledTaskView:
        return ScheduledTaskView(**json.loads(row["definition"]), version=row["version"], nextRunAt=row["next_at"])

    def tasks(self, owner: str) -> list[ScheduledTaskView]:
        with self.connect() as db:
            return [self.view(row) for row in db.execute("SELECT * FROM tasks WHERE owner=? ORDER BY id", (owner,))]

    def get(self, owner: str, task_id: str) -> ScheduledTaskView:
        with self.connect() as db:
            row = db.execute("SELECT * FROM tasks WHERE owner=? AND id=?", (owner, task_id)).fetchone()
            if row is None:
                raise KeyError(task_id)
            return self.view(row)

    def save(self, owner: str, task: ScheduledTask, now: datetime | None = None) -> ScheduledTaskView:
        instant = now or datetime.now(UTC)
        with self.connect() as db:
            old = db.execute("SELECT * FROM tasks WHERE owner=? AND id=?", (owner, task.id)).fetchone()
            version = old["version"] if old else 1
            previous = json.loads(old["definition"]) if old else None
            changed = previous is not None and any(previous[key] != getattr(task, key)
                                                   for key in ("instructions", "agentId"))
            if changed:
                version += 1
            if previous:
                task = task.model_copy(update={"createdAt": previous["createdAt"]})
            due = next_occurrence(task, instant)
            data = task.model_dump_json()
            db.execute("INSERT INTO tasks VALUES(?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET "
                       "version=excluded.version,definition=excluded.definition,next_at=excluded.next_at",
                       (owner, task.id, version, data, due))
            db.execute("INSERT OR IGNORE INTO versions VALUES(?,?,?,?,NULL)", (owner, task.id, version, data))
            if changed and previous is not None and old is not None and previous["agentId"] == task.agentId:
                db.execute("INSERT INTO presentations SELECT owner,task_id,?,layout FROM presentations "
                           "WHERE owner=? AND task_id=? AND version=?",
                           (version, owner, task.id, old["version"]))
            if old is None or changed:
                # Superseded queued work never invokes an old question after editing it.
                db.execute("UPDATE runs SET status='interrupted',finished_at=?,error=? WHERE owner=? AND task_id=? "
                           "AND status='queued'", (now_text(), "La definición cambió antes de ejecutar.", owner, task.id))
                self.enqueue(db, owner, task.id, version, "initial", "initial")
        return self.get(owner, task.id)

    @staticmethod
    def enqueue(db: sqlite3.Connection, owner: str, task_id: str, version: int,
                occurrence: str, trigger: str) -> str:
        run_id = uuid4().hex
        db.execute("INSERT OR IGNORE INTO runs(owner,task_id,version,id,occurrence,trigger,status,created_at) "
                   "VALUES(?,?,?,?,?,?,'queued',?)", (owner, task_id, version, run_id, occurrence, trigger, now_text()))
        row = db.execute("SELECT id FROM runs WHERE owner=? AND task_id=? AND version=? AND occurrence=?",
                         (owner, task_id, version, occurrence)).fetchone()
        return str(row[0])

    def manual(self, owner: str, task_id: str, key: str) -> ScheduledRun:
        with self.connect() as db:
            task = db.execute("SELECT version FROM tasks WHERE owner=? AND id=?", (owner, task_id)).fetchone()
            if task is None:
                raise KeyError(task_id)
            run_id = self.enqueue(db, owner, task_id, task[0], "manual:" + key, "manual")
            if db.execute("SELECT 1 FROM hidden_reports WHERE owner=? AND task_id=? AND run_id=?",
                          (owner, task_id, run_id)).fetchone():
                raise ValueError("El informe de esta ejecución está eliminado; restáuralo para consultarlo.")
        return self.run(owner, task_id, run_id)

    def change_template(self, owner: str, task_id: str, template: dict[str, Any],
                        expected_version: int, presentation: dict[str, Any] | None = None) -> ScheduledTaskView:
        value = TemplateChange.model_validate({"template": template, "expectedVersion": expected_version,
                                               "presentation": presentation})
        presentation = value.presentation.model_dump() if value.presentation is not None else None
        with self.connect() as db:
            row = db.execute("SELECT t.*,v.template FROM tasks t JOIN versions v ON "
                             "(t.owner,t.id,t.version)=(v.owner,v.task_id,v.version) "
                             "WHERE t.owner=? AND t.id=?", (owner, task_id)).fetchone()
            if row is None:
                raise KeyError(task_id)
            if row["version"] != expected_version:
                raise ValueError("La tarea cambió; recarga antes de ajustar el informe.")
            if row["template"] is None:
                raise ValueError("Primero debe completarse un informe con plantilla válida.")
            previous = json.loads(row["template"])
            if (template["template_id"] != previous["template_id"] or
                {section["section_id"] for section in template["sections"]} !=
                {section["section_id"] for section in previous["sections"]} or
                not any(section["visibility"] == "always" for section in template["sections"])):
                raise ValueError("Un ajuste visual debe conservar las secciones y al menos una siempre visible.")
            version = row["version"] + 1
            updated = {**template, "version": version}
            db.execute("INSERT INTO versions VALUES(?,?,?,?,?)",
                       (owner, task_id, version, row["definition"], json.dumps(updated, sort_keys=True)))
            if presentation is not None:
                db.execute("INSERT INTO presentations VALUES(?,?,?,?)",
                           (owner, task_id, version, json.dumps(presentation, sort_keys=True)))
            else:
                db.execute("INSERT INTO presentations SELECT owner,task_id,?,layout FROM presentations "
                           "WHERE owner=? AND task_id=? AND version=?", (version, owner, task_id, expected_version))
            db.execute("UPDATE tasks SET version=? WHERE owner=? AND id=?", (version, owner, task_id))
            db.execute("UPDATE runs SET status='interrupted',finished_at=?,error=? WHERE owner=? AND task_id=? "
                       "AND status='queued'", (now_text(), "La plantilla cambió antes de ejecutar.", owner, task_id))
        return self.get(owner, task_id)

    def template(self, owner: str, task_id: str, version: int | None = None) -> tuple[int, dict[str, Any] | None]:
        with self.connect() as db:
            row = db.execute("SELECT v.version,v.template FROM versions v JOIN tasks t ON "
                             "(v.owner,v.task_id)=(t.owner,t.id) WHERE t.owner=? AND t.id=? "
                             "AND v.version=COALESCE(?,t.version)", (owner, task_id, version)).fetchone()
            if row is None:
                raise KeyError(task_id)
            return row["version"], json.loads(row["template"]) if row["template"] else None

    def presentation(self, owner: str, task_id: str, version: int) -> dict[str, Any] | None:
        with self.connect() as db:
            row = db.execute("SELECT p.layout,v.template FROM versions v LEFT JOIN presentations p ON "
                             "(p.owner,p.task_id,p.version)=(v.owner,v.task_id,v.version) "
                             "WHERE v.owner=? AND v.task_id=? AND v.version=?", (owner, task_id, version)).fetchone()
            if row is None:
                raise KeyError(task_id)
            if row["layout"] is None or row["template"] is None:
                return None
            value = self.compatible_presentation(row["layout"], json.loads(row["template"]))
            return value.model_dump() if value is not None else None

    @staticmethod
    def compatible_presentation(layout: str, template: dict[str, Any]) -> ReportPresentation | None:
        value = ReportPresentation.model_validate_json(layout)
        ids = {identity for row in value.rows for identity in row.section_ids}
        return value if ids == {section["section_id"] for section in template["sections"]} else None

    def schedule_due(self, now: datetime) -> None:
        with self.connect() as db:
            for row in db.execute("SELECT * FROM tasks WHERE next_at IS NOT NULL AND next_at<=?", (utc_text(now),)):
                task = ScheduledTask.model_validate_json(row["definition"])
                scheduled = False
                if task.status == "active":
                    busy = db.execute("SELECT 1 FROM runs WHERE owner=? AND task_id=? "
                                      "AND status IN ('queued','running')", (row["owner"], task.id)).fetchone()
                    if task.repeat == "once" and busy:
                        continue
                    # Scheduler tick grace is one minute; downtime never starts a stale period.
                    overdue = (now - datetime.fromisoformat(row["next_at"].replace("Z", "+00:00"))).total_seconds()
                    if not busy and overdue <= 60:
                        self.enqueue(db, row["owner"], task.id, row["version"], row["next_at"], "scheduled")
                        scheduled = True
                due = next_occurrence(task, now)
                if due is None and task.status == "active" and not (task.repeat == "once" and scheduled):
                    task = task.model_copy(update={"status": "paused" if task.repeat == "once" else "completed"})
                db.execute("UPDATE tasks SET next_at=?,definition=? WHERE owner=? AND id=?",
                           (due, task.model_dump_json(), row["owner"], task.id))

    def claim(self) -> dict[str, Any] | None:
        with self.connect() as db:
            row = db.execute("SELECT r.*,v.definition,v.template FROM runs r JOIN versions v "
                             "ON (r.owner,r.task_id,r.version)=(v.owner,v.task_id,v.version) "
                             "JOIN tasks t ON (t.owner,t.id)=(r.owner,r.task_id) "
                             "WHERE r.status='queued' AND (r.trigger='manual' OR r.recovery_mode='replay' OR "
                             "json_extract(t.definition,'$.status')!='paused') AND NOT EXISTS(SELECT 1 FROM runs busy WHERE "
                             "busy.owner=r.owner AND busy.task_id=r.task_id AND busy.status='running') "
                             "ORDER BY r.created_at,r.id LIMIT 1").fetchone()
            if row is None:
                return None
            db.execute("UPDATE runs SET status='running',started_at=COALESCE(started_at,?) WHERE owner=? AND task_id=? AND id=?",
                       (now_text(), row["owner"], row["task_id"], row["id"]))
            return dict(row)

    def finish(self, job: dict[str, Any], response: dict[str, Any] | None, error: str | None,
               interrupted: bool = False) -> None:
        with self.connect() as db:
            status = ("completed" if response["status"] == "complete" else response["status"]) if response else "failed"
            if interrupted:
                response, status, error = None, "interrupted", "La ejecución se interrumpió al detener el servidor."
            if response:
                template = json.dumps(response["report"]["template"], sort_keys=True)
                row = db.execute("SELECT template FROM versions WHERE owner=? AND task_id=? AND version=?",
                                 (job["owner"], job["task_id"], job["version"])).fetchone()
                if row is None:
                    return
                if row[0] is not None and row[0] != template:
                    response, status, error = None, "failed", "El agente cambió la plantilla de esta versión."
                else:
                    db.execute("UPDATE versions SET template=? WHERE owner=? AND task_id=? AND version=?",
                               (template, job["owner"], job["task_id"], job["version"]))
                    layout = db.execute("SELECT layout FROM presentations WHERE owner=? AND task_id=? AND version=?",
                                        (job["owner"], job["task_id"], job["version"])).fetchone()
                    if layout and self.compatible_presentation(layout[0], response["report"]["template"]) is None:
                        db.execute("DELETE FROM presentations WHERE owner=? AND task_id=? AND version=?",
                                   (job["owner"], job["task_id"], job["version"]))
            if response is None:
                response = self.retained_activity(db, job)
            updated = db.execute("UPDATE runs SET status=?,finished_at=?,error=?,response=? "
                       "WHERE owner=? AND task_id=? AND id=? AND status='running'",
                       (status, now_text(), error, json.dumps(response, ensure_ascii=False) if response else None,
                        job["owner"], job["task_id"], job["id"]))
            if updated.rowcount:
                self.pause_once(db, job)

    @staticmethod
    def pause_once(db: sqlite3.Connection, job: dict[str, Any]) -> None:
        current = db.execute("SELECT definition,version,next_at FROM tasks WHERE owner=? AND id=?",
                             (job["owner"], job["task_id"])).fetchone()
        if current is None or current["version"] != job["version"]:
            return
        task = ScheduledTask.model_validate_json(current["definition"])
        original = ScheduledTask.model_validate_json(job["definition"])
        if task.repeat != "once" or original.repeat != "once":
            return
        calendar = ("startDate", "time", "timeZone", "days", "monthDay", "interval", "unit", "endDate")
        if current["next_at"] is not None and any(getattr(task, key) != getattr(original, key) for key in calendar):
            return
        db.execute("UPDATE tasks SET definition=?,next_at=NULL WHERE owner=? AND id=?",
                   (task.model_copy(update={"status": "paused"}).model_dump_json(), job["owner"], job["task_id"]))

    @staticmethod
    def run_view(row: sqlite3.Row, detail: bool) -> ScheduledRun:
        response = json.loads(row["response"]) if detail and row["response"] else None
        activity = (response or {}).get("activity", []) if row["status"] in ("queued", "running", "interrupted", "failed") else []
        return ScheduledRun(id=row["id"], taskId=row["task_id"], taskVersion=row["version"],
                            status=row["status"], trigger=row["trigger"], createdAt=row["created_at"],
                            startedAt=row["started_at"], finishedAt=row["finished_at"], error=row["error"],
                            response=response, activity=activity,
                            recoverable=row["status"] == "interrupted" and row["started_at"] is not None,
                            presentation=ScheduledStore.compatible_presentation(
                                row["presentation"], json.loads(row["presentation_template"]))
                            if row["presentation"] and row["presentation_template"] else None)

    def runs(self, owner: str, task_id: str) -> list[ScheduledRun]:
        self.get(owner, task_id)
        with self.connect() as db:
            return [self.run_view(row, False) for row in db.execute(
                "SELECT r.*,p.layout AS presentation,v.template AS presentation_template FROM runs r JOIN versions v ON "
                "(v.owner,v.task_id,v.version)=(r.owner,r.task_id,r.version) LEFT JOIN presentations p ON "
                "(p.owner,p.task_id,p.version)=(r.owner,r.task_id,r.version) WHERE r.owner=? AND r.task_id=? "
                "AND NOT EXISTS(SELECT 1 FROM hidden_reports h WHERE "
                "(h.owner,h.task_id,h.run_id)=(r.owner,r.task_id,r.id)) "
                "ORDER BY r.created_at DESC,r.id DESC LIMIT 200",
                (owner, task_id))]

    def definitions(self, owner: str, task_id: str) -> dict[int, ScheduledTask]:
        with self.connect() as db:
            return {row["version"]: ScheduledTask.model_validate_json(row["definition"]) for row in db.execute(
                "SELECT version,definition FROM versions WHERE owner=? AND task_id=?", (owner, task_id))}

    def known_source(self, owner: str, task_id: str, profile: str, request_id: str) -> bool:
        with self.connect() as db:
            return db.execute("SELECT 1 FROM runs r JOIN versions v ON "
                              "(r.owner,r.task_id,r.version)=(v.owner,v.task_id,v.version) "
                              "WHERE r.owner=? AND r.task_id=? AND r.id=? AND r.response IS NOT NULL "
                              "AND r.status IN ('completed','partial') AND json_extract(v.definition,'$.agentId')=?",
                              (owner, task_id, request_id, profile)).fetchone() is not None

    def run(self, owner: str, task_id: str, run_id: str) -> ScheduledRun:
        with self.connect() as db:
            row = db.execute("SELECT r.*,p.layout AS presentation,v.template AS presentation_template FROM runs r "
                             "JOIN versions v ON (v.owner,v.task_id,v.version)=(r.owner,r.task_id,r.version) "
                             "LEFT JOIN presentations p ON (p.owner,p.task_id,p.version)=(r.owner,r.task_id,r.version) "
                             "WHERE r.owner=? AND r.task_id=? AND r.id=? AND NOT EXISTS(SELECT 1 FROM hidden_reports h "
                             "WHERE (h.owner,h.task_id,h.run_id)=(r.owner,r.task_id,r.id))",
                             (owner, task_id, run_id)).fetchone()
            if row is None:
                raise KeyError(run_id)
            return self.run_view(row, True)

    def run_version(self, owner: str, task_id: str, run_id: str) -> int:
        """Authorize a hidden report by ledger metadata without exposing its contents."""
        with self.connect() as db:
            row = db.execute("SELECT version FROM runs WHERE owner=? AND task_id=? AND id=?",
                             (owner, task_id, run_id)).fetchone()
            if row is None:
                raise KeyError(run_id)
            return int(row[0])

    def set_report_hidden(self, owner: str, task_id: str, run_id: str, hidden: bool) -> None:
        with self.connect() as db:
            row = db.execute("SELECT status,response FROM runs WHERE owner=? AND task_id=? AND id=?",
                             (owner, task_id, run_id)).fetchone()
            if row is None:
                raise KeyError(run_id)
            if row["status"] not in {"completed", "partial"} or row["response"] is None:
                raise ValueError("Sólo se pueden eliminar o restaurar informes terminados.")
            if hidden:
                db.execute("INSERT OR IGNORE INTO hidden_reports VALUES(?,?,?,?)",
                           (owner, task_id, run_id, now_text()))
            else:
                db.execute("DELETE FROM hidden_reports WHERE owner=? AND task_id=? AND run_id=?",
                           (owner, task_id, run_id))

    def delete(self, owner: str, task_id: str) -> None:
        with self.connect() as db:
            busy = db.execute("SELECT 1 FROM runs WHERE owner=? AND task_id=? AND status='running'",
                              (owner, task_id)).fetchone()
            if busy:
                raise ValueError("Espera a que termine la ejecución antes de eliminar la tarea.")
            if not db.execute("DELETE FROM tasks WHERE owner=? AND id=?", (owner, task_id)).rowcount:
                raise KeyError(task_id)
