#!/usr/bin/env node
// Splits an exported translation pack (scripts/export.py) into parts a static host can serve and writes the lists the app reads.
//   node scripts/pack.mjs split <export dir> <name> --out <packs dir> --direction he-en --model "<name>" --licence <id>
//                               [--revision <sha>] [--quality high] [--requires webgpu]
//   node scripts/pack.mjs probe <name> --out <packs dir> --ort <runtime dir>      record the two check lines of a pack
//   node scripts/pack.mjs manifest --out <packs dir> --ort <runtime dir>          rebuild <packs dir>/manifest.json
// <name> is the pack's folder and its key in the manifest: he-en, en-he, he-en-hq.
// Parts are at most 16 MiB so every static host takes them and a broken download resumes part by part.
// Every file is listed with its size and SHA-256; the app checks both before it uses a part.
// The pack and manifest formats are the ones the app has always read (alef.talk.nmt.pack.v1, alef.talk.nmt.manifest.v1).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const PART = 16 * 1024 * 1024;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const CHECK_LINES = { 'he-en': ['שלום, מה שלומך היום?', 'אנחנו רוצים לאכול ארוחת ערב במסעדה טובה.'], 'en-he': ['Hello, how are you today?', 'We want to eat dinner at a good restaurant.'] };

export function splitPack(src, name, o) {
  const out = join(o.out, name);
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  const files = [];
  for (const file of ['table.onnx', 'encoder.onnx', 'decoder.onnx', 'vocab.json']) {
    const buf = readFileSync(join(src, file));
    const stem = file.replace(/\.[a-z]+$/, '');
    const parts = [];
    if (file.endsWith('.json')) { writeFileSync(join(out, file), buf); parts.push({ path: `${name}/${file}`, bytes: buf.length, sha256: sha(buf) }); }
    else for (let i = 0, n = 0; i < buf.length; i += PART, n++) { const piece = buf.subarray(i, i + PART); const p = `${stem}.p${n}.bin`; writeFileSync(join(out, p), piece); parts.push({ path: `${name}/${p}`, bytes: piece.length, sha256: sha(piece) }); }
    files.push({ name: file, bytes: buf.length, sha256: sha(buf), parts });
  }
  // The graphics-card graphs (scripts/gpu_graph.py): wiring only, a few hundred KB; their weights are read from the files above.
  const gpu = [];
  for (const file of ['encoder.gpu.onnx', 'decoder.gpu.onnx']) {
    if (!existsSync(join(src, file))) continue;
    const buf = readFileSync(join(src, file)); writeFileSync(join(out, file), buf);
    gpu.push({ name: file, bytes: buf.length, sha256: sha(buf), parts: [{ path: `${name}/${file}`, bytes: buf.length, sha256: sha(buf) }] });
  }
  const pack = { schema: 'alef.talk.nmt.pack.v1', direction: o.direction, model: o.model, licence: o.licence, bytes: files.reduce((a, f) => a + f.bytes, 0), files, gpu };
  if (o.revision) pack.revision = o.revision;
  if (o.quality) pack.quality = o.quality;
  if (o.requires) pack.requires = o.requires;
  writeFileSync(join(out, 'pack.json'), JSON.stringify(pack, null, 1) + '\n');
  return pack;
}

/** Records two check lines and the answers of the graphics-card graphs (run on the processor). The app uses them to prove a graphics card. */
export async function probePack(name, o) {
  const { loadPack } = await import('./node-runtime.mjs');
  const file = join(o.out, name, 'pack.json'); const pack = JSON.parse(readFileSync(file, 'utf8'));
  const f = await loadPack({ packs: o.out, ort: o.ort, name, device: 'float' }); const q = await loadPack({ packs: o.out, ort: o.ort, name });
  pack.probe = [];
  for (const text of CHECK_LINES[pack.direction]) { const expect = await f.translate(text, { beams: 2 }); pack.probe.push({ text, expect }); console.log(name, text, '=>', expect, '| 8-bit:', await q.translate(text, { beams: 2 })); }
  writeFileSync(file, JSON.stringify(pack, null, 1) + '\n');
}

export function writeManifest(o) {
  const hash = (dir, n) => { const buf = readFileSync(join(dir, n)); return { path: n, bytes: buf.length, sha256: sha(buf) }; };
  const runtime = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].map((n) => hash(o.ort, n));
  const packs = {};
  for (const d of readdirSync(o.out).sort()) { const p = join(o.out, d, 'pack.json'); if (existsSync(p) && statSync(join(o.out, d)).isDirectory()) packs[d] = JSON.parse(readFileSync(p, 'utf8')); }
  // The runtime for browsers with a usable graphics card: it runs both ways, so such a browser fetches this one only.
  const gpuNames = ['ort.webgpu.min.mjs', 'ort-wasm-simd-threaded.asyncify.mjs', ...readdirSync(o.ort).filter((n) => /^ort-wasm-simd-threaded\.asyncify\.p\d+\.bin$/.test(n)).sort((a, b) => Number(a.match(/p(\d+)/)[1]) - Number(b.match(/p(\d+)/)[1]))];
  const gpuFiles = existsSync(join(o.ort, 'ort.webgpu.min.mjs')) ? gpuNames.map((n) => hash(o.ort, n)) : [];
  const gpuRuntime = gpuFiles.length ? { base: '../_ort/', bytes: gpuFiles.reduce((a, f) => a + f.bytes, 0), files: gpuFiles } : null;
  const version = sha(JSON.stringify([runtime, gpuRuntime, packs])).slice(0, 12);
  const m = { schema: 'alef.talk.nmt.manifest.v1', version, runtime: { base: '../_ort/', bytes: runtime.reduce((a, f) => a + f.bytes, 0), files: runtime }, gpuRuntime, packs };
  writeFileSync(join(o.out, 'manifest.json'), JSON.stringify(m, null, 1) + '\n');
  console.log('manifest', version, Object.entries(packs).map(([d, p]) => `${d} ${(p.bytes / 1048576).toFixed(1)} MiB`).join(', '));
  return m;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); if (i < 0) return ''; const v = args[i + 1]; args.splice(i, 2); return v; };
  const o = { out: flag('--out'), ort: flag('--ort'), direction: flag('--direction'), model: flag('--model'), licence: flag('--licence'), revision: flag('--revision'), quality: flag('--quality'), requires: flag('--requires') };
  const [cmd, a, b] = args;
  const need = (ok, msg) => { if (!ok) { console.error(msg); process.exit(2); } };
  need(o.out, 'usage: pack.mjs split|probe|manifest ... --out <packs dir>   (see the head of this file)');
  if (cmd === 'split') { need(a && b && o.direction && o.model && o.licence, 'split needs <export dir> <name> --direction --model --licence'); const p = splitPack(a, b, o); console.log(b, (p.bytes / 1048576).toFixed(1), 'MiB in', p.files.reduce((n, f) => n + f.parts.length, 0), 'parts'); }
  else if (cmd === 'probe') { need(a && o.ort, 'probe needs <name> --ort <runtime dir>'); await probePack(a, o); }
  else if (cmd === 'manifest') { need(o.ort, 'manifest needs --ort <runtime dir>'); writeManifest(o); }
  else need(false, `unknown command ${cmd}`);
}
