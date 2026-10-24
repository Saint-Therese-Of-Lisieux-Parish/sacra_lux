# Dependencies

## Runtime Dependencies

| Package | Version | Purpose |
| --- | --- | --- |
| `express` | ^5.3.0 | HTTP routes and middleware |
| `socket.io` | ^4.8.4 | synchronized client state and AVIF export progress |
| `adm-zip` | ^0.6.1 | ZIP import and export |
| `sharp` | ^0.35.5 | AVIF conversion, image metadata, and slideshow preflight |
| `pdf-lib` | ^1.17.1 | PDF assembly for Electron export |

## Desktop and Packaging

| Package | Version | Purpose |
| --- | --- | --- |
| `electron` | ^44.9.1 | desktop runtime |
| `electron-builder` | ^26.8.1 | macOS and Windows packaging |

## Test and Quality Tooling

| Package | Version | Purpose |
| --- | --- | --- |
| `jest` | ^30.5.2 | unit and integration tests |
| `supertest` | ^7.3.1 | API assertions |
| `@playwright/test` | ^1.64.1 | browser E2E coverage |
| `eslint` | ^10.13.0 | JavaScript linting |
| `globals` | ^17.13.0 | ESLint environment globals |

## Other Development Tooling

| Package | Purpose |
| --- | --- |
| `concurrently` | helper for multi-process workflows |

## Supported Font Allowlist

The server validates font names against `GOOGLE_FONTS` in `src/server.js`,
which currently includes:

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

- Node.js 26 is the supported runtime. `sacra-lux/package.json` declares
  `"engines": { "node": ">=26" }` and the repo ships a root `.nvmrc` (`26`);
  CI (`.github/workflows/ci.yml`, `smoke.yml`) pins `node-version: 26`.
- AVIF export and image-slideshow preflight require `sharp` at runtime.
- PDF export depends on Electron and is not available in plain web mode.
- USCCB Daily Readings import requires outbound network access to
  `https://bible.usccb.org/readings.rss`.
- the repo includes tracked hooks in `.githooks/`, but they are opt-in
  (`git config core.hooksPath .githooks`).
- GitHub Actions runs lint, version sync, unit and integration coverage, E2E,
  and timer tests in `ci.yml` on pull requests to and pushes to `master`.
  The separate `version-check.yml` workflow runs on pull requests to `master`.
  It fails the pull request when the version is not above `master`.
