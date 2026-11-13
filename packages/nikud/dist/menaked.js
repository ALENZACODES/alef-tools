import { CHARS, FIRST_CHAR_ID } from './vocab.js';
import { NIKUD_CLASSES, SHIN_CLASSES, MAT_LECT, MATRES, STRESS, VOCAL_SHVA, PREFIX, stripPoints, hasPoints, hasCantillation, isLetter, guardName, chunks, runs, NAME_SHOWN } from './hebrew.js';
const UNK = 0, CLS = 1, SEP = 2;
let table = null;
const ALLOWED = [[0x0000, 0x007f], [0x0590, 0x05ff], [0x200c, 0x203f], [0x20a0, 0x20bf], [0x2150, 0x218b], [0x2200, 0x22ff], [0xfb00, 0xfb4f]];
const idOf = (ch) => {
 if (!table) { table = new Map(); for (let i = 0; i < CHARS.length; i++) table.set(CHARS[i], i + FIRST_CHAR_ID); }
 const n = ch.normalize('NFKC').toLowerCase().slice(0, 1);
 const code = n.charCodeAt(0);
 if (!n || !ALLOWED.some(([lo, hi]) => code >= lo && code <= hi)) return UNK;
 return table.get(n) ?? UNK;
};
export function encode(text) {
 const ids = [CLS];
 for (let i = 0; i < text.length; i++) ids.push(idOf(text[i]));
 ids.push(SEP);
 return ids;
}
const argmax = (a, from, n) => { let best = 0; for (let k = 1; k < n; k++) if (a[from + k] > a[from + best]) best = k; return best; };
export function decode(text, nikud, shin, o = {}) {
 const keep = o.keepMatres !== false;
 const nN = NIKUD_CLASSES.length;
 const out = [];
 let last = -1; // where in `out` the last letter that carries marks sits
 for (let i = 0; i < text.length; i++) {
  const ch = text[i];
  if (!isLetter(ch)) { out.push(ch); last = -1; continue; }
  const row = i + 1;
  let nik = NIKUD_CLASSES[argmax(nikud, row * nN, nN)];
  const dot = ch === 'ש' ? SHIN_CLASSES[argmax(shin, row * 2, 2)] : '';
  if (nik === MAT_LECT) {
   if (MATRES.includes(ch)) {
    if (keep) {
     let carried = '';
     const prev = last >= 0 ? /** @type {string[]} */ (out[last]) : null;
     if (ch === 'ו' && prev) {
      if (prev[2].endsWith('\u05b9')) { prev[2] = prev[2].slice(0, -1); carried = '\u05b9'; }
      else if (prev[2].endsWith('\u05bb')) { prev[2] = prev[2].slice(0, -1); carried = '\u05bc'; }
     }
     out.push([ch, '', carried, '']);
     last = -1;
    }
    continue;
   }
   nik = '';
  }
  let marks = '';
  if (o.extra) marks = (o.extra[row * 3] > 0 ? STRESS : '') + (o.extra[row * 3 + 1] > 0 ? VOCAL_SHVA : '') + (o.extra[row * 3 + 2] > 0 ? PREFIX : '');
  out.push([ch, dot, nik, marks]);
  last = out.length - 1;
 }
 return out.map((x) => (typeof x === 'string' ? x : x.join(''))).join('');
}
export async function infer(rt, bare) {
 const ids = encode(bare);
 const dims = [1, ids.length];
 const big = (fill) => BigInt64Array.from(fill, (x) => BigInt(x));
 const feeds = { input_ids: new rt.ort.Tensor('int64', big(ids), dims), attention_mask: new rt.ort.Tensor('int64', big(ids.map(() => 1)), dims) };
 if ((rt.session.inputNames || []).includes('token_type_ids')) feeds.token_type_ids = new rt.ort.Tensor('int64', big(ids.map(() => 0)), dims);
 return rt.session.run(feeds);
}
export function keepExisting(original, pointed) {
 const a = runs(original), b = runs(pointed);
 if (a.length !== b.length) return pointed;
 return a.map((r, i) => (r.word && hasPoints(r.text) ? r.text : b[i].text)).join('');
}
export function createMenaked(rt) {
 let chain = Promise.resolve(); // one request at a time: a graph cannot run two at once
 const one = async (piece) => {
  const bare = stripPoints(piece);
  if (!/[א-ת]/.test(bare)) return piece;
  const out = await infer(rt, bare);
  return keepExisting(piece, decode(bare, out.nikud_logits.data, out.shin_logits.data));
 };
 return {
  point(text) {
   const job = chain.then(async () => {
    const src = String(text ?? '');
    if (!/[א-ת]/.test(src)) return { text: src, changed: false, name: false, reason: /** @type {const} */ ('no-hebrew') };
    if (hasCantillation(src)) return { text: src, changed: false, name: guardName(src).found, reason: /** @type {const} */ ('cantillation') };
    const g = guardName(src);
    let out = '';
    for (const piece of chunks(g.text)) out += await one(piece);
    if (g.found) out = out.replace(/ה[ְ-ׇ]*׳/g, NAME_SHOWN);
    return { text: out, changed: out !== src, name: g.found, reason: /** @type {const} */ ('') };
   });
   chain = job.then(() => {}, () => {});
   return job;
  },
 };
}
