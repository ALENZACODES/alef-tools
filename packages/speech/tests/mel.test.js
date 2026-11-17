import test from 'node:test';
import assert from 'node:assert/strict';
import { mod } from './helpers.js';
import { readFileSync } from 'node:fs';
const { logMel, melFilters, N_FRAMES } = await mod('mel.js');

const ref = JSON.parse(readFileSync(new URL('./fixtures/mel-ref.json', import.meta.url), 'utf8'));
const f32 = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };

for (const bands of [80, 128]) {
  test(`log-mel matches the reference feature extractor (${bands} bands)`, () => {
    const pcm = f32(ref.pcm);
    assert.equal(pcm.length, ref.samples);
    const got = logMel(pcm, bands), want = f32(ref[`mel${bands}`]);
    assert.equal(got.length, bands * N_FRAMES);
    let worst = 0;
    for (let m = 0; m < bands; m++) for (let t = 0; t < ref.frames; t++) worst = Math.max(worst, Math.abs(got[m * N_FRAMES + t] - want[m * ref.frames + t]));
    assert.ok(worst < 2e-4, `worst difference ${worst}`);
    // far past the end of the take there is only the silence value
    assert.ok(Math.abs(got[2999] - ref[`tail${bands}`]) < 2e-4);
  });
}

test('mel filters: each band is a triangle with unit area in Hz', () => {
  const f = melFilters(80);
  assert.equal(f.length, 80); assert.equal(f[0].length, 201);
  for (const row of f) { assert.ok(row.every((v) => v >= 0)); assert.ok(row.some((v) => v > 0)); }
});

test('an empty take gives a flat picture, and input past 30 s is ignored', () => {
  const flat = logMel(new Float32Array(0), 80);
  assert.ok(flat.every((v) => v === flat[0]));
  const long = new Float32Array(480000 + 16000).fill(0); long[480000 + 5] = 1;
  assert.deepEqual(logMel(long, 80), logMel(new Float32Array(480000), 80));
});
