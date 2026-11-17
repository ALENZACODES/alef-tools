// @ts-check
// Package entry, in the shape docs/CONTRACT.md section 2 asks for.
//
//   const hw = await load({ loader });            // the pack must already be on the device
//   const r  = await hw.checkStrokes(strokes, { targetId: 'dalet', script: 'print', strokeWidth, heights });
//   r.text  -> one sentence for the learner, or null when there is nothing worth saying
//
// load() never starts a download. Without the pack on the device it rejects with code "not-downloaded".
// For tests and for an app that keeps the file itself, pass the bytes directly: load({ model, manifest }).
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
  // packState reads the pack list (from the site or the pack host; offline, the saved copy) and says which parts are kept.
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

/**
 * @param {{loader?: any, pack?: string, bases?: string[], caches?: any, fetch?: any, model?: Uint8Array|ArrayBuffer, manifest?: any, ort?: any, ortOptions?: object, signal?: AbortSignal}} [opts]
 *   `bases`: where pack lists live (the site's pack folder, then the pack host), passed straight to the loader.
 *   `ort`: pass the onnxruntime-web module to run on it; leave out to use the small built-in runner (nothing more to fetch).
 */
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
    /** What the learner drew as pen strokes -> scores. */
    async classifyStrokes(strokes, { strokeWidth } = {}) {
      const ext = extentOf(strokes);
      const picture = strokesTo32(strokes, { pen: penFor(strokeWidth, Math.max(ext.width, ext.height)) });
      return { ...(await classifier.classify(picture)), extent: ext, picture };
    },
    /** Canvas pixels (getImageData) -> scores. */
    async classifyImageData(img) { const picture = imageDataTo32(img); return { ...(await classifier.classify(picture)), picture }; },
    /** Strokes + the letter the learner meant -> verdict and at most one sentence. */
    async checkStrokes(strokes, { targetId, script = 'print', strokeWidth, heights } = /** @type {any} */ ({})) {
      const r = await api.classifyStrokes(strokes, { strokeWidth });
      return { ...checkLetter(r, { targetId, script, drawnHeight: r.extent.height, heights }), ranking: r.ranking.slice(0, 3) };
    },
    /** A short word: one {targetId, strokes} per letter, in writing order. */
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
