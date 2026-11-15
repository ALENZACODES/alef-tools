import { createTokenizer } from './tokenizer.js';
import { createDecoder } from './decode.js';
export function joinParts(parts) {
 const total = parts.reduce((a, p) => a + p.byteLength, 0);
 const out = new Uint8Array(total);
 let at = 0;
 for (const p of parts) { out.set(new Uint8Array(p), at); at += p.byteLength; }
 return out;
}
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
 const table = await session('table.onnx');
 const plain = device === 'wasm';
 const encoder = plain ? await session('encoder.onnx') : await floatSession('encoder', { cross_k: 'gpu-buffer', cross_v: 'gpu-buffer' });
 const decoder = plain ? await session('decoder.onnx') : await floatSession('decoder', { hidden: 'cpu', new_k: 'gpu-buffer', new_v: 'gpu-buffer' });
 const tok = createTokenizer(vocab);
 const dec = createDecoder({ ort, table, encoder, decoder, vocab });
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
