import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTake, addClip, addAnchor, framesForLine, lineAtFrame, takesForLine, bestTake, setSelection,
  planAssembly, planAssemblyDetailed,
} from '../src/sync/index.js';
import { baseProject } from './sync.helpers.js';

function twoTakes() {
  const p = baseProject();
  addTake(p, { id: 'T2', clipId: 'C1', label: 'Ciak 2' });
  // T1: L2 completa, L3 solo start
  addAnchor(p, { takeId: 'T1', lineId: 'L2', edge: 'start', frame: 100 });
  addAnchor(p, { takeId: 'T1', lineId: 'L2', edge: 'end', frame: 180 });
  addAnchor(p, { takeId: 'T1', lineId: 'L3', edge: 'start', frame: 180 });
  addAnchor(p, { takeId: 'T1', lineId: 'L5', edge: 'start', frame: 400 });
  // T2: L2 solo start, L3 completa
  addAnchor(p, { takeId: 'T2', lineId: 'L2', edge: 'start', frame: 600 });
  addAnchor(p, { takeId: 'T2', lineId: 'L3', edge: 'start', frame: 700 });
  addAnchor(p, { takeId: 'T2', lineId: 'L3', edge: 'end', frame: 800 });
  return p;
}

test('framesForLine / takesForLine / lineAtFrame', () => {
  const p = twoTakes();
  const f = framesForLine(p, 'L2');
  assert.deepEqual(f.map((c) => [c.takeId, c.label, c.startFrame, c.endFrame]), [['T1', 'Ciak 1', 100, 180], ['T2', 'Ciak 2', 600, 700]]);
  assert.deepEqual(takesForLine(p, 'L5').map((t) => t.id), ['T1']);
  assert.deepEqual(takesForLine(p, 'L4'), []);
  assert.equal(lineAtFrame(p, 'T1', 150).lineId, 'L2');
  assert.equal(lineAtFrame(p, 'T1', 180).lineId, 'L3'); // fine esclusa
  assert.equal(lineAtFrame(p, 'T1', 50), null);
  assert.equal(lineAtFrame(p, 'T2', 799).lineId, 'L3');
  assert.throws(() => framesForLine(p, 'L99'), /sconosciuta/);
});

test('bestTake: copertura piu completa, poi selection vince', () => {
  const p = twoTakes();
  assert.equal(bestTake(p, 'L2'), 'T1'); // T1 ha entrambi gli estremi
  assert.equal(bestTake(p, 'L3'), 'T2');
  assert.equal(bestTake(p, 'L4'), null);
  setSelection(p, 'L2', 'T2');
  assert.equal(bestTake(p, 'L2'), 'T2');
});

test('bestTake: a parita di completezza vince il ratio piu alto', () => {
  const p = baseProject();
  addTake(p, { id: 'T2', clipId: 'C1' });
  for (const [t, r, off] of [['T1', 0.7, 0], ['T2', 0.95, 500]]) {
    addAnchor(p, { takeId: t, lineId: 'L4', edge: 'start', frame: 10 + off, kind: 'auto', ratio: r });
    addAnchor(p, { takeId: t, lineId: 'L4', edge: 'end', frame: 60 + off, kind: 'auto', ratio: r });
  }
  assert.equal(bestTake(p, 'L4'), 'T2');
});

test('planAssembly: unione di righe consecutive dello stesso take', () => {
  const p = twoTakes();
  // L2 (T1: 100-180) + L3 selezionata su T1 (180-400): contigue -> un solo taglio
  setSelection(p, 'L3', 'T1');
  const plan = planAssembly(p, ['L2', 'L3']);
  assert.deepEqual(plan, [{ clipId: 'C1', takeId: 'T1', startFrame: 100, endFrame: 400, lineIds: ['L2', 'L3'] }]);
  // senza unione
  assert.equal(planAssembly(p, ['L2', 'L3'], { mergeContiguous: false }).length, 2);
});

test('planAssembly: take diversi non si uniscono; handle clampati ai limiti clip', () => {
  const p = twoTakes();
  const plan = planAssembly(p, ['L2', 'L3'], { handleFrames: 30 }); // L2->T1, L3->T2
  assert.deepEqual(plan, [
    { clipId: 'C1', takeId: 'T1', startFrame: 70, endFrame: 210, lineIds: ['L2'] },
    { clipId: 'C1', takeId: 'T2', startFrame: 670, endFrame: 830, lineIds: ['L3'] },
  ]);
  const edge = planAssembly(p, ['L5'], { handleFrames: 5000 });
  assert.deepEqual(edge, [{ clipId: 'C1', takeId: 'T1', startFrame: 0, endFrame: 1000, lineIds: ['L5'] }]);
});

test('planAssembly: righe non coperte saltate (dettaglio), ordine delle righe rispettato, gap', () => {
  const p = twoTakes();
  const d = planAssemblyDetailed(p, ['L4', 'L5', 'L2']);
  assert.deepEqual(d.skipped, [{ lineId: 'L4', reason: 'nessun-take' }]);
  assert.deepEqual(d.cuts.map((c) => c.lineIds), [['L5'], ['L2']]); // L5 poi L2: nessuna unione all'indietro
  // gap: L2 (100-180) e L5 (400-1000) sullo stesso take: unione solo con mergeGapFrames grande
  assert.equal(planAssembly(p, ['L2', 'L5'], { mergeGapFrames: 100 }).length, 2);
  assert.equal(planAssembly(p, ['L2', 'L5'], { mergeGapFrames: 300 }).length, 1);
});

test('planAssembly: selezione che non copre la riga -> saltata', () => {
  const p = twoTakes();
  setSelection(p, 'L5', 'T2');
  const d = planAssemblyDetailed(p, ['L5']);
  assert.deepEqual(d.cuts, []);
  assert.deepEqual(d.skipped, [{ lineId: 'L5', reason: 'non-coperta', takeId: 'T2' }]);
});

test('planAssembly su script muto con clip piu corta: fine clampata', () => {
  const p = baseProject({ duration: 300 });
  addClip(p, 'C2', { fps: 25, durationFrames: 120 });
  addTake(p, { id: 'T9', clipId: 'C2' });
  addAnchor(p, { takeId: 'T9', lineId: 'L6', edge: 'start', frame: 100 });
  const plan = planAssembly(p, ['L6'], { handleFrames: 50 });
  assert.deepEqual(plan, [{ clipId: 'C2', takeId: 'T9', startFrame: 50, endFrame: 120, lineIds: ['L6'] }]);
});
