# Supported platforms

This page is for the administrator.
It lists the computers that a Sacra Lux release can run on.
Install steps for each operating system are on the linked pages.

The repository does not state a minimum operating system version.
Electron 45.2.1 states the versions in the [Electron platform support note](https://github.com/electron/electron/blob/v45.2.1/README.md#platform-support).
That note says macOS Ventura and later, and Windows 10 and later.

A release version that contains a hyphen is a prerelease.
Open the release list at [Sacra Lux releases](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/releases).
Use the newest release at the top of the list.
Do not use a `/releases/latest` link. A prerelease does not appear there.

| Operating system | Processor | Release files | Signed | Notarized | Install |
| --- | --- | --- | --- | --- | --- |
| macOS | Apple silicon (arm64) | `Sacra-Lux-<version>-mac-arm64.zip` and `Sacra-Lux-<version>-mac-arm64.dmg` | Yes | Yes | [macOS](install-macos.md) |
| macOS | Intel (x64) | `Sacra-Lux-<version>-mac-x64.zip` and `Sacra-Lux-<version>-mac-x64.dmg` | Yes | Yes | [macOS](install-macos.md) |
| Windows | 64-bit x64 | `Sacra-Lux-<version>-win-x64.zip` | No | No | [Windows](install-windows.md) |

`<version>` is the version in the release name.
The same release also includes `SHA256SUMS.txt`.
Each ZIP has SBOM and scan reports. Those files are for a developer.
The check steps are in the [release verification](https://github.com/Saint-Therese-Of-Lisieux-Parish/sacra_lux/blob/master/docs/release-verification.md) page.

The release has no file for a Windows ARM processor.
If the Windows system type is not a 64-bit x64 processor, do not install the Windows ZIP.

After you install, the Digital Minister prepares the Mass.
The steps are in the [user guide](user-guide.md).
The Digital Lecturer uses the [phone remote](phone-remote.md).
