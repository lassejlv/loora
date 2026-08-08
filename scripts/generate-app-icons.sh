#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSET_DIR="$PROJECT_DIR/crates/desktop/assets"
SOURCE_ICON="$ASSET_DIR/app-icon-source.png"
MASTER_ICON="$ASSET_DIR/app-icon.png"
MACOS_DIR="$ASSET_DIR/macos"
WINDOWS_DIR="$ASSET_DIR/windows"
LINUX_DIR="$ASSET_DIR/linux/hicolor"
MASTER_SIZE=1024
ICON_BODY_SIZE=840
ICON_CORNER_RADIUS=185

command -v magick >/dev/null || {
  echo "ImageMagick is required (missing: magick)" >&2
  exit 1
}
command -v python3 >/dev/null || {
  echo "Python 3 is required to package the ICNS container" >&2
  exit 1
}
command -v sips >/dev/null || {
  echo "macOS sips is required" >&2
  exit 1
}

mkdir -p "$MACOS_DIR" "$WINDOWS_DIR"

ICON_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/loora-icons.XXXXXX")"
trap 'rm -rf "$ICON_WORK_DIR"' EXIT
ICONSET_DIR="$ICON_WORK_DIR/Loora.iconset"
mkdir -p "$ICONSET_DIR"

BODY_ICON="$ICON_WORK_DIR/body.png"
BODY_MASK="$ICON_WORK_DIR/body-mask.png"
ROUNDED_ICON="$ICON_WORK_DIR/body-rounded.png"
BODY_LAST_PIXEL=$((ICON_BODY_SIZE - 1))

magick "$SOURCE_ICON" \
  -filter Lanczos \
  -resize "${ICON_BODY_SIZE}x${ICON_BODY_SIZE}!" \
  "$BODY_ICON"
magick -size "${ICON_BODY_SIZE}x${ICON_BODY_SIZE}" \
  xc:none \
  -fill white \
  -draw "roundrectangle 0,0 ${BODY_LAST_PIXEL},${BODY_LAST_PIXEL} ${ICON_CORNER_RADIUS},${ICON_CORNER_RADIUS}" \
  "$BODY_MASK"
magick "$BODY_ICON" "$BODY_MASK" \
  -alpha off \
  -compose CopyOpacity \
  -composite \
  "$ROUNDED_ICON"
magick -size "${MASTER_SIZE}x${MASTER_SIZE}" \
  xc:none \
  "$ROUNDED_ICON" \
  -gravity center \
  -compose over \
  -composite \
  "$MASTER_ICON"

render_png() {
  local size="$1"
  local output="$2"
  magick "$MASTER_ICON" -filter Lanczos -resize "${size}x${size}!" "$output"
}

render_macos_png() {
  local size="$1"
  local output="$2"
  sips --resampleHeightWidth "$size" "$size" "$MASTER_ICON" --out "$output" >/dev/null
}

render_macos_png 16 "$ICONSET_DIR/icon_16x16.png"
render_macos_png 32 "$ICONSET_DIR/icon_16x16@2x.png"
render_macos_png 32 "$ICONSET_DIR/icon_32x32.png"
render_macos_png 64 "$ICONSET_DIR/icon_32x32@2x.png"
render_macos_png 128 "$ICONSET_DIR/icon_128x128.png"
render_macos_png 256 "$ICONSET_DIR/icon_128x128@2x.png"
render_macos_png 256 "$ICONSET_DIR/icon_256x256.png"
render_macos_png 512 "$ICONSET_DIR/icon_256x256@2x.png"
render_macos_png 512 "$ICONSET_DIR/icon_512x512.png"
render_macos_png 1024 "$ICONSET_DIR/icon_512x512@2x.png"
python3 "$PROJECT_DIR/scripts/package-icns.py" \
  "$ICONSET_DIR" \
  "$MACOS_DIR/app-icon.icns"

magick "$MASTER_ICON" \
  -define icon:auto-resize=256,128,64,48,32,16 \
  "$WINDOWS_DIR/app-icon.ico"

for size in 16 32 48 64 128 256 512; do
  output_dir="$LINUX_DIR/${size}x${size}/apps"
  mkdir -p "$output_dir"
  render_png "$size" "$output_dir/loora.png"
done

echo "Generated macOS, Windows, and Linux icons from $MASTER_ICON"
