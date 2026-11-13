// This package's rows in models.manifest.json, its conversion record and its pack lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { src } from './helpers.js';
const { packs, SOURCE_NOTE } = await import(src('index.js'));

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const manifest = read('../../../models.manifest.json');
const conversion = read('../conversion.json');
const model = (id) => manifest.models.find((m) => m.id === id);
const MAX_PART = 16 * 1024 * 1024;

test('both packs are in the shared manifest, with a clear licence, a pinned revision and a credit line', () => {
  for (const [id, pack, licence] of [['dicta-il/dictabert-large-char-menaked', 'nikud', 'CC-BY-4.0'], ['Phonikud/phonikud-onnx', 'phonemes', 'MIT']]) {
    const m = model(id);
    assert.equal(m.tier, 'D'); assert.equal(m.pack, pack); assert.equal(m.licence, licence);
    assert.match(m.hubRevision, /^[0-9a-f]{40}$/);
    assert.equal(conversion.packs[pack].hubRevision, m.hubRevision, 'the conversion record names the pinned revision');
    assert.ok(/Dicta/.test(m.attribution) && /CC BY 4\.0/.test(m.attribution), 'Dicta is credited (the phoneme model is built on theirs)');
    assert.ok(packs.includes(pack) && manifest.packs[pack].cache === `alef-pack-${pack}-v1`);
  }
  assert.ok(/converted|Changed/.test(model('dicta-il/dictabert-large-char-menaked').attribution), 'CC BY: the credit says the model was changed');
});

test('nothing with an unclear licence is used; build-only and check-only models are not packs', () => {
  assert.equal(model('Phonikud/phonikud').tier, 'X');
  for (const id of ['verbit/hebrew_punctuation', 'dicta-il/BEREL_3.0']) { assert.equal(model(id).tier, 'B'); assert.equal(model(id).pack, null); }
  for (const id of ['dicta-il/dictabert-char', 'avraham123/tale-me-dictabert-menaked-browser']) { assert.equal(model(id).tier, 'Q'); assert.equal(model(id).pack, null); }
});

test('each pack list: one file, parts of at most 16 MiB with SHA-256, sizes that add up, inside the budget', () => {
  for (const pack of packs) {
    const list = read(`../packs/${pack}.pack.json`);
    const rec = conversion.packs[pack];
    assert.equal(list.schema, 'alef.pack.v1'); assert.equal(list.pack, pack);
    assert.equal(list.files.length, 1);
    const f = list.files[0];
    assert.equal(f.name, rec.file.name); assert.equal(f.bytes, rec.file.bytes); assert.equal(f.sha256, rec.file.sha256);
    assert.equal(f.parts.reduce((a, p) => a + p.bytes, 0), f.bytes);
    for (const p of f.parts) { assert.ok(p.bytes > 0 && p.bytes <= MAX_PART, p.path); assert.match(p.sha256, /^[0-9a-f]{64}$/); }
    assert.ok(f.bytes <= manifest.packs[pack].budgetBytes, `${pack} is over its budget`);
    assert.equal(manifest.packs[pack].budgetBytes, rec.budgetBytes);
  }
  assert.ok(conversion.packs.nikud.file.bytes <= 320 * 1024 * 1024);
  assert.ok(conversion.packs.phonemes.file.bytes <= 310 * 1024 * 1024);
});

test('the packs are not offered to learners until they are on the pack host', () => {
  for (const [id, pack] of [['dicta-il/dictabert-large-char-menaked', 'nikud'], ['Phonikud/phonikud-onnx', 'phonemes']]) {
    if (model(id).files.length === 0) assert.equal(manifest.packs[pack].published, false, `${pack} is marked published with no files`);
  }
});

test('copy a learner can see says nothing about how the marks are made', () => {
  const shown = [...Object.values(SOURCE_NOTE), manifest.packs.nikud.title, manifest.packs.nikud.what, manifest.packs.phonemes.title, manifest.packs.phonemes.what].join(' ');
  assert.equal(/\b(AI|A\.I\.|artificial|machine|model|neural|LLM|GPT|bot)\b/i.test(shown), false, shown);
});

test('no model weights are in the package', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' || e.name === '__pycache__' ? [] : walk(new URL(e.name + '/', dir))) : [new URL(e.name, dir).pathname]));
  assert.deepEqual(walk(new URL('../', import.meta.url)).filter((f) => /\.(onnx|onnx_data|bin|safetensors|pt|wasm|p\d{3})$/.test(f)), []);
});
