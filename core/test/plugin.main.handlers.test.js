import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as sync from '../src/sync/index.js';
import { parseResolveTranscript } from '../src/transcript/parse.js';
import { alignClip } from '../src/align/index.js';
import { parseFdx, parsePdf, applyScriptEdit } from '../src/script/index.js';
import * as sequence from '../src/sequence/index.js';
import * as board from '../src/board/index.js';
import { createBridge } from '../src/bridge/resolveBridge.js';
import { makeFakeResolve, syntheticTranscript } from './helpers/fakeResolve.js';
import { muteScript } from './sync.helpers.js';

const require = createRequire(import.meta.url);
const { createHandlers, METHOD_NAMES } = require('../../plugin/main/handlers.js');
const { createState } = require('../../plugin/main/state.js');
const { createPersist } = require('../../plugin/main/persist.js');

const FDX = `<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="1"><Content>
<Paragraph Type="Scene Heading"><Text>INT. CUCINA - GIORNO</Text></Paragraph>
<Paragraph Type="Action"><Text>Marta entra.</Text></Paragraph>
<Paragraph Type="Character"><Text>MARTA</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>Non tornera piu da questa casa</Text></Paragraph>
</Content></FinalDraft>`;

async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ce-test-'));
  const words = 'non tornera piu da questa casa'.split(' ');
  const f = makeFakeResolve({
    items: [{ id: 'c1', name: 'Clip A', fps: 25, frames: 1000, startTc: '01:00:00:00', transcription: syntheticTranscript({ words, startSec: 2 }) }],
  });
  f.mp.selected = [f.clips[0]];
  const files = { '/s.fdx': Buffer.from(FDX) };
  const events = [];
  const written = {};
  const state = createState(sync);
  const h = createHandlers({
    core: { sync, parseResolveTranscript, alignClip, parseFdx, parsePdf, applyScriptEdit, sequence, board },
    bridge: createBridge(f.resolve), state,
    persist: createPersist({ dir }),
    notify: (s) => events.push(s),
    pickFile: async () => ({ path: '/s.fdx', name: 's.fdx' }),
    readFile: async (p) => { if (!files[p]) throw new Error('ENOENT'); return files[p]; },
    writeFile: async (p, t) => { written[p] = t; },
    diagPath: '/diag.json',
  });
  return { h, f, dir, events, written, state, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('METHOD_NAMES coincide con l\'API del contratto e con gli handler', async () => {
  const t = await setup();
  for (const n of METHOD_NAMES) assert.equal(typeof t.h[n], 'function', n);
  assert.equal(Object.keys(t.h).length, METHOD_NAMES.length);
  await t.cleanup();
});

test('preload e METHOD_NAMES elencano gli stessi metodi', async () => {
  const src = await readFile(new URL('../../plugin/preload.js', import.meta.url), 'utf8');
  const listed = [...src.slice(src.indexOf('const METHODS'), src.indexOf('];')).matchAll(/'([\w.]+)'/g)].map((m) => m[1]);
  assert.deepEqual(listed, METHOD_NAMES);
});

test('flusso: loadScript -> addTake -> autoSync -> getState -> sidecar', async () => {
  const t = await setup();
  await assert.rejects(() => t.h.addTake({ clipId: 'c1' }), /script/i);
  const picked = await t.h.pickScriptFile();
  assert.equal(picked.name, 's.fdx');
  const r = await t.h.loadScript(picked.path);
  assert.ok(r.scriptDoc.lines.some((l) => l.type === 'dialogue'));
  const { takeId } = await t.h.addTake({ clipId: 'c1' });
  assert.equal(takeId, 'T1');
  assert.deepEqual(await t.h.getTranscribeStatus(), { jobStatus: 'Inactive' });
  const a = await t.h.autoSync(takeId);
  assert.ok(a.added >= 2);
  const { view } = await t.h.getState();
  const dialogue = view.lines.find((l) => l.type === 'dialogue');
  assert.equal(view.bestTake[dialogue.id], 'T1');
  assert.ok(view.coverage.T1.find((c) => c.lineId === dialogue.id));
  assert.ok(t.events.length >= 3);
  // sidecar salvato automaticamente
  const saved = JSON.parse(await readFile(path.join(t.dir, 'Progetto di prova.ce.json'), 'utf8'));
  assert.equal(saved.takes.length, 1);
  // ricarica in un nuovo stato
  t.state.setProject(null);
  const lp = await t.h.loadProject();
  assert.equal(lp.loaded, true);
  assert.equal(lp.project.anchors.length, saved.anchors.length);
  await t.cleanup();
});

test('ancore manuali, marker, playhead, selezione e note', async () => {
  const t = await setup();
  await t.h.loadScript('/s.fdx');
  const { takeId } = await t.h.addTake({ clipId: 'c1', label: 'Presa 1' });
  const action = t.state.project.scriptDoc.lines.find((l) => l.type === 'action');
  const { anchorId } = await t.h.addAnchor({ takeId, lineId: action.id, edge: 'start', frame: 100 });
  await t.h.addAnchor({ takeId, lineId: action.id, edge: 'end', frame: 180 });
  await t.h.moveAnchor(anchorId, 110);
  assert.equal(t.state.project.anchors.find((a) => a.id === anchorId).frame, 110);
  await t.h.anchorFromMarker({ takeId, lineId: action.id, edge: 'end', markerFrame: 190 });
  assert.equal(t.state.project.anchors.find((a) => a.edge === 'end').frame, 190);

  const w = await t.h.writeMarkers({ takeId });
  assert.deepEqual([w.ok, w.count], [true, 2]);
  assert.equal(t.f.clips[0].markers[110].customData, `ce:${action.id}:start`);

  // playhead: costruiamo una timeline con la clip
  await t.h.setSelection(action.id, takeId);
  const asm = await t.h.assemble({ lineIds: [action.id], timelineName: 'Mont', handleFrames: 5 });
  assert.equal(asm.ok, true);
  assert.deepEqual(t.f.res.appended[0], [{ id: 'c1', startFrame: 105, endFrame: 195 }]);
  t.f.res.currentTimeline.tc = '01:00:00:10'; // 90010 @25fps: item timeline 90000.. con sorgente da 105
  const ph = await t.h.anchorFromPlayhead({ takeId, lineId: action.id, edge: 'point' });
  assert.deepEqual(ph, { ok: true, frame: 115 });

  await t.h.setNote(action.id, 'nota');
  assert.equal(t.state.project.notes[action.id], 'nota');
  const dlg = t.state.project.scriptDoc.lines.find((l) => l.type === 'dialogue');
  const none = await t.h.assemble({ lineIds: [dlg.id], timelineName: 'X' });
  assert.equal(none.ok, false);
  assert.equal(none.skipped[0].reason, 'nessun-take');

  await t.h.removeAnchor(anchorId);
  await t.h.removeTake(takeId);
  assert.equal(t.state.project.takes.length, 0);
  assert.equal(t.state.project.anchors.length, 0);
  await t.cleanup();
});

test('previewLine: riga non coperta -> ok:false; coperta -> mark in/out', async () => {
  const t = await setup();
  await t.h.loadScript('/s.fdx');
  const { takeId } = await t.h.addTake({ clipId: 'c1' });
  const action = t.state.project.scriptDoc.lines.find((l) => l.type === 'action');
  assert.equal((await t.h.previewLine({ lineId: action.id, takeId })).ok, false);
  await t.h.addAnchor({ takeId, lineId: action.id, edge: 'start', frame: 50 });
  await t.h.addAnchor({ takeId, lineId: action.id, edge: 'end', frame: 90 });
  assert.deepEqual(await t.h.previewLine({ lineId: action.id, takeId }), { ok: true });
  assert.deepEqual(t.f.clips[0].markInOut, { in: 50, out: 89, type: 'all' });
  t.f.clips[0].failMarkInOut = true;
  assert.equal((await t.h.previewLine({ lineId: action.id, takeId })).ok, false);
  await t.cleanup();
});

test('anchorFromPlayhead: converte il playhead e propaga i fallimenti', async () => {
  const t = await setup();
  await t.h.loadScript('/s.fdx');
  const { takeId } = await t.h.addTake({ clipId: 'c1' });
  const action = t.state.project.scriptDoc.lines.find((l) => l.type === 'action');
  const r0 = await t.h.anchorFromPlayhead({ takeId, lineId: action.id, edge: 'start' });
  assert.equal(r0.ok, false); // nessuna timeline
  await createBridge(t.f.resolve).assemble([{ clipId: 'c1', startFrame: 200, endFrame: 300 }], 'T');
  t.f.res.currentTimeline.tc = '01:00:00:00'; // 90000 frame @25
  const r = await t.h.anchorFromPlayhead({ takeId, lineId: action.id, edge: 'start' });
  assert.deepEqual(r, { ok: true, frame: 200 });
  await t.cleanup();
});

test('loadScript: formato non supportato; script nuovo azzera le ancore ma tiene i take', async () => {
  const t = await setup();
  await assert.rejects(() => t.h.loadScript('/x.txt'), /non supportato/);
  await t.h.loadScript('/s.fdx');
  const { takeId } = await t.h.addTake({ clipId: 'c1' });
  const l = t.state.project.scriptDoc.lines.find((x) => x.type === 'action');
  await t.h.addAnchor({ takeId, lineId: l.id, edge: 'start', frame: 5 });
  await t.h.loadScript('/s.fdx');
  assert.equal(t.state.project.anchors.length, 0);
  assert.equal(t.state.project.takes.length, 1);
  await t.cleanup();
});

test('runDiagnostics scrive il JSON e ritorna il percorso', async () => {
  const t = await setup();
  const r = await t.h.runDiagnostics();
  assert.equal(r.path, '/diag.json');
  assert.ok(JSON.parse(t.written['/diag.json']).steps.length > 3);
  await t.cleanup();
});

test('stato senza script: getState vuoto e mutazioni con errore chiaro', async () => {
  const t = await setup();
  const { view } = await t.h.getState();
  assert.deepEqual(view.lines, []);
  await assert.rejects(() => t.h.setSelection('L1', null), /script/i);
  await t.cleanup();
});

test('persist: nomi di progetto non sicuri e file mancante', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ce-test-'));
  const p = createPersist({ dir });
  assert.equal(await p.load('../evil'), null);
  const file = await p.save('../evil', '{}');
  assert.ok(file.startsWith(dir));
  assert.equal(await p.load('../evil'), '{}');
  await rm(dir, { recursive: true, force: true });
});

test('muteScript compatibile con il progetto (sanity)', () => {
  assert.ok(muteScript().lines.length > 0);
});
