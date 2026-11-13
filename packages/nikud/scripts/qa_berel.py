#!/usr/bin/env python3
"""Offline only: flags words in Biblical and prayer text that BEREL finds unlikely, for a person to look at.

    python scripts/qa_berel.py --model-dir <snapshot folder> --app <Al-Heb checkout> --files "data/corpus/**/*.json" \
        [--limit 200] --out review/berel-flags.json

Model: dicta-il/BEREL_3.0 (Apache-2.0), revision 25dc07f2e622ba14eeea6c026eaa54f3586ceabf, a word-prediction model for
Rabbinic and Biblical Hebrew. It reads letters only, so this is a check of the wording under the points, not of the points:
each word is hidden in turn and the model is asked how likely the real word is in that place. A word it ranks very low is
listed. Most flags will be fine (names, rare words); the list is a place to look, nothing more.

This script NEVER changes a text. Torah and prayer text keep their source points and wording; the nikud model of this
package is not run on them at all. The divine Name is left out of the lists.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nikud_core as core  # noqa: E402


def collect(app: str, pattern: str, keys, limit: int):
    seen, out = set(), []

    def walk(o, key, rel):
        if limit and len(out) >= limit:
            return
        if isinstance(o, str):
            if key in keys and core.has_points(o) and len(core.split_words(o)) >= 4 and o not in seen:
                seen.add(o)
                out.append((rel, o))
        elif isinstance(o, list):
            for x in o:
                walk(x, key, rel)
        elif isinstance(o, dict):
            for k, v in o.items():
                walk(v, k, rel)

    for f in sorted(glob.glob(os.path.join(app, pattern), recursive=True)):
        try:
            walk(json.load(open(f, encoding="utf-8")), "", os.path.relpath(f, app))
        except (ValueError, OSError):
            pass
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--app", required=True)
    ap.add_argument("--files", default="data/corpus/**/*.json")
    ap.add_argument("--keys", default="he")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--min-rank", type=int, default=1000, help="flag a word when the model ranks it below this many others")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    import torch
    from transformers import AutoTokenizer, BertForMaskedLM
    tok = AutoTokenizer.from_pretrained(a.model_dir)
    model = BertForMaskedLM.from_pretrained(a.model_dir).eval()
    lines = collect(a.app, a.files, set(a.keys.split(",")), a.limit)
    flags, words_seen = [], 0
    for rel, text in lines:
        guarded, _ = core.guard_name(text)
        bare = core.strip_points(guarded).replace("־", " ")
        words = [w for w in bare.split() if any(core.is_letter(c) for c in w)]
        enc = tok(words, is_split_into_words=True, return_tensors="pt", truncation=True, max_length=512)
        wid = enc.word_ids(0)
        for wi, w in enumerate(words):
            pos = [k for k, x in enumerate(wid) if x == wi]
            if len(pos) != 1 or core.NAME_SHOWN in w:  # only whole-word tokens are scored; the Name is never listed
                continue
            words_seen += 1
            ids = enc["input_ids"].clone()
            real = int(ids[0, pos[0]])
            ids[0, pos[0]] = tok.mask_token_id
            with torch.no_grad():
                logp = torch.log_softmax(model(input_ids=ids, attention_mask=enc["attention_mask"]).logits[0, pos[0]], -1)
            rank = int((logp > logp[real]).sum())
            if rank >= a.min_rank:
                flags.append({"file": rel, "line": text, "word": w, "rank": rank, "logProb": round(float(logp[real]), 2),
                              "modelWouldSay": tok.convert_ids_to_tokens(logp.topk(3).indices.tolist())})
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"schema": "alef.nikud.berel-flags.v1", "note": "Words BEREL ranks very low in their place. A list for a person to read; no text was changed.",
                   "lines": len(lines), "wordsScored": words_seen, "minRank": a.min_rank, "flags": sorted(flags, key=lambda x: -x["rank"])}, f, ensure_ascii=False, indent=1)
    print(f"{len(lines)} lines, {words_seen} words scored, {len(flags)} flagged")


if __name__ == "__main__":
    main()
