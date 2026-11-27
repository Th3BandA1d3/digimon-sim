// Offline support: the app shell is cached on install; card images are cached as you see them.
// Bump VERSION (and APP_VERSION in js/devfixes.js) when you change any app file so phones pick up the update.
const VERSION = 'v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'js/app.js', 'js/util.js', 'js/cards.js', 'js/engine.js', 'js/ai.js', 'js/deckparse.js', 'js/carddb.js', 'js/storage.js',
  'js/devfixes.js', 'js/rulefixes.js', 'js/data/demo.js', 'js/ui/dom.js', 'js/ui/board.js', 'js/ui/devui.js', 'js/ui/explain.js',
];
const IMG = 'img-v1';
const MAX_IMAGES = 2000;
async function trim(c) { const keys = await c.keys(); for (let i = 0; i < keys.length - MAX_IMAGES; i++) await c.delete(keys[i]); }

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('shell-' + VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !k.endsWith(VERSION) && k !== IMG).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'images.digimoncard.io') {
    e.respondWith(caches.open(IMG).then(async (c) => {
      const hit = await c.match(e.request.url); if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok || r.type === 'opaque') { c.put(e.request.url, r.clone()); trim(c); } return r; } catch { return fetch(e.request); }
    }));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open('shell-' + VERSION).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
