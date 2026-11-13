#!/usr/bin/env bash
# Genera assets/icon/AppIcon.icns dai PNG in assets/icon/png/ (solo macOS: sips + iconutil).
# Uso: scripts/make-icns.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PNG="$REPO/assets/icon/png"
SET="$REPO/assets/icon/AppIcon.iconset"
OUT="$REPO/assets/icon/AppIcon.icns"

[ "$(uname -s)" = "Darwin" ] || { echo "Errore: make-icns.sh richiede macOS (sips, iconutil)." >&2; exit 1; }
command -v iconutil >/dev/null 2>&1 || { echo "Errore: iconutil non trovato." >&2; exit 1; }

rm -rf "$SET"
mkdir -p "$SET"

# nome iconset : PNG di origine (le dimensioni mancanti vengono ridimensionate da 1024 con sips)
make() { # $1 = nome file nell'iconset, $2 = lato in pixel
  local src="$PNG/icon_$2.png"
  if [ -f "$src" ]; then cp "$src" "$SET/$1"
  else sips -z "$2" "$2" "$PNG/icon_1024.png" --out "$SET/$1" >/dev/null; fi
}
make icon_16x16.png      16
make icon_16x16@2x.png   32
make icon_32x32.png      32
make icon_32x32@2x.png   64
make icon_128x128.png    128
make icon_128x128@2x.png 256
make icon_256x256.png    256
make icon_256x256@2x.png 512
make icon_512x512.png    512
make icon_512x512@2x.png 1024

iconutil -c icns "$SET" -o "$OUT"
rm -rf "$SET"
echo "Creato: $OUT"
