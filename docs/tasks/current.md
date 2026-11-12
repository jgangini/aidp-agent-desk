# Release readiness

Agent Desk includes Oracle login, role-scoped Agent Flows and TEST access, task scheduling, saved reports and an inline report-template editor.

Version 0.1.6 completes public-IP HTTPS bootstrap corrections found on Oracle Linux: the network follows the working Starter Kits recipe, the pinned Certbot image uses its fully qualified registry name, and Caddy selects the IP certificate when a browser sends no SNI. Inbound access remains limited to HTTP/HTTPS; no SSH rule or key is installed. Application behavior is unchanged.

Validation uses scripts/arch-preflight.ps1 and scripts/arch-postflight.ps1. Local functional checks pass. The historical Sentrux regression gate remains failed; its baseline is unchanged. See docs/deployment.md for prerequisites and tenant acceptance.

The recipe targets OCI Resource Manager, public-IP HTTPS and encrypted one-use bootstrap. Its manifest does not register a Deploy Studio catalog entry. Real VM acceptance is tracked separately from unit checks.
