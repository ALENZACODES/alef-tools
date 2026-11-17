import { logMel, N_FRAMES } from './mel.js';
import { createTokens } from './tokens.js';
import { trimSilence, splitLong } from './audio.js';
export const MAX_NEW_TOKENS = 224;
const softmaxLog = (row, pick) => {
 let max = -Infinity;
 for (let i = 0; i < row.length; i++) if (row[i] > max) max = row[i];
 let sum = 0;
 for (let i = 0; i < row.length; i++) sum += Math.exp(row[i] - max);
 return row[pick] - max - Math.log(sum);
};
function toHalf(f32) {
 const out = new Uint16Array(f32.length), fv = new Float32Array(1), iv = new Uint32Array(fv.buffer);
 for (let i = 0; i < f32.length; i++) {
  fv[0] = f32[i]; const x = iv[0];
  const sign = (x >>> 16) & 0x8000; let exp = ((x >>> 23) & 0xff) - 112; let man = x & 0x7fffff;
  if (exp <= 0) { if (exp < -10) { out[i] = sign; continue; } man = (man | 0x800000) >> (1 - exp); out[i] = sign | ((man + 0x1000) >> 13); continue; }
  if (exp >= 31) { out[i] = sign | 0x7c00; continue; }
  out[i] = (sign | (exp << 10) | ((man + 0x1000) >> 13)) & 0xffff;
 }
 return out;
}
function fromHalf(u16) {
 const out = new Float32Array(u16.length);
 for (let i = 0; i < u16.length; i++) {
  const h = u16[i], s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  out[i] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
 }
 return out;
}
export async function createWhisper(cfg) {
 const { ort } = cfg;
 const tok = createTokens(cfg.vocab, cfg.added || {});
 const nMels = cfg.config.num_mel_bins || 80;
 const layers = cfg.config.decoder_layers, heads = cfg.config.decoder_attention_heads, headDim = cfg.config.d_model / heads;
 const opts = cfg.sessionOptions || { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 };
 const make = async (m) => (m && typeof m.run === 'function' ? m : ort.InferenceSession.create(m, opts));
 const encoder = await make(cfg.encoder);
 const decoder = await make(cfg.decoder);
 const half = !!cfg.half;
 const floatTensor = (data, dims) => (half ? new ort.Tensor('float16', toHalf(data), dims) : new ort.Tensor('float32', data, dims));
 const floats = (t) => (t.type === 'float16' ? fromHalf(/** @type {Uint16Array} */ (t.data)) : t.data);
 const promptFor = (language) => [tok.special('<|startoftranscript|>'), tok.special(`<|${language}|>`), tok.special('<|transcribe|>'), tok.special('<|notimestamps|>')];
 const defaultLanguage = cfg.language || 'he';
 const suppress = new Set((cfg.generation?.suppress_tokens || []).filter((t) => t < tok.eot));
 const beginSuppress = new Set(cfg.generation?.begin_suppress_tokens || [220, tok.eot]);
 const hebrew = tok.hebrewOnly();
 const merged = decoder.inputNames.includes('use_cache_branch');
 const pastNames = decoder.inputNames.filter((n) => n.startsWith('past_key_values.'));
 const emptyPast = () => {
    /** @type {Record<string, any>} */ const feeds = {};
  for (const n of pastNames) feeds[n] = floatTensor(new Float32Array(0), [1, heads, 0, headDim]);
  return feeds;
 };
 if (pastNames.length && pastNames.length !== layers * 4) throw new Error('decoder shape does not match its config');
 async function piece(pcm, o) {
  const prompt = promptFor(o.language);
  const mel = logMel(pcm, nMels);
  const enc = await encoder.run({ input_features: floatTensor(mel, [1, nMels, N_FRAMES]) });
  const hidden = enc.last_hidden_state || enc[encoder.outputNames[0]];
  const ids = [];
  let logp = 0;
    /** @type {Record<string, any>} */ let past = merged ? emptyPast() : {};
    /** @type {Record<string, any>} */ let cross = {};
  let input = prompt;
  const limit = Math.min(o.maxTokens || MAX_NEW_TOKENS, MAX_NEW_TOKENS);
  for (let step = 0; step < limit; step++) {
   const feeds = { input_ids: new ort.Tensor('int64', BigInt64Array.from(input.map(BigInt)), [1, input.length]), encoder_hidden_states: hidden, ...past, ...cross };
   if (merged) feeds.use_cache_branch = new ort.Tensor('bool', [step > 0], [1]);
   const res = await decoder.run(feeds);
   const lg = res.logits, V = lg.dims[2], seq = lg.dims[1];
   const all = floats(lg);
   const row = all.subarray((seq - 1) * V, seq * V);
   let best = -1, top = -Infinity;
   for (let i = 0; i <= tok.eot; i++) {
    if (i < tok.eot) { if (suppress.has(i)) continue; if (o.hebrewOnly && !hebrew[i]) continue; }
    if (step === 0 && beginSuppress.has(i)) continue;
    if (row[i] > top) { top = row[i]; best = i; }
   }
   if (best < 0 || best === tok.eot) break;
   logp += softmaxLog(row.subarray(0, tok.eot + 1), best);
   ids.push(best);
   if (ids.length >= 24 && ids.slice(-12).join() === ids.slice(-24, -12).join()) { ids.length -= 12; break; }
   const next = {};
   for (const name of decoder.outputNames) {
    if (!name.startsWith('present.')) continue;
    const key = name.replace('present.', 'past_key_values.');
    if (name.includes('.encoder.')) { if (step === 0) cross[key] = res[name]; else res[name].dispose?.(); }
    else next[key] = res[name];
   }
   if (step > 0) for (const t of Object.values(past)) t.dispose?.();
   past = next;
   input = merged ? [best] : [...prompt, ...ids];
   lg.dispose?.();
  }
  for (const t of [...Object.values(past), ...Object.values(cross)]) t.dispose?.();
  hidden.dispose?.();
  return { text: tok.decode(ids), tokens: ids.length, logp };
 }
 let chain = Promise.resolve(/** @type {any} */ (null));
 const transcribe = (pcm, o = {}) => {
  const job = chain.then(async () => {
   const language = o.language || defaultLanguage;
   const opt = { language, hebrewOnly: language === 'he' && o.hebrewOnly !== false, maxTokens: o.maxTokens };
   const cut = o.trim === false ? { speech: pcm.length > 0, pcm, speechMs: Math.round(pcm.length / 16) } : trimSilence(pcm);
   if (!cut.speech) return { ok: false, text: '', confidence: 0, speechMs: 0, error: 'no-speech' };
   const texts = []; let tokens = 0, logp = 0;
   for (const part of splitLong(cut.pcm)) { const r = await piece(part, opt); if (r.text) texts.push(r.text); tokens += r.tokens; logp += r.logp; }
   const text = texts.join(' ').replace(/\s+/g, ' ').trim();
   return text ? { ok: true, text, confidence: tokens ? Math.exp(logp / tokens) : 0, speechMs: cut.speechMs } : { ok: false, text: '', confidence: 0, speechMs: cut.speechMs, error: 'no-speech' };
  });
  chain = job.catch(() => null);
  return job;
 };
 const release = async () => { await chain; for (const s of [encoder, decoder]) { try { await s.release?.(); } catch { /* already gone */ } } };
 return { transcribe, release, nMels };
}
