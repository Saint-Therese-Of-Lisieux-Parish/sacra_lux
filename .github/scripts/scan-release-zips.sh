#!/usr/bin/env bash
# Scan each Electron release ZIP with Syft and Grype.
# Usage: scan-release-zips.sh <zip-dir> <report-dir>
# Syft does not read app.asar. This script extracts app.asar first.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: scan-release-zips.sh <zip-dir> <report-dir>" >&2
  exit 2
fi

zip_dir="$1"
report_dir="$2"
asar_bin="${ASAR:-asar}"

mkdir -p "$report_dir"

shopt -s nullglob
zips=("$zip_dir"/*.zip)
if [ "${#zips[@]}" -eq 0 ]; then
  echo "::error::No platform ZIP file found in ${zip_dir}." >&2
  exit 1
fi

for tool in unzip "$asar_bin" syft grype; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "::error::Required command not found: ${tool}" >&2
    exit 1
  fi
done

work_root="$(mktemp -d)"
trap 'rm -rf "$work_root"' EXIT

failed=0

for zip_path in "${zips[@]}"; do
  base="$(basename "$zip_path" .zip)"
  scan_dir="${work_root}/${base}"
  mkdir -p "$scan_dir"
  echo "Scanning ${base}"

  if ! unzip -q "$zip_path" -d "$scan_dir"; then
    echo "::error::unzip failed for ${base}." >&2
    failed=1
    continue
  fi

  asar_files=()
  while IFS= read -r -d '' asar_path; do
    asar_files+=("$asar_path")
  done < <(find "$scan_dir" -type f -name "app.asar" -print0)

  if [ "${#asar_files[@]}" -eq 0 ]; then
    echo "::error::No app.asar file found in ${base}." >&2
    failed=1
    continue
  fi

  extract_failed=0
  for asar_path in "${asar_files[@]}"; do
    if ! "$asar_bin" extract "$asar_path" "${asar_path}.extracted"; then
      echo "::error::asar extract failed for ${base}." >&2
      extract_failed=1
    fi
  done
  if [ "$extract_failed" -ne 0 ]; then
    failed=1
    continue
  fi

  spdx="${report_dir}/${base}.spdx.json"
  cdx="${report_dir}/${base}.cdx.json"
  if ! syft "dir:${scan_dir}" \
    -o "spdx-json=${spdx}" \
    -o "cyclonedx-json=${cdx}"; then
    echo "::error::Syft failed for ${base}." >&2
    failed=1
    continue
  fi

  if [ ! -s "$spdx" ] || [ ! -s "$cdx" ]; then
    echo "::error::Syft did not write both SBOM files for ${base}." >&2
    failed=1
    continue
  fi

  grype_json="${report_dir}/${base}.grype.json"
  grype_sarif="${report_dir}/${base}.grype.sarif"
  if ! grype "sbom:${spdx}" --fail-on high \
    -o table \
    -o "json=${grype_json}" \
    -o "sarif=${grype_sarif}"; then
    echo "::error::Grype failed for ${base}." >&2
    failed=1
    continue
  fi
done

exit "$failed"
