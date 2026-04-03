# AGENTS.md

Authoritative guidance for AI coding agents working in this repository.

## Canonical Guidance

This file is the single maintained source of agent guidance for the
repository.

- [CLAUDE.md](./CLAUDE.md) and [GEMINI.md](./GEMINI.md) are compatibility pointers only
- tool-specific files should defer here instead of duplicating policy

## Working Directory

Run application commands from [sacra-lux/](./sacra-lux).

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

## Primary Architecture Rules

1. Mutate shared runtime state in `src/server.js` only.
2. After a mutation, emit `state:update` and schedule persistence.
3. Treat `organizerSequence` plus `manualSlides` as the persistent source of truth.
4. Treat `presentation.slides` as derived runtime data.
5. Keep screen-setting validation inside `normalizeScreenSettings()`.
6. Rebuild reading slides when layout-affecting reading settings change.
7. Keep the Electron preload bridge narrow and documented.
8. Treat remote display overrides such as interstitial hold as server-owned state, not client-only UI behavior.

## App Model

Sacra Lux has three synchronized clients:

- `/` and `/app` — operator UI
- `/screen` — projector display
- `/remote` — phone remote

The server broadcasts full state snapshots over Socket.IO after changes.

## Key Modules

- `src/server.js`: HTTP and Socket.IO composition root, timers, route wiring, and state mutation
- `src/security.js`: PIN hashing, one-time start tokens, lockouts, and rate limiting
- `src/logger.js`: shared runtime logging
- `src/state.js`: in-memory state and safe client snapshot generation
- `src/organizer.js`: pure organizer normalization and slide generation
- `src/readingsImporter.js`: reading import and pagination
- `src/persistence.js`: session save/load and migration
- `src/massHistory.js`: archive ID allocation, metadata, and archive lifecycle
- `src/main.js`: Electron entry point and native IPC handlers
- `src/web.js`: headless server entry point
- `src/preload.js`: Electron renderer bridge

## Current Electron Bridge

The approved `window.api` surface is:

- `pickFolder()`
- `pickImageFile()`
- `getMonitors()`
- `setTargetMonitor()`
- `setScreenFullscreen()`
- `openMassFolder()`
- `exportPdf()`
- `exportSlidePdf()`
- `isElectron`

## Important Runtime Shapes

Key state fields:

- `presentation`
- `readingsSource`
- `organizerSequence`
- `manualSlides`
- `screenSettings`
- `currentSlideIndex`
- `isBlack`
- `interstitialHoldActive`
- `interstitialHoldSlideIndex`
- `massStartTime`
- `preMassRunning`
- `gatheringRunning`
- `postMassRunning`
- `countdownEndsAt`
- `activeMassArchiveId`

Raw PIN values must never be exposed to clients. Use `getStateSnapshot()`.

## Screen Settings Notes

`screenSettings` is the canonical rendering settings boundary.
Legacy `displaySettings` naming still exists only for backward-compatible
import or restore paths.

Reading-related settings include separate outline controls for:

- reading body text
- scripture reference text
- reading section title

Text, prayer, and hymn settings also include `textSlideShowPageNumber`.

## Current Routes and Events

High-value routes:

- `GET /api/state`
- `POST /api/organizer`
- `POST /api/load-readings`
- `POST /api/screen-settings`
- `POST /api/start-pin`
- `POST /api/verify-pin`
- `POST /api/import-mass-zip`
- `GET /api/export-mass-zip`
- `GET /api/mass-history`

Socket.IO events:

- client to server: `slide:next`, `slide:prev`, `slide:goto`, `slide:goto:remote`, `screen:interstitial-hold`, `screen:black`, `screen:settings`, `export:avif:start`
- server to client: `state:update`, `export:avif:progress`, `export:avif:done`, `export:avif:error`, `interstitial:hold:error`

## Safety Expectations

- preserve upload and asset path sanitization
- preserve safe ZIP-entry filtering
- do not introduce unrestricted filesystem writes
- do not widen request body limits without reason

## Markdown Workflow

Markdown edits may trigger the repo markdownlint hook. Treat hook findings as part of the editing loop.

## Version Policy

For PR work targeting `main`, bump the package version in
[sacra-lux/package.json](./sacra-lux/package.json).
CI enforces version change and version-sync rules.

## Public Repo Posture

Keep agent-facing guidance concise, technical, and architecture-focused.
Do not let multiple assistant-specific files drift into parallel instruction sets.
