#!/usr/bin/env python3
"""How far each small build's answers are from the full-size model's, on ordinary unpointed sentences.

    python scripts/compare_builds.py --app <Al-Heb checkout> --tokenizer <tokenizer.json> --lines 300 \
        --ref fp32=build/menaked/menaked.fp32.onnx --model int8=... --model q4=... --out review/build-agreement.json

The sentences are the example sentences of the app's vocabulary packs (Tatoeba, written without points in everyday full
spelling), an even sample. For each build: the share of Hebrew words pointed exactly as the reference build points them.
This measures what is lost by making the model smaller; it does not say the reference is right.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nikud_core as core  # noqa: E402
from eval_accuracy import Model  # noqa: E402


def sample_lines(app: str, n: int):
    lines, seen = [], set()
    for f in sorted(glob.glob(os.path.join(app, "data", "vocab", "packs", "*.json"))):
        for w in json.load(open(f, encoding="utf-8")).get("words", []):
            ex = (w.get("example") or {}).get("he")
            if ex and ex not in seen and not core.has_points(ex) and not core.guard_name(ex)[1]:
                seen.add(ex)
                lines.append(ex)
    step = max(len(lines) / n, 1)
    return [lines[int(i * step)] for i in range(min(n, len(lines)))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--app", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--lines", type=int, default=300)
    ap.add_argument("--ref", required=True)
    ap.add_argument("--model", action="append", default=[])
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    vocab = core.load_vocab(a.tokenizer)
    lines = sample_lines(a.app, a.lines)
    rname, rpath = a.ref.split("=", 1)
    m = Model(rpath, vocab)
    t0 = time.time()
    ref = [m.point(line) for line in lines]
    report = {"lines": len(lines), "words": sum(len(core.split_words(r)) for r in ref), "reference": rname, "referenceSecondsPerLine": round((time.time() - t0) / len(lines), 3), "builds": {}}
    del m
    for spec in a.model:
        name, path = spec.split("=", 1)
        m = Model(path, vocab)
        t0 = time.time()
        same = total = lines_same = 0
        examples = []
        for line, r in zip(lines, ref):
            g = m.point(line)
            lines_same += g == r
            for x, y in zip(core.split_words(r), core.split_words(g)):
                total += 1
                same += x == y
                if x != y and len(examples) < 25:
                    examples.append({"reference": x, "build": y})
        report["builds"][name] = {"bytes": os.path.getsize(path), "wordsSame": same, "words": total, "wordShare": round(same / max(total, 1), 4),
                                  "linesSame": lines_same, "secondsPerLine": round((time.time() - t0) / len(lines), 3), "examples": examples}
        print(name, report["builds"][name]["wordShare"], lines_same, "/", len(lines), flush=True)
        del m
        json.dump(report, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
