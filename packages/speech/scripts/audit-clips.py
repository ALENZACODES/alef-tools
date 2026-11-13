#!/usr/bin/env python3
"""Offline check of the app's shipped Hebrew audio: does each clip say what its text says?

Every clip listed in the app's audio catalogue (Al-Heb data/audio/manifest.json) is written down by a large Hebrew
speech-to-text model (ivrit-ai/whisper-large-v3-ct2, at the revision pinned in models.manifest.json, run on this machine
with faster-whisper) and compared with the clip's own text. The report lists the clips that do not match and any clip
where the divine Name may have been read out as written. It changes no file in the app: a person decides what to redo.

  python scripts/audit-clips.py scan --app <Al-Heb checkout> --out <dir> [--shard 0 --of 20] [--limit N] [--traditions israeli]
      Writes <dir>/clip-audit.<shard>.jsonl, one line per clip. Safe to stop and run again: clips already done are skipped.

  python scripts/audit-clips.py report --in <dir> --out review/clip-audit.json
      Joins the shards into the report.

The whole catalogue is tens of thousands of clips, so it is meant to run in shards (see .github/workflows/clip-audit.yml).
"""
from __future__ import annotations

import argparse
import datetime
import importlib.util
import json
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("convert_common", HERE.parents[2] / "scripts" / "convert-common.py")
cc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cc)

MODEL = "ivrit-ai/whisper-large-v3-ct2"
POINTS = re.compile(r"[֑-ׇ]")
NAME = "יהוה"
PREFIXES = "ובלמכשה"
# How the four letters come out of a speech-to-text model when they are read as written rather than replaced.
NAME_AS_WRITTEN = re.compile(r"^[ובלמכשה]{0,2}(יהוה|יהווה|יאהוה|יהוואה|יהובה|יהוב|ייהוה|יהווא|יהואה|ג׳הובה|גהובה)$")
FINALS = str.maketrans("ךםןףץ", "כמנפצ")
# A mismatch is reported above these character error rates. Sephardi and Ashkenazi clips are read from a respelling by an
# Israeli-trained voice, and the model was trained on Israeli speech, so they get more room.
LIMIT = {"israeli": 0.34, "sephardi": 0.5, "ashkenazi": 0.6}


def letters(text: str) -> str:
    """Hebrew letters and single spaces only (points, punctuation and final forms folded away)."""
    t = unicodedata.normalize("NFC", text or "")
    t = POINTS.sub("", t.replace("\u05be", " "))  # the maqaf first: it sits inside the range of the points
    t = re.sub(r"[^א-ת ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip().translate(FINALS)


def is_name(word: str) -> bool:
    w = POINTS.sub("", word)
    return w == NAME or w == "יי" or bool(re.match(rf"^[{PREFIXES}]{{1,3}}{NAME}$", w))


def spoken_target(text: str) -> tuple[str, bool]:
    """The letters a correct reading gives: the Name is said as Adonai. Returns (letters, text has the Name)."""
    out, has = [], False
    for word in re.split(r"[\s־]+", unicodedata.normalize("NFC", text or "")):
        bare = re.sub(r"[^א-ת֑-ׇ]", "", word)
        if bare and is_name(bare):
            has = True
            out.append("אדני")
        else:
            out.append(word)
    return letters(" ".join(out)), has


def edit_distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def judge(entry: dict, heard: str) -> dict:
    target, has_name = spoken_target(entry.get("text", ""))
    got = letters(heard)
    # vav and yod are written or left out freely in unpointed spelling: compare without them as well, keep the kinder result
    bare = lambda s: re.sub(r"[וי]", "", s)  # noqa: E731
    cer = min(edit_distance(target, got) / max(1, len(target)), edit_distance(bare(target), bare(got)) / max(1, len(bare(target))))
    name_as_written = any(NAME_AS_WRITTEN.match(w) for w in got.split())
    limit = LIMIT.get(entry.get("tradition", "israeli"), 0.5)
    return {"path": entry["path"], "tradition": entry.get("tradition"), "kind": entry.get("kind"), "text": entry.get("text"), "heard": heard,
            "cer": round(cer, 3), "match": cer <= limit, "hasName": has_name, "nameAsWritten": name_as_written}


def scan(args):
    app = Path(args.app)
    catalogue = json.loads((app / "data" / "audio" / "manifest.json").read_text(encoding="utf-8"))
    want = set(args.traditions.split(",")) if args.traditions else None
    clips = [c for c in catalogue if c.get("text") and (app / c["path"]).is_file() and c.get("tradition") != "english" and (not want or c.get("tradition") in want)]
    clips.sort(key=lambda c: c["path"])
    clips = [c for i, c in enumerate(clips) if i % args.of == args.shard]
    if args.limit:
        clips = clips[: args.limit]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    log = out / f"clip-audit.{args.shard}.jsonl"
    done = {json.loads(line)["path"] for line in log.read_text(encoding="utf-8").splitlines()} if log.exists() else set()
    todo = [c for c in clips if c["path"] not in done]
    print(f"shard {args.shard} of {args.of}: {len(clips)} clips, {len(todo)} to do", file=sys.stderr)
    if not todo:
        return
    from faster_whisper import WhisperModel  # heavy import, only here

    model_id = args.model or MODEL
    revision = cc.manifest_entry(model_id)["hubRevision"]
    cc.require_free(4 * 1024 * cc.MIB)
    model = WhisperModel(model_id, revision=revision, device="cpu", compute_type="int8", cpu_threads=args.threads)
    with open(log, "a", encoding="utf-8") as w:
        for n, clip in enumerate(todo, 1):
            segments, _ = model.transcribe(str(app / clip["path"]), language="he", beam_size=5, condition_on_previous_text=False, vad_filter=False)
            heard = " ".join(s.text.strip() for s in segments).strip()
            w.write(json.dumps({**judge(clip, heard), "model": model_id, "revision": revision}, ensure_ascii=False) + "\n")
            w.flush()
            if n % 25 == 0:
                print(f"{n}/{len(todo)}", file=sys.stderr)


def report(args):
    rows = []
    for f in sorted(Path(getattr(args, "in")).glob("clip-audit.*.jsonl")):
        rows += [json.loads(line) for line in f.read_text(encoding="utf-8").splitlines() if line.strip()]
    rows.sort(key=lambda r: r["path"])
    mismatches = [r for r in rows if not r["match"]]
    name = [r for r in rows if r["nameAsWritten"] or (r["hasName"] and not r["match"])]
    out = {
        "schema": "alef.clip-audit.v1",
        "what": "Each shipped Hebrew clip written down by a speech-to-text model on a build machine and compared with its text. A list for a person to review; no file was changed.",
        "model": rows[0]["model"] if rows else MODEL, "revision": rows[0]["revision"] if rows else None,
        "made": datetime.date.today().isoformat(),
        "clips": len(rows), "matched": len(rows) - len(mismatches), "mismatched": len(mismatches),
        "byTradition": {t: {"clips": sum(r["tradition"] == t for r in rows), "mismatched": sum(r["tradition"] == t for r in mismatches)} for t in sorted({r["tradition"] or "" for r in rows})},
        "nameToReview": [{k: r[k] for k in ("path", "text", "heard", "nameAsWritten")} for r in name],
        "mismatches": [{k: r[k] for k in ("path", "tradition", "kind", "text", "heard", "cer")} for r in sorted(mismatches, key=lambda r: -r["cer"])],
    }
    dest = Path(args.out)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{dest}: {out['clips']} clips, {out['mismatched']} mismatched, {len(name)} to review for the Name")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("scan")
    a.add_argument("--app", required=True)
    a.add_argument("--out", required=True)
    a.add_argument("--shard", type=int, default=0)
    a.add_argument("--of", type=int, default=1)
    a.add_argument("--limit", type=int, default=0)
    a.add_argument("--traditions")
    a.add_argument("--model")
    a.add_argument("--threads", type=int, default=0)
    a.set_defaults(fn=scan)
    b = sub.add_parser("report")
    b.add_argument("--in", required=True)
    b.add_argument("--out", required=True)
    b.set_defaults(fn=report)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
