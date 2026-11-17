// Checks the build-time nikud files (src/nikud, copied to dist/nikud; written by scripts/build_nikud_json.py) and the review list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { src } from './helpers.js';
const { stripPoints, hasPoints, hasCantillation, guardName, NAME_SHOWN } = await import(src('hebrew.js'));
const { unitIndex, SOURCE_NOTE } = await import(src('units.js'));

const dir = new URL(src('nikud/'));
const have = existsSync(dir);
const units = have ? readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json') : [];
const docs = units.map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
const lines = docs.flatMap((d) => d.lines.map((l) => ({ ...l, unit: d.unit })));
const MAX_UNIT_BYTES = 300 * 1024;

test('the build wrote unit files and an index that lists exactly them', { skip: !have }, () => {
  assert.ok(units.length >= 3);
  const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
  assert.deepEqual(Object.keys(index.units).sort(), units.map((f) => f.replace(/\.json$/, '')).sort());
  assert.match(index.appCommit, /^[0-9a-f]{40}$/);
  assert.ok(lines.length > 1000);
});

test('no unit file is over 300 KiB', { skip: !have }, () => {
  for (const f of units) assert.ok(statSync(new URL(f, dir)).size <= MAX_UNIT_BYTES, f);
});

test('every line has text, pointed text and one of the three sources', { skip: !have }, () => {
  for (const l of lines) {
    assert.equal(typeof l.t, 'string'); assert.equal(typeof l.p, 'string');
    assert.ok(['book', 'checked', 'model'].includes(l.s), `${l.unit}: ${l.s}`);
    assert.ok(l.ph === null || typeof l.ph === 'string');
    assert.equal(l._marked, undefined, 'working field left in the file');
  }
});

test('text the app already points is never changed: for book and checked lines the pointed text is the app text', { skip: !have }, () => {
  const kept = lines.filter((l) => l.s !== 'model');
  assert.ok(kept.length > 100);
  for (const l of kept) assert.equal(l.p, l.t, `${l.unit}: ${l.t}`);
  for (const l of lines.filter((x) => x.s === 'model')) assert.equal(hasPoints(l.t), false, `a pointed line was marked "model": ${l.t}`);
});

test('pointing never changes a letter of a model line', { skip: !have }, () => {
  for (const l of lines.filter((x) => x.s === 'model')) assert.equal(stripPoints(l.p), guardName(l.t).text, `${l.unit}: ${l.t}`);
});

test('Torah and prayer text is untouched: no line carries cantillation marks', { skip: !have }, () => {
  for (const l of lines) { assert.equal(hasCantillation(l.t), false, l.t); assert.equal(hasCantillation(l.p), false, l.p); }
});

test('the divine Name: never spelled out in a pointed line, never given a sound line', { skip: !have }, () => {
  for (const l of lines) {
    const g = guardName(l.t);
    if (!g.found) continue;
    assert.equal(l.ph, null, `sound line on a line with the Name: ${l.t}`);
    assert.equal(guardName(l.p).text, l.p, `the Name is spelled out in: ${l.p}`);
    // he + apostrophe is also how "fifth" is written (כיתה ה'); such a line is treated as holding the Name, to be safe, and keeps its apostrophe
    assert.ok(l.p.includes(NAME_SHOWN) || l.p.includes("ה'"));
  }
  for (const l of lines) if (l.ph) assert.ok(!/adonai|jehov|yahw/i.test(l.ph));
});

test('sound lines use only the sound alphabet and ordinary punctuation', { skip: !have }, () => {
  const withSounds = lines.filter((l) => l.ph);
  assert.ok(withSounds.length > 1000);
  // digits, Latin words and symbols of the source line pass through unchanged, so only Hebrew letters are ruled out
  for (const l of withSounds) assert.equal(/[֐-׿]/.test(l.ph), false, `${l.t} -> ${l.ph}`);
});

test('every difference between the app text and the model is on the review list, and nothing was written back', { skip: !have }, () => {
  const review = JSON.parse(readFileSync(new URL('../review/nikud-diff.json', import.meta.url), 'utf8'));
  const listed = new Set(review.lines.map((x) => x.text));
  const book = new Set(lines.filter((l) => l.s === 'book').map((l) => l.t));
  for (const t of book) assert.ok(listed.has(t), `not on the review list: ${t}`);
  for (const t of listed) assert.ok(book.has(t), `on the review list but not a "book" line: ${t}`);
  for (const x of review.lines) assert.notEqual(x.model, x.text);
});

test('a unit can be looked up by the app text', { skip: !have }, () => {
  const talk = docs.find((d) => d.unit === 'talk');
  assert.ok(talk);
  const idx = unitIndex(talk);
  const first = talk.lines[0];
  assert.equal(idx.get(` ${first.t} `).p, first.p);
  assert.equal(idx.get('אין שורה כזאת'), null);
  assert.ok(SOURCE_NOTE.model.length > 0);
});
