#!/usr/bin/env python3
"""Draft fill-in-the-word quiz items. Build time only; the output is candidates for judge.py and gate.py.

    python scripts/gen_quiz.py --app ../Al-Heb --from-examples src/examples --lines --out work/quiz.jsonl

--from-examples DIR  One item per example sentence that already passed the gate: the unit word is blanked and the other
                     choices are words of the same unit. No model writes anything here.
--lines              One item per single-line Torah or prayer text in the app's registry. BEREL reads the line with one
                     word missing: the word must be one BEREL itself would put back (so the line really determines it),
                     and the wrong choices are words BEREL ranks well below it. The Name is never blanked or offered.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import NAME_SHOWN, App, he_key, he_words, read_json, read_jsonl, show_name, stable_id, strip_points, unprefixed, write_jsonl  # noqa: E402

BLANK = "___"


def _pick(seed: str, options: list[str], n: int) -> list[str]:
    return sorted(options, key=lambda o: hashlib.sha256((seed + o).encode()).hexdigest())[:n]


def _shuffle(seed: str, choices: list[str], answer: str) -> tuple[list[str], int]:
    order = sorted(choices, key=lambda o: hashlib.sha256((seed + "|" + o).encode()).hexdigest())
    return order, order.index(answer)


def from_examples(app: App, examples_dir: Path) -> list[dict]:
    rows = []
    for path in sorted(examples_dir.glob("*.json")):
        data = read_json(path)
        unit = app.unit(data["unit"])
        pool = {}
        for it in unit.get("items", []):
            k = he_key(it.get("he", ""))
            if k and len(k.split()) <= 2:
                pool[k] = " ".join(he_words(it["he"]))
        for ex in data["items"]:
            item = next((it for it in unit["items"] if it["id"] == ex["itemId"]), None)
            if not item:
                continue
            target = " ".join(he_words(item["he"]))
            sentence = strip_points(ex["he"])
            if sentence.count(target) != 1 or target not in sentence.split() and " " not in target:
                continue  # only when the word stands in the sentence exactly as taught, once
            others = [v for k, v in pool.items() if k != he_key(target) and v not in sentence]
            if len(others) < 3:
                continue
            choices, answer = _shuffle(ex["id"], [target] + _pick(ex["id"], others, 3), target)
            rows.append({"id": "qz-" + stable_id(ex["id"]), "type": "quiz", "source": "example", "exampleId": ex["id"], "unit": data["unit"],
                         "stem": sentence.replace(target, BLANK, 1), "choices": choices, "answer": answer, "en": ex["en"]})
    return rows


def from_lines(app: App, top_k: int = 80) -> list[dict]:
    from models_bert import Cloze

    cloze = Cloze()
    rows = []
    for e in app.json("data/corpus/registry.json")["entries"]:
        if e.get("lines") != 1 or e.get("language") != "hebrew":
            continue
        shown = show_name(e["he"])
        tokens = shown.split(" ")
        # BEREL reads unpointed text; a maqaf-joined token is several words to it. Map each shown token to its words.
        plain, owner = [], []
        for ti, tok in enumerate(tokens):
            for w in strip_points(tok.replace(NAME_SHOWN, "ה'")).replace("׃", " ").split():
                plain.append(w)
                owner.append(ti)
        best = None
        for wi, w in enumerate(plain):
            ti = owner[wi]
            if owner.count(ti) != 1 or NAME_SHOWN in tokens[ti] or len(he_key(w)) < 3 or ti == 0:
                continue
            ranked = cloze.fill(plain, wi, top_k=top_k)
            words = [x for x, _ in ranked]
            if he_key(w) not in [he_key(x) for x in words[:5]]:
                continue
            rank = [he_key(x) for x in words].index(he_key(w)) + 1
            prob = ranked[rank - 1][1]
            if best is None or prob > best[0]:
                best = (prob, rank, ti, w, ranked)
        if not best:
            continue
        prob, rank, ti, w, ranked = best
        answer_forms = set(unprefixed(he_key(w)))
        wrong = []
        for x, _ in ranked[8:]:
            k = he_key(x)
            if x.startswith("##") or "'" in x or '"' in x or len(k) < 2 or k != he_key(" ".join(he_words(x))) or " " in k:
                continue
            if set(unprefixed(k)) & answer_forms or k in [he_key(y) for y in wrong] or k in he_key(shown).split():
                continue
            wrong.append(x)
            if len(wrong) == 3:
                break
        if len(wrong) < 3:
            continue
        answer_plain = " ".join(he_words(tokens[ti]))
        choices, answer = _shuffle(e["id"], [answer_plain] + wrong, answer_plain)
        stem = " ".join(BLANK + ("׃" if t.endswith("׃") else "") if i == ti else t for i, t in enumerate(tokens))
        unit = "prayer-" + e["category"]
        rows.append({"id": "qz-" + stable_id(e["id"], str(ti)), "type": "quiz", "source": "line", "lineId": e["id"], "ref": e.get("ref"), "unit": unit, "wordIndex": ti,
                     "stem": stem, "choices": choices, "answer": answer, "en": e.get("english", ""),
                     "checks": {"cloze": {"ok": True, "rank": rank, "prob": round(prob, 4), "detail": f"the line's own word is BEREL's choice {rank}", "provider": cloze.tag}}})
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app", required=True)
    ap.add_argument("--from-examples")
    ap.add_argument("--lines", action="store_true")
    ap.add_argument("--out", default="work/quiz.jsonl")
    a = ap.parse_args()
    app = App(a.app)
    old = {r["id"]: r for r in read_jsonl(a.out)}
    new = (from_examples(app, Path(a.from_examples)) if a.from_examples else []) + (from_lines(app) if a.lines else [])
    for r in new:
        old.setdefault(r["id"], r)  # keep judged rows; add new ones
    write_jsonl(a.out, list(old.values()))
    print(f"gen_quiz: {len(new)} drafted this run, {len(old)} in {a.out}")
