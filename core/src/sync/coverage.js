// coverageForTake: intervalli [startFrame, endFrame) per riga, per un take.
//  - start/end espliciti se presenti (le manuali battono le auto);
//  - solo start (o solo 'point'): end = frame della prossima ancora (di un'altra riga) o fine clip,
//    limitato da maxTailFrames se dato;
//  - solo end: start = frame dell'ancora precedente (di un'altra riga) o 0;
//  - righe senza ancore: non coperte, salvo interpolate:true (stima tra ancore 'point', estimated:true).
// Coverage: {lineId, takeId, clipId, startFrame, endFrame, estimated, startExplicit, endExplicit,
//            source:'manual'|'auto'|'mixed'|'interpolated', ratio:number|null, anchorIds}

import { getTake, getLine, lineOrder } from './project.js';
import { effectiveAnchors } from './anchors.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function sourceOf(anchors) {
  const kinds = new Set(anchors.map((a) => a.kind));
  return kinds.size > 1 ? 'mixed' : [...kinds][0];
}

export function coverageForTake(project, takeId, { maxTailFrames = Infinity, interpolate = false } = {}) {
  const take = getTake(project, takeId);
  if (!take) throw new Error(`coverageForTake: take sconosciuto "${takeId}"`);
  const clip = project.clips[take.clipId];
  const dur = clip.durationFrames;
  const ord = lineOrder(project);
  const eff = effectiveAnchors(project, takeId); // ordinate per frame

  const groups = new Map();
  for (const a of eff) {
    if (!groups.has(a.lineId)) groups.set(a.lineId, {});
    groups.get(a.lineId)[a.edge] = a;
  }

  const nextFrameAfter = (frame, lineId) => {
    for (const a of eff) if (a.frame > frame && a.lineId !== lineId) return a.frame;
    return dur;
  };
  const prevFrameBefore = (frame, lineId) => {
    let r = 0;
    for (const a of eff) if (a.frame < frame && a.lineId !== lineId) r = a.frame;
    return r;
  };

  const out = new Map();
  for (const [lineId, g] of groups) {
    const used = [];
    let s, e, startExplicit = false, endExplicit = false;
    const sa = g.start || g.point;
    if (sa) { s = sa.frame; startExplicit = true; used.push(sa); }
    if (g.end && (s === undefined || g.end.frame > s)) { e = g.end.frame; endExplicit = true; used.push(g.end); }
    if (s === undefined) s = prevFrameBefore(e, lineId); // solo end
    if (e === undefined) {
      e = nextFrameAfter(s, lineId);
      if (Number.isFinite(maxTailFrames)) e = Math.min(e, s + maxTailFrames);
    }
    s = clamp(s, 0, dur);
    e = clamp(e, 0, dur);
    if (e <= s) continue; // intervallo vuoto/invalido (vedi checkAnchors)
    const ratio = used.find((a) => a.ratio !== undefined)?.ratio ?? null;
    out.set(lineId, {
      lineId, takeId, clipId: take.clipId, startFrame: s, endFrame: e,
      estimated: false, startExplicit, endExplicit,
      source: sourceOf(used.length ? used : eff.filter((a) => a.lineId === lineId)),
      ratio, anchorIds: used.map((a) => a.id),
    });
  }

  if (interpolate) {
    const pointLines = [...groups].filter(([, g]) => g.point).map(([id]) => id)
      .sort((a, b) => ord.get(a) - ord.get(b));
    const scriptLines = [...project.scriptDoc.lines].sort((a, b) => ord.get(a.id) - ord.get(b.id));
    const weight = (l) => Math.max(1, (l.text || '').split(/\s+/).filter(Boolean).length);
    for (let i = 0; i + 1 < pointLines.length; i++) {
      const A = pointLines[i], B = pointLines[i + 1];
      const pa = groups.get(A).point.frame, pb = groups.get(B).point.frame;
      const ia = ord.get(A), ib = ord.get(B);
      if (ib - ia < 2 || pb <= pa) continue;
      const seg = scriptLines.slice(ia, ib); // da A (incluso) a B (escluso)
      const total = seg.reduce((t, l) => t + weight(l), 0);
      let cum = 0;
      const bounds = seg.map((l) => {
        const st = pa + Math.round(((pb - pa) * cum) / total);
        cum += weight(l);
        return st;
      });
      bounds.push(pb);
      const ca = out.get(A);
      if (ca && !ca.endExplicit && bounds[1] > ca.startFrame) ca.endFrame = Math.min(ca.endFrame, clamp(bounds[1], 0, dur));
      seg.forEach((l, k) => {
        if (k === 0 || groups.has(l.id)) return;
        const s = clamp(bounds[k], 0, dur), e = clamp(bounds[k + 1], 0, dur);
        if (e <= s) return;
        out.set(l.id, {
          lineId: l.id, takeId, clipId: take.clipId, startFrame: s, endFrame: e,
          estimated: true, startExplicit: false, endExplicit: false,
          source: 'interpolated', ratio: null, anchorIds: [groups.get(A).point.id, groups.get(B).point.id],
        });
      });
    }
  }

  return [...out.values()].sort((a, b) => a.startFrame - b.startFrame || (ord.get(a.lineId) - ord.get(b.lineId)));
}

export function coverageForLine(project, takeId, lineId, opts) {
  if (!getLine(project, lineId)) return null;
  return coverageForTake(project, takeId, opts).find((c) => c.lineId === lineId) || null;
}
