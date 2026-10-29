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
  except `GET`, `HEAD`, `OPTIONS`, and the exceptions `/verify-pin` and
  `/start-pin`. `POST /api/preview-reading` and `POST /api/preview-manual-slide`
  require a control session.
- Socket handlers wrap control-sensitive events with `withControl()`, which
  emits `control:required` when the client is not authorized.
- `POST /api/start-pin`, `POST /api/verify-pin`, and a validated
  `GET /api/start-redirect` all issue a control session and set the cookie.
- With no PIN configured, control checks pass for loopback clients. A
  Digital Minister can also select `trusted-lan` through `POST /api/control-mode` to
  allow control from non-loopback clients.

## HTTP API

### State and info

- `GET /api/state` — full client-safe snapshot
- `GET /api/session-info` — `{ lastReadingsFolderPath, sessionFile }`; both fields are `null` for clients without a control session
- `GET /api/server-info` — `{ host, port, remoteUrl, screenUrl, appUrl }`

### Readings and organizer

- `POST /api/organizer` — replace `organizerSequence` and merge manual slides. An image URL or a movie URL must start with `/api/mass-asset/`, `/static/assets/`, or `/static/backgrounds/`. Any other value returns HTTP 400 and `Image and movie URLs must start with /api/mass-asset/, /static/assets/, or /static/backgrounds/.` The body may include `organizerRevision`. When that field is present and it is not equal to the current revision, the route returns HTTP 409. The error is `Another organizer change was saved first. Reload the current state and try again.` The body also returns the current `organizerRevision`. The route does not change the Mass. A body without `organizerRevision` still saves. A successful save adds 1 to `organizerRevision`.
- `POST /api/reload-mass-folder` — re-import readings from `current_mass`
- `POST /api/preview-reading` — render one reading document without committing; it uses the projector slide path, and without a `stem` it renders a sample reading from `text` and `passage`. Text longer than 100,000 characters gets HTTP 400.
- `POST /api/preview-manual-slide` — render one manual slide without committing
- `POST /api/save-reading` — write edited reading text into the source `.txt`. The `text` field must be a string. If it is not, the route returns HTTP 400 and `Reading text must be a string.` The route keeps the current presentation title. It clamps `currentSlideIndex`. It then saves the Mass.

### Screen and app settings

- `POST /api/screen-settings` — validate, persist, and repaginate. A background URL must start with `/api/mass-asset/`, `/static/assets/`, or `/static/backgrounds/`. Any other value returns HTTP 400 and `Background URLs must start with /api/mass-asset/, /static/assets/, or /static/backgrounds/.`
- `GET /api/themes` — theme `{ id, label }` list plus the current theme
- `GET /api/theme-vars` — full CSS variable map per theme
- `GET /api/network-addresses` — `{ addresses, selectedAddress }`. Each item in `addresses` is `{ interfaceName, address }` for one non-internal IPv4 address. `selectedAddress` is the saved `remoteAddress` when that value is not empty. Otherwise it is the address the server uses for remote and screen links.
- `POST /api/app-settings` — set `theme`, `remoteAddress`, or `sourceNetworks`. An unknown theme returns HTTP 400 and `Unknown theme.` `remoteAddress` must be empty or a current IPv4 address of this computer. Any other value returns HTTP 400 and `The selected network address is not available.` `sourceNetworks` must be a string. A value that is not a string returns HTTP 400 and `The source-network allowlist must be text.` An invalid entry returns HTTP 400 and `Invalid source network: <entry>.` A non-empty list that does not include the client address returns HTTP 400 and `The source-network allowlist must include the local operator address.`
- `POST /api/control-mode` — set `unset` or `trusted-lan` when no PIN is configured
- `POST /api/update-title` — set the presentation title

### Automation and PIN flow

- `POST /api/start-time` — set or clear `massStartTime` and arm the start timers
- `POST /api/start-pin` — set, change, or clear the start PIN
- `POST /api/verify-pin` — verify a PIN, issue a one-time start token and a control session
- `GET /api/start-redirect` — validate a start token and redirect to `/remote`. This GET does not start pre-Mass. After a valid token, the redirect is `/remote#start-pre-mass`, and the remote page sends `POST /api/pre-mass/start`.
- `POST /api/pre-mass/start`, `POST /api/pre-mass/stop`
- `POST /api/gathering/start`, `POST /api/gathering/stop`
- `POST /api/post-mass/start`, `POST /api/post-mass/stop`

### Assets and prayers

- `POST /api/upload-mass-asset` — save one image or video into `current_mass/assets/`. Image types are `jpg`, `jpeg`, `png`, `gif`, `webp`, `svg`, and `avif`. The video type is `mp4`. An unsupported type returns HTTP 400 and `Unsupported media type for "<name>".`
- `POST /api/upload-image` — backward-compatible alias of the above
- `POST /api/import-slideshow-images` — save a bounded batch of images for a slideshow. The body is `{ images: [{ filename, dataUrl }] }`. An empty list returns HTTP 400 and `Choose one or more image files.` More than 500 images returns HTTP 400 and `A slideshow can contain at most 500 images.` Images larger than 120 MB together return HTTP 400 and `The selected images are too large to import together.` When at least one image is valid, the route returns HTTP 200, the saved images, and `failed` for the rest. When every image is invalid, the route returns HTTP 400.
- `POST /api/image-slideshow/preflight` — report duplicates, missing, unsupported, or unreadable slideshow images
- `GET /api/mass-assets` — list assets; `?kind=image|video|all`
- `GET /api/mass-asset/:filename` — serve one Mass asset
- `GET /api/builtin-backgrounds` — list the built-in background images. This route allows 60 requests in 60 seconds.
- `GET /api/prayers`, `GET /api/prayers/:filename`

### Import, export, and archive

- `GET /api/export-settings` — download a version 2 settings JSON payload; `lastReadingsFolderPath` is `null` for clients without a control session
- `POST /api/import-settings` — apply a settings JSON payload. Background URLs use the screen-settings rule. Image and movie URLs in `manualSlides` use the organizer rule. A bad URL returns HTTP 400.
- `GET /api/export-mass-zip` — download the current Mass package as a ZIP
- `GET /api/export-mass-zip-avif?token=` — download a completed AVIF export via its one-time token
- `POST /api/import-mass-zip` — replace the current Mass from an uploaded ZIP
- `POST /api/duplicate-mass` — archive the current Mass and open a copy
- `POST /api/new-mass` — archive the current Mass and build a blank organizer; accepts `useLectionaryRss`
- `GET /api/mass-history` — list archives with active/archived metadata
- `POST /api/mass-history/:archiveId/load`
- `POST /api/mass-history/:archiveId/compress` — convert an archive to a compressed AVIF ZIP
- `DELETE /api/mass-history/:archiveId`

JSON request body limits (`JSON_BODY_LIMITS_BY_PATH` in `src/server.js`).
A larger body gets HTTP 413 before route logic runs.
`POST /api/import-mass-zip` is the exception.
A body over its limit returns HTTP 400.
The error starts with `Mass ZIP compressed size exceeds the 209715200 byte limit.`
The same error then states the encoded request size.

| Route | Limit |
| --- | --- |
| `POST /api/upload-mass-asset`, `POST /api/upload-image` | 188 MB (140 MB file as base64, `MAX_SINGLE_UPLOAD_BYTES`) |
| `POST /api/import-slideshow-images` | 161 MB (120 MB of images as base64) |
| `POST /api/import-mass-zip` | `268mb` (200 MiB ZIP as base64) |
| `POST /api/preview-reading`, `POST /api/preview-manual-slide` | 1 MB |
| all other routes | 10 MB |

Rate limiting buckets (`RATE_LIMIT_CONFIG` in `src/security.js`):

| Bucket | Window | Max | Applied to |
| --- | --- | --- | --- | --- |
| `global` | 60 s | 120 | `/api` requests per IP, except `GET` and `HEAD` for `/api/mass-asset/*` |
| `auth` | 5 min | 10 | `start-pin`, `verify-pin`, `start-redirect` |
| `upload` | 10 min | 20 (2 concurrent) | asset and image uploads |
| `heavy` | 10 min | 10 (1 concurrent) | ZIP/AVIF exports, imports, Mass creation |

`GET` and `HEAD` for `/api/mass-asset/*` skip the global bucket. A projector page with many images does not consume that budget. Upload and other `/api` routes still use it.

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
- `screen:settings` — update screen settings and repaginate readings if needed. A background URL with a bad prefix is ignored.
- `slide:next`, `slide:prev`
- `slide:goto` — jump to a slide index
- `slide:goto:remote` — jump from the remote and allow post-mass loop activation
- `slide:video-ended` — a projector reports a movie finished; the first report for a slide advances, later reports for the same slide are ignored
- `slide:video-ready` — a projector reports a movie's real length (`durationMs`) so the server can arm a fallback advance
- `image-slideshow:preload-error` — a projector reports an image that failed to preload
- `screen:interstitial-hold` — toggle remote interstitial hold
- `screen:black` — toggle blackout mode
- `export:avif:start` — start an AVIF ZIP export

The server accepts `slide:video-ended`, `slide:video-ready`, and `image-slideshow:preload-error` only from a socket whose handshake `screenRole` is `projector`, and only when that socket is on a loopback address or has a control session. Any other socket gets `control:required`.

## Electron IPC

The renderer bridge is exposed as `window.api` (`src/preload.js`). Channels
handled in `src/main.js`:

| `window.api` member | IPC channel | Purpose |
| --- | --- | --- |
| `pickFolder()` | `dialog:pickFolder` | native folder picker |
| `pickImageFile()` | `dialog:pickImageFile` | native image picker. A supported file returns `{ name, dataUrl }`. An unsupported file or a file over 140 MB returns `{ error }`. |
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
| `/static/backgrounds/*` | `sacra-lux/backgrounds/` (from the packaged `backgrounds` resource when that directory exists) |
| `/static/*` | `sacra-lux/public/` (from `app.asar.unpacked/public` in packaged builds) |
| `/api/mass-asset/*` | `~/.sacra-lux/current_mass/assets/` |
