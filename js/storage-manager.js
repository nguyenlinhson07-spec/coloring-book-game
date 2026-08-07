/* storage-manager.js — localStorage persistence layer */
const StorageManager = (() => {
  const KEYS = {
    progress: 'hcb_progress_v1',
    settings: 'hcb_settings_v1',
    recentColors: 'hcb_recent_colors_v1',
    favorites: 'hcb_favorites_v1',
    lastState: 'hcb_last_state_v1'
  };

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('Storage read failed for', key, e);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('Storage write failed for', key, e);
    }
  }

  /* ---- Per-picture progress ---- */
  function getAllProgress() {
    return readJSON(KEYS.progress, {});
  }

  function getProgress(pageId) {
    const all = getAllProgress();
    return all[pageId] || null;
  }

  function saveProgress(pageId, data) {
    const all = getAllProgress();
    all[pageId] = { ...data, updatedAt: Date.now() };
    try {
      localStorage.setItem(KEYS.progress, JSON.stringify(all));
    } catch (e) {
      // Quota exceeded (painted PNG layers can be large) — drop the oldest
      // saved progress entries other than the one just colored, then retry.
      const entries = Object.entries(all)
        .filter(([id]) => id !== pageId)
        .sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0));
      while (entries.length) {
        const [staleId] = entries.shift();
        delete all[staleId];
        try {
          localStorage.setItem(KEYS.progress, JSON.stringify(all));
          console.warn('Storage quota exceeded — dropped oldest saved progress for', staleId);
          return;
        } catch (e2) { /* keep dropping */ }
      }
      console.warn('Storage quota exceeded and could not free enough space; progress not saved.', e);
    }
  }

  function deleteProgress(pageId) {
    const all = getAllProgress();
    delete all[pageId];
    writeJSON(KEYS.progress, all);
  }

  /* ---- Settings ---- */
  function getSettings() {
    return readJSON(KEYS.settings, { sound: true, music: false, volume: 0.6 });
  }

  function saveSettings(settings) {
    writeJSON(KEYS.settings, settings);
  }

  /* ---- Recent colors ---- */
  function getRecentColors() {
    return readJSON(KEYS.recentColors, []);
  }

  function pushRecentColor(hex) {
    let recent = getRecentColors().filter(c => c !== hex);
    recent.unshift(hex);
    recent = recent.slice(0, 12);
    writeJSON(KEYS.recentColors, recent);
    return recent;
  }

  /* ---- Favorites ---- */
  function getFavorites() {
    return readJSON(KEYS.favorites, []);
  }

  function toggleFavorite(pageId) {
    let favs = getFavorites();
    if (favs.includes(pageId)) {
      favs = favs.filter(id => id !== pageId);
    } else {
      favs.push(pageId);
    }
    writeJSON(KEYS.favorites, favs);
    return favs;
  }

  /* ---- Last app state (category/page) ---- */
  function getLastState() {
    return readJSON(KEYS.lastState, { category: 'all', page: 1 });
  }

  function saveLastState(state) {
    writeJSON(KEYS.lastState, state);
  }

  return {
    getAllProgress, getProgress, saveProgress, deleteProgress,
    getSettings, saveSettings,
    getRecentColors, pushRecentColor,
    getFavorites, toggleFavorite,
    getLastState, saveLastState
  };
})();
