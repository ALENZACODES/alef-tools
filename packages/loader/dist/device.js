import { PackError } from './errors.js';
const nav = (env) => env?.navigator ?? /** @type {any} */ (globalThis).navigator;
const store = (env) => { try { return env?.storage ?? /** @type {any} */ (globalThis).localStorage ?? null; } catch { return null; } };
export const WIFI_ONLY_KEY = 'alef.packs.wifi-only';
export async function hasGraphics(env = {}) {
 try {
  const gpu = nav(env)?.gpu; const adapter = gpu && await gpu.requestAdapter();
  if (!adapter) return false;
  const soft = adapter.isFallbackAdapter === true || adapter.info?.isFallbackAdapter === true || /swiftshader|llvmpipe|software/i.test(`${adapter.info?.architecture || ''} ${adapter.info?.description || ''} ${adapter.info?.device || ''}`);
  return !!env.force || !soft;
 } catch { return false; }
}
export function connectionKind(env = {}) {
 const c = nav(env)?.connection;
 if (!c) return '';
 if (c.saveData) return 'saver';
 return c.type === 'cellular' ? 'cellular' : '';
}
export const ramGB = (env = {}) => Number(nav(env)?.deviceMemory) || 0;
export async function canRun(need, env = {}) {
 const reasons = [];
 if (need?.webgpu && !('gpu' in env ? env.gpu : await hasGraphics(env))) reasons.push('needs-graphics');
 const ram = ramGB(env);
 if (need?.minRamGB && ram && ram < Math.min(need.minRamGB, 8)) reasons.push('low-memory');
 return { ok: !reasons.length, reasons };
}
export async function runWithFallback(o) {
 if (o.webgpu && ('gpu' in o ? o.gpu : await hasGraphics(o))) {
  try { return { backend: 'webgpu', value: await o.webgpu() }; } catch (e) { o.onFallback?.(e); }
 }
 return { backend: 'wasm', value: await o.wasm() };
}
export function getWifiOnly(env = {}) { try { return store(env)?.getItem(WIFI_ONLY_KEY) !== '0'; } catch { return true; } }
export function setWifiOnly(on, env = {}) { try { store(env)?.setItem(WIFI_ONLY_KEY, on ? '1' : '0'); } catch { /* private mode */ } }
export function checkConnection(env = {}) {
 if (getWifiOnly(env) && connectionKind(env)) throw new PackError('wifi-only', connectionKind(env));
}
