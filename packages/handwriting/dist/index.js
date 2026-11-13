import { createClassifier, CLASSES, NOT_A_LETTER, indexOf } from './classify.js';
import { strokesTo32, imageDataTo32, penFor, extentOf } from './preprocess.js';
import { checkLetter, checkWord, tipFor, resolveBySize, NAMES, SIZE_FAMILY, CONFUSABLE_GROUPS } from './feedback.js';
export const id = 'handwriting';
export const version = '0.1.0';
export const packs = ['handwriting'];
export const MODEL_FILE = 'letters.onnx';
export const MODEL_INFO = 'model.json';
export { createClassifier, CLASSES, NOT_A_LETTER, indexOf, strokesTo32, imageDataTo32, penFor, extentOf, checkLetter, checkWord, tipFor, resolveBySize, NAMES, SIZE_FAMILY, CONFUSABLE_GROUPS };
let live = null;
function notDownloaded(loader, why) {
 const E = loader && loader.PackError;
 if (E) return new E('not-downloaded', why);
 return Object.assign(new Error(why), { name: 'PackError', code: 'not-downloaded' });
}
async function fromLoader(loader, pack, opts) {
 const env = { bases: opts.bases, caches: opts.caches, fetch: opts.fetch, gpu: false, signal: opts.signal };
 let state;
 try { state = await loader.packState(pack, env); } catch (e) { if (e && e.code) throw notDownloaded(loader, 'The handwriting pack is not on this device.'); throw e; }
 if (!state.ready) throw notDownloaded(loader, 'The handwriting pack is not on this device.');
 const partsOf = (name) => { const parts = state.files.filter((f) => f.name === name); if (!parts.length) throw notDownloaded(loader, `The handwriting pack has no ${name}.`); return parts; };
 const cache = loader.cacheName(pack);
 const model = new Uint8Array(await loader.readFile(cache, partsOf(MODEL_FILE), env));
 const manifest = JSON.parse(new TextDecoder().decode(await loader.readFile(cache, partsOf(MODEL_INFO), env)));
 return { model, manifest };
}
export async function load(opts = {}) {
 let { model, manifest } = opts;
 if (!model || !manifest) {
  if (!opts.loader) throw notDownloaded(null, 'The handwriting pack is not on this device.');
  ({ model, manifest } = await fromLoader(opts.loader, opts.pack || 'handwriting', opts));
 }
 const classifier = await createClassifier({ model, manifest, ort: opts.ort, ortOptions: opts.ortOptions });
 const api = {
  backend: classifier.backend,
  modelVersion: manifest.version,
  classify: classifier.classify,
  async classifyStrokes(strokes, { strokeWidth } = {}) {
   const ext = extentOf(strokes);
   const picture = strokesTo32(strokes, { pen: penFor(strokeWidth, Math.max(ext.width, ext.height)) });
   return { ...(await classifier.classify(picture)), extent: ext, picture };
  },
  async classifyImageData(img) { const picture = imageDataTo32(img); return { ...(await classifier.classify(picture)), picture }; },
  async checkStrokes(strokes, { targetId, script = 'print', strokeWidth, heights } = /** @type {any} */ ({})) {
   const r = await api.classifyStrokes(strokes, { strokeWidth });
   return { ...checkLetter(r, { targetId, script, drawnHeight: r.extent.height, heights }), ranking: r.ranking.slice(0, 3) };
  },
  async checkWordStrokes(cells, { script = 'print', strokeWidth, heights } = {}) {
   const scored = [];
   for (const c of cells) { const r = await api.classifyStrokes(c.strokes, { strokeWidth }); scored.push({ targetId: c.targetId, result: r, drawnHeight: r.extent.height }); }
   return checkWord(scored, { script, heights });
  },
 };
 live = classifier;
 return api;
}
export async function unload() { const c = live; live = null; if (c) await c.dispose(); }
