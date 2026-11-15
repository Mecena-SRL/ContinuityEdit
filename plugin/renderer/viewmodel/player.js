// Lettore integrato: logica pura (testata). Tempi del <video> in secondi, frame interi relativi alla clip.

/** Frame mostrato al tempo t (s). */
export const frameAt = (t, fps) => Math.max(0, Math.floor(Number(t) * fps + 1e-4));
/** Tempo (s) per mostrare il frame f: meta' frame, cosi' il decoder non cade sul precedente. */
export const timeOfFrame = (f, fps) => (Math.max(0, f) + 0.5) / fps;

/**
 * JKL come in Avid/Resolve: L avanti (1x, 2x, 4x, 8x), J indietro (-1x, -2x...), K ferma.
 * Ritorna la nuova velocita' (0 = fermo).
 */
export function rateAfterKey(rate, key) {
  const k = String(key).toLowerCase();
  if (k === 'k') return 0;
  if (k === 'l') return rate > 0 ? Math.min(8, rate * 2) : 1;
  if (k === 'j') return rate < 0 ? Math.max(-8, rate * 2) : -1;
  return rate;
}
export const rateLabel = (r) => (r === 0 ? '' : r === 1 ? '' : `${r > 0 ? '' : '◀ '}${Math.abs(r)}×`);

/** Indice dell'ultima parola iniziata a `frame` (ricerca binaria) o -1. */
export function wordIndexAt(words, frame) {
  let lo = 0; let hi = (words?.length || 0) - 1; let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].startFrame <= frame) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Copertura che contiene il frame (a parita' vince quella iniziata dopo). */
export function coverageAt(coverage, frame) {
  let best = null;
  for (const c of coverage || []) if (frame >= c.startFrame && frame < c.endFrame && (!best || c.startFrame >= best.startFrame)) best = c;
  return best;
}

/** Parole del testo con gli spazi, per evidenziarle una a una. */
export const splitWords = (text) => String(text || '').split(/(\s+)/).filter((x) => x !== '');

/**
 * Karaoke sullo script: quante parole della riga sono "gia' dette" al frame. Usa i tempi delle parole trascritte
 * dentro la copertura della riga; senza trascrizione (riga muta) avanza in proporzione al tempo.
 * Ritorna { spoken, total, fraction }.
 */
export function karaoke(text, cov, words, frame) {
  const total = splitWords(text).filter((w) => /\S/.test(w)).length;
  if (!cov || !total) return { spoken: 0, total, fraction: 0 };
  if (frame < cov.startFrame) return { spoken: 0, total, fraction: 0 };
  if (frame >= cov.endFrame) return { spoken: total, total, fraction: 1 };
  const inside = (words || []).filter((w) => w.startFrame >= cov.startFrame && w.startFrame < cov.endFrame);
  let fraction;
  if (inside.length) fraction = inside.filter((w) => w.startFrame <= frame).length / inside.length;
  else fraction = (frame - cov.startFrame) / Math.max(1, cov.endFrame - cov.startFrame);
  return { spoken: Math.max(0, Math.min(total, Math.round(fraction * total))), total, fraction };
}

/** In/Out ordinati e dentro la clip (out esclusa). null se incompleti. */
export function markRange(mIn, mOut, dur) {
  if (mIn == null && mOut == null) return null;
  let a = Math.max(0, Math.min(dur - 1, mIn ?? 0));
  let b = Math.max(1, Math.min(dur, mOut ?? dur));
  if (b <= a) [a, b] = [Math.max(0, b - 1), Math.min(dur, a + 1)];
  return { startFrame: a, endFrame: b };
}

/**
 * Anteprima della sequenza: cosa si vede e si sente al tempo `rec` (frame di timeline relativi alla sequenza).
 * layout = view.sequence (items con rec/len/track/startFrame/clipId); fpsOf(clipId) e timelineFps per fps diversi.
 * Ritorna { master:{id,takeId,clipId,srcFrame}|null, overlay:{...}|null } (overlay = traccia piu' alta che copre rec).
 */
export function sequenceAt(layout, rec, { fpsOf = () => null, timelineFps = null } = {}) {
  const src = (x) => {
    const cf = fpsOf(x.clipId); const off = rec - x.rec;
    const s = cf && timelineFps && Math.abs(cf - timelineFps) > 0.01 ? Math.round((off * cf) / timelineFps) : off;
    return { id: x.id, takeId: x.takeId, clipId: x.clipId, srcFrame: x.startFrame + s, endFrame: x.endFrame, rec: x.rec, len: x.len };
  };
  let master = null; let overlay = null;
  for (const x of layout?.items || []) {
    if (x.rec == null || rec < x.rec || rec >= x.rec + x.len) continue;
    if (x.track === 1) master = src(x);
    else if (!overlay || x.track > overlay.track) overlay = { ...src(x), track: x.track };
  }
  return { master, overlay };
}

/** Prossimo punto di cambio (inizio/fine di un pezzo) dopo rec: serve a cambiare sorgente al momento giusto. */
export function nextBoundary(layout, rec) {
  let n = Infinity;
  for (const x of layout?.items || []) {
    if (x.rec == null) continue;
    for (const b of [x.rec, x.rec + x.len]) if (b > rec && b < n) n = b;
  }
  return n;
}

/** Messaggio chiaro quando il <video> non decodifica il file. */
export function mediaErrorText({ codec, hasProxy, triedProxy }) {
  const c = codec ? ` (${codec})` : '';
  if (triedProxy) return `Né il file né il proxy si riproducono nel pannello${c}. Usa "Mostra in Resolve" per guardare la clip nel visore.`;
  if (hasProxy) return `Il file originale${c} non si riproduce nel pannello: provo il proxy.`;
  return `Il pannello non riproduce questo formato${c}. In Resolve: tasto destro sulla clip > Genera media proxy (H.264 o H.265), poi riprova. Intanto puoi usare "Mostra in Resolve".`;
}
