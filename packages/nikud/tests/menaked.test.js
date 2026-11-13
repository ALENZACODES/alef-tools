import test from 'node:test';
import assert from 'node:assert/strict';
import { src, ort, fakeSession, patahEverywhere } from './helpers.js';
const { encode, decode, keepExisting, createMenaked } = await import(src('menaked.js'));
const { NIKUD_CLASSES, MAT_LECT, stripPoints } = await import(src('hebrew.js'));

const logits = (text, picks) => {
  const n = text.length + 2;
  const nikud = new Float32Array(n * NIKUD_CLASSES.length), shin = new Float32Array(n * 2);
  [...text].forEach((_, i) => { const p = picks[i] || {}; nikud[(i + 1) * NIKUD_CLASSES.length + NIKUD_CLASSES.indexOf(p.n ?? '')] = 3; shin[(i + 1) * 2 + (p.sin ? 1 : 0)] = 3; });
  return { nikud, shin };
};

test('encode: one id per character, the ends added, unknown characters as 0', () => {
  const ids = encode('אב 1x');
  assert.equal(ids.length, 7);
  assert.equal(ids[0], 1); assert.equal(ids.at(-1), 2);
  assert.ok(ids.slice(1, -1).every((x) => x >= 6));
  assert.notEqual(ids[1], ids[2]);
  assert.equal(encode('😀').slice(1, -1).every((x) => x === 0), true); // outside the table
  assert.equal(encode('A')[1], encode('a')[1]); // lower-cased like the model's own tokenizer
});

test('decode puts the chosen marks on each letter and leaves everything else alone', () => {
  const text = 'שלום, שר!';
  const { nikud, shin } = logits(text, { 0: { n: 'ָ' }, 1: { n: '' }, 2: { n: 'ֹ' }, 3: { n: '' }, 6: { n: 'ָ', sin: true }, 7: { n: '' } });
  // order on a shin: the dot first, then the vowel
  assert.equal(decode(text, nikud, shin), 'ש\u05c1\u05b8לו\u05b9ם, ש\u05c2\u05b8ר!');
});

test('a vowel letter is kept by default; the spelling never changes', () => {
  const text = 'לימוד';
  const picks = { 0: { n: 'ִ' }, 1: { n: MAT_LECT }, 2: { n: 'ּ' }, 3: { n: 'ּ' }, 4: { n: '' } };
  const { nikud, shin } = logits(text, picks);
  assert.equal(decode(text, nikud, shin), 'לִימּוּד');
  assert.equal(decode(text, nikud, shin, { keepMatres: false }), 'לִמּוּד');
  // a kept vav takes the vowel it stands for: holam moves onto it, kubutz becomes its dot
  const boker = logits('בוקר', { 0: { n: '\u05bc\u05b9' }, 1: { n: MAT_LECT }, 2: { n: '\u05b6' }, 3: { n: '' } });
  assert.equal(decode('בוקר', boker.nikud, boker.shin), 'ב\u05bcו\u05b9ק\u05b6ר');
  const meyuhad = logits('מיוחד', { 0: { n: '\u05b0' }, 1: { n: '\u05bb' }, 2: { n: MAT_LECT }, 3: { n: '\u05b8' }, 4: { n: '' } });
  assert.equal(decode('מיוחד', meyuhad.nikud, meyuhad.shin), 'מ\u05b0יו\u05bcח\u05b8ד');
  assert.equal(decode('בוקר', boker.nikud, boker.shin, { keepMatres: false }), 'ב\u05bc\u05b9ק\u05b6ר');
  // the vowel-letter class on a letter that cannot be one is ignored
  const odd = logits('דג', { 0: { n: MAT_LECT }, 1: { n: '' } });
  assert.equal(decode('דג', odd.nikud, odd.shin), 'דג');
});

test('keepExisting: words that came with points keep them', () => {
  assert.equal(keepExisting('שָׁלוֹם עולם', 'שַׁלַוַםַ עַוַלַםַ'), 'שָׁלוֹם עַוַלַםַ');
});

test('point: bare words are pointed, pointed words are kept, letters never change', async () => {
  const m = createMenaked({ ort, session: fakeSession(patahEverywhere) });
  const r = await m.point('שָׁלוֹם עולם, 12 abc');
  assert.equal(r.text, 'שָׁלוֹם עַוַלַםַ, 12 abc');
  assert.equal(r.changed, true);
  assert.equal(r.name, false);
});

test('point: text with cantillation marks is returned exactly as it came', async () => {
  const calls = [];
  const m = createMenaked({ ort, session: fakeSession(patahEverywhere, { calls }) });
  const verse = 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים';
  const r = await m.point(verse);
  assert.equal(r.text, verse);
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'cantillation');
  assert.equal(calls.length, 0, 'the model is not even asked');
});

test('point: the divine Name becomes he + geresh and carries no points', async () => {
  const m = createMenaked({ ort, session: fakeSession(patahEverywhere) });
  const r = await m.point('ברוך אתה יהוה');
  assert.equal(r.name, true);
  assert.ok(r.text.endsWith(' ה׳'), r.text);
  assert.ok(!r.text.includes('יהוה'));
  const pre = await m.point('הודו ליהוה');
  assert.ok(/ לַה׳$/.test(pre.text), pre.text);
});

test('point: text without Hebrew is returned as it came; long text goes in pieces and comes back whole', async () => {
  const calls = [];
  const m = createMenaked({ ort, session: fakeSession(() => ({}), { calls }) });
  assert.deepEqual(await m.point('hello'), { text: 'hello', changed: false, name: false, reason: 'no-hebrew' });
  const long = Array.from({ length: 80 }, () => 'זה משפט בעברית.').join(' ');
  const r = await m.point(long);
  assert.equal(stripPoints(r.text), long);
  assert.ok(calls.length > 1);
  assert.ok(calls.every((n) => n <= 402));
});
