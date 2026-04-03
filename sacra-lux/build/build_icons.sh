#!/bin/bash
set -euo pipefail

# --- Configuration ---
SOURCE_IMAGE="sacralux-1024.png"
ICON_NAME="icon"
ICONSET_DIR="${ICON_NAME}.iconset"
OUTPUT_ICNS="${ICON_NAME}.icns"
OUTPUT_ICO="${ICON_NAME}.ico"
OUTPUT_PNG="${ICON_NAME}.png"

# Standard macOS icon sizes (the @2x variant is automatically generated at 2x)
SIZES=(16 32 128 256 512)

# --- Validation ---
if [[ ! -f "$SOURCE_IMAGE" ]]; then
  echo "Error: Source image '$SOURCE_IMAGE' not found." >&2
  exit 1
fi

# --- Copy source as icon.png ---
cp "$SOURCE_IMAGE" "$OUTPUT_PNG"
echo "Created $OUTPUT_PNG from $SOURCE_IMAGE"

# --- Build iconset ---
rm -rf "$ICONSET_DIR"
mkdir "$ICONSET_DIR"

for size in "${SIZES[@]}"; do
  retina=$((size * 2))
  sips -z "$size" "$size" "$SOURCE_IMAGE" --out "${ICONSET_DIR}/icon_${size}x${size}.png"
  sips -z "$retina" "$retina" "$SOURCE_IMAGE" --out "${ICONSET_DIR}/icon_${size}x${size}@2x.png"
done

# --- Generate .icns (macOS) ---
iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_ICNS"
echo "Created $OUTPUT_ICNS from $SOURCE_IMAGE"

# --- Generate .ico (Windows) ---
ICO_SIZES=(16 32 48 128)
ICO_INPUTS=()
for size in "${ICO_SIZES[@]}"; do
  out="/tmp/ico_${size}.png"
  sips -z "$size" "$size" "$SOURCE_IMAGE" --out "$out" >/dev/null
  ICO_INPUTS+=("$out")
done

if command -v png2ico >/dev/null 2>&1; then
  png2ico "$OUTPUT_ICO" "${ICO_INPUTS[@]}"
  echo "Created $OUTPUT_ICO from $SOURCE_IMAGE"
else
  echo "Warning: png2ico not found — skipping .ico generation (install with: brew install png2ico)" >&2
fi
