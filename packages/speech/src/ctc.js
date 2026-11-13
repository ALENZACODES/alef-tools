// @ts-check
// The letter-by-letter listening model (wav2vec2 with a CTC head), on the device. No DOM, no storage, no network.
// It answers, for every 20 ms of sound, how likely each Hebrew letter is. src/score.js turns that into feedback.
import { logSoftmaxRows, greedyIds } from './ctc-align.js';

/**
 * @param {{ort:any, model:any, vocab:Record<string,number>, sessionOptions?:any}} cfg model: bytes, or a session already made (tests)
 */
export async function createCtc(cfg) {
  const { ort, vocab } = cfg;
  const opts = cfg.sessionOptions || { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 };
  const session = cfg.model && typeof cfg.model.run === 'function' ? cfg.model : await ort.InferenceSession.create(cfg.model, opts);
  const blankId = vocab['[PAD]'] ?? vocab['<pad>'];
  if (typeof blankId !== 'number') throw new Error('letter table has no blank');
  /** @type {string[]} */ const letters = [];
  for (const [ch, id] of Object.entries(vocab)) letters[id] = ch;
  let chain = Promise.resolve(/** @type {any} */ (null));
  /**
   * @param {Float32Array} pcm 16 kHz mono
   * @returns {Promise<{logp:Float32Array, T:number, V:number}>} log probabilities, T frames of V symbols
   */
  const posteriors = (pcm) => {
    const job = chain.then(async () => {
      // the model was trained on takes scaled to zero mean and unit variance
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
  /** The plain reading of a take (letters as the model wrote them; `|` between words becomes a space). */
  const read = (p) => greedyIds(p.logp, p.T, p.V, blankId).map((id) => (letters[id] === '|' ? ' ' : letters[id] || '')).join('').replace(/\s+/g, ' ').trim();
  const release = async () => { await chain; try { await session.release?.(); } catch { /* already gone */ } };
  return { posteriors, read, release, blankId, letters, vocab };
}

/** The shortest take the model can read (its first layers need about 25 ms; a real letter needs far more). */
export const MIN_SAMPLES = 4000;
