# packages/ocr-fix

Tidies the Hebrew text the camera and photo screens read from a picture, and writes the four-letter Name as ה׳.
Plain JavaScript, no model of its own, nothing downloaded except a word list the app builds from its own dictionary.

Lane 6. Follows `docs/CONTRACT.md` (contract 1).

## What it does

The reader (tesseract `heb`, already in the app) mixes up letters that look alike (ב/כ, ד/ר, ה/ח, ו/ז/י/ן, ס/ם), drops or
adds a narrow letter, and sometimes misses a space. For each word the reader returns:

- a word in the list, or a listed word behind one or two prefix letters, is left alone;
- how sure the reader was decides the rest: **88 or more out of 100, or no confidence given: left exactly as read**;
  70 to 88: one look-alike swap, or a missed space; under 70: a little more (a dropped narrow letter, two swaps);
- a change is made only when there is exactly one close word in the list. Two equally close words: left alone, unless one
  is a very common word and the other rare, or the words pack is there to choose from the words around it;
- a line with vowel points (prayer or Torah text) is never edited; the app matches those against its stored texts instead;
- numbers, Latin text, abbreviations and anything a name tagger marks as a name are never touched;
- a word that is, or could be a misreading of, the four-letter Name is never changed into another word. `showName(text)`
  writes the Name as ה׳ for the screen, with or without vowel points, alone or after prefix letters (לה׳).

A word missing from the list is far more often a real word the list does not hold than a misreading. That is why the
default is to do nothing, and why the reader's own confidence gates every change.

## Files

| Path | What |
|---|---|
| `src/correct.js` | `createCorrector(lexicon)`, `distance`, `showName`, `hasName`, adapters for the words pack |
| `src/index.js` | package entry in the contract's shape (`packs` is empty: it needs no pack of its own) |
| `scripts/build_lexicon.py` | builds the word list from an app checkout (dictionary, sign list, phrasebook); budget 1 MiB |
| `dist/` | `correct.js`, `index.js` (comments taken out) and `dist.json`, built by the shared `node scripts/build-dist.mjs` |

The word list is built from the app's own data and lives in the app (Al-Heb `assets/vendor/_packs/ocr-words/lexicon.json`:
5,332 words, 55,275 bytes, fetched the first time a photo is read). It is not stored here.

## The words pack (lane 4) and name tags

`load({ words })` takes the loaded words pack when the learner has it. Two things are used if they exist:
`words.scoreCandidates(left, candidates, right)` (one number per candidate, higher fits better: the fill-in-the-blank
ranking from dictabert-tiny-joint) and `words.nameTags(tokens)` (one tag per token, from dictabert-ner). **Neither exists
yet**: lane 4's package was a placeholder when this was written. Both hooks are tested with stand-ins only, and no number
below uses them. Without the pack nothing extra is downloaded and both steps are skipped.

## The numbers (2026-11-12)

Measured with the app's `tools/ocr-bench` on its 145 **synthetic** images (rendered text, degraded in software; not
photographs), tesseract 5.3.4 command line with the app's own `heb.traineddata`, page mode 6. "Word accuracy" is the
bench's word recall.

| | Bar | Measured |
|---|---|---|
| Sign images (n=88), word accuracy | +10 points | **79.7% → 83.6% (+3.9). Not met.** |
| Any single image worse by more than 2 points | none | none worse (4 better, 0 worse) |
| Prayer lines and pages | | unchanged (64.8% and 54.3%): pointed text is left as read |
| All 145 images | | 64.8% → 65.5% |
| The Name shown as ה׳ | yes | yes (`showName`, and the photo reader's own display) |

Read these with care:

- The sign images use phrases from the app's phrasebook, and the word list is built from the same phrasebook. The +3.9 is
  therefore a best case. With those 20 words removed from the list first, the same run goes **79.7% → 78.9%** (one image
  worse by 33 points, where "אני" was read correctly at low confidence and changed to a neighbour). Words the list does
  not hold are the risk.
- The split and common-word rules were added after looking at this set's misreads, so even the best case is optimistic.
- The engine the app ships is the same tesseract data compiled to WebAssembly, run in the browser. That run needs a browser
  and was not made here. Its recorded baseline on the sign images is 88.3%; of its 15 missed words, 7 are within reach of
  this package (a missed space three times, one look-alike) and the rest are not ("די" read as "₪", "כשרה" read as "בשרה",
  which is itself a word and needs the sentence to decide).
- No real photographs were scored.

## Licence

Code: MIT. No model. The word list is derived from the app's own data.
