// Entry del renderer: stato locale della UI, azioni verso window.ce, orchestrazione dei pannelli.
import { h, store, confirmDialog } from './dom.js';
import { takeColor } from './viewmodel/format.js';
import { filterLines, searchMatches, updateSelection, sortByScriptOrder } from './viewmodel/script.js';
import { buildCoverageLayout, uncoveredLineIds } from './viewmodel/coverage.js';
import { renderTopbar } from './panels/topbar.js';
import { renderTakes } from './panels/takes.js';
import { renderScript } from './panels/script.js';
import { renderDock } from './panels/dock.js';
import { renderBoard } from './panels/board.js';
import { renderScan } from './panels/scan.js';
import { openGuide } from './panels/guide.js';
import { masterTakeId, cutawayLineIds } from './viewmodel/sequence.js';
import { buildColumnPlan } from './viewmodel/groups.js';
import { filterTakeList } from './viewmodel/marks.js';
import { GUIDE_KEY, shouldShowGuide } from './viewmodel/guide.js';

const ce = window.ce;

const S = {
  env: null,
  snap: { project: null, view: { lines: [], takes: [], coverage: {}, bestTake: {}, warnings: [] } },
  sel: [], focusId: null, rangeAnchor: null,
  activeTakeId: null,
  sceneId: null, query: '', onlyUncovered: false, matchIndex: 0,
  showLines: store.get('ce.showLines', true), ratingFilter: 'tutti', gradeFilter: [], boardOpen: false, scanOpen: false,
  tab: 'anchors',
  clips: {},          // clipId -> info da getSelectedClips (marker, transcribed, ...)
  transcribing: new Set(),
  importInfo: null,   // { scriptDoc, warnings, confidence, name }
  showImport: false,
  assemble: { name: '', handle: 12, result: null, busy: false },
  busy: new Set(),
  d: {},
};

let styles = {};
const stylesKey = () => `ce.styles.${S.env?.projectName || 'progetto'}`;

// ---------- toast ----------
const toastsEl = () => document.getElementById('toasts');
function toast(msg, kind = 'info', ms = 4500) {
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', {}, msg),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Chiudi messaggio', onclick: () => el.remove() }, '×'));
  toastsEl().append(el);
  if (ms) setTimeout(() => el.remove(), kind === 'error' ? ms * 2 : ms);
}

async function run(label, fn) {
  S.busy.add(label); rerender(['topbar', 'takes', 'dock']);
  try { return await fn(); } catch (e) { toast(`${label}: ${e?.message || e}`, 'error'); return undefined; } finally { S.busy.delete(label); rerender(['topbar', 'takes', 'dock']); }
}

// ---------- derivati ----------
function derive() {
  const { view, project } = S.snap;
  const byId = new Map(view.lines.map((l) => [l.id, l]));
  const visibleBase = filterLines(view.lines, { sceneId: S.sceneId, query: S.query });
  const unc = uncoveredLineIds(view.lines, view.coverage);
  const visible = S.onlyUncovered ? visibleBase.filter((l) => unc.has(l.id) || l.type === 'scene') : visibleBase;
  const allTakes = view.takes.map((t) => ({ ...(project?.takes?.find((p) => p.id === t.id) || {}), ...t }));
  const plan = buildColumnPlan(filterTakeList(allTakes, { rating: S.ratingFilter, grades: S.gradeFilter }));
  const layout = buildCoverageLayout(visible, plan.ordered, view.coverage, project?.selection || {}, view.bestTake || {});
  const sitems = project?.sequence?.items || [];
  const cutMap = new Map();
  for (const it of sitems) if (it.role === 'cutaway') cutawayLineIds(view.lines, it).forEach((id) => cutMap.set(`${it.takeId}|${id}`, it));
  const seq = { items: sitems, master: masterTakeId(sitems), cutMap, any: sitems.length > 0 };
  S.d = { seq, byId, visible, unc, layout, plan, allTakes, takes: plan.ordered, matches: searchMatches(view.lines, S.query) };
}

// ---------- render ----------
const panels = {
  topbar: () => renderTopbar(document.getElementById('topbar'), ctx),
  takes: () => renderTakes(document.getElementById('takes'), ctx),
  script: () => renderScript(document.getElementById('script'), ctx),
  dock: () => renderDock(document.getElementById('dock'), ctx),
  board: () => renderBoard(ctx),
  scan: () => renderScan(ctx),
};
let scheduled = null;
function rerender(which = Object.keys(panels)) {
  scheduled = scheduled ? new Set([...scheduled, ...which]) : new Set(which);
  queueMicrotask(() => {
    if (!scheduled) return;
    const set = scheduled; scheduled = null;
    derive();
    for (const k of set) panels[k]();
    renderStatus();
  });
}

function renderStatus() {
  const el = document.getElementById('status');
  const { view } = S.snap;
  const sync = view.lines.filter((l) => l.syncable).length;
  el.textContent = `${view.lines.length} righe · ${sync} sincronizzabili · ${S.d.unc?.size ?? 0} non coperte · ${view.takes.length} take · ${S.sel.length} selezionate`;
}

// ---------- stato dal main ----------
function applyState(snap) {
  S.snap = snap;
  const ids = new Set(snap.view.takes.map((t) => t.id));
  if (!S.activeTakeId || !ids.has(S.activeTakeId)) S.activeTakeId = snap.view.takes[0]?.id ?? null;
  const lineIds = new Set(snap.view.lines.map((l) => l.id));
  S.sel = S.sel.filter((id) => lineIds.has(id));
  if (S.focusId && !lineIds.has(S.focusId)) S.focusId = S.sel[0] ?? null;
  if (S.sceneId && !snap.view.lines.some((l) => l.sceneId === S.sceneId)) S.sceneId = null;
  rerender();
}

async function refreshClips() {
  try {
    const list = await ce.getSelectedClips();
    for (const c of list) S.clips[c.clipId] = c;
    return list;
  } catch (e) { toast(`Lettura clip: ${e.message}`, 'error'); return []; }
}

// ---------- azioni ----------
const ctx = {
  S, ce, rerender, run, toast, confirmDialog, refreshClips,
  take: (id) => S.snap.view.takes.find((t) => t.id === id) || null,
  takeIndex: (id) => S.snap.view.takes.findIndex((t) => t.id === id),
  takeColor(id) { const i = ctx.takeIndex(id); return styles[id]?.color || takeColor(i < 0 ? 0 : i); },
  takeLabel(id) { const t = ctx.take(id); return styles[id]?.label || t?.label || t?.name || id || ''; },
  setTakeStyle(id, patch) {
    styles[id] = { ...(styles[id] || {}), ...patch };
    store.set(stylesKey(), styles);
    rerender();
  },
  clipOf: (takeId) => S.snap.project?.clips?.[ctx.take(takeId)?.clipId] || null,
  fpsOf: (takeId) => ctx.clipOf(takeId)?.fps ?? S.env?.timelineFps ?? 25,

  setActiveTake(id) { S.activeTakeId = id; rerender(); },
  selectLine(id, mode = 'replace') {
    const { selected, anchor } = updateSelection(S.d.visible, S.sel, S.rangeAnchor, id, mode);
    S.sel = selected; S.rangeAnchor = anchor; S.focusId = id;
    rerender(['script', 'dock']);
  },
  selectIds(ids, focus = ids[0]) {
    S.sel = sortByScriptOrder(S.snap.view.lines, ids); S.focusId = focus ?? null; S.rangeAnchor = focus ?? null;
    rerender(['script', 'dock']);
  },
  async chooseTake(lineId, takeId, { preview = true } = {}) {
    S.activeTakeId = takeId;
    rerender(['takes', 'script', 'dock']);
    await run('Scelta take', async () => {
      await ce.setSelection(lineId, takeId);
      if (preview) {
        const r = await ce.previewLine({ lineId, takeId });
        if (r && r.ok === false) toast(`Anteprima: ${r.reason || 'non riuscita'}`, 'warn');
      }
    });
  },
  async preview(lineId, takeId) {
    const r = await run('Anteprima', () => ce.previewLine({ lineId, takeId }));
    if (r && r.ok === false) toast(`Anteprima: ${r.reason || 'non riuscita'}`, 'warn');
  },
  jumpToMatch(dir = 1) {
    const m = S.d.matches;
    if (!m.length) return;
    S.matchIndex = (S.matchIndex + dir + m.length) % m.length;
    ctx.selectLine(m[S.matchIndex]);
    document.querySelector(`[data-line="${m[S.matchIndex]}"]`)?.scrollIntoView({ block: 'center' });
  },
  setFilter(patch) { Object.assign(S, patch); if ('showLines' in patch) store.set('ce.showLines', S.showLines); rerender(['takes', 'script', 'dock']); },
  openGuide: () => openGuide(),
  openScan() { S.scanOpen = true; rerender(['scan']); },
  scrollToLine(id) { requestAnimationFrame(() => document.querySelector(`[data-line="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })); },
};

// ---------- avvio ----------
async function init() {
  try {
    S.env = await ce.getEnv();
    styles = store.get(stylesKey(), {}) || {};
    S.assemble.name = `Assemblaggio ${S.env.timelineName || ''}`.trim();
    applyState(await ce.getState());
    ce.onChange((snap) => applyState(snap));
    refreshClips().then(() => rerender(['takes', 'dock']));
    if (shouldShowGuide(store.get(GUIDE_KEY, false))) openGuide();
  } catch (e) {
    toast(`Avvio: ${e.message || e}`, 'error', 0);
  }
  rerender();
}

// Navigazione tastiera globale: Ctrl/Cmd+F = ricerca, Ctrl/Cmd+S = salva
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); document.getElementById('search-input')?.focus(); }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); run('Salva', async () => { await ce.saveProject(); toast('Progetto salvato.', 'ok'); }); }
});

init();
