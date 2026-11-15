// Colonna destra sotto il lettore: schede Riga (take che coprono la riga + ancore), Cerca nel parlato,
// e in modalita' Avanzata Valuta e Note.
import { h, renderInto } from '../dom.js';
import { ico } from '../icons.js';
import { framesToTimecode, formatDuration, parseFrameInput, percent } from '../viewmodel/format.js';
import { anchorsForLine, warningsFor, sortedMarkers, edgeLabel, compareTakes } from '../viewmodel/compare.js';
import { sourceLabel, sourceKind } from '../viewmodel/coverage.js';
import { browserTab } from './browser.js';
import { cleanError } from '../viewmodel/messages.js';

const manual = { frame: '', edge: 'start' };
const search = { q: '', busy: false, res: null, err: null, seq: 0 };

export function renderSide(el, ctx) {
  const { S } = ctx;
  const adv = S.mode === 'advanced';
  const TABS = [['line', 'Riga', 'doc'], ['search', 'Cerca nel parlato', 'search'], ...(adv ? [['rate', 'Valuta', 'star'], ['notes', 'Note', 'doc']] : [])];
  if (!TABS.some(([k]) => k === S.sideTab)) S.sideTab = 'line';
  if (S.speechQuery) { search.q = S.speechQuery; S.speechQuery = null; doSearch(ctx); }
  let tabs = el.querySelector('.tabs'); let body = el.querySelector('.tab-body');
  if (!tabs) {
    tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Dettagli' });
    body = h('div', { class: 'tab-body', role: 'tabpanel' });
    el.replaceChildren(tabs, body);
    tabs.addEventListener('keydown', (e) => {
      const list = [...tabs.querySelectorAll('[role=tab]')]; const i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length]; n.click(); setTimeout(() => tabs.querySelector('[aria-selected=true]')?.focus(), 0); }
    });
  }
  renderInto(tabs, () => TABS.map(([k, label, icn]) => h('button', {
    class: `tab${S.sideTab === k ? ' on' : ''}`, role: 'tab', type: 'button', id: `tab-${k}`, 'aria-selected': String(S.sideTab === k), tabindex: S.sideTab === k ? '0' : '-1', 'data-fk': `tab-${k}`,
    onclick: () => ctx.setSideTab(k),
  }, ico(icn, 'ico ico-sm'), h('span', {}, label))));
  body.setAttribute('aria-labelledby', `tab-${S.sideTab}`);
  renderInto(body, () => ({ line: lineTab, search: searchTab, rate: browserTab, notes: notesTab }[S.sideTab])(ctx));
}

const ctxLine = (ctx) => { const id = ctx.S.focusId || ctx.S.sel[0] || null; return { lineId: id, line: id ? ctx.S.d.byId.get(id) : null }; };

// ---------------- Riga: take che la coprono + ancore ----------------
function lineTab(ctx) {
  const { S, ce, run, toast } = ctx;
  const { lineId, line } = ctxLine(ctx);
  if (!S.snap.view.lines.length) return h('p', { class: 'empty' }, 'Qui compaiono i take che coprono la riga selezionata.');
  if (!line) return h('div', { class: 'empty-card small' }, ico('doc', 'ico ico-lg'), h('p', {}, 'Seleziona una riga dello script.'), h('p', { class: 'dim' }, 'Vedrai i take che la coprono, potrai riprodurli e sceglierne uno.'));
  const adv = S.mode === 'advanced';
  const rows = compareTakes(lineId, S.snap.view, S.snap.project.selection, S.snap.project.clips);
  const takeId = S.activeTakeId;
  const fps = ctx.fpsOf(takeId);
  const list = takeId ? anchorsForLine(S.snap.project.anchors, lineId, takeId) : [];
  const warns = takeId ? warningsFor(S.snap.view.warnings, S.snap.project.anchors, lineId, takeId) : [];
  const used = S.usage.usedLines?.[lineId] || [];
  return h('div', { class: 'line-tab' },
    h('div', { class: 'line-head' }, line.character ? h('b', {}, line.character) : h('span', { class: 'dim' }, line.type === 'action' ? 'Azione' : ''), h('p', {}, line.text)),
    !line.syncable ? h('p', { class: 'hint' }, 'Le intestazioni e le transizioni non si sincronizzano.') : null,
    line.syncable ? (rows.length === 0
      ? h('div', { class: 'callout' }, ico('info'), h('div', {}, h('b', {}, 'Nessun take copre questa riga.'), h('p', {}, 'Apri un take nel lettore, fallo partire e premi M quando la riga comincia (N quando finisce).')))
      : h('ul', { class: 'cmp-list' }, rows.map((r) => h('li', { class: `cmp-row${r.chosen ? ' chosen' : ''}`, style: { '--c': ctx.takeColor(r.takeId) } },
        h('button', { class: 'btn btn-icon', type: 'button', title: 'Riproduci la riga con questo take', 'aria-label': `Riproduci con ${ctx.takeLabel(r.takeId)}`, onclick: () => ctx.player?.playLine(lineId, r.takeId) }, ico('play')),
        h('div', { class: 'cmp-main' },
          h('div', {}, h('i', { class: 'dotc' }), ' ', h('b', {}, ctx.takeLabel(r.takeId)),
            r.best && !r.chosen ? h('span', { class: 'tag best' }, '★ migliore') : null,
            used.includes(r.takeId) ? h('span', { class: 'tag used' }, 'in timeline') : null),
          h('div', { class: 'dim small' }, `${formatDuration(r.durationFrames, r.fps)}${r.estimated ? ' stimata' : ''} · ${sourceLabel(r.source)}${r.ratio != null ? ` · ${percent(r.ratio)} parole` : ''}`)),
        h('button', { class: `btn btn-small${r.chosen ? ' btn-on' : ''}`, type: 'button', 'aria-pressed': String(r.chosen), 'data-fk': `cm-use-${r.takeId}`, onclick: () => ctx.chooseTake(lineId, r.takeId, { play: false }) }, r.chosen ? 'Scelto' : 'Usa'))))) : null,
    line.syncable && takeId ? h('div', { class: 'sub' },
      h('h4', {}, 'Ancore con ', h('span', { class: 'ctx-take', style: { '--c': ctx.takeColor(takeId) } }, h('i', { class: 'dotc' }), ' ', ctx.takeLabel(takeId))),
      list.length ? h('ul', { class: 'anchor-list' }, list.map((a) => anchorRow(ctx, a, fps, adv))) : h('p', { class: 'dim small' }, 'Nessuna ancora per questa riga con il take attivo. Nel lettore: M = inizio, N = fine.'),
      warns.length ? h('ul', { class: 'plain warns' }, warns.map((w) => h('li', { class: 'warn-li' }, w.message))) : null,
      adv ? h('div', { class: 'btn-row' },
        h('input', { class: 'input frame-in', type: 'text', placeholder: 'frame o 00:00:00:00', value: manual.frame, 'aria-label': 'Frame manuale', 'data-fk': 'frame-in', oninput: (e) => { manual.frame = e.target.value; } }),
        h('select', { class: 'select', 'aria-label': 'Bordo', 'data-fk': 'edge-sel', onchange: (e) => { manual.edge = e.target.value; } }, ['start', 'end', 'point'].map((ed) => h('option', { value: ed, selected: manual.edge === ed }, edgeLabel(ed)))),
        h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'add-manual', onclick: async () => {
          const f = parseFrameInput(manual.frame, fps);
          if (f == null) { toast('Frame non valido: un numero di frame o un timecode HH:MM:SS:FF relativo alla clip.', 'warn'); return; }
          await run('Ancora', () => ce.addAnchor({ takeId, lineId, edge: manual.edge, frame: f })); manual.frame = '';
        } }, 'Aggiungi'),
        h('button', { class: 'btn btn-small', type: 'button', title: 'Usa il playhead della timeline di Resolve (la clip deve essere montata lì)', onclick: async () => {
          const r = await run('Playhead', () => ce.anchorFromPlayhead({ takeId, lineId, edge: manual.edge }));
          if (r) toast(r.ok ? `${edgeLabel(manual.edge)} dal playhead: frame ${r.frame}.` : `Playhead: ${r.reason}`, r.ok ? 'ok' : 'warn');
        } }, 'Dal playhead di Resolve')) : null,
      adv ? markersBlock(ctx, takeId, lineId, fps) : null) : null);
}

function anchorRow(ctx, a, fps, adv) {
  const { ce, run } = ctx;
  const move = (f) => run('Sposta ancora', () => ce.moveAnchor(a.id, f));
  const k = sourceKind(a.kind);
  const clip = ctx.clipOf(a.takeId);
  return h('li', { class: `anchor ak-${k}` },
    h('span', { class: `kind kind-${k}`, title: a.kind === 'manual' ? 'Manuale' : 'Automatica', 'aria-hidden': 'true' }),
    h('span', { class: 'a-edge' }, edgeLabel(a.edge)),
    h('button', { class: 'link-btn mono a-tc', type: 'button', title: 'Vai a questo frame nel lettore', onclick: () => ctx.player?.load(a.takeId, { frame: a.frame }) }, framesToTimecode(a.frame, fps, clip?.startTcFrames || 0)),
    adv && a.ratio != null ? h('span', { class: 'dim' }, percent(a.ratio)) : null,
    h('button', { class: 'btn btn-small', type: 'button', 'aria-label': 'Un frame prima', title: 'Un frame prima', onclick: () => move(a.frame - 1) }, '−1'),
    h('button', { class: 'btn btn-small', type: 'button', 'aria-label': 'Un frame dopo', title: 'Un frame dopo', onclick: () => move(a.frame + 1) }, '+1'),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Elimina ancora', title: 'Elimina', onclick: () => run('Elimina ancora', () => ce.removeAnchor(a.id)) }, ico('trash')));
}

function markersBlock(ctx, takeId, lineId, fps) {
  const { S, ce, run } = ctx;
  const markers = sortedMarkers(S.clips[ctx.take(takeId)?.clipId]?.markers);
  return h('details', { class: 'sub' }, h('summary', {}, `Marker della clip in Resolve (${markers.length})`),
    markers.length ? h('ul', { class: 'marker-list' }, markers.map((m) => h('li', {},
      h('span', { class: `mk mk-${String(m.color || '').toLowerCase()}`, 'aria-hidden': 'true' }),
      h('span', { class: 'mk-name', title: m.note || '' }, m.name || m.color || 'marker'),
      h('span', { class: 'dim mono' }, framesToTimecode(m.frame, fps)),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => run('Marker', () => ce.anchorFromMarker({ takeId, lineId, edge: 'start', markerFrame: m.frame })) }, 'Inizio'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => run('Marker', () => ce.anchorFromMarker({ takeId, lineId, edge: 'end', markerFrame: m.frame })) }, 'Fine'))))
      : h('p', { class: 'dim small' }, 'Seleziona la clip nel Media Pool e premi Aggiorna.'),
    h('button', { class: 'btn btn-small', type: 'button', onclick: () => run('Marker', () => ctx.refreshClips().then(() => ctx.rerender(['side']))) }, 'Aggiorna'));
}

// ---------------- Cerca nel parlato ----------------
async function doSearch(ctx) {
  const q = search.q.trim();
  const my = ++search.seq;
  if (!q) { search.res = null; ctx.rerender(['side']); return; }
  search.busy = true; ctx.rerender(['side']);
  try {
    const r = await ctx.ce.searchSpeech({ query: q });
    if (my === search.seq) { search.res = r; search.err = null; }
  } catch (e) { if (my === search.seq) search.err = cleanError(e); }
  if (my === search.seq) { search.busy = false; ctx.rerender(['side']); }
}
let searchTimer = null;
function searchTab(ctx) {
  const { S } = ctx;
  const r = search.res;
  return h('div', { class: 'search-tab' },
    h('div', { class: 'search big' }, ico('search', 'ico search-ico'),
      h('input', {
        class: 'input', type: 'search', placeholder: 'Una frase detta in una clip…', value: search.q, 'aria-label': 'Cerca nel parlato', 'data-fk': 'speech-q',
        oninput: (e) => { search.q = e.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch(ctx), 280); },
        onkeydown: (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch(ctx); } },
      }), search.busy ? h('span', { class: 'spin', 'aria-hidden': 'true' }) : null),
    h('p', { class: 'hint' }, 'Come PhraseFind: cerca in tutte le trascrizioni dei take, anche senza sceneggiatura. Tollera errori di riconoscimento e grafie diverse.'),
    search.err ? h('p', { class: 'warn-li' }, search.err) : null,
    r ? h('p', { class: 'dim small' }, `${r.hits.length} risultati in ${r.searched} ${r.searched === 1 ? 'clip trascritta' : 'clip trascritte'}${r.untranscribed ? ` · ${r.untranscribed} non trascritte` : ''}`) : null,
    r && r.hits.length ? h('ul', { class: 'hits' }, r.hits.map((x) => h('li', {},
      h('button', { class: 'hit', type: 'button', style: { '--c': ctx.takeColor(x.takeId) }, 'data-fk': `hit-${x.takeId}-${x.startFrame}`,
        onclick: () => { ctx.setActiveTake(x.takeId); ctx.player?.load(x.takeId, { frame: Math.max(0, x.startFrame - 12), play: true }); if (x.lineId) { ctx.selectIds([x.lineId]); ctx.scrollToLine(x.lineId); } } },
      h('span', { class: 'hit-take' }, h('i', { class: 'dotc' }), ' ', ctx.takeLabel(x.takeId), h('span', { class: 'dim mono' }, ` ${framesToTimecode(x.startFrame, ctx.fpsOf(x.takeId), ctx.clipOf(x.takeId)?.startTcFrames || 0)}`), x.score < 1 ? h('span', { class: 'dim' }, ` · ${Math.round(x.score * 100)}%`) : null),
      h('span', { class: 'hit-txt' }, h('span', { class: 'dim' }, x.before ? `…${x.before} ` : ''), h('mark', {}, x.match), h('span', { class: 'dim' }, x.after ? ` ${x.after}…` : '')))))) : null,
    r && !r.hits.length && search.q ? h('p', { class: 'empty' }, S.snap.view.takes.length ? 'Nessun risultato. Prova con meno parole.' : 'Carica prima le clip.') : null);
}

// ---------------- Note ----------------
function notesTab(ctx) {
  const { S, ce, run } = ctx;
  const { lineId, line } = ctxLine(ctx);
  const takeId = S.activeTakeId;
  const notes = S.snap.project?.notes || {};
  const save = (key) => (e) => { if ((notes[key] || '') !== e.target.value) run('Nota', () => ce.setNote(key, e.target.value)); };
  if (!line && !takeId) return h('p', { class: 'empty' }, 'Seleziona una riga o un take.');
  return h('div', { class: 'notes' },
    line ? h('label', { class: 'fld-col' }, h('span', {}, 'Nota sulla riga'),
      h('textarea', { class: 'input', rows: '3', 'data-fk': `note-${lineId}`, value: notes[lineId] || '', onchange: save(lineId), placeholder: 'Intenzione, continuità, da rigirare…' })) : null,
    takeId ? h('label', { class: 'fld-col' }, h('span', {}, `Nota sul take “${ctx.takeLabel(takeId)}”`),
      h('textarea', { class: 'input', rows: '3', 'data-fk': `note-${takeId}`, value: notes[takeId] || '', onchange: save(takeId), placeholder: 'Luce, microfono, qualità…' })) : null,
    h('p', { class: 'dim small' }, 'Le note si salvano quando esci dal campo.'));
}
