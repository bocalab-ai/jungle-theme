#!/usr/bin/env python3
"""Sharpness budget report: real source pixels vs screen pixels. Read-only."""

import argparse
import json
import os
import re

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SCENE = os.path.join(ROOT, "src", "JungleScene.tsx")
ASSETS = os.path.join(ROOT, "public", "jungle")

VIEWPORT_W = 1600
VIEWPORT_H = 900
DPR = 2


def _objects(text, name):
    m = re.search(r"const %s:\s*\w+\[\]\s*=\s*\[(.*?)\n\];" % name, text, re.S)
    if not m:
        return []
    body = re.sub(r"//[^\n]*", "", m.group(1))
    return re.findall(r"\{[^{}]*\}", body)


def _str_field(obj, field):
    m = re.search(r'\b%s:\s*"([^"]*)"' % field, obj)
    return m.group(1) if m else None


def _num_field(obj, field):
    m = re.search(r"\b%s:\s*(-?[\d.]+)" % field, obj)
    return float(m.group(1)) if m else None


def _bool_field(obj, field):
    return re.search(r"\b%s:\s*true" % field, obj) is not None


def read_scene(path):
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()

    rows = []
    for obj in _objects(text, "LAYERS"):
        name = _str_field(obj, "name")
        cover = _num_field(obj, "cover")
        if name is None or cover is None:
            continue
        rows.append(
            {
                "kind": "layer",
                "name": name,
                "tex": _str_field(obj, "tex") or name,
                "screen_px": cover * VIEWPORT_W * DPR,
                "hidden": _bool_field(obj, "hidden"),
            }
        )
    for obj in _objects(text, "SPRITES"):
        name = _str_field(obj, "name")
        h = _num_field(obj, "h")
        if name is None or h is None:
            continue
        rows.append(
            {
                "kind": "sprite",
                "name": _str_field(obj, "id") or name,
                "tex": name,
                "screen_px": h * VIEWPORT_H * DPR,
                "hidden": _bool_field(obj, "hidden"),
            }
        )
    return rows


def read_factors(path):
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        manifest = json.load(fh)
    factors = {}
    for entry in manifest.get("entries", []):
        out = entry.get("export", {}).get("out")
        if not out:
            continue
        stem = os.path.splitext(os.path.basename(out))[0]
        factors[stem] = float(entry.get("upscale", {}).get("factor", 1.0))
    return factors


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", default=os.path.join(HERE, "manifest.json"))
    ap.add_argument(
        "--nominal-src",
        type=int,
        default=None,
        help="assume this real source width for assets with no manifest entry "
        "(e.g. 1536, the generator's native long edge)",
    )
    args = ap.parse_args()

    factors = read_factors(args.manifest)
    rows = read_scene(SCENE)

    print(
        "sharpness budget @ %dx%d CSS, dpr %d  (layers: cover*%d, sprites: h*%d)"
        % (VIEWPORT_W, VIEWPORT_H, DPR, VIEWPORT_W * DPR, VIEWPORT_H * DPR)
    )
    print()
    header = "%-16s %-10s %-13s %10s %10s %7s  %s" % (
        "name", "kind", "file px", "real src", "screen px", "ratio", "note",
    )
    print(header)
    print("-" * len(header))

    for row in sorted(rows, key=lambda r: r["screen_px"], reverse=True):
        path = os.path.join(ASSETS, "%s.webp" % row["tex"])
        if not os.path.exists(path):
            print("%-16s %-10s %-13s %10s %10.0f %7s  MISSING %s.webp"
                  % (row["name"], row["kind"], "-", "-", row["screen_px"], "-", row["tex"]))
            continue
        with Image.open(path) as img:
            w, h = img.size
        factor = factors.get(row["tex"])
        if factor:
            src_px = w / factor
            note = "x%g upscale" % factor
        elif args.nominal_src:
            src_px = float(min(args.nominal_src, w))
            note = "assumed %dpx source" % src_px
        else:
            src_px = float(w)
            note = "nominal (no manifest entry)"
        ratio = src_px / row["screen_px"] if row["screen_px"] else 0.0
        notes = [note]
        if row["hidden"]:
            notes.append("hidden")
        if ratio < 1.0:
            notes.append("SOFT")
        print(
            "%-16s %-10s %-13s %10.0f %10.0f %7.2f  %s"
            % (row["name"], row["kind"], "%dx%d" % (w, h), src_px, row["screen_px"], ratio, ", ".join(notes))
        )

    total = 0
    files = sorted(f for f in os.listdir(ASSETS) if f.endswith(".webp"))
    print()
    for f in files:
        size = os.path.getsize(os.path.join(ASSETS, f))
        total += size
        print("  %-22s %8.2f MB" % (f, size / 1e6))
    print("  %-22s %8.2f MB across %d files" % ("TOTAL", total / 1e6, len(files)))


if __name__ == "__main__":
    main()
