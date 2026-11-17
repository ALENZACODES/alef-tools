// @ts-check
// Small Hebrew text helpers shared by the nikud and phoneme code. No DOM, no network.

export const MAT_LECT = '<MAT_LECT>';
/** The marks the model can put on one letter, by class number. */
export const NIKUD_CLASSES = Object.freeze(['', MAT_LECT, 'ּ', 'ְ', 'ֱ', 'ֲ', 'ֳ', 'ִ', 'ֵ', 'ֶ', 'ַ', 'ָ',
  'ֹ', 'ֺ', 'ֻ', 'ְּ', 'ֱּ', 'ֲּ', 'ֳּ', 'ִּ', 'ֵּ', 'ֶּ', 'ַּ',
  'ָּ', 'ֹּ', 'ֺּ', 'ֻּ', 'ׇ', 'ׇּ']);
export const SHIN_CLASSES = Object.freeze(['ׁ', 'ׂ']);
/** Marks the phoneme pack adds: the stressed letter, a shva that is sounded, the end of a prefix. */
export const STRESS = '֫';
export const VOCAL_SHVA = 'ֽ';
export const PREFIX = '|';
export const MATRES = 'אוי';
/** The longest text handed to a model in one go (the models take 2048 positions, two are used for the ends). */
export const MAX_CHARS = 2046;

// Vowel points, dagesh, shin and sin dots, cantillation, meteg, rafe, qamats qatan. Maqaf, paseq and sof pasuq are kept.
const POINTS = /[֑-ׇֽֿׁׂׅׄ]/g;
const VOWEL_POINTS = /[ְ-ׇּׁׂ]/;
const CANTILLATION = /[֑-֯]/;
const WORD = /[א-ת֑-ֽֿ-ׇ]+/g;

export const stripPoints = (s) => String(s ?? '').replace(POINTS, '');
export const hasPoints = (s) => VOWEL_POINTS.test(String(s ?? ''));
export const hasCantillation = (s) => CANTILLATION.test(String(s ?? ''));
export const hasHebrew = (s) => /[א-ת]/.test(String(s ?? ''));
export const isLetter = (ch) => ch >= 'א' && ch <= 'ת';
const lettersOf = (w) => [...w].filter(isLetter).join('');

// The divine Name --------------------------------------------------------------------------------------------------------
const NAME = 'יהוה';
/** How the Name is written wherever this package returns text: he + geresh. */
export const NAME_SHOWN = 'ה׳';
const NAME_PREFIXES = 'ובלמכשה';
const PREFIXED = new RegExp(`^([${NAME_PREFIXES}]{1,3})${NAME}$`);

/** '' for the Name alone, the prefix letters for the Name with prefixes, null for any other word. */
export function nameWord(word) {
  const c = lettersOf(word);
  if (c === NAME) return '';
  if (c === 'יי' && /^[א-ת֑-ׇ]+$/.test(word)) return '';
  const m = PREFIXED.exec(c);
  return m ? m[1] : null;
}

/**
 * Writes the divine Name as he + geresh (prefix letters stay, bare). `found` is also true when the text already carries
 * he + geresh. Callers leave out the phoneme line for any text where `found` is true: the Name is never sounded out.
 * @param {string} text @returns {{text:string, found:boolean}}
 */
export function guardName(text) {
  const src = String(text ?? '');
  let found = src.includes(NAME_SHOWN) || src.includes("ה'");
  const out = src.replace(WORD, (w) => {
    const p = nameWord(w);
    if (p === null) return w;
    found = true;
    return p + NAME_SHOWN;
  });
  return { text: out, found };
}

/**
 * Cuts text into pieces a model can take, at sentence ends where it can. Joining the pieces gives the text back.
 * @param {string} text @param {number} [max] @returns {string[]}
 */
export function chunks(text, max = 400) {
  const out = [];
  let rest = String(text ?? '');
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '), window.lastIndexOf('׃'));
    if (cut < max / 4) cut = window.lastIndexOf(' ');
    cut = cut < 1 ? max : cut + 1;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

// A word: letters with their marks (and the phoneme pack's | mark). A geresh between letters (ג׳ינס) or U+05F3 at the end stays inside.
const L = '[\\u05d0-\\u05ea\\u0591-\\u05bd\\u05bf-\\u05c7|]';
const RUN = new RegExp(`${L}+(?:['\\u05f3]${L}+)*\\u05f3?`, 'g');

/**
 * Text as runs: Hebrew words (letters with their marks) and everything between them.
 * @param {string} text @returns {{word:boolean, text:string}[]}
 */
export function runs(text) {
  const out = [];
  let at = 0;
  const src = String(text ?? '');
  for (const m of src.matchAll(RUN)) {
    if (!/[\u05d0-\u05ea]/.test(m[0])) continue;
    if (m.index > at) out.push({ word: false, text: src.slice(at, m.index) });
    out.push({ word: true, text: m[0] });
    at = m.index + m[0].length;
  }
  if (at < src.length) out.push({ word: false, text: src.slice(at) });
  return out;
}
