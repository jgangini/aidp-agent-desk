from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from app.main import app


def test_connection_exposes_no_secrets(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AIDP_AGENT_ENDPOINT", "https://private.example.org/secret-path")
    monkeypatch.setenv("AIDP_AGENT_FLOW_ID", "private-flow-id")
    monkeypatch.setenv("ARKO_API_TOKEN", "test-secret")
    with TestClient(app) as client:
        response = client.get("/api/desk/connection")
        assert response.status_code == 200
        assert response.json()["publication_configured"] is False
        assert response.json()["ready"] is False
        assert "private" not in response.text
        assert "test-secret" not in response.text


def test_pending_connection_and_invoke_fail_closed(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.delenv("AIDP_AGENT_ENDPOINT", raising=False)
    monkeypatch.delenv("AIDP_AGENT_FLOW_ID", raising=False)
    monkeypatch.delenv("ARKO_API_TOKEN", raising=False)
    payload = {"request_id": "run-1", "question": "Hello"}
    with TestClient(app) as client:
        assert client.get("/api/desk/connection").json()["publication_configured"] is False
        assert client.post("/api/desk/stream", json=payload).status_code == 403
        monkeypatch.setenv("ARKO_API_TOKEN", "test-only-credential")
        assert client.post("/api/desk/stream", json=payload).status_code == 403
        headers = {"Origin": "http://127.0.0.1:8317", "X-Agent-Desk": "configure"}
        response = client.post("/api/desk/stream", json=payload, headers=headers)
        assert response.status_code == 422
        assert "conexión AIDP guardada" in response.json()["detail"]
        assert (
            client.post("/api/desk/stream", json={**payload, "question": " "}, headers=headers).status_code
            == 422
        )
        assert (
            client.post(
                "/api/desk/stream", json={**payload, "endpoint": "http://localhost"}, headers=headers
            ).status_code
            == 422
        )
