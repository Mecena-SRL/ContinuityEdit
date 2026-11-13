#!/usr/bin/env bash
# Eseguito (come root) dall'app "Installa ContinuityEdit": installa il plugin gia' assemblato
# contenuto nella cartella payload/ accanto a questo script. Riusa lib/install-lib.sh.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/install-lib.sh
source "$HERE/install-lib.sh"
ce_require_macos
ce_check_resolve
say "1/3 Plugin gia' assemblato nel pacchetto."
ce_deploy "$HERE/plugin/$PLUGIN_ID"
ce_final_message
