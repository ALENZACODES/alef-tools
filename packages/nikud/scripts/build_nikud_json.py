#!/usr/bin/env python3
"""Build-time nikud for the app's own sentences. Writes src/nikud/<unit>.json (copied to dist/nikud/) and review/nikud-diff.json.

    python scripts/build_nikud_json.py --app <Al-Heb checkout> --tokenizer <tokenizer.json> \
        --menaked build/menaked/menaked.fp32.onnx --phonikud <phonikud-1.0.int8.onnx> [--only talk,lessons] [--limit N]

Units
  vocab-<pack>   every word of a vocabulary pack: the headword (already pointed in the app) and its example sentence (bare).
  talk           the stored Hebrew lines of the Talk screen (bare).
  lessons        pointed lines of three or more words under data/curriculum.

Each line: {"t": the text as the app has it, "p": pointed text, "ph": sound line or null, "s": source}
  s = "book"     the app's own pointing, kept exactly; the model read it differently (the difference is in review/nikud-diff.json)
  s = "checked"  the app's own pointing, kept exactly; the model agrees with it
  s = "model"    the app had no points for this line; these are the model's and have not been read by a person

Rules this script keeps (tests/build.test.js checks the output):
  - Text the app already points is never changed: for "book" and "checked", p == t.
  - Text with cantillation marks is skipped. Nothing under data/corpus (Torah, prayers) is read at all.
  - A line that holds the divine Name is skipped when the app points it, and otherwise gets the Name as he + geresh and no sound line.
  - A unit file may not exceed 300 KiB.
The sound lines are added by scripts/add_sounds.mjs (the same code the browser runs), called at the end.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nikud_core as core  # noqa: E402
from eval_accuracy import Model, collect_sentences  # noqa: E402

MAX_UNIT_BYTES = 300 * 1024
HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)


def carry_marks(book: str, marked: str) -> str:
    """Puts phonikud's stress / sounded-shva / prefix marks onto the app's own pointing of the same letters."""
    def split(w):
        out = []
        for ch in w:
            if core.is_letter(ch):
                out.append([ch, ""])
            elif out:
                out[-1][1] += ch
        return out
    a, b = split(book), split(marked)
    if len(a) != len(b) or any(x[0] != y[0] for x, y in zip(a, b)):
        return marked
    res = []
    for (ch, own), (_, m) in zip(a, b):
        extra = (core.STRESS if core.STRESS in m else "") + (core.VOCAL_SHVA if core.VOCAL_SHVA in m and "ְ" in own else "") + (core.PREFIX if core.PREFIX in m else "")
        res.append(ch + own + extra)
    return "".join(res)


def carry_line(book: str, marked: str) -> str:
    """Word by word: pointed words of `book` keep their points and take the marks; everything else comes from `marked`."""
    import re
    pat = re.compile("[א-ת֑-ֽֿ-ׇ|]+")
    bw = list(pat.finditer(book))
    mw = pat.findall(marked)
    if len(bw) != len(mw):
        return marked
    out, at = [], 0
    for m, w in zip(bw, mw):
        out.append(book[at:m.start()])
        out.append(carry_marks(m.group(0), w) if core.has_points(m.group(0)) else w)
        at = m.end()
    out.append(book[at:])
    return "".join(out)


class Builder:
    def __init__(self, menaked: Model, phonikud: Model | None):
        self.m, self.p = menaked, phonikud
        self.diff = []
        self.counts = {"book": 0, "checked": 0, "model": 0, "skippedName": 0, "skippedCantillation": 0}
        self.cache = {}

    def line(self, unit: str, text: str):
        text = text.strip()
        if not text or not any(core.is_letter(c) for c in text):
            return None
        if core.CANTILLATION.search(text):
            self.counts["skippedCantillation"] += 1
            return None
        if text in self.cache:
            hit = dict(self.cache[text])
            self.counts[hit["s"]] += 1
            return hit
        guarded, name = core.guard_name(text)
        pointed_in_app = core.has_points(text)
        if name and pointed_in_app:
            self.counts["skippedName"] += 1
            return None
        bare = core.strip_points(guarded)
        model = self.m.point(bare)
        if name:
            model = model.replace("הַ׳", core.NAME_SHOWN)
            import re
            model = re.sub("ה[ְ-ׇ]*׳", core.NAME_SHOWN, model)
        if pointed_in_app:
            gw, pw = core.split_words(text), core.split_words(model)
            same = len(gw) == len(pw) and all(core.canonical(a, True) == core.canonical(b, True) for a, b in zip(gw, pw))
            src = "checked" if same else "book"
            if not same:
                words = [{"i": i, "book": a, "model": b} for i, (a, b) in enumerate(zip(gw, pw)) if core.canonical(a, True) != core.canonical(b, True)] if len(gw) == len(pw) else []
                self.diff.append({"unit": unit, "text": text, "model": model, "words": words})
            shown = text
        else:
            src, shown = "model", model
        marked = None
        if self.p is not None and not name:
            marked = self.p.point(bare, enhanced=True)
            marked = carry_line(shown, marked)
        self.counts[src] += 1
        rec = {"t": text, "p": shown, "ph": None, "s": src}
        if marked is not None:
            rec["_marked"] = marked
        self.cache[text] = rec
        return dict(rec)


def units_from_app(app: str, only):
    def want(u):
        return not only or u in only or (u.startswith("vocab-") and "vocab" in only)
    for f in sorted(glob.glob(os.path.join(app, "data", "vocab", "packs", "*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        if "words" not in d or "pack" not in d:  # the vocab5k tier files have another shape and no example sentences
            continue
        unit = "vocab-" + d["pack"]
        if not want(unit):
            continue
        texts = []
        for w in d["words"]:
            if w.get("he"):
                texts.append(w["he"])
            ex = (w.get("example") or {}).get("he")
            if ex:
                texts.append(ex)
        yield unit, texts
    if want("talk"):
        texts, seen = [], set()

        def walk(o, key=""):
            if isinstance(o, str):
                if key in ("he", "f", "pl", "def", "alt") and any(core.is_letter(c) for c in o) and o not in seen:
                    seen.add(o)
                    texts.append(o)
            elif isinstance(o, list):
                for x in o:
                    walk(x, key)
            elif isinstance(o, dict):
                for k, v in o.items():
                    walk(v, k)
        for f in sorted(glob.glob(os.path.join(app, "data", "talk", "*.json"))):
            walk(json.load(open(f, encoding="utf-8")))
        yield "talk", texts
    if want("lessons"):
        yield "lessons", [t for _, t in collect_sentences(app)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--app", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--menaked", required=True)
    ap.add_argument("--phonikud")
    ap.add_argument("--out", default=os.path.join(PKG, "src", "nikud"), help="unit files; scripts/build-dist.mjs copies src/ to dist/")
    ap.add_argument("--review", default=os.path.join(PKG, "review"))
    ap.add_argument("--only", default="")
    ap.add_argument("--limit", type=int, default=0, help="at most this many lines per unit (for a quick trial)")
    ap.add_argument("--resume", action="store_true", help="skip units that were already written by an earlier, interrupted run")
    ap.add_argument("--built-with", default="", help="note written into each unit, e.g. model ids and revisions")
    a = ap.parse_args()
    vocab = core.load_vocab(a.tokenizer)
    b = Builder(Model(a.menaked, vocab), Model(a.phonikud, vocab) if a.phonikud else None)
    os.makedirs(a.out, exist_ok=True)
    os.makedirs(a.review, exist_ok=True)
    only = {x for x in a.only.split(",") if x}
    parts_dir = os.path.join(a.review, ".parts")
    os.makedirs(parts_dir, exist_ok=True)
    index = []
    for unit, texts in units_from_app(a.app, only):
        path = os.path.join(a.out, unit + ".json")
        part = os.path.join(parts_dir, unit + ".json")
        index.append(unit)
        if a.resume and os.path.exists(path) and os.path.exists(part):
            continue
        if a.limit:
            texts = texts[: a.limit]
        b.diff, b.counts = [], {k: 0 for k in b.counts}
        lines, seen = [], set()
        for t in texts:
            if t.strip() in seen:
                continue
            seen.add(t.strip())
            rec = b.line(unit, t)
            if rec:
                lines.append(rec)
        doc = {"schema": "alef.nikud.unit.v1", "unit": unit, "builtWith": a.built_with, "lines": lines}
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        with open(part, "w", encoding="utf-8") as f:
            json.dump({"counts": b.counts, "diff": b.diff}, f, ensure_ascii=False)
        print(unit, len(lines), flush=True)
    counts, diff = {}, []
    for unit in index:
        p = json.load(open(os.path.join(parts_dir, unit + ".json"), encoding="utf-8"))
        diff += p["diff"]
        for k, v in p["counts"].items():
            counts[k] = counts.get(k, 0) + v
    app_commit = os.popen(f"git -C {a.app} rev-parse HEAD 2>/dev/null").read().strip()
    with open(os.path.join(a.review, "nikud-diff.json"), "w", encoding="utf-8") as f:
        json.dump({"schema": "alef.nikud.diff.v1", "note": "Lines the app already points where the model reads at least one word differently. The app's text was kept in every case; nothing here was written back.",
                   "appCommit": app_commit, "counts": counts, "lines": diff}, f, ensure_ascii=False, indent=1)
    # sound lines, by the same code the browser runs
    subprocess.run(["node", os.path.join(HERE, "add_sounds.mjs"), a.out], check=True)
    for unit in index:
        size = os.path.getsize(os.path.join(a.out, unit + ".json"))
        if size > MAX_UNIT_BYTES:
            raise SystemExit(f"{unit}.json is {size} bytes, over the 300 KiB limit")
    with open(os.path.join(a.out, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"schema": "alef.nikud.index.v1", "appCommit": app_commit, "builtWith": a.built_with, "counts": counts,
                   "units": {u: os.path.getsize(os.path.join(a.out, u + ".json")) for u in sorted(index)}}, f, ensure_ascii=False, indent=1)
    print(counts)


if __name__ == "__main__":
    main()
