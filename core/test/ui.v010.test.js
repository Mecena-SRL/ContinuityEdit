// v0.1.0: viewmodel puri del renderer (assistente, lettore, editor, messaggi) e coerenza del contratto window.ce.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { summarize, nextStep } from '../../plugin/renderer/viewmodel/assistant.js';
import { frameAt, timeOfFrame, rateAfterKey, wordIndexAt, coverageAt, karaoke, markRange, sequenceAt, nextBoundary, mediaErrorText, splitWords } from '../../plugin/renderer/viewmodel/player.js';
import { fitZoom, zoomStep, rulerTicks, snapTargets, snapFrame, trackFromY, laneCount, hitItem, shortTc } from '../../plugin/renderer/viewmodel/editor.js';
import { cleanError, remedyFor, SHORTCUTS } from '../../plugin/renderer/viewmodel/messages.js';
import { makeFakeResolve } from './helpers/fakeResolve.js';
import { createBridge } from '../src/bridge/resolveBridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---------------------------------------------------------------- assistente
const view = (o = {}) => ({ takes: [], lines: [], coverage: {}, ...o });
const L = (id, type) => ({ id, type, syncable: type === 'dialogue' || type === 'action' });

test('assistente: un passo alla volta, nell\'ordine del flusso', () => {
  const lines = [L('L1', 'scene'), L('L2', 'action'), L('L3', 'dialogue')];
  const takes = [{ id: 'T1', clipId: 'C1' }, { id: 'T2', clipId: 'C2' }];
  const step = (v, extra = {}, opts) => nextStep(summarize({ view: v, ...extra }), opts);
  assert.equal(step(view()).id, 'bins');
  assert.equal(step(view({ takes })).id, 'script');
  assert.equal(step(view({ takes, lines }), { clips: { C1: { transcribed: false }, C2: { transcribed: true } } }).id, 'sync');
  assert.equal(step(view({ takes, lines }), { transcribing: new Set(['C1']) }).id, 'transcribe');
  const cov = { T2: [{ lineId: 'L3' }] };
  const s = summarize({ view: view({ takes, lines, coverage: cov }), clips: { C1: { transcribed: true }, C2: { transcribed: true } }, aligned: new Set(['T1']) });
  assert.deepEqual([s.covered, s.syncable, s.uncoveredActions], [1, 2, 1]);
  assert.equal(nextStep(s).id, 'mute'); // T1 gia' allineato senza risultati: non si ripropone
  assert.equal(nextStep(s, { skipped: new Set(['mute']) }).id, 'cut');
  const done = summarize({ view: view({ takes, lines, coverage: { T1: [{ lineId: 'L2' }, { lineId: 'L3' }] } }), project: { sequence: { items: [{}] } }, clips: { C1: { transcribed: true }, C2: { transcribed: true } }, aligned: new Set(['T2']) });
  assert.equal(nextStep(done).id, 'send');
  assert.equal(nextStep({ ...done, sent: true }).id, 'done');
  // script muto: nessuna battuta -> non chiede di trascrivere
  const mute = summarize({ view: view({ takes, lines: [L('L1', 'action')] }), clips: { C1: { transcribed: false }, C2: { transcribed: false } } });
  assert.equal(nextStep(mute).id, 'mute');
  // ogni passo ha un'azione principale e una fase
  for (const st of [step(view()), step(view({ takes })), nextStep(done)]) { assert.ok(st.action.id && st.action.label); assert.ok(st.phase >= 0 && st.phase < st.phases.length); }
});

// ---------------------------------------------------------------- lettore
test('lettore: frame/tempo, JKL, parola corrente, copertura al frame', () => {
  assert.equal(frameAt(timeOfFrame(123, 25), 25), 123);
  assert.equal(frameAt(0, 25), 0);
  assert.deepEqual(['l', 'l', 'l', 'l', 'l'].reduce((r, k) => [...r, rateAfterKey(r[r.length - 1], k)], [0]).slice(1), [1, 2, 4, 8, 8]);
  assert.equal(rateAfterKey(4, 'j'), -1);
  assert.equal(rateAfterKey(-1, 'j'), -2);
  assert.equal(rateAfterKey(2, 'k'), 0);
  const words = [{ startFrame: 0, endFrame: 5 }, { startFrame: 10, endFrame: 15 }, { startFrame: 20, endFrame: 25 }];
  assert.deepEqual([-1, 0, 9, 10, 99].map((f) => wordIndexAt(words, f)), [-1, 0, 0, 1, 2]);
  const cov = [{ lineId: 'A', startFrame: 0, endFrame: 50 }, { lineId: 'B', startFrame: 40, endFrame: 90 }];
  assert.equal(coverageAt(cov, 45).lineId, 'B');
  assert.equal(coverageAt(cov, 95), null);
});

test('karaoke: parole dette secondo i tempi trascritti, o in proporzione al tempo se la riga e\' muta', () => {
  const text = 'Il treno parte alle sette';
  const c = { startFrame: 100, endFrame: 200 };
  const words = [100, 110, 120, 130].map((s) => ({ startFrame: s, endFrame: s + 8 }));
  assert.deepEqual(karaoke(text, c, words, 99), { spoken: 0, total: 5, fraction: 0 });
  assert.equal(karaoke(text, c, words, 115).spoken, 3); // 2 parole su 4 -> 2.5 -> 3 su 5
  assert.equal(karaoke(text, c, [], 150).spoken, 3); // muta: meta' del tempo
  assert.equal(karaoke(text, c, words, 250).spoken, 5);
  assert.deepEqual(splitWords('a  b'), ['a', '  ', 'b']);
});

test('In/Out: ordinati e dentro la clip', () => {
  assert.equal(markRange(null, null, 100), null);
  assert.deepEqual(markRange(10, 50, 100), { startFrame: 10, endFrame: 50 });
  assert.deepEqual(markRange(60, 20, 100), { startFrame: 19, endFrame: 61 });
  assert.deepEqual(markRange(10, null, 100), { startFrame: 10, endFrame: 100 });
});

test('anteprima della sequenza: master sotto, cutaway sopra, fps diversi', () => {
  const layout = { items: [
    { id: 'm1', track: 1, rec: 0, len: 100, takeId: 'T1', clipId: 'C1', startFrame: 500, endFrame: 600 },
    { id: 'm2', track: 1, rec: 100, len: 50, takeId: 'T2', clipId: 'C2', startFrame: 0, endFrame: 100 },
    { id: 'c1', track: 2, rec: 40, len: 20, takeId: 'T3', clipId: 'C3', startFrame: 10, endFrame: 30 },
  ], total: 150 };
  const at = (r) => sequenceAt(layout, r, { fpsOf: (c) => (c === 'C2' ? 50 : 25), timelineFps: 25 });
  assert.deepEqual([at(10).master.srcFrame, at(10).overlay], [510, null]);
  assert.deepEqual([at(45).master.id, at(45).overlay.id, at(45).overlay.srcFrame], ['m1', 'c1', 15]);
  assert.equal(at(110).master.srcFrame, 20); // clip a 50 fps su timeline a 25
  assert.deepEqual(at(200), { master: null, overlay: null });
  assert.equal(nextBoundary(layout, 41), 60);
  assert.match(mediaErrorText({ codec: 'Apple ProRes 422' }), /proxy/);
  assert.match(mediaErrorText({ triedProxy: true }), /Mostra in Resolve/);
});

// ---------------------------------------------------------------- editor
test('editor: zoom, righello, aggancio, corsie', () => {
  assert.equal(fitZoom(0, 800), 1);
  assert.ok(Math.abs(fitZoom(1000, 800) - 0.736) < 1e-9);
  assert.ok(zoomStep(1, 1) > 1 && zoomStep(1, -1) < 1);
  const ticks = rulerTicks(1000, 1, 25, 800);
  assert.equal(ticks[1].frame - ticks[0].frame, 125); // 5 s: prima scala con >= 90 px
  assert.equal(shortTc(25 * 75, 25), '1:15');
  const layout = { items: [{ id: 'a', track: 1, rec: 0, len: 100 }, { id: 'b', track: 2, rec: 30, len: 20 }] };
  const t = snapTargets(layout, [{ recordFrame: 70 }], 55, 'b');
  assert.deepEqual(t, [0, 55, 70, 100]);
  assert.deepEqual(snapFrame(68, t, 1), { frame: 70, snapped: true });
  assert.deepEqual(snapFrame(62, t, 1, 5), { frame: 62, snapped: false });
  assert.equal(trackFromY(5, 3), 3);
  assert.equal(trackFromY(80, 3), 1);
  assert.equal(laneCount(layout), 3);
  assert.equal(laneCount({ items: [{ track: 4 }] }), 5);
  assert.equal(hitItem(layout, 35, 2).id, 'b');
  assert.equal(hitItem(layout, 35, 3), null);
});

// ---------------------------------------------------------------- messaggi
test('errori: niente prefisso tecnico dell\'IPC, rimedio in italiano', () => {
  assert.equal(cleanError(new Error("Error invoking remote method 'ce:autoSync': Error: La clip non ha ancora una trascrizione")), 'La clip non ha ancora una trascrizione');
  assert.match(remedyFor('Nessun progetto aperto in Resolve'), /Apri un progetto/);
  assert.equal(remedyFor('boh'), '');
  assert.ok(SHORTCUTS.flatMap(([, rows]) => rows).some(([k]) => k === 'M'));
});

// ---------------------------------------------------------------- contratto window.ce
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('contratto: ogni chiamata ce.* del renderer ha preload, handler e voce in PLUGIN_API.md', async () => {
  const require = createRequire(import.meta.url);
  const { METHOD_NAMES } = require('../../plugin/main/handlers.js');
  const used = new Set();
  for (const f of await walk(path.join(ROOT, 'plugin/renderer'))) {
    const src = await readFile(f, 'utf8');
    for (const m of src.matchAll(/\bce\.((?:board|sequence)\.)?([A-Za-z]+)\s*\(/g)) used.add((m[1] || '') + m[2]);
  }
  used.delete('onChange');
  const missing = [...used].filter((n) => !METHOD_NAMES.includes(n));
  assert.deepEqual(missing, [], `chiamate senza handler: ${missing}`);
  const pre = await readFile(path.join(ROOT, 'plugin/preload.js'), 'utf8');
  const listed = [...pre.slice(pre.indexOf('const METHODS'), pre.indexOf('];')).matchAll(/'([\w.]+)'/g)].map((m) => m[1]);
  assert.deepEqual(listed, METHOD_NAMES);
  const doc = await readFile(path.join(ROOT, 'docs/PLUGIN_API.md'), 'utf8');
  const undocumented = METHOD_NAMES.filter((n) => !doc.includes(`\`${n}(`) && !doc.includes(`${n}(`));
  assert.deepEqual(undocumented, [], `metodi non documentati in PLUGIN_API.md: ${undocumented}`);
});

test('executeAppendPlan mode "new": un nome gia\' usato produce una timeline nuova con suffisso', async () => {
  const f = makeFakeResolve({ items: [{ id: 'a', name: 'a', frames: 100 }] });
  const b = createBridge(f.resolve);
  const plan = [{ clipId: 'a', startFrame: 0, endFrame: 10, recordFrame: 0, mediaType: 1 }];
  assert.equal((await b.executeAppendPlan(plan, { timelineName: 'X', mode: 'new' })).timelineName, 'X');
  const r = await b.executeAppendPlan(plan, { timelineName: 'X', mode: 'new' });
  assert.deepEqual([r.timelineName, r.baseFrame], ['X 2', 90000]);
  assert.equal(f.res.timelines.length, 2);
});
