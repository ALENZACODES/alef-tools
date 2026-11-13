// The repo's own checks: manifest schema and rules, budgets, part splitting, dist building, release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, packages } from '../lib/packages.mjs';
import { validate } from '../lib/mini-schema.mjs';
import { checkManifest } from '../check-manifest.mjs';
import { checkPackBudgets, checkFirstInstall, checkNoWeights, LIMITS } from '../check-budgets.mjs';
import { splitFile, MAX_PART_BYTES } from '../sha256-parts.mjs';
import { strip, run as buildDist } from '../build-dist.mjs';
import { release } from '../release.mjs';
import { licencesText } from '../build-licences.mjs';

const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const manifest = json('models.manifest.json'), schema = json('models.manifest.schema.json');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const clone = (o) => structuredClone(o);

test('the manifest passes its schema and its rules', () => {
  assert.deepEqual(checkManifest(manifest, schema), []);
});

test('every model PLAN.md names for a device pack is tier D with a pack, a licence that may ship, and a pinned revision', () => {
  for (const id of ['Helsinki-NLP/opus-mt-en-he', 'Helsinki-NLP/opus-mt-tc-big-he-en', 'ivrit-ai/whisper-large-v3-turbo-onnx', 'onnx-community/whisper-base', 'XDcobra/wav2vec2-large-xlsr-53-hebrew-ONNX', 'dicta-il/dictabert-large-char-menaked', 'Phonikud/phonikud-onnx', 'dicta-il/dictabert-tiny-joint']) {
    const m = manifest.models.find((x) => x.id === id);
    assert.ok(m, id); assert.equal(m.tier, 'D', id); assert.ok(manifest.packs[m.pack], id); assert.match(m.hubRevision, /^[0-9a-f]{40}$/, id);
  }
  // the pack budgets of PLAN.md section 3, in MiB
  const want = { 'translate-en-he': 80, 'translate-he-en': 80, 'translate-he-en-hq': 250, 'listen-lite': 80, 'listen-best': 580, 'pron-check': 360, nikud: 320, phonemes: 310, words: 50, handwriting: 2 };
  for (const [name, mib] of Object.entries(want)) assert.equal(manifest.packs[name].budgetBytes, mib * 1048576, name);
});

test('rule 4: a non-commercial or unclear licence can never be tier D or B; a dropped model says why', () => {
  for (const m of manifest.models) if (/non-?commercial|CC-BY-NC|none stated|unavailable|unspecified/i.test(m.licence)) assert.ok('QX'.includes(m.tier), `${m.id} (${m.licence}) is tier ${m.tier}`);
  const bad = clone(manifest); const nllb = bad.models.find((m) => m.id === 'Xenova/nllb-200-distilled-600M'); nllb.tier = 'B'; nllb.reason = 'translation memory, offline';
  assert.match(checkManifest(bad, schema).join('\n'), /nllb.*cannot be tier B/);
  const none = clone(manifest); Object.assign(none.models.find((m) => m.id === 'avichr/heBERT'), { tier: 'D', pack: 'words', budgetBytes: none.packs.words.budgetBytes, reason: 'word taps on the device' });
  assert.match(checkManifest(none, schema).join('\n'), /heBERT.*cannot be tier D/);
});

test('the manifest checker catches: a missing revision, a missing attribution, a file off the pack host, an oversized part, AI wording', () => {
  const edit = (fn) => { const m = clone(manifest); fn(m); return checkManifest(m, schema).join('\n'); };
  assert.match(edit((m) => { m.models.find((x) => x.id === 'dicta-il/dictabert-tiny-joint').hubRevision = null; }), /needs a pinned Hub revision/);
  assert.match(edit((m) => { m.models.find((x) => x.id === 'dicta-il/dictabert-tiny-joint').attribution = ''; }), /CC-BY needs an attribution/);
  assert.match(edit((m) => { m.models.find((x) => x.id === 'Helsinki-NLP/opus-mt-en-he').files[0].url = 'https://github.com/ALENZACODES/alef-tools/releases/download/v1/x.bin'; }), /not on the pack host/);
  assert.match(edit((m) => { m.models.find((x) => x.id === 'Helsinki-NLP/opus-mt-en-he').files[0].bytes = MAX_PART_BYTES + 1; }), /above 16777216/);
  assert.match(edit((m) => { m.packs.words.what = 'An AI model that explains any Hebrew word.'; }), /must not use technical or AI wording/);
  assert.match(edit((m) => { m.models.push(clone(m.models[0])); }), /listed twice/);
  assert.match(edit((m) => { m.packs.words.published = true; }), /published but the model lists no files/);
  assert.match(edit((m) => { m.models[0].extra = 1; }), /unknown key extra/);
});

test('mini schema: the keywords the manifest schema relies on', () => {
  assert.deepEqual(validate({ a: 1 }, { type: 'object', required: ['a'], properties: { a: { type: 'integer', minimum: 1 } }, additionalProperties: false }), []);
  assert.equal(validate({ a: 0, b: 1 }, { type: 'object', properties: { a: { type: 'integer', minimum: 1 } }, additionalProperties: false }).length, 2);
  assert.equal(validate(null, { type: ['string', 'null'], pattern: '^x$' }).length, 0);
  assert.equal(validate('y', { type: ['string', 'null'], pattern: '^x$' }).length, 1);
  assert.equal(validate([1, 'a'], { type: 'array', items: { type: 'integer' } }).length, 1);
  assert.equal(validate({ w: true }, { $ref: '#/$defs/d', $defs: { d: { type: 'object', required: ['w', 'r'] } } }).length, 1);
});

test('budget check: fails when a pack is over its budget, passes today; the first-install limits are 10 KiB and 40 KiB gzipped', () => {
  assert.deepEqual(checkPackBudgets(manifest).problems, []);
  const over = clone(manifest); over.packs['translate-en-he'].budgetBytes = 1048576;
  assert.match(checkPackBudgets(over).problems.join('\n'), /translate-en-he: \d+ bytes listed, over its budget/);
  assert.equal(LIMITS.loaderFirstInstallGzip, 10 * 1024); assert.equal(LIMITS.totalFirstInstallGzip, 40 * 1024);
  assert.deepEqual(checkFirstInstall(packages()).problems, []);
  // a made-up lane that puts 50 KiB of incompressible code in the first install
  const dir = mkdtempSync(join(tmpdir(), 'alef-budget-')); mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist', 'big.js'), randomBytes(50 * 1024).toString('base64'));
  const fat = [{ dir, name: 'speech', pkg: { alef: { firstInstall: ['dist/big.js'] } } }];
  assert.match(checkFirstInstall(fat).problems.join('\n'), /first install: \d+ bytes gzipped across all packages, over 40960/);
  assert.match(checkFirstInstall([{ ...fat[0], name: 'loader' }]).problems.join('\n'), /loader: \d+ bytes gzipped in the first install, over 10240/);
  writeFileSync(join(dir, 'dist', 'model.onnx'), 'x');
  assert.match(checkNoWeights(fat).join('\n'), /looks like model weights/);
  rmSync(dir, { recursive: true });
});

test('sha256-parts: parts of at most the limit, in order, each with its own size and hash; joined they are the file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alef-parts-'));
  const body = randomBytes(2500); writeFileSync(join(dir, 'model.onnx'), body);
  const e = await splitFile(join(dir, 'model.onnx'), { out: join(dir, 'out'), partBytes: 1000, variant: 'webgpu' });
  assert.deepEqual(e.parts.map((p) => [p.path, p.bytes]), [['model.onnx.p000', 1000], ['model.onnx.p001', 1000], ['model.onnx.p002', 500]]);
  assert.equal(e.bytes, 2500); assert.equal(e.sha256, sha(body)); assert.equal(e.variant, 'webgpu');
  const joined = Buffer.concat(e.parts.map((p) => { const b = readFileSync(join(dir, 'out', p.path)); assert.equal(sha(b), p.sha256); return b; }));
  assert.ok(joined.equals(body));
  const exact = await splitFile(join(dir, 'model.onnx'), { out: join(dir, 'out2'), partBytes: 1250 });
  assert.equal(exact.parts.length, 2, 'no empty last part');
  await assert.rejects(splitFile(join(dir, 'model.onnx'), { out: dir, partBytes: MAX_PART_BYTES + 1 }), /part size/);
  rmSync(dir, { recursive: true });
});

test('dist: comments are stripped, code is kept, and the committed dist is what src builds', () => {
  assert.equal(strip('// @ts-check\n// note\n/**\n * doc\n */\nexport const a = 1; // kept\n\n  /* one line */\n  const u = "https://x";\n'), 'export const a = 1; // kept\n const u = "https://x";\n');
  assert.deepEqual(buildDist({ check: true }), []);
  const d = json('packages/loader/dist/dist.json');
  assert.equal(d.schema, 'alef.dist.v1'); assert.equal(d.version, json('packages/loader/package.json').version);
  for (const f of d.files) assert.equal(sha(readFileSync(join(ROOT, 'packages/loader/dist', f.path))), f.sha256, f.path);
  assert.ok(!d.files.some((f) => /\.(onnx|bin|wasm)$/.test(f.path)), 'no weights and no binaries in the loader');
});

test('release: the tag must match the version; the release manifest lists every dist file and any pack parts, checked against their list', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alef-release-'));
  for (const p of ['package.json', 'models.manifest.json', 'packages/loader/package.json', 'packages/loader/src']) cpSync(join(ROOT, p), join(dir, p), { recursive: true });
  assert.throws(() => release({ tag: 'v9.9.9', root: dir }), /the tag is v9\.9\.9/);
  assert.throws(() => release({ tag: 'latest', root: dir }), /tag must look like/);
  const body = randomBytes(300); mkdirSync(join(dir, 'out/packs/words'), { recursive: true }); writeFileSync(join(dir, 'm.onnx'), body);
  const entry = await splitFile(join(dir, 'm.onnx'), { out: join(dir, 'out/packs/words'), partBytes: 200 });
  writeFileSync(join(dir, 'out/packs/words/pack.json'), JSON.stringify({ schema: 'alef.pack.v1', pack: 'words', version: '1', files: [entry] }));
  const tag = `v${json('package.json').version}`;
  const m = release({ tag, commit: 'abc', root: dir });
  assert.equal(m.packages[0].name, 'loader'); assert.equal(m.packs[0].assets.length, 3);
  assert.ok(existsSync(join(dir, 'release-out/packs/words--m.onnx.p001')));
  assert.ok(existsSync(join(dir, 'release-out/release-manifest.json')));
  writeFileSync(join(dir, 'out/packs/words/m.onnx.p000'), randomBytes(200));
  assert.throws(() => release({ tag, root: dir }), /does not match its list/);
  rmSync(dir, { recursive: true });
});

test('docs/LICENCES.md is generated from the manifest and is current; every CC BY model that ships has its credit line in it', () => {
  const text = readFileSync(join(ROOT, 'docs/LICENCES.md'), 'utf8');
  assert.equal(text, licencesText(manifest));
  for (const m of manifest.models) if ('DB'.includes(m.tier) && /^CC-BY/.test(m.licence)) assert.ok(text.includes(`- ${m.attribution}`), m.id);
});

test('repo layout: the contract, the placeholders for lanes 1 to 6, and no AI wording in pack names', () => {
  for (const p of ['docs/CONTRACT.md', 'docs/sources.md', 'docs/LICENCES.md', 'LICENSE', '.github/workflows/ci.yml', '.github/workflows/release.yml', 'scripts/convert-common.py']) assert.ok(existsSync(join(ROOT, p)), p);
  for (const p of ['translate', 'speech', 'nikud', 'morph', 'offline-llm', 'handwriting', 'ocr-fix']) assert.ok(existsSync(join(ROOT, 'packages', p, 'README.md')), p);
  const contract = readFileSync(join(ROOT, 'docs/CONTRACT.md'), 'utf8');
  for (const name of ['downloadPack', 'isShabbatSafeMode', 'alef-pack-<name>-v1', 'data/alef-tools.lock.json', '16 MiB']) assert.ok(contract.includes(name), name);
});
