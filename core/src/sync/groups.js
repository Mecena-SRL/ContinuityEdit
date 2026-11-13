// Classificazione delle inquadrature e raggruppamento per copertura. Puro: nessun accesso a Resolve.
//  - suggestShotFromMetadata: mappa metadati/nome file (WIDE, TOT, MS, CU, DET, PP, ...) ai valori italiani;
//  - detectGroupsByCoverage: propone gruppi di take che coprono (quasi) le stesse righe, nello stesso bin;
//  - suggestMaster: il take migliore come master del gruppo (totale noto, altrimenti copertura piu' ampia);
//  - suggestGroupShots: ipotesi 'stretto' per gli altri take di un gruppo con master (MAI scritte da sole).
// Niente di qui modifica il progetto: la scrittura passa sempre da setTakeShot / setTakeGroup dopo conferma.

import { coverageForTake } from './coverage.js';
import { getTake, SYNCABLE_TYPES } from './project.js';

// ---- metadati -> inquadratura ----------------------------------------------------------------------------
const SHOT_PATTERNS = [
  ['dettaglio', ['dettaglio', 'det', 'ecu', 'xcu', 'ppp', 'insert', 'inserto', 'macro', 'extreme close', 'extreme closeup', 'primissimo piano', 'big close']],
  ['stretto', ['stretto', 'cu', 'close', 'closeup', 'close up', 'mcu', 'medium close', 'medium closeup', 'pp', 'primo piano', 'mezzo primo piano', 'mpp', 'busto', 'ots', 'over the shoulder']],
  ['medio', ['medio', 'med', 'medium', 'ms', 'mws', 'mid', 'mezza figura', 'piano medio', 'cowboy', 'two shot', 'campo medio', 'cm']],
  ['totale', ['totale', 'tot', 'wide', 'ws', 'vws', 'ews', 'ls', 'long', 'master', 'full', 'fs', 'fig', 'campo lungo', 'cl', 'cll', 'establishing', 'generale']],
];
const norm = (v) => ` ${String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.[a-z0-9]{2,4}$/, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;

function matchField(value) {
  const text = norm(value);
  if (text.trim() === '') return null;
  let best = null;
  for (const [shot, words] of SHOT_PATTERNS) {
    for (const w of words) {
      const i = text.indexOf(` ${w} `);
      if (i < 0) continue;
      if (!best || i < best.i || (i === best.i && w.length > best.w.length)) best = { shot, w, i };
    }
  }
  return best;
}

/**
 * clipMeta: { shotType, shot, angle, name } (qualsiasi sottoinsieme; 'Shot Type', 'Angle' e il nome file contano).
 * Ritorna { shot, source:'metadati', from:'shotType'|'shot'|'angle'|'name', match } oppure null.
 * Il campo 'Shot' contiene spesso solo il numero di inquadratura ("2A"): in quel caso non da' nessun risultato.
 */
export function suggestShotFromMetadata(clipMeta = {}) {
  const m = clipMeta || {};
  const fields = [['shotType', m.shotType ?? m['Shot Type']], ['shot', m.shot ?? m.Shot], ['angle', m.angle ?? m.Angle], ['name', m.name]];
  for (const [from, value] of fields) {
    const r = matchField(value);
    if (r) return { shot: r.shot, source: 'metadati', from, match: r.w.toUpperCase() };
  }
  return null;
}

// ---- copertura --------------------------------------------------------------------------------------------
function coveredLines(project, takeId) {
  const ok = new Set(SYNCABLE_TYPES);
  const types = new Map(project.scriptDoc.lines.map((l) => [l.id, l.type]));
  return new Set(coverageForTake(project, takeId).filter((c) => ok.has(types.get(c.lineId))).map((c) => c.lineId));
}
const seconds = (project, take) => { const c = project.clips[take.clipId]; return c.durationFrames / c.fps; };
const sameBin = (a, b) => (a.bin ?? null) === (b.bin ?? null);

function nextGroupSeq(project, extraIds = []) {
  let max = 0;
  for (const id of [...project.takes.map((t) => t.groupId), ...extraIds]) {
    const m = /^G(\d+)$/.exec(id || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/**
 * Proposte di gruppo per copertura: take dello stesso bin, non ancora in un gruppo, le cui righe coperte
 * (dialogue/action) si sovrappongono per almeno minOverlap (condivise / il minore dei due insiemi) e con durata
 * simile (|a-b|/max <= durationTolerance, in secondi) = stessa performance ripresa da piu' camere.
 * opts: { minOverlap=0.6, durationTolerance=0.35, minShared=2, excludeTakeIds=[], usedGroupIds=[] }.
 * Ritorna [{ groupId, takeIds, reason, confidence }]. Non modifica il progetto.
 */
export function detectGroupsByCoverage(project, { minOverlap = 0.6, durationTolerance = 0.35, minShared = 2, excludeTakeIds = [], usedGroupIds = [] } = {}) {
  const skip = new Set(excludeTakeIds);
  const cands = project.takes.filter((t) => !t.groupId && !skip.has(t.id));
  const lines = new Map(cands.map((t) => [t.id, coveredLines(project, t.id)]));
  const pair = (a, b) => {
    const A = lines.get(a.id); const B = lines.get(b.id);
    if (!A.size || !B.size || !sameBin(a, b)) return null;
    let shared = 0;
    for (const l of A) if (B.has(l)) shared++;
    if (shared < Math.min(minShared, A.size, B.size)) return null;
    const overlap = shared / Math.min(A.size, B.size);
    if (overlap < minOverlap) return null;
    const da = seconds(project, a); const db = seconds(project, b);
    const dsim = 1 - Math.abs(da - db) / Math.max(da, db);
    if (1 - dsim > durationTolerance) return null;
    return { overlap, dsim };
  };
  const out = [];
  const seen = new Set();
  let seq = nextGroupSeq(project, usedGroupIds);
  for (const a of cands) {
    if (seen.has(a.id)) continue;
    const members = [a]; const scores = [];
    for (const b of cands) {
      if (b === a || seen.has(b.id)) continue;
      const rs = members.map((m) => pair(m, b));
      if (rs.every(Boolean)) { members.push(b); scores.push(...rs); }
    }
    if (members.length < 2) continue;
    for (const m of members) seen.add(m.id);
    const ov = scores.reduce((s, x) => s + x.overlap, 0) / scores.length;
    const ds = scores.reduce((s, x) => s + x.dsim, 0) / scores.length;
    seq += 1;
    out.push({
      groupId: `G${seq}`, takeIds: members.map((m) => m.id),
      reason: `copertura delle stesse righe (${Math.round(ov * 100)}% in comune) e durata simile nello stesso bin`,
      confidence: Math.round(Math.min(1, ov * 0.7 + ds * 0.3) * 100) / 100,
    });
  }
  return out;
}

/** Unisce proposte di gruppo senza duplicati: una proposta e' scartata se tutti i suoi take sono gia' in una precedente. */
export function mergeGroupProposals(...lists) {
  const out = [];
  for (const g of lists.flat()) {
    const ids = g.takeIds;
    if (out.some((o) => ids.every((id) => o.takeIds.includes(id)))) continue;
    out.push(g);
  }
  return out;
}

// ---- master -----------------------------------------------------------------------------------------------
/** Master tra i take dati: 'totale' noto, altrimenti copertura piu' ampia (righe, poi durata). {takeId, reason}|null. */
export function suggestMasterAmong(project, takeIds) {
  const takes = takeIds.map((id) => getTake(project, id)).filter(Boolean);
  if (!takes.length) return null;
  const cov = new Map(takes.map((t) => [t.id, coveredLines(project, t.id)]));
  const dur = (t) => seconds(project, t);
  const wide = takes.filter((t) => t.shot === 'totale');
  const pool = wide.length ? wide : takes;
  const covers = (t) => takes.filter((o) => o !== t && [...cov.get(o.id)].every((l) => cov.get(t.id).has(l))).length;
  const best = [...pool].sort((a, b) => cov.get(b.id).size - cov.get(a.id).size || dur(b) - dur(a) || a.id.localeCompare(b.id))[0];
  const n = cov.get(best.id).size;
  const all = takes.length > 1 && covers(best) === takes.length - 1;
  const reason = wide.length
    ? `inquadratura segnata come totale${wide.length > 1 ? ' (con la copertura piu\' ampia tra i totali)' : ''}`
    : `copertura piu' ampia del gruppo (${n} ${n === 1 ? 'riga' : 'righe'})${all ? ', include quelle degli altri take' : ''}`;
  return { takeId: best.id, reason };
}

export function suggestMaster(project, groupId) {
  return suggestMasterAmong(project, project.takes.filter((t) => t.groupId === groupId).map((t) => t.id));
}

/**
 * Ipotesi per gli altri take di un gruppo con master: 'stretto', SOLO come suggerimento (shotSource null).
 * Salta i take che hanno gia' un'inquadratura. [{takeId, shot:'stretto', shotSource:null, reason}]
 */
export function suggestGroupShots(project, groupId) {
  const m = suggestMaster(project, groupId);
  if (!m) return [];
  return project.takes.filter((t) => t.groupId === groupId && t.id !== m.takeId && !t.shot)
    .map((t) => ({ takeId: t.id, shot: 'stretto', shotSource: null, reason: `ipotesi: nel gruppo ${groupId} il master e' ${m.takeId}, gli altri angoli sono spesso piu' stretti` }));
}
