"""Portable entrypoint; no package installation required for scaffolding/context."""

from arko_lib.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
