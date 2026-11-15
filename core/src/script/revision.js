// Revisioni della sceneggiatura (stile ScriptSync "nuova versione dello script"): confronta il vecchio ScriptDoc con
// il nuovo, trova la riga corrispondente per ogni vecchia riga (uguale, modificata o tolta) e migra al nuovo testo
// ancore, scelte del take, note, valutazioni, sequenza e lavagna. Tutto puro: nessuna chiamata a Resolve.
//
// diffRevision(oldDoc, newDoc, {minSimilarity}) -> { map: {oldId: newId|null}, status: {oldId: 'uguale'|'modificata'|'tolta'},
//   added: [newId], stats: {uguali, modificate, tolte, nuove} }
// applyRevision(project, newDoc, diff) muta il progetto: scriptDoc nuovo, riferimenti alle righe rimappati, quelli
// alle righe tolte eliminati. Ritorna { anchorsKept, anchorsDropped }.

import { splitTokens } from '../text/normalize.js';

const keyOf = (l) => `${l.type}|${(l.character || '').toUpperCase()}|${splitTokens(l.text || '').join(' ')}`;

// Similarita' di Dice sui bigrammi di parole + parole singole (robusta a piccoli cambi di battuta).
function similarity(a, b) {
  const ta = splitTokens(a.text || ''); const tb = splitTokens(b.text || '');
  if (!ta.length && !tb.length) return a.type === b.type ? 1 : 0;
  if (!ta.length || !tb.length) return 0;
  const bag = (t) => { const m = new Map(); for (const x of t) m.set(x, (m.get(x) || 0) + 1); return m; };
  const A = bag(ta); const B = bag(tb);
  let common = 0;
  for (const [k, n] of A) common += Math.min(n, B.get(k) || 0);
  let s = (2 * common) / (ta.length + tb.length);
  if (a.type !== b.type) s *= 0.8; // un'azione diventata battuta resta riconoscibile ma pesa meno
  if (a.type === 'dialogue' && b.type === 'dialogue' && (a.character || '') !== (b.character || '')) s *= 0.85;
  return s;
}

export function diffRevision(oldDoc, newDoc, { minSimilarity = 0.55 } = {}) {
  const O = oldDoc?.lines || []; const N = newDoc?.lines || [];
  const matchO = new Array(O.length).fill(-1);
  const usedN = new Array(N.length).fill(false);
  const exact = new Array(O.length).fill(false);

  // 1) righe identiche, in ordine (monotono): ogni vecchia riga prende la prima nuova uguale dopo l'ultima abbinata
  const byKey = new Map();
  N.forEach((l, j) => { const k = keyOf(l); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(j); });
  let last = -1;
  O.forEach((l, i) => {
    const list = byKey.get(keyOf(l)) || [];
    const j = list.find((x) => x > last && !usedN[x]);
    if (j !== undefined) { matchO[i] = j; usedN[j] = true; exact[i] = true; last = j; }
  });

  // 2) nei "buchi" tra due righe abbinate: abbinamento per somiglianza (sempre in ordine)
  let i = 0;
  while (i < O.length) {
    if (matchO[i] >= 0) { i++; continue; }
    const from = i;
    while (i < O.length && matchO[i] < 0) i++;
    const lo = from > 0 ? matchO[from - 1] + 1 : 0;
    const hi = i < O.length ? matchO[i] : N.length; // escluso
    let cursor = lo;
    for (let k = from; k < i; k++) {
      let best = -1; let bestS = minSimilarity;
      for (let j = cursor; j < hi; j++) {
        if (usedN[j]) continue;
        const s = similarity(O[k], N[j]);
        if (s > bestS) { bestS = s; best = j; }
      }
      if (best >= 0) { matchO[k] = best; usedN[best] = true; cursor = best + 1; }
    }
  }

  const map = {}; const status = {};
  const stats = { uguali: 0, modificate: 0, tolte: 0, nuove: 0 };
  O.forEach((l, k) => {
    if (matchO[k] < 0) { map[l.id] = null; status[l.id] = 'tolta'; stats.tolte++; return; }
    map[l.id] = N[matchO[k]].id;
    status[l.id] = exact[k] ? 'uguale' : 'modificata';
    stats[exact[k] ? 'uguali' : 'modificate']++;
  });
  const added = N.filter((_, j) => !usedN[j]).map((l) => l.id);
  stats.nuove = added.length;
  return { map, status, added, stats };
}

// Applica la revisione al progetto (muta in place).
export function applyRevision(project, newDoc, diff) {
  const map = diff.map;
  const to = (id) => (id in map ? map[id] : null); // id sconosciuto = riga non piu' esistente
  const before = project.anchors.length;
  const seen = new Map();
  const anchors = [];
  for (const a of project.anchors) {
    const n = to(a.lineId);
    if (!n) continue;
    a.lineId = n;
    const k = `${a.takeId}|${a.lineId}|${a.edge}|${a.kind}`;
    const prev = seen.get(k);
    if (!prev) { seen.set(k, a); anchors.push(a); continue; }
    if (a.edge === 'end' ? a.frame > prev.frame : a.frame < prev.frame) prev.frame = a.frame;
  }
  project.anchors = anchors;
  const takeIds = new Set(project.takes.map((t) => t.id));
  const sel = {};
  for (const [l, t] of Object.entries(project.selection || {})) { const n = to(l); if (n) sel[n] = t; }
  project.selection = sel;
  const notes = {};
  for (const [k, v] of Object.entries(project.notes || {})) {
    if (takeIds.has(k) || k.includes('|')) { // nota del take o take|riga
      if (k.includes('|')) { const [t, l] = k.split('|'); const n = to(l); if (n) notes[`${t}|${n}`] = v; } else notes[k] = v;
      continue;
    }
    const n = to(k);
    if (n) notes[n] = notes[n] ? `${notes[n]}\n${v}` : v;
  }
  project.notes = notes;
  const marks = {};
  for (const [k, m] of Object.entries(project.marks || {})) {
    const [t, l] = k.split('|');
    if (!l) { marks[k] = m; continue; }
    const n = to(l);
    if (n) marks[`${t}|${n}`] = m;
  }
  project.marks = marks;
  if (project.sequence) {
    project.sequence.items = project.sequence.items.filter((it) => {
      it.lineIds = (it.lineIds || []).map(to).filter(Boolean);
      if (it.lineStarts) it.lineStarts = Object.fromEntries(Object.entries(it.lineStarts).map(([l, f]) => [to(l), f]).filter(([l]) => l));
      if (it.fromLineId !== undefined) {
        it.fromLineId = to(it.fromLineId); it.toLineId = to(it.toLineId);
        if (!it.fromLineId || !it.toLineId) return false; // cutaway agganciato a righe tolte
      }
      return true;
    });
  }
  for (const it of project.board?.items || []) if (it.lineId) it.lineId = to(it.lineId);
  project.scriptDoc = newDoc;
  return { anchorsKept: anchors.length, anchorsDropped: before - anchors.length };
}
