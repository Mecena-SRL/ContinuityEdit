// Intestazione: logo, progetto/timeline, ASSISTENTE (un solo prossimo passo con un pulsante), modalita', menu.
import { h, renderInto } from '../dom.js';
import { ico } from '../icons.js';
import { openWriteToResolve } from './dialogs.js';

let menuOpen = false;
let hooked = false;

export function renderHeader(el, ctx) {
  const { S, ce, run, toast } = ctx;
  if (!hooked) {
    hooked = true;
    document.addEventListener('click', (e) => { if (menuOpen && !e.target.closest('.menu-wrap')) { menuOpen = false; ctx.rerender(['header']); } });
  }
  const env = S.env || {};
  const step = S.d.step;
  const hasProject = !!S.snap.project;
  const tool = (label, fn) => async () => { menuOpen = false; ctx.rerender(['header']); await fn(); };
  const items = [
    ['doc', 'Importa sceneggiatura o revisione…', () => ctx.importScript()],
    ['mic', 'Copione dalle trascrizioni (documentario)', () => ctx.docMode(), !S.snap.view.takes.length],
    null,
    ['folder', 'Bin di scena…', () => ctx.openBins()],
    ['film', 'Scansiona clip (inquadrature)', () => ctx.openScan(), !S.snap.view.takes.length],
    ['board', 'Lavagna', () => ctx.openBoard(), !hasProject],
    null,
    ['resolve', 'Scrivi valutazioni nel Media Pool…', () => openWriteToResolve(ctx), !S.snap.view.takes.length],
    ['anchor', 'Scrivi le ancore come marker sulla clip attiva', () => run('Marker', async () => {
      if (!S.activeTakeId) { toast('Nessun take attivo.', 'warn'); return; }
      const r = await ce.writeMarkers({ takeId: S.activeTakeId });
      toast(r.ok ? `${r.count} marker scritti sulla clip “${ctx.takeLabel(S.activeTakeId)}”.` : `Marker non scritti${r.reason ? `: ${r.reason}` : ''}.`, r.ok ? 'ok' : 'warn');
    }), !S.activeTakeId],
    ['doc', 'Sottotitoli SRT dal montaggio…', () => run('Sottotitoli', async () => {
      const r = await ce.sequence.subtitles({ save: true, importToResolve: true });
      if (!r.ok) { toast(`Sottotitoli: ${r.reason}`, 'warn'); return; }
      if (!r.saved) return;
      toast(r.imported?.ok ? `${r.cues} sottotitoli salvati e importati nel Media Pool.` : `${r.cues} sottotitoli salvati in ${r.saved}. In Resolve: File > Importa > Sottotitoli.`, 'ok', 9000);
    }), !(S.snap.project?.sequence?.items || []).length],
    null,
    ['check', 'Salva ora', () => run('Salva', async () => { await ce.saveProject(); toast('Progetto salvato.', 'ok'); }), !hasProject],
    ['stethoscope', 'Diagnostica della API di Resolve', () => ctx.openDiagnostics()],
    ['keyboard', 'Scorciatoie da tastiera', () => ctx.openShortcuts()],
    ['help', 'Come funziona', () => ctx.openWelcome()],
  ];

  renderInto(el, () => [
    h('div', { class: 'hd-brand' },
      h('button', { class: 'icon-btn hd-takes', type: 'button', title: 'Clip e take', 'aria-label': 'Mostra clip e take', 'aria-expanded': String(S.takesOpen), onclick: () => { S.takesOpen = !S.takesOpen; ctx.rerender(['header']); } }, ico('sidebar')),
      h('img', { class: 'brand-logo', src: new URL('../../img/icon.svg', import.meta.url).href, alt: '', width: '28', height: '28' }),
      h('div', { class: 'brand-txt' },
        h('span', { class: 'brand-name' }, 'ContinuityEdit'),
        h('span', { class: 'brand-proj', title: `${env.projectName || ''} · ${env.timelineName || ''}` },
          env.projectName || 'Nessun progetto', env.timelineName ? ` · ${env.timelineName}` : '', env.timelineFps ? ` · ${env.timelineFps} fps` : ''))),
    step ? assistant(ctx, step) : h('div', { class: 'assist' }),
    h('div', { class: 'hd-tools' },
      S.snap.view.takes.length ? h('button', {
        class: `btn btn-ghost btn-icon-text${S.follow ? ' btn-on' : ''}`, type: 'button', 'aria-pressed': String(S.follow), 'data-fk': 'follow',
        title: 'Lo script segue il playhead della timeline di Resolve; clic su una riga = porta il playhead lì', onclick: () => ctx.setFollow(!S.follow),
      }, ico('target'), h('span', { class: 'lbl-wide' }, 'Segui timeline')) : null,
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Modalità' },
        [['simple', 'Semplice'], ['advanced', 'Avanzata']].map(([k, l]) => h('button', {
          class: `seg-btn${S.mode === k ? ' on' : ''}`, type: 'button', 'aria-pressed': String(S.mode === k), 'data-fk': `mode-${k}`,
          title: k === 'simple' ? 'Solo l’essenziale' : 'Mostra valutazioni, filtri, ancore in frame, note', onclick: () => ctx.setMode(k),
        }, l))),
      h('button', { class: 'icon-btn round', type: 'button', title: 'Scorciatoie (?)', 'aria-label': 'Scorciatoie da tastiera', 'data-fk': 'help', onclick: () => ctx.openShortcuts() }, ico('keyboard')),
      h('div', { class: 'menu-wrap' },
        h('button', {
          class: 'icon-btn round', type: 'button', 'data-fk': 'menu', 'aria-haspopup': 'menu', 'aria-expanded': String(menuOpen), 'aria-label': 'Altre azioni', title: 'Altre azioni',
          onclick: () => { menuOpen = !menuOpen; ctx.rerender(['header']); if (menuOpen) setTimeout(() => el.querySelector('.menu [role=menuitem]')?.focus(), 0); },
        }, ico('more')),
        menuOpen ? h('div', {
          class: 'menu', role: 'menu',
          onkeydown: (e) => {
            const its = [...e.currentTarget.querySelectorAll('[role=menuitem]:not(:disabled)')];
            const i = its.indexOf(document.activeElement);
            if (e.key === 'ArrowDown') { e.preventDefault(); its[(i + 1) % its.length].focus(); }
            if (e.key === 'ArrowUp') { e.preventDefault(); its[(i - 1 + its.length) % its.length].focus(); }
            if (e.key === 'Escape') { menuOpen = false; ctx.rerender(['header']); setTimeout(() => el.querySelector('[data-fk=menu]')?.focus(), 0); }
          },
        }, items.map((it, i) => (it ? h('button', { class: 'menu-item', role: 'menuitem', type: 'button', 'data-fk': `m${i}`, disabled: !!it[3], onclick: tool(it[1], it[2]) }, ico(it[0]), h('span', {}, it[1])) : h('div', { class: 'menu-sep', role: 'separator' })))) : null)),
  ]);
}

function assistant(ctx, step) {
  const { S } = ctx;
  const busy = S.busy.size > 0 && [...S.busy].some((b) => /Sincronizz|Trascri|Importazione|Invio|Montaggio/.test(b));
  return h('div', { class: `assist${step.busy ? ' is-busy' : ''}`, role: 'region', 'aria-label': 'Prossimo passo', 'aria-live': 'polite' },
    h('ol', { class: 'phases', 'aria-label': `Fase ${step.phase + 1} di ${step.phases.length}` }, step.phases.map((p, i) => h('li', {
      class: `ph${i < step.phase ? ' done' : ''}${i === step.phase ? ' cur' : ''}`, title: p, 'aria-current': i === step.phase ? 'step' : null,
    }, h('span', { class: 'ph-dot' }, i < step.phase ? ico('check', 'ico ico-xs') : String(i + 1)), h('span', { class: 'ph-lbl' }, p)))),
    h('div', { class: 'assist-txt' },
      h('b', { class: 'assist-title' }, step.title),
      h('span', { class: 'assist-desc', title: step.text }, step.text)),
    h('div', { class: 'assist-act' },
      step.alt ? h('button', { class: 'btn btn-link', type: 'button', 'data-fk': 'assist-alt', onclick: () => ctx.doAction(step.alt.id) }, step.alt.label) : null,
      h('button', { class: 'btn btn-primary', type: 'button', 'data-fk': 'assist-go', disabled: busy, onclick: () => ctx.doAction(step.action.id) },
        step.busy ? h('span', { class: 'spin', 'aria-hidden': 'true' }) : null, step.action.label)));
}
