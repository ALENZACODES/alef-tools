// @ts-check
// The listening worker. Recognition and the letter check run here so the page stays responsive.
// It reads the pack's files from the pack's own cache with the shared loader, loads the runtime the app already carries,
// and answers one take at a time. The sound never leaves this worker: nothing in this package sends anything anywhere
// (tests/no-upload.test.js checks the source and a full run).
import { createWhisper } from './whisper.js';
import { createCtc, MIN_SAMPLES } from './ctc.js';
import { scoreUtterance } from './score.js';
import { trimSilence } from './audio.js';

/** @type {any} */ let loader = null;
/** @type {any} */ let engine = null;

/** The runtime's WebAssembly: from the Talk pack cache when it is there, else a plain GET from the site, else from the pack host. */
async function runtimeBytes(msg, name) {
  try {
    const cache = await caches.open('alef-talk-pack-v1');
    for (const req of await cache.keys()) if (req.url.split('?')[0].endsWith('/' + name)) { const hit = await cache.match(req); if (hit) return hit.arrayBuffer(); }
  } catch { /* no cache storage here */ }
  for (const base of [msg.ortBase, msg.ortDataBase]) {
    if (!base) continue;
    try { const res = await fetch(base + name); if (res.ok) return res.arrayBuffer(); } catch { /* next place */ }
  }
  throw new loader.PackError('no-runtime', name);
}

async function loadOrt(msg) {
  const gpu = !!msg.gpu;
  const ort = await import(/* @vite-ignore */ `${msg.ortBase}${gpu ? 'ort.webgpu.min.mjs' : 'ort.wasm.min.mjs'}`);
  ort.env.wasm.numThreads = 1; // a static host cannot send the headers shared memory needs
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = msg.ortBase;
  if (gpu) {
    // the graphics-card runtime is kept in two parts (one host caps a file at 25 MiB); joined here
    const a = new Uint8Array(await runtimeBytes(msg, 'ort-wasm-simd-threaded.asyncify.p0.bin')), b = new Uint8Array(await runtimeBytes(msg, 'ort-wasm-simd-threaded.asyncify.p1.bin'));
    const whole = new Uint8Array(a.length + b.length); whole.set(a); whole.set(b, a.length);
    ort.env.wasm.wasmBinary = whole.buffer;
  } else ort.env.wasm.wasmBinary = await runtimeBytes(msg, 'ort-wasm-simd-threaded.wasm');
  ort.env.logLevel = 'error';
  return ort;
}

/** Builds the engine for the pack this worker serves. */
async function make(msg) {
  const read = (name) => { const parts = msg.files[name]; if (!parts) throw new loader.PackError('bad-pack-list', name); return loader.readFile(msg.cache, parts); };
  const json = async (name) => JSON.parse(new TextDecoder().decode(await read(name)));
  const spec = await json('spec.json');
  const ort = await loadOrt(msg);
  const gpu = !!msg.gpu;
  const base = { graphOptimizationLevel: 'all', logSeverityLevel: 3 };
  if (spec.kind === 'whisper') {
    const tokens = await json('tokens.json');
    const decoderOptions = { ...base, executionProviders: [gpu ? 'webgpu' : 'wasm'] };
    // on the graphics card, what the decoder remembers between tokens stays there; only the scores come back
    if (gpu) decoderOptions.preferredOutputLocation = Object.fromEntries(Array.from({ length: spec.config.decoder_layers }, (_, i) => ['decoder', 'encoder'].flatMap((side) => ['key', 'value'].map((kv) => [`present.${i}.${side}.${kv}`, 'gpu-buffer']))).flat());
    // one at a time: two graphs built at once would hold every byte twice at the same moment
    const encoder = await ort.InferenceSession.create(await read('encoder.onnx'), { ...base, executionProviders: [gpu ? 'webgpu' : 'wasm'] });
    const decoder = await ort.InferenceSession.create(await read('decoder.onnx'), decoderOptions);
    const w = await createWhisper({ ort, encoder, decoder, vocab: tokens.vocab, added: tokens.added, config: spec.config, generation: spec.generation });
    return { kind: 'whisper', device: gpu ? 'webgpu' : 'wasm', whisper: w, release: w.release };
  }
  if (spec.kind === 'ctc') {
    const c = await createCtc({ ort, model: await read('model.onnx'), vocab: await json('vocab.json'), sessionOptions: { ...base, executionProviders: ['wasm'] } });
    return { kind: 'ctc', device: 'wasm', ctc: c, margin: spec.margin, release: c.release };
  }
  throw new loader.PackError('bad-pack-list', 'kind');
}

const need = (kind) => { if (!engine) throw new loader.PackError('not-loaded'); if (engine.kind !== kind) throw new loader.PackError('wrong-pack'); return engine; };

const handlers = {
  async load(msg) { if (!engine) engine = await make(msg); return { kind: engine.kind, device: engine.device }; },
  async transcribe(msg) {
    const e = need('whisper'); const t0 = performance.now();
    const result = await e.whisper.transcribe(msg.pcm, msg.options || {});
    return { result, ms: Math.round(performance.now() - t0) };
  },
  async score(msg) {
    const e = need('ctc'); const t0 = performance.now();
    const cut = trimSilence(msg.pcm);
    if (!cut.speech || cut.pcm.length < MIN_SAMPLES) return { result: { ok: false, error: 'no-speech', letters: [], words: [], checked: 0, right: 0, score: null }, ms: 0 };
    const heard = await e.ctc.posteriors(cut.pcm);
    const result = scoreUtterance(heard, { vocab: e.ctc.vocab, blankId: e.ctc.blankId }, msg.text, { tradition: msg.tradition, margin: msg.margin ?? e.margin });
    return { result, ms: Math.round(performance.now() - t0) };
  },
  async release() { const e = engine; engine = null; try { await e?.release(); } catch { /* already gone */ } return {}; },
};

// The first message names the shared loader (the page already has it; a worker has to load its own copy of the same file).
const scope = /** @type {any} */ (globalThis);
/** @type {Promise<any>|null} */ let serving = null;
scope.onmessage = async (event) => {
  const msg = event.data || {};
  if (!serving) serving = (async () => {
    loader = await import(/* @vite-ignore */ msg.loaderUrl);
    const inner = { /** @type {any} */ onmessage: null, postMessage: (m, transfer) => scope.postMessage(m, transfer) };
    loader.serveWorker(handlers, inner);
    return inner;
  })();
  let inner;
  try { inner = await serving; } catch (e) { serving = null; scope.postMessage({ id: msg.id, ok: false, code: 'no-loader', error: String(/** @type {any} */ (e)?.message || e) }); return; }
  inner.onmessage(event);
};
