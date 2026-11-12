from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user

from .schemas import CreateItem, Item
from .service import Store


def create_router(store: Store) -> APIRouter:
    router = APIRouter(prefix="/api/__feature__", tags=["__feature__"])

    @router.post("", response_model=Item, status_code=201, operation_id="create___feature__")
    def create(value: CreateItem, actor: Annotated[str, Depends(current_user)]) -> Item:
        return store.create(actor, value)

    @router.get("/{item_id}", response_model=Item, operation_id="get___feature__")
    def get(item_id: str, actor: Annotated[str, Depends(current_user)]) -> Item:
        item = store.get(actor, item_id)
        if item is None:
            raise HTTPException(404, "Item not found")
        return item

    return router
