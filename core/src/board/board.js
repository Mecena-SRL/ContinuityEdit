// Lavagna libera di still/note in project.board = { items:[{ id, type:'still'|'note', takeId?, frame?, imagePath?, x,y,w,h,z,
// caption, lineId|null, color? }], links:[{from,to}] }. Le operazioni mutano project.board in place.

import { getTake, getLine, emptyBoard } from '../sync/project.js';
import { ensureSequence, addItem } from '../sequence/sequence.js';

export const DEFAULT_HOLD_FRAMES = 50;
export const DEFAULT_SIZE = { w: 160, h: 90 };

export function ensureBoard(project) {
  if (!project.board) project.board = emptyBoard();
  return project.board;
}

function nextId(board) {
  let max = 0;
  for (const it of board.items) { const m = /^B(\d+)$/.exec(it.id); if (m) max = Math.max(max, Number(m[1])); }
  return `B${max + 1}`;
}
const topZ = (board) => board.items.reduce((m, it) => Math.max(m, it.z ?? 0), 0);
const num = (v, d) => (Number.isFinite(v) ? v : d);

function find(project, id) {
  const it = ensureBoard(project).items.find((x) => x.id === id);
  if (!it) throw new Error(`board: item sconosciuto "${id}"`);
  return it;
}

function checkLine(project, lineId) {
  if (lineId != null && !getLine(project, lineId)) throw new Error(`board: riga sconosciuta "${lineId}"`);
}

export function addStill(project, { takeId, frame, imagePath, x = 0, y = 0, w = DEFAULT_SIZE.w, h = DEFAULT_SIZE.h, caption = '', lineId = null, color } = {}) {
  const board = ensureBoard(project);
  if (!getTake(project, takeId)) throw new Error(`addStill: take sconosciuto "${takeId}"`);
  if (!Number.isInteger(frame) || frame < 0) throw new Error('addStill: frame deve essere un intero >= 0');
  checkLine(project, lineId);
  const it = { id: nextId(board), type: 'still', takeId, frame, x: num(x, 0), y: num(y, 0), w: num(w, DEFAULT_SIZE.w), h: num(h, DEFAULT_SIZE.h), z: topZ(board) + 1, caption, lineId };
  if (imagePath) it.imagePath = imagePath;
  if (color) it.color = color;
  board.items.push(it);
  return it;
}

export function addNote(project, { x = 0, y = 0, w = 140, h = 90, caption = '', lineId = null, color } = {}) {
  const board = ensureBoard(project);
  checkLine(project, lineId);
  const it = { id: nextId(board), type: 'note', x: num(x, 0), y: num(y, 0), w: num(w, 140), h: num(h, 90), z: topZ(board) + 1, caption, lineId };
  if (color) it.color = color;
  board.items.push(it);
  return it;
}

export function moveItem(project, id, { x, y } = {}) {
  const it = find(project, id);
  if (x !== undefined) { if (!Number.isFinite(x)) throw new Error('moveItem: x non valido'); it.x = x; }
  if (y !== undefined) { if (!Number.isFinite(y)) throw new Error('moveItem: y non valido'); it.y = y; }
  return it;
}

export function resizeItem(project, id, { w, h } = {}) {
  const it = find(project, id);
  if (w !== undefined) { if (!(w > 0)) throw new Error('resizeItem: w deve essere > 0'); it.w = w; }
  if (h !== undefined) { if (!(h > 0)) throw new Error('resizeItem: h deve essere > 0'); it.h = h; }
  return it;
}

export function setCaption(project, id, text) {
  const it = find(project, id);
  it.caption = text == null ? '' : String(text);
  return it;
}

export function bringToFront(project, id) {
  const board = ensureBoard(project);
  const it = find(project, id);
  it.z = topZ(board) + 1;
  return it;
}

// Rimuove l'item e i link che lo coinvolgono.
export function removeItem(project, id) {
  const board = ensureBoard(project);
  const it = find(project, id);
  board.items = board.items.filter((x) => x.id !== id);
  board.links = board.links.filter((l) => l.from !== id && l.to !== id);
  return it;
}

export function linkItems(project, from, to) {
  const board = ensureBoard(project);
  find(project, from); find(project, to);
  if (from === to) throw new Error('linkItems: un item non puo\' collegarsi a se stesso');
  let l = board.links.find((x) => x.from === from && x.to === to);
  if (!l) { l = { from, to }; board.links.push(l); }
  return l;
}

const byKeys = (...ks) => (a, b) => {
  for (const k of ks) if (a[k] !== b[k]) return a[k] - b[k];
  return 0;
};

// Ogni still (con take) diventa un item di sequenza con in/out centrati sul frame, durata holdFrames (default 50),
// spostati dentro i limiti della clip. order: 'x' (poi y, z) | 'y' (poi x, z) | 'z' | 'explicit' (con ids). Sostituisce
// project.sequence.items e ritorna la sequenza. Le note vengono ignorate.
export function boardToSequence(project, { order = 'x', ids, holdFrames = DEFAULT_HOLD_FRAMES } = {}) {
  const board = ensureBoard(project);
  if (!Number.isInteger(holdFrames) || holdFrames <= 0) throw new Error('boardToSequence: holdFrames deve essere un intero > 0');
  let stills;
  if (order === 'explicit') {
    if (!Array.isArray(ids)) throw new Error('boardToSequence: order "explicit" richiede ids');
    stills = ids.map((id) => find(project, id));
  } else {
    const cmp = { x: byKeys('x', 'y', 'z'), y: byKeys('y', 'x', 'z'), z: byKeys('z', 'x', 'y') }[order];
    if (!cmp) throw new Error(`boardToSequence: order non valido "${order}"`);
    stills = [...board.items].sort(cmp);
  }
  stills = stills.filter((it) => it.type === 'still' && it.takeId);
  const seq = ensureSequence(project);
  seq.items = [];
  for (const it of stills) {
    const dur = project.clips[getTake(project, it.takeId).clipId].durationFrames;
    const len = Math.min(holdFrames, dur);
    const start = Math.min(Math.max(0, it.frame - Math.floor(len / 2)), dur - len);
    addItem(project, { kind: 'clip', takeId: it.takeId, startFrame: start, endFrame: start + len, lineIds: it.lineId ? [it.lineId] : [], note: it.caption });
  }
  return seq;
}
