"""Oracle OIDC login and application sessions, enabled explicitly for hosted installations."""

import logging
import os
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from authlib.integrations.starlette_client import OAuth, OAuthError  # type: ignore[import-untyped]
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse, Response
from joserfc.errors import JoseError
from pydantic import BaseModel, ConfigDict, Field

from .access_store import AccessStore
from .directory import DIRECTORY_FAILURES, OracleDirectory
from .oracle_keys import OracleOAuth2App

COOKIE = "__Host-agent-desk"
logger = logging.getLogger(__name__)


def validate_identity_origin(value: str, allow_loopback: bool = False) -> None:
    url = urlsplit(value)
    permitted = url.scheme == "https" or (
        allow_loopback and url.scheme == "http" and url.hostname in ("127.0.0.1", "localhost")
    )
    if (
        not permitted
        or not url.hostname
        or url.path not in ("", "/")
        or any((url.username, url.password, url.query, url.fragment))
    ):
        raise RuntimeError("Public origin and Oracle issuer must be HTTPS origins")


@dataclass(frozen=True)
class IdentitySettings:
    origin: str
    domain: str
    client_id: str
    client_secret: str
    secret: str
    administrator: str
    allow_loopback_http: bool = False
    directory_login: bool = False
    create_users: bool = False

    @property
    def secure_cookie(self) -> bool:
        return not (self.allow_loopback_http and self.origin.startswith("http://"))

    @property
    def cookie_name(self) -> str:
        return COOKIE if self.secure_cookie else "agent-desk-loopback"

    @classmethod
    def load(cls) -> "IdentitySettings | None":
        mode = os.getenv("AGENT_DESK_AUTH_MODE", "local")
        if mode == "local":
            return None
        if mode != "oracle":
            raise RuntimeError("AGENT_DESK_AUTH_MODE must be local or oracle")
        values = [
            os.environ.get("AGENT_DESK_" + name, "").strip()
            for name in (
                "PUBLIC_ORIGIN",
                "OIDC_DOMAIN",
                "OIDC_CLIENT_ID",
                "OIDC_CLIENT_SECRET",
                "SESSION_SECRET",
                "ADMIN_SUBJECT",
            )
        ]
        if not all(values) or len(values[4]) < 32:
            raise RuntimeError(
                "Oracle login requires complete server configuration and a strong session secret"
            )
        allow_loopback = os.getenv("AGENT_DESK_ALLOW_LOOPBACK_HTTP", "0") == "1"
        for index, value in enumerate(values[:2]):
            validate_identity_origin(value, allow_loopback and index == 0)
        values[0], values[1] = values[0].rstrip("/"), values[1].rstrip("/")
        directory_login = os.getenv("AGENT_DESK_DIRECTORY_LOGIN", "0") == "1"
        create_users = os.getenv("AGENT_DESK_CREATE_USERS", "disabled")
        if create_users not in ("enabled", "disabled") or (create_users == "enabled" and not directory_login):
            raise RuntimeError("Account creation requires directory login and an explicit enabled setting")
        return cls(
            values[0],
            values[1],
            values[2],
            values[3],
            values[4],
            values[5],
            allow_loopback,
            directory_login,
            create_users == "enabled",
        )


class UserAccess(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    subject: str = Field(min_length=1, max_length=256)
    email: str = Field(default="", max_length=254)
    enabled: bool = True
    profiles: list[str] = Field(max_length=200)


class UserInvitation(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    email: str = Field(
        min_length=3, max_length=254, pattern=r"^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+$"
    )
    profiles: list[str] = Field(max_length=200)
    create_in_directory: bool = Field(default=False, strict=True)


class Identity:
    def __init__(self, settings: IdentitySettings) -> None:
        self.settings = settings
        self.directory = (
            OracleDirectory(settings.domain, settings.client_id, settings.create_users)
            if settings.directory_login
            else None
        )
        self.store = AccessStore(
            Path(os.getenv("AGENT_DESK_DATA_DIR", ".local/agent-desk")) / "access.sqlite3",
            settings.domain,
            settings.administrator,
        )
        oauth = OAuth()
        self.provider: Any = oauth.register(
            "oracle",
            client_cls=OracleOAuth2App,
            client_id=settings.client_id,
            client_secret=settings.client_secret,
            server_metadata_url=settings.domain + "/.well-known/openid-configuration",
            client_kwargs={"scope": "openid profile email", "code_challenge_method": "S256", "timeout": 15},
        )
        self.provider.signing_domain = settings.domain

    def principal(self, request: Request) -> dict[str, Any] | None:
        return self.store.user(request.cookies.get(self.settings.cookie_name, ""))


async def complete_login(identity: Identity, request: Request) -> RedirectResponse:
    metadata = await identity.provider.load_server_metadata()
    expected_issuer = metadata["issuer"]
    token = await identity.provider.authorize_access_token(
        request, claims_options={"iss": {"values": [expected_issuer]}}
    )
    claims = token.get("userinfo", {})
    if claims.get("iss") != expected_issuer or not claims.get("sub"):
        raise ValueError("Invalid issuer or subject")
    subject = str(claims["sub"])
    email = str(claims.get("email", ""))[:254]
    if identity.directory is not None:
        from starlette.concurrency import run_in_threadpool

        subject, email = await run_in_threadpool(identity.directory.login_identity, subject)
    session_token = identity.store.login(subject, email)
    if session_token is None:
        logger.warning(
            "Oracle subject not enabled (sha256:%s)", sha256(str(claims["sub"]).encode()).hexdigest()[:16]
        )
        return RedirectResponse("/?login=denied", status_code=303)
    identity.store.logout(request.cookies.get(identity.settings.cookie_name, ""))
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        identity.settings.cookie_name,
        session_token,
        max_age=28800,
        httponly=True,
        secure=identity.settings.secure_cookie,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"
    return response


def identity_router(identity: Identity | None) -> APIRouter:
    router = APIRouter(prefix="/api/auth", tags=["identity"])

    @router.get("/session", operation_id="identity_session")
    def session(request: Request, response: Response) -> dict[str, Any]:
        response.headers["Cache-Control"] = "no-store"
        user = identity.principal(request) if identity else None
        return {
            "mode": "oracle" if identity else "local",
            "user": ({key: user[key] for key in ("id", "email", "role")} if user else None),
        }

    @router.post("/login", operation_id="identity_login")
    async def login(request: Request) -> RedirectResponse:
        if identity is None:
            raise HTTPException(409, "El acceso Oracle todavía no está configurado en este servidor.")
        if request.headers.get("origin") != identity.settings.origin:
            raise HTTPException(403, "Abre el acceso desde Agent Desk.")
        request.session.clear()
        try:
            return await identity.provider.authorize_redirect(  # type: ignore[no-any-return]
                request, identity.settings.origin + "/api/auth/callback", prompt="login"
            )
        except (OAuthError, OSError, httpx.HTTPError):
            raise HTTPException(502, "No se pudo iniciar el acceso Oracle.") from None

    @router.get("/callback", operation_id="identity_callback")
    async def callback(request: Request) -> RedirectResponse:
        if identity is None:
            raise HTTPException(404)
        try:
            return await complete_login(identity, request)
        except (OAuthError, JoseError, ValueError, KeyError, httpx.HTTPError, *DIRECTORY_FAILURES) as error:
            logger.warning("Oracle callback rejected (%s)", type(error).__name__)
            return RedirectResponse("/?login=failed", status_code=303)
        finally:
            request.session.clear()

    @router.post("/logout", status_code=204, operation_id="identity_logout")
    def logout(request: Request) -> Response:
        if identity is not None:
            if request.headers.get("origin") != identity.settings.origin:
                raise HTTPException(403)
            user = identity.principal(request)
            if user is not None and request.headers.get("x-agent-desk-user") != user["id"]:
                raise HTTPException(409, "La cuenta cambió. Recarga Agent Desk.")
            identity.store.logout(request.cookies.get(identity.settings.cookie_name, ""))
            request.session.clear()
        response = Response(status_code=204)
        response.delete_cookie(
            identity.settings.cookie_name if identity else COOKIE,
            secure=identity.settings.secure_cookie if identity else True,
            httponly=True,
            samesite="lax",
        )
        return response

    return router
