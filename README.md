# Sacra Lux

[![CI](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/actions/workflows/codeql.yml/badge.svg?branch=master)](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/actions/workflows/codeql.yml)
[![Smoke](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/actions/workflows/smoke.yml/badge.svg?branch=master)](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/actions/workflows/smoke.yml)
[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FSaint-Therese-Of-Lisieux-Parish%2Fsacra_lux%2Fbadges%2Fcoverage.json)](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/Saint-Therese-Of-Lisieux-Parish/sacra_lux?filename=sacra-lux%2Fpackage.json&label=version)](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/blob/master/sacra-lux/package.json)

Sacra Lux helps a parish run the slides for Mass. One person runs the
operator screen. The projector shows the same slide. A phone can follow
along and move the slides. When the operator changes a slide, the projector
and the phone change with it.

Read the published documentation at
<https://saint-therese-of-lisieux-parish.github.io/sacra_lux/>.

## Who this is for

Sacra Lux is a live Mass presentation app for parish operators and the
people who help them. This repository holds the application, the reference
documents, the GitHub workflows, and the tracked Git hooks.

Two run modes are supported:

- **Electron.** `npm start` opens the desktop app. It shows an operator
  window and a projector window. A remote window is optional.
- **Web.** `npm run web` starts the Node.js server. People open the pages
  in a browser.

The desktop entry point is [sacra-lux/src/main.js](./sacra-lux/src/main.js).
The web entry point is [sacra-lux/src/web.js](./sacra-lux/src/web.js).
Day-to-day use is in the [user guide](./docs/user-guide.md). The guides are also published at <https://saint-therese-of-lisieux-parish.github.io/sacra_lux/>.

## What you need

Install Node.js 26 or newer. The [engines](./sacra-lux/package.json) field
requires `>=26`, and [.nvmrc](./.nvmrc) pins `26`. You also need npm, which
ships with Node.js.

Electron mode needs a desktop that can run Electron. Web mode needs a
browser on each device that will show a page.

## Set up a new copy

Clone the repository. Then run the commands from the `sacra-lux` directory:

```bash
cd sacra-lux
npm install
npm start
```

`npm install` installs the dependencies from `package-lock.json`.
`npm start` opens the Electron app.

For browser-only mode, stay in `sacra-lux` and run:

```bash
npm run web
```

The server listens on `0.0.0.0`. The log prints the operator, remote, and
screen URLs.

## Commands

Run every command in this table from [sacra-lux/](./sacra-lux), except the
release tag commands. Those run from the repository root.

| Command | Result |
| --- | --- |
| `npm install` | Installs dependencies from `package-lock.json`. |
| `npm start` | Starts the Electron app (`electron ./src/main.js`). |
| `npm run web` | Starts the web server (`node ./src/web.js`). |
| `npm run lint` | Runs JavaScript, HTML, and CSS lint. Exits 0 when all three pass. |
| `npm run lint:js` | Runs ESLint on `src`, `tests`, `scripts`, `public`, and `eslint.config.js`. |
| `npm run lint:html` | Runs HTMLHint on `public/*.html`. |
| `npm run lint:css` | Runs Stylelint on `public/*.css` and `public/*.html`. |
| `npm run check:version-sync` | Checks that `package.json`, `package-lock.json`, this README, and `docs/codebase_info.md` show the same version. |
| `npm run precommit` | Lints staged JavaScript. Also runs the version sync check when a version file is staged. |
| `npm test` | Runs unit tests, then integration tests. |
| `npm run test:unit` | Runs Jest on `tests/unit`. |
| `npm run test:integration` | Runs Jest on `tests/integration`. |
| `npm run test:coverage` | Runs unit and integration tests with coverage. |
| `npm run test:mutation` | Runs StrykerJS mutation tests on `src/security.js`. The run fails below a score of 76. |
| `npm run test:e2e` | Runs Playwright. Install the browsers first. |
| `npm run test:e2e:headed` | Runs Playwright with a visible browser. |
| `npm run test:e2e:install` | Installs Playwright Chromium and WebKit, plus system dependencies. |
| `npm run build` | Builds the macOS and Windows installers with electron-builder. |
| `npm run build:win` | Builds the Windows installer only. |
| `npm run build:all` | Same as `npm run build`. |
| `npm run build:default-background` | Writes `public/assets/default-text-background.avif` from the local source PNG. The command fails when that PNG is missing. |

Local installer output goes to `~/Documents/sacra-lux-dist`. The macOS
config in `package.json` asks electron-builder to code-sign and notarize.
The Windows config builds an NSIS installer for x64 and arm64. That local
Windows build has no signing step.

The source PNG for the default background is
`Sacra Lux Default Background HD.png` at the repository root. That file is
local only. It is not in Git.

Release commands run from the repository root. See [Releases](#releases).

## Pages and the port

The default port is `17841`.

| Page | URL | Who uses it |
| --- | --- | --- |
| Operator | `http://<host>:17841/` | The person running the Mass. `/app` is the same page. |
| Projector | `http://<host>:17841/screen` | The screen the assembly sees. |
| Phone remote | `http://<host>:17841/remote` | A phone on the same network. |
| Start | `http://<host>:17841/start` | The page that unlocks control. |

When a start PIN is set, `/start` shows the PIN page. When no PIN is set,
`/start` redirects to `/api/start-redirect`.

The port changes in these cases:

- Web mode reads the port in `sacra-lux/src/web.js` as
  `Number(process.env.PORT || 17841)`. An unset `PORT` uses `17841`.
- Electron uses `SACRA_LUX_PORT` when that value is a positive integer.
  Any other value falls back to `17841`.
- If that port is already in use, Electron shows "Sacra Lux could not start"
  and the message `Port <port> is already in use.` It then quits. It does
  not choose another port.
- Web mode writes `Port <port> is already in use. Stop the other process or set PORT to a free port.` and exits.
- A second launch does not start another server. Electron focuses the open
  window and the new process quits.

The server binds to `0.0.0.0`, so another device can open the remote URL.
Use the host printed in the server log.

### Allowed hosts and origins

The server rejects a request when its `Host` header is not allowed (HTTP 403).
It also rejects a state-changing request, or a Socket.IO connection, when its
`Origin` header is not allowed. A request with no `Origin` header is accepted.
A state-changing request with `Sec-Fetch-Site: cross-site` gets HTTP 403 and
the error `Cross-site request not allowed.`
This stops a web page in the operator browser, and DNS rebinding, from using
the server.

These hosts are always allowed: `localhost`, loopback addresses, and the
addresses of this computer. To allow other devices, set
`SACRA_LUX_ALLOWED_NETWORKS` to a comma-separated list before you start the
app. Each entry is an IPv4 network in CIDR form, a single IPv4 address, or a
host name:

```bash
SACRA_LUX_ALLOWED_NETWORKS="192.168.1.0/24,10.12.0.0/21,sacra.local" npm start
```

The server logs a warning and ignores an entry that is not valid. To add a
host name, add it to the same list.

## Repository layout

| Path | Role |
| --- | --- |
| [sacra-lux/](./sacra-lux) | The application package. |
| [sacra-lux/package.json](./sacra-lux/package.json) | Scripts, the Node.js engine range, and the package version. |
| [sacra-lux/src/server.js](./sacra-lux/src/server.js) | HTTP routes, Socket.IO, timers, and runtime state changes. |
| [sacra-lux/src/state.js](./sacra-lux/src/state.js) | In-memory state and the client snapshot. |
| [sacra-lux/src/persistence.js](./sacra-lux/src/persistence.js) | Session save and load. The session file is version 2. |
| [sacra-lux/src/massHistory.js](./sacra-lux/src/massHistory.js) | Archive ids, metadata, and archive files. |
| [sacra-lux/src/massDocument.js](./sacra-lux/src/massDocument.js) | The version 3 `mass.json` document. |
| [sacra-lux/src/readingsImporter.js](./sacra-lux/src/readingsImporter.js) | Reading file names, order, and pagination. |
| [sacra-lux/src/lectionaryRss.js](./sacra-lux/src/lectionaryRss.js) | USCCB Daily Readings RSS import. |
| [sacra-lux/src/themes.json](./sacra-lux/src/themes.json) | App UI themes. There are 22 themes, including liturgical seasons. |
| [.github/workflows/](./.github/workflows) | CI, docs checks, secret scan, smoke, CodeQL, security triage, Scorecard, version check, and release. |
| [.githooks/](./.githooks) | The tracked pre-commit hook. |
| [docs/](./docs) | The maintained guides. Start at [docs/index.md](./docs/index.md). |
| [AGENTS.md](./AGENTS.md) | Guidance for coding agents. |
| [CLAUDE.md](./CLAUDE.md) and [GEMINI.md](./GEMINI.md) | Pointers to `AGENTS.md`. |

## Readings, the active Mass, and archives

A readings folder is a set of `.txt` files. The file name selects the
section. These names are recognized:

- `Responsorial_Psalm.txt`
- `Reading_I.txt` and `Reading_1.txt` (both mean Reading I)
- `Reading_II.txt` and `Reading_2.txt` (both mean Reading II)
- `Reading_III.txt` through `Reading_VII.txt`
- `Epistle.txt`
- `Verse_Before_the_Gospel.txt`
- `Gospel.txt`

A longer name that starts with one of those stems is the same section plus
a suffix. `Gospel-alternate_1.txt` is an alternate Gospel.
`description.txt`, `mass_title.txt`, and `passage_filenames.txt` are not
readings. `mass_title.txt` can still supply the Mass title.

Import order is the psalm, then Readings I–VII, then the Epistle, then the
verse before the Gospel, then the Gospel.

Each reading file starts with the passage reference, then a blank line, then
the body. A line that is only `---` starts a new page. A line that starts
with `R.` starts a new slide, so a psalm refrain can stand alone. A line
that is only `or:` marks another refrain choice. That line is not a slide.

The full folder rules are in the
[user guide](./docs/user-guide.md#readings-folder-format).

Runtime files live under `~/.sacra-lux/` (`HOME`, or the home directory when
`HOME` is unset):

| Path | Contents |
| --- | --- |
| `session.json` | Saved session, version 2. |
| `session.json.bak` | The previous session file, kept on each save. |
| `current_mass/` | The active Mass: `mass.json`, reading `.txt` files, and `assets/`. |
| `mass_history/<id>/` | One archive: `metadata.json`, `package/`, and `archive-avif.zip` after compression. |

`current_mass/mass.json` is a version 3 Mass document. The schema is in
[docs/mass_document.md](./docs/mass_document.md). On startup the server
prefers a valid `current_mass` package. A failed replacement does not
replace the live Mass. The server writes a side directory and renames it
into place only after the package is complete.

Prayer texts ship in [sacra-lux/prayers/](./sacra-lux/prayers). A packaged
app reads them from the `prayers` extra resource. They are not stored under
`~/.sacra-lux/`.

Supported import and export paths:

| Action | Path |
| --- | --- |
| New Mass from the USCCB feed | The new-Mass flow reads the Daily Readings RSS feed at [bible.usccb.org/readings.rss](https://bible.usccb.org/readings.rss). |
| Import a Mass ZIP | `POST /api/import-mass-zip`. The ZIP layout is in [docs/zip-import.md](./docs/zip-import.md). |
| Import settings JSON | `POST /api/import-settings`. |
| Export settings JSON | `GET /api/export-settings`. |
| Export the Mass ZIP | `GET /api/export-mass-zip`. |
| Export an AVIF ZIP | `GET /api/export-mass-zip-avif`. |
| Load, compress, or delete an archive | `/api/mass-history` and `/api/mass-history/:archiveId`. |
| Export PDF | Electron only, through `exportPdf` and `exportSlidePdf`. |

Operator steps for library, export, and import are in the
[user guide](./docs/user-guide.md#mass-library). ZIP rules are in
[docs/zip-import.md](./docs/zip-import.md). The end-to-end flows are in
[docs/workflows.md](./docs/workflows.md).

## Hooks, checks, and the version rule

Enable the tracked hook once per clone, from the repository root:

```bash
git config core.hooksPath .githooks
```

The hook runs `node sacra-lux/scripts/precommit.js`. That script lints
staged JavaScript under `sacra-lux/src`, `sacra-lux/tests`, and
`sacra-lux/scripts`, plus `sacra-lux/eslint.config.js`. When
`sacra-lux/package.json` or `sacra-lux/package-lock.json` is staged, it also
runs `npm run check:version-sync` from `sacra-lux`.

Before you open a pull request, run these commands from `sacra-lux`:

```bash
npm run lint
npm run check:version-sync
npm test
```

Run `npm run test:e2e` after `npm run test:e2e:install` when you change a
browser flow.

GitHub checks on a pull request to `master`:

| Workflow | What it checks |
| --- | --- |
| [ci.yml](./.github/workflows/ci.yml) | Production audit, lint, version sync, unit and integration coverage, Playwright, and timer tests in five time zones. |
| [version-check.yml](./.github/workflows/version-check.yml) | The pull request version is above the `master` version. Dependabot is skipped. |
| [docs.yml](./.github/workflows/docs.yml) | Markdown lint and link checks when Markdown or the lint config changes. |
| [smoke.yml](./.github/workflows/smoke.yml) | A packaged-app smoke test on macOS Intel, macOS ARM, and Windows. |
| [secret-scan.yml](./.github/workflows/secret-scan.yml) | A gitleaks scan of the pull request history. |
| [workflow-lint.yml](./.github/workflows/workflow-lint.yml) | A zizmor scan of the workflow files. It fails on medium findings or higher. Accepted findings are in [.github/zizmor.yml](./.github/zizmor.yml). |
| [codeql.yml](./.github/workflows/codeql.yml) | CodeQL analysis. It also runs on a weekly schedule. |
| [security-triage.yml](./.github/workflows/security-triage.yml) | Opens or updates one issue each Monday at 14:00 UTC. The title is `[Security Triage] Week <date>`. The issue lists open CodeQL alerts and alerts fixed in the last seven days. You can also run it with `workflow_dispatch`. |
| [mutation.yml](./.github/workflows/mutation.yml) | Not a pull request check. It runs StrykerJS on `src/security.js` each week and on demand. It uploads the HTML report. |
| [dependency-review.yml](./.github/workflows/dependency-review.yml) | Reviews dependency changes in `sacra-lux/package.json` and `sacra-lux/package-lock.json`. It fails on a high severity finding. |
| [pages.yml](./.github/workflows/pages.yml) | Builds the user-guide site with MkDocs when `docs/`, `mkdocs.yml`, or `requirements-docs.txt` changes. A push to `master` publishes the site. |

Every pull request must raise the version in `sacra-lux/package.json` and
the two matching fields in `sacra-lux/package-lock.json`. The same version
string must appear in this README and in `docs/codebase_info.md`.
`version-check.yml` fails the pull request when the new version is not
above `master`.

A release tag must be `v` plus the `package.json` version. Example: version
`0.0.146-alpha` uses the tag `v0.0.146-alpha`. The release workflow rejects
any other tag.

## Releases

The Release workflow runs when a tag that matches `v*` is pushed. The tag
must equal `v` plus the package version, as stated above.

The workflow publishes three ZIP files, two DMG files, an SBOM for each ZIP,
a Grype report for each ZIP, and a checksum file:

- `Sacra-Lux-<version>-mac-arm64.zip`
- `Sacra-Lux-<version>-mac-x64.zip`
- `Sacra-Lux-<version>-win-x64.zip`
- `Sacra-Lux-<version>-mac-arm64.dmg`
- `Sacra-Lux-<version>-mac-x64.dmg`
- `Sacra-Lux-<version>-<platform>.spdx.json` (SPDX SBOM from Syft)
- `Sacra-Lux-<version>-<platform>.cdx.json` (CycloneDX SBOM from Syft)
- `Sacra-Lux-<version>-<platform>.grype.json` (Grype JSON report)
- `Sacra-Lux-<version>-<platform>.grype.sarif` (Grype SARIF report)
- `SHA256SUMS.txt` (SHA-256 of each ZIP, DMG, SBOM, and Grype report)

`<platform>` is `mac-arm64`, `mac-x64`, or `win-x64`. The scan job extracts
`app.asar` from each ZIP. Syft writes the SBOM files. Grype scans each SPDX
SBOM. If Grype reports a vulnerability at high severity or above, the
workflow does not publish the release. The scan does not check the DMG file.
The DMG contains the same application as the macOS ZIP.

A version that contains a hyphen, such as `0.0.146-alpha`, is published as
a GitHub prerelease. The workflow also attaches a build-provenance
attestation to each ZIP and DMG file. How to check that attestation is in
[docs/release-verification.md](./docs/release-verification.md).

macOS ZIP and DMG files contain a signed and notarized application. The macOS
jobs stop if any of these repository secrets is missing:

- `CSC_LINK` (base64 contents of the Apple signing certificate)
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

Do not put the secret values in the repository, in an issue, or in a pull
request. Store them as GitHub Actions secrets.

Windows ZIP files are not signed. The release workflow has no Windows
signing certificate and no Windows signing step.

From the repository root, tag the commit that contains the matching
`package.json` version, then push the tag:

```bash
git tag v0.0.269-alpha
git push origin v0.0.269-alpha
```

The tag in that example is the current package version with a `v` prefix.
If the package version changes, use `v` plus the new version.

## More detail

| Topic | Document |
| --- | --- |
| Document index | [docs/index.md](./docs/index.md) |
| Operator and volunteer steps | [docs/user-guide.md](./docs/user-guide.md) |
| Problems and first checks | [docs/troubleshooting.md](./docs/troubleshooting.md) |
| Mass ZIP layout | [docs/zip-import.md](./docs/zip-import.md) |
| `mass.json` schema | [docs/mass_document.md](./docs/mass_document.md) |
| Routes and Socket.IO events | [docs/interfaces.md](./docs/interfaces.md) |
| Release file check | [docs/release-verification.md](./docs/release-verification.md) |
| Package notes | [sacra-lux/README.md](./sacra-lux/README.md) |
| Agent guidance | [AGENTS.md](./AGENTS.md) |

## Current version

The current package version is `0.0.269-alpha`.
