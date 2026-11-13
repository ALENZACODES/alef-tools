#!/usr/bin/env python3
"""Train the letter checker (a small CNN, 28 outputs: 27 letter forms + "not a letter").

  python scripts/train.py --data build/data --out build/run --epochs 30

Model selection uses a validation slice cut from the training data (a tenth of the real-handwriting training images plus
a tenth of the rest). The held-out sets (hhd_test, font_heldout) are only scored by scripts/eval.py after training.
"""

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

WIDTHS = {"s": (16, 32, 32, 64, 64, 128), "m": (24, 48, 48, 96, 96, 192), "l": (32, 64, 64, 128, 128, 224)}


class LetterNet(nn.Module):
    """conv-bn-relu x6 with three 2x2 max-pools, global average pool, one linear layer. Plain ops only, so the same
    weights run in onnxruntime-web and in the small built-in runner (src/classify.js)."""

    def __init__(self, width="m", classes=28):
        super().__init__()
        c = WIDTHS[width]
        chans = [1, *c]
        self.convs = nn.ModuleList(nn.Conv2d(chans[i], chans[i + 1], 3, padding=1, bias=False) for i in range(6))
        self.bns = nn.ModuleList(nn.BatchNorm2d(chans[i + 1]) for i in range(6))
        self.pool_after = (0, 2, 4)
        self.drop = nn.Dropout(0.2)
        self.fc = nn.Linear(c[-1], classes)

    def forward(self, x):
        for i, (conv, bn) in enumerate(zip(self.convs, self.bns)):
            x = F.relu(bn(conv(x)))
            if i in self.pool_after:
                x = F.max_pool2d(x, 2)
        x = x.mean((2, 3))
        return self.fc(self.drop(x))


def augment(x, rng: torch.Generator, strong: torch.Tensor):
    """x: N,1,32,32 in 0..1. Small rotation, shear, stretch and shift, pen thicker or thinner, a little blur and noise."""
    n = x.shape[0]
    def r(lo, hi):
        return torch.empty(n).uniform_(lo, hi, generator=rng)

    k = 1 + strong * 0.6
    ang = r(-0.16, 0.16) * k
    sh = r(-0.22, 0.22) * k
    sx, sy = r(0.86, 1.12), r(0.86, 1.12)
    tx, ty = r(-0.07, 0.07), r(-0.07, 0.07)
    cos, sin = torch.cos(ang), torch.sin(ang)
    theta = torch.stack([torch.stack([cos / sx, (-sin + sh) / sx, tx], 1), torch.stack([sin / sy, cos / sy, ty], 1)], 1)
    grid = F.affine_grid(theta, list(x.shape), align_corners=False)
    x = F.grid_sample(x, grid, padding_mode="zeros", align_corners=False)
    u = torch.rand(n, generator=rng)
    thick = F.max_pool2d(x, 3, 1, 1)
    thin = -F.max_pool2d(-x, 3, 1, 1)
    thin = torch.where(thin.flatten(1).sum(1).view(-1, 1, 1, 1) > 12, thin, x)  # do not erase a hairline letter
    x = torch.where((u < 0.25).view(-1, 1, 1, 1), thick, torch.where((u > 0.8).view(-1, 1, 1, 1), thin, x))
    b = torch.rand(n, generator=rng) < 0.3
    x = torch.where(b.view(-1, 1, 1, 1), F.avg_pool2d(x, 3, 1, 1), x)
    x = x * r(0.75, 1.0).view(-1, 1, 1, 1) + torch.randn(x.shape, generator=rng) * 0.04
    # a bit of a neighbouring letter at an edge, as in cut-out handwriting
    e = torch.rand(n, generator=rng) < 0.1 * strong
    if e.any():
        strip = torch.zeros_like(x)
        w = int(torch.randint(1, 4, (1,), generator=rng))
        if torch.rand(1, generator=rng) < 0.5:
            strip[:, :, :, :w] = 0.8
        else:
            strip[:, :, :, -w:] = 0.8
        mask = (torch.rand(x.shape[0], 1, 32, 1, generator=rng) < 0.4).float()
        x = torch.where(e.view(-1, 1, 1, 1), torch.maximum(x, strip * mask), x)
    return x.clamp(0, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="build/data")
    ap.add_argument("--out", default="build/run")
    ap.add_argument("--width", default="m", choices=list(WIDTHS))
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--steps-per-epoch", type=int, default=100)
    ap.add_argument("--batch", type=int, default=192)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--real-share", type=float, default=0.45, help="share of each batch drawn from real handwriting")
    a = ap.parse_args()
    torch.manual_seed(a.seed)
    np.random.seed(a.seed)
    torch.set_num_threads(2)
    d = np.load(Path(a.data) / "train.npz")
    x = torch.from_numpy(d["x"]).float().div(255).unsqueeze(1)
    y = torch.from_numpy(d["y"]).long()
    src = torch.from_numpy(d["src"]).long()
    g = torch.Generator().manual_seed(a.seed)
    perm = torch.randperm(len(x), generator=g)
    val = torch.zeros(len(x), dtype=torch.bool)
    val[perm[: len(x) // 10]] = True
    real = src == 3
    tr_real = torch.where(real & ~val)[0]
    tr_syn = torch.where(~real & ~val)[0]
    xv, yv, sv = x[val], y[val], src[val]
    print(f"train real {len(tr_real)} synthetic {len(tr_syn)}; validation {int(val.sum())} (real {int((sv == 3).sum())})", flush=True)
    model = LetterNet(a.width)
    nparams = sum(p.numel() for p in model.parameters())
    print("parameters", nparams, flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=5e-4)
    total = a.epochs * a.steps_per_epoch
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=total, pct_start=0.15)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    n_real = int(a.batch * a.real_share) if len(tr_real) else 0
    best = (-1, None)
    log = []
    t0 = time.time()
    for ep in range(a.epochs):
        model.train()
        tot = 0.0
        for _ in range(a.steps_per_epoch):
            ir = tr_real[torch.randint(len(tr_real), (n_real,), generator=g)] if n_real else tr_real[:0]
            isy = tr_syn[torch.randint(len(tr_syn), (a.batch - n_real,), generator=g)]
            idx = torch.cat([ir, isy])
            strong = torch.cat([torch.zeros(n_real), torch.ones(a.batch - n_real)])
            xb = augment(x[idx], g, strong)
            yb = y[idx]
            loss = F.cross_entropy(model(xb), yb, label_smoothing=0.1)
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            tot += loss.item()
        model.eval()
        with torch.no_grad():
            pred = torch.cat([model(xv[i : i + 1024]).argmax(1) for i in range(0, len(xv), 1024)])
        acc_real = (pred[sv == 3] == yv[sv == 3]).float().mean().item() if (sv == 3).any() else float("nan")
        acc_syn = (pred[sv != 3] == yv[sv != 3]).float().mean().item()
        score = acc_real if not math.isnan(acc_real) else acc_syn
        log.append(
            {
                "epoch": ep + 1,
                "loss": tot / a.steps_per_epoch,
                "val_real": acc_real,
                "val_synthetic": acc_syn,
                "seconds": round(time.time() - t0),
            }
        )
        print(json.dumps(log[-1]), flush=True)
        if score >= best[0]:
            best = (score, ep + 1)
            torch.save({"state": model.state_dict(), "width": a.width, "epoch": ep + 1}, out / "best.pt")
    torch.save({"state": model.state_dict(), "width": a.width, "epoch": a.epochs}, out / "last.pt")
    (out / "train-log.json").write_text(
        json.dumps({"args": vars(a), "parameters": nparams, "best_epoch": best[1], "best_val": best[0], "log": log}, indent=1)
    )
    print("best epoch", best[1], "validation", round(best[0], 4))


if __name__ == "__main__":
    main()
