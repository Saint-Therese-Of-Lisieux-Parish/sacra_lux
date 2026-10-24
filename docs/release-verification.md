# Release Verification

Each release ZIP and DMG has a signed build provenance attestation. The
attestation shows that the file came from this repository and the `Release`
workflow.

The `attest` job in `.github/workflows/release.yml` creates the attestation.
The `release` job needs the `attest` job. If the attestation fails, the
workflow does not publish the release.

## Release files

The macOS ARM64 files are:

- `Sacra-Lux-<version>-mac-arm64.zip`
- `Sacra-Lux-<version>-mac-arm64.dmg`

The macOS Intel files are:

- `Sacra-Lux-<version>-mac-x64.zip`
- `Sacra-Lux-<version>-mac-x64.dmg`

The Windows Intel file is `Sacra-Lux-<version>-win-x64.zip`.

## Verify build provenance

Install the [GitHub CLI](https://cli.github.com/). Download a release file.
Then run:

```bash
gh attestation verify Sacra-Lux-<version>-<platform>.<zip-or-dmg> \
  --repo Saint-Therese-Of-Lisieux-Parish/sacra_lux
```

The command succeeds only if the file matches an attestation from this
repository.

## Verify a macOS DMG

Mount the DMG. Replace `<volume-path>` with the mounted `Sacra Lux` volume.
Then run:

```bash
hdiutil verify Sacra-Lux-<version>-<mac-platform>.dmg
codesign --verify --deep --strict --verbose=2 \
  "<volume-path>/Sacra Lux.app"
spctl --assess --type execute --verbose=4 \
  "<volume-path>/Sacra Lux.app"
xcrun stapler validate "<volume-path>/Sacra Lux.app"
```

All four commands must succeed. The `spctl` output must identify a notarized
Developer ID application.

## Scope

- The attestation does not replace code signing or notarization.
- `SHA256SUMS.txt` checks file integrity only.
