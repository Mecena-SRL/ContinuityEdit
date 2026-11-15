// Messaggi: errori comprensibili con rimedio, elenco delle scorciatoie (foglio rapido). Puro.

/** Toglie il prefisso tecnico dell'IPC di Electron: "Error invoking remote method 'ce:x': Error: ...". */
export function cleanError(e) {
  const m = String(e?.message ?? e ?? '');
  return m.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(Error:\s*)+/, '').trim() || 'errore sconosciuto';
}

// Rimedi per gli errori piu' comuni (riconosciuti dal testo).
const REMEDIES = [
  [/Nessun progetto aperto|Media Pool non disponibile/i, 'Apri un progetto in DaVinci Resolve e riprova.'],
  [/Resolve non disponibile|Inizializzazione/i, 'Chiudi e riapri il pannello da Workspace > Workflow Integrations.'],
  [/nessuna timeline aperta/i, 'Apri o crea una timeline in Resolve (pagina Edit).'],
  [/non trovata nel Media Pool/i, 'La clip è stata spostata o eliminata: ricarica i bin di scena.'],
  [/non ha ancora una trascrizione|non trascritta/i, 'Premi "Sincronizza tutto": il pannello chiede a Resolve di trascrivere.'],
  [/Nessuno script caricato/i, 'Importa una sceneggiatura, oppure usa le trascrizioni come copione.'],
  [/non copre/i, 'Quel take non copre quelle righe: aggancia prima le righe (lettore, tasto M) o scegli un altro take.'],
  [/Formato non supportato/i, 'Esporta la sceneggiatura in Final Draft (.fdx) o PDF.'],
  [/SetCurrentTimecode|pagina Edit o Cut/i, 'Passa alla pagina Edit o Cut di Resolve.'],
];
export function remedyFor(msg) {
  const hit = REMEDIES.find(([re]) => re.test(msg));
  return hit ? hit[1] : '';
}

export const SHORTCUTS = [
  ['Lettore', [
    ['Spazio', 'Play / pausa'], ['J  K  L', 'Indietro, ferma, avanti (ripeti per accelerare)'], ['← →', 'Un frame (Maiusc: un secondo)'],
    ['I  O', 'Segna In / Out'], ['M', 'Inizio della riga selezionata qui, poi passa alla riga dopo'], ['N', 'Fine della riga selezionata qui'],
    ['S', 'Still sulla lavagna'],
  ]],
  ['Sceneggiatura', [
    ['↑ ↓', 'Riga precedente / successiva (Maiusc: estende la selezione)'], ['Invio', 'Riproduci la riga nel lettore'], ['1 … 9', 'Usa quel take per la riga'],
    ['Ctrl/Cmd+F', 'Cerca'], ['Alt+A / D / C / P / S / T', 'Segna come azione, battuta, personaggio, parentetica, scena, transizione'],
  ]],
  ['Montaggio', [
    ['B', 'Lama al playhead'], ['Canc', 'Togli il pezzo (V1 si ricompatta)'], ['Q  W', 'Accorcia inizio / fine del pezzo fino al playhead'],
    ['Ctrl/Cmd+Z', 'Annulla (Maiusc: ripeti)'],
  ]],
  ['Generale', [['?', 'Questo foglio'], ['Ctrl/Cmd+S', 'Salva'], ['Esc', 'Chiude finestre e menu']]],
];
