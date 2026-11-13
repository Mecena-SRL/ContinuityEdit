// Pannello Clip/Take: aggiunta clip selezionate, trascrizione, sync automatico, rimozione, colore/etichetta.
import { h, renderInto } from '../dom.js';
import { takeStats } from '../viewmodel/summary.js';
import { formatDuration } from '../viewmodel/format.js';

let pollTimer = null;

function startPolling(ctx) {
  if (pollTimer) return;
  const { S, ce } = ctx;
  pollTimer = setInterval(async () => {
    try {
      const st = await ce.getTranscribeStatus();
      if (st.jobStatus === 'InProgress') return;
      // Complete / Inactive / altro: il lavoro e' finito
      clearInterval(pollTimer); pollTimer = null;
      const n = S.transcribing.size;
      S.transcribing.clear();
      await ctx.refreshClips();
      ctx.toast(st.jobStatus === 'Complete' ? `Trascrizione completata (${n} clip).` : `Trascrizione terminata (stato: ${st.jobStatus}).`, st.jobStatus === 'Complete' ? 'ok' : 'warn');
      ctx.rerender(['takes', 'dock']);
    } catch (e) {
      clearInterval(pollTimer); pollTimer = null; S.transcribing.clear();
      ctx.toast(`Stato trascrizione: ${e.message}`, 'error'); ctx.rerender(['takes']);
    }
  }, 1500);
}

export function renderTakes(el, ctx) {
  const { S, ce, run, toast } = ctx;
  const { view } = S.snap;
  const stats = takeStats(view);

  async function addSelected() {
    await run('Aggiunta clip', async () => {
      const list = await ctx.refreshClips();
      const have = new Set(view.takes.map((t) => t.clipId));
      const fresh = list.filter((c) => !have.has(c.clipId));
      if (!list.length) { toast('Nessuna clip selezionata nel Media Pool.', 'warn'); return; }
      if (!fresh.length) { toast('Le clip selezionate sono già nel progetto.', 'info'); return; }
      let last = null;
      for (const c of fresh) last = (await ce.addTake({ clipId: c.clipId, label: undefined })).takeId;
      if (last) S.activeTakeId = last;
      toast(`${fresh.length} ${fresh.length === 1 ? 'take aggiunto' : 'take aggiunti'}.`, 'ok');
    });
  }

  async function transcribe(clipIds) {
    if (!clipIds.length) { toast('Nessuna clip da trascrivere.', 'info'); return; }
    const r = await run('Trascrizione', () => ce.transcribeClips(clipIds));
    if (!r) return;
    (r.started || []).forEach((id) => S.transcribing.add(id));
    if (!S.transcribing.size) { toast('Nessuna trascrizione avviata.', 'warn'); return; }
    toast('Trascrizione avviata. Può richiedere alcuni minuti.', 'info');
    ctx.rerender(['takes']);
    startPolling(ctx);
  }

  async function autoSync(takeId) {
    const r = await run('Sync automatico', () => ce.autoSync(takeId));
    if (r) toast(`Sync automatico: ${r.added} ancore aggiunte, ${Array.isArray(r.skipped) ? r.skipped.length : r.skipped ?? 0} scartate, ${r.unmatchedCount} frammenti parlati fuori script.`, 'ok', 7000);
  }

  async function remove(takeId) {
    const ok = await ctx.confirmDialog(`Rimuovere il take "${ctx.takeLabel(takeId)}" e le sue ancore?`, { okLabel: 'Rimuovi', danger: true });
    if (ok) await run('Rimozione take', () => ce.removeTake(takeId));
  }

  const untranscribed = view.takes.filter((t) => !(S.clips[t.clipId]?.transcribed) && !S.transcribing.has(t.clipId)).map((t) => t.clipId);

  renderInto(el, () => [
    h('div', { class: 'panel-head' }, h('h2', {}, 'Clip e take')),
    h('div', { class: 'panel-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', 'data-fk': 'add-clips', disabled: S.busy.has('Aggiunta clip'), onclick: addSelected }, 'Aggiungi clip selezionate'),
      view.takes.length ? h('button', { class: 'btn', type: 'button', 'data-fk': 'tr-all', disabled: !untranscribed.length, onclick: () => transcribe(untranscribed) }, `Trascrivi tutte (${untranscribed.length})`) : null),
    view.takes.length === 0
      ? h('p', { class: 'empty' }, 'Nessun take. Seleziona le clip nel Media Pool di Resolve e premi “Aggiungi clip selezionate”.')
      : h('ul', { class: 'take-list', role: 'list' }, view.takes.map((t) => takeCard(ctx, t, stats[t.id], { transcribe, autoSync, remove }))),
  ]);
}

function takeCard(ctx, t, st, act) {
  const { S } = ctx;
  const clip = S.snap.project?.clips?.[t.clipId];
  const info = S.clips[t.clipId];
  const running = S.transcribing.has(t.clipId);
  const done = !!info?.transcribed;
  const active = S.activeTakeId === t.id;
  const color = ctx.takeColor(t.id);
  const state = running ? ['In trascrizione…', 'run'] : done ? ['Trascritta', 'ok'] : info ? ['Non trascritta', 'warn'] : ['Stato sconosciuto', 'dim'];
  return h('li', { class: `take-card${active ? ' active' : ''}`, style: { '--c': color } },
    h('div', { class: 'take-top' },
      h('input', {
        class: 'color-input', type: 'color', value: color, 'aria-label': `Colore del take ${ctx.takeLabel(t.id)}`, 'data-fk': `col-${t.id}`,
        onchange: (e) => ctx.setTakeStyle(t.id, { color: e.target.value }),
      }),
      h('input', {
        class: 'label-input', type: 'text', value: ctx.takeLabel(t.id), 'aria-label': 'Etichetta del take', 'data-fk': `lab-${t.id}`,
        onchange: (e) => ctx.setTakeStyle(t.id, { label: e.target.value.trim() || undefined }),
      }),
      h('button', {
        class: `btn btn-small${active ? ' btn-on' : ''}`, type: 'button', 'aria-pressed': String(active), 'data-fk': `act-${t.id}`,
        onclick: () => ctx.setActiveTake(t.id),
      }, active ? 'Attivo' : 'Attiva')),
    h('div', { class: 'take-meta' },
      h('span', { class: 'dim', title: t.name }, t.name || t.clipId),
      clip ? h('span', { class: 'dim' }, ` · ${formatDuration(clip.durationFrames, clip.fps)} · ${clip.fps} fps`) : null),
    h('div', { class: 'take-stats' },
      h('span', { title: 'Righe coperte / sincronizzabili' }, `${st.covered}/${st.syncable} righe`),
      st.manual ? h('span', { class: 'dim' }, ` · ${st.manual} manuali`) : null,
      st.estimated ? h('span', { class: 'dim' }, ` · ${st.estimated} stimate`) : null),
    h('div', { class: 'take-bar', role: 'img', 'aria-label': `Copertura ${st.covered} su ${st.syncable}` },
      h('span', { style: { width: `${st.syncable ? Math.min(100, (st.covered / st.syncable) * 100) : 0}%` } })),
    h('div', { class: 'take-actions' },
      h('span', { class: `badge badge-${state[1]}` }, state[0]),
      !done ? h('button', { class: 'btn btn-small', type: 'button', 'data-fk': `tr-${t.id}`, disabled: running, onclick: () => act.transcribe([t.clipId]) }, 'Trascrivi') : null,
      h('button', {
        class: 'btn btn-small', type: 'button', 'data-fk': `as-${t.id}`, disabled: !done || S.busy.has('Sync automatico'),
        title: done ? 'Allinea le battute alla trascrizione' : 'Serve prima la trascrizione', onclick: () => act.autoSync(t.id),
      }, 'Sync automatico'),
      h('button', { class: 'btn btn-small btn-ghost-danger', type: 'button', 'data-fk': `rm-${t.id}`, 'aria-label': `Rimuovi ${ctx.takeLabel(t.id)}`, onclick: () => act.remove(t.id) }, 'Rimuovi')));
}
