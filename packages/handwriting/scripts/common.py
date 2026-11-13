"""Shared pieces for the handwriting letter checker: class list and the 32x32 input format.

The input format here must stay in step with src/preprocess.js. tests/parity.test.js checks the two against each other
with fixtures written by scripts/make_fixtures.py.

Input format ("norm32"): a 32x32 float image, 1 = ink, 0 = paper. The ink's bounding box is scaled (aspect kept) so its
longer side is 24 pixels, and centred. Pen thickness is left as drawn: it is one of the few cues that separate a short
stroke (yod) from a long one (final nun) once size is normalised away.
"""

import numpy as np
import cv2

SIZE = 32
BOX = 24
INK_MIN = 0.25

# 22 letters, then the 5 final forms, then "not a letter". Ids match Al-Heb data/letters/letters.json.
CLASSES = [
    ("alef", "א"),
    ("bet", "ב"),
    ("gimel", "ג"),
    ("dalet", "ד"),
    ("he", "ה"),
    ("vav", "ו"),
    ("zayin", "ז"),
    ("chet", "ח"),
    ("tet", "ט"),
    ("yod", "י"),
    ("kaf", "כ"),
    ("lamed", "ל"),
    ("mem", "מ"),
    ("nun", "נ"),
    ("samekh", "ס"),
    ("ayin", "ע"),
    ("pe", "פ"),
    ("tsadi", "צ"),
    ("qof", "ק"),
    ("resh", "ר"),
    ("shin", "ש"),
    ("tav", "ת"),
    ("kaf-final", "ך"),
    ("mem-final", "ם"),
    ("nun-final", "ן"),
    ("pe-final", "ף"),
    ("tsadi-final", "ץ"),
    ("not-a-letter", ""),
]
IDS = [c[0] for c in CLASSES]
CHARS = [c[1] for c in CLASSES]
NOT_A_LETTER = len(CLASSES) - 1
CHAR_TO_INDEX = {ch: i for i, (_, ch) in enumerate(CLASSES) if ch}

# The pairs and groups the acceptance bar names.
CONFUSABLE_GROUPS = [("bet", "kaf"), ("dalet", "resh"), ("he", "chet"), ("vav", "zayin", "nun-final"), ("samekh", "mem-final")]

# HHD_v0 folder number -> class index. The folders run through the alphabet with each final form right after its letter.
HHD_ORDER = "אבגדהוזחטיכךלמםנןסעפףצץקרשת"
HHD_TO_INDEX = [CHAR_TO_INDEX[ch] for ch in HHD_ORDER]


def norm32(ink: np.ndarray) -> np.ndarray:
    """ink: float HxW in 0..1 (1 = ink). Returns float32 32x32."""
    out = np.zeros((SIZE, SIZE), np.float32)
    ys, xs = np.where(ink > INK_MIN)
    if len(xs) == 0:
        return out
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    crop = ink[y0:y1, x0:x1].astype(np.float32)
    h, w = crop.shape
    s = BOX / max(h, w)
    nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
    small = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
    ox, oy = (SIZE - nw) // 2, (SIZE - nh) // 2
    out[oy : oy + nh, ox : ox + nw] = np.clip(small, 0, 1)
    return out


def strokes_to_32(strokes, pen: float = 1.3) -> np.ndarray:
    """Draw pen strokes straight into the input format. Mirrors strokesTo32() in src/preprocess.js.

    strokes: list of polylines [[x, y], ...] in any units (y down). pen: pen radius in output pixels.
    A pixel's ink is clamp(pen + 0.5 - distance to the nearest stroke segment, 0, 1).
    """
    out = np.zeros((SIZE, SIZE), np.float32)
    strokes = [np.asarray(s, np.float64) for s in strokes if len(s) >= 1]
    if not strokes:
        return out
    pts = np.concatenate(strokes)
    x0, y0 = pts.min(0)
    x1, y1 = pts.max(0)
    span = max(x1 - x0, y1 - y0)
    inner = BOX - 2 * pen
    s = inner / span if span > 1e-9 else 0.0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    px, py = xx + 0.5, yy + 0.5
    best = np.full((SIZE, SIZE), 1e9)
    for st in strokes:
        q = (st - [cx, cy]) * s + SIZE / 2
        if len(q) == 1:
            q = np.concatenate([q, q])
        for a, b in zip(q[:-1], q[1:]):
            dx, dy = b - a
            L2 = dx * dx + dy * dy
            t = np.zeros_like(px) if L2 < 1e-12 else np.clip(((px - a[0]) * dx + (py - a[1]) * dy) / L2, 0, 1)
            d = np.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))
            best = np.minimum(best, d)
    return np.clip(pen + 0.5 - best, 0, 1).astype(np.float32)


def scan_to_ink(gray: np.ndarray) -> np.ndarray:
    """A scanned or photographed letter (dark ink on light paper, uint8) -> ink map 0..1 with the paper levelled out."""
    g = gray.astype(np.float32)
    paper = np.percentile(g, 95)
    dark = np.percentile(g, 2)
    if paper - dark < 20:
        return np.zeros_like(g)
    return np.clip((paper - g) / (paper - dark), 0, 1)
