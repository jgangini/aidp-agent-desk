"""Translate only protocol correlation fields across the user boundary."""

import json
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException, Request

from app.core.access import scoped_session

from .schemas import InvokeRequest


def invocation_scope(
    request: Request, value: InvokeRequest
) -> tuple[InvokeRequest, Callable[[bytes], bytes]]:
    identity = getattr(request.app.state, "identity", None)
    if identity is None:
        return value, lambda chunk: chunk
    if not value.session_id:
        raise HTTPException(422, "Se requiere una sesión estable para conversar con el agente.")
    target = ("test:" if value.surface == "TEST" else "") + value.profile_id
    try:
        native, mapping = identity.store.request_ids(
            request.state.principal["id"],
            target,
            value.session_id,
            value.request_id,
            value.action == "research",
        )
    except ValueError as error:
        raise HTTPException(403, str(error)) from error
    scoped = value.model_copy(
        update={
            "session_id": scoped_session(request, value.profile_id, value.session_id, value.surface),
            "request_id": native,
        }
    )

    def fields(item: dict[str, Any], names: tuple[str, ...]) -> None:
        for name in names:
            if item.get(name):
                if item[name] not in mapping:
                    raise ValueError("Unknown upstream request identity")
                item[name] = mapping[item[name]]

    def restore(chunk: bytes) -> bytes:
        packet = json.loads(chunk)
        fields(packet, ("request_id", "turn_id"))
        if isinstance(packet.get("event"), dict):
            fields(packet["event"], ("turn_id",))
        if isinstance(packet.get("response"), dict):
            fields(packet["response"], ("pending_request_id", "request_id"))
        replay = packet.get("replay") or {}
        for event in replay.get("events", []):
            fields(event, ("turn_id",))
        snapshot = replay.get("snapshot") or {}
        for inventory in ("blocks", "activities", "activity"):
            for event in snapshot.get(inventory, {}).values():
                fields(event, ("turn_id",))
        packet["session_id"] = value.session_id
        return (json.dumps(packet, ensure_ascii=False, separators=(",", ":")) + "\n").encode()

    return scoped, restore
