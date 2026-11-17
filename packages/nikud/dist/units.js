export const SOURCE_NOTE = Object.freeze({
 book: '',
 checked: '',
 model: 'These vowel marks have not been checked by a person yet.',
});
export function unitIndex(doc) {
 const map = new Map();
 for (const l of doc?.lines || []) map.set(String(l.t).trim(), l);
 return { get: (text) => map.get(String(text ?? '').trim()) || null, size: map.size, unit: String(doc?.unit || '') };
}
export function createUnits(base, env = {}) {
 const cache = new Map();
 const load = (unit) => {
  if (!/^[a-z0-9-]+$/.test(unit)) return Promise.resolve(null);
  if (!cache.has(unit)) {
   const p = (async () => { const r = await (env.fetch ?? globalThis.fetch)(`${base}${unit}.json`); if (!r.ok) return null; return unitIndex(await r.json()); })().catch(() => null);
   cache.set(unit, p);
   p.then((v) => { if (!v) cache.delete(unit); });
  }
  return /** @type {Promise<ReturnType<typeof unitIndex>|null>} */ (cache.get(unit));
 };
 return { load, /** @param {string} unit @param {string} text */ async line(unit, text) { const u = await load(unit); return u ? u.get(text) : null; } };
}
