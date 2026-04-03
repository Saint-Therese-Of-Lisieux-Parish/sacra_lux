# Data Models

## Organizer Item

Persistent item in `state.organizerSequence`.

```js
{
  id: string,
  type: "reading" | "image" | "interstitial" | "text" | "prayer" | "hymn" | "countdown",
  label: string,
  sourceStem: string | null,
  phase: "pre" | "gathering" | "mass" | "post",
  backgroundType: "color" | "image",
  durationSec: number
}
```

Legacy values are normalized on load.

## Manual Slide Record

Stored in `state.manualSlides[id]` for non-reading organizer items.

Base shape:

```js
{
  text: string,
  notes: string,
  textVAlign: "top" | "middle" | "bottom" | null,
  imageUrl: string | null
}
```

Countdown slides also carry:

```js
{
  countdownSec: number,
  countdownFont: string,
  countdownShowLabel: boolean
}
```

## Presentation Slide

Derived item in `presentation.slides`.

Common fields include:

- `index`
- `type`
- `title`
- `phase`
- `backgroundType`
- `organizerItemId`

Reading slides also include fields such as:

- `text`
- `passage`
- `groupLabel`
- `pageNumber`
- `totalPages`

Manual text-like slides include:

- `text`
- `notes`
- `textVAlign`

Image and interstitial slides include:

- `imageUrl`

Countdown slides include:

- `countdownSec`
- `countdownFont`
- `countdownShowLabel`

## Screen Settings

Validated in `normalizeScreenSettings()` in `src/server.js`.

### Global fields

- `fontFamily`
- `fontSizePx`
- `colorBackgroundUrl`
- `imageBackgroundUrl`
- `boldText`
- `resolution`
- `transition`

### Reading body fields

- `readingTextAlign`
- `readingTextVAlign`
- `readingTextFont`
- `readingTextSizePx`
- `readingTextBold`
- `readingTextItalic`
- `readingTextColor`
- `readingTextOutline`
- `readingTextOutlineColor`
- `readingTextOutlineWidthPx`
- `readingTextShadow`
- `readingLineHeight`
- `readingLetterSpacingPx`
- `readingTextMarginXPx`
- `readingTextMarginYPx`
- `readingTextHeightPx`

### Reading scripture reference fields

- `readingPassagePosition`
- `readingPassageAlign`
- `readingPassageFont`
- `readingPassageSizePx`
- `readingPassageBold`
- `readingPassageColor`
- `readingPassageOutline`
- `readingPassageOutlineColor`
- `readingPassageOutlineWidthPx`
- `readingPassageYPx`
- `readingPassageWidthPx`

### Reading section title fields

- `readingSectionOutline`
- `readingSectionOutlineColor`
- `readingSectionOutlineWidthPx`
- `readingShowPageNumber`
- `readingShowLabel`

### Text, prayer, and hymn fields

- `textSlideTextAlign`
- `textSlideTextVAlign`
- `textSlideTextFont`
- `textSlideTextSizePx`
- `textSlideTextBold`
- `textSlideTextItalic`
- `textSlideTextColor`
- `textSlideLineHeight`
- `textSlideLetterSpacingPx`
- `textSlideTextOutline`
- `textSlideTextOutlineColor`
- `textSlideTextOutlineWidthPx`
- `textSlideTextShadow`
- `textSlideShowPageNumber`
- `textSlideMarginXPx`
- `textSlideMarginYPx`
- `textSlideTextHeightPx`

## Client-Safe State Snapshot

Client-visible state includes:

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
  activeMassArchiveId: string | null,
  lastUpdated: string
}
```

Raw PIN data and internal interstitial-hold resume bookkeeping are intentionally stripped.

## Session File

`session.json` persists version `2` data, including:

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
- `appSettings`

## Archive Metadata

Each Mass archive stores:

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
