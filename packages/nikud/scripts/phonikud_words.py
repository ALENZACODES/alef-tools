#!/usr/bin/env python3
"""Runs the phoneme pack over a list of bare words or lines and saves its marked output (step 2 of agree_rules.mjs).

    python scripts/phonikud_words.py --tokenizer <tokenizer.json> --phonikud <phonikud-1.0.int8.onnx> words.json marked.json
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nikud_core as core  # noqa: E402
from eval_accuracy import Model  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--tokenizer", required=True)
ap.add_argument("--phonikud", required=True)
ap.add_argument("src")
ap.add_argument("dst")
a = ap.parse_args()
m = Model(a.phonikud, core.load_vocab(a.tokenizer))
words = json.load(open(a.src, encoding="utf-8"))
json.dump({w: m.point(w, enhanced=True) for w in words}, open(a.dst, "w", encoding="utf-8"), ensure_ascii=False)
print(len(words), "done")
