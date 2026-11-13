import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sequenceFromLines, sequenceFromLinesDetailed, addItem, addCutaway, trimCutaway, toAppendPlanDetailed, moveItem, trimItem, removeItem, reorder, directorCut, toAppendPlan,
} from '../src/sequence/index.js';
import { addAnchor, addClip, addTake, serialize, deserialize } from '../src/sync/index.js';
import { baseProject } from './sync.helpers.js';

function proj() {
  const p = baseProject({ duration: 1000 });
  const a = (l, s, e) => { addAnchor(p, { takeId: 'T1', lineId: l, edge: 'start', frame: s }); addAnchor(p, { takeId: 'T1', lineId: l, edge: 'end', frame: e }); };
  a('L2', 100, 200); a('L3', 200, 300); a('L5', 500, 600);
  return p;
}

test('sequenceFromLines: unisce contigui, handle clampati, skipped', () => {
  const p = proj();
  const { sequence, skipped } = sequenceFromLinesDetailed(p, ['L2', 'L3', 'L5', 'L6'], { handleFrames: 10 });
  assert.deepEqual(sequence.items.map((i) => [i.startFrame, i.endFrame, i.lineIds, i.track, i.role]), [
    [90, 310, ['L2', 'L3'], 1, 'master'], [490, 610, ['L5'], 1, 'master'],
  ]);
  assert.deepEqual(skipped.map((s) => s.lineId), ['L6']);
  assert.equal(p.sequence, sequence);
  assert.equal(sequenceFromLines(p, ['L2'], { handleFrames: 500 }).items[0].startFrame, 0);
  deserialize(serialize(p));
});

test('addItem / moveItem / trimItem (clamp) / removeItem / reorder', () => {
  const p = proj();
  const a = addItem(p, { takeId: 'T1', startFrame: -5, endFrame: 5000 });
  assert.deepEqual([a.id, a.startFrame, a.endFrame, a.clipId], ['I1', 0, 1000, 'C1']);
  const b = addItem(p, { takeId: 'T1', startFrame: 10, endFrame: 20, role: 'cutaway', track: 2 });
  const c = addItem(p, { takeId: 'T1', startFrame: 30, endFrame: 40, index: 0 });
  assert.deepEqual(p.sequence.items.map((i) => i.id), [c.id, 'I1', b.id]);
  moveItem(p, b.id, { index: 0, track: 3 });
  assert.deepEqual(p.sequence.items.map((i) => i.id), [b.id, c.id, 'I1']);
  assert.equal(b.track, 3);
  trimItem(p, c.id, { startFrame: -10, endFrame: 99999 });
  assert.deepEqual([c.startFrame, c.endFrame], [0, 1000]);
  trimItem(p, c.id, { startFrame: 995, endFrame: 990 }); // end < start: almeno 1 frame
  assert.deepEqual([c.startFrame, c.endFrame], [995, 996]);
  reorder(p, ['I1']);
  assert.deepEqual(p.sequence.items.map((i) => i.id), ['I1', b.id, c.id]);
  removeItem(p, b.id);
  assert.equal(p.sequence.items.length, 2);
  assert.throws(() => reorder(p, ['X']), /sconosciuto/);
  assert.throws(() => moveItem(p, 'X', {}), /sconosciuto/);
  assert.throws(() => addItem(p, { takeId: 'T9', startFrame: 0, endFrame: 1 }), /take sconosciuto/);
  assert.throws(() => addItem(p, { takeId: 'T1', startFrame: 0, endFrame: 1, role: 'boh' }), /role/);
});

test('toAppendPlan: recordFrame contiguo per i main, fine esclusa, audio opzionale', () => {
  const p = proj();
  sequenceFromLines(p, ['L2', 'L5']);
  addItem(p, { takeId: 'T1', startFrame: 700, endFrame: 720, role: 'cutaway', track: 2, recordFrame: 30 });
  const plan = toAppendPlan(p.sequence, { startFrame: 1000 });
  assert.deepEqual(plan, [
    { takeId: 'T1', clipId: 'C1', startFrame: 100, endFrame: 200, trackIndex: 1, recordFrame: 1000, mediaType: 1 },
    { takeId: 'T1', clipId: 'C1', startFrame: 500, endFrame: 600, trackIndex: 1, recordFrame: 1100, mediaType: 1 },
    { takeId: 'T1', clipId: 'C1', startFrame: 700, endFrame: 720, trackIndex: 2, recordFrame: 1030, mediaType: 1 },
  ]);
  const withAudio = toAppendPlan(p.sequence, { withAudio: true });
  assert.equal(withAudio.length, 5);
  assert.deepEqual(withAudio.filter((e) => e.mediaType === 2).map((e) => [e.recordFrame, e.trackIndex]), [[0, 1], [100, 1]]);
});

function multicam() {
  const p = baseProject({ duration: 500 });
  p.takes[0].groupId = 'G1'; p.takes[0].angle = 'CAM A';
  addClip(p, 'C2', { fps: 25, durationFrames: 400, startTcFrames: 0, name: 'B001' });
  addTake(p, { id: 'T2', clipId: 'C2', groupId: 'G1', angle: 'CAM B' });
  return p;
}

test('directorCut non layered: tagli su V1 con recordFrame contiguo', () => {
  const p = multicam();
  directorCut(p, { groupId: 'G1', range: { startFrame: 50, endFrame: 450 }, switches: [{ atFrame: 300, angle: 'CAM B' }, { atFrame: 50, angle: 'CAM A' }, { atFrame: 380, angle: 'CAM A' }] });
  assert.deepEqual(p.sequence.items.map((i) => [i.takeId, i.startFrame, i.endFrame, i.track, i.angle]), [
    ['T1', 50, 300, 1, 'CAM A'], ['T2', 300, 380, 1, 'CAM B'], ['T1', 380, 450, 1, 'CAM A'],
  ]);
  assert.deepEqual(toAppendPlan(p.sequence).map((e) => e.recordFrame), [0, 250, 330]);
});

test('directorCut layered: un livello per angolo, recordFrame relativo; clamp alla clip', () => {
  const p = multicam();
  directorCut(p, { groupId: 'G1', range: { startFrame: 0, endFrame: 500 }, layered: true, switches: [{ atFrame: 0, angle: 'CAM A' }, { atFrame: 200, angle: 'CAM B' }] });
  assert.deepEqual(p.sequence.items.map((i) => [i.takeId, i.track, i.role, i.startFrame, i.endFrame, i.recordFrame]), [
    ['T1', 1, 'angle', 0, 200, 0], ['T2', 2, 'angle', 200, 400, 200], // CAM B: clip lunga solo 400
  ]);
  assert.throws(() => directorCut(p, { groupId: 'G9', range: { startFrame: 0, endFrame: 5 }, switches: [{ atFrame: 0, angle: 'X' }] }), /nessun take/);
  assert.throws(() => directorCut(p, { groupId: 'G1', range: { startFrame: 0, endFrame: 5 }, switches: [{ atFrame: 0, angle: 'CAM Z' }] }), /angolo/);
});

// Master su V1 (T1) con L2..L6 coperte; camera B (T2) copre le stesse righe a frame diversi (L5 non coperta).
function cutProject() {
  const p = baseProject({ duration: 2000 });
  addClip(p, 'C2', { fps: 25, durationFrames: 1500, startTcFrames: 0, name: 'B001' });
  addTake(p, { id: 'T2', clipId: 'C2', groupId: 'G1', angle: 'CAM B' });
  const cuts = { L2: [100, 200], L3: [200, 300], L4: [300, 400], L5: [400, 500], L6: [500, 600] };
  for (const [l, [s, e]] of Object.entries(cuts)) {
    addAnchor(p, { takeId: 'T1', lineId: l, edge: 'start', frame: s + 1000 });
    addAnchor(p, { takeId: 'T1', lineId: l, edge: 'end', frame: e + 1000 });
    if (l !== 'L5') { addAnchor(p, { takeId: 'T2', lineId: l, edge: 'start', frame: s + 50 }); addAnchor(p, { takeId: 'T2', lineId: l, edge: 'end', frame: e + 50 }); }
  }
  sequenceFromLines(p, ['L2', 'L3', 'L4', 'L5', 'L6']);
  return p;
}

test('master su V1 + due cutaway su V2 in momenti diversi, senza audio', () => {
  const p = cutProject();
  const m = p.sequence.items[0];
  assert.deepEqual([m.role, m.track, m.startFrame, m.endFrame], ['master', 1, 1100, 1600]);
  const c1 = addCutaway(p, p.sequence, { takeId: 'T2', fromLineId: 'L2', toLineId: 'L3' });
  const c2 = addCutaway(p, p.sequence, { takeId: 'T2', fromLineId: 'L6', toLineId: 'L6' });
  assert.deepEqual([c1.track, c1.startFrame, c1.endFrame, c1.lineIds], [2, 150, 350, ['L2', 'L3']]);
  assert.equal(c2.track, 2); // non si sovrappone a c1
  const plan = toAppendPlan(p.sequence, { startFrame: 500, withAudio: true });
  const v = plan.filter((e) => e.mediaType === 1);
  assert.deepEqual(v.map((e) => [e.trackIndex, e.recordFrame, e.endFrame - e.startFrame]), [[1, 500, 500], [2, 500, 200], [2, 900, 100]]);
  assert.deepEqual(plan.filter((e) => e.mediaType === 2).map((e) => e.trackIndex), [1]); // solo il master porta audio
});

test('cutaway sovrapposti vanno su V2/V3; offset negativi e positivi con clamp', () => {
  const p = cutProject();
  const a = addCutaway(p, p.sequence, { takeId: 'T2', fromLineId: 'L2', toLineId: 'L4' });
  const b = addCutaway(p, p.sequence, { takeId: 'T2', fromLineId: 'L3', toLineId: 'L4' });
  const c = addCutaway(p, p.sequence, { takeId: 'T2', fromLineId: 'L4', toLineId: 'L4', track: 5 });
  assert.deepEqual([a.track, b.track, c.track], [2, 3, 5]);
  const d = addCutaway(p, p.sequence, { takeId: 'T2', fromLineId: 'L2', toLineId: 'L2', startOffsetFrames: -30, endOffsetFrames: 40 });
  assert.deepEqual([d.startFrame, d.endFrame], [120, 290]);
  assert.equal(d.track, 4);
  assert.equal(toAppendPlan(p.sequence).find((e) => e.startFrame === 120).recordFrame, 0); // 0 + (-30) clampato a 0
  const e = addCutaway(p, p.sequence, { takeId: 'T2', fromLineId: 'L2', toLineId: 'L2', startOffsetFrames: 20, endOffsetFrames: 10, track: 9 });
  assert.equal(toAppendPlan(p.sequence).find((x) => x.trackIndex === 9).recordFrame, 20);
  assert.equal(e.endFrame - e.startFrame, 90);
  const big = addCutaway(p, p.sequence, { takeId: 'T2', fromLineId: 'L6', toLineId: 'L6', endOffsetFrames: 99999 });
  assert.equal(big.endFrame, 1500);
});

test('trimCutaway: sposta gli estremi su altre righe / frame; riga non coperta = errore', () => {
  const p = cutProject();
  const c = addCutaway(p, p.sequence, { takeId: 'T2', fromLineId: 'L2', toLineId: 'L2' });
  trimCutaway(p, p.sequence, c.id, { toLineId: 'L4' });
  assert.deepEqual([c.startFrame, c.endFrame, c.lineIds], [150, 450, ['L2', 'L3', 'L4']]);
  trimCutaway(p, p.sequence, c.id, { startOffsetFrames: 25, endOffsetFrames: -25 });
  assert.deepEqual([c.startFrame, c.endFrame], [175, 425]);
  trimCutaway(p, p.sequence, c.id, { fromLineId: 'L4', toLineId: 'L3' }); // invertiti: riordinati
  assert.deepEqual([c.fromLineId, c.toLineId], ['L3', 'L4']);
  assert.throws(() => trimCutaway(p, p.sequence, c.id, { toLineId: 'L5' }), /non copre la riga "L5"/);
  assert.deepEqual([c.toLineId, c.endFrame], ['L4', 425]); // invariato dopo errore
  assert.throws(() => addCutaway(p, p.sequence, { takeId: 'T2', fromLineId: 'L5' }), /non copre/);
  assert.throws(() => addCutaway(p, p.sequence, { takeId: 'T2', fromLineId: 'L2', track: 1 }), /track/);
  assert.throws(() => trimCutaway(p, p.sequence, 'I1', {}), /cutaway sconosciuto/);
  deserialize(serialize(p));
});

test('cutaway senza master sulla riga: skipped nel piano', () => {
  const p = cutProject();
  sequenceFromLines(p, ['L2']);
  addCutaway(p, p.sequence, { takeId: 'T2', fromLineId: 'L6', toLineId: 'L6' });
  const { plan, skipped } = toAppendPlanDetailed(p.sequence);
  assert.equal(plan.length, 1);
  assert.equal(skipped[0].reason, 'master-assente-sulla-riga');
});
