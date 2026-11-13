// Valutazioni: rating buono/scarto, voti (B, B+, B++), filtri sui take.
export const DEFAULT_GRADES = ['B', 'B+', 'B++'];
export const RATINGS = [['tutti', 'Tutte'], ['buono', 'Buone'], ['scarto', 'Scarti']];

export const markFor = (project, takeId, lineId) => (project?.marks || {})[`${takeId}|${lineId}`] || {};
export const gradePalette = (project) => (project?.gradePalette?.length ? project.gradePalette : DEFAULT_GRADES);

/** Click su un valore gia' attivo lo toglie. */
export const toggleRating = (current, wanted) => (current === wanted ? null : wanted);
export const toggleGrade = (current, wanted) => (current === wanted ? '' : wanted);

/** Filtra per rating (buono|scarto|tutti) e voti. */
export function filterTakeList(takes, { rating = 'tutti', grades = [] } = {}) {
  return takes.filter((t) => {
    if (rating === 'buono' && t.rating !== 'buono') return false;
    if (rating === 'scarto' && t.rating !== 'scarto') return false;
    if (grades.length && !grades.includes(t.grade)) return false;
    return true;
  });
}

/** Tasto -> patch di valutazione: 1-9 voti della palette, B buono, X scarto, 0 pulisce. null se non riconosciuto. */
export function patchFromKey(key, cur = {}, palette = DEFAULT_GRADES) {
  const k = String(key).toLowerCase();
  if (/^[1-9]$/.test(k)) return palette[Number(k) - 1] === undefined ? null : { grade: toggleGrade(cur.grade || '', palette[Number(k) - 1]) };
  if (k === 'b') return { rating: toggleRating(cur.rating || null, 'buono') };
  if (k === 'x') return { rating: toggleRating(cur.rating || null, 'scarto') };
  if (k === '0') return { rating: null, grade: '' };
  return null;
}

export const ratingLabel = (r) => ({ buono: 'Buono', scarto: 'Scarto' })[r] || 'Non valutato';
export const parseTags = (s) => [...new Set(String(s || '').split(',').map((x) => x.trim()).filter(Boolean))];
