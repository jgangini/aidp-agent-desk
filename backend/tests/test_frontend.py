import struct
from html.parser import HTMLParser
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.access import install_identity
from app.core.frontend import install_frontend
from app.core.identity import IdentitySettings

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


class Metadata(HTMLParser):
    def __init__(self, document: str):
        super().__init__()
        self.values: dict[str, str] = {}
        self.feed(document)

    def handle_starttag(self, tag, attrs):
        if tag == "meta":
            attributes = dict(attrs)
            key = attributes.get("property") or attributes.get("name")
            if key:
                assert key not in self.values
                self.values[key] = attributes.get("content", "")


@pytest.mark.parametrize("origin", ["https://desk.example", "https://192.0.2.10"])
def test_anonymous_share_uses_configured_origin_and_preserves_api_auth(tmp_path, monkeypatch, origin):
    monkeypatch.setenv("AGENT_DESK_DATA_DIR", str(tmp_path / "data"))
    app = FastAPI()
    settings = IdentitySettings(origin, "https://id.example", "client", "private", "s" * 40, "admin")
    install_identity(app, settings, lambda: [])
    # Use the source shell and real public assets, without depending on a prior build.
    (tmp_path / "index.html").write_text((FRONTEND / "index.html").read_text(), encoding="utf-8")
    (tmp_path / "social").mkdir()
    image = FRONTEND / "public/social/aidp-agent-desk-v1.jpg"
    (tmp_path / "social" / image.name).write_bytes(image.read_bytes())
    install_frontend(app, tmp_path, settings.origin)
    client = TestClient(app, base_url="https://untrusted.example", headers={
        "User-Agent": "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
        "X-Forwarded-Host": "untrusted.example",
    })
    for path in ("/", "/index.html", "/?share=v1"):
        response = client.get(path)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-cache"
        metadata = Metadata(response.text).values
        assert metadata["og:title"] == metadata["twitter:title"] == "AIDP Agent Desk"
        assert metadata["og:description"] == metadata["description"] == metadata["twitter:description"]
        assert "Agent Flows" in metadata["description"]
        assert metadata["og:image"] == metadata["twitter:image"] == origin + "/social/" + image.name
        assert metadata["twitter:card"] == "summary"
        assert metadata["og:image:width"] == metadata["og:image:height"] == "1200"
        assert "untrusted.example" not in response.text
    picture = client.get("/social/" + image.name)
    assert picture.status_code == 200 and picture.headers["content-type"] == "image/jpeg"
    assert picture.content[:2] == b"\xff\xd8"
    frame = picture.content.index(b"\xff\xc2")  # Official asset uses progressive JPEG.
    assert struct.unpack(">HH", picture.content[frame + 5:frame + 9]) == (1200, 1200)
    assert client.head("/").status_code == 200
    assert client.get("/api/desk/profiles").status_code == 401
    assert client.get("/social/missing.png").status_code == 404
    assert "/" not in app.openapi()["paths"]


def test_local_frontend_keeps_relative_images_and_escapes_origin(tmp_path):
    (tmp_path / "index.html").write_text((FRONTEND / "index.html").read_text(), encoding="utf-8")
    for origin in ("", 'https://example.test/\"<unsafe>'):
        app = FastAPI()
        install_frontend(app, tmp_path, origin)
        response = TestClient(app).get("/")
        assert Metadata(response.text).values["og:image"] == origin + "/social/aidp-agent-desk-v1.jpg"
        assert "<unsafe>" not in response.text
