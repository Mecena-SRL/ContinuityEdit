// Assistente passo-passo: legge lo stato e propone UN solo prossimo passo con un pulsante. Logica pura (testata).
//
// summarize({ view, project, clips, transcribing, sent }) -> riepilogo numerico
// nextStep(summary, { skipped }) -> { id, phase, phases, title, text, action:{id,label}, alt?:{id,label}, busy? }

export const PHASES = ['Clip', 'Copione', 'Sincronizza', 'Montaggio', 'Timeline'];

// aligned: take gia' passati dall'allineamento automatico (anche senza risultati: clip mute) -> non si ripropone.
export function summarize({ view, project, clips = {}, transcribing = new Set(), sent = false, aligned = new Set() }) {
  const takes = view?.takes || [];
  const lines = view?.lines || [];
  const cov = view?.coverage || {};
  const syncable = lines.filter((l) => l.syncable);
  const covered = new Set(Object.values(cov).flatMap((list) => (list || []).map((c) => c.lineId)));
  const dialogue = lines.filter((l) => l.type === 'dialogue').length;
  const known = (t) => clips[t.clipId] !== undefined;
  const isTr = (t) => !!clips[t.clipId]?.transcribed;
  const untranscribed = takes.filter((t) => known(t) && !isTr(t) && !transcribing.has(t.clipId)).map((t) => t.id);
  const unsynced = takes.filter((t) => isTr(t) && !(cov[t.id] || []).length && !aligned.has(t.id)).map((t) => t.id);
  const uncovered = syncable.filter((l) => !covered.has(l.id));
  return {
    takes: takes.length,
    hasScript: lines.length > 0,
    docMode: project?.scriptDoc?.source === 'trascrizione',
    dialogue,
    syncable: syncable.length,
    covered: syncable.length - uncovered.length,
    uncoveredActions: uncovered.filter((l) => l.type === 'action').length,
    uncoveredIds: uncovered.map((l) => l.id),
    untranscribed,
    transcribing: transcribing.size,
    unsynced,
    seqItems: (project?.sequence?.items || []).length,
    sent: !!sent,
  };
}

export function nextStep(s, { skipped = new Set() } = {}) {
  const step = (id, phase, title, text, action, alt = null, extra = {}) => ({ id, phase, phases: PHASES, title, text, action, alt, ...extra });
  if (!s.takes) {
    return step('bins', 0, 'Carica le clip della scena',
      'Scegli uno o più bin di scena del Media Pool: ogni clip diventa un take da sincronizzare.',
      { id: 'openBins', label: 'Scegli i bin…' }, { id: 'addSelected', label: 'Usa le clip selezionate' });
  }
  if (!s.hasScript) {
    return step('script', 1, 'Importa la sceneggiatura',
      'Final Draft (.fdx) o PDF. Documentario o niente copione? Le trascrizioni possono diventare il copione.',
      { id: 'importScript', label: 'Importa sceneggiatura…' }, { id: 'docMode', label: 'Usa le trascrizioni' });
  }
  if (s.seqItems && s.sent) {
    return step('done', 4, 'Fatto: la timeline è in Resolve',
      'Le righe montate hanno il pallino verde. Con "Segui timeline" lo script segue il playhead di Resolve e un clic su una riga lo sposta.',
      { id: 'followTimeline', label: 'Segui la timeline' }, { id: 'sendTimeline', label: 'Manda di nuovo' });
  }
  if (s.transcribing) {
    return step('transcribe', 2, 'Trascrizione in corso',
      `Resolve sta trascrivendo ${s.transcribing} ${s.transcribing === 1 ? 'clip' : 'clip'}. Puoi continuare a lavorare: la sincronizzazione parte da sola alla fine.`,
      { id: 'showSync', label: 'Mostra avanzamento' }, null, { busy: true });
  }
  const needAudio = s.dialogue > 0 || s.docMode;
  if (needAudio && !skipped.has('transcribe') && (s.untranscribed.length || s.unsynced.length)) {
    const n = s.untranscribed.length + s.unsynced.length;
    return step('sync', 2, 'Sincronizza le clip',
      `${n} ${n === 1 ? 'take da trascrivere o allineare' : 'take da trascrivere o allineare'}: un clic e le battute si agganciano da sole al parlato.`,
      { id: 'syncAll', label: 'Sincronizza tutto' }, { id: 'skip:transcribe', label: 'Salta' });
  }
  if (s.uncoveredActions && !skipped.has('mute')) {
    return step('mute', 2, 'Aggancia le azioni guardando',
      `${s.uncoveredActions} ${s.uncoveredActions === 1 ? 'riga di azione è scoperta' : 'righe di azione sono scoperte'}. Fai partire il take e premi M all'inizio di ogni azione: il lettore passa da solo alla riga dopo.`,
      { id: 'tapSync', label: 'Inizia dalla prima scoperta' }, { id: 'skip:mute', label: 'Più tardi' });
  }
  if (!s.seqItems) {
    return step('cut', 3, 'Crea il montaggio grezzo',
      'Per ogni riga il take migliore (o quello scelto) su V1. Poi aggiungi le altre camere su V2 con il tasto destro sulle righe.',
      { id: 'roughCut', label: 'Crea il montaggio' }, { id: 'openEditor', label: 'Monto a mano' });
  }
  if (!s.sent) {
    return step('send', 4, 'Rivedi e manda in timeline',
      'Guarda l\'anteprima nel lettore, ritocca nel montaggio in basso, poi manda tutto in una timeline nuova di Resolve.',
      { id: 'sendTimeline', label: 'Manda in timeline' }, { id: 'previewSeq', label: 'Guarda l\'anteprima' });
  }
  return step('done', 4, 'Fatto: la timeline è in Resolve',
    'Le righe usate sono segnate con un pallino pieno. Con "Segui la timeline" lo script segue il playhead di Resolve.',
    { id: 'followTimeline', label: 'Segui la timeline' }, { id: 'sendTimeline', label: 'Manda di nuovo' });
}
