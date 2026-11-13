import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, addClip, addTake, addAnchor, setTakeShot, serialize, deserialize, setTakeGroup,
  detectGroupsByCoverage, suggestMaster, suggestMasterAmong, suggestShotFromMetadata, suggestGroupShots, mergeGroupProposals,
} from '../src/sync/index.js';
import { muteScript } from './sync.helpers.js';

// Progetto sintetico: tre camere sulla stessa performance (righe L2..L6) + una ripresa diversa in un altro bin.
function setup() {
  const p = createProject(muteScript());
  const clip = (id, dur) => addClip(p, id, { fps: 25, durationFrames: dur, startTcFrames: 0, name: id });
  clip('W', 1000); clip('M', 960); clip('C', 900); clip('X', 3000); clip('Y', 1000);
  addTake(p, { id: 'TW', clipId: 'W', bin: 'Scena 1' });
  addTake(p, { id: 'TM', clipId: 'M', bin: 'Scena 1' });
  addTake(p, { id: 'TC', clipId: 'C', bin: 'Scena 1' });
  addTake(p, { id: 'TX', clipId: 'X', bin: 'Scena 1' }); // durata molto diversa
  addTake(p, { id: 'TY', clipId: 'Y', bin: 'Scena 2' }); // altro bin
  const cover = (takeId, lines, step = 150) => lines.forEach((l, i) => {
    addAnchor(p, { takeId, lineId: l, edge: 'start', frame: i * step, kind: 'auto' });
    addAnchor(p, { takeId, lineId: l, edge: 'end', frame: i * step + step - 10, kind: 'auto' });
  });
  cover('TW', ['L2', 'L3', 'L4', 'L5', 'L6']);
  cover('TM', ['L2', 'L3', 'L4', 'L5']);
  cover('TC', ['L4', 'L5']);
  cover('TX', ['L2', 'L3', 'L4', 'L5', 'L6']);
  cover('TY', ['L2', 'L3', 'L4', 'L5', 'L6']);
  return p;
}

test('setTakeShot: valori, provenienza, azzeramento ed errori', () => {
  const p = setup();
  assert.equal(p.takes[0].shot, undefined);
  setTakeShot(p, 'TW', 'totale');
  assert.deepEqual([p.takes[0].shot, p.takes[0].shotSource], ['totale', 'manuale']);
  setTakeShot(p, 'TW', 'stretto', 'copertura');
  assert.equal(p.takes[0].shotSource, 'copertura');
  setTakeShot(p, 'TW', null);
  assert.deepEqual([p.takes[0].shot, p.takes[0].shotSource], [null, null]);
  assert.throws(() => setTakeShot(p, 'TW', 'enorme'), /shot non valido/);
  assert.throws(() => setTakeShot(p, 'TW', 'medio', 'boh'), /shotSource/);
  assert.throws(() => setTakeShot(p, 'NO', 'medio'), /take sconosciuto/);
});

test('serialize/deserialize: shot, v1 senza campi, valori sconosciuti tollerati', () => {
  const p = setup();
  setTakeShot(p, 'TM', 'medio', 'metadati');
  const back = deserialize(serialize(p));
  assert.deepEqual([back.takes[1].shot, back.takes[1].shotSource], ['medio', 'metadati']);
  assert.equal(back.takes[0].shot, undefined);
  const raw = JSON.parse(serialize(p));
  raw.takes[0].shot = 'gigantesco'; raw.takes[0].shotSource = 'x'; raw.takes[1].shotSource = 'altro-strano';
  const t = deserialize(raw);
  assert.deepEqual([t.takes[0].shot, t.takes[0].shotSource], [null, null]);
  assert.equal(t.takes[1].shotSource, null);
  // vecchio progetto v1: nessun campo shot
  const v1 = { version: 1, scriptDoc: p.scriptDoc, clips: p.clips, takes: [{ id: 'TW', clipId: 'W' }], anchors: [], selection: {}, notes: {} };
  assert.equal(deserialize(v1).takes[0].shot, undefined);
});

test('suggestShotFromMetadata: Shot Type, Angle, nome file, italiano e inglese', () => {
  const s = (m) => suggestShotFromMetadata(m)?.shot ?? null;
  assert.equal(s({ shotType: 'WIDE' }), 'totale');
  assert.equal(s({ shotType: 'Totale' }), 'totale');
  assert.equal(s({ shotType: 'LS' }), 'totale');
  assert.equal(s({ shotType: 'TOT' }), 'totale');
  assert.equal(s({ shotType: 'MS' }), 'medio');
  assert.equal(s({ shotType: 'Medium' }), 'medio');
  assert.equal(s({ shotType: 'CU' }), 'stretto');
  assert.equal(s({ shotType: 'Close-up' }), 'stretto');
  assert.equal(s({ shotType: 'MCU' }), 'stretto');
  assert.equal(s({ shotType: 'PP' }), 'stretto');
  assert.equal(s({ shotType: 'Primo piano' }), 'stretto');
  assert.equal(s({ shotType: 'PPP' }), 'dettaglio');
  assert.equal(s({ shotType: 'DET' }), 'dettaglio');
  assert.equal(s({ shotType: 'Extreme close up' }), 'dettaglio');
  assert.equal(s({ shotType: 'Medium close up' }), 'stretto');
  assert.equal(s({ angle: 'wide' }), 'totale');
  assert.equal(s({ name: 'S1_12_CU_CAM_B.mov' }), 'stretto');
  assert.equal(s({ name: 'A001_C003_WIDE.mp4' }), 'totale');
  // priorita' dei campi e rumore
  assert.equal(s({ shotType: 'CU', name: 'WIDE.mov' }), 'stretto');
  assert.equal(s({ shot: '2A', name: 'A001_C003.mov' }), null);
  assert.equal(s({ shotType: '  ' }), null);
  assert.equal(s({}), null);
  assert.equal(s(undefined), null);
  assert.equal(suggestShotFromMetadata({ shotType: 'CU' }).source, 'metadati');
});

test('detectGroupsByCoverage: stesso bin, copertura in comune e durata simile', () => {
  const p = setup();
  const props = detectGroupsByCoverage(p);
  assert.equal(props.length, 1);
  assert.deepEqual(props[0].takeIds.sort(), ['TC', 'TM', 'TW']);
  assert.ok(props[0].confidence > 0.6 && props[0].confidence <= 1);
  assert.match(props[0].reason, /copertura/);
  assert.match(props[0].groupId, /^G\d+$/);
  // non modifica il progetto
  assert.ok(p.takes.every((t) => !t.groupId));
});

test('detectGroupsByCoverage: soglie, esclusi, gruppi esistenti e id univoci', () => {
  const p = setup();
  assert.equal(detectGroupsByCoverage(p, { minOverlap: 1.1 }).length, 0);
  assert.equal(detectGroupsByCoverage(p, { durationTolerance: 0.01 }).length, 0);
  const big = detectGroupsByCoverage(p, { durationTolerance: 0.8 });
  assert.ok(big[0].takeIds.includes('TX')); // con tolleranza ampia entra anche il take lungo
  assert.ok(!big[0].takeIds.includes('TY')); // altro bin: mai
  setTakeGroup(p, 'TW', 'G7', 'CAM A');
  const after = detectGroupsByCoverage(p);
  assert.ok(after.every((g) => !g.takeIds.includes('TW')));
  assert.ok(after.every((g) => Number(g.groupId.slice(1)) > 7));
  assert.deepEqual(detectGroupsByCoverage(p, { excludeTakeIds: ['TM'] }), []);
});

test('detectGroupsByCoverage: ignora le righe non sincronizzabili e i take senza copertura', () => {
  const p = setup();
  p.anchors = p.anchors.filter((a) => a.takeId !== 'TC');
  addAnchor(p, { takeId: 'TC', lineId: 'L1', edge: 'start', frame: 0, kind: 'manual' }); // L1 e' una scena
  addAnchor(p, { takeId: 'TC', lineId: 'L1', edge: 'end', frame: 90, kind: 'manual' });
  const props = detectGroupsByCoverage(p);
  assert.deepEqual(props[0].takeIds.sort(), ['TM', 'TW']);
});

test('mergeGroupProposals: nessun duplicato', () => {
  const a = [{ groupId: 'G1', takeIds: ['A', 'B', 'C'] }];
  const b = [{ groupId: 'G2', takeIds: ['A', 'B'] }, { groupId: 'G3', takeIds: ['D', 'E'] }];
  assert.deepEqual(mergeGroupProposals(a, b).map((g) => g.groupId), ['G1', 'G3']);
});

test('suggestMaster: totale noto, altrimenti copertura piu\' ampia', () => {
  const p = setup();
  for (const id of ['TW', 'TM', 'TC']) setTakeGroup(p, id, 'G1', null);
  const m = suggestMaster(p, 'G1');
  assert.equal(m.takeId, 'TW');
  assert.match(m.reason, /copertura piu' ampia/);
  assert.match(m.reason, /include/);
  setTakeShot(p, 'TC', 'totale'); // un totale noto prevale anche se copre meno
  const m2 = suggestMaster(p, 'G1');
  assert.equal(m2.takeId, 'TC');
  assert.match(m2.reason, /totale/);
  assert.equal(suggestMaster(p, 'G9'), null);
  assert.equal(suggestMasterAmong(p, ['TM', 'TW']).takeId, 'TW');
});

test('suggestMaster: a parita\' di righe vince la durata', () => {
  const p = setup();
  setTakeGroup(p, 'TW', 'G1', null); setTakeGroup(p, 'TX', 'G1', null);
  assert.equal(suggestMaster(p, 'G1').takeId, 'TX');
});

test('suggestGroupShots: ipotesi stretto con shotSource null, mai scritte', () => {
  const p = setup();
  for (const id of ['TW', 'TM', 'TC']) setTakeGroup(p, id, 'G1', null);
  setTakeShot(p, 'TM', 'dettaglio');
  const hyp = suggestGroupShots(p, 'G1');
  assert.deepEqual(hyp.map((h) => h.takeId), ['TC']); // master TW escluso, TM gia' classificato
  assert.equal(hyp[0].shot, 'stretto');
  assert.equal(hyp[0].shotSource, null);
  assert.equal(p.takes.find((t) => t.id === 'TC').shot, undefined);
});
