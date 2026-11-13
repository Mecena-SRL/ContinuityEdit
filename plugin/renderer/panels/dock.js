// Dock inferiore/destro: Ancore, Confronto take, Assembla, Note.
import { h, renderInto } from '../dom.js';
import { framesToTimecode, formatDuration, parseFrameInput, percent } from '../viewmodel/format.js';
import { anchorsForLine, warningsFor, sortedMarkers, edgeLabel, compareTakes } from '../viewmodel/compare.js';
import { sourceLabel, sourceKind } from '../viewmodel/coverage.js';
import { assemblySummary, skipReasonLabel } from '../viewmodel/summary.js';
import { sortByScriptOrder } from '../viewmodel/script.js';

const TABS = [['anchors', 'Ancore'], ['compare', 'Confronto take'], ['assemble', 'Assembla'], ['notes', 'Note']];
const manual = { frame: '', edge: 'start' }; // stato locale del campo frame manuale

export function renderDock(el, ctx) {
  const { S } = ctx;
  let tabs = el.querySelector('.tabs');
  let body = el.querySelector('.dock-body');
  if (!tabs) {
    tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Pannelli' });
    body = h('div', { class: 'dock-body', role: 'tabpanel' });
    el.replaceChildren(tabs, body);
    tabs.addEventListener('keydown', (e) => {
      const i = TABS.findIndex(([k]) => k === S.tab);
      let n = null;
      if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
      if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
      if (n != null) { e.preventDefault(); S.tab = TABS[n][0]; ctx.rerender(['dock']); setTimeout(() => tabs.querySelector('[aria-selected=true]')?.focus(), 0); }
    });
  }
  renderInto(tabs, () => TABS.map(([k, label]) => h('button', {
    class: `tab${S.tab === k ? ' on' : ''}`, role: 'tab', type: 'button', id: `tab-${k}`, 'aria-selected': String(S.tab === k), tabindex: S.tab === k ? '0' : '-1', 'data-fk': `tab-${k}`,
    onclick: () => { S.tab = k; ctx.rerender(['dock']); },
  }, label, k === 'assemble' && S.sel.length ? h('span', { class: 'tab-count' }, S.sel.length) : null)));
  body.setAttribute('aria-labelledby', `tab-${S.tab}`);
  renderInto(body, () => ({ anchors, compare, assemble, notes }[S.tab])(ctx));
}

function context(ctx) {
  const { S } = ctx;
  const lineId = S.focusId || S.sel[0] || null;
  const line = lineId ? S.d.byId.get(lineId) : null;
  return { lineId, line, takeId: S.activeTakeId };
}

const lineHead = (ctx, line, takeId) => h('div', { class: 'ctx' },
  line ? h('span', { class: 'ctx-line', title: line.text }, h('b', {}, `${line.type === 'dialogue' ? `${line.character}: ` : ''}`), line.text) : h('span', { class: 'dim' }, 'Nessuna riga selezionata'),
  takeId ? h('span', { class: 'ctx-take', style: { '--c': ctx.takeColor(takeId) } }, h('i', { class: 'dotc' }), ctx.takeLabel(takeId)) : null);

// ---------------- Ancore ----------------
function anchors(ctx) {
  const { S, ce, run, toast } = ctx;
  const { lineId, line, takeId } = context(ctx);
  if (!line) return h('p', { class: 'empty' }, 'Seleziona una riga della sceneggiatura per impostare le ancore. Le righe di azione si sincronizzano come le battute.');
  const proj = S.snap.project;
  const fps = ctx.fpsOf(takeId);
  const list = takeId ? anchorsForLine(proj.anchors, lineId, takeId) : [];
  const warns = takeId ? warningsFor(S.snap.view.warnings, proj.anchors, lineId, takeId) : [];
  const clipId = ctx.take(takeId)?.clipId;
  const markers = sortedMarkers(S.clips[clipId]?.markers);
  const syncable = line.syncable;

  const fromPlayhead = async (edge) => {
    const r = await run('Playhead', () => ce.anchorFromPlayhead({ takeId, lineId, edge }));
    if (!r) return;
    if (r.ok) toast(`${edgeLabel(edge)} impostato al frame ${r.frame} (${framesToTimecode(r.frame, fps)}).`, 'ok');
    else toast(`Playhead: ${r.reason || 'non riuscito'}`, 'warn', 7000);
  };
  const fromMarker = (edge, m) => run('Marker', () => ce.anchorFromMarker({ takeId, lineId, edge, markerFrame: m.frame }));
  const addManual = async () => {
    const f = parseFrameInput(manual.frame, fps);
    if (f == null) { toast('Frame non valido: usa un numero di frame oppure un timecode HH:MM:SS:FF.', 'warn'); return; }
    await run('Ancora', () => ce.addAnchor({ takeId, lineId, edge: manual.edge, frame: f }));
    manual.frame = '';
  };
  const dis = !takeId || !syncable;

  return h('div', { class: 'anchors' },
    lineHead(ctx, line, takeId),
    !syncable ? h('p', { class: 'hint warn' }, 'Questa riga non è sincronizzabile (solo azioni e battute).') : null,
    S.sel.length > 1 ? h('p', { class: 'hint' }, `Le ancore valgono per la riga evidenziata; ${S.sel.length} righe selezionate in totale.`) : null,
    line.type === 'action' ? h('p', { class: 'hint' }, 'Riga di azione (sceneggiatura muta): si ancora esattamente come una battuta.') : null,
    h('div', { class: 'take-pick', role: 'group', 'aria-label': 'Take attivo' },
      S.snap.view.takes.map((t) => h('button', {
        class: `pill${t.id === takeId ? ' on' : ''}`, type: 'button', style: { '--c': ctx.takeColor(t.id) }, 'aria-pressed': String(t.id === takeId), 'data-fk': `pk-${t.id}`,
        onclick: () => ctx.setActiveTake(t.id),
      }, h('i', { class: 'dotc' }), ctx.takeLabel(t.id)))),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'button', disabled: dis, 'data-fk': 'ph-start', onclick: () => fromPlayhead('start') }, 'Imposta inizio da playhead'),
      h('button', { class: 'btn btn-primary', type: 'button', disabled: dis, 'data-fk': 'ph-end', onclick: () => fromPlayhead('end') }, 'Imposta fine da playhead')),
    h('div', { class: 'sub' },
      h('h4', {}, 'Frame manuale'),
      h('div', { class: 'btn-row' },
        h('input', {
          class: 'input frame-in', type: 'text', inputmode: 'text', placeholder: 'frame o 00:00:00:00', value: manual.frame, 'aria-label': 'Frame manuale', 'data-fk': 'frame-in', disabled: dis,
          oninput: (e) => { manual.frame = e.target.value; },
          onkeydown: (e) => { if (e.key === 'Enter') addManual(); },
        }),
        h('select', { class: 'select', 'aria-label': 'Bordo', 'data-fk': 'edge-sel', disabled: dis, onchange: (e) => { manual.edge = e.target.value; } },
          ['start', 'end', 'point'].map((ed) => h('option', { value: ed, selected: manual.edge === ed }, edgeLabel(ed)))),
        h('button', { class: 'btn', type: 'button', disabled: dis, 'data-fk': 'add-manual', onclick: addManual }, 'Aggiungi'))),
    h('div', { class: 'sub' },
      h('h4', {}, 'Marker della clip'),
      !takeId ? h('p', { class: 'dim' }, 'Nessun take attivo.')
        : markers.length ? h('ul', { class: 'marker-list' }, markers.map((m, i) => h('li', {},
          h('span', { class: `mk mk-${String(m.color || '').toLowerCase()}`, 'aria-hidden': 'true' }),
          h('span', { class: 'mk-name', title: m.note || '' }, m.name || m.color || 'marker'),
          h('span', { class: 'dim mono' }, framesToTimecode(m.frame, fps)),
          h('button', { class: 'btn btn-small', type: 'button', disabled: !syncable, 'data-fk': `mk-s-${i}`, onclick: () => fromMarker('start', m) }, 'Inizio'),
          h('button', { class: 'btn btn-small', type: 'button', disabled: !syncable, 'data-fk': `mk-e-${i}`, onclick: () => fromMarker('end', m) }, 'Fine'))))
          : h('div', {}, h('p', { class: 'dim' }, 'Nessun marker letto per questa clip (selezionala nel Media Pool).'),
            h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'mk-refresh', onclick: async () => { await run('Marker', () => ctx.refreshClips()); } }, 'Aggiorna marker'))),
    h('div', { class: 'sub' },
      h('h4', {}, `Ancore della riga (${list.length})`),
      list.length ? h('ul', { class: 'anchor-list' }, list.map((a) => anchorRow(ctx, a, fps))) : h('p', { class: 'dim' }, 'Nessuna ancora per questa riga e questo take.'),
      warns.length ? h('ul', { class: 'plain warns', 'aria-label': 'Avvisi di coerenza' }, warns.map((w) => h('li', { class: 'warn-li' }, w.message))) : null));
}

function anchorRow(ctx, a, fps) {
  const { ce, run } = ctx;
  let val = String(a.frame);
  const move = (f) => run('Sposta ancora', () => ce.moveAnchor(a.id, f));
  const apply = () => {
    const f = parseFrameInput(val, fps);
    if (f == null) { ctx.toast('Frame non valido.', 'warn'); return; }
    if (f !== a.frame) move(f);
  };
  const k = sourceKind(a.kind);
  return h('li', { class: `anchor ak-${k}` },
    h('span', { class: `kind kind-${k}`, title: a.kind === 'manual' ? 'Manuale' : 'Automatico', 'aria-hidden': 'true' }),
    h('span', { class: 'a-edge' }, edgeLabel(a.edge)),
    h('span', { class: 'dim mono a-tc' }, framesToTimecode(a.frame, fps)),
    a.ratio != null ? h('span', { class: 'dim' }, percent(a.ratio)) : null,
    h('span', { class: 'sr-only' }, a.kind === 'manual' ? 'manuale' : 'automatico'),
    h('button', { class: 'btn btn-small', type: 'button', 'aria-label': 'Un frame indietro', 'data-fk': `a-m-${a.id}`, onclick: () => move(a.frame - 1) }, '−1'),
    h('input', { class: 'input frame-in sm', type: 'text', value: val, 'aria-label': 'Frame dell\'ancora', 'data-fk': `a-f-${a.id}`, oninput: (e) => { val = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') apply(); }, onchange: apply }),
    h('button', { class: 'btn btn-small', type: 'button', 'aria-label': 'Un frame avanti', 'data-fk': `a-p-${a.id}`, onclick: () => move(a.frame + 1) }, '+1'),
    h('button', { class: 'btn btn-small btn-ghost-danger', type: 'button', 'data-fk': `a-d-${a.id}`, onclick: () => run('Elimina ancora', () => ce.removeAnchor(a.id)) }, 'Elimina'));
}

// ---------------- Confronto ----------------
function compare(ctx) {
  const { S } = ctx;
  const { lineId, line } = context(ctx);
  if (!line) return h('p', { class: 'empty' }, 'Seleziona una riga per confrontare i take che la coprono.');
  const rows = compareTakes(lineId, S.snap.view, S.snap.project.selection, S.snap.project.clips);
  return h('div', {},
    lineHead(ctx, line, null),
    rows.length === 0 ? h('p', { class: 'empty' }, 'Nessun take copre questa riga: aggiungi le ancore dal pannello Ancore.')
      : h('table', { class: 'cmp' },
        h('thead', {}, h('tr', {}, ['Take', 'Durata', 'Ratio', 'Origine', '', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows.map((r) => h('tr', { class: r.chosen ? 'chosen' : '', style: { '--c': ctx.takeColor(r.takeId) } },
          h('td', {}, h('i', { class: 'dotc' }), ' ', ctx.takeLabel(r.takeId), ' ',
            r.best ? h('span', { class: 'tag best' }, '★ migliore') : null, r.chosen ? h('span', { class: 'tag chosen' }, '✓ scelto') : null),
          h('td', { class: 'mono' }, formatDuration(r.durationFrames, r.fps), r.estimated ? h('span', { class: 'dim' }, ' ~') : null),
          h('td', {}, percent(r.ratio)),
          h('td', {}, h('span', { class: `kind kind-${sourceKind(r.source)}`, 'aria-hidden': 'true' }), ' ', sourceLabel(r.source), r.estimated ? ' (stimata)' : ''),
          h('td', {}, h('button', { class: 'btn btn-small', type: 'button', 'data-fk': `cm-prev-${r.takeId}`, onclick: () => ctx.preview(lineId, r.takeId) }, 'Anteprima')),
          h('td', {}, h('button', { class: `btn btn-small${r.chosen ? ' btn-on' : ''}`, type: 'button', 'aria-pressed': String(r.chosen), 'data-fk': `cm-use-${r.takeId}`, onclick: () => ctx.chooseTake(lineId, r.takeId) }, r.chosen ? 'Scelto' : 'Usa questo take'))))))
  );
}

// ---------------- Assembla ----------------
function assemble(ctx) {
  const { S, ce, run } = ctx;
  const A = S.assemble;
  const ids = sortByScriptOrder(S.snap.view.lines, S.sel.filter((id) => S.d.byId.get(id)?.syncable));
  const go = async () => {
    A.busy = true; A.result = null; ctx.rerender(['dock']);
    const r = await run('Assemblaggio', () => ce.assemble({ lineIds: ids, timelineName: A.name.trim() || 'Assemblaggio', handleFrames: Math.max(0, parseInt(A.handle, 10) || 0) }));
    A.busy = false; A.result = r || null; ctx.rerender(['dock']);
  };
  return h('div', { class: 'assemble' },
    h('p', {}, ids.length ? h('span', {}, h('b', {}, ids.length), ` ${ids.length === 1 ? 'riga sincronizzabile selezionata' : 'righe sincronizzabili selezionate'}. Per ogni riga si usa il take scelto o il migliore; righe consecutive dello stesso take si fondono.`)
      : 'Seleziona le righe da assemblare nello script (Maiusc per un intervallo).'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'as-scene', onclick: () => { const sc = S.d.byId.get(S.focusId)?.sceneId; if (sc) ctx.selectIds(S.snap.view.lines.filter((l) => l.sceneId === sc && l.syncable).map((l) => l.id)); } }, 'Tutta la scena corrente'),
      h('button', { class: 'btn btn-small', type: 'button', 'data-fk': 'as-all', onclick: () => ctx.selectIds(S.snap.view.lines.filter((l) => l.syncable).map((l) => l.id)) }, 'Tutto lo script')),
    h('div', { class: 'form' },
      h('label', { class: 'fld-col' }, h('span', {}, 'Nome timeline'),
        h('input', { class: 'input', type: 'text', value: A.name, 'data-fk': 'asm-name', oninput: (e) => { A.name = e.target.value; } })),
      h('label', { class: 'fld-col narrow' }, h('span', {}, 'Handle (frame)'),
        h('input', { class: 'input', type: 'number', min: '0', step: '1', value: A.handle, 'data-fk': 'asm-handle', oninput: (e) => { A.handle = e.target.value; } }))),
    h('button', { class: 'btn btn-primary', type: 'button', 'data-fk': 'asm-go', disabled: !ids.length || A.busy, onclick: go }, A.busy ? 'Assemblaggio…' : 'Assembla in timeline'),
    A.result ? h('div', { class: `result ${A.result.ok ? 'ok' : 'bad'}`, role: 'status' },
      h('p', {}, assemblySummary(A.result)),
      A.result.skipped?.length ? h('ul', { class: 'plain' }, A.result.skipped.map((s) => h('li', {}, h('span', { class: 'mono dim' }, s.lineId), ' · ', (S.d.byId.get(s.lineId)?.text || '').slice(0, 48), ' — ', skipReasonLabel(s.reason)))) : null) : null);
}

// ---------------- Note ----------------
function notes(ctx) {
  const { S, ce, run } = ctx;
  const { lineId, line, takeId } = context(ctx);
  if (!line) return h('p', { class: 'empty' }, 'Seleziona una riga per aggiungere note.');
  const notes = S.snap.project.notes || {};
  const save = (key) => (e) => { if ((notes[key] || '') !== e.target.value) run('Nota', () => ce.setNote(key, e.target.value)); };
  return h('div', { class: 'notes' },
    lineHead(ctx, line, null),
    h('label', { class: 'fld-col' }, h('span', {}, 'Nota sulla riga'),
      h('textarea', { class: 'input', rows: '3', 'data-fk': `note-${lineId}`, 'aria-label': 'Nota sulla riga', value: notes[lineId] || '', onchange: save(lineId), placeholder: 'Es. intenzione, continuità, da rigirare…' })),
    takeId ? h('label', { class: 'fld-col' }, h('span', {}, `Nota sul take “${ctx.takeLabel(takeId)}”`),
      h('textarea', { class: 'input', rows: '3', 'data-fk': `note-${takeId}`, 'aria-label': 'Nota sul take', value: notes[takeId] || '', onchange: save(takeId), placeholder: 'Es. luce, microfono, qualità generale…' })) : null,
    h('p', { class: 'dim' }, 'Le note si salvano quando esci dal campo.'));
}
