#!/usr/bin/env bash
# Downloads the recordings of the scoring set (FLEURS, Hebrew, dev split; CC-BY-4.0, Google) at the pinned dataset revision.
# About 153 MB. The recordings are not kept in this repository; eval/fleurs-he-dev.json lists them with their text.
#   bash scripts/fetch-eval.sh <folder>      then pass  --audio <folder>/dev  to scripts/eval.mjs and scripts/eval-pron.mjs
set -euo pipefail
out="${1:?usage: fetch-eval.sh <folder>}"
rev=70bb2e84b976b7e960aa89f1c648e09c59f894dd
mkdir -p "$out"
curl -fsSL --retry 3 -o "$out/dev.tar.gz" "https://huggingface.co/datasets/google/fleurs/resolve/$rev/data/he_il/audio/dev.tar.gz"
echo "3752e56b764bd0ed531afa805aa589cf4153d9585a3c034faafbf6c852663652  $out/dev.tar.gz" | sha256sum -c -
tar -xzf "$out/dev.tar.gz" -C "$out"
rm "$out/dev.tar.gz"
echo "recordings in $out/dev: $(ls "$out/dev" | wc -l)"
