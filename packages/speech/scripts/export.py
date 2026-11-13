#!/usr/bin/env python3
"""Builds the listening packs from pinned Hub files. Offline tool; nothing here runs in the app.

  python scripts/export.py fetch --work <dir> [--pack listen-lite]
      Downloads the files each pack needs, at the revision pinned in models.manifest.json, straight to disk,
      and checks size and SHA-256 against scripts/sources.json. A file already there and matching is kept.

  python scripts/export.py shrink-ctc --src <fp32 model.onnx> --out <model.q4.onnx> [--block 32]
      Re-exports the letter-check model smaller than the published 8-bit file: the large MatMul weights are stored
      in 4 bits (MatMulNBits) and the other large float tensors in 16 bits, cast back to 32 as the graph loads.
      Inputs and outputs are unchanged. Score it before shipping it: node scripts/eval-pron.mjs --model <out> ...

  python scripts/export.py pack --work <dir> --out <dir> [--pack listen-lite] [--version 1]
      For each pack: strips producer notes from the graphs, cuts every file into parts of at most 16 MiB, writes
      <out>/<pack>/pack.json (alef.pack.v1), checks the size budget, and copies the list to packs/<pack>.pack.json.
      Upload <out>/<pack>/ as it is to the static pack host. Nothing in <out> goes into git.

Intermediates are deleted as soon as they are used, and every step first checks that the disk keeps 2.5 GB free.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG = HERE.parent
_spec = importlib.util.spec_from_file_location("convert_common", HERE.parents[2] / "scripts" / "convert-common.py")
cc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cc)

SOURCES = json.loads((HERE / "sources.json").read_text(encoding="utf-8"))


def _packs(only):
    return {k: v for k, v in SOURCES["packs"].items() if not only or k == only}


def fetch(args):
    work = Path(args.work)
    for pack, recipe in _packs(args.pack).items():
        entry = cc.manifest_entry(recipe["model"])
        folder = work / pack
        folder.mkdir(parents=True, exist_ok=True)
        for f in recipe["fetch"]:
            dest = folder / Path(f["path"]).name
            if dest.exists() and dest.stat().st_size == f["bytes"] and cc.sha256_file(dest) == f["sha256"]:
                print("have ", pack, f["path"])
                continue
            cc.require_free(f["bytes"], folder)
            url = f"https://huggingface.co/{recipe['model']}/resolve/{entry['hubRevision']}/{f['path']}"
            print("fetch", url)
            tmp = dest.with_name(dest.name + ".part")
            with urllib.request.urlopen(url) as r, open(tmp, "wb") as w:  # noqa: S310 (a fixed https address)
                shutil.copyfileobj(r, w, cc.MIB)
            if tmp.stat().st_size != f["bytes"] or cc.sha256_file(tmp) != f["sha256"]:
                tmp.unlink()
                sys.exit(f"{f['path']}: not the pinned file (size or SHA-256 differs)")
            tmp.replace(dest)


def shrink_ctc(args):
    import numpy as np
    import onnx
    from onnx import TensorProto, helper, numpy_helper
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

    src, out = Path(args.src), Path(args.out)
    cc.require_free(src.stat().st_size, out.parent)
    quantizer = MatMulNBitsQuantizer(onnx.load(str(src)), bits=4, block_size=args.block, is_symmetric=False, accuracy_level=4)
    quantizer.process()
    model = quantizer.model.model
    # the other large float tensors (convolution weights): 16 bits on disk, cast back to 32 as the graph loads
    casts = []
    for init in model.graph.initializer:
        if init.data_type != TensorProto.FLOAT:
            continue
        arr = numpy_helper.to_array(init)
        if arr.size < args.min_half:
            continue
        half = arr.astype(np.float16)
        if not np.isfinite(half).all():
            continue
        name = init.name
        init.CopyFrom(numpy_helper.from_array(half, name + "_f16"))
        casts.append(helper.make_node("Cast", [name + "_f16"], [name], to=TensorProto.FLOAT, name=f"load_{len(casts)}"))
    for node in reversed(casts):
        model.graph.node.insert(0, node)
    onnx.checker.check_model(model)
    onnx.save(model, str(out))
    cc.strip_onnx_metadata(out)
    print(f"{out}: {out.stat().st_size} bytes ({out.stat().st_size / cc.MIB:.1f} MiB), {len(casts)} tensors kept in 16 bits, sha256 {cc.sha256_file(out)}")


def pack(args):
    work, out_root = Path(args.work), Path(args.out)
    for name, recipe in _packs(args.pack).items():
        entry = cc.manifest_entry(recipe["model"])
        if entry["tier"] != "D":
            sys.exit(f"{recipe['model']} is tier {entry['tier']}; only tier D ships")
        folder, out = work / name, out_root / name
        cc.remove(out)
        out.mkdir(parents=True)
        stage = out / "_stage"
        stage.mkdir()
        for built, how in (recipe.get("build") or {}).items():
            if not (folder / built).exists():
                shrink_ctc(argparse.Namespace(src=str(folder / how["shrink-ctc"]), out=str(folder / built), block=how.get("block", 32), min_half=65536))
            if how.get("sha256") and cc.sha256_file(folder / built) != how["sha256"]:
                print(f"note: {built} differs from the file the recorded pack was built from (a different tool version?). Score it again before publishing.", file=sys.stderr)
        entries = []
        for target, source in recipe["files"].items():
            staged = stage / target
            if isinstance(source, str):
                src = folder / source
                if target.endswith(".onnx"):
                    cc.require_free(src.stat().st_size, stage)
                    cc.strip_onnx_metadata(src, staged)
                else:
                    shutil.copyfile(src, staged)
            elif "tokens" in source:  # the two token tables in one small file
                vocab, added = (json.loads((folder / f).read_text(encoding="utf-8")) for f in source["tokens"])
                staged.write_text(json.dumps({"vocab": vocab, "added": added}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            elif "spec" in source:  # what the worker needs to know about the pack
                spec = dict(source["spec"])
                if spec["kind"] == "whisper":
                    c = json.loads((folder / "config.json").read_text(encoding="utf-8"))
                    g = json.loads((folder / "generation_config.json").read_text(encoding="utf-8"))
                    spec["config"] = {k: c[k] for k in ("num_mel_bins", "decoder_layers", "decoder_attention_heads", "d_model")}
                    spec["generation"] = {"suppress_tokens": g.get("suppress_tokens") or [], "begin_suppress_tokens": g.get("begin_suppress_tokens") or []}
                spec["source"] = {"model": recipe["model"], "revision": entry["hubRevision"], "licence": entry["licence"]}
                staged.write_text(json.dumps(spec, separators=(",", ":")), encoding="utf-8")
            entries.append(cc.split_parts(staged, out, target))
            staged.unlink()
        stage.rmdir()
        total = cc.check_budget(name, entries)
        listing = cc.write_pack_list(name, args.version, entries, out)
        (PKG / "packs").mkdir(exist_ok=True)
        shutil.copyfile(listing, PKG / "packs" / f"{name}.pack.json")
        parts = sum(len(e["parts"]) for e in entries)
        print(f"{name}: {total} bytes ({total / cc.MIB:.1f} MiB) in {parts} parts -> {out}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("fetch")
    a.add_argument("--work", required=True)
    a.add_argument("--pack")
    a.set_defaults(fn=fetch)
    b = sub.add_parser("shrink-ctc")
    b.add_argument("--src", required=True)
    b.add_argument("--out", required=True)
    b.add_argument("--block", type=int, default=32)
    b.add_argument("--min-half", type=int, default=65536)
    b.set_defaults(fn=shrink_ctc)
    c = sub.add_parser("pack")
    c.add_argument("--work", required=True)
    c.add_argument("--out", required=True)
    c.add_argument("--pack")
    c.add_argument("--version", default="1")
    c.set_defaults(fn=pack)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
