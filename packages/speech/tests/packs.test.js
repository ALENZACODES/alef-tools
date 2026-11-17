// The pack lists as built (packs/*.pack.json) keep to the contract and to the budgets in models.manifest.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mod } from './helpers.js';
const speech = await mod('index.js');

const dir = new URL('../packs/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('../../../models.manifest.json', import.meta.url), 'utf8'));
const lists = readdirSync(dir).filter((f) => f.endsWith('.pack.json')).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));

test('every pack this package names has a built list, and nothing else does', () => {
  assert.deepEqual(lists.map((l) => l.pack).sort(), [...speech.packs].sort());
});

for (const list of lists) {
  test(`${list.pack}: parts of at most 16 MiB, sizes add up, inside its budget`, () => {
    assert.equal(list.schema, 'alef.pack.v1');
    let total = 0;
    for (const f of list.files) {
      assert.match(f.sha256, /^[0-9a-f]{64}$/);
      assert.equal(f.parts.reduce((a, p) => a + p.bytes, 0), f.bytes, f.name);
      for (const p of f.parts) { assert.ok(p.bytes > 0 && p.bytes <= 16 * 1048576, p.path); assert.match(p.sha256, /^[0-9a-f]{64}$/); assert.match(p.path, /^[a-z.]+\.p\d{3}$/); }
      total += f.bytes;
    }
    const pack = manifest.packs[list.pack];
    assert.ok(total <= pack.budgetBytes, `${total} bytes, budget ${pack.budgetBytes}`);
    assert.equal(pack.cache, `alef-pack-${list.pack}-v1`);
    const names = list.files.map((f) => f.name);
    assert.ok(names.includes('spec.json'));
    assert.ok(names.includes('model.onnx') ? names.includes('vocab.json') : names.includes('encoder.onnx') && names.includes('decoder.onnx') && names.includes('tokens.json'));
  });
}

test('the lane\'s own size targets: quick 80 MiB, best 580 MiB, letter check under 200 MiB', () => {
  const size = Object.fromEntries(lists.map((l) => [l.pack, l.files.reduce((a, f) => a + f.bytes, 0) / 1048576]));
  assert.ok(size['listen-lite'] <= 80); assert.ok(size['listen-best'] <= 580); assert.ok(size['pron-check'] <= 200);
});

test('only models that may ship are behind these packs, each with a pinned revision', () => {
  for (const name of speech.packs) {
    const models = manifest.models.filter((m) => m.pack === name);
    assert.equal(models.length, 1, name);
    assert.equal(models[0].tier, 'D'); assert.match(models[0].hubRevision, /^[0-9a-f]{40}$/); assert.match(models[0].licence, /^Apache-2\.0/);
  }
});
