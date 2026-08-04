#!/usr/bin/env python3
"""Run raw -> key -> upscale -> export for every manifest entry."""

import argparse
import json
import os

from PIL import Image

import export as export_mod
import key as key_mod
import upscale as upscale_mod

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")


def _rel(path):
    return path if os.path.isabs(path) else os.path.join(HERE, path)


def run_entry(entry):
    eid = entry["id"]
    raw = _rel(entry["raw"])
    if not os.path.exists(raw):
        print("skip %s: missing raw %s" % (eid, raw))
        return False

    k = entry.get("key", {})
    keyed, stats = key_mod.key_image(
        Image.open(raw),
        k.get("t_bg", key_mod.T_BG),
        k.get("t_fg", key_mod.T_FG),
        k.get("soft_px", key_mod.SOFT_PX),
    )
    keyed_path = os.path.join(WORK, "%s.keyed.png" % eid)
    keyed.save(keyed_path)
    print(
        "%s key: %dx%d  transparent %.2f%%  soft %.2f%%  opaque %.2f%%"
        % (eid, keyed.width, keyed.height, stats["transparent"], stats["soft"], stats["opaque"])
    )

    u = entry.get("upscale", {})
    factor = float(u.get("factor", 1.0))
    scaled, engine = upscale_mod.upscale_rgba(keyed, factor, u.get("engine", "lanczos"))
    scaled_path = os.path.join(WORK, "%s.up.png" % eid)
    scaled.save(scaled_path)
    print("%s upscale: x%.3f engine=%s -> %dx%d" % (eid, factor, engine, scaled.width, scaled.height))

    e = entry["export"]
    out = _rel(e["out"])
    w, h, size = export_mod.export_webp(scaled, out, e.get("width"), e.get("quality", 88))
    print("%s export: %s  %dx%d  %.2f MB" % (eid, os.path.relpath(out, HERE), w, h, size / 1e6))
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", default=os.path.join(HERE, "manifest.json"))
    ap.add_argument("--id", action="append", dest="ids", help="only this entry id (repeatable)")
    args = ap.parse_args()

    with open(args.manifest, "r", encoding="utf-8") as fh:
        entries = json.load(fh)["entries"]
    if args.ids:
        wanted = set(args.ids)
        entries = [e for e in entries if e["id"] in wanted]
        missing = wanted - {e["id"] for e in entries}
        for m in sorted(missing):
            print("skip %s: no such manifest entry" % m)

    os.makedirs(WORK, exist_ok=True)
    done = sum(1 for e in entries if run_entry(e))
    print("built %d/%d entries" % (done, len(entries)))


if __name__ == "__main__":
    main()
