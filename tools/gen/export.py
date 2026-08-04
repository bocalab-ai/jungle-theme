#!/usr/bin/env python3
"""Export a PNG to WebP at a target width, preserving aspect and never upscaling."""

import argparse
import os

from PIL import Image


def export_webp(img, dst, width=None, quality=88):
    if img.mode not in ("RGBA", "RGB"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
    if width and width < img.width:
        height = max(1, int(round(img.height * width / float(img.width))))
        img = img.resize((width, height), Image.LANCZOS)

    parent = os.path.dirname(os.path.abspath(dst))
    os.makedirs(parent, exist_ok=True)
    img.save(dst, "WEBP", quality=quality, method=6)
    return img.width, img.height, os.path.getsize(dst)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--width", type=int, default=None)
    ap.add_argument("--quality", type=int, default=88)
    args = ap.parse_args()

    w, h, size = export_webp(Image.open(args.src), args.dst, args.width, args.quality)
    print("%s -> %s  %dx%d  q%d  %.2f MB (%d bytes)" % (args.src, args.dst, w, h, args.quality, size / 1e6, size))


if __name__ == "__main__":
    main()
