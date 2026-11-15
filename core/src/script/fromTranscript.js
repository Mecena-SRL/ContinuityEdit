// Modalita' documentario: senza sceneggiatura, le trascrizioni di Resolve diventano il copione.
// Ogni clip = una scena (intestazione = nome della clip); ogni frase parlata = una riga 'dialogue' (personaggio =
// speaker della trascrizione, altrimenti "PARLATO"), con ancore esatte inizio/fine ricavate dai tempi delle parole.
//
// scriptFromTranscripts([{ takeId, name, transcript: TranscriptDoc }], { maxWords=28, title })
//   -> { scriptDoc: {title, source:'trascrizione', scenes, lines}, anchors: [{takeId, lineId, edge, frame, kind:'auto', ratio:1}] }

const pad = (n) => String(n).padStart(4, '0');
const ENDS = /[.?!…]["»”)]*$/;

function sentences(words, maxWords) {
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length) out.push(cur); cur = []; };
  words.forEach((w, k) => {
    const prev = words[k - 1];
    if (prev && (w.seg !== prev.seg || (w.speaker || null) !== (prev.speaker || null))) flush();
    cur.push(w);
    if (ENDS.test(w.text) || cur.length >= maxWords) flush();
  });
  flush();
  return out;
}

export function scriptFromTranscripts(entries, { maxWords = 28, title = 'Trascrizioni' } = {}) {
  const lines = [];
  const scenes = [];
  const anchors = [];
  let n = 0;
  for (const e of entries || []) {
    const words = e?.transcript?.words || [];
    if (!words.length) continue;
    const sceneId = `S${scenes.length + 1}`;
    const head = { id: `L${pad(++n)}`, order: n, type: 'scene', character: null, text: e.name || e.takeId, sceneId };
    lines.push(head);
    const scene = { id: sceneId, heading: head.text, lineIds: [head.id] };
    for (const s of sentences(words, maxWords)) {
      const id = `L${pad(++n)}`;
      const speaker = s[0].speaker ? String(s[0].speaker).toUpperCase() : 'PARLATO';
      lines.push({ id, order: n, type: 'dialogue', character: speaker, text: s.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim(), sceneId });
      scene.lineIds.push(id);
      const last = s[s.length - 1];
      const next = words[last.i + 1];
      // la fine di una parola spesso copre la pausa seguente: si taglia all'inizio della parola dopo
      const end = Math.max(s[0].startFrame + 1, Math.min(last.endFrame, next ? next.startFrame : last.endFrame) || last.startFrame + 1);
      anchors.push({ takeId: e.takeId, lineId: id, edge: 'start', frame: s[0].startFrame, kind: 'auto', ratio: 1 });
      anchors.push({ takeId: e.takeId, lineId: id, edge: 'end', frame: end, kind: 'auto', ratio: 1 });
    }
    scenes.push(scene);
  }
  return { scriptDoc: { title, source: 'trascrizione', scenes, lines }, anchors };
}
