import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, editDistance, errorRates } from '../scripts/metrics.mjs';

test('normalizeText keeps letters and single spaces; a maqaf separates words', () => {
  assert.equal(normalizeText('שָׁלוֹם,  עוֹלָם!'), 'שלום עולם');
  assert.equal(normalizeText('כָּל־הָאָרֶץ'), 'כל הארץ');
  assert.equal(normalizeText('FIC West 12'), 'fic west 12');
});

test('editDistance and pooled error rates', () => {
  assert.equal(editDistance([...'שלום'], [...'שלם']), 1);
  assert.equal(editDistance([], [...'אב']), 2);
  const r = errorRates([{ ref: 'שלום עולם', hyp: 'שלום עולם' }, { ref: 'בוקר טוב', hyp: 'בוקר' }]);
  assert.equal(r.words, 4); assert.equal(r.wer, 0.25);
  assert.ok(Math.abs(r.cer - 4 / 17) < 1e-9); // " טוב" is four characters of seventeen
});
