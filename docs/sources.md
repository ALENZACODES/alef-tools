# Reading lists

Where the model list in `PLAN.md` and `models.manifest.json` came from, and where to look for new Hebrew models.
Nothing on these lists ships by being listed: a model is used only after its licence and revision are recorded in the manifest.

| List | Where | What it is |
|---|---|---|
| NNLP-IL Hebrew Resources | https://github.com/NNLP-IL/Hebrew-Resources and https://resources.nnlp-il.mafat.ai/ | The Israeli National NLP Program's catalogue of Hebrew corpora, models and tools. |
| awesome-hebrew-nlp | https://github.com/iddoberger/awesome-hebrew-nlp | A community list of Hebrew NLP libraries, datasets and models. |
| danielrosehill collections | https://huggingface.co/danielrosehill/collections | Hugging Face collections by topic: Hebrew ASR, TTS, OCR, diacritic restoration, punctuation, translation, sentiment, code-switching. |
| Dicta models | https://huggingface.co/dicta-il | DictaBERT, DictaLM and BEREL, the models most of the lanes build on. |
| ivrit.ai models | https://huggingface.co/ivrit-ai | Hebrew speech recognition models and their ports. |

Checked on 12 November 2026: the two Hugging Face pages and the NNLP-IL site answered. The two GitHub pages could not be
opened from the build session (GitHub access there is limited to this project's own repositories), so those two links are
as given in PLAN.md and were not re-checked.

## Adding a model

1. Read its licence on the model page, not only the tag. No licence, "other", or non-commercial means tier X or Q.
2. Add an entry to `models.manifest.json` with the tier and the reason.
3. Run `node scripts/pin-revisions.mjs --write` to pin the revision, then `node scripts/build-licences.mjs`.
4. Run `npm run check`.
