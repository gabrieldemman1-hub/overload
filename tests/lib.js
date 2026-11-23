/* Test helper for Overload (and the apps split from it). CommonJS, no dependencies but Playwright.
 *
 *   const lib = require('./lib');
 *   const server = await lib.startServer(lib.REPO, 8310);          // python3 -m http.server on 127.0.0.1
 *   const browser = await lib.launch();                             // chromium, no options
 *   const fx = lib.loadFixture('v28-state');                        // { state, meta, text }
 *   const phone = await lib.newPhone(browser, { colorScheme: 'dark', now: fx.meta.now, timezoneId: fx.meta.tz });
 *   await lib.seedV28(phone.context, fx);                           // localStorage, before the app's scripts run
 *   const page = await lib.openApp(phone.context, server.url + '/index.html');
 *   await lib.openTab(page, 'history');
 *   const state = await lib.readStorage(page, 'overload.state.v1');
 *   await lib.shot(page, '/tmp/history.png');
 *   phone.assertClean();                                            // throws on any page error or console error
 *   await phone.close(); await browser.close(); await server.stop();
 *
 * Rules built in: every request that is not to http://127.0.0.1 is aborted (and listed in phone.blocked),
 * also requests made by a service worker; service workers are blocked unless asked for.
 *
 * Sealed mode, for tests of what a service worker stores and answers:
 *   const browser = await lib.launch({ sealed: true });             // no host but 127.0.0.1 can be reached at all
 *   const phone = await lib.newPhone(browser, { sealed: true, serviceWorkers: 'allow' });   // no routing
 *   const workers = await lib.watchWorkers(phone.context, (scriptUrl) => textTheServerHandsOutNow);
 *   ... workers.installedTwice()                                    // [] on a real phone
 * Playwright's routing (context.route) makes Chromium install the same worker again at every update check,
 * downloading every file again, which hides what a phone keeps for a release. A sealed phone has no routing;
 * a sealed browser stops every other host itself: host names other than 127.0.0.1 do not resolve, and every
 * request that is not to 127.0.0.1 goes to a proxy in this process that refuses it (browser.outside lists the
 * hosts asked for). A sealed browser can also hold ordinary routed phones (those that need tests/fake-firebase).
 *
 * One context is one "installed app": on an iPhone every Home Screen app has its own storage, so a test of
 * two apps that must not see each other's localStorage uses two contexts (two newPhone calls).
 */
'use strict';

// Requests made by a service worker go through context.route too (the default in this Playwright; the
// variable makes older ones do the same). Must be set before Playwright is loaded.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const REPO = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const LOCAL = 'http://127.0.0.1';
const STATE_KEY = 'overload.state.v1';
const SEED_MARK = '__tests.seeded';   // set by seedStorage in the page's localStorage; readStorage hides it
// The fixtures are built and replayed in this time zone. Their "now" is early evening there, which is
// already the next day in UTC: code that takes "today" from toISOString() shows the wrong day and fails.
const DEFAULT_TZ = 'America/Los_Angeles';
const PHONE = { width: 390, height: 844 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Static server
// ---------------------------------------------------------------------------
function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.setTimeout(1000, () => { req.destroy(); resolve(0); });
  });
}
/** Serves `dir` on 127.0.0.1:`port`. Resolves once it answers. { port, url, dir, stop() } */
async function startServer(dir, port) {
  if (!fs.existsSync(dir)) throw new Error('startServer: no such folder ' + dir);
  if (await ping(LOCAL + ':' + port + '/')) throw new Error('startServer: port ' + port + ' is already in use');
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', dir], { stdio: ['ignore', 'ignore', 'pipe'] });
  let exited = false, errText = '';
  proc.stderr.on('data', (b) => { if (errText.length < 2000) errText += b; });   // http.server logs every request to stderr
  proc.on('exit', () => { exited = true; });
  const url = LOCAL + ':' + port;
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error('startServer: python3 -m http.server stopped at once (port ' + port + '): ' + errText.trim());
    if (await ping(url + '/')) break;
    if (i === 99) { proc.kill(); throw new Error('startServer: no answer on ' + url); }
    await sleep(100);
  }
  const stop = () => new Promise((resolve) => { if (exited) return resolve(); proc.once('exit', () => resolve()); proc.kill(); });
  process.once('exit', () => { try { proc.kill(); } catch (e) { /* gone */ } });   // never leave a server behind
  return { port, url, dir, stop };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' };
const SITE_BASE = '/overload/';
/**
 * A server for tests with real service workers: serves site.root under /overload/ on 127.0.0.1:`port` the way
 * GitHub Pages does (by path: the query is ignored; every answer has max-age 600). Resolves once it listens.
 *   site.root          the folder served; set another one to publish another release
 *   site.rules         [{ test(rel, url), root, status, body, delay, drop }] for single addresses. rel is the path below
 *                      /overload/ (a folder address as …index.html). root: served from another folder (a stale
 *                      server edge); status: that status; body: that text; delay: ms before answering; drop: the
 *                      connection is closed without an answer. The first rule whose test is true applies.
 *   site.down          true: every connection is dropped (no signal); site.cut() also closes the open ones
 *   site.log           every address asked for (path and query)
 *   site.at(rel)       the full address of a path below /overload/
 *   site.served(url)   the text the server hands out now under an address (for lib.watchWorkers)
 *   site.stop()
 */
function startSite(port) {
  const site = { root: null, down: false, rules: [], log: [], url: LOCAL + ':' + port };
  const sockets = new Set();
  const relOf = (u) => { let rel = decodeURIComponent(u.pathname.slice(SITE_BASE.length)); if (rel === '' || rel.endsWith('/')) rel += 'index.html'; return rel; };
  const fileOf = (root, rel) => { const f = path.join(root, rel); try { return f.startsWith(root + path.sep) && fs.statSync(f).isFile() ? f : null; } catch (e) { return null; } };
  const server = http.createServer((req, res) => {
    if (site.down) { req.socket.destroy(); return; }
    const u = new URL(req.url, site.url);
    site.log.push(u.pathname + u.search);
    const send = (status, type, body) => { if (site.down) { req.socket.destroy(); return; } res.writeHead(status, { 'content-type': type, 'cache-control': 'max-age=600' }); res.end(body); };
    if (!u.pathname.startsWith(SITE_BASE)) { send(404, 'text/plain', 'outside the site'); return; }
    const rel = relOf(u);
    const rule = site.rules.find((r) => r.test(rel, u));
    const answer = () => {
      if (site.down || (rule && rule.drop)) { req.socket.destroy(); return; }
      if (rule && rule.status) { send(rule.status, 'text/plain', 'test server: ' + rule.status); return; }
      if (rule && rule.body != null) { send(200, TYPES[path.extname(rel)] || 'text/plain', rule.body); return; }
      const file = fileOf((rule && rule.root) || site.root, rel);
      if (!file) { send(404, TYPES['.html'], '<!doctype html><title>404</title><p id="server-404">The server has no such page.</p>'); return; }
      send(200, TYPES[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
    };
    if (rule && rule.delay) setTimeout(answer, rule.delay); else answer();
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  site.at = (rel) => site.url + SITE_BASE + rel;
  site.cut = () => { site.down = true; sockets.forEach((s) => s.destroy()); };
  site.served = (address) => {
    const u = new URL(address), rel = relOf(u);
    const rule = site.rules.find((r) => r.test(rel, u));
    if (rule && rule.body != null) return String(rule.body);
    const file = fileOf((rule && rule.root) || site.root, rel);
    return file ? fs.readFileSync(file, 'utf8') : null;
  };
  site.stop = () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  return new Promise((resolve, reject) => {
    server.once('error', (e) => reject(new Error('startSite: port ' + port + ' cannot be used: ' + e.message)));
    server.listen(port, '127.0.0.1', () => resolve(site));
  });
}
// Releases made in throw-away copies of a tree (the repo itself is never bumped). Removed when the process ends.
const releaseTemp = [];
process.on('exit', () => releaseTemp.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* leave it */ } }));
const TREE_SKIP = new Set(['.git', '.github', 'tests', 'dev', 'node_modules', 'tools', 'connector', 'lab']);
/** A temporary copy of what the site serves from a tree (no .git, tests, dev, tools, connector, lab). */
function copyTree(from) {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'overload-tree-')); releaseTemp.push(dir);
  fs.cpSync(from, dir, { recursive: true, filter: (src) => { const rel = path.relative(from, src); return !rel || !TREE_SKIP.has(rel.split(path.sep)[0]); } });
  return dir;
}
/** The versioned files the pages of a tree load (index.html and fuel/index.html), as paths from the tree's root. */
function versionedFiles(dir) {
  const out = new Set();
  for (const p of ['index.html', 'fuel/index.html']) {
    const f = path.join(dir, p);
    if (!fs.existsSync(f)) continue;
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:src|href)="([^"?]+)\?v=/g)) out.add(path.posix.normalize(path.posix.join(path.posix.dirname(p), m[1])));
  }
  return [...out];
}
/** The name a release marker of a file goes by: --rel-<markKey(path)> in CSS, window.__rel[path] in JS. */
const markKey = (rel) => rel.replace(/[^a-z0-9]/gi, '-');
/**
 * Adds a marker to the end of every versioned file of a tree, so a page can tell which release's copy ran: a script
 * sets window.__rel[path] = v, a stylesheet sets --rel-<markKey(path)>: "v" on :root. Returns dir.
 */
function markRelease(dir, v) {
  for (const rel of versionedFiles(dir)) {
    const f = path.join(dir, rel);
    if (/\.js$/.test(rel)) fs.appendFileSync(f, '\n;(window.__rel = window.__rel || {})[' + JSON.stringify(rel) + '] = ' + JSON.stringify(v) + ';\n');
    else fs.appendFileSync(f, '\n:root { --rel-' + markKey(rel) + ': "' + v + '"; }\n');
  }
  return dir;
}
/** A copy of `from` made into release v with sh bump.sh, the way releases are made. */
function nextRelease(from, v) {
  const dir = copyTree(from);
  try { require('child_process').execSync('sh bump.sh ' + v, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { throw new Error('bump.sh ' + v + ' failed in a copy: ' + String(e.stderr || e.message).trim()); }
  return dir;
}
/** What a worker file of a tree says about itself: { cache, assets }. sub: '' (sw.js) or 'fuel/'. */
function workerOf(dir, sub) {
  const text = fs.readFileSync(path.join(dir, (sub || '') + 'sw.js'), 'utf8');
  const block = (/const ASSETS = \[([\s\S]*?)\n\];/.exec(text) || [])[1] || '';
  return { cache: (/const CACHE = '([^']+)'/.exec(text) || [])[1], assets: block.split('\n').map((l) => /^\s*'([^']+)'/.exec(l)).filter(Boolean).map((m) => m[1]) };
}
/** Asks fn again until it gives something true (a page that is reloading throws: that counts as "not yet"); null after ms. */
async function until(fn, ms, every) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(every || 150);
  }
}
/** Cache Storage as a page of the site sees it: { cache name: [addresses] }. */
const cachesOf = (page) => page.evaluate(async () => { const out = {}; for (const k of await self.caches.keys()) out[k] = (await (await self.caches.open(k)).keys()).map((r) => r.url); return out; });
/** The text of one entry of one cache, or null. */
const cacheText = (page, cache, url) => page.evaluate(async ([c, u]) => { if (!(await caches.has(c))) return null; const r = await (await caches.open(c)).match(u); return r ? r.text() : null; }, [cache, url]);

// ---------------------------------------------------------------------------
// Browser and phone-like context
// ---------------------------------------------------------------------------
/**
 * Chromium. launch() relies on each phone's routing to keep requests on 127.0.0.1. launch({ sealed: true }) stops
 * every other host in the browser itself (see the top of this file), so phones may go without routing.
 */
async function launch(opts) {
  if (!(opts && opts.sealed)) return chromium.launch();
  // The proxy every request that is not to 127.0.0.1 is sent to: it notes the host and closes the connection.
  // It listens on a port the system picks (on 127.0.0.1 only), so it can never take a test's own port.
  const outside = [];
  const proxy = net.createServer((sock) => {
    sock.on('error', () => {});
    sock.once('data', (b) => { const m = /^(?:CONNECT ([^\s:]+)|[A-Z]+ [a-z]+:\/\/([^/:\s]+))/.exec(String(b)); if (m) outside.push(m[1] || m[2]); sock.destroy(); });
    setTimeout(() => sock.destroy(), 2000).unref();
  });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  proxy.unref();
  let browser;
  try {
    browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', '--proxy-server=http://127.0.0.1:' + proxy.address().port] });
  } catch (e) { proxy.close(); throw e; }
  browser.sealed = true;
  browser.outside = outside;
  const close = browser.close.bind(browser);
  browser.close = async (...a) => { try { await close(...a); } finally { proxy.close(); } };
  return browser;
}

/**
 * A context shaped like the owner's iPhone: 390x844, deviceScaleFactor 2, touch, mobile.
 * opts:
 *   colorScheme      'dark' (default) | 'light' | 'no-preference'   what the phone is set to (the app's own
 *                    theme setting, state.settings.theme, wins when it is not 'system')
 *   serviceWorkers   'block' (default) | 'allow'
 *   timezoneId       default America/Los_Angeles (DEFAULT_TZ)
 *   locale           default en-US
 *   now              a time (ms, Date or ISO text) the page's clock starts at and runs on from, timers included.
 *                    Give a fixture's meta.now so its "today" is today whenever the test runs. Omit for the real clock.
 *   allow            extra URL prefixes that may be fetched (default none: only http://127.0.0.1)
 *   sealed           true: no routing at all (needs a browser from launch({ sealed: true }), which stops other
 *                    hosts itself); requests to other hosts fail in the browser and are listed in `blocked`.
 *                    For tests of what a service worker keeps: see the top of this file. `allow` is not used.
 * Returns { context, pageErrors, consoleErrors, blocked, badResponses, problems(), assertClean(), reset(), close() }.
 *   pageErrors     uncaught exceptions and unhandled rejections in any page of the context
 *   consoleErrors  console.error output, and the browser's own error lines (a 404, a refused script)
 *   blocked        requests to other hosts that were aborted here (or, sealed, failed in the browser); their
 *                  "Failed to load resource" console lines are not counted as console errors
 *   badResponses   answers with status 400 or more from the local server
 */
async function newPhone(browser, opts) {
  opts = opts || {};
  if (opts.sealed && !browser.sealed) throw new Error('newPhone: a sealed phone needs a browser from launch({ sealed: true })');
  const context = await browser.newContext({
    viewport: PHONE, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
    colorScheme: opts.colorScheme || 'dark',
    serviceWorkers: opts.serviceWorkers === 'allow' ? 'allow' : 'block',
    timezoneId: opts.timezoneId || DEFAULT_TZ,
    locale: opts.locale || 'en-US'
  });
  const allow = [LOCAL + ':', LOCAL + '/'].concat(opts.sealed ? [] : opts.allow || []);
  const phone = { context, sealed: !!opts.sealed, pageErrors: [], consoleErrors: [], blocked: [], badResponses: [] };
  const isLocal = (u) => allow.some((p) => u.startsWith(p)) || /^(data|blob|about):/.test(u);
  if (opts.sealed) {
    context.on('request', (r) => { const u = r.url(); if (!isLocal(u)) phone.blocked.push(u); });
  } else {
    await context.route('**/*', (route) => {
      const u = route.request().url();
      if (isLocal(u)) return route.continue();
      phone.blocked.push(u);
      return route.abort();
    });
  }
  context.on('weberror', (e) => { const err = e.error(); phone.pageErrors.push(String((err && (err.stack || err.message)) || err)); });
  context.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location() || {}, text = m.text();
    // The browser's line for a request this helper aborted: expected, kept in `blocked` only.
    if (/Failed to load resource/.test(text) && loc.url && !isLocal(loc.url)) return;
    phone.consoleErrors.push(text + (loc.url ? ' (' + loc.url + (loc.lineNumber ? ':' + loc.lineNumber : '') + ')' : ''));
  });
  context.on('response', (res) => { if (res.status() >= 400 && isLocal(res.url())) phone.badResponses.push(res.status() + ' ' + res.url()); });
  if (opts.now != null) await context.clock.install({ time: new Date(opts.now) });
  phone.problems = () => phone.pageErrors.map((t) => 'page error: ' + t).concat(phone.consoleErrors.map((t) => 'console error: ' + t));
  phone.assertClean = (label) => {
    const p = phone.problems();
    if (p.length) throw new Error((label ? label + ': ' : '') + p.length + ' error(s)\n  ' + p.join('\n  '));
  };
  phone.reset = () => { phone.pageErrors.length = 0; phone.consoleErrors.length = 0; phone.blocked.length = 0; phone.badResponses.length = 0; };
  phone.close = () => context.close();
  return phone;
}

/**
 * Watches the service worker versions Chromium makes in a context, over CDP (from a blank page of its own that
 * stays open). Call it on a new phone, before its first page, so every version is seen from the start.
 * served(scriptUrl) gives the text the server hands out now under that address: it is noted when a version first
 * appears (right after the update check fetched it). A real phone installs a worker file only when its bytes
 * changed, so the same text installed twice for one address is the routing artifact described at the top, or a
 * worker that reinstalls itself.
 * Returns { versions: { id: { script, text, statuses } }, count(), installed(), installedTwice(), cdp, page }.
 *   installed()       the versions whose install finished (installed, activating or activated)
 *   installedTwice()  [{ script, times }] for every address whose same text finished installing more than once
 */
async function watchWorkers(context, served) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  const versions = {};
  cdp.on('ServiceWorker.workerVersionUpdated', (e) => e.versions.forEach((v) => {
    let o = versions[v.versionId];
    if (!o) {
      let text = null;
      try { text = served ? served(v.scriptURL) : null; } catch (err) { text = null; }
      o = versions[v.versionId] = { id: v.versionId, script: v.scriptURL, text, statuses: [] };
    }
    if (!o.statuses.includes(v.status)) o.statuses.push(v.status);
  }));
  const finished = (o) => o.statuses.some((s) => s === 'installed' || s === 'activating' || s === 'activated');
  const w = { versions, cdp, page };
  w.count = () => Object.keys(versions).length;
  w.installed = () => Object.values(versions).filter(finished);
  w.installedTwice = () => {
    const by = {};
    w.installed().forEach((o) => { const k = o.script + '\n' + o.text; by[k] = by[k] || { script: o.script, times: 0 }; by[k].times++; });
    return Object.values(by).filter((x) => x.times > 1);
  };
  return w;
}

/**
 * A new page that starts the way a Home Screen app starts after it was closed: in a new process, with nothing
 * in the browser's memory cache. Its own requests skip the browser's caches (CDP Network.setCacheDisabled), so
 * each one reaches the service worker, or the server when there is none. (Without routing, a reload or a second
 * page can otherwise take a script or a stylesheet from memory, and the worker never sees the request.)
 */
async function coldPage(context) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  return page;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
/**
 * Puts values into localStorage before any script of the page runs (context.addInitScript).
 * `map` is { key: value }: text is stored as it is, anything else as JSON. A value of null removes the key.
 * By default this happens once per context (a marker key, SEED_MARK, is left in localStorage), so a reload
 * or a second page shows what the app saved, not the fixture again. { always: true } seeds on every load.
 * Call it before the first page is opened. Seeding is per origin: every origin a page of this context opens
 * gets the same keys, once.
 */
async function seedStorage(context, map, opts) {
  const entries = Object.keys(map).map((k) => [k, map[k] == null ? null : typeof map[k] === 'string' ? map[k] : JSON.stringify(map[k])]);
  const always = !!(opts && opts.always);
  await context.addInitScript(({ entries, always, mark }) => {
    try {
      if (window.top !== window) return;                       // not in frames
      if (!always && localStorage.getItem(mark)) return;
      entries.forEach(([k, v]) => { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
      if (!always) localStorage.setItem(mark, '1');
    } catch (e) { /* about:blank and the like have no storage */ }
  }, { entries, always, mark: SEED_MARK });
}

/**
 * Seeds a v2.8 phone: the state under overload.state.v1, plus the two small keys v2.8 keeps beside it
 * (overload.theme, which index.html reads before first paint, and overload.backup = { since, lastExport }).
 * `fx` is what loadFixture returns, or a state object. opts.backup: false leaves overload.backup out,
 * an object replaces it. opts.theme: 'light' | 'dark' | 'system' changes settings.theme in the seeded copy
 * (the main fixtures force dark). opts.extra: more keys. opts.always: see seedStorage.
 */
async function seedV28(context, fx, opts) {
  opts = opts || {};
  let state = fx && fx.state ? fx.state : fx;
  const meta = (fx && fx.meta) || {};
  const map = {};
  map[STATE_KEY] = fx && fx.text ? fx.text : state;
  if (opts.theme) { state = JSON.parse(JSON.stringify(state)); state.settings.theme = opts.theme; map[STATE_KEY] = state; }
  map['overload.theme'] = (state.settings && state.settings.theme) || 'system';
  if (opts.backup !== false) map['overload.backup'] = opts.backup || meta.backup || { since: Date.now(), lastExport: Date.now() };
  Object.assign(map, opts.extra || {});
  await seedStorage(context, map, { always: opts.always });
}

/** localStorage of the page: one key (JSON parsed when it parses, else the text, null when absent) or, with no key, every key as text. */
async function readStorage(page, key) {
  if (key != null) {
    const raw = await page.evaluate((k) => localStorage.getItem(k), key);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (e) { return raw; }
  }
  return page.evaluate((mark) => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== mark) o[k] = localStorage.getItem(k); } return o; }, SEED_MARK);
}
/** The exact text stored under a key (no parsing). */
function readStorageText(page, key) { return page.evaluate((k) => localStorage.getItem(k), key); }

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
/**
 * Opens `url` in a new page of the context and waits until the app has started.
 * opts.ready: a function or expression evaluated in the page; default: window.__overload exists
 * (overload.js sets it last, and app.js in v2.8; the diet app's shell, fuel/fuel.js, offers the same object).
 * opts.dialogs: 'accept' (default) | 'dismiss' | 'none' | (dialog) => any. confirm() and prompt() would
 * otherwise hang the page. page.dialogs lists the messages seen.
 */
async function openApp(context, url, opts) {
  opts = opts || {};
  const page = await context.newPage();
  page.dialogs = [];
  const mode = opts.dialogs || 'accept';
  if (mode !== 'none') {
    page.on('dialog', (d) => {
      page.dialogs.push(d.type() + ': ' + d.message());
      if (typeof mode === 'function') return Promise.resolve(mode(d)).catch(() => {});
      return (mode === 'dismiss' ? d.dismiss() : d.accept()).catch(() => {});
    });
  }
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(opts.ready || (() => !!window.__overload), null, { timeout: opts.timeout || 15000 });
  return page;
}

/**
 * Taps the bottom tab with this data-screen name and waits until it is the active one.
 * food.js ignores every tap for 350 ms after a food is added (and for 1 s a tap on the same spot), so a
 * tap that did nothing is repeated after a moment.
 */
async function openTab(page, name) {
  const sel = '.tab[data-screen="' + name + '"]';
  for (let i = 0; i < 4; i++) {
    await page.click(sel);
    try { await page.waitForSelector(sel + '.active', { timeout: i < 3 ? 700 : 5000 }); return; } catch (e) { if (i === 3) throw e; }
  }
}

/** The names of the tabs in the tab bar, in order. */
function tabNames(page) { return page.evaluate(() => [...document.querySelectorAll('.tab[data-screen]')].map((t) => t.dataset.screen)); }

/** Screenshot to `file` (folders are created). opts.fullPage: the whole page, not just the 390x844 screen. */
async function shot(page, file, opts) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: !!(opts && opts.fullPage) });
  return file;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
/**
 * loadFixture('v28-state') -> { name, text, state, meta, facts }
 *   text   the exact text v2.8 had in localStorage (use this to seed, so the bytes are the app's own)
 *   state  the same, parsed
 *   meta   { now, today, tz, backup, ... } from v28-meta.json for this fixture: pass meta.now and meta.tz to newPhone
 *   facts  what the v2.8 app showed for it (v28-facts.json): numbers a test can assert
 */
function loadFixture(name) {
  const base = name.replace(/\.json$/, '');
  const text = fs.readFileSync(path.join(FIXTURES, base + '.json'), 'utf8').replace(/\n$/, '');
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(FIXTURES, f), 'utf8')); } catch (e) { return {}; } };
  const metaAll = read('v28-meta.json'), factsAll = read('v28-facts.json');
  const meta = Object.assign({}, metaAll.common || {}, (metaAll.fixtures || {})[base] || {});
  return { name: base, text, state: JSON.parse(text), meta, facts: (factsAll.fixtures || factsAll)[base] || {} };
}

/** todayKey as the app computes it, for a time in a time zone: 'YYYY-MM-DD'. */
function dayKey(ms, tz) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz || DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms == null ? Date.now() : ms));
  const g = (t) => p.find((x) => x.type === t).value;
  return g('year') + '-' + g('month') + '-' + g('day');
}

module.exports = {
  REPO, FIXTURES, LOCAL, STATE_KEY, SEED_MARK, DEFAULT_TZ, PHONE, TYPES,
  sleep, startServer, startSite, until, cachesOf, cacheText, copyTree, versionedFiles, markKey, markRelease, nextRelease, workerOf, launch, newPhone, watchWorkers, coldPage, seedStorage, seedV28, readStorage, readStorageText,
  openApp, openTab, tabNames, shot, loadFixture, dayKey, chromium
};
