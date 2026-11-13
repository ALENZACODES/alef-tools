#!/usr/bin/env node
// Top-3 hit rate of the on-device search on eval/search-eval.v1.json.
//   node scripts/eval_search.mjs --index src/search [--version 1] [--near 0] [--no-vectors] [--misses] [--json out.json] [--min 85]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openIndex, search } from '../src/search.js';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const flag = (n) => process.argv.includes('--' + n);
const dir = arg('index', join(here, '..', 'src', 'search')), v = arg('version', '1');
const json = JSON.parse(readFileSync(join(dir, `index.v${v}.json`), 'utf8'));
let bin = null;
if (!flag('no-vectors')) { try { const b = readFileSync(join(dir, `index.v${v}.vec`)); bin = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } catch { /* words only */ } }
const ix = openIndex(json, bin);
const set = JSON.parse(readFileSync(arg('eval', join(here, '..', 'eval', 'search-eval.v1.json')), 'utf8'));
const near = Number(arg('near', 0));

// A word entry is expected by its lemma (the entry's link argument); everything else by id.
const argOf = new Map(json.docs.map((d) => [ix.types[d[0]].name + ':' + (d[3] ?? d[1]), ix.types[d[0]].name + ':' + d[1]]));
const out = { total: 0, hits: 0, en: { total: 0, hits: 0 }, he: { total: 0, hits: 0 }, byType: {}, missing: [], misses: [] };
for (const it of set.items) {
  const [type, key] = [it.expect.slice(0, it.expect.indexOf(':')), it.expect.slice(it.expect.indexOf(':') + 1)];
  const want = type === 'word' ? argOf.get(it.expect) : it.expect;
  const known = want && json.docs.some((d) => ix.types[d[0]].name + ':' + d[1] === want);
  if (!known) out.missing.push(it.expect);
  const res = search(ix, it.q, { limit: 3, near });
  const also = new Set((it.also || []).concat(want));
  const hit = known && res.some((r) => also.has(r.type + ':' + r.id));
  out.total++; out[it.lang].total++;
  out.byType[type] ??= { total: 0, hits: 0 }; out.byType[type].total++;
  if (hit) { out.hits++; out[it.lang].hits++; out.byType[type].hits++; } else out.misses.push({ q: it.q, expect: it.expect, got: res.map((r) => r.type + ':' + r.title) });
}
out.top3 = Math.round(1000 * out.hits / out.total) / 10;
const summary = { top3_percent: out.top3, hits: out.hits, total: out.total, english: `${out.en.hits}/${out.en.total}`, hebrew: `${out.he.hits}/${out.he.total}`, byType: out.byType, vectors: Boolean(ix.vec), near, entriesMissingFromIndex: out.missing };
console.log(JSON.stringify(summary));
if (flag('misses')) for (const m of out.misses) console.log('  miss:', m.q, '->', m.expect, '| got', m.got.join(' ; '));
if (arg('json')) writeFileSync(arg('json'), JSON.stringify({ ...summary, misses: out.misses }, null, 1) + '\n');
const min = Number(arg('min', 0));
if (min && out.top3 < min) { console.error(`top-3 hit rate ${out.top3}% is below ${min}%`); process.exit(1); }
process.exit(0);
