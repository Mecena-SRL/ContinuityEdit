// Scansione clip: logica pura per classificare in fretta i take come Totale/Medio/Stretto/Dettaglio/Altro.
// Stati di un take: 'confermato' (shot con provenienza manuale/copertura), 'proposta' (shot da metadati non ancora
// confermato, oppure ipotesi di copertura non ancora scritta), 'mancante' (nessuna informazione).

export const SHOT_OPTIONS = [
  { shot: 'totale', label: 'Totale', abbr: 'TOT', key: '1' },
  { shot: 'medio', label: 'Medio', abbr: 'MED', key: '2' },
  { shot: 'stretto', label: 'Stretto', abbr: 'STR', key: '3' },
  { shot: 'dettaglio', label: 'Dettaglio', abbr: 'DET', key: '4' },
  { shot: 'altro', label: 'Altro', abbr: 'ALT', key: '5' },
];

export const shotLabel = (shot) => SHOT_OPTIONS.find((o) => o.shot === shot)?.label || '';
export const shotAbbr = (shot) => SHOT_OPTIONS.find((o) => o.shot === shot)?.abbr || '';
export const shotFromKey = (key) => SHOT_OPTIONS.find((o) => o.key === key)?.shot || null;

export const SOURCE_LABELS = { manuale: 'confermato', metadati: 'da metadati', copertura: 'da copertura' };
export const sourceLabel = (source) => SOURCE_LABELS[source] || '';

/** 3 frame per il foglio di contatto: inizio, meta', fine (con un piccolo margine dai bordi). */
export function sheetFrames(durationFrames) {
  const d = Math.max(1, Math.floor(durationFrames) || 1);
  const last = d - 1;
  const at = (r) => Math.max(0, Math.min(last, Math.round(last * r)));
  return [at(0.04), at(0.5), at(0.96)];
}

/**
 * Stato di classificazione di un take.
 * hyp: ipotesi di copertura non scritta { shot } (da suggestMaster.hypotheses) per quel take, se presente.
 * -> { state, shot, source, proposed } dove proposed e' lo shot che Invio confermerebbe (o null).
 */
export function shotState(take, hyp = null) {
  if (take?.shot && (take.shotSource === 'manuale' || take.shotSource === 'copertura')) {
    return { state: 'confermato', shot: take.shot, source: take.shotSource, proposed: null };
  }
  if (take?.shot) return { state: 'proposta', shot: take.shot, source: take.shotSource || 'metadati', proposed: { shot: take.shot, source: 'manuale' } };
  if (hyp?.shot) return { state: 'proposta', shot: hyp.shot, source: null, proposed: { shot: hyp.shot, source: 'copertura' } };
  return { state: 'mancante', shot: null, source: null, proposed: null };
}

/** Conteggi per la barra di avanzamento. */
export function scanProgress(takes, hyps = {}) {
  let confermati = 0; let proposte = 0; let mancanti = 0;
  for (const t of takes) {
    const s = shotState(t, hyps[t.id]).state;
    if (s === 'confermato') confermati++; else if (s === 'proposta') proposte++; else mancanti++;
  }
  return { totale: takes.length, confermati, proposte, mancanti, daFare: proposte + mancanti };
}

/** Filtro vista: 'tutti' | 'da-fare' (proposte + mancanti) | 'mancanti'. */
export function filterScanTakes(takes, filter, hyps = {}) {
  if (filter === 'tutti') return takes;
  return takes.filter((t) => {
    const s = shotState(t, hyps[t.id]).state;
    return filter === 'mancanti' ? s === 'mancante' : s !== 'confermato';
  });
}

/** Indice successivo/precedente con wrap nullo (si ferma ai bordi). */
export const stepIndex = (i, dir, n) => (n <= 0 ? -1 : Math.max(0, Math.min(n - 1, i + dir)));

/**
 * Azione per un tasto sul take: 1-5 = imposta, Invio = conferma la proposta, 0/Backspace = azzera.
 * -> { type:'set', shot, source } | { type:'clear' } | null (niente da fare).
 */
export function actionForKey(key, take, hyp = null) {
  const shot = shotFromKey(key);
  if (shot) return { type: 'set', shot, source: 'manuale' };
  if (key === 'Enter') {
    const p = shotState(take, hyp).proposed;
    return p ? { type: 'set', shot: p.shot, source: p.source } : null;
  }
  if (key === '0' || key === 'Backspace' || key === 'Delete') return take?.shot ? { type: 'clear' } : null;
  return null;
}

/** Sezioni per la vista di gruppo: i gruppi (ordinati per id) e infine i take senza gruppo. */
export function groupSections(takes) {
  const by = new Map();
  const loose = [];
  for (const t of takes) {
    if (t.groupId) { if (!by.has(t.groupId)) by.set(t.groupId, []); by.get(t.groupId).push(t); } else loose.push(t);
  }
  const out = [...by].sort(([a], [b]) => a.localeCompare(b, 'it', { numeric: true })).map(([groupId, list]) => ({ groupId, takes: list }));
  if (loose.length) out.push({ groupId: null, takes: loose });
  return out;
}

/** Etichetta breve per colonne/linee verticali: 'TOT'; con '?' solo se e' una semplice ipotesi non scritta. */
export function shotTag(take, hyp = null) {
  const s = shotState(take, hyp);
  if (!s.shot) return '';
  return `${shotAbbr(s.shot)}${s.source == null ? '?' : ''}`;
}
