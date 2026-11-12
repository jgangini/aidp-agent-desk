# Release readiness

Agent Desk includes Oracle login, role-scoped Agent Flows and TEST access, task scheduling, saved reports and an inline report-template editor.

Version 0.1.4 aligns the bootstrap network with the working Starter Kits recipe: stateful outbound connectivity supports the Oracle public-IP helper and its STUN exchanges. Inbound access remains limited to HTTP/HTTPS; no SSH rule or key is installed. This is an infrastructure correction; application behavior is unchanged. Existing VMs can retain their pinned application image while applying the network correction.

Validation uses scripts/arch-preflight.ps1 and scripts/arch-postflight.ps1. Local functional checks pass. The historical Sentrux regression gate remains failed; its baseline is unchanged. See docs/deployment.md for prerequisites and tenant acceptance.

The recipe targets OCI Resource Manager, public-IP HTTPS and encrypted one-use bootstrap. Its manifest does not register a Deploy Studio catalog entry. Real VM acceptance is tracked separately from unit checks.
