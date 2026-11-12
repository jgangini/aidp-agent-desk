# Release readiness

Agent Desk 0.1.2 includes Oracle login, role-scoped Agent Flows and TEST access, task scheduling, saved reports and an inline report-template editor.

Validation uses scripts/arch-preflight.ps1 and scripts/arch-postflight.ps1. Local functional checks pass. The historical Sentrux regression gate is not passed; its baseline remains unchanged. See docs/deployment.md for deployment prerequisites and tenant acceptance.

The Deploy Studio recipe targets OCI Resource Manager with public-IP HTTPS and encrypted one-use bootstrap. A manifest does not register this project in a Deploy Studio catalog. Actual VM acceptance is tracked separately from unit checks.

The first OCI PLAN exposed an overly restrictive Oracle domain-origin validation. Version 0.1.1 accepts the default HTTPS port 443 when returned by Oracle and rejects alternate ports.

Version 0.1.2 compresses cloud-init below the OCI metadata limit and enforces the size during PLAN. Version 0.1.1 remains unpublished; use the corrected release.

Version 0.1.3 corrects the bootstrap network: oci-public-ip uses a UDP 3478 STUN fallback when the VM cannot read VNICs. This is an infrastructure correction; application behavior is unchanged. Existing installations can retain their pinned runtime image when applying this network-only correction.
