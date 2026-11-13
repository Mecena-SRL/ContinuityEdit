// Vista sceneggiatura stile ScriptSync: righe selezionabili + linee verticali di copertura per take.
import { h, renderInto } from '../dom.js';
import { sceneList, highlightParts, lineTypeLabel } from '../viewmodel/script.js';
import { sourceKind, sourceLabel } from '../viewmodel/coverage.js';
import { LOW_CONFIDENCE } from '../viewmodel/summary.js';

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
  list.style.setProperty('--ncols', String(Math.max(1, view.takes.length)));
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
    h('div', { class: 'bar-row bar-sub' },
      h('span', { class: 'dim' }, S.sel.length ? `${S.sel.length} ${S.sel.length === 1 ? 'riga selezionata' : 'righe selezionate'}` : 'Clic = seleziona · Maiusc = intervallo · Ctrl = aggiungi · 1-9 = scegli take'),
      h('span', { class: 'tb-spacer' }),
      h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'sel-all', onclick: () => ctx.selectIds(visible.filter((l) => l.syncable).map((l) => l.id)) }, 'Seleziona visibili'),
      h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'sel-none', disabled: !S.sel.length, onclick: () => ctx.selectIds([]) }, 'Deseleziona')),
  ]);

  renderInto(list, () => {
    if (!view.lines.length) return h('div', { class: 'empty big' }, h('p', {}, 'Nessuna sceneggiatura caricata.'), h('p', { class: 'dim' }, 'Usa “Importa sceneggiatura” per caricare un file .fdx o .pdf.'));
    if (!visible.length) return h('div', { class: 'empty big' }, 'Nessuna riga corrisponde ai filtri.');
    const focusId = S.focusId && visible.some((l) => l.id === S.focusId) ? S.focusId : null;
    const nodes = [];
    nodes.push(h('div', { class: 'gutter-head', role: 'presentation' },
      h('span', { class: 'gh-title' }, 'Copertura →'),
      h('div', { class: 'gh-cols' }, view.takes.map((t, i) => h('button', {
        class: `gh-col${S.activeTakeId === t.id ? ' on' : ''}`, type: 'button', style: { '--c': ctx.takeColor(t.id) }, tabindex: '-1',
        title: `${ctx.takeLabel(t.id)}${S.activeTakeId === t.id ? ' (attivo)' : ''}`, 'aria-label': `Attiva ${ctx.takeLabel(t.id)}`,
        onclick: () => ctx.setActiveTake(t.id),
      }, h('span', { class: 'gh-dot' }), h('span', { class: 'gh-num' }, i + 1))))));
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
    onclick: (e) => ctx.selectLine(l.id, e.shiftKey ? 'range' : (e.ctrlKey || e.metaKey) ? 'toggle' : 'replace'),
    ondblclick: () => { const t = chosenId || bestId || S.activeTakeId; if (t) ctx.preview(l.id, t); },
  },
  h('div', { class: 'line-body' }, body, tags.length ? h('div', { class: 'tags' }, tags) : null),
  h('div', { class: 'gutter', style: { width: `calc(var(--ncols) * var(--colw))` } }, cells.map((c) => gcell(ctx, l, c))));
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
  const desc = c.covered
    ? `${label}: copre la riga (${sourceLabel(c.source)}${c.estimated ? ', stimata' : ''})${c.chosen ? ', scelto' : ''}${c.best ? ', migliore' : ''}`
    : `${label}: non copre la riga`;
  return h('button', {
    class: cls.join(' '), type: 'button', tabindex: '-1', style: { '--c': ctx.takeColor(c.takeId) }, title: desc, 'aria-label': desc,
    onclick: (e) => {
      e.stopPropagation();
      ctx.selectLine(l.id, 'replace');
      if (c.covered) ctx.chooseTake(l.id, c.takeId); else ctx.setActiveTake(c.takeId);
    },
  }, c.covered ? h('span', { class: 'bar' }, (c.pos === 'start' || c.pos === 'single') ? h('i', { class: `kind kind-${kind}` }) : null) : null,
  c.chosen ? h('span', { class: 'check', 'aria-hidden': 'true' }, '✓') : null);
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
    const t = S.snap.view.takes[Number(e.key) - 1];
    if (!t) return;
    e.preventDefault();
    const covered = (S.snap.view.coverage?.[t.id] || []).some((c) => c.lineId === cur.id);
    if (covered) ctx.chooseTake(cur.id, t.id); else { ctx.setActiveTake(t.id); ctx.toast(`“${ctx.takeLabel(t.id)}” non copre questa riga: take attivato per impostare le ancore.`, 'info'); }
  }
}
