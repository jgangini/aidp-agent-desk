"""Runs inside the pinned application image on the VM, never in the build."""

import configparser
import hashlib
import json
import os
import time
from pathlib import Path

import oci
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from envelope import OBJECT, decrypt, strict_json

from app.core.identity import IdentitySettings
from app.features.desk.credentials import validated_credentials


def write_private(path: Path, content: bytes) -> None:
    temporary = path.with_name(path.name + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)
    if os.name == "posix":
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)


def runtime_secret(settings: dict[str, str], secret: dict) -> tuple[dict[str, str], bytes, bytes]:
    if set(secret) != {"config_text", "key_text", "runtime_config"}:
        raise ValueError("Invalid bootstrap payload")
    if not isinstance(secret["runtime_config"], dict) or set(secret["runtime_config"]) not in (
        {
            "oidc_client_id",
            "oidc_client_secret",
            "session_secret",
            "admin_subject",
        },
        {"oidc_client_id", "oidc_client_secret", "session_secret", "admin_subject", "directory_login"},
    ):
        raise ValueError("Invalid runtime configuration")
    secret = {**secret["runtime_config"], "oci_config": secret["config_text"], "oci_key": secret["key_text"]}
    required = {
        "oidc_client_id",
        "oidc_client_secret",
        "session_secret",
        "admin_subject",
        "oci_config",
        "oci_key",
    }
    if set(secret) not in (required, required | {"directory_login"}) or not all(
        isinstance(v, str) and v for v in secret.values()
    ):
        raise ValueError("Incomplete runtime secret")
    if secret.get("directory_login", "0") not in ("0", "1"):
        raise ValueError("Invalid directory login configuration")
    config, key = secret["oci_config"].encode(), secret["oci_key"].encode()
    validated_credentials(config, key, "DEFAULT")
    identity = configparser.ConfigParser(interpolation=None)
    identity.read_string(config.decode())
    if (
        identity["DEFAULT"]["user"] != settings["operator_user"]
        or identity["DEFAULT"]["fingerprint"] != settings["operator_fingerprint"]
    ):
        raise ValueError("Unexpected operator identity")
    return secret, config, key


def runtime_environment(settings: dict[str, str], secret: dict[str, str]) -> dict[str, str]:
    env = {
        "AGENT_DESK_AUTH_MODE": "oracle",
        "AGENT_DESK_PUBLIC_ORIGIN": settings["origin"],
        "AGENT_DESK_OIDC_DOMAIN": settings["domain"],
        "AGENT_DESK_OIDC_CLIENT_ID": secret["oidc_client_id"],
        "AGENT_DESK_OIDC_CLIENT_SECRET": secret["oidc_client_secret"],
        "AGENT_DESK_SESSION_SECRET": secret["session_secret"],
        "AGENT_DESK_ADMIN_SUBJECT": secret["admin_subject"],
        "AGENT_DESK_DIRECTORY_LOGIN": secret.get("directory_login", "0"),
        "AGENT_DESK_CREATE_USERS": settings.get("create_users", "disabled"),
        "ARKO_ALLOWED_HOSTS": settings["origin"].removeprefix("https://") + ",localhost,127.0.0.1",
        "AGENT_DESK_BASE_CONFIG": "/run/oci/config",
        "AGENT_DESK_BASE_KEY": "/run/oci/key.pem",
        "AGENT_DESK_MANAGED_CONNECTION": "1",
        "AGENT_DESK_COMPARTMENT_ID": settings["compartment"],
        "AGENT_DESK_DATA_DIR": "/data",
    }
    if any("\n" in v or "\r" in v for v in env.values()):
        raise ValueError("Runtime environment values must be single-line")
    return env


def validate_identity_environment(env: dict[str, str]) -> None:
    previous = {name: os.environ.get(name) for name in env}
    try:
        os.environ.update(env)
        IdentitySettings.load()
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def configure(root: Path, settings: dict[str, str], secret: dict) -> None:
    secret, config, key = runtime_secret(settings, secret)
    env = runtime_environment(settings, secret)
    validate_identity_environment(env)
    private = root / "private"
    private.mkdir(mode=0o700, exist_ok=True)
    credentials = private / "oci"
    credentials.mkdir(parents=True, exist_ok=True, mode=0o700)
    data = root / "data"
    data.mkdir(mode=0o700, exist_ok=True)
    for path, content in (
        (credentials / "config", config),
        (credentials / "key.pem", key),
        (private / "runtime.env", ("\n".join(f"{k}={v}" for k, v in env.items()) + "\n").encode()),
    ):
        write_private(path, content)
    if os.name == "posix":
        for path in (credentials, credentials / "config", credentials / "key.pem", data):
            os.chown(path, 10001, 10001)


def prepare_key(private: Path) -> Path:
    private.mkdir(mode=0o700, exist_ok=True)
    key_path = private / "bootstrap-key.pem"
    if not key_path.exists():
        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        write_private(
            key_path,
            key.private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
            ),
        )
    else:
        key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    write_private(
        private / "bootstrap-public.pem",
        key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        ),
    )
    return key_path


def installed_files(root: Path) -> dict:
    return {
        name: hashlib.sha256((root / "private" / name).read_bytes()).hexdigest()
        for name in ("runtime.env", "oci/config", "oci/key.pem")
    }


def cleanup(private: Path) -> None:
    for name in ("bootstrap-key.pem", "bootstrap-public.pem", "bootstrap.installed"):
        (private / name).unlink(missing_ok=True)


def finish(root: Path) -> None:
    private = root / "private"
    if strict_json((private / "bootstrap.installed").read_bytes()) != installed_files(root):
        raise ValueError("Incomplete private installation")
    (private / "bootstrap-key.pem").unlink(missing_ok=True)
    (private / "bootstrap-public.pem").unlink(missing_ok=True)
    write_private(private / "bootstrap.ready", b"ready\n")
    cleanup(private)


def consume(root: Path, settings: dict, client) -> None:
    private = root / "private"
    if (private / "bootstrap.ready").exists():
        cleanup(private)
        return
    key = prepare_key(private)
    try:
        response = client.get_object(settings["namespace"], settings["bucket"], OBJECT)
    except oci.exceptions.ServiceError as error:
        if error.status != 404:
            raise
        if (private / "bootstrap.installed").exists():
            finish(root)
            return
        raise RuntimeError("Waiting for encrypted bootstrap") from None
    raw = response.data.raw.read(100001)
    configure(root, settings, decrypt(key.read_bytes(), raw))
    write_private(private / "bootstrap.installed", json.dumps(installed_files(root)).encode())
    client.delete_object(settings["namespace"], settings["bucket"], OBJECT, if_match=response.headers["etag"])
    try:
        client.head_object(settings["namespace"], settings["bucket"], OBJECT)
    except oci.exceptions.ServiceError as error:
        if error.status != 404:
            raise
    else:
        raise RuntimeError("Bootstrap envelope not deleted")
    finish(root)


def main() -> None:
    root = Path("/install")
    settings = strict_json((root / "bootstrap.json").read_bytes())
    if (root / "private/bootstrap.ready").exists():
        cleanup(root / "private")
        return
    prepare_key(root / "private")
    signer = oci.auth.signers.InstancePrincipalsSecurityTokenSigner()
    client = oci.object_storage.ObjectStorageClient({"region": settings["region"]}, signer=signer)
    deadline = time.monotonic() + 3400
    while time.monotonic() < deadline:
        try:
            consume(root, settings, client)
            return
        except RuntimeError:
            time.sleep(10)
    raise RuntimeError("Encrypted bootstrap timed out")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit(
            "Agent Desk bootstrap failed; check encrypted delivery and runtime configuration."
        ) from None
