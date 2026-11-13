# Model licences

Generated from `models.manifest.json` by `scripts/build-licences.mjs`. Do not edit by hand.

Licences and revisions were read from the Hugging Face Hub on 2026-11-12. `node scripts/pin-revisions.mjs` reads them again.

Code in this repo is MIT. Model weights are not in this repo and keep the licences below.

A model with a non-commercial or unclear licence is never shipped: it is dropped (X) or used for internal checks only (Q).

## D: on the device (opt-in language pack) (12)

| Model | Licence | Pinned revision | Pack | Why |
|---|---|---|---|---|
| [Helsinki-NLP/opus-mt-en-he](https://huggingface.co/Helsinki-NLP/opus-mt-en-he) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `b3df900afbb1` | translate-en-he | English to Hebrew for Talk, the camera translator and the live translator (the shipped en-he pack). |
| [Helsinki-NLP/Tatoeba-Challenge:heb-eng/opus-2021-02-19](https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/heb-eng) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | n/a | translate-he-en | Hebrew to English (the shipped he-en pack). OPUS-MT Tatoeba release, not a Hub repository. |
| [Helsinki-NLP/opus-mt-tc-big-he-en](https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-he-en) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `134c5a850dca` | translate-he-en-hq | Better Hebrew to English on a desktop with a graphics card (opt-in); also used offline to build the translation memory for app sentences. |
| [ivrit-ai/whisper-large-v3-turbo-onnx](https://huggingface.co/ivrit-ai/whisper-large-v3-turbo-onnx) | [Apache-2.0 (inherited from ivrit-ai/whisper-large-v3-turbo; the port carries no licence tag)](https://www.apache.org/licenses/LICENSE-2.0) | `edb17b6b65f6` | listen-best | Best listening on a desktop with a graphics card: live translator and voice journal transcripts. Pack as built: q4f16 encoder and merged decoder, 538.1 MiB (packages/speech/packs/listen-best.pack.json); not published yet, and not yet run on a graphics card. The port has no model card on the Hub (checked 2026-11-12). |
| [onnx-community/whisper-base](https://huggingface.co/onnx-community/whisper-base) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `27a07b4b52b3` | listen-lite | Quick Hebrew listening on any device, so audio never leaves the device. Pack as built: 4-bit encoder and 8-bit merged decoder, 69.9 MiB (packages/speech/packs/listen-lite.pack.json); not published yet. |
| [onnx-community/whisper-small](https://huggingface.co/onnx-community/whisper-small) | [Apache-2.0 (base openai/whisper-small; the port carries no licence tag)](https://www.apache.org/licenses/LICENSE-2.0) | `36050c46d777` | listen-mid | Optional middle tier: better listening on a phone. Not built by Lane 2 in this round. |
| [XDcobra/wav2vec2-large-xlsr-53-hebrew-ONNX](https://huggingface.co/XDcobra/wav2vec2-large-xlsr-53-hebrew-ONNX) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `9a38de310285` | pron-check | Letter-level pronunciation check (character alignment against the expected letters). Pack as built: re-exported from the fp32 graph to 4-bit weights, 198.6 MiB (packages/speech/packs/pron-check.pack.json); not published yet. |
| [dicta-il/dictabert-large-char-menaked](https://huggingface.co/dicta-il/dictabert-large-char-menaked) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `4dfc20b94565` | nikud | Vowel marks for any text the learner brings (camera, Talk, typed); offline, vowel marks for every app sentence, checked. |
| [Phonikud/phonikud-onnx](https://huggingface.co/Phonikud/phonikud-onnx) | [MIT](https://opensource.org/license/mit) | `b806189fe1fc` | phonemes | Phonemes and stress marks for any text; the target for the pronunciation check; transliteration checks. (Also reachable as thewh1teagle/phonikud-onnx.) |
| [dicta-il/dictabert-tiny-joint](https://huggingface.co/dicta-il/dictabert-tiny-joint) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `708026b7297f` | words | Word taps anywhere: dictionary form, root and pattern hint, prefixes, part of speech, names. |
| [alef-tools/handwriting-cnn](https://github.com/ALENZACODES/alef-tools/tree/main/packages/handwriting) | [MIT](https://opensource.org/license/mit) | n/a | handwriting | The tracing checker: our own small network (at most 2 MiB), trained here on letters drawn from OFL Hebrew fonts. |
| [tesseract-ocr/tessdata:heb](https://github.com/tesseract-ocr/tessdata) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | n/a |  | Camera OCR. Already vendored in the app (assets/vendor/_tesseract); stays as it is. |

## B: offline build time only (43)

| Model | Licence | Pinned revision | Pack | Why |
|---|---|---|---|---|
| [ivrit-ai/whisper-large-v3-turbo](https://huggingface.co/ivrit-ai/whisper-large-v3-turbo) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `f33172a8c3c6` |  | Source model of the listen-best pack; offline transcript checks. |
| [imvladikon/wav2vec2-large-xlsr-53-hebrew](https://huggingface.co/imvladikon/wav2vec2-large-xlsr-53-hebrew) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `3dd308dda70b` |  | Source model of the pron-check pack. |
| [imvladikon/whisper-medium-he](https://huggingface.co/imvladikon/whisper-medium-he) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `241e89a758b5` |  | Offline transcript checks of app audio. |
| [ivrit-ai/whisper-large-v3](https://huggingface.co/ivrit-ai/whisper-large-v3) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `766847c9795b` |  | Offline: transcribe and verify every shipped Hebrew clip (wrong takes, a voiced divine Name). |
| [ivrit-ai/whisper-large-v3-ct2](https://huggingface.co/ivrit-ai/whisper-large-v3-ct2) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `e9ed4a4a98d7` |  | Offline: transcribe and verify every shipped Hebrew clip. |
| [ivrit-ai/whisper-large-v3-turbo-ct2](https://huggingface.co/ivrit-ai/whisper-large-v3-turbo-ct2) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `72ad623a3794` |  | Offline: transcribe and verify every shipped Hebrew clip. |
| [ivrit-ai/whisper-v2-d4](https://huggingface.co/ivrit-ai/whisper-v2-d4) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `db40b936baaf` |  | Offline: transcribe and verify every shipped Hebrew clip. |
| [ivrit-ai/faster-whisper-v2-d4](https://huggingface.co/ivrit-ai/faster-whisper-v2-d4) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `45ef6dd536df` |  | Offline: transcribe and verify every shipped Hebrew clip. |
| [ivrit-ai/pyannote-speaker-diarization-3.1](https://huggingface.co/ivrit-ai/pyannote-speaker-diarization-3.1) | [MIT](https://opensource.org/license/mit) | `38f6d53531ff` |  | Offline split of multi-speaker recordings. |
| [verbit/hebrew_punctuation](https://huggingface.co/verbit/hebrew_punctuation) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `85f81abab8d1` |  | Punctuate offline transcripts (voice journal export, lesson scripts). |
| [dicta-il/dictabert-joint](https://huggingface.co/dicta-il/dictabert-joint) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `7b1256fc0846` |  | Build-time analysis of every lesson word and sentence into static JSON for lesson explanations. |
| [dicta-il/dictabert-morph](https://huggingface.co/dicta-il/dictabert-morph) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `608e457a4237` |  | Cross-check of the joint model; roots table checks. |
| [dicta-il/dictabert-lex](https://huggingface.co/dicta-il/dictabert-lex) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `91b97a612573` |  | Cross-check of the joint model; roots table checks. |
| [dicta-il/dictabert-seg](https://huggingface.co/dicta-il/dictabert-seg) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `7318bcbbad11` |  | Cross-check of the joint model; roots table checks. |
| [dicta-il/dictabert-syntax](https://huggingface.co/dicta-il/dictabert-syntax) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `fa11cb5df763` |  | Cross-check of the joint model; roots table checks. |
| [dicta-il/dictabert-parse](https://huggingface.co/dicta-il/dictabert-parse) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `37f4d6fd5567` |  | Cross-check of the joint model; roots table checks. |
| [dicta-il/dictabert-large-parse](https://huggingface.co/dicta-il/dictabert-large-parse) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `485ed0b4ed1b` |  | Cross-check of the joint model; roots table checks. |
| [dicta-il/dictabert-tiny-parse](https://huggingface.co/dicta-il/dictabert-tiny-parse) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `8e97fcdcec34` |  | Cross-check of the joint model; roots table checks. |
| [onnx-community/dictabert-ner-ONNX](https://huggingface.co/onnx-community/dictabert-ner-ONNX) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `4f0aabf58566` |  | Names and places tags for camera signs and reading texts. |
| [dicta-il/dictabert-ner](https://huggingface.co/dicta-il/dictabert-ner) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `05ed61bc9943` |  | Source model of the NER ONNX build. |
| [dicta-il/dictabert-sentiment](https://huggingface.co/dicta-il/dictabert-sentiment) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `a61e139c5981` |  | Label sentences for the feelings games (static JSON, human-checked). |
| [dicta-il/dictabert-heq](https://huggingface.co/dicta-il/dictabert-heq) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `903b0c9672a5` |  | Ask the Torah: finding the answering span inside cited sources (quote-and-cite). |
| [dicta-il/dictabert-large-heq](https://huggingface.co/dicta-il/dictabert-large-heq) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `2eb6caa4f677` |  | Ask the Torah: finding the answering span inside cited sources (quote-and-cite). |
| [dicta-il/dictabert](https://huggingface.co/dicta-il/dictabert) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `8884c6db002a` |  | Offline: quiz distractors, cloze-item checks, typo correction after OCR. |
| [dicta-il/dictabert-large](https://huggingface.co/dicta-il/dictabert-large) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `a972ffb612c0` |  | Offline: quiz distractors, cloze-item checks, typo correction after OCR. |
| [dicta-il/neodictabert](https://huggingface.co/dicta-il/neodictabert) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `9052b2e47fe3` |  | Offline: quiz distractors, cloze-item checks, typo correction after OCR. |
| [dicta-il/neodictabert-bilingual](https://huggingface.co/dicta-il/neodictabert-bilingual) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `3367cca9df69` |  | Offline: quiz distractors, cloze-item checks, typo correction after OCR. |
| [dicta-il/MsBERT](https://huggingface.co/dicta-il/MsBERT) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `d87fc6949dd9` |  | Offline: quiz distractors, cloze-item checks, typo correction after OCR. |
| [dicta-il/alephbertgimmel-base](https://huggingface.co/dicta-il/alephbertgimmel-base) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | `973a5f8bb492` |  | Offline: quiz distractors, cloze-item checks, typo correction after OCR. |
| [onlplab/alephbert-base](https://huggingface.co/onlplab/alephbert-base) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `1745fb3ff513` |  | Offline: quiz distractors, cloze-item checks, typo correction after OCR. |
| [KevynKrancenblum/hebrew-offensive-detection](https://huggingface.co/KevynKrancenblum/hebrew-offensive-detection) | [MIT](https://opensource.org/license/mit) | `e127b6a3ea1e` |  | Screen every generated or learner-facing Hebrew string offline. |
| [dicta-il/neodictabert-bilingual-embed](https://huggingface.co/dicta-il/neodictabert-bilingual-embed) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `1da86250a802` |  | Build-time vectors for the Ask the Torah question bank, lessons and dictionary; English or Hebrew queries. |
| [dicta-il/DictaLM-3.0-24B-Thinking](https://huggingface.co/dicta-il/DictaLM-3.0-24B-Thinking) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `165442be7f7d` |  | Offline only: draft Ask the Torah answers (quote-and-cite, from sources already in the app), example sentences, quiz items, translation-memory review. Nothing ships without a test gate and a human-review list. |
| [dicta-il/DictaLM-3.0-24B-Base](https://huggingface.co/dicta-il/DictaLM-3.0-24B-Base) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `6efc92259da9` |  | Offline only: as the Thinking model. |
| [dicta-il/DictaLM-3.0-Nemotron-12B-Instruct](https://huggingface.co/dicta-il/DictaLM-3.0-Nemotron-12B-Instruct) | [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/) | `d08cd8264b74` |  | Offline only: second-opinion checker (cross-model agreement gate). Commercial use allowed; terms recorded. |
| [dicta-il/DictaLM-3.0-Nemotron-12B-Base](https://huggingface.co/dicta-il/DictaLM-3.0-Nemotron-12B-Base) | [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/) | `6e9b054c8d05` |  | Offline only: second-opinion checker. |
| [dicta-il/DictaLM-3.0-1.7B-Instruct](https://huggingface.co/dicta-il/DictaLM-3.0-1.7B-Instruct) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `5add44d6941d` |  | Offline only: cheap bulk pass (grammar and gender agreement of generated items). |
| [dicta-il/DictaLM-3.0-1.7B-Thinking](https://huggingface.co/dicta-il/DictaLM-3.0-1.7B-Thinking) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `43e2fac28563` |  | Offline only: cheap bulk pass (grammar and gender agreement of generated items). |
| [dicta-il/DictaLM-3.0-1.7B-Base](https://huggingface.co/dicta-il/DictaLM-3.0-1.7B-Base) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `b0bdc0d1b236` |  | Offline only: cheap bulk pass (grammar and gender agreement of generated items). |
| [dicta-il/dictalm2.0](https://huggingface.co/dicta-il/dictalm2.0) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `f8ab3208e95a` |  | Offline only: fallback generator. |
| [dicta-il/dictalm2.0-instruct](https://huggingface.co/dicta-il/dictalm2.0-instruct) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `257c6023d6ac` |  | Offline only: fallback generator. |
| [dicta-il/BEREL_3.0](https://huggingface.co/dicta-il/BEREL_3.0) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `25dc07f2e622` |  | Biblical and Rabbinic Hebrew: vowel and trope checks on Torah reading texts, cloze items for Torah and prayer units. |
| [dicta-il/BEREL](https://huggingface.co/dicta-il/BEREL) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `029fa610debd` |  | Biblical and Rabbinic Hebrew checks (older model). |

## Q: internal checks only, never ships (27)

| Model | Licence | Pinned revision | Pack | Why |
|---|---|---|---|---|
| [Xenova/opus-mt-mul-en](https://huggingface.co/Xenova/opus-mt-mul-en) | [Apache-2.0 (base model; the port states none)](https://www.apache.org/licenses/LICENSE-2.0) | `72a05e47cee8` |  | Baseline in the scoring harness only. |
| [onnx-community/opus-mt-mul-en](https://huggingface.co/onnx-community/opus-mt-mul-en) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `caca514947ac` |  | Baseline in the scoring harness only. |
| [imvladikon/wav2vec2-xls-r-300m-lm-hebrew](https://huggingface.co/imvladikon/wav2vec2-xls-r-300m-lm-hebrew) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `a532e94f9747` |  | Scoring-harness comparison only. |
| [imvladikon/wav2vec2-xls-r-1b-hebrew](https://huggingface.co/imvladikon/wav2vec2-xls-r-1b-hebrew) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `d67afbcd9f37` |  | Scoring-harness comparison only. |
| [slprl/WhiStress](https://huggingface.co/slprl/WhiStress) | [CC-BY-NC-4.0](https://creativecommons.org/licenses/by-nc/4.0/) | `3641786c97df` |  | Non-commercial: may only be used to evaluate our own stress rules internally. Never ships. |
| [slprl/StresSLM](https://huggingface.co/slprl/StresSLM) | [CC-BY-NC-4.0](https://creativecommons.org/licenses/by-nc/4.0/) | `711c31102bd6` |  | Non-commercial: internal evaluation only. Never ships. |
| [slprl/PAST](https://huggingface.co/slprl/PAST) | [none stated](https://huggingface.co/slprl/PAST) | `07329e810dd1` |  | No licence stated: internal evaluation only. Never ships. |
| [Hebrish/Jachnun-ONNX](https://huggingface.co/Hebrish/Jachnun-ONNX) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `5dbe4ccc858c` |  | Mixed Hebrew and English speech in Talk (PLAN.md calls this "danielrosehill/Parakeet-TDT-0.6B EN-HE code-switching"; on the Hub it is Hebrish/Jachnun, a Parakeet fine-tune). Gated: John has to accept the terms before it can be evaluated. Internal checks only for now. |
| [avraham123/tale-me-dictabert-menaked-browser](https://huggingface.co/avraham123/tale-me-dictabert-menaked-browser) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `c9e5cf7f1e6d` |  | Third-party browser port of the menaked model. Not used: the pack is converted from the Dicta original. |
| [dicta-il/dictabert-char](https://huggingface.co/dicta-il/dictabert-char) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `58849bcd91db` |  | Experiment: a smaller vowel-marking head. |
| [dicta-il/dictabert-large-ner](https://huggingface.co/dicta-il/dictabert-large-ner) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | `ac70130828d5` |  | NER gold check. |
| [tdklab/hebert-finetuned-hebrew-metaphor](https://huggingface.co/tdklab/hebert-finetuned-hebrew-metaphor) | [none stated](https://huggingface.co/tdklab/hebert-finetuned-hebrew-metaphor) | `1843ead38355` |  | Idioms unit checks only, and only if a licence is confirmed (derived from heBERT, which states none). |
| [yam-peleg/Hebrew-Mistral-7B](https://huggingface.co/yam-peleg/Hebrew-Mistral-7B) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `3d32134b5959` |  | Extra judge in the agreement gate. |
| [yam-peleg/Hebrew-Mistral-7B-200K](https://huggingface.co/yam-peleg/Hebrew-Mistral-7B-200K) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `7b51c7b31e3d` |  | Extra judge in the agreement gate. |
| [ronmasas/Hebrew-Mistral-7B-Instruct-v0.1](https://huggingface.co/ronmasas/Hebrew-Mistral-7B-Instruct-v0.1) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `88de6fcaa0e9` |  | Extra judge in the agreement gate. |
| [SicariusSicariiStuff/Hebrew_Nemo](https://huggingface.co/SicariusSicariiStuff/Hebrew_Nemo) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `63e7e7769c8c` |  | Extra judge in the agreement gate. |
| [yonioz123/Llama-3.2-3B-Hebrew-Master](https://huggingface.co/yonioz123/Llama-3.2-3B-Hebrew-Master) | [Apache-2.0 (as tagged; base model is under the Llama 3.2 Community Licence)](https://www.apache.org/licenses/LICENSE-2.0) | `6c27d89168f8` |  | Extra judge in the agreement gate. |
| [Intel/hebrew-math-tutor-v1](https://huggingface.co/Intel/hebrew-math-tutor-v1) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `5b2027ea4ad0` |  | Numbers-unit word-problem experiment only. |
| [ronigold/dictalm2.0-instruct-fine-tuned-alpaca-gpt4-hebrew](https://huggingface.co/ronigold/dictalm2.0-instruct-fine-tuned-alpaca-gpt4-hebrew) | [MIT (trained on GPT-4 outputs)](https://opensource.org/license/mit) | `34620801cdbf` |  | Judge only. |
| [yam-peleg/Hebrew-Gemma-11B](https://huggingface.co/yam-peleg/Hebrew-Gemma-11B) | [Gemma Terms of Use](https://ai.google.dev/gemma/terms) | `20216cb3fbef` |  | Use-policy terms, not an open-source licence: internal checks only, writes nothing that ships. |
| [yam-peleg/Hebrew-Gemma-11B-V2](https://huggingface.co/yam-peleg/Hebrew-Gemma-11B-V2) | [Gemma Terms of Use](https://ai.google.dev/gemma/terms) | `bff43da66008` |  | Use-policy terms, not an open-source licence: internal checks only, writes nothing that ships. |
| [yam-peleg/Hebrew-Gemma-11B-Instruct](https://huggingface.co/yam-peleg/Hebrew-Gemma-11B-Instruct) | [Gemma Terms of Use](https://ai.google.dev/gemma/terms) | `a40259d1efbc` |  | Use-policy terms, not an open-source licence: internal checks only, writes nothing that ships. |
| [Norod78/gemma-3_4b_hebrew-lyrics-finetune](https://huggingface.co/Norod78/gemma-3_4b_hebrew-lyrics-finetune) | [Gemma Terms of Use](https://ai.google.dev/gemma/terms) | `a16990bd9753` |  | Use-policy terms: internal checks only. |
| [XythicK/Hebrew-GPT](https://huggingface.co/XythicK/Hebrew-GPT) | [Llama 3.2 Community Licence](https://www.llama.com/llama3_2/license/) | `ad3ef49c8481` |  | Attribution and acceptable-use terms: internal checks only. |
| [slprl/SIMS-Llama3.2-3B](https://huggingface.co/slprl/SIMS-Llama3.2-3B) | [Llama 3.2 Community Licence](https://www.llama.com/llama3_2/license/) | `847146d5fbb2` |  | Attribution and acceptable-use terms: internal checks only. |
| [sivan22/testing-trOCR-hebrew-handwritten](https://huggingface.co/sivan22/testing-trOCR-hebrew-handwritten) | [none stated](https://huggingface.co/sivan22/testing-trOCR-hebrew-handwritten) | `419f9f0b3a76` |  | Benchmark only for the tracing checker. No licence stated; never ships. |
| [Xenova/trocr-small-handwritten](https://huggingface.co/Xenova/trocr-small-handwritten) | [MIT](https://opensource.org/license/mit) | `02bea33ca09a` |  | Architecture reference only for the tracing checker. |

## X: dropped (46)

| Model | Licence | Pinned revision | Pack | Why |
|---|---|---|---|---|
| [Xenova/nllb-200-distilled-600M](https://huggingface.co/Xenova/nllb-200-distilled-600M) | [CC-BY-NC-4.0](https://creativecommons.org/licenses/by-nc/4.0/) | `261c31d1a573` |  | Dropped: non-commercial licence. |
| [ashercn97/english-hebrew-translation](https://huggingface.co/ashercn97/english-hebrew-translation) | [none stated](https://huggingface.co/ashercn97/english-hebrew-translation) | `7d295c00e34c` |  | Dropped: no licence stated. |
| [imvladikon/wav2vec2-xls-r-300m-hebrew](https://huggingface.co/imvladikon/wav2vec2-xls-r-300m-hebrew) | [none stated](https://huggingface.co/imvladikon/wav2vec2-xls-r-300m-hebrew) | `b2e683004903` |  | Dropped: no licence stated (the xlsr-53 model is used instead). |
| [ivrit-ai/pyannote-segmentation-3.0](https://huggingface.co/ivrit-ai/pyannote-segmentation-3.0) | [none stated](https://huggingface.co/ivrit-ai/pyannote-segmentation-3.0) | `2a6b1347edb1` |  | Dropped: no licence stated. |
| [thewh1teagle/whisper-heb-ipa](https://huggingface.co/thewh1teagle/whisper-heb-ipa) | [unavailable](https://huggingface.co/thewh1teagle/whisper-heb-ipa) | n/a |  | Dropped: the repository is private or removed (the Hub answers 401). Replaced by phonikud phonemes plus the wav2vec2 alignment. |
| [tzikitrop/whisper-he-tiny-picking-onnx](https://huggingface.co/tzikitrop/whisper-he-tiny-picking-onnx) | [none stated](https://huggingface.co/tzikitrop/whisper-he-tiny-picking-onnx) | `1e48b78c266a` |  | Dropped: no licence stated, narrow domain. |
| [Phonikud/phonikud](https://huggingface.co/Phonikud/phonikud) | ["cc" (unspecified)](https://huggingface.co/Phonikud/phonikud) | `aef4b260fe8d` |  | Dropped: licence unclear (training repository; the MIT ONNX build is used instead). |
| [avichr/heBERT](https://huggingface.co/avichr/heBERT) | [none stated](https://huggingface.co/avichr/heBERT) | `01566c04aa22` |  | Dropped: no licence on the Hub. Replaced by the DictaBERT equivalents. |
| [avichr/heBERT_NER](https://huggingface.co/avichr/heBERT_NER) | [none stated](https://huggingface.co/avichr/heBERT_NER) | `fc4a87775d8c` |  | Dropped: no licence on the Hub. Replaced by the DictaBERT equivalents. |
| [avichr/heBERT_sentiment_analysis](https://huggingface.co/avichr/heBERT_sentiment_analysis) | [none stated](https://huggingface.co/avichr/heBERT_sentiment_analysis) | `022c0d00fc26` |  | Dropped: no licence on the Hub. Replaced by the DictaBERT equivalents. |
| [avichr/hebEMO_anger](https://huggingface.co/avichr/hebEMO_anger) | [none stated](https://huggingface.co/avichr/hebEMO_anger) | `98c86d3cfb0a` |  | Dropped: no licence on the Hub. Replaced by the DictaBERT equivalents. |
| [avichr/hebEMO_anticipation](https://huggingface.co/avichr/hebEMO_anticipation) | [none stated](https://huggingface.co/avichr/hebEMO_anticipation) | `87772a230ab1` |  | Dropped: no licence on the Hub. Replaced by the DictaBERT equivalents. |
| [avichr/hebEMO_disgust](https://huggingface.co/avichr/hebEMO_disgust) | [none stated](https://huggingface.co/avichr/hebEMO_disgust) | `ab06244d38eb` |  | Dropped: no licence on the Hub. Replaced by the DictaBERT equivalents. |
| [avichr/hebEMO_fear](https://huggingface.co/avichr/hebEMO_fear) | [none stated](https://huggingface.co/avichr/hebEMO_fear) | `d0d904a86c7f` |  | Dropped: no licence on the Hub. Replaced by the DictaBERT equivalents. |
| [avichr/hebEMO_joy](https://huggingface.co/avichr/hebEMO_joy) | [none stated](https://huggingface.co/avichr/hebEMO_joy) | `87c55811d54c` |  | Dropped: no licence on the Hub. Replaced by the DictaBERT equivalents. |
| [avichr/hebEMO_sadness](https://huggingface.co/avichr/hebEMO_sadness) | [none stated](https://huggingface.co/avichr/hebEMO_sadness) | `174de57c806c` |  | Dropped: no licence on the Hub. Replaced by the DictaBERT equivalents. |
| [avichr/hebEMO_surprise](https://huggingface.co/avichr/hebEMO_surprise) | [none stated](https://huggingface.co/avichr/hebEMO_surprise) | `5596b27373fc` |  | Dropped: no licence on the Hub. Replaced by the DictaBERT equivalents. |
| [avichr/hebEMO_trust](https://huggingface.co/avichr/hebEMO_trust) | [none stated](https://huggingface.co/avichr/hebEMO_trust) | `60f487bb367c` |  | Dropped: no licence on the Hub. Replaced by the DictaBERT equivalents. |
| [avichr/Legal-heBERT](https://huggingface.co/avichr/Legal-heBERT) | [none stated](https://huggingface.co/avichr/Legal-heBERT) | `dd775034faa5` |  | Dropped: no licence on the Hub. Replaced by the DictaBERT equivalents. |
| [onnx-community/heBERT_NER-ONNX](https://huggingface.co/onnx-community/heBERT_NER-ONNX) | [none stated](https://huggingface.co/onnx-community/heBERT_NER-ONNX) | `16a6e787e031` |  | Dropped: no licence on the Hub. |
| [HeNLP/HeRo](https://huggingface.co/HeNLP/HeRo) | [none stated](https://huggingface.co/HeNLP/HeRo) | `8dc628f5e29a` |  | Dropped: no licence stated. |
| [HeNLP/LongHeRo](https://huggingface.co/HeNLP/LongHeRo) | [none stated](https://huggingface.co/HeNLP/LongHeRo) | `8362824792f8` |  | Dropped: no licence stated. |
| [imvladikon/hebert_parashoot](https://huggingface.co/imvladikon/hebert_parashoot) | [none stated](https://huggingface.co/imvladikon/hebert_parashoot) | `868cf55bb7a8` |  | Dropped: no licence stated (dictabert-heq is used instead). |
| [imvladikon/sentence-transformers-alephbert](https://huggingface.co/imvladikon/sentence-transformers-alephbert) | [none stated](https://huggingface.co/imvladikon/sentence-transformers-alephbert) | `547db5a20287` |  | Dropped: no licence stated. |
| [imvladikon/sentence_transformers_alephbertgimmel_small](https://huggingface.co/imvladikon/sentence_transformers_alephbertgimmel_small) | [none stated](https://huggingface.co/imvladikon/sentence_transformers_alephbertgimmel_small) | `99d2b941ca4c` |  | Dropped: no licence stated. |
| [slprl/SIMS-7B](https://huggingface.co/slprl/SIMS-7B) | [MIT](https://opensource.org/license/mit) | `2a83e72d7e6a` |  | Dropped: a speech language model, not usable for the frozen-cast spoken lessons. |
| [Slasky/HebrewGPT-1B](https://huggingface.co/Slasky/HebrewGPT-1B) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `fd08f10a8df7` |  | Dropped: too weak for teaching content. |
| [Slasky/HebrewGPT-296M](https://huggingface.co/Slasky/HebrewGPT-296M) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `a142784c73d8` |  | Dropped: too weak for teaching content. |
| [Norod78/Hebrew-GPT2-345M-Stage](https://huggingface.co/Norod78/Hebrew-GPT2-345M-Stage) | [MIT](https://opensource.org/license/mit) | `41750d709ac6` |  | Dropped: too weak for teaching content. |
| [Norod78/hebrew-gpt_neo-small](https://huggingface.co/Norod78/hebrew-gpt_neo-small) | [MIT](https://opensource.org/license/mit) | `d9ee75ea9eb0` |  | Dropped: too weak for teaching content. |
| [Norod78/hebrew-gpt_neo-tiny](https://huggingface.co/Norod78/hebrew-gpt_neo-tiny) | [MIT](https://opensource.org/license/mit) | `7669a3dcb026` |  | Dropped: too weak for teaching content (an ONNX build exists, 122 MB; not worth a pack). |
| [Norod78/hebrew-gpt_neo-xl](https://huggingface.co/Norod78/hebrew-gpt_neo-xl) | [MIT](https://opensource.org/license/mit) | `1afb0e845b75` |  | Dropped: too weak for teaching content. |
| [Norod78/SmolLM-135M-FakyPedia-EngHeb](https://huggingface.co/Norod78/SmolLM-135M-FakyPedia-EngHeb) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `fd2d0138c4d0` |  | Dropped: too weak for teaching content. |
| [imvladikon/het5_summarization](https://huggingface.co/imvladikon/het5_summarization) | [none stated](https://huggingface.co/imvladikon/het5_summarization) | `013e7d3c7a1e` |  | Dropped: no licence stated (lesson summaries are covered offline by DictaLM). |
| [imvladikon/het5_small_summarization](https://huggingface.co/imvladikon/het5_small_summarization) | [none stated](https://huggingface.co/imvladikon/het5_small_summarization) | `57371030ddf5` |  | Dropped: no licence stated. |
| [imvladikon/cross_summarization_he_en](https://huggingface.co/imvladikon/cross_summarization_he_en) | [none stated](https://huggingface.co/imvladikon/cross_summarization_he_en) | `f46ac014f952` |  | Dropped: no licence stated. |
| [mr3vial/paleo-hebrew-mt5-post-ocr-processing](https://huggingface.co/mr3vial/paleo-hebrew-mt5-post-ocr-processing) | [MIT](https://opensource.org/license/mit) | `9b24743a414b` |  | Dropped: out of scope (paleo-Hebrew). |
| [facebook/mms-tts-heb](https://huggingface.co/facebook/mms-tts-heb) | [CC-BY-NC-4.0](https://creativecommons.org/licenses/by-nc/4.0/) | `28f1fce7cf56` |  | Dropped: non-commercial. No synthetic voice ships. |
| [thewh1teagle/mms-tts-heb](https://huggingface.co/thewh1teagle/mms-tts-heb) | [unavailable](https://huggingface.co/thewh1teagle/mms-tts-heb) | n/a |  | Dropped: the Hub answers 401. No synthetic voice ships. |
| [Xenova/mms-tts-heb](https://huggingface.co/Xenova/mms-tts-heb) | [unavailable](https://huggingface.co/Xenova/mms-tts-heb) | n/a |  | Dropped: the Hub answers 401. No synthetic voice ships. |
| [notmax123/Zonos-Hebrew](https://huggingface.co/notmax123/Zonos-Hebrew) | [CC-BY-NC-4.0](https://creativecommons.org/licenses/by-nc/4.0/) | `66c4f2124dbf` |  | Dropped: non-commercial. No synthetic voice ships. |
| [thewh1teagle/kokoro-hebrew-nc](https://huggingface.co/thewh1teagle/kokoro-hebrew-nc) | ["other" (non-commercial by name)](https://huggingface.co/thewh1teagle/kokoro-hebrew-nc) | `07e2334fc252` |  | Dropped: non-commercial. No synthetic voice ships. |
| [Trojanssafsdg/hebrewTTS-orpheus3b](https://huggingface.co/Trojanssafsdg/hebrewTTS-orpheus3b) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | `b80c2b513a4e` |  | Dropped: the repository holds no weights. No synthetic voice ships. |
| [rotem1121/hebrew-orpheus-tts](https://huggingface.co/rotem1121/hebrew-orpheus-tts) | [none stated](https://huggingface.co/rotem1121/hebrew-orpheus-tts) | `c454935d3b0f` |  | Dropped: no licence stated. No synthetic voice ships. |
| [slp-rl/HebTTS](https://github.com/slp-rl/HebTTS) | [none stated](https://github.com/slp-rl/HebTTS) | n/a |  | Dropped: GitHub project with no licence file. No synthetic voice ships. |
| [thewh1teagle/israwave](https://github.com/thewh1teagle/israwave) | [none stated](https://github.com/thewh1teagle/israwave) | n/a |  | Dropped: GitHub project with no licence file. No synthetic voice ships. |

## Attribution lines for the app's credits page

Every CC BY model that ships or shapes shipped content:

- OPUS-MT (opus-mt-tc-big-he-en) by the Language Technology Research Group at the University of Helsinki, CC BY 4.0
- dictabert-large-char-menaked by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert-tiny-joint by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert-joint by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert-morph by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert-lex by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert-seg by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert-syntax by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert-parse by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert-large-parse by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert-tiny-parse by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert-ner by Dicta: The Israel Center for Text Analysis (ONNX build by onnx-community), CC BY 4.0
- dictabert-ner by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert-sentiment by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert-heq by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert-large-heq by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- dictabert-large by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- neodictabert by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- neodictabert-bilingual by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- MsBERT by Dicta: The Israel Center for Text Analysis, CC BY 4.0
- neodictabert-bilingual-embed by Dicta: The Israel Center for Text Analysis, CC BY 4.0
