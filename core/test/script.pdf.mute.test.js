import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePdf } from '../src/script/pdf.js';

test('sceneggiatura muta: solo scene/action/transition, niente dialogue ne dual dialogue', async () => {
  const doc = await parsePdf(readFileSync(new URL('./fixtures/muta_it.pdf', import.meta.url)));
  const types = new Set(doc.lines.map((l) => l.type));
  assert.deepEqual([...types].sort(), ['action', 'scene', 'transition']);
  assert.equal(doc.scenes.length, 3);
  assert.deepEqual(
    doc.scenes.map((s) => s.heading),
    ['EXT. SCENA 0 - CAMPAGNA', 'INT. SCENA 1 - CANTINA', 'EXT. SCENA 2 - BOSCO'],
  );
  assert.ok(!doc.warnings.some((w) => /dual dialogue/i.test(w)));
  assert.ok(doc.warnings.includes('nessun personaggio/dialogo rilevato: sceneggiatura muta?'));
  // FINE a destra e' una transition a parte, non fusa nel testo
  const tr = doc.lines.filter((l) => l.type === 'transition');
  assert.deepEqual(tr.map((l) => l.text), ['FINE']);
  assert.ok(!doc.lines.some((l) => l.type === 'action' && /FINE/.test(l.text)));
  // numeri di scena a margine e doppi spazi non finiscono nel testo
  for (const l of doc.lines) {
    assert.ok(!/^\d+$/.test(l.text));
    assert.ok(!/ {2}/.test(l.text));
  }
  // la nota indentata resta action
  assert.ok(doc.lines.some((l) => l.type === 'action' && l.text.startsWith('-NOTA-')));
});
