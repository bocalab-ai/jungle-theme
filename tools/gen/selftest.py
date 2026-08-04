#!/usr/bin/env python3
"""Synthesise a soft-edged disc on black and assert key/upscale/export behave."""

import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

SIZE = 512
RADIUS = 150.0
FALLOFF = 14.0
COLOR = np.array([70.0, 210.0, 130.0], dtype=np.float32)


def synth(path):
    y, x = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    d = np.hypot(x - (SIZE - 1) / 2.0, y - (SIZE - 1) / 2.0)
    a = np.where(d <= RADIUS, 1.0, np.exp(-(((d - RADIUS) / FALLOFF) ** 2)))
    premul = COLOR[None, None, :] * a[:, :, None]
    Image.fromarray(np.rint(premul).astype(np.uint8), "RGB").save(path)


def run(*args):
    proc = subprocess.run([sys.executable, *args], capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit("FAIL: %s\n%s%s" % (" ".join(args), proc.stdout, proc.stderr))
    print("  " + proc.stdout.strip())


def main():
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, "disc.png")
        keyed = os.path.join(tmp, "disc.keyed.png")
        up = os.path.join(tmp, "disc.up.png")
        webp = os.path.join(tmp, "disc.webp")

        synth(raw)
        run(os.path.join(HERE, "key.py"), raw, keyed)

        a = np.asarray(Image.open(keyed).convert("RGBA"))[:, :, 3]
        corners = [a[0, 0], a[0, -1], a[-1, 0], a[-1, -1]]
        assert all(int(c) == 0 for c in corners), "corners not transparent: %s" % corners
        center = int(a[SIZE // 2, SIZE // 2])
        assert center == 255, "disc center alpha %d != 255" % center
        soft = int(((a > 0) & (a < 255)).sum())
        assert soft > 0, "no soft ring found"
        print("  corners=0  center=255  soft px=%d" % soft)

        rgb = np.asarray(Image.open(keyed).convert("RGBA"))[:, :, :3].astype(np.float32)
        band = (a > 0) & (a < 255)
        assert rgb[band].max() > 150.0, "straight RGB in the soft band looks premultiplied"

        src = np.asarray(Image.open(raw).convert("RGB"), dtype=np.float32)
        recomposited = rgb * (a[:, :, None].astype(np.float32) / 255.0)
        err = np.abs(recomposited - src)[a > 0].max()
        assert err <= 14.0, "keyed image does not recomposite over black (max err %.1f)" % err
        print("  recomposite over black: max err %.1f/255 (dimmest soft pixels clip at 255)" % err)

        run(os.path.join(HERE, "upscale.py"), keyed, up, "--factor", "2", "--engine", "lanczos")
        upimg = Image.open(up)
        assert upimg.size == (SIZE * 2, SIZE * 2), "upscaled to %s" % (upimg.size,)

        run(os.path.join(HERE, "export.py"), up, webp, "--width", "1024", "--quality", "88")
        out = Image.open(webp)
        assert out.width == 1024, "export width %d != 1024" % out.width
        assert os.path.getsize(webp) > 0, "empty webp"
        print("  upscaled %s  exported %s %d bytes" % (upimg.size, out.size, os.path.getsize(webp)))

    print("selftest OK")


if __name__ == "__main__":
    main()
