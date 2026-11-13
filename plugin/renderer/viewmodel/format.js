// Formattazione pura: frame -> timecode, durate, colori dei take.

/** fps nominale (23.976 -> 24, 29.97 -> 30), default 25. */
export function nominalFps(fps) {
  const n = Math.round(Number(fps));
  return Number.isFinite(n) && n > 0 ? n : 25;
}

/** Frame relativo alla clip -> "HH:MM:SS:FF" (non drop-frame). startTcFrames opzionale = TC assoluto. */
export function framesToTimecode(frame, fps, startTcFrames = 0) {
  const n = nominalFps(fps);
  let f = Math.max(0, Math.round((Number(frame) || 0) + (Number(startTcFrames) || 0)));
  const ff = f % n; f = (f - ff) / n;
  const ss = f % 60; f = (f - ss) / 60;
  const mm = f % 60; const hh = (f - mm) / 60;
  const p = (v) => String(v).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

/** Durata in frame -> "12.4 s" oppure "1:05.2". */
export function formatDuration(frames, fps) {
  const sec = Math.max(0, (Number(frames) || 0) / nominalFps(fps));
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** Campo manuale: intero di frame ("120") oppure timecode HH:MM:SS:FF relativo alla clip. null se non valido. */
export function parseFrameInput(text, fps) {
  const s = String(text ?? '').trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = /^(\d+):(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(s);
  if (!m) return null;
  const n = nominalFps(fps);
  const [h, mi, se, ff] = m.slice(1).map(Number);
  if (mi > 59 || se > 59 || ff >= n) return null;
  return (h * 3600 + mi * 60 + se) * n + ff;
}

/** Tavolozza dei take (leggibile su fondo scuro). */
export const TAKE_COLORS = ['#4fa3ff', '#ff9f43', '#4cd38a', '#e56bd0', '#f2d14a', '#38d0d8', '#ff6b6b', '#a78bfa'];

export function takeColor(index) {
  const n = TAKE_COLORS.length;
  return TAKE_COLORS[((index % n) + n) % n];
}

/** Etichetta di un take: label, altrimenti nome clip, altrimenti id. */
export function takeTitle(take) {
  return (take && (take.label || take.name || take.id)) || '';
}

export function percent(r) {
  return r == null || !Number.isFinite(r) ? '–' : `${Math.round(r * 100)}%`;
}
