// "Sincronizza tutto": trascrive in Resolve le clip che non lo sono, aspetta la fine, poi allinea ogni take allo
// script. Avanzamento chiaro in una scheda (non modale) e annullabile: si smette di aspettare e di allineare
// (la trascrizione gia' avviata in Resolve prosegue da sola: la API non offre un modo per fermarla).
import { h, renderInto } from '../dom.js';
import { ico } from '../icons.js';
import { cleanError } from '../viewmodel/messages.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runSyncAll(ctx, { alignAfter = true } = {}) {
  const { S, ce } = ctx;
  if (S.syncAll?.running) { S.syncAll.hidden = false; ctx.rerender(['sync']); return; }
  const job = { running: true, hidden: false, cancelled: false, phase: 'Preparo…', done: 0, total: 0, log: [], errors: [] };
  S.syncAll = job;
  const upd = () => ctx.rerender(['sync', 'header', 'takes']);
  upd();
  try {
    let status = [];
    try { status = await ce.takeStatus(); ctx.noteClips(status); } catch { /* si prosegue */ }
    const todo = status.filter((s) => s.online && !s.transcribed);
    if (todo.length && !job.cancelled) {
      job.phase = `Trascrizione in Resolve di ${todo.length} ${todo.length === 1 ? 'clip' : 'clip'}`;
      job.total = todo.length; job.done = 0; upd();
      const r = await ce.transcribeClips(todo.map((s) => s.clipId));
      for (const f of r.failed || []) job.errors.push(`${clipName(ctx, f.clipId)}: ${f.reason}`);
      r.started.forEach((id) => S.transcribing.add(id)); upd();
      const t0 = Date.now();
      while (!job.cancelled && S.transcribing.size) {
        await wait(2000);
        const st = await ce.getTranscribeStatus();
        for (const id of st.done || []) if (S.transcribing.delete(id)) ctx.noteClips([{ clipId: id, transcribed: true }]);
        job.done = job.total - S.transcribing.size;
        job.phase = `Trascrizione in Resolve: ${job.done} di ${job.total}${Date.now() - t0 > 60000 ? ' (le clip lunghe richiedono qualche minuto)' : ''}`;
        upd();
        if (st.jobStatus !== 'InProgress') {
          for (const id of st.pending || []) job.errors.push(`${clipName(ctx, id)}: nessun parlato riconosciuto (clip muta?)`);
          if (!['Complete', 'Inactive'].includes(st.jobStatus)) job.errors.push(`Resolve: trascrizione ${st.jobStatus}`);
          S.transcribing.clear();
        }
      }
      if (job.cancelled) S.transcribing.clear();
      await ctx.refreshStatus();
    }
    const hasDialogue = S.snap.view.lines.some((l) => l.type === 'dialogue');
    if (alignAfter && hasDialogue && !job.cancelled) {
      const takes = S.snap.view.takes.filter((t) => S.clips[t.clipId]?.transcribed);
      job.total = takes.length; job.done = 0;
      let lines = 0;
      for (const t of takes) {
        if (job.cancelled) break;
        job.phase = `Allineo “${ctx.takeLabel(t.id)}” allo script (${job.done + 1} di ${takes.length})`; upd();
        try { const r = await ce.autoSync(t.id); lines += Math.round((r.added || 0) / 2); } catch (e) { job.errors.push(`${ctx.takeLabel(t.id)}: ${cleanError(e)}`); }
        S.aligned.add(t.id);
        job.done++;
      }
      job.result = `${lines} righe agganciate in ${takes.length} ${takes.length === 1 ? 'take' : 'take'}.`;
    } else if (!hasDialogue && alignAfter) job.result = 'Lo script non ha battute: le azioni si agganciano guardando (tasto M nel lettore).';
    else job.result = 'Trascrizioni pronte.';
    if (job.cancelled) job.result = 'Interrotto. Quello già fatto resta.';
  } catch (e) {
    job.errors.push(cleanError(e));
    job.result = 'Non completato.';
  } finally {
    job.running = false; job.phase = 'Fatto';
    upd();
    ctx.toast(`Sincronizza tutto: ${job.result}${job.errors.length ? ` ${job.errors.length} avvisi.` : ''}`, job.errors.length ? 'warn' : 'ok', 8000);
    if (!job.errors.length) setTimeout(() => { if (S.syncAll === job) { S.syncAll = null; ctx.rerender(['sync']); } }, 4000);
  }
}

const clipName = (ctx, clipId) => ctx.S.snap.project?.clips?.[clipId]?.name || clipId;

let card = null;
export function renderSyncAll(ctx) {
  const job = ctx.S.syncAll;
  if (!job || job.hidden) { card?.remove(); card = null; return; }
  if (!card) { card = h('div', { class: 'sync-card', role: 'status', 'aria-live': 'polite' }); document.body.append(card); }
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
  renderInto(card, () => [
    h('div', { class: 'sync-head' }, ico(job.running ? 'sync' : 'check', `ico${job.running ? ' spin-ico' : ''}`), h('b', {}, job.running ? 'Sincronizza tutto' : 'Sincronizzazione finita'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Nascondi', title: 'Nascondi (continua in background)', onclick: () => { job.hidden = true; renderSyncAll(ctx); } }, ico('close'))),
    h('p', { class: 'sync-phase' }, job.running ? job.phase : job.result),
    job.running ? h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('span', { style: { width: `${Math.max(4, pct)}%` } })) : null,
    job.errors.length ? h('ul', { class: 'plain sync-errs' }, job.errors.slice(0, 5).map((e) => h('li', { class: 'warn-li' }, e))) : null,
    job.running ? h('div', { class: 'btn-row end' }, h('button', { class: 'btn btn-small', type: 'button', onclick: () => { job.cancelled = true; job.phase = 'Interrompo dopo il passo in corso…'; renderSyncAll(ctx); } }, 'Interrompi'))
      : h('div', { class: 'btn-row end' }, h('button', { class: 'btn btn-small', type: 'button', onclick: () => { ctx.S.syncAll = null; renderSyncAll(ctx); } }, 'Chiudi')),
  ]);
}
