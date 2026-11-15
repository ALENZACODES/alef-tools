// Loads translation packs under Node with the same WebAssembly runtime the browser uses (onnxruntime-web, one thread).
// Nothing is installed: point --ort at a folder that holds ort.wasm.min.mjs and ort-wasm-simd-threaded.wasm
// (in the app repo that is assets/vendor/_ort) and --packs at a folder written by scripts/pack.mjs (manifest.json + one folder a pack).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRuntime } from '../src/runtime.js';

const cache = new Map();
export async function loadOrt(ortDir) {
  const dir = resolve(ortDir);
  if (!cache.has(dir)) cache.set(dir, (async () => {
    const ort = await import(pathToFileURL(join(dir, 'ort.wasm.min.mjs')).href);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = pathToFileURL(dir).href + '/';
    ort.env.wasm.wasmBinary = readFileSync(join(dir, 'ort-wasm-simd-threaded.wasm'));
    ort.env.logLevel = 'error';
    return ort;
  })());
  return cache.get(dir);
}

export const readPack = (packsDir, name) => JSON.parse(readFileSync(join(packsDir, name, 'pack.json'), 'utf8'));

/**
 * @param {{packs:string, ort:string, name:string, device?:'wasm'|'float'}} o
 *   device 'float' runs the graphics-card graphs on the processor (same graphs, same weights, no graphics card needed).
 */
export async function loadPack(o) {
  const pack = readPack(o.packs, o.name);
  const ort = await loadOrt(o.ort);
  return createRuntime({ ort, pack, device: o.device || 'wasm', read: async (p) => { const b = readFileSync(join(o.packs, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });
}
