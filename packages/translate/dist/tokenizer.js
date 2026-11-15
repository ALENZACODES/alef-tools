const MARKS = /[֑-ֽֿ-ׇ]/g; // Hebrew vowel points and cantillation (the maqaf U+05BE is handled as a dash)
const SPACE = '▁';
export function normalizeLine(s) {
 return String(s || '').normalize('NFKC').replace(MARKS, '')
  .replace(/[‘’‚′׳`´]/g, "'").replace(/[“”„″״«»]/g, '"')
  .replace(/[–—−־]/g, '-').replace(/…/g, '...')
  .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '').replace(/[\u0000-\u001F\u007F]/g, ' ')
  .replace(/\s+/g, ' ').trim();
}
export function createTokenizer(vocab) {
 const idOf = new Map();
 let longest = 1, low = 0;
 vocab.scores.forEach((sc, id) => {
  if (sc === null || sc === undefined) return;
  const p = vocab.pieces[id];
  idOf.set(p, id);
  const n = [...p].length; if (n > longest) longest = n;
  if (sc < low) low = sc;
 });
 const unkScore = low - 10;
 function encode(line) {
  const text = normalizeLine(line);
  if (!text) return [vocab.eos];
  const chars = [...(SPACE + text.replace(/ /g, SPACE))];
  const n = chars.length;
  const best = new Float64Array(n + 1).fill(-Infinity); best[0] = 0;
  const from = new Int32Array(n + 1).fill(-1);
  const idAt = new Int32Array(n + 1).fill(vocab.unk);
  for (let i = 0; i < n; i++) {
   if (best[i] === -Infinity) continue;
   let piece = '', known = false;
   for (let j = i + 1; j <= n && j - i <= longest; j++) {
    piece += chars[j - 1];
    const id = idOf.get(piece);
    if (id === undefined) continue;
    if (j === i + 1) known = true;
    const sc = best[i] + /** @type {number} */ (vocab.scores[id]);
    if (sc > best[j]) { best[j] = sc; from[j] = i; idAt[j] = id; }
   }
   if (!known) { const sc = best[i] + unkScore; if (sc > best[i + 1]) { best[i + 1] = sc; from[i + 1] = i; idAt[i + 1] = vocab.unk; } }
  }
  const ids = [];
  for (let j = n; j > 0; j = from[j]) ids.push(idAt[j]);
  ids.reverse();
  const out = [];
  for (const id of ids) if (!(id === vocab.unk && out[out.length - 1] === vocab.unk)) out.push(id);
  out.push(vocab.eos);
  return out;
 }
 function decode(ids) {
  let s = '';
  for (const id of ids) { if (id === vocab.eos || id === vocab.pad || id === vocab.unk) continue; s += vocab.pieces[id] ?? ''; }
  return s.split(SPACE).join(' ').replace(/\s+/g, ' ').trim();
 }
 return { encode, decode };
}
