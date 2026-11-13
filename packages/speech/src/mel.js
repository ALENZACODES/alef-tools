// @ts-check
// The picture of the sound that the listening models read: a log-mel spectrogram, computed the way Whisper was trained with
// (25 ms Hann window, 10 ms step, 80 or 128 mel bands on the Slaney scale, 30 seconds). No DOM, no network.
// tests/mel.test.js checks it against values written by the reference feature extractor.

export const N_FFT = 400;
export const HOP = 160;
export const CHUNK_SAMPLES = 480000; // 30 s at 16 kHz
export const N_FRAMES = 3000;
const BINS = N_FFT / 2 + 1;

const hzToMel = (f) => (f < 1000 ? (3 * f) / 200 : 15 + (Math.log(f / 1000) * 27) / Math.log(6.4));
const melToHz = (m) => (m < 15 ? (200 * m) / 3 : 1000 * Math.exp((Math.log(6.4) * (m - 15)) / 27));

/** Triangular mel filters (Slaney scale, area-normalised), `nMels` rows of 201. @param {number} nMels @returns {Float32Array[]} */
export function melFilters(nMels, rate = 16000) {
  const lo = hzToMel(0), hi = hzToMel(rate / 2);
  const pts = Array.from({ length: nMels + 2 }, (_, i) => melToHz(lo + ((hi - lo) * i) / (nMels + 1)));
  const out = [];
  for (let m = 0; m < nMels; m++) {
    const row = new Float32Array(BINS);
    const a = pts[m], b = pts[m + 1], c = pts[m + 2], norm = 2 / (c - a);
    for (let k = 0; k < BINS; k++) {
      const f = (k * rate) / N_FFT;
      const w = Math.min((f - a) / (b - a), (c - f) / (c - b));
      if (w > 0) row[k] = w * norm;
    }
    out.push(row);
  }
  return out;
}

let tables = null;
function dftTables() {
  if (tables) return tables;
  const win = new Float32Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);
  // cos and sin of 2*pi*j/400 for j = 0..399; bin k at sample n uses index (k*n) mod 400
  const cos = new Float32Array(N_FFT), sin = new Float32Array(N_FFT);
  for (let j = 0; j < N_FFT; j++) { cos[j] = Math.cos((2 * Math.PI * j) / N_FFT); sin[j] = Math.sin((2 * Math.PI * j) / N_FFT); }
  return (tables = { win, cos, sin });
}

const filterCache = new Map();

/**
 * @param {Float32Array} pcm 16 kHz mono, at most 30 s (longer input is cut; shorter is treated as followed by silence)
 * @param {number} [nMels] 80 (base, small) or 128 (large-v3 family)
 * @returns {Float32Array} nMels x 3000 values, row after row
 */
export function logMel(pcm, nMels = 80) {
  const { win, cos, sin } = dftTables();
  let filters = filterCache.get(nMels);
  if (!filters) { filters = melFilters(nMels); filterCache.set(nMels, filters); }
  // each filter touches a short run of bins: remember where
  const span = filters.map((row) => { let a = 0, b = BINS - 1; while (a < BINS && row[a] === 0) a++; while (b > a && row[b] === 0) b--; return [a, b]; });
  const n = Math.min(pcm.length, CHUNK_SAMPLES);
  const half = N_FFT / 2;
  // the sample at position i of the 30 s window after reflect padding at both ends (the window itself is zero after the take)
  const at = (i) => { if (i < 0) i = -i; else if (i >= CHUNK_SAMPLES) i = 2 * (CHUNK_SAMPLES - 1) - i; return i < n ? pcm[i] : 0; };
  const out = new Float32Array(nMels * N_FRAMES);
  const lastFrame = Math.min(N_FRAMES - 1, Math.ceil((n + half) / HOP)); // frames past the take hold only silence
  const frame = new Float32Array(N_FFT), power = new Float32Array(BINS);
  const FLOOR = -10; // log10 of the smallest power counted
  let peak = FLOOR;
  for (let t = 0; t <= lastFrame; t++) {
    const start = t * HOP - half;
    let any = false;
    for (let i = 0; i < N_FFT; i++) { const v = at(start + i) * win[i]; frame[i] = v; if (v !== 0) any = true; }
    if (!any) { for (let m = 0; m < nMels; m++) out[m * N_FRAMES + t] = FLOOR; continue; }
    for (let k = 0; k < BINS; k++) {
      let re = 0, im = 0, j = 0;
      for (let i = 0; i < N_FFT; i++) { re += frame[i] * cos[j]; im -= frame[i] * sin[j]; j += k; if (j >= N_FFT) j -= N_FFT; }
      power[k] = re * re + im * im;
    }
    for (let m = 0; m < nMels; m++) {
      const row = filters[m]; let s = 0;
      for (let k = span[m][0]; k <= span[m][1]; k++) s += row[k] * power[k];
      const v = Math.log10(Math.max(s, 1e-10));
      out[m * N_FRAMES + t] = v; if (v > peak) peak = v;
    }
  }
  if (lastFrame < N_FRAMES - 1) for (let m = 0; m < nMels; m++) out.fill(FLOOR, m * N_FRAMES + lastFrame + 1, (m + 1) * N_FRAMES);
  const low = peak - 8;
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i], low) + 4) / 4;
  return out;
}
