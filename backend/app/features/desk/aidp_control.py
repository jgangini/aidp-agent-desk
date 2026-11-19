"""Signed control-plane requests with bounded, non-secret failure diagnostics."""

import json
import logging
import re
from typing import Any

from .credentials import segment

LOGGER = logging.getLogger(__name__)


def bounded_content(response: Any, limit: int) -> bytes | None:
    if not hasattr(response, 'iter_content'):
        content = getattr(response, 'content', b'')
        return content if isinstance(content, bytes) and len(content) <= limit else None
    content = bytearray()
    for chunk in response.iter_content(chunk_size=65536):
        content.extend(chunk)
        if len(content) > limit:
            return None
    return bytes(content)


def safe_header(value: Any) -> str:
    return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_./:-]{1,256}", value) else ""


class ControlError(ValueError):
    def __init__(self, operation: str, status: int | None = None, code: str = "") -> None:
        self.status, self.code = status, code
        detail = f"HTTP {status}" if status is not None else "respuesta incompatible"
        super().__init__(f"No se pudo {operation} ({detail}{' · ' + code if code else ''}).")


def collection_page(data: dict[str, Any], headers: Any) -> tuple[list[dict[str, Any]], str | None]:
    batch = data.get("items")
    if not isinstance(batch, list) or len(batch) > 100 or any(not isinstance(row, dict) for row in batch):
        raise ControlError("consultar los destinos del compute")
    page = headers.get("opc-next-page")
    if not page:
        return batch, None
    if (not isinstance(page, str) or len(page) > 4096
            or any(ord(character) < 32 or ord(character) >= 127 for character in page)):
        raise ControlError("consultar los destinos del compute")
    return batch, page


class AidpControl:
    def __init__(self, region: str, instance: str, workspace: str, session: Any, signer: Any) -> None:
        if not re.fullmatch(r"[a-z]{2,4}-[a-z]+-\d", region):
            raise ValueError("La región AIDP no es válida.")
        self.base = f"https://datalake.{region}.oci.oraclecloud.com"
        self.ws = f"/aiDataPlatforms/{segment(instance)}/workspaces/{segment(workspace)}"
        self.session, self.signer = session, signer
        self.headers: Any = {}
        self.status = 0

    def request(self, method: str, path: str, *, legacy: bool = False,
                operation: str = "consultar TEST en AIDP", empty: bool = False, **kwargs: Any) -> dict[str, Any]:
        version = "20240831" if legacy else "20260430"
        workspace = self.ws.replace("/aiDataPlatforms/", "/dataLakes/", 1) if legacy else self.ws
        with self.session.request(method, f"{self.base}/{version}{workspace}{path}", auth=self.signer,
                                  timeout=(5, 20), allow_redirects=False, stream=True, **kwargs) as response:
            self.status, self.headers = response.status_code, response.headers
            content = bounded_content(response, 2 * 1024 * 1024 if 200 <= response.status_code < 300 else 65536)
            if not 200 <= response.status_code < 300:
                raise self.failure(operation, method, path, response, content)
            if content is None:
                raise ControlError(operation)
            if empty and not content:
                return {}
            try:
                data = json.loads(content)
            except ValueError:
                raise ControlError(operation) from None
            if not isinstance(data, dict):
                raise ControlError(operation)
            return data

    @staticmethod
    def failure(operation: str, method: str, path: str, response: Any, content: bytes | None) -> ControlError:
        code = ""
        if content is not None:
            try:
                data = json.loads(content)
                candidate = data.get("code") if isinstance(data, dict) else None
                if isinstance(candidate, str) and re.fullmatch(r"[A-Za-z0-9_]{1,64}", candidate):
                    code = candidate
            except ValueError:
                pass
        LOGGER.warning("AIDP control failure operation=%s method=%s path=%s status=%s code=%s request_id=%s",
                       operation, method, path, response.status_code, code,
                       safe_header(response.headers.get("opc-request-id")))
        return ControlError(operation, response.status_code, code)

    def pages(self, path: str, *, legacy: bool = False, **params: Any) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        page = None
        for _ in range(50):
            data = self.request("GET", path, legacy=legacy, operation="consultar los destinos del compute",
                                params={**params, "limit": 100, **({"page": page} if page else {})})
            batch, page = collection_page(data, self.headers)
            rows.extend(batch)
            if not page:
                return rows
        raise ControlError("consultar los destinos del compute")
