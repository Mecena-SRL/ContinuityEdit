// Conversione timecode <-> frame. fps nominale = round(fps).
// Drop-frame (29.97/59.94): riconosciuto dal separatore ';' prima dei frame ("01:00:00;00"), oppure con
// { dropFrame:true }. Nel drop-frame si saltano 2 (a 30) o 4 (a 60) numeri di frame all'inizio di ogni minuto,
// tranne i minuti multipli di 10: la conversione tiene conto dei numeri saltati, cosi' le distanze tra due
// timecode sono esatte anche su clip lunghe.

const DAY_SECONDS = 24 * 3600;

function nominalFps(fps) {
  const n = Math.round(Number(fps));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Numero di frame saltati per minuto nel drop-frame (0 se il drop-frame non si applica a quel fps). */
export function dropFramesPerMinute(fps) {
  const n = nominalFps(fps);
  if (n === 30) return 2;
  if (n === 60) return 4;
  return 0;
}

/** true se il timecode e' scritto in drop-frame (separatore ';' prima dei frame). */
export const isDropFrameTc = (tc) => typeof tc === 'string' && /;\s*\d+\s*$/.test(tc);

/**
 * 'HH:MM:SS:FF' (o 'HH:MM:SS;FF' drop-frame) -> frame relativi a startTcFrames.
 * Restituisce null se il timecode o fps sono malformati (nessuna eccezione).
 * Ore >= 24 sono accettate; se il risultato è negativo (clip che attraversa
 * la mezzanotte) si aggiunge un giorno.
 * opts.dropFrame forza (true) o esclude (false) il drop-frame; di default lo deduce dal separatore.
 */
export function tcToFrames(tc, fps, startTcFrames = 0, { dropFrame } = {}) {
  const n = nominalFps(fps);
  if (n === null || typeof tc !== 'string') return null;
  const m = /^\s*(\d+)[:;.](\d+)[:;.](\d+)[:;.](\d+)\s*$/.exec(tc);
  if (!m) return null;
  const [h, mi, s, ff] = m.slice(1).map(Number);
  const start = Number.isFinite(startTcFrames) ? startTcFrames : 0;
  const df = (dropFrame ?? isDropFrameTc(tc)) ? dropFramesPerMinute(n) : 0;
  const totalMinutes = h * 60 + mi;
  let frames = (h * 3600 + mi * 60 + s) * n + ff - df * (totalMinutes - Math.floor(totalMinutes / 10)) - start;
  const day = DAY_SECONDS * n - (df ? df * (24 * 60 - 24 * 6) : 0);
  if (frames < 0 && h < 24) frames += day;
  return frames;
}

/**
 * Frame relativi -> 'HH:MM:SS:FF' assoluto (modulo 24 ore). Null se input non valido.
 * opts.dropFrame: true produce 'HH:MM:SS;FF' drop-frame (solo 29.97/59.94).
 */
export function framesToTc(frames, fps, startTcFrames = 0, { dropFrame = false } = {}) {
  const n = nominalFps(fps);
  if (n === null || !Number.isFinite(frames)) return null;
  const start = Number.isFinite(startTcFrames) ? startTcFrames : 0;
  const df = dropFrame ? dropFramesPerMinute(n) : 0;
  const p = (v) => String(v).padStart(2, '0');
  if (df) {
    const per10 = n * 600 - df * 9; // frame reali in 10 minuti
    const perMin = n * 60 - df; // frame reali in un minuto "con drop"
    const dayFrames = per10 * 6 * 24;
    let f = (((Math.round(frames) + start) % dayFrames) + dayFrames) % dayFrames;
    const d = Math.floor(f / per10);
    const r = f % per10;
    f += df * 9 * d + (r > df ? df * Math.floor((r - df) / perMin) : 0);
    const ff = f % n; const totalSec = (f - ff) / n;
    return `${p(Math.floor(totalSec / 3600))}:${p(Math.floor(totalSec / 60) % 60)}:${p(totalSec % 60)};${p(ff)}`;
  }
  const dayFrames = DAY_SECONDS * n;
  const abs = (((Math.round(frames) + start) % dayFrames) + dayFrames) % dayFrames;
  const ff = abs % n;
  const totalSec = (abs - ff) / n;
  return `${p(Math.floor(totalSec / 3600))}:${p(Math.floor(totalSec / 60) % 60)}:${p(totalSec % 60)}:${p(ff)}`;
}
