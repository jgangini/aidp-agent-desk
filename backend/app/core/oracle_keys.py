"""Read tenant signing keys without changing the domain's certificate-access policy."""

import configparser
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
import oci  # type: ignore[import-untyped]
from authlib.integrations.starlette_client import StarletteOAuth2App  # type: ignore[import-untyped]
from starlette.concurrency import run_in_threadpool


def signing_keys(domain: str) -> dict[str, Any]:
    try:
        parser = configparser.ConfigParser(interpolation=None)
        with Path(os.environ["AGENT_DESK_BASE_CONFIG"]).open(encoding="utf-8-sig") as source:
            parser.read_string(source.read(65537))
        section = parser[os.getenv("AGENT_DESK_BASE_PROFILE", "DEFAULT")]
        config = {name: section[name].strip() for name in ("user", "tenancy", "region", "fingerprint")}
        config["key_file"] = os.environ["AGENT_DESK_BASE_KEY"]
        client = oci.identity_domains.IdentityDomainsClient(config, service_endpoint=domain, timeout=(10, 15))
        result: dict[str, Any] = client.base_client.call_api(
            "/admin/v1/SigningCert/jwk", "GET", response_type="dict"
        ).data
        return result
    except (OSError, KeyError, configparser.Error, oci.exceptions.ClientError, oci.exceptions.ServiceError) as error:
        raise ValueError("No se pudieron obtener las claves de firma Oracle.") from error


def tenant_signing_uri(uri: str, domain: str) -> bool:
    url, expected = urlsplit(uri), urlsplit(domain)
    return (
        url.scheme,
        url.hostname,
        url.port or 443,
        url.path,
        url.query,
        url.fragment,
        url.username,
        url.password,
    ) == (
        "https",
        expected.hostname,
        expected.port or 443,
        "/admin/v1/SigningCert/jwk",
        "",
        "",
        None,
        None,
    )


class OracleOAuth2App(StarletteOAuth2App):  # type: ignore[misc]
    signing_domain: str = ""

    async def fetch_jwk_set(self, force: bool = False) -> dict[str, Any]:
        try:
            result: dict[str, Any] = await super().fetch_jwk_set(force)
            return result
        except httpx.HTTPStatusError as error:
            if (
                error.response.status_code != 401
                or not tenant_signing_uri(str(error.request.url), self.signing_domain)
                or not all(os.getenv(name) for name in ("AGENT_DESK_BASE_CONFIG", "AGENT_DESK_BASE_KEY"))
            ):
                raise
            keys = await run_in_threadpool(signing_keys, self.signing_domain)
            self.server_metadata["jwks"] = keys
            return keys
