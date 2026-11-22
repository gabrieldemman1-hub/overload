// Offline cache so the app opens with no signal. Bump CACHE when files change (bump.sh does both apps).
// This is the training app's worker. The diet app in fuel/ has its own worker and its own cache (fuel-vN);
// the food list (data/) and the barcode reader (vendor/) are that app's files and are not stored here.
const CACHE = 'overload-v24';
// One address per line: bump.sh reads this list to check that every file exists.
const ASSETS = [
  './',
  './index.html',
  './programs.js?v=3.0',
  './backup.js?v=3.0',
  './overload.js?v=3.0',
  './sync.js?v=3.0',
  './connector.js?v=3.0',
  // The stylesheets and the icon set, written exactly as index.html writes them. Every address in this list must
  // be one the server can deliver: a single miss makes the whole install fail, and the phone then stays on
  // the version it has.
  './shared/ui.css?v=3.0',
  './train.css?v=3.0',
  './shared/icons.js?v=3.0',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-512.png'
];

// Always go to the server for our own files. GitHub Pages sends a 10 minute
// max-age, and going through the HTTP cache would hand back stale copies.
const fresh = (req) => new Request(req, { cache: 'no-cache' });

// The release this cache is for: the ?v= its files carry (bump.sh changes them all at once).
// The app's page is stored only when it asks for this release's files, so a stored page
// never asks for files that are not stored.
const RELEASE = (ASSETS.find((a) => a.includes('?v=')) || '').split('?v=')[1] || '';
const pageFits = (html) => !RELEASE || (String(html).match(/\?v=[^"'&\s>]+/g) || []).includes('?v=' + RELEASE);
// Two files say which release they are: the main script (one line  const VERSION = '3.0')  and the sync module
// (release: '3.0'). bump.sh sets both. A copy of one of them that names another release than the ?v= of its
// address is never stored or run: a server can still hand out the old file for a while after a release, and the
// server ignores ?v=, so it hands out the next release's file under this release's address once that is published.
const MARKS = { 'overload.js': "const VERSION = '", 'sync.js': "release: '" };
// The releases a copy of such a file names ([] when it names none): file is its path below this worker's folder.
const releasesIn = (file, text) => String(text).split(MARKS[file]).slice(1).map((p) => p.split("'")[0]);
const fromRelease = (file, v, text) => { const r = releasesIn(file, text); return r.length === 1 && r[0] === v; };

// All or nothing: if any file fails to download, the install fails and the
// version already on the phone keeps running (and keeps its cache). The next
// update check tries again. A half-filled cache would break the app offline.
// The same goes for a page or a main script left over from the previous release
// (a server can still hand it out for a few minutes after a release): what the
// install stores is kept for the whole release (see fetch), so it must be right.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((a) => fetch(new Request(a, { cache: 'reload' })).then((res) => {
        if (!res.ok) throw new Error(a + ' ' + res.status);
        const page = a === './' || a === './index.html', file = a.replace(/^\.\//, '').split('?')[0];
        if (!page && !MARKS[file]) return c.put(a, res);
        return res.clone().text().then((text) => {
          if (page ? !pageFits(text) : !fromRelease(file, RELEASE, text)) throw new Error(a + ' is not from this release');
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

// A file of one release (same site, its address carries ?v=): the copy this worker stored is the answer, and the
// network is asked only when there is none (then the answer is stored as below). The server ignores ?v=, so
// once the next release is published it answers this release's addresses with the next release's files; asking
// it first would store those under this release's names and run them in this release's page.
// Everything else (the pages, files without ?v=, the Firebase SDK scripts): network first so updates show up;
// fall back to cache when offline.
// Gym wifi and one bar of signal are worse than offline: the request hangs.
// If the network has not answered in NET_WAIT ms and a cached copy exists,
// use the cached copy (the network reply still refreshes the cache).
// An error page (site down or switched off) also gets the cached copy.
// The app's own page is refreshed this way only with a page of this cache's
// release (pageFits): a newer release's page asks for files that are not stored
// yet, so it waits for that release's install. A main script or sync module that
// names another release than its address is neither run nor stored (see fromNetwork).
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
  // The diet app (fuel/) has its own worker; the food list and the barcode reader are its files. Until that
  // worker has taken its pages over they are still this worker's to answer: leave them to the browser, as if
  // there were no worker. Otherwise a slow, missing or offline diet page would get the training page from the
  // cache, and everything a diet page loads would be stored in the training cache.
  if (sameOrigin && url.pathname.startsWith(scope) && /^(fuel|data|vendor)(\/|$)/.test(url.pathname.slice(scope.length))) return;
  const appPage = sameOrigin && (url.pathname === scope || url.pathname === scope + 'index.html');
  const v = sameOrigin && !isPage ? url.searchParams.get('v') : null;
  const file = sameOrigin && url.pathname.startsWith(scope) ? url.pathname.slice(scope.length) : '';
  const cached = () => caches.match(e.request).then((hit) => hit || (isPage ? caches.match('./index.html') : undefined));
  const fromNetwork = () => {
    let stored;
    // A main script or sync module that names another release than its address is answered like an error page:
    // the page never runs it (the start-up rescue takes over), and it is not stored.
    const other = (res) => res.clone().text().then((text) => { const r = releasesIn(file, text); return r.length && !(r.length === 1 && r[0] === v); });
    const net = fetch(sameOrigin ? fresh(e.request) : e.request)
      .then((res) => (res.ok && v && MARKS[file] ? other(res).then((no) => (no ? new Response('', { status: 409, statusText: 'Another release' }) : res)) : res))
      .then((res) => {
        if (res.ok) {
          const copy = res.clone(), page = appPage ? res.clone() : null;
          stored = (page ? page.text().then(pageFits) : Promise.resolve(true))
            .then((keep) => keep && caches.open(CACHE).then((c) => c.put(e.request, copy))).catch(() => {});
        }
        return res;
      });
    try { e.waitUntil(net.then(() => stored, () => {})); } catch (err) { /* the answer is already given: the copy may not be stored */ }
    return new Promise((resolve) => {
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
    });
  };
  if (v == null) { e.respondWith(fromNetwork()); return; }
  // Looked for in this worker's own cache only: the diet app's cache (fuel-…) holds the shared files under the same addresses.
  e.respondWith(caches.open(CACHE).then((c) => c.match(e.request)).then((hit) => hit || fromNetwork(), () => fromNetwork()));
});

// Reminders from the connector (connector/worker.js): show them, and open the app on tap.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Overload', {
    body: d.body || '', tag: d.tag || 'overload', icon: './icon-180.png', badge: './icon-180.png', data: { url: d.url || './' }
  }));
});
// A window of this app: inside the scope, but not the diet app's (fuel/ lies inside this worker's scope too,
// and a reminder must not bring that app to the front instead of opening this one).
const isAppWindow = (url) => url.startsWith(self.registration.scope) && !url.startsWith(self.registration.scope + 'fuel/');
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => isAppWindow(c.url));
    return open ? open.focus() : self.clients.openWindow(target);
  }));
});
