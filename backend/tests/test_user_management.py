from dataclasses import replace
from types import SimpleNamespace as NS

import oci
import pytest
from test_identity import hosted as hosted
from test_identity import sign_in

from app.core import directory
from app.core.access_store import AccessStore
from app.core.directory import DirectoryError, OracleDirectory


def user(identifier="stable-id", **changes):
    return NS(
        id=identifier,
        user_name="login-name",
        active=True,
        external_id="",
        emails=[NS(value="member@example.com")],
        **changes,
    )


@pytest.fixture
def client(monkeypatch):
    calls = []
    state = [user()]

    class Client:
        def list_users(self, **kwargs):
            calls.append(("find", kwargs))
            return NS(data=NS(resources=state[:], total_results=len(state)))

        def create_user(self, body):
            calls.append(("create", body))
            state.append(
                NS(
                    id="new-id",
                    user_name=body.user_name,
                    active=True,
                    emails=body.emails,
                    external_id=body.external_id,
                )
            )
            return NS(data=state[-1])

        @property
        def base_client(self):
            return self

        def call_api(self, *args, **kwargs):
            calls.append(("activate", args))
            return NS(data={})

    monkeypatch.setattr(directory, "directory_client", lambda domain: Client())
    return calls, state


def test_resolve_email_uses_actual_username_and_stable_identity(client):
    calls, state = client
    service = OracleDirectory("https://id.example", "client")
    resolved = service.resolve("member@example.com")
    assert resolved["id"] == "stable-id" and resolved["username"] == "login-name"
    assert all(call[0] == "find" for call in calls)
    assert service.login_identity("login-name") == ("directory:stable-id", "member@example.com")
    state[0].id = "replacement-id"
    assert service.login_identity("login-name") == ("directory:replacement-id", "member@example.com")
    with pytest.raises(DirectoryError):
        service.login_identity("member@example.com")  # email is not the signed username


def test_login_does_not_present_an_opaque_username_as_an_email(client):
    _, state = client
    state[0].emails = []
    service = OracleDirectory("https://id.example", "client")
    assert service.login_identity("login-name") == ("directory:stable-id", "")


def test_creation_is_opt_in_reconciles_owned_account_and_does_not_activate_existing(client):
    calls, state = client
    state.clear()
    blocked = OracleDirectory("https://id.example", "client")
    with pytest.raises(DirectoryError):
        blocked.resolve("new@example.com", True)
    assert calls == []
    with pytest.raises(DirectoryError):
        blocked.resolve("new@example.com")
    enabled = OracleDirectory("https://id.example", "client", True)
    enabled.resolve("new@example.com", True)
    enabled.resolve("new@example.com", True)
    assert len([c for c in calls if c[0] == "create"]) == 1
    assert not [c for c in calls if c[0] == "activate"]
    enabled.activate(enabled.resolve("new@example.com"))
    assert len([c for c in calls if c[0] == "activate"]) == 1
    state[0].external_id = "customer-managed"
    calls.clear()
    enabled.resolve("new@example.com", True)
    assert [c[0] for c in calls] == ["find"]


def test_ambiguous_inactive_and_mismatched_directory_results_fail_closed(client):
    _, state = client
    service = OracleDirectory("https://id.example", "client")
    state.append(user("other"))
    with pytest.raises(DirectoryError):
        service.resolve("member@example.com")
    state.pop()
    state[0].active = False
    with pytest.raises(DirectoryError):
        service.resolve("member@example.com")
    state[0].active = True
    with pytest.raises(DirectoryError):
        service.resolve("not-this-user@example.com")


def test_administrator_add_requires_directory_and_explicit_creation_permission(hosted, client):
    app, browser = hosted
    identity = app.state.identity
    sign_in(app, browser)
    headers = {"Origin": "https://desk.example", "X-Agent-Desk": "configure"}
    body = {"email": "member@example.com", "profiles": ["a" * 32]}
    assert browser.post("/api/admin/users", json=body, headers=headers).status_code == 503
    identity.directory = OracleDirectory("https://id.example", "client")
    assert browser.get("/api/admin/user-management").json() == {
        "directory_available": True,
        "allow_create": False,
    }
    assert browser.post("/api/admin/users", json=body).status_code == 403
    assert (
        browser.post(
            "/api/admin/users", json={**body, "create_in_directory": True}, headers=headers
        ).status_code
        == 403
    )
    assert (
        browser.post("/api/admin/users", json={**body, "profiles": ["b" * 32]}, headers=headers).status_code
        == 422
    )
    assert browser.post("/api/admin/users", json=body, headers=headers).status_code == 204
    member = next(u for u in identity.store.users() if u["role"] == "member")
    assert member["subject"] == "directory:stable-id"
    assert (
        browser.put("/api/admin/users", json={"subject": "forged", **body}, headers=headers).status_code
        == 422
    )
    sign_in(app, browser, member["subject"])
    assert browser.get("/api/admin/user-management").status_code == 403
    assert browser.post("/api/admin/users", json=body, headers=headers).status_code == 403


def test_recycled_username_cannot_inherit_permissions(tmp_path, client):
    _, state = client
    service = OracleDirectory("https://id.example", "client")
    store = AccessStore(tmp_path / "access.sqlite3", "issuer", "admin")
    store.save_user(service.login_identity("login-name")[0], "member@example.com", True, [])
    assert store.login(service.login_identity("login-name")[0], "member@example.com")
    state[0].id = "new-person"
    assert store.login(service.login_identity("login-name")[0], "member@example.com") is None


def test_directory_outage_does_not_grant_access_or_expose_error(hosted, monkeypatch):
    app, browser = hosted
    app.state.identity.directory = OracleDirectory("https://id.example", "client")
    sign_in(app, browser)

    def unavailable(*args):
        raise oci.exceptions.ServiceError(403, "NotAuthorized", {}, "private operational details")

    monkeypatch.setattr(directory, "directory_client", unavailable)
    response = browser.post(
        "/api/admin/users",
        json={"email": "m@example.com", "profiles": []},
        headers={"Origin": "https://desk.example", "X-Agent-Desk": "configure"},
    )
    assert response.status_code == 503 and "private operational" not in response.text
    assert len(app.state.identity.store.users()) == 1


def test_creation_permission_is_server_side(hosted, client):
    app, browser = hosted
    identity = app.state.identity
    identity.settings = replace(identity.settings, create_users=True)
    identity.directory = OracleDirectory("https://id.example", "client", True)
    client[1].clear()
    sign_in(app, browser)
    response = browser.post(
        "/api/admin/users",
        json={"email": "new@example.com", "profiles": [], "create_in_directory": True},
        headers={"Origin": "https://desk.example", "X-Agent-Desk": "configure"},
    )
    assert response.status_code == 204
    assert browser.get("/api/admin/user-management").json()["allow_create"] is True


@pytest.mark.parametrize("failure", ["activation", "visibility"])
def test_incomplete_oracle_creation_does_not_grant_local_access(hosted, client, monkeypatch, failure):
    app, browser = hosted
    identity = app.state.identity
    identity.settings = replace(identity.settings, create_users=True)
    identity.directory = OracleDirectory("https://id.example", "client", True)
    client[1].clear()
    oracle = directory.directory_client("https://id.example")
    if failure == "activation":

        def reject(*args, **kwargs):
            raise oci.exceptions.ServiceError(403, "NotAuthorized", {}, "private activation failure")

        monkeypatch.setattr(oracle, "call_api", reject)
    else:
        monkeypatch.setattr(oracle, "create_user", lambda body: NS(data=None))
    monkeypatch.setattr(directory, "directory_client", lambda domain: oracle)
    sign_in(app, browser)
    response = browser.post(
        "/api/admin/users",
        json={"email": "new@example.com", "profiles": [], "create_in_directory": True},
        headers={"Origin": "https://desk.example", "X-Agent-Desk": "configure"},
    )
    assert response.status_code == (503 if failure == "activation" else 422)
    assert "private activation" not in response.text
    assert len(identity.store.users()) == 1


def test_concurrent_creation_resolves_oracle_conflict_before_granting(client, monkeypatch):
    client[1].clear()
    oracle = directory.directory_client("https://id.example")
    create = oracle.create_user

    def conflict(body):
        create(body)
        raise oci.exceptions.ServiceError(409, "UserAlreadyExists", {}, "Concurrent creation")

    monkeypatch.setattr(oracle, "create_user", conflict)
    monkeypatch.setattr(directory, "directory_client", lambda domain: oracle)
    result = OracleDirectory("https://id.example", "client", True).resolve("new@example.com", True)
    assert result["id"] == "new-id"
    assert not [call for call in client[0] if call[0] == "activate"]


def test_enabling_an_enrolled_owned_account_does_not_repeat_activation(hosted, client):
    app, browser = hosted
    identity = app.state.identity
    identity.settings = replace(identity.settings, create_users=True)
    identity.directory = OracleDirectory("https://id.example", "client", True)
    client[1].clear()
    sign_in(app, browser)
    body = {"email": "new@example.com", "profiles": [], "create_in_directory": True}
    headers = {"Origin": "https://desk.example", "X-Agent-Desk": "configure"}
    assert browser.post("/api/admin/users", json=body, headers=headers).status_code == 204
    identity.store.save_user("directory:new-id", "new@example.com", False, [])
    assert browser.post("/api/admin/users", json=body, headers=headers).status_code == 204
    assert len([call for call in client[0] if call[0] == "create"]) == 1
    assert len([call for call in client[0] if call[0] == "activate"]) == 1
    assert identity.store.login("directory:new-id", "new@example.com")


def test_failed_activation_can_be_retried_without_recreating_or_granting_early(hosted, client, monkeypatch):
    app, browser = hosted
    identity = app.state.identity
    identity.settings = replace(identity.settings, create_users=True)
    identity.directory = OracleDirectory("https://id.example", "client", True)
    client[1].clear()
    oracle = directory.directory_client("https://id.example")
    activate = oracle.call_api

    def reject(*args, **kwargs):
        raise oci.exceptions.ServiceError(503, "Unavailable", {}, "activation failure")

    monkeypatch.setattr(oracle, "call_api", reject)
    monkeypatch.setattr(directory, "directory_client", lambda domain: oracle)
    sign_in(app, browser)
    body = {"email": "new@example.com", "profiles": [], "create_in_directory": True}
    headers = {"Origin": "https://desk.example", "X-Agent-Desk": "configure"}
    assert browser.post("/api/admin/users", json=body, headers=headers).status_code == 503
    assert len(identity.store.users()) == 1
    monkeypatch.setattr(oracle, "call_api", activate)
    assert browser.post("/api/admin/users", json=body, headers=headers).status_code == 204
    assert len([call for call in client[0] if call[0] == "create"]) == 1
    assert len([call for call in client[0] if call[0] == "activate"]) == 1


def test_directory_search_is_bounded_read_only_and_escapes_the_scim_literal(client):
    calls, _ = client
    service = OracleDirectory("https://id.example", "client", True)
    assert service.search("me") == [{"email": "member@example.com"}]
    request = calls[0][1]
    assert request == {
        "filter": 'active eq true and (userName co "me" or emails.value co "me")',
        "count": 20,
        "attributes": "id,userName,emails,active",
        "sort_by": "userName",
        "sort_order": "ASCENDING",
    }
    assert service.search('x" or active eq false') == []
    assert r'"x\" or active eq false"' in calls[-1][1]["filter"]
    assert all(call[0] == "find" for call in calls)
    calls.clear()
    assert service.search("  ") == []
    assert calls == []


def test_directory_search_uses_the_installed_sdk_query_contract(monkeypatch):
    requests = []

    def transport(**kwargs):
        requests.append(kwargs)
        return NS(data=NS(resources=[user()]))

    sdk = object.__new__(oci.identity_domains.IdentityDomainsClient)
    sdk.retry_strategy = None
    sdk.base_client = NS(
        generate_collection_format_param=lambda *args: None,
        get_preferred_retry_strategy=lambda **kwargs: None,
        call_api=transport,
    )
    monkeypatch.setattr(directory, "directory_client", lambda domain: sdk)
    assert OracleDirectory("https://id.example", "client").search("member") == [
        {"email": "member@example.com"}
    ]
    assert requests[0]["method"] == "GET"
    assert requests[0]["query_params"]["sortOrder"] == "ASCENDING"
    assert requests[0]["query_params"]["count"] == 20


def test_search_returns_only_matching_active_email_addresses(client):
    _, state = client
    state[:] = [user(str(index)) for index in range(25)]
    for index, item in enumerate(state):
        item.emails = [NS(value=f"member{index}@example.com")]
    state.append(user("inactive"))
    state[-1].active = False
    state[-1].emails = [NS(value="member-inactive@example.com")]
    result = OracleDirectory("https://id.example", "client").search("MEMBER")
    assert len(result) == 20
    assert result[0] == {"email": "member0@example.com"}
    assert {tuple(item) for item in result} == {("email",)}
    state[:] = [user()]
    state[0].emails = [NS(value="member@example.com"), NS(value="MEMBER@example.com"), NS(value="invalid")]
    assert OracleDirectory("https://id.example", "client").search("member") == [
        {"email": "member@example.com"}
    ]


def test_search_endpoint_requires_administrator_and_keeps_directory_data_out_of_store(hosted, client):
    app, browser = hosted
    app.state.identity.directory = OracleDirectory("https://id.example", "client")
    assert browser.get("/api/admin/directory-users", params={"q": "me"}).status_code == 401
    sign_in(app, browser)
    response = browser.get("/api/admin/directory-users", params={"q": "me"})
    assert response.status_code == 200 and response.json() == [{"email": "member@example.com"}]
    assert response.headers["Cache-Control"] == "no-store"
    assert len(app.state.identity.store.users()) == 1
    for query in ("a", "x" * 255, "ab\n"):
        assert browser.get("/api/admin/directory-users", params={"q": query}).status_code == 422
    app.state.identity.store.save_user("member", "member@example.com", True, [])
    sign_in(app, browser, "member")
    assert browser.get("/api/admin/directory-users", params={"q": "me"}).status_code == 403


def test_search_endpoint_reports_directory_unavailability_without_exposing_details(hosted, monkeypatch):
    app, browser = hosted
    sign_in(app, browser)
    assert browser.get("/api/admin/directory-users", params={"q": "me"}).status_code == 503
    app.state.identity.directory = OracleDirectory("https://id.example", "client")

    def unavailable(*args):
        raise oci.exceptions.ServiceError(403, "NotAuthorized", {}, "private directory details")

    monkeypatch.setattr(directory, "directory_client", unavailable)
    response = browser.get("/api/admin/directory-users", params={"q": "me"})
    assert response.status_code == 503 and "private directory" not in response.text
    assert len(app.state.identity.store.users()) == 1
