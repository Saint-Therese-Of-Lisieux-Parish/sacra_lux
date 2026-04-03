# Sacra Lux

Sacra Lux is a Catholic liturgy presentation system for live parish use.
This repository contains the Electron and web application package, the
maintained architecture docs, CI/workflow config, and tracked git hooks.

## Repository Layout

- `sacra-lux/` — application package
- `docs/` — maintained codebase reference
- `.github/` — CI and repository automation
- `.githooks/` — tracked local hooks
- `AGENTS.md` — canonical repository guidance for coding agents

## Quick Start

From [sacra-lux/](./sacra-lux):

```bash
npm install
npm run lint
npm test
npm start
```

For browser-only mode:

```bash
cd sacra-lux
npm run web
```

## Product Summary

Sacra Lux keeps three synchronized clients in step during a Mass:

- operator UI at `/` with `/app` as an alias
- projector display at `/screen`
- phone remote at `/remote`

Current capabilities include:

- readings import from structured `.txt` files
- organizer editing for readings, text, prayers, hymns, images, interstitials, and countdown slides
- redesigned operator UI for volunteer-friendly control
- live screen preview and slide editor
- pre-mass, gathering, and post-mass automation
- QR and PIN-gated remote start flow
- Mass-local asset uploads with live picker refresh
- archive history, duplication, loading, compression, and ZIP import/export
- AVIF export and Electron-only PDF export

## Quality Checks

- `npm run lint`
- `npm run check:version-sync`
- `npm test`
- `npm run test:e2e`

GitHub Actions runs the same quality gates on pushes and pull requests to `main`.

## Documentation

- package README: [sacra-lux/README.md](./sacra-lux/README.md)
- docs index: [docs/index.md](./docs/index.md)
- agent guidance: [AGENTS.md](./AGENTS.md)

## Current Version

The current package version is `0.0.1-alpha`.
