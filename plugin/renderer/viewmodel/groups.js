// Colonne dei take con supporto multicam: i take con lo stesso groupId formano un gruppo con sotto-linee per angolo.
export const angleLabel = (i) => `CAM ${String.fromCharCode(65 + (i % 26))}`;

/** Porta i take dello stesso gruppo uno accanto all'altro (ordine di prima apparizione). */
export function orderTakesForColumns(takes) {
  const out = [];
  const seen = new Set();
  for (const t of takes) {
    if (seen.has(t.id)) continue;
    if (t.groupId) {
      for (const u of takes) if (u.groupId === t.groupId && !seen.has(u.id)) { seen.add(u.id); out.push(u); }
    } else { seen.add(t.id); out.push(t); }
  }
  return out;
}

/** {ordered, cols:[{takeId, groupId, angle, col}], groups:[{groupId, from, count}]}. */
export function buildColumnPlan(takes) {
  const ordered = orderTakesForColumns(takes);
  const cols = []; const groups = []; const idx = {};
  ordered.forEach((t, col) => {
    let angle = t.angle || null;
    if (t.groupId) {
      idx[t.groupId] = (idx[t.groupId] ?? -1) + 1;
      if (!angle) angle = angleLabel(idx[t.groupId]);
      let g = groups.find((x) => x.groupId === t.groupId);
      if (!g) { g = { groupId: t.groupId, from: col, count: 0 }; groups.push(g); }
      g.count++;
    }
    cols.push({ takeId: t.id, groupId: t.groupId || null, angle, col });
  });
  return { ordered, cols, groups };
}

/** Gruppi multicam (almeno 2 angoli): [{groupId, takes, angles:[{takeId, angle}]}]. */
export function multicamGroups(takes) {
  const m = new Map();
  for (const t of takes) if (t.groupId) { if (!m.has(t.groupId)) m.set(t.groupId, []); m.get(t.groupId).push(t); }
  return [...m].filter(([, v]) => v.length > 1).map(([groupId, list]) => ({
    groupId, takes: list, angles: buildColumnPlan(list).cols.map((c) => ({ takeId: c.takeId, angle: c.angle })),
  }));
}

/** Etichette angolo per un gruppo rilevato: [{takeId, angle}] (rispetta quelle esistenti). */
export function anglesForGroup(takeIds, existing = {}) {
  return takeIds.map((takeId, i) => ({ takeId, angle: existing[takeId] || angleLabel(i) }));
}
