// Costruttori di dati sintetici per i test di allineamento.
import { splitTokens } from '../src/text/normalize.js';

export const FPS = 25;

/**
 * Costruisce un TranscriptDoc da una lista di "pezzi": stringhe (parlato) oppure
 * {pause: secondi}. Ogni parola dura 0.3s, passo 0.4s; il "(...)" crea un gap.
 * Ritorna anche `at(i)` = startFrame della parola i.
 */
export function makeTranscript(pieces, { wordStep = 10, clipId = 'clipA' } = {}) {
  const words = [];
  const gaps = [];
  let f = 0;
  for (const p of pieces) {
    if (typeof p === 'object') {
      const len = Math.round(p.pause * FPS);
      gaps.push({ startFrame: f, endFrame: f + len });
      f += len;
      continue;
    }
    for (const raw of p.split(/\s+/).filter(Boolean)) {
      words.push({
        i: words.length,
        text: ' ' + raw,
        tokens: splitTokens(raw),
        startFrame: f,
        endFrame: f + wordStep - 2,
        speaker: null,
        seg: 0,
      });
      f += wordStep;
    }
  }
  return { clipId, language: 'it', fps: FPS, startTcFrames: 0, words, gaps, segments: [] };
}

/** ScriptDoc con sole battute (una scena). lines: [[personaggio, testo], ...] */
export function makeScript(lines) {
  const ls = lines.map(([character, text], k) => ({
    id: 'L' + String(k + 1).padStart(4, '0'),
    order: k,
    type: 'dialogue',
    character,
    text,
    sceneId: 'S1',
  }));
  return { title: 'Test', source: 'fdx', scenes: [{ id: 'S1', heading: 'INT. CASA', lineIds: ls.map((l) => l.id) }], lines: ls };
}

/** Generatore pseudo-casuale deterministico (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
