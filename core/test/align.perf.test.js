import test from 'node:test';
import assert from 'node:assert/strict';
import { alignClip } from '../src/align/align.js';
import { makeScript, makeTranscript, rng } from './align.helpers.js';

// Trascrizione da 50k parole, script da 500 battute: soglia generosa (CI lenta).
test('prestazioni: 50k parole x 500 battute', () => {
  const rand = rng(42);
  const syl = ['ba', 'ro', 'ni', 'te', 'sa', 'li', 'mo', 've', 'ca', 'do', 'pu', 'ra', 'gi', 'lo', 'fe', 'zu'];
  const vocab = [];
  for (let i = 0; i < 6000; i++) {
    let w = '';
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) w += syl[Math.floor(rand() * syl.length)];
    vocab.push(w + i.toString(36));
  }
  const common = ['di', 'che', 'il', 'la', 'non', 'un', 'per', 'con', 'ma', 'si', 'io', 'tu'];
  const pick = () => (rand() < 0.35 ? common[Math.floor(rand() * common.length)] : vocab[Math.floor(rand() * vocab.length)]);
  const sentence = (n) => Array.from({ length: n }, pick).join(' ');

  const lineTexts = [];
  const pieces = [];
  let total = 0;
  const lines = [];
  for (let k = 0; k < 500; k++) {
    const txt = sentence(10 + Math.floor(rand() * 10));
    lines.push(['P' + (k % 5), txt]);
    lineTexts.push(txt);
  }
  // 500 battute pronunciate (una ogni due, 250 coperte) intervallate da 60-140 parole di rumore
  for (let k = 0; k < 500; k++) {
    const nz = 60 + Math.floor(rand() * 80);
    pieces.push(sentence(nz));
    total += nz;
    if (k % 2 === 0) { pieces.push(lineTexts[k]); total += lineTexts[k].split(' ').length; }
  }
  while (total < 50000) { pieces.push(sentence(100)); total += 100; }
  const t = makeTranscript(pieces);
  assert.ok(t.words.length >= 50000);
  const s = makeScript(lines);

  const t0 = performance.now();
  const r = alignClip(s, t);
  const ms = performance.now() - t0;
  console.log(`  align 50k parole x 500 battute: ${ms.toFixed(0)} ms, ${r.coverages.length} coverage`);
  assert.ok(ms < 30000, `troppo lento: ${ms}ms`);
  const got = new Set(r.coverages.filter((c) => c.ratio > 0.9).map((c) => c.lineId));
  let hit = 0;
  for (let k = 0; k < 500; k += 2) if (got.has(s.lines[k].id)) hit++;
  assert.ok(hit >= 240, `trovate ${hit}/250`);
  // falsi positivi rari tra le battute non pronunciate
  let fp = 0;
  for (let k = 1; k < 500; k += 2) if (got.has(s.lines[k].id)) fp++;
  assert.ok(fp <= 5, `falsi positivi ${fp}`);
});
