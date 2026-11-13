// @ts-check
// Finding, downloading, checking and keeping language pack files. No DOM.
// A pack is fetched only when asked for, part by part (16 MiB at most), each part checked against the size and SHA-256
// its list names, and kept in the pack's own cache so an app update does not throw it away.
import { PackError, codeOf } from './errors.js';
import { cacheName, kept, keep, filesState, prune, removePack } from './cache.js';
import { tooFull, overLimit, askPersistOnce } from './budget.js';
import { canRun, checkConnection, hasGraphics } from './device.js';
import { requireAllowed } from './shabbat.js';

export const MAX_PART_BYTES = 16 * 1048576;
export const PACK_SCHEMA = 'alef.pack.v1';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
/** Every address carries the start of the file's hash, so a stale copy can never be served for a new list. */
export const versioned = (url, sha) => `${url}?v=${sha.slice(0, 16)}`;

/**
 * A pack list (alef.pack.v1) as a flat list of parts to fetch.
 * @param {any} list @param {{base:string, gpu?:boolean}} opts `base` is the folder that holds pack.json (ends with /)
 * @returns {{name:string, key:string, url:string, bytes:number, sha256:string}[]}
 */
export function expandPack(list, opts) {
  if (!list || list.schema !== PACK_SCHEMA || !Array.isArray(list.files)) throw new PackError('bad-pack-list');
  const out = [];
  for (const f of list.files) {
    if (f.variant === 'webgpu' && !opts.gpu) continue;
    if (f.variant === 'wasm' && opts.gpu) continue;
    for (const p of f.parts) { const u = versioned(new URL(p.path, opts.base).href, p.sha256); out.push({ name: f.name, key: u, url: u, bytes: p.bytes, sha256: p.sha256 }); }
  }
  return out;
}

/**
 * Reads a pack's list from the first base that has it and saves a copy with the pack. Offline, the saved copy is used.
 * @param {string} pack @param {{bases:string[], fetch?:any, caches?:any, cacheName?:string, origin?:string}} env each base ends with /
 * @returns {Promise<any>} the list, with `base` set to the folder it came from
 */
export async function fetchPackList(pack, env) {
  const fetchImpl = env.fetch ?? globalThis.fetch; const cachesApi = env.caches ?? /** @type {any} */ (globalThis).caches;
  const name = env.cacheName || cacheName(pack);
  const origin = env.origin ?? /** @type {any} */ (globalThis).location?.origin ?? '';
  const urls = env.bases.map((b) => ({ base: new URL(`${pack}/`, b).href, url: new URL(`${pack}/pack.json`, b).href }));
  for (const { base, url } of urls) {
    try {
      // To another address the request stays a plain one: a cache directive adds a header the host would have to approve first.
      const res = await fetchImpl(url, origin && url.startsWith(origin + '/') ? { cache: 'no-cache' } : { mode: 'cors' });
      if (!res.ok) continue;
      const copy = res.clone();
      const list = await res.json();
      if (list?.schema !== PACK_SCHEMA || list.pack !== pack) continue;
      try { await (await cachesApi.open(name)).put(url, copy); } catch { /* no cache storage: state() will say so */ }
      return Object.assign(list, { base });
    } catch { /* next base, or offline */ }
  }
  if (cachesApi) {
    try { const cache = await cachesApi.open(name); for (const { base, url } of urls) { const hit = await cache.match(url); if (hit) return Object.assign(await hit.json(), { base }); } } catch { /* nothing saved */ }
  }
  throw new PackError('no-pack-list', pack);
}

/**
 * What a download would fetch, and every reason it may not start. Nothing is fetched.
 * @param {{key:string, bytes:number, sha256:string}[]} files
 * @param {{cacheName:string, userStarted?:boolean, device?:{webgpu?:boolean, minRamGB?:number}, now?:number, caches?:any, navigator?:any, storage?:any, gpu?:boolean}} opts
 * @returns {Promise<{total:number, have:number, missing:number, ok:boolean, blocked:string[]}>}
 */
export async function planDownload(files, opts) {
  const blocked = [];
  const cachesApi = opts.caches ?? /** @type {any} */ (globalThis).caches;
  if (!cachesApi) blocked.push('no-storage');
  const st = await filesState(files, opts);
  if (files.some((f) => f.bytes > MAX_PART_BYTES)) blocked.push('part-too-large');
  try { requireAllowed('download', opts); } catch { blocked.push('shabbat'); }
  if (st.missing > 0) {
    try { checkConnection(opts); } catch { blocked.push('wifi-only'); }
    if (!(await canRun(opts.device, opts)).ok) blocked.push('cannot-run');
    if (await tooFull(st.missing, opts)) blocked.push('too-full');
    if (await overLimit(st.missing, opts)) blocked.push('over-limit');
  }
  return { ...st, ok: !blocked.length, blocked };
}

async function fetchPart(f, opts, onBytes) {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const origin = opts.origin ?? /** @type {any} */ (globalThis).location?.origin ?? '';
  const own = !!origin && f.url.startsWith(origin + '/');
  let res;
  try { res = await fetchImpl(f.url, own ? { cache: 'no-store', signal: opts.signal } : { mode: 'cors', signal: opts.signal }); } catch (e) { throw new PackError(codeOf(e) === 'aborted' ? 'aborted' : 'fetch', String(/** @type {any} */ (e)?.message || '')); }
  if (!res.ok) throw new PackError('fetch', String(res.status));
  const chunks = []; let got = 0;
  try {
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.byteLength; if (got > f.bytes) { try { await reader.cancel(); } catch { /* closed */ } break; } onBytes(got); }
    } else { const b = new Uint8Array(await res.arrayBuffer()); chunks.push(b); got = b.byteLength; }
  } catch (e) { throw new PackError(codeOf(e) === 'aborted' ? 'aborted' : 'fetch', String(/** @type {any} */ (e)?.message || '')); }
  if (got !== f.bytes) throw new PackError('size-mismatch', f.key);
  const buf = new Uint8Array(got); let at = 0;
  for (const c of chunks) { buf.set(c, at); at += c.byteLength; }
  const subtle = opts.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) throw new PackError('no-hash');
  if (hex(await subtle.digest('SHA-256', buf)) !== f.sha256) throw new PackError('hash-mismatch', f.key);
  return buf;
}

/**
 * Fetches what is missing, one part at a time. A part that fails its check is not kept. Safe to call again after a break:
 * parts already kept are skipped, so an interrupted download carries on from the last whole part.
 * @param {{key:string, url:string, bytes:number, sha256:string}[]} files
 * @param {{cacheName:string, userStarted?:boolean, device?:{webgpu?:boolean, minRamGB?:number}, onProgress?:(have:number,total:number)=>void, signal?:AbortSignal,
 *   retries?:number, keepKeys?:string[], spare?:(url:string)=>boolean, now?:number, fetch?:any, caches?:any, subtle?:any, navigator?:any, storage?:any, origin?:string, gpu?:boolean}} opts
 * @returns {Promise<{ready:true, have:number, total:number, missing:0}>}
 */
export async function downloadFiles(files, opts) {
  const plan = await planDownload(files, opts);
  if (!plan.ok) throw new PackError(plan.blocked[0]);
  const cachesApi = opts.caches ?? /** @type {any} */ (globalThis).caches;
  const cache = await cachesApi.open(opts.cacheName);
  const total = plan.total; let have = 0;
  const retries = opts.retries ?? 1;
  for (const f of files) {
    if (await kept(cache, f)) { have += f.bytes; opts.onProgress?.(have, total); continue; }
    if (opts.signal?.aborted) throw new PackError('aborted');
    let buf = null;
    for (let attempt = 0; ; attempt++) {
      try { buf = await fetchPart(f, opts, (got) => opts.onProgress?.(have + Math.min(got, f.bytes), total)); break; } catch (e) {
        // one more try for a dropped connection or a damaged part; anything else, and a second failure, stops the download
        if (attempt >= retries || !['fetch', 'size-mismatch', 'hash-mismatch'].includes(codeOf(e))) throw e;
      }
    }
    await keep(cache, f, buf);
    have += f.bytes; opts.onProgress?.(have, total);
  }
  if (opts.keepKeys) await prune(opts.cacheName, [...opts.keepKeys, ...files.map((f) => f.key)], opts, opts.spare);
  await askPersistOnce(opts);
  return { ready: true, have, total, missing: 0 };
}

/**
 * One alef.pack.v1 pack, start to finish: its list, the checks, the download, and pruning of an older version.
 * @param {string} pack @param {Parameters<typeof downloadFiles>[1] & {bases:string[]}} opts `cacheName` may be left out
 */
export async function downloadPack(pack, opts) {
  const name = opts.cacheName || cacheName(pack);
  const env = { ...opts, cacheName: name };
  const gpu = 'gpu' in opts ? !!opts.gpu : await hasGraphics(opts);
  const list = await fetchPackList(pack, env);
  const files = expandPack(list, { base: list.base, gpu });
  const listUrl = new URL('pack.json', list.base).href;
  const done = await downloadFiles(files, { ...env, gpu, keepKeys: [listUrl] });
  return { ...done, version: list.version, gpu };
}

/** What is on the device for one alef.pack.v1 pack. Rejects with `no-pack-list` when the list cannot be read and none was saved. */
export async function packState(pack, opts) {
  const name = opts.cacheName || cacheName(pack);
  const gpu = 'gpu' in opts ? !!opts.gpu : await hasGraphics(opts);
  const list = await fetchPackList(pack, { ...opts, cacheName: name });
  const files = expandPack(list, { base: list.base, gpu });
  return { ...(await filesState(files, { ...opts, cacheName: name })), version: list.version, gpu, files };
}

export { removePack };
