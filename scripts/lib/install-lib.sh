# Funzioni condivise di installazione per ContinuityEdit (macOS).
# Da includere con `source` da scripts/install-mac.sh e dall'installer del .dmg.
# Non eseguire direttamente.

PLUGIN_ID="com.continuityedit.plugin"
BMD="/Library/Application Support/Blackmagic Design/DaVinci Resolve"
PLUGINS_DIR="$BMD/Workflow Integration Plugins"
DEST="$PLUGINS_DIR/$PLUGIN_ID"
SAMPLE_NODE="$BMD/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node"

say()  { printf '%s\n' "$*"; }
die()  { printf 'Errore: %s\n' "$*" >&2; exit 1; }

# Esegue il comando con sudo solo se serve (cartella di sistema non scrivibile).
run() {
  if [ "$(id -u)" -eq 0 ] || [ -w "$PLUGINS_DIR" ] 2>/dev/null; then "$@"; else sudo "$@"; fi
}

ce_require_macos() {
  if [ "$(uname -s)" != "Darwin" ]; then
    die "questo script e' per macOS (i plugin Workflow Integration non sono supportati su Linux)."
  fi
}

ce_uninstall() {
  if [ -d "$DEST" ]; then
    say "Rimuovo $DEST ..."
    run rm -rf "$DEST"
    say "Plugin disinstallato. Riavvia DaVinci Resolve."
  else
    say "Il plugin non risulta installato: niente da fare."
  fi
}

ce_check_resolve() {
  [ -d "$BMD" ] || die "DaVinci Resolve non trovato in '$BMD'. Installa Resolve Studio e riprova."
  [ -f "$SAMPLE_NODE" ] || die "WorkflowIntegration.node non trovato in '$SAMPLE_NODE'. Controlla che Resolve Studio sia installato completo (cartella Developer)."
}

# $1 = cartella con il plugin assemblato (contiene main.js)
ce_deploy() {
  local dist="$1"
  [ -f "$dist/main.js" ] || die "plugin assemblato non trovato ($dist/main.js mancante)."
  say "2/3 Installo in '$DEST' ..."
  [ -d "$PLUGINS_DIR" ] || run mkdir -p "$PLUGINS_DIR"
  run rm -rf "$DEST"
  run mkdir -p "$DEST"
  run cp -R "$dist/." "$DEST/"

  say "3/3 Copio WorkflowIntegration.node da Resolve ..."
  run cp "$SAMPLE_NODE" "$DEST/WorkflowIntegration.node"
  run chmod -R a+rX "$DEST"
}

ce_final_message() {
  say ""
  say "Fatto. Riavvia DaVinci Resolve Studio, poi apri il plugin da:"
  say "  Workspace > Workflow Integrations > ContinuityEdit"
  say "Se il modulo di Blackmagic non si carica, macOS potrebbe averlo messo in quarantena:"
  say "  sudo xattr -dr com.apple.quarantine \"$DEST\""
}
