import { emissions, skipTable, ctcLogLik, align } from './ctc-align.js';
export const TRADITIONS = Object.freeze(['israeli', 'sephardi', 'ashkenazi']);
export const DEFAULT_MARGIN = -6;
export const DEFAULT_DROP_MARGIN = -30;
const MARK = /[֑-ׇ]/;
const LETTER = /[א-ת]/;
const DAGESH = 'ּ', SHIN_DOT = 'ׁ', SIN_DOT = 'ׂ', HOLAM = 'ֹ', HOLAM_VAV = 'ֺ', SHEVA = 'ְ';
const VOWELS = /[ְ-ׇֻ]/;
const FRONT_VOWEL = /[ִֵֶ]/; // hiriq, tsere, segol: a yod after one of these carries the vowel
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const TO_FINAL = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };
const both = (ch) => { const base = FINALS[ch] || ch; return TO_FINAL[base] ? [base, TO_FINAL[base]] : [base]; };
const NAME = 'יהוה';
const PREFIXES = 'ובלמכשה';
export function isNameWord(word) {
 const w = String(word);
 const c = [...w].filter((x) => LETTER.test(x)).join('');
 if (c === NAME || c === 'יי') return true;
 if (new RegExp(`^[${PREFIXES}]{1,3}${NAME}$`).test(c)) return true;
 if (/^[הד][֑-ׇ]*[׳']$/.test(w)) return true; // ה׳ and ד׳
 return false;
}
function words(text) {
 const out = [];
 const re = /[֑-ׇא-ת׳״'"]+/g;
 let m;
 while ((m = re.exec(text))) {
  let at = 0;
  for (const part of m[0].split('־')) { if (/[א-ת]/.test(part)) out.push({ text: part, index: m.index + at }); at += part.length + 1; }
 }
 return out;
}
export function expectedUnits(text, o = {}) {
 const tradition = TRADITIONS.includes(o.tradition || '') ? o.tradition : 'israeli';
 const src = String(text ?? '').normalize('NFC');
  /** @type {Unit[]} */ const units = [];
 const ws = words(src).map((w) => ({ ...w, name: isNameWord(w.text) }));
 ws.forEach((w, wi) => {
  if (wi > 0 && !w.name && !ws[wi - 1].name) units.push({ index: w.index - 1, ch: ' ', word: wi, accept: ['|'], scored: false, why: 'space' });
  if (w.name) { units.push({ index: w.index, ch: '', word: wi, accept: 'any', scored: false, why: 'name' }); return; }
  const ls = [];
  for (let i = 0; i < w.text.length; i++) {
   const ch = w.text[i];
   if (LETTER.test(ch)) ls.push({ ch, marks: '', index: w.index + i });
   else if (MARK.test(ch) && ls.length) ls[ls.length - 1].marks += ch;
  }
  const pointed = ls.some((l) => VOWELS.test(l.marks) || l.marks.includes(DAGESH)); // a word with any point is treated as fully pointed
  ls.forEach((l, k) => {
   const base = FINALS[l.ch] || l.ch, last = k === ls.length - 1, prev = ls[k - 1];
   const dot = l.marks.includes(DAGESH), vowel = VOWELS.test(l.marks);
      /** @type {string[]} */ let accept = both(l.ch);
   let scored = true, why = '';
   const skip = (reason) => { scored = false; why = reason; };
   switch (base) {
    case 'א': case 'ע': accept = ['א', 'ע', 'ה']; skip('silent'); break;
    case 'ה': accept = ['ה', 'א', 'ע']; skip(last && !dot ? 'vowel-letter' : 'silent'); break;
    case 'ו':
     accept = ['ו', 'ב'];
     if (!pointed) skip('unpointed');
     else if ((l.marks.includes(HOLAM) || l.marks.includes(HOLAM_VAV) || (dot && !vowel)) ) { accept = ['ו']; skip('vowel-letter'); }
     break;
    case 'י':
     if (!pointed) skip('unpointed');
     else if (!vowel && !dot && prev && FRONT_VOWEL.test(prev.marks)) skip('vowel-letter');
     break;
    case 'ב': accept = pointed && dot ? ['ב'] : ['ב', 'ו']; break;
    case 'כ': accept = pointed && dot ? ['כ', 'ך', 'ק'] : pointed ? ['כ', 'ך', 'ח'] : ['כ', 'ך', 'ק', 'ח']; break;
    case 'ק': accept = ['ק', 'כ', 'ך']; break;
    case 'ח': accept = ['ח', 'כ', 'ך']; break;
    case 'ת': accept = ['ת', 'ט']; if (tradition === 'ashkenazi' && !(pointed && dot)) accept.push('ס', 'ש'); break;
    case 'ט': accept = ['ט', 'ת']; break;
    case 'ס': accept = ['ס', 'ש']; break;
    case 'ש': accept = l.marks.includes(SHIN_DOT) ? ['ש'] : ['ש', 'ס']; break;
    case 'צ': accept = ['צ', 'ץ']; if (tradition === 'sephardi') accept.push('ס'); break;
    default: break;
   }
   units.push({ index: l.index, ch: l.ch, word: wi, accept, scored, why });
  });
 });
 return { units, words: ws };
}
const NEG = -1e30;
const lse = (a, b) => (a < b ? b + Math.log1p(Math.exp(a - b)) : a + Math.log1p(Math.exp(b - a)));
export function scoreUtterance(heard, model, text, o = {}) {
 const { units, words: ws } = expectedUnits(text, o);
 const margin = o.margin ?? DEFAULT_MARGIN, dropMargin = o.dropMargin ?? DEFAULT_DROP_MARGIN;
 const { logp, T, V } = heard;
 const wordOut = ws.map((w) => ({ ...w, checked: 0, right: 0 }));
 const empty = { ok: false, letters: [], words: wordOut, checked: 0, right: 0, score: null };
 if (!units.length) return { ...empty, error: 'no-text' };
 const idOf = (ch) => model.vocab[ch];
 const letterIds = Object.entries(model.vocab).filter(([ch]) => LETTER.test(ch)).map(([, id]) => id);
 const pos = units.map((u) => (u.accept === 'any' ? null : u.accept.map(idOf).filter((id) => typeof id === 'number')));
 const live = units.map((u, i) => u.accept === 'any' || /** @type {number[]} */ (pos[i]).length > 0);
 const U = units.filter((_, i) => live[i]);
 const sets = pos.filter((_, i) => live[i]).map((s) => s || []);
 const L = U.length;
 if (T < L) return { ...empty, error: 'too-short' };
 const em = emissions(logp, T, V, sets);
 U.forEach((u, i) => {
  if (u.accept !== 'any') return;
  for (let t = 0; t < T; t++) { let top = -Infinity; for (let v = 0; v < V; v++) if (logp[t * V + v] > top) top = logp[t * V + v]; em[t * L + i] = top; }
  for (const j of [i - 1, i + 1]) if (U[j] && U[j].scored) { U[j].scored = false; U[j].why = 'beside-name'; }
 });
 const skip = skipTable(sets);
 U.forEach((u, i) => { if (u.accept === 'any') { skip[i] = 1; if (i + 1 < L) skip[i + 1] = 1; } });
 const blank = new Float32Array(T);
 for (let t = 0; t < T; t++) blank[t] = logp[t * V + model.blankId];
 const base = ctcLogLik(em, blank, T, L, skip, sets);
 if (base <= NEG / 2) return { ...empty, error: 'no-match' };
 const path = align(em, blank, T, L, skip);
 const letterOf = []; for (const [ch, id] of Object.entries(model.vocab)) letterOf[id] = ch;
 const letters = [];
 let checked = 0, right = 0;
 U.forEach((u, i) => {
  if (u.why === 'space' || u.why === 'name') return;
  if (!u.scored) { letters.push({ index: u.index, ch: u.ch, word: u.word, status: 'skip', why: u.why }); return; }
  const near = [...(sets[i - 1] || []), ...(sets[i + 1] || [])];
  const others = letterIds.filter((id) => !sets[i].includes(id) && !near.includes(id));
  const col = new Float32Array(T);
  for (let t = 0; t < T; t++) { let s = NEG; for (const id of others) s = lse(s, logp[t * V + id]); col[t] = s; }
  const swapped = ctcLogLik(em, blank, T, L, skip, sets, { swap: { at: i, col } });
  const dropped = ctcLogLik(em, blank, T, L, skip, sets, { drop: i });
  const m = +(base - swapped).toFixed(2), d = +(base - dropped).toFixed(2);
  const other = m < margin, missing = d < dropMargin;
  checked++; wordOut[u.word].checked++;
  if (!other && !missing) { right++; wordOut[u.word].right++; letters.push({ index: u.index, ch: u.ch, word: u.word, status: 'ok', why: '', margin: m, drop: d }); return; }
  let heardCh = '';
  if (other && swapped >= dropped) {
   const span = path.spans[i], end = i + 1 < L && path.spans[i + 1].start > span.end ? path.spans[i + 1].start - 1 : span.end;
   let best = -1, top = NEG;
   for (const id of others) { let s = NEG; for (let t = Math.max(0, span.start); t <= end; t++) s = lse(s, logp[t * V + id]); if (s > top) { top = s; best = id; } }
   heardCh = best >= 0 ? FINALS[letterOf[best]] || letterOf[best] : '';
  }
  letters.push({ index: u.index, ch: u.ch, word: u.word, status: 'check', why: '', margin: m, drop: d, heard: heardCh });
 });
 units.forEach((u, i) => { if (!live[i] && u.why !== 'space') letters.push({ index: u.index, ch: u.ch, word: u.word, status: 'skip', why: 'unpointed' }); });
 letters.sort((a, b) => a.index - b.index);
 return { ok: true, letters, words: wordOut, checked, right, score: checked ? right / checked : null };
}
