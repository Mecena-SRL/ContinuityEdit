import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, addClip, addTake, addAnchor, moveAnchor, removeAnchor, checkAnchors, effectiveAnchors,
  coverageForTake, serialize, deserialize, syncableLines, fromAlignment, setSelection, setNote,
} from '../src/sync/index.js';
import { baseProject, muteScript } from './sync.helpers.js';

const span = (c) => [c.lineId, c.startFrame, c.endFrame];

test('syncable lines: dialogue + action (+ scene opzionale)', () => {
  const p = baseProject();
  assert.deepEqual(syncableLines(p).map((l) => l.id), ['L2', 'L3', 'L4', 'L5', 'L6']);
  assert.equal(syncableLines(p, { includeScenes: true }).length, 6);
});

test('script muto: ancore manuali solo su action, end inferito dalla prossima ancora', () => {
  const p = baseProject();
  addAnchor(p, { takeId: 'T1', lineId: 'L2', edge: 'start', frame: 100 });
  addAnchor(p, { takeId: 'T1', lineId: 'L3', edge: 'start', frame: 300 });
  addAnchor(p, { takeId: 'T1', lineId: 'L5', edge: 'start', frame: 500 });
  addAnchor(p, { takeId: 'T1', lineId: 'L5', edge: 'end', frame: 650 });
  const cov = coverageForTake(p, 'T1');
  assert.deepEqual(cov.map(span), [['L2', 100, 300], ['L3', 300, 500], ['L5', 500, 650]]);
  assert.equal(cov[0].endExplicit, false);
  assert.equal(cov[2].endExplicit, true);
  assert.ok(!cov.some((c) => c.lineId === 'L4' || c.lineId === 'L6')); // senza ancore: non coperte
  assert.deepEqual(checkAnchors(p), []);
});

test('clip piu lunga dello script: ultima riga fino a fine clip, o limitata da maxTailFrames', () => {
  const p = baseProject({ duration: 5000 });
  addAnchor(p, { takeId: 'T1', lineId: 'L6', edge: 'start', frame: 200 });
  assert.deepEqual(coverageForTake(p, 'T1').map(span), [['L6', 200, 5000]]);
  assert.deepEqual(coverageForTake(p, 'T1', { maxTailFrames: 150 }).map(span), [['L6', 200, 350]]);
});

test('clip piu corta dello script: righe oltre la clip -> warning e coverage clampata/scartata', () => {
  const p = baseProject({ duration: 400 });
  addAnchor(p, { takeId: 'T1', lineId: 'L2', edge: 'start', frame: 100 });
  addAnchor(p, { takeId: 'T1', lineId: 'L3', edge: 'start', frame: 450 });
  const w = checkAnchors(p);
  assert.equal(w.length, 1);
  assert.equal(w[0].type, 'out-of-clip');
  assert.deepEqual(coverageForTake(p, 'T1').map(span), [['L2', 100, 400]]);
});

test('solo end: start = ancora precedente o 0', () => {
  const p = baseProject();
  addAnchor(p, { takeId: 'T1', lineId: 'L2', edge: 'end', frame: 80 });
  addAnchor(p, { takeId: 'T1', lineId: 'L3', edge: 'end', frame: 200 });
  assert.deepEqual(coverageForTake(p, 'T1').map(span), [['L2', 0, 80], ['L3', 80, 200]]);
});

test('due take per la stessa riga restano indipendenti', () => {
  const p = baseProject();
  addTake(p, { id: 'T2', clipId: 'C1', label: 'Ciak 2' });
  addAnchor(p, { takeId: 'T1', lineId: 'L2', edge: 'start', frame: 100 });
  addAnchor(p, { takeId: 'T1', lineId: 'L2', edge: 'end', frame: 200 });
  addAnchor(p, { takeId: 'T2', lineId: 'L2', edge: 'start', frame: 600 });
  addAnchor(p, { takeId: 'T2', lineId: 'L2', edge: 'end', frame: 760 });
  assert.deepEqual(coverageForTake(p, 'T1').map(span), [['L2', 100, 200]]);
  assert.deepEqual(coverageForTake(p, 'T2').map(span), [['L2', 600, 760]]);
});

test('ancore fuori ordine: warning non bloccanti, coverage comunque calcolata', () => {
  const p = baseProject();
  addAnchor(p, { takeId: 'T1', lineId: 'L3', edge: 'start', frame: 100 });
  addAnchor(p, { takeId: 'T1', lineId: 'L2', edge: 'start', frame: 300 });
  addAnchor(p, { takeId: 'T1', lineId: 'L5', edge: 'start', frame: 500 });
  addAnchor(p, { takeId: 'T1', lineId: 'L5', edge: 'end', frame: 400 });
  const types = checkAnchors(p, 'T1').map((w) => w.type).sort();
  assert.deepEqual(types, ['edge-order', 'line-order']);
  const cov = coverageForTake(p, 'T1');
  assert.deepEqual(cov.map(span), [['L3', 100, 300], ['L2', 300, 400], ['L5', 500, 1000]]);
});

test('manuale batte auto sulla stessa riga/edge; moveAnchor rende manuale; removeAnchor', () => {
  const p = baseProject();
  const auto = addAnchor(p, { takeId: 'T1', lineId: 'L4', edge: 'start', frame: 100, kind: 'auto', ratio: 0.9 });
  addAnchor(p, { takeId: 'T1', lineId: 'L4', edge: 'end', frame: 200, kind: 'auto', ratio: 0.9 });
  assert.equal(coverageForTake(p, 'T1')[0].source, 'auto');
  const man = addAnchor(p, { takeId: 'T1', lineId: 'L4', edge: 'start', frame: 120 });
  assert.equal(effectiveAnchors(p, 'T1').find((a) => a.edge === 'start').id, man.id);
  let c = coverageForTake(p, 'T1')[0];
  assert.deepEqual([c.startFrame, c.endFrame, c.source], [120, 200, 'mixed']);
  moveAnchor(p, auto.id, 130); // esiste gia' manuale: aggiorna quella
  assert.equal(man.frame, 130);
  assert.equal(removeAnchor(p, man.id), true);
  assert.equal(removeAnchor(p, 'nope'), false);
  c = coverageForTake(p, 'T1')[0];
  assert.equal(c.startFrame, 100);
  const a2 = p.anchors.find((a) => a.id === auto.id);
  moveAnchor(p, a2.id, 111);
  assert.equal(a2.kind, 'manual');
});

test('interpolazione tra ancore point: righe intermedie stimate', () => {
  const p = baseProject();
  addAnchor(p, { takeId: 'T1', lineId: 'L2', edge: 'point', frame: 100 });
  addAnchor(p, { takeId: 'T1', lineId: 'L6', edge: 'point', frame: 500 });
  const plain = coverageForTake(p, 'T1');
  assert.deepEqual(plain.map(span), [['L2', 100, 500], ['L6', 500, 1000]]);
  const cov = coverageForTake(p, 'T1', { interpolate: true });
  assert.deepEqual(cov.map((c) => c.lineId), ['L2', 'L3', 'L4', 'L5', 'L6']);
  const est = cov.filter((c) => c.estimated);
  assert.deepEqual(est.map((c) => c.lineId), ['L3', 'L4', 'L5']);
  // contigue, monotone, dentro [100,500]
  for (let i = 1; i < cov.length - 1; i++) assert.equal(cov[i].startFrame, cov[i - 1].endFrame);
  assert.equal(est[2].endFrame, 500);
  assert.ok(est.every((c) => c.source === 'interpolated'));
});

test('fromAlignment: ancore auto start/end sopra soglia, sostituisce le auto precedenti', () => {
  const p = baseProject();
  const res = {
    coverages: [
      { lineId: 'L4', clipId: 'C1', takeIndex: 0, startFrame: 50, endFrame: 120, ratio: 0.95 },
      { lineId: 'L4', clipId: 'C1', takeIndex: 1, startFrame: 400, endFrame: 460, ratio: 0.7 },
      { lineId: 'L2', clipId: 'C1', takeIndex: 0, startFrame: 0, endFrame: 10, ratio: 0.3 },
      { lineId: 'L3', clipId: 'ALTRA', takeIndex: 0, startFrame: 0, endFrame: 10, ratio: 1 },
    ],
  };
  const { added, skipped } = fromAlignment(p, 'T1', res);
  assert.equal(added.length, 2);
  assert.ok(added.every((a) => a.kind === 'auto'));
  assert.deepEqual(skipped.map((s) => s.reason).sort(), ['clip-diversa', 'ratio-bassa']);
  assert.deepEqual(coverageForTake(p, 'T1').map(span), [['L4', 50, 120]]);
  fromAlignment(p, 'T1', res, { takeIndex: 1 });
  assert.deepEqual(coverageForTake(p, 'T1').map(span), [['L4', 400, 460]]);
  assert.equal(p.anchors.length, 2);
});

test('serializzazione round-trip e validazione', () => {
  const p = baseProject();
  addTake(p, { id: 'T2', clipId: 'C1', label: 'Ciak 2' });
  addAnchor(p, { takeId: 'T1', lineId: 'L2', edge: 'start', frame: 100 });
  addAnchor(p, { takeId: 'T2', lineId: 'L4', edge: 'point', frame: 7, kind: 'auto', ratio: 0.8 });
  setSelection(p, 'L2', 'T2');
  setNote(p, 'L2', 'riprendere');
  setNote(p, 'T1', 'buono');
  const s = serialize(p);
  const q = deserialize(s);
  assert.deepEqual(q, p);
  assert.equal(serialize(q), s);
  assert.deepEqual(deserialize(serialize(p, { pretty: true })), p);
});

test('deserialize: errori chiari e migrazione v0', () => {
  const p = baseProject();
  const bad = (mut, re) => {
    const o = JSON.parse(serialize(p));
    mut(o);
    assert.throws(() => deserialize(o), re);
  };
  assert.throws(() => deserialize('{nope'), /JSON malformato/);
  assert.throws(() => deserialize({ version: 99, scriptDoc: { lines: [] } }), /piu' recente/);
  bad((o) => { o.takes[0].clipId = 'X'; }, /clip sconosciuta "X"/);
  bad((o) => { o.clips.C1.durationFrames = 1.5; }, /durationFrames/);
  bad((o) => { o.anchors = [{ id: 'A1', takeId: 'T1', lineId: 'L2', edge: 'mid', frame: 1, kind: 'manual' }]; }, /edge "mid"/);
  bad((o) => { o.anchors = [{ id: 'A1', takeId: 'T9', lineId: 'L2', edge: 'start', frame: 1, kind: 'manual' }]; }, /take sconosciuto "T9"/);
  bad((o) => { o.selection = { L2: 'T9' }; }, /selection/);
  const legacy = { scriptDoc: muteScript(), clips: { C1: { fps: 25, durationFrames: 100, startTcFrames: 0, name: 'x' } }, takes: [{ id: 'T1', clipId: 'C1', label: 'a' }] };
  const m = deserialize(JSON.stringify(legacy));
  assert.equal(m.version, 1);
  assert.deepEqual(m.anchors, []);
  assert.deepEqual(m.selection, {});
});

test('addAnchor valida gli input', () => {
  const p = baseProject();
  assert.throws(() => addAnchor(p, { takeId: 'T9', lineId: 'L2', edge: 'start', frame: 1 }), /take sconosciuto/);
  assert.throws(() => addAnchor(p, { takeId: 'T1', lineId: 'L99', edge: 'start', frame: 1 }), /riga sconosciuta/);
  assert.throws(() => addAnchor(p, { takeId: 'T1', lineId: 'L2', edge: 'x', frame: 1 }), /edge/);
  assert.throws(() => addAnchor(p, { takeId: 'T1', lineId: 'L2', edge: 'start', frame: 1.5 }), /intero/);
  assert.throws(() => createProject({}), /lines/);
  assert.throws(() => addClip(p, 'C2', { fps: 25, durationFrames: 0 }), /durationFrames/);
});
