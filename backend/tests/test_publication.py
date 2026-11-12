import importlib.util
from pathlib import Path


def checker():  # type: ignore[no-untyped-def]
    script = Path(__file__).resolve().parents[2] / "scripts/check-publication.py"
    spec = importlib.util.spec_from_file_location("publication_check", script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_publication_rejects_sensitive_paths_even_if_tracked(tmp_path: Path) -> None:
    inspect = checker().inspect_file
    for name in [".env.prod", "keys/private.pem", ".local/profiles.json", "frontend/dist/index.js",
                 "node_modules/module/index.js", "pytest-cache-files-leftover/entry",
                 ".oci/config", ".aws/credentials", ".ssh/id_rsa", ".source/customer.txt",
                 ".codex/session.json", ".agents/memory.md"]:
        assert inspect(tmp_path, name), name
    (tmp_path / ".env.example").write_text("# no credentials\n", encoding="utf-8")
    assert inspect(tmp_path, ".env.example") == []


def test_publication_flags_secrets_and_encoding_without_printing_values(tmp_path: Path) -> None:
    inspect = checker().inspect_file
    path = tmp_path / "source.txt"
    path.write_text("-----BEGIN " + "PRIVATE KEY-----\n", encoding="utf-8")
    assert inspect(tmp_path, path.name) == ["possible secret; review locally"]
    path.write_bytes(b"bad\xffencoding")
    assert inspect(tmp_path, path.name) == ["source/documentation is not UTF-8"]
    path.write_text("safe source\n", encoding="utf-8")
    assert inspect(tmp_path, path.name) == []
