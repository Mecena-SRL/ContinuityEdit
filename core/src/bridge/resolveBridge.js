// Bridge verso la API Resolve (Workflow Integration). L'oggetto `resolve` e' INIETTATO (reale o finto nei test):
// tutte le chiamate sono `await`-ate perche' nel plugin reale ogni metodo e' asincrono.
// Frame: interi relativi alla clip; intervalli con fine ESCLUSA (come AppendToTimeline).
// Le firme incerte (SetMarkInOut, SetSelectedClip, GetSelectedClips, GetCurrentTimecode) non lanciano:
// restituiscono {ok:false, reason} e sono coperte da runDiagnostics().

import { tcToFrames } from '../transcript/timecode.js';

export const MARKER_PREFIX = 'ce:';
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

/**
 * @param {object|Function} resolveOrGetter oggetto Resolve; con {lazy:true} una funzione async che lo restituisce
 */
export function createBridge(resolveOrGetter, { lazy = false } = {}) {
  let cached = null;
  const R = async () => {
    if (!lazy) return resolveOrGetter;
    if (!cached) cached = await resolveOrGetter();
    if (!cached) throw new Error('Resolve non disponibile');
    return cached;
  };

  const started = new Set(); // clipId di cui questo bridge ha avviato la trascrizione

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

  // ---------------------------------------------------------------- env
  async function getEnv() {
    const resolve = await R();
    const safe = async (fn) => { try { return await fn(); } catch { return null; } };
    const env = {
      resolveVersion: await safe(() => resolve.GetVersionString()),
      product: await safe(() => resolve.GetProductName()),
      projectName: null,
      pageName: await safe(() => resolve.GetCurrentPage()),
      timelineName: null,
      timelineFps: null,
      isStudio: false,
    };
    env.isStudio = typeof env.product === 'string' && /studio/i.test(env.product);
    const project = await safe(() => getProject());
    if (project) {
      env.projectName = await safe(() => project.GetName());
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
  async function clipInfo(item) {
    const prop = async (k) => { try { return await item.GetClipProperty(k); } catch { return null; } };
    const clipId = await item.GetUniqueId();
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
    let transcribed = false;
    try {
      const t = await item.GetTranscription();
      transcribed = !!(t && Array.isArray(t.segments) && t.segments.length > 0);
    } catch { /* non trascritta */ }
    return { clipId, name, fps, durationFrames, startTcFrames, transcribed, markers };
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

  // Cerca un MediaPoolItem per uniqueId: prima la selezione, poi tutto il Media Pool (ricorsivo).
  async function findItem(clipId) {
    try {
      for (const it of await selectedItems()) if ((await it.GetUniqueId()) === clipId) return it;
    } catch { /* si prosegue con la ricerca ricorsiva */ }
    const mp = await getMediaPool();
    const walk = async (folder, depth) => {
      for (const it of (await folder.GetClipList()) || []) if ((await it.GetUniqueId()) === clipId) return it;
      if (depth > 12) return null;
      for (const sub of (await folder.GetSubFolderList()) || []) {
        const r = await walk(sub, depth + 1);
        if (r) return r;
      }
      return null;
    };
    return walk(await mp.GetRootFolder(), 0);
  }

  async function getClip(clipId) {
    const item = await findItem(clipId);
    return item ? clipInfo(item) : null;
  }

  // ---------------------------------------------------------------- trascrizione
  async function transcribe(clipIds) {
    const done = [];
    const failed = [];
    for (const id of clipIds) {
      const item = await findItem(id);
      if (!item) { failed.push({ clipId: id, reason: 'clip non trovata' }); continue; }
      const r = await attempt(() => item.TranscribeAudio(), 'TranscribeAudio');
      if (r.ok && r.value !== false) { started.add(id); done.push(id); }
      else failed.push({ clipId: id, reason: r.reason || 'TranscribeAudio ha restituito false' });
    }
    return { started: done, failed };
  }

  // Stato aggregato dei job avviati: InProgress > altro > Complete; senza job = Inactive.
  async function status() {
    if (started.size === 0) return { jobStatus: 'Inactive' };
    const states = [];
    for (const id of started) {
      const item = await findItem(id);
      if (!item) continue;
      const r = await attempt(() => item.GetTranscribeAudioStatus(), 'GetTranscribeAudioStatus');
      const s = r.ok && r.value ? (r.value.JobStatus ?? r.value.jobStatus ?? r.value) : 'Inactive';
      states.push(typeof s === 'string' ? s : 'Inactive');
    }
    if (states.length === 0) return { jobStatus: 'Inactive' };
    if (states.includes('InProgress')) return { jobStatus: 'InProgress' };
    const other = states.find((s) => s !== 'Complete' && s !== 'Inactive');
    if (other) return { jobStatus: other };
    if (states.every((s) => s === 'Complete')) { started.clear(); return { jobStatus: 'Complete' }; }
    return { jobStatus: states.includes('Complete') ? 'Complete' : 'Inactive' };
  }

  async function getTranscription(clipId) {
    const item = await findItem(clipId);
    if (!item) return null;
    const t = await item.GetTranscription();
    return t && Array.isArray(t.segments) ? t : null;
  }

  // ---------------------------------------------------------------- anteprima
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

  // ---------------------------------------------------------------- montaggio
  /**
   * @param {{clipId,startFrame,endFrame,lineIds?}[]} cuts  fine esclusa
   * @returns {{ok, timelineName, itemsAdded, skipped:[{lineIds,reason}], reason?}}
   */
  async function assemble(cuts, timelineName) {
    const mp = await getMediaPool();
    const skipped = [];
    const infos = [];
    const cache = new Map();
    for (const c of cuts) {
      if (!cache.has(c.clipId)) cache.set(c.clipId, await findItem(c.clipId));
      const item = cache.get(c.clipId);
      if (!item) { skipped.push({ lineIds: c.lineIds || [], reason: 'clip non trovata nel Media Pool' }); continue; }
      if (!(c.endFrame > c.startFrame)) { skipped.push({ lineIds: c.lineIds || [], reason: 'intervallo vuoto' }); continue; }
      infos.push({ mediaPoolItem: item, startFrame: c.startFrame, endFrame: c.endFrame });
    }
    if (infos.length === 0) return { ok: false, timelineName: null, itemsAdded: 0, skipped, reason: 'nessun taglio da montare' };
    // CreateEmptyTimeline fallisce se il nome esiste gia': si riprova con un suffisso.
    const base = timelineName || 'ContinuityEdit';
    let name = base;
    let tl = null;
    for (let n = 1; n <= 20 && !tl; n++) {
      const candidate = n === 1 ? base : `${base} ${n}`;
      tl = await mp.CreateEmptyTimeline(candidate);
      if (tl) name = candidate;
    }
    if (!tl) return { ok: false, timelineName: null, itemsAdded: 0, skipped, reason: 'CreateEmptyTimeline non riuscita' };
    const res = await mp.AppendToTimeline(infos);
    const added = Array.isArray(res) ? res.length : (res ? infos.length : 0);
    if (!added) return { ok: false, timelineName: name, itemsAdded: 0, skipped, reason: 'AppendToTimeline non ha aggiunto nulla' };
    return { ok: true, timelineName: name, itemsAdded: added, skipped };
  }

  // ---------------------------------------------------------------- marker
  // markers: [{frame,color?,name?,note?,duration?,customData}]; rimuove prima i marker 'ce:' preesistenti della clip.
  async function writeMarkers(clipId, markers) {
    const item = await findItem(clipId);
    if (!item) return { ok: false, count: 0, failed: [], reason: 'clip non trovata nel Media Pool' };
    try {
      const existing = (await item.GetMarkers()) || {};
      for (const [f, m] of Object.entries(existing)) {
        if (typeof m.customData === 'string' && m.customData.startsWith(MARKER_PREFIX)) await item.DeleteMarkerAtFrame(Number(f));
      }
    } catch { /* si prosegue */ }
    let count = 0;
    const failed = [];
    for (const m of markers) {
      const r = await attempt(
        () => item.AddMarker(m.frame, m.color || 'Blue', m.name || '', m.note || '', m.duration || 1, m.customData || ''),
        'AddMarker');
      if (r.ok && r.value) count++; else failed.push({ frame: m.frame, reason: r.reason || 'AddMarker ha restituito false' });
    }
    return { ok: failed.length === 0, count, failed };
  }

  // ---------------------------------------------------------------- playhead -> frame sorgente
  // Timecode assoluto del playhead -> item video che usa la clip -> frame relativo alla clip.
  async function playheadSourceFrame(clipId) {
    const tl = await getTimeline();
    if (!tl) return { ok: false, reason: 'nessuna timeline aperta' };
    if (!isFn(tl, 'GetCurrentTimecode')) return { ok: false, reason: 'GetCurrentTimecode non disponibile' };
    const tc = await attempt(() => tl.GetCurrentTimecode(), 'GetCurrentTimecode');
    if (!tc.ok) return { ok: false, reason: tc.reason };
    const tlFps = num(await tl.GetSetting('timelineFrameRate')) || 24;
    const playhead = tcToFrames(String(tc.value), tlFps, 0);
    if (playhead === null) return { ok: false, reason: `timecode del playhead non riconosciuto ("${tc.value}")` };
    const clip = await getClip(clipId);
    const clipFps = clip?.fps || tlFps;
    const tracks = Number(await tl.GetTrackCount('video')) || 0;
    for (let t = 1; t <= tracks; t++) {
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
    return { ok: false, reason: 'il playhead non e\' su un item della timeline che usa questa clip' };
  }

  // ---------------------------------------------------------------- diagnostica
  // Prove sicure: letture, marker di prova ripuliti, mark in/out (poi azzerato), timeline temporanea eliminata.
  async function runDiagnostics() {
    const steps = [];
    const step = async (name, fn) => {
      const t0 = Date.now();
      try {
        const detail = await fn();
        steps.push({ name, ok: detail?.ok !== false, detail, ms: Date.now() - t0 });
        return detail;
      } catch (e) {
        steps.push({ name, ok: false, detail: { error: errText(e) }, ms: Date.now() - t0 });
        return null;
      }
    };
    await step('getEnv', () => getEnv());
    const mpInfo = await step('mediaPool', async () => {
      const m = await getMediaPool();
      return { ok: true, hasSetSelectedClip: isFn(m, 'SetSelectedClip'), hasGetSelectedClips: isFn(m, 'GetSelectedClips') };
    });
    const sel = await step('getSelectedClips', async () => {
      const list = await getSelectedClips();
      return {
        ok: true, count: list.length,
        sample: list.slice(0, 3).map((c) => ({ fps: c.fps, durationFrames: c.durationFrames, startTcFrames: c.startTcFrames, markers: c.markers.length, transcribed: c.transcribed })),
      };
    });
    let item = null;
    try { item = (await selectedItems())[0] || null; } catch { /* nessuna clip */ }
    if (item) {
      const prop = async (k) => { try { return await item.GetClipProperty(k); } catch (e) { return `ERR ${errText(e)}`; } };
      await step('clipProperties', async () => ({ ok: true, FPS: await prop('FPS'), Frames: await prop('Frames'), Duration: await prop('Duration'), 'Start TC': await prop('Start TC') }));
      const id = await item.GetUniqueId();
      await step('markers', async () => {
        const f = 1;
        const before = (await item.GetMarkers()) || {};
        if (Object.prototype.hasOwnProperty.call(before, f)) return { ok: true, skipped: 'frame di prova occupato' };
        const added = await item.AddMarker(f, 'Blue', 'ce-diag', '', 1, 'ce:diag:point');
        const seen = (await item.GetMarkers()) || {};
        const roundTrip = seen[f]?.customData === 'ce:diag:point';
        const deleted = await item.DeleteMarkerAtFrame(f);
        const after = (await item.GetMarkers()) || {};
        return { ok: !!added && roundTrip && !Object.prototype.hasOwnProperty.call(after, f), added, roundTrip, deleted };
      });
      await step('setSelectedClip', async () => {
        const m = await getMediaPool();
        if (!isFn(m, 'SetSelectedClip')) return { ok: false, reason: 'SetSelectedClip assente' };
        return { ok: (await m.SetSelectedClip(item)) !== false };
      });
      await step('setMarkInOut', async () => {
        if (!isFn(item, 'SetMarkInOut')) return { ok: false, reason: 'SetMarkInOut assente' };
        const dur = sel?.sample?.[0]?.durationFrames || 12;
        const hi = Math.max(2, Math.min(10, dur - 1));
        const variants = {};
        for (const type of ['all', 'video']) variants[type] = await attempt(() => item.SetMarkInOut(1, hi, type), 'SetMarkInOut');
        const readBack = isFn(item, 'GetMarkInOut') ? await attempt(() => item.GetMarkInOut(), 'GetMarkInOut') : null;
        if (isFn(item, 'ClearMarkInOut')) await attempt(() => item.ClearMarkInOut('all'), 'ClearMarkInOut');
        return { ok: variants.all.ok && variants.all.value !== false, variants, readBack, note: `provato in=1 out=${hi} (ultimo frame incluso?): confrontare con readBack` };
      });
      await step('transcription', async () => {
        const st = await attempt(() => item.GetTranscribeAudioStatus(), 'GetTranscribeAudioStatus');
        const tr = await attempt(() => item.GetTranscription(), 'GetTranscription');
        return {
          ok: st.ok || tr.ok, status: st,
          segments: tr.ok && Array.isArray(tr.value?.segments) ? tr.value.segments.length : null,
          language: tr.ok ? tr.value?.language ?? null : null,
        };
      });
      await step('playheadSourceFrame', () => playheadSourceFrame(id));
    } else {
      steps.push({ name: 'selezione', ok: false, detail: { reason: 'nessuna clip selezionata nel Media Pool: selezionane una e rilancia per provare marker, mark in/out e trascrizione' } });
    }
    await step('currentTimecode', async () => {
      const tl = await getTimeline();
      if (!tl) return { ok: false, reason: 'nessuna timeline aperta' };
      const r = await attempt(() => tl.GetCurrentTimecode(), 'GetCurrentTimecode');
      return { ok: r.ok, value: r.ok ? r.value : undefined, reason: r.reason };
    });
    await step('timelineTemporanea', async () => {
      const m = await getMediaPool();
      const tl = await m.CreateEmptyTimeline(`ce-diag-${Date.now()}`);
      if (!tl) return { ok: false, reason: 'CreateEmptyTimeline non riuscita' };
      let appended = null;
      if (item) {
        const r = await attempt(() => m.AppendToTimeline([{ mediaPoolItem: item, startFrame: 0, endFrame: 5 }]), 'AppendToTimeline');
        appended = r.ok ? (Array.isArray(r.value) ? r.value.length : !!r.value) : r.reason;
      }
      let deleted = false;
      if (isFn(m, 'DeleteTimelines')) deleted = !!(await attempt(() => m.DeleteTimelines([tl]), 'DeleteTimelines')).value;
      return { ok: true, appended, deleted, note: deleted ? undefined : 'timeline di prova NON eliminata: rimuoverla a mano' };
    });
    void mpInfo;
    return { ok: steps.every((s) => s.ok), at: new Date().toISOString(), steps };
  }

  return {
    getEnv, getSelectedClips, getClip, transcribe, status, getTranscription, previewLine,
    assemble, writeMarkers, playheadSourceFrame, runDiagnostics,
  };
}
