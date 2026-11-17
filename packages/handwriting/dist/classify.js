export const CLASSES = Object.freeze([
 ['alef', 'א'], ['bet', 'ב'], ['gimel', 'ג'], ['dalet', 'ד'], ['he', 'ה'], ['vav', 'ו'], ['zayin', 'ז'], ['chet', 'ח'],
 ['tet', 'ט'], ['yod', 'י'], ['kaf', 'כ'], ['lamed', 'ל'], ['mem', 'מ'], ['nun', 'נ'], ['samekh', 'ס'], ['ayin', 'ע'],
 ['pe', 'פ'], ['tsadi', 'צ'], ['qof', 'ק'], ['resh', 'ר'], ['shin', 'ש'], ['tav', 'ת'],
 ['kaf-final', 'ך'], ['mem-final', 'ם'], ['nun-final', 'ן'], ['pe-final', 'ף'], ['tsadi-final', 'ץ'],
 ['not-a-letter', ''],
].map((c) => Object.freeze({ id: c[0], char: c[1] })));
export const NOT_A_LETTER = 'not-a-letter';
const INDEX = Object.freeze(Object.fromEntries(CLASSES.map((c, i) => [c.id, i])));
export const indexOf = (id) => INDEX[id] ?? -1;
function fields(buf, start, end, visit) {
 let p = start;
 const varint = () => { let v = 0, shift = 0; for (;;) { const b = buf[p++]; v += (b & 0x7f) * 2 ** shift; if (b < 0x80) return v; shift += 7; if (shift > 63) throw new Error('bad model file'); } };
 while (p < end) {
  const key = varint(); const field = Math.floor(key / 8); const wire = key & 7;
  if (wire === 0) visit(field, 0, varint(), 0);
  else if (wire === 2) { const len = varint(); if (p + len > end) throw new Error('bad model file'); visit(field, 2, p, p + len); p += len; }
  else if (wire === 5) p += 4;
  else if (wire === 1) p += 8;
  else throw new Error('bad model file');
 }
}
export function readTensors(model) {
 const buf = model instanceof Uint8Array ? model : new Uint8Array(model);
 const out = new Map();
 fields(buf, 0, buf.length, (f, wire, a, b) => {
  if (f !== 7 || wire !== 2) return;
  fields(buf, a, b, (gf, gw, ga, gb) => {
   if (gf !== 5 || gw !== 2) return;
   const dims = []; let name = ''; let type = 0; let raw = null;
   fields(buf, ga, gb, (tf, tw, ta, tb) => {
    if (tf === 1 && tw === 0) dims.push(ta);
    else if (tf === 1 && tw === 2) { let p = ta; while (p < tb) { let v = 0, s = 0; for (;;) { const x = buf[p++]; v += (x & 0x7f) * 2 ** s; if (x < 0x80) break; s += 7; } dims.push(v); } }   // packed
    else if (tf === 2 && tw === 0) type = ta;
    else if (tf === 8 && tw === 2) name = new TextDecoder().decode(buf.subarray(ta, tb));
    else if (tf === 9 && tw === 2) raw = buf.slice(ta, tb);
   });
   if (type === 1 && raw && name) out.set(name, { dims, data: new Float32Array(raw.buffer, 0, raw.byteLength >> 2) });
  });
 });
 return out;
}
function conv3x3Relu(inp, C, H, W, weight, bias, O) {
 const PW = W + 2, PH = H + 2, plane = PH * PW, HW = H * W;
 const pad = new Float32Array(C * plane);
 for (let c = 0; c < C; c++) for (let y = 0; y < H; y++) pad.set(inp.subarray(c * HW + y * W, c * HW + y * W + W), c * plane + (y + 1) * PW + 1);
 const out = new Float32Array(O * HW);
 const acc = new Float64Array(HW);
 for (let o = 0; o < O; o++) {
  acc.fill(bias[o]);
  for (let c = 0; c < C; c++) {
   const wb = (o * C + c) * 9, pb = c * plane;
   const w0 = weight[wb], w1 = weight[wb + 1], w2 = weight[wb + 2], w3 = weight[wb + 3], w4 = weight[wb + 4], w5 = weight[wb + 5], w6 = weight[wb + 6], w7 = weight[wb + 7], w8 = weight[wb + 8];
   let ai = 0;
   for (let y = 0; y < H; y++) {
    let r0 = pb + y * PW, r1 = r0 + PW, r2 = r1 + PW;
    for (let x = 0; x < W; x++, r0++, r1++, r2++) {
     acc[ai++] += w0 * pad[r0] + w1 * pad[r0 + 1] + w2 * pad[r0 + 2] + w3 * pad[r1] + w4 * pad[r1 + 1] + w5 * pad[r1 + 2] + w6 * pad[r2] + w7 * pad[r2 + 1] + w8 * pad[r2 + 2];
    }
   }
  }
  const ob = o * HW;
  for (let i = 0; i < HW; i++) out[ob + i] = acc[i] > 0 ? acc[i] : 0;
 }
 return out;
}
function maxPool2(inp, C, H, W) {
 const h = H >> 1, w = W >> 1; const out = new Float32Array(C * h * w);
 for (let c = 0; c < C; c++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = c * H * W + 2 * y * W + 2 * x;
  out[c * h * w + y * w + x] = Math.max(inp[i], inp[i + 1], inp[i + W], inp[i + W + 1]);
 }
 return out;
}
export function buildRunner(tensors, arch) {
 const layers = [];
 for (let i = 0; i < arch.convs; i++) {
  const w = tensors.get(`conv${i}.weight`), b = tensors.get(`conv${i}.bias`);
  if (!w || !b || w.dims[2] !== 3 || w.dims[3] !== 3) throw new Error('model file does not match this runner');
  layers.push({ w: w.data, b: b.data, O: w.dims[0], C: w.dims[1], pool: arch.poolAfter.includes(i) });
 }
 const fw = tensors.get('fc.weight'), fb = tensors.get('fc.bias');
 if (!fw || !fb) throw new Error('model file does not match this runner');
 return (input) => {
  let x = input, H = 32, W = 32;
  for (const L of layers) {
   x = conv3x3Relu(x, L.C, H, W, L.w, L.b, L.O);
   if (L.pool) { x = maxPool2(x, L.O, H, W); H >>= 1; W >>= 1; }
  }
  const C = layers[layers.length - 1].O, n = H * W;
  const mean = new Float32Array(C);
  for (let c = 0; c < C; c++) { let s = 0; for (let i = 0; i < n; i++) s += x[c * n + i]; mean[c] = s / n; }
  const K = fw.dims[0]; const out = new Float32Array(K);
  for (let k = 0; k < K; k++) { let s = fb.data[k]; for (let c = 0; c < C; c++) s += fw.data[k * C + c] * mean[c]; out[k] = s; }
  return out;
 };
}
export function softmax(logits) {
 let m = -Infinity; for (const v of logits) if (v > m) m = v;
 const out = new Float32Array(logits.length); let s = 0;
 for (let i = 0; i < logits.length; i++) { out[i] = Math.exp(logits[i] - m); s += out[i]; }
 for (let i = 0; i < out.length; i++) out[i] /= s;
 return out;
}
export async function createClassifier({ model, manifest, ort, ortOptions }) {
 if (!manifest || !manifest.arch) throw new TypeError('createClassifier: manifest is required');
 if (manifest.classes.length !== CLASSES.length || manifest.classes.some((id, i) => id !== CLASSES[i].id)) throw new Error('model file and class list do not match');
 const bytes = model instanceof Uint8Array ? model : new Uint8Array(model);
 let logitsOf; let backend = 'built-in'; let session = null;
 if (ort) {
  session = await ort.InferenceSession.create(bytes, ortOptions || { executionProviders: ['wasm'] });
  backend = 'onnxruntime';
  logitsOf = async (input) => { const r = await session.run({ input: new ort.Tensor('float32', input, [1, 1, 32, 32]) }); return /** @type {Float32Array} */ (r.logits.data); };
 } else {
  const run = buildRunner(readTensors(bytes), manifest.arch);
  logitsOf = async (input) => run(input);
 }
 return {
  backend,
  async classify(input) {
   if (!(input instanceof Float32Array) || input.length !== 1024) throw new TypeError('classify: expected the 32x32 picture from preprocess.js');
   const probs = softmax(await logitsOf(input));
   const ranking = CLASSES.map((c, i) => ({ id: c.id, char: c.char, p: probs[i] })).sort((a, b) => b.p - a.p);
   return { probs, ranking, top: ranking[0] };
  },
  async dispose() { if (session && session.release) await session.release(); },
 };
}
