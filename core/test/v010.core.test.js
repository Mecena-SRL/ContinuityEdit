// v0.1.0: drop-frame, revisioni dello script, modalita' documentario, ricerca nel parlato, editor di sequenza.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tcToFrames, framesToTc, isDropFrameTc } from '../src/transcript/timecode.js';
import { diffRevision, applyRevision, scriptFromTranscripts } from '../src/script/index.js';
import { searchTranscripts, phoneticKey } from '../src/search/phrase.js';
import { parseResolveTranscript } from '../src/transcript/parse.js';
import {
  sequenceLayout, splitItem, placeClip, moveClip, trimEdge, deleteItem, lineMarkers, toAppendPlanDetailed, addCutaway, sequenceFromLines,
} from '../src/sequence/index.js';
import { addAnchor, addClip, addTake, setSelection, setNote, setMark, serialize, deserialize, coverageForTake } from '../src/sync/index.js';
import { baseProject, muteScript } from './sync.helpers.js';
import { syntheticTranscript } from './helpers/fakeResolve.js';

// ---------------------------------------------------------------- drop-frame
test('timecode drop-frame 29.97: conversione esatta e andata/ritorno', () => {
  assert.equal(isDropFrameTc('01:00:00;00'), true);
  assert.equal(isDropFrameTc('01:00:00:00'), false);
  // 1 minuto DF = 1798 frame reali; 10 minuti = 17982
  assert.equal(tcToFrames('00:01:00;02', 29.97), 1800);
  assert.equal(tcToFrames('00:10:00;00', 29.97), 17982);
  assert.equal(tcToFrames('01:00:00;00', 29.97), 107892);
  // distanza esatta tra due TC della stessa clip
  const start = tcToFrames('01:00:00;00', 29.97);
  assert.equal(tcToFrames('01:05:00;10', 29.97, start), 5 * 1798 + 10 + 2 * 0);
  for (const f of [0, 1799, 1800, 17981, 17982, 107892, 123456]) {
    assert.equal(tcToFrames(framesToTc(f, 29.97, 0, { dropFrame: true }), 29.97), f, `andata/ritorno ${f}`);
  }
  assert.equal(framesToTc(1800, 29.97, 0, { dropFrame: true }), '00:01:00;02');
  // non drop-frame invariato; a 25 fps il ';' non cambia nulla
  assert.equal(tcToFrames('01:00:00:00', 25), 90000);
  assert.equal(tcToFrames('01:00:00;00', 25), 90000);
});

// ---------------------------------------------------------------- revisioni
const doc = (rows) => ({
  title: 'R', source: 'fdx', scenes: [{ id: 'S1', heading: 'INT. CASA', lineIds: rows.map((_, i) => `N${i + 1}`) }],
  lines: rows.map(([type, text, character = null], i) => ({ id: `N${i + 1}`, order: i + 1, type, text, character, sceneId: 'S1' })),
});

test('diffRevision: uguali, modificate, tolte, nuove (in ordine, con battute ripetute)', () => {
  const old = muteScript();
  const next = doc([
    ['scene', 'INT. CUCINA - GIORNO'],
    ['action', 'Un gatto dorme sul davanzale.'], // nuova
    ['action', 'Marta entra e posa le chiavi sul tavolo.'], // uguale (era L2)
    ['dialogue', 'Non tornera piu, te lo giuro.', 'MARTA'], // modificata (era L4)
    ['action', 'Apre il frigo e lo richiude subito.'], // uguale (L5)
    ['action', 'Esce lasciando la porta aperta.'], // uguale (L6)
  ]);
  const d = diffRevision(old, next);
  assert.equal(d.map.L2, 'N3');
  assert.equal(d.map.L3, null); // "Guarda fuori dalla finestra" tolta
  assert.equal(d.map.L4, 'N4');
  assert.equal(d.status.L4, 'modificata');
  assert.deepEqual(d.added, ['N2']);
  assert.deepEqual(d.stats, { uguali: 4, modificate: 1, tolte: 1, nuove: 1 });
});

test('applyRevision: migra ancore, scelte, note, valutazioni e sequenza; toglie i riferimenti alle righe tolte', () => {
  const p = baseProject();
  for (const [l, s, e] of [['L2', 10, 50], ['L3', 60, 90], ['L4', 100, 200]]) {
    addAnchor(p, { takeId: 'T1', lineId: l, edge: 'start', frame: s });
    addAnchor(p, { takeId: 'T1', lineId: l, edge: 'end', frame: e });
  }
  setSelection(p, 'L4', 'T1'); setNote(p, 'L3', 'da togliere'); setNote(p, 'L4', 'bella'); setNote(p, 'T1', 'nota take');
  setMark(p, 'T1', 'L4', { rating: 'buono' });
  sequenceFromLines(p, ['L2', 'L3', 'L4']);
  const next = doc([['scene', 'INT. CUCINA - GIORNO'], ['action', 'Marta entra e posa le chiavi sul tavolo.'], ['dialogue', 'Non tornera piu.', 'MARTA']]);
  const r = applyRevision(p, next, diffRevision(p.scriptDoc, next));
  assert.deepEqual(r, { anchorsKept: 4, anchorsDropped: 2 });
  assert.deepEqual(p.anchors.map((a) => a.lineId).sort(), ['N2', 'N2', 'N3', 'N3']);
  assert.deepEqual(p.selection, { N3: 'T1' });
  assert.deepEqual(p.notes, { N3: 'bella', T1: 'nota take' });
  assert.ok(p.marks['T1|N3']);
  assert.deepEqual(p.sequence.items.flatMap((i) => i.lineIds), ['N2', 'N3']);
  assert.equal(coverageForTake(p, 'T1').length, 2);
  deserialize(serialize(p)); // progetto valido
});

// ---------------------------------------------------------------- documentario
test('scriptFromTranscripts: frasi -> righe di dialogo con ancore esatte, una scena per clip', () => {
  const raw = syntheticTranscript({ words: ['Questa', 'sera', 'c\'e\'', 'cinema.', 'Venite', 'tutti?', 'Si'], startSec: 1 });
  const t = parseResolveTranscript(raw, { clipId: 'C1', fps: 25, startTcFrames: 90000 });
  const { scriptDoc, anchors } = scriptFromTranscripts([{ takeId: 'T1', name: 'Intervista', transcript: t }, { takeId: 'T2', name: 'vuota', transcript: { words: [] } }]);
  assert.deepEqual(scriptDoc.lines.map((l) => [l.type, l.text]), [
    ['scene', 'Intervista'], ['dialogue', 'Questa sera c\'e\' cinema.'], ['dialogue', 'Venite tutti?'], ['dialogue', 'Si'],
  ]);
  assert.equal(scriptDoc.lines[1].character, 'PARLATO');
  assert.equal(scriptDoc.scenes.length, 1);
  const a = anchors.filter((x) => x.lineId === 'L0002');
  assert.deepEqual(a.map((x) => x.edge), ['start', 'end']);
  assert.equal(a[0].frame, 25); // 1 s
  assert.equal(a[1].frame, Math.min(t.words[3].endFrame, t.words[4].startFrame)); // mai oltre l'inizio della parola dopo
});

// ---------------------------------------------------------------- ricerca nel parlato
const tdoc = (takeId, words) => parseResolveTranscript(syntheticTranscript({ words }), { clipId: takeId, fps: 25, startTcFrames: 90000 });

test('phoneticKey: grafie diverse, stesso suono', () => {
  assert.equal(phoneticKey('chiesa'), phoneticKey('kiesa'));
  assert.equal(phoneticKey('cappuccino'), phoneticKey('capucino'));
  assert.equal(phoneticKey('hotel'), phoneticKey('otel'));
  assert.notEqual(phoneticKey('casa'), phoneticKey('cassetta'));
});

test('searchTranscripts: frase esatta, errori ASR, parola in digitazione, contesto e ordinamento', () => {
  const docs = [
    { takeId: 'T1', words: tdoc('T1', 'allora domani andiamo al mare con la macchina di Giulio'.split(' ')).words },
    { takeId: 'T2', words: tdoc('T2', 'io domani andiamo al mere forse'.split(' ')).words },
  ];
  const h = searchTranscripts(docs, 'andiamo al mare');
  assert.equal(h[0].takeId, 'T1');
  assert.equal(h[0].score, 1);
  assert.equal(h[0].match, 'andiamo al mare');
  assert.equal(h[0].before, 'allora domani');
  assert.ok(h.some((x) => x.takeId === 'T2' && x.score < 1)); // "mere": errore di riconoscimento
  assert.equal(searchTranscripts(docs, 'macch')[0].match, 'macchina'); // parola ancora in digitazione
  assert.deepEqual(searchTranscripts(docs, 'elefante rosa'), []);
  assert.deepEqual(searchTranscripts(docs, '  '), []);
  assert.ok(h[0].endFrame > h[0].startFrame);
});

// ---------------------------------------------------------------- editor di sequenza
function edProject() {
  const p = baseProject({ duration: 1000 });
  addClip(p, 'C2', { fps: 25, durationFrames: 800, startTcFrames: 0, name: 'B' });
  addTake(p, { id: 'T2', clipId: 'C2', label: 'Ciak 2' });
  for (const [l, s, e] of [['L2', 100, 200], ['L3', 200, 300], ['L4', 300, 400]]) {
    addAnchor(p, { takeId: 'T1', lineId: l, edge: 'start', frame: s }); addAnchor(p, { takeId: 'T1', lineId: l, edge: 'end', frame: e });
    addAnchor(p, { takeId: 'T2', lineId: l, edge: 'start', frame: s - 50 }); addAnchor(p, { takeId: 'T2', lineId: l, edge: 'end', frame: e - 50 });
  }
  return p;
}
const lay = (p) => sequenceLayout(p.sequence).items.map((x) => [x.track, x.rec, x.len, x.takeId]);

test('placeClip su V1: inserisci (ripple) e sovrascrivi; righe del master agganciate', () => {
  const p = edProject();
  const a = placeClip(p, { takeId: 'T1', startFrame: 100, endFrame: 300, track: 1, recordFrame: 0 });
  assert.deepEqual(a.lineIds, ['L2', 'L3']);
  placeClip(p, { takeId: 'T2', startFrame: 0, endFrame: 50, track: 1, recordFrame: 100, mode: 'insert' }); // taglia a e inserisce
  assert.deepEqual(lay(p), [[1, 0, 100, 'T1'], [1, 100, 50, 'T2'], [1, 150, 100, 'T1']]);
  placeClip(p, { takeId: 'T2', startFrame: 500, endFrame: 520, track: 1, recordFrame: 140, mode: 'overwrite' });
  assert.deepEqual(lay(p), [[1, 0, 100, 'T1'], [1, 100, 40, 'T2'], [1, 140, 20, 'T2'], [1, 160, 90, 'T1']]);
  assert.equal(sequenceLayout(p.sequence).total, 250);
});

test('placeClip su V2: sovrascrive, accorcia o spezza i pezzi sotto', () => {
  const p = edProject();
  placeClip(p, { takeId: 'T1', startFrame: 0, endFrame: 500, track: 1, recordFrame: 0 });
  placeClip(p, { takeId: 'T2', startFrame: 0, endFrame: 200, track: 2, recordFrame: 100 });
  placeClip(p, { takeId: 'T2', startFrame: 600, endFrame: 650, track: 2, recordFrame: 150 }); // nel mezzo: spezza
  const v2 = sequenceLayout(p.sequence).items.filter((x) => x.track === 2).sort((a, b) => a.rec - b.rec).map((x) => [x.rec, x.len, x.startFrame]);
  assert.deepEqual(v2, [[100, 50, 0], [150, 50, 600], [200, 100, 100]]);
});

test('splitItem: master divide le righe, cutaway diventa libero; trimEdge e moveClip', () => {
  const p = edProject();
  sequenceFromLines(p, ['L2', 'L3', 'L4']); // master 100..400
  const cut = addCutaway(p, null, { takeId: 'T2', fromLineId: 'L3', toLineId: 'L3' }); // rec 100, len 100
  assert.deepEqual(sequenceLayout(p.sequence).items.find((x) => x.id === cut.id).rec, 100);
  const m = p.sequence.items[0];
  const { left, right } = splitItem(p, m.id, 150);
  assert.deepEqual([left.endFrame, right.startFrame], [250, 250]);
  assert.deepEqual([left.lineIds, right.lineIds], [['L2', 'L3'], ['L4']]);
  assert.throws(() => splitItem(p, m.id, 0), /dentro/);
  // il cutaway agganciato segue il master
  trimEdge(p, left.id, 'start', 20); // master parte 20 frame dopo: tutto scorre a sinistra
  assert.equal(sequenceLayout(p.sequence).items.find((x) => x.id === cut.id).rec, 80);
  trimEdge(p, cut.id, 'end', -10);
  assert.equal(p.sequence.items.find((x) => x.id === cut.id).endOffsetFrames, -10);
  // spostarlo a mano lo rende libero
  moveClip(p, cut.id, { recordFrame: 10, track: 3 });
  const c = p.sequence.items.find((x) => x.id === cut.id);
  assert.deepEqual([c.fromLineId, c.recordFrame, c.track], [undefined, 10, 3]);
  // riordino su V1
  moveClip(p, right.id, { recordFrame: 0, track: 1 });
  assert.equal(p.sequence.items.filter((x) => x.role === 'master')[0].id, right.id);
  deleteItem(p, right.id);
  assert.equal(sequenceLayout(p.sequence).items.filter((x) => x.track === 1).length, 1);
  deserialize(serialize(p));
});

test('deleteItem di un master: i cutaway agganciati restano liberi al loro posto', () => {
  const p = edProject();
  sequenceFromLines(p, ['L2', 'L3']);
  const c = addCutaway(p, null, { takeId: 'T2', fromLineId: 'L3' });
  deleteItem(p, p.sequence.items[0].id);
  const it = p.sequence.items.find((x) => x.id === c.id);
  assert.deepEqual([it.fromLineId, it.recordFrame], [undefined, 100]);
});

test('fps diversi: durate e marker delle righe convertiti in frame di timeline', () => {
  const p = createP50();
  sequenceFromLines(p, ['L2', 'L3']); // clip a 50 fps, 100..300 sorgente = 200 frame -> 100 frame a 25
  const o = { timelineFps: 25, clipFps: { C1: 50 } };
  const { plan } = toAppendPlanDetailed(p.sequence, { ...o, withAudio: false });
  assert.deepEqual(plan.map((e) => [e.startFrame, e.endFrame, e.recordFrame]), [[100, 300, 0]]);
  assert.equal(sequenceLayout(p.sequence, o).total, 100);
  assert.deepEqual(lineMarkers(p.sequence, o).map((m) => [m.lineId, m.recordFrame]), [['L2', 0], ['L3', 50]]);
  placeClip(p, { takeId: 'T1', startFrame: 0, endFrame: 100, track: 1, recordFrame: 50, mode: 'insert' }, o);
  assert.deepEqual(sequenceLayout(p.sequence, o).items.map((x) => [x.rec, x.len, x.startFrame, x.endFrame]), [[0, 50, 100, 200], [50, 50, 0, 100], [100, 50, 200, 300]]);
});

function createP50() {
  const p = baseProject();
  p.clips.C1.fps = 50;
  for (const [l, s, e] of [['L2', 100, 200], ['L3', 200, 300]]) {
    addAnchor(p, { takeId: 'T1', lineId: l, edge: 'start', frame: s }); addAnchor(p, { takeId: 'T1', lineId: l, edge: 'end', frame: e });
  }
  return p;
}
