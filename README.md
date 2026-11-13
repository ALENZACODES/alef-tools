# alef-tools

Tools for the open Hebrew language models used by ALEF, a Hebrew-learning app
([ALENZACODES/Al-Heb](https://github.com/ALENZACODES/Al-Heb)).

This repo holds the model code: conversion scripts, in-browser loaders, offline
build pipelines, tests, and one manifest that records every model's licence and
pinned revision. The app pulls in a fixed version of what is built here.

Nothing here runs on a server. Models run in the learner's browser, or offline
at build time.

## Licence

Code in this repo is under the MIT licence (see `LICENSE`).

Model weights are **not** covered by that licence. Each model keeps its own
licence, recorded per model in `models.manifest.json` once it is added.
No model weights are stored in this repo.
