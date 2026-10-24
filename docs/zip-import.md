# ZIP Import

This document describes the exact ZIP structure that Sacra Lux accepts when
you import a Mass, and the conditions for a successful import. The code is in
`src/server.js` (`POST /api/import-mass-zip`, `writeZipMassPackage`, and
`validateMassZipArchive`). For the `mass.json` schema, see
[mass_document.md](./mass_document.md).

## Quick Rules

1. Put `mass.json` at the root of the ZIP. If `mass.json` is missing, the
   importer uses `settings.json` from the root.
2. Put reading text files in `readings/`. Put media files in `assets/`.
3. Put each file directly in an accepted folder: `readings/`,
   `readings/assets/`, `assets/`, or `uploads/`. The importer ignores files
   in deeper folders.
4. Keep the ZIP within the [limits](#limits).
5. Use only the [media extensions](#media-extensions) in the list.

## Directory Layout

```text
my-mass.zip
├── mass.json              required (or settings.json, see below)
├── readings/
│   ├── Reading_I.txt      reading text, one level only
│   └── assets/
│       └── cross.png      media, copied to assets/
├── assets/
│   ├── background.jpg     media, referenced as "assets/background.jpg"
│   └── hymn-1.png
└── uploads/
    └── old-image.png      media from older exports, copied to assets/
```

The Mass folder on disk is `~/.sacra-lux/current_mass/`. After the import,
it has this result:

```text
current_mass/
├── mass.json
├── Reading_I.txt
└── assets/
    ├── cross.png
    ├── background.jpg
    ├── hymn-1.png
    └── old-image.png
```

The application can also write other files to the Mass folder, for example
`mass_title.txt`. These files are not part of the ZIP structure.

## Accepted Entries

The importer extracts only the entries in this table. The importer does not
create other folders. Folder names, `mass.json`, `settings.json`, and the
`.txt` extension of a reading file are case sensitive. For example, the
importer ignores `Readings/a.txt` and `readings/A.TXT`. Only the media
extension check ignores case.

| ZIP path | Name rule | Destination |
| --- | --- | --- |
| `mass.json` | exact name, root only | `mass.json` |
| `settings.json` | used only if `mass.json` is missing | `mass.json` |
| `readings/<name>.txt` | one level, see below | Mass folder root |
| `readings/assets/<file>` | one level, media extension | `assets/` |
| `assets/<file>` | one level, media extension | `assets/` |
| `uploads/<file>` | one level, media extension | `assets/` |

A valid `<name>` or `<file>` has these properties:

- It has at least one character before the extension.
- It does not contain `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, or `|`.
- It does not start with `..`.

The extension of a reading file is `.txt`. The extension of a media file is in
the list below. The extension check ignores case for media files.

If `uploads/<file>` has the same name as a file that the importer already
wrote, the importer keeps the first file and skips the `uploads/` file.

The importer writes the parsed definition to `mass.json` in the Mass folder.
The ZIP file `settings.json` is not copied.

### Media Extensions

`jpg`, `jpeg`, `png`, `gif`, `webp`, `svg`, `avif`, `mp4`

### Ignored Entries

The importer ignores these entries. An ignored entry does not cause an error.

- Folder entries.
- Files at the root, other than `mass.json` and `settings.json`.
- Files in other folders, for example `fonts/a.png`.
- Nested files, for example `assets/sub/a.png`.
- Names with a not-allowed character, or with an extension that is not in the
  list.
- Entry names with `..` segments, for example `assets/../x.png`.

## The Definition File

The importer parses `mass.json` (or `settings.json`) as JSON. The importer
reads the `format` and `version` keys to choose how to read the file.

<!-- markdownlint-disable MD013 -->

| Format | Condition | Source of reading text |
| --- | --- | --- |
| v3 | `format` is `"sacra-lux.mass"` and `version` is `3` | `content.text` of each item |
| Legacy | a JSON object where `format` is not `"sacra-lux.mass"` | `readings/*.txt` files |
| Rejected | `format` is `"sacra-lux.mass"` and `version` is not `3` | none, 400 |
| Rejected | the JSON value is not an object (array, string, number, boolean, `null`) | none, 400 |

<!-- markdownlint-enable MD013 -->

### v3 Packages

- The document must pass the validation in `src/massDocument.js`. Unknown keys
  at any level are errors. See [mass_document.md](./mass_document.md).
- A v3 `mass.json` carries its own text. The `readings/` folder is optional
  for v3. The importer uses the `.txt` files in the Mass folder only if the
  v3 document produces no reading documents. Each item with `kind` equal to
  `reading` produces one reading document. A v3 document has no reading
  documents when it has no such item.
- Media references use the form `assets/<file>`. The `<file>` has no `/`. A
  reference with another form is an error: `Unsupported asset ref "...".`
- Put each referenced file in `assets/` in the ZIP. The import does not fail
  if a referenced file is missing, and the response does not list missing
  files. The slide shows no media.

### Legacy Packages

- `massStartTime`, if present, must be a valid datetime string.
- The importer reads the reading text from `readings/*.txt`. Each file uses
  this layout: a passage line, a blank line, and the body lines.
- The importer reads `presentationTitle`, `massStartTime`, `screenSettings`
  (or `displaySettings`), `organizerSequence`, and `manualSlides` (or
  `manualCues`).
- Media references can use `/api/mass-asset/<file>` or
  `/static/uploads/<file>`. The importer rewrites each `/static/uploads/<file>`
  reference in `mass.json` to `/api/mass-asset/<file>`. It copies the files
  from `assets/`, `readings/assets/`, and `uploads/` into the `assets/` folder
  of the Mass folder, so the app finds each file by the
  `/api/mass-asset/<file>` form. The app does not serve `/static/uploads/`.

## Limits

| Limit | Value |
| --- | --- |
| Compressed ZIP size | 50 MiB (52,428,800 bytes) |
| Number of entries | 1000 |
| Size of one entry, uncompressed | 50 MiB (52,428,800 bytes) |
| Total size, uncompressed | 250 MiB (262,144,000 bytes) |
| Rate limit | 10 requests in 10 minutes and 1 at a time, per client IP |

The importer checks the limits against the sizes in the ZIP headers before it
extracts any file. The importer also counts the bytes that it extracts. If an
entry has more or fewer bytes than its header declares, or if the extracted
bytes pass the entry limit or the total limit, the importer rejects the ZIP.
A ZIP that exceeds a limit is rejected as a whole, and the current Mass stays
unchanged.

The 50 MiB compressed limit applies to the whole ZIP. A large `mp4` file and
the other files together can exceed it. An `mp4` file is usually already
compressed, so it takes almost the same space in the ZIP.

## Request Format

Send `POST /api/import-mass-zip` with a JSON body:

```json
{ "zipData": "<base64 or data URL>" }
```

`zipData` is plain base64 or a `data:<type>;base64,<data>` URL. Whitespace in
the data is ignored.

## Failure Conditions

<!-- markdownlint-disable MD013 -->

| Condition | Status | Message |
| --- | --- | --- |
| `zipData` is missing | 400 | `zipData is required.` |
| `zipData` is not base64 | 400 | `Invalid zip data.` |
| Compressed size too large | 400 | `Mass ZIP compressed size exceeds the 52428800 byte limit.` |
| Too many entries | 400 | `Mass ZIP contains too many entries; the limit is 1000.` |
| One entry too large | 400 | `Mass ZIP entry "<name>" exceeds the 52428800 byte limit.` |
| Entry content differs from its declared size | 400 | `Mass ZIP entry "<name>" does not match its declared size.` or `Mass ZIP entry "<name>" is larger than its declared size.` |
| Total size too large | 400 | `Mass ZIP uncompressed size exceeds the 262144000 byte limit.` |
| Invalid entry size | 400 | `Mass ZIP entry "<name>" has an invalid size.` |
| No definition file | 400 | `ZIP does not contain mass.json or settings.json.` |
| Definition is not valid JSON | 400 | the JSON parser message |
| JSON value is not an object | 400 | `Mass definition must be a JSON object.` |
| `format` is `"sacra-lux.mass"`, `version` is not `3` | 400 | `Unsupported mass version.` |
| v3 validation fails | 400 | the `massDocument.js` message |
| Legacy `massStartTime` invalid | 400 | `massStartTime must be a valid datetime string.` |
| Rate limit exceeded | 429 | `Too many requests. Please try again later.` |
| Second import while one runs | 429 | `Too many concurrent requests. Please try again later.` |

<!-- markdownlint-enable MD013 -->

`import-mass-zip` returns `{ "ok": true, "slideCount": <n> }` with status 200
on success.

## Failure Safety

The importer builds the new Mass in a staging folder
(`.current_mass-staging-<token>`). It replaces `current_mass` only after the
extraction and the definition check pass. If any step fails, the current Mass
stays unchanged and the importer removes the staging folder.

## Minimal Examples

### v3

```text
minimal-v3.zip
└── mass.json
```

```json
{
  "format": "sacra-lux.mass",
  "version": 3,
  "metadata": { "title": "Sunday Mass" },
  "items": [
    {
      "id": "reading-1",
      "kind": "reading",
      "label": "First Reading",
      "section": "mass",
      "content": { "text": "A reading from the Book of Genesis..." }
    }
  ]
}
```

### Legacy

```text
minimal-legacy.zip
├── mass.json
└── readings/
    └── Reading_I.txt
```

```json
{ "presentationTitle": "Sunday Mass" }
```

`readings/Reading_I.txt`:

```text
Genesis 1:1-3

In the beginning, God created the heavens and the earth.
```

## Export Compatibility

`GET /api/export-mass-zip` writes the layout in this document:
`mass.json` and `assets/`. A ZIP that you export can be imported again. The
AVIF export changes the image extensions to `.avif` and updates the
references in `mass.json`.

## Maintenance

When you change the import code, update this document in the same pull
request. The tests for this behavior are in
`tests/integration/server.api.test.js` (search for `import-mass-zip`).
