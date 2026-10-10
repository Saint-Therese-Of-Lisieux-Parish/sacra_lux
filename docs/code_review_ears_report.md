# Sacra Lux Code Review Report

Review date: 2026-09-30
Repository: `Saint-Therese-Of-Lisieux-Parish/sacra_lux`
Scope: server, persistence, import/export, authentication, Electron boundary, and automated coverage.

## Verification baseline

- `npm run lint` — passed.
- `npm test` — passed: 14 unit suites / 67 tests and 4 integration suites / 65 tests.
- `npm run test:e2e` — passed: 8 scenarios.

Passing tests establish the current baseline; they do not cover the risks below.

## Prioritized findings

### SL-001 — Mass ZIP exports bypass control authentication

Priority: P1 / security and privacy
Evidence: `src/server.js:1777-1782` skips authentication for every GET request, while `src/server.js:2389-2404` exposes the full Mass ZIP export and `src/server.js:2412-2421` exposes the AVIF export download. These archives can contain readings, slide content, and uploaded media. The server binds to `0.0.0.0` (`src/server.js:3386`), so this is reachable by other network clients.

EARS story: **While** a start PIN is configured, **when** an unauthenticated client requests any Mass export, **the system shall** reject the request with an authorization error and shall issue a download only to a valid control session.

Acceptance criteria:

- Both export endpoints require a valid control token when a PIN is configured.
- A one-time AVIF token is insufficient unless it is also bound to the authenticated session or requesting client.
- Existing projector/screen rendering remains available without exposing package downloads.

### SL-002 — Loopback unlock grants control to every local client

Priority: P1 / security
Evidence: `noteControlUnlock()` sets process-wide `loopbackUnlocked` (`src/security.js:189-193`), and both HTTP and Socket.IO authorization accept any loopback client while that flag is set (`src/security.js:196-210`). A PIN verification from one local client therefore authorizes unrelated local processes/windows without their control token.

EARS story: **When** PIN protection is enabled and a local client has not presented its own valid control session, **the system shall** reject control mutations even if another loopback client previously unlocked the application.

Acceptance criteria:

- Authorization is scoped to a session token, or to an explicitly documented single local UI session.
- A second local browser profile, webview, or process cannot issue slide or settings mutations without authorization.
- Clearing the PIN invalidates all prior sessions.

### SL-003 — No-PIN mode leaves the network control plane open

Priority: P1 / security and operational safety
Evidence: `clientMayControl()` and `socketMayControl()` return `true` whenever no PIN is configured (`src/security.js:196-205`), while the HTTP server listens on all interfaces (`src/server.js:3386`). A fresh installation can therefore be controlled by any client that can reach the host.

EARS story: **When** Sacra Lux is first started without a PIN and is reachable beyond loopback, **the system shall** require explicit operator confirmation or a configured PIN before accepting remote control mutations.

Acceptance criteria:

- First-run setup clearly warns that no-PIN mode permits network control.
- The operator can choose a mandatory PIN or an explicit trusted-LAN mode.
- The selected mode is persisted and shown in the operator UI.

### SL-004 — ZIP import has no decompressed-size or entry-count budget

Priority: P1 / availability
Evidence: JSON accepts up to 200 MB (`src/server.js:1775`), the import decodes the complete base64 payload and constructs an `AdmZip` object (`src/server.js:2596-2608`), then writes every accepted entry before validating the resulting package (`src/server.js:2618-2619`). A highly compressed archive or many entries can consume excessive memory, CPU, or disk space.

EARS story: **When** a client imports a Mass ZIP, **the system shall** reject archives whose compressed size, entry count, total uncompressed size, or individual entry size exceeds configured limits before replacing `current_mass`.

Acceptance criteria:

- Limits are enforced before extraction and are reported as a 4xx error.
- Temporary extraction is cleaned up on every rejection or failure.
- The existing atomic replacement behavior remains intact for accepted archives.

### SL-005 — Session and reading writes are not crash-atomic

Priority: P2 / data integrity
Evidence: `saveSession()` writes directly to `session.json` (`src/persistence.js:103-128`), and the reading editor writes directly to the source file (`src/server.js:3008-3018`). A process or machine failure during either write can leave a truncated session or reading and cause data loss on the next startup.

EARS story: **When** the system persists session state or an edited reading, **the system shall** write to a same-directory temporary file, flush/close it, and atomically replace the destination while retaining recoverable failure behavior.

Acceptance criteria:

- Interrupted writes do not replace a valid prior file with partial content.
- Temporary files are removed after success and after failure.
- Startup reports and safely recovers from a damaged primary file when a valid backup exists.

### SL-006 — Security and export behavior lack regression coverage

Priority: P2 / missing feature
Evidence: current automated coverage passes, but the listed tests do not exercise authenticated/unauthenticated export requests, loopback session isolation, no-PIN network behavior, ZIP bomb limits, or crash recovery. The relevant implementation paths are in `src/security.js`, `src/server.js`, and `src/persistence.js`.

EARS story: **When** CI runs the application test suite, **the system shall** verify the security and data-integrity requirements for control sessions, exports, imports, and persistence.

Acceptance criteria:

- Integration tests cover both PIN-enabled and no-PIN modes.
- Export tests prove unauthorized clients cannot download package data.
- Import tests cover oversized and pathological archives.
- Persistence tests simulate replacement failures and verify recovery.

## Suggested GitHub issue breakdown

Create one issue per finding (`SL-001` through `SL-006`), using the finding title as the issue title and the EARS story plus acceptance criteria as the issue body. Implement SL-001 through SL-004 before treating the application as safe for broader LAN deployment; SL-005 and SL-006 should follow as reliability and regression work.

## Review limitations

This review was performed from the checked-out source and automated tests. It did not create GitHub Issues or validate a packaged Electron build. The report is intentionally issue-ready so each finding can be copied into a GitHub Issue after triage.
