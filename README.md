# ContinuityEdit

Plugin per **DaVinci Resolve Studio** (macOS) in stile ScriptSync di Avid: importa la sceneggiatura (FDX/PDF), la allinea alle trascrizioni delle clip e mostra, riga per riga, quali take la coprono.

**Stato: v0.1.0** — lettore integrato, mini-montaggio, assistente passo-passo, ricerca nel parlato, revisioni dello script. Installer non firmato. Vedi `CHANGELOG.md`.

## Installazione

Dal pacchetto ZIP (release): doppio click su *Installa ContinuityEdit.command* (tasto destro > Apri se macOS lo blocca), poi apri Resolve. Dettagli, quarantena e risoluzione problemi in [`docs/GUIDA_UTENTE.md`](docs/GUIDA_UTENTE.md).

Dal sorgente (macOS, Resolve Studio installato): `scripts/install-mac.sh` (`--uninstall` per rimuovere). Per creare il .dmg: `scripts/make-icns.sh` poi `scripts/build-dmg.sh`.

`WorkflowIntegration.node` e' di Blackmagic Design e non e' ridistribuito: lo copia l'installer da Resolve.

## Sviluppo

```
npm ci
npm test
node scripts/build-plugin.mjs   # assembla dist/com.continuityedit.plugin
bash plugin/dev/make-samples.sh # video sintetici per l'harness (ffmpeg)
node plugin/dev/serve.mjs       # harness: http://127.0.0.1:8799/plugin/dev/index.html?seed=1
```

L'harness usa i veri handler del plugin con un finto Resolve. Cosa della API di Resolve è verificato e cosa è ipotesi: [`docs/RESOLVE_API_NOTES.md`](docs/RESOLVE_API_NOTES.md).

Struttura:

- `core/` — logica (parser sceneggiatura, allineamento, copertura, assemblaggio) e test
- `plugin/` — plugin Resolve (main, preload, renderer, harness `dev/`)
- `scripts/` — installazione, build plugin, .dmg, icona, guida
- `docs/` — contratti, piano, API del plugin, guida utente
- `assets/icon/` — icona (SVG + PNG)
- `.github/workflows/release-dmg.yml` — build del .dmg su macOS

## Licenza e autori

GNU GPL v3 o successiva (`LICENSE`). Copyright (C) 2026 Ivan Mazzone e Claude (Anthropic). Vedi `AUTHORS.md` e `NOTICE.md`.

## Installazione rapida (pacchetto ZIP)
Se non hai il `.dmg`, costruisci il pacchetto da qualunque computer con Node.js (macOS o Linux):

```bash
npm ci && scripts/build-zip.sh
```

Esce `dist/ContinuityEdit-<versione>-mac.zip`: sul Mac decomprimilo, chiudi Resolve, doppio click su **Installa ContinuityEdit.command** (se macOS lo blocca: tasto destro > Apri) e poi apri *Workspace > Workflow Integrations > ContinuityEdit* in DaVinci Resolve Studio.
