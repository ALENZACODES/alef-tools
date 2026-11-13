import { createCorrector, showName, hasName, rankWith, namesWith, distance, looksAlike, lettersOf, budget, LOOK_ALIKE, NAME_SHOWN } from './correct.js';
export const id = 'ocr-fix';
export const version = '0.1.0';
export const packs = [];
export { createCorrector, showName, hasName, rankWith, namesWith, distance, looksAlike, lettersOf, budget, LOOK_ALIKE, NAME_SHOWN };
export async function load(opts = {}) {
 let lexicon = opts.lexicon;
 if (!lexicon) {
  if (!opts.lexiconUrl) throw new TypeError('ocr-fix: pass lexicon or lexiconUrl');
  const res = await (opts.fetch || globalThis.fetch)(String(opts.lexiconUrl), { signal: opts.signal });
  if (!res.ok) throw new Error(`ocr-fix: word list not available (${res.status})`);
  lexicon = await res.json();
 }
 const corrector = createCorrector(/** @type {any} */ (lexicon));
 const rank = rankWith(opts.words); const isName = namesWith(opts.words);
 return {
  size: corrector.size,
  usesContext: !!rank, usesNameTags: !!isName,
  correctLine: (text, o = {}) => corrector.correctLine(text, { rank, isName, ...o }),
  correctBoxes: (boxes, o = {}) => corrector.correctBoxes(boxes, { rank, isName, ...o }),
  correctToken: corrector.correctToken, known: corrector.known, showName, hasName,
 };
}
export async function unload() { /* nothing is held open */ }
