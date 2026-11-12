from collections.abc import AsyncIterator
from typing import Annotated

import anyio
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.core.access import require_profile, visible_profiles
from app.core.local_config import local_configuration

from .audio import audio_router
from .credentials import ProfileStore
from .discovery_api import discovery_router
from .invocation_scope import invocation_scope
from .scheduled_api import scheduled_router
from .scheduled_runtime import ScheduledRuntime
from .schemas import AgentProfile, ConnectionStatus, InvokeRequest
from .service import connection_status
from .suggestions import suggestions_router
from .transport import AgentTransport


def create_router(store: ProfileStore, scheduled: ScheduledRuntime | None = None) -> APIRouter:
    router = APIRouter(prefix="/api/desk", tags=["desk"])
    router.include_router(discovery_router(store))
    router.include_router(audio_router(store))
    router.include_router(suggestions_router(store))
    if scheduled is not None:
        router.include_router(scheduled_router(scheduled))

    @router.get("/connection", response_model=ConnectionStatus, operation_id="desk_connection")
    def connection(request: Request) -> ConnectionStatus:
        return connection_status(bool(visible_profiles(request, store.list())))

    @router.get("/profiles", response_model=list[AgentProfile], operation_id="desk_profiles")
    def profiles(request: Request) -> list[AgentProfile]:
        return visible_profiles(request, store.list())

    @router.post(
        "/profiles",
        response_model=AgentProfile,
        status_code=201,
        operation_id="desk_profile_create",
        dependencies=[Depends(local_configuration)],
    )
    async def create_profile(
        name: Annotated[str, Form(min_length=1, max_length=80)],
        endpoint: Annotated[str, Form(min_length=1, max_length=2048)],
        flow_id: Annotated[str, Form(min_length=1, max_length=256)],
        config: Annotated[UploadFile, File()],
        key: Annotated[UploadFile, File()],
        profile: Annotated[str, Form(min_length=1, max_length=80)] = "DEFAULT",
    ) -> AgentProfile:
        try:
            if store.connection_managed:
                raise HTTPException(403, "Agrega agentes desde el catálogo de la conexión del despliegue.")
            return store.create(
                name.strip(),
                endpoint.strip(),
                flow_id.strip(),
                profile.strip(),
                await config.read(65537),
                await key.read(16385),
            )
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        finally:
            await config.close()
            await key.close()

    @router.delete(
        "/profiles/{identity}",
        status_code=204,
        operation_id="desk_profile_delete",
        dependencies=[Depends(local_configuration)],
    )
    def delete_profile(identity: str) -> None:
        if not store.delete(identity):
            raise HTTPException(404, "Agente no encontrado")

    @router.post(
        "/stream",
        operation_id="desk_stream",
        dependencies=[Depends(local_configuration)],
        response_class=StreamingResponse,
        responses={200: {"content": {"application/x-ndjson": {}}, "description": "Public agent packets"}},
    )
    def stream(value: InvokeRequest, request: Request) -> StreamingResponse:
        value = require_invocation_target(request, value, store, scheduled)
        value, restore = invocation_scope(request, value)
        try:
            transport = AgentTransport(store, value)
        except (ValueError, OSError, KeyError) as error:
            raise HTTPException(422, "Selecciona una conexión AIDP guardada y una sesión válida.") from error

        async def delivery() -> AsyncIterator[bytes]:
            iterator = transport.packets()
            try:
                while True:
                    chunk = await anyio.to_thread.run_sync(
                        lambda: next(iterator, None), abandon_on_cancel=True
                    )
                    if chunk is None:
                        break
                    yield restore(chunk)
            finally:
                # A client disconnect releases the HTTP stream; only an explicit command cancels research.
                with anyio.CancelScope(shield=True):
                    await anyio.to_thread.run_sync(transport.close)

        return StreamingResponse(
            delivery(),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
        )

    return router


def require_invocation_target(request: Request, value: InvokeRequest, store: ProfileStore,
                              scheduled: ScheduledRuntime | None) -> InvokeRequest:
    require_profile(request, value.profile_id)
    if any(p.id == value.profile_id and p.surface == "TEST" for p in store.list()):
        value = value.model_copy(update={"surface": "TEST"})
    if (getattr(request.app.state, "identity", None) is not None
            and value.surface == "TEST" and request.state.principal["role"] != "admin"):
        raise HTTPException(403, "El modo TEST requiere permiso de administrador.")
    if value.delivery is not None and (scheduled is None or not scheduled.supported(
        scheduled.target_id(value.profile_id, value.surface)
    )):
        raise HTTPException(403, "Este agente no declara la capacidad de informes.")
    return value
