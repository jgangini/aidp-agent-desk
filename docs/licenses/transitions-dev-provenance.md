# Transitions.dev adaptations

Recipes are used inside Agent Desk under [the project license notice](transitions-dev.txt), not redistributed as a library. Existing GSAP and CSS own lifecycle, reduced motion and cleanup.

## Credential file landing

- Source: https://transitions.dev/detail.html?t=drag-drop-with-physics
- Authorized official CLI: transitions-dev@0.3.0, authenticated add `drag-drop-physics` on 2026-11-03.
- Source staging: `.cache/transitions-source/drag-drop-physics/drag-drop-physics/` (CSS, React and TypeScript Markdown).
- CSS SHA256: `4C0BE279A80DCC97E34467C5C78DFA17F748E7639D69FC93D9D5E1E54225DA07`.
- React SHA256: `D662DFAB1CF784EEDA0123DE954CA30DCF2C38B691CE6FC50BE9EED327D476B7`.
- Adaptation: squash .97/250ms, return450ms and content crossfade/blur400ms. Native OS file drops and the accessible file input replace the reference image chip/pointer simulation. No credential previews, automatic removal or smoke effect. This is a scoped adaptation, not a pixel-identical reproduction of the full demo.

## View and form feedback

- Panel reveal: local `transitions-dev/07-panel-reveal.md`, adapted to React exit/enter phases and existing motion tokens. Outgoing150ms precedes layout change; destination400ms,8px travel and2px blur. Branding/chat stay outside the effect. Reduced motion switches directly.
- Error state shake: local `transitions-dev/12-error-state-shake.md`, adapted to invalid fields and native file-drop validation. Errors persist until correction, shake replays on retry and is disabled by reduced motion. No new motion runtime.

- Result card resize (2026-11-09): local `transitions-dev/01-card-resize.md`, adapted to the existing GSAP lifecycle for measured card heights and board positions. Uses 300 ms with smooth outgoing easing; reduced motion skips the tween, and cleanup restores natural layout. No additional motion dependency.
