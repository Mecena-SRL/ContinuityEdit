// Browser: elenco take/clip dei bin caricati con valutazione rapida (Buono/Scarto, B/B+/B++), tag e note; anche per singola riga.
import { h } from '../dom.js';
import { shotAbbr } from '../viewmodel/shots.js';
import { gradePalette, patchFromKey, parseTags, markFor, ratingLabel, toggleRating, toggleGrade } from '../viewmodel/marks.js';

export function browserTab(ctx) {
  const { S, ce, run } = ctx;
  const proj = S.snap.project;
  const pal = gradePalette(proj);
  const takes = S.d.takes; // gia' filtrati da rating/voto nella barra
  const hidden = S.d.allTakes.length - takes.length;
  const notes = proj.notes || {};

  const setMark = (takeId, lineId, patch) => run('Valutazione', () => ce.setMark({ takeId, lineId: lineId || null, ...patch }));

  const controls = (cur, takeId, lineId, fk) => h('div', { class: 'rate' },
    h('button', { class: `btn btn-small r-good${cur.rating === 'buono' ? ' on' : ''}`, type: 'button', 'aria-pressed': String(cur.rating === 'buono'), 'data-fk': `${fk}-g`, onclick: () => setMark(takeId, lineId, { rating: toggleRating(cur.rating || null, 'buono') }) }, 'Buono'),
    h('button', { class: `btn btn-small r-bad${cur.rating === 'scarto' ? ' on' : ''}`, type: 'button', 'aria-pressed': String(cur.rating === 'scarto'), 'data-fk': `${fk}-s`, onclick: () => setMark(takeId, lineId, { rating: toggleRating(cur.rating || null, 'scarto') }) }, 'Scarto'),
    pal.map((g, i) => h('button', { class: `btn btn-small r-grade${cur.grade === g ? ' on' : ''}`, type: 'button', 'aria-pressed': String(cur.grade === g), title: `Tasto ${i + 1}`, 'data-fk': `${fk}-${g}`, onclick: () => setMark(takeId, lineId, { grade: toggleGrade(cur.grade || '', g) }) }, g)));

  const tagsInput = (cur, takeId, lineId, fk) => h('input', {
    class: 'input tag-in', type: 'text', placeholder: 'tag, separati da virgola', value: (cur.tags || []).join(', '), 'aria-label': 'Tag', 'data-fk': `${fk}-t`,
    onchange: (e) => setMark(takeId, lineId, { tags: parseTags(e.target.value) }),
  });
  const noteInput = (key, fk) => h('input', {
    class: 'input note-in', type: 'text', placeholder: 'nota', value: notes[key] || '', 'aria-label': 'Nota', 'data-fk': `${fk}-n`,
    onchange: (e) => { if ((notes[key] || '') !== e.target.value) run('Nota', () => ce.setNote(key, e.target.value)); },
  });

  const onKey = (takeId, lineId) => (e) => {
    if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    const cur = lineId ? markFor(proj, takeId, lineId) : (S.d.allTakes.find((t) => t.id === takeId) || {});
    const patch = patchFromKey(e.key, cur, pal);
    if (patch) { e.preventDefault(); setMark(takeId, lineId, patch); }
  };

  const byBin = new Map();
  for (const t of takes) { const k = t.bin || 'Senza bin'; if (!byBin.has(k)) byBin.set(k, []); byBin.get(k).push(t); }

  const line = S.focusId ? S.d.byId.get(S.focusId) : null;
  const at = S.activeTakeId;
  return h('div', { class: 'browser' },
    h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary btn-small', type: 'button', 'data-fk': 'br-scan', title: 'Foglio di contatto per classificare le inquadrature', onclick: () => ctx.openScan() }, 'Scansiona clip')),
    h('p', { class: 'hint' }, `Seleziona un take e usa i tasti: 1-${pal.length} voto (${pal.join(', ')}), B buono, X scarto, 0 azzera.${hidden ? ` ${hidden} take nascosti dai filtri della barra.` : ''}`),
    takes.length === 0 ? h('p', { class: 'empty' }, 'Nessun take da mostrare. Carica un bin di scena o cambia i filtri.')
      : [...byBin].map(([bin, list]) => h('section', { class: 'bin-sec' },
        h('h4', {}, bin, ' ', h('span', { class: 'dim' }, `(${list.length})`)),
        h('ul', { class: 'brow-list' }, list.map((t) => h('li', {
          class: `brow${t.id === at ? ' on' : ''}`, tabindex: '0', 'data-fk': `br-${t.id}`, style: { '--c': ctx.takeColor(t.id) },
          'aria-label': `${ctx.takeLabel(t.id)}: ${ratingLabel(t.rating)}${t.grade ? `, voto ${t.grade}` : ''}`,
          onfocus: () => { if (S.activeTakeId !== t.id) ctx.setActiveTake(t.id); },
          onclick: (e) => { if (!e.target.closest('button,input')) ctx.setActiveTake(t.id); },
          onkeydown: onKey(t.id, null),
        },
        h('div', { class: 'brow-head' }, h('i', { class: 'dotc' }), h('b', {}, ctx.takeLabel(t.id)),
          t.shot ? h('span', { class: 'chip shot-chip st-confermato', title: 'Inquadratura' }, shotAbbr(t.shot)) : null,
          h('span', { class: 'dim' }, [t.meta?.scene && `Sc ${t.meta.scene}`, t.meta?.shot, t.meta?.take && `Tk ${t.meta.take}`, t.angle].filter(Boolean).join(' · ')),
          h('button', { class: 'btn btn-small', type: 'button', 'data-fk': `br-m-${t.id}`, title: 'Usa questo take come master su V1', onclick: () => import('./sequence.js').then((m) => m.setMasterFor(ctx, t.id)) }, 'Master')),
        controls(t, t.id, null, `r-${t.id}`),
        h('div', { class: 'btn-row' }, tagsInput(t, t.id, null, `r-${t.id}`), noteInput(t.id, `r-${t.id}`))))))),
    line && line.syncable && at ? h('section', { class: 'bin-sec line-mark' },
      h('h4', {}, 'Solo per questa riga'),
      h('p', { class: 'dim', title: line.text }, `“${line.text.slice(0, 60)}” con ${ctx.takeLabel(at)}`),
      h('div', { tabindex: '0', 'data-fk': 'lm', onkeydown: onKey(at, line.id) },
        controls(markFor(proj, at, line.id), at, line.id, 'lm'),
        h('div', { class: 'btn-row' }, tagsInput(markFor(proj, at, line.id), at, line.id, 'lm'), noteInput(`${at}|${line.id}`, 'lm')))) : null);
}
