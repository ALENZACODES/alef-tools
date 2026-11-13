#!/usr/bin/env node
// Scores one pack alone on a test file, with the code that ships and the runtime the browser uses. No network, nothing installed.
//   node scripts/score.mjs <fixture.json> --packs <packs dir> --ort <runtime dir> [--pack he-en-hq] [--beams 2] [--device wasm|float] [--out file.json] [-v]
// The fixture is {samples:[{id, direction, source, reference, accept?:[...]}]}. Lines of the other direction are skipped when --pack is given;
// without --pack each line goes to the pack named after its direction.
// Prints, per direction: the house score against the first-choice wording, against the accepted wordings, and chrF.
// What the app shows also passes through its stored lines and its own tidy-up; the app repo scores that (tools/talk/nmt/score.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { loadPack, readPack } from './node-runtime.mjs';
import { strictScore, acceptedScore, summarize } from '../src/scoring.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const packs = flag('--packs', ''), ort = flag('--ort', ''), only = flag('--pack', ''), beams = Number(flag('--beams', '2')), device = flag('--device', 'wasm'), outFile = flag('--out', '');
const verbose = args.includes('-v'); const file = args.find((a) => !a.startsWith('-'));
if (!file || !packs || !ort) { console.error('usage: score.mjs <fixture.json> --packs <dir> --ort <dir> [--pack name] [--beams n] [--device wasm|float] [--out file] [-v]'); process.exit(2); }

const fixture = JSON.parse(readFileSync(file, 'utf8'));
const onlyDirection = only ? readPack(packs, only).direction : '';
const loaded = {}; const rows = []; const t0 = Date.now();
for (const s of fixture.samples) {
  if (only && s.direction !== onlyDirection) continue;
  const name = only || s.direction;
  const rt = (loaded[name] ||= await loadPack({ packs, ort, name, device }));
  const hyp = await rt.translate(s.source, { beams });
  const row = { id: s.id, direction: s.direction, source: s.source, translation: hyp, reference: s.reference, ok: !!hyp, method: 'model', strict: Number(strictScore(hyp, s).toFixed(4)), accepted: Number(acceptedScore(hyp, s).toFixed(4)) };
  rows.push(row);
  if (verbose && row.accepted < 1) console.log(`${row.accepted.toFixed(2)}  ${s.id}  ${s.source}  =>  ${hyp}  | ref: ${s.reference}`);
}
const sum = { file, pack: only || 'by direction', device, beams, ...summarize(rows), secondsPerLine: Number(((Date.now() - t0) / 1000 / Math.max(1, rows.length)).toFixed(2)) };
console.log(JSON.stringify(sum));
if (outFile) writeFileSync(outFile, JSON.stringify({ schema: 'alef.translate.score.v1', summary: sum, rows }, null, 1) + '\n');
