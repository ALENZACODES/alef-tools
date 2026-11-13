#!/usr/bin/env python3
"""Checks the Python helpers against tests/fixtures/parity.json (the browser code is checked against the same file).
Needs only the standard library:  python tests/test_core.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import nikud_core as core  # noqa: E402

doc = json.load(open(os.path.join(HERE, "fixtures", "parity.json"), encoding="utf-8"))
bad = 0
for c in doc["cases"]:
    for keep, key in ((True, "keep"), (False, "drop")):
        got = core.decode(c["text"], c["nikud"], c["shin"], c["extra"], keep)
        if got != c[key]:
            bad += 1
            print("decode differs:", c["text"], key)
    if core.strip_points(c["keep"]).replace(core.PREFIX, "") != c["text"]:
        bad += 1
        print("letters changed:", c["text"])
for n in doc["names"]:
    if core.guard_name(n["in"]) != (n["out"], n["found"]):
        bad += 1
        print("name guard differs:", n["in"])
for s in doc["strips"]:
    if core.strip_points(s["in"]) != s["out"]:
        bad += 1
        print("strip differs:", s["in"])
assert core.canonical("שָׁלוֹם") == core.canonical("שָׁלוֹם"), "mark order"
assert core.canonical("כׇּל", True) == core.canonical("כָּל", True), "qamats qatan folds to qamats"
print(f"{len(doc['cases'])} decode cases, {len(doc['names'])} name cases, {len(doc['strips'])} strip cases: {'OK' if not bad else str(bad) + ' FAILED'}")
sys.exit(1 if bad else 0)
