import { createRuntime, joinParts } from './runtime.js';
export const GPU_SLOW_MS = 1500;
const keyOf = (msg) => msg.name || msg.direction;
let ortP = null;
let ortCanGpu = false;
const runtimes = {};
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
