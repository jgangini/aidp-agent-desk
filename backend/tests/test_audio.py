import pytest
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from app.features.desk.audio import AudioService
from app.main import app

HEADERS = {"Origin": "http://127.0.0.1:8317", "X-Agent-Desk": "configure"}
IDENTITY = "a" * 32


def test_audio_requires_local_origin_and_bounded_upload(monkeypatch: MonkeyPatch) -> None:
    calls: list[tuple[str, bytes, str]] = []

    def transcribe(self, identity, content, mime):  # type: ignore[no-untyped-def]
        calls.append((identity, content, mime))
        return {"text": "Una consulta real"}

    monkeypatch.setattr(AudioService, "transcribe", transcribe)
    with TestClient(app) as client:
        files = {"audio": ("voice.webm", b"microphone", "audio/webm")}
        assert (
            client.post("/api/desk/audio/transcribe", data={"profile_id": IDENTITY}, files=files).status_code
            == 403
        )
        response = client.post(
            "/api/desk/audio/transcribe", headers=HEADERS, data={"profile_id": IDENTITY}, files=files
        )
        assert response.json() == {"text": "Una consulta real"}
        assert calls == [(IDENTITY, b"microphone", "audio/webm")]
        assert (
            client.post(
                "/api/desk/audio/transcribe",
                headers=HEADERS,
                data={"profile_id": IDENTITY},
                files={"audio": ("bad", b"x", "text/html")},
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/desk/audio/transcribe",
                headers=HEADERS,
                data={"profile_id": IDENTITY},
                files={"audio": ("empty", b"", "audio/webm")},
            ).status_code
            == 422
        )
        assert len(calls) == 1


def test_speech_uses_saved_profile_and_returns_uncached_audio(monkeypatch: MonkeyPatch) -> None:
    seen = []

    def speech(self, request):  # type: ignore[no-untyped-def]
        seen.append((request.profile_id, request.text))
        return b"ID3audio"

    monkeypatch.setattr(AudioService, "speech", speech)
    with TestClient(app) as client:
        payload = {"profile_id": IDENTITY, "text": "Respuesta del agente"}
        assert client.post("/api/desk/audio/speech", json=payload).status_code == 403
        response = client.post("/api/desk/audio/speech", headers=HEADERS, json=payload)
        assert response.content == b"ID3audio"
        assert response.headers["content-type"] == "audio/mpeg"
        assert response.headers["cache-control"] == "no-store"
        assert seen == [(IDENTITY, "Respuesta del agente")]
        assert (
            client.post(
                "/api/desk/audio/speech", headers=HEADERS, json={**payload, "endpoint": "http://localhost"}
            ).status_code
            == 422
        )


def test_realtime_session_is_protected_and_uncached(monkeypatch: MonkeyPatch) -> None:
    calls = []

    def realtime_session(self, identity):  # type: ignore[no-untyped-def]
        calls.append(identity)
        return {"mode": "realtime"}

    monkeypatch.setattr(AudioService, "realtime_session", realtime_session)
    with TestClient(app) as client:
        payload = {"profile_id": IDENTITY}
        assert client.post("/api/desk/audio/realtime-session", json=payload).status_code == 403
        response = client.post("/api/desk/audio/realtime-session", headers=HEADERS, json=payload)
        assert response.json() == {"mode": "realtime"}
        assert response.headers["cache-control"] == "no-store"
        assert calls == [IDENTITY]
        assert (
            client.post(
                "/api/desk/audio/realtime-session",
                headers=HEADERS,
                json={**payload, "endpoint": "https://untrusted.example"},
            ).status_code
            == 422
        )


def test_realtime_session_signs_fixed_native_endpoint(monkeypatch: MonkeyPatch) -> None:
    from types import SimpleNamespace
    from urllib.parse import parse_qs, urlparse

    service = AudioService(None)  # type: ignore[arg-type]
    profile = SimpleNamespace(transcription_model="oci.speech.whisper.es", compartment_id="comp")
    captured = []

    def signer(prepared):  # type: ignore[no-untyped-def]
        captured.append(prepared)
        prepared.headers["authorization"] = "Signature signed-request"

    monkeypatch.setattr(service, "context", lambda _: (profile, {"region": "us-chicago-1"}, signer))
    result = service.realtime_session(IDENTITY)
    prepared = captured[0]
    assert prepared.method == "GET"
    parsed = urlparse(prepared.url)
    assert parsed.scheme == "https"
    assert parsed.netloc == "realtime.aiservice.us-chicago-1.oci.oraclecloud.com"
    assert parsed.path == "/ws/transcribe/stream"
    assert parse_qs(parsed.query) == {
        "modelType": ["WHISPER"],
        "languageCode": ["es"],
        "modelDomain": ["GENERIC"],
        "encoding": ["audio/raw;rate=16000"],
    }
    assert result["url"] == prepared.url.replace("https://", "wss://", 1)
    assert result["sample_rate"] == 16000
    assert result["authentication"] == {
        "authenticationType": "CREDENTIALS",
        "compartmentId": "comp",
        "headers": {
            "date": prepared.headers["date"],
            "host": parsed.netloc,
            "authorization": "Signature signed-request",
            "uri": result["url"],
        },
    }
    assert "private_key" not in str(result)
    profile.transcription_model = "google.gemini-2.5-flash"
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as legacy:
        service.realtime_session(IDENTITY)
    assert legacy.value.status_code == 422
    assert "Whisper" in legacy.value.detail
    assert len(captured) == 1


def test_native_speech_streams_sdk_chunks_and_closes_response(monkeypatch: MonkeyPatch) -> None:
    from types import SimpleNamespace

    import oci

    captured = []
    reads = []
    closed = []
    profile = SimpleNamespace(speech_model="oci.speech.carmen.es-ES", compartment_id="comp")
    monkeypatch.setattr(AudioService, "context", lambda *_: (profile, {"region": "us-chicago-1"}, object()))

    class Stream:
        def iter_content(self, size):  # type: ignore[no-untyped-def]
            reads.append(size)
            yield b"ID3"
            yield b"native-audio"

        def close(self):  # type: ignore[no-untyped-def]
            closed.append(True)

    class Client:
        def __init__(self, config, **kwargs):  # type: ignore[no-untyped-def]
            assert config["region"] == "us-chicago-1"
            assert "signer" in kwargs

        def synthesize_speech(self, details):  # type: ignore[no-untyped-def]
            captured.append(details)
            assert reads == []
            return SimpleNamespace(data=Stream())

    monkeypatch.setattr(oci.ai_speech, "AIServiceSpeechClient", Client)
    with TestClient(app) as client:
        response = client.post(
            "/api/desk/audio/speech",
            headers=HEADERS,
            json={"profile_id": IDENTITY, "text": "Hola, ¿cómo estás?"},
        )
    assert response.status_code == 200
    assert response.content == b"ID3native-audio"
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["cache-control"] == "no-store"
    assert reads == [65536]
    assert closed == [True]
    details = captured[0]
    assert details.text == "Hola, ¿cómo estás?"
    assert details.compartment_id == "comp"
    assert details.is_stream_enabled is True
    assert details.configuration.model_details.model_name == "TTS_2_NATURAL"
    assert details.configuration.model_details.voice_id == "Carmen"
    assert details.configuration.model_details.language_code == "es-ES"
    assert details.configuration.speech_settings.output_format == "MP3"
    assert details.configuration.speech_settings.sample_rate_in_hz == 24000


def test_native_speech_sanitizes_upstream_failure(monkeypatch: MonkeyPatch) -> None:
    from types import SimpleNamespace

    import oci
    from fastapi import HTTPException

    from app.features.desk.audio import SpeechRequest

    profile = SimpleNamespace(speech_model="oci.speech.carmen.es-ES", compartment_id="comp")
    service = AudioService(None)  # type: ignore[arg-type]
    monkeypatch.setattr(service, "context", lambda _: (profile, {"region": "us-chicago-1"}, object()))

    class Client:
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            pass

        def synthesize_speech(self, details):  # type: ignore[no-untyped-def]
            raise oci.exceptions.ServiceError(403, "NotAuthorized", {}, "private details")

    monkeypatch.setattr(oci.ai_speech, "AIServiceSpeechClient", Client)
    with pytest.raises(HTTPException) as caught:
        service.speech(SpeechRequest(profile_id=IDENTITY, text="Hola"))
    assert caught.value.status_code == 502
    assert "permisos" in caught.value.detail
    assert "private" not in caught.value.detail


@pytest.mark.parametrize("model", ["google.gemini-2.5-flash", "xai.grok-tts", "", "oci.speech.whisper.es"])
def test_legacy_audio_and_batch_never_invoke_genai(monkeypatch: MonkeyPatch, model: str) -> None:
    from types import SimpleNamespace

    import oci
    from fastapi import HTTPException

    from app.features.desk.audio import SpeechRequest

    service = AudioService(None)  # type: ignore[arg-type]
    profile = SimpleNamespace(transcription_model=model, speech_model=model, compartment_id="comp")
    monkeypatch.setattr(service, "context", lambda _: (profile, {"region": "us-chicago-1"}, object()))
    blocked = []

    def forbidden(*args, **kwargs):  # type: ignore[no-untyped-def]
        blocked.append(True)
        raise AssertionError("Generative AI audio must not be called")

    monkeypatch.setattr(oci.generative_ai_inference, "GenerativeAiInferenceClient", forbidden)
    monkeypatch.setattr("app.features.desk.audio.requests.Session", forbidden)
    with pytest.raises(HTTPException) as batch:
        service.transcribe(IDENTITY, b"pcm", "audio/wav")
    assert batch.value.status_code == 422
    assert "Whisper" in batch.value.detail
    with pytest.raises(HTTPException) as speech:
        service.speech(SpeechRequest(profile_id=IDENTITY, text="Hola"))
    assert speech.value.status_code == 422
    assert "Carmen" in speech.value.detail
    assert blocked == []


def test_audio_configuration_notice_header_is_not_used_for_validation_errors(
    monkeypatch: MonkeyPatch,
) -> None:
    from types import SimpleNamespace

    profile = SimpleNamespace(transcription_model="", speech_model="")
    monkeypatch.setattr(AudioService, "context", lambda *_: (profile, {}, object()))
    with TestClient(app) as client:
        for path, payload in [
            ("realtime-session", {"profile_id": IDENTITY}),
            ("speech", {"profile_id": IDENTITY, "text": "Hola"}),
        ]:
            response = client.post(f"/api/desk/audio/{path}", headers=HEADERS, json=payload)
            assert response.status_code == 422
            assert response.headers["X-Agent-Desk-Notice"] == "audio-configuration"
        invalid = client.post(
            "/api/desk/audio/speech", headers=HEADERS, json={"profile_id": IDENTITY, "text": ""}
        )
        assert invalid.status_code == 422
        assert "X-Agent-Desk-Notice" not in invalid.headers
