// Lavagna: pan/zoom, bounds, ordinamenti, frame da posizione barra.
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;
export const MIN_SIZE = 60;
export const clampZoom = (k) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));

/** view = {x,y,k}: schermo = mondo*k + (x,y). */
export const screenToWorld = (view, sx, sy) => ({ x: (sx - view.x) / view.k, y: (sy - view.y) / view.k });

/** Zoom mantenendo fisso il punto schermo (cx,cy). */
export function zoomAt(view, factor, cx, cy) {
  const k = clampZoom(view.k * factor);
  const w = screenToWorld(view, cx, cy);
  return { k, x: cx - w.x * k, y: cy - w.y * k };
}

export function boundsOf(items) {
  if (!items.length) return null;
  const x0 = Math.min(...items.map((i) => i.x)); const y0 = Math.min(...items.map((i) => i.y));
  const x1 = Math.max(...items.map((i) => i.x + i.w)); const y1 = Math.max(...items.map((i) => i.y + i.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Vista che inquadra tutti gli item con margine. */
export function fitView(items, width, height, margin = 40) {
  const b = boundsOf(items);
  if (!b) return { x: 0, y: 0, k: 1 };
  const k = clampZoom(Math.min((width - 2 * margin) / Math.max(1, b.w), (height - 2 * margin) / Math.max(1, b.h), 1.5));
  return { k, x: (width - b.w * k) / 2 - b.x * k, y: (height - b.h * k) / 2 - b.y * k };
}

export const clampSize = (w, h) => ({ w: Math.max(MIN_SIZE, Math.round(w)), h: Math.max(MIN_SIZE, Math.round(h)) });

/** Still ordinati per x | y | z. */
export function orderedStills(items, order = 'x') {
  const key = { x: (i) => i.x, y: (i) => i.y, z: (i) => i.z ?? 0 }[order] || ((i) => i.x);
  return items.filter((i) => i.type === 'still').sort((a, b) => key(a) - key(b));
}

/** Barra di scorrimento (0..1) -> frame intero della clip. */
export const frameFromRatio = (ratio, durationFrames) => Math.max(0, Math.min(Math.max(0, durationFrames - 1), Math.round(ratio * (durationFrames - 1))));
export const centerOf = (i) => ({ x: i.x + i.w / 2, y: i.y + i.h / 2 });
export const NOTE_COLORS = ['#f2d14a', '#ff9f43', '#4cd38a', '#4fa3ff', '#e56bd0', '#ff6b6b'];
