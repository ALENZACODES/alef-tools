#!/usr/bin/env python3
"""Download the pinned model files this lane uses and, with --convert, make the two GGUF files llama.cpp needs.

    python scripts/fetch_models.py gen-1.7b judge-1.7b-thinking heq --convert

Files land in $ALEF_MODELS (default ~/.cache/alef-tools/models)/<key>/. Every file with a hash in
models.manifest.json is checked after download. Nothing is downloaded that is not named on the command line.
Set LLAMA_CPP to a llama.cpp checkout for --convert (its convert_hf_to_gguf.py and convert_lora_to_gguf.py).
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import manifest_model, sha256_file  # noqa: E402

MODELS = Path(os.environ.get("ALEF_MODELS", Path.home() / ".cache" / "alef-tools" / "models"))
SMALL = ["config.json", "tokenizer.json", "tokenizer_config.json", "vocab.txt", "vocab.json", "merges.txt", "added_tokens.json",
         "special_tokens_map.json", "generation_config.json", "chat_template.jinja", "modules.json", "sentence_bert_config.json",
         "config_sentence_transformers.json", "1_Pooling/config.json", "source.spm", "target.spm", "tokenizer.model",
         "modeling_neobert.py", "BertForJointParsing.py", "BertForPrefixMarking.py", "BertForSyntaxParsing.py", "BertForMorphTagging.py"]


def model_dir(key: str) -> Path:
    return MODELS / key


def _get(repo: str, revision: str, name: str, dest: Path, *, optional: bool) -> bool:
    """Download one file of a pinned revision with curl (resumes a partial file). Returns False for an optional file the repo lacks."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://huggingface.co/{repo}/resolve/{revision}/{name}"
    for attempt in range(4):
        r = subprocess.run(["curl", "-sSL", "--fail", "-C", "-", "-o", str(dest), url], capture_output=True, text=True)
        if r.returncode == 0:
            return True
        if "404" in r.stderr and optional:
            dest.unlink(missing_ok=True)
            return False
        if r.returncode == 33 or "416" in r.stderr:  # nothing left to resume: the file is already complete
            return True
    raise SystemExit(f"could not download {url}: {r.stderr.strip()}")


def fetch(key: str) -> Path:
    m = manifest_model(key)
    out = model_dir(key)
    main = [f["name"] for f in m["files"]]
    for name in SMALL:
        if name not in main and not (out / name).exists():
            _get(m["id"], m["revision"], name, out / name, optional=True)
    for f in m["files"]:
        p = out / f["name"]
        if not (p.exists() and f.get("bytes") and p.stat().st_size == f["bytes"]):
            _get(m["id"], m["revision"], f["name"], p, optional=False)
        if f.get("sha256"):
            got = sha256_file(p)
            if got != f["sha256"]:
                raise SystemExit(f"{key}: {f['name']} has SHA-256 {got}, the manifest says {f['sha256']}")
        print(f"{key}: {f['name']} {p.stat().st_size} bytes" + (" (hash ok)" if f.get("sha256") else f" sha256 {sha256_file(p)} (no hash in the manifest yet)"), flush=True)
    return out


def convert(key: str) -> None:
    m = manifest_model(key)
    made = (m.get("gguf") or {}).get("made_by")
    if not made:
        return
    llama = Path(os.environ.get("LLAMA_CPP", "llama.cpp"))
    out = model_dir(key) / m["gguf"]["file"]
    if out.exists():
        print(f"{key}: {out.name} already made")
        return
    env = dict(os.environ, PYTHONPATH=str(llama / "gguf-py") + os.pathsep + os.environ.get("PYTHONPATH", ""))
    if "convert_lora_to_gguf" in made:
        base_id = manifest_model(m["base"])["id"].removesuffix("-GGUF")  # the adapter was trained on the unquantised base
        cmd = [sys.executable, str(llama / "convert_lora_to_gguf.py"), str(model_dir(key)), "--outfile", str(out), "--outtype", "f16", "--base-model-id", base_id]
    else:
        cmd = [sys.executable, str(llama / "convert_hf_to_gguf.py"), str(model_dir(key)), "--outfile", str(out), "--outtype", "q8_0"]
    subprocess.run(cmd, check=True, env=env)
    print(f"{key}: made {out.name} {out.stat().st_size} bytes sha256 {sha256_file(out)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("keys", nargs="+")
    ap.add_argument("--convert", action="store_true")
    ap.add_argument("--drop-source", action="store_true", help="after --convert, delete the source weights to save disk")
    a = ap.parse_args()
    for k in a.keys:
        fetch(k)
        if a.convert:
            convert(k)
            if a.drop_source and (manifest_model(k).get("gguf") or {}).get("made_by"):
                for f in manifest_model(k)["files"]:
                    if f["name"].endswith(".safetensors"):
                        (model_dir(k) / f["name"]).unlink(missing_ok=True)
