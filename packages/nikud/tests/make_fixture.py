#!/usr/bin/env python3
"""Writes tests/fixtures/parity.json from real model output (needs the model files; run by hand after a model change).

    python tests/make_fixture.py <tokenizer.json> <menaked onnx> <phonikud onnx>

Each case stores the classes the model chose for every character, and the text the Python helpers make of them.
tests/test_core.py (Python) and tests/parity.test.js (browser code) must both reproduce that text from the classes.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import nikud_core as core  # noqa: E402
from eval_accuracy import Model  # noqa: E402

LINES = [
    "שלום, מה שלומך היום?", "אני רוצה להזמין קפה ועוגה, בבקשה.", "איפה התחנה המרכזית? אני צריך להגיע לירושלים לפני השקיעה.",
    "הילדים אהבו במיוחד את הסיפורים הללו שהמורה הקריאה.", "בשנת 1948 השלים אפרים קישון את לימודיו בפיסול מתכת.", "כל הכבוד! עשית עבודה מצוינת.",
    "היא שרה שיר ישן ששמעה מסבתא שלה בשבת בבוקר.", "ג'ינס וצ'יפס – 25 ש\"ח (מבצע!)", "Hello שלום world", "הרוח נושבת והוא שומע מוזיקה.", "ספר", "מה נשמע?",
]
tok, men, pho = sys.argv[1:4]
vocab = core.load_vocab(tok)
cases = []
for name, path, enhanced in (("menaked", men, False), ("phonikud", pho, True)):
    m = Model(path, vocab)
    for line in LINES:
        o = m.raw(line)
        nik = o["nikud_logits"][0, 1:-1].argmax(-1).tolist()
        shin = o["shin_logits"][0, 1:-1].argmax(-1).tolist()
        extra = (o["additional_logits"][0, 1:-1] > 0).astype(int).tolist() if enhanced else None
        cases.append({"model": name, "text": line, "ids": core.encode(line, vocab), "nikud": nik, "shin": shin, "extra": extra,
                      "keep": core.decode(line, nik, shin, extra, True), "drop": core.decode(line, nik, shin, extra, False)})
names = ["ברוך אתה יהוה אלהינו", "בָּרוּךְ אַתָּה יְהוָה", "הודו ליהוה כי טוב", "וַיהוָה", "יהודה אמר שלום", "ברוך ה׳", "בָּרוּךְ אַתָּה יְיָ"]
strips = ["שָׁלוֹם", "בְּרֵאשִׁ֖ית בָּרָ֣א", "כׇּל־הָאָרֶץ", "abc שָׂדֶה"]
doc = {"cases": cases, "names": [{"in": t, "out": core.guard_name(t)[0], "found": core.guard_name(t)[1]} for t in names],
       "strips": [{"in": t, "out": core.strip_points(t)} for t in strips]}
json.dump(doc, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "parity.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print(len(cases), "cases")
