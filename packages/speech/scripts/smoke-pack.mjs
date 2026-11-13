#!/usr/bin/env node
// Runs a built pack the way the app will, without a browser: the shared loader downloads it part by part (from a folder on
// disk standing in for the pack host), checks every part, keeps it in a cache (in memory here), and the real worker code loads
// it on the app's own vendored onnxruntime-web (WebAssembly, one thread) and answers a recording.
//
//   node scripts/smoke-pack.mjs --packs <folder with <pack>/pack.json> --pack listen-lite --ort <Al-Heb>/assets/vendor/_ort --wav <file.wav> [--text "<expected Hebrew>"] [--tradition israeli]
//
// What it cannot show: the microphone, a real browser's memory limits, or the graphics-card path (listen-best needs WebGPU).
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as loader from '../../loader/src/index.js';
import * as speech from '../src/index.js';
import { wavToPcm } from '../src/audio.js';
import { memoryCaches } from '../../loader/tests/helpers.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const packs = resolve(arg('packs', '.')), pack = arg('pack', 'listen-lite'), ortDir = resolve(arg('ort', '.')), wav = arg('wav');
if (!wav || !existsSync(join(packs, pack, 'pack.json'))) { console.error('usage: smoke-pack.mjs --packs <dir> --pack <name> --ort <dir> --wav <file>'); process.exit(2); }
const HOST = 'https://packs.invalid/'; // never contacted: every request is answered from disk below
const ORT = pathToFileURL(ortDir).href + '/';
const requests = [];
const fetch = async (url, init = {}) => {
  url = String(url); requests.push({ url, method: init.method || 'GET', body: init.body });
  const file = url.startsWith(HOST) ? join(packs, decodeURIComponent(url.slice(HOST.length).split('?')[0])) : url.startsWith(ORT) ? join(ortDir, url.slice(ORT.length).split('?')[0]) : null;
  if (!file || !existsSync(file)) return new Response('', { status: 404 });
  return new Response(readFileSync(file), { status: 200 });
};
const caches = memoryCaches();
Object.assign(globalThis, { fetch, caches });
// the worker, in this process
class W {
  constructor(url) { this.ready = (async () => { globalThis.postMessage = (m) => queueMicrotask(() => this.onmessage?.({ data: m })); await import(String(url)); this.handle = globalThis.onmessage; })(); }
  postMessage(m) { this.ready.then(() => this.handle({ data: m })); }
  terminate() {}
}
const env = { caches, fetch, gpu: false, storage: null, navigator: {} };
let t0 = performance.now();
const got = await loader.downloadPack(pack, { ...env, bases: [HOST], userStarted: true, now: new Date('2026-11-11T12:00:00').getTime() });
console.log(`downloaded and checked: ${got.total} bytes (${(got.total / 1048576).toFixed(1)} MiB) in ${requests.length - 1} parts`);
t0 = performance.now();
const api = await speech.load({ loader, pack, ortBase: ORT, loaderUrl: new URL('../../loader/src/index.js', import.meta.url).href, bases: [HOST], WorkerCtor: W, env });
console.log(`loaded: ${api.kind} on ${api.device} in ${Math.round(performance.now() - t0)} ms`);
const pcm = wavToPcm(readFileSync(wav));
const before = requests.length;
const r = api.kind === 'whisper' ? await api.transcribe(pcm) : await api.score(pcm, arg('text', ''), { tradition: arg('tradition', 'israeli') });
console.log(`${(pcm.length / 16000).toFixed(1)} s of sound answered in ${r.ms} ms`);
if (api.kind === 'whisper') console.log('heard:', r.text, `(confidence ${r.confidence?.toFixed(2)})`);
else console.log(r.ok ? `checked ${r.checked} letters, ${r.right} right; to check again: ${r.letters.filter((l) => l.status === 'check').map((l) => `${l.ch}${l.heard ? ` (sounded like ${l.heard})` : ''}`).join(', ') || 'none'}` : `not scored: ${r.error}`);
console.log(`requests while listening: ${requests.length - before}; requests with a body in the whole run: ${requests.filter((q) => q.body !== undefined || q.method !== 'GET').length}`);
await speech.unload();
