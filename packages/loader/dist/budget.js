import { listPacks } from './cache.js';
export const MiB = 1048576;
export const LIMIT_KEY = 'alef.packs.limit-bytes';
export const PERSIST_KEY = 'alef.packs.persist-asked';
const nav = (env) => env?.navigator ?? /** @type {any} */ (globalThis).navigator;
const store = (env) => { try { return env?.storage ?? /** @type {any} */ (globalThis).localStorage ?? null; } catch { return null; } };
export const megabytes = (bytes) => Math.max(1, Math.round(bytes / MiB));
export async function estimate(env = {}) {
 try { const e = await nav(env)?.storage?.estimate?.(); if (!e || !e.quota) return null; const usage = e.usage || 0; return { usage, quota: e.quota, free: Math.max(0, e.quota - usage) }; } catch { return null; }
}
export async function tooFull(bytes, env = {}) { const e = await estimate(env); return !!e && e.free < bytes * 1.1; }
export function getLimit(env = {}) { try { const n = Number(store(env)?.getItem(LIMIT_KEY)); return Number.isFinite(n) && n > 0 ? n : 0; } catch { return 0; } }
export function setLimit(bytes, env = {}) { try { const s = store(env); if (!s) return; if (bytes > 0) s.setItem(LIMIT_KEY, String(Math.round(bytes))); else s.removeItem(LIMIT_KEY); } catch { /* private mode */ } }
export async function storageReport(env = {}) {
 const packs = await listPacks(env);
 return { packs, used: packs.reduce((a, p) => a + p.bytes, 0), limit: getLimit(env), browser: await estimate(env) };
}
export async function overLimit(bytes, env = {}) {
 const limit = getLimit(env);
 if (!limit) return false;
 const packs = await listPacks(env);
 return packs.reduce((a, p) => a + p.bytes, 0) + bytes > limit;
}
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
