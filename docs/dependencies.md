# Dependencies

## Runtime Dependencies

| Package | Purpose |
| --- | --- |
| `express` | HTTP routes and middleware |
| `socket.io` | synchronized client state and AVIF export progress |
| `adm-zip` | ZIP import and export |
| `sharp` | AVIF conversion and image processing |
| `pdf-lib` | PDF assembly for Electron export |

## Desktop and Packaging

| Package | Purpose |
| --- | --- |
| `electron` | desktop runtime |
| `electron-builder` | macOS and Windows packaging |

## Test and Quality Tooling

| Package | Purpose |
| --- | --- |
| `jest` | unit and integration tests |
| `supertest` | API assertions |
| `@playwright/test` | browser E2E coverage |
| `eslint` | JavaScript linting |
| `globals` | ESLint environment globals |

## Other Development Tooling

| Package | Purpose |
| --- | --- |
| `concurrently` | helper for multi-process workflows |

## Supported Font Allowlist

The server validates font names against an allowlist that currently includes:

- Merriweather
- Lora
- Playfair Display
- Cormorant Garamond
- EB Garamond
- Libre Baskerville
- Crimson Pro
- Noto Serif
- PT Serif
- Source Sans 3
- Inter
- Open Sans
- Roboto
- Work Sans
- Noto Sans
- PT Sans
- Montserrat
- Poppins
- Raleway

## Operational Notes

- AVIF export requires `sharp` at runtime.
- PDF export depends on Electron and is not available in plain web mode.
- the repo includes tracked hooks in `.githooks/`
- CI runs version-sync, lint, unit, integration, and E2E coverage
