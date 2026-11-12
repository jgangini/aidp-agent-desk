# ADR 0001 — explicit HTTP boundary

Date: 2026-11-03. Status: accepted for Arko 0.1. Source: user requirement for
Python, optional React/TypeScript, local reproducibility and Docker distribution.

Choose FastAPI + React/Vite. Start with Python only and attach consumers through
OpenAPI. Use feature folders and explicit composition, not runtime auto-discovery.
Litestar SPA has comparable responsibilities and useful Vite integration. Inertia
adds server-directed navigation and page props/redirect/session semantics; those
are useful for a different requirement, not needed by this backend-first profile.

Tradeoff: two local processes and an explicit contract-generation step. A small
coordinator and executable drift checks make these visible. No claim that this
choice is universally faster for agents. See the installed Arko skill's
`references/research.md` for dated sources.
