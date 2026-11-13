// Ancore: Anchor {id, takeId, lineId, edge:'start'|'end'|'point', frame, kind:'manual'|'auto', ratio?}.
// 'point' = un istante rappresentativo della riga (trattato come inizio se mancano start/end).
// Le ancore 'end' hanno frame ESCLUSO. Le incoerenze sono warning, mai errori.

import { EDGES, KINDS, getTake, getLine, lineOrder, nextAnchorId, SYNCABLE_TYPES } from './project.js';

const EDGE_RANK = { start: 0, point: 1, end: 2 };

export function addAnchor(project, { takeId, lineId, edge, frame, kind = 'manual', ratio } = {}) {
  const take = getTake(project, takeId);
  if (!take) throw new Error(`addAnchor: take sconosciuto "${takeId}"`);
  if (!getLine(project, lineId)) throw new Error(`addAnchor: riga sconosciuta "${lineId}"`);
  if (!EDGES.includes(edge)) throw new Error(`addAnchor: edge non valido "${edge}"`);
  if (!KINDS.includes(kind)) throw new Error(`addAnchor: kind non valido "${kind}"`);
  if (!Number.isInteger(frame)) throw new Error('addAnchor: frame deve essere un intero');
  // stessa (take, riga, edge, kind): sostituisce; manual e auto possono convivere (vince manual)
  const existing = project.anchors.find((a) => a.takeId === takeId && a.lineId === lineId && a.edge === edge && a.kind === kind);
  if (existing) {
    existing.frame = frame;
    if (ratio !== undefined) existing.ratio = ratio; else delete existing.ratio;
    return existing;
  }
  const anchor = { id: nextAnchorId(project), takeId, lineId, edge, frame, kind };
  if (ratio !== undefined) anchor.ratio = ratio;
  project.anchors.push(anchor);
  return anchor;
}

// Spostare a mano un'ancora la rende 'manual'.
export function moveAnchor(project, anchorId, frame) {
  const a = project.anchors.find((x) => x.id === anchorId);
  if (!a) throw new Error(`moveAnchor: ancora sconosciuta "${anchorId}"`);
  if (!Number.isInteger(frame)) throw new Error('moveAnchor: frame deve essere un intero');
  const manualTwin = project.anchors.find((x) => x !== a && x.takeId === a.takeId && x.lineId === a.lineId && x.edge === a.edge && x.kind === 'manual');
  if (a.kind === 'auto' && manualTwin) {
    manualTwin.frame = frame; // esiste gia' una manuale: e' quella che vince
    return manualTwin;
  }
  a.frame = frame;
  a.kind = 'manual';
  delete a.ratio;
  return a;
}

export function removeAnchor(project, anchorId) {
  const i = project.anchors.findIndex((a) => a.id === anchorId);
  if (i < 0) return false;
  project.anchors.splice(i, 1);
  return true;
}

export function sortAnchors(project, anchors) {
  const ord = lineOrder(project);
  return [...anchors].sort((a, b) =>
    a.frame - b.frame ||
    (ord.get(a.lineId) ?? 1e9) - (ord.get(b.lineId) ?? 1e9) ||
    EDGE_RANK[a.edge] - EDGE_RANK[b.edge]);
}

// Tutte le ancore di un take ordinate per frame (incluse le auto oscurate da manuali).
export const anchorsForTake = (project, takeId) => sortAnchors(project, project.anchors.filter((a) => a.takeId === takeId));

// Ancore effettive: per ogni (riga, edge) vince la manuale sull'auto. Ordinate per frame.
export function effectiveAnchors(project, takeId) {
  const best = new Map();
  for (const a of project.anchors) {
    if (a.takeId !== takeId) continue;
    const key = `${a.lineId}\u0000${a.edge}`;
    const cur = best.get(key);
    if (!cur || (cur.kind === 'auto' && a.kind === 'manual')) best.set(key, a);
  }
  return sortAnchors(project, [...best.values()]);
}

// Warning non bloccanti: [{type, takeId, anchorIds, message}]
// type: 'out-of-clip' | 'edge-order' | 'line-order' | 'non-syncable-line'
export function checkAnchors(project, takeId) {
  const takes = takeId ? [getTake(project, takeId)].filter(Boolean) : project.takes;
  const ord = lineOrder(project);
  const warnings = [];
  for (const take of takes) {
    const clip = project.clips[take.clipId];
    const eff = effectiveAnchors(project, take.id);
    const W = (type, anchors, message) => warnings.push({ type, takeId: take.id, anchorIds: anchors.map((a) => a.id), message });
    for (const a of eff) {
      const max = a.edge === 'end' ? clip.durationFrames : clip.durationFrames - 1;
      if (a.frame < 0 || a.frame > max) {
        W('out-of-clip', [a], `${take.id}/${a.lineId} ${a.edge}: frame ${a.frame} fuori dalla clip (0..${clip.durationFrames})`);
      }
      const line = getLine(project, a.lineId);
      if (line && !SYNCABLE_TYPES.includes(line.type) && line.type !== 'scene') {
        W('non-syncable-line', [a], `${a.lineId} e' di tipo "${line.type}", non sincronizzabile`);
      }
    }
    const byLine = new Map();
    for (const a of eff) { if (!byLine.has(a.lineId)) byLine.set(a.lineId, {}); byLine.get(a.lineId)[a.edge] = a; }
    for (const [lineId, g] of byLine) {
      if (g.start && g.end && g.end.frame <= g.start.frame) {
        W('edge-order', [g.start, g.end], `${take.id}/${lineId}: end (${g.end.frame}) <= start (${g.start.frame})`);
      }
    }
    for (let i = 1; i < eff.length; i++) {
      const p = eff[i - 1], n = eff[i];
      if (p.lineId === n.lineId) continue;
      if ((ord.get(n.lineId) ?? 0) < (ord.get(p.lineId) ?? 0)) {
        W('line-order', [p, n], `${take.id}: ${n.lineId} (frame ${n.frame}) precede nello script ${p.lineId} (frame ${p.frame}) ma e' dopo nel take`);
      }
    }
  }
  return warnings;
}

// Converte i coverage di alignClip in ancore 'auto' start/end (end escluso).
// opts: minRatio=0.6, takeIndex (solo quella ripetizione; default: per riga la piu' alta per ratio),
//       replaceAuto=true (rimuove prima le auto esistenti del take).
export function fromAlignment(project, takeId, alignResult, { minRatio = 0.6, takeIndex, replaceAuto = true } = {}) {
  const take = getTake(project, takeId);
  if (!take) throw new Error(`fromAlignment: take sconosciuto "${takeId}"`);
  const skipped = [];
  const chosen = new Map();
  for (const c of alignResult.coverages || []) {
    if (c.clipId !== take.clipId) { skipped.push({ lineId: c.lineId, reason: 'clip-diversa' }); continue; }
    if (!getLine(project, c.lineId)) { skipped.push({ lineId: c.lineId, reason: 'riga-sconosciuta' }); continue; }
    if (takeIndex !== undefined && c.takeIndex !== takeIndex) continue;
    if (!(c.ratio >= minRatio)) { skipped.push({ lineId: c.lineId, reason: 'ratio-bassa' }); continue; }
    const cur = chosen.get(c.lineId);
    if (!cur || c.ratio > cur.ratio) chosen.set(c.lineId, c);
  }
  if (replaceAuto) project.anchors = project.anchors.filter((a) => !(a.takeId === takeId && a.kind === 'auto'));
  const added = [];
  for (const c of chosen.values()) {
    added.push(addAnchor(project, { takeId, lineId: c.lineId, edge: 'start', frame: c.startFrame, kind: 'auto', ratio: c.ratio }));
    added.push(addAnchor(project, { takeId, lineId: c.lineId, edge: 'end', frame: c.endFrame, kind: 'auto', ratio: c.ratio }));
  }
  return { added, skipped };
}
