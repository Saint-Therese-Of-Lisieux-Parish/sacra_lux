# Interfaces

## Socket.IO Events

### Server to client

- `state:update`: full client-safe state snapshot, emitted after mutations and on initial connection
- `export:avif:progress`: `{ current, total, filename }`, sent to the requesting socket
- `export:avif:done`: `{ token }`, one-time AVIF ZIP download token
- `export:avif:error`: `{ error }`, AVIF export failure
- `interstitial:hold:error`: `{ error }`, remote request failed because no interstitial slide was available

### Client to server

- `screen:settings`: update screen settings and repaginate readings if needed
- `slide:next`: advance one slide
- `slide:prev`: go back one slide
- `slide:goto`: jump to a slide index
- `slide:goto:remote`: jump from the remote and allow post-mass loop activation
- `screen:interstitial-hold`: toggle remote interstitial hold
- `screen:black`: toggle blackout mode
- `export:avif:start`: start AVIF ZIP export

## HTTP Pages

- `GET /`: primary operator UI
- `GET /app`: operator UI alias
- `GET /screen`: screen UI
- `GET /remote`: remote UI
- `GET /start`: start page or redirect to `/api/start-redirect` when no PIN is set

## HTTP API

### State and info

- `GET /api/state`
- `GET /api/session-info`
- `GET /api/server-info`

### Readings and organizer

- `POST /api/organizer`
- `POST /api/load-readings`
- `POST /api/reload-mass-folder`
- `POST /api/preview-reading`
- `POST /api/preview-manual-slide`
- `POST /api/save-reading`

### Screen and app settings

- `POST /api/screen-settings`
- `GET /api/themes`
- `GET /api/theme-vars`
- `POST /api/app-settings`
- `POST /api/update-title`

### Automation and PIN flow

- `POST /api/start-time`
- `POST /api/start-pin`
- `POST /api/verify-pin`
- `GET /api/start-redirect`
- `POST /api/pre-mass/start`
- `POST /api/pre-mass/stop`
- `POST /api/gathering/start`
- `POST /api/gathering/stop`
- `POST /api/post-mass/start`
- `POST /api/post-mass/stop`

### Assets and prayers

- `POST /api/upload-mass-asset`
- `POST /api/upload-image`
- `GET /api/mass-assets`
- `GET /api/mass-asset/:filename`
- `GET /api/prayers`
- `GET /api/prayers/:filename`

### Import, export, and archive

- `GET /api/export-settings`
- `POST /api/import-settings`
- `GET /api/export-mass-zip`
- `GET /api/export-mass-zip-avif`
- `POST /api/import-mass-zip`
- `POST /api/duplicate-mass`
- `POST /api/new-mass`
- `GET /api/mass-history`
- `POST /api/mass-history/:archiveId/load`
- `POST /api/mass-history/:archiveId/compress`
- `DELETE /api/mass-history/:archiveId`

## Electron IPC

The renderer bridge is exposed as `window.api`.

| Channel | Purpose |
| --- | --- |
| `dialog:pickFolder` | native folder picker |
| `dialog:pickImageFile` | native image picker returning `{ name, dataUrl }` |
| `screen:getMonitors` | list available displays |
| `screen:setTargetMonitor` | set and persist target display |
| `screen:fullscreen` | toggle screen fullscreen |
| `folder:openMassFolder` | open `~/.sacra-lux/current_mass` |
| `export:pdf` | export full-deck PDF |
| `export:slide-pdf` | export slide-preview PDF |

## Static Serving

| Path prefix | Source |
| --- | --- |
| `/static/*` | `sacra-lux/public/` |
| `/api/mass-asset/*` | `~/.sacra-lux/current_mass/assets/` |
