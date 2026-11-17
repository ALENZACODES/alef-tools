# alef-tools

![Rimon, a small round pomegranate character, at a workbench with wooden blocks, a mallet and a blank frame](docs/social-preview.png)

Tools for the open Hebrew language models used by ALEF, a Hebrew-learning app
([ALENZACODES/Al-Heb](https://github.com/ALENZACODES/Al-Heb)).

This repo holds the model code: conversion scripts, in-browser loaders, offline
build pipelines, tests, and one manifest that records every model's licence and
pinned revision. The app pulls in a fixed version of what is built here.

Nothing here runs on a server. Models run in the learner's browser, or offline
at build time.

**Start with [`docs/CONTRACT.md`](docs/CONTRACT.md).** It says what a package
exports, how a language pack is split and checked, and how the app pulls it in.

## Project structure

```text
alef-tools/
├── .github/                     # CI workflows (3 files)
├── docs/                        # Contract, licences, sources and QA reports (5 files)
├── packages/
│   ├── handwriting/             # Handwriting recognition (1 file)
│   ├── loader/                  # Shared language-pack loader and cache (23 files)
│   ├── morph/                   # Morphology (1 file)
│   ├── nikud/                   # Vowel marks (1 file)
│   ├── ocr-fix/                 # OCR correction (1 file)
│   ├── offline-llm/             # Offline language model (1 file)
│   ├── speech/                  # Speech (1 file)
│   └── translate/               # Translation (1 file)
├── scripts/                     # Build, manifest, budget and release scripts (14 files)
├── .gitignore
├── LICENSE                      # Licence
├── models.manifest.json         # Every model: licence, pinned revision, tier, pack, files
├── models.manifest.schema.json  # Schema for the manifest
├── package.json                 # npm scripts and dependencies
└── README.md                    # This file
```

## Working here

Node 22 or newer. No `npm install`: there are no dependencies.

```
npm test          unit tests for every package and for the scripts
npm run build     rebuild every packages/<name>/dist from src
npm run check     manifest schema and rules, size budgets, dist freshness
node scripts/pin-revisions.mjs          read every revision and licence tag from the Hub again
node scripts/build-licences.mjs         rewrite docs/LICENCES.md from the manifest
python -m pytest -q scripts/tests_py    tests for the conversion helpers (pip install -r scripts/requirements-ci.txt)
```

## Language packs

A language pack is the set of files a learner chooses to download for one
feature. Packs are converted offline, split into parts of at most 16 MiB with
`scripts/sha256-parts.mjs`, and served as static files from the pack host
(`https://alenzacodes.github.io/alef-packs/`). The manifest lists each part
with its size and SHA-256. **No weights are stored in this repo.**

Publishing a pack:

1. Convert it with the lane's script; the output goes to `out/packs/<pack>/`
   (`pack.json` plus parts). `out/` is ignored by git.
2. Copy that folder to the pack host repo and push it there.
3. List the parts in `models.manifest.json` with their pack-host URLs, set the
   pack's `"published": true`, run `npm run check`.
4. Tag a release. The release workflow attaches the dist archive and the
   manifests. To keep an archive copy of the parts with the release, run
   `node scripts/release.mjs --tag vX.Y.Z` locally and
   `gh release upload vX.Y.Z release-out/packs/*`.

## Releases

Bump `version` in the root `package.json` and in each changed package, run
`npm run build`, commit, then tag `vX.Y.Z`. The tag must match the root
version.

## Licence

Code in this repo is under the MIT licence (see `LICENSE`).

Model weights are **not** covered by that licence. Each model keeps its own
licence, recorded per model in `models.manifest.json` and listed in
[`docs/LICENCES.md`](docs/LICENCES.md). Models with a non-commercial or unclear
licence are not shipped.
