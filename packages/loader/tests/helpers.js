// Stand-ins for the browser pieces the loader uses, so every test runs under plain Node.
import { createHash } from 'node:crypto';

export const sha = (buf) => createHash('sha256').update(buf).digest('hex');
/** Tests run against src/ by default and against the built dist/ with ALEF_TEST_DIST=1 (CI runs both). */
export const loaderUrl = new URL(process.env.ALEF_TEST_DIST ? '../dist/index.js' : '../src/index.js', import.meta.url).href;

/** Cache Storage kept in memory. `quotaAfter` makes put() fail like a full disk once that many bytes are stored. */
export function memoryCaches({ quotaAfter = Infinity } = {}) {
  const stores = new Map(); let stored = 0;
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    const url = (k) => (typeof k === 'string' ? k : k.url);
    return {
      match: async (k) => { const e = m.get(url(k)); return e ? new Response(e.body, { headers: e.headers }) : undefined; },
      put: async (k, res) => {
        const body = new Uint8Array(await res.arrayBuffer());
        if (stored + body.byteLength > quotaAfter) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
        stored += body.byteLength; m.set(url(k), { body, headers: [...res.headers] });
      },
      delete: async (k) => m.delete(url(k)),
      keys: async () => [...m.keys()].map((u) => ({ url: u })),
    };
  };
  return { open, delete: async (name) => stores.delete(name), keys: async () => [...stores.keys()], stores };
}

/** A fetch that serves from a {url: bytes|string} table, counts calls, and can be told to fail or cut a URL short. */
export function tableFetch(table) {
  const calls = [];
  const rules = new Map();
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    if (init.signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    const rule = rules.get(url);
    if (rule?.times > 0) { rule.times--; if (rule.kind === 'throw') throw new TypeError('network down'); if (rule.kind === 'status') return new Response('', { status: rule.status }); }
    if (!(url in table)) return new Response('', { status: 404 });
    let body = table[url]; if (typeof body === 'string') body = new TextEncoder().encode(body);
    if (rule?.times > 0 && rule.kind === 'short') { rule.times--; body = body.slice(0, Math.max(0, body.length - 1)); }
    return new Response(body, { status: 200 });
  };
  fn.calls = calls;
  fn.failOnce = (url, kind = 'throw', status = 503) => rules.set(url, { kind, status, times: 1 });
  fn.failAlways = (url, kind = 'throw', status = 503) => rules.set(url, { kind, status, times: Infinity });
  fn.heal = (url) => rules.delete(url);
  return fn;
}

export function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

/** A small pack: two files, the first in two parts. Returns the list, the table of URLs to bytes, and the base. */
export function miniPack(name = 'words', base = 'https://packs.example/') {
  const enc = (s) => new TextEncoder().encode(s);
  const parts = { 'model.onnx.p000': enc('first-part-'), 'model.onnx.p001': enc('second'), 'vocab.json.p000': enc('{"a":1}'), 'graph.gpu.onnx.p000': enc('gpu-wiring') };
  const part = (path) => ({ path, bytes: parts[path].length, sha256: sha(parts[path]) });
  const list = { schema: 'alef.pack.v1', pack: name, version: '1', files: [
    { name: 'model.onnx', bytes: 17, sha256: sha(enc('first-part-second')), parts: [part('model.onnx.p000'), part('model.onnx.p001')] },
    { name: 'vocab.json', bytes: 7, sha256: sha(parts['vocab.json.p000']), parts: [part('vocab.json.p000')] },
    { name: 'graph.gpu.onnx', variant: 'webgpu', bytes: 10, sha256: sha(parts['graph.gpu.onnx.p000']), parts: [part('graph.gpu.onnx.p000')] },
  ] };
  const table = { [`${base}${name}/pack.json`]: JSON.stringify(list) };
  for (const [path, body] of Object.entries(parts)) table[`${base}${name}/${path}?v=${sha(body).slice(0, 16)}`] = body;
  return { list, table, base, parts };
}

/** A fixed local time as epoch ms: weekday 0=Sunday. 2026-11-13 is a Friday. */
export const at = (isoLocal) => new Date(isoLocal).getTime();
