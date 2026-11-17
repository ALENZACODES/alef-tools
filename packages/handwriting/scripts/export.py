#!/usr/bin/env python3
"""Checkpoint -> letters.onnx (plain float32, batch norm folded into the convolutions, no producer or author notes).

  python scripts/export.py --ckpt build/run/best.pt --out build/pack

Writes letters.onnx and model.json (class list, layer plan, bytes, SHA-256), then checks the file with onnxruntime
against the PyTorch model. The graph is written node by node so tensor names are fixed (conv0.weight ... fc.bias):
src/classify.js reads those names directly.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import torch
import onnx
from onnx import helper, numpy_helper, TensorProto

sys.path.insert(0, str(Path(__file__).parent))
from common import IDS
from train import LetterNet

MAX_BYTES = 2 * 1024 * 1024


def folded(model: LetterNet):
    out = []
    for conv, bn in zip(model.convs, model.bns):
        scale = (bn.weight / torch.sqrt(bn.running_var + bn.eps)).detach()
        w = (conv.weight.detach() * scale.view(-1, 1, 1, 1)).numpy().astype(np.float32)
        b = (bn.bias.detach() - bn.running_mean * scale).numpy().astype(np.float32)
        out.append((w, b))
    return out


def build(model: LetterNet) -> onnx.ModelProto:
    nodes, inits = [], []
    cur = "input"
    for i, (w, b) in enumerate(folded(model)):
        inits += [numpy_helper.from_array(w, f"conv{i}.weight"), numpy_helper.from_array(b, f"conv{i}.bias")]
        nodes.append(helper.make_node("Conv", [cur, f"conv{i}.weight", f"conv{i}.bias"], [f"c{i}"], kernel_shape=[3, 3], pads=[1, 1, 1, 1]))
        nodes.append(helper.make_node("Relu", [f"c{i}"], [f"r{i}"]))
        cur = f"r{i}"
        if i in model.pool_after:
            nodes.append(helper.make_node("MaxPool", [cur], [f"p{i}"], kernel_shape=[2, 2], strides=[2, 2]))
            cur = f"p{i}"
    nodes.append(helper.make_node("GlobalAveragePool", [cur], ["gap"]))
    nodes.append(helper.make_node("Flatten", ["gap"], ["flat"], axis=1))
    inits += [
        numpy_helper.from_array(model.fc.weight.detach().numpy().astype(np.float32), "fc.weight"),
        numpy_helper.from_array(model.fc.bias.detach().numpy().astype(np.float32), "fc.bias"),
    ]
    nodes.append(helper.make_node("Gemm", ["flat", "fc.weight", "fc.bias"], ["logits"], transB=1))
    graph = helper.make_graph(
        nodes,
        "letters",
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, ["n", 1, 32, 32])],
        [helper.make_tensor_value_info("logits", TensorProto.FLOAT, ["n", len(IDS)])],
        inits,
    )
    m = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    m.ir_version = 8
    m.producer_name = ""
    m.producer_version = ""
    m.doc_string = ""
    m.domain = ""
    del m.metadata_props[:]
    onnx.checker.check_model(m)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="build/run/best.pt")
    ap.add_argument("--out", default="build/pack")
    ap.add_argument("--version", default="1")
    a = ap.parse_args()
    ck = torch.load(a.ckpt, map_location="cpu")
    model = LetterNet(ck["width"])
    model.load_state_dict(ck["state"])
    model.eval()
    m = build(model)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    data = m.SerializeToString()
    if len(data) > MAX_BYTES:
        raise SystemExit(f"letters.onnx is {len(data)} bytes, over the 2 MiB budget")
    (out / "letters.onnx").write_bytes(data)
    import onnxruntime as ort

    x = np.random.default_rng(0).random((16, 1, 32, 32), np.float32)
    got = ort.InferenceSession(data, providers=["CPUExecutionProvider"]).run(None, {"input": x})[0]
    with torch.no_grad():
        want = model(torch.from_numpy(x)).numpy()
    diff = float(np.abs(got - want).max())
    if diff > 1e-3:
        raise SystemExit(f"onnx and pytorch disagree by {diff}")
    info = {
        "schema": "alef.handwriting.model.v1",
        "version": a.version,
        "file": "letters.onnx",
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "input": {"name": "input", "shape": [1, 1, 32, 32], "format": "norm32: 1 = ink, ink box fitted to 24 px, centred"},
        "output": {"name": "logits", "classes": len(IDS)},
        "arch": {"convs": len(model.convs), "poolAfter": list(model.pool_after), "width": ck["width"]},
        "classes": IDS,
        "parameters": int(sum(p.numel() for p in model.parameters())),
        "checkpointEpoch": ck.get("epoch"),
    }
    (out / "model.json").write_text(json.dumps(info, indent=1) + "\n")
    print(json.dumps({"bytes": len(data), "sha256": info["sha256"], "max_abs_diff_vs_pytorch": diff}))


if __name__ == "__main__":
    main()
