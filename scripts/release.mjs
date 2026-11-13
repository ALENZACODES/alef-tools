#!/usr/bin/env node
// Prepares a release: builds every dist/, checks that the tag matches the versions, and writes release-out/ with
//   release-manifest.json   the tag, the commit, every package's dist files with SHA-256, and the pack parts found
//   alef-tools-<tag>-dist.tgz-list.txt   the dist files, for the workflow to archive
//   models.manifest.json    a copy as of this tag
// Pack parts (large) are never in git: a lane that has converted a pack puts its folder under ./out/packs/<pack>/ before the
// release runs (pack.json plus parts). They are copied into release-out/packs/ as flat asset names and listed in the manifest.
//   node scripts/release.mjs --tag v0.1.0 [--commit <sha>]
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, packages } from './lib/packages.mjs';
import { run as buildDist } from './build-dist.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

export function release({ tag, commit = '', root = ROOT, out = join(root, 'release-out') }) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag || '')) throw new Error('tag must look like v1.2.3');
  const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (`v${rootPkg.version}` !== tag) throw new Error(`package.json is at ${rootPkg.version}; the tag is ${tag}`);
  buildDist({ root });
  const stale = buildDist({ check: true, root });
  if (stale.length) throw new Error(stale.join('\n'));
  rmSync(out, { recursive: true, force: true }); mkdirSync(join(out, 'packs'), { recursive: true });
  const pkgs = packages(root).filter((p) => existsSync(join(p.dir, 'dist', 'dist.json'))).map((p) => ({ ...JSON.parse(readFileSync(join(p.dir, 'dist', 'dist.json'), 'utf8')), path: `packages/${p.name}/dist` }));
  const packs = [];
  const packsDir = join(root, 'out', 'packs');
  if (existsSync(packsDir)) for (const name of readdirSync(packsDir).sort()) {
    const dir = join(packsDir, name); const listFile = join(dir, 'pack.json');
    if (!existsSync(listFile)) continue;
    const list = JSON.parse(readFileSync(listFile, 'utf8'));
    const assets = [];
    for (const part of ['pack.json', ...list.files.flatMap((f) => f.parts.map((p) => p.path))]) {
      const src = join(dir, part); const asset = `${name}--${part.replace(/\//g, '--')}`;
      if (part !== 'pack.json') { const want = list.files.flatMap((f) => f.parts).find((p) => p.path === part); if (statSync(src).size !== want.bytes || sha(readFileSync(src)) !== want.sha256) throw new Error(`pack ${name}: ${part} does not match its list`); }
      copyFileSync(src, join(out, 'packs', asset)); assets.push({ asset, path: part, bytes: statSync(src).size });
    }
    packs.push({ pack: name, version: list.version, assets });
  }
  copyFileSync(join(root, 'models.manifest.json'), join(out, 'models.manifest.json'));
  const manifest = { schema: 'alef.release.v1', tag, commit, packages: pkgs, packs };
  writeFileSync(join(out, 'release-manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  writeFileSync(join(out, 'dist-files.txt'), pkgs.flatMap((p) => p.files.map((f) => `${p.path}/${f.path}`)).concat(pkgs.map((p) => `${p.path}/dist.json`)).join('\n') + '\n');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2); const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  try {
    const m = release({ tag: opt('--tag'), commit: opt('--commit') || '' });
    console.log(`release ${m.tag}: ${m.packages.map((p) => `${p.name}@${p.version}`).join(', ')}; ${m.packs.length} pack(s) with parts`);
  } catch (e) { console.error(String(e.message || e)); process.exit(1); }
}
