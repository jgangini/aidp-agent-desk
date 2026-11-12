import re
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.access import require_profile
from app.core.local_config import local_configuration

from .credentials import ProfileStore
from .schemas import QuerySuggestion, QuerySuggestions

DEFAULT_SUGGESTIONS = QuerySuggestions(
    items=[
        QuerySuggestion(title="Explorar tendencias", query="Analiza las tendencias de IA en Latinoamérica"),
        QuerySuggestion(title="Comparar fuentes", query="Compara las señales de redes sociales"),
        QuerySuggestion(title="Resumir hallazgos", query="Resume los hallazgos de investigación"),
        QuerySuggestion(title="Explorar mercados", query="Investiga una oportunidad de mercado"),
        QuerySuggestion(title="Revisar noticias", query="Resume las noticias y sus fuentes"),
        QuerySuggestion(title="Investigar una marca", query="Compara la presencia pública de una marca"),
        QuerySuggestion(title="Analizar videos", query="Analiza las tendencias de contenido en YouTube"),
        QuerySuggestion(title="Detectar señales", query="Identifica señales emergentes en redes sociales"),
        QuerySuggestion(title="Contexto financiero", query="Revisa el contexto financiero del mercado"),
    ]
)


def suggestions_router(store: ProfileStore) -> APIRouter:
    router = APIRouter()

    def path(identity: str) -> Path:
        if identity == "demo":
            return store.root / ".demo-suggestions.json"
        if not re.fullmatch(r"[a-f0-9]{32}", identity) or not any(
            profile.id == identity for profile in store.list()
        ):
            raise HTTPException(404, "No se encontró el Agent Flow.")
        return store.root / identity / "suggestions.json"

    @router.get("/suggestions/{identity}", response_model=QuerySuggestions, operation_id="desk_suggestions")
    def read(identity: str, request: Request) -> QuerySuggestions:
        require_profile(request, identity)
        target = path(identity)
        with store.lock:
            if not target.exists():
                return DEFAULT_SUGGESTIONS if identity == "demo" else QuerySuggestions(items=[])
            return QuerySuggestions.model_validate_json(target.read_text(encoding="utf-8"))

    @router.put(
        "/suggestions/{identity}",
        response_model=QuerySuggestions,
        operation_id="desk_suggestions_save",
        dependencies=[Depends(local_configuration)],
    )
    def save(identity: str, data: QuerySuggestions) -> QuerySuggestions:
        target = path(identity)
        with store.lock:
            if identity == "demo":
                target.parent.mkdir(parents=True, exist_ok=True)
            if not target.parent.is_dir() or target.parent.is_symlink():
                raise HTTPException(404, "No se encontró el Agent Flow.")
            temporary = target.with_name(f".suggestions-{uuid4().hex}.tmp")
            try:
                temporary.write_text(data.model_dump_json(), encoding="utf-8")
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
        return data

    return router
