#!/usr/bin/env python3
"""Converts dicta-il/dictabert-large-char-menaked (CC-BY-4.0) to ONNX and makes the small browser builds.

    python scripts/export_menaked.py --model-dir <snapshot folder> --out build/menaked [--variants int8,q4]

The snapshot folder holds config.json, tokenizer.json and model.safetensors of the revision pinned in models.manifest.json
(`--download` fetches exactly that revision with the shared helper). The model's own Python file is not run: the network is rebuilt here from
the config (a BERT encoder and two linear layers), so no remote code is trusted.

Outputs in --out:  menaked.int8.onnx (8-bit weights), optionally menaked.q4.onnx (4-bit weights), both with tool notes
stripped, and conversion.json (sizes, SHA-256, how far each build's answers are from the full model on the check lines).
The full-size ONNX file is an intermediate and is deleted at the end unless --keep-fp32 is given.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np

import importlib.util
import pathlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nikud_core as core  # noqa: E402

# the shared conversion helpers (pinned download, free-space check, metadata stripping, hashing)
_spec = importlib.util.spec_from_file_location("convert_common", pathlib.Path(__file__).resolve().parents[3] / "scripts" / "convert-common.py")
cc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cc)

MODEL_ID = "dicta-il/dictabert-large-char-menaked"
CHECK_LINES = [
    "בשנת 1948 השלים אפרים קישון את לימודיו בפיסול מתכת ובתולדות האמנות והחל לפרסם מאמרים הומוריסטיים",
    "שלום, מה שלומך היום?",
    "אני רוצה להזמין קפה ועוגה, בבקשה.",
    "הילדים אהבו במיוחד את הסיפורים הללו שהמורה הקריאה.",
    "איפה התחנה המרכזית? אני צריך להגיע לירושלים לפני השקיעה.",
    "כל הכבוד! עשית עבודה מצוינת.",
    "היא שרה שיר ישן ששמעה מסבתא שלה בשבת בבוקר.",
    "ספר",
]


def build_torch(model_dir: str):
    import torch
    from safetensors.torch import load_file
    from transformers import BertConfig, BertModel

    cfg = BertConfig.from_pretrained(model_dir)

    class Menaked(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.bert = BertModel(cfg, add_pooling_layer=False)
            self.nikud_cls = torch.nn.Linear(cfg.hidden_size, len(core.NIKUD_CLASSES))
            self.shin_cls = torch.nn.Linear(cfg.hidden_size, len(core.SHIN_CLASSES))

        def forward(self, input_ids, attention_mask):
            h = self.bert(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
            return self.nikud_cls(h), self.shin_cls(h)

    m = Menaked()
    sd = load_file(os.path.join(model_dir, "model.safetensors"))
    sd = {k.replace("menaked.nikud_cls", "nikud_cls").replace("menaked.shin_cls", "shin_cls"): v for k, v in sd.items()}
    missing, unexpected = m.load_state_dict(sd, strict=False)
    missing = [k for k in missing if "position_ids" not in k]
    if missing or [k for k in unexpected if "position_ids" not in k]:
        raise SystemExit(f"weights do not fit the rebuilt network: missing={missing[:5]} unexpected={unexpected[:5]}")
    return m.eval()


def run_torch(model, vocab, lines):
    import torch
    out = []
    with torch.no_grad():
        for line in lines:
            ids = core.encode(line, vocab)
            n, s = model(torch.tensor([ids]), torch.ones(1, len(ids), dtype=torch.long))
            out.append((n[0, 1:-1].numpy(), s[0, 1:-1].numpy()))
    return out


def run_onnx(path, vocab, lines, threads=0):
    import onnxruntime as ort
    so = ort.SessionOptions()
    if threads:
        so.intra_op_num_threads = threads
    sess = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
    out, t0 = [], time.time()
    for line in lines:
        ids = np.array([core.encode(line, vocab)], dtype=np.int64)
        n, s = sess.run(["nikud_logits", "shin_logits"], {"input_ids": ids, "attention_mask": np.ones_like(ids)})
        out.append((n[0, 1:-1], s[0, 1:-1]))
    return out, (time.time() - t0) / len(lines)


def agreement(ref, got, lines):
    """Share of Hebrew letters whose chosen marks are the same as the reference build's, and of whole lines."""
    same = total = lines_same = 0
    for (rn, rs), (gn, gs), line in zip(ref, got, lines):
        a = core.decode(line, rn.argmax(-1), rs.argmax(-1))
        b = core.decode(line, gn.argmax(-1), gs.argmax(-1))
        lines_same += a == b
        for i, ch in enumerate(line):
            if core.is_letter(ch):
                total += 1
                same += rn[i].argmax() == gn[i].argmax() and (ch != "ש" or rs[i].argmax() == gs[i].argmax())
    return {"letters": total, "lettersSame": int(same), "letterShare": round(same / max(total, 1), 5), "linesSame": int(lines_same), "lines": len(lines)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--variants", default="int8")
    ap.add_argument("--download", action="store_true", help="fetch the pinned revision into --model-dir first")
    ap.add_argument("--keep-fp32", action="store_true")
    ap.add_argument("--check-file", help="extra check lines, one per line (unpointed Hebrew)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    revision = cc.manifest_entry(MODEL_ID)["hubRevision"]  # the pinned revision lives in models.manifest.json, nowhere else
    if a.download:
        cc.require_free(3 * 1222010788, a.out)  # the weights, the full-size ONNX file and one small build at a time
        cc.snapshot(MODEL_ID, a.model_dir, allow_patterns=["config.json", "tokenizer.json", "model.safetensors"])
    vocab = core.load_vocab(a.model_dir)
    lines = list(CHECK_LINES)
    if a.check_file:
        with open(a.check_file, encoding="utf-8") as f:
            lines += [core.strip_points(x.strip()) for x in f if x.strip()]

    import torch
    model = build_torch(a.model_dir)
    ref = run_torch(model, vocab, lines)
    print("sample:", core.decode(lines[0], ref[0][0].argmax(-1), ref[0][1].argmax(-1)))

    fp32 = os.path.join(a.out, "menaked.fp32.onnx")
    ids = torch.tensor([core.encode(lines[0], vocab)])
    torch.onnx.export(
        model, (ids, torch.ones_like(ids)), fp32, input_names=["input_ids", "attention_mask"],
        output_names=["nikud_logits", "shin_logits"], opset_version=17, dynamo=False,
        dynamic_axes={k: {0: "batch", 1: "chars"} for k in ["input_ids", "attention_mask", "nikud_logits", "shin_logits"]},
    )
    del model
    report = {"model": MODEL_ID, "revision": revision, "licence": "CC-BY-4.0", "checkLines": len(lines), "builds": {}}
    got, sec = run_onnx(fp32, vocab, lines)
    report["builds"]["fp32"] = {"bytes": os.path.getsize(fp32), "vsTorch": agreement(ref, got, lines), "secondsPerLine": round(sec, 3), "kept": bool(a.keep_fp32)}
    print("fp32", report["builds"]["fp32"])

    for v in [x for x in a.variants.split(",") if x]:
        dst = os.path.join(a.out, f"menaked.{v}.onnx")
        if v == "int8":
            from onnxruntime.quantization import QuantType, quantize_dynamic
            # Signed weights, one scale per output channel, 7-bit range. Signed weights are what the runtime multiplies
            # fastest (three times faster than unsigned on a desktop processor in our check), and per-channel scales with the
            # reduced range stay closer to the full model's answers (review/build-agreement.json).
            quantize_dynamic(fp32, dst, weight_type=QuantType.QInt8, per_channel=True, reduce_range=True,
                             op_types_to_quantize=["MatMul"], extra_options={"MatMulConstBOnly": True})
        elif v == "q4":
            import onnx
            from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
            q = MatMulNBitsQuantizer(onnx.load(fp32), block_size=32, is_symmetric=True, accuracy_level=4)
            q.process()
            onnx.save(q.model.model, dst)
            del q
        else:
            raise SystemExit(f"unknown variant {v}")
        cc.strip_onnx_metadata(dst)  # no producer, tool or author notes in a file that ships
        got, sec = run_onnx(dst, vocab, lines)
        report["builds"][v] = {"file": os.path.basename(dst), "bytes": os.path.getsize(dst), "mebibytes": round(os.path.getsize(dst) / 2**20, 1),
                               "sha256": cc.sha256_file(dst), "vsTorch": agreement(ref, got, lines), "secondsPerLine": round(sec, 3)}
        print(v, report["builds"][v])
    if not a.keep_fp32:
        os.remove(fp32)
    with open(os.path.join(a.out, "conversion.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
