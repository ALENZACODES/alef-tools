import { stripMarks, plene } from './plene.js';
const LETTERS_MARKS = 'א-ת֑-ׇֽֿׁׂׅׄ';
const WORD_RE = new RegExp(`[${LETTERS_MARKS}]+(?:["'׳״][${LETTERS_MARKS}]+)*['׳]?`, 'gu');
const SEGMENT_RE = /[֐-׿יִ-ﭏ](?:[֐-׿יִ-ﭏ\s,.!?;:"'()\-–—…0-9]*[֐-׿יִ-ﭏ])?[.!?…]*/gu;
const NAME = 'יהוה';
const NAME_PREFIX = /^[ובלמכשה]{1,3}$/u;
export const NAME_SHOWN = 'ה׳';
const consonants = (s) => [...String(s)].filter((c) => c >= 'א' && c <= 'ת').join('');
export function isNameWord(word) {
 const c = consonants(word);
 if (c === NAME) return true;
 if (c.endsWith(NAME) && NAME_PREFIX.test(c.slice(0, -NAME.length))) return true;
 return /^ה[׳']$/u.test(stripMarks(word));
}
export function segments(text) {
 const out = [];
 for (const m of String(text ?? '').matchAll(SEGMENT_RE)) out.push({ text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
 return out;
}
export function words(text) {
 const out = [];
 for (const m of String(text ?? '').matchAll(WORD_RE)) out.push({ word: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
 return out;
}
export const wordKey = (word) => stripMarks(word).replace(/['"]/g, (c) => (c === "'" ? '׳' : '״'));
export function contextKey(text) {
 const s = stripMarks(text).replace(/\s+/gu, ' ').trim();
 let h = 0x811c9dc5;
 for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
 return h.toString(36);
}
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
