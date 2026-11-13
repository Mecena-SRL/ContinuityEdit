// Logica pura per le miniature: chiavi di cache, LRU, pool video, coda di seek, frame da posizione.

export const THUMB_SIZE = 320;
export const MAX_VIDEOS = 3;
export const MAX_CACHE_BYTES = 200 * 1024 * 1024;

export const cacheKey = (clipId, frame, size = THUMB_SIZE) => `${clipId}|${Math.round(frame)}|${size}`;

/** Posizione x (0..width) sulla barra -> frame intero della clip. */
export function frameFromX(x, width, durationFrames) {
  if (!(width > 0) || !(durationFrames > 0)) return 0;
  const r = Math.max(0, Math.min(1, x / width));
  return Math.max(0, Math.min(durationFrames - 1, Math.round(r * (durationFrames - 1))));
}
export const xFromFrame = (frame, width, durationFrames) => (durationFrames > 1 ? (frame / (durationFrames - 1)) * width : 0);

/** Aggancia il frame a una griglia (scrub veloce a bassa risoluzione: piu' hit di cache). */
export const quantizeFrame = (frame, step) => (step > 1 ? Math.round(frame / step) * step : Math.round(frame));

/** N frame equidistanti (centrati negli N segmenti) per la scansione automatica. */
export function autoScanFrames(n, durationFrames) {
  const count = Math.max(1, Math.min(60, Math.floor(n)));
  return Array.from({ length: count }, (_, i) => Math.max(0, Math.min(durationFrames - 1, Math.round(((i + 0.5) / count) * durationFrames))));
}

/** LRU con limite sul peso (byte) e/o sul numero di voci. get/set aggiornano la recenza. */
export class LruCache {
  constructor({ maxBytes = Infinity, maxItems = Infinity } = {}) { this.maxBytes = maxBytes; this.maxItems = maxItems; this.map = new Map(); this.bytes = 0; }
  get(k) { if (!this.map.has(k)) return undefined; const v = this.map.get(k); this.map.delete(k); this.map.set(k, v); return v.value; }
  has(k) { return this.map.has(k); }
  set(k, value, size = 1) {
    if (this.map.has(k)) { this.bytes -= this.map.get(k).size; this.map.delete(k); }
    this.map.set(k, { value, size }); this.bytes += size;
    const evicted = [];
    while ((this.bytes > this.maxBytes || this.map.size > this.maxItems) && this.map.size > 1) {
      const [ok, ov] = this.map.entries().next().value; this.map.delete(ok); this.bytes -= ov.size; evicted.push(ok);
    }
    return evicted;
  }
  get size() { return this.map.size; }
}

/** Sceglie le voci da eliminare da un indice [{key,size,ts}] perche' il totale rientri in maxBytes (piu' vecchie prima). */
export function pruneIndex(entries, maxBytes) {
  let total = entries.reduce((s, e) => s + e.size, 0);
  const out = [];
  for (const e of [...entries].sort((a, b) => a.ts - b.ts)) { if (total <= maxBytes) break; out.push(e.key); total -= e.size; }
  return out;
}

/** Pool LRU di video attivi: touch(clipId) -> clipId da chiudere (o null). */
export class VideoPool {
  constructor(max = MAX_VIDEOS) { this.max = max; this.order = []; }
  touch(clipId) {
    this.order = this.order.filter((c) => c !== clipId); this.order.push(clipId);
    return this.order.length > this.max ? this.order.shift() : null;
  }
  drop(clipId) { this.order = this.order.filter((c) => c !== clipId); }
}

/** Coda di seek per un video: concorrenza 1; le richieste "scrub" nuove annullano quelle scrub ancora in attesa. */
export class SeekQueue {
  constructor() { this.pending = []; this.running = false; }
  /** Ritorna i task annullati (da rifiutare). */
  push(task) {
    const cancelled = [];
    if (task.scrub) this.pending = this.pending.filter((t) => { if (t.scrub) { cancelled.push(t); return false; } return true; });
    this.pending.push(task);
    return cancelled;
  }
  next() { return this.pending.shift() || null; }
  cancelAll() { const c = this.pending; this.pending = []; return c; }
}

/** Timecode semplice HH:MM:SS:FF per il segnaposto. */
export function placeholderTimecode(frame, fps) {
  const n = Math.max(1, Math.round(fps) || 25); const f = Math.max(0, Math.round(frame));
  const p = (v) => String(v).padStart(2, '0');
  const s = Math.floor(f / n);
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f % n)}`;
}
