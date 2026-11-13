"""Administrator declarations of report compatibility, scoped to a saved target."""

import os
import re
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from app.core.local_config import local_configuration

from .credentials import ProfileStore
from .schemas import AgentProfile


class ReportSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prod: bool = Field(default=False, strict=True)
    test: bool = Field(default=False, strict=True)


def report_settings(store: ProfileStore, identity: str) -> ReportSettings:
    if not re.fullmatch(r"[a-f0-9]{32}", identity):
        return ReportSettings()
    target = store.root / identity / "reports.json"
    with store.lock:
        if target.is_symlink() or target.parent.is_symlink():
            return ReportSettings()
        try:
            return ReportSettings.model_validate_json(target.read_text(encoding="utf-8"))
        except FileNotFoundError:
            configured = {value.strip() for value in os.getenv("AGENT_DESK_REPORT_PROFILES", "").split(",")}
            return ReportSettings(prod=identity in configured, test="test:" + identity in configured)
        except (OSError, ValueError):
            return ReportSettings()


def report_settings_router(store: ProfileStore) -> APIRouter:
    router = APIRouter()

    def profile_for(identity: str) -> AgentProfile:
        profile = next((item for item in store.list() if item.id == identity), None)
        if profile is None or not re.fullmatch(r"[a-f0-9]{32}", identity):
            raise HTTPException(404, "Agent Flow no encontrado.")
        return profile

    @router.get("/profiles/{identity}/reports", response_model=ReportSettings,
                operation_id="desk_report_settings")
    def read(identity: str, response: Response) -> ReportSettings:
        profile_for(identity)
        response.headers["Cache-Control"] = "no-store"
        return report_settings(store, identity)

    @router.put("/profiles/{identity}/reports", response_model=ReportSettings,
                operation_id="desk_report_settings_save", dependencies=[Depends(local_configuration)])
    def save(identity: str, value: ReportSettings, response: Response) -> ReportSettings:
        profile = profile_for(identity)
        if value.prod and profile.surface != "PROD":
            raise HTTPException(422, "Este Agent Flow no tiene un destino PROD.")
        if value.test and not (profile.instance_id and profile.workspace_id):
            raise HTTPException(422, "Este Agent Flow no tiene un destino TEST configurado.")
        target = store.root / identity / "reports.json"
        with store.lock:
            if not target.parent.is_dir() or target.parent.is_symlink() or target.is_symlink():
                raise HTTPException(404, "Agent Flow no encontrado.")
            temporary = target.with_name(f".reports-{uuid4().hex}.tmp")
            try:
                with temporary.open("x", encoding="utf-8") as file:
                    file.write(value.model_dump_json())
                temporary.chmod(0o600)
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
        response.headers["Cache-Control"] = "no-store"
        return value

    return router
