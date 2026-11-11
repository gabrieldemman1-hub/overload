// Offline cache so the app opens with no signal. Bump CACHE when files change.
const CACHE = 'overload-v23';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=2.8',
  './programs.js?v=2.8',
  './backup.js?v=2.8',
  './app.js?v=2.8',
  './sync.js?v=2.8',
  './food.js?v=2.8',
  './connector.js?v=2.8',
  './data/foods.json?db=5',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-512.png',
  // Barcode reader (about 1 MB), so scanning works offline right after an update too.
  './vendor/zxing/reader/index.js',
  './vendor/zxing/share.js',
  './vendor/zxing/zxing_reader.wasm'
];

// Always go to the server for our own files. GitHub Pages sends a 10 minute
// max-age, and going through the HTTP cache would hand back stale copies.
const fresh = (req) => new Request(req, { cache: 'no-cache' });

// The release this cache is for: the ?v= its files carry (bump.sh changes them all at once).
// The app's page is stored only when it asks for this release's files, so a stored page
// never asks for files that are not stored.
const RELEASE = (ASSETS.find((a) => a.includes('?v=')) || '').split('?v=')[1] || '';
const pageFits = (html) => !RELEASE || (String(html).match(/\?v=[^"'&\s>]+/g) || []).includes('?v=' + RELEASE);

// All or nothing: if any file fails to download, the install fails and the
// version already on the phone keeps running (and keeps its cache). The next
// update check tries again. A half-filled cache would break the app offline.
// The same goes for a page left over from the previous release (a server can
// still hand it out for a few minutes after a release).
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((a) => fetch(new Request(a, { cache: 'reload' })).then((res) => {
        if (!res.ok) throw new Error(a + ' ' + res.status);
        if (a !== './' && a !== './index.html') return c.put(a, res);
        return res.clone().text().then((html) => {
          if (!pageFits(html)) throw new Error(a + ' is not from this release');
          return c.put(a, res);
        });
      }))))
      .then(() => self.skipWaiting(), (err) => caches.delete(CACHE).then(() => { throw err; }))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('overload-') && k !== CACHE).map((k) => caches.delete(k))))  // other sites share this origin
      .then(() => self.clients.claim())
  );
});

// Network first so updates show up; fall back to cache when offline.
// Gym wifi and one bar of signal are worse than offline: the request hangs.
// If the network has not answered in NET_WAIT ms and a cached copy exists,
// use the cached copy (the network reply still refreshes the cache).
// An error page (site down or switched off) also gets the cached copy.
// The app's own page is refreshed this way only with a page of this cache's
// release (pageFits): a newer release's page asks for files that are not stored
// yet, so it waits for that release's install.
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
  const scope = new URL(self.registration.scope).pathname;
  const appPage = sameOrigin && (url.pathname === scope || url.pathname === scope + 'index.html');
  const cached = () => caches.match(e.request).then((hit) => hit || (isPage ? caches.match('./index.html') : undefined));
  let stored;
  const net = fetch(sameOrigin ? fresh(e.request) : e.request).then((res) => {
    if (res.ok) {
      const copy = res.clone(), page = appPage ? res.clone() : null;
      stored = (page ? page.text().then(pageFits) : Promise.resolve(true))
        .then((keep) => keep && caches.open(CACHE).then((c) => c.put(e.request, copy))).catch(() => {});
    }
    return res;
  });
  e.waitUntil(net.then(() => stored, () => {}));
  e.respondWith(new Promise((resolve) => {
    let settled = false;
    const done = (res) => { if (!settled && res) { settled = true; resolve(res); } };
    const fallback = () => cached().then((hit) => { if (hit) done(hit); return hit; });
    const t = setTimeout(fallback, NET_WAIT);
    net.then((res) => {
      clearTimeout(t);
      if (res.ok || res.type === 'opaqueredirect' || res.type === 'opaque') { done(res); return; }
      fallback().then((hit) => { if (!hit) done(res); });   // an error page: only when nothing is stored
    }, () => {
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
