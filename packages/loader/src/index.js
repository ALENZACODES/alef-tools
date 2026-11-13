// @ts-check
// The shared language pack loader for ALEF (docs/CONTRACT.md, section 5).
export const CONTRACT = 1;
export const VERSION = '0.1.0';
export const id = 'loader';
export const version = VERSION;
export const packs = [];

export { PackError, codeOf } from './errors.js';
export { SHA_HEADER, cacheName, packOfCache, kept, keep, filesState, removeFiles, removePack, prune, readFile, listPacks } from './cache.js';
export { MAX_PART_BYTES, PACK_SCHEMA, versioned, expandPack, fetchPackList, planDownload, downloadFiles, downloadPack, packState } from './loader.js';
export { MiB, megabytes, estimate, tooFull, getLimit, setLimit, storageReport, overLimit, askPersistOnce } from './budget.js';
export { hasGraphics, connectionKind, ramGB, canRun, runWithFallback, getWifiOnly, setWifiOnly, checkConnection } from './device.js';
export { fixedShabbatWindow, setShabbatCheck, isShabbatSafeMode, allowed, requireAllowed } from './shabbat.js';
export { createWorkerHost, serveWorker } from './worker-host.js';

/** The loader has nothing to load: it is the module itself. Present so it has the same shape as every other package. */
export async function load() { return import('./index.js'); }
export async function unload() { /* nothing held */ }

/**
 * Checks that a package has the shape the app expects (docs/CONTRACT.md, section 2) and returns it frozen.
 * @param {{id:string, version:string, packs:string[], load:(opts:any)=>Promise<any>, unload:()=>Promise<void>}} pkg
 */
export function definePackage(pkg) {
  const bad = (why) => { throw new TypeError(`alef-tools package: ${why}`); };
  if (!pkg || typeof pkg.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(pkg.id)) bad('id must be a lower-case name');
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+/.test(pkg.version)) bad('version must be x.y.z');
  if (!Array.isArray(pkg.packs) || pkg.packs.some((p) => typeof p !== 'string')) bad('packs must be a list of pack names');
  if (typeof pkg.load !== 'function' || typeof pkg.unload !== 'function') bad('load and unload must be functions');
  return Object.freeze({ ...pkg, packs: Object.freeze([...pkg.packs]) });
}
