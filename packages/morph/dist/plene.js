const MARK = /[֑-ֽֿ-ׇ]/u;
const MARKS_G = /[֑-ֽֿ-ׇ]/gu;
const LETTER = /[א-ת]/u;
const SHVA = 'ְ', CHIRIK = 'ִ', CHOLAM = 'ֹ', CHOLAM_VAV = 'ֺ', KUBUTZ = 'ֻ', DAGESH = 'ּ';
const VOWEL_ON_VAV = /[ְ-ָֻ]/u;
const KEEP_SHORT = new Set(['כל', 'אלהים', 'משה', 'יעקב', 'שלמה', 'אהרן', 'כהן', 'אם', 'עם', 'מן', 'הנה', 'אשה', 'משם', 'מפה', 'מזה', 'מכל', 'מכאן', 'צהרים', 'נח', 'פה', 'כה', 'לא', 'זאת', 'אנכי', 'מצרים', 'שמים', 'מים', 'ירושלים']);
export function stripMarks(text) {
 return String(text ?? '').normalize('NFC').replace(MARKS_G, '');
}
export function isPointed(text) {
 return /[ְ-ׇֻׁׂ]/u.test(String(text ?? ''));
}
export function pleneWord(word) {
 const src = String(word ?? '').normalize('NFD');
 if (!isPointed(src)) return stripMarks(src);
 const units = [];
 for (const ch of src) {
  if (MARK.test(ch)) { if (units.length) units[units.length - 1].m += ch; } else units.push({ c: ch, m: '' });
 }
 const bare = units.map((u) => u.c).join('');
 if (KEEP_SHORT.has(bare)) return bare;
 let out = '';
 const letters = units.filter((u) => LETTER.test(u.c)).length;
 for (let i = 0; i < units.length; i++) {
  const u = units[i], next = units[i + 1], prev = units[i - 1];
  const nextIsLetter = !!next && LETTER.test(next.c);
  if (!LETTER.test(u.c)) { out += u.c; continue; }
  if (u.c === 'ו' && VOWEL_ON_VAV.test(u.m) && prev && LETTER.test(prev.c) && nextIsLetter && prev.c !== 'ו' && next.c !== 'ו') { out += 'וו'; continue; }
  out += u.c;
  if (u.c === 'ו') continue;
  if (u.m.includes(KUBUTZ)) { if (!(nextIsLetter && next.c === 'ו')) out += 'ו'; continue; }
  if (u.m.includes(CHOLAM) || u.m.includes(CHOLAM_VAV)) {
   const silentAlef = nextIsLetter && next.c === 'א' && !/[ְ-ֻ]/u.test(next.m);
   if (nextIsLetter && next.c !== 'ו' && !silentAlef) out += 'ו';
   continue;
  }
  if (u.m.includes(CHIRIK) && u.c !== 'י' && nextIsLetter && next.c !== 'י') {
   const plainShva = next.m.includes(SHVA) && !next.m.includes(DAGESH);
   const fromPrefix = i === 0 && u.c === 'מ' && next.m.includes(DAGESH) && letters >= 4;
   if (!plainShva && !fromPrefix) out += 'י';
  }
 }
 return out;
}
export function plene(text) {
 return String(text ?? '').normalize('NFD').replace(/[א-ת][א-ת֑-ֽֿ-ׇ]*/gu, (w) => pleneWord(w)).normalize('NFC');
}
