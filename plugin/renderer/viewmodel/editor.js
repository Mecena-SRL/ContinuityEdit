// Editor di sequenza (mini-montaggio): geometria pura del pannello timeline (testata).
// Tempi in frame di timeline relativi all'inizio della sequenza; x in pixel dentro l'area delle corsie.

export const LANE_H = 34;
export const MIN_PPF = 0.05;
export const MAX_PPF = 12;

/** Zoom che fa stare tutta la sequenza nella larghezza (con un po' di margine a destra). */
export function fitZoom(total, width) {
  if (!(total > 0) || !(width > 0)) return 1;
  return Math.max(MIN_PPF, Math.min(MAX_PPF, (width * 0.92) / total));
}
export const zoomStep = (ppf, dir) => Math.max(MIN_PPF, Math.min(MAX_PPF, ppf * (dir > 0 ? 1.5 : 1 / 1.5)));

export const xOf = (frame, ppf) => frame * ppf;
export const frameOfX = (x, ppf) => Math.max(0, Math.round(x / ppf));

/** Tacche del righello: intervallo "tondo" in secondi scelto per avere ~90 px tra le tacche principali. */
export function rulerTicks(total, ppf, fps, width) {
  const n = Math.max(1, Math.round(fps) || 25);
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].map((s) => s * n);
  const major = steps.find((s) => s * ppf >= 90) || steps[steps.length - 1];
  const end = Math.max(total, Math.ceil(width / ppf));
  const ticks = [];
  for (let f = 0; f <= end; f += major) ticks.push({ frame: f, x: f * ppf, label: shortTc(f, n) });
  return ticks;
}
export function shortTc(frame, fps) {
  const n = Math.max(1, Math.round(fps) || 25);
  const s = Math.floor(frame / n);
  const p = (v) => String(v).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`;
}

/** Punti di aggancio: inizio/fine dei pezzi, inizio delle righe (marker), playhead. */
export function snapTargets(layout, markers = [], playhead = null, exceptId = null) {
  const t = new Set([0]);
  for (const x of layout?.items || []) if (x.rec != null && x.id !== exceptId) { t.add(x.rec); t.add(x.rec + x.len); }
  for (const m of markers) t.add(m.recordFrame);
  if (Number.isFinite(playhead)) t.add(playhead);
  return [...t].sort((a, b) => a - b);
}

/** Aggancia `frame` al punto piu' vicino entro `tolPx` pixel. Ritorna { frame, snapped }. */
export function snapFrame(frame, targets, ppf, tolPx = 7) {
  let best = null; let bd = Infinity;
  for (const t of targets) { const d = Math.abs(t - frame) * ppf; if (d < bd) { bd = d; best = t; } }
  return best !== null && bd <= tolPx ? { frame: best, snapped: true } : { frame, snapped: false };
}

/** Corsia (1 = V1) dalla y dentro l'area delle corsie: V piu' alte in alto come in Resolve. */
export const trackFromY = (y, tracks) => Math.max(1, Math.min(tracks, tracks - Math.floor(y / LANE_H)));

/** Numero di corsie da disegnare: almeno V1..V3, piu' una libera sopra l'ultima usata. */
export const laneCount = (layout) => Math.max(3, ...(layout?.items || []).map((x) => (x.track || 1) + 1));

/** Pezzo sotto il punto (frame, traccia). */
export function hitItem(layout, frame, track) {
  return (layout?.items || []).find((x) => x.track === track && x.rec != null && frame >= x.rec && frame < x.rec + x.len) || null;
}

/** Durata leggibile di un pezzo: "4.2 s". */
export const secs = (frames, fps) => `${(frames / (fps || 25)).toFixed(1)} s`;
