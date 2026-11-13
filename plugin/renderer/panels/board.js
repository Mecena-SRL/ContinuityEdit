// Lavagna: tela libera (pan/zoom, drag, resize, note colorate, collegamenti) + still da clip (marker + miniatura dal video).
import { h, renderInto } from '../dom.js';
import { zoomAt, fitView, clampSize, orderedStills, NOTE_COLORS, centerOf, screenToWorld } from '../viewmodel/board.js';
import { frameFromX, xFromFrame, quantizeFrame, autoScanFrames } from '../viewmodel/thumbs.js';
import { framesToTimecode } from '../viewmodel/format.js';
import { getThumb } from '../thumbs.js';

const B = { view: { x: 0, y: 0, k: 1 }, sel: null, link: false, linkFrom: null, take: null, n: 8, order: 'x', hold: 50, hoverFrame: null, fitted: false, dragging: false, urls: new Map(), prevFocus: null, msg: '' };
let overlay = null;

export function renderBoard(ctx) {
  const { S } = ctx;
  if (!S.boardOpen) { if (overlay) { overlay.remove(); overlay = null; B.prevFocus?.focus?.(); } return; }
  if (B.dragging) return;
  if (!overlay) {
    B.prevFocus = document.activeElement;
    overlay = h('div', { class: 'board-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Lavagna' });
    overlay.addEventListener('keydown', (e) => onKey(e, ctx));
    document.body.append(overlay);
    setTimeout(() => overlay.querySelector('[data-fk=board-close]')?.focus(), 0);
  }
  const board = S.snap.project?.board || { items: [], links: [] };
  if (!B.take || !S.snap.view.takes.some((t) => t.id === B.take)) B.take = S.activeTakeId || S.snap.view.takes[0]?.id || null;
  renderInto(overlay, () => build(ctx, board));
  if (!B.fitted) { B.fitted = true; requestAnimationFrame(() => fit(ctx, board)); }
}

function close(ctx) { ctx.S.boardOpen = false; renderBoard(ctx); }
function fit(ctx, board) {
  const cv = overlay?.querySelector('.board-canvas'); if (!cv) return;
  B.view = fitView(board.items, cv.clientWidth, cv.clientHeight); applyView();
}
function applyView() {
  const w = overlay?.querySelector('.board-world'); if (w) w.style.transform = `translate(${B.view.x}px, ${B.view.y}px) scale(${B.view.k})`;
  const z = overlay?.querySelector('.zoom-val'); if (z) z.textContent = `${Math.round(B.view.k * 100)}%`;
}
const itemById = (board, id) => board.items.find((i) => i.id === id);

function onKey(e, ctx) {
  const { S } = ctx;
  const board = S.snap.project?.board || { items: [], links: [] };
  if (e.key === 'Escape') { e.preventDefault(); if (B.link) { B.link = false; B.linkFrom = null; renderBoard(ctx); } else close(ctx); return; }
  if (e.target.closest('input, textarea, select')) return;
  if (e.target.closest('.scrub')) return; // gestiti dalla barra
  const it = B.sel ? itemById(board, B.sel) : null;
  if ((e.key === 'Delete' || e.key === 'Backspace') && it) { e.preventDefault(); ctx.run('Rimozione', () => ctx.ce.board.removeItem(it.id)); B.sel = null; }
  else if (it && e.key.startsWith('Arrow')) {
    e.preventDefault(); const d = e.shiftKey ? 50 : 10;
    const dx = { ArrowLeft: -d, ArrowRight: d }[e.key] || 0; const dy = { ArrowUp: -d, ArrowDown: d }[e.key] || 0;
    ctx.ce.board.moveItem(it.id, { x: it.x + dx, y: it.y + dy });
  } else if (e.key === '+' || e.key === '=') zoomBy(1.2); else if (e.key === '-') zoomBy(1 / 1.2);
  else if (e.key === '0') fit(ctx, board);
}
function zoomBy(f) { const cv = overlay.querySelector('.board-canvas'); B.view = zoomAt(B.view, f, cv.clientWidth / 2, cv.clientHeight / 2); applyView(); }

function build(ctx, board) {
  const { S, ce, run, toast } = ctx;
  const sel = B.sel ? itemById(board, B.sel) : null;
  const stills = board.items.filter((i) => i.type === 'still');

  const addNote = (color) => {
    const cv = overlay.querySelector('.board-canvas'); const c = screenToWorld(B.view, cv.clientWidth / 2, cv.clientHeight / 2);
    run('Nota', () => ce.board.addItem({ type: 'note', x: Math.round(c.x - 100), y: Math.round(c.y - 45), w: 200, h: 90, caption: 'Nuova nota', color }));
  };
  const exportPng = async () => {
    try {
      const url = await renderPng(board);
      const r = await run('Esporta PNG', () => ce.saveFile({ suggestedName: 'lavagna.png', dataBase64: url.split(',')[1], filters: [{ name: 'PNG', extensions: ['png'] }] }));
      if (r) toast(`Lavagna esportata: ${r.path}`, 'ok'); else if (r === null) toast('Esportazione annullata.', 'info');
    } catch (e) { toast(`Esportazione non riuscita: ${e.message}`, 'error'); }
  };
  const toSeq = async () => {
    const r = await run('Lavagna → Sequenza', () => ce.board.toSequence({ order: B.order, holdFrames: Math.max(1, parseInt(B.hold, 10) || 50) }));
    if (r?.ok !== false && r) { toast(`${r.added ?? stills.length} still aggiunti alla sequenza.`, 'ok'); S.tab = 'sequence'; close(ctx); ctx.rerender(['dock']); }
    else if (r) toast(`Sequenza: ${r.reason || 'non riuscito'}`, 'warn');
  };

  return [
    h('div', { class: 'board-bar' },
      h('button', { class: 'btn', type: 'button', 'data-fk': 'board-close', onclick: () => close(ctx) }, '← Torna allo script'),
      h('strong', {}, 'Lavagna'),
      h('span', { class: 'tb-spacer' }),
      h('span', { class: 'dim' }, 'Nota:'),
      NOTE_COLORS.map((c) => h('button', { class: 'swatch', type: 'button', style: { background: c }, 'aria-label': `Aggiungi nota colore ${c}`, title: 'Aggiungi nota', 'data-fk': `note-${c}`, onclick: () => addNote(c) })),
      h('button', { class: `btn btn-small${B.link ? ' btn-on' : ''}`, type: 'button', 'aria-pressed': String(B.link), 'data-fk': 'board-link', onclick: () => { B.link = !B.link; B.linkFrom = null; renderBoard(ctx); } }, B.link ? (B.linkFrom ? 'Scegli il secondo elemento…' : 'Scegli il primo elemento…') : 'Collega'),
      h('button', { class: 'btn btn-small', type: 'button', 'aria-label': 'Riduci zoom', onclick: () => zoomBy(1 / 1.2) }, '−'),
      h('span', { class: 'zoom-val mono' }, `${Math.round(B.view.k * 100)}%`),
      h('button', { class: 'btn btn-small', type: 'button', 'aria-label': 'Aumenta zoom', onclick: () => zoomBy(1.2) }, '+'),
      h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'board-fit', onclick: () => fit(ctx, board) }, 'Adatta'),
      h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'board-png', onclick: exportPng }, 'Esporta PNG')),
    h('div', { class: 'board-main' },
      canvas(ctx, board),
      h('aside', { class: 'board-side', 'aria-label': 'Still e proprietà' },
        capturePanel(ctx, board),
        sel ? inspector(ctx, sel) : h('p', { class: 'dim' }, 'Seleziona un elemento per modificarlo. Trascina lo sfondo per spostare la vista, Ctrl+rotella per lo zoom, frecce per spostare l’elemento.'),
        h('div', { class: 'sub' }, h('h4', {}, 'Lavagna → Sequenza'),
          h('div', { class: 'btn-row' },
            h('select', { class: 'select', 'aria-label': 'Ordine', 'data-fk': 'b-order', onchange: (e) => { B.order = e.target.value; } },
              [['x', 'da sinistra a destra'], ['y', 'dall’alto al basso'], ['z', 'per livello']].map(([v, l]) => h('option', { value: v, selected: B.order === v }, l))),
            h('input', { class: 'input frame-in sm', type: 'number', min: '1', value: B.hold, 'aria-label': 'Durata di ogni still in frame', 'data-fk': 'b-hold', oninput: (e) => { B.hold = e.target.value; } }),
            h('button', { class: 'btn btn-small', type: 'button', disabled: !stills.length, 'data-fk': 'b-seq', onclick: toSeq }, `Crea sequenza (${stills.length})`)))))];
}

// ---------- tela ----------
function canvas(ctx, board) {
  const { S } = ctx;
  const cv = h('div', { class: 'board-canvas', tabindex: '0', 'aria-label': 'Tela della lavagna' });
  const world = h('div', { class: 'board-world', style: { transform: `translate(${B.view.x}px, ${B.view.y}px) scale(${B.view.k})` } });
  const byId = new Map(board.items.map((i) => [i.id, i]));
  world.append(h('svg', { class: 'board-links', width: '1', height: '1', style: { overflow: 'visible' }, 'aria-hidden': 'true' },
    ...(board.links || []).map((l) => { const a = byId.get(l.from); const b = byId.get(l.to); if (!a || !b) return null; const p = centerOf(a); const q = centerOf(b); return svgLine(p, q); })));
  [...board.items].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)).forEach((it) => world.append(itemEl(ctx, it)));
  cv.append(world);
  if (!board.items.length) cv.append(h('p', { class: 'board-empty' }, 'Lavagna vuota. Aggiungi una nota o cattura still dalla barra a destra.'));
  cv.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.bi')) return;
    B.sel = null; cv.focus();
    B.dragging = true; const start = { x: e.clientX, y: e.clientY, vx: B.view.x, vy: B.view.y };
    const mv = (ev) => { B.view = { ...B.view, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y }; applyView(); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); B.dragging = false; renderBoard(ctx); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault(); const r = cv.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) B.view = zoomAt(B.view, e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    else B.view = { ...B.view, x: B.view.x - e.deltaX, y: B.view.y - e.deltaY };
    applyView();
  }, { passive: false });
  return cv;
}
const svgLine = (p, q) => { const ns = 'http://www.w3.org/2000/svg'; const l = document.createElementNS(ns, 'line'); l.setAttribute('x1', p.x); l.setAttribute('y1', p.y); l.setAttribute('x2', q.x); l.setAttribute('y2', q.y); l.setAttribute('class', 'board-link'); return l; };

function itemEl(ctx, it) {
  const { S } = ctx;
  const isStill = it.type === 'still';
  const label = isStill ? `${ctx.takeLabel(it.takeId)} · ${framesToTimecode(it.frame ?? 0, ctx.fpsOf(it.takeId))}` : '';
  const el = h('div', {
    class: `bi ${isStill ? 'still' : 'note'}${B.sel === it.id ? ' on' : ''}${B.linkFrom === it.id ? ' linkfrom' : ''}`, tabindex: '0', 'data-fk': `bi-${it.id}`, 'data-item': it.id,
    role: 'group', 'aria-label': `${isStill ? 'Still' : 'Nota'}: ${it.caption || label}`,
    style: { left: `${it.x}px`, top: `${it.y}px`, width: `${it.w}px`, height: `${it.h}px`, 'z-index': String(it.z ?? 1), '--c': it.color || ctx.takeColor(it.takeId || '') },
    onfocus: () => { if (B.sel !== it.id) { B.sel = it.id; ctx.rerender(['board']); } },
  });
  if (isStill) {
    const img = h('img', { alt: '', draggable: 'false', class: 'bi-img' });
    const key = `${it.takeId}|${it.frame}`;
    const known = B.urls.get(key);
    if (known) img.src = known.url;
    else thumbFor(ctx, it, 320).then((r) => { if (r) { B.urls.set(key, r); img.src = r.url; if (r.placeholder) el.classList.add('ph'); } }).catch(() => {});
    if (known?.placeholder) el.classList.add('ph');
    el.append(img, h('span', { class: 'bi-tc' }, label));
  } else el.append(h('div', { class: 'bi-text' }, it.caption || ''));
  if (isStill && it.caption) el.append(h('div', { class: 'bi-cap' }, it.caption));
  const grip = h('span', { class: 'bi-grip', 'aria-hidden': 'true' });
  el.append(grip);
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (B.link) {
      e.preventDefault();
      if (!B.linkFrom) { B.linkFrom = it.id; renderBoard(ctx); } else if (B.linkFrom !== it.id) { const f = B.linkFrom; B.link = false; B.linkFrom = null; ctx.run('Collegamento', () => ctx.ce.board.link(f, it.id)); }
      return;
    }
    B.sel = it.id; B.dragging = true;
    const resize = e.target === grip;
    const start = { x: e.clientX, y: e.clientY, ox: it.x, oy: it.y, ow: it.w, oh: it.h };
    let cur = { x: it.x, y: it.y, w: it.w, h: it.h };
    const mv = (ev) => {
      const dx = (ev.clientX - start.x) / B.view.k; const dy = (ev.clientY - start.y) / B.view.k;
      if (resize) { const s = clampSize(start.ow + dx, start.oh + dy); cur = { ...cur, ...s }; el.style.width = `${s.w}px`; el.style.height = `${s.h}px`; }
      else { cur = { ...cur, x: Math.round(start.ox + dx), y: Math.round(start.oy + dy) }; el.style.left = `${cur.x}px`; el.style.top = `${cur.y}px`; }
    };
    const up = async () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      B.dragging = false;
      if (resize && (cur.w !== it.w || cur.h !== it.h)) await ctx.run('Ridimensiona', () => ctx.ce.board.resizeItem(it.id, { w: cur.w, h: cur.h }));
      else if (!resize && (cur.x !== it.x || cur.y !== it.y)) await ctx.run('Sposta', () => ctx.ce.board.moveItem(it.id, { x: cur.x, y: cur.y }));
      else renderBoard(ctx);
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  return el;
}

function thumbFor(ctx, it, size, scrub = false) {
  const clipId = ctx.take(it.takeId)?.clipId;
  return getThumb(ctx.ce, { clipId: clipId || it.takeId, takeId: it.takeId, frame: it.frame ?? 0, fps: ctx.fpsOf(it.takeId) }, { size, scrub });
}

// ---------- pannello laterale ----------
function inspector(ctx, it) {
  const { ce, run, toast, S } = ctx;
  const isStill = it.type === 'still';
  const lineTxt = it.lineId ? (S.d.byId.get(it.lineId)?.text || it.lineId).slice(0, 36) : null;
  return h('div', { class: 'sub inspector' },
    h('h4', {}, isStill ? 'Still' : 'Nota'),
    h('label', { class: 'fld-col' }, h('span', {}, 'Didascalia'),
      h('textarea', { class: 'input', rows: '3', value: it.caption || '', 'data-fk': 'b-cap', onchange: (e) => run('Didascalia', () => ce.board.setCaption(it.id, e.target.value)) })),
    !isStill ? h('div', { class: 'btn-row' }, NOTE_COLORS.map((c) => h('button', { class: `swatch${it.color === c ? ' on' : ''}`, type: 'button', style: { background: c }, 'aria-label': `Colore ${c}`, 'data-fk': `nc-${c}`, onclick: () => run('Colore', () => ce.board.addItem({ id: it.id, color: c })) }))) : null,
    isStill ? h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-small', type: 'button', disabled: !S.focusId, 'data-fk': 'b-assign', title: 'Collega lo still alla riga selezionata nello script', onclick: () => run('Assegna', () => ce.board.addItem({ id: it.id, lineId: S.focusId })) }, 'Assegna alla riga selezionata'),
      B.urls.get(`${it.takeId}|${it.frame}`)?.placeholder ? h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'b-resolve', onclick: async () => { const r = await run('Anteprima via Resolve', () => ce.board.refreshStillViaResolve(it.id)); if (r) toast(r.ok === false ? `Resolve: ${r.reason || 'non riuscito'}` : 'Anteprima aggiornata da Resolve.', r.ok === false ? 'warn' : 'ok'); } }, 'Anteprima via Resolve') : null) : null,
    lineTxt ? h('p', { class: 'dim' }, `Riga: “${lineTxt}…”`) : null,
    h('button', { class: 'btn btn-small btn-ghost-danger', type: 'button', 'data-fk': 'b-del', onclick: () => { B.sel = null; run('Rimozione', () => ce.board.removeItem(it.id)); } }, 'Elimina'));
}

function capturePanel(ctx, board) {
  const { S, ce, run, toast } = ctx;
  const take = B.take; const clip = ctx.clipOf(take); const dur = clip?.durationFrames || 1; const fps = ctx.fpsOf(take);
  const existing = board.items.filter((i) => i.type === 'still' && i.takeId === take);
  let kb = 0; // posizione da tastiera
  const add = async (frame) => {
    const r = await run('Still', () => ce.board.addStill({ takeId: take, frame, lineId: S.focusId || undefined }));
    if (r && r.ok === false) toast(`Still: ${r.reason || 'non riuscito'}`, 'warn');
    return r;
  };
  const prev = h('div', { class: 'scrub-prev', hidden: true }, h('img', { alt: '' }), h('span', { class: 'mono' }));
  let timer = null;
  const showPrev = (bar, x, f) => {
    prev.hidden = false; prev.style.left = `${Math.max(0, Math.min(bar.clientWidth - 160, x - 80))}px`;
    prev.querySelector('span').textContent = framesToTimecode(f, fps);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = quantizeFrame(f, Math.max(1, Math.round(dur / 80)));
      getThumb(ce, { clipId: clip ? ctx.take(take).clipId : take, takeId: take, frame: q, fps }, { size: 160, scrub: true }).then((r) => { prev.querySelector('img').src = r.url; }).catch(() => {});
    }, 40);
  };
  const bar = h('div', {
    class: 'scrub', tabindex: '0', role: 'slider', 'aria-label': 'Barra della clip: clic per aggiungere uno still, S da tastiera', 'aria-valuemin': '0', 'aria-valuemax': String(dur - 1), 'aria-valuenow': '0', 'data-fk': 'scrub',
    onpointermove: (e) => { const r = e.currentTarget.getBoundingClientRect(); const f = frameFromX(e.clientX - r.left, r.width, dur); B.hoverFrame = f; showPrev(e.currentTarget, e.clientX - r.left, f); },
    onpointerleave: () => { prev.hidden = true; },
    onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); add(frameFromX(e.clientX - r.left, r.width, dur)); },
    onkeydown: (e) => {
      const el = e.currentTarget;
      const step = e.shiftKey ? 25 : 1;
      if (e.key === 'ArrowRight') kb = Math.min(dur - 1, kb + step); else if (e.key === 'ArrowLeft') kb = Math.max(0, kb - step);
      else if (e.key.toLowerCase() === 's' || e.key === 'Enter') { e.preventDefault(); add(B.hoverFrame ?? kb); return; } else return;
      e.preventDefault(); B.hoverFrame = kb; el.setAttribute('aria-valuenow', String(kb));
      showPrev(el, xFromFrame(kb, el.clientWidth, dur), kb);
    },
  }, existing.map((i) => h('i', { class: 'tick', style: { left: `${(xFromFrame(i.frame ?? 0, 100, dur))}%` } })), prev);
  return h('div', { class: 'sub capture' },
    h('h4', {}, 'Cattura still da clip'),
    h('label', { class: 'fld-col' }, h('span', {}, 'Clip / take'),
      h('select', { class: 'select', 'data-fk': 'b-take', onchange: (e) => { B.take = e.target.value; renderBoard(ctx); } }, S.snap.view.takes.map((t) => h('option', { value: t.id, selected: t.id === take }, ctx.takeLabel(t.id))))),
    take ? bar : h('p', { class: 'dim' }, 'Nessun take.'),
    h('p', { class: 'hint' }, 'Scorri sulla barra per vedere la miniatura; clic (o S) aggiunge uno still: viene scritto un marker sulla clip in Resolve, nessun file.'),
    h('div', { class: 'btn-row' },
      h('input', { class: 'input frame-in sm', type: 'number', min: '1', max: '60', value: B.n, 'aria-label': 'Numero di still', 'data-fk': 'b-n', oninput: (e) => { B.n = e.target.value; } }),
      h('button', { class: 'btn btn-small', type: 'button', disabled: !take, 'data-fk': 'b-auto', onclick: async () => { for (const f of autoScanFrames(parseInt(B.n, 10) || 8, dur)) await add(f); } }, 'Scansione automatica')));
}

// ---------- esportazione PNG ----------
async function renderPng(board) {
  const items = board.items; if (!items.length) throw new Error('la lavagna è vuota');
  const x0 = Math.min(...items.map((i) => i.x)) - 30; const y0 = Math.min(...items.map((i) => i.y)) - 30;
  const x1 = Math.max(...items.map((i) => i.x + i.w)) + 30; const y1 = Math.max(...items.map((i) => i.y + i.h)) + 30;
  const sc = Math.min(2, 4096 / Math.max(x1 - x0, y1 - y0));
  const c = document.createElement('canvas'); c.width = Math.round((x1 - x0) * sc); c.height = Math.round((y1 - y0) * sc);
  const g = c.getContext('2d'); g.scale(sc, sc); g.translate(-x0, -y0);
  g.fillStyle = '#1b1c1f'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  const byId = new Map(items.map((i) => [i.id, i]));
  g.strokeStyle = '#8b909a'; g.lineWidth = 2;
  for (const l of board.links || []) { const a = byId.get(l.from); const b = byId.get(l.to); if (!a || !b) continue; const p = centerOf(a); const q = centerOf(b); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); }
  for (const it of [...items].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))) {
    if (it.type === 'note') {
      g.fillStyle = it.color || '#f2d14a'; g.fillRect(it.x, it.y, it.w, it.h); g.fillStyle = '#111'; g.font = '14px sans-serif';
      wrap(g, it.caption || '', it.x + 8, it.y + 20, it.w - 16, 18);
    } else {
      const u = B.urls.get(`${it.takeId}|${it.frame}`)?.url;
      g.fillStyle = '#2a2d32'; g.fillRect(it.x, it.y, it.w, it.h);
      if (u) { const im = await loadImg(u); g.drawImage(im, it.x, it.y, it.w, it.h); }
      if (it.caption) { g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(it.x, it.y + it.h - 22, it.w, 22); g.fillStyle = '#fff'; g.font = '12px sans-serif'; g.fillText(it.caption.slice(0, 40), it.x + 6, it.y + it.h - 7); }
    }
  }
  return c.toDataURL('image/png');
}
const loadImg = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('immagine non leggibile')); i.src = u; });
function wrap(g, text, x, y, w, lh) { let line = ''; for (const word of text.split(/\s+/)) { const t = line ? `${line} ${word}` : word; if (g.measureText(t).width > w && line) { g.fillText(line, x, y); line = word; y += lh; } else line = t; } g.fillText(line, x, y); }
