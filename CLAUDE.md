# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Canonical agent guidance lives in [AGENTS.md](./AGENTS.md). The content below mirrors it for Claude Code compatibility.

## Working Directory

Run all application commands from [sacra-lux/](./sacra-lux).

## Commands

```bash
npm install
npm start
npm run web
npm run build
npm run build:win
npm run lint
npm run check:version-sync
npm test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:e2e:headed
```

## App Model

Sacra Lux has three synchronized clients served by one Node/Express + Socket.IO server:

- `/` and `/app` — operator UI
- `/screen` — projector display
- `/remote` — phone remote

The server broadcasts full state snapshots over Socket.IO after every change. It can run as an Electron desktop app (`src/main.js`) or a headless web server (`src/web.js`).

## Primary Architecture Rules

1. Mutate shared runtime state in `src/server.js` only.
2. After a mutation, emit `state:update` and schedule persistence.
3. Treat `organizerSequence` plus `manualSlides` as the persistent source of truth.
4. Treat `presentation.slides` as derived runtime data.
5. Keep screen-setting validation inside `normalizeScreenSettings()`.
6. Rebuild reading slides when layout-affecting reading settings change.
7. Keep the Electron preload bridge narrow and documented.
8. Treat remote display overrides (e.g. interstitial hold) as server-owned state, not client-only UI behavior.

## Key Modules

- `src/server.js` — HTTP and Socket.IO composition root, timers, route wiring, and state mutation
- `src/security.js` — PIN hashing, one-time start tokens, lockouts, rate limiting
- `src/logger.js` — shared runtime logging
- `src/state.js` — in-memory state and safe client snapshot generation
- `src/organizer.js` — pure organizer normalization and slide generation
- `src/readingsImporter.js` — reading import and pagination
- `src/persistence.js` — session save/load and migration
- `src/massHistory.js` — archive ID allocation, metadata, and archive lifecycle
- `src/main.js` — Electron entry point and native IPC handlers
- `src/web.js` — headless server entry point
- `src/preload.js` — Electron renderer bridge

## Important Runtime State Fields

- `presentation`, `readingsSource`, `organizerSequence`, `manualSlides`
- `screenSettings`, `currentSlideIndex`, `isBlack`
- `interstitialHoldActive`, `interstitialHoldSlideIndex`
- `massStartTime`, `preMassRunning`, `gatheringRunning`, `postMassRunning`, `countdownEndsAt`
- `activeMassArchiveId`

Raw PIN values must never be exposed to clients. Use `getStateSnapshot()`.

## Screen Settings

`screenSettings` is the canonical rendering-settings boundary. Legacy `displaySettings` naming exists only for backward-compatible import/restore paths. Reading settings include separate outline controls for body text, scripture reference, and section title. Text/prayer/hymn settings include `textSlideShowPageNumber`.

## Routes and Socket Events

Key REST routes: `GET /api/state`, `POST /api/organizer`, `POST /api/load-readings`, `POST /api/screen-settings`, `POST /api/start-pin`, `POST /api/verify-pin`, `POST /api/import-mass-zip`, `GET /api/export-mass-zip`, `GET /api/mass-history`.

Socket.IO (client→server): `slide:next`, `slide:prev`, `slide:goto`, `slide:goto:remote`, `screen:interstitial-hold`, `screen:black`, `screen:settings`, `export:avif:start`.

Socket.IO (server→client): `state:update`, `export:avif:progress`, `export:avif:done`, `export:avif:error`, `interstitial:hold:error`.

## Electron Bridge (`window.api`)

`pickFolder`, `pickImageFile`, `getMonitors`, `setTargetMonitor`, `setScreenFullscreen`, `openMassFolder`, `exportPdf`, `exportSlidePdf`, `isElectron`.

## Safety Expectations

- Preserve upload and asset path sanitization.
- Preserve safe ZIP-entry filtering.
- Do not introduce unrestricted filesystem writes.
- Do not widen request body limits without reason.

## Version Policy

For PR work targeting `main`, bump the package version in `sacra-lux/package.json`. CI enforces version change and version-sync rules.

## Markdown Workflow

Markdown edits may trigger the repo markdownlint hook. Treat hook findings as part of the editing loop.
