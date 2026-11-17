import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mod } from './helpers.js';
import { loaderUrl, memoryCaches, tableFetch, sha } from '../../loader/tests/helpers.js';

const pkg = await mod('index.js');
const loader = await import(loaderUrl);          // the real shared loader, not a stand-in

const model = new Uint8Array(readFileSync(new URL('./fixtures/tiny.onnx', import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL('./fixtures/tiny.json', import.meta.url), 'utf8'));
const info = new TextEncoder().encode(JSON.stringify(manifest));
const BASE = 'https://site.test/assets/vendor/_packs/';
const entry = (name, bytes) => ({ name, bytes: bytes.length, sha256: sha(bytes), parts: [{ path: `${name}.p000`, bytes: bytes.length, sha256: sha(bytes) }] });
const list = { schema: 'alef.pack.v1', pack: 'handwriting', version: 't', files: [entry('letters.onnx', model), entry('model.json', info)] };
const v = (bytes) => `?v=${sha(bytes).slice(0, 16)}`;
const site = () => tableFetch({ [`${BASE}handwriting/pack.json`]: JSON.stringify(list), [`${BASE}handwriting/letters.onnx.p000${v(model)}`]: model, [`${BASE}handwriting/model.json.p000${v(info)}`]: info });

test('exports the shape the contract asks for', () => {
  assert.equal(pkg.id, 'handwriting');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  assert.deepEqual(pkg.packs, ['handwriting']);
  assert.equal(typeof pkg.load, 'function'); assert.equal(typeof pkg.unload, 'function');
  assert.equal(loader.definePackage ? !!loader.definePackage(pkg) : true, true);
});

test('load never downloads: without the pack on the device it rejects with code not-downloaded', async () => {
  await assert.rejects(() => pkg.load({}), (e) => e.code === 'not-downloaded');
  const caches = memoryCaches(); const fetch = site();
  await assert.rejects(() => pkg.load({ loader, bases: [BASE], caches, fetch }), (e) => e instanceof loader.PackError && e.code === 'not-downloaded');
  assert.ok(!fetch.calls.some((c) => /\.p000/.test(String(c.url))), 'no part of the pack was fetched');
});

test('after the loader has downloaded the pack, load() reads it from the cache and checks strokes; unload twice is safe', async () => {
  const caches = memoryCaches(); const fetch = site();
  await loader.downloadPack('handwriting', { bases: [BASE], caches, fetch, gpu: false, userStarted: true, storage: undefined });
  const offline = async () => { throw new Error('offline'); };
  const hw = await pkg.load({ loader, bases: [BASE], caches, fetch: offline });
  assert.equal(hw.backend, 'built-in');
  const r = await hw.checkStrokes([[[100, 100], [900, 100], [900, 900]]], { targetId: 'resh', script: 'print', strokeWidth: 60 });
  assert.ok(['match', 'close', 'looks-like', 'not-a-letter', 'unsure'].includes(r.verdict));   // random test weights: only the shape of the answer is checked
  assert.equal(r.ranking.length, 3);
  const w = await hw.checkWordStrokes([{ targetId: 'resh', strokes: [[[0, 0], [10, 0], [10, 10]]] }]);
  assert.equal(typeof w.ok, 'boolean');
  await pkg.unload(); await pkg.unload();
});

test('load with the bytes handed in directly', async () => {
  const hw = await pkg.load({ model, manifest });
  const r = await hw.classifyImageData({ data: new Uint8ClampedArray(40 * 40 * 4).fill(255), width: 40, height: 40 });
  assert.equal(r.probs.length, 28);
  await pkg.unload();
});
