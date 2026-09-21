// Offline cache so the app opens with no signal. Bump CACHE when files change.
const CACHE = 'overload-v9';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=1.4',
  './app.js?v=1.4',
  './sync.js?v=1.4',
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
// Only our own files and the Firebase SDK scripts are cached; API traffic is not.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const cacheable = sameOrigin || url.hostname === 'www.gstatic.com';
  const isPage = e.request.mode === 'navigate';
  e.respondWith(
    fetch(sameOrigin ? fresh(e.request) : e.request)
      .then((res) => {
        if (cacheable && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || (isPage ? caches.match('./index.html') : Response.error())))
  );
});
