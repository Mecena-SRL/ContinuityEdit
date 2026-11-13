// SyncProject: stato serializzabile del sync (script + clip + take + ancore + selezione + note).
// Tutti i frame sono interi relativi all'inizio clip; gli intervalli hanno fine ESCLUSA.

export const CURRENT_VERSION = 2;
export const RATINGS = ['buono', 'scarto'];
export const DEFAULT_GRADE_PALETTE = ['B', 'B+', 'B++'];
export const EDGES = ['start', 'end', 'point'];
export const KINDS = ['manual', 'auto'];
export const SYNCABLE_TYPES = ['dialogue', 'action'];
// Tipo di inquadratura del take e provenienza dell'informazione (campi opzionali del modello v2).
export const SHOTS = ['totale', 'medio', 'stretto', 'dettaglio', 'altro'];
export const SHOT_SOURCES = ['manuale', 'metadati', 'copertura'];

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
    marks: {},
    gradePalette: [...DEFAULT_GRADE_PALETTE],
    sequence: emptySequence(),
    board: emptyBoard(),
  };
}

export const emptySequence = () => ({ id: 'SEQ1', name: 'Sequenza 1', items: [] });
export const emptyBoard = () => ({ items: [], links: [] });

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

function checkTakeFields(t, err) {
  if (t.groupId != null && typeof t.groupId !== 'string') err('groupId deve essere stringa o null');
  if (t.angle != null && typeof t.angle !== 'string') err('angle deve essere stringa o null');
  if (t.rating != null && !RATINGS.includes(t.rating)) err(`rating "${t.rating}"`);
  if (typeof t.grade !== 'string') err('grade deve essere una stringa');
  if (!Array.isArray(t.tags) || t.tags.some((x) => typeof x !== 'string')) err('tags deve essere un array di stringhe');
  if (t.bin != null && typeof t.bin !== 'string') err('bin deve essere stringa o null');
  if (t.meta != null && typeof t.meta !== 'object') err('meta deve essere un oggetto');
  if (t.shot != null && !SHOTS.includes(t.shot)) err(`shot "${t.shot}"`);
  if (t.shotSource != null && !SHOT_SOURCES.includes(t.shotSource)) err(`shotSource "${t.shotSource}"`);
}

export function addTake(project, { id, clipId, label, groupId = null, angle = null, rating = null, grade = '', tags = [], bin = null, meta, shot = null, shotSource = null } = {}) {
  if (!project.clips[clipId]) throw new Error(`addTake: clip sconosciuta "${clipId}"`);
  const takeId = id || nextId('T', project.takes);
  if (project.takes.some((t) => t.id === takeId)) throw new Error(`addTake: take "${takeId}" gia' esistente`);
  const take = { id: takeId, clipId, label: label ?? takeId, groupId, angle, rating, grade, tags: [...tags], bin };
  if (meta) take.meta = { ...meta };
  if (shot != null) { take.shot = shot; take.shotSource = shotSource ?? 'manuale'; }
  checkTakeFields(take, (m) => { throw new Error(`addTake: ${m}`); });
  project.takes.push(take);
  return take;
}

const cleanTags = (tags) => [...new Set((tags || []).map((x) => String(x).trim()).filter(Boolean))];

// Valutazione dell'intero take (rating/grade/tags). Solo i campi presenti in `patch` cambiano.
export function setTakeMark(project, takeId, patch = {}) {
  const t = getTake(project, takeId);
  if (!t) throw new Error(`setTakeMark: take sconosciuto "${takeId}"`);
  if ('rating' in patch) {
    if (patch.rating != null && !RATINGS.includes(patch.rating)) throw new Error(`setTakeMark: rating non valido "${patch.rating}"`);
    t.rating = patch.rating ?? null;
  }
  if ('grade' in patch) t.grade = patch.grade == null ? '' : String(patch.grade);
  if ('tags' in patch) t.tags = cleanTags(patch.tags);
  return t;
}

export const markKey = (takeId, lineId) => `${takeId}|${lineId}`;

// Valutazione per copertura (take+riga). lineId null = intero take (-> setTakeMark). Un mark vuoto viene rimosso.
export function setMark(project, takeId, lineId, patch = {}) {
  if (lineId == null) return setTakeMark(project, takeId, patch);
  if (!getTake(project, takeId)) throw new Error(`setMark: take sconosciuto "${takeId}"`);
  if (!getLine(project, lineId)) throw new Error(`setMark: riga sconosciuta "${lineId}"`);
  if (patch.rating != null && !RATINGS.includes(patch.rating)) throw new Error(`setMark: rating non valido "${patch.rating}"`);
  const key = markKey(takeId, lineId);
  const m = { rating: null, grade: '', tags: [], note: '', ...(project.marks[key] || {}) };
  if ('rating' in patch) m.rating = patch.rating ?? null;
  if ('grade' in patch) m.grade = patch.grade == null ? '' : String(patch.grade);
  if ('tags' in patch) m.tags = cleanTags(patch.tags);
  if ('note' in patch) m.note = patch.note == null ? '' : String(patch.note);
  if (!m.rating && !m.grade && !m.tags.length && !m.note) { delete project.marks[key]; return null; }
  project.marks[key] = m;
  return m;
}

// Rating/grade/tags efficaci per (take, riga): il mark di copertura prevale su quello del take.
export function effectiveMark(project, takeId, lineId) {
  const t = getTake(project, takeId);
  const m = lineId != null ? project.marks?.[markKey(takeId, lineId)] : null;
  return {
    rating: m?.rating ?? t?.rating ?? null,
    grade: m?.grade || t?.grade || '',
    tags: [...new Set([...(t?.tags || []), ...(m?.tags || [])])],
  };
}

export function setGradePalette(project, list) {
  if (!Array.isArray(list) || list.some((x) => typeof x !== 'string' || !x)) throw new Error('setGradePalette: elenco di stringhe non vuote richiesto');
  project.gradePalette = [...new Set(list)];
  return project.gradePalette;
}

// Tipo di inquadratura. shot null azzera (e azzera anche la provenienza). source default 'manuale'.
export function setTakeShot(project, takeId, shot, source = 'manuale') {
  const t = getTake(project, takeId);
  if (!t) throw new Error(`setTakeShot: take sconosciuto "${takeId}"`);
  if (shot == null) { t.shot = null; t.shotSource = null; return t; }
  if (!SHOTS.includes(shot)) throw new Error(`setTakeShot: shot non valido "${shot}"`);
  if (source != null && !SHOT_SOURCES.includes(source)) throw new Error(`setTakeShot: shotSource non valido "${source}"`);
  t.shot = shot;
  t.shotSource = source ?? 'manuale';
  return t;
}

export function setTakeGroup(project, takeId, groupId, angle = null) {
  const t = getTake(project, takeId);
  if (!t) throw new Error(`setTakeGroup: take sconosciuto "${takeId}"`);
  t.groupId = groupId ?? null;
  t.angle = angle ?? null;
  return t;
}

// Filtra i take. rating: 'buono'|'scarto'|'tutti' (default); grades: elenco di grade; groupId; bin; tags (tutti presenti).
// Con lineId usa i mark di copertura (effectiveMark), altrimenti i campi del take.
export function filterTakes(project, { rating = 'tutti', grades, groupId, bin, tags, lineId } = {}) {
  return project.takes.filter((t) => {
    const e = effectiveMark(project, t.id, lineId);
    if (rating !== 'tutti' && e.rating !== rating) return false;
    if (grades && !grades.includes(e.grade)) return false;
    if (groupId !== undefined && t.groupId !== groupId) return false;
    if (bin !== undefined && t.bin !== bin) return false;
    if (tags && !tags.every((x) => e.tags.includes(x))) return false;
    return true;
  });
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

MIGRATIONS[1] = (p) => ({
  ...p,
  version: 2,
  takes: (p.takes || []).map((t) => ({ groupId: null, angle: null, rating: null, grade: '', tags: [], bin: null, ...t })),
  marks: p.marks || {},
  gradePalette: p.gradePalette || [...DEFAULT_GRADE_PALETTE],
  sequence: p.sequence || emptySequence(),
  board: p.board || emptyBoard(),
});

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
    checkTakeFields(t, (m) => err(`take "${t.id}": ${m}`));
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
  if (!p.marks || typeof p.marks !== 'object' || Array.isArray(p.marks)) err('marks deve essere un oggetto');
  for (const [k, m] of Object.entries(p.marks)) {
    const [tk, ln] = k.split('|');
    if (!takeIds.has(tk) || !lineIds.has(ln)) err(`marks: chiave sconosciuta "${k}"`);
    if (m.rating != null && !RATINGS.includes(m.rating)) err(`marks "${k}": rating "${m.rating}"`);
  }
  if (!Array.isArray(p.gradePalette) || p.gradePalette.some((x) => typeof x !== 'string')) err('gradePalette deve essere un array di stringhe');
  if (!p.sequence || !Array.isArray(p.sequence.items)) err('sequence.items mancante');
  const itemIds = new Set();
  for (const it of p.sequence.items) {
    if (!it || typeof it.id !== 'string' || itemIds.has(it.id)) err('sequence: item senza id o duplicato');
    itemIds.add(it.id);
    if (!takeIds.has(it.takeId)) err(`sequence item "${it.id}": take sconosciuto "${it.takeId}"`);
    if (!isInt(it.startFrame) || !isInt(it.endFrame) || it.endFrame <= it.startFrame) err(`sequence item "${it.id}": intervallo non valido`);
  }
  if (!p.board || !Array.isArray(p.board.items) || !Array.isArray(p.board.links)) err('board.items/links mancanti');
  const boardIds = new Set();
  for (const it of p.board.items) {
    if (!it || typeof it.id !== 'string' || boardIds.has(it.id)) err('board: item senza id o duplicato');
    boardIds.add(it.id);
    if (it.takeId != null && !takeIds.has(it.takeId)) err(`board item "${it.id}": take sconosciuto "${it.takeId}"`);
  }
  for (const l of p.board.links) if (!boardIds.has(l.from) || !boardIds.has(l.to)) err('board: link verso item sconosciuto');
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
  // Tollerante: valori sconosciuti di shot/shotSource (es. scritti da una versione futura) diventano null.
  for (const t of Array.isArray(p.takes) ? p.takes : []) {
    if (!t || typeof t !== 'object') continue;
    if (t.shot != null && !SHOTS.includes(t.shot)) { t.shot = null; t.shotSource = null; }
    if (t.shotSource != null && !SHOT_SOURCES.includes(t.shotSource)) t.shotSource = null;
  }
  return validateProject(p);
}
