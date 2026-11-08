# User Guide

This page is for the Digital Minister.
It tells you how to prepare a Mass and how to run the slides.

The administrator installs Sacra Lux.
The install steps are on the [supported platforms](install.md) page.
The Digital Lecturer uses the [phone remote](phone-remote.md).

## The three windows

Sacra Lux uses three windows.

- The Digital Minister window is on the computer. You prepare and run the Mass here.
- The projector window is for the congregation.
- The phone remote is for the Digital Lecturer.

The Digital Minister window shows a live preview of the projector.
A change on one window appears on the others.

## Before Mass

1. Open **Sacra Lux**.
2. When no Mass is loaded and a saved Mass exists, the **Mass Library** window opens.
3. When no Mass is loaded and no saved Mass exists, the **Create New Mass** window opens.
4. Open **Screen Settings**.
5. Choose the projector display.
6. Select **Fullscreen**.

When Pre-Mass, Gathering, or Post-Mass starts, Sacra Lux can turn fullscreen on.
It does this when the projector display is not the Digital Minister display, and when fullscreen is still allowed.
Select **Exit Fullscreen** to stop that.
Select **Fullscreen** to allow it again.

If the projector display is not connected, the status line shows **The projector display is not connected.**

## Preparing a Mass

### Create a new Mass

Open **New Mass** (➕). Enter a title and, optionally, a start time. If you tick
**Import today's readings from the USCCB Daily Readings RSS feed**, Sacra Lux
fills the First Reading, Psalm, Second Reading, Gospel, and Gospel Acclamation
from `bible.usccb.org` and uses the feed title when you leave the title blank.
This needs internet access.

Edit the Mass title in the Digital Minister header. If that save fails, the field
returns to the saved title and the status line shows the error.

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

If another change is saved first, Sacra Lux loads the current Mass again.
Your change is not kept.
The status line then shows
`Another organizer change was saved first. Reload the current state and try again.`

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
before the Mass. If the check cannot run, the editor shows
`Preflight could not be completed.`

**Add image folder** keeps files whose names end in `avif`, `gif`, `jpg`,
`jpeg`, `png`, `svg`, or `webp`. It skips other files and names them in the
status line. The import stops at 500 images. It also stops when the selected
images are larger than 120 MiB (125829120 bytes) together.
The files already stored, plus the new files, must be 209715200 bytes or smaller.
If they are larger, the message starts with `Mass media exceeds the 209715200 byte limit;`
The message then states the current total and the size of the new upload.
The Mass can hold at most 990 asset files.
Files already in the Mass count toward this limit.
If a new upload would pass the limit, the message starts with `Mass asset file count exceeds the 990 file limit;`
The message then states the current count and the number of new files.

**Add image** and a drop on the slideshow drop zone send the selected images
in one request. The server keeps each image it can store. When some images
fail, the status line shows the added count, then `failed:` and the file
names. When the request fails, the status line shows the selected count,
then `failed:` and the file names.

### Editing reading text

Open a reading's slide and edit the text, then **Save**. Sacra Lux writes the
edit back to the source `.txt` in the Mass package. The save keeps the current
Mass title and the current slide. If the save fails, the status line shows the
error.

## Screen Settings

**⚙ Screen Settings** opens the **Display Settings** dialog. The dialog has four sections.

1. **Typography & Output** sets the primary font, the base size, the transition, and bold global text.
2. **Resolution** sets the output size. The choices are 720p, 1080p, 1440p, and 4K.
3. **Slide Backgrounds** sets two images. The first image is the background for Reading, Text, Hymn, and Prayer slides. The second image is the background for Interstitial slides. Each image can use a preset or an uploaded file. Each selected image has a thumbnail. Select a thumbnail to open a larger view in the output aspect ratio. Press **Escape** or **Close** to return to Display Settings. If no image is selected, the thumbnail says **No background selected**. If the image cannot be shown, the thumbnail says **Preview unavailable**.
4. **Text Styles** has five tabs: **Reading Body**, **Reading Reference & Passage**, **Text**, **Hymn**, and **Prayer**. A slide preview shows the selected text area. **Font** sets the type style for that tab. **Use global font** uses the primary font. The section title uses the scripture reference font when its font is **Use global font**. **Window Position** moves that text area. Font, size, bold, and italic are separate for Text, Hymn, and Prayer. The other Text, Hymn, and Prayer settings are shared. On **Reading Reference & Passage**, **Vertical alignment** can be **Top**, **Middle**, or **Bottom**. The reference tab also sets the section title, such as First Reading. It can show the slide number, the reading label, and the spoken ending. The spoken ending is its own slide. The text is `The Word of the Lord.` or `The Gospel of the Lord.`

Most changes apply as you edit. **Apply Changes & Close** saves the changes and closes the dialog.

**🎨 Select Theme** opens the theme list. It does not change the projector text.

Each theme is a choice in that list. The Arrow keys move between the choices.
They do not save a theme. Press Enter or click a choice to save that theme.
The status line shows `Theme saved.`

If the save fails, the status line shows the error. The list then shows the
theme saved on the server. If that read fails, the list shows Carmel Light.

The same dialog has a **System Settings** section. That section sets the network address and the source-network allowlist.

1. **Use this address for remote and screen links.** Choose **Default route** or one IPv4 address of this computer. When no address is saved, the list shows **Default route**. An address that is not on this computer is rejected. The error is `The selected network address is not available.`
2. **Allow client addresses and networks.** The field shows the list that is already in use. The standard list is `10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16`. A phone on a network in the field can connect. This computer can still connect. Clear the field to allow every address. You can also enter IPv4 or IPv6 addresses and CIDR networks, separated by commas. The saved list must include this computer's address. A bad list shows `The source-network allowlist must be text.`, `Invalid source network: <entry>.`, or `The source-network allowlist must include the local operator address.` The message appears under the field. The previous list stays in use.

The server validates and clamps these settings. A change that affects reading layout re-paginates the reading slides.

## Start Time and Phases

Set the Mass start time in the Digital Minister UI (or when creating the Mass).
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
When Pre-Mass or Post-Mass is running, the next automatic advance stays in that phase.
A countdown end, a movie end, and the movie timer use that rule.

## Blackout and Manual Navigation

The Digital Minister page does not show Prev, Next, or Black Screen buttons. The keys in [Keyboard](#keyboard) do not run while a control has focus.

- Press `Right Arrow` or `Space` to show the next slide.
- Press `Left Arrow` to show the previous slide.
- Press `B` to hide the projector output. Press `B` again to show it. The selected slide does not change. A movie keeps playing. Blackout mutes it, and the next press restores the previous volume.
- **⏭ Go to Mass Start** jumps to the first Mass slide. The button is shown when the Mass has a Mass slide.

## For Digital Ministers: the phone remote

Give the Digital Lecturer the phone link and the PIN before Mass.
The lecturer steps are on the [phone remote](phone-remote.md) page.

1. Select **PIN**.
2. The dialog title is **Start PIN**.
3. Type a PIN of 4 to 6 digits in **PIN Code**.
4. Select **Set PIN**.
5. The dialog shows **PIN set**.

To change the PIN, type the current PIN in **Current PIN**, type the new PIN, and select **Set PIN**.
Other phones show **The PIN changed. Unlock again.**

To remove the PIN, type the current PIN and select **Clear PIN**.
The dialog shows **PIN cleared**.
Phones no longer need the PIN.

If the PIN is too short, the dialog shows **PIN must be 4–6 digits**.
If the current PIN is missing, the dialog shows **Current PIN is required.**
If clear fails, the dialog shows **Could not clear the PIN.**

Before Mass starts, the projector can show **Scan to begin** and a QR code.
The Digital Lecturer can scan that code.
Ask the administrator if the phone cannot open the link.
Network setup is in [Troubleshooting](troubleshooting.md#a-device-gets-source-network-not-allowed).

## Mass Library

**📚 Mass Library** lists archived Masses with their title, start time, size,
and storage type. From here you can **Load**, **Compress** (convert a folder
package to an AVIF-optimized ZIP), or **Delete** an archive. A converted
image is stored only as the AVIF file. The app checks the ZIP before it
removes the folder. If the check fails, the folder stays. The active Mass is
listed first.

**Load** asks you to confirm before it replaces the current Mass. **Cancel**
leaves the current Mass in place. When Pre-Mass, Gathering, or Post-Mass is
running, the dialog says that the projector will change. It says the same
thing when the start time is less than two hours away, including a start time
that has already passed.

## Export and Import

- **↩︎ Import** loads a Mass or settings ZIP/JSON. A Mass ZIP asks for the same replacement confirmation as **Load**.
- **↪︎ Export** downloads the current Mass as a ZIP.
- **Export AVIF** converts eligible images to AVIF and downloads an optimized
  ZIP.
- **📄 Export PDF** produces a full-deck PDF in the desktop app. Each page shows that slide with blackout off, with no countdown end time, and with the interstitial hold cleared.
- **Export Slide to PDF** exports the current slide preview in the desktop app.

A Mass ZIP can contain these media types: `jpg`, `jpeg`, `png`, `gif`, `webp`, `svg`, `avif`, and `mp4`.
If an uploaded file name contains a backtick, Sacra Lux removes the backtick.

The program rejects a ZIP that is too large. You see one of these messages:

- `Mass ZIP compressed size exceeds the 209715200 byte limit.`
- `Mass ZIP contains too many entries; the limit is 1000.`
- `Mass ZIP entry "<name>" exceeds the 146800640 byte limit.`
- `Mass ZIP uncompressed size exceeds the 524288000 byte limit.`
- `Media file exceeds the 140 MB limit.`

Choose a smaller file. The current Mass stays in place.
A slideshow can contain at most 500 images.
If you add more, you see `A slideshow can contain at most 500 images.`
If the images are too large together, you see `The selected images are too large to import together.`
Together, the images must be 120 MiB (125829120 bytes) or smaller.

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
A `---` page break keeps the selected psalm refrain.
A refrain line after that break still shows the selected refrain.

## Keyboard

These keys work when focus is not in a text field, a select list, a button, a link, a summary, or an open dialog. They also do not run when the focused control has role `button`, `link`, `checkbox`, `radio`, `switch`, `tab`, or `menuitem`.

| Key | Result |
| --- | --- |
| `Right Arrow` or `Space` | Show the next slide. |
| `Left Arrow` | Show the previous slide. |
| `Up Arrow` / `Down Arrow` | Move the organizer selection by one row. |
| `Page Up` / `Page Down` | Move the organizer selection by five rows. |
| `E` or `Enter` | Open the selected slide in the editor. |
| `B` | Hide or show the projector output. |

## Save the Mass

1. Open the **File** menu.
2. Select **Save**.
3. When the Mass is saved, the status line shows **Mass saved**.
4. When no Mass is loaded, the status line shows **No Mass is loaded.**
5. When the session cannot be saved, the status line shows **Could not save session.json.**
6. When another error occurs, the status line shows the error text. If there is no error text, it shows **Could not save the Mass.**

When you close Sacra Lux, a save that is still waiting is written.
If a later save fails, the status line shows the error instead of the slide count.
A successful save clears that error.

Select **📁 Open Mass Folder** to open the current Mass folder.

The administrator keeps the Mass files.
An upgrade keeps those files.
The steps are on the [macOS install](install-macos.md#upgrade) page and the [Windows install](install-windows.md#upgrade) page.
