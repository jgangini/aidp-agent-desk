# Common standard 0.1.0

Source: Arko specification 2026-11-03. Status: applied; review when upgrading.

Each feature owns its transport, business behavior, data contracts and tests.
Keep dependencies explicit in `.arko/project.json`; shared code cannot depend on
features. Composition roots assemble features. Cross-feature access uses declared
public contracts, never another feature's internals. The selected profile gives
these rules concrete paths and executable checks.

AGENTS.md is a map. ADRs contain decisions and alternatives; task notes contain
source, status, last verification and next action. Do not duplicate manuals.
Current source and tests override stale notes. Record uncertainty and inspect
callers/consumers rather than stopping at the first search result.

Verify behavior, types, architecture and contract compatibility. A passing static
check is not evidence of authorization correctness or complete runtime discovery.
No fixed retrieval size. Use existing search/design tools when useful; Arko adds
neither a vector database nor a second memory system.

Updates are proposals: `upgrade` emits diffs and identifies customized files by
their initial hashes. Merge manually, rerun checks, record the reviewed version.
Only 0.1.0 is implemented; cross-version migrations remain future work.
