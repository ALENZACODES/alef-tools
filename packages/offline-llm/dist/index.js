import { loadIndex, search as searchIndex } from './search.js';
export const id = 'offline-llm';
export const version = '0.1.0';
export const packs = [];
export const SEARCH_VERSION = 1;
export const ASK_VERSION = 1;
const plain = (s) => String(s || '').normalize('NFD').replace(/[֑-ֽֿ-ׇ]/g, '').replace(/[־]/g, ' ').replace(/[^a-z0-9א-ת]+/gi, ' ').trim().toLowerCase();
let live = null;
export async function load(opts = {}) {
 if (live) return live;
 const base = new URL(opts.base || './', import.meta.url);
 const doFetch = opts.fetch || ((u) => globalThis.fetch(u));
 const once = new Map();
 const cached = (key, make) => { if (!once.has(key)) { const p = make(); p.catch(() => once.delete(key)); once.set(key, p); } return once.get(key); };
 const json = (name) => cached(name, async () => { const r = await doFetch(new URL(name, base)); if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`); return r.json(); });
 const index = () => cached('index', () => loadIndex(new URL('search/', base), { version: SEARCH_VERSION, fetchImpl: doFetch }));
 const listing = () => json('dist.json');
 live = {
  async search(text, o = {}) { return searchIndex(await index(), text, o); },
  async askExtra(text) {
   const data = await json(`ask/answers.v${ASK_VERSION}.json`);
   const key = plain(text);
   if (!key) return null;
   for (const [q, a] of data.questions || []) if (plain(q) === key && data.answers[a]) return { answer: data.answers[a], question: q };
   for (const [he, a] of data.wordings || []) if (plain(he) === key) return { answerId: a };
   return null;
  },
  async unitExtras(unitId) {
   const files = new Set((await listing()).files.map((f) => f.path));
   const get = async (kind) => (files.has(`${kind}/${unitId}.json`) ? ((await json(`${kind}/${unitId}.json`)).items || []).filter((i) => i.checked === true) : []);
   const [examples, quiz] = await Promise.all([get('examples'), get('quiz')]);
   return { examples, quiz };
  },
  report() { return json('report.json'); },
 };
 return live;
}
export async function unload() { live = null; }
