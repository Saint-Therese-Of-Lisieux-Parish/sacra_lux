# Sacra Lux

Sacra Lux is a Catholic liturgy presentation system for live parish use.
This repository contains the Electron and web application package, the
maintained architecture docs, CI/workflow config, and tracked git hooks.

## Repository Layout

- `sacra-lux/` — application package
- `docs/` — maintained codebase reference
- `homepage/` — brand and marketing copy
- `Pre-Mass Automation/` — standalone Python slide generators
- `.claude/skills/` — repository agent skills
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

- readings import from structured `.txt` files or the USCCB Daily Readings RSS feed
- organizer editing for readings, text, prayers, hymns, images, image slideshows, movies, interstitials, and countdown slides
- volunteer-friendly operator UI with live screen preview and a slide editor
- twelve app UI themes, including liturgical seasons
- pre-mass, gathering, and post-mass automation driven by a Mass start time
- QR and PIN-gated remote start flow with server-side control sessions
- Mass-local asset uploads with live picker refresh
- archive history, duplication, loading, compression, and ZIP import/export
- AVIF export and Electron-only PDF export

## Quality Checks

- `npm run lint`
- `npm run check:version-sync`
- `npm test`
- `npm run test:e2e`

GitHub Actions runs these quality checks on pull requests to and pushes to
`master` (`ci.yml`). The separate `version-check.yml` still targets `main`, so
that one check does not run; treat the version bump as a local obligation.

## Documentation

- package README: [sacra-lux/README.md](./sacra-lux/README.md)
- docs index: [docs/index.md](./docs/index.md)
- operator guide: [docs/user-guide.md](./docs/user-guide.md)
- troubleshooting: [docs/troubleshooting.md](./docs/troubleshooting.md)
- agent guidance: [AGENTS.md](./AGENTS.md)

## Current Version

The current package version is `0.0.27-alpha`.
