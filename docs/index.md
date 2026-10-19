# Documentation Index

This directory is the maintained reference set for the current Sacra Lux
codebase.

## Recommended Reading Order

1. [../sacra-lux/README.md](../sacra-lux/README.md)
2. [codebase_info.md](./codebase_info.md)
3. [architecture.md](./architecture.md)
4. [interfaces.md](./interfaces.md)
5. [data_models.md](./data_models.md)

## Documents

### [codebase_info.md](./codebase_info.md)

Project identity, package metadata, repository layout, runtime storage,
build targets, and default URLs.

### [architecture.md](./architecture.md)

Shared-state model, server mutation rules, timer families, display overrides,
control authentication, and Electron versus web boundaries.

### [components.md](./components.md)

Module-by-module responsibilities across `src/`, `public/`, and the test
harness.

### [data_models.md](./data_models.md)

Organizer items, style overrides, manual slide records, presentation slides,
`screenSettings`, snapshots, sessions, and archive metadata.

### [mass_document.md](./mass_document.md)

The `sacra-lux.mass` version 3 document stored as `current_mass/mass.json`:
envelope, items, per-kind content, and runtime conversion.

### [zip-import.md](./zip-import.md)

The exact ZIP structure for Mass imports: accepted paths, limits, failure
conditions, and minimal examples.

### [interfaces.md](./interfaces.md)

HTTP pages, control authentication, HTTP APIs, Socket.IO events, Electron IPC,
and static asset boundaries.

### [dependencies.md](./dependencies.md)

Runtime, packaging, test, and quality-tooling dependencies, plus operational
notes.

### [workflows.md](./workflows.md)

End-to-end flows for readings import, organizer updates, countdowns, remote
interstitial hold, control auth, slideshow and movie playback, ZIP import and
export, archive operations, USCCB import, and session restore.

### [user-guide.md](./user-guide.md)

Operator and parish-volunteer guide: preparing a Mass, running one live, screen
settings, phases, PIN and remote, the Mass library, and export/import.

### [troubleshooting.md](./troubleshooting.md)

Symptom-driven troubleshooting for common runtime and operational problems.

### [review_notes.md](./review_notes.md)

Documentation reconciliation notes for the latest refresh.

### [code_review_ears_report.md](./code_review_ears_report.md)

Security and reliability findings in EARS form, with evidence and acceptance
criteria. Point-in-time report; see its status update.
