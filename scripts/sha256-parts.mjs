#!/usr/bin/env node
// Splits one file into parts of at most 16 MiB and prints its entry for a pack list (alef.pack.v1), with sizes and SHA-256.
// Reads the file as a stream, so a multi-gigabyte file never sits in memory.
//   node scripts/sha256-parts.mjs <file> --out <dir> [--name model.int8.onnx] [--variant webgpu|wasm] [--part-bytes N]
//   node scripts/sha256-parts.mjs --pack <name> --version <v> --out <dir> <file> [<file> ...]   writes <dir>/pack.json too
import { createReadStream, createWriteStream, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';

export const MAX_PART_BYTES = 16 * 1048576;

/**
 * @param {string} file @param {{out:string, name?:string, variant?:string, partBytes?:number}} opts
 * @returns {Promise<{name:string, variant?:string, bytes:number, sha256:string, parts:{path:string, bytes:number, sha256:string}[]}>}
 */
export async function splitFile(file, opts) {
  const partBytes = opts.partBytes ?? MAX_PART_BYTES;
  if (!(partBytes > 0) || partBytes > MAX_PART_BYTES) throw new Error(`part size must be between 1 and ${MAX_PART_BYTES} bytes`);
  const name = opts.name || basename(file);
  mkdirSync(opts.out, { recursive: true });
  const whole = createHash('sha256'); const parts = [];
  let cur = null, curHash = null, curBytes = 0, total = 0;
  const open = () => { const path = `${name}.p${String(parts.length).padStart(3, '0')}`; cur = createWriteStream(join(opts.out, path)); curHash = createHash('sha256'); curBytes = 0; return path; };
  const close = async (path) => { cur.end(); await once(cur, 'finish'); parts.push({ path, bytes: curBytes, sha256: curHash.digest('hex') }); cur = null; };
  let path = null;
  for await (const chunk of createReadStream(file, { highWaterMark: 1 << 20 })) {
    whole.update(chunk); total += chunk.length;
    let at = 0;
    while (at < chunk.length) {
      if (!cur) path = open();
      const take = Math.min(chunk.length - at, partBytes - curBytes);
      const piece = chunk.subarray(at, at + take);
      curHash.update(piece); curBytes += take; at += take;
      if (!cur.write(piece)) await once(cur, 'drain');
      if (curBytes === partBytes) await close(path);
    }
  }
  if (cur) await close(path);
  if (!total) throw new Error(`${file} is empty`);
  if (total !== statSync(file).size) throw new Error(`${file} changed while it was read`);
  return { name, ...(opts.variant ? { variant: opts.variant } : {}), bytes: total, sha256: whole.digest('hex'), parts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const out = opt('--out'), name = opt('--name'), variant = opt('--variant'), pack = opt('--pack'), version = opt('--version'), partBytes = opt('--part-bytes');
  if (!out || !args.length) { console.error('usage: sha256-parts.mjs <file> --out <dir> [--name N] [--variant webgpu|wasm]\n       sha256-parts.mjs --pack <name> --version <v> --out <dir> <file>...'); process.exit(2); }
  const entries = [];
  for (const f of args) entries.push(await splitFile(f, { out, name: args.length === 1 ? name : undefined, variant, partBytes: partBytes ? Number(partBytes) : undefined }));
  if (pack) {
    const list = { schema: 'alef.pack.v1', pack, version: version || '1', files: entries };
    writeFileSync(join(out, 'pack.json'), JSON.stringify(list, null, 1) + '\n');
    console.log(`${out}/pack.json: ${entries.length} file(s), ${entries.reduce((a, e) => a + e.parts.length, 0)} part(s), ${entries.reduce((a, e) => a + e.bytes, 0)} bytes`);
  } else console.log(JSON.stringify(entries.length === 1 ? entries[0] : entries, null, 1));
}
