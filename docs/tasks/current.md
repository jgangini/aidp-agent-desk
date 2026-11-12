# Release readiness

Agent Desk 0.1.0 includes Oracle login, role-scoped Agent Flows and TEST access, task scheduling, saved reports and an inline report-template editor.

Validation uses scripts/arch-preflight.ps1 and scripts/arch-postflight.ps1. Local functional checks pass. The historical Sentrux regression gate is not passed; its baseline remains unchanged. See docs/deployment.md for deployment prerequisites and tenant acceptance.

The Deploy Studio recipe targets OCI Resource Manager with public-IP HTTPS and encrypted one-use bootstrap. A manifest does not register this project in a Deploy Studio catalog. Actual VM acceptance is tracked separately from unit checks.
