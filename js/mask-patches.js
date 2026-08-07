/* mask-patches.js — manual, per-picture corrections to the HIDDEN boundary mask.
   These patches are the single source of truth for both:
     1) tools/build_masks.py (offline build — bakes patches into the precomputed
        mask.png / regions.png files shipped with the game), and
     2) coloring-engine.js at runtime (belt-and-suspenders: re-applied to the
        loaded mask in memory, in case masks are regenerated without patches).

   IMPORTANT: patches only ever draw onto the invisible fill-boundary mask.
   They never touch the visible line-art layer, so the artwork the player
   sees is always pixel-for-pixel identical to the supplied PNG.

   Each segment is a short straight line drawn onto the hidden mask in
   source-image pixel coordinates (800x600), used to bridge a specific,
   confirmed small/moderate outline gap that automatic thresholding +
   dilation could not safely close on its own.

   Format:
   {
     "<page-id>": [
       { "x1": 0, "y1": 0, "x2": 0, "y2": 0, "width": 4 },
       ...
     ]
   }
*/
const MaskPatches = {
  /* Cat, Dog — current artwork set both PASS automatically (see
     tools/boundary-audit-report.json). No patches needed. */
};

/* Per-picture hidden-mask dilation override (pixels). Most pictures use the
   global default (see DEFAULT_DILATE_PX in tools/build_masks.py). These five
   have densely packed fine detail (pinstripes, fur strands, cactus spikes,
   ring bands) where the default 2px dilation fused adjacent lines together
   and swallowed most of the interior into the boundary — a lighter dilation
   keeps gaps closed without eating the fillable area between detail lines. */
const MaskDilateOverrides = {
  "lirili-larila": 0,
  "brr-brr-patapim": 0,
  "bombombini-gusini": 0,
  "vacca-saturno-saturnita": 0,
  "mafia-monkey": 0
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MaskPatches, MaskDilateOverrides };
}
