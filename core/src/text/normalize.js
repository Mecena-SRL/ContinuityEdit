// Normalizzazione condivisa tra script e trascrizione (italiano/inglese).
// Regole: minuscolo, apostrofi tipografici -> ', accenti rimossi, punteggiatura via,
// elisioni separate ("l'occasione" -> "l", "occasione"). I numeri restano cifre.

export function normalizeToken(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9']/g, '')
    .replace(/^'+|'+$/g, '');
}

/** Spezza un testo in token normalizzati (senza token vuoti). */
export function splitTokens(text) {
  return String(text)
    .replace(/[‘’ʼ`]/g, "'")
    .split(/[\s'—–-]+/)
    .map(normalizeToken)
    .filter(Boolean);
}
