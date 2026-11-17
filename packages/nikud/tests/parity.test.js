import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { src } from './helpers.js';
const { encode, decode } = await import(src('menaked.js'));
const { NIKUD_CLASSES, stripPoints, guardName, PREFIX } = await import(src('hebrew.js'));

const doc = JSON.parse(readFileSync(new URL('./fixtures/parity.json', import.meta.url), 'utf8'));
// class numbers -> the kind of arrays the graph returns
const asLogits = (c) => {
  const n = c.text.length + 2;
  const nikud = new Float32Array(n * NIKUD_CLASSES.length), shin = new Float32Array(n * 2), extra = c.extra ? new Float32Array(n * 3).fill(-1) : null;
  c.nikud.forEach((k, i) => { nikud[(i + 1) * NIKUD_CLASSES.length + k] = 9; shin[(i + 1) * 2 + c.shin[i]] = 9; if (extra) c.extra[i].forEach((on, j) => { if (on) extra[(i + 1) * 3 + j] = 1; }); });
  return { nikud, shin, extra };
};

test('the browser code turns real model output into the same text as the offline tools', () => {
  assert.ok(doc.cases.length >= 20);
  for (const c of doc.cases) {
    const { nikud, shin, extra } = asLogits(c);
    assert.equal(decode(c.text, nikud, shin, { extra }), c.keep, `${c.model}: ${c.text}`);
    assert.equal(decode(c.text, nikud, shin, { extra, keepMatres: false }), c.drop, `${c.model} (vowel letters dropped): ${c.text}`);
  }
});

test('the browser tokenizer gives the same ids as the offline one', () => {
  for (const c of doc.cases) assert.deepEqual(encode(c.text), c.ids, c.text);
});

test('pointing never changes a letter', () => {
  for (const c of doc.cases) assert.equal(stripPoints(c.keep).split(PREFIX).join(''), c.text);
});

test('the Name rule and point stripping agree with the offline tools', () => {
  for (const n of doc.names) assert.deepEqual(guardName(n.in), { text: n.out, found: n.found }, n.in);
  for (const s of doc.strips) assert.equal(stripPoints(s.in), s.out, s.in);
});
