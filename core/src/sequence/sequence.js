// Sequenza (mini-montaggio) in project.sequence = { id, name, items:[...] }.
// Modello 'rough cut a linee verticali': V1 = master (role 'master', recordFrame contiguo, lineStarts = frame sorgente
// d'inizio di ciascuna riga); V2.. = cutaway (role 'cutaway', solo video) che coprono un intervallo di righe
// fromLineId..toLineId (+ startOffsetFrames/endOffsetFrames), posizionati dove il master e' su fromLineId.
// Item: { id:'I1', kind:'line'|'clip', lineIds, takeId, clipId, startFrame, endFrame (ESCLUSA), track (1=V1),
//         role:'main'|'cutaway'|'angle', angle?, recordFrame:number|null, note }
// Le operazioni mutano project.sequence in place (come il resto di sync) e ritornano l'item / la sequenza.
// Frame di clip: interi relativi alla clip; recordFrame: relativo all'inizio sequenza.

import { planAssemblyDetailed } from '../sync/assembly.js';
import { getTake, emptySequence, lineOrder, getLine } from '../sync/project.js';
import { coverageForTake } from '../sync/coverage.js';

export const ROLES = ['master', 'main', 'cutaway', 'angle'];
const isMaster = (it) => it.role === 'master' || it.role === 'main';

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
  const role = spec.role ?? 'master';
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
  if (spec.lineStarts) it.lineStarts = { ...spec.lineStarts };
  for (const k of ['fromLineId', 'toLineId', 'startOffsetFrames', 'endOffsetFrames']) if (spec[k] !== undefined) it[k] = spec[k];
  if (spec.angle != null) it.angle = spec.angle; else if (take.angle) it.angle = take.angle;
  return it;
}

// Costruisce la sequenza dalle righe (planAssembly: take scelto o migliore, handle, unione dei contigui) e la
// assegna a project.sequence. Ritorna { sequence, skipped }.
export function sequenceFromLinesDetailed(project, lineIds, { handleFrames = 0, mergeContiguous = true, ...rest } = {}) {
  const { cuts, skipped } = planAssemblyDetailed(project, lineIds, { handleFrames, mergeContiguous, ...rest });
  const seq = { ...emptySequence(), ...(project.sequence ? { id: project.sequence.id, name: project.sequence.name } : {}), items: [] };
  for (const c of cuts) {
    const cov = coverageForTake(project, c.takeId, rest);
    const lineStarts = {};
    for (const l of c.lineIds) { const x = cov.find((k) => k.lineId === l); if (x) lineStarts[l] = x.startFrame; }
    seq.items.push(makeItem(project, seq, { kind: 'line', lineIds: c.lineIds, takeId: c.takeId, startFrame: c.startFrame, endFrame: c.endFrame, role: 'master', track: 1, lineStarts }));
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
      role: layered ? 'angle' : 'master',
      recordFrame: layered ? s.start - range.startFrame : null,
    }));
  }
  return seq;
}

// ---- cutaway guidati dalle righe ------------------------------------------------------------

// Frame sorgente di un cutaway: inizio copertura di fromLineId, fine copertura di toLineId, piu' offset, clamp alla clip.
function deriveCutaway(project, it) {
  const ord = lineOrder(project);
  for (const l of [it.fromLineId, it.toLineId]) if (!getLine(project, l)) throw new Error(`cutaway: riga sconosciuta "${l}"`);
  if (ord.get(it.fromLineId) > ord.get(it.toLineId)) [it.fromLineId, it.toLineId] = [it.toLineId, it.fromLineId];
  const cov = coverageForTake(project, it.takeId);
  const cf = cov.find((c) => c.lineId === it.fromLineId);
  const ct = cov.find((c) => c.lineId === it.toLineId);
  if (!cf) throw new Error(`cutaway: il take "${it.takeId}" non copre la riga "${it.fromLineId}"`);
  if (!ct) throw new Error(`cutaway: il take "${it.takeId}" non copre la riga "${it.toLineId}"`);
  const dur = project.clips[it.clipId].durationFrames;
  const s = clamp(cf.startFrame + (it.startOffsetFrames || 0), 0, dur - 1);
  it.startFrame = s;
  it.endFrame = clamp(ct.endFrame + (it.endOffsetFrames || 0), s + 1, dur);
  const ids = [...ord.keys()].filter((l) => ord.get(l) >= ord.get(it.fromLineId) && ord.get(l) <= ord.get(it.toLineId));
  it.lineIds = ids.filter((l) => cov.some((c) => c.lineId === l));
  return it;
}

// Conversione di una durata in frame sorgente (al fps della clip) in frame di timeline. Senza fps noti: identita'.
// Una clip a 50 fps su una timeline a 25 dura la meta' dei suoi frame sorgente (Resolve la riproduce a velocita' reale).
export function makeConv({ timelineFps, clipFps } = {}) {
  return (frames, clipId) => {
    const cf = clipFps?.[clipId];
    if (!(timelineFps > 0) || !(cf > 0) || Math.abs(cf - timelineFps) < 0.01) return frames;
    return Math.round((frames * timelineFps) / cf);
  };
}
const ID = (f) => f;

function masterRecords(seq, conv = ID) {
  const rec = new Map();
  let cursor = 0;
  for (const it of seq.items) if (isMaster(it)) { rec.set(it.id, cursor); cursor += conv(it.endFrame - it.startFrame, it.clipId); }
  return rec;
}

// Posizione (relativa alla sequenza) in cui il cutaway inizia nel tempo di timeline, o null se nessun master ha la riga.
function cutawayRecord(seq, it, rec = masterRecords(seq), conv = ID) {
  const m = seq.items.find((x) => isMaster(x) && x.lineIds.includes(it.fromLineId));
  if (!m) return null;
  return Math.max(0, rec.get(m.id) + conv((m.lineStarts?.[it.fromLineId] ?? m.startFrame) - m.startFrame, m.clipId) + conv(it.startOffsetFrames || 0, it.clipId));
}

function freeTrack(seq, it) {
  const rec = masterRecords(seq);
  const r0 = cutawayRecord(seq, it, rec);
  if (r0 == null) return 2;
  const r1 = r0 + (it.endFrame - it.startFrame);
  for (let t = 2; ; t++) {
    const clash = seq.items.some((x) => {
      if (x === it || x.role !== 'cutaway' || x.track !== t || x.fromLineId === undefined) return false;
      const a = cutawayRecord(seq, x, rec);
      return a != null && a < r1 && r0 < a + (x.endFrame - x.startFrame);
    });
    if (!clash) return t;
  }
}

// Aggiunge un cutaway (solo video) sulle righe fromLineId..toLineId dal take dato. track omesso: primo livello >= 2 libero.
// Errore chiaro se il take non copre una delle righe. sequence omessa/null = project.sequence.
export function addCutaway(project, sequence, { takeId, fromLineId, toLineId = fromLineId, startOffsetFrames = 0, endOffsetFrames = 0, track, note = '' } = {}) {
  const seq = sequence || ensureSequence(project);
  const { take } = clipOf(project, takeId);
  if (!Number.isInteger(startOffsetFrames) || !Number.isInteger(endOffsetFrames)) throw new Error('addCutaway: gli offset devono essere interi');
  if (track !== undefined && (!Number.isInteger(track) || track < 2)) throw new Error('addCutaway: track deve essere >= 2');
  const it = { id: nextItemId(seq), kind: 'clip', lineIds: [], takeId, clipId: take.clipId, startFrame: 0, endFrame: 1, track: track ?? 2, role: 'cutaway',
    fromLineId, toLineId, startOffsetFrames, endOffsetFrames, recordFrame: null, note };
  if (take.angle) it.angle = take.angle;
  deriveCutaway(project, it);
  if (track === undefined) it.track = freeTrack(seq, it);
  seq.items.push(it);
  return it;
}

// Trascina gli estremi della linea verticale (altra riga) o affina in frame; ricalcola i frame sorgente.
// Firma: trimCutaway(project, sequence, itemId, {fromLineId?, toLineId?, startOffsetFrames?, endOffsetFrames?, track?}).
export function trimCutaway(project, sequence, itemId, patch = {}) {
  const seq = sequence || ensureSequence(project);
  const it = seq.items.find((x) => x.id === itemId);
  if (!it || it.role !== 'cutaway' || it.fromLineId === undefined) throw new Error(`trimCutaway: cutaway sconosciuto "${itemId}"`);
  const next = { ...it };
  for (const k of ['fromLineId', 'toLineId', 'startOffsetFrames', 'endOffsetFrames']) if (patch[k] !== undefined) next[k] = patch[k];
  if (!Number.isInteger(next.startOffsetFrames) || !Number.isInteger(next.endOffsetFrames)) throw new Error('trimCutaway: gli offset devono essere interi');
  if (patch.track !== undefined) {
    if (!Number.isInteger(patch.track) || patch.track < 2) throw new Error('trimCutaway: track deve essere >= 2');
    next.track = patch.track;
  }
  deriveCutaway(project, next);
  Object.assign(it, next);
  return it;
}

// Piano per AppendToTimeline con skipped (cutaway senza master sulla riga). Vedi toAppendPlan.
// opts.timelineFps + opts.clipFps ({clipId: fps}) convertono le durate sorgente in frame di timeline (clip a fps diverso).
export function toAppendPlanDetailed(sequence, { startFrame = 0, withAudio = false, audioTrack = 1, timelineFps, clipFps } = {}) {
  const plan = [];
  const skipped = [];
  const conv = makeConv({ timelineFps, clipFps });
  const rec = masterRecords(sequence, conv);
  let cursor = 0;
  for (const it of sequence.items) {
    const len = conv(it.endFrame - it.startFrame, it.clipId);
    let rel;
    if (isMaster(it)) { rel = cursor; cursor += len; } else if (it.role === 'cutaway' && it.fromLineId !== undefined) {
      rel = cutawayRecord(sequence, it, rec, conv);
      if (rel == null) { skipped.push({ itemId: it.id, reason: 'master-assente-sulla-riga' }); continue; }
    } else rel = it.recordFrame ?? cursor;
    const entry = { takeId: it.takeId, clipId: it.clipId, startFrame: it.startFrame, endFrame: it.endFrame, trackIndex: it.track, recordFrame: startFrame + rel };
    plan.push({ ...entry, mediaType: 1 });
    if (withAudio && (isMaster(it) || (it.role !== 'cutaway' && it.track === 1))) plan.push({ ...entry, trackIndex: audioTrack, mediaType: 2 });
  }
  return { plan, skipped };
}

// Ritorna [{ takeId, clipId, startFrame, endFrame, trackIndex, recordFrame, mediaType }] (fine ESCLUSA).
// master: recordFrame contiguo da `startFrame`. cutaway con fromLineId: recordFrame = recordFrame del master alla riga
// fromLineId (inizio copertura) + startOffsetFrames, durata = end-start sorgente, mai audio. Altri: item.recordFrame o cursore.
export const toAppendPlan = (sequence, opts) => toAppendPlanDetailed(sequence, opts).plan;

// Marker di timeline per le righe dello script: dove inizia ogni riga nel master (frame relativi all'inizio sequenza).
// Ritorna [{ recordFrame, lineId, takeId }] in ordine di tempo.
export function lineMarkers(sequence, opts = {}) {
  const conv = makeConv(opts);
  const rec = masterRecords(sequence, conv);
  const out = [];
  for (const it of sequence.items) {
    if (!isMaster(it)) continue;
    for (const lineId of it.lineIds || []) {
      const src = it.lineStarts?.[lineId];
      if (!Number.isFinite(src) || src < it.startFrame || src >= it.endFrame) continue;
      out.push({ recordFrame: rec.get(it.id) + conv(src - it.startFrame, it.clipId), lineId, takeId: it.takeId });
    }
  }
  return out.sort((a, b) => a.recordFrame - b.recordFrame);
}

// ================================================================ editor di sequenza (mini-montaggio nel pannello)
// Regole semplici e prevedibili:
//  - V1 e' sempre continua (a pettine): inserire, togliere o accorciare un pezzo sposta i successivi (ripple).
//  - V2, V3... sono libere: i pezzi stanno dove li metti; un pezzo nuovo SOVRASCRIVE quello che trova sotto.
//  - Un cutaway "agganciato alle righe" (fromLineId..toLineId) segue il master; spostarlo a mano lo rende libero.
// Tempi del record: frame di timeline relativi all'inizio della sequenza (opts.timelineFps/clipFps per fps diversi).

// Layout in tempo di timeline: [{ id, track, rec, len, role, anchored, takeId, clipId, startFrame, endFrame, lineIds }].
// I cutaway agganciati a righe che non sono nel master hanno rec null (non si possono montare).
export function sequenceLayout(sequence, opts = {}) {
  const conv = makeConv(opts);
  const rec = masterRecords(sequence, conv);
  let cursor = 0;
  const items = [];
  for (const it of sequence?.items || []) {
    const len = conv(it.endFrame - it.startFrame, it.clipId);
    let r;
    if (isMaster(it)) { r = cursor; cursor += len; } else if (it.fromLineId !== undefined) r = cutawayRecord(sequence, it, rec, conv);
    else r = it.recordFrame ?? cursor;
    items.push({
      id: it.id, track: isMaster(it) ? 1 : it.track, rec: r, len, role: isMaster(it) ? 'master' : it.role, anchored: it.fromLineId !== undefined,
      takeId: it.takeId, clipId: it.clipId, startFrame: it.startFrame, endFrame: it.endFrame, lineIds: [...(it.lineIds || [])],
    });
  }
  const total = items.reduce((m, x) => (x.rec == null ? m : Math.max(m, x.rec + x.len)), 0);
  return { items, total };
}

// durata di timeline -> frame sorgente della clip (inverso di makeConv)
function toSrc(opts, frames, clipId) {
  const cf = opts.clipFps?.[clipId]; const tf = opts.timelineFps;
  if (!(tf > 0) || !(cf > 0) || Math.abs(cf - tf) < 0.01) return Math.round(frames);
  return Math.round((frames * cf) / tf);
}

const layoutOf = (seq, id, opts) => {
  const L = sequenceLayout(seq, opts);
  const x = L.items.find((i) => i.id === id);
  if (!x) throw new Error(`item sconosciuto "${id}"`);
  return { L, x };
};

// Rende libero un cutaway agganciato (stessa posizione e stesso materiale).
function detach(it, rec) {
  if (it.fromLineId === undefined) return it;
  delete it.fromLineId; delete it.toLineId; delete it.startOffsetFrames; delete it.endOffsetFrames;
  it.recordFrame = rec;
  return it;
}

function masterLinesFor(project, it) {
  const cov = coverageForTake(project, it.takeId);
  const inRange = cov.filter((c) => c.startFrame >= it.startFrame && c.startFrame < it.endFrame);
  it.lineIds = inRange.map((c) => c.lineId);
  it.lineStarts = Object.fromEntries(inRange.map((c) => [c.lineId, c.startFrame]));
  return it;
}

/** Taglia (lama) un pezzo nel punto `atRecord` (tempo di sequenza). Ritorna { left, right }. */
export function splitItem(project, id, atRecord, opts = {}) {
  const seq = ensureSequence(project);
  const { x } = layoutOf(seq, id, opts);
  if (x.rec == null) throw new Error('questo pezzo non ha una posizione nella sequenza');
  const off = Math.round(atRecord) - x.rec;
  if (off <= 0 || off >= x.len) throw new Error('il punto di taglio deve stare dentro il pezzo');
  const i = seq.items.findIndex((t) => t.id === id);
  const it = seq.items[i];
  const cut = Math.min(it.endFrame - 1, Math.max(it.startFrame + 1, it.startFrame + toSrc(opts, off, it.clipId)));
  const right = { ...structuredClone(it), id: nextItemId(seq), startFrame: cut };
  it.endFrame = cut;
  if (isMaster(it)) {
    const ls = it.lineStarts || {};
    it.lineIds = (it.lineIds || []).filter((l) => !(Number.isFinite(ls[l]) && ls[l] >= cut));
    right.lineIds = (right.lineIds || []).filter((l) => Number.isFinite(ls[l]) && ls[l] >= cut);
    it.lineStarts = Object.fromEntries(Object.entries(ls).filter(([l]) => it.lineIds.includes(l)));
    right.lineStarts = Object.fromEntries(Object.entries(ls).filter(([l]) => right.lineIds.includes(l)));
  } else {
    detach(it, x.rec);
    detach(right, x.rec);
    right.recordFrame = x.rec + off;
  }
  seq.items.splice(i + 1, 0, right);
  return { left: it, right };
}

// Libera l'intervallo [from, to) sulla traccia >= 2: toglie, accorcia o spezza i pezzi che ci cadono sopra.
function clearRange(project, seq, track, from, to, opts, exceptId = null) {
  for (const x of sequenceLayout(seq, opts).items) {
    if (x.id === exceptId || x.track !== track || x.role === 'master' || x.rec == null) continue;
    const a = x.rec; const b = x.rec + x.len;
    if (b <= from || a >= to) continue;
    const it = seq.items.find((t) => t.id === x.id);
    detach(it, a);
    if (a >= from && b <= to) { seq.items.splice(seq.items.indexOf(it), 1); continue; }
    if (a < from && b > to) { // il nuovo pezzo cade nel mezzo: si spezza in due
      const tail = { ...structuredClone(it), id: nextItemId(seq), startFrame: it.startFrame + toSrc(opts, to - a, it.clipId), recordFrame: to };
      it.endFrame = it.startFrame + toSrc(opts, from - a, it.clipId);
      seq.items.push(tail);
      continue;
    }
    if (a < from) it.endFrame = Math.max(it.startFrame + 1, it.startFrame + toSrc(opts, from - a, it.clipId));
    else { const cutSrc = toSrc(opts, to - a, it.clipId); it.startFrame = Math.min(it.endFrame - 1, it.startFrame + cutSrc); it.recordFrame = to; }
  }
}

/**
 * Mette un pezzo di take nella sequenza.
 * spec: { takeId, startFrame, endFrame (sorgente, fine esclusa), track (1 = V1), recordFrame (tempo di sequenza),
 *         mode: 'insert' (V1: spinge avanti il resto) | 'overwrite' (sostituisce cio' che c'e' sotto), id? }
 */
export function placeClip(project, spec, opts = {}) {
  const seq = ensureSequence(project);
  const track = spec.track ?? 1;
  if (!Number.isInteger(track) || track < 1) throw new Error('traccia non valida');
  const { clip } = clipOf(project, spec.takeId);
  const startFrame = clamp(Math.round(spec.startFrame), 0, clip.durationFrames - 1);
  const endFrame = clamp(Math.round(spec.endFrame), startFrame + 1, clip.durationFrames);
  const take = getTake(project, spec.takeId);
  const rec = Math.max(0, Math.round(spec.recordFrame ?? 0));
  const len = makeConv(opts)(endFrame - startFrame, take.clipId);
  if (track === 1) {
    const L = sequenceLayout(seq, opts);
    const masters = L.items.filter((x) => x.role === 'master');
    // punto di inserimento: se cade dentro un pezzo, prima lo si taglia
    const inside = masters.find((x) => rec > x.rec && rec < x.rec + x.len);
    if (inside) splitItem(project, inside.id, rec, opts);
    if (spec.mode === 'overwrite') {
      const end = rec + len;
      const L2 = sequenceLayout(seq, opts).items.filter((x) => x.role === 'master');
      const inside2 = L2.find((x) => end > x.rec && end < x.rec + x.len);
      if (inside2) splitItem(project, inside2.id, end, opts);
      const gone = new Set(sequenceLayout(seq, opts).items.filter((x) => x.role === 'master' && x.rec >= rec && x.rec + x.len <= end).map((x) => x.id));
      seq.items = seq.items.filter((t) => !gone.has(t.id));
    }
    const after = sequenceLayout(seq, opts).items.filter((x) => x.role === 'master');
    const next = after.find((x) => x.rec >= rec);
    const idx = next ? seq.items.findIndex((t) => t.id === next.id) : seq.items.length;
    const it = makeItem(project, seq, { id: spec.id, kind: 'clip', takeId: spec.takeId, startFrame, endFrame, role: 'master', track: 1 });
    masterLinesFor(project, it);
    seq.items.splice(idx, 0, it);
    return it;
  }
  clearRange(project, seq, track, rec, rec + len, opts);
  const it = makeItem(project, seq, { id: spec.id, kind: 'clip', takeId: spec.takeId, startFrame, endFrame, role: 'cutaway', track, recordFrame: rec });
  seq.items.push(it);
  return it;
}

/** Sposta un pezzo: su V1 cambia l'ordine (ripple), su V2+ lo mette libero al nuovo tempo sovrascrivendo. */
export function moveClip(project, id, { recordFrame, track } = {}, opts = {}) {
  const seq = ensureSequence(project);
  const { x } = layoutOf(seq, id, opts);
  const it = seq.items.find((t) => t.id === id);
  const toTrack = track ?? x.track;
  const at = Math.max(0, Math.round(recordFrame ?? x.rec ?? 0));
  if (x.role === 'master' && toTrack === 1) {
    // riordino: il pezzo va prima del master il cui centro sta dopo il punto di rilascio
    seq.items.splice(seq.items.indexOf(it), 1);
    const L = sequenceLayout(seq, opts).items.filter((m) => m.role === 'master');
    const next = L.find((m) => m.rec + m.len / 2 > at);
    seq.items.splice(next ? seq.items.findIndex((t) => t.id === next.id) : seq.items.length, 0, it);
    return it;
  }
  const spec = { id, takeId: it.takeId, startFrame: it.startFrame, endFrame: it.endFrame, track: toTrack, recordFrame: at, mode: toTrack === 1 ? 'insert' : 'overwrite' };
  if (isMaster(it)) freezeDependents(seq, it, opts);
  seq.items.splice(seq.items.indexOf(it), 1);
  return placeClip(project, spec, opts);
}

// I cutaway agganciati alle righe di un master che sta per sparire diventano liberi nella posizione attuale.
function freezeDependents(seq, master, opts) {
  const L = sequenceLayout(seq, opts).items;
  for (const c of seq.items) {
    if (c.fromLineId === undefined || !(master.lineIds || []).includes(c.fromLineId)) continue;
    const rec = L.find((x) => x.id === c.id)?.rec;
    if (rec != null) detach(c, rec);
  }
}

/** Toglie un pezzo (su V1 i successivi si avvicinano). I cutaway agganciati a quel master restano dove sono. */
export function deleteItem(project, id, opts = {}) {
  const seq = ensureSequence(project);
  const it = seq.items.find((t) => t.id === id);
  if (!it) throw new Error(`item sconosciuto "${id}"`);
  if (isMaster(it)) freezeDependents(seq, it, opts);
  seq.items.splice(seq.items.indexOf(it), 1);
  return it;
}

/**
 * Accorcia/allunga un bordo del pezzo di `delta` frame di timeline (positivo = verso destra).
 * V1: ripple (i successivi si spostano). Cutaway agganciato: cambia l'offset. Cutaway libero: sposta il bordo.
 */
export function trimEdge(project, id, edge, delta, opts = {}) {
  const seq = ensureSequence(project);
  const { x } = layoutOf(seq, id, opts);
  const it = seq.items.find((t) => t.id === id);
  const dur = project.clips[it.clipId].durationFrames;
  const d = toSrc(opts, Math.round(delta), it.clipId);
  if (!d) return it;
  if (edge !== 'start' && edge !== 'end') throw new Error('bordo non valido');
  if (it.fromLineId !== undefined) {
    const patch = edge === 'start' ? { startOffsetFrames: (it.startOffsetFrames || 0) + d } : { endOffsetFrames: (it.endOffsetFrames || 0) + d };
    return trimCutaway(project, seq, id, patch);
  }
  if (edge === 'start') {
    const s = clamp(it.startFrame + d, 0, it.endFrame - 1);
    if (!isMaster(it) && x.rec != null) it.recordFrame = Math.max(0, x.rec + makeConv(opts)(s - it.startFrame, it.clipId));
    it.startFrame = s;
  } else it.endFrame = clamp(it.endFrame + d, it.startFrame + 1, dur);
  return it;
}
