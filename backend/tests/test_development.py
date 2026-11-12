"""Native TEST contracts without OCI calls or shared development-session reuse."""

import json
from pathlib import Path
from threading import Lock
from typing import Any, cast
from urllib.parse import urlsplit

import pytest

from app.features.desk.credentials import ProfileStore
from app.features.desk.development import Development, DevelopmentError
from app.features.desk.schemas import AgentProfile

PROFILE = "a" * 32
HOST = "https://datalake.us-chicago-1.oci.oraclecloud.com"
GA = "/20260430/aiDataPlatforms/platform/workspaces/workspace"
LEGACY = "/20240831/dataLakes/platform/workspaces/workspace"
ENDPOINT = "https://gateway.aidp.us-chicago-1.oci.oraclecloud.com/agentendpoint/flow_TEST/chat"


def deployment(**updates: Any) -> dict[str, Any]:
    return {
        "key": "deployment-1",
        "agentFlowKey": "flow",
        "agentFlowComputeKey": "compute",
        "deploymentType": "TEST",
        "lifecycleState": "ACTIVE",
        "endpointUrl": ENDPOINT,
        "deploymentVersion": "1",
        "timeCreated": "2026-11-09T10:00:00Z",
        **updates,
    }


class FakeResponse:
    def __init__(self, payload: dict[str, Any], headers: dict[str, str] | None = None) -> None:
        self.payload, self.headers = payload, headers or {}
        self.content = json.dumps(payload).encode()
        self.status_code = 200

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_: Any) -> None:
        pass

    def json(self) -> dict[str, Any]:
        return self.payload


class FakeSession:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.pages = [[deployment()]]
        self.agent = {"key": "flow", "type": "CODE", "computeKey": "compute"}
        self.sessions: dict[str, dict[str, Any]] = {}
        self.session_updates: dict[str, Any] = {}
        self.posts = 0
        self.lose_post = False

    def request(self, method: str, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append((method, url, kwargs))
        path = urlsplit(url).path
        if method == "GET" and path == GA + "/agents/flow":
            return FakeResponse(self.agent)
        if method == "GET" and path == LEGACY + "/agentFlowDeployments":
            cursor = kwargs.get("params", {}).get("page")
            index = int(cursor) if cursor is not None else 0
            headers = {"opc-next-page": str(index + 1)} if index + 1 < len(self.pages) else {}
            return FakeResponse({"items": self.pages[index]}, headers)
        if method == "POST" and path == LEGACY + "/agentFlowSessions":
            self.posts += 1
            if self.lose_post:
                raise TimeoutError("The submitted POST response was lost")
            identity = f"session-{self.posts}"
            self.sessions[identity] = {
                "key": identity,
                "agentKey": "flow",
                "agentComputeKey": "compute",
                "endpointUrl": ENDPOINT,
                "lifecycleState": "ACTIVE",
            }
            return FakeResponse({"key": identity})
        if method == "GET" and path.startswith(GA + "/agents/flow/sessions/"):
            identity = path.rsplit("/", 1)[-1]
            return FakeResponse({**self.sessions[identity], **self.session_updates})
        raise AssertionError(f"Unexpected native TEST request: {method} {path}")


class FakeProfileStore:
    def __init__(self, root: Path) -> None:
        self.root, self.lock = root, Lock()
        (root / PROFILE).mkdir(parents=True, exist_ok=True)


def setup() -> tuple[Development, FakeSession, object]:
    metadata = AgentProfile(
        id=PROFILE,
        name="Market",
        endpoint_host="published.example.org",
        flow_id="flow",
        region="us-chicago-1",
        profile="DEFAULT",
        instance_id="platform",
        workspace_id="workspace",
    )
    session, signer = FakeSession(), object()
    return Development(metadata, session, signer), session, signer


def test_test_deployments_use_legacy_route_header_pagination_and_ga_compute() -> None:
    development, session, signer = setup()
    session.pages = [
        [deployment(key="older")],
        [deployment(key="latest", timeCreated="2026-11-09T11:00:00Z")],
    ]
    target = development.target()
    assert target == {"endpoint": ENDPOINT, "compute": "compute", "deployment": "latest", "version": "1"}
    assert session.calls[0][:2] == ("GET", HOST + GA + "/agents/flow")
    queries = [
        kwargs["params"] for method, url, kwargs in session.calls if url.endswith("/agentFlowDeployments")
    ]
    assert queries == [
        {"agentFlowKey": "flow", "deploymentType": "TEST", "limit": 100},
        {"agentFlowKey": "flow", "deploymentType": "TEST", "limit": 100, "page": "1"},
    ]
    for _, url, kwargs in session.calls:
        assert url.startswith(HOST)
        assert kwargs["auth"] is signer
        assert kwargs["allow_redirects"] is False
        assert kwargs["timeout"] == (5, 20)


@pytest.mark.parametrize(
    "row",
    [
        deployment(deploymentType="PROD"),
        deployment(lifecycleState="INACTIVE"),
        deployment(agentFlowKey="another"),
        deployment(agentFlowComputeKey="forged"),
    ],
)
def test_test_target_never_falls_back_to_production_or_another_binding(row: dict[str, Any]) -> None:
    development, session, _ = setup()
    session.pages = [[row]]
    with pytest.raises(DevelopmentError):
        development.target()
    assert all("/agents/flow/deployments" not in url for _, url, _ in session.calls)
    assert session.posts == 0


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://gateway.aidp.us-chicago-1.oci.oraclecloud.com/agentendpoint/flow/chat",
        "https://gateway.aidp.us-ashburn-1.oci.oraclecloud.com/agentendpoint/flow_TEST/chat",
        ENDPOINT + "?redirect=1",
        "https://untrusted.example/agentendpoint/flow_TEST/chat",
    ],
)
def test_test_target_rejects_forged_endpoints(endpoint: str) -> None:
    development, session, _ = setup()
    session.pages = [[deployment(endpointUrl=endpoint)]]
    with pytest.raises(DevelopmentError):
        development.target()


def test_retained_active_rows_must_all_match_the_authorized_endpoint() -> None:
    development, session, _ = setup()
    session.pages = [
        [
            deployment(endpointUrl="https://untrusted.example/chat"),
            deployment(key="latest", timeCreated="2026-11-09T11:00:00Z"),
        ]
    ]
    with pytest.raises(DevelopmentError):
        development.target()


@pytest.mark.parametrize("created", ["2026-11-09T10:00:00Z", "2026-11-09T11:00:00", "invalid", None])
def test_retained_active_rows_need_an_unambiguous_zoned_latest_revision(created: str | None) -> None:
    development, session, _ = setup()
    session.pages = [[deployment(), deployment(key="other", timeCreated=created)]]
    with pytest.raises(DevelopmentError):
        development.target()


def test_test_sessions_are_distinct_persistent_and_bound_to_each_conversation(tmp_path: Path) -> None:
    development, session, signer = setup()
    store = cast(ProfileStore, FakeProfileStore(tmp_path))
    target = development.target()
    first = development.conversation(store, "conversation-one", target, create=True)
    second = development.conversation(store, "conversation-two", target, create=True)
    assert first != second
    replacement = Development(development.metadata, session, signer)
    fresh_store = cast(ProfileStore, FakeProfileStore(tmp_path))
    assert replacement.conversation(fresh_store, "conversation-one", target, create=False) == first
    assert replacement.conversation(fresh_store, "conversation-two", target, create=True) == second
    assert session.posts == 2
    posts = [kwargs for method, _, kwargs in session.calls if method == "POST"]
    assert all(
        kwargs["json"]
        == {
            "agentFlowKey": "flow",
            "agentFlowComputeKey": "compute",
            "displayName": "Agent Desk TEST",
            "deploymentType": "TEST",
        }
        for kwargs in posts
    )
    assert any(
        url == HOST + GA + f"/agents/flow/sessions/{first}"
        for method, url, _ in session.calls
        if method == "GET"
    )
    records = list((tmp_path / PROFILE / "test-sessions").glob("*.json"))
    assert len(records) == 2
    assert all(json.loads(path.read_text())["target"] == target for path in records)


def test_unknown_replay_or_cancel_does_not_create_a_session(tmp_path: Path) -> None:
    development, session, _ = setup()
    target = development.target()
    store = cast(ProfileStore, FakeProfileStore(tmp_path))
    with pytest.raises(DevelopmentError):
        development.conversation(store, "unknown", target, create=False)
    assert session.posts == 0


def test_lost_session_post_response_is_never_repeated_after_restart(tmp_path: Path) -> None:
    development, session, signer = setup()
    store = cast(ProfileStore, FakeProfileStore(tmp_path))
    target = development.target()
    session.lose_post = True
    with pytest.raises((TimeoutError, DevelopmentError)):
        development.conversation(store, "uncertain", target, create=True)
    assert session.posts == 1
    replacement = Development(development.metadata, session, signer)
    with pytest.raises(DevelopmentError):
        replacement.conversation(
            cast(ProfileStore, FakeProfileStore(tmp_path)), "uncertain", target, create=True
        )
    assert session.posts == 1


@pytest.mark.parametrize(
    "field,value",
    [
        ("key", "foreign"),
        ("agentKey", "foreign"),
        ("agentComputeKey", "forged"),
        ("endpointUrl", ENDPOINT.replace("_TEST", "")),
        ("lifecycleState", "INACTIVE"),
    ],
)
def test_persisted_session_is_revalidated_before_reuse(tmp_path: Path, field: str, value: str) -> None:
    development, session, _ = setup()
    store = cast(ProfileStore, FakeProfileStore(tmp_path))
    target = development.target()
    development.conversation(store, "one", target, create=True)
    session.session_updates = {field: value}
    with pytest.raises(DevelopmentError):
        development.conversation(store, "one", target, create=False)
    assert session.posts == 1


def test_changed_test_revision_requires_a_new_conversation(tmp_path: Path) -> None:
    development, session, _ = setup()
    store = cast(ProfileStore, FakeProfileStore(tmp_path))
    target = development.target()
    development.conversation(store, "one", target, create=True)
    with pytest.raises(DevelopmentError):
        development.conversation(store, "one", {**target, "version": "2"}, create=True)
    assert session.posts == 1


def test_recovery_after_test_refresh_reuses_verified_session_without_rebinding_or_creating(tmp_path: Path) -> None:
    development, session, _ = setup()
    store = cast(ProfileStore, FakeProfileStore(tmp_path))
    original = development.target()
    identity = development.conversation(store, "retained", original, create=True)
    records = list((tmp_path / PROFILE / "test-sessions").glob("*.json"))
    saved = records[0].read_bytes()
    refreshed = {**original, "deployment": "refreshed-deployment", "version": "2"}
    assert development.conversation(store, "retained", refreshed, create=False) == identity
    assert session.posts == 1 and records[0].read_bytes() == saved
    with pytest.raises(DevelopmentError):
        development.conversation(store, "retained", refreshed, create=True)
    session.session_updates = {"agentKey": "foreign"}
    with pytest.raises(DevelopmentError):
        development.conversation(store, "retained", refreshed, create=False)


@pytest.mark.parametrize("field,value", [("compute", "other"), ("endpoint", "https://untrusted.example/chat")])
def test_recovery_after_refresh_never_follows_another_compute_or_endpoint(tmp_path: Path, field: str, value: str) -> None:
    development, session, _ = setup()
    store = cast(ProfileStore, FakeProfileStore(tmp_path))
    original = development.target()
    development.conversation(store, "retained", original, create=True)
    with pytest.raises(DevelopmentError):
        development.conversation(store, "retained", {**original, field: value}, create=False)
    assert session.posts == 1
