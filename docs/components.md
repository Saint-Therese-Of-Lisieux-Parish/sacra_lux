# Components

Module-by-module responsibilities across `src/`, `public/`, and the test
harness. Every source file has an entry.

## Core Server Modules

### `src/server.js`

HTTP and Socket.IO composition root, 4169 lines. Owns:

- route registration and the control-auth `/api` middleware
- socket event handling and the `withControl()` guard
- state mutation orchestration
- timer scheduling and rescheduling (all timer families)
- organizer and presentation rebuild triggers
- import/export flows (settings JSON, Mass ZIP, AVIF)
- archive operations
- remote interstitial-hold behavior
- the 100 ms serialized-snapshot cache (`getCachedStateSnapshot()`)

### `src/textBounds.js`

Layout boxes for projector text. `DEFAULT_TEXT_BOUNDS` holds the five boxes
`readingBody`, `readingPassage`, `hymn`, `prayer`, and `text`. Each box is
clamped on a 1920×1080 reference canvas. `normalizeTextBounds()` checks input.
`textBoundsToLegacySettings()` derives the older margin fields.

### `src/state.js`

Default in-memory state and exports:

- `state` — the single mutable runtime object
- `getSafeSlideIndex()`
- `touch()`
- `getStateSnapshot()` — strips PIN and interstitial-hold resume bookkeeping

### `src/organizer.js`

Pure organizer logic (no I/O):

- normalize item types, phases, background themes, style overrides, countdown
  styles/sizes, and slideshow images
- build the default organizer from imported readings
- derive presentation slides per type, including text hard-break splitting and
  image-slideshow expansion
- compute image-slideshow runtime, including crossfades

### `src/readingsImporter.js`

Reading pipeline:

- parse liturgy `.txt` files and derive sections from file stems
- normalize ordering and labels
- paginate psalms and readings with a visual-line estimator
- memoize visual-line estimates and cache pagination results (keyed by
  content hash + layout options) with TTL and LRU eviction

### `src/massDocument.js`

`mass.json` (Mass Document version 3) validation and serialization:

- strict key whitelists and per-kind content validation
- build a v3 document from runtime state and rebuild runtime state from a v3
  document
- remap screen settings to and from `presentationDefaults`
- serialize `styleOverrides` onto item presentation
- convert legacy `settings.json` packages into v3

### `src/lectionaryRss.js`

USCCB Daily Readings RSS integration:

- fetch `https://bible.usccb.org/readings.rss` with a 15-second timeout
- decode the HTML description into reading documents keyed by section stems
- `parseDailyReadingsRss()` is pure and unit-tested without network access

### `src/massHistory.js`

Archive lifecycle:

- archive ID allocation and filename sanitization
- archive path containment checks (path-traversal rejection)
- archive metadata read/write
- syncing `current_mass/` into an archive package
- listing, sizing, compressing (via the server), and deleting archives

### `src/atomicWrite.js`

`writeFileAtomic()` writes a same-directory temporary file, flushes it, and
renames it onto the destination. With `keepBackup`, it copies the previous
file to `<path>.bak` before the rename. Session save and reading saves use it.

### `src/persistence.js`

Durable session fields:

- save `session.json` version 2
- load and migrate version 1 sessions
- expose the session file path

### `src/uploadLimits.js`

`MAX_SINGLE_UPLOAD_BYTES` is 140 MB. The HTTP upload routes and the Electron
file pickers share this limit.

### `src/hostGuard.js`

`createHostGuard()` checks the `Host` and `Origin` headers. It blocks DNS
rebinding and cross-site requests to the local server. It gives an Express
middleware and a Socket.IO `allowRequest` callback. Allowed hosts are
loopback addresses, addresses of local network interfaces, and the networks
and host names in `SACRA_LUX_ALLOWED_NETWORKS`. A request with a host that is
not allowed gets HTTP 403. A state-changing request with
`Sec-Fetch-Site: cross-site` also gets HTTP 403.

### `src/readingEndings.js`

`endingForSection()` returns the spoken ending for a reading section, for
example "The Word of the Lord." or "The Gospel of the Lord.". It returns
`null` when the section has no ending.

### `src/security.js`

Security primitives:

- PBKDF2-SHA512 PIN hashing (150000 iterations) with timing-safe verification
- one-time remote start tokens bound to IP and user-agent
- control sessions (`issueControlSession`, `noteControlUnlock`) with a 12-hour TTL
- escalating PIN lockouts (60 s after 3 failures, 5 min after 6, 15 min after 9)
- HTTP and Socket.IO rate-limit buckets, plus upload/heavy concurrency limits
- periodic cleanup of expired rate-limit and lockout state

### `src/movieAdvance.js`

Dedupe guard (`createMovieEndGuard()`) so only the first projector window to
report a given movie's end advances the liturgy.

### `src/themes.js`

Loads `themes.json`, exposes `DEFAULT_THEME`, `getTheme()`, `listThemes()`,
and `listThemeEntries()`. Catholic themes are listed first.

### `src/themes.json`

Theme definitions (label, CSS variables, colour scheme) for the app UI.

### `src/logger.js`

Small runtime logging wrapper with `info` and `warn`.

## Electron Modules

### `src/cliBanner.js`

Writes the SACRA LUX startup banner once. `npm start` and `npm run web` call
`writeStartupBanner()`. The banner is skipped when stdout is not a TTY or when
logs are quiet. Color is omitted when `NO_COLOR` is set.

### `src/ipcHandlers.js`

Electron IPC implementation for the channels in
[interfaces.md](./interfaces.md). `createIpcHandlers()` builds the handlers.
`registerIpcHandlers()` attaches them to `ipcMain`. `main.js` calls both.

### `src/main.js`

Electron entry point. Handles BrowserWindow creation, the application menu,
monitor targeting and fullscreen actions, native file pickers (folder, image,
video), opening the current Mass folder, and PDF export through offscreen
capture. Registers the IPC handlers listed in
[interfaces.md](./interfaces.md).

### `src/windowSecurity.js`

Navigation lock for every Electron window. It cancels navigation outside the
local app origin (`http` on the app port, on a loopback host or the local
network address) and denies new windows. The app window allows only the
`/remote` popup.

### `src/preload.js`

Context-isolated renderer bridge. Exposes exactly the `window.api` surface
documented in [interfaces.md](./interfaces.md).

### `src/web.js`

Headless entry point that starts the shared server without Electron.

## Browser Surfaces

### `public/app.html`

Operator surface: readings load and reload, organizer editing and keyboard
navigation, slide editing with live preview, projector display settings, app
theme selection, Mass library and archive operations, New Mass and Duplicate
Mass dialogs, PIN and Screen dialogs, and import/export actions.

### `public/screen.html`

Projector renderer: reading slides, text, prayer, hymn, image,
image-slideshow, movie, and interstitial slides, countdown visuals, transitions,
blackout mode, movie end/ready reporting, slideshow preload-error reporting, and
an idle QR/start overlay.

### `public/remote.html`

Phone remote: prev/next, grouped slide jump list, next-section advance,
interstitial hold toggle, PIN entry handoff, and a live embedded screen
preview.

### `public/start.html`

PIN-gated remote start flow at `/start`.

### `public/client/shared.js`

UMD shared helpers loaded by all three pages and required directly by unit
tests: `escapeHtml()`, `formatCountdownTime()`, and `formatDurationTime()`.

### `public/shared.css`

Shared styles for the operator and remote surfaces.

### `public/assets/`, `public/fonts/`, `public/vendor/`

Default background images, bundled Google-style font files, and third-party
browser libraries served from `/static`.

## Test Support

### `tests/helpers/testHarness.js`

Starts an isolated server instance with a temporary `HOME` and quiet logging.
All suites isolate `HOME` through this helper; tests never touch the real
`~/.sacra-lux`.

### `tests/unit/`

Pure-module tests: `lectionaryRss`, `logger`, `massDocument`, `massHistory`,
`movieAdvance`, `organizer`, `persistence`, `preload`, `publicClientMarkup`,
`readingsImporter`, `security`, `sharedClient`, `state`, `themes`, `web`.

### `tests/integration/`

Full server tests against isolated state: `server.api`, `massStartClock`,
`movieAdvance`, `publicHtml`.

### `tests/e2e/`

Playwright browser flows in `workflows.spec.js` covering themes, image
slideshows, remote interactions, the PIN start flow, and loading readings.
