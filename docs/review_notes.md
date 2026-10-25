# Review Notes

## Review Status

The Markdown set was reviewed against the current codebase on `2026-10-11` and
refreshed to align with:

- the current route set, including `import-slideshow-images`,
  `image-slideshow/preflight`, and the `new-mass` USCCB path
- the current Socket.IO event set, including `control:auth`, `control:required`,
  `control:ok`, and `image-slideshow:preload-error`
- the current Electron bridge, including `pickVideoFile` and `setTargetMonitors`
- the image-slideshow and movie slide models, `styleOverrides`, and countdown
  style and size fields
- the version 3 Mass Document (`mass.json`) as the persisted package format
- control-session authentication and the current rate-limit buckets
- new operator/user guides and a troubleshooting page

## Major Corrections in This Pass

- replaced the stale organizer `type` union with the current nine types,
  including `imageSlideshow` and `movie`
- renamed the organizer background field from `backgroundType` to the canonical
  `backgroundTheme` (`dark`/`light`) and noted the legacy aliases
- documented `styleOverrides` and the countdown `countdownStyle` and
  `countdownSizePercent` fields
- corrected the global background settings to canonical
  `darkBackgroundUrl`/`lightBackgroundUrl` and marked the old names import-only
- added the missing snapshot fields (`imageSlideshow*`, `startupPrompt`,
  `hasStartPin`) and documented the stripped fields
- added `src/massDocument.js`, `src/lectionaryRss.js`, `src/themes.js`,
  `src/themes.json`, and `public/client/shared.js` to the component inventory
- refreshed the dependency versions and removed the false claim that CI runs
  the quality gates on current PRs
- corrected the doc version strings to `0.0.25-alpha`
- added `mass_document.md`, `user-guide.md`, and `troubleshooting.md`, and
  expanded the workflow set to fifteen flows
- corrected `AGENTS.md` version policy wording and the command blocks in both
  AGENTS files
- corrected the stale `version-check.yml` note: the workflow now targets
  `master` and runs on pull requests, so CI enforces the version bump

## Remaining Gaps

### `src/server.js` is still large

The docs describe the boundaries accurately, but the main runtime composition
file still carries many concerns. At the 2026-10-11 review the file was
roughly 3575 lines. At commit `505105a` the file is 4169 lines.

### Frontend internals are summarized, not exhaustively mapped

The docs describe current UI responsibilities and flows, but not every section
inside `public/app.html`, `public/screen.html`, and `public/remote.html`.

### Security findings are documented but unresolved

`code_review_ears_report.md` records known control-authentication and import
hardening gaps. They are documented, not fixed, in this pass.

### Release and packaging playbook remains light

At the 2026-10-11 review, build targets and storage were documented, but there
was no full release checklist. At commit `505105a`, the root README and
[release-verification.md](./release-verification.md) describe the release
files, the attestation check, and the macOS notarization checks. There is
still no deployment playbook.
