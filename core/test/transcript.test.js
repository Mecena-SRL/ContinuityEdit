import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tcToFrames, framesToTc } from '../src/transcript/timecode.js';
import { parseResolveTranscript } from '../src/transcript/parse.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const START = 25 * 3600; // 01:00:00:00 a 25 fps

test('tcToFrames relativo allo start TC', () => {
  assert.equal(tcToFrames('01:00:00:00', 25, START), 0);
  assert.equal(tcToFrames('01:00:02:10', 25, START), 60);
  assert.equal(tcToFrames('00:00:01:05', 25), 30);
  assert.equal(tcToFrames('00:00:01:05', 23.976), 29); // fps nominale 24
});

test('tcToFrames: malformato -> null, oltre 24h ok, mezzanotte avvolta', () => {
  assert.equal(tcToFrames('boh', 25), null);
  assert.equal(tcToFrames(undefined, 25), null);
  assert.equal(tcToFrames('00:00:01:00', 0), null);
  assert.equal(tcToFrames('25:00:00:00', 25, 0), 25 * 3600 * 25);
  assert.equal(tcToFrames('00:00:01:00', 25, 23 * 3600 * 25), 3600 * 25 + 25);
});

test('framesToTc e round-trip', () => {
  assert.equal(framesToTc(60, 25, START), '01:00:02:10');
  assert.equal(framesToTc(0, 25), '00:00:00:00');
  assert.equal(framesToTc(NaN, 25), null);
  for (const fr of [0, 1, 24, 25, 12345, 86399]) {
    assert.equal(tcToFrames(framesToTc(fr, 30, START), 30, START), fr);
  }
});

test('parse: fixture sintetica', () => {
  const d = parseResolveTranscript(fx('transcript_sample.json'), { clipId: 'c1', fps: 25, startTcFrames: START });
  assert.equal(d.clipId, 'c1');
  assert.equal(d.language, 'it');
  assert.deepEqual(d.words.map((w) => w.text), ['Buongiorno', 'a', 'tutti,', "l'incontro", 'comincia.', 'Perché', 'no?']);
  assert.deepEqual(d.words[3].tokens, ['l', 'incontro']);
  assert.deepEqual(d.words.map((w) => w.i), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(d.words.map((w) => w.seg), [0, 0, 0, 0, 0, 1, 1]);
  assert.equal(d.words[0].speaker, 'Speaker 1');
  assert.equal(d.words[5].speaker, null);
  assert.equal(d.words[0].startFrame, 60);
  assert.equal(d.words[2].endFrame, d.words[2].startFrame); // durata 0 conservata
  assert.deepEqual(d.gaps, [
    { startFrame: 0, endFrame: 50 },
    { startFrame: 85, endFrame: 100 },
  ]);
  assert.deepEqual(d.segments, [
    { startFrame: 60, endFrame: 125, speaker: 'Speaker 1', firstWord: 0, lastWord: 4 },
    { startFrame: 150, endFrame: 200, speaker: null, firstWord: 5, lastWord: 6 },
  ]);
});

test('parse: input malformati senza eccezioni', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { segments: 'no' }]) {
    const d = parseResolveTranscript(bad, { clipId: 'c', fps: 25 });
    assert.deepEqual([d.words, d.gaps, d.segments], [[], [], []]);
  }
  const d = parseResolveTranscript(fx('transcript_malformed.json'), { clipId: 'c', fps: 25, startTcFrames: 0 });
  assert.deepEqual(d.words.map((w) => w.text), ['tardi']); // "..." senza token scartato
  assert.equal(d.words[0].startFrame, 25 * 3600 * 25);
  assert.equal(d.segments.length, 1);
});
