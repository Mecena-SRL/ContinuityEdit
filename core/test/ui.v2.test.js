import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_STEPS, shouldShowGuide } from '../../plugin/renderer/viewmodel/guide.js';
import { orderTakesForColumns, buildColumnPlan, multicamGroups, anglesForGroup } from '../../plugin/renderer/viewmodel/groups.js';
import { filterTakeList, patchFromKey, parseTags, gradePalette, markFor } from '../../plugin/renderer/viewmodel/marks.js';
import { buildEdit, typeFromKey, TYPE_OPTIONS } from '../../plugin/renderer/viewmodel/scriptedit.js';
import { layoutSequence, totalFrames, clampTrim, dropIndex, trackFromY, rangeForLines, lineSpan, cutawayLineIds, masterTakeId, freeTrack, trackLabel } from '../../plugin/renderer/viewmodel/sequence.js';
import { zoomAt, screenToWorld, fitView, orderedStills, frameFromRatio, clampSize, boundsOf } from '../../plugin/renderer/viewmodel/board.js';

test('guida: 5 passi, primo avvio', () => {
  assert.equal(GUIDE_STEPS.length, 5);
  assert.ok(shouldShowGuide(null));
  assert.ok(!shouldShowGuide(true));
});

test('gruppi multicam: colonne adiacenti e angoli', () => {
  const takes = [{ id: 'A', groupId: 'G' }, { id: 'B' }, { id: 'C', groupId: 'G', angle: 'CAM Z' }];
  assert.deepEqual(orderTakesForColumns(takes).map((t) => t.id), ['A', 'C', 'B']);
  const p = buildColumnPlan(takes);
  assert.deepEqual(p.cols.map((c) => c.angle), ['CAM A', 'CAM Z', null]);
  assert.deepEqual(p.groups, [{ groupId: 'G', from: 0, count: 2 }]);
  assert.equal(multicamGroups(takes).length, 1);
  assert.deepEqual(anglesForGroup(['x', 'y'], { y: 'CAM Q' }), [{ takeId: 'x', angle: 'CAM A' }, { takeId: 'y', angle: 'CAM Q' }]);
});

test('valutazioni: filtri, tasti, tag', () => {
  const takes = [{ id: 1, rating: 'buono', grade: 'B+' }, { id: 2, rating: 'scarto', grade: '' }, { id: 3, rating: null, grade: 'B' }];
  assert.deepEqual(filterTakeList(takes, { rating: 'buono' }).map((t) => t.id), [1]);
  assert.deepEqual(filterTakeList(takes, { rating: 'tutti', grades: ['B', 'B+'] }).map((t) => t.id), [1, 3]);
  assert.deepEqual(filterTakeList(takes, { rating: 'scarto' }).map((t) => t.id), [2]);
  assert.deepEqual(patchFromKey('2', {}, ['B', 'B+']), { grade: 'B+' });
  assert.deepEqual(patchFromKey('2', { grade: 'B+' }, ['B', 'B+']), { grade: '' });
  assert.equal(patchFromKey('3', {}, ['B', 'B+']), null);
  assert.deepEqual(patchFromKey('b', { rating: 'buono' }), { rating: null });
  assert.deepEqual(patchFromKey('x', {}), { rating: 'scarto' });
  assert.deepEqual(parseTags(' a, b ,a,,c'), ['a', 'b', 'c']);
  assert.deepEqual(gradePalette({}), ['B', 'B+', 'B++']);
  assert.deepEqual(markFor({ marks: { 'T|L': { rating: 'buono' } } }, 'T', 'L'), { rating: 'buono' });
});

test('spoglio: edit e scorciatoie', () => {
  const line = { id: 'L1', text: 'Hello world' };
  assert.deepEqual(buildEdit(line, 0, 0, 'action'), { op: 'setType', lineId: 'L1', type: 'action' });
  assert.deepEqual(buildEdit(line, 0, 11, 'scene'), { op: 'setType', lineId: 'L1', type: 'scene' });
  assert.deepEqual(buildEdit(line, 8, 2, 'character'), { op: 'retypeSelection', lineId: 'L1', startOffset: 2, endOffset: 8, type: 'character' });
  assert.equal(typeFromKey({ altKey: true, key: 'D' }), 'dialogue');
  assert.equal(typeFromKey({ altKey: false, key: 'd' }), null);
  assert.equal(TYPE_OPTIONS.length, 7);
});

test('sequenza: layout, trim, drop, regia', () => {
  const items = [
    { id: 'a', track: 1, startFrame: 0, endFrame: 50 },
    { id: 'b', track: 1, startFrame: 100, endFrame: 130 },
    { id: 'c', track: 2, startFrame: 0, endFrame: 20, recordFrame: 10 },
  ];
  const lay = layoutSequence(items, 2);
  assert.deepEqual(lay.map((l) => [l.startAt, l.w]), [[0, 100], [50, 60], [10, 40]]);
  assert.equal(totalFrames(items), 80);
  assert.deepEqual(clampTrim(-5, 2000, 500, 'end'), { startFrame: 0, endFrame: 500 });
  assert.deepEqual(clampTrim(30, 20, 500, 'start'), { startFrame: 19, endFrame: 20 });
  assert.equal(dropIndex(items, 'a', 1, 1000), 2);
  assert.equal(dropIndex(items, 'b', 1, 5), 0);
  assert.equal(trackFromY(5, 40, 2), 2);
  assert.equal(trackFromY(45, 40, 2), 1);
  assert.deepEqual(rangeForLines([{ lineId: 'x', startFrame: 10, endFrame: 20 }, { lineId: 'y', startFrame: 25, endFrame: 60 }], ['x', 'y']), { startFrame: 10, endFrame: 60 });
  assert.equal(rangeForLines([], ['x']), null);
  const L = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(lineSpan(L, ['c', 'a']), { fromLineId: 'a', toLineId: 'c' });
  assert.equal(lineSpan(L, []), null);
  assert.deepEqual(cutawayLineIds(L, { fromLineId: 'b', toLineId: 'd' }), ['b', 'c', 'd']);
  assert.equal(masterTakeId([{ role: 'cutaway', takeId: 'x' }, { role: 'master', takeId: 'm' }]), 'm');
  const cuts = [{ id: 'k1', role: 'cutaway', track: 2, startFrame: 0, endFrame: 50, recordFrame: 100 }];
  assert.equal(freeTrack(cuts, 200, 30), 2);
  assert.equal(freeTrack(cuts, 120, 30), 3);
  assert.equal(freeTrack(cuts, 120, 30, 'k1'), 2);
  assert.equal(trackLabel(2), 'V2');
});

test('lavagna: zoom, fit, ordini', () => {
  const v = { x: 0, y: 0, k: 1 };
  const z = zoomAt(v, 2, 100, 50);
  assert.deepEqual(screenToWorld(z, 100, 50), { x: 100, y: 50 }); // il punto resta fermo
  assert.equal(zoomAt(v, 100, 0, 0).k, 3);
  const items = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 100, w: 100, h: 100 }];
  assert.deepEqual(boundsOf(items), { x: 0, y: 0, w: 400, h: 200 });
  const f = fitView(items, 880, 500);
  assert.ok(f.k > 0 && f.k <= 1.5);
  const st = [{ type: 'still', id: 1, x: 50, y: 0, z: 2 }, { type: 'note', id: 2, x: 0, y: 0 }, { type: 'still', id: 3, x: 10, y: 90, z: 1 }];
  assert.deepEqual(orderedStills(st, 'x').map((i) => i.id), [3, 1]);
  assert.deepEqual(orderedStills(st, 'y').map((i) => i.id), [1, 3]);
  assert.deepEqual(orderedStills(st, 'z').map((i) => i.id), [3, 1]);
  assert.equal(frameFromRatio(1, 100), 99);
  assert.equal(frameFromRatio(0.5, 101), 50);
  assert.deepEqual(clampSize(10, 500.4), { w: 60, h: 500 });
});

import { cacheKey, frameFromX, xFromFrame, quantizeFrame, autoScanFrames, LruCache, pruneIndex, VideoPool, SeekQueue, placeholderTimecode } from '../../plugin/renderer/viewmodel/thumbs.js';

test('miniature: chiavi, frame da posizione, scansione', () => {
  assert.equal(cacheKey('C1', 120.4, 320), 'C1|120|320');
  assert.equal(frameFromX(0, 200, 1000), 0);
  assert.equal(frameFromX(200, 200, 1000), 999);
  assert.equal(frameFromX(-5, 200, 1000), 0);
  assert.equal(frameFromX(100, 0, 1000), 0);
  assert.equal(xFromFrame(999, 200, 1000), 200);
  assert.equal(quantizeFrame(123, 25), 125);
  assert.deepEqual(autoScanFrames(4, 1000), [125, 375, 625, 875]);
  assert.equal(autoScanFrames(1000, 10).length, 60);
  assert.equal(placeholderTimecode(90, 25), '00:00:03:15');
});

test('miniature: LRU per byte e indice IndexedDB', () => {
  const c = new LruCache({ maxBytes: 100 });
  c.set('a', 1, 60); c.set('b', 2, 30);
  c.get('a');
  assert.deepEqual(c.set('c', 3, 30), ['b']);
  assert.ok(c.has('a') && c.has('c') && !c.has('b'));
  const idx = [{ key: 'x', size: 60, ts: 3 }, { key: 'y', size: 60, ts: 1 }, { key: 'z', size: 60, ts: 2 }];
  assert.deepEqual(pruneIndex(idx, 100), ['y', 'z']);
  assert.deepEqual(pruneIndex(idx, 1000), []);
});

test('miniature: pool video max 3 e coda di seek con annullamento scrub', () => {
  const p = new VideoPool(3);
  assert.equal(p.touch('a'), null); p.touch('b'); p.touch('c');
  assert.equal(p.touch('a'), null);
  assert.equal(p.touch('d'), 'b');
  const q = new SeekQueue();
  assert.deepEqual(q.push({ id: 1, scrub: true }), []);
  assert.deepEqual(q.push({ id: 2, scrub: false }), []);
  assert.deepEqual(q.push({ id: 3, scrub: true }).map((x) => x.id), [1]);
  assert.deepEqual([q.next().id, q.next().id, q.next()], [2, 3, null]);
});
