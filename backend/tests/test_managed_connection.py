import pytest
from test_discovery import draft_catalog
from test_profiles import HEADERS, make_client
from test_profiles import credentials as credentials

from app.features.desk.credentials import ProfileStore
from app.features.desk.discovery import Discovery
from app.features.desk.schemas import DiscoveryItem

COMPARTMENT = "ocid1.compartment.oc1..deployment"


@pytest.fixture
def managed(tmp_path, monkeypatch, credentials):
    config, key = credentials
    for name, data in (("config", config), ("key", key)):
        path = tmp_path / name
        path.write_bytes(data)
        monkeypatch.setenv("AGENT_DESK_BASE_" + name.upper(), str(path))
    monkeypatch.setenv("AGENT_DESK_MANAGED_CONNECTION", "1")
    monkeypatch.setenv("AGENT_DESK_COMPARTMENT_ID", COMPARTMENT)
    return ProfileStore(tmp_path / "profiles")


def test_managed_draft_uses_server_credentials_and_fails_closed(managed, monkeypatch):
    state, config, key, revision = managed.draft()
    assert state.connection_managed and state.has_credentials and state.compartment_id == COMPARTMENT
    assert config and key and revision == ""
    assert "PRIVATE" not in state.model_dump_json() and "fingerprint" not in state.model_dump_json()
    with pytest.raises(ValueError):
        managed.clear_draft()
    monkeypatch.delenv("AGENT_DESK_BASE_KEY")
    with pytest.raises(ValueError):
        managed.draft()


def test_managed_scope_change_resets_selection_without_destroying_old_draft(managed, monkeypatch):
    state, config, key, revision = managed.draft()
    managed.save_draft(
        state.model_copy(update={"instance_id": "platform", "agent_ids": ["a"]}), config, key, revision
    )
    stored = (managed.root / ".discovery-draft.json").read_bytes()
    assert managed.draft()[0].agent_ids == ["a"]
    monkeypatch.setenv("AGENT_DESK_COMPARTMENT_ID", "ocid1.compartment.oc1..other")
    restored = managed.draft()[0]
    assert restored.compartment_id.endswith("other") and restored.agent_ids == []
    assert (managed.root / ".discovery-draft.json").read_bytes() == stored
    monkeypatch.setenv("AGENT_DESK_COMPARTMENT_ID", "invalid")
    with pytest.raises(ValueError):
        managed.draft()


def test_managed_api_rejects_connection_overrides_before_cloud(managed, credentials, monkeypatch):
    def forbidden(*args):
        pytest.fail("Rejected request must not query OCI")

    monkeypatch.setattr(Discovery, "catalog", forbidden)
    config, key = credentials
    files = {"config": ("config", config), "key": ("key.pem", key)}
    with make_client(managed.root) as client:
        state = client.post("/api/desk/discovery/draft/read", headers=HEADERS).json()
        assert state["connection_managed"]
        assert client.delete("/api/desk/discovery/draft", headers=HEADERS).status_code == 403
        for data, uploads in [
            ({"step": "connection"}, None),
            ({"step": "agents"}, files),
            ({"step": "agents", "profile": "OTHER"}, None),
            ({"step": "agents", "compartment_id": "other"}, None),
        ]:
            assert (
                client.post(
                    "/api/desk/discovery/draft", data=data, files=uploads, headers=HEADERS
                ).status_code
                == 422
            )
        assert (
            client.post(
                "/api/desk/discovery/options",
                data={"stage": "resources", "compartment_id": "other"},
                headers=HEADERS,
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/desk/discovery/import",
                data={
                    "compartment_id": "other",
                    "instance_id": "platform",
                    "workspace_id": "workspace",
                    "agent_ids": '["agent1"]',
                },
                headers=HEADERS,
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/desk/profiles",
                data={"name": "Injected", "flow_id": "flow", "endpoint": "https://agent.example.org"},
                files=files,
                headers=HEADERS,
            ).status_code
            == 403
        )


def test_managed_agents_audio_and_cancel_preserve_connection(managed, monkeypatch):
    draft_catalog(monkeypatch)
    monkeypatch.setattr(
        Discovery, "compartments", lambda self: [DiscoveryItem(id=COMPARTMENT, name="Deployment")]
    )
    monkeypatch.setattr(Discovery, "test_endpoint", lambda *args: "")
    with make_client(managed.root) as client:
        saved = client.post(
            "/api/desk/discovery/draft",
            data={
                "step": "agents",
                "instance_id": "platform",
                "workspace_id": "workspace",
                "agent_ids": '["agent1"]',
            },
            headers=HEADERS,
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["connection_managed"] and len(saved.json()["profiles"]) == 1
        audio = client.post(
            "/api/desk/discovery/draft", data={"step": "audio", "speech_model": "voice"}, headers=HEADERS
        )
        assert audio.status_code == 200, audio.text
        cleared = client.post("/api/desk/discovery/draft/clear", json={"step": "agents"}, headers=HEADERS)
        assert cleared.status_code == 200 and cleared.json()["speech_model"] == "voice"
        assert cleared.json()["compartment_id"] == COMPARTMENT and cleared.json()["has_credentials"]
        assert cleared.json()["agent_ids"] == []


def test_managed_flag_cannot_be_persisted_into_legacy_mode(managed, monkeypatch):
    state, config, key, revision = managed.draft()
    managed.save_draft(state, config, key, revision)
    monkeypatch.setenv("AGENT_DESK_MANAGED_CONNECTION", "0")
    assert not managed.draft()[0].connection_managed


def test_managed_profiles_cannot_invoke_a_previous_operator_or_compartment(managed, credentials, monkeypatch):
    config, key = credentials
    profile = managed.create(
        "Agent",
        "https://agent.example.org/invoke",
        "flow",
        "DEFAULT",
        config,
        key,
        {"compartment_id": COMPARTMENT},
    )
    assert [item.id for item in managed.list()] == [profile.id]
    assert managed.connection(profile.id)[2] == key
    monkeypatch.setenv("AGENT_DESK_COMPARTMENT_ID", "ocid1.compartment.oc1..other")
    assert managed.list() == []
    with pytest.raises(ValueError, match="despliegue"):
        managed.connection(profile.id)
    assert (managed.root / profile.id / "profile.json").is_file()
    monkeypatch.setenv("AGENT_DESK_COMPARTMENT_ID", COMPARTMENT)
    changed = config.replace(b"ocid1.user.oc1..example", b"ocid1.user.oc1..different")
    (managed.root.parent / "config").write_bytes(changed)
    assert managed.list() == []
    with pytest.raises(ValueError, match="despliegue"):
        managed.connection(profile.id)
