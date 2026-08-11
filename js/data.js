/* data.js — loads coloring-pages.json (flat array schema) and exposes it as a simple module */
const ColoringData = (() => {
  const CATEGORIES = [
    { id: 'all', label: 'All' },
    { id: 'animals', label: 'Animals' },
    { id: 'dinosaurs', label: 'Dinosaurs' },
    { id: 'brainrot', label: 'Brainrot' }
  ];

  let pages = [];

  async function load() {
    if (pages.length) return pages;
    const res = await fetch('data/coloring-pages.json');
    if (!res.ok) throw new Error('Failed to load coloring-pages.json');
    const raw = await res.json();
    const list = Array.isArray(raw) ? raw : (raw.pages || []);
    pages = list.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return pages;
  }

  function getPages() {
    return pages;
  }

  function getCategories() {
    return CATEGORIES;
  }

  function getPageById(id) {
    return pages.find(p => p.id === id) || null;
  }

  function categoryCount(categoryId) {
    if (categoryId === 'all') return pages.length;
    return pages.filter(p => p.category === categoryId).length;
  }

  return { load, getPages, getCategories, getPageById, categoryCount };
})();
