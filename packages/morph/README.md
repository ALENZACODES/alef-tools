# packages/morph: word notes for the ALEF Hebrew course

Tap a Hebrew word, see how it is built: dictionary form, the letters joined to its front, kind of word, gender and number, an ending such as "his", whether it is a name or a place, and (only where the app's own word list has them) its family letters and verb pattern.

Two ways to get there, one card for both:

| | What | Size | Where it runs |
|---|---|---|---|
| Lesson notes | `dist/data/morph/<unit>.js`, one small module per lesson, practical unit and dialogue (177 units) | 1.1 MB in all, largest 40,728 bytes (budget 300 KiB) | read ahead of time with `dicta-il/dictabert-joint`; the app only loads the built data |
| Words pack | `dicta-il/dictabert-tiny-joint` made smaller, for any text (Talk, camera, typed) | 51,966,533 bytes = 49.56 MiB in 7 parts of at most 16 MiB (budget 50 MiB) | in the browser, on onnxruntime-web (WebAssembly), in a worker |

The Words pack also needs the onnxruntime-web WebAssembly file (14,848,852 bytes), which the worker loads from the app's own runtime folder (`opts.ortBase`). A device with a Talk pack already holds that file. A device without one fetches it once, and on a deploy that leaves the runtime file off the site it has nowhere to fetch it from: that case is open (see "Not done"). Counting the runtime, a first Words download is 63.7 MiB, over the 50 MiB line if the runtime is counted against this pack.

**Status on 12 Nov 2026:** the pack parts are built and checked, and are not on the pack host. `models.manifest.json` keeps `words` at `published: false` with no files listed, as the contract asks for an unpublished pack; the full list with every part's SHA-256 is `pack/pack.json` here. See "Not done".

This package follows `docs/CONTRACT.md` (contract 1). Its branch was cut from `claude/hf-loader-2026-11-12`.

## What is in here

```
src/        ES modules, no dependencies, no bundler (the shared scripts/build-dist.mjs copies them to dist/)
  index.js      the package entry: id, version, packs, load(), unload(), and the note helpers
  plene.js      pointed Hebrew -> everyday full spelling (what the models were trained on)
  text.js       sentences, words, keys, and the rule for the divine Name (shared by the build and the browser)
  tokenize.js   the DictaBERT WordPiece tokenizer, following the model's own tokenizer.json
  joint.js      builds the model's third input and reads its four outputs (a port of the model's Python code)
  worker.js     tokenizer + graph on onnxruntime-web, in a Web Worker (the shared loader's worker protocol)
  lookup.js     word -> analysis, from a lesson's notes or from the worker's answer
  explain.js    analysis -> short plain-English lines, and the copy check (lint)
  data/morph/<unit>.js, units.js, roots.js     built lesson notes (one-line modules: export default {...})
  data/sentiment/games.js                      mood labels a person has checked (none yet)
scripts/    offline builds (Python + Node); pinned in scripts/requirements.txt
  export_joint.py        model -> ONNX for the browser
  collect_text.mjs       every Hebrew string of the course, by unit
  build_morph_json.py    lesson notes
  build_sentiment.py     mood labels for feelings sentences, for a person to check
  eval_vocab.py          scores against the app word list (Python models)
  eval_pack.mjs          the same test through the browser code path
  crosscheck.py          second opinions from the other DictaBERT models
  sweep_examples.py      reads every example sentence of the app's word list and says keep or hold
pack/       pack.json: the Words pack list (alef.pack.v1) with every part's size and SHA-256. No weights.
review/     lists for a person: disagreements, unclear links, mood labels, score reports
tests/      node --test, on recorded fixtures; no model download. Run from src/ and again from dist/ in CI.
```

## Using it from the app

```js
const morph = await import(toolUrl('morph'));              // src/settings/tools.js in the app
// lesson notes: no pack, works offline once the unit has been fetched
const unit = await morph.loadUnit('pu-cafe');
const hit = morph.findInUnit(unit, tappedWord, textAroundIt);   // null for the divine Name and for a single letter
const lines = hit ? morph.describe(hit.a, hit.entry) : [];
// any other text: only when the Words pack is already on the device
try {
  const reader = await morph.load({ loader, bases, ortBase });   // rejects with PackError 'not-downloaded'; never downloads
  const words = await reader.analyse(sentence);
  const read = morph.fromJoint(words[0], await morph.loadRoots());
} catch (e) { /* not downloaded: offer nothing, or point at the Language Packs page */ }
```

`bases` is the same list the app gives `loader.packState` (the site's pack folder, then the pack host). The pack is downloaded and deleted by the shared loader and the app's Language Packs page; this package has no download code.

## Models

All CC-BY-4.0 (licence tag on each Hub page, read 12 Nov 2026). Revisions and tiers are in `/models.manifest.json`; the heBERT and hebEMO models are listed there as dropped.

| Model | Revision | Use here |
|---|---|---|
| dicta-il/dictabert-tiny-joint | `708026b7` | the Words pack (on device) |
| dicta-il/dictabert-joint | `7b1256fc` | lesson notes (build time); also holds the model code both use |
| dictabert-parse, -large-parse, -tiny-parse, -lex, -seg, -morph | see manifest | second opinions (build time), disagreements to review |
| onnx-community/dictabert-ner-ONNX (int8) | `4f0aabf5` | second opinion on name tags |
| dicta-il/dictabert-sentiment | `a61e139c` | mood label suggestions, human-checked before anything ships |
| dicta-il/dictabert-syntax | `fa11cb5d` | pinned, **not run** in this version |
| avichr/heBERT family, hebEMO | n/a | dropped: no licence on the Hub. Not downloaded. |

Attribution the app must show (it does, on its credits page): DictaBERT by Dicta: The Israel Center for Text Analysis, CC BY 4.0; the pack is dictabert-tiny-joint changed in size and file format.

## How the pack is made small, and what that costs

The model is 181 MB in 32-bit floats; 160 MB of that is one table (128,000 word pieces x 312), used twice: as the input embeddings and as the lemma head.

- The export keeps **one** copy of the table (the lemma scores are computed as `table @ hidden^T`), stored in 8-bit integers: 40 MB.
- Every other weight is stored as a 16-bit float and widened to 32-bit once when the model loads, so every operator still runs in plain 32-bit floats on WASM.
- The four transformer layers are **not** put in 8-bit. Measured on 600 sentences against the 32-bit graph, 8-bit layers changed 15% of prefix splits and 11% of lemmas. The shipped layout changes 0.8% of prefix splits, 2.2% of lemmas, 0.1% of parts of speech (`review/eval/export-words.json`).
- The browser graph returns four small tensors (top-3 lemma ids, prefix scores, morphology scores, name tags). The syntax head is left out.
- Producer and tool notes are stripped from the file (the shared `strip_onnx_metadata`).

One thing to know when rebuilding: recent `transformers` releases load these repos with a plain BERT tokenizer and silently drop the model's own word splitter, so `מו"מ` or `פרופ'` become three tokens. Everything here reads the model's `tokenizer.json` directly (`scripts/common.py load_tokenizer`, `src/tokenize.js`).

## Measured accuracy

The app's word list (`data/vocab/words.json`) is the only labelled Hebrew the app has, so the test is built from it (`scripts/eval_vocab.py` explains every rule). "Checked" entries here means the 3,627 of 6,303 entries the list does not flag `needsReview`; the list itself says no teacher has reviewed it, so a disagreement is not always the model's mistake. All 2,323 disagreements are in `review/morph-diff.json`.

Everyday sentences (Tatoeba examples), one target word per sentence:

| | Bar | dictabert-joint (lesson build) | Words pack (browser code path) |
|---|---|---|---|
| Lemma = the list's headword (vav/yod spelling differences allowed) | 95% | **84.3%** of 3,070 (76.4% strict) | **82.2%** (74.1% strict) |
| Dictionary link: right entry, of links made | 95% | **96.1%** of 2,471 (a link was made for 80.5% of words) | 95.9% of 2,444 (79.6% linked; scored with the Python tiny model) |
| Gender (nouns) | 95% | **93.8%** of 1,635 | 92.1% |
| Number | 95% | **95.1%** of 1,134 | 93.7% |
| Part of speech | none set | 89.1% of 3,066 | 89.1% |
| Prefix split | 97% | **98.0%** of 1,964 | **97.8%** |

Other sets, same test:

| Set | joint | pack |
|---|---|---|
| Prefix deck from the app (21 attested words, no sentence around them) | 20 of 21 | 20 of 21 |
| Built prefix items (a prefix glued to a list noun, no sentence) | 91.3% of 800 | 86.9% |
| A single word with no sentence: lemma / gender / number | 81.9% / 89.9% / 90.0% | 77.9% / 88.6% / 88.6% |
| Bible-verse examples: lemma / gender / number / prefix | 57.4% / 74.9% / 71.3% / 96.5% | 52.8% / 70.0% / 62.5% / 95.3% |

Reading these honestly:

- **The lemma bar (95%) is not met by the model alone.** The lemma head can only answer with a single word piece from its vocabulary, so rare verbs come back blank or wrong, and the list's examples are sometimes attached to the wrong entry. What the card shows as "Dictionary form" with points and English is therefore not the model's lemma: it is the app's own word-list entry, reached by a link that is made only when exactly one entry fits (`scripts/common.py WordList.link`). That link is right 96.1% of the time it is made. The form lookup behind it uses the same word list the test is built from, so that figure says "the link is rarely wrong", not "the model lemmatises at 96%". Where no link is made the card shows the model's lemma and says it may be wrong.
- **Gender (93.8%) is just under the bar; number (95.1%) and prefix split (98.0%) meet it** for the lesson build on everyday sentences. The pack is one to two points lower on gender and number.
- **Bible and prayer text is weaker across the board.** These are modern-Hebrew models. In lesson files, a word of a prayer line that matches a word-list entry exactly (points and all) takes its dictionary line from the list; the rest is the model's reading and the card says no teacher has checked it.
- Root hints: every root on a card is copied from the app's word list through the dictionary link, never worked out. So "agreement with the roots table where it has an entry" is the link figure above (96.1% of links made). No new root is suggested anywhere; the brief's "root suggestions to review" list is therefore empty by design.

Lesson text (4,805 words in 1,622 stretches of Hebrew, 177 units): 3,867 words linked to a word-list entry (2,387 by exact pointed spelling), 809 not linked (465 with more than one candidate), 112 are the divine Name and 17 are single letters shown on their own; those two kinds have no notes. 143 words got no lemma from the model. `review/lesson-words.json` lists 760 words for a person: 465 unclear links, 271 part-of-speech disagreements with the list, 24 gender disagreements. For those the card shows only what is not in dispute.

Second opinions on the same lesson text, agreement with dictabert-joint per word (`review/crosscheck.json`, 10,698 disagreements listed):

| Model | lemma | prefix | part of speech | gender | number | name tag |
|---|---|---|---|---|---|---|
| dictabert-parse | 93.3 | 99.5 | 91.7 | 92.5 | 95.1 | |
| dictabert-large-parse | 90.5 | 99.3 | 89.3 | 90.6 | 93.9 | |
| dictabert-tiny-parse | 88.6 | 98.3 | 85.3 | 89.8 | 91.6 | |
| dictabert-tiny-joint | 90.0 | 98.4 | 88.6 | 92.5 | 93.2 | |
| dictabert-lex | 91.5 | | | | | |
| dictabert-seg | | 99.4 | | | | |
| dictabert-morph | | | 88.9 | 92.9 | 94.3 | |
| dictabert-ner-ONNX int8 | | | | | | 96.0 |

(dictabert-seg and dictabert-morph store their task head under a different name than the current model code expects; a plain load leaves the head at random values with only a printed note. `crosscheck.py fill_head` loads it by name and refuses to run otherwise.)

## The divine Name

The four-letter Name, alone or behind prefix letters, pointed or not, is replaced with ה׳ before any text reaches a model, is never analysed, has no entry in any built file, and gets no card (`src/text.js isNameWord`, `scripts/common.py`). Tests check that it appears in no built data module, review list or fixture. Verse examples with the Name are also left out of the mood-label list.

## Feelings sentences

`review/sentiment.json` holds all 160 sentences (course dialogue lines and the word list's feelings-topic examples) with the model's label and scores, each `checked: false`. `dist/data/sentiment/games.js` holds only items a person has set to `checked: true`: today that is none, on purpose. Re-running `build_sentiment.py` keeps a reviewer's decisions.

## Explanations

Fixed sentences with a slot or two (`src/explain.js`), at most 25 words, grammar terms only with their meaning beside them ("Verb pattern (binyan)"). `lint()` checks length, a list of stock phrases, any mention of how a note was made, unglossed terms and unfilled slots; `tests/explain.test.js` runs it over every line the built lesson data can produce (14,690 lines). The app repo's own copy checks (`tools/text-gate`) scan `data/` JSON keys and do not apply to these strings, so this package carries its own check. No mishkal (noun pattern) hint is given: the app has no data for it and nothing here invents one.

## Rebuild

```
python -m venv venv && . venv/bin/activate && pip install -r packages/morph/scripts/requirements.txt
APP=/path/to/Al-Heb; cd packages/morph
# lesson notes
node scripts/collect_text.mjs --app $APP --out work/segments.json
python scripts/build_morph_json.py --app $APP --segments work/segments.json --out src/data/morph --review review --cache work/lesson-cache.json
# mood labels (keeps earlier human checks)
python scripts/build_sentiment.py --app $APP --review review/sentiment.json --out src/data/sentiment/games.js
# the Words pack (revisions: hubRevision in models.manifest.json)
python scripts/export_joint.py --model dicta-il/dictabert-tiny-joint --revision <sha> --code-revision <sha> --out work/words --check-sentences sentences.txt
node ../../scripts/sha256-parts.mjs --pack words --version <v> --out work/pack/words work/words/joint.int8.onnx work/words/vocab.txt work/words/tokenizer.json work/words/labels.json
cp work/pack/words/pack.json pack/pack.json          # work/pack/words/ is what goes on the pack host as words/
# scores
python scripts/eval_vocab.py --app $APP --model dicta-il/dictabert-joint --out work/eval --diff review/morph-diff.json
npm install --no-save onnxruntime-node@1.31.1 && node scripts/eval_pack.mjs --pack work/words --items work/eval/items.json
python scripts/crosscheck.py --segments work/segments.json --joint-cache work/lesson-cache.json --out review/crosscheck.json
# dist + checks (from the repo root)
cd ../.. && node scripts/build-dist.mjs && npm test && npm run check
```

Needs about 6 GB of memory for the lesson build (the lemma head returns 128,000 numbers per token; batches are sized by text length for that reason) and about 12 GB of disk while the second opinions run (each model is deleted after its run).

To publish the pack: put `work/pack/words/` on the pack host as `words/`, copy the parts from `pack/pack.json` into the `files` of `dicta-il/dictabert-tiny-joint` in `models.manifest.json` (name, bytes, sha256, url on the pack host), and set `packs.words.published` to true. `scripts/tests/scripts.test.mjs` uses `words` as its example of an unpublished pack and needs another example then.

## Not done

- **The pack is not published.** The seven parts and `pack.json` exist only where they were built. Nobody has put them on `https://alenzacodes.github.io/alef-packs/words/`. Until that happens the app offers no Words pack.
- **The runtime file on a deploy without it.** The worker loads onnxruntime-web's WebAssembly from the app's runtime folder. A deploy that serves the Talk packs from the pack host does not carry that file on the site, so there a device needs a Talk pack first. Putting the runtime into the Words pack would take it to 63.7 MiB, over its budget. Open for the loader lane.
- **The worker has not been run in a real browser.** The tokenizer, the input builder and the decoder are tested against the reference; the exported graph was run end to end through this JS with onnxruntime-node 1.31.1 (the same runtime version the app vendors for the web); `worker.js` itself (onnxruntime-web, WASM) has not been loaded in a browser, and WebGPU is untried (the worker asks for WASM only).
- Speed on a phone is not measured. On a 2-core cloud CPU with onnxruntime-node one sentence takes about 56 ms.
- The optional desktop pack from the full joint model (budget 200 MiB) and the optional name-tag pack were not built.
- dictabert-syntax was not run. No sentence-structure notes are produced.
- No noun-pattern (mishkal) hint.
- No person has reviewed anything: not the lesson notes, not the 765 review words, not the 160 mood labels.
- `load()` and the worker are tested with a stand-in worker and the real shared loader under Node. They have not run in a browser.

## Example Sentence Sweep

`scripts/sweep_examples.py --app <Al-Heb checkout> --out review/example-sweep.json` reads each example sentence of `data/vocab/words.json` with dictabert-joint and compares the word the entry matched with the entry. `review/example-sweep.json` lists all 5,705 examples with a verdict and the evidence.

- Hold (1,444): the word is read as another dictionary word (487), as the same letters in a part of speech the entry does not allow (696), with no dictionary form and a part of speech that cannot be the entry's (182), or as a name while the sentence's English shares no word with the entry's meaning (79).
- Keep (4,261): same dictionary form and a fitting part of speech (3,580); no dictionary form but the part of speech fits (405); the word is letter for letter a form the entry lists (179); a pointed verse carries exactly the entry's vowels and the word is not a name there (79); the word could not be found as one word (15); dictabert-parse, asked only about doubtful holds, agreed with the entry (3).
- In 50 holds looked at by hand before the pointed-verse rule was added, about 42 were right to hold. The keeps were not sampled. Nobody who reads Hebrew natively has checked the list.

The app applies the holds with its own `tools/vocab/hold_examples.mjs`; this package only writes the list.
