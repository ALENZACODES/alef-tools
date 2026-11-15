// @ts-check
// Translation packs: the worker. Translation runs here so the page stays responsive.
// It reads the pack parts from the pack cache (falling back to the site itself), loads the vendored runtime from the same
// address and answers one line at a time. Nothing leaves the device.
//
// Two ways of running: on the processor (WebAssembly, the 8-bit graphs), or with the encoder and decoder on the graphics card
// (WebGPU). The graphics card is used only after it has proved itself on this device: it must give the recorded answer for two
// check lines, and the second must come back quickly. Anything else, and the processor is used. The learner is never asked.
import { createRuntime, joinParts } from './runtime.js';

/** A check line on the graphics card slower than this (after the first, which also pays for setting up) means: use the processor. */
export const GPU_SLOW_MS = 1500;

/** A pack is known by its name in the manifest (he-en, en-he, he-en-hq). Older pages send it as `direction`. */
const keyOf = (msg) => msg.name || msg.direction;

/** @type {any} */
let ortP = null;
let ortCanGpu = false;
/** @type {Record<string, Promise<any>>} */
const runtimes = {};
/** @type {Record<string, any>} */
const info = {};

async function bytesOf(cacheName, key, url) {
  try { const hit = await (await caches.open(cacheName)).match(key); if (hit) return hit.arrayBuffer(); } catch { /* no cache storage here */ }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return res.arrayBuffer();
}

function loadOrt(msg) {
  if (!ortP) ortP = (async () => {
    const entry = msg.files.find((f) => /ort\.(webgpu|wasm)\.min\.mjs$/.test(f.key));
    ortCanGpu = /webgpu/.test(entry.key);
    const ort = await import(entry.key);
    ort.env.wasm.numThreads = 1; // a static host cannot send the headers shared memory needs
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = msg.ortBase;
    // the WebAssembly file: one file, or parts to join (the graphics-card runtime is over one host's 25 MiB cap)
    const whole = msg.files.find((f) => f.key.endsWith('.wasm'));
    const parts = msg.files.filter((f) => /\.asyncify\.p\d+\.bin$/.test(f.key)).sort((a, b) => Number(a.key.match(/\.p(\d+)\.bin$/)[1]) - Number(b.key.match(/\.p(\d+)\.bin$/)[1]));
    if (whole) ort.env.wasm.wasmBinary = await bytesOf(msg.cache, whole.key, whole.url);
    else if (parts.length) { const got = []; for (const p of parts) got.push(await bytesOf(msg.cache, p.key, p.url)); ort.env.wasm.wasmBinary = joinParts(got).buffer; }
    ort.env.logLevel = 'error';
    return ort;
  })();
  return ortP;
}

const make = async (msg, device) => {
  const ort = await loadOrt(msg);
  const byPath = new Map(msg.files.map((f) => [f.path, f]));
  return createRuntime({ ort, pack: msg.pack, device, read: (path) => { const f = byPath.get(path); return bytesOf(msg.cache, f.key, f.url); } });
};

const verdictKey = (msg) => `${msg.ortBase}../_nmt/engine-${keyOf(msg)}.json?v=${msg.version || '0'}`;
async function readVerdict(msg) { try { const hit = await (await caches.open(msg.cache)).match(verdictKey(msg)); return hit ? await hit.json() : null; } catch { return null; } }
async function writeVerdict(msg, note) { try { await (await caches.open(msg.cache)).put(verdictKey(msg), new Response(JSON.stringify(note), { headers: { 'content-type': 'application/json' } })); } catch { /* asked again next time */ } }

/** Loads the graphics-card runtime and runs the two check lines. Returns the runtime when it passed, else null (and frees it). */
async function proveGpu(msg, note) {
  const probe = msg.pack.probe || [];
  let rt = null;
  try {
    rt = await make(msg, 'webgpu');
    const first = await rt.translate(probe[0].text, { beams: 2 });
    const t0 = performance.now();
    const second = await rt.translate(probe[1].text, { beams: 2 });
    note.checkMs = Math.round(performance.now() - t0);
    if (first !== probe[0].expect || second !== probe[1].expect) note.gpu = 'wrong-answer';
    else if (note.checkMs > (msg.slowMs || GPU_SLOW_MS)) note.gpu = 'slow';
    else { note.gpu = 'ok'; return rt; }
  } catch (e) { note.gpu = 'failed'; note.error = String((e && /** @type {any} */ (e).message) || e).slice(0, 200); }
  try { await rt?.release(); } catch { /* nothing to free */ }
  return null;
}

/**
 * The runtime for one direction. The processor way is ready first, so the learner never waits for the check. The graphics card
 * is then tried once in the background; if it gives the recorded answers quickly, later lines use it. The outcome is remembered
 * with the pack, so the check is paid once per device and pack version.
 */
async function best(msg) {
  const note = { engine: 'wasm', gpu: 'not-tried', checkMs: null };
  info[keyOf(msg)] = note;
  await loadOrt(msg);
  const can = msg.gpu && ortCanGpu && msg.pack.gpu?.length && (msg.pack.probe || []).length >= 2;
  const known = can ? await readVerdict(msg) : null;
  if (can && known?.gpu === 'ok') {
    const rt = await proveGpu(msg, note);
    if (rt) { note.engine = 'webgpu'; return { current: rt }; }
    await writeVerdict(msg, note);
  }
  const holder = { current: await make(msg, 'wasm') };
  if (can && !known) {
    holder.checking = (async () => {
      const rt = await proveGpu(msg, note);
      if (rt) { const old = holder.current; holder.current = rt; note.engine = 'webgpu'; try { await old.release(); } catch { /* freed */ } }
      await writeVerdict(msg, { gpu: note.gpu, checkMs: note.checkMs });
    })().catch(() => {});
  } else if (known) { note.gpu = known.gpu; note.checkMs = known.checkMs ?? null; }
  return holder;
}

/** Both ways of running, timed on the same lines. For the speed check on the Talk screen. */
async function bench(msg) {
  const lines = (msg.pack.probe || []).map((p) => p.text);
  const out = {};
  for (const device of ['wasm', 'webgpu']) {
    if (device === 'webgpu' && !(msg.gpu && ortCanGpu && msg.pack.gpu?.length)) continue;
    try {
      const holder = await runtimes[keyOf(msg)]; await holder.checking;
      const using = info[keyOf(msg)]?.engine === device ? holder.current : await make(msg, device);
      await using.translate(lines[0], { beams: 2 });           // not timed: the first line also pays for setting up
      const t0 = performance.now();
      for (let i = 0; i < 3; i++) for (const l of lines) await using.translate(l, { beams: 2 });
      out[device] = Math.round((performance.now() - t0) / (3 * lines.length));
      if (info[keyOf(msg)]?.engine !== device) await using.release();
    } catch (e) { out[device] = null; out[`${device}Error`] = String((e && /** @type {any} */ (e).message) || e).slice(0, 200); }
  }
  return out;
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === 'load') {
      if (!runtimes[keyOf(msg)]) {
        runtimes[keyOf(msg)] = best(msg);
        runtimes[keyOf(msg)].catch(() => { delete runtimes[keyOf(msg)]; });
      }
      await runtimes[keyOf(msg)];
      self.postMessage({ id: msg.id, ok: true, info: info[keyOf(msg)] });
    } else if (msg.type === 'translate') {
      const holder = await runtimes[keyOf(msg)];
      if (!holder) throw new Error('not-loaded');
      self.postMessage({ id: msg.id, ok: true, text: await holder.current.translate(msg.text, { beams: msg.beams || 2 }), engine: info[keyOf(msg)]?.engine });
    } else if (msg.type === 'bench') {
      self.postMessage({ id: msg.id, ok: true, bench: await bench(msg), info: info[keyOf(msg)] });
    } else self.postMessage({ id: msg.id, ok: false, error: 'unknown' });
  } catch (e) {
    self.postMessage({ id: msg.id, ok: false, error: String((e && /** @type {any} */ (e).message) || e) });
  }
};
