#!/usr/bin/env python3
"""Draft example sentences for the words of a unit. Build time only; the output is candidates, not content.

    python scripts/gen_examples.py --app ../Al-Heb --units pu-greetings pu-cafe --out work/examples.jsonl

Each unit item of one or two Hebrew words gets --n drafts from the generator. A draft is kept as a candidate only if it
is Hebrew, contains the item, and is 3 to 9 words long; everything else is counted and dropped here. Candidates then go
through scripts/judge.py and scripts/gate.py. Nothing in this file decides what ships.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import App, has_hebrew, he_key, read_json, read_jsonl, stable_id, unprefixed, write_json, write_jsonl  # noqa: E402


def targets(unit: dict, max_words: int = 2) -> list[dict]:
    out, seen = [], set()
    for it in unit.get("items", []):
        k = he_key(it.get("he", ""))
        if not k or len(k.split()) > max_words or k in seen:
            continue
        seen.add(k)
        out.append({"itemId": it["id"], "he": it["he"], "en": it.get("en", "")})
    return out


def contains_target(sentence: str, target: str) -> bool:
    """Every word of the target appears in the sentence, bare or behind a one- or two-letter prefix, in order."""
    words = he_key(sentence).split()
    pos = 0
    for t in he_key(target).split():
        for i in range(pos, len(words)):
            if t in unprefixed(words[i]):
                pos = i + 1
                break
        else:
            return False
    return True


def prefilter(he: str, en: str, target_he: str) -> str | None:
    """Reason a draft is dropped before judging, or None to keep it."""
    if not isinstance(he, str) or not isinstance(en, str) or not he.strip() or not en.strip():
        return "empty"
    if not has_hebrew(he) or any("a" <= c.lower() <= "z" for c in he):
        return "not-hebrew"
    n = len(he_key(he).split())
    if n < 3 or n > 9:
        return "length"
    if not contains_target(he, target_he):
        return "target-missing"
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app", required=True, help="path to an Al-Heb checkout")
    ap.add_argument("--units", nargs="+", required=True)
    ap.add_argument("--out", default="work/examples.jsonl")
    ap.add_argument("--model", default="gen-1.7b")
    ap.add_argument("--n", type=int, default=2)
    ap.add_argument("--limit", type=int, default=0, help="at most this many words per unit (0 = all)")
    a = ap.parse_args()

    from llm import Chat, fill, load_prompt

    app = App(a.app)
    prompt = load_prompt("examples")
    chat = Chat(a.model)
    levels = {u["id"]: u for u in app.units()}
    rows = read_jsonl(a.out)
    done = {(r["unit"], r["target"]["itemId"]) for r in rows}
    stats = {"asked": 0, "drafts": 0, "kept": 0, "dropped": {}}
    t0 = time.time()
    for unit_id in a.units:
        unit = app.unit(unit_id)
        todo = targets(unit)
        if a.limit:
            todo = todo[: a.limit]
        for t in todo:
            if (unit_id, t["itemId"]) in done:
                continue
            stats["asked"] += 1
            reply = chat.ask(prompt["system"], fill(prompt["user"], n=a.n, target_he=he_key_display(t["he"]), target_en=t["en"], unit_title=unit["title"]),
                             max_tokens=200, temperature=0.5)
            seen = set()
            for s in drafts(reply)[: a.n]:
                stats["drafts"] += 1
                he, en = str(s.get("he", "")).strip(), str(s.get("en", "")).strip()
                why = prefilter(he, en, t["he"])
                if not why and he_key(he) in seen:
                    why = "repeat"
                if why:
                    stats["dropped"][why] = stats["dropped"].get(why, 0) + 1
                    continue
                seen.add(he_key(he))
                stats["kept"] += 1
                rows.append({"id": "ex-" + stable_id(unit_id, t["itemId"], he_key(he)), "type": "example", "unit": unit_id, "level": levels[unit_id]["level"],
                             "target": t, "he": he, "en": en, "generator": chat.tag})
            write_jsonl(a.out, rows)
            print(f"[{time.time() - t0:6.0f}s] {unit_id} {t['itemId']}: {stats['kept']} kept of {stats['drafts']} drafts", flush=True)
    chat.close()
    print("gen_examples", stats)
    # Running totals across runs, so the report can say how many drafts were written in all (not only how many were judged).
    spath = Path(a.out).with_suffix(".stats.json")
    total = read_json(spath) if spath.exists() else {"asked": 0, "drafts": 0, "kept": 0, "dropped": {}}
    for k in ("asked", "drafts", "kept"):
        total[k] += stats[k]
    for k, v in stats["dropped"].items():
        total["dropped"][k] = total["dropped"].get(k, 0) + v
    write_json(spath, total)


_STR = r'"((?:[^"\\]|\\.)*)"'
_PAIR = re.compile(r'\{\s*"he"\s*:\s*' + _STR + r'\s*,\s*"en"\s*:\s*' + _STR + r'\s*\}')


def drafts(reply: str) -> list[dict]:
    """Every complete {"he": ..., "en": ...} pair in a reply, in order. Tolerates code fences, a bare list and a cut-off tail."""
    out = []
    for m in _PAIR.finditer(reply or ""):
        try:
            out.append({"he": json.loads('"' + m.group(1) + '"'), "en": json.loads('"' + m.group(2) + '"')})
        except json.JSONDecodeError:
            continue
    return out


def he_key_display(he: str) -> str:
    """The item as the generator sees it: unpointed, so its reply can repeat it letter for letter."""
    from common import strip_points
    return " ".join(strip_points(he).replace("?", " ").replace(",", " ").replace(".", " ").replace("!", " ").split())


if __name__ == "__main__":
    main()
