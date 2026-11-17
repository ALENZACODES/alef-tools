export function createPackStore(cfg) {
const { loader } = cfg;
const { versioned } = loader;
const PACK_CACHE = cfg.cacheName;
const NMT_BASE = cfg.base;
const ORT_LOCAL = cfg.ortLocal || new URL('../_ort/', NMT_BASE).href;
const HOSTS_FILE = cfg.hostsFile || '';
function packFiles(manifest, direction, opts = {}) {
 const base = (typeof opts === 'string' ? opts : opts.base) || manifest?.base || NMT_BASE;
 const gpu = typeof opts === 'object' && !!opts.gpu && !!manifest?.gpuRuntime && !!manifest?.packs?.[direction]?.gpu?.length;
 const pack = manifest?.packs?.[direction];
 if (!pack) return [];
 const out = [];
 const runtime = gpu ? manifest.gpuRuntime : manifest.runtime;
 const rt = new URL(runtime.base, base).href;
 for (const f of runtime.files) { const at = (/\.mjs$/.test(f.path) && base !== NMT_BASE ? ORT_LOCAL : rt) + f.path; out.push({ key: at, url: versioned(at, f.sha256), bytes: f.bytes, sha256: f.sha256 }); }
 const from = pack.base || base;   // a remote pack (pack.base) is fetched from its host; the runtime still comes with the site's own list
 for (const f of [...pack.files, ...(gpu ? pack.gpu : [])]) for (const p of f.parts) { const u = versioned(from + p.path, p.sha256); out.push({ key: u, url: u, bytes: p.bytes, sha256: p.sha256 }); }
 return out;
}
async function loadManifest(env = {}) {
 const cachesApi = env.caches ?? globalThis.caches; const fetchImpl = env.fetch ?? globalThis.fetch;
 const tryBase = async (base, opts) => {
  const url = base + 'manifest.json';
  const res = await fetchImpl(url, opts);
  if (!res.ok) throw new Error(String(res.status));
  const copy = res.clone();
  const m = await res.json();
  if (!m || !m.packs) throw new Error('not a pack list');
  try { await (await cachesApi.open(PACK_CACHE)).put(url, copy); } catch { /* no cache storage: the pack cannot be kept, state() will say so */ }
  return Object.assign(m, { base });
 };
 let doc = null;
 if (HOSTS_FILE) {
  try { const r = await fetchImpl(HOSTS_FILE); if (r.ok) { const copy = r.clone(); doc = await r.json(); try { await (await cachesApi.open(PACK_CACHE)).put(HOSTS_FILE, copy); } catch { /* not kept */ } } } catch { /* offline */ }
  if (!doc && cachesApi) { try { const hit = await (await cachesApi.open(PACK_CACHE)).match(HOSTS_FILE); if (hit) doc = await hit.json(); } catch { /* none kept */ } }
 }
 const hosts = ((doc && doc.hosts) || []).filter((h) => /^https?:\/\/.+\/$/.test(h));
 const withRemote = (m) => {
  for (const [name, r] of Object.entries((doc && doc.remote) || {})) {
   const host = hosts[/** @type {any} */ (r).host || 0];
   if (!/** @type {any} */ (r).published || !host || m.packs[name] || !/** @type {any} */ (r).pack) continue;
   m.packs[name] = { .../** @type {any} */ (r).pack, base: host };
  }
  return m;
 };
 try { return withRemote(await tryBase(NMT_BASE, { cache: 'no-cache' })); } catch { /* not carried by this copy of the site, or offline */ }
 for (const h of hosts) { try { return withRemote(await tryBase(h, { mode: 'cors' })); } catch { /* next host */ } }
 if (cachesApi) {
  const cache = await cachesApi.open(PACK_CACHE);
  for (const base of [NMT_BASE, ...hosts]) { const hit = await cache.match(base + 'manifest.json'); if (hit) return withRemote(Object.assign(await hit.json(), { base })); }
  for (const req of await cache.keys()) if (/\/manifest\.json$/.test(req.url)) { const hit = await cache.match(req); if (hit) return withRemote(Object.assign(await hit.json(), { base: req.url.replace(/manifest\.json$/, '') })); }
 }
 throw new Error('no pack list');
}
async function packState(manifest, name, env = {}) {
 const count = async (gpu) => ({ gpu, ...(await loader.filesState(packFiles(manifest, name, { gpu }), { cacheName: PACK_CACHE, caches: env.caches })) });
 const order = ({ ready, gpu, have, total, missing }) => ({ ready, gpu, have, total, missing });
 const plain = await count(false);
 const canGpu = !!env.gpu && packFiles(manifest, name, { gpu: true }).some((f) => /\.gpu\.onnx/.test(f.key));
 if (!canGpu) return order(plain);
 const fast = await count(true);
 if (fast.ready || !plain.ready) return order(fast);
 return order(plain);
}
function namedKeys(manifest) {
 const keep = [(manifest.base || NMT_BASE) + 'manifest.json'];
 if (HOSTS_FILE) keep.push(HOSTS_FILE);
 for (const d of Object.keys(manifest.packs || {})) for (const gpu of [false, true]) for (const f of packFiles(manifest, d, { gpu })) keep.push(f.key);
 return keep;
}
async function downloadPack(manifest, name, opts = {}) {
 const gpu = !!opts.gpu;
 const done = await loader.downloadFiles(packFiles(manifest, name, { gpu }), {
  ...opts, gpu, cacheName: PACK_CACHE, origin: new URL(NMT_BASE).origin,
  extra: { [PACK_CACHE]: cfg.label || 'talk' }, // this cache has an older name; it still counts toward the learner's storage limit
  keepKeys: namedKeys(manifest), spare: (url) => url.includes('/engine-') && url.endsWith(`?v=${manifest.version}`),
 });
 return { ...done, gpu };
}
async function removePacks(env = {}) {
 return loader.removePack(cfg.label || 'talk', { caches: env.caches, cacheName: PACK_CACHE });
}
async function removePack(manifest, name, env = {}) {
 const others = Object.keys(manifest?.packs || {}).filter((d) => d !== name);
 const mine = new Map(), theirs = new Set(); let otherKept = false;
 for (const gpu of [false, true]) {
  for (const f of packFiles(manifest, name, { gpu })) mine.set(f.key, f);
  for (const d of others) {
   const files = packFiles(manifest, d, { gpu });
   if (files.length && (await loader.filesState(files, { cacheName: PACK_CACHE, caches: env.caches })).ready) { otherKept = true; for (const f of files) theirs.add(f.key); }
  }
 }
 if (!otherKept) return removePacks(env);
 return (await loader.removeFiles([...mine.values()].filter((f) => !theirs.has(f.key)), { cacheName: PACK_CACHE, caches: env.caches })) > 0;
}
const hasGraphics = (nav = globalThis.navigator, force = false) => loader.hasGraphics({ navigator: nav ?? {}, force });
return { packFiles, loadManifest, packState, downloadPack, removePacks, removePack, hasGraphics, cacheName: PACK_CACHE, base: NMT_BASE, ortLocal: ORT_LOCAL, hostsFile: HOSTS_FILE };
}
