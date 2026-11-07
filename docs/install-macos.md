# Install on macOS

This page is for the administrator.
It installs Sacra Lux on a Mac.

## Supported versions

The release has two Mac files.

- Apple silicon. The file name contains `mac-arm64`.
- Intel. The file name contains `mac-x64`.

The repository does not state a minimum macOS version.
Electron 45.2.1 states the version in the [Electron platform support note](https://github.com/electron/electron/blob/v45.2.1/README.md#platform-support).
That note says macOS Ventura and later.

## Choose the right file

1. Open the Apple menu.
2. Choose **About This Mac**.
3. Read **Chip** or **Processor**.

**Chip** means Apple silicon. Download the `mac-arm64` files.
**Processor** means Intel. Download the `mac-x64` files.

Apple explains this window on [Find your Mac model name and serial number](https://support.apple.com/en-us/102767).

| Processor | Files |
| --- | --- |
| Apple silicon | `Sacra-Lux-<version>-mac-arm64.dmg` and `Sacra-Lux-<version>-mac-arm64.zip` |
| Intel | `Sacra-Lux-<version>-mac-x64.dmg` and `Sacra-Lux-<version>-mac-x64.zip` |

Use the DMG file for a normal install.
The ZIP file contains the same `Sacra Lux.app` application.
`<version>` is the version in the release name.

## Download

1. Open [Sacra Lux releases](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/releases).
2. Open the newest release at the top of the list.
3. Download the DMG file for your Mac.
4. Download `SHA256SUMS.txt` from the same release.

A release version that contains a hyphen is a prerelease.
Do not open `/releases/latest`. A prerelease does not appear there.

## Check the download

1. Open Terminal.
2. Go to the folder that contains the download. You can type `cd ` and then drag the folder onto the Terminal window.
3. Run the command below. Replace the file name with the file you downloaded.

```sh
shasum -a 256 Sacra-Lux-<version>-mac-arm64.dmg
```

4. Open `SHA256SUMS.txt`.
5. Find the line for the same file name.
6. Compare the first group of characters with the command result.

A match means those characters are the same.
Letter case does not matter.
The name in `SHA256SUMS.txt` can start with `./`.
Compare the hash, not the whole line.

The developer page for build provenance is [release verification](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/blob/master/docs/release-verification.md).

## Install

The disk image is signed and notarized.
The application inside it is signed and notarized.

### DMG file

1. Open the DMG file.
2. A window named **Sacra Lux** opens.
3. Drag **Sacra Lux** onto **Applications**.
4. Eject the disk image.
5. Open **Sacra Lux** from the Applications folder.

### ZIP file

Use this file when you do not use the DMG file.

1. Double-click the ZIP file.
2. macOS extracts `Sacra Lux.app`.
3. Drag `Sacra Lux.app` into the Applications folder.
4. Open **Sacra Lux**.

Apple explains ZIP files on [Zip and unzip files and folders on Mac](https://support.apple.com/guide/mac-help/zip-and-unzip-files-and-folders-on-mac-mchlp2528/mac).

## First start

1. A splash window shows the version and the date.
2. The **Sacra Lux** window then opens.
3. When no Mass is loaded and a saved Mass exists, the **Mass Library** window opens.
4. When no Mass is loaded and no saved Mass exists, the **Create New Mass** window opens.

macOS can ask you to confirm an app that you downloaded.
The release files are signed and notarized.
Apple explains the prompt on [Open a Mac app from an unidentified developer](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac).

Sacra Lux listens on port **17841** on every network interface.
macOS can ask you to allow incoming connections.
Apple explains the firewall on [Block connections to your Mac with a firewall](https://support.apple.com/guide/mac-help/block-connections-to-your-mac-with-a-firewall-mh34041/mac).
Allow **Sacra Lux** when you want phones to open the remote.

A second open does not start a second copy.
macOS shows the window that is already open.

## Upgrade

Sacra Lux keeps Masses and the session in the `.sacra-lux` folder in the home folder.
An upgrade keeps that folder.

Caution: do not delete the `.sacra-lux` folder during an upgrade. That folder holds the Masses.

1. Copy the `.sacra-lux` folder to a safe place.
2. Install the newer release with the steps above.
3. Replace the application in the Applications folder when macOS asks.

Open Sacra Lux. The saved Mass is still available.

## Remove

1. Quit Sacra Lux.
2. Move **Sacra Lux** from Applications to the Trash.

The `.sacra-lux` folder stays in the home folder.

Caution: the next step deletes the Masses and the session.

1. Delete the `.sacra-lux` folder only when you want to remove the data.

## Troubleshooting

If port 17841 is already in use, a dialog title **Sacra Lux could not start** appears.
The message is `Port <port> is already in use.`
The app then quits.

1. Quit the other program that uses the port.
2. Open Sacra Lux again.

To report a fault, open a [GitHub issue](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/issues).
Do not put passwords or PIN values in the issue.

## Next steps

- The Digital Minister prepares the Mass in the [user guide](user-guide.md).
- Screen setup is in [Screen Settings](user-guide.md#screen-settings).
- The Digital Lecturer uses the [phone remote](phone-remote.md).
- Network faults are in [Troubleshooting](troubleshooting.md#a-device-gets-source-network-not-allowed).
