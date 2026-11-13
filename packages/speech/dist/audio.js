export const SAMPLE_RATE = 16000;
export function toMono(channels) {
 if (!channels.length) return new Float32Array(0);
 if (channels.length === 1) return channels[0];
 const n = channels[0].length;
 const out = new Float32Array(n);
 for (const c of channels) for (let i = 0; i < n; i++) out[i] += c[i];
 const k = 1 / channels.length;
 for (let i = 0; i < n; i++) out[i] *= k;
 return out;
}
const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
export function resample(pcm, from, to = SAMPLE_RATE, taps = 12) {
 if (!(from > 0) || !(to > 0)) throw new Error('bad sample rate');
 if (from === to || !pcm.length) return pcm;
 const ratio = from / to;
 const cut = Math.min(1, to / from); // filter cutoff as a share of the input half-rate
 const half = taps / cut;
 const n = Math.max(1, Math.round(pcm.length / ratio));
 const out = new Float32Array(n);
 for (let i = 0; i < n; i++) {
  const at = i * ratio;
  const lo = Math.max(0, Math.ceil(at - half)), hi = Math.min(pcm.length - 1, Math.floor(at + half));
  let sum = 0, norm = 0;
  for (let j = lo; j <= hi; j++) {
   const d = j - at;
   const w = cut * sinc(d * cut) * (0.5 + 0.5 * Math.cos((Math.PI * d) / half));
   sum += pcm[j] * w; norm += w;
  }
  out[i] = norm ? sum / norm : 0;
 }
 return out;
}
export function frameLevels(pcm, frame) {
 const n = Math.floor(pcm.length / frame);
 const out = new Float32Array(n);
 for (let f = 0; f < n; f++) {
  let s = 0;
  for (let i = f * frame, e = i + frame; i < e; i++) s += pcm[i] * pcm[i];
  out[f] = Math.sqrt(s / frame);
 }
 return out;
}
export function trimSilence(pcm, o = {}) {
 const rate = o.rate || SAMPLE_RATE;
 const frame = Math.round(((o.frameMs || 20) * rate) / 1000);
 const lv = frameLevels(pcm, frame);
 const none = { speech: false, start: 0, end: 0, pcm: new Float32Array(0), speechMs: 0 };
 if (!lv.length) return none;
 const sorted = Float32Array.from(lv).sort();
 const quiet = sorted[Math.floor(sorted.length * 0.1)], loud = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.97))];
 const floor = o.floor ?? 0.0004;
 if (loud < floor) return none;
 if (loud < quiet * 4) {
  let mean = 0; for (const v of lv) mean += v; mean /= lv.length;
  let dev = 0; for (const v of lv) dev += (v - mean) * (v - mean);
  if (Math.sqrt(dev / lv.length) / mean < 0.08) return none;
  return { speech: true, start: 0, end: pcm.length, pcm, speechMs: Math.round((pcm.length * 1000) / rate) };
 }
 const gate = Math.max(floor, quiet * (o.ratio ?? 3), loud * 0.08);
 const need = Math.max(1, Math.round((o.minSpeechMs ?? 80) / (o.frameMs || 20)));
 let first = -1, last = -1, run = 0, voiced = 0;
 for (let f = 0; f < lv.length; f++) {
  if (lv[f] >= gate) { run++; voiced++; if (run >= need) { if (first < 0) first = f - run + 1; last = f; } } else run = 0;
 }
 if (first < 0) return none;
 const pad = Math.round(((o.padMs ?? 200) * rate) / 1000);
 const start = Math.max(0, first * frame - pad), end = Math.min(pcm.length, (last + 1) * frame + pad);
 return { speech: true, start, end, pcm: pcm.subarray(start, end), speechMs: Math.round((voiced * frame * 1000) / rate) };
}
export function splitLong(pcm, maxSec = 28, rate = SAMPLE_RATE) {
 const max = Math.round(maxSec * rate);
 const out = [];
 let at = 0;
 const frame = Math.round(rate * 0.02);
 while (pcm.length - at > max) {
  const from = at + Math.round(max * 0.67), to = at + max;
  let best = to, low = Infinity;
  for (let i = from; i + frame <= to; i += frame) {
   let s = 0;
   for (let j = i; j < i + frame; j++) s += pcm[j] * pcm[j];
   if (s < low) { low = s; best = i + (frame >> 1); }
  }
  out.push(pcm.subarray(at, best));
  at = best;
 }
 if (pcm.length - at > 0) out.push(pcm.subarray(at));
 return out;
}
export function parseWav(file) {
 const u8 = file instanceof Uint8Array ? file : new Uint8Array(file);
 const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
 const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
 if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
 let fmt = null, at = 12;
 while (at + 8 <= u8.length) {
  const id = tag(at), size = dv.getUint32(at + 4, true), body = at + 8;
  if (id === 'fmt ') fmt = { format: dv.getUint16(body, true), ch: dv.getUint16(body + 2, true), rate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
  else if (id === 'data') {
   if (!fmt) throw new Error('WAV data before format');
   const float = fmt.format === 3 || (fmt.format === 0xfffe && fmt.bits === 32);
   if (!(float && fmt.bits === 32) && !(fmt.bits === 16)) throw new Error(`unsupported WAV sample format (${fmt.bits} bit)`);
   const step = fmt.bits / 8, n = Math.floor(Math.min(size, u8.length - body) / (step * fmt.ch));
   const channels = Array.from({ length: fmt.ch }, () => new Float32Array(n));
   for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++) {
    const o = body + (i * fmt.ch + c) * step;
    channels[c][i] = float ? dv.getFloat32(o, true) : dv.getInt16(o, true) / 32768;
   }
   return { rate: fmt.rate, channels };
  }
  at = body + size + (size & 1);
 }
 throw new Error('WAV has no data');
}
export function wavToPcm(file) {
 const w = parseWav(file);
 return resample(toMono(w.channels), w.rate, SAMPLE_RATE);
}
export async function decodeTake(take, env = {}) {
 const g = /** @type {any} */ (globalThis);
 const Ctx = env.AudioContext || g.OfflineAudioContext || g.webkitOfflineAudioContext || g.AudioContext || g.webkitAudioContext;
 if (!Ctx) throw new Error('no-audio-decoder');
 const bytes = take instanceof ArrayBuffer ? take : await /** @type {Blob} */ (take).arrayBuffer();
 const offline = /Offline/.test(Ctx.name || '');
 const ctx = offline ? new Ctx(1, 1, 44100) : new Ctx();
 try {
  const buf = await ctx.decodeAudioData(bytes.slice(0));
  const channels = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
  return resample(toMono(channels), buf.sampleRate, SAMPLE_RATE);
 } finally { try { await ctx.close?.(); } catch { /* an offline context has nothing to close */ } }
}
