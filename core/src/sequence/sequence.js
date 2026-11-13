// Sequenza (mini-montaggio) in project.sequence = { id, name, items:[...] }.
// Item: { id:'I1', kind:'line'|'clip', lineIds, takeId, clipId, startFrame, endFrame (ESCLUSA), track (1=V1),
//         role:'main'|'cutaway'|'angle', angle?, recordFrame:number|null, note }
// Le operazioni mutano project.sequence in place (come il resto di sync) e ritornano l'item / la sequenza.
// Frame di clip: interi relativi alla clip; recordFrame: relativo all'inizio sequenza.

import { planAssemblyDetailed } from '../sync/assembly.js';
import { getTake, emptySequence } from '../sync/project.js';

export const ROLES = ['main', 'cutaway', 'angle'];

export function ensureSequence(project) {
  if (!project.sequence) project.sequence = emptySequence();
  return project.sequence;
}

function nextItemId(seq) {
  let max = 0;
  for (const it of seq.items) { const m = /^I(\d+)$/.exec(it.id); if (m) max = Math.max(max, Number(m[1])); }
  return `I${max + 1}`;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function clipOf(project, takeId) {
  const t = getTake(project, takeId);
  if (!t) throw new Error(`take sconosciuto "${takeId}"`);
  return { take: t, clip: project.clips[t.clipId] };
}

function makeItem(project, seq, spec) {
  const { take, clip } = clipOf(project, spec.takeId);
  const dur = clip.durationFrames;
  if (!Number.isInteger(spec.startFrame) || !Number.isInteger(spec.endFrame)) throw new Error('startFrame/endFrame devono essere interi');
  const startFrame = clamp(spec.startFrame, 0, dur - 1);
  const endFrame = clamp(spec.endFrame, startFrame + 1, dur);
  const role = spec.role ?? 'main';
  if (!ROLES.includes(role)) throw new Error(`role non valido "${role}"`);
  const track = spec.track ?? 1;
  if (!Number.isInteger(track) || track < 1) throw new Error('track deve essere un intero >= 1');
  const it = {
    id: spec.id || nextItemId(seq),
    kind: spec.kind === 'line' ? 'line' : 'clip',
    lineIds: [...(spec.lineIds || [])],
    takeId: take.id,
    clipId: take.clipId,
    startFrame,
    endFrame,
    track,
    role,
    recordFrame: spec.recordFrame ?? null,
    note: spec.note ?? '',
  };
  if (spec.angle != null) it.angle = spec.angle; else if (take.angle) it.angle = take.angle;
  return it;
}

// Costruisce la sequenza dalle righe (planAssembly: take scelto o migliore, handle, unione dei contigui) e la
// assegna a project.sequence. Ritorna { sequence, skipped }.
export function sequenceFromLinesDetailed(project, lineIds, { handleFrames = 0, mergeContiguous = true, ...rest } = {}) {
  const { cuts, skipped } = planAssemblyDetailed(project, lineIds, { handleFrames, mergeContiguous, ...rest });
  const seq = { ...emptySequence(), ...(project.sequence ? { id: project.sequence.id, name: project.sequence.name } : {}), items: [] };
  for (const c of cuts) {
    seq.items.push(makeItem(project, seq, { kind: 'line', lineIds: c.lineIds, takeId: c.takeId, startFrame: c.startFrame, endFrame: c.endFrame }));
  }
  project.sequence = seq;
  return { sequence: seq, skipped };
}
export const sequenceFromLines = (project, lineIds, opts) => sequenceFromLinesDetailed(project, lineIds, opts).sequence;

// spec: { takeId, startFrame, endFrame, kind?, lineIds?, track?, role?, angle?, recordFrame?, note?, index? }
export function addItem(project, spec) {
  const seq = ensureSequence(project);
  const it = makeItem(project, seq, spec || {});
  if (seq.items.some((x) => x.id === it.id)) throw new Error(`addItem: id "${it.id}" gia' esistente`);
  const idx = Number.isInteger(spec.index) ? clamp(spec.index, 0, seq.items.length) : seq.items.length;
  seq.items.splice(idx, 0, it);
  return it;
}

function findItem(project, id) {
  const seq = ensureSequence(project);
  const i = seq.items.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`item sconosciuto "${id}"`);
  return { seq, i, it: seq.items[i] };
}

// { index?: nuova posizione nell'ordine, track?: nuovo livello }
export function moveItem(project, id, { index, track } = {}) {
  const { seq, i, it } = findItem(project, id);
  if (track !== undefined) {
    if (!Number.isInteger(track) || track < 1) throw new Error('moveItem: track deve essere un intero >= 1');
    it.track = track;
  }
  if (index !== undefined) {
    if (!Number.isInteger(index)) throw new Error('moveItem: index deve essere intero');
    seq.items.splice(i, 1);
    seq.items.splice(clamp(index, 0, seq.items.length), 0, it);
  }
  return it;
}

// Cambia in/out clampando ai limiti della clip: 0 <= start < end <= durationFrames.
export function trimItem(project, id, { startFrame, endFrame } = {}) {
  const { it } = findItem(project, id);
  const dur = project.clips[it.clipId].durationFrames;
  const s = startFrame === undefined ? it.startFrame : startFrame;
  const e = endFrame === undefined ? it.endFrame : endFrame;
  if (!Number.isInteger(s) || !Number.isInteger(e)) throw new Error('trimItem: frame devono essere interi');
  it.startFrame = clamp(s, 0, dur - 1);
  it.endFrame = clamp(e, it.startFrame + 1, dur);
  return it;
}

export function removeItem(project, id) {
  const { seq, i, it } = findItem(project, id);
  seq.items.splice(i, 1);
  return it;
}

// Riordina secondo `ids`; gli item non citati restano in coda nell'ordine originale.
export function reorder(project, ids) {
  const seq = ensureSequence(project);
  const byId = new Map(seq.items.map((x) => [x.id, x]));
  const out = [];
  for (const id of ids) {
    if (!byId.has(id)) throw new Error(`reorder: item sconosciuto "${id}"`);
    out.push(byId.get(id)); byId.delete(id);
  }
  seq.items = [...out, ...byId.values()];
  return seq;
}

// Regia: taglia tra gli angoli dello stesso gruppo. switches [{atFrame, angle}] in frame di PERFORMANCE
// (assunti uguali per tutti i take del gruppo: frame relativi alla clip, camere sincronizzate); range {startFrame, endFrame}.
// layered:false -> tagli sul livello 1 (role 'main', recordFrame contiguo). layered:true -> ogni angolo sul proprio livello
// V1..Vn (ordine di comparsa dei take nel gruppo), role 'angle', con solo i segmenti in cui l'angolo e' attivo,
// posizionati con recordFrame = frame di performance - range.startFrame. Sostituisce project.sequence.items. Ritorna la sequenza.
export function directorCut(project, { groupId, switches = [], range, layered = false } = {}) {
  const group = project.takes.filter((t) => t.groupId === groupId && groupId != null);
  if (!group.length) throw new Error(`directorCut: nessun take nel gruppo "${groupId}"`);
  if (!range || !Number.isInteger(range.startFrame) || !Number.isInteger(range.endFrame) || range.endFrame <= range.startFrame) {
    throw new Error('directorCut: range non valido');
  }
  if (!switches.length) throw new Error('directorCut: servono switches');
  const angleTake = (angle) => {
    const t = group.find((x) => x.angle === angle);
    if (!t) throw new Error(`directorCut: angolo "${angle}" assente nel gruppo "${groupId}"`);
    return t;
  };
  const sw = switches
    .map((s) => ({ atFrame: s.atFrame, angle: s.angle }))
    .sort((a, b) => a.atFrame - b.atFrame);
  const segs = [];
  for (let k = 0; k < sw.length; k++) {
    const start = k === 0 ? range.startFrame : Math.max(sw[k].atFrame, range.startFrame);
    const end = k + 1 < sw.length ? Math.min(sw[k + 1].atFrame, range.endFrame) : range.endFrame;
    if (end > start) segs.push({ start, end, angle: sw[k].angle });
  }
  const seq = ensureSequence(project);
  seq.items = [];
  const trackOf = new Map();
  if (layered) group.filter((t) => t.angle).forEach((t, i) => trackOf.set(t.angle, i + 1));
  for (const s of segs) {
    const t = angleTake(s.angle);
    const clip = project.clips[t.clipId];
    const startFrame = clamp(s.start, 0, clip.durationFrames - 1);
    const endFrame = clamp(s.end, startFrame + 1, clip.durationFrames);
    seq.items.push(makeItem(project, seq, {
      kind: 'clip', takeId: t.id, startFrame, endFrame, angle: s.angle,
      track: layered ? trackOf.get(s.angle) : 1,
      role: layered ? 'angle' : 'main',
      recordFrame: layered ? s.start - range.startFrame : null,
    }));
  }
  return seq;
}

// Piano per AppendToTimeline. Ritorna [{ takeId, clipId, startFrame, endFrame, trackIndex, recordFrame, mediaType }]
// (fine ESCLUSA). I 'main' hanno recordFrame contiguo a partire da `startFrame`; gli altri usano item.recordFrame
// (relativo alla sequenza) oppure la posizione corrente del cursore. withAudio: aggiunge mediaType 2 per gli item
// 'main' o sul livello 1 (audioTrack = traccia audio).
export function toAppendPlan(sequence, { startFrame = 0, withAudio = false, audioTrack = 1 } = {}) {
  const plan = [];
  let cursor = 0;
  for (const it of sequence.items) {
    const len = it.endFrame - it.startFrame;
    let rel;
    if (it.role === 'main') { rel = cursor; cursor += len; } else rel = it.recordFrame ?? cursor;
    const entry = { takeId: it.takeId, clipId: it.clipId, startFrame: it.startFrame, endFrame: it.endFrame, trackIndex: it.track, recordFrame: startFrame + rel };
    plan.push({ ...entry, mediaType: 1 });
    if (withAudio && (it.role === 'main' || it.track === 1)) plan.push({ ...entry, trackIndex: audioTrack, mediaType: 2 });
  }
  return plan;
}
