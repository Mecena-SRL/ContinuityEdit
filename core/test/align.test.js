import test from 'node:test';
import assert from 'node:assert/strict';
import { alignClip } from '../src/align/align.js';
import { levenshtein, tokenSimilarity } from '../src/align/similarity.js';
import { makeScript, makeTranscript } from './align.helpers.js';

const L1 = 'Ti ho cercato dappertutto Ginevra, dove eri finita ieri sera?';
const L2 = 'Sono andata al molo a guardare le barche che partivano.';
const L3 = 'Non dovevi farlo senza dirmi niente, Aurelio, lo sai bene.';
const L4 = 'Domani mattina partiremo presto per la costa di Valdemaro.';

const script = makeScript([
  ['AURELIO', L1],
  ['GINEVRA', L2],
  ['AURELIO', L3],
  ['GINEVRA', L4],
]);

const byLine = (r, id) => r.coverages.filter((c) => c.lineId === id);

test('similarita: Levenshtein e numeri', () => {
  assert.equal(levenshtein('casa', 'cosa'), 1);
  assert.ok(tokenSimilarity('ginevra', 'ginebra') > 0.8);
  assert.equal(tokenSimilarity('si', 'no'), 0);
  assert.ok(tokenSimilarity('35', 'trentacinque') > 0.7);
  assert.equal(tokenSimilarity('35', '36'), 0);
});

test('copertura completa', () => {
  const t = makeTranscript([L1, { pause: 1 }, L2, { pause: 1 }, L3, L4]);
  const r = alignClip(script, t);
  assert.equal(r.coverages.length, 4);
  for (const c of r.coverages) {
    assert.equal(c.ratio, 1);
    assert.equal(c.takeIndex, 0);
    assert.equal(c.source, 'auto');
    assert.equal(c.clipId, 'clipA');
    assert.deepEqual(c.missingWordIdx, []);
  }
  assert.deepEqual(r.coverages.map((c) => c.lineId), ['L0001', 'L0002', 'L0003', 'L0004']);
  assert.equal(r.unmatched.length, 0);
  // inizio = prima parola; fine non oltre la pausa che segue
  const c1 = r.coverages[0];
  assert.equal(c1.startFrame, 0);
  const lastWordOfL1 = t.words[L1.split(' ').length - 1];
  assert.ok(c1.endFrame >= lastWordOfL1.endFrame - 1 && c1.endFrame <= t.gaps[0].startFrame);
});

test('battuta parziale: solo parte della battuta pronunciata', () => {
  const t = makeTranscript(['Sono andata al molo a guardare le', { pause: 2 }, 'poi altro']);
  const r = alignClip(script, t);
  const c = byLine(r, 'L0002');
  assert.equal(c.length, 1);
  assert.ok(c[0].ratio >= 0.6 && c[0].ratio < 1);
  assert.ok(c[0].missingWordIdx.includes(c[0].scriptWords - 1));
});

test('battuta ripetuta in 3 take con false partenze', () => {
  const t = makeTranscript([
    'Non dovevi', { pause: 1 }, // falsa partenza (2/10 < soglia)
    L3, { pause: 3 },
    'Non dovevi farlo senza', { pause: 1 }, // falsa partenza (4/10)
    L3, { pause: 3 },
    'Non dovevi farlo senza dirmi niente, Aurelio, lo sai', { pause: 1 }, // take quasi completo
    L3,
  ]);
  const r = alignClip(script, t);
  const c = byLine(r, 'L0003');
  const full = c.filter((x) => x.ratio === 1);
  assert.equal(full.length, 3, JSON.stringify(c));
  // takeIndex crescente nel tempo
  c.forEach((x, k) => assert.equal(x.takeIndex, k));
  for (let k = 1; k < c.length; k++) assert.ok(c[k].startFrame > c[k - 1].startFrame);
  // nessuna sovrapposizione tra take
  for (let k = 1; k < c.length; k++) assert.ok(c[k].startFrame >= c[k - 1].startFrame + 1);
  assert.ok(c.length >= 3 && c.length <= 5);
});

test('maxTakesPerLine limita i take', () => {
  const t = makeTranscript([L3, { pause: 2 }, L3, { pause: 2 }, L3]);
  const r = alignClip(script, t, { maxTakesPerLine: 2 });
  assert.equal(byLine(r, 'L0003').length, 2);
});

test('improvvisazione tra le battute finisce in unmatched', () => {
  const imp = 'Eh ma figurati io non ci credo proprio a questa storia assurda';
  const t = makeTranscript([L1, imp, L2]);
  const r = alignClip(script, t);
  assert.equal(r.coverages.length, 2);
  assert.equal(r.unmatched.length, 1);
  const u = r.unmatched[0];
  assert.ok(u.text.startsWith('Eh ma figurati'));
  assert.ok(u.text.endsWith('assurda'));
  const startImp = t.words[L1.split(' ').length].startFrame;
  assert.equal(u.startFrame, startImp);
  assert.ok(u.endFrame <= r.coverages[1].startFrame + 1);
});

test('parole saltate dall attore', () => {
  const t = makeTranscript(['Non dovevi farlo dirmi niente, lo sai']);
  const r = alignClip(script, t);
  const c = byLine(r, 'L0003')[0];
  assert.ok(c);
  assert.equal(c.scriptWords, 10);
  assert.equal(c.matchedWords, 7);
  assert.ok(c.ratio === 0.7);
  assert.equal(c.missingWordIdx.length, 3);
  assert.equal(c.extraWordCount, 0);
});

test('errori ASR su nomi propri e parole', () => {
  const t = makeTranscript([
    'Ti ho cercato dappertutto Ginebra dove eri finita ieri sera',
    { pause: 1 },
    'Domani mattina partiremo presto per la costa di Valdemare',
  ]);
  const r = alignClip(script, t);
  assert.equal(byLine(r, 'L0001').length, 1);
  assert.equal(byLine(r, 'L0004').length, 1);
  assert.equal(byLine(r, 'L0001')[0].matchedWords, 10);
  assert.equal(byLine(r, 'L0004')[0].matchedWords, 9);
});

test('numeri: cifre nello script e parole nella trascrizione', () => {
  const s = makeScript([['MARTA', 'Ho compiuto 35 anni e vivo al numero 12 di questa strada.']]);
  const t = makeTranscript(['Ho compiuto trentacinque anni e vivo al numero dodici di questa strada']);
  const r = alignClip(s, t);
  assert.equal(r.coverages.length, 1);
  assert.equal(r.coverages[0].ratio, 1);
});

test('clip che copre solo meta dello script', () => {
  const t = makeTranscript([L3, { pause: 1 }, L4]);
  const r = alignClip(script, t);
  assert.deepEqual(r.coverages.map((c) => c.lineId), ['L0003', 'L0004']);
});

test('battuta mai pronunciata non produce coverage', () => {
  const t = makeTranscript([L1, L3, L4]);
  const r = alignClip(script, t);
  assert.equal(byLine(r, 'L0002').length, 0);
  assert.equal(r.coverages.length, 3);
});

test('battute in ordine diverso dallo script', () => {
  const t = makeTranscript([L4, { pause: 1 }, L2, { pause: 1 }, L1]);
  const r = alignClip(script, t);
  assert.deepEqual(r.coverages.map((c) => c.lineId), ['L0004', 'L0002', 'L0001']);
});

test('stesso testo in due battute: nessuna porzione assegnata due volte', () => {
  const s = makeScript([
    ['A', 'Vieni qui subito, ti devo parlare di una cosa seria.'],
    ['B', 'Vieni qui subito, ti devo parlare di una cosa seria.'],
  ]);
  const t = makeTranscript(['Vieni qui subito, ti devo parlare di una cosa seria.']);
  const r = alignClip(s, t);
  assert.equal(r.coverages.length, 1);
});

test('righe non dialogue ignorate, trascrizione vuota', () => {
  const s = makeScript([['A', L1]]);
  s.lines.push({ id: 'L0002', order: 1, type: 'action', character: null, text: L2, sceneId: 'S1' });
  const t = makeTranscript([L2]);
  assert.deepEqual(alignClip(s, t).coverages, []);
  assert.deepEqual(alignClip(s, makeTranscript([])), { coverages: [], unmatched: [] });
});

test('la fine non supera una pausa lunga', () => {
  const t = makeTranscript([L2, { pause: 4 }, 'altro parlato che segue molto dopo ma non conta']);
  const r = alignClip(script, t);
  const c = r.coverages[0];
  assert.ok(c.endFrame <= t.gaps[0].startFrame);
  assert.ok(c.endFrame > c.startFrame);
});
