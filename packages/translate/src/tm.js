// @ts-check
// Translation memory: Hebrew sentences of the app with an English line each, built ahead of time (scripts/build-tm.py).
// Pure lookups: no DOM, no storage. Nothing is fetched until a line is looked up; then the small index, and a unit file only
// when the index says the line is in it. Every file comes from the folder the host app names (its own site).

const MARKS = /[\u0591-\u05BD\u05BF-\u05C7]/g;

/** The key of a Hebrew line: vowel points and cantillation dropped, punctuation to spaces. The same key scripts/tm_gates.py builds. @param {string} he */
export function tmKey(he) {
  return String(he || '').normalize('NFKC').replace(MARKS, '').replace(/\u05BE/g, ' ').replace(/[^0-9A-Za-z\u05D0-\u05EA]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

const utf8 = new TextEncoder();
/** 32-bit FNV-1a of the UTF-8 bytes. @param {string} s */
export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (const b of utf8.encode(s)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** @param {string} b64 @returns {Uint32Array} sorted hashes */
function hashes(b64) {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Uint32Array(bytes.buffer, 0, bytes.length >> 2);
}
function has(sorted, x) {
  let lo = 0, hi = sorted.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (sorted[mid] === x) return true; if (sorted[mid] < x) lo = mid + 1; else hi = mid - 1; }
  return false;
}

/**
 * @param {{base:string, fetch?:typeof fetch}} cfg  base: the folder that holds index.json and the unit files (ends with "/")
 */
export function createMemory(cfg) {
  const fetchImpl = cfg.fetch || globalThis.fetch;
  /** @type {Promise<any>|null} */ let indexP = null;
  /** @type {Map<string, Promise<Map<string, [string, string]>>>} */ const units = new Map();
  const index = () => (indexP ||= (async () => {
    const r = await fetchImpl(cfg.base + 'index.json'); if (!r.ok) throw new Error(String(r.status));
    const idx = await r.json();
    return { ...idx, units: (idx.units || []).map((u) => ({ ...u, set: hashes(u.hashes) })) };
  })().catch((e) => { indexP = null; throw e; }));
  const unit = (u) => { if (!units.has(u.id)) units.set(u.id, (async () => { const r = await fetchImpl(cfg.base + u.file); if (!r.ok) throw new Error(String(r.status)); const d = await r.json(); return new Map(d.entries.map((e) => [e[0], [e[1], e[2]]])); })().catch((e) => { units.delete(u.id); throw e; })); return units.get(u.id); };
  return {
    /**
     * The stored English of a Hebrew sentence, or null. Never throws: offline with nothing kept, it answers null.
     * @param {string} he @returns {Promise<{en:string, unit:string, source:'app'|'pack'}|null>}
     */
    async lookup(he) {
      const key = tmKey(he);
      if (!key || key.split(' ').length < 3) return null;
      try {
        const idx = await index(); const h = fnv1a(key);
        for (const u of idx.units) {
          if (!has(u.set, h)) continue;
          const hit = (await unit(u)).get(key);
          if (hit) return { en: hit[0], unit: u.id, source: hit[1] === 'p' ? 'pack' : 'app' };
        }
      } catch { /* no memory on this device right now */ }
      return null;
    },
    /** Units fetched so far (for tests and the size note). */
    loadedUnits: () => [...units.keys()],
  };
}
