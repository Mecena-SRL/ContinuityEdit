'use strict';
// Stato in memoria del main: SyncProject + metadati dello script. Nessuna dipendenza da Electron.
// `sync` = modulo core/src/sync/index.js (iniettato).

function createState(sync) {
  const st = {
    project: null,
    scriptWarnings: [],
    scriptConfidence: null,
    projectName: null,
  };

  const need = () => {
    if (!st.project) throw new Error('Nessuno script caricato: carica prima una sceneggiatura');
    return st.project;
  };

  // Vista per la UI (contratto window.ce.getState).
  function view() {
    const p = st.project;
    if (!p) return { lines: [], takes: [], coverage: {}, bestTake: {}, warnings: [] };
    const lines = p.scriptDoc.lines.map((l) => ({
      id: l.id, type: l.type, character: l.character ?? null, text: l.text, sceneId: l.sceneId ?? null,
      order: l.order, syncable: l.type === 'dialogue' || l.type === 'action',
    }));
    const takes = p.takes.map((t) => ({ id: t.id, clipId: t.clipId, label: t.label, name: p.clips[t.clipId]?.name ?? t.clipId }));
    const coverage = {};
    for (const t of p.takes) coverage[t.id] = sync.coverageForTake(p, t.id);
    const bestTake = {};
    for (const l of sync.syncableLines(p)) bestTake[l.id] = sync.bestTake(p, l.id);
    const warnings = [
      ...st.scriptWarnings.map((message) => ({ type: 'script', message })),
      ...sync.checkAnchors(p),
    ];
    return { lines, takes, coverage, bestTake, warnings };
  }

  function snapshot() {
    return { project: st.project, view: view() };
  }

  return {
    get project() { return st.project; },
    need,
    view,
    snapshot,
    meta: st,
    setProject(p, { warnings = [], confidence = null } = {}) {
      st.project = p;
      st.scriptWarnings = warnings;
      st.scriptConfidence = confidence;
    },
  };
}

module.exports = { createState };
