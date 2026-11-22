#!/usr/bin/env node
/* The training app's service worker (sw.js): the update from v2.8 and what it must leave alone.
 *
 *   node tests/train-sw.js [--tree=<folder>] [--port=8411]
 *
 * Real service workers in Chromium (contexts with service workers allowed), against a small server in this
 * file that serves a folder under /overload/ on 127.0.0.1, as GitHub Pages does, and can be switched to
 * another folder, made to fail or delay single addresses, or cut off ("no network").
 *
 * What must hold (SPEC section 3 item 10 and section 8; dev/notes/offline.md sections 2.2, 2.3, 2.5, 2.6):
 *   - starting from v2.8 (taken from git, commit 3b17963, into a temporary folder) with its worker installed
 *     and its cache filled, the server changes to 3.0: the 3.0 page arrives through the old worker, the new
 *     worker installs, every other cache named overload-… is deleted, a cache named fuel-v1 survives, and
 *     the page ends on 3.0. It then starts with no network.
 *   - nothing under fuel/, data/ or vendor/ is in the training cache, not from the install list and not from
 *     what a page asks for later.
 *   - a page under fuel/ that is missing, slow or unreachable is not answered with the training page.
 *   - when one file of the install list fails, the old worker and its cache stay as they were, and the next
 *     check completes the update.
 *   - a reminder's tap does not pick a window of the diet app (the choice is a function in sw.js, called here).
 *   - a file whose address carries ?v= is answered from the worker's own stored copy, also when the server has
 *     another file under that name (the server ignores ?v=, so after the next release it has); a file without
 *     ?v= is still asked for first; a stored copy that is missing is fetched and stored again; a main script
 *     from the network that names another release is neither run nor stored (review finding O1).
 *
 *   --tree=DIR   the folder to serve as 3.0. Default: the repo this file is in (the working tree). Give a copy
 *                when the tree's page and worker do not fit each other yet (a file one of them names is still
 *                to come): the install would fail for that reason alone.
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

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] == null ? true : m[2]] : [a, true]; }));
const PORT = Number(args.port) || 8411;
const BASE = '/overload/';
const V28_COMMIT = '3b17963';
const TREE = args.tree ? path.resolve(String(args.tree)) : lib.REPO;
const NOT_OURS = /\/overload\/(fuel|data|vendor)(\/|$)/;   // addresses the training cache must never hold
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };

let failed = 0, passed = 0;
function check(ok, label, detail) {
  if (ok) passed++; else failed++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  — ' + detail : ''));
  return !!ok;
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------
/**
 * Serves `site.root` under /overload/. site.down: every connection is dropped. site.rules: [{ test(rel, url),
 * status, delay }] for single addresses (rel is the path below /overload/). site.pages: { rel: { status, type,
 * body } } answered instead of a file. site.log: every address asked for.
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
      const page = site.pages[rel];
      if (page) { send(page.status || 200, page.type || TYPES['.html'], page.body); return; }
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
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
// Helpers
// ---------------------------------------------------------------------------
const temp = [];
process.on('exit', () => temp.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* leave it */ } }));
function extractV28() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overload-v28-')); temp.push(dir);
  execSync('git -C "' + lib.REPO + '" archive ' + V28_COMMIT + ' | tar -x -C "' + dir + '"', { stdio: ['ignore', 'ignore', 'inherit'] });
  if (!fs.existsSync(path.join(dir, 'sw.js'))) throw new Error('could not extract v2.8 (' + V28_COMMIT + ') from git');
  return dir;
}
// What a tree's worker says about itself: its cache name, its install list, its release.
function workerFacts(dir) {
  const text = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
  const cache = (/const CACHE = '([^']+)'/.exec(text) || [])[1];
  const block = (/const ASSETS = \[([\s\S]*?)\n\];/.exec(text) || [])[1] || '';
  const assets = block.split('\n').map((l) => /^\s*'([^']+)'/.exec(l)).filter(Boolean).map((m) => m[1]);
  const release = ((assets.find((a) => a.includes('?v=')) || '').split('?v=')[1]) || '';
  return { cache, assets, release };
}
const sleep = lib.sleep;
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
// { cache name: [addresses] } as the page sees Cache Storage (the worker's caches are the origin's).
const caches = (page) => page.evaluate(async () => { const out = {}; for (const k of await self.caches.keys()) out[k] = (await (await self.caches.open(k)).keys()).map((r) => r.url); return out; });
const pageFacts = (page) => page.evaluate(() => ({
  started: !!window.__overload,
  title: document.title,
  versions: [...document.querySelectorAll('script[src]')].map((s) => (/[?&]v=([^&#]+)/.exec(s.getAttribute('src')) || [])[1]).filter(Boolean),
  foodTab: !!document.querySelector('.tab[data-screen="food"]'),
  controlled: !!navigator.serviceWorker.controller
}));
const isRelease = (f, v) => !!f && f.started && f.versions.length > 0 && f.versions.every((x) => x === v);
// Asks the registration to look for a new worker and reports how that worker ends: 'activated', 'redundant'
// (its install failed), 'none' (the worker file did not change) or 'timeout'.
const updateOutcome = (page) => page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  let found = false;
  const end = new Promise((resolve) => {
    const watch = (w) => {
      if (!w) return; found = true;
      const look = () => { if (w.state === 'redundant' || w.state === 'activated') resolve(w.state); };
      w.addEventListener('statechange', look); look();
    };
    reg.addEventListener('updatefound', () => watch(reg.installing));
    watch(reg.installing);
  });
  await reg.update().catch(() => {});
  return Promise.race([end, new Promise((r) => setTimeout(() => r(found ? 'timeout' : 'none'), 20000))]);
});

// ---------------------------------------------------------------------------
(async () => {
  const v28 = extractV28();
  const old = workerFacts(v28), now = workerFacts(TREE);
  console.log('# 3.0 tree: ' + TREE + (TREE === lib.REPO ? ' (the working tree)' : ' (a copy)') + '; v2.8: git ' + V28_COMMIT);
  const site = await startSite(PORT);
  const at = (rel) => site.url + BASE + rel;
  const abs = (asset) => new URL(asset, at('')).href;
  // Pages under fuel/ that exist only in this test: they load a script of their own and two of the diet app's
  // shared files, and register no worker (so the training worker stays in charge of them).
  const probe = (title) => '<!doctype html><meta charset="utf-8"><title>' + title + '</title><p id="probe">' + title + '</p>'
    + '<script src="./__probe.js"></script><script>window.asked = Promise.all(["../data/foods.json?db=5&probe=1", "../vendor/zxing/share.js?probe=1", "../connector.json?probe=2"].map((u) => fetch(u).then((r) => r.status, () => 0)));</script>';
  site.pages['fuel/__probe.html'] = { body: probe('Fuel probe') };
  site.pages['fuel/__slow.html'] = { body: probe('Fuel slow probe') };
  site.pages['fuel/__probe.js'] = { type: TYPES['.js'], body: 'window.probeScript = true;' };
  site.rules.push({ test: (rel) => rel === 'fuel/__slow.html', delay: 4500 });
  const browser = await lib.launch();
  const fx = lib.loadFixture('v28-state-small');

  try {
    // ---- the install list itself ----
    check(now.cache && now.cache !== old.cache && /^overload-v\d+$/.test(now.cache) && Number(now.cache.slice(10)) === Number(old.cache.slice(10)) + 1,
      'sw.js: the cache name is the next one after v2.8\'s', old.cache + ' -> ' + now.cache);
    check(now.release === '3.0' && now.assets.filter((a) => a.includes('?v=')).every((a) => a.endsWith('?v=3.0')), 'sw.js: every versioned file in the install list carries ?v=3.0');
    check(!now.assets.some((a) => /(^|\/)food\.js|(^|\/)(fuel|data|vendor)\//.test(a)), 'sw.js: no food.js, data/ or vendor/ (nor fuel/) in the install list', now.assets.length + ' addresses, v2.8 had ' + old.assets.length);
    const missing = now.assets.filter((a) => { const rel = a.replace(/^\.\//, '').split('?')[0] || 'index.html'; return !fs.existsSync(path.join(TREE, rel)); });
    check(missing.length === 0, 'every file of the install list exists in the 3.0 tree', missing.join(', '));
    // A versioned file the page loads but the worker does not store would be missing on a start with no signal.
    const html = fs.readFileSync(path.join(TREE, 'index.html'), 'utf8');
    const loaded = (html.match(/(?:src|href)="[^"]*\?v=[^"]*"/g) || []).map((m) => m.replace(/^[a-z]+="|"$/g, '').replace(/^\.\//, ''));
    const unlisted = loaded.filter((u) => !now.assets.some((a) => a.replace(/^\.\//, '') === u));
    check(loaded.length > 0 && unlisted.length === 0, 'every versioned file index.html loads is in the install list', loaded.length + ' files' + (unlisted.length ? ', not listed: ' + unlisted.join(', ') : ''));

    // =====================================================================
    // Phone 1: the update from v2.8, with good signal
    // =====================================================================
    site.root = v28;
    const phone = await lib.newPhone(browser, { serviceWorkers: 'allow' });
    await lib.seedV28(phone.context, fx);
    let page = await lib.openApp(phone.context, at('index.html'));
    let cs = await until(async () => { const c = await caches(page); return c[old.cache] && c[old.cache].length >= old.assets.length && (await pageFacts(page)).controlled ? c : null; }, 30000);
    check(!!cs && old.assets.every((a) => cs[old.cache].includes(abs(a))), 'v2.8: its worker is installed and ' + old.cache + ' holds its ' + old.assets.length + ' files', cs ? cs[old.cache].length + ' entries' : 'the cache never filled');
    await page.reload(); await page.waitForFunction(() => !!window.__overload);
    let facts = await pageFacts(page);
    check(isRelease(facts, '2.8') && facts.controlled && facts.foodTab, 'v2.8 runs under its own worker (Food tab and all)', 'files ?v=' + facts.versions[0]);
    // Two caches that are not this release's: one of the diet app, one stray with the training prefix.
    await page.evaluate(async () => {
      await (await self.caches.open('fuel-v1')).put('/overload/fuel/keep.txt', new Response('the diet app\'s'));
      await (await self.caches.open('overload-old')).put('/overload/old.txt', new Response('a leftover'));
    });
    // Control: the fault this release removes must be there under the v2.8 worker, or the checks below prove nothing.
    const control = await phone.context.newPage();
    let resp = await control.goto(at('fuel/__missing.html'));
    check((await control.title()) === 'Overload' && !(await control.$('#server-404')), 'control: the v2.8 worker answers a missing page under fuel/ with the training page', 'status ' + resp.status() + ', title "' + (await control.title()) + '"');
    let t0 = Date.now();
    await control.goto(at('fuel/__slow.html'));
    check((await control.title()) === 'Overload' && Date.now() - t0 < 4300, 'control: the v2.8 worker answers a slow page under fuel/ with the training page after 3 s', (Date.now() - t0) + ' ms, title "' + (await control.title()) + '"');
    await control.goto(at('fuel/__probe.html')); await control.evaluate(() => window.asked); await sleep(500);
    cs = await caches(page);
    check(cs[old.cache].some((u) => NOT_OURS.test(u) && /probe/.test(u)), 'control: the v2.8 worker stores what a page under fuel/ loads in the training cache', cs[old.cache].filter((u) => /probe/.test(u)).length + ' probe entries');
    await control.close();

    // ---- the server now has 3.0 ----
    site.root = TREE; site.log.length = 0;
    let loads = 0; page.on('load', () => { loads++; });
    await page.reload();
    const arrived = await until(async () => { const f = await pageFacts(page); return isRelease(f, now.release) ? f : null; }, 20000);
    check(!!arrived, '3.0 arrives: the page served through the v2.8 worker runs the 3.0 files', arrived ? 'files ?v=' + arrived.versions[0] : 'the page did not start as 3.0');
    cs = await until(async () => { const c = await caches(page); return c[now.cache] && !c[old.cache] && (await pageFacts(page)).controlled ? c : null; }, 30000);
    check(!!cs, 'the new worker installs and takes over: ' + now.cache + ' is there', cs ? cs[now.cache].length + ' entries' : 'no ' + now.cache + ' after 30 s; caches: ' + Object.keys(await caches(page).catch(() => ({}))).join(', '));
    cs = cs || (await caches(page));
    check(!cs[old.cache] && !cs['overload-old'], 'old caches are deleted: ' + old.cache + ' and overload-old are gone', 'caches now: ' + Object.keys(cs).join(', '));
    check(!!cs['fuel-v1'] && cs['fuel-v1'].length === 1 && /fuel\/keep\.txt$/.test(cs['fuel-v1'][0]), 'the cache fuel-v1 survives the training release, with its content');
    check(!!cs[now.cache] && now.assets.every((a) => cs[now.cache].includes(abs(a))), now.cache + ' holds every file of the install list', cs[now.cache] ? cs[now.cache].length + ' entries for ' + now.assets.length + ' addresses' : '');
    check(!!cs[now.cache] && !cs[now.cache].some((u) => NOT_OURS.test(u) || /\/food\.js/.test(u)), 'nothing under fuel/, data/ or vendor/ (and no food.js) is in ' + now.cache + ' after the install');
    // The page reloads itself when the new worker takes over, unless it holds the reload back (a workout, a box being typed in, a sheet).
    const self2 = await until(() => loads >= 2, 8000);
    if (!self2) await page.reload();
    facts = await until(async () => { const f = await pageFacts(page); return isRelease(f, now.release) && f.controlled ? f : null; }, 15000);
    check(!!facts && !facts.foodTab, 'the page ends on 3.0 under the new worker (no Food tab)', (self2 ? 'the page reloaded itself' : 'the page held its reload back; reloaded by the test') + (facts ? ', files ?v=' + facts.versions[0] : ''));
    const kept = JSON.parse(await lib.readStorageText(page, lib.STATE_KEY));
    check(JSON.stringify(kept.food) === JSON.stringify(fx.state.food) && JSON.stringify(kept.diary) === JSON.stringify(fx.state.diary), 'the saved data came through the update: food and diary of the fixture, byte for byte');

    // ---- what the 3.0 worker does with the diet app's addresses ----
    await page.evaluate(() => fetch('./connector.json?probe=1').then((r) => r.status));
    const direct = await page.evaluate(() => Promise.all(['./data/foods.json?db=5', './vendor/zxing/share.js', './vendor/zxing/zxing_reader.wasm'].map((u) => fetch(u).then((r) => r.status, () => 0))));
    const fuelPage = await phone.context.newPage();
    resp = await fuelPage.goto(at('fuel/__probe.html'));
    const asked = await fuelPage.evaluate(() => window.asked);
    const fuelFacts = await fuelPage.evaluate(() => ({ title: document.title, script: !!window.probeScript, controlled: !!navigator.serviceWorker.controller }));
    check(resp.status() === 200 && fuelFacts.title === 'Fuel probe' && fuelFacts.script, 'a page under fuel/ loads from the network with its own script', 'controlled by the training worker: ' + fuelFacts.controlled);
    check(direct.every((s) => s === 200) && asked.every((s) => s === 200), 'the food list and the barcode reader still reach the pages that ask for them (through no worker)', 'statuses ' + direct.concat(asked).join(' '));
    await sleep(700);   // the worker stores after it has answered
    cs = await caches(page);
    check(cs[now.cache].some((u) => /connector\.json\?probe=1$/.test(u)) && cs[now.cache].some((u) => /connector\.json\?probe=2$/.test(u)), 'control: the 3.0 worker does store other files its pages load (connector.json, asked by both pages)');
    check(!cs[now.cache].some((u) => NOT_OURS.test(u)), 'nothing under fuel/, data/ or vendor/ is stored in the training cache, whoever asked', cs[now.cache].filter((u) => NOT_OURS.test(u)).join(', '));
    check(!!cs['fuel-v1'] && cs['fuel-v1'].length === 1, 'and the diet app\'s cache was not written to');

    resp = await fuelPage.goto(at('fuel/__missing.html'));
    check(resp.status() === 404 && !!(await fuelPage.$('#server-404')) && (await fuelPage.title()) !== 'Overload' && !(await fuelPage.$('#app')), 'a missing page under fuel/ is the server\'s own 404, not the training page', 'status ' + resp.status() + ', title "' + (await fuelPage.title()) + '"');
    t0 = Date.now();
    resp = await fuelPage.goto(at('fuel/__slow.html'));
    check((await fuelPage.title()) === 'Fuel slow probe' && Date.now() - t0 >= 4400, 'a slow page under fuel/ arrives as itself after its 4.5 s, not as the training page after 3 s', (Date.now() - t0) + ' ms, title "' + (await fuelPage.title()) + '"');

    // ---- a reminder's tap ----
    const worker = phone.context.serviceWorkers().find((w) => w.url() === at('sw.js'));
    const picks = worker ? await worker.evaluate(() => {
      const s = self.registration.scope;
      return { page: isAppWindow(s + 'index.html'), root: isAppWindow(s), lab: isAppWindow(s + 'lab/scan.html'), fuel: isAppWindow(s + 'fuel/index.html'), fuelRoot: isAppWindow(s + 'fuel/'), elsewhere: isAppWindow(self.location.origin + '/othersite/') };
    }).catch((e) => ({ error: String(e) })) : { error: 'no worker object' };
    check(picks.page === true && picks.root === true && picks.fuel === false && picks.fuelRoot === false && picks.elsewhere === false, 'a reminder\'s tap picks a window of the training app, never one under fuel/', JSON.stringify(picks));

    // ---- no network ----
    site.down = true;
    const off = await phone.context.newPage();
    let offFacts = null;
    try { await off.goto(at('index.html')); await off.waitForFunction(() => !!window.__overload, null, { timeout: 15000 }); offFacts = await pageFacts(off); } catch (e) { offFacts = null; }
    check(isRelease(offFacts, now.release), 'offline start works: 3.0 starts from ' + now.cache + ' with no network', offFacts ? 'files ?v=' + offFacts.versions[0] : 'the app did not start');
    try { await off.goto(at('')); await off.waitForFunction(() => !!window.__overload, null, { timeout: 15000 }); offFacts = await pageFacts(off); } catch (e) { offFacts = null; }
    check(isRelease(offFacts, now.release), 'offline start works for the folder address too (/overload/)');
    let gone = null;
    try { await fuelPage.goto(at('fuel/__other.html'), { timeout: 10000 }); gone = { title: await fuelPage.title(), app: !!(await fuelPage.$('#app')) }; } catch (e) { gone = { error: String(e.message).split('\n')[0] }; }
    check(!!gone.error || (gone.title !== 'Overload' && !gone.app), 'with no network a page under fuel/ is the browser\'s own error, not the training page', gone.error || 'title "' + gone.title + '"');
    site.down = false;
    await phone.close();

    // =====================================================================
    // Phone 2: one file of the install list fails
    // =====================================================================
    site.root = v28;
    const phone2 = await lib.newPhone(browser, { serviceWorkers: 'allow' });
    await lib.seedV28(phone2.context, fx);
    let page2 = await lib.openApp(phone2.context, at('index.html'));
    await until(async () => { const c = await caches(page2); return c[old.cache] && c[old.cache].length >= old.assets.length && (await pageFacts(page2)).controlled; }, 30000);
    const before = (await caches(page2))[old.cache].slice().sort();
    site.root = TREE;
    const failing = now.assets.find((a) => /overload\.js/.test(a)) || now.assets[2];
    const failRule = { test: (rel, u) => abs(failing) === site.url + u.pathname + u.search, status: 503 };
    site.rules.push(failRule);
    let outcome = await updateOutcome(page2);
    check(outcome === 'redundant', 'one file of the install list fails (' + failing + ' answers 503): the new worker\'s install fails', 'the new worker ended as: ' + outcome);
    cs = await caches(page2);
    check(!cs[now.cache] && !!cs[old.cache] && JSON.stringify(cs[old.cache].slice().sort()) === JSON.stringify(before), 'the old cache is in place, entry for entry, and no ' + now.cache + ' is left behind', 'caches: ' + Object.keys(cs).join(', '));
    const regs = await page2.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { active: r.active && r.active.state, waiting: !!r.waiting, installing: !!r.installing }; });
    check(regs.active === 'activated' && !regs.waiting && !regs.installing, 'the old worker is still the active one, nothing waiting', JSON.stringify(regs));
    site.down = true;
    const off2 = await phone2.context.newPage();
    let f2 = null;
    try { await off2.goto(at('index.html')); await off2.waitForFunction(() => !!window.__overload, null, { timeout: 15000 }); f2 = await pageFacts(off2); } catch (e) { f2 = null; }
    check(isRelease(f2, old.release) && f2.foodTab, 'and with no network the phone still starts v2.8 from it', f2 ? 'files ?v=' + f2.versions[0] : 'the app did not start');
    await off2.close();
    site.down = false;
    site.rules.splice(site.rules.indexOf(failRule), 1);
    // The next check, with every file answering.
    await page2.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update())).catch(() => {});
    cs = await until(async () => { const c = await caches(page2); return c[now.cache] && !c[old.cache] ? c : null; }, 30000);
    check(!!cs && now.assets.every((a) => cs[now.cache].includes(abs(a))), 'the next update check, with every file answering, completes the update', cs ? 'caches: ' + Object.keys(cs).join(', ') : 'no ' + now.cache + ' after 30 s');
    await phone2.close();

    // =====================================================================
    // Phone 3: a file with ?v= comes from the worker's own copy; the network only when there is none
    // =====================================================================
    // The server ignores ?v=: after the next release it answers this release's addresses with the next release's
    // files. The stand-in for that is a changed file under the same name (site.pages).
    site.root = TREE;
    const main = now.assets.find((a) => /overload\.js\?v=/.test(a)) || '';
    const mainRel = main.replace(/^\.\//, '').split('?')[0] || 'overload.js', css = now.assets.find((a) => /train\.css\?v=/.test(a)) || '';
    const cssRel = css.replace(/^\.\//, '').split('?')[0] || 'train.css';
    const readOr = (rel) => { try { return fs.readFileSync(path.join(TREE, rel), 'utf8'); } catch (e) { return ''; } };
    const realMain = readOr(mainRel), realCss = readOr(cssRel);
    const nextMain = realMain.replace("const VERSION = '" + now.release + "'", "const VERSION = '9.9'");
    const phone3 = await lib.newPhone(browser, { serviceWorkers: 'allow' });
    await lib.seedV28(phone3.context, fx);
    const page3 = await lib.openApp(phone3.context, at('index.html'));
    cs = await until(async () => { const c = await caches(page3); return c[now.cache] && now.assets.every((a) => c[now.cache].includes(abs(a))) && (await pageFacts(page3)).controlled ? c : null; }, 30000);
    check(!!cs && !!main && !!css, 'set-up: this tree installed under its own worker (' + now.cache + ')', main + ', ' + css);
    const entry = (page, url) => page.evaluate(async ([name, u]) => { const r = await (await self.caches.open(name)).match(u); return r ? r.text() : null; }, [now.cache, url]);
    const shown = async (page) => { await lib.openTab(page, 'settings'); return page.$eval('#app p.version', (e) => e.textContent).catch(() => null); };
    site.pages[mainRel] = { type: TYPES['.js'], body: nextMain };
    site.pages[cssRel] = { type: TYPES['.css'], body: realCss + '\n/* the next release */\n' };
    site.pages['icon.svg'] = { type: TYPES['.svg'], body: '<svg xmlns="http://www.w3.org/2000/svg"><!-- the next release --></svg>' };
    site.log.length = 0;
    await page3.reload(); await page3.waitForFunction(() => !!window.__overload);
    await page3.evaluate(() => fetch('./icon.svg').then((r) => r.text()));   // a file without ?v=, as the page's icon link asks for it
    await sleep(700);
    const askedV = site.log.filter((u) => /\?v=/.test(u));
    check((await shown(page3)) === 'Overload · v' + now.release && !askedV.length, 'the server answering ' + mainRel + ' and ' + cssRel + ' with other files: the page runs the stored copies and asks the server for no file with ?v=', 'asked: ' + (askedV.join(', ') || 'none'));
    check((await entry(page3, abs(main))) === realMain && (await entry(page3, abs(css))) === realCss, 'the stored ' + mainRel + ' and ' + cssRel + ' are still as the install stored them');
    check(/the next release/.test((await entry(page3, abs('./icon.svg'))) || ''), 'a file without ?v= is still asked for first, and its stored copy refreshed (network first, as before)');
    delete site.pages[cssRel];
    await page3.evaluate(([name, u]) => self.caches.open(name).then((c) => c.delete(u)), [now.cache, abs(css)]);
    await page3.reload(); await page3.waitForFunction(() => !!window.__overload);
    await sleep(700);
    check((await entry(page3, abs(css))) === realCss && await page3.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].every((l) => l.sheet && l.sheet.cssRules.length > 0)), 'a stored copy that is missing is taken from the network and stored again', cssRel);
    await page3.evaluate(([name, u]) => self.caches.open(name).then((c) => c.delete(u)), [now.cache, abs(main)]);
    let gaveUp = null;
    try {
      await page3.goto(at('index.html'));
      await page3.waitForFunction(() => { const n = document.getElementById('boot-note'); return (n && /did not finish starting/.test(n.textContent)) || !!window.__overload; }, null, { timeout: 15000 });
      gaveUp = await page3.evaluate(() => ({ started: !!window.__overload, note: (document.getElementById('boot-note') || {}).textContent || '' }));
    } catch (e) { gaveUp = { error: String(e.message).split('\n')[0] }; }
    check(!!gaveUp && gaveUp.started === false && /did not finish starting/.test(gaveUp.note), 'the main script missing, and the server\'s naming another release: that file is not run (the page says it did not finish starting)', JSON.stringify(gaveUp).slice(0, 160));
    check((await entry(page3, abs(main))) === null && (await lib.readStorageText(page3, lib.STATE_KEY)) !== null, '... and not stored; the saved data is still there');
    delete site.pages[mainRel]; delete site.pages['icon.svg'];
    await page3.goto(at('index.html')); await page3.waitForFunction(() => !!window.__overload, null, { timeout: 15000 });
    await sleep(700);
    check((await entry(page3, abs(main))) === realMain && (await shown(page3)) === 'Overload · v' + now.release, 'with the right file on the server again, the next start runs it and stores it');
    await phone3.close();
  } catch (e) {
    check(false, 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | '));
  }
  await browser.close();
  await site.stop();
  console.log('# ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
