// Vista sceneggiatura stile ScriptSync: righe selezionabili + linee verticali di copertura per take.
// Clic = seleziona (e, con "Segui timeline", porta il playhead di Resolve li'); doppio clic / Invio = riproduce nel
// lettore; clic su una linea = usa quel take per la riga. Pallino pieno = riga gia' montata nella timeline corrente.
import { h, renderInto } from '../dom.js';
import { ico } from '../icons.js';
import { sceneList, highlightParts, lineTypeLabel } from '../viewmodel/script.js';
import { sourceKind, sourceLabel } from '../viewmodel/coverage.js';
import { LOW_CONFIDENCE, scriptSummary } from '../viewmodel/summary.js';
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
  const adv = S.mode === 'advanced';

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
  const sum = view.lines.length ? scriptSummary(project?.scriptDoc, S.importInfo?.confidence) : null;

  renderInto(bar, () => !view.lines.length ? [] : [
    h('div', { class: 'bar-row' },
      h('label', { class: 'fld' }, h('span', { class: 'sr-only' }, 'Scena'),
        h('select', { class: 'select', 'data-fk': 'scene-filter', onchange: (e) => ctx.setFilter({ sceneId: e.target.value || null }) },
          h('option', { value: '' }, `Tutte le scene (${scenes.length})`),
          scenes.map((s) => h('option', { value: s.id, selected: S.sceneId === s.id }, s.heading.length > 34 ? `${s.heading.slice(0, 33)}…` : s.heading)))),
      h('div', { class: 'search' }, ico('search', 'ico search-ico'),
        h('input', {
          id: 'search-input', class: 'input', type: 'search', placeholder: 'Cerca nello script…', value: S.query, 'aria-label': 'Cerca nello script', 'data-fk': 'search',
          oninput: (e) => ctx.setFilter({ query: e.target.value, matchIndex: 0 }),
          onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); ctx.jumpToMatch(e.shiftKey ? -1 : 1); } },
        }),
        S.query ? h('span', { class: 'dim count', 'aria-live': 'polite' }, `${S.d.matches.length}`) : null,
        S.query ? h('button', { class: 'btn btn-link btn-small', type: 'button', title: 'Cerca la stessa frase nel parlato di tutte le clip', onclick: () => { ctx.S.speechQuery = S.query; ctx.setSideTab('search'); } }, 'nel parlato') : null),
      h('label', { class: 'chk', title: 'Mostra solo le righe che nessun take copre' },
        h('input', { type: 'checkbox', checked: S.onlyUncovered, 'data-fk': 'only-unc', onchange: (e) => ctx.setFilter({ onlyUncovered: e.target.checked }) }), ' Scoperte')),
    adv ? h('div', { class: 'bar-row bar-filters' },
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: S.showLines, 'data-fk': 'show-lines', onchange: (e) => ctx.setFilter({ showLines: e.target.checked }) }), h('span', { class: 'sw-track', 'aria-hidden': 'true' }), ' Linee'),
      h('div', { class: 'seg seg-sm', role: 'group', 'aria-label': 'Filtro valutazione' }, RATINGS.map(([k, label]) => h('button', {
        class: `seg-btn${S.ratingFilter === k ? ' on' : ''}`, type: 'button', 'aria-pressed': String(S.ratingFilter === k), 'data-fk': `rf-${k}`, onclick: () => ctx.setFilter({ ratingFilter: k }),
      }, label))),
      h('div', { class: 'seg seg-sm', role: 'group', 'aria-label': 'Filtro voto' }, gradePalette(project).map((g) => h('button', {
        class: `seg-btn${S.gradeFilter.includes(g) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(S.gradeFilter.includes(g)), 'data-fk': `gf-${g}`,
        onclick: () => ctx.setFilter({ gradeFilter: S.gradeFilter.includes(g) ? S.gradeFilter.filter((x) => x !== g) : [...S.gradeFilter, g] }),
      }, g))),
      sum ? h('span', { class: 'dim sum-chips' }, `${sum.title ? `${sum.title} · ` : ''}${sum.scenes} scene · ${sum.dialogue} battute · ${sum.action} azioni${sum.low ? ` · ${sum.low} righe incerte` : ''}`) : null) : null,
  ]);

  renderInto(list, () => {
    if (!view.lines.length) {
      return h('div', { class: 'empty-hero' },
        h('img', { src: new URL('../../img/icon.svg', import.meta.url).href, alt: '', width: '72', height: '72' }),
        h('h2', {}, 'Nessuna sceneggiatura'),
        h('p', { class: 'dim' }, 'Importa un file Final Draft (.fdx) o PDF. Le sceneggiature mute vanno benissimo: le azioni si sincronizzano guardando.'),
        h('div', { class: 'btn-row center' },
          h('button', { class: 'btn btn-primary', type: 'button', 'data-fk': 'empty-import', onclick: () => ctx.importScript() }, ico('doc'), ' Importa sceneggiatura…'),
          view.takes.length ? h('button', { class: 'btn', type: 'button', 'data-fk': 'empty-doc', onclick: () => ctx.docMode() }, ico('mic'), ' Usa le trascrizioni') : null));
    }
    if (!visible.length) return h('div', { class: 'empty big' }, 'Nessuna riga corrisponde ai filtri.');
    const focusId = S.focusId && visible.some((l) => l.id === S.focusId) ? S.focusId : null;
    const nodes = [];
    if (S.showLines && takesShown.length) {
      const plan = S.d.plan;
      nodes.push(h('div', { class: 'gutter-head', role: 'presentation' },
        h('span', { class: 'gh-title' }, 'Take'),
        h('div', { class: 'gh-wrap' },
          plan.groups.length ? h('div', { class: 'gh-groups' }, plan.cols.map((c) => {
            const g = plan.groups.find((x) => x.groupId === c.groupId);
            return h('span', { class: `gh-grp${g ? ' in' : ''}${g && g.from === c.col ? ' first' : ''}${g && g.from + g.count - 1 === c.col ? ' last' : ''}`, title: g ? `Camere della stessa ripresa (${g.groupId})` : '' }, '');
          })) : null,
          h('div', { class: 'gh-cols' }, plan.cols.map((c) => {
            const t = S.d.allTakes.find((x) => x.id === c.takeId);
            return h('button', {
              class: `gh-col${S.activeTakeId === c.takeId ? ' on' : ''}${c.groupId ? ' mc' : ''}`, type: 'button', style: { '--c': ctx.takeColor(c.takeId) }, tabindex: '-1',
              title: `${ctx.takeLabel(c.takeId)}${c.angle ? ` · ${c.angle}` : ''}${t?.shot ? ` · ${t.shot}` : ''}`, 'aria-label': `Take attivo: ${ctx.takeLabel(c.takeId)}`,
              onclick: () => ctx.setActiveTake(c.takeId),
            }, h('span', { class: 'gh-dot' }), h('span', { class: 'gh-num' }, c.angle ? c.angle.replace(/^CAM\s*/i, '') : c.col + 1), t?.shot ? h('span', { class: 'gh-shot' }, shotAbbr(t.shot)) : null);
          })))));
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
  const used = S.usage.usedLines?.[l.id];
  const tlHere = S.tlLine && S.tlLine.endsWith(`|${l.id}`);
  const textParts = (t) => highlightParts(t, S.query).map((p) => (p.hit ? h('mark', { class: curMatch ? 'cur' : '' }, p.text) : p.text));

  let body;
  if (l.type === 'scene') body = h('h3', { class: 'scene-title' }, textParts(l.text));
  else if (l.type === 'dialogue') body = h('div', { class: 'dia' }, h('div', { class: 'char' }, textParts(l.character || '')), h('p', { class: 'dlg-text' }, textParts(l.text)));
  else body = h('p', { class: `txt t-${l.type}` }, textParts(l.text));

  const tags = [];
  if (chosenId) tags.push(h('span', { class: 'tag chosen', style: { '--c': ctx.takeColor(chosenId) } }, ico('check', 'ico ico-xs'), ' ', ctx.takeLabel(chosenId)));
  else if (bestId && l.syncable && S.mode === 'advanced') tags.push(h('span', { class: 'tag best', style: { '--c': ctx.takeColor(bestId) } }, '★ ', ctx.takeLabel(bestId)));
  if (used) tags.push(h('span', { class: 'tag used', title: `Montata nella timeline “${S.usage.timelineName}”` }, ico('timeline', 'ico ico-xs'), ' in timeline'));
  if (uncovered) tags.push(h('span', { class: 'tag unc', title: 'Nessun take copre questa riga' }, 'scoperta'));
  if (lowConf) tags.push(h('span', { class: 'tag low', title: `Il PDF qui è incerto (${Math.round(l.confidence * 100)}%): controlla il tipo di riga` }, `? ${Math.round(l.confidence * 100)}%`));
  if (note) tags.push(h('span', { class: 'tag note', title: note }, '✎ nota'));

  return h('div', {
    class: `line-row t-${l.type}${selected ? ' sel' : ''}${l.id === S.focusId ? ' focus' : ''}${uncovered ? ' uncovered' : ''}${lowConf ? ' lowconf' : ''}${l.syncable ? '' : ' nosync'}${tlHere ? ' tl-here' : ''}`,
    role: 'option', 'aria-selected': String(selected), 'data-line': l.id, 'data-fk': `row-${l.id}`,
    tabindex: (focusId ? l.id === focusId : vi === 0) ? '0' : '-1',
    'aria-label': `${lineTypeLabel(l.type)}${l.character ? ` ${l.character}` : ''}: ${l.text}${uncovered ? '. Scoperta' : ''}${used ? '. In timeline' : ''}`,
    onclick: (e) => {
      if (textSelectionIn(e.currentTarget)) return;
      ctx.selectLine(l.id, e.shiftKey ? 'range' : (e.ctrlKey || e.metaKey) ? 'toggle' : 'replace');
      if (S.follow && l.syncable && !e.shiftKey) { const t = used?.[0] || ctx.takeForLine(l.id); if (t) ctx.seekTimeline(l.id, t); }
    },
    oncontextmenu: (e) => onContext(e, ctx, l),
    ondblclick: () => { if (l.syncable) ctx.playLine(l.id); },
  },
  h('div', { class: 'line-body' }, body, tags.length ? h('div', { class: 'tags' }, tags) : null),
  S.showLines && cells.length ? h('div', { class: 'gutter', style: { width: 'calc(var(--ncols) * var(--colw))' } }, cells.map((c) => gcell(ctx, l, c, used))) : null);
}

function gcell(ctx, l, c, used) {
  const { S } = ctx;
  const label = ctx.takeLabel(c.takeId);
  const kind = c.covered ? sourceKind(c.source) : null;
  const cls = ['gcell'];
  if (c.covered) cls.push('cov', `pos-${c.pos}`, `k-${kind}`);
  if (c.estimated) cls.push('est');
  if (c.chosen) cls.push('chosen');
  if (c.best) cls.push('best');
  if (S.activeTakeId === c.takeId) cls.push('active');
  const isUsed = c.covered && used?.includes(c.takeId);
  if (isUsed) cls.push('used');
  const seq = S.d.seq;
  const cut = c.covered ? seq.cutMap.get(`${c.takeId}|${l.id}`) : null;
  if (c.covered && seq.master === c.takeId) cls.push('master');
  else if (cut) cls.push('cut');
  const desc = c.covered
    ? `${label}: copre la riga (${sourceLabel(c.source)}${c.estimated ? ', stimata' : ''})${c.chosen ? ', scelto' : ''}${isUsed ? ', in timeline' : ''}. Clic: usa e riproduci`
    : `${label}: non copre la riga`;
  return h('button', {
    class: cls.join(' '), type: 'button', tabindex: '-1', style: { '--c': ctx.takeColor(c.takeId) }, title: desc, 'aria-label': desc,
    onclick: (e) => {
      e.stopPropagation();
      if (cut) selectSeqItem(cut.id);
      ctx.selectLine(l.id, 'replace');
      if (c.covered) ctx.chooseTake(l.id, c.takeId); else { ctx.setActiveTake(c.takeId); ctx.player?.load(c.takeId, { keepTime: true }); }
    },
  }, c.covered ? h('span', { class: 'bar' }, (c.pos === 'start' || c.pos === 'single') ? h('i', { class: `kind kind-${kind}` }) : null) : null,
  isUsed && (c.pos === 'start' || c.pos === 'single') ? h('span', { class: 'used-dot', 'aria-hidden': 'true' }) : null,
  cut && l.id === cut.fromLineId ? h('span', { class: 'vlabel' }, trackLabel(cut.track || 2)) : null,
  cut && l.id === cut.fromLineId ? handle(ctx, cut, 'from') : null,
  cut && l.id === cut.toLineId ? handle(ctx, cut, 'to') : null,
  c.chosen ? h('span', { class: 'check', 'aria-hidden': 'true' }, '✓') : null);
}

/** Maniglia di inizio/fine di un cutaway: si trascina sulle righe (scatta alla riga sotto il puntatore). */
function handle(ctx, item, edge) {
  return h('span', {
    class: `hdl hdl-${edge}`, title: edge === 'from' ? 'Trascina: prima riga del cutaway' : 'Trascina: ultima riga del cutaway', role: 'presentation',
    onclick: (e) => e.stopPropagation(),
    onpointerdown: (e) => {
      e.preventDefault(); e.stopPropagation(); document.body.classList.add('dragging-h');
      const up = (ev) => {
        window.removeEventListener('pointerup', up); document.body.classList.remove('dragging-h');
        const r = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-line]');
        if (r) moveHandle(ctx, item, edge, r.dataset.line);
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
  if ((e.key === '[' || e.key === ']') && selectedCutaway(S)) {
    e.preventDefault();
    const d = (e.key === '[' ? -1 : 1) * (e.shiftKey ? 5 : 1);
    nudgeCutaway(ctx, selectedCutaway(S), e.altKey ? 'start' : 'end', d); return;
  }
  const typ = typeFromKey(e);
  if (typ) { e.preventDefault(); applyType(ctx, typ, null); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); go(idx + 1, mode); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); go(idx - 1, mode); }
  else if (e.key === 'PageDown') { e.preventDefault(); go(idx + 8, mode); }
  else if (e.key === 'PageUp') { e.preventDefault(); go(idx - 8, mode); }
  else if (e.key === 'Home') { e.preventDefault(); go(0, mode); }
  else if (e.key === 'End') { e.preventDefault(); go(vis.length - 1, mode); }
  else if (e.key === 'Escape') { ctx.selectIds([], S.focusId); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); ctx.selectIds(vis.filter((l) => l.syncable).map((l) => l.id), cur.id); }
  else if (e.key === 'Enter') { e.preventDefault(); if (cur.syncable) ctx.playLine(cur.id); }
  else if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const t = S.d.takes[Number(e.key) - 1];
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    const covered = (S.snap.view.coverage?.[t.id] || []).some((c) => c.lineId === cur.id);
    if (covered) ctx.chooseTake(cur.id, t.id); else { ctx.setActiveTake(t.id); ctx.player?.load(t.id, { keepTime: true }); ctx.toast(`“${ctx.takeLabel(t.id)}” non copre questa riga: è nel lettore, premi M dove la riga inizia.`, 'info'); }
  }
}

// ---------- spoglio: selezione di testo + menu contestuale ----------
const textEl = (r) => r.querySelector('.txt, .dlg-text, .scene-title');

/** {start,end} se c'e' una selezione non vuota dentro il testo della riga. */
function textSelectionIn(r) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const el = textEl(r);
  const range = sel.getRangeAt(0);
  if (!el || !el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const pre = document.createRange(); pre.setStart(el, 0); pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { start, end: start + range.toString().length };
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
      await ctx.ce.editScript(edit);
    }
    return true;
  });
  if (r) ctx.toast(`Segnato come ${label}. Ctrl+Z per annullare.`, 'ok');
}

let menuEl = null;
function closeMenu() { menuEl?.remove(); menuEl = null; }

function onContext(e, ctx, line) {
  e.preventDefault();
  const r = e.currentTarget;
  const ts = textSelectionIn(r);
  if (!ts && !ctx.S.sel.includes(line.id)) ctx.selectLine(line.id, 'replace');
  closeMenu();
  const what = ts ? 'la selezione' : ctx.S.sel.length > 1 ? `${ctx.S.sel.length} righe` : 'la riga';
  const t = ctx.takeForLine(line.id);
  const item = (label, kbd, fn, dis = false, icn = null) => h('button', { class: 'menu-item', role: 'menuitem', type: 'button', disabled: dis, onclick: () => { closeMenu(); fn(); } }, icn ? ico(icn) : null, h('span', {}, label), kbd ? h('kbd', {}, kbd) : null);
  menuEl = h('div', { class: 'menu ctxmenu', role: 'menu', 'aria-label': 'Azioni sulla riga', style: { left: `${Math.min(e.clientX, window.innerWidth - 270)}px`, top: `${Math.min(e.clientY, window.innerHeight - 420)}px` } },
    line.syncable ? [
      item(t ? `Riproduci con ${ctx.takeLabel(t)}` : 'Riproduci', 'Invio', () => ctx.playLine(line.id), !t, 'play'),
      item('Metti la camera attiva su V2 per queste righe', '', () => placeCamera(ctx, line.id), !ctx.S.activeTakeId, 'timeline'),
      item('Usa il take attivo come master (V1)', '', () => setMasterFor(ctx, ctx.S.activeTakeId), !ctx.S.activeTakeId, 'film'),
      item('Mostra in Resolve', '', () => ctx.revealInResolve(line.id, t), !t, 'resolve'),
      ctx.S.usage.usedLines?.[line.id] ? item('Vai alla riga nella timeline', '', () => ctx.seekTimeline(line.id, ctx.S.usage.usedLines[line.id][0]), false, 'target') : null,
      h('div', { class: 'menu-sep', role: 'separator' }),
    ] : null,
    h('div', { class: 'menu-title' }, `Segna ${what} come`),
    TYPE_OPTIONS.map((o) => item(o.label, `Alt+${o.key.toUpperCase()}`, () => applyType(ctx, o.type, ts, ts ? line.id : null))));
  menuEl.addEventListener('keydown', (ev) => {
    const its = [...menuEl.querySelectorAll('[role=menuitem]:not(:disabled)')]; const i = its.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); its[(i + 1) % its.length].focus(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); its[(i - 1 + its.length) % its.length].focus(); }
    if (ev.key === 'Escape') { closeMenu(); r.focus(); }
  });
  document.body.append(menuEl);
  menuEl.querySelector('[role=menuitem]:not(:disabled)')?.focus();
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}
