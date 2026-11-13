const STOP = new Set(('a an the of in on at to for from by with about and or but is are was were be been being do does did done have has had ' +
 'it its this that these those there here what which who whom whose where when why how can could should would will shall may might must ' +
 'i me my we us our you your he him his she her they them their please tell say says said so if then than not no yes ' +
 'torah bible according verse verses hebrew').split(/\s+/));
const HE_STOP = new Set('של את על עם אל מה מי איך למה האם זה זו זאת הוא היא הם הן אני אתה את אנחנו יש אין כי אם או גם רק לא כן מן עד כל אשר איפה היכן מתי כתוב כתובה בתורה התורה תורה לפי אומרת אומר מדברת היה הייתה היו קרה זו הן מופיע מופיעה כתובה אילו איזה איזו נמצא נמצאת'.split(' '));
const POINTS = /[֑-ֽֿ-ׇ]/g;
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const ASKS_TORAH = /\btorah\b|\bverse|\bparash|\bcommand|\bbible\b|תורה|כתוב|פסוק|פרשת|מצוו?ת/i;
const NEAR_MIN = 0.6; // cosine above which two entries count as close
const HE_PREFIX = /^[והבלמשכ]{1,2}(?=[א-ת]{3,})/;
function stem(w) {
 if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
 if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
 if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
 if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
 return w;
}
const fold = (w) => w.replace(/[ךםןףץ]/g, (c) => FINALS[c]);
export function heForms(word) {
 const out = [word];
 const bare = word.replace(HE_PREFIX, '');
 if (bare !== word) out.push(bare);
 for (const w of [...out]) {
  const m = /^(.{2,})(ים|ות|ה|י)$/.exec(w);
  if (m) out.push(m[1]);
 }
 const folded = [...new Set(out.map(fold))];
 const bare0 = folded[1] || folded[0];
 const skel = bare0[0] + bare0.slice(1).replace(/[וי]/g, '');
 return skel.length >= 2 ? [...folded, '~' + skel] : folded;
}
export function tokens(text) {
 const t = String(text || '').toLowerCase().replace(POINTS, '').replace(/[־]/g, ' ').replace(/['’`]s\b/g, '').replace(/[^a-z0-9א-ת]+/g, ' ');
 const out = [];
 for (const raw of t.split(' ')) {
  if (!raw) continue;
  if (/[א-ת]/.test(raw)) { if (!HE_STOP.has(raw) && raw.length > 1) out.push(fold(raw)); continue; }
  if (STOP.has(raw) || raw.length < 2 || /^\d+$/.test(raw)) continue;
  out.push(stem(raw));
 }
 return out;
}
export function queryTerms(text) {
 const out = new Map();
 for (const w of tokens(text)) {
  if (/[א-ת]/.test(w)) heForms(w).forEach((f, i) => { if (!HE_STOP.has(f) && f.length > 1) out.set(f, Math.max(out.get(f) || 0, i ? (f[0] === '~' ? 0.5 : 0.7) : 1)); });
  else out.set(w, 1);
 }
 return out;
}
export function openIndex(json, bin = null) {
 if (!json || json.schema !== 'alef-search/1') throw new Error('not a search index');
 const terms = new Map();
 const names = json.terms.split('\n');
 if (names.length !== json.post.length) throw new Error('search index is damaged');
 names.forEach((t, i) => terms.set(t, json.post[i]));
 const n = json.docs.length, d = json.dims;
 let vec = null;
 if (bin && d && bin.byteLength === n * d) vec = new Int8Array(bin);
 return { json, terms, n, d, vec, types: json.types };
}
function cosine(ix, a, b) {
 const { vec, d } = ix;
 let dot = 0, na = 0, nb = 0;
 for (let k = 0, i = a * d, j = b * d; k < d; k++, i++, j++) { const x = vec[i], y = vec[j]; dot += x * y; na += x * x; nb += y * y; }
 return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
export function entry(ix, i) {
 const [t, id, title, arg] = ix.json.docs[i];
 const type = ix.types[t];
 return { type: type.name, id, title, href: type.href.replace('{}', encodeURIComponent(arg ?? id)) };
}
export function search(ix, text, { limit = 3, types = null, near = 0, minScore = 0, queryVector = null } = {}) {
 const q = queryTerms(text);
 const scores = new Map();
 const N = ix.n;
 for (const [term, qw] of q) {
  const post = ix.terms.get(term);
  if (!post) continue;
  const df = post.length / 2;
  const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
  let doc = 0;
  for (let k = 0; k < post.length; k += 2) {
   doc += post[k];
   scores.set(doc, (scores.get(doc) || 0) + qw * idf * post[k + 1] / 9);
  }
 }
 const asksTorah = ASKS_TORAH.test(String(text));
 if (q.size && tokens(text).length === 1 && !asksTorah) {
  for (const [term, qw] of q) {
   const post = ix.terms.get('=' + term);
   if (!post) continue;
   let doc = 0;
   for (let k = 0; k < post.length; k += 2) { doc += post[k]; scores.set(doc, (scores.get(doc) || 0) + 20 * qw); }
  }
 }
 if (asksTorah) {
  const ask = ix.types.findIndex((t) => t.name === 'ask');
  for (const [doc, s] of scores) if (ix.json.docs[doc][0] === ask) scores.set(doc, s * 1.6);
 }
 if (!scores.size && !queryVector) return [];
 let ranked = [...scores].sort((a, b) => b[1] - a[1]);
 if (ix.vec && near > 0 && ranked.length) {
  const top = ranked.slice(0, 5);
  const boosted = new Map(ranked);
  for (let j = 0; j < N; j++) {
   let add = 0;
   for (const [i, si] of top) { if (i === j) continue; const c = cosine(ix, i, j); if (c > NEAR_MIN) add = Math.max(add, near * si * c); }
   if (add) boosted.set(j, (boosted.get(j) || 0) + add);
  }
  ranked = [...boosted].sort((a, b) => b[1] - a[1]);
 }
 if (ix.vec && queryVector && queryVector.length === ix.d) {
  const best = ranked.length ? ranked[0][1] : 1;
  const all = new Map(ranked);
  for (let j = 0; j < N; j++) {
   let dot = 0, nb = 0, nq = 0;
   for (let k = 0, o = j * ix.d; k < ix.d; k++, o++) { dot += queryVector[k] * ix.vec[o]; nb += ix.vec[o] * ix.vec[o]; nq += queryVector[k] * queryVector[k]; }
   const c = nb && nq ? dot / Math.sqrt(nb * nq) : 0;
   if (c > 0.3) all.set(j, (all.get(j) || 0) + best * c);
  }
  ranked = [...all].sort((a, b) => b[1] - a[1]);
 }
 const keep = types ? new Set(types) : null;
 const out = [];
 for (const [i, s] of ranked) {
  if (s < minScore) break;
  const e = entry(ix, i);
  if (keep && !keep.has(e.type)) continue;
  out.push({ ...e, score: Math.round(s * 1000) / 1000 });
  if (out.length >= limit) break;
 }
 return out;
}
export async function loadIndex(base, { version = 1, fetchImpl = globalThis.fetch, vectors = true } = {}) {
 const url = (name) => new URL(name, base).href;
 const jr = await fetchImpl(url(`index.v${version}.json`));
 if (!jr.ok) throw new Error('search index: HTTP ' + jr.status);
 const json = await jr.json();
 let bin = null;
 if (vectors && json.dims) {
  try { const br = await fetchImpl(url(`index.v${version}.vec`)); if (br.ok) bin = await br.arrayBuffer(); } catch { /* words-only search still works */ }
 }
 return openIndex(json, bin);
}
