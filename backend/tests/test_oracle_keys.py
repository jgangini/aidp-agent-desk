import asyncio

import httpx
import oci
import pytest
from authlib.integrations.starlette_client import OAuth
from test_profiles import credentials as credentials

from app.core import oracle_keys
from app.core.oracle_keys import OracleOAuth2App, tenant_signing_uri


@pytest.mark.parametrize(
    "uri,accepted",
    [
        ("https://id.example:443/admin/v1/SigningCert/jwk", True),
        ("https://id.example/admin/v1/SigningCert/jwk", True),
        ("https://other.example/admin/v1/SigningCert/jwk", False),
        ("http://id.example/admin/v1/SigningCert/jwk", False),
        ("https://id.example/keys", False),
        ("https://id.example/admin/v1/SigningCert/jwk?other=1", False),
        ("https://user@id.example/admin/v1/SigningCert/jwk", False),
    ],
)
def test_signing_fallback_is_pinned_to_the_configured_tenant(uri, accepted):
    assert tenant_signing_uri(uri, "https://id.example") == accepted


@pytest.mark.parametrize(
    "status,uri,configured,reads",
    [
        (401, "https://id.example/admin/v1/SigningCert/jwk", True, 1),
        (200, "https://id.example/admin/v1/SigningCert/jwk", True, 0),
        (403, "https://id.example/admin/v1/SigningCert/jwk", True, 0),
        (401, "https://other.example/admin/v1/SigningCert/jwk", True, 0),
        (401, "https://id.example/admin/v1/SigningCert/jwk", False, 0),
    ],
)
def test_restricted_signing_keys_are_read_signed_and_cached(monkeypatch, status, uri, configured, reads):
    monkeypatch.setenv("AGENT_DESK_BASE_CONFIG", "config" if configured else "")
    monkeypatch.setenv("AGENT_DESK_BASE_KEY", "key" if configured else "")
    calls = []
    keys = {"keys": [{"kid": "test"}]}
    monkeypatch.setattr(oracle_keys, "signing_keys", lambda domain: calls.append(domain) or keys)
    app = OAuth().register("oracle", client_cls=OracleOAuth2App, jwks_uri=uri)
    app.signing_domain = "https://id.example"
    app.client_kwargs["transport"] = httpx.MockTransport(lambda request: httpx.Response(status, json=keys))
    if status == 200 or reads:
        assert asyncio.run(app.fetch_jwk_set()) == keys
        assert asyncio.run(app.fetch_jwk_set()) == keys
    else:
        with pytest.raises(httpx.HTTPStatusError):
            asyncio.run(app.fetch_jwk_set())
    assert len(calls) == reads


def test_signing_reader_uses_read_only_base_and_converts_service_failure(tmp_path, monkeypatch, credentials):
    config, key = credentials
    config_path, key_path = tmp_path / "config", tmp_path / "key.pem"
    config_path.write_bytes(config)
    key_path.write_bytes(key)
    monkeypatch.setenv("AGENT_DESK_BASE_CONFIG", str(config_path))
    monkeypatch.setenv("AGENT_DESK_BASE_KEY", str(key_path))
    calls = []

    class Client:
        def __init__(self, values, **kwargs):
            assert values["key_file"] == str(key_path)
            assert kwargs["service_endpoint"] == "https://id.example"
            self.base_client = self

        def call_api(self, path, method, **kwargs):
            calls.append((path, method))
            raise oci.exceptions.ServiceError(403, "denied", {}, "private detail")

    monkeypatch.setattr(oci.identity_domains, "IdentityDomainsClient", Client)
    with pytest.raises(ValueError, match="claves de firma") as error:
        oracle_keys.signing_keys("https://id.example")
    assert "private detail" not in str(error.value)
    assert calls == [("/admin/v1/SigningCert/jwk", "GET")]
