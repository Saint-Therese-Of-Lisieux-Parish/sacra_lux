# Sacra Lux Code Review Report

Review date: 2026-09-30
Status refreshed: 2026-10-11
Repository: `Saint-Therese-Of-Lisieux-Parish/sacra_lux`
Scope: server, persistence, import/export, authentication, Electron boundary, and automated coverage.

## Status update (2026-10-11)

Every finding below was re-checked against the current tree. All six remain
open; none are resolved. Line references are updated and, where useful, point
at the owning function rather than a fixed line. Regression coverage has grown
(see the baseline), and one integration test now exercises the unauthorized
control path, but the specific gaps in SL-006 remain.

## Verification baseline

- `npm run lint` — passed.
- `npm test` — passed: 15 unit suites / 73 tests and 4 integration suites / 70 tests.
- `npm run test:e2e` — passed: 10 scenarios.

Passing tests establish the current baseline; they do not cover the risks below.

## Prioritized findings

### SL-001 — Mass ZIP exports bypass control authentication

Priority: P1 / security and privacy
Evidence: the `/api` control middleware skips every `GET`
(`src/server.js:1849-1857`), while `GET /api/export-mass-zip`
(`src/server.js:2478`) and `GET /api/export-mass-zip-avif`
(`src/server.js:2501`) stream full Mass archives. These archives can contain
readings, slide content, and uploaded media. The server binds to `0.0.0.0`
(`src/server.js:3508`), so this is reachable by other network clients.

EARS story: **While** a start PIN is configured, **when** an unauthenticated client requests any Mass export, **the system shall** reject the request with an authorization error and shall issue a download only to a valid control session.

Acceptance criteria:

- Both export endpoints require a valid control token when a PIN is configured.
- A one-time AVIF token is insufficient unless it is also bound to the authenticated session or requesting client.
- Existing projector/screen rendering remains available without exposing package downloads.

### SL-002 — Loopback unlock grants control to every local client

Priority: P1 / security
Evidence: `noteControlUnlock()` sets process-wide `loopbackUnlocked`
(`src/security.js:189-194`), and both `clientMayControl()` and
`socketMayControl()` accept any loopback client while that flag is set
(`src/security.js:196-210`). A PIN verification from one local client therefore
authorizes unrelated local processes or windows without their own control
token. One integration test now covers the unauthorized control path
(`tests/integration/server.api.test.js`, "a client that has not unlocked the PIN
cannot control the Mass") but does not cover cross-client loopback isolation.

EARS story: **When** PIN protection is enabled and a local client has not presented its own valid control session, **the system shall** reject control mutations even if another loopback client previously unlocked the application.

Acceptance criteria:

- Authorization is scoped to a session token, or to an explicitly documented single local UI session.
- A second local browser profile, webview, or process cannot issue slide or settings mutations without authorization.
- Clearing the PIN invalidates all prior sessions.

### SL-003 — No-PIN mode leaves the network control plane open

Priority: P1 / security and operational safety
Evidence: `clientMayControl()` and `socketMayControl()` return `true` whenever
no PIN is configured (`src/security.js:196-205`), while the HTTP server listens
on all interfaces (`src/server.js:3508`). A fresh installation can therefore be
controlled by any client that can reach the host.

EARS story: **When** Sacra Lux is first started without a PIN and is reachable beyond loopback, **the system shall** require explicit operator confirmation or a configured PIN before accepting remote control mutations.

Acceptance criteria:

- First-run setup clearly warns that no-PIN mode permits network control.
- The operator can choose a mandatory PIN or an explicit trusted-LAN mode.
- The selected mode is persisted and shown in the operator UI.

### SL-004 — ZIP import has no decompressed-size or entry-count budget

Priority: P1 / availability
Evidence: JSON accepts up to 200 MB (`src/server.js:1847`), and
`POST /api/import-mass-zip` (`src/server.js:2717`) decodes the complete base64
payload, constructs an `AdmZip` object, and writes accepted entries into a
staging directory before validation. There is no compressed-size, entry-count,
total-uncompressed-size, or per-entry limit. The only size guards in the module
are the slideshow import limits
(`MAX_SLIDESHOW_IMPORT_IMAGES`, `MAX_SLIDESHOW_IMPORT_BYTES`), which do not apply
to `import-mass-zip`. A highly compressed archive or many entries can consume
excessive memory, CPU, or disk space.

EARS story: **When** a client imports a Mass ZIP, **the system shall** reject archives whose compressed size, entry count, total uncompressed size, or individual entry size exceeds configured limits before replacing `current_mass`.

Acceptance criteria:

- Limits are enforced before extraction and are reported as a 4xx error.
- Temporary extraction is cleaned up on every rejection or failure.
- The existing atomic replacement behavior remains intact for accepted archives.

### SL-005 — Session and reading writes are not crash-atomic

Priority: P2 / data integrity
Evidence: `saveSession()` writes directly to `session.json`
(`src/persistence.js:103-128`), and `POST /api/save-reading`
(`src/server.js:3117`) writes directly to the source file. A process or machine
failure during either write can leave a truncated session or reading and cause
data loss on the next startup. (Mass replacement itself is now staged and
atomic via `replaceCurrentMassDir()`, `src/server.js:115-148`.)

EARS story: **When** the system persists session state or an edited reading, **the system shall** write to a same-directory temporary file, flush/close it, and atomically replace the destination while retaining recoverable failure behavior.

Acceptance criteria:

- Interrupted writes do not replace a valid prior file with partial content.
- Temporary files are removed after success and after failure.
- Startup reports and safely recovers from a damaged primary file when a valid backup exists.

### SL-006 — Security and export behavior lack regression coverage

Priority: P2 / missing feature
Evidence: coverage has grown since the original review, including an
unauthorized-control integration test and rate-limit tests, but there is still
no test that exercises unauthenticated export downloads, loopback session
isolation, no-PIN network behavior, ZIP import size limits, or crash recovery.
The relevant implementation paths are in `src/security.js`, `src/server.js`, and
`src/persistence.js`.

EARS story: **When** CI runs the application test suite, **the system shall** verify the security and data-integrity requirements for control sessions, exports, imports, and persistence.

Acceptance criteria:

- Integration tests cover both PIN-enabled and no-PIN modes.
- Export tests prove unauthorized clients cannot download package data.
- Import tests cover oversized and pathological archives.
- Persistence tests simulate replacement failures and verify recovery.

## Suggested GitHub issue breakdown

Create one issue per finding (`SL-001` through `SL-006`), using the finding title as the issue title and the EARS story plus acceptance criteria as the issue body. Implement SL-001 through SL-004 before treating the application as safe for broader LAN deployment; SL-005 and SL-006 should follow as reliability and regression work.

## Review limitations

This review was performed from the checked-out source and automated tests. It did not create GitHub Issues or validate a packaged Electron build. The report is intentionally issue-ready so each finding can be copied into a GitHub Issue after triage. `ci.yml` runs the quality gates on PRs to `master`; the separate `version-check.yml` also runs on PRs to `master` and enforces the version bump.
