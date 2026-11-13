import test from 'node:test';
import assert from 'node:assert/strict';
import { mod } from './helpers.js';
const { logSoftmaxRows, emissions, skipTable, ctcLogLik, align, greedyIds } = await mod('ctc-align.js');

// 4 symbols: 0 = blank, 1 = a, 2 = b, 3 = c
const V = 4, BLANK = 0;
/** Frames given as the likeliest symbol with probability p; the rest share what is left. */
function frames(seq, p = 0.9) {
  const T = seq.length, logp = new Float32Array(T * V);
  seq.forEach((s, t) => { for (let v = 0; v < V; v++) logp[t * V + v] = Math.log(v === s ? p : (1 - p) / (V - 1)); });
  return { logp, T };
}
const blankCol = (logp, T) => Float32Array.from({ length: T }, (_, t) => logp[t * V + BLANK]);

/** Every labelling of T frames whose collapsed form is the target, added up by brute force. */
function brute(logp, T, target) {
  let total = 0;
  const walk = (t, path, lp) => {
    if (t === T) { const out = []; let prev = -1; for (const s of path) { if (s !== prev && s !== BLANK) out.push(s); prev = s; } if (out.join() === target.join()) total += Math.exp(lp); return; }
    for (let v = 0; v < V; v++) walk(t + 1, [...path, v], lp + logp[t * V + v]);
  };
  walk(0, [], 0);
  return Math.log(total);
}

test('logSoftmaxRows: each row sums to one', () => {
  const lp = logSoftmaxRows(Float32Array.of(1, 2, 3, 0, 0, 0), 2, 3);
  for (let t = 0; t < 2; t++) assert.ok(Math.abs([0, 1, 2].reduce((a, v) => a + Math.exp(lp[t * 3 + v]), 0) - 1) < 1e-6);
  assert.ok(Math.abs(lp[3] - Math.log(1 / 3)) < 1e-6);
});

test('ctcLogLik equals the brute-force sum, including a doubled letter', () => {
  for (const [seq, target] of [[[1, 0, 2, 2, 0, 3], [1, 2, 3]], [[1, 1, 0, 1, 2, 0], [1, 1, 2]], [[0, 3, 0, 0, 2, 1], [3, 2, 1]], [[2, 2, 2, 2, 2, 2], [2]]]) {
    const { logp, T } = frames(seq, 0.7);
    const sets = target.map((x) => [x]);
    const got = ctcLogLik(emissions(logp, T, V, sets), blankCol(logp, T), T, sets.length, skipTable(sets), sets);
    assert.ok(Math.abs(got - brute(logp, T, target)) < 1e-4, `${target}: ${got} vs ${brute(logp, T, target)}`);
  }
});

test('a position may accept several letters: every reading that uses any of them counts', () => {
  const { logp, T } = frames([1, 0, 2, 0], 0.7);
  const one = [[1], [2]], wide = [[1], [2, 3]];
  const a = ctcLogLik(emissions(logp, T, V, one), blankCol(logp, T), T, 2, skipTable(one), one);
  const b = ctcLogLik(emissions(logp, T, V, wide), blankCol(logp, T), T, 2, skipTable(wide), wide);
  assert.ok(b > a);
  // at least both single readings (a little more: the frames of one position may mix its letters)
  assert.ok(Math.exp(b) >= Math.exp(brute(logp, T, [1, 2])) + Math.exp(brute(logp, T, [1, 3])) - 1e-9);
});

test('dropping a position equals scoring the shorter target; too few frames is impossible', () => {
  const { logp, T } = frames([1, 0, 2, 0, 3, 0], 0.7);
  const sets = [[1], [2], [3]];
  const em = emissions(logp, T, V, sets), bl = blankCol(logp, T);
  const dropped = ctcLogLik(em, bl, T, 3, skipTable(sets), sets, { drop: 1 });
  assert.ok(Math.abs(dropped - brute(logp, T, [1, 3])) < 1e-4);
  const short = frames([1, 2], 0.7);
  assert.ok(ctcLogLik(emissions(short.logp, 2, V, sets), blankCol(short.logp, 2), 2, 3, skipTable(sets), sets) < -1e20);
});

test('align gives each letter its frames, in order', () => {
  const { logp, T } = frames([0, 1, 1, 0, 2, 0, 0, 3, 3, 0], 0.9);
  const sets = [[1], [2], [3]];
  const r = align(emissions(logp, T, V, sets), blankCol(logp, T), T, 3, skipTable(sets));
  assert.deepEqual(r.spans, [{ start: 1, end: 2 }, { start: 4, end: 4 }, { start: 7, end: 8 }]);
  assert.ok(r.logLik < 0 && r.logLik > -3);
});

test('greedyIds merges repeats and removes blanks', () => {
  const { logp, T } = frames([0, 1, 1, 0, 1, 2, 2, 0]);
  assert.deepEqual(greedyIds(logp, T, V, BLANK), [1, 1, 2]);
});
