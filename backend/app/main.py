import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.access import install_identity
from app.core.identity import IdentitySettings
from app.features.desk.api import create_router
from app.features.desk.credentials import profile_store
from app.features.desk.scheduled_runtime import ScheduledRuntime


@asynccontextmanager
async def lifespan(application: FastAPI):  # type: ignore[no-untyped-def]
    scheduled.start()
    try:
        yield
    finally:
        scheduled.stop()


app = FastAPI(title="Agent Desk", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=os.getenv("ARKO_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(","),
)


@app.get("/api/health", operation_id="health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.middleware("http")
async def limit_configuration_body(request: Request, call_next):  # type: ignore[no-untyped-def]
    if request.method in ("POST", "PUT") and request.url.path.startswith("/api/desk/scheduled-tasks/"):
        size = request.headers.get("content-length", "")
        if not size.isdigit():
            return JSONResponse({"detail": "Se requiere Content-Length."}, status_code=411)
        if int(size) > 32768:
            return JSONResponse({"detail": "La definición de tarea supera el límite de carga."}, status_code=413)
    if request.method == "POST" and request.url.path.startswith("/api/desk/audio/"):
        size = request.headers.get("content-length", "")
        if not size.isdigit():
            return JSONResponse({"detail": "Se requiere Content-Length."}, status_code=411)
        if int(size) > 8 * 1024 * 1024 + 65536:
            return JSONResponse({"detail": "El audio supera el límite de carga."}, status_code=413)
    if request.method == "POST" and (
        request.url.path == "/api/desk/profiles" or request.url.path.startswith("/api/desk/discovery/")
    ):
        size = request.headers.get("content-length", "")
        if not size.isdigit():
            return JSONResponse(
                {"detail": "Se requiere Content-Length para configurar agentes."}, status_code=411
            )
        if int(size) > 100000:
            return JSONResponse({"detail": "Los archivos superan el límite de carga."}, status_code=413)
    response = await call_next(request)
    if request.url.path.startswith("/api/desk/scheduled-tasks"):
        response.headers["Cache-Control"] = "no-store"
    return response


store = profile_store()
if store.connection_managed:
    store.draft()
install_identity(app, IdentitySettings.load(), store.list)
scheduled = ScheduledRuntime(store, lambda: app.state.identity)
app.state.scheduled = scheduled
app.include_router(create_router(store, scheduled))
static = Path(os.getenv("ARKO_STATIC_DIR", "frontend/dist"))
if static.is_dir():
    app.mount("/", StaticFiles(directory=static, html=True), name="frontend")
