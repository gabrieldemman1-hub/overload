// Offline cache so the app opens with no signal. Every change to this file, and to any file it stores, needs a new
// release: sh bump.sh <next release> moves CACHE on (both apps). A changed worker under the same CACHE would install
// into the cache the running one serves from; sh bump.sh --check fails on that.
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
// Written last by an install that stored every file, and only then: its text is the release. A cache without it is
// one whose install did not finish (cut off in the background, or failing), and nothing may come from it. The
// start-up rescue in index.html reads it too. Caches made before 3.0 (overload-v23, 2.8's, and older) never have it.
const DONE = './installed';
const BEFORE_DONE = 23;   // the last cache number made before installs wrote DONE (2.8's overload-v23)

// Always go to the server for our own files. GitHub Pages sends a 10 minute
// max-age, and going through the HTTP cache would hand back stale copies.
const fresh = (req) => new Request(req, { cache: 'no-cache' });

// The release this cache is for: the ?v= its files carry (bump.sh changes them all at once).
// The app's page is stored only when it asks for this release's files, so a stored page
// never asks for files that are not stored.
const RELEASE = (ASSETS.find((a) => a.includes('?v=')) || '').split('?v=')[1] || '';
const stampsOf = (html) => (String(html).match(/\?v=[^"'&\s>]+/g) || []).map((s) => s.slice(3));
const pageFits = (html) => !RELEASE || stampsOf(html).includes(RELEASE);
// Releases compare as two whole numbers, the way the start-up rescue compares them (3.10 comes after 3.9).
const parts = (v) => { const p = String(v).split('.'); return [parseInt(p[0], 10), parseInt(p[1] || '0', 10)]; };
const newer = (a, b) => { const x = parts(a), y = parts(b); return x[0] > y[0] || (x[0] === y[0] && x[1] > y[1]); };
// A page of a release this worker does not have yet: every ?v= it asks for is newer than RELEASE.
const pageIsNewer = (html) => { const s = stampsOf(html); return s.length > 0 && s.every((v) => newer(v, RELEASE)); };
// Every file with ?v= says which release it is, and bump.sh sets it: the main script in one line
// const VERSION = '3.0',  the sync module in  release: '3.0',  every other script and stylesheet in its first line
// /* release 3.0 ... */.  A copy that does not name the release of its address exactly once is never stored or run:
// a server can still hand out the old file for a while after a release, and the server ignores ?v=, so it hands
// out the next release's file under this release's address once that is published.
const MARKS = { 'overload.js': "const VERSION = '", 'sync.js': "release: '" };
const MARK = '/* release ';
// The releases a copy names ([] when it names none): file is its path below this worker's folder.
const releasesIn = (file, text) => String(text).split(MARKS[file] || MARK).slice(1).map((p) => p.split(/['\s*]/)[0]);
const fromRelease = (file, v, text) => { const r = releasesIn(file, text); return r.length === 1 && r[0] === v; };

// All or nothing: if any file fails to download, the install fails and the
// version already on the phone keeps running (and keeps its cache). The next
// update check tries again. A half-filled cache would break the app offline.
// The same goes for a page or a file left over from the previous release (a server can still hand it out for a few
// minutes after a release): what the install stores is kept for the whole release (see fetch), so it must be right.
// First, the caches of this app that an earlier install did not finish are deleted (never this worker's own CACHE,
// never one made before 3.0: the running worker may be 2.8's). Then every file is downloaded and checked, and only
// then stored (see fetched). An install that fails while storing (storage full, or the worker stopped) deletes
// CACHE only when it made it: a CACHE that was already there may be the one the running worker serves from.
const unfinished = (k) => {
  const n = /^overload-v(\d+)$/.exec(k);
  if (!n || k === CACHE || Number(n[1]) <= BEFORE_DONE) return Promise.resolve(false);
  return caches.open(k).then((c) => c.match(DONE)).then((hit) => !hit);
};
// One file of the install list, downloaded whole and checked, as [address, response]. Nothing is stored before every
// file has arrived and passed, so an install that fails on the way changes no cache, not even one that was there.
const fetched = (a) => fetch(new Request(a, { cache: 'reload' })).then((res) => {
  if (!res.ok) throw new Error(a + ' ' + res.status);
  const page = a === './' || a === './index.html', file = a.replace(/^\.\//, '').split('?')[0];
  const v = a.includes('?v=') ? a.split('?v=')[1] : null;
  return res.blob().then((body) => {
    const check = !page && v == null ? Promise.resolve() : body.text().then((text) => {
      if (page ? !pageFits(text) : !fromRelease(file, v, text)) throw new Error(a + ' is not from this release');
    });
    return check.then(() => [a, new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })]);
  });
});
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => unfinished(k).then((yes) => yes && caches.delete(k)))))
      .then(() => caches.has(CACHE))
      .then((had) => Promise.all(ASSETS.map(fetched))
        .then((got) => caches.open(CACHE).then((c) => Promise.all(got.map(([a, res]) => c.put(a, res)))
          .then(() => c.put(DONE, new Response(RELEASE, { headers: { 'Content-Type': 'text/plain' } })))))
        .then(() => self.skipWaiting(), (err) => (had ? Promise.reject(err) : caches.delete(CACHE).then(() => { throw err; }))))
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
// The app's own page is refreshed this way only with a page of this cache's release (pageFits). A newer release's
// page is shown but not stored: it asks for files that are not stored yet, so it waits for that release's install.
// Any other page from the network (an older release's, from a server that has not caught up yet) is answered with
// this release's stored page. A file with ?v= from the network that does not name the release of its address is
// neither run nor stored (see fromNetwork).
// Stored copies are looked for in this worker's own cache only: another cache of the site may be one whose install
// did not finish, or the diet app's (fuel-…), which holds the shared files under the same addresses.
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
  const cached = () => caches.open(CACHE).then((c) => c.match(e.request).then((hit) => hit || (isPage ? c.match('./index.html') : undefined)));
  const fromNetwork = () => {
    let stored;
    const keep = (res) => {
      const copy = res.clone();
      stored = caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    };
    const net = fetch(sameOrigin ? fresh(e.request) : e.request).then((res) => {
      if (!res.ok) return res;
      // A file of one release that names another (or none) is answered like an error page: the page never runs
      // it (without its main script the start-up rescue takes over), and it is not stored.
      if (v != null) return res.clone().text().then((text) => (fromRelease(file, v, text) ? keep(res) : new Response('', { status: 409, statusText: 'Another release' })));
      if (!appPage) return keep(res);
      return res.clone().text().then((html) => {
        if (pageFits(html)) return keep(res);
        if (pageIsNewer(html)) return res;
        return cached().then((hit) => hit || res);
      });
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
