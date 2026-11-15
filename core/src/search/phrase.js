// "Cerca nel parlato" (equivalente semplice di PhraseFind di Avid): ricerca di una frase in tutte le trascrizioni,
// tollerante a errori di riconoscimento (somiglianza di Levenshtein) e a grafie diverse con lo stesso suono
// (chiave fonetica italiana semplificata: h muta, doppie, c/k/q, gn, gli, sc, z/s...). Nessuna dipendenza.
//
// searchTranscripts(docs, query, {limit, minScore}) con docs = [{ takeId, words:[{text, tokens?, startFrame, endFrame}] }]
//   -> [{ takeId, startFrame, endFrame, score (0..1), wordStart, wordEnd, before, match, after }]

import { splitTokens } from '../text/normalize.js';
import { tokenSimilarity } from '../align/similarity.js';
import { smithWaterman } from '../align/smithWaterman.js';

/** Chiave fonetica approssimata (italiano, tollerante anche per l'inglese piu' comune). */
export function phoneticKey(token) {
  let t = String(token || '').toLowerCase();
  t = t.replace(/ph/g, 'f')
    .replace(/ch(?=[ei])/g, 'k').replace(/gh(?=[ei])/g, 'g')
    .replace(/h/g, '')
    .replace(/sc(?=[ei])/g, 'S')
    .replace(/gn/g, 'N').replace(/gli/g, 'Li').replace(/gl(?=[aeou])/g, 'L')
    .replace(/q/g, 'k').replace(/c(?![ei])/g, 'k').replace(/x/g, 'ks')
    .replace(/y/g, 'i').replace(/j/g, 'i').replace(/w/g, 'v')
    .replace(/z/g, 's')
    .replace(/(.)\1+/g, '$1');
  return t;
}

function sim(q, w, isLast) {
  let s = tokenSimilarity(q, w);
  if (s < 0.999 && q.length >= 3 && w.length >= 3 && phoneticKey(q) === phoneticKey(w)) s = Math.max(s, 0.88);
  if (isLast && q.length >= 3 && w.startsWith(q)) s = Math.max(s, 0.8); // parola ancora in digitazione
  return s;
}

export function searchTranscripts(docs, query, { limit = 60, minScore = 0.62 } = {}) {
  const Q = splitTokens(query || '');
  if (!Q.length) return [];
  const hits = [];
  for (const d of docs || []) {
    const words = d?.words || [];
    const T = []; const TW = [];
    words.forEach((w, i) => { for (const t of (w.tokens && w.tokens.length ? w.tokens : splitTokens(w.text || ''))) { T.push(t); TW.push(i); } });
    if (!T.length) continue;
    // posizioni candidate: un token della query somiglia al token del testo
    const cand = new Set();
    for (let j = 0; j < T.length; j++) {
      for (let k = 0; k < Q.length; k++) if (sim(Q[k], T[j], k === Q.length - 1) >= 0.7) { cand.add(Math.max(0, j - k)); break; }
    }
    const found = [];
    for (const j0 of cand) {
      const lo = Math.max(0, j0 - 1); const hi = Math.min(T.length, j0 + Q.length + 2);
      const win = T.slice(lo, hi);
      const r = smithWaterman(Q, win, (a, b) => {
        const s = sim(a, b, a === Q[Q.length - 1]);
        return s >= 0.7 ? 1 + s : -1.2;
      }, { gap: -1 });
      if (!r || !r.pairs.length) continue;
      let total = 0;
      for (const [qi, ti] of r.pairs) total += sim(Q[qi], win[ti], qi === Q.length - 1);
      const score = total / Q.length;
      if (score < minScore) continue;
      const a = lo + r.pairs[0][1]; const b = lo + r.pairs[r.pairs.length - 1][1];
      found.push({ score, wa: TW[a], wb: TW[b] });
    }
    // un risultato per zona (tiene il migliore tra quelli sovrapposti)
    found.sort((x, y) => y.score - x.score || x.wa - y.wa);
    const taken = [];
    for (const f of found) {
      if (taken.some((t) => f.wa <= t.wb && t.wa <= f.wb)) continue;
      taken.push(f);
      const ctx = (from, to) => words.slice(Math.max(0, from), Math.max(0, to)).map((w) => w.text).join(' ');
      const next = words[f.wb + 1];
      hits.push({
        takeId: d.takeId, score: Math.round(f.score * 100) / 100, wordStart: f.wa, wordEnd: f.wb,
        startFrame: words[f.wa].startFrame, endFrame: Math.max(words[f.wa].startFrame + 1, Math.min(words[f.wb].endFrame, next ? next.startFrame : words[f.wb].endFrame)),
        before: ctx(f.wa - 6, f.wa), match: ctx(f.wa, f.wb + 1), after: ctx(f.wb + 1, f.wb + 7),
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score || String(a.takeId).localeCompare(String(b.takeId)) || a.startFrame - b.startFrame).slice(0, limit);
}
