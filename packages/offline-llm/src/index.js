// offline-llm: what the app reads from this package. Everything here is static data built offline (see the README):
// the search index over checked answers, lessons, units and dictionary words; checked extras for Ask the Torah;
// and, per unit, checked example sentences and fill-in-the-word items. No language pack, no worker, no model.
// load() fetches nothing; each call below fetches its own small file the first time it is used, from this folder only.
import { loadIndex, search as searchIndex } from './search.js';

export const id = 'offline-llm';
export const version = '0.1.0';
export const packs = [];
export const SEARCH_VERSION = 1;
export const ASK_VERSION = 1;

const plain = (s) => String(s || '').normalize('NFD').replace(/[֑-ֽֿ-ׇ]/g, '').replace(/[־]/g, ' ').replace(/[^a-z0-9א-ת]+/gi, ' ').trim().toLowerCase();
let live = null;

/**
 * @param {{ fetch?: typeof fetch, base?: string|URL }} [opts]  fetch and base folder can be passed in (tests); the shared loader is not needed
 * @returns the working API: search, askExtra, unitExtras, report
 */
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
    /** Up to `limit` closest entries for a question in English or Hebrew: [{ type, id, title, href, score }]. */
    async search(text, o = {}) { return searchIndex(await index(), text, o); },
    /**
     * Extra checked content for Ask the Torah: { answer, question } for a question with its own checked answer here,
     * { answerId } when the text is a checked Hebrew wording of an answer in the app's bank, else null.
     */
    async askExtra(text) {
      const data = await json(`ask/answers.v${ASK_VERSION}.json`);
      const key = plain(text);
      if (!key) return null;
      for (const [q, a] of data.questions || []) if (plain(q) === key && data.answers[a]) return { answer: data.answers[a], question: q };
      for (const [he, a] of data.wordings || []) if (plain(he) === key) return { answerId: a };
      return null;
    },
    /** Checked example sentences and quiz items of a unit: { examples: [...], quiz: [...] } (empty lists when the build has none). */
    async unitExtras(unitId) {
      const files = new Set((await listing()).files.map((f) => f.path));
      const get = async (kind) => (files.has(`${kind}/${unitId}.json`) ? ((await json(`${kind}/${unitId}.json`)).items || []).filter((i) => i.checked === true) : []);
      const [examples, quiz] = await Promise.all([get('examples'), get('quiz')]);
      return { examples, quiz };
    },
    /** Counts of the build: drafts written, passed, sent to review; judge scores; the search eval. */
    report() { return json('report.json'); },
  };
  return live;
}

export async function unload() { live = null; }
