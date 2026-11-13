#!/usr/bin/env bash
# Installa il plugin ContinuityEdit in DaVinci Resolve Studio (macOS).
# Uso:  scripts/install-mac.sh            installa/aggiorna (idempotente)
#       scripts/install-mac.sh --uninstall  rimuove il plugin
set -euo pipefail

PLUGIN_ID="com.continuityedit.plugin"
BMD="/Library/Application Support/Blackmagic Design/DaVinci Resolve"
PLUGINS_DIR="$BMD/Workflow Integration Plugins"
DEST="$PLUGINS_DIR/$PLUGIN_ID"
SAMPLE_NODE="$BMD/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$REPO/dist/$PLUGIN_ID"

say()  { printf '%s\n' "$*"; }
die()  { printf 'Errore: %s\n' "$*" >&2; exit 1; }

# Esegue il comando con sudo solo se serve (cartella di sistema non scrivibile).
run() {
  if [ "$(id -u)" -eq 0 ] || [ -w "$PLUGINS_DIR" ] 2>/dev/null; then "$@"; else sudo "$@"; fi
}

if [ "$(uname -s)" != "Darwin" ]; then
  die "questo script e' per macOS (i plugin Workflow Integration non sono supportati su Linux)."
fi

if [ "${1:-}" = "--uninstall" ]; then
  if [ -d "$DEST" ]; then
    say "Rimuovo $DEST ..."
    run rm -rf "$DEST"
    say "Plugin disinstallato. Riavvia DaVinci Resolve."
  else
    say "Il plugin non risulta installato: niente da fare."
  fi
  exit 0
fi

[ -d "$BMD" ] || die "DaVinci Resolve non trovato in '$BMD'. Installa Resolve Studio e riprova."
[ -f "$SAMPLE_NODE" ] || die "WorkflowIntegration.node non trovato in '$SAMPLE_NODE'. Controlla che Resolve Studio sia installato completo (cartella Developer)."
command -v node >/dev/null 2>&1 || die "Node.js non trovato: serve per assemblare il plugin (node >= 20)."

say "1/3 Assemblo il plugin in dist/ ..."
( cd "$REPO" && { [ -d node_modules ] || npm ci; } && node scripts/build-plugin.mjs ) >/dev/null
[ -f "$DIST/main.js" ] || die "assemblaggio non riuscito ($DIST/main.js mancante)."

say "2/3 Installo in '$DEST' ..."
[ -d "$PLUGINS_DIR" ] || run mkdir -p "$PLUGINS_DIR"
run rm -rf "$DEST"
run mkdir -p "$DEST"
run cp -R "$DIST/." "$DEST/"

say "3/3 Copio WorkflowIntegration.node da Resolve ..."
run cp "$SAMPLE_NODE" "$DEST/WorkflowIntegration.node"
run chmod -R a+rX "$DEST"

say ""
say "Fatto. Riavvia DaVinci Resolve Studio, poi apri il plugin da:"
say "  Workspace > Workflow Integrations > ContinuityEdit"
say "Se il modulo di Blackmagic non si carica, macOS potrebbe averlo messo in quarantena:"
say "  sudo xattr -dr com.apple.quarantine \"$DEST\""
