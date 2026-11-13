// Guida "Prima di iniziare": 5 passi, mostrata al primo avvio e richiamabile dal tasto ?.
import { h, store } from '../dom.js';
import { GUIDE_STEPS, GUIDE_KEY } from '../viewmodel/guide.js';

export function openGuide() {
  if (document.getElementById('guide')) return;
  const prev = document.activeElement;
  const close = () => { store.set(GUIDE_KEY, true); dlg.close(); dlg.remove(); prev?.focus?.(); };
  const dlg = h('dialog', { id: 'guide', class: 'dlg guide', 'aria-labelledby': 'guide-title' },
    h('h2', { id: 'guide-title' }, 'Prima di iniziare'),
    h('p', { class: 'dim' }, 'Cinque passi, in ordine. Il tasto ? in alto riapre questa guida.'),
    h('ol', { class: 'guide-steps' }, GUIDE_STEPS.map((s, i) => h('li', {},
      h('span', { class: 'gnum', 'aria-hidden': 'true' }, i + 1),
      h('div', {}, h('b', {}, s.title), h('p', {}, s.text))))),
    h('p', { class: 'hint' }, 'Limite di Resolve: non esiste la commutazione live degli angoli multicam. La “Regia” registra i tagli e li manda in timeline.'),
    h('div', { class: 'dlg-actions' }, h('button', { class: 'btn btn-primary', type: 'button', autofocus: true, onclick: close }, 'Ho capito')));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg);
  dlg.showModal();
}
