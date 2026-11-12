import json
from typing import Annotated, Literal

import oci  # type: ignore[import-untyped]
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.local_config import local_configuration

from .credentials import ProfileStore
from .discovery import Discovery, DiscoveryQueryError, credential_profiles
from .schemas import AgentProfile, ClearDraftRequest, DiscoveryDraft, DiscoveryOptions, DiscoveryProfiles


async def uploads(
    config: Annotated[UploadFile | None, File()] = None,
    key: Annotated[UploadFile | None, File()] = None,
) -> tuple[bytes, bytes] | None:
    try:
        if config is None and key is None:
            return None
        if config is None or key is None:
            raise HTTPException(422, "Selecciona config y key.pem juntos.")
        return await config.read(65537), await key.read(16385)
    finally:
        if config is not None:
            await config.close()
        if key is not None:
            await key.close()


def discovery_credentials(
    store: ProfileStore, files: tuple[bytes, bytes] | None, profile: str = ""
) -> tuple[bytes, bytes, str]:
    if files is not None:
        if store.connection_managed:
            raise ValueError("La conexión del despliegue se administra en el servidor.")
        return *files, profile or "DEFAULT"
    state, config, key, _ = store.draft()
    if not state.has_credentials:
        raise ValueError("Guarda primero la conexión OCI o selecciona config y key.pem.")
    if profile and profile != state.profile:
        raise ValueError("El perfil no coincide con la conexión guardada.")
    return config, key, state.profile


def selected_agent_ids(encoded: str) -> list[str]:
    identities = json.loads(encoded)
    if not isinstance(identities, list) or not all(isinstance(item, str) for item in identities):
        raise ValueError("Selecciona los agentes del catálogo.")
    return identities


class DraftWriter:
    def __init__(
        self, store: ProfileStore, files: tuple[bytes, bytes] | None, profile: str, compartment_id: str | None
    ):
        self.store = store
        self.files = files
        self.profile = profile
        self.compartment_id = compartment_id

    def save(
        self,
        step: str,
        instance_id: str | None,
        workspace_id: str | None,
        agent_ids: str | None,
        transcription_model: str | None,
        speech_model: str | None,
    ) -> DiscoveryDraft:
        self.state, old_config, old_key, self.revision = self.store.draft()
        self.config, self.key, self.selected_profile = discovery_credentials(
            self.store, self.files, self.profile
        )
        self.discovery = Discovery(self.config, self.key, self.selected_profile)
        self.same_connection = (
            self.state.has_credentials
            and self.selected_profile == self.state.profile
            and self.discovery.values == Discovery(old_config, old_key, self.state.profile).values
        )
        self.compartment = (
            (self.state.compartment_id if self.same_connection else "")
            if self.compartment_id is None
            else self.compartment_id
        )
        if step == "connection":
            if self.store.connection_managed:
                raise ValueError("La conexión del despliegue se administra en el servidor.")
            return self.save_connection(self.state)
        if not self.same_connection:
            raise ValueError("Guarda la nueva conexión antes de continuar.")
        if not self.compartment or self.compartment != self.state.compartment_id:
            raise ValueError("Guarda primero el compartment en Conexión.")
        transcription = self.state.transcription_model if transcription_model is None else transcription_model
        speech = self.state.speech_model if speech_model is None else speech_model
        if step == "audio":
            return self.save_audio(self.state, transcription, speech)
        return self.save_agents(self.state, instance_id, workspace_id, agent_ids)

    def save_connection(self, current: DiscoveryDraft) -> DiscoveryDraft:
        catalog = self.discovery.catalog("compartments", "", "", "")
        if self.compartment and self.compartment not in {item.id for item in catalog.compartments}:
            raise ValueError("El compartment ya no está disponible para este perfil.")
        unchanged = self.same_connection and self.compartment == current.compartment_id
        current = current if unchanged else DiscoveryDraft()
        current = current.model_copy(
            update={
                "profile": self.selected_profile,
                "region": self.discovery.values["region"],
                "compartment_id": self.compartment,
            }
        )
        return self.store.save_draft(current, self.config, self.key, self.revision)

    def save_audio(self, current: DiscoveryDraft, transcription: str, speech: str) -> DiscoveryDraft:
        self.discovery.check_compartment(self.compartment)
        self.discovery.validate_audio(self.compartment, transcription, speech)
        updated = [
            item.model_copy(
                update={
                    "transcription_model": transcription,
                    "speech_model": speech,
                }
            )
            for item in current.profiles
        ]
        current = current.model_copy(
            update={
                "transcription_model": transcription,
                "speech_model": speech,
                "profiles": updated,
            }
        )
        return self.store.save_draft(current, self.config, self.key, self.revision, updated)

    def save_agents(
        self,
        current: DiscoveryDraft,
        instance_id: str | None,
        workspace_id: str | None,
        agent_ids: str | None,
    ) -> DiscoveryDraft:
        transcription, speech = current.transcription_model, current.speech_model
        identities = current.agent_ids if agent_ids is None else selected_agent_ids(agent_ids)
        instance = current.instance_id if instance_id is None else instance_id
        workspace = current.workspace_id if workspace_id is None else workspace_id
        removed = [
            item.id
            for item in current.profiles
            if item.instance_id == instance
            and item.workspace_id == workspace
            and item.flow_id not in identities
        ]
        previous = {item.id for item in self.store.list()}
        imported = self.discovery.save(
            self.store,
            self.compartment,
            instance,
            workspace,
            transcription,
            speech,
            identities,
            reuse_existing=True,
        )
        current = current.model_copy(
            update={
                "instance_id": instance,
                "workspace_id": workspace,
                "agent_ids": identities,
                "transcription_model": transcription,
                "speech_model": speech,
                "profiles": imported,
            }
        )
        try:
            return self.store.save_draft(current, self.config, self.key, self.revision, imported, removed)
        except Exception:
            for item in imported:
                if item.id not in previous:
                    self.store.delete(item.id)
            raise


def discovery_router(store: ProfileStore) -> APIRouter:
    router = APIRouter(prefix="/discovery", dependencies=[Depends(local_configuration)])

    @router.post("/draft/read", response_model=DiscoveryDraft, operation_id="desk_discovery_draft_read")
    @router.get("/draft", response_model=DiscoveryDraft, operation_id="desk_discovery_draft")
    def draft() -> DiscoveryDraft:
        return store.draft()[0]

    @router.delete("/draft", status_code=204, operation_id="desk_discovery_draft_delete")
    def clear_draft() -> None:
        if store.connection_managed:
            raise HTTPException(403, "La conexión del despliegue se administra en el servidor.")
        store.clear_draft()

    @router.post("/draft/clear", response_model=DiscoveryDraft, operation_id="desk_discovery_draft_clear")
    def clear_section(request: ClearDraftRequest) -> DiscoveryDraft:
        state, config, key, revision = store.draft()
        if not state.has_credentials:
            raise HTTPException(422, "Guarda primero la conexión OCI.")
        updates = None
        if request.step == "agents":
            state = state.model_copy(update={"instance_id": "", "workspace_id": "", "agent_ids": []})
        else:
            updates = [
                profile.model_copy(update={"transcription_model": "", "speech_model": ""})
                for profile in state.profiles
            ]
            state = state.model_copy(
                update={"transcription_model": "", "speech_model": "", "profiles": updates}
            )
        try:
            return store.save_draft(state, config, key, revision, updates)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error

    @router.post("/draft", response_model=DiscoveryDraft, operation_id="desk_discovery_draft_save")
    async def save_draft(
        files: Annotated[tuple[bytes, bytes] | None, Depends(uploads)],
        step: Annotated[Literal["connection", "agents", "audio"], Form()],
        profile: Annotated[str, Form(max_length=80)] = "",
        compartment_id: Annotated[str | None, Form(max_length=256)] = None,
        instance_id: Annotated[str | None, Form(max_length=256)] = None,
        workspace_id: Annotated[str | None, Form(max_length=256)] = None,
        agent_ids: Annotated[str | None, Form(max_length=6000)] = None,
        transcription_model: Annotated[str | None, Form(max_length=256)] = None,
        speech_model: Annotated[str | None, Form(max_length=256)] = None,
    ) -> DiscoveryDraft:
        writer = DraftWriter(store, files, profile, compartment_id)

        try:
            return await run_in_threadpool(
                writer.save, step, instance_id, workspace_id, agent_ids, transcription_model, speech_model
            )
        except DiscoveryQueryError as error:
            raise HTTPException(502, str(error)) from error
        except (ValueError, TypeError) as error:
            raise HTTPException(
                422, "Revisa la selección del borrador." if isinstance(error, TypeError) else str(error)
            ) from error
        except (oci.exceptions.ServiceError, oci.exceptions.RequestException) as error:
            raise HTTPException(
                502, str(DiscoveryQueryError("verificar el paso de configuración", error))
            ) from error

    @router.post("/profiles", response_model=DiscoveryProfiles, operation_id="desk_discovery_profiles")
    def profiles(files: Annotated[tuple[bytes, bytes] | None, Depends(uploads)]) -> DiscoveryProfiles:
        try:
            config, key, _ = discovery_credentials(store, files)
            return credential_profiles(config, key)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error

    @router.post("/options", response_model=DiscoveryOptions, operation_id="desk_discovery_options")
    async def options(
        files: Annotated[tuple[bytes, bytes] | None, Depends(uploads)],
        stage: Annotated[Literal["compartments", "resources", "agents", "audio"], Form()],
        profile: Annotated[str, Form(max_length=80)] = "",
        compartment_id: Annotated[str, Form(max_length=256)] = "",
        instance_id: Annotated[str, Form(max_length=256)] = "",
        workspace_id: Annotated[str, Form(max_length=256)] = "",
    ) -> DiscoveryOptions:
        try:
            discovery = Discovery(*discovery_credentials(store, files, profile))
            if store.connection_managed:
                state = store.draft()[0]
                if compartment_id and compartment_id != state.compartment_id:
                    raise ValueError("Usa el compartimento configurado por el despliegue.")
                compartment_id = state.compartment_id
            return await run_in_threadpool(
                discovery.catalog, stage, compartment_id, instance_id, workspace_id
            )
        except DiscoveryQueryError as error:
            raise HTTPException(502, str(error)) from error
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        except (oci.exceptions.ServiceError, oci.exceptions.RequestException) as error:
            raise HTTPException(
                502, "No se pudo consultar OCI. Revisa permisos, región y compatibilidad AIDP GA."
            ) from error

    @router.post(
        "/import", response_model=list[AgentProfile], status_code=201, operation_id="desk_discovery_import"
    )
    async def import_agents(
        files: Annotated[tuple[bytes, bytes] | None, Depends(uploads)],
        compartment_id: Annotated[str, Form(min_length=1, max_length=256)],
        instance_id: Annotated[str, Form(min_length=1, max_length=256)],
        workspace_id: Annotated[str, Form(min_length=1, max_length=256)],
        agent_ids: Annotated[str, Form(max_length=6000)],
        profile: Annotated[str, Form(max_length=80)] = "",
        transcription_model: Annotated[str, Form(max_length=256)] = "",
        speech_model: Annotated[str, Form(max_length=256)] = "",
    ) -> list[AgentProfile]:
        try:
            identities = selected_agent_ids(agent_ids)
            discovery = Discovery(*discovery_credentials(store, files, profile))
            if store.connection_managed and compartment_id != store.draft()[0].compartment_id:
                raise ValueError("Usa el compartimento configurado por el despliegue.")
            return await run_in_threadpool(
                discovery.save,
                store,
                compartment_id,
                instance_id,
                workspace_id,
                transcription_model,
                speech_model,
                identities,
            )
        except DiscoveryQueryError as error:
            raise HTTPException(502, str(error)) from error
        except (ValueError, TypeError) as error:
            raise HTTPException(
                422,
                "Revisa la selección de agentes y los archivos OCI."
                if isinstance(error, TypeError)
                else str(error),
            ) from error
        except (oci.exceptions.ServiceError, oci.exceptions.RequestException) as error:
            raise HTTPException(
                502, "No se pudo verificar la publicación en OCI. Vuelve a consultar el catálogo."
            ) from error

    return router
