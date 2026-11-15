# Note sulla API di DaVinci Resolve usata da ContinuityEdit (v0.1.0)

Fonte dei dati: due probe eseguiti dall'utente su **Resolve Studio 21.2.0.6 (macOS)** (elenco completo dei metodi di
Resolve/Project/MediaPool/Folder/MediaPoolItem/Timeline/TimelineItem, formato reale di `GetTranscription`, prove di
marker e `AppendToTimeline`), il README dei Workflow Integration (Electron 36, sandbox) e la conoscenza della API di
scripting. Legenda:

- **V** = verificato sui probe (esiste e/o si comporta così su 21.2.0.6)
- **E** = il metodo esiste nel probe, ma firma/comportamento non sono stati provati: **ipotesi**, coperta dalla diagnostica
- **N** = non disponibile o non affidabile: non usato, oppure solo con ripiego esplicito

Ogni chiamata incerta passa da `attempt()` nel bridge (`core/src/bridge/resolveBridge.js`): non lancia mai, restituisce
`{ok:false, reason}` e la UI mostra un messaggio in italiano con un rimedio. **Diagnostica** (menu ⋯ > Diagnostica)
prova tutte le firme qui sotto e salva `~/Desktop/continuityedit_diag.json`: è il file da mandare dopo il collaudo.

## Lettura del Media Pool e delle clip

| Uso | Chiamata | Stato | Ripiego |
|---|---|---|---|
| Progetto corrente, nome, id | `ProjectManager.GetCurrentProject()`, `Project.GetName()`, `Project.GetUniqueId()` | V (metodi nel probe) | senza id si confronta solo il nome |
| Cambio di progetto a pannello aperto | poll di nome+id ogni 4 s (`checkProject`) | V/E | — |
| Bin di scena | `Folder.GetSubFolderList()`, `GetClipList()`, `GetName()` | V | — |
| Clip selezionate | `MediaPool.GetSelectedClips()` | V | clip della cartella corrente |
| Proprietà | `GetClipProperty('FPS'/'Frames'/'Duration'/'Start TC'/'File Path'/'Proxy Media Path'/'Video Codec')` | V (valori nel probe) | `Duration` se `Frames` manca |
| Stato trascrizione della clip | `GetClipProperty('Transcription Status')` = `'Transcribed'` | V | `GetTranscription()` solo se la proprietà non esiste |
| Testo trascritto | `MediaPoolItem.GetTranscription()` → `{language, segments[{start,end,words[{start,end,text}],text,speaker?}]}`, TC assoluti | V | `None` = non trascritta |
| Avvio trascrizione | `MediaPoolItem.TranscribeAudio()` → `True` | V | `False` = nessun audio |
| Stato del job | `Project.GetTranscribeAudioStatus()` → `{JobStatus}` | V | **`MediaPoolItem.GetTranscribeAudioStatus` NON esiste** (la v0.0.2 lo usava: lo stato restava sempre "Inactive") |
| Indice clip per id | visita unica del Media Pool, poi cache validata con `GetUniqueId()` | V | riindicizza se la clip sparisce |

Timecode: drop-frame gestito (`;` nel TC a 29.97/59.94). Frame relativi alla clip (verificato: marker e
`AppendToTimeline` usano frame relativi alla clip, fine esclusa).

## Marker

| Uso | Chiamata | Stato |
|---|---|---|
| Ancore e still come marker sulla clip | `MediaPoolItem.AddMarker(frame, color, name, note, duration, customData)` | V |
| Lettura / rimozione | `GetMarkers()`, `DeleteMarkerAtFrame`, `DeleteMarkerByCustomData` | V |
| `GetMarkerByCustomData`, `UpdateMarkerCustomData` | presenti | E (diagnostica) |
| Marker delle righe sulla timeline dopo il montaggio | `Timeline.AddMarker(frameRelativoAllInizioTimeline, 'Blue', …, customData 'ce:line:<id>')` | V (probe 2: frame relativo) |

`writeMarkers` toglie solo i marker di sync `ce:<riga>:<bordo>`: gli still (`ce:still:`) e i marker dell'utente restano.

## Montaggio in timeline

| Uso | Chiamata | Stato | Note / ripiego |
|---|---|---|---|
| Timeline nuova | `MediaPool.CreateEmptyTimeline(nome)` | V | nome occupato → suffisso " 2", " 3"… |
| Renderla corrente | `Project.SetCurrentTimeline(tl)` | E | `AppendToTimeline` lavora sulla timeline corrente |
| Inizio timeline | `Timeline.GetStartFrame()` (90000 per 01:00:00:00 a 25 fps) | V | `GetStartTimecode()`, poi 0 |
| Fine del contenuto (accoda) | max di `TimelineItem.GetEnd()` su tutte le tracce | V | — |
| Livelli V2/V3 | `Timeline.AddTrack('video')`, `GetTrackCount` | E | livello mancante → pezzo saltato con motivo |
| Pezzi | `MediaPool.AppendToTimeline([{mediaPoolItem, startFrame, endFrame, trackIndex, recordFrame, mediaType}])` | V senza trackIndex/recordFrame; **E** con | `recordFrame` ora **assoluto** (v0.0.2 passava 0: i pezzi finivano prima dell'inizio timeline) |
| Master con audio collegato | stessa voce **senza** `mediaType` | E | ripiego automatico: video (1) e audio (2) separati |
| fps clip ≠ fps timeline | durate convertite nel piano (`makeConv`) | — | una clip a 50 fps su timeline a 25 dura la metà dei frame sorgente |

La diagnostica crea una timeline temporanea, mette un pezzo con `recordFrame = inizio + 50` e rilegge `GetStart()`
(`placedAt` deve valere `expected`), prova la voce senza `mediaType`, un marker di timeline, poi la elimina e rimette
corrente la timeline dell'utente.

## Timeline: indicatori "già usato" e "Segui timeline"

| Uso | Chiamata | Stato | Ripiego |
|---|---|---|---|
| Pezzi montati | `GetItemListInTrack('video', n)`, `TimelineItem.GetMediaPoolItem/GetStart/GetEnd/GetSourceStartFrame/GetSourceEndFrame` | V (probe 2: start 90000, src 250..500) | senza `GetSourceEndFrame` si usa la durata |
| Playhead | `Timeline.GetCurrentTimecode()` | E | messaggio: "pagina Edit o Cut" |
| Pezzo sotto il playhead | `Timeline.GetCurrentVideoItem()` | E | scansione delle tracce dall'alto |
| Clic su una riga = sposta il playhead | `Timeline.SetCurrentTimecode(tc)` | E | funziona solo nelle pagine Cut/Edit/Color/Fairlight/Deliver |

Il renderer interroga l'uso ogni 7 s e il playhead ogni 0,9 s **solo** con "Segui timeline" attivo e finestra visibile.

## Media Pool: scrittura (sempre su richiesta, mai distruttiva)

| Uso | Chiamata | Stato | Regola |
|---|---|---|---|
| Parole chiave | `GetMetadata('Keywords')` / `SetMetadata('Keywords', …)` | E | si aggiungono "CE Buono", "CE B+", "CE Totale"…; si tolgono solo le vecchie "CE …" |
| Colore della clip | `GetClipColor` / `SetClipColor` | E | solo se la clip non ha già un colore |
| Flag | `GetFlagList` / `AddFlag` | E | `AddFlag` non toglie gli altri |
| "Mostra in Resolve" | `MediaPool.SetSelectedClip(item)` + `MediaPoolItem.SetMarkInOut(in, out-1, 'all')` | E | la diagnostica rilegge `GetMarkInOut` per capire se `out` è incluso |

La diagnostica scrive e **ripristina** parole chiave, colore e flag sulla clip selezionata.

## Media nel pannello (lettore, miniature)

Il renderer non legge file: il main registra `ce-media://clip/<token>` (Range, CORS) solo per i percorsi restituiti da
`File Path` / `Proxy Media Path`. Chromium in Electron 36 decodifica H.264, HEVC (macOS), VP9/AV1, AAC/PCM; **non**
ProRes, DNxHD/HR, BRAW, MXF. Ripieghi: proxy → messaggio con rimedio ("Genera media proxy" H.264/H.265) → "Mostra in
Resolve". Se il contenitore si apre ma il video no (ProRes in .mov), il lettore resta utilizzabile in **solo audio**.
L'audio è quello del file: se in Resolve l'audio è sincronizzato da un registratore esterno, nel pannello si sente
l'audio di camera (la diagnostica registra `GetAudioMapping()` per valutare in futuro l'audio collegato).

## Cosa NON si può fare (e come si ripiega)

- **Visore sorgente / suo playhead**: nessuna API → lettore integrato nel pannello.
- **Interrompere una trascrizione** avviata: nessuna API → "Interrompi" smette solo di aspettare e di allineare.
- **Sottotitoli dallo script**: `CreateSubtitlesFromAudio` crea sottotitoli dall'audio, non da un testo; non esiste un
  export/import SRT diretto (probe: `EXPORT_SRT = None`). Il pannello genera un file `.srt` dalle battute del montaggio e
  prova `MediaPool.ImportMedia([srt])` (**E**, sperimentale); se non riesce: File > Importa > Sottotitoli.
- **Commutazione multicam live**: niente regia live; master su V1 + cutaway su V2/V3.
- **ExportFrame**: non serve più (gli still si leggono dal video); resta un'azione esplicita facoltativa, provata in diagnostica.
- **Metodi nuovi del probe 21.2** (`GetItemsInTrack`, `GetClips`, `GetSubFolders`, `MoveItems`, `GetTimeline`…): non
  documentati; non usati finché non se ne conosce la firma.
