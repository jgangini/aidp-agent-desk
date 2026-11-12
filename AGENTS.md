# Repository map

Read `docs/standard.md` for shared engineering rules and
`docs/profiles/fastapi-react.md` for this implementation. Architecture decisions:
`docs/decisions/0001-profile.md`. Current work and sources: `docs/tasks/current.md`.

Locate a feature: `python tools/arko.py context NAME --root .`.
Feature registry and applied version: `.arko/project.json`. Code is authoritative;
map freshness is checked, but imports and runtime dependencies require judgment.
Expand exploration beyond the returned paths when evidence warrants it.

Baseline/final checks: `python tools/arko.py check --root .` (setup first).
The CLI help lists real operations; these are not native Codex commands.
Update contract exports deliberately. Never accept a baseline to hide a regression.
