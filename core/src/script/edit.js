// Spoglio / modifica della sceneggiatura. Le funzioni su scriptDoc sono PURE: restituiscono
// { doc, map, created, removed } senza toccare l'input.
//  - map: oldId -> id che eredita ancore/selezioni/note/marks (identita' se la riga resta; merge: seconda -> prima)
//  - created: id nuovi (L#### successivi al massimo esistente); removed: id spariti.
// applyScriptEdit(project, edit, {history}) applica una modifica al progetto e migra ancore/selezioni/note/marks/sequenza/lavagna.

import { parseCharacter } from './character.js';

export const LINE_TYPES = ['scene', 'action', 'character', 'dialogue', 'parenthetical', 'transition', 'other'];

const clone = (d) => structuredClone(d);

function nextLineIds(doc, n) {
  let max = 0;
  let width = 4;
  for (const l of doc.lines) {
    const m = /^L(\d+)$/.exec(l.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Array.from({ length: n }, (_, i) => `L${String(max + 1 + i).padStart(width, '0')}`);
}

function findIdx(doc, lineId) {
  const i = doc.lines.findIndex((l) => l.id === lineId);
  if (i < 0) throw new Error(`riga sconosciuta "${lineId}"`);
  return i;
}

function assignCharacter(line, raw) {
  const { name, exts } = parseCharacter(raw);
  line.character = name || null;
  if (exts.length) line.characterExt = exts.join(' '); else delete line.characterExt;
}

function renumber(doc) {
  doc.lines.forEach((l, i) => { l.order = i + 1; });
}

// Ricostruisce doc.scenes e line.sceneId dopo modifiche di tipo/ordine. Gli id di scena esistenti restano
// legati alla riga-intestazione che li apriva.
function rebuildScenes(doc) {
  const oldByHead = new Map((doc.scenes || []).map((s) => [s.lineIds?.[0], s]));
  const used = new Set();
  let counter = 0;
  const reserved = new Set((doc.scenes || []).map((s) => s.id));
  const fresh = () => {
    let id;
    do { counter += 1; id = `S${counter}`; } while (used.has(id) || reserved.has(id));
    return id;
  };
  const scenes = [];
  let cur = null;
  for (const l of doc.lines) {
    if (l.type === 'scene') {
      let id = oldByHead.get(l.id)?.id;
      if (!id || used.has(id)) id = fresh();
      used.add(id);
      cur = { id, heading: l.text, lineIds: [] };
      scenes.push(cur);
    } else if (!cur) {
      let id = doc.scenes?.[0]?.id;
      if (!id || used.has(id)) id = fresh();
      used.add(id);
      cur = { id, heading: doc.scenes?.[0]?.heading ?? '', lineIds: [] };
      scenes.push(cur);
    }
    cur.lineIds.push(l.id);
    l.sceneId = cur.id;
  }
  doc.scenes = scenes;
}

const result = (doc, map, created = [], removed = []) => ({ doc, map, created, removed });
const identity = (doc) => Object.fromEntries(doc.lines.map((l) => [l.id, l.id]));

export function setLineType(doc, lineId, type, { character } = {}) {
  if (!LINE_TYPES.includes(type)) throw new Error(`setLineType: tipo non valido "${type}"`);
  const d = clone(doc);
  const line = d.lines[findIdx(d, lineId)];
  const map = identity(d);
  line.type = type;
  if (type === 'dialogue' || type === 'character') {
    if (character !== undefined) assignCharacter(line, character);
    else if (line.character === undefined) line.character = null;
  } else {
    line.character = null;
    delete line.characterExt;
  }
  rebuildScenes(d);
  return result(d, map);
}

export function setCharacter(doc, lineId, character) {
  const d = clone(doc);
  const line = d.lines[findIdx(d, lineId)];
  if (character == null || String(character).trim() === '') { line.character = null; delete line.characterExt; } else assignCharacter(line, character);
  return result(d, identity(d));
}

// Divide la riga a `offset` (indice nel testo): la prima parte tiene l'id, la seconda e' una riga nuova subito dopo.
export function splitLine(doc, lineId, offset) {
  const d = clone(doc);
  const i = findIdx(d, lineId);
  const line = d.lines[i];
  const text = line.text ?? '';
  if (!Number.isInteger(offset) || offset <= 0 || offset >= text.length) throw new Error('splitLine: offset fuori dal testo');
  const a = text.slice(0, offset).trimEnd();
  const b = text.slice(offset).trimStart();
  if (!a || !b) throw new Error('splitLine: una delle due parti sarebbe vuota');
  const [nid] = nextLineIds(d, 1);
  const tail = { ...line, id: nid, text: b };
  line.text = a;
  d.lines.splice(i + 1, 0, tail);
  renumber(d);
  rebuildScenes(d);
  return result(d, { ...identity(doc) }, [nid], []);
}

// Unisce righe CONTIGUE (nell'ordine del documento) nella prima: testo concatenato con spazio, tipo/personaggio della prima.
export function mergeLines(doc, lineIds) {
  if (!Array.isArray(lineIds) || lineIds.length < 2) throw new Error('mergeLines: servono almeno due righe');
  const d = clone(doc);
  const idx = lineIds.map((id) => findIdx(d, id));
  for (let k = 1; k < idx.length; k++) if (idx[k] !== idx[k - 1] + 1) throw new Error('mergeLines: le righe devono essere contigue e in ordine');
  const first = d.lines[idx[0]];
  const map = identity(doc);
  const removed = [];
  for (let k = 1; k < idx.length; k++) {
    const l = d.lines[idx[k]];
    first.text = [first.text, l.text].filter(Boolean).join(' ');
    map[l.id] = first.id;
    removed.push(l.id);
  }
  d.lines.splice(idx[0] + 1, idx.length - 1);
  renumber(d);
  rebuildScenes(d);
  return result(d, map, [], removed);
}

// La porzione [startOffset, endOffset) diventa una riga nuova del tipo scelto; il resto resta (id stabile sulla
// prima parte rimasta: il testo prima della selezione, altrimenti quello dopo). Selezione = tutta la riga -> cambio tipo in place.
export function retypeSelection(doc, lineId, startOffset, endOffset, type, { character } = {}) {
  if (!LINE_TYPES.includes(type)) throw new Error(`retypeSelection: tipo non valido "${type}"`);
  const d0 = clone(doc);
  const i = findIdx(d0, lineId);
  const text = d0.lines[i].text ?? '';
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset > text.length || startOffset >= endOffset) {
    throw new Error('retypeSelection: selezione non valida');
  }
  const before = text.slice(0, startOffset).trim();
  const sel = text.slice(startOffset, endOffset).trim();
  const after = text.slice(endOffset).trim();
  if (!sel) throw new Error('retypeSelection: selezione vuota');
  if (!before && !after) return setLineType(doc, lineId, type, { character });

  const d = clone(doc);
  const orig = d.lines[i];
  const mk = (id, t, ty, ch) => {
    const l = { ...orig, id, text: t, type: ty };
    delete l.confidence;
    if (ty === 'dialogue' || ty === 'character') {
      if (ch !== undefined) assignCharacter(l, ch);
    } else { l.character = null; delete l.characterExt; }
    return l;
  };
  const ids = nextLineIds(d, before && after ? 2 : 1);
  const pieces = [];
  let created;
  if (before && after) {
    orig.text = before;
    pieces.push(mk(ids[0], sel, type, character), mk(ids[1], after, orig.type, undefined));
    created = ids;
    d.lines.splice(i + 1, 0, ...pieces);
  } else if (before) {
    orig.text = before;
    d.lines.splice(i + 1, 0, mk(ids[0], sel, type, character));
    created = ids;
  } else {
    orig.text = after;
    d.lines.splice(i, 0, mk(ids[0], sel, type, character));
    created = ids;
  }
  renumber(d);
  rebuildScenes(d);
  return result(d, identity(doc), created, []);
}

// ---- applicazione al progetto -------------------------------------------------------------

const remap = (map, id) => (id in map ? map[id] : id);

function mergeMarks(a, b) {
  return {
    rating: a.rating ?? b.rating ?? null,
    grade: a.grade || b.grade || '',
    tags: [...new Set([...(a.tags || []), ...(b.tags || [])])],
    note: [a.note, b.note].filter(Boolean).join('\n'),
  };
}

function migrateProject(p, map) {
  const changed = Object.entries(map).some(([k, v]) => k !== v);
  if (!changed) return;
  // ancore: duplicati (stessa take/riga/edge/kind) dopo il merge -> start/point: frame minore, end: maggiore
  const seen = new Map();
  const anchors = [];
  for (const a of p.anchors) {
    a.lineId = remap(map, a.lineId);
    const k = `${a.takeId}|${a.lineId}|${a.edge}|${a.kind}`;
    const prev = seen.get(k);
    if (!prev) { seen.set(k, a); anchors.push(a); continue; }
    if (a.edge === 'end' ? a.frame > prev.frame : a.frame < prev.frame) { prev.frame = a.frame; if (a.ratio !== undefined) prev.ratio = a.ratio; }
  }
  p.anchors = anchors;
  const sel = {};
  for (const [l, t] of Object.entries(p.selection)) { const n = remap(map, l); if (!(n in sel) || n === l) sel[n] = t; }
  p.selection = sel;
  const notes = {};
  for (const [k, v] of Object.entries(p.notes)) {
    const n = remap(map, k);
    notes[n] = notes[n] ? `${notes[n]}\n${v}` : v;
  }
  p.notes = notes;
  const marks = {};
  for (const [k, m] of Object.entries(p.marks || {})) {
    const [t, l] = k.split('|');
    const nk = `${t}|${remap(map, l)}`;
    marks[nk] = marks[nk] ? mergeMarks(marks[nk], m) : m;
  }
  p.marks = marks;
  for (const it of p.sequence?.items || []) {
    it.lineIds = [...new Set((it.lineIds || []).map((l) => remap(map, l)))];
    for (const k of ['fromLineId', 'toLineId']) if (it[k]) it[k] = remap(map, it[k]);
    if (it.lineStarts) it.lineStarts = Object.fromEntries(Object.entries(it.lineStarts).map(([l, f]) => [remap(map, l), f]));
  }
  for (const it of p.board?.items || []) if (it.lineId) it.lineId = remap(map, it.lineId);
}

// edit: { op:'setType', lineId, type, character? } | { op:'setCharacter', lineId, character }
//     | { op:'retypeSelection', lineId, startOffset, endOffset, type, character? } | { op:'split', lineId, offset }
//     | { op:'merge', lineIds:[...] }
// Muta il progetto (history.push PRIMA, se fornita). Ritorna { map, created, removed }. In caso d'errore il progetto resta intatto.
export function applyScriptEdit(project, edit, { history } = {}) {
  const d = project.scriptDoc;
  let r;
  switch (edit?.op) {
    case 'setType': r = setLineType(d, edit.lineId, edit.type, { character: edit.character }); break;
    case 'setCharacter': r = setCharacter(d, edit.lineId, edit.character); break;
    case 'retypeSelection': r = retypeSelection(d, edit.lineId, edit.startOffset, edit.endOffset, edit.type, { character: edit.character }); break;
    case 'split': r = splitLine(d, edit.lineId, edit.offset); break;
    case 'merge': r = mergeLines(d, edit.lineIds); break;
    default: throw new Error(`applyScriptEdit: op sconosciuta "${edit?.op}"`);
  }
  if (history) history.push(project);
  project.scriptDoc = r.doc;
  migrateProject(project, r.map);
  return { map: r.map, created: r.created, removed: r.removed };
}
