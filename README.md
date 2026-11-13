# ContinuityEdit

Plugin per **DaVinci Resolve Studio** (macOS) in stile ScriptSync di Avid: importa la sceneggiatura (FDX/PDF), la allinea alle trascrizioni delle clip e mostra, riga per riga, quali take la coprono.

**Stato: v0.0.1** — prima versione, installer non firmato. Vedi `CHANGELOG.md`.

## Installazione

Dal `.dmg` (release): apri `ContinuityEdit-0.0.1.dmg`, tasto destro > Apri su *Installa ContinuityEdit*, poi riavvia Resolve. Dettagli, quarantena e risoluzione problemi in [`docs/GUIDA_UTENTE.md`](docs/GUIDA_UTENTE.md).

Dal sorgente (macOS, Resolve Studio installato): `scripts/install-mac.sh` (`--uninstall` per rimuovere). Per creare il .dmg: `scripts/make-icns.sh` poi `scripts/build-dmg.sh`.

`WorkflowIntegration.node` e' di Blackmagic Design e non e' ridistribuito: lo copia l'installer da Resolve.

## Sviluppo

```
npm ci
npm test
node scripts/build-plugin.mjs   # assembla dist/com.continuityedit.plugin
```

Struttura:

- `core/` — logica (parser sceneggiatura, allineamento, copertura, assemblaggio) e test
- `plugin/` — plugin Resolve (main, preload, renderer, harness `dev/`)
- `scripts/` — installazione, build plugin, .dmg, icona, guida
- `docs/` — contratti, piano, API del plugin, guida utente
- `assets/icon/` — icona (SVG + PNG)
- `.github/workflows/release-dmg.yml` — build del .dmg su macOS

## Licenza e autori

GNU GPL v3 o successiva (`LICENSE`). Copyright (C) 2026 Ivan Mazzone e Claude (Anthropic). Vedi `AUTHORS.md` e `NOTICE.md`.
