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

**SyncProject** `{version:1, scriptDoc, clips:{clipId:{fps,durationFrames,startTcFrames,name}}, takes:[{id,clipId,label}], anchors:[], selection:{lineId:takeId}, notes:{lineId|takeId:string}}`
- `createProject(scriptDoc)`, `addClip(p, clipId, {fps,durationFrames,startTcFrames,name})`, `addTake(p,{id?,clipId,label})`, `setSelection(p,lineId,takeId|null)`, `setNote(p,key,text)`.
- `serialize(p,{pretty})` / `deserialize(stringOrObject)`: JSON versionato; valida riferimenti incrociati e lancia `Error("Progetto non valido: ...")`; migra v0 (campi assenti) -> v1; versioni future rifiutate.

**Anchor** `{id, takeId, lineId, edge:'start'|'end'|'point', frame, kind:'manual'|'auto', ratio?}` (`point` = istante rappresentativo, usato come inizio se mancano start/end).
- `addAnchor(p,{takeId,lineId,edge,frame,kind='manual',ratio})` (stessa take/riga/edge/kind = sostituzione; manual e auto convivono, **vince la manual**), `moveAnchor(p,id,frame)` (rende l'ancora manual), `removeAnchor(p,id)`, `anchorsForTake`, `effectiveAnchors(p,takeId)`.
- `checkAnchors(p,[takeId])` -> warning NON bloccanti `{type,takeId,anchorIds,message}`: `out-of-clip`, `edge-order` (end<=start), `line-order` (ordine delle righe violato), `non-syncable-line`.
- `fromAlignment(p,takeId,alignResult,{minRatio=0.6,takeIndex,replaceAuto=true})` -> `{added,skipped}`: coverage di `alignClip` -> ancore `auto` start/end con `ratio`.

**Coverage** `coverageForTake(p,takeId,{maxTailFrames=Infinity,interpolate=false})` -> `[{lineId,takeId,clipId,startFrame,endFrame,estimated,startExplicit,endExplicit,source:'manual'|'auto'|'mixed'|'interpolated',ratio,anchorIds}]` ordinata per frame.
- start/end espliciti se presenti; solo start/point: end = frame della prossima ancora di un'altra riga o fine clip (cap `maxTailFrames`); solo end: start = ancora precedente o 0; righe senza ancore ne' vicine: non coperte; frame clampati alla clip.
- `interpolate:true`: le righe senza ancore tra due righe con ancora `point` sono stimate proporzionalmente al numero di parole (`estimated:true`, `source:'interpolated'`).

**Query**: `framesForLine(p,lineId)` (coperture in tutti i take), `takesForLine`, `lineAtFrame(p,takeId,frame)`, `bestTake(p,lineId)` / `bestCoverage` (selection, altrimenti non stimata > due estremi espliciti > ratio > manual > primo take).

**Assembly**: `planAssembly(p,lineIds,{handleFrames=0,mergeContiguous=true,mergeGapFrames=0})` -> `[{clipId,takeId,startFrame,endFrame,lineIds}]` (take selezionato o best; righe consecutive dello stesso take unite se contigue in avanti; handle clampati a `[0,durationFrames]`). `planAssemblyDetailed` ritorna anche `skipped:[{lineId,reason:'nessun-take'|'non-coperta'}]`.

Persistenza: JSON sidecar + marker Resolve (`customData` = `ce:<lineId>`).

## Bridge Resolve (fase successiva, fuori da `core/`)
Marker: `AddMarker(frame, color, name, note, duration, customData)`. Timeline: `AppendToTimeline([{mediaPoolItem, startFrame, endFrame}])` (fine esclusa). Trascrizione: `TranscribeAudio()` → `GetTranscription()` (async: `GetTranscribeAudioStatus()` → `{'JobStatus': 'Inactive'|'Complete'|...}`).
