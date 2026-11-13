// @ts-check
// What this device can run, and what the browser says about its connection. No DOM.
import { PackError } from './errors.js';

const nav = (env) => env?.navigator ?? /** @type {any} */ (globalThis).navigator;
const store = (env) => { try { return env?.storage ?? /** @type {any} */ (globalThis).localStorage ?? null; } catch { return null; } };
export const WIFI_ONLY_KEY = 'alef.packs.wifi-only';

/**
 * True when this browser hands out a real graphics adapter. A software stand-in is many times slower than WebAssembly,
 * so it counts as none. @param {{navigator?:any, force?:boolean}} [env]
 */
export async function hasGraphics(env = {}) {
  try {
    const gpu = nav(env)?.gpu; const adapter = gpu && await gpu.requestAdapter();
    if (!adapter) return false;
    const soft = adapter.isFallbackAdapter === true || adapter.info?.isFallbackAdapter === true || /swiftshader|llvmpipe|software/i.test(`${adapter.info?.architecture || ''} ${adapter.info?.description || ''} ${adapter.info?.device || ''}`);
    return !!env.force || !soft;
  } catch { return false; }
}

/** What the browser says about the connection, when it says anything. @returns {'cellular'|'saver'|''} */
export function connectionKind(env = {}) {
  const c = nav(env)?.connection;
  if (!c) return '';
  if (c.saveData) return 'saver';
  return c.type === 'cellular' ? 'cellular' : '';
}

/** Memory the browser reports, in GB (it rounds down and stops at 8). 0 when it says nothing. */
export const ramGB = (env = {}) => Number(nav(env)?.deviceMemory) || 0;

/**
 * Whether a pack's device needs are met. Unknown memory counts as enough: most browsers do not report it.
 * @param {{webgpu?:boolean, minRamGB?:number}|undefined} need @param {{navigator?:any, gpu?:boolean}} [env]
 * @returns {Promise<{ok:boolean, reasons:('needs-graphics'|'low-memory')[]}>}
 */
export async function canRun(need, env = {}) {
  /** @type {('needs-graphics'|'low-memory')[]} */
  const reasons = [];
  if (need?.webgpu && !('gpu' in env ? env.gpu : await hasGraphics(env))) reasons.push('needs-graphics');
  const ram = ramGB(env);
  // deviceMemory never reports more than 8, so a need above 8 can only be checked up to 8
  if (need?.minRamGB && ram && ram < Math.min(need.minRamGB, 8)) reasons.push('low-memory');
  return { ok: !reasons.length, reasons };
}

/**
 * Runs `webgpu()` when the device has a graphics adapter and falls back to `wasm()` when there is none or it throws.
 * @template T
 * @param {{webgpu?:()=>Promise<T>, wasm:()=>Promise<T>, gpu?:boolean, navigator?:any, onFallback?:(e:any)=>void}} o
 * @returns {Promise<{backend:'webgpu'|'wasm', value:T}>}
 */
export async function runWithFallback(o) {
  if (o.webgpu && ('gpu' in o ? o.gpu : await hasGraphics(o))) {
    try { return { backend: 'webgpu', value: await o.webgpu() }; } catch (e) { o.onFallback?.(e); }
  }
  return { backend: 'wasm', value: await o.wasm() };
}

/** The learner's "Only on Wi-Fi" choice. On by default. */
export function getWifiOnly(env = {}) { try { return store(env)?.getItem(WIFI_ONLY_KEY) !== '0'; } catch { return true; } }
export function setWifiOnly(on, env = {}) { try { store(env)?.setItem(WIFI_ONLY_KEY, on ? '1' : '0'); } catch { /* private mode */ } }

/** Throws PackError('wifi-only') when the choice is on and the browser reports a mobile or data-saver connection. */
export function checkConnection(env = {}) {
  if (getWifiOnly(env) && connectionKind(env)) throw new PackError('wifi-only', connectionKind(env));
}
