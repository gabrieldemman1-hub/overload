#!/usr/bin/env node
/* A release on weak signal: the page that runs is one release, never a mix (review findings U1, U2, O1).
 *
 *   node tests/train-mixed.js [--tree=<folder>] [--port=8413] [--only=v28|mix|sync28|v30]
 *
 * GitHub Pages ignores ?v=: once a release is published, every address of the previous one is answered with
 * the new release's file of the same name. A worker that asks the network first and stores what it gets
 * (v2.8's, on the phone and unchangeable) then runs the new files in the old stored page and keeps them under
 * the old names. Real service workers in Chromium, against a small server in this file that serves a folder
 * under /overload/ as Pages does (by path, ignoring the query), can delay or fail single addresses ("weak
 * signal") or drop every connection ("no signal"). The cloud is tests/fake-firebase.
 *
 * v28   v2.8 (git 3b17963) installed under its own worker and signed in to cloud sync; then the server has
 *       this tree. Starts with the page slower than 3 s (v2.8's worker answers with its stored page), with the
 *       scripts fast and with every script slow, with the page fast, and with no signal: the page that runs is
 *       pure v2.8 (main script, stylesheet and food.js all v2.8's) or pure 3.0, never a mix; v2.8's stored
 *       page, app.js, styles.css and food.js keep v2.8's bytes. sync.js, connector.js, programs.js and
 *       backup.js keep their names in 3.0, so a v2.8 page can get 3.0's copies of them: that combination is
 *       tested in tests/train-sync.js --base=v28 and is only listed here. Then 3.0 takes over, and Copy plus
 *       Remove the old food log leave the account's food log as it was.
 * mix   the mix of finding U1 built as a folder (v2.8's page and sync.js with 3.0's main script), which the
 *       worker can no longer produce: signed in, Remove refuses ("Finish the update first ...") and the
 *       account keeps every food day.
 * sync28 (round 4, rel#6) this tree's page with v2.8's sync.js, as 2.8's worker hands it out from a stale edge:
 *       signed in after a Remove made on 3.0, the module is given nothing and sends nothing (2.8's would bring the
 *       old food log back onto the phone), the cloud card says sync is not available, the line at the top says part
 *       did not load; the next start of 3.0 whole sends what was logged meanwhile. Round 5, pill#1: going offline
 *       and online in that start shows no sync pill in the top bar (2.8's module reports 'Synced' then). Round 5,
 *       v28#1: a phone signed in on 3.0 whose first read failed (no note) gets v2.8's sync.js: Reset asks nothing
 *       and changes nothing ("Cloud sync is not available right now. ..."); after the next start of 3.0 whole has
 *       read the account, it asks with the account and reaches it.
 * v30  this tree installed under its own worker, then a 3.1 made with bump.sh in a temporary copy (every
 *       script and stylesheet of it made different from 3.0's): with the page slow the stored 3.0 page runs
 *       only 3.0's files, also with no signal, and the stored 3.0 copies are not overwritten; with the page
 *       fast 3.1 runs whole; when 3.1's main script does not arrive the start-up rescue runs the stored 3.0
 *       whole; an install whose main script, sync module, stylesheet or backup.js is not 3.1's is refused (since
 *       the final review every versioned file names its release: upgrade#1); then 3.1 takes over and starts with
 *       no signal. This phone is sealed (tests/lib.js): no Playwright routing, which makes Chromium install the
 *       same worker again at every update check; it never signs in, so it needs no stand-in Firebase. Each start
 *       is a cold one (nothing in the browser's memory cache), and no worker file is installed twice.
 *   --tree=DIR   the folder to serve as 3.0. Default: the repo this file is in (the working tree).
 * Prints one PASS or FAIL line per check; exit code 1 when a check failed. No server is left running.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const lib = require('./lib');
const T = require('./train-common');
const { createCloud } = require('./fake-firebase/route');

const args = T.args();
const PORT = Number(args.port) || 8413;
const BASE = '/overload/';
const TREE = args.tree ? path.resolve(String(args.tree)) : lib.REPO;
const ONLY = args.only ? String(args.only) : '';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
const run = T.runner('train-mixed');
const { need, same } = run;
const sleep = lib.sleep;
const fx = lib.loadFixture('v28-state-small');
const EMAIL = 'me@example.com', PASSWORD = 'secret1';
// Names a v2.8 page asks for that 3.0 keeps (a v2.8 page may get 3.0's copy of these; see above).
const KEPT = ['sync.js', 'connector.js', 'programs.js', 'backup.js'];
const UPDATE_FIRST = 'Finish the update first: open Overload once with good signal, then try again.';

// ---------------------------------------------------------------------------
// The server: by path, ignoring the query, as GitHub Pages does
// ---------------------------------------------------------------------------
function startSite(port) {
  const site = { root: null, down: false, rules: [], log: [], url: lib.LOCAL + ':' + port };
  const server = http.createServer((req, res) => {
    if (site.down) { req.socket.destroy(); return; }
    const u = new URL(req.url, site.url);
    site.log.push(u.pathname + u.search);
    const send = (status, type, body) => { if (site.down) { req.socket.destroy(); return; } res.writeHead(status, { 'content-type': type, 'cache-control': 'max-age=600' }); res.end(body); };
    if (!u.pathname.startsWith(BASE)) { send(404, 'text/plain', 'outside the site'); return; }
    let rel = decodeURIComponent(u.pathname.slice(BASE.length));
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const rule = site.rules.find((r) => r.on !== false && r.test(rel, u));
    const answer = () => {
      if (rule && rule.status) { send(rule.status, 'text/plain', 'test server: ' + rule.status); return; }
      if (rule && rule.body != null) { send(200, TYPES[path.extname(rel)] || 'text/plain', rule.body); return; }
      const file = path.join(site.root, rel);
      let ok = file.startsWith(site.root + path.sep);
      try { ok = ok && fs.statSync(file).isFile(); } catch (e) { ok = false; }
      if (!ok) { send(404, TYPES['.html'], '<!doctype html><title>404</title><p>The server has no such page.</p>'); return; }
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
  execSync('git -C "' + lib.REPO + '" archive ' + T.V28 + ' | tar -x -C "' + dir + '"', { stdio: ['ignore', 'ignore', 'inherit'] });
  if (!/const VERSION = '2\.8'/.test(fs.readFileSync(path.join(dir, 'app.js'), 'utf8'))) throw new Error('could not extract v2.8 (' + T.V28 + ') from git');
  return dir;
}
const SKIP = new Set(['.git', '.github', 'tests', 'dev', 'node_modules', 'tools', 'connector']);
function copyTree(from) {
  const dir = tempDir('overload-mixed-');
  fs.cpSync(from, dir, { recursive: true, filter: (src) => { const rel = path.relative(from, src); return !rel || !SKIP.has(rel.split(path.sep)[0]); } });
  return dir;
}
const read = (dir, rel) => { try { return fs.readFileSync(path.join(dir, rel)); } catch (e) { return null; } };
// The versioned files a page loads, as paths below the site: ['programs.js', 'shared/ui.css', ...]
const pageFiles = (dir) => [...read(dir, 'index.html').toString().matchAll(/(?:src|href)="\.\/([^"?]+)\?v=/g)].map((m) => m[1]);
// The main script of a tree: the file of its page that holds  const VERSION = '…'.
const mainOf = (dir) => pageFiles(dir).find((f) => /const VERSION = '/.test(String(read(dir, f) || ''))) || '';
const cacheOf = (dir) => (/const CACHE = '([^']+)'/.exec(read(dir, 'sw.js').toString()) || [])[1];
const assetsOf = (dir) => ((/const ASSETS = \[([\s\S]*?)\n\];/.exec(read(dir, 'sw.js').toString()) || [])[1] || '').split('\n').map((l) => /^\s*'([^']+)'/.exec(l)).filter(Boolean).map((m) => m[1]);

// ---------------------------------------------------------------------------
// What a page ran
// ---------------------------------------------------------------------------
/** Records the body of the page itself and of every script and stylesheet of the site it loads. */
function watch(page, site) {
  const seen = [];
  page.on('response', (r) => {
    const type = r.request().resourceType();
    if (!['document', 'script', 'stylesheet'].includes(type)) return;
    const u = new URL(r.url());
    if (u.origin !== site.url || !u.pathname.startsWith(BASE)) return;
    let rel = u.pathname.slice(BASE.length); if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    seen.push(r.body().then((body) => ({ rel, search: u.search, type, status: r.status(), sw: r.fromServiceWorker(), body }), () => null));
  });
  page.ran = () => Promise.all(seen).then((l) => l.filter(Boolean));
}
/**
 * Which release each file a page got is: the releases ({ name, dir }) whose file of that path has exactly those
 * bytes. { page, files: [{ rel, of: [names] }], mixed: [...], kept: [...] }: `mixed` lists the files that are
 * not of the page's release; `kept` those of KEPT that a v2.8 page got from 3.0 (allowed, listed).
 */
function verdict(list, releases) {
  const of = (rel, body) => releases.filter((r) => { const b = read(r.dir, rel); return b && b.equals(body); }).map((r) => r.name);
  const doc = list.filter((x) => x.type === 'document').pop();
  const pageOf = doc ? of(doc.rel, doc.body) : [];
  const page = pageOf.length === 1 ? pageOf[0] : pageOf.join('|') || '?';
  const files = list.filter((x) => x.type !== 'document').map((x) => ({ rel: x.rel, of: of(x.rel, x.body), status: x.status }));
  const mixed = files.filter((f) => !f.of.includes(page) && !(page === '2.8' && KEPT.includes(f.rel) && f.of.length));
  const kept = files.filter((f) => page === '2.8' && KEPT.includes(f.rel) && !f.of.includes('2.8'));
  return { page, files, mixed, kept, text: 'page ' + page + ': ' + files.map((f) => f.rel + '=' + (f.of.join('|') || '?')).join(', ') };
}
const settingsLine = async (page) => { await lib.openTab(page, 'settings'); return T.text(page, '#app p.version, #app p.tiny.center'); };

// ---------------------------------------------------------------------------
// Service workers
// ---------------------------------------------------------------------------
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
const cachesOf = (page) => page.evaluate(async () => { const out = {}; for (const k of await self.caches.keys()) out[k] = (await (await self.caches.open(k)).keys()).map((r) => r.url); return out; });
/** The text of some entries of one cache: { url: text or null }. */
const storedTexts = (page, cache, urls) => page.evaluate(async ([name, list]) => {
  const c = await caches.open(name), out = {};
  for (const u of list) { const r = await c.match(u); out[u] = r ? await r.text() : null; }
  return out;
}, [cache, urls]);
const updateOutcome = (page) => page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  let found = false;
  const end = new Promise((resolve) => {
    const watchIt = (w) => { if (!w) return; found = true; const look = () => { if (w.state === 'redundant' || w.state === 'activated') resolve(w.state); }; w.addEventListener('statechange', look); look(); };
    reg.addEventListener('updatefound', () => watchIt(reg.installing));
    watchIt(reg.installing);
  });
  await reg.update().catch(() => {});
  return Promise.race([end, new Promise((r) => setTimeout(() => r(found ? 'timeout' : 'none'), 25000))]);
});

(async () => {
  const site = await startSite(PORT);
  const at = (rel) => site.url + BASE + rel;
  const browser = await lib.launch({ sealed: true });
  const cloud = createCloud();
  const v28 = extractV28();
  const MAIN = mainOf(TREE);
  console.log('# 3.0 tree: ' + TREE + (TREE === lib.REPO ? ' (the working tree)' : ' (a copy)') + ', main script ' + MAIN + '; v2.8: git ' + T.V28);
  const phones = [];
  // What the server hands out now under an address (noted for each worker version a sealed phone makes).
  const served = (u) => {
    const url = new URL(u); let rel = url.pathname.slice(BASE.length); if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const r = site.rules.find((x) => x.on !== false && x.test(rel, url));
    return r && r.body != null ? String(r.body) : String(read(site.root, rel));
  };
  // A phone: its own storage with service workers allowed, the fixture as v2.8 left it, the stand-in cloud.
  // opts.sealed: no routing and no stand-in cloud (it never signs in); phone.workers counts its worker versions.
  async function makePhone(name, opts) {
    const phone = await lib.newPhone(browser, Object.assign({ serviceWorkers: 'allow', timezoneId: fx.meta.tz }, opts || {}));
    if (phone.sealed) phone.workers = await lib.watchWorkers(phone.context, served);
    else phone.device = await cloud.attach(phone.context, name);
    await phone.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    if (!(opts && opts.empty)) await lib.seedV28(phone.context, fx);
    // Before any script of a page: when the worker in control changed, and when the app registered its worker.
    await phone.context.addInitScript(() => {
      if (window.top !== window || !navigator.serviceWorker) return;
      const t0 = performance.now();
      window.__events = ['load under ' + (navigator.serviceWorker.controller ? 'a worker' : 'no worker')];
      navigator.serviceWorker.addEventListener('controllerchange', () => window.__events.push('controllerchange at ' + Math.round(performance.now() - t0) + ' ms'));
      const reg = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = (...a) => { window.__events.push('register at ' + Math.round(performance.now() - t0) + ' ms'); return reg(...a); };
    });
    phones.push(phone);
    return phone;
  }
  // Opens the app (or anything that says something) and records what it ran.
  async function open(phone, rel, ready) {
    const page = phone.sealed ? await lib.coldPage(phone.context) : await phone.context.newPage();
    page.dialogs = [];
    page.on('dialog', (d) => { page.dialogs.push(d.message()); d.accept().catch(() => {}); });
    page.loads = 0; page.on('load', () => { page.loads++; });
    watch(page, site);
    await page.goto(at(rel || 'index.html'), { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(ready || (() => !!window.__overload), null, { timeout: 30000 });
    return page;
  }
  // Sync pushes a second after a save: wait until the cloud's log stops growing.
  async function settle() { let n = -1; for (let i = 0; i < 12 && cloud.log.length !== n; i++) { n = cloud.log.length; await sleep(1400); await cloud.idle(); } }
  // Rules of the weak signal: switched on and off by their `on` flag.
  const rule = (r) => { r.on = false; site.rules.push(r); return r; };
  // The network for the next start: 'down' (no signal) and the rules that apply; every other rule is off.
  const net = (...on) => { site.down = on.includes('down'); site.rules.forEach((r) => { r.on = on.includes(r); }); };
  const daysIn = (uid) => cloud.paths('users/' + uid + '/foodDays').length;
  const N = Object.keys(fx.state.diary).length;

  try {
    // =====================================================================
    // v2.8 on the phone, then this tree is published
    // =====================================================================
    if (!ONLY || ONLY === 'v28') {
      const R = [{ name: '2.8', dir: v28 }, { name: '3.0', dir: TREE }];
      const step = (title, fn) => run.step('v2.8 -> 3.0', title, fn);
      const slowPage = rule({ test: (rel) => rel === 'index.html', delay: 4000 });
      const slowScripts = rule({ test: (rel) => /\.(js|css)$/.test(rel) && !/(^|\/)sw\.js$/.test(rel), delay: 4000 });
      const noInstall = rule({ test: (rel) => rel === 'icon-512.png', status: 404 });   // one file of the new install list: 3.0's worker cannot take over yet
      const phone = await makePhone('A');
      site.root = v28;
      let uid = null, page = null;
      let ok = await step('set-up: v2.8 installed under its own worker, signed in; the account holds the food log', async () => {
        page = await open(phone);
        const want = assetsOf(v28).map((a) => new URL(a, at('')).href);
        need(await until(async () => { const c = await cachesOf(page); return c['overload-v23'] && want.every((u) => c['overload-v23'].includes(u)) && (await page.evaluate(() => !!navigator.serviceWorker.controller)); }, 30000), 'v2.8\'s worker did not install');
        await page.waitForFunction(() => !!window.__overloadSync, null, { timeout: 15000 });
        await page.evaluate(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL, PASSWORD]);
        await settle();
        uid = phone.device.user();
        uid = uid && uid.uid;
        need(uid && daysIn(uid) === N, 'food days in the account: ' + (uid ? daysIn(uid) : 'no account'));
        await page.close();
        return 'overload-v23; ' + N + ' food days in the account of ' + uid;
      });
      if (ok) {
        site.root = TREE;
        const V28_NAMES = ['index.html', '', 'app.js?v=2.8', 'styles.css?v=2.8', 'food.js?v=2.8'].map(at);
        const pristine = {};
        V28_NAMES.forEach((u) => { const rel = new URL(u).pathname.slice(BASE.length).replace(/^$/, 'index.html'); pristine[u] = read(v28, rel).toString(); });
        const pureV28 = async (title, pg) => {
          const v = verdict(await pg.ran(), R);
          need(v.page === '2.8', 'the page that ran is ' + v.page + ' (' + v.text + ')');
          need(!v.mixed.length, 'a mix: ' + v.mixed.map((f) => f.rel + ' is ' + (f.of.join('|') || 'neither')).join(', ') + ' in the v2.8 page');
          const line = await settingsLine(pg);
          need(line === 'Overload · v2.8', 'Settings says "' + line + '"');
          need((await lib.tabNames(pg)).includes('food') && !(await T.count(pg, '[data-action="handover-remove"]')), 'not v2.8\'s screens');
          return title + v.files.map((f) => f.rel + ' ' + (f.of.join('|') || '?')).join(', ') + (v.kept.length ? '; 3.0\'s under the v2.8 name: ' + v.kept.map((f) => f.rel).join(', ') : '');
        };
        await step('weak signal, the page over 3 s and the scripts fast: the page that runs is pure v2.8', async () => {
          net(slowPage, noInstall);
          page = await open(phone);
          const said = await pureV28('', page);
          await lib.openTab(page, 'food');
          need(await page.evaluate(() => document.querySelector('.tab.active').dataset.screen === 'food' && document.querySelectorAll('.f-meal').length > 0), 'v2.8\'s Food tab does not draw');
          await page.close();
          return said;
        });
        await step('weak signal, the page and every script over 3 s: pure v2.8 again', async () => {
          net(slowPage, slowScripts, noInstall);
          page = await open(phone);
          const said = await pureV28('', page);
          await sleep(6000);   // the late answers arrive, and v2.8's worker stores the good ones
          await page.close();
          return said;
        });
        await step('v2.8\'s stored page, app.js, styles.css and food.js still hold v2.8\'s bytes', async () => {
          net(slowPage, slowScripts, noInstall);
          page = await open(phone);
          const now = await storedTexts(page, 'overload-v23', V28_NAMES);
          const changed = V28_NAMES.filter((u) => now[u] !== pristine[u]);
          need(!changed.length, 'overwritten: ' + changed.map((u) => u.replace(site.url + BASE, '') + ' (' + (now[u] == null ? 'gone' : /const VERSION = '3/.test(now[u]) ? 'now 3.0\'s' : now[u].length + ' chars') + ')').join(', '));
          const others = await storedTexts(page, 'overload-v23', KEPT.map((f) => at(f + '?v=2.8')));
          const kept = KEPT.filter((f) => { const t = others[at(f + '?v=2.8')]; return t != null && t !== read(v28, f).toString(); });
          await page.close();
          return V28_NAMES.length + ' entries unchanged' + (kept.length ? '; holding 3.0\'s copy under the v2.8 name (tested in train-sync.js --base=v28): ' + kept.join(', ') : '');
        });
        await step('no signal: the stored v2.8 page runs pure v2.8, and its Food tab works', async () => {
          net('down', noInstall);
          page = await open(phone);
          const said = await pureV28('', page);
          await lib.openTab(page, 'food');
          need(await page.evaluate(() => document.querySelectorAll('.f-meal').length > 0), 'v2.8\'s Food tab does not draw');
          await page.close();
          return said;
        });
        await step('good signal for the page, every script slow, the update not through: the 3.0 page runs pure 3.0 under v2.8\'s worker', async () => {
          net(slowScripts, noInstall);
          page = await open(phone);
          const v = verdict(await page.ran(), R);
          need(v.page === '3.0' && !v.mixed.length, v.text);
          need((await settingsLine(page)) === 'Overload · v3.0' && !(await lib.tabNames(page)).includes('food'), 'not 3.0\'s screens');
          await page.close();
          return v.files.length + ' files, all 3.0\'s';
        });
        await step('no signal afterwards: pure v2.8 from v2.8\'s offline copy', async () => {
          net('down', noInstall);
          page = await open(phone);
          const said = await pureV28('', page);
          await page.close();
          return said;
        });
        ok = await step('good signal: 3.0\'s worker installs and takes over; the page runs pure 3.0', async () => {
          net();
          page = await open(phone);
          const cs = await until(async () => { const c = await cachesOf(page); return c[cacheOf(TREE)] && !c['overload-v23'] ? c : null; }, 30000);
          need(cs, 'no ' + cacheOf(TREE) + ' after 30 s');
          await page.close();
          page = await open(phone);
          const v = verdict(await page.ran(), R);
          need(v.page === '3.0' && !v.mixed.length, v.text);
          need(await page.evaluate(() => !!navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL.endsWith('/overload/sw.js')), 'not under the worker');
          return Object.keys(cs).join(', ') + '; ' + v.files.length + ' files, all 3.0\'s';
        });
        if (ok) {
          await step('signed in on 3.0: Copy my food log, then Remove the old food log: the account keeps every food day', async () => {
            await page.waitForFunction(() => !!window.__overloadSync && !!window.__overloadSync.user, null, { timeout: 15000 });
            await settle();
            await lib.openTab(page, 'settings');
            const mark = cloud.mark();
            await page.click('[data-action="handover-copy"]'); await T.toast(page, /Food log copied/);
            page.dialogs.length = 0;
            await page.click('[data-action="handover-remove"]'); await T.toast(page, /Old food log removed/);
            await settle();
            const w = cloud.writes({ who: 'A', from: mark, path: /foodDays/ });
            need(!w.length && daysIn(uid) === N, daysIn(uid) + ' of ' + N + ' food days in the account; writes under foodDays: ' + w.map((x) => x.type + ' ' + x.path.split('/').pop()).join(', '));
            need(/The food log in your cloud account is not changed\./.test(page.dialogs[0] || ''), 'the question did not speak of the cloud: ' + (page.dialogs[0] || '').slice(0, 120));
            need(Object.keys(JSON.parse(await lib.readStorageText(page, lib.STATE_KEY)).diary).length === 0, 'the diary was not removed');
            return N + ' of ' + N + ' food days in the account, no write under foodDays';
          });
          await step('no signal: pure 3.0 from ' + cacheOf(TREE), async () => {
            await page.close();
            net('down');
            page = await open(phone);
            const v = verdict(await page.ran(), R);
            need(v.page === '3.0' && !v.mixed.length, v.text);
            await page.close();
            return v.files.length + ' files, all 3.0\'s';
          });
        }
      }
      site.rules.length = 0; site.down = false;
      await phone.close();
    }

    // =====================================================================
    // The mix of finding U1, built by hand: Remove refuses while signed in
    // =====================================================================
    if (!ONLY || ONLY === 'mix') {
      const step = (title, fn) => run.step('mix', title, fn);
      const mix = copyTree(v28);
      fs.copyFileSync(path.join(TREE, MAIN), path.join(mix, 'app.js'));   // 3.0's main script under v2.8's name, beside v2.8's sync.js
      for (const f of ['connector.js', 'programs.js', 'backup.js']) fs.copyFileSync(path.join(TREE, f), path.join(mix, f));
      const phone = await makePhone('M', { serviceWorkers: 'block' });
      const phoneB = await makePhone('MB', { serviceWorkers: 'block', empty: true });
      site.root = v28;
      let page = null, uid = null;
      const ok = await step('set-up: v2.8 signed in on two phones; the account and the second phone hold the food log', async () => {
        page = await open(phone);
        await page.waitForFunction(() => !!window.__overloadSync, null, { timeout: 15000 });
        await page.evaluate(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL.replace('me@', 'mix@'), PASSWORD]);
        await settle();
        uid = phone.device.user().uid;
        await page.close();
        const b = await open(phoneB);
        await b.waitForFunction(() => !!window.__overloadSync, null, { timeout: 15000 });
        await b.evaluate(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL.replace('me@', 'mix@'), PASSWORD]);
        await settle();
        const bDays = Object.keys((JSON.parse(await lib.readStorageText(b, lib.STATE_KEY)) || {}).diary || {}).length;
        phoneB.page = b;
        need(daysIn(uid) === N && bDays === N, 'account ' + daysIn(uid) + ', phone B ' + bDays + ' food days');
        return N + ' food days in the account and on phone B';
      });
      if (ok) {
        await step('the mixed page (v2.8\'s page and sync.js, 3.0\'s main script): Remove refuses, and the account and phone B keep every food day', async () => {
          site.root = mix;
          page = await open(phone);
          await page.waitForFunction(() => !!window.__overloadSync && !!window.__overloadSync.user, null, { timeout: 15000 });
          need((await page.evaluate(() => 'foodInCloud' in window.__overloadSync)) === false, 'the sync module is not v2.8\'s');
          await settle();
          await lib.openTab(page, 'settings');
          const mark = cloud.mark();
          await page.click('[data-action="handover-copy"]'); await T.toast(page, /Food log copied/);
          page.dialogs.length = 0;
          await page.click('[data-action="handover-remove"]');
          const said = await T.toast(page, /Finish the update|Old food log removed|safety copy/);
          await settle();
          const w = cloud.writes({ who: 'M', from: mark, path: /foodDays/ });
          const left = Object.keys(JSON.parse(await lib.readStorageText(page, lib.STATE_KEY)).diary).length;
          await phoneB.page.reload(); await phoneB.page.waitForFunction(() => !!window.__overload); await settle();
          const bDays = Object.keys(JSON.parse(await lib.readStorageText(phoneB.page, lib.STATE_KEY)).diary).length;
          need(said === UPDATE_FIRST, 'the toast says: ' + said);
          need(!page.dialogs.length, 'a question was asked: ' + page.dialogs.join(' / ').slice(0, 160));
          need(!w.length && daysIn(uid) === N && bDays === N && left === N, daysIn(uid) + ' of ' + N + ' food days in the account, ' + bDays + ' on phone B, ' + left + ' on this phone; writes under foodDays: ' + w.map((x) => x.type + ' ' + x.path.split('/').pop() + ' [' + x.state + ']').join(', '));
          await page.close();
          return '"' + said + '"; ' + N + ' food days in the account, on phone B and on this phone';
        });
      }
      site.root = null;
      await phone.close(); await phoneB.close();
    }

    // =====================================================================
    // sync28: this tree's page with v2.8's sync.js (round 4, rel#6). During the first starts of 3.0 on a phone that
    // had 2.8, 2.8's worker hands out whatever the server has under sync.js?v=3.0, and an edge can still have 2.8's.
    // =====================================================================
    if (!ONLY || ONLY === 'sync28') {
      const step = (title, fn) => run.step('3.0 page, v2.8\'s sync.js', title, fn);
      const base = copyTree(TREE), stale = copyTree(TREE);
      fs.copyFileSync(path.join(v28, 'sync.js'), path.join(stale, 'sync.js'));
      const phone = await makePhone('S', { serviceWorkers: 'block' });
      const EM = EMAIL.replace('me@', 'stale@');
      const PLAIN_JS = 'Part of Overload did not load, so some of it may not work. Everything you logged is still on this phone. Close the app and open it again where there is signal or Wi-Fi.';
      const NOT_NOW = 'Cloud sync is not available right now. It starts when the app opens with signal. Your data stays on this phone.';
      const signedIn = () => !!window.__overloadSync && !!window.__overloadSync.user;
      const stored = async (page) => JSON.parse(await lib.readStorageText(page, lib.STATE_KEY));
      let page = null, uid = null, day = null;
      const ok = await step('set-up: v2.8 signed in (the account holds the food log); then 3.0 whole, where Save as a file and Remove take the old food log off the phone', async () => {
        site.root = v28;
        page = await open(phone);
        await page.waitForFunction(() => !!window.__overloadSync, null, { timeout: 15000 });
        await page.evaluate(([e, p]) => window.__overloadSync.createAccount(e, p), [EM, PASSWORD]);
        await settle();
        uid = phone.device.user().uid;
        await page.close();
        site.root = base;
        page = await open(phone);
        await page.waitForFunction(signedIn, null, { timeout: 15000 });
        await settle();
        await lib.openTab(page, 'settings');
        const file = page.waitForEvent('download', { timeout: 8000 });
        await page.click('[data-action="handover-file"]'); await file;
        await page.click('[data-action="handover-remove"]');
        await page.waitForFunction(() => Object.keys(window.__overload.state.diary).length === 0, null, { timeout: 8000 });
        await settle();
        await page.close();
        need(daysIn(uid) === N, 'the account holds ' + daysIn(uid) + ' of ' + N + ' food days');
        return N + ' food days in the account, none left on the phone';
      });
      if (ok) {
        await step('a start that gets v2.8\'s sync.js: the module is given nothing and sends nothing (the old food log stays off the phone, the account is unchanged, a weigh-in logged now is not sent yet), the cloud card says sync is not available, and the line at the top says part did not load; going offline and online shows no sync pill (pill#1)', async () => {
          site.root = stale;
          const before = JSON.stringify(cloud.snapshot('users/' + uid + '/')), mark = cloud.mark();
          page = await open(phone);
          await page.waitForFunction(signedIn, null, { timeout: 15000 });
          need(await page.evaluate(() => !('release' in window.__overloadSync)), 'the sync module that ran is not v2.8\'s (the check lost its point)');
          day = await page.evaluate(() => {
            const s = window.__overload.state, d = window.__overload.lib.todayKey();
            s.bodyweight = (s.bodyweight || []).filter((x) => x.date !== d).concat([{ date: d, weight: 77.7 }]).sort((a, b) => (a.date < b.date ? -1 : 1));
            window.__overload.save();
            return d;
          });
          await settle();
          const plain = await page.evaluate(() => (document.getElementById('boot-plain') || {}).textContent || null);
          await lib.openTab(page, 'settings');
          const card = (await T.text(page, '#cloud-card')).replace(/^Cloud sync\s*/, '');
          // Round 5, pill#1: 2.8's module reports 'Synced' when the signal drops or comes back. It syncs nothing here,
          // so the top bar shows no sync pill, as the card says.
          const pills = [];
          for (const ev of ['offline', 'online']) {
            await page.evaluate((e) => window.dispatchEvent(new Event(e)), ev);
            await sleep(300);
            pills.push(ev + ': ' + await page.evaluate(() => { const b = document.querySelector('.sync-pill'); return b ? b.className + ' "' + b.getAttribute('aria-label') + '"' : 'none'; }));
          }
          const days = Object.keys((await stored(page)).diary || {}).length;
          const ws = cloud.writes({ who: 'S', from: mark });
          await page.close();
          need(days === 0, 'the old food log came back onto the phone: ' + days + ' food days');
          need(!ws.length, 'this phone wrote: ' + ws.map((w) => w.type + ' ' + w.path.split('/').slice(2).join('/')).join(', '));
          need(JSON.stringify(cloud.snapshot('users/' + uid + '/')) === before, 'the account changed');
          need(card === NOT_NOW, 'the cloud card reads: ' + card);
          need(plain === PLAIN_JS, 'the line at the top says: ' + plain);
          need(pills.join() === 'offline: none,online: none', 'the top bar\'s sync pill: ' + pills.join('; '));
          return 'no write; ' + daysIn(uid) + ' food days in the account, none on the phone; "' + card.slice(0, 40) + '…"; no sync pill going offline and online';
        });
        await step('the next start of 3.0 whole sends what was logged meanwhile, and the old food log stays off the phone', async () => {
          site.root = base;
          page = await open(phone);
          await page.waitForFunction(signedIn, null, { timeout: 15000 });
          await settle();
          const days = Object.keys((await stored(page)).diary || {}).length;
          await page.close();
          const core = JSON.parse(cloud.get('users/' + uid + '/meta/state').core);
          const w = (core.bodyweight || []).find((x) => x.date === day);
          need(w && w.weight === 77.7, 'the weigh-in of ' + day + ' in the account: ' + JSON.stringify(w));
          need(days === 0 && daysIn(uid) === N, days + ' food days on the phone, ' + daysIn(uid) + ' in the account');
          return 'the weigh-in of ' + day + ' is in the account; ' + N + ' food days there, none on the phone';
        });
        // Review finding v28#1: a phone signed in on 3.0 whose first read failed has no note. A start that gets
        // v2.8's sync.js then reports the account signed in, but nothing would ever send a Reset made there (the
        // module is given nothing, and no note records what changed): the question said the account is erased, and
        // the next start of 3.0 merged the account back onto the phone. So Reset, Import and Restore do not start.
        await step('a phone signed in on 3.0 whose first read failed (no note), then a start that gets v2.8\'s sync.js: Reset asks nothing, changes nothing, and the toast says cloud sync is not available (v28#1); the next start of 3.0 whole reads the account, and Reset then asks with the account and reaches it', async () => {
          const D = await makePhone('D', { serviceWorkers: 'block' });
          const NOT_YET = 'Cloud sync is not available right now. It starts when the app opens with signal.';
          try {
            site.root = base;
            let pg = await open(D);
            await pg.waitForFunction(() => !!window.__overloadSync, null, { timeout: 15000 });
            await pg.evaluate(() => { const orig = window.__fakeFirebase; window.__fakeFirebase = (op, p) => (op === 'fs.server' && p && p.via === 'get' ? Promise.resolve({ error: 'unavailable', rev: 0 }) : orig(op, p)); });
            await pg.evaluate(([e, p]) => window.__overloadSync.signIn(e, p), [EM, PASSWORD]);
            await pg.waitForFunction(() => !!window.__overloadSync.user && /Could not reach the cloud/.test(window.__overloadSync.error), null, { timeout: 15000 });
            need(!(await pg.evaluate(() => localStorage.getItem('overload.sync.v1'))), 'D has a note');
            await pg.close();
            site.root = stale;
            pg = await open(D);
            await pg.waitForFunction(signedIn, null, { timeout: 15000 });
            need(await pg.evaluate(() => !('release' in window.__overloadSync)), 'the sync module that ran is not v2.8\'s');
            const before = await lib.readStorageText(pg, lib.STATE_KEY), mark = cloud.mark();
            await lib.openTab(pg, 'settings');
            await pg.click('[data-action="reset"]');
            const said = await T.toast(pg, /not available|still reading/).catch(() => 'no such toast');
            await sleep(500);
            const after = await lib.readStorageText(pg, lib.STATE_KEY), asked = pg.dialogs.slice();
            await pg.close();
            need(!asked.length, 'questions were asked: ' + asked.join(' / ').replace(/\n/g, ' | ').slice(0, 300));
            need(after === before, 'D\'s data changed');
            need(said === NOT_YET, 'the toast: ' + said);
            need(!cloud.writes({ who: 'D', from: mark }).length, 'D wrote to the account');
            site.root = base;
            pg = await open(D);
            await pg.waitForFunction(() => !!window.__overloadSync && window.__overloadSync.linked === true, null, { timeout: 15000 });
            await settle();
            await lib.openTab(pg, 'settings');
            await pg.click('[data-action="reset"]');
            await pg.waitForFunction(() => window.__overload.state.workouts.length === 0, null, { timeout: 15000 });
            await settle();
            const q = pg.dialogs.slice(), left = cloud.paths('users/' + uid + '/workouts').length;
            await pg.close();
            need(q.length === 2 && q[0].includes('You are signed in to cloud sync, so the training data in your account'), 'after the link, Reset asks: ' + q.join(' / ').replace(/\n/g, ' | ').slice(0, 300));
            need(left === 0, 'the account still holds ' + left + ' workouts');
            return '"' + said + '"; after the link Reset asks with the account and erases it';
          } finally { site.root = null; await D.close(); }
        });
      }
      site.root = null;
      await phone.close();
    }

    // =====================================================================
    // 3.0 on the phone, then a 3.1 made with bump.sh is published
    // =====================================================================
    if (!ONLY || ONLY === 'v30') {
      const step = (title, fn) => run.step('3.0 -> 3.1', title, fn);
      const base = copyTree(TREE), next = copyTree(TREE);
      let said = '';
      try { said = execSync('sh bump.sh 3.1', { cwd: next, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim().split('\n')[0]; }
      catch (e) { throw new Error('bump.sh 3.1 failed in the copy: ' + String(e.stderr || e.message).trim()); }
      // A real release changes files: make every script and stylesheet of 3.1 differ from 3.0's.
      for (const f of pageFiles(next)) fs.appendFileSync(path.join(next, f), '\n/* 3.1 */\n');
      const R = [{ name: '3.0', dir: base }, { name: '3.1', dir: next }];
      const C30 = cacheOf(base), C31 = cacheOf(next), main = mainOf(base);
      const slowPage = rule({ test: (rel) => rel === 'index.html', delay: 4000 });
      const noInstall = rule({ test: (rel) => rel === 'icon-512.png', status: 404 });
      const noMain = rule({ test: (rel, u) => rel === main && u.search === '?v=3.1', status: 503 });
      const phone = await makePhone('P', { sealed: true });
      site.root = base;
      let page = null;
      let ok = await step('set-up: 3.0 installed under its own worker (' + C30 + '); ' + said, async () => {
        page = await open(phone);
        need(await until(async () => { const c = await cachesOf(page); return c[C30] && c[C30].length >= assetsOf(base).length && (await page.evaluate(() => !!navigator.serviceWorker.controller)); }, 30000), 'the 3.0 worker did not install');
        await sleep(1500);
        await page.close();
        page = await open(phone);
        const v = verdict(await page.ran(), R);
        need(v.page === '3.0' && !v.mixed.length && v.files.every((f) => f.of.length === 1), v.text);
        await page.close();
        return v.files.length + ' files under the worker, all 3.0\'s';
      });
      if (ok) {
        site.root = next;
        const urls = pageFiles(base).map((f) => at(f + '?v=3.0'));
        const pure30 = async (pg) => {
          const v = verdict(await pg.ran(), R);
          need(v.page === '3.0', 'the page that ran is ' + v.page + ' (' + v.text + ')');
          need(!v.mixed.length, 'a mix: ' + v.mixed.map((f) => f.rel + ' is ' + (f.of.join('|') || 'neither')).join(', ') + ' in the 3.0 page');
          const line = await settingsLine(pg);
          need(line === 'Overload · v3.0', 'Settings says "' + line + '"');
          const rel = await pg.evaluate(() => window.__overloadSync && window.__overloadSync.release);
          need(rel === undefined || rel === '3.0', 'the sync module says ' + rel);
          return v.files.length + ' files, all 3.0\'s; Settings says ' + line;
        };
        await step('weak signal, the page over 3 s: the stored 3.0 page runs only 3.0\'s files', async () => {
          net(slowPage, noInstall);
          page = await open(phone);
          const r = await pure30(page);
          await sleep(5000);
          await page.close();
          return r;
        });
        await step('the stored 3.0 copies are not overwritten with 3.1\'s', async () => {
          net(slowPage, noInstall);
          page = await open(phone);
          const now = await storedTexts(page, C30, urls);
          const changed = urls.filter((u) => now[u] !== read(base, new URL(u).pathname.slice(BASE.length)).toString());
          need(!changed.length, 'changed: ' + changed.map((u) => u.replace(site.url + BASE, '') + (now[u] && /3\.1/.test(now[u]) ? ' (now 3.1\'s)' : '')).join(', '));
          await page.close();
          return urls.length + ' entries of ' + C30 + ' as the install stored them';
        });
        await step('no signal: the stored 3.0 page runs only 3.0\'s files', async () => {
          net('down', noInstall);
          page = await open(phone);
          const r = await pure30(page);
          await page.close();
          return r;
        });
        await step('the 3.1 page whose main script does not arrive: the start-up rescue runs the stored 3.0, whole', async () => {
          net(noMain, noInstall);
          page = await open(phone);
          const line = await settingsLine(page);
          const blobs = await page.evaluate(() => document.querySelectorAll('script[src^="blob:"]').length);
          const rel = await page.evaluate(() => window.__overloadSync && window.__overloadSync.release);
          need(line === 'Overload · v3.0' && blobs >= 4, 'Settings says ' + line + '; scripts from stored copies: ' + blobs);
          await page.close();
          return blobs + ' scripts from the stored 3.0; Settings says ' + line + '; window.__overloadSync.release: ' + rel;
        });
        await step('good signal for the page, the update not through yet: the 3.1 page runs only 3.1\'s files', async () => {
          net(noInstall);
          page = await open(phone);
          const v = verdict(await page.ran(), R);
          need(v.page === '3.1' && !v.mixed.length, v.text);
          need((await settingsLine(page)) === 'Overload · v3.1', 'Settings says ' + await T.text(page, '#app p.version'));
          await page.close();
          return v.files.length + ' files, all 3.1\'s';
        });
        for (const [what, file, stale] of [['main script', main, () => read(base, main)], ['sync module', 'sync.js', () => read(base, 'sync.js')],
          ['stylesheet', 'train.css', () => read(base, 'train.css')], ['safety copies', 'backup.js', () => read(base, 'backup.js')]]) {
          await step('an install of 3.1 that gets 3.0\'s ' + what + ' (' + file + ') is refused; ' + C30 + ' stays as it was', async () => {
            const r = rule({ test: (rel) => rel === file, body: stale() });
            net(r);
            page = await open(phone);
            const before = (await cachesOf(page))[C30].slice().sort();
            const outcome = await updateOutcome(page);
            // The page's own update check may still be on its way: let every install end before the file is right again.
            await until(() => page.evaluate(async () => { const g = await navigator.serviceWorker.getRegistration(); return !g.installing && !g.waiting; }), 20000);
            await sleep(500);
            const cs = await cachesOf(page);
            await page.close();
            site.rules.splice(site.rules.indexOf(r), 1);
            need(outcome === 'redundant', 'the new worker ended as: ' + outcome);
            need(!cs[C31] && JSON.stringify((cs[C30] || []).slice().sort()) === JSON.stringify(before), 'caches: ' + Object.keys(cs).join(', '));
            return 'the 3.1 worker ended as ' + outcome + '; ' + C30 + ' unchanged';
          });
        }
        ok = await step('good signal: 3.1 takes over (' + C31 + ', ' + C30 + ' deleted), the open page reloads once into pure 3.1', async () => {
          net();
          page = await open(phone);
          const cs = await until(async () => { const c = await cachesOf(page); return c[C31] && !c[C30] && c[C31].length >= assetsOf(next).length ? c : null; }, 30000);
          need(cs, 'no ' + C31 + '; caches: ' + Object.keys(await cachesOf(page).catch(() => ({}))).join(', '));
          const first = await page.evaluate(() => window.__events.join(', ')).catch(() => '(reloading)');
          need(await until(() => page.loads >= 2, 10000), 'the page did not reload (loads: ' + page.loads + '; Update ready shown: ' + !!(await page.$('#topbar-right [data-action="reload"]')) + '; ' + first + ')');
          await page.waitForFunction(() => !!window.__overload, null, { timeout: 15000 });
          await sleep(1000);
          need(page.loads === 2, 'the page loaded ' + page.loads + ' times');
          const all = await page.ran();
          const v = verdict(all.slice(all.map((x) => x.type).lastIndexOf('document')), R);
          need(v.page === '3.1' && !v.mixed.length, v.text);
          await page.close();
          return Object.keys(cs).join(', ') + '; ' + v.files.length + ' files, all 3.1\'s';
        });
        if (ok) {
          await step('no signal: 3.1 starts from ' + C31 + ', pure, and its stored copies are 3.1\'s', async () => {
            net('down');
            page = await open(phone);
            const v = verdict(await page.ran(), R);
            need(v.page === '3.1' && !v.mixed.length, v.text);
            need((await settingsLine(page)) === 'Overload · v3.1', 'Settings says ' + await T.text(page, '#app p.version'));
            const list = pageFiles(next).map((f) => at(f + '?v=3.1'));
            const now = await storedTexts(page, C31, list);
            const wrong = list.filter((u) => now[u] !== read(next, new URL(u).pathname.slice(BASE.length)).toString());
            need(!wrong.length, 'not 3.1\'s: ' + wrong.join(', '));
            await page.close();
            return v.files.length + ' files, all 3.1\'s; ' + list.length + ' stored copies are 3.1\'s';
          });
        }
      }
      site.rules.length = 0; site.down = false;
      await step('no worker file was installed twice (sealed phone, no routing)', async () => {
        const twice = phone.workers.installedTwice();
        need(!twice.length, 'installed more than once: ' + twice.map((x) => x.script.replace(site.url, '') + ' x' + x.times).join(', '));
        return phone.workers.installed().length + ' installs finished, ' + phone.workers.count() + ' worker versions in all';
      });
      await phone.close();
    }
  } catch (e) {
    run.say(false, 'train-mixed', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | '));
  }
  for (const p of phones) await p.close().catch(() => {});
  await browser.close();
  await site.stop();
  run.done();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
