// @ts-check
// Translation packs: puts the graphs, the tokenizer and the decoding loop together. No DOM, no storage.
// The browser worker (worker.js) and the Node scoring tool (scripts/score.mjs) both call this with the same runtime
// and the same pack files, so the scores are scores of the shipped code.
import { createTokenizer } from './tokenizer.js';
import { createDecoder } from './decode.js';

/** Joins the parts of one pack file. @param {ArrayBuffer[]} parts */
export function joinParts(parts) {
  const total = parts.reduce((a, p) => a + p.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(new Uint8Array(p), at); at += p.byteLength; }
  return out;
}

/**
 * @param {{ort:any, pack:any, read:(path:string)=>Promise<ArrayBuffer>, device?:'wasm'|'webgpu'|'float', onStage?:(stage:string)=>void}} cfg
 *   pack: one entry of manifest.packs; read: returns the bytes of one part by its manifest path.
 *   device: 'wasm' (default) runs the 8-bit graphs on the processor. 'webgpu' runs the encoder and decoder on the graphics card:
 *   the small graphs of pack.gpu hold the wiring only and read their weights out of the 8-bit files, which are turned into
 *   floats as the graph loads (scripts/gpu_graph.py). 'float' runs those same graphs on the processor; it exists so the
 *   graphics-card graphs can be tested where there is no graphics card. The word table stays on the processor in every case.
 * @returns {Promise<{translate:(text:string, opts?:{beams?:number})=>Promise<string>, direction:string, device:string, release:()=>Promise<void>}>}
 */
export async function createRuntime(cfg) {
  const { ort, pack, read } = cfg;
  const device = cfg.device || 'wasm';
  const file = async (name, list = pack.files) => {
    const f = list.find((x) => x.name === name);
    if (!f) throw new Error(`pack file missing: ${name}`);
    const parts = [];
    for (const p of f.parts) parts.push(await read(p.path));
    return joinParts(parts);
  };
  const vocab = JSON.parse(new TextDecoder().decode(await file('vocab.json')));
  const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 };
  const session = async (name) => { cfg.onStage?.(name); return ort.InferenceSession.create(await file(name), opts); };
  const floatSession = async (stem, outputs) => {
    cfg.onStage?.(`${stem}.gpu.onnx`);
    const o = { executionProviders: [device === 'webgpu' ? 'webgpu' : 'wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3, externalData: [{ path: `${stem}.onnx`, data: await file(`${stem}.onnx`) }] };
    if (device === 'webgpu') o.preferredOutputLocation = outputs;
    return ort.InferenceSession.create(await file(`${stem}.gpu.onnx`, pack.gpu || []), o);
  };
  // one at a time: three graphs built at once would hold every byte twice at the same moment
  const table = await session('table.onnx');
  const plain = device === 'wasm';
  const encoder = plain ? await session('encoder.onnx') : await floatSession('encoder', { cross_k: 'gpu-buffer', cross_v: 'gpu-buffer' });
  const decoder = plain ? await session('decoder.onnx') : await floatSession('decoder', { hidden: 'cpu', new_k: 'gpu-buffer', new_v: 'gpu-buffer' });
  const tok = createTokenizer(vocab);
  const dec = createDecoder({ ort, table, encoder, decoder, vocab });
  /** One line at a time: the runtime cannot run two requests on one graph at once. */
  let chain = Promise.resolve('');
  const translate = (text, o = {}) => {
    const job = chain.then(async () => {
      const ids = tok.encode(text);
      if (ids.length <= 1) return '';
      return tok.decode(await dec.generate(ids, o));
    });
    chain = job.catch(() => '');
    return job;
  };
  const release = async () => { await chain; for (const s of [table, encoder, decoder]) { try { await s.release(); } catch { /* already gone */ } } };
  return { translate, direction: pack.direction, device, release };
}
