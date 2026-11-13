#!/usr/bin/env bash
# Crea dist/ContinuityEdit-<versione>.dmg (solo macOS: usa osacompile e hdiutil).
# Uso:  scripts/build-dmg.sh [versione]     (default: "version" di package.json)
# Prerequisiti: Node >= 20; opzionale assets/icon/AppIcon.icns (vedi scripts/make-icns.sh).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

[ "$(uname -s)" = "Darwin" ] || { echo "Errore: build-dmg.sh richiede macOS (osacompile, hdiutil)." >&2; exit 1; }
for c in node npm osacompile hdiutil; do
  command -v "$c" >/dev/null 2>&1 || { echo "Errore: comando mancante: $c" >&2; exit 1; }
done

PLUGIN_ID="com.continuityedit.plugin"
VERSION="${1:-$(node -p "require('./package.json').version")}"
VOLNAME="ContinuityEdit $VERSION"
APP_NAME="Installa ContinuityEdit"
OUT="$REPO/dist"
STAGE="$OUT/dmg-stage"
DMG="$OUT/ContinuityEdit-$VERSION.dmg"
APP="$STAGE/$APP_NAME.app"
ICNS="$REPO/assets/icon/AppIcon.icns"

echo "1/6 Dipendenze e assemblaggio del plugin ..."
npm ci
node scripts/build-plugin.mjs
[ -f "$OUT/$PLUGIN_ID/main.js" ] || { echo "Errore: assemblaggio non riuscito." >&2; exit 1; }

echo "2/6 Preparo la cartella di staging ..."
rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"

echo "3/6 Compilo l'app installer con osacompile ..."
APPLESCRIPT="$OUT/installer.applescript"
cat > "$APPLESCRIPT" <<'AS'
on run
	set appPath to POSIX path of (path to me)
	set payloadDir to appPath & "Contents/Resources/payload/"
	set titolo to "Installa ContinuityEdit"
	try
		display dialog "Questo installera' il plugin ContinuityEdit in DaVinci Resolve Studio." & return & return & "Serve la password di amministratore. DaVinci Resolve Studio deve essere gia' installato (con la cartella Developer)." buttons {"Annulla", "Installa"} default button "Installa" cancel button "Annulla" with title titolo with icon note
	on error number -128
		return
	end try
	try
		set risultato to do shell script "/bin/bash " & quoted form of (payloadDir & "dmg-install-payload.sh") & " 2>&1" with administrator privileges
		display dialog "Installazione completata." & return & return & "Riavvia DaVinci Resolve Studio, poi apri:" & return & "Workspace > Workflow Integrations > ContinuityEdit" buttons {"OK"} default button "OK" with title titolo with icon note
	on error errMsg number errNum
		if errNum is -128 then return
		display dialog "Installazione non riuscita:" & return & return & errMsg buttons {"OK"} default button "OK" with title titolo with icon stop
	end try
end run
AS
osacompile -o "$APP" "$APPLESCRIPT"
rm -f "$APPLESCRIPT"

echo "4/6 Copio il payload (plugin + script condivisi) nell'app ..."
PAYLOAD="$APP/Contents/Resources/payload"
mkdir -p "$PAYLOAD/plugin"
cp -R "$OUT/$PLUGIN_ID" "$PAYLOAD/plugin/$PLUGIN_ID"
cp scripts/lib/install-lib.sh "$PAYLOAD/install-lib.sh"
cp scripts/dmg-install-payload.sh "$PAYLOAD/dmg-install-payload.sh"
chmod +x "$PAYLOAD/dmg-install-payload.sh"

if [ -f "$ICNS" ]; then
  cp "$ICNS" "$APP/Contents/Resources/applet.icns"
  touch "$APP"
else
  echo "Avviso: $ICNS non trovato (esegui scripts/make-icns.sh): uso l'icona predefinita."
fi

echo "5/6 Aggiungo guida e licenze ..."
node scripts/build-guide.mjs >/dev/null
cp docs/GUIDA_UTENTE.md "$STAGE/Guida utente.md"
[ -f docs/GUIDA_UTENTE.html ] && cp docs/GUIDA_UTENTE.html "$STAGE/Guida utente.html"
cp LICENSE NOTICE.md "$STAGE/"

echo "6/6 Creo il .dmg ($VOLNAME) ..."
hdiutil create -volname "$VOLNAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
rm -rf "$STAGE"

echo ""
echo "Creato: $DMG"
shasum -a 256 "$DMG"
