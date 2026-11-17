#!/usr/bin/env python3
"""QA only: score sivan22/testing-trOCR-hebrew-handwritten on the same held-out real-handwriting set as our own model.

That model has no licence on the Hub and is marked "testing", so it is never shipped and nothing it produces ships.
It is run here once, offline, to have an outside number next to ours. Needs: pip install torch transformers pillow.

  python scripts/bench_trocr.py --model-dir build/trocr --hhd build/hhd_dataset --out build/pack/trocr-benchmark.json [--limit N]

--model-dir holds config.json, preprocessor_config.json, generation_config.json and pytorch_model.bin from the pinned
revision (models.manifest.json), plus the vocabulary of its text decoder (onlplab/alephbert-base, vocab.txt).
The model writes text, not a class: an image counts as right when the first Hebrew letter it writes is the labelled letter.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import CHARS, HHD_TO_INDEX, CONFUSABLE_GROUPS, IDS

REVISION = "419f9f0b3a76c20254e17a9a1722f91c588420f6"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--hhd", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    from transformers import VisionEncoderDecoderModel, BeitImageProcessor, BertTokenizer

    torch.set_num_threads(2)
    model = VisionEncoderDecoderModel.from_pretrained(a.model_dir).eval()
    proc = BeitImageProcessor.from_pretrained(a.model_dir)
    tok = BertTokenizer(str(Path(a.model_dir) / "vocab.txt"))
    items = []
    for folder in range(27):
        for f in sorted((Path(a.hhd) / "TEST" / str(folder)).glob("*.png")):
            items.append((f, HHD_TO_INDEX[folder]))
    if a.limit:
        items = items[:: max(1, len(items) // a.limit)]
    right = 0
    rows = []
    t0 = time.time()
    for i in range(0, len(items), 16):
        batch = items[i : i + 16]
        px = proc(images=[Image.open(f).convert("RGB") for f, _ in batch], return_tensors="pt").pixel_values
        with torch.no_grad():
            ids = model.generate(
                px, max_length=4, num_beams=4, decoder_start_token_id=2, eos_token_id=3, pad_token_id=0
            )  # ids from the model's own config.json
        for (f, y), text in zip(batch, tok.batch_decode(ids, skip_special_tokens=True)):
            first = next((c for c in text if "א" <= c <= "ת"), "")
            ok = first == CHARS[y]
            right += ok
            rows.append((y, first))
        print(f"{i + len(batch)}/{len(items)} running top-1 {right / (i + len(batch)):.3f}", file=sys.stderr, flush=True)
    groups = {}
    for g in CONFUSABLE_GROUPS:
        idx = [IDS.index(i) for i in g]
        sel = [(y, p) for y, p in rows if y in idx]
        if sel:
            groups["/".join(g)] = {"n": len(sel), "top1": round(sum(p == CHARS[y] for y, p in sel) / len(sel), 4)}
    out = {
        "model": "sivan22/testing-trOCR-hebrew-handwritten",
        "revision": REVISION,
        "licence": "none stated (QA only, never shipped)",
        "set": "HHD_v0 TEST",
        "n": len(items),
        "top1": round(right / len(items), 4),
        "groups": groups,
        "seconds": round(time.time() - t0),
        "note": "first Hebrew letter of the generated text vs the label; beam 4, max length 4",
    }
    Path(a.out).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
