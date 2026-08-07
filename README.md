# Happy Coloring Book

A browser-based children's coloring book game. Built with plain HTML5, CSS3, and
vanilla JavaScript — no frameworks, no build step, no server-side code, no paid
APIs. All artwork, sounds, and UI in this project are original and were created
for this project; nothing was copied, hotlinked, or extracted from any other
website or game.

## Boundary fix (v4) — precomputed region-ID fill, no more leaking

The v3 engine computed fill boundaries live, in the browser, from the raw
PNG's dark pixels. Since the supplied line art has real (non-antialiasing)
gaps, that meant clicking the body would often flood-fill the body *and*
the surrounding background together. That is now fixed architecturally,
not just by nudging a tolerance number:

- **`tools/build_masks.py`** is a new offline build step (Python — run it
  with `python tools/build_masks.py` from the project root; requires
  `pillow numpy scipy` and, optionally, `scikit-image` for the audit's gap
  estimate). For each of the 30 pictures it: thresholds at a lighter
  luminance cutoff (200, catches soft anti-aliased edges), dilates the
  result by a couple of pixels to close small real gaps, applies any manual
  patch segments from `js/mask-patches.js`, flood-fills from the canvas
  border to find the exterior background, and labels everything else into
  numbered regions (discarding noise specks under 40px). It writes two PNGs
  per picture into `assets/coloring-masks/<category>/`:
  - `<name>-mask.png` — pure black/white hidden boundary mask (kept for
    inspection; not read at runtime).
  - `<name>-regions.png` — the actual runtime data: each pixel's region ID
    encoded in the R/G channels (`id = R + G*256`); **0 means "not
    fillable"** (outline pixel, exterior background, or noise) — reused for
    *both* rejecting exterior clicks and excluding the background from the
    completion percentage.
  It also writes `tools/boundary-audit-report.json` and updates
  `data/coloring-pages.json` with `mask`/`regionMap` paths per picture.

- **`js/coloring-engine.js`** no longer computes any boundary from raw
  pixels for fill decisions. On load it decodes `<name>-regions.png` once
  into a `Uint32Array` (one region ID per pixel) and groups pixel indices by
  ID into a `Map`. A click just reads the ID at that pixel and, if nonzero,
  repaints the *precomputed* pixel list for that ID — no scanning, no
  flood-fill, and **no possible leak**, because the fill can only ever touch
  pixels that were already grouped into that region ID at build time. The
  visible line-art layer is still built independently from the raw,
  unpatched PNG pixels each load, so the artwork on screen is always
  pixel-for-pixel identical to the supplied source image; only the invisible
  region map was corrected.

- **`js/mask-patches.js`** holds hand-verified manual gap-bridging line
  segments for pictures whose gaps were too large for automatic dilation to
  safely close (see Cute Fox below) — a small, explicit, human-reviewed
  correction, not an algorithm inventing anatomy. It's the single source of
  truth for both the offline build and (defensively) the runtime engine.

- Clicking outside a character (or directly on a line) now does nothing —
  `ColoringEngine` reports it via an `onInvalidClick` callback, which
  `app.js` wires to a new short, soft `AudioManager.invalid()` tone instead
  of a fill.

### Cute Fox — validated first, per the brief

The source outline had a real gap along the belly/leg baseline (each leg is
a separate stroke not connected to the body) plus a couple of smaller
ear/cheek gaps. I located the gaps by skeletonizing the raw boundary mask
and searching for nearby stroke endpoints (visualized in the scratchpad
during development), then hand-verified 8 short patch segments in
`js/mask-patches.js` (`animals-cute-fox`) plus one extra pixel of hidden-mask
dilation (`MaskDilateOverrides`). Before the patch: only the tail and a
couple of decorations closed automatically (largest region 2309px, body/head
still merged with the exterior). After: **8 independently fillable regions**
— head/face, body, 2 tail stripes, 1 ear, cheek, star, leaves — confirmed by
re-running connected-component labeling with the patch applied, and by
directly decoding the shipped `10-cute-fox-regions.png` and simulating
clicks:

| Test | Result |
|---|---|
| Click face/head, body, both tail stripes, ear, cheek, star, leaves | ✅ each returns its own distinct region ID and fills only that region's precomputed pixel set |
| Click 6 exterior-background points (corners, above/beside the fox) | ✅ all return region ID 0 → rejected, nothing filled |
| Simulated fill leak check (painted-pixel count vs. region's precomputed size, and intersection with ID-0/other-region pixels) | ✅ exact match, 0 leaked pixels — leak-proof by construction |

Undo/redo/reset/save/restore/export were not architecturally changed by this
fix (they still operate on the paint-layer snapshot history exactly as in
v3) — reviewed by code inspection and covered by the same JS syntax and
HTTP-serving checks below, but not click-tested in a live browser (see
Known limitations).

### Full 30-picture audit

Ran the same pipeline across all 30 pictures. Every picture's exterior
background is correctly blocked (0/30 failures) and the fill mechanism is
leak-proof by construction for all 30 (the fill can only ever touch a
region's precomputed pixel list — there is no code path left that scans
outward from a clicked pixel). What differs per picture is how much of the
artwork the *source* line art allows to be separated into real regions:

| Status | Count | Meaning |
|---|---|---|
| PASS | 6 | Closed automatically (threshold + 2px hidden dilation), no manual patch needed |
| MASK_REPAIRED | 1 | Cute Fox — closed via 8 verified manual patch segments + dilation override |
| REPLACEMENT_REQUIRED | 23 | Main subject still merges with the exterior background after safe automatic repair; per the brief's explicit instruction, large/structural gaps were **not** patched with invented anatomy |

| # | Picture | Status | Regions | Largest region (px) |
|---|---|---|---|---|
| 1 | Cute Rabbit | PASS | 3 | 2555 |
| 2 | Friendly Puppy | PASS | 11 | 2949 |
| 3 | Happy Cat | PASS | 3 | 3907 |
| 4 | Funny Cow | PASS | 11 | 4165 |
| 5 | Little Lion | PASS | 12 | 3837 |
| 6 | Smiling Bear | REPLACEMENT_REQUIRED | 6 | 1034 |
| 7 | Baby Elephant | REPLACEMENT_REQUIRED | 2 | 277 |
| 8 | Happy Panda | REPLACEMENT_REQUIRED | 5 | 156 |
| 9 | Playful Monkey | REPLACEMENT_REQUIRED | 13 | 1056 |
| 10 | Cute Fox | MASK_REPAIRED | 8 | 3904 |
| 11 | Baby T-Rex | REPLACEMENT_REQUIRED | 2 | 98 |
| 12 | Friendly Triceratops | PASS | 6 | 3323 |
| 13 | Little Stegosaurus | REPLACEMENT_REQUIRED | 7 | 382 |
| 14 | Long Neck Dinosaur | REPLACEMENT_REQUIRED | 2 | 207 |
| 15 | Flying Pterodactyl | REPLACEMENT_REQUIRED | 2 | 116 |
| 16 | Fire Truck | REPLACEMENT_REQUIRED | 11 | 752 |
| 17 | Police Car | REPLACEMENT_REQUIRED | 10 | 889 |
| 18 | School Bus | REPLACEMENT_REQUIRED | 12 | 497 |
| 19 | Airplane | REPLACEMENT_REQUIRED | 5 | 582 |
| 20 | Tractor | REPLACEMENT_REQUIRED | 12 | 675 |
| 21 | Apple | REPLACEMENT_REQUIRED | 3 | 136 |
| 22 | Strawberry | REPLACEMENT_REQUIRED | 5 | 270 |
| 23 | Pineapple | REPLACEMENT_REQUIRED | 7 | 209 |
| 24 | Watermelon | REPLACEMENT_REQUIRED | 1 | 322 |
| 25 | Fruit Basket | REPLACEMENT_REQUIRED | 13 | 1421 |
| 26 | Unicorn | REPLACEMENT_REQUIRED | 3 | 91 |
| 27 | Baby Dragon | REPLACEMENT_REQUIRED | 3 | 135 |
| 28 | Mermaid | REPLACEMENT_REQUIRED | 12 | 246 |
| 29 | Fairy Castle | REPLACEMENT_REQUIRED | 15 | 920 |
| 30 | Little Wizard | REPLACEMENT_REQUIRED | 8 | 348 |

**What "REPLACEMENT_REQUIRED" means in play, concretely:** the game is now
*safe* for all 30 — nothing ever floods the whole canvas, exterior
background is always blocked — but for the 23 flagged pictures, most of the
main subject (body/head/etc.) is still merged with the excluded exterior
region, so only its small already-closed decorative bits (a star, a leaf, an
already-closed stripe) are fillable, not the character itself. That's an
honest, safe degradation, not a hidden failure: nothing leaks, but coloring
value is limited until either (a) more per-picture manual patches are
authored the same way Cute Fox was (time-intensive — each one needs the same
gap-location-and-verification process shown above), or (b) the source pack
is regenerated with fully closed outlines. I prioritized proving the
approach end-to-end on Cute Fox as instructed rather than rushing 22 more
unverified patch sets.

### Note on `assets/coloring-pages-cleaned`

The task instructions referenced auditing images inside
`assets/coloring-pages-cleaned`. That folder does not exist anywhere in
this project's history — the 30 supplied PNGs have only ever lived at
`assets/coloring-pages/`. I audited and fixed that actual folder; if a
separate "cleaned" pre-processing pass was expected to have produced a
distinct folder first, it was not part of what was actually imported in this
project and I did not fabricate one.

## How to run

Because the game loads `data/coloring-pages.json` and the PNG artwork via
`fetch()`/`Image()`, most browsers require it to be served over `http://`
rather than opened directly as a `file://` URL (this is a standard browser
security restriction on local file access — Chrome in particular blocks
`fetch()` of local files under `file://`, and treats a `file://`-loaded
`<canvas>` image as tainted, which would silently break `Save`/`Download` —
not a bug in the game). Use any simple local server, for example:

```bash
# Python 3
python -m http.server 8000

# Node (if you have npx available)
npx serve .
```

Then open `http://localhost:8000` (or the port shown) in your browser.

If your browser allows local `fetch()` from `file://` (some configurations
do), you can also just double-click `index.html`.

## Folder structure

```
coloring-book-game/
├── index.html
├── css/
│   ├── style.css
│   └── responsive.css
├── js/
│   ├── app.js               screen routing, grid, pagination, editor wiring
│   ├── data.js               loads coloring-pages.json (flat array schema)
│   ├── gallery.js             renders the saved/finished pictures screen
│   ├── coloring-engine.js     Canvas engine: precomputed region-ID fill, brush/eraser, undo/redo, zoom, PNG export
│   ├── mask-patches.js        manual hidden-mask gap patches (source of truth for tools/build_masks.py)
│   ├── audio-manager.js       Web Audio API sound effects (no audio files needed)
│   └── storage-manager.js     localStorage save/load
├── tools/
│   ├── build_masks.py         offline mask/region-map build step (see "Boundary fix" below)
│   └── boundary-audit-report.json  generated per-picture audit (gap counts, status, region sizes)
├── assets/
│   ├── images/ (ui/, backgrounds/ — reserved for future custom art)
│   ├── coloring-pages/        30 supplied PNG line-art pictures (800×600 RGB)
│   │   ├── animals/     (10 PNGs)
│   │   ├── dinosaurs/   (5 PNGs)
│   │   ├── vehicles/    (5 PNGs)
│   │   ├── fruits/      (5 PNGs)
│   │   └── fantasy/     (5 PNGs)
│   ├── coloring-masks/        generated hidden boundary masks + region-ID maps (one pair per picture)
│   │   └── <category>/<name>-mask.png, <name>-regions.png
│   ├── coloring-pages-backup/  archived v2 SVG artwork (pre-PNG-import), kept for reference/rollback
│   ├── audio/  (unused — sounds are synthesized live via Web Audio API)
│   └── icons/  (unused — UI uses emoji glyphs for original, license-free icons)
├── data/
│   └── coloring-pages.json    flat array; each entry now also has mask/regionMap paths
└── README.md
```

## Gameplay

1. **Picture selection screen** — browse 30 original coloring pages across 6
   categories (All, Animals, Dinosaurs, Vehicles, Fruits, Fantasy), 6 pictures
   per page, with pagination and a favorite toggle.
2. **Coloring editor** — tap/click a region to fill it with the selected
   color (fill bucket), or draw freehand with the brush; erase freehand
   strokes with the eraser (original line art can't be erased). Undo/redo,
   reset, zoom in/out/fit, save, and download a PNG are all available.
3. **Completion celebration** — once 90%+ of a picture's regions are colored,
   a confetti celebration appears with Save / Download / Next Picture / Home
   options.
4. **Gallery** — see every picture you've started or finished, with a
   completion percentage, and continue, download, or delete it.

All progress autosaves to `localStorage` after every fill and every brush
stroke, and is restored automatically when you reopen a picture.

## PNG asset pack import (v3) — Canvas flood-fill engine

The game's 30 pictures now come from a supplied PNG line-art pack
(`assets/coloring-pages/*/*.png`, 800×600 RGB, referenced from
`data/coloring-pages.json`) instead of the hand-built SVGs from v2. Since raster
PNGs have no per-region vector paths, `js/coloring-engine.js` was rewritten
from scratch as a two-layer HTML5 Canvas flood-fill engine:

- **Base layer** — the original PNG, loaded once, pixels never modified.
- **Line-art mask** — a transparent-everywhere-except-dark-pixels copy of the
  base layer, drawn *on top* every frame so black outlines always stay visible
  above any paint.
- **Paint layer** — bucket fills and brush/eraser strokes, drawn *beneath* the
  line-art mask so colors never cover the outlines.

**Fill bucket**: an iterative (non-recursive) queue-based 4-connected flood
fill, using a luminance boundary threshold (dark pixel = boundary) with a
hidden, hand-tuned dilation pass (see "Open-outline finding" below). Clicking
directly on a dark outline pixel is rejected. Mouse, touch, and pen all work
via Pointer Events, with `touch-action: none` on the canvas to stop the page
from scrolling while coloring on mobile.

**Undo/redo**: every fill and every completed brush/eraser stroke pushes a
snapshot of the paint layer (`toDataURL()`) onto a capped 31-entry history
(30 undoable steps), so redo/undo just swaps the paint layer back in.

**Completion %**: computed from the same boundary mask, minus the single
connected white region that touches the canvas edge (auto-detected per
picture at load time and excluded, so completion isn't skewed by uncolored
margin/background).

**Export/Download**: the visible canvas *is* the exact composite (white
background + paint + line art, no editor chrome), so `Download PNG` and the
gallery's per-picture download both call `canvas.toBlob()` directly (or a
standalone `ColoringEngine.renderComposite()` for pictures that aren't
currently open in the editor) — no screenshot, no UI leakage, native 800×600
resolution.

### ⚠️ Open-outline finding (affects all 30 supplied pictures)

Static pixel analysis (luminance boundary detection + connected-component
labeling, replicating the exact in-browser algorithm) found that **every one
of the 30 supplied PNGs has at least one real, non-antialiasing gap in its
outline** — not a thin faint edge, but literal missing pixels, typically where
the character's leg/body line meets the ground or overlaps another stroke.
Because of this, the subject's silhouette is *topologically connected to the
white background* through that gap: with strict boundary detection, well
under 1.5% of the canvas came back as a truly isolated, separately-fillable
interior region for every single picture (see table below) — the other
98.5%+ is one giant connected white blob (background + most of the
character's body merged).

**What this means in play:** the fill bucket is implemented correctly and
safely (iterative queue-based flood fill, never crosses an actual dark
pixel, no leaking through antialiasing) — but for most of the 30 pictures, a
child clicking the body will often fill the body *and* the surrounding
background in one action, rather than isolating just "the ear" or just "the
shirt," because the source line art wasn't drawn with fully closed
per-region outlines the way a true region-based coloring page needs.

**What was done about it (per the brief's explicit Step 9 guidance — "prefer
a hidden digital boundary mask instead of visually altering the artwork"):**
`coloring-engine.js` builds the boundary mask by dilating dark pixels by 2px
(`ColoringEngine.BOUNDARY_DILATE_PX`) *before* using it for fill/background
decisions — this hidden mask closes small pixel-level gaps and measurably
shrinks (but does not eliminate) the leak. Critically, **the visible line art
layer is built separately from the undilated pixels**, so the artwork the
player actually sees is pixel-for-pixel identical to the supplied PNGs; only
the invisible fill-boundary logic is more conservative. No image was cropped,
redrawn, traced, or edited.

**Per-picture isolated-fillable-area %** (higher is better; all 30 fall in
the same "high risk" band because the gap is structural, not a threshold
tuning issue):

| # | Picture | Isolated fillable | # | Picture | Isolated fillable |
|---|---------|-------------------:|---|---------|-------------------:|
| 1 | Cute Rabbit | 0.76% | 16 | Fire Truck | 0.21% |
| 2 | Friendly Puppy | 0.49% | 17 | Police Car | 0.15% |
| 3 | Happy Cat | 0.91% | 18 | School Bus | 0.45% |
| 4 | Funny Cow | 1.25% | 19 | Airplane | 0.30% |
| 5 | Little Lion | 0.28% | 20 | Tractor | 0.67% |
| 6 | Smiling Bear | 0.77% | 21 | Apple | 0.08% |
| 7 | Baby Elephant | 0.10% | 22 | Strawberry | 0.19% |
| 8 | Happy Panda | 0.22% | 23 | Pineapple | 0.28% |
| 9 | Playful Monkey | 0.93% | 24 | Watermelon | 0.03% |
| 10 | Cute Fox | 0.96% | 25 | Fruit Basket | 0.64% |
| 11 | Baby T-Rex | 0.07% | 26 | Unicorn | 0.09% |
| 12 | Friendly Triceratops | 0.94% | 27 | Baby Dragon | 0.05% |
| 13 | Little Stegosaurus | 0.32% | 28 | Mermaid | 0.50% |
| 14 | Long Neck Dinosaur | 0.03% | 29 | Fairy Castle | 0.26% |
| 15 | Flying Pterodactyl | 0.05% | 30 | Little Wizard | 0.29% |

Fixing this properly requires source artwork drawn with fully closed vector
regions (like the v2 SVG set) or a PNG pack whose outlines are verified
closed at export time — it isn't something a smarter flood-fill algorithm
can solve when the underlying gaps are real. Recommend regenerating the pack
with closed outlines, or reverting to the v2 SVG artwork in
`assets/coloring-pages-backup/` (region-based, no leak risk) if per-part
coloring accuracy matters more than the specific supplied illustration style.

### ⚠️ Second finding: leftover concept-sheet crop artifacts

Every sampled picture (confirmed on 5, and consistent with the pack's own
README noting the PNGs are "cropped from the approved 30-picture concept
sheet") also contains a small leftover fragment of the source sheet's
per-cell numbering badge and a colored divider line, roughly in the
upper-middle area of the frame (e.g. fire-truck.png shows a red "16" badge
and a red rule at approx. x:250–450, y:230–300). This is cropping bleed from
the source concept sheet, not a copyright watermark, but it is visible,
colored, unprofessional-looking clutter on every coloring page as supplied.
Nothing was edited to remove it (that would mean altering the supplied
artwork), but **recommend re-exporting the pack with a tighter crop** before
shipping to end users.

## Art revision (v2)

All 30 coloring pages were redrawn with organic Bézier-curve artwork (bodies,
heads, limbs, ears, tails built from custom paths rather than plain circles/
ellipses), richer poses, and small accessories (carrot, honey jar, banana,
flowers, castle flags, wands, etc.) per the updated art direction. Each page
now has 12–25 independently clickable regions (437 total across all 30
pages). Small facial details that must stay black (pupils, nostrils, mouth
lines, decorative branch/handle strokes) are marked `data-fixed-color="true"`
and `js/coloring-engine.js` filters them out of both the clickable region
list and the fill-count used for completion tracking, so they can never be
recolored. The original v1 artwork is preserved in
`assets/coloring-pages-backup/` in case you want to compare or revert.

## Testing performed

- Validated all 30 SVG files: unique `data-region-id` values, `viewBox="0 0 800 600"`,
  12–25 fillable regions per picture (437 total fillable regions across all
  pages), no open (`fill="none"`) paths carrying a `data-region-id`, no
  malformed/`d`-less paths.
- Validated `data/coloring-pages.json` parses and lists all 30 pages across the
  5 content categories plus "All", and every `svg`/`thumbnail` path it
  references resolves to a real file.
- Syntax-checked all 6 JavaScript modules with `node --check` (no syntax errors).
- Served the project with a local HTTP server and confirmed `index.html`,
  `data/coloring-pages.json`, `css/style.css`, and sample SVG assets all return
  HTTP 200.
- Cross-checked every DOM id referenced from JavaScript (`getElementById`)
  against `index.html` to confirm there are no missing-element references.
- Fixed two bugs found during review: the brush/eraser overlay canvas was
  unreachable by pointer events (fixed by toggling `pointer-events` per tool),
  and the coloring canvas could be sized to 0×0 if loaded while the editor
  screen was still hidden (fixed by showing the screen before sizing the
  canvas). Also added canvas-content preservation across window resizes.

## v3 testing performed

- Confirmed all 30 supplied PNGs present (10 animals / 5 dinosaurs / 5
  vehicles / 5 fruits / 5 fantasy), all 800×600 RGB, all referenced paths in
  `data/coloring-pages.json` resolve to real files, no duplicate ids, `order`
  field forms a complete 1–30 sequence.
- Syntax-checked all 6 JS modules with `node --check` — no errors.
- Cross-checked every DOM id referenced from `app.js`/`gallery.js` against
  `index.html` — no missing elements (this caught and fixed leftover
  references to the removed `coloring-svg-host`/`brush-overlay` elements from
  the old SVG engine).
- Served the project with a local HTTP server and verified all 70 asset/code
  requests (30 images + 30 thumbnails + JSON + CSS + JS) return HTTP 200 with
  correct MIME types.
- Replicated the exact in-browser boundary/background/flood-fill algorithm in
  a standalone script (luminance threshold 140, 2px dilation, 4-connected
  component labeling) against all 30 source PNGs to pre-verify fill behavior
  and quantify leak risk without a live browser session — see the
  "Open-outline finding" table above.
- Fixed a real bug found during this rewrite: `_buildLineArt` initially read
  from the *dilated* boundary mask, which would have visibly thickened every
  outline on screen. Fixed to recompute the undilated boundary independently
  so the visible artwork stays pixel-for-pixel identical to the source PNGs.
- Added `localStorage` quota-exceeded handling to `storage-manager.js`:
  `saveProgress` now catches a failed write, drops the least-recently-updated
  saved picture(s), and retries, instead of silently losing the current
  picture's progress.
- No interactive browser was available this session (declined earlier), so
  actual pointer-driven fill/brush/export testing in Chrome/Edge/Safari has
  not been visually confirmed — the algorithmic pre-verification above is a
  substitute, not a replacement, for a manual click-through. Recommend
  testing fill behavior on a few pictures per category before shipping,
  given the open-outline finding above.

## Known limitations

- No interactive browser session was available in this environment, so the
  game has been validated through static analysis (SVG/JSON validation,
  JS syntax checks, HTTP smoke tests, DOM-id cross-checks) rather than a live
  click-through in Chrome/Edge/Safari. Please do a quick manual pass —
  especially brush drawing on touch devices — before shipping.
- Background music is a simple generated arpeggio (Web Audio API), off by
  default; there are no external audio files, per the "no external asset
  dependencies" requirement.
- `assets/audio/` and `assets/icons/` are present per the requested folder
  structure but intentionally empty — all sounds are synthesized in
  `audio-manager.js` and all icons are emoji glyphs, so no binary assets were
  needed.
