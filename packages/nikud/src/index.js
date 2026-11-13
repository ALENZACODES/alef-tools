// @ts-check
// Vowel marks (nikud) and a sound line for any Hebrew text, on the learner's device. Shape: docs/CONTRACT.md, section 2.
//   packs 'nikud'     dicta-il/dictabert-large-char-menaked (CC-BY-4.0), 8-bit      -> api.point(text)
//         'phonemes'  Phonikud/phonikud-onnx (MIT), 8-bit                           -> api.sounds(text)
// load() never downloads: a pack that is not on the device is refused with PackError('not-downloaded').
// The graphs run in worker.js on WebAssembly. There is no graphics-card build of these packs yet (see README).
import { guardName, hasHebrew } from './hebrew.js';

export const id = 'nikud';
export const version = '0.1.0';
export const packs = ['nikud', 'phonemes'];
/** Longest text handed to a pack in one request. */
export const MAX_TEXT = 4000;

export { stripPoints, hasPoints, hasCantillation, hasHebrew, guardName, nameWord, NAME_SHOWN } from './hebrew.js';
export { createUnits, unitIndex, SOURCE_NOTE } from './units.js';

/** @type {Record<string, any>} pack -> worker host */
const hosts = {};
/** @type {Record<string, Promise<any>>} pack -> the working API */
const apis = {};

/**
 * The parts of a pack that is wholly on the device, read from the pack list saved with it. No network.
 * @param {any} loader @param {string} pack @param {{caches?:any}} env
 */
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

/**
 * True when a pack is wholly on this device. Reads only the device's own storage: no network request is made.
 * @param {{loader:any, pack:'nikud'|'phonemes', caches?:any}} opts
 */
export async function onDevice(opts) {
  try { await keptParts(opts.loader, opts.pack, opts); return true; } catch { return false; }
}

async function start(pack, opts) {
  const loader = opts.loader;
  const kept = await keptParts(loader, pack, opts);
  if (opts.signal?.aborted) throw new loader.PackError('aborted');
  // The vendored layout puts every package next to the loader: assets/vendor/_alef-tools/<name>@<version>/.
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
      /** Vowel marks for a text. Pointed words keep their points; text with cantillation comes back as it came; the divine Name becomes he + geresh. @param {string} text */
      async point(text) {
        const src = String(text ?? '').slice(0, MAX_TEXT);
        if (!hasHebrew(src)) return { text: src, changed: false, name: false, reason: 'no-hebrew' };
        return (await host.ask({ type: 'point', text: src })).result;
      } };
  }
  return { ...common,
    /** Pointed text and its sound line. For a text that holds the divine Name the sound line is null and the model is never asked. @param {string} text */
    async sounds(text) {
      const src = String(text ?? '').slice(0, MAX_TEXT);
      const g = guardName(src);
      if (g.found) return { text: g.text, marked: g.text, phonemes: null, name: true, words: [], reason: 'name' };
      if (!hasHebrew(src)) return { text: src, marked: src, phonemes: null, name: false, words: [], reason: 'no-hebrew' };
      return (await host.ask({ type: 'sounds', text: src })).result;
    } };
}

/**
 * @param {{loader:any, pack?:'nikud'|'phonemes', ortBase?:string, signal?:AbortSignal, onProgress?:(have:number,total:number)=>void,
 *   caches?:any, WorkerCtor?:any, workerUrl?:string|URL, loaderUrl?:string|URL}} opts
 *   The last four are for tests and unusual layouts; the app passes loader, pack and ortBase.
 */
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

/** Frees the workers and the memory the graphs hold. Safe to call twice. */
export async function unload() {
  for (const pack of Object.keys(hosts)) { try { hosts[pack].stop(); } catch { /* gone */ } delete hosts[pack]; }
  for (const pack of Object.keys(apis)) delete apis[pack];
}
