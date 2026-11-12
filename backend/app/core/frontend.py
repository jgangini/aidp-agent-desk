"""Public SPA shell with deployment-specific, crawler-readable image URLs."""

from html import escape
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles


def install_frontend(app: FastAPI, directory: Path, origin: str = "") -> None:
    if not directory.is_dir():
        return
    index = directory / "index.html"
    if index.is_file():
        document = index.read_text(encoding="utf-8").replace(
            'content="/social/', f'content="{escape(origin.rstrip("/"), quote=True)}/social/'
        )

        @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
        @app.api_route("/index.html", methods=["GET", "HEAD"], include_in_schema=False)
        async def frontend_index() -> HTMLResponse:
            return HTMLResponse(document, headers={"Cache-Control": "no-cache"})

    app.mount("/", StaticFiles(directory=directory, html=True), name="frontend")
