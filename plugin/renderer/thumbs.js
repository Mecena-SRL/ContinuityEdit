// Miniature degli still: un <video> riusato per clip (max 3, LRU), coda di seek, cache memoria + IndexedDB.
// Browser puro: la sorgente e' ce-media:// (protocollo registrato dal main). Nel mock si usa ce.__synthFrame.
import { THUMB_SIZE, MAX_CACHE_BYTES, MAX_VIDEOS, cacheKey, LruCache, VideoPool, SeekQueue, pruneIndex, placeholderTimecode } from './viewmodel/thumbs.js';

const mem = new LruCache({ maxBytes: 40 * 1024 * 1024 });
const videos = new Map(); // clipId -> { video, queue, running, usingProxy, info, failed }
const pool = new VideoPool(MAX_VIDEOS);
const inflight = new Map();

// ---------- IndexedDB (best effort) ----------
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const rq = indexedDB.open('ce-thumbs', 1);
      rq.onupgradeneeded = () => { const d = rq.result; const st = d.createObjectStore('thumbs', { keyPath: 'key' }); st.createIndex('ts', 'ts'); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
const tx = (d, mode, fn) => new Promise((res) => { try { const t = d.transaction('thumbs', mode); const r = fn(t.objectStore('thumbs')); t.oncomplete = () => res(r?.result); t.onerror = () => res(undefined); } catch { res(undefined); } });
async function idbGet(key) { const d = await db(); if (!d) return null; const r = await tx(d, 'readonly', (s) => s.get(key)); return r?.url || null; }
async function idbPut(key, url) {
  const d = await db(); if (!d) return;
  await tx(d, 'readwrite', (s) => s.put({ key, url, size: url.length, ts: Date.now() }));
  if (Math.random() < 0.05) idbPrune(d);
}
async function idbPrune(d) {
  const all = await tx(d, 'readonly', (s) => s.getAll());
  const drop = pruneIndex((all || []).map((e) => ({ key: e.key, size: e.size, ts: e.ts })), MAX_CACHE_BYTES);
  if (drop.length) await tx(d, 'readwrite', (s) => { drop.forEach((k) => s.delete(k)); });
}

// ---------- placeholder ----------
export function placeholder(frame, fps, size = THUMB_SIZE, note = '') {
  const c = document.createElement('canvas'); c.width = size; c.height = Math.round(size * 9 / 16);
  const g = c.getContext('2d');
  g.fillStyle = '#2a2d32'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#464a52'; g.strokeRect(0.5, 0.5, c.width - 1, c.height - 1);
  g.fillStyle = '#e6e7ea'; g.font = `${Math.round(size / 12)}px ui-monospace, monospace`; g.textAlign = 'center';
  g.fillText(placeholderTimecode(frame, fps), c.width / 2, c.height / 2);
  if (note) { g.fillStyle = '#8b909a'; g.font = `${Math.round(size / 24)}px sans-serif`; g.fillText(note, c.width / 2, c.height / 2 + size / 10); }
  return c.toDataURL('image/png');
}

// ---------- video per clip ----------
function closeVideo(clipId) {
  const v = videos.get(clipId); if (!v) return;
  v.queue.cancelAll().forEach((t) => t.reject(new Error('cancelled')));
  v.video.removeAttribute('src'); v.video.load(); videos.delete(clipId);
}

async function openVideo(ce, take, useProxy) {
  const info = await ce.getClipMediaPath(take.takeId);
  const path = (useProxy && info.proxyPath) || info.path;
  if (!path) throw new Error('nessun percorso media');
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous'; video.muted = true; video.preload = 'auto'; video.playsInline = true;
  video.src = `ce-media://media/${encodeURIComponent(path)}`;
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('timeout')), 8000);
    video.addEventListener('loadeddata', () => { clearTimeout(to); res(); }, { once: true });
    video.addEventListener('error', () => { clearTimeout(to); rej(new Error(video.error?.message || 'non decodificabile')); }, { once: true });
  });
  return { video, info, usingProxy: useProxy && !!info.proxyPath };
}

async function seekAndDraw(entry, frame, fps, size) {
  const { video } = entry;
  const t = Math.min(Math.max(0, (frame + 0.5) / fps), Math.max(0, (video.duration || 1e9) - 0.01));
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('seek timeout')), 6000);
    video.addEventListener('seeked', () => { clearTimeout(to); res(); }, { once: true });
    video.currentTime = t;
  });
  if ('requestVideoFrameCallback' in video) await new Promise((res) => { const to = setTimeout(res, 250); video.requestVideoFrameCallback(() => { clearTimeout(to); res(); }); });
  const c = document.createElement('canvas'); c.width = size; c.height = Math.round(size * (video.videoHeight || 9) / (video.videoWidth || 16));
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72); // lancia se il canvas e' "tainted"
}

async function runQueue(ce, clipId) {
  const v = videos.get(clipId); if (!v || v.running) return;
  v.running = true;
  for (let t = v.queue.next(); t; t = v.queue.next()) {
    try { t.resolve(await seekAndDraw(v, t.frame, t.fps, t.size)); } catch (e) { t.reject(e); }
  }
  v.running = false;
}

async function viaVideo(ce, req, opts) {
  const { clipId } = req;
  let entry = videos.get(clipId);
  if (!entry) {
    const evict = pool.touch(clipId); if (evict) closeVideo(evict);
    let opened;
    try { opened = await openVideo(ce, req, false); } catch (e1) {
      try { opened = await openVideo(ce, req, true); } catch { throw e1; }
    }
    entry = { ...opened, queue: new SeekQueue(), running: false };
    videos.set(clipId, entry);
  } else pool.touch(clipId);
  return new Promise((resolve, reject) => {
    const cancelled = entry.queue.push({ frame: req.frame, fps: req.fps, size: req.size, scrub: !!opts.scrub, resolve, reject });
    cancelled.forEach((t) => t.reject(new Error('cancelled')));
    runQueue(ce, clipId);
  });
}

/**
 * Miniatura per (clipId, frame). Ritorna {url, placeholder:boolean, reason?}.
 * req: { clipId, takeId, frame, fps }. opts: { scrub:boolean (annullabile), size }.
 */
export async function getThumb(ce, req, opts = {}) {
  const size = opts.size || THUMB_SIZE;
  const key = cacheKey(req.clipId, req.frame, size);
  const hit = mem.get(key); if (hit) return { url: hit, placeholder: false };
  const stored = await idbGet(key);
  if (stored) { mem.set(key, stored, stored.length); return { url: stored, placeholder: false }; }
  if (inflight.has(key) && !opts.scrub) return inflight.get(key);
  const p = (async () => {
    try {
      const full = { ...req, size };
      const url = ce.__synthFrame ? await ce.__synthFrame({ takeId: req.takeId, frame: req.frame, fps: req.fps, size }) : await viaVideo(ce, full, opts);
      mem.set(key, url, url.length); idbPut(key, url);
      return { url, placeholder: false };
    } catch (e) {
      if (e.message === 'cancelled') throw e;
      const why = /tainted|insecure/i.test(e.message) ? 'canvas protetto' : 'codec non decodificabile';
      return { url: placeholder(req.frame, req.fps, size, why), placeholder: true, reason: `${why} (${e.message})` };
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

export function releaseClip(clipId) { closeVideo(clipId); pool.drop(clipId); }
