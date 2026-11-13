// @ts-check
// Pointed Hebrew -> everyday full spelling (ktiv male), by rule. Pure: no DOM, no network.
//
// Why this exists: the DictaBERT models were trained on unpointed text written the everyday way (דיבר, שולחן, בוקר).
// Lesson text is pointed, and a pointed word with its vowel marks simply removed is the short spelling (דבר, שלחן, בקר),
// which the models read less well. These rules put back the vav and yod that everyday spelling writes.
//
// They are a small, deliberate subset of the Academy's rules, not all of them:
//   kubutz            -> vav            שֻׁלְחָן  -> שולחן
//   cholam (no vav)   -> vav            בֹּקֶר    -> בוקר     (not before a silent alef: רֹאשׁ, לֹא; not at the end of a word)
//   chirik (no yod)   -> yod            דִּבֵּר   -> דיבר     (not when the next letter has a plain shva: מִשְׁפָּט)
//   a sounded vav inside a word -> two  תִּקְוָה  -> תקווה
// A sounded yod is never doubled, and a short list of everyday words keeps its short spelling. Text with no vowel
// marks is returned as it is.

const MARK = /[֑-ֽֿ-ׇ]/u;
const MARKS_G = /[֑-ֽֿ-ׇ]/gu;
const LETTER = /[א-ת]/u;
const SHVA = 'ְ', CHIRIK = 'ִ', CHOLAM = 'ֹ', CHOLAM_VAV = 'ֺ', KUBUTZ = 'ֻ', DAGESH = 'ּ';
const VOWEL_ON_VAV = /[ְ-ָֻ]/u;

/** Words that everyday spelling keeps short, by their letters. */
const KEEP_SHORT = new Set(['כל', 'אלהים', 'משה', 'יעקב', 'שלמה', 'אהרן', 'כהן', 'אם', 'עם', 'מן', 'הנה', 'אשה', 'משם', 'מפה', 'מזה', 'מכל', 'מכאן', 'צהרים', 'נח', 'פה', 'כה', 'לא', 'זאת', 'אנכי', 'מצרים', 'שמים', 'מים', 'ירושלים']);

/** Removes vowel and cantillation marks. The maqaf stays. */
export function stripMarks(text) {
  return String(text ?? '').normalize('NFC').replace(MARKS_G, '');
}

/** True when the text carries at least one vowel mark. */
export function isPointed(text) {
  return /[ְ-ׇֻׁׂ]/u.test(String(text ?? ''));
}

/** One pointed word (no spaces) -> full spelling. */
export function pleneWord(word) {
  const src = String(word ?? '').normalize('NFD');
  if (!isPointed(src)) return stripMarks(src);
  /** @type {{c:string, m:string}[]} */
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
    // a sounded vav in the middle of a word is written twice
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
      // "from" glued to a word (מִבַּיִת) has no yod; a short word that starts with mem-chirik (מִלָּה, מִטָּה) does
      const fromPrefix = i === 0 && u.c === 'מ' && next.m.includes(DAGESH) && letters >= 4;
      if (!plainShva && !fromPrefix) out += 'י';
    }
  }
  return out;
}

/** A whole string: every run of Hebrew letters and marks is respelled, everything else is kept. */
export function plene(text) {
  return String(text ?? '').normalize('NFD').replace(/[א-ת][א-ת֑-ֽֿ-ׇ]*/gu, (w) => pleneWord(w)).normalize('NFC');
}
