# Mass Document

`~/.sacra-lux/current_mass/mass.json` is the portable, versioned Mass package
that travels in ZIP import/export. Validation and both conversion directions
live in `src/massDocument.js`.

## Envelope

```js
{
  format: "sacra-lux.mass",
  version: 3,
  metadata: object,
  presentationDefaults: object,
  items: array,
  assets: object
}
```

Unknown top-level keys are rejected. `format` must be `"sacra-lux.mass"` and
`version` must be `3`.

### Metadata

- `title` — required, non-empty
- `scheduledStart` — optional ISO datetime (`massStartTime`), or `null`
- `locale`, `timezone`, `rite` — optional metadata keys (accepted, currently
  written as absent)

### presentationDefaults

The screen settings, remapped from the runtime field names onto document field
names (`remapScreenSettingsForDocument()`), and remapped back on load
(`remapPresentationDefaultsToScreenSettings()`).

### assets

A manifest object keyed by asset reference (`assets/<filename>`). Built by
scanning every item's `asset.ref`, `assets[].ref`, and any
`presentationDefaults.darkBackgroundUrl`/`lightBackgroundUrl` that point at
`assets/`.

## Item

```js
{
  id: string,
  kind: "text" | "prayer" | "hymn" | "reading" | "image"
      | "imageSlideshow" | "movie" | "countdown" | "interstitial",
  label: string,
  section: "pre" | "gathering" | "mass" | "post",
  durationSec: number,      // integer 1–3600, or null
  notes: string,            // optional
  content: object,          // optional, per-kind
  source: object,           // reading/text/prayer/hymn only
  asset: object,            // image/movie/interstitial only
  assets: array,            // imageSlideshow only
  presentation: object      // optional
}
```

Unknown item keys are rejected.

### content by kind

| kind | Required / allowed |
| --- | --- |
| `text`, `prayer`, `hymn`, `reading` | `text: string` |
| `countdown` | `seconds: integer` (1–300); `text` not allowed |
| `image`, `movie` | optional `text: string`; optional `autoAdvance: boolean`; `seconds` not allowed |
| `imageSlideshow` | `secondsPerImage: integer` (1–3600), `loopCount: integer` (1–1000); `text`/`seconds`/`autoAdvance` not allowed |
| `interstitial` | optional `text: string`; `seconds` not allowed |

### source by kind

`source` is only allowed for `text`, `prayer`, `hymn`, and `reading`, and may
contain `stem`, `citation`, `title`, `translation`, and `attribution`.

### asset and assets by kind

- `asset: { ref, name? }` — allowed only for `image`, `movie`, and
  `interstitial`.
- `assets: [{ ref, name? }]` — allowed only for `imageSlideshow`, at most 500
  entries.
- A reference must match `assets/<filename>`, and `assetUrlFromRef()` resolves
  it to `/api/mass-asset/<filename>`. `assetRefFromUrl()` accepts
  `/api/mass-asset/<filename>` and the legacy `/static/uploads/<filename>`.

### presentation

Allowed keys: `background`, `textAlign`, `textVAlign`, `fontFamily`,
`fontSizePx`, `bold`, `italic`, `outline`, `shadow`, `countdownStyle`,
`countdownSizePercent`, `loop`, `psalmRefrainIndex`.

| Key | Values |
| --- | --- |
| `background` | `"dark"` \| `"light"` |
| `textAlign` | `"left"` \| `"center"` \| `"right"` |
| `textVAlign` | `"top"` \| `"middle"` \| `"bottom"` |
| `fontSizePx` | 24–200 |
| `countdownStyle` | `"ring"` \| `"digits"` \| `"bar"` \| `"minimal"` \| `"hourglass"` \| `"stopwatch"` |
| `countdownSizePercent` | 50–200 |
| `loop` | boolean |
| `psalmRefrainIndex` | non-negative integer |

## Conversion

- `buildMassDocumentFromState(state)` — serialize the runtime state to a v3
  document, including `styleOverrides` folded into item `presentation`.
- `buildRuntimeStateFromMassDocument(document)` — validate a v3 document and
  rebuild organizer items, manual slides, reading documents, and screen
  settings.
- `buildMassDocumentFromLegacyPackage(packageData, documents, screenSettings)`
  — upgrade a legacy `settings.json` package to v3.
- `isMassDocumentV3(value)` — quick shape check used during restore.

## Reading Text

Reading content is stored inline as `content.text`. `serializeReadingDocument()`
also writes each reading back to a `<stem>.txt` file in `current_mass/` using
the canonical layout: passage line, blank line, then body lines.
