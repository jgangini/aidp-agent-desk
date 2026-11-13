import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.features.desk import scheduled_runtime
from app.features.desk.credentials import ProfileStore
from app.features.desk.scheduled_api import scheduled_router
from app.features.desk.scheduled_runtime import ScheduledRuntime, demo_response
from app.features.desk.scheduled_schemas import ScheduledTask
from app.features.desk.scheduled_store import ScheduledStore


def task(testing=True):
    return ScheduledTask(id="task", name="Report", instructions="Exact question", agentId=("test:" if testing else "")
                         + "a" * 32, agentName="Agent", repeat="daily", startDate="2030-01-01", time="10:00",
                         timeZone="UTC", createdAt="2026-11-11T00:00:00Z")


def setup_native(tmp_path, monkeypatch, scripts, testing=True):
    observed = []
    value = task(testing)

    class Transport:
        def __init__(self, profiles, request):
            self.request = request
            observed.append(request)

        def packets(self):
            script = scripts[len(observed) - 1]
            for result in script(self.request):
                yield json.dumps(result).encode()

        def close(self):
            pass

    monkeypatch.setattr(scheduled_runtime, "AgentTransport", Transport)
    runtime = ScheduledRuntime(ProfileStore(tmp_path), lambda: None)
    monkeypatch.setattr(runtime, "supported", lambda _: True)
    monkeypatch.setattr(runtime, "permitted", lambda *_: True)
    runtime.store.save("local", value)
    return runtime, value, observed


def pending(safe=True, foreign=False):
    def emit(request):
        response = {"status": "pending", "continuation_safe": safe, "markdown": "Not accepted facts"}
        if foreign:
            response["pending_request_id"] = "another-request"
        return [{"kind": "response", "request_id": request.request_id, "response": response}]
    return emit


def complete(request):
    return [{"kind": "response", "request_id": request.request_id,
             "response": demo_response(task(request.surface == "TEST"), request.request_id, None)}]


@pytest.mark.parametrize("testing", [True, False])
def test_safe_pending_continues_twice_with_same_identity_and_delivery(tmp_path, monkeypatch, testing):
    runtime, value, observed = setup_native(tmp_path, monkeypatch, [pending(), pending(), complete], testing)
    runtime.tick()
    runs = runtime.store.runs("local", value.id)
    assert len(runs) == 1
    assert runs[0].status == "completed"
    assert len(observed) == 3
    assert len({request.request_id for request in observed}) == 1
    assert len({request.session_id for request in observed}) == 1
    assert {request.question for request in observed} == {value.instructions}
    assert observed[0].delivery == observed[1].delivery == observed[2].delivery


def test_safe_test_continuations_stop_after_two_additional_attempts(tmp_path, monkeypatch):
    runtime, value, observed = setup_native(tmp_path, monkeypatch, [pending(), pending(), pending()])
    runtime.tick()
    assert len(observed) == 3
    run = runtime.store.runs("local", value.id)[0]
    assert run.status == "interrupted"
    assert run.recoverable


@pytest.mark.parametrize(("safe", "foreign", "testing"), [(False, False, True), (True, True, True), (False, False, False), (True, True, False)])
def test_pending_without_safe_test_authority_never_reinvokes(tmp_path, monkeypatch, safe, foreign, testing):
    runtime, value, observed = setup_native(tmp_path, monkeypatch, [pending(safe, foreign)], testing)
    runtime.tick()
    run = runtime.store.runs("local", value.id)[0]
    assert run.status == "interrupted"
    assert run.recoverable
    assert len(observed) == 1
    control = runtime.store.run("local", value.id, run.id).response
    assert "markdown" not in control
    assert "report" not in control
    assert runtime.store.template("local", value.id)[1] is None


def test_transport_error_after_complete_does_not_accept_report(tmp_path, monkeypatch):
    def cut(request):
        return complete(request) + [{"kind": "transport_error", "request_id": request.request_id, "code": "deadline"}]

    runtime, value, _ = setup_native(tmp_path, monkeypatch, [cut])
    runtime.tick()
    run = runtime.store.runs("local", value.id)[0]
    assert run.status == "interrupted"
    assert runtime.store.run("local", value.id, run.id).response == {"status": "pending", "resumable": True}
    assert runtime.store.template("local", value.id)[1] is None


def test_manual_recovery_replays_same_run_and_is_idempotent(tmp_path, monkeypatch):
    runtime, value, observed = setup_native(tmp_path, monkeypatch, [pending(False), complete])
    runtime.tick()
    run = runtime.store.runs("local", value.id)[0]
    recovered = runtime.store.recover_run("local", value.id, run.id)
    duplicate = runtime.store.recover_run("local", value.id, run.id)
    assert recovered.id == duplicate.id == run.id
    assert len(runtime.store.runs("local", value.id)) == 1
    runtime.tick()
    assert runtime.store.run("local", value.id, run.id).status == "completed"
    assert [request.action for request in observed] == ["research", "replay"]
    assert observed[0].request_id == observed[1].request_id
    assert observed[0].session_id == observed[1].session_id


def test_explicit_recovery_runs_while_schedule_is_paused(tmp_path, monkeypatch):
    runtime, value, observed = setup_native(tmp_path, monkeypatch, [pending(False), complete])
    runtime.tick()
    run = runtime.store.runs("local", value.id)[0]
    runtime.store.save("local", value.model_copy(update={"status": "paused"}))
    runtime.store.recover_run("local", value.id, run.id)
    runtime.tick()
    assert runtime.store.run("local", value.id, run.id).status == "completed"
    assert observed[-1].action == "replay"


def test_superseded_work_that_never_started_is_not_recoverable(tmp_path):
    store = ScheduledStore(tmp_path / "scheduled.db")
    value = task()
    store.save("local", value)
    original = store.runs("local", value.id)[0]
    store.save("local", value.model_copy(update={"instructions": "A different question"}))
    assert not store.run("local", value.id, original.id).recoverable
    with pytest.raises(ValueError, match="no admite"):
        store.recover_run("local", value.id, original.id)


def test_replay_snapshot_without_safe_signal_does_not_restart_research(tmp_path, monkeypatch):
    def snapshot(request):
        return [{"kind": "snapshot", "request_id": request.request_id, "response": None,
                 "replay": {"cursor": 0, "events": []}}]

    runtime, value, observed = setup_native(tmp_path, monkeypatch, [pending(False), snapshot])
    runtime.tick()
    run = runtime.store.runs("local", value.id)[0]
    runtime.store.recover_run("local", value.id, run.id)
    runtime.tick()
    assert runtime.store.run("local", value.id, run.id).status == "interrupted"
    assert len(observed) == 2
    assert observed[-1].action == "replay"


def test_recovery_api_rechecks_historical_permission(tmp_path, monkeypatch):
    runtime, value, _ = setup_native(tmp_path, monkeypatch, [pending(False)])
    runtime.tick()
    run = runtime.store.runs("local", value.id)[0]
    app = FastAPI()
    app.state.identity = None
    app.include_router(scheduled_router(runtime), prefix="/api/desk")
    headers = {"origin": "http://127.0.0.1:8317", "x-agent-desk": "configure"}
    with TestClient(app) as client:
        monkeypatch.setattr(runtime, "permitted", lambda *_: False)
        assert client.post(f'/api/desk/scheduled-tasks/{value.id}/runs/{run.id}/recover', json={}, headers=headers).status_code == 403
        monkeypatch.setattr(runtime, "permitted", lambda *_: True)
        assert client.post(f'/api/desk/scheduled-tasks/{value.id}/runs/{run.id}/recover', json={}, headers=headers).status_code == 202


def test_sqlite_v1_migration_preserves_rows_foreign_keys_and_future_version_guard(tmp_path):
    path = tmp_path / "scheduled.db"
    store = ScheduledStore(path)
    value = task()
    store.save("local", value)
    original = store.runs("local", value.id)[0]
    with store.connect() as db:
        db.execute("ALTER TABLE runs DROP COLUMN recovery_mode")
        db.execute("PRAGMA user_version=1")
    migrated = ScheduledStore(path)
    assert migrated.run("local", value.id, original.id).status == "queued"
    with migrated.connect() as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 3
        assert db.execute("SELECT recovery_mode FROM runs").fetchone()[0] == "research"
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        db.execute("PRAGMA user_version=99")
    with pytest.raises(RuntimeError, match="Unsupported"):
        ScheduledStore(path)
