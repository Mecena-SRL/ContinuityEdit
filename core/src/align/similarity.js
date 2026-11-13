// Similarità tra token: Levenshtein normalizzata + tolleranza per numeri/cifre.

/** Distanza di Levenshtein (due righe di memoria). */
export function levenshtein(a, b) {
  if (a === b) return 0;
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  let prev = new Uint16Array(m + 1);
  let cur = new Uint16Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}

const NUM_PARTS =
  'zero|uno|una|un|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|tredici|quattordici|' +
  'quindici|sedici|diciassette|diciotto|diciannove|venti|vent|trenta|trent|quaranta|quarant|cinquanta|cinquant|' +
  'sessanta|sessant|settanta|settant|ottanta|ottant|novanta|novant|cento|cent|mille|mila|milione|milioni';
const NUMBER_WORD = new RegExp(`^(?:${NUM_PARTS})+$`);
const DIGITS = /^[0-9]+$/;

/** Vero se il token e' una parola-numero italiana (es. "trentacinque"). */
export function isNumberWord(t) {
  return t.length >= 3 && NUMBER_WORD.test(t);
}
export function isDigits(t) {
  return DIGITS.test(t);
}

/**
 * Similarità 0..1 tra due token normalizzati.
 * - uguali: 1
 * - cifre vs parola-numero (ASR scrive "35" o "trentacinque"): 0.75
 * - token corti (<=3 caratteri) o cifre diverse: solo uguaglianza
 * - altrimenti 1 - lev/maxLen
 */
export function tokenSimilarity(a, b) {
  if (a === b) return 1;
  const da = isDigits(a), db = isDigits(b);
  if (da || db) {
    if (da && db) return 0;
    return isNumberWord(da ? b : a) ? 0.75 : 0;
  }
  const la = a.length, lb = b.length;
  const max = Math.max(la, lb);
  if (max <= 3) return 0;
  if (Math.abs(la - lb) > 0.4 * max) return 0;
  return 1 - levenshtein(a, b) / max;
}

/**
 * Punteggio di allineamento per una similarità: negativo sotto soglia,
 * 1..2 sopra soglia (graduato), 2 per match esatto.
 */
export function matchScore(sim, threshold = 0.7, mismatch = -1.2) {
  if (sim >= 0.999) return 2;
  if (sim < threshold) return mismatch;
  return 1 + (0.8 * (sim - threshold)) / (1 - threshold);
}
