// Harness di sviluppo: window.ce costruito con i VERI handler del main (plugin/main/handlers.js + state.js) e il core,
// collegati a un finto Resolve (core/test/helpers/fakeResolve.js) con dati interamente SINTETICI.
// Cosi' la UI provata nel browser parla con la stessa logica del plugin installato.
// Video: plugin/dev/sample/*.mp4 generati da plugin/dev/make-samples.sh (se mancano, il lettore mostra il ripiego).
import * as sync from '../../core/src/sync/index.js';
import { parseResolveTranscript } from '../../core/src/transcript/parse.js';
import { alignClip } from '../../core/src/align/index.js';
import { applyScriptEdit } from '../../core/src/script/edit.js';
import { diffRevision, applyRevision } from '../../core/src/script/revision.js';
import { scriptFromTranscripts } from '../../core/src/script/fromTranscript.js';
import { searchTranscripts } from '../../core/src/search/phrase.js';
import * as sequence from '../../core/src/sequence/index.js';
import * as board from '../../core/src/board/index.js';
import { createBridge } from '../../core/src/bridge/resolveBridge.js';
import { makeFakeResolve } from '../../core/test/helpers/fakeResolve.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const FPS = 25;

// ------------------------------------------------------------------ sceneggiatura sintetica (+ una revisione)
const ROWS = [
  ['S1', 'scene', null, 'INT. CASA DI NONNA - MATTINA'],
  ['S1', 'action', null, 'Una cucina piccola. Il sole entra dalle persiane socchiuse.'],
  ['S1', 'action', null, 'Livia mette a scaldare la moka e guarda l\'orologio.'],
  ['S1', 'dialogue', 'LIVIA', 'Hai dormito poco, si vede dalla faccia.'],
  ['S1', 'dialogue', 'TEO', 'Il treno parte alle sette, devo proprio muovermi.'],
  ['S1', 'action', null, 'Teo infila la giacca, poi si ferma sulla porta.'],
  ['S1', 'dialogue', 'LIVIA', 'Almeno bevi il caffè prima di uscire.'],
  ['S2', 'scene', null, 'EST. STAZIONE - GIORNO'],
  ['S2', 'action', null, 'Il binario è quasi vuoto. Un altoparlante gracchia un annuncio.'],
  ['S2', 'action', null, 'Teo corre lungo la banchina con lo zaino su una spalla.'],
  ['S2', 'action', null, 'Le porte si chiudono un istante prima che lui arrivi.'],
  ['S2', 'action', null, 'Teo batte la mano sul vetro, poi sorride e scuote la testa.'],
  ['S3', 'scene', null, 'INT. TRENO - SERA'],
  ['S3', 'action', null, 'Un vagone semivuoto. La luce arancione scorre sui sedili.'],
  ['S3', 'dialogue', 'TEO', 'Scusi, questo posto è libero?'],
  ['S3', 'dialogue', 'BIGLIETTAIA', 'Dipende da dove va, ragazzo.'],
  ['S3', 'dialogue', 'TEO', 'Dove va il treno, io vado.'],
  ['S3', 'action', null, 'La donna sorride e sposta la borsa sul sedile accanto.'],
  ['S3', 'transition', null, 'DISSOLVENZA.'],
];
function scriptDoc(revised = false) {
  let rows = ROWS.map((r) => [...r]);
  if (revised) {
    rows[4] = ['S1', 'dialogue', 'TEO', 'Il treno parte alle sette in punto, devo muovermi.'];
    rows = rows.filter((r) => !r[3].startsWith('Le porte si chiudono'));
    rows.splice(2, 0, ['S1', 'action', null, 'Un gatto dorme sul davanzale.']);
  }
  const lines = rows.map(([sceneId, type, character, text], i) => ({
    id: `L${String(i + 1).padStart(4, '0')}`, order: i + 1, type, character, text, sceneId, confidence: i === 5 ? 0.55 : 0.95,
  }));
  const scenes = ['S1', 'S2', 'S3'].map((id) => ({ id, heading: lines.find((l) => l.sceneId === id && l.type === 'scene').text, lineIds: lines.filter((l) => l.sceneId === id).map((l) => l.id) }));
  return { title: revised ? 'Il Treno delle Sette (rev. 2)' : 'Il Treno delle Sette (esempio)', source: 'fdx', scenes, lines, warnings: [], confidence: 0.92 };
}

// ------------------------------------------------------------------ trascrizioni sintetiche
const tc = (f) => { const p = (v) => String(v).padStart(2, '0'); const s = Math.floor(f / FPS); return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f % FPS)}`; };
// parts: [[secondoInizio, 'testo detto']]
function transcript(parts, startTc = 90000) {
  const segments = parts.map(([sec, text]) => {
    const ws = text.split(' ');
    const words = ws.map((w, i) => ({ start: tc(startTc + Math.round((sec + i * 0.38) * FPS)), end: tc(startTc + Math.round((sec + i * 0.38 + 0.34) * FPS)), text: ` ${w}` }));
    return { start: words[0].start, end: words[words.length - 1].end, text, words };
  });
  return { language: 'it', segments };
}
const T1 = transcript([[4, 'Hai dormito poco, si vede dalla faccia.'], [9, 'Il treno parte alle sette, devo proprio muovermi.'], [16, 'Dai, almeno bevi il caffè prima di uscire.'], [24, 'Va bene, va bene.']]);
const T2 = transcript([[2.5, 'Hai dormito poco si vede.'], [7.4, 'Il treno parte alle sette, devo muovermi.'], [14, 'Almeno bevi il caffè prima di uscire.']]);
const T4 = transcript([[3, 'Scusi, questo posto è libero?'], [7, 'Dipende da dove va, ragazzo.'], [11.5, 'Dove va il treno, io vado.'], [16, 'Allora si sieda pure.']]);

export async function createDevCe({ handlersSrc, stateSrc, sampleBase = '/plugin/dev/sample' } = {}) {
  const load = (src) => { const module = { exports: {} }; new Function('module', 'exports', src)(module, module.exports); return module.exports; };
  const { createHandlers, METHOD_NAMES } = load(handlersSrc);
  const { createState } = load(stateSrc);

  const item = (id, name, frames, file, transcription, props = {}) => ({ id, name, fps: FPS, frames, startTc: '01:00:00:00', transcription: null, pending: transcription, props: { 'File Path': `${sampleBase}/${file}`, 'Video Codec': file.endsWith('.mov') ? 'Apple ProRes 422 Proxy' : 'H.264', ...props } });
  const spec = [
    { name: 'Scena 1', items: [item('C1', 'A001_C003', 1500, 'c1.mp4', T1, { 'Camera #': 'A', Scene: '1', Take: '3', 'Shot Type': 'WS' }), item('C2', 'A001_C004', 1200, 'c2.mp4', T2, { 'Camera #': 'B', Scene: '1', Take: '3' })] },
    { name: 'Scena 2', items: [item('C3', 'A002_C001', 900, 'c3.mp4', null)] },
    { name: 'Scena 3', items: [item('C4', 'A003_C002', 1100, 'c4.mp4', T4), item('C5', 'A003_C005_PRORES', 400, 'c5.mov', null)] },
  ];
  const f = makeFakeResolve({ bins: spec.map((b) => ({ name: b.name, items: b.items.map(({ pending, ...rest }) => rest) })), projectName: 'Progetto Esempio' });
  // le trascrizioni "arrivano" qualche secondo dopo TranscribeAudio, come in Resolve
  for (const b of spec) for (const it of b.items) {
    const clip = f.clips.find((c) => c.id === it.id);
    clip.pendingTranscription = it.pending;
    if (!it.pending) clip.noAudio = it.id === 'C3' ? false : clip.noAudio;
    clip.TranscribeAudio = async () => {
      clip.transcribeStatus = 'InProgress';
      setTimeout(() => clip.finishTranscription(clip.pendingTranscription || { language: 'it', segments: [{ start: '01:00:00:00', end: '01:00:10:00', text: '(...)', words: [{ start: '01:00:00:00', end: '01:00:10:00', text: '(...)' }] }] }), 2500);
      return true;
    };
  }
  await f.mp.CreateEmptyTimeline('Timeline 1');

  const mem = {};
  const persist = { save: async (name, text) => { mem[name] = text; try { localStorage.setItem(`ce.dev.${name}`, text); } catch { /* */ } return `mem://${name}`; }, load: async (name) => mem[name] ?? (() => { try { return localStorage.getItem(`ce.dev.${name}`); } catch { return null; } })() };
  const listeners = new Set();
  let nextScript = 'base';
  const state = createState(sync, sequence);
  const handlers = createHandlers({
    core: {
      sync, parseResolveTranscript, alignClip, applyScriptEdit, diffRevision, applyRevision, scriptFromTranscripts, searchTranscripts, sequence, board,
      parseFdx: () => scriptDoc(nextScript === 'rev'), parsePdf: async () => scriptDoc(nextScript === 'rev'),
    },
    bridge: createBridge(f.resolve), state, persist,
    media: { register: (p) => p },
    notify: (snap) => { const s = JSON.parse(JSON.stringify(snap)); listeners.forEach((cb) => cb(s)); },
    pickFile: async () => ({ path: nextScript === 'rev' ? '/esempio/il_treno_rev2.fdx' : '/esempio/il_treno.fdx', name: nextScript === 'rev' ? 'il_treno_rev2.fdx' : 'il_treno.fdx' }),
    readFile: async () => '',
    writeFile: async (p, text) => { mem[`file:${p}`] = text; },
    diagPath: '~/Desktop/continuityedit_diag.json',
    showSaveDialog: async ({ suggestedName }) => `/esempio/${suggestedName}`,
    writeBinary: async () => {},
    version: 'dev',
  });

  // window.ce: stessi nomi del preload; i risultati passano per JSON (come l'IPC) e gli errori hanno il prefisso di Electron.
  const ce = {};
  for (const name of METHOD_NAMES) {
    const parts = name.split('.');
    let target = ce;
    for (const ns of parts.slice(0, -1)) target = (target[ns] ??= {});
    target[parts[parts.length - 1]] = async (...args) => {
      await delay(15);
      try {
        const r = await handlers[name](...JSON.parse(JSON.stringify(args)));
        return r === undefined ? undefined : JSON.parse(JSON.stringify(r));
      } catch (e) {
        throw new Error(`Error invoking remote method 'ce:${name}': Error: ${e.message}`);
      }
    };
  }
  ce.onChange = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
  ce.__dev = {
    f, handlers, state,
    useRevisedScript(v = true) { nextScript = v ? 'rev' : 'base'; },
    setPlayhead(frame) { const tl = f.res.currentTimeline; if (tl) tl.tc = tc(frame); },
    selectClips(ids) { f.mp.selected = f.clips.filter((c) => ids.includes(c.id)); },
    async seed({ sequence: withSeq = true } = {}) {
      await handlers.checkProject();
      await handlers.loadBins(['Scena 1', 'Scena 3']);
      await handlers.loadScript('/esempio/il_treno.fdx');
      for (const c of f.clips) if (c.pendingTranscription && c.id !== 'C4') c.finishTranscription();
      for (const t of state.project.takes) { try { await handlers.autoSync(t.id); } catch { /* non trascritta */ } }
      await handlers.setTakeLabel('T1', 'Ciak 3 A');
      await handlers.setTakeLabel('T2', 'Ciak 3 B');
      await handlers.setTakeShot({ takeId: 'T2', shot: 'stretto' });
      await handlers.setMark({ takeId: 'T1', rating: 'buono', grade: 'B+' });
      if (withSeq) {
        const lines = state.project.scriptDoc.lines.filter((l) => l.sceneId === 'S1' && l.type === 'dialogue').map((l) => l.id);
        await handlers['sequence.setMaster']({ takeId: 'T1', lineIds: lines });
        await handlers['sequence.addCutaway']({ takeId: 'T2', fromLineId: lines[1], toLineId: lines[1] });
      }
    },
  };
  return ce;
}
