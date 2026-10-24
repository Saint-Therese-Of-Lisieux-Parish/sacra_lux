# Release Verification

Each release ZIP has a signed build provenance attestation. The attestation
shows that the ZIP came from this repository and from the `Release` workflow.

The `attest` job in `.github/workflows/release.yml` creates the attestation.
The `release` job needs the `attest` job. If the attestation fails, the
workflow does not publish the release.

## Verify a ZIP

Install the [GitHub CLI](https://cli.github.com/). Download a ZIP from the
release page. Then run:

```bash
gh attestation verify Sacra-Lux-<version>-<platform>.zip \
  --repo Saint-Therese-Of-Lisieux-Parish/sacra_lux
```

The command succeeds only if the ZIP matches an attestation from this
repository.

## Scope

- The attestation does not replace code signing or notarization.
- `SHA256SUMS.txt` checks file integrity only.
