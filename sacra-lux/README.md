# Sacra Lux

Sacra Lux is a Catholic Mass presentation app built for live parish
use. It runs from a single shared server-side state model and keeps the
operator app, projector screen, and phone remote synchronized in real time.

## Run Modes

- Electron desktop app: operator window, projector window, optional remote popup
- Web mode: Node server with browser clients

## Core Capabilities

- import readings from parish `.txt` files
- build and edit a Mass organizer with readings, images, interstitials, text, prayers, hymns, and countdown slides
- tune projector typography, background presets, outlines, and reading layout in the Display Settings dialog
- edit slides with live preview in the Slide Editor dialog
- use volunteer-friendly organizer controls, keyboard navigation, and grouped remote controls
- run pre-mass, gathering, and post-mass automation
- hold the display on an interstitial slide from the phone remote and resume the previous slide cleanly
- manage Mass-local assets and background presets
- archive, duplicate, load, compress, import, and export Mass packages
- export AVIF-optimized ZIPs and Electron-only PDFs

## Architecture Summary

`src/server.js` is the sole mutation authority for shared runtime state.
Clients communicate through HTTP and Socket.IO, and the server broadcasts
full client-safe `state:update` snapshots after mutations.

Key modules:

- `src/server.js` — routes, sockets, timers, runtime orchestration
- `src/state.js` — in-memory state and safe snapshot generation
- `src/organizer.js` — organizer normalization and derived slide generation
- `src/readingsImporter.js` — readings import and pagination
- `src/persistence.js` — session save/load and migration
- `src/massHistory.js` — archive lifecycle and metadata
- `src/security.js` — PIN verification, start tokens, lockouts, and rate limits
- `src/main.js` — Electron entry point and native integrations
- `src/preload.js` — narrow Electron renderer bridge

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
npm run test:e2e:install
```

## Default URLs

Port `17841` by default:

- `http://<host>:17841/`
- `http://<host>:17841/app`
- `http://<host>:17841/screen`
- `http://<host>:17841/remote`
- `http://<host>:17841/start`

## Readings Folder Format

Expected files include:

- `Reading_I.txt`
- `Responsorial_Psalm.txt`
- `Reading_II.txt`
- `Verse_Before_the_Gospel.txt`
- `Gospel.txt`
- `mass_title.txt` optional

Alternates like `Gospel-alternate_1.txt` are supported.

Each reading file uses:

1. first non-empty line as the passage reference
2. blank line
3. reading body

`---` on its own line forces a manual page break.

## Runtime Storage

Sacra Lux stores mutable runtime data in `~/.sacra-lux/`:

- `session.json`
- `current_mass/`
- `mass_history/`
- `prayers/`

`current_mass/` is treated as the active self-contained Mass package and is
preferred during restore.

## Electron Notes

- PDF export is available only in Electron.
- Monitor selection, fullscreen control, Mass-folder opening, native file pickers,
  and screen PDF export are exposed through `window.api`.
- The preload bridge is documented in [../AGENTS.md](../AGENTS.md).

## Git Hook

Enable the tracked hook once per clone from the repo root:

```bash
git config core.hooksPath .githooks
```

The hook runs staged-file linting plus version-sync validation.
