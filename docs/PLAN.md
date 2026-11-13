# ContinuityEdit — Piano (bozza v0.1)

Plugin per DaVinci Resolve Studio 21.x che replica il modello di montaggio "ScriptSync" di Avid Media Composer.
Stato: ricerca conclusa, nessun codice ancora. Molte firme API NON sono verificate (nessun accesso a Resolve né a avid.com/blackmagicdesign.com dalla sandbox): vedi Fase 0.

## 1. Cosa fa ScriptSync (da replicare)
MVP:
1. Import sceneggiatura (FDX, PDF) → struttura scena / personaggio / dialogo / azione.
2. Vista script con righe selezionabili; click = apre la clip nel punto corrispondente.
3. Linee verticali di copertura per take accanto alle righe (quale clip copre quale battuta).
4. Confronto take sulla stessa battuta; scelta del take preferito.
5. Drag/azione "inserisci righe in timeline" → taglio con in/out della copertura.
6. Ricerca testuale nello script; note per riga/take.
Avanzate: reimport di revisioni con diff e rimappatura, indicatori "già usato in sequenza", rilevamento improvvisazioni, ricerca fonetica (PhraseFind), export report.
Nota: IntelliScript di Resolve 20/21 copre già "copione → timeline con best take" ma solo da UI, non scriptabile e senza vista di copertura/confronto per battuta. Il nostro valore: vista di copertura, confronto take, sync manuale, controllo.

## 2. Scelte confermate dall'utente
- Resolve Studio.
- Trascrizione nativa di Resolve (niente Whisper locale) + **allineamento manuale tramite marker/ancore** tra sceneggiatura e clip, così clip più lunghe/corte del previsto o script per materiale **muto** restano utilizzabili.
- Formati: Final Draft (.fdx) e PDF (italiano/inglese implicito).
- Uso: fiction e documentari.

## 3. Modello di sync (cuore del plugin)
- Ogni clip ha una lista di **ancore**: (riga/parola dello script ↔ frame/timecode della clip). Tra due ancore si interpola linearmente; fuori dalle ancore si usa la trascrizione.
- Fonti di ancora: (a) auto da trascrizione+fuzzy match, (b) manuali (click riga + posizione playhead), (c) sincronizzate come marker Resolve con `customData` = id riga.
- Muto/senza audio: solo ancore manuali; la copertura si disegna dall'intervallo tra ancore.
- Copertura = intervalli [riga_a, riga_b] per take; più take sulla stessa riga → confronto.
- Persistenza: sidecar JSON nel progetto + marker nel Media Pool (resiste a reimport).

## 4. Architettura (proposta)
- **Workflow Integration Plugin (Electron, solo Studio)**: UI in HTML/JS, tutto in JavaScript, nessun Python/modelli da distribuire.
- Moduli: `parser-fdx` (XML), `parser-pdf` (pdf.js + euristica indentazione + anteprima correzione), `aligner` (normalizzazione IT/EN, Smith-Waterman su parole, rapidfuzz-equivalente), `sync-model` (ancore/interpolazione/copertura), `resolve-bridge` (API), `ui` (script view, copertura, confronto take, timeline insert).
- Fallback script Python di probe/utility esterni per test.

## 5. Rischio principale (da risolvere per primo)
I ricercatori NON hanno trovato un getter ufficiale per il **testo** della trascrizione nativa (c'è `TranscribeAudio()` / `ClearTranscription()`, async da 21.1.1). Se manca:
- Piano B1: `Timeline.CreateSubtitlesFromAudio()` + export SRT, poi parse dell'SRT (testo+timecode).
- Piano B2: import manuale di SRT/testo di trascrizione esportato dall'UI.
- Piano B3: motore ASR esterno (faster-whisper/whisper.cpp) come opzione.
Inoltre: fonti discordanti sullo scripting nella Free 21.1+ (irrilevante: usiamo Studio).

## 6. Fasi e agenti
Convenzione: esperti = Sonnet 5.5 effort medio; lavori lunghi/ripetitivi delegati a Haiku 5.5.
- **Fase 0 – Spike API (utente + agente)**: script di probe da lanciare in Resolve 21.2 che elenca i metodi di MediaPoolItem/Timeline/MediaPool, testa getter trascrizione, async API, AddMarker, AppendToTimeline con in/out, Export SRT. Esito → decide Piano A/B.
- **Fase 1 – Parser**: FDX, PDF (con corpus di test). Esperto parser; Haiku per generare/validare fixture.
- **Fase 2 – Aligner + sync-model**: algoritmo, test unitari su dialoghi IT/EN con improvvisazioni/ripetizioni.
- **Fase 3 – Resolve bridge + persistenza**.
- **Fase 4 – UI** script view, copertura, confronto, insert in timeline.
- **Fase 5 – Revisioni script, indicatori uso, report**.
- Trasversale: revisione codice, test, packaging/installer (Win/Mac).

## 7. Domande aperte
Vedi messaggio in chat.

## 8. Esito Fase 0 (Resolve Studio 21.2.0.6, macOS) — probe 1
- `MediaPoolItem.GetTranscription()` e `SetTranscription()` ESISTONO (non erano documentati dagli esperti). Su clip non trascritta `GetTranscription()` restituisce `None`. Formato del risultato: da verificare col probe 2.
- Esistono `TranscribeAudio`/`ClearTranscription` (anche su Folder), `Project.GetTranscribeAudioStatus`, `Project.GetCreateSubtitlesFromAudioStatus`.
- Marker (`AddMarker`, `GetMarkers`, `*ByCustomData`, `UpdateMarkerCustomData`) su MediaPoolItem, Timeline e TimelineItem. `AppendToTimeline`, `CreateTimelineFromClips`, `ImportTimelineFromFile`, `Timeline.Export` presenti. `Timeline.CreateSubtitlesFromAudio` presente.
- `TimelineItem` ha `GetSourceStartFrame/EndFrame`, `AddTake/SelectTakeByIndex` (utile per i take alternativi).
- Piano A confermato in via di principio: niente Whisper, testo dalla trascrizione nativa.
- Attenzione: clip con Start TC 01:00:00:00 a 25 fps (`Start`=0, `End`=7762); la timeline parte dal frame 90000. Va chiarito se i marker usano frame relativi alla clip o assoluti (probe 2).
