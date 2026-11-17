// @ts-check
// Plain-English notes for one analysed word. Pure: no DOM, no network.
// Every sentence here is fixed text with a slot or two, written to be read by a beginner: short, no grammar terms
// without their meaning beside them, at most 25 words. lint() is the check for that, and tests/explain.test.js runs
// it over every note that can be produced from the built lesson data.

/** What a prefix letter adds, in everyday words. */
export const PREFIX_MEANING = Object.freeze({
  'ו': 'and', 'ה': 'the', 'ב': 'in, at or with', 'ל': 'to or for', 'מ': 'from', 'ש': 'that or which', 'כ': 'like or as',
  'כש': 'when', 'מש': 'from when, or than', 'לכש': 'when, later on', 'בש': 'in that', 'לש': 'to that',
});
const KIND = Object.freeze({
  NOUN: 'Noun (a thing, person or idea)', PROPN: 'Name', VERB: 'Verb (an action word)', AUX: 'Helping verb', ADJ: 'Adjective (a describing word)',
  ADV: 'Adverb (says how, when or where)', ADP: 'Preposition (a small linking word such as in, on, with)', PRON: 'Pronoun (stands in for a noun)',
  CCONJ: 'Linking word', SCONJ: 'Linking word', NUM: 'Number', DET: 'Pointing word (such as this, every, some)', INTJ: 'Exclamation',
});
const LIST_KIND = Object.freeze({ noun: 'NOUN', verb: 'VERB', adj: 'ADJ', adv: 'ADV', prep: 'ADP', pron: 'PRON', conj: 'CCONJ', num: 'NUM', intj: 'INTJ', det: 'DET' });
const GENDER = Object.freeze({ m: 'masculine', f: 'feminine', mf: 'masculine or feminine' });
const NUMBER = Object.freeze({ sg: 'singular (one)', pl: 'plural (more than one)', du: 'dual (a pair)', 'sg/pl': 'singular or plural', 'du/pl': 'dual or plural' });
const TENSE = Object.freeze({ past: 'past', future: 'future', present: 'present', command: 'command form' });
const NAME_KIND = Object.freeze({ PER: 'A person’s name.', GPE: 'A place name.', LOC: 'A place name.', ORG: 'The name of an organisation.', FAC: 'The name of a building or site.' });

/** Shown alone when a word could not be worked out at all. */
export const NOTHING = 'Nothing could be worked out for this word. It may be Aramaic or a rare form.';

/** Who a verb form is about: person, gender, number -> an English pronoun. */
export function whoOf(person, gender, number) {
  const pl = number === 'pl';
  if (person === '1') return pl ? 'we' : 'I';
  if (person === '2') return pl ? (gender === 'f' ? 'you (a group of women)' : 'you (a group)') : (gender === 'f' ? 'you (to a woman)' : gender === 'm' ? 'you (to a man)' : 'you');
  if (person === '3') return pl ? (gender === 'f' ? 'they (women)' : 'they') : (gender === 'f' ? 'she' : gender === 'm' ? 'he' : 'he or she');
  return '';
}
const OWNER = { I: 'my', we: 'our', he: 'his', she: 'her', they: 'their', 'they (women)': 'their', 'he or she': 'his or her' };
const OBJECT = { I: 'me', we: 'us', he: 'him', she: 'her', they: 'them', 'they (women)': 'them', 'he or she': 'him or her' };

/** The single prefixes of a prefix string, longest first at each step: "וכשה" -> ["ו", "כש", "ה"]. */
export function prefixParts(prefix) {
  const out = []; let s = String(prefix || '');
  const known = Object.keys(PREFIX_MEANING).sort((a, b) => b.length - a.length);
  while (s) { const p = known.find((k) => s.startsWith(k)); if (!p) break; out.push(p); s = s.slice(p.length); }
  return out;
}

/**
 * @typedef {{l?:string|null, p?:string, s?:string|null, g?:string, n?:string, r?:string, t?:string, sf?:{g?:string,n?:string,r?:string}, dt?:number, e?:string, d?:string, how?:string}} Analysis
 * @typedef {{he:string, en:string, pos:string, gender?:string|null, root?:string|null, binyan?:string|null, rootChecked?:boolean}} Entry
 * @typedef {{id:string, label:string, text:string, he?:string}} Line
 */

/**
 * The lines of a word card, in the order they are shown.
 * @param {Analysis} a @param {Entry|null} [entry]  the app's word-list entry the word was linked to, if any
 * @returns {Line[]}
 */
export function describe(a, entry = null) {
  /** @type {Line[]} */ const lines = [];
  if (entry) lines.push({ id: 'form', label: 'Dictionary form', he: entry.he, text: entry.en });
  else if (a.l) lines.push({ id: 'form', label: 'Dictionary form', he: a.l, text: 'Worked out from the sentence, not looked up. It may be wrong.' });

  const parts = prefixParts(a.p);
  if (parts.length) {
    const said = parts.map((p) => `${p}־ (“${PREFIX_MEANING[p]}”)`);
    const front = said.length === 1 ? said[0] : `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}`;
    lines.push({ id: 'prefix', label: 'In front', text: `${front} ${said.length === 1 ? 'is' : 'are'} joined to the front of the word.` });
    if (a.dt) lines.push({ id: 'the', label: 'Hidden “the”', text: 'The first letter also carries “the”: the vowel under it changes and no ה is written.' });
  }

  const kind = a.s ? KIND[a.s] : (entry && LIST_KIND[entry.pos] ? KIND[LIST_KIND[entry.pos]] : null);
  if (kind && a.s !== 'PROPN') {
    const bits = [];
    const verb = a.s === 'VERB' || a.s === 'AUX';
    if (verb) {
      if (a.t) bits.push(TENSE[a.t]);
      const who = a.t === 'present' ? '' : whoOf(a.r, a.g, a.n);
      if (who) bits.push(`said of “${who}”`);
      else { if (a.g && GENDER[a.g]) bits.push(GENDER[a.g]); if (a.n && NUMBER[a.n]) bits.push(NUMBER[a.n]); }
    } else {
      const g = (entry && entry.pos === 'noun' && entry.gender && GENDER[entry.gender]) || (a.g && GENDER[a.g]);
      if (g && ['NOUN', 'ADJ', 'NUM', 'PRON', 'DET', undefined, null].includes(a.s)) bits.push(g);
      if (a.n && NUMBER[a.n] && ['NOUN', 'ADJ', 'PRON'].includes(String(a.s))) bits.push(NUMBER[a.n]);
    }
    lines.push({ id: 'kind', label: 'Kind of word', text: `${kind}${bits.length ? `: ${bits.join(', ')}` : ''}.` });
  }

  if (a.sf) {
    const who = whoOf(a.sf.r || '3', a.sf.g, a.sf.n);
    const base = who.replace(/ \(.*\)$/, '');
    const word = a.s === 'NOUN' ? (OWNER[who] || (base === 'you' ? 'your' : '')) : (OBJECT[who] || (base === 'you' ? 'you' : ''));
    if (word) lines.push({ id: 'ending', label: 'Ending', text: `The ending means “${word}”${who !== base ? ` ${who.slice(base.length + 1)}` : ''}.` });
  }

  if (a.e && NAME_KIND[a.e]) lines.push({ id: 'name', label: 'Name', text: NAME_KIND[a.e] });

  if (entry?.root) {
    lines.push(entry.rootChecked
      ? { id: 'root', label: 'Root', he: entry.root, text: 'The root: the core letters this word is built on.' }
      : { id: 'root', label: 'Family letters', he: entry.root, text: 'Other words are built on these letters too. Not yet checked by a teacher.' });
  }
  if (entry?.binyan) lines.push({ id: 'pattern', label: 'Verb pattern', text: `Verb pattern (binyan): ${entry.binyan}.` });
  // a word nothing could be said about (a few Aramaic prayer words): say so instead of showing an empty card
  if (!lines.length) lines.push({ id: 'none', label: 'Notes', text: NOTHING });
  return lines;
}

/**
 * One short grammar note for a lesson, built from a sentence's analysed words: the first thing worth pointing out.
 * @param {{shown:string, a:Analysis, entry?:Entry|null}[]} wordsInSentence
 * @returns {{id:string, text:string, he:string}|null}
 */
export function lessonNote(wordsInSentence) {
  for (const w of wordsInSentence) {
    const parts = prefixParts(w.a.p);
    if (w.a.dt) return { id: 'hidden-the', he: w.shown, text: `Here ${parts[parts.length - 1]}־ also carries “the”: the vowel under it changes and no ה is written.` };
  }
  for (const w of wordsInSentence) {
    const parts = prefixParts(w.a.p);
    if (parts.length >= 2) return { id: 'stacked', he: w.shown, text: `Small words pile up in front: ${parts.map((p) => `${p}־ (“${PREFIX_MEANING[p]}”)`).join(' then ')}, then the word itself.` };
  }
  for (const w of wordsInSentence) {
    if (w.a.sf && w.a.s === 'NOUN') { const who = whoOf(w.a.sf.r || '3', w.a.sf.g, w.a.sf.n); const own = OWNER[who] || (who.startsWith('you') ? 'your' : ''); if (own) return { id: 'ending', he: w.shown, text: `Hebrew adds “${own}” to the end of the noun instead of using a separate word.` }; }
  }
  for (const w of wordsInSentence) {
    const parts = prefixParts(w.a.p);
    if (parts.length === 1 && parts[0] !== 'ה') return { id: 'prefix', he: w.shown, text: `${parts[0]}־ (“${PREFIX_MEANING[parts[0]]}”) is not a separate word in Hebrew. It is joined to the front of the next word.` };
  }
  return null;
}

// ---- the copy check -------------------------------------------------------------------------------------------------

/** Grammar terms a beginner may not know. Allowed only with their meaning in the same note. */
const TERMS = ['binyan', 'mishkal', 'shoresh', 'lemma', 'smichut', 'construct', 'participle', 'infinitive', 'proclitic', 'enclitic', 'morpheme', 'definite article', 'conjugation', 'inflect', 'suffix', 'prefix', 'gerund', 'jussive', 'cohortative'];
/** Phrases that make a note sound machine-written or that mention how the note was made. None may appear. */
const STOCK = ['delve', 'worth noting', 'important to note', 'note that', 'in conclusion', 'in summary', 'furthermore', 'moreover', 'leverage', 'tapestry', 'seamless', 'robust', 'utilize', 'utilise', 'crucial', 'essentially', 'it is important', 'plays a key role', 'rich history', 'navigate the', 'let’s explore', "let's explore", 'unlock', 'dive into', 'as an', 'language model'];
const MAKER = /\b(ai|a\.i\.|artificial intelligence|machine|model|algorithm|neural|bert|llm|generated|predict(?:s|ed|ion)?)\b/i;

/** @returns {string[]} what is wrong with a note; empty when it passes */
export function lint(text) {
  const problems = [];
  const s = String(text ?? '');
  const english = s.replace(/[֐-׿־]+/gu, ' ');
  const count = english.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  if (count > 25) problems.push(`too long: ${count} words`);
  if (!count) problems.push('empty');
  const low = english.toLowerCase();
  for (const p of STOCK) if (low.includes(p)) problems.push(`stock phrase: ${p}`);
  if (MAKER.test(english)) problems.push('mentions how it was made');
  for (const t of TERMS) {
    if (!new RegExp(`\\b${t}`, 'i').test(english)) continue;
    // a term is fine when its meaning is beside it: "Verb pattern (binyan)", "binyan (verb pattern)"
    if (!new RegExp(`\\(${t}\\)|${t}[a-z]*\\s*\\(`, 'i').test(english)) problems.push(`term without its meaning: ${t}`);
  }
  if (/\s{2,}/.test(s) || s !== s.trim()) problems.push('spacing');
  if (/undefined|null|NaN|\$\{/.test(s)) problems.push('unfilled slot');
  if (!/[.!?”]$/.test(s)) problems.push('no full stop');
  return problems;
}
