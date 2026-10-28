#!/usr/bin/env bash
# Puts together a runnable Pulse Disc folder: Electron's official build, checked against
# Electron's published checksums, plus this folder's app files, the cutter and the starter pack.
# Usage: desktop/assemble.sh [win32-x64|win32-arm64|linux-x64] [output folder]
set -euo pipefail
V=44.7.0
PLAT=${1:-win32-x64}
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
OUT=${2:-"$here/dist/Pulse Disc"}
cache="$here/.cache"; mkdir -p "$cache"
zip="$cache/electron-v$V-$PLAT.zip"
base="https://github.com/electron/electron/releases/download/v$V"

[ -f "$cache/SHASUMS256-$V.txt" ] || curl -fsSL --retry 3 -o "$cache/SHASUMS256-$V.txt" "$base/SHASUMS256.txt"
[ -f "$zip" ] || curl -fL --retry 3 -o "$zip" "$base/electron-v$V-$PLAT.zip"
want=$(grep " \*electron-v$V-$PLAT.zip\$" "$cache/SHASUMS256-$V.txt" | cut -d' ' -f1)
have=$(sha256sum "$zip" | cut -d' ' -f1)
[ -n "$want" ] && [ "$want" = "$have" ] || { echo "Checksum mismatch for $zip" >&2; rm -f "$zip"; exit 1; }

rm -rf "$OUT"; mkdir -p "$OUT"
unzip -q "$zip" -d "$OUT"
rm -f "$OUT/resources/default_app.asar"
app="$OUT/resources/app"
mkdir -p "$app/disc/starter"
cp "$here/package.json" "$here/main.js" "$here/preload.js" "$app/"
cp "$here/disc/index.html" "$here/disc/disc.js" "$app/disc/"
cp "$root/tracks.js" "$app/disc/"
cp "$root/icon-512.png" "$app/disc/icon.png"
cp "$root"/starter/*.pulse "$root/starter/index.json" "$app/disc/starter/"
case "$PLAT" in
  win32-*) mv "$OUT/electron.exe" "$OUT/Pulse Disc.exe" ;;
  linux-*) mv "$OUT/electron" "$OUT/pulse-disc" ;;
esac
echo "Pulse Disc ready in $OUT"
