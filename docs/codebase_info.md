# Codebase Info

## Project Identity

- name: Sacra Lux
- package: `sacra-lux`
- version: `0.0.1-alpha`
- author: Robert Toups
- license: ISC
- repository: `https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux.git`

## Stack

| Layer | Technology |
| --- | --- |
| desktop runtime | Electron 41 |
| server | Node.js, Express 5, Socket.IO 4 |
| frontend | vanilla HTML, CSS, and JavaScript |
| ZIP and image processing | adm-zip, sharp |
| PDF export | Electron offscreen capture plus pdf-lib |
| tests | Jest, supertest, Playwright |
| linting | ESLint 9 |

## Repository Layout

```text
repo-root/
├── sacra-lux/
│   ├── public/
│   ├── src/
│   ├── tests/
│   ├── scripts/
│   ├── package.json
│   └── README.md
├── docs/
├── .github/
├── .githooks/
├── README.md
├── AGENTS.md
├── CLAUDE.md
└── GEMINI.md
```

## Runtime Storage

Sacra Lux writes runtime data under `~/.sacra-lux/`:

| Path | Purpose |
| --- | --- |
| `session.json` | persisted session snapshot |
| `current_mass/` | active Mass package, assets, and `mass.json` |
| `mass_history/` | archived Mass folders and compressed ZIPs |
| `prayers/` | prayer text storage |

## Build Targets

- macOS DMG
- Windows NSIS installer

Build output defaults to `~/Documents/sacra-lux-dist/`.

## Default URLs

Sacra Lux serves these by default on port `17841`:

- `/`
- `/app`
- `/screen`
- `/remote`
- `/start`

`/` is the primary operator entry point. `/app` remains as an alias.
