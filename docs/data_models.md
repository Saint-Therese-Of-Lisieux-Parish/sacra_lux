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
| `countdown` | `countdownSec` (1–300), `countdownFont`, `countdownStyle` (`ring` \| `digits` \| `bar` \| `minimal` \| `hourglass` \| `stopwatch`), `countdownSizePercent` (50–200) |
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
- `darkBackgroundUrl` — default `/static/assets/background-dark.png`
- `lightBackgroundUrl` — default `/static/assets/background-graphic.png`
- `boldText`
- `resolution` — `720p` | `1080p` | `1440p` | `4k`, default `1080p`
- `transition` — `none` | `fade`, default `fade`

Legacy background aliases accepted on input only: `colorBackgroundUrl` and
`wordBackgroundUrl` map to `darkBackgroundUrl`; `imageBackgroundUrl` and
`graphicBackgroundUrl` map to `lightBackgroundUrl`.

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
- `readingTextMarginXPx` — clamped 0–260
- `readingTextMarginYPx` — clamped 0–360
- `readingTextHeightPx` — clamped 120–980

### Reading scripture reference fields

- `readingPassagePosition` — `top` | `bottom`
- `readingPassageAlign` — `left` | `center` | `right`
- `readingPassageFont` — allowlist, default `Source Sans 3`
- `readingPassageSizePx` — clamped 20–90
- `readingPassageBold`
- `readingPassageColor` — `#rrggbb`
- `readingPassageOutline`
- `readingPassageOutlineColor` — `#rrggbb`
- `readingPassageOutlineWidthPx` — clamped 0.5–20
- `readingPassageYPx` — clamped 0–1060
- `readingPassageWidthPx` — clamped 180–1760

### Reading section title fields

- `readingSectionOutline`
- `readingSectionOutlineColor` — `#rrggbb`
- `readingSectionOutlineWidthPx` — clamped 0.5–20
- `readingShowPageNumber`
- `readingShowLabel`

### Text, prayer, and hymn fields

- `textSlideTextAlign` — `left` | `center` | `right`
- `textSlideTextVAlign` — `top` | `middle` | `bottom`
- `textSlideTextFont` — allowlist or `""`
- `textSlideTextSizePx` — clamped 0–200; `0` means auto-fit
- `textSlideTextBold`
- `textSlideTextItalic`
- `textSlideTextColor` — `#rrggbb`
- `textSlideLineHeight` — clamped 1.0–3.0
- `textSlideLetterSpacingPx` — clamped -2–10
- `textSlideTextOutline`
- `textSlideTextOutlineColor` — `#rrggbb`
- `textSlideTextOutlineWidthPx` — clamped 0.5–20
- `textSlideTextShadow`
- `textSlideShowPageNumber`
- `textSlideMarginXPx` — clamped 0–400
- `textSlideMarginYPx` — clamped 0–400
- `textSlideTextHeightPx` — clamped 120–1020

## Client-Safe State Snapshot

`getStateSnapshot()` in `src/state.js` returns a structured clone of the full
runtime state with secrets stripped. Client-visible fields:

```js
{
  appSettings: { theme: string },
  presentation: object,
  readingsSource: object,
  organizerSequence: array,
  manualSlides: object,
  screenSettings: object,
  currentSlideIndex: number,
  isBlack: boolean,
  interstitialHoldActive: boolean,
  interstitialHoldSlideIndex: number | null,
  massStartTime: string | null,
  hasStartPin: boolean,
  targetScreenId: number | null,
  targetScreenIds: number[],
  screenFullscreen: boolean,
  preMassRunning: boolean,
  gatheringRunning: boolean,
  postMassRunning: boolean,
  countdownEndsAt: number | null,
  imageSlideshowEndsAt: number | null,
  imageSlideshowLoopIteration: number,
  imageSlideshowError: string | null,
  activeMassArchiveId: string | null,
  startupPrompt: object | null,
  lastUpdated: string
}
```

Stripped before transmission:

- `startPin` and `startPinHash` (the snapshot adds `hasStartPin: boolean`)
- `interstitialHoldReturnSlideIndex`
- `interstitialHoldResumeState`

`startupPrompt` is `{ type: "mass-library", reason: string }` when the server
starts without a valid `current_mass` package, or `null` otherwise.

## Session File

`session.json` under `~/.sacra-lux/` persists session version `2`:

- `version` — always `2`
- `savedAt`
- `screenSettings`
- `organizerSequence`
- `manualSlides`
- `lastReadingsFolderPath`
- `presentationTitle`
- `massStartTime`
- `startPinHash`
- `targetScreenId`
- `targetScreenIds`
- `screenFullscreen`
- `activeMassArchiveId`
- `appSettings` — `{ theme }`

Parsed reading documents are omitted because they are reloaded from
`current_mass/`. Session version `1` is migrated automatically by
`migrateV1toV2()` in `src/persistence.js` (renames `manualCues`, `displaySettings`,
legacy background keys, and `warmup` phases).

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

## Mass Document

`current_mass/mass.json` is a versioned, portable Mass package. See
[mass_document.md](./mass_document.md) for the full `sacra-lux.mass` version 3
schema and its runtime round-trip.
