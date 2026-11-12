from threading import Lock
from uuid import uuid4

from .schemas import CreateItem, Item


class Store:
    """Ephemeral single-process example; replace when durability is required."""

    def __init__(self) -> None:
        self._items: dict[str, tuple[str, Item]] = {}
        self._lock = Lock()

    def create(self, owner: str, value: CreateItem) -> Item:
        item = Item(id=str(uuid4()), **value.model_dump())
        with self._lock:
            self._items[item.id] = (owner, item)
        return item

    def get(self, actor: str, item_id: str) -> Item | None:
        with self._lock:
            entry = self._items.get(item_id)
        if entry is None or entry[0] != actor:
            return None
        return entry[1]
