// Azioni sul montaggio guidate dallo script: master su V1 (take continuo), camera su V2/V3 per un intervallo di
// righe (linee verticali del testo), maniglie trascinabili, ritocco in frame. L'editor vero e' in editor.js.
import { lineSpan, masterTakeId } from '../viewmodel/sequence.js';

const local = { sel: null };
export const seqItems = (S) => S.snap.project?.sequence?.items || [];

/** 'Usa come master': righe selezionate, altrimenti tutte quelle coperte dal take. */
export async function setMasterFor(ctx, takeId) {
  const { S, ce } = ctx;
  if (!takeId) return;
  let ids = S.sel.filter((id) => S.d.byId.get(id)?.syncable);
  if (!ids.length) ids = (S.snap.view.coverage?.[takeId] || []).map((c) => c.lineId);
  if (!ids.length) { ctx.toast('Questo take non copre nessuna riga: agganciale prima (lettore, tasto M).', 'warn'); return; }
  if (seqItems(S).length && !(await ctx.confirmDialog('Il master sostituisce il montaggio attuale. Continuare? (Ctrl+Z annulla)', { okLabel: 'Sostituisci' }))) return;
  const r = await ctx.run('Master', () => ce.sequence.setMaster({ takeId, lineIds: ids }));
  if (r) { ctx.toggleEditor(true); ctx.toast(`“${ctx.takeLabel(takeId)}” è il master su V1.`, 'ok'); }
}

/** 'Metti questa camera qui': il take attivo copre le righe selezionate (o quella data) su V2/V3. */
export async function placeCamera(ctx, fallbackLineId) {
  const { S, ce } = ctx;
  if (!masterTakeId(seqItems(S)) && !seqItems(S).some((i) => i.role === 'master')) { ctx.toast('Crea prima il montaggio (assistente in alto) o scegli un master.', 'warn'); return; }
  if (!S.activeTakeId) { ctx.toast('Attiva il take della camera da inserire.', 'warn'); return; }
  const ids = S.sel.length ? S.sel : [fallbackLineId].filter(Boolean);
  const span = lineSpan(S.snap.view.lines, ids);
  if (!span) { ctx.toast('Seleziona una o più righe.', 'info'); return; }
  const r = await ctx.run('Cutaway', () => ce.sequence.addCutaway({ takeId: S.activeTakeId, ...span, startOffsetFrames: 0, endOffsetFrames: 0 }));
  if (r) { ctx.toggleEditor(true); ctx.toast(`“${ctx.takeLabel(S.activeTakeId)}” su V${r.track} per ${ids.length === 1 ? 'la riga' : 'le righe'} selezionate.`, 'ok'); }
}

/** Sposta una maniglia del cutaway su un'altra riga (trascinamento sulla vista sceneggiatura). */
export async function moveHandle(ctx, item, edge, lineId) {
  const lines = ctx.S.snap.view.lines;
  let from = item.fromLineId; let to = item.toLineId;
  if (edge === 'from') from = lineId; else to = lineId;
  if (lines.findIndex((l) => l.id === from) > lines.findIndex((l) => l.id === to)) [from, to] = [to, from];
  if (from === item.fromLineId && to === item.toLineId) return;
  await ctx.run('Cutaway', () => ctx.ce.sequence.trimCutaway(item.id, { fromLineId: from, toLineId: to, startOffsetFrames: item.startOffsetFrames || 0, endOffsetFrames: item.endOffsetFrames || 0 }));
}

/** Nudge in frame di inizio/fine (tasti [ e ]). */
export async function nudgeCutaway(ctx, item, edge, delta) {
  const patch = { fromLineId: item.fromLineId, toLineId: item.toLineId, startOffsetFrames: item.startOffsetFrames || 0, endOffsetFrames: item.endOffsetFrames || 0 };
  if (edge === 'start') patch.startOffsetFrames += delta; else patch.endOffsetFrames += delta;
  await ctx.run('Ritocco', () => ctx.ce.sequence.trimCutaway(item.id, patch));
}

export const selectedCutaway = (S) => seqItems(S).find((i) => i.id === local.sel && i.role === 'cutaway' && i.fromLineId) || null;
export const selectSeqItem = (id) => { local.sel = id; };
export const selectedSeqItem = () => local.sel;
