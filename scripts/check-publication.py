"""Check Git's candidate files without staging, reading ignored data or printing secrets."""

import re
import subprocess
from pathlib import Path, PurePosixPath

PRIVATE_PARTS = {".git", ".cache", ".local", ".oci", ".aws", ".ssh", ".source", ".codex", ".agents", ".venv", "node_modules", "dist", "__pycache__",
                 ".pytest_cache", ".mypy_cache", ".ruff_cache"}
PRIVATE_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".db", ".sqlite", ".sqlite3", ".log"}
SECRET_PATTERNS = (
    re.compile(r"(?m)^-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----\s*$"),
    re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
    re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
)


def candidate_files(root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=root, check=True, capture_output=True,
    )
    return sorted(set(result.stdout.decode("utf-8").split("\0")) - {""})


def private_path(relative: PurePosixPath) -> bool:
    return (any(part in PRIVATE_PARTS or part.startswith("pytest-cache-files-") for part in relative.parts)
            or relative.suffix.lower() in PRIVATE_SUFFIXES
            or (relative.name.startswith(".env") and relative.name != ".env.example"))


def inspect_file(root: Path, name: str) -> list[str]:
    relative = PurePosixPath(name)
    if private_path(relative):
        return ["private/generated path is publishable"]
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        return ["symlinks or paths outside the repository require explicit review"]
    if not path.is_file():
        return []  # A tracked deletion has no content to publish.
    if path.stat().st_size > 5 * 1024 * 1024:
        return ["file exceeds the source-release size limit"]
    raw = path.read_bytes()
    if relative.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff2"}:
        return []
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return ["source/documentation is not UTF-8"]
    return ["possible secret; review locally" for pattern in SECRET_PATTERNS if pattern.search(text)]


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    files = candidate_files(root)
    problems = [(name, issue) for name in files for issue in inspect_file(root, name)]
    for name, issue in problems:
        print(f"{name}: {issue}")
    print(f"Publication check: {len(files)} candidate files; {len(problems)} problems")
    return int(bool(problems))


if __name__ == "__main__":
    raise SystemExit(main())
