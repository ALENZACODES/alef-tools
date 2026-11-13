import { STRESS, VOCAL_SHVA, PREFIX, stripPoints, hasPoints, hasCantillation, isLetter, guardName, chunks, runs, NAME_SHOWN } from './hebrew.js';
import { decode, infer } from './menaked.js';
const SHVA = 'ְ', DAGESH = 'ּ', SHIN_DOT = 'ׁ', SIN_DOT = 'ׂ', HOLAM = 'ֹ', HOLAM_VAV = 'ֺ', QAMATS_QATAN = 'ׇ', PATAH = 'ַ';
const VOWEL_SOUND = { 'ֱ': 'e', 'ֲ': 'a', 'ֳ': 'o', 'ִ': 'i', 'ֵ': 'e', 'ֶ': 'e', 'ַ': 'a', 'ָ': 'a', 'ֹ': 'o', 'ֺ': 'o', 'ֻ': 'u', 'ׇ': 'o' };
const PLAIN = { 'ג': 'ɡ', 'ד': 'd', 'ז': 'z', 'ח': 'χ', 'ט': 't', 'ל': 'l', 'מ': 'm', 'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'צ': 'ts', 'ץ': 'ts', 'ק': 'k', 'ר': 'ʁ', 'ת': 't' };
const WITH_GERESH = { 'ג': 'dʒ', 'ז': 'ʒ', 'צ': 'tʃ', 'ץ': 'tʃ', 'ת': 't', 'ד': 'd', 'ח': 'χ', 'ע': 'ʁ', 'ר': 'ʁ' };
const GERESH = /['׳]/;
const SONORANT_START = 'ילמנר';
export function clusters(word) {
 const out = [];
 for (const ch of word) {
  const last = out[out.length - 1];
  if (isLetter(ch)) { out.push({ ch, dagesh: false, shin: '', vowel: '', stress: false, vocalShva: false, prefixEnd: false, geresh: false }); continue; }
  if (!last) continue;
  if (ch === DAGESH) last.dagesh = true;
  else if (ch === SHIN_DOT) last.shin = 'shin';
  else if (ch === SIN_DOT) last.shin = 'sin';
  else if (ch === STRESS) last.stress = true;
  else if (ch === VOCAL_SHVA) last.vocalShva = true;
  else if (ch === PREFIX) last.prefixEnd = true;
  else if (GERESH.test(ch)) last.geresh = true;
  else if (ch === SHVA || VOWEL_SOUND[ch]) last.vowel = ch;
 }
 return out;
}
export function wordSounds(word, o = {}) {
 const cs = clusters(word);
 const marked = o.marked ?? cs.some((c) => c.stress || c.vocalShva || c.prefixEnd);
 const segs = [];
 const vocalShva = [], qamatsQatan = [];
 let prefix = 0;
 cs.forEach((c, i) => { if (c.prefixEnd) prefix = i + 1; });
 for (let i = 0; i < cs.length; i++) {
  const c = cs[i], prev = cs[i - 1], next = cs[i + 1];
  const last = i === cs.length - 1;
  let onset = '', vowel = '';
  if (c.vowel === QAMATS_QATAN) qamatsQatan.push(i);
  if (c.ch === 'ו') {
   const bare = !c.vowel && !c.dagesh;
   const glottal = prev && !prev.vowel && !prev.dagesh && (prev.ch === 'א' || prev.ch === 'ע') ? 'ʔ' : ''; // a bare alef or ayin before a vowel letter
   if (c.dagesh && !c.vowel) { // shuruk
    segs.push({ onset: glottal, vowel: 'u', at: i }); continue;
   }
   if ((c.vowel === HOLAM || c.vowel === HOLAM_VAV) && prev && !prev.vowel) { segs.push({ onset: glottal, vowel: 'o', at: i }); continue; }
   if (bare) {
    if (prev && prev.ch === 'ו' && !prev.vowel && !prev.dagesh) continue; // second of a doubled vav
    const before = segs.length ? segs[segs.length - 1] : null;
    if (prev && prev.ch !== 'ו' && before && before.at === i - 1 && (prev.vowel === '\u05bb' || prev.vowel === HOLAM)) continue; // vowel letter after kubutz or holam
    segs.push({ onset: 'v', vowel: '', at: i }); continue;
   }
   onset = 'v';
  } else if (c.ch === 'י') {
   if (!c.vowel && !c.dagesh) {
    const pv = prev ? prev.vowel : '';
    const prevSound = segs.length ? segs[segs.length - 1].vowel : '';
    if (next && next.ch === 'ו' && !next.vowel && !next.dagesh && last === false && i + 1 === cs.length - 1 && prevSound === 'a') continue; // -av ending: yod is silent
    if (!prev || !prevSound || prevSound === 'i' || prevSound === 'e' || pv === SHVA) continue; // vowel letter
    segs.push({ onset: 'j', vowel: '', at: i }); continue;
   }
   onset = 'j';
  } else if (c.ch === 'א') {
   if (!c.vowel) continue;
   onset = c.vowel === SHVA ? '' : 'ʔ';
  } else if (c.ch === 'ע') {
   if (!c.vowel) continue;
   onset = 'ʔ';
  } else if (c.ch === 'ה') {
   if (!c.vowel && !(c.dagesh && last)) { if (last || !next) continue; onset = 'h'; }
   else onset = 'h';
  } else if (c.geresh && WITH_GERESH[c.ch]) onset = WITH_GERESH[c.ch];
  else if (c.ch === 'ב') onset = c.dagesh ? 'b' : 'v';
  else if (c.ch === 'כ' || c.ch === 'ך') onset = c.dagesh ? 'k' : 'χ';
  else if (c.ch === 'פ' || c.ch === 'ף') onset = c.dagesh ? 'p' : 'f';
  else if (c.ch === 'ש') onset = c.shin === 'sin' ? 's' : 'ʃ';
  else onset = PLAIN[c.ch] || '';
  if (c.vowel === SHVA) {
   const sounded = marked ? c.vocalShva : i === 0 && cs.length > 1 && (SONORANT_START.includes(c.ch) || 'אהע'.includes(next ? next.ch : ''));
   if (sounded) { vowel = 'e'; vocalShva.push(i); }
  } else if (VOWEL_SOUND[c.vowel]) vowel = VOWEL_SOUND[c.vowel];
  if (last && c.vowel === PATAH && segs.length && segs[segs.length - 1].vowel && (c.ch === 'ח' || c.ch === 'ע' || (c.ch === 'ה' && c.dagesh))) {
   segs.push({ onset: '', vowel: 'a', at: i });
   const tail = c.ch === 'ח' ? 'χ' : c.ch === 'ה' ? 'h' : '';
   if (tail) segs.push({ onset: tail, vowel: '', at: i });
   continue;
  }
  segs.push({ onset, vowel, at: i });
 }
 const vowelSegs = segs.map((s, k) => (s.vowel ? k : -1)).filter((k) => k >= 0);
 let stressSeg = -1;
 const markedAt = cs.findIndex((c) => c.stress);
 if (markedAt >= 0) {
  stressSeg = segs.findIndex((s) => s.at >= markedAt && s.vowel);
  if (stressSeg < 0) stressSeg = vowelSegs[vowelSegs.length - 1] ?? -1;
 } else if (vowelSegs.length) {
  stressSeg = vowelSegs[vowelSegs.length - 1];
  const lastC = cs[cs.length - 1];
  if (vowelSegs.length > 1 && lastC && lastC.vowel === PATAH && 'חעה'.includes(lastC.ch) && segs[stressSeg].onset === '' && segs[stressSeg].at === cs.length - 1) stressSeg = vowelSegs[vowelSegs.length - 2];
 }
 let onsetSeg = stressSeg;
 if (stressSeg > 0 && !segs[stressSeg].onset && segs[stressSeg - 1] && !segs[stressSeg - 1].vowel && segs[stressSeg - 1].onset && segs[stressSeg - 1].at < segs[stressSeg].at) onsetSeg = stressSeg - 1;
 let phonemes = '';
 segs.forEach((s, k) => { phonemes += (k === onsetSeg && vowelSegs.length > 1 ? 'ˈ' : '') + s.onset + s.vowel; });
 return { phonemes, stress: stressSeg >= 0 ? segs[stressSeg].at : -1, vocalShva, qamatsQatan, prefix };
}
const OWN_MARKS = new RegExp(`[${STRESS}${VOCAL_SHVA}${PREFIX}]`, 'g');
export const plainPointed = (s) => String(s ?? '').replace(OWN_MARKS, '');
export function carryMarks(book, marked) {
 const a = clusters(book), b = clusters(marked);
 if (a.length !== b.length || a.some((c, i) => c.ch !== b[i].ch)) return marked;
 let out = '', k = -1;
 for (const ch of book) {
  if (isLetter(ch)) {
   if (k >= 0) out += tail(a[k], b[k]);
   k++;
  }
  out += ch;
 }
 if (k >= 0) out += tail(a[k], b[k]);
 return out;
}
const tail = (own, m) => (m.stress ? STRESS : '') + (m.vocalShva && own.vowel === SHVA ? VOCAL_SHVA : '') + (m.prefixEnd ? PREFIX : '');
export function soundLine(marked) {
 let line = '';
 const words = [];
 for (const r of runs(marked)) {
  if (!r.word) { line += r.text.replace(/־/g, '-'); continue; }
  const s = wordSounds(r.text, { marked: true });
  words.push({ text: plainPointed(r.text), ...s });
  line += s.phonemes;
 }
 return { phonemes: line.replace(/\s+/g, ' ').trim(), words };
}
export function createPhonikud(rt) {
 let chain = Promise.resolve();
 const one = async (piece) => {
  const bare = stripPoints(piece);
  if (!/[א-ת]/.test(bare)) return piece;
  const out = await infer(rt, bare);
  const marked = decode(bare, out.nikud_logits.data, out.shin_logits.data, { extra: out.additional_logits ? out.additional_logits.data : null });
  const a = runs(piece), b = runs(marked);
  if (a.length !== b.length) return marked;
  return a.map((r, i) => (r.word && hasPoints(r.text) ? carryMarks(r.text, b[i].text) : b[i].text)).join('');
 };
 return {
  sounds(text) {
   const job = chain.then(async () => {
    const src = String(text ?? '');
    if (!/[א-ת]/.test(src)) return { text: src, marked: src, phonemes: null, name: false, words: [], reason: /** @type {const} */ ('no-hebrew') };
    const g = guardName(src);
    if (g.found) return { text: g.text, marked: g.text, phonemes: null, name: true, words: [], reason: /** @type {const} */ ('name') };
    let marked = '';
    const forModel = hasCantillation(src) ? stripPoints(src) : src;
    for (const piece of chunks(forModel)) marked += await one(piece);
    const line = soundLine(marked);
    return { text: hasCantillation(src) ? src : plainPointed(marked), marked, phonemes: line.phonemes, name: false, words: line.words, reason: /** @type {const} */ ('') };
   });
   chain = job.then(() => {}, () => {});
   return job;
  },
 };
}
export { NAME_SHOWN };
