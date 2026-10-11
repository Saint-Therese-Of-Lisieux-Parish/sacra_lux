#!/bin/bash
set -euo pipefail

# --- Configuration ---
LOGO_SOURCE_IMAGE="SacraLux-Logo.png"
ICON_SOURCE_IMAGE="SacraLux-Icon.png"
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
if [[ ! -f "$LOGO_SOURCE_IMAGE" ]]; then
  echo "Error: Logo source image '$LOGO_SOURCE_IMAGE' not found." >&2
  exit 1
fi

if [[ ! -f "$ICON_SOURCE_IMAGE" ]]; then
  echo "Error: Icon source image '$ICON_SOURCE_IMAGE' not found." >&2
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
  local source="$1"
  local width="$2"
  local height="$3"
  local output="$4"

  magick "$source" \
    -resize "${width}x${height}" \
    -background none \
    -gravity center \
    -extent "${width}x${height}" \
    "PNG32:${output}"
}

create_splash_png() {
  local source="$1"
  local output="$2"

  # The source wordmark has a tall aspect ratio. Trim its transparent canvas
  # before scaling so the visible logo, rather than invisible padding, fills
  # the native splash card.
  magick "$source" \
    -trim +repage \
    -filter Lanczos \
    -resize "360x260>" \
    -background none \
    -gravity center \
    -extent 360x260 \
    "PNG32:${output}"
}

# macOS Tahoe draws a light rounded plate behind an icon when any edge pixel
# has alpha of 252 or less, and a plain zoom cuts off this mark's gold frame.
# Scale the solid artwork until it meets the canvas, flatten the outside
# corners onto the icon's navy, and force every pixel to opaque. The system
# then clips the complete frame to the icon shape.
create_macos_icon_png() {
  local source="$1"
  local width="$2"
  local height="$3"
  local output="$4"
  local fitted="$TEMP_DIR/macos-fitted-${width}x${height}.png"
  local scaled="$fitted"

  magick "$source" \
    -filter Lanczos \
    -resize "${width}x${height}" \
    -background none \
    -gravity center \
    -extent "${width}x${height}" \
    -channel A -threshold 50% +channel \
    "PNG32:${fitted}"

  local geometry box_w box_h box_x box_y rest
  geometry=$(magick "$fitted" -format "%@" info:)
  box_w=${geometry%%x*}
  rest=${geometry#*x}
  box_h=${rest%%+*}
  rest=${rest#*+}
  box_x=${rest%%+*}
  box_y=${rest#*+}

  local inset_left=$box_x
  local inset_top=$box_y
  local inset_right=$((width - box_x - box_w))
  local inset_bottom=$((height - box_y - box_h))
  local max_inset=$inset_left
  local inset
  for inset in "$inset_top" "$inset_right" "$inset_bottom"; do
    if ((inset > max_inset)); then
      max_inset=$inset
    fi
  done

  if ((max_inset > 0 && width > max_inset * 2)); then
    local percent
    percent=$(awk -v w="$width" -v i="$max_inset" 'BEGIN { printf "%.4f", (w / (w - 2 * i)) * 100 }')
    scaled="$TEMP_DIR/macos-scaled-${width}x${height}.png"
    magick "$fitted" \
      -filter Lanczos \
      -resize "${percent}%" \
      -gravity center \
      -background none \
      -crop "${width}x${height}+0+0" +repage \
      "PNG32:${scaled}"
  fi

  magick "$scaled" \
    -background "#041648" \
    -alpha remove \
    -alpha off \
    -type TrueColorAlpha \
    -channel A -evaluate set 100% +channel \
    "PNG32:${output}"
}

# --- Create app icons from the square mark and splash image from the wordmark ---
create_contained_png "$ICON_SOURCE_IMAGE" 1024 1024 "$OUTPUT_PNG"
create_splash_png "$LOGO_SOURCE_IMAGE" "$SPLASH_PNG"
for legacy_png in "${LEGACY_PNGS[@]}"; do
  cp "$OUTPUT_PNG" "$legacy_png"
done
echo "Created $OUTPUT_PNG from $ICON_SOURCE_IMAGE and $SPLASH_PNG from $LOGO_SOURCE_IMAGE"

# --- Build iconset ---
rm -rf "$ICONSET_DIR"
mkdir "$ICONSET_DIR"

for size in "${SIZES[@]}"; do
  retina=$((size * 2))
  create_macos_icon_png "$ICON_SOURCE_IMAGE" "$size" "$size" "${ICONSET_DIR}/icon_${size}x${size}.png"
  create_macos_icon_png "$ICON_SOURCE_IMAGE" "$retina" "$retina" "${ICONSET_DIR}/icon_${size}x${size}@2x.png"
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
echo "Created $OUTPUT_ICNS from $ICON_SOURCE_IMAGE"

# Keep older tracked macOS icon names synchronized with the canonical set.
rm -rf "$LEGACY_ICONSET_DIR"
cp -R "$ICONSET_DIR" "$LEGACY_ICONSET_DIR"
cp "$OUTPUT_ICNS" "$LEGACY_ICNS"

# --- Generate .ico (Windows) ---
ICO_SIZES=(16 32 48 128 256)
ICO_INPUTS=()
for size in "${ICO_SIZES[@]}"; do
  out="$TEMP_DIR/ico_${size}.png"
  create_contained_png "$ICON_SOURCE_IMAGE" "$size" "$size" "$out"
  ICO_INPUTS+=("$out")
done

magick "${ICO_INPUTS[@]}" "$OUTPUT_ICO"
echo "Created $OUTPUT_ICO from $ICON_SOURCE_IMAGE"
