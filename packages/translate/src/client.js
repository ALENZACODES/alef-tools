// @ts-check
// Translation packs: the page's side. One instance serves every screen of the host app that translates.
// A pack is known by its name in the manifest. A direction (he-en, en-he) can be served by more than one pack:
// the ordinary one, and a larger high-quality one (quality: "high") that is offered only where a graphics card can run it.

/** Longest line handed to a pack; longer text is cut at a sentence end by the caller. */
export const MAX_LINE = 400;

/**
 * @param {{store:any, workerUrl:string|URL, WorkerCtor?:any, env?:any, slowMs?:()=>number, forceGraphics?:()=>boolean}} cfg
 *   store: createPackStore(...) of pack.js.  workerUrl: the address of worker.js on the site.
 */
export function createPackClient(cfg) {
  const env = cfg.env || {};
  const store = cfg.store;
  /** @type {any} */ let manifestP = null;
  /** @type {any} */ let worker = null;
  let seq = 0;
  /** @type {Map<number, {resolve:(v:any)=>void, reject:(e:any)=>void}>} */
  const waiting = new Map();
  /** @type {Record<string, Promise<boolean>>} */
  const loading = {};
  /** Names of the packs that are loaded, each with the direction it serves and whether it is the high-quality one. @type {Map<string, {direction:string, high:boolean}>} */
  const loaded = new Map();
  /** @type {Record<string, any>} */
  const engines = {};
  /** @type {Record<string, any>} */
  const sent = {};
  /** @type {Promise<boolean>|null} */
  let gpuP = null;
  /** Whether this browser hands out a graphics adapter (asked once). */
  const graphics = () => (gpuP ||= 'gpu' in env ? Promise.resolve(!!env.gpu) : store.hasGraphics(undefined, cfg.forceGraphics ? !!cfg.forceGraphics() : false));

  const manifest = () => { if (!manifestP) { manifestP = store.loadManifest(env); manifestP.catch(() => { manifestP = null; }); } return manifestP; };
  /** The loaded pack that answers a direction: the high-quality one when it is loaded. */
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
    /** The packs of the manifest: [{name, direction, high, needsGraphics, bytes, model, licence}]. */
    async packs() {
      const m = await manifest();
      return Object.entries(m.packs || {}).map(([name, p]) => ({ name, direction: /** @type {any} */ (p).direction || name, high: /** @type {any} */ (p).quality === 'high', needsGraphics: /** @type {any} */ (p).requires === 'webgpu', bytes: /** @type {any} */ (p).bytes, model: /** @type {any} */ (p).model, licence: /** @type {any} */ (p).licence }));
    },
    /**
     * Sizes and whether the files of one pack are on the device. `offered` is false for a pack that needs a graphics card
     * on a browser without one (it is then neither shown nor downloaded, though files already kept still count).
     */
    async state(name) {
      const m = await manifest(); const gpu = await graphics();
      const st = await store.packState(m, name, { ...env, gpu });
      const needs = m.packs?.[name]?.requires === 'webgpu';
      return { ...st, offered: !!m.packs?.[name] && (!needs || gpu || st.ready) };
    },
    /** @param {string} name @param {{onProgress?:(have:number,total:number)=>void, signal?:AbortSignal}} [opts] */
    download: async (name, opts = {}) => { const m = await manifest(); const st = await store.packState(m, name, { ...env, gpu: await graphics() }); return store.downloadPack(m, name, { ...env, ...opts, gpu: st.gpu }); },
    /** How a loaded pack runs on this device: {engine:'webgpu'|'wasm', gpu:'ok'|'slow'|'wrong-answer'|'failed'|'not-tried', checkMs}. */
    engine: (name) => engines[name] || engines[serving(name)] || null,
    /** Times both ways of running on this device: {wasm: ms a line, webgpu?: ms a line}. */
    async bench(name) { if (!loaded.has(name)) throw new Error('not-loaded'); const m = await ask({ ...sent[name], type: 'bench' }); engines[name] = m.info || engines[name]; return m.bench; },
    /** True once a pack that answers this direction (or the pack of this name) is loaded. */
    ready: (nameOrDirection) => loaded.has(nameOrDirection) || !!serving(nameOrDirection),
    /** True when the pack of exactly this name is loaded. */
    has: (name) => loaded.has(name),
    /** The name of the loaded pack that answers a direction, or ''. */
    serving,
    /** Loads a pack that is on the device. Resolves false when it is not there or cannot run here. */
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
    /** @param {string} direction a direction, answered by the best loaded pack for it (or a pack name) @param {string} text @returns {Promise<string>} */
    async translate(direction, text) {
      const name = serving(direction) || (loaded.has(direction) ? direction : '');
      if (!name) throw new Error('not-loaded');
      const m = await ask({ type: 'translate', name, direction: name, text: String(text || '').slice(0, MAX_LINE), beams: 2 });
      if (m.engine && engines[name]) engines[name] = { ...engines[name], engine: m.engine };
      return m.text || '';
    },
    async remove() { this.dispose(); return store.removePacks(env); },
    /** Removes one pack from the device. The others, if kept, load again when they are next needed. */
    async removeOne(name) { const m = await manifest(); this.dispose(); return store.removePack(m, name, env); },
    dispose() { try { worker?.terminate(); } catch { /* gone */ } worker = null; loaded.clear(); for (const k of Object.keys(loading)) delete loading[k]; for (const w of waiting.values()) w.reject(new Error('stopped')); waiting.clear(); },
  };
}
