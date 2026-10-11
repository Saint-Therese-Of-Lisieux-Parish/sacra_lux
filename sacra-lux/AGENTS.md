# AGENTS.md

Package-level guidance for work inside
[sacra-lux/](./). For repository-wide policy, see
[../AGENTS.md](../AGENTS.md).

## Project Context

Sacra Lux is a Catholic Mass presentation app with three synchronized clients:

- `/` and `/app` — operator UI
- `/screen` — projector output
- `/remote` — phone control

`src/server.js` is the sole mutation authority for shared runtime state.

## Commands

```bash
npm install
npm start
npm run web
npm run build
npm run build:win
npm run build:all
npm run lint
npm run check:version-sync
npm run precommit
npm test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:install
```

## Important Invariants

1. Mutate shared state in `src/server.js` only.
2. Emit `state:update` and schedule persistence after mutations.
3. Keep `organizerSequence` plus `manualSlides` as the persistent source of truth.
4. Keep `presentation.slides` derived.
5. Normalize and clamp `screenSettings` on the server.
6. Repaginate reading slides when layout-affecting reading settings change.
7. Keep interstitial hold, blackout, and timer-resume behavior in server-owned state.
8. Keep control-session authorization in `src/security.js`, never in a client.

## Notable Current Areas

- `src/security.js` — PINs, control sessions, lockouts, and rate limiting
- `src/massDocument.js` — `mass.json` version 3 validation and serialization
- `src/lectionaryRss.js` — USCCB Daily Readings import
- `src/themes.js` / `src/themes.json` — app UI theme definitions
- `src/logger.js` — runtime logging policy
- `src/massHistory.js` — archive lifecycle
- `src/preload.js` — Electron-only bridge
- `public/app.html` — operator UI, organizer, dialogs, and settings
- `public/screen.html` — projector renderer and idle QR overlay
- `public/remote.html` — grouped remote controls and interstitial hold
- `public/client/shared.js` — shared browser helpers

## Current Screen Settings Notes

Reading outline controls are split into:

- reading body outline
- scripture reference outline
- reading section title outline

That split must stay aligned across defaults, normalization, operator UI,
and renderer behavior.
