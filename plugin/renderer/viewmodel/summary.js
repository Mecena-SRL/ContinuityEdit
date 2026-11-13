// Riepiloghi: anteprima parser (confidence/warnings), copertura per take, assemblaggio.

export const LOW_CONFIDENCE = 0.75;

/** Righe con `confidence` (0..1) sotto soglia. */
export function lowConfidenceLines(lines, threshold = LOW_CONFIDENCE) {
  return lines.filter((l) => typeof l.confidence === 'number' && l.confidence < threshold);
}

/** Riepilogo dello script: conteggi per tipo e confidence. */
export function scriptSummary(scriptDoc, confidence = null) {
  const lines = scriptDoc?.lines || [];
  const counts = { scene: 0, action: 0, dialogue: 0, other: 0 };
  for (const l of lines) {
    if (l.type in counts) counts[l.type]++; else counts.other++;
  }
  const withConf = lines.filter((l) => typeof l.confidence === 'number');
  let avg = typeof confidence === 'number' ? confidence : null;
  if (avg == null && withConf.length) avg = withConf.reduce((s, l) => s + l.confidence, 0) / withConf.length;
  return {
    title: scriptDoc?.title || '', source: scriptDoc?.source || '', scenes: scriptDoc?.scenes?.length ?? counts.scene,
    lines: lines.length, ...counts, confidence: avg, low: lowConfidenceLines(lines).length,
  };
}

/** Per ogni take: righe coperte / sincronizzabili, auto vs manuali. */
export function takeStats(view) {
  const syncable = view.lines.filter((l) => l.syncable).length;
  const out = {};
  for (const t of view.takes) {
    const cov = view.coverage?.[t.id] || [];
    out[t.id] = {
      covered: cov.length, syncable,
      auto: cov.filter((c) => c.source === 'auto').length,
      manual: cov.filter((c) => c.source === 'manual' || c.source === 'mixed').length,
      estimated: cov.filter((c) => c.estimated).length,
    };
  }
  return out;
}

/** Riepilogo assemblaggio in italiano. */
export function assemblySummary(r) {
  if (!r) return '';
  if (!r.ok) return `Assemblaggio non riuscito${r.reason ? `: ${r.reason}` : ''}.`;
  const sk = r.skipped?.length || 0;
  let s = `Timeline "${r.timelineName}": ${r.itemsAdded} ${r.itemsAdded === 1 ? 'clip aggiunta' : 'clip aggiunte'}`;
  if (sk) s += `, ${sk} ${sk === 1 ? 'riga saltata' : 'righe saltate'}`;
  return `${s}.`;
}

export function skipReasonLabel(reason) {
  return ({ 'nessun-take': 'nessun take', 'non-coperta': 'riga non coperta' })[reason] || reason;
}
