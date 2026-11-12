"""Read-only OCI discovery. Endpoints are SDK-owned, never supplied by uploads."""

import configparser
import re
from collections.abc import Iterable
from typing import Any
from urllib.parse import urlsplit

import oci  # type: ignore[import-untyped]
from oci._vendor import requests  # type: ignore[import-untyped]

from .credentials import ProfileStore, segment, validated_credentials
from .schemas import (
    AgentProfile,
    DiscoveryAgent,
    DiscoveryItem,
    DiscoveryOptions,
    DiscoveryProfile,
    DiscoveryProfiles,
)


def validate_agent_selection(identities: list[str], allowed: set[str], reuse_existing: bool) -> None:
    if (
        (not identities and not reuse_existing)
        or len(identities) > 20
        or len(set(identities)) != len(identities)
    ):
        raise ValueError("Selecciona entre 1 y 20 agentes distintos.")
    if not set(identities) <= allowed:
        raise ValueError("Uno de los agentes seleccionados ya no tiene TEST o PROD activo.")


def matching_profile(
    candidates: Iterable[AgentProfile], store: ProfileStore, identity: str,
    compartment: str, instance: str, workspace: str, endpoint: str,
) -> AgentProfile | None:
    return next(
        (
            item for item in candidates
            if item.flow_id == identity
            and item.compartment_id == compartment
            and item.instance_id == instance
            and item.workspace_id == workspace
            and store.matches_endpoint(item.id, endpoint)
        ),
        None,
    )


class DiscoveryQueryError(Exception):
    """Safe operation/status diagnostics without OCI request bodies or identifiers."""

    def __init__(self, operation: str, error: Exception) -> None:
        status = getattr(error, "status", None)
        code = getattr(error, "code", "")
        code = code if isinstance(code, str) and re.fullmatch(r"[A-Za-z0-9_]{1,64}", code) else ""
        detail = f"HTTP {status}" if isinstance(status, int) else "fallo de conexión"
        if code:
            detail += f" · {code}"
        guidance = (
            "OCI devolvió un error interno. Reintenta; si persiste, revisa la compatibilidad GA de la instancia con soporte OCI."
            if isinstance(status, int) and status >= 500
            else "Revisa permisos y disponibilidad regional de AIDP."
        )
        super().__init__(f"No se pudo {operation} ({detail}). {guidance}")


def credential_profiles(config: bytes, key: bytes) -> DiscoveryProfiles:
    if len(config) > 65536 or len(key) > 16384:
        raise ValueError("El archivo supera el tamaño permitido.")
    parser = configparser.ConfigParser(interpolation=None)
    try:
        parser.read_string(config.decode("utf-8-sig"))
    except (UnicodeError, configparser.Error) as error:
        raise ValueError("No se pudo leer el config OCI.") from error
    names = (["DEFAULT"] if parser.defaults() else []) + parser.sections()
    if len(names) > 50:
        raise ValueError("El config admite hasta 50 perfiles.")
    profiles = []
    for name in names:
        try:
            values, _ = validated_credentials(config, key, name)
        except ValueError:
            continue
        profiles.append(DiscoveryProfile(name=name, region=values["region"]))
    if not profiles:
        raise ValueError("Ningún perfil OCI válido coincide con la clave seleccionada.")
    return DiscoveryProfiles(profiles=profiles)


def safe_endpoint(value: str) -> bool:
    try:
        url = urlsplit(value)
        return bool(
            url.scheme == "https"
            and url.hostname
            and not (url.username or url.password or url.port or url.query or url.fragment)
        )
    except ValueError:
        return False


class Discovery:
    def __init__(self, config: bytes, key: bytes, profile: str) -> None:
        self.values, _ = validated_credentials(config, key, profile)
        self.config = config
        self.key = key
        self.profile = profile
        self.warnings: list[str] = []
        self.signer = oci.signer.Signer(
            tenancy=self.values["tenancy"],
            user=self.values["user"],
            fingerprint=self.values["fingerprint"],
            private_key_file_location=None,
            private_key_content=key.decode("utf-8"),
        )
        self.options = {
            "signer": self.signer,
            "timeout": (5, 15),
            "retry_strategy": oci.retry.NoneRetryStrategy(),
        }
        self.client_config = {**self.values, "key_content": key.decode("utf-8")}
        self.data_client = oci.base_client.BaseClient(
            "aidp",
            self.client_config,
            self.signer,
            {},
            service_endpoint_template="https://datalake.{region}.oci.{secondLevelDomain}",
            base_path="/20260430",
            timeout=(5, 15),
        )

    def compartments(self) -> list[DiscoveryItem]:
        client = oci.identity.IdentityClient(self.client_config, **self.options)
        items = [DiscoveryItem(id=self.values["tenancy"], name="Raíz de la tenancy")]
        page = None
        for _ in range(50):
            response = client.list_compartments(
                self.values["tenancy"],
                compartment_id_in_subtree=True,
                access_level="ACCESSIBLE",
                lifecycle_state="ACTIVE",
                limit=100,
                page=page,
            )
            items.extend(DiscoveryItem(id=item.id, name=item.name) for item in response.data)
            page = response.headers.get("opc-next-page")
            if not page:
                return sorted(items, key=lambda item: item.name.casefold())
        raise ValueError("El catálogo supera el límite de consulta; reduce el alcance IAM.")

    def check_compartment(self, identity: str) -> None:
        if identity not in {item.id for item in self.compartments()}:
            raise ValueError("El compartment ya no está disponible para este perfil.")

    def instances(self, compartment: str) -> list[DiscoveryItem]:
        client = oci.ai_data_platform.AiDataPlatformClient(self.client_config, **self.options)
        items: list[DiscoveryItem] = []
        page = None
        for _ in range(50):
            response = client.list_ai_data_platforms(
                compartment_id=compartment,
                lifecycle_state="ACTIVE",
                limit=100,
                page=page,
            )
            items.extend(DiscoveryItem(id=item.id, name=item.display_name) for item in response.data.items)
            page = response.headers.get("opc-next-page")
            if not page:
                return items
        raise ValueError("Demasiadas instancias para una consulta.")

    def audio(self) -> tuple[list[DiscoveryItem], list[DiscoveryItem], list[str]]:
        transcription: list[DiscoveryItem] = []
        warnings = [
            "OCI Speech requiere acceso y permisos en la región de la conexión; el catálogo no confirma disponibilidad en vivo."
        ]
        voices: list[DiscoveryItem] = []
        if self.values["region"] == "us-chicago-1":
            transcription.append(
                DiscoveryItem(
                    id="oci.speech.whisper.es",
                    name="OCI Speech · Whisper en vivo (es)",
                )
            )
            voices.append(
                DiscoveryItem(
                    id="oci.speech.carmen.es-ES",
                    name="OCI Speech · Carmen Natural (es-ES)",
                )
            )
        if not transcription:
            warnings.append(
                "La integración OCI Speech de esta aplicación admite Chicago. Esta región no tiene modelos de audio configurables."
            )
        return transcription, voices, warnings

    def dp(self, path: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        page = None
        for _ in range(50):
            try:
                response = self.data_client.call_api(
                    path,
                    "GET",
                    query_params={"limit": 100, **({"page": page} if page else {})},
                    response_type="object",
                    header_params={"accept": "application/json"},
                )
            except (oci.exceptions.ServiceError, oci.exceptions.RequestException) as error:
                operation = (
                    "listar publicaciones"
                    if path.endswith("/deployments")
                    else ("listar Agent Flows" if path.endswith("/agents") else "listar workspaces")
                )
                raise DiscoveryQueryError(operation, error) from error
            data = response.data
            if not isinstance(data, dict) or not isinstance(data.get("items"), list):
                raise ValueError("AIDP devolvió un catálogo incompatible.")
            items.extend(item for item in data["items"] if isinstance(item, dict))
            page = response.headers.get("opc-next-page")
            if not page:
                return items
        raise ValueError("El catálogo AIDP supera el límite de consulta.")

    def workspaces(self, instance: str) -> list[DiscoveryItem]:
        return [
            DiscoveryItem(id=item["key"], name=item["displayName"])
            for item in self.dp(f"/aiDataPlatforms/{segment(instance)}/workspaces")
            if item.get("lifecycleState") == "ACTIVE"
        ]

    def published_endpoint(self, path: str, agent_key: str) -> str:
        for deployment in self.dp(path):
            if deployment.get("deploymentType") != "PROD" or deployment.get("lifecycleState") != "ACTIVE":
                continue
            if not deployment.get("endpointUrl") or not deployment.get("agentKey"):
                try:
                    response = self.data_client.call_api(
                        f"{path}/{segment(deployment['key'])}",
                        "GET",
                        response_type="object",
                        header_params={"accept": "application/json"},
                    )
                except (oci.exceptions.ServiceError, oci.exceptions.RequestException) as error:
                    raise DiscoveryQueryError("consultar una publicación", error) from error
                deployment = response.data
            endpoint = deployment.get("endpointUrl", "")
            if self.production_deployment(deployment, agent_key) and safe_endpoint(endpoint):
                return str(endpoint)
        return ""

    @staticmethod
    def production_deployment(deployment: dict[str, Any], agent_key: str) -> bool:
        return (
            deployment.get("deploymentType") == "PROD"
            and deployment.get("lifecycleState") == "ACTIVE"
            and deployment.get("agentKey") == agent_key
        )

    def test_endpoint(self, instance: str, workspace: str, agent_key: str) -> str:
        from .development import Development

        metadata = AgentProfile(id="", name="", endpoint_host="", flow_id=agent_key,
                                region=self.values["region"], profile=self.profile,
                                instance_id=instance, workspace_id=workspace)
        with requests.Session() as session:
            session.trust_env = False
            return str(Development(metadata, session, self.signer).target()["endpoint"])

    def agents(self, instance: str, workspace: str) -> tuple[list[DiscoveryAgent], dict[str, str]]:
        path = f"/aiDataPlatforms/{segment(instance)}/workspaces/{segment(workspace)}/agents"
        agents: list[DiscoveryAgent] = []
        endpoints: dict[str, str] = {}
        self.warnings = []
        for item in self.dp(path):
            key = item["key"]
            diagnostic = ""
            try:
                endpoint = self.published_endpoint(f"{path}/{segment(key)}/deployments", key)
            except DiscoveryQueryError as error:
                endpoint = ""
                diagnostic = str(error)
                if diagnostic not in self.warnings:
                    self.warnings.append(diagnostic)
            if not endpoint:
                try:
                    endpoint = self.test_endpoint(instance, workspace, key)
                    if endpoint:
                        diagnostic = ""
                except (ValueError, requests.RequestException):
                    endpoint = ""
            if endpoint:
                endpoints[key] = endpoint
            agents.append(
                DiscoveryAgent(
                    id=key,
                    name=item.get("displayName", key),
                    available=bool(endpoint),
                    description=diagnostic
                    or ("Desarrollo (TEST)" if endpoint.endswith("_TEST/chat") else "Publicado"
                        if endpoint else "Requiere TEST o PROD activo"),
                )
            )
        return agents, endpoints

    def catalog(self, stage: str, compartment: str, instance: str, workspace: str) -> DiscoveryOptions:
        if stage == "compartments":
            return DiscoveryOptions(compartments=self.compartments())
        self.check_compartment(compartment)
        if stage == "audio":
            self.compartment = compartment
            transcription, voices, warnings = self.audio()
            return DiscoveryOptions(
                transcription_models=transcription, speech_models=voices, warnings=warnings
            )
        instances = self.instances(compartment)
        if stage == "resources":
            self.compartment = compartment
            transcription, voices, warnings = self.audio()
            return DiscoveryOptions(
                instances=instances,
                transcription_models=transcription,
                speech_models=voices,
                warnings=warnings,
            )
        if instance not in {item.id for item in instances}:
            raise ValueError("La instancia ya no está disponible en este compartment.")
        workspaces = self.workspaces(instance)
        if not workspace:
            return DiscoveryOptions(workspaces=workspaces)
        if workspace not in {item.id for item in workspaces}:
            raise ValueError("El workspace ya no está disponible.")
        agents, _ = self.agents(instance, workspace)
        return DiscoveryOptions(workspaces=workspaces, agents=agents, warnings=self.warnings)

    def save(
        self,
        store: ProfileStore,
        compartment: str,
        instance: str,
        workspace: str,
        transcription: str,
        speech: str,
        identities: list[str],
        reuse_existing: bool = False,
    ) -> list[AgentProfile]:
        catalog = self.catalog("agents", compartment, instance, workspace)
        allowed = {agent.id for agent in catalog.agents if agent.available}
        validate_agent_selection(identities, allowed, reuse_existing)
        self.validate_audio(compartment, transcription, speech)
        agents, endpoints = self.agents(instance, workspace)
        names = {agent.id: agent.name for agent in agents}
        if not set(identities) <= endpoints.keys() or not set(identities) <= names.keys():
            raise ValueError("El deployment cambió durante la consulta. Vuelve a seleccionar los agentes.")
        created = []
        reused: list[AgentProfile] = []
        candidates = store.matching_profiles(self.config, self.key, self.profile) if reuse_existing else ()
        try:
            for identity in identities:
                previous = matching_profile(
                    candidates, store, identity, compartment, instance, workspace, endpoints[identity]
                )
                if previous is not None:
                    reused.append(
                        previous.model_copy(
                            update={
                                "transcription_model": transcription,
                                "speech_model": speech,
                            }
                        )
                    )
                    continue
                created.append(
                    store.create(
                        names[identity][:80],
                        endpoints[identity],
                        identity,
                        self.profile,
                        self.config,
                        self.key,
                        selection={
                            "compartment_id": compartment,
                            "instance_id": instance,
                            "workspace_id": workspace,
                            "transcription_model": transcription,
                            "speech_model": speech,
                        },
                    )
                )
        except Exception:
            for item in created:
                store.delete(item.id)
            raise
        return reused + created

    def validate_audio(self, compartment: str, transcription: str, speech: str) -> None:
        self.compartment = compartment
        if not transcription and not speech:
            return
        models, voices, _ = self.audio()
        if transcription and transcription not in {item.id for item in models}:
            raise ValueError("Modelo de transcripción no válido.")
        if speech and speech not in {item.id for item in voices}:
            raise ValueError("La voz seleccionada ya no está disponible.")
