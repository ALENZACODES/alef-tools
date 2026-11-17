#!/usr/bin/env node
// Scores a listening model on a set of recordings with known text: character and word error rates.
// It runs the same code the app runs (src/whisper.js, src/mel.js, src/audio.js), with onnxruntime-node in place of the browser runtime.
//
//   node scripts/eval.mjs --model <dir> --encoder <file> --decoder <file> --set eval/fleurs-he-dev.json --audio <dir of wav> \
//        [--subset short|all] [--limit N] [--half] [--no-hebrew-only] [--out eval/results/<name>.json] [--ort <path to onnxruntime-node>]
//
// <dir> holds vocab.json, added_tokens.json, config.json and generation_config.json next to the two graphs.
// Nothing is uploaded: the model files and the recordings are read from disk.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { createWhisper } from '../src/whisper.js';
import { wavToPcm } from '../src/audio.js';
import { errorRates, normalizeText } from './metrics.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const flag = (name) => process.argv.includes(`--${name}`);
const model = arg('model'), setFile = arg('set'), audio = arg('audio');
if (!model || !setFile || !audio) { console.error('usage: eval.mjs --model <dir> --encoder <file> --decoder <file> --set <json> --audio <dir>'); process.exit(2); }
const require = createRequire(resolve(arg('ort', process.cwd())) + '/');
const ort = require('onnxruntime-node');
const j = (f) => JSON.parse(readFileSync(join(model, f), 'utf8'));
const set = JSON.parse(readFileSync(setFile, 'utf8'));
const subset = arg('subset', 'all');
let items = set.items.filter((it) => subset === 'all' || it.subset === subset).filter((it) => existsSync(join(audio, it.file)));
const limit = Number(arg('limit', 0)); if (limit) items = items.slice(0, limit);
if (!items.length) { console.error('no recordings found in', audio); process.exit(1); }

const whisper = await createWhisper({
  ort, encoder: join(model, arg('encoder', 'encoder.onnx')), decoder: join(model, arg('decoder', 'decoder.onnx')),
  vocab: j('vocab.json'), added: j('added_tokens.json'), config: j('config.json'), generation: j('generation_config.json'),
  half: flag('half'), sessionOptions: { executionProviders: ['cpu'], graphOptimizationLevel: 'all', logSeverityLevel: 3 },
});
const pairs = []; let audioMs = 0, runMs = 0;
for (const [n, it] of items.entries()) {
  const pcm = wavToPcm(readFileSync(join(audio, it.file)));
  const t0 = performance.now();
  const r = await whisper.transcribe(pcm, { hebrewOnly: !flag('no-hebrew-only') });
  runMs += performance.now() - t0; audioMs += pcm.length / 16;
  pairs.push({ id: it.id, ref: it.text, hyp: r.text, confidence: +r.confidence.toFixed(3) });
  if ((n + 1) % 20 === 0) console.error(`${n + 1}/${items.length}`, JSON.stringify(errorRates(pairs)));
}
const rates = errorRates(pairs);
const report = {
  set: set.id, subset, lines: rates.lines, cer: +rates.cer.toFixed(4), wer: +rates.wer.toFixed(4), refChars: rates.chars, refWords: rates.words,
  model: { encoder: arg('encoder', 'encoder.onnx'), decoder: arg('decoder', 'decoder.onnx'), hebrewOnly: !flag('no-hebrew-only') },
  speed: { audioSeconds: +(audioMs / 1000).toFixed(1), runSeconds: +(runMs / 1000).toFixed(1), device: 'onnxruntime-node, processor' },
  lines_detail: pairs.map((p) => ({ ...p, ref: normalizeText(p.ref), hyp: normalizeText(p.hyp) })),
};
console.log(JSON.stringify({ ...report, lines_detail: undefined }));
const out = arg('out'); if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 1) + '\n'); }
await whisper.release();
