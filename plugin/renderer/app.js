// Entry del renderer: stato locale della UI, azioni verso window.ce, orchestrazione dei pannelli e dei controlli
// periodici (cambio progetto, righe gia' usate in timeline, "segui la timeline").
import { h, store, confirmDialog } from './dom.js';
import { takeColor } from './viewmodel/format.js';
import { filterLines, searchMatches, updateSelection, sortByScriptOrder } from './viewmodel/script.js';
import { buildCoverageLayout, uncoveredLineIds } from './viewmodel/coverage.js';
import { masterTakeId, cutawayLineIds } from './viewmodel/sequence.js';
import { buildColumnPlan } from './viewmodel/groups.js';
import { filterTakeList } from './viewmodel/marks.js';
import { summarize, nextStep } from './viewmodel/assistant.js';
import { cleanError, remedyFor } from './viewmodel/messages.js';
import { renderHeader } from './panels/header.js';
import { renderTakes, openBins } from './panels/takes.js';
import { renderScript } from './panels/script.js';
import { renderSide } from './panels/side.js';
import { renderEditor } from './panels/editor.js';
import { renderBoard } from './panels/board.js';
import { renderScan } from './panels/scan.js';
import { createPlayer } from './panels/player.js';
import { runSyncAll, renderSyncAll } from './panels/syncall.js';
import { openShortcuts, openDiagnostics, openWelcome } from './panels/dialogs.js';
import { GUIDE_KEY } from './viewmodel/guide.js';

const ce = window.ce;

const S = {
  env: null,
  snap: { project: null, view: { lines: [], takes: [], coverage: {}, bestTake: {}, warnings: [], sequence: { items: [], total: 0, markers: [] }, hasScript: false } },
  sel: [], focusId: null, rangeAnchor: null,
  activeTakeId: null,
  sceneId: null, query: '', onlyUncovered: false, matchIndex: 0,
  showLines: store.get('ce.showLines', true), ratingFilter: 'tutti', gradeFilter: [],
  mode: store.get('ce.mode', 'simple'), sideTab: 'line',
  boardOpen: false, scanOpen: false, takesOpen: false, editorOpen: store.get('ce.editorOpen', true),
  clips: {}, transcribing: new Set(),
  importInfo: null, showImport: false,
  busy: new Set(),
  usage: { ok: false, usedLines: {}, usedTakes: {} }, follow: false, tlLine: null,
  skipped: new Set(), sent: false, syncAll: null, aligned: new Set(),
  d: {},
};

let styles = {};
const stylesKey = () => `ce.styles.${S.env?.projectName || 'progetto'}`;
const sentKey = () => `ce.sent.${S.env?.projectName || 'progetto'}`;

// ---------- toast ----------
function toast(msg, kind = 'info', ms = 4500) {
  const host = document.getElementById('toasts');
  if (!host) return;
  for (const t of [...host.children]) if (t.dataset.msg === msg) t.remove(); // niente doppioni
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status', 'data-msg': msg },
    h('span', {}, msg),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Chiudi messaggio', onclick: () => el.remove() }, '×'));
  host.append(el);
  while (host.children.length > 4) host.firstElementChild.remove();
  if (ms) setTimeout(() => el.remove(), kind === 'error' ? ms * 2 : ms);
}

// Esegue un'azione: stato "occupato", errori in italiano con rimedio (mai il prefisso tecnico dell'IPC).
async function run(label, fn, { quiet = false } = {}) {
  S.busy.add(label); rerender(['header', 'takes']);
  try { return await fn(); } catch (e) {
    const msg = cleanError(e);
    if (!quiet) { const fix = remedyFor(msg); toast(`${label}: ${msg}${fix ? ` — ${fix}` : ''}`, 'error'); }
    return undefined;
  } finally { S.busy.delete(label); rerender(['header', 'takes']); }
}

// ---------- derivati ----------
function derive() {
  const { view, project } = S.snap;
  const byId = new Map(view.lines.map((l) => [l.id, l]));
  const visibleBase = filterLines(view.lines, { sceneId: S.sceneId, query: S.query });
  const unc = uncoveredLineIds(view.lines, view.coverage);
  const visible = S.onlyUncovered ? visibleBase.filter((l) => unc.has(l.id) || l.type === 'scene') : visibleBase;
  const allTakes = view.takes.map((t) => ({ ...(project?.takes?.find((p) => p.id === t.id) || {}), ...t }));
  const plan = buildColumnPlan(filterTakeList(allTakes, S.mode === 'simple' ? { rating: 'tutti', grades: [] } : { rating: S.ratingFilter, grades: S.gradeFilter }));
  const layout = buildCoverageLayout(visible, plan.ordered, view.coverage, project?.selection || {}, view.bestTake || {});
  const sitems = project?.sequence?.items || [];
  const cutMap = new Map();
  for (const it of sitems) if (it.role === 'cutaway' && it.fromLineId) cutawayLineIds(view.lines, it).forEach((id) => cutMap.set(`${it.takeId}|${id}`, it));
  const seq = { items: sitems, master: masterTakeId(sitems), cutMap, any: sitems.length > 0, layout: view.sequence };
  const summary = summarize({ view, project, clips: S.clips, transcribing: S.transcribing, sent: S.sent, aligned: S.aligned });
  const step = nextStep(summary, { skipped: S.skipped });
  S.d = { seq, byId, visible, unc, layout, plan, allTakes, takes: plan.ordered, matches: searchMatches(view.lines, S.query), summary, step };
}

// ---------- render ----------
let player = null;
const panels = {
  header: () => renderHeader(document.getElementById('header'), ctx),
  takes: () => renderTakes(document.getElementById('takes'), ctx),
  script: () => renderScript(document.getElementById('script'), ctx),
  side: () => renderSide(document.getElementById('side-tabs'), ctx),
  player: () => player?.render(),
  editor: () => renderEditor(document.getElementById('editor'), ctx),
  board: () => renderBoard(ctx),
  scan: () => renderScan(ctx),
  sync: () => renderSyncAll(ctx),
};
let scheduled = null;
function rerender(which = Object.keys(panels)) {
  scheduled = scheduled ? new Set([...scheduled, ...which]) : new Set(which);
  queueMicrotask(() => {
    if (!scheduled) return;
    const set = scheduled; scheduled = null;
    derive();
    const app = document.getElementById('app');
    app.classList.toggle('mode-advanced', S.mode === 'advanced');
    app.classList.toggle('mode-simple', S.mode !== 'advanced');
    app.classList.toggle('editor-closed', !S.editorOpen);
    app.classList.toggle('takes-open', S.takesOpen);
    for (const k of set) { try { panels[k](); } catch (e) { console.error(`render ${k}`, e); } }
    renderStatus();
  });
}

function renderStatus() {
  const el = document.getElementById('status');
  const { view } = S.snap;
  const s = S.d.summary;
  const parts = [];
  if (view.lines.length) parts.push(`${s.covered}/${s.syncable} righe sincronizzate`);
  parts.push(`${view.takes.length} take`);
  if (S.sel.length > 1) parts.push(`${S.sel.length} righe selezionate`);
  if (S.usage.ok) parts.push(`Timeline “${S.usage.timelineName}”: ${Object.keys(S.usage.usedLines).length} righe usate`);
  if (S.follow) parts.push('Segue la timeline');
  el.textContent = parts.join(' · ');
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
  if (snap.view.takes.some((t) => S.clips[t.clipId] === undefined)) { clearTimeout(statusTimer); statusTimer = setTimeout(refreshStatus, 300); }
  rerender();
}
let statusTimer = null;

async function refreshClips() {
  try {
    const list = await ce.getSelectedClips();
    for (const c of list) S.clips[c.clipId] = c;
    return list;
  } catch (e) { toast(`Lettura clip: ${cleanError(e)}`, 'error'); return []; }
}
// Stato di trascrizione dei take: dai bin caricati (loadBins lo riporta) o con una lettura dei bin.
function noteClips(list) { for (const c of list || []) if (c?.clipId) S.clips[c.clipId] = { ...(S.clips[c.clipId] || {}), ...c }; }
async function refreshStatus() {
  try { noteClips(await ce.takeStatus()); rerender(['takes', 'header']); } catch { /* Resolve occupato */ }
}

// ---------- azioni ----------
const ctx = {
  S, ce, rerender, run, toast, confirmDialog, refreshClips, noteClips, refreshStatus,
  get player() { return player; },
  take: (id) => S.snap.view.takes.find((t) => t.id === id) || null,
  takeIndex: (id) => S.snap.view.takes.findIndex((t) => t.id === id),
  takeColor(id) { const i = ctx.takeIndex(id); return styles[id]?.color || takeColor(i < 0 ? 0 : i); },
  takeLabel(id) { const t = ctx.take(id); return t?.label && t.label !== t.id ? t.label : (t?.name || id || ''); },
  setTakeStyle(id, patch) { styles[id] = { ...(styles[id] || {}), ...patch }; store.set(stylesKey(), styles); rerender(); },
  clipOf: (takeId) => S.snap.project?.clips?.[ctx.take(takeId)?.clipId] || null,
  fpsOf: (takeId) => ctx.clipOf(takeId)?.fps ?? S.env?.timelineFps ?? 25,
  coverageOf: (takeId, lineId) => (S.snap.view.coverage?.[takeId] || []).find((c) => c.lineId === lineId) || null,

  setActiveTake(id) { S.activeTakeId = id; rerender(['takes', 'script', 'side']); },
  selectLine(id, mode = 'replace') {
    const { selected, anchor } = updateSelection(S.d.visible, S.sel, S.rangeAnchor, id, mode);
    S.sel = selected; S.rangeAnchor = anchor; S.focusId = id;
    rerender(['script', 'side', 'player']);
  },
  selectIds(ids, focus = ids[0]) {
    S.sel = sortByScriptOrder(S.snap.view.lines, ids); S.focusId = focus ?? null; S.rangeAnchor = focus ?? null;
    rerender(['script', 'side', 'player']);
  },
  // take da usare per una riga: scelto, poi attivo se la copre, poi migliore
  takeForLine(lineId) {
    const sel = S.snap.project?.selection?.[lineId];
    if (sel) return sel;
    if (S.activeTakeId && ctx.coverageOf(S.activeTakeId, lineId)) return S.activeTakeId;
    return S.snap.view.bestTake?.[lineId] || null;
  },
  async chooseTake(lineId, takeId, { play = true } = {}) {
    S.activeTakeId = takeId;
    rerender(['takes', 'script', 'side']);
    await run('Scelta take', () => ce.setSelection(lineId, takeId));
    if (play) player?.playLine(lineId, takeId);
  },
  playLine(lineId, takeId = ctx.takeForLine(lineId)) {
    if (!takeId) { toast('Nessun take copre questa riga: aggancia la riga guardando un take (tasto M nel lettore).', 'info'); return; }
    player?.playLine(lineId, takeId);
  },
  async revealInResolve(lineId, takeId) {
    const r = await run('Mostra in Resolve', () => ce.previewLine({ lineId, takeId }));
    if (r && r.ok === false) toast(`Resolve: ${r.reason || 'non riuscito'}`, 'warn'); else if (r) toast('Clip selezionata nel Media Pool con In/Out sulla riga.', 'ok');
  },
  async seekTimeline(lineId, takeId) {
    const r = await run('Vai in timeline', () => ce.seekTimeline({ takeId, lineId }), { quiet: true });
    if (r && r.ok === false) toast(`Timeline: ${r.reason}`, 'info');
  },
  jumpToMatch(dir = 1) {
    const m = S.d.matches;
    if (!m.length) return;
    S.matchIndex = (S.matchIndex + dir + m.length) % m.length;
    ctx.selectLine(m[S.matchIndex]);
    ctx.scrollToLine(m[S.matchIndex]);
  },
  setFilter(patch) { Object.assign(S, patch); if ('showLines' in patch) store.set('ce.showLines', S.showLines); rerender(['takes', 'script', 'side']); },
  setMode(mode) { S.mode = mode; store.set('ce.mode', mode); if (mode === 'simple' && !['line', 'search'].includes(S.sideTab)) S.sideTab = 'line'; rerender(); },
  setSideTab(tab) { S.sideTab = tab; rerender(['side']); },
  toggleEditor(open = !S.editorOpen) { S.editorOpen = open; store.set('ce.editorOpen', open); rerender(['editor', 'player']); },
  openScan() { S.scanOpen = true; rerender(['scan']); },
  openBoard() { S.boardOpen = true; rerender(['board']); },
  openBins: () => openBins(ctx),
  openShortcuts, openWelcome,
  openDiagnostics: () => openDiagnostics(ctx),
  scrollToLine(id) { requestAnimationFrame(() => document.querySelector(`[data-line="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })); },
  markSent(v = true) { S.sent = v; store.set(sentKey(), v); },

  async importScript() {
    const picked = await run('Selezione file', () => ce.pickScriptFile());
    if (!picked) return;
    const r = await run('Importazione', () => ce.loadScript(picked.path));
    if (!r) return;
    S.importInfo = { ...r, name: picked.name };
    if (r.revision) {
      const v = r.revision;
      toast(`Revisione “${picked.name}”: ${v.uguali} righe uguali, ${v.modificate} modificate, ${v.nuove} nuove, ${v.tolte} tolte. Ancore conservate: ${v.anchorsKept}${v.anchorsDropped ? `, perse ${v.anchorsDropped} (righe tolte)` : ''}. Ctrl+Z annulla.`, v.tolte ? 'warn' : 'ok', 12000);
    } else toast(`Sceneggiatura “${picked.name}” caricata.`, 'ok');
    S.showImport = (r.warnings?.length || 0) > 0;
    rerender();
  },
  async docMode() {
    const ok = await confirmDialog('Le trascrizioni dei take diventano il copione: una scena per clip, una riga per frase, già sincronizzate. Le clip non ancora trascritte verranno trascritte prima.', { okLabel: 'Usa le trascrizioni' });
    if (!ok) return;
    await runSyncAll(ctx, { alignAfter: false });
    const r = await run('Copione dalle trascrizioni', () => ce.scriptFromTranscripts({}));
    if (r) toast(`Copione creato: ${r.lines} righe da ${r.takes} clip${r.missing.length ? ` (${r.missing.length} senza parlato)` : ''}.`, 'ok', 8000);
  },
  syncAll: () => runSyncAll(ctx),
  async roughCut() {
    const s = S.d.summary;
    if (!s.covered) { toast('Nessuna riga è ancora sincronizzata.', 'warn'); return; }
    const lines = S.snap.view.lines.filter((l) => l.syncable && (!S.sceneId || l.sceneId === S.sceneId)).map((l) => l.id);
    const r = await run('Montaggio grezzo', () => ce.sequence.fromLines(lines, { handleFrames: 0 }));
    if (!r) return;
    ctx.toggleEditor(true);
    toast(`Montaggio grezzo: ${r.itemCount} ${r.itemCount === 1 ? 'pezzo' : 'pezzi'} su V1${r.skipped.length ? `, ${r.skipped.length} righe senza take` : ''}. Tasto destro su una riga per mettere un'altra camera su V2.`, 'ok', 8000);
  },
  async sendTimeline(mode = 'new') {
    const d = new Date(); const z = (n) => String(n).padStart(2, '0');
    const name = mode === 'append' && S.env?.timelineName ? S.env.timelineName : `ContinuityEdit ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
    const r = await run('Invio in timeline', () => ce.sequence.assemble({ timelineName: name, withAudio: true, mode, lineMarkers: true }));
    if (!r) return null;
    if (r.ok) {
      ctx.markSent(true);
      toast(`Timeline “${r.timelineName}”: ${r.itemsAdded} pezzi${r.tracksCreated ? `, ${r.tracksCreated} tracce video aggiunte` : ''}${r.markersAdded ? `, ${r.markersAdded} marker delle righe` : ''}.${r.skipped?.length ? ` ${r.skipped.length} saltati: ${r.skipped[0].reason}.` : ''}`, r.skipped?.length ? 'warn' : 'ok', 9000);
      refreshEnv(); pollUsage(true);
    } else toast(`Timeline non creata: ${r.reason || 'motivo sconosciuto'}`, 'error');
    rerender();
    return r;
  },
  async tapSync() {
    const first = S.d.summary.uncoveredIds[0];
    if (!first) return;
    const line = S.d.byId.get(first);
    // take: quello attivo, oppure il primo del bin della scena
    const takeId = S.activeTakeId || S.snap.view.takes[0]?.id;
    if (!takeId) return;
    S.sceneId = null;
    ctx.selectIds([first]);
    ctx.scrollToLine(first);
    const prevCov = (S.snap.view.coverage?.[takeId] || []).filter((c) => (S.d.byId.get(c.lineId)?.order ?? 0) < line.order).pop();
    player?.load(takeId, { frame: prevCov ? prevCov.endFrame : 0, play: false });
    toast('Premi Spazio per far partire il take e M all’inizio di ogni azione.', 'info', 9000);
  },
  async doAction(id) {
    if (id.startsWith('skip:')) { S.skipped.add(id.slice(5)); rerender(); return; }
    const A = {
      openBins: () => ctx.openBins(),
      addSelected: () => addSelectedClips(),
      importScript: () => ctx.importScript(),
      docMode: () => ctx.docMode(),
      syncAll: () => ctx.syncAll(),
      showSync: () => { S.syncAll && (S.syncAll.hidden = false); rerender(['sync']); },
      tapSync: () => ctx.tapSync(),
      roughCut: () => ctx.roughCut(),
      openEditor: () => ctx.toggleEditor(true),
      sendTimeline: () => ctx.sendTimeline('new'),
      previewSeq: () => { ctx.toggleEditor(true); player?.playSequence(0); },
      followTimeline: () => ctx.setFollow(true),
    };
    await A[id]?.();
  },
  setFollow(on) { S.follow = on; if (!on) S.tlLine = null; rerender(['header', 'script']); if (on) pollPlayhead(); },
};

async function addSelectedClips() {
  await run('Aggiunta clip', async () => {
    const list = await refreshClips();
    if (!list.length) { toast('Nessuna clip selezionata nel Media Pool di Resolve.', 'warn'); return; }
    const have = new Set(S.snap.view.takes.map((t) => t.clipId));
    const fresh = list.filter((c) => !have.has(c.clipId));
    if (!fresh.length) { toast('Le clip selezionate sono già nel progetto.', 'info'); return; }
    let last = null;
    for (const c of fresh) last = (await ce.addTake({ clipId: c.clipId })).takeId;
    if (last) S.activeTakeId = last;
    toast(`${fresh.length} ${fresh.length === 1 ? 'take aggiunto' : 'take aggiunti'}.`, 'ok');
  });
}
ctx.addSelectedClips = addSelectedClips;

// ---------- controlli periodici ----------
async function refreshEnv() {
  try { S.env = await ce.getEnv(); rerender(['header']); } catch { /* Resolve occupato */ }
}
let usageBusy = false;
async function pollUsage(force = false) {
  if (usageBusy || (!force && (document.hidden || !S.snap.view.takes.length))) return;
  usageBusy = true;
  try {
    const u = await ce.timelineUsage();
    const changed = JSON.stringify(u.usedLines) !== JSON.stringify(S.usage.usedLines) || u.ok !== S.usage.ok;
    S.usage = u;
    if (changed) rerender(['script', 'takes']);
  } catch { /* ignora */ } finally { usageBusy = false; }
}
let phBusy = false;
async function pollPlayhead() {
  if (!S.follow || phBusy || document.hidden) return;
  phBusy = true;
  try {
    const r = await ce.timelinePlayhead();
    const key = r.ok && r.lineId ? `${r.takeId}|${r.lineId}` : null;
    if (key !== S.tlLine) {
      S.tlLine = key;
      rerender(['script']);
      if (r.lineId) ctx.scrollToLine(r.lineId);
    }
  } catch { /* ignora */ } finally { phBusy = false; }
}
async function pollProject() {
  if (document.hidden) return;
  try {
    const r = await ce.checkProject();
    if (r.changed) {
      S.env = r.env; S.clips = {}; S.sel = []; S.focusId = null; S.usage = { ok: false, usedLines: {}, usedTakes: {} };
      styles = store.get(stylesKey(), {}) || {};
      S.sent = !!store.get(sentKey(), false);
      applyState(await ce.getState());
      player?.unload();
      refreshStatus();
      toast(`Progetto Resolve cambiato: ora “${r.env.projectName}”${r.loaded ? ' (lavoro precedente ricaricato)' : ''}.`, 'info', 7000);
    } else if (r.env && (r.env.timelineName !== S.env?.timelineName || r.env.projectName !== S.env?.projectName)) { S.env = r.env; rerender(['header']); }
  } catch { /* Resolve non risponde: si riprova */ }
}

// ---------- avvio ----------
function shell() {
  const root = document.getElementById('root') || document.body;
  root.replaceChildren(
    h('a', { class: 'skip', href: '#script' }, 'Vai alla sceneggiatura'),
    h('div', { id: 'app', class: 'mode-simple' },
      h('header', { id: 'header', class: 'header', 'aria-label': 'Intestazione e prossimo passo' }),
      h('aside', { id: 'takes', class: 'takes', 'aria-label': 'Clip e take' }),
      h('main', { id: 'script', class: 'script', 'aria-label': 'Sceneggiatura', tabindex: '-1' }),
      h('section', { id: 'side', class: 'side', 'aria-label': 'Lettore e dettagli' },
        h('div', { id: 'player', class: 'player' }),
        h('div', { id: 'side-tabs', class: 'side-tabs' })),
      h('section', { id: 'editor', class: 'editor', 'aria-label': 'Montaggio' }),
      h('footer', { id: 'status', class: 'status', role: 'status' })),
    h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' }));
}

async function init() {
  shell();
  player = createPlayer(document.getElementById('player'), ctx);
  if (ce.__dev) window.__ctx = ctx; // solo nell'harness di sviluppo
  try {
    await ce.checkProject().catch(() => null);
    S.env = await ce.getEnv();
    styles = store.get(stylesKey(), {}) || {};
    S.sent = !!store.get(sentKey(), false);
    applyState(await ce.getState());
    ce.onChange((snap) => applyState(snap));
    // stato di trascrizione delle clip dei take (bin gia' caricati in passato)
    refreshStatus();
    if (!store.get(GUIDE_KEY, false)) openWelcome();
  } catch (e) {
    toast(`Avvio: ${cleanError(e)}`, 'error', 0);
  }
  rerender();
  setInterval(pollProject, 4000);
  setInterval(() => pollUsage(), 7000);
  setInterval(pollPlayhead, 900);
  setTimeout(() => pollUsage(true), 1500);
}

// Scorciatoie globali (fuori dai campi di testo)
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); document.getElementById('search-input')?.focus(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); run('Salva', async () => { await ce.saveProject(); toast('Progetto salvato.', 'ok'); }); return; }
  if (typing || document.querySelector('dialog[open], .scan-overlay, .board-overlay')) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); run('Annulla', () => (e.shiftKey ? ce.redo() : ce.undo())).then((r) => r && r.ok === false && toast(r.reason, 'info')); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); run('Ripeti', () => ce.redo()); return; }
  if (e.key === '?' && !mod) { e.preventDefault(); openShortcuts(); return; }
  if (player && player.handleKey(e)) e.preventDefault();
});

init();
