// The on-device search (src/search.js) against a small index built by the real builder (scripts/build_search.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const { tokens, queryTerms, heForms, openIndex, search, entry, loadIndex } = await import(process.env.ALEF_TEST_DIST ? '../dist/search.js' : '../src/search.js');

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = [
  { type: 'ask', id: 'a1', title: 'Where does the Torah talk about Shabbat?', arg: 'Where does the Torah talk about Shabbat?', text: 'sabbath | day of rest', wordings: ['מה התורה אומרת על שבת?'], extra: [['מנוחה', 0.5]] },
  { type: 'ask', id: 'a2', title: 'What does the Torah say about kosher food?', arg: 'What does the Torah say about kosher food?', text: 'kashrut | which animals may be eaten', wordings: ['אילו חיות כשרות?'] },
  { type: 'ask', id: 'a3', title: 'Who was Miriam?', arg: 'Who was Miriam?', text: 'miriam the prophetess', wordings: ['מי הייתה מרים?'] },
  { type: 'lesson', id: 'r01', title: 'Shabbat candles and Kiddush', text: 'bless the candles | נרות candles' },
  { type: 'unit', id: 'pu-cafe', title: 'Ordering at a cafe', text: 'קפה coffee | חלב milk', lessons: ['il06'] },
  { type: 'word', id: 'v1', title: 'מַיִם: water', arg: 'מים', text: 'מים water', exact: ['מים', 'water'] },
  { type: 'word', id: 'v2', title: 'יוֹם: day', arg: 'יום', text: 'יום day', exact: ['יום', 'day'] },
  { type: 'word', id: 'v3', title: 'יוֹם שִׁשִּׁי: Friday (day six)', arg: 'יום שישי', text: 'יום שישי friday', exact: ['יום שישי', 'friday'] },
];
// vectors: a1 and r01 point the same way (both about Shabbat); the rest are spread out
const DIMS = 4;
const VEC = [[127, 0, 0, 0], [0, 127, 0, 0], [0, 0, 127, 0], [120, 30, 0, 0], [0, 0, 0, 127], [0, 90, 90, 0], [0, -90, 90, 0], [0, -80, 80, 30]];

function build(extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'alef-search-'));
  writeFileSync(join(dir, 'search.docs.json'), JSON.stringify({ built: '2026-11-12', docs: DOCS, dims: DIMS, model: { id: 'test' }, vectors_b64: Buffer.from(Int8Array.from(VEC.flat()).buffer).toString('base64') }));
  const r = spawnSync(process.execPath, [join(here, '..', 'scripts', 'build_search.mjs'), '--work', dir, '--out', join(dir, 'out'), ...extraArgs], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const json = JSON.parse(readFileSync(join(dir, 'out', 'index.v1.json'), 'utf8'));
  const b = readFileSync(join(dir, 'out', 'index.v1.vec'));
  return { dir, json, bin: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
}
const built = build();
const ix = openIndex(built.json, built.bin);
const ids = (res) => res.map((r) => r.type + ':' + r.id);

test('tokens: English is stemmed and common words dropped; Hebrew loses its points and final letters fold', () => {
  assert.deepEqual(tokens('What does the Torah say about blessings?'), ['blessing']);
  assert.deepEqual(tokens('שַׁבָּת שָׁלוֹם'), ['שבת', 'שלומ']);
  assert.deepEqual(tokens('על־לבבך'), ['לבבכ']);
});

test('heForms: a Hebrew word is also found without its prefix letters and endings', () => {
  assert.ok(heForms('והשבת').includes('שבת'));
  assert.ok(heForms('חיות').includes('חי'));
  assert.ok(queryTerms('בשבת').get('שבת') < 1);
});

test('an English question finds the checked answer', () => {
  assert.equal(ids(search(ix, 'what does the torah say about shabbat'))[0], 'ask:a1');
  assert.equal(ids(search(ix, 'is kashrut in the Torah?'))[0], 'ask:a2');
});

test('a Hebrew question finds the same answers through the Hebrew wordings in the index', () => {
  assert.equal(ids(search(ix, 'מה כתוב בתורה על שבת?'))[0], 'ask:a1');
  assert.equal(ids(search(ix, 'מי הייתה מרים'))[0], 'ask:a3');
  assert.equal(ids(search(ix, 'חיות כשרות'))[0], 'ask:a2');
});

test('a cross-language word attached at build time finds the entry', () => {
  assert.equal(ids(search(ix, 'מנוחה'))[0], 'ask:a1');
});

test('a one-word question puts the dictionary entry for exactly that word first', () => {
  assert.equal(ids(search(ix, 'day'))[0], 'word:v2');
  assert.equal(ids(search(ix, 'יום'))[0], 'word:v2');
  assert.equal(ids(search(ix, 'water'))[0], 'word:v1');
});

test('with near > 0, entries whose vector is close to the best match are pulled up; by default and without vectors they are not', () => {
  const withVec = ids(search(ix, 'sabbath rest', { limit: 3, near: 0.5 }));
  assert.deepEqual(ids(search(ix, 'sabbath rest', { limit: 3 })), ['ask:a1']);
  assert.deepEqual(withVec.slice(0, 2), ['ask:a1', 'lesson:r01']);
  const wordsOnly = openIndex(built.json, null);
  assert.deepEqual(ids(search(wordsOnly, 'sabbath rest', { limit: 3, near: 0.5 })), ['ask:a1']);
});

test('types filter, limit and links', () => {
  assert.deepEqual(ids(search(ix, 'shabbat', { types: ['lesson'] })), ['lesson:r01']);
  assert.equal(search(ix, 'shabbat candles kosher coffee water', { limit: 2 }).length, 2);
  assert.equal(search(ix, 'shabbat')[0].href, '#/ask?q=' + encodeURIComponent('Where does the Torah talk about Shabbat?'));
  assert.equal(entry(ix, 4).href, '#/practical/pu-cafe');
  assert.equal(entry(ix, 3).href, '#/learn?lesson=r01');
  assert.equal(entry(ix, 5).href, '#/vocab?q=' + encodeURIComponent('מים'));
});

test('nothing known gives nothing; odd input does not throw', () => {
  assert.deepEqual(search(ix, 'zzzz qqqq'), []);
  for (const q of ['', '   ', '???', null, undefined, '(', 'a'.repeat(5000)]) assert.doesNotThrow(() => search(ix, q));
});

test('an optional query vector ranks by closeness when a language pack supplies one', () => {
  const res = search(ix, 'zzzz', { queryVector: Float32Array.from([0, 0, 0, 1]), limit: 1 });
  assert.equal(ids(res)[0], 'unit:pu-cafe');
});

test('a damaged index is refused', () => {
  assert.throws(() => openIndex({ schema: 'other' }));
  assert.throws(() => openIndex({ ...built.json, post: built.json.post.slice(1) }));
  assert.equal(openIndex(built.json, new ArrayBuffer(3)).vec, null); // wrong-size vector file: words-only
});

test('loadIndex fetches both files and survives a missing vector file', async () => {
  const files = { 'index.v1.json': () => ({ ok: true, json: async () => built.json }), 'index.v1.vec': () => ({ ok: false, status: 404 }) };
  const seen = [];
  const f = async (u) => { const name = String(u).split('/').pop(); seen.push(name); return files[name](); };
  const got = await loadIndex('https://example.invalid/search/', { fetchImpl: f });
  assert.deepEqual(seen, ['index.v1.json', 'index.v1.vec']);
  assert.equal(got.vec, null);
  assert.equal(ids(search(got, 'shabbat'))[0], 'ask:a1');
});

test('builder flags leave the wordings or the attached words out (used to measure what each adds)', () => {
  const a = openIndex(build(['--no-wordings']).json, null);
  assert.deepEqual(search(a, 'מי הייתה מרים'), []);
  const b = openIndex(build(['--no-extra']).json, null);
  assert.deepEqual(search(b, 'מנוחה'), []);
});
