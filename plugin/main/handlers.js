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
//   // estensioni v2 (tutte opzionali):
//   media:   registro ce-media:// (plugin/main/protocol.js createMediaRegistry): whitelist dei file servibili
//   stillsDir: string|(async()=>string)   // dove salvare gli still esportati da Resolve (solo refreshStillViaResolve)
//   mkdir: async (dir)                    // crea la cartella (ricorsiva)
//   showSaveDialog: async ({suggestedName, filters}) => path|null
//   writeBinary: async (path, Buffer)
// }
// Errori: Error con messaggio italiano. Le azioni Resolve "non riuscite" restituiscono {ok:false, reason}.

// ---------------------------------------------------------------------------------------------------------
// Metodi del contratto v2 (docs/PLUGIN_API.md) cablati qui: listBins, loadBins, detectGroups, setTakeGroup,
// getClipMediaPath, board.addStill, board.removeItem, board.refreshStillViaResolve, saveFile, sequence.assemble (accetta un piano gia' calcolato).
//
// RESTANO DA CABLARE quando arrivera' il core-ext (modelli puri in core/src/sequence, core/src/board,
// core/src/script/edit.js, marks/undo in core/src/sync). Per ciascuno: aggiungere il nome a METHOD_NAMES,
// a METHODS di plugin/preload.js (i nomi con '.' diventano oggetti annidati: window.ce.sequence.fromLines)
// e un handler `h['nome']` che muta tramite mutate() (autosave + 'ce:changed'):
//   - editScript({op:'setType'|'setCharacter'|'retypeSelection'|'split'|'merge', ...}) -> state  (applyScriptEdit)
//   - undo() / redo()                                    (cronologia di progetto, max 50)
//   - setMark({takeId, lineId|null, rating?, grade?, tags?}), setGradePalette(list)
//   - sequence.fromLines(lineIds, opts), sequence.addItem(item), sequence.moveItem(id,{index?,track?}),
//     sequence.trimItem(id,{startFrame,endFrame}), sequence.removeItem(id),
//     sequence.directorCut({groupId, switches, range, layered})
//   - sequence.assemble({timelineName, layered?, withAudio?}) SENZA piano: calcolare il piano con
//     toAppendPlan(project.sequence, ...) e passarlo a bridge.executeAppendPlan (oggi lo fa solo con {plan}).
//   - board.addItem, board.moveItem, board.resizeItem, board.setCaption, board.link,
//     board.toSequence({order, ids, holdFrames})
//   - board.addStill/removeItem oggi scrivono direttamente project.board ({items,links}, creato se manca): passare
//     dal modello ufficiale (addStill/removeItem di core/src/board).
//   - setTakeGroup oggi assegna solo take.groupId/angle: passare dal modello ufficiale (con undo/marks).
// ---------------------------------------------------------------------------------------------------------

const SYNC_TYPES = new Set(['dialogue', 'action']);
const MARKER_COLOR = { start: 'Green', end: 'Red', point: 'Blue' };

function createHandlers(deps) {
  const { core, bridge, state, persist, notify = () => {}, pickFile, readFile, writeFile, diagPath, stillsDir, mkdir, showSaveDialog, writeBinary, media } = deps;
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
  // Registra il file della clip (e il proxy) nella whitelist ce-media:// e ritorna gli URL.
  async function mediaUrls(clipId) {
    const r = await bridge.getClipMediaPath(clipId);
    if (!r.ok) return { ok: false, reason: r.reason };
    return {
      ok: true, path: r.path, proxyPath: r.proxyPath ?? null, codec: r.codec, fps: r.fps, startTcFrames: r.startTcFrames,
      url: media ? media.register(r.path) : null,
      proxyUrl: media && r.proxyPath ? media.register(r.proxyPath) : null,
    };
  }
  const withMediaUrl = async (clips) => {
    for (const c of clips) {
      try { c.mediaUrl = (await mediaUrls(c.clipId)).url ?? null; } catch { c.mediaUrl = null; }
    }
    return clips;
  };

  h.getSelectedClips = async () => withMediaUrl(await bridge.getSelectedClips());

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

  // ----- estensioni v2: bin, gruppi, still, piano di montaggio
  h.listBins = () => bridge.listBins();

  // Carica i bin e registra ogni clip come take (una sola volta per clip). Ritorna le clip con bin/meta/takeId.
  h.loadBins = async (names) => {
    if (!Array.isArray(names) || names.length === 0) throw new Error('Nessun bin selezionato');
    state.need();
    const { clips, missing } = await bridge.loadBins(names);
    await withMediaUrl(clips);
    if (clips.length === 0) throw new Error(missing.length ? `Bin non trovati: ${missing.join(', ')}` : 'I bin selezionati non contengono clip');
    return mutate(async (p) => {
      const out = [];
      for (const c of clips) {
        let take = p.takes.find((t) => t.clipId === c.clipId);
        if (!take) {
          if (!(c.fps > 0) || !(c.durationFrames > 0)) { out.push({ ...c, takeId: null, reason: 'fps o durata non leggibili' }); continue; }
          sync.addClip(p, c.clipId, { fps: c.fps, durationFrames: c.durationFrames, startTcFrames: c.startTcFrames, name: c.name });
          take = sync.addTake(p, { clipId: c.clipId });
        }
        take.bin = c.bin;
        take.meta = { scene: c.meta.scene, shot: c.meta.shot, take: c.meta.take, camera: c.meta.camera };
        if (c.meta.angle && !take.angle) take.angle = c.meta.angle;
        out.push({ ...c, takeId: take.id });
      }
      return out;
    });
  };

  // Euristiche sui take registrati; non modifica il progetto (la UI conferma poi con setTakeGroup).
  h.detectGroups = async () => {
    const p = state.need();
    const byClip = new Map();
    const descr = [];
    for (const t of p.takes) {
      const clip = p.clips[t.clipId] || {};
      byClip.set(t.id, t);
      descr.push({ id: t.id, name: clip.name || t.clipId, fps: clip.fps, durationFrames: clip.durationFrames, startTcFrames: clip.startTcFrames, meta: { ...(t.meta || {}), angle: t.angle ?? null } });
    }
    const groups = await bridge.detectGroups(descr);
    return groups.map(({ groupId, label, ids, reason, angles }) => ({ groupId, label, takeIds: ids, reason, angles }));
  };

  h.setTakeGroup = (takeId, groupId, angle) => mutate(async (p) => {
    const t = takeOrThrow(p, takeId);
    t.groupId = groupId ?? null;
    t.angle = angle ?? null;
    return true;
  });

  h.getClipMediaPath = async (takeId) => {
    const take = takeOrThrow(state.need(), takeId);
    const r = await mediaUrls(take.clipId);
    if (!r.ok) return { ok: false, reason: r.reason };
    const { ok, ...rest } = r;
    return rest;
  };

  // ----- lavagna: still = marker Resolve + item del modello (nessun file). Modello provvisorio su project.board.
  const boardOf = (p) => (p.board ??= { items: [], links: [] });
  const nextStillId = (b) => `S${1 + b.items.reduce((m, i) => Math.max(m, Number(/^S(\d+)$/.exec(i.id)?.[1] || 0)), 0)}`;

  h['board.addStill'] = ({ takeId, frame, lineId = null } = {}) => mutate(async (p) => {
    const take = takeOrThrow(p, takeId);
    if (!Number.isFinite(frame)) throw new Error('Frame mancante');
    if (lineId) lineOrThrow(p, lineId);
    const clip = p.clips[take.clipId];
    const f = Math.min(Math.max(0, Math.round(frame)), Math.max(0, clip.durationFrames - 1));
    const b = boardOf(p);
    const id = nextStillId(b);
    const r = await bridge.addStillMarker(take.clipId, f, id);
    const n = b.items.length;
    b.items.push({
      id, type: 'still', takeId, frame: f, imagePath: null, x: (n % 4) * 340, y: Math.floor(n / 4) * 200, w: 320, h: 180,
      z: n + 1, caption: '', lineId, markerWritten: r.ok,
    });
    return { ok: true, itemId: id, markerWritten: r.ok, ...(r.ok ? {} : { reason: r.reason }) };
  });

  h['board.removeItem'] = (id) => mutate(async (p) => {
    const b = boardOf(p);
    const it = b.items.find((x) => x.id === id);
    if (!it) throw new Error(`Elemento della lavagna sconosciuto: ${id}`);
    let marker = null;
    if (it.type === 'still' && it.takeId) {
      const take = sync.getTake(p, it.takeId);
      if (take) marker = await bridge.removeStillMarker(take.clipId, id);
    }
    b.items = b.items.filter((x) => x.id !== id);
    b.links = b.links.filter((l) => l.from !== id && l.to !== id);
    return { ok: true, markerRemoved: marker ? marker.ok : null, ...(marker && !marker.ok ? { reason: marker.reason } : {}) };
  });

  // Esplicito e opzionale: esporta il frame con ExportFrame e lo salva come imagePath dello still.
  h['board.refreshStillViaResolve'] = (id) => mutate(async (p) => {
    const it = boardOf(p).items.find((x) => x.id === id && x.type === 'still');
    if (!it) throw new Error(`Still sconosciuto: ${id}`);
    const take = takeOrThrow(p, it.takeId);
    const dir = typeof stillsDir === 'function' ? await stillsDir() : stillsDir;
    if (!dir) return { ok: false, via: 'none', reason: 'cartella degli still non configurata' };
    if (mkdir) { try { await mkdir(dir); } catch (e) { return { ok: false, via: 'none', reason: `cartella degli still non creabile: ${e.message}` }; } }
    const r = await bridge.exportStill(take.clipId, it.frame, dir);
    if (r.ok) it.imagePath = r.path;
    return r;
  });

  h.saveFile = async ({ suggestedName, dataBase64, filters } = {}) => {
    if (typeof dataBase64 !== 'string' || !dataBase64) throw new Error('Nessun dato da salvare');
    if (!showSaveDialog || !writeBinary) throw new Error('Salvataggio file non configurato');
    const path = await showSaveDialog({ suggestedName: suggestedName || 'esportazione', filters: filters || [] });
    if (!path) return null;
    await writeBinary(path, Buffer.from(dataBase64, 'base64'));
    return { path };
  };

  // Esegue un piano gia' calcolato (toAppendPlan). Accetta anche voci con takeId al posto di clipId.
  h['sequence.assemble'] = async ({ plan, timelineName, withAudio } = {}) => {
    if (!Array.isArray(plan) || plan.length === 0) throw new Error('Piano di montaggio mancante o vuoto');
    const p = state.project;
    const resolved = plan.map((e) => {
      if (e.clipId || !p) return e;
      const t = sync.getTake(p, e.takeId);
      return t ? { ...e, clipId: t.clipId } : e;
    });
    const r = await bridge.executeAppendPlan(resolved, { timelineName, withAudio });
    notify(state.snapshot());
    return r;
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
  'listBins', 'loadBins', 'detectGroups', 'setTakeGroup', 'getClipMediaPath', 'board.addStill', 'board.removeItem', 'board.refreshStillViaResolve', 'saveFile',
  'sequence.assemble',
];

module.exports = { createHandlers, METHOD_NAMES };
