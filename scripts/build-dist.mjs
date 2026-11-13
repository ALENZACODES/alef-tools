#!/usr/bin/env node
// Builds packages/<name>/dist from packages/<name>/src: the same ES modules with comments and blank lines taken out,
// plus dist.json (every file with its size and SHA-256). No bundler, no dependencies.
//   node scripts/build-dist.mjs           write dist/
//   node scripts/build-dist.mjs --check   fail when a committed dist/ is not what src/ builds (CI: "dist freshness")
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, packages } from './lib/packages.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function walk(dir, root = dir, out = []) {
  for (const n of readdirSync(dir).sort()) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, root, out); else out.push(relative(root, p).split(sep).join('/')); }
  return out;
}

/**
 * Takes out whole-line comments, JSDoc blocks and blank lines. Code lines are left exactly as written, so a line that only
 * looks like a comment inside a multi-line template string would be lost: src/ keeps template strings on one line.
 */
export function strip(js) {
  const out = []; let inBlock = false;
  for (const line of js.split('\n')) {
    const t = line.trim();
    if (inBlock) { if (t.includes('*/')) inBlock = false; continue; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; else if (!t.endsWith('*/')) out.push(line); continue; }
    if (!t || (t.startsWith('//') && !t.startsWith('// @ts-check'))) continue;
    if (t.startsWith('// @ts-check')) continue;
    out.push(line.replace(/^\s+/, (m) => ' '.repeat(Math.floor(m.length / 2))));
  }
  return out.join('\n') + '\n';
}

/** The files dist/ should hold for one package: {path: Buffer}. Packages may add JSON or vendored files under src/ too. */
export function buildOne(p) {
  const src = join(p.dir, 'src');
  const files = {};
  for (const rel of walk(src)) {
    const raw = readFileSync(join(src, rel));
    files[rel] = /\.m?js$/.test(rel) && !rel.startsWith('vendor/') ? Buffer.from(strip(raw.toString('utf8'))) : raw;
  }
  const listing = { schema: 'alef.dist.v1', name: p.name, version: p.pkg.version, files: Object.keys(files).sort().map((path) => ({ path, bytes: files[path].length, sha256: sha(files[path]) })) };
  files['dist.json'] = Buffer.from(JSON.stringify(listing, null, 1) + '\n');
  return files;
}

export function run({ check = false, root = ROOT } = {}) {
  const problems = [];
  for (const p of packages(root)) {
    if (!existsSync(join(p.dir, 'src'))) continue;
    const want = buildOne(p); const dist = join(p.dir, 'dist');
    if (check) {
      const have = existsSync(dist) ? walk(dist) : [];
      for (const rel of Object.keys(want)) if (!have.includes(rel) || !readFileSync(join(dist, rel)).equals(want[rel])) problems.push(`${p.name}: dist/${rel} is not what src/ builds`);
      for (const rel of have) if (!(rel in want)) problems.push(`${p.name}: dist/${rel} has no source`);
      const idx = want['index.js']?.toString('utf8') || '';
      if (!new RegExp(`VERSION = '${p.pkg.version.replace(/\./g, '\\.')}'|version = '${p.pkg.version.replace(/\./g, '\\.')}'`).test(idx)) problems.push(`${p.name}: src/index.js does not carry version ${p.pkg.version}`);
    } else {
      rmSync(dist, { recursive: true, force: true });
      for (const [rel, buf] of Object.entries(want)) { mkdirSync(join(dist, rel, '..'), { recursive: true }); writeFileSync(join(dist, rel), buf); }
      console.log(`${p.name}@${p.pkg.version}: ${Object.keys(want).length} files, ${Object.values(want).reduce((a, b) => a + b.length, 0)} bytes`);
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = run({ check: process.argv.includes('--check') });
  if (problems.length) { for (const p of problems) console.error(p); console.error('Run: node scripts/build-dist.mjs'); process.exit(1); }
  if (process.argv.includes('--check')) console.log('dist is fresh');
}
