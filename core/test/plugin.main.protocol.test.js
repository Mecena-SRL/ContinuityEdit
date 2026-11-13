import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseRange, contentTypeFor, createMediaRegistry, planResponse } = require('../../plugin/main/protocol.js');

test('parseRange: intervalli, suffisso, apertura, clamp, invalidi', () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=50-5000', 100), { start: 50, end: 99 });
  assert.deepEqual(parseRange('bytes=0-1,5-9', 100), { start: 0, end: 1 });
  for (const bad of ['bytes=100-', 'bytes=9-3', 'bytes=-', 'items=0-1', 'bytes=-0', 'boh']) {
    assert.deepEqual(parseRange(bad, 100), { invalid: true }, bad);
  }
  assert.deepEqual(parseRange('bytes=0-1', 0), { invalid: true });
});

test('contentTypeFor', () => {
  assert.equal(contentTypeFor('/a/B.MOV'), 'video/quicktime');
  assert.equal(contentTypeFor('x.mp4'), 'video/mp4');
  assert.equal(contentTypeFor('x.m4v'), 'video/mp4');
  assert.equal(contentTypeFor('x.mxf'), 'application/mxf');
  assert.equal(contentTypeFor('x.xyz'), 'application/octet-stream');
});

test('registro: token opachi, idempotenti, nessun percorso nell\'URL', () => {
  let n = 0;
  const reg = createMediaRegistry({ randomToken: () => `t${++n}` });
  const u1 = reg.register('/Volumes/media/clip.mov');
  assert.equal(u1, 'ce-media://clip/t1');
  assert.equal(reg.register('/Volumes/media/clip.mov'), u1);
  assert.equal(reg.register('/altra.mp4'), 'ce-media://clip/t2');
  assert.equal(reg.size, 2);
  assert.equal(reg.register(''), null);
  assert.equal(reg.register(null), null);
  assert.equal(reg.resolve(u1), '/Volumes/media/clip.mov');
  // percorsi arbitrari, token ignoti, altri host/schemi: mai serviti
  for (const bad of ['ce-media://clip/etc/passwd', 'ce-media://clip/..%2F..%2Fetc%2Fpasswd', 'ce-media://clip/zzz', 'ce-media://other/t1',
    'file:///etc/passwd', 'ce-media://clip/', 'non un url', 'https://clip/t1']) {
    assert.equal(reg.resolve(bad), null, bad);
  }
  assert.equal(reg.resolve('ce-media://clip/t1?x=1'), '/Volumes/media/clip.mov');
});

test('planResponse: 200, 206, 416, 403, 404 con header CORS', () => {
  const reg = createMediaRegistry({ randomToken: () => 'tk' });
  const url = reg.register('/m/a.mov');
  const full = planResponse({ registry: reg, url, size: 1000 });
  assert.equal(full.status, 200);
  assert.equal(full.headers['Content-Type'], 'video/quicktime');
  assert.equal(full.headers['Content-Length'], '1000');
  assert.equal(full.headers['Accept-Ranges'], 'bytes');
  assert.equal(full.headers['Access-Control-Allow-Origin'], '*');
  assert.deepEqual([full.start, full.end, full.filePath], [0, 999, '/m/a.mov']);
  const part = planResponse({ registry: reg, url, size: 1000, rangeHeader: 'bytes=100-199' });
  assert.equal(part.status, 206);
  assert.equal(part.headers['Content-Range'], 'bytes 100-199/1000');
  assert.equal(part.headers['Content-Length'], '100');
  assert.deepEqual([part.start, part.end], [100, 199]);
  const bad = planResponse({ registry: reg, url, size: 1000, rangeHeader: 'bytes=5000-' });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers['Content-Range'], 'bytes */1000');
  const forbidden = planResponse({ registry: reg, url: 'ce-media://clip/nope', size: 10 });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(forbidden.filePath, undefined);
  assert.equal(planResponse({ registry: reg, url, size: null }).status, 404);
});
