# Changelog

## v0.0.2 — Scansione clip

- Nuovo pannello **Scansiona clip** (pulsante nella barra, nel pannello Clip e nel Browser): foglio di contatto con tre miniature per clip (inizio, metà, fine; nessun file esportato) per classificare ogni take come Totale, Medio, Stretto, Dettaglio o Altro con i tasti 1-5; Invio conferma le proposte, le frecce passano al take successivo; i take non classificati sono segnalati.
- Nuovi campi del take `shot` e `shotSource` (modello v2 compatibile, campi opzionali) e `setTakeShot`.
- Il tipo di inquadratura viene proposto dai metadati (`Shot Type`, `Shot`, `Angle`) e dal nome file (WIDE, TOT, MS, CU, DET, PP, ...) al caricamento dei bin, senza mai sovrascrivere una scelta manuale.
- Raggruppamento per copertura (`detectGroupsByCoverage`) unito a quello per metadati/nome, master suggerito per gruppo (`suggestMaster`) con ipotesi «Stretto» per gli altri angoli, scritte solo dopo conferma.
- L'inquadratura compare come etichetta (TOT, MED, STR, DET) nella lista take, nel Browser e sulle linee verticali di copertura.

## v0.0.1 — 2026

Prima versione pubblica.

- Plugin Workflow Integration per DaVinci Resolve Studio (macOS) in stile ScriptSync.
- Import sceneggiatura FDX e PDF, allineamento automatico con le trascrizioni di Resolve, ancore manuali, copertura dei take per riga.
- Anteprima riga, assemblaggio timeline, scrittura marker.
- Pacchetto ZIP con installatore da doppio click (`scripts/build-zip.sh`), costruibile anche da Linux.
- Installer `.dmg` non firmato (`Installa ContinuityEdit.app`), guida utente in italiano, icona.
- Licenza GNU GPL v3 o successiva.
- Limiti noti: nessun controllo del visore sorgente, nessuna commutazione multicam live.
