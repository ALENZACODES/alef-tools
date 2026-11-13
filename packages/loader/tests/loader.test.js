// Download path: parts, checks, resume, a full disk, the reasons a download may not start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loaderUrl, memoryCaches, tableFetch, memoryStorage, miniPack, sha, at } from './helpers.js';

const L = await import(loaderUrl);
const TUESDAY = at('2026-11-10T12:00:00');
const env = (extra = {}) => ({ caches: memoryCaches(), storage: memoryStorage(), navigator: {}, origin: 'https://app.example', now: TUESDAY, gpu: false, ...extra });

test('contract surface: version, cache name, part limit', () => {
  assert.equal(L.CONTRACT, 1);
  assert.match(L.VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(L.MAX_PART_BYTES, 16 * 1024 * 1024);
  assert.equal(L.cacheName('words'), 'alef-pack-words-v1');
  assert.equal(L.packOfCache('alef-pack-listen-lite-v1'), 'listen-lite');
  assert.equal(L.packOfCache('alef-talk-pack-v1'), '');
  assert.throws(() => L.cacheName('../x'), (e) => e.code === 'bad-pack-name');
});

test('expandPack: parts in order, addresses carry the hash, graphics-card files only with a graphics card', () => {
  const { list, base } = miniPack();
  const plain = L.expandPack(list, { base: `${base}words/`, gpu: false });
  assert.deepEqual(plain.map((f) => f.name), ['model.onnx', 'model.onnx', 'vocab.json']);
  assert.ok(plain.every((f) => f.url.endsWith(`?v=${f.sha256.slice(0, 16)}`) && f.key === f.url));
  const fast = L.expandPack(list, { base: `${base}words/`, gpu: true });
  assert.equal(fast.length, 4);
  assert.throws(() => L.expandPack({ schema: 'other' }, { base }), (e) => e.code === 'bad-pack-list');
});

test('a pack downloads part by part, every part is checked and kept in the pack\'s own cache, and state says ready', async () => {
  const { table, base } = miniPack();
  const e = env({ fetch: tableFetch(table) });
  const seen = [];
  const done = await L.downloadPack('words', { ...e, bases: [base], userStarted: true, onProgress: (h, t) => seen.push([h, t]) });
  assert.deepEqual({ ready: done.ready, have: done.have, total: done.total, missing: done.missing }, { ready: true, have: 24, total: 24, missing: 0 });
  assert.deepEqual(seen.at(-1), [24, 24]);
  assert.ok(seen.every(([h], i) => i === 0 || h >= seen[i - 1][0]), 'progress never goes backwards');
  assert.deepEqual(await e.caches.keys(), ['alef-pack-words-v1']);
  const st = await L.packState('words', { ...e, bases: [base] });
  assert.equal(st.ready, true);
  const whole = await L.readFile('alef-pack-words-v1', st.files.filter((f) => f.name === 'model.onnx'), e);
  assert.equal(new TextDecoder().decode(whole), 'first-part-second');
  // a request to another address is a plain one, with no cache directive
  assert.ok(e.fetch.calls.every((c) => c.init.mode === 'cors' && !('cache' in c.init)));
});

test('a part with the wrong bytes is not kept; the download stops with hash-mismatch and the good parts stay', async () => {
  const { table, base, parts } = miniPack();
  const bad = `${base}words/model.onnx.p001?v=${sha(parts['model.onnx.p001']).slice(0, 16)}`;
  const e = env({ fetch: tableFetch({ ...table, [bad]: new TextEncoder().encode('SECOND') }) });
  await assert.rejects(L.downloadPack('words', { ...e, bases: [base], userStarted: true }), (err) => err.code === 'hash-mismatch');
  const st = await L.packState('words', { ...e, bases: [base] });
  assert.equal(st.have, 11, 'only the first part is kept');
  assert.equal(st.ready, false);
});

test('a part of the wrong length stops with size-mismatch', async () => {
  const { table, base, parts } = miniPack();
  const u = `${base}words/vocab.json.p000?v=${sha(parts['vocab.json.p000']).slice(0, 16)}`;
  const f = tableFetch(table); f.failAlways(u, 'short');
  const e = env({ fetch: f });
  await assert.rejects(L.downloadPack('words', { ...e, bases: [base], userStarted: true }), (err) => err.code === 'size-mismatch');
});

test('resume: after a break, calling download again fetches only the parts that are missing', async () => {
  const { table, base, parts } = miniPack();
  const second = `${base}words/model.onnx.p001?v=${sha(parts['model.onnx.p001']).slice(0, 16)}`;
  const f = tableFetch(table); f.failAlways(second, 'throw');
  const e = env({ fetch: f });
  await assert.rejects(L.downloadPack('words', { ...e, bases: [base], userStarted: true }), (err) => err.code === 'fetch');
  const before = f.calls.length;
  f.heal(second);
  const done = await L.downloadPack('words', { ...e, bases: [base], userStarted: true });
  assert.equal(done.ready, true);
  const again = f.calls.slice(before).map((c) => c.url).filter((u) => !u.endsWith('pack.json'));
  assert.deepEqual(again.map((u) => u.split('/').pop().split('?')[0]), ['model.onnx.p001', 'vocab.json.p000'], 'the first part was not fetched again');
});

test('a dropped connection gets one more try for the same part before the download stops', async () => {
  const { table, base, parts } = miniPack();
  const first = `${base}words/model.onnx.p000?v=${sha(parts['model.onnx.p000']).slice(0, 16)}`;
  const f = tableFetch(table); f.failOnce(first, 'throw');
  const e = env({ fetch: f });
  assert.equal((await L.downloadPack('words', { ...e, bases: [base], userStarted: true })).ready, true);
});

test('an aborted download stops with aborted and can be resumed', async () => {
  const { table, base } = miniPack();
  const e = env({ fetch: tableFetch(table) });
  const stop = new AbortController(); stop.abort();
  await assert.rejects(L.downloadPack('words', { ...e, bases: [base], userStarted: true, signal: stop.signal }), (err) => err.code === 'aborted');
  assert.equal((await L.downloadPack('words', { ...e, bases: [base], userStarted: true })).ready, true);
});

test('a full disk comes back as quota, and nothing half-written counts as kept', async () => {
  const { table, base } = miniPack();
  const listBytes = table[`${base}words/pack.json`].length;
  const e = env({ fetch: tableFetch(table), caches: memoryCaches({ quotaAfter: listBytes + 12 }) });
  await assert.rejects(L.downloadPack('words', { ...e, bases: [base], userStarted: true }), (err) => err.code === 'quota');
  assert.equal((await L.packState('words', { ...e, bases: [base] })).have, 11);
});

test('too little free space, or the learner\'s own limit, stops a download before it starts', async () => {
  const { table, base } = miniPack();
  const full = env({ fetch: tableFetch(table), navigator: { storage: { estimate: async () => ({ quota: 1000, usage: 990 }) } } });
  await assert.rejects(L.downloadPack('words', { ...full, bases: [base], userStarted: true }), (err) => err.code === 'too-full');
  assert.equal(full.fetch.calls.filter((c) => !c.url.endsWith('pack.json')).length, 0, 'no part was fetched');
  const limited = env({ fetch: tableFetch(table) });
  L.setLimit(10, limited);
  await assert.rejects(L.downloadPack('words', { ...limited, bases: [base], userStarted: true }), (err) => err.code === 'over-limit');
  L.setLimit(0, limited);
  assert.equal((await L.downloadPack('words', { ...limited, bases: [base], userStarted: true })).ready, true);
});

test('"Only on Wi-Fi" is on by default and stops a download on a mobile or data-saver connection', async () => {
  const { table, base } = miniPack();
  const e = env({ fetch: tableFetch(table), navigator: { connection: { type: 'cellular' } } });
  assert.equal(L.getWifiOnly(e), true);
  await assert.rejects(L.downloadPack('words', { ...e, bases: [base], userStarted: true }), (err) => err.code === 'wifi-only');
  L.setWifiOnly(false, e);
  assert.equal((await L.downloadPack('words', { ...e, bases: [base], userStarted: true })).ready, true);
  const saver = env({ navigator: { connection: { saveData: true } } });
  assert.throws(() => L.checkConnection(saver), (err) => err.code === 'wifi-only');
  assert.doesNotThrow(() => L.checkConnection(env()), 'a browser that says nothing about the connection is not blocked');
});

test('a pack that needs a graphics card or more memory is refused with cannot-run', async () => {
  const { table, base } = miniPack();
  const e = env({ fetch: tableFetch(table) });
  await assert.rejects(L.downloadPack('words', { ...e, bases: [base], userStarted: true, device: { webgpu: true } }), (err) => err.code === 'cannot-run');
  const small = env({ fetch: tableFetch(table), navigator: { deviceMemory: 4 } });
  await assert.rejects(L.downloadPack('words', { ...small, bases: [base], userStarted: true, device: { minRamGB: 8 } }), (err) => err.code === 'cannot-run');
  assert.deepEqual(await L.canRun({ webgpu: true, minRamGB: 8 }, { gpu: true, navigator: { deviceMemory: 8 } }), { ok: true, reasons: [] });
  assert.deepEqual(await L.canRun({ minRamGB: 8 }, { navigator: {} }), { ok: true, reasons: [] }, 'unknown memory counts as enough');
});

test('a part over 16 MiB in a list is refused before anything is fetched', async () => {
  const files = [{ key: 'https://packs.example/big', url: 'https://packs.example/big', bytes: L.MAX_PART_BYTES + 1, sha256: 'x' }];
  const e = env({ fetch: tableFetch({}) });
  await assert.rejects(L.downloadFiles(files, { ...e, cacheName: 'alef-pack-big-v1', userStarted: true }), (err) => err.code === 'part-too-large');
  assert.equal(e.fetch.calls.length, 0);
});

test('no Cache Storage: no-storage', async () => {
  const plan = await L.planDownload([], { cacheName: 'alef-pack-x-v1', caches: null, navigator: {}, storage: memoryStorage(), now: TUESDAY });
  // globalThis.caches does not exist under Node, so null falls through to "none"
  assert.ok(plan.blocked.includes('no-storage'));
});

test('the pack list: first base that has it wins; offline, the saved copy answers; a list for another pack is ignored', async () => {
  const { table, base } = miniPack();
  const site = 'https://app.example/assets/vendor/_packs/';
  const f = tableFetch(table);
  const e = env({ fetch: f });
  const list = await L.fetchPackList('words', { ...e, bases: [site, base] });
  assert.equal(list.base, `${base}words/`);
  assert.deepEqual(f.calls[0].init, { cache: 'no-cache' }, 'the site itself is asked for a fresh copy');
  const offline = env({ caches: e.caches, fetch: async () => { throw new TypeError('offline'); } });
  assert.equal((await L.fetchPackList('words', { ...offline, bases: [site, base] })).version, '1');
  await assert.rejects(L.fetchPackList('nikud', { ...offline, bases: [base] }), (err) => err.code === 'no-pack-list');
  const wrong = env({ fetch: tableFetch({ [`${base}nikud/pack.json`]: table[`${base}words/pack.json`] }) });
  await assert.rejects(L.fetchPackList('nikud', { ...wrong, bases: [base] }), (err) => err.code === 'no-pack-list');
});

test('a new version of a pack replaces the old parts; delete removes the pack and nothing else', async () => {
  const { table, base, list } = miniPack();
  const e = env({ fetch: tableFetch(table) });
  await L.downloadPack('words', { ...e, bases: [base], userStarted: true });
  const other = miniPack('nikud');
  await L.downloadPack('nikud', { ...e, fetch: tableFetch(other.table), bases: [base], userStarted: true });
  // version 2: the vocabulary changed
  const body = new TextEncoder().encode('{"a":2}');
  const v2 = structuredClone(list); v2.version = '2';
  v2.files[1] = { name: 'vocab.json', bytes: 7, sha256: sha(body), parts: [{ path: 'vocab.json.p000', bytes: 7, sha256: sha(body) }] };
  const t2 = { ...table, [`${base}words/pack.json`]: JSON.stringify(v2), [`${base}words/vocab.json.p000?v=${sha(body).slice(0, 16)}`]: body };
  const done = await L.downloadPack('words', { ...e, fetch: tableFetch(t2), bases: [base], userStarted: true });
  assert.equal(done.version, '2');
  const keys = [...e.caches.stores.get('alef-pack-words-v1').keys()];
  assert.equal(keys.length, 4, 'the list, two model parts and the new vocabulary');
  assert.ok(!keys.some((k) => k.includes(list.files[1].sha256.slice(0, 16))), 'the old vocabulary part is gone');
  assert.ok(keys.some((k) => k.includes(v2.files[1].sha256.slice(0, 16))), 'the new one is kept');
  const report = await L.storageReport(e);
  assert.deepEqual(report.packs.map((p) => p.pack), ['nikud', 'words']);
  assert.equal(report.used, report.packs[0].bytes + report.packs[1].bytes);
  assert.equal(await L.removePack('words', e), true);
  assert.deepEqual((await L.listPacks(e)).map((p) => p.pack), ['nikud']);
});

test('removeFiles deletes only the named files; listPacks can count a cache with an older name', async () => {
  const { table, base } = miniPack();
  const e = env({ fetch: tableFetch(table) });
  await L.downloadPack('words', { ...e, bases: [base], userStarted: true, cacheName: 'alef-talk-pack-v1' });
  const st = await L.packState('words', { ...e, bases: [base], cacheName: 'alef-talk-pack-v1' });
  assert.deepEqual(await L.listPacks(e), []);
  assert.equal((await L.listPacks({ ...e, extra: { 'alef-talk-pack-v1': 'talk' } }))[0].pack, 'talk');
  assert.equal(await L.removeFiles(st.files.filter((f) => f.name === 'vocab.json'), { ...e, cacheName: 'alef-talk-pack-v1' }), 1);
  assert.equal((await L.filesState(st.files, { ...e, cacheName: 'alef-talk-pack-v1' })).have, 17);
});

test('the browser is asked to keep storage once per device, after a download', async () => {
  const { table, base } = miniPack();
  let asked = 0;
  const e = env({ fetch: tableFetch(table), navigator: { storage: { persist: async () => { asked++; return true; }, persisted: async () => false } } });
  await L.downloadPack('words', { ...e, bases: [base], userStarted: true });
  await L.removePack('words', e);
  await L.downloadPack('words', { ...e, bases: [base], userStarted: true });
  assert.equal(asked, 1);
  assert.equal(await L.askPersistOnce(e), null);
});
