// @ts-check
// Scoring helpers for translation test files. Pure functions: no DOM, no network, no storage.
//   house score  1 for an exact match after normalizing, otherwise 1 minus the word error rate against the reference.
//   chrF         character n-gram F-score (orders 1 to 6, beta 2, spaces dropped), the same arithmetic as sacreBLEU's chrF2.

const MARKS = /[֑-ֽֿ-ׇ]/g;
/** Lower case, no vowel points, punctuation to spaces. @param {string} s */
export function normalizeForCompare(s) {
  return String(s || '').replace(MARKS, '').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** @param {string[]} a @param {string[]} b */
export function levenshtein(a, b) {
  const n = a.length, m = b.length;
  const row = new Array(m + 1);
  for (let j = 0; j <= m; j++) row[j] = j;
  for (let i = 1; i <= n; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= m; j++) {
      const keep = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = keep;
    }
  }
  return row[m];
}

/** @param {string} reference @param {string} hypothesis */
export function wordErrorRate(reference, hypothesis) {
  const ref = normalizeForCompare(reference).split(' ').filter(Boolean);
  const hyp = normalizeForCompare(hypothesis).split(' ').filter(Boolean);
  if (!ref.length) return hyp.length ? 1 : 0;
  return levenshtein(ref, hyp) / ref.length;
}

/** @param {string} hyp @param {string} reference */
export function matchScore(hyp, reference) {
  if (normalizeForCompare(hyp) === normalizeForCompare(reference)) return 1;
  return Math.max(0, 1 - wordErrorRate(reference, hyp));
}

const OPEN = /** @type {[RegExp, string][]} */ ([[/\bcan't\b/g, 'can not'], [/\bcannot\b/g, 'can not'], [/\bwon't\b/g, 'will not'], [/\blet's\b/g, 'let us'], [/n't\b/g, ' not'], [/\bi'm\b/g, 'i am'],
  [/'re\b/g, ' are'], [/'ve\b/g, ' have'], [/'ll\b/g, ' will'], [/'d\b/g, ' would'], [/'s\b/g, ' is']]);
/** English with contractions opened ("where's" and "where is" compare equal). @param {string} s */
export function openContractions(s) {
  let t = String(s || '').toLowerCase().replace(/[’‘`]/g, "'");
  for (const [re, to] of OPEN) t = t.replace(re, to);
  return t;
}

/** The house score against the first-choice reference. @param {string} hyp @param {{reference:string}} sample */
export const strictScore = (hyp, sample) => matchScore(hyp, sample.reference);
/** The best house score over the reference and the other accepted wordings, English contractions opened. @param {string} hyp @param {{reference:string, accept?:string[], direction?:string}} sample */
export function acceptedScore(hyp, sample) {
  const fix = (x) => (sample.direction === 'he-en' ? openContractions(x) : x);
  return Math.max(...[sample.reference, ...(sample.accept || [])].map((r) => matchScore(fix(hyp), fix(r))));
}

/** @param {string} s @param {number} n @returns {Map<string, number>} */
function grams(s, n) {
  const chars = [...String(s || '').replace(/\s+/g, '')];
  const out = new Map();
  for (let i = 0; i + n <= chars.length; i++) { const g = chars.slice(i, i + n).join(''); out.set(g, (out.get(g) || 0) + 1); }
  return out;
}

/**
 * chrF2 of a whole file (counts are summed over the lines first). Vowel points are dropped from both sides.
 * @param {{hyp:string, ref:string}[]} pairs @returns {number} 0 to 100
 */
export function chrF(pairs, order = 6, beta = 2) {
  const stat = Array.from({ length: order }, () => [0, 0, 0]);
  for (const { hyp, ref } of pairs) {
    const h = String(hyp || '').replace(MARKS, ''), r = String(ref || '').replace(MARKS, '');
    for (let n = 1; n <= order; n++) {
      const hg = grams(h, n), rg = grams(r, n);
      let match = 0, nh = 0, nr = 0;
      for (const c of hg.values()) nh += c;
      for (const [g, c] of rg) { nr += c; match += Math.min(c, hg.get(g) || 0); }
      stat[n - 1][0] += nh; stat[n - 1][1] += nr; stat[n - 1][2] += match;
    }
  }
  let p = 0, r = 0, eff = 0;
  for (const [nh, nr, m] of stat) if (nh > 0 && nr > 0) { p += m / nh; r += m / nr; eff++; }
  if (!eff) return 0;
  p /= eff; r /= eff;
  const f = beta * beta;
  return p + r ? (100 * (1 + f) * p * r) / (f * p + r) : 0;
}

/** @param {{direction:string, method?:string, ok?:boolean, strict:number, accepted:number, translation:string, reference:string}[]} rows */
export function summarize(rows) {
  const mean = (xs) => (xs.length ? Number(((100 * xs.reduce((a, b) => a + b, 0)) / xs.length).toFixed(1)) : null);
  const of = (sel) => { const r = rows.filter(sel); return { lines: r.length, strict: mean(r.map((x) => x.strict)), accepted: mean(r.map((x) => x.accepted)), chrF: r.length ? Number(chrF(r.map((x) => ({ hyp: x.translation, ref: x.reference }))).toFixed(1)) : null, exact: r.filter((x) => x.accepted === 1).length, refused: r.filter((x) => x.ok === false).length }; };
  const by = {}; for (const r of rows) by[r.method || 'model'] = (by[r.method || 'model'] || 0) + 1;
  return { all: of(() => true), 'en-he': of((x) => x.direction === 'en-he'), 'he-en': of((x) => x.direction === 'he-en'), byMethod: by };
}
