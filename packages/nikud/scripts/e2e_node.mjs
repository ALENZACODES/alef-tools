#!/usr/bin/env node
// End to end, in Node, with the real files: pack list and parts -> the shared loader's download (every part checked) ->
// this package's load() -> worker.js -> the app's vendored onnxruntime-web (WebAssembly, one thread) -> pointed text.
//   node scripts/e2e_node.mjs --packs <folder with nikud/ and phonemes/> --ort <Al-Heb>/assets/vendor/_ort/ [--dist]
// Nothing here is a browser: Cache Storage is kept in memory and the worker runs in this process. It shows that the code
// that ships, the pack files and the runtime fit together; a real browser run is still needed for timing on real devices.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { memoryCaches, memoryStorage } from '../../loader/tests/helpers.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const packsDir = resolve(arg('--packs') || '../../out/packs');
const ortDir = resolve(arg('--ort') || '');
const which = process.argv.includes('--dist') ? 'dist' : 'src';
const loaderUrl = new URL(`../../loader/${which}/index.js`, import.meta.url).href;
const loader = await import(loaderUrl);
const pkg = await import(new URL(`../${which}/index.js`, import.meta.url).href);

const BASE = 'https://packs.invalid/';
const ORT = pathToFileURL(ortDir).href + '/';
const store = memoryCaches();
// Cache Storage as a worker sees it: open/keys/delete plus a match across every cache
const caches = { ...store, match: async (url) => { for (const name of await store.keys()) { const hit = await (await store.open(name)).match(url); if (hit) return hit; } return undefined; } };
globalThis.caches = caches;
// the runtime's WebAssembly, as the Talk pack would have kept it
await (await caches.open('alef-talk-pack-v1')).put(`${ORT}ort-wasm-simd-threaded.wasm`, new Response(readFileSync(join(ortDir, 'ort-wasm-simd-threaded.wasm'))));
const fetched = [];
const fetchFile = async (url) => {
  const rel = String(url).replace(/\?.*$/, '').replace(BASE, '');
  fetched.push(rel);
  const p = join(packsDir, rel);
  return existsSync(p) ? new Response(readFileSync(p)) : new Response('', { status: 404 });
};
/** worker.js in this process: one fresh copy of the module per worker, with its own `self`. */
class InProcessWorker {
  constructor(url) {
    const self = { postMessage: (m) => queueMicrotask(() => this.onmessage?.({ data: m })), onmessage: null };
    this.ready = (async () => { globalThis.self = self; await import(`${url}?n=${Math.random()}`); this.scope = self; })();
  }
  postMessage(m) { this.ready.then(() => this.scope.onmessage({ data: m })); }
  terminate() {}
}

const env = { bases: [BASE], fetch: fetchFile, caches, storage: memoryStorage({}), navigator: {}, origin: 'https://site.invalid', gpu: false };
const lines = ['שלום, מה שלומך היום?', 'אני רוצה להזמין קפה ועוגה, בבקשה.', 'איפה התחנה המרכזית? אני צריך להגיע לירושלים לפני השקיעה.', 'ברוך אתה יהוה אלהינו מלך העולם', 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים'];
const out = {};
for (const pack of pkg.packs) {
  if (!existsSync(join(packsDir, pack, 'pack.json'))) { console.log(`${pack}: no pack folder, skipped`); continue; }
  await pkg.load({ loader, pack, caches, ortBase: ORT, WorkerCtor: InProcessWorker, loaderUrl }).then(() => { throw new Error('load should refuse before the download'); }, (e) => { if (e.code !== 'not-downloaded') throw e; });
  let t = Date.now();
  const done = await loader.downloadPack(pack, { ...env, userStarted: true });
  const downloadMs = Date.now() - t;
  t = Date.now();
  const api = await pkg.load({ loader, pack, caches, ortBase: ORT, WorkerCtor: InProcessWorker, loaderUrl });
  const loadMs = Date.now() - t;
  const results = [];
  for (const l of lines) { const t1 = Date.now(); const r = pack === 'nikud' ? await api.point(l) : await api.sounds(l); results.push({ in: l, text: r.text, phonemes: r.phonemes ?? undefined, name: r.name, reason: r.reason, ms: Date.now() - t1 }); }
  out[pack] = { bytes: done.total, parts: fetched.filter((f) => f.startsWith(pack + '/') && !f.endsWith('pack.json')).length, downloadMs, loadMs, backend: api.backend, results };
  for (const r of results) console.log(`${pack} ${String(r.ms).padStart(5)} ms | ${r.text}${r.phonemes ? ' | ' + r.phonemes : ''}${r.name ? ' [Name]' : ''}${r.reason ? ' (' + r.reason + ')' : ''}`);
  await pkg.unload();
}
const rssMiB = Math.round(process.memoryUsage().rss / 2 ** 20);
if (arg('--out')) {
  const { writeFileSync } = await import('node:fs');
  const dist = JSON.parse(readFileSync(new URL('../dist/dist.json', import.meta.url), 'utf8'));
  const summary = { note: 'Node on a 2-core cloud machine, Cache Storage in memory, the worker in-process. Not a browser and not a phone.', ran: which, rssMiB,
    distBytes: { code: dist.files.filter((f) => /^[a-z]+\.js$/.test(f.path)).reduce((a, f) => a + f.bytes, 0), all: dist.files.reduce((a, f) => a + f.bytes, 0) } };
  for (const [k, v] of Object.entries(out)) {
    const timed = v.results.filter((r) => r.ms > 0 && !r.reason);
    summary[k] = { bytes: v.bytes, MiB: +(v.bytes / 2 ** 20).toFixed(1), parts: v.parts, loadMs: v.loadMs, backend: v.backend, msPerLine: Math.round(timed.reduce((a, r) => a + r.ms, 0) / Math.max(timed.length, 1)), lines: v.results.map(({ ms, ...r }) => r) };
  }
  writeFileSync(arg('--out'), JSON.stringify(summary, null, 1) + '\n');
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { MiB: +(v.bytes / 2 ** 20).toFixed(1), parts: v.parts, loadMs: v.loadMs, backend: v.backend }])), null, 0), 'rss MiB', rssMiB);
