import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFdx } from '../src/script/index.js';

const load = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

test('basic: struttura, id stabili, BOM, righe vuote', () => {
  const doc = parseFdx(load('basic.fdx'));
  assert.equal(doc.source, 'fdx');
  assert.equal(doc.scenes.length, 3);
  assert.equal(doc.scenes[0].heading, '');
  assert.equal(doc.scenes[1].heading, 'INT. CANTINA DI CASA ROSSETTI - NOTTE');
  doc.lines.forEach((l, i) => {
    assert.equal(l.id, 'L' + String(i + 1).padStart(4, '0'));
    assert.equal(l.order, i);
  });
  // lineIds coerenti
  const all = doc.scenes.flatMap((s) => s.lineIds);
  assert.deepEqual(all, doc.lines.map((l) => l.id));
  // nessuna riga vuota
  assert.ok(doc.lines.every((l) => l.text.length > 0));
  assert.deepEqual(doc.lines.map((l) => l.type), [
    'action', 'scene', 'action', 'character', 'dialogue', 'parenthetical', // 'dialogue' unico
    'character', 'dialogue', 'transition', 'action', 'scene', 'action',
  ]);
});

test('Text multipli con stili e mappatura General->action', () => {
  const doc = parseFdx(load('basic.fdx'));
  assert.equal(doc.lines[2].text, 'Ludovica scende le scale con una torcia in mano.');
  assert.equal(doc.lines.find((l) => l.text === 'Nota generale.').type, 'action');
});

test('battute: entita, estensioni, concatenazione, parentetiche escluse', () => {
  const doc = parseFdx(load('basic.fdx'));
  const d = doc.lines.filter((l) => l.type === 'dialogue');
  assert.equal(d.length, 2);
  assert.equal(d[0].character, 'LUDOVICA');
  assert.equal(d[0].characterExt, 'V.O.');
  assert.equal(
    d[0].text,
    "Non c'è nessuno, vero? Dimmi che \"lui\" non è qui & che è tutto a posto.",
  );
  assert.equal(d[1].character, 'OSVALDO');
  assert.equal(d[1].characterExt, "CONT'D");
  assert.equal(d[1].text, 'Siamo soli. Per ora.');
  assert.equal(d[1].sceneId, 'S002');
  const par = doc.lines.find((l) => l.type === 'parenthetical');
  assert.equal(par.text, '(sottovoce)');
});

test('scena senza heading iniziale', () => {
  const doc = parseFdx(load('basic.fdx'));
  assert.equal(doc.scenes[0].id, 'S001');
  assert.deepEqual(doc.scenes[0].lineIds, ['L0001']);
  assert.equal(doc.lines[0].sceneId, 'S001');
});

test('DualDialogue: due battute separate in ordine, con revisioni ignorate', () => {
  const doc = parseFdx(load('dual.fdx'));
  const d = doc.lines.filter((l) => l.type === 'dialogue');
  assert.deepEqual(d.map((l) => [l.character, l.text]), [
    ['GIOVANNA', 'Aspetta!'],
    ['TEODORO', 'Io dico di sì.'],
    ['MARTINA', 'Io dico di no.'],
    ['TEODORO', 'Va bene, decidiamo domani.'],
  ]);
  assert.equal(d[3].characterExt, 'O.S.');
  assert.equal(doc.scenes.length, 2);
  assert.equal(doc.scenes[1].heading, 'INT. SALA PROVE - GIORNO');
});

test('input minimo/vuoto', () => {
  const doc = parseFdx('<FinalDraft><Content></Content></FinalDraft>');
  assert.deepEqual(doc.lines, []);
  assert.deepEqual(doc.scenes, []);
});
