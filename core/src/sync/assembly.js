// planAssembly: piano di montaggio per un elenco di righe (nell'ordine dato).
// Taglio = {clipId, takeId, startFrame, endFrame, lineIds}; endFrame ESCLUSO (come AppendToTimeline).

import { coverageForTake } from './coverage.js';
import { bestCoverage } from './query.js';

export function planAssemblyDetailed(project, lineIds, { handleFrames = 0, mergeContiguous = true, mergeGapFrames = 0, ...covOpts } = {}) {
  const cache = new Map();
  const covOf = (takeId) => {
    if (!cache.has(takeId)) cache.set(takeId, coverageForTake(project, takeId, covOpts));
    return cache.get(takeId);
  };
  const raw = [];
  const skipped = [];
  for (const lineId of lineIds) {
    const bc = bestCoverage(project, lineId, covOpts);
    if (!bc) { skipped.push({ lineId, reason: 'nessun-take' }); continue; }
    const c = bc.coverage && covOf(bc.take.id).find((x) => x.lineId === lineId);
    if (!c) { skipped.push({ lineId, reason: 'non-coperta', takeId: bc.take.id }); continue; }
    raw.push({ clipId: bc.take.clipId, takeId: bc.take.id, startFrame: c.startFrame, endFrame: c.endFrame, lineIds: [lineId] });
  }
  const cuts = [];
  for (const r of raw) {
    const p = cuts[cuts.length - 1];
    if (mergeContiguous && p && p.takeId === r.takeId && r.startFrame >= p.startFrame && r.startFrame <= p.endFrame + mergeGapFrames) {
      p.endFrame = Math.max(p.endFrame, r.endFrame);
      p.lineIds.push(...r.lineIds);
    } else cuts.push({ ...r, lineIds: [...r.lineIds] });
  }
  if (handleFrames > 0) {
    for (const c of cuts) {
      const dur = project.clips[c.clipId].durationFrames;
      c.startFrame = Math.max(0, c.startFrame - handleFrames);
      c.endFrame = Math.min(dur, c.endFrame + handleFrames);
    }
  }
  return { cuts, skipped };
}

export const planAssembly = (project, lineIds, opts) => planAssemblyDetailed(project, lineIds, opts).cuts;
