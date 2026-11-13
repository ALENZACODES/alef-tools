import { PackError, codeOf } from './errors.js';
export const SHA_HEADER = 'x-alef-sha256';
const PACK_CACHE = /^alef-pack-([a-z0-9][a-z0-9-]*)-v1$/;
export function cacheName(pack) {
 if (!/^[a-z0-9][a-z0-9-]*$/.test(pack)) throw new PackError('bad-pack-name', pack);
 return `alef-pack-${pack}-v1`;
}
export const packOfCache = (name) => PACK_CACHE.exec(name)?.[1] ?? '';
const api = (env) => env?.caches ?? /** @type {any} */ (globalThis).caches;
export async function kept(cache, f) {
 const hit = await cache.match(f.key);
 return hit && hit.headers.get(SHA_HEADER) === f.sha256 ? hit : null;
}
const typeOf = (key) => (/\.mjs(\?|$)/.test(key) ? 'text/javascript' : /\.wasm(\?|$)/.test(key) ? 'application/wasm' : /\.json(\?|$)/.test(key) ? 'application/json' : 'application/octet-stream');
export async function keep(cache, f, bytes) {
 try {
  await cache.put(f.key, new Response(bytes, { headers: { 'content-type': typeOf(f.key), 'content-length': String(bytes.byteLength), [SHA_HEADER]: f.sha256 } }));
 } catch (e) {
  throw new PackError(codeOf(e) === 'quota' ? 'quota' : 'no-storage', String(/** @type {any} */ (e)?.message || ''));
 }
}
export async function filesState(files, env) {
 const total = files.reduce((a, f) => a + f.bytes, 0);
 const cachesApi = api(env);
 if (!cachesApi || !files.length) return { ready: false, have: 0, total, missing: total };
 const cache = await cachesApi.open(env.cacheName);
 let have = 0;
 for (const f of files) if (await kept(cache, f)) have += f.bytes;
 return { ready: have === total, have, total, missing: total - have };
}
export async function removeFiles(files, env) {
 const cachesApi = api(env);
 if (!cachesApi) return 0;
 let n = 0;
 try { const cache = await cachesApi.open(env.cacheName); for (const f of files) if (await cache.delete(f.key)) n++; } catch { /* nothing kept */ }
 return n;
}
export async function removePack(pack, env = {}) {
 const cachesApi = api(env);
 try { return cachesApi ? !!(await cachesApi.delete(env.cacheName || cacheName(pack))) : false; } catch { return false; }
}
export async function prune(name, keepKeys, env = {}, spare = (/** @type {string} */ _url) => false) {
 try {
  const keepSet = new Set(keepKeys);
  const cache = await api(env).open(name);
  for (const req of await cache.keys()) if (!keepSet.has(req.url) && !spare(req.url)) await cache.delete(req);
 } catch { /* tidy-up only */ }
}
export async function readFile(name, parts, env = {}) {
 const cachesApi = api(env);
 if (!cachesApi) throw new PackError('no-storage');
 const cache = await cachesApi.open(name);
 const out = new Uint8Array(parts.reduce((a, p) => a + p.bytes, 0));
 let at = 0;
 for (const p of parts) {
  const hit = await kept(cache, p);
  if (!hit) throw new PackError('not-downloaded', p.key);
  const b = new Uint8Array(await hit.arrayBuffer());
  if (b.byteLength !== p.bytes) throw new PackError('size-mismatch', p.key);
  out.set(b, at); at += b.byteLength;
 }
 return out;
}
export async function listPacks(env = {}) {
 const cachesApi = api(env);
 if (!cachesApi) return [];
 const out = [];
 let names = [];
 try { names = await cachesApi.keys(); } catch { return []; }
 for (const name of names) {
  const pack = packOfCache(name) || env.extra?.[name];
  if (!pack) continue;
  const cache = await cachesApi.open(name);
  let bytes = 0, files = 0;
  for (const req of await cache.keys()) { const hit = await cache.match(req); if (!hit) continue; files++; bytes += Number(hit.headers.get('content-length')) || 0; }
  out.push({ pack, cache: name, bytes, files });
 }
 return out.sort((a, b) => a.pack.localeCompare(b.pack));
}
