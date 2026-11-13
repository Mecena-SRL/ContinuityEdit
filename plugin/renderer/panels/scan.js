// Scansione clip: foglio di contatto (3 miniature per clip: inizio / meta' / fine) per classificare in fretta i take
// come Totale/Medio/Stretto/Dettaglio/Altro. Tasti 1-5 = tipo, Invio = conferma la proposta, 0 = azzera, frecce = take
// successivo/precedente. Le proposte (metadati, copertura) sono solo evidenziate: si scrive solo dopo conferma.
// Nessun file viene esportato: le miniature arrivano da thumbs.js (video nascosto + canvas, cache locale).
import { h, renderInto } from '../dom.js';
import { getThumb } from '../thumbs.js';
import { cacheKey } from '../viewmodel/thumbs.js';
import { anglesForGroup } from '../viewmodel/groups.js';
import { framesToTimecode } from '../viewmodel/format.js';
import {
  SHOT_OPTIONS, shotLabel, shotAbbr, sourceLabel, sheetFrames, shotState, scanProgress, filterScanTakes, stepIndex, actionForKey, groupSections,
} from '../viewmodel/shots.js';

const SC = { filter: 'tutti', view: 'foglio', focus: null, info: {}, hyps: {}, sig: '', urls: new Map(), prevFocus: null, busy: false };
let overlay = null; let bar = null; let body = null;
const SIZE = 200;

export function renderScan(ctx) {
  const { S } = ctx;
  if (!S.scanOpen) { if (overlay) { overlay.remove(); overlay = null; SC.prevFocus?.focus?.(); } return; }
  if (!overlay) {
    SC.prevFocus = document.activeElement; SC.sig = '';
    bar = h('div', { class: 'scan-bar' });
    body = h('div', { class: 'scan-body' });
    overlay = h('div', { class: 'scan-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Scansione clip' }, bar, body);
    overlay.addEventListener('keydown', (e) => onKey(e, ctx));
    document.body.append(overlay);
  }
  const takes = S.d.allTakes || [];
  if (!SC.focus || !takes.some((t) => t.id === SC.focus)) SC.focus = takes[0]?.id ?? null;
  const sig = takes.map((t) => `${t.id}|${t.groupId}|${t.shot}|${t.shotSource}`).join(',');
  if (sig !== SC.sig) { SC.sig = sig; refreshInfo(ctx); }
  renderInto(bar, () => buildBar(ctx, takes));
  renderInto(body, () => buildBody(ctx, takes));
  if (!SC.focused) { SC.focused = true; focusCard(SC.focus); }
}

function close(ctx) { ctx.S.scanOpen = false; SC.focused = false; renderScan(ctx); }

// Master suggerito e ipotesi "stretto" per ogni gruppo esistente (solo lettura: nulla viene scritto).
async function refreshInfo(ctx) {
  const groups = [...new Set((ctx.S.d.allTakes || []).map((t) => t.groupId).filter(Boolean))];
  const info = {}; const hyps = {};
  for (const g of groups) {
    try {
      const r = await ctx.ce.suggestMaster(g);
      info[g] = { takeId: r.takeId, reason: r.reason };
      for (const x of r.hypotheses || []) hyps[x.takeId] = { shot: x.shot, reason: x.reason };
    } catch { /* gruppo non piu' valido */ }
  }
  SC.info = info; SC.hyps = hyps;
  if (ctx.S.scanOpen) renderScan(ctx);
}

const focusCard = (id) => requestAnimationFrame(() => {
  const el = body?.querySelector(`[data-fk="sc-${CSS.escape(id || '')}"]`) || [...(body?.querySelectorAll('[data-fk]') || [])].find((e) => e.dataset.fk === `sc-${id}`);
  if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
});

function visibleTakes(takes) { return filterScanTakes(takes, SC.filter, SC.hyps); }
function orderedList(takes) { return SC.view === 'gruppi' ? groupSections(visibleTakes(takes)).flatMap((s) => s.takes) : visibleTakes(takes); }

async function applyAction(ctx, take, act) {
  if (!act) return;
  const { ce, run } = ctx;
  if (act.type === 'clear') await run('Inquadratura', () => ce.setTakeShot({ takeId: take.id, shot: null }));
  else await run('Inquadratura', () => ce.setTakeShot({ takeId: take.id, shot: act.shot, source: act.source }));
}

function onKey(e, ctx) {
  if (e.key === 'Escape') { e.preventDefault(); close(ctx); return; }
  if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  const takes = ctx.S.d.allTakes || [];
  const list = orderedList(takes);
  let i = list.findIndex((t) => t.id === SC.focus);
  if (i < 0) i = 0;
  const arrows = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (arrows[e.key]) {
    e.preventDefault();
    const n = stepIndex(i, arrows[e.key], list.length);
    if (n >= 0) { SC.focus = list[n].id; ctx.rerender(['scan']); focusCard(SC.focus); }
    return;
  }
  const take = list[i];
  if (!take) return;
  const act = actionForKey(e.key, take, SC.hyps[take.id]);
  if (!act) return;
  e.preventDefault();
  const next = list[stepIndex(i, 1, list.length)] || take;
  applyAction(ctx, take, act).then(() => {
    if (act.type === 'set' && next) SC.focus = next.id; // dopo una classificazione si passa al take successivo
    ctx.rerender(['scan']); focusCard(SC.focus);
  });
}

// ---------- barra ----------
function buildBar(ctx, takes) {
  const { S } = ctx;
  const pr = scanProgress(takes, SC.hyps);
  const metaProps = takes.filter((t) => shotState(t, SC.hyps[t.id]).state === 'proposta');
  return [
    h('div', { class: 'scan-title' },
      h('h2', {}, 'Scansione clip'),
      h('span', { class: `chip ${pr.mancanti ? 'warn' : 'ok'}` }, `${pr.confermati}/${pr.totale} classificati`),
      pr.proposte ? h('span', { class: 'chip prop' }, `${pr.proposte} proposte da confermare`) : null,
      pr.mancanti ? h('span', { class: 'chip warn' }, `${pr.mancanti} da classificare`) : null,
      h('span', { class: 'tb-spacer' }),
      h('button', { class: 'btn', type: 'button', 'data-fk': 'scan-close', onclick: () => close(ctx) }, 'Chiudi (Esc)')),
    h('div', { class: 'scan-tools' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Vista' },
        [['foglio', 'Foglio di contatto'], ['gruppi', 'Per gruppo']].map(([k, l]) => h('button', { class: `btn btn-small${SC.view === k ? ' btn-on' : ''}`, type: 'button', 'aria-pressed': String(SC.view === k), 'data-fk': `scan-v-${k}`, onclick: () => { SC.view = k; ctx.rerender(['scan']); } }, l))),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Filtro' },
        [['tutti', 'Tutti'], ['da-fare', 'Da fare'], ['mancanti', 'Senza proposta']].map(([k, l]) => h('button', { class: `btn btn-small${SC.filter === k ? ' btn-on' : ''}`, type: 'button', 'aria-pressed': String(SC.filter === k), 'data-fk': `scan-f-${k}`, onclick: () => { SC.filter = k; ctx.rerender(['scan']); } }, l))),
      h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'scan-cov', disabled: SC.busy || takes.length < 2, title: 'Propone gruppi di take che coprono le stesse righe (stesso bin, durata simile)', onclick: () => groupByCoverage(ctx) }, 'Raggruppa per copertura'),
      h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'scan-all', disabled: !metaProps.length, title: 'Conferma in un colpo solo tutte le proposte evidenziate', onclick: () => confirmAll(ctx, metaProps) }, `Conferma proposte (${metaProps.length})`)),
    h('p', { class: 'hint' }, h('kbd', {}, '1'), ' Totale · ', h('kbd', {}, '2'), ' Medio · ', h('kbd', {}, '3'), ' Stretto · ', h('kbd', {}, '4'), ' Dettaglio · ', h('kbd', {}, '5'), ' Altro · ',
      h('kbd', {}, 'Invio'), ' conferma la proposta · ', h('kbd', {}, '0'), ' azzera · ', h('kbd', {}, '←'), h('kbd', {}, '→'), ' take precedente/successivo. Dopo ogni scelta si passa al take successivo.'),
  ];
}

async function confirmAll(ctx, list) {
  const ok = await ctx.confirmDialog(`Confermare ${list.length} proposte di inquadratura (metadati o copertura)? Potrai correggerle una per una.`, { okLabel: 'Conferma' });
  if (!ok) return;
  await ctx.run('Inquadratura', async () => { for (const t of list) { const p = shotState(t, SC.hyps[t.id]).proposed; if (p) await ctx.ce.setTakeShot({ takeId: t.id, shot: p.shot, source: p.source }); } });
  ctx.toast(`${list.length} proposte confermate.`, 'ok');
}

async function groupByCoverage(ctx) {
  SC.busy = true; ctx.rerender(['scan']);
  let found;
  try { found = await ctx.run('Raggruppa per copertura', () => ctx.ce.detectGroupsByCoverage()); } finally { SC.busy = false; ctx.rerender(['scan']); }
  if (!found) return;
  if (!found.length) { ctx.toast('Nessun nuovo gruppo trovato: servono take dello stesso bin che coprono le stesse righe (aggiungi prima le ancore o il sync).', 'info', 7000); return; }
  const txt = found.map((g) => `${g.takeIds.map((id) => ctx.takeLabel(id)).join(' + ')} (${g.source === 'copertura' ? 'copertura' : 'metadati/nome'}${g.confidence != null ? `, ${Math.round(g.confidence * 100)}%` : ''})`).join('\n');
  if (!(await ctx.confirmDialog(`${found.length === 1 ? 'Trovato 1 gruppo' : `Trovati ${found.length} gruppi`}:\n${txt}\n\nRaggrupparli?`, { okLabel: 'Raggruppa' }))) return;
  await ctx.run('Raggruppa per copertura', async () => {
    for (const g of found) for (const a of anglesForGroup(g.takeIds)) await ctx.ce.setTakeGroup(a.takeId, g.groupId, a.angle);
  });
  SC.view = 'gruppi';
  ctx.toast('Angoli raggruppati. Per ogni gruppo puoi impostare il master suggerito.', 'ok');
  ctx.rerender(['scan']);
}

async function setMaster(ctx, groupId, takeId) {
  const { ce, S } = ctx;
  await ctx.run('Master', async () => {
    const cur = (S.d.allTakes || []).find((t) => t.id === takeId);
    if (!(cur?.shot === 'totale' && (cur.shotSource === 'manuale' || cur.shotSource === 'copertura'))) await ce.setTakeShot({ takeId, shot: 'totale', source: 'copertura' });
    const ids = (S.snap.view.coverage?.[takeId] || []).map((c) => c.lineId);
    if (ids.length) await ce.sequence.setMaster({ takeId, lineIds: ids });
    else ctx.toast('Il master non ha righe coperte: segnato come Totale, ma la sequenza non e\' stata toccata.', 'warn');
  });
  ctx.toast(`“${ctx.takeLabel(takeId)}” è il master del gruppo ${groupId}. Gli altri angoli sono solo ipotesi (Stretto): confermali con Invio.`, 'ok', 6000);
  refreshInfo(ctx);
}

// ---------- corpo ----------
function buildBody(ctx, takes) {
  if (!takes.length) return h('div', { class: 'empty big' }, h('p', {}, 'Nessun take da scansionare.'), h('p', { class: 'dim' }, 'Carica un bin di scena o aggiungi le clip selezionate dal pannello “Clip e take”.'));
  const vis = visibleTakes(takes);
  if (!vis.length) return h('div', { class: 'empty big' }, 'Niente da fare con questo filtro: tutti i take sono classificati.');
  if (SC.view === 'gruppi') {
    return groupSections(vis).map((sec) => {
      const m = sec.groupId ? SC.info[sec.groupId] : null;
      return h('section', { class: 'scan-sec' },
        h('div', { class: 'scan-sec-head' },
          h('h3', {}, sec.groupId ? `Gruppo ${sec.groupId}` : 'Senza gruppo', ' ', h('span', { class: 'dim' }, `(${sec.takes.length})`)),
          m ? h('span', { class: 'dim', title: m.reason }, `Master suggerito: ${ctx.takeLabel(m.takeId)} — ${m.reason}`) : (sec.groupId ? null : h('span', { class: 'dim' }, 'Usa “Raggruppa per copertura” per proporre i gruppi.')),
          m ? h('button', { class: 'btn btn-small btn-primary', type: 'button', 'data-fk': `scan-m-${sec.groupId}`, onclick: () => setMaster(ctx, sec.groupId, m.takeId) }, `Imposta come master: ${ctx.takeLabel(m.takeId)}`) : null),
        h('div', { class: 'scan-grid' }, sec.takes.map((t) => card(ctx, t, m?.takeId === t.id))));
    });
  }
  return h('div', { class: 'scan-grid' }, vis.map((t) => card(ctx, t, false)));
}

function thumb(ctx, t, frame, fps) {
  const key = cacheKey(t.clipId, frame, SIZE);
  const img = h('img', { alt: `Fotogramma ${framesToTimecode(frame, fps)}`, width: '200', height: '113', loading: 'lazy' });
  const known = SC.urls.get(key);
  if (known) img.src = known;
  else getThumb(ctx.ce, { clipId: t.clipId, takeId: t.id, frame, fps }, { size: SIZE }).then((r) => { SC.urls.set(key, r.url); img.src = r.url; }).catch(() => {});
  return h('div', { class: 'scan-th' }, img, h('span', { class: 'mono scan-tc' }, framesToTimecode(frame, fps)));
}

function card(ctx, t, isMaster) {
  const clip = ctx.clipOf(t.id);
  const fps = clip?.fps || 25;
  const st = shotState(t, SC.hyps[t.id]);
  const focus = SC.focus === t.id;
  const cov = ctx.S.snap.view.coverage?.[t.id] || [];
  const meta = [t.meta?.scene && `Sc ${t.meta.scene}`, t.meta?.shot, t.meta?.take && `Tk ${t.meta.take}`, t.angle].filter(Boolean).join(' · ');
  const proposalText = st.state === 'proposta'
    ? `Proposta: ${shotLabel(st.shot)} (${st.source ? sourceLabel(st.source) : 'ipotesi dal gruppo'}) — Invio per confermare`
    : st.state === 'mancante' ? 'Nessuna informazione: scegli 1-5' : `${shotLabel(st.shot)} · ${sourceLabel(st.source)}`;
  return h('div', {
    class: `scan-card st-${st.state}${focus ? ' focus' : ''}`, tabindex: focus ? '0' : '-1', style: { '--c': ctx.takeColor(t.id) }, 'data-fk': `sc-${t.id}`,
    'aria-label': `${ctx.takeLabel(t.id)}: ${st.shot ? shotLabel(st.shot) : 'non classificato'}${st.state === 'proposta' ? ', proposta da confermare' : ''}`,
    onclick: (e) => { if (!e.target.closest('button')) { SC.focus = t.id; ctx.rerender(['scan']); } },
    onfocus: () => { SC.focus = t.id; },
  },
  h('div', { class: 'scan-head' },
    h('i', { class: 'dotc' }), h('b', { title: t.name }, ctx.takeLabel(t.id)),
    isMaster ? h('span', { class: 'chip ok' }, 'master suggerito') : null,
    h('span', { class: `chip shot-chip st-${st.state}` }, st.shot ? shotAbbr(st.shot) + (st.source == null ? '?' : '') : 'da classificare')),
  h('div', { class: 'scan-sheet' }, sheetFrames(clip?.durationFrames || 1).map((f) => thumb(ctx, t, f, fps))),
  h('div', { class: 'scan-meta dim' }, h('span', { title: t.name }, t.name || t.clipId), meta ? ` · ${meta}` : '', cov.length ? ` · ${cov.length} righe` : ' · nessuna riga coperta'),
  h('div', { class: 'scan-tags', role: 'group', 'aria-label': 'Tipo di inquadratura' },
    SHOT_OPTIONS.map((o) => h('button', {
      class: `btn btn-small shot-btn${st.shot === o.shot ? ' on' : ''}${st.shot === o.shot && st.state === 'proposta' ? ' prop' : ''}`, type: 'button', tabindex: '-1', 'aria-pressed': String(st.shot === o.shot && st.state === 'confermato'), title: `Tasto ${o.key}`,
      'data-fk': `sc-${t.id}-${o.shot}`,
      onclick: () => applyAction(ctx, t, { type: 'set', shot: o.shot, source: 'manuale' }),
    }, h('kbd', {}, o.key), ' ', o.label))),
  h('div', { class: `scan-state st-${st.state}` }, proposalText,
    st.state === 'proposta' ? h('button', { class: 'btn btn-small btn-primary', type: 'button', tabindex: '-1', 'data-fk': `sc-ok-${t.id}`, onclick: () => applyAction(ctx, t, actionForKey('Enter', t, SC.hyps[t.id])) }, 'Conferma') : null));
}
