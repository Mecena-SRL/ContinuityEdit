// Cronologia undo/redo a livello di progetto: snapshot completi (structuredClone), massimo 50 passi.
// Uso: const h = createHistory(); h.push(project) PRIMA di ogni mutazione; project = h.undo(project) / h.redo(project).
// undo/redo ritornano un NUOVO oggetto progetto (o null se non c'e' nulla da annullare/ripetere).

export const HISTORY_LIMIT = 50;

export function createHistory({ limit = HISTORY_LIMIT } = {}) {
  let past = [];
  let future = [];
  const snap = (p) => structuredClone(p);
  return {
    push(project) {
      past.push(snap(project));
      if (past.length > limit) past = past.slice(past.length - limit);
      future = [];
    },
    undo(current) {
      if (!past.length) return null;
      future.push(snap(current));
      return past.pop();
    },
    redo(current) {
      if (!future.length) return null;
      past.push(snap(current));
      return future.pop();
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() { past = []; future = []; },
    size: () => ({ undo: past.length, redo: future.length }),
  };
}
