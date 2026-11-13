// Tokenizer, decoding loop, scoring and the translation-memory lookup. Pure code, run under Node with nothing installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mod } from './helpers.js';
const { createTokenizer, normalizeLine } = await mod('tokenizer.js'); const { createDecoder } = await mod('decode.js');
const { chrF, matchScore, strictScore, acceptedScore, summarize, openContractions } = await mod('scoring.js'); const { tmKey, fnv1a, createMemory } = await mod('tm.js');

const fx = JSON.parse(readFileSync(new URL('./fixtures/tm-keys.json', import.meta.url), 'utf8'));

test('tokenizer: the best-scoring split wins, unknown runs collapse, decode drops the special ids', () => {
  const pieces = ['</s>', '<unk>', '▁', '▁ab', 'c', '▁abc', 'a', 'b', '<pad>'];
  const tok = createTokenizer({ pieces, scores: [null, null, -5, -2, -2, -3, -4, -4, null], eos: 0, unk: 1, pad: 8 });
  assert.deepEqual(tok.encode('abc'), [5, 0]);                       // one piece (-3) beats two (-4)
  assert.deepEqual(tok.encode('ab zzz'), [3, 2, 1, 0]);             // an unknown run is one unknown piece
  assert.deepEqual(tok.encode(''), [0]);
  assert.equal(tok.decode([5, 3, 4, 0, 8]), 'abc abc');
  assert.equal(normalizeLine('שָׁלוֹם  עֲלֵיכֶם'), 'שלום עליכם');
  assert.equal(normalizeLine('“It’s” — fine…'), '"It\'s" - fine...');
});

test('decoding loop: beam search over a scripted model finds the best line and stops at the end mark', async () => {
  // A toy model over 5 pieces: after start say 3, then 4, then end. Scores live in the "hidden" vector.
  const V = 5, D = 4; const vocab = { dim: D, layers: 1, heads: 1, pieces: ['</s>', '<unk>', '<pad>', 'x', 'y'], eos: 0, pad: 2, start: 2, maxPositions: 16 };
  class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; this.location = 'cpu'; } }
  const next = { 2: 3, 3: 4, 4: 0 };
  const table = { run: async (feeds, want) => {
    if (want[0] === 'emb') { const ids = [...feeds.ids.data].map(Number); const out = new Float32Array(ids.length * D); ids.forEach((id, i) => { out[i * D] = id; }); return { emb: { data: out } }; }
    const h = feeds.hidden.data; const b = h.length / D; const logits = new Float32Array(b * V).fill(-50);
    for (let i = 0; i < b; i++) { logits[i * V] = -100; logits[i * V + next[h[i * D]]] = 5; }   // the end mark is never a runner-up
    return { logits: { data: logits } };
  } };
  const encoder = { run: async () => ({ cross_k: new Tensor('float32', new Float32Array(0), [1, 1, 1, 0, D]), cross_v: new Tensor('float32', new Float32Array(0), [1, 1, 1, 0, D]) }) };
  const decoder = { run: async (f) => { const b = f.emb.dims[0]; const hidden = new Float32Array(b * D); for (let i = 0; i < b; i++) hidden[i * D] = f.emb.data[i * D]; return { hidden: new Tensor('float32', hidden, [b, D]), new_k: f.past_k, new_v: f.past_v }; } };
  const dec = createDecoder({ ort: { Tensor }, table, encoder, decoder, vocab });
  assert.deepEqual(await dec.generate([3, 4, 0], { beams: 2 }), [3, 4]);
  assert.deepEqual(await dec.generate([3, 0], { beams: 1 }), [3, 4]);
});

test('scores: the house score, accepted wordings, and chrF equal to sacreBLEU on the recorded lines', () => {
  assert.equal(matchScore('Where is the bus?', 'where is the bus'), 1);
  assert.equal(matchScore("Where's the elevator?", 'Where is the elevator?'), 0.75);
  assert.equal(acceptedScore("Where's the elevator?", { reference: 'Where is the elevator?', direction: 'he-en' }), 1);
  assert.equal(strictScore('', { reference: 'x' }), 0);
  assert.equal(openContractions("I don't know"), 'i do not know');
  assert.ok(Math.abs(chrF(fx.chrf.pairs) - fx.chrf.corpus) < 1e-3);
  fx.chrf.pairs.forEach((p, i) => assert.ok(Math.abs(chrF([p]) - fx.chrf.sacrebleuLines[i]) < 1e-3));
  const s = summarize([{ direction: 'he-en', strict: 1, accepted: 1, translation: 'a b', reference: 'a b' }, { direction: 'en-he', strict: 0.5, accepted: 0.5, translation: 'שלום', reference: 'שלום רב', ok: false }]);
  assert.equal(s.all.lines, 2); assert.equal(s.all.strict, 75); assert.equal(s['he-en'].chrF, 100); assert.equal(s.all.refused, 1);
});

test('translation memory: the same keys and hashes as the builder; the index first, then only the unit that holds the line', async () => {
  for (const [line, key, hash] of fx.keys) { assert.equal(tmKey(line), key, line); assert.equal(fnv1a(key), hash, line); }
  const u32 = (xs) => Buffer.from(new Uint32Array([...xs].sort((a, b) => a - b)).buffer).toString('base64');
  const a = [[tmKey('אני רוצה קפה עם חלב'), 'I want coffee with milk.', 'a']], b = [[tmKey('היא רואה את התג'), 'She sees the tag.', 'p']];
  const files = { 'index.json': { units: [{ id: 'one', file: 'one.json', hashes: u32(a.map((e) => fnv1a(e[0]))) }, { id: 'two', file: 'two.json', hashes: u32(b.map((e) => fnv1a(e[0]))) }] }, 'one.json': { entries: a }, 'two.json': { entries: b } };
  const log = []; const fetch = async (url) => { log.push(url); const f = files[url.replace('https://app.example/tm/', '')]; return f ? new Response(JSON.stringify(f)) : new Response('', { status: 404 }); };
  const tm = createMemory({ base: 'https://app.example/tm/', fetch });
  assert.equal(await tm.lookup('שלום'), null); assert.equal(log.length, 0, 'a short line asks for nothing');
  assert.deepEqual(await tm.lookup('הִיא רוֹאָה אֶת הַתָּג.'), { en: 'She sees the tag.', unit: 'two', source: 'pack' });
  assert.deepEqual(log, ['https://app.example/tm/index.json', 'https://app.example/tm/two.json']);
  assert.equal(await tm.lookup('זה משפט שלא קיים בכלל'), null); assert.equal(log.length, 2, 'a line the index does not know fetches nothing');
  assert.deepEqual(await tm.lookup('אני רוצה קפה עם חלב!'), { en: 'I want coffee with milk.', unit: 'one', source: 'app' });
  const broken = createMemory({ base: 'https://app.example/none/', fetch }); assert.equal(await broken.lookup('אני רוצה קפה עם חלב'), null);
});

test('the browser code asks for nothing by itself: no address is written into it, and it imports only its own files', () => {
  const dir = new URL('../src/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/https?:\/\/(?!\.\+)/.test(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), `${f} names no address`);
    for (const m of text.matchAll(/from '([^']+)'/g)) assert.match(m[1], /^\.\/[a-z-]+\.js$/, `${f} imports ${m[1]}`);
  }
});
