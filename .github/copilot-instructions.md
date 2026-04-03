# Sacra Lux Copilot Instructions

Use [AGENTS.md](../AGENTS.md) as the
single canonical source of repository guidance.

## Copilot-Specific Summary

- application code lives in
  [sacra-lux/](../sacra-lux)
- mutate shared runtime state in `src/server.js` only
- use `getStateSnapshot()` for client-visible state
- treat `organizerSequence` and `manualSlides` as persistent truth
- treat `presentation.slides` as derived runtime data
- update docs when routes, settings, IPC, or workflows change

## Common Commands

```bash
npm install
npm run lint
npm run check:version-sync
npm test
npm run test:e2e
npm start
npm run web
```

## Current Public URLs

- `http://localhost:17841/`
- `http://localhost:17841/screen`
- `http://localhost:17841/remote`
- `http://localhost:17841/start`

## Electron Bridge Reminder

The current `window.api` surface is documented in
[AGENTS.md](../AGENTS.md). Do not add
Electron-only APIs without documenting them there.
