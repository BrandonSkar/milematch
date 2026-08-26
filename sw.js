/* Service worker.
 * Two jobs: make the app installable as a desktop app, and make it work
 * offline. Your balances live in localStorage, so an offline launch still
 * gives you the full points engine — only live fare lookups need the network.
 *
 * Serves network-first, so a change shows on the next load rather than the one
 * after it. Bump CACHE when you change any cached file anyway - it evicts the
 * old entries that would otherwise answer while offline.
 */
const CACHE = 'milematch-v36';

const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/engine.js',
  './js/flights.js',
  './js/balances.js',
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

/* The page asks the worker that is actually serving it what version it is.
 * "A newer version is ready" is a claim about staleness, and a claim has to be
 * checkable: latching a banner on an event leaves no way to notice the event
 * was wrong, or that the reload it asked for has already happened. */
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'VERSION') return;
  const reply = { version: CACHE };
  if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
  else if (event.source) event.source.postMessage(reply);
});

/* How long to wait for the network before falling back to the cache.
 *
 * A dead network rejects immediately; a dying one does not reject at all, and
 * without a ceiling the app would hang on it rather than showing the copy it
 * already has. */
const NET_TIMEOUT_MS = 3500;

function fromNetwork(req) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network too slow')), NET_TIMEOUT_MS);
    fetch(req, { cache: 'no-cache' }).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

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

  /* App shell: network first, cache as the fallback.
   *
   * This used to serve the cached copy and fetch a fresh one for NEXT time.
   * That is faster, and it meant every change took two reloads to appear — the
   * first handed you the old copy and quietly stored the new one, the second
   * finally showed it. Nobody reloads twice on purpose, so what people
   * actually saw was a site that had not changed.
   *
   * Offline is unaffected: the cache answers whenever the network cannot, and
   * the timeout means a merely dreadful connection falls back too instead of
   * hanging.
   */
  if (url.origin === location.origin) {
    event.respondWith(
      fromNetwork(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || new Response(
        'Offline, and this was never cached.',
        { status: 503, headers: { 'Content-Type': 'text/plain' } }
      )))
    );
  }
});
