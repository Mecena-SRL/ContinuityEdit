import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addStill, addNote, moveItem, resizeItem, setCaption, bringToFront, removeItem, linkItems, boardToSequence,
} from '../src/board/index.js';
import { serialize, deserialize } from '../src/sync/index.js';
import { baseProject } from './sync.helpers.js';

test('operazioni base della lavagna e z-order', () => {
  const p = baseProject();
  const s1 = addStill(p, { takeId: 'T1', frame: 100, x: 10, y: 5, caption: 'Entrata', lineId: 'L2' });
  const n = addNote(p, { x: 50, caption: 'Idea: luce piu calda', color: '#ffd' });
  assert.deepEqual([s1.id, s1.z, n.id, n.z, s1.w, s1.h], ['B1', 1, 'B2', 2, 160, 90]);
  bringToFront(p, s1.id);
  assert.equal(s1.z, 3);
  moveItem(p, n.id, { x: 7 });
  resizeItem(p, n.id, { w: 200 });
  setCaption(p, n.id, 'Nuova');
  assert.deepEqual([n.x, n.y, n.w, n.h, n.caption], [7, 0, 200, 90, 'Nuova']);
  linkItems(p, s1.id, n.id);
  linkItems(p, s1.id, n.id);
  assert.equal(p.board.links.length, 1);
  assert.throws(() => linkItems(p, s1.id, s1.id), /se stesso/);
  assert.throws(() => resizeItem(p, n.id, { w: 0 }), /> 0/);
  assert.throws(() => addStill(p, { takeId: 'T9', frame: 1 }), /take sconosciuto/);
  assert.throws(() => addStill(p, { takeId: 'T1', frame: 1, lineId: 'L99' }), /riga sconosciuta/);
  deserialize(serialize(p));
  removeItem(p, n.id);
  assert.deepEqual(p.board.links, []);
  assert.equal(p.board.items.length, 1);
});

test('boardToSequence: ordinamento x / y / z / explicit, holdFrames 50 di default, clamp ai limiti', () => {
  const p = baseProject({ duration: 300 });
  const a = addStill(p, { takeId: 'T1', frame: 100, x: 300, y: 0, caption: 'A', lineId: 'L2' });
  const b = addStill(p, { takeId: 'T1', frame: 0, x: 100, y: 50, caption: 'B' });
  const c = addStill(p, { takeId: 'T1', frame: 299, x: 200, y: 20, caption: 'C' });
  addNote(p, { x: 0 });
  const order = (o) => boardToSequence(p, o).items.map((i) => i.note);
  assert.deepEqual(order({ order: 'x' }), ['B', 'C', 'A']);
  assert.deepEqual(order({ order: 'y' }), ['A', 'C', 'B']);
  bringToFront(p, b.id);
  assert.deepEqual(order({ order: 'z' }), ['A', 'C', 'B']);
  assert.deepEqual(order({ order: 'explicit', ids: [c.id, a.id] }), ['C', 'A']);
  const items = boardToSequence(p, { order: 'x' }).items;
  assert.deepEqual(items.map((i) => [i.startFrame, i.endFrame]), [[0, 50], [250, 300], [75, 125]]);
  assert.deepEqual(items[2].lineIds, ['L2']);
  assert.equal(boardToSequence(p, { order: 'x', holdFrames: 10 }).items[2].endFrame - 95, 10);
  assert.throws(() => boardToSequence(p, { order: 'explicit' }), /ids/);
  assert.throws(() => boardToSequence(p, { order: 'q' }), /order non valido/);
  deserialize(serialize(p));
});
