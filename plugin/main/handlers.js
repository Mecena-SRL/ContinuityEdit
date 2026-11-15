'use strict';
// Handler del contratto window.ce (docs/PLUGIN_API.md), indipendenti da Electron: tutto e' iniettato.
// Nessun require(): questo file gira anche nell'harness del browser (plugin/dev), con un finto Resolve.
//
// deps = {
//   core:    { sync, parseResolveTranscript, alignClip, parseFdx, parsePdf, applyScriptEdit, diffRevision, applyRevision,
//              scriptFromTranscripts, searchTranscripts, sequence, board }   // moduli ESM del core
//   bridge:  oggetto di createBridge(resolve)
//   state:   createState(core.sync, core.sequence)
//   persist: createPersist({dir})  (opzionale: senza, niente salvataggio)
//   notify:  (snapshot) => void    // push 'ce:changed'
//   pickFile: async () => {path,name}|null   // dialogo nativo
//   readFile: async (path) => Buffer|string
//   diagPath: string               // dove scrivere la diagnostica
//   writeFile: async (path, text)
//   // facoltativi:
//   media:   registro ce-media:// (plugin/main/protocol.js createMediaRegistry): whitelist dei file servibili
//   stillsDir: string|(async()=>string)   // dove salvare gli still esportati da Resolve (solo refreshStillViaResolve)
//   mkdir: async (dir)                    // crea la cartella (ricorsiva)
//   showSaveDialog: async ({suggestedName, filters}) => path|null
//   writeBinary: async (path, Buffer|Uint8Array)
// }
// Errori: Error con messaggio italiano. Le azioni Resolve "non riuscite" restituiscono {ok:false, reason}.
// Ogni mutazione passa da mutate(): coda seriale (nessuna mutazione si accavalla a un'altra), snapshot per l'undo,
// ripristino del progetto se la mutazione lancia, autosave del sidecar e 'ce:changed'.

const SYNC_TYPES = new Set(['dialogue', 'action']);
const MARKER_COLOR = { start: 'Green', end: 'Red', point: 'Blue' };
const EMPTY_DOC = () => ({ title: '', source: null, scenes: [], lines: [] });
const b64 = (s) => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8') : new TextEncoder().encode(s));

function createHandlers(deps) {
  const { core, bridge, state, persist, notify = () => {}, pickFile, readFile, writeFile, diagPath, stillsDir, mkdir, showSaveDialog, writeBinary, media } = deps;
  const { sync } = core;
  const history = sync.createHistory();
  const transcripts = new Map(); // clipId -> TranscriptDoc (cache per lettore e ricerca)

  // ----- coda seriale: le mutazioni (e i cambi di progetto) non si accavallano
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.then(() => {}, () => {});
    return run;
  };

  async function projectName() {
    if (state.meta.projectName) return state.meta.projectName;
    try {
      const env = await bridge.getEnv();
      state.meta.projectName = env.projectName || 'senza-nome';
      state.meta.projectKey = `${env.projectName}|${env.projectId ?? ''}`;
      if (env.timelineFps) state.meta.timelineFps = env.timelineFps;
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

  // Progetto corrente; senza script se ne crea uno vuoto (si possono caricare le clip prima della sceneggiatura).
  function ensureProject() {
    if (!state.project) state.setProject(sync.createProject(EMPTY_DOC()));
    return state.project;
  }

  // Esegue una mutazione, poi salva e notifica.
  // Atomica: se fn lancia il progetto torna com'era (ripristino in place) e la cronologia non cambia.
  function mutate(fn, { create = false } = {}) {
    return serial(async () => {
      const p = create ? ensureProject() : state.need();
      const before = structuredClone(p);
      let result;
      try {
        result = await fn(p);
      } catch (e) {
        for (const k of Object.keys(p)) delete p[k];
        Object.assign(p, before);
        throw e;
      }
      history.push(before);
      await autosave();
      notify(state.snapshot());
      return result;
    });
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

  // ----- ambiente e cambio di progetto
  h.getEnv = async () => {
    const env = await bridge.getEnv();
    if (env.timelineFps) state.meta.timelineFps = env.timelineFps;
    return env;
  };

  // Se in Resolve e' stato aperto un altro progetto, salva quello vecchio e carica il sidecar del nuovo.
  h.checkProject = () => serial(async () => {
    const env = await bridge.getEnv();
    if (env.timelineFps) state.meta.timelineFps = env.timelineFps;
    const key = `${env.projectName}|${env.projectId ?? ''}`;
    if (!env.projectName || state.meta.projectKey === key) return { changed: false, env };
    const first = state.meta.projectKey === null;
    if (!first) await autosave();
    state.meta.projectKey = key;
    state.meta.projectName = env.projectName;
    bridge.forgetItems?.();
    transcripts.clear();
    history.clear();
    let loaded = false;
    state.setProject(null);
    if (persist) {
      try {
        const text = await persist.load(env.projectName);
        if (text != null) { state.setProject(sync.deserialize(text)); loaded = true; }
      } catch (e) { state.meta.loadError = e.message; }
    }
    notify(state.snapshot());
    return { changed: !first, loaded, env };
  });

  // ----- script
  h.pickScriptFile = async () => (pickFile ? pickFile() : null);

  async function parseScript(path) {
    if (typeof path !== 'string' || !path) throw new Error('Percorso dello script mancante');
    const ext = path.toLowerCase().split('.').pop();
    if (ext !== 'fdx' && ext !== 'pdf') throw new Error('Formato non supportato: usa un file .fdx (Final Draft) o .pdf');
    const raw = await readFile(path);
    if (ext === 'fdx') return core.parseFdx(typeof raw === 'string' ? raw : raw.toString('utf8'));
    return core.parsePdf(raw);
  }

  // Carica lo script. Se c'era gia' uno script con lavoro sopra, il nuovo e' trattato come REVISIONE: le righe
  // uguali o modificate conservano ancore, scelte, note e valutazioni; quelle tolte le perdono (report in `revision`).
  h.loadScript = async (path, { fresh = false } = {}) => {
    const doc = await parseScript(path);
    const { warnings = [], confidence = null, ...scriptDoc } = doc;
    return serial(async () => {
      const prev = state.project;
      let revision = null;
      if (prev && prev.scriptDoc.lines.length && !fresh && core.diffRevision) {
        const before = structuredClone(prev);
        const diff = core.diffRevision(prev.scriptDoc, scriptDoc);
        const r = core.applyRevision(prev, scriptDoc, diff);
        revision = { ...diff.stats, ...r };
        history.push(before);
        state.setProject(prev, { warnings, confidence });
      } else {
        const project = sync.createProject(scriptDoc);
        if (prev) { // si tengono clip, take (con valutazioni e inquadrature), gruppi
          for (const [id, c] of Object.entries(prev.clips)) project.clips[id] = { ...c };
          for (const t of prev.takes) project.takes.push(structuredClone(t));
          project.gradePalette = [...(prev.gradePalette || project.gradePalette)];
          for (const [k, m] of Object.entries(prev.marks || {})) if (!k.includes('|')) project.marks[k] = m;
          const takeIds = new Set(prev.takes.map((t) => t.id));
          for (const [k, v] of Object.entries(prev.notes || {})) if (takeIds.has(k)) project.notes[k] = v;
          if (prev.board) project.board = { items: prev.board.items.map((i) => ({ ...i, lineId: null })), links: [...prev.board.links] };
        }
        state.setProject(project, { warnings, confidence });
        history.clear();
      }
      await autosave();
      notify(state.snapshot());
      return { scriptDoc: state.project.scriptDoc, warnings, confidence, revision };
    });
  };

  // Modalita' documentario: le trascrizioni dei take diventano il copione (con ancore esatte).
  h.scriptFromTranscripts = async ({ takeIds } = {}) => {
    const p = ensureProject();
    const ids = takeIds?.length ? takeIds : p.takes.map((t) => t.id);
    const entries = [];
    const missing = [];
    for (const id of ids) {
      const t = takeOrThrow(p, id);
      const doc = await transcriptOf(t.clipId);
      if (!doc || !doc.words.length) { missing.push(id); continue; }
      entries.push({ takeId: id, name: p.clips[t.clipId]?.name || t.label, transcript: doc });
    }
    if (!entries.length) throw new Error('Nessuna clip ha una trascrizione: trascrivile prima (pulsante "Trascrivi")');
    const { scriptDoc, anchors } = core.scriptFromTranscripts(entries, { title: 'Trascrizioni' });
    return serial(async () => {
      const prev = state.project;
      const before = prev ? structuredClone(prev) : null;
      const project = sync.createProject(scriptDoc);
      if (prev) {
        for (const [id, c] of Object.entries(prev.clips)) project.clips[id] = { ...c };
        for (const t of prev.takes) project.takes.push(structuredClone(t));
      }
      for (const a of anchors) sync.addAnchor(project, a);
      state.setProject(project, { warnings: [] });
      if (before && before.scriptDoc.lines.length) history.push(before); else history.clear();
      await autosave();
      notify(state.snapshot());
      return { lines: scriptDoc.lines.length, takes: entries.length, missing };
    });
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

  // Stato delle clip di tutti i take (trascritta? ancora nel Media Pool?): [{clipId, takeId, online, transcribed}].
  h.takeStatus = async () => {
    const p = state.project;
    if (!p || !p.takes.length) return [];
    const st = await bridge.clipStatus(p.takes.map((t) => t.clipId));
    return p.takes.map((t) => ({ takeId: t.id, clipId: t.clipId, ...(st[t.clipId] || { online: false, transcribed: false }) }));
  };

  h.addTake = async ({ clipId, label } = {}) => {
    if (!clipId) throw new Error('clipId mancante');
    const info = await bridge.getClip(clipId);
    if (!info) throw new Error('Clip non trovata nel Media Pool');
    if (!(info.fps > 0) || !(info.durationFrames > 0)) throw new Error(`Della clip "${info.name}" non si leggono fps o durata (clip offline?)`);
    return mutate(async (p) => {
      const existing = p.takes.find((t) => t.clipId === clipId);
      if (existing) return { takeId: existing.id, existed: true };
      sync.addClip(p, clipId, { fps: info.fps, durationFrames: info.durationFrames, startTcFrames: info.startTcFrames, name: info.name });
      const take = sync.addTake(p, { clipId, label: label || undefined });
      return { takeId: take.id };
    }, { create: true });
  };

  h.removeTake = (takeId) => mutate(async (p) => {
    const t = takeOrThrow(p, takeId);
    p.takes = p.takes.filter((x) => x.id !== takeId);
    p.anchors = p.anchors.filter((a) => a.takeId !== takeId);
    for (const [l, tk] of Object.entries(p.selection)) if (tk === takeId) delete p.selection[l];
    delete p.notes[takeId];
    for (const k of Object.keys(p.marks || {})) if (k.startsWith(`${takeId}|`)) delete p.marks[k];
    if (p.sequence) p.sequence.items = p.sequence.items.filter((i) => i.takeId !== takeId);
    if (p.board) {
      const gone = new Set(p.board.items.filter((i) => i.takeId === takeId).map((i) => i.id));
      p.board.items = p.board.items.filter((i) => !gone.has(i.id));
      p.board.links = p.board.links.filter((l) => !gone.has(l.from) && !gone.has(l.to));
    }
    if (!p.takes.some((x) => x.clipId === t.clipId)) delete p.clips[t.clipId];
    return true;
  });

  h.transcribeClips = async (clipIds) => {
    if (!Array.isArray(clipIds) || clipIds.length === 0) throw new Error('Nessuna clip da trascrivere');
    const r = await bridge.transcribe(clipIds);
    for (const id of r.started) transcripts.delete(id);
    return { started: r.started, failed: r.failed };
  };
  h.getTranscribeStatus = () => bridge.status();

  // TranscriptDoc della clip (cache). null se la clip non e' trascritta.
  async function transcriptOf(clipId, { refresh = false } = {}) {
    if (!refresh && transcripts.has(clipId)) return transcripts.get(clipId);
    const p = state.project;
    const clip = p?.clips?.[clipId];
    const raw = await bridge.getTranscription(clipId);
    if (!raw) return null;
    const info = clip || (await bridge.getClip(clipId));
    const doc = core.parseResolveTranscript(raw, { clipId, fps: info.fps, startTcFrames: info.startTcFrames });
    transcripts.set(clipId, doc);
    return doc;
  }

  h.autoSync = async (takeId) => {
    const p0 = state.need();
    const take0 = takeOrThrow(p0, takeId);
    const transcript = await transcriptOf(take0.clipId, { refresh: true });
    if (!transcript) throw new Error('La clip non ha ancora una trascrizione: premi "Trascrivi" e attendi la fine');
    if (transcript.words.length === 0) throw new Error('La trascrizione non contiene parole (clip muta o solo rumore): usa le ancore manuali dal lettore');
    return mutate(async (p) => {
      if (!p.scriptDoc.lines.some((l) => l.type === 'dialogue')) {
        return { added: 0, skipped: 0, unmatchedCount: transcript.words.length, language: transcript.language, mute: true };
      }
      const result = core.alignClip(p.scriptDoc, transcript);
      const { added, skipped } = sync.fromAlignment(p, takeId, result);
      return { added: added.length, skipped: skipped.length, unmatchedCount: (result.unmatched || []).length, language: transcript.language };
    });
  };

  // Parole della trascrizione per il lettore (karaoke) e la ricerca: [{text,startFrame,endFrame}].
  h.getTranscript = async ({ takeId, refresh = false } = {}) => {
    const p = state.need();
    const t = takeOrThrow(p, takeId);
    const doc = await transcriptOf(t.clipId, { refresh });
    if (!doc) return { ok: false, reason: 'clip non trascritta' };
    return { ok: true, language: doc.language, words: doc.words.map((w) => ({ text: w.text, startFrame: w.startFrame, endFrame: w.endFrame, speaker: w.speaker })) };
  };

  // "Cerca nel parlato" su tutte le trascrizioni dei take (anche senza sceneggiatura).
  h.searchSpeech = async ({ query, takeIds, limit = 60 } = {}) => {
    const p = state.need();
    if (!String(query || '').trim()) return { hits: [], searched: 0, untranscribed: 0 };
    const docs = [];
    let untranscribed = 0;
    for (const t of p.takes) {
      if (takeIds?.length && !takeIds.includes(t.id)) continue;
      let doc = null;
      try { doc = await transcriptOf(t.clipId); } catch { doc = null; }
      if (doc) docs.push({ takeId: t.id, words: doc.words }); else untranscribed++;
    }
    const hits = core.searchTranscripts(docs, query, { limit });
    for (const x of hits) {
      const line = sync.lineAtFrame(p, x.takeId, x.startFrame);
      x.lineId = line ? line.lineId : null;
    }
    return { hits, searched: docs.length, untranscribed };
  };

  // ----- ancore manuali
  h.addAnchor = ({ takeId, lineId, edge, frame } = {}) => mutate(async (p) => {
    takeOrThrow(p, takeId); lineOrThrow(p, lineId);
    if (!Number.isFinite(frame)) throw new Error('Frame mancante');
    const clip = p.clips[sync.getTake(p, takeId).clipId];
    const f = Math.min(Math.max(0, Math.round(frame)), clip.durationFrames);
    return { anchorId: sync.addAnchor(p, { takeId, lineId, edge, frame: f, kind: 'manual' }).id, frame: f };
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
    await mutate(async (q) => sync.addAnchor(q, { takeId, lineId, edge, frame, kind: 'manual' }));
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
  h.loadProject = () => serial(async () => {
    if (!persist) return { loaded: false, ...state.snapshot() };
    const text = await persist.load(await projectName());
    if (text == null) return { loaded: false, ...state.snapshot() };
    state.setProject(sync.deserialize(text)); // migra v1->v2; lancia "Progetto non valido: ..." se corrotto
    history.clear();
    notify(state.snapshot());
    return { loaded: true, ...state.snapshot() };
  });

  // ----- azioni su Resolve
  h.previewLine = async ({ lineId, takeId } = {}) => {
    const p = state.need();
    const take = takeOrThrow(p, takeId); lineOrThrow(p, lineId);
    const cov = sync.coverageForTake(p, takeId).find((c) => c.lineId === lineId);
    if (!cov) return { ok: false, reason: 'la riga non e\' coperta in questo take' };
    return bridge.previewLine(take.clipId, cov.startFrame, cov.endFrame);
  };
  // "Mostra in Resolve": seleziona la clip nel Media Pool con In/Out sull'intervallo dato (fine esclusa).
  h.revealInResolve = async ({ takeId, startFrame, endFrame } = {}) => {
    const p = state.need();
    const take = takeOrThrow(p, takeId);
    const dur = p.clips[take.clipId].durationFrames;
    const s = Math.max(0, Math.round(startFrame ?? 0));
    const e = Math.min(dur, Math.max(s + 1, Math.round(endFrame ?? dur)));
    return bridge.previewLine(take.clipId, s, e);
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
        note: line && SYNC_TYPES.has(line.type) ? `${line.character ? `${line.character}: ` : ''}${line.text}`.slice(0, 200) : '', duration: 1,
        customData: `ce:${a.lineId}:${a.edge}`,
      };
    });
    const r = await bridge.writeMarkers(take.clipId, markers);
    return { ok: r.ok, count: r.count, ...(r.reason ? { reason: r.reason } : {}), ...(r.failed?.length ? { failed: r.failed } : {}) };
  };

  // Valutazioni/inquadrature nel Media Pool di Resolve (opt-in, non distruttivo). opts: {takeIds?, keywords, clipColor, flags, overwriteColor}
  const SHOT_KW = { totale: 'Totale', medio: 'Medio', stretto: 'Stretto', dettaglio: 'Dettaglio', altro: 'Altro' };
  h.writeToResolve = async ({ takeIds, keywords = true, clipColor = false, flags = false, overwriteColor = false } = {}) => {
    const p = state.need();
    const list = p.takes.filter((t) => !takeIds?.length || takeIds.includes(t.id));
    const results = [];
    for (const t of list) {
      const kw = [];
      if (t.rating === 'buono') kw.push('Buono');
      if (t.rating === 'scarto') kw.push('Scarto');
      if (t.grade) kw.push(t.grade);
      if (t.shot && SHOT_KW[t.shot]) kw.push(SHOT_KW[t.shot]);
      for (const tag of t.tags || []) kw.push(tag);
      const color = t.rating === 'buono' ? 'Green' : t.rating === 'scarto' ? 'Orange' : null;
      const r = await bridge.writeClipMeta(t.clipId, {
        keywords: keywords ? kw : null, clipColor: clipColor ? color : null, flag: flags && t.rating === 'buono' ? 'Green' : null, overwriteColor,
      });
      results.push({ takeId: t.id, ...r });
    }
    return { ok: results.every((r) => r.ok), count: results.length, results };
  };

  // ----- timeline di Resolve: indicatori "gia' usato", segui il playhead, vai alla riga
  // usedLines: {lineId: [takeId]} = righe la cui copertura (nel take) cade in un pezzo montato nella timeline corrente.
  h.timelineUsage = async () => {
    const p = state.project;
    const u = await bridge.timelineUsage();
    if (!u.ok) return { ok: false, reason: u.reason, usedLines: {}, usedTakes: {} };
    const usedLines = {}; const usedTakes = {};
    if (p) {
      const byClip = new Map();
      for (const t of p.takes) { if (!byClip.has(t.clipId)) byClip.set(t.clipId, []); byClip.get(t.clipId).push(t); }
      for (const it of u.items) {
        for (const t of byClip.get(it.clipId) || []) {
          usedTakes[t.id] = (usedTakes[t.id] || 0) + 1;
          for (const c of sync.coverageForTake(p, t.id)) {
            const overlap = Math.min(c.endFrame, it.srcEnd) - Math.max(c.startFrame, it.srcStart);
            if (overlap > 0 && overlap >= Math.min(12, (c.endFrame - c.startFrame) / 2)) {
              (usedLines[c.lineId] ||= []);
              if (!usedLines[c.lineId].includes(t.id)) usedLines[c.lineId].push(t.id);
            }
          }
        }
      }
    }
    return { ok: true, timelineName: u.timelineName, items: u.items.length, usedLines, usedTakes };
  };

  h.timelinePlayhead = async () => {
    const p = state.project;
    const r = await bridge.timelinePlayhead();
    if (!r.ok) return r;
    const out = { ok: true, timecode: r.timecode, takeId: null, frame: r.srcFrame, lineId: null };
    if (p && r.clipId) {
      const t = p.takes.find((x) => x.clipId === r.clipId);
      if (t) {
        out.takeId = t.id;
        const c = sync.lineAtFrame(p, t.id, r.srcFrame);
        out.lineId = c ? c.lineId : null;
      }
    }
    return out;
  };

  // Porta il playhead della timeline sulla riga (o sul frame) di un take, se e' montato nella timeline corrente.
  h.seekTimeline = async ({ takeId, lineId, frame } = {}) => {
    const p = state.need();
    const t = takeOrThrow(p, takeId);
    let f = frame;
    if (lineId) {
      const c = sync.coverageForTake(p, takeId).find((x) => x.lineId === lineId);
      if (!c) return { ok: false, reason: 'la riga non e\' coperta in questo take' };
      f = c.startFrame;
    }
    if (!Number.isFinite(f)) return { ok: false, reason: 'frame mancante' };
    return bridge.seekTimeline(t.clipId, Math.round(f));
  };

  // ----- estensioni v2: bin, gruppi, still, piano di montaggio
  h.listBins = () => bridge.listBins();

  // Carica i bin e registra ogni clip come take (una sola volta per clip). Ritorna le clip con bin/meta/takeId.
  h.loadBins = async (names) => {
    if (!Array.isArray(names) || names.length === 0) throw new Error('Nessun bin selezionato');
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
          take = sync.addTake(p, { clipId: c.clipId, bin: c.bin });
        }
        take.bin = c.bin;
        take.meta = { scene: c.meta.scene, shot: c.meta.shot, take: c.meta.take, camera: c.meta.camera };
        if (c.meta.shotType) take.meta.shotType = c.meta.shotType;
        if (c.meta.angle && !take.angle) take.angle = c.meta.angle;
        // Tipo di inquadratura dai metadati (o dal nome file): mai sopra una scelta manuale/di copertura gia' fatta.
        if (!take.shot || take.shotSource === 'metadati') {
          const s = sync.suggestShotFromMetadata({ shotType: c.meta.shotType, shot: c.meta.shot, angle: c.meta.angle, name: c.name });
          if (s) sync.setTakeShot(p, take.id, s.shot, 'metadati');
        }
        out.push({ ...c, takeId: take.id });
      }
      return out;
    }, { create: true });
  };

  // Euristiche sui take registrati; non modifica il progetto (la UI conferma poi con setTakeGroup).
  h.detectGroups = async () => {
    const p = state.need();
    const descr = [];
    for (const t of p.takes) {
      const clip = p.clips[t.clipId] || {};
      descr.push({ id: t.id, name: clip.name || t.clipId, fps: clip.fps, durationFrames: clip.durationFrames, startTcFrames: clip.startTcFrames, meta: { ...(t.meta || {}), angle: t.angle ?? null } });
    }
    const groups = await bridge.detectGroups(descr);
    return groups.map(({ groupId, label, ids, reason, angles }) => ({ groupId, label, takeIds: ids, reason, angles }));
  };

  // Proposte per copertura (take dello stesso bin che coprono le stesse righe), unite a quelle per metadati/nome
  // senza duplicati. Ogni proposta: { groupId, label, takeIds, reason, source:'metadati'|'copertura', confidence?, master }.
  h.detectGroupsByCoverage = async (opts = {}) => {
    const p = state.need();
    let meta = [];
    try { meta = (await h.detectGroups()).filter((g) => g.takeIds.every((id) => !sync.getTake(p, id)?.groupId)); } catch { meta = []; }
    meta = meta.map((g) => ({ ...g, source: 'metadati' }));
    const used = new Set(meta.flatMap((g) => g.takeIds));
    const cov = sync.detectGroupsByCoverage(p, { ...opts, excludeTakeIds: [...used], usedGroupIds: meta.map((g) => g.groupId) })
      .map((g) => ({ ...g, label: `Copertura ${g.takeIds.map((id) => sync.getTake(p, id)?.label || id).join(' + ')}`, source: 'copertura' }));
    return sync.mergeGroupProposals(meta, cov).map((g) => ({ ...g, master: sync.suggestMasterAmong(p, g.takeIds) }));
  };

  h.suggestMaster = async (groupId) => {
    const p = state.need();
    if (!groupId || !p.takes.some((t) => t.groupId === groupId)) throw new Error(`Gruppo sconosciuto: ${groupId}`);
    return { ...sync.suggestMaster(p, groupId), hypotheses: sync.suggestGroupShots(p, groupId) };
  };

  // shot null = azzera. `source` opzionale ('manuale' di default; 'copertura'/'metadati' per proposte confermate).
  h.setTakeShot = ({ takeId, shot, source } = {}) => mutate(async (p) => { sync.setTakeShot(p, takeId, shot ?? null, source ?? 'manuale'); return true; });

  h.setTakeGroup = (takeId, groupId, angle) => mutate(async (p) => { sync.setTakeGroup(p, takeId, groupId, angle ?? null); return true; });

  // Etichetta del take (nome breve mostrato ovunque). Vuota = torna al nome predefinito.
  h.setTakeLabel = (takeId, label) => mutate(async (p) => { const t = takeOrThrow(p, takeId); t.label = String(label || '').trim().slice(0, 40) || t.id; return true; });

  // ----- spoglio, undo/redo, valutazione
  h.editScript = async (edit) => {
    await mutate(async (p) => core.applyScriptEdit(p, edit));
    return state.snapshot();
  };

  function swap(dir) {
    return serial(async () => {
      const p = state.need();
      const can = dir === 'undo' ? history.canUndo() : history.canRedo();
      const next = can ? history[dir](p) : null;
      if (!next) return { ok: false, reason: dir === 'undo' ? 'niente da annullare' : 'niente da ripetere', ...state.snapshot() };
      state.meta.project = next;
      await autosave();
      notify(state.snapshot());
      return { ok: true, ...state.snapshot() };
    });
  }
  h.undo = () => swap('undo');
  h.redo = () => swap('redo');

  h.setMark = ({ takeId, lineId = null, ...patch } = {}) => mutate(async (p) => { sync.setMark(p, takeId, lineId ?? null, patch); return true; });
  h.setGradePalette = (list) => mutate(async (p) => sync.setGradePalette(p, list));

  h.getClipMediaPath = async (takeId) => {
    const take = takeOrThrow(state.need(), takeId);
    const r = await mediaUrls(take.clipId);
    if (!r.ok) return { ok: false, reason: r.reason };
    return r;
  };

  // ----- lavagna (modello core/src/board). Still = marker Resolve 'ce:still:<id>' + item; nessun file.
  const B = () => core.board;
  const Q = () => core.sequence;
  const clampFrame = (p, take, frame) => Math.min(Math.max(0, Math.round(frame)), Math.max(0, p.clips[take.clipId].durationFrames - 1));

  h['board.addStill'] = ({ takeId, frame, lineId = null } = {}) => mutate(async (p) => {
    const take = takeOrThrow(p, takeId);
    if (!Number.isFinite(frame)) throw new Error('Frame mancante');
    const it = B().addStill(p, { takeId, frame: clampFrame(p, take, frame), lineId, ...boardSlot(p) });
    const r = await bridge.addStillMarker(take.clipId, it.frame, it.id);
    return { ok: true, itemId: it.id, markerWritten: r.ok, ...(r.ok ? {} : { reason: r.reason }) };
  });
  // posizione iniziale a griglia (4 colonne) in base agli item gia' presenti
  function boardSlot(p) {
    const n = (p.board?.items || []).length;
    return { x: (n % 4) * 170, y: Math.floor(n / 4) * 100 };
  }

  h['board.addItem'] = (item = {}) => mutate(async (p) => {
    // Con `id` di un elemento esistente (nota o still) aggiorna i campi modificabili invece di crearne uno nuovo.
    if (item.id) {
      const it = ((p.board && p.board.items) || []).find((x) => x.id === item.id);
      if (!it) throw new Error(`Elemento della lavagna sconosciuto "${item.id}"`);
      if (item.lineId !== undefined) {
        if (item.lineId !== null && !p.scriptDoc.lines.some((l) => l.id === item.lineId)) throw new Error(`Riga sconosciuta "${item.lineId}"`);
        it.lineId = item.lineId;
      }
      for (const k of ['color', 'caption']) if (item[k] !== undefined) it[k] = item[k];
      for (const k of ['x', 'y', 'w', 'h']) if (Number.isFinite(item[k])) it[k] = item[k];
      return { itemId: it.id };
    }
    if (item.type === 'still') throw new Error('Per gli still usa board.addStill');
    const { type, ...rest } = item;
    return { itemId: B().addNote(p, { ...boardSlot(p), ...rest }).id };
  });
  h['board.moveItem'] = (id, pos) => mutate(async (p) => { B().moveItem(p, id, pos); return true; });
  h['board.resizeItem'] = (id, size) => mutate(async (p) => { B().resizeItem(p, id, size); return true; });
  h['board.setCaption'] = (id, text) => mutate(async (p) => { B().setCaption(p, id, text); return true; });
  h['board.bringToFront'] = (id) => mutate(async (p) => { B().bringToFront(p, id); return true; });
  h['board.link'] = (from, to) => mutate(async (p) => { B().linkItems(p, from, to); return true; });

  h['board.removeItem'] = (id) => mutate(async (p) => {
    const it = B().removeItem(p, id);
    let marker = null;
    if (it.type === 'still' && it.takeId) {
      const take = sync.getTake(p, it.takeId);
      if (take) marker = await bridge.removeStillMarker(take.clipId, id);
    }
    return { ok: true, markerRemoved: marker ? marker.ok : null, ...(marker && !marker.ok ? { reason: marker.reason } : {}) };
  });

  h['board.toSequence'] = ({ order = 'x', ids, holdFrames } = {}) => mutate(async (p) => {
    const opts = { order, ids };
    if (holdFrames !== undefined) opts.holdFrames = Math.round(holdFrames);
    return { items: B().boardToSequence(p, opts).items.length };
  });

  // Esplicito e opzionale: esporta il frame con ExportFrame e lo salva come imagePath dello still.
  h['board.refreshStillViaResolve'] = (id) => mutate(async (p) => {
    const it = (p.board?.items || []).find((x) => x.id === id && x.type === 'still');
    if (!it) throw new Error(`Still sconosciuto: ${id}`);
    const take = takeOrThrow(p, it.takeId);
    const dir = typeof stillsDir === 'function' ? await stillsDir() : stillsDir;
    if (!dir) return { ok: false, via: 'none', reason: 'cartella degli still non configurata' };
    if (mkdir) { try { await mkdir(dir); } catch (e) { return { ok: false, via: 'none', reason: `cartella degli still non creabile: ${e.message}` }; } }
    const r = await bridge.exportStill(take.clipId, it.frame, dir);
    if (r.ok) it.imagePath = r.path;
    return r;
  });

  // ----- sequenza (modello master V1 + cutaway V2..) ed editor
  const so = () => state.seqOpts(state.need());
  h['sequence.fromLines'] = (lineIds, opts = {}) => mutate(async (p) => {
    if (!Array.isArray(lineIds) || lineIds.length === 0) throw new Error('Nessuna riga da montare');
    const { sequence, skipped } = Q().sequenceFromLinesDetailed(p, lineIds, opts);
    return { itemCount: sequence.items.length, skipped };
  });
  h['sequence.addItem'] = (spec) => mutate(async (p) => Q().addItem(p, spec));
  h['sequence.moveItem'] = (id, pos) => mutate(async (p) => Q().moveItem(p, id, pos));
  h['sequence.trimItem'] = (id, range) => mutate(async (p) => Q().trimItem(p, id, range));
  h['sequence.removeItem'] = (id) => mutate(async (p) => { Q().deleteItem(p, id, so()); return true; });
  h['sequence.clear'] = () => mutate(async (p) => { Q().ensureSequence(p).items = []; return true; });
  // editor: lama, inserisci/sovrascrivi, sposta, accorcia (tempi in frame di timeline relativi alla sequenza)
  h['sequence.split'] = (id, atRecord) => mutate(async (p) => { const r = Q().splitItem(p, id, atRecord, so()); return { leftId: r.left.id, rightId: r.right.id }; });
  h['sequence.place'] = (spec) => mutate(async (p) => ({ itemId: Q().placeClip(p, spec, so()).id }));
  h['sequence.move'] = (id, pos) => mutate(async (p) => ({ itemId: Q().moveClip(p, id, pos, so()).id }));
  h['sequence.trimEdge'] = (id, edge, delta) => mutate(async (p) => { Q().trimEdge(p, id, edge, delta, so()); return true; });

  // Master = un solo take continuo sulle righe date (sostituisce la sequenza). Servono le coperture del take.
  h['sequence.setMaster'] = ({ takeId, lineIds } = {}) => mutate(async (p) => {
    takeOrThrow(p, takeId);
    if (!Array.isArray(lineIds) || lineIds.length === 0) throw new Error('Nessuna riga per il master');
    const cov = sync.coverageForTake(p, takeId);
    const picked = lineIds.map((l) => cov.find((x) => x.lineId === l)).filter(Boolean);
    if (!picked.length) throw new Error(`il take "${takeId}" non copre nessuna delle righe scelte`);
    const lineStarts = Object.fromEntries(picked.map((c) => [c.lineId, c.startFrame]));
    const seq = Q().ensureSequence(p);
    seq.items = [];
    return Q().addItem(p, {
      kind: 'line', lineIds: picked.map((c) => c.lineId), takeId, role: 'master', track: 1, lineStarts,
      startFrame: Math.min(...picked.map((c) => c.startFrame)), endFrame: Math.max(...picked.map((c) => c.endFrame)),
    });
  });
  h['sequence.addCutaway'] = (spec) => mutate(async (p) => Q().addCutaway(p, null, spec));
  h['sequence.trimCutaway'] = (itemId, patch) => mutate(async (p) => Q().trimCutaway(p, null, itemId, patch));

  // Manda la sequenza in Resolve. mode 'new' = timeline nuova; 'append' = in coda alla timeline aperta.
  // lineMarkers: marker blu sulla timeline all'inizio di ogni riga dello script (customData 'ce:line:<id>').
  h['sequence.assemble'] = async ({ plan, timelineName, withAudio = true, mode = 'new', lineMarkers = true } = {}) => {
    const p = state.project;
    let steps = plan;
    const extraSkipped = [];
    let markers = [];
    if (!Array.isArray(plan)) {
      const seq = state.need().sequence;
      if (!seq || !seq.items.length) throw new Error('Sequenza vuota: costruiscila prima di montare');
      try { const env = await bridge.getEnv(); if (env.timelineFps) state.meta.timelineFps = env.timelineFps; } catch { /* fps del progetto non letto */ }
      const o = state.seqOpts(p);
      const d = Q().toAppendPlanDetailed(seq, { startFrame: 0, withAudio, ...o });
      steps = d.plan;
      for (const s of d.skipped) extraSkipped.push({ clipId: seq.items.find((i) => i.id === s.itemId)?.clipId, reason: 'cutaway su righe che non sono nel master' });
      if (lineMarkers) {
        markers = Q().lineMarkers(seq, o).map((m) => {
          const l = sync.getLine(p, m.lineId);
          const label = l ? `${l.character ? `${l.character}: ` : ''}${l.text}` : m.lineId;
          return { recordFrame: m.recordFrame, color: 'Blue', name: label.slice(0, 60), note: label.slice(0, 500), duration: 1, customData: `ce:line:${m.lineId}` };
        });
      }
    } else if (plan.length === 0) throw new Error('Piano di montaggio mancante o vuoto');
    const resolved = steps.map((e) => {
      if (e.clipId || !p) return e;
      const t = sync.getTake(p, e.takeId);
      return t ? { ...e, clipId: t.clipId } : e;
    });
    const r = await bridge.executeAppendPlan(resolved, { timelineName, withAudio, mode, markers });
    r.skipped = [...extraSkipped, ...(r.skipped || [])];
    notify(state.snapshot());
    return r;
  };

  // Sottotitoli dalle righe della sequenza (SRT). Ritorna il testo; con save:true chiede dove salvarlo e, con
  // importToResolve:true, prova a importarlo nel Media Pool (sperimentale: se non riesce, File > Importa > Sottotitoli).
  h['sequence.subtitles'] = async ({ save = false, importToResolve = false } = {}) => {
    const p = state.need();
    const seq = p.sequence;
    if (!seq || !seq.items.length) throw new Error('Sequenza vuota');
    const o = state.seqOpts(p);
    const lay = Q().sequenceLayout(seq, o);
    const marks = Q().lineMarkers(seq, o).filter((m) => sync.getLine(p, m.lineId)?.type === 'dialogue');
    const fps = state.meta.timelineFps || 25;
    const tc = (f) => {
      const ms = Math.round((f / fps) * 1000);
      const z = (n, w = 2) => String(n).padStart(w, '0');
      return `${z(Math.floor(ms / 3600000))}:${z(Math.floor(ms / 60000) % 60)}:${z(Math.floor(ms / 1000) % 60)},${z(ms % 1000, 3)}`;
    };
    const cues = [];
    marks.forEach((m, i) => {
      const line = sync.getLine(p, m.lineId);
      const take = m.takeId;
      const cov = sync.coverageForTake(p, take).find((c) => c.lineId === m.lineId);
      const len = cov ? Math.round((cov.endFrame - cov.startFrame) * (fps / (p.clips[sync.getTake(p, take).clipId].fps || fps))) : 2 * fps;
      const nextAt = marks[i + 1]?.recordFrame ?? lay.total;
      const end = Math.min(m.recordFrame + len, nextAt);
      if (end > m.recordFrame) cues.push(`${cues.length + 1}\n${tc(m.recordFrame)} --> ${tc(end)}\n${line.text}\n`);
    });
    const srt = cues.join('\n');
    const out = { ok: cues.length > 0, cues: cues.length, srt };
    if (!cues.length) out.reason = 'nessuna battuta nel master';
    if (save && cues.length) {
      if (!showSaveDialog || !writeBinary) throw new Error('Salvataggio file non configurato');
      const path = await showSaveDialog({ suggestedName: `${(seq.name || 'sequenza').replace(/[\\/:*?"<>|]/g, '_')}.srt`, filters: [{ name: 'Sottotitoli SRT', extensions: ['srt'] }] });
      if (!path) return { ...out, saved: null };
      await writeBinary(path, b64(srt));
      out.saved = path;
      if (importToResolve) out.imported = await bridge.importMedia([path]);
    }
    return out;
  };

  h.saveFile = async ({ suggestedName, dataBase64, filters } = {}) => {
    if (typeof dataBase64 !== 'string' || !dataBase64) throw new Error('Nessun dato da salvare');
    if (!showSaveDialog || !writeBinary) throw new Error('Salvataggio file non configurato');
    const path = await showSaveDialog({ suggestedName: suggestedName || 'esportazione', filters: filters || [] });
    if (!path) return null;
    await writeBinary(path, typeof Buffer !== 'undefined' ? Buffer.from(dataBase64, 'base64') : Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0)));
    return { path };
  };

  h.runDiagnostics = async () => {
    const report = await bridge.runDiagnostics();
    report.plugin = { version: deps.version || null, takes: state.project?.takes?.length ?? 0, lines: state.project?.scriptDoc?.lines?.length ?? 0 };
    const path = diagPath || 'continuityedit_diag.json';
    let saved = true;
    try { await writeFile(path, JSON.stringify(report, null, 2)); } catch { saved = false; }
    return { ok: report.ok, path: saved ? path : null, report };
  };

  return h;
}

// Nomi dei metodi del contratto (usati da main.js per registrare ipcMain.handle('ce:<nome>')).
const METHOD_NAMES = [
  'getEnv', 'checkProject', 'pickScriptFile', 'loadScript', 'scriptFromTranscripts', 'getSelectedClips', 'takeStatus', 'addTake', 'removeTake', 'transcribeClips',
  'getTranscribeStatus', 'autoSync', 'getTranscript', 'searchSpeech', 'addAnchor', 'moveAnchor', 'removeAnchor', 'anchorFromMarker',
  'anchorFromPlayhead', 'getState', 'setSelection', 'setNote', 'saveProject', 'loadProject', 'previewLine', 'revealInResolve',
  'assemble', 'writeMarkers', 'writeToResolve', 'timelineUsage', 'timelinePlayhead', 'seekTimeline', 'runDiagnostics',
  'listBins', 'loadBins', 'detectGroups', 'detectGroupsByCoverage', 'suggestMaster', 'setTakeShot', 'setTakeGroup', 'setTakeLabel', 'getClipMediaPath', 'board.addStill', 'board.removeItem', 'board.refreshStillViaResolve', 'saveFile',
  'editScript', 'undo', 'redo', 'setMark', 'setGradePalette',
  'sequence.fromLines', 'sequence.addItem', 'sequence.moveItem', 'sequence.trimItem', 'sequence.removeItem', 'sequence.clear',
  'sequence.split', 'sequence.place', 'sequence.move', 'sequence.trimEdge',
  'sequence.setMaster', 'sequence.addCutaway', 'sequence.trimCutaway', 'sequence.assemble', 'sequence.subtitles',
  'board.addItem', 'board.moveItem', 'board.resizeItem', 'board.setCaption', 'board.bringToFront', 'board.link', 'board.toSequence',
];

if (typeof module !== 'undefined') module.exports = { createHandlers, METHOD_NAMES };
