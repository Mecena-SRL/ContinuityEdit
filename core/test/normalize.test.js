import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToken, splitTokens } from '../src/text/normalize.js';

test('normalizeToken toglie accenti e punteggiatura', () => {
  assert.equal(normalizeToken(' Perché,'), 'perche');
  assert.equal(normalizeToken('"Città."'), 'citta');
});

test('splitTokens separa le elisioni', () => {
  assert.deepEqual(splitTokens("l'occasione per noi"), ['l', 'occasione', 'per', 'noi']);
  assert.deepEqual(splitTokens('un’altra volta, 35 anni'), ['un', 'altra', 'volta', '35', 'anni']);
});

test('token vuoti scartati', () => {
  assert.deepEqual(splitTokens('(...) ...'), []);
});
