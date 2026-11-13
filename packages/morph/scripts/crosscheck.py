#!/usr/bin/env python3
"""Second opinions on the lesson analysis: run the other DictaBERT models over the same lesson text and list every
word where one of them disagrees with dicta-il/dictabert-joint. Nothing here changes what ships; it feeds review.

  python crosscheck.py --segments work/segments.json --joint-cache work/lesson-cache.json --out ../review/crosscheck.json

Models (all pinned in models.manifest.json, all CC-BY-4.0) and what each is compared on:
  dictabert-lex          lemma
  dictabert-seg          prefix split
  dictabert-morph        part of speech, gender, number
  dictabert-parse, dictabert-large-parse, dictabert-tiny-parse, dictabert-tiny-joint
                         lemma, prefix split, part of speech, gender, number
  onnx-community/dictabert-ner-ONNX (int8)   name / place tags
Each model's weights are deleted from the Hub cache as soon as it has run (--keep to keep them).
"""
import argparse
import collections
import json
import os
import shutil
import traceback

from common import CODE_REPO, load_tokenizer, revision, scrub

JOINT_STYLE = ['dicta-il/dictabert-parse', 'dicta-il/dictabert-large-parse', 'dicta-il/dictabert-tiny-parse', 'dicta-il/dictabert-tiny-joint']


def batches(texts, budget):
    order = sorted(range(len(texts)), key=lambda i: len(texts[i]))
    i = 0
    while i < len(order):
        n = 1
        while i + n < len(order) and n < 48 and max(8, len(texts[order[i + n]]) // 3) * (n + 1) <= budget:
            n += 1
        yield order[i:i + n]
        i += n


def fill_head(model, model_id, revision, head):
    """dictabert-seg and dictabert-morph store their task head without the `prefix.` / `morph.` name the current model
    code expects, so a plain load leaves the head at random values (transformers only prints a note). Load the head
    from the weights file under the expected name, and refuse to go on unless every head weight was found."""
    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file
    state = load_file(hf_hub_download(model_id, 'model.safetensors', revision=revision))
    want = [k for k in model.state_dict() if k.startswith(head + '.')]
    renamed = {head + '.' + k: v for k, v in state.items() if (head + '.' + k) in want}
    missing = sorted(set(want) - set(renamed))
    if missing:
        raise RuntimeError(f'{model_id}: head weights not found in the checkpoint: {missing[:4]}')
    model.load_state_dict(renamed, strict=False)


def run_predict(model_id, texts, budget, head=None, **kw):
    import torch
    from transformers import AutoModel
    rev = revision(model_id)
    tok = load_tokenizer(model_id, rev)
    try:
        model = AutoModel.from_pretrained(model_id, revision=rev, code_revision=revision(CODE_REPO), trust_remote_code=True).eval()
    except Exception:
        model = AutoModel.from_pretrained(model_id, revision=rev, trust_remote_code=True).eval()
    if head:
        fill_head(model, model_id, rev, head)
    out = [None] * len(texts)
    for idx in batches(texts, budget):
        with torch.no_grad():
            res = model.predict([texts[k] for k in idx], tok, **kw)
        for k, r in zip(idx, res):
            out[k] = r
    return out


def drop_cache(model_id):
    from huggingface_hub.constants import HF_HUB_CACHE
    shutil.rmtree(os.path.join(HF_HUB_CACHE, 'models--' + model_id.replace('/', '--')), ignore_errors=True)


def feats(tok):
    f = tok['morph']['feats']
    return {'pos': tok['morph']['pos'], 'gender': f.get('Gender'), 'number': f.get('Number')}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--segments', required=True)
    ap.add_argument('--joint-cache', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', nargs='*')
    ap.add_argument('--keep', action='store_true')
    a = ap.parse_args()
    segs = json.load(open(a.segments, encoding='utf8'))['segments']
    joint = json.load(open(a.joint_cache, encoding='utf8'))
    texts = sorted({s['model'] for s in segs.values()})
    base = {t: joint[t] for t in texts}
    report = {'schema': 'alef.morph.crosscheck/1', 'reference': 'dicta-il/dictabert-joint', 'texts': len(texts), 'words': sum(len(v) for v in base.values()), 'models': {}, 'items': []}
    if os.path.exists(a.out):
        prev = json.load(open(a.out, encoding='utf8'))
        report['models'] = prev.get('models', {})
        report['items'] = prev.get('items', [])

    def compare(model_id, per_text, fields):
        """per_text: text -> list aligned with the joint tokens of {field: value} (or None where it could not be aligned)."""
        c = collections.Counter()
        report['items'] = [i for i in report['items'] if i['model'] != model_id]
        for t in texts:
            theirs = per_text.get(t)
            if theirs is None or len(theirs) != len(base[t]):
                c['textsNotAligned'] += 1
                continue
            for jt, ot in zip(base[t], theirs):
                mine = {'lemma': jt['lex'], 'prefix': jt['seg'][0] if len(jt['seg']) > 1 else '', **feats(jt), 'name': jt['ner'][2:] if jt['ner'] != 'O' else None}
                for f in fields:
                    c[f + ':n'] += 1
                    if ot.get(f) == mine[f]:
                        c[f + ':same'] += 1
                    else:
                        report['items'].append({'model': model_id, 'word': jt['token'], 'in': t if len(t) < 120 else None, 'field': f, 'joint': mine[f], 'other': ot.get(f)})
        report['models'][model_id] = {'revision': revision(model_id), 'status': 'ran',
                                      'agreement': {f: {'n': c[f + ':n'], 'same': c[f + ':same'], 'pct': round(100 * c[f + ':same'] / c[f + ':n'], 2) if c[f + ':n'] else None} for f in fields},
                                      'textsNotAligned': c['textsNotAligned']}

    def attempt(model_id, fn):
        if a.only and model_id not in a.only:
            return
        try:
            fn()
        except Exception as ex:  # a model that will not load is recorded, not hidden
            report['models'][model_id] = {'revision': revision(model_id), 'status': 'failed', 'error': f'{type(ex).__name__}: {str(ex)[:300]}'}
            traceback.print_exc()
        finally:
            if not a.keep:
                drop_cache(model_id)
            json.dump(scrub(report), open(a.out, 'w', encoding='utf8'), ensure_ascii=False, indent=0)
            print(model_id, json.dumps(report['models'].get(model_id), ensure_ascii=False), flush=True)

    def joint_style(model_id):
        def go():
            res = run_predict(model_id, texts, 1200 if 'large' not in model_id else 600, output_style='json')
            per = {}
            for t, r in zip(texts, res):
                per[t] = [{'lemma': k['lex'], 'prefix': k['seg'][0] if len(k['seg']) > 1 else '', **feats(k)} for k in r['tokens']]
            compare(model_id, per, ['lemma', 'prefix', 'pos', 'gender', 'number'])
        return go

    def lex():
        res = run_predict('dicta-il/dictabert-lex', texts, 1200)
        compare('dicta-il/dictabert-lex', {t: [{'lemma': lemma} for _, lemma in r] for t, r in zip(texts, res)}, ['lemma'])

    def seg():
        res = run_predict('dicta-il/dictabert-seg', texts, 4000, head='prefix')
        compare('dicta-il/dictabert-seg', {t: [{'prefix': w[0] if len(w) > 1 else ''} for w in r[1:-1]] for t, r in zip(texts, res)}, ['prefix'])

    def morph():
        res = run_predict('dicta-il/dictabert-morph', texts, 4000, head='morph')
        compare('dicta-il/dictabert-morph', {t: [{'pos': k['pos'], 'gender': k['feats'].get('Gender'), 'number': k['feats'].get('Number')} for k in r['tokens']] for t, r in zip(texts, res)}, ['pos', 'gender', 'number'])

    def ner():
        import numpy as np
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        mid = 'onnx-community/dictabert-ner-ONNX'
        rev = revision(mid)
        path = hf_hub_download(mid, 'onnx/model_int8.onnx', revision=rev)
        cfg = json.load(open(hf_hub_download(mid, 'config.json', revision=rev), encoding='utf8'))
        tok = load_tokenizer(mid, rev)
        sess = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
        names = {i.name for i in sess.get_inputs()}
        per = {}
        for t in texts:
            enc = tok(t, return_tensors='np', truncation=True)
            feed = {k: v.astype(np.int64) for k, v in enc.items() if k in names}
            if 'token_type_ids' in names and 'token_type_ids' not in feed:
                feed['token_type_ids'] = np.zeros_like(feed['input_ids'])
            logits = sess.run(None, feed)[0][0]
            toks = tok.convert_ids_to_tokens(enc['input_ids'][0])
            out = []
            for i, piece in enumerate(toks):
                if piece in ('[CLS]', '[SEP]', '[PAD]') or piece.startswith('##'):
                    continue
                lab = cfg['id2label'][str(int(logits[i].argmax()))]
                out.append({'name': lab[2:] if lab != 'O' else None})
            per[t] = out
        compare(mid, per, ['name'])

    for mid in JOINT_STYLE:
        attempt(mid, joint_style(mid))
    attempt('dicta-il/dictabert-lex', lex)
    attempt('dicta-il/dictabert-seg', seg)
    attempt('dicta-il/dictabert-morph', morph)
    attempt('onnx-community/dictabert-ner-ONNX', ner)
    print('done', flush=True)


if __name__ == '__main__':
    main()
