import test from 'node:test';
import assert from 'node:assert/strict';
import { mod } from './helpers.js';
import { readFileSync } from 'node:fs';
const { strokesTo32, norm32, imageDataTo32, penFor, extentOf, SIZE } = await mod('preprocess.js');

const fx = JSON.parse(readFileSync(new URL('./fixtures/parity.json', import.meta.url), 'utf8'));
const meanAbs = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const maxAbs = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

test('strokes: same picture as the Python training code', () => {
  const cases = fx.cases.filter((c) => c.kind === 'strokes');
  assert.ok(cases.length >= 6);
  for (const c of cases) assert.ok(maxAbs(strokesTo32(c.strokes, { pen: c.pen }), c.want) < 2e-3, `pen ${c.pen}`);
});

test('ink map: crop, fit and centre match the Python training code closely', () => {
  for (const c of fx.cases.filter((x) => x.kind === 'ink')) {
    const got = norm32(Float32Array.from(c.ink), c.width, c.height);
    assert.ok(meanAbs(got, c.want) < 0.012, `${c.width}x${c.height}: mean difference ${meanAbs(got, c.want)}`);
  }
});

test('canvas pixels: dark ink on light paper', () => {
  const c = fx.cases.find((x) => x.kind === 'gray');
  const data = new Uint8ClampedArray(c.width * c.height * 4);
  c.gray.forEach((g, i) => { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g; data[i * 4 + 3] = 255; });
  assert.ok(meanAbs(imageDataTo32({ data, width: c.width, height: c.height }), c.want) < 0.02);
});

test('canvas pixels: coloured strokes on a clear canvas use the alpha channel', () => {
  const w = 60, h = 60; const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 10; y < 50; y++) for (let x = 28; x < 32; x++) { const i = (y * w + x) * 4; data[i] = 212; data[i + 1] = 175; data[i + 2] = 55; data[i + 3] = 255; }
  const p = imageDataTo32({ data, width: w, height: h });
  let ink = 0; for (const v of p) ink += v;
  assert.ok(ink > 40, 'a gold line on a clear canvas is seen as ink');
  assert.ok(p[16 * SIZE + 16] > 0.9);
});

test('empty and single-dot drawings do not throw', () => {
  assert.equal(strokesTo32([]).reduce((a, v) => a + v, 0), 0);
  assert.ok(strokesTo32([[[5, 5]]]).reduce((a, v) => a + v, 0) > 0);
  assert.equal(norm32(new Float32Array(100), 10, 10).reduce((a, v) => a + v, 0), 0);
});

test('size does not matter, shape does', () => {
  const small = [[[10, 10], [30, 10], [30, 40]]]; const big = small.map((s) => s.map(([x, y]) => [x * 20 + 300, y * 20 + 77]));
  assert.ok(maxAbs(strokesTo32(small), strokesTo32(big)) < 1e-4);
});

test('penFor and extentOf', () => {
  assert.equal(penFor(0, 100), 1.3);
  assert.equal(penFor(1000, 100), 2.2);
  assert.equal(penFor(1, 1000), 0.8);
  assert.deepEqual(extentOf([[[1, 2], [5, 10]]]), { width: 4, height: 8, top: 2, bottom: 10 });
});
