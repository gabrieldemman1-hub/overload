// Offline cache so the app opens with no signal. Bump CACHE when files change.
const CACHE = 'overload-v18';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=2.3',
  './programs.js?v=2.3',
  './app.js?v=2.3',
  './sync.js?v=2.3',
  './food.js?v=2.3',
  './connector.js?v=2.3',
  './data/foods.json?db=4',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-512.png'
];

// Always go to the server for our own files. GitHub Pages sends a 10 minute
// max-age, and going through the HTTP cache would hand back stale copies.
const fresh = (req) => new Request(req, { cache: 'no-cache' });

// All or nothing: if any file fails to download, the install fails and the
// version already on the phone keeps running (and keeps its cache). The next
// update check tries again. A half-filled cache would break the app offline.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((a) => fetch(new Request(a, { cache: 'reload' })).then((res) => {
        if (!res.ok) throw new Error(a + ' ' + res.status);
        return c.put(a, res);
      }))))
      .then(() => self.skipWaiting(), (err) => caches.delete(CACHE).then(() => { throw err; }))
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
// Gym wifi and one bar of signal are worse than offline: the request hangs.
// If the network has not answered in NET_WAIT ms and a cached copy exists,
// use the cached copy (the network reply still refreshes the cache).
// Only our own files and the Firebase SDK scripts are cached; API traffic
// (Open Food Facts lookups) is not.
const NET_WAIT = 3000;
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const cacheable = sameOrigin || url.hostname === 'www.gstatic.com';
  if (!cacheable) return;
  const isPage = e.request.mode === 'navigate';
  const cached = () => caches.match(e.request).then((hit) => hit || (isPage ? caches.match('./index.html') : undefined));
  const net = fetch(sameOrigin ? fresh(e.request) : e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); }
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  e.respondWith(new Promise((resolve) => {
    let settled = false;
    const done = (res) => { if (!settled && res) { settled = true; resolve(res); } };
    const fallback = () => cached().then((hit) => { if (hit) done(hit); return hit; });
    const t = setTimeout(fallback, NET_WAIT);
    net.then((res) => { clearTimeout(t); done(res); }, () => {
      clearTimeout(t);
      fallback().then((hit) => { if (!hit) done(Response.error()); });
    });
  }));
});

// Reminders from the connector (connector/worker.js): show them, and open the app on tap.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Overload', {
    body: d.body || '', tag: d.tag || 'overload', icon: './icon-180.png', badge: './icon-180.png', data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(target);
  }));
});
