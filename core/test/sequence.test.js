import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sequenceFromLines, sequenceFromLinesDetailed, addItem, moveItem, trimItem, removeItem, reorder, directorCut, toAppendPlan,
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
    [90, 310, ['L2', 'L3'], 1, 'main'], [490, 610, ['L5'], 1, 'main'],
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
