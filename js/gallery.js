/* gallery.js — renders saved / finished pictures screen */
const Gallery = (() => {
  let container = null;
  let callbacks = {};

  function init(containerEl, cbs) {
    container = containerEl;
    callbacks = cbs || {};
  }

  function render() {
    const progress = StorageManager.getAllProgress();
    const entries = Object.entries(progress);
    container.innerHTML = '';

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No saved pictures yet. Start coloring to see them here!';
      container.appendChild(empty);
      return;
    }

    entries
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .forEach(([pageId, data]) => {
        const page = ColoringData.getPageById(pageId);
        if (!page) return;
        container.appendChild(buildCard(page, data));
      });
  }

  function buildCard(page, data) {
    const card = document.createElement('div');
    card.className = 'gallery-card';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'picture-thumb';
    thumbWrap.innerHTML = '<div style="font-size:40px;">🖼️</div>';
    ColoringEngine.renderComposite(page.image, data.paintDataUrl)
      .then((canvas) => {
        thumbWrap.innerHTML = '';
        const img = document.createElement('img');
        img.alt = page.title;
        img.src = canvas.toDataURL();
        thumbWrap.appendChild(img);
      })
      .catch(() => {});

    const title = document.createElement('div');
    title.className = 'picture-card-title';
    title.textContent = page.title;

    const category = document.createElement('div');
    category.style.fontSize = '12px';
    category.style.fontWeight = '700';
    category.style.color = '#a5a8bd';
    category.style.textTransform = 'capitalize';
    category.textContent = page.category;

    const pct = document.createElement('div');
    pct.style.fontWeight = '700';
    pct.style.fontSize = '13px';
    pct.style.color = '#7a7d94';
    pct.textContent = `${data.completionPercent || 0}% complete`;

    const actions = document.createElement('div');
    actions.className = 'gallery-card-actions';

    const continueBtn = document.createElement('button');
    continueBtn.textContent = '▶️ Continue';
    continueBtn.addEventListener('click', () => callbacks.onContinue && callbacks.onContinue(page.id));

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = '⬇️ Download';
    downloadBtn.addEventListener('click', () => callbacks.onDownload && callbacks.onDownload(page.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑️ Delete';
    deleteBtn.addEventListener('click', () => {
      StorageManager.deleteProgress(page.id);
      render();
    });

    actions.append(continueBtn, downloadBtn, deleteBtn);
    card.append(thumbWrap, title, category, pct, actions);
    return card;
  }

  return { init, render };
})();
