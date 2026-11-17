// The pack store: what is fetched, from where, how it is checked and kept. Runs under Node with stand-ins for cache storage and fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { fakeCaches, fakeFetch, tinySite, mod, loader, SITE, HOST, HOSTS_FILE } from './helpers.js';
const { createPackStore } = await mod('pack.js'); const { createPackClient } = await mod('client.js'); const pkg = await mod('index.js');

const store = () => createPackStore({ loader, base: SITE, cacheName: 'test-pack-v1', hostsFile: HOSTS_FILE });
const go = { userStarted: true, storage: { getItem: () => '0', setItem() {} }, navigator: {} };   // the learner pressed the button; no limits set

test('an ordinary pack: every part fetched once, from the site, checked, kept; a second call fetches nothing', async () => {
  const { files } = tinySite(); const log = []; const env = { caches: fakeCaches(), fetch: fakeFetch(files, log), subtle: webcrypto.subtle };
  const s = store(); const m = await s.loadManifest(env);
  assert.deepEqual(Object.keys(m.packs).sort(), ['he-en', 'he-en-hq']);
  const before = await s.packState(m, 'he-en', env); assert.equal(before.ready, false); assert.equal(before.missing, before.total);
  const seen = []; const done = await s.downloadPack(m, 'he-en', { ...env, ...go, onProgress: (have) => seen.push(have) });
  assert.equal(done.ready, true); assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'progress only rises');
  assert.equal((await s.packState(m, 'he-en', env)).ready, true);
  const n = log.length; await s.downloadPack(m, 'he-en', { ...env, ...go }); assert.equal(log.length, n, 'nothing fetched twice');
  for (const u of log) assert.ok(u.startsWith('https://app.example/'), `only the site was asked: ${u}`);
});

test('a part with the wrong bytes is refused and not kept', async () => {
  const { files } = tinySite(); files[SITE + 'he-en/encoder.p0.bin'] = new Uint8Array(200).fill(9);
  const env = { caches: fakeCaches(), fetch: fakeFetch(files), subtle: webcrypto.subtle }; const s = store(); const m = await s.loadManifest(env);
  await assert.rejects(() => s.downloadPack(m, 'he-en', { ...env, ...go }), /hash-mismatch/);
  assert.equal((await s.packState(m, 'he-en', env)).ready, false);
});

test('a remote pack: its parts come from the pack host, the runtime code from the site, and nothing from anywhere else', async () => {
  const { files } = tinySite(); const log = []; const env = { caches: fakeCaches(), fetch: fakeFetch(files, log), subtle: webcrypto.subtle, gpu: true };
  const s = store(); const m = await s.loadManifest(env);
  assert.equal(m.packs['he-en-hq'].base, HOST);
  const list = s.packFiles(m, 'he-en-hq', { gpu: true });
  for (const f of list) assert.equal(f.key.startsWith(HOST), /he-en-hq\//.test(f.key), f.key);
  assert.ok(list.some((f) => /ort\.webgpu\.min\.mjs$/.test(f.key) && f.key.startsWith('https://app.example/')), 'code comes from the site');
  await s.downloadPack(m, 'he-en-hq', { ...env, ...go, gpu: true });
  for (const u of log) assert.ok(u.startsWith('https://app.example/') || u.startsWith(HOST), `no other address: ${u}`);
  assert.equal((await s.packState(m, 'he-en-hq', env)).ready, true);
});

test('a remote pack that is not published yet is not in the list at all', async () => {
  const { files } = tinySite({ published: false }); const env = { caches: fakeCaches(), fetch: fakeFetch(files) };
  const m = await store().loadManifest(env);
  assert.deepEqual(Object.keys(m.packs), ['he-en']);
});

test('offline after a download: the kept lists answer, the pack is still ready', async () => {
  const { files } = tinySite(); const env = { caches: fakeCaches(), fetch: fakeFetch(files), subtle: webcrypto.subtle };
  const s = store(); await s.downloadPack(await s.loadManifest(env), 'he-en', { ...env, ...go });
  const off = { caches: env.caches, fetch: async () => { throw new Error('offline'); } };
  const m = await s.loadManifest(off);
  assert.equal((await s.packState(m, 'he-en', off)).ready, true);
  assert.ok(m.packs['he-en-hq'], 'the hosts file kept with the pack still names the remote pack');
});

test('the client: a high-quality pack is offered only with a graphics card, and answers its direction once loaded', async () => {
  const { files } = tinySite();
  const posted = [];
  class FakeWorker { constructor() { this.onmessage = null; } postMessage(m) { posted.push(m); queueMicrotask(() => this.onmessage({ data: m.type === 'translate' ? { id: m.id, ok: true, text: `[${m.name}] ${m.text}`, engine: 'wasm' } : { id: m.id, ok: true, info: { engine: 'wasm', gpu: 'not-tried' } } })); } terminate() {} }
  const mk = (gpu) => { const env = { caches: fakeCaches(), fetch: fakeFetch(files), subtle: webcrypto.subtle, gpu, ...go }; return createPackClient({ store: store(), workerUrl: 'https://app.example/worker.js', WorkerCtor: FakeWorker, env }); };
  const plain = mk(false);
  assert.equal((await plain.state('he-en-hq')).offered, false); assert.equal((await plain.state('he-en')).offered, true);
  const c = mk(true);
  assert.equal((await c.state('he-en-hq')).offered, true);
  assert.deepEqual((await c.packs()).map((p) => [p.name, p.direction, p.high, p.needsGraphics]), [['he-en', 'he-en', false, false], ['he-en-hq', 'he-en', true, true]]);
  await c.download('he-en'); assert.equal(await c.load('he-en'), true);
  assert.equal(c.ready('he-en'), true); assert.equal(c.serving('he-en'), 'he-en'); assert.equal(await c.translate('he-en', 'x'), '[he-en] x');
  await c.download('he-en-hq'); assert.equal(await c.load('he-en-hq'), true);
  assert.equal(c.serving('he-en'), 'he-en-hq'); assert.equal(await c.translate('he-en', 'x'), '[he-en-hq] x');
  assert.equal(c.ready('en-he'), false); await assert.rejects(() => c.translate('en-he', 'x'), /not-loaded/);
  assert.equal(await c.translate('he-en', 'y'.repeat(900)).then((t) => t.length), '[he-en-hq] '.length + 400, 'a line is cut at 400 characters');
});

test('the package has the shape the app expects, and load() never starts a download', async () => {
  const { readFileSync } = await import('node:fs');
  const def = loader.definePackage(pkg);
  assert.equal(def.id, 'translate'); assert.equal(def.version, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  assert.deepEqual([...def.packs], ['translate-en-he', 'translate-he-en', 'translate-he-en-hq']);
  const { files } = tinySite(); const log = [];
  class FakeWorker { postMessage(m) { queueMicrotask(() => this.onmessage({ data: m.type === 'translate' ? { id: m.id, ok: true, text: 'ok' } : { id: m.id, ok: true, info: {} } })); } terminate() {} }
  const env = { caches: fakeCaches(), fetch: fakeFetch(files, log), subtle: webcrypto.subtle, gpu: false, ...go };
  const opts = { loader, pack: 'translate-he-en', base: SITE, ortBase: 'https://app.example/assets/vendor/_ort/', workerUrl: 'https://app.example/worker.js', hostsFile: HOSTS_FILE, cacheName: 'test-pack-v1', WorkerCtor: FakeWorker, env };
  await assert.rejects(() => pkg.load(opts), (e) => loader.codeOf(e) === 'not-downloaded');
  assert.ok(log.every((u) => /manifest\.json|pack-host\.json/.test(u)), 'only the two small lists were read');
  const s = store(); await s.downloadPack(await s.loadManifest(env), 'he-en', env);
  const t = await pkg.load(opts);
  assert.equal(t.direction, 'he-en'); assert.equal(await t.translate('x'), 'ok');
  await pkg.unload(); await pkg.unload();
});
