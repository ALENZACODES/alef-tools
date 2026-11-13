// @ts-check
// Translation packs: finding, downloading, checking and keeping the pack files. No DOM.
// A pack is never part of a first install. It is fetched only when the learner asks for it, part by part (16 MiB at most),
// each part checked against the size and SHA-256 in the manifest, and kept in its own cache so an app update does not throw it away.
// The downloading, checking and keeping is the shared loader's (packages/loader); this file maps the Talk pack list onto it.
// The host app says where things live (createPackStore); nothing here names an address of its own.

/**
 * @param {{loader:any, base:string, cacheName:string, hostsFile?:string, ortLocal?:string, label?:string}} cfg
 *   loader: the shared language pack loader (packages/loader). It does the downloading, checking and keeping; this file only
 *   maps the Talk pack list (alef.talk.nmt.manifest.v1) onto it. Never import a second copy of the loader: the app hands it in.
 *   base: the folder of the site that holds manifest.json and the packs it carries (ends with "/").
 *   cacheName: the cache the pack files are kept in.  hostsFile: a JSON file of the site that names pack hosts and remote packs.
 *   ortLocal: where the runtime's code files are on the site (default: ../_ort/ beside base).
 */
export function createPackStore(cfg) {
const { loader } = cfg;
const { versioned } = loader;
const PACK_CACHE = cfg.cacheName;
const NMT_BASE = cfg.base;
/** The runtime's code files always come from the site itself, wherever the data files come from. */
const ORT_LOCAL = cfg.ortLocal || new URL('../_ort/', NMT_BASE).href;
const HOSTS_FILE = cfg.hostsFile || '';

/**
 * Every file one pack needs: the runtime (shared by both directions) and the parts of the pack.
 * `key` is the address the file is kept under; `url` is where it is fetched from.
 * With `gpu` the list is the one for a browser with a usable graphics card: the runtime that can use it (it also runs the
 * ordinary way) and two small graphs that read their weights from the same pack parts. The pack parts are the same either way.
 * @param {any} manifest @param {string} direction the pack's name in the manifest: a direction (he-en, en-he) or a named pack (he-en-hq) @param {string|{base?:string, gpu?:boolean}} [opts]
 * @returns {{key:string, url:string, bytes:number, sha256:string}[]}
 */
function packFiles(manifest, direction, opts = {}) {
  const base = (typeof opts === 'string' ? opts : opts.base) || manifest?.base || NMT_BASE;
  const gpu = typeof opts === 'object' && !!opts.gpu && !!manifest?.gpuRuntime && !!manifest?.packs?.[direction]?.gpu?.length;
  const pack = manifest?.packs?.[direction];
  if (!pack) return [];
  const out = [];
  const runtime = gpu ? manifest.gpuRuntime : manifest.runtime;
  const rt = new URL(runtime.base, base).href;
  // code (.mjs) from the site itself; the WebAssembly, like every other data file, from wherever the packs are
  for (const f of runtime.files) { const at = (/\.mjs$/.test(f.path) && base !== NMT_BASE ? ORT_LOCAL : rt) + f.path; out.push({ key: at, url: versioned(at, f.sha256), bytes: f.bytes, sha256: f.sha256 }); }
  const from = pack.base || base;   // a remote pack (pack.base) is fetched from its host; the runtime still comes with the site's own list
  for (const f of [...pack.files, ...(gpu ? pack.gpu : [])]) for (const p of f.parts) { const u = versioned(from + p.path, p.sha256); out.push({ key: u, url: u, bytes: p.bytes, sha256: p.sha256 }); }
  return out;
}

/**
 * The pack list. The site's own copy is tried first. A copy of the site built without the packs has none, and then the hosts
 * named in data/talk/pack-host.json are tried in order. The list remembers where it came from (`base`), and every pack part is
 * fetched from there. Offline, the copy saved with the pack is used.
 * @param {{caches?:any, fetch?:any}} [env]
 */
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
  // The hosts file of the site: where packs are fetched from when this copy of the site does not carry them, and the packs that
  // live only on a host ("remote", listed part by part with sizes and SHA-256, so a host cannot hand out anything else).
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
  // From another address the request must stay a plain one (no cache directive: that adds a header the host would have to approve first).
  for (const h of hosts) { try { return withRemote(await tryBase(h, { mode: 'cors' })); } catch { /* next host */ } }
  // offline: the list saved with the pack, from wherever it came
  if (cachesApi) {
    const cache = await cachesApi.open(PACK_CACHE);
    for (const base of [NMT_BASE, ...hosts]) { const hit = await cache.match(base + 'manifest.json'); if (hit) return withRemote(Object.assign(await hit.json(), { base })); }
    for (const req of await cache.keys()) if (/\/manifest\.json$/.test(req.url)) { const hit = await cache.match(req); if (hit) return withRemote(Object.assign(await hit.json(), { base: req.url.replace(/manifest\.json$/, '') })); }
  }
  throw new Error('no pack list');
}

/**
 * What is on the device for one pack. `gpu` in env says this browser has a usable graphics card.
 * A pack counts as ready when either set of files is complete; the graphics-card set is preferred when it is complete,
 * and it is the set a new download fetches on a browser that can use it.
 * @param {any} manifest @param {string} name @param {{caches?:any, gpu?:boolean}} [env]
 * @returns {Promise<{ready:boolean, gpu:boolean, have:number, total:number, missing:number}>} bytes kept, needed and still to fetch
 */
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

/** Every address the current list names, for any pack and either way of running, plus the lists themselves. */
function namedKeys(manifest) {
  const keep = [(manifest.base || NMT_BASE) + 'manifest.json'];
  if (HOSTS_FILE) keep.push(HOSTS_FILE);
  for (const d of Object.keys(manifest.packs || {})) for (const gpu of [false, true]) for (const f of packFiles(manifest, d, { gpu })) keep.push(f.key);
  return keep;
}

/**
 * Fetches what is missing, one part at a time. A part that fails its check is not kept. Safe to call again after a break:
 * parts already kept are skipped. `userStarted` must be true when the learner pressed the button: on Shabbat and Yom Tov
 * nothing else may start a download. "Only on Wi-Fi", the learner's storage limit and free space are checked first.
 * Rejects with the loader's PackError; its `code` says why.
 * @param {any} manifest @param {string} name
 * @param {{userStarted?:boolean, onProgress?:(have:number,total:number)=>void, signal?:AbortSignal, caches?:any, fetch?:any, subtle?:any, gpu?:boolean, now?:number, navigator?:any, storage?:any}} [opts]
 */
async function downloadPack(manifest, name, opts = {}) {
  const gpu = !!opts.gpu;
  const done = await loader.downloadFiles(packFiles(manifest, name, { gpu }), {
    ...opts, gpu, cacheName: PACK_CACHE, origin: new URL(NMT_BASE).origin,
    extra: { [PACK_CACHE]: cfg.label || 'talk' }, // this cache has an older name; it still counts toward the learner's storage limit
    // Drops kept files the current list no longer names (an older pack version). engine-<name>.json is the remembered
    // outcome of the graphics-card check (worker.js); it carries the pack version.
    keepKeys: namedKeys(manifest), spare: (url) => url.includes('/engine-') && url.endsWith(`?v=${manifest.version}`),
  });
  return { ...done, gpu };
}

/** Removes every pack and the runtime from this device. */
async function removePacks(env = {}) {
  return loader.removePack(cfg.label || 'talk', { caches: env.caches, cacheName: PACK_CACHE });
}

/**
 * Removes one pack from this device. The runtime the packs share goes too when no other pack is kept,
 * so nothing is left behind that nothing can use.
 * @param {any} manifest @param {string} name @param {{caches?:any}} [env]
 */
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

/** True when this browser hands out a real graphics adapter (a software stand-in does not count). */
const hasGraphics = (nav = globalThis.navigator, force = false) => loader.hasGraphics({ navigator: nav ?? {}, force });

return { packFiles, loadManifest, packState, downloadPack, removePacks, removePack, hasGraphics, cacheName: PACK_CACHE, base: NMT_BASE, ortLocal: ORT_LOCAL, hostsFile: HOSTS_FILE };
}
