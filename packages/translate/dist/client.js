export const MAX_LINE = 400;
export function createPackClient(cfg) {
 const env = cfg.env || {};
 const store = cfg.store;
  /** @type {any} */ let manifestP = null;
  /** @type {any} */ let worker = null;
 let seq = 0;
 const waiting = new Map();
 const loading = {};
 const loaded = new Map();
 const engines = {};
 const sent = {};
 let gpuP = null;
 const graphics = () => (gpuP ||= 'gpu' in env ? Promise.resolve(!!env.gpu) : store.hasGraphics(undefined, cfg.forceGraphics ? !!cfg.forceGraphics() : false));
 const manifest = () => { if (!manifestP) { manifestP = store.loadManifest(env); manifestP.catch(() => { manifestP = null; }); } return manifestP; };
 const serving = (direction) => {
  let pick = '';
  for (const [name, p] of loaded) if (p.direction === direction && (!pick || p.high)) pick = name;
  return pick;
 };
 function startWorker() {
  if (worker) return worker;
  const Ctor = cfg.WorkerCtor || globalThis.Worker;
  if (!Ctor) throw new Error('no-worker');
  worker = new Ctor(cfg.workerUrl, { type: 'module' });
  worker.onmessage = (event) => { const m = event.data || {}; const w = waiting.get(m.id); if (!w) return; waiting.delete(m.id); if (m.ok) w.resolve(m); else w.reject(new Error(m.error || 'failed')); };
  worker.onerror = () => { for (const w of waiting.values()) w.reject(new Error('worker-error')); waiting.clear(); loaded.clear(); for (const k of Object.keys(loading)) delete loading[k]; try { worker.terminate(); } catch { /* gone */ } worker = null; };
  return worker;
 }
 const ask = (msg) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); try { startWorker().postMessage({ ...msg, id }); } catch (e) { waiting.delete(id); reject(e); } });
 return {
  manifest,
  async packs() {
   const m = await manifest();
   return Object.entries(m.packs || {}).map(([name, p]) => ({ name, direction: /** @type {any} */ (p).direction || name, high: /** @type {any} */ (p).quality === 'high', needsGraphics: /** @type {any} */ (p).requires === 'webgpu', bytes: /** @type {any} */ (p).bytes, model: /** @type {any} */ (p).model, licence: /** @type {any} */ (p).licence }));
  },
  async state(name) {
   const m = await manifest(); const gpu = await graphics();
   const st = await store.packState(m, name, { ...env, gpu });
   const needs = m.packs?.[name]?.requires === 'webgpu';
   return { ...st, offered: !!m.packs?.[name] && (!needs || gpu || st.ready) };
  },
  download: async (name, opts = {}) => { const m = await manifest(); const st = await store.packState(m, name, { ...env, gpu: await graphics() }); return store.downloadPack(m, name, { ...env, ...opts, gpu: st.gpu }); },
  engine: (name) => engines[name] || engines[serving(name)] || null,
  async bench(name) { if (!loaded.has(name)) throw new Error('not-loaded'); const m = await ask({ ...sent[name], type: 'bench' }); engines[name] = m.info || engines[name]; return m.bench; },
  ready: (nameOrDirection) => loaded.has(nameOrDirection) || !!serving(nameOrDirection),
  has: (name) => loaded.has(name),
  serving,
  load(name) {
   if (!loading[name]) {
    loading[name] = (async () => {
     const m = await manifest();
     const st = await store.packState(m, name, { ...env, gpu: await graphics() });
     if (!st.ready) return false;
     const all = store.packFiles(m, name, { gpu: st.gpu });
     const pack = m.packs[name];
     const from = pack.base || m.base || store.base;
     const files = all.map((f) => ({ ...f, path: f.key.startsWith(from) ? f.key.slice(from.length).replace(/\?.*$/, '') : f.key }));
     sent[name] = { name, direction: name, pack, files, gpu: st.gpu, version: m.version, slowMs: cfg.slowMs ? cfg.slowMs() : 0, cache: store.cacheName, ortBase: store.ortLocal };
     const done = await ask({ ...sent[name], type: 'load' });
     engines[name] = done.info || null;
     loaded.set(name, { direction: pack.direction || name, high: pack.quality === 'high' });
     return true;
    })().catch(() => { delete loading[name]; return false; });
   }
   return loading[name];
  },
  async translate(direction, text) {
   const name = serving(direction) || (loaded.has(direction) ? direction : '');
   if (!name) throw new Error('not-loaded');
   const m = await ask({ type: 'translate', name, direction: name, text: String(text || '').slice(0, MAX_LINE), beams: 2 });
   if (m.engine && engines[name]) engines[name] = { ...engines[name], engine: m.engine };
   return m.text || '';
  },
  async remove() { this.dispose(); return store.removePacks(env); },
  async removeOne(name) { const m = await manifest(); this.dispose(); return store.removePack(m, name, env); },
  dispose() { try { worker?.terminate(); } catch { /* gone */ } worker = null; loaded.clear(); for (const k of Object.keys(loading)) delete loading[k]; for (const w of waiting.values()) w.reject(new Error('stopped')); waiting.clear(); },
 };
}
