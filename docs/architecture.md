# Architecture

## System Model

Sacra Lux is a server-centric presentation system. Every client renders from
shared state, but only the server mutates that state.

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

The operator UI owns organizer editing, slide editing, archive flows, screen
settings, app theme controls, and the PIN and Screen dialogs. The screen is a
pure renderer that also reports movie end/ready and image-preload failures. The
remote is intentionally smaller and focuses on navigation, grouped jumping,
and PIN handoff. It does not send `screen:interstitial-hold`.

## Entry Points

### Electron mode

`src/main.js` starts the shared server, opens BrowserWindows, manages the
application menu, and exposes native-only actions through IPC and the preload
bridge.

### Web mode

`src/web.js` starts the same server without Electron-specific features.

## Runtime Boundaries

### Composition and state

- `src/server.js` — routes, sockets, timers, and orchestration
- `src/state.js` — in-memory defaults plus `getStateSnapshot()`

### Domain logic

- `src/organizer.js` — organizer normalization and slide derivation
- `src/readingsImporter.js` — reading import, pagination, and pagination cache
- `src/massDocument.js` — `mass.json` version 3 validation and serialization
- `src/massHistory.js` — archive lifecycle and storage rules
- `src/lectionaryRss.js` — USCCB Daily Readings RSS import

### Support and safety

- `src/security.js` — PIN hashing, start tokens, control sessions, lockouts,
  and rate limits
- `src/logger.js` — consistent runtime logging
- `src/persistence.js` — session save/load and migration
- `src/themes.js` / `src/themes.json` — app UI theme definitions

## Persistent vs Derived Data

Persistent source of truth:

- `organizerSequence`
- `manualSlides`
- `screenSettings`
- selected runtime metadata such as `massStartTime`
- `appSettings.theme`
- `appSettings.remoteAddress`
- `appSettings.sourceNetworks`

Persisted to `~/.sacra-lux/current_mass/mass.json` as a version 3 Mass
Document (see [mass_document.md](./mass_document.md)).

Derived runtime data:

- `presentation.slides`
- reading pagination output
- preview-slide payloads returned by preview endpoints

## Timer Model

Sacra Lux has several timer families, all owned by `src/server.js`:

| Timer | Purpose |
| --- | --- |
| `_startTimer` | gathering lead-in, armed `gatheringMs` before `massStartTime` |
| `_massStartTimer` | hard cutover to the first Mass slide at `massStartTime` |
| `_preMassTimer` | pre-mass loop advance |
| `_gatheringTimer` | gathering loop advance |
| `_postMassTimer` | post-mass loop advance |
| `_countdownTimer` | countdown-slide expiry and resume |
| `_movieTimer` | movie fallback advance |
| `_imageSlideshowTimer` | image-slideshow auto-advance |
| `_saveTimer` | debounced persistence |

The two Mass wall-clock timers are scheduled together from
`scheduleStartTimer`. The lead-in arms gathering `gatheringMs` before
`massStartTime`; the cutover shows the first Mass slide at `massStartTime`
even if gathering overran or never started. When the app is opened late,
gathering starts immediately for the portion that still fits, and an
already-begun Mass jumps straight to its first slide.

An auto-advancing movie normally ends by a screen reporting
`slide:video-ended`, but a blocked autoplay or missing file may mean that
report never arrives. The phase timer steps aside and `scheduleMovieAutoAdvance`
arms a fallback at the item's duration (or the movie's real length once a
screen reports `slide:video-ready`). `src/movieAdvance.js` dedupes the end
reports when several projector windows watch the same movie.

Image slideshows advance on `_imageSlideshowTimer` for their total runtime.
The time is the image count, times the seconds per image, times the loop count.
A crossfade does not add time. An empty slideshow falls back to the next slide. Screens can report a failed preload
via `image-slideshow:preload-error`, which drops the image from playable
entries.

Countdown slides temporarily take over auto-advance from the active phase
timer. A control client can send `screen:interstitial-hold`. The server then
pauses active slide timers, swaps the rendered display to a chosen interstitial
slide, and restores the previous slide on the next event. The current phone
remote page does not send this event.

## Display Override Model

The screen renders from the selected `currentSlideIndex`, but runtime overrides
may temporarily change what is shown:

- `isBlack` hides content visually without changing slide selection
- `interstitialHoldActive` renders an interstitial slide while preserving the
  underlying selected slide to resume later

Those overrides are server-owned state and must not be implemented as
client-only display hacks.

## Control Authentication Model

When a start PIN is configured, the server issues a control session token on
PIN verification or start-pin change. Mutating HTTP requests and
control-sensitive socket events require that token (cookie or
`x-sacra-control` header). `POST /api/control-sessions/end` ends every
session except the caller. `control:lock` ends only the caller's session.
The full surface and its current limitations are in
[interfaces.md](./interfaces.md) and
[code_review_ears_report.md](./code_review_ears_report.md).

## Naming Notes

`screenSettings` is the canonical runtime term. `displaySettings` remains
compatibility language only for older imports and saved sessions.
