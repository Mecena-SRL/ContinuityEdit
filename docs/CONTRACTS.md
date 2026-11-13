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

## Anchors / SyncModel (fase successiva)
`{ clipId, lineId, wordIdx|null, frame, kind: 'manual'|'auto' }`; interpolazione lineare tra ancore consecutive di una clip; persistenza in JSON sidecar + marker Resolve (`customData` = `ce:<lineId>`).

## Bridge Resolve (fase successiva, fuori da `core/`)
Marker: `AddMarker(frame, color, name, note, duration, customData)`. Timeline: `AppendToTimeline([{mediaPoolItem, startFrame, endFrame}])` (fine esclusa). Trascrizione: `TranscribeAudio()` → `GetTranscription()` (async: `GetTranscribeAudioStatus()` → `{'JobStatus': 'Inactive'|'Complete'|...}`).
