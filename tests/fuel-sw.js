#!/usr/bin/env node
/* Fuel 3.0: the diet app's service worker (fuel/sw.js), next to the training app's.
 *
 *   node tests/fuel-sw.js [--tree=<folder>] [--port=8431]
 *
 * Real service workers in Chromium (contexts with service workers allowed), against a small server in this
 * file that serves a folder under /overload/ on 127.0.0.1, as GitHub Pages does, and can be switched to
 * another folder, made to fail or delay single addresses, or cut off ("no network"). The Firebase files
 * that sync.js imports are the stand-ins of tests/fake-firebase/; no outside host is contacted.
 *
 * What must hold (SPEC sections 1 and 8; dev/notes/offline.md sections 2 and 8; dev/notes/sync.md section 6):
 *   - a first visit installs the cache fuel-v1 with every file of the install list and nothing else of the
 *     site; the page is not reloaded; the Firebase files are stored once the worker is active;
 *   - with no network the app starts, shows the diary, finds foods in the food list, loads the barcode
 *     reader and its wasm file, and cloud sync loads too: all from fuel-v1;
 *   - a newer release's page that arrives before its worker does not replace the stored page;
 *   - in a storage where the training app's worker is registered at the root scope (v2.8's, taken from git;
 *     then this tree's): the Fuel page loads while that worker controls it, ends controlled by its own
 *     worker, and is never reloaded for it; afterwards each cache holds only its own app's files;
 *   - a training release does not delete fuel-v1, and a Fuel release deletes only caches named fuel-…: the
 *     training cache, other sites' caches and a cache merely starting "fuel" stay; the Firebase files move
 *     to the new cache without the network; the page reloads once;
 *   - one file of the install list failing leaves no cache behind, and the next try completes; the install
 *     does not need the Firebase files at all, and nothing waits for them when they hang;
 *   - a release made with bump.sh (in a temporary copy of the tree) arrives: fuel-v2, the page on the new
 *     number after one reload;
 *   - the next release on weak signal (the server ignores ?v=, so it answers 3.0's addresses with 3.1's files):
 *     the stored 3.0 page runs 3.0's files from fuel-v1 and they are not overwritten, also with no network;
 *     the food list (?db=) and the barcode reader (no ?v=) are still refreshed from the server; an install of
 *     3.1 that gets 3.0's fuel.js is refused; then 3.1 takes over whole (review finding O1).
 *   - the next release on weak signal (the server ignores ?v=, so it answers 3.0's addresses with 3.1's files):
 *     the stored 3.0 page runs 3.0's files from fuel-v1 and they are not overwritten, also with no network;
 *     the food list (?db=) and the barcode reader (no ?v=) are still refreshed from the server; an install of
 *     3.1 that gets 3.0's fuel.js is refused; then 3.1 takes over whole (review finding O1).
 *
 *   --tree=DIR   the folder to serve as 3.0. Default: the repo this file is in (the working tree).
 *
 * Prints one PASS or FAIL line per check; exit code 1 when a check failed.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const lib = require('./lib');
const F = require('./fuel-common');
const { createCloud } = require('./fake-firebase/route');

const args = F.args();
const PORT = Number(args.port) || 8431;
const BASE = '/overload/';
const V28_COMMIT = '3b17963';
const TREE = args.tree ? path.resolve(String(args.tree)) : lib.REPO;
const FUEL_SW = '/overload/fuel/sw.js', ROOT_SW = '/overload/sw.js';
const NOT_TRAINING = /\/overload\/(fuel|data|vendor)(\/|$)/;   // addresses the training cache must never hold
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };

const run = F.runner('fuel-sw');
const { need, same } = run;
const fx = lib.loadFixture('v28-state');
const sleep = lib.sleep;

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------
/**
 * Serves `site.root` under /overload/. site.down: every connection is dropped. site.rules: [{ test(rel, url),
 * status, delay }] for single addresses (rel is the path below /overload/). site.pages: { rel: { type, body } }
 * answered instead of a file. site.log: every address asked for.
 */
function startSite(port) {
  const site = { root: null, down: false, rules: [], pages: {}, log: [], url: lib.LOCAL + ':' + port };
  const server = http.createServer((req, res) => {
    if (site.down) { req.socket.destroy(); return; }
    const u = new URL(req.url, site.url);
    site.log.push(u.pathname + u.search);
    const send = (status, type, body) => { if (site.down) { req.socket.destroy(); return; } res.writeHead(status, { 'content-type': type, 'cache-control': 'max-age=600' }); res.end(body); };
    if (!u.pathname.startsWith(BASE)) { send(404, 'text/plain', 'outside the site'); return; }
    let rel = decodeURIComponent(u.pathname.slice(BASE.length));
    const rule = site.rules.find((r) => r.test(rel, u));
    const answer = () => {
      if (rule && rule.status) { send(rule.status, 'text/plain', 'test server: ' + rule.status); return; }
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const page = site.pages[rel];
      if (page) { send(200, page.type || TYPES['.html'], page.body); return; }
      const file = path.join(site.root, rel);
      let ok = file.startsWith(site.root + path.sep);
      try { ok = ok && fs.statSync(file).isFile(); } catch (e) { ok = false; }
      if (!ok) { send(404, TYPES['.html'], '<!doctype html><title>404</title><p id="server-404">The server has no such page.</p>'); return; }
      send(200, TYPES[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
    };
    if (rule && rule.delay) setTimeout(answer, rule.delay); else answer();
  });
  site.stop = () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  return new Promise((resolve, reject) => {
    server.once('error', (e) => reject(new Error('port ' + port + ' cannot be used: ' + e.message)));
    server.listen(port, '127.0.0.1', () => resolve(site));
  });
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------
const temp = [];
process.on('exit', () => temp.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* leave it */ } }));
function tempDir(name) { const d = fs.mkdtempSync(path.join(os.tmpdir(), name)); temp.push(d); return d; }
function extractV28() {
  const dir = tempDir('overload-v28-');
  execSync('git -C "' + lib.REPO + '" archive ' + V28_COMMIT + ' | tar -x -C "' + dir + '"', { stdio: ['ignore', 'ignore', 'inherit'] });
  if (!fs.existsSync(path.join(dir, 'sw.js'))) throw new Error('could not extract v2.8 (' + V28_COMMIT + ') from git');
  return dir;
}
// A copy of the 3.0 tree that the test may change (another root worker, a next release). Only what the site serves.
function copyTree(from) {
  const dir = tempDir('overload-30-');
  const skip = new Set(['.git', '.github', 'tests', 'dev', 'node_modules', 'tools', 'connector']);
  fs.cpSync(from, dir, { recursive: true, filter: (src) => { const rel = path.relative(from, src); return !rel || !skip.has(rel.split(path.sep)[0]); } });
  return dir;
}
const put = (dir, rel, text) => fs.writeFileSync(path.join(dir, rel), text);
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
// What a worker file says about itself: its cache name, its install list, its release, the Firebase addresses.
function workerFacts(dir, rel) {
  const text = read(dir, rel);
  const cache = (/const CACHE = '([^']+)'/.exec(text) || [])[1];
  const block = (/const ASSETS = \[([\s\S]*?)\n\];/.exec(text) || [])[1] || '';
  const assets = block.split('\n').map((l) => /^\s*'([^']+)'/.exec(l)).filter(Boolean).map((m) => m[1]);
  const release = ((assets.find((a) => a.includes('?v=')) || '').split('?v=')[1]) || '';
  const sdk = ((/const SDK = \[([\s\S]*?)\n\];/.exec(text) || [])[1] || '').split('\n').map((l) => /^\s*'([^']+)'/.exec(l)).filter(Boolean).map((m) => m[1]);
  return { text, cache, assets, release, sdk };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
// Asks again until fn gives something true (a page that is reloading throws: that counts as "not yet").
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
// { cache name: [addresses] } as the page sees Cache Storage (it belongs to the whole site).
const cachesOf = (page) => page.evaluate(async () => { const out = {}; for (const k of await self.caches.keys()) out[k] = (await (await self.caches.open(k)).keys()).map((r) => r.url).sort(); return out; });
// The worker in control of the page: the path of its file, or null.
const controller = (page) => page.evaluate(() => (navigator.serviceWorker.controller ? new URL(navigator.serviceWorker.controller.scriptURL).pathname : null));
// Every registration of the site: [{ scope, active, installing, waiting }] (paths).
const regs = (page) => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => ({
  scope: new URL(r.scope).pathname, active: r.active ? new URL(r.active.scriptURL).pathname : null, installing: !!r.installing, waiting: !!r.waiting })).sort((a, b) => (a.scope < b.scope ? -1 : 1)));
// Asks the registration of that scope to look for a new worker file now.
const updateScope = (page, scope) => page.evaluate(async (s) => { const r = (await navigator.serviceWorker.getRegistrations()).find((x) => new URL(x.scope).pathname === s); if (!r) throw new Error('no registration for ' + s); await r.update(); return true; }, scope);
const fuelStarted = () => !!window.__overload && !!window.__overloadFood;

/** One phone: a storage of its own with service workers allowed, and the stand-in Firebase files. */
async function makePhone(browser, cloud, name, opts) {
  const phone = await lib.newPhone(browser, Object.assign({ serviceWorkers: 'allow' }, opts && opts.now ? { now: opts.now, timezoneId: fx.meta.tz } : {}));
  phone.name = name;
  phone.device = await cloud.attach(phone.context, name);
  // Before any script of a page: which worker controlled it when it loaded, and every change of that.
  await phone.context.addInitScript(() => {
    if (window.top !== window || !navigator.serviceWorker) return;
    const who = () => (navigator.serviceWorker.controller ? new URL(navigator.serviceWorker.controller.scriptURL).pathname : null);
    window.__ctlAtLoad = who(); window.__ctlChanges = [];
    navigator.serviceWorker.addEventListener('controllerchange', () => window.__ctlChanges.push(who()));
  });
  if (opts && opts.seed) await opts.seed(phone.context);
  return phone;
}
/** Opens an address and waits for `ready`. page.loads counts how often the page has loaded (1 = never reloaded). */
async function openPage(phone, url, ready) {
  const page = await phone.context.newPage();
  page.loads = 0;
  page.on('load', () => { page.loads++; });
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(ready || fuelStarted, null, { timeout: 20000 });
  return page;
}

// ---------------------------------------------------------------------------
(async () => {
  const v28 = extractV28();
  const now = workerFacts(TREE, 'fuel/sw.js'), root = workerFacts(TREE, 'sw.js'), old = workerFacts(v28, 'sw.js');
  console.log('# 3.0 tree: ' + TREE + (TREE === lib.REPO ? ' (the working tree)' : ' (a copy)') + '; v2.8: git ' + V28_COMMIT);
  const site = await startSite(PORT);
  const at = (rel) => site.url + BASE + rel;
  const abs = (asset) => new URL(asset, at('fuel/')).href;          // an address of Fuel's install list, in full
  const rootAbs = (asset) => new URL(asset, at('')).href;
  const listed = now.assets.map(abs);
  // What is in a cache of Fuel's that is not Fuel's: not in its install list and not a Firebase file.
  const notFuels = (urls) => urls.filter((u) => !listed.includes(u) && !now.sdk.includes(u));
  const browser = await lib.launch();
  const cloud = createCloud();
  const phones = [];
  const phone = async (name, opts) => { const p = await makePhone(browser, cloud, name, opts); phones.push(p); return p; };
  // Fuel with the main fixture's food in it, so it opens on the diary.
  const seedFuel = (context) => lib.seedStorage(context, { 'fuel.state.v1': F.fuelStateFrom(fx.state), 'fuel.theme': 'dark' });

  try {
    // =====================================================================
    // The file itself
    // =====================================================================
    const file = (title, fn) => run.step('fuel/sw.js', title, fn);
    await file('the cache is fuel-v1: never a name the training worker deletes', async () => {
      need(/^fuel-v\d+$/.test(now.cache) && !now.cache.startsWith('overload-'), 'the cache is called ' + now.cache);
      need(/k\.startsWith\('fuel-'\)/.test(now.text) && !/startsWith\('overload-'\)/.test(now.text), 'activate does not choose its old caches by the prefix fuel-');
      need(!/caches\.match\(/.test(now.text.replace(/\/\/.*$/gm, '')), 'the worker looks in every cache of the site (caches.match)');
      need(!/addEventListener\('(push|notificationclick|pushsubscriptionchange)'/.test(now.text), 'the worker has push handlers');
      return now.cache + '; the training app\'s is ' + root.cache;
    });
    await file('the install list: this release\'s files, each on disk, each written as the page writes it', async () => {
      need(now.release === '3.0' && now.assets.filter((a) => a.includes('?v=')).every((a) => a.endsWith('?v=3.0')), 'not every versioned file carries ?v=3.0');
      const missing = now.assets.filter((a) => { const rel = a.split('?')[0]; return !fs.existsSync(path.join(TREE, 'fuel', rel.endsWith('/') ? rel + 'index.html' : rel)); });
      need(missing.length === 0, 'not on disk: ' + missing.join(', '));
      const html = read(TREE, 'fuel/index.html');
      const loaded = (html.match(/(?:src|href)="[^"]*\?v=[^"]*"/g) || []).map((m) => m.replace(/^[a-z]+="|"$/g, ''));
      const unlisted = loaded.filter((u) => !now.assets.includes(u));
      need(loaded.length > 0 && unlisted.length === 0, 'the page loads, but the list does not name: ' + unlisted.join(', '));
      for (const a of ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-512.png']) need(now.assets.includes(a), a + ' is not in the list');
      need(new Set(now.assets).size === now.assets.length, 'an address is listed twice');
      need(!now.assets.some((a) => /^\.\.\/(index\.html|overload\.js|app\.js|programs\.js|connector\.js|sync\.js|sw\.js|train\.css)/.test(a) || a === '../'), 'a file of the training app is in the list');
      return now.assets.length + ' addresses, ' + loaded.length + ' of them versioned files of the page';
    });
    await file('the food list and the barcode reader are listed under the addresses food.js asks for', async () => {
      const food = read(TREE, 'fuel/food.js');
      const db = (/const DB_URL = '([^']+)'/.exec(food) || [])[1];
      need(db && now.assets.includes(db), 'food.js asks for ' + db + ', which the list does not name');
      need((now.text.match(/\?db=\d+/g) || []).every((x) => db.endsWith(x)), 'another ?db= number is in sw.js');
      need(/'\.\.\/vendor\/zxing\/reader\/index\.js'/.test(food) && /'\.\.\/vendor\/zxing\/'/.test(food), 'food.js does not ask for the reader one folder up');
      for (const a of ['../vendor/zxing/reader/index.js', '../vendor/zxing/share.js', '../vendor/zxing/zxing_reader.wasm']) need(now.assets.includes(a), a + ' is not in the list');
      return db + ' and three reader files';
    });
    await file('the Firebase addresses are exactly the ones sync.js imports, and not part of the all-or-nothing list', async () => {
      const imports = (read(TREE, 'fuel/sync.js').match(/from '(https:[^']+)'/g) || []).map((m) => m.slice(6, -1));
      same(now.sdk.slice().sort(), imports.slice().sort(), 'the addresses in sw.js against the imports of sync.js');
      need(imports.length === 3 && imports.every((u) => u.startsWith('https://www.gstatic.com/firebasejs/')), 'sync.js imports ' + imports.join(', '));
      need(!now.assets.some((a) => /gstatic/.test(a)), 'a Firebase file is in the install list');
      const theirs = (read(TREE, 'sync.js').match(/from '(https:[^']+)'/g) || []).map((m) => m.slice(6, -1));
      same(imports.slice().sort(), theirs.slice().sort(), 'Fuel\'s Firebase files against the training app\'s (one version for both)');
      return imports[0].replace(/firebase-app\.js$/, '') + '{app,auth,firestore}.js';
    });

    // =====================================================================
    // Phone 1: a new Home Screen app. First visit, then no network.
    // =====================================================================
    const p1 = await phone('one', { now: fx.meta.now, seed: seedFuel });
    site.root = TREE;
    const one = (title, fn) => run.step('first visit', title, fn);
    let page = null;
    let ok = await one('the page starts with no worker; fuel-v1 is installed with every file of the list, and only Fuel\'s', async () => {
      page = await openPage(p1, at('fuel/index.html'));
      need((await page.evaluate(() => window.__ctlAtLoad)) === null, 'a worker controlled the first visit');
      const cs = await until(async () => { const c = await cachesOf(page); return c[now.cache] && c[now.cache].length >= listed.length && (await controller(page)) === FUEL_SW ? c : null; }, 30000);
      need(cs, 'no filled ' + now.cache + ' with the page under its worker after 30 s; caches: ' + JSON.stringify(Object.keys(await cachesOf(page))) + ', controller: ' + await controller(page));
      const lacking = listed.filter((u) => !cs[now.cache].includes(u));
      need(lacking.length === 0, 'not stored: ' + lacking.join(', '));
      need(notFuels(cs[now.cache]).length === 0, 'stored, but not Fuel\'s: ' + notFuels(cs[now.cache]).join(', '));
      same(Object.keys(cs), [now.cache], 'the caches of the site');
      same(await regs(page), [{ scope: '/overload/fuel/', active: FUEL_SW, installing: false, waiting: false }], 'the registrations');
      return cs[now.cache].length + ' entries for ' + listed.length + ' addresses; scope /overload/fuel/';
    });
    if (ok) {
      await one('the first install does not reload the page', async () => {
        await sleep(1200);
        need(page.loads === 1, 'the page loaded ' + page.loads + ' times');
        same(await page.evaluate(() => window.__ctlChanges), [FUEL_SW], 'the changes of the worker in control');
        return 'loaded once; taken over by ' + FUEL_SW;
      });
      await one('the Firebase files are stored once the worker is active, although the page loaded them before that', async () => {
        const cs = await until(async () => { const c = await cachesOf(page); return now.sdk.every((u) => c[now.cache].includes(u)) ? c : null; }, 15000);
        need(cs, 'fuel-v1 does not hold the three Firebase files; it has: ' + (await cachesOf(page))[now.cache].filter((u) => /gstatic/.test(u)).join(', '));
        need(notFuels(cs[now.cache]).length === 0 && cs[now.cache].length === listed.length + 3, cs[now.cache].length + ' entries');
        return '3 files from www.gstatic.com (stand-ins), ' + cs[now.cache].length + ' entries in all';
      });
      // ---- no network ----
      site.down = true;
      p1.device.blockSdk(true);
      let off = null;
      const offline = (title, fn) => run.step('no network', title, fn);
      await offline('the app starts and shows the diary, from fuel-v1; cloud sync loads too', async () => {
        off = await openPage(p1, at('fuel/index.html'));
        need((await controller(off)) === FUEL_SW && (await off.evaluate(() => window.__ctlAtLoad)) === FUEL_SW, 'the page is not under Fuel\'s worker');
        const day = await F.readDay(off), want = fx.facts.foodDays[0];
        need(day.kcalLine === want.kcalLine && day.entries === want.entries, 'the diary shows ' + day.kcalLine + ', ' + day.entries + ' entries');
        need(await off.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].every((l) => l.sheet && l.sheet.cssRules.length > 0)), 'a stylesheet did not load');
        await off.waitForFunction(() => !!window.__overloadSync, null, { timeout: 8000 });
        return day.kcalLine + ', ' + day.entries + ' entries; the sync module is there';
      });
      await offline('the folder address starts too, and an address never stored gets Fuel\'s page, not the training app\'s', async () => {
        const a = await openPage(p1, at('fuel/'));
        need((await a.title()) === 'Fuel', 'the folder address shows "' + await a.title() + '"');
        await a.goto(at('fuel/never-stored.html'));
        await a.waitForFunction(fuelStarted, null, { timeout: 15000 });
        need((await a.title()) === 'Fuel' && !(await a.evaluate(() => !!document.querySelector('.tab[data-screen="history"]'))), 'the page is "' + await a.title() + '"');
        await a.close();
        return '/overload/fuel/ and /overload/fuel/never-stored.html';
      });
      await offline('a search finds foods of the food list (../data/foods.json, from the cache)', async () => {
        await off.click('[data-action="food-add"][data-meal="3"]');
        await off.waitForSelector('#sheet:not([hidden]) #food-results');
        await off.fill('[data-field="food-search"]', 'chicken breast');
        await off.waitForSelector('#food-results [data-action="food-pick"][data-src="usda"]', { timeout: 15000 });
        const hits = await F.count(off, '#food-results [data-action="food-pick"][data-src="usda"]');
        await F.closeSheet(off);
        return hits + ' listed foods for "chicken breast"';
      });
      await offline('the barcode reader loads with its wasm file, the way food.js loads it', async () => {
        const r = await off.evaluate(async () => {
          const zx = await import(new URL('../vendor/zxing/reader/index.js', location.href).href);
          let wasm = null;
          await zx.prepareZXingModule({ overrides: { locateFile: (p, prefix) => { if (p.endsWith('.wasm')) { wasm = new URL('../vendor/zxing/' + p, location.href).href; return wasm; } return prefix + p; } }, fireImmediately: true });
          return { read: typeof zx.readBarcodes, wasm };
        });
        need(r.read === 'function' && /\/overload\/vendor\/zxing\/zxing_reader\.wasm$/.test(r.wasm), JSON.stringify(r));
        return 'module ready, ' + r.wasm.replace(site.url, '');
      });
      await offline('nothing was added to the cache by all that, and no page error', async () => {
        const cs = await cachesOf(off);
        need(notFuels(cs[now.cache]).length === 0 && cs[now.cache].length === listed.length + 3, cs[now.cache].length + ' entries; not Fuel\'s: ' + notFuels(cs[now.cache]).join(', '));
        need(p1.pageErrors.length === 0, p1.pageErrors.join(' | ').slice(0, 300));
        return cs[now.cache].length + ' entries';
      });
      site.down = false;
      p1.device.blockSdk(false);
      await one('a newer release\'s page that arrives before its worker is shown, but not stored over this release\'s page', async () => {
        const html = read(TREE, 'fuel/index.html').replace(/\?v=3\.0/g, '?v=9.9');
        site.pages['fuel/index.html'] = { body: html };
        // The newer release's main script says so: the worker runs no main script that names another release.
        site.pages['fuel/fuel.js'] = { type: TYPES['.js'], body: read(TREE, 'fuel/fuel.js').replace(/const VERSION = '[^']*'/, "const VERSION = '9.9'") };
        let kept;
        try {
          await page.reload(); await page.waitForFunction(fuelStarted);
          need((await page.evaluate(() => document.querySelector('script[src*="fuel.js"]').getAttribute('src'))) === './fuel.js?v=9.9', 'the newer page did not arrive');
          await sleep(700);   // the worker stores after it has answered
          kept = await page.evaluate(async (name) => { const c = await caches.open(name); return { page: await (await c.match('/overload/fuel/index.html')).text(), folder: await (await c.match('/overload/fuel/')).text() }; }, now.cache);
        } finally { delete site.pages['fuel/index.html']; delete site.pages['fuel/fuel.js']; }
        need(/fuel\.js\?v=3\.0/.test(kept.page) && !/\?v=9\.9/.test(kept.page) && /fuel\.js\?v=3\.0/.test(kept.folder), 'the stored page is the newer one: its files are not in the cache');
        // And that stored page is what a start with no network gets.
        site.down = true;
        const o = await openPage(p1, at('fuel/index.html'));
        need((await o.evaluate(() => document.querySelector('script[src*="fuel.js"]').getAttribute('src'))) === './fuel.js?v=3.0', 'the start with no network got another page');
        site.down = false;
        return 'the stored page still asks for ?v=3.0, and starts with no network';
      });

      site.down = false;
    }
    await p1.close();

    // =====================================================================
    // Phone 2: a storage where v2.8's worker is registered at the root scope
    // =====================================================================
    // The server's copy of 3.0, which the test changes: first with v2.8's own worker file at the root (so that
    // worker stays the root worker while the Fuel page is looked at), then with this tree's.
    const copy = copyTree(TREE);
    const p2 = await phone('two', { seed: (context) => lib.seedV28(context, lib.loadFixture('v28-state-small')) });
    const two = (title, fn) => run.step('under v2.8\'s worker', title, fn);
    let fuel = null;
    site.root = v28;
    ok = await two('set-up: v2.8 runs under its own worker, cache ' + old.cache, async () => {
      const app = await openPage(p2, at('index.html'), () => !!window.__overload);
      const cs = await until(async () => { const c = await cachesOf(app); return c[old.cache] && c[old.cache].length >= old.assets.length && (await controller(app)) === ROOT_SW ? c : null; }, 30000);
      need(cs, 'the v2.8 worker did not install');
      await app.close();
      return cs[old.cache].length + ' entries';
    });
    if (ok) {
      put(copy, 'sw.js', read(v28, 'sw.js'));
      site.root = copy;
      // Fuel's worker cannot finish installing for a few seconds: the food list (which only the install asks for) is slow.
      const slow = { test: (rel) => rel === 'data/foods.json', delay: 5000 };
      site.rules.push(slow);
      ok = await two('the Fuel page loads while v2.8\'s worker controls it and its own is still installing (network fine)', async () => {
        fuel = await openPage(p2, at('fuel/index.html'));
        need((await fuel.evaluate(() => window.__ctlAtLoad)) === ROOT_SW, 'the page was not under the root worker when it loaded: ' + await fuel.evaluate(() => window.__ctlAtLoad));
        const rootWorker = p2.context.serviceWorkers().find((w) => w.url() === at('sw.js'));
        need(rootWorker && (await rootWorker.evaluate(() => CACHE)) === old.cache, 'the root worker is not v2.8\'s');
        const r = await until(async () => (await regs(fuel)).find((x) => x.scope === '/overload/fuel/'), 5000);
        need(r && !r.active, 'Fuel\'s own worker is active already: this check needs it not to be (' + JSON.stringify(r) + ')');
        need((await fuel.title()) === 'Fuel' && (await F.screen(fuel)) === 'welcome' && (await F.count(fuel, '.choice-card')) >= 3, 'the page is "' + await fuel.title() + '", screen ' + await F.screen(fuel));
        need(await fuel.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].every((l) => l.sheet && l.sheet.cssRules.length > 0)), 'a stylesheet did not load');
        need(!(await fuel.$('#boot-note')), 'the start-up rescue wrote its note');
        return 'Welcome is on screen; controlled by ' + ROOT_SW + ' (' + old.cache + ')';
      });
      site.rules.splice(site.rules.indexOf(slow), 1);
    }
    if (ok) {
      await two('it ends controlled by its own worker, and is not reloaded for that', async () => {
        const took = await until(async () => (await controller(fuel)) === FUEL_SW, 30000);
        need(took, 'still controlled by ' + await controller(fuel));
        await sleep(1500);
        need(fuel.loads === 1, 'the page loaded ' + fuel.loads + ' times');
        same(await fuel.evaluate(() => window.__ctlChanges), [FUEL_SW], 'the changes of the worker in control');
        need((await F.screen(fuel)) === 'welcome', 'the screen is ' + await F.screen(fuel));
        const cs = await cachesOf(fuel);
        need(listed.every((u) => cs[now.cache].includes(u)) && notFuels(cs[now.cache]).length === 0, 'fuel-v1 is not exactly Fuel\'s: ' + notFuels(cs[now.cache]).join(', '));
        return 'loaded once; ' + cs[now.cache].length + ' entries in ' + now.cache;
      });
      await two('the root worker then updates to this tree\'s: the Fuel page stays with its own, and each cache holds only its own app', async () => {
        const had = (await cachesOf(fuel))[now.cache];
        put(copy, 'sw.js', read(TREE, 'sw.js'));
        await updateScope(fuel, BASE);
        const cs = await until(async () => { const c = await cachesOf(fuel); return c[root.cache] && !c[old.cache] && c[root.cache].length >= root.assets.length ? c : null; }, 30000);
        need(cs, 'the root worker did not update; caches: ' + Object.keys(await cachesOf(fuel)).join(', '));
        await sleep(1500);
        need(fuel.loads === 1 && (await controller(fuel)) === FUEL_SW, 'loads: ' + fuel.loads + ', controller: ' + await controller(fuel));
        same(await fuel.evaluate(() => window.__ctlChanges), [FUEL_SW], 'the changes of the worker in control');
        const strays = cs[root.cache].filter((u) => NOT_TRAINING.test(u));
        need(strays.length === 0, 'the training cache holds: ' + strays.join(', '));
        same((await cachesOf(fuel))[now.cache], had, 'fuel-v1 after the training update');
        // (The icon set in shared/ is listed by both workers: the one script the two apps have in common.)
        need(notFuels(had).length === 0 && !had.some((u) => root.assets.filter((a) => /\.js\?v=/.test(a) && !/(^|\/)shared\//.test(a)).map(rootAbs).includes(u)), 'fuel-v1 holds files of the training app');
        same((await regs(fuel)).map((r) => r.scope + ' ' + r.active), [BASE + ' ' + ROOT_SW, '/overload/fuel/ ' + FUEL_SW], 'the registrations');
        return root.cache + ': ' + cs[root.cache].length + ' entries, none under fuel/, data/ or vendor/; ' + now.cache + ': ' + had.length + ', all Fuel\'s';
      });
    }
    await p2.close();

    // =====================================================================
    // Phone 3: this tree's training worker is there first. Then a release of each app.
    // =====================================================================
    put(copy, 'sw.js', read(TREE, 'sw.js'));
    site.root = copy;
    const p3 = await phone('three');
    const three = (title, fn) => run.step('next to the training app', title, fn);
    let app = null;
    fuel = null;
    ok = await three('with this tree\'s training worker in control at first, the Fuel page ends under its own worker, loaded once', async () => {
      app = await openPage(p3, at('index.html'), () => !!window.__overload);
      need(await until(async () => { const c = await cachesOf(app); return c[root.cache] && c[root.cache].length >= root.assets.length && (await controller(app)) === ROOT_SW; }, 30000), 'the training worker did not install');
      fuel = await openPage(p3, at('fuel/index.html'));
      need((await fuel.evaluate(() => window.__ctlAtLoad)) === ROOT_SW, 'the page was not under the root worker when it loaded: ' + await fuel.evaluate(() => window.__ctlAtLoad));
      need(await until(async () => (await controller(fuel)) === FUEL_SW, 30000), 'still controlled by ' + await controller(fuel));
      await until(async () => { const c = await cachesOf(fuel); return now.sdk.every((u) => c[now.cache].includes(u)); }, 15000);
      await sleep(1500);
      need(fuel.loads === 1, 'the page loaded ' + fuel.loads + ' times');
      same(await fuel.evaluate(() => window.__ctlChanges), [FUEL_SW], 'the changes of the worker in control');
      return 'first ' + ROOT_SW + ', then ' + FUEL_SW;
    });
    if (ok) {
      await three('each worker\'s cache holds only its own app\'s files', async () => {
        await fuel.evaluate(() => fetch('../data/foods.json?db=5').then((r) => r.status));   // what the Add sheet asks for
        await sleep(500);
        const cs = await cachesOf(fuel);
        same(Object.keys(cs).sort(), [now.cache, root.cache].sort(), 'the caches of the site');
        const strays = cs[root.cache].filter((u) => NOT_TRAINING.test(u));
        need(strays.length === 0, 'the training cache holds: ' + strays.join(', '));
        need(listed.every((u) => cs[now.cache].includes(u)) && notFuels(cs[now.cache]).length === 0, 'fuel-v1 holds: ' + notFuels(cs[now.cache]).join(', '));
        need(now.sdk.every((u) => cs[now.cache].includes(u)), 'fuel-v1 lacks the Firebase files');
        return root.cache + ': ' + cs[root.cache].length + ' entries; ' + now.cache + ': ' + cs[now.cache].length;
      });
      await three('a training release (the next overload-v…) deletes its own old cache and leaves fuel-v1 and the Fuel page alone', async () => {
        const had = (await cachesOf(fuel))[now.cache], next = 'overload-v' + (Number(root.cache.slice(10)) + 1);
        put(copy, 'sw.js', read(TREE, 'sw.js').replace("const CACHE = '" + root.cache + "'", "const CACHE = '" + next + "'"));
        await updateScope(fuel, BASE);
        const cs = await until(async () => { const c = await cachesOf(fuel); return c[next] && !c[root.cache] ? c : null; }, 30000);
        need(cs, 'the training release did not install; caches: ' + Object.keys(await cachesOf(fuel)).join(', '));
        await sleep(1500);
        same(cs[now.cache], had, 'fuel-v1 after the training release');
        need(fuel.loads === 1 && (await controller(fuel)) === FUEL_SW, 'the Fuel page: loads ' + fuel.loads + ', controller ' + await controller(fuel));
        return next + ' in place of ' + root.cache + '; ' + now.cache + ' as it was (' + had.length + ' entries)';
      });
      await three('a Fuel release (fuel-v2) deletes only caches named fuel-…, carries the Firebase files over, and reloads the page once', async () => {
        await fuel.evaluate(async () => {
          for (const name of ['fuel-old-v0', 'fuelish', 'othersite-v1', 'overload-stray']) await (await caches.open(name)).put('/overload/kept-' + name + '.txt', new Response(name));
        });
        const before = await cachesOf(fuel), training = Object.keys(before).find((k) => /^overload-v\d+$/.test(k));
        p3.device.blockSdk(true);   // the Firebase files can only come from the old cache now
        put(copy, 'fuel/sw.js', now.text.replace("const CACHE = '" + now.cache + "'", "const CACHE = 'fuel-v2'"));
        await updateScope(fuel, '/overload/fuel/');
        const cs = await until(async () => { const c = await cachesOf(fuel); return c['fuel-v2'] && !c[now.cache] ? c : null; }, 30000);
        need(cs, 'the Fuel release did not install; caches: ' + Object.keys(await cachesOf(fuel).catch(() => ({}))).join(', '));
        need(!cs['fuel-old-v0'], 'fuel-old-v0 was not deleted');
        for (const name of ['fuelish', 'othersite-v1', 'overload-stray', training]) same(cs[name], before[name], 'the cache ' + name);
        need(listed.every((u) => cs['fuel-v2'].includes(u)) && now.sdk.every((u) => cs['fuel-v2'].includes(u)) && notFuels(cs['fuel-v2']).length === 0, 'fuel-v2 is not complete: lacks ' + listed.concat(now.sdk).filter((u) => !cs['fuel-v2'].includes(u)).join(', '));
        need(await until(() => fuel.loads === 2, 8000), 'the page did not reload for its new worker (loads: ' + fuel.loads + ')');
        await fuel.waitForFunction(fuelStarted, null, { timeout: 15000 });
        await sleep(2000);
        need(fuel.loads === 2 && (await controller(fuel)) === FUEL_SW, 'loads: ' + fuel.loads + ', controller: ' + await controller(fuel));
        p3.device.blockSdk(false);
        return 'kept: fuelish, othersite-v1, overload-stray, ' + training + '; deleted: ' + now.cache + ', fuel-old-v0; fuel-v2 has ' + cs['fuel-v2'].length + ' entries';
      });
      await three('with no network both apps start, each from its own cache', async () => {
        site.down = true;
        p3.device.blockSdk(true);
        const f = await openPage(p3, at('fuel/index.html'));
        const t = await openPage(p3, at('index.html'), () => !!window.__overload);
        need((await f.title()) === 'Fuel' && (await controller(f)) === FUEL_SW && (await t.title()) === 'Overload' && (await controller(t)) === ROOT_SW, 'titles: ' + (await f.title()) + ', ' + (await t.title()));
        need(await f.evaluate(() => !!window.__overloadFood) && !(await t.evaluate(() => !!window.__overloadFood)), 'food.js is in the wrong page');
        site.down = false;
        p3.device.blockSdk(false);
        return 'Fuel under ' + FUEL_SW + ', Overload under ' + ROOT_SW;
      });
    }
    site.down = false;
    await p3.close();

    // =====================================================================
    // Phone 4: all or nothing, and no need for the Firebase files
    // =====================================================================
    put(copy, 'fuel/sw.js', now.text);
    const p4 = await phone('four', { seed: seedFuel });
    p4.device.blockSdk(true);   // www.gstatic.com cannot be reached at all
    const four = (title, fn) => run.step('install', title, fn);
    const broken = { test: (rel) => rel === 'vendor/zxing/zxing_reader.wasm', status: 503 };
    site.rules.push(broken);
    site.log.length = 0;
    let p = null;
    ok = await four('one file of the list fails (the wasm file answers 503): the app runs, and no cache is left behind', async () => {
      p = await openPage(p4, at('fuel/index.html'));
      need(await until(() => site.log.some((u) => /zxing_reader\.wasm/.test(u)), 15000), 'the install never asked for the wasm file');
      const settled = await until(async () => { const r = (await regs(p)).find((x) => x.scope === '/overload/fuel/'); return (!r || (!r.installing && !r.active)) && !(await cachesOf(p))[now.cache]; }, 15000);
      need(settled, 'after the failed install: registrations ' + JSON.stringify(await regs(p)) + ', caches ' + Object.keys(await cachesOf(p)).join(', '));
      need((await controller(p)) === null && (await F.screen(p)) === 'food', 'controller ' + (await controller(p)) + ', screen ' + await F.screen(p));
      need((await p.evaluate(() => typeof window.__overloadSync)) === 'undefined', 'the sync module loaded although its files cannot be reached');
      return 'no ' + now.cache + ', no active worker; the diary is on screen';
    });
    site.rules.splice(site.rules.indexOf(broken), 1);
    if (ok) {
      await four('the next start installs everything, although the Firebase files still cannot be reached', async () => {
        await p.reload(); await p.waitForFunction(fuelStarted);
        const cs = await until(async () => { const c = await cachesOf(p); return c[now.cache] && c[now.cache].length >= listed.length && (await controller(p)) === FUEL_SW ? c : null; }, 30000);
        need(cs, 'the install did not complete; caches: ' + Object.keys(await cachesOf(p)).join(', '));
        await sleep(1500);
        const got = (await cachesOf(p))[now.cache];
        need(listed.every((u) => got.includes(u)) && got.length === listed.length, got.length + ' entries; extra: ' + got.filter((u) => !listed.includes(u)).join(', '));
        return got.length + ' entries, none from www.gstatic.com';
      });
      await four('and with no network the app starts on this phone\'s data, without cloud sync', async () => {
        site.down = true;
        const o = await openPage(p4, at('fuel/index.html'));
        need((await F.screen(o)) === 'food' && (await F.count(o, '.f-meal')) === 4, 'the diary is not on screen');
        await sleep(1500);
        need((await o.evaluate(() => typeof window.__overloadSync)) === 'undefined', 'a sync module is in the page');
        await lib.openTab(o, 'settings');
        need(/Cloud sync is loading/.test(await F.text(o, '#cloud-card')), 'the Cloud sync card reads ' + await F.text(o, '#cloud-card'));
        site.down = false;
        need(p4.pageErrors.length === 0, p4.pageErrors.join(' | ').slice(0, 300));
        return 'the diary and Settings draw; the card says cloud sync is loading';
      });
    }
    site.down = false;
    await p4.close();

    // =====================================================================
    // Phone 5: www.gstatic.com does not answer at all (worse than failing: every request hangs)
    // =====================================================================
    const p5 = await phone('five', { seed: seedFuel });
    const HANG = 12000;
    await p5.context.route(/^https:\/\/www\.gstatic\.com\//, (route) => { setTimeout(() => route.abort().catch(() => {}), HANG); });
    await run.step('install', 'while the Firebase files hang, the app starts, its worker takes over, and the next start is not held up', async () => {
      const pg = await p5.context.newPage();
      pg.on('dialog', (d) => d.accept().catch(() => {}));
      let t0 = Date.now();
      await pg.goto(at('fuel/index.html'), { waitUntil: 'commit' });   // the page's "load" waits for the sync module, which hangs
      await pg.waitForFunction(fuelStarted, null, { timeout: 8000 });
      const first = Date.now() - t0;
      need(await until(async () => (await controller(pg)) === FUEL_SW, 9000), 'the worker did not take over while the Firebase files hung; controller: ' + await controller(pg));
      // The worker is in control now and its own requests for the Firebase files are still hanging.
      t0 = Date.now();
      await pg.goto(at('fuel/index.html'), { waitUntil: 'commit' });
      await pg.waitForFunction(fuelStarted, null, { timeout: 15000 });
      const second = Date.now() - t0;
      need(second < 5000, 'the second start took ' + second + ' ms: it waited for www.gstatic.com');
      need((await F.screen(pg)) === 'food' && (await controller(pg)) === FUEL_SW, 'screen ' + (await F.screen(pg)) + ', controller ' + await controller(pg));
      return 'first start ' + first + ' ms, second (under the worker) ' + second + ' ms, with every Firebase request hanging for ' + HANG / 1000 + ' s';
    });
    await p5.close();

    // =====================================================================
    // Phone 6: a release made the way releases are made, with bump.sh
    // =====================================================================
    const next = copyTree(TREE);
    site.root = next;
    const p6 = await phone('six', { seed: seedFuel });
    const six = (title, fn) => run.step('bump.sh', title, fn);
    let f6 = null;
    ok = await six('set-up: both apps installed from this tree (3.0)', async () => {
      const t = await openPage(p6, at('index.html'), () => !!window.__overload);
      f6 = await openPage(p6, at('fuel/index.html'));
      need(await until(async () => { const c = await cachesOf(f6); return c[now.cache] && c[root.cache] && (await controller(f6)) === FUEL_SW && (await controller(t)) === ROOT_SW && now.sdk.every((u) => c[now.cache].includes(u)); }, 30000), 'the two workers did not install');
      await t.close();
      return now.cache + ' and ' + root.cache;
    });
    if (ok) {
      await six('sh bump.sh 3.1, then an update check: Fuel reloads once into 3.1 from fuel-v2, and starts with no network', async () => {
        let said = '';
        try { said = execSync('sh bump.sh 3.1', { cwd: next, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); }
        catch (e) { throw new Error('bump.sh failed: ' + String(e.stderr || e.message).trim().split('\n').slice(0, 3).join(' | ')); }
        const then = workerFacts(next, 'fuel/sw.js');
        need(then.cache === 'fuel-v2' && then.release === '3.1' && then.assets.length === now.assets.length, 'after bump.sh the worker says ' + then.cache + ', release ' + then.release);
        await updateScope(f6, '/overload/fuel/');
        const cs = await until(async () => { const c = await cachesOf(f6); return c['fuel-v2'] && !c[now.cache] ? c : null; }, 30000);
        need(cs, 'the release did not install; caches: ' + Object.keys(await cachesOf(f6).catch(() => ({}))).join(', '));
        const lacking = then.assets.map(abs).concat(now.sdk).filter((u) => !cs['fuel-v2'].includes(u));
        need(lacking.length === 0, 'fuel-v2 lacks ' + lacking.join(', '));
        need(await until(() => f6.loads === 2, 8000), 'the page did not reload (loads: ' + f6.loads + ')');
        await f6.waitForFunction(fuelStarted, null, { timeout: 15000 });
        await sleep(1500);
        need(f6.loads === 2, 'the page loaded ' + f6.loads + ' times');
        need((await f6.evaluate(() => document.querySelector('script[src*="fuel.js"]').getAttribute('src'))) === './fuel.js?v=3.1', 'the page is not the 3.1 one');
        await lib.openTab(f6, 'settings');
        need(/Fuel · v3\.1/.test(await F.text(f6, '#app')), 'Settings does not say v3.1');
        site.down = true;
        p6.device.blockSdk(true);
        const o = await openPage(p6, at('fuel/index.html'));
        need((await o.evaluate(() => document.querySelector('script[src*="fuel.js"]').getAttribute('src'))) === './fuel.js?v=3.1' && (await F.screen(o)) === 'food', 'the start with no network is not 3.1');
        await o.waitForFunction(() => !!window.__overloadSync, null, { timeout: 8000 });
        site.down = false;
        return said.trim().split('\n')[0] + '; ' + cs['fuel-v2'].length + ' entries in fuel-v2';
      });
    }
    site.down = false;
    await p6.close();

    // =====================================================================
    // Phone 7: the next release on weak signal. The server ignores ?v=, so once 3.1 is published it answers
    // this release's addresses with 3.1's files; the 3.0 page must not run them, nor keep them (finding O1).
    // =====================================================================
    const base = copyTree(TREE), next31 = copyTree(TREE);
    execSync('sh bump.sh 3.1', { cwd: next31, stdio: ['ignore', 'pipe', 'pipe'] });
    const fuelFiles = [...read(next31, 'fuel/index.html').matchAll(/(?:src|href)="([^"?]+)\?v=/g)].map((m) => path.posix.normalize('fuel/' + m[1]));
    for (const f of fuelFiles) fs.appendFileSync(path.join(next31, f), '\n/* 3.1 */\n');   // a real release changes its files
    site.root = base;
    const p7 = await phone('seven', { seed: seedFuel });
    const seven = (title, fn) => run.step('next release, weak signal', title, fn);
    let f7 = null;
    const entries30 = fuelFiles.map((f) => site.url + BASE + f + '?v=3.0');
    const entryTexts = (page, cache, urls) => page.evaluate(async ([name, list]) => { const c = await caches.open(name), out = {}; for (const u of list) { const r = await c.match(u); out[u] = r ? await r.text() : null; } return out; }, [cache, urls]);
    const shownVersion = async (page) => { await lib.openTab(page, 'settings'); return (/Fuel · v([0-9.]+)/.exec(await F.text(page, '#app')) || [])[1] || null; };
    const updateEnds = (page, scope) => page.evaluate(async (s) => {
      const reg = (await navigator.serviceWorker.getRegistrations()).find((x) => new URL(x.scope).pathname === s);
      let found = false;
      const end = new Promise((resolve) => {
        const watchIt = (w) => { if (!w) return; found = true; const look = () => { if (w.state === 'redundant' || w.state === 'activated') resolve(w.state); }; w.addEventListener('statechange', look); look(); };
        reg.addEventListener('updatefound', () => watchIt(reg.installing));
        watchIt(reg.installing);
      });
      await reg.update().catch(() => {});
      return Promise.race([end, new Promise((r) => setTimeout(() => r(found ? 'timeout' : 'none'), 25000))]);
    }, scope);
    const settledReg = (page) => until(() => page.evaluate(async () => { const g = (await navigator.serviceWorker.getRegistrations()).find((x) => /\/fuel\/$/.test(x.scope)); return !!g && !g.installing && !g.waiting; }), 20000);
    ok = await seven('set-up: Fuel 3.0 installed under its own worker; 3.1 made with bump.sh, every file of its page changed', async () => {
      f7 = await openPage(p7, at('fuel/index.html'));
      need(await until(async () => { const c = await cachesOf(f7); return c[now.cache] && listed.every((u) => c[now.cache].includes(u)) && (await controller(f7)) === FUEL_SW; }, 30000), 'Fuel did not install');
      await settledReg(f7);
      await f7.close();
      return fuelFiles.length + ' files differ in 3.1: ' + fuelFiles.join(', ');
    });
    if (ok) {
      site.root = next31;
      const slowPage = { test: (rel) => rel === 'fuel/index.html', delay: 4000 };
      const noInstall = { test: (rel) => rel === 'fuel/icon-512.png', status: 404 };   // the 3.1 worker cannot take over yet
      site.rules.push(slowPage, noInstall);
      await seven('the page over 3 s: the stored 3.0 page runs 3.0\'s fuel.js and files, and the stored copies stay 3.0\'s', async () => {
        f7 = await openPage(p7, at('fuel/index.html'));
        need((await f7.evaluate(() => document.querySelector('script[src*="fuel.js"]').getAttribute('src'))) === './fuel.js?v=3.0', 'the page is not the stored 3.0 one');
        const v = await shownVersion(f7);
        await sleep(5000);   // late answers, if any, would be stored by now
        const now30 = await entryTexts(f7, now.cache, entries30);
        const changed = entries30.filter((u) => now30[u] !== read(base, new URL(u).pathname.slice(BASE.length)));
        await f7.close();
        need(v === '3.0', 'Settings says Fuel · v' + v);
        need(!changed.length, 'stored copies overwritten: ' + changed.map((u) => u.replace(site.url + BASE, '')).join(', '));
        return 'Fuel · v' + v + '; ' + entries30.length + ' stored copies as the install stored them';
      });
      await seven('no signal: Fuel 3.0 from fuel-v1, its own files', async () => {
        site.down = true;
        try {
          const o = await openPage(p7, at('fuel/index.html'));
          const v = await shownVersion(o);
          await o.close();
          need(v === '3.0', 'Settings says Fuel · v' + v);
          return 'Fuel · v' + v;
        } finally { site.down = false; }
      });
      await seven('the food list (?db=) and the barcode reader (no ?v=) are still asked for first, and their stored copies refreshed', async () => {
        const db = (/const DB_URL = '([^']+)'/.exec(read(base, 'fuel/food.js')) || [])[1], dbUrl = new URL(db, at('fuel/')).href, zx = abs('../vendor/zxing/share.js');
        site.pages['data/foods.json'] = { type: TYPES['.json'], body: read(base, 'data/foods.json').replace(/\s*$/, '\n\n') };
        site.pages['vendor/zxing/share.js'] = { type: TYPES['.js'], body: read(base, 'vendor/zxing/share.js') + '\n/* newer */\n' };
        let got;
        try {
          f7 = await openPage(p7, at('fuel/index.html'));
          await f7.evaluate(([a, b]) => Promise.all([fetch(a).then((r) => r.text()), fetch(b).then((r) => r.text())]), [dbUrl, zx]);
          await sleep(800);
          got = await entryTexts(f7, now.cache, [dbUrl, zx]);
          await f7.close();
        } finally { delete site.pages['data/foods.json']; delete site.pages['vendor/zxing/share.js']; }
        need(/\n\n$/.test(got[dbUrl] || '') && /newer \*\/\n$/.test(got[zx] || ''), 'not refreshed: ' + [dbUrl, zx].filter((u) => got[u] == null || got[u] === read(base, new URL(u).pathname.slice(BASE.length))).join(', '));
        return db + ' and ../vendor/zxing/share.js refreshed from the server';
      });
      await seven('an install of 3.1 that gets 3.0\'s fuel.js is refused; fuel-v1 stays as it was', async () => {
        site.rules.length = 0;
        site.pages['fuel/fuel.js'] = { type: TYPES['.js'], body: read(base, 'fuel/fuel.js') };
        try {
          f7 = await openPage(p7, at('fuel/index.html'));
          const before = (await cachesOf(f7))[now.cache];
          const outcome = await updateEnds(f7, '/overload/fuel/');
          await settledReg(f7);
          const cs = await cachesOf(f7);
          await f7.close();
          need(outcome === 'redundant', 'the 3.1 worker ended as: ' + outcome);
          need(!cs['fuel-v2'] && JSON.stringify(cs[now.cache]) === JSON.stringify(before), 'caches: ' + Object.keys(cs).join(', '));
          return 'the 3.1 worker ended as ' + outcome + '; ' + now.cache + ' unchanged';
        } finally { delete site.pages['fuel/fuel.js']; }
      });
      await seven('good signal: 3.1 takes over (fuel-v2), the page reloads once into 3.1, and starts with no network', async () => {
        f7 = await openPage(p7, at('fuel/index.html'));
        const cs = await until(async () => { const c = await cachesOf(f7); return c['fuel-v2'] && !c[now.cache] ? c : null; }, 30000);
        need(cs, 'no fuel-v2; caches: ' + Object.keys(await cachesOf(f7).catch(() => ({}))).join(', '));
        need(await until(() => f7.loads >= 2, 10000), 'the page did not reload (loads: ' + f7.loads + ')');
        await f7.waitForFunction(fuelStarted, null, { timeout: 15000 });
        const v = await shownVersion(f7);
        const list31 = fuelFiles.map((f) => site.url + BASE + f + '?v=3.1');
        const got = await entryTexts(f7, 'fuel-v2', list31);
        const wrong = list31.filter((u) => got[u] !== read(next31, new URL(u).pathname.slice(BASE.length)));
        await f7.close();
        site.down = true;
        let off = null;
        try { const o = await openPage(p7, at('fuel/index.html')); off = await shownVersion(o); await o.close(); } finally { site.down = false; }
        need(v === '3.1' && off === '3.1', 'Settings says Fuel · v' + v + ', with no network v' + off);
        need(!wrong.length, 'not 3.1\'s in fuel-v2: ' + wrong.join(', '));
        return 'Fuel · v3.1, also with no network; ' + list31.length + ' stored copies are 3.1\'s';
      });
    }
    site.rules.length = 0; site.down = false;
    await p7.close();
  } catch (e) {
    run.say(false, 'fuel-sw', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | '));
  }
  for (const ph of phones) await ph.close().catch(() => {});
  await browser.close();
  await site.stop();
  run.done();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
