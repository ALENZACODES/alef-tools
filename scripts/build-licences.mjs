#!/usr/bin/env node
// Writes docs/LICENCES.md from models.manifest.json, so the table can never drift from the manifest.
//   node scripts/build-licences.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/packages.mjs';

const TIER = { D: 'D: on the device (opt-in language pack)', B: 'B: offline build time only', Q: 'Q: internal checks only, never ships', X: 'X: dropped' };

export function licencesText(manifest) {
  const esc = (s) => String(s).replace(/\|/g, '\\|');
  const link = (m) => ((m.source || 'hub') === 'hub' ? `[${m.id}](https://huggingface.co/${m.id})` : `[${m.id}](${m.sourceUrl})`);
  const lines = ['# Model licences', '', `Generated from \`models.manifest.json\` by \`scripts/build-licences.mjs\`. Do not edit by hand.`, '',
    `Licences and revisions were read from the Hugging Face Hub on ${manifest.checked}. \`node scripts/pin-revisions.mjs\` reads them again.`, '',
    'Code in this repo is MIT. Model weights are not in this repo and keep the licences below.', '',
    'A model with a non-commercial or unclear licence is never shipped: it is dropped (X) or used for internal checks only (Q).', ''];
  for (const t of ['D', 'B', 'Q', 'X']) {
    const rows = manifest.models.filter((m) => m.tier === t);
    lines.push(`## ${TIER[t]} (${rows.length})`, '', '| Model | Licence | Pinned revision | Pack | Why |', '|---|---|---|---|---|');
    for (const m of rows) lines.push(`| ${link(m)} | [${esc(m.licence)}](${m.licenceUrl}) | ${m.hubRevision ? '`' + m.hubRevision.slice(0, 12) + '`' : 'n/a'} | ${m.pack || ''} | ${esc(m.reason)} |`);
    lines.push('');
  }
  const attr = manifest.models.filter((m) => m.attribution);
  lines.push('## Attribution lines for the app\'s credits page', '', 'Every CC BY model that ships or shapes shipped content:', '', ...attr.map((m) => `- ${m.attribution}`), '');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = licencesText(JSON.parse(readFileSync(join(ROOT, 'models.manifest.json'), 'utf8')));
  const file = join(ROOT, 'docs', 'LICENCES.md');
  if (process.argv.includes('--check')) { if (readFileSync(file, 'utf8') !== text) { console.error('docs/LICENCES.md is stale. Run: node scripts/build-licences.mjs'); process.exit(1); } console.log('docs/LICENCES.md is current'); } else { writeFileSync(file, text); console.log('docs/LICENCES.md written'); }
}
