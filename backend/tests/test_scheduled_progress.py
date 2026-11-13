import json

import pytest
from test_scheduled_recovery import complete, pending, setup_native

from app.features.desk.scheduled_recovery import RecoveryRequired, canonical_response


def coverage(request, sequence=1, state="running", phase="retrieving", outcome=None):
    return {"event_id": f"e{sequence}", "turn_id": request.request_id, "sequence": sequence,
            "type": "source.coverage", "text": "Consultando la fuente seleccionada", "source_key": "facebook",
            "coverage": {"phase": phase, "presentation": {"schema_version": "1.0", "purpose": "progress",
                         "activity": {"activity_id": "a" * 64, "state": state, "phase": phase, "outcome": outcome}}}}


def replay(request, response=None, events=None, snapshot=None, cursor=0):
    return {"kind": "snapshot", "request_id": request.request_id, "response": response,
            "replay": {"cursor": cursor, "events": events or [], "snapshot": snapshot}}


@pytest.mark.parametrize("full_snapshot", [True, False])
def test_recovery_accepts_finished_replay_and_keeps_same_execution(tmp_path, monkeypatch, full_snapshot):
    def finished(request):
        item = coverage(request)
        return [replay(request, complete(request)[0]["response"],
                       events=[] if full_snapshot else [item], cursor=1,
                       snapshot={"blocks": {}, "activities": {"a" * 64: item}} if full_snapshot else None)]

    runtime, task, observed = setup_native(tmp_path, monkeypatch, [pending(False), finished])
    runtime.tick()
    run = runtime.store.runs("local", task.id)[0]
    runtime.store.recover_run("local", task.id, run.id)
    runtime.tick()
    assert runtime.store.run("local", task.id, run.id).status == "completed"
    assert len(runtime.store.runs("local", task.id)) == 1
    assert [item.action for item in observed] == ["research", "replay"]


def test_progress_is_durable_before_response_and_retained_on_interruption(tmp_path, monkeypatch):
    def streaming(request):
        yield {"kind": "event", "event": coverage(request)}
        detail = runtime.store.run("local", task.id, request.request_id)
        assert detail.status == "running"
        assert detail.activity[0].state == "running"
        assert detail.activity[0].source == "facebook"
        assert runtime.store.runs("local", task.id)[0].activity == []
        yield {"kind": "transport_error", "request_id": request.request_id}

    runtime, task, _ = setup_native(tmp_path, monkeypatch, [streaming])
    runtime.tick()
    detail = runtime.store.run("local", task.id, runtime.store.runs("local", task.id)[0].id)
    assert detail.status == "interrupted" and detail.recoverable
    assert detail.activity[0].text == "Consultando la fuente seleccionada"
    with pytest.raises(KeyError):
        runtime.store.run("other-owner", task.id, detail.id)


@pytest.mark.parametrize("fault", ["foreign", "gap", "cursor", "contradiction"])
def test_malformed_replay_cannot_accept_report_or_template(tmp_path, monkeypatch, fault):
    def malformed(request):
        event = coverage(request)
        packet = replay(request, complete(request)[0]["response"], events=[event], cursor=1)
        if fault == "foreign":
            event["turn_id"] = "foreign"
        elif fault == "gap":
            event["sequence"] = 2
        elif fault == "cursor":
            packet["replay"]["cursor"] = 9007199254740991
        else:
            event["coverage"]["presentation"]["activity"]["state"] = "completed"
        return [packet]

    runtime, task, _ = setup_native(tmp_path, monkeypatch, [malformed])
    runtime.tick()
    assert runtime.store.runs("local", task.id)[0].status == "interrupted"
    assert runtime.store.template("local", task.id)[1] is None


def test_progress_projection_is_bounded_and_latest_revision_wins():
    class Request:
        request_id = "request"

    updates = []
    packets = []
    for sequence in range(1, 205):
        event = coverage(Request(), sequence)
        event["coverage"]["presentation"]["activity"]["activity_id"] = str(sequence)
        event["text"] = "x" * 5000
        packets.append(json.dumps({"kind": "event", "event": event}).encode())
    packets.append(json.dumps({"kind": "response", "request_id": "request", "response": {"status": "pending"}}).encode())
    assert canonical_response(packets, "request", updates.append) == {"status": "pending"}
    assert len(updates[-1]) == 200
    assert all(len(item["text"]) == 2000 for item in updates[-1])


def test_empty_snapshot_is_pending_without_authorizing_research():
    packet = {"kind": "snapshot", "request_id": "r", "response": None,
              "replay": {"cursor": 0, "events": [], "snapshot": None}}
    assert canonical_response([json.dumps(packet).encode()], "r") == {"status": "pending", "resumable": True}
    packet["request_id"] = "foreign"
    with pytest.raises(RecoveryRequired):
        canonical_response([json.dumps(packet).encode()], "r")


@pytest.mark.parametrize("stopped", [True, False])
def test_failed_or_stopped_report_keeps_progress_without_unaccepted_facts(tmp_path, monkeypatch, stopped):
    def streaming(request):
        yield {"kind": "event", "event": coverage(request)}
        response = complete(request)[0]
        if stopped:
            runtime.stop_event.set()
        else:
            response["response"]["report"]["task_id"] = "other-task"
        yield response

    runtime, task, _ = setup_native(tmp_path, monkeypatch, [streaming])
    runtime.tick()
    run = runtime.store.run("local", task.id, runtime.store.runs("local", task.id)[0].id)
    assert run.status == ("interrupted" if stopped else "failed")
    assert len(run.activity) == 1
    assert set(run.response) == {"activity"}
    assert runtime.store.template("local", task.id)[1] is None


def test_unrelated_final_response_activity_does_not_become_internal_progress(tmp_path, monkeypatch):
    def final(request):
        packet = complete(request)[0]
        packet["response"]["activity"] = "future-capability"
        return [packet]

    runtime, task, _ = setup_native(tmp_path, monkeypatch, [final])
    runtime.tick()
    run = runtime.store.run("local", task.id, runtime.store.runs("local", task.id)[0].id)
    assert run.status == "completed"
    assert run.activity == []
    assert run.response["activity"] == "future-capability"


def test_safe_continuation_keeps_prior_activity_and_original_start(tmp_path, monkeypatch):
    def first(request):
        yield {"kind": "event", "event": coverage(request)}
        yield from pending()(request)

    def continued(request):
        event = coverage(request, sequence=2)
        event["source_key"] = "web"
        event["coverage"]["presentation"]["activity"]["activity_id"] = "b" * 64
        yield {"kind": "event", "event": event}
        yield from pending(False)(request)

    runtime, task, _ = setup_native(tmp_path, monkeypatch, [first, continued])
    runtime.tick()
    run = runtime.store.run("local", task.id, runtime.store.runs("local", task.id)[0].id)
    assert run.status == "interrupted"
    assert {item.source for item in run.activity} == {"facebook", "web"}
    started = run.startedAt
    runtime.store.recover_run("local", task.id, run.id)
    runtime.store.claim()
    assert runtime.store.run("local", task.id, run.id).startedAt == started


@pytest.mark.parametrize("state,held,safe,can_continue", [
    ("interrupted", False, True, True), ("waiting", False, True, True),
    ("running", False, True, False), ("unknown", False, True, False),
    ("interrupted", True, True, False), ("interrupted", False, False, False),
    ("interrupted", 0, True, False), ("interrupted", False, "true", False),
])
def test_only_explicit_fenced_execution_summary_authorizes_null_replay_continuation(state, held, safe, can_continue):
    packet = {"kind": "snapshot", "request_id": "r", "response": None,
              "replay": {"cursor": 0, "events": [], "snapshot": None},
              "execution": {"schema_version": "1.0", "state": state, "owner_held": held, "continuation_safe": safe}}
    response = canonical_response([json.dumps(packet).encode()], "r")
    assert response.get("continuation_safe", False) is can_continue


@pytest.mark.parametrize("version", [None, "2.0"])
def test_unknown_execution_capability_version_cannot_continue(version):
    packet = {"kind": "snapshot", "request_id": "r", "response": None,
              "replay": {"cursor": 0, "events": [], "snapshot": None},
              "execution": {"schema_version": version, "state": "interrupted", "owner_held": False, "continuation_safe": True}}
    assert not canonical_response([json.dumps(packet).encode()], "r").get("continuation_safe")
