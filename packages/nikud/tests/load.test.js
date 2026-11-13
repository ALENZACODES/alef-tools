// The package's shape (docs/CONTRACT.md, section 2) and what load() does with a pack that is, or is not, on the device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { src } from './helpers.js';
import { memoryCaches, tableFetch, memoryStorage, sha } from '../../loader/tests/helpers.js';

const loader = await import(new URL(`../../loader/${process.env.ALEF_TEST_DIST ? 'dist' : 'src'}/index.js`, import.meta.url).href);
const pkg = await import(src('index.js'));

const BASE = 'https://packs.example/';
/** A pack list with one file in two parts, and the table of addresses a fetch would find. */
function world(pack = 'nikud') {
  const parts = [new Uint8Array(900).fill(1), new Uint8Array(500).fill(2)];
  const whole = new Uint8Array(1400); whole.set(parts[0]); whole.set(parts[1], 900);
  const list = { schema: 'alef.pack.v1', pack, version: '1', files: [{ name: 'model.int8.onnx', bytes: 1400, sha256: sha(whole),
    parts: parts.map((b, i) => ({ path: `model.int8.onnx.p00${i}`, bytes: b.length, sha256: sha(b) })) }] };
  const table = { [`${BASE}${pack}/pack.json`]: JSON.stringify(list) };
  parts.forEach((b, i) => { table[`${BASE}${pack}/model.int8.onnx.p00${i}?v=${sha(b).slice(0, 16)}`] = b; });
  const env = { bases: [BASE], fetch: tableFetch(table), caches: memoryCaches(), storage: memoryStorage(), navigator: {}, origin: 'https://site.example', gpu: false };
  return { list, env };
}

/** A worker that answers like worker.js would, and remembers what it was sent. */
function fakeWorker(log) {
  return class {
    constructor(url, o) { log.push({ made: String(url), type: o?.type }); }
    postMessage(m) {
      log.push(m);
      const answer = m.type === 'load' ? {} : m.type === 'point' ? { result: { text: `pointed:${m.text}`, changed: true, name: false, reason: '' } }
        : { result: { text: m.text, marked: m.text, phonemes: 'ʃaˈlom', name: false, words: [], reason: '' } };
      queueMicrotask(() => this.onmessage({ data: { ...answer, id: m.id, ok: true } }));
    }
    terminate() { log.push({ terminated: true }); }
  };
}

test('the package has the shape the app expects', () => {
  const p = loader.definePackage(pkg);
  assert.equal(p.id, 'nikud');
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual([...p.packs], ['nikud', 'phonemes']);
});

test('load refuses a pack that is not on the device, and never starts a download', async () => {
  const w = world();
  const log = [];
  await assert.rejects(pkg.load({ loader, pack: 'nikud', caches: w.env.caches, WorkerCtor: fakeWorker(log) }), (e) => e.code === 'not-downloaded');
  assert.equal(w.env.fetch.calls.length, 0);
  assert.equal(log.length, 0, 'no worker was started');
  await assert.rejects(pkg.load({ loader, pack: 'nope', caches: w.env.caches }), (e) => e.code === 'unknown-pack');
  await assert.rejects(pkg.load({}), TypeError);
  await pkg.unload();
});

test('a half-downloaded pack is still "not downloaded"', async () => {
  const w = world();
  w.env.fetch.failAlways(`${BASE}nikud/model.int8.onnx.p001?v=${w.list.files[0].parts[1].sha256.slice(0, 16)}`, 'status', 503);
  await assert.rejects(loader.downloadPack('nikud', { ...w.env, userStarted: true, retries: 0 }));
  await assert.rejects(pkg.load({ loader, pack: 'nikud', caches: w.env.caches, WorkerCtor: fakeWorker([]) }), (e) => e.code === 'not-downloaded');
  await pkg.unload();
});

test('with the pack on the device, load starts the worker with the kept parts and returns point()', async () => {
  const w = world();
  await loader.downloadPack('nikud', { ...w.env, userStarted: true });
  const calls = w.env.fetch.calls.length;
  assert.equal(await pkg.onDevice({ loader, pack: 'nikud', caches: w.env.caches }), true);
  assert.equal(await pkg.onDevice({ loader, pack: 'phonemes', caches: w.env.caches }), false);
  const log = [];
  const api = await pkg.load({ loader, pack: 'nikud', ortBase: 'https://site.example/assets/vendor/_ort/', caches: w.env.caches, WorkerCtor: fakeWorker(log) });
  assert.equal(w.env.fetch.calls.length, calls, 'load made no network request');
  const sent = log.find((m) => m.type === 'load');
  assert.equal(sent.cacheName, 'alef-pack-nikud-v1');
  assert.equal(sent.ortBase, 'https://site.example/assets/vendor/_ort/');
  assert.equal(sent.parts.length, 2);
  assert.ok(sent.parts.every((p) => p.key.startsWith(`${BASE}nikud/model.int8.onnx.p00`) && /^[0-9a-f]{64}$/.test(p.sha256)));
  assert.match(sent.loaderUrl, new RegExp(`/loader@${loader.VERSION.replace(/\./g, '\\.')}/index\\.js$`), 'the worker is pointed at the loader next to this package');
  assert.equal(log[0].type, 'module');
  assert.equal(api.backend, 'wasm');
  assert.deepEqual(await api.point('שלום'), { text: 'pointed:שלום', changed: true, name: false, reason: '' });
  assert.deepEqual(await api.point('hello'), { text: 'hello', changed: false, name: false, reason: 'no-hebrew' });
  assert.equal(log.filter((m) => m.type === 'point').length, 1, 'text without Hebrew is not sent to the worker');
  assert.equal(await pkg.load({ loader, pack: 'nikud', caches: w.env.caches, WorkerCtor: fakeWorker(log) }), api, 'a second load gives the same API');
  await pkg.unload(); await pkg.unload();
  assert.ok(log.some((m) => m.terminated));
});

test('the phoneme pack: a text that holds the divine Name gets no sound line and is never sent to the worker', async () => {
  const w = world('phonemes');
  await loader.downloadPack('phonemes', { ...w.env, userStarted: true });
  const log = [];
  const api = await pkg.load({ loader, pack: 'phonemes', caches: w.env.caches, WorkerCtor: fakeWorker(log) });
  assert.equal((await api.sounds('שלום')).phonemes, 'ʃaˈlom');
  for (const line of ['ברוך אתה יהוה', 'בָּרוּךְ אַתָּה יְהוָה', 'הודו ליהוה', 'ברוך ה׳']) {
    const r = await api.sounds(line);
    assert.equal(r.phonemes, null); assert.equal(r.name, true);
    assert.ok(r.text.includes('ה׳') && !r.text.includes('יהוה'));
  }
  assert.equal(log.filter((m) => m.type === 'sounds').length, 1);
  await pkg.unload();
});

test('a long text is cut at the limit before it is sent', async () => {
  const w = world();
  await loader.downloadPack('nikud', { ...w.env, userStarted: true });
  const log = [];
  const api = await pkg.load({ loader, pack: 'nikud', caches: w.env.caches, WorkerCtor: fakeWorker(log) });
  await api.point('א'.repeat(pkg.MAX_TEXT + 500));
  assert.equal(log.find((m) => m.type === 'point').text.length, pkg.MAX_TEXT);
  await pkg.unload();
});
