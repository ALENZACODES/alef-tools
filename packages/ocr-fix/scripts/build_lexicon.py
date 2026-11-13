#!/usr/bin/env python3
"""Build the word list the photo text tidy-up uses, from the app's own data. Nothing is downloaded.

  python scripts/build_lexicon.py --app ../Al-Heb --out ../Al-Heb/assets/vendor/_alef-tools/ocr-lexicon.json

Sources, all inside the app checkout:
  data/vocab/index.json            the dictionary (unpointed spelling column)
  data/vocab/frequency.json        how common each dictionary word is in the app's own texts (sets the order)
  data/camera/sign-glossary.json   the sign word list
  data/corpus/phrasebook.json      the phrasebook
Words are stored unpointed, most common first, one per line. The four-letter Name is never put in the list.
--exclude FILE drops the words of the given text file (one phrase per line); the benchmark uses it to measure how the
tidy-up does on words it has never seen.
"""

import argparse
import hashlib
import json
import re
import unicodedata
from pathlib import Path

MARKS = re.compile("[֑-ׇ]")
WORD = re.compile("[א-ת]+")
MAX_BYTES = 1024 * 1024
NAME = "יהוה"


def words_of(text):
    return WORD.findall(MARKS.sub("", unicodedata.normalize("NFKD", str(text or "")).replace("־", " ")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--app", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--exclude")
    a = ap.parse_args()
    app = Path(a.app)
    score = {}

    def add(w, weight):
        if len(w) < 2 or w == NAME or w.endswith(NAME):
            return
        score[w] = score.get(w, 0) + weight

    sources = []
    idx = json.loads((app / "data/vocab/index.json").read_text())
    fields = idx["fields"]
    hi, ii = (fields.index("he") if "he" in fields else 1), fields.index("id")
    plain_col = next((i for i, f in enumerate(fields) if f in ("heUnpointed", "plain", "hePlain", "unpointed")), 2)
    freq = {}
    fp = app / "data/vocab/frequency.json"
    if fp.exists():
        for e in json.loads(fp.read_text())["entries"]:
            freq[e["id"]] = e.get("total", 0)
        sources.append("data/vocab/frequency.json")
    for row in idx["rows"]:
        for w in words_of(row[plain_col] or row[hi]):
            add(w, 1 + freq.get(row[ii], 0))
    sources.append("data/vocab/index.json")
    gp = app / "data/camera/sign-glossary.json"
    if gp.exists():
        g = json.loads(gp.read_text())
        for e in g.get("entries", []):
            for w in words_of(e.get("he")):
                add(w, 50)
        for p in g.get("patterns", []):
            for w in words_of(p.get("head")):
                add(w, 50)
        for v in g.get("variants", []):
            for w in words_of(v.get("he")):
                add(w, 20)
        sources.append("data/camera/sign-glossary.json")
    pp = app / "data/corpus/phrasebook.json"
    if pp.exists():
        pb = json.loads(pp.read_text())
        entries = pb.get("entries") or pb.get("phrases") or (pb if isinstance(pb, list) else [])
        for e in entries:
            for w in words_of(e.get("he") or e.get("hebrew") or e.get("pointed")):
                add(w, 30)
        sources.append("data/corpus/phrasebook.json")
    dropped = 0
    if a.exclude:
        for line in Path(a.exclude).read_text().splitlines():
            for w in words_of(line):
                if score.pop(w, None) is not None:
                    dropped += 1
    ordered = sorted(score, key=lambda w: (-score[w], w))
    body = "\n".join(ordered)
    out = {
        "schema": "alef.ocr-lexicon.v1",
        "count": len(ordered),
        "sources": sources,
        "excludedWords": dropped,
        "wordsSha256": hashlib.sha256(body.encode()).hexdigest(),
        "words": body,
    }
    data = (json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    if len(data) > MAX_BYTES:
        raise SystemExit(f"word list is {len(data)} bytes, over the 1 MiB budget")
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_bytes(data)
    print(json.dumps({"words": len(ordered), "bytes": len(data), "excluded": dropped}))


if __name__ == "__main__":
    main()
