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
const { createMediaRegistry } = require('../../plugin/main/protocol.js');

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
  const media = createMediaRegistry({ randomToken: (() => { let n = 0; return () => `tok${++n}`; })() });
  const h = createHandlers({
    core: { sync, parseResolveTranscript, alignClip, parseFdx, parsePdf },
    bridge: createBridge(f.resolve, { fileExists: (p) => exported().includes(p) }), state,
    notify: (s) => events.push(s), media,
    readFile: async () => Buffer.from(FDX),
    writeFile: async () => {},
    diagPath: '/diag.json',
    stillsDir: async () => '/stills/proj',
    mkdir: async (d) => { mkdirs.push(d); },
    showSaveDialog: async (o) => (o.suggestedName === 'annulla.png' ? null : `/out/${o.suggestedName}`),
    writeBinary: async (p, b) => { saved.push([p, b.toString('utf8')]); },
  });
  if (withScript) await h.loadScript('/s.fdx');
  return { h, f, events, saved, mkdirs, state, media };
}

test('METHOD_NAMES include i metodi v2 cablati e hanno tutti un handler', async () => {
  const { h } = await setup({ withScript: false });
  for (const n of ['listBins', 'loadBins', 'detectGroups', 'setTakeGroup', 'getClipMediaPath', 'board.addStill', 'board.removeItem', 'board.refreshStillViaResolve', 'saveFile', 'sequence.assemble']) {
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
  assert.ok(!state.project.takes[0].groupId); // null (modello v2) o assente
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
  const r = await h.getClipMediaPath('T1');
  assert.deepEqual(r, { path: '/m/a1.mov', proxyPath: null, codec: 'H.264', fps: 25, startTcFrames: 90000, url: 'ce-media://clip/tok1', proxyUrl: null });
  assert.equal((await h.getClipMediaPath('T2')).ok, false);
});

test('loadBins e getSelectedClips aggiungono mediaUrl (whitelist) solo per clip con File Path', async () => {
  const { h, f, media } = await setup();
  const clips = await h.loadBins(['Scena 1']);
  assert.equal(clips[0].mediaUrl, 'ce-media://clip/tok1');
  assert.equal(clips[1].mediaUrl, null);
  assert.equal(media.resolve(clips[0].mediaUrl), '/m/a1.mov');
  f.mp.selected = [f.clips[0]];
  assert.equal((await h.getSelectedClips())[0].mediaUrl, 'ce-media://clip/tok1');
});

test('getClipMediaPath: proxyPath registrato come secondo URL', async () => {
  const { h, f, media } = await setup();
  f.clips[1].props['File Path'] = '/m/b1.mov';
  f.clips[1].props['Proxy Media Path'] = '/p/b1.mp4';
  await h.loadBins(['Scena 1']);
  const r = await h.getClipMediaPath('T2');
  assert.equal(media.resolve(r.proxyUrl), '/p/b1.mp4');
  assert.equal(media.resolve(r.url), '/m/b1.mov');
});

test('board.addStill: marker Cyan sulla clip + item del modello; removeItem toglie il marker', async () => {
  const { h, f, state, events } = await setup();
  await h.loadBins(['Scena 1']);
  const n = events.length;
  const r = await h['board.addStill']({ takeId: 'T1', frame: 9999, lineId: state.project.scriptDoc.lines[0].id });
  assert.deepEqual(r, { ok: true, itemId: 'S1', markerWritten: true });
  assert.deepEqual(f.clips[0].markers[499], { color: 'Cyan', name: 'Still', note: '', duration: 1, customData: 'ce:still:S1' });
  assert.equal(state.project.board.items[0].frame, 499);
  assert.equal(events.length, n + 1);
  // frame con marker gia' presente: lo still esiste ma markerWritten false
  const r2 = await h['board.addStill']({ takeId: 'T1', frame: 499 });
  assert.equal(r2.itemId, 'S2');
  assert.equal(r2.markerWritten, false);
  assert.ok(r2.reason);
  const rm = await h['board.removeItem']('S1');
  assert.equal(rm.markerRemoved, true);
  assert.deepEqual(f.clips[0].markers, {});
  assert.deepEqual(state.project.board.items.map((i) => i.id), ['S2']);
  await assert.rejects(() => h['board.removeItem']('S9'), /sconosciuto/);
  await assert.rejects(() => h['board.addStill']({ takeId: 'T1' }), /Frame/);
});

test('board.removeItem: senza DeleteMarkerByCustomData ripiega sulla ricerca per customData', async () => {
  const { h, f } = await setup();
  await h.loadBins(['Scena 1']);
  f.clips[0].noDeleteByCustomData = true;
  await h['board.addStill']({ takeId: 'T1', frame: 10 });
  assert.equal((await h['board.removeItem']('S1')).markerRemoved, true);
  assert.deepEqual(f.clips[0].markers, {});
});

test('board.refreshStillViaResolve: ExportFrame esplicito, imagePath sull\'item; fallimento => via none', async () => {
  const { h, state, f, mkdirs } = await setup();
  await h.loadBins(['Scena 1']);
  await h['board.addStill']({ takeId: 'T1', frame: 12 });
  const r = await h['board.refreshStillViaResolve']('S1');
  assert.deepEqual(r, { ok: true, via: 'exportFrame', path: '/stills/proj/still_a1_12.png' });
  assert.equal(state.project.board.items[0].imagePath, r.path);
  assert.deepEqual(mkdirs, ['/stills/proj']);
  f.clips[1].exportFrame = 'false';
  await h['board.addStill']({ takeId: 'T2', frame: 5 });
  const bad = await h['board.refreshStillViaResolve']('S2');
  assert.equal(bad.ok, false);
  assert.equal(bad.via, 'none');
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
