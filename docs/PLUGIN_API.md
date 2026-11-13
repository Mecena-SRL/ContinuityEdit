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
