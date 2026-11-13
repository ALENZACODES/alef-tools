// @ts-check
// The Words pack in a Web Worker: tokenizer + the joint model graph on onnxruntime-web. Nothing leaves the device and
// the worker fetches nothing except the runtime's own files from the site (`ort`, `wasmPaths`).
// It speaks the shared loader's worker protocol (packages/loader worker-host.js: every answer carries the request's
// id and `ok`), written out here so this file has no import outside its own package:
//   {id, type:'load', ort, wasmPaths, model:ArrayBuffer, vocab, tokenizer, labels}  -> {id, ok:true, provider:'wasm'}
//   {id, type:'analyse', text}                                                      -> {id, ok:true, words:[...]}
//   a failure                                                                       -> {id, ok:false, code, error}
// `words` are src/joint.js JointWord objects, each with `shownKey`: the key (src/text.js wordKey) of the word as the
// text showed it. The divine Name is replaced before the model sees the text and is never in the answer.
import { createTokenizer } from './tokenize.js';
import { prefixOptions, decode, SEG_WIDTH } from './joint.js';
import { forModel } from './text.js';

/** @type {any} */ let ort = null;
/** @type {any} */ let session = null;
/** @type {ReturnType<typeof createTokenizer>|null} */ let tokenizer = null;
/** @type {any} */ let labels = null;
const MAX_TOKENS = 192;

async function load(msg) {
  ort = await import(msg.ort);
  if (msg.wasmPaths) ort.env.wasm.wasmPaths = msg.wasmPaths;
  if (msg.wasm) ort.env.wasm.wasmBinary = msg.wasm;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = 'error';
  tokenizer = createTokenizer(msg.tokenizer, msg.vocab);
  labels = msg.labels;
  session = await ort.InferenceSession.create(msg.model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return { provider: 'wasm' };
}

async function analyse(msg) {
  if (!session || !tokenizer) { const e = new Error('the Words pack is not loaded'); /** @type {any} */ (e).code = 'not-loaded'; throw e; }
  const prepared = forModel(String(msg.text ?? ''));
  const enc = tokenizer.encode(prepared.model, { maxTokens: MAX_TOKENS });
  const n = enc.ids.length;
  const big = (arr) => BigInt64Array.from(arr, (v) => BigInt(v));
  const out = await session.run({
    input_ids: new ort.Tensor('int64', big(enc.ids), [1, n]),
    attention_mask: new ort.Tensor('int64', big(new Array(n).fill(1)), [1, n]),
    prefix_class_id_options: new ort.Tensor('int64', big(prefixOptions(enc.tokens, labels)), [1, n, SEG_WIDTH]),
  });
  const read = decode(enc, { lexTop: out.lex_top.data, seg: out.seg.data, morph: out.morph.data, ner: out.ner.data }, labels, tokenizer.pieces);
  const words = [];
  for (const w of read) {
    const shown = prepared.words.find((s) => w.start >= s.start && w.start < s.end);
    if (shown?.name) continue;
    words.push({ ...w, shownKey: shown ? shown.key : null });
  }
  return { words };
}

const handlers = { load, analyse };
/** @type {any} */ (globalThis).onmessage = async (event) => {
  const m = event.data || {};
  try {
    const fn = handlers[m.type];
    if (!fn) { const e = new Error(String(m.type)); /** @type {any} */ (e).code = 'unknown-message'; throw e; }
    /** @type {any} */ (globalThis).postMessage({ ...(await fn(m)), id: m.id, ok: true });
  } catch (e) {
    const any = /** @type {any} */ (e);
    /** @type {any} */ (globalThis).postMessage({ id: m.id, ok: false, code: any?.code || 'failed', error: String(any?.message || e) });
  }
};
