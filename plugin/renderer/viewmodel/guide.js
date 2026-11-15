// Guida "Come funziona" (primo avvio, richiamabile dal menu) e stato di prima visualizzazione.
export const GUIDE_STEPS = [
  { title: 'Clip', text: 'In Resolve metti a sync audio e video e organizza il Media Pool in un bin per scena. Qui scegli i bin da usare.' },
  { title: 'Copione', text: 'Importa la sceneggiatura (FDX o PDF). Senza copione, per un documentario, le trascrizioni diventano il copione.' },
  { title: 'Sincronizza', text: '"Sincronizza tutto" fa trascrivere le clip a Resolve e aggancia le battute. Le azioni mute si agganciano guardando: tasto M.' },
  { title: 'Montaggio', text: 'Linee verticali = take che coprono le righe. Crea il montaggio grezzo: master su V1, altre camere su V2/V3.' },
  { title: 'Timeline', text: 'Rivedi l’anteprima nel lettore e manda tutto in una timeline nuova di Resolve, con i marker delle righe.' },
];
export const GUIDE_KEY = 'ce.guideSeen';
export const shouldShowGuide = (seen) => !seen;
