// @ts-check
// Where language pack files are kept on the device: one Cache Storage cache per pack. No DOM, no network.
// A file counts as kept only when the stored copy carries the SHA-256 the pack list names.
import { PackError, codeOf } from './errors.js';

export const SHA_HEADER = 'x-alef-sha256';
const PACK_CACHE = /^alef-pack-([a-z0-9][a-z0-9-]*)-v1$/;

/** @param {string} pack */
export function cacheName(pack) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pack)) throw new PackError('bad-pack-name', pack);
  return `alef-pack-${pack}-v1`;
}
/** The pack a cache belongs to, or '' when it is not a pack cache. @param {string} name */
export const packOfCache = (name) => PACK_CACHE.exec(name)?.[1] ?? '';

const api = (env) => env?.caches ?? /** @type {any} */ (globalThis).caches;

/** The kept copy of one file, or null. @param {any} cache @param {{key:string, sha256:string}} f */
export async function kept(cache, f) {
  const hit = await cache.match(f.key);
  return hit && hit.headers.get(SHA_HEADER) === f.sha256 ? hit : null;
}

const typeOf = (key) => (/\.mjs(\?|$)/.test(key) ? 'text/javascript' : /\.wasm(\?|$)/.test(key) ? 'application/wasm' : /\.json(\?|$)/.test(key) ? 'application/json' : 'application/octet-stream');

/** Keeps checked bytes. A full disk comes back as PackError('quota'). @param {any} cache @param {{key:string, sha256:string}} f @param {Uint8Array} bytes */
export async function keep(cache, f, bytes) {
  try {
    await cache.put(f.key, new Response(bytes, { headers: { 'content-type': typeOf(f.key), 'content-length': String(bytes.byteLength), [SHA_HEADER]: f.sha256 } }));
  } catch (e) {
    throw new PackError(codeOf(e) === 'quota' ? 'quota' : 'no-storage', String(/** @type {any} */ (e)?.message || ''));
  }
}

/**
 * Bytes kept, needed and still to fetch for a list of files.
 * @param {{key:string, bytes:number, sha256:string}[]} files @param {{cacheName:string, caches?:any}} env
 * @returns {Promise<{ready:boolean, have:number, total:number, missing:number}>}
 */
export async function filesState(files, env) {
  const total = files.reduce((a, f) => a + f.bytes, 0);
  const cachesApi = api(env);
  if (!cachesApi || !files.length) return { ready: false, have: 0, total, missing: total };
  const cache = await cachesApi.open(env.cacheName);
  let have = 0;
  for (const f of files) if (await kept(cache, f)) have += f.bytes;
  return { ready: have === total, have, total, missing: total - have };
}

/** Deletes the named files from one cache; other files in it stay. Returns how many were deleted. */
export async function removeFiles(files, env) {
  const cachesApi = api(env);
  if (!cachesApi) return 0;
  let n = 0;
  try { const cache = await cachesApi.open(env.cacheName); for (const f of files) if (await cache.delete(f.key)) n++; } catch { /* nothing kept */ }
  return n;
}

/** Deletes a whole pack from the device. @param {string} pack @param {{caches?:any, cacheName?:string}} [env] */
export async function removePack(pack, env = {}) {
  const cachesApi = api(env);
  try { return cachesApi ? !!(await cachesApi.delete(env.cacheName || cacheName(pack))) : false; } catch { return false; }
}

/** Drops kept entries the current list no longer names (an older version of the pack). `spare` protects extra entries. */
export async function prune(name, keepKeys, env = {}, spare = (/** @type {string} */ _url) => false) {
  try {
    const keepSet = new Set(keepKeys);
    const cache = await api(env).open(name);
    for (const req of await cache.keys()) if (!keepSet.has(req.url) && !spare(req.url)) await cache.delete(req);
  } catch { /* tidy-up only */ }
}

/**
 * The bytes of one logical file, joined from its kept parts in order. Used by workers to hand a model to the runtime.
 * @param {string} name cache name @param {{key:string, bytes:number, sha256:string}[]} parts @param {{caches?:any}} [env]
 * @returns {Promise<Uint8Array>}
 */
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

/**
 * Every pack cache on the device with the bytes it holds (from the stored content-length; no body is read).
 * `extra` names caches that do not follow the alef-pack-<name>-v1 pattern but hold pack files (the older Talk cache).
 * @param {{caches?:any, extra?:Record<string,string>}} [env] @returns {Promise<{pack:string, cache:string, bytes:number, files:number}[]>}
 */
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
