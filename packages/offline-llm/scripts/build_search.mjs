#!/usr/bin/env node
// Build src/search/index.v<N>.json and .vec (entry vectors) from work/search.docs.json (scripts/embed.py). Uses the same tokeniser as the
// runtime (src/search.js), so what is indexed is exactly what a query is split into.
//   node scripts/build_search.mjs --work work --out src/search --version 1 [--no-extra] [--no-wordings]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tokens, heForms } from '../src/search.js';

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i < 0 ? dflt : process.argv[i + 1]; };
const flag = (name) => process.argv.includes('--' + name);
const work = arg('work', 'work'), out = arg('out', 'src/search'), version = Number(arg('version', 1));
const src = JSON.parse(readFileSync(join(work, 'search.docs.json'), 'utf8'));

const TYPES = [
  { name: 'ask', href: '#/ask?q={}' },
  { name: 'lesson', href: '#/learn?lesson={}' },
  { name: 'unit', href: '#/practical/{}' },
  { name: 'word', href: '#/vocab?q={}' },
];
const NAME_KEYS = new Set(['\u05D9\u05D4\u05D5\u05D4', '\u05D9\u05D4\u05D4']);
const typeIx = Object.fromEntries(TYPES.map((t, i) => [t.name, i]));

// Term weights per entry: title words count most, then the entry's other wordings, then the words the build attached to it
// (Hebrew wordings that passed the gate; dictionary words kept only where the entry vectors agree; see scripts/embed.py).
const N = src.docs.length;
const perDoc = src.docs.map((d) => {
  const w = new Map();
  const add = (text, weight, heShort = false) => {
    for (const t of tokens(text)) {
      const forms = heShort && /[א-ת]/.test(t) ? heForms(t) : [t];
      forms.forEach((f, i) => w.set(f, Math.max(w.get(f) || 0, i ? weight * 0.7 : weight)));
    }
  };
  add(d.title, 1, true);
  add(d.text || '', 0.6, true);
  // exact-word keys for dictionary entries: the lemma, and each one-word sense of the gloss
  if (d.type === 'word') for (const k of d.exact || []) for (const t of tokens(k)) w.set('=' + t, 1);
  if (!flag('no-wordings')) for (const s of d.wordings || []) add(s, 0.8, true);
  if (!flag('no-extra')) for (const [term, score] of d.extra || []) add(term, Math.min(0.7, Math.max(0.3, score)), true);
  return w;
});
const df = new Map();
for (const w of perDoc) for (const t of w.keys()) df.set(t, (df.get(t) || 0) + 1);
// A term in more than a quarter of all entries tells nothing apart; drop it.
const post = new Map();
perDoc.forEach((w, i) => {
  for (const [t, weight] of w) {
    if (df.get(t) > N / 4 && !t.startsWith('=')) continue;
    if (NAME_KEYS.has(t.replace(/^[=~]/, ''))) continue; // the Name is never an index term, in any spelling the tokeniser produces
    if (!post.has(t)) post.set(t, []);
    post.get(t).push([i, Math.max(1, Math.min(9, Math.round(weight * 9)))]);
  }
});
const names = [...post.keys()].sort();
const packed = names.map((t) => { let prev = 0; const a = []; for (const [i, q] of post.get(t)) { a.push(i - prev, q); prev = i; } return a; });

const json = {
  schema: 'alef-search/1', version, built: src.built, entries: N, types: TYPES, dims: src.dims || 0, vectorModel: src.model || null,
  docs: src.docs.map((d) => [typeIx[d.type], d.id, d.title, d.arg ?? null].filter((x, i) => i < 3 || x !== null)),
  terms: names.join('\n'), post: packed,
};
mkdirSync(out, { recursive: true });
const body = JSON.stringify(json);
writeFileSync(join(out, `index.v${version}.json`), body + '\n');
let binBytes = 0;
if (src.dims && src.vectors_b64) {
  const bin = Buffer.from(src.vectors_b64, 'base64');
  if (bin.length !== N * src.dims) throw new Error(`vector file has ${bin.length} bytes, expected ${N * src.dims}`);
  writeFileSync(join(out, `index.v${version}.vec`), bin);
  binBytes = bin.length;
}
console.log(JSON.stringify({ entries: N, terms: names.length, jsonBytes: Buffer.byteLength(body) + 1, binBytes, totalBytes: Buffer.byteLength(body) + 1 + binBytes }));
