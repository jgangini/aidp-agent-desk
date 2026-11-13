import json
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from joserfc import jwt
from joserfc.jwk import RSAKey

from app.core.access import install_identity
from app.core.access_store import AccessStore
from app.core.identity import COOKIE, IdentitySettings
from app.features.desk.api import create_router
from app.features.desk.credentials import ProfileStore
from app.features.desk.invocation_scope import invocation_scope
from app.features.desk.schemas import AgentProfile, InvokeRequest


@pytest.fixture
def hosted(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, request):
    monkeypatch.setenv("AGENT_DESK_DATA_DIR", str(tmp_path))
    app = FastAPI()
    profile = AgentProfile(
        id="a" * 32,
        name="Agent",
        endpoint_host="host",
        flow_id="flow",
        region="us-chicago-1",
        profile="DEFAULT",
    )
    vault = ProfileStore(tmp_path)
    monkeypatch.setattr(vault, "list", lambda: [profile])
    origin = getattr(request, "param", "https://desk.example")
    settings = IdentitySettings(
        origin,
        "https://id.example",
        "client",
        "private",
        "s" * 40,
        "admin-sub",
        allow_loopback_http=origin.startswith("http://"),
    )
    install_identity(app, settings, vault.list)
    app.include_router(create_router(vault))
    client = TestClient(app, base_url=origin)
    return app, client


def sign_in(app, client, subject="admin-sub"):
    token = app.state.identity.store.login(subject, subject + "@example.com")
    assert token
    client.cookies.set(COOKIE, token)
    client.headers["X-Agent-Desk-User"] = app.state.identity.store.user(token)["id"]
    return token


def test_hosted_access_defaults_deny_and_grants_are_enforced(hosted):
    app, client = hosted
    assert client.get("/api/desk/profiles").status_code == 401
    store = app.state.identity.store
    store.save_user("member", "m@example.com", True, [])
    sign_in(app, client, "member")
    assert client.get("/api/desk/profiles").json() == []
    assert client.get("/api/admin/users").status_code == 403
    assert client.get("/api/desk/discovery/draft").status_code == 403
    headers = {"Origin": "https://desk.example", "X-Agent-Desk": "configure"}
    assert (
        client.post(
            "/api/desk/audio/realtime-session", json={"profile_id": "a" * 32}, headers=headers
        ).status_code
        == 403
    )
    assert client.get("/api/desk/suggestions/" + "a" * 32).status_code == 403
    assert (
        client.post(
            "/api/desk/stream",
            json={"profile_id": "a" * 32, "question": "hi", "request_id": "r", "session_id": "c"},
            headers=headers,
        ).status_code
        == 403
    )
    store.save_user("member", "m@example.com", True, ["a" * 32])
    assert client.get("/api/desk/profiles").status_code == 401  # permission edits revoke sessions
    sign_in(app, client, "member")
    profiles = client.get("/api/desk/profiles").json()
    assert len(profiles) == 1 and not profiles[0]["workspace_id"]
    assert client.get("/api/desk/suggestions/" + "a" * 32).status_code == 200
    assert (
        client.put("/api/desk/suggestions/" + "a" * 32, json={"items": []}, headers=headers).status_code
        == 403
    )


def test_admin_csrf_bootstrap_immutability_and_logout(hosted):
    app, client = hosted
    token = sign_in(app, client)
    payload = {"subject": "other", "email": "o@example.com", "profiles": ["a" * 32]}
    assert client.put("/api/admin/users", json=payload).status_code == 403
    headers = {"Origin": "https://desk.example", "X-Agent-Desk": "configure"}
    assert client.put("/api/admin/users", json=payload, headers=headers).status_code == 204
    assert (
        client.put("/api/admin/users", json={**payload, "profiles": ["b" * 32]}, headers=headers).status_code
        == 422
    )
    assert (
        client.put("/api/admin/users", json={**payload, "subject": "admin-sub"}, headers=headers).status_code
        == 422
    )
    assert client.post("/api/auth/logout", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    assert app.state.identity.store.user(token) is None
    client.cookies.clear()
    client.cookies.set(COOKIE, token)
    assert client.get("/api/auth/session").json()["user"] is None
    assert client.get("/api/desk/profiles").status_code == 401


def test_database_survives_restart_and_rejects_orphan_grant(tmp_path):
    store = AccessStore(tmp_path / "access.sqlite3", "issuer", "admin")
    store.save_user("member", "m@example.com", True, ["a" * 32])
    token = store.login("member", "m@example.com")
    other = AccessStore(tmp_path / "access.sqlite3", "issuer", "admin")
    user = other.user(token)
    assert user and other.permitted(user, "a" * 32)
    import sqlite3

    with pytest.raises(sqlite3.IntegrityError), other.connect() as db:
        db.execute("INSERT INTO grants VALUES('missing',?)", ("a" * 32,))
    assert other.login("unknown", "admin@example.com") is None
    assert other.login("member", "admin@example.com")  # email never elevates role
    assert other.user(token)["role"] == "member"
    AccessStore(tmp_path / "access.sqlite3", "issuer", "replacement-admin")
    assert other.login("admin", "old@example.com") is None
    assert other.login("replacement-admin", "new@example.com") is not None


@pytest.mark.parametrize("inventory", ["blocks", "activities", "activity"])
def test_user_scoping_preserves_replay_and_pending_request(hosted, inventory):
    app, _ = hosted
    store = app.state.identity.store
    store.save_user("other", "o@example.com", True, ["a" * 32])
    users = store.users()
    value = InvokeRequest(profile_id="a" * 32, question="hi", request_id="r", session_id="c")
    native = []
    for user in users:
        request = Request({"type": "http", "app": app, "state": {"principal": user}})
        scoped, restore = invocation_scope(request, value)
        native.append(scoped)
        replay, _ = invocation_scope(request, value.model_copy(update={"action": "replay"}))
        assert scoped.session_id == replay.session_id and scoped.request_id == replay.request_id
        data = {
            "kind": "snapshot",
            "request_id": scoped.request_id,
            "response": {"pending_request_id": scoped.request_id},
            "replay": {"snapshot": {inventory: {"b": {"turn_id": scoped.request_id}}}},
        }
        public = json.loads(restore(json.dumps(data).encode()))
        assert public["request_id"] == "r" and public["session_id"] == "c"
        assert public["replay"]["snapshot"][inventory]["b"]["turn_id"] == "r"
        assert public["response"]["pending_request_id"] == "r"
        data["replay"]["snapshot"][inventory]["b"]["turn_id"] = "unknown-upstream"
        with pytest.raises(ValueError, match="Unknown upstream request identity"):
            restore(json.dumps(data).encode())
    assert native[0].session_id != native[1].session_id
    assert native[0].request_id != native[1].request_id


@pytest.mark.parametrize(
    "scenario",
    [
        "valid",
        "signature",
        "issuer",
        "audience",
        "nonce",
        "unknown",
        "restricted",
        "restricted-signature",
        "directory",
    ],
)
@pytest.mark.parametrize("hosted", ["https://desk.example", "http://127.0.0.1:8317"], indirect=True)
def test_oracle_login_validates_state_signature_and_rejects_unlisted_user(hosted, scenario, monkeypatch):
    app, client = hosted
    provider = app.state.identity.provider
    if scenario == "directory":
        from types import SimpleNamespace

        app.state.identity.store = AccessStore(
            app.state.identity.store.path, "https://id.example", "directory:stable-id"
        )
        app.state.identity.directory = SimpleNamespace(
            login_identity=lambda subject: (
                ("directory:stable-id", "admin@example.com") if subject == "admin-sub" else ("unknown", "")
            )
        )
    key = RSAKey.generate_key(2048)
    signing_key = RSAKey.generate_key(2048) if scenario.endswith("signature") else key
    metadata = {
        "issuer": "https://identity.oraclecloud.com/",
        "authorization_endpoint": "https://id.example/authorize",
        "token_endpoint": "https://id.example/token",
        "jwks_uri": "https://id.example/keys",
        "id_token_signing_alg_values_supported": ["RS256"],
    }
    claims = {}
    if scenario.startswith("restricted"):
        from app.core import oracle_keys

        metadata["jwks_uri"] = "https://id.example/admin/v1/SigningCert/jwk"
        monkeypatch.setenv("AGENT_DESK_BASE_CONFIG", "server-config")
        monkeypatch.setenv("AGENT_DESK_BASE_KEY", "server-key")
        monkeypatch.setattr(
            oracle_keys, "signing_keys", lambda domain: {"keys": [key.as_dict(private=False)]}
        )

    def mock(request):
        if "openid-configuration" in str(request.url):
            return httpx.Response(200, json=metadata)
        if request.url.path == "/keys":
            return httpx.Response(200, json={"keys": [key.as_dict(private=False)]})
        if request.url.path == "/admin/v1/SigningCert/jwk":
            return httpx.Response(401, json={"error": "authentication_required"})
        return httpx.Response(
            200,
            json={
                "access_token": "token",
                "token_type": "Bearer",
                "id_token": jwt.encode({"alg": "RS256"}, claims, signing_key),
            },
        )

    provider.client_kwargs["transport"] = httpx.MockTransport(mock)
    assert (
        client.get("/api/auth/callback?code=bad&state=bad", follow_redirects=False).headers["location"]
        == "/?login=failed"
    )
    start = client.post(
        "/api/auth/login",
        headers={"Origin": app.state.identity.settings.origin},
        follow_redirects=False,
    )
    import time
    from urllib.parse import parse_qs, urlsplit

    parameters = parse_qs(urlsplit(start.headers["location"]).query)
    assert parameters["prompt"] == ["login"]
    assert "login_hint" not in parameters
    assert parameters["code_challenge_method"] == ["S256"]
    assert parameters["redirect_uri"] == [app.state.identity.settings.origin + "/api/auth/callback"]
    assert "httponly" in start.headers["set-cookie"].lower()
    assert ("secure" in start.headers["set-cookie"].lower()) == app.state.identity.settings.secure_cookie
    claims.update(
        iss="https://identity.oraclecloud.com/",
        aud="client",
        sub="admin-sub",
        exp=int(time.time()) + 300,
        iat=int(time.time()),
        nonce=parameters["nonce"][0],
    )
    if scenario == "issuer":
        claims["iss"] = "https://other.example"
    if scenario == "audience":
        claims["aud"] = "other-client"
    if scenario == "nonce":
        claims["nonce"] = "other-nonce"
    if scenario == "unknown":
        claims["sub"] = "unlisted-user"
    response = client.get(
        "/api/auth/callback", params={"code": "code", "state": parameters["state"][0]}, follow_redirects=False
    )
    if scenario == "directory":
        assert client.get("/api/auth/session").json()["user"]["email"] == "admin@example.com"
    if scenario not in ("valid", "restricted", "directory"):
        assert response.headers["location"] == (
            "/?login=denied" if scenario == "unknown" else "/?login=failed"
        )
        assert client.get("/api/auth/session").json()["user"] is None
        return
    assert response.headers["location"] == "/"
    assert client.get("/api/auth/session").json()["user"]["role"] == "admin"
    assert "HttpOnly" in response.headers["set-cookie"]
    assert ("Secure" in response.headers["set-cookie"]) == app.state.identity.settings.secure_cookie
    principal = client.get("/api/auth/session").json()["user"]
    logout = client.post(
        "/api/auth/logout",
        headers={
            "Origin": app.state.identity.settings.origin,
            "X-Agent-Desk-User": principal["id"],
        },
    )
    assert logout.status_code == 204 and "Max-Age=0" in logout.headers["set-cookie"]
    assert client.get("/api/auth/session").json()["user"] is None


@pytest.mark.parametrize("origin", [None, "https://evil.example"])
def test_login_requires_same_origin_without_accepting_client_identity(hosted, origin):
    _, client = hosted
    headers = {"Origin": origin} if origin else {}
    assert client.post("/api/auth/login", headers=headers).status_code == 403


def test_logout_invalidates_pending_authorization_and_relogin_requests_oracle(hosted, monkeypatch):
    app, client = hosted
    provider = app.state.identity.provider
    provider.client_kwargs["transport"] = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"authorization_endpoint": "https://id.example/authorize"})
    )
    headers = {"Origin": "https://desk.example"}
    first = client.post("/api/auth/login", headers=headers, follow_redirects=False)
    assert first.status_code == 302
    logout = client.post("/api/auth/logout", headers=headers)
    assert logout.status_code == 204
    assert "Max-Age=0" in logout.headers["set-cookie"]
    assert "__Host-agent-desk-oidc=null" in logout.headers["set-cookie"]
    from urllib.parse import parse_qs, urlsplit

    second = client.post(
        "/api/auth/login",
        data={"email": "someone@example.com", "prompt": "none"},
        headers=headers,
        follow_redirects=False,
    )
    parameters = parse_qs(urlsplit(second.headers["location"]).query)
    assert parameters["prompt"] == ["login"]
    assert "login_hint" not in parameters
    assert parameters["state"] != parse_qs(urlsplit(first.headers["location"]).query)["state"]
    assert client.get("/api/auth/session").json()["user"] is None


@pytest.mark.parametrize(
    "origin,domain,allow,accepted",
    [
        ("http://127.0.0.1:8317", "https://id.example", "0", False),
        ("http://127.0.0.1:8317", "https://id.example", "1", True),
        ("http://localhost:8317", "https://id.example", "1", True),
        ("http://desk.example", "https://id.example", "1", False),
        ("http://127.0.0.1.evil.example", "https://id.example", "1", False),
        ("https://desk.example", "http://127.0.0.1", "1", False),
        ("https://desk.example", "https://id.example", "1", True),
    ],
)
def test_http_login_is_explicitly_loopback_only(monkeypatch, origin, domain, allow, accepted):
    for name, value in {
        "AUTH_MODE": "oracle",
        "PUBLIC_ORIGIN": origin,
        "OIDC_DOMAIN": domain,
        "ALLOW_LOOPBACK_HTTP": allow,
        "OIDC_CLIENT_ID": "client",
        "OIDC_CLIENT_SECRET": "private",
        "SESSION_SECRET": "s" * 40,
        "ADMIN_SUBJECT": "admin-sub",
    }.items():
        monkeypatch.setenv("AGENT_DESK_" + name, value)
    if not accepted:
        with pytest.raises(RuntimeError):
            IdentitySettings.load()
        return
    settings = IdentitySettings.load()
    assert settings.secure_cookie == origin.startswith("https://")


def test_identity_settings_fail_closed(monkeypatch):
    monkeypatch.setenv("AGENT_DESK_AUTH_MODE", "unknown")
    with pytest.raises(RuntimeError):
        IdentitySettings.load()
    monkeypatch.setenv("AGENT_DESK_AUTH_MODE", "oracle")
    with pytest.raises(RuntimeError):
        IdentitySettings.load()


def test_stale_browser_identity_cannot_act_as_another_account(hosted):
    app, client = hosted
    sign_in(app, client)
    client.headers["X-Agent-Desk-User"] = "previous-user"
    assert client.get("/api/desk/profiles").status_code == 409
    assert client.post("/api/auth/logout", headers={"Origin": "https://desk.example"}).status_code == 409


def test_missing_session_is_rejected_before_creating_mapping(hosted):
    app, _ = hosted
    user = app.state.identity.store.users()[0]
    request = Request({"type": "http", "app": app, "state": {"principal": user}})
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as error:
        invocation_scope(request, InvokeRequest(request_id="r", question="hi", profile_id="a" * 32))
    assert error.value.status_code == 422


def test_admin_test_visibility_execution_guard_and_surface_isolation(hosted, monkeypatch):
    from app.core.access import scoped_session
    from app.features.desk.api import require_invocation_target
    app, client = hosted
    sign_in(app, client)
    vault = ProfileStore(Path("unused-test-profiles"))
    profile = AgentProfile(id="a" * 32, name="Agent", endpoint_host="host", flow_id="flow",
                           region="us-chicago-1", profile="DEFAULT", instance_id="instance", workspace_id="workspace")
    monkeypatch.setattr(vault, "list", lambda: [profile])
    token_user = app.state.identity.store.users()[0]
    request = Request({"type":"http","app":app,"state":{"principal":token_user}})
    from app.core.access import visible_profiles
    assert visible_profiles(request,[profile])[0].workspace_id == "workspace"
    value = InvokeRequest(profile_id=profile.id,question="hi",request_id="same",session_id="same")
    prod,_ = invocation_scope(request,value)
    with pytest.raises(Exception, match="No existe esa solicitud"):
        invocation_scope(request, value.model_copy(update={"surface":"TEST","action":"replay"}))
    testing = require_invocation_target(request,value.model_copy(update={"surface":"TEST"}),vault,None)
    test,_ = invocation_scope(request,testing)
    assert prod.request_id != test.request_id and prod.session_id != test.session_id
    assert prod.session_id == scoped_session(request,profile.id,"same")
    replay,_ = invocation_scope(request,testing.model_copy(update={"action":"replay"}))
    assert replay.request_id == test.request_id
    profile.surface = "TEST"
    assert require_invocation_target(request,value,vault,None).surface == "TEST"
    app.state.identity.store.save_user("test-member", "member@example.com", True, [profile.id])
    member_token = app.state.identity.store.login("test-member", "member@example.com")
    member = app.state.identity.store.user(member_token)
    member_request = Request({"type":"http","app":app,"state":{"principal":member}})
    assert visible_profiles(member_request,[profile]) == []
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as denied:
        require_invocation_target(member_request,value,vault,None)
    assert denied.value.status_code == 403


def test_scheduled_test_permission_requires_current_admin_role(hosted, monkeypatch):
    from app.features.desk.scheduled_runtime import ScheduledRuntime
    app, client = hosted
    sign_in(app,client)
    identity = app.state.identity
    admin = identity.store.users()[0]
    profile = AgentProfile(id="a"*32,name="Agent",endpoint_host="host",flow_id="flow",region="us-chicago-1",
                           profile="DEFAULT",ready=True,instance_id="instance",workspace_id="workspace")
    vault = ProfileStore(Path("unused-test-profiles"))
    monkeypatch.setattr(vault,"list",lambda:[profile])
    target = "test:"+profile.id
    monkeypatch.setenv("AGENT_DESK_REPORT_PROFILES",target)
    runtime = ScheduledRuntime(vault,lambda:identity)
    assert runtime.permitted(admin["id"],target)
    identity.store.save_user("member-test","m@example.com",True,[profile.id])
    member = next(user for user in identity.store.users() if user["subject"]=="member-test")
    assert not runtime.permitted(member["id"],target)
    assert not runtime.permitted(admin["id"],profile.id)  # TEST does not enable PROD reports


def test_only_admin_can_configure_report_enrollment(hosted, tmp_path):
    app, client = hosted
    profile_id = "a" * 32
    (tmp_path / profile_id).mkdir()
    url = f"/api/desk/profiles/{profile_id}/reports"
    headers = {"Origin": "https://desk.example", "X-Agent-Desk": "configure"}
    assert client.put(url, json={"prod": True}, headers=headers).status_code == 401
    sign_in(app, client)
    assert client.put(url, json={"prod": True}, headers=headers).status_code == 200
    identity = app.state.identity
    identity.store.save_user("member", "m@example.com", True, [profile_id])
    sign_in(app, client, "member")
    assert client.get(url, headers=headers).status_code == 403
    assert client.put(url, json={"prod": False}, headers=headers).status_code == 403
    assert json.loads((tmp_path / profile_id / "reports.json").read_text())["prod"] is True
