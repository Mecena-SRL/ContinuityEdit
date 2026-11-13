import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitCharacter } from '../src/script/character.js';
import { splitCharacter as fdxSplit, parseFdx } from '../src/script/fdx.js';
import { splitCharacter as indexSplit } from '../src/script/index.js';
import { parsePdf } from '../src/script/pdf.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const S = (raw) => splitCharacter(raw);

test('export condiviso: stessa funzione da fdx.js e index.js', () => {
  assert.equal(fdxSplit, splitCharacter);
  assert.equal(indexSplit, splitCharacter);
});

test('estensioni italiane/inglesi tra parentesi, suffisso e prefisso', () => {
  const cases = [
    ['V.O. ROSSI', 'ROSSI', 'V.O.'],
    ['ROSSI (V.O.)', 'ROSSI', 'V.O.'],
    ['ROSSI V.O.', 'ROSSI', 'V.O.'],
    ['ROSSI (O.S.)', 'ROSSI', 'O.S.'],
    ['O.S. ROSSI', 'ROSSI', 'O.S.'],
    ['ROSSI (F.C.)', 'ROSSI', 'F.C.'],
    ["ROSSI (CONT'D)", 'ROSSI', "CONT'D"],
    ['ROSSI (SEGUE)', 'ROSSI', 'SEGUE'],
    ['ROSSI (OFF)', 'ROSSI', 'OFF'],
    ['ROSSI (VOCE)', 'ROSSI', 'VOCE'],
    ['ROSSI (AL TELEFONO)', 'ROSSI', 'AL TELEFONO'],
    ['ROSSI (VOCE FUORI CAMPO)', 'ROSSI', 'VOCE FUORI CAMPO'],
    ['ROSSI FUORI CAMPO', 'ROSSI', 'FUORI CAMPO'],
    ['ROSSI (O.C.)', 'ROSSI', 'O.C.'],
    ['ROSSI (CONTD)', 'ROSSI', 'CONTD'],
    ['ROSSI (MORE)', 'ROSSI', 'MORE'],
    ["ROSSI (V.O.) (CONT'D)", 'ROSSI', "V.O. CONT'D"],
    ["V.O. ROSSI (CONT'D)", 'ROSSI', "V.O. CONT'D"],
    ["ROSSI V.O. (CONT'D)", 'ROSSI', "V.O. CONT'D"],
    ['ANNA MARIA ROSSI (V.O.)', 'ANNA MARIA ROSSI', 'V.O.'],
    ["rossi (v.o.) (cont’d)", 'ROSSI', "V.O. CONT'D"],
    ['ROSSI', 'ROSSI', null],
    ['ROSSI ^', 'ROSSI', null],
  ];
  for (const [raw, name, ext] of cases) assert.deepEqual(S(raw), { name, ext }, raw);
});

test('nomi veri non scambiati per estensioni', () => {
  assert.deepEqual(S('OFF'), { name: 'OFF', ext: null });
  assert.deepEqual(S('VOCE'), { name: 'VOCE', ext: null });
  assert.deepEqual(S('MORE'), { name: 'MORE', ext: null });
  assert.deepEqual(S('OFF (V.O.)'), { name: 'OFF', ext: 'V.O.' });
  assert.deepEqual(S('VOCE (CONT\'D)'), { name: 'VOCE', ext: "CONT'D" });
});

test('FDX: cue con prefisso V.O. e combinazioni', () => {
  const xml = `<?xml version="1.0"?><FinalDraft><Content>
<Paragraph Type="Scene Heading"><Text>INT. CUCINA - GIORNO</Text></Paragraph>
<Paragraph Type="Character"><Text>V.O. ROSSI</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>Sono in ritardo.</Text></Paragraph>
<Paragraph Type="Character"><Text>ROSSI (V.O.) (CONT'D)</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>Arrivo.</Text></Paragraph>
</Content></FinalDraft>`;
  const d = parseFdx(xml).lines.filter((l) => l.type === 'dialogue');
  assert.deepEqual(d.map((l) => [l.character, l.characterExt]), [
    ['ROSSI', 'V.O.'],
    ['ROSSI', "V.O. CONT'D"],
  ]);
});

test('PDF esistente: character base e characterExt senza parentesi', async () => {
  const doc = await parsePdf(fixture('sceneggiatura_it.pdf'));
  for (const l of doc.lines) {
    if (l.character) assert.ok(!/[()]|V\.O\./.test(l.character), l.character);
    if (l.characterExt) assert.ok(!/[()]/.test(l.characterExt), l.characterExt);
  }
  const vo = doc.lines.find((l) => l.type === 'dialogue' && l.text.startsWith('Oggi telefonera'));
  assert.equal(vo.character, 'ELVIRA');
  assert.match(vo.characterExt, /V\.O\./);
});
