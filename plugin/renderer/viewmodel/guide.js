// Guida "Prima di iniziare" (5 passi) e stato di prima visualizzazione.
export const GUIDE_STEPS = [
  { title: 'Sync e trascrizione', text: 'In Resolve metti a sync l’audio delle clip e trascrivile (puoi farlo anche da qui, dal pannello Clip e take).' },
  { title: 'Bin per scena', text: 'Organizza il Media Pool in bin: uno per ogni scena (sottocartelle comprese).' },
  { title: 'Apri i bin di scena', text: 'Nel pannello scegli “Bin di scena”, spunta uno o più bin e premi “Carica bin”.' },
  { title: 'Apri una timeline', text: 'Apri in Resolve la timeline di lavoro: serve per le ancore dal playhead e per l’assemblaggio.' },
  { title: 'Apri il plugin', text: 'Importa la sceneggiatura, controlla le linee dei take e valuta le riprese. Il tasto ? riapre questa guida.' },
];
export const GUIDE_KEY = 'ce.guideSeen';
export const shouldShowGuide = (seen) => !seen;
