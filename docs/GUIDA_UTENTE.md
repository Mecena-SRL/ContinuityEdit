# ContinuityEdit — Guida utente (v0.1.0)

ContinuityEdit è un plugin per **DaVinci Resolve Studio** (macOS) che collega la sceneggiatura alle clip girate, come ScriptSync di Avid, ma più semplice: per ogni riga del copione vedi quali take la coprono, la guardi subito nel lettore del pannello, scegli il take, e mandi in timeline un montaggio grezzo con un clic.

## Installazione

Dal pacchetto ZIP:

1. Chiudi DaVinci Resolve.
2. Doppio click su **Installa ContinuityEdit.command**. Se macOS dice che non può aprirlo: tasto destro sul file > **Apri** > **Apri**.
3. Inserisci la password del Mac quando richiesta: il plugin va in `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/` e l'installatore prende da Resolve il modulo `WorkflowIntegration.node` (appartiene a Blackmagic Design e non è incluso).
4. Apri Resolve Studio: **Workspace > Workflow Integrations > ContinuityEdit**.

Requisiti: macOS, DaVinci Resolve **Studio** 20.1 o successivo installato per intero (con la cartella Developer). Collaudato in sviluppo sulle firme di Resolve Studio 21.2.

Se Resolve non carica il modulo di Blackmagic, togli la quarantena al plugin:

```
sudo xattr -dr com.apple.quarantine "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.continuityedit.plugin"
```

## Prima di aprire il pannello (in Resolve)

1. **Metti a sync audio e video** delle clip.
2. **Un bin per scena**: una cartella del Media Pool per ogni scena, con dentro i take.
3. **Apri una timeline** (pagina Edit): serve per "Segui timeline" e per mandare il montaggio.

La trascrizione la può avviare il pannello stesso.

## Il pannello in breve

- **In alto, l'assistente**: ti dice sempre il prossimo passo (Clip → Copione → Sincronizza → Montaggio → Timeline) con un solo pulsante. "Salta" o "Più tardi" lo fanno andare avanti.
- **A sinistra, le clip** dei bin caricati: pallino = colore del take, ▶ lo apre nel lettore, la barretta indica quante righe copre.
- **Al centro, lo script** con le **linee verticali**: una colonna per take, la linea copre le righe che quel take ha girato. Pallino verde sulla linea = riga già montata nella timeline aperta in Resolve.
- **A destra, il lettore** (sostituisce il visore sorgente, che la API di Resolve non permette di pilotare) e sotto le schede **Riga** e **Cerca nel parlato**.
- **In basso, il montaggio**: le corsie V1, V2, V3 come in una timeline.

**Semplice / Avanzata** (in alto a destra): la modalità Avanzata aggiunge valutazioni (Buono/Scarto, B/B+/B++), filtri, note, ancore in frame e marker.

## Passo per passo

1. **Clip** — "Scegli i bin…": spunta i bin delle scene e premi "Carica i bin". In alternativa seleziona le clip nel Media Pool e usa "Usa le clip selezionate".
2. **Copione** — "Importa sceneggiatura…": Final Draft (.fdx) o PDF. Sceneggiature mute vanno benissimo. **Documentario o niente copione?** "Usa le trascrizioni": il parlato delle clip diventa il copione (una scena per clip, una riga per frase), già sincronizzato.
3. **Sincronizza** — "Sincronizza tutto": il pannello chiede a Resolve di trascrivere le clip che non lo sono, aspetta (una scheda mostra l'avanzamento, puoi continuare a lavorare o interrompere) e aggancia ogni battuta al parlato.
   - **Azioni mute**: apri un take nel lettore, seleziona la prima azione, premi **Spazio** e poi **M** ogni volta che un'azione comincia: il pannello aggancia la riga e passa da solo alla successiva. **N** segna la fine della riga.
   - Per un aggancio preciso: segna **I** e **O** guardando e premi "In/Out → riga".
4. **Montaggio** — "Crea il montaggio": per ogni riga il take scelto (o il migliore) su **V1**, continuo e con il suo audio. Per mettere un'altra camera: seleziona le righe, attiva quel take, tasto destro > "Metti la camera attiva su V2". Le maniglie sulla linea verticale nel testo spostano le righe del cutaway.
5. **Timeline** — "Manda in timeline": crea una timeline nuova in Resolve (o accoda alla timeline aperta) con V1+audio, i cutaway su V2/V3 e un **marker blu all'inizio di ogni riga**.

## Il lettore

- **Spazio** play/pausa, **J K L** indietro/ferma/avanti (ripeti L o J per accelerare), **← →** un frame (Maiusc: un secondo).
- Clic su una riga + **Invio** (o doppio clic) = riproduce la riga con il take scelto. Clic su una linea verticale = usa quel take per la riga e lo riproduce.
- Mentre suona, la riga si illumina e le parole già dette si accendono (karaoke); sotto il video scorre il parlato trascritto (clic su una parola per andarci).
- **I / O** segnano In e Out; con In/Out puoi mettere il pezzo nel montaggio ("+ V1" inserisce al playhead del montaggio, "+ V2" sovrascrive sopra).
- **S** mette uno still sulla lavagna (è un marker sulla clip: nessun file viene creato).
- "**Montaggio**" in alto nel lettore: anteprima della sequenza (V1 con audio, cutaway sopra).
- **Codec**: il pannello riproduce H.264/HEVC. Per ProRes, DNx, BRAW o MXF genera i proxy in Resolve (tasto destro sulla clip > Genera media proxy, formato H.264 o H.265): il lettore li usa da solo. Se il video non si decodifica ma l'audio sì, il lettore funziona "solo audio". "**Mostra in Resolve**" seleziona sempre la clip nel Media Pool con In/Out.
- Nota: si sente l'audio contenuto nel file video (di camera), non quello di un registratore esterno sincronizzato in Resolve.

## Il montaggio (in basso)

- **V1 è sempre continua**: togliere o accorciare un pezzo avvicina i successivi; trascinarlo cambia l'ordine.
- **V2, V3 sono libere**: trascina un pezzo dove vuoi (anche su un'altra traccia); un pezzo nuovo copre quello che trova sotto.
- Maniglie ai bordi = accorcia/allunga; **Aggancia** fa scattare bordi e playhead sulle righe e sugli altri pezzi.
- Clic sul righello = playhead; **B** = lama al playhead; **Canc** = togli; **Q / W** = accorcia inizio/fine fino al playhead; **Ctrl/Cmd+Z** annulla (anche le modifiche allo script).
- Un cutaway con l'icona del collegamento è **agganciato alle righe**: segue il master se lo cambi. Spostandolo a mano diventa libero.

## Resolve e pannello insieme

- **Segui timeline** (icona del mirino in alto): lo script segue il playhead della timeline di Resolve; un clic su una riga montata sposta il playhead lì (pagine Edit o Cut).
- **Righe già usate**: pallino verde e etichetta "in timeline" sulle righe montate nella timeline aperta, aggiornati da soli.
- **Cerca nel parlato**: come PhraseFind, cerca una frase in tutte le trascrizioni (anche senza copione), tollera errori di riconoscimento; clic su un risultato = lo riproduce.
- **Revisioni del copione**: importa la nuova versione con "Importa sceneggiatura…": le righe uguali o modificate conservano ancore, scelte, note e valutazioni; un messaggio riassume cosa è cambiato (Ctrl+Z annulla).
- Menu **⋯**: scrivi le valutazioni nel Media Pool (parole chiave "CE …", colore solo sulle clip senza colore, flag; nulla viene cancellato), scrivi le ancore come marker sulla clip, sottotitoli SRT dal montaggio, scansione delle inquadrature (Totale/Medio/Stretto/Dettaglio), lavagna, diagnostica.
- **Cambio di progetto**: se apri un altro progetto in Resolve, il pannello salva il lavoro e carica quello del nuovo progetto.

Il lavoro si salva da solo (un file `.ce.json` per progetto Resolve, nella cartella dati del plugin).

## Risoluzione problemi

- **Il plugin non compare nel menu**: riavvia Resolve; verifica di avere la versione Studio; controlla che la cartella del plugin esista.
- **"WorkflowIntegration.node non trovato"**: reinstalla Resolve Studio in modo completo (la cartella Developer deve esistere).
- **Il lettore non mostra il video**: genera i proxy H.264/H.265 in Resolve, oppure usa "Mostra in Resolve".
- **"Segui timeline" non si muove**: passa alla pagina Edit o Cut di Resolve.
- **Una clip non si sincronizza**: è muta o il parlato non è riconosciuto; agganciala guardando (M e N).
- **Diagnostica**: menu ⋯ > Diagnostica. Seleziona prima una clip trascritta nel Media Pool e apri una timeline con qualche clip: il rapporto (`~/Desktop/continuityedit_diag.json`, anche "Copia il rapporto") dice quali funzioni di Resolve rispondono sul tuo Mac.

## Scorciatoie

Il tasto **?** apre il foglio completo delle scorciatoie.

## Disinstallazione

"Disinstalla ContinuityEdit.command" nel pacchetto, oppure da Terminale con Resolve chiuso:

```
sudo rm -rf "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.continuityedit.plugin"
```

I salvataggi dei progetti (`.ce.json`) restano nella cartella dati del plugin.

## Licenza

GNU GPL v3 o successiva. Autori: Ivan Mazzone e Claude. Vedi `LICENSE` e `NOTICE.md`.
