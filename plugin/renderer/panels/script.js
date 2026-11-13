// Vista sceneggiatura stile ScriptSync: righe selezionabili + linee verticali di copertura per take.
import { h, renderInto } from '../dom.js';
import { sceneList, highlightParts, lineTypeLabel } from '../viewmodel/script.js';
import { sourceKind, sourceLabel } from '../viewmodel/coverage.js';
import { LOW_CONFIDENCE } from '../viewmodel/summary.js';
import { TYPE_OPTIONS, typeFromKey, buildEdit } from '../viewmodel/scriptedit.js';
import { RATINGS, gradePalette } from '../viewmodel/marks.js';
import { trackLabel } from '../viewmodel/sequence.js';
import { shotAbbr } from '../viewmodel/shots.js';
import { placeCamera, setMasterFor, moveHandle, nudgeCutaway, selectedCutaway, selectSeqItem } from './sequence.js';

const COL_W = 20;

export function renderScript(el, ctx) {
  const { S } = ctx;
  const { view, project } = S.snap;
  const { visible, layout, unc } = S.d;
  const scenes = sceneList(view.lines);

  // la toolbar e' fuori dalla lista scorrevole: due contenitori fissi
  let bar = el.querySelector('.script-bar');
  let list = el.querySelector('.script-list');
  if (!bar) {
    bar = h('div', { class: 'script-bar' });
    list = h('div', { class: 'script-list', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Sceneggiatura' });
    el.replaceChildren(bar, list);
    list.addEventListener('keydown', (e) => onKey(e, ctx));
  }
  const takesShown = S.d.takes;
  list.style.setProperty('--ncols', String(S.showLines ? Math.max(1, takesShown.length) : 0));
  list.classList.toggle('no-lines', !S.showLines);
  list.style.setProperty('--colw', `${COL_W}px`);

  renderInto(bar, () => [
    h('div', { class: 'bar-row' },
      h('label', { class: 'fld' }, h('span', { class: 'sr-only' }, 'Filtra per scena'),
        h('select', {
          class: 'select', 'data-fk': 'scene-filter', onchange: (e) => ctx.setFilter({ sceneId: e.target.value || null }),
        }, h('option', { value: '' }, `Tutte le scene (${scenes.length})`),
        scenes.map((s) => h('option', { value: s.id, selected: S.sceneId === s.id }, s.heading.length > 34 ? `${s.heading.slice(0, 33)}…` : s.heading)))),
      h('div', { class: 'search' },
        h('input', {
          id: 'search-input', class: 'input', type: 'search', placeholder: 'Cerca nello script…', value: S.query, 'aria-label': 'Cerca nello script', 'data-fk': 'search',
          oninput: (e) => ctx.setFilter({ query: e.target.value, matchIndex: 0 }),
          onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); ctx.jumpToMatch(e.shiftKey ? -1 : 1); } },
        }),
        S.query ? h('span', { class: 'dim count', 'aria-live': 'polite' }, `${S.d.matches.length} trovate`) : null),
      h('label', { class: 'chk' },
        h('input', { type: 'checkbox', checked: S.onlyUncovered, 'data-fk': 'only-unc', onchange: (e) => ctx.setFilter({ onlyUncovered: e.target.checked }) }),
        ' Solo non coperte')),
    h('div', { class: 'bar-row bar-filters' },
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: S.showLines, 'data-fk': 'show-lines', onchange: (e) => ctx.setFilter({ showLines: e.target.checked }) }), h('span', { class: 'sw-track', 'aria-hidden': 'true' }), ' Mostra linee clip'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Filtro valutazione' }, RATINGS.map(([k, label]) => h('button', {
        class: `seg-btn${S.ratingFilter === k ? ' on' : ''}`, type: 'button', 'aria-pressed': String(S.ratingFilter === k), 'data-fk': `rf-${k}`, onclick: () => ctx.setFilter({ ratingFilter: k }),
      }, label))),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Filtro voto' }, gradePalette(project).map((g) => h('button', {
        class: `seg-btn${S.gradeFilter.includes(g) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(S.gradeFilter.includes(g)), 'data-fk': `gf-${g}`,
        onclick: () => ctx.setFilter({ gradeFilter: S.gradeFilter.includes(g) ? S.gradeFilter.filter((x) => x !== g) : [...S.gradeFilter, g] }),
      }, g)))),
    h('div', { class: 'bar-row bar-sub' },
      h('span', { class: 'dim' }, S.sel.length ? `${S.sel.length} ${S.sel.length === 1 ? 'riga selezionata' : 'righe selezionate'}` : 'Clic = seleziona · Maiusc = intervallo · 1-9 = scegli take · seleziona testo + tasto destro = segna come'),
      h('span', { class: 'tb-spacer' }),
      h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'sel-all', onclick: () => ctx.selectIds(visible.filter((l) => l.syncable).map((l) => l.id)) }, 'Seleziona visibili'),
      h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'sel-none', disabled: !S.sel.length, onclick: () => ctx.selectIds([]) }, 'Deseleziona')),
  ]);

  renderInto(list, () => {
    if (!view.lines.length) return h('div', { class: 'empty big' }, h('p', {}, 'Nessuna sceneggiatura caricata.'), h('p', { class: 'dim' }, 'Usa “Importa sceneggiatura” per caricare un file .fdx o .pdf.'));
    if (!visible.length) return h('div', { class: 'empty big' }, 'Nessuna riga corrisponde ai filtri.');
    const focusId = S.focusId && visible.some((l) => l.id === S.focusId) ? S.focusId : null;
    const nodes = [];
    if (S.showLines) {
      const plan = S.d.plan;
      nodes.push(h('div', { class: 'gutter-head', role: 'presentation' },
        h('span', { class: 'gh-title' }, takesShown.length ? 'Copertura →' : 'Nessun take visibile'),
        h('div', { class: 'gh-wrap' },
          plan.groups.length ? h('div', { class: 'gh-groups' }, plan.cols.map((c) => {
            const g = plan.groups.find((x) => x.groupId === c.groupId);
            return h('span', { class: `gh-grp${g ? ' in' : ''}${g && g.from === c.col ? ' first' : ''}${g && g.from + g.count - 1 === c.col ? ' last' : ''}`, title: g ? `Multicam ${g.groupId}` : '' }, g && g.from === c.col ? 'MC' : '');
          })) : null,
          h('div', { class: 'gh-cols' }, plan.cols.map((c) => h('button', {
            class: `gh-col${S.activeTakeId === c.takeId ? ' on' : ''}${c.groupId ? ' mc' : ''}`, type: 'button', style: { '--c': ctx.takeColor(c.takeId) }, tabindex: '-1',
            title: `${ctx.takeLabel(c.takeId)}${c.angle ? ` · ${c.angle}` : ''}${S.activeTakeId === c.takeId ? ' (attivo)' : ''}`, 'aria-label': `Attiva ${ctx.takeLabel(c.takeId)}${c.angle ? ` ${c.angle}` : ''}`,
            onclick: () => ctx.setActiveTake(c.takeId),
          }, h('span', { class: 'gh-dot' }), h('span', { class: 'gh-num' }, c.angle ? c.angle.replace(/^CAM\s*/i, '') : c.col + 1), (S.d.allTakes.find((t) => t.id === c.takeId)?.shot) ? h('span', { class: 'gh-shot' }, shotAbbr(S.d.allTakes.find((t) => t.id === c.takeId).shot)) : null))))));
    }
    visible.forEach((l, vi) => nodes.push(row(ctx, l, vi, { layout, unc, focusId, project, view })));
    return nodes;
  });
}

function row(ctx, l, vi, { layout, unc, focusId, project, view }) {
  const { S } = ctx;
  const selected = S.sel.includes(l.id);
  const uncovered = unc.has(l.id);
  const lowConf = typeof l.confidence === 'number' && l.confidence < LOW_CONFIDENCE;
  const cells = layout.rows[l.id] || [];
  const chosenId = project?.selection?.[l.id];
  const bestId = view.bestTake?.[l.id];
  const curMatch = S.query && S.d.matches[S.matchIndex] === l.id;
  const note = project?.notes?.[l.id];
  const textParts = (t) => highlightParts(t, S.query).map((p) => (p.hit ? h('mark', { class: curMatch ? 'cur' : '' }, p.text) : p.text));

  let body;
  if (l.type === 'scene') body = h('h3', { class: 'scene-title' }, textParts(l.text));
  else if (l.type === 'dialogue') body = h('div', { class: 'dia' }, h('div', { class: 'char' }, textParts(l.character || '')), h('p', { class: 'dlg-text' }, textParts(l.text)));
  else body = h('p', { class: `txt t-${l.type}` }, textParts(l.text));

  const tags = [];
  if (chosenId) tags.push(h('span', { class: 'tag chosen', style: { '--c': ctx.takeColor(chosenId) } }, '✓ ', ctx.takeLabel(chosenId)));
  else if (bestId && l.syncable) tags.push(h('span', { class: 'tag best', style: { '--c': ctx.takeColor(bestId) } }, '★ migliore: ', ctx.takeLabel(bestId)));
  if (uncovered) tags.push(h('span', { class: 'tag unc' }, 'Non coperta'));
  if (l.syncable && l.type === 'action') tags.push(h('span', { class: 'tag kind' }, 'Azione'));
  if (lowConf) tags.push(h('span', { class: 'tag low', title: `Confidenza del parser ${Math.round(l.confidence * 100)}%` }, `? ${Math.round(l.confidence * 100)}%`));
  if (note) tags.push(h('span', { class: 'tag note', title: note }, '✎ nota'));

  return h('div', {
    class: `line-row t-${l.type}${selected ? ' sel' : ''}${l.id === S.focusId ? ' focus' : ''}${uncovered ? ' uncovered' : ''}${lowConf ? ' lowconf' : ''}${l.syncable ? '' : ' nosync'}`,
    role: 'option', 'aria-selected': String(selected), 'data-line': l.id, 'data-fk': `row-${l.id}`,
    tabindex: (focusId ? l.id === focusId : vi === 0) ? '0' : '-1',
    'aria-label': `${lineTypeLabel(l.type)}${l.character ? ` ${l.character}` : ''}: ${l.text}${uncovered ? '. Non coperta' : ''}`,
    onclick: (e) => { if (textSelectionIn(e.currentTarget)) return; ctx.selectLine(l.id, e.shiftKey ? 'range' : (e.ctrlKey || e.metaKey) ? 'toggle' : 'replace'); },
    oncontextmenu: (e) => onContext(e, ctx, l),
    ondblclick: () => { const t = chosenId || bestId || S.activeTakeId; if (t) ctx.preview(l.id, t); },
  },
  h('div', { class: 'line-body' }, body, tags.length ? h('div', { class: 'tags' }, tags) : null),
  S.showLines ? h('div', { class: 'gutter', style: { width: `calc(var(--ncols) * var(--colw))` } }, cells.map((c) => gcell(ctx, l, c))) : null);
}

function gcell(ctx, l, c) {
  const { S } = ctx;
  const label = ctx.takeLabel(c.takeId);
  const kind = c.covered ? sourceKind(c.source) : null;
  const active = S.activeTakeId === c.takeId;
  const cls = ['gcell'];
  if (c.covered) cls.push('cov', `pos-${c.pos}`, `k-${kind}`);
  if (c.estimated) cls.push('est');
  if (c.chosen) cls.push('chosen');
  if (c.best) cls.push('best');
  if (active) cls.push('active');
  const seq = S.d.seq;
  const cut = c.covered ? seq.cutMap.get(`${c.takeId}|${l.id}`) : null;
  if (c.covered && seq.master === c.takeId) cls.push('master');
  else if (cut) cls.push('cut');
  else if (c.covered && seq.any) cls.push('unused');
  const desc = c.covered
    ? `${label}: copre la riga (${sourceLabel(c.source)}${c.estimated ? ', stimata' : ''})${c.chosen ? ', scelto' : ''}${c.best ? ', migliore' : ''}`
    : `${label}: non copre la riga`;
  return h('button', {
    class: cls.join(' '), type: 'button', tabindex: '-1', style: { '--c': ctx.takeColor(c.takeId) }, title: desc, 'aria-label': desc,
    onclick: (e) => {
      e.stopPropagation();
      if (cut) selectSeqItem(cut.id);
      ctx.selectLine(l.id, 'replace');
      if (c.covered) ctx.chooseTake(l.id, c.takeId); else ctx.setActiveTake(c.takeId);
    },
  }, c.covered ? h('span', { class: 'bar' }, (c.pos === 'start' || c.pos === 'single') ? h('i', { class: `kind kind-${kind}` }) : null) : null,
  cut && l.id === cut.fromLineId ? h('span', { class: 'vlabel' }, trackLabel(cut.track || 2)) : null,
  cut && l.id === cut.fromLineId ? handle(ctx, cut, 'from', l.id) : null,
  cut && l.id === cut.toLineId ? handle(ctx, cut, 'to', l.id) : null,
  c.chosen ? h('span', { class: 'check', 'aria-hidden': 'true' }, '✓') : null);
}

/** Maniglia di inizio/fine di un cutaway: si trascina sulle righe (scatta alla riga sotto il puntatore). */
function handle(ctx, item, edge, lineId) {
  return h('span', {
    class: `hdl hdl-${edge}`, title: edge === 'from' ? 'Trascina: inizio del cutaway' : 'Trascina: fine del cutaway', role: 'presentation',
    onclick: (e) => e.stopPropagation(),
    onpointerdown: (e) => {
      e.preventDefault(); e.stopPropagation(); document.body.classList.add('dragging-h');
      const up = (ev) => {
        window.removeEventListener('pointerup', up); document.body.classList.remove('dragging-h');
        const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-line]');
        if (row) moveHandle(ctx, item, edge, row.dataset.line);
      };
      window.addEventListener('pointerup', up);
    },
  });
}

function onKey(e, ctx) {
  const { S } = ctx;
  if (e.target.closest('input, textarea, select')) return;
  const vis = S.d.visible;
  if (!vis.length) return;
  const idx = Math.max(0, vis.findIndex((l) => l.id === S.focusId));
  const go = (to, mode) => {
    const t = Math.max(0, Math.min(vis.length - 1, to));
    ctx.selectLine(vis[t].id, mode);
    setTimeout(() => {
      const r = document.querySelector(`[data-fk="row-${CSS.escape(vis[t].id)}"]`);
      r?.focus({ preventScroll: true }); r?.scrollIntoView({ block: 'nearest' });
    }, 0);
  };
  const mode = e.shiftKey ? 'range' : 'replace';
  const cur = vis[idx];
  if ((e.key === '[' || e.key === ']' || e.code === 'BracketLeft' || e.code === 'BracketRight') && selectedCutaway(S)) {
    e.preventDefault();
    const d = (e.key === '[' || e.code === 'BracketLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1);
    nudgeCutaway(ctx, selectedCutaway(S), e.altKey ? 'start' : 'end', d); return;
  }
  const typ = typeFromKey(e);
  if (typ) { e.preventDefault(); applyType(ctx, typ, null); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); ctx.run('Annulla', () => (e.shiftKey ? ctx.ce.redo() : ctx.ce.undo())).then((r) => r && r.ok === false && ctx.toast(r.reason || 'Niente da annullare.', 'info')); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); ctx.run('Ripeti', () => ctx.ce.redo()); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); go(idx + 1, mode); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); go(idx - 1, mode); }
  else if (e.key === 'PageDown') { e.preventDefault(); go(idx + 8, mode); }
  else if (e.key === 'PageUp') { e.preventDefault(); go(idx - 8, mode); }
  else if (e.key === 'Home') { e.preventDefault(); go(0, mode); }
  else if (e.key === 'End') { e.preventDefault(); go(vis.length - 1, mode); }
  else if (e.key === ' ') { e.preventDefault(); ctx.selectLine(cur.id, 'toggle'); }
  else if (e.key === 'Escape') { ctx.selectIds([], S.focusId); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); ctx.selectIds(vis.filter((l) => l.syncable).map((l) => l.id), cur.id); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const t = S.snap.project?.selection?.[cur.id] || S.activeTakeId || S.snap.view.bestTake?.[cur.id];
    if (t) ctx.preview(cur.id, t);
  } else if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const t = S.d.takes[Number(e.key) - 1];
    if (!t) return;
    e.preventDefault();
    const covered = (S.snap.view.coverage?.[t.id] || []).some((c) => c.lineId === cur.id);
    if (covered) ctx.chooseTake(cur.id, t.id); else { ctx.setActiveTake(t.id); ctx.toast(`“${ctx.takeLabel(t.id)}” non copre questa riga: take attivato per impostare le ancore.`, 'info'); }
  }
}

// ---------- spoglio: selezione di testo + menu contestuale ----------
const textEl = (row) => row.querySelector('.txt, .dlg-text, .scene-title');

/** {lineId,start,end,text} se c'e' una selezione non vuota dentro il testo della riga. */
function textSelectionIn(row) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const el = textEl(row);
  const r = sel.getRangeAt(0);
  if (!el || !el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
  const pre = document.createRange(); pre.setStart(el, 0); pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  return { start, end: start + r.toString().length };
}

export async function applyType(ctx, type, textSel, lineId) {
  const { S } = ctx;
  const label = TYPE_OPTIONS.find((o) => o.type === type)?.label || type;
  const ids = lineId ? [lineId] : (S.sel.length ? S.sel : [S.focusId]).filter(Boolean);
  if (!ids.length) { ctx.toast('Seleziona una riga o una porzione di testo.', 'info'); return; }
  const r = await ctx.run('Spoglio', async () => {
    for (const id of ids) {
      const line = S.d.byId.get(id);
      if (!line) continue;
      const edit = ids.length === 1 && textSel ? buildEdit(line, textSel.start, textSel.end, type) : buildEdit(line, 0, 0, type);
      const res = await ctx.ce.editScript(edit);
      if (res && res.ok === false) throw new Error(res.reason || 'modifica non riuscita');
    }
    return true;
  });
  if (r) ctx.toast(`Segnato come ${label}. Ctrl+Z per annullare.`, 'ok');
}

let menuEl = null;
function closeMenu() { menuEl?.remove(); menuEl = null; }

function onContext(e, ctx, line) {
  e.preventDefault();
  const row = e.currentTarget;
  const ts = textSelectionIn(row);
  if (!ts && !ctx.S.sel.includes(line.id)) ctx.selectLine(line.id, 'replace');
  closeMenu();
  const what = ts ? 'la selezione' : ctx.S.sel.length > 1 ? `${ctx.S.sel.length} righe` : 'la riga';
  menuEl = h('div', { class: 'menu ctxmenu', role: 'menu', 'aria-label': 'Segna come', style: { left: `${Math.min(e.clientX, window.innerWidth - 220)}px`, top: `${Math.min(e.clientY, window.innerHeight - 360)}px` } },
    h('div', { class: 'menu-title' }, `Segna ${what} come:`),
    TYPE_OPTIONS.map((o) => h('button', { class: 'menu-item', role: 'menuitem', type: 'button', onclick: () => { closeMenu(); applyType(ctx, o.type, ts, ts ? line.id : null); } },
      h('span', {}, o.label), h('kbd', {}, `Alt+${o.key.toUpperCase()}`))),
    h('div', { class: 'menu-sep', role: 'separator' }),
    h('button', { class: 'menu-item', role: 'menuitem', type: 'button', onclick: () => { closeMenu(); placeCamera(ctx, line.id); } }, h('span', {}, 'Metti questa camera qui'), h('kbd', {}, 'V2')),
    h('button', { class: 'menu-item', role: 'menuitem', type: 'button', disabled: !ctx.S.activeTakeId, onclick: () => { closeMenu(); setMasterFor(ctx, ctx.S.activeTakeId); } }, h('span', {}, 'Imposta take attivo come master'), h('kbd', {}, 'V1')));
  menuEl.addEventListener('keydown', (ev) => {
    const items = [...menuEl.querySelectorAll('[role=menuitem]')]; const i = items.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (ev.key === 'Escape') { closeMenu(); row.focus(); }
  });
  document.body.append(menuEl);
  menuEl.querySelector('[role=menuitem]').focus();
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}
