// Separazione nome base / estensioni di un cue di personaggio (FDX e PDF).
// "V.O. ROSSI", "ROSSI (V.O.) (CONT'D)", "ROSSI V.O." -> { name: 'ROSSI', ext: "V.O. CONT'D" }.
// Le estensioni note valgono anche senza parentesi, come suffisso o prefisso, ma
// solo se resta almeno un altro token come nome ("OFF" o "VOCE" soli restano nomi).

const KNOWN = [
  'VOCE FUORI CAMPO',
  'FUORI CAMPO',
  'AL TELEFONO',
  'VOCE',
  'V\\.?O\\.?',
  'O\\.?S\\.?',
  'O\\.?C\\.?',
  'F\\.?C\\.?',
  'OFF',
  'TEL\\.?',
  "CONT['’`]?D\\.?",
  'CONT\\.?',
  'SEGUE',
  'CONTINUA',
  'MORE',
];
const ALT = KNOWN.join('|');
// upper=false (PDF, testo non normalizzato): le estensioni senza parentesi devono essere in maiuscolo
const RE = {
  true: { suf: new RegExp(`\\s(${ALT})$`, 'i'), pre: new RegExp(`^(${ALT})\\s`, 'i') },
  false: { suf: new RegExp(`\\s(${ALT})$`), pre: new RegExp(`^(${ALT})\\s`) },
};

const clean = (s) => s.replace(/\s+/g, ' ').trim();
const normExt = (e) => clean(e).replace(/[’`]/g, "'").toLocaleUpperCase('it');

/** Come splitCharacter ma con le estensioni come array. */
export function parseCharacter(raw, { upper = true } = {}) {
  const post = [];
  let rest = String(raw ?? '').replace(/\(([^)]*)\)/g, (_, e) => {
    if (clean(e)) post.push(normExt(e));
    return ' ';
  });
  rest = clean(rest.replace(/\^\s*$/, ''));
  const { pre: PREFIX_RE, suf: SUFFIX_RE } = RE[!!upper];
  const pre = [];
  for (let m; (m = PREFIX_RE.exec(rest)); ) {
    pre.push(normExt(m[1]));
    rest = rest.slice(m[0].length).trim();
  }
  const suf = [];
  for (let m; (m = SUFFIX_RE.exec(rest)); ) {
    suf.unshift(normExt(m[1]));
    rest = rest.slice(0, m.index).trim();
  }
  return { name: upper ? rest.toLocaleUpperCase('it') : rest, exts: [...pre, ...suf, ...post] };
}

/** "anna (V.O.) (CONT'D)" -> { name: 'ANNA', ext: "V.O. CONT'D" } (ext null se assente). */
export function splitCharacter(raw) {
  const { name, exts } = parseCharacter(raw);
  return { name, ext: exts.length ? exts.join(' ') : null };
}
