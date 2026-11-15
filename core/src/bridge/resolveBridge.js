// Bridge verso la API Resolve (Workflow Integration). L'oggetto `resolve` e' INIETTATO (reale o finto nei test):
// tutte le chiamate sono `await`-ate perche' nel plugin reale ogni metodo e' asincrono.
// Frame: interi relativi alla clip; intervalli con fine ESCLUSA (come AppendToTimeline).
// Le firme incerte non lanciano: restituiscono {ok:false, reason} e sono coperte da runDiagnostics().
// Cosa e' verificato sui probe di Resolve Studio 21.2 e cosa e' ipotesi: docs/RESOLVE_API_NOTES.md.

import { tcToFrames, framesToTc } from '../transcript/timecode.js';
import { detectGroups as detectGroupsPure } from './groups.js';

export const MARKER_PREFIX = 'ce:';
// Marker di sync scritti da writeMarkers: 'ce:<lineId>:<edge>'. Gli altri marker 'ce:' (still, righe, diagnostica)
// appartengono ad altre funzioni e non vanno toccati.
const SYNC_MARKER = /^ce:(?!still:|line:|diag:)[^:]+:(start|end|point)$/;
export const CE_KEYWORD_PREFIX = 'CE ';
const STATUS_GRACE_MS = 15000;
const errText = (e) => (e && e.message ? e.message : String(e));

// Esegue fn e converte le eccezioni in {ok:false, reason}.
async function attempt(fn, label) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, reason: `${label}: ${errText(e)}` };
  }
}

const isFn = (o, name) => !!o && typeof o[name] === 'function';
const num = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
};
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'True' || v === 'true';

/**
 * @param {object|Function} resolveOrGetter oggetto Resolve; con {lazy:true} una funzione async che lo restituisce
 * @param {{fileExists?:(path)=>Promise<boolean>|boolean, tmpDir?:string}} opts fileExists verifica i file esportati (still); tmpDir abilita la prova ExportFrame in diagnostica
 */
export function createBridge(resolveOrGetter, { lazy = false, fileExists = null, tmpDir = null, clock = () => Date.now() } = {}) {
  let cached = null;
  let lastStart = 0;
  const R = async () => {
    if (!lazy) return resolveOrGetter;
    if (!cached) cached = await resolveOrGetter();
    if (!cached) throw new Error('Resolve non disponibile');
    return cached;
  };

  const started = new Set(); // clipId di cui questo bridge ha avviato la trascrizione
  const itemCache = new Map(); // clipId -> MediaPoolItem (indice del Media Pool, validato a ogni uso)

  async function getProject() {
    const resolve = await R();
    const pm = await resolve.GetProjectManager();
    return pm ? pm.GetCurrentProject() : null;
  }
  async function getMediaPool() {
    const project = await getProject();
    if (!project) throw new Error('Nessun progetto aperto in Resolve');
    const mp = await project.GetMediaPool();
    if (!mp) throw new Error('Media Pool non disponibile');
    return mp;
  }
  async function getTimeline() {
    const project = await getProject();
    return project ? project.GetCurrentTimeline() : null;
  }

  // Identita' del progetto Resolve aperto: serve al main per accorgersi di un cambio di progetto a pannello aperto.
  async function projectInfo() {
    const project = await getProject();
    if (!project) return { name: null, id: null };
    const name = (await attempt(() => project.GetName(), 'GetName')).value ?? null;
    const id = isFn(project, 'GetUniqueId') ? ((await attempt(() => project.GetUniqueId(), 'GetUniqueId')).value ?? null) : null;
    return { name, id };
  }
  function forgetItems() { itemCache.clear(); started.clear(); }

  // ---------------------------------------------------------------- env
  async function getEnv() {
    const resolve = await R();
    const safe = async (fn) => { try { return await fn(); } catch { return null; } };
    const env = {
      resolveVersion: await safe(() => resolve.GetVersionString()),
      product: await safe(() => resolve.GetProductName()),
      projectName: null,
      projectId: null,
      pageName: await safe(() => resolve.GetCurrentPage()),
      timelineName: null,
      timelineFps: null,
      isStudio: false,
    };
    env.isStudio = typeof env.product === 'string' && /studio/i.test(env.product);
    const project = await safe(() => getProject());
    if (project) {
      env.projectName = await safe(() => project.GetName());
      if (isFn(project, 'GetUniqueId')) env.projectId = await safe(() => project.GetUniqueId());
      const tl = await safe(() => project.GetCurrentTimeline());
      if (tl) {
        env.timelineName = await safe(() => tl.GetName());
        const fps = (await safe(() => tl.GetSetting('timelineFrameRate')))
          ?? (await safe(() => project.GetSetting('timelineFrameRate')));
        env.timelineFps = num(fps);
      }
    }
    return env;
  }

  // ---------------------------------------------------------------- clip
  // deep:true legge anche GetTranscription() quando la proprieta' 'Transcription Status' non e' conclusiva
  // (GetTranscription restituisce l'intero testo: costoso, si evita sui bin interi).
  async function clipInfo(item, { deep = false } = {}) {
    const prop = async (k) => { try { return await item.GetClipProperty(k); } catch { return null; } };
    const clipId = await item.GetUniqueId();
    itemCache.set(clipId, item);
    const name = await item.GetName();
    const fps = num(await prop('FPS'));
    const startTc = await prop('Start TC');
    const startTcFrames = (typeof startTc === 'string' ? tcToFrames(startTc, fps, 0) : null) ?? 0;
    // Durata: 'Frames' (intero) oppure 'Duration' (timecode di durata)
    let durationFrames = num(await prop('Frames'));
    if (!(durationFrames > 0)) {
      const d = await prop('Duration');
      durationFrames = typeof d === 'string' && /[:;]/.test(d) ? tcToFrames(d, fps, 0) : num(d);
    }
    let markers = [];
    try {
      const raw = (await item.GetMarkers()) || {};
      markers = Object.entries(raw)
        .map(([f, m]) => ({
          frame: Number(f), color: m.color ?? '', name: m.name ?? '', note: m.note ?? '',
          duration: m.duration ?? 1, customData: m.customData ?? '',
        }))
        .filter((m) => Number.isInteger(m.frame))
        .sort((a, b) => a.frame - b.frame);
    } catch { /* marker non leggibili */ }
    // Verificato su 21.2: 'Transcription Status' = 'Transcribed' a trascrizione conclusa, '' altrimenti.
    const st = await prop('Transcription Status');
    const transcriptionStatus = typeof st === 'string' ? st : '';
    let transcribed = /^transcribed$/i.test(transcriptionStatus.trim());
    if (!transcribed && (deep || st === null || st === undefined)) {
      try {
        const t = await item.GetTranscription();
        transcribed = !!(t && Array.isArray(t.segments) && t.segments.length > 0);
      } catch { /* non trascritta */ }
    }
    return { clipId, name, fps, durationFrames, startTcFrames, transcribed, transcriptionStatus, markers };
  }

  async function selectedItems() {
    const mp = await getMediaPool();
    if (isFn(mp, 'GetSelectedClips')) {
      const sel = await mp.GetSelectedClips();
      if (Array.isArray(sel)) return sel;
    }
    // Fallback: clip della cartella corrente.
    const folder = await mp.GetCurrentFolder();
    const list = folder ? await folder.GetClipList() : [];
    return Array.isArray(list) ? list : [];
  }

  async function getSelectedClips() {
    const out = [];
    for (const item of await selectedItems()) out.push(await clipInfo(item));
    return out;
  }

  // Cerca un MediaPoolItem per uniqueId: indice in memoria (validato), poi una sola visita del Media Pool che
  // indicizza tutte le clip incontrate (nei progetti grandi evita una visita completa per ogni chiamata).
  async function findItem(clipId) {
    const hit = itemCache.get(clipId);
    if (hit) {
      try { if ((await hit.GetUniqueId()) === clipId) return hit; } catch { /* clip eliminata: si riindicizza */ }
      itemCache.delete(clipId);
    }
    const mp = await getMediaPool();
    let found = null;
    const walk = async (folder, depth) => {
      for (const it of (await folder.GetClipList()) || []) {
        let id = null;
        try { id = await it.GetUniqueId(); } catch { continue; }
        itemCache.set(id, it);
        if (id === clipId) found = it;
      }
      if (depth > 12) return;
      for (const sub of (await folder.GetSubFolderList()) || []) await walk(sub, depth + 1);
    };
    await walk(await mp.GetRootFolder(), 0);
    return found;
  }

  async function getClip(clipId) {
    const item = await findItem(clipId);
    return item ? clipInfo(item, { deep: true }) : null;
  }

  // ---------------------------------------------------------------- trascrizione
  async function transcribe(clipIds) {
    const done = [];
    const failed = [];
    for (const id of clipIds) {
      const item = await findItem(id);
      if (!item) { failed.push({ clipId: id, reason: 'clip non trovata nel Media Pool' }); continue; }
      const r = await attempt(() => item.TranscribeAudio(), 'TranscribeAudio');
      if (r.ok && r.value !== false) { started.add(id); done.push(id); lastStart = clock(); }
      else failed.push({ clipId: id, reason: r.reason || 'Resolve non ha avviato la trascrizione (la clip ha l\'audio?)' });
    }
    return { started: done, failed };
  }

  // Stato dei job avviati. Verificato su 21.2: lo stato e' del PROGETTO (Project.GetTranscribeAudioStatus() ->
  // {JobStatus}); MediaPoolItem non ha GetTranscribeAudioStatus. Le clip concluse si riconoscono dalla proprieta'
  // 'Transcription Status' = 'Transcribed'. Ritorna { jobStatus, done:[clipId], pending:[clipId] }.
  async function status() {
    if (started.size === 0) return { jobStatus: 'Inactive', done: [], pending: [] };
    const project = await getProject();
    let job = null;
    if (project && isFn(project, 'GetTranscribeAudioStatus')) {
      const r = await attempt(() => project.GetTranscribeAudioStatus(), 'GetTranscribeAudioStatus');
      const v = r.ok ? r.value : null;
      job = v && typeof v === 'object' ? (v.JobStatus ?? v.jobStatus ?? null) : (typeof v === 'string' ? v : null);
    }
    const done = []; const pending = [];
    for (const id of started) {
      const item = await findItem(id);
      if (!item) { done.push(id); continue; }
      let st = '';
      try { st = String((await item.GetClipProperty('Transcription Status')) ?? ''); } catch { /* proprieta' assente */ }
      (/^transcribed$/i.test(st.trim()) ? done : pending).push(id);
    }
    const finish = (jobStatus) => { started.clear(); return { jobStatus, done, pending }; };
    if (!pending.length) return finish('Complete');
    if (job === 'InProgress') return { jobStatus: 'InProgress', done, pending };
    if (job && job !== 'Complete' && job !== 'Inactive') return finish(job); // Failed, Cancelled...
    // Job concluso/inattivo ma clip non ancora segnate: subito dopo l'avvio e' normale (il job parte in ritardo);
    // dopo la tolleranza le clip restanti si considerano non trascrivibili (es. senza audio).
    if (clock() - lastStart < STATUS_GRACE_MS) return { jobStatus: 'InProgress', done, pending };
    return finish('Complete');
  }

  async function getTranscription(clipId) {
    const item = await findItem(clipId);
    if (!item) return null;
    const t = await item.GetTranscription();
    return t && Array.isArray(t.segments) ? t : null;
  }

  // ---------------------------------------------------------------- anteprima in Resolve
  // Frame relativi alla clip, fine esclusa. SetMarkInOut vuole (si assume) l'ultimo frame incluso => end-1.
  async function previewLine(clipId, startFrame, endFrame) {
    const item = await findItem(clipId);
    if (!item) return { ok: false, reason: 'clip non trovata nel Media Pool' };
    const mp = await getMediaPool();
    if (isFn(mp, 'SetSelectedClip')) {
      const r = await attempt(() => mp.SetSelectedClip(item), 'SetSelectedClip');
      if (!r.ok) return { ok: false, reason: r.reason };
      if (r.value === false) return { ok: false, reason: 'SetSelectedClip ha restituito false' };
    } else if (isFn(item, 'SetSelectedClip')) {
      const r = await attempt(() => item.SetSelectedClip(), 'SetSelectedClip');
      if (!r.ok) return { ok: false, reason: r.reason };
    } else {
      return { ok: false, reason: 'SetSelectedClip non disponibile in questa versione di Resolve' };
    }
    if (!isFn(item, 'SetMarkInOut')) return { ok: false, reason: 'SetMarkInOut non disponibile in questa versione di Resolve' };
    const m = await attempt(() => item.SetMarkInOut(startFrame, Math.max(startFrame, endFrame - 1), 'all'), 'SetMarkInOut');
    if (!m.ok) return { ok: false, reason: m.reason };
    if (m.value === false) return { ok: false, reason: 'SetMarkInOut ha restituito false' };
    return { ok: true };
  }

  // ---------------------------------------------------------------- montaggio semplice (legacy: in coda)
  /**
   * @param {{clipId,startFrame,endFrame,lineIds?}[]} cuts  fine esclusa
   * @returns {{ok, timelineName, itemsAdded, skipped:[{lineIds,reason}], reason?}}
   */
  async function assemble(cuts, timelineName) {
    const mp = await getMediaPool();
    const skipped = [];
    const infos = [];
    for (const c of cuts) {
      const item = await findItem(c.clipId);
      if (!item) { skipped.push({ lineIds: c.lineIds || [], reason: 'clip non trovata nel Media Pool' }); continue; }
      if (!(c.endFrame > c.startFrame)) { skipped.push({ lineIds: c.lineIds || [], reason: 'intervallo vuoto' }); continue; }
      infos.push({ mediaPoolItem: item, startFrame: c.startFrame, endFrame: c.endFrame });
    }
    if (infos.length === 0) return { ok: false, timelineName: null, itemsAdded: 0, skipped, reason: 'nessun taglio da montare' };
    const created = await createTimeline(mp, timelineName || 'ContinuityEdit');
    if (!created.tl) return { ok: false, timelineName: null, itemsAdded: 0, skipped, reason: 'CreateEmptyTimeline non riuscita' };
    await makeCurrent(created.tl);
    const res = await mp.AppendToTimeline(infos);
    const added = Array.isArray(res) ? res.length : (res ? infos.length : 0);
    if (!added) return { ok: false, timelineName: created.name, itemsAdded: 0, skipped, reason: 'AppendToTimeline non ha aggiunto nulla' };
    return { ok: true, timelineName: created.name, itemsAdded: added, skipped };
  }

  // CreateEmptyTimeline fallisce se il nome esiste gia': si riprova con un suffisso.
  async function createTimeline(mp, baseName) {
    for (let n = 1; n <= 30; n++) {
      const candidate = n === 1 ? baseName : `${baseName} ${n}`;
      const tl = await mp.CreateEmptyTimeline(candidate);
      if (tl) return { tl, name: candidate };
    }
    return { tl: null, name: null };
  }
  // AppendToTimeline lavora sulla timeline CORRENTE: dopo averla creata/trovata la si rende corrente.
  async function makeCurrent(tl) {
    const project = await getProject();
    if (project && isFn(project, 'SetCurrentTimeline')) {
      const r = await attempt(() => project.SetCurrentTimeline(tl), 'SetCurrentTimeline');
      return r.ok && r.value !== false ? { ok: true } : { ok: false, reason: r.reason || 'SetCurrentTimeline ha restituito false' };
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------- bin, metadati, gruppi (contratto v2)
  const META_KEYS = { scene: 'Scene', shot: 'Shot', take: 'Take', camera: 'Camera #', angle: 'Angle', shotType: 'Shot Type' };
  async function clipMeta(item) {
    const meta = {};
    for (const [k, prop] of Object.entries(META_KEYS)) {
      let v = null;
      try { v = await item.GetClipProperty(prop); } catch { /* proprieta' assente */ }
      meta[k] = v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim();
    }
    return meta;
  }

  async function folderName(folder) {
    const r = isFn(folder, 'GetName') ? await attempt(() => folder.GetName(), 'GetName') : null;
    return r && r.ok && r.value ? String(r.value) : 'Bin';
  }

  // Sottocartelle ricorsive del Media Pool (root esclusa): [{name, path, clipCount, folder}] con `folder` interno.
  async function walkBins() {
    const mp = await getMediaPool();
    const out = [];
    const walk = async (folder, prefix, depth) => {
      if (depth > 12) return;
      const subs = isFn(folder, 'GetSubFolderList') ? (await folder.GetSubFolderList()) || [] : [];
      for (const sub of subs) {
        const name = await folderName(sub);
        const path = prefix ? `${prefix}/${name}` : name;
        const clips = isFn(sub, 'GetClipList') ? (await sub.GetClipList()) || [] : [];
        out.push({ name, path, clipCount: clips.length, folder: sub });
        await walk(sub, path, depth + 1);
      }
    };
    await walk(await mp.GetRootFolder(), '', 0);
    return out;
  }

  async function listBins() {
    return (await walkBins()).map(({ name, path, clipCount }) => ({ name, path, clipCount }));
  }

  // names: nomi o percorsi dei bin. Ritorna {clips:[clipInfo + bin + binPath + meta], missing:[nome]}.
  async function loadBins(names) {
    const bins = await walkBins();
    const clips = [];
    const missing = [];
    const seen = new Set();
    for (const wanted of names || []) {
      const hit = bins.filter((b) => b.path === wanted);
      const matches = hit.length ? hit : bins.filter((b) => b.name === wanted);
      if (!matches.length) { missing.push(wanted); continue; }
      for (const b of matches) {
        const list = isFn(b.folder, 'GetClipList') ? (await b.folder.GetClipList()) || [] : [];
        for (const item of list) {
          const info = await clipInfo(item);
          if (seen.has(info.clipId)) continue;
          seen.add(info.clipId);
          clips.push({ ...info, bin: b.name, binPath: b.path, meta: await clipMeta(item) });
        }
      }
    }
    return { clips, missing };
  }

  // clips: [{id,name,fps,durationFrames,startTcFrames,meta}] -> gruppi (vedi groups.js)
  async function detectGroups(clips) {
    return detectGroupsPure(clips || []);
  }

  async function getClipMediaPath(clipId) {
    const item = await findItem(clipId);
    if (!item) return { ok: false, reason: 'clip non trovata nel Media Pool' };
    const prop = async (k) => { try { const v = await item.GetClipProperty(k); return v === undefined || v === '' ? null : v; } catch { return null; } };
    const path = await prop('File Path');
    if (!path) return { ok: false, reason: 'questa clip non ha un file sul disco leggibile (clip generata, composita o offline)' };
    const proxy = await prop('Proxy Media Path');
    const tc = await prop('Start TC');
    const fps = num(await prop('FPS'));
    return {
      ok: true, path: String(path), proxyPath: proxy ? String(proxy) : null, codec: await prop('Video Codec'), fps,
      startTcFrames: typeof tc === 'string' ? (tcToFrames(tc, fps, 0) ?? 0) : 0,
    };
  }

  // Still = marker Cyan sulla clip (nessun file). customData 'ce:still:<itemId>'. Un marker gia' presente sul frame => ok:false.
  async function addStillMarker(clipId, frame, itemId) {
    const item = await findItem(clipId);
    if (!item) return { ok: false, reason: 'clip non trovata nel Media Pool' };
    const r = await attempt(() => item.AddMarker(Math.round(frame), 'Cyan', 'Still', '', 1, `${MARKER_PREFIX}still:${itemId}`), 'AddMarker');
    if (!r.ok) return { ok: false, reason: r.reason };
    if (r.value === false) return { ok: false, reason: 'AddMarker ha restituito false (esiste gia\' un marker su quel frame?)' };
    return { ok: true };
  }

  // Toglie il marker dello still: DeleteMarkerByCustomData, altrimenti ricerca per customData + DeleteMarkerAtFrame.
  async function removeStillMarker(clipId, itemId) {
    const item = await findItem(clipId);
    if (!item) return { ok: false, reason: 'clip non trovata nel Media Pool' };
    const tag = `${MARKER_PREFIX}still:${itemId}`;
    if (isFn(item, 'DeleteMarkerByCustomData')) {
      const r = await attempt(() => item.DeleteMarkerByCustomData(tag), 'DeleteMarkerByCustomData');
      if (r.ok && r.value !== false) return { ok: true };
    }
    const m = await attempt(async () => {
      for (const [f, mk] of Object.entries((await item.GetMarkers()) || {})) {
        if (mk.customData === tag) return item.DeleteMarkerAtFrame(Number(f));
      }
      return false;
    }, 'DeleteMarkerAtFrame');
    return m.ok && m.value ? { ok: true } : { ok: false, reason: m.reason || 'marker dello still non trovato' };
  }

  // Primo tentativo: MediaPoolItem.ExportFrame(frame, percorso). Firma non verificata: niente eccezioni.
  // Se fallisce, {ok:false, via:'none', reason}: la UI ripiega su <video>+canvas (getClipMediaPath).
  async function exportStill(clipId, frame, destDir) {
    const fail = (reason) => ({ ok: false, via: 'none', reason });
    if (!destDir) return fail('cartella di destinazione mancante');
    const item = await findItem(clipId);
    if (!item) return fail('clip non trovata nel Media Pool');
    if (!isFn(item, 'ExportFrame')) return fail('ExportFrame non disponibile in questa versione di Resolve');
    const safe = String(clipId).replace(/[^A-Za-z0-9_-]/g, '_');
    const path = `${String(destDir).replace(/[\\/]+$/, '')}/still_${safe}_${Math.round(frame)}.png`;
    const r = await attempt(() => item.ExportFrame(Math.round(frame), path), 'ExportFrame');
    if (!r.ok) return fail(r.reason);
    if (r.value === false) return fail('ExportFrame ha restituito false');
    if (fileExists) {
      let exists = false;
      try { exists = !!(await fileExists(path)); } catch { /* si assume assente */ }
      if (!exists) return fail('ExportFrame non ha creato il file');
    }
    return { ok: true, via: 'exportFrame', path };
  }

  // ---------------------------------------------------------------- timeline: lettura
  async function timelineFps(tl) {
    const project = await getProject();
    const v = (await attempt(() => tl.GetSetting('timelineFrameRate'), 'GetSetting')).value
      ?? (project ? (await attempt(() => project.GetSetting('timelineFrameRate'), 'GetSetting')).value : null);
    return num(v) || 24;
  }
  async function timelineDropFrame(tl) {
    const v = (await attempt(() => tl.GetSetting('timelineDropFrameTimecode'), 'GetSetting')).value;
    return truthy(v);
  }
  // Frame assoluto d'inizio della timeline (verificato su 21.2: 90000 per 01:00:00:00 a 25 fps).
  async function timelineStart(tl, fps) {
    if (isFn(tl, 'GetStartFrame')) {
      const r = await attempt(() => tl.GetStartFrame(), 'GetStartFrame');
      if (r.ok && num(r.value) !== null) return num(r.value);
    }
    if (isFn(tl, 'GetStartTimecode')) {
      const r = await attempt(() => tl.GetStartTimecode(), 'GetStartTimecode');
      const f = r.ok ? tcToFrames(String(r.value), fps, 0) : null;
      if (f !== null) return f;
    }
    return 0;
  }
  // Fine del contenuto (frame assoluto): massimo GetEnd() sugli item di tutte le tracce video/audio.
  async function contentEnd(tl, start) {
    let end = start;
    for (const type of ['video', 'audio']) {
      const n = num((await attempt(() => tl.GetTrackCount(type), 'GetTrackCount')).value) || 0;
      for (let t = 1; t <= n; t++) {
        const items = (await attempt(() => tl.GetItemListInTrack(type, t), 'GetItemListInTrack')).value || [];
        for (const it of items) { const e = num((await attempt(() => it.GetEnd(), 'GetEnd')).value); if (e !== null && e > end) end = e; }
      }
    }
    return end;
  }

  // Item della timeline corrente (tracce video): [{clipId, track, start, end, srcStart, srcEnd}] in frame assoluti di
  // timeline / frame sorgente relativi alla clip. Serve agli indicatori "gia' usato" (stile Avid) e a "segui timeline".
  async function timelineUsage() {
    const tl = await getTimeline();
    if (!tl) return { ok: false, reason: 'nessuna timeline aperta in Resolve' };
    const fps = await timelineFps(tl);
    const start = await timelineStart(tl, fps);
    const name = (await attempt(() => tl.GetName(), 'GetName')).value ?? null;
    const items = [];
    const n = num((await attempt(() => tl.GetTrackCount('video'), 'GetTrackCount')).value) || 0;
    for (let t = 1; t <= n; t++) {
      const list = (await attempt(() => tl.GetItemListInTrack('video', t), 'GetItemListInTrack')).value || [];
      for (const it of list) {
        const mpi = (await attempt(() => it.GetMediaPoolItem(), 'GetMediaPoolItem')).value;
        if (!mpi) continue; // titoli, generatori
        const clipId = (await attempt(() => mpi.GetUniqueId(), 'GetUniqueId')).value;
        if (!clipId) continue;
        itemCache.set(clipId, mpi);
        const s = num((await attempt(() => it.GetStart(), 'GetStart')).value);
        const e = num((await attempt(() => it.GetEnd(), 'GetEnd')).value);
        const ss = num((await attempt(() => it.GetSourceStartFrame(), 'GetSourceStartFrame')).value);
        let se = isFn(it, 'GetSourceEndFrame') ? num((await attempt(() => it.GetSourceEndFrame(), 'GetSourceEndFrame')).value) : null;
        if (s === null || e === null || ss === null) continue;
        if (se === null || se <= ss) se = ss + (e - s);
        items.push({ clipId, track: t, start: s, end: e, srcStart: ss, srcEnd: se });
      }
    }
    return { ok: true, timelineName: name, fps, startFrame: start, items };
  }

  // Posizione del playhead della timeline: frame assoluto e, se sotto c'e' una clip, frame sorgente.
  async function timelinePlayhead() {
    const tl = await getTimeline();
    if (!tl) return { ok: false, reason: 'nessuna timeline aperta in Resolve' };
    if (!isFn(tl, 'GetCurrentTimecode')) return { ok: false, reason: 'GetCurrentTimecode non disponibile' };
    const tc = await attempt(() => tl.GetCurrentTimecode(), 'GetCurrentTimecode');
    if (!tc.ok) return { ok: false, reason: tc.reason };
    const fps = await timelineFps(tl);
    const frame = tcToFrames(String(tc.value), fps, 0);
    if (frame === null) return { ok: false, reason: `timecode del playhead non riconosciuto ("${tc.value}")` };
    const out = { ok: true, timecode: String(tc.value), frame, clipId: null, srcFrame: null };
    // Via rapida: GetCurrentVideoItem (presente su 21.2); altrimenti si scorrono le tracce.
    const candidates = [];
    if (isFn(tl, 'GetCurrentVideoItem')) {
      const r = await attempt(() => tl.GetCurrentVideoItem(), 'GetCurrentVideoItem');
      if (r.ok && r.value) candidates.push(r.value);
    }
    if (!candidates.length) {
      const n = num((await attempt(() => tl.GetTrackCount('video'), 'GetTrackCount')).value) || 0;
      for (let t = n; t >= 1 && !candidates.length; t--) {
        for (const it of (await attempt(() => tl.GetItemListInTrack('video', t), 'GetItemListInTrack')).value || []) {
          const s = num((await attempt(() => it.GetStart(), 'GetStart')).value);
          const e = num((await attempt(() => it.GetEnd(), 'GetEnd')).value);
          if (s !== null && e !== null && frame >= s && frame < e) { candidates.push(it); break; }
        }
      }
    }
    for (const it of candidates) {
      const mpi = (await attempt(() => it.GetMediaPoolItem(), 'GetMediaPoolItem')).value;
      if (!mpi) continue;
      const clipId = (await attempt(() => mpi.GetUniqueId(), 'GetUniqueId')).value;
      const s = num((await attempt(() => it.GetStart(), 'GetStart')).value);
      const ss = num((await attempt(() => it.GetSourceStartFrame(), 'GetSourceStartFrame')).value);
      if (!clipId || s === null || ss === null) continue;
      const clipFps = num((await attempt(() => mpi.GetClipProperty('FPS'), 'GetClipProperty')).value) || fps;
      out.clipId = clipId;
      out.srcFrame = Math.round(ss + (frame - s) * (clipFps / fps));
      break;
    }
    return out;
  }

  // Playhead -> frame relativo alla clip indicata (per le ancore dal playhead).
  async function playheadSourceFrame(clipId) {
    const tl = await getTimeline();
    if (!tl) return { ok: false, reason: 'nessuna timeline aperta' };
    if (!isFn(tl, 'GetCurrentTimecode')) return { ok: false, reason: 'GetCurrentTimecode non disponibile' };
    const tc = await attempt(() => tl.GetCurrentTimecode(), 'GetCurrentTimecode');
    if (!tc.ok) return { ok: false, reason: tc.reason };
    const tlFps = await timelineFps(tl);
    const playhead = tcToFrames(String(tc.value), tlFps, 0);
    if (playhead === null) return { ok: false, reason: `timecode del playhead non riconosciuto ("${tc.value}")` };
    const clip = await findItem(clipId);
    const clipFps = clip ? num((await attempt(() => clip.GetClipProperty('FPS'), 'GetClipProperty')).value) || tlFps : tlFps;
    const tracks = Number(await tl.GetTrackCount('video')) || 0;
    for (let t = tracks; t >= 1; t--) {
      for (const item of (await tl.GetItemListInTrack('video', t)) || []) {
        const mpi = await item.GetMediaPoolItem();
        if (!mpi || (await mpi.GetUniqueId()) !== clipId) continue;
        const start = await item.GetStart();
        const end = await item.GetEnd();
        if (playhead < start || playhead >= end) continue;
        const srcStart = num(await item.GetSourceStartFrame()) ?? 0;
        return { ok: true, frame: Math.round(srcStart + (playhead - start) * (clipFps / tlFps)) };
      }
    }
    return { ok: false, reason: 'il playhead non e\' su un elemento della timeline che usa questa clip' };
  }

  // Porta il playhead della timeline sul frame sorgente di una clip, se la clip e' montata li'. SetCurrentTimecode
  // (presente su 21.2) funziona solo nelle pagine Cut/Edit/Color/Fairlight/Deliver.
  async function seekTimeline(clipId, srcFrame) {
    const tl = await getTimeline();
    if (!tl) return { ok: false, reason: 'nessuna timeline aperta in Resolve' };
    if (!isFn(tl, 'SetCurrentTimecode')) return { ok: false, reason: 'SetCurrentTimecode non disponibile in questa versione di Resolve' };
    const u = await timelineUsage();
    if (!u.ok) return u;
    const clip = await findItem(clipId);
    const clipFps = clip ? num((await attempt(() => clip.GetClipProperty('FPS'), 'GetClipProperty')).value) || u.fps : u.fps;
    const hit = u.items.filter((i) => i.clipId === clipId && srcFrame >= i.srcStart && srcFrame < i.srcEnd)
      .sort((a, b) => a.track - b.track)[0];
    if (!hit) return { ok: false, reason: 'questo punto della clip non e\' montato nella timeline corrente' };
    const abs = Math.round(hit.start + (srcFrame - hit.srcStart) * (u.fps / clipFps));
    const tc = framesToTc(abs, u.fps, 0, { dropFrame: await timelineDropFrame(tl) });
    const r = await attempt(() => tl.SetCurrentTimecode(tc), 'SetCurrentTimecode');
    if (!r.ok) return { ok: false, reason: r.reason };
    if (r.value === false) return { ok: false, reason: 'Resolve non ha spostato il playhead (sei nella pagina Edit o Cut?)' };
    return { ok: true, timecode: tc };
  }

  // ---------------------------------------------------------------- piano di montaggio (toAppendPlan)
  async function findTimelineByName(project, name) {
    if (!isFn(project, 'GetTimelineCount') || !isFn(project, 'GetTimelineByIndex')) return null;
    const n = Number(await project.GetTimelineCount()) || 0;
    for (let i = 1; i <= n; i++) {
      const tl = await project.GetTimelineByIndex(i);
      if (tl && (await tl.GetName()) === name) return tl;
    }
    return null;
  }

  // Unisce video (mediaType 1) e audio (mediaType 2) dello stesso pezzo su V1/A1 in una voce senza mediaType:
  // Resolve li aggiunge collegati. Ritorna [{entry, parts:[voci originali]}].
  function linkPairs(entries) {
    const out = [];
    const audioByKey = new Map();
    const key = (e) => `${e.clipId}|${e.startFrame}|${e.endFrame}|${e.recordFrame}`;
    for (const e of entries) if (e.mediaType === 2 && e.trackIndex === 1) audioByKey.set(key(e), e);
    const used = new Set();
    for (const e of entries) {
      if (e.mediaType === 1 && e.trackIndex === 1 && audioByKey.has(key(e)) && !used.has(key(e))) {
        const a = audioByKey.get(key(e)); used.add(key(e));
        const { mediaType, ...rest } = e;
        out.push({ entry: { ...rest, linked: true }, parts: [e, a] });
      } else if (!(e.mediaType === 2 && e.trackIndex === 1 && used.has(key(e)))) out.push({ entry: e, parts: [e] });
    }
    return out;
  }

  /**
   * Esegue il piano di montaggio. I `recordFrame` del piano sono RELATIVI all'inizio della sequenza: il bridge aggiunge
   * l'inizio della timeline (mode 'new', o timeline esistente per nome) oppure la fine del contenuto (mode 'append').
   * @param {{clipId,startFrame,endFrame,trackIndex?,recordFrame?,mediaType?}[]} plan  fine esclusa; mediaType 1=video 2=audio
   * @param {{timelineName?, withAudio?, mode?:'new'|'append', markers?:[{recordFrame,name,note,color,customData}]}} opts
   * @returns {{ok, timelineName, itemsAdded, tracksCreated, markersAdded, baseFrame, skipped:[{clipId,reason}], reason?}}
   */
  async function executeAppendPlan(plan, { timelineName, withAudio = true, mode = 'new', markers = [] } = {}) {
    const skipped = [];
    const base = { timelineName: null, itemsAdded: 0, tracksCreated: 0, markersAdded: 0, skipped };
    if (!Array.isArray(plan) || plan.length === 0) return { ok: false, ...base, reason: 'piano di montaggio vuoto' };
    const entries = [];
    for (const e of plan) {
      const mediaType = e.mediaType ?? 1;
      const trackIndex = e.trackIndex ?? 1;
      if (mediaType !== 1 && mediaType !== 2) { skipped.push({ clipId: e.clipId, reason: `mediaType non valido (${mediaType})` }); continue; }
      if (mediaType === 2 && !withAudio) continue;
      if (!Number.isInteger(trackIndex) || trackIndex < 1) { skipped.push({ clipId: e.clipId, reason: `trackIndex non valido (${trackIndex})` }); continue; }
      if (!(e.endFrame > e.startFrame)) { skipped.push({ clipId: e.clipId, reason: 'intervallo vuoto' }); continue; }
      entries.push({ ...e, mediaType, trackIndex });
    }
    if (entries.length === 0) return { ok: false, ...base, reason: 'nessun elemento da montare' };

    const project = await getProject();
    if (!project) return { ok: false, ...base, reason: 'Nessun progetto aperto in Resolve' };
    const mp = await getMediaPool();
    let tl = null;
    let name = timelineName || null;
    if (mode === 'append') {
      tl = await project.GetCurrentTimeline();
      if (!tl) return { ok: false, ...base, reason: 'nessuna timeline aperta in Resolve a cui accodare' };
      name = (await attempt(() => tl.GetName(), 'GetName')).value ?? name;
    } else if (name) {
      tl = await findTimelineByName(project, name);
      if (tl) {
        const r = await makeCurrent(tl);
        if (!r.ok) return { ok: false, ...base, timelineName: name, reason: r.reason };
      }
    }
    if (!tl) {
      const c = await createTimeline(mp, name || 'ContinuityEdit');
      if (!c.tl) return { ok: false, ...base, reason: 'CreateEmptyTimeline non riuscita' };
      tl = c.tl; name = c.name;
      await makeCurrent(tl);
    }
    base.timelineName = name;
    const fps = await timelineFps(tl);
    const tlStart = await timelineStart(tl, fps);
    // timeline gia' esistente (per nome o accoda): si mette dopo il contenuto, mai sopra
    const baseFrame = await contentEnd(tl, tlStart);
    base.baseFrame = baseFrame;

    // livelli: AddTrack finche' ce ne sono abbastanza
    let tracksCreated = 0;
    const available = { video: 1, audio: 1 };
    const trackErr = {};
    for (const [type, mt] of [['video', 1], ['audio', 2]]) {
      const need = Math.max(0, ...entries.filter((e) => e.mediaType === mt).map((e) => e.trackIndex));
      if (!need) continue;
      if (isFn(tl, 'GetTrackCount')) {
        const c = await attempt(() => tl.GetTrackCount(type), 'GetTrackCount');
        if (c.ok && num(c.value) !== null) available[type] = Math.max(1, num(c.value));
      }
      while (available[type] < need) {
        if (!isFn(tl, 'AddTrack')) { trackErr[type] = 'AddTrack non disponibile in questa versione di Resolve'; break; }
        const r = await attempt(() => tl.AddTrack(type), 'AddTrack');
        if (!r.ok || r.value === false) { trackErr[type] = r.reason || 'AddTrack ha restituito false'; break; }
        available[type]++;
        tracksCreated++;
      }
    }

    const append = async (e, item) => {
      const info = { mediaPoolItem: item, startFrame: e.startFrame, endFrame: e.endFrame, trackIndex: e.trackIndex };
      if (e.mediaType) info.mediaType = e.mediaType;
      if (Number.isFinite(e.recordFrame)) info.recordFrame = baseFrame + e.recordFrame;
      const r = await attempt(() => mp.AppendToTimeline([info]), 'AppendToTimeline');
      return { added: r.ok ? (Array.isArray(r.value) ? r.value.length : (r.value ? 1 : 0)) : 0, reason: r.reason };
    };
    let itemsAdded = 0;
    for (const { entry: e, parts } of linkPairs(entries)) {
      const type = e.mediaType === 2 ? 'audio' : 'video';
      if (e.trackIndex > available[type]) {
        skipped.push({ clipId: e.clipId, reason: `livello ${type === 'video' ? 'V' : 'A'}${e.trackIndex} non disponibile: ${trackErr[type] || 'creazione non riuscita'}` });
        continue;
      }
      const item = await findItem(e.clipId);
      if (!item) { skipped.push({ clipId: e.clipId, reason: 'clip non trovata nel Media Pool' }); continue; }
      let r = await append(e, item);
      if (!r.added && e.linked) { // ripiego: video e audio separati
        r = { added: 0, reason: r.reason };
        for (const p of parts) { const x = await append(p, item); r.added += x.added; if (!x.added) r.reason = x.reason; }
      }
      if (r.added) itemsAdded += r.added;
      else skipped.push({ clipId: e.clipId, reason: r.reason || 'AppendToTimeline non ha aggiunto nulla' });
    }

    // Marker di timeline sulle righe dello script (frame relativi all'inizio della timeline, verificato su 21.2).
    let markersAdded = 0;
    if (itemsAdded && markers.length && isFn(tl, 'AddMarker')) {
      for (const m of markers) {
        const at = baseFrame - tlStart + m.recordFrame;
        const r = await attempt(() => tl.AddMarker(at, m.color || 'Blue', m.name || '', m.note || '', m.duration || 1, m.customData || ''), 'AddMarker');
        if (r.ok && r.value !== false) markersAdded++;
      }
    }
    const out = { ok: itemsAdded > 0, timelineName: name, itemsAdded, tracksCreated, markersAdded, baseFrame, skipped };
    if (!out.ok) out.reason = 'AppendToTimeline non ha aggiunto nulla';
    return out;
  }

  // ---------------------------------------------------------------- marker di sync
  // markers: [{frame,color?,name?,note?,duration?,customData}]; rimuove prima i marker di sync 'ce:<riga>:<bordo>'
  // della clip (mai gli still 'ce:still:' ne' i marker dell'utente).
  async function writeMarkers(clipId, markers) {
    const item = await findItem(clipId);
    if (!item) return { ok: false, count: 0, failed: [], reason: 'clip non trovata nel Media Pool' };
    try {
      const existing = (await item.GetMarkers()) || {};
      for (const [f, m] of Object.entries(existing)) {
        if (typeof m.customData === 'string' && SYNC_MARKER.test(m.customData)) await item.DeleteMarkerAtFrame(Number(f));
      }
    } catch { /* si prosegue */ }
    let count = 0;
    const failed = [];
    for (const m of markers) {
      const r = await attempt(
        () => item.AddMarker(m.frame, m.color || 'Blue', m.name || '', m.note || '', m.duration || 1, m.customData || ''),
        'AddMarker');
      if (r.ok && r.value) count++; else failed.push({ frame: m.frame, reason: r.reason || 'AddMarker ha restituito false (frame gia\' occupato da un altro marker?)' });
    }
    return { ok: failed.length === 0, count, failed };
  }

  // ---------------------------------------------------------------- metadati nel Media Pool (opt-in)
  // Scrive valutazioni/inquadrature in modo NON distruttivo:
  //  - keywords: parole chiave con prefisso 'CE ' (si tolgono solo le vecchie 'CE ...', le altre restano)
  //  - clipColor: colore della clip, solo se la clip non ne ha gia' uno (salvo overwriteColor)
  //  - flag: aggiunge un flag di quel colore (AddFlag non toglie gli altri)
  // Ritorna {ok, done:{keywords?,clipColor?,flag?}, skipped:{...motivo}}.
  async function writeClipMeta(clipId, { keywords = null, clipColor = null, flag = null, overwriteColor = false } = {}) {
    const item = await findItem(clipId);
    if (!item) return { ok: false, reason: 'clip non trovata nel Media Pool' };
    const done = {}; const skipped = {};
    if (Array.isArray(keywords)) {
      if (!isFn(item, 'SetMetadata')) skipped.keywords = 'SetMetadata non disponibile';
      else {
        let cur = '';
        if (isFn(item, 'GetMetadata')) cur = String((await attempt(() => item.GetMetadata('Keywords'), 'GetMetadata')).value ?? '');
        const mine = keywords.map((k) => `${CE_KEYWORD_PREFIX}${k}`);
        const kept = cur.split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith(CE_KEYWORD_PREFIX));
        const next = [...kept, ...mine].join(', ');
        if (next === cur) done.keywords = 'invariate';
        else {
          const r = await attempt(() => item.SetMetadata('Keywords', next), 'SetMetadata');
          if (r.ok && r.value !== false) done.keywords = next; else skipped.keywords = r.reason || 'SetMetadata ha restituito false';
        }
      }
    }
    if (clipColor) {
      const cur = isFn(item, 'GetClipColor') ? String((await attempt(() => item.GetClipColor(), 'GetClipColor')).value ?? '') : '';
      if (cur && !overwriteColor && cur !== clipColor) skipped.clipColor = `la clip ha gia' il colore "${cur}"`;
      else if (!isFn(item, 'SetClipColor')) skipped.clipColor = 'SetClipColor non disponibile';
      else {
        const r = await attempt(() => item.SetClipColor(clipColor), 'SetClipColor');
        if (r.ok && r.value !== false) done.clipColor = clipColor; else skipped.clipColor = r.reason || 'SetClipColor ha restituito false';
      }
    }
    if (flag) {
      const list = isFn(item, 'GetFlagList') ? (await attempt(() => item.GetFlagList(), 'GetFlagList')).value : null;
      if (Array.isArray(list) && list.includes(flag)) done.flag = 'gia\' presente';
      else if (!isFn(item, 'AddFlag')) skipped.flag = 'AddFlag non disponibile';
      else {
        const r = await attempt(() => item.AddFlag(flag), 'AddFlag');
        if (r.ok && r.value !== false) done.flag = flag; else skipped.flag = r.reason || 'AddFlag ha restituito false';
      }
    }
    return { ok: Object.keys(skipped).length === 0, done, skipped };
  }

  // Importa un file (es. sottotitoli .srt) nel Media Pool: sperimentale, nessuna eccezione.
  async function importMedia(paths) {
    const mp = await getMediaPool();
    if (!isFn(mp, 'ImportMedia')) return { ok: false, reason: 'ImportMedia non disponibile' };
    const r = await attempt(() => mp.ImportMedia(paths), 'ImportMedia');
    if (!r.ok) return { ok: false, reason: r.reason };
    const n = Array.isArray(r.value) ? r.value.length : (r.value ? 1 : 0);
    return n ? { ok: true, imported: n } : { ok: false, reason: 'Resolve non ha importato il file' };
  }

  // ---------------------------------------------------------------- diagnostica
  // Prove sicure: letture, marker di prova ripuliti, mark in/out (poi azzerato), timeline temporanea eliminata.
  // Ogni passo registra cosa e' stato provato e il risultato grezzo, cosi' un solo file JSON basta per capire quali
  // firme funzionano sul Mac dell'utente.
  async function runDiagnostics() {
    const steps = [];
    const step = async (name, fn, help = '') => {
      const t0 = Date.now();
      try {
        const detail = await fn();
        steps.push({ name, ok: detail?.ok !== false, detail, ms: Date.now() - t0, help });
        return detail;
      } catch (e) {
        steps.push({ name, ok: false, detail: { error: errText(e) }, ms: Date.now() - t0, help });
        return null;
      }
    };
    const short = (v) => { try { const s = JSON.stringify(v); return s && s.length > 600 ? `${s.slice(0, 600)}…` : v; } catch { return String(v); } };
    await step('getEnv', () => getEnv(), 'versione di Resolve, progetto e timeline');
    await step('projectInfo', () => projectInfo(), 'identita\' del progetto (cambio progetto a pannello aperto)');
    const mpInfo = await step('mediaPool', async () => {
      const m = await getMediaPool();
      return { ok: true, hasSetSelectedClip: isFn(m, 'SetSelectedClip'), hasGetSelectedClips: isFn(m, 'GetSelectedClips'), hasImportMedia: isFn(m, 'ImportMedia') };
    }, 'Media Pool');
    const sel = await step('getSelectedClips', async () => {
      const list = await getSelectedClips();
      return {
        ok: true, count: list.length,
        sample: list.slice(0, 3).map((c) => ({ fps: c.fps, durationFrames: c.durationFrames, startTcFrames: c.startTcFrames, markers: c.markers.length, transcribed: c.transcribed, transcriptionStatus: c.transcriptionStatus })),
      };
    }, 'clip selezionate nel Media Pool');
    let item = null;
    try { item = (await selectedItems())[0] || null; } catch { /* nessuna clip */ }
    if (item) {
      const prop = async (k) => { try { return await item.GetClipProperty(k); } catch (e) { return `ERR ${errText(e)}`; } };
      await step('clipProperties', async () => ({ ok: true, FPS: await prop('FPS'), Frames: await prop('Frames'), Duration: await prop('Duration'), 'Start TC': await prop('Start TC'), 'Drop frame': await prop('Drop frame'), 'Transcription Status': await prop('Transcription Status') }), 'proprieta\' di base della clip');
      const id = await item.GetUniqueId();
      await step('markers', async () => {
        const f = 1;
        const before = (await item.GetMarkers()) || {};
        if (Object.prototype.hasOwnProperty.call(before, f)) return { ok: true, skipped: 'frame di prova occupato' };
        const added = await item.AddMarker(f, 'Blue', 'ce-diag', '', 1, 'ce:diag:point');
        const seen = (await item.GetMarkers()) || {};
        const roundTrip = seen[f]?.customData === 'ce:diag:point';
        const byCustom = isFn(item, 'GetMarkerByCustomData') ? short((await attempt(() => item.GetMarkerByCustomData('ce:diag:point'), 'GetMarkerByCustomData')).value) : 'assente';
        const delByCustom = isFn(item, 'DeleteMarkerByCustomData') ? (await attempt(() => item.DeleteMarkerByCustomData('ce:diag:point'), 'DeleteMarkerByCustomData')).value : 'assente';
        const after1 = (await item.GetMarkers()) || {};
        const deleted = Object.prototype.hasOwnProperty.call(after1, f) ? await item.DeleteMarkerAtFrame(f) : 'gia\' tolto da DeleteMarkerByCustomData';
        const after = (await item.GetMarkers()) || {};
        return { ok: !!added && roundTrip && !Object.prototype.hasOwnProperty.call(after, f), added, roundTrip, byCustom, delByCustom, deleted };
      }, 'AddMarker / GetMarkerByCustomData / DeleteMarkerByCustomData (still e ancore)');
      await step('setSelectedClip', async () => {
        const m = await getMediaPool();
        if (!isFn(m, 'SetSelectedClip')) return { ok: false, reason: 'SetSelectedClip assente' };
        return { ok: (await m.SetSelectedClip(item)) !== false };
      }, '"Mostra in Resolve"');
      await step('setMarkInOut', async () => {
        if (!isFn(item, 'SetMarkInOut')) return { ok: false, reason: 'SetMarkInOut assente' };
        const dur = sel?.sample?.[0]?.durationFrames || 12;
        const hi = Math.max(2, Math.min(10, dur - 1));
        const before = isFn(item, 'GetMarkInOut') ? (await attempt(() => item.GetMarkInOut(), 'GetMarkInOut')).value : null;
        const variants = {};
        for (const type of ['all', 'video']) variants[type] = await attempt(() => item.SetMarkInOut(1, hi, type), 'SetMarkInOut');
        const readBack = isFn(item, 'GetMarkInOut') ? await attempt(() => item.GetMarkInOut(), 'GetMarkInOut') : null;
        if (isFn(item, 'ClearMarkInOut')) await attempt(() => item.ClearMarkInOut('all'), 'ClearMarkInOut');
        return { ok: variants.all.ok && variants.all.value !== false, before: short(before), variants, readBack, note: `provato in=1 out=${hi} (ultimo frame incluso?): confrontare con readBack` };
      }, 'In/Out della clip ("Mostra in Resolve")');
      await step('transcription', async () => {
        const project = await getProject();
        const st = project && isFn(project, 'GetTranscribeAudioStatus') ? await attempt(() => project.GetTranscribeAudioStatus(), 'Project.GetTranscribeAudioStatus') : { ok: false, reason: 'assente' };
        const tr = await attempt(() => item.GetTranscription(), 'GetTranscription');
        return {
          ok: st.ok || tr.ok, projectStatus: st, itemHasStatus: isFn(item, 'GetTranscribeAudioStatus'),
          segments: tr.ok && Array.isArray(tr.value?.segments) ? tr.value.segments.length : null,
          language: tr.ok ? tr.value?.language ?? null : null,
          firstWord: tr.ok ? short(tr.value?.segments?.find((s) => s.words?.length)?.words?.[0]) : null,
        };
      }, 'trascrizione e suo stato');
      await step('playheadSourceFrame', () => playheadSourceFrame(id), 'ancore dal playhead della timeline');
      await step('clipMetadata', async () => {
        const props = {};
        for (const k of ['Scene', 'Shot', 'Take', 'Camera #', 'Angle', 'Shot Type', 'File Path', 'Proxy Media Path', 'Video Codec', 'Audio Codec', 'Clip Color', 'Keywords', 'Flags', 'Good Take']) {
          const r = await attempt(() => item.GetClipProperty(k), 'GetClipProperty');
          props[k] = r.ok ? (r.value === undefined || r.value === '' ? '(vuoto)' : r.value) : r.reason;
        }
        const meta = isFn(item, 'GetMetadata') ? short((await attempt(() => item.GetMetadata(), 'GetMetadata')).value) : 'assente';
        const third = isFn(item, 'GetThirdPartyMetadata') ? short((await attempt(() => item.GetThirdPartyMetadata(), 'GetThirdPartyMetadata')).value) : 'assente';
        const audioMap = isFn(item, 'GetAudioMapping') ? short((await attempt(() => item.GetAudioMapping(), 'GetAudioMapping')).value) : 'assente';
        return { ok: true, props, meta, third, audioMap, note: 'proprieta\' vuote = non impostate nei metadati della clip' };
      }, 'metadati per bin di scena, lettore (proxy, codec, audio collegato)');
      await step('writeMetadataRoundTrip', async () => {
        // Scrive e poi RIPRISTINA: parole chiave, colore e flag (prova delle firme della scrittura opt-in).
        const res = {};
        if (isFn(item, 'GetMetadata') && isFn(item, 'SetMetadata')) {
          const prev = (await attempt(() => item.GetMetadata('Keywords'), 'GetMetadata')).value ?? '';
          const w = await attempt(() => item.SetMetadata('Keywords', prev ? `${prev}, CE diag` : 'CE diag'), 'SetMetadata');
          const back = (await attempt(() => item.GetMetadata('Keywords'), 'GetMetadata')).value;
          const restore = await attempt(() => item.SetMetadata('Keywords', prev), 'SetMetadata');
          res.keywords = { prev, write: w, back, restored: restore.ok && restore.value !== false };
        } else res.keywords = 'assente';
        if (isFn(item, 'GetClipColor') && isFn(item, 'SetClipColor')) {
          const prev = (await attempt(() => item.GetClipColor(), 'GetClipColor')).value ?? '';
          const w = await attempt(() => item.SetClipColor('Lime'), 'SetClipColor');
          const back = (await attempt(() => item.GetClipColor(), 'GetClipColor')).value;
          const restore = prev ? await attempt(() => item.SetClipColor(prev), 'SetClipColor') : await attempt(() => item.ClearClipColor(), 'ClearClipColor');
          res.clipColor = { prev, write: w, back, restored: restore.ok };
        } else res.clipColor = 'assente';
        if (isFn(item, 'AddFlag') && isFn(item, 'GetFlagList')) {
          const prev = (await attempt(() => item.GetFlagList(), 'GetFlagList')).value;
          const had = Array.isArray(prev) && prev.includes('Cream');
          const w = had ? 'gia\' presente' : await attempt(() => item.AddFlag('Cream'), 'AddFlag');
          const back = (await attempt(() => item.GetFlagList(), 'GetFlagList')).value;
          const restore = had ? 'non necessario' : (isFn(item, 'ClearFlags') ? await attempt(() => item.ClearFlags('Cream'), 'ClearFlags') : 'ClearFlags assente');
          res.flag = { prev: short(prev), write: w, back: short(back), restore };
        } else res.flag = 'assente';
        return { ok: true, ...res };
      }, 'scrittura in Resolve (parole chiave, colore, flag) con ripristino');
      await step('exportFrame', async () => {
        const has = { ExportFrame: isFn(item, 'ExportFrame'), ExportThumbnails: isFn(item, 'ExportThumbnails') };
        if (!has.ExportFrame && !has.ExportThumbnails) return { ok: false, has, reason: 'ExportFrame/ExportThumbnails assenti' };
        if (!tmpDir) return { ok: has.ExportFrame, has, note: 'solo esistenza: nessuna cartella temporanea per la prova' };
        const r = await exportStill(id, 1, tmpDir);
        let fileOk = null;
        if (r.ok && fileExists) { try { fileOk = !!(await fileExists(r.path)); } catch { fileOk = false; } }
        return { ok: r.ok, has, result: r, fileOk, note: 'non necessario: gli still si leggono dal video. Verificare a mano il PNG.' };
      }, 'ExportFrame (facoltativo)');
    } else {
      steps.push({ name: 'selezione', ok: false, detail: { reason: 'nessuna clip selezionata nel Media Pool: selezionane una e rilancia per provare marker, In/Out, trascrizione e metadati' } });
    }
    await step('currentTimecode', async () => {
      const tl = await getTimeline();
      if (!tl) return { ok: false, reason: 'nessuna timeline aperta' };
      const r = await attempt(() => tl.GetCurrentTimecode(), 'GetCurrentTimecode');
      const settings = {};
      for (const k of ['timelineFrameRate', 'timelineDropFrameTimecode']) settings[k] = (await attempt(() => tl.GetSetting(k), 'GetSetting')).value;
      const start = isFn(tl, 'GetStartFrame') ? (await attempt(() => tl.GetStartFrame(), 'GetStartFrame')).value : 'assente';
      const startTc = isFn(tl, 'GetStartTimecode') ? (await attempt(() => tl.GetStartTimecode(), 'GetStartTimecode')).value : 'assente';
      const end = isFn(tl, 'GetEndFrame') ? (await attempt(() => tl.GetEndFrame(), 'GetEndFrame')).value : 'assente';
      return { ok: r.ok, value: r.ok ? r.value : undefined, reason: r.reason, settings, start, startTc, end };
    }, 'playhead e impostazioni della timeline');
    await step('setCurrentTimecode', async () => {
      const tl = await getTimeline();
      if (!tl) return { ok: false, reason: 'nessuna timeline aperta' };
      if (!isFn(tl, 'SetCurrentTimecode')) return { ok: false, reason: 'SetCurrentTimecode assente' };
      const cur = await attempt(() => tl.GetCurrentTimecode(), 'GetCurrentTimecode');
      if (!cur.ok) return { ok: false, reason: cur.reason };
      const r = await attempt(() => tl.SetCurrentTimecode(String(cur.value)), 'SetCurrentTimecode');
      return { ok: r.ok && r.value !== false, value: r.value, reason: r.reason, page: (await attempt(async () => (await R()).GetCurrentPage(), 'GetCurrentPage')).value, note: 'rimesso allo stesso timecode (nessuno spostamento): funziona solo in Cut/Edit/Color/Fairlight/Deliver' };
    }, '"Segui timeline": clic su una riga porta il playhead');
    await step('timelineUsage', async () => {
      const u = await timelineUsage();
      return u.ok ? { ok: true, timelineName: u.timelineName, fps: u.fps, startFrame: u.startFrame, items: u.items.length, sample: u.items.slice(0, 3) } : u;
    }, 'indicatori "gia\' usato in timeline"');
    await step('timelinePlayhead', () => timelinePlayhead(), 'riga sotto il playhead (GetCurrentVideoItem)');
    await step('binTree', async () => {
      const bins = await listBins();
      return { ok: true, count: bins.length, sample: bins.slice(0, 5) };
    }, 'bin di scena');
    let ext = null;
    await step('timelineTemporanea', async () => {
      const m = await getMediaPool();
      const prevTl = await getTimeline();
      const tl = await m.CreateEmptyTimeline(`ce-diag-${Date.now()}`);
      if (!tl) return { ok: false, reason: 'CreateEmptyTimeline non riuscita' };
      const cur = await makeCurrent(tl);
      const fps = await timelineFps(tl);
      const start = await timelineStart(tl, fps);
      let appended = null;
      if (item) {
        const r = await attempt(() => m.AppendToTimeline([{ mediaPoolItem: item, startFrame: 0, endFrame: 5 }]), 'AppendToTimeline');
        appended = r.ok ? (Array.isArray(r.value) ? r.value.length : !!r.value) : r.reason;
      }
      ext = { hasCreateMulticamClip: isFn(m, 'CreateMulticamClip'), start, setCurrent: cur };
      ext.addTrack = isFn(tl, 'AddTrack') ? await attempt(() => tl.AddTrack('video'), 'AddTrack') : { ok: false, reason: 'AddTrack assente' };
      if (ext.addTrack.ok && ext.addTrack.value === false) ext.addTrack = { ok: false, reason: 'AddTrack ha restituito false' };
      if (item) {
        // recordFrame ASSOLUTO (inizio timeline + 50): si rilegge dove e' finito l'item
        const r = await attempt(() => m.AppendToTimeline([{ mediaPoolItem: item, startFrame: 0, endFrame: 5, trackIndex: ext.addTrack.ok ? 2 : 1, recordFrame: start + 50, mediaType: 1 }]), 'AppendToTimeline(trackIndex/recordFrame/mediaType)');
        const placed = r.ok && Array.isArray(r.value) && r.value[0] ? (await attempt(() => r.value[0].GetStart(), 'GetStart')).value : null;
        ext.appendExt = r.ok ? { ok: Array.isArray(r.value) ? r.value.length > 0 : !!r.value, placedAt: placed, expected: start + 50 } : r;
        // video+audio collegati (senza mediaType) con recordFrame
        const r2 = await attempt(() => m.AppendToTimeline([{ mediaPoolItem: item, startFrame: 0, endFrame: 5, trackIndex: 1, recordFrame: start + 100 }]), 'AppendToTimeline(senza mediaType)');
        ext.appendLinked = r2.ok ? { ok: Array.isArray(r2.value) ? r2.value.length > 0 : !!r2.value, items: Array.isArray(r2.value) ? r2.value.length : null } : r2;
      } else { ext.appendExt = { ok: false, reason: 'nessuna clip selezionata per la prova' }; ext.appendLinked = ext.appendExt; }
      ext.marker = isFn(tl, 'AddMarker') ? await attempt(() => tl.AddMarker(10, 'Blue', 'ce-diag', 'riga', 1, 'ce:line:diag'), 'Timeline.AddMarker') : { ok: false, reason: 'assente' };
      ext.markerRead = isFn(tl, 'GetMarkers') ? short((await attempt(() => tl.GetMarkers(), 'Timeline.GetMarkers')).value) : 'assente';
      ext.subtitleTracks = isFn(tl, 'GetTrackCount') ? (await attempt(() => tl.GetTrackCount('subtitle'), 'GetTrackCount(subtitle)')).value : 'assente';
      ext.hasInsertTitle = isFn(tl, 'InsertTitleIntoTimeline');
      ext.hasCreateSubtitlesFromAudio = isFn(tl, 'CreateSubtitlesFromAudio');
      let deleted = false;
      if (isFn(m, 'DeleteTimelines')) deleted = !!(await attempt(() => m.DeleteTimelines([tl]), 'DeleteTimelines')).value;
      if (prevTl) await makeCurrent(prevTl);
      return { ok: true, appended, deleted, note: deleted ? undefined : 'timeline di prova NON eliminata: rimuoverla a mano' };
    }, 'creazione timeline, livelli, recordFrame assoluto, marker di timeline');
    if (ext) {
      steps.push({ name: 'addTrack', ok: ext.addTrack.ok, detail: ext.addTrack, help: 'livelli V2/V3 per i cutaway' });
      steps.push({ name: 'appendTrackRecordMediaType', ok: !!ext.appendExt.ok, detail: ext.appendExt, help: 'cutaway su V2 al punto giusto (placedAt deve valere expected)' });
      steps.push({ name: 'appendLinkedAV', ok: !!ext.appendLinked.ok, detail: ext.appendLinked, help: 'master con audio collegato' });
      steps.push({ name: 'timelineMarker', ok: !!ext.marker.ok && ext.marker.value !== false, detail: { add: ext.marker, read: ext.markerRead }, help: 'marker delle righe dopo il montaggio' });
      steps.push({ name: 'subtitleSupport', ok: true, detail: { subtitleTracks: ext.subtitleTracks, InsertTitleIntoTimeline: ext.hasInsertTitle, CreateSubtitlesFromAudio: ext.hasCreateSubtitlesFromAudio }, help: 'sottotitoli dallo script: solo informativo' });
      steps.push({ name: 'createMulticamClip', ok: true, detail: { exists: ext.hasCreateMulticamClip, note: 'sola esistenza, non invocata' } });
    }
    void mpInfo;
    const failed = steps.filter((s) => !s.ok).map((s) => s.name);
    return { ok: failed.length === 0, at: new Date().toISOString(), failed, steps };
  }

  return {
    getEnv, projectInfo, forgetItems, getSelectedClips, getClip, transcribe, status, getTranscription, previewLine,
    assemble, writeMarkers, playheadSourceFrame, runDiagnostics,
    listBins, loadBins, detectGroups, getClipMediaPath, exportStill, executeAppendPlan, addStillMarker, removeStillMarker,
    timelineUsage, timelinePlayhead, seekTimeline, writeClipMeta, importMedia,
  };
}
