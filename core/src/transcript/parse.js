// Parser della trascrizione di Resolve (MediaPoolItem.GetTranscription()) -> TranscriptDoc.
import { splitTokens } from '../text/normalize.js';
import { tcToFrames } from './timecode.js';

// Testo tra parentesi, es. "(...)" = non-parlato/inaudibile.
const isGapText = (t) => /^\(.*\)$/.test(t);

const asText = (v) => (typeof v === 'string' ? v.trim() : '');

function speakerOf(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (typeof c === 'number') return String(c);
  }
  return null;
}

/**
 * @param {object} json dizionario {language, segments:[...]} (anche null/malformato)
 * @param {{clipId, fps, startTcFrames?}} opts
 * `seg` di ogni parola è l'indice in `segments` del TranscriptDoc (segmenti senza
 * parole parlate, es. "(...)", non entrano in `segments` ma in `gaps`).
 */
export function parseResolveTranscript(json, { clipId, fps, startTcFrames = 0 } = {}) {
  const doc = {
    clipId,
    language: typeof json?.language === 'string' ? json.language : null,
    fps,
    startTcFrames,
    words: [],
    gaps: [],
    segments: [],
  };
  const rawSegs = Array.isArray(json?.segments) ? json.segments : [];
  const f = (tc) => tcToFrames(tc, fps, startTcFrames);

  for (const seg of rawSegs) {
    if (!seg || typeof seg !== 'object') continue;
    const segStart = f(seg.start);
    const segEnd = f(seg.end);
    const rawWords = Array.isArray(seg.words) ? seg.words : [];

    // Segmento intero di non-parlato (senza parole).
    if (rawWords.length === 0) {
      if (isGapText(asText(seg.text)) && segStart !== null && segEnd !== null) {
        doc.gaps.push({ startFrame: segStart, endFrame: Math.max(segStart, segEnd) });
      }
      continue;
    }

    const segIndex = doc.segments.length;
    const gapsBefore = doc.gaps.length;
    let first = -1;
    let last = -1;
    for (const w of rawWords) {
      if (!w || typeof w !== 'object') continue;
      const text = asText(w.text);
      if (!text) continue;
      const s = f(w.start);
      if (s === null) continue;
      const e0 = f(w.end);
      const e = e0 === null ? s : Math.max(s, e0);
      if (isGapText(text)) {
        doc.gaps.push({ startFrame: s, endFrame: e });
        continue;
      }
      const tokens = splitTokens(text);
      if (tokens.length === 0) continue; // solo punteggiatura
      const i = doc.words.length;
      doc.words.push({
        i,
        text,
        tokens,
        startFrame: s,
        endFrame: e,
        speaker: speakerOf(w.speaker, seg.speaker),
        seg: segIndex,
      });
      if (first < 0) first = i;
      last = i;
    }

    if (first < 0) {
      if (doc.gaps.length > gapsBefore) continue; // già registrato dalle parole "(...)"
      // Nessuna parola parlata: se il segmento è "(...)" è un gap.
      if (isGapText(asText(seg.text)) && segStart !== null && segEnd !== null) {
        doc.gaps.push({ startFrame: segStart, endFrame: Math.max(segStart, segEnd) });
      }
      continue;
    }
    const startFrame = segStart ?? doc.words[first].startFrame;
    const endFrame = Math.max(startFrame, segEnd ?? doc.words[last].endFrame);
    doc.segments.push({
      startFrame,
      endFrame,
      speaker: speakerOf(seg.speaker),
      firstWord: first,
      lastWord: last,
    });
  }
  return doc;
}
