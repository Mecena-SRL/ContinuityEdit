// SyncProject: stato serializzabile del sync (script + clip + take + ancore + selezione + note).
// Tutti i frame sono interi relativi all'inizio clip; gli intervalli hanno fine ESCLUSA.

export const CURRENT_VERSION = 1;
export const EDGES = ['start', 'end', 'point'];
export const KINDS = ['manual', 'auto'];
export const SYNCABLE_TYPES = ['dialogue', 'action'];

const isInt = (n) => Number.isInteger(n);

export function createProject(scriptDoc) {
  if (!scriptDoc || !Array.isArray(scriptDoc.lines)) {
    throw new Error('createProject: scriptDoc.lines mancante');
  }
  return {
    version: CURRENT_VERSION,
    scriptDoc,
    clips: {},
    takes: [],
    anchors: [],
    selection: {},
    notes: {},
  };
}

export function addClip(project, clipId, { fps, durationFrames, startTcFrames = 0, name = clipId } = {}) {
  if (!clipId || typeof clipId !== 'string') throw new Error('addClip: clipId obbligatorio');
  if (!(fps > 0)) throw new Error(`addClip(${clipId}): fps non valido`);
  if (!isInt(durationFrames) || durationFrames <= 0) throw new Error(`addClip(${clipId}): durationFrames deve essere un intero > 0`);
  if (!isInt(startTcFrames)) throw new Error(`addClip(${clipId}): startTcFrames deve essere intero`);
  project.clips[clipId] = { fps, durationFrames, startTcFrames, name };
  return project.clips[clipId];
}

function nextId(prefix, items) {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const it of items) {
    const m = re.exec(it.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}
export const nextAnchorId = (project) => nextId('A', project.anchors);

export function addTake(project, { id, clipId, label } = {}) {
  if (!project.clips[clipId]) throw new Error(`addTake: clip sconosciuta "${clipId}"`);
  const takeId = id || nextId('T', project.takes);
  if (project.takes.some((t) => t.id === takeId)) throw new Error(`addTake: take "${takeId}" gia' esistente`);
  const take = { id: takeId, clipId, label: label ?? takeId };
  project.takes.push(take);
  return take;
}

export const getTake = (project, takeId) => project.takes.find((t) => t.id === takeId) || null;
export const getLine = (project, lineId) => project.scriptDoc.lines.find((l) => l.id === lineId) || null;

// lineId -> posizione nello script (ordine di `order`, altrimenti ordine d'array)
export function lineOrder(project) {
  const lines = project.scriptDoc.lines;
  const sorted = lines.every((l) => isInt(l.order))
    ? [...lines].sort((a, b) => a.order - b.order)
    : lines;
  const m = new Map();
  sorted.forEach((l, i) => m.set(l.id, i));
  return m;
}

// Righe sincronizzabili: dialogue + action (+ scene se richiesto). Solo le dialogue sono allineabili in automatico.
export function syncableLines(project, { includeScenes = false } = {}) {
  const types = new Set(SYNCABLE_TYPES);
  if (includeScenes) types.add('scene');
  return project.scriptDoc.lines.filter((l) => types.has(l.type));
}

export function setSelection(project, lineId, takeId) {
  if (!getLine(project, lineId)) throw new Error(`setSelection: riga sconosciuta "${lineId}"`);
  if (takeId == null) { delete project.selection[lineId]; return; }
  if (!getTake(project, takeId)) throw new Error(`setSelection: take sconosciuto "${takeId}"`);
  project.selection[lineId] = takeId;
}

export function setNote(project, key, text) {
  if (!getLine(project, key) && !getTake(project, key)) throw new Error(`setNote: chiave sconosciuta "${key}"`);
  if (text == null || text === '') delete project.notes[key];
  else project.notes[key] = String(text);
}

export function serialize(project, { pretty = false } = {}) {
  return JSON.stringify(project, null, pretty ? 2 : 0);
}

// Migrazioni: from-version -> funzione che porta a from+1. La v0 (campi assenti) e' il formato pre-release.
const MIGRATIONS = {
  0(p) {
    return { ...p, version: 1, clips: p.clips || {}, takes: p.takes || [], anchors: p.anchors || [], selection: p.selection || {}, notes: p.notes || {} };
  },
};

export function validateProject(p) {
  const err = (m) => { throw new Error(`Progetto non valido: ${m}`); };
  if (!p || typeof p !== 'object') err('non e\' un oggetto');
  if (p.version !== CURRENT_VERSION) err(`version ${p.version}`);
  if (!p.scriptDoc || !Array.isArray(p.scriptDoc.lines)) err('scriptDoc.lines mancante');
  const lineIds = new Set();
  for (const l of p.scriptDoc.lines) {
    if (!l || typeof l.id !== 'string') err('riga senza id');
    lineIds.add(l.id);
  }
  if (!p.clips || typeof p.clips !== 'object' || Array.isArray(p.clips)) err('clips deve essere un oggetto');
  for (const [id, c] of Object.entries(p.clips)) {
    if (!c || !(c.fps > 0)) err(`clip "${id}": fps non valido`);
    if (!isInt(c.durationFrames) || c.durationFrames <= 0) err(`clip "${id}": durationFrames non valido`);
    if (!isInt(c.startTcFrames)) err(`clip "${id}": startTcFrames non valido`);
  }
  if (!Array.isArray(p.takes)) err('takes deve essere un array');
  const takeIds = new Set();
  for (const t of p.takes) {
    if (!t || typeof t.id !== 'string') err('take senza id');
    if (takeIds.has(t.id)) err(`take duplicato "${t.id}"`);
    if (!p.clips[t.clipId]) err(`take "${t.id}": clip sconosciuta "${t.clipId}"`);
    takeIds.add(t.id);
  }
  if (!Array.isArray(p.anchors)) err('anchors deve essere un array');
  const anchorIds = new Set();
  for (const a of p.anchors) {
    if (!a || typeof a.id !== 'string') err('ancora senza id');
    if (anchorIds.has(a.id)) err(`ancora duplicata "${a.id}"`);
    anchorIds.add(a.id);
    if (!takeIds.has(a.takeId)) err(`ancora "${a.id}": take sconosciuto "${a.takeId}"`);
    if (!lineIds.has(a.lineId)) err(`ancora "${a.id}": riga sconosciuta "${a.lineId}"`);
    if (!EDGES.includes(a.edge)) err(`ancora "${a.id}": edge "${a.edge}"`);
    if (!KINDS.includes(a.kind)) err(`ancora "${a.id}": kind "${a.kind}"`);
    if (!isInt(a.frame)) err(`ancora "${a.id}": frame non intero`);
  }
  for (const [l, t] of Object.entries(p.selection || {})) {
    if (!lineIds.has(l)) err(`selection: riga sconosciuta "${l}"`);
    if (!takeIds.has(t)) err(`selection: take sconosciuto "${t}"`);
  }
  for (const k of Object.keys(p.notes || {})) {
    if (!lineIds.has(k) && !takeIds.has(k)) err(`notes: chiave sconosciuta "${k}"`);
  }
  return p;
}

export function deserialize(input) {
  let p = input;
  if (typeof input === 'string') {
    try { p = JSON.parse(input); } catch (e) { throw new Error(`Progetto non valido: JSON malformato (${e.message})`); }
  }
  if (!p || typeof p !== 'object') throw new Error('Progetto non valido: non e\' un oggetto');
  let v = p.version === undefined ? 0 : p.version;
  if (!isInt(v) || v < 0) throw new Error(`Progetto non valido: version "${p.version}"`);
  if (v > CURRENT_VERSION) throw new Error(`Progetto di versione ${v} piu' recente di quella supportata (${CURRENT_VERSION})`);
  p = structuredClone(p);
  while (v < CURRENT_VERSION) { p = MIGRATIONS[v](p); v = p.version; }
  return validateProject(p);
}
