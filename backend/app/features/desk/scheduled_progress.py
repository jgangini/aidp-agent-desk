"""Bounded public activity projection and replay correlation for report runs."""

from collections.abc import Callable
from typing import Any

from .scheduled_schemas import RunActivity


def event_identity(item: Any, request_id: str, cursor: int | None) -> None:
    if (not isinstance(item, dict) or item.get("turn_id") != request_id
            or not isinstance(item.get("event_id"), str) or not item["event_id"]
            or type(item.get("sequence")) is not int or not 1 <= item["sequence"] <= 9007199254740991
            or cursor is not None and item["sequence"] > cursor):
        raise ValueError("Invalid public event identity")


def activity_state(presentation: dict[str, Any], phase: Any) -> tuple[str, Any]:
    activity = presentation["activity"]
    if (not isinstance(activity, dict) or presentation.get("schema_version") != "1.0"
            or presentation.get("purpose") != "progress" or not isinstance(activity.get("activity_id"), str)
            or not activity["activity_id"] or phase != activity.get("phase")):
        raise ValueError("Invalid public activity")
    valid_states = {("retrieving", "running", None), ("pending", "pending", "pending"),
                    ("failed", "failed", "failed"), *(
                        (name, "completed", outcome) for name in ("retrieved", "reused")
                        for outcome in ("available", "empty", "insufficient", "unavailable", "query_rejected"))}
    if (activity.get("phase"), activity.get("state"), activity.get("outcome")) not in valid_states:
        raise ValueError("Contradictory activity state")
    return activity["activity_id"], activity.get("state")


def activity_view(item: dict[str, Any]) -> RunActivity | None:
    text, source, coverage = item.get("text"), item.get("source_key"), item.get("coverage", {})
    if not isinstance(text, str) or not text.strip() or not isinstance(coverage, dict):
        return None
    presentation = coverage.get("presentation") or {}
    if isinstance(presentation, dict) and presentation.get("activity") is not None:
        identity, state = activity_state(presentation, coverage.get("phase"))
    else:
        identity = source if isinstance(source, str) and source else item["event_id"]
        state = {"retrieving": "running", "pending": "pending", "failed": "failed"}.get(str(coverage.get("phase")), "completed")
    return RunActivity.model_validate({"id": identity, "text": text[:2000], "state": state,
                       **({"source": source[:128]} if isinstance(source, str) and source else {})})


class ReportProgress:
    def __init__(self, request_id: str, save: Callable[[list[dict[str, Any]]], None] | None = None) -> None:
        self.request_id, self.save = request_id, save
        self.items: dict[str, tuple[int, RunActivity]] = {}

    def accept(self, packet: dict[str, Any]) -> None:
        if packet.get("kind") == "event":
            self.event(packet.get("event"))
        elif packet.get("kind") == "snapshot":
            self.snapshot(packet)

    def snapshot(self, packet: dict[str, Any]) -> None:
        if packet.get("request_id") != self.request_id:
            raise ValueError("Replay belongs to another request")
        replay = packet.get("replay")
        if not isinstance(replay, dict) or type(replay.get("cursor")) is not int or not 0 <= replay["cursor"] <= 9007199254740991:
            raise ValueError("Invalid replay cursor")
        cursor = replay["cursor"]
        events = replay.get("events")
        if not isinstance(events, list) or len(events) > 4096:
            raise ValueError("Invalid replay events")
        snapshot = replay.get("snapshot")
        if snapshot is not None:
            self.inventory(snapshot, cursor)
        elif len(events) != cursor or any(
            not isinstance(item, dict) or item.get("sequence") != index
            for index, item in enumerate(events, 1)
        ):
            # Report recovery always requests after_sequence=0; gaps require a full snapshot.
            raise ValueError("Incomplete replay history")
        for item in events:
            self.event(item, cursor)

    def inventory(self, snapshot: Any, cursor: int) -> None:
        if not isinstance(snapshot, dict):
            raise ValueError("Invalid replay snapshot")
        for name in ("blocks", "activities", "activity"):
            inventory = snapshot.get(name, {})
            if not isinstance(inventory, dict) or len(inventory) > 4096:
                raise ValueError("Invalid snapshot inventory")
            for item in inventory.values():
                self.event(item, cursor)

    def event(self, item: Any, cursor: int | None = None) -> None:
        event_identity(item, self.request_id, cursor)
        if item.get("type") != "source.coverage":
            return
        value = activity_view(item)
        if value is None:
            return
        prior = self.items.get(value.id)
        if prior is not None and prior[0] >= item["sequence"]:
            return
        self.items[value.id] = (item["sequence"], value)
        if len(self.items) > 200:
            del self.items[next(iter(self.items))]
        if self.save is not None:
            self.save([entry.model_dump(exclude_none=True) for _, entry in self.items.values()])
