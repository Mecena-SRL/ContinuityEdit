// Parser PDF di sceneggiature (italiano/inglese) basato sulle coordinate x/y di pdfjs-dist.
// Output: ScriptDoc (vedi docs/CONTRACTS.md) + warnings[] + confidence 0..1 per riga.
// Non lancia mai eccezioni: PDF illeggibili o scansionati => ScriptDoc vuoto con warning.

const EMPTY_TEXT_WARNING = 'nessun testo estraibile (PDF scansionato?)';

// ---------------------------------------------------------------- regex ----
const SCENE_RE = /^(?:\d+[A-Z]?[.\s]+)?(?:INT\.?\s*[/-]\s*(?:EST|EXT)|(?:EST|EXT)\.?\s*[/-]\s*INT|I\s*\/\s*E|INTERNO|ESTERNO|INT|EST|EXT)\b\.?/;
const TRANSITION_RE =
  /^(?:(?:SMASH |MATCH |JUMP |QUICK )?CUT(?: TO(?: BLACK)?)?|DISSOLVE(?: TO)?|FADE(?: TO BLACK| OUT| IN)?|WIPE TO|TAGLIO(?: SECCO)?(?: A)?|DISSOLVENZA(?: IN| A| INCROCIATA| IN CHIUSURA)?|STACCO(?: A)?|SFUMA(?:TO)?(?: A| IN| AL NERO)?|FINE|THE END)\b/;
const CONTD_RE = /^(?:CONT['’`]?D\.?|CONT\.?|SEGUE|CONTINUA|CONTINUED)$/i;
const NOISE_ROW_RE = /^\(?\s*(?:MORE|SEGUE|CONTINUA|CONTINUED|PI[UÙ]|CONT['’`]?D)\s*\)?\s*:?$/i;
const PAGE_NUM_RE = /^(?:(?:pag(?:ina|\.)?|page|p\.)\s*)?\(?\d+\)?\.?(?:\s*(?:di|of|\/)\s*\d+)?$/i;
const SCENE_NUM_RE = /^[A-Z]?\d+[A-Z]?\.?$/;
const TERMINAL_RE = /[.!?…:»"”)]$/;

const isUpper = (t) => /[A-ZÀ-Ý]/.test(t) && t === t.toUpperCase();
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const round2 = (n) => Math.round(n * 100) / 100;
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

function emptyDoc(warnings) {
  return { title: '', source: 'pdf', scenes: [], lines: [], warnings, confidence: 0 };
}

// --------------------------------------------------------- caricamento ----
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    // Worker "fake" in-process: niente Worker thread, niente canvas.
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    }
  } catch {
    /* il fallback interno di pdfjs gestisce il caso */
  }
  return pdfjs;
}

async function extractPages(input) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(input.byteLength);
  data.set(input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
  const task = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const pdf = await task.promise;
  const pages = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (typeof it.str !== 'string' || !it.str.trim()) continue;
        const [, , , , x, y] = it.transform;
        items.push({ str: it.str, x, y, w: it.width || 0, h: it.height || Math.abs(it.transform[3]) || 12 });
      }
      pages.push({ width: vp.width, height: vp.height, items });
      page.cleanup();
    }
  } finally {
    await task.destroy().catch(() => {});
  }
  return pages;
}

// ------------------------------------------------------ righe e celle ----
function estimateCharWidth(pages) {
  const ws = [];
  for (const pg of pages) {
    for (const it of pg.items) {
      const n = it.str.length;
      if (n >= 3 && it.w > 0) ws.push(it.w / n);
    }
  }
  const cw = median(ws);
  return cw > 2 && cw < 20 ? cw : 7.2;
}

/** Raggruppa gli item di una pagina in righe (y) e celle (gap orizzontali ampi). */
function buildRows(page, pageIndex, cw) {
  const items = [...page.items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.y - it.y) <= Math.max(2, it.h * 0.35)) g.items.push(it);
    else groups.push({ y: it.y, items: [it] });
  }
  const rows = [];
  for (const g of groups) {
    g.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const it of g.items) {
      const last = cells[cells.length - 1];
      const gap = last ? it.x - last.x2 : Infinity;
      if (last && gap < 1.8 * cw) {
        const needSpace = gap > 0.25 * cw && !/\s$/.test(last.text) && !/^\s/.test(it.str);
        last.text += (needSpace ? ' ' : '') + it.str;
        last.x2 = Math.max(last.x2, it.x + it.w);
      } else {
        cells.push({ x: it.x, x2: it.x + it.w, text: it.str });
      }
    }
    for (const c of cells) c.text = squash(c.text);
    rows.push({ page: pageIndex, y: g.y, cells: cells.filter((c) => c.text), pageW: page.width, pageH: page.height });
  }
  return rows.filter((r) => r.cells.length);
}

// ------------------------------------------------- pulizia intestazioni ----
function cleanRows(allRows, pages, warnings) {
  const nPages = pages.length;
  const headerKey = (r) => r.cells.map((c) => c.text).join(' ').replace(/\d+/g, '#').toLowerCase();
  const zone = (r) => (r.pageH - r.y < 60 ? 'top' : r.y < 45 ? 'bottom' : null);

  // intestazioni/pie' ripetuti: stesso testo (cifre normalizzate) su almeno meta' delle pagine
  const repeats = new Map();
  if (nPages >= 2) {
    for (const r of allRows) {
      if (!zone(r)) continue;
      const k = zone(r) + '|' + headerKey(r);
      if (!repeats.has(k)) repeats.set(k, new Set());
      repeats.get(k).add(r.page);
    }
  }
  const repeated = new Set([...repeats].filter(([, s]) => s.size >= Math.max(2, nPages / 2)).map(([k]) => k));

  const kept = [];
  const moreOnPage = new Set();
  for (const r of allRows) {
    const text = r.cells.map((c) => c.text).join(' ');
    const z = zone(r);
    if (z && (PAGE_NUM_RE.test(text) || repeated.has(z + '|' + headerKey(r)))) continue;
    if (NOISE_ROW_RE.test(text)) {
      if (/^\(?\s*MORE|PI[UÙ]|SEGUE|CONTINUA\s*\)?$/i.test(text) || z) moreOnPage.add(r.page);
      continue;
    }
    kept.push(r);
  }
  if (kept.length < allRows.length * 0.2 && allRows.length > 10) {
    warnings.push('molte righe scartate come intestazioni/numeri di pagina: verificare il risultato');
  }
  return { rows: kept, moreOnPage };
}

/** Toglie i numeri di scena a margine (celle isolate) e segna le righe dual dialogue. */
function splitSpecialCells(rows, cw) {
  for (const r of rows) {
    r.sceneNumbers = [];
    if (r.cells.length >= 2) {
      const rest = [];
      for (const c of r.cells) {
        if (SCENE_NUM_RE.test(c.text) && r.cells.length > 1 && (c === r.cells[0] || c === r.cells[r.cells.length - 1])) {
          r.sceneNumbers.push(c.text);
        } else rest.push(c);
      }
      if (rest.length) r.cells = rest;
      else r.sceneNumbers = [];
    }
    const mid = r.pageW * 0.45;
    r.dual = r.cells.length >= 2 && r.cells[0].x < mid && r.cells[r.cells.length - 1].x >= mid;
    if (!r.dual && r.cells.length > 1) {
      const text = r.cells.map((c) => c.text).join(' ');
      r.cells = [{ x: r.cells[0].x, x2: r.cells[r.cells.length - 1].x2, text }];
    }
    r.x = r.cells[0].x;
    r.x2 = r.cells[r.cells.length - 1].x2;
    r.text = r.cells.map((c) => c.text).join(' ');
  }
}

// ------------------------------------------------------- calibrazione ----
function clusterX(rows, tol) {
  const pts = rows.map((r) => r.x).sort((a, b) => a - b);
  const clusters = [];
  for (const x of pts) {
    const c = clusters[clusters.length - 1];
    if (c && x - c.start <= tol) {
      c.sum += x;
      c.n += 1;
    } else clusters.push({ start: x, sum: x, n: 1 });
  }
  return clusters.map((c) => ({ x: c.sum / c.n, n: c.n }));
}

function rowStats(rows, cl, tol) {
  const mine = rows.filter((r) => Math.abs(r.x - cl.x) <= tol);
  const n = mine.length || 1;
  return {
    upper: mine.filter((r) => isUpper(stripExt(r.text).name)).length / n,
    paren: mine.filter((r) => r.text.startsWith('(')).length / n,
    trans: mine.filter((r) => TRANSITION_RE.test(r.text) && isUpper(r.text)).length / n,
    len: mine.reduce((s, r) => s + r.text.length, 0) / n,
  };
}

function calibrate(rows, cw, warnings) {
  const tol = cw * 1.2;
  const body = rows.filter((r) => !r.dual);
  const cal = { cw, L: null, D: null, P: null, C: null, T: null, lineStep: 12 };
  if (!body.length) return cal;
  const total = body.length;
  const clusters = clusterX(body, tol).filter((c) => c.n >= Math.max(2, total * 0.02));
  if (!clusters.length) clusters.push({ x: body[0].x, n: 1 });
  const minW = Math.max(2, total * 0.04);
  cal.L = (clusters.find((c) => c.n >= minW) || clusters[0]).x;

  const above = clusters.filter((c) => c.x > cal.L + 1.5 * cw).map((c) => ({ ...c, ...rowStats(body, c, tol) }));
  const byWeight = (a, b) => b.n - a.n;
  const tCl = above.filter((c) => c.trans >= 0.5).sort(byWeight)[0];
  cal.T = tCl ? tCl.x : null;
  const rest = above.filter((c) => c !== tCl);
  const cCl = rest.filter((c) => c.upper >= 0.7 && c.len <= 32).sort(byWeight)[0];
  const pCl = rest.filter((c) => c !== cCl && c.paren >= 0.6).sort(byWeight)[0];
  const dCl = rest
    .filter((c) => c !== cCl && c !== pCl && (!cCl || c.x < cCl.x))
    .sort(byWeight)[0];
  cal.C = cCl ? cCl.x : null;
  cal.P = pCl ? pCl.x : null;
  cal.D = dCl ? dCl.x : null;
  if (cal.D == null && cal.C != null) cal.D = cal.L + (cal.C - cal.L) * 0.45;
  if (cal.D == null) cal.D = cal.L + 10 * cw;
  if (cal.C == null) cal.C = cal.D + 12 * cw;
  if (cal.P != null && (cal.P <= cal.D + cw || cal.P >= cal.C - cw)) cal.P = null;

  // interlinea tipica
  const dys = [];
  for (let i = 1; i < body.length; i++) {
    if (body[i].page === body[i - 1].page) {
      const dy = body[i - 1].y - body[i].y;
      if (dy > 4 && dy < 30) dys.push(dy);
    }
  }
  cal.lineStep = median(dys) || 12;
  if (clusters.length === 1) warnings.push('nessuna indentazione rilevata: layout piatto, ruoli dedotti solo dal testo');
  return cal;
}

// ---------------------------------------------------- classificazione ----
/** Divide "NOME (V.O.) (CONT'D)" in nome + estensioni. */
function stripExt(text) {
  const exts = [];
  const name = text
    .replace(/\(([^)]*)\)/g, (_, e) => {
      exts.push(e.trim());
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { name, exts };
}

function looksLikeCharacter(text) {
  const { name } = stripExt(text);
  return !!name && name.length <= 40 && name.split(' ').length <= 6 && isUpper(name) && !/[.!?:]$/.test(name);
}

function classify(rows, cal) {
  const cw = cal.cw;
  const anchors = [
    { role: 'action', x: cal.L },
    { role: 'dialogue', x: cal.D },
    { role: 'character', x: cal.C },
  ];
  if (cal.P != null) anchors.push({ role: 'paren', x: cal.P });
  anchors.sort((a, b) => a.x - b.x);

  let parenOpen = false;
  for (const r of rows) {
    if (r.dual) continue;
    const t = r.text;
    const up = isUpper(t);
    const atMargin = r.x <= cal.L + 1.5 * cw;
    r.role = 'action';
    r.conf = 0.5;

    // 1. scene heading
    if (atMargin || r.x < cal.D - cw) {
      const head = t.replace(/^\d+[A-Z]?[.\s]+(?=\S)/, '');
      if (SCENE_RE.test(t) && (up || /^[A-Z/.\- ]{3,12}(?=\s|$)/.test(head))) {
        r.role = 'scene';
        r.conf = atMargin && up ? 0.97 : 0.75;
        parenOpen = false;
        continue;
      }
    }
    // 2. transition
    const nearDialogue = Math.abs(r.x - cal.D) <= 1.5 * cw || (cal.P != null && Math.abs(r.x - cal.P) <= 1.5 * cw);
    if (up && TRANSITION_RE.test(t) && t.length <= 40 && !nearDialogue) {
      const right = r.x >= cal.C - cw || (cal.T != null && Math.abs(r.x - cal.T) <= 1.5 * cw);
      r.role = 'transition';
      r.conf = right ? 0.95 : atMargin && /[:.]$/.test(t) ? 0.8 : 0.6;
      parenOpen = false;
      continue;
    }
    // continuazione di parentetica a piu' righe
    if (parenOpen) {
      r.role = 'paren';
      r.conf = 0.8;
      if (t.endsWith(')')) parenOpen = false;
      continue;
    }
    // parentetica completa tra dialogo e personaggio (anche senza cluster dedicato)
    if (t.startsWith('(') && t.endsWith(')') && r.x > cal.D + 1.5 * cw && r.x < cal.C - cw) {
      r.role = 'paren';
      r.conf = 0.9;
      continue;
    }
    // 3. ruolo dalla posizione (ancore calibrate sul documento)
    let best = anchors[0];
    for (const a of anchors) if (Math.abs(r.x - a.x) < Math.abs(r.x - best.x)) best = a;
    const idx = anchors.indexOf(best);
    const gaps = [];
    if (idx > 0) gaps.push(best.x - anchors[idx - 1].x);
    if (idx < anchors.length - 1) gaps.push(anchors[idx + 1].x - best.x);
    const half = Math.max(cw, Math.min(...gaps, Infinity) / 2);
    const posConf = Math.max(0, 1 - Math.abs(r.x - best.x) / half);
    const base = 0.5 + 0.45 * posConf;

    switch (best.role) {
      case 'action':
        r.role = 'action';
        r.conf = base;
        if (r.x < cal.L - 2 * cw) r.conf = Math.min(r.conf, 0.5);
        break;
      case 'character':
        if (looksLikeCharacter(t)) {
          r.role = 'character';
          r.conf = base;
        } else if (t.startsWith('(') && t.endsWith(')')) {
          r.role = 'paren';
          r.conf = base * 0.8;
        } else if (up && r.x > cal.C + 3 * cw) {
          r.role = 'transition';
          r.conf = 0.55;
        } else {
          r.role = 'dialogue';
          r.conf = Math.min(base, 0.45);
        }
        break;
      case 'paren':
        if (t.startsWith('(')) {
          r.role = 'paren';
          r.conf = base;
          if (!t.endsWith(')')) parenOpen = true;
        } else {
          r.role = 'dialogue';
          r.conf = Math.min(base, 0.6);
        }
        break;
      default: // dialogue
        if (t.startsWith('(') && (t.endsWith(')') || !t.includes(')'))) {
          r.role = 'paren';
          r.conf = base * 0.85;
          if (!t.endsWith(')')) parenOpen = true;
        } else {
          r.role = 'dialogue';
          r.conf = base;
        }
    }
    if (r.role === 'paren' && t.startsWith('(') && !t.endsWith(')') && !parenOpen) parenOpen = true;
    if (r.role !== 'paren') parenOpen = false;
    r.conf = round2(r.conf);
  }
}

// ------------------------------------------------------ costruzione doc ----
function buildDoc(rows, cal, moreOnPage, warnings, title) {
  const lines = [];
  const scenes = [];
  let scene = null;
  let curChar = null; // personaggio corrente (contesto di dialogo)
  let curExt = null;
  let openDialogue = null; // riga dialogue ancora estendibile
  let openAction = null;
  let lastRow = null;
  let lowConf = 0;
  const confs = new Map(); // riga -> [conf]
  const firstOnPage = new Set();
  const seenPage = new Set();
  for (const r of rows) {
    if (!seenPage.has(r.page)) {
      seenPage.add(r.page);
      firstOnPage.add(r);
    }
  }

  const push = (type, text, conf, extra = {}) => {
    const line = {
      id: 'L' + String(lines.length + 1).padStart(4, '0'),
      order: lines.length,
      type,
      character: extra.character ?? null,
      text,
      sceneId: scene ? scene.id : null,
      confidence: conf,
    };
    if (extra.characterExt) line.characterExt = extra.characterExt;
    confs.set(line, [conf]);
    lines.push(line);
    if (scene) scene.lineIds.push(line.id);
    return line;
  };
  const extend = (line, add, conf, sep = ' ') => {
    line.text = squash(line.text + sep + add);
    confs.get(line).push(conf);
  };
  const closeAll = () => {
    openDialogue = null;
    openAction = null;
  };

  const handleCharacter = (text, conf, r, isDual) => {
    const { name, exts } = stripExt(text);
    const contd = exts.some((e) => CONTD_RE.test(e));
    const allExt = exts.join(' ');
    // continuazione di battuta spezzata tra pagine: niente nuova riga character
    if (
      !isDual &&
      r &&
      firstOnPage.has(r) &&
      openDialogue &&
      name === curChar &&
      (contd || moreOnPage.has(r.page - 1))
    ) {
      return;
    }
    curChar = name;
    curExt = allExt || null;
    openAction = null;
    push('character', name, conf, { character: name, characterExt: allExt || undefined });
    openDialogue = null;
  };

  const handleDialogue = (text, conf) => {
    if (openDialogue) {
      extend(openDialogue, text, conf);
    } else {
      let c = conf;
      if (!curChar) {
        c = Math.min(c, 0.4);
        if (!lines.some((l) => l._orphanWarned)) warnings.push('dialogo senza personaggio riconosciuto (battuta orfana)');
      }
      openDialogue = push('dialogue', text, c, { character: curChar, characterExt: curExt || undefined });
      if (!curChar) openDialogue._orphanWarned = true;
    }
  };

  const flushDual = (left, right) => {
    const emit = (stream) => {
      if (!stream.length) return;
      let first = true;
      for (const t of stream) {
        if (looksLikeCharacter(t) && !t.startsWith('(') && (first || openDialogue)) {
          if (first || stream.indexOf(t) === 0) {
            handleCharacter(t, 0.4, null, true);
            first = false;
            continue;
          }
        }
        first = false;
        if (t.startsWith('(') && t.endsWith(')')) {
          push('parenthetical', t, 0.4, { character: curChar });
        } else handleDialogue(t, 0.4);
      }
      openDialogue = null;
    };
    emit(left);
    emit(right);
  };

  // dual dialogue: raccolta a flussi paralleli
  let dual = null;
  const endDual = () => {
    if (!dual) return;
    warnings.push(
      `dual dialogue rilevato a pagina ${dual.page + 1}: ricostruito come due battute consecutive (best effort)`,
    );
    closeAll();
    flushDual(dual.left, dual.right);
    dual = null;
  };

  for (const r of rows) {
    const gapBig = lastRow && lastRow.page === r.page && lastRow.y - r.y > cal.lineStep * 2.2;
    if (dual && (r.page !== dual.page || gapBig)) {
      endDual();
    }
    if (r.dual) {
      if (!dual) {
        dual = { page: r.page, left: [], right: [] };
        closeAll();
      }
      const mid = r.pageW * 0.45;
      for (const c of r.cells) (c.x < mid ? dual.left : dual.right).push(c.text);
      lastRow = r;
      continue;
    }
    if (dual) {
      // riga a una sola colonna dentro a un blocco dual
      const mid = r.pageW * 0.45;
      (r.x < mid ? dual.left : dual.right).push(r.text);
      lastRow = r;
      continue;
    }

    let conf = r.conf;
    const gapParagraph =
      lastRow && lastRow.page === r.page ? lastRow.y - r.y > cal.lineStep * 1.5 : false;
    switch (r.role) {
      case 'scene': {
        let heading = r.text.replace(/^\d+[A-Z]?[.\s]+(?=\S)/, '').trim();
        heading = squash(heading);
        scene = { id: 'S' + String(scenes.length + 1).padStart(3, '0'), heading, lineIds: [] };
        scenes.push(scene);
        closeAll();
        curChar = null;
        curExt = null;
        push('scene', heading, conf);
        break;
      }
      case 'transition':
        closeAll();
        curChar = null;
        curExt = null;
        push('transition', r.text, conf);
        break;
      case 'action':
        openDialogue = null;
        curChar = null;
        curExt = null;
        if (
          openAction &&
          !gapParagraph &&
          (lastRow.page === r.page || !TERMINAL_RE.test(openAction.text))
        ) {
          extend(openAction, r.text, conf);
        } else openAction = push('action', r.text, conf);
        break;
      case 'character':
        handleCharacter(r.text, conf, r, false);
        break;
      case 'paren': {
        openAction = null;
        const prev = lines[lines.length - 1];
        if (prev && prev.type === 'parenthetical' && lastRow && lastRow.role === 'paren' && !prev.text.endsWith(')')) {
          extend(prev, r.text, conf);
        } else push('parenthetical', r.text, conf, { character: curChar });
        break;
      }
      case 'dialogue':
        openAction = null;
        handleDialogue(r.text, conf);
        break;
      default:
        break;
    }
    lastRow = r;
  }
  endDual();

  // confidenza finale e pulizia
  for (const line of lines) {
    const cs = confs.get(line);
    line.confidence = round2(cs.reduce((s, c) => s + c, 0) / cs.length);
    delete line._orphanWarned;
    if (line.confidence < 0.6) lowConf++;
    if (line.type !== 'character' && line.type !== 'dialogue' && line.type !== 'parenthetical') line.character = null;
    if (line.type === 'dialogue') line.text = line.text.replace(/\s*\((?:CONT['’`]?D|SEGUE|CONTINUA|MORE)\)\s*$/i, '').trim();
  }
  if (lowConf) warnings.push(`${lowConf} righe a bassa confidenza (<0.6): da rivedere nell'anteprima`);
  return { title, source: 'pdf', scenes, lines };
}

// ---------------------------------------------------------- API pubblica ----
/**
 * @param {Uint8Array|Buffer|ArrayBuffer} input contenuto del PDF
 * @returns {Promise<{title:string, source:'pdf', scenes:object[], lines:object[], warnings:string[], confidence:number}>}
 */
export async function parsePdf(input) {
  const warnings = [];
  let pages;
  try {
    if (!input || !input.byteLength) return emptyDoc(['PDF vuoto o non leggibile']);
    pages = await extractPages(input);
  } catch (err) {
    return emptyDoc([`PDF non leggibile: ${err && err.message ? err.message : err}`]);
  }

  try {
    const cw = estimateCharWidth(pages);
    let allRows = [];
    pages.forEach((pg, i) => allRows.push(...buildRows(pg, i, cw)));
    if (!allRows.length) return emptyDoc([EMPTY_TEXT_WARNING]);

    const { rows: cleaned, moreOnPage } = cleanRows(allRows, pages, warnings);
    if (!cleaned.length) return emptyDoc([EMPTY_TEXT_WARNING]);
    splitSpecialCells(cleaned, cw);

    // pagine iniziali senza scene heading (frontespizio): scartate, titolo = prima riga
    let rows = cleaned;
    let title = '';
    const firstScenePage = rows.find((r) => !r.dual && r.cells.length && SCENE_RE.test(r.text) && isUpper(r.text));
    if (firstScenePage && firstScenePage.page > 0) {
      const front = rows.filter((r) => r.page < firstScenePage.page);
      title = front.length ? front[0].text : '';
      rows = rows.filter((r) => r.page >= firstScenePage.page);
    }

    const cal = calibrate(rows, cw, warnings);
    classify(rows, cal);
    const doc = buildDoc(rows, cal, moreOnPage, warnings, title);
    if (!doc.scenes.length && doc.lines.length) warnings.push('nessuna scene heading riconosciuta');
    if (!doc.lines.length) return emptyDoc([...warnings, EMPTY_TEXT_WARNING]);
    doc.warnings = warnings;
    doc.confidence = round2(doc.lines.reduce((s, l) => s + l.confidence, 0) / doc.lines.length);
    return doc;
  } catch (err) {
    return emptyDoc([...warnings, `errore durante l'analisi del PDF: ${err && err.message ? err.message : err}`]);
  }
}
