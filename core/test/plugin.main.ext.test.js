import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

import * as sync from '../src/sync/index.js';
import { parseResolveTranscript } from '../src/transcript/parse.js';
import { alignClip } from '../src/align/index.js';
import { parseFdx, parsePdf } from '../src/script/index.js';
import { createBridge } from '../src/bridge/resolveBridge.js';
import { makeFakeResolve } from './helpers/fakeResolve.js';

const require = createRequire(import.meta.url);
const { createHandlers, METHOD_NAMES } = require('../../plugin/main/handlers.js');
const { createState } = require('../../plugin/main/state.js');

const FDX = `<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="1"><Content>
<Paragraph Type="Scene Heading"><Text>INT. CUCINA - GIORNO</Text></Paragraph>
<Paragraph Type="Character"><Text>MARTA</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>Non tornera piu da questa casa</Text></Paragraph>
</Content></FinalDraft>`;

const props = (cam, extra = {}) => ({ props: { Scene: '1', Shot: '2', Take: '3', 'Camera #': cam, ...extra } });

async function setup({ withScript = true } = {}) {
  const f = makeFakeResolve({
    bins: [{ name: 'Scena 1', items: [
      { id: 'a1', name: 'S1_CAM_A.mov', frames: 500, ...props('A', { 'File Path': '/m/a1.mov', 'Video Codec': 'H.264' }) },
      { id: 'b1', name: 'S1_CAM_B.mov', frames: 500, ...props('B') },
    ] }],
  });
  const events = []; const saved = []; const mkdirs = [];
  const exported = () => f.clips.flatMap((c) => c.exported);
  const state = createState(sync);
  const h = createHandlers({
    core: { sync, parseResolveTranscript, alignClip, parseFdx, parsePdf },
    bridge: createBridge(f.resolve, { fileExists: (p) => exported().includes(p) }), state,
    notify: (s) => events.push(s),
    readFile: async () => Buffer.from(FDX),
    writeFile: async () => {},
    diagPath: '/diag.json',
    stillsDir: async () => '/stills/proj',
    mkdir: async (d) => { mkdirs.push(d); },
    showSaveDialog: async (o) => (o.suggestedName === 'annulla.png' ? null : `/out/${o.suggestedName}`),
    writeBinary: async (p, b) => { saved.push([p, b.toString('utf8')]); },
  });
  if (withScript) await h.loadScript('/s.fdx');
  return { h, f, events, saved, mkdirs, state };
}

test('METHOD_NAMES include i metodi v2 cablati e hanno tutti un handler', async () => {
  const { h } = await setup({ withScript: false });
  for (const n of ['listBins', 'loadBins', 'detectGroups', 'setTakeGroup', 'getClipMediaPath', 'board.captureStill', 'saveFile', 'sequence.assemble']) {
    assert.ok(METHOD_NAMES.includes(n), n);
    assert.equal(typeof h[n], 'function', n);
  }
  const pre = await readFile(new URL('../../plugin/preload.js', import.meta.url), 'utf8');
  assert.match(pre, /split\('\.'\)/);
});

test('listBins + loadBins: registra take con bin e meta, senza duplicare', async () => {
  const { h, state, events } = await setup();
  assert.deepEqual((await h.listBins()).map((b) => b.name), ['Scena 1']);
  const clips = await h.loadBins(['Scena 1']);
  assert.deepEqual(clips.map((c) => c.takeId), ['T1', 'T2']);
  assert.equal(clips[0].bin, 'Scena 1');
  const p = state.project;
  assert.equal(p.takes.length, 2);
  assert.equal(p.takes[0].bin, 'Scena 1');
  assert.deepEqual(p.takes[1].meta, { scene: '1', shot: '2', take: '3', camera: 'B' });
  assert.equal(p.clips.a1.name, 'S1_CAM_A.mov');
  const n = events.length;
  const again = await h.loadBins(['Scena 1']);
  assert.deepEqual(again.map((c) => c.takeId), ['T1', 'T2']);
  assert.equal(p.takes.length, 2);
  assert.equal(events.length, n + 1);
});

test('loadBins: errori italiani', async () => {
  const { h } = await setup();
  await assert.rejects(() => h.loadBins([]), /Nessun bin/);
  await assert.rejects(() => h.loadBins(['Fantasma']), /Bin non trovati: Fantasma/);
  const t = await setup({ withScript: false });
  await assert.rejects(() => t.h.loadBins(['Scena 1']), /script/i);
});

test('detectGroups + setTakeGroup: gruppo per metadati, assegnamento e persistenza nel progetto', async () => {
  const { h, state, events } = await setup();
  await h.loadBins(['Scena 1']);
  const groups = await h.detectGroups();
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].takeIds, ['T1', 'T2']);
  assert.ok(groups[0].reason);
  assert.equal(state.project.takes[0].groupId, undefined);
  const n = events.length;
  await h.setTakeGroup('T1', groups[0].groupId, 'CAM A');
  await h.setTakeGroup('T2', groups[0].groupId, null);
  assert.equal(state.project.takes[0].groupId, 'G1');
  assert.equal(state.project.takes[0].angle, 'CAM A');
  assert.equal(state.project.takes[1].angle, null);
  assert.equal(events.length, n + 2);
  await assert.rejects(() => h.setTakeGroup('TX', 'G1', null), /Take sconosciuto/);
  assert.doesNotThrow(() => sync.serialize(state.project));
});

test('getClipMediaPath: da takeId', async () => {
  const { h } = await setup();
  await h.loadBins(['Scena 1']);
  assert.deepEqual(await h.getClipMediaPath('T1'), { path: '/m/a1.mov', codec: 'H.264', fps: 25 });
  assert.equal((await h.getClipMediaPath('T2')).ok, false);
});

test('board.captureStill: ExportFrame ok, clamp del frame, fallimento => via none', async () => {
  const { h, f, mkdirs } = await setup();
  await h.loadBins(['Scena 1']);
  const r = await h['board.captureStill']({ takeId: 'T1', frame: 9999 });
  assert.deepEqual(r, { ok: true, via: 'exportFrame', path: '/stills/proj/still_a1_499.png' });
  assert.deepEqual(mkdirs, ['/stills/proj']);
  f.clips[1].exportFrame = 'false';
  const bad = await h['board.captureStill']({ takeId: 'T2', frame: 10 });
  assert.equal(bad.ok, false);
  assert.equal(bad.via, 'none');
  assert.ok(bad.reason);
  await assert.rejects(() => h['board.captureStill']({ takeId: 'T1' }), /Frame/);
});

test('saveFile: scrive base64, annullamento => null', async () => {
  const { h, saved } = await setup({ withScript: false });
  const r = await h.saveFile({ suggestedName: 'lavagna.png', dataBase64: Buffer.from('PNGDATA').toString('base64'), filters: [] });
  assert.deepEqual(r, { path: '/out/lavagna.png' });
  assert.deepEqual(saved, [['/out/lavagna.png', 'PNGDATA']]);
  assert.equal(await h.saveFile({ suggestedName: 'annulla.png', dataBase64: 'AAAA' }), null);
  await assert.rejects(() => h.saveFile({ suggestedName: 'x' }), /Nessun dato/);
});

test('sequence.assemble: esegue un piano (clipId o takeId) e notifica', async () => {
  const { h, f, events } = await setup();
  await h.loadBins(['Scena 1']);
  const n = events.length;
  const r = await h['sequence.assemble']({
    timelineName: 'Regia',
    plan: [
      { clipId: 'a1', startFrame: 0, endFrame: 40, trackIndex: 1, recordFrame: 0, mediaType: 1 },
      { takeId: 'T2', startFrame: 0, endFrame: 40, trackIndex: 2, recordFrame: 0, mediaType: 1 },
    ],
  });
  assert.deepEqual(r, { ok: true, timelineName: 'Regia', itemsAdded: 2, tracksCreated: 1, skipped: [] });
  assert.deepEqual(f.res.appended.flat().map((x) => x.id), ['a1', 'b1']);
  assert.equal(events.length, n + 1);
  await assert.rejects(() => h['sequence.assemble']({ timelineName: 'x' }), /Piano/);
  await assert.rejects(() => h['sequence.assemble']({ plan: [] }), /Piano/);
});

test('sequence.assemble funziona anche senza script caricato (piano esplicito)', async () => {
  const { h } = await setup({ withScript: false });
  const r = await h['sequence.assemble']({ plan: [{ clipId: 'a1', startFrame: 0, endFrame: 10 }] });
  assert.equal(r.ok, true);
});
