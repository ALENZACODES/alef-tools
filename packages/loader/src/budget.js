// @ts-check
// Storage: how much the packs use, how much the browser allows, and the limit the learner can set. No DOM.
import { listPacks } from './cache.js';

export const MiB = 1048576;
export const LIMIT_KEY = 'alef.packs.limit-bytes';
export const PERSIST_KEY = 'alef.packs.persist-asked';

const nav = (env) => env?.navigator ?? /** @type {any} */ (globalThis).navigator;
const store = (env) => { try { return env?.storage ?? /** @type {any} */ (globalThis).localStorage ?? null; } catch { return null; } };

/** Whole megabytes for the screen, never 0. @param {number} bytes */
export const megabytes = (bytes) => Math.max(1, Math.round(bytes / MiB));

/** The browser's own figures, or null when it gives none. @returns {Promise<{usage:number, quota:number, free:number}|null>} */
export async function estimate(env = {}) {
  try { const e = await nav(env)?.storage?.estimate?.(); if (!e || !e.quota) return null; const usage = e.usage || 0; return { usage, quota: e.quota, free: Math.max(0, e.quota - usage) }; } catch { return null; }
}

/** True when the browser reports too little free space for `bytes` more (with a tenth to spare). Unknown counts as enough. */
export async function tooFull(bytes, env = {}) { const e = await estimate(env); return !!e && e.free < bytes * 1.1; }

/** The learner's own limit for all packs together, in bytes. 0 means no limit. */
export function getLimit(env = {}) { try { const n = Number(store(env)?.getItem(LIMIT_KEY)); return Number.isFinite(n) && n > 0 ? n : 0; } catch { return 0; } }
export function setLimit(bytes, env = {}) { try { const s = store(env); if (!s) return; if (bytes > 0) s.setItem(LIMIT_KEY, String(Math.round(bytes))); else s.removeItem(LIMIT_KEY); } catch { /* private mode */ } }

/**
 * What the Language packs page shows: each pack's bytes, their total, the browser's estimate and the learner's limit.
 * @returns {Promise<{packs:{pack:string, cache:string, bytes:number, files:number}[], used:number, limit:number, browser:{usage:number, quota:number, free:number}|null}>}
 */
export async function storageReport(env = {}) {
  const packs = await listPacks(env);
  return { packs, used: packs.reduce((a, p) => a + p.bytes, 0), limit: getLimit(env), browser: await estimate(env) };
}

/** True when `bytes` more would pass the learner's limit. No limit set: never. */
export async function overLimit(bytes, env = {}) {
  const limit = getLimit(env);
  if (!limit) return false;
  const packs = await listPacks(env);
  return packs.reduce((a, p) => a + p.bytes, 0) + bytes > limit;
}

/**
 * Asks the browser to keep this site's storage, at most once per device. Returns true/false from the browser,
 * or null when it was already asked or cannot be asked.
 */
export async function askPersistOnce(env = {}) {
  const s = store(env);
  try {
    if (s?.getItem(PERSIST_KEY)) return null;
    const st = nav(env)?.storage;
    if (!st?.persist) return null;
    s?.setItem(PERSIST_KEY, '1');
    if (await st.persisted?.()) return true;
    return !!(await st.persist());
  } catch { return null; }
}
