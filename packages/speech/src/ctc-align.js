// @ts-check
// Lining up what was said with the letters that were expected. No DOM, no network, no model: plain arithmetic on the
// letter probabilities a CTC model gives for each 20 ms of sound.
//
// A target is a list of positions; each position accepts a SET of the model's letters (so two letters that sound the same
// can both count). Between positions the model may write its "nothing here" symbol (blank).

const NEG = -1e30;
const lse = (a, b) => (a < b ? b + Math.log1p(Math.exp(a - b)) : a + Math.log1p(Math.exp(b - a)));

/** Log-softmax of each row. @param {Float32Array} logits T*V @returns {Float32Array} */
export function logSoftmaxRows(logits, T, V) {
  const out = new Float32Array(T * V);
  for (let t = 0; t < T; t++) {
    const o = t * V;
    let max = -Infinity;
    for (let v = 0; v < V; v++) if (logits[o + v] > max) max = logits[o + v];
    let sum = 0;
    for (let v = 0; v < V; v++) sum += Math.exp(logits[o + v] - max);
    const z = max + Math.log(sum);
    for (let v = 0; v < V; v++) out[o + v] = logits[o + v] - z;
  }
  return out;
}

/**
 * Per frame, the log probability of each target position (the letters it accepts, added up).
 * @param {Float32Array} logp T*V @param {number[][]} sets ids accepted at each position
 * @returns {Float32Array} T*L
 */
export function emissions(logp, T, V, sets) {
  const L = sets.length;
  const out = new Float32Array(T * L);
  for (let t = 0; t < T; t++) for (let i = 0; i < L; i++) {
    let s = NEG;
    for (const id of sets[i]) s = lse(s, logp[t * V + id]);
    out[t * L + i] = s;
  }
  return out;
}

const overlap = (a, b) => a.some((x) => b.includes(x));

/**
 * Which positions may follow each other without a blank in between: only those that share no letter
 * (the model writes a doubled letter as letter, blank, letter).
 * @param {number[][]} sets @returns {Uint8Array} skip[i] = 1 when position i may directly follow position i-1
 */
export function skipTable(sets) {
  const skip = new Uint8Array(sets.length);
  for (let i = 1; i < sets.length; i++) skip[i] = overlap(sets[i], sets[i - 1]) ? 0 : 1;
  return skip;
}

/**
 * Total log probability of the target (every way of spreading it over the frames).
 * `em` may leave positions out by passing `drop` (the position is removed) or replace one position's column with `swap`.
 * @param {Float32Array} em T*L from emissions() @param {Float32Array} blank per-frame log probability of blank
 * @param {number} T @param {number} L @param {Uint8Array} skip @param {number[][]} sets
 * @param {{drop?:number, swap?:{at:number, col:Float32Array}}} [alt]
 */
export function ctcLogLik(em, blank, T, L, skip, sets, alt = {}) {
  // positions in play
  const pos = [];
  for (let i = 0; i < L; i++) if (i !== alt.drop) pos.push(i);
  const n = pos.length, S = 2 * n + 1;
  if (!n) { let s = 0; for (let t = 0; t < T; t++) s += blank[t]; return s; }
  if (T < n) return NEG;
  const e = (t, k) => (alt.swap && pos[k] === alt.swap.at ? alt.swap.col[t] : em[t * L + pos[k]]);
  // may position k follow k-1 directly? A swapped-in column stands for "some other letter", which is taken to differ from its neighbours.
  const can = (k) => {
    if (alt.swap && (pos[k] === alt.swap.at || pos[k - 1] === alt.swap.at)) return true;
    return pos[k] - pos[k - 1] === 1 ? skip[pos[k]] === 1 : !overlap(sets[pos[k]], sets[pos[k - 1]]);
  };
  let a = new Float64Array(S).fill(NEG), b = new Float64Array(S);
  a[0] = blank[0]; a[1] = e(0, 0);
  for (let t = 1; t < T; t++) {
    const lo = Math.max(0, S - 2 * (T - t)), hi = Math.min(S - 1, 2 * t + 1);
    b.fill(NEG);
    for (let s = lo; s <= hi; s++) {
      let v = a[s];
      if (s > 0) v = lse(v, a[s - 1]);
      if (s & 1) { const k = s >> 1; if (k > 0 && can(k)) v = lse(v, a[s - 2]); b[s] = v + e(t, k); }
      else b[s] = v + blank[t];
    }
    const tmp = a; a = b; b = tmp;
  }
  return lse(a[S - 1], a[S - 2]);
}

/**
 * The single best way of spreading the target over the frames.
 * @returns {{logLik:number, spans:{start:number, end:number}[]}} for each position, its first and last frame (inclusive)
 */
export function align(em, blank, T, L, skip) {
  const S = 2 * L + 1;
  if (!L || T < L) return { logLik: NEG, spans: [] };
  const back = new Int8Array(T * S);
  let a = new Float64Array(S).fill(NEG), b = new Float64Array(S);
  a[0] = blank[0]; a[1] = em[0];
  for (let t = 1; t < T; t++) {
    b.fill(NEG);
    for (let s = 0; s < S; s++) {
      let v = a[s], from = 0;
      if (s > 0 && a[s - 1] > v) { v = a[s - 1]; from = 1; }
      if ((s & 1) && s > 1 && skip[s >> 1] && a[s - 2] > v) { v = a[s - 2]; from = 2; }
      if (v <= NEG / 2) continue;
      b[s] = v + ((s & 1) ? em[t * L + (s >> 1)] : blank[t]);
      back[t * S + s] = from;
    }
    const tmp = a; a = b; b = tmp;
  }
  let s = a[S - 1] >= a[S - 2] ? S - 1 : S - 2;
  const logLik = a[s];
  const spans = Array.from({ length: L }, () => ({ start: -1, end: -1 }));
  for (let t = T - 1; t >= 0; t--) {
    if (s & 1) { const k = s >> 1; if (spans[k].end < 0) spans[k].end = t; spans[k].start = t; }
    s -= back[t * S + s];
  }
  return { logLik, spans };
}

/**
 * The plain reading of the frames: the likeliest symbol of each frame, repeats merged, blanks removed.
 * @returns {number[]} ids
 */
export function greedyIds(logp, T, V, blankId) {
  const out = [];
  let prev = -1;
  for (let t = 0; t < T; t++) {
    let best = 0, top = -Infinity;
    for (let v = 0; v < V; v++) if (logp[t * V + v] > top) { top = logp[t * V + v]; best = v; }
    if (best !== prev && best !== blankId) out.push(best);
    prev = best;
  }
  return out;
}
