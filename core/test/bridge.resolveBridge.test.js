import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../src/bridge/resolveBridge.js';
import { makeFakeResolve, syntheticTranscript } from './helpers/fakeResolve.js';

const base = () => makeFakeResolve({
  items: [
    { id: 'c1', name: 'Clip A', fps: 25, frames: 500, startTc: '01:00:00:00' },
    { id: 'c2', name: 'Clip B', fps: 25, frames: 300, startTc: '00:00:10:00' },
  ],
});

test('getEnv', async () => {
  const f = base();
  const env = await createBridge(f.resolve).getEnv();
  assert.equal(env.product, 'DaVinci Resolve Studio');
  assert.equal(env.isStudio, true);
  assert.equal(env.projectName, 'Progetto di prova');
  assert.equal(env.pageName, 'edit');
});

test('getSelectedClips: legge proprieta e marker, fallback su cartella corrente', async () => {
  const f = base();
  await f.clips[0].AddMarker(10, 'Red', 'm', 'n', 1, 'x');
  const b = createBridge(f.resolve);
  // niente selezione -> GetSelectedClips() vuoto -> []
  assert.deepEqual(await b.getSelectedClips(), []);
  f.mp.selected = [f.clips[0], f.clips[1]];
  const clips = await b.getSelectedClips();
  assert.equal(clips.length, 2);
  assert.equal(clips[0].clipId, 'c1');
  assert.equal(clips[0].durationFrames, 500);
  assert.equal(clips[0].startTcFrames, 3600 * 25);
  assert.equal(clips[1].startTcFrames, 250);
  assert.deepEqual(clips[0].markers.map((m) => [m.frame, m.customData]), [[10, 'x']]);
  assert.equal(clips[0].transcribed, false);
});

test('durata da Duration quando Frames manca', async () => {
  const f = base();
  f.clips[0].GetClipProperty = async (k) => ({ FPS: '25', Duration: '00:00:20:00', 'Start TC': '00:00:00:00' }[k] ?? '');
  f.mp.selected = [f.clips[0]];
  const [c] = await createBridge(f.resolve).getSelectedClips();
  assert.equal(c.durationFrames, 500);
});

test('trascrizione: transcribe/status/getTranscription', async () => {
  const f = base();
  const b = createBridge(f.resolve);
  assert.deepEqual(await b.status(), { jobStatus: 'Inactive' });
  const r = await b.transcribe(['c1', 'zzz']);
  assert.deepEqual(r.started, ['c1']);
  assert.equal(r.failed[0].clipId, 'zzz');
  assert.deepEqual(await b.status(), { jobStatus: 'InProgress' });
  f.clips[0].transcribeStatus = 'Complete';
  f.clips[0].transcription = syntheticTranscript({ words: ['uno', 'due', 'tre'] });
  assert.deepEqual(await b.status(), { jobStatus: 'Complete' });
  const t = await b.getTranscription('c1');
  assert.equal(t.language, 'it');
  assert.equal(await b.getTranscription('c2'), null);
});

test('previewLine: seleziona e imposta mark in/out (fine esclusa -> out=end-1)', async () => {
  const f = base();
  const b = createBridge(f.resolve);
  assert.deepEqual(await b.previewLine('c1', 100, 150), { ok: true });
  assert.deepEqual(f.mp.setSelectedCalls, ['c1']);
  assert.deepEqual(f.clips[0].markInOut, { in: 100, out: 149, type: 'all' });
  assert.equal((await b.previewLine('nope', 1, 2)).ok, false);
});

test('previewLine: fallimenti -> {ok:false, reason}, mai eccezioni', async () => {
  const f = base();
  f.clips[0].failMarkInOut = true;
  const r = await createBridge(f.resolve).previewLine('c1', 1, 5);
  assert.equal(r.ok, false);
  assert.match(r.reason, /SetMarkInOut/);
  const g = base();
  g.mp.SetSelectedClip = undefined; // firma assente in questa versione di Resolve
  const r2 = await createBridge(g.resolve).previewLine('c1', 1, 5);
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /SetSelectedClip/);
});

test('assemble: timeline vuota + AppendToTimeline, nome duplicato -> suffisso', async () => {
  const f = base();
  const b = createBridge(f.resolve);
  const cuts = [
    { clipId: 'c1', startFrame: 10, endFrame: 60, lineIds: ['L1'] },
    { clipId: 'c2', startFrame: 0, endFrame: 20, lineIds: ['L2'] },
    { clipId: 'x', startFrame: 0, endFrame: 20, lineIds: ['L3'] },
  ];
  const r = await b.assemble(cuts, 'Montaggio');
  assert.equal(r.ok, true);
  assert.equal(r.itemsAdded, 2);
  assert.equal(r.timelineName, 'Montaggio');
  assert.deepEqual(r.skipped, [{ lineIds: ['L3'], reason: 'clip non trovata nel Media Pool' }]);
  assert.deepEqual(f.res.appended[0], [{ id: 'c1', startFrame: 10, endFrame: 60 }, { id: 'c2', startFrame: 0, endFrame: 20 }]);
  const r2 = await b.assemble(cuts.slice(0, 1), 'Montaggio');
  assert.equal(r2.timelineName, 'Montaggio 2');
  assert.equal((await b.assemble([{ clipId: 'x', startFrame: 0, endFrame: 5 }], 'M')).ok, false);
});

test('writeMarkers: customData ce:<line>:<edge>, sostituisce i marker ce: e conserva gli altri', async () => {
  const f = base();
  const b = createBridge(f.resolve);
  await f.clips[0].AddMarker(5, 'Blue', 'vecchio', '', 1, 'ce:L9:start');
  await f.clips[0].AddMarker(7, 'Red', 'utente', '', 1, '');
  const r = await b.writeMarkers('c1', [
    { frame: 20, color: 'Green', name: 'L1 start', customData: 'ce:L1:start' },
    { frame: 40, color: 'Red', name: 'L1 end', customData: 'ce:L1:end' },
  ]);
  assert.deepEqual([r.ok, r.count], [true, 2]);
  const mk = f.clips[0].markers;
  assert.equal(mk[5], undefined);
  assert.equal(mk[7].name, 'utente');
  assert.equal(mk[20].customData, 'ce:L1:start');
  assert.equal(mk[40].customData, 'ce:L1:end');
});

test('playheadSourceFrame: timeline -> frame sorgente', async () => {
  const f = base();
  const b = createBridge(f.resolve);
  assert.equal((await b.playheadSourceFrame('c1')).ok, false); // nessuna timeline
  await b.assemble([{ clipId: 'c1', startFrame: 100, endFrame: 200 }], 'T'); // item: timeline 90000..90100, src 100
  f.res.currentTimeline.tc = tcFrames(90030);
  assert.deepEqual(await b.playheadSourceFrame('c1'), { ok: true, frame: 130 });
  f.res.currentTimeline.tc = tcFrames(95000);
  assert.equal((await b.playheadSourceFrame('c1')).ok, false);
  f.res.currentTimeline.noTc = true;
  const r = await b.playheadSourceFrame('c1');
  assert.equal(r.ok, false);
  assert.match(r.reason, /GetCurrentTimecode/);
});

function tcFrames(n, fps = 25) {
  const p = (v) => String(v).padStart(2, '0');
  const s = Math.floor(n / fps);
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(n % fps)}`;
}

test('runDiagnostics: copre le firme incerte e ripulisce', async () => {
  const f = base();
  f.mp.selected = [f.clips[0]];
  const rep = await createBridge(f.resolve).runDiagnostics();
  const names = rep.steps.map((s) => s.name);
  for (const n of ['getEnv', 'getSelectedClips', 'markers', 'setSelectedClip', 'setMarkInOut', 'currentTimecode', 'timelineTemporanea']) {
    assert.ok(names.includes(n), n);
  }
  assert.equal(rep.steps.find((s) => s.name === 'timelineTemporanea').detail.deleted, true);
  assert.deepEqual(f.clips[0].markers, {});
  assert.equal(f.clips[0].markInOut, null);
  assert.equal(f.res.timelines.length, 0);
});

test('runDiagnostics: non lancia se le firme falliscono', async () => {
  const f = base();
  f.mp.selected = [f.clips[0]];
  f.clips[0].failMarkInOut = true;
  const rep = await createBridge(f.resolve).runDiagnostics();
  assert.equal(rep.ok, false);
  assert.equal(rep.steps.find((s) => s.name === 'setMarkInOut').ok, false);
});

test('bridge lazy: il getter e\' chiamato una volta sola', async () => {
  const f = base();
  let n = 0;
  const b = createBridge(async () => { n++; return f.resolve; }, { lazy: true });
  await b.getEnv(); await b.getEnv();
  assert.equal(n, 1);
});
