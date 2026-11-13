# Plugin Resolve (Workflow Integration, Electron) — architettura e contratto

Fonte: README dei Workflow Integration di Resolve Studio (Examples/SamplePlugin). Fatti verificati:
- Il plugin è una cartella `com.<azienda>.<nome>/` con `manifest.xml` (`<Id>`, `<Name>`, `<Version>`, `<Description>`, `<FilePath>main.js</FilePath>`), `package.json`, `main.js`, `preload.js`, `index.html`.
- Cartella di installazione macOS: `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/`. Windows: `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\`. Linux non supportato per i plugin.
- Il main process fa `require('./WorkflowIntegration.node')` (binario di Blackmagic, **non va nel repository**: lo script di installazione lo copia da `<Resolve>/Developer/Workflow Integrations/Examples/SamplePlugin/`), poi `await Initialize(PLUGIN_ID)` (PLUGIN_ID = `<Id>` del manifest), `await GetResolve()`; ogni chiamata alla API Resolve va `await`-ata. `CleanUp()` alla chiusura. Callback: `RenderStart`, `RenderStop`, `ResolveQuit`.
- Electron con sandbox e context isolation: il renderer non ha Node; comunica col main solo via `preload.js` (`contextBridge.exposeInMainWorld`) e `ipcRenderer.invoke` / `ipcMain.handle`.
- Il main è CommonJS; il core (`core/src`, ESM) si carica con `await import(pathToFileURL(...))`.

## Layout
```
plugin/                      # sorgente del plugin (si installa come com.continuityedit.plugin)
  manifest.xml  package.json  main.js  preload.js        # ← esperto "bridge"
  main/*.js                                               # ← esperto "bridge" (logica del main, testabile)
  index.html  renderer/*.js  css/*.css  img/              # ← esperto "UI"
  dev/                                                    # ← esperto "UI": harness browser con window.ce simulato
core/src/bridge/resolveBridge.js                          # ← esperto "bridge": wrapper della API Resolve (resolve iniettato, solo await)
scripts/install-mac.sh  scripts/build-plugin.mjs          # ← esperto "bridge"
```
Il main ha lo stato (SyncProject del core) e il renderer è una vista sottile. Plugin ID: `com.continuityedit.plugin`.

## API esposta al renderer: `window.ce` (preload → `ipcRenderer.invoke('ce:<nome>')`)
Tutte asincrone. Errori: la promessa rifiuta con `Error(messaggio italiano)`; le operazioni che possono "non riuscire" in Resolve restituiscono `{ok:false, reason}` invece di lanciare.

**Ambiente**
- `getEnv()` → `{ resolveVersion, product, projectName, pageName, timelineName, timelineFps, isStudio }`

**Script**
- `pickScriptFile()` → `{ path, name } | null` (dialogo nativo, filtri `.fdx` `.pdf`)
- `loadScript(path)` → `{ scriptDoc, warnings, confidence }` e lo imposta nel progetto (resetta ancore se lo script cambia, chiedere conferma lato UI)

**Clip e take**
- `getSelectedClips()` → `[{ clipId, name, fps, durationFrames, startTcFrames, transcribed, markers:[{frame,color,name,note,duration,customData}] }]` (clip selezionate nel Media Pool; `clipId` = `GetUniqueId()`; marker con frame relativi alla clip)
- `addTake({ clipId, label? })` → `{ takeId }` (registra la clip nel progetto se serve)
- `removeTake(takeId)`
- `transcribeClips(clipIds)` → `{ started: string[] }`; `getTranscribeStatus()` → `{ jobStatus: 'Inactive'|'InProgress'|'Complete'|string }`
- `autoSync(takeId)` → `{ added, skipped, unmatchedCount }` (usa `GetTranscription` → `parseResolveTranscript` → `alignClip` → `fromAlignment`; sceglie la lingua dal transcript)

**Ancore manuali**
- `addAnchor({ takeId, lineId, edge, frame })`, `moveAnchor(anchorId, frame)`, `removeAnchor(anchorId)`
- `anchorFromMarker({ takeId, lineId, edge, markerFrame })` (assegna un marker di clip alla riga)
- `anchorFromPlayhead({ takeId, lineId, edge })` → `{ ok, frame?, reason? }` (usa il playhead della timeline: trova l'item della timeline che usa la clip del take e converte timeline→sorgente con `GetStart`/`GetSourceStartFrame`)

**Progetto e viste**
- `getState()` → `{ project, view }` dove `view = { lines: [{id,type,character,text,sceneId,order,syncable}], takes: [{id,clipId,label,name}], coverage: { [takeId]: coverageForTake(...) }, bestTake: { [lineId]: takeId|null }, warnings: [...] }`
- `setSelection(lineId, takeId|null)`, `setNote(key, text)`
- `saveProject()` / `loadProject()` → file sidecar `userData/projects/<projectName>.ce.json` (salvataggio automatico dopo ogni modifica)
- Evento push: `onChange(cb)` → `cb(state)` ad ogni mutazione (main → renderer via `webContents.send('ce:changed')`)

**Azioni su Resolve**
- `previewLine({ lineId, takeId })` → `{ ok, reason? }`: seleziona la clip nel Media Pool (`SetSelectedClip`) e imposta mark in/out della clip sulla copertura della riga (`SetMarkInOut`); da verificare sul campo
- `assemble({ lineIds, timelineName, handleFrames })` → `{ ok, timelineName, itemsAdded, skipped:[{lineId,reason}] }` (`planAssemblyDetailed` → `CreateEmptyTimeline` → `AppendToTimeline` con `startFrame/endFrame`, fine esclusa)
- `writeMarkers({ takeId })` → `{ ok, count }` (marker Resolve sulle clip con `customData` = `ce:<lineId>:<edge>`)
- `runDiagnostics()` → `{ ok, path }`: esegue prove sicure sulla API (letture, marker di prova ripuliti, mark in/out su una clip, timeline temporanea ripulita) e salva un JSON in `~/Desktop/continuityedit_diag.json`

## Test
- Il main e il bridge usano un oggetto `resolve` iniettato: i test (`node --test`) usano un finto Resolve con le stesse firme (async). Nessuna dipendenza da Electron nei test.
- La UI ha un harness browser (`plugin/dev/index.html` + `mockCe.js`) con `window.ce` simulato e dati sintetici; verificare con Playwright (Chromium preinstallato) e screenshot.

---
# v0.0.1+ — Estensioni (contratto v2)

Obiettivo di prodotto: flusso semplice in stile Avid ScriptSync + spoglio rapido dello script, valutazione dei take (buono/scarto, B / B+ / B++), mini-montaggio nel pannello a più livelli (multicam, "regia televisiva su sceneggiatura") e lavagna libera di still (storyboard). Flusso utente: sync/trascrizione → clip organizzate in bin per scena → si aprono uno o più bin di scena → si apre il plugin e una timeline.

## Modelli nel core (proprietario: esperto "core-ext"; puri, con test; persistiti in `SyncProject`, `version: 2` con migrazione da 1)
- **Take** (estende `takes[]`): `groupId: string|null` (stessa performance ripresa da più camere), `angle: string|null` ("CAM A"), `rating: 'buono'|'scarto'|null`, `grade: string` (''|'B'|'B+'|'B++'|libero, palette in `project.gradePalette`), `tags: string[]`, `bin: string|null`, `meta: {scene,shot,take,camera}` opzionale.
- **Marks per copertura** `project.marks[`${takeId}|${lineId}`] = { rating, grade, tags, note }`; `filterTakes(project, {rating:'buono'|'scarto'|'tutti', grades?:string[], groupId?})`, `bestTake` rispetta rating/grade (buono > nessuno > scarto).
- **Modifica sceneggiatura (spoglio)**, modulo `core/src/script/edit.js`, tutte funzioni pure che restituiscono nuovo `scriptDoc` e una mappa di migrazione degli id: `setLineType(doc, lineId, type, {character?})` (type ∈ scene|action|character|dialogue|parenthetical|transition|other), `setCharacter`, `retypeSelection(doc, lineId, startOffset, endOffset, type, {character?})` (la porzione selezionata diventa una riga nuova del tipo scelto, il resto resta; id nuovi `L####` successivi, id esistenti stabili), `splitLine`, `mergeLines`. `applyScriptEdit(project, edit)` aggiorna ancore/selezioni/note/marks con la mappa (split: ancore restano sulla prima parte; merge: confluiscono nella prima riga). Lo spoglio è annullabile (`undo` a livello di progetto: cronologia limitata a 50 modifiche).
- **Sequenza** (`project.sequence`), modulo `core/src/sequence/`: `{ id, name, items: [{ id, kind:'line'|'clip', lineIds: string[], takeId, startFrame, endFrame, track: number /*1=V1*/, role:'main'|'cutaway'|'angle', angle?: string, recordFrame: number|null, note }] }`. Operazioni: `sequenceFromLines(project, lineIds, {handleFrames, mergeContiguous})`, `addItem`, `moveItem` (cambio ordine/livello), `trimItem(id,{startFrame,endFrame})` (clamp ai limiti clip), `removeItem`, `reorder`, **Modello "master + cutaway"** (sostituisce l'idea di stacchi a tempo, non serve alcuna regia live): un take del gruppo è il *master* (il totale, V1, continuo, con audio, `role:'master'`); altri take/camere sono *cutaway* (`role:'cutaway'`, `track>=2`, solo video) che coprono un intervallo di righe `fromLineId..toLineId` con `startOffsetFrames`/`endOffsetFrames` per un gioco fine sui tempi; vengono posizionati dove il master si trova in quella riga e il master prosegue sotto. `addCutaway(project, sequence, {takeId, fromLineId, toLineId, startOffsetFrames, endOffsetFrames, track?})`, `trimCutaway(sequence, itemId, {fromLineId?, toLineId?, startOffsetFrames?, endOffsetFrames?})` (la UI le chiama trascinando gli estremi della linea verticale sul testo). `toAppendPlan(sequence, {startFrame})` → `[{ takeId, clipId, startFrame, endFrame, trackIndex, recordFrame, mediaType: 1|2 }]` con `recordFrame` ricalcolato in modo contiguo per i `main` e fine esclusa; audio mirror (mediaType 2) opzionale.
- **Lavagna** (`project.board`), modulo `core/src/board/`: `{ items:[{ id, type:'still'|'note', takeId?, frame?, imagePath?, x, y, w, h, z, caption, lineId|null, color? }], links:[{from,to}] }`. Operazioni: `addStill`, `addNote`, `moveItem`, `resizeItem`, `setCaption`, `bringToFront`, `removeItem`, `linkItems`, `boardToSequence(project, {order:'x'|'y'|'z'|'explicit', ids?})` (ogni still → item di sequenza con in/out intorno al frame, durata default `holdFrames`).

## `window.ce` — aggiunte (proprietario: esperto "bridge-ext" per main/bridge; la UI le consuma). Tutte async; `{ok:false,reason}` invece di eccezioni per i fallimenti di Resolve.
**Bin di scena**: `listBins()` → `[{ name, path, clipCount }]` (sottocartelle ricorsive del Media Pool); `loadBins(names[])` → clip dei bin (stessa forma di `getSelectedClips` + `bin` e `meta` da `Scene`/`Shot`/`Take`/`Camera #`/`Angle`) e li registra come take (`addTake`); `detectGroups()` → `[{ groupId, label, takeIds, reason }]` (stesso Shot/Take/Scene, timecode sovrapposto, nome file simile); `setTakeGroup(takeId, groupId, angle)`.
**Spoglio**: `editScript({ op:'setType'|'setCharacter'|'retypeSelection'|'split'|'merge', ... })` → state; `undo()`/`redo()`.
**Valutazione**: `setMark({ takeId, lineId|null, rating?, grade?, tags? })` (lineId null = intero take), `setGradePalette(list)`.
**Sequenza**: `sequence.fromLines(lineIds, opts)`, `sequence.addItem(item)`, `sequence.moveItem(id,{index?,track?})`, `sequence.trimItem(id,{startFrame,endFrame})`, `sequence.removeItem(id)`, `sequence.setMaster({takeId, lineIds})`, `sequence.addCutaway({takeId, fromLineId, toLineId, startOffsetFrames, endOffsetFrames, track?})`, `sequence.trimCutaway(itemId, {fromLineId, toLineId, startOffsetFrames, endOffsetFrames})`, `sequence.assemble({ timelineName, layered?, withAudio? })` → `{ ok, timelineName, itemsAdded, tracksCreated, skipped }` (crea/riusa la timeline, `AddTrack` se servono più livelli video, `AppendToTimeline` con `trackIndex`/`recordFrame`/`mediaType`).
**Lavagna**: `board.captureStill({ takeId, frame })` → `{ ok, path, via:'exportFrame'|'video'|'none', reason? }` (prima `MediaPoolItem.ExportFrame`/`ExportThumbnails`, la UI ripiega su `<video>`+canvas leggendo `getClipMediaPath`), `getClipMediaPath(takeId)` → `{ path, codec, fps }`, `board.addItem(item)`, `board.moveItem(id,{x,y})`, `board.resizeItem(id,{w,h})`, `board.setCaption(id,text)`, `board.removeItem(id)`, `board.link(from,to)`, `board.toSequence({order,ids,holdFrames})`, `saveFile({ suggestedName, dataBase64, filters })` → `{ path }|null` (export PNG/PDF della lavagna dal renderer).
**Diagnostica**: `runDiagnostics()` include anche `ExportFrame`/`ExportThumbnails` (firma e formato file), `AddTrack`, `AppendToTimeline` con `trackIndex`/`recordFrame`/`mediaType`, `CreateMulticamClip` (sola esistenza), `GetClipProperty` di `Scene`/`Shot`/`Take`/`Camera #`/`Angle`.
Il main emette `ce:changed` dopo OGNI mutazione (progetto, sequenza, lavagna).

## Limiti noti della API di Resolve (da dichiarare in UI/guida)
- Nessuna API per muovere il visore sorgente o il suo playhead: l'anteprima di una riga imposta In/Out della clip e la seleziona.
- Nessuna commutazione live: la "regia" è un assemblaggio grezzo master su V1 + cutaway su V2/V3 deciso sulle linee verticali del testo, mandato in timeline.
- Gli still di clip con codec che Chromium non decodifica (es. ProRes) richiedono `ExportFrame`; da verificare sul Mac.
