// The sound never leaves the device. Two checks:
//  1. the source of this package has no way to send anything (no request with a body, no socket, no beacon, no form), and it
//     never opens the microphone or the browser's own recognizer;
//  2. a full run of the real worker code (load a pack, recognise a take, check its letters) makes no request for the take:
//     the only requests are plain GETs for the pack list, the pack parts and the runtime file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { BASE, mod, loaderUrl, sha, memoryCaches, tableFetch } from './helpers.js';
const speech = await mod('index.js');
const loader = await import(loaderUrl);

const sources = readdirSync(BASE).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(new URL(f, BASE), 'utf8')]);
const code = (text) => text.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''); // comments may talk about these things

test('source: nothing in this package can send data or open the microphone', () => {
  assert.equal(sources.length, 9);
  const banned = [/XMLHttpRequest/, /sendBeacon/, /WebSocket/, /RTCPeerConnection/, /EventSource/, /FormData/, /\bmethod\s*:/, /\bbody\s*:/, /\.upload\b/, /navigator\.share/, /https?:\/\/(?!alenzacodes\.github\.io\/alef-packs\/)/];
  for (const [name, text] of sources) for (const re of banned) assert.equal(re.test(code(text)), false, `${name} matches ${re}`);
  // fetch appears in one file only, with nothing but an address: the worker's GET of the runtime's WebAssembly
  const users = sources.filter(([, text]) => /\bfetch\(/.test(code(text))).map(([n]) => n);
  assert.deepEqual(users, ['asr-worker.js']);
  assert.deepEqual(code(sources.find(([n]) => n === 'asr-worker.js')[1]).match(/\bfetch\([^)]*\)/g), ['fetch(base + name)']);
  for (const [name, text] of sources) assert.equal(/getUserMedia|MediaRecorder|SpeechRecognition/.test(code(text)), false, `${name} touches the microphone or the browser recognizer`);
});

// ---- a full run through the real worker ----------------------------------------------------------------------------
const HOST = 'https://packs.example/';
const ORT = new URL('./fixtures/', import.meta.url).href; // tests/fixtures/ort.wasm.min.mjs stands in for the runtime the app carries
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const letters = { 'ש': 0, 'ל': 1, 'ו': 2, 'ם': 3, 'ר': 4, 'מ': 5, '|': 6, '[PAD]': 7 };

function world() {
  const config = { num_mel_bins: 80, decoder_layers: 2, decoder_attention_heads: 2, d_model: 8 };
  const raw = {
    'listen-lite': {
      'spec.json': enc({ kind: 'whisper', config, generation: {} }), 'encoder.onnx': enc({ fake: 'encoder' }), 'decoder.onnx': enc({ fake: 'decoder', script: [1, 2] }),
      'tokens.json': enc({ vocab: { 'Ġ': 0, '×©': 1, '×ľ': 2, 'a': 3, '.': 4 }, added: { '<|endoftext|>': 5, '<|startoftranscript|>': 6, '<|he|>': 7, '<|en|>': 8, '<|transcribe|>': 9, '<|notimestamps|>': 10 } }),
    },
    'pron-check': { 'spec.json': enc({ kind: 'ctc', margin: 0 }), 'model.onnx': enc({ fake: 'ctc', V: 8, blank: 7, script: [0, 4, 2, 3] }), 'vocab.json': enc(letters) }, // "sharom": resh for lamed
    'listen-best': { 'spec.json': enc({ kind: 'whisper', config, generation: {} }) },
  };
  const table = { [`${ORT}ort-wasm-simd-threaded.wasm`]: Uint8Array.of(0, 97, 115, 109) };
  for (const [pack, files] of Object.entries(raw)) {
    const list = { schema: 'alef.pack.v1', pack, version: '1', files: Object.entries(files).map(([name, bytes]) => { table[`${HOST}${pack}/${name}.p000?v=${sha(bytes).slice(0, 16)}`] = bytes; return { name, bytes: bytes.length, sha256: sha(bytes), parts: [{ path: `${name}.p000`, bytes: bytes.length, sha256: sha(bytes) }] }; }) };
    table[`${HOST}${pack}/pack.json`] = JSON.stringify(list);
  }
  return table;
}

/** Runs the real asr-worker.js in this process behind the Worker interface the loader's host expects. */
let workers = 0;
function workerCtor(posted) {
  return class {
    constructor(url) {
      this.ready = (async () => {
        // the worker file talks to its global scope; give each worker its own copy of the module and catch what it posts
        globalThis.postMessage = (m) => queueMicrotask(() => this.onmessage?.({ data: m }));
        await import(`${url}?worker=${++workers}`);
        this.handle = globalThis.onmessage;
      })();
    }
    postMessage(m, transfer = []) { posted.push({ m, transfer }); this.ready.then(() => { globalThis.postMessage = (out) => queueMicrotask(() => this.onmessage?.({ data: out })); this.handle({ data: m }); }); }
    terminate() {}
  };
}
const take = () => Float32Array.from({ length: 16000 }, (_, i) => 0.2 * Math.sin(i / 7) * (0.6 + 0.4 * Math.sin(i / 900)));

test('a full run: load, recognise, check letters; the take goes to the worker and nowhere else', async () => {
  const caches = memoryCaches(), fetch = tableFetch(world()), posted = [];
  const real = { fetch: globalThis.fetch, caches: globalThis.caches };
  Object.assign(globalThis, { fetch, caches });
  const env = { caches, fetch, gpu: false, storage: null, navigator: {} };
  const opts = { loader, ortBase: ORT, loaderUrl, bases: [HOST], WorkerCtor: workerCtor(posted), env };
  try {
    // not on the device yet: load refuses, and fetches nothing but the pack list
    await assert.rejects(speech.load({ ...opts, pack: 'listen-lite' }), (e) => e.code === 'not-downloaded');
    assert.ok(fetch.calls.every((c) => c.url.endsWith('pack.json')));
    // the app downloads on the learner's tap, with the shared loader
    for (const pack of ['listen-lite', 'pron-check']) await loader.downloadPack(pack, { ...env, bases: [HOST], userStarted: true });
    const lite = await speech.load({ ...opts, pack: 'listen-lite' });
    const pron = await speech.load({ ...opts, pack: 'pron-check' });
    assert.deepEqual([lite.kind, lite.device, pron.kind, pron.device], ['whisper', 'wasm', 'ctc', 'wasm']);
    assert.equal(await speech.load({ ...opts, pack: 'listen-lite' }), lite, 'a second load gives the same instance');
    const before = fetch.calls.length;

    const pcm = take();
    const heard = await lite.transcribe(pcm);
    assert.deepEqual([heard.ok, heard.text], [true, 'של']);
    const english = await lite.transcribe(pcm, { language: 'en' });
    assert.equal(english.ok, true);
    const check = await pron.score(pcm, 'שָׁלוֹם', { tradition: 'israeli' });
    assert.deepEqual(check.letters.map((l) => `${l.ch}:${l.status}`), ['ש:ok', 'ל:check', 'ו:skip', 'ם:ok']);
    assert.equal(check.letters[1].heard, 'ר');
    const silent = await pron.score(new Float32Array(16000), 'שָׁלוֹם');
    assert.deepEqual([silent.ok, silent.error], [false, 'no-speech']);
    await assert.rejects(lite.score(pcm, 'שָׁלוֹם'), (e) => e.code === 'wrong-pack');

    assert.equal(fetch.calls.length, before, 'recognition and the letter check made no request at all');
    // every request of the whole run was a plain GET for a pack file or the runtime
    for (const c of fetch.calls) { assert.equal(c.init?.body, undefined, c.url); assert.ok(!c.init?.method || c.init.method === 'GET'); assert.ok(c.url.startsWith(HOST) || c.url.startsWith(ORT), c.url); }
    // each take went to the worker as a handed-over copy; the caller's own samples are untouched
    const sent = posted.filter((p) => p.m.pcm);
    assert.equal(sent.length, 5); assert.ok(sent.every((p) => p.transfer.length === 1 && p.m.pcm !== pcm));
    assert.equal(pcm.length, 16000); assert.ok(pcm[100] !== 0);

    await lite.release();
    await assert.rejects(lite.transcribe(pcm));
    await speech.unload(); await speech.unload();
  } finally { Object.assign(globalThis, real); delete globalThis.postMessage; delete globalThis.onmessage; }
});

test('the pack for a graphics card does not load on a device without one; an unknown pack is refused', async () => {
  const fetch = tableFetch(world());
  const opts = { loader, ortBase: ORT, loaderUrl, bases: [HOST], WorkerCtor: class {}, env: { caches: memoryCaches(), fetch, gpu: false, storage: null, navigator: {} } };
  await assert.rejects(speech.load({ ...opts, pack: 'listen-best' }), (e) => e.code === 'cannot-run');
  assert.equal(fetch.calls.length, 0);
  await assert.rejects(speech.load({ ...opts, pack: 'nope' }), (e) => e.code === 'bad-pack-name');
  await assert.rejects(speech.load({ ...opts, loader: {} }), TypeError);
});

test('the package has the shape the app expects', () => {
  const pkg = loader.definePackage(speech);
  assert.equal(pkg.id, 'speech');
  assert.deepEqual([...pkg.packs], ['listen-lite', 'listen-best', 'pron-check']);
  assert.equal(pkg.version, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  assert.ok(speech.packBases().at(-1).startsWith('https://alenzacodes.github.io/alef-packs/'));
});
