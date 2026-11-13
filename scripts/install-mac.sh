#!/usr/bin/env bash
# Installa il plugin ContinuityEdit in DaVinci Resolve Studio (macOS).
# Uso:  scripts/install-mac.sh            installa/aggiorna (idempotente)
#       scripts/install-mac.sh --uninstall  rimuove il plugin
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/install-lib.sh
source "$REPO/scripts/lib/install-lib.sh"
DIST="$REPO/dist/$PLUGIN_ID"

ce_require_macos

if [ "${1:-}" = "--uninstall" ]; then
  ce_uninstall
  exit 0
fi

ce_check_resolve
command -v node >/dev/null 2>&1 || die "Node.js non trovato: serve per assemblare il plugin (node >= 20)."

say "1/3 Assemblo il plugin in dist/ ..."
( cd "$REPO" && { [ -d node_modules ] || npm ci; } && node scripts/build-plugin.mjs ) >/dev/null
[ -f "$DIST/main.js" ] || die "assemblaggio non riuscito ($DIST/main.js mancante)."

ce_deploy "$DIST"
ce_final_message
