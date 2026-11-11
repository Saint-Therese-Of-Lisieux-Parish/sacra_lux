# Dependency security review

Run `npm audit --audit-level=high` from the `sacra-lux` directory to review the production and development dependency tree.

The audit on November 10, 2026, reported no high or critical vulnerabilities. It reported moderate advisories in transitive development dependencies:

- `deepmerge`: GHSA-gcqx-w48m-w2h4.
- `glob`: GHSA-3g3m-2fjr-6pw4.
- `minimatch`: GHSA-g3hv-75wg-m249.

The audit offered fixes that downgrade Jest, HTMLHint, and Stryker across major versions. This change does not apply those breaking changes because they would replace the supported test toolchain without an issue-specific compatibility review.

Re-run the audit after dependency updates. Update this file when the advisory set or the compatibility decision changes.
