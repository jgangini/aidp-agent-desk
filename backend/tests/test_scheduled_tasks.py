import json
from datetime import UTC, datetime
from threading import Event
from time import monotonic
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.features.desk.credentials import ProfileStore
from app.features.desk.scheduled_api import scheduled_router
from app.features.desk.scheduled_lock import SchedulerLock
from app.features.desk.scheduled_report import Report, ReportPeriod, validate_response
from app.features.desk.scheduled_runtime import ScheduledRuntime, demo_response
from app.features.desk.scheduled_schedule import next_occurrence
from app.features.desk.scheduled_schemas import ScheduledTask
from app.features.desk.scheduled_store import ScheduledStore
from app.features.desk.schemas import AgentProfile, InvokeRequest, ReportDelivery
from app.features.desk.transport import invocation_payload


def task(**changes):
    return ScheduledTask(**{
        "id": "task-1", "name": "Informe", "instructions": "Consulta de prueba", "agentId": "demo",
        "agentName": "Demo", "repeat": "daily", "startDate": "2030-01-01", "time": "10:00",
        "timeZone": "America/Lima", "createdAt": "2026-11-11T00:00:00Z", **changes,
    })


@pytest.mark.parametrize("outcome", ["completed", "partial", "failed", "interrupt", "restart"])
@pytest.mark.parametrize("tick_before_finish", [False, True])
def test_once_initial_consumes_future_occurrence_and_pauses_after_settlement(tmp_path, outcome, tick_before_finish):
    store = ScheduledStore(tmp_path / "scheduled.db")
    value = task(repeat="once", timeZone="UTC")
    store.save("local", value, datetime(2030, 1, 1, 9, tzinfo=UTC))
    job = store.claim()
    if tick_before_finish:
        store.schedule_due(datetime(2030, 1, 1, 10, tzinfo=UTC))
    assert store.get("local", value.id).status == "active"
    assert len(store.runs("local", value.id)) == 1
    if outcome == "restart":
        store.recover()
    elif outcome == "interrupt":
        store.interrupt(job, {"status": "pending"}, "Pendiente de recuperación")
    else:
        response = demo_response(value, job["id"], None) if outcome != "failed" else None
        if response:
            response["status"] = outcome
        store.finish(job, response, "Error" if response is None else None)
    saved = store.get("local", value.id)
    assert saved.status == "paused" and saved.nextRunAt is None
    store.schedule_due(datetime(2030, 1, 2, 10, tzinfo=UTC))
    assert store.claim() is None
    assert len(store.runs("local", value.id)) == 1
    if outcome in ("restart", "interrupt"):
        store.recover_run("local", value.id, job["id"])
        replay = store.claim()
        assert replay["id"] == job["id"] and replay["recovery_mode"] == "replay"
        store.finish(replay, demo_response(value, job["id"], None), None)
        assert store.get("local", value.id).status == "paused"


@pytest.mark.parametrize(("repeat", "changes"), [
    ("once", {"instructions": "Nueva versión"}),
    ("once", {"repeat": "daily"}),
    ("once", {"startDate": "2030-01-03"}),
    ("daily", {"repeat": "once"}),
    ("daily", {}),
])
def test_finished_once_does_not_override_newer_or_edited_schedule(tmp_path, repeat, changes):
    store = ScheduledStore(tmp_path / "scheduled.db")
    now = datetime(2030, 1, 1, 9, tzinfo=UTC)
    value = task(repeat=repeat, timeZone="UTC")
    store.save("local", value, now)
    job = store.claim()
    edited = value.model_copy(update=changes)
    expected = store.save("local", edited, now)
    store.finish(job, demo_response(value, job["id"], None), None)
    assert store.get("local", value.id).model_dump() == expected.model_dump()


def test_resumed_once_stays_active_until_its_single_scheduled_run_finishes(tmp_path):
    store = ScheduledStore(tmp_path / "scheduled.db")
    value = task(repeat="once", timeZone="UTC")
    store.save("local", value, datetime(2030, 1, 1, 9, tzinfo=UTC))
    initial = store.claim()
    store.finish(initial, demo_response(value, initial["id"], None), None)
    store.save("local", value, datetime(2030, 1, 1, 9, 30, tzinfo=UTC))
    store.schedule_due(datetime(2030, 1, 1, 10, tzinfo=UTC))
    assert store.get("local", value.id).status == "active"
    scheduled = store.claim()
    assert scheduled["trigger"] == "scheduled"
    store.finish(scheduled, demo_response(value, scheduled["id"], None), None)
    assert store.get("local", value.id).status == "paused"
    assert store.get("local", value.id).nextRunAt is None
    assert len(store.runs("local", value.id)) == 2


def test_store_isolation_idempotency_version_and_recovery(tmp_path):
    store = ScheduledStore(tmp_path / "scheduled.db")
    first = task()
    assert store.save("alice", first).version == 1
    store.save("alice", first)
    assert len(store.runs("alice", first.id)) == 1
    assert store.tasks("bob") == []
    with pytest.raises(KeyError):
        store.run("bob", first.id, store.runs("alice", first.id)[0].id)
    store.save("alice", task(name="Renamed"))
    assert len(store.runs("alice", first.id)) == 1
    assert store.save("alice", task(instructions="Otra consulta")).version == 2
    assert len(store.runs("alice", first.id)) == 2
    superseded = next(run for run in store.runs("alice", first.id) if run.taskVersion == 1)
    assert superseded.status == "interrupted"
    assert "definición cambió" in superseded.error
    manual = store.manual("alice", first.id, "retry-1")
    assert store.manual("alice", first.id, "retry-1").id == manual.id
    job = store.claim()
    assert job is not None
    assert store.claim() is None  # no overlap even with another queued manual run
    store.recover()
    assert store.run("alice", first.id, job["id"]).status == "interrupted"
    assert store.claim() is not None  # explicitly queued manual operation remains independent
    with store.connect() as db:
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        with pytest.raises(Exception):
            db.execute("INSERT INTO versions VALUES('bob','task-1',1,'{}',NULL)")


def test_scheduler_pause_skips_and_templates_are_frozen(tmp_path):
    profiles = ProfileStore(tmp_path)
    runtime = ScheduledRuntime(profiles, lambda: None)
    runtime.store.save("local", task(status="paused"))
    runtime.tick()
    assert runtime.store.runs("local", "task-1")[0].status == "queued"
    runtime.store.save("local", task())
    runtime.tick()
    first = runtime.store.runs("local", "task-1")[0]
    assert first.status == "completed"
    response = runtime.store.run("local", "task-1", first.id).response
    assert response["report"]["template"]["template_id"] == "demo-report"
    second = runtime.store.manual("local", "task-1", "second")

    def changed_template(value, job, template):
        response = demo_response(value, job["id"], template)
        response["report"]["template"]["version"] += 1
        return response

    runtime.executor = changed_template
    runtime.tick()
    assert runtime.store.run("local", "task-1", second.id).status == "failed"


@pytest.mark.parametrize("spoof", ["task_id", "task_run_id"])
def test_runtime_rejects_report_identity_and_revoked_permission(tmp_path, spoof):
    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None)
    runtime.store.save("local", task())

    def wrong(value, job, template):
        response = demo_response(value, job["id"], template)
        response["report"][spoof] = "another-owner"
        return response

    runtime.executor = wrong
    runtime.tick()
    run = runtime.store.runs("local", "task-1")[0]
    assert run.status == "failed"
    assert runtime.store.run("local", "task-1", run.id).response is None
    called = []
    runtime.store.manual("local", "task-1", "revoked")
    runtime.permitted = lambda *_: False
    runtime.executor = lambda *_: called.append(True)
    runtime.tick()
    assert not called
    assert runtime.store.runs("local", "task-1")[0].status == "failed"


@pytest.mark.parametrize(("changes", "after", "expected"), [
    ({"repeat": "once", "timeZone": "UTC"}, "2029-12-31T00:00:00+00:00", "2030-01-01T10:00:00Z"),
    ({"repeat": "once"}, "2031-01-01T00:00:00+00:00", None),
    ({"repeat": "hourly", "timeZone": "UTC"}, "2030-01-01T11:30:00+00:00", "2030-01-01T12:00:00Z"),
    ({"repeat": "weekly", "days": [2], "timeZone": "UTC"}, "2030-01-02T00:00:00+00:00", "2030-01-08T10:00:00Z"),
    ({"repeat": "weekly", "days": [3], "timeZone": "UTC"}, "2030-01-01T00:00:00+00:00", "2030-01-02T10:00:00Z"),
    ({"repeat": "weekdays", "days": [0], "timeZone": "UTC"}, "2030-01-01T00:00:00+00:00", "2030-01-06T10:00:00Z"),
    ({"repeat": "monthly", "monthDay": 31, "timeZone": "UTC"}, "2030-02-01T00:00:00+00:00", "2030-03-31T10:00:00Z"),
    ({"repeat": "custom", "unit": "months", "interval": 2, "timeZone": "UTC"}, "2030-01-02T00:00:00+00:00", "2030-03-01T10:00:00Z"),
    ({"repeat": "custom", "unit": "months", "interval": 365, "timeZone": "UTC"}, "2030-01-02T00:00:00+00:00", "2060-06-01T10:00:00Z"),
    ({"repeat": "custom", "unit": "minutes", "interval": 30, "timeZone": "UTC"}, "2030-01-01T10:01:00+00:00", "2030-01-01T10:30:00Z"),
    ({"repeat": "daily", "startDate": "2030-03-01", "time": "02:30", "timeZone": "America/New_York"}, "2030-03-10T06:00:00+00:00", "2030-03-11T06:30:00Z"),
    ({"repeat": "daily", "startDate": "2030-10-01", "time": "01:30", "timeZone": "America/New_York"}, "2030-11-03T05:45:00+00:00", "2030-11-04T06:30:00Z"),
])
def test_calendar_rules_and_dst(changes, after, expected):
    assert next_occurrence(task(**changes), datetime.fromisoformat(after)) == expected


def test_due_is_unique_and_missed_slots_do_not_replay(tmp_path):
    store = ScheduledStore(tmp_path / "scheduled.db")
    store.save("local", task(repeat="hourly", timeZone="UTC"), datetime(2030, 1, 1, 9, tzinfo=UTC))
    store.claim()  # initial is busy: scheduled overlap must be skipped
    store.schedule_due(datetime(2030, 1, 1, 13, 5, tzinfo=UTC))
    assert len(store.runs("local", "task-1")) == 1
    assert store.get("local", "task-1").nextRunAt == "2030-01-01T14:00:00Z"


def test_due_slot_runs_once_and_downtime_skips_old_slot(tmp_path):
    store = ScheduledStore(tmp_path / "scheduled.db")
    store.save("local", task(repeat="hourly", timeZone="UTC"), datetime(2030, 1, 1, 9, tzinfo=UTC))
    job = store.claim()
    store.finish(job, demo_response(task(), job["id"], None), None)
    store.schedule_due(datetime(2030, 1, 1, 10, 0, 2, tzinfo=UTC))
    store.schedule_due(datetime(2030, 1, 1, 10, 0, 3, tzinfo=UTC))
    assert len(store.runs("local", "task-1")) == 2
    scheduled = store.claim()
    assert scheduled["trigger"] == "scheduled"
    store.finish(scheduled, None, None, interrupted=True)
    assert store.run("local", "task-1", scheduled["id"]).status == "interrupted"
    store.schedule_due(datetime(2030, 1, 2, 14, 30, tzinfo=UTC))
    assert len(store.runs("local", "task-1")) == 2
    assert store.get("local", "task-1").nextRunAt == "2030-01-02T15:00:00Z"


def test_api_scopes_reads_and_preserves_raw_report(tmp_path):
    app = FastAPI()
    app.state.identity = None
    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None)
    app.include_router(scheduled_router(runtime), prefix="/api/desk")
    headers = {"origin": "http://127.0.0.1:8317", "x-agent-desk": "configure"}
    with TestClient(app) as client:
        assert client.put("/api/desk/scheduled-tasks/task-1", json=task().model_dump()).status_code == 403
        result = client.put("/api/desk/scheduled-tasks/task-1", json=task().model_dump(), headers=headers)
        assert result.status_code == 200
        assert client.get("/api/desk/scheduled-tasks").json()["capabilities"] == [
            {"agentId": "demo", "reportSchemaVersion": "1.0"}]
        runtime.tick()
        run = client.get("/api/desk/scheduled-tasks/task-1/runs").json()["runs"][0]
        result = client.get(f'/api/desk/scheduled-tasks/task-1/runs/{run["id"]}').json()
        assert result["response"]["report"]["task_run_id"] == run["id"]
        assert client.delete("/api/desk/scheduled-tasks/task-1", headers=headers).status_code == 204
        assert client.get(f'/api/desk/scheduled-tasks/task-1/runs/{run["id"]}').status_code == 404


def test_transport_delivery_is_explicit_and_replay_does_not_repeat_it():
    value = InvokeRequest(request_id="request", question="Question", session_id="session",
                          delivery={"mode": "report", "task_id": "task", "task_run_id": "run"})
    payload = invocation_payload(value)
    command = json.loads(payload["input"][0]["content"][0]["text"])
    assert command["delivery"] == {"mode": "report", "task_id": "task", "task_run_id": "run"}
    replay = invocation_payload(value.model_copy(update={"action": "replay"}))
    assert "delivery" not in json.loads(replay["input"][0]["content"][0]["text"])


@pytest.mark.parametrize("bounds", ["[start,end)", "[start,end]"])
def test_report_accepts_explicit_period_bounds(bounds):
    value = task()
    response = demo_response(value, "run", None)
    response["report"]["period"] = {"start": "2030-01-01T00:00:00Z", "end": "2030-01-02T00:00:00Z",
                                     "time_zone": "America/Lima", "bounds": bounds}
    assert validate_response(response, value.id, "run", None) is response
    assert ReportPeriod.model_validate(response["report"]["period"]).bounds == bounds


@pytest.mark.parametrize("field", ["period", "extensions", "source_request_id"])
def test_report_optional_fields_absent_not_null(field):
    report = demo_response(task(), "run", None)["report"]
    assert Report.model_validate(report)
    report[field] = None
    with pytest.raises(ValueError):
        Report.model_validate(report)


def test_scheduler_lock_does_not_recover_a_live_owner(tmp_path):
    first = SchedulerLock(tmp_path / "owner.lock")
    second = SchedulerLock(tmp_path / "owner.lock")
    first.acquire()
    try:
        with pytest.raises(RuntimeError, match="Otro proceso"):
            second.acquire()
    finally:
        first.release()
    second.acquire()
    second.release()


def test_history_hides_revoked_historical_agent_metadata(tmp_path):
    app = FastAPI()
    app.state.identity = object()
    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None)
    runtime.permitted = lambda owner, profile: owner == "alice" and profile == "new-agent"
    runtime.store.save("alice", task(agentId="old-agent"))
    old = runtime.store.runs("alice", "task-1")[0]
    runtime.store.save("alice", task(agentId="new-agent"))

    @app.middleware("http")
    async def principal(request, call_next):
        request.state.principal = {"id": "alice"}
        return await call_next(request)

    app.include_router(scheduled_router(runtime), prefix="/api/desk")
    with TestClient(app) as client:
        response = client.get("/api/desk/scheduled-tasks/task-1/runs")
        assert response.headers["cache-control"] == "no-store"
        assert [run["taskVersion"] for run in response.json()["runs"]] == [2]
        assert client.get(f'/api/desk/scheduled-tasks/task-1/runs/{old.id}').status_code == 403
        assert client.get('/api/desk/scheduled-tasks/task-1/template?version=1').status_code == 403
        assert client.get('/api/desk/scheduled-tasks/task-1/template?version=2').status_code == 200


def test_provenance_preserves_owned_research_and_marks_unverified_source(tmp_path):
    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None)
    value = task()
    runtime.store.save("local", value)
    job = runtime.store.claim()
    runtime.store.finish(job, demo_response(value, job["id"], None), None)
    response = demo_response(value, "current", None)
    response["report"]["source_request_id"] = job["id"]
    runtime.provenance(response, value, {"owner": "local", "id": "current"})
    assert response["report"]["source_request_id"] == job["id"]
    # Same identifier under a different owner must not establish provenance.
    runtime.provenance(response, value, {"owner": "another-user", "id": "other"})
    assert "source_request_id" not in response["report"]
    assert "No se pudo verificar" in response["report"]["limitations"][-1]


def test_edit_does_not_cancel_already_running_historical_version(tmp_path):
    store = ScheduledStore(tmp_path / "scheduled.db")
    first = task()
    store.save("local", first)
    old_job = store.claim()
    store.save("local", task(instructions="Nueva consulta"))
    assert store.claim() is None
    store.finish(old_job, demo_response(first, old_job["id"], None), None)
    assert store.run("local", first.id, old_job["id"]).status == "completed"
    assert store.claim()["version"] == 2


def test_runtime_construction_and_openapi_do_not_create_database(tmp_path):
    root = tmp_path / "not-created"
    runtime = ScheduledRuntime(ProfileStore(root), lambda: None)
    app = FastAPI()
    app.include_router(scheduled_router(runtime), prefix="/api/desk")
    assert "/api/desk/scheduled-tasks/{task_id}/template" in app.openapi()["paths"]
    assert not root.exists()


def test_visual_template_adjustment_preserves_history_without_queueing(tmp_path):
    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None)
    runtime.store.save("local", task())
    runtime.tick()
    old = runtime.store.runs("local", "task-1")[0]
    response = runtime.store.run("local", "task-1", old.id).response
    template = response["report"]["template"]
    template["sections"][0]["title"] = "Nuevo título"
    updated = runtime.store.change_template("local", "task-1", template, 1)
    assert updated.version == 2
    assert runtime.store.claim() is None
    assert len(runtime.store.runs("local", "task-1")) == 1
    original = runtime.store.run("local", "task-1", old.id).response["report"]["template"]
    assert original["version"] == 1
    assert original["sections"][0]["title"] == "Resumen"
    with pytest.raises(ValueError, match="recarga"):
        runtime.store.change_template("local", "task-1", template, 1)
    template["sections"][0]["section_id"] = "new-section-needs-research"
    with pytest.raises(ValueError, match="conservar"):
        runtime.store.change_template("local", "task-1", template, 2)


def test_template_api_rejects_stale_version_and_persists_visual_change(tmp_path):
    app = FastAPI()
    app.state.identity = None
    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None)
    app.include_router(scheduled_router(runtime), prefix="/api/desk")
    headers = {"origin": "http://127.0.0.1:8317", "x-agent-desk": "configure"}
    runtime.store.save("local", task())
    runtime.tick()
    run = runtime.store.runs("local", "task-1")[0]
    layout = runtime.store.run("local", "task-1", run.id).response["report"]["template"]
    layout["sections"][0]["title"] = "Informe ajustado"
    with TestClient(app) as client:
        body = {"template": layout, "expectedVersion": 1}
        before = client.get("/api/desk/scheduled-tasks/task-1/template")
        assert before.json()["template"]["sections"][0]["title"] == "Resumen"
        response = client.put("/api/desk/scheduled-tasks/task-1/template", json=body, headers=headers)
        assert response.status_code == 200
        assert response.json()["version"] == 2
        saved = client.get("/api/desk/scheduled-tasks/task-1/template")
        assert saved.json()["template"]["sections"][0]["title"] == "Informe ajustado"
        assert saved.json()["template"]["version"] == saved.json()["version"] == 2
        assert client.put("/api/desk/scheduled-tasks/task-1/template", json=body, headers=headers).status_code == 409
        assert len(runtime.store.runs("local", "task-1")) == 1


def page_template(version=1):
    return {"template_id": "page-report", "version": version, "sections": [
        {"section_id": name, "title": name, "visibility": "always"}
        for name in ("summary", "scope", "findings")]}


def page_presentation():
    return {"schema_version": "1.0", "rows": [
        {"section_ids": ["summary", "scope"]}, {"section_ids": ["findings"]}]}


def test_presentation_v2_migration_history_and_compatible_task_edits(tmp_path):
    path = tmp_path / "scheduled.db"
    store = ScheduledStore(path)
    store.save("alice", task())
    job = store.claim()
    store.finish(job, demo_response(task(), job["id"], page_template()), None)
    with store.connect() as db:
        db.execute("DROP TABLE presentations")
        db.execute("PRAGMA user_version=2")
    store = ScheduledStore(path)
    assert store.run("alice", "task-1", job["id"]).status == "completed"
    assert store.presentation("alice", "task-1", 1) is None
    store.change_template("alice", "task-1", page_template(), 1, page_presentation())
    assert store.presentation("alice", "task-1", 2) == page_presentation()
    assert store.presentation("alice", "task-1", 1) is None
    assert store.template("alice", "task-1", 1)[1]["version"] == 1
    assert store.claim() is None
    with pytest.raises(KeyError):
        store.presentation("bob", "task-1", 2)
    with pytest.raises(KeyError):
        store.template("alice", "task-1", 99)
    with pytest.raises(ValueError, match="recarga"):
        store.change_template("alice", "task-1", page_template(), 1, page_presentation())
    displayed = store.manual("alice", "task-1", "layout-check")
    displayed_job = store.claim()
    store.finish(displayed_job, demo_response(task(), displayed_job["id"], page_template(2)), None)
    assert store.run("alice", "task-1", displayed.id).presentation.model_dump() == page_presentation()
    assert next(run for run in store.runs("alice", "task-1") if run.id == displayed.id).presentation is not None
    assert store.run("alice", "task-1", job["id"]).presentation is None
    store.save("alice", task(instructions="Otra pregunta"))
    new = store.claim()
    assert new["template"] is None
    store.finish(new, demo_response(task(), new["id"], page_template(3)), None)
    assert store.presentation("alice", "task-1", 3) == page_presentation()
    store.change_template("alice", "task-1", page_template(3), 3)
    assert store.presentation("alice", "task-1", 4) == page_presentation()
    assert store.run("alice", "task-1", displayed.id).presentation.model_dump() == page_presentation()
    with store.connect() as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 3
        assert not db.execute("PRAGMA foreign_key_check").fetchall()


@pytest.mark.parametrize("rows", [
    [], [{"section_ids": []}], [{"section_ids": ["summary", "scope", "findings"]}],
    [{"section_ids": ["summary", "summary"]}, {"section_ids": ["scope", "findings"]}],
    [{"section_ids": ["summary", "scope"]}],
    [{"section_ids": ["summary", "scope"]}, {"section_ids": ["foreign-section"]}],
])
def test_presentation_api_rejects_invalid_grid_without_changing_version(tmp_path, rows):
    app = FastAPI()
    app.state.identity = None
    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None)
    runtime.store.save("local", task())
    job = runtime.store.claim()
    runtime.store.finish(job, demo_response(task(), job["id"], page_template()), None)
    app.include_router(scheduled_router(runtime), prefix="/api/desk")
    with TestClient(app) as client:
        response = client.put("/api/desk/scheduled-tasks/task-1/template", json={
            "template": page_template(), "expectedVersion": 1,
            "presentation": {"schema_version": "1.0", "rows": rows}},
            headers={"origin": "http://127.0.0.1:8317", "x-agent-desk": "configure"})
        assert response.status_code == 422
        assert runtime.store.get("local", "task-1").version == 1
        assert runtime.store.presentation("local", "task-1", 1) is None


@pytest.mark.parametrize("different_agent", [False, True])
def test_presentation_carry_does_not_reuse_another_template_or_agent(tmp_path, different_agent):
    store = ScheduledStore(tmp_path / "scheduled.db")
    original = task()
    store.save("alice", original)
    first = store.claim()
    store.finish(first, demo_response(original, first["id"], page_template()), None)
    store.change_template("alice", "task-1", page_template(), 1, page_presentation())
    changed = task(instructions="Otra pregunta", agentId="another-agent" if different_agent else "demo")
    store.save("alice", changed)
    current = store.claim()
    template = page_template(3)
    if not different_agent:
        template["sections"][1]["section_id"] = "method"
    store.finish(current, demo_response(changed, current["id"], template), None)
    assert store.presentation("alice", "task-1", 3) is None
    assert store.presentation("alice", "task-1", 2) == page_presentation()
    with store.connect() as db:
        assert db.execute("SELECT count(*) FROM presentations WHERE version=3").fetchone()[0] == 0


def test_presentation_api_roundtrip_historical_version_and_no_research(tmp_path):
    app = FastAPI()
    app.state.identity = None
    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None)
    runtime.store.save("local", task())
    job = runtime.store.claim()
    runtime.store.finish(job, demo_response(task(), job["id"], page_template()), None)
    app.include_router(scheduled_router(runtime), prefix="/api/desk")
    with TestClient(app) as client:
        body = {"template": page_template(), "expectedVersion": 1, "presentation": page_presentation()}
        response = client.put("/api/desk/scheduled-tasks/task-1/template", json=body,
                              headers={"origin": "http://127.0.0.1:8317", "x-agent-desk": "configure"})
        assert response.status_code == 200
        saved = client.get("/api/desk/scheduled-tasks/task-1/template")
        assert saved.json()["presentation"] == page_presentation()
        assert saved.json()["version"] == 2
        old = client.get("/api/desk/scheduled-tasks/task-1/template?version=1")
        assert old.json()["version"] == 1 and old.json()["presentation"] is None
        assert old.json()["template"]["version"] == 1
        assert old.headers["cache-control"] == "no-store"
        assert client.get("/api/desk/scheduled-tasks/task-1/template?version=99").status_code == 404
        assert client.get("/api/desk/scheduled-tasks/task-1/template?version=0").status_code == 422
        assert runtime.store.claim() is None
        assert len(runtime.store.runs("local", "task-1")) == 1


def report_profile(**changes):
    return AgentProfile(id="a" * 32, name="Agent", endpoint_host="gateway.example.com", flow_id="flow",
                        region="region", profile="DEFAULT", ready=True, instance_id="instance",
                        workspace_id="workspace", **changes)


def test_test_capability_is_local_explicit_and_separate_from_prod(tmp_path, monkeypatch):
    profiles = ProfileStore(tmp_path)
    saved = report_profile()
    monkeypatch.setattr(profiles, "list", lambda: [saved])
    runtime = ScheduledRuntime(profiles, lambda: None)
    target = "test:" + saved.id
    monkeypatch.setenv("AGENT_DESK_REPORT_PROFILES", target)
    assert runtime.supported(target)
    assert not runtime.supported(saved.id)
    assert runtime.candidates() == ["demo", saved.id, target]
    monkeypatch.setenv("AGENT_DESK_REPORT_PROFILES", saved.id)
    assert runtime.supported(saved.id)
    assert not runtime.supported(target)
    monkeypatch.setenv("AGENT_DESK_REPORT_PROFILES", target)
    hosted = ScheduledRuntime(profiles, lambda: object())
    assert hosted.supported(target)
    assert not hosted.supported("demo")
    saved.instance_id = ""
    assert not runtime.supported(target)
    saved.instance_id = "instance"
    saved.surface = "TEST"
    assert runtime.candidates() == ["demo", target]
    assert runtime.target_id(saved.id, "PROD") == target
    assert runtime.supported(target)
    monkeypatch.setenv("AGENT_DESK_REPORT_PROFILES", saved.id)
    assert not runtime.supported(saved.id)


def test_native_test_execution_uses_saved_id_and_test_surface(tmp_path, monkeypatch):
    from app.features.desk import scheduled_runtime

    profiles = ProfileStore(tmp_path)
    saved = report_profile()
    monkeypatch.setattr(profiles, "list", lambda: [saved])
    monkeypatch.setenv("AGENT_DESK_REPORT_PROFILES", "test:" + saved.id)
    observed = []
    value = task(agentId="test:" + saved.id)

    class Transport:
        def __init__(self, store, request):
            observed.append(request)

        def packets(self):
            yield json.dumps({"kind": "response", "request_id": "run", "response":
                              demo_response(value, "run", None)}).encode()

        def close(self):
            pass

    monkeypatch.setattr(scheduled_runtime, "AgentTransport", Transport)
    runtime = ScheduledRuntime(profiles, lambda: None)
    assert runtime.execute(value, {"owner": "local", "id": "run", "version": 1}, None)["report"]["task_id"] == value.id
    assert observed[0].profile_id == saved.id
    assert observed[0].surface == "TEST"
    assert observed[0].delivery.task_run_id == "run"


def test_blocked_investigation_does_not_drop_another_tasks_schedule(tmp_path):
    clock = [datetime(2030, 1, 1, 9, 59, 59, tzinfo=UTC)]
    entered, release = Event(), Event()

    def blocked(value, job, template):
        entered.set()
        assert release.wait(10)
        return demo_response(value, job["id"], template)

    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None, executor=blocked, clock=lambda: clock[0])
    other = task(id="other", timeZone="UTC")
    runtime.store.save("local", other, now=clock[0])
    initial = runtime.store.claim()
    runtime.store.finish(initial, demo_response(other, initial["id"], None), None)
    runtime.store.save("local", task(id="blocking", startDate="2030-01-02"), now=clock[0])
    runtime.start()
    try:
        assert entered.wait(3)
        clock[0] = datetime(2030, 1, 1, 10, 0, 2, tzinfo=UTC)
        deadline = monotonic() + 5
        while monotonic() < deadline:
            pending = [run for run in runtime.store.runs("local", "other") if run.trigger == "scheduled"]
            if pending:
                break
            Event().wait(0.05)
        assert len(pending) == 1
        assert pending[0].status == "queued"
    finally:
        release.set()
        runtime.stop()


def test_template_whitespace_and_markdown_indentation_survive_two_runs(tmp_path):
    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None)

    def padded(value, job, template):
        result = demo_response(value, job["id"], template)
        result["report"]["template"]["sections"][0]["title"] = " Resumen "
        result["report"]["sections"][0]["markdown"] = "    code"
        return result

    runtime.executor = padded
    runtime.store.save("local", task())
    runtime.tick()
    first = runtime.store.runs("local", "task-1")[0]
    assert first.status == "completed"
    frozen = runtime.store.template("local", "task-1")[1]
    delivery = ReportDelivery.model_validate({"mode": "report", "task_id": "task-1", "task_run_id": "run",
                                             "template": frozen})
    assert delivery.model_dump()["template"]["sections"][0]["title"] == " Resumen "
    second = runtime.store.manual("local", "task-1", "second-padded")
    runtime.tick()
    accepted = runtime.store.run("local", "task-1", second.id)
    assert accepted.status == "completed"
    assert accepted.response["report"]["sections"][0]["markdown"] == "    code"


@pytest.mark.parametrize("status", ["completed", "partial"])
def test_report_delete_restore_preserves_ledger_occurrence_and_saved_response(tmp_path, status):
    app = FastAPI()
    app.state.identity = None
    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None)
    runtime.store.save("local", task())
    job = runtime.store.claim()
    response = demo_response(task(), job["id"], None)
    response["status"] = status
    runtime.store.finish(job, response, None)
    original_task = runtime.store.get("local", "task-1").model_dump()
    app.include_router(scheduled_router(runtime), prefix="/api/desk")
    path = f'/api/desk/scheduled-tasks/task-1/runs/{job["id"]}'
    headers = {"origin": "http://127.0.0.1:8317", "x-agent-desk": "configure"}
    with TestClient(app) as client:
        assert client.get(path).json()["response"] == response
        assert client.delete(path + "/report").status_code == 403
        assert client.delete(path + "/report", headers=headers).status_code == 204
        assert client.delete(path + "/report", headers=headers).status_code == 204
        assert client.get(path).status_code == 404
        assert client.get("/api/desk/scheduled-tasks/task-1/runs").json()["runs"] == []
        assert client.post(path + "/recover", json={}, headers=headers).status_code == 404
        with runtime.store.connect() as db:
            preserved = db.execute("SELECT * FROM runs WHERE id=?", (job["id"],)).fetchone()
            assert preserved["status"] == status and json.loads(preserved["response"]) == response
            assert runtime.store.enqueue(db, "local", "task-1", 1, job["occurrence"], job["trigger"]) == job["id"]
            assert db.execute("SELECT count(*) FROM runs").fetchone()[0] == 1
            assert not db.execute("PRAGMA foreign_key_check").fetchall()
        assert runtime.store.claim() is None
        assert runtime.store.get("local", "task-1").model_dump() == original_task
        assert client.post(path + "/report/restore", headers=headers).status_code == 204
        assert client.post(path + "/report/restore", headers=headers).status_code == 204
        assert client.get(path).json()["response"] == response
        assert len(client.get("/api/desk/scheduled-tasks/task-1/runs").json()["runs"]) == 1


@pytest.mark.parametrize("status", ["queued", "running", "failed", "interrupted"])
def test_report_visibility_rejects_non_report_runs(tmp_path, status):
    app = FastAPI()
    app.state.identity = None
    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None)
    runtime.store.save("local", task())
    run = runtime.store.runs("local", "task-1")[0]
    with runtime.store.connect() as db:
        db.execute("UPDATE runs SET status=? WHERE id=?", (status, run.id))
    app.include_router(scheduled_router(runtime), prefix="/api/desk")
    path = f"/api/desk/scheduled-tasks/task-1/runs/{run.id}/report"
    headers = {"origin": "http://127.0.0.1:8317", "x-agent-desk": "configure"}
    with TestClient(app) as client:
        assert client.delete(path, headers=headers).status_code == 409
        assert client.post(path + "/restore", headers=headers).status_code == 409
        assert len(runtime.store.runs("local", "task-1")) == 1


def test_report_visibility_checks_owner_and_historical_agent_even_for_restore(tmp_path):
    app = FastAPI()
    app.state.identity = SimpleNamespace(settings=SimpleNamespace(origin="http://127.0.0.1:8317"))
    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None)
    allowed = {"old-agent", "new-agent"}
    principal = ["alice"]
    runtime.permitted = lambda user, agent: user in {"alice", "bob"} and agent in allowed
    runtime.store.save("alice", task(agentId="old-agent"))
    job = runtime.store.claim()
    runtime.store.finish(job, demo_response(task(), job["id"], None), None)
    runtime.store.save("alice", task(agentId="new-agent"))
    runtime.store.save("bob", task(agentId="new-agent"))

    @app.middleware("http")
    async def identity(request, call_next):
        request.state.principal = {"id": principal[0]}
        return await call_next(request)

    app.include_router(scheduled_router(runtime), prefix="/api/desk")
    path = f'/api/desk/scheduled-tasks/task-1/runs/{job["id"]}/report'
    headers = {"origin": "http://127.0.0.1:8317", "x-agent-desk": "configure"}
    with TestClient(app) as client:
        assert client.delete(path, headers=headers).status_code == 204
        allowed.remove("old-agent")
        assert client.post(path + "/restore", headers=headers).status_code == 403
        assert client.delete(path, headers=headers).status_code == 403
        allowed.add("old-agent")
        allowed.remove("new-agent")
        assert client.post(path + "/restore", headers=headers).status_code == 403
        allowed.add("new-agent")
        principal[0] = "bob"
        assert client.post(path + "/restore", headers=headers).status_code == 404
        assert client.delete(path, headers=headers).status_code == 404
        principal[0] = "alice"
        assert client.post(path + "/restore", headers=headers).status_code == 204


def test_hidden_report_cannot_be_recreated_by_repeating_manual_idempotency_key(tmp_path):
    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None)
    runtime.store.save("local", task())
    runtime.tick()
    saved = runtime.store.manual("local", "task-1", "same-occurrence")
    runtime.tick()
    runtime.store.set_report_hidden("local", "task-1", saved.id, True)
    with pytest.raises(ValueError, match="restáuralo"):
        runtime.store.manual("local", "task-1", "same-occurrence")
    assert runtime.store.claim() is None
    with runtime.store.connect() as db:
        assert db.execute("SELECT count(*) FROM runs").fetchone()[0] == 2
    runtime.store.set_report_hidden("local", "task-1", saved.id, False)
    assert runtime.store.manual("local", "task-1", "same-occurrence").id == saved.id


def test_existing_schema_three_adds_report_tombstones_without_changing_run(tmp_path):
    path = tmp_path / "scheduled.db"
    store = ScheduledStore(path)
    store.save("local", task())
    job = store.claim()
    store.finish(job, demo_response(task(), job["id"], None), None)
    with store.connect() as db:
        db.execute("DROP TABLE hidden_reports")
    upgraded = ScheduledStore(path)
    assert upgraded.run("local", "task-1", job["id"]).status == "completed"
    upgraded.set_report_hidden("local", "task-1", job["id"], True)
    assert upgraded.runs("local", "task-1") == []
    upgraded.set_report_hidden("local", "task-1", job["id"], False)
    assert upgraded.run("local", "task-1", job["id"]).status == "completed"
