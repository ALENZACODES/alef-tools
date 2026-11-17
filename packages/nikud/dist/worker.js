import { createMenaked } from './menaked.js';
import { createPhonikud } from './phonikud.js';
let ortP = null;
const engines = {};
function loadOrt(ortBase) {
 if (!ortP) ortP = (async () => {
  const ort = await import(`${ortBase}ort.wasm.min.mjs`);
  ort.env.wasm.numThreads = 1; // a static host cannot send the headers shared memory needs
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = ortBase;
  try { const hit = await caches.match(`${ortBase}ort-wasm-simd-threaded.wasm`); if (hit) ort.env.wasm.wasmBinary = await hit.arrayBuffer(); } catch { /* fetched by the runtime */ }
  ort.env.logLevel = 'error';
  return ort;
 })();
 ortP.catch(() => { ortP = null; });
 return ortP;
}
async function start(msg) {
 const loader = await import(msg.loaderUrl);
 const ort = await loadOrt(msg.ortBase);
 const session = await ort.InferenceSession.create(await loader.readFile(msg.cacheName, msg.parts), { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
 return msg.pack === 'phonemes' ? createPhonikud({ ort, session }) : createMenaked({ ort, session });
}
const handlers = {
 async load(msg) {
  if (!engines[msg.pack]) { engines[msg.pack] = start(msg); engines[msg.pack].catch(() => { delete engines[msg.pack]; }); }
  await engines[msg.pack];
  return {};
 },
 async point(msg) { const e = await engines.nikud; if (!e) throw Object.assign(new Error('not-loaded'), { code: 'not-loaded' }); return { result: await e.point(msg.text) }; },
 async sounds(msg) { const e = await engines.phonemes; if (!e) throw Object.assign(new Error('not-loaded'), { code: 'not-loaded' }); return { result: await e.sounds(msg.text) }; },
};
self.onmessage = async (event) => {
 const m = event.data || {};
 try {
  const fn = handlers[m.type];
  if (!fn) throw Object.assign(new Error(String(m.type)), { code: 'unknown-message' });
  self.postMessage({ ...(await fn(m)), id: m.id, ok: true });
 } catch (e) {
  const any = /** @type {any} */ (e);
  self.postMessage({ id: m.id, ok: false, code: any?.code || 'failed', error: String(any?.message || e) });
 }
};
