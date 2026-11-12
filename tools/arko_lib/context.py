import ast
from pathlib import Path

from .io import digest, inside, project
from .scaffold import feature_files


def _import_functions(tree: ast.AST) -> set[str]:
    names = {"__import__"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "importlib":
            names.update(alias.asname or alias.name for alias in node.names if alias.name == "import_module")
    return names


def _dynamic_import(node: ast.Call, names: set[str]) -> bool:
    if isinstance(node.func, ast.Name):
        return node.func.id in names
    return isinstance(node.func, ast.Attribute) and node.func.attr == "import_module"


def python_imports(path: Path, root: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    package = list(path.relative_to(root / "backend").with_suffix("").parts[:-1])
    result = []
    import_functions = _import_functions(tree)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            result.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            prefix = package[: len(package) - node.level + 1] if node.level else []
            module = ".".join([*prefix, *([node.module] if node.module else [])])
            result.extend(f"{module}.{alias.name}" for alias in node.names)
        elif isinstance(node, ast.Call) and _dynamic_import(node, import_functions):
            raise ValueError(f"Dynamic Python import needs explicit analysis: {path}")
    return sorted(set(result))


def _map_errors(root: Path, features: dict) -> list[str]:
    errors = []
    for name, entry in features.items():
        actual, declared = set(feature_files(root, name)), set(entry["files"])
        errors.extend(f"{name}: stale/unregistered path {p}" for p in sorted(actual ^ declared))
        for p in declared:
            inside(root, p)
        for dep in entry["depends_on"]:
            if dep not in features or dep == name:
                errors.append(f"{name}: invalid dependency {dep}")
    for tree in ("backend/app/features", "frontend/src/features"):
        for folder in inside(root, tree).glob("*"):
            if folder.is_dir() and folder.name != "__pycache__" and folder.name not in features:
                errors.append(f"Unregistered feature: {folder.name}")
    return errors


def _feature_import_allowed(owner: str, tokens: list[str], features: dict) -> bool:
    if tokens[2] == owner:
        return True
    return tokens[2] in features[owner]["depends_on"] and len(tokens) >= 4 and tokens[3] == "schemas"


def _import_errors(path: Path, root: Path, features: dict) -> list[str]:
    errors = []
    relative = path.relative_to(root).as_posix()
    parts = path.relative_to(root / "backend/app").parts
    owner = parts[1] if len(parts) > 2 and parts[0] == "features" else None
    for target in python_imports(path, root):
        if parts[0] == "core" and target.startswith("app.features"):
            errors.append(f"{relative}: core cannot import features ({target})")
        if path.stem in {"service", "schemas"} and (
            target.startswith(("fastapi", "starlette")) or ".api" in target.split("app")[-1]
        ):
            errors.append(f"{relative}: domain/schema cannot import transport ({target})")
        if path.stem == "schemas" and ".service" in target:
            errors.append(f"{relative}: schema cannot import service ({target})")
        if owner and target.startswith("app.features."):
            tokens = target.split(".")
            if not _feature_import_allowed(owner, tokens, features):
                errors.append(f"{relative}: forbidden feature dependency {target}")
    return errors


def audit(root: Path) -> list[str]:
    features = project(root)["features"]
    errors = _map_errors(root, features)
    for path in (root / "backend/app").rglob("*.py"):
        errors.extend(_import_errors(path, root, features))
    return errors


def _related_features(features: dict, name: str) -> set[str]:
    if name not in features:
        raise ValueError(f"Unknown feature: {name}")
    selected = {name}
    while True:
        expanded = selected | {dep for f in selected for dep in features[f]["depends_on"]}
        expanded |= {f for f, entry in features.items() if set(entry["depends_on"]) & selected}
        if expanded == selected:
            return selected
        if expanded - features.keys():
            raise ValueError("Map contains unknown dependencies")
        selected = expanded


def _context_files(root: Path, selected: set[str], frontend: bool) -> set[str]:
    files = {p for f in selected for p in feature_files(root, f)}
    for shared in ("backend/app/core", "backend/tests", "frontend/src/shared", "contracts", "docs"):
        files.update(
            p.relative_to(root).as_posix()
            for p in (root / shared).rglob("*")
            if p.is_file() and "__pycache__" not in p.parts
        )
    files |= {"backend/app/main.py", "AGENTS.md", ".arko/project.json"}
    if frontend:
        files.add("frontend/src/App.tsx")
    return files


def _file_record(root: Path, relative: str) -> dict | None:
    path = inside(root, relative)
    if not path.exists():
        return None
    record = {"path": relative, "sha256": digest(path)}
    if path.suffix == ".py":
        record["imports"] = python_imports(path, root)
        record["symbols"] = [
            {"name": n.name, "line": n.lineno}
            for n in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        ]
    return record


def context(root: Path, name: str) -> dict:
    data = project(root)
    selected = _related_features(data["features"], name)
    files = _context_files(root, selected, data["frontend"])
    records = [_file_record(root, relative) for relative in sorted(files)]
    return {
        "feature": name,
        "related_features": sorted(selected),
        "files": [record for record in records if record is not None],
        "problems": audit(root),
        "task": (root / "docs/tasks/current.md").read_text(encoding="utf-8"),
        "limits": "Declared dependency closure + Python AST; no runtime proof. TS AST checked by check. "
        "Inspect external consumers, dependency injection, config and undeclared calls; expand as needed.",
    }
