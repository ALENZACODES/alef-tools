#!/usr/bin/env node
// Scores the letter check (src/ctc.js + src/score.js) on recordings with known text.
//
// There is no public set of Hebrew learner recordings with each wrong letter marked, so this script makes a stand-in:
// it takes a recording that was read correctly and changes letters in the EXPECTED text. At a changed letter the speaker
// "said the wrong sound" as far as the check can tell, and everywhere else the speaker was right. The check should mark the
// changed letters and leave the rest alone. Two kinds of change are scored: "near" (a sound learners really confuse, such as
// resh for lamed) and "far" (any other consonant). This measures whether the check can tell letters apart in real speech.
// It does not measure how it treats a learner's accent; that needs recordings from learners who agreed to it.
//
//   node scripts/eval-pron.mjs --model <file.onnx> --vocab <vocab.json> --set eval/fleurs-he-dev.json --audio <dir> \
//        [--subset short|all] [--limit N] [--cache <dir>] [--margin N] [--drop-margin N] [--sweep] [--calibrate] [--out eval/results/<name>.json] [--ort <path>]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { createCtc, MIN_SAMPLES } from '../src/ctc.js';
import { wavToPcm, trimSilence } from '../src/audio.js';
import { scoreUtterance, expectedUnits, DEFAULT_MARGIN, DEFAULT_DROP_MARGIN } from '../src/score.js';
import { errorRates } from './metrics.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const flag = (name) => process.argv.includes(`--${name}`);
const modelFile = arg('model'), setFile = arg('set'), audio = arg('audio');
if (!modelFile || !setFile || !audio) { console.error('usage: eval-pron.mjs --model <onnx> --vocab <json> --set <json> --audio <dir>'); process.exit(2); }
const vocab = JSON.parse(readFileSync(arg('vocab', join(dirname(modelFile), 'vocab.json')), 'utf8'));
const set = JSON.parse(readFileSync(setFile, 'utf8'));
const subset = arg('subset', 'all');
let items = set.items.filter((it) => subset === 'all' || it.subset === subset).filter((it) => existsSync(join(audio, it.file)));
const limit = Number(arg('limit', 0)); if (limit) items = items.slice(0, limit);
const cache = arg('cache'); if (cache) mkdirSync(cache, { recursive: true });

let ctc = null;
const blankId = vocab['[PAD]'];
async function heardFor(it) {
  const f = cache && join(cache, `${it.id}.bin`);
  if (f && existsSync(f)) { const b = readFileSync(f); const head = new Int32Array(b.buffer, b.byteOffset, 2); return { T: head[0], V: head[1], logp: new Float32Array(b.buffer.slice(b.byteOffset + 8)) }; }
  if (!ctc) { const require = createRequire(resolve(arg('ort', process.cwd())) + '/'); const ort = require('onnxruntime-node'); ctc = await createCtc({ ort, model: modelFile, vocab, sessionOptions: { executionProviders: ['cpu'], graphOptimizationLevel: 'all', logSeverityLevel: 3 } }); }
  const cut = trimSilence(wavToPcm(readFileSync(join(audio, it.file))));
  if (!cut.speech || cut.pcm.length < MIN_SAMPLES) return null; // the app would say "nothing was heard"
  const h = await ctc.posteriors(cut.pcm);
  if (f) { const out = Buffer.alloc(8 + h.logp.byteLength); out.writeInt32LE(h.T, 0); out.writeInt32LE(h.V, 4); Buffer.from(h.logp.buffer, h.logp.byteOffset, h.logp.byteLength).copy(out, 8); writeFileSync(f, out); }
  return h;
}

// a small repeatable random source, so the same letters are changed on every run
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const NEAR = { 'ר': 'ל', 'ל': 'ר', 'ח': 'ק', 'ק': 'ג', 'ג': 'ק', 'ד': 'ת', 'ת': 'ד', 'ט': 'ד', 'פ': 'ב', 'ז': 'ס', 'ס': 'ז', 'צ': 'ס', 'ש': 'ז', 'מ': 'נ', 'נ': 'מ' };
const FAR = [...'גדזחטלמנסצקרשת'];
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

/** Changes about one checked letter in `every`; returns the new text and the positions changed. */
function corrupt(text, kind, rand, every = 8) {
  const { units } = expectedUnits(text);
  const chars = [...text]; // the sets have no characters outside the basic plane, so positions match
  const changed = new Set();
  for (const u of units) {
    if (!u.scored || rand() > 1 / every) continue;
    const base = FINALS[u.ch] || u.ch;
    let to = kind === 'near' ? NEAR[base] : FAR[Math.floor(rand() * FAR.length)];
    if (!to) continue;
    // the new letter must be one the check scores, and must not sound like what was really said
    const trial = [...chars]; trial[u.index] = to;
    const nu = expectedUnits(trial.join('')).units.find((x) => x.index === u.index);
    if (!nu || !nu.scored || nu.accept === 'any' || nu.accept.includes(base) || u.accept.includes(to)) continue;
    chars[u.index] = to; changed.add(u.index);
  }
  return { text: chars.join(''), changed };
}

const heard = []; const reads = [];
let noSpeech = 0;
{ const kept = []; for (const [n, it] of items.entries()) { const h = await heardFor(it); if (h) { heard.push(h); kept.push(it); } else noSpeech++; if ((n + 1) % 20 === 0) console.error(`listened ${n + 1}/${items.length}`); } items = kept; }
if (ctc) { for (const [n, it] of items.entries()) reads.push({ ref: it.text, hyp: ctc.read(heard[n]) }); }

// Every checked letter of every line, scored once: {n: line number, wrong: was it changed, m: its margin}.
// The margin does not depend on where the line is drawn, so any threshold can be tried afterwards without scoring again.
const model = { vocab, blankId };
function collect(kind) {
  const rand = rng(kind === 'near' ? 20261112 : 20261113);
  const out = []; let failed = 0;
  for (const [n, it] of items.entries()) {
    const c = kind === 'clean' ? { text: it.text, changed: new Set() } : corrupt(it.text, kind, rand);
    const r = scoreUtterance(heard[n], model, c.text);
    if (!r.ok) { failed++; continue; }
    for (const l of r.letters) if (l.status !== 'skip') out.push({ n, wrong: c.changed.has(l.index), m: l.margin, d: l.drop });
  }
  return { letters: out, failed };
}
const data = { clean: collect('clean'), near: collect('near'), far: collect('far') };
console.error('scored', Object.entries(data).map(([k, v]) => `${k}: ${v.letters.length} letters`).join(', '));

function run(margin, drop, keep = () => true) {
  const out = {};
  const clean = data.clean.letters.filter((l) => keep(l.n));
  const marked = clean.filter((l) => l.m < margin || l.d < drop).length;
  out.clean = { letters: clean.length, marked, falseAlarmRate: +(marked / (clean.length || 1)).toFixed(4), linesNotScored: data.clean.failed };
  for (const kind of ['near', 'far']) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const l of data[kind].letters) { if (!keep(l.n)) continue; const flagged = l.m < margin || l.d < drop; if (l.wrong && flagged) tp++; else if (l.wrong) fn++; else if (flagged) fp++; else tn++; }
    const p = tp / (tp + fp || 1), rc = tp / (tp + fn || 1);
    out[kind] = { wrongLetters: tp + fn, rightLetters: fp + tn, precision: +p.toFixed(4), recall: +rc.toFixed(4), f1: +((2 * p * rc) / (p + rc || 1)).toFixed(4) };
  }
  return out;
}

const margin = Number(arg('margin', DEFAULT_MARGIN)), drop = Number(arg('drop-margin', DEFAULT_DROP_MARGIN));
const report = { set: set.id, subset, lines: items.length, linesWithNoSpeech: noSpeech, model: modelFile.split('/').pop(), margin, dropMargin: drop, ...run(margin, drop) };
if (reads.length) { const e = errorRates(reads); report.plainReading = { cer: +e.cer.toFixed(4), wer: +e.wer.toFixed(4) }; }
const GRID = [-12, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0], DROPS = [-1e9, -30, -24, -20, -16, -14, -12, -10, -8, -6];
if (flag('sweep')) report.sweep = GRID.flatMap((m) => DROPS.map((d) => ({ margin: m, dropMargin: d <= -1e8 ? 'never' : d, ...run(m, d) })));
if (flag('calibrate')) {
  // choose the two margins on the even-numbered lines, report them on the odd-numbered ones (lines the choice never saw)
  const even = (n) => n % 2 === 0, odd = (n) => n % 2 === 1;
  let best = [GRID[0], DROPS[0]], top = -1;
  for (const m of GRID) for (const d of DROPS) { const r = run(m, d, even); const f = Math.min(r.near.f1, r.far.f1); if (f > top) { top = f; best = [m, d]; } }
  report.shippedDefaultsOnHeldOut = { margin: DEFAULT_MARGIN, dropMargin: DEFAULT_DROP_MARGIN, heldOut: 'odd lines', ...run(DEFAULT_MARGIN, DEFAULT_DROP_MARGIN, odd) };
  report.calibrated = { chosenOn: 'even lines', margin: best[0], dropMargin: best[1] <= -1e8 ? 'never' : best[1], heldOut: 'odd lines', ...run(best[0], best[1], odd) };
}
console.log(JSON.stringify(report, null, 1));
const out = arg('out'); if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 1) + '\n'); }
await ctc?.release();
