#!/usr/bin/env node
/* Fuel: what a phone keeps across releases when a server edge is stale or an install is cut off. Findings upgrade#1
 * to #5 of the final review, for Fuel's worker (fuel/sw.js) and page (fuel/index.html), and the sync module item of
 * the code review's list. tests/train-release.js does the same for Overload.
 *
 *   node tests/fuel-release.js [--tree=<folder>] [--port=8962] [--only=stale|page|db|half|sync|preload|line] [--shots=<folder>]
 *
 * Real service workers in a sealed Chromium (tests/lib.js: no Playwright routing, which makes Chromium install the
 * same worker again at every update check; the browser itself stops every host but 127.0.0.1). The server is
 * lib.startSite (the tree under /overload/ by path, as GitHub Pages serves it). Every start is a cold one. Trees,
 * all temporary copies: 3.0 = this tree; 3.1 and 3.2 = sh bump.sh on copies. Each versioned file gets a marker at
 * its end, so a check can tell which release's copy ran.
 *
 *   stale  (upgrade#1) Fuel 3.0 installed; 3.1 published while an edge still has 3.0's food.js and sync.js: the 3.1
 *          install is refused and fuel-v1 stays as it was; a start meanwhile gets the 3.1 page under 3.0's worker:
 *          fuel.js starts without the refused files (not stored), and the top line says part of Fuel did not load;
 *          once the edge is right 3.1 installs whole and starts whole, also with no signal.
 *   page   (upgrade#2) 3.1 installed whole; a start that gets 3.0's page from a stale edge runs the stored 3.1 page.
 *   db     (upgrade#3) the food list rebuilt the old way (?db= moved by hand, no new release): the install under the
 *          same cache name fails on the barcode reader's wasm file; fuel-v1 stays as it was, entry for entry and byte
 *          for byte (no food.js asking for a list that is not stored), and Fuel starts with no signal.
 *   half   (upgrade#4) a 3.1 install stopped during its downloads leaves no cache at all; with a cache whose install
 *          did not finish (put by hand), a 3.2 page without fuel.js starts the whole 3.0, never that one; the next
 *          install of another release deletes it, even when that install fails.
 *   sync   (code review, not checked) the 3.1 page whose fuel.js fails but whose sync.js ran: the rescue starts 3.0
 *          without running a second sync module; when sync.js failed too, 3.0's sync.js is run.
 *   preload (round 4, rel#4) 3.0 installed, a 3.1 install that failed (its fetches leave the 3.1 page in the HTTP
 *          cache), every worker stopped over CDP, a start with no signal: the stored 3.0 page runs whole. The sealed
 *          browser runs without Chromium's ServiceWorkerAutoPreload, which would answer that start from the HTTP cache.
 *   line   (round 4, rel#5) the line at the top ("Part of Fuel did not load"), at 390 and 320 px, dark and light, with
 *          an iPhone's status bar emulated (47 px), with a script missing, without fuel.css, and without any
 *          stylesheet: its text starts below the status bar, it lies over nothing, and the top bar starts below it.
 *          Screenshots go to --shots (default: a new temporary folder, named in the output).
 * On every phone with a worker no worker file is installed twice (upgrade#5).
 *   --tree=DIR   the folder to serve as 3.0. Default: the repo this file is in (the working tree).
 * Prints one PASS or FAIL line per check; exit code 1 when a check failed. No server or browser is left running.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const F = require('./fuel-common');

const args = F.args();
const PORT = Number(args.port) || 8962;
const TREE = args.tree ? path.resolve(String(args.tree)) : lib.REPO;
const ONLY = args.only ? String(args.only) : '';
const run = F.runner('fuel-release');
const { need, same } = run;
const sleep = lib.sleep;
const fx = lib.loadFixture('v28-state');
const SUB = 'fuel/';
const SCRIPT_LOST = 'Part of Fuel did not load, so some of it may not work. Everything you logged is still on this phone. Close the app and open it again where there is signal or Wi-Fi.';

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const cacheOf = (dir) => lib.workerOf(dir, SUB).cache;
const assetsOf = (dir) => lib.workerOf(dir, SUB).assets;

// What runs in a Fuel page (see train-release.js): the scripts' ?v=, which release's copy of each marked file ran.
const facts = (page) => page.evaluate((keys) => {
  const cs = getComputedStyle(document.documentElement), css = {};
  keys.forEach((k) => { css[k] = (cs.getPropertyValue('--rel-' + k) || '').replace(/"/g, '').trim(); });
  return {
    started: !!window.__overload, food: !!window.__overloadFood,
    versions: [...new Set([...document.querySelectorAll('script[src]')].map((s) => (/[?&]v=([^&#]+)/.exec(s.getAttribute('src')) || [])[1]).filter(Boolean))],
    rel: Object.assign({}, window.__rel || {}),
    css,
    blobs: document.querySelectorAll('script[src^="blob:"]').length,
    modules: document.querySelectorAll('script[type="module"][src^="blob:"]').length,
    note: (document.getElementById('boot-note') || {}).textContent || null,
    plain: (document.getElementById('boot-plain') || {}).textContent || null,
    controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    syncRuns: window.__syncRuns || null
  };
}, [lib.markKey('shared/ui.css'), lib.markKey('fuel/fuel.css')]);
// Every marked file and stylesheet of the page is of release v (four scripts: sync.js cannot run on a sealed phone,
// its Firebase files are on www.gstatic.com).
const whole = (f, v) => !!f && f.started && f.food && f.versions.length === 1 && f.versions[0] === v && Object.keys(f.rel).length >= 4 && Object.values(f.rel).every((x) => x === v) && Object.values(f.css).every((x) => x === v) && !f.plain;
const brief = (f) => (f ? JSON.stringify({ started: f.started, food: f.food, versions: f.versions, rel: f.rel, css: f.css, note: f.note, plain: f.plain && f.plain.slice(0, 40) }) : 'no page');

(async () => {
  const site = await lib.startSite(PORT);
  const browser = await lib.launch({ sealed: true });
  const phones = [];
  const base = lib.markRelease(lib.copyTree(TREE), '3.0');
  const s31 = lib.markRelease(lib.nextRelease(TREE, '3.1'), '3.1');
  const s32 = lib.markRelease(lib.nextRelease(s31, '3.2'), '3.2');
  const C30 = cacheOf(base), C31 = cacheOf(s31), C32 = cacheOf(s32);
  console.log('# 3.0 tree: ' + TREE + (TREE === lib.REPO ? ' (the working tree)' : ' (a copy)') + '; caches ' + [C30, C31, C32].join(', ') + '; port ' + PORT);
  const DONE = site.at(SUB + 'installed');
  const fuelState = F.fuelStateFrom(fx.state);

  async function makePhone(opts) {
    const phone = await lib.newPhone(browser, Object.assign({ sealed: true, serviceWorkers: 'allow', now: fx.meta.now, timezoneId: fx.meta.tz }, opts || {}));
    await lib.seedStorage(phone.context, { 'fuel.state.v1': fuelState, 'fuel.theme': 'dark' });
    if (!(opts && opts.serviceWorkers === 'block')) phone.workers = await lib.watchWorkers(phone.context, site.served);
    phones.push(phone);
    return phone;
  }
  // A cold start that never throws: waits for fuel.js (and food.js, unless told not to), or for the rescue's last word.
  async function start(phone, opts) {
    const page = await lib.coldPage(phone.context);
    page.on('dialog', (d) => d.accept().catch(() => {}));
    const needFood = !(opts && opts.mainOnly);
    try {
      await page.goto(site.at(SUB + 'index.html'), { waitUntil: 'load', timeout: 30000 });
      await page.waitForFunction((food) => (!!window.__overload && (!food || !!window.__overloadFood)) || (document.getElementById('boot-note') && /did not finish/.test(document.getElementById('boot-note').textContent)), needFood, { timeout: 25000 });
      await sleep(600);
      return { page, facts: await facts(page) };
    } catch (e) { return { page, error: String(e.message).split('\n')[0] }; }
  }
  async function startAndClose(phone, opts) { const r = await start(phone, opts); const f = r.facts || null; await r.page.close().catch(() => {}); return f; }
  // A page of this origin outside both apps' scopes: sees Cache Storage and the registrations, starts no update check.
  async function outside(phone) { const page = await lib.coldPage(phone.context); await page.goto(site.url + '/__outside.html'); return page; }
  async function install(phone, root, cache, count) {
    site.root = root; site.rules.length = 0; site.down = false;
    const r = await start(phone);
    const ok = await lib.until(async () => { const c = await lib.cachesOf(r.page); return c[cache] && c[cache].length >= count && (await r.page.evaluate(() => !!navigator.serviceWorker.controller)); }, 40000);
    await sleep(500);
    await r.page.close();
    if (!ok) throw new Error('the worker with ' + cache + ' did not install');
  }
  // Asks Fuel's registration for a new worker now: 'activated', 'redundant' (its install failed), 'none', 'timeout'.
  async function update(phone) {
    const page = await outside(phone);
    const out = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration('/overload/fuel/');
      if (!reg || !/\/fuel\/$/.test(reg.scope)) return 'no registration';
      let found = false;
      const end = new Promise((resolve) => {
        const watch = (w) => { if (!w) return; found = true; const look = () => { if (w.state === 'redundant' || w.state === 'activated') resolve(w.state); }; w.addEventListener('statechange', look); look(); };
        reg.addEventListener('updatefound', () => watch(reg.installing));
        watch(reg.installing);
      });
      await reg.update().catch(() => {});
      return Promise.race([end, new Promise((r) => setTimeout(() => r(found ? 'timeout' : 'none'), 30000))]);
    }).catch((e) => 'error: ' + String(e.message).split('\n')[0]);
    await lib.until(() => page.evaluate(async () => { const g = await navigator.serviceWorker.getRegistration('/overload/fuel/'); return !g || (!g.installing && !g.waiting); }), 20000);
    await sleep(500);
    return { out, page };
  }
  const counts = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.length]));
  const onceEach = (phone, label) => run.step(label, 'no worker file was installed twice (sealed phone, no routing)', async () => {
    const twice = phone.workers.installedTwice();
    need(!twice.length, 'installed more than once: ' + twice.map((x) => x.script.replace(site.url, '') + ' x' + x.times).join(', '));
    return phone.workers.installed().length + ' installs finished, ' + phone.workers.count() + ' worker versions in all';
  });
  const N = assetsOf(base).length;   // the install list

  try {
    // =====================================================================
    // stale: 3.1 published while an edge still has 3.0's food.js and sync.js
    // =====================================================================
    if (!ONLY || ONLY === 'stale') {
      const L = 'stale file, 3.0 -> 3.1';
      const STALE = ['fuel/food.js', 'fuel/sync.js'];
      const phone = await makePhone();
      let ok = await run.step(L, 'set-up: Fuel 3.0 installed under its own worker', async () => {
        await install(phone, base, C30, N);
        const r = await start(phone);
        await r.page.close();
        need(whole(r.facts, '3.0'), brief(r.facts));
        return C30 + ', 3.0 whole';
      });
      if (ok) {
        await run.step(L, 'the install ended with the entry "installed", which says 3.0 (upgrade#4)', async () => {
          const p = await outside(phone);
          const said = await lib.cacheText(p, C30, DONE);
          await p.close();
          need(said === '3.0', 'the entry "installed" says ' + said);
          return 'in ' + C30;
        });
        site.root = s31;
        site.rules.push({ test: (rel) => STALE.includes(rel), root: base });
        ok = await run.step(L, 'the 3.1 install that gets 3.0\'s food.js and sync.js is refused; ' + C30 + ' stays as it was', async () => {
          const probe = await outside(phone);
          const before = (await lib.cachesOf(probe))[C30].slice().sort();
          await probe.close();
          const { out, page } = await update(phone);
          const cs = await lib.cachesOf(page);
          await page.close();
          need(out === 'redundant', 'the 3.1 worker ended as: ' + out);
          need(!cs[C31] && JSON.stringify((cs[C30] || []).slice().sort()) === JSON.stringify(before), 'caches: ' + JSON.stringify(counts(cs)));
          return 'the 3.1 worker ended as ' + out + '; ' + C30 + ' unchanged (' + before.length + ' entries)';
        });
        await run.step(L, 'meanwhile the 3.1 page runs under 3.0\'s worker without the refused files, says part of Fuel did not load, and nothing is stored under their 3.1 names', async () => {
          const r = await start(phone, { mainOnly: true });
          const kept = await Promise.all(STALE.map((f) => lib.cacheText(r.page, C30, site.at(f + '?v=3.1'))));
          await r.page.close();
          const f = r.facts;
          need(f && f.started && f.versions.join() === '3.1' && f.rel['fuel/fuel.js'] === '3.1', 'the page that ran: ' + brief(f));
          need(!f.food && f.rel['fuel/food.js'] === undefined, 'a refused file ran: ' + brief(f));
          need(f.plain === SCRIPT_LOST, 'the line at the top says: ' + f.plain);
          need(kept.every((t) => t === null), 'stored under a 3.1 name: ' + STALE.filter((x, i) => kept[i] !== null).join(', '));
          return 'fuel.js 3.1 started without food.js and sync.js; "' + f.plain.slice(0, 55) + '…"';
        });
        site.rules.length = 0;
        ok = ok && await run.step(L, 'the edge right again: the next start installs 3.1 (' + C31 + '), with 3.1\'s food.js and sync.js', async () => {
          const r = await start(phone, { mainOnly: true });
          const cs = await lib.until(async () => { const c = await lib.cachesOf(r.page); return c[C31] && !c[C30] ? c : null; }, 40000);
          await r.page.close().catch(() => {});
          need(cs, 'no ' + C31 + ' after 40 s');
          const p = await outside(phone);
          const got = await Promise.all(STALE.map((x) => lib.cacheText(p, C31, site.at(x + '?v=3.1'))));
          await p.close();
          const wrong = STALE.filter((x, i) => got[i] !== read(s31, x));
          need(!wrong.length, 'not 3.1\'s in ' + C31 + ': ' + wrong.join(', '));
          return Object.keys(cs).join(', ') + '; food.js and sync.js are 3.1\'s';
        });
        if (ok) {
          await run.step(L, 'Fuel 3.1 starts whole, with signal and with none', async () => {
            const on = await startAndClose(phone);
            site.cut();
            let off;
            try { off = await startAndClose(phone); } finally { site.down = false; }
            need(whole(on, '3.1') && whole(off, '3.1'), 'with signal ' + brief(on) + '; with none ' + brief(off));
            return 'every marked file and stylesheet 3.1\'s, both times';
          });
        }
      }
      site.rules.length = 0; site.down = false;
      await onceEach(phone, L);
      await phone.close();
    }

    // =====================================================================
    // page: 3.1 installed; an edge with the previous release's page
    // =====================================================================
    if (!ONLY || ONLY === 'page') {
      const L = 'stale page';
      const phone = await makePhone();
      const ok = await run.step(L, 'set-up: Fuel 3.0 installed, then 3.1 takes over whole (' + C31 + ')', async () => {
        await install(phone, base, C30, N);
        site.root = s31;
        const { out, page } = await update(phone);
        const cs = await lib.until(async () => { const c = await lib.cachesOf(page); return c[C31] && !c[C30] ? c : null; }, 30000);
        await page.close();
        need(out === 'activated' && cs, 'the 3.1 worker ended as ' + out);
        const f = await startAndClose(phone);
        need(whole(f, '3.1'), brief(f));
        return Object.keys(cs).join(', ') + '; 3.1 whole';
      });
      if (ok) {
        await run.step(L, 'a start that gets 3.0\'s page from a stale edge runs the stored 3.1 page, whole', async () => {
          site.rules.push({ test: (rel) => rel === SUB + 'index.html', root: base });
          let f;
          try { f = await startAndClose(phone); } finally { site.rules.length = 0; }
          need(whole(f, '3.1'), 'the page that ran: ' + brief(f));
          return 'Fuel 3.1 started; the server had handed out 3.0\'s page';
        });
      }
      site.rules.length = 0; site.down = false;
      await onceEach(phone, L);
      await phone.close();
    }

    // =====================================================================
    // db: the food list's ?db= moved by hand, without a new release (same cache name)
    // =====================================================================
    if (!ONLY || ONLY === 'db') {
      const L = 'food list, same cache name';
      const edited = lib.copyTree(base);
      fs.writeFileSync(path.join(edited, 'data/foods.json'), read(base, 'data/foods.json').replace(/\s*$/, '\n\n'));
      for (const f of ['fuel/food.js', 'fuel/sw.js']) fs.writeFileSync(path.join(edited, f), read(edited, f).split('foods.json?db=5').join('foods.json?db=6'));
      const phone = await makePhone();
      const ok = await run.step(L, 'set-up: Fuel 3.0 installed (' + C30 + '); the server then has ?db=6 in fuel/food.js and fuel/sw.js, the cache name unchanged', async () => {
        await install(phone, base, C30, N);
        need(cacheOf(edited) === C30 && /\?db=6/.test(read(edited, 'fuel/sw.js')), 'the edited tree is not what this check needs');
        return 'cache ' + cacheOf(edited) + ' in both';
      });
      if (ok) {
        await run.step(L, 'its install fails (the barcode reader\'s wasm file does not arrive): ' + C30 + ' stays whole, and Fuel starts with no signal', async () => {
          site.root = edited;
          site.rules.push({ test: (rel) => rel === 'vendor/zxing/zxing_reader.wasm', drop: true });
          const texts = (pg, list) => Promise.all(list.map((u) => lib.cacheText(pg, C30, u)));
          const probe = await outside(phone);
          const was = (await lib.cachesOf(probe))[C30].slice().sort();
          const wasTexts = await texts(probe, was);
          await probe.close();
          const { out, page } = await update(phone);
          const cs = await lib.cachesOf(page);
          const said = await lib.cacheText(page, C30, DONE);
          const nowTexts = await texts(page, was);
          await page.close();
          site.rules.length = 0;
          need(out === 'redundant', 'the edited worker ended as: ' + out);
          need(JSON.stringify((cs[C30] || []).slice().sort()) === JSON.stringify(was) && JSON.stringify(nowTexts) === JSON.stringify(wasTexts), C30 + ' changed: ' + (cs[C30] || []).filter((u) => !was.includes(u)).concat(was.filter((u, i) => nowTexts[i] !== wasTexts[i])).map((u) => u.replace(site.url, '')).join(', '));
          const lacking = assetsOf(base).map((a) => new URL(a, site.at(SUB)).href).filter((u) => !(cs[C30] || []).includes(u));
          need(cs[C30] && !lacking.length && said === '3.0', 'caches: ' + JSON.stringify(counts(cs)) + '; lacking ' + lacking.join(', ') + '; "installed" says ' + said);
          site.cut();
          let off;
          try { off = await startAndClose(phone); } finally { site.down = false; }
          need(whole(off, '3.0'), 'with no signal: ' + brief(off));
          return 'the edited worker ended as ' + out + '; ' + C30 + ' whole; Fuel 3.0 starts with no signal';
        });
      }
      site.rules.length = 0; site.down = false;
      await onceEach(phone, L);
      await phone.close();
    }

    // =====================================================================
    // half: a 3.1 install cut off half way
    // =====================================================================
    if (!ONLY || ONLY === 'half') {
      const L = 'install cut off';
      const phone = await makePhone();
      const FAST = ['fuel/fuel.js', 'fuel/backup.js'];
      let ok = await run.step(L, 'set-up: Fuel 3.0 installed (' + C30 + ')', async () => {
        await install(phone, base, C30, N);
        return C30;
      });
      if (ok) {
        await run.step(L, 'a 3.1 install stopped during its downloads (every worker stopped, as when the app goes to the background) leaves no cache: nothing is stored before every file has arrived', async () => {
          site.root = s31;
          site.log.length = 0;
          site.rules.push({ test: (rel) => rel !== SUB + 'sw.js' && !FAST.includes(rel), delay: 6000 });
          const p = await outside(phone);
          p.evaluate(() => navigator.serviceWorker.getRegistration('/overload/fuel/').then((r) => r.update())).catch(() => {});
          const asked = await lib.until(() => FAST.every((f) => site.log.includes('/overload/' + f + '?v=3.1')), 15000, 100);
          await sleep(1000);   // they have arrived; the others are still on their way
          await phone.workers.cdp.send('ServiceWorker.stopAllWorkers');
          await sleep(7000);
          site.rules.length = 0;
          const cs = await lib.cachesOf(p);
          await p.close();
          need(asked, 'the install never asked for ' + FAST.join(' and '));
          need(cs[C30] && !cs[C31], 'caches: ' + JSON.stringify(counts(cs)));
          return 'caches: ' + JSON.stringify(counts(cs));
        });
      }
      if (ok) {
        // What an install stopped while storing (or a worker that stored as it downloaded) leaves behind.
        ok = await run.step(L, 'set-up: a cache whose install did not finish (' + C31 + ': five of 3.1\'s entries, no "installed")', async () => {
          const half = [['', 'fuel/index.html'], ['index.html', 'fuel/index.html'], ['fuel.css?v=3.1', 'fuel/fuel.css'], ['backup.js?v=3.1', 'fuel/backup.js'], ['fuel.js?v=3.1', 'fuel/fuel.js']];
          const p = await outside(phone);
          await p.evaluate(async ([cache, list]) => { await caches.delete(cache); const c = await caches.open(cache); for (const e of list) await c.put(e.url, new Response(e.body, { headers: { 'Content-Type': e.type } })); },
            [C31, half.map(([a, f]) => ({ url: site.at(SUB + a), body: read(s31, f), type: /\.html$/.test(f) ? 'text/html' : /\.css$/.test(f) ? 'text/css' : 'text/javascript' }))]);
          const cs = await lib.cachesOf(p);
          await p.close();
          need(cs[C31] && cs[C31].length === half.length, 'caches: ' + JSON.stringify(counts(cs)));
          return JSON.stringify(counts(cs));
        });
      }
      if (ok) {
        await run.step(L, '3.2 published, its page arrives without fuel.js: the rescue starts the whole 3.0, not the half 3.1', async () => {
          site.root = s32;
          site.rules.push({ test: (rel) => rel === SUB + 'fuel.js' || rel === SUB + 'sw.js', drop: true });
          let f;
          try { f = await startAndClose(phone); } finally { site.rules.length = 0; }
          need(f && f.started && f.food && f.rel['fuel/fuel.js'] === '3.0' && !Object.values(f.rel).includes('3.1'), 'the page that ran: ' + brief(f));
          return 'fuel.js ran from the stored 3.0; no file of the half 3.1';
        });
        await run.step(L, 'the 3.2 install starts by deleting the half ' + C31 + ', and when it fails it leaves ' + C30 + ' alone', async () => {
          site.root = s32;
          site.rules.push({ test: (rel) => rel === 'vendor/zxing/zxing_reader.wasm', drop: true });
          const { out, page } = await update(phone);
          const cs = await lib.cachesOf(page);
          await page.close();
          site.rules.length = 0;
          need(out === 'redundant', 'the 3.2 worker ended as: ' + out);
          same(Object.keys(cs).sort(), [C30], 'the caches');
          return 'the 3.2 worker ended as ' + out + '; caches: ' + Object.keys(cs).join(', ');
        });
        await run.step(L, 'good signal: 3.2 takes over (' + C32 + ' only), and starts whole with no signal', async () => {
          site.root = s32;
          const { out, page } = await update(phone);
          const cs = await lib.until(async () => { const c = await lib.cachesOf(page); return c[C32] && Object.keys(c).length === 1 ? c : null; }, 30000);
          await page.close();
          need(out === 'activated' && cs, 'the 3.2 worker ended as ' + out);
          site.cut();
          let off;
          try { off = await startAndClose(phone); } finally { site.down = false; }
          need(whole(off, '3.2'), 'with no signal: ' + brief(off));
          return Object.keys(cs).join(', ') + '; 3.2 whole with no signal';
        });
      }
      site.rules.length = 0; site.down = false;
      await onceEach(phone, L);
      await phone.close();
    }

    // =====================================================================
    // sync: the rescue never starts a second sync module
    // =====================================================================
    if (!ONLY || ONLY === 'sync') {
      const L = 'rescue and sync module';
      const syncOf = (v) => '/* release ' + v + ' (a stand-in) */\nwindow.__syncRuns = (window.__syncRuns || []).concat(' + JSON.stringify(v) + ');\n';
      const store = async (phone) => {
        const page = await phone.context.newPage();
        await page.goto(site.at(SUB + '__blank.html'));
        const files = lib.versionedFiles(base).filter((f) => f.startsWith(SUB) || f.startsWith('shared/'));
        await page.evaluate(async ([list, at, done, cache]) => {
          const c = await caches.open(cache);
          for (const e of list) await c.put(at + e.f + '?v=3.0', new Response(e.body, { headers: { 'Content-Type': /\.css$/.test(e.f) ? 'text/css' : 'text/javascript' } }));
          await c.put(done, new Response('3.0'));
        }, [files.map((f) => ({ f, body: f === SUB + 'sync.js' ? syncOf('3.0') : read(base, f) })), site.at(''), DONE, C30]);
        await page.close();
      };
      for (const [title, syncFails, want] of [
        ['the 3.1 page whose fuel.js fails and whose sync.js ran: the rescue starts 3.0 and runs no second sync module', false, ['3.1']],
        ['control: when sync.js failed too, the rescue runs 3.0\'s sync.js', true, ['3.0']]
      ]) {
        await run.step(L, title, async () => {
          const phone = await makePhone({ serviceWorkers: 'block' });
          try {
            site.root = s31;
            site.rules.length = 0;
            site.rules.push({ test: (rel) => rel === SUB + '__blank.html', body: '<!doctype html><title>blank</title>' });
            site.rules.push({ test: (rel) => rel === SUB + 'fuel.js', status: 503 });
            site.rules.push(syncFails ? { test: (rel) => rel === SUB + 'sync.js', status: 503 } : { test: (rel) => rel === SUB + 'sync.js', body: syncOf('3.1') });
            await store(phone);
            const f = await startAndClose(phone);
            need(f && f.started && f.food && f.rel['fuel/fuel.js'] === '3.0', 'the page that ran: ' + brief(f));
            same(f.syncRuns, want, 'the sync modules that ran');
            same(f.modules, syncFails ? 1 : 0, 'module scripts started from the stored 3.0');
            return 'sync modules that ran: ' + f.syncRuns.join(', ') + '; ' + f.blobs + ' scripts from the stored 3.0';
          } finally { site.rules.length = 0; await phone.close(); }
        });
      }
    }

    // =====================================================================
    // preload (round 4, rel#4): a worker stopped over CDP, then a start with no signal, as on an iPhone
    // =====================================================================
    if (!ONLY || ONLY === 'preload') {
      const L = 'a stopped worker, no signal';
      const phone = await makePhone();
      const ok = await run.step(L, 'set-up: 3.0 installed (' + C30 + '); a 3.1 install that fails on one file (it leaves the 3.1 page in the HTTP cache)', async () => {
        await install(phone, base, C30, assetsOf(base).length);
        site.root = s31;
        site.rules.push({ test: (rel) => rel === SUB + 'icon-512.png', status: 404 });
        const { out, page } = await update(phone);
        await page.close();
        site.rules.length = 0;
        need(out === 'redundant', 'the 3.1 worker ended as: ' + out);
        return 'the 3.1 worker ended as ' + out;
      });
      if (ok) {
        await run.step(L, 'every worker stopped (as iOS does with an app in the background), then a start with no signal: the stored 3.0 page runs whole, not the 3.1 page from the HTTP cache (the sealed browser runs without ServiceWorkerAutoPreload: rel#4)', async () => {
          site.rules.push({ test: (rel) => /(^|\/)sw\.js$/.test(rel), drop: true });
          await phone.workers.cdp.send('ServiceWorker.stopAllWorkers');
          await sleep(3000);
          site.cut();
          // An ordinary page, not lib.coldPage: that one skips the HTTP cache, where Chromium's preload finds the 3.1 page.
          const page = await phone.context.newPage();
          let f = null;
          try {
            await page.goto(site.at(SUB + 'index.html'), { waitUntil: 'load', timeout: 30000 });
            await page.waitForFunction(() => (!!window.__overload && !!window.__overloadFood) || (document.getElementById('boot-note') && /did not finish/.test(document.getElementById('boot-note').textContent)), null, { timeout: 25000 });
            await sleep(600);
            f = await facts(page);
          } finally { site.down = false; site.rules.length = 0; await page.close().catch(() => {}); }
          need(whole(f, '3.0') && f.blobs === 0, 'the page that ran: ' + brief(f) + '; ' + (f ? f.blobs : '?') + ' scripts run by the rescue');
          return '3.0 whole from ' + C30 + ', no rescue';
        });
      }
      site.rules.length = 0; site.down = false;
      await onceEach(phone, L);
      await phone.close();
    }

    // =====================================================================
    // line (round 4, rel#5): the line at the top lies over nothing, below the status bar
    // =====================================================================
    if (!ONLY || ONLY === 'line') {
      const L = 'the line at the top';
      const LOOKS = 'Part of Fuel did not load, so it looks plain. Everything you logged is still on this phone. Close the app and open it again where there is signal or Wi-Fi.';
      const shots = path.resolve(String(args.shots || fs.mkdtempSync(path.join(require('os').tmpdir(), 'fuel-line-'))));
      fs.mkdirSync(shots, { recursive: true });
      const INSET = 47;   // an iPhone's status bar, emulated (Emulation.setSafeAreaInsetsOverride)
      const cases = [['a script missing (shared/icons.js)', ['shared/icons.js'], SCRIPT_LOST], ['its own stylesheet missing (fuel.css)', [SUB + 'fuel.css'], LOOKS], ['no stylesheet (shared/ui.css and fuel.css)', ['shared/ui.css', SUB + 'fuel.css'], LOOKS]];
      const phone = await makePhone({ serviceWorkers: 'block' });
      site.root = base;
      for (const scheme of ['dark', 'light']) for (const width of [390, 320]) for (const [what, lost, words] of cases) {
        await run.step(L, width + ' px, ' + scheme + ', ' + what + ': below the status bar, over nothing; the top bar and the screen start below it', async () => {
          site.rules.length = 0;
          lost.forEach((f) => site.rules.push({ test: (rel) => rel === f, status: 404 }));
          const page = await lib.coldPage(phone.context);
          try {
            await page.setViewportSize({ width, height: 844 });
            await page.emulateMedia({ colorScheme: scheme });
            await page.addInitScript((s) => {   // Fuel's own theme setting (the seeded state's) wins over the phone's
              try { localStorage.setItem('fuel.theme', s); const st = JSON.parse(localStorage.getItem('fuel.state.v1')); if (st && st.settings) { st.settings.theme = s; localStorage.setItem('fuel.state.v1', JSON.stringify(st)); } } catch (e) { /* ignore */ }
            }, scheme);
            const cdp = await phone.context.newCDPSession(page);
            await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: INSET, bottom: 34, left: 0, right: 0 } });
            await page.goto(site.at(SUB + 'index.html'), { waitUntil: 'load', timeout: 30000 });
            await page.waitForFunction(() => !!window.__overload && !!document.getElementById('boot-plain'), null, { timeout: 15000 });
            await sleep(300);
            const t = await lib.topLine(page);
            const file = path.join(shots, 'fuel-' + lost.map((f) => path.basename(f).replace(/\.\w+$/, '')).join('+') + '-' + width + '-' + scheme + '.png');
            await page.screenshot({ path: file });
            need(t.text === words, 'the line says: ' + t.text);
            need(t.textTop >= INSET, 'its text starts at ' + t.textTop + ' px, under the status bar (' + INSET + ' px)');
            need(!t.covers.length && !t.hidden, 'it lies over ' + (t.covers.join(', ') || 'nothing') + (t.hidden ? '; something lies over it' : ''));
            need(t.barTop == null || t.barTop >= t.bottom - 0.5, 'the top bar starts at ' + t.barTop + ' px, the line ends at ' + t.bottom);
            return 'line ' + Math.round(t.top) + '-' + Math.round(t.bottom) + ' px, text from ' + Math.round(t.textTop) + ', top bar from ' + Math.round(t.barTop) + (t.fixedBar ? ' (fixed)' : ' (in the flow)') + '; ' + path.basename(file);
          } finally { site.rules.length = 0; await page.close().catch(() => {}); }
        });
      }
      console.log('# screenshots of the line: ' + shots);
      await phone.close();
    }
  } catch (e) {
    run.say(false, 'fuel-release', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | '));
  }
  for (const p of phones) await p.close().catch(() => {});
  const hosts = [...new Set(browser.outside)];
  await browser.close();
  await site.stop();
  console.log('# requests to other hosts, all stopped in the browser: ' + (hosts.join(', ') || 'none'));
  run.done();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
