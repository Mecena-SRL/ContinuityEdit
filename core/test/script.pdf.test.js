import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePdf } from '../src/script/pdf.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

/** PDF minimale scritto a mano: una pagina US letter con (o senza) testo. */
function handMadePdf(textLines) {
  const content = textLines.length
    ? 'BT /F1 12 Tf 108 700 Td 14 TL ' + textLines.map((l) => `(${l}) Tj T*`).join(' ') + ' ET'
    : '';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += String(off).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const byType = (doc, type) => doc.lines.filter((l) => l.type === type);

test('PDF scansionato (senza testo): ScriptDoc vuoto con warning, nessuna eccezione', async () => {
  const doc = await parsePdf(handMadePdf([]));
  assert.equal(doc.source, 'pdf');
  assert.deepEqual(doc.lines, []);
  assert.deepEqual(doc.scenes, []);
  assert.ok(doc.warnings.includes('nessun testo estraibile (PDF scansionato?)'));
});

test('input illeggibile o vuoto: nessuna eccezione', async () => {
  for (const bad of [Buffer.from('non sono un pdf'), new Uint8Array(0), new Uint8Array([1, 2, 3])]) {
    const doc = await parsePdf(bad);
    assert.deepEqual(doc.lines, []);
    assert.ok(doc.warnings.length >= 1);
  }
});

test('PDF minimale scritto a mano con layout piatto: parsing senza errori', async () => {
  const doc = await parsePdf(handMadePdf(['INT. STANZA - GIORNO', 'Un uomo aspetta.']));
  assert.equal(doc.scenes.length, 1);
  assert.equal(doc.scenes[0].heading, 'INT. STANZA - GIORNO');
  assert.equal(byType(doc, 'action').length, 1);
});

test('sceneggiatura italiana: scene, ruoli e struttura', async () => {
  const doc = await parsePdf(fixture('sceneggiatura_it.pdf'));
  assert.equal(doc.source, 'pdf');
  assert.equal(doc.title, 'LE PERE DI IVANO');
  assert.deepEqual(
    doc.scenes.map((s) => s.heading),
    [
      'INT. CASA DI ELVIRA - CUCINA - MATTINA',
      'EST. PIAZZA DEL MERCATO - GIORNO',
      'INT. CASA DI ELVIRA - SOGGIORNO - SERA',
      'EST. TERRAZZO DI CASA BRANDOLINI - NOTTE',
    ],
  );
  // numeri di scena a margine e numeri di pagina non finiscono nel testo
  for (const l of doc.lines) assert.ok(!/^\d+\.?$/.test(l.text), `riga spuria: ${l.text}`);
  assert.deepEqual(
    byType(doc, 'transition').map((l) => l.text),
    ['DISSOLVENZA IN:', 'TAGLIO A:', 'DISSOLVENZA A:', 'TAGLIO A:', 'DISSOLVENZA A NERO.'],
  );
  const parens = byType(doc, 'parenthetical').map((l) => l.text);
  assert.ok(parens.includes('(sottovoce)'));
  assert.ok(parens.includes('(la voce incrinata)'));
  // ogni riga di scena e' referenziata dalla propria scena
  for (const s of doc.scenes) {
    for (const id of s.lineIds) assert.equal(doc.lines.find((l) => l.id === id).sceneId, s.id);
  }
  // ids/ordine e confidence
  doc.lines.forEach((l, i) => {
    assert.equal(l.order, i);
    assert.equal(l.id, 'L' + String(i + 1).padStart(4, '0'));
    assert.ok(l.confidence >= 0 && l.confidence <= 1);
  });
  assert.ok(Array.isArray(doc.warnings));
});

test('dialoghi: paragrafi uniti, nomi puliti, CONT\'D/SEGUE rimossi', async () => {
  const doc = await parsePdf(fixture('sceneggiatura_it.pdf'));
  const d = byType(doc, 'dialogue');
  const first = d[0];
  assert.equal(first.character, 'ELVIRA');
  assert.equal(first.text, "Hai dormito poco, Teodoro. Si vede. Il caffe' e' pronto, almeno quello.");
  const vo = d.find((l) => l.text.startsWith('Oggi telefonera'));
  assert.equal(vo.character, 'ELVIRA');
  assert.match(vo.characterExt, /V\.O\./);
  for (const l of doc.lines) {
    assert.ok(!/\(SEGUE\)|\(CONT'?D\)|\bMORE\b/.test(l.text), `marcatore residuo: ${l.text}`);
    if (l.character) assert.ok(!/[()]/.test(l.character));
  }
});

test('battuta spezzata tra pagine unita in una sola riga dialogue', async () => {
  const doc = await parsePdf(fixture('sceneggiatura_it.pdf'));
  const long = byType(doc, 'dialogue').filter((l) => l.character === 'IVANO' && l.text.startsWith('Ciao, papa'));
  assert.equal(long.length, 1);
  assert.match(long[0].text, /prometto di non andarmene prima di cena\. Poi, se vuoi, me ne vado\.$/);
  // nessuna riga character "IVANO" duplicata dal (SEGUE) di inizio pagina
  const idx = doc.lines.indexOf(long[0]);
  assert.equal(doc.lines[idx - 1].type, 'character');
  assert.equal(doc.lines[idx - 1].text, 'IVANO');
  assert.notEqual(doc.lines[idx + 1].text, 'IVANO');
});

test('dual dialogue: due battute consecutive con warning', async () => {
  const doc = await parsePdf(fixture('sceneggiatura_it.pdf'));
  assert.ok(doc.warnings.some((w) => /dual dialogue/i.test(w)));
  const d = byType(doc, 'dialogue');
  const a = d.find((l) => l.text.startsWith('Sei dimagrito'));
  const b = d.find((l) => l.text.startsWith('Siediti'));
  assert.equal(a.character, 'ELVIRA');
  assert.equal(a.text, 'Sei dimagrito. Ti faccio un brodo.');
  assert.equal(b.character, 'TEODORO');
  assert.equal(b.text, 'Siediti, non stare in piedi. Lascia il brodo, Elvira.');
  assert.ok(a.confidence < 0.6 && b.confidence < 0.6);
});

test('sceneggiatura inglese con indentazioni diverse (calibrazione relativa) e header ripetuto', async () => {
  const doc = await parsePdf(fixture('screenplay_en.pdf'));
  assert.deepEqual(
    doc.scenes.map((s) => s.heading),
    ['INT. HARBOR OFFICE - DAY', 'EXT. CARGO PIER - NIGHT'],
  );
  assert.ok(!doc.lines.some((l) => /HARBOR LIGHTS/.test(l.text)), 'header ripetuto non rimosso');
  assert.deepEqual(
    byType(doc, 'transition').map((l) => l.text),
    ['FADE IN:', 'CUT TO:', 'SMASH CUT TO:'],
  );
  const dario = byType(doc, 'dialogue').find((l) => l.text.startsWith('The tram'));
  assert.equal(dario.character, 'DARIO');
  assert.equal(dario.characterExt, 'O.S.');
  // "(MORE)" a fondo pagina + "DARIO (CONT'D)" a inizio pagina: una sola battuta
  assert.equal(
    dario.text,
    'The tram broke down. I ran the last mile, I swear, I ran all the way and I still missed it by ten minutes.',
  );
  assert.equal(byType(doc, 'character').filter((l) => l.text === 'DARIO').length, 2);
  assert.ok(byType(doc, 'parenthetical').some((l) => l.text === '(not looking up)'));
});

test('accetta Uint8Array, Buffer e ArrayBuffer', async () => {
  const buf = fixture('screenplay_en.pdf');
  const a = await parsePdf(buf);
  const b = await parsePdf(new Uint8Array(buf));
  const c = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(a.lines.length, b.lines.length);
  assert.equal(a.lines.length, c.lines.length);
  assert.ok(a.lines.length > 10);
});
