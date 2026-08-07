/* coloring-engine.js — Canvas-based coloring engine using PRECOMPUTED boundary
   masks + region-ID maps (built offline by tools/build_masks.py) instead of
   computing fill boundaries live from the raw PNG pixels.

   Why: the supplied line art has real (non-antialiasing) gaps in many
   outlines, so a naive live flood-fill leaks from the character's body into
   the surrounding white background. tools/build_masks.py pre-analyzes each
   picture (threshold + hidden-mask dilation + manual gap patches from
   js/mask-patches.js + exterior-background detection + connected-component
   labeling) and ships two small PNGs per picture:
     - <name>-mask.png    pure black/white hidden boundary mask (unused at
                           runtime except for reference/debugging — kept for
                           transparency/inspection)
     - <name>-regions.png region ID encoded in the R/G channels; 0 = outline
                           or exterior background (never fillable), 1..N =
                           an enclosed, independently fillable region

   Layers (unchanged from the raw-pixel version):
     - Paint layer   — bucket fills + brush/eraser strokes, drawn first.
     - Line-art mask — built from the RAW (unpatched, undilated) pixels of
                        the original PNG, drawn on top every frame, so the
                        artwork the player sees is always pixel-for-pixel
                        identical to the supplied image — only the INVISIBLE
                        region map (used for fill decisions) was corrected. */
class ColoringEngine {
  static W = 800;
  static H = 600;
  static DARK_THRESHOLD = 140;  // luminance below this = boundary pixel (VISIBLE line-art layer only)
  static MAX_HISTORY = 31;      // 30 undoable actions + the initial state
  static FIT_FRACTION = 0.88;   // artwork occupies ~88% of the canvas, aspect-ratio preserved

  /* Contain-fit + center an image of natural size (imgW,imgH) inside the
     canvas, scaled so it occupies FIT_FRACTION of the available space, with
     no stretching/cropping. Must stay in lockstep with the identical
     computation in tools/build_masks.py so the (invisible) region map lines
     up pixel-for-pixel with the visible line art drawn here. */
  static fitRect(imgW, imgH) {
    const { W, H, FIT_FRACTION } = ColoringEngine;
    const scale = Math.min((W * FIT_FRACTION) / imgW, (H * FIT_FRACTION) / imgH);
    const w = imgW * scale;
    const h = imgH * scale;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  constructor({ container, onChange, onComplete, onInvalidClick }) {
    this.container = container;
    this.onChange = onChange || (() => {});
    this.onComplete = onComplete || (() => {});
    this.onInvalidClick = onInvalidClick || (() => {});

    this.canvas = document.createElement('canvas');
    this.canvas.width = ColoringEngine.W;
    this.canvas.height = ColoringEngine.H;
    this.canvas.style.touchAction = 'none';
    this.canvas.style.background = '#ffffff';
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.container.innerHTML = '';
    this.container.appendChild(this.canvas);

    this.paintCanvas = document.createElement('canvas');
    this.paintCanvas.width = ColoringEngine.W;
    this.paintCanvas.height = ColoringEngine.H;
    this.paintCtx = this.paintCanvas.getContext('2d', { willReadFrequently: true });

    this.lineArtCanvas = document.createElement('canvas');
    this.lineArtCanvas.width = ColoringEngine.W;
    this.lineArtCanvas.height = ColoringEngine.H;
    this.lineArtCtx = this.lineArtCanvas.getContext('2d');

    this.tool = 'fill';
    this.currentColor = '#ff6b6b';
    this.brushSize = 14;
    this.scale = 1;

    this.regionIds = null;          // Uint32Array, one entry per pixel (0 = not fillable)
    this.regionPixelIndex = null;   // Map<regionId, Int32Array of pixel indices>
    this.totalFillablePixels = 0;
    this.lastCompletion = 0;
    this.completed = false;

    this.history = [];
    this.historyIndex = -1;

    this._drawing = false;
    this._lastPoint = null;

    this._bindPointerEvents();
  }

  /* ---------------- Load ---------------- */
  async loadPage(pageData, savedState) {
    this.pageId = pageData.id;
    this.completed = false;

    const img = await this._loadImage(pageData.image);
    const rect = ColoringEngine.fitRect(img.naturalWidth, img.naturalHeight);
    this.ctx.clearRect(0, 0, ColoringEngine.W, ColoringEngine.H);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, ColoringEngine.W, ColoringEngine.H);
    this.ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
    const sourceData = this.ctx.getImageData(0, 0, ColoringEngine.W, ColoringEngine.H);
    this._buildLineArt(sourceData);

    await this._loadRegionMap(pageData);

    this.paintCtx.clearRect(0, 0, ColoringEngine.W, ColoringEngine.H);
    if (savedState && savedState.paintDataUrl) {
      const paintImg = await this._loadImage(savedState.paintDataUrl);
      this.paintCtx.drawImage(paintImg, 0, 0, ColoringEngine.W, ColoringEngine.H);
    }

    this.history = [this.paintCanvas.toDataURL()];
    this.historyIndex = 0;

    this.setZoom(1);
    this.render();
    this._updateCompletion(false);
    this._notifyChange();
  }

  /* Load the precomputed region-ID map (see tools/build_masks.py) and index
     each region's pixels once, so a click fills by O(1) map lookup + a
     precomputed pixel list instead of scanning/flood-filling at click time. */
  async _loadRegionMap(pageData) {
    const { W, H } = ColoringEngine;
    this.regionIds = new Uint32Array(W * H);
    this.regionPixelIndex = new Map();
    this.totalFillablePixels = 0;

    if (!pageData.regionMap) {
      // No precomputed map shipped for this picture — fail safe: nothing is
      // fillable rather than risk an unbounded leak into the background.
      console.warn('No regionMap for page', pageData.id, '— fill bucket disabled for this picture.');
      return;
    }

    let regionImg;
    try {
      regionImg = await this._loadImage(pageData.regionMap);
    } catch (e) {
      console.warn('Failed to load regionMap for', pageData.id, e);
      return;
    }

    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.drawImage(regionImg, 0, 0, W, H);
    const data = tctx.getImageData(0, 0, W, H).data;

    const buckets = new Map();
    const count = W * H;
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      const id = data[o] + data[o + 1] * 256; // R + G*256, matches build_masks.py encoding
      this.regionIds[i] = id;
      if (id > 0) {
        if (!buckets.has(id)) buckets.set(id, []);
        buckets.get(id).push(i);
        this.totalFillablePixels++;
      }
    }
    for (const [id, indices] of buckets) {
      this.regionPixelIndex.set(id, Int32Array.from(indices));
    }
    if (this.totalFillablePixels === 0) this.totalFillablePixels = 1; // avoid div-by-zero
  }

  _loadImage(src) {
    return ColoringEngine.loadImage(src);
  }

  static loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image: ' + src));
      img.src = src;
    });
  }

  /* Standalone compositor (no live engine instance needed) — used by the
     gallery to show colored-in progress thumbnails and to export/download
     a saved-but-not-currently-open picture's progress as a clean PNG. Only
     needs the visible line art (built from raw pixels), not the hidden
     region map. */
  static async renderComposite(imageSrc, paintDataUrl) {
    const { W, H, DARK_THRESHOLD } = ColoringEngine;
    const img = await ColoringEngine.loadImage(imageSrc);

    const rect = ColoringEngine.fitRect(img.naturalWidth, img.naturalHeight);
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = W; srcCanvas.height = H;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.fillStyle = '#ffffff';
    srcCtx.fillRect(0, 0, W, H);
    srcCtx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
    const sourceData = srcCtx.getImageData(0, 0, W, H);
    const s = sourceData.data;

    const lineArt = srcCtx.createImageData(W, H);
    const d = lineArt.data;
    const count = W * H;
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      const alpha = s[o + 3];
      const luminance = 0.299 * s[o] + 0.587 * s[o + 1] + 0.114 * s[o + 2];
      if (alpha >= 8 && luminance < DARK_THRESHOLD) {
        d[o] = s[o]; d[o + 1] = s[o + 1]; d[o + 2] = s[o + 2]; d[o + 3] = 255;
      } else {
        d[o + 3] = 0;
      }
    }
    const lineArtCanvas = document.createElement('canvas');
    lineArtCanvas.width = W; lineArtCanvas.height = H;
    lineArtCanvas.getContext('2d').putImageData(lineArt, 0, 0);

    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const outCtx = out.getContext('2d');
    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, W, H);
    if (paintDataUrl) {
      const paintImg = await ColoringEngine.loadImage(paintDataUrl);
      outCtx.drawImage(paintImg, 0, 0, W, H);
    }
    outCtx.drawImage(lineArtCanvas, 0, 0);
    return out;
  }

  /* Line-art overlay: keep dark pixels opaque, make everything else fully
     transparent so the paint layer beneath remains visible. Built from the
     RAW pixels of the original PNG — completely independent of the hidden
     region map, so the visible artwork is always pixel-for-pixel identical
     to the supplied source image. */
  _buildLineArt(sourceData) {
    const { W, H, DARK_THRESHOLD } = ColoringEngine;
    const out = this.lineArtCtx.createImageData(W, H);
    const src = sourceData.data;
    const dst = out.data;
    const count = W * H;
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      const alpha = src[o + 3];
      const luminance = 0.299 * src[o] + 0.587 * src[o + 1] + 0.114 * src[o + 2];
      if (alpha >= 8 && luminance < DARK_THRESHOLD) {
        dst[o] = src[o]; dst[o + 1] = src[o + 1]; dst[o + 2] = src[o + 2]; dst[o + 3] = 255;
      } else {
        dst[o + 3] = 0;
      }
    }
    this.lineArtCtx.putImageData(out, 0, 0);
  }

  /* ---------------- Render ---------------- */
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, ColoringEngine.W, ColoringEngine.H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ColoringEngine.W, ColoringEngine.H);
    ctx.drawImage(this.paintCanvas, 0, 0);
    ctx.drawImage(this.lineArtCanvas, 0, 0);
  }

  /* ---------------- Region-ID fill (replaces live flood fill) ---------------- */
  /* Kid-friendly touch tolerance: a young child's tap is rarely pixel-perfect
     on a thin outline. If the exact pixel misses (lands on an outline or the
     background), search outward in a small ring for the nearest fillable
     region instead of rejecting the tap outright. */
  static TOUCH_TOLERANCE_PX = 16;

  _findNearbyRegion(px, py) {
    const { W, H } = ColoringEngine;
    const maxR = ColoringEngine.TOUCH_TOLERANCE_PX;
    for (let r = 1; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
          const x = px + dx, y = py + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const id = this.regionIds[y * W + x];
          if (id) return id;
        }
      }
    }
    return 0;
  }

  _fillRegionAt(px, py) {
    const { W, H } = ColoringEngine;
    if (px < 0 || py < 0 || px >= W || py >= H || !this.regionIds) return false;
    const idx = py * W + px;
    let regionId = this.regionIds[idx];
    if (!regionId) regionId = this._findNearbyRegion(px, py);
    if (!regionId) return false; // 0 = outline pixel, exterior background, or no map loaded

    const pixels = this.regionPixelIndex.get(regionId);
    if (!pixels || !pixels.length) return false;

    const [r, g, b] = this._hexToRgb(this.currentColor);
    const imgData = this.paintCtx.getImageData(0, 0, W, H);
    const data = imgData.data;
    for (let i = 0; i < pixels.length; i++) {
      const o = pixels[i] * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
    this.paintCtx.putImageData(imgData, 0, 0);
    return true;
  }

  _hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean.length === 3
      ? clean.split('').map(c => c + c).join('')
      : clean, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  /* ---------------- Pointer input ---------------- */
  _bindPointerEvents() {
    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', (e) => this._onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this._onPointerUp(e));
  }

  _canvasPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = ColoringEngine.W / rect.width;
    const scaleY = ColoringEngine.H / rect.height;
    return {
      x: Math.floor((e.clientX - rect.left) * scaleX),
      y: Math.floor((e.clientY - rect.top) * scaleY)
    };
  }

  _onPointerDown(e) {
    e.preventDefault();
    const p = this._canvasPoint(e);
    if (this.tool === 'fill') {
      const filled = this._fillRegionAt(p.x, p.y);
      this.render();
      if (filled) {
        this._ripple(p.x, p.y);
        this._pushHistory();
        this._updateCompletion(true);
        this._notifyChange();
      } else {
        // Clicked an outline pixel or the exterior background — reject
        // silently (per spec: do nothing, optionally a soft invalid sound).
        this.onInvalidClick();
      }
      return;
    }
    this._drawing = true;
    this._lastPoint = p;
    this._drawDot(p);
    this.render();
  }

  _onPointerMove(e) {
    if (!this._drawing) return;
    e.preventDefault();
    const p = this._canvasPoint(e);
    this._drawLine(this._lastPoint, p);
    this._lastPoint = p;
    this.render();
  }

  _onPointerUp() {
    if (!this._drawing) return;
    this._drawing = false;
    this._pushHistory();
    this._updateCompletion(true);
    this._notifyChange();
  }

  _drawDot(p) {
    const ctx = this.paintCtx;
    ctx.save();
    this._applyBrushStyle(ctx);
    ctx.beginPath();
    ctx.arc(p.x, p.y, this.brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawLine(from, to) {
    const ctx = this.paintCtx;
    ctx.save();
    this._applyBrushStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineWidth = this.brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  _applyBrushStyle(ctx) {
    if (this.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = this.currentColor;
      ctx.fillStyle = this.currentColor;
    }
  }

  _ripple(px, py) {
    let r = 6, o = 0.8;
    const step = () => {
      this.render();
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = Math.max(o, 0);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      r += 8; o -= 0.08;
      if (o > 0) requestAnimationFrame(step); else this.render();
    };
    step();
  }

  /* ---------------- Tools / color ---------------- */
  setTool(tool) { this.tool = tool; }
  setColor(hex) { this.currentColor = hex; }
  setBrushSize(size) { this.brushSize = size; }

  /* ---------------- Undo / redo ---------------- */
  _pushHistory() {
    const url = this.paintCanvas.toDataURL();
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(url);
    if (this.history.length > ColoringEngine.MAX_HISTORY) {
      this.history.shift();
    }
    this.historyIndex = this.history.length - 1;
  }

  async undo() {
    if (this.historyIndex <= 0) return false;
    this.historyIndex--;
    await this._restorePaintFromDataUrl(this.history[this.historyIndex]);
    this._updateCompletion(false);
    this._notifyChange();
    return true;
  }

  async redo() {
    if (this.historyIndex >= this.history.length - 1) return false;
    this.historyIndex++;
    await this._restorePaintFromDataUrl(this.history[this.historyIndex]);
    this._updateCompletion(false);
    this._notifyChange();
    return true;
  }

  async _restorePaintFromDataUrl(url) {
    this.paintCtx.clearRect(0, 0, ColoringEngine.W, ColoringEngine.H);
    const img = await this._loadImage(url);
    this.paintCtx.drawImage(img, 0, 0, ColoringEngine.W, ColoringEngine.H);
    this.render();
  }

  /* ---------------- Reset ---------------- */
  reset() {
    this.paintCtx.clearRect(0, 0, ColoringEngine.W, ColoringEngine.H);
    this.render();
    this._pushHistory();
    this.completed = false;
    this._updateCompletion(false);
    this._notifyChange();
  }

  /* ---------------- Zoom ---------------- */
  setZoom(scale) {
    this.scale = Math.max(0.5, Math.min(3, scale));
    this.canvas.style.transform = `scale(${this.scale})`;
  }
  zoomIn() { this.setZoom(this.scale + 0.2); }
  zoomOut() { this.setZoom(this.scale - 0.2); }
  fitToScreen() { this.setZoom(1); }

  /* ---------------- Completion ---------------- */
  _updateCompletion(allowCelebrate) {
    const { W, H } = ColoringEngine;
    if (!this.regionIds) { this.lastCompletion = 0; return; }
    const data = this.paintCtx.getImageData(0, 0, W, H).data;
    let colored = 0;
    const count = W * H;
    for (let i = 0; i < count; i++) {
      if (this.regionIds[i] > 0 && data[i * 4 + 3] > 10) colored++;
    }
    this.lastCompletion = Math.round((colored / this.totalFillablePixels) * 100);
    if (allowCelebrate && this.lastCompletion >= 90 && !this.completed) {
      this.completed = true;
      this.onComplete(this.lastCompletion);
    }
  }

  getCompletionPercent() {
    return this.lastCompletion;
  }

  /* ---------------- Serialize / export ---------------- */
  serialize() {
    return {
      paintDataUrl: this.paintCanvas.toDataURL(),
      completionPercent: this.lastCompletion
    };
  }

  exportPNG(filename) {
    this.render();
    this.canvas.toBlob((blob) => {
      const link = document.createElement('a');
      link.download = filename || 'my-coloring-page.png';
      link.href = URL.createObjectURL(blob);
      link.click();
    }, 'image/png');
  }

  _notifyChange() {
    this.onChange(this.serialize());
  }
}
