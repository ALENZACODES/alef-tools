// @ts-check
// The worker: the nikud and phoneme graphs run here so the page stays responsive. Nothing leaves the device.
// It reads the pack parts from the pack's own cache with the shared loader's readFile (each part is checked against the
// SHA-256 it was kept with), starts the app's vendored onnxruntime-web on WebAssembly, and answers one text at a time.
import { createMenaked } from './menaked.js';
import { createPhonikud } from './phonikud.js';

/** @type {Promise<any>|null} */
let ortP = null;
/** @type {Record<string, Promise<any>>} */
const engines = {};

function loadOrt(ortBase) {
  if (!ortP) ortP = (async () => {
    const ort = await import(`${ortBase}ort.wasm.min.mjs`);
    ort.env.wasm.numThreads = 1; // a static host cannot send the headers shared memory needs
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = ortBase;
    // The WebAssembly file is kept with the Talk packs when one was downloaded; otherwise the runtime fetches it from the site.
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
  // one logical file per pack: the graph with its weights inside
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

// Same request-and-answer shape as the loader's serveWorker; written out here because the loader's address only arrives
// with the first message.
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
