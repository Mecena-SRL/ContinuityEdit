import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, addClip, addTake, addAnchor, setMark, setTakeMark, setSelection, filterTakes, bestTake,
  serialize, deserialize, setGradePalette, setTakeGroup, createHistory,
} from '../src/sync/index.js';
import { baseProject, muteScript } from './sync.helpers.js';

function twoTakes() {
  const p = baseProject();
  addClip(p, 'C2', { fps: 25, durationFrames: 1000, startTcFrames: 0, name: 'A002' });
  addTake(p, { id: 'T2', clipId: 'C2', label: 'Ciak 2', groupId: 'G1', angle: 'CAM B', bin: 'Sc 1' });
  for (const t of ['T1', 'T2']) {
    addAnchor(p, { takeId: t, lineId: 'L2', edge: 'start', frame: 100 });
    addAnchor(p, { takeId: t, lineId: 'L2', edge: 'end', frame: 200 });
  }
  return p;
}

test('createProject v2 e campi dei take con default', () => {
  const p = baseProject();
  assert.equal(p.version, 2);
  assert.deepEqual(p.gradePalette, ['B', 'B+', 'B++']);
  assert.deepEqual(p.marks, {});
  assert.deepEqual(p.takes[0], { id: 'T1', clipId: 'C1', label: 'Ciak 1', groupId: null, angle: null, rating: null, grade: '', tags: [], bin: null });
  assert.deepEqual(deserialize(serialize(p)), p);
});

test('migrazione v1 -> v2 mantiene i dati e aggiunge i default', () => {
  const v1 = { version: 1, scriptDoc: muteScript(), clips: { C1: { fps: 25, durationFrames: 100, startTcFrames: 0, name: 'x' } },
    takes: [{ id: 'T1', clipId: 'C1', label: 'a' }], anchors: [], selection: {}, notes: { T1: 'ok' } };
  const p = deserialize(v1);
  assert.equal(p.version, 2);
  assert.equal(p.takes[0].grade, '');
  assert.deepEqual(p.takes[0].tags, []);
  assert.equal(p.notes.T1, 'ok');
  assert.deepEqual(p.sequence.items, []);
  assert.deepEqual(p.board, { items: [], links: [] });
});

test('validazione v2: rating, tags, marks e riferimenti', () => {
  const p = twoTakes();
  const bad = (mut, re) => { const o = JSON.parse(serialize(p)); mut(o); assert.throws(() => deserialize(o), re); };
  bad((o) => { o.takes[0].rating = 'ottimo'; }, /rating/);
  bad((o) => { o.takes[0].tags = 'x'; }, /tags/);
  bad((o) => { o.marks = { 'T9|L2': {} }; }, /marks/);
  bad((o) => { o.sequence.items = [{ id: 'I1', takeId: 'T9', startFrame: 0, endFrame: 5 }]; }, /sequence item/);
  assert.throws(() => addTake(p, { id: 'T3', clipId: 'C1', rating: 'x' }), /rating/);
});

test('setTakeMark / setMark / filterTakes', () => {
  const p = twoTakes();
  setTakeMark(p, 'T1', { rating: 'buono', grade: 'B+', tags: ['  luce ', 'luce', 'fuoco'] });
  assert.deepEqual(p.takes[0].tags, ['luce', 'fuoco']);
  setMark(p, 'T2', 'L2', { rating: 'scarto', note: 'rumore' });
  assert.equal(p.marks['T2|L2'].note, 'rumore');
  assert.deepEqual(filterTakes(p, { rating: 'buono' }).map((t) => t.id), ['T1']);
  assert.deepEqual(filterTakes(p, { rating: 'scarto' }).map((t) => t.id), []);
  assert.deepEqual(filterTakes(p, { rating: 'scarto', lineId: 'L2' }).map((t) => t.id), ['T2']);
  assert.deepEqual(filterTakes(p, { grades: ['B+'] }).map((t) => t.id), ['T1']);
  assert.deepEqual(filterTakes(p, { groupId: 'G1' }).map((t) => t.id), ['T2']);
  assert.equal(filterTakes(p).length, 2);
  setMark(p, 'T2', 'L2', { rating: null, note: '' });
  assert.deepEqual(p.marks, {});
  setMark(p, 'T2', null, { rating: 'scarto' }); // lineId null = intero take
  assert.equal(p.takes[1].rating, 'scarto');
  assert.throws(() => setMark(p, 'T1', 'L2', { rating: 'x' }), /rating/);
  assert.throws(() => setMark(p, 'T9', 'L2', {}), /take sconosciuto/);
  assert.throws(() => setGradePalette(p, 'B'), /elenco/);
  setTakeGroup(p, 'T1', 'G1', 'CAM A');
  assert.equal(p.takes[0].angle, 'CAM A');
});

test('bestTake rispetta rating e grade (buono > nessuno > scarto; grade piu\' alto vince)', () => {
  const p = twoTakes();
  assert.equal(bestTake(p, 'L2'), 'T1'); // parita': primo
  setTakeMark(p, 'T1', { rating: 'scarto' });
  assert.equal(bestTake(p, 'L2'), 'T2');
  setTakeMark(p, 'T1', { rating: 'buono' });
  assert.equal(bestTake(p, 'L2'), 'T1');
  setTakeMark(p, 'T2', { rating: 'buono', grade: 'B' });
  assert.equal(bestTake(p, 'L2'), 'T2');
  setTakeMark(p, 'T1', { grade: 'B++' });
  assert.equal(bestTake(p, 'L2'), 'T1');
  setMark(p, 'T1', 'L2', { rating: 'scarto' }); // il mark di copertura prevale
  assert.equal(bestTake(p, 'L2'), 'T2');
  setSelection(p, 'L2', 'T1'); // la selezione esplicita resta sovrana
  assert.equal(bestTake(p, 'L2'), 'T1');
});

test('history: push/undo/redo con limite 50', () => {
  const p = baseProject();
  const h = createHistory();
  assert.equal(h.undo(p), null);
  for (let i = 0; i < 60; i++) { h.push(p); p.notes.L2 = `n${i}`; }
  assert.equal(h.size().undo, 50);
  let cur = h.undo(p);
  assert.equal(cur.notes.L2, 'n58');
  cur = h.redo(cur);
  assert.equal(cur.notes.L2, 'n59');
  assert.equal(h.redo(cur), null);
  cur = h.undo(cur);
  h.push(cur); // una nuova modifica azzera il redo
  assert.equal(h.canRedo(), false);
});
