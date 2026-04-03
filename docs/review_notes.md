# Review Notes

## Review Status

The Markdown set was reviewed against the current codebase on
`2026-04-03` and refreshed to align with:

- the redesigned operator UI, Display Settings dialog, and Slide Editor
- current route set, including `/app` as an operator alias
- current Socket.IO event names, including remote interstitial hold
- current state snapshot fields, including interstitial-hold state
- current remote behavior and timer-resume semantics
- current archive, asset, AVIF, and PDF export flows

## Major Corrections in This Pass

- removed stale `/app` versus `/` inconsistencies
- corrected package-level agent guidance that incorrectly treated `/app` as the only operator route
- documented the remote interstitial-hold behavior
- documented `textSlideShowPageNumber` and the current reading outline split
- aligned the docs with the current preload bridge and route list

## Remaining Gaps

### `src/server.js` is still large

The docs describe the boundaries accurately, but the main runtime
composition file still carries many concerns.

### Frontend internals are summarized, not exhaustively mapped

The docs describe current UI responsibilities and flows, but not every
section inside `public/app.html`, `public/screen.html`, and `public/remote.html`.

### Packaging and operational docs remain light

The current docs describe build targets and runtime storage, but not a
full release checklist or deployment playbook.
