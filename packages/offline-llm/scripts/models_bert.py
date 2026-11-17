"""The encoder models of the pipeline (transformers / sentence-transformers). Build time only.

Each class loads one pinned model from $ALEF_MODELS/<key>/ (scripts/fetch_models.py) and never reaches the network.
"""
from __future__ import annotations

import os
from pathlib import Path

from common import manifest_model, strip_points

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
MODELS = Path(os.environ.get("ALEF_MODELS", Path.home() / ".cache" / "alef-tools" / "models"))


def _dir(key: str) -> str:
    p = MODELS / key
    if not p.exists():
        raise FileNotFoundError(f"{p} is missing; run scripts/fetch_models.py {key}")
    return str(p)


def _tag(key: str) -> dict:
    m = manifest_model(key)
    return {"key": key, "id": m["id"], "revision": m["revision"]}


class Embedder:
    """dicta-il/neodictabert-bilingual-embed: unit-length sentence vectors for Hebrew or English text."""

    def __init__(self, key: str = "embed"):
        from sentence_transformers import SentenceTransformer

        self.tag = _tag(key)
        self.model = SentenceTransformer(_dir(key), trust_remote_code=True, device="cpu")

    def encode(self, texts, batch: int = 16, progress: bool = False):
        return self.model.encode(list(texts), batch_size=batch, normalize_embeddings=True, show_progress_bar=progress, convert_to_numpy=True)

    def close(self):
        del self.model


class SpanFinder:
    """dicta-il/dictabert-heq: the words of a Hebrew passage that answer a Hebrew question."""

    def __init__(self, key: str = "heq"):
        from transformers import pipeline

        self.tag = _tag(key)
        self.pipe = pipeline("question-answering", model=_dir(key), device=-1)

    def find(self, question: str, context: str) -> tuple[str, float]:
        r = self.pipe(question=question, context=context)
        return r["answer"], float(r["score"])


class Morph:
    """dicta-il/dictabert-joint (Lane 4's model): lemma, part of speech, gender, number and syntax per word."""

    def __init__(self, key: str = "morph"):
        from transformers import AutoModel, AutoTokenizer

        self.tag = _tag(key)
        self.tok = AutoTokenizer.from_pretrained(_dir(key))
        self.model = AutoModel.from_pretrained(_dir(key), trust_remote_code=True)
        self.model.eval()

    def analyse(self, sentences: list[str]) -> list[dict]:
        return self.model.predict([strip_points(s) for s in sentences], self.tok, output_style="json")


class Translator:
    """Helsinki-NLP/opus-mt-tc-big-he-en (Lane 1's model): Hebrew to English, for the round-trip check."""

    def __init__(self, key: str = "mt-he-en"):
        from transformers import MarianMTModel, MarianTokenizer

        self.tag = _tag(key)
        self.tok = MarianTokenizer.from_pretrained(_dir(key))
        self.model = MarianMTModel.from_pretrained(_dir(key))
        self.model.eval()

    def translate(self, sentences: list[str]) -> list[str]:
        import torch

        out = []
        for i in range(0, len(sentences), 8):
            batch = self.tok([strip_points(s) for s in sentences[i:i + 8]], return_tensors="pt", padding=True)
            with torch.no_grad():
                gen = self.model.generate(**batch, num_beams=4, max_new_tokens=64)
            out += self.tok.batch_decode(gen, skip_special_tokens=True)
        return out


class Cloze:
    """dicta-il/BEREL_3.0: ranked fillers for one missing word in a Biblical or Rabbinic Hebrew line."""

    def __init__(self, key: str = "berel"):
        from transformers import pipeline

        self.tag = _tag(key)
        self.pipe = pipeline("fill-mask", model=_dir(key), device=-1)
        self.mask = self.pipe.tokenizer.mask_token

    def fill(self, words: list[str], index: int, top_k: int = 80) -> list[tuple[str, float]]:
        text = " ".join(self.mask if i == index else w for i, w in enumerate(words))
        return [(r["token_str"].strip(), float(r["score"])) for r in self.pipe(text, top_k=top_k)]
