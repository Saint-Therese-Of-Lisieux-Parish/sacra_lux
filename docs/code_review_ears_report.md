# Sacra Lux Code Review Report

Date: 2026-10-21

Commit reviewed: `d490159` (`origin/master`)

Scope: Review the nested Node/Electron application for bugs, missing features, and test gaps. Each finding uses EARS wording and can become a GitHub Issue.

## Verification summary

- `npm run lint`: passed.
- `npm test`: passed, 19 unit suites with 178 tests and 7 integration suites with 90 tests.
- `npm run test:e2e`: passed, 12 tests.
- `npm run check:version-sync`: passed for version `0.0.68-alpha`.
- Packaged Electron build validation was not run.
- The report contains no secrets or credential values.

## Findings

### SL-003 — No-PIN network control remains an explicit first-run risk

Priority: P1

Type: Security and missing feature

Status: Existing open issue [#70](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/issues/70).

Evidence:

- `sacra-lux/src/server.js:2027-2035` binds the server to `0.0.0.0`.
- `sacra-lux/src/security.js:191-203` allows control when no PIN exists.
- `sacra-lux/src/server.js:2010-2021` protects mutation routes only when `clientMayControl()` returns false.
- The current end-to-end suite proves PIN-gated control, but it does not prove a first-run choice for no-PIN LAN access.

Impact: Any client that reaches the LAN port can control a fresh installation without a PIN. This is acceptable only after an explicit operator choice and warning.

EARS requirements:

- R1: When Sacra Lux starts without a PIN and is reachable beyond loopback, the system shall require explicit operator confirmation before it accepts remote control mutations.
- R2: While first-run setup offers a no-PIN mode, the setup shall warn that the mode permits network control.
- R3: When the operator chooses a mandatory PIN or an explicitly named trusted-LAN mode, the system shall persist and display the selected mode.

Acceptance criteria:

- [ ] (R1) Given a first-run installation on a LAN, when a remote client sends a control mutation before setup, then the server rejects the mutation.
- [ ] (R2) Given first-run setup, when the operator views the no-PIN choice, then the UI displays a warning about network control.
- [ ] (R3) Given a selected access mode, when the application restarts, then the selected mode remains visible and controls access.
- [ ] Existing PIN and Socket.IO authorization tests pass.

### SL-007 — Clearing the Mass title leaves a stale title file

Priority: P2

Type: Bug

Status: New finding. No matching open issue was found.

Evidence:

- `sacra-lux/src/server.js:227-246` removes old `.txt` files but removes `mass_title.txt` only when a new title is written.
- `sacra-lux/src/server.js:249-257` calls `syncReadingsDocumentsToCurrentMass()` during every current Mass save.
- If a Mass changes from a titled Mass to a Mass with an empty title, the old `mass_title.txt` remains in `current_mass`.
- A later restore can read the stale title even though the current state has no title.

Impact: A Mass can restore with a title that the operator already cleared. The current Mass package no longer matches the persistent state.

EARS requirements:

- R1: When the current Mass has no title, the persistence layer shall remove `current_mass/mass_title.txt`.
- R2: When the current Mass has a title, the persistence layer shall store only the current title in `current_mass/mass_title.txt`.

Acceptance criteria:

- [ ] (R1) Given a saved Mass with a title, when the operator clears the title and saves, then `current_mass/mass_title.txt` does not exist.
- [ ] (R2) Given a saved Mass with a title, when the operator changes the title and saves, then the file contains only the new title.
- [ ] A restart restores the same title shown before the restart.
- [ ] Existing persistence, import, and archive tests pass.

### SL-008 — Read-only endpoints disclose local file paths without control authorization

Priority: P3

Type: Security hardening

Status: New finding. No matching open issue was found.

Evidence:

- `sacra-lux/src/server.js:2010-2021` skips control authorization for all GET requests.
- `sacra-lux/src/server.js:2573-2592` exposes `lastReadingsFolderPath` through `/api/export-settings`.
- `sacra-lux/src/server.js:3378-3385` exposes both `lastReadingsFolderPath` and `sessionFile` through `/api/session-info`.
- The server listens on all interfaces, so a LAN client can request these paths without a control session.

Impact: A remote client can learn the operator's local directory layout. The paths can contain user names, parish names, or other private data.

EARS requirements:

- R1: If a client has no control session, then the server shall not return local filesystem paths from read-only API endpoints.
- R2: When an authorized operator requests session metadata, the server shall return only the metadata needed by the operator UI.

Acceptance criteria:

- [ ] (R1) Given a configured PIN and no control session, when a client requests session metadata or settings export, then the response omits local filesystem paths.
- [ ] (R2) Given a valid control session, when the operator requests the endpoint, then the response contains the documented fields and no secret values.
- [ ] Existing public screen, remote, and settings flows still pass.

### SL-009 — The JSON parser accepts a 200 MB body for every API route

Priority: P2

Type: Reliability and denial-of-service hardening

Status: New finding. No matching open issue was found.

Evidence:

- `sacra-lux/src/server.js:1999` installs `express.json({ limit: "200mb" })` for the whole application.
- The Mass ZIP import has a 50 MB compressed limit at `sacra-lux/src/server.js:2899-2924`, but the JSON parser reads the request before route-level validation.
- The upload routes enforce smaller decoded limits, but unrelated mutation and preview routes still accept the global limit.

Impact: A reachable client can make the server allocate and parse very large JSON bodies before authentication or route validation rejects the request. This can delay Mass control or exhaust memory.

EARS requirements:

- R1: If a request body exceeds the limit for its API route, then the server shall reject the request before application parsing allocates the full body.
- R2: While a client sends oversized requests, the server shall keep control and display endpoints available to other clients.

Acceptance criteria:

- [ ] (R1) Given an oversized request for a small mutation route, when the request arrives, then the server returns HTTP 413 before route logic runs.
- [ ] (R1) Given a Mass ZIP import within its documented limit, when the request arrives, then the import still succeeds.
- [ ] (R2) Given repeated oversized requests, when another client requests state or sends a control action, then the valid request completes within the documented service target.
- [ ] Existing upload and ZIP validation tests pass.

### SL-010 — Packaged Electron behavior has no automated release gate

Priority: P2

Type: Missing feature and test gap

Status: Tracked by the open CI roadmap issue [#88](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/issues/88).

Evidence:

- `sacra-lux/package.json` defines build scripts, but the current verification run did not build or launch a packaged Electron application.
- The current CI test commands cover lint, unit tests, integration tests, and headless browser tests.
- Packaged-only paths include Electron IPC, `asarUnpack` public files, native `sharp`, and bundled prayer resources.

Impact: A release can pass the current checks while the packaged application fails to start or cannot access packaged resources.

EARS requirements:

- R1: Where the application is packaged, the CI pipeline shall build and launch the packaged application on each supported desktop platform.
- R2: If the packaged application cannot serve `/api/state` and `/screen`, then the CI pipeline shall fail.
- R3: When a packaged smoke test fails, the pipeline shall retain the build log and test evidence.

Acceptance criteria:

- [ ] (R1) Given a pull request that changes packaged application code, when CI runs, then the pipeline builds on macOS and Windows.
- [ ] (R2) Given a successful package build, when the smoke test launches the application, then `/api/state` and `/screen` return successfully.
- [ ] (R3) Given a failed package or smoke test, when CI finishes, then the workflow exposes the relevant logs and artifacts.
- [ ] Existing lint, unit, integration, and end-to-end tests pass.

## Findings not carried forward

The earlier review findings for export authorization, loopback authorization isolation, ZIP resource limits, and session or edited-reading atomic writes are implemented in the reviewed commit or covered by existing tests. Keep regression coverage for these controls when changing related code.

## Suggested issue order

1. Complete existing issue #70 before exposing a fresh installation on a LAN.
2. Fix SL-007 because it can restore stale user data.
3. Address SL-009 before adding more network-facing upload or import features.
4. Address SL-008 as part of the same access-control hardening work.
5. Complete issue #88 for packaged release confidence.
