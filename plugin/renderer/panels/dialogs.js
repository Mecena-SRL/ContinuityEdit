// Finestre modali: benvenuto, scorciatoie, diagnostica (copiabile), scrittura in Resolve.
import { h, store } from '../dom.js';
import { ico } from '../icons.js';
import { SHORTCUTS, cleanError } from '../viewmodel/messages.js';
import { GUIDE_STEPS, GUIDE_KEY } from '../viewmodel/guide.js';

/** Dialogo modale con titolo, corpo e pulsanti; Esc chiude, il focus torna dove era. Ritorna {dlg, close}. */
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const prev = document.activeElement;
  const dlg = h('dialog', { class: `dlg${wide ? ' dlg-wide' : ''}`, 'aria-labelledby': 'dlg-title' });
  const close = () => { if (!dlg.open) return; dlg.close(); dlg.remove(); onClose?.(); prev?.focus?.(); };
  dlg.append(
    h('div', { class: 'dlg-head' }, h('h2', { id: 'dlg-title' }, title),
      h('button', { class: 'icon-btn round', type: 'button', 'aria-label': 'Chiudi', onclick: close }, ico('close'))),
    h('div', { class: 'dlg-body' }, body),
    actions.length ? h('div', { class: 'dlg-actions' }, actions.map((a) => h('button', { class: `btn ${a.primary ? 'btn-primary' : ''}`, type: 'button', autofocus: a.primary || null, onclick: () => a.onClick(close) }, a.label))) : null);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, close };
}

export function openShortcuts() {
  if (document.getElementById('dlg-keys')) return;
  const { dlg } = modal({
    title: 'Scorciatoie da tastiera', wide: true,
    body: h('div', { class: 'keys-grid' }, SHORTCUTS.map(([group, rows]) => h('section', {},
      h('h3', {}, group),
      h('dl', { class: 'keys' }, rows.map(([k, d]) => [h('dt', {}, k.split(/\s{2,}/).map((x) => h('kbd', {}, x))), h('dd', {}, d)]))))),
    actions: [{ label: 'Chiudi', primary: true, onClick: (c) => c() }],
  });
  dlg.id = 'dlg-keys';
}

export function openWelcome() {
  modal({
    title: 'Come funziona ContinuityEdit',
    body: h('div', { class: 'welcome' },
      h('p', { class: 'lead' }, 'Lo script e le clip, collegati riga per riga. Il riquadro in alto ti dice sempre il prossimo passo.'),
      h('ol', { class: 'guide-steps' }, GUIDE_STEPS.map((s, i) => h('li', {}, h('span', { class: 'gnum', 'aria-hidden': 'true' }, i + 1), h('div', {}, h('b', {}, s.title), h('p', {}, s.text))))),
      h('p', { class: 'hint' }, 'Il lettore a destra sostituisce il visore sorgente: Spazio, J K L, I e O come in Resolve; M aggancia la riga mentre guardi. Il montaggio in basso diventa una timeline di Resolve con un clic.')),
    actions: [{ label: 'Iniziamo', primary: true, onClick: (c) => { store.set(GUIDE_KEY, true); c(); } }],
    onClose: () => store.set(GUIDE_KEY, true),
  });
}

export async function openDiagnostics(ctx) {
  const box = h('div', { class: 'diag' }, h('p', { class: 'dim' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), ' Prove in corso sulla API di Resolve (marker di prova, In/Out, una timeline temporanea poi eliminata)…'));
  const { close } = modal({
    title: 'Diagnostica della API di Resolve', wide: true, body: box,
    actions: [{ label: 'Chiudi', primary: true, onClick: (c) => c() }],
  });
  void close;
  let r;
  try { r = await ctx.ce.runDiagnostics(); } catch (e) { box.replaceChildren(h('p', { class: 'warn-li' }, cleanError(e))); return; }
  const rep = r.report || {};
  const steps = rep.steps || [];
  const json = JSON.stringify(rep, null, 2);
  box.replaceChildren(
    h('p', {}, r.ok ? 'Tutte le prove sono riuscite.' : `${steps.filter((s) => !s.ok).length} prove non riuscite su ${steps.length}: le funzioni collegate usano un ripiego.`,
      r.path ? h('span', { class: 'dim' }, ` Rapporto salvato in ${r.path}.`) : ''),
    h('p', { class: 'hint' }, 'Per collaudare tutto: seleziona una clip trascritta nel Media Pool e apri una timeline con qualche clip, poi rilancia. Mandaci il file JSON.'),
    h('ul', { class: 'diag-list' }, steps.map((s) => h('li', { class: s.ok ? 'ok' : 'bad' },
      h('span', { class: 'diag-ico' }, ico(s.ok ? 'check' : 'warn')),
      h('b', {}, s.name), s.help ? h('span', { class: 'dim' }, ` — ${s.help}`) : null,
      !s.ok ? h('div', { class: 'diag-why mono' }, String(s.detail?.reason || s.detail?.error || JSON.stringify(s.detail || {})).slice(0, 220)) : null))),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        try { await navigator.clipboard.writeText(json); ctx.toast('Rapporto copiato negli appunti.', 'ok'); } catch { ctx.toast('Copia non riuscita: usa il file sul Desktop.', 'warn'); }
      } }, ico('copy'), ' Copia il rapporto')));
}

export function openWriteToResolve(ctx) {
  const opt = { keywords: true, clipColor: false, flags: false };
  const chk = (k, label, hint) => h('label', { class: 'chk-row' }, h('input', { type: 'checkbox', checked: opt[k], onchange: (e) => { opt[k] = e.target.checked; } }), h('span', {}, h('b', {}, label), h('br'), h('span', { class: 'dim' }, hint)));
  modal({
    title: 'Scrivi le valutazioni nel Media Pool',
    body: h('div', { class: 'stack' },
      h('p', {}, 'Le valutazioni e le inquadrature dei take diventano visibili in Resolve e si possono filtrare con le Smart Bin. Nulla di tuo viene cancellato.'),
      chk('keywords', 'Parole chiave', 'Aggiunge "CE Buono", "CE B+", "CE Totale"…; toglie solo le vecchie parole "CE …".'),
      chk('clipColor', 'Colore della clip', 'Buono = verde, scarto = arancione; solo sulle clip che non hanno già un colore.'),
      chk('flags', 'Flag verde sui take buoni', 'Si aggiunge ai flag esistenti.')),
    actions: [
      { label: 'Annulla', onClick: (c) => c() },
      { label: 'Scrivi in Resolve', primary: true, onClick: async (c) => {
        c();
        const r = await ctx.run('Scrittura in Resolve', () => ctx.ce.writeToResolve(opt));
        if (!r) return;
        const skipped = r.results.filter((x) => !x.ok);
        ctx.toast(skipped.length ? `${r.count - skipped.length} clip aggiornate, ${skipped.length} in parte saltate (${Object.values(skipped[0].skipped || {})[0] || skipped[0].reason}).` : `${r.count} clip aggiornate nel Media Pool.`, skipped.length ? 'warn' : 'ok', 8000);
      } },
    ],
  });
}
