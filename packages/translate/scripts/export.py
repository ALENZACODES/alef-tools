#!/usr/bin/env python3
# ruff: noqa: E401, E701, E702, E731, E741
"""Builds a translation pack for one direction from an OPUS-MT (Marian) checkpoint.

  python3 scripts/export.py <checkpoint dir> <out dir> [--check] [--keep-fp32]

Works for the base models (opus-mt-en-he, Tatoeba heb-eng: 512 wide) and for the big ones (opus-mt-tc-big-he-en: 1024 wide).
The checkpoint dir is a snapshot of the pinned Hub revision named in models.manifest.json.

The stock ONNX export of a Marian model stores the 60,000-row word table three times (encoder, decoder, output layer),
which makes one direction about 143 MB at 8 bits. This export stores the table once and splits the model into three graphs:

  table.onnx    the word table, 8-bit with one scale per row. ids -> vectors, and hidden state -> scores over the vocabulary.
  encoder.onnx  vectors of the source line -> the cross-attention keys and values every decoder layer needs (computed once per line).
  decoder.onnx  one decoding step. Takes the vector of the last token, its position, the encoder output and the self-attention
                cache (which may be empty), returns the hidden state and the grown cache. beam_idx reorders the cache for beam search.
  vocab.json    pieces by id, the source-side piece scores for the tokenizer, and the special ids.

The attention arithmetic is written out here, not traced from the library's forward pass, so the graphs have plain tensor inputs.
--check compares greedy output of the exported graphs with the library's own greedy output on sample lines.
Needs scripts/requirements.txt (build-time only; nothing here ships to the learner).
"""
import json, math, os, sys
import numpy as np
import torch
from torch import nn
import onnx
from onnx import helper, TensorProto, numpy_helper
from transformers import MarianMTModel, MarianTokenizer


def heads(x, n):  # [B,T,D] -> [B,n,T,D/n]
    b, t, d = x.shape
    return x.view(b, t, n, d // n).transpose(1, 2)


def attend(q, k, v):  # q [B,n,Tq,h]  k,v [B|1,n,Tk,h]
    w = torch.matmul(q, k.transpose(-1, -2)) / math.sqrt(q.shape[-1])
    o = torch.matmul(torch.softmax(w, dim=-1), v)
    b, n, t, h = o.shape
    return o.transpose(1, 2).reshape(b, t, n * h)


class Encoder(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.enc, self.dec, self.n = m.model.encoder, m.model.decoder, m.config.encoder_attention_heads

    def forward(self, emb):  # [1,S,D], already scaled
        s = emb.shape[1]
        x = emb + self.enc.embed_positions.weight[:s].unsqueeze(0)
        for l in self.enc.layers:
            a = l.self_attn
            y = attend(heads(a.q_proj(x), self.n), heads(a.k_proj(x), self.n), heads(a.v_proj(x), self.n))
            x = l.self_attn_layer_norm(x + a.out_proj(y))
            x = l.final_layer_norm(x + l.fc2(l.activation_fn(l.fc1(x))))
        ks = torch.stack([heads(l.encoder_attn.k_proj(x), self.n) for l in self.dec.layers])  # [L,1,n,S,h]
        vs = torch.stack([heads(l.encoder_attn.v_proj(x), self.n) for l in self.dec.layers])
        return ks, vs


class DecoderStep(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.dec, self.n = m.model.decoder, m.config.decoder_attention_heads

    def forward(self, emb, pos, cross_k, cross_v, past_k, past_v, beam_idx):
        # emb [B,1,D] scaled; pos int64 []; cross_* [L,1,n,S,h]; past_* [L,B',n,T,h] (T may be 0); beam_idx int64 [B]
        x = emb + self.dec.embed_positions.weight[pos].view(1, 1, -1)
        past_k = past_k.index_select(1, beam_idx)
        past_v = past_v.index_select(1, beam_idx)
        nk, nv = [], []
        for i, l in enumerate(self.dec.layers):
            a = l.self_attn
            k = torch.cat([past_k[i], heads(a.k_proj(x), self.n)], dim=2)
            v = torch.cat([past_v[i], heads(a.v_proj(x), self.n)], dim=2)
            nk.append(k); nv.append(v)
            x = l.self_attn_layer_norm(x + a.out_proj(attend(heads(a.q_proj(x), self.n), k, v)))
            c = l.encoder_attn
            x = l.encoder_attn_layer_norm(x + c.out_proj(attend(heads(c.q_proj(x), self.n), cross_k[i], cross_v[i])))
            x = l.final_layer_norm(x + l.fc2(l.activation_fn(l.fc1(x))))
        return x[:, 0, :], torch.stack(nk), torch.stack(nv)


def build_table(m, path):
    """Word table, int8 with one scale per row, stored once as [D, V].
    emb = column[ids] * row_scale[ids] * sqrt(D).  logits = (hidden quantized to 8 bits) x table, as integers, then scaled per row, plus bias.
    Nothing is expanded to floats when the graph loads, so it costs about 31 MB of memory, not 250."""
    e = m.model.shared.weight.detach().numpy().astype(np.float32)
    assert torch.equal(m.lm_head.weight, m.model.shared.weight) and torch.equal(m.model.encoder.embed_tokens.weight, m.model.shared.weight) \
        and torch.equal(m.model.decoder.embed_tokens.weight, m.model.shared.weight), 'the word table is not tied'
    scale = np.maximum(np.abs(e).max(axis=1), 1e-8) / 127.0  # [V]
    q = np.clip(np.rint(e / scale[:, None]), -127, 127).astype(np.int8)
    bias = m.final_logits_bias.detach().numpy().astype(np.float32).reshape(-1)
    v, d = e.shape
    init = [numpy_helper.from_array(np.ascontiguousarray(q.T), 'table_q'), numpy_helper.from_array(scale.astype(np.float32), 'row_scale'),
            numpy_helper.from_array(bias, 'bias'), numpy_helper.from_array(np.array(math.sqrt(d) if m.config.scale_embedding else 1.0, dtype=np.float32), 'emb_scale'),
            numpy_helper.from_array(np.array([-1, 1], dtype=np.int64), 'col')]
    nodes = [helper.make_node('Gather', ['table_q', 'ids'], ['picked_q'], axis=1), helper.make_node('Transpose', ['picked_q'], ['picked_t'], perm=[1, 0]),
             helper.make_node('Cast', ['picked_t'], ['picked_f'], to=TensorProto.FLOAT), helper.make_node('Gather', ['row_scale', 'ids'], ['picked_s'], axis=0),
             helper.make_node('Reshape', ['picked_s', 'col'], ['picked_s2']), helper.make_node('Mul', ['picked_f', 'picked_s2'], ['picked']),
             helper.make_node('Mul', ['picked', 'emb_scale'], ['emb']),
             helper.make_node('DynamicQuantizeLinear', ['hidden'], ['hidden_q', 'hidden_scale', 'hidden_zp']),
             helper.make_node('MatMulInteger', ['hidden_q', 'table_q', 'hidden_zp'], ['raw_i']), helper.make_node('Cast', ['raw_i'], ['raw_f'], to=TensorProto.FLOAT),
             helper.make_node('Mul', ['raw_f', 'hidden_scale'], ['raw_h']), helper.make_node('Mul', ['raw_h', 'row_scale'], ['raw']),
             helper.make_node('Add', ['raw', 'bias'], ['logits'])]
    g = helper.make_graph(nodes, 'table', [helper.make_tensor_value_info('ids', TensorProto.INT64, ['n']), helper.make_tensor_value_info('hidden', TensorProto.FLOAT, ['b', d])],
                          [helper.make_tensor_value_info('emb', TensorProto.FLOAT, ['n', d]), helper.make_tensor_value_info('logits', TensorProto.FLOAT, ['b', v])], init)
    model = helper.make_model(g, opset_imports=[helper.make_opsetid('', 17)]); model.ir_version = 8
    onnx.checker.check_model(model); onnx.save(model, path)
    return float(np.abs(q * scale[:, None] - e).max())


def build_vocab(src, tok, m, path):
    import sentencepiece as spm
    sp = spm.SentencePieceProcessor(model_file=os.path.join(src, 'source.spm'))
    vocab = json.load(open(os.path.join(src, 'vocab.json'), encoding='utf8'))
    pieces = [None] * len(vocab)
    for p, i in vocab.items(): pieces[i] = p
    scores = [None] * len(vocab)
    for i in range(sp.get_piece_size()):
        p = sp.id_to_piece(i)
        if p in vocab and not sp.is_unknown(i) and not sp.is_control(i): scores[vocab[p]] = round(sp.get_score(i), 4)
    out = {'schema': 'alef.talk.nmt.vocab.v1', 'pieces': pieces, 'scores': scores, 'eos': m.config.eos_token_id, 'pad': m.config.pad_token_id,
           'unk': tok.unk_token_id, 'start': m.config.decoder_start_token_id, 'layers': m.config.decoder_layers, 'heads': m.config.decoder_attention_heads,
           'dim': m.config.d_model, 'maxPositions': m.config.max_position_embeddings}
    json.dump(out, open(path, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    tok = MarianTokenizer.from_pretrained(src); m = MarianMTModel.from_pretrained(src).float().eval()  # some checkpoints are stored at half precision
    L, n, d = m.config.decoder_layers, m.config.decoder_attention_heads, m.config.d_model; h = d // n
    print('table max rounding error', build_table(m, os.path.join(out, 'table.onnx')))
    build_vocab(src, tok, m, os.path.join(out, 'vocab.json'))
    tmp = os.path.join(out, '_fp32'); os.makedirs(tmp, exist_ok=True)
    with torch.no_grad():
        torch.onnx.export(Encoder(m), (torch.randn(1, 7, d),), os.path.join(tmp, 'encoder.onnx'), input_names=['emb'], output_names=['cross_k', 'cross_v'],
                          dynamic_axes={'emb': {1: 's'}, 'cross_k': {3: 's'}, 'cross_v': {3: 's'}}, opset_version=17, dynamo=False)
        args = (torch.randn(2, 1, d), torch.tensor(3), torch.randn(L, 1, n, 7, h), torch.randn(L, 1, n, 7, h), torch.randn(L, 2, n, 3, h), torch.randn(L, 2, n, 3, h), torch.tensor([1, 0]))
        torch.onnx.export(DecoderStep(m), args, os.path.join(tmp, 'decoder.onnx'), input_names=['emb', 'pos', 'cross_k', 'cross_v', 'past_k', 'past_v', 'beam_idx'],
                          output_names=['hidden', 'new_k', 'new_v'], opset_version=17, dynamo=False,
                          dynamic_axes={'emb': {0: 'b'}, 'cross_k': {3: 's'}, 'cross_v': {3: 's'}, 'past_k': {1: 'bp', 3: 't'}, 'past_v': {1: 'bp', 3: 't'}, 'beam_idx': {0: 'b'},
                                        'hidden': {0: 'b'}, 'new_k': {1: 'b', 3: 't1'}, 'new_v': {1: 'b', 3: 't1'}})
    from onnxruntime.quantization import quantize_dynamic, QuantType
    for f in ('encoder', 'decoder'):
        quantize_dynamic(os.path.join(tmp, f + '.onnx'), os.path.join(out, f + '.onnx'), weight_type=QuantType.QUInt8, op_types_to_quantize=['MatMul'])
    for f in ('encoder', 'decoder'): strip(os.path.join(out, f + '.onnx'))
    for f in ('table', 'encoder', 'decoder'): print(f, os.path.getsize(os.path.join(out, f + '.onnx')))
    if '--check' in sys.argv: check(out, tok, m)
    if '--keep-fp32' not in sys.argv and '--gpu' not in sys.argv:
        import shutil; shutil.rmtree(tmp, ignore_errors=True)


def strip(path):
    """Drops the producer name, version, notes and metadata entries from a graph file."""
    model = onnx.load(path)
    model.producer_name = ''; model.producer_version = ''; model.doc_string = ''; model.domain = ''; model.graph.doc_string = ''
    del model.metadata_props[:]
    for n in model.graph.node: n.doc_string = ''
    onnx.save(model, path)


def greedy(out, ids, vocab, sessions, max_new=96):
    table, enc, dec = sessions
    L, n, h = vocab['layers'], vocab['heads'], vocab['dim'] // vocab['heads']
    zero_h = np.zeros((1, vocab['dim']), np.float32)
    emb = table.run(['emb'], {'ids': np.array(ids, np.int64), 'hidden': zero_h})[0][None]
    ck, cv = enc.run(None, {'emb': emb})
    pk = np.zeros((L, 1, n, 0, h), np.float32); pv = pk.copy(); cur = vocab['start']; res = []
    for t in range(max_new):
        e = table.run(['emb'], {'ids': np.array([cur], np.int64), 'hidden': zero_h})[0][None]
        hid, pk, pv = dec.run(None, {'emb': e, 'pos': np.array(t, np.int64), 'cross_k': ck, 'cross_v': cv, 'past_k': pk, 'past_v': pv, 'beam_idx': np.array([0], np.int64)})
        logits = table.run(['logits'], {'ids': np.array([0], np.int64), 'hidden': hid})[0][0]
        logits[vocab['pad']] = -1e9
        cur = int(logits.argmax())
        if cur == vocab['eos']: break
        res.append(cur)
    return res


def check(out, tok, m):
    import onnxruntime as ort
    vocab = json.load(open(os.path.join(out, 'vocab.json'), encoding='utf8'))
    ss = [ort.InferenceSession(os.path.join(out, f + '.onnx'), providers=['CPUExecutionProvider']) for f in ('table', 'encoder', 'decoder')]
    lines = [l for l in sys.stdin.read().split('\n') if l.strip()] if not sys.stdin.isatty() else ['Where is the station?', 'שלום, מה שלומך?']
    same = 0
    for line in lines:
        ids = tok(line)['input_ids']
        mine = tok.decode(greedy(out, ids, vocab, ss), skip_special_tokens=True)
        with torch.no_grad(): ref = tok.decode(m.generate(torch.tensor([ids]), num_beams=1, max_new_tokens=96)[0], skip_special_tokens=True)
        same += mine == ref
        if mine != ref: print('DIFF', line, '|', mine, '|', ref)
    print(f'greedy output equal to the fp32 library on {same} of {len(lines)} lines')


if __name__ == '__main__':
    main()
