#!/usr/bin/env bash
# Costruisce il pacchetto ZIP di installazione (alternativa al .dmg, costruibile anche da Linux):
#   dist/ContinuityEdit-<versione>-mac.zip
# contiene: "Installa ContinuityEdit.command", "Disinstalla ContinuityEdit.command", plugin assemblato,
# libreria di installazione, guida e licenza. WorkflowIntegration.node NON e' incluso (e' di Blackmagic):
# l'installatore lo copia dalla cartella Developer di DaVinci Resolve.
# Uso: scripts/build-zip.sh [versione]    (default: versione di package.json)
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(node -p "require('$REPO/package.json').version")}"
PLUGIN_ID="com.continuityedit.plugin"
NAME="ContinuityEdit-$VERSION"
STAGE="$REPO/dist/zip-stage/$NAME"
OUT="$REPO/dist/$NAME-mac.zip"

command -v zip >/dev/null || { echo "Errore: 'zip' non trovato." >&2; exit 1; }
[ -d "$REPO/node_modules" ] || (cd "$REPO" && npm ci)

rm -rf "$REPO/dist/zip-stage" && mkdir -p "$STAGE/lib" "$STAGE/plugin"
( cd "$REPO" && node scripts/build-plugin.mjs "$STAGE/plugin/$PLUGIN_ID" >/dev/null )
cp "$REPO/scripts/lib/install-lib.sh" "$STAGE/lib/install-lib.sh"
cp "$REPO/LICENSE" "$STAGE/LICENSE"
[ -f "$REPO/docs/GUIDA_UTENTE.html" ] && cp "$REPO/docs/GUIDA_UTENTE.html" "$STAGE/Guida utente.html"
cp "$REPO/docs/GUIDA_UTENTE.md" "$STAGE/Guida utente.md"

cat > "$STAGE/Installa ContinuityEdit.command" <<'CMD'
#!/usr/bin/env bash
# Installa ContinuityEdit in DaVinci Resolve Studio. Doppio click (se macOS lo blocca: tasto destro > Apri).
cd "$(dirname "$0")"
set -euo pipefail
source "./lib/install-lib.sh"
clear
say "=== Installazione di ContinuityEdit ==="
ce_require_macos
ce_check_resolve
say "1/3 Plugin gia' assemblato nel pacchetto."
ce_deploy "./plugin/$PLUGIN_ID"
# toglie la quarantena macOS al plugin installato (il file di Blackmagic copiato incluso)
run xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
ce_final_message
say ""
read -r -p "Premi Invio per chiudere..." _
CMD

cat > "$STAGE/Disinstalla ContinuityEdit.command" <<'CMD'
#!/usr/bin/env bash
cd "$(dirname "$0")"
set -euo pipefail
source "./lib/install-lib.sh"
ce_require_macos
ce_uninstall
read -r -p "Premi Invio per chiudere..." _
CMD

cat > "$STAGE/LEGGIMI.txt" <<TXT
ContinuityEdit $VERSION - installazione (macOS, DaVinci Resolve Studio)

1. Chiudi DaVinci Resolve.
2. Doppio click su "Installa ContinuityEdit.command".
   Se macOS dice che non puo' aprirlo perche' non e' firmato: tasto destro sul file > Apri > Apri.
   Ti verra' chiesta la password del Mac (serve per copiare nella cartella di sistema dei plugin).
3. Apri DaVinci Resolve Studio: Workspace > Workflow Integrations > ContinuityEdit.

Per rimuoverlo: "Disinstalla ContinuityEdit.command".
Guida: "Guida utente.html". Licenza: GPL-3.0-or-later (LICENSE).
Autori: Ivan Mazzone e Claude (Anthropic).
TXT

chmod +x "$STAGE/Installa ContinuityEdit.command" "$STAGE/Disinstalla ContinuityEdit.command"
mkdir -p "$REPO/dist" && rm -f "$OUT"
( cd "$REPO/dist/zip-stage" && zip -qr -X "$OUT" "$NAME" )
echo "Creato: $OUT"
( cd "$REPO/dist" && (shasum -a 256 "$(basename "$OUT")" 2>/dev/null || sha256sum "$(basename "$OUT")") )
