import configparser
import hashlib
from pathlib import Path
from typing import Any

import oci  # type: ignore[import-untyped]
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pytest import MonkeyPatch
from test_profiles import HEADERS, make_client
from test_profiles import credentials as credentials

from app.features.desk.credentials import ProfileStore
from app.features.desk.discovery import Discovery, DiscoveryQueryError, credential_profiles
from app.features.desk.schemas import DiscoveryAgent, DiscoveryItem, DiscoveryOptions


@pytest.fixture(autouse=True)
def no_live_test_discovery(monkeypatch: MonkeyPatch) -> None:
    # Existing publication fixtures stay offline; TEST discovery has explicit positive controls below.
    monkeypatch.setattr(Discovery, "test_endpoint", lambda *args: "")


def test_unpublished_agent_can_be_imported_from_active_test(
    tmp_path: Path, credentials: tuple[bytes, bytes], monkeypatch: MonkeyPatch,
) -> None:
    discovery = Discovery(*credentials, "DEFAULT")
    endpoint = "https://gateway.aidp.us-ashburn-1.oci.oraclecloud.com/agentendpoint/developing_TEST/chat"
    monkeypatch.setattr(discovery, "dp", lambda path: [{"key": "developing", "displayName": "Development"}])
    monkeypatch.setattr(discovery, "published_endpoint", lambda *args: "")
    calls = []
    monkeypatch.setattr(discovery, "test_endpoint", lambda *args: calls.append(args) or endpoint)
    agents, endpoints = discovery.agents("platform", "workspace")
    assert agents[0].available and agents[0].description == "Desarrollo (TEST)"
    assert calls == [("platform", "workspace", "developing")]
    assert endpoints == {"developing": endpoint}
    monkeypatch.setattr(discovery, "catalog", lambda *args: DiscoveryOptions(agents=agents))
    monkeypatch.setattr(discovery, "audio", lambda: ([], [], []))
    profile = discovery.save(ProfileStore(tmp_path), "comp", "platform", "workspace", "", "", ["developing"])[0]
    assert profile.surface == "TEST" and profile.flow_id == "developing"


def draft_catalog(monkeypatch: MonkeyPatch) -> None:
    agents = [DiscoveryAgent(id="agent1", name="Research", available=True)]
    monkeypatch.setattr(
        Discovery,
        "compartments",
        lambda self: [DiscoveryItem(id="comp", name="Main"), DiscoveryItem(id="other", name="Other")],
    )
    monkeypatch.setattr(Discovery, "instances", lambda *args: [DiscoveryItem(id="platform", name="AIDP")])
    monkeypatch.setattr(
        Discovery, "workspaces", lambda *args: [DiscoveryItem(id="workspace", name="Workspace")]
    )
    monkeypatch.setattr(
        Discovery, "agents", lambda *args: (agents, {"agent1": "https://agent.example.org/invoke"})
    )
    monkeypatch.setattr(
        Discovery,
        "audio",
        lambda self: (
            [DiscoveryItem(id="ORACLE", name="Oracle")],
            [DiscoveryItem(id="voice", name="Voice")],
            [],
        ),
    )


def test_draft_steps_persist_resume_without_files_and_update_audio_without_duplicates(
    tmp_path: Path,
    credentials: tuple[bytes, bytes],
    monkeypatch: MonkeyPatch,
) -> None:
    draft_catalog(monkeypatch)
    config, key = credentials
    files = {"config": ("../../config", config), "key": ("../../key.pem", key)}
    with make_client(tmp_path) as client:
        assert client.get("/api/desk/discovery/draft").status_code == 403
        empty = client.post("/api/desk/discovery/draft/read", headers=HEADERS).json()
        assert not empty["has_credentials"] and empty["profiles"] == []
        saved = client.post(
            "/api/desk/discovery/draft",
            data={"step": "connection", "profile": "DEFAULT", "compartment_id": "comp"},
            files=files,
            headers=HEADERS,
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["has_credentials"] is True
        assert client.get("/api/desk/profiles").json() == []
        private = (tmp_path / ".discovery-draft.json").read_text()
        assert "untrusted" not in private and "key_file" not in private and "extra" not in private
    # A fresh client/store represents reload/restart: neither original upload is needed again.
    with make_client(tmp_path) as client:
        resumed = client.get("/api/desk/discovery/draft", headers=HEADERS)
        assert resumed.json()["compartment_id"] == "comp"
        for hidden in ("PRIVATE KEY", "fingerprint", "tenancy", "key_file"):
            assert hidden not in resumed.text
        assert client.post("/api/desk/discovery/profiles", headers=HEADERS).status_code == 200
        assert (
            client.post(
                "/api/desk/discovery/options",
                data={"stage": "audio", "compartment_id": "comp"},
                headers=HEADERS,
            ).status_code
            == 200
        )
        selected = {
            "step": "agents",
            "instance_id": "platform",
            "workspace_id": "workspace",
            "agent_ids": '["agent1"]',
        }
        imported = client.post(
            "/api/desk/discovery/draft",
            data={**selected, "transcription_model": "ORACLE", "speech_model": "voice"},
            headers=HEADERS,
        )
        assert imported.status_code == 200, imported.text
        assert imported.json()["transcription_model"] == ""
        assert imported.json()["speech_model"] == ""
        identity = imported.json()["profiles"][0]["id"]
        again = client.post("/api/desk/discovery/draft", data=selected, headers=HEADERS)
        assert again.status_code == 200, again.text
        assert [item["id"] for item in again.json()["profiles"]] == [identity]
        audio = client.post(
            "/api/desk/discovery/draft",
            data={"step": "audio", "transcription_model": "ORACLE", "speech_model": "voice"},
            headers=HEADERS,
        )
        assert audio.status_code == 200, audio.text
        assert audio.json()["profiles"][0]["id"] == identity
        persisted = client.get("/api/desk/profiles").json()
        assert len(persisted) == 1 and persisted[0]["transcription_model"] == "ORACLE"
        assert persisted[0]["speech_model"] == "voice" and persisted[0]["ready"] is False
        changed = client.post(
            "/api/desk/discovery/draft",
            data={"step": "connection", "compartment_id": "other"},
            headers=HEADERS,
        )
        assert changed.status_code == 200, changed.text
        assert changed.json()["agent_ids"] == [] and changed.json()["profiles"] == []
        assert changed.json()["speech_model"] == "" and len(client.get("/api/desk/profiles").json()) == 1


def test_draft_rejects_partial_upload_forged_selection_and_preserves_previous_save(
    tmp_path: Path,
    credentials: tuple[bytes, bytes],
    monkeypatch: MonkeyPatch,
) -> None:
    draft_catalog(monkeypatch)
    config, key = credentials
    with make_client(tmp_path) as client:
        assert (
            client.post("/api/desk/discovery/draft", data={"step": "connection"}, headers=HEADERS).status_code
            == 422
        )
        response = client.post(
            "/api/desk/discovery/draft",
            data={"step": "connection", "compartment_id": "comp"},
            files={"config": ("config", config), "key": ("key", key)},
            headers=HEADERS,
        )
        assert response.status_code == 200
        previous = (tmp_path / ".discovery-draft.json").read_bytes()
        attempts = [
            ({"step": "connection"}, {"config": ("config", config)}),
            ({"step": "audio", "speech_model": "forged"}, {}),
            (
                {
                    "step": "agents",
                    "agent_ids": '["forged"]',
                    "instance_id": "platform",
                    "workspace_id": "workspace",
                },
                {},
            ),
            ({"step": "agents", "agent_ids": '"not-a-list"'}, {}),
        ]
        for data, files in attempts:
            rejected = client.post("/api/desk/discovery/draft", data=data, files=files, headers=HEADERS)
            assert rejected.status_code == 422, rejected.text
            assert (tmp_path / ".discovery-draft.json").read_bytes() == previous
            assert client.get("/api/desk/profiles").json() == []
        monkeypatch.setattr(
            Discovery,
            "compartments",
            lambda self: (_ for _ in ()).throw(
                oci.exceptions.ServiceError(403, "NotAuthorized", {}, "PRIVATE")
            ),
        )
        failed = client.post("/api/desk/discovery/draft", data={"step": "connection"}, headers=HEADERS)
        assert failed.status_code == 502 and "PRIVATE" not in failed.text
        assert (tmp_path / ".discovery-draft.json").read_bytes() == previous


def test_draft_stale_save_and_failed_audio_commit_preserve_credentials_and_profiles(
    tmp_path: Path,
    credentials: tuple[bytes, bytes],
    monkeypatch: MonkeyPatch,
) -> None:
    draft_catalog(monkeypatch)
    config, key = credentials
    with make_client(tmp_path) as client:
        response = client.post(
            "/api/desk/discovery/draft",
            data={"step": "connection", "compartment_id": "comp"},
            files={"config": ("config", config), "key": ("key", key)},
            headers=HEADERS,
        )
        assert response.status_code == 200
        imported = client.post(
            "/api/desk/discovery/draft",
            data={
                "step": "agents",
                "instance_id": "platform",
                "workspace_id": "workspace",
                "agent_ids": '["agent1"]',
            },
            headers=HEADERS,
        )
        assert imported.status_code == 200
    store = ProfileStore(tmp_path)
    state, saved_config, saved_key, revision = store.draft()
    previous = (tmp_path / ".discovery-draft.json").read_bytes()
    profile_path = tmp_path / state.profiles[0].id / "profile.json"
    previous_profile = profile_path.read_bytes()
    with pytest.raises(ValueError, match="conexión cambió"):
        store.save_draft(state, saved_config, saved_key, "stale-revision")
    updated = [state.profiles[0].model_copy(update={"transcription_model": "ORACLE"})]
    pending = state.model_copy(update={"transcription_model": "ORACLE", "profiles": updated})
    replace = Path.replace

    def fail_snapshot(source: Path, target: Path) -> Path:
        if target.name == ".discovery-draft.json":
            raise OSError("simulated disk failure")
        return replace(source, target)

    monkeypatch.setattr(Path, "replace", fail_snapshot)
    with pytest.raises(OSError, match="disk failure"):
        store.save_draft(pending, saved_config, saved_key, revision, updated)
    assert profile_path.read_bytes() == previous_profile
    assert (tmp_path / ".discovery-draft.json").read_bytes() == previous
    assert not list(tmp_path.glob(".draft-*.tmp"))
    removed = state.model_copy(update={"profiles": [], "agent_ids": []})
    with pytest.raises(OSError, match="disk failure"):
        store.save_draft(removed, saved_config, saved_key, revision, removals=[state.profiles[0].id])
    assert profile_path.read_bytes() == previous_profile
    assert (tmp_path / ".discovery-draft.json").read_bytes() == previous
    assert not list(tmp_path.glob(".retired-*"))


def test_draft_reselection_reuses_vault_profiles_only_for_matching_credentials_and_scope(
    tmp_path: Path,
    credentials: tuple[bytes, bytes],
    monkeypatch: MonkeyPatch,
) -> None:
    draft_catalog(monkeypatch)
    agents = [DiscoveryAgent(id=identity, name=identity, available=True) for identity in ("agent1", "agent2")]
    monkeypatch.setattr(
        Discovery,
        "agents",
        lambda *args: (
            agents,
            {identity: "https://agent.example.org/invoke" for identity in ("agent1", "agent2")},
        ),
    )
    config, key = credentials
    alternate_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = alternate_key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    fingerprint = ":".join(f"{byte:02x}" for byte in hashlib.md5(public, usedforsecurity=False).digest())
    parser = configparser.ConfigParser()
    parser.read_string(config.decode())
    other_config = config.replace(parser["DEFAULT"]["fingerprint"].encode(), fingerprint.encode())
    other_key = alternate_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    store = ProfileStore(tmp_path)
    selection = {"compartment_id": "comp", "instance_id": "platform", "workspace_id": "workspace"}
    foreign = [
        store.create(
            "Other key",
            "https://agent.example.org/invoke",
            "agent2",
            "DEFAULT",
            other_config,
            other_key,
            selection,
        ),
        store.create(
            "Other user",
            "https://agent.example.org/invoke",
            "agent2",
            "DEFAULT",
            config.replace(b"user.oc1..example", b"user.oc1..other"),
            key,
            selection,
        ),
        store.create(
            "Other profile",
            "https://agent.example.org/invoke",
            "agent2",
            "ALT",
            config + b"\n[ALT]\n",
            key,
            selection,
        ),
        store.create(
            "Other workspace",
            "https://agent.example.org/invoke",
            "agent2",
            "DEFAULT",
            config,
            key,
            {**selection, "workspace_id": "another"},
        ),
    ]
    with make_client(tmp_path) as client:
        connection = client.post(
            "/api/desk/discovery/draft",
            data={"step": "connection", "compartment_id": "comp"},
            files={"config": ("config", config), "key": ("key", key)},
            headers=HEADERS,
        )
        assert connection.status_code == 200
        fields = {
            "step": "agents",
            "instance_id": "platform",
            "workspace_id": "workspace",
            "agent_ids": '["agent1","agent2"]',
        }
        first = client.post("/api/desk/discovery/draft", data=fields, headers=HEADERS)
        assert first.status_code == 200, first.text
        initial = {item["flow_id"]: item["id"] for item in first.json()["profiles"]}
        assert not set(initial.values()) & {item.id for item in foreign}
        reduced = client.post(
            "/api/desk/discovery/draft", data={**fields, "agent_ids": '["agent1"]'}, headers=HEADERS
        )
        assert reduced.status_code == 200 and len(reduced.json()["profiles"]) == 1
        audio = client.post(
            "/api/desk/discovery/draft",
            data={"step": "audio", "transcription_model": "ORACLE"},
            headers=HEADERS,
        )
        assert audio.status_code == 200
        profiles = {item["id"]: item for item in client.get("/api/desk/profiles").json()}
        assert profiles[initial["agent1"]]["transcription_model"] == "ORACLE"
        assert initial["agent2"] not in profiles
        assert not (tmp_path / initial["agent2"]).exists()
        assert all(item.id in profiles for item in foreign)
        restored = client.post("/api/desk/discovery/draft", data=fields, headers=HEADERS)
        assert restored.status_code == 200, restored.text
        assert restored.json()["profiles"][0]["id"] == initial["agent1"]
        assert len(client.get("/api/desk/profiles").json()) == len(foreign) + 2
        removed = client.post(
            "/api/desk/discovery/draft", data={**fields, "agent_ids": "[]"}, headers=HEADERS
        )
        assert removed.status_code == 200, removed.text
        assert removed.json()["profiles"] == [] and removed.json()["agent_ids"] == []
        assert {item["id"] for item in client.get("/api/desk/profiles").json()} == {
            item.id for item in foreign
        }
        assert client.post("/api/desk/discovery/draft/read", headers=HEADERS).json()["profiles"] == []


def test_profiles_ignore_uploaded_paths_and_only_show_matching_keys(credentials: tuple[bytes, bytes]) -> None:
    config, key = credentials
    config += b"\n[SECOND]\nregion=us-phoenix-1\n[WRONG]\nfingerprint=wrong\n"
    profiles = credential_profiles(config, key).model_dump()
    assert profiles == {
        "profiles": [
            {"name": "DEFAULT", "region": "us-ashburn-1"},
            {"name": "SECOND", "region": "us-phoenix-1"},
        ]
    }
    assert "key_file" not in str(profiles) and "fingerprint" not in str(profiles)
    with pytest.raises(ValueError):
        credential_profiles(config, b"bad-key")


def test_import_normalizes_server_key_path_and_saves_selection(
    tmp_path: Path,
    credentials: tuple[bytes, bytes],
    monkeypatch: MonkeyPatch,
) -> None:
    config, key = credentials
    discovery = Discovery(config, key, "DEFAULT")
    catalog = DiscoveryOptions(agents=[DiscoveryAgent(id="agent1", name="Research", available=True)])
    monkeypatch.setattr(discovery, "catalog", lambda *args: catalog)
    monkeypatch.setattr(
        discovery,
        "agents",
        lambda *args: (catalog.agents, {"agent1": "https://agent.oraclecloud.com/invoke"}),
    )
    monkeypatch.setattr(discovery, "audio", lambda: ([DiscoveryItem(id="ORACLE", name="Oracle")], [], []))
    store = ProfileStore(tmp_path)
    result = discovery.save(store, "comp", "platform", "workspace", "ORACLE", "", ["agent1"])
    target = tmp_path / result[0].id
    normalized = configparser.ConfigParser()
    normalized.read(target / "config")
    assert Path(normalized["DEFAULT"]["key_file"]) == (target / "key.pem").resolve()
    assert Path(normalized["DEFAULT"]["key_file"]).is_file()
    assert "untrusted" not in (target / "config").read_text()
    assert result[0].compartment_id == "comp"
    assert result[0].transcription_model == "ORACLE"
    assert result[0].ready is False
    with pytest.raises(ValueError, match="TEST o PROD activo"):
        discovery.save(store, "comp", "platform", "workspace", "", "", ["forged"])
    assert len(store.list()) == 1


def test_import_rolls_back_partial_batch(
    tmp_path: Path, credentials: tuple[bytes, bytes], monkeypatch: MonkeyPatch
) -> None:
    discovery = Discovery(*credentials, "DEFAULT")
    agents = [
        DiscoveryAgent(id="one", name="One", available=True),
        DiscoveryAgent(id="two", name="Two", available=True),
    ]
    monkeypatch.setattr(discovery, "catalog", lambda *args: DiscoveryOptions(agents=agents))
    monkeypatch.setattr(
        discovery, "agents", lambda *args: (agents, {"one": "https://agent.example.org", "two": "invalid"})
    )
    monkeypatch.setattr(discovery, "audio", lambda: ([], [], []))
    store = ProfileStore(tmp_path)
    with pytest.raises(ValueError):
        discovery.save(store, "comp", "platform", "ws", "", "", ["one", "two"])
    assert store.list() == []


def test_discovery_api_guards_and_sanitizes_cloud_errors(
    tmp_path: Path,
    credentials: tuple[bytes, bytes],
    monkeypatch: MonkeyPatch,
) -> None:
    config, key = credentials
    files = {"config": ("config", config), "key": ("key.pem", key)}
    with make_client(tmp_path) as client:
        assert client.post("/api/desk/discovery/profiles", files=files).status_code == 403
        assert client.post("/api/desk/discovery/profiles", files=files, headers=HEADERS).status_code == 200
        assert (
            client.post("/api/desk/discovery/profiles", content=b"x" * 100001, headers=HEADERS).status_code
            == 413
        )

        def fail(*args: Any) -> Any:
            raise oci.exceptions.ServiceError(403, "NotAuthorized", {}, "PRIVATE-DETAIL")

        monkeypatch.setattr(Discovery, "catalog", fail)
        response = client.post(
            "/api/desk/discovery/options",
            files=files,
            headers=HEADERS,
            data={"stage": "compartments", "profile": "DEFAULT"},
        )
        assert response.status_code == 502
        assert "PRIVATE-DETAIL" not in response.text
        assert list(tmp_path.iterdir()) == []


def test_agent_selection_requires_active_production_deployment(
    credentials: tuple[bytes, bytes], monkeypatch: MonkeyPatch
) -> None:
    discovery = Discovery(*credentials, "DEFAULT")

    def catalog(path: str) -> list[dict[str, Any]]:
        if path.endswith("/agents"):
            return [{"key": key, "displayName": key} for key in ["test-only", "live"]]
        if "/test-only/" in path:
            return [
                {
                    "key": "dep1",
                    "agentKey": "test-only",
                    "deploymentType": "TEST",
                    "lifecycleState": "ACTIVE",
                    "endpointUrl": "https://test.example.org",
                }
            ]
        return [
            {
                "key": "dep2",
                "agentKey": "live",
                "deploymentType": "PROD",
                "lifecycleState": "ACTIVE",
                "endpointUrl": "https://live.example.org",
            }
        ]

    monkeypatch.setattr(discovery, "dp", catalog)
    agents, endpoints = discovery.agents("platform", "workspace")
    assert [agent.available for agent in agents] == [False, True]
    assert endpoints == {"live": "https://live.example.org"}


def test_dataplane_uses_only_fixed_get_paths_and_paginates(
    credentials: tuple[bytes, bytes], monkeypatch: MonkeyPatch
) -> None:
    discovery = Discovery(*credentials, "DEFAULT")
    calls = []

    def call(path: str, method: str, **kwargs: Any) -> Any:
        from types import SimpleNamespace

        calls.append((path, method, kwargs))
        return SimpleNamespace(
            data={"items": [{"key": str(len(calls))}]},
            headers={"opc-next-page": "page2"} if len(calls) == 1 else {},
        )

    monkeypatch.setattr(discovery.data_client, "call_api", call)
    assert len(discovery.dp("/aiDataPlatforms/platform/workspaces")) == 2
    assert all(method == "GET" for _, method, _ in calls)
    assert calls[0][2]["query_params"] == {"limit": 100}
    assert calls[1][2]["query_params"] == {"limit": 100, "page": "page2"}
    assert discovery.data_client.endpoint == "https://datalake.us-ashburn-1.oci.oraclecloud.com/20260430"
    with pytest.raises(ValueError):
        discovery.workspaces("../../localhost")


def test_missing_summary_endpoint_is_checked_in_deployment_detail(
    credentials: tuple[bytes, bytes],
    monkeypatch: MonkeyPatch,
) -> None:
    from types import SimpleNamespace

    discovery = Discovery(*credentials, "DEFAULT")
    published = {"key": "dep", "agentKey": "agent", "deploymentType": "PROD", "lifecycleState": "ACTIVE"}
    summary = {name: value for name, value in published.items() if name != "agentKey"}
    monkeypatch.setattr(discovery, "dp", lambda path: [summary])
    calls = []

    def detail(path: str, method: str, **kwargs: Any) -> Any:
        calls.append((path, method))
        return SimpleNamespace(data={**published, "endpointUrl": "https://agent.example.org"})

    monkeypatch.setattr(discovery.data_client, "call_api", detail)
    assert discovery.published_endpoint("/agents/agent/deployments", "agent") == "https://agent.example.org"
    assert calls == [("/agents/agent/deployments/dep", "GET")]


def test_import_rejects_publication_removed_during_revalidation(
    tmp_path: Path,
    credentials: tuple[bytes, bytes],
    monkeypatch: MonkeyPatch,
) -> None:
    discovery = Discovery(*credentials, "DEFAULT")
    monkeypatch.setattr(
        discovery,
        "catalog",
        lambda *args: DiscoveryOptions(agents=[DiscoveryAgent(id="gone", name="Gone", available=True)]),
    )
    monkeypatch.setattr(discovery, "audio", lambda: ([], [], []))
    monkeypatch.setattr(discovery, "agents", lambda *args: ([], {}))
    store = ProfileStore(tmp_path)
    with pytest.raises(ValueError, match="deployment cambió"):
        discovery.save(store, "comp", "instance", "workspace", "", "", ["gone"])
    assert store.list() == []


def test_dataplane_failure_identifies_operation_without_private_details(
    tmp_path: Path, credentials: tuple[bytes, bytes], monkeypatch: MonkeyPatch
) -> None:
    def fail(*args: Any, **kwargs: Any) -> Any:
        raise oci.exceptions.ServiceError(404, "NotAuthorizedOrNotFound", {}, "PRIVATE-DETAIL secret-id")

    discovery = Discovery(*credentials, "DEFAULT")
    monkeypatch.setattr(discovery.data_client, "call_api", fail)
    with pytest.raises(DiscoveryQueryError, match="listar Agent Flows.*HTTP 404") as caught:
        discovery.dp("/aiDataPlatforms/private-id/workspaces/ws/agents")
    assert "PRIVATE-DETAIL" not in str(caught.value) and "private-id" not in str(caught.value)
    monkeypatch.setattr(Discovery, "catalog", lambda *args: (_ for _ in ()).throw(caught.value))
    with make_client(tmp_path) as client:
        response = client.post(
            "/api/desk/discovery/options",
            headers=HEADERS,
            files={"config": ("config", credentials[0]), "key": ("key.pem", credentials[1])},
            data={"profile": "DEFAULT", "stage": "agents"},
        )
    assert response.status_code == 502
    assert "listar Agent Flows" in response.json()["detail"]
    assert "PRIVATE-DETAIL" not in response.text

    internal = DiscoveryQueryError(
        "listar Agent Flows", oci.exceptions.ServiceError(500, "InternalError", {}, "PRIVATE")
    )
    assert "OCI devolvió un error interno" in str(internal)
    assert "Revisa permisos" not in str(internal)


def test_one_inaccessible_publication_keeps_other_agents_and_blocks_import(
    tmp_path: Path, credentials: tuple[bytes, bytes], monkeypatch: MonkeyPatch
) -> None:
    from types import SimpleNamespace

    discovery = Discovery(*credentials, "DEFAULT")

    def call(path: str, *args: Any, **kwargs: Any) -> Any:
        if path.endswith("/agents"):
            return SimpleNamespace(data={"items": [{"key": "blocked"}, {"key": "live"}]}, headers={})
        if "/blocked/" in path:
            raise oci.exceptions.ServiceError(403, "NotAuthorized", {}, "PRIVATE-DETAIL")
        return SimpleNamespace(
            data={
                "items": [
                    {
                        "key": "dep",
                        "agentKey": "live",
                        "deploymentType": "PROD",
                        "lifecycleState": "ACTIVE",
                        "endpointUrl": "https://live.example.org",
                    }
                ]
            },
            headers={},
        )

    monkeypatch.setattr(discovery.data_client, "call_api", call)
    agents, endpoints = discovery.agents("platform", "ws")
    assert [agent.available for agent in agents] == [False, True]
    assert endpoints == {"live": "https://live.example.org"}
    assert "HTTP 403" in agents[0].description
    assert "PRIVATE-DETAIL" not in str(agents) + str(discovery.warnings)
    monkeypatch.setattr(discovery, "catalog", lambda *args: DiscoveryOptions(agents=agents))
    store = ProfileStore(tmp_path)
    with pytest.raises(ValueError, match="TEST o PROD activo"):
        discovery.save(store, "comp", "platform", "ws", "", "", ["blocked"])
    assert store.list() == []


def test_generative_ai_audio_is_documented_for_chicago_without_inference(
    credentials: tuple[bytes, bytes],
) -> None:
    discovery = Discovery(*credentials, "DEFAULT")
    discovery.values["region"] = "us-chicago-1"
    transcription, models, warnings = discovery.audio()
    assert [model.id for model in transcription] == ["oci.speech.whisper.es"]
    assert [model.id for model in models] == ["oci.speech.carmen.es-ES"]
    assert any("permisos" in warning for warning in warnings)
    assert all("Gemini" not in warning and "xAI" not in warning for warning in warnings)
    assert not any("Phoenix" in warning for warning in warnings)


def test_clear_draft_requires_local_origin_and_preserves_added_agents(
    tmp_path: Path,
    credentials: tuple[bytes, bytes],
    monkeypatch: MonkeyPatch,
) -> None:
    draft_catalog(monkeypatch)
    config, key = credentials
    with make_client(tmp_path) as client:
        saved = client.post(
            "/api/desk/discovery/draft",
            data={"step": "connection", "compartment_id": "comp"},
            files={"config": ("config", config), "key": ("key.pem", key)},
            headers=HEADERS,
        )
        assert saved.status_code == 200
        imported = client.post(
            "/api/desk/discovery/draft",
            data={
                "step": "agents",
                "instance_id": "platform",
                "workspace_id": "workspace",
                "agent_ids": '["agent1"]',
            },
            headers=HEADERS,
        )
        assert imported.status_code == 200
        profiles = client.get("/api/desk/profiles").json()
        assert profiles
        assert client.delete("/api/desk/discovery/draft").status_code == 403
        assert (tmp_path / ".discovery-draft.json").exists()
        assert client.delete("/api/desk/discovery/draft", headers=HEADERS).status_code == 204
        assert not (tmp_path / ".discovery-draft.json").exists()
        assert not client.post("/api/desk/discovery/draft/read", headers=HEADERS).json()["has_credentials"]
        assert client.get("/api/desk/profiles").json() == profiles
        assert client.delete("/api/desk/discovery/draft", headers=HEADERS).status_code == 204


def test_audio_rejects_legacy_models_and_offers_only_native_speech(credentials: tuple[bytes, bytes]) -> None:
    discovery = Discovery(*credentials, "DEFAULT")
    discovery.values["region"] = "us-chicago-1"
    discovery.validate_audio("comp", "oci.speech.whisper.es", "oci.speech.carmen.es-ES")
    discovery.validate_audio("comp", "", "")
    for transcription, speech in [("google.gemini-2.5-flash", ""), ("", "xai.grok-tts")]:
        with pytest.raises(ValueError):
            discovery.validate_audio("comp", transcription, speech)
    discovery.values["region"] = "us-ashburn-1"
    models, voices, warnings = discovery.audio()
    assert models == [] and voices == []
    assert warnings


@pytest.mark.parametrize("section", ["agents", "audio"])
def test_cancel_section_survives_reload_and_preserves_other_sections(
    tmp_path: Path, credentials: tuple[bytes, bytes], monkeypatch: MonkeyPatch, section: str
) -> None:
    draft_catalog(monkeypatch)
    config, key = credentials
    with make_client(tmp_path) as client:
        assert (
            client.post(
                "/api/desk/discovery/draft",
                data={"step": "connection", "profile": "DEFAULT", "compartment_id": "comp"},
                files={"config": ("config", config), "key": ("key.pem", key)},
                headers=HEADERS,
            ).status_code
            == 200
        )
        saved = client.post(
            "/api/desk/discovery/draft",
            data={
                "step": "agents",
                "instance_id": "platform",
                "workspace_id": "workspace",
                "agent_ids": '["agent1"]',
            },
            headers=HEADERS,
        ).json()
        identity = saved["profiles"][0]["id"]
        assert (
            client.post(
                "/api/desk/discovery/draft",
                data={"step": "audio", "transcription_model": "ORACLE", "speech_model": "voice"},
                headers=HEADERS,
            ).status_code
            == 200
        )
        suggestions = {"items": [{"title": "Consulta", "query": "Pregunta guardada"}]}
        assert (
            client.put(f"/api/desk/suggestions/{identity}", json=suggestions, headers=HEADERS).status_code
            == 200
        )
        assert client.post("/api/desk/discovery/draft/clear", json={"step": section}).status_code == 403
        assert (
            client.post(
                "/api/desk/discovery/draft/clear", json={"step": "invalid"}, headers=HEADERS
            ).status_code
            == 422
        )
        cleared = client.post("/api/desk/discovery/draft/clear", json={"step": section}, headers=HEADERS)
        assert cleared.status_code == 200, cleared.text
    with make_client(tmp_path) as client:
        state = client.post("/api/desk/discovery/draft/read", headers=HEADERS).json()
        assert (
            state["has_credentials"] and state["profile"] == "DEFAULT" and state["compartment_id"] == "comp"
        )
        assert [profile["id"] for profile in client.get("/api/desk/profiles").json()] == [identity]
        assert client.get(f"/api/desk/suggestions/{identity}").json() == suggestions
        if section == "agents":
            assert state["instance_id"] == state["workspace_id"] == "" and state["agent_ids"] == []
            assert state["transcription_model"] == "ORACLE" and state["speech_model"] == "voice"
            assert state["profiles"][0]["transcription_model"] == "ORACLE"
            # The association remains so cancelling Audio later still updates its profiles.
            assert (
                client.post(
                    "/api/desk/discovery/draft/clear", json={"step": "audio"}, headers=HEADERS
                ).status_code
                == 200
            )
            assert client.get("/api/desk/profiles").json()[0]["speech_model"] == ""
        else:
            assert (
                state["instance_id"] == "platform"
                and state["workspace_id"] == "workspace"
                and state["agent_ids"] == ["agent1"]
            )
            assert state["transcription_model"] == state["speech_model"] == ""
            assert state["profiles"][0]["transcription_model"] == state["profiles"][0]["speech_model"] == ""
