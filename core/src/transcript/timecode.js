// Conversione timecode <-> frame (non-drop-frame). fps nominale = round(fps).

const DAY_SECONDS = 24 * 3600;

function nominalFps(fps) {
  const n = Math.round(Number(fps));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 'HH:MM:SS:FF' (anche ';' come separatore) -> frame relativi a startTcFrames.
 * Restituisce null se il timecode o fps sono malformati (nessuna eccezione).
 * Ore >= 24 sono accettate; se il risultato è negativo (clip che attraversa
 * la mezzanotte) si aggiunge un giorno.
 */
export function tcToFrames(tc, fps, startTcFrames = 0) {
  const n = nominalFps(fps);
  if (n === null || typeof tc !== 'string') return null;
  const m = /^\s*(\d+)[:;.](\d+)[:;.](\d+)[:;.](\d+)\s*$/.exec(tc);
  if (!m) return null;
  const [h, mi, s, ff] = m.slice(1).map(Number);
  const start = Number.isFinite(startTcFrames) ? startTcFrames : 0;
  let frames = (h * 3600 + mi * 60 + s) * n + ff - start;
  if (frames < 0 && h < 24) frames += DAY_SECONDS * n;
  return frames;
}

/** Frame relativi -> 'HH:MM:SS:FF' assoluto (modulo 24 ore). Null se input non valido. */
export function framesToTc(frames, fps, startTcFrames = 0) {
  const n = nominalFps(fps);
  if (n === null || !Number.isFinite(frames)) return null;
  const start = Number.isFinite(startTcFrames) ? startTcFrames : 0;
  const dayFrames = DAY_SECONDS * n;
  const abs = (((Math.round(frames) + start) % dayFrames) + dayFrames) % dayFrames;
  const ff = abs % n;
  const totalSec = (abs - ff) / n;
  const p = (v) => String(v).padStart(2, '0');
  return `${p(Math.floor(totalSec / 3600))}:${p(Math.floor(totalSec / 60) % 60)}:${p(totalSec % 60)}:${p(ff)}`;
}
