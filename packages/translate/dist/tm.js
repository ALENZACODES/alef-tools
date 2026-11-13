const MARKS = /[\u0591-\u05BD\u05BF-\u05C7]/g;
export function tmKey(he) {
 return String(he || '').normalize('NFKC').replace(MARKS, '').replace(/\u05BE/g, ' ').replace(/[^0-9A-Za-z\u05D0-\u05EA]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
const utf8 = new TextEncoder();
export function fnv1a(s) {
 let h = 0x811c9dc5;
 for (const b of utf8.encode(s)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
 return h >>> 0;
}
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
  loadedUnits: () => [...units.keys()],
 };
}
