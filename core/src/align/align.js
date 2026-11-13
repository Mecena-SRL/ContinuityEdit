// alignClip: allinea le battute (righe 'dialogue') di uno script a una trascrizione di clip.
// Vedi docs/CONTRACTS.md. Passi:
//  1. appiattimento dei token della trascrizione (token -> indice parola)
//  2. per ogni battuta: finestre candidate con voto a bin (token esatti o fuzzy) -> evita O(N*M)
//  3. Smith-Waterman iterato per finestra (piu' take della stessa battuta)
//  4. risoluzione conflitti globale per punteggio (nessun token assegnato a due battute)
//  5. frame di inizio/fine, takeIndex, unmatched (improvvisazione)

import { splitTokens } from '../text/normalize.js';
import { tokenSimilarity, matchScore } from './similarity.js';
import { smithWaterman } from './smithWaterman.js';

const DEFAULTS = {
  minRatio: 0.5,
  minMatchedWords: 3,
  maxTakesPerLine: Infinity,
  simThreshold: 0.7, // similarità minima perche' due token "combacino"
  mismatch: -1.2,
  gap: -1.5,
  maxTailSec: 1.5, // oltre questa distanza la "parola successiva" non e' usata per la fine
  minUnmatchedWords: 3,
  unmatchedJoinSec: 1.5,
};

export function alignClip(scriptDoc, transcriptDoc, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const words = transcriptDoc.words || [];
  const fps = transcriptDoc.fps || 25;
  const clipId = transcriptDoc.clipId;

  // 1. sequenza di token della trascrizione
  const T = []; // token
  const TW = []; // indice parola
  for (let w = 0; w < words.length; w++) {
    const toks = words[w].tokens && words[w].tokens.length ? words[w].tokens : splitTokens(words[w].text || '');
    for (const t of toks) { T.push(t); TW.push(w); }
  }
  const N = T.length;

  const vocab = new Map(); // token -> posizioni
  for (let p = 0; p < N; p++) {
    let a = vocab.get(T[p]);
    if (!a) vocab.set(T[p], (a = []));
    a.push(p);
  }
  const vocabByLen = new Map();
  for (const t of vocab.keys()) {
    let a = vocabByLen.get(t.length);
    if (!a) vocabByLen.set(t.length, (a = []));
    a.push(t);
  }
  const maxFreq = Math.max(300, N / 50);

  // posizioni per token di script (esatte + fuzzy solo se il token non esiste esattamente)
  const posCache = new Map();
  const positionsFor = (tok) => {
    let r = posCache.get(tok);
    if (r) return r;
    const exact = vocab.get(tok);
    if (exact) r = exact.length > maxFreq ? [] : exact;
    else {
      r = [];
      for (let L = tok.length - Math.ceil(tok.length * 0.4); L <= tok.length + Math.ceil(tok.length * 0.4); L++) {
        const list = vocabByLen.get(L);
        if (!list) continue;
        for (const v of list) if (tokenSimilarity(tok, v) >= o.simThreshold) r = r.concat(vocab.get(v));
      }
      // cifre: anche parole-numero di lunghezza qualsiasi
      if (/^[0-9]+$/.test(tok)) {
        for (const [v, ps] of vocab) if (tokenSimilarity(tok, v) >= o.simThreshold) r = r.concat(ps);
      }
      if (r.length > maxFreq) r = [];
    }
    posCache.set(tok, r);
    return r;
  };

  const scoreCache = new Map();
  const scoreFn = (a, b) => {
    if (a === b) return 2;
    const key = a + '\u0000' + b;
    let s = scoreCache.get(key);
    if (s === undefined) {
      s = matchScore(tokenSimilarity(a, b), o.simThreshold, o.mismatch);
      scoreCache.set(key, s);
    }
    return s;
  };

  // 2-3. candidati
  const lines = (scriptDoc.lines || []).filter((l) => l.type === 'dialogue');
  const cands = [];
  const lineInfo = [];
  const maxTakes = Number.isFinite(o.maxTakesPerLine) ? Math.max(1, o.maxTakesPerLine) : 50;
  for (let li = 0; li < lines.length; li++) {
    const toks = splitTokens(lines[li].text || '');
    lineInfo.push(toks);
    const n = toks.length;
    if (!n || !N) continue;
    const need = Math.min(n, o.minMatchedWords);
    const B = Math.max(64, 3 * n);
    const nb = Math.ceil(N / B) + 1;
    const cnt = new Uint16Array(nb);
    for (let j = 0; j < n; j++) {
      const ps = positionsFor(toks[j]);
      // distinti per bin: stesso token due volte nello stesso bin conta una volta
      let lastBin = -1;
      for (let k = 0; k < ps.length; k++) {
        const b = (ps[k] / B) | 0;
        if (b !== lastBin) { cnt[b]++; lastBin = b; }
      }
    }
    const voteNeed = Math.max(Math.min(2, n), Math.ceil(0.4 * n), Math.min(need, 2));
    const intervals = [];
    const pad = n + 8;
    for (let b = 0; b < nb; b++) {
      if (cnt[b] + (b + 1 < nb ? cnt[b + 1] : 0) >= voteNeed) {
        const s = Math.max(0, b * B - pad), e = Math.min(N, (b + 2) * B + pad);
        const last = intervals[intervals.length - 1];
        if (last && s <= last[1]) last[1] = Math.max(last[1], e);
        else intervals.push([s, e]);
      }
    }
    // spezza finestre troppo larghe (con sovrapposizione)
    const maxWin = Math.max(600, 8 * n);
    const windows = [];
    for (const [s, e] of intervals) {
      if (e - s <= maxWin) { windows.push([s, e]); continue; }
      for (let a = s; a < e; a += maxWin - 2 * pad) {
        windows.push([a, Math.min(e, a + maxWin)]);
        if (a + maxWin >= e) break;
      }
    }
    for (const [s, e] of windows) {
      const text = T.slice(s, e);
      const blocked = new Uint8Array(e - s);
      for (let it = 0; it < maxTakes; it++) {
        const r = smithWaterman(toks, text, scoreFn, { gap: o.gap, blocked });
        if (!r) break;
        const matched = r.pairs.length;
        if (matched < need || matched / n < o.minRatio) break;
        const pairs = r.pairs.map(([i, j]) => [i, j + s]);
        cands.push({ li, score: r.score, pairs });
        const t0 = r.pairs[0][1], t1 = r.pairs[matched - 1][1];
        for (let j = t0; j <= t1; j++) blocked[j] = 1;
      }
    }
  }

  // 4. conflitti: ordine per punteggio
  cands.sort((a, b) => b.score - a.score || b.pairs.length - a.pairs.length || a.li - b.li);
  const owner = new Int32Array(N).fill(-1);
  const takesCount = new Map();
  const accepted = [];
  for (const c of cands) {
    const toks = lineInfo[c.li];
    const n = toks.length;
    if ((takesCount.get(c.li) || 0) >= maxTakes) continue;
    const free = c.pairs.filter(([, t]) => owner[t] === -1);
    if (free.length < Math.min(n, o.minMatchedWords) || free.length / n < o.minRatio) continue;
    const t0 = free[0][1], t1 = free[free.length - 1][1];
    let owned = 0;
    for (let t = t0; t <= t1; t++) if (owner[t] !== -1) owned++;
    if (owned > 0.2 * (t1 - t0 + 1)) continue;
    for (const [, t] of free) owner[t] = c.li;
    takesCount.set(c.li, (takesCount.get(c.li) || 0) + 1);
    accepted.push({ li: c.li, pairs: free, score: c.score, t0, t1 });
  }

  // 5. coverages
  const tailFrames = o.maxTailSec * fps;
  const endFrameFor = (w) => {
    const lw = words[w];
    let end = lw.endFrame;
    const nw = words[w + 1];
    if (nw && nw.startFrame >= lw.startFrame && nw.startFrame - lw.startFrame <= tailFrames) end = nw.startFrame;
    for (const g of transcriptDoc.gaps || []) {
      if (g.startFrame >= lw.startFrame && g.startFrame < end) end = Math.min(end, g.startFrame);
    }
    return Math.max(end, lw.startFrame + 1);
  };

  accepted.sort((a, b) => a.t0 - b.t0);
  const byLine = new Map();
  const wordCovered = new Uint8Array(words.length);
  const coverages = [];
  for (const a of accepted) {
    const line = lines[a.li];
    const toks = lineInfo[a.li];
    const w0 = TW[a.t0], w1 = TW[a.t1];
    for (let w = w0; w <= w1; w++) wordCovered[w] = 1;
    const matchedIdx = new Set(a.pairs.map(([i]) => i));
    const missingWordIdx = [];
    for (let i = 0; i < toks.length; i++) if (!matchedIdx.has(i)) missingWordIdx.push(i);
    const take = byLine.get(line.id) || 0;
    byLine.set(line.id, take + 1);
    coverages.push({
      lineId: line.id,
      clipId,
      takeIndex: take,
      startFrame: words[w0].startFrame,
      endFrame: endFrameFor(w1),
      scriptWords: toks.length,
      matchedWords: a.pairs.length,
      ratio: a.pairs.length / toks.length,
      missingWordIdx,
      extraWordCount: Math.max(0, a.t1 - a.t0 + 1 - a.pairs.length),
      source: 'auto',
    });
  }

  // unmatched: parole non coperte, raggruppate per adiacenza e vicinanza temporale
  const unmatched = [];
  const joinFrames = o.unmatchedJoinSec * fps;
  let grp = null;
  const flush = () => {
    if (grp && grp.idx.length >= o.minUnmatchedWords) {
      const last = grp.idx[grp.idx.length - 1];
      unmatched.push({
        startFrame: words[grp.idx[0]].startFrame,
        endFrame: endFrameFor(last),
        text: grp.idx.map((w) => String(words[w].text).trim()).join(' '),
      });
    }
    grp = null;
  };
  for (let w = 0; w < words.length; w++) {
    const hasTok = words[w].tokens ? words[w].tokens.length > 0 : splitTokens(words[w].text || '').length > 0;
    if (wordCovered[w]) { flush(); continue; }
    if (!hasTok) continue; // "(...)" o punteggiatura: non spezza il gruppo ma non vi entra
    if (grp) {
      const prev = words[grp.idx[grp.idx.length - 1]];
      if (words[w].startFrame - prev.endFrame > joinFrames) flush();
    }
    if (!grp) grp = { idx: [] };
    grp.idx.push(w);
  }
  flush();

  coverages.sort((a, b) => a.startFrame - b.startFrame);
  return { coverages, unmatched };
}
