import difflib
import keyword
import re
from datetime import datetime, timezone
from pathlib import Path

from . import VERSION
from .io import digest, inside, project, write_json

TEMPLATES = Path(__file__).parent / "templates"


def template_files(group: str, name: str = "") -> dict[str, bytes]:
    result = {}
    for path in sorted((TEMPLATES / group).rglob("*")):
        if path.is_file():
            relative = path.relative_to(TEMPLATES / group).as_posix().replace("__feature__", name)
            result[relative] = path.read_bytes().replace(b"__feature__", name.encode())
    return result


def install_files(root: Path, files: dict[str, bytes]) -> None:
    # Validate the entire write set before touching an existing project.
    for relative in files:
        if inside(root, relative).exists():
            raise ValueError(f"Refusing to overwrite {relative}")
    for relative, content in files.items():
        path = inside(root, relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)


def runtime_files() -> dict[str, bytes]:
    scripts = Path(__file__).parent.parent
    return {
        "tools/" + p.relative_to(scripts).as_posix(): p.read_bytes()
        for p in scripts.rglob("*")
        if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"
    }


def feature_files(root: Path, name: str) -> list[str]:
    paths = []
    for base in (f"backend/app/features/{name}", f"frontend/src/features/{name}"):
        folder = inside(root, base)
        paths.extend(
            p.relative_to(root).as_posix()
            for p in folder.rglob("*")
            if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"
        )
    test = inside(root, f"backend/tests/test_{name}.py")
    if test.exists():
        paths.append(test.relative_to(root).as_posix())
    return sorted(paths)


def refresh_map(root: Path) -> None:
    data = project(root)
    for name in data["features"]:
        data["features"][name]["files"] = feature_files(root, name)
    write_json(root / ".arko/project.json", data)


def init(root: Path, frontend: bool) -> None:
    if root.exists() and any(root.iterdir()):
        raise ValueError("Initialize only an empty directory")
    files = template_files("base") | runtime_files()
    if frontend:
        files |= template_files("frontend")
    install_files(root, files)
    write_json(
        root / ".arko/project.json",
        {
            "standard": VERSION,
            "profile": "fastapi-react",
            "frontend": frontend,
            "features": {},
            "source": "Arko 0.1.0",
            "applied_at": datetime.now(timezone.utc).isoformat(),
            "managed": {p: digest(root / p) for p in sorted(files)},
        },
    )


def add_feature(root: Path, name: str) -> None:
    if not re.fullmatch(r"[a-z][a-z0-9_]*", name) or keyword.iskeyword(name):
        raise ValueError("Feature name must be a non-keyword Python identifier in snake_case")
    data = project(root)
    if name in data["features"]:
        raise ValueError(f"Feature already registered: {name}")
    files = template_files("feature", name)
    if data["frontend"]:
        files |= template_files("feature_frontend", name)
    install_files(root, files)
    data["features"][name] = {"depends_on": [], "files": feature_files(root, name)}
    data["managed"].update({p: digest(root / p) for p in files})
    write_json(root / ".arko/project.json", data)
    print(f"Created {name}; mount its router explicitly in backend/app/main.py; export and review contract.")


def add_frontend(root: Path) -> None:
    data = project(root)
    if data["frontend"]:
        raise ValueError("Frontend already enabled")
    files = template_files("frontend")
    for name in data["features"]:
        files |= template_files("feature_frontend", name)
    install_files(root, files)
    data["frontend"] = True
    data["managed"].update({p: digest(root / p) for p in files})
    write_json(root / ".arko/project.json", data)
    refresh_map(root)


def upgrade(root: Path) -> str:
    data = project(root)
    candidate = template_files("base") | runtime_files()
    if data["frontend"]:
        candidate |= template_files("frontend")
    for name in data["features"]:
        candidate |= template_files("feature", name)
        if data["frontend"]:
            candidate |= template_files("feature_frontend", name)
    lines = [f"Proposal only: {data['standard']} -> {VERSION}; no files written."]
    for relative, content in sorted(candidate.items()):
        path = inside(root, relative)
        current = path.read_bytes() if path.exists() else b""
        if current == content:
            continue
        customized = path.exists() and digest(path) != data["managed"].get(relative)
        lines.append(f"{relative}: {'CUSTOMIZED — manual merge' if customized else 'candidate'}")
        lines.extend(
            difflib.unified_diff(
                current.decode().splitlines(),
                content.decode().splitlines(),
                fromfile=f"current/{relative}",
                tofile=f"proposed/{relative}",
                lineterm="",
            )
        )
    return "\n".join(lines)
