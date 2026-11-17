export const id = 'speech';
export const version = '0.1.0';
export const VERSION = version;
export const packs = ['listen-lite', 'listen-best', 'pron-check'];
export const NEEDS_GRAPHICS = ['listen-best'];
export const PACK_HOST = 'https://alenzacodes.github.io/alef-packs/';
export { SAMPLE_RATE, toMono, resample, trimSilence, splitLong, parseWav, wavToPcm, decodeTake } from './audio.js';
export { logMel } from './mel.js';
export { createWhisper } from './whisper.js';
export { createCtc } from './ctc.js';
export { scoreUtterance, expectedUnits, isNameWord, TRADITIONS, DEFAULT_MARGIN } from './score.js';
const live = new Map();
const hosts = new Map();
export function packBases() {
 const out = [];
 try { if (/^https?:/.test(import.meta.url)) out.push(new URL('../../_packs/', import.meta.url).href); } catch { /* not a web address */ }
 out.push(PACK_HOST);
 return out;
}
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
 const send = async (msg, pcm) => { const copy = pcm.slice(); const r = await host.ask({ ...msg, pcm: copy }, [copy.buffer]); return { ...r.result, ms: r.ms }; };
 return {
  pack, kind: info.kind, device: info.device,
  transcribe: (pcm, o = {}) => send({ type: 'transcribe', options: o }, pcm),
  score: (pcm, text, o = {}) => send({ type: 'score', text, tradition: o.tradition, margin: o.margin }, pcm),
  release: async () => { try { await host.ask({ type: 'release' }); } catch { /* the worker is gone already */ } host.stop(); forget(); },
 };
}
export async function unload() {
 for (const [, host] of hosts) { try { host.stop(); } catch { /* gone */ } }
 hosts.clear(); live.clear();
}
