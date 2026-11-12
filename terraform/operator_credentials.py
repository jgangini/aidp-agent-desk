"""Read the uploaded operator identity without exposing it in hook output."""

import configparser
import hashlib
import os
from pathlib import Path

import oci
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def operator_credentials():
    source = configparser.ConfigParser(interpolation=None)
    source.read_string(Path(os.environ["DEPLOY_STUDIO_OCI_CONFIG"]).read_text())
    config = dict(source["DEFAULT"])
    key_path = Path(os.environ["DEPLOY_STUDIO_OCI_KEY"])
    private = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    if not isinstance(private, rsa.RSAPrivateKey) or private.key_size < 2048:
        raise ValueError("Expected operator RSA key")
    der = private.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    fingerprint = ":".join(
        hashlib.md5(der, usedforsecurity=False).hexdigest()[i : i + 2] for i in range(0, 32, 2)
    )
    if config.get("fingerprint") != fingerprint:
        raise ValueError("Operator key fingerprint mismatch")
    for field, prefix in (("user", "ocid1.user."), ("tenancy", "ocid1.tenancy.")):
        if not config.get(field, "").startswith(prefix) or any(c in config[field] for c in "\r\n"):
            raise ValueError("Invalid operator identity")
    config["key_file"] = str(key_path)
    signer = oci.signer.Signer(
        tenancy=config["tenancy"],
        user=config["user"],
        fingerprint=fingerprint,
        private_key_file_location=str(key_path),
    )
    return config, signer


def payload(config: dict, context: dict, client_secret: str) -> dict:
    inputs = context["inputs"]
    if (
        config["user"] != inputs["operator_user_ocid"]
        or config["fingerprint"] != inputs["operator_fingerprint"]
    ):
        raise ValueError("Operator identity changed after preflight")
    lines = ["[DEFAULT]"] + [f"{name}={config[name]}" for name in ("user", "tenancy", "fingerprint")]
    lines += [f"region={context['region']}", "key_file=/run/oci/key.pem"]
    import secrets

    subject = inputs.get("admin_subject", "")
    directory_login = "0"
    if inputs.get("admin_user_ocid"):
        from identity_setup import selected_identity

        selected = selected_identity(config, inputs)
        if selected["admin_directory_id"] != inputs["admin_directory_id"]:
            raise ValueError("Administrator identity changed after preflight")
        subject = "directory:" + selected["admin_directory_id"]
        directory_login = "1"

    return {
        "config_text": "\n".join(lines) + "\n",
        "key_text": Path(config["key_file"]).read_text(),
        "runtime_config": {
            "oidc_client_id": inputs["oidc_client_id"],
            "oidc_client_secret": client_secret,
            "admin_subject": subject,
            "session_secret": secrets.token_urlsafe(48),
            "directory_login": directory_login,
        },
    }
