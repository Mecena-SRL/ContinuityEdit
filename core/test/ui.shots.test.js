import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHOT_OPTIONS, shotLabel, shotAbbr, shotFromKey, sheetFrames, shotState, scanProgress, filterScanTakes, stepIndex, actionForKey, groupSections, shotTag, sourceLabel,
} from '../../plugin/renderer/viewmodel/shots.js';

test('scansione: opzioni, tasti 1-5 ed etichette', () => {
  assert.deepEqual(SHOT_OPTIONS.map((o) => o.key), ['1', '2', '3', '4', '5']);
  assert.deepEqual(SHOT_OPTIONS.map((o) => o.abbr), ['TOT', 'MED', 'STR', 'DET', 'ALT']);
  assert.equal(shotFromKey('3'), 'stretto');
  assert.equal(shotFromKey('9'), null);
  assert.equal(shotLabel('totale'), 'Totale');
  assert.equal(shotAbbr('dettaglio'), 'DET');
  assert.equal(shotAbbr(null), '');
  assert.equal(sourceLabel('metadati'), 'da metadati');
});

test('sheetFrames: inizio, meta\' e fine dentro la clip', () => {
  assert.deepEqual(sheetFrames(1000), [40, 500, 959]);
  for (const d of [1, 2, 3, 10]) {
    const f = sheetFrames(d);
    assert.equal(f.length, 3);
    assert.ok(f.every((x) => x >= 0 && x <= d - 1));
    assert.ok(f[0] <= f[1] && f[1] <= f[2]);
  }
  assert.deepEqual(sheetFrames(0), [0, 0, 0]);
});

test('shotState: confermato, proposta da metadati, ipotesi di copertura, mancante', () => {
  assert.deepEqual(shotState({ shot: 'medio', shotSource: 'manuale' }), { state: 'confermato', shot: 'medio', source: 'manuale', proposed: null });
  assert.equal(shotState({ shot: 'medio', shotSource: 'copertura' }).state, 'confermato');
  const m = shotState({ shot: 'totale', shotSource: 'metadati' });
  assert.deepEqual([m.state, m.proposed], ['proposta', { shot: 'totale', source: 'manuale' }]);
  const h = shotState({ shot: null }, { shot: 'stretto' });
  assert.deepEqual([h.state, h.source, h.proposed], ['proposta', null, { shot: 'stretto', source: 'copertura' }]);
  assert.equal(shotState({}).state, 'mancante');
  assert.equal(shotState(undefined).state, 'mancante');
});

test('scanProgress e filtri', () => {
  const takes = [
    { id: 'a', shot: 'totale', shotSource: 'manuale' },
    { id: 'b', shot: 'medio', shotSource: 'metadati' },
    { id: 'c' }, { id: 'd' },
  ];
  const hyps = { d: { shot: 'stretto' } };
  assert.deepEqual(scanProgress(takes, hyps), { totale: 4, confermati: 1, proposte: 2, mancanti: 1, daFare: 3 });
  assert.deepEqual(filterScanTakes(takes, 'tutti', hyps).map((t) => t.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(filterScanTakes(takes, 'da-fare', hyps).map((t) => t.id), ['b', 'c', 'd']);
  assert.deepEqual(filterScanTakes(takes, 'mancanti', hyps).map((t) => t.id), ['c']);
});

test('navigazione e tasti: 1-5 imposta, Invio conferma, 0 azzera', () => {
  assert.equal(stepIndex(0, -1, 3), 0);
  assert.equal(stepIndex(2, 1, 3), 2);
  assert.equal(stepIndex(1, 1, 3), 2);
  assert.equal(stepIndex(0, 1, 0), -1);
  assert.deepEqual(actionForKey('2', {}), { type: 'set', shot: 'medio', source: 'manuale' });
  assert.deepEqual(actionForKey('Enter', { shot: 'totale', shotSource: 'metadati' }), { type: 'set', shot: 'totale', source: 'manuale' });
  assert.deepEqual(actionForKey('Enter', {}, { shot: 'stretto' }), { type: 'set', shot: 'stretto', source: 'copertura' });
  assert.equal(actionForKey('Enter', {}), null); // niente da confermare
  assert.equal(actionForKey('Enter', { shot: 'medio', shotSource: 'manuale' }), null);
  assert.deepEqual(actionForKey('0', { shot: 'medio' }), { type: 'clear' });
  assert.equal(actionForKey('0', {}), null);
  assert.equal(actionForKey('x', {}), null);
});

test('groupSections e shotTag', () => {
  const takes = [{ id: 'a', groupId: 'G2' }, { id: 'b' }, { id: 'c', groupId: 'G10' }, { id: 'd', groupId: 'G2' }];
  const s = groupSections(takes);
  assert.deepEqual(s.map((x) => [x.groupId, x.takes.map((t) => t.id)]), [['G2', ['a', 'd']], ['G10', ['c']], [null, ['b']]]);
  assert.equal(shotTag({ shot: 'totale', shotSource: 'manuale' }), 'TOT');
  assert.equal(shotTag({ shot: 'stretto', shotSource: 'metadati' }), 'STR');
  assert.equal(shotTag({}, { shot: 'stretto' }), 'STR?');
  assert.equal(shotTag({}), '');
});
