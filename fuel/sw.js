// Offline cache so Fuel opens with no signal. Bump CACHE when files change (bump.sh in the repo root does both apps).
// This is the diet app's worker: scope /overload/fuel/, cache fuel-vN. The training app one folder up has its
// own worker (../sw.js, cache overload-vN), which deletes every other cache whose name starts "overload-":
// nothing of this app may ever be stored under such a name.
const CACHE = 'fuel-v1';
// One address per line: bump.sh reads this list to check that every file exists, and that every versioned
// file the page loads is in it, written exactly as index.html writes it. Addresses are relative to this file;
// the food list and the barcode reader are shared files one folder up (food.js asks for them there).
const ASSETS = [
  './',
  './index.html',
  './fuel.css?v=3.0',
  './backup.js?v=3.0',
  './fuel.js?v=3.0',
  './food.js?v=3.0',
  './sync.js?v=3.0',
  // The stylesheet and the icon set both apps share, one folder up. Every address in this list must be one
  // the server delivers: a single one that fails makes the whole install fail, and the phone then stays on
  // the version it has.
  '../shared/ui.css?v=3.0',
  '../shared/icons.js?v=3.0',
  '../data/foods.json?db=5',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-512.png',
  // Barcode reader (zxing-wasm, Apache-2.0), loaded on first scan: ~1 MB. ../vendor/zxing/README.md
  '../vendor/zxing/reader/index.js',
  '../vendor/zxing/share.js',
  '../vendor/zxing/zxing_reader.wasm'
];
// The Firebase files sync.js imports (the same addresses, the same version as the training app's). They are
// not in the list above: cloud sync is optional, and a slow or blocked gstatic must never keep the app from
// installing. They are stored once this worker is active (see activate) and whenever a page loads them.
const SDK = [
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
];

// Always go to the server for our own files. GitHub Pages sends a 10 minute
// max-age, and going through the HTTP cache would hand back stale copies.
const fresh = (req) => new Request(req, { cache: 'no-cache' });

// The release this cache is for: the ?v= its files carry (bump.sh changes them all at once).
// The app's page is stored only when it asks for this release's files, so a stored page
// never asks for files that are not stored.
const RELEASE = (ASSETS.find((a) => a.includes('?v=')) || '').split('?v=')[1] || '';
const pageFits = (html) => !RELEASE || (String(html).match(/\?v=[^"'&\s>]+/g) || []).includes('?v=' + RELEASE);
// The main script says which release it is (one line  const VERSION = '3.0',  set by bump.sh). A copy of it that
// names another release than the ?v= of its address is never stored or run: a server can still hand out the old
// file for a while after a release, and the server ignores ?v=, so it hands out the next release's file under
// this release's address once that is published.
const MARKS = { 'fuel.js': "const VERSION = '" };
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

// The Firebase files, so cloud sync also loads on a start with no signal. First the copies a previous
// release of this app stored (no network needed), then whatever is still missing from the network.
// Neither may fail or hold up anything: without these files the app runs on this phone's data, and they are
// stored the next time a page loads them (see fetch).
function keepSdk(oldCaches) {
  return caches.open(CACHE).then((c) => Promise.all(SDK.map((url) => c.match(url).then((hit) => {
    if (hit) return null;
    return Promise.all(oldCaches.map((k) => caches.open(k).then((o) => o.match(url)))).then((found) => {
      const copy = found.filter(Boolean)[0];
      return copy ? c.put(url, copy) : null;
    });
  })))).catch(() => {});
}
function warmSdk() {
  return caches.open(CACHE).then((c) => Promise.all(SDK.map((url) => c.match(url).then((hit) => {
    if (hit) return null;
    return fetch(url).then((res) => (res.ok ? c.put(url, res) : null));
  }).catch(() => {})))).catch(() => {});
}

// Only this app's old caches are deleted: names starting "fuel-". The training app's (overload-…) and other
// sites' on this origin are not this worker's.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => keys.filter((k) => k.startsWith('fuel-') && k !== CACHE))
      .then((old) => keepSdk(old).then(() => Promise.all(old.map((k) => caches.delete(k)))))
      .then(() => self.clients.claim())
      // Started, not waited for: activation (and with it every request of the app's page) must not hang on gstatic.
      .then(() => { warmSdk(); })
  );
});

// A file of one release (same site, its address carries ?v=): the copy this worker stored is the answer, and the
// network is asked only when there is none (then the answer is stored as below). The server ignores ?v=, so
// once the next release is published it answers this release's addresses with the next release's files; asking
// it first would store those under this release's names and run them in this release's page.
// Everything else (the pages, files without ?v= such as the barcode reader, the food list under its ?db=, the
// Firebase SDK scripts): network first so updates show up; fall back to cache when offline.
// A weak signal is worse than none: the request hangs.
// If the network has not answered in NET_WAIT ms and a cached copy exists,
// use the cached copy (the network reply still refreshes the cache).
// An error page (site down or switched off) also gets the cached copy.
// The app's own page is refreshed this way only with a page of this cache's
// release (pageFits): a newer release's page asks for files that are not stored
// yet, so it waits for that release's install. A main script that names another
// release than its address is neither run nor stored (see fromNetwork).
// Only files of this site and the Firebase SDK scripts are cached; API traffic
// (Open Food Facts lookups, Firestore) is not.
// A worker handles every request of the pages it controls, whatever folder the address is in: the shared
// files one folder up come through here too. Stored copies are looked for in this app's own cache only
// (caches.match would search every cache of the site, the training app's included).
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
  const v = sameOrigin && !isPage ? url.searchParams.get('v') : null;
  const file = sameOrigin && url.pathname.startsWith(scope) ? url.pathname.slice(scope.length) : '';
  // './index.html' is this app's page: an address in a worker is relative to the worker's own file.
  const cached = () => caches.open(CACHE).then((c) => c.match(e.request).then((hit) => hit || (isPage ? c.match('./index.html') : undefined)));
  const fromNetwork = () => {
    let stored;
    // A main script that names another release than its address is answered like an error page: the page never
    // runs it (the start-up rescue takes over), and it is not stored.
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
  e.respondWith(caches.open(CACHE).then((c) => c.match(e.request)).then((hit) => hit || fromNetwork(), () => fromNetwork()));
});
// No push handlers here: reminders belong to the training app's worker.
