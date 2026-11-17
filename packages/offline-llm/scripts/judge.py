#!/usr/bin/env python3
"""Run the model checks over a candidates file. Build time only. One model is in memory at a time.

    python scripts/judge.py --in work/examples.jsonl --type example \
        --stages morph roundtrip judge:judge-1.7b-thinking judge:judge-dictalm2 offensive --stop-early

Stages (each writes its result into the row and saves, so a run can be stopped and resumed):
  judge:<model key>   one LLM judge; the gate needs two different ones, neither being the item's generator
  morph               gender and number agreement, and lemmas for the level check (Lane 4's model, or its output via --morph-json)
  roundtrip           Hebrew -> English with Lane 1's model, compared with the item's English
  offensive           the offensive-language screen on the Hebrew string
--stop-early skips an item in later stages once a stage has failed it (it is going to review anyway).
--canaries FILE scores each judge on known good and known bad sentences first (work/judges.json). A judge that does not
qualify there is not used: the gate ignores its verdicts, so the items are not sent to it unless --run-unqualified.
"""
from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import he_key, read_json, read_jsonl, strip_points, write_json, write_jsonl  # noqa: E402

STOP_EN = set("a an the of in on at to for from by with and or but is are was were be been am do does did have has had it its this that these those "
              "i me my we us our you your he him his she her they them their please there here not no yes very so some any will would can could "
              "what which who how when where why".split())


def failed(row: dict) -> bool:
    return any(j.get("ok") is False for j in row.get("judges") or []) or any(c.get("ok") is False for c in (row.get("checks") or {}).values())


def content_words(text: str) -> set[str]:
    out = set()
    for w in re.findall(r"[a-z]+", text.lower().replace("'s", "")):
        if w in STOP_EN or len(w) < 2:
            continue
        for suf in ("ing", "ed", "es", "s"):
            if len(w) > len(suf) + 2 and w.endswith(suf):
                w = w[: -len(suf)]
                break
        out.add(w)
    return out


def overlap(a: str, b: str) -> float:
    """Share of content words two English sentences have in common (F1). 1.0 when both have none."""
    x, y = content_words(a), content_words(b)
    if not x and not y:
        return 1.0
    hit = len(x & y)
    if not hit:
        return 0.0
    p, r = hit / len(y), hit / len(x)
    return 2 * p * r / (p + r)


# ---------------------------------------------------------------- agreement from morphological analysis

def _feat(tok: dict | None, name: str):
    v = (((tok or {}).get("morph") or {}).get("feats") or {}).get(name)
    return v if v and "," not in v else None


def agreement(analysis: dict, alone: dict | None = None) -> tuple[bool, str, dict]:
    """Gender and number agreement in one analysed sentence (dictabert-joint JSON). Returns (ok, detail, lemmas).

    Pairs checked: an adjective with the noun it modifies, and a verb with its subject noun.
    Two readings of each word are used. "In the sentence" is the model's analysis in context. "Alone" (when given: the
    same model run on the single word) matters because in context the model tends to read a wrong form as if it agreed
    ("the girl" + masculine "went" is tagged feminine). Alone readings are trusted only where the written form settles
    the question: number, and the gender of a third-person past verb.
    First- and second-person pronouns carry no gender, so they are never compared.
    """
    toks = analysis.get("tokens") or []
    alone = alone or {}
    lemmas = {he_key(t.get("token", "")): t.get("lex") for t in toks if t.get("lex")}
    problems = []
    for t in toks:
        syn = t.get("syntax") or {}
        head_i, func = syn.get("dep_head_idx"), syn.get("dep_func")
        if head_i is None or head_i < 0 or head_i >= len(toks):
            continue
        head = toks[head_i]
        pos, head_pos = (t.get("morph") or {}).get("pos"), (head.get("morph") or {}).get("pos")
        if func == "amod" and pos == "ADJ" and head_pos in ("NOUN", "PROPN"):
            noun, other = head, t
        elif func == "nsubj" and pos == "NOUN" and head_pos in ("VERB", "ADJ"):
            noun, other = t, head
        else:
            continue
        for feat in ("Gender", "Number"):
            fa, fb = _feat(noun, feat), _feat(other, feat)
            if fa and fb and fa != fb:
                problems.append(f"{noun.get('token')} ({feat} {fa}) with {other.get('token')} ({feat} {fb})")
        na, oa = alone.get(noun.get("token")), alone.get(other.get("token"))
        if na and oa:
            fa, fb = _feat(na, "Number"), _feat(oa, "Number")
            if fa and fb and fa != fb and (oa.get("morph") or {}).get("pos") in ("VERB", "ADJ"):
                problems.append(f"{noun.get('token')} (Number {fa}) with {other.get('token')} (Number {fb}), read alone")
            of = (oa.get("morph") or {}).get("feats") or {}
            # only when the word is a verb both alone and in the sentence (a homograph such as "cold"/"happened" is left alone)
            if (oa.get("morph") or {}).get("pos") == "VERB" and (other.get("morph") or {}).get("pos") == "VERB" and of.get("Tense") == "Past" and of.get("Person") == "3" and of.get("Number") == "Sing":
                fa, fb = _feat(na, "Gender"), _feat(oa, "Gender")
                if fa and fb and fa != fb:
                    problems.append(f"{noun.get('token')} (Gender {fa}) with {other.get('token')} (Gender {fb}), read alone")
    problems = list(dict.fromkeys(problems))
    return (not problems, "agreement: " + "; ".join(problems) if problems else "agrees", lemmas)


def loose_json(reply: str) -> dict:
    """The verdict fields of a reply whose JSON was cut off or malformed (a long reason hitting the token limit)."""
    tail = (reply or "").split("</think>")[-1]
    out = {}
    m = re.search(r'"ok"\s*:\s*(true|false)', tail)
    if m:
        out["ok"] = m.group(1) == "true"
    m = re.search(r'"answer"\s*:\s*(\d+)', tail)
    if m:
        out["answer"] = int(m.group(1))
    m = re.search(r'"unique"\s*:\s*(true|false)', tail)
    if m:
        out["unique"] = m.group(1) == "true"
    m = re.search(r'"reason"\s*:\s*"([^"]*)', tail)
    if m:
        out["reason"] = m.group(1)
    return out


# ---------------------------------------------------------------- stages

def stage_llm_judge(rows, kind, key, save):
    from llm import Chat, fill, first_json, load_prompt

    chat = Chat(key)
    prompts = {"example": load_prompt("judge_sentence"), "quiz": load_prompt("judge_quiz"), "ask": load_prompt("judge_ask"), "ask-wording": load_prompt("judge_wording")}
    p = prompts[kind]
    thinking = "thinking" in key.lower()
    for n, r in enumerate(rows):
        r.setdefault("judges", [])
        if any(j.get("key") == key for j in r["judges"]):
            continue
        if kind == "example":
            user = fill(p["user"], he=r["he"], en=r["en"], target_he=strip_points(r["target"]["he"]))
        elif kind == "quiz":
            user = fill(p["user"], stem=strip_points(r["stem"]), en=r.get("en", ""), choices="\n".join(f"{i + 1}. {strip_points(c)}" for i, c in enumerate(r["choices"])))
        elif kind == "ask":
            h = r["hits"][0]
            ps = r["answer"]["passages"][0]
            user = fill(p["user"], question=r.get("question_he") or r["question"], ref=ps["ref"], verse=strip_points(ps["he"]), span=strip_points(h["span"]))
        else:
            user = fill(p["user"], question=r["source_question"], he=r["he"])
        t0 = time.time()
        reply = chat.ask(p["system"], user, max_tokens=400 if thinking else 60, temperature=0.0)
        data = first_json(reply) or loose_json(reply)
        verdict = {**chat.tag, "seconds": round(time.time() - t0, 1)}
        if kind == "quiz":
            ans = data.get("answer")
            verdict.update(answer=(ans - 1) if isinstance(ans, int) else None, unique=data.get("unique") if isinstance(data.get("unique"), bool) else None)
            verdict["ok"] = verdict["answer"] == r.get("answer") and verdict["unique"] is True
        else:
            verdict.update(ok=data.get("ok") if isinstance(data.get("ok"), bool) else None, reason=str(data.get("reason") or ("no usable reply" if not data else ""))[:200])
            if verdict["ok"] is None:
                verdict["ok"] = False
        r["judges"].append(verdict)
        save()
        print(f"  {key} {n + 1}/{len(rows)} {r['id']}: {verdict.get('ok')}", flush=True)
    chat.close()


def stage_morph(rows, morph_json, save):
    todo = [r for r in rows if "morph" not in r.setdefault("checks", {})]
    if not todo:
        return
    alone: dict = {}
    if morph_json:
        table = {he_key(x["text"]): x for x in read_json(morph_json)}
        provider = {"key": "lane4-output", "file": str(morph_json)}
        analyses = [table.get(he_key(r["he"])) for r in todo]
    else:
        from models_bert import Morph

        m = Morph()
        provider = m.tag
        analyses = []
        for i in range(0, len(todo), 16):
            analyses += m.analyse([r["he"] for r in todo[i:i + 16]])
        words = sorted({t["token"] for an in analyses for t in an.get("tokens", [])})
        for i in range(0, len(words), 32):
            for w, an in zip(words[i:i + 32], m.analyse(words[i:i + 32])):
                if len(an.get("tokens", [])) == 1:
                    alone[w] = an["tokens"][0]
    for r, an in zip(todo, analyses):
        if not an:
            r["checks"]["morph"] = {"ok": False, "detail": "no analysis for this sentence", "provider": provider}
            continue
        ok, detail, lemmas = agreement(an, alone)
        r["checks"]["morph"] = {"ok": ok, "detail": detail, "lemmas": lemmas, "provider": provider}
    save()


def stage_roundtrip(rows, threshold, save):
    from models_bert import Translator

    todo = [r for r in rows if "roundtrip" not in r.setdefault("checks", {})]
    if not todo:
        return
    t = Translator()
    for r, mt in zip(todo, t.translate([r["he"] for r in todo])):
        score = overlap(r["en"], mt)
        r["checks"]["roundtrip"] = {"ok": score >= threshold, "score": round(score, 3), "mt": mt, "detail": f"round-trip {score:.2f} (needs {threshold}): reads back as “{mt}”", "provider": t.tag}
    save()


def offensive_label(reply: str) -> int | None:
    """The screen's label from its reply: the digit after 'תווית' (or 'label'), else None."""
    m = re.search(r"(?:תווית|label)\s*[:：]?\s*\**\s*([01])", reply, re.I)
    return int(m.group(1)) if m else None


def stage_offensive(rows, save):
    from llm import Chat, fill, load_prompt

    todo = [r for r in rows if "offensive" not in r.setdefault("checks", {})]
    if not todo:
        return
    chat = Chat("judge-dictalm2", lora_key="offensive")
    tag = {"key": "offensive", **{k: chat.tag[k] for k in ("id", "revision")}, "adapter": "KevynKrancenblum/hebrew-offensive-detection"}
    p = load_prompt("offensive")
    for n, r in enumerate(todo):
        text = r.get("he") or " ".join(r.get("choices") or []) or r.get("stem") or ""
        reply = chat.ask("", fill(p["user"], text=strip_points(text).replace('"', "'")), max_tokens=48, temperature=0.0)
        label = offensive_label(reply)
        r["checks"]["offensive"] = {"ok": label == 0, "label": label, "detail": "clean" if label == 0 else ("flagged: " + reply.strip()[:160] if label == 1 else "no label in the screen's reply"), "provider": tag}
        save()
        print(f"  offensive {n + 1}/{len(todo)} {r['id']}: {label}", flush=True)
    chat.close()


QUALIFY = {"good_accepted_min": 5, "of_good": 6, "bad_rejected_min": 6, "of_bad": 8}


def qualification(canaries: list[dict], key: str) -> dict:
    """How a judge did on the known-answer sentences, and whether its verdicts may count at the gate."""
    good = [c for c in canaries if c["good"]]
    bad = [c for c in canaries if not c["good"]]
    said = lambda c: next((j.get("ok") for j in c.get("judges", []) if j.get("key") == key), None)  # noqa: E731
    ga, br = sum(said(c) is True for c in good), sum(said(c) is False for c in bad)
    ok = len(good) > 0 and len(bad) > 0 and ga * QUALIFY["of_good"] >= QUALIFY["good_accepted_min"] * len(good) and br * QUALIFY["of_bad"] >= QUALIFY["bad_rejected_min"] * len(bad)
    return {"good_accepted": ga, "good": len(good), "bad_rejected": br, "bad": len(bad), "qualified": ok,
            "rule": f"accept at least {QUALIFY['good_accepted_min']} of {QUALIFY['of_good']} good and reject at least {QUALIFY['bad_rejected_min']} of {QUALIFY['of_bad']} bad"}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--type", required=True, choices=["example", "quiz", "ask", "ask-wording"])
    ap.add_argument("--stages", nargs="+", required=True)
    ap.add_argument("--stop-early", action="store_true")
    ap.add_argument("--morph-json", help="Lane 4's per-sentence output, instead of running its model here")
    ap.add_argument("--roundtrip-min", type=float, default=0.5)
    ap.add_argument("--canaries", help="JSON of known good/bad sentences; each judge is scored on them first (work/judges.json) and must qualify")
    ap.add_argument("--run-unqualified", action="store_true", help="still collect verdicts from a judge that did not qualify (they do not count at the gate)")
    a = ap.parse_args()

    rows = read_jsonl(a.inp)
    save = lambda: write_jsonl(a.inp, rows)  # noqa: E731
    canaries = None
    if a.canaries:
        cpath = Path(a.inp).with_suffix(".canaries.json")
        canaries = read_json(cpath) if cpath.exists() else [dict(c) for c in read_json(a.canaries)]
        csave = lambda: write_json(cpath, canaries)  # noqa: E731
    for stage in a.stages:
        live = [r for r in rows if not (a.stop_early and failed(r))]
        print(f"stage {stage}: {len(live)} of {len(rows)} items", flush=True)
        if stage.startswith("judge:"):
            key = stage.split(":", 1)[1]
            qpath = Path(a.inp).parent / "judges.json"
            quals = read_json(qpath) if qpath.exists() else {}
            if canaries is not None:
                stage_llm_judge(canaries, "example", key, csave)
                quals[key] = qualification(canaries, key)
                write_json(qpath, quals)
                print(f"  {key} on the known-answer set: {quals[key]}", flush=True)
            if key in quals and not quals[key]["qualified"] and not a.run_unqualified:
                print(f"  {key} did not qualify; its verdicts would not count at the gate, so the items are not sent to it", flush=True)
                continue
            stage_llm_judge(live, a.type, key, save)
        elif stage == "morph":
            if canaries is not None:
                stage_morph(canaries, None, csave)
            stage_morph(live, a.morph_json, save)
        elif stage == "roundtrip":
            stage_roundtrip(live, a.roundtrip_min, save)
        elif stage == "offensive":
            wanted = [s.split(":", 1)[1] for s in a.stages if s.startswith("judge:")]
            qpath = Path(a.inp).parent / "judges.json"
            quals = read_json(qpath) if qpath.exists() else {}
            if wanted and sum(bool(quals.get(k, {}).get("qualified")) for k in wanted) < 2:
                print("  fewer than two judges qualified, so nothing here can pass the gate; the screen is not run", flush=True)
                continue
            stage_offensive(live, save)
        else:
            ap.error(f"unknown stage {stage}")
    if canaries is not None:
        print("canaries (known answers):")
        keys = sorted({j["key"] for c in canaries for j in c.get("judges", [])})
        for k in keys + ["morph"]:
            right = total = 0
            for c in canaries:
                got = next((j["ok"] for j in c.get("judges", []) if j["key"] == k), None) if k != "morph" else (c.get("checks", {}).get("morph") or {}).get("ok")
                if got is None or (k == "morph" and c.get("flaw") not in (None, "agreement")):
                    continue
                total += 1
                right += got == c["good"]
            print(f"  {k}: {right}/{total} right")


if __name__ == "__main__":
    main()
