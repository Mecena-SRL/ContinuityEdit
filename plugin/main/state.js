'use strict';
// Stato in memoria del main: SyncProject + metadati dello script. Nessuna dipendenza da Electron.
// `sync` = modulo core/src/sync/index.js, `sequence` = core/src/sequence/index.js (iniettati; sequence facoltativo).

const EMPTY_VIEW = { lines: [], takes: [], coverage: {}, bestTake: {}, warnings: [], sequence: { items: [], total: 0, markers: [] }, hasScript: false };

function createState(sync, sequence = null) {
  const st = {
    project: null,
    scriptWarnings: [],
    scriptConfidence: null,
    projectName: null,
    projectKey: null, // nome|id del progetto Resolve a cui appartiene lo stato (cambio progetto a pannello aperto)
    timelineFps: null,
  };

  const need = () => {
    if (!st.project) throw new Error('Nessuno script caricato: carica prima una sceneggiatura');
    return st.project;
  };

  // fps delle clip per convertire i tempi della sequenza in frame di timeline
  const seqOpts = (p) => ({ timelineFps: st.timelineFps || undefined, clipFps: Object.fromEntries(Object.entries(p.clips).map(([id, c]) => [id, c.fps])) });

  // Vista per la UI (contratto window.ce.getState).
  function view() {
    const p = st.project;
    if (!p) return structuredClone(EMPTY_VIEW);
    const lines = p.scriptDoc.lines.map((l) => ({
      id: l.id, type: l.type, character: l.character ?? null, text: l.text, sceneId: l.sceneId ?? null,
      order: l.order, syncable: l.type === 'dialogue' || l.type === 'action', confidence: typeof l.confidence === 'number' ? l.confidence : undefined,
    }));
    const takes = p.takes.map((t) => ({
      id: t.id, clipId: t.clipId, label: t.label, name: p.clips[t.clipId]?.name ?? t.clipId,
      groupId: t.groupId ?? null, angle: t.angle ?? null, rating: t.rating ?? null, grade: t.grade ?? '',
      tags: t.tags ?? [], bin: t.bin ?? null, shot: t.shot ?? null, shotSource: t.shotSource ?? null,
    }));
    const coverage = {};
    for (const t of p.takes) coverage[t.id] = sync.coverageForTake(p, t.id);
    const bestTake = {};
    for (const l of sync.syncableLines(p)) bestTake[l.id] = sync.bestTake(p, l.id);
    const warnings = [
      ...st.scriptWarnings.map((message) => ({ type: 'script', message })),
      ...sync.checkAnchors(p),
    ];
    let seq = { items: [], total: 0, markers: [] };
    if (sequence && p.sequence) {
      try {
        const o = seqOpts(p);
        const lay = sequence.sequenceLayout(p.sequence, o);
        seq = { ...lay, markers: sequence.lineMarkers(p.sequence, o), timelineFps: st.timelineFps || null };
      } catch { /* sequenza incoerente: la UI mostra la lista grezza */ }
    }
    return { lines, takes, coverage, bestTake, warnings, sequence: seq, hasScript: lines.length > 0 };
  }

  function snapshot() {
    return { project: st.project, view: view() };
  }

  return {
    get project() { return st.project; },
    need,
    view,
    snapshot,
    seqOpts,
    meta: st,
    setProject(p, { warnings = [], confidence = null } = {}) {
      st.project = p;
      st.scriptWarnings = warnings;
      st.scriptConfidence = confidence;
    },
  };
}

module.exports = { createState };
