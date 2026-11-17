// @ts-check
// @alef-tools/speech: Hebrew listening on the device (docs/CONTRACT.md, section 2). See README.md.
//
//   listen-lite   writes down the Hebrew (or English) that was said; any device
//   listen-best   the same, more carefully; a computer with a graphics card
//   pron-check    letter-by-letter pronunciation feedback
//
// Nothing here starts a download, opens the microphone or sends anything. The app downloads a pack with the shared loader on
// the learner's tap, records the take itself, and hands the samples to load(...).transcribe / .score.
export const id = 'speech';
export const version = '0.1.0';
export const VERSION = version;
export const packs = ['listen-lite', 'listen-best', 'pron-check'];
/** Packs that only run on a real graphics adapter. */
export const NEEDS_GRAPHICS = ['listen-best'];
export const PACK_HOST = 'https://alenzacodes.github.io/alef-packs/';

export { SAMPLE_RATE, toMono, resample, trimSilence, splitLong, parseWav, wavToPcm, decodeTake } from './audio.js';
export { logMel } from './mel.js';
export { createWhisper } from './whisper.js';
export { createCtc } from './ctc.js';
export { scoreUtterance, expectedUnits, isNameWord, TRADITIONS, DEFAULT_MARGIN } from './score.js';

/** @type {Map<string, Promise<any>>} */
const live = new Map();
/** @type {Map<string, any>} */
const hosts = new Map();

/** Where pack lists are looked for: the site's own folder first, then the static pack host (CONTRACT 4.2). */
export function packBases() {
  const out = [];
  try { if (/^https?:/.test(import.meta.url)) out.push(new URL('../../_packs/', import.meta.url).href); } catch { /* not a web address */ }
  out.push(PACK_HOST);
  return out;
}

/**
 * Loads a pack that is already on the device and returns its working API. Never downloads: when the pack is not there it
 * rejects with PackError('not-downloaded').
 * @param {{loader:any, pack?:string, ortBase:string, ortDataBase?:string, loaderUrl?:string, bases?:string[], signal?:AbortSignal,
 *   onProgress?:(have:number,total:number)=>void, WorkerCtor?:any, workerUrl?:string|URL, env?:any}} opts
 *   loaderUrl: the address of the shared loader's index.js (the worker loads its own copy); by default the folder next to this one.
 *   ortDataBase: where the runtime's WebAssembly is found when this copy of the site does not carry it (the pack host's _ort/).
 * @returns {Promise<{pack:string, kind:'whisper'|'ctc', device:'wasm'|'webgpu',
 *   transcribe:(pcm:Float32Array, o?:{language?:'he'|'en', hebrewOnly?:boolean})=>Promise<any>,
 *   score:(pcm:Float32Array, text:string, o?:{tradition?:string, margin?:number})=>Promise<any>, release:()=>Promise<void>}>}
 */
export function load(opts) {
  const pack = opts?.pack || 'listen-lite';
  if (!live.has(pack)) { const p = start(pack, opts); live.set(pack, p); p.catch(() => { if (live.get(pack) === p) live.delete(pack); }); }
  return /** @type {Promise<any>} */ (live.get(pack));
}

async function start(pack, opts) {
  const { loader } = opts;
  if (!loader || loader.CONTRACT !== 1) throw new TypeError('speech.load needs the shared loader (contract 1)');
  if (!packs.includes(pack)) throw new loader.PackError('bad-pack-name', pack);
  const env = opts.env || {};
  const needsGpu = NEEDS_GRAPHICS.includes(pack);
  const gpu = needsGpu && ('gpu' in env ? !!env.gpu : await loader.hasGraphics(env));
  if (needsGpu && !gpu) throw new loader.PackError('cannot-run', 'needs-graphics');
  const st = await loader.packState(pack, { ...env, bases: opts.bases || packBases(), gpu });
  opts.onProgress?.(st.have, st.total);
  if (!st.ready) throw new loader.PackError('not-downloaded', pack);
  if (opts.signal?.aborted) throw new loader.PackError('aborted');
  /** @type {Record<string, any[]>} */ const files = {};
  for (const f of st.files) (files[f.name] ||= []).push({ key: f.key, bytes: f.bytes, sha256: f.sha256 });
  const forget = () => { hosts.delete(pack); live.delete(pack); };
  const host = loader.createWorkerHost({ url: opts.workerUrl || new URL('./asr-worker.js', import.meta.url), WorkerCtor: opts.WorkerCtor, onCrash: forget });
  hosts.set(pack, host);
  const loaderUrl = opts.loaderUrl || new URL(`../loader@${loader.VERSION}/index.js`, import.meta.url).href;
  let info;
  try { info = await host.ask({ type: 'load', pack, cache: loader.cacheName(pack), files, loaderUrl, ortBase: opts.ortBase, ortDataBase: opts.ortDataBase || '', gpu }); } catch (e) { host.stop(); forget(); throw e; }
  // each take goes to the worker as a copy that is handed over, not shared; the caller's samples stay as they are
  const send = async (msg, pcm) => { const copy = pcm.slice(); const r = await host.ask({ ...msg, pcm: copy }, [copy.buffer]); return { ...r.result, ms: r.ms }; };
  return {
    pack, kind: info.kind, device: info.device,
    transcribe: (pcm, o = {}) => send({ type: 'transcribe', options: o }, pcm),
    score: (pcm, text, o = {}) => send({ type: 'score', text, tradition: o.tradition, margin: o.margin }, pcm),
    release: async () => { try { await host.ask({ type: 'release' }); } catch { /* the worker is gone already */ } host.stop(); forget(); },
  };
}

/** Frees every worker, session and model held. Safe to call twice. */
export async function unload() {
  for (const [, host] of hosts) { try { host.stop(); } catch { /* gone */ } }
  hosts.clear(); live.clear();
}
