# offline-llm

Build-time pipeline for the Aleph app (ALENZACODES/Al-Heb): drafts example sentences, fill-in-the-word items and Ask the Torah
material with large Hebrew language models, puts every draft through an automatic gate, and writes what passed as static JSON.
It also builds the search index the app uses to find checked answers, lessons, units and dictionary words from an English or
Hebrew question, and ships the small search module that reads it in the browser.

No model runs in the app. Nothing here is on the learner's path except `src/search.js` and the JSON and binary files in `dist/`.

Version 0.1.0. Lane 5 of the open-Hebrew-models plan. Follows `docs/CONTRACT.md` (version 1): `dist/` is built from `src/` by
the repo's `scripts/build-dist.mjs`, so the data files the pipeline writes live in `src/` and reach `dist/` unchanged.
`dist/index.js` exports `id`, `version`, `packs` (none: this package has no language pack), `load` and `unload`.

## What is in the box

| Path | What it is |
|---|---|
| `scripts/fetch_models.py` | Downloads the pinned model files named in `models.manifest.json`, checks their SHA-256, converts two of them to GGUF. |
| `scripts/gen_examples.py` | Drafts example sentences for the one- and two-word items of a practical unit. |
| `scripts/gen_quiz.py` | Fill-in-the-word items: from example sentences that passed the gate, and from single-line Torah and prayer texts (BEREL picks the word and the wrong choices). |
| `scripts/gen_ask.py` | Hebrew wordings of questions the app already answers, and draft answers for new questions (retrieve a verse, quote an exact span, fixed template). |
| `scripts/judge.py` | The model checks: two judges, gender and number agreement, translation round-trip, offensive-language screen. |
| `scripts/gate.py` | Decides what ships. Standard library only. Writes `src/ask`, `src/examples`, `src/quiz`, `src/report.json` and `review/`. |
| `scripts/embed.py`, `scripts/build_search.mjs` | Build the search entries, their vectors and the index. |
| `scripts/eval_search.mjs` | Top-3 hit rate on `eval/search-eval.v1.json`. |
| `scripts/run_all.sh` | All of the above in order. |
| `src/index.js`, `src/search.js` | What the app loads: the package entry and the on-device search. ES modules, no dependencies. |
| `models.json` | This lane's working details per model (short key, files, hashes, GGUF names). The shared list is `/models.manifest.json`. |
| `prompts/` | Every prompt, one file each, plus the seed questions for new answers. |
| `tests/` | Gate and helper tests (Python, standard library), search tests (Node). |
| `dist/` | Built outputs, committed (never edited by hand). `review/` holds everything that did not pass, with the reasons, for the human pass. |

## The gate

An item is written to `src/` (and so to `dist/`) only if every check for its type passes. A check that was not run counts as failed. Everything
else goes to `review/*.json` with its reasons. Shipped items carry `"checked": true`; nothing is ever written there with
`checked: false`.

Example sentences
- two judges, different models, neither the generator, both saying yes; and each judge must first **qualify** on
  `tests/judge_canaries.json` (6 good and 8 deliberately wrong sentences: accept at least 5 of the good, reject at least 6 of
  the wrong). A judge that says yes to everything does not count.
- gender and number agreement (DictaBERT-joint; accepts Lane 4's output with `--morph-json` once that exists)
- every word at or below the unit's level: words of units up to that level plus the dictionary band for it
- offensive-language screen clean
- not a sentence the app already teaches, and not a repeat of another candidate
- translation round-trip: Hebrew to English with OPUS-MT tc-big-he-en, at least half the content words shared with the item's English
- the Name not spelled out; no wording about machines in the English

Quiz items: at least three different choices, one blank, both qualified judges pick the keyed answer and call it the only fit.
An item made from an example needs that example to have passed. An item made from a Torah or prayer line must rebuild to the
app's own text letter for letter, and the Name is never the blank or a choice.

Ask the Torah answers: at least one citation; every cited verse exists in the app; the passage equals the app's text and the
quoted words are an exact part of it (string comparison on the text as the app shows it, with the Name as ה׳); a question
about what one may or must do is phrased "Sources say…" and ends with "ask your rabbi"; both qualified judges agree the quote
speaks to the question. The answer's wording is a fixed template: no model writes it.

Hebrew wordings of checked questions: must point at an answer already in the app's bank; two qualified judges; screen clean.

## Results of the v0.1.0 run

See `dist/report.json` for the numbers of this build (drafts written, passed, sent to review, per type, with the reasons),
how each judge did on the known-answer sentences, and the search eval. The pull request that added this package repeats them.

The run used the smallest models that fit a 2-CPU, 7 GB box with no GPU and no spend: DictaLM-3.0-1.7B-Instruct as the
generator, DictaLM-3.0-1.7B-Thinking and dictalm2.0-instruct (4-bit) as judges. The 24B generator and the Nemotron 12B judge
are in the manifest and are what `GEN=` and `JUDGES=` in `run_all.sh` are for once a GPU box is approved.

## Search

`search/index.v1.json` holds the entries (checked answers that have a topical question, lessons, practical units, common
dictionary words) and, per term, the entries it finds. `search/index.v1.vec` holds one small int8 vector per entry (the repo keeps `.bin` for model weights, which never go in git).

How a question is answered on the device, with no model:
1. The question is split into words (English stemmed; Hebrew without points, prefixes and common endings).
2. Each word finds its entries. At build time every entry was given the words that belong to it in both languages: its own
   questions and titles, Hebrew wordings that passed the gate, dictionary translations of its words, and for a checked
   answer the Hebrew words of the verses it cites. A proposed word is kept only when the embedding model
   (NeoDictaBERT-bilingual-embed) places it close to the entry: the app's own text proposes, the vectors decide.
3. Entries whose vector is close to the best word matches are pulled up, so a near neighbour is found even when it shares no
   word with the question.

`search(ix, text, { queryVector })` also accepts a query vector, for a future optional desktop language pack. That pack (the
embedding model converted for the browser, at most 190 MiB) is **not built**; the PCA matrix it would need is written to
`work/search.docs.pca.npy` by `embed.py`.

Eval: `npm run eval:search`. 100 questions, 50 English and 50 Hebrew, hand-written as new wordings for existing entries.
The index design was adjusted after looking at misses on this same set, so treat the number as a ceiling, not a held-out score.

## Sizes

| File | Budget |
|---|---|
| `dist/search/index.v1.json` + `.vec` | 1.5 MiB in all, fetched when search is first used |
| `dist/examples/<unit>.json`, `dist/quiz/<unit>.json` | 300 KiB each |
| `src/search.js` | a few KiB; not in the app's first install |

Measured sizes are in `dist/report.json`.

## Licences

Pinned revisions and licences are in `/models.manifest.json` (and `docs/LICENCES.md`). Apache-2.0: DictaLM 3.0 1.7B (Instruct, Thinking), dictalm2.0,
BEREL 3.0. MIT: the offensive-language adapter. CC BY 4.0, credited on the app's credits page: NeoDictaBERT-bilingual-embed,
DictaBERT-HeQ, DictaBERT-joint (Dicta) and OPUS-MT tc-big-he-en (Helsinki-NLP). QA-only models (Hebrew-Mistral-7B, Hebrew_Nemo,
Llama-3.2-3B-Hebrew-Master) are listed and were not run. No model weights are in this repository or in the app.

## Rebuild

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
git clone --depth 1 https://github.com/ggml-org/llama.cpp ../../../llama.cpp      # converters only
export ALEF_MODELS=~/.cache/alef-tools/models LLAMA_CPP=../../../llama.cpp
python scripts/fetch_models.py gen-1.7b judge-1.7b-thinking judge-dictalm2 offensive heq embed berel morph mt-he-en --convert --drop-source
APP=../../../Al-Heb UNITS="pu-greetings pu-cafe pu-family" bash scripts/run_all.sh
(cd ../.. && npm test && npm run check)
python -m unittest discover -s tests -p "test_*.py"
```

About 12 GB of downloads. On the 2-CPU box a full run of three units took a few hours, nearly all of it in the judges.
`work/` (candidates, judge verdicts, caches) is not committed; `review/` is.

## Known limits

- The agreement check is a stand-in for Lane 4's output. It catches a wrong adjective or verb form next to its noun; it does
  not check numerals, construct chains or pronoun agreement, and it trusts the parser's idea of which word modifies which.
- The round-trip check is a stand-in for Lane 1's translation memory. It is strict on purpose and rejects some good sentences
  (the translation model renders a holiday greeting as a Christmas one, for instance).
- Example sentences are unpointed (`needsPointing: true`). Vowel points come from the nikud lane.
- The Hebrew in the search eval and in `prompts/ask_seeds.json` was written without a native speaker's review.
