import test from 'node:test';
import assert from 'node:assert/strict';
import { mod } from './helpers.js';
const { checkLetter, checkWord, tipFor, resolveBySize, NAMES, CONFUSABLE_GROUPS } = await mod('feedback.js');
const { CLASSES, indexOf } = await mod('classify.js');

/** A made-up result with the given scores; everything else shares what is left. */
function result(scores) {
  const probs = new Float32Array(28);
  const given = Object.values(scores).reduce((a, v) => a + v, 0);
  const rest = (1 - given) / (28 - Object.keys(scores).length);
  CLASSES.forEach((c, i) => { probs[i] = scores[c.id] ?? rest; });
  const ranking = CLASSES.map((c, i) => ({ id: c.id, char: c.char, p: probs[i] })).sort((a, b) => b.p - a.p);
  return { probs, ranking };
}

test('the right letter: a match and nothing to fix', () => {
  const r = checkLetter(result({ dalet: 0.9 }), { targetId: 'dalet' });
  assert.equal(r.verdict, 'match'); assert.equal(r.tip, null); assert.match(r.text, /Dalet \(ד\)/);
});

test('a look-alike: says which letter it looks like and gives one tip', () => {
  const r = checkLetter(result({ resh: 0.85, dalet: 0.1 }), { targetId: 'dalet', script: 'print' });
  assert.equal(r.verdict, 'looks-like'); assert.equal(r.looksLike, 'resh');
  assert.match(r.text, /^This looks more like Resh \(ר\)\. /);
  assert.equal(r.tip, tipFor('dalet', 'resh'));
  assert.equal((r.text.match(/[.!?](\s|$)/g) || []).length <= 3, true, 'short: a statement and one tip');
});

test('a close call is said gently', () => {
  const r = checkLetter(result({ kaf: 0.62, bet: 0.36 }), { targetId: 'bet' });
  assert.equal(r.verdict, 'close'); assert.match(r.text, /^Close\. It could also be read as Kaf/);
});

test('when the checker is not sure it says nothing', () => {
  const r = checkLetter(result({ resh: 0.4, dalet: 0.2, vav: 0.2 }), { targetId: 'dalet' });
  assert.equal(r.verdict, 'unsure'); assert.equal(r.text, null);
  assert.equal(checkLetter(result({ 'not-a-letter': 0.5 }), { targetId: 'dalet' }).text, null);
});

test('a scribble gets a kind nudge, not a letter name', () => {
  const r = checkLetter(result({ 'not-a-letter': 0.95 }), { targetId: 'alef' });
  assert.equal(r.verdict, 'not-a-letter'); assert.match(r.text, /Try it again a little bigger/);
});

test('print-only tips are not used for cursive', () => {
  assert.equal(tipFor('dalet', 'resh', 'cursive'), null);
  const r = checkLetter(result({ resh: 0.9 }), { targetId: 'dalet', script: 'cursive' });
  assert.match(r.text, /Look at Dalet once more and compare the two shapes\./);
});

test('yod, vav and final nun: the drawn height decides', () => {
  const heights = { yod: 250, vav: 600, 'nun-final': 900 };
  assert.equal(resolveBySize('vav', 240, heights), 'yod');
  assert.equal(resolveBySize('yod', 880, heights), 'nun-final');
  assert.equal(resolveBySize('bet', 880, heights), 'bet');
  // the picture says "final nun", but it was drawn at vav height and vav was wanted: a match
  assert.equal(checkLetter(result({ 'nun-final': 0.7, vav: 0.25 }), { targetId: 'vav', drawnHeight: 610, heights }).verdict, 'match');
  // wanted vav, drawn tiny: told to keep going
  const short = checkLetter(result({ vav: 0.8, yod: 0.15 }), { targetId: 'vav', drawnHeight: 230, heights });
  assert.equal(short.verdict, 'looks-like'); assert.equal(short.looksLike, 'yod'); assert.match(short.text, /Keep going a little further/);
  // with no size to go on the three are not told apart at all
  assert.equal(checkLetter(result({ 'nun-final': 0.7, vav: 0.25 }), { targetId: 'vav' }).verdict, 'match');
});

test('every tip names a real pair, is one or two short sentences, and has no banned wording', () => {
  const ids = CLASSES.map((c) => c.id);
  let n = 0;
  for (const a of ids) for (const b of ids) {
    const t = tipFor(a, b, 'print'); if (!t) continue; n++;
    assert.ok(a !== b && NAMES[a] && NAMES[b]);
    assert.ok(t.length <= 120, `${a}|${b} is ${t.length} characters`);
    assert.ok(!/\b(AI|model|algorithm|neural|machine|classifier|wrong|bad|incorrect|fail)/i.test(t), `${a}|${b}: ${t}`);
    assert.ok(/^[A-Z]/.test(t) && /\.$/.test(t));
  }
  assert.ok(n >= 30);
  for (const g of CONFUSABLE_GROUPS) for (const a of g) for (const b of g) if (a !== b) assert.ok(tipFor(a, b, 'print'), `no tip for ${a}|${b}`);
});

test('a short word: only the first letter that needs a second look is mentioned', () => {
  const cells = [
    { targetId: 'shin', result: result({ shin: 0.95 }) },
    { targetId: 'lamed', result: result({ lamed: 0.9 }) },
    { targetId: 'vav', result: result({ zayin: 0.9 }) },
    { targetId: 'mem-final', result: result({ samekh: 0.9 }) },
  ];
  const w = checkWord(cells);
  assert.equal(w.ok, false); assert.equal(w.firstIssue, 2); assert.equal(w.read, 'שלזס');
  assert.match(w.text, /^The third letter: This looks more like Zayin/);
  assert.equal(checkWord(cells.slice(0, 2)).ok, true);
  assert.equal(checkWord(cells.slice(0, 2)).text, null);
  assert.equal(indexOf('shin') >= 0, true);
});
