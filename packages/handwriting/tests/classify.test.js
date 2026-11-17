import test from 'node:test';
import assert from 'node:assert/strict';
import { mod } from './helpers.js';
import { readFileSync, existsSync } from 'node:fs';
const { readTensors, buildRunner, createClassifier, softmax, CLASSES } = await mod('classify.js');

const tinyModel = new Uint8Array(readFileSync(new URL('./fixtures/tiny.onnx', import.meta.url)));
const tiny = JSON.parse(readFileSync(new URL('./fixtures/tiny.json', import.meta.url), 'utf8'));

test('class list: 22 letters, 5 final forms, then "not a letter"', () => {
  assert.equal(CLASSES.length, 28);
  assert.equal(CLASSES.slice(0, 22).map((c) => c.char).join(''), 'אבגדהוזחטיכלמנסעפצקרשת');
  assert.equal(CLASSES.slice(22, 27).map((c) => c.char).join(''), 'ךםןףץ');
  assert.equal(CLASSES[27].id, 'not-a-letter');
  assert.deepEqual(tiny.classes, CLASSES.map((c) => c.id));
});

test('model reader finds every stored tensor with its shape', () => {
  const t = readTensors(tinyModel);
  assert.equal(t.size, 14);
  assert.deepEqual(t.get('conv0.weight').dims, [3, 1, 3, 3]);
  assert.deepEqual(t.get('fc.weight').dims, [28, 6]);
  assert.equal(t.get('fc.bias').data.length, 28);
});

test('built-in runner gives the same numbers as onnxruntime (recorded)', () => {
  const run = buildRunner(readTensors(tinyModel), tiny.arch);
  tiny.inputs.forEach((x, i) => {
    const got = run(Float32Array.from(x));
    for (let k = 0; k < 28; k++) assert.ok(Math.abs(got[k] - tiny.logits[i][k]) < 2e-4, `input ${i} class ${k}: ${got[k]} vs ${tiny.logits[i][k]}`);
  });
});

test('createClassifier: probabilities sum to 1 and the ranking is sorted', async () => {
  const c = await createClassifier({ model: tinyModel, manifest: tiny });
  assert.equal(c.backend, 'built-in');
  const r = await c.classify(Float32Array.from(tiny.inputs[0]));
  assert.ok(Math.abs(r.probs.reduce((a, v) => a + v, 0) - 1) < 1e-5);
  assert.equal(r.top, r.ranking[0]);
  for (let i = 1; i < r.ranking.length; i++) assert.ok(r.ranking[i - 1].p >= r.ranking[i].p);
  await assert.rejects(() => c.classify(new Float32Array(10)), /32x32/);
  await c.dispose();
});

test('a damaged or mismatched model file is refused', async () => {
  assert.throws(() => buildRunner(new Map(), tiny.arch), /does not match/);
  await assert.rejects(() => createClassifier({ model: tinyModel, manifest: { ...tiny, classes: ['x'] } }), /do not match/);
  assert.throws(() => readTensors(tinyModel.subarray(0, 300)), /bad model file/);
});

test('softmax is stable for large numbers', () => {
  const p = softmax(Float32Array.from([1000, 1000, -1000]));
  assert.ok(Math.abs(p[0] - 0.5) < 1e-6 && p[2] === 0);
});

// The real model is not stored in git. When it has been built (scripts/export.py) or fetched, these run too.
const packDir = process.env.ALEF_HANDWRITING_PACK || new URL('../build/pack/', import.meta.url).pathname;
const real = existsSync(packDir + '/letters.onnx') && existsSync(packDir + '/model.json');
test('real model: under 2 MiB, reads the app-style strokes of a few plain letters', { skip: real ? false : 'letters.onnx not built here' }, async () => {
  const { strokesTo32 } = await mod('preprocess.js');
  const model = new Uint8Array(readFileSync(packDir + '/letters.onnx'));
  assert.ok(model.length <= 2 * 1024 * 1024);
  const c = await createClassifier({ model, manifest: JSON.parse(readFileSync(packDir + '/model.json', 'utf8')) });
  const lamed = [[[300, 100], [300, 400], [700, 400], [700, 600], [400, 900]]];                    // print lamed
  const resh = [[[250, 250], [750, 250], [750, 850]]];
  const final_mem = [[[250, 250], [750, 250], [750, 800], [250, 800], [250, 250]]];
  assert.equal((await c.classify(strokesTo32(lamed))).top.id, 'lamed');
  assert.equal((await c.classify(strokesTo32(resh))).top.id, 'resh');
  assert.equal((await c.classify(strokesTo32(final_mem))).top.id, 'mem-final');
  const t0 = performance.now(); for (let i = 0; i < 20; i++) await c.classify(strokesTo32(resh));
  console.log(`built-in runner: ${((performance.now() - t0) / 20).toFixed(1)} ms per letter on this machine`);
});
