// Estensioni v2 di window.ce simulate (dati SINTETICI): bin, gruppi multicam, spoglio, valutazioni, sequenza, lavagna.
import { planAssemblyDetailed, coverageForTake } from '../../core/src/sync/index.js';

const delay = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const clone = (x) => JSON.parse(JSON.stringify(x));

const BINS = [
  { name: 'Scena 1', path: 'Riprese/Scena 1', clips: ['C1', 'C2'] },
  { name: 'Scena 2', path: 'Riprese/Scena 2', clips: [] },
  { name: 'Scena 3', path: 'Riprese/Scena 3', clips: ['C3', 'C4', 'C5'] },
];

function placeholder(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#2a2d32"/><rect x="0" y="0" width="320" height="6" fill="${color}"/><circle cx="160" cy="80" r="34" fill="${color}" opacity=".45"/><rect x="120" y="112" width="80" height="44" rx="8" fill="${color}" opacity=".3"/><text x="12" y="172" fill="#e6e7ea" font-family="sans-serif" font-size="14">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function createExt({ getProject, emit, opts = {} }) {
  const E = {
    takeProps: {
      T1: { groupId: 'G1', angle: 'CAM A', rating: 'buono', grade: 'B', tags: ['intenso'], bin: 'Scena 1', meta: { scene: '1', shot: '1A', take: '3', camera: 'A' } },
      T2: { groupId: 'G1', angle: 'CAM B', rating: null, grade: 'B+', tags: [], bin: 'Scena 1', meta: { scene: '1', shot: '1A', take: '3', camera: 'B' } },
      T3: { groupId: null, angle: null, rating: 'scarto', grade: '', tags: ['fuori fuoco'], bin: 'Scena 3', meta: { scene: '3', shot: '3B', take: '1', camera: 'A' } },
    },
    marks: { 'T1|L0004': { rating: 'buono', grade: 'B++', tags: [], note: 'Battuta perfetta' } },
    gradePalette: ['B', 'B+', 'B++'],
    sequence: { id: 'SEQ1', name: 'Sequenza', items: [] },
    board: { items: [], links: [] },
    undo: [], redo: [], seq: 0,
  };
  const nid = (p) => `${p}${++E.seq}`;
  const P = () => getProject();
  const props = (takeId) => (E.takeProps[takeId] ||= { groupId: null, angle: null, rating: null, grade: '', tags: [], bin: null, meta: null });
  const mut = async (fn) => { const r = fn(); emit(); await delay(); return r; };

  const decorate = (snap) => {
    snap.project.takes.forEach((t) => Object.assign(t, clone(props(t.id))));
    snap.view.takes.forEach((t) => Object.assign(t, clone(props(t.id))));
    Object.assign(snap.project, { marks: clone(E.marks), gradePalette: [...E.gradePalette], sequence: clone(E.sequence), board: clone(E.board) });
    snap.project.version = 2;
    return snap;
  };

  const clipInfo = (clipId) => {
    const c = P().clips[clipId];
    const take = P().takes.find((t) => t.clipId === clipId);
    const bin = BINS.find((b) => b.clips.includes(clipId));
    return { clipId, name: c?.name, fps: c?.fps ?? 25, durationFrames: c?.durationFrames ?? 1000, startTcFrames: c?.startTcFrames ?? 0, transcribed: clipId === 'C1', markers: [], bin: bin?.name || null, meta: take ? props(take.id).meta : null };
  };

  const snapEdit = () => { E.undo.push(clone({ lines: P().scriptDoc.lines, anchors: P().anchors, selection: P().selection })); if (E.undo.length > 50) E.undo.shift(); E.redo = []; };
  const nextLineId = () => `L${String(Math.max(...P().scriptDoc.lines.map((l) => parseInt(l.id.slice(1), 10))) + 1).padStart(4, '0')}`;
  const pushItem = (it) => { const item = { id: nid('SI'), kind: 'line', lineIds: [], role: 'main', track: 1, recordFrame: null, note: '', ...it }; E.sequence.items.push(item); return item; };

  // Calcola frame sorgente e punto in timeline dei cutaway a partire dal master.
  const recompute = () => {
    const items = E.sequence.items; const errors = {};
    const masters = items.filter((i) => i.role === 'master');
    const mCov = masters.length ? coverageForTake(P(), masters[0].takeId, { maxTailFrames: 150 }) : [];
    let cum = 0; const mpos = {};
    for (const m of masters) { for (const lid of m.lineIds) { const c = mCov.find((x) => x.lineId === lid); if (c) mpos[lid] = cum + (c.startFrame - m.startFrame); } cum += m.endFrame - m.startFrame; }
    for (const it of items.filter((i) => i.role === 'cutaway')) {
      const cov = coverageForTake(P(), it.takeId, { maxTailFrames: 150 });
      const a = cov.find((c) => c.lineId === it.fromLineId); const b = cov.find((c) => c.lineId === it.toLineId);
      if (!a || !b) { errors[it.id] = 'Questa camera non copre le righe scelte.'; continue; }
      const dur = P().clips[P().takes.find((t) => t.id === it.takeId).clipId].durationFrames;
      it.startFrame = Math.max(0, a.startFrame + (it.startOffsetFrames || 0)); it.endFrame = Math.min(dur, Math.max(it.startFrame + 1, b.endFrame + (it.endOffsetFrames || 0)));
      it.lineIds = P().scriptDoc.lines.map((l) => l.id).slice(P().scriptDoc.lines.findIndex((l) => l.id === it.fromLineId), P().scriptDoc.lines.findIndex((l) => l.id === it.toLineId) + 1);
      it.recordFrame = mpos[it.fromLineId] ?? null;
      if (it.recordFrame == null) errors[it.id] = 'Le righe non fanno parte del master: il cutaway non ha un punto in timeline.';
    }
    // V2, oppure V3 se si sovrappongono
    const placed = [];
    for (const it of items.filter((i) => i.role === 'cutaway' && Number.isFinite(i.recordFrame))) {
      const len = it.endFrame - it.startFrame; let tr = 2;
      while (placed.some((p) => p.track === tr && p.rec < it.recordFrame + len && it.recordFrame < p.rec + p.len)) tr++;
      it.track = tr; placed.push({ track: tr, rec: it.recordFrame, len });
    }
    return { errors };
  };

  const api = {
    async listBins() { await delay(); return BINS.map((b) => ({ name: b.name, path: b.path, clipCount: b.clips.length })); },
    async loadBins(names) {
      await delay(150);
      const clips = [];
      for (const b of BINS.filter((x) => names.includes(x.name))) {
        for (const id of b.clips) {
          if (!P().clips[id]) { P().clips[id] = { fps: 25, durationFrames: 900 + id.charCodeAt(1) * 3, startTcFrames: 90000, name: id === 'C4' ? 'A002_C002' : 'A002_C003' }; }
          let take = P().takes.find((t) => t.clipId === id);
          if (!take) { take = { id: `T${P().takes.length + 1}`, clipId: id, label: `Ciak ${P().takes.length + 1}` }; P().takes.push(take); props(take.id).bin = b.name; props(take.id).meta = { scene: b.name.slice(-1), shot: '3B', take: '2', camera: id === 'C4' ? 'B' : 'A' }; }
          clips.push(clipInfo(id));
        }
      }
      emit();
      return clips;
    },
    async detectGroups() {
      await delay(120);
      const t4 = P().takes.find((t) => t.clipId === 'C4');
      const t3 = P().takes.find((t) => t.id === 'T3');
      if (t3 && t4 && !(props(t4.id).groupId)) return [{ groupId: 'G2', label: 'Scena 3 · 3B', takeIds: [t3.id, t4.id], reason: 'stesso Shot/Take, timecode sovrapposto' }];
      return [];
    },
    async setTakeGroup(takeId, groupId, angle) { return mut(() => { Object.assign(props(takeId), { groupId: groupId || null, angle: angle || null }); return { ok: true }; }); },
    async editScript(e) {
      await delay(30);
      const doc = P().scriptDoc; const i = doc.lines.findIndex((l) => l.id === e.lineId);
      if (e.op !== 'setType' && e.op !== 'retypeSelection' && e.op !== 'setCharacter') return { ok: false, reason: 'op non supportata dal mock' };
      if (i < 0) return { ok: false, reason: 'riga sconosciuta' };
      snapEdit();
      const l = doc.lines[i];
      const setT = (ln, type) => { ln.type = type; if (type === 'dialogue') ln.character = e.character || ln.character || 'PERSONAGGIO'; else if (type !== 'character') ln.character = null; };
      if (e.op === 'setType') setT(l, e.type);
      else if (e.op === 'setCharacter') l.character = e.character;
      else {
        const pre = l.text.slice(0, e.startOffset).trim(); const mid = l.text.slice(e.startOffset, e.endOffset).trim(); const post = l.text.slice(e.endOffset).trim();
        const orig = { ...l }; const add = [];
        const base = parseInt(nextLineId().slice(1), 10);
        const mk = (text, type) => { const n = { ...orig, id: `L${String(base + add.length).padStart(4, '0')}`, text, order: 0 }; setT(n, type); add.push(n); return n; };
        if (pre) { l.text = pre; mk(mid, e.type); } else { l.text = mid; setT(l, e.type); }
        if (post) mk(post, orig.type);
        doc.lines.splice(i + 1, 0, ...add);
        doc.lines.forEach((x, k) => { x.order = k + 1; });
      }
      emit();
      return { ok: true };
    },
    async undo() { await delay(20); const s = E.undo.pop(); if (!s) return { ok: false, reason: 'Niente da annullare.' }; E.redo.push(clone({ lines: P().scriptDoc.lines, anchors: P().anchors, selection: P().selection })); P().scriptDoc.lines = s.lines; P().anchors = s.anchors; P().selection = s.selection; emit(); return { ok: true }; },
    async redo() { await delay(20); const s = E.redo.pop(); if (!s) return { ok: false, reason: 'Niente da ripetere.' }; E.undo.push(clone({ lines: P().scriptDoc.lines, anchors: P().anchors, selection: P().selection })); P().scriptDoc.lines = s.lines; P().anchors = s.anchors; P().selection = s.selection; emit(); return { ok: true }; },
    async setMark({ takeId, lineId, rating, grade, tags }) {
      return mut(() => {
        const tgt = lineId ? (E.marks[`${takeId}|${lineId}`] ||= { rating: null, grade: '', tags: [], note: '' }) : props(takeId);
        if (rating !== undefined) tgt.rating = rating; if (grade !== undefined) tgt.grade = grade; if (tags !== undefined) tgt.tags = tags;
        return { ok: true };
      });
    },
    async setGradePalette(list) { return mut(() => { E.gradePalette = list; return { ok: true }; }); },

    sequence: {
      async fromLines(lineIds, o = {}) {
        return mut(() => {
          const r = planAssemblyDetailed(P(), lineIds, { handleFrames: o.handleFrames || 0 });
          r.cuts.forEach((c) => pushItem({ lineIds: c.lineIds, takeId: c.takeId, startFrame: c.startFrame, endFrame: c.endFrame }));
          return { ok: true, added: r.cuts.length, skipped: r.skipped };
        });
      },
      async addItem(it) { return mut(() => ({ ok: true, id: pushItem(it).id })); },
      async moveItem(id, { index, track }) {
        return mut(() => {
          const a = E.sequence.items; const k = a.findIndex((x) => x.id === id); if (k < 0) return { ok: false };
          const [it] = a.splice(k, 1); if (track) it.track = track;
          a.splice(index == null ? k : Math.min(index, a.length), 0, it); return { ok: true };
        });
      },
      async trimItem(id, { startFrame, endFrame }) {
        return mut(() => {
          const it = E.sequence.items.find((x) => x.id === id); if (!it) return { ok: false };
          const dur = P().clips[P().takes.find((t) => t.id === it.takeId)?.clipId]?.durationFrames ?? 1e9;
          it.startFrame = Math.max(0, startFrame ?? it.startFrame); it.endFrame = Math.min(dur, endFrame ?? it.endFrame);
          if (it.endFrame <= it.startFrame) it.endFrame = it.startFrame + 1; return { ok: true };
        });
      },
      async removeItem(id) { return mut(() => { E.sequence.items = E.sequence.items.filter((x) => x.id !== id); return { ok: true }; }); },
      // Master: il take "totale" su V1, continuo sulle righe scelte (con audio).
      async setMaster({ takeId, lineIds }) {
        return mut(() => {
          const cov = coverageForTake(P(), takeId, { maxTailFrames: 150 }).filter((c) => lineIds.includes(c.lineId));
          E.sequence.items = E.sequence.items.filter((i) => i.role !== 'master');
          const ordered = P().scriptDoc.lines.map((l) => cov.find((c) => c.lineId === l.id)).filter(Boolean);
          const cuts = [];
          for (const c of ordered) {
            const p = cuts[cuts.length - 1];
            if (p && c.startFrame <= p.endFrame + 1) { p.endFrame = Math.max(p.endFrame, c.endFrame); p.lineIds.push(c.lineId); } else cuts.push({ startFrame: c.startFrame, endFrame: c.endFrame, lineIds: [c.lineId] });
          }
          cuts.forEach((c) => E.sequence.items.unshift(Object.assign(pushItem({ takeId, role: 'master', track: 1, ...c }), {})));
          E.sequence.items.sort((a, b) => (a.role === 'master' ? 0 : 1) - (b.role === 'master' ? 0 : 1));
          recompute();
          return { ok: true, items: cuts.length };
        });
      },
      async addCutaway({ takeId, fromLineId, toLineId, startOffsetFrames = 0, endOffsetFrames = 0, track }) {
        return mut(() => {
          const it = pushItem({ kind: 'clip', role: 'cutaway', takeId, fromLineId, toLineId, startOffsetFrames, endOffsetFrames, track: track || 2, lineIds: [] });
          const r = recompute();
          return r.errors[it.id] ? (E.sequence.items.pop(), { ok: false, reason: r.errors[it.id] }) : { ok: true, id: it.id };
        });
      },
      async trimCutaway(id, patch) {
        return mut(() => {
          const it = E.sequence.items.find((x) => x.id === id); if (!it || it.role !== 'cutaway') return { ok: false, reason: 'Cutaway sconosciuto.' };
          Object.assign(it, patch); recompute(); return { ok: true };
        });
      },
      async assemble({ timelineName, layered }) {
        await delay(250);
        const items = E.sequence.items;
        return { ok: true, timelineName, itemsAdded: items.length, tracksCreated: Math.max(0, Math.max(1, ...items.map((i) => i.track || 1)) - 1), skipped: [] };
      },
    },

    async getClipMediaPath(takeId) { await delay(); return { path: `/esempio/media/${takeId}.mov`, codec: opts.codec || 'ProRes 422', fps: 25 }; },
    board: {
      async captureStill({ takeId, frame }) {
        await delay(120);
        if (opts.stillVia === 'none') return { ok: false, via: 'none', reason: 'ExportFrame non disponibile in questa versione.' };
        const label = `${takeId} · frame ${frame}`;
        return { ok: true, via: 'exportFrame', path: placeholder(label, ['#4fa3ff', '#ff9f43', '#4cd38a', '#e56bd0'][frame % 4]) };
      },
      async addItem(it) {
        return mut(() => {
          const i = it.id ? E.board.items.findIndex((x) => x.id === it.id) : -1;
          if (i >= 0) { E.board.items[i] = { ...E.board.items[i], ...it }; return { ok: true, id: it.id }; }
          const item = { id: nid('B'), z: E.board.items.length + 1, w: 200, h: 120, x: 20, y: 20, caption: '', lineId: null, ...it };
          E.board.items.push(item); return { ok: true, id: item.id };
        });
      },
      async moveItem(id, { x, y }) { return mut(() => { Object.assign(E.board.items.find((i) => i.id === id) || {}, { x, y }); return { ok: true }; }); },
      async resizeItem(id, { w, h }) { return mut(() => { Object.assign(E.board.items.find((i) => i.id === id) || {}, { w, h }); return { ok: true }; }); },
      async setCaption(id, text) { return mut(() => { const i = E.board.items.find((x) => x.id === id); if (i) i.caption = text; return { ok: true }; }); },
      async removeItem(id) { return mut(() => { E.board.items = E.board.items.filter((i) => i.id !== id); E.board.links = E.board.links.filter((l) => l.from !== id && l.to !== id); return { ok: true }; }); },
      async link(from, to) { return mut(() => { if (!E.board.links.some((l) => l.from === from && l.to === to)) E.board.links.push({ from, to }); return { ok: true }; }); },
      async toSequence({ order = 'x', ids, holdFrames = 50 }) {
        return mut(() => {
          const key = { x: (i) => i.x, y: (i) => i.y, z: (i) => i.z }[order] || ((i) => i.x);
          const st = E.board.items.filter((i) => i.type === 'still' && (!ids || ids.includes(i.id))).sort((a, b) => key(a) - key(b));
          st.forEach((s) => { const dur = P().clips[P().takes.find((t) => t.id === s.takeId)?.clipId]?.durationFrames ?? 1000; const a = Math.max(0, (s.frame ?? 0) - Math.floor(holdFrames / 2)); pushItem({ kind: 'clip', takeId: s.takeId, startFrame: a, endFrame: Math.min(dur, a + holdFrames), note: s.caption || '' }); });
          return { ok: true, added: st.length };
        });
      },
    },
    async saveFile({ suggestedName }) { await delay(80); return { path: `~/Desktop/${suggestedName}` }; },
  };

  // dati iniziali: lavagna e sequenza di esempio
  E.board.items.push(
    { id: 'B1', type: 'still', takeId: 'T1', frame: 120, imagePath: placeholder('T1 · frame 120', '#4fa3ff'), x: 40, y: 60, w: 220, h: 124, z: 1, caption: 'Entrata di Livia', lineId: 'L0002' },
    { id: 'B2', type: 'still', takeId: 'T2', frame: 300, imagePath: placeholder('T2 · frame 300', '#ff9f43'), x: 320, y: 90, w: 220, h: 124, z: 2, caption: 'Primo piano Teo', lineId: null },
    { id: 'B3', type: 'note', x: 180, y: 260, w: 200, h: 90, z: 3, caption: 'Controllare continuità della tazza', color: '#f2d14a', lineId: null },
  );
  E.board.links.push({ from: 'B1', to: 'B2' });
  E.seq = 10;
  api.sequence.setMaster({ takeId: 'T1', lineIds: ['L0002', 'L0003', 'L0004', 'L0005', 'L0006', 'L0007'] })
    .then(() => api.sequence.addCutaway({ takeId: 'T2', fromLineId: 'L0005', toLineId: 'L0005', startOffsetFrames: 0, endOffsetFrames: 10 }));
  return { E, api, decorate };
}
