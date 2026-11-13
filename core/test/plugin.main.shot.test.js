import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

import * as sync from '../src/sync/index.js';
import { parseResolveTranscript } from '../src/transcript/parse.js';
import { alignClip } from '../src/align/index.js';
import { parseFdx, parsePdf, applyScriptEdit } from '../src/script/index.js';
import * as sequence from '../src/sequence/index.js';
import * as board from '../src/board/index.js';
import { createBridge } from '../src/bridge/resolveBridge.js';
import { makeFakeResolve } from './helpers/fakeResolve.js';

const require = createRequire(import.meta.url);
const { createHandlers, METHOD_NAMES } = require('../../plugin/main/handlers.js');
const { createState } = require('../../plugin/main/state.js');

const FDX = `<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="1"><Content>
<Paragraph Type="Scene Heading"><Text>INT. CUCINA - GIORNO</Text></Paragraph>
<Paragraph Type="Character"><Text>MARTA</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>Non tornera piu da questa casa</Text></Paragraph>
<Paragraph Type="Action"><Text>Marta esce dalla stanza.</Text></Paragraph>
</Content></FinalDraft>`;

const props = (cam, extra = {}) => ({ props: { Scene: '1', Shot: '2', Take: '3', 'Camera #': cam, ...extra } });

async function setup(items) {
  const f = makeFakeResolve({ bins: [{ name: 'Scena 1', items }] });
  const state = createState(sync); const events = [];
  const h = createHandlers({
    core: { sync, parseResolveTranscript, alignClip, parseFdx, parsePdf, applyScriptEdit, sequence, board },
    bridge: createBridge(f.resolve), state, notify: (s) => events.push(s), readFile: async () => Buffer.from(FDX), writeFile: async () => {}, diagPath: '/d.json',
  });
  await h.loadScript('/s.fdx');
  await h.loadBins(['Scena 1']);
  return { h, state, events };
}

const ITEMS = [
  { id: 'a1', name: 'S1_CAM_A.mov', frames: 500, ...props('A', { 'Shot Type': 'WIDE' }) },
  { id: 'b1', name: 'S1_CAM_B_CU.mov', frames: 500, ...props('B') },
  { id: 'c1', name: 'S1_CAM_C.mov', frames: 500, ...props('C') },
];

test('loadBins applica il tipo di inquadratura dai metadati senza scavalcare il manuale', async () => {
  const { h, state } = await setup(ITEMS);
  const t = state.project.takes;
  assert.deepEqual([t[0].shot, t[0].shotSource], ['totale', 'metadati']);
  assert.deepEqual([t[1].shot, t[1].shotSource], ['stretto', 'metadati']); // dal nome file
  assert.equal(t[2].shot ?? null, null);
  assert.equal(t[0].meta.shotType, 'WIDE');
  await h.setTakeShot({ takeId: 'T1', shot: 'dettaglio' });
  await h.loadBins(['Scena 1']);
  assert.deepEqual([state.project.takes[0].shot, state.project.takes[0].shotSource], ['dettaglio', 'manuale']);
  const view = state.snapshot().view.takes;
  assert.deepEqual([view[0].shot, view[0].shotSource, view[2].shot], ['dettaglio', 'manuale', null]);
});

test('setTakeShot: atomico, ce:changed, errori, azzeramento e undo; METHOD_NAMES aggiornato', async () => {
  const { h, state, events } = await setup(ITEMS);
  for (const n of ['setTakeShot', 'detectGroupsByCoverage', 'suggestMaster']) assert.ok(METHOD_NAMES.includes(n) && typeof h[n] === 'function', n);
  const preload = await readFile(new URL('../../plugin/preload.js', import.meta.url), 'utf8');
  for (const n of ['setTakeShot', 'detectGroupsByCoverage', 'suggestMaster']) assert.ok(preload.includes(`'${n}'`), `preload ${n}`);
  const n = events.length;
  await h.setTakeShot({ takeId: 'T3', shot: 'medio' });
  assert.equal(events.length, n + 1);
  assert.deepEqual([state.project.takes[2].shot, state.project.takes[2].shotSource], ['medio', 'manuale']);
  await h.setTakeShot({ takeId: 'T3', shot: 'stretto', source: 'copertura' });
  assert.equal(state.project.takes[2].shotSource, 'copertura');
  await assert.rejects(() => h.setTakeShot({ takeId: 'T3', shot: 'boh' }), /shot non valido/);
  await assert.rejects(() => h.setTakeShot({ takeId: 'TX', shot: 'medio' }), /take sconosciuto/);
  assert.equal(state.project.takes[2].shot, 'stretto');
  await h.setTakeShot({ takeId: 'T3', shot: null });
  assert.equal(state.project.takes[2].shot, null);
  await h.undo();
  assert.equal(state.project.takes[2].shot, 'stretto');
});

test('detectGroupsByCoverage + suggestMaster: unione con i metadati senza duplicati', async () => {
  const { h, state } = await setup(ITEMS);
  const [, l1] = state.project.scriptDoc.lines.filter((l) => l.type === 'dialogue' || l.type === 'action');
  const lines = state.project.scriptDoc.lines.filter((l) => l.type === 'dialogue' || l.type === 'action').map((l) => l.id);
  assert.ok(l1);
  for (const [t, f0] of [['T1', 0], ['T2', 20], ['T3', 40]]) {
    let i = 0;
    for (const lineId of lines) {
      await h.addAnchor({ takeId: t, lineId, edge: 'start', frame: f0 + i * 100 });
      await h.addAnchor({ takeId: t, lineId, edge: 'end', frame: f0 + i * 100 + 90 });
      i++;
    }
  }
  const props1 = await h.detectGroupsByCoverage();
  // stessi Scene/Shot/Take sulle tre clip: un solo gruppo (metadati), la copertura non lo duplica
  assert.equal(props1.length, 1);
  assert.equal(props1[0].source, 'metadati');
  assert.equal(props1[0].takeIds.length, 3);
  assert.ok(props1[0].master.takeId);
  assert.ok(state.project.takes.every((t) => !t.groupId)); // non scrive nulla
  for (const [i, id] of ['T1', 'T2', 'T3'].entries()) await h.setTakeGroup(id, 'G1', `CAM ${'ABC'[i]}`);
  const m = await h.suggestMaster('G1');
  assert.ok(m.reason);
  assert.equal(m.hypotheses.every((x) => x.shotSource === null && x.shot === 'stretto'), true);
  assert.ok(state.project.takes.filter((t) => t.id !== 'T1' && t.id !== 'T2').every((t) => t.shotSource !== 'copertura'));
  await assert.rejects(() => h.suggestMaster('G99'), /Gruppo sconosciuto/);
});

test('detectGroupsByCoverage: senza metadati comuni usa la copertura', async () => {
  const items = [
    { id: 'a1', name: 'ripresa_uno.mov', frames: 500, props: { 'Camera #': 'A' } },
    { id: 'b1', name: 'altra_ripresa.mov', frames: 480, startTc: '05:00:00:00', props: { 'Camera #': 'B' } },
  ];
  const { h, state } = await setup(items);
  const lines = state.project.scriptDoc.lines.filter((l) => l.type === 'dialogue' || l.type === 'action').map((l) => l.id);
  for (const t of ['T1', 'T2']) {
    let i = 0;
    for (const lineId of lines) {
      await h.addAnchor({ takeId: t, lineId, edge: 'start', frame: i * 100 });
      await h.addAnchor({ takeId: t, lineId, edge: 'end', frame: i * 100 + 90 });
      i++;
    }
  }
  const found = await h.detectGroupsByCoverage();
  assert.equal(found.length, 1);
  assert.equal(found[0].source, 'copertura');
  assert.deepEqual(found[0].takeIds, ['T1', 'T2']);
  assert.match(found[0].reason, /copertura/);
});
