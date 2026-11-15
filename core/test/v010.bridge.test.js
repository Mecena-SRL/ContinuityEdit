// v0.1.0: bridge e handler contro un finto Resolve con le firme reali (probe 21.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as sync from '../src/sync/index.js';
import { parseResolveTranscript } from '../src/transcript/parse.js';
import { alignClip } from '../src/align/index.js';
import { parseFdx, parsePdf, applyScriptEdit, diffRevision, applyRevision, scriptFromTranscripts } from '../src/script/index.js';
import { searchTranscripts } from '../src/search/phrase.js';
import * as sequence from '../src/sequence/index.js';
import * as board from '../src/board/index.js';
import { createBridge } from '../src/bridge/resolveBridge.js';
import { makeFakeResolve, syntheticTranscript, fakeTc } from './helpers/fakeResolve.js';

const require = createRequire(import.meta.url);
const { createHandlers } = require('../../plugin/main/handlers.js');
const { createState } = require('../../plugin/main/state.js');
const { createPersist } = require('../../plugin/main/persist.js');

const two = () => makeFakeResolve({
  items: [
    { id: 'c1', name: 'A', frames: 1000, transcription: syntheticTranscript({ words: 'non tornera piu da questa casa'.split(' '), startSec: 2 }) },
    { id: 'c2', name: 'B', frames: 800 },
  ],
});

// ---------------------------------------------------------------- bridge
test('status: tolleranza dopo l\'avvio, poi le clip non segnate si considerano concluse', async () => {
  const f = two();
  let now = 1000;
  const b = createBridge(f.resolve, { clock: () => now });
  await b.transcribe(['c2']);
  f.clips[1].transcribeStatus = 'Inactive'; // il job non e' ancora partito
  assert.equal((await b.status()).jobStatus, 'InProgress');
  now += 20000;
  const st = await b.status();
  assert.deepEqual([st.jobStatus, st.pending], ['Complete', ['c2']]);
  f.clips[1].noAudio = true;
  const r = await b.transcribe(['c2']);
  assert.match(r.failed[0].reason, /audio/);
});

test('clipInfo: "Transcription Status" evita GetTranscription sui bin', async () => {
  const f = two();
  let calls = 0;
  const orig = f.clips[0].GetTranscription.bind(f.clips[0]);
  f.clips[0].GetTranscription = async () => { calls++; return orig(); };
  f.mp.selected = [f.clips[0], f.clips[1]];
  const list = await createBridge(f.resolve).getSelectedClips();
  assert.deepEqual(list.map((c) => [c.transcribed, c.transcriptionStatus]), [[true, 'Transcribed'], [false, '']]);
  assert.equal(calls, 0);
});

test('findItem: indice in memoria, riindicizza se la clip sparisce', async () => {
  const f = two();
  const b = createBridge(f.resolve);
  let walks = 0;
  const root = f.res.root;
  const orig = root.GetSubFolderList.bind(root);
  root.GetSubFolderList = async () => { walks++; return orig(); };
  await b.getClip('c1'); await b.getClip('c2'); await b.getClip('c1');
  assert.equal(walks, 1);
  f.clips[0].GetUniqueId = async () => { throw new Error('oggetto non valido'); };
  assert.equal(await b.getClip('c1'), null);
});

test('writeMarkers non tocca gli still ne\' i marker di riga', async () => {
  const f = two();
  const b = createBridge(f.resolve);
  await f.clips[0].AddMarker(3, 'Cyan', 'Still', '', 1, 'ce:still:B1');
  await f.clips[0].AddMarker(4, 'Blue', 'vecchio', '', 1, 'ce:L0002:start');
  await b.writeMarkers('c1', [{ frame: 10, customData: 'ce:L0003:end' }]);
  assert.deepEqual(Object.keys(f.clips[0].markers).sort(), ['10', '3']);
});

test('executeAppendPlan: accoda dopo il contenuto, marker di riga relativi alla timeline, ripiego se il collegato fallisce', async () => {
  const f = two();
  const b = createBridge(f.resolve);
  const plan = [
    { clipId: 'c1', startFrame: 0, endFrame: 100, trackIndex: 1, recordFrame: 0, mediaType: 1 },
    { clipId: 'c1', startFrame: 0, endFrame: 100, trackIndex: 1, recordFrame: 0, mediaType: 2 },
  ];
  const r1 = await b.executeAppendPlan(plan, { timelineName: 'T', markers: [{ recordFrame: 10, name: 'riga', customData: 'ce:line:L1' }] });
  assert.equal(r1.baseFrame, 90000);
  assert.deepEqual(f.res.timelines[0].markers, { 10: { color: 'Blue', name: 'riga', note: '', duration: 1, customData: 'ce:line:L1' } });
  f.res.failLinked = true;
  const r2 = await b.executeAppendPlan(plan, { mode: 'append', markers: [{ recordFrame: 0, customData: 'ce:line:L2' }] });
  assert.equal(r2.timelineName, 'T');
  assert.equal(r2.baseFrame, 90100);
  assert.equal(r2.itemsAdded, 2); // video e audio separati
  assert.equal(f.res.timelines[0].markers[100].customData, 'ce:line:L2');
  f.res.currentTimeline = null;
  assert.match((await b.executeAppendPlan(plan, { mode: 'append' })).reason, /nessuna timeline/);
});

test('timelineUsage / timelinePlayhead / seekTimeline', async () => {
  const f = two();
  const b = createBridge(f.resolve);
  assert.equal((await b.timelineUsage()).ok, false);
  await b.executeAppendPlan([{ clipId: 'c1', startFrame: 200, endFrame: 300, recordFrame: 0, mediaType: 1 }, { clipId: 'c2', startFrame: 0, endFrame: 50, trackIndex: 2, recordFrame: 20, mediaType: 1 }], { timelineName: 'T' });
  const u = await b.timelineUsage();
  assert.deepEqual(u.items.map((i) => [i.clipId, i.track, i.start, i.srcStart, i.srcEnd]), [['c1', 1, 90000, 200, 300], ['c2', 2, 90020, 0, 50]]);
  const tl = f.res.timelines[0];
  tl.tc = fakeTc(90010, 25);
  assert.deepEqual(await b.timelinePlayhead(), { ok: true, timecode: '01:00:00:10', frame: 90010, clipId: 'c1', srcFrame: 210 });
  tl.tc = fakeTc(90030, 25);
  assert.equal((await b.timelinePlayhead()).clipId, 'c2'); // traccia piu' alta vince
  const s = await b.seekTimeline('c1', 250);
  assert.deepEqual(s, { ok: true, timecode: '01:00:02:00' });
  assert.equal(tl.tc, '01:00:02:00');
  assert.equal((await b.seekTimeline('c1', 900)).ok, false);
});

test('writeClipMeta: parole chiave CE sostituite senza toccare le altre; colore solo se libero; flag aggiunto', async () => {
  const f = two();
  f.clips[0].metadata.Keywords = 'esterno, CE Scarto';
  f.clips[1].clipColor = 'Purple';
  const b = createBridge(f.resolve);
  const r = await b.writeClipMeta('c1', { keywords: ['Buono', 'B+'], clipColor: 'Green', flag: 'Green' });
  assert.equal(r.ok, true);
  assert.equal(f.clips[0].metadata.Keywords, 'esterno, CE Buono, CE B+');
  assert.deepEqual([f.clips[0].clipColor, f.clips[0].flags], ['Green', ['Green']]);
  const r2 = await b.writeClipMeta('c2', { clipColor: 'Green' });
  assert.equal(r2.ok, false);
  assert.match(r2.skipped.clipColor, /Purple/);
  assert.equal(f.clips[1].clipColor, 'Purple');
});

test('runDiagnostics: prove nuove (SetCurrentTimecode, metadati con ripristino, recordFrame assoluto)', async () => {
  const f = two();
  f.mp.selected = [f.clips[0]];
  f.clips[0].metadata.Keywords = 'mio';
  const b = createBridge(f.resolve);
  await b.executeAppendPlan([{ clipId: 'c1', startFrame: 0, endFrame: 10 }], { timelineName: 'Lavoro' });
  const rep = await b.runDiagnostics();
  const st = (n) => rep.steps.find((s) => s.name === n);
  for (const n of ['setCurrentTimecode', 'timelineUsage', 'timelinePlayhead', 'writeMetadataRoundTrip', 'appendLinkedAV', 'timelineMarker', 'subtitleSupport']) assert.ok(st(n), n);
  assert.equal(st('appendTrackRecordMediaType').detail.placedAt, 90050);
  assert.equal(f.clips[0].metadata.Keywords, 'mio'); // ripristinato
  assert.equal(f.clips[0].clipColor, '');
  assert.deepEqual(f.clips[0].flags, []);
  assert.equal(f.res.timelines.length, 1); // timeline di prova eliminata
  assert.equal(f.res.currentTimeline.name, 'Lavoro'); // timeline dell'utente di nuovo corrente
  assert.deepEqual(rep.failed, rep.steps.filter((s) => !s.ok).map((s) => s.name));
});

// ---------------------------------------------------------------- handler
const FDX = `<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="1"><Content>
<Paragraph Type="Scene Heading"><Text>INT. CUCINA - GIORNO</Text></Paragraph>
<Paragraph Type="Action"><Text>Marta entra.</Text></Paragraph>
<Paragraph Type="Character"><Text>MARTA</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>Non tornera piu da questa casa</Text></Paragraph>
</Content></FinalDraft>`;

async function setup(f = two()) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ce-v010-'));
  const state = createState(sync, sequence);
  const events = [];
  const saved = {};
  const h = createHandlers({
    core: { sync, parseResolveTranscript, alignClip, parseFdx, parsePdf, applyScriptEdit, diffRevision, applyRevision, scriptFromTranscripts, searchTranscripts, sequence, board },
    bridge: createBridge(f.resolve), state, persist: createPersist({ dir }),
    notify: (s) => events.push(s),
    readFile: async () => Buffer.from(FDX),
    writeFile: async () => {},
    showSaveDialog: async ({ suggestedName }) => `/out/${suggestedName}`,
    writeBinary: async (p, buf) => { saved[p] = Buffer.from(buf).toString('utf8'); },
  });
  return { h, f, state, events, saved, dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('checkProject: cambio di progetto in Resolve -> salva il vecchio, carica il sidecar del nuovo', async () => {
  const t = await setup();
  assert.equal((await t.h.checkProject()).changed, false); // primo aggancio
  await t.h.loadScript('/s.fdx');
  await t.h.addTake({ clipId: 'c1' });
  t.f.project.name = 'Altro progetto'; t.f.project.id = 'P2';
  const r = await t.h.checkProject();
  assert.deepEqual([r.changed, r.loaded], [true, false]);
  assert.equal(t.state.project, null);
  t.f.project.name = 'Progetto di prova'; t.f.project.id = 'P1';
  const r2 = await t.h.checkProject();
  assert.deepEqual([r2.changed, r2.loaded], [true, true]);
  assert.equal(t.state.project.takes.length, 1);
  await t.cleanup();
});

test('ricerca nel parlato, trascrizione per il lettore, modalita\' documentario', async () => {
  const t = await setup();
  await t.h.addTake({ clipId: 'c1' });
  await t.h.addTake({ clipId: 'c2' });
  const s = await t.h.searchSpeech({ query: 'questa casa' });
  assert.deepEqual([s.searched, s.untranscribed, s.hits.length, s.hits[0].takeId], [1, 1, 1, 'T1']);
  const tr = await t.h.getTranscript({ takeId: 'T1' });
  assert.equal(tr.words.length, 6);
  assert.equal((await t.h.getTranscript({ takeId: 'T2' })).ok, false);
  const d = await t.h.scriptFromTranscripts();
  assert.deepEqual([d.takes, d.missing], [1, ['T2']]);
  assert.equal(t.state.project.scriptDoc.source, 'trascrizione');
  const v = t.state.view();
  assert.equal(v.coverage.T1.length, 1); // ancore esatte gia' pronte
  const s2 = await t.h.searchSpeech({ query: 'tornera' });
  assert.equal(s2.hits[0].lineId, 'L0002');
  await t.cleanup();
});

test('timelineUsage: righe gia\' montate (stile Avid) e timelinePlayhead -> riga', async () => {
  const t = await setup();
  await t.h.loadScript('/s.fdx');
  await t.h.addTake({ clipId: 'c1' });
  await t.h.autoSync('T1');
  const dl = t.state.project.scriptDoc.lines.find((l) => l.type === 'dialogue');
  const cov = t.state.view().coverage.T1.find((c) => c.lineId === dl.id);
  await t.h['sequence.setMaster']({ takeId: 'T1', lineIds: [dl.id] });
  const r = await t.h['sequence.assemble']({ timelineName: 'Montaggio' });
  assert.equal(r.ok, true);
  const u = await t.h.timelineUsage();
  assert.deepEqual(u.usedLines, { [dl.id]: ['T1'] });
  assert.deepEqual(u.usedTakes, { T1: 1 });
  t.f.res.currentTimeline.tc = fakeTc(90000 + 3, 25);
  const ph = await t.h.timelinePlayhead();
  assert.deepEqual([ph.takeId, ph.lineId, ph.frame], ['T1', dl.id, cov.startFrame + 3]);
  const sk = await t.h.seekTimeline({ takeId: 'T1', lineId: dl.id });
  assert.equal(sk.ok, true);
  await t.cleanup();
});

test('editor via handler: place/split/move/trimEdge con undo; sottotitoli SRT; writeToResolve', async () => {
  const t = await setup();
  await t.h.loadScript('/s.fdx');
  await t.h.addTake({ clipId: 'c1' });
  await t.h.addTake({ clipId: 'c2' });
  await t.h.autoSync('T1');
  const { itemId } = await t.h['sequence.place']({ takeId: 'T1', startFrame: 0, endFrame: 250, track: 1, recordFrame: 0 });
  const sp = await t.h['sequence.split'](itemId, 100);
  await t.h['sequence.place']({ takeId: 'T2', startFrame: 0, endFrame: 40, track: 2, recordFrame: 20 });
  await t.h['sequence.move'](sp.rightId, { recordFrame: 0, track: 1 });
  await t.h['sequence.trimEdge'](sp.leftId, 'end', -10);
  assert.deepEqual(t.state.view().sequence.items.map((x) => [x.track, x.rec, x.len]), [[1, 0, 150], [1, 150, 90], [2, 20, 40]]);
  await t.h.undo();
  assert.equal(t.state.view().sequence.items.find((x) => x.id === sp.leftId).len, 100);
  const srt = await t.h['sequence.subtitles']({ save: true });
  assert.equal(srt.cues, 1);
  assert.match(srt.srt, /^1\n00:00:\d\d,\d{3} --> 00:00:\d\d,\d{3}\nNon tornera piu da questa casa\n/);
  assert.ok(t.saved['/out/Sequenza 1.srt']);
  await t.h.setMark({ takeId: 'T1', rating: 'buono', grade: 'B+' });
  const w = await t.h.writeToResolve({ takeIds: ['T1'], keywords: true, clipColor: true });
  assert.equal(w.ok, true);
  assert.equal(t.f.clips[0].metadata.Keywords, 'CE Buono, CE B+');
  assert.equal(t.f.clips[0].clipColor, 'Green');
  await t.cleanup();
});

test('revisione dello script via handler: undo riporta lo script precedente', async () => {
  const t = await setup();
  await t.h.loadScript('/s.fdx');
  await t.h.addTake({ clipId: 'c1' });
  await t.h.autoSync('T1');
  const n = t.state.project.anchors.length;
  const r = await t.h.loadScript('/s.fdx');
  assert.deepEqual([r.revision.uguali, r.revision.tolte, r.revision.anchorsKept], [4, 0, n]);
  const saved = JSON.parse(await readFile(path.join(t.dir, 'Progetto di prova.ce.json'), 'utf8'));
  assert.equal(saved.anchors.length, n);
  await t.cleanup();
});
