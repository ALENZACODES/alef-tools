// Character and word error rates for Hebrew transcripts. Used by eval.mjs and its test.
const POINTS = /[֑-ׇ]/g;

/** Letters, digits and single spaces only: points, punctuation and direction marks are dropped. */
export function normalizeText(s) {
  return String(s ?? '').normalize('NFC').replace(/[\u05BE\-–—]/g, ' ').replace(POINTS, '').replace(/[^א-תa-zA-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Edit distance between two sequences. */
export function editDistance(a, b) {
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/**
 * Pooled error rates over a set: total edits over total reference length (the usual way; a long line counts for more).
 * @param {{ref:string, hyp:string}[]} pairs
 */
export function errorRates(pairs) {
  let ce = 0, cn = 0, we = 0, wn = 0;
  for (const { ref, hyp } of pairs) {
    const r = normalizeText(ref), h = normalizeText(hyp);
    ce += editDistance([...r], [...h]); cn += [...r].length;
    const rw = r.split(' ').filter(Boolean), hw = h.split(' ').filter(Boolean);
    we += editDistance(rw, hw); wn += rw.length;
  }
  return { cer: cn ? ce / cn : 0, wer: wn ? we / wn : 0, chars: cn, words: wn, lines: pairs.length };
}
