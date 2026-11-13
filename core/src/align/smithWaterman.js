// Allineamento locale (Smith-Waterman) tra due sequenze di token.

/**
 * @param {string[]} script  token della battuta
 * @param {string[]} text    token della finestra di trascrizione
 * @param {(a:string,b:string)=>number} scoreFn punteggio coppia (positivo = match)
 * @param {{gap?:number, blocked?:Uint8Array|null}} o  blocked[j]=1: il token j non puo' essere usato
 * @returns {{score:number, pairs:Array<[number,number]>}|null}
 *   pairs = [indiceScript, indiceText] delle sole coppie con punteggio > 0
 */
export function smithWaterman(script, text, scoreFn, { gap = -1.5, blocked = null } = {}) {
  const n = script.length, m = text.length;
  if (!n || !m) return null;
  const W = m + 1;
  const H = new Float32Array((n + 1) * W);
  const D = new Uint8Array((n + 1) * W); // 0 stop, 1 diag, 2 salta token script, 3 salta token testo
  let best = 0, bi = 0, bj = 0;
  for (let i = 1; i <= n; i++) {
    const si = script[i - 1];
    for (let j = 1; j <= m; j++) {
      const s = blocked && blocked[j - 1] ? -5 : scoreFn(si, text[j - 1]);
      const diag = H[(i - 1) * W + j - 1] + s;
      const up = H[(i - 1) * W + j] + gap;
      const left = H[i * W + j - 1] + gap;
      let v = 0, d = 0;
      if (diag > v) { v = diag; d = 1; }
      if (up > v) { v = up; d = 2; }
      if (left > v) { v = left; d = 3; }
      H[i * W + j] = v;
      D[i * W + j] = d;
      if (v > best) { best = v; bi = i; bj = j; }
    }
  }
  if (best <= 0) return null;
  const pairs = [];
  let i = bi, j = bj;
  while (i > 0 && j > 0) {
    const d = D[i * W + j];
    if (d === 0) break;
    if (d === 1) {
      if (!(blocked && blocked[j - 1]) && scoreFn(script[i - 1], text[j - 1]) > 0) pairs.push([i - 1, j - 1]);
      i--; j--;
    } else if (d === 2) i--;
    else j--;
  }
  pairs.reverse();
  return { score: best, pairs };
}
