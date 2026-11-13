"""Shared helpers for the offline nikud tools: the character tokenizer, turning model output into pointed text,
stripping points, and the rule for the divine Name. The browser code in ../src mirrors this file; tests/parity
checks that both give the same strings.

Nothing here downloads anything.
"""
from __future__ import annotations

import re
import unicodedata

MAT_LECT = "<MAT_LECT>"
NIKUD_CLASSES = [
    "", MAT_LECT, "ּ", "ְ", "ֱ", "ֲ", "ֳ", "ִ", "ֵ", "ֶ", "ַ", "ָ",
    "ֹ", "ֺ", "ֻ", "ְּ", "ֱּ", "ֲּ", "ֳּ", "ִּ",
    "ֵּ", "ֶּ", "ַּ", "ָּ", "ֹּ", "ֺּ", "ֻּ",
    "ׇ", "ׇּ",
]
SHIN_CLASSES = ["ׁ", "ׂ"]  # shin dot, sin dot
STRESS = "֫"       # phonikud: marks the stressed letter
VOCAL_SHVA = "ֽ"   # phonikud: marks a shva that is sounded
PREFIX = "|"            # phonikud: marks the end of a prefix (ve-, ha-, be- ...)
MATRES = "אוי"
UNK, CLS, SEP, PAD = 0, 1, 2, 3
MAX_CHARS = 2046

# Vowel points, dagesh, shin and sin dots, cantillation, meteg, rafe, qamats qatan. Maqaf, paseq, sof pasuq are kept.
POINTS = re.compile("[֑-ׇֽֿׁׂׅׄ]")
VOWEL_POINTS = re.compile("[ְ-ׇּׁׂ]")
CANTILLATION = re.compile("[֑-֯]")
HEB_WORD = re.compile("[א-ת֑-ֽֿ-ׇ]+")
NAME = "יהוה"
NAME_SHOWN = "ה׳"  # he + geresh
NAME_PREFIXES = "ובלמכשה"


def strip_points(text: str) -> str:
    return POINTS.sub("", text)


def has_points(text: str) -> bool:
    return bool(VOWEL_POINTS.search(text))


def is_letter(ch: str) -> bool:
    return "א" <= ch <= "ת"


def letters_of(word: str) -> str:
    return "".join(c for c in word if is_letter(c))


def is_name_word(word: str) -> str | None:
    """Returns the prefix letters ('' for the bare Name) when the word is the four-letter Name, else None."""
    c = letters_of(word)
    if c == NAME:
        return ""
    if c == "יי" and all(is_letter(x) or POINTS.match(x) for x in word):
        return ""
    m = re.fullmatch(f"([{NAME_PREFIXES}]{{1,3}}){NAME}", c)
    return m.group(1) if m else None


def guard_name(text: str) -> tuple[str, bool]:
    """Writes the divine Name as he + geresh. Returns (text, found). Text that already has he + geresh counts as found."""
    found = NAME_SHOWN in text or "ה'" in text

    def sub(m: re.Match) -> str:
        nonlocal found
        p = is_name_word(m.group(0))
        if p is None:
            return m.group(0)
        found = True
        return p + NAME_SHOWN

    return HEB_WORD.sub(sub, text), found


def load_vocab(path: str) -> dict[str, int]:
    """Character -> id, from the model's tokenizer.json (or a folder that holds it). vocab.txt is not used: it stores
    the line-break character as a real line break and cannot be read back."""
    import json
    import os
    if os.path.isdir(path):
        path = os.path.join(path, "tokenizer.json")
    elif path.endswith("vocab.txt"):
        path = os.path.join(os.path.dirname(path), "tokenizer.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)["model"]["vocab"]


# The model's tokenizer turns every character outside these ranges into [UNK], whatever the table holds.
_ALLOWED = ((0x0000, 0x007F), (0x0590, 0x05FF), (0x200C, 0x203F), (0x20A0, 0x20BF), (0x2150, 0x218B), (0x2200, 0x22FF), (0xFB00, 0xFB4F))


def char_id(ch: str, vocab: dict[str, int]) -> int:
    n = unicodedata.normalize("NFKC", ch).lower()[:1]
    if not n or not any(lo <= ord(n) <= hi for lo, hi in _ALLOWED):
        return UNK
    return vocab.get(n, UNK)


def encode(text: str, vocab: dict[str, int]) -> list[int]:
    """One id per character of `text` (which must already have no points), with [CLS] first and [SEP] last.
    The model's own tokenizer gives the same ids for ordinary text. It differs only where one character stands for several
    (an ellipsis is three full stops to it; here it is one) and for a run of characters outside its table (one [UNK] for
    the run there, one per character here). Keeping one id per character is what lets marks land on the right letter."""
    return [CLS] + [char_id(ch, vocab) for ch in text] + [SEP]


def decode(text: str, nikud_ids, shin_ids, extra=None, keep_matres: bool = True) -> str:
    """`text` has no points. nikud_ids / shin_ids hold one class per character (without [CLS]/[SEP]).
    extra: optional per-character (stress, vocal_shva, prefix) booleans from phonikud.
    keep_matres: a vowel letter (alef, vav, yod used only to carry a vowel) is kept. With False it is dropped, which is
    the menaked model's own default and changes the spelling.
    A kept vowel-letter vav takes the vowel it stands for, the way pointed full spelling is printed: a holam on the letter
    before moves onto the vav, and a kubutz on the letter before becomes a dot in the vav.
    """
    out = []          # one entry per character: [letter, shin dot, marks, extra marks] or a plain string
    last = None       # index in `out` of the last letter that carries marks
    for i, ch in enumerate(text):
        if not is_letter(ch):
            out.append(ch)
            last = None
            continue
        nik = NIKUD_CLASSES[int(nikud_ids[i])]
        shin = SHIN_CLASSES[int(shin_ids[i])] if ch == "ש" else ""
        if nik == MAT_LECT:
            if ch in MATRES:
                if keep_matres:
                    carried = ""
                    if ch == "ו" and last is not None:
                        prev = out[last]
                        if prev[2].endswith("\u05b9"):
                            prev[2], carried = prev[2][:-1], "\u05b9"
                        elif prev[2].endswith("\u05bb"):
                            prev[2], carried = prev[2][:-1], "\u05bc"
                    out.append([ch, "", carried, ""])
                    last = None
                continue
            nik = ""
        marks = ""
        if extra is not None:
            s, v, p = extra[i]
            marks = (STRESS if s else "") + (VOCAL_SHVA if v else "") + (PREFIX if p else "")
        out.append([ch, shin, nik, marks])
        last = len(out) - 1
    return "".join(x if isinstance(x, str) else "".join(x) for x in out)


def split_words(text: str) -> list[str]:
    return HEB_WORD.findall(text)


# Comparison forms -----------------------------------------------------------------------------------------------
_ORDER = {"ׁ": 0, "ׂ": 0, "ּ": 1}


def canonical(word: str, fold_qamats_qatan: bool = False, drop_dagesh: bool = False) -> str:
    """A pointed word in one fixed mark order (shin/sin dot, dagesh, vowel), without cantillation, meteg or rafe."""
    w = CANTILLATION.sub("", unicodedata.normalize("NFC", word)).replace("ֽ", "").replace("ֿ", "")
    w = w.replace("ֺ", "ֹ")  # holam haser for vav is shown as holam
    if fold_qamats_qatan:
        w = w.replace("ׇ", "ָ")
    if drop_dagesh:
        w = w.replace("ּ", "")
    out, marks = [], []

    def flush():
        out.extend(sorted(marks, key=lambda m: _ORDER.get(m, 2)))
        marks.clear()

    for ch in w:
        if "ְ" <= ch <= "ׇ" and ch not in "־׀׃׆":
            marks.append(ch)
        else:
            flush()
            out.append(ch)
    flush()
    return "".join(out)
