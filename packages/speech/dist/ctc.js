import { logSoftmaxRows, greedyIds } from './ctc-align.js';
export async function createCtc(cfg) {
 const { ort, vocab } = cfg;
 const opts = cfg.sessionOptions || { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 };
 const session = cfg.model && typeof cfg.model.run === 'function' ? cfg.model : await ort.InferenceSession.create(cfg.model, opts);
 const blankId = vocab['[PAD]'] ?? vocab['<pad>'];
 if (typeof blankId !== 'number') throw new Error('letter table has no blank');
  /** @type {string[]} */ const letters = [];
 for (const [ch, id] of Object.entries(vocab)) letters[id] = ch;
 let chain = Promise.resolve(/** @type {any} */ (null));
 const posteriors = (pcm) => {
  const job = chain.then(async () => {
   let mean = 0; for (let i = 0; i < pcm.length; i++) mean += pcm[i]; mean /= pcm.length || 1;
   let v = 0; for (let i = 0; i < pcm.length; i++) { const d = pcm[i] - mean; v += d * d; }
   const sd = Math.sqrt(v / (pcm.length || 1) + 1e-7);
   const x = new Float32Array(pcm.length);
   for (let i = 0; i < pcm.length; i++) x[i] = (pcm[i] - mean) / sd;
   const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', x, [1, x.length]) });
   const lg = res.logits || res[session.outputNames[0]];
   const T = lg.dims[1], V = lg.dims[2];
   const logp = logSoftmaxRows(/** @type {Float32Array} */ (lg.data), T, V);
   lg.dispose?.();
   return { logp, T, V };
  });
  chain = job.catch(() => null);
  return job;
 };
 const read = (p) => greedyIds(p.logp, p.T, p.V, blankId).map((id) => (letters[id] === '|' ? ' ' : letters[id] || '')).join('').replace(/\s+/g, ' ').trim();
 const release = async () => { await chain; try { await session.release?.(); } catch { /* already gone */ } };
 return { posteriors, read, release, blankId, letters, vocab };
}
export const MIN_SAMPLES = 4000;
