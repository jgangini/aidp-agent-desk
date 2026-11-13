
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.features.desk.api import create_router
from app.features.desk.credentials import ProfileStore
from app.features.desk.scheduled_runtime import ScheduledRuntime
from app.features.desk.schemas import AgentProfile

HEADERS = {"Origin": "http://127.0.0.1:8317", "X-Agent-Desk": "configure"}


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.delenv("AGENT_DESK_REPORT_PROFILES", raising=False)
    monkeypatch.delenv("AGENT_DESK_MANAGED_CONNECTION", raising=False)
    profile = AgentProfile(id="a" * 32, name="Government", endpoint_host="host", flow_id="any-flow",
                           region="region", profile="DEFAULT", instance_id="instance", workspace_id="workspace")
    directory = tmp_path / profile.id
    directory.mkdir()
    (directory / "profile.json").write_text(profile.model_dump_json())
    store = ProfileStore(tmp_path)
    runtime = ScheduledRuntime(store, lambda: None)
    app = FastAPI()
    app.include_router(create_router(store, runtime))
    return TestClient(app), store, runtime, profile


def test_enrollment_persists_without_environment_and_surfaces_are_independent(setup, monkeypatch):
    client, store, runtime, profile = setup
    url = f"/api/desk/profiles/{profile.id}/reports"
    assert not runtime.supported(profile.id)
    assert client.put(url, json={"prod": True, "test": False}, headers=HEADERS).status_code == 200
    restarted = ScheduledRuntime(ProfileStore(store.root), lambda: None)
    assert restarted.supported(profile.id)
    assert not restarted.supported("test:" + profile.id)
    assert client.get("/api/desk/scheduled-tasks").json()["capabilities"] == [
        {"agentId": "demo", "reportSchemaVersion": "1.0"},
        {"agentId": profile.id, "reportSchemaVersion": "1.0"},
    ]
    monkeypatch.setenv("AGENT_DESK_REPORT_PROFILES", profile.id)
    assert client.put(url, json={"prod": False, "test": True}, headers=HEADERS).status_code == 200
    assert not restarted.supported(profile.id)  # Explicit revocation overrides the legacy environment.
    assert restarted.supported("test:" + profile.id)
    assert client.get(url, headers=HEADERS).json() == {"prod": False, "test": True}
    assert not list((store.root / profile.id).glob("*.tmp"))
    # Invalid persisted declarations fail closed instead of falling back to the environment.
    (store.root / profile.id / "reports.json").write_text('{"prod":"true"}')
    assert not restarted.supported(profile.id)


def test_settings_validate_target_origin_and_types(setup):
    client, store, runtime, profile = setup
    url = f"/api/desk/profiles/{profile.id}/reports"
    assert client.put(url, json={"prod": True}).status_code == 403
    assert client.get(url).json() == {"prod": False, "test": False}
    assert client.put(url, json={"prod": "true"}, headers=HEADERS).status_code == 422
    assert client.put(url, json={"prod": True, "unknown": True}, headers=HEADERS).status_code == 422
    assert client.put("/api/desk/profiles/" + "b" * 32 + "/reports", json={"prod": True}, headers=HEADERS).status_code == 404
    profile.surface = "TEST"
    profile.instance_id = ""
    (store.root / profile.id / "profile.json").write_text(profile.model_dump_json())
    assert client.put(url, json={"prod": True}, headers=HEADERS).status_code == 422
    assert client.put(url, json={"test": True}, headers=HEADERS).status_code == 422
    assert not runtime.supported(profile.id)
    assert not runtime.supported("test:" + profile.id)
    assert not (store.root / profile.id / "reports.json").exists()
