import test from 'node:test';
import assert from 'node:assert/strict';
import { json, vocabText, lib } from './helpers.js';
const { createTokenizer } = await lib('tokenize.js');
const { prefixOptions, decode, splitPrefix } = await lib('joint.js');
const { fromJoint } = await lib('lookup.js');

const labels = json('tests/fixtures/pack/labels.json');
const tok = createTokenizer(json('tests/fixtures/pack/tokenizer.json'), vocabText());
const { cases } = json('tests/fixtures/joint-cases.json');

test('joint: the prefix-options input is the one the model code builds', () => {
  for (const c of cases) assert.deepEqual(prefixOptions(tok.encode(c.text).tokens, labels), c.prefixOptions, c.text);
});

test('joint: decoding recorded graph outputs gives the answer of the model code, word for word', () => {
  let words = 0;
  for (const c of cases) {
    const got = decode(tok.encode(c.text), c.out, labels, tok.pieces);
    assert.equal(got.length, c.expect.length, c.text);
    got.forEach((w, i) => {
      const e = c.expect[i];
      assert.deepEqual({ token: w.token, lemma: w.lemma, prefix: w.prefix, base: w.base, pos: w.pos, feats: w.feats, prefixPos: w.prefixPos, suffix: w.suffix, suffixFeats: w.suffixFeats, ner: w.ner }, e, `${c.text} / ${e.token}`);
      words++;
    });
  }
  assert.ok(words >= 250, `only ${words} words compared`);
});

test('joint: word positions point at the word in the text', () => {
  const c = cases[cases.length - 3];
  for (const w of decode(tok.encode(c.text), c.out, labels, tok.pieces)) assert.equal(c.text.slice(w.start, w.end), w.token);
});

test('joint: a stack of prefixes is split longest first', () => {
  assert.deepEqual(splitPrefix('וכשה', labels), ['ו', 'כש', 'ה']);
  assert.deepEqual(splitPrefix('מה', labels), ['מ', 'ה']);
});

test('lookup.fromJoint: same shape as the lesson data; a root only from the roots table; nothing for the Name', () => {
  const c = cases.find((x) => x.text.includes('וכשהלכתי'));
  const ws = decode(tok.encode(c.text), c.out, labels, tok.pieces);
  const first = fromJoint(ws[0], { lemmas: {} });
  assert.equal(first.a.p, 'וכש');
  assert.equal(first.entry, null);
  const withRoot = fromJoint({ ...ws[0], lemma: 'הלך' }, { lemmas: { 'הלך': ['ה־ל־ך', "pa'al", 0] } });
  assert.deepEqual([withRoot.entry.root, withRoot.entry.binyan, withRoot.entry.rootChecked], ['ה־ל־ך', "pa'al", false]);
  assert.equal(fromJoint({ ...ws[0], token: 'יהוה' }, {}), null);
  assert.equal(fromJoint({ ...ws[0], lemma: 'יהוה' }, {}), null);
});
