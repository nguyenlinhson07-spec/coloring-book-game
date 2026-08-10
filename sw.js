/* sw.js — offline support for the coloring book.
   Strategy: precache the app shell + the (small) mask/region PNGs at
   install time, so the picture-selection screen and fill-tool work fully
   offline. The full-resolution artwork PNGs are large (tens of MB total)
   so they are NOT precached — instead they're cached the first time a
   picture is opened (cache-first-then-network), meaning any picture the
   child has already colored keeps working offline, and new ones just
   need one online visit. */
const CACHE_VERSION = 'v4';
const SHELL_CACHE = `coloring-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `coloring-runtime-${CACHE_VERSION}`;

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'css/responsive.css',
  'js/data.js',
  'js/storage-manager.js',
  'js/audio-manager.js',
  'js/mask-patches.js',
  'js/coloring-engine.js',
  'js/gallery.js',
  'js/app.js',
  'data/coloring-pages.json',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_FILES);
    try {
      const res = await fetch('data/coloring-pages.json');
      const pages = await res.json();
      // Masks/region-maps are tiny and needed for the fill tool to work at
      // all; thumbnails are small (~30-150KB each, ~2MB total) and make the
      // picture-selection grid usable offline too. Full-resolution artwork
      // stays out of precache (see file header) — cached on first open.
      const urls = pages.flatMap(p => [p.mask, p.regionMap, p.thumbnail]).filter(Boolean);
      await cache.addAll(urls);
    } catch (e) {
      // offline install (rare) — masks/thumbnails will be cached at runtime instead.
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n !== SHELL_CACHE && n !== RUNTIME_CACHE).map(n => caches.delete(n))
    );
    self.clients.claim();
  })());
});

/* Anything that IS the app (markup/code/config/catalog) must never be
   served stale-forever from a cache-first hit — this game gets new pages
   and fixes pushed regularly, and a returning player should see them the
   moment they're online, not "whenever the cache version happens to bump".
   Only the large, effectively-immutable art assets (coloring-page PNGs,
   mask/region PNGs) stay cache-first, since those really don't change
   once published and are the whole point of the offline support. */
function isAppCode(url) {
  const path = new URL(url).pathname;
  return path.endsWith('/') || path.endsWith('.html') || path.endsWith('.js') ||
    path.endsWith('.css') || path.endsWith('manifest.json') || path.endsWith('coloring-pages.json');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (isAppCode(req.url)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (e) {
        const cached = await caches.match(req, { cacheName: SHELL_CACHE }) ||
          await caches.match('index.html', { cacheName: SHELL_CACHE });
        if (cached) return cached;
        throw e;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const shellHit = await caches.match(req, { cacheName: SHELL_CACHE });
    if (shellHit) return shellHit;

    const runtimeHit = await caches.match(req, { cacheName: RUNTIME_CACHE });
    if (runtimeHit) return runtimeHit;

    try {
      const fresh = await fetch(req);
      if (fresh.ok && new URL(req.url).origin === self.location.origin) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (e) {
      if (req.mode === 'navigate') {
        return caches.match('index.html', { cacheName: SHELL_CACHE });
      }
      throw e;
    }
  })());
});
