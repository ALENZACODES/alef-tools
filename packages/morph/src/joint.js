// @ts-check
// Input building and output reading for the DictaBERT joint model's browser graph (scripts/export_joint.py).
// Pure: no DOM, no network, no runtime import. The caller runs the graph (src/worker.js in the browser,
// onnxruntime-node in tests) and hands the four output tensors to decode().
// The steps mirror the model's own Python code (dicta-il/dictabert-joint: BertForJointParsing.py,
// BertForPrefixMarking.py, BertForMorphTagging.py) so both give the same answer; tests/joint.test.js checks that
// against recorded outputs.

const SPECIAL = new Set(['[PAD]', '[CLS]', '[SEP]']);
/** Layout of the `morph` tensor (65 numbers per token). */
export const MORPH_WIDTH = 65;
export const SEG_WIDTH = 8;

/** @param {{prefixClasses:string[][]}} labels */
function prefixTables(labels) {
  /** @type {Map<string, number>} */ const classOf = new Map();
  labels.prefixClasses.forEach((list, i) => list.forEach((p) => classOf.set(p, i)));
  const all = [...classOf.keys()].sort((a, b) => b.length - a.length);
  return { classOf, all, total: labels.prefixClasses.length };
}

/** The prefixes a word could start with, longest first at each step (the model code's get_prefixes_from_str). */
function* prefixesOf(word, t, greedy = false) {
  let s = word;
  while (s.length > 0 && t.classOf.has(s[0])) {
    const next = t.all.find((p) => s.startsWith(p));
    if (!next) return;
    yield next;
    if (!greedy && next.length > 1) yield next[0];
    s = s.slice(next.length);
  }
}

/** Whole word starting at token i (its "##" pieces joined). */
function wordAt(tokens, i) {
  let w = tokens[i];
  for (let j = i + 1; j < tokens.length && tokens[j].startsWith('##'); j++) w += tokens[j].slice(2);
  return w;
}

/**
 * The third model input: for every token, which prefix classes its word could carry.
 * @param {string[]} tokens  from tokenize.js encode()
 * @param {{prefixClasses:string[][]}} labels
 * @returns {number[]} tokens.length * 8 numbers (class id where possible, 8 where not)
 */
export function prefixOptions(tokens, labels) {
  const t = prefixTables(labels);
  const out = new Array(tokens.length * t.total).fill(t.total);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.length < 2 || !t.classOf.has(tok[0])) continue;
    for (const p of prefixesOf(wordAt(tokens, i), t)) { const c = /** @type {number} */ (t.classOf.get(p)); out[i * t.total + c] = c; }
  }
  return out;
}

/** How many leading letters of `word` the model marked as prefixes (get_predicted_prefix_len_from_logits). */
function prefixLength(word, yes, t) {
  let len = 0, skipNext = false, lastCheck = false; const seen = new Set();
  for (const p of prefixesOf(word, t)) {
    if (skipNext) { skipNext = false; continue; }
    if (seen.has(p)) break;
    seen.add(p);
    if (yes[/** @type {number} */ (t.classOf.get(p))]) { len += p.length; if (lastCheck) break; skipNext = p.length > 1; } else if (p.length > 1) lastCheck = true; else break;
  }
  return len;
}

/** The lemma: the first of the model's three candidates that shares enough letters with the word (pick_lex_by_letters). */
function pickLemma(word, candidates) {
  const weak = 'אהוי';
  const letters = new Set([...word].filter((c) => !weak.includes(c)));
  for (const lex of candidates) {
    let shared = 0; for (const c of lex) if (letters.has(c)) shared++;
    const strong = [...lex].filter((c) => !weak.includes(c)).length;
    if (shared >= Math.min(2, letters.size, strong)) return lex;
  }
  return null;
}

const argmax = (arr, from, n) => { let best = 0; for (let k = 1; k < n; k++) if (arr[from + k] > arr[from + best]) best = k; return best; };

/**
 * @typedef {{token:string, start:number, end:number, lemma:string|null, prefix:string, base:string,
 *   pos:string, feats:Record<string,string>, prefixPos:string[], suffix:string|null, suffixFeats:Record<string,string>|null, ner:string}} JointWord
 */

/**
 * @param {{tokens:string[], offsets:[number,number][]}} enc  from tokenize.js encode()
 * @param {{lexTop:ArrayLike<number|bigint>, seg:ArrayLike<number>, morph:ArrayLike<number>, ner:ArrayLike<number>}} out  one sentence's rows
 * @param {any} labels  labels.json from the pack
 * @param {string[]} pieces  the vocabulary (id -> piece)
 * @returns {JointWord[]}
 */
export function decode(enc, out, labels, pieces) {
  const t = prefixTables(labels);
  const nerN = labels.ner.length;
  const featN = labels.features.map((f) => f[1].length);
  const P = labels.prefixPos.length, POS = labels.pos.length, SUF = labels.suffix.length;
  const featsAt = (base) => { /** @type {Record<string,string>} */ const o = {}; let at = base; labels.features.forEach(([name, values], k) => { const v = values[argmax(out.morph, at, featN[k])]; if (v !== 'none') o[name] = v; at += featN[k]; }); return o; };
  const featSpan = featN.reduce((a, b) => a + b, 0);
  /** @type {JointWord[]} */ const words = [];
  for (let i = 0; i < enc.tokens.length; i++) {
    const tok = enc.tokens[i];
    if (SPECIAL.has(tok)) continue;
    if (tok.startsWith('##')) { const w = words[words.length - 1]; if (w) { w.token += tok.slice(2); w.end = enc.offsets[i][1]; } continue; }
    const word = wordAt(enc.tokens, i);
    const yes = []; for (let c = 0; c < t.total; c++) yes.push(out.seg[i * SEG_WIDTH + c] > 0);
    const plen = prefixLength(word, yes, t);
    const m = i * MORPH_WIDTH;
    const prefixPos = []; for (let k = 0; k < P; k++) if (out.morph[m + k] > 0.5) prefixPos.push(labels.prefixPos[k]);
    const suffix = labels.suffix[argmax(out.morph, m + P + POS + featSpan, SUF)];
    const candidates = [0, 1, 2].map((k) => pieces[Number(out.lexTop[i * 3 + k])]);
    words.push({
      token: tok, start: enc.offsets[i][0], end: enc.offsets[i][1],
      lemma: pickLemma(word, candidates), prefix: word.slice(0, plen), base: word.slice(plen),
      pos: labels.pos[argmax(out.morph, m + P, POS)], feats: featsAt(m + P + POS), prefixPos,
      suffix: suffix === 'none' ? null : suffix, suffixFeats: suffix === 'none' ? null : featsAt(m + P + POS + featSpan + SUF),
      ner: labels.ner[argmax(out.ner, i * nerN, nerN)],
    });
  }
  return words;
}

/** The single prefixes inside a prefix string, in order: "וכשה" -> ["ו", "כש", "ה"]. */
export function splitPrefix(prefix, labels) {
  return [...prefixesOf(prefix, prefixTables(labels), true)];
}
