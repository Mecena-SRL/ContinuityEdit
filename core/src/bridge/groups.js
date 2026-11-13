// Euristiche per raggruppare clip che sono la stessa performance ripresa da piu' camere. Puro, senza Resolve.
// Input: [{ id, name, fps, durationFrames, startTcFrames, meta:{scene,shot,take,camera,angle} }]
// Output: [{ groupId, label, ids, reason, angles:{id:angle|null} }]  (ordine delle clip stabile)
// Priorita': 1) stesso Scene+Shot+Take  2) nome file con stesso prefisso e suffissi camera  3) timecode sovrapposti.

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());
const stripExt = (n) => clean(n).replace(/\.[A-Za-z0-9]{2,5}$/, '');

// Nome -> { key, angle } oppure null. Riconosce "scena_12_CAM_A", "scena_12-B", "A001C002xxx" (lettera camera iniziale).
export function splitCameraName(name) {
  const base = stripExt(name);
  let m = /^(.{3,}?)[ _.-]*cam(?:era)?[ _.-]*([A-Za-z]|\d{1,2})$/i.exec(base);
  if (m) return { key: m[1].toLowerCase(), angle: `CAM ${m[2].toUpperCase()}`, base: m[1] };
  m = /^([A-Za-z])(\d{3,4}.*)$/.exec(base);
  if (m) return { key: m[2].toLowerCase(), angle: `CAM ${m[1].toUpperCase()}`, base: m[2] };
  m = /^(.{3,}?)[ _.-]+([A-Za-z])$/.exec(base);
  if (m) return { key: m[1].toLowerCase(), angle: `CAM ${m[2].toUpperCase()}`, base: m[1] };
  return null;
}

export function detectGroups(clips) {
  const groups = [];
  const used = new Set();
  const push = (members, label, reason, angleOf) => {
    const angles = {};
    for (const c of members) angles[c.id] = angleOf ? angleOf(c) : (clean(c.meta?.angle) || clean(c.meta?.camera) || null);
    groups.push({ groupId: `G${groups.length + 1}`, label, ids: members.map((c) => c.id), reason, angles });
    for (const c of members) used.add(c.id);
  };

  // 1) stesso Scene + Shot + Take
  const byMeta = new Map();
  for (const c of clips) {
    const s = clean(c.meta?.scene); const sh = clean(c.meta?.shot); const t = clean(c.meta?.take);
    if (!s || !sh || !t) continue;
    const k = JSON.stringify([s, sh, t]);
    if (!byMeta.has(k)) byMeta.set(k, []);
    byMeta.get(k).push(c);
  }
  for (const [k, members] of byMeta) {
    if (members.length < 2) continue;
    const [s, sh, t] = JSON.parse(k);
    push(members, `Scena ${s} · Shot ${sh} · Take ${t}`, `stessi metadati Scene ${s}, Shot ${sh}, Take ${t}`);
  }

  // 2) nome file: stesso prefisso, suffissi camera diversi
  const byName = new Map();
  for (const c of clips) {
    if (used.has(c.id)) continue;
    const sp = splitCameraName(c.name);
    if (!sp) continue;
    if (!byName.has(sp.key)) byName.set(sp.key, []);
    byName.get(sp.key).push({ c, angle: sp.angle, base: sp.base });
  }
  for (const [, arr] of byName) {
    if (arr.length < 2 || new Set(arr.map((x) => x.angle)).size < 2) continue;
    const angleById = Object.fromEntries(arr.map((x) => [x.c.id, x.angle]));
    push(arr.map((x) => x.c), arr[0].base,
      `nomi file con lo stesso prefisso e camere diverse (${arr.map((x) => x.angle).join(', ')})`, (c) => angleById[c.id]);
  }

  // 3) timecode sovrapposti (solo clip con timecode non nullo e stesso fps, camere diverse)
  const tc = clips.filter((c) => !used.has(c.id) && c.startTcFrames > 0 && c.durationFrames > 0 && c.fps > 0);
  const sameCam = (a, b) => clean(a.meta?.camera) && clean(a.meta?.camera) === clean(b.meta?.camera);
  const overlaps = (a, b) => {
    if (a.fps !== b.fps || sameCam(a, b)) return false;
    const lo = Math.max(a.startTcFrames, b.startTcFrames);
    const hi = Math.min(a.startTcFrames + a.durationFrames, b.startTcFrames + b.durationFrames);
    return hi - lo >= 0.5 * Math.min(a.durationFrames, b.durationFrames);
  };
  const seen = new Set();
  for (const a of tc) {
    if (seen.has(a.id)) continue;
    const members = [a];
    for (const b of tc) if (b !== a && !seen.has(b.id) && members.every((m) => overlaps(m, b))) members.push(b);
    if (members.length < 2) continue;
    for (const m of members) seen.add(m.id);
    push(members, stripExt(a.name) || a.id, 'timecode sorgente sovrapposto (stessa ripresa su camere diverse)');
  }
  return groups;
}
