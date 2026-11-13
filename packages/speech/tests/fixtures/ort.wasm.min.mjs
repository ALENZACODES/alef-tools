// A stand-in for onnxruntime-web, for tests. A "model" is a small JSON text saying which scripted session to build.
export const env = { wasm: {}, logLevel: 'warning' };
export class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } dispose() {} }
export const created = [];
const V = 11, EOT = 5;
export const InferenceSession = {
  async create(bytes, options) {
    const spec = JSON.parse(new TextDecoder().decode(bytes));
    created.push({ spec, options });
    if (spec.fake === 'encoder') return { inputNames: ['input_features'], outputNames: ['last_hidden_state'], async run() { return { last_hidden_state: new Tensor('float32', new Float32Array(4), [1, 1, 4]) }; }, async release() {} };
    if (spec.fake === 'decoder') {
      const pasts = []; for (let i = 0; i < 2; i++) for (const side of ['decoder', 'encoder']) for (const kv of ['key', 'value']) pasts.push(`past_key_values.${i}.${side}.${kv}`);
      let at = 0;
      return {
        inputNames: ['input_ids', 'encoder_hidden_states', ...pasts, 'use_cache_branch'], outputNames: ['logits', ...pasts.map((n) => n.replace('past_key_values.', 'present.'))],
        async run(feeds) {
          at = feeds.use_cache_branch.data[0] ? at + 1 : 0;
          const seq = feeds.input_ids.dims[1], logits = new Float32Array(seq * V).fill(-5);
          logits[(seq - 1) * V + (spec.script[at] ?? EOT)] = 9;
          const out = { logits: new Tensor('float32', logits, [1, seq, V]) };
          for (const n of pasts) out[n.replace('past_key_values.', 'present.')] = new Tensor('float32', new Float32Array(1), [1, 2, at + 1, 4]);
          return out;
        },
        async release() {},
      };
    }
    if (spec.fake === 'ctc') return {
      inputNames: ['input_values'], outputNames: ['logits'],
      // writes the scripted letters, two frames each with a blank after, whatever the sound
      async run() { const ids = spec.script.flatMap((id) => [id, id, spec.blank]); const T = ids.length, lg = new Float32Array(T * spec.V).fill(-4); ids.forEach((id, t) => { lg[t * spec.V + id] = 6; }); return { logits: new Tensor('float32', lg, [1, T, spec.V]) }; },
      async release() {},
    };
    throw new Error('unknown fake model');
  },
};
