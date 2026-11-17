import test from 'node:test';
import assert from 'node:assert/strict';
import { json, vocabText, lib } from './helpers.js';
const { createTokenizer } = await lib('tokenize.js');

const tok = createTokenizer(json('tests/fixtures/pack/tokenizer.json'), vocabText());

test('tokenizer: ids and offsets match the model tokenizer on every recorded sentence', () => {
  const { cases } = json('tests/fixtures/tokenizer-cases.json');
  assert.ok(cases.length >= 250);
  for (const c of cases) {
    const e = tok.encode(c.text);
    assert.deepEqual(e.ids, c.ids, c.text);
    assert.deepEqual(e.offsets, c.offsets, c.text);
  }
});

test('tokenizer: vowel points do not change the ids, and offsets still point into the pointed text', () => {
  const pointed = 'אֲנִי רוֹצָה קָפֶה', plain = 'אני רוצה קפה';
  const a = tok.encode(pointed), b = tok.encode(plain);
  assert.deepEqual(a.ids, b.ids);
  assert.equal(pointed.slice(a.offsets[1][0], a.offsets[1][1]), 'אֲנִי');
});

test('tokenizer: an acronym with gershayim stays one word, as the model was trained', () => {
  assert.deepEqual(tok.encode('המו"מ לשלום').tokens.slice(1, 3), ['המו"מ', 'לשלום']);
});

test('tokenizer: a very long text is cut at the limit and says so', () => {
  const e = tok.encode('שלום עולם '.repeat(400), { maxTokens: 64 });
  assert.equal(e.ids.length, 64);
  assert.equal(e.truncated, true);
  assert.equal(e.tokens[63], '[SEP]');
});
