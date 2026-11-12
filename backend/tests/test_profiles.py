import hashlib
import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.features.desk.api import create_router
from app.features.desk.credentials import ProfileStore
from app.features.desk.scheduled_api import scheduled_router
from app.features.desk.scheduled_runtime import ScheduledRuntime
from app.main import limit_configuration_body

HEADERS = {"Origin": "http://127.0.0.1:8317", "X-Agent-Desk": "configure"}


def test_saved_profile_can_schedule_explicit_test_without_ready_flag(tmp_path, credentials, monkeypatch):
    store = ProfileStore(tmp_path)
    config, pem = credentials
    saved = store.create("Market", "https://agent.example.org/invoke", "flow", "DEFAULT", config, pem,
                         {"instance_id": "instance", "workspace_id": "workspace"})
    assert not saved.ready
    runtime = ScheduledRuntime(store, lambda: None)
    app = FastAPI()
    app.state.identity = None
    app.include_router(scheduled_router(runtime), prefix="/api/desk")
    target = "test:" + saved.id
    body = {"id": "test-task", "name": "Test", "instructions": "Test query", "agentId": target,
            "agentName": "Market (TEST)", "repeat": "daily", "startDate": "2030-01-01",
            "time": "10:00", "timeZone": "America/Lima", "createdAt": "2026-11-12T00:00:00Z"}
    with TestClient(app) as client:
        assert client.put("/api/desk/scheduled-tasks/test-task", json=body, headers=HEADERS).status_code == 403
        monkeypatch.setenv("AGENT_DESK_REPORT_PROFILES", target)
        listing = client.get("/api/desk/scheduled-tasks").json()
        assert {"agentId": target, "reportSchemaVersion": "1.0"} in listing["capabilities"]
        assert not any(item["agentId"] == saved.id for item in listing["capabilities"])
        result = client.put("/api/desk/scheduled-tasks/test-task", json=body, headers=HEADERS)
        assert result.status_code == 200
        runs = client.get("/api/desk/scheduled-tasks/test-task/runs").json()["runs"]
        assert len(runs) == 1 and runs[0]["status"] == "queued"
        assert client.put("/api/desk/scheduled-tasks/test-task", json=body, headers=HEADERS).status_code == 200
        assert len(runtime.store.runs("local", "test-task")) == 1


@pytest.fixture
def credentials() -> tuple[bytes, bytes]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    fingerprint = ":".join(f"{byte:02x}" for byte in hashlib.md5(public, usedforsecurity=False).digest())
    config = f"[DEFAULT]\nuser=ocid1.user.oc1..example\ntenancy=ocid1.tenancy.oc1..example\nregion=us-ashburn-1\nfingerprint={fingerprint}\nkey_file=../../untrusted.pem\nextra=ignored\n".encode()
    pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    return config, pem


def make_client(root: Path) -> TestClient:
    app = FastAPI()
    app.middleware("http")(limit_configuration_body)
    app.include_router(create_router(ProfileStore(root)))
    return TestClient(app)


def test_store_validates_and_redacts_credentials(tmp_path: Path, credentials: tuple[bytes, bytes]) -> None:
    config, pem = credentials
    data = {
        "name": "Market Intelligence",
        "endpoint": "https://agent.example.org/invoke",
        "flow_id": "flow-test",
    }
    files = {"config": ("../../config", config), "key": ("../../key.pem", pem)}
    with make_client(tmp_path) as client:
        response = client.post("/api/desk/profiles", data=data, files=files, headers=HEADERS)
        assert response.status_code == 201
        metadata = response.json()
        assert metadata["ready"] is False
        assert client.get("/api/desk/connection").json()["publication_configured"] is True
        stored = tmp_path / metadata["id"]
        assert (stored / "key.pem").read_bytes() == pem
        normalized_config = (stored / "config").read_text()
        assert f"key_file = {(stored / 'key.pem').resolve()}" in normalized_config
        assert "untrusted" not in (stored / "config").read_text()
        assert "extra" not in (stored / "config").read_text()
        public = client.get("/api/desk/profiles")
        assert "PRIVATE KEY" not in public.text
        assert "fingerprint" not in public.text
        assert "tenancy" not in public.text
        assert "connection.json" not in public.text
        assert public.json()[0]["name"] == data["name"]
        assert client.delete(f"/api/desk/profiles/{metadata['id']}", headers=HEADERS).status_code == 204
        assert client.get("/api/desk/profiles").json() == []
        assert not stored.exists()


def test_cross_origin_and_upload_size_guards(tmp_path: Path, credentials: tuple[bytes, bytes]) -> None:
    config, pem = credentials
    data = {"name": "Test", "endpoint": "https://agent.example.org", "flow_id": "test"}
    files = {"config": ("config", config), "key": ("key.pem", pem)}
    with make_client(tmp_path) as client:
        assert client.post("/api/desk/profiles", data=data, files=files).status_code == 403
        assert (
            client.post(
                "/api/desk/profiles",
                data=data,
                files=files,
                headers={**HEADERS, "Origin": "https://evil.example.org"},
            ).status_code
            == 403
        )
        assert client.post("/api/desk/profiles", content=b"x" * 100001, headers=HEADERS).status_code == 413
        response = client.post(
            "/api/desk/profiles",
            data=data,
            files={**files, "config": ("config", b"x" * 65537)},
            headers=HEADERS,
        )
        assert response.status_code == 422
        assert list(tmp_path.iterdir()) == []


def test_invalid_key_or_fingerprint_never_creates_files(
    tmp_path: Path, credentials: tuple[bytes, bytes]
) -> None:
    config, pem = credentials
    store = ProfileStore(tmp_path)
    for candidate, key in [
        (config, b"not-a-private-key"),
        (config.replace(b"fingerprint=", b"not_fingerprint="), pem),
    ]:
        with pytest.raises(ValueError):
            store.create("Test", "https://agent.example.org", "test", "DEFAULT", candidate, key)
    assert not list(tmp_path.iterdir())
    assert store.delete("../outside") is False


def test_files_persist_across_store_instances(tmp_path: Path, credentials: tuple[bytes, bytes]) -> None:
    config, pem = credentials
    created = ProfileStore(tmp_path).create(
        "Agent B", "https://agent.example.org", "flow-b", "DEFAULT", config, pem
    )
    assert ProfileStore(tmp_path).list()[0].id == created.id
    assert (
        json.loads((tmp_path / created.id / "connection.json").read_text())["endpoint"]
        == "https://agent.example.org"
    )
