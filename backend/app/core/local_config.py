from fastapi import HTTPException, Request

LOCAL_ORIGINS = {f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (8317, 5178)}


def local_configuration(request: Request) -> None:
    identity = getattr(request.app.state, "identity", None)
    if identity is not None:
        if (getattr(request.state, "principal", None) is not None
                and request.headers.get("origin") == identity.settings.origin
                and request.headers.get("x-agent-desk") == "configure"):
            return
        raise HTTPException(403, "Inicia sesión desde Agent Desk.")
    # The local admin UI requires a non-simple header and exact Origin; no cross-origin CORS is enabled.
    if (
        request.headers.get("origin") not in LOCAL_ORIGINS
        or request.headers.get("x-agent-desk") != "configure"
    ):
        raise HTTPException(
            403, "La configuración solo está disponible desde la interfaz local de Agent Desk."
        )
