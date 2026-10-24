# Troubleshooting

Common symptoms and where to look first. Sacra Lux is server-centric: the
server holds the only authoritative state, so always inspect server state
(`GET /api/state`) before the browser DOM.

## The projector is blank or shows a stale slide

- Confirm the projector window is on `/screen` and the target display is set in
  **Screen Settings**.
- Check `isBlack` in `GET /api/state`. If it is `true`, press **Black Screen**
  to restore output.
- Check `interstitialHoldActive`. A stuck hold pins the projector to an
  interstitial; release the hold from the remote.
- Reload the `/screen` window. It renders purely from `state:update`.

## The remote or operator UI stops updating

- Confirm the device is on the same network and can reach
  `http://<host>:17841/`.
- A configured PIN blocks control until unlocked; a `401` or `control:required`
  means the client needs a control session. Re-open `/start` and unlock.
- Repeated PIN failures trigger lockouts and `429` responses with a
  `Retry-After` header. Wait out the lockout.
- Rate limits return `429` for too many requests (global), too many auth
  attempts, too many uploads, or too many heavy exports. Wait and retry.

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
  not rejected, so an out-of-range input will appear to "change value".
- A setting change that affects reading layout re-paginates the deck.

## Port already in use

Sacra Lux listens on `17841`. If another process holds it, stop that process or
restart the app. In web mode confirm nothing else is bound to the port.

## Native features are unavailable

PDF export, native file pickers, monitor selection, and opening the Mass folder
exist only in the Electron app. In web mode they are unavailable; check
`window.api.isElectron`.

## Security and data-safety items

Some security limits remain tracked with reproduction steps in
[code_review_ears_report.md](./code_review_ears_report.md). With no PIN,
loopback clients can control the app by default. Select `trusted-lan` to allow
non-loopback control, or configure a PIN for session-based control.
