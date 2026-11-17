import { guardName, hasHebrew } from './hebrew.js';
export const id = 'nikud';
export const version = '0.1.0';
export const packs = ['nikud', 'phonemes'];
export const MAX_TEXT = 4000;
export { stripPoints, hasPoints, hasCantillation, hasHebrew, guardName, nameWord, NAME_SHOWN } from './hebrew.js';
export { createUnits, unitIndex, SOURCE_NOTE } from './units.js';
const hosts = {};
const apis = {};
async function keptParts(loader, pack, env) {
 const cachesApi = env.caches ?? /** @type {any} */ (globalThis).caches;
 if (!cachesApi) throw new loader.PackError('no-storage');
 const cacheName = loader.cacheName(pack);
 const cache = await cachesApi.open(cacheName);
 for (const req of await cache.keys()) {
  if (!/\/pack\.json$/.test(req.url)) continue;
  const hit = await cache.match(req.url);
  const list = hit ? await hit.json().catch(() => null) : null;
  if (!list || list.pack !== pack) continue;
  const files = loader.expandPack(list, { base: req.url.replace(/pack\.json$/, ''), gpu: false });
  if ((await loader.filesState(files, { cacheName, caches: cachesApi })).ready) return { cacheName, files, packVersion: String(list.version) };
 }
 throw new loader.PackError('not-downloaded', pack);
}
export async function onDevice(opts) {
 try { await keptParts(opts.loader, opts.pack, opts); return true; } catch { return false; }
}
async function start(pack, opts) {
 const loader = opts.loader;
 const kept = await keptParts(loader, pack, opts);
 if (opts.signal?.aborted) throw new loader.PackError('aborted');
 const loaderUrl = String(opts.loaderUrl || new URL(`../loader@${loader.VERSION}/index.js`, import.meta.url));
 const run = async () => {
  const host = loader.createWorkerHost({ url: opts.workerUrl || new URL('./worker.js', import.meta.url), WorkerCtor: opts.WorkerCtor, onCrash: () => { delete apis[pack]; delete hosts[pack]; } });
  hosts[pack] = host;
  await host.ask({ type: 'load', pack, cacheName: kept.cacheName, parts: kept.files, ortBase: String(opts.ortBase || ''), loaderUrl });
  return host;
 };
 const { backend, value: host } = await loader.runWithFallback({ gpu: false, wasm: run });
 const common = { pack, backend, packVersion: kept.packVersion };
 if (pack === 'nikud') {
  return { ...common,
   async point(text) {
    const src = String(text ?? '').slice(0, MAX_TEXT);
    if (!hasHebrew(src)) return { text: src, changed: false, name: false, reason: 'no-hebrew' };
    return (await host.ask({ type: 'point', text: src })).result;
   } };
 }
 return { ...common,
  async sounds(text) {
   const src = String(text ?? '').slice(0, MAX_TEXT);
   const g = guardName(src);
   if (g.found) return { text: g.text, marked: g.text, phonemes: null, name: true, words: [], reason: 'name' };
   if (!hasHebrew(src)) return { text: src, marked: src, phonemes: null, name: false, words: [], reason: 'no-hebrew' };
   return (await host.ask({ type: 'sounds', text: src })).result;
  } };
}
export async function load(opts) {
 const loader = opts?.loader;
 if (!loader || typeof loader.createWorkerHost !== 'function') throw new TypeError('nikud.load: opts.loader is required');
 const pack = opts.pack || 'nikud';
 if (!packs.includes(pack)) throw new loader.PackError('unknown-pack', pack);
 if (!apis[pack]) {
  apis[pack] = start(pack, opts);
  apis[pack].catch(() => { delete apis[pack]; try { hosts[pack]?.stop(); } catch { /* gone */ } delete hosts[pack]; });
 }
 return apis[pack];
}
export async function unload() {
 for (const pack of Object.keys(hosts)) { try { hosts[pack].stop(); } catch { /* gone */ } delete hosts[pack]; }
 for (const pack of Object.keys(apis)) delete apis[pack];
}
