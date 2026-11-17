#!/usr/bin/env python3
"""Offline only: adds commas, full stops and question marks to unpunctuated Hebrew (scripts, transcripts).

    python scripts/punctuate.py --model-dir <snapshot folder> --in lines.txt --out punctuated.txt

Model: verbit/hebrew_punctuation (Apache-2.0), revision 85f81abab8d179df179c901d260592915e29cce3. The snapshot folder holds
config.json, vocab.txt and pytorch_model.bin. The model's own Python files are not run: the small network (a BERT with a
word-prediction head, one normalising layer and one linear layer over a window of 33 tokens) is rebuilt here, and the weights
are read with weights_only=True.

The output is a suggestion for a person to read. Existing punctuation in the input is removed first, so do not run this
over text that is already punctuated the way you want it. It never runs in the app.
"""
from __future__ import annotations

import argparse
import json
import os
import re

SIGNS = ["", ",", ".", "?"]


def load(model_dir: str):
    import torch
    from torch import nn
    from transformers import BertConfig, BertForMaskedLM, BertTokenizer

    raw = json.load(open(os.path.join(model_dir, "config.json"), encoding="utf-8"))
    back, fwd = raw.get("backward_context", 15), raw.get("forward_context", 16)
    cfg = BertConfig(**{k: v for k, v in raw.items() if k not in ("architectures", "backward_context", "forward_context", "output_size", "dropout")})

    class Net(nn.Module):
        def __init__(self):
            super().__init__()
            seg = back + fwd + 2
            self.bert = BertForMaskedLM(cfg)
            self.bn = nn.BatchNorm1d(seg * cfg.vocab_size)
            self.fc = nn.Linear(seg * cfg.vocab_size, raw.get("output_size", 4))

        def forward(self, x):
            h = self.bert(x)[0]
            return self.fc(self.bn(h.view(h.shape[0], -1)))

    net = Net()
    state = torch.load(os.path.join(model_dir, "pytorch_model.bin"), map_location="cpu", weights_only=True)
    missing, unexpected = net.load_state_dict(state, strict=False)
    missing = [k for k in missing if "position_ids" not in k]
    if missing:
        raise SystemExit(f"weights do not fit the rebuilt network: {missing[:5]}")
    tok = BertTokenizer(os.path.join(model_dir, "vocab.txt"), do_lower_case=False)
    return net.eval(), tok, back, fwd


def punctuate(net, tok, back: int, fwd: int, text: str, batch: int = 8) -> str:
    import torch
    words = re.sub(r"[,.?!;:]", " ", text).split()
    if not words:
        return text
    ids, word_end = [], []
    for w in words:
        t = tok.convert_tokens_to_ids(tok.tokenize(w)) or [0]
        ids += t
        word_end.append(len(ids) - 1)
    pad = [0] * back + ids + [0] * fwd
    rows = []
    for i in word_end:
        seg = pad[i: i + back + fwd + 1]
        seg.insert(back + 1, 0)  # the pause slot; no timing is known for written text
        rows.append(seg)
    out = []
    with torch.no_grad():
        for k in range(0, len(rows), batch):
            out += net(torch.tensor(rows[k: k + batch])).argmax(-1).tolist()
    return " ".join(w + SIGNS[c] for w, c in zip(words, out))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    net, tok, back, fwd = load(a.model_dir)
    with open(a.src, encoding="utf-8") as f, open(a.out, "w", encoding="utf-8") as o:
        for line in f:
            line = line.strip()
            o.write((punctuate(net, tok, back, fwd, line) if line else "") + "\n")


if __name__ == "__main__":
    main()
