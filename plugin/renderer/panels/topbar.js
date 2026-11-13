// Barra superiore: progetto/timeline, import sceneggiatura, riepilogo parser, menu Strumenti.
import { h, renderInto } from '../dom.js';
import { scriptSummary, lowConfidenceLines } from '../viewmodel/summary.js';
import { percent } from '../viewmodel/format.js';

let menuOpen = false;
let outsideHooked = false;

export function renderTopbar(el, ctx) {
  if (!outsideHooked) {
    outsideHooked = true;
    document.addEventListener('click', (e) => {
      if (menuOpen && !e.target.closest('.menu-wrap')) { menuOpen = false; ctx.rerender(['topbar']); }
    });
  }
  const { S, ce, run, toast } = ctx;
  const env = S.env || {};
  const sd = S.snap.project?.scriptDoc;
  const sum = sd ? scriptSummary(S.importInfo?.scriptDoc || sd, S.importInfo?.confidence) : null;

  async function importScript() {
    const picked = await run('Selezione file', () => ce.pickScriptFile());
    if (!picked) return;
    if ((S.snap.project?.anchors?.length || 0) > 0) {
      const ok = await ctx.confirmDialog('Importare una nuova sceneggiatura? Se il testo cambia, le ancore esistenti verranno azzerate.', { okLabel: 'Importa', danger: true });
      if (!ok) return;
    }
    const r = await run('Importazione', () => ce.loadScript(picked.path));
    if (!r) return;
    S.importInfo = { ...r, name: picked.name };
    S.showImport = (r.warnings?.length || 0) > 0 || lowConfidenceLines(r.scriptDoc?.lines || []).length > 0;
    toast(`Sceneggiatura "${picked.name}" caricata.`, 'ok');
    ctx.rerender();
  }

  async function tool(label, fn) {
    menuOpen = false; ctx.rerender(['topbar']);
    await run(label, fn);
  }
  const tools = [
    ['Salva progetto', 'Ctrl+S', () => tool('Salva', async () => { await ce.saveProject(); toast('Progetto salvato.', 'ok'); })],
    ['Ricarica progetto salvato', '', () => tool('Ricarica', async () => { await ce.loadProject(); toast('Progetto ricaricato.', 'ok'); })],
    ['Scrivi marker in Resolve (take attivo)', '', () => tool('Scrittura marker', async () => {
      if (!S.activeTakeId) { toast('Nessun take attivo.', 'warn'); return; }
      const r = await ce.writeMarkers({ takeId: S.activeTakeId });
      toast(r.ok ? `${r.count} marker scritti sulla clip di "${ctx.takeLabel(S.activeTakeId)}".` : `Marker non scritti${r.reason ? `: ${r.reason}` : ''}.`, r.ok ? 'ok' : 'warn');
    })],
    ['Diagnostica API Resolve', '', () => tool('Diagnostica', async () => {
      const r = await ce.runDiagnostics();
      toast(r.ok ? `Diagnostica completata. File salvato in: ${r.path}` : `Diagnostica non riuscita${r.reason ? `: ${r.reason}` : ''}.`, r.ok ? 'ok' : 'warn', 9000);
    })],
  ];

  renderInto(el, () => [
    h('div', { class: 'tb-row' },
      h('div', { class: 'brand' }, h('img', { class: 'brand-logo', src: new URL('../../img/logo.svg', import.meta.url).href, alt: '', width: '22', height: '22' }), h('span', { class: 'brand-name' }, 'ContinuityEdit')),
      h('div', { class: 'proj', title: `${env.projectName || ''} · ${env.timelineName || ''}` },
        h('strong', {}, env.projectName || 'Nessun progetto'),
        h('span', { class: 'sep' }, '/'),
        h('span', {}, env.timelineName || 'Nessuna timeline'),
        env.timelineFps ? h('span', { class: 'dim' }, ` · ${env.timelineFps} fps`) : null),
      h('div', { class: 'tb-spacer' }),
      h('button', { class: 'btn', type: 'button', 'data-fk': 'help', 'aria-label': 'Guida: prima di iniziare', title: 'Prima di iniziare', onclick: () => ctx.openGuide() }, '?'),
      h('button', { class: 'btn', type: 'button', 'data-fk': 'open-scan', title: 'Classifica i take come Totale / Medio / Stretto / Dettaglio', onclick: () => ctx.openScan() }, 'Scansiona clip'),
      h('button', { class: 'btn', type: 'button', 'data-fk': 'open-board', onclick: () => { S.boardOpen = true; ctx.rerender(['board']); } }, 'Lavagna'),
      h('button', { class: 'btn btn-primary', type: 'button', 'data-fk': 'import', disabled: S.busy.has('Importazione'), onclick: importScript },
        S.busy.has('Importazione') ? 'Importazione…' : 'Importa sceneggiatura'),
      h('div', { class: 'menu-wrap' },
        h('button', {
          class: 'btn', type: 'button', 'data-fk': 'tools', 'aria-haspopup': 'menu', 'aria-expanded': String(menuOpen),
          onclick: () => { menuOpen = !menuOpen; ctx.rerender(['topbar']); },
          onkeydown: (e) => { if (e.key === 'Escape') { menuOpen = false; ctx.rerender(['topbar']); } },
        }, 'Strumenti ▾'),
        menuOpen ? h('div', {
          class: 'menu', role: 'menu',
          onkeydown: (e) => {
            const items = [...e.currentTarget.querySelectorAll('[role=menuitem]')];
            const i = items.indexOf(document.activeElement);
            if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
            if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
            if (e.key === 'Escape') { menuOpen = false; ctx.rerender(['topbar']); setTimeout(() => document.querySelector('[data-fk=tools]')?.focus(), 0); }
          },
        }, tools.map(([label, hint, fn], i) => h('button', { class: 'menu-item', role: 'menuitem', type: 'button', 'data-fk': `tool${i}`, onclick: fn },
          h('span', {}, label), hint ? h('kbd', {}, hint) : null))) : null)),
    sum ? h('div', { class: 'tb-row tb-sum' },
      h('span', { class: 'sum-title', title: sum.title }, sum.title || 'Sceneggiatura'),
      chip(`${sum.scenes} scene`), chip(`${sum.action} azioni`), chip(`${sum.dialogue} battute`),
      sum.source ? chip(sum.source.toUpperCase()) : null,
      sum.confidence != null ? chip(`Confidenza ${percent(sum.confidence)}`, sum.confidence < 0.75 ? 'warn' : 'ok') : null,
      sum.low ? chip(`${sum.low} righe incerte`, 'warn') : null,
      S.importInfo?.warnings?.length ? chip(`${S.importInfo.warnings.length} avvisi`, 'warn') : null,
      S.importInfo ? h('button', { class: 'btn btn-small', type: 'button', 'aria-expanded': String(S.showImport), 'data-fk': 'imp-toggle', onclick: () => { S.showImport = !S.showImport; ctx.rerender(['topbar']); } },
        S.showImport ? 'Nascondi anteprima' : 'Anteprima correzione') : null) : null,
    S.showImport && S.importInfo ? importPreview(ctx) : null,
  ]);
}

const chip = (text, kind = '') => h('span', { class: `chip ${kind}` }, text);

function importPreview(ctx) {
  const { S } = ctx;
  const info = S.importInfo;
  const low = lowConfidenceLines(info.scriptDoc?.lines || []);
  return h('section', { class: 'imp', 'aria-label': 'Anteprima di correzione del parser' },
    info.warnings?.length ? h('div', {},
      h('h3', {}, 'Avvisi del parser'),
      h('ul', { class: 'plain' }, info.warnings.map((w) => h('li', { class: 'warn-li' }, w)))) : null,
    low.length ? h('div', {},
      h('h3', {}, `Righe a bassa confidenza (${low.length}) — clicca per andare alla riga`),
      h('ul', { class: 'plain low-list' }, low.map((l) => h('li', {},
        h('button', {
          class: 'link-btn', type: 'button',
          onclick: () => { ctx.setFilter({ sceneId: null, query: '', onlyUncovered: false }); ctx.selectIds([l.id]); ctx.scrollToLine(l.id); },
        }, h('span', { class: 'conf-pill' }, percent(l.confidence)), ' ', h('span', { class: 'dim' }, `${l.type === 'dialogue' ? (l.character || '') + ': ' : ''}`), l.text))))) : null,
    !info.warnings?.length && !low.length ? h('p', { class: 'dim' }, 'Nessun problema segnalato dal parser.') : null);
}
