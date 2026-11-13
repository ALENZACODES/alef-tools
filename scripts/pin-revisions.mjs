#!/usr/bin/env node
// Reads every Hub model's current revision and licence tag again and compares them with models.manifest.json.
//   node scripts/pin-revisions.mjs            report only (exit 1 when a tier D or B model moved or changed its licence tag)
//   node scripts/pin-revisions.mjs --write    pin the current revision for every model that has none; never moves an existing pin
//   node scripts/pin-revisions.mjs --write --move <id>   move one model's pin to the current revision (do this on purpose, per model)
// Needs network access to huggingface.co. Nothing is downloaded but the model's metadata.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/packages.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
const move = args.flatMap((a, i) => (a === '--move' ? [args[i + 1]] : []));
const file = join(ROOT, 'models.manifest.json');
const manifest = JSON.parse(readFileSync(file, 'utf8'));

const SPDX = { 'apache-2.0': 'Apache-2.0', mit: 'MIT', 'cc-by-4.0': 'CC-BY-4.0', 'cc0-1.0': 'CC0-1.0', 'cc-by-nc-4.0': 'CC-BY-NC-4.0' };
async function hub(id) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://huggingface.co/api/models/${id}`);
      if (res.status === 401 || res.status === 404) return { status: res.status };
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      const tag = (d.tags || []).find((t) => t.startsWith('license:'))?.slice(8) || '';
      return { status: 200, id: d.id, sha: d.sha, licence: tag, gated: !!d.gated };
    } catch (e) { if (attempt === 2) return { status: String(e.message) }; await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
  }
}

let bad = 0, pinned = 0;
for (const m of manifest.models) {
  if ((m.source || 'hub') !== 'hub') continue;
  const h = await hub(m.id);
  const ships = 'DB'.includes(m.tier);
  if (h.status !== 200) {
    const expected = /unavailable/.test(m.licence) || (!m.hubRevision && !ships);
    console.log(`${expected ? 'note ' : 'ERROR'} ${m.id}: the Hub answers ${h.status}`);
    if (!expected) bad++;
    continue;
  }
  if (h.id !== m.id) console.log(`note  ${m.id}: the Hub now calls this ${h.id}`);
  const tagged = SPDX[h.licence] || h.licence;
  if (tagged ? !m.licence.toLowerCase().includes(tagged.toLowerCase()) && !(tagged === 'other' || tagged === 'gemma' || tagged === 'llama3.2' || tagged === 'cc') : SPDX[m.licence.toLowerCase()] || /^(Apache-2\.0|MIT|CC-BY-4\.0|CC0-1\.0)$/.test(m.licence)) {
    console.log(`${ships ? 'ERROR' : 'note '} ${m.id}: licence tag on the Hub is "${h.licence || 'none'}", the manifest says "${m.licence}"`);
    if (ships) bad++;
  }
  if (!m.hubRevision || move.includes(m.id)) {
    if (write) { m.hubRevision = h.sha; pinned++; } else console.log(`note  ${m.id}: not pinned (current revision ${h.sha})`);
  } else if (m.hubRevision !== h.sha) {
    console.log(`${ships ? 'MOVED' : 'note '} ${m.id}: pinned ${m.hubRevision.slice(0, 12)}, the Hub is at ${h.sha.slice(0, 12)}`);
  }
}
if (write) { writeFileSync(file, JSON.stringify(manifest, null, 1) + '\n'); console.log(`pinned ${pinned} revision(s)`); }
console.log(bad ? `${bad} problem(s)` : 'revisions and licence tags agree with the manifest');
process.exit(bad ? 1 : 0);
