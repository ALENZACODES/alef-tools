# packages/speech

Hebrew listening on the device for ALEF (Lane 2): speech to text, and a letter-by-letter pronunciation check.
It replaces the browser's own speech recognizer, which may send the sound to the browser maker. Here the sound goes to a
worker on the same device and nowhere else.

Read `docs/CONTRACT.md` first. This package follows it: it exports `id`, `version`, `packs`, `load(opts)` and `unload()`,
it never starts a download, and its packs are `alef.pack.v1` lists fetched by the shared loader.

## Packs

| Pack | What it is built from | Size as built | Budget | Runs on |
|---|---|---|---|---|
| `listen-lite` | onnx-community/whisper-base: 4-bit encoder, 8-bit merged decoder | 73,331,643 bytes (69.9 MiB), 8 parts | 80 MiB | any device, WebAssembly |
| `listen-best` | ivrit-ai/whisper-large-v3-turbo-onnx: q4f16 encoder and merged decoder | 564,217,171 bytes (538.1 MiB), 37 parts | 580 MiB | a computer with a graphics card (WebGPU) |
| `pron-check` | XDcobra/wav2vec2-large-xlsr-53-hebrew-ONNX, re-exported here to 4-bit weights | 208,215,471 bytes (198.6 MiB), 15 parts | 360 MiB | computer or strong phone, WebAssembly |

The published 8-bit letter model is 355 MB. `scripts/export.py shrink-ctc` rebuilds it from the fp32 graph with 4-bit
MatMul weights and 16-bit convolution weights. It scores the same as the 8-bit file on the set below (plain reading
22.6% against 22.5% character error; letter check within one point).

`packs/<pack>.pack.json` is the list of each pack as built (every part with its size and SHA-256).
**The parts themselves are not published yet.** They go to the static pack host
(`https://alenzacodes.github.io/alef-packs/<pack>/`); until they are there the packs stay `"published": false` in
`models.manifest.json` and the manifest's `files` stay empty. `listen-mid` (whisper-small) was not built.

Licences: all three source models are Apache-2.0 (`docs/LICENCES.md`). The ivrit-ai ONNX port has no model card and no
licence tag on the Hub (checked on Nov 12, 2026), so its licence is recorded from its source model,
ivrit-ai/whisper-large-v3-turbo.

## What was measured

Scoring set: FLEURS, Hebrew, dev split (CC-BY-4.0, Google; 328 recordings of native speakers reading sentences).
`eval/fleurs-he-dev.json` lists the recordings; `scripts/fetch-eval.sh` downloads them. "Short" means at most 12 words and
8 seconds (81 recordings). These are read sentences from an encyclopedia, **not learner phrases**: there is no public set of
learners' Hebrew with a clear licence, and no recordings from ALEF learners who agreed to it exist yet.
The scripts run the same code the app runs, with onnxruntime-node in place of the browser runtime.

| Pack | Set | Character error | Word error | Result file |
|---|---|---|---|---|
| `listen-lite` | FLEURS short, 81 lines | 30.1% | 74.2% | `eval/results/listen-lite.fleurs-short.json` |
| `listen-best` | FLEURS short, 81 lines | 8.6% | 22.0% | `eval/results/listen-best.fleurs-short.json` |

Against the lane's bar (best at most 12%, quick at most 30%, on short learner phrases): on this stand-in set the best pack
is inside it and the quick pack is a hair over (30.1%). Neither was measured on learner phrases. Other sizes of the quick
model on the same 81 lines: 8-bit encoder 31.5%, full fp32 (291 MB, over budget) 27.9%. The quick pack makes many word
mistakes on full sentences; it is meant for a word or a short phrase.

Letter check (`eval/results/pron-check.fleurs.json`, 327 recordings, 15,390 checked letters): the recordings were read
correctly, so letters of the expected text were changed and the check should mark exactly those
(`scripts/eval-pron.mjs` explains the method). On the half of the lines not used to choose the threshold:

| Changed letters | Precision | Recall | F1 |
|---|---|---|---|
| near: a sound learners confuse (resh/lamed, dalet/tav, ...) | 0.67 | 0.85 | 0.75 |
| far: any other consonant | 0.71 | 0.91 | 0.80 |

On correctly read speech 4.8% of checked letters are marked. This is a stand-in for learner mistakes, not a measurement
of them.

What the letter check cannot do, by design of the model (it writes unpointed letters):

- **Vowels, shva and stress are not checked.** A character model has no way to show them.
- **Letters that sound the same in Israeli Hebrew are never told apart**: het and khaf, alef and ayin, tav and tet,
  kaf and qof, samekh and sin, vet and vav. They share credit instead, so a correct reading is never marked down.
- Vav and yod as vowels, final he, alef, ayin and he are reported as "skip", with the reason.
- A valid reading of the learner's tradition is accepted: Ashkenazi tav without a dot read as "s", Sephardi tsadi read
  as "s". These two rules are in `src/score.js`; they were written from the app's consonant table and need a check by
  someone who reads in each tradition.
- The Name is never scored: whatever is said in its place is accepted, its own letters are not reported, and the one
  letter on each side of it is skipped. Nothing in this package plays sound.
- Expected phonemes from Lane 3 (phonikud) are not wired in: that package did not exist when this was built. The check
  works from pointed Hebrew; unpointed vav and yod are skipped.

Speed, on the app's vendored onnxruntime-web (WebAssembly, one thread) run in Node on a 2-core machine:
`listen-lite` loads in about 2 s and answers a 3 s take in about 6 s; `pron-check` loads in about 3 s, answers a 3 s take in
about 5 s and a 16 s take in about 23 s, and holds about 1.3 GB of memory.
In a real browser (headless Chrome 153 on the same machine, a recording played as the microphone, packs served from the
site's own folder): both packs downloaded and passed their checks, a 3 s take was written down in about 9 s including
the first load, and the letter check marked the one letter that had been changed in the expected text (about 8 s).
No phone was tested. **`listen-best` has not been run in any browser or on WebGPU**: it was scored on a processor only.

## Use

```js
import * as loader from '../loader@0.1.0/index.js';
import * as speech from './index.js';

// on the learner's tap (never on its own):
await loader.downloadPack('listen-lite', { bases: speech.packBases(), userStarted: true, onProgress });

const listen = await speech.load({ loader, pack: 'listen-lite', ortBase: '/assets/vendor/_ort/' });
const pcm = await speech.decodeTake(recordedBlob);          // 16 kHz mono, decoded on the device
const heard = await listen.transcribe(pcm);                 // { ok, text, confidence, speechMs, ms }
const english = await listen.transcribe(pcm, { language: 'en' });

const check = await (await speech.load({ loader, pack: 'pron-check', ortBase: '/assets/vendor/_ort/' }))
  .score(pcm, 'שָׁלוֹם', { tradition: 'ashkenazi' });       // { ok, letters: [{ index, ch, status, heard }], score }
await speech.unload();
```

`load` rejects with `PackError('not-downloaded')` when the pack is not on the device and with `PackError('cannot-run')`
when `listen-best` is asked for on a device without a graphics card. The microphone is the app's business: this package
never opens it.

## Files

- `src/audio.js` resampling to 16 kHz mono, a loudness gate that finds where speech starts and ends, WAV reading.
- `src/mel.js` the log-mel picture Whisper reads (checked against the reference feature extractor in `tests/mel.test.js`).
- `src/tokens.js`, `src/whisper.js` greedy decoding with the language fixed, answers kept to Hebrew letters.
- `src/ctc.js`, `src/ctc-align.js`, `src/score.js` the letter model, alignment and the pronunciation feedback.
- `src/asr-worker.js` the worker; `src/index.js` the package entry.
- `scripts/export.py` fetch pinned files, shrink the letter model, build packs. `scripts/sources.json` what each pack is built from.
- `scripts/eval.mjs`, `scripts/eval-pron.mjs`, `scripts/smoke-pack.mjs` scoring, and a run of a built pack through the loader and the worker.
- `scripts/audit-clips.py` offline check of the app's shipped clips (below).

## Rebuild

```
pip install -r packages/speech/scripts/requirements.txt
python packages/speech/scripts/export.py fetch --work work/speech          # about 2.3 GB, checked against scripts/sources.json
python packages/speech/scripts/export.py pack --work work/speech --out out # writes out/<pack>/ and packs/<pack>.pack.json
bash packages/speech/scripts/fetch-eval.sh work/eval
node packages/speech/scripts/eval.mjs --model work/speech/listen-lite --encoder encoder_model_q4.onnx \
  --decoder decoder_model_merged_int8.onnx --set packages/speech/eval/fleurs-he-dev.json --audio work/eval/dev --subset short
node packages/speech/scripts/smoke-pack.mjs --packs out --pack listen-lite --ort <Al-Heb>/assets/vendor/_ort --wav work/eval/dev/<file>.wav
```

The scoring scripts need `onnxruntime-node` (`npm i onnxruntime-node@1.31.1` in a scratch folder, then `--ort <that folder>`).
It is not a dependency of this repo. To publish: upload each `out/<pack>/` folder as it is to the pack host, then list the
parts in `models.manifest.json` and set `"published": true`.

## Clip audit (offline)

`scripts/audit-clips.py` writes down every Hebrew clip in the app's audio catalogue with ivrit-ai/whisper-large-v3-ct2
(pinned) and lists the clips whose words do not match their text, and any clip where the Name may have been read as
written. It changes nothing in the app. The catalogue has tens of thousands of clips, so it runs in shards:
`.github/workflows/clip-audit.yml` (started by hand) does that and uploads `clip-audit.json`.
**The full audit has not been run.**

## Tests

`node --test "packages/speech/tests/*.test.js"` (and again with `ALEF_TEST_DIST=1` against `dist/`).
`tests/no-upload.test.js` checks that nothing in the package can send data or open the microphone, and runs the real
worker end to end: the only requests in the whole run are plain GETs for pack files and the runtime.
