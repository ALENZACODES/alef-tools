#!/usr/bin/env python3
"""Export a DictaBERT joint model (dicta-il/dictabert-tiny-joint or dictabert-joint) to ONNX for the browser.

What comes out (in --out):
  joint.fp32.onnx      the plain export (kept only with --keep-fp32; it is the reference for the int8 check)
  joint.int8.onnx      what the "words" pack ships: the 128000-row word table in 8-bit integers (it is nine tenths of
                       the model), every other weight in 16-bit floats that the runtime widens to 32-bit when it loads.
                       The four small transformer layers are NOT put in 8-bit: measured on 600 sentences that changed
                       15% of prefix splits and 11% of lemmas, where this layout changes under 1%.
  vocab.txt            the model's WordPiece vocabulary, unchanged
  tokenizer.json       the small part of the Hub tokenizer.json the JS tokenizer needs (normaliser rules and the
                       pre-tokeniser pattern rewritten for JavaScript's RegExp), not the Hub file itself
  labels.json          every label list the JS decoder needs (POS, features, prefix classes, NER labels)
  export.json          what was exported: model id, pinned revisions, sizes, SHA-256, int8-vs-fp32 agreement

The graph takes input_ids, attention_mask and prefix_class_id_options (see src/joint.js for how that is built) and
returns four small tensors, so the browser never copies a [tokens x 128000] logit table out of the runtime:
  lex_top    int64  [batch, tokens, 3]    the three most likely lemma ids per token
  seg        float  [batch, tokens, 8]    "is a prefix" minus "is not" per prefix class
  morph      float  [batch, tokens, 65]   prefix-POS(6) POS(16) features(4+6+5+5) suffix(3) suffix features(4+6+5+5)
  ner        float  [batch, tokens, 27]
The syntax head is left out of the browser graph (word taps do not use it); the offline build uses the full model.

The lemma head shares its weights with the word embeddings (128000 x hidden). The export keeps ONE copy of that table
and multiplies from the left (E @ h^T), so the int8 file holds the table once: that is what keeps the pack small.

Usage (the revisions are the `hubRevision` values in models.manifest.json):
  python export_joint.py --model dicta-il/dictabert-tiny-joint --revision <sha> --code-revision <sha> --out work/words
Then cut it into download parts with the shared tool:
  node ../../scripts/sha256-parts.mjs --pack words --version <v> --out work/pack/words work/words/joint.int8.onnx work/words/vocab.txt work/words/tokenizer.json work/words/labels.json
"""
import argparse
import hashlib
import json
import os
import sys

import numpy as np
import torch
from torch import nn

RESCORE = 16
CODE_REPO = 'dicta-il/dictabert-joint'  # the tiny model's config points at this repo for its model code


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


class BrowserGraph(nn.Module):
    """The joint model minus the syntax head, with small outputs."""

    def __init__(self, model):
        super().__init__()
        self.m = model

    def forward(self, input_ids, attention_mask, prefix_class_id_options):
        m = self.m
        hidden = m.bert(input_ids, attention_mask=attention_mask, token_type_ids=torch.zeros_like(input_ids), return_dict=True)[0]
        # lemma head: transform, then E @ h^T (left-multiplication keeps a single copy of the embedding table)
        t = m.cls.predictions.transform(hidden)                      # [b, n, h]
        b, n, h = t.shape[0], t.shape[1], t.shape[2]
        flat = t.reshape(-1, h).transpose(0, 1)                      # [h, b*n]
        emb = m.bert.embeddings.word_embeddings.weight
        bias = m.cls.predictions.bias
        scores = torch.matmul(emb, flat)                             # [vocab, b*n]  (integer arithmetic after quantisation)
        scores = scores.transpose(0, 1) + bias                       # [b*n, vocab]
        # The big product runs on 8-bit numbers, which is coarse. Take its best 16 and score those again exactly:
        # 16 rows of the table against the unrounded vector. That gets back almost every lemma the rounding moved.
        short = torch.topk(scores, RESCORE, dim=-1).indices          # [b*n, 16]
        rows = emb[short]                                            # [b*n, 16, h]
        exact = (rows * t.reshape(-1, 1, h)).sum(-1) + bias[short]   # [b*n, 16]
        best = torch.topk(exact, 3, dim=-1).indices                  # [b*n, 3]
        lex_top = torch.gather(short, 1, best).reshape(b, n, 3)
        _, seg_logits = m.prefix(hidden, prefix_class_id_options, None)        # [b, n, 8, 2]
        seg = seg_logits[..., 1] - seg_logits[..., 0]
        _, mo = m.morph(hidden, None)
        morph = torch.cat([mo.prefix_logits, mo.pos_logits, *mo.features_logits, mo.suffix_logits, *mo.suffix_features_logits], dim=-1)
        ner = m.classifier(hidden)
        return lex_top, seg, morph, ner


def halve_floats(src, dst, min_elements=256):
    """Store every 32-bit float weight as 16-bit, with a Cast back to 32-bit in front of it. The runtime does the
    Cast once when the model loads, so every operator still runs in ordinary 32-bit floats (works on WASM and WebGPU)."""
    import onnx
    from onnx import helper, numpy_helper, TensorProto
    g = onnx.load(src)
    casts, kept = [], []
    for init in g.graph.initializer:
        arr = numpy_helper.to_array(init)
        if init.data_type != TensorProto.FLOAT or arr.size < min_elements:
            kept.append(init)
            continue
        half = arr.astype(np.float16)
        assert np.isfinite(half).all(), init.name
        kept.append(numpy_helper.from_array(half, init.name + '__f16'))
        casts.append(helper.make_node('Cast', [init.name + '__f16'], [init.name], to=TensorProto.FLOAT, name='widen/' + init.name))
    del g.graph.initializer[:]
    g.graph.initializer.extend(kept)
    nodes = list(g.graph.node)
    del g.graph.node[:]
    g.graph.node.extend(casts + nodes)
    onnx.checker.check_model(g)
    onnx.save(g, dst)


def shared_helpers():
    """scripts/convert-common.py at the repo root (its file name has a dash, so it is loaded by path)."""
    import importlib.util
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'scripts', 'convert-common.py')
    spec = importlib.util.spec_from_file_location('convert_common', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def js_pattern(pattern):
    """Rewrite the tokenizer's Oniguruma pattern for JavaScript RegExp with the `u` flag.
    \\w there means letters, marks, digits and connector punctuation; in JS (even with `u`) it is ASCII only."""
    out = pattern.replace('\\"', '"').replace("\\'", "'")
    out = out.replace('\\w', '[\\p{L}\\p{M}\\p{Nd}\\p{Pc}]')
    out = out.replace('[^[\\p{L}\\p{M}\\p{Nd}\\p{Pc}]\\s]', '[^\\p{L}\\p{M}\\p{Nd}\\p{Pc}\\s]')
    return out


def write_tokenizer_files(tok_dir, out):
    tj = json.load(open(os.path.join(tok_dir, 'tokenizer.json'), encoding='utf8'))
    norm = tj['normalizer']['normalizers']
    kinds = [n['type'] for n in norm]
    assert kinds == ['NFD', 'Lowercase', 'StripAccents', 'Replace', 'Replace'], kinds
    assert norm[3]['pattern'] == {'String': '<foreign>'} and norm[3]['content'] == '[UNK]'
    allowed = norm[4]['pattern']['Regex']
    assert allowed.startswith('[^') and allowed.endswith(']+') and norm[4]['content'] == '[UNK]'
    pre = tj['pre_tokenizer']
    assert pre['type'] == 'Split' and pre['behavior'] == 'Removed' and pre['invert'] is True
    model = tj['model']
    assert model['type'] == 'WordPiece' and model['continuing_subword_prefix'] == '##'
    vocab = model['vocab']
    cfg = {
        'schema': 'alef.morph.tokenizer/1',
        'normalizer': ['NFD', 'lowercase', 'strip-marks', {'replace': '<foreign>', 'with': '[UNK]'}, {'replaceRegex': allowed, 'with': '[UNK]'}],
        'split': js_pattern(pre['pattern']['Regex']),
        'unk': model['unk_token'], 'maxWordChars': model['max_input_chars_per_word'],
        'ids': {t: vocab[t] for t in ['[PAD]', '[UNK]', '[CLS]', '[SEP]', '[MASK]', '[BLANK]']},
        'vocabSize': len(vocab),
    }
    json.dump(cfg, open(os.path.join(out, 'tokenizer.json'), 'w', encoding='utf8'), ensure_ascii=False)
    inv = sorted(vocab.items(), key=lambda kv: kv[1])
    assert [i for _, i in inv] == list(range(len(inv)))
    with open(os.path.join(out, 'vocab.txt'), 'w', encoding='utf8', newline='\n') as f:
        f.write('\n'.join(t for t, _ in inv) + '\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='dicta-il/dictabert-tiny-joint')
    ap.add_argument('--revision', required=True, help='pinned Hub commit of the model repo')
    ap.add_argument('--code-revision', required=True, help=f'pinned Hub commit of {CODE_REPO} (the model code)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--keep-fp32', action='store_true')
    ap.add_argument('--check-sentences', help='text file, one Hebrew sentence per line, for the int8-vs-fp32 check')
    a = ap.parse_args()

    from huggingface_hub import snapshot_download
    from transformers import AutoModel
    from common import load_tokenizer
    import onnx
    import onnxruntime as ort
    from onnxruntime.quantization import quantize_dynamic, QuantType

    os.makedirs(a.out, exist_ok=True)
    tok_dir = snapshot_download(a.model, revision=a.revision, allow_patterns=['tokenizer.json', 'tokenizer_config.json', 'vocab.txt', 'special_tokens_map.json', 'config.json'])
    tok = load_tokenizer(a.model, a.revision)  # the model's own word splitter, see common.load_tokenizer
    model = AutoModel.from_pretrained(a.model, revision=a.revision, code_revision=a.code_revision, trust_remote_code=True)
    model.eval()
    cfg = model.config
    assert cfg.do_lex and cfg.do_morph and cfg.do_prefix and cfg.do_ner

    write_tokenizer_files(tok_dir, a.out)
    cc = cfg.classes_config
    labels = {
        'schema': 'alef.morph.labels/1',
        'prefixClasses': cfg.prefix_cfg['possible_classes'],
        'prefixPos': cc['ALL_PREFIX_POS'], 'pos': cc['ALL_POS'], 'suffix': cc['ALL_SUFFIX_POS'],
        'features': [['Gender', cc['ALL_FEATURES'][0]], ['Number', cc['ALL_FEATURES'][1]], ['Person', cc['ALL_FEATURES'][2]], ['Tense', cc['ALL_FEATURES'][3]]],
        'ner': [cfg.id2label[i] for i in range(len(cfg.id2label))],
    }
    json.dump(labels, open(os.path.join(a.out, 'labels.json'), 'w', encoding='utf8'), ensure_ascii=False)

    graph = BrowserGraph(model).eval()
    sys.path.insert(0, os.path.dirname(sys.modules[type(model).__module__].__file__))
    from BertForPrefixMarking import encode_sentences_for_bert_for_prefix_marking as encode

    def inputs_for(sentences):
        enc = encode(tok, cfg.prefix_cfg, sentences)
        return enc['input_ids'], enc['attention_mask'], enc['prefix_class_id_options']

    example = inputs_for(['הילדים הלכו לבית הספר בבוקר', 'שלום'])
    fp32 = os.path.join(a.out, 'joint.fp32.onnx')
    with torch.no_grad():
        torch.onnx.export(
            graph, example, fp32, dynamo=False, opset_version=17, do_constant_folding=True,
            input_names=['input_ids', 'attention_mask', 'prefix_class_id_options'],
            output_names=['lex_top', 'seg', 'morph', 'ner'],
            dynamic_axes={k: {0: 'batch', 1: 'tokens'} for k in ['input_ids', 'attention_mask', 'prefix_class_id_options', 'lex_top', 'seg', 'morph', 'ner']},
        )
    int8 = os.path.join(a.out, 'joint.int8.onnx')
    table = 'm.bert.embeddings.word_embeddings.weight'
    g = onnx.load(fp32)
    assert any(i.name == table for i in g.graph.initializer), 'word table not found under its expected name'
    table_nodes = [n.name for n in g.graph.node if table in n.input]
    assert sorted(n.op_type for n in g.graph.node if n.name in table_nodes) == ['Gather', 'Gather', 'MatMul'], table_nodes
    del g
    stage = os.path.join(a.out, 'joint.stage.onnx')
    quantize_dynamic(fp32, stage, weight_type=QuantType.QUInt8, per_channel=False, op_types_to_quantize=['MatMul', 'Gather'], nodes_to_quantize=table_nodes)
    halve_floats(stage, int8)
    os.remove(stage)
    shared_helpers().strip_onnx_metadata(int8)  # no producer, tool or author notes in a shipped file

    # int8 against fp32, and fp32 against PyTorch, on real sentences
    sentences = ['הילדים הלכו לבית הספר בבוקר', 'אני רוצה קפה הפוך, בבקשה.', 'בשנת 1948 השלים אפרים קישון את לימודיו בפיסול מתכת']
    if a.check_sentences:
        sentences = [line.strip() for line in open(a.check_sentences, encoding='utf8') if line.strip()]
    so = ort.SessionOptions()
    s32 = ort.InferenceSession(fp32, so, providers=['CPUExecutionProvider'])
    s8 = ort.InferenceSession(int8, so, providers=['CPUExecutionProvider'])
    agree = {'tokens': 0, 'lemma': 0, 'seg': 0, 'pos': 0, 'gender': 0, 'number': 0, 'ner': 0, 'torch_lemma': 0}
    for i in range(0, len(sentences), 16):
        ids, mask, pre = inputs_for(sentences[i:i + 16])
        feed = {'input_ids': ids.numpy(), 'attention_mask': mask.numpy(), 'prefix_class_id_options': pre.numpy()}
        o32, o8 = s32.run(None, feed), s8.run(None, feed)
        with torch.no_grad():
            t = graph(ids, mask, pre)
        keep = mask.numpy().astype(bool)
        agree['tokens'] += int(keep.sum())
        agree['torch_lemma'] += int((o32[0][..., 0] == t[0].numpy()[..., 0])[keep].sum())
        agree['lemma'] += int((o32[0][..., 0] == o8[0][..., 0])[keep].sum())
        agree['seg'] += int(((o32[1] > 0) == (o8[1] > 0)).all(-1)[keep].sum())
        agree['pos'] += int((o32[2][..., 6:22].argmax(-1) == o8[2][..., 6:22].argmax(-1))[keep].sum())
        agree['gender'] += int((o32[2][..., 22:26].argmax(-1) == o8[2][..., 22:26].argmax(-1))[keep].sum())
        agree['number'] += int((o32[2][..., 26:32].argmax(-1) == o8[2][..., 26:32].argmax(-1))[keep].sum())
        agree['ner'] += int((o32[3].argmax(-1) == o8[3].argmax(-1))[keep].sum())

    report = {
        'schema': 'alef.morph.export/1', 'model': a.model, 'revision': a.revision, 'codeRepo': CODE_REPO, 'codeRevision': a.code_revision,
        'opset': 17, 'quantisation': 'word table: onnxruntime dynamic QUInt8 (2 Gather + 1 MatMul); all other float weights stored as float16 and widened at load', 'lemmaRescore': RESCORE,
        'files': {n: {'bytes': os.path.getsize(os.path.join(a.out, n)), 'sha256': sha256(os.path.join(a.out, n))}
                  for n in ['joint.int8.onnx', 'vocab.txt', 'tokenizer.json', 'labels.json']},
        'fp32Bytes': os.path.getsize(fp32),
        'int8VsFp32': {'sentences': len(sentences), **agree},
        'versions': {'torch': torch.__version__, 'onnxruntime': ort.__version__, 'numpy': np.__version__},
    }
    json.dump(report, open(os.path.join(a.out, 'export.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    if not a.keep_fp32:
        os.remove(fp32)
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
