"""Thin wrapper around llama.cpp (llama-cpp-python) for the generators and judges. Build time only.

Models are named by their key in models.manifest.json and loaded from $ALEF_MODELS/<key>/<gguf file>
(see scripts/fetch_models.py). One model is held in memory at a time.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from common import PKG, manifest_model

MODELS = Path(os.environ.get("ALEF_MODELS", Path.home() / ".cache" / "alef-tools" / "models"))
_THINK = re.compile(r"<think>.*?</think>", re.S)


def load_prompt(name: str) -> dict:
    """prompts/<name>.md -> {'system': ..., 'user': ...}. Sections start with '## system' and '## user'."""
    text = (PKG / "prompts" / f"{name}.md").read_text(encoding="utf-8")
    parts = re.split(r"^## (system|user)\s*$", text, flags=re.M)
    out = {"system": "", "user": ""}
    for i in range(1, len(parts) - 1, 2):
        out[parts[i]] = parts[i + 1].strip()
    return out


def fill(template: str, **values) -> str:
    """Replace {{name}} markers. Unknown markers are an error so a prompt never ships a hole."""
    def sub(m):
        k = m.group(1)
        if k not in values:
            raise KeyError(f"prompt needs {{{{{k}}}}}")
        return str(values[k])
    return re.sub(r"\{\{(\w+)\}\}", sub, template)


def first_json(text: str):
    """The first JSON object in a model reply, or None. Thinking blocks are dropped first."""
    text = _THINK.sub("", text or "")
    if "</think>" in text:
        text = text.split("</think>")[-1]
    start = text.find("{")
    while start >= 0:
        depth = 0
        in_str = esc = False
        for i in range(start, len(text)):
            c = text[i]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            elif c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break
        start = text.find("{", start + 1)
    return None


class Chat:
    def __init__(self, key: str, *, n_ctx: int = 2048, lora_key: str | None = None, threads: int | None = None, seed: int = 7):
        from llama_cpp import Llama

        self.key = key
        self.entry = manifest_model(key)
        path = MODELS / key / self.entry["gguf"]["file"]
        if not path.exists():
            raise FileNotFoundError(f"{path} is missing; run scripts/fetch_models.py {key} --convert")
        kw = {}
        if lora_key:
            lora = MODELS / lora_key / manifest_model(lora_key)["gguf"]["file"]
            if not lora.exists():
                raise FileNotFoundError(f"{lora} is missing; run scripts/fetch_models.py {lora_key} --convert")
            kw["lora_path"] = str(lora)
        self.llm = Llama(model_path=str(path), n_ctx=n_ctx, n_threads=threads or os.cpu_count(), seed=seed, verbose=False, **kw)

    @property
    def tag(self) -> dict:
        """What the output records about who wrote or judged an item."""
        return {"key": self.key, "id": self.entry["id"], "revision": self.entry["revision"], "file": self.entry["gguf"]["file"]}

    def ask(self, system: str, user: str, *, max_tokens: int = 256, temperature: float = 0.2, stop=None) -> str:
        messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": user}]
        try:
            r = self.llm.create_chat_completion(messages=messages, max_tokens=max_tokens, temperature=temperature, stop=stop)
        except ValueError:
            # A chat template with no system role: fold the system text into the user turn.
            r = self.llm.create_chat_completion(messages=[{"role": "user", "content": (system + "\n\n" + user).strip()}],
                                                max_tokens=max_tokens, temperature=temperature, stop=stop)
        return r["choices"][0]["message"]["content"] or ""

    def close(self):
        self.llm.close()
