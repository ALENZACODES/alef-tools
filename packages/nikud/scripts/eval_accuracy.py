#!/usr/bin/env python3
"""Measures nikud accuracy against the app's own pointed text.

    python scripts/eval_accuracy.py --app <Al-Heb checkout> --tokenizer <tokenizer.json> \
        --model fp32=build/menaked/menaked.fp32.onnx --model int8=... --out review/accuracy.json

Two sets, both taken from the app as it is:
  sentences  every pointed Hebrew line of three or more words under data/curriculum (no cantillation, no Latin letters).
             Files whose lines are everyday modern Hebrew are counted as "modern"; lessons.json and
             lessons-intermediate mix everyday lines with prayer lines and are counted as "mixed".
  words      the pointed headwords of data/vocab/words.json, one at a time, with no sentence around them.

The points are stripped, the bare text goes through the model, and the result is compared word by word.
  strict        every mark the same (after putting marks in one order and dropping meteg)
  lenient       as strict, but qamats qatan (U+05C7) counts as qamats: the app's text does not use the separate sign
  letters       share of Hebrew letters carrying exactly the same marks (lenient)
"full spelling" words are those with no kubutz and no holam on a letter other than vav: the app writes pointed words
in short spelling (סֻכָּר), which without points reads as a different word (סכר), so those words are counted apart too.
The divine Name is left out of every count.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nikud_core as core  # noqa: E402

MODERN = ("practical", "practical-pages", "dialogues.json", "israel-units.json", "gender-pairs.json", "practical-units.json", "loanwords.json")
LETTER_MARKS = re.compile("([א-ת])([ְ-ׇּׁׂ]*)")


def collect_sentences(app: str):
    seen, out = set(), []

    def walk(o, key, kind):
        if isinstance(o, str):
            if (key in ("he", "m", "f", "text") and core.has_points(o) and not core.CANTILLATION.search(o) and not re.search("[A-Za-z]", o)
                    and len(core.split_words(o)) >= 3 and o not in seen):
                seen.add(o)
                out.append((kind, o))
        elif isinstance(o, list):
            for x in o:
                walk(x, key, kind)
        elif isinstance(o, dict):
            for k, v in o.items():
                walk(v, k, kind)

    root = os.path.join(app, "data", "curriculum")
    for f in sorted(glob.glob(os.path.join(root, "**", "*.json"), recursive=True)):
        rel = os.path.relpath(f, root).replace(os.sep, "/")
        kind = "modern" if rel.split("/")[0] in MODERN else "mixed"
        try:
            walk(json.load(open(f, encoding="utf-8")), "", kind)
        except (ValueError, OSError):
            pass
    return out


def collect_words(app: str):
    recs = json.load(open(os.path.join(app, "data", "vocab", "words.json"), encoding="utf-8"))["words"]
    return [r["he"] for r in sorted(recs, key=lambda r: r["id"]) if r.get("he") and core.has_points(r["he"]) and not core.CANTILLATION.search(r["he"])]


def is_full_spelling(word: str) -> bool:
    if "ֻ" in word:
        return False
    return not any(letter != "ו" and "ֹ" in marks for letter, marks in LETTER_MARKS.findall(word))


def letter_marks(word: str):
    return [(letter, "".join(sorted(marks))) for letter, marks in LETTER_MARKS.findall(core.canonical(word, True))]


class Model:
    def __init__(self, path: str, vocab, threads: int = 0):
        import onnxruntime as ort
        so = ort.SessionOptions()
        if threads:
            so.intra_op_num_threads = threads
        self.s = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
        self.names = [i.name for i in self.s.get_inputs()]
        self.outs = [o.name for o in self.s.get_outputs()]
        self.vocab = vocab

    def raw(self, bare: str):
        ids = np.array([core.encode(bare, self.vocab)], dtype=np.int64)
        feeds = {"input_ids": ids, "attention_mask": np.ones_like(ids)}
        if "token_type_ids" in self.names:
            feeds["token_type_ids"] = np.zeros_like(ids)
        return dict(zip(self.outs, self.s.run(self.outs, feeds)))

    def point(self, bare: str, enhanced: bool = False, keep_matres: bool = True) -> str:
        o = self.raw(bare)
        extra = None
        if enhanced and "additional_logits" in o:
            extra = (o["additional_logits"][0, 1:-1] > 0)
        return core.decode(bare, o["nikud_logits"][0, 1:-1].argmax(-1), o["shin_logits"][0, 1:-1].argmax(-1), extra, keep_matres)


def score(model: Model, items, sample_note: str):
    tally = {}
    misses = []
    t0 = time.time()

    def add(group, strict, lenient, full, same_letters, letters):
        for g in (group, group + "/full-spelling") if full else (group,):
            t = tally.setdefault(g, {"words": 0, "strict": 0, "lenient": 0, "letters": 0, "lettersSame": 0})
            t["words"] += 1
            t["strict"] += strict
            t["lenient"] += lenient
            t["letters"] += letters
            t["lettersSame"] += same_letters

    for kind, text in items:
        guarded, _ = core.guard_name(text)
        got = model.point(core.strip_points(guarded))
        gw, pw = core.split_words(text), core.split_words(got)
        gw2 = core.split_words(guarded)
        if len(gw) != len(pw) or len(gw2) != len(gw):
            continue
        for a, a2, b in zip(gw, gw2, pw):
            if a != a2:  # the Name: not counted
                continue
            strict = core.canonical(a) == core.canonical(b)
            lenient = core.canonical(a, True) == core.canonical(b, True)
            la, lb = letter_marks(a), letter_marks(b)
            same = sum(x == y for x, y in zip(la, lb)) if len(la) == len(lb) else 0
            add(kind, strict, lenient, is_full_spelling(a), same, len(la))
            if not lenient and len(misses) < 400:
                misses.append({"set": kind, "app": a, "model": b, "line": text if kind != "words" else None})
    for t in tally.values():
        t["strictShare"] = round(t["strict"] / max(t["words"], 1), 4)
        t["lenientShare"] = round(t["lenient"] / max(t["words"], 1), 4)
        t["letterShare"] = round(t["lettersSame"] / max(t["letters"], 1), 4)
    return {"sample": sample_note, "seconds": round(time.time() - t0, 1), "sets": tally, "misses": misses}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--app", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--model", action="append", required=True, help="name=path, repeatable")
    ap.add_argument("--max-words", type=int, default=0, help="0 = all headwords; else an even sample of this many")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    vocab = core.load_vocab(a.tokenizer)
    sents = collect_sentences(a.app)
    words = collect_words(a.app)
    if a.max_words and len(words) > a.max_words:
        step = len(words) / a.max_words
        words = [words[int(i * step)] for i in range(a.max_words)]
    items = sents + [("words", w) for w in words]
    note = f"{len(sents)} sentences, {len(words)} headwords"
    print(note, flush=True)
    report = {"appCommit": os.popen(f"git -C {a.app} rev-parse HEAD 2>/dev/null").read().strip(), "items": note, "models": {}}
    if os.path.exists(a.out):
        report["models"] = json.load(open(a.out, encoding="utf-8")).get("models", {})
    for spec in a.model:
        name, path = spec.split("=", 1)
        m = Model(path, vocab)
        r = score(m, items, note)
        r["bytes"] = os.path.getsize(path)
        report["models"][name] = r
        print(name, json.dumps({k: (v["words"], v["strictShare"], v["lenientShare"], v["letterShare"]) for k, v in r["sets"].items()}), r["seconds"], "s", flush=True)
        del m
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
