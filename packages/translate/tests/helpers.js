// Stand-ins for the browser's cache storage and fetch, so the download code runs under Node with nothing installed.
import { createHash } from 'node:crypto';
/** Tests run against src/ by default and against the built dist/ with ALEF_TEST_DIST=1 (CI runs both). */
export const FROM = process.env.ALEF_TEST_DIST ? '../dist/' : '../src/';
export const mod = (name) => import(new URL(FROM + name, import.meta.url).href);
export const loader = await import(new URL(process.env.ALEF_TEST_DIST ? '../../loader/dist/index.js' : '../../loader/src/index.js', import.meta.url).href);
export const sha = (buf) => createHash('sha256').update(buf).digest('hex');
export function fakeCaches() {
  const stores = new Map();
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      match: async (req) => { const hit = m.get(typeof req === 'string' ? req : req.url); return hit ? hit.clone() : undefined; },
      put: async (req, res) => { m.set(typeof req === 'string' ? req : req.url, res); },
      delete: async (req) => m.delete(typeof req === 'string' ? req : req.url),
      keys: async () => [...m.keys()].map((url) => ({ url })),
    };
  };
  return { open, delete: async (name) => stores.delete(name), stores };
}
/** @param {Record<string, Uint8Array|string|object>} files by absolute URL (without the ?v= query) */
export function fakeFetch(files, log = []) {
  return async (url) => {
    const u = String(url); log.push(u);
    const body = files[u.replace(/\?.*$/, '')];
    if (body === undefined) return new Response('', { status: 404 });
    const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
    return new Response(bytes, { status: 200 });
  };
}
export const SITE = 'https://app.example/assets/vendor/_nmt/';
export const HOST = 'https://packs.example/_nmt/';
export const HOSTS_FILE = 'https://app.example/data/talk/pack-host.json';
/** A tiny site: one ordinary pack carried by the site, one high-quality pack that lives on the host. */
export function tinySite({ published = true } = {}) {
  const bytes = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) % 251);
  const files = {};
  const part = (base, path, data) => { files[base + path] = data; return { path, bytes: data.length, sha256: sha(data) }; };
  const pack = (base, name, extra = {}) => {
    const t = part(base, `${name}/table.p0.bin`, bytes(300, 1)), e = part(base, `${name}/encoder.p0.bin`, bytes(200, 2)), d = part(base, `${name}/decoder.p0.bin`, bytes(100, 3)), v = part(base, `${name}/vocab.json`, new TextEncoder().encode('{"pieces":[]}'));
    const g1 = part(base, `${name}/encoder.gpu.onnx`, bytes(20, 4)), g2 = part(base, `${name}/decoder.gpu.onnx`, bytes(20, 5));
    return { schema: 'alef.talk.nmt.pack.v1', direction: 'he-en', model: 'test', licence: 'Apache-2.0', bytes: 600 + v.bytes, ...extra,
      files: [['table.onnx', t], ['encoder.onnx', e], ['decoder.onnx', d], ['vocab.json', v]].map(([n, p]) => ({ name: n, bytes: p.bytes, sha256: p.sha256, parts: [p] })),
      gpu: [['encoder.gpu.onnx', g1], ['decoder.gpu.onnx', g2]].map(([n, p]) => ({ name: n, bytes: p.bytes, sha256: p.sha256, parts: [p] })) };
  };
  const ort = 'https://app.example/assets/vendor/_ort/';
  const rt = (n, seed) => { const data = bytes(50, seed); files[ort + n] = data; return { path: n, bytes: 50, sha256: sha(data) }; };
  const manifest = { schema: 'alef.talk.nmt.manifest.v1', version: 'v1', runtime: { base: '../_ort/', bytes: 100, files: [rt('ort.wasm.min.mjs', 6), rt('ort-wasm-simd-threaded.wasm', 7)] },
    gpuRuntime: { base: '../_ort/', bytes: 100, files: [rt('ort.webgpu.min.mjs', 8), rt('ort-wasm-simd-threaded.asyncify.p0.bin', 9)] }, packs: { 'he-en': pack(SITE, 'he-en') } };
  files[SITE + 'manifest.json'] = manifest;
  files[HOSTS_FILE] = { hosts: [HOST], remote: { 'he-en-hq': { host: 0, published, pack: pack(HOST, 'he-en-hq', { quality: 'high', requires: 'webgpu' }) } } };
  return { files, manifest };
}
