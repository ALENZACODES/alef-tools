// Shared by the scripts: where things are, and the list of packages that have something built.
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Packages with a package.json (placeholders have only a README). @returns {{dir:string, name:string, pkg:any}[]} */
export function packages(root = ROOT) {
  const base = join(root, 'packages');
  return readdirSync(base).sort().filter((n) => existsSync(join(base, n, 'package.json')))
    .map((n) => ({ dir: join(base, n), name: n, pkg: JSON.parse(readFileSync(join(base, n, 'package.json'), 'utf8')) }));
}
