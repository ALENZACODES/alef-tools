import test from 'node:test';
import assert from 'node:assert/strict';
import { mod } from './helpers.js';
const { createTokens } = await mod('tokens.js');

// pieces spelled the way vocab.json spells them: one printable character per UTF-8 byte
const spell = (text) => [...Buffer.from(text, 'utf8')].map((b) => (b === 0x20 ? 'Ġ' : b >= 0x21 && b <= 0x7e ? String.fromCharCode(b) : b >= 0xa1 && b !== 0xad ? String.fromCharCode(b) : String.fromCharCode(256 + [...Array(256).keys()].filter((x) => !((x >= 33 && x <= 126) || (x >= 161 && x <= 172) || (x >= 174))).indexOf(b)))).join('');
const vocab = {}; const add = (t) => { vocab[spell(t)] = Object.keys(vocab).length; return vocab[spell(t)]; };
const SHALOM = add(' שלום'), OLAM = add(' עולם'), HELLO = add(' hello'), HALF1 = add('ש').toString() && vocab[spell('ש')];
const D7 = (() => { vocab['×'] = Object.keys(vocab).length; return vocab['×']; })(); // the lone first byte of a Hebrew letter
const TAIL = (() => { const k = String.fromCharCode(256 + [...Array(256).keys()].filter((x) => !((x >= 33 && x <= 126) || (x >= 161 && x <= 172) || (x >= 174))).indexOf(0x90)); vocab[k] = Object.keys(vocab).length; return vocab[k]; })(); // 0x90: second byte of alef
const ARABIC = add(' سلام'), DOT = add('.');
const EOT = Object.keys(vocab).length;
const added = { '<|endoftext|>': EOT, '<|startoftranscript|>': EOT + 1, '<|he|>': EOT + 2 };

test('decode joins byte pieces into Hebrew text', () => {
  const t = createTokens(vocab, added);
  assert.equal(t.eot, EOT);
  assert.equal(t.decode([SHALOM, OLAM, DOT]), 'שלום עולם.');
  assert.equal(t.decode([D7, TAIL]), 'א'); // a letter split over two pieces
  assert.equal(t.decode([SHALOM, EOT, EOT + 1]), 'שלום'); // special tokens are not text
  assert.equal(t.decode([D7]), ''); // half a letter is dropped, not shown as a broken character
  assert.equal(t.special('<|he|>'), EOT + 2);
  assert.throws(() => t.special('<|nope|>'));
});

test('hebrewOnly allows Hebrew pieces, half-letters and plain punctuation; nothing in another alphabet', () => {
  const ok = createTokens(vocab, added).hebrewOnly();
  assert.equal(ok.length, EOT);
  for (const id of [SHALOM, OLAM, HALF1, D7, TAIL, DOT]) assert.equal(ok[id], 1, `id ${id}`);
  for (const id of [HELLO, ARABIC]) assert.equal(ok[id], 0, `id ${id}`);
});
