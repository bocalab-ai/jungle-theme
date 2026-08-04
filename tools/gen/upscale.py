#!/usr/bin/env python3
"""Upscale an RGBA image without ever filtering straight RGB across the matte."""

import argparse
import os
import subprocess
import sys

import numpy as np
from PIL import Image

WEIGHTS_URL = (
    "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"
)
WEIGHTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "work", "models")


def _split_premultiplied(img):
    arr = np.asarray(img.convert("RGBA"), dtype=np.float32)
    alpha = arr[:, :, 3] / 255.0
    premul = arr[:, :, :3] * alpha[:, :, None]
    return premul, arr[:, :, 3]


def _join_unpremultiplied(premul, alpha):
    a = np.clip(alpha, 0.0, 255.0)
    scale = 255.0 / np.maximum(a, 1.0)
    rgb = np.clip(premul * scale[:, :, None], 0.0, 255.0)
    rgb[a < 0.5] = 0.0
    out = np.dstack([np.rint(rgb), np.rint(a)]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def _lanczos_plane(arr, size, mode):
    img = Image.fromarray(np.rint(np.clip(arr, 0.0, 255.0)).astype(np.uint8), mode)
    return np.asarray(img.resize(size, Image.LANCZOS), dtype=np.float32)


def _pip(args):
    return subprocess.run(
        [sys.executable, "-m", "pip", "install", "--user", *args],
        capture_output=True,
        text=True,
    )


def _patch_basicsr():
    try:
        import basicsr
    except Exception:
        return False
    path = os.path.join(os.path.dirname(basicsr.__file__), "data", "degradations.py")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return False
    if "torchvision.transforms.functional_tensor" not in text:
        return False
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text.replace("torchvision.transforms.functional_tensor", "torchvision.transforms.functional"))
    return True


def _esrgan_upsampler():
    try:
        from realesrgan import RealESRGANer
    except Exception:
        torch = _pip(["torch", "--index-url", "https://download.pytorch.org/whl/cpu"])
        if torch.returncode != 0:
            print("warn: torch install failed:\n%s" % torch.stderr.strip()[-800:], file=sys.stderr)
            return None
        real = _pip(["realesrgan"])
        if real.returncode != 0:
            print("warn: realesrgan install failed:\n%s" % real.stderr.strip()[-800:], file=sys.stderr)
            return None

    for attempt in (1, 2):
        try:
            from basicsr.archs.rrdbnet_arch import RRDBNet
            from realesrgan import RealESRGANer
        except Exception as exc:
            if attempt == 1 and _patch_basicsr():
                continue
            print("warn: realesrgan import failed (%s)" % exc, file=sys.stderr)
            return None
        break

    os.makedirs(WEIGHTS_DIR, exist_ok=True)
    weights = os.path.join(WEIGHTS_DIR, "RealESRGAN_x4plus.pth")
    if not os.path.exists(weights):
        from urllib.request import urlretrieve

        try:
            urlretrieve(WEIGHTS_URL, weights)
        except Exception as exc:
            print("warn: weight download failed (%s)" % exc, file=sys.stderr)
            return None

    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
    try:
        return RealESRGANer(scale=4, model_path=weights, model=model, tile=512, half=False)
    except Exception as exc:
        print("warn: realesrgan init failed (%s)" % exc, file=sys.stderr)
        return None


def _esrgan_plane(upsampler, arr, mode, size):
    src = np.rint(np.clip(arr, 0.0, 255.0)).astype(np.uint8)
    if mode == "L":
        src = np.dstack([src, src, src])
    out, _ = upsampler.enhance(src[:, :, ::-1], outscale=4)
    out = out[:, :, ::-1].astype(np.float32)
    if mode == "L":
        out = out.mean(axis=2)
    img = Image.fromarray(np.rint(np.clip(out, 0.0, 255.0)).astype(np.uint8), mode)
    if img.size != size:
        img = img.resize(size, Image.LANCZOS)
    return np.asarray(img, dtype=np.float32)


def upscale_rgba(img, factor, engine="lanczos"):
    size = (max(1, int(round(img.width * factor))), max(1, int(round(img.height * factor))))
    premul, alpha = _split_premultiplied(img)

    if engine == "esrgan":
        upsampler = _esrgan_upsampler()
        if upsampler is None:
            print("warn: falling back to lanczos", file=sys.stderr)
            engine = "lanczos"
        else:
            try:
                premul_up = _esrgan_plane(upsampler, premul, "RGB", size)
                alpha_up = _esrgan_plane(upsampler, alpha, "L", size)
                return _join_unpremultiplied(premul_up, alpha_up), "esrgan"
            except Exception as exc:
                print("warn: esrgan inference failed (%s); falling back to lanczos" % exc, file=sys.stderr)
                engine = "lanczos"

    premul_up = _lanczos_plane(premul, size, "RGB")
    alpha_up = _lanczos_plane(alpha, size, "L")
    return _join_unpremultiplied(premul_up, alpha_up), "lanczos"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--factor", type=float, default=2.0)
    ap.add_argument("--engine", choices=["lanczos", "esrgan"], default="lanczos")
    args = ap.parse_args()

    src = Image.open(args.src)
    out, engine = upscale_rgba(src, args.factor, args.engine)
    out.save(args.dst)
    print(
        "%s %dx%d -> %s %dx%d  x%.3f  engine=%s"
        % (args.src, src.width, src.height, args.dst, out.width, out.height, args.factor, engine)
    )


if __name__ == "__main__":
    main()
