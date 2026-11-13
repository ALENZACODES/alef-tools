import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { json, unitIds, data, PKG, CODE, lib } from './helpers.js';
const { findInUnit, loadUnit, loadRoots, loadUnitList, isUnitId, NAME_SHOWN } = await lib('index.js');

const NAME = 'יהוה';
const POS = new Set(['DET', 'NOUN', 'VERB', 'CCONJ', 'ADP', 'PRON', 'PUNCT', 'ADJ', 'ADV', 'SCONJ', 'NUM', 'PROPN', 'AUX', 'X', 'INTJ', 'SYM', null]);
const noMarks = (s) => s.replace(/[֑-ֽֿ-ׇ]/g, '');

test('lesson notes: one module per unit in the list, each within the 300 KiB budget', async () => {
  const list = await loadUnitList();
  const ids = unitIds();
  assert.deepEqual(ids, Object.keys(list.units).sort());
  assert.ok(ids.length >= 170);
  for (const id of ids) {
    const bytes = statSync(new URL(`${CODE}data/morph/${id}.js`, PKG)).size;
    assert.ok(bytes <= 300 * 1024, `${id} is ${bytes} bytes`);
    assert.ok(isUnitId(id), id);
  }
  assert.match(list.revision, /^[0-9a-f]{40}$/);
  assert.ok(list.largestUnitBytes <= 300 * 1024);
});

test('lesson notes: every analysis is well formed and every link resolves', async () => {
  for (const id of unitIds()) {
    const u = await loadUnit(id);
    assert.equal(u.schema, 'alef.morph.unit/1');
    assert.equal(u.unit, id);
    for (const [key, bucket] of Object.entries(u.words)) {
      assert.ok(bucket.length >= 1 && noMarks(key) === key, key);
      assert.ok((key.match(/[א-ת]/g) || []).length >= 2, `${id}: a single letter has no notes (${key})`);
      for (const a of bucket) {
        assert.ok(POS.has(a.s), `${id} ${key} ${a.s}`);
        assert.ok(key.startsWith(a.p), `${id} ${key}: prefix ${a.p}`);
        if (a.d) assert.ok(u.entries[a.d] && u.entries[a.d].he && u.entries[a.d].en, `${id} ${key} -> ${a.d}`);
        if (bucket.length > 1) assert.ok(Array.isArray(a.c) && a.c.length, `${id} ${key}: more than one analysis needs context keys`);
      }
    }
  }
});

test('the divine Name is nowhere in the built data, the review lists or the fixtures, and has no card', async () => {
  const dirs = ['src/data/morph/', 'src/data/sentiment/', 'dist/data/morph/', 'dist/data/sentiment/', 'review/', 'review/eval/', 'tests/fixtures/'];
  let files = 0;
  for (const d of dirs) for (const n of readdirSync(new URL(d, PKG))) {
    if (statSync(new URL(d + n, PKG)).isDirectory()) continue;
    assert.equal(noMarks(readFileSync(new URL(d + n, PKG), 'utf8')).includes(NAME), false, d + n);
    files++;
  }
  assert.ok(files > 360, `only ${files} files scanned`);
  const unit = await loadUnit('r05');
  assert.equal(findInUnit(unit, NAME), null);
  assert.equal(findInUnit(unit, NAME_SHOWN), null);
  for (const id of unitIds()) assert.equal(Object.hasOwn((await loadUnit(id)).words, NAME_SHOWN), false, id);
});

test('roots: every root on a card is copied from the app word list (none worked out here)', async () => {
  const roots = await loadRoots();
  assert.match(roots.source, /words\.json/);
  assert.ok(new Set(Object.values(roots.lemmas).map((r) => r[0])).size > 500);
  for (const id of unitIds()) for (const e of Object.values((await loadUnit(id)).entries)) if (e.root) assert.match(e.root.replace(/[ּׁׂ]/g, ''), /^[א-ת](־[א-ת]){1,4}$/, e.root);
});

test('lookup: a lesson word is found from its pointed form, context picks between two readings, a letter alone has none', async () => {
  const unit = await loadUnit('pu-cafe');
  const coffee = findInUnit(unit, 'קָפֶה');
  assert.equal(coffee.entry.en.includes('coffee'), true);
  assert.equal(coffee.a.s, 'NOUN');
  const many = Object.entries(unit.words).find(([, b]) => b.length > 1);
  assert.ok(many, 'expected a word with two readings in pu-cafe');
  assert.equal(findInUnit(unit, many[0]).a, many[1][0]);
  assert.equal(findInUnit(unit, 'מילהשאיננה'), null);
  assert.equal(findInUnit(await loadUnit('r01'), 'שׁ'), null);
  assert.equal(await loadUnit('no-such-unit'), null);
  assert.equal(await loadUnit('../index'), null);
});

test('sentiment: only sentences a person checked are in the shipped module; the review list holds every sentence', async () => {
  const review = json('review/sentiment.json');
  const shipped = await data('sentiment/games.js');
  assert.ok(review.count >= 100 && review.items.length === review.count);
  for (const i of review.items) assert.ok(['positive', 'neutral', 'negative'].includes(i.model.label) && typeof i.checked === 'boolean');
  const checked = new Set(review.items.filter((i) => i.checked).map((i) => i.id));
  assert.equal(shipped.items.length, checked.size);
  for (const i of shipped.items) assert.ok(checked.has(i.id), i.id);
});

test('the Words pack list: alef.pack.v1, within the manifest budget, parts of at most 16 MiB, and the same files the export recorded', () => {
  const m = JSON.parse(readFileSync(new URL('../../models.manifest.json', PKG), 'utf8'));
  const pack = m.packs.words;
  assert.equal(pack.cache, 'alef-pack-words-v1');
  assert.equal(pack.format, 'alef.pack.v1');
  const model = m.models.find((x) => x.id === 'dicta-il/dictabert-tiny-joint');
  assert.equal(model.pack, 'words');
  assert.match(model.hubRevision, /^[0-9a-f]{40}$/);
  assert.equal(model.licence, 'CC-BY-4.0');
  assert.ok(model.attribution.includes('Dicta') && /changed/i.test(model.attribution), 'CC BY: credit and a note of changes');
  // the manifest lists a pack's files only once it is on the pack host (docs/CONTRACT.md, section 7); until then the list lives here
  assert.equal(pack.published, model.files.length > 0);
  const list = json('pack/pack.json');
  assert.equal(list.schema, 'alef.pack.v1');
  assert.equal(list.pack, 'words');
  const exported = json('review/eval/export-words.json');
  assert.equal(exported.revision, model.hubRevision);
  assert.equal(exported.metadataStripped, true);
  let total = 0;
  for (const f of list.files) {
    assert.deepEqual([f.bytes, f.sha256], [exported.files[f.name].bytes, exported.files[f.name].sha256], f.name);
    assert.equal(f.parts.reduce((a, p) => a + p.bytes, 0), f.bytes, f.name);
    for (const p of f.parts) { assert.match(p.sha256, /^[0-9a-f]{64}$/); assert.ok(p.bytes <= 16 * 1048576, p.path); }
    total += f.bytes;
  }
  assert.deepEqual(list.files.map((f) => f.name).sort(), Object.keys(exported.files).sort());
  assert.ok(total <= pack.budgetBytes, `${total} bytes is over the ${pack.budgetBytes} budget`);
  for (const id of ['dicta-il/dictabert-joint', 'dicta-il/dictabert-sentiment', 'dicta-il/dictabert-lex', 'dicta-il/dictabert-seg', 'dicta-il/dictabert-morph', 'dicta-il/dictabert-parse', 'dicta-il/dictabert-large-parse', 'dicta-il/dictabert-tiny-parse', 'onnx-community/dictabert-ner-ONNX']) {
    const x = m.models.find((y) => y.id === id);
    assert.ok(x && x.tier === 'B' && /^[0-9a-f]{40}$/.test(x.hubRevision), id);
  }
});
