#!/usr/bin/env python3
"""Score letters.onnx on the held-out sets and write the numbers the README quotes.

  python scripts/eval.py --model build/pack/letters.onnx --data build/data --out build/pack/eval.json

Sets: hhd_test (real handwriting, HHD_v0 TEST, never trained on or used to pick the checkpoint) and font_heldout
(letters from three fonts kept out of training). For each of the look-alike groups it reports two numbers:
  top1     - share of that group's test letters given exactly the right label out of all 28;
  in_group - share given the right label when the choice is only among the group's own letters.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort

sys.path.insert(0, str(Path(__file__).parent))
from common import IDS, CONFUSABLE_GROUPS, NOT_A_LETTER


def score(sess, x, y):
    logits = np.concatenate([sess.run(None, {"input": x[i : i + 512]})[0] for i in range(0, len(x), 512)])
    pred = logits.argmax(1)
    res = {"n": int(len(y)), "top1": round(float((pred == y).mean()), 4)}
    top3 = np.argsort(-logits, 1)[:, :3]
    res["top3"] = round(float((top3 == y[:, None]).any(1).mean()), 4)
    res["per_class"] = {
        IDS[c]: {"n": int((y == c).sum()), "top1": round(float((pred[y == c] == c).mean()), 4)} for c in range(27) if (y == c).any()
    }
    groups = {}
    for g in CONFUSABLE_GROUPS:
        idx = [IDS.index(i) for i in g]
        m = np.isin(y, idx)
        if not m.any():
            continue
        sub = logits[m][:, idx].argmax(1)
        want = np.array([idx.index(v) for v in y[m]])
        groups["/".join(g)] = {
            "n": int(m.sum()),
            "top1": round(float((pred[m] == y[m]).mean()), 4),
            "in_group": round(float((sub == want).mean()), 4),
        }
    res["groups"] = groups
    res["called_not_a_letter"] = round(float((pred == NOT_A_LETTER).mean()), 4)
    conf = {}
    for t, p in zip(y, pred):
        if t != p:
            k = f"{IDS[t]}>{IDS[p]}"
            conf[k] = conf.get(k, 0) + 1
    res["top_confusions"] = sorted(conf.items(), key=lambda kv: -kv[1])[:15]
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="build/pack/letters.onnx")
    ap.add_argument("--data", default="build/data")
    ap.add_argument("--out", default="build/pack/eval.json")
    a = ap.parse_args()
    so = ort.SessionOptions()
    so.intra_op_num_threads = 1
    sess = ort.InferenceSession(a.model, so, providers=["CPUExecutionProvider"])
    out = {"model": Path(a.model).name}
    for name in ("hhd_test", "font_heldout"):
        p = Path(a.data) / f"{name}.npz"
        if not p.exists():
            continue
        d = np.load(p)
        out[name] = score(sess, d["x"].astype(np.float32)[:, None] / 255, d["y"].astype(np.int64))
    one = np.zeros((1, 1, 32, 32), np.float32)
    for _ in range(20):
        sess.run(None, {"input": one})
    t = time.perf_counter()
    for _ in range(200):
        sess.run(None, {"input": one})
    out["ms_per_letter_onnxruntime_cpu_1_thread"] = round((time.perf_counter() - t) / 200 * 1000, 2)
    Path(a.out).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    brief = {k: {kk: vv for kk, vv in v.items() if kk in ("n", "top1", "top3", "groups")} for k, v in out.items() if isinstance(v, dict)}
    print(json.dumps(brief, indent=1))
    print("ms per letter (onnxruntime, 1 thread):", out["ms_per_letter_onnxruntime_cpu_1_thread"])


if __name__ == "__main__":
    main()
