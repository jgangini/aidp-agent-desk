"""Report readiness only after TLS, login mode and API protection are live."""

import ipaddress
import json
import os
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from envelope import OBJECT, READY, encrypt
from operator_credentials import operator_credentials, payload


def ready(origin: str) -> bool:
    with urlopen(origin + "/api/health", timeout=10) as response:
        if response.url != origin + "/api/health" or json.load(response) != {"status": "ok"}:
            return False
    with urlopen(origin + "/api/auth/session", timeout=10) as response:
        if json.load(response) != {"mode": "oracle", "user": None}:
            return False
    try:
        with urlopen(origin + "/api/desk/profiles", timeout=10):
            return False
    except HTTPError as error:
        return error.code == 401


def public_key(agent, outputs: dict, deadline: float) -> bytes:
    import oci

    models = oci.compute_instance_agent.models
    command = agent.create_instance_agent_command(
        models.CreateInstanceAgentCommandDetails(
            compartment_id=outputs["compartment_ocid"],
            execution_time_out_in_seconds=600,
            display_name="agent-desk-bootstrap-public-key",
            target=models.InstanceAgentCommandTarget(instance_id=outputs["instance_id"]),
            content=models.InstanceAgentCommandContent(
                source=models.InstanceAgentCommandSourceViaTextDetails(
                    text="#!/bin/bash\nset -eu\nfor attempt in {1..100}; do\n if test -x /usr/local/sbin/agent-desk-bootstrap-public-key; then exec sudo /usr/local/sbin/agent-desk-bootstrap-public-key; fi\n sleep 5\ndone\nexit 1\n"
                ),
                output=models.InstanceAgentCommandOutputViaTextDetails(),
            ),
        )
    ).data
    while time.monotonic() < deadline:
        try:
            execution = agent.get_instance_agent_command_execution(command.id, outputs["instance_id"]).data
        except oci.exceptions.ServiceError as error:
            if error.status != 404:
                raise
        else:
            if execution.lifecycle_state == "SUCCEEDED":
                raw = execution.content.text.strip().encode()
                if raw == READY.encode():
                    return raw
                from cryptography.hazmat.primitives import serialization
                from cryptography.hazmat.primitives.asymmetric import rsa

                key = serialization.load_pem_public_key(raw)
                if not isinstance(key, rsa.RSAPublicKey) or key.key_size != 3072 or b"PRIVATE KEY" in raw:
                    raise ValueError("Invalid bootstrap public key")
                return raw
            if execution.lifecycle_state in ("FAILED", "TIMED_OUT", "CANCELED"):
                raise RuntimeError("Bootstrap public key command failed")
        time.sleep(10)
    raise RuntimeError("Bootstrap public key command timed out")


def deliver(context: dict, secret: str, deadline: float) -> None:
    import oci

    config, signer = operator_credentials()
    outputs = context["terraform_outputs"]
    config["region"] = context["region"]
    agent = oci.compute_instance_agent.ComputeInstanceAgentClient(config, signer=signer)
    key = public_key(agent, outputs, deadline)
    if key == READY.encode():
        return
    storage = oci.object_storage.ObjectStorageClient(config, signer=signer)
    encrypted = encrypt(key, payload(config, context, secret))
    response = storage.put_object(
        outputs["bootstrap_namespace"], outputs["bootstrap_bucket"], OBJECT, encrypted, if_none_match="*"
    )
    etag = response.headers["etag"]
    try:
        while time.monotonic() < deadline:
            try:
                storage.head_object(outputs["bootstrap_namespace"], outputs["bootstrap_bucket"], OBJECT)
            except oci.exceptions.ServiceError as error:
                if error.status == 404:
                    return
                raise
            time.sleep(10)
        raise RuntimeError("Bootstrap delivery timed out")
    finally:
        try:
            storage.delete_object(
                outputs["bootstrap_namespace"], outputs["bootstrap_bucket"], OBJECT, if_match=etag
            )
        except oci.exceptions.ServiceError as error:
            if error.status != 404:
                raise


def deployment_origin(outputs: dict) -> str:
    address = ipaddress.IPv4Address(outputs["public_ip"])
    if not address.is_global or address.is_multicast or address.is_reserved:
        raise ValueError("Expected the deployed public IPv4")
    origin = f"https://{address}"
    if outputs["application_url"] != origin:
        raise ValueError("Application URL does not match the deployed public IPv4")
    return origin


def run(context: dict, secret: str) -> dict:
    origin = deployment_origin(context["terraform_outputs"])
    deadline = time.monotonic() + 3500
    deliver(context, secret, deadline)
    while time.monotonic() < deadline:
        try:
            if ready(origin):
                return {
                    "outputs": {"application_url": origin},
                    "events": [
                        {
                            "level": "info",
                            "message": "Encrypted bootstrap consumed; Agent Desk HTTPS and Oracle access gate are ready.",
                        }
                    ],
                }
        except (HTTPError, URLError, OSError, ValueError):
            pass
        time.sleep(10)
    raise RuntimeError("Agent Desk HTTPS is not ready")


if __name__ == "__main__":
    try:
        context = json.loads(Path(os.environ["DEPLOY_STUDIO_CONTEXT"]).read_text())
        secret = json.loads(Path(os.environ["DEPLOY_STUDIO_SECRETS"]).read_text())["inputs"][
            "oidc_client_secret"
        ]
        result = run(context, secret)
        Path(os.environ["DEPLOY_STUDIO_OUTPUT"]).write_text(json.dumps(result))
    except Exception:
        raise SystemExit(
            "Agent Desk is not ready. Check encrypted delivery, cloud-init, public IP TLS and Oracle configuration."
        ) from None
