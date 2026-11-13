// @ts-check
// Build-time nikud for the app's own sentences: looking a line up in a unit file (dist/nikud/<unit>.json). No model needed.
// Each line: {t: the text as the app has it, p: pointed text, ph: sound line or null, s: 'book'|'checked'|'model'}.

/** What each source means, in words a learner can read. */
export const SOURCE_NOTE = Object.freeze({
  book: '',
  checked: '',
  model: 'These vowel marks have not been checked by a person yet.',
});

/**
 * @param {any} doc a parsed unit file
 * @returns {{get:(text:string)=>{t:string,p:string,ph:string|null,s:'book'|'checked'|'model'}|null, size:number, unit:string}}
 */
export function unitIndex(doc) {
  const map = new Map();
  for (const l of doc?.lines || []) map.set(String(l.t).trim(), l);
  return { get: (text) => map.get(String(text ?? '').trim()) || null, size: map.size, unit: String(doc?.unit || '') };
}

/**
 * Lazy loader with one fetch per unit. @param {string} base folder that holds the unit files, ending in /
 * @param {{fetch?:any}} [env]
 */
export function createUnits(base, env = {}) {
  /** @type {Map<string, Promise<ReturnType<typeof unitIndex>|null>>} */
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
