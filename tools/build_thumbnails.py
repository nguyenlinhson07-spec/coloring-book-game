#!/usr/bin/env python3
"""
build_thumbnails.py — offline build step that generates small, optimized
thumbnail PNGs for the picture-selection and gallery grids.

Why: the gallery/selection screens were rendering the full-resolution
(1254x1254, ~1MB each) artwork PNGs as <img> thumbnails. Loading/decoding
~36 of those (potentially all at once as the grid paginates) is expensive
on mid-range mobile hardware. This script downsamples each source image to
a small thumbnail (longest side capped at THUMB_MAX px) and writes it to
assets/thumbnails/<category>/<id>.png. The editor continues to use the
original full-resolution PNG (page.image) — only page.thumbnail changes.

Run from the project root:
    python tools/build_thumbnails.py

Requires: pillow (pip install pillow)
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA_JSON = ROOT / "data" / "coloring-pages.json"
THUMB_OUT_DIR = ROOT / "assets" / "thumbnails"
THUMB_MAX = 360  # longest side, in px


def build_one(page):
    src_path = ROOT / page["image"]
    im = Image.open(src_path).convert("RGB")
    w, h = im.size
    scale = THUMB_MAX / max(w, h)
    if scale < 1:
        im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    # Source art has antialiased edges (~10k distinct colors) that don't
    # matter at thumbnail size — an adaptive 128-color palette roughly
    # halves file size vs full RGB with no visible quality loss this small.
    im = im.convert("P", palette=Image.ADAPTIVE, colors=128)

    category = page["category"]
    out_dir = THUMB_OUT_DIR / category
    out_dir.mkdir(parents=True, exist_ok=True)
    base = Path(page["image"]).stem
    out_path = out_dir / f"{base}.png"
    im.save(out_path, optimize=True)
    return out_path


def main():
    pages = json.loads(DATA_JSON.read_text(encoding="utf-8"))

    total_before = 0
    total_after = 0
    for page in pages:
        src_path = ROOT / page["image"]
        total_before += src_path.stat().st_size
        out_path = build_one(page)
        total_after += out_path.stat().st_size
        page["thumbnail"] = str(out_path.relative_to(ROOT)).replace("\\", "/")
        print(f"{page['id']:24} {src_path.stat().st_size/1024:8.1f} KB -> {out_path.stat().st_size/1024:7.1f} KB")

    DATA_JSON.write_text(json.dumps(pages, indent=2), encoding="utf-8")
    print(f"\nTotal: {total_before/1024/1024:.2f} MB -> {total_after/1024/1024:.2f} MB "
          f"({100 - 100*total_after/total_before:.0f}% smaller)")
    print(f"Data JSON updated: {DATA_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
