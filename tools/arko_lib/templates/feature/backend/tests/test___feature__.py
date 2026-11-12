from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.auth import current_user
from app.features.__feature__.api import create_router
from app.features.__feature__.service import Store


def test_owner_and_validation() -> None:
    app = FastAPI()
    app.include_router(create_router(Store()))
    app.dependency_overrides[current_user] = lambda: "alice"
    with TestClient(app) as client:
        response = client.post("/api/__feature__", json={"title": "hello"})
        assert response.status_code == 201
        path = f"/api/__feature__/{response.json()['id']}"
        assert client.get(path).status_code == 200
        app.dependency_overrides[current_user] = lambda: "bob"
        assert client.get(path).status_code == 404
        assert client.post("/api/__feature__", json={"title": " "}).status_code == 422
        assert client.post("/api/__feature__", json={"title": "ok", "owner": "alice"}).status_code == 422


def test_credentials(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    app = FastAPI()
    app.include_router(create_router(Store()))
    with TestClient(app) as client:
        monkeypatch.delenv("ARKO_API_TOKEN", raising=False)
        assert client.post("/api/__feature__", json={"title": "hi"}).status_code == 503
        monkeypatch.setenv("ARKO_API_TOKEN", "test-only-credential")
        assert client.post("/api/__feature__", json={"title": "hi"}).status_code == 401
        assert client.post("/api/__feature__", json={"title": "hi"},
                           headers={"Authorization": "Bearer wrong"}).status_code == 401
        assert client.post("/api/__feature__", json={"title": "hi"},
                           headers={"Authorization": "Bearer test-only-credential"}).status_code == 201
