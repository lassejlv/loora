#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Loora"
PACKAGE_NAME="loora-desktop"
BINARY_NAME="Loora"
BUNDLE_ID="${BUNDLE_ID:-com.loora.app}"
MIN_MACOS_VERSION="${MIN_MACOS_VERSION:-11.0}"
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_DIR/dist}"
CARGO_BUILD_DIR="${CARGO_TARGET_DIR:-$PROJECT_DIR/target}"

if [[ "$CARGO_BUILD_DIR" != /* ]]; then
    CARGO_BUILD_DIR="$PROJECT_DIR/$CARGO_BUILD_DIR"
fi

usage() {
    cat <<'USAGE'
Build Loora macOS disk images.

Usage:
  scripts/build-macos-dmg.sh [all|arm64|x64]...

With no arguments, the script builds both architectures:
  dist/Loora-<version>-arm64.dmg
  dist/Loora-<version>-x64.dmg

Environment variables:
  OUTPUT_DIR                 Artifact directory (default: dist)
  BUNDLE_ID                  macOS bundle identifier (default: com.loora.app)
  MIN_MACOS_VERSION          Deployment target (default: 11.0)
  CODESIGN_IDENTITY          Signing identity (default: ad-hoc signing)
  VERSION                    Override the Cargo package version
  BUNDLE_VERSION             Override CFBundleVersion
USAGE
}

die() {
    echo "error: $*" >&2
    exit 1
}

if [[ "$(uname -s)" != "Darwin" ]]; then
    die "macOS is required (the script uses codesign and hdiutil)"
fi

for tool in cargo rustup lipo codesign hdiutil osascript; do
    command -v "$tool" >/dev/null 2>&1 || die "required tool not found: $tool"
done

architectures=()
if [[ $# -eq 0 ]]; then
    architectures=(arm64 x64)
else
    for argument in "$@"; do
        case "$argument" in
            all)
                architectures=(arm64 x64)
                ;;
            arm64 | aarch64 | aarch64-apple-darwin)
                architectures+=(arm64)
                ;;
            x64 | x86_64 | x86_64-apple-darwin)
                architectures+=(x64)
                ;;
            -h | --help)
                usage
                exit 0
                ;;
            *)
                usage >&2
                die "unknown architecture: $argument"
                ;;
        esac
    done
fi

PACKAGE_ID="$(cd "$PROJECT_DIR" && cargo pkgid -p "$PACKAGE_NAME")"
DETECTED_VERSION="${PACKAGE_ID##*@}"
[[ "$DETECTED_VERSION" != "$PACKAGE_ID" ]] || die "could not determine package version"
VERSION="${VERSION:-$DETECTED_VERSION}"
BUNDLE_VERSION="${BUNDLE_VERSION:-${VERSION%%-*}}"
BUNDLE_VERSION="${BUNDLE_VERSION%%+*}"

mkdir -p "$OUTPUT_DIR"

build_dmg() {
    local architecture="$1"
    local rust_target
    local macho_arch

    case "$architecture" in
        arm64)
            rust_target="aarch64-apple-darwin"
            macho_arch="arm64"
            ;;
        x64)
            rust_target="x86_64-apple-darwin"
            macho_arch="x86_64"
            ;;
        *)
            die "unsupported architecture: $architecture"
            ;;
    esac

    if ! rustup target list --installed | grep -qx "$rust_target"; then
        echo "Installing Rust target $rust_target..."
        rustup target add "$rust_target"
    fi

    echo "Building $APP_NAME $VERSION for $architecture..."
    (
        cd "$PROJECT_DIR"
        CARGO_TARGET_DIR="$CARGO_BUILD_DIR" \
        MACOSX_DEPLOYMENT_TARGET="$MIN_MACOS_VERSION" \
            cargo build --release --locked -p "$PACKAGE_NAME" --bin "$BINARY_NAME" --target "$rust_target"
    )

    local binary="$CARGO_BUILD_DIR/$rust_target/release/$BINARY_NAME"
    [[ -f "$binary" ]] || die "built binary not found: $binary"
    lipo "$binary" -verify_arch "$macho_arch"

    local work_dir="$CARGO_BUILD_DIR/macos-dmg/$rust_target"
    local app_bundle="$work_dir/$APP_NAME.app"
    local dmg_root="$work_dir/dmg-root"
    local dmg_path="$OUTPUT_DIR/$APP_NAME-$VERSION-$architecture.dmg"

    rm -rf "$work_dir"
    mkdir -p "$app_bundle/Contents/MacOS" "$app_bundle/Contents/Resources" "$dmg_root"
    install -m 755 "$binary" "$app_bundle/Contents/MacOS/$BINARY_NAME"
    install -m 644 \
        "$PROJECT_DIR/crates/desktop/assets/macos/app-icon.icns" \
        "$app_bundle/Contents/Resources/app-icon.icns"

    cat > "$app_bundle/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>$APP_NAME</string>
    <key>CFBundleExecutable</key>
    <string>$BINARY_NAME</string>
    <key>CFBundleIconFile</key>
    <string>app-icon.icns</string>
    <key>CFBundleIdentifier</key>
    <string>$BUNDLE_ID</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>$APP_NAME</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>$VERSION</string>
    <key>CFBundleVersion</key>
    <string>$BUNDLE_VERSION</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.graphics-design</string>
    <key>LSMinimumSystemVersion</key>
    <string>$MIN_MACOS_VERSION</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST
    printf 'APPL????' > "$app_bundle/Contents/PkgInfo"

    if [[ -n "${CODESIGN_IDENTITY:-}" ]]; then
        echo "Signing with identity: $CODESIGN_IDENTITY"
        codesign --force --options runtime --timestamp --sign "$CODESIGN_IDENTITY" "$app_bundle"
    else
        echo "Applying ad-hoc signature (set CODESIGN_IDENTITY for release signing)..."
        codesign --force --sign - "$app_bundle"
    fi
    codesign --verify --deep --strict "$app_bundle"

    cp -R "$app_bundle" "$dmg_root/"
    ln -s /Applications "$dmg_root/Applications"
    mkdir -p "$dmg_root/.background"
    install -m 644 \
        "$PROJECT_DIR/crates/desktop/assets/macos/dmg-background.png" \
        "$dmg_root/.background/dmg-background.png"

    local rw_dmg="$work_dir/$APP_NAME-rw.dmg"
    local attach_output
    local mounted_device=""
    local mount_point
    local mounted_volume

    rm -f "$rw_dmg" "$dmg_path"
    hdiutil create \
        -volname "$APP_NAME" \
        -srcfolder "$dmg_root" \
        -fs HFS+ \
        -format UDRW \
        -ov \
        "$rw_dmg" >/dev/null

    cleanup_mount() {
        if [[ -n "$mounted_device" ]]; then
            hdiutil detach "$mounted_device" >/dev/null 2>&1 || true
        fi
    }
    trap cleanup_mount EXIT

    attach_output="$(hdiutil attach -readwrite -noverify -noautoopen "$rw_dmg")"
    mounted_device="$(printf '%s\n' "$attach_output" | awk -F '\t' '$NF ~ /^\/Volumes\// { gsub(/[[:space:]]/, "", $1); print $1; exit }')"
    mount_point="$(printf '%s\n' "$attach_output" | awk -F '\t' '$NF ~ /^\/Volumes\// { print $NF; exit }')"
    [[ -n "$mounted_device" && -n "$mount_point" ]] || die "could not mount writable disk image"
    mounted_volume="${mount_point##*/}"

    echo "Arranging the drag-to-Applications window..."
    osascript <<APPLESCRIPT
 tell application "Finder"
     tell disk "$mounted_volume"
         open
         set current view of container window to icon view
         set toolbar visible of container window to false
         set statusbar visible of container window to false
         set pathbar visible of container window to false
         set bounds of container window to {100, 100, 760, 500}

         set view_options to the icon view options of container window
         set arrangement of view_options to not arranged
         set icon size of view_options to 112
         set text size of view_options to 13
         set label position of view_options to bottom
         set background picture of view_options to file ".background:dmg-background.png"

         set position of item "$APP_NAME.app" of container window to {170, 220}
         set position of item "Applications" of container window to {490, 220}
         update without registering applications
         delay 2
         close
     end tell
 end tell
APPLESCRIPT

    sync
    if ! hdiutil detach "$mounted_device" >/dev/null; then
        sleep 2
        hdiutil detach -force "$mounted_device" >/dev/null
    fi
    mounted_device=""
    trap - EXIT

    hdiutil convert \
        "$rw_dmg" \
        -format UDZO \
        -imagekey zlib-level=9 \
        -ov \
        -o "$dmg_path" >/dev/null
    rm -f "$rw_dmg"
    hdiutil verify "$dmg_path" >/dev/null

    echo "Created $dmg_path"
}

built=()
for architecture in "${architectures[@]}"; do
    already_built=false
    for existing in "${built[@]:-}"; do
        if [[ "$existing" == "$architecture" ]]; then
            already_built=true
            break
        fi
    done
    if [[ "$already_built" == false ]]; then
        build_dmg "$architecture"
        built+=("$architecture")
    fi
done
