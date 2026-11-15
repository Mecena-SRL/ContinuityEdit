// La vista dello stato (inviata alla UI dopo ogni modifica) deve restare veloce sui progetti grandi e scegliere lo
// stesso "take migliore" di bestTake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as sync from '../src/sync/index.js';
import * as sequence from '../src/sequence/index.js';

const require = createRequire(import.meta.url);
const { createState } = require('../../plugin/main/state.js');

function big(nLines = 300, nTakes = 16) {
  const lines = Array.from({ length: nLines }, (_, i) => ({ id: `L${String(i + 1).padStart(4, '0')}`, order: i + 1, type: i % 3 === 0 ? 'action' : 'dialogue', character: 'A', text: `riga ${i} con parole`, sceneId: 'S1' }));
  const p = sync.createProject({ title: 'x', source: 'fdx', scenes: [{ id: 'S1', heading: 'h', lineIds: lines.map((l) => l.id) }], lines });
  for (let t = 1; t <= nTakes; t++) {
    sync.addClip(p, `C${t}`, { fps: 25, durationFrames: 100000, startTcFrames: 0, name: `c${t}` });
    sync.addTake(p, { id: `T${t}`, clipId: `C${t}` });
    for (let i = 0; i < nLines; i += (t % 3) + 1) {
      sync.addAnchor(p, { takeId: `T${t}`, lineId: lines[i].id, edge: 'start', frame: i * 200 + t, kind: t % 4 ? 'auto' : 'manual', ratio: 0.5 + ((i * t) % 50) / 100 });
      sync.addAnchor(p, { takeId: `T${t}`, lineId: lines[i].id, edge: 'end', frame: i * 200 + 150, kind: 'auto', ratio: 0.9 });
    }
  }
  sync.setSelection(p, 'L0005', 'T7');
  sync.setMark(p, 'T2', 'L0010', { rating: 'scarto' });
  sync.setMark(p, 'T5', null, { rating: 'buono', grade: 'B+' });
  return p;
}

test('vista dello stato: veloce e coerente con bestTake', () => {
  const p = big();
  const st = createState(sync, sequence);
  st.setProject(p);
  const t0 = Date.now();
  const v = st.view();
  const ms = Date.now() - t0;
  assert.ok(ms < 1500, `view() troppo lenta: ${ms} ms`);
  for (const l of sync.syncableLines(p)) assert.equal(v.bestTake[l.id], sync.bestTake(p, l.id), l.id);
});
