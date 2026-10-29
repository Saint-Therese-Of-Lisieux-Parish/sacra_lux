# Sacra Lux

Sacra Lux is a Catholic Mass presentation app built for live parish
use. It runs from a single shared server-side state model and keeps the
Digital Minister app, projector screen, and phone remote synchronized in real time.

## Run Modes

- Electron desktop app: Digital Minister window, projector window, optional remote popup
- Web mode: Node server with browser clients

## Core Capabilities

- import readings from parish `.txt` files or the USCCB Daily Readings RSS feed
- build and edit a Mass organizer with readings, images, image slideshows, movies, interstitials, text, prayers, hymns, and countdown slides
- tune projector typography, background presets, outlines, and reading layout in the Display Settings dialog
- edit slides with live preview in the Slide Editor dialog
- use volunteer-friendly organizer controls, keyboard navigation, and grouped remote controls
- run pre-mass, gathering, and post-mass automation
- show the projector, a slide carousel, and a phase-grouped slide list on the phone remote
- choose from 22 app UI themes, including liturgical seasons
- manage Mass-local assets, background presets, and image-slideshow batches
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
- `src/readingsImporter.js` — readings import, pagination, and pagination cache
- `src/massDocument.js` — `mass.json` version 3 validation and serialization
- `src/lectionaryRss.js` — USCCB Daily Readings RSS import
- `src/persistence.js` — session save/load and migration
- `src/massHistory.js` — archive lifecycle and metadata
- `src/security.js` — PINs, control sessions, start tokens, lockouts, and rate limits
- `src/themes.js` / `src/themes.json` — app UI theme definitions
- `src/main.js` — Electron entry point and native integrations
- `src/preload.js` — narrow Electron renderer bridge

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

## Releases

The `Release` GitHub Actions workflow publishes the release files. Push a tag
that matches the `package.json` version. The current package version is `0.0.311-alpha`.

```bash
git tag v0.0.301-alpha
git push origin v0.0.301-alpha
```

The workflow builds these files:

- `Sacra-Lux-<version>-mac-arm64.zip`
- `Sacra-Lux-<version>-mac-arm64.dmg`
- `Sacra-Lux-<version>-mac-x64.zip`
- `Sacra-Lux-<version>-mac-x64.dmg`
- `Sacra-Lux-<version>-win-x64.zip`
- `Sacra-Lux-<version>-<platform>.spdx.json`
- `Sacra-Lux-<version>-<platform>.cdx.json`
- `Sacra-Lux-<version>-<platform>.grype.json`
- `Sacra-Lux-<version>-<platform>.grype.sarif`
- `SHA256SUMS.txt`

It publishes a GitHub Release with generated release notes. A version with a
hyphen, such as `-alpha`, becomes a prerelease. The macOS ZIP and DMG files
are signed and notarized when the release workflow has the Apple credentials.
Windows ZIP files are not signed.

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

Alternates like `Gospel-alternate_1.txt` are supported. Files named
`description.txt`, `mass_title.txt`, and `passage_filenames.txt` are ignored as
readings.

Each reading file uses:

1. first non-empty line as the passage reference
2. blank line
3. reading body

`---` on its own line forces a manual page break. A line beginning with `R.`
starts a new slide so a psalm refrain gets its own page.

Sections are derived from the file stem, and the parish reading order is the
psalm, then the readings, then the Gospel.

## Runtime Storage

Sacra Lux stores mutable runtime data in `~/.sacra-lux/`:

- `session.json` — persisted session (version 2)
- `current_mass/` — active Mass package (`mass.json`, readings, `assets/`)
- `mass_history/` — archived Mass folders and compressed ZIPs

Prayer texts ship in `prayers/` next to this package. A packaged app reads them from the `prayers` extra resource. They are not stored under `~/.sacra-lux/`.

`current_mass/` is treated as the active self-contained Mass package and is
preferred during restore. Its `mass.json` is a version 3 Mass Document; see
[../docs/mass_document.md](../docs/mass_document.md).

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
