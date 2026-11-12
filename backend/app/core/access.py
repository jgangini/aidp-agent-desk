import hashlib
import hmac
import re
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware

from .directory import DIRECTORY_FAILURES
from .identity import Identity, IdentitySettings, UserAccess, UserInvitation, identity_router


def require_profile(request: Request, profile_id: str) -> None:
    identity = getattr(request.app.state, "identity", None)
    if identity is not None:
        user = getattr(request.state, "principal", None)
        if user is None or not identity.store.permitted(user, profile_id):
            raise HTTPException(403, "No tienes permiso para usar este agente.")


def visible_profiles(request: Request, profiles: list[Any]) -> list[Any]:
    identity = getattr(request.app.state, "identity", None)
    if identity is None:
        return profiles
    if request.state.principal["role"] == "admin":
        return [profile for profile in profiles if identity.store.permitted(request.state.principal, profile.id)]
    return [
        profile.model_copy(update={"instance_id": "", "workspace_id": ""})
        for profile in profiles
        if profile.surface != "TEST" and identity.store.permitted(request.state.principal, profile.id)
    ]


def scoped_session(request: Request, profile: str, session: str, surface: str = "PROD") -> str:
    identity = request.app.state.identity
    material = "\0".join((identity.settings.domain, request.state.principal["id"], profile, surface, session))
    return hmac.new(identity.settings.secret.encode(), material.encode(), hashlib.sha256).hexdigest()


def member_endpoint(method: str, path: str) -> bool:
    if method in ("GET", "PUT", "POST", "DELETE") and re.fullmatch(
        r"/api/desk/scheduled-tasks(?:/[a-zA-Z0-9_-]+(?:/run|/template|/runs(?:/[a-zA-Z0-9_-]+(?:/recover)?)?)?)?", path
    ):
        return True
    if method == "GET":
        return (
            path in ("/api/desk/profiles", "/api/desk/connection")
            or re.fullmatch(r"/api/desk/suggestions/(?:[a-f0-9]{32}|demo)", path) is not None
        )
    return method == "POST" and path in (
        "/api/desk/stream",
        "/api/desk/audio/realtime-session",
        "/api/desk/audio/speech",
        "/api/desk/audio/transcribe",
    )


def authorize_request(
    request: Request, identity: Identity, settings: IdentitySettings
) -> JSONResponse | None:
    user = identity.principal(request)
    if user is None:
        return JSONResponse({"detail": "Inicia sesión con Oracle."}, status_code=401)
    request.state.principal = user
    if request.headers.get("x-agent-desk-user") != user["id"]:
        return JSONResponse({"detail": "La cuenta cambió. Recarga Agent Desk."}, status_code=409)
    if request.method not in ("GET", "HEAD") and (
        request.headers.get("origin") != settings.origin or request.headers.get("x-agent-desk") != "configure"
    ):
        return JSONResponse({"detail": "Solicitud de otro origen."}, status_code=403)
    if user["role"] != "admin" and not member_endpoint(request.method, request.url.path):
        return JSONResponse({"detail": "Se requiere permiso de administrador."}, status_code=403)
    return None


def install_identity(
    app: FastAPI, settings: IdentitySettings | None, profiles: Callable[[], list[Any]]
) -> None:
    identity = Identity(settings) if settings else None
    app.state.identity = identity
    app.include_router(identity_router(identity))
    if settings is not None:
        app.add_middleware(
            SessionMiddleware,
            secret_key=settings.secret,
            session_cookie="__Host-agent-desk-oidc" if settings.secure_cookie else "agent-desk-loopback-oidc",
            max_age=600,
            https_only=settings.secure_cookie,
            same_site="lax",
        )

    @app.middleware("http")
    async def access_gate(request: Request, call_next: Any) -> Any:
        if identity is None or settings is None:
            return await call_next(request)
        path = request.url.path
        if path.startswith("/api/desk") or path.startswith("/api/admin"):
            denied = authorize_request(request, identity, settings)
            if denied is not None:
                return denied
        response = await call_next(request)
        if path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    app.include_router(administration_router(identity, profiles))


def administration_router(identity: Identity | None, profiles: Callable[[], list[Any]]) -> APIRouter:
    router = APIRouter(prefix="/api/admin", tags=["administration"])

    @router.get("/user-management", operation_id="admin_user_management")
    def management() -> dict[str, bool]:
        return {
            "directory_available": identity is not None and identity.directory is not None,
            "allow_create": identity is not None and identity.settings.create_users,
        }

    @router.get("/directory-users", operation_id="admin_directory_users")
    def directory_users(
        q: str = Query(min_length=2, max_length=254, pattern=r"^[^\x00-\x1f\x7f]+$"),
    ) -> list[dict[str, str]]:
        if identity is None or identity.directory is None:
            raise HTTPException(503, "La búsqueda de usuarios del dominio no está configurada.")
        try:
            return identity.directory.search(q)
        except DIRECTORY_FAILURES as error:
            raise HTTPException(
                503, "No se pudo consultar Oracle. Revisa los permisos del servidor."
            ) from error

    @router.post("/users", status_code=204, operation_id="admin_user_add")
    def add(value: UserInvitation) -> None:
        add_directory_user(identity, value, profiles)

    @router.get("/users", operation_id="admin_users")
    def users() -> list[dict[str, Any]]:
        if identity is None:
            raise HTTPException(404)
        result = identity.store.users()
        for user in result:
            user["enabled"] = bool(user["enabled"])
            user["profiles"] = [p.id for p in profiles() if identity.store.permitted(user, p.id)]
        return result

    @router.put("/users", status_code=204, operation_id="admin_user_save")
    def save(value: UserAccess) -> None:
        if identity is None:
            raise HTTPException(404)
        if identity.directory is not None and not any(
            u["subject"] == value.subject for u in identity.store.users()
        ):
            raise HTTPException(422, "Agrega la cuenta por su correo antes de editar sus permisos.")
        available = {p.id for p in profiles() if p.surface != "TEST"}
        if not set(value.profiles).issubset(available):
            raise HTTPException(422, "Selecciona agentes publicados disponibles.")
        try:
            identity.store.save_user(value.subject, value.email, value.enabled, value.profiles)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error

    return router


def add_directory_user(
    identity: Identity | None, value: UserInvitation, profiles: Callable[[], list[Any]]
) -> None:
    if identity is None or identity.directory is None:
        raise HTTPException(503, "La gestión de usuarios del dominio no está configurada.")
    available = {p.id for p in profiles() if p.surface != "TEST"}
    if not set(value.profiles).issubset(available):
        raise HTTPException(422, "Selecciona agentes publicados disponibles.")
    if value.create_in_directory and not identity.settings.create_users:
        raise HTTPException(403, "Crear usuarios está deshabilitado en esta instalación.")
    from .directory import DirectoryError

    try:
        user = identity.directory.resolve(value.email, value.create_in_directory)
        subject = "directory:" + user["id"]
        enrolled = any(member["subject"] == subject for member in identity.store.users())
        if value.create_in_directory and user["owned"] and not enrolled:
            identity.directory.activate(user)
        identity.store.save_user(subject, user["email"], True, value.profiles)
    except (DirectoryError, ValueError) as error:
        raise HTTPException(422, str(error)) from None
    except DIRECTORY_FAILURES as error:
        raise HTTPException(
            503, "No se pudo verificar el usuario en Oracle. Revisa los permisos del servidor."
        ) from error
