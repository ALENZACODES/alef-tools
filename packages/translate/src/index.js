// @ts-check
// translate: Hebrew and English translation on the device (docs/CONTRACT.md, section 2).
// The app's Talk and Camera screens use the pieces directly (createPackStore, createPackClient, createMemory); load() is the
// one-call way in for any other screen.
import { createPackStore } from './pack.js';
import { createPackClient, MAX_LINE } from './client.js';

export { createPackStore, createPackClient, MAX_LINE };
export { createMemory, tmKey, fnv1a } from './tm.js';
export { createTokenizer, normalizeLine } from './tokenizer.js';
export { createRuntime, joinParts } from './runtime.js';

export const id = 'translate';
export const version = '0.1.0';
/** Pack names as the manifest lists them. */
export const packs = ['translate-en-he', 'translate-he-en', 'translate-he-en-hq'];
/** The same packs by their name in the Talk pack list (the folder on the pack host). */
export const TALK_NAME = Object.freeze({ 'translate-en-he': 'en-he', 'translate-he-en': 'he-en', 'translate-he-en-hq': 'he-en-hq' });
export const TALK_CACHE = 'alef-talk-pack-v1';

/** @type {{client:any, key:string}|null} */
let live = null;

/**
 * Loads one pack that is already on the device and returns a translator. It never starts a download.
 * @param {{loader:any, pack?:string, ortBase:string, base:string, workerUrl:string|URL, hostsFile?:string, cacheName?:string, WorkerCtor?:any, env?:any}} opts
 *   base: the folder of the site that holds the Talk pack list (assets/vendor/_nmt/).  workerUrl: the address of worker.js on the site.
 * @returns {Promise<{pack:string, direction:string, translate:(text:string)=>Promise<string>, engine:()=>any, client:any}>}
 */
export async function load(opts) {
  const { loader } = opts;
  const name = TALK_NAME[opts.pack || ''] || opts.pack || 'he-en';
  const key = `${opts.base}|${opts.cacheName || TALK_CACHE}`;
  if (!live || live.key !== key) {
    if (live) live.client.dispose();
    const store = createPackStore({ loader, base: opts.base, cacheName: opts.cacheName || TALK_CACHE, hostsFile: opts.hostsFile, ortLocal: opts.ortBase });
    live = { key, client: createPackClient({ store, workerUrl: opts.workerUrl, WorkerCtor: opts.WorkerCtor, env: opts.env }) };
  }
  const client = live.client;
  const st = await client.state(name);
  if (!st.ready) throw new loader.PackError('not-downloaded', `the ${name} language pack is not on this device`);
  if (!(await client.load(name))) throw new loader.PackError('cannot-run', `the ${name} language pack could not start here`);
  const direction = (await client.packs()).find((p) => p.name === name)?.direction || name;
  return { pack: name, direction, translate: (text) => client.translate(name, text), engine: () => client.engine(name), client };
}

/** Frees the worker and everything it holds. Safe to call twice. */
export async function unload() { if (live) { live.client.dispose(); live = null; } }
