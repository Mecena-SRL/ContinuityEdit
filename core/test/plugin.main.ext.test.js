import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
const { createMediaRegistry } = require('../../plugin/main/protocol.js');
const { createPersist } = require('../../plugin/main/persist.js');

const FDX = `<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="1"><Content>
<Paragraph Type="Scene Heading"><Text>INT. CUCINA - GIORNO</Text></Paragraph>
<Paragraph Type="Character"><Text>MARTA</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>Non tornera piu da questa casa</Text></Paragraph>
</Content></FinalDraft>`;

const props = (cam, extra = {}) => ({ props: { Scene: '1', Shot: '2', Take: '3', 'Camera #': cam, ...extra } });

async function setup({ withScript = true, persist } = {}) {
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
    core: { sync, parseResolveTranscript, alignClip, parseFdx, parsePdf, applyScriptEdit, sequence, board },
    bridge: createBridge(f.resolve, { fileExists: (p) => exported().includes(p) }), state,
    notify: (s) => events.push(s), media, persist,
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
  await assert.rejects(() => h.setTakeGroup('TX', 'G1', null), /take sconosciuto/i);
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
  assert.deepEqual(r, { ok: true, itemId: 'B1', markerWritten: true });
  assert.deepEqual(f.clips[0].markers[499], { color: 'Cyan', name: 'Still', note: '', duration: 1, customData: 'ce:still:B1' });
  assert.equal(state.project.board.items[0].frame, 499);
  assert.equal(events.length, n + 1);
  // frame con marker gia' presente: lo still esiste ma markerWritten false
  const r2 = await h['board.addStill']({ takeId: 'T1', frame: 499 });
  assert.equal(r2.itemId, 'B2');
  assert.equal(r2.markerWritten, false);
  assert.ok(r2.reason);
  const rm = await h['board.removeItem']('B1');
  assert.equal(rm.markerRemoved, true);
  assert.deepEqual(f.clips[0].markers, {});
  assert.deepEqual(state.project.board.items.map((i) => i.id), ['B2']);
  await assert.rejects(() => h['board.removeItem']('S9'), /sconosciuto/);
  await assert.rejects(() => h['board.addStill']({ takeId: 'T1' }), /Frame/);
});

test('board.removeItem: senza DeleteMarkerByCustomData ripiega sulla ricerca per customData', async () => {
  const { h, f } = await setup();
  await h.loadBins(['Scena 1']);
  f.clips[0].noDeleteByCustomData = true;
  await h['board.addStill']({ takeId: 'T1', frame: 10 });
  assert.equal((await h['board.removeItem']('B1')).markerRemoved, true);
  assert.deepEqual(f.clips[0].markers, {});
});

test('board.refreshStillViaResolve: ExportFrame esplicito, imagePath sull\'item; fallimento => via none', async () => {
  const { h, state, f, mkdirs } = await setup();
  await h.loadBins(['Scena 1']);
  await h['board.addStill']({ takeId: 'T1', frame: 12 });
  const r = await h['board.refreshStillViaResolve']('B1');
  assert.deepEqual(r, { ok: true, via: 'exportFrame', path: '/stills/proj/still_a1_12.png' });
  assert.equal(state.project.board.items[0].imagePath, r.path);
  assert.deepEqual(mkdirs, ['/stills/proj']);
  f.clips[1].exportFrame = 'false';
  await h['board.addStill']({ takeId: 'T2', frame: 5 });
  const bad = await h['board.refreshStillViaResolve']('B2');
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
  await assert.rejects(() => h['sequence.assemble']({ timelineName: 'x' }), /Sequenza vuota/);
  await assert.rejects(() => h['sequence.assemble']({ plan: [] }), /Piano/);
});

test('sequence.assemble funziona anche senza script caricato (piano esplicito)', async () => {
  const { h } = await setup({ withScript: false });
  const r = await h['sequence.assemble']({ plan: [{ clipId: 'a1', startFrame: 0, endFrame: 10 }] });
  assert.equal(r.ok, true);
});

// ------------------------------------------------------------------ contratto v2 completo (core-ext)
async function setupAligned() {
  const t = await setup();
  await t.h.loadBins(['Scena 1']);
  const ids = t.state.project.scriptDoc.lines.map((l) => l.id);
  return { ...t, ids };
}

test('editScript + undo/redo: modifica lo spoglio, emette, annulla e ripete', async () => {
  const t = await setupAligned();
  const dlg = t.state.project.scriptDoc.lines.find((l) => l.type === 'dialogue');
  const n = t.events.length;
  const snap = await t.h.editScript({ op: 'setType', lineId: dlg.id, type: 'action' });
  assert.equal(snap.view.lines.find((l) => l.id === dlg.id).type, 'action');
  assert.equal(t.events.length, n + 1);
  const back = await t.h.undo();
  assert.equal(back.view.lines.find((l) => l.id === dlg.id).type, 'dialogue');
  const fwd = await t.h.redo();
  assert.equal(fwd.view.lines.find((l) => l.id === dlg.id).type, 'action');
  assert.equal(t.state.project.takes.length, 2);
  await t.h.undo(); // spoglio
  await t.h.undo(); // loadBins
  assert.equal(t.state.project.takes.length, 0);
  const same = await t.h.undo(); // niente da annullare: invariato
  assert.equal(same.view.takes.length, 0);
});

test('mutazione che lancia: progetto intatto e nessun passo di cronologia', async () => {
  const t = await setupAligned();
  const before = JSON.stringify(t.state.project);
  await assert.rejects(() => t.h.editScript({ op: 'boh' }), /sconosciuta/);
  await assert.rejects(() => t.h.setMark({ takeId: 'T1', lineId: 'LXX', rating: 'buono' }), /sconosciuta/);
  assert.equal(JSON.stringify(t.state.project), before);
  await t.h.undo(); // annulla loadBins, non una mutazione fallita
  assert.equal(t.state.project.takes.length, 0);
});

test('setMark + setGradePalette col modello ufficiale', async () => {
  const t = await setupAligned();
  await t.h.setMark({ takeId: 'T1', rating: 'buono', grade: 'B+' });
  await t.h.setMark({ takeId: 'T1', lineId: t.ids[2], tags: ['ok'], note: 'bella' });
  assert.equal(t.state.project.takes[0].rating, 'buono');
  assert.equal(t.state.project.marks[`T1|${t.ids[2]}`].note, 'bella');
  await t.h.setGradePalette(['A', 'B']);
  assert.deepEqual(t.state.project.gradePalette, ['A', 'B']);
  await assert.rejects(() => t.h.setGradePalette('x'), /stringhe/);
});

test('sidecar: ogni mutazione v2 viene salvata (version 2)', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ce-ext-'));
  const t = await setup({ persist: createPersist({ dir }) });
  await t.h.loadBins(['Scena 1']);
  await t.h.setMark({ takeId: 'T1', rating: 'scarto' });
  const saved = JSON.parse(await readFile(path.join(dir, 'Progetto di prova.ce.json'), 'utf8'));
  assert.equal(saved.version, 2);
  assert.equal(saved.takes[0].rating, 'scarto');
  await rm(dir, { recursive: true, force: true });
});

test('sequence: setMaster + addCutaway + trimCutaway + assemble da sequenza (V1 master, V2 cutaway)', async () => {
  const t = await setupAligned();
  const [lA, lB] = t.state.project.scriptDoc.lines.filter((l) => l.type !== 'scene');
  const anchor = async (takeId, lineId, s, e) => {
    await t.h.addAnchor({ takeId, lineId, edge: 'start', frame: s });
    await t.h.addAnchor({ takeId, lineId, edge: 'end', frame: e });
  };
  await anchor('T1', lA.id, 10, 110);
  await anchor('T2', lA.id, 12, 112);
  const m = await t.h['sequence.setMaster']({ takeId: 'T1', lineIds: [lA.id] });
  assert.equal(m.role, 'master');
  assert.deepEqual([m.startFrame, m.endFrame], [10, 110]);
  const c = await t.h['sequence.addCutaway']({ takeId: 'T2', fromLineId: lA.id, startOffsetFrames: 5 });
  assert.equal(c.track, 2);
  assert.equal(c.startFrame, 17);
  const c2 = await t.h['sequence.trimCutaway'](c.id, { endOffsetFrames: -20 });
  assert.equal(c2.endFrame, 92);
  await assert.rejects(() => t.h['sequence.addCutaway']({ takeId: 'T2', fromLineId: lB.id }), /non copre/);
  const r = await t.h['sequence.assemble']({ timelineName: 'Regia', withAudio: true });
  assert.equal(r.ok, true);
  assert.equal(r.tracksCreated, 1);
  assert.equal(r.itemsAdded, 3); // master V1 + audio master + cutaway V2
  const calls = t.f.res.appended.flat();
  assert.deepEqual(calls.map((x) => [x.id, x.trackIndex, x.mediaType]), [['a1', 1, 1], ['a1', 1, 2], ['b1', 2, 1]]);
  assert.equal(calls[2].recordFrame, 5);
  assert.equal(await t.h['sequence.removeItem'](c.id), true);
  assert.equal(t.state.project.sequence.items.length, 1);
});

test('sequence.fromLines, addItem/moveItem/trimItem e assemble', async () => {
  const t = await setupAligned();
  const lA = t.state.project.scriptDoc.lines.find((l) => l.type !== 'scene');
  await t.h.addAnchor({ takeId: 'T1', lineId: lA.id, edge: 'start', frame: 0 });
  await t.h.addAnchor({ takeId: 'T1', lineId: lA.id, edge: 'end', frame: 50 });
  const r = await t.h['sequence.fromLines']([lA.id]);
  assert.equal(r.itemCount, 1);
  const it = t.state.project.sequence.items[0];
  const tr = await t.h['sequence.trimItem'](it.id, { endFrame: 40 });
  assert.equal(tr.endFrame, 40);
  const added = await t.h['sequence.addItem']({ takeId: 'T2', startFrame: 0, endFrame: 20, role: 'angle', track: 2, recordFrame: 3 });
  await t.h['sequence.moveItem'](added.id, { track: 3 });
  const a = await t.h['sequence.assemble']({ timelineName: 'X' });
  assert.equal(a.ok, true);
  assert.equal(a.tracksCreated, 2);
  await assert.rejects(() => t.h['sequence.fromLines']([]), /Nessuna riga/);
});

test('board.*: still con marker, note, move/resize/caption/link/removeItem, toSequence', async () => {
  const t = await setupAligned();
  const s1 = await t.h['board.addStill']({ takeId: 'T1', frame: 100 });
  const s2 = await t.h['board.addStill']({ takeId: 'T2', frame: 200 });
  assert.deepEqual([s1.itemId, s2.itemId, s1.markerWritten], ['B1', 'B2', true]);
  assert.equal(t.f.clips[0].markers[100].customData, 'ce:still:B1');
  const note = await t.h['board.addItem']({ type: 'note', caption: 'idea' });
  assert.equal(note.itemId, 'B3');
  await assert.rejects(() => t.h['board.addItem']({ type: 'still' }), /board.addStill/);
  await t.h['board.moveItem']('B2', { x: -500 });
  await t.h['board.resizeItem']('B1', { w: 300, h: 200 });
  await t.h['board.setCaption']('B1', 'primo');
  await t.h['board.bringToFront']('B1');
  await t.h['board.link']('B1', 'B3');
  const b = t.state.project.board;
  assert.equal(b.items.find((i) => i.id === 'B1').caption, 'primo');
  assert.equal(b.links.length, 1);
  const seq = await t.h['board.toSequence']({ order: 'x', holdFrames: 30 });
  assert.equal(seq.items, 2);
  assert.deepEqual(t.state.project.sequence.items.map((i) => i.takeId), ['T2', 'T1']);
  await t.h['board.removeItem']('B3');
  assert.equal(t.state.project.board.links.length, 0);
  await assert.rejects(() => t.h['board.moveItem']('B99', { x: 1 }), /sconosciuto/);
});
