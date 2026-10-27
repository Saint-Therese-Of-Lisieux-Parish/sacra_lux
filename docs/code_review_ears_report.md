# Sacra Lux Code Review Report

Date: 2026-10-22

Commit reviewed: `b6531bd` (`origin/master`)

Scope: Review the nested Node/Electron application for bugs, missing features, and test gaps. Each finding uses EARS wording and can become a GitHub Issue.

## Status update

Scanned SHA: `505105ae6a9591a9fa59c89a1527fd9c05bd5b9f`

The SL-013 evidence below says `.github/workflows/release.yml` has no signing or notarization step. That was true at `b6531bd`. At the scanned SHA, the Release workflow signs, notarizes, and staples the macOS ZIP and DMG files. `CSC_IDENTITY_AUTO_DISCOVERY` is still `"false"`. The workflow imports the Apple certificate instead of using automatic discovery. Windows ZIP files are still not signed.

This note does not close SL-011 or SL-012.

At `31f683076d9e81c9e4fb39837d514ca3d7bff2e3`, the `/api` control check runs
before the JSON body parser. SL-011's line citations are from `b6531bd` and
do not match the current file. The upload JSON limit is 188 MB for a 140 MB
file, not 200 MB. Treat the finding text as the record of that older commit.

## Verification summary

- `npm test`: passed, 20 unit suites with 239 tests and 9 integration suites with 106 tests.
- `npm run lint`: passed.
- `npm run check:version-sync`: passed for version `0.0.91-alpha`.
- `npm run test:e2e`: passed, 26 tests; 9 screenshot tests are skipped by the test configuration.
- Packaged smoke CI exists for macOS Intel, macOS ARM, and Windows in `.github/workflows/smoke.yml`.
- The report contains no secrets or credential values.

## Findings

### SL-011 — Large unauthenticated request bodies are parsed before authorization

Priority: P1

Type: Security and reliability

Status: New finding. No matching open issue was found.

Evidence:

- `sacra-lux/src/server.js:2047-2053` installs the JSON body parser before the API authorization middleware.
- `sacra-lux/src/server.js:2055-2062` checks control access only after the parser completes.
- `sacra-lux/src/server.js:398-405` permits up to 200 MB for upload routes and more than 68 MB for Mass ZIP JSON wrappers.
- `sacra-lux/src/server.js:2127-2130` protects upload routes with authorization only through the later global middleware.

Impact: A remote client without control access can make the server allocate and parse a large request before it returns `401`. Repeated requests can consume memory and delay the operator, screen, and remote clients.

EARS requirements:

- R1: If a request needs control access, then the server shall reject an unauthorized request before it buffers the request body.
- R2: Where an authorized upload route accepts a large body, the server shall enforce the route limit while it reads the request.
- R3: While oversized unauthorized requests arrive, the server shall keep state and control requests available to authorized clients.

Acceptance criteria:

- [ ] (R1) Given a configured PIN and no control session, when a client sends a large body to an upload or import route, then the server returns `401` without buffering the full body.
- [ ] (R2) Given a valid control session, when a request stays within the documented upload limit, then the upload succeeds.
- [ ] (R2) Given a request exceeds the route limit, when the request arrives, then the server returns `413`.
- [ ] (R3) Given repeated unauthorized large requests, when another client requests state or sends a control action, then the valid request completes within the documented service target.
- [ ] Existing upload, ZIP import, and authorization tests pass.

### SL-012 — LAN control-mode authorization lacks a network-client regression test

Priority: P3

Type: Test gap and security regression risk

Status: New finding. No matching open issue was found.

Evidence:

- `sacra-lux/src/security.js:220-230` allows no-PIN control only for loopback clients or the persisted `trusted-lan` mode.
- `sacra-lux/src/server.js:2055-2062` applies this decision to all non-GET API routes.
- `sacra-lux/tests/integration/server.api.test.js:82-92` checks the mode value but does not send a mutation from a non-loopback client while the mode is `unset`.
- The application binds to `0.0.0.0` at `sacra-lux/src/server.js:3825`, so this path controls LAN exposure.

Impact: A future change can weaken the first-run LAN protection without a failing test. The current tests do not prove the main security boundary for a fresh installation.

EARS requirements:

- R1: While no PIN is configured and control mode is `unset`, the server shall reject control mutations from non-loopback clients.
- R2: While no PIN is configured and control mode is `trusted-lan`, the server shall accept control mutations from non-loopback clients.
- R3: While a PIN is configured, the server shall require a valid control session for control mutations from every client address.

Acceptance criteria:

- [ ] (R1) Given no PIN and `controlMode=unset`, when a request has a non-loopback client address, then a mutation returns `401`.
- [ ] (R2) Given no PIN and `controlMode=trusted-lan`, when a request has a non-loopback client address, then a valid mutation succeeds.
- [ ] (R3) Given a configured PIN, when a request has a non-loopback address without a control session, then a mutation returns `401`.
- [ ] Existing loopback, PIN, and trusted-LAN tests pass.

### SL-013 — Release quality checks do not cover all open release requirements

Priority: P2

Type: Missing feature and test gap

Status: Partially tracked by open issue [#88](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/issues/88).

Evidence:

- `.github/workflows/smoke.yml` now builds and launches packaged apps on three desktop targets.
- `.github/workflows/release.yml` publishes checksummed archives, but it sets `CSC_IDENTITY_AUTO_DISCOVERY: "false"` and has no signing or notarization step.
- The current CI workflow has no WebKit or mobile browser project, no large organizer or slideshow soak test, and no retry or flake report policy.
- The existing screenshot suite skips nine screenshot tests in the default local run.

Impact: Release builds can pass the current checks without signed artifacts, non-Chromium remote validation, or evidence of stable long-running media use.

EARS requirements:

- R1: When a release tag is pushed, the release pipeline shall publish signed and notarized artifacts for each supported desktop target.
- R2: Where client pages support mobile remote control, CI shall test the remote page with a mobile or WebKit browser project.
- R3: Where the application runs a large organizer and slideshow, CI shall run a bounded soak test and report resource growth.
- R4: When screenshot tests are skipped, CI shall report the reason and run the required visual checks in a configured job.

Acceptance criteria:

- [ ] (R1) Given a release tag, when the release pipeline completes, then each published desktop artifact has the required signature or notarization evidence.
- [ ] (R2) Given a pull request that changes a remote client page, when CI runs, then a mobile or WebKit remote test runs and stores failure evidence.
- [ ] (R3) Given a pull request that changes slide or media code, when CI runs, then the soak test completes without a crash or unbounded resource growth.
- [ ] (R4) Given screenshot tests are skipped on a local platform, when CI runs, then a configured screenshot job runs the required baselines or reports a clear platform exception.
- [ ] Existing lint, unit, integration, E2E, and packaged smoke tests pass.

## Findings resolved since the previous report

- The no-PIN LAN choice is implemented through `controlMode` and tracked issue #70 is closed.
- Clearing a Mass title removes `current_mass/mass_title.txt` and has an integration test.
- Unauthenticated session metadata no longer exposes local paths.
- JSON limits now use route-specific parser limits instead of a single 200 MB limit.
- Packaged smoke checks now run on macOS Intel, macOS ARM, and Windows.

## Out of scope

- Do not treat public Mass media routes as a finding. The projector and phone remote need access to the selected media.
- Do not duplicate the coverage issues already tracked by #174 through #182.
- Do not change application code in this review branch.

## Suggested issue order

1. Address SL-011 before exposing the server to a wider LAN.
2. Add the SL-012 network-address regression tests with the next security change.
3. Complete the remaining release requirements in #88, with signing and remote-client coverage first.
