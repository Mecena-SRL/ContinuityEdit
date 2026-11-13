'use strict';
// Handler del contratto window.ce (docs/PLUGIN_API.md), indipendenti da Electron: tutto e' iniettato.
//
// deps = {
//   core:    { sync, parseResolveTranscript, alignClip, parseFdx, parsePdf }   // moduli ESM del core
//   bridge:  oggetto di createBridge(resolve)
//   state:   createState(core.sync)
//   persist: createPersist({dir})  (opzionale: senza, niente salvataggio)
//   notify:  (snapshot) => void    // push 'ce:changed'
//   pickFile: async () => {path,name}|null   // dialogo nativo
//   readFile: async (path) => Buffer
//   diagPath: string               // dove scrivere la diagnostica
//   writeFile: async (path, text)
// }
// Errori: Error con messaggio italiano. Le azioni Resolve "non riuscite" restituiscono {ok:false, reason}.

const SYNC_TYPES = new Set(['dialogue', 'action']);
const MARKER_COLOR = { start: 'Green', end: 'Red', point: 'Blue' };

function createHandlers(deps) {
  const { core, bridge, state, persist, notify = () => {}, pickFile, readFile, writeFile, diagPath } = deps;
  const { sync } = core;

  async function projectName() {
    if (state.meta.projectName) return state.meta.projectName;
    try {
      const env = await bridge.getEnv();
      state.meta.projectName = env.projectName || 'senza-nome';
    } catch {
      state.meta.projectName = 'senza-nome';
    }
    return state.meta.projectName;
  }

  async function autosave() {
    if (!persist || !state.project) return;
    try {
      await persist.save(await projectName(), sync.serialize(state.project, { pretty: true }));
      state.meta.saveError = null;
    } catch (e) {
      state.meta.saveError = e.message; // non blocca il lavoro
    }
  }

  // Esegue una mutazione, poi salva e notifica.
  async function mutate(fn) {
    const result = await fn(state.need());
    await autosave();
    notify(state.snapshot());
    return result;
  }

  const takeOrThrow = (p, takeId) => {
    const t = sync.getTake(p, takeId);
    if (!t) throw new Error(`Take sconosciuto: ${takeId}`);
    return t;
  };
  const lineOrThrow = (p, lineId) => {
    const l = sync.getLine(p, lineId);
    if (!l) throw new Error(`Riga sconosciuta: ${lineId}`);
    return l;
  };

  const h = {};

  // ----- ambiente
  h.getEnv = () => bridge.getEnv();

  // ----- script
  h.pickScriptFile = async () => (pickFile ? pickFile() : null);

  h.loadScript = async (path) => {
    if (typeof path !== 'string' || !path) throw new Error('Percorso dello script mancante');
    const ext = path.toLowerCase().split('.').pop();
    let doc;
    if (ext === 'fdx') doc = core.parseFdx((await readFile(path)).toString('utf8'));
    else if (ext === 'pdf') doc = await core.parsePdf(await readFile(path));
    else throw new Error('Formato non supportato: usa un file .fdx o .pdf');
    const { warnings = [], confidence = null, ...scriptDoc } = doc;
    const prev = state.project;
    const project = sync.createProject(scriptDoc);
    // Lo script e' cambiato: si tengono clip e take, si azzerano ancore/selezione/note (riferite alle vecchie righe).
    if (prev) {
      for (const [id, c] of Object.entries(prev.clips)) project.clips[id] = { ...c };
      for (const t of prev.takes) project.takes.push({ ...t });
    }
    state.setProject(project, { warnings, confidence });
    await autosave();
    notify(state.snapshot());
    return { scriptDoc: project.scriptDoc, warnings, confidence };
  };

  // ----- clip e take
  h.getSelectedClips = () => bridge.getSelectedClips();

  h.addTake = ({ clipId, label } = {}) => mutate(async (p) => {
    if (!clipId) throw new Error('clipId mancante');
    const info = await bridge.getClip(clipId);
    if (!info) throw new Error('Clip non trovata nel Media Pool');
    sync.addClip(p, clipId, {
      fps: info.fps, durationFrames: info.durationFrames, startTcFrames: info.startTcFrames, name: info.name,
    });
    const take = sync.addTake(p, { clipId, label: label || undefined });
    return { takeId: take.id };
  });

  h.removeTake = (takeId) => mutate(async (p) => {
    const t = takeOrThrow(p, takeId);
    p.takes = p.takes.filter((x) => x.id !== takeId);
    p.anchors = p.anchors.filter((a) => a.takeId !== takeId);
    for (const [l, tk] of Object.entries(p.selection)) if (tk === takeId) delete p.selection[l];
    delete p.notes[takeId];
    if (!p.takes.some((x) => x.clipId === t.clipId)) delete p.clips[t.clipId];
    return true;
  });

  h.transcribeClips = async (clipIds) => {
    if (!Array.isArray(clipIds) || clipIds.length === 0) throw new Error('Nessuna clip da trascrivere');
    const r = await bridge.transcribe(clipIds);
    return { started: r.started, failed: r.failed };
  };
  h.getTranscribeStatus = () => bridge.status();

  h.autoSync = (takeId) => mutate(async (p) => {
    const take = takeOrThrow(p, takeId);
    const clip = p.clips[take.clipId];
    const raw = await bridge.getTranscription(take.clipId);
    if (!raw) throw new Error('La clip non ha ancora una trascrizione: avviala dal pannello e riprova');
    const transcript = core.parseResolveTranscript(raw, { clipId: take.clipId, fps: clip.fps, startTcFrames: clip.startTcFrames });
    if (transcript.words.length === 0) throw new Error('La trascrizione non contiene parole utilizzabili');
    const result = core.alignClip(p.scriptDoc, transcript);
    const { added, skipped } = sync.fromAlignment(p, takeId, result);
    return { added: added.length, skipped: skipped.length, unmatchedCount: (result.unmatched || []).length, language: transcript.language };
  });

  // ----- ancore manuali
  h.addAnchor = ({ takeId, lineId, edge, frame } = {}) => mutate(async (p) => {
    takeOrThrow(p, takeId); lineOrThrow(p, lineId);
    return { anchorId: sync.addAnchor(p, { takeId, lineId, edge, frame: Math.round(frame), kind: 'manual' }).id };
  });
  h.moveAnchor = (anchorId, frame) => mutate(async (p) => { sync.moveAnchor(p, anchorId, Math.round(frame)); return true; });
  h.removeAnchor = (anchorId) => mutate(async (p) => sync.removeAnchor(p, anchorId));
  h.anchorFromMarker = ({ takeId, lineId, edge, markerFrame } = {}) => mutate(async (p) => {
    takeOrThrow(p, takeId); lineOrThrow(p, lineId);
    return { anchorId: sync.addAnchor(p, { takeId, lineId, edge, frame: Math.round(markerFrame), kind: 'manual' }).id };
  });
  h.anchorFromPlayhead = async ({ takeId, lineId, edge } = {}) => {
    const p = state.need();
    const take = takeOrThrow(p, takeId); lineOrThrow(p, lineId);
    const r = await bridge.playheadSourceFrame(take.clipId);
    if (!r.ok) return { ok: false, reason: r.reason };
    const clip = p.clips[take.clipId];
    const frame = Math.min(Math.max(0, r.frame), clip.durationFrames);
    await mutate(async () => sync.addAnchor(p, { takeId, lineId, edge, frame, kind: 'manual' }));
    return { ok: true, frame };
  };

  // ----- progetto e viste
  h.getState = async () => state.snapshot();
  h.setSelection = (lineId, takeId) => mutate(async (p) => { sync.setSelection(p, lineId, takeId ?? null); return true; });
  h.setNote = (key, text) => mutate(async (p) => { sync.setNote(p, key, text); return true; });

  h.saveProject = async () => {
    const p = state.need();
    if (!persist) throw new Error('Salvataggio non configurato');
    const file = await persist.save(await projectName(), sync.serialize(p, { pretty: true }));
    return { ok: true, path: file };
  };
  h.loadProject = async () => {
    if (!persist) return { loaded: false, ...state.snapshot() };
    const text = await persist.load(await projectName());
    if (text == null) return { loaded: false, ...state.snapshot() };
    state.setProject(sync.deserialize(text)); // lancia "Progetto non valido: ..." se corrotto
    notify(state.snapshot());
    return { loaded: true, ...state.snapshot() };
  };

  // ----- azioni su Resolve
  h.previewLine = async ({ lineId, takeId } = {}) => {
    const p = state.need();
    const take = takeOrThrow(p, takeId); lineOrThrow(p, lineId);
    const cov = sync.coverageForTake(p, takeId).find((c) => c.lineId === lineId);
    if (!cov) return { ok: false, reason: 'la riga non e\' coperta in questo take' };
    return bridge.previewLine(take.clipId, cov.startFrame, cov.endFrame);
  };

  h.assemble = async ({ lineIds, timelineName, handleFrames = 0 } = {}) => {
    const p = state.need();
    if (!Array.isArray(lineIds) || lineIds.length === 0) throw new Error('Nessuna riga da montare');
    const { cuts, skipped } = sync.planAssemblyDetailed(p, lineIds, { handleFrames: Math.max(0, Math.round(handleFrames) || 0) });
    const res = await bridge.assemble(cuts, timelineName);
    const skippedOut = skipped.map(({ lineId, reason }) => ({ lineId, reason }));
    for (const s of res.skipped || []) for (const lineId of s.lineIds) skippedOut.push({ lineId, reason: s.reason });
    const out = { ok: res.ok, timelineName: res.timelineName, itemsAdded: res.itemsAdded, skipped: skippedOut };
    if (!res.ok) out.reason = res.reason;
    return out;
  };

  h.writeMarkers = async ({ takeId } = {}) => {
    const p = state.need();
    const take = takeOrThrow(p, takeId);
    const clip = p.clips[take.clipId];
    const markers = sync.effectiveAnchors(p, takeId).map((a) => {
      const line = sync.getLine(p, a.lineId);
      // un marker non puo' stare sul frame "escluso": si clampa all'ultimo frame della clip
      const frame = Math.min(Math.max(0, a.frame), clip.durationFrames - 1);
      return {
        frame, color: MARKER_COLOR[a.edge] || 'Blue', name: `${a.lineId} ${a.edge}`,
        note: line && SYNC_TYPES.has(line.type) ? (line.character || line.type) : '', duration: 1,
        customData: `ce:${a.lineId}:${a.edge}`,
      };
    });
    const r = await bridge.writeMarkers(take.clipId, markers);
    return { ok: r.ok, count: r.count, ...(r.reason ? { reason: r.reason } : {}), ...(r.failed?.length ? { failed: r.failed } : {}) };
  };

  h.runDiagnostics = async () => {
    const report = await bridge.runDiagnostics();
    const path = diagPath || 'continuityedit_diag.json';
    await writeFile(path, JSON.stringify(report, null, 2));
    return { ok: report.ok, path };
  };

  return h;
}

// Nomi dei metodi del contratto (usati da main.js per registrare ipcMain.handle('ce:<nome>')).
const METHOD_NAMES = [
  'getEnv', 'pickScriptFile', 'loadScript', 'getSelectedClips', 'addTake', 'removeTake', 'transcribeClips',
  'getTranscribeStatus', 'autoSync', 'addAnchor', 'moveAnchor', 'removeAnchor', 'anchorFromMarker',
  'anchorFromPlayhead', 'getState', 'setSelection', 'setNote', 'saveProject', 'loadProject', 'previewLine',
  'assemble', 'writeMarkers', 'runDiagnostics',
];

module.exports = { createHandlers, METHOD_NAMES };
