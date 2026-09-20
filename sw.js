// Offline cache so the app opens with no signal. Bump CACHE when files change.
const CACHE = 'overload-v8';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=1.3',
  './app.js?v=1.3',
  './sync.js?v=1.3',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-512.png'
];

// Always go to the server for our own files. GitHub Pages sends a 10 minute
// max-age, and going through the HTTP cache would hand back stale copies.
const fresh = (req) => new Request(req, { cache: 'no-cache' });

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((a) => fetch(new Request(a, { cache: 'reload' })).then((res) => { if (res.ok) return c.put(a, res); }).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first so updates show up; fall back to cache when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const sameOrigin = new URL(e.request.url).origin === self.location.origin;
  e.respondWith(
    fetch(sameOrigin ? fresh(e.request) : e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
