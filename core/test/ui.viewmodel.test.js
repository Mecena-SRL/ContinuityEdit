import { test } from 'node:test';
import assert from 'node:assert/strict';
import { framesToTimecode, formatDuration, parseFrameInput, takeColor, percent } from '../../plugin/renderer/viewmodel/format.js';
import { sceneList, filterLines, searchMatches, highlightParts, rangeBetween, updateSelection, sortByScriptOrder } from '../../plugin/renderer/viewmodel/script.js';
import { buildCoverageLayout, uncoveredLineIds, sourceKind } from '../../plugin/renderer/viewmodel/coverage.js';
import { compareTakes, anchorsForLine, warningsFor } from '../../plugin/renderer/viewmodel/compare.js';
import { scriptSummary, lowConfidenceLines, takeStats, assemblySummary } from '../../plugin/renderer/viewmodel/summary.js';

const L = (id, type, text, sceneId, extra = {}) => ({ id, type, text, sceneId, character: null, syncable: type === 'action' || type === 'dialogue', ...extra });
const lines = [
  L('L1', 'scene', 'INT. CUCINA - GIORNO', 'S1'),
  L('L2', 'action', 'Marta posa le chiavi.', 'S1'),
  L('L3', 'dialogue', 'Non tornerà più.', 'S1', { character: 'MARTA' }),
  L('L4', 'action', 'Esce.', 'S1'),
  L('L5', 'scene', 'EST. STRADA - NOTTE', 'S2'),
  L('L6', 'action', 'Piove.', 'S2'),
];

test('timecode e durate', () => {
  assert.equal(framesToTimecode(0, 25), '00:00:00:00');
  assert.equal(framesToTimecode(90, 25), '00:00:03:15');
  assert.equal(framesToTimecode(10, 25, 90000), '01:00:00:10');
  assert.equal(framesToTimecode(24, 23.976), '00:00:01:00');
  assert.equal(formatDuration(50, 25), '2.0 s');
  assert.equal(formatDuration(25 * 65, 25), '1:05.0');
});

test('parseFrameInput accetta frame e timecode', () => {
  assert.equal(parseFrameInput(' 120 ', 25), 120);
  assert.equal(parseFrameInput('00:00:01:05', 25), 30);
  assert.equal(parseFrameInput('00:00:01:25', 25), null);
  assert.equal(parseFrameInput('abc', 25), null);
  assert.equal(parseFrameInput('', 25), null);
});

test('colori e percentuali', () => {
  assert.equal(takeColor(0), takeColor(8));
  assert.equal(percent(0.876), '88%');
  assert.equal(percent(null), '–');
});

test('scene, filtri e ricerca (senza accenti)', () => {
  const sc = sceneList(lines);
  assert.deepEqual(sc.map((s) => [s.id, s.heading, s.count]), [['S1', 'INT. CUCINA - GIORNO', 4], ['S2', 'EST. STRADA - NOTTE', 2]]);
  assert.deepEqual(filterLines(lines, { sceneId: 'S2' }).map((l) => l.id), ['L5', 'L6']);
  assert.deepEqual(filterLines(lines, { query: 'TORNERA PIU' }).map((l) => l.id), ['L3']);
  assert.deepEqual(searchMatches(lines, 'marta'), ['L2', 'L3']); // testo e personaggio
  assert.deepEqual(searchMatches(lines, ''), []);
  const parts = highlightParts('Non tornerà più.', 'torner');
  assert.deepEqual(parts, [{ text: 'Non ', hit: false }, { text: 'torner', hit: true }, { text: 'à più.', hit: false }]);
});

test('selezione multipla con shift/ctrl', () => {
  assert.deepEqual(rangeBetween(lines, 'L4', 'L2'), ['L2', 'L3', 'L4']);
  let s = updateSelection(lines, [], null, 'L2', 'replace');
  assert.deepEqual(s, { selected: ['L2'], anchor: 'L2' });
  s = updateSelection(lines, s.selected, s.anchor, 'L4', 'range');
  assert.deepEqual(s.selected, ['L2', 'L3', 'L4']);
  assert.equal(s.anchor, 'L2');
  s = updateSelection(lines, s.selected, s.anchor, 'L3', 'toggle');
  assert.deepEqual(s.selected, ['L2', 'L4']);
  assert.deepEqual(sortByScriptOrder(lines, ['L6', 'L2', 'XX']), ['L2', 'L6']);
});

const takes = [{ id: 'T1', clipId: 'C1', label: 'Ciak 1' }, { id: 'T2', clipId: 'C2', label: 'Ciak 2' }];
const cov = (lineId, takeId, o = {}) => ({ lineId, takeId, startFrame: 0, endFrame: 50, estimated: false, source: 'auto', ratio: 0.9, ...o });
const coverage = {
  T1: [cov('L2', 'T1'), cov('L3', 'T1'), cov('L4', 'T1', { estimated: true, source: 'manual' }), cov('L6', 'T1')],
  T2: [cov('L3', 'T2', { source: 'manual', ratio: undefined })],
};

test('layout delle linee di copertura: colonne, altezze, estimated', () => {
  const lay = buildCoverageLayout(lines, takes, coverage, { L3: 'T2' }, { L3: 'T1' });
  assert.deepEqual(lay.columns.map((c) => c.col), [0, 1]);
  const t1 = lay.segments.filter((s) => s.takeId === 'T1');
  // L2-L3 piena (2 righe), L4 estimated (1 riga, segmento a parte), L6 sola
  assert.deepEqual(t1.map((s) => [s.fromRow, s.toRow, s.rows, s.estimated]), [[1, 2, 2, false], [3, 3, 1, true], [5, 5, 1, false]]);
  assert.deepEqual(lay.rows.L2[0].pos, 'start');
  assert.equal(lay.rows.L3[0].pos, 'end');
  assert.equal(lay.rows.L3[0].best, true);
  assert.equal(lay.rows.L3[1].chosen, true);
  assert.equal(lay.rows.L1[0].covered, false);
  assert.equal(lay.segments.find((s) => s.takeId === 'T2').rows, 1);
});

test('layout con filtro: la contiguità segue le righe visibili', () => {
  const vis = lines.filter((l) => l.id !== 'L5'); // L4 e L6 diventano adiacenti
  const lay = buildCoverageLayout(vis, takes, { T1: [cov('L4', 'T1'), cov('L6', 'T1')] });
  assert.deepEqual(lay.segments.map((s) => s.rows), [2]);
});

test('righe non coperte e sorgenti', () => {
  assert.deepEqual([...uncoveredLineIds(lines, coverage)], []);
  assert.deepEqual([...uncoveredLineIds(lines, { T1: [cov('L2', 'T1')] })].sort(), ['L3', 'L4', 'L6']);
  assert.equal(sourceKind('manual'), 'manual');
  assert.equal(sourceKind(undefined), 'auto');
});

test('confronto take, ancore, avvisi', () => {
  const view = { lines, takes, coverage, bestTake: { L3: 'T1' }, warnings: [{ type: 'edge-order', anchorIds: ['A2'], message: 'x' }] };
  const r = compareTakes('L3', view, { L3: 'T2' }, { C1: { fps: 25 } });
  assert.deepEqual(r.map((x) => [x.takeId, x.best, x.chosen, x.durationFrames]), [['T1', true, false, 50], ['T2', false, true, 50]]);
  const anchors = [
    { id: 'A1', takeId: 'T1', lineId: 'L3', edge: 'end', frame: 90 },
    { id: 'A2', takeId: 'T1', lineId: 'L3', edge: 'start', frame: 40 },
    { id: 'A3', takeId: 'T2', lineId: 'L3', edge: 'start', frame: 1 },
  ];
  assert.deepEqual(anchorsForLine(anchors, 'L3', 'T1').map((a) => a.id), ['A2', 'A1']);
  assert.equal(warningsFor(view.warnings, anchors, 'L3', 'T1').length, 1);
  assert.equal(warningsFor(view.warnings, anchors, 'L3', 'T2').length, 0);
});

test('riepiloghi', () => {
  const sd = { title: 'T', source: 'pdf', scenes: [{}, {}], lines: [{ type: 'scene', confidence: 0.4 }, { type: 'action', confidence: 0.95 }, { type: 'dialogue' }] };
  const s = scriptSummary(sd);
  assert.equal(s.low, 1);
  assert.equal(s.action, 1);
  assert.equal(s.scenes, 2);
  assert.ok(Math.abs(s.confidence - 0.675) < 1e-9);
  assert.equal(lowConfidenceLines(sd.lines).length, 1);
  const st = takeStats({ lines, takes, coverage });
  assert.deepEqual(st.T1, { covered: 4, syncable: 4, auto: 3, manual: 1, estimated: 1 });
  assert.equal(assemblySummary({ ok: true, timelineName: 'A', itemsAdded: 2, skipped: [{ lineId: 'L1' }] }), 'Timeline "A": 2 clip aggiunte, 1 riga saltata.');
  assert.match(assemblySummary({ ok: false, reason: 'boh' }), /boh/);
});
