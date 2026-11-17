// @ts-check
// The DictaBERT WordPiece tokenizer, in plain JavaScript. Pure: no DOM, no network.
// It follows the model's own tokenizer.json step for step (tests/tokenize.test.js checks ids and offsets against the
// reference tokenizer on recorded sentences):
//   1. normalise: NFD, lowercase, drop combining marks (this removes vowel points), "<foreign>" and any run of
//      characters outside the allowed ranges become [UNK]
//   2. split with the tokenizer's pattern (every match is a word; the rest is dropped)
//   3. WordPiece: longest piece first, "##" on continuing pieces, a word with an unknown piece becomes [UNK]
// Offsets are UTF-16 positions in the ORIGINAL string, so a caller can map a token back to what the learner tapped.

const MARK_RE = /\p{M}/u;

/**
 * @param {{split:string, normalizer:any[], unk:string, maxWordChars:number, ids:Record<string,number>}} config  tokenizer.json from the pack
 * @param {string} vocabText  vocab.txt from the pack (one piece per line, line number = id)
 */
export function createTokenizer(config, vocabText) {
  const pieces = vocabText.split('\n');
  if (pieces[pieces.length - 1] === '') pieces.pop();
  /** @type {Map<string, number>} */
  const vocab = new Map();
  for (let i = 0; i < pieces.length; i++) vocab.set(pieces[i], i);
  const split = new RegExp(config.split, 'gu');
  const foreign = config.normalizer.find((n) => n && typeof n === 'object' && 'replace' in n);
  const outside = config.normalizer.find((n) => n && typeof n === 'object' && 'replaceRegex' in n);
  const outsideRe = new RegExp(outside.replaceRegex, 'gu');
  const { ids } = config;
  const UNK = config.unk;

  /** Normalised text plus, for every normalised UTF-16 unit, the [start, end) it came from in the original. */
  function normalise(text) {
    let norm = '';
    /** @type {number[]} */ const from = [];
    /** @type {number[]} */ const to = [];
    let at = 0;
    for (const cp of text) {
      const end = at + cp.length;
      for (const ch of cp.normalize('NFD').toLowerCase()) {
        if (MARK_RE.test(ch)) continue;
        norm += ch;
        for (let k = 0; k < ch.length; k++) { from.push(at); to.push(end); }
      }
      at = end;
    }
    // the two replacements, keeping the map: the whole replaced run points at the whole original run
    const swap = (re, withText) => {
      let out = ''; const f = []; const t = []; let last = 0;
      for (const m of norm.matchAll(re)) {
        const s = m.index ?? 0, e = s + m[0].length;
        out += norm.slice(last, s); for (let k = last; k < s; k++) { f.push(from[k]); t.push(to[k]); }
        out += withText; for (let k = 0; k < withText.length; k++) { f.push(from[s]); t.push(to[e - 1]); }
        last = e;
      }
      out += norm.slice(last); for (let k = last; k < norm.length; k++) { f.push(from[k]); t.push(to[k]); }
      norm = out; from.length = 0; to.length = 0; from.push(...f); to.push(...t);
    };
    if (foreign && norm.includes(foreign.replace)) swap(new RegExp(foreign.replace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), foreign.with);
    outsideRe.lastIndex = 0;
    if (outsideRe.test(norm)) { outsideRe.lastIndex = 0; swap(outsideRe, outside.with); }
    return { norm, from, to };
  }

  /** One word -> its pieces as [piece, startInWord, endInWord], or null when it has to be [UNK]. */
  function wordPieces(word) {
    const chars = [...word];
    if (chars.length > config.maxWordChars) return null;
    const out = [];
    let start = 0, unit = 0;
    while (start < chars.length) {
      let end = chars.length, found = null;
      while (end > start) {
        const piece = (start > 0 ? '##' : '') + chars.slice(start, end).join('');
        if (vocab.has(piece)) { found = piece; break; }
        end--;
      }
      if (found === null) return null;
      const len = chars.slice(start, end).join('').length;
      out.push([found, unit, unit + len]);
      unit += len; start = end;
    }
    return out;
  }

  /**
   * @param {string} text
   * @param {{maxTokens?:number}} [opts]
   * @returns {{ids:number[], tokens:string[], offsets:[number,number][], truncated:boolean}} with [CLS] first and [SEP] last
   */
  function encode(text, opts = {}) {
    const max = opts.maxTokens ?? 512;
    const { norm, from, to } = normalise(String(text ?? ''));
    const outIds = [ids['[CLS]']]; const tokens = ['[CLS]']; /** @type {[number,number][]} */ const offsets = [[0, 0]];
    let truncated = false;
    split.lastIndex = 0;
    outer: for (const m of norm.matchAll(split)) {
      const word = m[0]; const base = m.index ?? 0;
      if (!word) continue;
      const parts = word === UNK ? [[UNK, 0, word.length]] : (wordPieces(word) ?? [[UNK, 0, word.length]]);
      for (const [piece, s, e] of parts) {
        if (outIds.length >= max - 1) { truncated = true; break outer; }
        outIds.push(/** @type {number} */ (vocab.get(/** @type {string} */ (piece)) ?? ids['[UNK]']));
        tokens.push(/** @type {string} */ (piece));
        offsets.push([from[base + /** @type {number} */ (s)], to[base + /** @type {number} */ (e) - 1]]);
      }
    }
    outIds.push(ids['[SEP]']); tokens.push('[SEP]'); offsets.push([0, 0]);
    return { ids: outIds, tokens, offsets, truncated };
  }

  return { encode, vocab, pieces, size: pieces.length };
}
