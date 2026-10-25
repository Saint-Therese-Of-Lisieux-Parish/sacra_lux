# User Guide

A practical guide for the volunteer running Sacra Lux at a Mass. It covers the
three screens, preparing a Mass, operating one live, and managing the library.
For install and build steps see the package README; for developer detail see
the rest of this directory.

## The Three Screens

| Screen | Address | Who uses it |
| --- | --- | --- |
| Operator | `http://<host>:17841/` (or `/app`) | you, at the computer |
| Projector | `http://<host>:17841/screen` | the congregation |
| Remote | `http://<host>:17841/remote` | you, on a phone |

The operator window also shows a live preview of the projector. All three stay
in sync because the server broadcasts every change to all of them.

## First Run

1. Launch Sacra Lux (the Electron app) or start web mode (`npm run web`).
2. Open the operator screen. With no Mass loaded, the app opens the Mass
   Library prompt so you can create or load a Mass.
3. In Electron, open **Screen Settings** and choose the projector display, then
   enable **Fullscreen**. The projector opens the `/screen` page.

## Preparing a Mass

### Create a new Mass

Open **New Mass** (➕). Enter a title and, optionally, a start time. If you tick
**Import today's readings from the USCCB Daily Readings RSS feed**, Sacra Lux
fills the First Reading, Psalm, Second Reading, Gospel, and Gospel Acclamation
from `bible.usccb.org` and uses the feed title when you leave the title blank.
This needs internet access.

Creating a new Mass archives the current one first if it has content, then
builds a starter organizer (announcements, gathering timer, Mass title, hymns,
interstitials, readings, Creed, Lord's Prayer, communion, recessional, and
post-announcements).

### Duplicate a Mass for next week

Use **🔄 Duplicate** to copy the current Mass into a new archive, then edit the
copy. This is the usual way to prepare the next week from this week's order.

### Import readings from a folder

Use **📥 Import** or **🔄 Reload Mass Folder** to load a folder of reading
`.txt` files. See [Readings Folder Format](#readings-folder-format) below.

## The Organizer

The organizer is the ordered list of Mass parts. Each row is one item; the
projector shows the derived slides.

Add slides with **➕ New Slide** and choose a type:

| Item type | What it projects |
| --- | --- |
| Reading | paginated scripture for one imported reading |
| Text | a free-text slide (announcements, notes) |
| Prayer | a prayer slide, optionally loaded from the prayer library |
| Hymn | hymn lyrics |
| Image | one image |
| Image Slideshow | several images that cycle automatically |
| Movie | a video file |
| Countdown | a visual countdown timer |
| Interstitial | a holding slide used by the remote |

Reorder rows with **▲ Up** and **▼ Down**, duplicate with **Duplicate**, and
remove with **Delete**. Assign each item a section: **Pre-Mass**, **Gathering**,
**Mass**, or **Post-Mass**. The section controls which automation loop plays it.

### Editing a slide

Select an item and use the Slide Editor dialog. Depending on the type you can:

- edit text, with **Insert Slide Break (---)** to force a manual page break
- choose image or video assets with **Add image**, **Add image folder**,
  **Remove image**, or **Remove video**
- **Reverse order** or **Sort A–Z** a slideshow's images
- **Use filename as label** to name slideshow images
- set a countdown's seconds, style, and size, and **Simulate Countdown**
- apply per-slide style overrides (font, size, bold, italic, outline, shadow)

For a slideshow, set **seconds per image** and **loop count**, and run the
preflight check to catch duplicates, missing files, and unreadable images
before the Mass.

### Editing reading text

Open a reading's slide and edit the text, then **Save**. Sacra Lux writes the
edit back to the source `.txt` in the Mass package.

## Screen Settings

**⚙ Screen Settings** opens the **Display Settings** dialog. The dialog has four sections:

1. **Typography & Output** sets the primary font, the base size, the transition, the resolution, and bold global text.
2. **Dark & Light Presets** sets the background image for dark slides and the background image for light slides.
3. **Text Styles** shows one slide type at a time. The tabs are **Reading Body**, **Reading Reference & Passage**, and **Text, Prayer & Hymn**. The reference tab also sets the section title, such as First Reading.
4. **Visual Bounds Editor** moves one layout box. The choices are Reading body, Passage reference, Hymn, Prayer, and Text slide.

**🎨 Select Theme** opens the theme list. It does not change the projector text.

The server validates and clamps these settings. A change that affects reading layout re-paginates the reading slides.

## Start Time and Phases

Set the Mass start time in the operator UI (or when creating the Mass).
Sacra Lux then runs the phases:

- **Pre-Mass** — a loop of Pre-Mass items before the lead-in. **▶ Start Pre-Mass**
  starts it early; **Next** advances a slide.
- **Gathering** — begins automatically before the start time and loops the
  Gathering items. **▶ Start Gathering** starts it manually.
- **Mass** — at the scheduled time the projector cuts to the first Mass slide,
  even if gathering overran. If you open the app after the start time, the
  projectors jump straight to the first Mass slide.
- **Post-Mass** — **▶ Start Post-Mass** loops the Post-Mass items.

A countdown slide pauses auto-advance until it reaches zero.

## Blackout and Manual Navigation

- **Black Screen** hides the projector output without changing the selected
  slide.
- **◀ Prev** and **Next ▶** move one slide.
- **⏭ Go to Mass Start** jumps to the first Mass slide.

## The Phone Remote

Open `/remote` on a phone on the same network, or scan the QR code shown on the
idle projector. The remote is preview-first: a live projector preview sits at
the top, with:

- **Prev** / **Next**
- a grouped list of slides for quick jumping
- next-section advance
- **Hold on interstitial** to pin the projector to an interstitial slide while
  you navigate elsewhere, then release to resume the prior slide

## Starting the Remote with a PIN

If a start PIN is set, the remote must unlock before it can control the Mass:

1. Open `/start` on the phone.
2. Enter the 4–6 digit PIN. Repeated failures trigger escalating lockouts.
3. On success the phone is redirected to `/remote`.

Set, change, or clear the PIN from the **Start PIN** dialog. Clearing the PIN
removes the unlock requirement.

## Mass Library

**📚 Mass Library** lists archived Masses with their title, start time, size,
and storage type. From here you can **Load**, **Compress** (convert a folder
package to an AVIF-optimized ZIP), or **Delete** an archive. The active Mass is
listed first.

## Export and Import

- **↩︎ Import** loads a Mass or settings ZIP/JSON.
- **↪︎ Export** downloads the current Mass as a ZIP.
- **Export AVIF** converts eligible images to AVIF and downloads an optimized
  ZIP.
- **📄 Export PDF** (Electron only) produces a full-deck PDF.
- **Export Slide to PDF** (Electron only) exports the current slide preview.

All export ZIPs contain a version 3 `mass.json`; see
[mass_document.md](./mass_document.md).

## Readings Folder Format

A readings folder contains `.txt` files named for their section:

- `Reading_I.txt`
- `Responsorial_Psalm.txt`
- `Reading_II.txt`
- `Verse_Before_the_Gospel.txt`
- `Gospel.txt`
- `mass_title.txt` (optional)

Alternates such as `Gospel-alternate_1.txt` are supported. Files named
`description.txt`, `mass_title.txt`, and `passage_filenames.txt` are ignored as
readings.

Each reading file uses:

1. first non-empty line as the passage reference
2. a blank line
3. the reading body

A line of `---` forces a manual page break. A line beginning with `R.` starts a
new slide so psalm refrains get their own page.

## Keyboard

The operator UI supports keyboard navigation and editing shortcuts. Hover a
control to see its key hint; common keys cover next/previous slide, blackout,
and dialog confirm/cancel.

## Where Files Live

Sacra Lux keeps runtime files under `~/.sacra-lux/`:

- `session.json` — the saved session
- `current_mass/` — the active Mass package (`mass.json`, readings, `assets/`)
- `mass_history/` — archived Masses
- `prayers/` — the prayer library

Use **📁 Open Mass Folder** (Electron) to open `current_mass/`.
