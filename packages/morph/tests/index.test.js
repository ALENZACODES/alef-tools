import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PKG, CODE, lib } from './helpers.js';
const morph = await lib('index.js');
const loader = await import(new URL(`../loader/${CODE}index.js`, PKG).href);

const sha = (b) => createHash('sha256').update(b).digest('hex');
function memoryCaches() {
  const stores = new Map();
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name); const url = (k) => (typeof k === 'string' ? k : k.url);
    return {
      match: async (k) => { const e = m.get(url(k)); return e ? new Response(e.body, { headers: e.headers }) : undefined; },
      put: async (k, res) => { m.set(url(k), { body: new Uint8Array(await res.arrayBuffer()), headers: [...res.headers] }); },
      delete: async (k) => m.delete(url(k)), keys: async () => [...m.keys()].map((u) => ({ url: u })),
    };
  };
  return { open, delete: async (name) => stores.delete(name), keys: async () => [...stores.keys()], stores };
}
/** A tiny stand-in for the Words pack on a host, in the alef.pack.v1 shape. */
function tinyPack(base = 'https://packs.example/') {
  const enc = (s) => new TextEncoder().encode(s);
  const blobs = { 'joint.int8.onnx.p000': enc('model-a-'), 'joint.int8.onnx.p001': enc('model-b'), 'vocab.txt.p000': enc('[UNK]\n[CLS]\n'), 'tokenizer.json.p000': enc('{"split":"x"}'), 'labels.json.p000': enc('{"pos":[]}') };
  const part = (path) => ({ path, bytes: blobs[path].length, sha256: sha(blobs[path]) });
  const file = (name, ...paths) => ({ name, bytes: paths.reduce((a, p) => a + blobs[p].length, 0), sha256: sha(Buffer.concat(paths.map((p) => blobs[p]))), parts: paths.map(part) });
  const list = { schema: 'alef.pack.v1', pack: 'words', version: 't1', files: [file('joint.int8.onnx', 'joint.int8.onnx.p000', 'joint.int8.onnx.p001'), file('vocab.txt', 'vocab.txt.p000'), file('tokenizer.json', 'tokenizer.json.p000'), file('labels.json', 'labels.json.p000')] };
  const table = { [`${base}words/pack.json`]: JSON.stringify(list) };
  for (const [path, body] of Object.entries(blobs)) table[`${base}words/${path}?v=${sha(body).slice(0, 16)}`] = body;
  const fetch = async (url) => (url in table ? new Response(table[url], { status: 200 }) : new Response('', { status: 404 }));
  return { list, fetch, base };
}
/** A worker that answers in the loader's protocol and records what it was sent. */
function fakeWorker(seen) {
  return class {
    constructor(url, opts) { seen.url = String(url); seen.opts = opts; seen.stopped = false; }
    postMessage(m) {
      seen.messages = (seen.messages || []).concat(m.type);
      queueMicrotask(() => {
        if (m.type === 'load') { seen.model = new TextDecoder().decode(new Uint8Array(m.model)); seen.vocab = m.vocab; seen.ort = m.ort; this.onmessage({ data: { id: m.id, ok: true, provider: 'wasm' } }); }
        else if (m.type === 'analyse') this.onmessage({ data: { id: m.id, ok: true, words: [{ token: m.text }] } });
      });
    }
    terminate() { seen.stopped = true; }
  };
}

test('the package has the shape the contract asks for', () => {
  const pkg = loader.definePackage(morph);
  assert.equal(pkg.id, 'morph');
  assert.deepEqual([...pkg.packs], ['words']);
  assert.equal(pkg.version, JSON.parse(readFileSync(new URL('package.json', PKG), 'utf8')).version);
});

test('load: without the pack on the device it rejects with not-downloaded and starts no worker and no download', async () => {
  const t = tinyPack(); const seen = {}; const calls = [];
  const fetch = async (url) => { calls.push(url); return t.fetch(url); };
  await assert.rejects(morph.load({ loader, bases: [t.base], caches: memoryCaches(), fetch, WorkerCtor: fakeWorker(seen) }), (e) => e.code === 'not-downloaded');
  assert.equal(seen.url, undefined, 'no worker may start');
  assert.deepEqual(calls, [`${t.base}words/pack.json`], 'only the small list may be read');
  // no list anywhere (the pack is not published): the same answer
  await assert.rejects(morph.load({ loader, bases: [t.base], caches: memoryCaches(), fetch: async () => new Response('', { status: 404 }), WorkerCtor: fakeWorker({}) }), (e) => e.code === 'not-downloaded');
  await assert.rejects(morph.load({ caches: memoryCaches() }), TypeError);
});

test('load: with the pack downloaded it hands the joined model to a worker, answers, and unload stops it', async () => {
  const t = tinyPack(); const caches = memoryCaches(); const seen = {};
  await loader.downloadPack('words', { bases: [t.base], caches, fetch: t.fetch, subtle: globalThis.crypto.subtle, userStarted: true, gpu: false, navigator: {}, storage: null });
  const api = await morph.load({ loader, bases: [t.base], caches, fetch: t.fetch, ortBase: 'https://site.example/assets/vendor/_ort/', WorkerCtor: fakeWorker(seen) });
  assert.equal(api.provider, 'wasm');
  assert.equal(seen.model, 'model-a-model-b');
  assert.equal(seen.vocab, '[UNK]\n[CLS]\n');
  assert.equal(seen.ort, 'https://site.example/assets/vendor/_ort/ort.wasm.min.mjs');
  assert.match(seen.url, /worker\.js$/);
  assert.equal(seen.opts.type, 'module');
  assert.deepEqual(await api.analyse('שלום'), [{ token: 'שלום' }]);
  assert.equal(await morph.load({ loader, bases: [t.base], caches, fetch: t.fetch, WorkerCtor: fakeWorker({}) }), api, 'a second load gives the running reader');
  await morph.unload(); await morph.unload();
  assert.equal(seen.stopped, true);
});

test('the worker module answers in the shared loader protocol (ids, ok, error codes)', async () => {
  const sent = [];
  const scope = globalThis;
  const had = [scope.onmessage, scope.postMessage];
  scope.postMessage = (m) => sent.push(m);
  try {
    await import(new URL(`${CODE}worker.js`, PKG).href);
    await scope.onmessage({ data: { id: 7, type: 'analyse', text: 'שלום' } });
    await scope.onmessage({ data: { id: 8, type: 'nonsense' } });
  } finally { [scope.onmessage, scope.postMessage] = had; }
  assert.deepEqual(sent.map((m) => [m.id, m.ok, m.code]), [[7, false, 'not-loaded'], [8, false, 'unknown-message']]);
});
