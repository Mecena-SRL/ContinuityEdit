// Linee verticali di copertura (stile ScriptSync): una colonna per take;
// ogni segmento copre righe visibili consecutive coperte da quel take (altezza = righe coperte).

/** Mappa takeId -> Map(lineId -> entry di copertura). */
export function coverageIndex(coverage) {
  const out = new Map();
  for (const [takeId, list] of Object.entries(coverage || {})) {
    const m = new Map();
    for (const c of list || []) m.set(c.lineId, c);
    out.set(takeId, m);
  }
  return out;
}

/**
 * @param visibleLines righe mostrate (dopo i filtri), in ordine
 * @param takes view.takes
 * @param coverage view.coverage
 * @param selection project.selection {lineId: takeId}
 * @param bestTake view.bestTake
 * @returns {{columns, rows, segments}}
 *  columns: [{takeId, col, colorIndex}]
 *  rows: { [lineId]: [{takeId, col, covered, pos:'single'|'start'|'mid'|'end'|null, estimated, source, chosen, best}] }
 *  segments: [{takeId, col, fromRow, toRow, lineIds, estimated, source, rows}]
 */
export function buildCoverageLayout(visibleLines, takes, coverage, selection = {}, bestTake = {}) {
  const idx = coverageIndex(coverage);
  const columns = takes.map((t, i) => ({ takeId: t.id, col: i, colorIndex: i }));
  const rows = {};
  for (const l of visibleLines) rows[l.id] = [];
  const segments = [];
  for (const colInfo of columns) {
    const cov = idx.get(colInfo.takeId) || new Map();
    let run = null;
    const flush = () => {
      if (!run) return;
      const n = run.lineIds.length;
      run.cells.forEach((cell, k) => { cell.pos = n === 1 ? 'single' : k === 0 ? 'start' : k === n - 1 ? 'end' : 'mid'; });
      const sources = new Set(run.cells.map((c) => c.source));
      segments.push({
        takeId: colInfo.takeId, col: colInfo.col, fromRow: run.from, toRow: run.from + n - 1,
        lineIds: run.lineIds, estimated: run.estimated, source: sources.size === 1 ? [...sources][0] : 'mixed', rows: n,
      });
      run = null;
    };
    visibleLines.forEach((l, i) => {
      const c = cov.get(l.id);
      const cell = {
        takeId: colInfo.takeId, col: colInfo.col, covered: !!c, pos: null,
        estimated: !!(c && c.estimated), source: c ? c.source : null,
        chosen: selection[l.id] === colInfo.takeId, best: bestTake[l.id] === colInfo.takeId,
      };
      rows[l.id].push(cell);
      if (!c) { flush(); return; }
      if (run && run.estimated !== cell.estimated) flush(); // stile diverso = nuovo segmento
      if (!run) run = { from: i, lineIds: [], cells: [], estimated: cell.estimated };
      run.lineIds.push(l.id);
      run.cells.push(cell);
    });
    flush();
  }
  return { columns, rows, segments };
}

/** Tipo di sorgente per l'icona: 'auto' | 'manual' | 'mixed' | 'interpolated'. */
export function sourceKind(source) {
  return ['manual', 'mixed', 'interpolated'].includes(source) ? source : 'auto';
}

export function sourceLabel(source) {
  return ({ manual: 'manuale', auto: 'automatico', mixed: 'misto', interpolated: 'interpolato' })[source] || 'automatico';
}

/** Righe sincronizzabili non coperte da alcun take. Ritorna Set di lineId. */
export function uncoveredLineIds(lines, coverage) {
  const covered = new Set();
  for (const list of Object.values(coverage || {})) for (const c of list || []) covered.add(c.lineId);
  return new Set(lines.filter((l) => l.syncable && !covered.has(l.id)).map((l) => l.id));
}
