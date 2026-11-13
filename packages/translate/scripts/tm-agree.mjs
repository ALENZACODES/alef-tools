#!/usr/bin/env node
// Second opinion for machine-made translation-memory entries: the ordinary Hebrew to English pack translates the same sentences.
//   node scripts/tm-agree.mjs <cache.json> --packs <packs dir> --ort <runtime dir> [--pack he-en]
// Run between the two passes of scripts/build-tm.py: the first pass (--hq --back --cache) translates, this adds "second" to each
// cache row, the next pass applies every check. An entry is kept only when the two models broadly agree (scripts/tm_gates.py).
import { readFileSync, writeFileSync } from 'node:fs';
import { loadPack } from './node-runtime.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const packs = flag('--packs', ''), ort = flag('--ort', ''), name = flag('--pack', 'he-en'); const file = args[0];
if (!file || !packs || !ort) { console.error('usage: tm-agree.mjs <cache.json> --packs <dir> --ort <dir> [--pack he-en]'); process.exit(2); }
const cache = JSON.parse(readFileSync(file, 'utf8')); const rt = await loadPack({ packs, ort, name });
let n = 0;
for (const [key, row] of Object.entries(cache)) { if (row.second === undefined) { row.second = await rt.translate(key, { beams: 2 }); n++; } }
writeFileSync(file, JSON.stringify(cache, null, 0) + '\n');
console.log(`second opinion from ${name}: ${n} new of ${Object.keys(cache).length}`);
