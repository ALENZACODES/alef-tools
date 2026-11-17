#!/usr/bin/env python3
"""Build the search entries and their vectors. Build time only.

    python scripts/embed.py --app ../Al-Heb --dist src --out work/search.docs.json [--no-model]

Entries: every checked Ask the Torah answer that has a topical question, every lesson, every practical unit, and the
dictionary's most common words. For each entry this writes
  title, text    what the entry is found by (its own questions, goals, words and glosses, in both languages)
  wordings       Hebrew wordings of its question that passed the gate (src/ask/answers.v<N>.json)
  extra          words in the other language, kept only when the embedding model puts the word close to the entry:
                 dictionary translations of the entry's words, and for a checked answer the Hebrew words of the verses
                 it cites (the app's own text proposes, the vectors decide)
and one int8 vector per entry (the embedding model's 768 numbers reduced to --dims by PCA), which the on-device search
uses to pull up entries close to its best word matches. scripts/build_search.mjs turns the result into the index.
--no-model writes the entries without vectors or extra terms (words-only search; used by the tests).
"""
from __future__ import annotations

import argparse
import base64
import datetime
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import App, has_hebrew, he_key, read_json, show_name, strip_points, write_json  # noqa: E402

TEMPLATED = re.compile(r"^(What does (Genesis|Exodus|Leviticus|Numbers|Deuteronomy) \d+:\d+ say\?|Quote .* in Hebrew and English\.|"
                       r"(Where in the Torah does the word|What does the Hebrew word) .*|.*[“”].*)$")
WORD = re.compile(r"[a-z]+")
EN_STOP = set("a an the of in on at to for from by with about and or but is are was were be been do does did have has had it its this that these those "
              "what which who whom where when why how can could should would will i me my we us our you your he him his she her they them their not no "
              "torah say says said tell find verses verse about there one someone something thing make made get go come".split())


def ask_entries(app: App, dist: Path) -> list[dict]:
    bank = app.json("data/ask/bank.json")
    topics = app.json("data/ask/topics.json")["topics"]
    by_answer: dict[str, list[str]] = {}
    for q, a in bank["questions"]:
        if not TEMPLATED.match(q):
            by_answer.setdefault(a, []).append(q)
    terms = {}
    for t in topics:
        terms.setdefault(t["a"], []).extend(t.get("terms") or [])
    wordings: dict[str, list[str]] = {}
    extra_answers = []
    for f in sorted((dist / "ask").glob("answers.v*.json")) if (dist / "ask").exists() else []:
        data = read_json(f)
        for he, a in data.get("wordings", []):
            wordings.setdefault(a, []).append(he)
        qs: dict[str, list[str]] = {}
        for q, a in data.get("questions", []):
            qs.setdefault(a, []).append(q)
        extra_answers += list(qs.items())
    out = []
    shards = bank.get("shards", 32)

    def cited_hebrew(answer_id: str) -> list[str]:
        """The Hebrew words of the verses a checked answer cites (the app's own text), most telling first: long words before short."""
        try:
            ans = app.json(f"data/ask/answers/{int(answer_id, 16) % shards:02d}.json").get(answer_id) or {}
        except (ValueError, FileNotFoundError):
            return []
        words: dict[str, None] = {}
        for p in (ans.get("passages") or [])[:3]:
            for w in strip_points(show_name(p.get("he", ""))).replace("\u05C3", " ").split():
                w = w.strip("\u05F3'\",.;:!?()[]")
                if len(w) >= 3 and "\u05F3" not in w:
                    words[w] = None
        return list(words)[:50]

    for a, qs in by_answer.items():
        clean = [q for q in qs if q.endswith("?") and not re.search(r"in the torah in the|\\bis is\\b|about what|about is |about where", q.lower())]
        title = min(clean, key=len) if clean else qs[0]
        out.append({"type": "ask", "id": a, "title": title, "arg": title, "text": " | ".join(dict.fromkeys(qs + terms.get(a, []))), "wordings": wordings.get(a, []),
                    "cited": cited_hebrew(a)})
    for a, qs in extra_answers:
        out.append({"type": "ask", "id": a, "title": qs[0], "arg": qs[0], "text": " | ".join(qs), "wordings": []})
    return out


def lesson_entries(app: App) -> list[dict]:
    out = []
    for les in app.json("data/curriculum/lessons.json")["lessons"]:
        words = " | ".join(f"{strip_points(w.get('he', ''))} {w.get('en', '')}" for w in les.get("words", []))
        out.append({"type": "lesson", "id": les["id"], "title": les["title"], "text": " | ".join(les.get("goals", [])) + " | " + words, "wordings": []})
    return out


def unit_entries(app: App) -> list[dict]:
    out = []
    for u in app.units():
        unit = app.unit(u["id"])
        items = " | ".join(f"{strip_points(it.get('he', ''))} {it.get('en', '')}" for it in unit.get("items", []))
        out.append({"type": "unit", "id": u["id"], "title": unit["title"], "lessons": [x["id"] for x in unit.get("lessons", [])], "text": " | ".join(x["title"] for x in unit.get("lessons", [])) + " | " + items, "wordings": []})
    return out


def word_entries(app: App, max_tier: int) -> list[dict]:
    out, seen = [], set()
    for tier in (500, 1000, 2000, 5000):
        if tier > max_tier:
            break
        for e in app.vocab_tier(tier):
            flags = e.get("flags")
            if (isinstance(flags, list) and "hidden" in flags) or (isinstance(flags, dict) and flags.get("hidden")):
                continue
            lemma = e.get("lemma", "")
            if not lemma or lemma in seen:
                continue
            seen.add(lemma)
            gloss = re.sub(r"\([^)]*\)", " ", e.get("gloss", "")).strip() or e.get("gloss", "")
            senses = [p.strip() for p in re.split(r"[;,/]", gloss.lower())]
            exact = [lemma] + [p.removeprefix("to ").removeprefix("a ").removeprefix("the ") for p in senses if len(p.removeprefix("to ").removeprefix("a ").removeprefix("the ").split()) == 1]
            out.append({"type": "word", "id": e["id"], "title": f"{e.get('pointed') or lemma}: {e.get('gloss', '')}"[:80], "arg": lemma, "text": f"{lemma} {gloss}", "exact": exact, "wordings": []})
    return out


def gloss_table(app: App) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """English head word -> Hebrew lemmas, and Hebrew lemma -> English head words, from short dictionary glosses."""
    en_he: dict[str, list[str]] = {}
    he_en: dict[str, list[str]] = {}
    for tier in (500, 1000, 2000, 5000):
        for e in app.vocab_tier(tier):
            lemma = e.get("lemma", "")
            if not lemma or " " in lemma:
                continue
            for part in re.split(r"[;,/]", re.sub(r"\([^)]*\)", " ", e.get("gloss", "").lower()))[:3]:
                ws = [w for w in WORD.findall(part) if w not in EN_STOP and w != "to"]
                if len(ws) == 1 and len(ws[0]) > 2:
                    en_he.setdefault(ws[0], []).append(lemma)
                    he_en.setdefault(lemma, []).append(ws[0])
    return en_he, he_en


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app", required=True)
    ap.add_argument("--dist", default="src", help="folder holding ask/answers.v<N>.json from the gate")
    ap.add_argument("--out", default="work/search.docs.json")
    ap.add_argument("--dims", type=int, default=32)
    ap.add_argument("--max-tier", type=int, default=2000)
    ap.add_argument("--min-sim", type=float, default=0.30, help="a proposed cross-language word is kept at or above this cosine to its entry")
    ap.add_argument("--min-word-sim", type=float, default=0.45, help="or at or above this cosine to one of the entry's English key words")
    ap.add_argument("--max-extra", type=int, default=10, help="at most this many attached words per entry")
    ap.add_argument("--no-model", action="store_true")
    a = ap.parse_args()

    app = App(a.app)
    docs = ask_entries(app, Path(a.dist)) + lesson_entries(app) + unit_entries(app) + word_entries(app, a.max_tier)
    out = {"built": datetime.date.today().isoformat(), "docs": docs, "dims": 0}
    if a.no_model:
        for d in docs:
            d.pop("cited", None)
    else:
        import numpy as np
        from models_bert import Embedder

        emb = Embedder()
        texts = [(d["title"] + " | " + d["text"])[:600] for d in docs]
        mat = emb.encode(texts, batch=16, progress=True)
        en_he, he_en = gloss_table(app)
        cand: list[list[str]] = []
        for d in docs:
            full = d["title"] + " " + d["text"]
            words = {w for w in WORD.findall(full.lower()) if w not in EN_STOP}
            he = set(he_key(full).split())
            c = [lem for w in words for lem in en_he.get(w, []) if he_key(lem) not in he]
            if d["type"] != "word":
                c += [e for lem in he for e in he_en.get(lem, []) if e not in words]
            # for a checked answer: the Hebrew words of the verses it cites (names and key terms the dictionary does not have)
            cand.append(list(dict.fromkeys(c))[:60] + [w for w in d.pop("cited", []) if he_key(w) not in he])
        vocab = sorted({t for c in cand for t in c})
        tvec = dict(zip(vocab, emb.encode(vocab, batch=64, progress=True))) if vocab else {}
        # English key words of each entry, for the word-to-word test below
        keys = [[w for w in dict.fromkeys(WORD.findall((d["title"] + " " + d["text"]).lower())) if w not in EN_STOP and len(w) > 2][:40] for d in docs]
        kvocab = sorted({w for k in keys for w in k})
        kvec = dict(zip(kvocab, emb.encode(kvocab, batch=64, progress=True))) if kvocab else {}
        kept = 0
        for d, c, v, k in zip(docs, cand, mat, keys):
            kmat = np.stack([kvec[w] for w in k]) if k else None
            scored = []
            for t in c:
                near_entry = float(tvec[t] @ v)
                # a Hebrew word is also kept when it sits close to one of the entry's English key words (a name, a festival, a term)
                near_word = float((kmat @ tvec[t]).max()) if kmat is not None and has_hebrew(t) else 0.0
                if near_entry >= a.min_sim or near_word >= a.min_word_sim:
                    scored.append((t, max(near_entry, near_word)))
            scored.sort(key=lambda x: -x[1])
            d["extra"] = [[t, round(sc, 3)] for t, sc in scored][: a.max_extra]
            kept += len(d["extra"])
        # PCA to --dims, then int8.
        centred = mat - mat.mean(axis=0)
        _, _, vt = np.linalg.svd(centred, full_matrices=False)
        proj = centred @ vt[: a.dims].T
        proj /= np.linalg.norm(proj, axis=1, keepdims=True) + 1e-9
        q = np.clip(np.round(proj * 127), -127, 127).astype(np.int8)
        out.update(dims=a.dims, model=emb.tag, vectors_b64=base64.b64encode(q.tobytes()).decode("ascii"))
        np.save(Path(a.out).with_suffix(".pca.npy"), np.vstack([mat.mean(axis=0, keepdims=True), vt[: a.dims]]).astype(np.float32))
        print(f"embed: {len(docs)} entries, {len(vocab)} proposed cross-language words, {kept} kept at cosine >= {a.min_sim}")
    write_json(a.out, out, compact=True)
    counts: dict[str, int] = {}
    for d in docs:
        counts[d["type"]] = counts.get(d["type"], 0) + 1
    print("embed entries:", counts)


if __name__ == "__main__":
    main()
