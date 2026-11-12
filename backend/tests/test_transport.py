import json
from typing import Any, cast

import pytest

from app.features.desk.credentials import ProfileStore
from app.features.desk.schemas import AgentProfile, InvokeRequest
from app.features.desk.transport import AgentTransport, NativeDecoder, StreamFailure


def frame(text: str, status: str = "in_progress") -> bytes:
    return ("data: " + json.dumps({"response": {"status": status, "output": [
        {"id": "assistant-1", "role": "assistant", "content": [{"type": "output_text", "text": text}]}
    ]}}, ensure_ascii=False) + "\n\n").encode()


def public(kind: str, **values: Any) -> str:
    return json.dumps({"protocol": "ai-market-intelligence", "version": "2.0", "kind": kind,
                       **values}, ensure_ascii=False) + "\n"


def test_fragmented_cumulative_stream_delivers_each_public_event_once() -> None:
    decoder = NativeDecoder("turn-1")
    event = public("event", event={"event_id": "event-1", "turn_id": "turn-1", "text": "Señal pública"})
    answer = public("response", request_id="turn-1", response={"markdown": "Resultado"})
    wire = frame(event[:40]) + frame(event) + frame(event + answer, "completed")
    packets = []
    for index in range(0, len(wire), 7):
        packets.extend(decoder.feed(wire[index:index + 7]))
    packets.extend(decoder.finish())
    assert [packet["kind"] for packet in packets] == ["event", "response"]
    assert packets[0]["event"]["text"] == "Señal pública"
    assert decoder.public_counts == {"event": 1, "response": 1}


def test_public_event_is_delivered_while_native_execution_is_still_open() -> None:
    decoder = NativeDecoder("turn-1")
    event = public("event", event={"event_id": "e", "turn_id": "turn-1", "text": "Primer resultado"})
    packets = decoder.feed(frame(event))
    assert packets[0]["event"]["text"] == "Primer resultado"
    assert not decoder.done
    answer = public("response", request_id="turn-1", response={"status": "completed", "markdown": "Respuesta"})
    assert decoder.feed(frame(event + answer, "completed"))[0]["kind"] == "response"
    assert decoder.finish() == []


def test_truncated_or_cross_request_public_stream_fails_closed() -> None:
    decoder = NativeDecoder("turn-1")
    decoder.feed(frame(public("event", event={"event_id": "e", "turn_id": "turn-1"})))
    with pytest.raises(ValueError, match="prematurely"):
        decoder.finish()
    with pytest.raises(StreamFailure, match="otra solicitud"):
        NativeDecoder("turn-1").feed(frame(public("response", request_id="another", response={})))


def test_plain_agent_response_does_not_invent_tool_results() -> None:
    decoder = NativeDecoder("turn-1")
    assert decoder.feed(frame("Respuesta real", "completed")) == []
    answer = decoder.finish()[0]["response"]
    assert answer == {"status": "completed", "markdown": "Respuesta real", "references": [], "artifacts": []}


@pytest.mark.parametrize("text", ["Agent invocation failed.", "Unexpected plain output"])
def test_test_surface_rejects_plain_output_even_when_native_marks_completed(text: str) -> None:
    decoder = NativeDecoder("turn-1", require_public=True)
    decoder.feed(frame(text, "completed"))
    with pytest.raises(StreamFailure) as failure:
        decoder.finish()
    assert failure.value.code == "unsupported_output"


def test_test_surface_accepts_its_public_response() -> None:
    decoder = NativeDecoder("turn-1", require_public=True)
    packets = decoder.feed(frame(public("response", request_id="turn-1", response={"status": "completed", "markdown": "Result"}), "completed"))
    assert packets[0]["response"]["markdown"] == "Result"
    assert decoder.finish() == []


def test_native_trace_and_tool_content_are_not_exposed() -> None:
    decoder = NativeDecoder("turn-1")
    native = {"response": {"status": "completed", "output": [
        {"role": "tool", "content": [{"type": "output_text", "text": "private tool trace"}]},
        {"role": "assistant", "content": [{"type": "reasoning", "text": "private reasoning"},
                                             {"type": "output_text", "text": "Public answer"}]}
    ]}}
    decoder.feed(("data: " + json.dumps(native) + "\n\n").encode())
    assert decoder.finish()[0]["response"]["markdown"] == "Public answer"


def test_completed_native_stream_requires_public_response_and_immutable_events() -> None:
    decoder = NativeDecoder("turn-1")
    first = public("event", event={"event_id": "e", "turn_id": "turn-1", "text": "first"})
    decoder.feed(frame(first, "completed"))
    with pytest.raises(ValueError, match="missing public response"):
        decoder.finish()
    changed = public("event", event={"event_id": "e", "turn_id": "turn-1", "text": "changed"})
    with pytest.raises(ValueError, match="immutable event changed"):
        decoder.feed(frame(changed))


def test_republished_event_allows_reviewed_collection_and_reference_growth_without_duplicate_output() -> None:
    decoder = NativeDecoder("turn-1")
    event = {"event_id": "event-1", "turn_id": "turn-1", "text": "Resumen revisado"}
    parent = {"evidence_id": "parent", "url": "https://example.org/post"}
    comment = {"evidence_id": "comment", "url": "https://example.org/comment", "requested_url": parent["url"]}
    first = public("event", event=event, references=[parent], content_items={"schema_version": "1.0", "revision": 1, "items": []})
    updated = public("event", event=event, references=[parent, comment], content_items={"schema_version": "1.0", "revision": 2, "items": []})
    assert len(decoder.feed(frame(first))) == 1
    packets = decoder.feed(frame(first + updated))
    assert len(packets) == 1
    assert packets[0]["content_items"]["revision"] == 2
    assert packets[0]["references"] == [parent, comment]
    assert decoder.feed(frame(first + updated)) == []
    assert not decoder.done
    with pytest.raises(ValueError, match="immutable event changed"):
        decoder.feed(frame(public("event", event={**event, "text": "Alterado"}, references=[parent, comment])))


def test_reference_enrichment_cannot_change_an_existing_evidence_destination() -> None:
    decoder = NativeDecoder("turn-1")
    event = {"event_id": "event-1", "turn_id": "turn-1"}
    reference = {"evidence_id": "same", "url": "https://example.org/post"}
    decoder.feed(frame(public("event", event=event, references=[reference])))
    with pytest.raises(ValueError, match="evidence destination changed"):
        decoder.feed(frame(public("event", event=event, references=[{**reference, "url": "https://other.example.org/changed"}],
                                  content_items={"schema_version": "1.0", "revision": 2, "items": []})))


class SavedConnection:
    def __init__(self, endpoint: str = "https://gateway.aidp.us-chicago-1.oci.oraclecloud.com/agentendpoint/flow/chat"):
        self.endpoint = endpoint

    def connection(self, identity: str) -> tuple[Any, dict[str, str], bytes, str]:
        return AgentProfile(id="a" * 32, name="Agent", endpoint_host="", flow_id="flow",
                            region="us-chicago-1", profile="DEFAULT"), {"region": "us-chicago-1", "tenancy": "tenancy", "user": "user",
                      "fingerprint": "fingerprint"}, b"private-test-key", self.endpoint


def request(**values: Any) -> InvokeRequest:
    return InvokeRequest(request_id="turn-1", question="Pregunta", profile_id="a" * 32,
                         session_id="conversation-1", **values)


@pytest.mark.parametrize("endpoint", ["https://evil.example/agentendpoint/flow/chat",
    "http://gateway.aidp.us-chicago-1.oci.oraclecloud.com/agentendpoint/flow/chat",
    "https://gateway.aidp.us-chicago-1.oci.oraclecloud.com/agentendpoint/flow/chat?redirect=bad"])
def test_saved_endpoint_cannot_redirect_signer_to_another_origin(endpoint: str) -> None:
    with pytest.raises(ValueError, match="gateway"):
        AgentTransport(cast(ProfileStore, SavedConnection(endpoint)), request())


def test_signed_replay_uses_same_session_and_redacts_gateway_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class Response:
        status_code = 500
        headers = {"Content-Type": "text/event-stream"}

        def __enter__(self) -> "Response":
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def close(self) -> None:
            pass

    class Session:
        trust_env = True

        def post(self, endpoint: str, **kwargs: Any) -> Response:
            captured.update(kwargs)
            captured["trust_env"] = self.trust_env
            return Response()

        def close(self) -> None:
            captured["closed"] = True

    monkeypatch.setattr("app.features.desk.transport.requests.Session", Session)
    monkeypatch.setattr("app.features.desk.transport.oci.signer.Signer", lambda **kwargs: object())
    transport = AgentTransport(cast(ProfileStore, SavedConnection()), request(action="replay", after_sequence=7))
    packet = json.loads(list(transport.packets())[0])
    assert packet["kind"] == "transport_error"
    assert packet["code"] == "gateway_rejected"
    assert packet["session_id"] == "conversation-1"
    assert "private-test-key" not in json.dumps(packet)
    assert captured["allow_redirects"] is False
    assert captured["trust_env"] is False
    assert captured["closed"] is True
    payload = captured["json"]
    assert payload["sessionKey"] == "conversation-1"
    assert captured["headers"]["x-session-id"] == "conversation-1"
    assert json.loads(payload["input"][0]["content"][0]["text"]) == {
        "request_id": "turn-1", "action": "replay", "after_sequence": 7}


@pytest.mark.parametrize("action", ["research", "replay", "cancel"])
def test_test_transport_uses_validated_native_session_for_every_command(
    monkeypatch: pytest.MonkeyPatch, action: str,
) -> None:
    calls: dict[str, Any] = {}
    endpoint = "https://gateway.aidp.us-chicago-1.oci.oraclecloud.com/agentendpoint/flow_TEST/chat"

    class DevelopmentTarget:
        def __init__(self, *args: Any) -> None:
            pass

        def target(self) -> dict[str, Any]:
            return {"endpoint": endpoint}

        def conversation(self, store: Any, client_id: str, target: Any, create: bool) -> str:
            calls.update(client_id=client_id, create=create)
            return "validated-native-session"

    class Response:
        status_code = 200
        headers = {"Content-Type": "text/event-stream"}

        def __enter__(self) -> "Response":
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def __init__(self) -> None:
            self.chunks = iter([frame(public("response", request_id="turn-1", response={"markdown": "TEST real"}), "completed")])

        @property
        def raw(self) -> "Response":
            return self

        def read1(self, size: int, *, decode_content: bool) -> bytes:
            assert size == 8192 and decode_content
            return next(self.chunks, b"")

        def close(self) -> None:
            pass

    class Session:
        def post(self, selected: str, **kwargs: Any) -> Response:
            calls.update(endpoint=selected, **kwargs)
            return Response()

        def close(self) -> None:
            calls["closed"] = True

    monkeypatch.setattr("app.features.desk.transport.Development", DevelopmentTarget)
    monkeypatch.setattr("app.features.desk.transport.requests.Session", Session)
    monkeypatch.setattr("app.features.desk.transport.oci.signer.Signer", lambda **kwargs: object())
    transport = AgentTransport(cast(ProfileStore, SavedConnection()), request(surface="TEST", action=action))
    packets = [json.loads(line) for line in transport.packets()]
    assert packets[-1]["response"]["markdown"] == "TEST real"
    assert packets[-1]["session_id"] == "conversation-1"
    assert calls["endpoint"] == endpoint
    assert calls["headers"]["x-deployment-type"] == "TEST"
    assert calls["headers"]["x-session-id"] == "validated-native-session"
    assert calls["json"]["sessionId"] == "validated-native-session"
    assert calls["client_id"] == "conversation-1" and calls["create"] == (action == "research")
    assert calls["closed"] and calls["allow_redirects"] is False


@pytest.mark.parametrize("chunked", [False, True])
def test_small_native_event_arrives_before_upstream_completes(
    monkeypatch: pytest.MonkeyPatch, chunked: bool,
) -> None:
    from concurrent.futures import ThreadPoolExecutor
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from threading import Event, Thread

    from app.features.desk import transport as module

    release = Event()
    initial = frame(public("event", event={"event_id": "live", "turn_id": "turn-1", "text": "First live result"}))
    final = frame(public("response", request_id="turn-1", response={"status": "completed", "markdown": "Final"}), "completed")

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_POST(self) -> None:
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            if chunked:
                self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            for data in (initial, final):
                if data is final:
                    release.wait(5)
                self.wfile.write((f"{len(data):x}\r\n".encode() + data + b"\r\n") if chunked else data)
                self.wfile.flush()
            if chunked:
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            self.close_connection = True

        def log_message(self, *_args: Any) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    real_session = module.requests.Session()
    real_session.trust_env = False

    class Session:
        trust_env = False

        def post(self, endpoint: str, **kwargs: Any) -> Any:
            assert endpoint == SavedConnection().endpoint
            kwargs.pop("auth")
            return real_session.post(f"http://127.0.0.1:{server.server_port}/stream", **kwargs)

        def close(self) -> None:
            real_session.close()

    monkeypatch.setattr(module.requests, "Session", Session)
    monkeypatch.setattr(module.oci.signer, "Signer", lambda **kwargs: object())
    stream = AgentTransport(cast(ProfileStore, SavedConnection()), request()).packets()
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(next, stream)
            try:
                packet = json.loads(pending.result(timeout=2))
                assert packet["event"]["text"] == "First live result"
                assert not release.is_set()
            finally:
                release.set()
                pending.result(timeout=3)
        remaining = [json.loads(line) for line in stream]
        assert remaining[-1]["response"]["markdown"] == "Final"
    finally:
        release.set()
        stream.close()
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


def test_transient_text_survives_native_cumulative_frames_without_changing_durable_identity() -> None:
    decoder = NativeDecoder("turn-1")
    start = public("text", request_id="turn-1", turn_id="turn-1", stream_id="a" * 32,
                   phase="start", delta_index=0, text="")
    delta = public("text", request_id="turn-1", turn_id="turn-1", stream_id="a" * 32,
                   phase="delta", delta_index=1, text="Visible fragment")
    assert decoder.feed(frame(start))[0]["phase"] == "start"
    assert [packet["text"] for packet in decoder.feed(frame(start + delta))] == ["Visible fragment"]
    assert not decoder.done
    canonical = public("response", request_id="turn-1", response={"status": "completed", "markdown": "Canonical"})
    assert [packet["kind"] for packet in decoder.feed(frame(start + delta + canonical, "completed"))] == ["response"]
    assert decoder.finish() == []
    with pytest.raises(StreamFailure, match="otra solicitud"):
        NativeDecoder("turn-1").feed(frame(public("text", request_id="turn-1", turn_id="another")))


def test_transport_diagnostic_correlates_failure_without_logging_sensitive_content(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    from app.features.desk import transport as module

    class Session:
        def post(self, *args: Any, **kwargs: Any) -> Any:
            raise module.requests.exceptions.ReadTimeout("private-test-key secret-question endpoint-secret")

        def close(self) -> None:
            pass

    monkeypatch.setattr(module.requests, "Session", Session)
    monkeypatch.setattr(module.oci.signer, "Signer", lambda **kwargs: object())
    transport = AgentTransport(cast(ProfileStore, SavedConnection()), request())
    packets = [json.loads(line) for line in transport.packets()]
    assert packets[0]["code"] == "stream_interrupted"
    records = [r for r in caplog.records if r.message.startswith("AIDP stream failure ")]
    assert len(records) == 1
    diagnostic = json.loads(records[0].message.removeprefix("AIDP stream failure "))
    assert diagnostic["request_id"] == "turn-1"
    assert diagnostic["stage"] == "connect" and diagnostic["exception_type"] == "ReadTimeout"
    assert diagnostic["received_bytes"] == 0 and not diagnostic["has_response"]
    assert diagnostic["elapsed_ms"] >= 0 and diagnostic["at_unix_ms"] > 0
    for private in ("private-test-key", "secret-question", "endpoint-secret", "conversation-1"):
        assert private not in caplog.text
        if private != "conversation-1":
            assert private not in json.dumps(packets)
