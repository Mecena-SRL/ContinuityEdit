# Changelog

## v0.1.0 — Lettore, mini-montaggio, assistente

**Nuovo**
- **Assistente passo-passo** in alto: legge lo stato (clip, copione, trascrizioni, sync, montaggio, timeline) e propone un solo prossimo passo con un pulsante. Modalità **Semplice** (predefinita) e **Avanzata**.
- **Lettore integrato** al posto del visore sorgente: video e audio della clip nel pannello, Spazio, J/K/L, frame a frame, In/Out; **M/N agganciano la riga selezionata mentre guardi** (M passa da solo alla riga dopo: ideale per le sceneggiature mute); karaoke sullo script e striscia del parlato; still con S; anteprima del montaggio (V1 con audio + cutaway); ripiego proxy, "solo audio" e "Mostra in Resolve" per i codec non decodificabili.
- **Mini-montaggio** in basso: corsie V1..Vn, trascinamento (V1 riordina, V2+ libere con sovrascrittura), maniglie, lama (B), Q/W, aggancio a righe e bordi, undo/redo, **Manda in timeline** (nuova o in coda) con audio collegato e **marker delle righe**.
- **Sincronizza tutto** in un clic: trascrizione in Resolve, attesa con avanzamento annullabile, allineamento di tutti i take.
- **Cerca nel parlato** (come PhraseFind), tollerante agli errori di riconoscimento, anche senza sceneggiatura.
- **Modalità documentario**: le trascrizioni diventano il copione, già sincronizzato.
- **Revisioni dello script**: importando una nuova versione, ancore, scelte, note e valutazioni seguono le righe uguali o modificate (resoconto e Ctrl+Z).
- **Resolve**: righe e take già montati nella timeline aperta (pallino verde), **Segui timeline** (lo script segue il playhead, clic su una riga lo sposta), valutazioni nel Media Pool (parole chiave "CE …", colore, flag; mai distruttivo), sottotitoli SRT dal montaggio, cambio di progetto a pannello aperto.
- **Diagnostica** estesa (tutte le firme usate, scritture con ripristino) visibile nel pannello e copiabile; `docs/RESOLVE_API_NOTES.md`.
- Clip caricabili prima della sceneggiatura; messaggi d'errore in italiano con rimedio; foglio delle scorciatoie (?); icona del progetto nell'intestazione; layout da 800×600 a 1600×1000.

**Corretto**
- Stato della trascrizione sempre "Inactive": `MediaPoolItem.GetTranscribeAudioStatus` non esiste in Resolve 21.2; ora stato del progetto + proprietà "Transcription Status".
- Montaggio in timeline: `recordFrame` era relativo (0) invece che assoluto (inizio timeline, es. 01:00:00:00): i pezzi su V2/V3 e il master finivano fuori posto. Anche: timeline resa corrente, "nuova" sempre nuova, fps clip ≠ fps timeline.
- Le miniature (scansione, lavagna) usavano un indirizzo `ce-media` mai registrato: erano sempre segnaposto.
- "Scrivi marker" cancellava anche i marker degli still.
- Timecode drop-frame (29.97/59.94) convertiti come non-drop (errore crescente nelle clip lunghe).
- Modifiche concorrenti al progetto (ora in coda), ricerca della clip nel Media Pool a ogni chiamata (ora indicizzata).

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
