#!/usr/bin/env node
// The same test as scripts/eval_vocab.py, run through the code the browser runs: src/tokenize.js, the exported graph
// (joint.int8.onnx) and src/joint.js. Needs onnxruntime-node (a tool for this check only; nothing in src/ imports it):
//   npm install --no-save onnxruntime-node@1.31.1
//   node scripts/eval_pack.mjs --pack <folder with joint.int8.onnx, vocab.txt, tokenizer.json, labels.json> --items <items.json> [--out report.json]
// items.json is written by eval_vocab.py. Scoring follows eval_vocab.py score() line for line.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createTokenizer } from '../src/tokenize.js';
import { prefixOptions, decode, SEG_WIDTH } from '../src/joint.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const pack = arg('--pack'), itemsPath = arg('--items');
if (!pack || !itemsPath) { console.error('usage: eval_pack.mjs --pack <dir> --items <items.json> [--out report.json] [--ort <path to onnxruntime-node>]'); process.exit(2); }
const require = createRequire(arg('--ort') ? join(arg('--ort'), 'x.js') : import.meta.url);
const ort = require('onnxruntime-node');
const labels = JSON.parse(readFileSync(join(pack, 'labels.json'), 'utf8'));
const tok = createTokenizer(JSON.parse(readFileSync(join(pack, 'tokenizer.json'), 'utf8')), readFileSync(join(pack, 'vocab.txt'), 'utf8'));
const session = await ort.InferenceSession.create(join(pack, arg('--model') || 'joint.int8.onnx'));
const items = JSON.parse(readFileSync(itemsPath, 'utf8'));
const skeleton = (s) => String(s).replace(/[וי]/g, '');
const big = (a) => BigInt64Array.from(a, (v) => BigInt(v));

const cache = new Map();
async function analyse(text) {
  if (cache.has(text)) return cache.get(text);
  const enc = tok.encode(text);
  const n = enc.ids.length;
  const out = await session.run({
    input_ids: new ort.Tensor('int64', big(enc.ids), [1, n]),
    attention_mask: new ort.Tensor('int64', big(new Array(n).fill(1)), [1, n]),
    prefix_class_id_options: new ort.Tensor('int64', big(prefixOptions(enc.tokens, labels)), [1, n, SEG_WIDTH]),
  });
  const words = decode(enc, { lexTop: out.lex_top.data, seg: out.seg.data, morph: out.morph.data, ner: out.ner.data }, labels, tok.pieces);
  cache.set(text, words);
  return words;
}

const counts = new Map(); let missing = 0; const started = Date.now(); let ran = 0;
const bump = (set, field, ok, strict) => { for (const s of [set, 'all']) { const k = `${s}\t${field}`; const c = counts.get(k) || [0, 0, 0]; c[0]++; c[1] += ok ? 1 : 0; c[2] += strict ? 1 : 0; counts.set(k, c); } };
for (const item of items) {
  const words = await analyse(item.text); ran++;
  const w = words.find((x) => x.token === item.target);
  if (!w) { missing++; continue; }
  const e = item.expect;
  if (e.lemma) { const lex = w.lemma ?? w.base; const strict = e.lemma.includes(lex); bump(item.set, 'lemma', strict || e.lemma.some((x) => skeleton(x) === skeleton(lex)), strict); }
  if (e.pos) { const ok = e.pos.includes(w.pos); bump(item.set, 'pos', ok, ok); }
  if (e.gender) { const ok = (w.feats.Gender || '').split(',').includes(e.gender); bump(item.set, 'gender', ok, ok); }
  if (e.number) { const ok = (w.feats.Number || '').split(',').includes(e.number); bump(item.set, 'number', ok, ok); }
  if ('prefix' in e) { const ok = w.prefix === e.prefix; bump(item.set, 'prefix', ok, ok); }
}
const bySet = {};
for (const [k, [n, ok, strict]] of [...counts].sort()) { const [set, field] = k.split('\t'); (bySet[set] ||= {})[field] = { n, right: ok, pct: +(100 * ok / n).toFixed(2), ...(field === 'lemma' ? { strictPct: +(100 * strict / n).toFixed(2) } : {}) }; }
const report = { model: 'words pack (browser code path, onnxruntime-node)', items: items.length, targetNotFound: missing, msPerText: +((Date.now() - started) / cache.size).toFixed(1), bySet };
if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
