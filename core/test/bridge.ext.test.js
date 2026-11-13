import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../src/bridge/resolveBridge.js';
import { detectGroups, splitCameraName } from '../src/bridge/groups.js';
import { makeFakeResolve } from './helpers/fakeResolve.js';

const P = (scene, shot, take, camera, extra = {}) => ({ props: { Scene: scene, Shot: shot, Take: take, 'Camera #': camera, ...extra } });

function binsFake(extra = {}) {
  return makeFakeResolve({
    bins: [
      { name: 'Scena 1', items: [
        { id: 'a1', name: 'S1_CAM_A.mov', frames: 500, ...P('1', '2', '3', 'A', { 'File Path': '/m/a1.mov', 'Video Codec': 'ProRes 422' }) },
        { id: 'b1', name: 'S1_CAM_B.mov', frames: 500, ...P('1', '2', '3', 'B') },
        { id: 'c1', name: 'altro.mov', frames: 300, ...P('1', '3', '1', 'A') },
      ], subs: [{ name: 'Extra', items: [{ id: 'x1', name: 'extra.mov', frames: 100 }] }] },
      { name: 'Scena 2', items: [{ id: 'd1', name: 'S2.mov', frames: 200 }] },
    ],
    ...extra,
  });
}

test('listBins: sottocartelle ricorsive con percorso e conteggio', async () => {
  const f = binsFake();
  const bins = await createBridge(f.resolve).listBins();
  assert.deepEqual(bins, [
    { name: 'Scena 1', path: 'Scena 1', clipCount: 3 },
    { name: 'Extra', path: 'Scena 1/Extra', clipCount: 1 },
    { name: 'Scena 2', path: 'Scena 2', clipCount: 1 },
  ]);
});

test('listBins: senza nomi usa un segnaposto e non lancia', async () => {
  const f = makeFakeResolve({ items: [{ id: 'z', name: 'z' }] });
  const bins = await createBridge(f.resolve).listBins();
  assert.equal(bins.length, 1);
  assert.equal(bins[0].clipCount, 1);
});

test('loadBins: clip di piu\' bin con bin e meta; bin mancanti segnalati; niente duplicati', async () => {
  const f = binsFake();
  const b = createBridge(f.resolve);
  const r = await b.loadBins(['Scena 1', 'Scena 1/Extra', 'Scena 1', 'Fantasma']);
  assert.deepEqual(r.missing, ['Fantasma']);
  assert.deepEqual(r.clips.map((c) => c.clipId), ['a1', 'b1', 'c1', 'x1']);
  const a = r.clips[0];
  assert.equal(a.bin, 'Scena 1');
  assert.deepEqual(a.meta, { scene: '1', shot: '2', take: '3', camera: 'A', angle: null });
  assert.equal(a.fps, 25);
  assert.equal(r.clips[3].bin, 'Extra');
  assert.equal(r.clips[3].meta.scene, null);
});

test('getClipMediaPath: File Path, codec, fps; assente => ok:false', async () => {
  const f = binsFake();
  const b = createBridge(f.resolve);
  assert.deepEqual(await b.getClipMediaPath('a1'), { ok: true, path: '/m/a1.mov', codec: 'ProRes 422', fps: 25 });
  assert.equal((await b.getClipMediaPath('b1')).ok, false);
  assert.equal((await b.getClipMediaPath('nope')).ok, false);
});

test('exportStill: ExportFrame ok, falso, eccezione, assente, file non creato', async () => {
  const mk = (mode) => makeFakeResolve({ items: [{ id: 'k', name: 'k', exportFrame: mode }] });
  const exists = (f) => (p) => f.clips[0].exported.includes(p);
  let f = mk('ok');
  let r = await createBridge(f.resolve, { fileExists: exists(f) }).exportStill('k', 12.4, '/tmp/s/');
  assert.deepEqual(r, { ok: true, via: 'exportFrame', path: '/tmp/s/still_k_12.png' });
  assert.deepEqual(f.clips[0].calls.at(-1), ['ExportFrame', 12, '/tmp/s/still_k_12.png']);
  for (const mode of ['false', 'throw', 'absent', 'nofile']) {
    f = mk(mode);
    r = await createBridge(f.resolve, { fileExists: exists(f) }).exportStill('k', 3, '/tmp/s');
    assert.equal(r.ok, false, mode);
    assert.equal(r.via, 'none', mode);
    assert.ok(r.reason, mode);
  }
  assert.equal((await createBridge(f.resolve).exportStill('nope', 1, '/d')).ok, false);
  assert.equal((await createBridge(f.resolve).exportStill('k', 1, '')).ok, false);
});

// ------------------------------------------------------------------ detectGroups
test('detectGroups: stesso Scene+Shot+Take', () => {
  const g = detectGroups([
    { id: 'T1', name: 'x1', meta: { scene: '1', shot: '2', take: '3', camera: 'A' } },
    { id: 'T2', name: 'x2', meta: { scene: '1', shot: '2', take: '3', camera: 'B' } },
    { id: 'T3', name: 'x3', meta: { scene: '1', shot: '2', take: '4', camera: 'A' } },
  ]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].ids, ['T1', 'T2']);
  assert.match(g[0].reason, /Scene 1, Shot 2, Take 3/);
  assert.deepEqual(g[0].angles, { T1: 'A', T2: 'B' });
});

test('detectGroups: suffissi camera nel nome file', () => {
  const g = detectGroups([
    { id: 'a', name: 'sc12_tk3_CAM_A.mov', meta: {} },
    { id: 'b', name: 'sc12_tk3_CAM_B.mov', meta: {} },
    { id: 'c', name: 'sc12_tk4_CAM_A.mov', meta: {} },
    { id: 'd', name: 'A001C002_x.mov', meta: {} },
    { id: 'e', name: 'B001C002_x.mov', meta: {} },
    { id: 'f', name: 'Clip 1.mov', meta: {} },
    { id: 'g', name: 'Clip 2.mov', meta: {} },
  ]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].ids, ['a', 'b']);
  assert.deepEqual(g[0].angles, { a: 'CAM A', b: 'CAM B' });
  assert.match(g[0].reason, /stesso prefisso/);
  assert.deepEqual(g[1].ids, ['d', 'e']);
  assert.equal(splitCameraName('Clip 1.mov'), null);
});

test('detectGroups: timecode sovrapposti (stesso fps, camere diverse), esclusi tc zero e stessa camera', () => {
  const c = (id, start, dur, cam) => ({ id, name: `n${id}`, fps: 25, startTcFrames: start, durationFrames: dur, meta: { camera: cam } });
  const g = detectGroups([c('a', 90000, 500, 'A'), c('b', 90050, 450, 'B'), c('c', 95000, 100, 'A'), c('z1', 0, 500, null), c('z2', 0, 500, null), c('s', 90000, 500, 'A')]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].ids, ['a', 'b']);
  assert.match(g[0].reason, /timecode/);
});

test('detectGroups: una clip gia\' raggruppata per metadati non rientra nelle altre euristiche', () => {
  const g = detectGroups([
    { id: 'a', name: 'p_CAM_A', fps: 25, startTcFrames: 100, durationFrames: 100, meta: { scene: '1', shot: '1', take: '1' } },
    { id: 'b', name: 'p_CAM_B', fps: 25, startTcFrames: 100, durationFrames: 100, meta: { scene: '1', shot: '1', take: '1' } },
  ]);
  assert.equal(g.length, 1);
  assert.match(g[0].reason, /metadati/);
});

// ------------------------------------------------------------------ executeAppendPlan
const planFake = () => makeFakeResolve({ items: [{ id: 'a', name: 'a', frames: 500 }, { id: 'b', name: 'b', frames: 500 }] });

test('executeAppendPlan: crea timeline, aggiunge livelli V2, passa trackIndex/recordFrame/mediaType', async () => {
  const f = planFake();
  const plan = [
    { clipId: 'a', startFrame: 0, endFrame: 50, trackIndex: 1, recordFrame: 1000, mediaType: 1 },
    { clipId: 'b', startFrame: 10, endFrame: 60, trackIndex: 2, recordFrame: 1000, mediaType: 1 },
    { clipId: 'a', startFrame: 0, endFrame: 50, trackIndex: 1, recordFrame: 1000, mediaType: 2 },
  ];
  const r = await createBridge(f.resolve).executeAppendPlan(plan, { timelineName: 'Regia' });
  assert.deepEqual(r, { ok: true, timelineName: 'Regia', itemsAdded: 3, tracksCreated: 1, skipped: [] });
  assert.equal(f.res.timelines[0].tracks.video, 2);
  assert.deepEqual(f.res.appended.flat(), [
    { id: 'a', startFrame: 0, endFrame: 50, trackIndex: 1, recordFrame: 1000, mediaType: 1 },
    { id: 'b', startFrame: 10, endFrame: 60, trackIndex: 2, recordFrame: 1000, mediaType: 1 },
    { id: 'a', startFrame: 0, endFrame: 50, trackIndex: 1, recordFrame: 1000, mediaType: 2 },
  ]);
});

test('executeAppendPlan: riusa la timeline esistente e withAudio:false scarta l\'audio', async () => {
  const f = planFake();
  const b = createBridge(f.resolve);
  const plan = [{ clipId: 'a', startFrame: 0, endFrame: 10, trackIndex: 1, mediaType: 1 }, { clipId: 'a', startFrame: 0, endFrame: 10, trackIndex: 1, mediaType: 2 }];
  await b.executeAppendPlan(plan, { timelineName: 'T' });
  const r = await b.executeAppendPlan(plan, { timelineName: 'T', withAudio: false });
  assert.equal(f.res.timelines.length, 1);
  assert.equal(r.itemsAdded, 1);
  assert.equal(r.tracksCreated, 0);
  assert.equal(f.res.timelines[0].items.length, 3);
});

test('executeAppendPlan: senza nome crea una timeline con suffisso se occupata', async () => {
  const f = planFake();
  const b = createBridge(f.resolve);
  const plan = [{ clipId: 'a', startFrame: 0, endFrame: 10 }];
  assert.equal((await b.executeAppendPlan(plan)).timelineName, 'ContinuityEdit');
  assert.equal((await b.executeAppendPlan(plan)).timelineName, 'ContinuityEdit 2');
});

test('executeAppendPlan: AddTrack non disponibile => voci su quel livello saltate con motivo', async () => {
  const f = planFake();
  const b = createBridge(f.resolve);
  await b.executeAppendPlan([{ clipId: 'a', startFrame: 0, endFrame: 10 }], { timelineName: 'T' });
  f.res.timelines[0].noAddTrack = true;
  const r = await b.executeAppendPlan([
    { clipId: 'a', startFrame: 0, endFrame: 10, trackIndex: 1 },
    { clipId: 'b', startFrame: 0, endFrame: 10, trackIndex: 3 },
  ], { timelineName: 'T' });
  assert.equal(r.ok, true);
  assert.equal(r.itemsAdded, 1);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].clipId, 'b');
  assert.match(r.skipped[0].reason, /V3.*AddTrack/);
});

test('executeAppendPlan: voci invalide, clip mancanti, append che fallisce', async () => {
  const f = planFake();
  const b = createBridge(f.resolve);
  assert.equal((await b.executeAppendPlan([])).ok, false);
  const r = await b.executeAppendPlan([
    { clipId: 'a', startFrame: 5, endFrame: 5 },
    { clipId: 'a', startFrame: 0, endFrame: 5, mediaType: 7 },
    { clipId: 'a', startFrame: 0, endFrame: 5, trackIndex: 0 },
    { clipId: 'zzz', startFrame: 0, endFrame: 5 },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.skipped.length, 4);
  f.res.failAppend = true;
  const r2 = await b.executeAppendPlan([{ clipId: 'a', startFrame: 0, endFrame: 5 }]);
  assert.equal(r2.ok, false);
  assert.equal(r2.itemsAdded, 0);
  assert.equal(r2.skipped.length, 1);
});

// ------------------------------------------------------------------ diagnostica
test('runDiagnostics: passi del contratto v2', async () => {
  const f = binsFake();
  f.mp.selected = [f.clips[0]];
  const exists = (p) => f.clips[0].exported.includes(p);
  const rep = await createBridge(f.resolve, { fileExists: exists, tmpDir: '/tmp/ce-diag' }).runDiagnostics();
  const by = Object.fromEntries(rep.steps.map((s) => [s.name, s]));
  for (const n of ['clipMetadata', 'exportFrame', 'binTree', 'addTrack', 'appendTrackRecordMediaType', 'createMulticamClip']) assert.ok(by[n], n);
  assert.equal(by.clipMetadata.detail.props.Scene, '1');
  assert.equal(by.exportFrame.ok, true);
  assert.equal(by.exportFrame.detail.fileOk, true);
  assert.equal(by.binTree.detail.count, 3);
  assert.equal(by.addTrack.ok, true);
  assert.equal(by.appendTrackRecordMediaType.ok, true);
  assert.equal(by.createMulticamClip.detail.exists, false);
  assert.equal(f.res.timelines.length, 0);
});

test('runDiagnostics: firme v2 che falliscono non lanciano', async () => {
  const f = binsFake();
  f.clips[0].exportFrame = 'throw';
  f.mp.selected = [f.clips[0]];
  const rep = await createBridge(f.resolve, { tmpDir: '/tmp/ce-diag' }).runDiagnostics();
  assert.equal(rep.steps.find((s) => s.name === 'exportFrame').ok, false);
  assert.equal(rep.ok, false);
});
