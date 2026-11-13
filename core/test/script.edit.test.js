import test from 'node:test';
import assert from 'node:assert/strict';
import { setLineType, setCharacter, splitLine, mergeLines, retypeSelection, applyScriptEdit } from '../src/script/index.js';
import { addAnchor, setSelection, setNote, setMark, createHistory, deserialize, serialize } from '../src/sync/index.js';
import { baseProject } from './sync.helpers.js';

const types = (d) => d.lines.map((l) => `${l.id}:${l.type}`);

test('setLineType: pura, personaggio e tipo "other"', () => {
  const p = baseProject();
  const before = structuredClone(p.scriptDoc);
  const r = setLineType(p.scriptDoc, 'L2', 'dialogue', { character: 'marta (V.O.)' });
  assert.deepEqual(p.scriptDoc, before);
  const l = r.doc.lines[1];
  assert.equal(l.type, 'dialogue');
  assert.equal(l.character, 'MARTA');
  assert.equal(l.characterExt, 'V.O.');
  assert.equal(setLineType(r.doc, 'L2', 'other').doc.lines[1].character, null);
  assert.throws(() => setLineType(p.scriptDoc, 'L2', 'boh'), /tipo non valido/);
  assert.throws(() => setLineType(p.scriptDoc, 'L99', 'other'), /sconosciuta/);
  assert.equal(setCharacter(p.scriptDoc, 'L4', 'luca').doc.lines[3].character, 'LUCA');
});

test('setLineType scene <-> altro ricostruisce le scene con id stabili', () => {
  const p = baseProject();
  const r = setLineType(p.scriptDoc, 'L4', 'scene');
  assert.equal(r.doc.scenes.length, 2);
  assert.equal(r.doc.scenes[0].id, 'S1');
  assert.deepEqual(r.doc.scenes[0].lineIds, ['L1', 'L2', 'L3']);
  assert.deepEqual(r.doc.scenes[1].lineIds, ['L4', 'L5', 'L6']);
  assert.equal(r.doc.lines[4].sceneId, r.doc.scenes[1].id);
  const back = setLineType(r.doc, 'L4', 'dialogue', { character: 'MARTA' });
  assert.equal(back.doc.scenes.length, 1);
});

test('splitLine: id stabile sulla prima parte, nuovo L#### successivo', () => {
  const p = baseProject();
  const r = splitLine(p.scriptDoc, 'L3', 18);
  assert.equal(r.doc.lines.length, 7);
  assert.deepEqual(r.created, ['L0007']);
  assert.equal(r.doc.lines[2].text, 'Guarda fuori dalla');
  assert.equal(r.doc.lines[3].id, 'L0007');
  assert.equal(r.doc.lines[3].text, 'finestra, pensierosa.');
  assert.deepEqual(r.doc.lines.map((l) => l.order), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(r.doc.scenes[0].lineIds.includes('L0007'));
  assert.throws(() => splitLine(p.scriptDoc, 'L3', 0), /offset/);
});

test('mergeLines: contigue, testo concatenato, map seconda -> prima', () => {
  const p = baseProject();
  const r = mergeLines(p.scriptDoc, ['L2', 'L3']);
  assert.equal(r.doc.lines.length, 5);
  assert.equal(r.doc.lines[1].text, 'Marta entra e posa le chiavi sul tavolo. Guarda fuori dalla finestra, pensierosa.');
  assert.equal(r.map.L3, 'L2');
  assert.deepEqual(r.removed, ['L3']);
  assert.throws(() => mergeLines(p.scriptDoc, ['L2', 'L4']), /contigue/);
});

test('retypeSelection: porzione nuova, resto stabile (tre casi)', () => {
  const p = baseProject();
  const t = p.scriptDoc.lines[1].text; // "Marta entra e posa le chiavi sul tavolo."
  const mid = retypeSelection(p.scriptDoc, 'L2', 6, 14, 'dialogue', { character: 'marta' });
  assert.deepEqual(mid.created, ['L0007', 'L0008']);
  assert.deepEqual(mid.doc.lines.slice(1, 4).map((l) => [l.id, l.type, l.text]), [
    ['L2', 'action', 'Marta'], ['L0007', 'dialogue', 'entra e'], ['L0008', 'action', 'posa le chiavi sul tavolo.'],
  ]);
  assert.equal(mid.doc.lines[2].character, 'MARTA');
  const head = retypeSelection(p.scriptDoc, 'L2', 0, 5, 'character');
  assert.deepEqual(head.doc.lines.slice(1, 3).map((l) => [l.id, l.type]), [['L0007', 'character'], ['L2', 'action']]);
  const all = retypeSelection(p.scriptDoc, 'L2', 0, t.length, 'other');
  assert.equal(all.doc.lines.length, 6);
  assert.equal(all.doc.lines[1].type, 'other');
  const tail = retypeSelection(p.scriptDoc, 'L2', 30, t.length, 'parenthetical');
  assert.deepEqual(tail.doc.lines.slice(1, 3).map((l) => [l.id, l.type]), [['L2', 'action'], ['L0007', 'parenthetical']]);
  assert.throws(() => retypeSelection(p.scriptDoc, 'L2', 5, 5, 'other'), /selezione/);
});

test('applyScriptEdit migra ancore, selezione, note, marks, sequenza e lavagna; undo ripristina', () => {
  const p = baseProject();
  const h = createHistory();
  for (const l of ['L2', 'L3']) {
    addAnchor(p, { takeId: 'T1', lineId: l, edge: 'start', frame: l === 'L2' ? 100 : 300 });
    addAnchor(p, { takeId: 'T1', lineId: l, edge: 'end', frame: l === 'L2' ? 250 : 400 });
  }
  setSelection(p, 'L3', 'T1');
  setNote(p, 'L3', 'bella');
  setMark(p, 'T1', 'L3', { rating: 'buono', tags: ['x'] });
  p.sequence.items.push({ id: 'I1', kind: 'line', lineIds: ['L2', 'L3'], takeId: 'T1', clipId: 'C1', startFrame: 100, endFrame: 400, track: 1, role: 'main', recordFrame: null, note: '' });
  p.board.items.push({ id: 'B1', type: 'note', x: 0, y: 0, w: 1, h: 1, z: 1, caption: '', lineId: 'L3' });
  const snapshot = structuredClone(p);

  const r = applyScriptEdit(p, { op: 'merge', lineIds: ['L2', 'L3'] }, { history: h });
  assert.deepEqual(r.removed, ['L3']);
  assert.deepEqual(p.anchors.map((a) => [a.lineId, a.edge, a.frame]), [['L2', 'start', 100], ['L2', 'end', 400]]);
  assert.equal(p.selection.L2, 'T1');
  assert.equal(p.notes.L2, 'bella');
  assert.equal(p.marks['T1|L2'].rating, 'buono');
  assert.deepEqual(p.sequence.items[0].lineIds, ['L2']);
  assert.equal(p.board.items[0].lineId, 'L2');
  deserialize(serialize(p)); // progetto ancora valido

  const back = h.undo(p);
  assert.deepEqual(back, snapshot);

  const q = back;
  applyScriptEdit(q, { op: 'split', lineId: 'L2', offset: 6 });
  assert.equal(q.anchors.filter((a) => a.lineId === 'L2').length, 2); // ancore restano sulla prima parte
  assert.equal(q.scriptDoc.lines.length, 7);
  assert.throws(() => applyScriptEdit(q, { op: 'merge', lineIds: ['L2', 'L5'] }), /contigue/);
  assert.throws(() => applyScriptEdit(q, { op: 'boh' }), /op sconosciuta/);
  assert.equal(q.scriptDoc.lines.length, 7); // errore: progetto intatto
});
