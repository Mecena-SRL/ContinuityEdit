// Mini-montaggio nel pannello: corsie V1..Vn, righello con le righe dello script, trascinamento (V1 = riordino,
// V2+ = posizione libera con sovrascrittura), maniglie per accorciare/allungare, lama, aggancio, undo/redo,
// anteprima nel lettore e "Manda in timeline" (nuova o in coda). Tutte le modifiche passano dal main (undo).
import { h, renderInto } from '../dom.js';
import { ico } from '../icons.js';
import { framesToTimecode } from '../viewmodel/format.js';
import { LANE_H, fitZoom, zoomStep, xOf, frameOfX, rulerTicks, snapTargets, snapFrame, laneCount, hitItem, secs } from '../viewmodel/editor.js';
import { selectSeqItem } from './sequence.js';

const E = { ppf: 1, auto: true, sel: null, snap: true, drag: null, sendOpen: false, sig: '' };
const HEAD_W = 44;

export function renderEditor(el, ctx) {
  const { S } = ctx;
  if (E.drag) return; // durante un trascinamento il DOM resta quello del gesto
  if (!E.hooked) {
    E.hooked = true;
    document.addEventListener('click', (e) => { if (E.sendOpen && !e.target.closest('.ed-tools .menu-wrap')) { E.sendOpen = false; ctx.rerender(['editor']); } });
    window.addEventListener('resize', () => { if (E.auto) ctx.rerender(['editor']); });
  }
  const lay = S.snap.view.sequence || { items: [], total: 0, markers: [] };
  const fps = lay.timelineFps || S.env?.timelineFps || 25;
  const open = S.editorOpen;
  const items = lay.items || [];
  if (E.sel && !items.some((x) => x.id === E.sel)) E.sel = null;
  const total = lay.total || 0;
  ctx.editorPlayhead = (f) => { const ph = el.querySelector('.ed-ph'); if (ph) ph.style.transform = `translateX(${xOf(f, E.ppf)}px)`; const t = el.querySelector('.ed-time'); if (t) t.textContent = framesToTimecode(f, fps); };

  const scrollW = Math.max(200, (el.querySelector('.ed-scroll')?.clientWidth || el.clientWidth || 800) - 4);
  if (E.auto && total) E.ppf = fitZoom(total, scrollW);
  const lanes = laneCount(lay);
  const width = Math.max(scrollW, xOf(total, E.ppf) + 160);
  const ph = Math.min(S.edPlayhead || 0, Math.max(0, total));

  const bar = h('div', { class: 'ed-bar' },
    h('button', { class: 'ed-toggle', type: 'button', 'aria-expanded': String(open), 'data-fk': 'ed-toggle', onclick: () => ctx.toggleEditor(!open) },
      ico(open ? 'chevronDown' : 'chevronUp', 'ico ico-sm'), h('b', {}, 'Montaggio'),
      h('span', { class: 'dim' }, items.length ? ` ${items.length} ${items.length === 1 ? 'pezzo' : 'pezzi'} · ${secs(total, fps)}` : ' vuoto')),
    open && items.length ? h('div', { class: 'ed-tools' },
      h('span', { class: 'ed-time mono', title: 'Playhead del montaggio' }, framesToTimecode(ph, fps)),
      tbtn('play', 'Anteprima nel lettore (Spazio con il montaggio attivo)', () => ctx.player?.playSequence(S.edPlayhead || 0), !items.length, 'ed-play'),
      tbtn('scissors', 'Lama al playhead (B)', () => splitAtPlayhead(ctx), !items.length, 'ed-split'),
      tbtn('trash', 'Togli il pezzo selezionato (Canc)', () => removeSel(ctx), !E.sel, 'ed-del'),
      h('span', { class: 'pl-sep' }),
      tbtn('undo', 'Annulla (Ctrl/Cmd+Z)', () => ctx.run('Annulla', () => ctx.ce.undo()), false, 'ed-undo'),
      tbtn('redo', 'Ripeti (Maiusc+Ctrl/Cmd+Z)', () => ctx.run('Ripeti', () => ctx.ce.redo()), false, 'ed-redo'),
      h('span', { class: 'ed-zoom' },
        h('span', { class: 'pl-sep' }),
        tbtn('minus', 'Riduci', () => { E.auto = false; E.ppf = zoomStep(E.ppf, -1); ctx.rerender(['editor']); }, !items.length),
        h('button', { class: 'btn btn-small', type: 'button', title: 'Adatta alla finestra', disabled: !items.length, onclick: () => { E.auto = true; ctx.rerender(['editor']); } }, 'Adatta'),
        tbtn('plus', 'Ingrandisci', () => { E.auto = false; E.ppf = zoomStep(E.ppf, 1); ctx.rerender(['editor']); }, !items.length),
        h('label', { class: 'chk', title: 'Aggancia a righe, bordi dei pezzi e playhead' }, h('input', { type: 'checkbox', checked: E.snap, onchange: (e) => { E.snap = e.target.checked; } }), ' Aggancia')),
      h('span', { class: 'tb-spacer' }),
      S.mode === 'advanced' && items.length ? h('button', { class: 'btn btn-small btn-ghost', type: 'button', title: 'Svuota il montaggio (Ctrl+Z annulla)', onclick: async () => { if (await ctx.confirmDialog('Svuotare il montaggio?', { okLabel: 'Svuota', danger: true })) ctx.run('Svuota', () => ctx.ce.sequence.clear()); } }, 'Svuota') : null,
      sendMenu(ctx, !items.length)) : null);

  if (!open) { renderInto(el, () => bar); return; }

  const ticks = rulerTicks(total, E.ppf, fps, width);
  const lines = S.snap.view.lines;
  const lineText = (id) => { const l = lines.find((x) => x.id === id); return l ? `${l.character ? `${l.character}: ` : ''}${l.text}` : id; };
  const body = items.length ? h('div', { class: 'ed-body' },
    h('div', { class: 'ed-heads', style: { width: `${HEAD_W}px` } },
      h('div', { class: 'ed-rh' }),
      Array.from({ length: lanes }, (_, k) => lanes - k).map((t) => h('div', { class: `ed-head${t === 1 ? ' v1' : ''}`, style: { height: `${LANE_H}px` }, title: t === 1 ? 'V1: il master, continuo, con il suo audio (A1)' : `V${t}: cutaway, solo video` }, `V${t}`, t === 1 ? h('small', {}, '+A1') : null))),
    h('div', { class: 'ed-scroll', tabindex: '0', 'aria-label': 'Corsie del montaggio. B lama, Canc togli, Q/W accorcia al playhead, frecce sposta il playhead', onkeydown: (e) => onKey(e, ctx, lay) },
      h('div', { class: 'ed-canvas', style: { width: `${width}px` } },
        h('div', { class: 'ed-ruler', onpointerdown: (e) => rulerDown(e, ctx, lay) },
          ticks.map((t) => h('span', { class: 'tick', style: { left: `${t.x}px` } }, t.label)),
          (lay.markers || []).map((m) => h('i', { class: 'pin', style: { left: `${xOf(m.recordFrame, E.ppf)}px` }, title: lineText(m.lineId) }))),
        h('div', { class: 'ed-lanes', style: { height: `${lanes * LANE_H}px` } },
          Array.from({ length: lanes }, (_, k) => lanes - k).map((t) => h('div', { class: `ed-lane${t === 1 ? ' v1' : ''}`, style: { top: `${(lanes - t) * LANE_H}px`, height: `${LANE_H}px` } })),
          items.filter((x) => x.rec != null).map((x) => block(ctx, x, lanes, fps, lineText)),
          items.some((x) => x.rec == null) ? h('div', { class: 'ed-warn' }, ico('warn', 'ico ico-xs'), ` ${items.filter((x) => x.rec == null).length} cutaway su righe tolte dal master: non verranno montati`) : null),
        h('div', { class: 'ed-ph', style: { transform: `translateX(${xOf(ph, E.ppf)}px)` }, 'aria-hidden': 'true' }))))
    : h('div', { class: 'ed-empty' }, ico('timeline', 'ico ico-lg'),
      h('div', {}, h('b', {}, 'Il montaggio è vuoto.'), h('p', { class: 'dim' }, 'Crea il montaggio grezzo dalle righe sincronizzate, oppure nel lettore segna In/Out e premi “+ V1”.')),
      h('button', { class: 'btn btn-primary', type: 'button', disabled: !S.d.summary?.covered, onclick: () => ctx.roughCut() }, 'Crea il montaggio grezzo'));

  const scrollLeft = el.querySelector('.ed-scroll')?.scrollLeft || 0;
  renderInto(el, () => [bar, body]);
  const sc = el.querySelector('.ed-scroll'); if (sc) sc.scrollLeft = scrollLeft;
}

const tbtn = (icn, label, onclick, dis = false, fk) => h('button', { class: 'btn btn-icon btn-small', type: 'button', title: label, 'aria-label': label, disabled: dis, 'data-fk': fk, onclick }, ico(icn));

function sendMenu(ctx, dis) {
  const { S } = ctx;
  return h('div', { class: 'menu-wrap' },
    h('button', { class: 'btn btn-primary btn-small', type: 'button', disabled: dis || S.busy.has('Invio in timeline'), 'data-fk': 'ed-send', 'aria-haspopup': 'menu', 'aria-expanded': String(E.sendOpen),
      onclick: () => { E.sendOpen = !E.sendOpen; ctx.rerender(['editor']); } }, ico('send'), ' Manda in timeline'),
    E.sendOpen ? h('div', { class: 'menu menu-up', role: 'menu' },
      h('button', { class: 'menu-item', role: 'menuitem', type: 'button', 'data-fk': 'send-new', onclick: () => { E.sendOpen = false; ctx.sendTimeline('new'); } }, ico('plus'), h('span', {}, 'In una timeline nuova')),
      h('button', { class: 'menu-item', role: 'menuitem', type: 'button', disabled: !S.env?.timelineName, 'data-fk': 'send-append', onclick: () => { E.sendOpen = false; ctx.sendTimeline('append'); } }, ico('timeline'), h('span', {}, `In coda a “${S.env?.timelineName || 'timeline aperta'}”`))) : null);
}

function block(ctx, x, lanes, fps, lineText) {
  const { S } = ctx;
  const left = xOf(x.rec, E.ppf); const w = Math.max(4, xOf(x.len, E.ppf));
  const top = (lanes - x.track) * LANE_H + 3;
  const first = x.lineIds?.[0] ? lineText(x.lineIds[0]) : '';
  const sel = E.sel === x.id;
  return h('div', {
    class: `ed-blk${x.track === 1 ? ' master' : ' cut'}${sel ? ' on' : ''}${x.anchored ? ' anchored' : ''}`, 'data-id': x.id, role: 'button', tabindex: '-1',
    style: { left: `${left}px`, width: `${w}px`, top: `${top}px`, height: `${LANE_H - 6}px`, '--c': ctx.takeColor(x.takeId) },
    title: `${ctx.takeLabel(x.takeId)} · ${secs(x.len, fps)}${x.anchored ? ' · agganciato alle righe' : ''}${first ? `\n${first}` : ''}`,
    'aria-label': `${x.track === 1 ? 'V1' : `V${x.track}`} ${ctx.takeLabel(x.takeId)}, ${secs(x.len, fps)}`,
    onpointerdown: (e) => blockDown(e, ctx, x),
  },
  h('span', { class: 'ed-grip l', 'data-edge': 'start' }),
  h('span', { class: 'ed-lbl' }, h('b', {}, ctx.takeLabel(x.takeId)), w > 120 && first ? h('span', { class: 'dim' }, ` ${first}`) : null),
  x.anchored ? h('span', { class: 'ed-anch', title: 'Agganciato alle righe: segue il master' }, ico('link', 'ico ico-xs')) : null,
  h('span', { class: 'ed-grip r', 'data-edge': 'end' }));
}

// ---------- gesti
function setPlayhead(ctx, f, lay) {
  const total = lay.total || 0;
  ctx.S.edPlayhead = Math.max(0, Math.min(total, Math.round(f)));
  ctx.editorPlayhead?.(ctx.S.edPlayhead);
  ctx.player?.seekSequence(ctx.S.edPlayhead);
}
function rulerDown(e, ctx, lay) {
  const r = e.currentTarget.getBoundingClientRect();
  const at = (cx) => frameOfX(cx - r.left, E.ppf);
  setPlayhead(ctx, at(e.clientX), lay);
  const move = (ev) => setPlayhead(ctx, at(ev.clientX), lay);
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}

function blockDown(e, ctx, x) {
  if (e.button !== 0) return;
  e.preventDefault();
  const el = e.currentTarget;
  const edge = e.target.dataset?.edge || null;
  const lay = ctx.S.snap.view.sequence;
  const lanes = laneCount(lay);
  const startX = e.clientX; const startY = e.clientY;
  const targets = E.snap ? snapTargets(lay, lay.markers, ctx.S.edPlayhead, x.id) : [];
  E.sel = x.id; selectSeqItem(x.id);
  el.closest('.ed-lanes')?.querySelectorAll('.ed-blk.on').forEach((b) => b.classList.remove('on'));
  el.classList.add('on');
  E.drag = { id: x.id, moved: false };
  let result = null;
  const move = (ev) => {
    const dx = ev.clientX - startX; const dy = ev.clientY - startY;
    if (!E.drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    E.drag.moved = true;
    const df = Math.round(dx / E.ppf);
    if (edge) {
      const raw = edge === 'start' ? x.rec + df : x.rec + x.len + df;
      const s = E.snap ? snapFrame(raw, targets, E.ppf) : { frame: raw };
      const delta = s.frame - (edge === 'start' ? x.rec : x.rec + x.len);
      const newLeft = edge === 'start' ? x.rec + delta : x.rec;
      const newLen = Math.max(1, edge === 'start' ? x.len - delta : x.len + delta);
      el.style.left = `${xOf(newLeft, E.ppf)}px`; el.style.width = `${Math.max(4, xOf(newLen, E.ppf))}px`;
      el.classList.toggle('snapped', !!s.snapped);
      result = { kind: 'trim', edge, delta };
    } else {
      const s = E.snap ? snapFrame(Math.max(0, x.rec + df), targets, E.ppf) : { frame: Math.max(0, x.rec + df) };
      const tr = Math.max(1, Math.min(lanes, x.track - Math.round(dy / LANE_H)));
      el.style.transform = `translate(${xOf(s.frame - x.rec, E.ppf)}px, ${(x.track - tr) * LANE_H}px)`;
      el.classList.toggle('snapped', !!s.snapped);
      result = { kind: 'move', recordFrame: s.frame, track: tr };
    }
  };
  const up = async () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    const moved = E.drag.moved;
    E.drag = null;
    if (!moved || !result) { ctx.rerender(['editor', 'script']); return; }
    if (result.kind === 'trim' && result.delta) await ctx.run('Accorcia', () => ctx.ce.sequence.trimEdge(x.id, result.edge, result.delta));
    else if (result.kind === 'move' && (result.recordFrame !== x.rec || result.track !== x.track)) await ctx.run('Sposta', () => ctx.ce.sequence.move(x.id, { recordFrame: result.recordFrame, track: result.track }));
    ctx.rerender(['editor', 'script']);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}

async function splitAtPlayhead(ctx) {
  const lay = ctx.S.snap.view.sequence;
  const ph = ctx.S.edPlayhead || 0;
  const sel = lay.items.find((x) => x.id === E.sel && x.rec != null && ph > x.rec && ph < x.rec + x.len);
  const target = sel || hitItem(lay, ph, 1) || lay.items.filter((x) => x.rec != null && ph > x.rec && ph < x.rec + x.len).sort((a, b) => b.track - a.track)[0];
  if (!target || ph <= target.rec) { ctx.toast('Metti il playhead dentro un pezzo (clic sul righello).', 'info'); return; }
  const r = await ctx.run('Lama', () => ctx.ce.sequence.split(target.id, ph));
  if (r) E.sel = r.rightId;
}
async function removeSel(ctx) {
  if (!E.sel) return;
  const id = E.sel; E.sel = null;
  await ctx.run('Togli', () => ctx.ce.sequence.removeItem(id));
}
async function trimToPlayhead(ctx, edge) {
  const lay = ctx.S.snap.view.sequence;
  const x = lay.items.find((i) => i.id === E.sel);
  if (!x || x.rec == null) { ctx.toast('Seleziona un pezzo.', 'info'); return; }
  const ph = ctx.S.edPlayhead || 0;
  const delta = edge === 'start' ? ph - x.rec : ph - (x.rec + x.len);
  if (delta) await ctx.run('Accorcia', () => ctx.ce.sequence.trimEdge(x.id, edge, delta));
}

function onKey(e, ctx, lay) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (k === 'b') { stop(); splitAtPlayhead(ctx); } else if (k === 'Delete' || k === 'Backspace') { stop(); removeSel(ctx); } else if (k === 'q') { stop(); trimToPlayhead(ctx, 'start'); } else if (k === 'w') { stop(); trimToPlayhead(ctx, 'end'); } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
    stop(); setPlayhead(ctx, (ctx.S.edPlayhead || 0) + (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1), lay);
  } else if (k === ' ') {
    stop();
    const st = ctx.player?.state;
    if (st?.mode === 'seq' && st.playing) ctx.player.handleKey({ key: ' ', target: e.target }); else ctx.player?.playSequence(ctx.S.edPlayhead || 0);
  } else if (k === 'Escape') { E.sel = null; ctx.rerender(['editor']); }
}
