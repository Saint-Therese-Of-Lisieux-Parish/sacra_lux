# Components

## Core Server Modules

### `src/server.js`

Main HTTP and Socket.IO composition root.

Owns:

- route registration
- socket event handling
- state mutation orchestration
- timer scheduling and rescheduling
- organizer and presentation rebuild triggers
- import/export flows
- archive operations
- remote interstitial-hold behavior

### `src/security.js`

Owns:

- PIN hashing and verification
- one-time remote start token issuance and validation
- IP lockouts for repeated failures
- API and socket rate limiting

### `src/logger.js`

Small runtime logging wrapper.

### `src/state.js`

Defines default in-memory state and exports:

- `state`
- `getSafeSlideIndex()`
- `touch()`
- `getStateSnapshot()`

### `src/persistence.js`

Handles:

- saving durable session fields to `session.json`
- loading a saved session
- migrating older session formats

### `src/massHistory.js`

Handles:

- archive ID allocation
- archive metadata read and write
- syncing `current_mass/` into an archive package
- listing, compressing, and deleting archives

## Domain Modules

### `src/organizer.js`

Pure organizer logic:

- normalize item types, phases, and background types
- create default organizer content from imported readings
- build derived presentation slides
- split manual text-like slides on hard breaks

### `src/readingsImporter.js`

Reading pipeline:

- parse liturgy `.txt` files
- normalize ordering and labels
- paginate psalms and readings
- estimate wrapping and multi-page fit

## Electron Modules

### `src/main.js`

Electron entry point.

Handles:

- BrowserWindow creation
- application menu setup
- monitor targeting and fullscreen actions
- native file pickers
- current Mass folder opening
- PDF export through offscreen capture

### `src/preload.js`

Renderer bridge for Electron-only actions.

Exposes:

- `pickFolder`
- `pickImageFile`
- `getMonitors`
- `setTargetMonitor`
- `setScreenFullscreen`
- `openMassFolder`
- `exportPdf`
- `exportSlidePdf`
- `isElectron`

### `src/web.js`

Headless entry point that starts the shared server without Electron.

## Browser Surfaces

### `public/app.html`

Operator surface for:

- readings load and reload
- organizer editing and keyboard navigation
- slide editing with live preview
- projector display settings
- app theme selection
- archive operations
- import and export actions

### `public/screen.html`

Projector renderer for:

- reading slides
- text, prayer, hymn, image, and interstitial slides
- countdown visuals
- transitions
- blackout mode
- idle QR/start overlay
- preview mode for PDF export

### `public/remote.html`

Phone remote for:

- prev and next
- grouped slide jump list
- next-section advance
- interstitial hold toggle
- live embedded screen preview

### `public/start.html`

PIN-gated remote start flow.

## Test Support

### `tests/helpers/testHarness.js`

Starts an isolated server instance with a temporary home directory and
quiet info logging for tests.
