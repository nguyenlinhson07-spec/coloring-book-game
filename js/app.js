/* app.js — screen routing, gallery grid, pagination, category filters, editor wiring */
const PALETTE = [
  { name: 'Coral Red', hex: '#ff6b6b' }, { name: 'Orange', hex: '#ffa94d' },
  { name: 'Sunshine Yellow', hex: '#ffe066' }, { name: 'Lime Green', hex: '#94d82d' },
  { name: 'Green', hex: '#40c057' }, { name: 'Teal', hex: '#20c997' },
  { name: 'Sky Blue', hex: '#4dabf7' }, { name: 'Blue', hex: '#3b5bdb' },
  { name: 'Purple', hex: '#9775fa' }, { name: 'Violet', hex: '#be4bdb' },
  { name: 'Pink', hex: '#f783ac' }, { name: 'Hot Pink', hex: '#ff4d94' },
  { name: 'Brown', hex: '#a56b46' }, { name: 'Tan', hex: '#e0b98a' },
  { name: 'Black', hex: '#212529' }, { name: 'White', hex: '#ffffff' },
  { name: 'Gray', hex: '#adb5bd' }, { name: 'Dark Gray', hex: '#495057' },
  { name: 'Pastel Pink', hex: '#ffd6e8' }, { name: 'Pastel Blue', hex: '#d0ebff' },
  { name: 'Pastel Green', hex: '#d3f9d8' }, { name: 'Pastel Yellow', hex: '#fff3bf' },
  { name: 'Pastel Purple', hex: '#e5dbff' }, { name: 'Pastel Orange', hex: '#ffe8cc' },
  { name: 'Dark Red', hex: '#c92a2a' }, { name: 'Dark Green', hex: '#2b8a3e' },
  { name: 'Dark Blue', hex: '#1864ab' }, { name: 'Navy', hex: '#1a1a4d' },
  { name: 'Maroon', hex: '#7d1f33' }, { name: 'Gold', hex: '#f0b429' },
  { name: 'Turquoise', hex: '#22b8cf' }, { name: 'Peach', hex: '#ffc9a3' }
];

const PAGE_SIZE = 6;

const PRAISE_PHRASES = [
  'Great job!', 'Awesome work!', 'You did it!', 'Amazing coloring!',
  'Wonderful!', 'Fantastic!', 'Super job!', 'You are a coloring star!'
];

/* ---------------- Voice narration (kid-friendly, non-readers) ---------------- */
const Voice = (() => {
  function speak(text) {
    if (!AudioManager.isEnabled()) return;
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.9;
    utter.pitch = 1.15;
    window.speechSynthesis.speak(utter);
  }
  return { speak };
})();

const App = (() => {
  let state = {
    category: 'all',
    page: 1,
    currentPageId: null,
    filteredIds: []
  };

  let engine = null;
  let els = {};

  function qs(id) { return document.getElementById(id); }

  async function init() {
    cacheEls();
    await ColoringData.load();

    const last = StorageManager.getLastState();
    state.category = last.category || 'all';
    state.page = last.page || 1;

    const settings = StorageManager.getSettings();
    AudioManager.setEnabled(settings.sound);
    AudioManager.setMusicEnabled(false);
    AudioManager.setVolume(settings.volume);
    updateSoundIcons();

    buildCategoryBar();
    buildColorGrid();
    renderRecentColors();
    applyFilter();
    renderGrid();

    bindGlobalEvents();
    bindEditorEvents();

    Gallery.init(els.galleryGrid, {
      onContinue: (pageId) => openEditor(pageId),
      onDownload: (pageId) => downloadSavedPage(pageId)
    });
  }

  function cacheEls() {
    els = {
      screenSelection: qs('screen-selection'),
      screenEditor: qs('screen-editor'),
      screenGallery: qs('screen-gallery'),
      categoryBar: qs('category-bar'),
      pictureGrid: qs('picture-grid'),
      prevPageBtn: qs('prev-page-btn'),
      nextPageBtn: qs('next-page-btn'),
      pageCounter: qs('page-counter'),
      soundToggleBtn: qs('sound-toggle-btn'),
      galleryOpenBtn: qs('gallery-open-btn'),
      galleryHomeBtn: qs('gallery-home-btn'),
      galleryGrid: qs('gallery-grid'),

      editorTitle: qs('editor-title'),
      editorHomeBtn: qs('editor-home-btn'),
      editorPrevBtn: qs('editor-prev-btn'),
      editorNextBtn: qs('editor-next-btn'),
      editorSoundBtn: qs('editor-sound-btn'),

      canvasHost: qs('coloring-canvas-host'),
      canvasViewport: qs('canvas-viewport'),

      toolFill: qs('tool-fill'),
      toolBrush: qs('tool-brush'),
      toolEraser: qs('tool-eraser'),
      toolUndo: qs('tool-undo'),
      toolRedo: qs('tool-redo'),
      toolReset: qs('tool-reset'),
      brushSize: qs('brush-size'),
      zoomInBtn: qs('zoom-in-btn'),
      zoomOutBtn: qs('zoom-out-btn'),
      zoomFitBtn: qs('zoom-fit-btn'),

      currentColorSwatch: qs('current-color-swatch'),
      currentColorLabel: qs('current-color-label'),
      colorGrid: qs('color-grid'),
      recentColorsRow: qs('recent-colors-row'),
      randomColorBtn: qs('random-color-btn'),
      rainbowColorBtn: qs('rainbow-color-btn'),
      saveBtn: qs('save-btn'),
      downloadBtn: qs('download-btn')
    };
  }

  /* ---------------- Parent Gate ---------------- */
  /* A lightweight speed bump (not real security) so a 4-year-old can't
     stumble into Reset or the advanced tool panel by mashing buttons. */
  function parentGate(onSuccess) {
    const a = 2 + Math.floor(Math.random() * 6);
    const b = 2 + Math.floor(Math.random() * 6);
    const correct = a + b;
    const choices = new Set([correct]);
    while (choices.size < 3) {
      choices.add(correct + (Math.floor(Math.random() * 7) - 3));
    }
    const options = Array.from(choices).filter(n => n >= 0).sort(() => Math.random() - 0.5);

    const overlay = document.createElement('div');
    overlay.className = 'parent-gate-overlay';
    overlay.innerHTML = `
      <div class="parent-gate-card">
        <h3>Parents Only</h3>
        <p>Please solve this to continue</p>
        <div class="parent-gate-question">${a} + ${b} = ?</div>
        <div class="parent-gate-choices">
          ${options.map(n => `<button data-value="${n}">${n}</button>`).join('')}
        </div>
        <div class="parent-gate-cancel"><button class="pill-btn" data-action="cancel">Cancel</button></div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('.parent-gate-choices button').forEach(btn => {
      btn.addEventListener('click', () => {
        const ok = Number(btn.dataset.value) === correct;
        overlay.remove();
        if (ok) onSuccess();
      });
    });
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());
  }

  /* ---------------- Category / Pagination ---------------- */
  function buildCategoryBar() {
    const cats = ColoringData.getCategories();
    els.categoryBar.innerHTML = '';
    cats.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'category-btn' + (cat.id === state.category ? ' active' : '');
      btn.innerHTML = `${cat.label} <span class="count">${ColoringData.categoryCount(cat.id)}</span>`;
      btn.addEventListener('click', () => {
        AudioManager.click();
        state.category = cat.id;
        state.page = 1;
        persistState();
        buildCategoryBar();
        applyFilter();
        renderGrid();
      });
      els.categoryBar.appendChild(btn);
    });
  }

  function applyFilter() {
    const pages = ColoringData.getPages();
    state.filteredIds = pages
      .filter(p => state.category === 'all' || p.category === state.category)
      .map(p => p.id);
    const maxPage = Math.max(1, Math.ceil(state.filteredIds.length / PAGE_SIZE));
    if (state.page > maxPage) state.page = maxPage;
  }

  function renderGrid() {
    const pages = ColoringData.getPages();
    const start = (state.page - 1) * PAGE_SIZE;
    const pageIds = state.filteredIds.slice(start, start + PAGE_SIZE);
    const favorites = StorageManager.getFavorites();
    const allProgress = StorageManager.getAllProgress();

    els.pictureGrid.innerHTML = '';
    pageIds.forEach(id => {
      const page = pages.find(p => p.id === id);
      els.pictureGrid.appendChild(buildPictureCard(page, favorites, allProgress[id]));
    });

    const maxPage = Math.max(1, Math.ceil(state.filteredIds.length / PAGE_SIZE));
    els.pageCounter.textContent = `Page ${state.page} / ${maxPage}`;
    els.prevPageBtn.disabled = state.page <= 1;
    els.nextPageBtn.disabled = state.page >= maxPage;
  }

  function buildPictureCard(page, favorites, progress) {
    const card = document.createElement('div');
    card.className = 'picture-card';

    const fav = document.createElement('button');
    fav.className = 'favorite-btn';
    fav.textContent = favorites.includes(page.id) ? '⭐' : '☆';
    fav.setAttribute('aria-label', 'Toggle favorite');
    fav.addEventListener('click', (e) => {
      e.stopPropagation();
      StorageManager.toggleFavorite(page.id);
      renderGrid();
    });

    const thumb = document.createElement('div');
    thumb.className = 'picture-thumb';
    const img = document.createElement('img');
    img.src = page.thumbnail;
    img.alt = page.title;
    img.loading = 'lazy';
    img.decoding = 'async';
    thumb.appendChild(img);

    const title = document.createElement('div');
    title.className = 'picture-card-title';
    title.textContent = page.title;

    card.append(fav, thumb, title);

    if (progress && progress.completionPercent) {
      const pill = document.createElement('div');
      pill.className = 'progress-pill';
      pill.textContent = progress.completionPercent + '%';
      card.appendChild(pill);
    }

    card.addEventListener('click', () => {
      AudioManager.click();
      openEditor(page.id);
    });
    card.addEventListener('touchstart', () => card.classList.add('touch-active'), { passive: true });
    card.addEventListener('touchend', () => card.classList.remove('touch-active'), { passive: true });

    return card;
  }

  function persistState() {
    StorageManager.saveLastState({ category: state.category, page: state.page });
  }

  /* ---------------- Global nav events ---------------- */
  function bindGlobalEvents() {
    els.prevPageBtn.addEventListener('click', () => {
      AudioManager.click();
      if (state.page > 1) { state.page--; persistState(); renderGrid(); }
    });
    els.nextPageBtn.addEventListener('click', () => {
      AudioManager.click();
      const maxPage = Math.max(1, Math.ceil(state.filteredIds.length / PAGE_SIZE));
      if (state.page < maxPage) { state.page++; persistState(); renderGrid(); }
    });
    els.soundToggleBtn.addEventListener('click', toggleSound);
    els.editorSoundBtn.addEventListener('click', toggleSound);

    els.galleryOpenBtn.addEventListener('click', () => {
      AudioManager.click();
      Gallery.render();
      showScreen('gallery');
    });
    els.galleryHomeBtn.addEventListener('click', () => {
      AudioManager.click();
      showScreen('selection');
    });
  }

  function toggleSound() {
    const settings = StorageManager.getSettings();
    settings.sound = !settings.sound;
    StorageManager.saveSettings(settings);
    AudioManager.setEnabled(settings.sound);
    updateSoundIcons();
    if (settings.sound) {
      AudioManager.click();
      const page = state.currentPageId && ColoringData.getPageById(state.currentPageId);
      if (page && !els.screenEditor.classList.contains('hidden')) {
        AudioManager.startAmbient(page.category);
      }
    }
  }

  function updateSoundIcons() {
    const on = AudioManager.isEnabled();
    els.soundToggleBtn.textContent = on ? '🔊' : '🔇';
    els.editorSoundBtn.textContent = on ? '🔊' : '🔇';
  }

  function showScreen(name) {
    els.screenSelection.classList.toggle('hidden', name !== 'selection');
    els.screenEditor.classList.toggle('hidden', name !== 'editor');
    els.screenGallery.classList.toggle('hidden', name !== 'gallery');
    if (name === 'selection') { applyFilter(); renderGrid(); }
  }

  /* ---------------- Editor ---------------- */
  function buildColorGrid() {
    els.colorGrid.innerHTML = '';
    PALETTE.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'color-swatch';
      btn.style.background = c.hex;
      btn.title = c.name;
      btn.dataset.hex = c.hex;
      btn.addEventListener('click', () => selectColor(c.hex, c.name));
      els.colorGrid.appendChild(btn);
    });
  }

  function selectColor(hex, name, announce = true) {
    engine && engine.setColor(hex);
    els.currentColorSwatch.style.background = hex;
    els.currentColorLabel.textContent = name || hex;
    highlightActiveSwatch(hex);
    const recent = StorageManager.pushRecentColor(hex);
    renderRecentColors(recent);
    AudioManager.colorSelect();
    if (name && announce) Voice.speak(name);
    setTool('fill');
  }

  function highlightActiveSwatch(hex) {
    els.colorGrid.querySelectorAll('.color-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.hex === hex);
    });
  }

  function renderRecentColors(list) {
    const recent = list || StorageManager.getRecentColors();
    els.recentColorsRow.innerHTML = '';
    recent.forEach(hex => {
      const btn = document.createElement('button');
      btn.className = 'color-swatch';
      btn.style.background = hex;
      btn.addEventListener('click', () => selectColor(hex));
      els.recentColorsRow.appendChild(btn);
    });
  }

  function setTool(tool) {
    engine && engine.setTool(tool);
    [els.toolFill, els.toolBrush, els.toolEraser].forEach(b => b.classList.remove('active'));
    if (tool === 'fill') els.toolFill.classList.add('active');
    if (tool === 'brush') els.toolBrush.classList.add('active');
    if (tool === 'eraser') els.toolEraser.classList.add('active');
  }

  function bindEditorEvents() {
    els.toolFill.addEventListener('click', () => setTool('fill'));
    els.toolBrush.addEventListener('click', () => setTool('brush'));
    els.toolEraser.addEventListener('click', () => setTool('eraser'));
    els.toolUndo.addEventListener('click', () => { engine.undo(); AudioManager.undo(); });
    els.toolRedo.addEventListener('click', () => { engine.redo(); AudioManager.undo(); });
    els.toolReset.addEventListener('click', () => {
      parentGate(() => engine.reset());
    });
    els.brushSize.addEventListener('input', (e) => engine.setBrushSize(Number(e.target.value)));

    els.zoomInBtn.addEventListener('click', () => engine.zoomIn());
    els.zoomOutBtn.addEventListener('click', () => engine.zoomOut());
    els.zoomFitBtn.addEventListener('click', () => engine.fitToScreen());

    els.randomColorBtn.addEventListener('click', () => {
      const c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      selectColor(c.hex, c.name);
    });
    els.rainbowColorBtn.addEventListener('click', () => {
      const rainbow = ['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#9775fa'];
      const hex = rainbow[Math.floor(Math.random() * rainbow.length)];
      selectColor(hex, 'Rainbow');
    });

    els.saveBtn.addEventListener('click', () => saveCurrentProgress(true));
    els.downloadBtn.addEventListener('click', () => {
      parentGate(() => engine.exportPNG(`${state.currentPageId || 'coloring'}.png`));
    });

    els.editorHomeBtn.addEventListener('click', () => {
      saveCurrentProgress(false);
      AudioManager.stopAmbient();
      showScreen('selection');
    });
    els.editorPrevBtn.addEventListener('click', () => navigatePicture(-1));
    els.editorNextBtn.addEventListener('click', () => navigatePicture(1));
  }

  async function openEditor(pageId) {
    const page = ColoringData.getPageById(pageId);
    if (!page) return;
    state.currentPageId = pageId;
    els.editorTitle.textContent = page.title;

    if (!engine) {
      engine = new ColoringEngine({
        container: els.canvasHost,
        onChange: () => {},
        onComplete: () => celebrate(),
        onInvalidClick: () => AudioManager.invalid()
      });
    }

    showScreen('editor');
    const saved = StorageManager.getProgress(pageId);
    await engine.loadPage(page, saved);
    setTool('fill');
    selectColor(PALETTE[0].hex, PALETTE[0].name, false);
    Voice.speak(page.title);
    AudioManager.startAmbient(page.category);
  }

  function navigatePicture(delta) {
    saveCurrentProgress(false);
    const ids = ColoringData.getPages().map(p => p.id);
    const idx = ids.indexOf(state.currentPageId);
    const nextIdx = (idx + delta + ids.length) % ids.length;
    openEditor(ids[nextIdx]);
  }

  function saveCurrentProgress(playSound) {
    if (!engine || !state.currentPageId) return;
    const data = engine.serialize();
    StorageManager.saveProgress(state.currentPageId, data);
    if (playSound) AudioManager.fill();
  }

  async function downloadSavedPage(pageId) {
    const page = ColoringData.getPageById(pageId);
    const saved = StorageManager.getProgress(pageId);
    if (!page || !saved) return;
    const canvas = await ColoringEngine.renderComposite(page.image, saved.paintDataUrl);
    canvas.toBlob((blob) => {
      const link = document.createElement('a');
      link.download = `${page.id}.png`;
      link.href = URL.createObjectURL(blob);
      link.click();
    }, 'image/png');
  }

  /* ---------------- Celebration ---------------- */
  function celebrate() {
    saveCurrentProgress(false);
    AudioManager.completion();
    runConfetti();
    const praise = PRAISE_PHRASES[Math.floor(Math.random() * PRAISE_PHRASES.length)];
    Voice.speak(praise);
  }

  function runConfetti() {
    const canvas = qs('confetti-canvas');
    canvas.classList.remove('hidden');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    const colors = ['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#9775fa', '#f783ac'];
    const pieces = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height,
      size: 6 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      speed: 2 + Math.random() * 4,
      drift: (Math.random() - 0.5) * 2,
      rotation: Math.random() * 360,
      spin: (Math.random() - 0.5) * 10
    }));
    let frames = 0;
    const maxFrames = 220;
    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.y += p.speed;
        p.x += p.drift;
        p.rotation += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      });
      frames++;
      if (frames < maxFrames) {
        requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.classList.add('hidden');
      }
    }
    tick();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
