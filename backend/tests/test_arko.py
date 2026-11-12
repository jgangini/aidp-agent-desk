import importlib
import json
from pathlib import Path

import pytest


def arko_context(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "tools"))
    return importlib.import_module("arko_lib.context")


def project_tree(root: Path, files: dict[str, str], features: dict) -> None:
    files = {
        **files,
        ".arko/project.json": json.dumps({
            "profile": "fastapi-react", "standard": "0.1.0", "frontend": False, "features": features,
        }),
        "docs/tasks/current.md": "Current task",
    }
    for name, text in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")


def test_context_resolves_imports_and_refuses_dynamic_imports(tmp_path, monkeypatch):
    context = arko_context(monkeypatch)
    path = tmp_path / "backend/app/features/desk/service.py"
    path.parent.mkdir(parents=True)
    path.write_text("import os\nfrom . import schemas\nfrom ...core import settings\n")
    assert context.python_imports(path, tmp_path) == [
        "app.core.settings", "app.features.desk.schemas", "os",
    ]
    for expression in ["__import__('os')", "importlib.import_module('os')",
                       "from importlib import import_module as load\nload('os')"]:
        path.write_text(expression)
        with pytest.raises(ValueError, match="Dynamic Python import"):
            context.python_imports(path, tmp_path)


def test_audit_keeps_feature_and_transport_boundaries(tmp_path, monkeypatch):
    context = arko_context(monkeypatch)
    files = {
        "backend/app/features/desk/service.py": "from app.features.other import schemas\nimport fastapi\n",
        "backend/app/features/desk/schemas.py": "from .service import query\n",
        "backend/app/features/other/schemas.py": "class Output: pass\n",
        "backend/app/core/boundary.py": "from app.features.desk import schemas\n",
    }
    features = {
        name: {"depends_on": deps, "files": [p for p in files if f"features/{name}/" in p]}
        for name, deps in [("desk", ["other"]), ("other", [])]
    }
    project_tree(tmp_path, files, features)
    errors = context.audit(tmp_path)
    assert len(errors) == 3
    assert any("domain/schema cannot import transport" in error for error in errors)
    assert any("schema cannot import service" in error for error in errors)
    assert any("core cannot import features" in error for error in errors)
    features["desk"]["depends_on"] = []
    project_tree(tmp_path, files, features)
    assert any("forbidden feature dependency" in error for error in context.audit(tmp_path))


def test_context_returns_dependency_closure_and_detects_stale_paths(tmp_path, monkeypatch):
    context = arko_context(monkeypatch)
    files = {
        f"backend/app/features/{name}/schemas.py": "class Output: pass\n"
        for name in ("desk", "other", "unrelated")
    }
    features = {
        name: {"depends_on": deps, "files": [p for p in files if f"features/{name}/" in p]}
        for name, deps in [("desk", ["other"]), ("other", []), ("unrelated", [])]
    }
    project_tree(tmp_path, files, features)
    result = context.context(tmp_path, "other")
    assert result["related_features"] == ["desk", "other"]
    assert result["problems"] == []
    assert result["task"] == "Current task"
    assert not any("/unrelated/" in row["path"] for row in result["files"])
    assert any(row.get("symbols") == [{"name": "Output", "line": 1}] for row in result["files"])
    features["desk"]["files"] = []
    project_tree(tmp_path, files, features)
    assert any("stale/unregistered path" in error for error in context.audit(tmp_path))
    with pytest.raises(ValueError, match="Unknown feature"):
        context.context(tmp_path, "absent")
