// Lettore integrato: sostituisce il visore sorgente di Resolve (che la API non pilota).
// - Sorgente: un take (video+audio da ce-media://), JKL, Spazio, frame a frame, In/Out, ancore col tasto M/N,
//   karaoke sullo script (parole gia' dette evidenziate) e striscia del parlato trascritto.
// - Sequenza: anteprima del montaggio (V1 con audio + cutaway V2/V3 sovrapposti, solo video) con un orologio virtuale
//   che corregge i due <video> sui pezzi giusti.
// I <video> restano vivi tra un render e l'altro: qui si aggiornano solo le parti che cambiano.
import { h, renderInto } from '../dom.js';
import { ico } from '../icons.js';
import { framesToTimecode } from '../viewmodel/format.js';
import {
  frameAt, timeOfFrame, rateAfterKey, rateLabel, wordIndexAt, coverageAt, splitWords, karaoke, markRange, sequenceAt, mediaErrorText,
} from '../viewmodel/player.js';
import { cleanError } from '../viewmodel/messages.js';

export function createPlayer(root, ctx) {
  const { S, ce } = ctx;
  const P = {
    mode: 'take', takeId: null, frame: 0, playing: false, rate: 0, marks: {}, // takeId -> {in,out}
    seqRec: 0, err: null, media: new Map(), words: new Map(), lastLine: null, raf: 0, lastT: 0, srcA: null, srcB: null,
  };
  S.edPlayhead = S.edPlayhead || 0;

  // ---- DOM fisso
  const vA = h('video', { class: 'pl-video', playsinline: true, preload: 'auto', crossorigin: 'anonymous' });
  const vB = h('video', { class: 'pl-video pl-over', playsinline: true, preload: 'auto', crossorigin: 'anonymous', muted: true });
  vB.muted = true;
  const msg = h('div', { class: 'pl-msg', role: 'status' });
  const badge = h('div', { class: 'pl-badge' });
  const rateEl = h('div', { class: 'pl-rate' });
  const screen = h('div', { class: 'pl-screen', onclick: () => toggle() }, vA, vB, badge, rateEl, msg);
  const head = h('div', { class: 'pl-head' });
  const tcEl = h('div', { class: 'pl-tc mono', 'aria-live': 'off' });
  const scrub = h('div', { class: 'pl-scrub', role: 'slider', tabindex: '0', 'aria-label': 'Posizione nel take', 'aria-valuemin': '0' });
  const kara = h('div', { class: 'pl-kara', 'aria-live': 'off' });
  const ctrl = h('div', { class: 'pl-ctrl' });
  root.replaceChildren(head, screen, h('div', { class: 'pl-bar' }, tcEl, scrub), kara, ctrl);

  vA.addEventListener('error', () => onMediaError(vA));
  vA.addEventListener('loadedmetadata', () => {
    if (P.mode !== 'take') return;
    P.err = null; msg.classList.remove('on');
    const f = P.pending ?? P.frame; P.pending = null;
    seekFrame(f);
    // Contenitore leggibile ma video non decodificabile (es. ProRes in .mov): Chromium suona solo l'audio.
    if (!vA.videoWidth) {
      const m = P.media.get(P.takeId);
      if (m && m.ok && !m.triedProxy && m.proxyUrl) { m.triedProxy = true; setSource(vA, P.takeId); return; }
      showError(`Solo audio: ${mediaErrorText({ codec: m?.codec, hasProxy: !!m?.proxyUrl, triedProxy: !!m?.triedProxy }).replace(/^Il pannello non riproduce questo formato/, 'il video di questa clip non si decodifica nel pannello')}`, true, true);
    }
  });
  vA.addEventListener('ended', () => { if (P.mode === 'take') pause(); });
  vB.addEventListener('error', () => { if (P.mode === 'seq') badge.textContent = 'cutaway non riproducibile'; });

  // ---- sorgenti
  const take = () => ctx.take(P.takeId);
  const fps = () => ctx.fpsOf(P.takeId) || 25;
  const dur = () => ctx.clipOf(P.takeId)?.durationFrames || 1;

  async function mediaFor(takeId) {
    if (P.media.has(takeId)) return P.media.get(takeId);
    let m;
    try { m = await ce.getClipMediaPath(takeId); } catch (e) { m = { ok: false, reason: cleanError(e) }; }
    m = m && m.ok !== false ? { ...m, ok: true, triedProxy: false } : { ok: false, reason: m?.reason || 'file non disponibile' };
    P.media.set(takeId, m);
    return m;
  }
  async function setSource(video, takeId, which = 'A') {
    const m = await mediaFor(takeId);
    const key = `${takeId}|${m.triedProxy ? 'p' : 'o'}`;
    if ((which === 'A' ? P.srcA : P.srcB) === key && video.getAttribute('src')) return m.ok;
    if (which === 'A') P.srcA = key; else P.srcB = key;
    if (!m.ok) { video.removeAttribute('src'); video.load(); if (which === 'A') showError(m.reason); return false; }
    const url = m.triedProxy ? m.proxyUrl : m.url;
    if (!url) { video.removeAttribute('src'); video.load(); if (which === 'A') showError(mediaErrorText({ codec: m.codec, hasProxy: false })); return false; }
    video.src = url;
    return true;
  }
  async function onMediaError(video) {
    const id = P.mode === 'take' ? P.takeId : P.seqMasterTake;
    const m = id ? P.media.get(id) : null;
    if (m && m.ok && !m.triedProxy && m.proxyUrl) {
      m.triedProxy = true; showError(mediaErrorText({ codec: m.codec, hasProxy: true }), false);
      await setSource(video, id); return;
    }
    if (m) { m.failed = true; showError(mediaErrorText({ codec: m.codec, hasProxy: !!m.proxyUrl, triedProxy: m.triedProxy })); }
    pause();
  }
  // audioOnly: il messaggio resta sopra un'immagine nera ma l'audio suona (si puo' sincronizzare a orecchio).
  function showError(text, sticky = true, audioOnly = false) {
    P.err = sticky ? text : null;
    renderInto(msg, () => (text ? [h('p', {}, ico(audioOnly ? 'wave' : 'warn'), ' ', text),
      sticky && P.takeId ? h('button', { class: 'btn btn-small', type: 'button', onclick: (e) => { e.stopPropagation(); reveal(); } }, ico('resolve'), ' Mostra in Resolve') : null] : []));
    msg.classList.toggle('on', !!text);
    msg.classList.toggle('soft', audioOnly);
  }

  // ---- trasporto
  function seekFrame(f) {
    P.frame = Math.max(0, Math.min(dur() - 1, Math.round(f)));
    if (vA.readyState >= 1) { try { vA.currentTime = timeOfFrame(P.frame, fps()); } catch { /* non ancora seekable */ } } else P.pending = P.frame; // si applica a loadedmetadata
    paint();
  }
  function play(rate = 1) {
    P.rate = rate; P.playing = true;
    if (P.mode === 'take') {
      if (rate > 0) { vA.playbackRate = rate; vA.play().catch(() => {}); } else vA.pause();
    } else seqPlay();
    loop(); render();
  }
  function pause() {
    P.playing = false; P.rate = 0; vA.pause(); vB.pause();
    cancelAnimationFrame(P.raf); P.raf = 0;
    if (P.mode === 'take') P.frame = frameAt(vA.currentTime || 0, fps());
    paint(); render();
  }
  const toggle = () => (P.playing ? pause() : play(1));
  function jkl(key) {
    const r = rateAfterKey(P.playing ? P.rate : 0, key);
    if (r === 0) pause(); else play(r);
  }
  function step(n) { if (P.playing) pause(); if (P.mode === 'seq') { seqSeek(P.seqRec + n); return; } seekFrame(P.frame + n); }

  function loop() {
    if (P.raf) return;
    P.lastT = performance.now();
    const tick = (now) => {
      const dt = (now - P.lastT) / 1000; P.lastT = now;
      if (!P.playing) { P.raf = 0; return; }
      if (P.mode === 'take') {
        if (P.rate < 0) { // indietro: il <video> non supporta velocita' negative, si sposta il tempo a mano
          const t = Math.max(0, vA.currentTime + P.rate * dt);
          vA.currentTime = t; if (t <= 0) { pause(); return; }
        }
        if (P.pending == null && vA.readyState >= 1 && !vA.seeking) P.frame = frameAt(vA.currentTime, fps());
      } else seqTick(dt);
      paint();
      P.raf = requestAnimationFrame(tick);
    };
    P.raf = requestAnimationFrame(tick);
  }

  // ---- sequenza
  const layout = () => S.snap.view.sequence || { items: [], total: 0 };
  const tlFps = () => layout().timelineFps || S.env?.timelineFps || 25;
  const clipFps = (clipId) => S.snap.project?.clips?.[clipId]?.fps || null;
  async function seqSync(force = false) {
    const at = sequenceAt(layout(), P.seqRec, { fpsOf: clipFps, timelineFps: tlFps() });
    const sync1 = async (video, part, which) => {
      if (!part) { video.classList.add('hide'); video.pause(); return; }
      video.classList.remove('hide');
      const ok = await setSource(video, part.takeId, which);
      if (!ok) return;
      const f = ctx.fpsOf(part.takeId) || 25;
      const want = timeOfFrame(part.srcFrame, f);
      if (video.readyState >= 1 && (force || Math.abs(video.currentTime - want) > 3 / f)) { try { video.currentTime = want; } catch { /* */ } }
      if (P.playing && video.paused) video.play().catch(() => {});
      if (!P.playing && !video.paused) video.pause();
    };
    P.seqMasterTake = at.master?.takeId || null;
    await sync1(vA, at.master, 'A');
    await sync1(vB, at.overlay, 'B');
    vA.muted = !at.master;
    badge.textContent = at.overlay ? `V${at.overlay.track} · ${ctx.takeLabel(at.overlay.takeId)}` : at.master ? `V1 · ${ctx.takeLabel(at.master.takeId)}` : 'vuoto';
    P.seqAt = at;
  }
  let lastKey = '';
  function seqTick(dt) {
    P.seqRec += dt * tlFps();
    if (P.seqRec >= layout().total) { P.seqRec = layout().total; pause(); return; }
    const at = sequenceAt(layout(), Math.floor(P.seqRec), { fpsOf: clipFps, timelineFps: tlFps() });
    const key = `${at.master?.id}|${at.overlay?.id}`;
    if (key !== lastKey) { lastKey = key; seqSync(true); } else if (Math.random() < 0.08) seqSync(false); // correzione leggera della deriva
    S.edPlayhead = Math.floor(P.seqRec);
    ctx.editorPlayhead?.(S.edPlayhead);
  }
  function seqPlay() { vA.playbackRate = 1; vB.playbackRate = 1; lastKey = ''; seqSync(true); }
  function seqSeek(rec) {
    P.seqRec = Math.max(0, Math.min(layout().total, Math.round(rec)));
    S.edPlayhead = P.seqRec; ctx.editorPlayhead?.(S.edPlayhead);
    lastKey = ''; seqSync(true); paint();
  }

  // ---- disegno per frame (economico)
  function paint() {
    if (P.mode === 'seq') {
      tcEl.textContent = framesToTimecode(Math.floor(P.seqRec), tlFps());
      const tot = Math.max(1, layout().total);
      scrub.style.setProperty('--ph', `${(P.seqRec / tot) * 100}%`);
      scrub.setAttribute('aria-valuenow', String(Math.floor(P.seqRec)));
      kara.textContent = '';
      return;
    }
    const clip = ctx.clipOf(P.takeId);
    tcEl.textContent = P.takeId ? framesToTimecode(P.frame, fps(), clip?.startTcFrames || 0) : '--:--:--:--';
    scrub.style.setProperty('--ph', `${(P.frame / Math.max(1, dur())) * 100}%`);
    scrub.setAttribute('aria-valuenow', String(P.frame));
    if (!P.takeId) return;
    const cov = coverageAt(S.snap.view.coverage?.[P.takeId], P.frame);
    const lineId = cov?.lineId || null;
    paintKaraoke(lineId, cov);
    paintWords();
  }
  // evidenzia la riga che sta suonando e, dentro, le parole gia' dette
  function paintKaraoke(lineId, cov) {
    if (lineId !== P.lastLine) {
      document.querySelectorAll('.line-row.playing').forEach((r) => { r.classList.remove('playing'); unspan(r); });
      P.lastLine = lineId;
      if (lineId) {
        const row = document.querySelector(`[data-line="${CSS.escape(lineId)}"]`);
        if (row) { row.classList.add('playing'); if (P.playing) row.scrollIntoView({ block: 'nearest' }); }
      }
    }
    if (!lineId) return;
    const row = document.querySelector(`[data-line="${CSS.escape(lineId)}"]`);
    if (!row) return;
    row.classList.add('playing');
    const line = S.d.byId?.get(lineId);
    const textEl = row.querySelector('.dlg-text, .txt');
    if (!textEl || !line) return;
    if (!textEl.dataset.kara) {
      textEl.dataset.kara = '1';
      textEl.replaceChildren(...splitWords(line.text).map((w) => (/\S/.test(w) ? h('span', { class: 'kw' }, w) : document.createTextNode(w))));
    }
    const k = karaoke(line.text, cov, P.words.get(P.takeId), P.frame);
    textEl.querySelectorAll('.kw').forEach((s, i) => s.classList.toggle('said', i < k.spoken));
  }
  function unspan(row) {
    const t = row.querySelector('[data-kara]');
    if (t) { delete t.dataset.kara; const line = S.d.byId?.get(row.dataset.line); if (line) t.textContent = line.text; }
  }
  // striscia del parlato trascritto (anche senza script)
  function paintWords() {
    const words = P.words.get(P.takeId);
    if (!words || !words.length) { if (kara.dataset.state !== 'none') { kara.dataset.state = 'none'; kara.textContent = P.takeId && S.clips[take()?.clipId]?.transcribed === false ? 'Clip non trascritta: il karaoke usa i tempi delle ancore.' : ''; } return; }
    const i = wordIndexAt(words, P.frame);
    const from = Math.max(0, i - 6); const to = Math.min(words.length, Math.max(i, 0) + 10);
    const key = `${from}|${i}`;
    if (kara.dataset.state === key) return;
    kara.dataset.state = key;
    kara.replaceChildren(...words.slice(from, to).map((w, k) => {
      const idx = from + k;
      return h('span', { class: `tw${idx === i && P.frame < w.endFrame + 6 ? ' cur' : idx < i ? ' past' : ''}`, onclick: () => seekFrame(w.startFrame) }, w.text, ' ');
    }));
  }

  // ---- API
  async function load(takeId, { frame, play: autoplay = false, keepTime = false } = {}) {
    if (!takeId) return;
    const wasMode = P.mode;
    P.mode = 'take';
    vB.classList.add('hide'); vB.pause();
    if (P.takeId !== takeId || wasMode !== 'take') {
      pause();
      if (!(keepTime && P.takeId === takeId)) P.frame = 0;
      P.takeId = takeId; P.lastLine = null; kara.dataset.state = '';
      showError('');
      await setSource(vA, takeId, 'A');
      vA.muted = false;
      ce.getTranscript({ takeId }).then((r) => { if (r?.ok) { P.words.set(takeId, r.words); paint(); } }).catch(() => {});
    }
    if (Number.isFinite(frame)) seekFrame(frame); else paint();
    render();
    if (autoplay) play(1);
  }
  function playLine(lineId, takeId) {
    const c = ctx.coverageOf(takeId, lineId);
    load(takeId, { frame: c ? c.startFrame : 0, play: true });
  }
  function playSequence(rec = S.edPlayhead || 0) {
    if (!layout().items.length) { ctx.toast('Il montaggio è vuoto.', 'info'); return; }
    pause(); P.mode = 'seq'; showError(''); P.srcA = null; P.srcB = null;
    document.querySelectorAll('.line-row.playing').forEach((r) => { r.classList.remove('playing'); unspan(r); });
    P.lastLine = null;
    seqSeek(rec); render(); play(1);
  }
  function unload() { pause(); P.takeId = null; P.media.clear(); P.words.clear(); vA.removeAttribute('src'); vA.load(); P.srcA = null; render(); }

  // ---- azioni sul take
  const curLine = () => S.focusId && S.d.byId?.get(S.focusId);
  async function anchorHere(edge) {
    const line = curLine();
    if (!P.takeId) { ctx.toast('Apri un take nel lettore.', 'info'); return; }
    if (!line || !line.syncable) { ctx.toast('Seleziona nello script la riga (azione o battuta) da agganciare.', 'info'); return; }
    const f = P.mode === 'take' ? (P.playing ? frameAt(vA.currentTime, fps()) : P.frame) : null;
    if (f == null) return;
    const r = await ctx.run('Ancora', () => ce.addAnchor({ takeId: P.takeId, lineId: line.id, edge, frame: f }));
    if (!r) return;
    flash(`${edge === 'start' ? 'Inizio' : 'Fine'} riga · ${framesToTimecode(f, fps(), ctx.clipOf(P.takeId)?.startTcFrames || 0)}`);
    if (edge === 'start') { // passa alla riga sincronizzabile successiva: si continua a "battere" M guardando
      const vis = S.d.visible; const i = vis.findIndex((l) => l.id === line.id);
      const next = vis.slice(i + 1).find((l) => l.syncable);
      if (next) { ctx.selectIds([next.id]); ctx.scrollToLine(next.id); }
    }
  }
  function mark(which) {
    if (!P.takeId || P.mode !== 'take') return;
    const m = P.marks[P.takeId] || (P.marks[P.takeId] = {});
    m[which] = P.playing ? frameAt(vA.currentTime, fps()) : P.frame;
    render();
  }
  async function marksToLine() {
    const line = curLine(); const r = markRange(P.marks[P.takeId]?.in, P.marks[P.takeId]?.out, dur());
    if (!line || !r) return;
    await ctx.run('Ancore', async () => {
      await ce.addAnchor({ takeId: P.takeId, lineId: line.id, edge: 'start', frame: r.startFrame });
      await ce.addAnchor({ takeId: P.takeId, lineId: line.id, edge: 'end', frame: r.endFrame });
    });
    flash('Copertura della riga = In/Out');
  }
  async function toSequence(track) {
    const r = markRange(P.marks[P.takeId]?.in, P.marks[P.takeId]?.out, dur());
    if (!r) { ctx.toast('Segna prima In e Out (tasti I e O).', 'info'); return; }
    const res = await ctx.run('Montaggio', () => ce.sequence.place({ takeId: P.takeId, ...r, track, recordFrame: S.edPlayhead || 0, mode: track === 1 ? 'insert' : 'overwrite' }));
    if (res) { ctx.toggleEditor(true); flash(track === 1 ? 'Inserito su V1' : `Sovrascritto su V${track}`); }
  }
  async function still() {
    if (!P.takeId || P.mode !== 'take') return;
    const f = P.playing ? frameAt(vA.currentTime, fps()) : P.frame;
    const r = await ctx.run('Still', () => ce.board.addStill({ takeId: P.takeId, frame: f, lineId: S.focusId || null }));
    if (r) flash(r.markerWritten ? 'Still sulla lavagna (marker in Resolve)' : 'Still sulla lavagna');
  }
  async function reveal() {
    if (!P.takeId) return;
    const m = P.marks[P.takeId] || {};
    const r = await ctx.run('Mostra in Resolve', () => ce.revealInResolve({ takeId: P.takeId, startFrame: m.in ?? P.frame, endFrame: m.out ?? P.frame + 1 }));
    if (r) ctx.toast(r.ok ? 'Clip selezionata nel Media Pool con In/Out.' : `Resolve: ${r.reason}`, r.ok ? 'ok' : 'warn');
  }
  function flash(text) { rateEl.textContent = text; rateEl.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => { rateEl.classList.remove('on'); rateEl.textContent = rateLabel(P.rate); }, 1400); }

  // ---- scrub
  const seekFromX = (x) => {
    const r = scrub.getBoundingClientRect();
    const k = Math.max(0, Math.min(1, (x - r.left) / Math.max(1, r.width)));
    if (P.mode === 'seq') seqSeek(k * layout().total); else seekFrame(k * (dur() - 1));
  };
  scrub.addEventListener('pointerdown', (e) => {
    scrub.setPointerCapture(e.pointerId); if (P.playing) pause(); seekFromX(e.clientX);
    const move = (ev) => seekFromX(ev.clientX);
    const up = () => { scrub.removeEventListener('pointermove', move); scrub.removeEventListener('pointerup', up); };
    scrub.addEventListener('pointermove', move); scrub.addEventListener('pointerup', up);
  });
  scrub.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); step((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? Math.round(fps()) : 1)); }
  });

  // ---- render dei controlli (non tocca i <video>)
  function render() {
    const takes = S.snap.view.takes;
    const t = take();
    const m = P.marks[P.takeId] || {};
    const seq = P.mode === 'seq';
    const hasSeq = (layout().items || []).length > 0;
    renderInto(head, () => [
      h('div', { class: 'seg seg-sm', role: 'group', 'aria-label': 'Cosa guardare' },
        h('button', { class: `seg-btn${!seq ? ' on' : ''}`, type: 'button', 'aria-pressed': String(!seq), 'data-fk': 'pl-src', onclick: () => load(P.takeId || S.activeTakeId, { keepTime: true }) }, 'Take'),
        h('button', { class: `seg-btn${seq ? ' on' : ''}`, type: 'button', 'aria-pressed': String(seq), disabled: !hasSeq, 'data-fk': 'pl-seq', title: hasSeq ? 'Anteprima del montaggio (V1 + cutaway)' : 'Il montaggio è vuoto', onclick: () => playSequence() }, 'Montaggio')),
      !seq ? h('label', { class: 'pl-take' }, h('span', { class: 'sr-only' }, 'Take nel lettore'),
        h('select', { class: 'select', 'data-fk': 'pl-take', onchange: (e) => { ctx.setActiveTake(e.target.value); load(e.target.value, { keepTime: false }); } },
          !t ? h('option', { value: '' }, takes.length ? 'Scegli un take…' : 'Nessun take') : null,
          takes.map((x) => h('option', { value: x.id, selected: x.id === P.takeId }, ctx.takeLabel(x.id))))) : h('span', { class: 'dim pl-seqlbl' }, 'Anteprima del montaggio'),
      t && !seq ? h('span', { class: 'pl-swatch', style: { background: ctx.takeColor(t.id) }, 'aria-hidden': 'true' }) : null,
    ]);
    // segmenti sulla barra: righe coperte (take) o pezzi (sequenza)
    const segs = [];
    if (seq) {
      const tot = Math.max(1, layout().total);
      for (const x of layout().items) if (x.rec != null) segs.push(h('i', { class: `seg-b tr${Math.min(x.track, 3)}`, style: { left: `${(x.rec / tot) * 100}%`, width: `${(x.len / tot) * 100}%`, '--c': ctx.takeColor(x.takeId) } }));
    } else if (P.takeId) {
      const d = Math.max(1, dur());
      for (const c of S.snap.view.coverage?.[P.takeId] || []) segs.push(h('i', { class: `seg-b${c.lineId === S.focusId ? ' focus' : ''}`, title: S.d.byId?.get(c.lineId)?.text || c.lineId, style: { left: `${(c.startFrame / d) * 100}%`, width: `${((c.endFrame - c.startFrame) / d) * 100}%`, '--c': ctx.takeColor(P.takeId) } }));
      const r = markRange(m.in, m.out, d);
      if (r) segs.push(h('i', { class: 'seg-io', style: { left: `${(r.startFrame / d) * 100}%`, width: `${((r.endFrame - r.startFrame) / d) * 100}%` } }));
    }
    renderInto(scrub, () => [...segs, h('i', { class: 'seg-ph', 'aria-hidden': 'true' })]);
    scrub.setAttribute('aria-valuemax', String(seq ? layout().total : dur()));
    const line = curLine();
    const btn = (icon, label, onclick, { key, dis = false, cls = '', fk } = {}) => h('button', {
      class: `btn btn-icon ${cls}`, type: 'button', title: key ? `${label} (${key})` : label, 'aria-label': label, disabled: dis, 'data-fk': fk, onclick,
    }, ico(icon));
    const noTake = !P.takeId || seq;
    const io = markRange(m.in, m.out, dur());
    renderInto(ctrl, () => [
      h('div', { class: 'pl-row' },
        btn('stepBack', 'Frame precedente', () => step(-1), { key: '←' }),
        btn('back', 'Indietro', () => jkl('j'), { key: 'J' }),
        h('button', { class: 'btn btn-primary btn-play', type: 'button', title: P.playing ? 'Pausa (Spazio)' : 'Play (Spazio)', 'aria-label': P.playing ? 'Pausa' : 'Play', 'data-fk': 'pl-play', disabled: !P.takeId && !seq, onclick: toggle }, ico(P.playing ? 'pause' : 'play')),
        btn('fwd', 'Avanti veloce', () => jkl('l'), { key: 'L' }),
        btn('stepFwd', 'Frame successivo', () => step(1), { key: '→' }),
        h('span', { class: 'pl-sep' }),
        btn('markIn', 'Segna In', () => mark('in'), { key: 'I', dis: noTake, cls: m.in != null ? 'btn-on' : '' }),
        btn('markOut', 'Segna Out', () => mark('out'), { key: 'O', dis: noTake, cls: m.out != null ? 'btn-on' : '' }),
        btn('image', 'Still sulla lavagna', still, { key: 'S', dis: noTake }),
        btn('resolve', 'Mostra in Resolve', reveal, { dis: noTake })),
      !seq ? h('div', { class: 'pl-row pl-sync' },
        h('button', { class: 'btn btn-small', type: 'button', disabled: noTake || !line?.syncable, 'data-fk': 'pl-m', title: 'Inizio della riga selezionata a questo frame, poi passa alla riga dopo (M)', onclick: () => anchorHere('start') }, h('kbd', {}, 'M'), ' Inizio riga'),
        h('button', { class: 'btn btn-small', type: 'button', disabled: noTake || !line?.syncable, 'data-fk': 'pl-n', title: 'Fine della riga selezionata a questo frame (N)', onclick: () => anchorHere('end') }, h('kbd', {}, 'N'), ' Fine riga'),
        io ? h('button', { class: 'btn btn-small', type: 'button', disabled: !line?.syncable, title: 'La riga selezionata copre esattamente In-Out', onclick: marksToLine }, 'In/Out → riga') : null,
        io ? h('button', { class: 'btn btn-small', type: 'button', title: 'Inserisce In-Out su V1 al playhead del montaggio', onclick: () => toSequence(1) }, '+ V1') : null,
        io ? h('button', { class: 'btn btn-small', type: 'button', title: 'Sovrascrive In-Out su V2 al playhead del montaggio', onclick: () => toSequence(2) }, '+ V2') : null,
        h('span', { class: 'pl-line dim', title: line?.text || '' }, line ? (line.syncable ? `Riga: ${line.character ? `${line.character} · ` : ''}${line.text}` : 'Riga non sincronizzabile') : 'Seleziona una riga nello script')) : null,
    ]);
    rateEl.textContent = rateLabel(P.rate);
    if (!P.takeId && !seq) {
      if (!P.err) { renderInto(msg, () => [h('p', {}, ico('film', 'ico ico-lg')), h('p', {}, takes.length ? 'Clic su una riga dello script o su ▶ di un take per guardarlo qui.' : 'Il lettore si attiva quando ci sono clip.')]); msg.classList.add('on'); }
    } else if (!P.err) msg.classList.remove('on');
    paint();
  }

  // ---- tastiera (chiamata da app.js fuori dai campi di testo)
  function handleKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key;
    if (k === ' ') { if (!P.takeId && P.mode !== 'seq') { if (S.activeTakeId) load(S.activeTakeId, { play: true }); return true; } toggle(); return true; }
    const low = k.length === 1 ? k.toLowerCase() : k;
    if (low === 'j' || low === 'k' || low === 'l') { if (!P.takeId && P.mode !== 'seq') return false; jkl(low); return true; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') { if (e.target.closest?.('.editor')) return false; step((k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? Math.round(fps()) : 1)); return true; }
    if (low === 'i') { mark('in'); return true; }
    if (low === 'o') { mark('out'); return true; }
    if (low === 'm') { anchorHere('start'); return true; }
    if (low === 'n') { anchorHere('end'); return true; }
    if (low === 's') { still(); return true; }
    return false;
  }

  render();
  return {
    load, playLine, playSequence, unload, render, handleKey,
    get state() { return { mode: P.mode, takeId: P.takeId, frame: P.frame, playing: P.playing, rate: P.rate, marks: P.marks[P.takeId] || {}, seqRec: P.seqRec, error: P.err }; },
    seekSequence: (rec) => { if (P.mode === 'seq') seqSeek(rec); },
  };
}
