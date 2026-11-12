"""Bounded microphone transcription and speech using the saved OCI profile."""

from collections.abc import Iterator
from email.utils import formatdate
from typing import Annotated, Any
from urllib.parse import urlencode

import oci  # type: ignore[import-untyped]
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse
from oci._vendor import requests  # type: ignore[import-untyped]
from pydantic import BaseModel, ConfigDict, Field

from app.core.access import require_profile
from app.core.local_config import local_configuration

from .credentials import ProfileStore

MAX_AUDIO = 8 * 1024 * 1024
AUDIO_TYPES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/mpeg"}


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    profile_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    text: str = Field(min_length=1, max_length=15000)


class RealtimeSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_id: str = Field(pattern=r"^[a-f0-9]{32}$")


class AudioService:
    def __init__(self, store: ProfileStore) -> None:
        self.store = store

    def context(self, identity: str) -> tuple[Any, dict[str, str], Any]:
        try:
            profile, values, key, _ = self.store.connection(identity)
        except ValueError as error:
            raise HTTPException(422, "Selecciona una conexión válida guardada.") from error
        signer = oci.signer.Signer(
            tenancy=values["tenancy"],
            user=values["user"],
            fingerprint=values["fingerprint"],
            private_key_file_location=None,
            private_key_content=key.decode(),
        )
        return profile, values, signer

    def realtime_session(self, identity: str) -> dict[str, Any]:
        profile, values, signer = self.context(identity)
        if profile.transcription_model != "oci.speech.whisper.es":
            raise HTTPException(
                422,
                "Selecciona OCI Speech Whisper en Audio y guarda la configuración.",
                headers={"X-Agent-Desk-Notice": "audio-configuration"},
            )
        host = f"realtime.aiservice.{values['region']}.oci.oraclecloud.com"
        query = urlencode(
            {
                "modelType": "WHISPER",
                "languageCode": "es",
                "modelDomain": "GENERIC",
                "encoding": "audio/raw;rate=16000",
            }
        )
        uri = f"https://{host}/ws/transcribe/stream?{query}"
        prepared = requests.Request(
            "GET",
            uri,
            headers={
                "date": formatdate(usegmt=True),
                "host": host,
            },
        ).prepare()
        signer(prepared)
        socket_uri = uri.replace("https://", "wss://", 1)
        return {
            "mode": "realtime",
            "url": socket_uri,
            "sample_rate": 16000,
            "encoding": "audio/raw;rate=16000",
            "authentication": {
                "authenticationType": "CREDENTIALS",
                "headers": {
                    "date": prepared.headers["date"],
                    "host": host,
                    "authorization": prepared.headers["authorization"],
                    "uri": socket_uri,
                },
                "compartmentId": profile.compartment_id,
            },
        }

    def transcribe(self, identity: str, content: bytes, mime: str) -> dict[str, str]:
        raise HTTPException(
            422,
            "El dictado usa OCI Speech en vivo. Configura Whisper y vuelve a iniciar el micrófono.",
            headers={"X-Agent-Desk-Notice": "audio-configuration"},
        )

    def speech(self, request: SpeechRequest) -> bytes | StreamingResponse:
        profile, values, signer = self.context(request.profile_id)
        if profile.speech_model != "oci.speech.carmen.es-ES":
            raise HTTPException(
                422,
                "Selecciona OCI Speech Carmen Natural en Audio y guarda la configuración.",
                headers={"X-Agent-Desk-Notice": "audio-configuration"},
            )
        models = oci.ai_speech.models
        client = oci.ai_speech.AIServiceSpeechClient(
            {**values, "key_file": "server-managed"},
            signer=signer,
            timeout=(10, 120),
            retry_strategy=oci.retry.NoneRetryStrategy(),
        )
        details = models.SynthesizeSpeechDetails(
            text=request.text,
            compartment_id=profile.compartment_id,
            is_stream_enabled=True,
            configuration=models.TtsOracleConfiguration(
                model_details=models.TtsOracleTts2NaturalModelDetails(
                    voice_id="Carmen",
                    language_code="es-ES",
                ),
                speech_settings=models.TtsOracleSpeechSettings(
                    text_type="TEXT",
                    sample_rate_in_hz=24000,
                    output_format="MP3",
                ),
            ),
        )
        try:
            response = client.synthesize_speech(details)
        except (oci.exceptions.ServiceError, requests.RequestException) as error:
            raise HTTPException(
                502, "No se pudo generar audio con OCI Speech. Revisa los permisos de la conexión."
            ) from error

        def chunks() -> Iterator[bytes]:
            try:
                yield from response.data.iter_content(65536)
            finally:
                response.data.close()

        return StreamingResponse(chunks(), media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


def audio_router(store: ProfileStore) -> APIRouter:
    router = APIRouter(dependencies=[Depends(local_configuration)])
    service = AudioService(store)

    @router.post("/audio/realtime-session", operation_id="desk_audio_realtime_session")
    def realtime_session(request: RealtimeSessionRequest, http_request: Request) -> JSONResponse:
        require_profile(http_request, request.profile_id)
        return JSONResponse(
            service.realtime_session(request.profile_id), headers={"Cache-Control": "no-store"}
        )

    @router.post("/audio/transcribe", operation_id="desk_audio_transcribe")
    async def transcribe(
        request: Request,
        profile_id: Annotated[str, Form(pattern=r"^[a-f0-9]{32}$")],
        audio: Annotated[UploadFile, File()],
    ) -> dict[str, str]:
        import anyio

        try:
            require_profile(request, profile_id)
            mime = (audio.content_type or "").split(";")[0]
            if mime not in AUDIO_TYPES:
                raise HTTPException(422, "Formato de audio no compatible.")
            data = await audio.read(MAX_AUDIO + 1)
            if not data or len(data) > MAX_AUDIO:
                raise HTTPException(422, "Graba un audio de hasta 8 MiB.")
            return await anyio.to_thread.run_sync(service.transcribe, profile_id, data, mime)
        finally:
            await audio.close()

    @router.post("/audio/speech", operation_id="desk_audio_speech")
    def speech(request: SpeechRequest, http_request: Request) -> Response:
        require_profile(http_request, request.profile_id)
        result = service.speech(request)
        if isinstance(result, Response):
            return result
        return Response(result, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})

    return router
