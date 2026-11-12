from __future__ import annotations

import builtins
import configparser
import hashlib
import json
import os
import re
import shutil
from collections.abc import Sequence
from io import StringIO
from pathlib import Path
from threading import Lock
from urllib.parse import quote, urlsplit
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from .schemas import AgentProfile, DiscoveryDraft


def segment(value: str) -> str:
    if not value or len(value) > 256 or not re.fullmatch(r"[a-zA-Z0-9_.-]+", value):
        raise ValueError("Selecciona un identificador válido del catálogo.")
    return quote(value, safe="")


def validated_credentials(
    config_bytes: bytes, key_bytes: bytes, profile: str
) -> tuple[dict[str, str], rsa.RSAPrivateKey]:
    if len(config_bytes) > 65536 or len(key_bytes) > 16384:
        raise ValueError("El archivo supera el tamaño permitido.")
    parser = configparser.ConfigParser(interpolation=None)
    try:
        parser.read_string(config_bytes.decode("utf-8-sig"))
        section = parser[profile]
        values = {field: section[field].strip() for field in ("user", "tenancy", "region", "fingerprint")}
    except (UnicodeError, configparser.Error, KeyError) as error:
        raise ValueError("El config no contiene el perfil OCI y los campos requeridos.") from error
    if (
        not re.fullmatch(r"ocid1\.user\.[a-zA-Z0-9._-]+", values["user"])
        or not re.fullmatch(r"ocid1\.tenancy\.[a-zA-Z0-9._-]+", values["tenancy"])
        or not re.fullmatch(r"[a-z]{2,4}-[a-z]+-\d", values["region"])
    ):
        raise ValueError("El perfil OCI contiene identificadores o región no válidos.")
    try:
        key = serialization.load_pem_private_key(key_bytes, password=None)
    except (ValueError, TypeError) as error:
        raise ValueError("key.pem debe ser una clave privada RSA sin contraseña.") from error
    if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
        raise ValueError("Usa una clave privada RSA de al menos 2048 bits.")
    public = key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    fingerprint = ":".join(re.findall("..", hashlib.md5(public, usedforsecurity=False).hexdigest()))
    if values["fingerprint"].lower() != fingerprint:
        raise ValueError("La huella del config no coincide con key.pem.")
    return values, key


def profile_endpoint(endpoint: str) -> tuple[str, str]:
    url = urlsplit(endpoint)
    if (
        url.scheme != "https"
        or not url.hostname
        or url.username
        or url.password
        or url.port
        or url.query
        or url.fragment
    ):
        raise ValueError("Usa un endpoint HTTPS sin credenciales, puerto, parámetros ni fragmento.")
    return url.hostname, url.path


class ProfileStore:
    """Local single-user credential vault. Private files never enter API responses."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.lock = Lock()

    @property
    def connection_managed(self) -> bool:
        return os.getenv("AGENT_DESK_MANAGED_CONNECTION", "0") == "1"

    def base_draft(self) -> tuple[DiscoveryDraft, bytes, bytes, dict[str, str]]:
        config_path = os.getenv("AGENT_DESK_BASE_CONFIG", "")
        key_path = os.getenv("AGENT_DESK_BASE_KEY", "")
        if not config_path or not key_path:
            if self.connection_managed:
                raise ValueError("La conexión gestionada requiere config y key.pem en el servidor.")
            return DiscoveryDraft(), b"", b"", {}
        with Path(config_path).open("rb") as config_file, Path(key_path).open("rb") as key_file:
            config, key = config_file.read(65537), key_file.read(16385)
        profile = os.getenv("AGENT_DESK_BASE_PROFILE", "DEFAULT")
        values, _ = validated_credentials(config, key, profile)
        compartment = os.getenv("AGENT_DESK_COMPARTMENT_ID", "") if self.connection_managed else ""
        if self.connection_managed and not re.fullmatch(
            r"ocid1\.(?:compartment|tenancy)\.[a-zA-Z0-9._-]+", compartment
        ):
            raise ValueError("La conexión gestionada requiere un compartimento OCI del despliegue.")
        return (
            DiscoveryDraft(
                connection_managed=self.connection_managed,
                profile=profile,
                region=values["region"],
                compartment_id=compartment,
                has_credentials=True,
            ),
            config,
            key,
            values,
        )

    def list(self) -> list[AgentProfile]:
        if not self.root.exists():
            return []
        with self.lock:
            profiles = [
                AgentProfile.model_validate_json(path.read_text(encoding="utf-8"))
                for path in sorted(self.root.glob("*/profile.json"))
            ]
            if not self.connection_managed:
                return profiles
            visible = []
            for profile in profiles:
                try:
                    self._connection(profile.id)
                except (OSError, ValueError):
                    continue
                visible.append(profile)
            return visible

    def _draft(self) -> tuple[DiscoveryDraft, bytes, bytes, str]:
        path = self.root / ".discovery-draft.json"
        if not path.exists():
            state, config, key, _ = self.base_draft()
            return state, config, key, ""
        payload = json.loads(path.read_text(encoding="utf-8"))
        if self.connection_managed:
            base, config, key, values = self.base_draft()
            saved = payload["state"]
            if (
                saved["profile"] != base.profile
                or saved["compartment_id"] != base.compartment_id
                or payload["credentials"] != values
            ):
                return base, config, key, payload["revision"]
            payload = {
                **payload,
                "credentials": values,
                "key": key.decode(),
                "state": {**saved, "connection_managed": True, "region": base.region},
            }
        parser = configparser.ConfigParser(interpolation=None)
        parser[payload["state"]["profile"]] = payload["credentials"]
        output = StringIO()
        parser.write(output)
        state = DiscoveryDraft(
            **{**payload["state"], "connection_managed": self.connection_managed},
            has_credentials=True,
            profiles=self._draft_profiles(payload["profile_ids"]),
        )
        return state, output.getvalue().encode(), payload["key"].encode(), payload["revision"]

    def _draft_profiles(self, identities: Sequence[str]) -> builtins.list[AgentProfile]:
        profiles = []
        for identity in identities:
            if not re.fullmatch(r"[a-f0-9]{32}", identity):
                raise ValueError("El borrador local contiene un identificador inválido.")
            target = self.root / identity / "profile.json"
            if target.is_file() and not target.parent.is_symlink():
                if self.connection_managed:
                    try:
                        profiles.append(self._connection(identity)[0])
                    except (OSError, ValueError):
                        continue
                else:
                    profiles.append(AgentProfile.model_validate_json(target.read_text(encoding="utf-8")))
        return profiles

    def draft(self) -> tuple[DiscoveryDraft, bytes, bytes, str]:
        with self.lock:
            return self._draft()

    def clear_draft(self) -> None:
        if self.connection_managed:
            raise ValueError("La conexión del despliegue se administra en el servidor.")
        with self.lock:
            (self.root / ".discovery-draft.json").unlink(missing_ok=True)

    def _replace_profile(self, item: AgentProfile, backups: dict[Path, bytes]) -> None:
        if not re.fullmatch(r"[a-f0-9]{32}", item.id):
            raise ValueError("Identificador de agente inválido.")
        target = self.root / item.id / "profile.json"
        if target.parent.is_symlink() or not target.is_file():
            raise ValueError("Uno de los agentes guardados ya no está disponible.")
        backups[target] = target.read_bytes()
        replacement = target.with_suffix(".tmp")
        try:
            replacement.write_text(item.model_dump_json(), encoding="utf-8")
            replacement.chmod(0o600)
            replacement.replace(target)
        finally:
            replacement.unlink(missing_ok=True)

    def save_draft(
        self,
        state: DiscoveryDraft,
        config: bytes,
        key_bytes: bytes,
        expected_revision: str,
        updates: Sequence[AgentProfile] | None = None,
        removals: Sequence[str] = (),
    ) -> DiscoveryDraft:
        values, key = validated_credentials(config, key_bytes, state.profile)
        normalized = key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        ).decode()
        with self.lock:
            if self._draft()[3] != expected_revision:
                raise ValueError("La conexión cambió durante la consulta. Vuelve a guardar este paso.")
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
            path = self.root / ".discovery-draft.json"
            payload = {
                "state": state.model_dump(exclude={"profiles", "has_credentials"}),
                # Only recognized OCI fields and normalized PEM; uploaded paths are never retained.
                "credentials": values,
                "key": normalized,
                "profile_ids": [item.id for item in state.profiles],
                "revision": uuid4().hex,
            }
            retired: dict[Path, Path] = {}
            backups: dict[Path, bytes] = {}
            temporary = self.root / f".draft-{uuid4().hex}.tmp"
            try:
                with temporary.open("x", encoding="utf-8") as output:
                    temporary.chmod(0o600)
                    json.dump(payload, output)
                for item in updates or []:
                    self._replace_profile(item, backups)
                for identity in removals:
                    if not re.fullmatch(r"[a-f0-9]{32}", identity):
                        raise ValueError("Identificador de agente inválido.")
                    target = self.root / identity
                    if target.is_dir() and not target.is_symlink():
                        backup = self.root / f".retired-{uuid4().hex}"
                        target.replace(backup)
                        retired[target] = backup
                temporary.replace(path)
            except Exception:
                for target, backup in retired.items():
                    backup.replace(target)
                for target, previous in backups.items():
                    target.write_bytes(previous)
                raise
            finally:
                temporary.unlink(missing_ok=True)
            for backup in retired.values():
                shutil.rmtree(backup)
        return state.model_copy(update={"has_credentials": True})

    def create(
        self,
        name: str,
        endpoint: str,
        flow_id: str,
        profile: str,
        config_bytes: bytes,
        key_bytes: bytes,
        selection: dict[str, str] | None = None,
    ) -> AgentProfile:
        if not name.strip() or not flow_id.strip() or len(name) > 80 or len(flow_id) > 256:
            raise ValueError("Indica el nombre y el identificador del Agent Flow.")
        if len(config_bytes) > 65536 or len(key_bytes) > 16384:
            raise ValueError("El archivo supera el tamaño permitido.")
        host, endpoint_path = profile_endpoint(endpoint)
        values, key = validated_credentials(config_bytes, key_bytes, profile)
        identity = uuid4().hex
        selection = selection or {}
        metadata = AgentProfile(
            id=identity,
            name=name,
            endpoint_host=host,
            flow_id=flow_id,
            region=values["region"],
            profile=profile,
            compartment_id=selection.get("compartment_id", ""),
            instance_id=selection.get("instance_id", ""),
            workspace_id=selection.get("workspace_id", ""),
            transcription_model=selection.get("transcription_model", ""),
            speech_model=selection.get("speech_model", ""),
            surface="TEST" if endpoint_path == f"/agentendpoint/{flow_id}_TEST/chat" else "PROD",
        )
        with self.lock:
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
            if len(list(self.root.glob("*/profile.json"))) >= 20:
                raise ValueError("Se alcanzó el límite de 20 agentes configurados.")
            temporary = self.root / f".pending-{identity}"
            temporary.mkdir(mode=0o700)
            try:
                # Only recognized fields are persisted. Uploaded key_file paths and extra commands are ignored.
                safe_config = configparser.ConfigParser(interpolation=None)
                safe_config[profile] = {
                    **values,
                    "key_file": str((self.root / identity / "key.pem").resolve()),
                }
                with (temporary / "config").open("x", encoding="utf-8") as target:
                    safe_config.write(target)
                normalized = key.private_bytes(
                    serialization.Encoding.PEM,
                    serialization.PrivateFormat.PKCS8,
                    serialization.NoEncryption(),
                )
                (temporary / "key.pem").write_bytes(normalized)
                (temporary / "connection.json").write_text(
                    json.dumps({"endpoint": endpoint}), encoding="utf-8"
                )
                (temporary / "profile.json").write_text(metadata.model_dump_json(), encoding="utf-8")
                for path in temporary.iterdir():
                    path.chmod(0o600)
                temporary.rename(self.root / identity)
            except Exception:
                shutil.rmtree(temporary)
                raise
        return metadata

    def matches_endpoint(self, identity: str, endpoint: str) -> bool:
        if not re.fullmatch(r"[a-f0-9]{32}", identity):
            return False
        with self.lock:
            target = self.root / identity / "connection.json"
            return (
                not target.parent.is_symlink()
                and target.is_file()
                and json.loads(target.read_text(encoding="utf-8")).get("endpoint") == endpoint
            )

    def connection(self, identity: str) -> tuple[AgentProfile, dict[str, str], bytes, str]:
        """Read one saved connection without exposing private material through HTTP."""
        with self.lock:
            return self._connection(identity)

    def _connection(self, identity: str) -> tuple[AgentProfile, dict[str, str], bytes, str]:
        if not re.fullmatch(r"[a-f0-9]{32}", identity):
            raise ValueError("Agente no encontrado.")
        directory = self.root / identity
        paths = [directory / name for name in ("profile.json", "config", "key.pem", "connection.json")]
        if directory.is_symlink() or any(path.is_symlink() or not path.is_file() for path in paths):
            raise ValueError("Agente no encontrado.")
        metadata = AgentProfile.model_validate_json(paths[0].read_text(encoding="utf-8"))
        key = paths[2].read_bytes()
        values, _ = validated_credentials(paths[1].read_bytes(), key, metadata.profile)
        if self.connection_managed:
            base, _, base_key, base_values = self.base_draft()
            if (
                metadata.profile != base.profile
                or metadata.compartment_id != base.compartment_id
                or values != base_values
            ):
                raise ValueError("El agente no pertenece a la conexión del despliegue.")
            key, values = base_key, base_values
        endpoint = json.loads(paths[3].read_text(encoding="utf-8"))["endpoint"]
        if not isinstance(endpoint, str):
            raise ValueError("La conexión guardada no es válida.")
        return metadata, values, key, endpoint

    def matching_profiles(self, config: bytes, key_bytes: bytes, profile: str) -> tuple[AgentProfile, ...]:
        values, key = validated_credentials(config, key_bytes, profile)
        matches = []
        with self.lock:
            for path in sorted(self.root.glob("*/profile.json")):
                if not re.fullmatch(r"[a-f0-9]{32}", path.parent.name):
                    continue
                sources = (path, path.parent / "config", path.parent / "key.pem")
                if path.parent.is_symlink() or any(source.is_symlink() for source in sources):
                    continue
                try:
                    candidate = AgentProfile.model_validate_json(path.read_text(encoding="utf-8"))
                    if candidate.profile != profile:
                        continue
                    stored_values, stored_key = validated_credentials(
                        sources[1].read_bytes(), sources[2].read_bytes(), profile
                    )
                except (OSError, ValueError):
                    continue
                if (
                    stored_values == values
                    and stored_key.public_key().public_numbers() == key.public_key().public_numbers()
                ):
                    matches.append(candidate)
        return tuple(matches)

    def delete(self, identity: str) -> bool:
        if not re.fullmatch(r"[a-f0-9]{32}", identity):
            return False
        with self.lock:
            target = self.root / identity
            if not target.is_dir() or target.is_symlink():
                return False
            shutil.rmtree(target)
        return True


def profile_store() -> ProfileStore:
    return ProfileStore(Path(os.getenv("AGENT_DESK_DATA_DIR", ".local/agent-desk")))
