// @ts-check
// Translation packs: the tokenizer. Pure functions: no DOM, no network, no storage.
// It splits a line into the word pieces the model was trained on (a unigram piece table with one score per piece: the split with the
// highest total score wins) and turns the model's piece ids back into text. The piece table is vocab.json of the pack.

const MARKS = /[֑-ֽֿ-ׇ]/g; // Hebrew vowel points and cantillation (the maqaf U+05BE is handled as a dash)
const SPACE = '▁';

/**
 * A line as the tokenizer wants it: vowel points dropped, typographic quotes and dashes made plain, spaces collapsed.
 * @param {string} s
 */
export function normalizeLine(s) {
  return String(s || '').normalize('NFKC').replace(MARKS, '')
    .replace(/[‘’‚′׳`´]/g, "'").replace(/[“”„″״«»]/g, '"')
    .replace(/[–—−־]/g, '-').replace(/…/g, '...')
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '').replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * @param {{pieces:string[], scores:(number|null)[], eos:number, pad:number, unk:number}} vocab
 */
export function createTokenizer(vocab) {
  /** @type {Map<string, number>} */
  const idOf = new Map();
  let longest = 1, low = 0;
  vocab.scores.forEach((sc, id) => {
    if (sc === null || sc === undefined) return;
    const p = vocab.pieces[id];
    idOf.set(p, id);
    const n = [...p].length; if (n > longest) longest = n;
    if (sc < low) low = sc;
  });
  const unkScore = low - 10;

  /** @param {string} line @returns {number[]} piece ids, ending with the end-of-line id */
  function encode(line) {
    const text = normalizeLine(line);
    if (!text) return [vocab.eos];
    const chars = [...(SPACE + text.replace(/ /g, SPACE))];
    const n = chars.length;
    const best = new Float64Array(n + 1).fill(-Infinity); best[0] = 0;
    const from = new Int32Array(n + 1).fill(-1);
    const idAt = new Int32Array(n + 1).fill(vocab.unk);
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      let piece = '', known = false;
      for (let j = i + 1; j <= n && j - i <= longest; j++) {
        piece += chars[j - 1];
        const id = idOf.get(piece);
        if (id === undefined) continue;
        if (j === i + 1) known = true;
        const sc = best[i] + /** @type {number} */ (vocab.scores[id]);
        if (sc > best[j]) { best[j] = sc; from[j] = i; idAt[j] = id; }
      }
      if (!known) { const sc = best[i] + unkScore; if (sc > best[i + 1]) { best[i + 1] = sc; from[i + 1] = i; idAt[i + 1] = vocab.unk; } }
    }
    const ids = [];
    for (let j = n; j > 0; j = from[j]) ids.push(idAt[j]);
    ids.reverse();
    // a run of unknown characters is one unknown piece
    const out = [];
    for (const id of ids) if (!(id === vocab.unk && out[out.length - 1] === vocab.unk)) out.push(id);
    out.push(vocab.eos);
    return out;
  }

  /** @param {number[]} ids @returns {string} */
  function decode(ids) {
    let s = '';
    for (const id of ids) { if (id === vocab.eos || id === vocab.pad || id === vocab.unk) continue; s += vocab.pieces[id] ?? ''; }
    return s.split(SPACE).join(' ').replace(/\s+/g, ' ').trim();
  }

  return { encode, decode };
}
