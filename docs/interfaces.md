# Interfaces

Every external surface of Sacra Lux: HTTP pages, the HTTP API, Socket.IO
events, the Electron IPC bridge, and static mounts.

## HTTP Pages

| Route | Serves |
| --- | --- |
| `GET /` | primary operator UI (`app.html`) |
| `GET /app` | operator UI alias (`app.html`) |
| `GET /screen` | projector renderer (`screen.html`) |
| `GET /remote` | phone remote (`remote.html`) |
| `GET /start` | PIN entry page (`start.html`), or a redirect to `/api/start-redirect` when no PIN is configured |

## Control Authentication

When a start PIN is configured, mutating API requests and control Socket.IO
events require a control session. A control session is a 12-hour token issued
by `noteControlUnlock()` in `src/security.js` and delivered either as the
`sacra_lux_control` cookie or the `x-sacra-control` header.

- The `/api` middleware in `src/server.js` enforces control for every method
  except `GET`, `HEAD`, `OPTIONS`, and the exceptions `/verify-pin`,
  `/start-pin`, `/preview-reading`, and `/preview-manual-slide`.
- Socket handlers wrap control-sensitive events with `withControl()`, which
  emits `control:required` when the client is not authorized.
- `POST /api/start-pin`, `POST /api/verify-pin`, and a validated
  `GET /api/start-redirect` all issue a control session and set the cookie.
- With no PIN configured, control checks pass for every client (loopback
  unlock and no-PIN mode are documented as open in
  [code_review_ears_report.md](./code_review_ears_report.md)).

## HTTP API

### State and info

- `GET /api/state` — full client-safe snapshot
- `GET /api/session-info` — `{ lastReadingsFolderPath, sessionFile }`
- `GET /api/server-info` — `{ host, port, remoteUrl, screenUrl, appUrl }`

### Readings and organizer

- `POST /api/organizer` — replace `organizerSequence` and merge manual slides
- `POST /api/load-readings` — copy a readings folder into `current_mass` and rebuild
- `POST /api/reload-mass-folder` — re-import readings from `current_mass`
- `POST /api/preview-reading` — render one reading document without committing
- `POST /api/preview-manual-slide` — render one manual slide without committing
- `POST /api/save-reading` — write edited reading text back into the source `.txt`

### Screen and app settings

- `POST /api/screen-settings` — validate, persist, and repaginate
- `GET /api/themes` — theme `{ id, label }` list plus the current theme
- `GET /api/theme-vars` — full CSS variable map per theme
- `POST /api/app-settings` — set the app UI theme
- `POST /api/update-title` — set the presentation title

### Automation and PIN flow

- `POST /api/start-time` — set or clear `massStartTime` and arm the start timers
- `POST /api/start-pin` — set, change, or clear the start PIN
- `POST /api/verify-pin` — verify a PIN, issue a one-time start token and a control session
- `GET /api/start-redirect` — validate a start token and redirect to `/remote`
- `POST /api/pre-mass/start`, `POST /api/pre-mass/stop`
- `POST /api/gathering/start`, `POST /api/gathering/stop`
- `POST /api/post-mass/start`, `POST /api/post-mass/stop`

### Assets and prayers

- `POST /api/upload-mass-asset` — save one image or video into `current_mass/assets/`
- `POST /api/upload-image` — backward-compatible alias of the above
- `POST /api/import-slideshow-images` — save a bounded batch of images for a slideshow
- `POST /api/image-slideshow/preflight` — report duplicates, missing, unsupported, or unreadable slideshow images
- `GET /api/mass-assets` — list assets; `?kind=image|video|all`
- `GET /api/mass-asset/:filename` — serve one Mass asset
- `GET /api/prayers`, `GET /api/prayers/:filename`

### Import, export, and archive

- `GET /api/export-settings` — download a version 2 settings JSON payload
- `POST /api/import-settings` — apply a settings JSON payload
- `GET /api/export-mass-zip` — download the current Mass package as a ZIP
- `GET /api/export-mass-zip-avif?token=` — download a completed AVIF export via its one-time token
- `POST /api/import-mass-zip` — replace the current Mass from an uploaded ZIP
- `POST /api/duplicate-mass` — archive the current Mass and open a copy
- `POST /api/new-mass` — archive the current Mass and build a blank organizer; accepts `useLectionaryRss`
- `GET /api/mass-history` — list archives with active/archived metadata
- `POST /api/mass-history/:archiveId/load`
- `POST /api/mass-history/:archiveId/compress` — convert an archive to a compressed AVIF ZIP
- `DELETE /api/mass-history/:archiveId`

Rate limiting buckets (`RATE_LIMIT_CONFIG` in `src/security.js`):

| Bucket | Window | Max | Applied to |
| --- | --- | --- | --- |
| `global` | 60 s | 120 | all `/api` requests per IP |
| `auth` | 5 min | 10 | `start-pin`, `verify-pin`, `start-redirect` |
| `upload` | 10 min | 20 (2 concurrent) | asset and image uploads |
| `heavy` | 10 min | 10 (1 concurrent) | ZIP/AVIF exports, imports, Mass creation |

## Socket.IO Events

### Server to client

- `state:update` — full client-safe snapshot, after mutations and on connect
- `control:required` — `{ error }`, a control event arrived without authorisation
- `control:ok` — control session accepted in response to `control:auth`
- `export:avif:progress` — `{ current, total, filename }`
- `export:avif:done` — `{ token }`, one-time AVIF ZIP download token
- `export:avif:error` — `{ error }`
- `interstitial:hold:error` — `{ error }`, hold requested with no interstitial slide available

### Client to server

- `control:auth` — present a control token to unlock control events
- `screen:settings` — update screen settings and repaginate readings if needed
- `slide:next`, `slide:prev`
- `slide:goto` — jump to a slide index
- `slide:goto:remote` — jump from the remote and allow post-mass loop activation
- `slide:video-ended` — a screen reports a movie finished; the first report for a slide advances, later reports for the same slide are ignored
- `slide:video-ready` — a screen reports a movie's real length (`durationMs`) so the server can arm a fallback advance
- `image-slideshow:preload-error` — a screen reports an image that failed to preload
- `screen:interstitial-hold` — toggle remote interstitial hold
- `screen:black` — toggle blackout mode
- `export:avif:start` — start an AVIF ZIP export

## Electron IPC

The renderer bridge is exposed as `window.api` (`src/preload.js`). Channels
handled in `src/main.js`:

| `window.api` member | IPC channel | Purpose |
| --- | --- | --- |
| `pickFolder()` | `dialog:pickFolder` | native folder picker |
| `pickImageFile()` | `dialog:pickImageFile` | native image picker returning `{ name, dataUrl }` |
| `pickVideoFile()` | `dialog:pickVideoFile` | native video picker returning `{ name, dataUrl }` |
| `getMonitors()` | `screen:getMonitors` | list available displays |
| `setTargetMonitor(id)` | `screen:setTargetMonitor` | set and persist one target display |
| `setTargetMonitors(ids)` | `screen:setTargetMonitors` | set and persist a set of target displays |
| `setScreenFullscreen(on)` | `screen:fullscreen` | toggle screen fullscreen |
| `openMassFolder()` | `folder:openMassFolder` | open `~/.sacra-lux/current_mass` |
| `exportPdf(phases, quality)` | `export:pdf` | export full-deck PDF |
| `exportSlidePdf(slides, screenSettings, suggestedName, quality)` | `export:slide-pdf` | export slide-preview PDF |
| `isElectron` | — | `true` only inside Electron |

## Static Serving

| Path prefix | Source |
| --- | --- |
| `/static/*` | `sacra-lux/public/` (from `app.asar.unpacked/public` in packaged builds) |
| `/api/mass-asset/*` | `~/.sacra-lux/current_mass/assets/` |
