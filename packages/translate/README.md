# translate

Hebrew and English translation that runs in the browser, for the ALEF app (Talk, the camera translator, the live translator).
No server and no outside service: the app downloads a language pack from static hosting when the learner asks, checks it, keeps it,
and translates on the device from then on.

This package is the pack runtime, the pack builder, the scoring tool and the translation memory. The app
([ALENZACODES/Al-Heb](https://github.com/ALENZACODES/Al-Heb)) vendors `dist/` at a pinned commit into
`assets/vendor/_alef-tools/translate@<version>/` and never loads anything from this repository at run time.

## What Is Here

| Path | What it is |
|---|---|
| `src/tokenizer.js`, `src/decode.js`, `src/runtime.js` | Splitting a line into word pieces, the beam search, and the three graphs of a pack put together. The same code runs in the browser and under Node. |
| `src/index.js` | The package entry point the contract asks for: `id`, `version`, `packs`, `load(opts)`, `unload()`. `load` never starts a download. |
| `src/pack.js` | Maps the Talk pack list onto the shared loader (`packages/loader`), which does the downloading, checking and keeping. `createPackStore({ loader, base, cacheName, hostsFile })`. Adds packs that live only on the pack host. |
| `src/client.js`, `src/worker.js` | The page's side and the worker. A direction can be served by the ordinary pack or by a high-quality one. |
| `src/tm.js` | Translation-memory lookup: a small index first, a unit file only when the index says the line is in it. |
| `src/scoring.js` | The house score, accepted wordings and chrF (the same arithmetic as sacreBLEU's chrF2). |
| `scripts/export.py`, `scripts/gpu_graph.py` | A Marian (OPUS-MT) checkpoint to a pack: the word table stored once at 8 bits, an encoder graph and a one-step decoder graph; and the two small graphs that let a graphics card read the same 8-bit weights. |
| `scripts/pack.mjs` | Splits a pack into parts of at most 16 MiB and writes `pack.json` and `manifest.json`. |
| `scripts/score.mjs` | Scores one pack on a test file with the shipped code and the browser's own runtime. |
| `scripts/build-tm.py`, `scripts/tm_gates.py`, `scripts/tm-agree.mjs` | Builds the translation memory from the app's sentences and applies the checks every entry must pass. |
| `packs/he-en-hq.pack.json` | The part list of the high-quality pack as built: every part with its size and SHA-256. The app copies it into `data/talk/pack-host.json`. |
| `dist/` | The files the app vendors: the modules of `src/` with comments taken out, and `dist.json` with their sizes and SHA-256 (written by the repository's `scripts/build-dist.mjs`). |

The pack and manifest formats are the ones the app has read since its first pack (`alef.talk.nmt.pack.v1`,
`alef.talk.nmt.manifest.v1`). Existing pack hosts keep working unchanged. Two optional fields are new on a pack:
`quality: "high"` and `requires: "webgpu"`.

## The Packs

| Pack | Model | Licence | Download | Where it stands |
|---|---|---|---|---|
| `en-he` | `Helsinki-NLP/opus-mt-en-he` | Apache-2.0 | 78.6 MiB | Shipped by the app since 10 November 2026. |
| `he-en` | OPUS-MT Tatoeba heb-eng, `opus-2021-02-19` | Apache-2.0 | 77.2 MiB | Shipped by the app since 10 November 2026. |
| `he-en-hq` | `Helsinki-NLP/opus-mt-tc-big-he-en` | CC-BY-4.0 | 237.6 MiB | Built and scored on 12 November 2026. Not on the pack host yet. |

Pinned revisions, licences and the part lists of the published packs are in `models.manifest.json` at the root of this repository;
the part list of `he-en-hq` is in `packs/he-en-hq.pack.json` until it is published.
`he-en-hq` is offered only on a browser with a real graphics adapter, and only when the learner asks for it.
The app must show the attribution line of `models.manifest.json` for it on its credits page.

### Scores (12 November 2026)

Each pack alone, on the app's held-out file (`tests/fixtures/talk.heldout.json` in the app, 120 lines each way), WebAssembly, beam of 2,
measured with `scripts/score.mjs`:

| Pack | First-choice wording | Accepted wordings | chrF | Seconds a line (2-core test machine) |
|---|---|---|---|---|
| `he-en` | 70.0 | 90.9 | 69.4 | 0.43 |
| `he-en-hq` | 77.5 | 94.6 | 75.1 | 0.89 |
| `en-he` | 83.2 | 97.8 | 86.4 | 0.34 |

What the app shows also passes through its stored lines; those scores are in the app's `docs/talk/README.md`.
Not measured: a real graphics card, a phone, and a native speaker's reading of any line.

## Rebuild A Pack

```
python3 -m venv venv && . venv/bin/activate
pip install --index-url https://download.pytorch.org/whl/cpu torch==2.15.0
pip install -r scripts/requirements.txt
# the pinned snapshot (revision from models.manifest.json)
python3 -c "from huggingface_hub import snapshot_download as d; d('Helsinki-NLP/opus-mt-tc-big-he-en', revision='134c5a850dcaa763eec85bd1f4eb25112fecedbb', local_dir='ckpt')"
python3 scripts/export.py ckpt out/he-en-hq --check --keep-fp32
python3 scripts/gpu_graph.py out/he-en-hq
# <ort> is a folder with ort.wasm.min.mjs and ort-wasm-simd-threaded.wasm (onnxruntime-web 1.31.1; in the app: assets/vendor/_ort)
node scripts/pack.mjs split out/he-en-hq he-en-hq --out packs --direction he-en --model "OPUS-MT tc-big he-en (Helsinki-NLP/opus-mt-tc-big-he-en)" \
     --licence CC-BY-4.0 --revision 134c5a850dcaa763eec85bd1f4eb25112fecedbb --quality high --requires webgpu
node scripts/pack.mjs probe he-en-hq --out packs --ort <ort>
node scripts/score.mjs <app>/tests/fixtures/talk.heldout.json --packs packs --ort <ort> --pack he-en-hq
```

The export needs about 5 GB of memory and 2 GB of disk for the big model, and a few minutes on two cores. Delete `out/` afterwards.
To publish: copy the built `packs/he-en-hq/` folder to `_nmt/he-en-hq/` on the pack host (ALENZACODES/alef-packs), fill the model's `files`
and set `"published": true` for `translate-he-en-hq` in `models.manifest.json`, then set `"published": true` for it in the app's
`data/talk/pack-host.json`. Weights are never committed to git.

## The Translation Memory

`scripts/build-tm.py` walks the everyday-sentence areas of the app's data and writes one English line for each Hebrew sentence.

- A sentence that already has English in the app keeps that wording.
- A sentence with no English is translated offline by the high-quality model.
- A line that holds the four-letter Name is held: never translated, never stored.
- Scripture, prayer and cited source lines are left out. Those screens quote and cite.
- The vocabulary's example sentences are left out. They come from Tatoeba (CC BY 2.0 FR), which asks for a credit on every sentence, and a memory answer has no place to show one.

Every entry must pass the rule checks (shape, numbers, person, singular and plural; the number forms and noun plurals are the app's own,
from `data/talk/pack.json`). A machine-made entry must also survive a round trip through the English to Hebrew model and agree with the
ordinary Hebrew to English pack. An entry that fails goes to `review/tm-needs-human.json` with the reason, and not into the app.

```
python3 scripts/build-tm.py --app <app> --out <app>/data/talk/tm --review review --hq ckpt --back ckpt-en-he --cache tm-cache.json
node scripts/tm-agree.mjs tm-cache.json --packs <packs> --ort <ort>
python3 scripts/build-tm.py --app <app> --out <app>/data/talk/tm --review review --cache tm-cache.json
```

The build of 12 November 2026: 918 different sentences (lessons, little books, the Israel course, games); 885 kept (876 with the app's own
English, 9 machine-made); 33 turned down and listed for review (23 machine-made, 10 where the app's own English failed a rule check, most of
them free wordings); 118 lines held for the Name and 42 scripture or prayer lines left out. Four unit files, the largest 27.7 KiB; the index
is 5.5 KiB.

Known limit: a pointed lesson line loses its vowel letters' help when the points are dropped (הָאִחוּר becomes האחור), and the models then
misread some words. That is why half of the machine-made lines were turned down by the round trip.

## Tests

```
npm test                                                       # from the repository root: every package under Node, nothing installed
ALEF_TEST_DIST=1 node --test "packages/*/tests/*.test.js"      # the same tests against the built dist/
python -m pytest -q scripts/tests_py                           # includes the sentence-memory checks of this package
node scripts/build-dist.mjs --check && node scripts/check-manifest.mjs && node scripts/check-budgets.mjs
```

The tests assert that the browser code names no address of its own, that a download asks only the site and the pack host,
that a pack that is not published is not listed, and that `load()` rejects with `not-downloaded` before any pack file is asked for.
Tests that run the real packs live in the app repository, where the packs and the runtime are.

## Sizes

`dist/` is 9 modules, 32.9 KB, 12.8 KB gzipped. In the app none of it is part of the first install (`"alef": { "firstInstall": [] }`):
every file is fetched when the Talk or Camera screen first opens.

## Where This Differs From The First Plan

- The manifest first listed `translate-he-en-hq` in the newer `alef.pack.v1` format with a cache of its own. It is built in the Talk
  pack format instead, in the Talk cache: its two graphics-card graphs read their weights out of the 8-bit files by byte range, the
  worker and the runtime already read that layout, and the brief for this package asks to keep the format so existing hosts keep working.
  `models.manifest.json` now says so (`format`, `cache`, `legacy`).
- `onnx-community/opus-mt-mul-en` (the baseline for the scoring tool) was not run: `scripts/score.mjs` reads the Talk pack layout only.
- The Hebrew to English pack shipped since 10 November was not rebuilt: it is a Marian-format release and needs a conversion step that is not here yet.
- Open question on a licence: the app records the shipped Hebrew to English pack (Tatoeba heb-eng, `opus-2021-02-19`) as Apache-2.0. The Tatoeba
  Translation Challenge describes its models as CC BY 4.0. Both allow this use; if it is CC BY the pack needs a credit line, which is one
  `attribution` field in `models.manifest.json`. The licence was not re-read at the source in this lane.
