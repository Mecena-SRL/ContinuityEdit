// Query sul progetto: confronto take per riga, riga a un dato frame, take migliore.

import { coverageForTake } from './coverage.js';
import { getTake, getLine, effectiveMark } from './project.js';

// Coperture della riga in tutti i take (per confrontarli). [{...coverage, label}]
export function framesForLine(project, lineId, opts) {
  if (!getLine(project, lineId)) throw new Error(`framesForLine: riga sconosciuta "${lineId}"`);
  const res = [];
  for (const t of project.takes) {
    const c = coverageForTake(project, t.id, opts).find((x) => x.lineId === lineId);
    if (c) res.push({ ...c, label: t.label });
  }
  return res;
}

export function takesForLine(project, lineId, opts) {
  const ids = new Set(framesForLine(project, lineId, opts).map((c) => c.takeId));
  return project.takes.filter((t) => ids.has(t.id));
}

// Riga coperta al frame dato (start <= frame < end). Se piu' righe si sovrappongono vince quella con start piu' alto.
export function lineAtFrame(project, takeId, frame, opts) {
  if (!getTake(project, takeId)) throw new Error(`lineAtFrame: take sconosciuto "${takeId}"`);
  let best = null;
  for (const c of coverageForTake(project, takeId, opts)) {
    if (frame >= c.startFrame && frame < c.endFrame && (!best || c.startFrame >= best.startFrame)) best = c;
  }
  return best;
}

const RATING_RANK = { buono: 2, scarto: 0 };
function score(c, project) {
  const e = effectiveMark(project, c.takeId, c.lineId);
  const pal = project.gradePalette || [];
  const gi = e.grade ? (pal.indexOf(e.grade) >= 0 ? pal.indexOf(e.grade) : -0.5) : -1;
  const edges = (c.startExplicit ? 1 : 0) + (c.endExplicit ? 1 : 0);
  return [RATING_RANK[e.rating] ?? 1, gi, c.estimated ? 0 : 1, edges, c.ratio ?? 1, c.source === 'manual' ? 1 : 0];
}
function cmp(a, b, project) {
  const sa = score(a, project), sb = score(b, project);
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
  return 0;
}

// Take da usare per la riga: selection se valida, altrimenti rating (buono > nessuno > scarto), grade piu' alto,
// poi la copertura piu' completa (non stimata > 2 estremi espliciti > ratio piu' alto > manuale), a parita' il primo take.
// Ritorna {take, coverage}|null. `coverage` puo' essere null se la selezione non copre la riga.
export function bestCoverage(project, lineId, opts) {
  const sel = project.selection?.[lineId];
  const all = framesForLine(project, lineId, opts);
  if (sel && getTake(project, sel)) {
    return { take: getTake(project, sel), coverage: all.find((c) => c.takeId === sel) || null };
  }
  let best = null;
  for (const c of all) if (!best || cmp(c, best, project) > 0) best = c;
  return best ? { take: getTake(project, best.takeId), coverage: best } : null;
}

export function bestTake(project, lineId, opts) {
  return bestCoverage(project, lineId, opts)?.take.id ?? null;
}
