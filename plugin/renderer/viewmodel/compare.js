// Confronto fra i take che coprono una riga + ancore e avvisi per riga/take.

/** Take che coprono la riga: migliore prima, poi ratio, poi durata. */
export function compareTakes(lineId, view, selection = {}, clips = {}) {
  const out = [];
  view.takes.forEach((t, i) => {
    const c = (view.coverage?.[t.id] || []).find((x) => x.lineId === lineId);
    if (!c) return;
    const fps = clips[t.clipId]?.fps ?? 25;
    out.push({
      takeId: t.id, label: t.label || t.name || t.id, colorIndex: i,
      startFrame: c.startFrame, endFrame: c.endFrame, durationFrames: Math.max(0, c.endFrame - c.startFrame), fps,
      ratio: c.ratio ?? null, source: c.source, estimated: !!c.estimated,
      best: view.bestTake?.[lineId] === t.id, chosen: selection[lineId] === t.id,
    });
  });
  return out.sort((a, b) => (b.best - a.best) || ((b.ratio ?? -1) - (a.ratio ?? -1)) || (b.durationFrames - a.durationFrames));
}

/** Ancore di una riga (opzionalmente per un take), ordinate start/point/end. */
export function anchorsForLine(anchors, lineId, takeId = null) {
  const rank = { start: 0, point: 1, end: 2 };
  return (anchors || [])
    .filter((a) => a.lineId === lineId && (!takeId || a.takeId === takeId))
    .sort((a, b) => (rank[a.edge] - rank[b.edge]) || a.frame - b.frame);
}

/** Avvisi di coerenza (view.warnings) che coinvolgono le ancore di una riga/take. */
export function warningsFor(warnings, anchors, lineId, takeId) {
  const ids = new Set(anchorsForLine(anchors, lineId, takeId).map((a) => a.id));
  return (warnings || []).filter((w) => (w.anchorIds || []).some((id) => ids.has(id)));
}

export function sortedMarkers(markers) {
  return [...(markers || [])].sort((a, b) => a.frame - b.frame);
}

export function edgeLabel(edge) {
  return ({ start: 'Inizio', end: 'Fine', point: 'Punto' })[edge] || edge;
}
