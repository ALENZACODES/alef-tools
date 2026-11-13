#!/usr/bin/env python3
"""Ask the Torah, offline: Hebrew wordings for checked questions, and draft answers for new questions.

Two jobs, both quote-and-cite:

  --hebrew-wordings   For each topic in the app's checked bank, ask the generator for Hebrew wordings of its question.
                      A wording only points at the answer that is already checked; no answer text is written.
  --new-answers FILE  For each new question in FILE (JSON list of {"q": ..., "he": ...}), find verses with the
                      embedding model, let the span model pick the exact words to quote, and assemble the answer from a
                      fixed template. No model writes the answer's wording.

Output is candidates (work/ask.*.jsonl) for scripts/judge.py and scripts/gate.py.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import App, has_hebrew, he_key, read_jsonl, show_name, stable_id, strip_points, write_jsonl  # noqa: E402

# A question that asks what one may or must do is a question about a ruling: the answer reports the source and says to ask.
RULING = re.compile(r"\b(can i|may i|am i allowed|is it (?:ok|okay|allowed|permitted|forbidden)|are we allowed|do i have to|must i|should i|"
                    r"is it a sin|allowed to|permitted to)\b|האם מותר|מותר ל|אסור ל|האם אסור|חייב ל|צריך ל", re.I)
ASK_RABBI = "For what to do in practice, ask your rabbi."


def is_ruling(question: str) -> bool:
    return bool(RULING.search(question or ""))


def assemble(question: str, hits: list[dict]) -> dict:
    """The answer object the app's Ask the Torah page already renders (verdict_text, explanation, passages).
    hits: [{'verse': {id, ref, he, en}, 'span': exact substring of verse['he']}]"""
    first = hits[0]["verse"]
    refs = ", ".join(h["verse"]["ref"] for h in hits)
    ruling = is_ruling(question)
    lead = "Sources say this is addressed in the Torah at " if ruling else "The Torah speaks about this at "
    explanation = f"{lead}{refs}. It says: {first['en']}"
    if ruling:
        explanation += " " + ASK_RABBI
    passages = []
    for h in hits:
        v = h["verse"]
        book, ch, vn = v["id"].split(".")
        passages.append({"ref": v["ref"], "he": show_name(v["he"]), "en": v["en"], "quote": show_name(h["span"]), "id": v["id"],
                         "href": f"#/torahreader?book={book}&chapter={ch}&verse={vn}", "link_kind": "alef", "link_label": "Read this passage in Aleph"})
    return {"verdict": "in_torah", "verdict_text": "Sources say the Torah addresses this." if ruling else "Yes. This is in the Torah.",
            "explanation": explanation, "passages": passages, "ruling": ruling}


def hebrew_wordings(a):
    from llm import Chat, fill, first_json, load_prompt

    app = App(a.app)
    bank = app.json("data/ask/bank.json")
    topics = app.json("data/ask/topics.json")["topics"]
    by_answer: dict[str, list[str]] = {}
    for q, ans in bank["questions"]:
        by_answer.setdefault(ans, []).append(q)
    prompt = load_prompt("ask_questions")
    chat = Chat(a.model)
    rows = read_jsonl(a.out)
    done = {r["answerId"] for r in rows}
    for t in topics[: a.limit or None]:
        if t["a"] in done:
            continue
        done.add(t["a"])
        qs = [q for q in by_answer.get(t["a"], []) if not has_hebrew(q) and q.endswith("?")]
        if not qs:
            continue
        source = min(qs, key=len)
        data = first_json(chat.ask(prompt["system"], fill(prompt["user"], question=source), max_tokens=160, temperature=0.4)) or {}
        seen = set()
        for he in data.get("he") or []:
            if not isinstance(he, str) or not has_hebrew(he) or any("a" <= c.lower() <= "z" for c in he):
                continue
            he = strip_points(he).strip()
            k = he_key(he)
            if k in seen or not 2 <= len(k.split()) <= 14:
                continue
            seen.add(k)
            rows.append({"id": "aw-" + stable_id(t["a"], k), "type": "ask-wording", "answerId": t["a"], "topic": t["id"], "source_question": source,
                         "he": he, "generator": chat.tag})
        write_jsonl(a.out, rows)
        print(t["id"], len(seen), flush=True)
    chat.close()


def new_answers(a):
    """Retrieve, quote, assemble. Uses the embedding model for retrieval and the span model for the quote."""
    import numpy as np
    from models_bert import Embedder, SpanFinder

    app = App(a.app)
    questions = app_json(a.new_answers)
    verses = list(app.verses())
    emb = Embedder()
    cache = Path(a.verse_cache)
    if cache.exists():
        vmat = np.load(cache)
    else:
        vmat = emb.encode([v["en"] for v in verses], batch=32, progress=True)
        cache.parent.mkdir(parents=True, exist_ok=True)
        np.save(cache, vmat)
    qmat = emb.encode([q["q"] for q in questions])
    emb.close()
    spans = SpanFinder()
    rows = []
    for q, qv in zip(questions, qmat):
        sims = vmat @ qv
        top = np.argsort(-sims)[: a.k]
        hits = []
        for i in top:
            v = verses[int(i)]
            he_q = q.get("he") or q["q"]
            span, score = spans.find(he_q, strip_points(v["he"]))
            exact = locate(span, v["he"])
            if exact:
                hits.append({"verse": v, "span": exact, "span_score": round(float(score), 4), "sim": round(float(sims[int(i)]), 4)})
        if not hits:
            continue
        hits.sort(key=lambda h: -(h["sim"] + 0.2 * h["span_score"]))
        hits = hits[:1]
        rows.append({"id": "an-" + stable_id(q["q"]), "type": "ask", "question": q["q"], "question_he": q.get("he"), "hits": [
            {"verse_id": h["verse"]["id"], "span": h["span"], "span_score": h["span_score"], "sim": h["sim"]} for h in hits],
            "answer": assemble(q["q"], hits), "retriever": emb.tag, "span_model": spans.tag})
    write_jsonl(a.out, rows)
    print("gen_ask new answers:", len(rows), "of", len(questions), "questions got a quotable verse")


def locate(span_unpointed: str, verse_pointed: str) -> str | None:
    """Map a span found in the unpointed verse back to the exact pointed words of the verse (whole words only)."""
    want = he_key(span_unpointed).split()
    if not want:
        return None
    words = verse_pointed.replace("־", "־ ").split()
    keys = [he_key(w) for w in words]
    for i in range(len(words) - len(want) + 1):
        if keys[i:i + len(want)] == want:
            out = " ".join(words[i:i + len(want)]).replace("־ ", "־")
            return out if out in verse_pointed else None
    return None


def app_json(path):
    from common import read_json
    return read_json(path)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app", required=True)
    ap.add_argument("--hebrew-wordings", action="store_true")
    ap.add_argument("--new-answers")
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="gen-1.7b")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--verse-cache", default="work/verse-vectors.npy")
    args = ap.parse_args()
    if args.hebrew_wordings:
        hebrew_wordings(args)
    elif args.new_answers:
        new_answers(args)
    else:
        ap.error("choose --hebrew-wordings or --new-answers FILE")
