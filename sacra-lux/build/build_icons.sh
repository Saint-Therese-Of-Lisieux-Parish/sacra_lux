#!/bin/bash
set -euo pipefail

# --- Configuration ---
SOURCE_IMAGE="SacraLux-Logo.png"
ICON_NAME="icon"
ICONSET_DIR="${ICON_NAME}.iconset"
OUTPUT_ICNS="${ICON_NAME}.icns"
OUTPUT_ICO="${ICON_NAME}.ico"
OUTPUT_PNG="${ICON_NAME}.png"
SPLASH_PNG="icon-splash.png"
LEGACY_ICONSET_DIR="SacraLux.iconset"
LEGACY_ICNS="icons.icns"
LEGACY_PNGS=("Sacra-Lux.png" "sacralux-1024.png")

# Standard macOS icon sizes (the @2x variant is automatically generated at 2x)
SIZES=(16 32 128 256 512)

# --- Validation ---
if [[ ! -f "$SOURCE_IMAGE" ]]; then
  echo "Error: Source image '$SOURCE_IMAGE' not found." >&2
  exit 1
fi

if ! command -v magick >/dev/null 2>&1; then
  echo "Error: ImageMagick ('magick') is required to generate transparent, contained icon assets." >&2
  exit 1
fi

if ! command -v tiff2icns >/dev/null 2>&1; then
  echo "Error: tiff2icns is required to generate the macOS icon." >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

create_contained_png() {
  local width="$1"
  local height="$2"
  local output="$3"

  magick "$SOURCE_IMAGE" \
    -resize "${width}x${height}" \
    -background none \
    -gravity center \
    -extent "${width}x${height}" \
    "PNG32:${output}"
}

# --- Create app and splash PNGs without cropping the wordmark ---
create_contained_png 1024 1024 "$OUTPUT_PNG"
create_contained_png 407 240 "$SPLASH_PNG"
for legacy_png in "${LEGACY_PNGS[@]}"; do
  cp "$OUTPUT_PNG" "$legacy_png"
done
echo "Created $OUTPUT_PNG and $SPLASH_PNG from $SOURCE_IMAGE"

# --- Build iconset ---
rm -rf "$ICONSET_DIR"
mkdir "$ICONSET_DIR"

for size in "${SIZES[@]}"; do
  retina=$((size * 2))
  create_contained_png "$size" "$size" "${ICONSET_DIR}/icon_${size}x${size}.png"
  create_contained_png "$retina" "$retina" "${ICONSET_DIR}/icon_${size}x${size}@2x.png"
done

# --- Generate .icns (macOS) ---
# iconutil rejects the valid PNG iconset on some macOS versions. tiff2icns
# accepts the same size set and produces a portable .icns file.
magick \
  "${ICONSET_DIR}/icon_16x16.png" \
  "${ICONSET_DIR}/icon_32x32.png" \
  "${ICONSET_DIR}/icon_128x128.png" \
  "${ICONSET_DIR}/icon_256x256.png" \
  "${ICONSET_DIR}/icon_512x512.png" \
  "${ICONSET_DIR}/icon_512x512@2x.png" \
  "$TEMP_DIR/icon-sources.tiff"
tiff2icns "$TEMP_DIR/icon-sources.tiff" "$OUTPUT_ICNS"
echo "Created $OUTPUT_ICNS from $SOURCE_IMAGE"

# Keep older tracked macOS icon names synchronized with the canonical set.
rm -rf "$LEGACY_ICONSET_DIR"
cp -R "$ICONSET_DIR" "$LEGACY_ICONSET_DIR"
cp "$OUTPUT_ICNS" "$LEGACY_ICNS"

# --- Generate .ico (Windows) ---
ICO_SIZES=(16 32 48 128 256)
ICO_INPUTS=()
for size in "${ICO_SIZES[@]}"; do
  out="$TEMP_DIR/ico_${size}.png"
  create_contained_png "$size" "$size" "$out"
  ICO_INPUTS+=("$out")
done

magick "${ICO_INPUTS[@]}" "$OUTPUT_ICO"
echo "Created $OUTPUT_ICO from $SOURCE_IMAGE"
