// Raggruppamento per scena, filtri e ricerca sulle righe della sceneggiatura (pure).

/** Normalizza per la ricerca: minuscole, senza accenti. */
export function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Elenco scene [{id, heading, count}] nell'ordine in cui compaiono le righe. */
export function sceneList(lines) {
  const out = [];
  const idx = new Map();
  for (const l of lines) {
    const id = l.sceneId ?? '';
    if (!idx.has(id)) { idx.set(id, out.length); out.push({ id, heading: '', count: 0 }); }
    const s = out[idx.get(id)];
    s.count++;
    if (l.type === 'scene' && !s.heading) s.heading = l.text;
  }
  for (const s of out) if (!s.heading) s.heading = s.id ? `Scena ${s.id}` : 'Senza scena';
  return out;
}

/** Filtra per scena e testo (testo o personaggio). Mantiene l'ordine originale. */
export function filterLines(lines, { sceneId = null, query = '' } = {}) {
  const q = fold(query).trim();
  return lines.filter((l) => {
    if (sceneId && l.sceneId !== sceneId) return false;
    if (!q) return true;
    return fold(l.text).includes(q) || fold(l.character).includes(q);
  });
}

/** Id delle righe che contengono la ricerca. */
export function searchMatches(lines, query) {
  const q = fold(query).trim();
  if (!q) return [];
  return lines.filter((l) => fold(l.text).includes(q) || fold(l.character).includes(q)).map((l) => l.id);
}

/** Spezza il testo in parti {text, hit} per evidenziare la ricerca (insensibile ad accenti e maiuscole). */
export function highlightParts(text, query) {
  const src = String(text ?? '');
  const q = fold(query).trim();
  if (!q) return [{ text: src, hit: false }];
  const folded = [...src].map((c) => fold(c)).join('');
  if (folded.length !== src.length) return [{ text: src, hit: false }];
  const parts = [];
  let pos = 0;
  for (;;) {
    const i = folded.indexOf(q, pos);
    if (i < 0) break;
    if (i > pos) parts.push({ text: src.slice(pos, i), hit: false });
    parts.push({ text: src.slice(i, i + q.length), hit: true });
    pos = i + q.length;
  }
  if (pos < src.length) parts.push({ text: src.slice(pos), hit: false });
  return parts.length ? parts : [{ text: src, hit: false }];
}

/** Id delle righe visibili tra due righe, estremi inclusi. */
export function rangeBetween(visibleLines, idA, idB) {
  const a = visibleLines.findIndex((l) => l.id === idA);
  const b = visibleLines.findIndex((l) => l.id === idB);
  if (a < 0 || b < 0) return b >= 0 ? [idB] : [];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return visibleLines.slice(lo, hi + 1).map((l) => l.id);
}

/**
 * Aggiorna la selezione multipla. mode: 'replace' | 'toggle' (ctrl/cmd) | 'range' (shift).
 * Ritorna { selected: string[] (ordine script), anchor }.
 */
export function updateSelection(visibleLines, current, anchorId, clickedId, mode) {
  let set;
  let anchor = anchorId;
  if (mode === 'range' && anchorId) {
    set = new Set(rangeBetween(visibleLines, anchorId, clickedId));
  } else if (mode === 'toggle') {
    set = new Set(current);
    if (set.has(clickedId)) set.delete(clickedId); else set.add(clickedId);
    anchor = clickedId;
  } else {
    set = new Set([clickedId]);
    anchor = clickedId;
  }
  const selected = visibleLines.filter((l) => set.has(l.id)).map((l) => l.id);
  return { selected, anchor };
}

/** Ordina gli id secondo l'ordine delle righe (scarta quelli sconosciuti). */
export function sortByScriptOrder(lines, ids) {
  const pos = new Map(lines.map((l, i) => [l.id, i]));
  return [...ids].filter((id) => pos.has(id)).sort((a, b) => pos.get(a) - pos.get(b));
}

export function lineTypeLabel(type) {
  return ({ scene: 'Scena', action: 'Azione', dialogue: 'Battuta', character: 'Personaggio', parenthetical: 'Indicazione', transition: 'Transizione', other: 'Altro' })[type] || type;
}
