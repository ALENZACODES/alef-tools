#!/usr/bin/env python3
"""Write the small fixtures the JavaScript tests read (tests/fixtures/). Run after any change to common.py or train.py.

python scripts/make_fixtures.py

tiny.onnx + tiny.json   a random-weight model of the same layer plan, a few KB, with inputs and the logits onnxruntime
                        gives for them: checks the model reader and the built-in runner in src/classify.js.
parity.json             strokes and small images with the picture common.py makes from them: checks src/preprocess.js.
"""

import json
import sys
from pathlib import Path

import numpy as np
import torch
import onnxruntime as ort

sys.path.insert(0, str(Path(__file__).parent))
import train
from common import IDS, norm32, strokes_to_32, scan_to_ink
from export import build

OUT = Path(__file__).resolve().parent.parent / "tests/fixtures"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(3)
    train.WIDTHS["tiny"] = (3, 4, 4, 5, 5, 6)
    model = train.LetterNet("tiny")
    for bn in model.bns:  # non-trivial batch-norm statistics, so folding is exercised
        bn.running_mean.normal_(0, 0.3)
        bn.running_var.uniform_(0.5, 1.5)
        bn.weight.data.uniform_(0.5, 1.5)
        bn.bias.data.normal_(0, 0.3)
    model.eval()
    data = build(model).SerializeToString()
    (OUT / "tiny.onnx").write_bytes(data)
    rng = np.random.default_rng(5)
    xs = rng.random((3, 1, 32, 32), np.float32)
    logits = ort.InferenceSession(data, providers=["CPUExecutionProvider"]).run(None, {"input": xs})[0]
    (OUT / "tiny.json").write_text(
        json.dumps(
            {
                "arch": {"convs": 6, "poolAfter": [0, 2, 4]},
                "classes": IDS,
                "inputs": [np.round(x.ravel(), 6).tolist() for x in xs],
                "logits": [np.round(row, 5).tolist() for row in logits],
            }
        )
    )

    cases = []
    strokes = [
        [[[100, 100], [900, 100], [900, 900]]],
        [[[200, 150], [200, 850]], [[200, 150], [700, 150], [700, 850]], [[450, 500], [450, 850]]],
        [[[500, 100], [520, 300], [480, 620], [500, 900]]],
        [[[300, 300]]],
    ]
    for s in strokes:
        for pen in (0.9, 1.6):
            cases.append({"kind": "strokes", "strokes": s, "pen": pen, "want": np.round(strokes_to_32(s, pen), 3).ravel().tolist()})
    for h, w in ((90, 60), (20, 14)):
        ink = np.zeros((h, w), np.float32)
        yy, xx = np.mgrid[0:h, 0:w]
        ink[(np.abs(xx - w * 0.3) < w * 0.08) & (yy > h * 0.15) & (yy < h * 0.9)] = 1
        ink[(np.abs(yy - h * 0.2) < h * 0.06) & (xx > w * 0.25) & (xx < w * 0.8)] = 1
        ink = np.clip(ink + rng.random((h, w), np.float32) * 0.1, 0, 1)
        cases.append(
            {
                "kind": "ink",
                "width": w,
                "height": h,
                "ink": np.round(ink, 3).ravel().tolist(),
                "want": np.round(norm32(ink), 3).ravel().tolist(),
            }
        )
    gray = (255 - (ink * 180)).astype(np.uint8)
    cases.append(
        {
            "kind": "gray",
            "width": gray.shape[1],
            "height": gray.shape[0],
            "gray": gray.ravel().tolist(),
            "want": np.round(norm32(scan_to_ink(gray)), 3).ravel().tolist(),
        }
    )
    (OUT / "parity.json").write_text(json.dumps({"cases": cases}))
    print("wrote", [p.name for p in OUT.iterdir()], "tiny.onnx bytes", len(data))


if __name__ == "__main__":
    main()
