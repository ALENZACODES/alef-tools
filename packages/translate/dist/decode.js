export function createDecoder(rt) {
 const { ort, table, encoder, decoder, vocab } = rt;
 const D = vocab.dim, L = vocab.layers, N = vocab.heads, H = D / N, V = vocab.pieces.length;
 const i64 = (arr, dims) => new ort.Tensor('int64', BigInt64Array.from(arr.map((x) => BigInt(x))), dims);
 const noHidden = new ort.Tensor('float32', new Float32Array(D), [1, D]);
 const noIds = i64([0], [1]);
 const drop = (t) => { try { if (t && t.location && t.location !== 'cpu') t.dispose(); } catch { /* already freed */ } };
 async function embed(ids, b, s) {
  const out = await table.run({ ids: i64(ids, [ids.length]), hidden: noHidden }, ['emb']);
  return new ort.Tensor('float32', out.emb.data, [b, s, D]);
 }
 async function generate(ids, opts = {}) {
  const beams = Math.max(1, Math.min(4, opts.beams || 2));
  const limit = Math.min(vocab.maxPositions - 2, opts.maxNew || Math.min(96, ids.length * 2 + 12));
  const src = ids.slice(0, vocab.maxPositions - 1);
  const enc = await encoder.run({ emb: await embed(src, 1, src.length) });
  const cross_k = enc.cross_k, cross_v = enc.cross_v;
  let past_k = new ort.Tensor('float32', new Float32Array(0), [L, 1, N, 0, H]);
  let past_v = new ort.Tensor('float32', new Float32Array(0), [L, 1, N, 0, H]);
  let live = [{ ids: [], score: 0 }];
  const done = [];
  let order = [0];
  for (let t = 0; t < limit && live.length; t++) {
   const b = live.length;
   const lastIds = live.map((x) => (x.ids.length ? x.ids[x.ids.length - 1] : vocab.start));
   const step = await decoder.run({ emb: await embed(lastIds, b, 1), pos: new ort.Tensor('int64', BigInt64Array.from([BigInt(t)]), []), cross_k, cross_v, past_k, past_v, beam_idx: i64(order, [b]) });
   drop(past_k); drop(past_v);   // on a graphics card the cache lives there: hand the old one back at once
   past_k = step.new_k; past_v = step.new_v;
   const logits = /** @type {Float32Array} */ ((await table.run({ ids: noIds, hidden: step.hidden }, ['logits'])).logits.data);
   let cand = [];
   for (let i = 0; i < b; i++) {
    const off = i * V;
    let max = -Infinity;
    for (let v = 0; v < V; v++) { if (v !== vocab.pad && logits[off + v] > max) max = logits[off + v]; }
    let sum = 0;
    for (let v = 0; v < V; v++) { if (v !== vocab.pad) sum += Math.exp(logits[off + v] - max); }
    const lse = max + Math.log(sum);
    const top = [];
    for (let v = 0; v < V; v++) {
     if (v === vocab.pad) continue;
     const x = logits[off + v];
     if (top.length < beams) { top.push([x, v]); top.sort((p, q) => q[0] - p[0]); } else if (x > top[beams - 1][0]) { top[beams - 1] = [x, v]; top.sort((p, q) => q[0] - p[0]); }
    }
    for (const [x, v] of top) cand.push({ from: i, id: v, score: live[i].score + x - lse });
   }
   cand.sort((p, q) => q.score - p.score);
   cand = cand.slice(0, beams);
   const next = []; order = [];
   for (const c of cand) {
    if (c.id === vocab.eos) done.push({ ids: live[c.from].ids, score: c.score / (live[c.from].ids.length + 1) });
    else { next.push({ ids: [...live[c.from].ids, c.id], score: c.score }); order.push(c.from); }
   }
   live = next;
   if (done.length >= beams) break;
   if (done.length && live.length) {
    const bestDone = Math.max(...done.map((x) => x.score));
    if (live.every((x) => x.score / (x.ids.length + 1) < bestDone)) break;
   }
  }
  drop(past_k); drop(past_v); drop(cross_k); drop(cross_v);
  if (!done.length) for (const x of live) done.push({ ids: x.ids, score: x.score / (x.ids.length + 1) });
  done.sort((p, q) => q.score - p.score);
  return done[0] ? done[0].ids : [];
 }
 return { generate };
}
