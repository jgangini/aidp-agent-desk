"""Signed AIDP invocation; native assistant output is the only public content source."""

import hashlib
import json
import logging
import time
from collections.abc import Iterator
from threading import Event, Lock
from typing import Any
from urllib.parse import urlsplit

import oci  # type: ignore[import-untyped]
from oci._vendor import requests  # type: ignore[import-untyped]

from .credentials import ProfileStore
from .development import Development, DevelopmentError
from .schemas import InvokeRequest


class StreamFailure(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class NativeDecoder:
    """Decode bounded SSE frames and deduplicate cumulative public NDJSON messages."""

    def __init__(self, request_id: str, require_response: bool = True, require_public: bool = False) -> None:
        self.request_id = request_id
        self.require_response = require_response
        self.require_public = require_public
        self.buffer = b""
        self.data: list[bytes] = []
        self.total = 0
        self.frame_size = 0
        self.frames = 0
        self.done = False
        self.has_response = False
        self.seen: set[str] = set()
        self.event_identities: dict[str, str] = {}
        self.reference_destinations: dict[str, str] = {}
        self.texts: dict[str, str] = {}
        self.public = False
        self.public_counts: dict[str, int] = {}

    def feed(self, chunk: bytes) -> list[dict[str, Any]]:
        self.total += len(chunk)
        self.buffer += chunk
        if self.total > 32 * 1024 * 1024:
            raise ValueError("Native stream size limit")
        packets: list[dict[str, Any]] = []
        while b"\n" in self.buffer:
            line, self.buffer = self.buffer.split(b"\n", 1)
            line = line.rstrip(b"\r")
            self.frame_size += len(line)
            if self.frame_size > 8 * 1024 * 1024:
                raise ValueError("Native frame size limit")
            if not line:
                packets.extend(self._event())
                self.data = []
                self.frame_size = 0
            elif line.startswith(b"data:"):
                self.data.append(line[5:].removeprefix(b" "))
        if len(self.buffer) + self.frame_size > 8 * 1024 * 1024:
            raise ValueError("Native frame size limit")
        return packets

    def _event(self) -> list[dict[str, Any]]:
        if not self.data:
            return []
        self.frames += 1
        if self.frames > 4096:
            raise ValueError("Native event count limit")
        raw = b"\n".join(self.data)
        if raw.strip() == b"[DONE]":
            self.done = True
            return []
        event = json.loads(raw)
        if not isinstance(event, dict):
            raise ValueError("Invalid native event")
        response = event.get("response") or {}
        if not isinstance(response, dict):
            raise ValueError("Invalid native response")
        if event.get("error") or event.get("type") == "error" or response.get("status") in {
            "failed", "error", "incomplete", "cancelled", "canceled"
        }:
            raise StreamFailure("native_execution_error", "El Agent Flow no pudo completar la ejecución.")
        packets = self._assistant_packets(response.get("output", []))
        if event.get("type") == "response.completed" or response.get("status") == "completed":
            self.done = True
        return packets

    def _assistant_packets(self, output: Any) -> list[dict[str, Any]]:
        packets = []
        if not isinstance(output, list) or len(output) > 256:
            raise ValueError("Invalid native output")
        for index, message in enumerate(output):
            if not isinstance(message, dict) or message.get("role") != "assistant":
                continue
            if message.get("status") in {"failed", "incomplete", "cancelled", "canceled"}:
                raise ValueError("Incomplete native assistant message")
            content = message.get("content", [])
            if not isinstance(content, list) or len(content) > 256:
                raise ValueError("Invalid native assistant content")
            for part_index, part in enumerate(content):
                if isinstance(part, dict) and part.get("type") == "output_text":
                    text = part.get("text")
                    if not isinstance(text, str):
                        raise ValueError("Invalid native assistant text")
                    key = f"{message.get('id', index)}:{part_index}"
                    self.texts[key] = text
                    packets.extend(self._public_packets(text))
        return packets

    def _public_packets(self, text: str) -> list[dict[str, Any]]:
        # Native frames may carry an incomplete last line; only parse complete public lines.
        if not text.lstrip().startswith('{"protocol"'):
            return []
        self.public = True
        packets = []
        for line in text.splitlines(keepends=True):
            if not line.endswith(("\n", "\r")):
                continue
            if len(line.encode()) > 2 * 1024 * 1024:
                raise ValueError("Public packet size limit")
            packet = self._parse_packet(line)
            self._remember_event(packet)
            self._remember_references(packet)
            signature = self._signature(packet)
            if signature in self.seen:
                continue
            self.seen.add(signature)
            self.public_counts[packet["kind"]] = self.public_counts.get(packet["kind"], 0) + 1
            self.has_response |= packet["kind"] in {"response", "snapshot"}
            packets.append(packet)
        return packets

    def _parse_packet(self, line: str) -> dict[str, Any]:
        packet = json.loads(line)
        if not isinstance(packet, dict) or packet.get("protocol") != "ai-market-intelligence" or (
            packet.get("version") != "2.0"
            or packet.get("kind") not in {"event", "response", "snapshot", "heartbeat", "text"}
        ):
            raise ValueError("Unsupported public protocol")
        identity = packet.get("event", {}).get("turn_id") if packet["kind"] == "event" else packet.get("request_id")
        if identity is not None and identity != self.request_id:
            raise StreamFailure("request_mismatch", "AIDP devolvió datos de otra solicitud. No se mezcló la respuesta; recupera la solicitud original.")
        if packet["kind"] == "text" and (identity != self.request_id or packet.get("turn_id") != self.request_id):
            raise StreamFailure("request_mismatch", "AIDP devolvió datos de otra solicitud. No se mezcló la respuesta; recupera la solicitud original.")
        return packet

    @staticmethod
    def _signature(value: Any) -> str:
        return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def _remember_event(self, packet: dict[str, Any]) -> None:
        if packet["kind"] != "event":
            return
        event = packet.get("event")
        if not isinstance(event, dict):
            raise ValueError("Invalid public event")
        identity = str(event.get("event_id") or self._signature(event))
        signature = self._signature(event)
        prior = self.event_identities.get(identity)
        if prior is not None and prior != signature:
            raise ValueError("Public immutable event changed")
        # The event is immutable; versioned sibling capabilities may change independently.
        self.event_identities[identity] = signature

    def _remember_references(self, packet: dict[str, Any]) -> None:
        response = packet.get("response") or {}
        if not isinstance(response, dict):
            raise ValueError("Invalid public response")
        for manifest in (packet.get("references", []), response.get("references", [])):
            if not isinstance(manifest, list) or len(manifest) > 800:
                raise ValueError("Invalid public references")
            for reference in manifest:
                if not isinstance(reference, dict):
                    raise ValueError("Invalid public reference")
                identity, url = reference.get("evidence_id"), reference.get("url")
                if not isinstance(identity, str) or not isinstance(url, str):
                    raise ValueError("Invalid public reference")
                prior = self.reference_destinations.get(identity)
                if prior is not None and prior != url:
                    raise ValueError("Public evidence destination changed")
                self.reference_destinations[identity] = url

    def finish(self) -> list[dict[str, Any]]:
        if self.buffer.strip() or self.data or not self.done:
            raise ValueError("Native stream ended prematurely")
        if self.public:
            if self.require_response and not self.has_response:
                raise ValueError("Native stream missing public response")
            for text in self.texts.values():
                if text.lstrip().startswith('{"protocol"') and not text.endswith("\n"):
                    raise ValueError("Incomplete public packet")
            return []
        if self.require_public:
            raise StreamFailure("unsupported_output", "El agente TEST no entregó una respuesta en el formato esperado.")
        markdown = "\n\n".join(self.texts.values()).strip()
        if not markdown or len(markdown) > 100000:
            raise StreamFailure("unsupported_output", "El Agent Flow no entregó una respuesta de texto compatible.")
        # Ordinary Agent Flows have no public tool manifest. Never invent sources or metrics.
        return [{"protocol": "ai-market-intelligence", "version": "2.0", "kind": "response",
                 "request_id": self.request_id, "response": {"status": "completed", "markdown": markdown,
                                                            "references": [], "artifacts": []}}]


def transport_failure(error: Exception) -> StreamFailure:
    return (error if isinstance(error, StreamFailure) else StreamFailure("test_unavailable", str(error))
            if isinstance(error, DevelopmentError) else StreamFailure(
        "stream_interrupted", "No se pudo completar el streaming de AIDP. Recupera la misma solicitud con replay."
    ))


def verify_stream_response(response: Any) -> None:
    if response.status_code != 200:
        raise StreamFailure("gateway_rejected", f"AIDP rechazó la solicitud (HTTP {response.status_code}).")
    if "text/event-stream" not in response.headers.get("Content-Type", "").lower():
        raise StreamFailure("unsupported_transport", "El gateway AIDP no devolvió streaming SSE.")


def invocation_payload(value: InvokeRequest) -> dict[str, Any]:
    command: dict[str, Any] = {"request_id": value.request_id}
    if value.action == "research":
        command["question"] = value.question
        if value.delivery is not None:
            command["delivery"] = value.delivery.model_dump(exclude_none=True)
            if len(json.dumps(command, ensure_ascii=False).encode()) > 65536:
                raise ValueError("La plantilla supera el límite de entrada del agente.")
    else:
        command["action"] = value.action
        if value.action == "replay":
            command["after_sequence"] = value.after_sequence
    payload = {"isStreamEnabled": True, "trace": False,
               "input": [{"role": "user", "content": [{"type": "INPUT_TEXT", "text": json.dumps(command)}]}],
               "metadata": {}, "sessionId": value.session_id, "session_id": value.session_id,
               "sessionKey": value.session_id}
    return payload


class AgentTransport:
    def __init__(self, store: ProfileStore, value: InvokeRequest) -> None:
        self.store = store
        self.value = value
        self.metadata, self.credentials, self.key, self.endpoint = store.connection(value.profile_id)
        target = urlsplit(self.endpoint)
        expected_host = f"gateway.aidp.{self.credentials['region']}.oci.oraclecloud.com"
        if (target.scheme != "https" or target.hostname != expected_host or target.username or target.password
                or target.port or target.query or target.fragment
                or not target.path.startswith("/agentendpoint/") or not target.path.endswith("/chat")):
            raise ValueError("El endpoint guardado no es un gateway de chat AIDP de la región seleccionada.")
        if not value.session_id:
            raise ValueError("Se requiere una sesión estable para conversar con el agente.")
        self.stopped = Event()
        self.lock = Lock()
        self.response: Any = None
        self.deadline_seconds = 600

    def close(self) -> None:
        self.stopped.set()
        with self.lock:
            response = self.response
        if response is not None:
            response.close()

    def packets(self) -> Iterator[bytes]:
        value = self.value
        payload = invocation_payload(value)
        surface = "TEST" if value.surface == "TEST" or self.metadata.surface == "TEST" else "PROD"
        decoder = NativeDecoder(value.request_id, require_response=value.action != "replay", require_public=surface == "TEST")
        session = requests.Session()
        # Avoid ambient proxy credentials or redirecting a signed request to another origin.
        session.trust_env = False
        diagnostic_started = time.monotonic()
        stage = "prepare"
        try:
            signer = oci.signer.Signer(tenancy=self.credentials["tenancy"], user=self.credentials["user"],
                                      fingerprint=self.credentials["fingerprint"], private_key_file_location=None,
                                      private_key_content=self.key.decode())
            development = Development(self.metadata, session, signer) if surface == "TEST" else None
            target = development.target() if development else None
            native_session = value.session_id
            if development and target:
                self.endpoint = target["endpoint"]
                native_session = development.conversation(self.store, value.session_id, target, value.action == "research")
                payload.update(sessionId=native_session, session_id=native_session, sessionKey=native_session)
            if self.stopped.is_set():
                return
            stage = "connect"
            started = time.monotonic()
            with session.post(self.endpoint, auth=signer, json=payload,
                              headers={"Accept": "text/event-stream", "Accept-Encoding": "identity",
                                       "x-session-id": native_session, "x-deployment-type": surface},
                              stream=True, allow_redirects=False,
                              timeout=(10, 45)) as response:
                with self.lock:
                    self.response = response
                if self.stopped.is_set():
                    return
                verify_stream_response(response)
                stage = "stream"
                logging.getLogger("uvicorn.error").info("AIDP stream start %s", json.dumps({
                    "request_id": value.request_id,
                    "session_hash": hashlib.sha256(value.session_id.encode()).hexdigest()[:12],
                    "action": value.action,
                }, separators=(",", ":")))
                yield from self._read_packets(response, decoder, started)
                if self.stopped.is_set():
                    return
                stage = "validate"
                for packet in decoder.finish():
                    yield self._line(packet)
                if development and target != development.target():
                    raise DevelopmentError("TEST cambió durante la ejecución. Revisa la revisión antes de continuar.")
                logging.getLogger("uvicorn.error").info("AIDP stream complete %s", json.dumps({
                    "request_id": value.request_id, "native_frames": decoder.frames,
                    "received_bytes": decoder.total, "public_packets": decoder.public_counts,
                    "elapsed_ms": round((time.monotonic() - diagnostic_started) * 1000),
                }, separators=(",", ":")))
        except Exception as error:
            if not self.stopped.is_set():
                safe = transport_failure(error)
                logging.getLogger(__name__).warning("AIDP stream failure %s", json.dumps({
                    "request_id": value.request_id,
                    "session_hash": hashlib.sha256(value.session_id.encode()).hexdigest()[:12],
                    "action": value.action, "stage": stage, "code": safe.code,
                    "exception_type": type(error).__name__, "elapsed_ms": round((time.monotonic() - diagnostic_started) * 1000),
                    "received_bytes": decoder.total, "native_frames": decoder.frames,
                    "has_response": decoder.has_response, "at_unix_ms": round(time.time() * 1000),
                }, separators=(",", ":")))
                yield self._line({"kind": "transport_error", "code": safe.code, "message": str(safe),
                                  "request_id": value.request_id})
        finally:
            with self.lock:
                self.response = None
            session.close()

    def _read_packets(self, response: Any, decoder: NativeDecoder, started: float) -> Iterator[bytes]:
        # read1 returns available bytes; read/iter_content may wait to fill 8 KB on non-chunked SSE.
        for chunk in iter(lambda: response.raw.read1(8192, decode_content=True), b""):
            if self.stopped.is_set():
                return
            if time.monotonic() - started > self.deadline_seconds:
                raise StreamFailure("deadline", "La respuesta superó el tiempo de entrega permitido.")
            for packet in decoder.feed(chunk):
                yield self._line(packet)

    def _line(self, packet: dict[str, Any]) -> bytes:
        return (json.dumps({**packet, "session_id": self.value.session_id}, ensure_ascii=False,
                           allow_nan=False, separators=(",", ":")) + "\n").encode()
