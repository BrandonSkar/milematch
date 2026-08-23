/* Service worker.
 * Two jobs: make the app installable as a desktop app, and make it work
 * offline. Your balances live in localStorage, so an offline launch still
 * gives you the full points engine — only live fare lookups need the network.
 *
 * Bump CACHE when you change any cached file, or the old copy will stick around.
 */
const CACHE = 'milematch-v9';

const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/engine.js',
  './js/flights.js',
  './js/store.js',
  './js/app.js',
  './data/config.js',
  './data/airports.js',
  './data/programs.js',
  './data/charts.js',
  './data/cards.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Individual addAll failures would abort the whole install, so tolerate
      // a missing asset rather than leaving the app uninstallable.
      .then((cache) => Promise.allSettled(ASSETS.map((a) => cache.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache fare lookups — a stale price is worse than no price.
  if (url.pathname.includes('/search') || url.pathname.includes('/health')) {
    event.respondWith(fetch(req).catch(() => new Response(
      JSON.stringify({ error: 'offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )));
    return;
  }

  // App shell: serve from cache, refresh in the background.
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
