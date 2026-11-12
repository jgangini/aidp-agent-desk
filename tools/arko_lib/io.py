import hashlib
import json
from pathlib import Path


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inside(root: Path, relative: str) -> Path:
    path = root / relative
    if Path(relative).is_absolute() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Path escapes project: {relative}")
    if any(p.is_symlink() or p.is_junction() for p in [path, *path.parents] if p != root.parent):
        raise ValueError(f"Linked path is not supported: {relative}")
    return path


def project(root: Path) -> dict:
    data = read_json(inside(root, ".arko/project.json"))
    if data.get("profile") != "fastapi-react" or data.get("standard") != "0.1.0":
        raise ValueError("Unsupported profile/standard; review upgrade before using this CLI")
    return data
