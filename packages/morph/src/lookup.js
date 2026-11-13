// @ts-check
// Word-tap lookup. Pure: no DOM, no network. Two sources give the same shape, so one card renders both:
//   findInUnit()  the built lesson data (data/morph/<unit>.js): works offline with no pack
//   fromJoint()   a word analysed on the device by the "words" pack (src/joint.js decode)
import { isNameWord, wordKey, contextKey, segments } from './text.js';

const GENDER = { Masc: 'm', Fem: 'f', 'Fem,Masc': 'mf' };
const NUMBER = { Sing: 'sg', Plur: 'pl', Dual: 'du', 'Plur,Sing': 'sg/pl', 'Dual,Plur': 'du/pl' };
const TENSE = { Past: 'past', Fut: 'future', Pres: 'present', Imp: 'command' };
const NAMES = new Set(['PER', 'GPE', 'LOC', 'ORG', 'FAC']);

/** A word has at least two Hebrew letters. One letter on its own (a letters lesson shows many) gets no notes. */
export const isWord = (word) => (String(word ?? '').match(/[א-ת]/g) || []).length >= 2;

/**
 * @param {any} unit  one unit's notes (index.js loadUnit)
 * @param {string} word  the word as shown (points allowed)
 * @param {string} [around]  the text the word sits in (the whole element's text is fine)
 * @returns {{a:any, entry:any|null}|null}  null for a word the unit does not hold, for a single letter, and always for the divine Name
 */
export function findInUnit(unit, word, around = '') {
  if (!unit || !unit.words || isNameWord(word) || !isWord(word)) return null;
  const bucket = unit.words[wordKey(word)];
  if (!bucket || !bucket.length) return null;
  let a = bucket[0];
  if (bucket.length > 1 && around) {
    const keys = new Set(segments(around).map((s) => contextKey(s.text)));
    a = bucket.find((x) => Array.isArray(x.c) && x.c.some((k) => keys.has(k))) || a;
  }
  return { a, entry: (a.d && unit.entries && unit.entries[a.d]) || null };
}

/**
 * @param {import('./joint.js').JointWord} w
 * @param {{lemmas?:Record<string,[string,string,number]>}} [roots]  data/morph/roots.js (index.js loadRoots)
 * @returns {{a:any, entry:any|null}|null}
 */
export function fromJoint(w, roots) {
  if (!w || isNameWord(w.token) || !isWord(w.token) || (w.lemma && isNameWord(w.lemma))) return null;
  /** @type {any} */ const a = { l: w.lemma, p: w.prefix, s: w.pos };
  if (GENDER[w.feats.Gender]) a.g = GENDER[w.feats.Gender];
  if (NUMBER[w.feats.Number]) a.n = NUMBER[w.feats.Number];
  if (w.feats.Person && w.feats.Person !== '1,2,3') a.r = w.feats.Person;
  if (TENSE[w.feats.Tense]) a.t = TENSE[w.feats.Tense];
  if (w.suffix) { const f = w.suffixFeats || {}; a.sf = {}; if (GENDER[f.Gender]) a.sf.g = GENDER[f.Gender]; if (NUMBER[f.Number]) a.sf.n = NUMBER[f.Number]; if (f.Person) a.sf.r = f.Person; }
  if (a.p && !a.p.includes('ה') && w.prefixPos.includes('DET')) a.dt = 1;
  if (w.ner !== 'O' && NAMES.has(w.ner.slice(2))) a.e = w.ner.slice(2);
  // a root is shown only when the app's own word list has one for this dictionary form (never worked out here)
  const hit = w.lemma && roots?.lemmas ? roots.lemmas[w.lemma] : null;
  const entry = hit ? { he: w.lemma, en: '', pos: '', root: hit[0], binyan: hit[1] || null, rootChecked: !!hit[2], partial: true } : null;
  return { a, entry };
}
