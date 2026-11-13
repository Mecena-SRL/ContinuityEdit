# Contratti dati del core (JavaScript, ESM, Node >= 20)

Tutto il core è puro (nessuna chiamata a Resolve), testato con `node --test core/test/`.
Dipendenze ammesse: `fast-xml-parser`, `pdfjs-dist` (già installate). Nuove dipendenze solo MIT/BSD/Apache e solo se indispensabili.
Codice commentato in italiano o inglese, nomi in inglese. Ogni modulo ha test in `core/test/`.

## Tempo
- Tutti i frame nel core sono **interi relativi all'inizio della clip** (0 = Start TC della clip), al `fps` della clip.
- Resolve restituisce timecode ASSOLUTI `HH:MM:SS:FF`; il core li converte con `tcToFrames(tc, fps, startTcFrames)` = `((h*3600+m*60+s)*fpsNominal + ff) - startTcFrames`. `fpsNominal` = round(fps) (23.976→24, 29.97→30; non-drop-frame per ora).
- Verificato su Resolve Studio 21.2: i marker di clip usano frame relativi alla clip; `AppendToTimeline` con `startFrame/endFrame` è relativo alla clip, fine esclusa.

## TranscriptDoc (da `parseResolveTranscript(json, {clipId, fps, startTcFrames})`)
Input = dizionario di `MediaPoolItem.GetTranscription()`: `{language, segments:[{start,end,words:[{start,end,text}],text,speaker?}]}`.
```
{
  clipId, language, fps, startTcFrames,
  words: [{ i, text, tokens: string[], startFrame, endFrame, speaker: string|null, seg: number }],
  gaps:  [{ startFrame, endFrame }],        // segmenti/parole "(...)" = non-parlato o inaudibile
  segments: [{ startFrame, endFrame, speaker, firstWord, lastWord }]
}
```
Note sul formato reale: il testo delle parole ha spazio iniziale (" Questa"); "(...)" è un segmento intero oppure una parola dentro un segmento; l'`end` di una parola spesso copre la pausa seguente (usare `startFrame` come ancora affidabile); possono esserci parole di durata 0; errori ASR frequenti su nomi propri.

## ScriptDoc (da `parseFdx(xmlString)` e `parsePdf(buffer)`)
```
{
  title, source: 'fdx'|'pdf',
  scenes: [{ id, heading, lineIds: string[] }],
  lines:  [{ id: 'L0001', order, type: 'scene'|'action'|'character'|'dialogue'|'parenthetical'|'transition',
             character: string|null, text, sceneId }]
}
```
- Ogni battuta = una riga `dialogue` con `character` valorizzato e `text` = paragrafi di dialogo concatenati (senza parentetiche). Solo le `dialogue` si allineano.
- Dual dialogue: due righe separate in ordine. "(CONT'D)", "(V.O.)" ecc. rimossi dal nome personaggio ma conservati in `characterExt`.
- Il parser PDF deve restituire anche `warnings: string[]` e un campo `confidence` 0..1 per riga, per l'anteprima di correzione manuale.

## Alignment (da `alignClip(scriptDoc, transcriptDoc, opts)` → `AlignResult`)
```
{
  coverages: [{ lineId, clipId, takeIndex, startFrame, endFrame, scriptWords, matchedWords, ratio,
                missingWordIdx: number[], extraWordCount, source: 'auto' }],
  unmatched: [{ startFrame, endFrame, text }]   // parlato non presente nello script (improvvisazione)
}
```
- Una clip può coprire righe in ordine qualsiasi e la stessa riga più volte (take multipli → `takeIndex` crescente).
- Algoritmo: allineamento locale (Smith-Waterman) token-per-token con similarità di Levenshtein normalizzata sulla parola; la finestra di ricerca si restringe con le righe candidate. Token da `splitTokens`.

## Anchors / SyncModel (`core/src/sync/`, import da `core/src/sync/index.js`)
Modello puro (nessun Resolve). Frame interi relativi alla clip; intervalli e ancore `end` con **fine ESCLUSA** (come `AppendToTimeline`).
**Righe sincronizzabili: `dialogue` E `action`** (opzionalmente `scene`, `syncableLines(project,{includeScenes})`): le sceneggiature reali sono spesso mute. `alignClip` copre solo le `dialogue`; le `action` (e tutto il resto) si ancorano a mano.

**SyncProject** `{version:2, scriptDoc, clips:{clipId:{fps,durationFrames,startTcFrames,name}}, takes:[Take], anchors:[], selection:{lineId:takeId}, notes:{lineId|takeId:string}, marks, gradePalette, sequence, board}` (v2: vedi "Estensioni v2" sotto)
- `createProject(scriptDoc)`, `addClip(p, clipId, {fps,durationFrames,startTcFrames,name})`, `addTake(p,{id?,clipId,label})`, `setSelection(p,lineId,takeId|null)`, `setNote(p,key,text)`.
- `serialize(p,{pretty})` / `deserialize(stringOrObject)`: JSON versionato; valida riferimenti incrociati e lancia `Error("Progetto non valido: ...")`; migra v0 (campi assenti) -> v1 -> v2 (default per i campi nuovi); versioni future rifiutate.

**Anchor** `{id, takeId, lineId, edge:'start'|'end'|'point', frame, kind:'manual'|'auto', ratio?}` (`point` = istante rappresentativo, usato come inizio se mancano start/end).
- `addAnchor(p,{takeId,lineId,edge,frame,kind='manual',ratio})` (stessa take/riga/edge/kind = sostituzione; manual e auto convivono, **vince la manual**), `moveAnchor(p,id,frame)` (rende l'ancora manual), `removeAnchor(p,id)`, `anchorsForTake`, `effectiveAnchors(p,takeId)`.
- `checkAnchors(p,[takeId])` -> warning NON bloccanti `{type,takeId,anchorIds,message}`: `out-of-clip`, `edge-order` (end<=start), `line-order` (ordine delle righe violato), `non-syncable-line`.
- `fromAlignment(p,takeId,alignResult,{minRatio=0.6,takeIndex,replaceAuto=true})` -> `{added,skipped}`: coverage di `alignClip` -> ancore `auto` start/end con `ratio`.

**Coverage** `coverageForTake(p,takeId,{maxTailFrames=Infinity,interpolate=false})` -> `[{lineId,takeId,clipId,startFrame,endFrame,estimated,startExplicit,endExplicit,source:'manual'|'auto'|'mixed'|'interpolated',ratio,anchorIds}]` ordinata per frame.
- start/end espliciti se presenti; solo start/point: end = frame della prossima ancora di un'altra riga o fine clip (cap `maxTailFrames`); solo end: start = ancora precedente o 0; righe senza ancore ne' vicine: non coperte; frame clampati alla clip.
- `interpolate:true`: le righe senza ancore tra due righe con ancora `point` sono stimate proporzionalmente al numero di parole (`estimated:true`, `source:'interpolated'`).

**Query**: `framesForLine(p,lineId)` (coperture in tutti i take), `takesForLine`, `lineAtFrame(p,takeId,frame)`, `bestTake(p,lineId)` / `bestCoverage` (selection, altrimenti rating buono > nessuno > scarto, grade piu' alto nella `gradePalette` (vuoto < fuori palette < palette), poi non stimata > due estremi espliciti > ratio > manual > primo take).

**Assembly**: `planAssembly(p,lineIds,{handleFrames=0,mergeContiguous=true,mergeGapFrames=0})` -> `[{clipId,takeId,startFrame,endFrame,lineIds}]` (take selezionato o best; righe consecutive dello stesso take unite se contigue in avanti; handle clampati a `[0,durationFrames]`). `planAssemblyDetailed` ritorna anche `skipped:[{lineId,reason:'nessun-take'|'non-coperta'}]`.

Persistenza: JSON sidecar + marker Resolve (`customData` = `ce:<lineId>`).

## Estensioni v2 (stesso stile; tutte le operazioni MUTANO il progetto in place, salvo `script/edit.js` puro)
**Take** `{id,clipId,label,groupId:null|string,angle:null|string,rating:null|'buono'|'scarto',grade:'',tags:[],bin:null,meta?:{scene,shot,take,camera,shotType?},shot?:null|'totale'|'medio'|'stretto'|'dettaglio'|'altro',shotSource?:null|'manuale'|'metadati'|'copertura'}` (`addTake` accetta tutti i campi; `shot`/`shotSource` opzionali, valori sconosciuti diventano `null` in `deserialize`). `project.marks['takeId|lineId']={rating,grade,tags,note}`, `project.gradePalette` (default `['B','B+','B++']`).
- `setTakeMark(p,takeId,{rating?,grade?,tags?})`, `setMark(p,takeId,lineId|null,{rating?,grade?,tags?,note?})` (null = intero take; mark vuoto rimosso), `effectiveMark(p,takeId,lineId)` (il mark di copertura prevale sul take), `setGradePalette`, `setTakeGroup(p,takeId,groupId,angle)`, `setTakeShot(p,takeId,shot|null,source='manuale')`, `filterTakes(p,{rating:'buono'|'scarto'|'tutti',grades?,groupId?,bin?,tags?,lineId?})`.
- **History** (`sync/history.js`): `h=createHistory()`; `h.push(project)` PRIMA di ogni mutazione (snapshot, max 50, azzera il redo); `h.undo(project)`/`h.redo(project)` ritornano un NUOVO progetto o `null`; `canUndo/canRedo/clear/size`.

## Spoglio (`core/src/script/edit.js`, da `script/index.js`)
Pure sullo ScriptDoc, ritornano `{doc, map, created, removed}`; `map` oldId -> id che eredita ancore/note/marks (merge: seconda -> prima). Tipi: scene|action|character|dialogue|parenthetical|transition|other. Id nuovi `L####` dopo il massimo esistente; `order` rinumerato; `scenes`/`sceneId` ricostruiti (id di scena legati alla riga-intestazione).
- `setLineType(doc,lineId,type,{character?})`, `setCharacter(doc,lineId,name)` (parseCharacter: `character` + `characterExt`), `splitLine(doc,lineId,offset)` (id sulla prima parte), `mergeLines(doc,[ids contigui])`, `retypeSelection(doc,lineId,start,end,type,{character?})` (porzione = riga nuova; il resto tiene l'id: testo prima, altrimenti dopo; selezione totale = cambio tipo in place).
- `applyScriptEdit(project, {op:'setType'|'setCharacter'|'retypeSelection'|'split'|'merge', ...}, {history?})` -> `{map,created,removed}`: migra ancore (duplicati dopo merge: start/point min, end max), selection, notes, marks, `sequence.items[].lineIds`, `board.items[].lineId`. Errori: progetto intatto.

## Sequenza (`core/src/sequence/`) e Lavagna (`core/src/board/`)
**Modello "rough cut a linee verticali"**: V1 = master (un take continuo sulle righe scelte, `role:'master'`, `recordFrame` contiguo); V2, V3... = cutaway (solo video) di un altro take/camera su un intervallo di righe, posizionati dove il master e' su `fromLineId`; il master prosegue sotto (audio compreso).
**Item** `{id:'I1',kind:'line'|'clip',lineIds,takeId,clipId,startFrame,endFrame(ESCLUSA),track(1=V1),role:'master'|'cutaway'|'angle'(|'main' legacy = master),recordFrame:null|number,note, master: lineStarts:{lineId:frameSorgenteInizioRiga}, cutaway: fromLineId,toLineId,startOffsetFrames,endOffsetFrames}`; in/out clampati a `0 <= start < end <= durationFrames`.
- `sequenceFromLines(p,lineIds,{handleFrames,mergeContiguous})` -> item master su V1 (usa `planAssemblyDetailed`; sostituisce `project.sequence`; `sequenceFromLinesDetailed` -> `{sequence,skipped}`), `addItem(p,spec)`, `moveItem(p,id,{index?,track?})`, `trimItem(p,id,{startFrame?,endFrame?})`, `removeItem`, `reorder(p,ids)`.
- `addCutaway(project, sequence|null, {takeId,fromLineId,toLineId=fromLineId,startOffsetFrames=0,endOffsetFrames=0,track?,note?})`: start = inizio copertura (`coverageForTake`) di fromLineId + offset, end = fine copertura di toLineId + offset, clamp alla clip; `track` omesso = primo livello >= 2 libero (nessuna sovrapposizione nel tempo di timeline); righe in ordine inverso vengono riordinate; errore `il take "T" non copre la riga "L"` se manca la copertura.
- `trimCutaway(project, sequence|null, itemId, {fromLineId?,toLineId?,startOffsetFrames?,endOffsetFrames?,track?})` (NB: prende anche `project` per leggere le coperture): sposta gli estremi su altre righe o in frame; su errore l'item resta invariato.
- `toAppendPlan(sequence,{startFrame=0,withAudio=false,audioTrack=1})` -> `[{takeId,clipId,startFrame,endFrame,trackIndex,recordFrame,mediaType:1|2}]`: master con recordFrame contiguo da `startFrame`; cutaway con `recordFrame = startFrame + recordFrame del master alla riga fromLineId (inizio copertura) + startOffsetFrames` (min 0), durata = end-start sorgente, SEMPRE solo video; audio (mediaType 2) solo per i master. `toAppendPlanDetailed` -> `{plan, skipped:[{itemId,reason:'master-assente-sulla-riga'}]}`.
- (Legacy, fuori contratto) `directorCut(p,{groupId,switches,range,layered})`: tagli a tempo tra angoli; non usato dalla UI.
- **Board** item `{id:'B1',type:'still'|'note',takeId?,frame?,imagePath?,x,y,w,h,z,caption,lineId,color?}` (default still 160x90): `addStill`, `addNote`, `moveItem(p,id,{x,y})`, `resizeItem`, `setCaption`, `bringToFront`, `removeItem` (toglie i link), `linkItems(p,from,to)`, `boardToSequence(p,{order:'x'|'y'|'z'|'explicit',ids?,holdFrames=50})` (solo gli still; in/out centrati sul frame e spostati dentro la clip; ordine x poi y, z).

## Bridge Resolve (fase successiva, fuori da `core/`)
Marker: `AddMarker(frame, color, name, note, duration, customData)`. Timeline: `AppendToTimeline([{mediaPoolItem, startFrame, endFrame}])` (fine esclusa). Trascrizione: `TranscribeAudio()` → `GetTranscription()` (async: `GetTranscribeAudioStatus()` → `{'JobStatus': 'Inactive'|'Complete'|...}`).

**Scansione clip** (`core/src/sync/groups.js`, puro, non modifica il progetto): `suggestShotFromMetadata({shotType,shot,angle,name})` → `{shot,source:'metadati',from,match}|null`; `detectGroupsByCoverage(p,{minOverlap=0.6,durationTolerance=0.35,minShared=2,excludeTakeIds,usedGroupIds})` → `[{groupId,takeIds,reason,confidence}]` (take senza gruppo, stesso bin, righe dialogue/action coperte in comune ≥ minOverlap del più piccolo, durata in secondi simile); `mergeGroupProposals(...liste)` (scarta le proposte i cui take sono già in una precedente); `suggestMaster(p,groupId)` / `suggestMasterAmong(p,takeIds)` → `{takeId,reason}|null` (totale noto, poi più righe, poi durata); `suggestGroupShots(p,groupId)` → ipotesi `'stretto'` con `shotSource:null` per i non-master senza inquadratura.
