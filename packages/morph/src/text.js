// @ts-check
// Hebrew text handling shared by the build (scripts/collect_text.mjs) and the browser lookup (src/lookup.js), so both
// cut a string into the same sentences and words and give them the same keys. Pure: no DOM, no network.
import { stripMarks, plene } from './plene.js';

const LETTERS_MARKS = 'א-ת֑-ׇֽֿׁׂׅׄ';
/** A word: letters and points, with a geresh or gershayim allowed inside (צה״ל, ג׳ורג׳). A maqaf ends a word. */
const WORD_RE = new RegExp(`[${LETTERS_MARKS}]+(?:["'׳״][${LETTERS_MARKS}]+)*['׳]?`, 'gu');
/** A stretch of Hebrew: Hebrew characters, with spaces and everyday punctuation between them. */
const SEGMENT_RE = /[֐-׿יִ-ﭏ](?:[֐-׿יִ-ﭏ\s,.!?;:"'()\-–—…0-9]*[֐-׿יִ-ﭏ])?[.!?…]*/gu;
const NAME = 'יהוה';
const NAME_PREFIX = /^[ובלמכשה]{1,3}$/u;
/** How the Name is written wherever this package has to put something in its place. It is never analysed. */
export const NAME_SHOWN = 'ה׳';

const consonants = (s) => [...String(s)].filter((c) => c >= 'א' && c <= 'ת').join('');

/** True for the four-letter Name, alone or behind one to three prefix letters, pointed or not, and for ה׳ itself. */
export function isNameWord(word) {
  const c = consonants(word);
  if (c === NAME) return true;
  if (c.endsWith(NAME) && NAME_PREFIX.test(c.slice(0, -NAME.length))) return true;
  return /^ה[׳']$/u.test(stripMarks(word));
}

/** @returns {{text:string, start:number, end:number}[]} the stretches of Hebrew in any string */
export function segments(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(SEGMENT_RE)) out.push({ text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  return out;
}

/** @returns {{word:string, start:number, end:number}[]} the Hebrew words of a string, as shown */
export function words(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(WORD_RE)) out.push({ word: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  return out;
}

/** The key a word is filed under: its letters without points. */
export const wordKey = (word) => stripMarks(word).replace(/['"]/g, (c) => (c === "'" ? '׳' : '״'));

/** A short key for a stretch of Hebrew (FNV-1a over its unpointed text, spaces squeezed). The same in the build and the browser. */
export function contextKey(text) {
  const s = stripMarks(text).replace(/\s+/gu, ' ').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/**
 * A stretch of Hebrew made ready for the model: every word in everyday full spelling, the Name replaced, and for each
 * shown word where it sits in the model's text.
 * @returns {{model:string, words:{key:string, shown:string, start:number, end:number, name:boolean}[]}}
 */
export function forModel(segment) {
  let model = ''; let last = 0; const out = [];
  for (const w of words(segment)) {
    model += stripMarks(segment.slice(last, w.start));
    const name = isNameWord(w.word);
    const spelled = name ? NAME_SHOWN : stripMarks(plene(w.word));
    out.push({ key: name ? NAME_SHOWN : wordKey(w.word), shown: name ? NAME_SHOWN : w.word, start: model.length, end: model.length + spelled.length, name });
    model += spelled; last = w.end;
  }
  model += stripMarks(segment.slice(last));
  return { model, words: out };
}
