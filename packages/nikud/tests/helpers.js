// Test helpers: a stand-in graph that "points" text from a table, and stand-ins for Cache Storage and fetch.
import { createHash } from 'node:crypto';

/** Tests run against src/ by default and against the built dist/ with ALEF_TEST_DIST=1 (CI runs both). */
export const src = (file) => new URL(`${process.env.ALEF_TEST_DIST ? '../dist/' : '../src/'}${file}`, import.meta.url).href;
const { NIKUD_CLASSES, SHIN_CLASSES, isLetter } = await import(src('hebrew.js'));

export const ort = { Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } } };

/**
 * A session whose answer for each letter comes from `marks(ch, index, text)` -> {nikud?:string, shin?:string, stress?, shva?, prefix?}.
 * `decodeIds` turns the ids back into text so the stand-in can see what it was asked.
 */
export function fakeSession(marks, { extra = false, calls = [] } = {}) {
  return {
    inputNames: extra ? ['input_ids', 'attention_mask', 'token_type_ids'] : ['input_ids', 'attention_mask'],
    calls,
    async run(feeds) {
      const n = Number(feeds.input_ids.dims[1]);
      const text = feeds.__text;
      const nikud = new Float32Array(n * NIKUD_CLASSES.length), shin = new Float32Array(n * 2), add = new Float32Array(n * 3).fill(-1);
      calls.push(n);
      for (let i = 0; i < n - 2; i++) {
        const m = marks(i) || {};
        const k = Math.max(0, NIKUD_CLASSES.indexOf(m.nikud || ''));
        nikud[(i + 1) * NIKUD_CLASSES.length + k] = 5;
        shin[(i + 1) * 2 + Math.max(0, SHIN_CLASSES.indexOf(m.shin || SHIN_CLASSES[0]))] = 5;
        if (m.stress) add[(i + 1) * 3] = 1;
        if (m.shva) add[(i + 1) * 3 + 1] = 1;
        if (m.prefix) add[(i + 1) * 3 + 2] = 1;
      }
      const out = { nikud_logits: { data: nikud }, shin_logits: { data: shin } };
      if (extra) out.additional_logits = { data: add };
      return out;
    },
  };
}

/** Every letter gets a patah: enough to see which words the code sent and which it left alone. */
export const patahEverywhere = () => ({ nikud: 'ַ' });

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function fakeCaches() {
  const stores = new Map();
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      async match(key) { const k = typeof key === 'string' ? key : key.url; const hit = m.get(k); return hit ? hit.clone() : undefined; },
      async put(key, res) { m.set(typeof key === 'string' ? key : key.url, res); },
      async keys() { return [...m.keys()].map((url) => ({ url })); },
      async delete(key) { return m.delete(typeof key === 'string' ? key : key.url); },
    };
  };
  return { open, async delete(name) { return stores.delete(name); }, async keys() { return [...stores.keys()]; }, stores };
}

/** fetch over a table of url (without ?v=) -> bytes. Counts requests. */
export function fakeFetch(files) {
  const log = [];
  const f = async (url) => {
    const bare = String(url).replace(/\?.*$/, '');
    log.push(bare);
    if (!files.has(bare)) return new Response('', { status: 404 });
    const body = files.get(bare);
    return new Response(body, { status: 200 });
  };
  f.log = log;
  return f;
}
