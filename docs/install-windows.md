# Install on Windows

This page is for the administrator.
It installs Sacra Lux on Windows.

## Supported versions

The release has one Windows file.
The processor type is 64-bit x64.
The file name contains `win-x64`.

The repository does not state a minimum Windows version.
Electron 45.2.1 states the version in the [Electron platform support note](https://github.com/electron/electron/blob/v45.2.1/README.md#platform-support).
That note says Windows 10 and later.

The release has no file for a Windows ARM processor.
Do not install this ZIP on an ARM PC.

## Choose the right file

1. Select **Start**.
2. Select **Settings**.
3. Select **System**, then **About**.
4. Read **System type** under **Device specifications**.

Download the Windows file only when the system type is a 64-bit x64 processor.
Microsoft explains this page on [32-bit and 64-bit Windows: Frequently asked questions](https://support.microsoft.com/en-us/windows/32-bit-and-64-bit-windows-frequently-asked-questions-c6ca9541-8dce-4d48-0415-94a3faa2e13d).

| Processor | File |
| --- | --- |
| 64-bit x64 | `Sacra-Lux-<version>-win-x64.zip` |

`<version>` is the version in the release name.
The file is not signed.
Windows does not notarize this file.

## Download

1. Open [Sacra Lux releases](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/releases).
2. Open the newest release at the top of the list.
3. Download `Sacra-Lux-<version>-win-x64.zip`.
4. Download `SHA256SUMS.txt` from the same release.

A release version that contains a hyphen is a prerelease.
Do not open `/releases/latest`. A prerelease does not appear there.

## Check the download

1. Open PowerShell.
2. Go to the folder that contains the download.
3. Run the command below. Replace the file name with the file you downloaded.

```powershell
Get-FileHash -Path .\Sacra-Lux-<version>-win-x64.zip -Algorithm SHA256
```

4. Open `SHA256SUMS.txt`.
5. Find the line for the same file name.
6. Compare the **Hash** value with the first group of characters on that line.

A match means those characters are the same.
Letter case does not matter.
The name in `SHA256SUMS.txt` can start with `./`.
Compare the hash, not the whole line.

The developer page for build provenance is [release verification](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/blob/master/docs/release-verification.md).

## Install

The Windows ZIP is not an installer.
You extract it and run the program.

1. Extract the ZIP file.
2. Open `Sacra Lux.exe` from the extracted files.

Microsoft explains ZIP files on [Zip and unzip files](https://support.microsoft.com/en-us/windows/zip-and-unzip-files).

## First start

1. A splash window shows the version and the date.
2. The **Sacra Lux** window then opens.
3. When no Mass is loaded and a saved Mass exists, the **Mass Library** window opens.
4. When no Mass is loaded and no saved Mass exists, the **Create New Mass** window opens.

Windows can show a security warning because the file is not signed.
Microsoft explains the checks on [App & browser control in the Windows Security App](https://support.microsoft.com/en-us/windows/app-browser-control-in-the-windows-security-app).
If Windows blocks the program, read [Smart App Control Frequently Asked Questions](https://support.microsoft.com/en-us/windows/smart-app-control-frequently-asked-questions-285ea03d-fa88-4d56-882e-6698afdb7003).

Sacra Lux listens on port **17841** on every network interface.
Windows can ask you to allow the program through the firewall.
Microsoft explains that choice on [Risks of allowing apps through Windows Firewall](https://support.microsoft.com/en-us/windows/risks-of-allowing-apps-through-windows-firewall-654559af-3f54-3dcf-349f-71ccd90bcc5c).
Allow **Sacra Lux** when you want phones to open the remote.

A second open does not start a second copy.
Windows shows the window that is already open.

When you close the window, Windows can ask **Quit Sacra Lux?**
The message is **Do you want to quit Sacra Lux and close the projector?**
Select **Quit Sacra Lux** to quit.
Select **Keep Open** to leave the program open.

## Upgrade

Sacra Lux keeps Masses and the session in the `.sacra-lux` folder in the home folder.
The home folder is the user profile folder.
An upgrade keeps that folder.

Caution: do not delete the `.sacra-lux` folder during an upgrade. That folder holds the Masses.

1. Quit Sacra Lux. Select **Quit Sacra Lux** when Windows asks.
2. Copy the `.sacra-lux` folder to a safe place.
3. Extract the newer ZIP into a new folder.
4. Open `Sacra Lux.exe` in the new folder.

The saved Mass is still available.

## Remove

1. Quit Sacra Lux.
2. Delete the extracted program folder.

The `.sacra-lux` folder stays in the home folder.

Caution: the next step deletes the Masses and the session.

1. Delete the `.sacra-lux` folder only when you want to remove the data.

## Troubleshooting

If port 17841 is already in use, a dialog title **Sacra Lux could not start** appears.
The message is `Port <port> is already in use.`
The app then quits.

1. Quit the other program that uses the port.
2. Open `Sacra Lux.exe` again.

To report a fault, open a [GitHub issue](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/issues).
Do not put passwords or PIN values in the issue.

## Next steps

- The Digital Minister prepares the Mass in the [user guide](user-guide.md).
- Screen setup is in [Screen Settings](user-guide.md#screen-settings).
- The Digital Lecturer uses the [phone remote](phone-remote.md).
- Network faults are in [Troubleshooting](troubleshooting.md#a-device-gets-source-network-not-allowed).
