import { createProject, addClip, addTake } from '../src/sync/index.js';

// Script quasi muto: scene + 5 action + 1 dialogue.
export function muteScript() {
  const mk = (n, type, text, extra = {}) => ({ id: `L${n}`, order: n, type, character: null, text, sceneId: 'S1', ...extra });
  return {
    title: 'Muto', source: 'fdx',
    scenes: [{ id: 'S1', heading: 'INT. CUCINA - GIORNO', lineIds: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] }],
    lines: [
      mk(1, 'scene', 'INT. CUCINA - GIORNO'),
      mk(2, 'action', 'Marta entra e posa le chiavi sul tavolo.'),
      mk(3, 'action', 'Guarda fuori dalla finestra, pensierosa.'),
      mk(4, 'dialogue', 'Non tornera piu.', { character: 'MARTA' }),
      mk(5, 'action', 'Apre il frigo e lo richiude subito.'),
      mk(6, 'action', 'Esce lasciando la porta aperta.'),
    ],
  };
}

export function baseProject({ duration = 1000 } = {}) {
  const p = createProject(muteScript());
  addClip(p, 'C1', { fps: 25, durationFrames: duration, startTcFrames: 90000, name: 'A001' });
  addTake(p, { id: 'T1', clipId: 'C1', label: 'Ciak 1' });
  return p;
}
