#!/usr/bin/env node
// Do the app's own pronunciation rules agree with the phoneme pack? Writes review/phoneme-agreement.json.
//
//   node scripts/agree_rules.mjs --app <Al-Heb checkout> --emit-words words.json        step 1: the words to ask about
//   python scripts/phonikud_words.py --tokenizer ... --phonikud ... words.json marked.json   step 2: what the pack says
//   node scripts/agree_rules.mjs --app <Al-Heb checkout> --marked marked.json            step 3: compare and write the list
//
// Words: the app's kamatz katan lists (src/pronunciation/kamatz-katan.js) and the pointed headwords of data/vocab/words.json.
// The pack is given the bare letters of each word. A word is compared only when the pack points it the way the app does
// (otherwise it read a different word), and then, letter by letter:
//   kamatz katan   the app's rule (list lookup, or U+05C7 in the text) against the pack's U+05C7
//   shva           the app's classifier (src/pronunciation/shva.js, liturgical rules) against the pack's sounded-shva mark
//   dagesh         counted over every word with the same letters, whether or not the vowels agree
// The app's shva rules describe careful synagogue reading; the pack describes everyday Israeli speech, where many of those
// shvas are silent. So a long shva list is expected: it is a list of where the two differ, not a list of mistakes.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clusters, plainPointed } from '../src/phonikud.js';
import { stripPoints, hasCantillation, guardName } from '../src/hebrew.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const app = arg('--app');
if (!app) { console.error('usage: agree_rules.mjs --app <Al-Heb checkout> (--emit-words out.json | --marked marked.json)'); process.exit(2); }
const imp = (rel) => import(pathToFileURL(join(app, rel)).href);
const kk = await imp('src/pronunciation/kamatz-katan.js');
const shva = await imp('src/pronunciation/shva.js');
const heb = await imp('src/pronunciation/hebrew.js');

const listWords = [...kk.KAMATZ_KATAN_EXCEPTIONS.map((e) => e.he), ...kk.KAMATZ_KATAN_FORMS.map((e) => e.he)];
const vocab = JSON.parse(readFileSync(join(app, 'data/vocab/words.json'), 'utf8')).words
  .map((w) => w.he).filter((he) => he && /^[א-תְ-ׇ]+$/.test(he) && !hasCantillation(he) && !guardName(he).found);
const words = [...new Set([...listWords, ...vocab])];

if (arg('--emit-words')) { writeFileSync(arg('--emit-words'), JSON.stringify(words.map(stripPoints))); console.log(`${words.length} words`); process.exit(0); }

const marked = JSON.parse(readFileSync(arg('--marked'), 'utf8'));
const fold = (s) => s.normalize('NFC').replace(/ׇ/g, 'ָ').replace(/ֺ/g, 'ֹ').replace(/[ֽ֫|]/g, '');
const sortMarks = (w) => { const cs = []; for (const ch of w) { if (ch >= 'א' && ch <= 'ת') cs.push([ch, []]); else if (cs.length) cs[cs.length - 1][1].push(ch); } return cs.map(([c, m]) => c + m.sort().join('')).join(''); };
const out = { kamatzKatan: { agree: 0, appOnly: [], packOnly: [] }, shva: { agree: 0, differ: [], byRule: {} }, dagesh: { lettersCompared: 0, same: 0, differ: [] }, wordsAsked: words.length, wordsSamePointing: 0, wordsDifferentPointing: 0, listWordsDifferentPointing: [] };

for (const w of words) {
  const m = marked[stripPoints(w)];
  if (!m) continue;
  const a = clusters(w), b = clusters(m);
  if (a.length === b.length) a.forEach((c, i) => { out.dagesh.lettersCompared++; if (c.dagesh === b[i].dagesh) out.dagesh.same++; else if (out.dagesh.differ.length < 300) out.dagesh.differ.push({ word: w, pack: plainPointed(m), letter: i, app: c.dagesh, packHas: b[i].dagesh }); });
  if (sortMarks(fold(w)) !== sortMarks(fold(plainPointed(m)))) { out.wordsDifferentPointing++; if (listWords.includes(w)) out.listWordsDifferentPointing.push({ word: w, pack: plainPointed(m) }); continue; }
  out.wordsSamePointing++;
  // kamatz katan
  const start = kk.kamatzKatanStemStart(w);
  const appKK = new Set();
  a.forEach((c, i) => { if (c.vowel === 'ׇ') appKK.add(i); });
  if (start >= 0) { const i = a.findIndex((c, k) => k >= start && (c.vowel === 'ָ' || c.vowel === 'ׇ')); if (i >= 0) appKK.add(i); }
  const packKK = new Set(); b.forEach((c, i) => { if (c.vowel === 'ׇ') packKK.add(i); });
  for (let i = 0; i < a.length; i++) {
    if (appKK.has(i) && packKK.has(i)) out.kamatzKatan.agree++;
    else if (appKK.has(i)) out.kamatzKatan.appOnly.push({ word: w, letter: i, pack: plainPointed(m) });
    else if (packKK.has(i)) out.kamatzKatan.packOnly.push({ word: w, letter: i, pack: plainPointed(m) });
  }
  // shva
  let verdicts;
  try { verdicts = shva.classifyShvas(heb.parseWord(w)); } catch { continue; }
  for (const [i, v] of verdicts) {
    if (!b[i] || b[i].vowel !== 'ְ') continue;
    const packNa = b[i].vocalShva;
    const r = (out.shva.byRule[v.rule] ||= { agree: 0, differ: 0 });
    if (packNa === v.na) { out.shva.agree++; r.agree++; }
    else { r.differ++; if (out.shva.differ.length < 600) out.shva.differ.push({ word: w, letter: i, app: v.na ? 'sounded' : 'silent', rule: v.rule, pack: packNa ? 'sounded' : 'silent' }); }
  }
}
out.shva.differCount = Object.values(out.shva.byRule).reduce((n, r) => n + r.differ, 0);
out.note = 'Where the app\'s own rules and the phoneme pack differ. Nothing in the app was changed. The shva list is long by design: the app\'s rules are for careful synagogue reading, the pack marks everyday Israeli speech.';
const dest = arg('--out') || join(dirname(fileURLToPath(import.meta.url)), '..', 'review', 'phoneme-agreement.json');
writeFileSync(dest, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ same: out.wordsSamePointing, different: out.wordsDifferentPointing, kk: [out.kamatzKatan.agree, out.kamatzKatan.appOnly.length, out.kamatzKatan.packOnly.length], shva: [out.shva.agree, out.shva.differCount], dagesh: [out.dagesh.same, out.dagesh.lettersCompared] }));
