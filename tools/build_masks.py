#!/usr/bin/env python3
"""
build_masks.py — offline build step that turns each supplied PNG coloring
page into a HIDDEN boundary mask + region-ID map used by the runtime Canvas
flood-fill engine (js/coloring-engine.js).

Why this exists: the supplied line art has real (non-antialiasing) gaps in
many outlines, so a naive live flood-fill leaks from the character's body
into the surrounding white background. This script:

  1. builds a boundary mask from a lighter luminance threshold (catches
     soft/antialiased gray edges as barriers, not just pure black),
  2. dilates that mask by a few pixels to close small real gaps — a HIDDEN
     operation that never touches the visible artwork (the visible line-art
     layer used by the live engine is built separately, from the RAW pixels),
  3. applies any manual patch segments from js/mask-patches.js for gaps too
     large for automatic dilation to safely close,
  4. flood-fills from the canvas border to identify the exterior background
     and excludes it from the fillable region set,
  5. labels the remaining enclosed white areas into numbered regions and
     discards tiny noise specks,
  6. writes <name>-mask.png (pure B/W barrier mask) and <name>-regions.png
     (region ID encoded in the R/G channels) per picture, and
  7. writes an audit report (JSON + printable table) classifying every
     picture as PASS / MASK_REPAIRED / REPLACEMENT_REQUIRED.

Run from the project root:
    python tools/build_masks.py

Requires: pillow, numpy, scipy (pip install pillow numpy scipy)
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
DATA_JSON = ROOT / "data" / "coloring-pages.json"
MASK_PATCHES_JS = ROOT / "js" / "mask-patches.js"
MASK_OUT_DIR = ROOT / "assets" / "coloring-masks"

W, H = 800, 600
FIT_FRACTION = 0.88         # artwork occupies ~88% of canvas, aspect-ratio preserved (matches
                             # ColoringEngine.fitRect / FIT_FRACTION in js/coloring-engine.js)
DARK_THRESHOLD = 200        # luminance below this = boundary/outline candidate
DEFAULT_DILATE_PX = 2       # hidden mask dilation (gap-closing), default
NOISE_MIN_PX = 40           # discard connected regions smaller than this
PASS_MIN_LARGEST_PX = 1500  # a "real" main region must be at least this big
PASS_MIN_REGIONS = 3        # and there must be at least this many regions


def load_mask_patches():
    """Parse js/mask-patches.js (single source of truth) without a JS runtime."""
    text = MASK_PATCHES_JS.read_text(encoding="utf-8")

    def strip_js_comments(s):
        s = re.sub(r"/\*.*?\*/", "", s, flags=re.DOTALL)
        s = re.sub(r"(?m)^\s*//.*$", "", s)
        return s

    def extract(const_name):
        m = re.search(const_name + r"\s*=\s*(\{.*?\n\});", text, re.DOTALL)
        if not m:
            return {}
        cleaned = strip_js_comments(m.group(1))
        # drop trailing commas before a closing bracket/brace (not valid JSON)
        cleaned = re.sub(r",(\s*[\]}])", r"\1", cleaned)
        return json.loads(cleaned)

    patches = extract("const MaskPatches")
    overrides = extract("const MaskDilateOverrides")
    return patches, overrides


def luminance(arr):
    return 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]


def label_regions(boundary):
    """4-connected labeling of everything that is NOT a boundary pixel.
    Returns (labeled, exterior_label_set)."""
    fillable = ~boundary
    labeled, n = ndimage.label(fillable, structure=[[0, 1, 0], [1, 1, 1], [0, 1, 0]])
    exterior_labels = set(labeled[0, :]) | set(labeled[-1, :]) | set(labeled[:, 0]) | set(labeled[:, -1])
    exterior_labels.discard(0)
    return labeled, n, exterior_labels


def estimate_gaps(raw_boundary, bbox=None):
    """Cheap gap-size estimate: skeletonize the raw (undilated) boundary and
    find nearby stroke endpoints. Used only for the audit report, not for
    the actual mask construction."""
    try:
        from skimage.morphology import skeletonize
    except ImportError:
        return 0, 0

    region = raw_boundary
    if bbox:
        y0, y1, x0, x1 = bbox
        mask = np.zeros_like(raw_boundary)
        mask[y0:y1, x0:x1] = raw_boundary[y0:y1, x0:x1]
        region = mask

    skel = skeletonize(region)
    nbrs = ndimage.convolve(skel.astype(int), [[1, 1, 1], [1, 0, 1], [1, 1, 1]], mode="constant")
    endpoints = np.argwhere(skel & (nbrs == 1))
    pts = [(int(x), int(y)) for y, x in endpoints]

    gap_count = 0
    largest_gap = 0
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            d = ((pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2) ** 0.5
            if 1.5 < d < 40:  # ignore touching (0-1px, not a gap) and far unrelated points
                gap_count += 1
                largest_gap = max(largest_gap, d)
    return gap_count, round(largest_gap, 1)


def fit_rect(img_w, img_h):
    """Contain-fit + center, scaled to FIT_FRACTION of the canvas — must stay
    in lockstep with ColoringEngine.fitRect() in js/coloring-engine.js so the
    region map lines up pixel-for-pixel with the visible line art."""
    scale = min((W * FIT_FRACTION) / img_w, (H * FIT_FRACTION) / img_h)
    w, h = img_w * scale, img_h * scale
    return (W - w) / 2, (H - h) / 2, w, h


def build_one(page, patches_by_id, overrides_by_id):
    image_path = ROOT / page["image"]
    src = Image.open(image_path).convert("RGB")
    canvas = Image.new("RGB", (W, H), (255, 255, 255))
    x, y, w, h = fit_rect(*src.size)
    resized = src.resize((round(w), round(h)), Image.LANCZOS)
    canvas.paste(resized, (round(x), round(y)))
    im = canvas
    arr = np.asarray(im, dtype=np.float32)
    lum = luminance(arr)
    raw_boundary = lum < DARK_THRESHOLD

    dilate_px = overrides_by_id.get(page["id"], DEFAULT_DILATE_PX)
    boundary = ndimage.binary_dilation(raw_boundary, iterations=dilate_px) if dilate_px else raw_boundary.copy()

    # Apply manual patch segments (hidden mask only)
    patches = patches_by_id.get(page["id"], [])
    if patches:
        patch_img = Image.fromarray((boundary * 255).astype(np.uint8))
        draw = ImageDraw.Draw(patch_img)
        for seg in patches:
            draw.line([(seg["x1"], seg["y1"]), (seg["x2"], seg["y2"])], fill=255, width=seg.get("width", 4))
        boundary = np.asarray(patch_img) > 127

    labeled, n, exterior_labels = label_regions(boundary)

    # Region ID map: 0 = barrier or exterior background (never fillable by
    # normal click), 1..N = enclosed fillable regions (noise below
    # NOISE_MIN_PX folded into 0 as well).
    region_map = np.zeros((H, W), dtype=np.uint16)
    next_id = 1
    region_sizes = []
    for lbl in range(1, n + 1):
        if lbl in exterior_labels:
            continue
        px = labeled == lbl
        size = int(px.sum())
        if size < NOISE_MIN_PX:
            continue
        region_map[px] = next_id
        region_sizes.append(size)
        next_id += 1

    region_sizes.sort(reverse=True)
    n_regions = len(region_sizes)
    largest_px = region_sizes[0] if region_sizes else 0

    # --- write mask.png (pure black/white, no gray) ---
    category = page["category"]
    out_dir = MASK_OUT_DIR / category
    out_dir.mkdir(parents=True, exist_ok=True)
    base = Path(page["image"]).stem

    mask_img = Image.fromarray(np.where(boundary, 0, 255).astype(np.uint8), mode="L").convert("RGB")
    mask_path = out_dir / f"{base}-mask.png"
    mask_img.save(mask_path)

    # --- write regions.png (id encoded in R,G; B=0; A=255) ---
    r = (region_map % 256).astype(np.uint8)
    g = (region_map // 256).astype(np.uint8)
    b = np.zeros_like(r)
    a = np.full_like(r, 255)
    regions_rgba = np.dstack([r, g, b, a])
    regions_path = out_dir / f"{base}-regions.png"
    Image.fromarray(regions_rgba, mode="RGBA").save(regions_path)

    gap_count, largest_gap = estimate_gaps(raw_boundary)

    has_patch = bool(patches)
    auto_ok = largest_px >= PASS_MIN_LARGEST_PX and n_regions >= PASS_MIN_REGIONS
    if auto_ok and not has_patch:
        status = "PASS"
    elif auto_ok and has_patch:
        status = "MASK_REPAIRED"
    else:
        status = "REPLACEMENT_REQUIRED"

    return {
        "id": page["id"],
        "title": page["title"],
        "category": category,
        "mask": str(mask_path.relative_to(ROOT)).replace("\\", "/"),
        "regionMap": str(regions_path.relative_to(ROOT)).replace("\\", "/"),
        "dilate_px": dilate_px,
        "patch_segments": len(patches),
        "gap_count_estimate": gap_count,
        "largest_gap_estimate_px": largest_gap,
        "n_regions": n_regions,
        "largest_region_px": largest_px,
        "region_sizes_top5": region_sizes[:5],
        "status": status,
    }


def main():
    pages = json.loads(DATA_JSON.read_text(encoding="utf-8"))
    patches_by_id, overrides_by_id = load_mask_patches()

    results = []
    for page in sorted(pages, key=lambda p: p["order"]):
        result = build_one(page, patches_by_id, overrides_by_id)
        results.append(result)
        page["mask"] = result["mask"]
        page["regionMap"] = result["regionMap"]

    DATA_JSON.write_text(json.dumps(pages, indent=2), encoding="utf-8")

    report_path = ROOT / "tools" / "boundary-audit-report.json"
    report_path.write_text(json.dumps(results, indent=2), encoding="utf-8")

    print(f"{'#':3} {'Title':22} {'Status':20} {'Regions':7} {'Largest px':10} {'Patches':7}")
    for i, r in enumerate(results, 1):
        print(f"{i:3} {r['title']:22} {r['status']:20} {r['n_regions']:7} {r['largest_region_px']:10} {r['patch_segments']:7}")

    counts = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print("\nSummary:", counts)
    print(f"\nData JSON updated: {DATA_JSON.relative_to(ROOT)}")
    print(f"Audit report written: {report_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
