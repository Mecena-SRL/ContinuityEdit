// Mini-sequenza: V1 master (totale, con audio) + cutaway su V2/V3 (solo video). Montaggio grezzo, non un editor di stacchi.
import { h } from '../dom.js';
import { layoutSequence, totalFrames, trackCount, lineSpan, cutawayLineIds, masterTakeId, trackLabel } from '../viewmodel/sequence.js';
import { framesToTimecode, formatDuration } from '../viewmodel/format.js';
import { assemblySummary, skipReasonLabel } from '../viewmodel/summary.js';

const local = { sel: null, result: null, busy: false, withAudio: true };

export const seqItems = (S) => S.snap.project?.sequence?.items || [];

/** 'Imposta come master': righe selezionate, altrimenti tutte quelle coperte dal take. */
export async function setMasterFor(ctx, takeId) {
  const { S, ce } = ctx;
  let ids = S.sel.filter((id) => S.d.byId.get(id)?.syncable);
  if (!ids.length) ids = (S.snap.view.coverage?.[takeId] || []).map((c) => c.lineId);
  if (!ids.length) { ctx.toast('Questo take non copre nessuna riga: aggiungi prima le ancore.', 'warn'); return; }
  const r = await ctx.run('Master', () => ce.sequence.setMaster({ takeId, lineIds: ids }));
  if (r) ctx.toast(r.ok === false ? `Master: ${r.reason || 'non riuscito'}` : `“${ctx.takeLabel(takeId)}” è il master su V1 (${ids.length} righe).`, r.ok === false ? 'warn' : 'ok');
}

/** 'Metti questa camera qui': il take attivo copre le righe selezionate (o quella data) su V2/V3. */
export async function placeCamera(ctx, fallbackLineId) {
  const { S, ce } = ctx;
  if (!masterTakeId(seqItems(S))) { ctx.toast('Imposta prima un master (pulsante “Master” su un take).', 'warn'); return; }
  if (!S.activeTakeId) { ctx.toast('Attiva il take della camera da inserire.', 'warn'); return; }
  if (S.activeTakeId === masterTakeId(seqItems(S))) { ctx.toast('Il take attivo è il master: scegli un’altra camera.', 'warn'); return; }
  const ids = S.sel.length ? S.sel : [fallbackLineId].filter(Boolean);
  const span = lineSpan(S.snap.view.lines, ids);
  if (!span) { ctx.toast('Seleziona una o più righe.', 'info'); return; }
  const r = await ctx.run('Cutaway', () => ce.sequence.addCutaway({ takeId: S.activeTakeId, ...span, startOffsetFrames: 0, endOffsetFrames: 0 }));
  if (r) ctx.toast(r.ok === false ? `Cutaway: ${r.reason || 'non riuscito'}` : `“${ctx.takeLabel(S.activeTakeId)}” inserita come cutaway.`, r.ok === false ? 'warn' : 'ok');
}

/** Sposta una maniglia del cutaway su un'altra riga (trascinamento sulla vista sceneggiatura). */
export async function moveHandle(ctx, item, edge, lineId) {
  const lines = ctx.S.snap.view.lines;
  let from = item.fromLineId; let to = item.toLineId;
  if (edge === 'from') from = lineId; else to = lineId;
  if (lines.findIndex((l) => l.id === from) > lines.findIndex((l) => l.id === to)) [from, to] = [to, from];
  if (from === item.fromLineId && to === item.toLineId) return;
  const r = await ctx.run('Cutaway', () => ctx.ce.sequence.trimCutaway(item.id, { fromLineId: from, toLineId: to, startOffsetFrames: item.startOffsetFrames || 0, endOffsetFrames: item.endOffsetFrames || 0 }));
  if (r && r.ok === false) ctx.toast(`Cutaway: ${r.reason || 'non riuscito'}`, 'warn');
}

/** Nudge in frame di inizio/fine (tasti [ e ]). */
export async function nudgeCutaway(ctx, item, edge, delta) {
  const patch = { fromLineId: item.fromLineId, toLineId: item.toLineId, startOffsetFrames: item.startOffsetFrames || 0, endOffsetFrames: item.endOffsetFrames || 0 };
  if (edge === 'start') patch.startOffsetFrames += delta; else patch.endOffsetFrames += delta;
  await ctx.run('Nudge', () => ctx.ce.sequence.trimCutaway(item.id, patch));
}

export const selectedCutaway = (S) => seqItems(S).find((i) => i.id === local.sel && i.role === 'cutaway') || null;
export const selectSeqItem = (id) => { local.sel = id; };

export function sequenceTab(ctx) {
  const { S, ce } = ctx;
  const items = seqItems(S);
  const master = masterTakeId(items);
  const lay = layoutSequence(items);
  const total = totalFrames(items);
  const fps = ctx.fpsOf(master || S.activeTakeId) || 25;
  const ppf = total ? Math.min(2, 520 / total) : 1;
  const tracks = trackCount(items);
  const sel = items.find((i) => i.id === local.sel) || null;

  const lane = (tr) => h('div', { class: 'lane' },
    h('span', { class: 'lane-label' }, trackLabel(tr)),
    h('div', { class: 'lane-track', style: { width: `${Math.max(120, total * ppf)}px` } },
      items.map((it, k) => ((it.track || 1) === tr ? h('button', {
        class: `blk ${it.role === 'master' ? 'master' : 'cut'}${it.id === local.sel ? ' on' : ''}`, type: 'button', style: { left: `${lay[k].x}px`, width: `${lay[k].w}px`, '--c': ctx.takeColor(it.takeId) },
        title: `${ctx.takeLabel(it.takeId)} · ${formatDuration(lay[k].frames, fps)} · da ${framesToTimecode(lay[k].startAt, fps)}`, 'data-fk': `blk-${it.id}`,
        onclick: () => { local.sel = it.id; ctx.rerender(['dock', 'script']); },
      }, h('span', {}, ctx.takeLabel(it.takeId))) : null))));

  const go = async () => {
    local.busy = true; local.result = null; ctx.rerender(['dock']);
    const r = await ctx.run('Invio in timeline', () => ce.sequence.assemble({ timelineName: S.assemble.name.trim() || 'Assemblaggio', withAudio: local.withAudio }));
    local.busy = false; local.result = r || null; ctx.rerender(['dock']);
  };

  return h('div', { class: 'seq' },
    h('p', { class: 'hint' }, 'Montaggio grezzo: il master (il “totale”) sta su V1 e prosegue; le altre camere coprono un intervallo di righe su V2/V3, solo video. Trascina le maniglie delle linee sul testo per cambiare le righe.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'seq-master', disabled: !S.activeTakeId, onclick: () => setMasterFor(ctx, S.activeTakeId) }, `Imposta master: ${S.activeTakeId ? ctx.takeLabel(S.activeTakeId) : '–'}`),
      h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'seq-cam', disabled: !master || !S.sel.length, onclick: () => placeCamera(ctx) }, 'Metti camera attiva sulle righe selezionate'),
      master ? h('span', { class: 'chip ok' }, `Master: ${ctx.takeLabel(master)}`) : h('span', { class: 'chip warn' }, 'Nessun master')),
    items.length ? h('div', { class: 'lanes', role: 'group', 'aria-label': 'Corsie della sequenza' },
      Array.from({ length: tracks }, (_, k) => tracks - k).map(lane),
      h('div', { class: 'dim lane-foot' }, `Durata totale ${framesToTimecode(total, fps)} (${formatDuration(total, fps)}). I cutaway tornano da soli sul master.`))
      : h('p', { class: 'empty' }, 'Sequenza vuota. Scegli un take e premi “Imposta master”.'),
    sel ? inspector(ctx, sel) : null,
    h('div', { class: 'form' },
      h('label', { class: 'fld-col' }, h('span', {}, 'Nome timeline'), h('input', { class: 'input', type: 'text', value: S.assemble.name, 'data-fk': 'seq-name', oninput: (e) => { S.assemble.name = e.target.value; } })),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: local.withAudio, 'data-fk': 'seq-audio', onchange: (e) => { local.withAudio = e.target.checked; } }), ' Con audio (master)')),
    h('button', { class: 'btn btn-primary', type: 'button', 'data-fk': 'seq-go', disabled: !items.length || local.busy, onclick: go }, local.busy ? 'Invio…' : 'Manda in timeline'),
    local.result ? h('div', { class: `result ${local.result.ok ? 'ok' : 'bad'}`, role: 'status' },
      h('p', {}, assemblySummary(local.result), local.result.tracksCreated ? ` Corsie video create: ${local.result.tracksCreated}.` : ''),
      local.result.skipped?.length ? h('ul', { class: 'plain' }, local.result.skipped.map((s) => h('li', {}, h('span', { class: 'mono dim' }, s.lineId || s.itemId || ''), ' — ', skipReasonLabel(s.reason)))) : null) : null);
}

function inspector(ctx, it) {
  const { S, ce } = ctx;
  const lines = S.snap.view.lines;
  const txt = (id) => (lines.find((l) => l.id === id)?.text || '').slice(0, 40);
  const isCut = it.role === 'cutaway';
  const nudge = (edge, d) => nudgeCutaway(ctx, it, edge, d);
  const setOff = (edge) => (e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v)) ctx.run('Offset', () => ce.sequence.trimCutaway(it.id, { fromLineId: it.fromLineId, toLineId: it.toLineId, startOffsetFrames: edge === 'start' ? v : it.startOffsetFrames || 0, endOffsetFrames: edge === 'end' ? v : it.endOffsetFrames || 0 })); };
  const ctl = (edge, label) => h('div', { class: 'btn-row' }, h('span', { class: 'ins-l' }, label),
    h('button', { class: 'btn btn-small', type: 'button', 'aria-label': `${label} meno un frame`, onclick: () => nudge(edge, -1) }, '−1'),
    h('input', { class: 'input frame-in sm', type: 'number', value: edge === 'start' ? it.startOffsetFrames || 0 : it.endOffsetFrames || 0, 'aria-label': `${label} offset in frame`, 'data-fk': `off-${edge}`, onchange: setOff(edge) }),
    h('button', { class: 'btn btn-small', type: 'button', 'aria-label': `${label} più un frame`, onclick: () => nudge(edge, 1) }, '+1'));
  return h('div', { class: 'inspector' },
    h('div', { class: 'ctx' }, h('b', {}, `${isCut ? 'Cutaway' : 'Master'} · ${ctx.takeLabel(it.takeId)}`), h('span', { class: 'dim' }, `${trackLabel(it.track || 1)} · frame ${it.startFrame}–${it.endFrame}`)),
    isCut ? h('p', { class: 'dim' }, `Da “${txt(it.fromLineId)}…” a “${txt(it.toLineId)}…” (${cutawayLineIds(lines, it).length} righe)`) : h('p', { class: 'dim' }, `${(it.lineIds || []).length} righe`),
    isCut ? [ctl('start', 'Inizio (frame)'), ctl('end', 'Fine (frame)'), h('p', { class: 'hint' }, 'Sulla vista sceneggiatura: [ e ] spostano la fine di 1 frame (Maiusc: 5), Alt+[ e Alt+] l’inizio.')] : null,
    h('button', { class: 'btn btn-small btn-ghost-danger', type: 'button', 'data-fk': 'seq-rm', onclick: async () => { await ctx.run('Rimozione', () => ce.sequence.removeItem(it.id)); local.sel = null; ctx.rerender(['dock', 'script']); } }, 'Rimuovi dalla sequenza'));
}
