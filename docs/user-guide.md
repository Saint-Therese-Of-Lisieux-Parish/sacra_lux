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
removes the current Mass media files. It then builds a starter organizer
(announcements, gathering timer, Mass title, hymns, interstitials, readings,
Creed, Lord's Prayer, communion, recessional, and post-announcements).

### Duplicate a Mass for next week

Use **🔄 Duplicate** to copy the current Mass into a new archive, then edit the
copy. This is the usual way to prepare the next week from this week's order.
The dialog sets the new start time seven calendar days later and keeps the
same clock time.

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
| Interstitial | an image slide used as a pause between other slides |

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

**⚙ Screen Settings** opens the **Display Settings** dialog. The dialog has four sections.

1. **Typography & Output** sets the primary font, the base size, the transition, and bold global text.
2. **Slide Backgrounds** sets two images. The first image is the background for Reading, Text, Hymn, and Prayer slides. The second image is the background for Interstitial slides. Each image can use a preset or an uploaded file.
3. **Text Styles** has five tabs: **Reading Body**, **Reading Reference & Passage**, **Text**, **Hymn**, and **Prayer**. A slide preview shows the selected text area. **Font** sets the type style for that tab. **Window Position** moves that text area. Font, size, bold, and italic are separate for Text, Hymn, and Prayer. The other Text, Hymn, and Prayer settings are shared. The reference tab also sets the section title, such as First Reading. It can show the slide number, the reading label, and the spoken ending. The spoken ending is its own slide. The text is `The Word of the Lord.` or `The Gospel of the Lord.`
4. **Resolution** is the last section. The choices are 720p, 1080p, 1440p, and 4K. The default is 1080p.

Most changes apply as you edit. **Apply Changes & Close** saves the changes and closes the dialog.

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

The operator page does not show Prev, Next, or Black Screen buttons. Use the keyboard when focus is not in a text field or an open dialog.

- Press `Right Arrow` or `Space` to show the next slide.
- Press `Left Arrow` to show the previous slide.
- Press `B` to hide the projector output. Press `B` again to show it. The selected slide does not change.
- **⏭ Go to Mass Start** jumps to the first Mass slide. The button is shown when the Mass has a Mass slide.

## The Phone Remote

Open `/remote` on a phone on the same network, or scan the QR code shown on the
idle projector. The remote shows a live projector preview at the top.

- Swipe left or right on the preview to move one slide.
- Use the carousel under the preview. Double-tap a card to show that slide.
- Tap a row in the slide list to jump to that slide. The list groups rows as Pre-Mass Announcements, Gathering, Mass, and Post-Mass Announcements.

The remote has no Blackout, Start Mass, or Interstitial button. It does not send `screen:interstitial-hold`.

## Starting the Remote with a PIN

If a start PIN is set, the remote must unlock before it can control the Mass:

1. Open `/start` on the phone.
2. Enter the 4–6 digit PIN. Repeated failures trigger escalating lockouts.
3. On success the phone is redirected to `/remote`.

Set, change, or clear the PIN from the **Start PIN** dialog. Clearing the PIN
removes the unlock requirement. A change or a clear ends the other control
sessions. Those phones must unlock again.

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

These keys work when focus is not in a text field, a list, or an open dialog:

| Key | Result |
| --- | --- |
| `Right Arrow` or `Space` | Show the next slide. |
| `Left Arrow` | Show the previous slide. |
| `Up Arrow` / `Down Arrow` | Move the organizer selection by one row. |
| `Page Up` / `Page Down` | Move the organizer selection by five rows. |
| `E` or `Enter` | Open the selected slide in the editor. |
| `B` | Hide or show the projector output. |

## Where Files Live

In Electron, **File > Save** writes the session and the current Mass. The
operator page then shows `Mass saved`, or the error text when the write fails.
Closing the app writes a save that is still waiting.

Sacra Lux keeps runtime files under `~/.sacra-lux/`:

- `session.json` — the saved session
- `current_mass/` — the active Mass package (`mass.json`, readings, `assets/`)
- `mass_history/` — archived Masses

Prayer texts ship in `sacra-lux/prayers/`. A packaged app reads them from the `prayers` extra resource. They are not stored under `~/.sacra-lux/`.

Use **📁 Open Mass Folder** (Electron) to open `current_mass/`.
