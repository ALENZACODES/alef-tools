# packages/handwriting

Letter check for the tracing screens. A learner draws a Hebrew letter; this says which letter the drawing looks like and
gives one thing to fix. It runs in the browser, on the device, with no connection.

- 27 letter forms (22 letters and the 5 final forms) plus "not a letter".
- One small model, `letters.onnx`: 1,311,488 bytes (1.25 MiB), plain float32, 328,036 weights. Budget: 2 MiB.
- Two ways to run the same file: a runner written in plain JavaScript inside `src/classify.js` (nothing else to download),
  or onnxruntime-web when the caller passes it in (`load({ ort })`). They give the same answer (largest difference seen: 3.7e-9).
- The check is a hint, never a grade. When it is not sure it says nothing.

Lane 6. Follows `docs/CONTRACT.md` (contract 1).

## What is here

| Path | What |
|---|---|
| `src/preprocess.js` | strokes or canvas pixels → the 32×32 picture the model reads |
| `src/classify.js` | model file reader, the built-in runner, `createClassifier()` |
| `src/feedback.js` | scores → at most one sentence for the learner (`checkLetter`, `checkWord`), the tips |
| `src/index.js` | package entry in the contract's shape: `id`, `version`, `packs`, `load()`, `unload()` |
| `dist/` | the same four modules with comments taken out, plus `dist.json` (built by the shared `node scripts/build-dist.mjs` at the repo root) |
| `scripts/render_fonts.py` | builds the training and test arrays |
| `scripts/train.py`, `export.py`, `eval.py` | train, write `letters.onnx`, score it |
| `scripts/make_fixtures.py` | the small fixtures the JavaScript tests read |
| `scripts/bench_trocr.py` | outside-model benchmark, QA only |
| `fonts/fonts.json`, `fonts/LICENSES.md` | every font used for training, pinned by commit and SHA-256, with its licence; the dataset credit |
| `eval/v1.json` | every number quoted below, with the model's SHA-256 |

## Using it

```js
import { load } from './dist/index.js';
const hw = await load({ loader });                 // pack must already be on the device; never downloads
// or, when the app keeps the files itself:  await load({ model, manifest })
const r = await hw.checkStrokes(strokes, { targetId: 'dalet', script: 'print', strokeWidth: 85, heights });
r.verdict   // 'match' | 'close' | 'looks-like' | 'not-a-letter' | 'unsure'
r.text      // "This looks more like Resh (ר). In Dalet the top line reaches a little past the leg on the right. ..." or null
```

Yod, Vav and Final Nun are the same line at three lengths. The picture the model reads has no size in it, so for these
three the drawn height decides (`heights` = the height of each one's own model on the tracing screen).

`load({ loader, bases })` uses the shared loader (`packages/loader`: `packState`, `readFile`, `cacheName`, `PackError`) and is
tested against the real one (`tests/index.test.js`): the loader downloads a pack into a stand-in cache, then `load()` reads it
back with the network off. The app-side code in Al-Heb keeps the files in the same cache and passes the bytes directly.
Classifying takes a few milliseconds, so it runs on the page, not in a worker.

## The numbers (model 1, 2026-11-12; full detail in `eval/v1.json`)

Held-out real handwriting: **HHD_v0 TEST**, 1,134 single cursive letters cut from hand-filled forms. Never trained on,
and not used to pick the checkpoint (that used a tenth of the training data).

| | Bar | Measured |
|---|---|---|
| Top-1, real handwriting (HHD_v0 TEST, n=1,134) | ≥ 95% | **84.1%** (top-3 94.6%). Not met. |
| Same, with Yod / Vav / Final Nun counted as one | | 86.6% |
| ב / כ (n=90) | ≥ 90% | 85.6% right out of all 28; 97.8% when choosing only between the two |
| ד / ר (n=90) | ≥ 90% | 84.4%; 100% between the two |
| ה / ח (n=90) | ≥ 90% | 88.9%; 96.7% between the two |
| ו / ז / ן (n=123) | ≥ 90% | 75.6%; 84.6% among the three |
| ס / ם (n=76) | ≥ 90% | 86.8%; 98.7% between the two |
| Letters from three fonts never trained on (n=405) | | 90.4% (top-3 99.8%); 95.8% with Yod / Vav / Final Nun as one |
| The app's own 54 letter models, drawn as stored | | 54 of 54 read as themselves (they were in training with wobble: a sanity check, not a held-out score) |
| Model size | ≤ 2 MiB | 1.25 MiB |
| Time per letter | < 30 ms on a mid phone | built-in runner 16 ms, onnxruntime-web (WASM, 1 thread) 2.0 ms, both on a 2-vCPU cloud machine under Node 22. **No phone was measured.** |

What this means, plainly:

- The 95% and 90% bars are **not met** on real handwriting. For scale, the dataset's own paper reports 72.6% to 84.9% for
  its three baseline networks on this split.
- Most of the misses are letters that differ only in length once a letter is cut out and resized (Final Nun read as Vav,
  Vav as Yod, Final Kaf as Dalet). On the tracing screen the drawn height is known, and the app uses it for Yod / Vav / Final Nun.
- HHD is adult cursive handwriting on paper. Learners here trace with a finger over a model, in print or cursive. No real
  learner tracings have been collected, so accuracy on the real thing is unknown. That is why the check only speaks when it
  is confident, never changes a score, and never tells a learner that an accepted letter is "wrong".

### Outside benchmark (QA only)

`sivan22/testing-trOCR-hebrew-handwritten` at revision `419f9f0b3a76c20254e17a9a1722f91c588420f6` (no licence on the Hub,
marked "testing": never shipped). **It gave no score.** 543 of the 558 tensors in the published `pytorch_model.bin`
(964,560,765 bytes, SHA-256 `4bc9b38745a16b4f2b5333edc8e6576c0712e325603b82c71fbf54831c9e2606`) hold NaN or infinite
values, so it writes nothing for any image. `scripts/bench_trocr.py` is kept so the run can be repeated if the file is fixed.
`Xenova/trocr-small-handwritten` (MIT) was listed as a reference only; it was not downloaded or used.

## Licence

Code: MIT (repo `LICENSE`). The model was trained here from letters drawn with OFL-1.1 fonts, the app's own stroke models
and the HHD_v0 dataset (CC BY 4.0, credit line in `fonts/LICENSES.md`, shown on the app's credits page). The model file
carries no producer, tool or author notes. No font or dataset file is stored in this repo.

## Rebuild

```sh
pip install -r scripts/requirements.txt
# HHD_v0: download hhd_dataset.rar from https://doi.org/10.5281/zenodo.4287442, unpack to build/hhd_dataset (TRAIN/, TEST/)
python scripts/render_fonts.py --out build/data --strokes ../../../Al-Heb/data/letters/letters.json --hhd build/hhd_dataset
python scripts/train.py --data build/data --out build/run --width m --epochs 60      # about 30 minutes on 2 cores
python scripts/export.py --ckpt build/run/best.pt --out build/pack
python scripts/eval.py --model build/pack/letters.onnx --data build/data --out build/pack/eval.json
# from the repo root: the language pack folder (pack.json + parts), then dist/ and the tests
node scripts/sha256-parts.mjs --pack handwriting --version 1 --out packages/handwriting/build/pack/out packages/handwriting/build/pack/letters.onnx packages/handwriting/build/pack/model.json
node scripts/build-dist.mjs && npm test
```

Training is seeded but not bit-for-bit repeatable across machines; the shipped file is pinned by SHA-256 in
`models.manifest.json`. Run `python scripts/make_fixtures.py` after any change to `common.py` or `train.py`. Model files are
never stored in this repo. The pack built on 2026-11-12 is carried by the app
itself (Al-Heb `assets/vendor/_packs/handwriting/`); it has not been uploaded to the pack host.

## Not done

- No learner tracings were collected, and no phone timing was taken.
- The tips describe print letters; for cursive only the length tips (Yod / Vav / Final Nun) are specific. Every tip needs a
  Hebrew teacher's eye before it is treated as checked (list: `src/feedback.js`, `SIZE_TIPS` and `PRINT_TIPS`).
- The onnxruntime-web path is tested under Node only; the app uses the built-in runner.
