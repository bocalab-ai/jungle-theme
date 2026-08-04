#!/usr/bin/env python3
"""Key a raw PNG painted on a solid ~black backdrop into straight-alpha RGBA."""

import argparse

import numpy as np
from PIL import Image, ImageFilter

T_BG = 14
T_FG = 40
SOFT_PX = 2


def _border_connected(dark):
    """4-connected flood fill of `dark` seeded from every border pixel.

    Horizontal closure is done in one vectorised pass over per-row runs, so the
    loop only iterates once per vertical turn of the backdrop, not once per pixel.
    """
    h, w = dark.shape
    flat = dark.reshape(-1)

    starts = np.empty(flat.shape, dtype=bool)
    starts[0] = True
    starts[1:] = flat[1:] != flat[:-1]
    starts.reshape(h, w)[:, 0] = True
    run_id = (np.cumsum(starts) - 1).astype(np.int64)
    n_runs = int(run_id[-1]) + 1

    reach = np.zeros_like(dark)
    reach[0, :] = dark[0, :]
    reach[-1, :] = dark[-1, :]
    reach[:, 0] = dark[:, 0]
    reach[:, -1] = dark[:, -1]

    while True:
        hit = np.bincount(run_id, weights=reach.reshape(-1), minlength=n_runs) > 0
        grown = hit[run_id].reshape(h, w) & dark
        spread = grown.copy()
        spread[1:, :] |= grown[:-1, :]
        spread[:-1, :] |= grown[1:, :]
        spread &= dark
        if np.array_equal(spread, reach):
            return reach
        reach = spread


def _erode(mask, px):
    if px <= 0:
        return mask
    img = Image.fromarray(np.where(mask, 255, 0).astype(np.uint8), "L")
    for _ in range(px):
        img = img.filter(ImageFilter.MinFilter(3))
    return np.asarray(img) > 127


def key_image(img, t_bg=T_BG, t_fg=T_FG, soft_px=SOFT_PX):
    if t_fg <= t_bg:
        raise ValueError("--t-fg must be greater than --t-bg")

    rgb = np.asarray(img.convert("RGB"), dtype=np.float32)
    lum = rgb.max(axis=2)

    background = _border_connected(lum < t_bg)
    foreground = ~background
    core = _erode(foreground, soft_px)

    ramp = np.clip((lum - t_bg) / float(t_fg - t_bg), 0.0, 1.0)
    alpha = np.where(core, 1.0, np.where(foreground, ramp, 0.0))

    a8 = np.rint(alpha * 255.0).astype(np.uint8)
    soft = (a8 > 0) & (a8 < 255)

    out = rgb.copy()
    scale = np.zeros_like(alpha)
    np.divide(255.0, a8, out=scale, where=soft)
    out[soft] = np.clip(rgb[soft] * scale[soft][:, None], 0.0, 255.0)
    out[a8 == 0] = 0.0

    keyed = np.dstack([np.rint(out).astype(np.uint8), a8])
    stats = {
        "transparent": float((a8 == 0).mean() * 100.0),
        "soft": float(soft.mean() * 100.0),
        "opaque": float((a8 == 255).mean() * 100.0),
    }
    return Image.fromarray(keyed, "RGBA"), stats


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--t-bg", type=int, default=T_BG)
    ap.add_argument("--t-fg", type=int, default=T_FG)
    ap.add_argument("--soft-px", type=int, default=SOFT_PX)
    args = ap.parse_args()

    src = Image.open(args.src)
    keyed, stats = key_image(src, args.t_bg, args.t_fg, args.soft_px)
    keyed.save(args.dst)
    print(
        "%s -> %s  %dx%d  transparent %.2f%%  soft %.2f%%  opaque %.2f%%"
        % (
            args.src,
            args.dst,
            keyed.width,
            keyed.height,
            stats["transparent"],
            stats["soft"],
            stats["opaque"],
        )
    )


if __name__ == "__main__":
    main()
