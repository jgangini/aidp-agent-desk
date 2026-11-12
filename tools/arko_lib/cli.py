import argparse
import json
import subprocess
import sys
from pathlib import Path

from . import runtime, scaffold
from .context import context


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Arko 0.1 — repository engineering operations")
    commands = parser.add_subparsers(dest="operation", required=True)
    initial = commands.add_parser("init", help="Create an empty application")
    initial.add_argument("destination", type=Path)
    initial.add_argument("--frontend", action="store_true")
    for name in (
        "add-feature",
        "frontend",
        "context",
        "map",
        "setup",
        "contract",
        "accept-contract",
        "check",
        "dev",
        "docker",
        "upgrade",
    ):
        command = commands.add_parser(name)
        command.add_argument("--root", type=Path, required=True)
        if name in {"add-feature", "context"}:
            command.add_argument("name")
        if name == "accept-contract":
            command.add_argument("--reason", required=True)
        if name == "docker":
            command.add_argument("--tag", default="arko-app:local")
    args = parser.parse_args(argv)
    try:
        if args.operation == "init":
            scaffold.init(args.destination.absolute(), args.frontend)
            return 0
        root = args.root.absolute()
        match args.operation:
            case "add-feature":
                scaffold.add_feature(root, args.name)
            case "frontend":
                scaffold.add_frontend(root)
            case "context":
                print(json.dumps(context(root, args.name), indent=2, ensure_ascii=False))
            case "map":
                scaffold.refresh_map(root)
            case "upgrade":
                print(scaffold.upgrade(root))
            case "setup":
                runtime.setup(root)
            case "contract":
                runtime.contract(root)
            case "accept-contract":
                runtime.accept(root, args.reason)
            case "check":
                runtime.check(root)
            case "dev":
                return runtime.dev(root)
            case "docker":
                runtime.docker(root, args.tag)
        return 0
    except (ValueError, OSError, subprocess.CalledProcessError, SyntaxError) as error:
        print(f"Arko: {error}", file=sys.stderr)
        return 1
