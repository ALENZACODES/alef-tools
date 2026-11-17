#!/usr/bin/env python3
"""Build the training and test arrays for the letter checker.

Sources (each one recorded in the output's meta.json):
  1. Letters rendered from the OFL fonts pinned in fonts/fonts.json (downloaded here, checked by SHA-256, never stored in git).
     Each glyph is drawn as the font draws it and also re-drawn as a pen line along its skeleton, at several pen widths.
  2. Optional: the app's own stroke templates (Al-Heb data/letters/letters.json, print and cursive), drawn as pen strokes
     with wobble. Pass --strokes PATH. The file is read, not copied.
  3. Optional: HHD_v0 real handwriting (CC-BY-4.0, Zenodo 10.5281/zenodo.4287442). Pass --hhd DIR (the folder holding TRAIN/ and TEST/).
     TRAIN goes to training; TEST is kept apart as the held-out real-handwriting test set.
  4. "Not a letter": scribbles, zigzags and a few Latin letters, digits and signs that do not look like a Hebrew letter.

Usage:
  python scripts/render_fonts.py --out build/data [--strokes ../Al-Heb/data/letters/letters.json] [--hhd build/hhd_dataset] [--fonts-dir build/fonts]
"""

import argparse
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont
from skimage.morphology import skeletonize

sys.path.insert(0, str(Path(__file__).parent))
from common import CHARS, IDS, NOT_A_LETTER, HHD_TO_INDEX, norm32, strokes_to_32, scan_to_ink

HERE = Path(__file__).resolve().parent.parent
NOT_LETTER_GLYPHS = list("ABEFHMQRSWZ245&@#%?+*abfgkmtwx")
WEIGHTS = (300, 400, 600, 800)


def fetch_fonts(fonts_dir: Path):
    spec = json.loads((HERE / "fonts/fonts.json").read_text())
    fonts_dir.mkdir(parents=True, exist_ok=True)
    out = []
    for f in spec["fonts"]:
        p = fonts_dir / (f["dir"].split("/")[-1] + "-" + f["file"])
        if not p.exists():
            print("fetching", f["url"], file=sys.stderr)
            p.write_bytes(urllib.request.urlopen(f["url"], timeout=120).read())
        got = hashlib.sha256(p.read_bytes()).hexdigest()
        if got != f["sha256"]:
            raise SystemExit(f"{p.name}: SHA-256 {got} does not match fonts.json")
        out.append((f, p))
    return out


def glyph(font_path: Path, ch: str, weight=None, px=96) -> np.ndarray:
    font = ImageFont.truetype(str(font_path), px)
    if weight is not None:
        try:
            axes = font.get_variation_axes()
            vals = []
            for a in axes:
                tag = a.get("name", b"")
                is_w = tag == b"Weight" or tag == "Weight"
                vals.append(min(a["maximum"], max(a["minimum"], weight)) if is_w else a["default"])
            font.set_variation_by_axes(vals)
        except Exception:
            pass
    im = Image.new("L", (px * 2, px * 2), 0)
    ImageDraw.Draw(im).text((px // 2, px // 3), ch, font=font, fill=255)
    return np.asarray(im, np.float32) / 255


def pen_version(ink: np.ndarray, radius: int) -> np.ndarray:
    sk = skeletonize(ink > 0.5).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
    return cv2.GaussianBlur(cv2.dilate(sk, k).astype(np.float32), (0, 0), 0.8)


def wobble(strokes, rng, amount):
    """Hand tremor and placement error for template strokes (0..1000 units)."""
    out = []
    ang = rng.normal(0, 0.06)
    sx, sy = 1 + rng.normal(0, 0.08), 1 + rng.normal(0, 0.08)
    c, s = np.cos(ang), np.sin(ang)
    for st in strokes:
        p = np.asarray(st, np.float64)
        n = len(p)
        drift = np.cumsum(rng.normal(0, amount * 0.25, (n, 2)), 0)
        drift -= np.linspace(0, 1, n)[:, None] * drift[-1] * rng.uniform(0.3, 1)
        p = p + drift + rng.normal(0, amount * 0.15, (n, 2)) + rng.normal(0, amount * 2.0, (1, 2))
        if n > 3 and rng.random() < 0.25:  # started late or stopped early
            cut = int(n * rng.uniform(0.03, 0.12))
            p = p[cut:] if rng.random() < 0.5 else p[: n - cut]
        p = (p - 500) * [sx, sy]
        p = np.stack([p[:, 0] * c - p[:, 1] * s, p[:, 0] * s + p[:, 1] * c], 1) + 500
        out.append(p)
    return out


def scribble(rng):
    kind = rng.integers(0, 5)
    if kind == 0:  # random walk
        n = rng.integers(25, 70)
        return [np.cumsum(rng.normal(0, 40, (n, 2)), 0)]
    if kind == 1:  # zigzag
        n = rng.integers(5, 12)
        x = np.linspace(0, 600, n) + rng.normal(0, 15, n)
        y = np.where(np.arange(n) % 2 == 0, 0, rng.uniform(150, 500)) + rng.normal(0, 20, n)
        p = np.stack([x, y], 1)
        return [p if rng.random() < 0.5 else p[:, ::-1]]
    if kind == 2:  # spiral with several turns
        t = np.linspace(0, rng.uniform(4, 9) * np.pi, 120)
        r = 30 + t * rng.uniform(15, 30)
        return [np.stack([r * np.cos(t), r * np.sin(t) * rng.uniform(0.6, 1)], 1)]
    if kind == 3:  # several unrelated strokes
        return [np.cumsum(rng.normal(0, 60, (rng.integers(3, 9), 2)), 0) + rng.uniform(0, 500, 2) for _ in range(rng.integers(3, 7))]
    n = rng.integers(3, 7)  # hatching
    return [np.array([[0, i * 90 + rng.normal(0, 8)], [rng.uniform(350, 600), i * 90 + rng.normal(0, 25)]]) for i in range(n)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="build/data")
    ap.add_argument("--fonts-dir", default="build/fonts")
    ap.add_argument("--strokes")
    ap.add_argument("--hhd")
    ap.add_argument("--seed", type=int, default=20261112)
    ap.add_argument("--strokes-per-letter", type=int, default=300)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sets = {k: ([], [], []) for k in ("train", "font_heldout", "hhd_test")}  # images, labels, source tag
    SRC = {"font": 0, "font-pen": 1, "strokes": 2, "hhd": 3, "not-letter": 4}

    def add(split, img, label, src):
        X, Y, S = sets[split]
        X.append((img * 255).round().astype(np.uint8))
        Y.append(label)
        S.append(SRC[src])

    fonts = fetch_fonts(Path(a.fonts_dir))
    for spec, path in fonts:
        split = "font_heldout" if spec["split"] == "heldout" else "train"
        variable = "[" in spec["file"] and "wght" in spec["file"]
        for w in WEIGHTS if variable else (None,):
            for ci, ch in enumerate(CHARS[:27]):
                g = glyph(path, ch, w)
                if g.max() < 0.5:
                    continue
                add(split, norm32(g), ci, "font")
                for r in (2, 3, 5, 7):
                    add(split, norm32(pen_version(g, r)), ci, "font-pen")
            if split == "train" and (w in (None, 400)):
                for ch in NOT_LETTER_GLYPHS:
                    g = glyph(path, ch, w)
                    if g.max() >= 0.5:
                        add("train", norm32(pen_version(g, int(rng.integers(2, 6)))), NOT_A_LETTER, "not-letter")
    for _ in range(4000):
        add("train", strokes_to_32(scribble(rng), pen=float(rng.uniform(0.8, 2.0))), NOT_A_LETTER, "not-letter")

    meta = {
        "seed": a.seed,
        "classes": IDS,
        "fonts": [{"id": s["id"], "split": s["split"], "style": s["style"], "sha256": s["sha256"]} for s, _ in fonts],
        "sources": ["fonts (OFL-1.1, google/fonts pinned commit)"],
    }
    if a.strokes:
        letters = json.loads(Path(a.strokes).read_text())
        n = 0
        for L in letters:
            ci = IDS.index(L["id"])
            for script in ("print", "cursive"):
                block = L.get(script) or {}
                med = [s["median"] for s in block.get("strokes", []) if s.get("median")]
                if not med:
                    continue
                for _ in range(a.strokes_per_letter):
                    add(
                        "train",
                        strokes_to_32(wobble(med, rng, amount=float(rng.uniform(4, 22))), pen=float(rng.uniform(0.8, 2.2))),
                        ci,
                        "strokes",
                    )
                    n += 1
        meta["sources"].append(
            f"app stroke templates ({n} drawn with wobble; file sha256 {hashlib.sha256(Path(a.strokes).read_bytes()).hexdigest()})"
        )
    if a.hhd:
        counts = {}
        for split, name in (("TRAIN", "train"), ("TEST", "hhd_test")):
            for folder in range(27):
                files = sorted((Path(a.hhd) / split / str(folder)).glob("*.png"))
                for f in files:
                    gray = cv2.imread(str(f), cv2.IMREAD_GRAYSCALE)
                    if gray is None:
                        continue
                    add(name, norm32(scan_to_ink(gray)), HHD_TO_INDEX[folder], "hhd")
                counts[f"{split}/{folder}"] = len(files)
        meta["sources"].append(
            "HHD_v0 real handwriting, CC-BY-4.0, doi:10.5281/zenodo.4287442 (TRAIN -> train, TEST -> held-out test; folder 27 of TRAIN, a stray mark, is not used)"
        )
        meta["hhd_counts"] = counts
    for name, (X, Y, S) in sets.items():
        if X:
            np.savez_compressed(out / f"{name}.npz", x=np.stack(X), y=np.array(Y, np.int16), src=np.array(S, np.int8))
            meta[f"n_{name}"] = len(X)
    meta["src_codes"] = SRC
    (out / "meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    print(json.dumps({k: v for k, v in meta.items() if k.startswith("n_")}))


if __name__ == "__main__":
    main()
