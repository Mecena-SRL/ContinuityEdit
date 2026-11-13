// Spoglio rapido: tipi, scorciatoie e costruzione dell'operazione editScript.
export const TYPE_OPTIONS = [
  { type: 'action', label: 'Azione', key: 'a' },
  { type: 'dialogue', label: 'Dialogo', key: 'd' },
  { type: 'character', label: 'Personaggio', key: 'p' },
  { type: 'scene', label: 'Scena', key: 's' },
  { type: 'parenthetical', label: 'Parentetica', key: 'e' },
  { type: 'transition', label: 'Transizione', key: 't' },
  { type: 'other', label: 'Altro', key: 'o' },
];

/** Alt+lettera -> tipo (null altrimenti). */
export function typeFromKey(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  const o = TYPE_OPTIONS.find((t) => t.key === String(e.key).toLowerCase());
  return o ? o.type : null;
}

export const clampOffsets = (a, b, len) => {
  const lo = Math.max(0, Math.min(a, b, len));
  const hi = Math.max(0, Math.min(Math.max(a, b), len));
  return [lo, hi];
};

/** Selezione vuota o su tutta la riga -> setType; altrimenti retypeSelection. */
export function buildEdit(line, startOffset, endOffset, type, opts = {}) {
  const len = (line.text || '').length;
  const [s, e] = clampOffsets(startOffset ?? 0, endOffset ?? len, len);
  const whole = e - s <= 0 || (s === 0 && e >= len);
  const extra = opts.character ? { character: opts.character } : {};
  return whole ? { op: 'setType', lineId: line.id, type, ...extra }
    : { op: 'retypeSelection', lineId: line.id, startOffset: s, endOffset: e, type, ...extra };
}
