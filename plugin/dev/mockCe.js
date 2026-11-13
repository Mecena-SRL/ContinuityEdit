// window.ce simulato per provare la UI senza Resolve. Dati interamente SINTETICI.
// Usa il modello di sync del core (puro) cosi' copertura/ancore si comportano come nel plugin vero.
import {
  createProject, addClip, addTake, setSelection, setNote, addAnchor, moveAnchor, removeAnchor,
  coverageForTake, bestTake, checkAnchors, planAssemblyDetailed,
} from '../../core/src/sync/index.js';

const delay = (ms = 60) => new Promise((r) => setTimeout(r, ms));

function syntheticScript() {
  const rows = [
    ['S1', 'scene', null, 'INT. CASA DI NONNA - MATTINA', 1],
    ['S1', 'action', null, 'Una cucina piccola. Il sole entra dalle persiane socchiuse.', 0.97],
    ['S1', 'action', null, 'Livia mette a scaldare la moka e guarda l\'orologio.', 0.93],
    ['S1', 'dialogue', 'LIVIA', 'Hai dormito poco, si vede.', 0.96],
    ['S1', 'dialogue', 'TEO', 'Il treno parte alle sette. Devo muovermi.', 0.9],
    ['S1', 'action', null, 'Teo infila la giacca, poi si ferma sulla porta.', 0.55],
    ['S1', 'dialogue', 'LIVIA', 'Almeno bevi il caffè.', 0.94],
    ['S2', 'scene', null, 'EST. STAZIONE - GIORNO', 1],
    ['S2', 'action', null, 'Il binario è quasi vuoto. Un altoparlante gracchia un annuncio.', 0.95],
    ['S2', 'action', null, 'Teo corre lungo la banchina con lo zaino su una spalla.', 0.92],
    ['S2', 'action', null, 'Le porte si chiudono un istante prima che lui arrivi.', 0.62],
    ['S2', 'action', null, 'Teo batte la mano sul vetro, poi sorride e scuote la testa.', 0.9],
    ['S3', 'scene', null, 'INT. TRENO - SERA', 1],
    ['S3', 'action', null, 'Un vagone semivuoto. La luce arancione scorre sui sedili.', 0.96],
    ['S3', 'dialogue', 'TEO', 'Scusi, questo posto è libero?', 0.88],
    ['S3', 'dialogue', 'BIGLIETTAIA', 'Dipende da dove va, ragazzo.', 0.52],
    ['S3', 'dialogue', 'TEO', 'Dove va il treno, io vado.', 0.91],
    ['S3', 'action', null, 'La donna sorride e sposta la borsa sul sedile accanto.', 0.9],
    ['S3', 'transition', null, 'DISSOLVENZA.', 0.97],
  ];
  const lines = rows.map(([sceneId, type, character, text, confidence], i) => ({
    id: `L${String(i + 1).padStart(4, '0')}`, order: i + 1, type, character, text, sceneId, confidence,
  }));
  const scenes = ['S1', 'S2', 'S3'].map((id) => ({
    id, heading: lines.find((l) => l.sceneId === id && l.type === 'scene').text,
    lineIds: lines.filter((l) => l.sceneId === id).map((l) => l.id),
  }));
  return { title: 'Il Treno delle Sette (esempio)', source: 'pdf', scenes, lines };
}

const L = (n) => `L${String(n).padStart(4, '0')}`;

function seedProject() {
  const p = createProject(syntheticScript());
  const mk = (frame, color, name, note = '') => ({ frame, color, name, note, duration: 1, customData: '' });
  const clips = [
    ['C1', 'A001_C003', 1500, [mk(40, 'Blue', 'inizio scena'), mk(380, 'Green', 'buona'), mk(900, 'Red', 'errore')]],
    ['C2', 'A001_C004', 1200, [mk(25, 'Blue', 'azione'), mk(610, 'Yellow', 'alt')]],
    ['C3', 'A002_C001', 900, []],
  ];
  clips.forEach(([id, name, dur]) => addClip(p, id, { fps: 25, durationFrames: dur, startTcFrames: 90000, name }));
  addTake(p, { id: 'T1', clipId: 'C1', label: 'Ciak 1' });
  addTake(p, { id: 'T2', clipId: 'C2', label: 'Ciak 2' });
  addTake(p, { id: 'T3', clipId: 'C3', label: 'Ciak 3' });
  // T1: automatico sulle battute, manuale su qualche azione
  const a = (takeId, n, edge, frame, kind, ratio) => addAnchor(p, { takeId, lineId: L(n), edge, frame, kind, ratio });
  [[4, 100, 220, 0.96], [5, 230, 400, 0.88], [7, 430, 560, 0.71]].forEach(([n, s, e, r]) => { a('T1', n, 'start', s, 'auto', r); a('T1', n, 'end', e, 'auto', r); });
  a('T1', 2, 'start', 10, 'manual'); a('T1', 2, 'end', 60, 'manual');
  a('T1', 3, 'start', 60, 'manual'); a('T1', 3, 'end', 100, 'manual');
  a('T1', 6, 'start', 400, 'manual'); a('T1', 6, 'end', 430, 'manual');
  [[15, 700, 800, 0.84], [16, 810, 920, 0.62], [17, 930, 1010, 0.9]].forEach(([n, s, e, r]) => { a('T1', n, 'start', s, 'auto', r); a('T1', n, 'end', e, 'auto', r); });
  // T2: riprese diverse delle stesse battute + mute della scena 2 (solo inizio => fine stimata)
  [[4, 80, 190, 0.93], [5, 200, 390, 0.95], [7, 410, 500, 0.9]].forEach(([n, s, e, r]) => { a('T2', n, 'start', s, 'auto', r); a('T2', n, 'end', e, 'auto', r); });
  a('T2', 9, 'start', 600, 'manual'); a('T2', 10, 'start', 700, 'manual'); a('T2', 11, 'start', 800, 'manual'); a('T2', 12, 'start', 880, 'manual');
  // T3: solo la scena treno
  [[15, 60, 150, 0.8], [16, 160, 260, 0.74], [17, 270, 380, 0.82]].forEach(([n, s, e, r]) => { a('T3', n, 'start', s, 'auto', r); a('T3', n, 'end', e, 'auto', r); });
  a('T3', 14, 'start', 0, 'manual'); a('T3', 14, 'end', 60, 'manual');
  a('T3', 18, 'start', 390, 'manual'); a('T3', 18, 'end', 470, 'manual');
  // T1/T2: ancora fuori ordine per mostrare un avviso di coerenza
  a('T2', 6, 'start', 5, 'manual');
  setNote(p, L(4), 'Ottima intenzione nel ciak 1.');
  return p;
}

const seedMarkers = (() => {
  const mk = (frame, color, name, note = '') => ({ frame, color, name, note, duration: 1, customData: '' });
  return {
    C1: [mk(40, 'Blue', 'inizio scena'), mk(380, 'Green', 'buona'), mk(900, 'Red', 'errore')],
    C2: [mk(25, 'Blue', 'azione'), mk(610, 'Yellow', 'alt')],
    C4: [mk(30, 'Blue', 'inizio'), mk(520, 'Green', 'scena 3', 'buona')],
  };
})();

export function createMockCe(opts = {}) {
  let project = seedProject();
  const state = {
    playheadFrame: 150, transcribed: new Set(['C1']), job: null, listeners: new Set(), env: {
      resolveVersion: '21.2 (mock)', product: 'DaVinci Resolve Studio', projectName: 'Progetto Esempio', pageName: 'edit',
      timelineName: 'Timeline 1', timelineFps: 25, isStudio: true,
    },
    ...opts,
  };
  const log = [];
  const call = (name, args) => { log.push({ name, args }); };

  const view = () => {
    const lines = project.scriptDoc.lines.map((l) => ({
      id: l.id, type: l.type, character: l.character, text: l.text, sceneId: l.sceneId, order: l.order,
      syncable: l.type === 'action' || l.type === 'dialogue', confidence: l.confidence,
    }));
    const takes = project.takes.map((t) => ({ id: t.id, clipId: t.clipId, label: t.label, name: project.clips[t.clipId].name }));
    const coverage = {};
    const best = {};
    for (const t of takes) coverage[t.id] = coverageForTake(project, t.id, { maxTailFrames: 150 });
    for (const l of lines) best[l.id] = bestTake(project, l.id);
    return { lines, takes, coverage, bestTake: best, warnings: checkAnchors(project) };
  };
  const snapshot = () => ({ project: JSON.parse(JSON.stringify(project)), view: view() });
  const emit = () => { const s = snapshot(); state.listeners.forEach((cb) => cb(s)); };
  const mutate = async (fn) => { const r = fn(); emit(); return r; };
  const takeOf = (takeId) => project.takes.find((t) => t.id === takeId);
  const pending = new Set();

  const ce = {
    async getEnv() { await delay(); return { ...state.env }; },
    async pickScriptFile() { await delay(); return { path: '/esempio/sceneggiatura.pdf', name: 'sceneggiatura.pdf' }; },
    async loadScript() {
      await delay(200);
      const sd = syntheticScript();
      const keep = project.anchors;
      project.scriptDoc = sd; project.anchors = keep; emit();
      return {
        scriptDoc: sd, confidence: 0.84,
        warnings: ['Pagina 3: colonne ambigue, 2 battute potrebbero essere in dual dialogue.', 'Riga L0011: azione spezzata a fine pagina, controllare il testo.'],
      };
    },
    async getSelectedClips() {
      await delay();
      const mine = Object.entries(project.clips).map(([clipId, c]) => ({
        clipId, name: c.name, fps: c.fps, durationFrames: c.durationFrames, startTcFrames: c.startTcFrames,
        transcribed: state.transcribed.has(clipId), markers: seedMarkers[clipId] || [],
      }));
      const extra = [
        { clipId: 'C4', name: 'A002_C002', fps: 25, durationFrames: 1100, startTcFrames: 90000, transcribed: false, markers: [{ frame: 30, color: 'Blue', name: 'inizio', note: '', duration: 1, customData: '' }, { frame: 520, color: 'Green', name: 'scena 3', note: 'buona', duration: 1, customData: '' }] },
        { clipId: 'C5', name: 'A002_C003', fps: 25, durationFrames: 800, startTcFrames: 90000, transcribed: false, markers: [] },
      ].filter((c) => !project.clips[c.clipId]).map((c) => ({ ...c, transcribed: state.transcribed.has(c.clipId) }));
      return [...mine, ...extra];
    },
    async addTake({ clipId, label }) {
      await delay();
      const sel = (await ce.getSelectedClips()).find((c) => c.clipId === clipId);
      return mutate(() => {
        if (!project.clips[clipId]) addClip(project, clipId, { fps: sel?.fps ?? 25, durationFrames: sel?.durationFrames ?? 1000, startTcFrames: sel?.startTcFrames ?? 0, name: sel?.name ?? clipId });
        return { takeId: addTake(project, { clipId, label: label || `Ciak ${project.takes.length + 1}` }).id };
      });
    },
    async removeTake(takeId) {
      await delay(30);
      return mutate(() => {
        project.takes = project.takes.filter((t) => t.id !== takeId);
        project.anchors = project.anchors.filter((x) => x.takeId !== takeId);
        for (const [l, t] of Object.entries(project.selection)) if (t === takeId) delete project.selection[l];
      });
    },
    async transcribeClips(clipIds) {
      await delay();
      state.job = { ids: clipIds, polls: 0 };
      return { started: clipIds };
    },
    async getTranscribeStatus() {
      await delay(30);
      if (!state.job) return { jobStatus: 'Inactive' };
      state.job.polls++;
      if (state.job.polls >= 4) { state.job.ids.forEach((c) => state.transcribed.add(c)); state.job = null; emit(); return { jobStatus: 'Complete' }; }
      return { jobStatus: 'InProgress' };
    },
    async autoSync(takeId) {
      await delay(300);
      return mutate(() => {
        let added = 0;
        const t = takeOf(takeId);
        const dur = project.clips[t.clipId].durationFrames;
        project.scriptDoc.lines.filter((l) => l.type === 'dialogue').forEach((l, i) => {
          if (project.anchors.some((a) => a.takeId === takeId && a.lineId === l.id)) return;
          const s = 40 + i * Math.floor((dur - 100) / 7);
          addAnchor(project, { takeId, lineId: l.id, edge: 'start', frame: s, kind: 'auto', ratio: 0.8 });
          addAnchor(project, { takeId, lineId: l.id, edge: 'end', frame: s + 90, kind: 'auto', ratio: 0.8 });
          added += 2;
        });
        return { added, skipped: 0, unmatchedCount: 1 };
      });
    },
    async addAnchor(a) { await delay(30); return mutate(() => addAnchor(project, { ...a, kind: 'manual' }).id); },
    async moveAnchor(id, frame) { await delay(30); return mutate(() => moveAnchor(project, id, frame)); },
    async removeAnchor(id) { await delay(30); return mutate(() => removeAnchor(project, id)); },
    async anchorFromMarker({ takeId, lineId, edge, markerFrame }) {
      await delay(30); return mutate(() => addAnchor(project, { takeId, lineId, edge, frame: markerFrame, kind: 'manual' }).id);
    },
    async anchorFromPlayhead({ takeId, lineId, edge }) {
      await delay(60);
      if (!takeOf(takeId)) return { ok: false, reason: 'Take sconosciuto.' };
      if (state.playheadFrame == null) return { ok: false, reason: 'Nessun elemento della timeline usa questa clip sotto il playhead.' };
      const frame = state.playheadFrame;
      return mutate(() => { addAnchor(project, { takeId, lineId, edge, frame, kind: 'manual' }); return { ok: true, frame }; });
    },
    async getState() { await delay(30); return snapshot(); },
    async setSelection(lineId, takeId) { await delay(10); return mutate(() => setSelection(project, lineId, takeId)); },
    async setNote(key, text) { await delay(10); return mutate(() => setNote(project, key, text)); },
    async saveProject() { await delay(100); call('saveProject'); return { ok: true }; },
    async loadProject() { await delay(100); emit(); return { ok: true }; },
    onChange(cb) { state.listeners.add(cb); return () => state.listeners.delete(cb); },
    async previewLine(args) { await delay(30); call('previewLine', args); return { ok: true }; },
    async assemble({ lineIds, timelineName, handleFrames }) {
      await delay(250);
      const r = planAssemblyDetailed(project, lineIds, { handleFrames });
      return { ok: true, timelineName, itemsAdded: r.cuts.length, skipped: r.skipped };
    },
    async writeMarkers({ takeId }) {
      await delay(100);
      return { ok: true, count: project.anchors.filter((a) => a.takeId === takeId).length };
    },
    async runDiagnostics() { await delay(500); return { ok: true, path: '~/Desktop/continuityedit_diag.json' }; },
  };
  ce.__state = state; ce.__log = log; ce.__emit = emit;
  return ce;
}
