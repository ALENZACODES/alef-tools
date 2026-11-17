// @ts-check
// Letter-by-letter pronunciation feedback. No DOM, no network, no model: this file works on the letter probabilities that
// src/ctc.js produced on the device.
//
// WHAT IS CHECKED: each consonant of the expected text. For each one the question is: given the sound, is the expected letter
// (or any letter that sounds the same) more likely here than every other letter, and more likely than no letter at all?
//
// WHAT IS NOT CHECKED, and is reported as "skip" with the reason:
//   - vowels, shva and stress: the model writes unpointed letters, so it has no way to show a vowel;
//   - letters that carry a vowel or are silent (vav and yod as vowels, final he, alef, ayin, he);
//   - the divine Name: it is never scored, and whatever the learner says in its place is accepted
//     (the one letter on each side of it is skipped too).
//
// LETTERS THAT SOUND THE SAME share credit, so a correct reading is never marked down for spelling:
//   tav/tet, kaf/qof, khaf/het, samekh/sin, vet/vav, and every final form with its regular form.
// A learner's tradition adds its own valid readings (Ashkenazi tav without a dot read as "s"; Sephardi tsadi read as "s").

import { emissions, skipTable, ctcLogLik, align } from './ctc-align.js';

export const TRADITIONS = Object.freeze(['israeli', 'sephardi', 'ashkenazi']);
/**
 * A letter is marked "check" when the expected reading is less likely than "another letter here" by more than `margin`,
 * or less likely than "no letter here" by more than `dropMargin` (natural log; negative = the other reading must win clearly).
 * "No letter" needs the stronger evidence: the listening model itself skips letters in quick speech.
 * The defaults were chosen on half of the scoring set and are reported on the other half (eval/results/).
 */
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

// ---- the divine Name -------------------------------------------------------------------------------------------------
const NAME = 'יהוה';
const PREFIXES = 'ובלמכשה';
/** True for a written form of the divine Name: the four letters (alone or after prefix letters), the double yod, or he with a geresh. */
export function isNameWord(word) {
  const w = String(word);
  const c = [...w].filter((x) => LETTER.test(x)).join('');
  if (c === NAME || c === 'יי') return true;
  if (new RegExp(`^[${PREFIXES}]{1,3}${NAME}$`).test(c)) return true;
  if (/^[הד][֑-ׇ]*[׳']$/.test(w)) return true; // ה׳ and ד׳
  return false;
}

// ---- expected text -> positions -------------------------------------------------------------------------------------
/**
 * @typedef {{index:number, ch:string, word:number, accept:string[]|'any', scored:boolean, why:string}} Unit
 *   index: where the letter sits in the text handed in; accept: the model letters that count as right here ('any' = anything);
 *   why (when not scored): 'name' | 'beside-name' | 'vowel-letter' | 'silent' | 'unpointed' | 'space'
 */

/** Words of a text with the position of each: letters, points, geresh and gershayim stay inside a word. */
function words(text) {
  const out = [];
  const re = /[֑-ׇא-ת׳״'"]+/g;
  let m;
  while ((m = re.exec(text))) {
    // a maqaf joins two words in print; they are two words in speech
    let at = 0;
    for (const part of m[0].split('־')) { if (/[א-ת]/.test(part)) out.push({ text: part, index: m.index + at }); at += part.length + 1; }
  }
  return out;
}

/**
 * The positions to line the sound up with.
 * @param {string} text expected Hebrew, pointed or not @param {{tradition?:string}} [o]
 * @returns {{units:Unit[], words:{text:string, index:number, name:boolean}[]}}
 */
export function expectedUnits(text, o = {}) {
  const tradition = TRADITIONS.includes(o.tradition || '') ? o.tradition : 'israeli';
  const src = String(text ?? '').normalize('NFC');
  /** @type {Unit[]} */ const units = [];
  const ws = words(src).map((w) => ({ ...w, name: isNameWord(w.text) }));
  ws.forEach((w, wi) => {
    // the pause between words; around the Name there is none to line up (whatever is said there, pauses included, is accepted)
    if (wi > 0 && !w.name && !ws[wi - 1].name) units.push({ index: w.index - 1, ch: ' ', word: wi, accept: ['|'], scored: false, why: 'space' });
    if (w.name) { units.push({ index: w.index, ch: '', word: wi, accept: 'any', scored: false, why: 'name' }); return; }
    // letters with their points
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

// ---- scoring --------------------------------------------------------------------------------------------------------
const NEG = -1e30;
const lse = (a, b) => (a < b ? b + Math.log1p(Math.exp(a - b)) : a + Math.log1p(Math.exp(b - a)));

/**
 * @param {{logp:Float32Array, T:number, V:number}} heard from createCtc().posteriors()
 * @param {{vocab:Record<string,number>, blankId:number}} model
 * @param {string} text the expected Hebrew
 * @param {{tradition?:string, margin?:number, dropMargin?:number}} [o]
 * @returns {{ok:boolean, error?:string, letters:{index:number, ch:string, word:number, status:'ok'|'check'|'skip', why:string, margin?:number, drop?:number, heard?:string}[],
 *   words:{text:string, index:number, name:boolean, checked:number, right:number}[], checked:number, right:number, score:number|null}}
 *   letters: one entry per expected letter (none for the Name). status 'check' = worth another try; heard = the letter it sounded
 *   more like ('' when it sounded like no letter at all). score = right / checked, or null when nothing could be checked.
 */
export function scoreUtterance(heard, model, text, o = {}) {
  const { units, words: ws } = expectedUnits(text, o);
  const margin = o.margin ?? DEFAULT_MARGIN, dropMargin = o.dropMargin ?? DEFAULT_DROP_MARGIN;
  const { logp, T, V } = heard;
  const wordOut = ws.map((w) => ({ ...w, checked: 0, right: 0 }));
  const empty = { ok: false, letters: [], words: wordOut, checked: 0, right: 0, score: null };
  if (!units.length) return { ...empty, error: 'no-text' };
  const idOf = (ch) => model.vocab[ch];
  const letterIds = Object.entries(model.vocab).filter(([ch]) => LETTER.test(ch)).map(([, id]) => id);
  // positions; a unit whose letters the model does not have is left out of the line-up and reported as skipped
  const pos = units.map((u) => (u.accept === 'any' ? null : u.accept.map(idOf).filter((id) => typeof id === 'number')));
  const live = units.map((u, i) => u.accept === 'any' || /** @type {number[]} */ (pos[i]).length > 0);
  const U = units.filter((_, i) => live[i]);
  const sets = pos.filter((_, i) => live[i]).map((s) => s || []);
  const L = U.length;
  if (T < L) return { ...empty, error: 'too-short' };
  const em = emissions(logp, T, V, sets);
  // The Name: anything may be said there, for as long as it takes. Each of its frames counts exactly as much as the model's own
  // best reading of that frame, so it explains whatever was said in its place without favouring any word. The price: the letter
  // right before and right after it cannot be told apart from "part of what was said there", so those two are not checked.
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
    // every other letter, added up, in place of this one. A neighbour's letter does not count as "another letter" here:
    // said twice with nothing between, it is the neighbour held longer, which is the "no letter at all" case below.
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
      // which other letter: the likeliest one over the frames this position (and the gap after it) was given
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
