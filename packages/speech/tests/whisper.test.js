import test from 'node:test';
import assert from 'node:assert/strict';
import { mod } from './helpers.js';
const { createWhisper } = await mod('whisper.js');

// A stand-in runtime: tensors are plain objects, and the "decoder" writes a scripted answer.
const ort = { Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } } };
const vocab = { 'Ġ': 0, '×©': 1, '×ľ': 2, 'a': 3, '.': 4 }; // 1 = shin, 2 = lamed (two bytes each), 3 = Latin a
const EOT = 5;
const added = { '<|endoftext|>': EOT, '<|startoftranscript|>': 6, '<|he|>': 7, '<|en|>': 8, '<|transcribe|>': 9, '<|notimestamps|>': 10 };
const config = { num_mel_bins: 80, decoder_layers: 2, decoder_attention_heads: 2, d_model: 8 };
const V = 11;

function fakes(script) {
  const calls = { enc: [], dec: [] }; let at = 0;
  const encoder = { inputNames: ['input_features'], outputNames: ['last_hidden_state'], async run(feeds) { calls.enc.push(feeds); return { last_hidden_state: new ort.Tensor('float32', new Float32Array(4), [1, 1, 4]) }; } };
  const pasts = []; for (let i = 0; i < 2; i++) for (const side of ['decoder', 'encoder']) for (const kv of ['key', 'value']) pasts.push(`past_key_values.${i}.${side}.${kv}`);
  const decoder = {
    inputNames: ['input_ids', 'encoder_hidden_states', ...pasts, 'use_cache_branch'],
    outputNames: ['logits', ...pasts.map((n) => n.replace('past_key_values.', 'present.'))],
    async run(feeds) {
      at = feeds.use_cache_branch.data[0] ? at + 1 : 0; const step = at; calls.dec.push(feeds); // a new take starts the script again
      const seq = feeds.input_ids.dims[1];
      const logits = new Float32Array(seq * V).fill(-5);
      const row = script[Math.min(step, script.length - 1)];
      for (const [id, v] of Object.entries(row)) logits[(seq - 1) * V + Number(id)] = v;
      const out = { logits: new ort.Tensor('float32', logits, [1, seq, V]) };
      for (const n of pasts) out[n.replace('past_key_values.', 'present.')] = new ort.Tensor('float32', new Float32Array(1), [1, 2, step + 1, 4]);
      return out;
    },
  };
  return { encoder, decoder, calls };
}
const speech = () => Float32Array.from({ length: 16000 }, (_, i) => 0.2 * Math.sin(i / 7) * (0.6 + 0.4 * Math.sin(i / 900)));

test('transcribe: Hebrew is forced, tokens are fed back one at a time, and the answer is decoded', async () => {
  const f = fakes([{ 1: 9 }, { 2: 9 }, { [EOT]: 9 }]);
  const w = await createWhisper({ ort, ...f, vocab, added, config });
  const r = await w.transcribe(speech(), { trim: false });
  assert.equal(r.ok, true); assert.equal(r.text, 'של');
  assert.ok(r.confidence > 0.9 && r.confidence <= 1);
  assert.equal(f.calls.enc.length, 1);
  assert.deepEqual(f.calls.enc[0].input_features.dims, [1, 80, 3000]);
  // step 0: the fixed start (start, Hebrew, transcribe, no timestamps), nothing remembered yet
  assert.deepEqual([...f.calls.dec[0].input_ids.data].map(Number), [6, 7, 9, 10]);
  assert.deepEqual(f.calls.dec[0].use_cache_branch.data, [false]);
  assert.deepEqual(f.calls.dec[0]['past_key_values.0.decoder.key'].dims, [1, 2, 0, 4]);
  // step 1: only the new token, with what the decoder remembered; the encoder side is the one from step 0
  assert.deepEqual([...f.calls.dec[1].input_ids.data].map(Number), [1]);
  assert.deepEqual(f.calls.dec[1].use_cache_branch.data, [true]);
  assert.deepEqual(f.calls.dec[1]['past_key_values.1.decoder.value'].dims, [1, 2, 1, 4]);
  assert.equal(f.calls.dec[2]['past_key_values.0.encoder.key'], f.calls.dec[1]['past_key_values.0.encoder.key']);
  assert.deepEqual(f.calls.dec[2]['past_key_values.0.decoder.key'].dims, [1, 2, 2, 4]);
});

test('transcribe keeps to Hebrew letters unless told otherwise', async () => {
  const script = [{ 3: 9, 1: 5 }, { [EOT]: 9 }]; // the model prefers a Latin letter; shin is second
  let w = await createWhisper({ ort, ...fakes(script), vocab, added, config });
  assert.equal((await w.transcribe(speech(), { trim: false })).text, 'ש');
  w = await createWhisper({ ort, ...fakes(script), vocab, added, config });
  assert.equal((await w.transcribe(speech(), { trim: false, hebrewOnly: false })).text, 'a');
});

test('transcribe never answers a silent take, and does not run the model for it', async () => {
  const f = fakes([{ 1: 9 }]);
  const w = await createWhisper({ ort, ...f, vocab, added, config });
  const r = await w.transcribe(new Float32Array(32000));
  assert.deepEqual({ ok: r.ok, error: r.error, text: r.text }, { ok: false, error: 'no-speech', text: '' });
  assert.equal(f.calls.enc.length, 0);
});

test('transcribe stops a runaway answer: a token cap, and a repeated phrase is cut', async () => {
  const f = fakes([{ 1: 9 }]); // would say shin for ever
  const w = await createWhisper({ ort, ...f, vocab, added, config });
  const r = await w.transcribe(speech(), { trim: false });
  assert.ok(r.text.length <= 24, `kept ${r.text.length} letters`);
  assert.ok(f.calls.dec.length <= 24);
});

test('an end-of-text first answer is not allowed to pass as an empty transcript silently', async () => {
  const f = fakes([{ [EOT]: 9, 2: 3 }, { [EOT]: 9 }]);
  const w = await createWhisper({ ort, ...f, vocab, added, config });
  assert.equal((await w.transcribe(speech(), { trim: false })).text, 'ל'); // first step may not end the text
});

test('requests are answered in order, one at a time', async () => {
  const f = fakes([{ 1: 9 }, { [EOT]: 9 }]);
  const w = await createWhisper({ ort, ...f, vocab, added, config });
  const [a, b] = await Promise.all([w.transcribe(speech(), { trim: false }), w.transcribe(speech(), { trim: false })]);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
});
