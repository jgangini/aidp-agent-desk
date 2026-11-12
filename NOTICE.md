The MIT license at the repository root applies to original project code.
Third-party code, fonts, icons and trademarks retain their own terms.

- Bundled transitions.dev runtime: `frontend/src/shared/vendor/transitions/LICENSE.txt`
  and `provenance.json`; additional provenance in `docs/licenses/`.
- assistant-ui reference adaptations, voice-glow and Markdown libraries:
  notices in `docs/licenses/`.
- Oracle AIDP and Yahoo Finance SVG assets: source and rights in
  `frontend/public/icons/**/icons-manifest.json` and adjacent license folders.
  Product and service marks identify their respective providers; this project
  does not claim ownership or endorsement.
- Other dependencies are resolved by `uv.lock` and
  `frontend/package-lock.json`; their distributed license files remain applicable.
- A2UI React and Web Core 0.15.0 (Apache-2.0) use their supported v0.9 wire protocol
  with a local Desk catalog; license in `docs/licenses/a2ui-Apache-2.0.txt`.
  The catalog projection is original Desk code; no upstream source was copied.

- Oracle login uses Authlib and joserfc under BSD-3-Clause; their package license files remain applicable.

- The deployment credential envelope follows the MIT-licensed Starter Kits pattern (jgangini, 2026), revision dd032cea1ddecdc46fe4d9c54f05c33d4ecc520b. Desk uses its own versioned payload; see docs/deployment.md.

- Public-IP TLS orchestration adapts the same MIT-licensed Starter Kits revision: [source](https://github.com/jgangini/oci-ai-data-platform-workbench-starter-kits/blob/dd032cea1ddecdc46fe4d9c54f05c33d4ecc520b/scripts/deployment/ensure_public_ip_tls.sh). Original copyright and MIT terms remain applicable.
