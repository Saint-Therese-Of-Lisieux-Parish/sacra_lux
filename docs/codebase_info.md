# Codebase Info

## Project Identity

- name: Sacra Lux
- package: `sacra-lux`
- version: `0.0.178-alpha`
- author: Robert Toups
- license: ISC
- repository: `https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux.git`

## Stack

| Layer | Technology |
| --- | --- |
| desktop runtime | Electron 44 |
| packaging | electron-builder 26 (macOS DMG, Windows NSIS) |
| server | Node.js 26, Express 5, Socket.IO 4 |
| frontend | vanilla HTML, CSS, and JavaScript |
| ZIP and image processing | adm-zip, sharp |
| PDF export | Electron offscreen capture plus pdf-lib |
| tests | Jest 30, supertest, Playwright 1.64 |
| linting | ESLint 10 |

## Repository Layout

```text
repo-root/
├── sacra-lux/
│   ├── public/            # app.html, screen.html, remote.html, start.html, client/, assets/, fonts/, vendor/
│   ├── src/               # server, domain modules, Electron entry points
│   ├── tests/             # unit/, integration/, e2e/, helpers/
│   ├── scripts/           # check-version-sync.js, precommit.js
│   ├── jest.config.cjs
│   ├── playwright.config.js
│   ├── package.json
│   └── README.md
├── docs/                  # maintained codebase reference
├── homepage/              # brand and marketing copy (not a technical source)
├── Pre-Mass Automation/   # standalone Python slide generators (separate tooling)
├── .claude/skills/        # repository agent skills
├── .github/               # CI workflows and Copilot instructions
├── .githooks/             # tracked local pre-commit hook
├── README.md
├── AGENTS.md
├── CLAUDE.md
└── GEMINI.md
```

## Runtime Storage

Sacra Lux writes runtime data under `~/.sacra-lux/`:

| Path | Purpose |
| --- | --- |
| `session.json` | persisted session snapshot (version 2) |
| `session.json.bak` | prior session snapshot for recovery after damage |
| `current_mass/` | active Mass package: readings `.txt`, `mass.json`, and `assets/` |
| `mass_history/<id>/` | archived Mass package, `metadata.json`, and optional `archive-avif.zip` |
| `prayers/` | prayer text storage |

`current_mass/` is a self-contained package and is preferred over
`session.json` during restore. Tests redirect `HOME` to a temp directory so
they never touch this path.

## Build Targets

`npm run build` uses the targets in `sacra-lux/package.json`:

- macOS DMG, arm64 and x64
- Windows NSIS installer, x64 and arm64

The Release workflow publishes ZIP files and macOS DMG files. It does not
publish the Windows NSIS installer. See the root [README](../README.md).

Build output defaults to `~/Documents/sacra-lux-dist/`. The packaged app
unpacks `public/` (`asarUnpack`) so Express can stream the pages, and ships
`prayers/` as an extra resource.

## Default URLs

Sacra Lux serves these by default on port `17841`:

- `/`
- `/app`
- `/screen`
- `/remote`
- `/start`

`/` is the primary operator entry point. `/app` remains as an alias.
