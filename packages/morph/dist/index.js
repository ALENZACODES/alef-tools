export const id = 'morph';
export const version = '0.1.0';
export const packs = ['words'];
export const PACK = 'words';
export const PACK_FILES = Object.freeze({ model: 'joint.int8.onnx', vocab: 'vocab.txt', tokenizer: 'tokenizer.json', labels: 'labels.json' });
export { findInUnit, fromJoint, isWord } from './lookup.js';
export { describe, lessonNote, lint, prefixParts, whoOf, PREFIX_MEANING, NOTHING } from './explain.js';
export { segments, words, wordKey, contextKey, isNameWord, NAME_SHOWN } from './text.js';
export { plene, stripMarks, isPointed } from './plene.js';
const UNIT_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,40}$/;
const units = new Map();
const once = (key, make) => { if (!units.has(key)) { const p = make(); p.catch(() => units.delete(key)); units.set(key, p); } return units.get(key); };
export const isUnitId = (unit) => typeof unit === 'string' && UNIT_ID.test(unit) && unit !== 'units' && unit !== 'roots';
export const unitUrl = (unit) => new URL(`./data/morph/${unit}.js`, import.meta.url).href;
export function loadUnit(unit) {
 if (!isUnitId(unit)) return Promise.resolve(null);
 return once(unit, () => import(unitUrl(unit)).then((m) => m.default, () => null));
}
export function loadRoots() { return once('roots', () => import('./data/morph/roots.js').then((m) => m.default, () => null)); }
export function loadUnitList() { return once('units', () => import('./data/morph/units.js').then((m) => m.default, () => null)); }
let running = null;
let starting = null;
export function load(opts) {
 if (running) return Promise.resolve(running.api);
 if (!starting) { starting = start(opts || /** @type {any} */ ({})); starting.then(() => { starting = null; }, () => { starting = null; }); }
 return starting;
}
async function start(opts) {
 const loader = opts.loader;
 if (!loader || typeof loader.readFile !== 'function') throw new TypeError('morph.load needs opts.loader');
 const env = { caches: opts.caches, fetch: opts.fetch };
 const cache = loader.cacheName(PACK);
 let list;
 try { list = await loader.fetchPackList(PACK, { ...env, bases: opts.bases || [], cacheName: cache }); } catch { throw new loader.PackError('not-downloaded', PACK); }
 const files = loader.expandPack(list, { base: list.base, gpu: false });
 const state = await loader.filesState(files, { ...env, cacheName: cache });
 if (!state.ready) throw new loader.PackError('not-downloaded', PACK);
 const bytes = (name) => loader.readFile(cache, files.filter((f) => f.name === name), env);
 const [model, vocab, tokenizer, labels] = await Promise.all([bytes(PACK_FILES.model), bytes(PACK_FILES.vocab), bytes(PACK_FILES.tokenizer), bytes(PACK_FILES.labels)]);
 const text = (b) => new TextDecoder().decode(b);
 const host = loader.createWorkerHost({ url: new URL('./worker.js', import.meta.url), WorkerCtor: opts.WorkerCtor, type: 'module', timeoutMs: 60000, onCrash: () => { running = null; } });
 const ortBase = opts.ortBase || '';
 let ready;
 try {
  ready = await host.ask({ type: 'load', ort: `${ortBase}ort.wasm.min.mjs`, wasmPaths: ortBase, model: model.buffer, vocab: text(vocab), tokenizer: JSON.parse(text(tokenizer)), labels: JSON.parse(text(labels)) }, [model.buffer]);
 } catch (e) { host.stop(); throw e; }
 const api = { provider: ready.provider, analyse: async (input) => (await host.ask({ type: 'analyse', text: String(input ?? '').slice(0, 600) })).words };
 running = { host, api };
 return api;
}
export async function unload() {
 if (starting) { try { await starting; } catch { /* nothing started */ } }
 if (running) { try { running.host.stop(); } catch { /* gone */ } running = null; }
}
