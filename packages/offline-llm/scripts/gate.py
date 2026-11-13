#!/usr/bin/env python3
"""The gate: decides, item by item, what may ship and what goes to the human-review list. Standard library only.

    python scripts/gate.py --app ../Al-Heb --work work --version 1

Reads the judged candidates in work/ (examples.jsonl, quiz.jsonl, ask.jsonl, ask-wordings.jsonl), applies every check
below, and writes
    src/examples/<unit>.json, src/quiz/<unit>.json, src/ask/answers.v<N>.json      items that passed everything (copied to dist/ by the repo build)
    review/examples.json, review/quiz.json, review/ask.json                         everything else, with the reasons
    src/report.json                                                                 counts per type
An item ships only when it passes all of its checks. A check whose result is missing counts as failed: a model stage
that was skipped can never let an item through. A judge counts only if it qualified on the known-answer sentences
(work/judges.json, written by scripts/judge.py --canaries). Shipped items carry "checked": true; nothing else is written there.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (NAME_SHOWN, PKG, App, ai_wording, he_key, name_spelled, read_json, read_jsonl, show_name,  # noqa: E402
                    unprefixed, write_json)

SCHEMA = "alef-offline-llm/1"


# ---------------------------------------------------------------- checks shared by item types

def two_judges(row: dict, qualified: set[str]) -> str | None:
    """Two different judge models, neither of them the generator, both qualified on the known-answer set, both saying yes."""
    judges = [j for j in row.get("judges") or [] if j.get("key") in qualified]
    gen = (row.get("generator") or {}).get("id")
    ids = {j.get("id") for j in judges if j.get("id")}
    if len(ids) < 2:
        return f"judges: {len(ids)} qualified judge(s) answered; two are needed"
    if gen in ids:
        return "judges: the generator judged its own item"
    bad = [j for j in judges if j.get("ok") is not True]
    if bad:
        return "judges: " + "; ".join(f"{j.get('key')}: {j.get('reason') or 'said no'}" for j in bad)[:300]
    return None


def model_check(row: dict, name: str) -> str | None:
    c = (row.get("checks") or {}).get(name)
    if not c:
        return f"{name}: not run"
    if c.get("ok") is not True:
        return f"{name}: {c.get('detail') or 'failed'}"[:300]
    return None


def name_and_wording(*, hebrew: list[str], english: list[str]) -> list[str]:
    out = []
    if any(name_spelled(h) for h in hebrew):
        out.append("name: the Name is spelled out; it may appear only as " + NAME_SHOWN)
    for e in english:
        hits = ai_wording(e)
        if hits:
            out.append("wording: not allowed in learner-facing text: " + ", ".join(sorted(set(h.lower() for h in hits))))
            break
    return out


def level_ok(row: dict, allowed: set[str]) -> str | None:
    """Every word of the sentence is at or below the unit's level: known as written, behind a prefix, or by its lemma."""
    lemmas = ((row.get("checks") or {}).get("morph") or {}).get("lemmas") or {}
    unknown = []
    for w in he_key(row["he"]).split():
        forms = set(unprefixed(w))
        lem = lemmas.get(w)
        if lem:
            forms.add(he_key(lem))
        if not forms & allowed:
            unknown.append(w)
    return ("level: above the unit's level: " + " ".join(unknown)) if unknown else None


# ---------------------------------------------------------------- per-type gates (each returns the list of failures)

def check_example(row: dict, app: App, seen: set[str], qualified: set[str]) -> list[str]:
    fails = []
    for f in (two_judges(row, qualified), model_check(row, "morph"), model_check(row, "offensive"), model_check(row, "roundtrip"),
              level_ok(row, app.allowed_words(row["level"]))):
        if f:
            fails.append(f)
    fails += name_and_wording(hebrew=[row["he"]], english=[row["en"]])
    k = he_key(row["he"])
    if k in app.existing_sentences():
        fails.append("duplicate: the app already teaches this sentence")
    elif k in seen:
        fails.append("duplicate: same sentence as an earlier candidate")
    seen.add(k)
    return fails


def check_quiz(row: dict, shipped_examples: set[str], app: App, qualified: set[str]) -> list[str]:
    fails = []
    choices = row.get("choices") or []
    keys = [he_key(c) for c in choices]
    if len(choices) < 3 or len(set(keys)) != len(keys):
        fails.append("choices: need at least three different choices")
    if not isinstance(row.get("answer"), int) or not 0 <= row["answer"] < len(choices):
        fails.append("answer: the keyed answer is not one of the choices")
    if row.get("stem", "").count("___") != 1:
        fails.append("stem: exactly one blank is required")
    judges = [j for j in row.get("judges") or [] if j.get("key") in qualified]
    if len({j.get("id") for j in judges if j.get("id")}) < 2:
        fails.append("judges: fewer than two qualified judges answered")
    for j in judges:
        if j.get("answer") != row.get("answer") or j.get("unique") is not True:
            fails.append(f"judges: {j.get('key')} picked {j.get('answer')} (unique: {j.get('unique')})")
    fails += name_and_wording(hebrew=[row.get("stem", "")] + choices, english=[row.get("en", "")])
    if row.get("source") == "example":
        if row.get("exampleId") not in shipped_examples:
            fails.append("source: its example sentence did not pass the gate")
    elif row.get("source") == "line":
        # A line of Torah or prayer: putting the answer back in the blank must give the app's own text, letter for letter.
        src = next((e for e in app.json("data/corpus/registry.json")["entries"] if e["id"] == row.get("lineId")), None)
        ti = row.get("wordIndex")
        if not src:
            fails.append("source: the line is not in the app's registry")
        else:
            tokens = show_name(src["he"]).split(" ")
            if not isinstance(ti, int) or not 0 <= ti < len(tokens):
                fails.append("source: no word position")
            else:
                word = tokens[ti]
                end = "\u05C3" if word.endswith("\u05C3") else ""
                if " ".join("___" + end if i == ti else t for i, t in enumerate(tokens)) != row.get("stem"):
                    fails.append("source: the stem is not the app's text with one word blanked")
                ans = choices[row["answer"]] if isinstance(row.get("answer"), int) and 0 <= row["answer"] < len(choices) else ""
                if he_key(ans) != he_key(word) or NAME_SHOWN in word:
                    fails.append("source: the keyed answer is not the blanked word")
        f = model_check(row, "cloze")
        if f:
            fails.append(f)
    else:
        fails.append("source: unknown")
    return fails


def check_ask(row: dict, app: App, qualified: set[str]) -> list[str]:
    """Quote-and-cite: at least one citation to a verse the app has, the passage equal to the app's text, and the quote
    an exact part of it. The string tests use the app's display form of the text (the Name as he-geresh)."""
    fails = []
    ans = row.get("answer") or {}
    passages = ans.get("passages") or []
    if not passages:
        fails.append("cite: no citation")
    for p in passages:
        v = app.verse(p.get("id", ""))
        if not v:
            fails.append(f"cite: {p.get('ref')} is not a source in the app")
            continue
        if p.get("ref") != v["ref"]:
            fails.append(f"cite: reference text {p.get('ref')!r} does not match {v['ref']!r}")
        if p.get("he") != show_name(v["he"]) or p.get("en") != v["en"]:
            fails.append(f"quote: the passage for {v['ref']} is not the app's text")
        q = p.get("quote") or ""
        if not q.strip():
            fails.append(f"quote: no quoted words for {v['ref']}")
        elif q not in show_name(v["he"]):
            fails.append(f"quote: the quoted words are not an exact part of {v['ref']}")
    texts_en = [ans.get("verdict_text", ""), ans.get("explanation", ""), row.get("question", "")]
    texts_he = [p.get("he", "") for p in passages] + [p.get("quote", "") for p in passages] + [row.get("question_he") or ""]
    fails += name_and_wording(hebrew=texts_he + texts_en, english=texts_en)
    if ans.get("ruling"):
        if not ans.get("explanation", "").startswith("Sources say") or "ask your rabbi" not in ans.get("explanation", ""):
            fails.append('ruling: must be phrased "Sources say…" and end with "ask your rabbi"')
    f = two_judges(row, qualified)
    if f:
        fails.append(f)
    return fails


def check_wording(row: dict, answer_ids: set[str], qualified: set[str]) -> list[str]:
    fails = []
    if row.get("answerId") not in answer_ids:
        fails.append("cite: points at an answer that is not in the app's checked bank")
    for f in (two_judges(row, qualified), model_check(row, "offensive")):
        if f:
            fails.append(f)
    fails += name_and_wording(hebrew=[row.get("he", "")], english=[])
    return fails


# ---------------------------------------------------------------- run

def run(app_root, work: Path, out: Path, version: int) -> dict:
    app = App(app_root)
    dist, review = out / "src", out / "review"  # src/ holds the data files; the repo's build-dist copies src/ to dist/
    # Judges are scored on known-answer sentences before they judge (scripts/judge.py --canaries). Only a judge that
    # qualified there counts; with no record, no judge counts.
    quals = read_json(work / "judges.json") if (work / "judges.json").exists() else {}
    qualified = {k for k, v in quals.items() if v.get("qualified")}
    report = {"schema": SCHEMA, "version": version, "judges": quals, "counts": {}}

    def split(rows, check):
        ok, bad = [], []
        for r in rows:
            fails = check(r)
            (bad if fails else ok).append({**r, "gate": {"passed": not fails, "fails": fails}})
        return ok, bad

    def tally(name, ok, bad, generated=None):
        reasons: dict[str, int] = {}
        for r in bad:
            for f in r["gate"]["fails"]:
                k = f.split(":")[0]
                reasons[k] = reasons.get(k, 0) + 1
        report["counts"][name] = {"generated": generated if generated is not None else len(ok) + len(bad), "passed_gate": len(ok),
                                  "sent_to_review": len(bad), "review_reasons": dict(sorted(reasons.items()))}

    # examples
    seen: set[str] = set()
    ex_ok, ex_bad = split(read_jsonl(work / "examples.jsonl"), lambda r: check_example(r, app, seen, qualified))
    by_unit: dict[str, list] = {}
    for r in ex_ok:
        by_unit.setdefault(r["unit"], []).append(r)
    for unit, rows in by_unit.items():
        write_json(dist / "examples" / f"{unit}.json", {"schema": SCHEMA, "kind": "examples", "version": version, "unit": unit, "level": rows[0]["level"], "items": [
            {"id": r["id"], "itemId": r["target"]["itemId"], "he": r["he"], "en": r["en"], "needsPointing": True, "checked": True} for r in rows]}, compact=True)
    write_json(review / "examples.json", {"schema": SCHEMA, "kind": "review", "what": "example sentences that did not pass the gate", "items": ex_bad})
    stats = read_json(work / "examples.stats.json") if (work / "examples.stats.json").exists() else None
    tally("examples", ex_ok, ex_bad, generated=stats["drafts"] if stats else None)
    if stats:
        report["counts"]["examples"]["dropped_before_judging"] = stats["dropped"]  # not Hebrew, wrong length, or the word is missing

    # quiz
    shipped = {r["id"] for r in ex_ok}
    qz_ok, qz_bad = split(read_jsonl(work / "quiz.jsonl"), lambda r: check_quiz(r, shipped, app, qualified))
    by_unit = {}
    for r in qz_ok:
        by_unit.setdefault(r["unit"], []).append(r)
    for unit, rows in by_unit.items():
        write_json(dist / "quiz" / f"{unit}.json", {"schema": SCHEMA, "kind": "quiz", "version": version, "unit": unit, "items": [
            {k: r[k] for k in ("id", "stem", "choices", "answer", "en", "source", "exampleId", "lineId", "ref") if r.get(k) is not None} | {"checked": True} for r in rows]}, compact=True)
    write_json(review / "quiz.json", {"schema": SCHEMA, "kind": "review", "what": "quiz items that did not pass the gate", "items": qz_bad})
    tally("quiz", qz_ok, qz_bad)

    # ask: new answers, and Hebrew wordings of checked questions
    bank_ids = {a for _, a in app.json("data/ask/bank.json")["questions"]}
    an_ok, an_bad = split(read_jsonl(work / "ask.jsonl"), lambda r: check_ask(r, app, qualified))
    aw_ok, aw_bad = split(read_jsonl(work / "ask-wordings.jsonl"), lambda r: check_wording(r, bank_ids, qualified))
    answers = {r["id"]: {**{k: v for k, v in r["answer"].items() if k != "ruling"}, "checked": True} for r in an_ok}
    questions = [[r["question"], r["id"]] for r in an_ok] + [[r["question_he"], r["id"]] for r in an_ok if r.get("question_he")]
    write_json(dist / "ask" / f"answers.v{version}.json", {"schema": SCHEMA, "kind": "ask", "version": version, "answers": answers, "questions": questions,
                                                           "wordings": [[r["he"], r["answerId"]] for r in aw_ok]}, compact=True)
    write_json(review / "ask.json", {"schema": SCHEMA, "kind": "review", "what": "Ask the Torah drafts that did not pass the gate", "items": an_bad + aw_bad})
    tally("ask_answers", an_ok, an_bad)
    tally("ask_hebrew_wordings", aw_ok, aw_bad)

    extra = work / "report-extra.json"
    if extra.exists():
        report.update(read_json(extra))
    write_json(dist / "report.json", report)
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app", required=True)
    ap.add_argument("--work", default="work")
    ap.add_argument("--out", default=str(PKG))
    ap.add_argument("--version", type=int, default=1)
    a = ap.parse_args()
    rep = run(a.app, Path(a.work), Path(a.out), a.version)
    for k, v in rep["counts"].items():
        print(f"{k}: generated {v['generated']} / passed gate {v['passed_gate']} / sent to review {v['sent_to_review']}  {v['review_reasons']}")
