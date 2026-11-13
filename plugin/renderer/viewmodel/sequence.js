// Micro-montaggio: layout delle corsie, trim, riordino, regia (stacchi tra angoli).
export const itemFrames = (it) => Math.max(0, (it.endFrame ?? 0) - (it.startFrame ?? 0));
export const trackCount = (items) => Math.max(1, ...(items || []).map((i) => i.track || 1));

/** x = recordFrame se presente, altrimenti contiguo nella corsia (ordine array). */
export function layoutSequence(items = [], pxPerFrame = 1) {
  const cursor = {};
  return items.map((it, index) => {
    const tr = it.track || 1;
    const startAt = Number.isFinite(it.recordFrame) ? it.recordFrame : (cursor[tr] || 0);
    const frames = itemFrames(it);
    cursor[tr] = startAt + frames;
    return { id: it.id, index, track: tr, startAt, frames, x: startAt * pxPerFrame, w: Math.max(6, frames * pxPerFrame) };
  });
}
export const totalFrames = (items) => layoutSequence(items).reduce((m, l) => Math.max(m, l.startAt + l.frames), 0);

/** Trim in [0, durata], almeno 1 frame; edge = bordo che l'utente sta muovendo. */
export function clampTrim(startFrame, endFrame, durationFrames, edge) {
  let s = Math.max(0, Math.min(Math.round(startFrame), durationFrames - 1));
  let e = Math.max(1, Math.min(Math.round(endFrame), durationFrames));
  if (edge === 'start') s = Math.min(s, e - 1); else e = Math.max(e, s + 1);
  return { startFrame: s, endFrame: e };
}

/** Indice di inserimento (nell'array senza l'item) per un rilascio a corsia/ascissa (frame). */
export function dropIndex(items, id, track, xFrame) {
  const rest = items.filter((i) => i.id !== id);
  const lay = layoutSequence(rest);
  for (let k = 0; k < rest.length; k++) {
    if ((rest[k].track || 1) === track && lay[k].startAt + lay[k].frames / 2 > xFrame) return k;
  }
  return rest.length;
}

/** Corsia da y (V piu' alto in alto, come in Resolve). */
export const trackFromY = (y, laneH, tracks) => Math.max(1, Math.min(tracks, tracks - Math.floor(y / laneH)));

/** Range delle coperture di un take per le righe date; null se nessuna. */
export function rangeForLines(coverage, lineIds) {
  const set = new Set(lineIds);
  const cs = (coverage || []).filter((c) => set.has(c.lineId));
  if (!cs.length) return null;
  return { startFrame: Math.min(...cs.map((c) => c.startFrame)), endFrame: Math.max(...cs.map((c) => c.endFrame)) };
}

/** Primo/ultimo id (in ordine script) tra le righe date: {fromLineId,toLineId} o null. */
export function lineSpan(lines, ids) {
  const set = new Set(ids);
  const hit = lines.filter((l) => set.has(l.id));
  return hit.length ? { fromLineId: hit[0].id, toLineId: hit[hit.length - 1].id } : null;
}

/** Id delle righe coperte da un cutaway (da fromLineId a toLineId, in ordine script). */
export function cutawayLineIds(lines, item) {
  const a = lines.findIndex((l) => l.id === item.fromLineId);
  const b = lines.findIndex((l) => l.id === item.toLineId);
  if (a < 0 || b < 0) return [];
  return lines.slice(Math.min(a, b), Math.max(a, b) + 1).map((l) => l.id);
}

export const masterTakeId = (items) => (items || []).find((i) => i.role === 'master')?.takeId ?? null;

/** Corsia per un cutaway che occupa [rec, rec+len): V2, oppure V3... se si sovrappone ad altri cutaway. */
export function freeTrack(items, rec, len, exceptId = null) {
  const lay = layoutSequence(items);
  for (let tr = 2; tr < 12; tr++) {
    const clash = items.some((it, k) => it.id !== exceptId && it.role === 'cutaway' && (it.track || 2) === tr && lay[k].startAt < rec + len && rec < lay[k].startAt + lay[k].frames);
    if (!clash) return tr;
  }
  return 2;
}

/** Etichetta corsia (V1, V2...). */
export const trackLabel = (t) => `V${t}`;
