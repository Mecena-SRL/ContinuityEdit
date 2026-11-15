# Plugin Resolve (Workflow Integration, Electron) — architettura e contratto `window.ce` (v0.1.0)

Fonte: README dei Workflow Integration di Resolve Studio (Examples/SamplePlugin, Electron 36 da Resolve 20.1). Fatti verificati:
- Il plugin è una cartella `com.<azienda>.<nome>/` con `manifest.xml` (`<Id>`, `<Name>`, `<Version>`, `<Description>`, `<FilePath>main.js</FilePath>`), `package.json`, `main.js`, `preload.js`, `index.html`.
- Cartella di installazione macOS: `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/`. Windows: `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\`. Linux non supportato per i plugin.
- Il main process fa `require('./WorkflowIntegration.node')` (binario di Blackmagic, **non va nel repository**: lo script di installazione lo copia da `<Resolve>/Developer/Workflow Integrations/Examples/SamplePlugin/`), poi `await Initialize(PLUGIN_ID)`, `await GetResolve()`; ogni chiamata alla API Resolve va `await`-ata. `CleanUp()` alla chiusura. Callback: `RenderStart`, `RenderStop`, `ResolveQuit`.
- Electron con sandbox e context isolation: il renderer non ha Node; comunica col main solo via `preload.js` (`contextBridge.exposeInMainWorld`) e `ipcRenderer.invoke` / `ipcMain.handle`.
- Il main è CommonJS; il core (`core/src`, ESM) si carica con `await import(pathToFileURL(...))`.

Cosa della API di Resolve è verificato, cosa è ipotesi e come si ripiega: `docs/RESOLVE_API_NOTES.md`.

## Layout
```
plugin/
  manifest.xml  package.json  main.js  preload.js     # main Electron, protocollo ce-media://, IPC
  main/handlers.js state.js persist.js protocol.js loadCore.js   # logica del main, senza Electron (testata)
  index.html  renderer/app.js  renderer/panels/*  renderer/viewmodel/*  css/  img/   # interfaccia (viewmodel puri e testati)
  dev/   # harness browser: window.ce = VERI handler + finto Resolve (devCe.js), server con Range (serve.mjs), video sintetici
core/src/bridge/resolveBridge.js                       # wrapper della API Resolve (resolve iniettato, solo await, mai eccezioni per firme incerte)
```
Il main ha lo stato (SyncProject del core) e il renderer è una vista sottile. Plugin ID: `com.continuityedit.plugin`.
`handlers.js` non usa `require()`: l'harness lo carica nel browser così la UI si prova contro la stessa logica del plugin.

## Regole generali
- Tutti i metodi sono asincroni. Errori: la promessa rifiuta con `Error(messaggio italiano)` (il renderer toglie il prefisso tecnico dell'IPC e aggiunge un rimedio); le azioni che possono "non riuscire" in Resolve restituiscono `{ok:false, reason}`.
- Ogni mutazione passa per una **coda seriale** (mai due modifiche accavallate), salva una copia per l'undo (50 passi), ripristina il progetto se fallisce, salva il sidecar e invia `ce:changed`.
- Frame: interi relativi alla clip, intervalli con fine esclusa. I tempi della sequenza sono frame di timeline relativi all'inizio sequenza.
- `onChange(cb)` → `cb(snapshot)` dopo ogni mutazione; ritorna la funzione per annullare la sottoscrizione.

## Ambiente e progetto
- `getEnv()` → `{ resolveVersion, product, projectName, projectId, pageName, timelineName, timelineFps, isStudio }`
- `checkProject()` → `{ changed, loaded?, env }`: se in Resolve è stato aperto un altro progetto, salva il lavoro del precedente e carica il sidecar del nuovo (il renderer lo chiama ogni 4 s).
- `getState()` → `{ project, view }`, `view = { lines:[{id,type,character,text,sceneId,order,syncable,confidence?}], takes:[{id,clipId,label,name,groupId,angle,rating,grade,tags,bin,shot,shotSource}], coverage:{takeId:[...]}, bestTake:{lineId:takeId|null}, warnings, sequence:{items:[{id,track,rec,len,role,anchored,takeId,clipId,startFrame,endFrame,lineIds}], total, markers:[{recordFrame,lineId,takeId}], timelineFps}, hasScript }`
- `saveProject()` / `loadProject()` → sidecar `userData/projects/<progetto>.ce.json` (salvataggio automatico dopo ogni modifica).
- `undo()` / `redo()` → `{ok, reason?, project, view}`.

## Sceneggiatura
- `pickScriptFile()` → `{ path, name } | null` (dialogo nativo, `.fdx` `.pdf`)
- `loadScript(path, { fresh? })` → `{ scriptDoc, warnings, confidence, revision }`. Se c'era già uno script, il nuovo è una **revisione**: righe uguali o modificate conservano ancore, scelte, note, valutazioni, sequenza e lavagna; quelle tolte li perdono. `revision = {uguali, modificate, tolte, nuove, anchorsKept, anchorsDropped}` (annullabile con `undo`). `fresh:true` ricomincia (tiene clip e take).
- `scriptFromTranscripts({ takeIds? })` → `{ lines, takes, missing }`: modalità documentario, le trascrizioni diventano il copione (una scena per clip, una riga per frase, ancore esatte).
- `editScript({ op, ... })` → snapshot (spoglio: `setType`, `setCharacter`, `retypeSelection`, `split`, `merge`).

## Clip e take
- `getSelectedClips()` → `[{ clipId, name, fps, durationFrames, startTcFrames, transcribed, transcriptionStatus, markers:[...], mediaUrl }]`
- `takeStatus()` → `[{ takeId, clipId, online, transcribed, transcriptionStatus }]` (lettura leggera: una proprietà per clip)
- `listBins()` → `[{ name, path, clipCount }]`; `loadBins(names)` → clip dei bin (con `bin`, `meta`, `takeId`) registrate come take; funziona anche prima di caricare lo script.
- `addTake({ clipId, label? })` → `{ takeId, existed? }`; `removeTake(takeId)` (toglie anche ancore, pezzi di sequenza e still del take); `setTakeLabel(takeId, label)`.
- `setTakeShot({ takeId, shot, source? })`, `setTakeGroup(takeId, groupId, angle)`, `detectGroups()`, `detectGroupsByCoverage()`, `suggestMaster(groupId)` (vedi CONTRACTS.md).
- `setMark({ takeId, lineId|null, rating?, grade?, tags?, note? })`, `setGradePalette(list)`, `setSelection(lineId, takeId|null)`, `setNote(key, text)`.

## Trascrizione, sync e ricerca
- `transcribeClips(clipIds)` → `{ started, failed:[{clipId,reason}] }` (`MediaPoolItem.TranscribeAudio`)
- `getTranscribeStatus()` → `{ jobStatus:'Inactive'|'InProgress'|'Complete'|..., done:[clipId], pending:[clipId] }` (stato del **progetto** + proprietà `Transcription Status` delle clip)
- `autoSync(takeId)` → `{ added, skipped, unmatchedCount, language, mute? }`
- `getTranscript({ takeId, refresh? })` → `{ ok, language, words:[{text,startFrame,endFrame,speaker}] }` (lettore: karaoke e striscia del parlato)
- `searchSpeech({ query, takeIds?, limit? })` → `{ hits:[{takeId,startFrame,endFrame,score,before,match,after,lineId}], searched, untranscribed }` (equivalente di PhraseFind: tollera errori ASR e grafie diverse)

## Ancore
- `addAnchor({ takeId, lineId, edge, frame })` → `{ anchorId, frame }`, `moveAnchor(anchorId, frame)`, `removeAnchor(anchorId)`
- `anchorFromMarker({ takeId, lineId, edge, markerFrame })`, `anchorFromPlayhead({ takeId, lineId, edge })` → `{ ok, frame?, reason? }`

## Resolve: timeline, Media Pool, marker
- `previewLine({ lineId, takeId })` e `revealInResolve({ takeId, startFrame, endFrame })` → `{ok, reason?}`: "Mostra in Resolve" (seleziona la clip nel Media Pool con In/Out).
- `timelineUsage()` → `{ ok, timelineName, items, usedLines:{lineId:[takeId]}, usedTakes:{takeId:n} }`: righe già montate nella timeline corrente (indicatori stile Avid).
- `timelinePlayhead()` → `{ ok, timecode, takeId, frame, lineId }`: riga sotto il playhead ("Segui timeline").
- `seekTimeline({ takeId, lineId?|frame? })` → `{ ok, timecode?, reason? }`: porta il playhead della timeline su quella riga/frame (se montata).
- `writeMarkers({ takeId })` → `{ ok, count }`: ancore come marker sulla clip (`customData` `ce:<lineId>:<edge>`; gli still non vengono toccati).
- `writeToResolve({ takeIds?, keywords, clipColor, flags, overwriteColor })` → `{ ok, count, results }`: valutazioni/inquadrature nel Media Pool, non distruttivo (parole chiave "CE …", colore solo se assente, flag in aggiunta).
- `assemble({ lineIds, timelineName, handleFrames })` (legacy: righe in coda in una timeline nuova).
- `runDiagnostics()` → `{ ok, path, report }`: prove sicure di tutte le firme usate, rapporto JSON sul Desktop.

## Sequenza (mini-montaggio)
Regole: **V1 continua** (inserire, togliere o accorciare sposta i successivi), **V2+ libere** (un pezzo nuovo sovrascrive cio' che trova sotto); un cutaway "agganciato alle righe" segue il master, spostarlo a mano lo rende libero.
- `sequence.fromLines(lineIds, opts)` → `{ itemCount, skipped }` (montaggio grezzo: per ogni riga il take scelto o migliore)
- `sequence.setMaster({ takeId, lineIds })`, `sequence.addCutaway({ takeId, fromLineId, toLineId, startOffsetFrames, endOffsetFrames, track? })`, `sequence.trimCutaway(itemId, patch)`
- Editor: `sequence.place({ takeId, startFrame, endFrame, track, recordFrame, mode:'insert'|'overwrite' })` → `{ itemId }`, `sequence.split(itemId, atRecord)` → `{ leftId, rightId }`, `sequence.move(itemId, { recordFrame?, track? })`, `sequence.trimEdge(itemId, 'start'|'end', delta)`, `sequence.removeItem(itemId)`, `sequence.clear()`
- Legacy: `sequence.addItem(spec)`, `sequence.moveItem(id, {index?, track?})`, `sequence.trimItem(id, {startFrame, endFrame})`
- `sequence.assemble({ plan?, timelineName, withAudio=true, mode:'auto'|'new'|'append', lineMarkers=true })` → `{ ok, timelineName, itemsAdded, tracksCreated, markersAdded, baseFrame, skipped }`. I `recordFrame` del piano sono relativi: il bridge aggiunge l'inizio della timeline (`GetStartFrame`, es. 90000) o la fine del contenuto (`append`). Master con audio collegato (ripiego: video e audio separati). Marker blu sulle righe (`ce:line:<id>`).
- `sequence.subtitles({ save?, importToResolve? })` → `{ ok, cues, srt, saved?, imported? }`: sottotitoli SRT dalle battute del master (import nel Media Pool sperimentale).

## Lavagna
`board.addStill({ takeId, frame, lineId? })` → `{ ok, itemId, markerWritten }` (still = marker Cyan `ce:still:<id>` + lettura del frame dal video, nessun file), `board.addItem(item)`, `board.moveItem(id,{x,y})`, `board.resizeItem(id,{w,h})`, `board.setCaption(id,text)`, `board.bringToFront(id)`, `board.removeItem(id)`, `board.link(from,to)`, `board.toSequence({order,ids,holdFrames})`, `board.refreshStillViaResolve(id)` (facoltativo, `ExportFrame`), `getClipMediaPath(takeId)` → `{ ok, path, proxyPath, codec, fps, startTcFrames, url, proxyUrl }`, `saveFile({ suggestedName, dataBase64, filters })` → `{ path }|null`.

## Media nel renderer: `ce-media://`
Il main registra un protocollo `ce-media://clip/<token>` (standard, secure, supportFetchAPI, corsEnabled, stream, Range) che serve **solo** i file registrati da `getClipMediaPath`/`loadBins` (token opaco, mai un percorso nell'URL). Il lettore e le miniature usano solo gli URL restituiti dal main. Codec non decodificabili da Chromium (ProRes, DNx, BRAW, MXF): si prova il proxy (`Proxy Media Path`), poi messaggio chiaro con "Mostra in Resolve".

## Test e harness
- `npm test`: core, bridge e handler contro un finto Resolve con le firme reali (`core/test/helpers/fakeResolve.js`), viewmodel del renderer, coerenza del contratto (ogni `ce.*` usato dalla UI ha preload, handler e voce in questo documento).
- Harness: `bash plugin/dev/make-samples.sh` (video sintetici, ffmpeg), `node plugin/dev/serve.mjs`, poi `http://127.0.0.1:8799/plugin/dev/index.html?seed=1` (`?rev=1` revisione dello script, `?devbar=1` playhead simulato).

## Limiti della API di Resolve (dichiarati in UI e guida)
- Nessuna API per il visore sorgente: il lettore del pannello lo sostituisce; "Mostra in Resolve" seleziona la clip con In/Out.
- Nessuna commutazione multicam live: il montaggio è master su V1 + cutaway su V2/V3.
- La trascrizione già avviata in Resolve non si può interrompere dalla API.
