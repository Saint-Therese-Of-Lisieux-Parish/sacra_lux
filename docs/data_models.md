# Data Models

Runtime and persisted shapes used across Sacra Lux. Field lists name the
canonical runtime form; legacy aliases accepted only on import are called out
explicitly.

## Organizer Item

Persistent item in `state.organizerSequence`. This list, with
`state.manualSlides`, is the persistent source of truth for the deck.

```js
{
  id: string,
  type: "reading"
      | "image"
      | "imageSlideshow"
      | "movie"
      | "text"
      | "prayer"
      | "hymn"
      | "countdown"
      | "interstitial",
  label: string,
  sourceStem: string | null,
  psalmRefrainIndex: number,   // only present for psalms, > 0
  styleOverrides: object,
  phase: "pre" | "gathering" | "mass" | "post",
  backgroundTheme: "dark" | "light",
  durationSec: number          // clamped 1–3600
}
```

Normalization lives in `normalizeOrganizerSequence()` in `src/server.js`,
backed by `src/organizer.js`. Legacy input aliases accepted on load:

- `type`: `"reading-group"` → `"reading"`, `"graphic"` → `"image"`
- `phase`: `"warmup"` → `"gathering"`; unknown phases become `"mass"`
- `backgroundTheme`: accepts `backgroundType` or `backgroundMode`, and maps
  `"word"`/`"color"` → `"dark"`, `"graphic"`/`"image"` → `"light"`
- unknown `type` values become `"text"`
- default `backgroundTheme` is `"light"` for image, imageSlideshow,
  interstitial, and movie items; `"dark"` for everything else
- duplicate `id` values are rejected with a validation error

## Style Overrides

Per-item presentation overrides stored on `styleOverrides` and normalized by
`normalizeStyleOverrides()` in `src/organizer.js`. Unknown keys are dropped.

```js
{
  fontFamily: string,   // any non-empty string
  fontSizePx: number,   // clamped 24–200
  bold: boolean,
  italic: boolean,
  outline: boolean,
  shadow: boolean
}
```

For reading items these map onto `readingTextFont`, `readingTextSizePx`,
`readingTextBold`, `readingTextItalic`, `readingTextOutline`, and
`readingTextShadow` when the deck is built.

## Manual Slide Record

Stored in `state.manualSlides[id]` for non-reading organizer items. Every
record carries a base shape and a per-type extension.

Base shape (`createManualSlideRecord()`):

```js
{
  text: string,
  notes: string,
  textVAlign: "top" | "middle" | "bottom" | null,
  imageUrl: string | null,
  styleOverrides: object
}
```

Per-type extensions:

| Type | Extra fields |
| --- | --- |
| `countdown` | `countdownSec` (1–3600), `countdownFont`, `countdownStyle` (`ring` \| `digits` \| `bar` \| `minimal` \| `hourglass` \| `stopwatch`), `countdownSizePercent` (50–200) |
| `movie` | `videoUrl`, `videoLoop`, `videoAutoAdvance` |
| `imageSlideshow` | `images` (array of `{ url, name }`, max 500), `slideshowDurationSec` (1–3600), `slideshowLoopCount` (1–1000) |

`mergeManualSlideState()` merges stored records over the type defaults when an
organizer update arrives, so partial payloads do not drop defaults.

## Presentation Slide

Derived item in `presentation.slides`, rebuilt by
`buildPresentationFromOrganizer()` in `src/organizer.js`. Never persist or
mutate these in place.

Common fields on every slide:

- `id` — per-slide id (`<organizerItemId>:<page>` for manual slides,
  `reading-<stem>-p<page>` for readings)
- `index` — position in the deck, assigned after the deck is built
- `organizerItemId` — owning organizer item
- `type`
- `title`
- `phase`
- `backgroundTheme`
- `notes`
- `textVAlign`
- `imageUrl`
- `styleOverrides`

Reading slides add:

- `text`
- `readingSection`
- `passage`
- `groupLabel` — organizer label, falling back to the section label
- `pageNumber`, `totalPages`, `isFirstPage`, `isLastPage`
- `ending` — liturgical ending, `null` for every section today

Text, prayer, and hymn slides add `text`, `pageNumber`, `totalPages`,
`isFirstPage`, and `isLastPage`. Multi-page text slides are split at hard-break
markers (`---`) and at psalm refrain lines (`R.`).

Image, interstitial, and movie slides add `videoUrl`, `videoLoop`, and
`videoAutoAdvance` (movie type only). Image slideshows add
`slideshowImageName`, `slideshowImageIndex`, `slideshowImageCount`,
`slideshowDurationSec`, `slideshowLoopCount`, `slideshowEmpty`, plus
`pageNumber`/`totalPages`/`isFirstPage`/`isLastPage` per image.

Countdown slides add `countdownSec`, `countdownFont`, `countdownStyle`,
`countdownSizePercent`, and `countdownShowLabel` (currently always `false`).

## Screen Settings

Validated and clamped by `normalizeScreenSettings()` in `src/server.js`. This
function is the single choke point for validation; do not validate screen
settings in a client.

### Global fields

- `fontFamily` — Google Fonts allowlist, default `Merriweather`
- `fontSizePx` — clamped 24–200, default `60`
- `darkBackgroundUrl` — default `/static/assets/default-text-background.avif`
- `lightBackgroundUrl` — default `/static/assets/default-interstitial.png`
- `boldText`
- `resolution` — `720p` | `1080p` | `1440p` | `4k`, default `1080p`
- `transition` — `none` | `fade`, default `fade`

Legacy background aliases accepted on input only: `colorBackgroundUrl` and
`wordBackgroundUrl` map to `darkBackgroundUrl`; `imageBackgroundUrl` and
`graphicBackgroundUrl` map to `lightBackgroundUrl`.

### Text bounds

`textBounds` stores the layout boxes. `normalizeScreenSettings()` keeps this
object. `src/textBounds.js` clamps each box on a 1920×1080 reference canvas.

The keys are `readingBody`, `readingPassage`, `hymn`, `prayer`, and `text`.
Each value is `{ left, right, top, bottom }` in pixels from the canvas edges.
The box stays at least 120 pixels wide and 80 pixels tall. Left and right stay
in 0–1800. Top and bottom stay in 0–1000.

Defaults in `DEFAULT_TEXT_BOUNDS`:

- `readingBody`: left 80, right 80, top 130, bottom 110
- `readingPassage`: left 80, right 1190, top 70, bottom 908
- `hymn`, `prayer`, and `text`: left 110, right 110, top 90, bottom 90

The margin fields below are derived from these boxes for the selected
resolution. The server does not clamp those fields on their own.
`readingTextMarginXPx`, `readingTextMarginYPx`, and `readingTextHeightPx` come
from `readingBody`. `readingPassageYPx` and `readingPassageWidthPx` come from
`readingPassage`. `textSlideMarginXPx`, `textSlideMarginYPx`, and
`textSlideTextHeightPx` come from `text`. The hymn and prayer boxes do not
change those three text-slide fields.

An input that sends the old margin fields, and does not send `textBounds`, is
converted once by `legacyTextBoundsFromSettings()`.

### Reading body fields

- `readingTextAlign` — `left` | `center` | `right`
- `readingTextVAlign` — `top` | `middle` | `bottom`
- `readingTextFont` — allowlist or `""`
- `readingTextSizePx` — clamped 0–200; `0` falls back to `fontSizePx`
- `readingTextBold`
- `readingTextItalic`
- `readingTextColor` — `#rrggbb`
- `readingTextOutline`
- `readingTextOutlineColor` — `#rrggbb`
- `readingTextOutlineWidthPx` — clamped 0.5–20
- `readingTextShadow`
- `readingLineHeight` — clamped 1.0–3.0
- `readingLetterSpacingPx` — clamped -2–10
- `readingTextMarginXPx`, `readingTextMarginYPx`, `readingTextHeightPx` — derived from `textBounds.readingBody`

### Reading scripture reference fields

- `readingPassagePosition` — `top` | `middle` | `bottom`, default `top`. `middle` centers the reference when `legacyTextBoundsFromSettings()` builds the box.
- `readingPassageAlign` — `left` | `center` | `right`
- `readingPassageFont` — allowlist or `""`, default `""`. An empty value uses the primary font.
- `readingPassageSizePx` — clamped 20–90
- `readingPassageBold`
- `readingPassageColor` — `#rrggbb`
- `readingPassageItalic`
- `readingPassageShadow` — starts at the body drop shadow when not saved
- `readingPassageLineHeight` — clamped 1.0–3.0, default 1.15
- `readingPassageLetterSpacingPx` — clamped -2–10, starts at 3 percent of the size when not saved
- `readingPassageOutline`
- `readingPassageOutlineColor` — `#rrggbb`
- `readingPassageOutlineWidthPx` — clamped 0.5–20
- `readingPassageYPx`, `readingPassageWidthPx` — derived from `textBounds.readingPassage`

### Reading section title fields

A section title setting that is not saved starts at the matching reference value, with half the reference size. After it is saved, it no longer follows the reference.

- `readingSectionFont` — allowlist or `""`, default `""`. An empty value uses the scripture reference font on the projector.
- `readingSectionSizePx` — clamped 10–90
- `readingSectionColor` — `#rrggbb`
- `readingSectionBold`
- `readingSectionItalic`
- `readingSectionShadow`
- `readingSectionOutline`
- `readingSectionOutlineColor` — `#rrggbb`
- `readingSectionOutlineWidthPx` — clamped 0.5–20
- `readingShowPageNumber`
- `readingShowLabel`
- `readingShowEnding` — show the spoken ending on its own slide after the last page

### Text, prayer, and hymn fields

- `textSlideTextAlign` — `left` | `center` | `right`
- `textSlideTextVAlign` — `top` | `middle` | `bottom`
- `textSlideTextFont` — allowlist or `""`. This is the Text tab.
- `textSlideTextSizePx` — clamped 0–200. `0` uses the global base size.
- `textSlideTextBold`
- `textSlideTextItalic`
- `hymnTextFont`, `hymnTextSizePx`, `hymnTextBold`, `hymnTextItalic` — Hymn tab. An unsaved choice starts from the Text values. Size `0` uses the global base size.
- `prayerTextFont`, `prayerTextSizePx`, `prayerTextBold`, `prayerTextItalic` — Prayer tab. An unsaved choice starts from the Text values. Size `0` uses the global base size.
- `textSlideTextColor` — `#rrggbb`
- `textSlideLineHeight` — clamped 1.0–3.0
- `textSlideLetterSpacingPx` — clamped -2–10
- `textSlideTextOutline`
- `textSlideTextOutlineColor` — `#rrggbb`
- `textSlideTextOutlineWidthPx` — clamped 0.5–20
- `textSlideTextShadow`
- `textSlideShowPageNumber`
- `textSlideMarginXPx`, `textSlideMarginYPx`, `textSlideTextHeightPx` — derived from `textBounds.text`

## Client-Safe State Snapshot

`getStateSnapshot()` in `src/state.js` returns a structured clone of the full
runtime state with secrets stripped. Client-visible fields:

```js
{
  appSettings: { theme: string, remoteAddress: string, sourceNetworks: string },
  presentation: object,
  readingsSource: object,
  organizerSequence: array,
  manualSlides: object,
  organizerRevision: number,
  screenSettings: object,
  currentSlideIndex: number,
  currentSlideId: string | null,
  currentSlideChangedAt: string,
  isBlack: boolean,
  interstitialHoldActive: boolean,
  interstitialHoldSlideIndex: number | null,
  massStartTime: string | null,
  hasStartPin: boolean,
  controlMode: "unset" | "trusted-lan",
  targetScreenId: number | null,
  targetScreenIds: number[],
  screenFullscreen: boolean,
  preMassRunning: boolean,
  gatheringRunning: boolean,
  postMassRunning: boolean,
  countdownEndsAt: number | null,
  serverTime: number,
  imageSlideshowEndsAt: number | null,
  imageSlideshowLoopIteration: number,
  imageSlideshowError: string | null,
  activeMassArchiveId: string | null,
  startupPrompt: object | null,
  saveError: string,
  lastUpdated: string
}
```

Stripped before transmission:

- `startPin` and `startPinHash` (the snapshot adds `hasStartPin: boolean`)
- `readingsSource.folderPath` (the snapshot adds `readingsSource.hasFolder`)
- `interstitialHoldReturnSlideIndex`
- `interstitialHoldResumeState`

`serverTime` is the server clock in milliseconds when `getStateSnapshot()`
builds the snapshot. It is not the `lastUpdated` time. The projector subtracts
its own clock from `serverTime` and uses that offset for a countdown.

`startupPrompt` is `{ type: "mass-library", reason: string }` when the server
starts without a valid `current_mass` package, or `null` otherwise.

`saveError` is empty when the last scheduled save succeeded. A failed Mass
save sets `Could not save mass.json: <message>`. A failed session save sets
`Could not save session.json.` or `Could not save session.json: <message>`.
An absolute path in `<message>` is replaced with `[path]`.
The session file does not store `saveError`.

`organizerRevision` starts at 0. A successful organizer save adds 1.
The snapshot includes the current value. `applyMassPackageFromCurrentDir()`
also adds 1. Startup restore, ZIP import, and archive load call that function.

## Session File

`session.json` under `~/.sacra-lux/` persists session version `2`:

- `version` — always `2`
- `savedAt`
- `screenSettings`
- `organizerSequence`
- `manualSlides`
- `organizerRevision` — saved revision. Restore uses it when it is an integer of 0 or greater. Any other saved value leaves the revision at 0.
- `lastReadingsFolderPath`
- `presentationTitle`
- `currentSlideId` — saved when a slide id exists. Restore uses it when that id is still in the presentation and the age is from 0 through 4 hours. The age uses `currentSlideChangedAt`, or `savedAt` when the change time is missing. A missing id, a future time, or an older time leaves the slide index unchanged.
- `currentSlideChangedAt` — the time the current slide id last changed. `touch()` sets it when the slide id changes.
- `countdownEndsAt` — saved when the value is a finite number. Restore copies it. A countdown slide then continues from that end time. An end time that has passed advances. During Pre-Mass or Post-Mass, that advance stays in the phase.
- `massStartTime`
- `startPinHash`
- `targetScreenId`
- `targetScreenIds`
- `screenFullscreen`
- `preMassRunning` — saved as true or false. Restore starts Pre-Mass again when the session age is from 0 through 4 hours and the Mass start time has not passed.
- `postMassRunning` — saved as true or false. Restore starts Post-Mass again when the session age is from 0 through 4 hours. A resumed Post-Mass loop does not jump to the first Mass slide.
- `activeMassArchiveId`
- `controlMode`
- `appSettings` — `theme`, `remoteAddress`, and `sourceNetworks`. When `session.json` has no `sourceNetworks` string, the value is `SACRA_LUX_SOURCE_NETWORKS` if that variable is set. When the variable is not set, the value is `10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16`. A saved empty string allows every source address.

Parsed reading documents are omitted because they are reloaded from
`current_mass/`. Session version `1` is migrated automatically by
`migrateV1toV2()` in `src/persistence.js` (renames `manualCues`, `displaySettings`,
legacy background keys, and `warmup` phases).

Session writes and edited reading writes use `writeFileAtomic()` in
`src/atomicWrite.js`. The writer makes a same-directory temporary file,
flushes and closes it, then replaces the destination with one atomic rename.
The previous session is copied to `session.json.bak` before the replace. If
`session.json` is damaged at startup, `loadSession()` logs the damage and
recovers the session from the backup.

## Archive Metadata

Each Mass archive stores `metadata.json`:

```js
{
  id: string,
  title: string,
  startTime: string | null,
  createdAt: string,
  updatedAt: string,
  storage: "folder" | "compressed"
}
```

`listMassArchives()` augments each record with `hasPackage`,
`hasCompressedZip`, `sizeBytes`, and `isActive` for the API response.
When `metadata.json` is not valid JSON, the archive stays in the list. The
title is then the archive id, and `startTime`, `createdAt`, and `updatedAt`
are `null`.

## Mass Document

`current_mass/mass.json` is a versioned, portable Mass package. See
[mass_document.md](./mass_document.md) for the full `sacra-lux.mass` version 3
schema and its runtime round-trip.
