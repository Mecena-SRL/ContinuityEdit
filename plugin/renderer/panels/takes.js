// Colonna Clip/Take: bin di scena, elenco compatto dei take (stato, copertura, uso in timeline), azioni essenziali.
// In modalita' Avanzata: colore, inquadratura, gruppo, valutazione, rimozione.
import { h, renderInto, store } from '../dom.js';
import { ico } from '../icons.js';
import { modal } from './dialogs.js';
import { ratingLabel } from '../viewmodel/marks.js';
import { takeStats } from '../viewmodel/summary.js';
import { formatDuration } from '../viewmodel/format.js';
import { shotAbbr, shotLabel } from '../viewmodel/shots.js';
import { anglesForGroup } from '../viewmodel/groups.js';
import { setMasterFor } from './sequence.js';

const binSel = new Set(store.get('ce.bins', []));

/** Finestra "Bin di scena": elenco delle cartelle del Media Pool con spunta, carica le clip come take. */
export async function openBins(ctx) {
  const { ce, run, toast } = ctx;
  const list = h('div', { class: 'bin-list' }, h('p', { class: 'dim' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), ' Lettura del Media Pool…'));
  const { close } = modal({
    title: 'Bin di scena',
    body: h('div', { class: 'stack' }, h('p', { class: 'dim' }, 'Spunta i bin (cartelle del Media Pool) con le clip delle scene su cui lavori.'), list),
    actions: [
      { label: 'Annulla', onClick: (c) => c() },
      { label: 'Carica i bin', primary: true, onClick: async (c) => {
        const names = [...binSel];
        if (!names.length) { toast('Spunta almeno un bin.', 'warn'); return; }
        store.set('ce.bins', names);
        c();
        const r = await run('Caricamento bin', () => ce.loadBins(names));
        if (!r) return;
        ctx.noteClips(r);
        const off = r.filter((x) => !x.takeId);
        toast(`${r.length - off.length} clip caricate da ${names.length} ${names.length === 1 ? 'bin' : 'bin'}${off.length ? ` (${off.length} illeggibili: offline?)` : ''}.`, off.length ? 'warn' : 'ok');
        ctx.refreshStatus();
      } },
    ],
  });
  void close;
  const bins = await run('Elenco bin', () => ce.listBins());
  if (!bins) { list.replaceChildren(h('p', { class: 'warn-li' }, 'Media Pool non leggibile: c’è un progetto aperto in Resolve?')); return; }
  if (!bins.length) { list.replaceChildren(h('p', { class: 'dim' }, 'Nessun bin nel Media Pool. Crea una cartella per scena in Resolve, oppure usa "Usa le clip selezionate".')); return; }
  list.replaceChildren(h('ul', { class: 'bin-ul' }, bins.map((b) => h('li', {},
    h('label', { class: 'chk' }, h('input', {
      type: 'checkbox', checked: binSel.has(b.path) || binSel.has(b.name),
      onchange: (e) => { binSel.delete(b.name); if (e.target.checked) binSel.add(b.path); else binSel.delete(b.path); },
    }), ico('folder'), h('span', {}, b.path), h('span', { class: 'dim' }, ` ${b.clipCount} clip`))))));
}

export function renderTakes(el, ctx) {
  const { S, ce, run, toast } = ctx;
  const { view } = S.snap;
  const stats = takeStats(view);
  const adv = S.mode === 'advanced';

  async function remove(takeId) {
    const ok = await ctx.confirmDialog(`Togliere il take “${ctx.takeLabel(takeId)}” dal progetto? Le sue ancore e i suoi pezzi di montaggio spariscono (Ctrl+Z annulla). La clip in Resolve non viene toccata.`, { okLabel: 'Togli', danger: true });
    if (ok) await run('Rimozione take', () => ce.removeTake(takeId));
  }
  async function detect() {
    const found = await run('Raggruppa angoli', () => ce.detectGroupsByCoverage());
    if (!found) return;
    if (!found.length) { toast('Nessun gruppo di camere trovato (servono più angoli della stessa ripresa).', 'info'); return; }
    const txt = found.map((g) => `${g.label || g.groupId} (${g.takeIds.length} angoli)`).join('; ');
    if (!(await ctx.confirmDialog(`Trovati ${found.length} gruppi: ${txt}. Raggrupparli?`, { okLabel: 'Raggruppa' }))) return;
    await run('Raggruppa angoli', async () => { for (const g of found) for (const a of anglesForGroup(g.takeIds)) await ce.setTakeGroup(a.takeId, g.groupId, a.angle); });
    toast('Angoli raggruppati.', 'ok');
  }

  const byBin = new Map();
  for (const t of view.takes) { const k = t.bin || 'Clip'; if (!byBin.has(k)) byBin.set(k, []); byBin.get(k).push(t); }

  renderInto(el, () => [
    h('div', { class: 'panel-head' }, h('h2', {}, 'Clip'),
      h('div', { class: 'head-acts' },
        h('button', { class: 'icon-btn round', type: 'button', title: 'Bin di scena…', 'aria-label': 'Scegli i bin di scena', 'data-fk': 'bins', onclick: () => openBins(ctx) }, ico('folder')),
        h('button', { class: 'icon-btn round', type: 'button', title: 'Aggiungi le clip selezionate nel Media Pool', 'aria-label': 'Aggiungi le clip selezionate', 'data-fk': 'add-sel', onclick: () => ctx.addSelectedClips() }, ico('plus')),
        adv && view.takes.length > 1 ? h('button', { class: 'icon-btn round', type: 'button', title: 'Raggruppa gli angoli della stessa ripresa', 'aria-label': 'Raggruppa angoli', 'data-fk': 'detect', onclick: detect }, ico('link')) : null)),
    view.takes.length === 0
      ? h('div', { class: 'empty-card' }, ico('folder', 'ico ico-lg'), h('p', {}, 'Nessuna clip.'), h('p', { class: 'dim' }, 'Scegli i bin di scena del Media Pool.'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openBins(ctx) }, 'Scegli i bin…'))
      : [...byBin].map(([bin, list]) => h('section', { class: 'bin-sec' },
        byBin.size > 1 || bin !== 'Clip' ? h('h3', { class: 'bin-title' }, ico('folder', 'ico ico-xs'), bin, h('span', { class: 'dim' }, ` ${list.length}`)) : null,
        h('ul', { class: 'take-list', role: 'list' }, list.map((t) => takeCard(ctx, t, stats[t.id], { remove, adv }))))),
  ]);
}

function takeCard(ctx, t, st, { remove, adv }) {
  const { S } = ctx;
  const info = S.clips[t.clipId];
  const clip = S.snap.project?.clips?.[t.clipId];
  const running = S.transcribing.has(t.clipId);
  const done = !!info?.transcribed;
  const offline = info && info.online === false;
  const active = S.activeTakeId === t.id;
  const color = ctx.takeColor(t.id);
  const tk = S.d.allTakes?.find((x) => x.id === t.id) || t;
  const used = S.usage.usedTakes?.[t.id];
  const isMaster = S.d.seq?.master === t.id;
  const badge = offline ? ['Offline', 'bad', 'Clip non trovata nel Media Pool'] : running ? ['Trascrive…', 'run', 'Resolve sta trascrivendo'] : done ? ['Trascritta', 'ok', 'Parlato disponibile per sync e ricerca'] : info ? ['Muta / da trascrivere', 'dim', 'Nessuna trascrizione: sync con le ancore o "Sincronizza tutto"'] : null;
  const pct = st.syncable ? Math.min(100, Math.round((st.covered / st.syncable) * 100)) : 0;
  return h('li', {
    class: `take-card${active ? ' active' : ''}`, style: { '--c': color }, tabindex: '0', 'data-fk': `take-${t.id}`, 'aria-current': active ? 'true' : null,
    'aria-label': `${ctx.takeLabel(t.id)}, ${st.covered} righe su ${st.syncable}${used ? ', usato in timeline' : ''}`,
    onclick: (e) => { if (!e.target.closest('button, input, select')) { ctx.setActiveTake(t.id); ctx.player?.load(t.id, { keepTime: true }); } },
    onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { ctx.setActiveTake(t.id); ctx.player?.load(t.id, { keepTime: true }); } },
  },
  h('div', { class: 'take-top' },
    h('span', { class: 'take-dot', 'aria-hidden': 'true' }),
    h('b', { class: 'take-name', title: t.name }, ctx.takeLabel(t.id)),
    isMaster ? h('span', { class: 'chip chip-master', title: 'Master del montaggio (V1)' }, 'V1') : null,
    used ? h('span', { class: 'chip chip-used', title: 'Usato nella timeline corrente di Resolve' }, ico('timeline', 'ico ico-xs')) : null,
    h('button', { class: 'icon-btn take-play', type: 'button', title: 'Apri nel lettore', 'aria-label': `Apri ${ctx.takeLabel(t.id)} nel lettore`, onclick: () => { ctx.setActiveTake(t.id); ctx.player?.load(t.id, { play: true }); } }, ico('play'))),
  h('div', { class: 'take-meta dim' },
    tk.shot ? h('span', { class: `chip shot-chip st-${tk.shotSource === 'metadati' ? 'proposta' : 'confermato'}`, title: `${shotLabel(tk.shot)}${tk.shotSource ? ` (${tk.shotSource})` : ''}` }, shotAbbr(tk.shot)) : null,
    clip ? h('span', {}, `${formatDuration(clip.durationFrames, clip.fps)}${adv ? ` · ${clip.fps} fps` : ''}`) : null,
    badge ? h('span', { class: `badge badge-${badge[1]}`, title: badge[2] }, badge[0]) : null),
  h('div', { class: 'take-bar', role: 'img', 'aria-label': `Copertura ${pct}%`, title: `${st.covered} righe su ${st.syncable}${st.manual ? `, ${st.manual} a mano` : ''}` }, h('span', { style: { width: `${pct}%` } })),
  adv ? h('div', { class: 'take-adv' },
    h('input', { class: 'label-input', type: 'text', value: ctx.takeLabel(t.id), 'aria-label': 'Nome breve del take', 'data-fk': `lab-${t.id}`, onchange: (e) => ctx.run('Nome take', () => ctx.ce.setTakeLabel(t.id, e.target.value)) }),
    h('input', { class: 'color-input', type: 'color', value: color, 'aria-label': `Colore del take ${ctx.takeLabel(t.id)}`, 'data-fk': `col-${t.id}`, onchange: (e) => ctx.setTakeStyle(t.id, { color: e.target.value }) }),
    tk.groupId ? h('span', { class: 'chip' }, `${tk.angle || 'angolo'} · ${tk.groupId}`) : null,
    tk.rating ? h('span', { class: `chip ${tk.rating === 'buono' ? 'ok' : 'bad'}` }, ratingLabel(tk.rating)) : null,
    tk.grade ? h('span', { class: 'chip grade' }, tk.grade) : null,
    h('button', { class: 'btn btn-small', type: 'button', 'data-fk': `ms-${t.id}`, title: 'Usa come master: il take continuo su V1', onclick: () => setMasterFor(ctx, t.id) }, isMaster ? 'Master ✓' : 'Master'),
    h('button', { class: 'icon-btn', type: 'button', 'data-fk': `rm-${t.id}`, title: 'Togli dal progetto', 'aria-label': `Togli ${ctx.takeLabel(t.id)}`, onclick: () => remove(t.id) }, ico('trash'))) : null);
}
