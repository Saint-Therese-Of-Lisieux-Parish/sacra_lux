# Architecture

## System Model

Sacra Lux is a server-centric presentation system. Every client renders
from shared state, but only the server mutates that state.

```text
operator UI / screen UI / remote UI
            | HTTP + Socket.IO |
                    v
               src/server.js
                    |
            state:update snapshots
```

## Core Runtime Rules

- clients never mutate shared state directly
- `src/server.js` applies the mutation
- after mutation, the server emits `state:update` and schedules persistence
- `presentation.slides` is derived from `organizerSequence`, `manualSlides`,
  imported readings, and `screenSettings`
- `screenSettings` validation and clamping stay inside `normalizeScreenSettings()`

## Clients

Sacra Lux has three synchronized client surfaces:

- `/` and `/app` — operator UI
- `/screen` — projector display
- `/remote` — phone remote

The operator UI owns organizer editing, slide editing, archive flows,
screen settings, and app theme controls. The screen is a pure renderer.
The remote is intentionally smaller and focuses on navigation, grouped
jumping, section advance, and interstitial hold.

## Entry Points

### Electron mode

`src/main.js` starts the shared server, opens BrowserWindows, manages the
application menu, and exposes native-only actions through IPC and the preload bridge.

### Web mode

`src/web.js` starts the same server without Electron-specific features.

## Runtime Boundaries

### Composition and state

- `src/server.js` — routes, sockets, timers, and orchestration
- `src/state.js` — in-memory defaults plus `getStateSnapshot()`

### Domain logic

- `src/organizer.js` — organizer normalization and slide derivation
- `src/readingsImporter.js` — reading import and pagination
- `src/massHistory.js` — archive lifecycle and storage rules

### Support and safety

- `src/security.js` — PIN hashing, start tokens, lockouts, rate limits
- `src/logger.js` — consistent runtime logging
- `src/persistence.js` — session save/load and migration

## Persistent vs Derived Data

Persistent source of truth:

- `organizerSequence`
- `manualSlides`
- `screenSettings`
- selected runtime metadata such as `massStartTime`

Derived runtime data:

- `presentation.slides`
- reading pagination output
- preview-slide payloads returned by preview endpoints

## Timer Model

Sacra Lux has several timer families:

- Mass start timer
- pre-mass loop timer
- gathering timer
- post-mass loop timer
- countdown-slide timer
- debounced persistence timer

Countdown slides temporarily take over auto-advance from the active
phase timer. The remote interstitial-hold feature pauses active slide
timers, swaps the rendered display to a chosen interstitial slide, then
restores the previous slide and restarts timing as if the slide had just
been selected.

## Display Override Model

The screen can render from the selected `currentSlideIndex`, but runtime
overrides may temporarily change what is shown:

- `isBlack` hides content visually without changing slide selection
- `interstitialHoldActive` renders an interstitial slide while preserving the
  underlying selected slide to resume later

Those overrides are server-owned state and must not be implemented as
client-only display hacks.

## Naming Notes

`screenSettings` is the canonical runtime term. `displaySettings`
remains compatibility language only for older imports and saved sessions.
