from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.features.desk.api import create_router
from app.features.desk.credentials import ProfileStore
from app.features.desk.schemas import AgentProfile

HEADERS = {"Origin": "http://127.0.0.1:8317", "X-Agent-Desk": "configure"}
ITEM = {"title": "Pregunta", "query": "Consulta del agente"}


def client(root: Path) -> TestClient:
    app = FastAPI()
    app.include_router(create_router(ProfileStore(root)))
    return TestClient(app)


def test_suggestions_persist_clear_and_remain_scoped(tmp_path: Path) -> None:
    identity = "a" * 32
    folder = tmp_path / identity
    folder.mkdir()
    profile = AgentProfile(
        id=identity,
        name="Agent",
        endpoint_host="example.org",
        flow_id="flow",
        region="us-ashburn-1",
        profile="DEFAULT",
    )
    (folder / "profile.json").write_text(profile.model_dump_json())
    with client(tmp_path) as api:
        assert len(api.get("/api/desk/suggestions/demo").json()["items"]) == 9
        assert api.get(f"/api/desk/suggestions/{identity}").json() == {"items": []}
        assert (
            api.put(f"/api/desk/suggestions/{identity}", json={"items": [ITEM]}, headers=HEADERS).status_code
            == 200
        )
    with client(tmp_path) as api:
        assert api.get(f"/api/desk/suggestions/{identity}").json() == {"items": [ITEM]}
        assert len(api.get("/api/desk/suggestions/demo").json()["items"]) == 9
        assert (
            api.put(f"/api/desk/suggestions/{identity}", json={"items": []}, headers=HEADERS).status_code
            == 200
        )
        assert api.get(f"/api/desk/suggestions/{identity}").json() == {"items": []}


def test_suggestions_validate_origin_scope_and_content(tmp_path: Path) -> None:
    with client(tmp_path) as api:
        assert api.put("/api/desk/suggestions/demo", json={"items": [ITEM]}).status_code == 403
        assert (
            api.put(
                "/api/desk/suggestions/demo",
                json={"items": [ITEM]},
                headers={**HEADERS, "Origin": "https://untrusted.example"},
            ).status_code
            == 403
        )
        assert (
            api.put(
                "/api/desk/suggestions/demo", json={"items": [{**ITEM, "title": "  "}]}, headers=HEADERS
            ).status_code
            == 422
        )
        assert (
            api.put(
                "/api/desk/suggestions/demo", json={"items": [{**ITEM, "query": "a" * 501}]}, headers=HEADERS
            ).status_code
            == 422
        )
        assert (
            api.put("/api/desk/suggestions/demo", json={"items": [ITEM] * 31}, headers=HEADERS).status_code
            == 422
        )
        assert (
            api.put(
                "/api/desk/suggestions/demo", json={"items": [{**ITEM, "html": "x"}]}, headers=HEADERS
            ).status_code
            == 422
        )
        assert api.get(f"/api/desk/suggestions/{'b' * 32}").status_code == 404
        assert api.get("/api/desk/suggestions/invalid").status_code == 404
        assert not (tmp_path / ".demo-suggestions.json").exists()
