#!/usr/bin/env node
// Checks models.manifest.json: the schema first, then the rules a schema cannot say.
//   node scripts/check-manifest.mjs [path]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/packages.mjs';
import { validate } from './lib/mini-schema.mjs';

const SHIPPABLE = /^(Apache-2\.0|MIT|CC-BY-4\.0|CC0-1\.0|BSD-[23]-Clause)\b/;
const NOT_SHIPPABLE = /non-?commercial|CC-BY-NC|none stated|unavailable|unclear|unspecified/i;

/** @returns {string[]} problems */
export function checkManifest(manifest, schema) {
  const out = validate(manifest, schema);
  if (out.length) return out;
  const seen = new Set();
  for (const m of manifest.models) {
    const at = `model ${m.id}`;
    if (seen.has(m.id)) out.push(`${at}: listed twice`); seen.add(m.id);
    const hub = (m.source || 'hub') === 'hub';
    if (hub && 'DB'.includes(m.tier) && !m.hubRevision) out.push(`${at}: tier ${m.tier} needs a pinned Hub revision`);
    if (!hub && m.hubRevision) out.push(`${at}: not a Hub model, so no Hub revision`);
    if (!hub && !m.sourceUrl) out.push(`${at}: a model from outside the Hub needs sourceUrl`);
    // rule 4: non-commercial or unclear licence never ships (D) and never writes shipped content (B)
    if ('DB'.includes(m.tier) && (NOT_SHIPPABLE.test(m.licence) || !(SHIPPABLE.test(m.licence) || /^NVIDIA Open Model License/.test(m.licence)))) out.push(`${at}: licence "${m.licence}" cannot be tier ${m.tier}`);
    if (m.tier === 'X' && !/^Dropped: /.test(m.reason)) out.push(`${at}: a dropped model's reason starts with "Dropped: "`);
    if ('DB'.includes(m.tier) && /^CC-BY/.test(m.licence) && !m.attribution) out.push(`${at}: CC-BY needs an attribution line`);
    if (m.pack) {
      const pack = manifest.packs[m.pack];
      if (!pack) { out.push(`${at}: unknown pack ${m.pack}`); continue; }
      if (m.tier !== 'D') out.push(`${at}: only tier D models belong to a pack`);
      if (m.budgetBytes !== pack.budgetBytes) out.push(`${at}: budgetBytes differs from pack ${m.pack}`);
      if (m.device.webgpu !== pack.device.webgpu || m.device.minRamGB !== pack.device.minRamGB) out.push(`${at}: device differs from pack ${m.pack}`);
      if (pack.published && !m.files.length) out.push(`${at}: pack ${m.pack} is published but the model lists no files`);
      for (const f of m.files) if (!f.url.startsWith(manifest.packHost)) out.push(`${at}: ${f.name} is not on the pack host (a browser cannot read release assets from another site)`);
    } else {
      if (m.tier === 'D' && hub) out.push(`${at}: a tier D model needs a pack`);
      if (m.files.length) out.push(`${at}: files without a pack`);
    }
  }
  for (const [name, pack] of Object.entries(manifest.packs)) {
    const models = manifest.models.filter((m) => m.pack === name);
    if (!models.length) out.push(`pack ${name}: no model uses it`);
    if (pack.format === 'alef.pack.v1' && pack.cache !== `alef-pack-${name}-v1`) out.push(`pack ${name}: cache must be alef-pack-${name}-v1`);
    // no AI wording in anything a learner reads
    for (const text of [pack.title, pack.what]) if (/\b(AI|A\.I\.|artificial intelligence|machine learning|neural|model|LLM|GPT|algorithm)\b/i.test(text)) out.push(`pack ${name}: learner-facing text must not use technical or AI wording ("${text}")`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] || join(ROOT, 'models.manifest.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const schema = JSON.parse(readFileSync(join(ROOT, 'models.manifest.schema.json'), 'utf8'));
  const problems = checkManifest(manifest, schema);
  if (problems.length) { for (const p of problems) console.error(p); process.exit(1); }
  const n = (t) => manifest.models.filter((m) => m.tier === t).length;
  console.log(`models.manifest.json: ${manifest.models.length} models (D ${n('D')}, B ${n('B')}, Q ${n('Q')}, X ${n('X')}), ${Object.keys(manifest.packs).length} packs`);
}
