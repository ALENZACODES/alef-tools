# packages/nikud

Vowel marks (nikud) and a sound line for any Hebrew text, on the learner's device, and vowel marks made ahead of
time for the ALEF app's own bare sentences. Lane 3 of the open Hebrew models plan. Follows `docs/CONTRACT.md`.

| | |
|---|---|
| Package | `@alef-tools/nikud` 0.1.0 · `dist/index.js` exports `id`, `version`, `packs`, `load`, `unload`, `onDevice` |
| Pack `nikud` | dicta-il/dictabert-large-char-menaked, CC-BY-4.0, 8-bit: **303.1 MiB**, 19 parts (budget 320 MiB) |
| Pack `phonemes` | Phonikud/phonikud-onnx, MIT, 8-bit as published, tool notes stripped: **293.6 MiB**, 19 parts (budget 310 MiB) |
| Runtime | the app's vendored onnxruntime-web (`assets/vendor/_ort`), WebAssembly, one thread. No graphics-card build yet |
| Code in `dist/` | 26810 bytes in 7 modules; none of it is in the app's first install |
| Built marks | `dist/nikud/<unit>.json`: 148 units, 13161 lines, largest file 83 KiB (limit 300 KiB) |
| Published | **No.** The packs are built and checked here but are not on the pack host, so both stay `"published": false` |

## What it does

```js
import * as nikud from '<vendored>/nikud@0.1.0/index.js';
const marks = await nikud.load({ loader, pack: 'nikud', ortBase });     // rejects with PackError('not-downloaded') if the pack is not on the device
(await marks.point('שלום, מה שלומך?')).text;                              // 'שָׁלוֹם, מָה שְׁלוֹמְךָ?'
const sounds = await nikud.load({ loader, pack: 'phonemes', ortBase });
(await sounds.sounds('שלום, מה שלומך?')).phonemes;                         // 'ʃaˈlom, ma ʃlomˈχa?'
await nikud.onDevice({ loader, pack: 'nikud' });                          // true or false, no network
```

`load` never downloads. The app calls `loader.downloadPack('nikud', { userStarted: true, ... })` from a button.
The graphs run in `worker.js`; it reads the parts from `alef-pack-<name>-v1` with `loader.readFile`.

Rules the code keeps, each with a test:

- **Letters never change.** The model's own default drops vowel letters (לימודיו → לִמּוּדָיו); here they stay and take
  the vowel they stand for, the way pointed full spelling is printed (לִימּוּדָיו, בּוֹקֶר, מְיוּחָד).
- **A word that already has vowel points keeps them.** Only bare words are pointed.
- **Text with cantillation marks comes back as it came** from `point()`. The model card says the model is for modern
  prose and not for Biblical or Rabbinic text; nothing in this package runs it over Torah or prayer text.
- **The divine Name is written ה׳** (bare, pointed, with prefixes, or the two-yod form). A text that holds it gets no
  sound line, and the phoneme pack is never asked about it.
- The sound line is everyday Israeli speech with the stress sign. The rules that turn Phonikud's marks into sounds are
  in `src/phonikud.js` and are our own. Tradition respelling (Sephardi, Ashkenazi) is done by the app on top.

## Measured (all files in `review/`, all scripts in `scripts/`)

### 1. Against the app's own pointed text (`review/accuracy.json`, `scripts/eval_accuracy.py`)

The app's points are stripped, the bare text goes through the model, the result is compared word by word.
App commit `a5c89906d1f0`. 404 sentences, 2000 headwords. The divine Name is left out of every count.

| Build | everyday sentences, words right (301 words) | same, words in full spelling (276) | same, letters right | lesson lines incl. prayer lines (1346 words) | headwords alone (2077) |
|---|---|---|---|---|---|
| full precision (offline build) | 93.4% | 95.3% | 96.8% | 79.6% | 51.0% |
| 8-bit (the `nikud` pack) | 93.4% | 95.3% | 96.9% | 79.3% | 51.3% |
| 4-bit (not shipped) | 93.4% | 95.3% | 96.8% | 79.2% | 51.3% |
| Phonikud 8-bit (the `phonemes` pack) | 93.4% | 95.3% | 96.7% | 79.3% | 51.1% |

**The acceptance bar (95% for the pack, 97% for the offline build) is not met on the app's text as it is written.**
Two things explain most of the gap, and neither is something a model can undo from bare letters:

- The app writes pointed words in short spelling (סֻכָּר, בֹּקֶר, שֻׁלְחָן). Without points those letters spell other
  words (סכר, בקר, שלחן), so the model reads a different word. Everyday unpointed Hebrew is written in full spelling
  (סוכר, בוקר, שולחן), which is what the model is made for.
- The same bare line stands for a man's and a woman's form (רוֹצֶה / רוֹצָה, אִתְּךָ / אִתָּךְ), and the app has both.

A single headword with no sentence around it is the hardest case (ברח can be בָּרַח or בְּרַח), and prayer lines are
outside what the model is for. The misses are listed in `review/accuracy.json` for a person to read.

### 2. What is lost by making the model smaller (`review/build-agreement.json`, `scripts/compare_builds.py`)

300 everyday unpointed sentences from the app's vocabulary examples (1457 words). Share of words pointed
exactly as the full-precision model points them:

| Build | size | words the same | whole lines the same |
|---|---|---|---|
| 8-bit (shipped) | 303.1 MiB | 98.5% | 279 of 300 |
| 4-bit (not shipped) | 193.7 MiB | 98.0% | 272 of 300 |
| third-party 8-bit port, for comparison only | 303.2 MiB | 98.7% | 281 of 300 |

The 4-bit build meets the 200 MiB aim (193.7 MiB) and stays close to the full model, but on the browser
runtime it took about three times as long per sentence, so the 8-bit build is the pack. The 8-bit build uses signed
weights with one scale per channel: an earlier build with unsigned weights agreed on fewer words (98.0%) and ran three
times slower on a desktop processor. On the browser runtime (one thread) the two took the same time.

### 3. The whole chain in Node (`review/e2e-node.json`, `scripts/e2e_node.mjs`)

The real pack lists and parts → the shared loader's download (every part checked) → `load()` → `worker.js` → the app's
vendored onnxruntime-web (WebAssembly, one thread) → pointed text, run from the built `dist/`.
`nikud`: load 2038 ms, 477 ms a sentence. `phonemes`: load 1389 ms, 439 ms a sentence.
Peak memory of the Node process with both packs 2128 MiB. This was a 2-core cloud machine, not a phone, and
not a browser: **no browser run was done in this lane.**

### 4. The app's own pronunciation rules against the phoneme pack (`review/phoneme-agreement.json`, `scripts/agree_rules.mjs`)

6063 app words; the pack pointed 2947 of them the way the app does, and those were compared.

- Kamatz katan: 12 agree, 0 only in the app, 0 only in the pack.
  3 words of the app's kamatz katan lists were pointed differently by the pack and could not be compared; they are listed.
- Shva: 1085 agree, 337 differ. The app's rules describe careful synagogue reading and the pack marks
  everyday speech, so most differences are by design (זְמַן: the app sounds the shva, the pack does not). The list also shows
  the app sounding the shva of חָכְמָה and תָּכְנִית by its long-vowel rule although the vowel before it is kamatz katan.
- Dagesh: 22865 of 24117 letters the same (94.8%), counted over every word, including the ones the pack read as a different word.

Nothing in the app was changed by any of this.

## Vowel marks made ahead of time (`src/nikud/`, copied to `dist/nikud/`)

`scripts/build_nikud_json.py` reads an Al-Heb checkout (commit `a5c89906d1f0`) and writes one file per unit:
`vocab-<pack>` (146 units: each headword and its example sentence), `talk` (the stored Talk lines) and
`lessons` (pointed lines under `data/curriculum`). Each line is `{t, p, ph, s}`: the app's text, pointed text, sound
line or null, and the source.

| source | lines | meaning |
|---|---|---|
| `checked` | 3326 | the app already points the line and the model agrees; the app's text is kept |
| `book` | 3718 | the app already points the line and the model reads a word differently; **the app's text is kept** and the difference is in `review/nikud-diff.json` |
| `model` | 6117 | the app had no points for the line; these marks are the model's and **nobody has read them** |

Lines skipped: 0 with cantillation marks, 83 pointed lines that hold the divine Name. Nothing under
`data/corpus` (Torah, prayers) is read. `tests/build.test.js` checks all of this on the files themselves.
The `model` lines are the human-review list for this lane: until a person has read them, the app shows them only
when the learner has asked for vowel marks, with a note that they are not checked.

## Rebuilding

```
python -m venv .venv && . .venv/bin/activate
pip install --index-url https://download.pytorch.org/whl/cpu torch==2.15.0
pip install -r packages/nikud/scripts/requirements.txt

# the nikud pack: about 10 minutes, 6 GB of memory, 4 GB of disk while it runs (intermediates are deleted)
python packages/nikud/scripts/export_menaked.py --download --model-dir work/menaked --out work/build --variants int8
node scripts/sha256-parts.mjs --pack nikud --version 1 --out out/packs/nikud work/build/menaked.int8.onnx
# the phonemes pack: download the pinned file, strip its tool notes, cut it the same way (see .github/workflows/nikud-packs.yml)

# the built marks and the review lists (needs the full-precision ONNX: add --keep-fp32 above)
python packages/nikud/scripts/build_nikud_json.py --app <Al-Heb> --tokenizer work/menaked/tokenizer.json \
    --menaked work/build/menaked.fp32.onnx --phonikud work/build/phonikud.int8.onnx
node scripts/build-dist.mjs
```

`.github/workflows/nikud-packs.yml` does the pack build on a runner and keeps both pack folders as an artifact.
`conversion.json` and `packs/*.pack.json` record the sizes and SHA-256 of what was built on 2026-11-12.

## Offline-only helpers

- `scripts/punctuate.py`: verbit/hebrew_punctuation (Apache-2.0) adds commas, full stops and question marks to
  unpunctuated lines. The small network is rebuilt in the script; the model's own code is not run. Tried on two lines.
- `scripts/qa_berel.py`: dicta-il/BEREL_3.0 (Apache-2.0) lists words it finds unlikely in Torah and prayer text. It
  reads letters only and never changes a text. Tried on 40 lines; **no full run over the app's Torah and prayer text
  was done**, so there is no BEREL list in `review/` yet.

## Not done in this lane

- The packs are not on the pack host, so nothing can be downloaded by a learner yet.
- No run in a real browser, and no timing on a phone.
- No graphics-card (WebGPU) build: the 8-bit graph runs on WebAssembly only.
- A smaller vowel-marking head on dicta-il/dictabert-char was not trained.
- The BEREL check was not run over the full Torah and prayer text.
