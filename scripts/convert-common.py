#!/usr/bin/env python3
"""Shared helpers for the lanes' conversion scripts.

Each lane's packages/<name>/scripts/ imports this file for the parts every conversion has in common:
download one pinned revision from the Hub, keep disk use small, quantise to 8-bit, strip notes from the
ONNX file, and hash the result. Heavy imports (huggingface_hub, onnx, onnxruntime) happen inside the
functions that need them, so the cheap helpers and their tests run on a bare Python.

    import importlib.util, pathlib
    spec = importlib.util.spec_from_file_location("convert_common", pathlib.Path(__file__).parents[3] / "scripts" / "convert-common.py")
    cc = importlib.util.module_from_spec(spec); spec.loader.exec_module(cc)
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIB = 1024 * 1024
MAX_PART_BYTES = 16 * MIB
# John's rule 10: the box keeps at least 2.5 GB free. Checked before every download and conversion step.
MIN_FREE_BYTES = int(2.5 * 1024 * MIB)
REVISION = re.compile(r"^[0-9a-f]{40}$")


class ConvertError(RuntimeError):
    pass


def sha256_file(path, chunk: int = MIB) -> str:
    """SHA-256 of a file, read in pieces so a large model never sits in memory."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def free_bytes(path=".") -> int:
    return shutil.disk_usage(path).free


def require_free(need_bytes: int, path=".", floor: int = MIN_FREE_BYTES) -> int:
    """Stops before a step that would leave less than `floor` free. Returns the bytes free now."""
    free = free_bytes(path)
    if free - need_bytes < floor:
        raise ConvertError(
            f"not enough disk: {free // MIB} MiB free, the step needs {need_bytes // MIB} MiB "
            f"and {floor // MIB} MiB must stay free"
        )
    return free


def load_manifest(root: Path = ROOT) -> dict:
    return json.loads((root / "models.manifest.json").read_text(encoding="utf-8"))


def manifest_entry(model_id: str, root: Path = ROOT) -> dict:
    """The manifest entry of one model. Refuses a model that is dropped or has no pinned revision."""
    for m in load_manifest(root)["models"]:
        if m["id"] == model_id:
            if m["tier"] == "X":
                raise ConvertError(f"{model_id} is dropped: {m['reason']}")
            if m.get("source", "hub") == "hub" and not REVISION.match(m.get("hubRevision") or ""):
                raise ConvertError(f"{model_id} has no pinned revision; run node scripts/pin-revisions.mjs --write")
            return m
    raise ConvertError(f"{model_id} is not in models.manifest.json; add it first, with its licence")


def snapshot(model_id: str, dest, allow_patterns=None, root: Path = ROOT) -> Path:
    """Downloads the pinned revision of one model into `dest` (only the files that match `allow_patterns`).

    The revision comes from the manifest, never from "main", so a rebuild always starts from the same bytes.
    """
    entry = manifest_entry(model_id, root)
    from huggingface_hub import HfApi, snapshot_download  # heavy import, only here

    info = HfApi().model_info(model_id, revision=entry["hubRevision"], files_metadata=True)
    want = [s for s in info.siblings if not allow_patterns or any(Path(s.rfilename).match(p) for p in allow_patterns)]
    require_free(sum((s.size or 0) for s in want), Path(dest).parent if Path(dest).parent.exists() else ".")
    return Path(snapshot_download(model_id, revision=entry["hubRevision"], local_dir=str(dest), allow_patterns=allow_patterns))


def strip_onnx_metadata(src, dst=None) -> Path:
    """Removes producer, tool and author notes from an ONNX file (John's rule 8). Weights are untouched."""
    import onnx  # heavy import, only here

    src = Path(src)
    dst = Path(dst) if dst else src
    model = onnx.load(str(src), load_external_data=False)
    model.producer_name = ""
    model.producer_version = ""
    model.doc_string = ""
    model.domain = ""
    del model.metadata_props[:]
    model.graph.doc_string = ""
    for node in model.graph.node:
        node.doc_string = ""
    onnx.save(model, str(dst))
    return dst


def quantize_int8(src, dst, per_channel: bool = False) -> Path:
    """Dynamic 8-bit quantisation with onnxruntime, then the notes are stripped. Deletes nothing: the caller removes `src`."""
    from onnxruntime.quantization import QuantType, quantize_dynamic  # heavy import, only here

    src, dst = Path(src), Path(dst)
    require_free(src.stat().st_size, dst.parent)
    quantize_dynamic(str(src), str(dst), weight_type=QuantType.QUInt8, per_channel=per_channel)
    return strip_onnx_metadata(dst)


def remove(*paths) -> None:
    """Deletes intermediates as soon as they are no longer needed (files or folders). Missing paths are fine."""
    for p in paths:
        p = Path(p)
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        else:
            p.unlink(missing_ok=True)


def split_parts(src, out_dir, name: str | None = None, part_bytes: int = MAX_PART_BYTES) -> dict:
    """Splits a file into parts of at most 16 MiB and returns its alef.pack.v1 entry. Same output as scripts/sha256-parts.mjs."""
    if not 0 < part_bytes <= MAX_PART_BYTES:
        raise ConvertError(f"part size must be between 1 and {MAX_PART_BYTES} bytes")
    src, out_dir = Path(src), Path(out_dir)
    name = name or src.name
    out_dir.mkdir(parents=True, exist_ok=True)
    require_free(src.stat().st_size, out_dir)
    whole = hashlib.sha256()
    parts = []
    total = 0
    with open(src, "rb") as f:
        while True:
            h = hashlib.sha256()
            got = 0
            path = f"{name}.p{len(parts):03d}"
            with open(out_dir / path, "wb") as out:
                while got < part_bytes:
                    block = f.read(min(MIB, part_bytes - got))
                    if not block:
                        break
                    out.write(block)
                    h.update(block)
                    whole.update(block)
                    got += len(block)
            if not got:
                (out_dir / path).unlink()
                break
            parts.append({"path": path, "bytes": got, "sha256": h.hexdigest()})
            total += got
    if not total:
        raise ConvertError(f"{src} is empty")
    return {"name": name, "bytes": total, "sha256": whole.hexdigest(), "parts": parts}


def write_pack_list(pack: str, version: str, entries: list, out_dir) -> Path:
    """Writes pack.json (alef.pack.v1) next to the parts."""
    if not re.match(r"^[a-z0-9][a-z0-9-]*$", pack):
        raise ConvertError(f"bad pack name {pack!r}")
    for e in entries:
        for p in e["parts"]:
            if p["bytes"] > MAX_PART_BYTES:
                raise ConvertError(f"{p['path']} is over 16 MiB")
    path = Path(out_dir) / "pack.json"
    path.write_text(json.dumps({"schema": "alef.pack.v1", "pack": pack, "version": str(version), "files": entries}, indent=1) + "\n", encoding="utf-8")
    return path


def check_budget(pack: str, entries: list, root: Path = ROOT) -> int:
    """Fails when the pack's files add up to more than its budget in the manifest. Returns the bytes."""
    packs = load_manifest(root)["packs"]
    if pack not in packs:
        raise ConvertError(f"pack {pack} is not in models.manifest.json")
    total = sum(e["bytes"] for e in entries)
    if total > packs[pack]["budgetBytes"]:
        raise ConvertError(f"pack {pack} is {total // MIB} MiB, over its budget of {packs[pack]['budgetBytes'] // MIB} MiB")
    return total
