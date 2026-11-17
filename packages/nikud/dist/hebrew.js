export const MAT_LECT = '<MAT_LECT>';
export const NIKUD_CLASSES = Object.freeze(['', MAT_LECT, 'ּ', 'ְ', 'ֱ', 'ֲ', 'ֳ', 'ִ', 'ֵ', 'ֶ', 'ַ', 'ָ',
 'ֹ', 'ֺ', 'ֻ', 'ְּ', 'ֱּ', 'ֲּ', 'ֳּ', 'ִּ', 'ֵּ', 'ֶּ', 'ַּ',
 'ָּ', 'ֹּ', 'ֺּ', 'ֻּ', 'ׇ', 'ׇּ']);
export const SHIN_CLASSES = Object.freeze(['ׁ', 'ׂ']);
export const STRESS = '֫';
export const VOCAL_SHVA = 'ֽ';
export const PREFIX = '|';
export const MATRES = 'אוי';
export const MAX_CHARS = 2046;
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
const NAME = 'יהוה';
export const NAME_SHOWN = 'ה׳';
const NAME_PREFIXES = 'ובלמכשה';
const PREFIXED = new RegExp(`^([${NAME_PREFIXES}]{1,3})${NAME}$`);
export function nameWord(word) {
 const c = lettersOf(word);
 if (c === NAME) return '';
 if (c === 'יי' && /^[א-ת֑-ׇ]+$/.test(word)) return '';
 const m = PREFIXED.exec(c);
 return m ? m[1] : null;
}
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
const L = '[\\u05d0-\\u05ea\\u0591-\\u05bd\\u05bf-\\u05c7|]';
const RUN = new RegExp(`${L}+(?:['\\u05f3]${L}+)*\\u05f3?`, 'g');
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
