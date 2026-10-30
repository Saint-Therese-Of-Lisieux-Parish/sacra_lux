# Troubleshooting

Common symptoms and where to look first. Sacra Lux is server-centric: the
server holds the only authoritative state, so always inspect server state
(`GET /api/state`) before the browser DOM.

## The projector is blank or shows a stale slide

- Confirm the projector window is on `/screen` and the target display is set in
  **Screen Settings**.
- Check `isBlack` in `GET /api/state`. If it is `true`, press `B` on the
  Digital Minister page to restore output. The Digital Minister page has no Black Screen button.
- Check `interstitialHoldActive`. A value of `true` pins the projector to an
  interstitial. The current phone remote does not send `screen:interstitial-hold`.
- Reload the `/screen` window. It renders purely from `state:update`.

## The remote or Digital Minister UI stops updating

- Confirm the device is on the same network and can reach
  `http://<host>:17841/`.
- A configured PIN blocks control until unlocked; a `401` or `control:required`
  means the client needs a control session. Re-open `/start` and unlock.
- Repeated PIN failures trigger lockouts and `429` responses with a
  `Retry-After` header. Wait out the lockout.
- Rate limits return `429` for too many requests (global), too many auth
  attempts, too many uploads, or too many heavy exports. Wait and retry.

## The start PIN is forgotten

- In the Electron app, open **File** and select **Reset Start PIN**.
- Confirm the reset. Sacra Lux clears the PIN, ends all control sessions, and
  saves the change to `session.json`.
- Unlock the remote again if a PIN is needed.

## A reading's text overflows or underfills the page

- Reading pagination is heuristic and estimates visual lines from the font
  size, margins, and line height. After changing any layout-affecting reading
  setting, the server re-paginates automatically; if the projector still looks
  wrong, adjust `readingTextSizePx`, `readingLineHeight`, `readingTextHeightPx`,
  or the margins in **Screen Settings**.
- Force a break manually with `---` on its own line in the reading text.

## Readings do not import

- Check the folder has `.txt` files named for their sections and that each file
  starts with a passage line, a blank line, then the body. See the
  [user guide](./user-guide.md#readings-folder-format).
- Files named `description.txt`, `mass_title.txt`, and `passage_filenames.txt`
  are ignored as readings.
- USCCB import requires outbound access to
  `https://bible.usccb.org/readings.rss`; a timeout or non-OK response surfaces
  as an import error.

## The Mass did not restore after a restart

- On startup the server prefers a valid `~/.sacra-lux/current_mass/mass.json`
  (a version 3 Mass Document). If it is missing or invalid, the server resets
  runtime state and opens the Mass Library prompt (`startupPrompt`). Load an
  archive from **📚 Mass Library**.
- Session version 1 files are migrated automatically.

## An image slideshow is stuck or shows a broken image

- Run the slideshow **preflight** in the editor. It flags `missing`,
  `unsupported`, `unreadable`, and `duplicate` images.
- A failed preload on the projector is reported back and that image is skipped.
- An empty slideshow safely advances instead of blocking the loop.

## A movie never advances

- The projector reports `slide:video-ended` when the video finishes; the first
  report for a slide advances. If autoplay is blocked or the file is missing,
  the server's `_movieTimer` fallback advances at the item's duration (or the
  video's reported length after `slide:video-ready`).

## A setting will not stick

- Screen settings are validated and clamped by the server
  (`normalizeScreenSettings()`). Values outside the allowed range are clamped,
  not rejected, so an out-of-range input will appear to change value.
- A value that is not a finite number keeps the current value.
- A setting change that affects reading layout re-paginates the deck.

## Port already in use

Sacra Lux listens on `17841`. If another process holds that port, Electron
shows "Sacra Lux could not start" and `Port <port> is already in use.`, then
quits. Stop the other process, or set `SACRA_LUX_PORT` to a free port, then
start the app again. In web mode, the process writes
`Port <port> is already in use. Stop the other process or set PORT to a free port.`
and exits. Set `PORT` or stop the process that holds `17841`.

A second Electron launch does not start a second server. It focuses the open
window, and the new process quits.

## Native features are unavailable

PDF export, native file pickers, monitor selection, and opening the Mass folder
exist only in the Electron app. In web mode they are unavailable; check
`window.api.isElectron`.

## Security and data-safety items

Some security limits remain tracked with reproduction steps in
[code review report](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/blob/master/docs/code_review_ears_report.md). With no PIN,
loopback clients can control the app by default. Select `trusted-lan` to allow
non-loopback control, or configure a PIN for session-based control.

## A device gets "Host not allowed" or "Origin not allowed"

The server rejects a request when its `Host` or `Origin` is not allowed. This
can happen when a phone opens the remote through a host name or a network
address that is not an address of this computer. Set
`SACRA_LUX_ALLOWED_NETWORKS` to the network, for example `192.168.1.0/24`, and
restart the app. See [Allowed hosts and origins](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/blob/master/README.md#allowed-hosts-and-origins).

A state-changing request from another web site gets HTTP 403 and the error
`Cross-site request not allowed.` Open the app from this computer instead.

## A device gets "Source network not allowed"

The source-network allowlist does not include that device. Open **Select Theme**
on this computer. In **System Settings**, add the device address under
**Allow client addresses and networks**, or clear the list to allow every
address. The message under the field shows a rejected save. The previous list
stays in use.

A `sourceNetworks` string in `session.json` is used after startup. A saved
empty string allows every source address. When `session.json` has no
`sourceNetworks` string, the server uses `SACRA_LUX_SOURCE_NETWORKS` if that
variable is set. When the variable is not set, the server uses
`10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16`.
See [Screen Settings](user-guide.md#screen-settings).
