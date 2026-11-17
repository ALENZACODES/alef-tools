// @ts-check
// Tidy up what the Hebrew reader (tesseract `heb`) returns for a photo, using a word list. No DOM, no network.
//
// The reader's usual mistakes on signs are swaps between letters that look alike (ב/כ, ד/ר, ה/ח, ו/ז/י/ן, ס/ם ...), a narrow
// letter dropped or added, and a stray mark glued to a word. A word that is not in the list, and has exactly one close
// neighbour in the list by those mistakes, is replaced by that neighbour. Everything else is left exactly as read:
// a word the list does not hold may simply be a word the list does not hold.
//
// Two optional helpers can be passed in (both come from the "words" language pack when it is on the device):
//   rank(left, candidates, right) -> scores   picks between neighbours that are equally close, from the words around them;
//   isName(tokens, i) -> boolean              marks names (people, places); a name is never "corrected".

/** Letters the reader mixes up, in groups. A swap inside a group is a cheap edit. */
export const LOOK_ALIKE = Object.freeze(['בכ', 'דרך', 'החת', 'וזין', 'סםט', 'גנ', 'עצ', 'מט', 'כפ', 'ךן', 'ףק']);
const NARROW = 'יון';
const HEB = /[א-ת]/;
const MARKS = /[֑-ׇ]/g;
const PREFIXES = 'הובלמשכ';
export const NAME_SKELETON = 'יהוה';
export const NAME_SHOWN = 'ה׳';
const NAME_PREFIX = 'ובלמכשה';

const pair = new Set();
for (const g of LOOK_ALIKE) for (const a of g) for (const b of g) if (a !== b) pair.add(a + b);
export const looksAlike = (a, b) => pair.has(a + b);

export const COST = Object.freeze({ lookAlike: 0.4, narrow: 0.6, other: 1 });
const COMMON = 300;   // list positions that count as "very common" for the tie-break
const SPLIT_COMMON = 1500;

/** Weighted edit distance: look-alike swap 0.4, narrow letter added or dropped 0.6, anything else 1. Stops early past `limit`. */
export function distance(a, b, limit = Infinity) {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) * COST.narrow > limit) return Infinity;
  let prev = new Float64Array(m + 1), cur = new Float64Array(m + 1);
  for (let j = 1; j <= m; j++) prev[j] = prev[j - 1] + (NARROW.includes(b[j - 1]) ? COST.narrow : COST.other);
  for (let i = 1; i <= n; i++) {
    const ca = a[i - 1]; const del = NARROW.includes(ca) ? COST.narrow : COST.other;
    cur[0] = prev[0] + del; let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const cb = b[j - 1];
      const sub = ca === cb ? 0 : looksAlike(ca, cb) ? COST.lookAlike : COST.other;
      const ins = NARROW.includes(cb) ? COST.narrow : COST.other;
      const v = Math.min(prev[j - 1] + sub, prev[j] + del, cur[j - 1] + ins);
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return Infinity;
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}

const plain = (s) => String(s ?? '').normalize('NFKD').replace(MARKS, '');
/** Hebrew letters of a token, marks removed. */
export const lettersOf = (s) => [...plain(s)].filter((c) => HEB.test(c)).join('');

/** How far a word of this length may be moved. Short words are barely touched: too many real words sit one letter apart. */
export function budget(len) { return len <= 1 ? 0 : len === 2 ? 0.4 : len === 3 ? 0.8 : len === 4 ? 1.0 : 1.4; }

/**
 * @param {{words: string[]|string, phrases?: string[]}|string[]} lexicon unpointed words, most common first (order is the tie-break); a newline-joined string is accepted
 * @param {{margin?: number, keepConf?: number, lowConf?: number}} [o] margin: how much closer the best neighbour must be than the next one.
 *   The reader's own confidence (0-100) decides how far a word may be moved, because a word missing from the list is far more
 *   often a real word the list does not hold than a misreading:
 *     keepConf and above, or no confidence given: the word is left exactly as read;
 *     between lowConf and keepConf: one look-alike swap, or a missed space;
 *     below lowConf: the full allowance for its length (see budget()).
 */
export function createCorrector(lexicon, { margin = 0.3, keepConf = 88, lowConf = 70 } = {}) {
  const raw = Array.isArray(lexicon) ? lexicon : lexicon.words;
  const list = (typeof raw === 'string' ? raw.split('\n') : raw).map(lettersOf).filter(Boolean);
  const rankOf = new Map();
  list.forEach((w, i) => { if (!rankOf.has(w)) rankOf.set(w, i); });
  const byLen = new Map();
  for (const w of rankOf.keys()) { const L = [...w].length; if (!byLen.has(L)) byLen.set(L, []); byLen.get(L).push(w); }

  const has = (w) => rankOf.has(w);
  /** In the list as it is, or as a listed word with one or two prefix letters (the, and, in, to, from, that, like). */
  function known(w) {
    if (has(w)) return true;
    if (w.length >= 3 && PREFIXES.includes(w[0]) && has(w.slice(1))) return true;
    if (w.length >= 4 && PREFIXES.includes(w[0]) && PREFIXES.includes(w[1]) && has(w.slice(2))) return true;
    return false;
  }
  /** Listed words within `limit` of `w`, closest first; ties go to the more common word. */
  function neighbours(w, limit = budget(w.length)) {
    const out = [];
    if (limit <= 0) return out;
    for (let L = Math.max(1, w.length - 2); L <= w.length + 2; L++) for (const c of byLen.get(L) || []) {
      const d = distance(w, c, limit);
      if (d <= limit) out.push({ word: c, cost: d });
    }
    return out.sort((a, b) => a.cost - b.cost || rankOf.get(a.word) - rankOf.get(b.word));
  }

  /**
   * One token as read -> the token to show. Punctuation around the word is kept; numbers, Latin and names are not touched.
   * @param {string} tok @param {{conf?: number}} [o]
   * @returns {{text: string, changed: boolean, from?: string, cost?: number, tied?: {word:string,cost:number}[], split?: boolean, byUse?: boolean}}
   */
  function correctToken(tok, { conf } = {}) {
    const same = { text: tok, changed: false };
    const m = /^([^א-ת]*)([א-ת֑-ׇ"'׳״]*[א-ת֑-ׇ])([^א-ת]*)$/.exec(String(tok));
    if (!m) return same;
    const core = m[2];
    if (/[֑-ׇ]/.test(core)) return same;                 // pointed text is matched against the prayer texts elsewhere, not here
    if (/["'׳״]/.test(core)) return same;                          // abbreviations and numerals written with letters
    const w = lettersOf(core);
    if (w.length < 2 || known(w) || nearName(w)) return same;       // a word that may be the Name, even misread, is never turned into another word
    if (conf == null || !(conf < keepConf)) return same;            // the reader was sure, or did not say: left as read
    let limit = budget(w.length);
    const sure = conf >= lowConf;                                   // fairly sure: one look-alike swap at most
    if (sure) limit = Math.min(limit, COST.lookAlike);
    let near = neighbours(w, limit);
    if (sure) near = near.filter((c) => c.word.length === w.length);
    if (!near.length) {
      // two listed words run together (a space the reader missed): split, when there is exactly one way to do it
      if (w.length >= 4) {
        const cuts = [];
        const common = (x) => has(x) && rankOf.get(x) < SPLIT_COMMON;           // both halves must be everyday words, or a long word the list lacks gets cut in two
        for (let i = 2; i <= w.length - 2; i++) if (common(w.slice(0, i)) && common(w.slice(i))) cuts.push(i);
        if (cuts.length === 1) return { text: m[1] + w.slice(0, cuts[0]) + ' ' + w.slice(cuts[0]) + m[3], changed: true, from: tok, cost: COST.narrow, split: true };
      }
      return same;
    }
    const tied = near.filter((c) => c.cost - near[0].cost < margin);
    if (tied.length > 1) {
      // equally close: a very common word wins over rare ones (the list is ordered by how often the app's own texts use each word)
      const byUse = [...tied].sort((a, b) => rankOf.get(a.word) - rankOf.get(b.word));
      const r0 = rankOf.get(byUse[0].word), r1 = rankOf.get(byUse[1].word);
      if (byUse[0].cost === near[0].cost && r0 < COMMON && r1 >= 1000 && r1 >= 10 * (r0 + 1)) return { text: m[1] + byUse[0].word + m[3], changed: true, from: tok, cost: byUse[0].cost, tied, byUse: true };
      return { ...same, tied };
    }
    return { text: m[1] + near[0].word + m[3], changed: true, from: tok, cost: near[0].cost };
  }

  /**
   * A line as read -> the line to show.
   * @param {string} text
   * @param {{confs?: (number|undefined)[], rank?: (left: string, candidates: string[], right: string) => number[]|Promise<number[]>, isName?: (tokens: string[], i: number) => boolean|Promise<boolean>}} [o]
   * @returns {Promise<{text: string, changes: {index:number, from:string, to:string, cost:number, by:'list'|'context'|'common'|'split'}[]}>}
   */
  async function correctLine(text, { confs, rank, isName } = {}) {
    const toks = String(text ?? '').split(/(\s+)/);
    const words = toks.filter((_, i) => i % 2 === 0);
    const changes = [];
    if (/[\u05B0-\u05BD\u05BF-\u05C7]/.test(String(text ?? ''))) return { text: String(text ?? ''), changes };   // a line with vowel points is prayer or Torah text: matched against the stored texts elsewhere, never edited here
    for (let wi = 0; wi < words.length; wi++) {
      if (!HEB.test(words[wi])) continue;
      if (isName && await isName(words, wi)) continue;
      const r = correctToken(words[wi], { conf: confs ? confs[wi] : undefined });
      if (r.changed && !(r.byUse && rank)) { changes.push({ index: wi, from: words[wi], to: r.text, cost: /** @type {number} */ (r.cost), by: r.split ? 'split' : r.byUse ? 'common' : 'list' }); words[wi] = r.text; continue; }
      if (r.tied && rank) {
        let scores; try { scores = await rank(words.slice(0, wi).join(' '), r.tied.map((c) => c.word), words.slice(wi + 1).join(' ')); } catch { scores = null; }
        if (scores && scores.length === r.tied.length) {
          const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
          if (order.length > 1 && order[0][0] > order[1][0]) {
            const pick = r.tied[order[0][1]];
            const m = /^([^א-ת]*)(.*?)([^א-ת]*)$/.exec(words[wi]);
            const to = (m ? m[1] : '') + pick.word + (m ? m[3] : '');
            changes.push({ index: wi, from: words[wi], to, cost: pick.cost, by: 'context' }); words[wi] = to; continue;
          }
        }
        if (r.changed) { changes.push({ index: wi, from: words[wi], to: r.text, cost: /** @type {number} */ (r.cost), by: 'common' }); words[wi] = r.text; }
      }
    }
    let k = 0;
    return { text: toks.map((t, i) => (i % 2 === 0 ? words[k++] : t)).join(''), changes };
  }

  /**
   * Word boxes from the reader -> the same boxes with `text` tidied; the original reading is kept in `raw`.
   * @template {{text: string, conf?: number}} B
   * @param {B[]} boxes @param {Parameters<typeof correctLine>[1]} [o]
   * @returns {Promise<(B & {raw?: string})[]>}
   */
  async function correctBoxes(boxes, o = {}) {
    const out = [];
    const heb = (boxes || []).filter((b) => HEB.test(String(b.text ?? '')));
    const pointed = heb.filter((b) => /[\u05B0-\u05BD\u05BF-\u05C7]/.test(String(b.text)));
    if (heb.length && pointed.length / heb.length >= 0.2) return [...boxes];        // pointed text (a prayer book page): left exactly as read
    for (const b of boxes || []) {
      const parts = String(b.text ?? '').split(/\s+/).filter(Boolean);
      const r = await correctLine(b.text, { ...o, confs: parts.map(() => b.conf) });
      out.push(r.changes.length ? { ...b, text: r.text, raw: b.text } : b);
    }
    return out;
  }

  return { size: rankOf.size, has, known, neighbours, correctToken, correctLine, correctBoxes };
}

/** The Name itself, or a reading within two look-alike swaps of it (with or without prefix letters). */
function nearName(w) {
  if (isNameSkeleton(w)) return true;
  for (let cut = 0; cut <= Math.min(3, w.length - 3); cut++) {
    if (cut && ![...w.slice(0, cut)].every((c) => NAME_PREFIX.includes(c))) break;
    if (distance(w.slice(cut), NAME_SKELETON, 2 * COST.lookAlike) <= 2 * COST.lookAlike) return true;
  }
  return false;
}
const isNameSkeleton = (w) => w === NAME_SKELETON || (w.length > 4 && w.length <= 7 && w.endsWith(NAME_SKELETON) && [...w.slice(0, -4)].every((c) => NAME_PREFIX.includes(c)));

/**
 * Hebrew text for the screen: the four-letter Name is written ה׳, with or without vowel points, alone or after prefix
 * letters (the prefix letters stay). Nothing else is changed.
 * @param {string} text @returns {string}
 */
export function showName(text) {
  return String(text ?? '').replace(/[א-ת֑-ֽֿ-ׇ]+/g, (run) => {
    const w = [...run].filter((c) => HEB.test(c)).join('');
    if (!isNameSkeleton(w)) return run;
    return w.slice(0, -4) + NAME_SHOWN;
  });
}

/** True when the text holds the four-letter Name (so a caller can keep it away from anything spoken). */
export function hasName(text) {
  let found = false;
  String(text ?? '').replace(/[א-ת֑-ֽֿ-ׇ]+/g, (run) => { if (isNameSkeleton([...run].filter((c) => HEB.test(c)).join(''))) found = true; return run; });
  return found;
}

/**
 * Adapter for the "words" language pack (lane 4). `words.scoreCandidates(left, candidates, right)` must return one number
 * per candidate, higher = fits the sentence better. Returns undefined when the pack is not loaded, so callers can pass
 * the result straight to correctLine({ rank }).
 */
export function rankWith(words) {
  if (!words || typeof words.scoreCandidates !== 'function') return undefined;
  return (left, candidates, right) => words.scoreCandidates(left, candidates, right);
}

/**
 * Adapter for name tags (dictabert-ner through the words pack). `words.nameTags(tokens)` must return, per token, a tag
 * string ('' or 'O' for none). Returns undefined when not available.
 */
export function namesWith(words) {
  if (!words || typeof words.nameTags !== 'function') return undefined;
  let last = null; let tags = null;
  return async (tokens, i) => {
    const key = tokens.join(' ');
    if (key !== last) { last = key; try { tags = await words.nameTags(tokens); } catch { tags = null; } }
    const t = tags && tags[i];
    return !!t && t !== 'O';
  };
}
