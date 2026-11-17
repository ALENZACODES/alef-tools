#!/usr/bin/env node
// Collects every piece of Hebrew a learner can tap in the course, by unit, ready for the offline analysis.
// Usage: node collect_text.mjs --app /path/to/Al-Heb --out work/segments.json
//
// Units (one output file each, later): every lesson in data/curriculum/lessons.json (with the body in
// data/curriculum/lessons-intermediate/<id>.json where there is one, and the prayer or Torah lines it names from
// data/corpus/registry.json), every practical unit (data/curriculum/practical/pu-*.json) and every dialogue.
// Any string value that holds Hebrew is taken, whatever its key, and cut into stretches of Hebrew (src/text.js).
// The four-letter Name is replaced before anything is written; it is never analysed.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { segments, forModel, contextKey } from '../src/text.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const app = arg('--app'), out = arg('--out');
if (!app || !out) { console.error('usage: collect_text.mjs --app <Al-Heb checkout> --out <segments.json>'); process.exit(2); }
const read = (rel) => JSON.parse(readFileSync(join(app, rel), 'utf8'));
const HEB = /[א-ת]/u;

function strings(x, acc = []) {
  if (typeof x === 'string') { if (HEB.test(x)) acc.push(x); } else if (Array.isArray(x)) x.forEach((y) => strings(y, acc)); else if (x && typeof x === 'object') Object.values(x).forEach((y) => strings(y, acc));
  return acc;
}

/** @type {Record<string, {title:string, kind:string, strings:string[]}>} */
const units = {};
const registry = read('data/corpus/registry.json');
const regById = new Map((Array.isArray(registry) ? registry : registry.entries || registry.texts || []).map((e) => [e.id, e]));
for (const lesson of read('data/curriculum/lessons.json').lessons) {
  const all = strings(lesson);
  const body = join('data/curriculum/lessons-intermediate', `${lesson.id}.json`);
  if (existsSync(join(app, body))) strings(read(body), all);
  for (const id of lesson.prayerLines || []) { const e = regById.get(typeof id === 'string' ? id : id?.id); if (e?.he) all.push(e.he); }
  units[lesson.id] = { title: lesson.title, kind: 'lesson', strings: all };
}
for (const f of readdirSync(join(app, 'data/curriculum/practical')).filter((n) => /^pu-.*\.json$/.test(n)).sort()) {
  const u = read(join('data/curriculum/practical', f));
  units[u.id || f.replace(/\.json$/, '')] = { title: u.title || '', kind: 'practical', strings: strings(u) };
}
for (const d of read('data/curriculum/dialogues.json').dialogues) units[d.id] = { title: d.title, kind: 'dialogue', strings: strings(d) };

/** @type {Record<string, {text:string, model:string, words:any[]}>} */
const segs = {};
const outUnits = {};
let nameCount = 0;
for (const [id, u] of Object.entries(units)) {
  const keys = new Set();
  for (const s of u.strings) for (const seg of segments(s)) {
    const key = contextKey(seg.text);
    if (!segs[key]) {
      const m = forModel(seg.text);
      nameCount += m.words.filter((w) => w.name).length;
      // `model` is what the model reads (unpointed, full spelling, Name replaced); `shown` is each word as the lesson shows it
      segs[key] = { model: m.model, words: m.words.map((w) => ({ key: w.key, shown: w.shown.normalize('NFC'), start: w.start, end: w.end, ...(w.name ? { name: true } : {}) })) };
    }
    keys.add(key);
  }
  outUnits[id] = { title: u.title, kind: u.kind, segments: [...keys] };
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ schema: 'alef.morph.segments/1', units: outUnits, segments: segs }));
const nWords = Object.values(segs).reduce((a, s) => a + s.words.length, 0);
console.log(JSON.stringify({ units: Object.keys(outUnits).length, segments: Object.keys(segs).length, words: nWords, nameWordsReplaced: nameCount }));
