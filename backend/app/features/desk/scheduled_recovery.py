"""Continue only explicitly safe native TEST work; replay never creates a new request."""

import json
import re
from collections.abc import Iterable
from typing import Any


class RecoveryRequired(Exception):
    def __init__(self, response: dict[str, Any] | None = None) -> None:
        super().__init__("La solicitud sigue pendiente o su resultado es desconocido. Recupera la misma ejecución.")
        self.control = pending_control(response)


def pending_control(response: dict[str, Any] | None) -> dict[str, Any]:
    control: dict[str, Any] = {"status": "pending", "resumable": True}
    if response is None:
        return control
    if response.get("continuation_safe") is True:
        control["continuation_safe"] = True
    identity = response.get("pending_request_id")
    if isinstance(identity, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", identity):
        control["pending_request_id"] = identity
    return control


def continuation_safe(response: dict[str, Any], request_id: str) -> bool:
    return response.get("status") == "pending" and response.get("continuation_safe") is True and (
        "pending_request_id" not in response or response["pending_request_id"] == request_id
    )


def canonical_response(packets: Iterable[bytes], request_id: str) -> dict[str, Any]:
    final: dict[str, Any] | None = None
    try:
        for chunk in packets:
            for line in chunk.splitlines():
                packet = json.loads(line)
                if not isinstance(packet, dict):
                    raise RecoveryRequired(final)
                if packet.get("request_id") not in (None, request_id):
                    raise RecoveryRequired(final)
                if packet.get("kind") == "transport_error":
                    raise RecoveryRequired(final)
                # A snapshot needs the full consumer validator before its internal response can be accepted.
                if packet.get("kind") == "response" and packet.get("request_id") == request_id:
                    value = packet.get("response")
                    if isinstance(value, dict):
                        final = value
        if final is None:
            raise RecoveryRequired()
        return final
    except RecoveryRequired:
        raise
    except Exception as error:
        raise RecoveryRequired(final) from error
