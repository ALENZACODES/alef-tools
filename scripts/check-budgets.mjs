#!/usr/bin/env node
// Size budgets (docs/CONTRACT.md, sections 3 and 4). Fails when:
//   - a pack's listed files add up to more than its budgetBytes, or any listed part is over 16 MiB;
//   - the code packages name for the app's first install is over 10 KiB gzipped for the loader or 40 KiB for all lanes together;
//   - anything that looks like model weights is in a dist/ folder or tracked by git.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { ROOT, packages } from './lib/packages.mjs';

export const KiB = 1024, MiB = 1048576;
export const LIMITS = { partBytes: 16 * MiB, loaderFirstInstallGzip: 10 * KiB, totalFirstInstallGzip: 40 * KiB, distFileBytes: 512 * KiB };
const WEIGHTS = /\.(onnx|onnx_data|safetensors|bin|pt|gguf|tflite|part|p\d{2,3})$/i;

export function checkPackBudgets(manifest) {
  const out = [], rows = [];
  for (const [name, pack] of Object.entries(manifest.packs)) {
    const files = manifest.models.filter((m) => m.pack === name).flatMap((m) => m.files);
    const bytes = files.reduce((a, f) => a + f.bytes, 0);
    rows.push({ name, bytes, budget: pack.budgetBytes, files: files.length });
    if (bytes > pack.budgetBytes) out.push(`pack ${name}: ${bytes} bytes listed, over its budget of ${pack.budgetBytes}`);
    for (const f of files) if (f.bytes > LIMITS.partBytes) out.push(`pack ${name}: ${f.name} is ${f.bytes} bytes, over the 16 MiB part limit`);
  }
  return { problems: out, rows };
}

export function checkFirstInstall(pkgs) {
  const out = [], rows = []; let total = 0;
  for (const p of pkgs) {
    let gz = 0;
    for (const rel of p.pkg.alef?.firstInstall || []) {
      const abs = join(p.dir, rel);
      if (!existsSync(abs)) { out.push(`${p.name}: first-install file ${rel} does not exist`); continue; }
      if (!rel.startsWith('dist/')) out.push(`${p.name}: first-install file ${rel} must be under dist/`);
      gz += gzipSync(readFileSync(abs), { level: 9 }).length;
    }
    rows.push({ name: p.name, gzip: gz }); total += gz;
    if (p.name === 'loader' && gz > LIMITS.loaderFirstInstallGzip) out.push(`loader: ${gz} bytes gzipped in the first install, over ${LIMITS.loaderFirstInstallGzip}`);
  }
  if (total > LIMITS.totalFirstInstallGzip) out.push(`first install: ${total} bytes gzipped across all packages, over ${LIMITS.totalFirstInstallGzip}`);
  return { problems: out, rows, total };
}

function walk(dir, out = []) { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; }

export function checkNoWeights(pkgs) {
  const out = [];
  for (const p of pkgs) {
    const dist = join(p.dir, 'dist');
    if (!existsSync(dist)) continue;
    for (const f of walk(dist)) {
      const rel = relative(p.dir, f).split(sep).join('/');
      if (WEIGHTS.test(f)) out.push(`${p.name}: ${rel} looks like model weights; weights never go in dist/ or git`);
      else if (statSync(f).size > LIMITS.distFileBytes && !rel.startsWith('dist/vendor/')) out.push(`${p.name}: ${rel} is over ${LIMITS.distFileBytes} bytes; large data belongs in a language pack`);
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'models.manifest.json'), 'utf8'));
  const pkgs = packages();
  const a = checkPackBudgets(manifest), b = checkFirstInstall(pkgs), c = checkNoWeights(pkgs);
  for (const r of a.rows) console.log(`pack ${r.name.padEnd(20)} ${r.files ? (r.bytes / MiB).toFixed(1).padStart(7) + ' MiB listed' : '   nothing listed yet'}  of ${(r.budget / MiB).toFixed(0).padStart(4)} MiB`);
  for (const r of b.rows) console.log(`first install: ${r.name.padEnd(14)} ${r.gzip} bytes gzipped`);
  console.log(`first install total: ${b.total} of ${LIMITS.totalFirstInstallGzip} bytes gzipped`);
  const problems = [...a.problems, ...b.problems, ...c];
  if (problems.length) { for (const p of problems) console.error('budget: ' + p); process.exit(1); }
  console.log('budgets ok');
}
