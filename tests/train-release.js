#!/usr/bin/env node
/* Overload: what a phone keeps across releases when a server edge is stale or an install is cut off. Findings
 * upgrade#1 to #5 of the final review (dev/notes/review-findings.md has the earlier rounds) and the sync module
 * item of the code review's list.
 *
 *   node tests/train-release.js [--tree=<folder>] [--port=8960] [--only=stale|v28|page|cache|half|sync|preload|line] [--shots=<folder>]
 *
 * Real service workers in a sealed Chromium (tests/lib.js: no Playwright routing, which makes Chromium install the
 * same worker again at every update check; the browser itself stops every host but 127.0.0.1). The server is
 * lib.startSite: the tree under /overload/ by path, as GitHub Pages serves it (the query is ignored). Every start is
 * a cold one (lib.coldPage: nothing in the browser's memory cache). Trees, all temporary copies: 3.0 = this tree;
 * 3.1 and 3.2 = sh bump.sh 3.1 and 3.2 on copies; v2.8 = git 3b17963. Each versioned file of 3.0, 3.1 and 3.2 gets a
 * marker at its end, so a check can tell which release's copy ran.
 *
 *   stale  (upgrade#1) 3.0 installed; 3.1 published while one edge still has 3.0's train.css and backup.js: the 3.1
 *          install is refused and overload-v24 stays as it was; a start meanwhile gets the 3.1 page under 3.0's
 *          worker: it starts without them (refused, not stored) and says why it looks plain; once the edge is right
 *          the next start installs 3.1 whole, and 3.1 starts whole, also with no signal.
 *   v28    (upgrade#1) v2.8 installed; 3.0 published while an edge has v2.8's backup.js and connector.js (names both
 *          releases use): the 3.0 install is refused, v2.8 starts with no signal; once the edge is right 3.0 installs
 *          with its own copies, and two removals of the old food log keep two safety copies (U3 stays fixed).
 *          Round 4, rel#2: a start meanwhile, under v2.8's worker (which checks nothing), runs the 3.0 page with those
 *          stale files: overload.js uses neither (no automatic copies, no connector cards), Remove keeps the food log,
 *          the line at the top says part did not load; the split copy, taken once 3.0 runs whole, is v2.8's text.
 *   page   (upgrade#2) 3.1 installed whole; a start that gets 3.0's page from a stale edge runs the stored 3.1 page;
 *          a 3.2 page that arrives before its worker is shown and not stored.
 *   cache  (upgrade#3) sw.js changed without a new cache name; its install fails on one file: overload-v24 stays,
 *          entry for entry and byte for byte, and the app starts with no signal. (bump.sh --check refusing such a
 *          change: tests/train-bump.js.)
 *   half   (upgrade#4) a 3.1 install stopped during its downloads (every worker stopped) leaves no cache at all; a
 *          cache whose install did not finish (put by hand) never serves a file and the start-up rescue never takes it
 *          (a 3.1 page without its files and a 3.2 page without its main script both start the whole 3.0); the next
 *          install of another release deletes it, even when that install fails.
 *   sync   (code review, not checked) the 3.1 page whose overload.js fails but whose sync.js ran: the rescue starts
 *          3.0 without running a second sync module; when sync.js failed too, 3.0's sync.js is run.
 *   preload (round 4, rel#4) 3.0 installed, a 3.1 install that failed (its fetches leave the 3.1 page in the HTTP
 *          cache), every worker stopped over CDP, a start with no signal: the stored 3.0 page runs whole. The sealed
 *          browser runs without Chromium's ServiceWorkerAutoPreload, which would answer that start from the HTTP cache.
 *   line   (round 4, rel#5) the line at the top ("Part of Overload did not load"), at 390 and 320 px, dark and light,
 *          with an iPhone's status bar emulated (47 px), with a script missing, without train.css, and without any
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
const T = require('./train-common');

const args = T.args();
const PORT = Number(args.port) || 8960;
const TREE = args.tree ? path.resolve(String(args.tree)) : lib.REPO;
const ONLY = args.only ? String(args.only) : '';
const run = T.runner('train-release');
const { need, same } = run;
const sleep = lib.sleep;
const fx = lib.loadFixture('v28-state-small');
const PLAIN = 'Part of Overload did not load, so it looks plain. Everything you logged is still on this phone. Close the app and open it again where there is signal or Wi-Fi.';
const PLAIN_JS = 'Part of Overload did not load, so some of it may not work. Everything you logged is still on this phone. Close the app and open it again where there is signal or Wi-Fi.';

// ---------------------------------------------------------------------------
// Trees (throw-away copies made with tests/lib.js)
// ---------------------------------------------------------------------------
const temp = [];
process.on('exit', () => temp.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* leave it */ } }));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const cacheOf = (dir) => lib.workerOf(dir).cache;
const assetsOf = (dir) => lib.workerOf(dir).assets;

// ---------------------------------------------------------------------------
// Phones and pages
// ---------------------------------------------------------------------------
// What runs in a page: the ?v= of its scripts, which release's copy of each marked file ran (window.__rel and the
// stylesheet markers), the start-up rescue's note, the "looks plain" line.
const facts = (page) => page.evaluate((keys) => {
  const cs = getComputedStyle(document.documentElement), css = {};
  keys.forEach((k) => { css[k] = (cs.getPropertyValue('--rel-' + k) || '').replace(/"/g, '').trim(); });
  return {
    started: !!window.__overload,
    versions: [...new Set([...document.querySelectorAll('script[src]')].map((s) => (/[?&]v=([^&#]+)/.exec(s.getAttribute('src')) || [])[1]).filter(Boolean))],
    rel: Object.assign({}, window.__rel || {}),
    css,
    blobs: document.querySelectorAll('script[src^="blob:"]').length,
    modules: document.querySelectorAll('script[type="module"][src^="blob:"]').length,
    note: (document.getElementById('boot-note') || {}).textContent || null,
    plain: (document.getElementById('boot-plain') || {}).textContent || null,
    foodTab: !!document.querySelector('.tab[data-screen="food"]'),
    controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    syncRuns: window.__syncRuns || null
  };
}, ['shared-ui-css', 'train-css']);
// Every marked file and stylesheet of the page is of release v.
// (Five scripts: sync.js cannot run on a sealed phone, its Firebase files are on www.gstatic.com.)
const whole = (f, v) => !!f && f.started && f.versions.length === 1 && f.versions[0] === v && Object.keys(f.rel).length >= 5 && Object.values(f.rel).every((x) => x === v) && Object.values(f.css).every((x) => x === v) && !f.plain;
const brief = (f) => (f ? JSON.stringify({ started: f.started, versions: f.versions, rel: [...new Set(Object.values(f.rel))], css: f.css, note: f.note, plain: f.plain && f.plain.slice(0, 40) }) : 'no page');

(async () => {
  const site = await lib.startSite(PORT);
  const browser = await lib.launch({ sealed: true });
  const phones = [];
  const v28 = T.extractV28(); temp.push(v28);
  const base = lib.markRelease(lib.copyTree(TREE), '3.0');
  const s31 = lib.markRelease(lib.nextRelease(TREE, '3.1'), '3.1');
  const s32 = lib.markRelease(lib.nextRelease(s31, '3.2'), '3.2');
  const C30 = cacheOf(base), C31 = cacheOf(s31), C32 = cacheOf(s32), C28 = cacheOf(v28);
  console.log('# 3.0 tree: ' + TREE + (TREE === lib.REPO ? ' (the working tree)' : ' (a copy)') + '; caches ' + [C28, C30, C31, C32].join(', ') + '; port ' + PORT);
  const DONE = site.at('installed');

  async function makePhone(opts) {
    const phone = await lib.newPhone(browser, Object.assign({ sealed: true, serviceWorkers: 'allow', now: fx.meta.now, timezoneId: fx.meta.tz }, opts || {}));
    await phone.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.url });
    await lib.seedV28(phone.context, fx);
    if (!(opts && opts.serviceWorkers === 'block')) phone.workers = await lib.watchWorkers(phone.context, site.served);
    phones.push(phone);
    return phone;
  }
  // A cold start that never throws: waits for the app, or for the rescue's last word. { page, facts } or { page, error }.
  async function start(phone, rel) {
    const page = await lib.coldPage(phone.context);
    page.dialogs = []; page.on('dialog', (d) => { page.dialogs.push(d.message()); d.accept().catch(() => {}); });
    try {
      await page.goto(site.at(rel || 'index.html'), { waitUntil: 'load', timeout: 30000 });
      await page.waitForFunction(() => !!window.__overload || (document.getElementById('boot-note') && /did not finish/.test(document.getElementById('boot-note').textContent)), null, { timeout: 25000 });
      await sleep(600);
      return { page, facts: await facts(page) };
    } catch (e) { return { page, error: String(e.message).split('\n')[0] }; }
  }
  async function startAndClose(phone, rel) { const r = await start(phone, rel); await r.page.close().catch(() => {}); return r.facts || null; }
  // Publishes `root`, opens the app and waits until `cache` holds the install list and the page is controlled.
  async function install(phone, root, cache, count) {
    site.root = root; site.rules.length = 0; site.down = false;
    const r = await start(phone);
    const ok = await lib.until(async () => { const c = await lib.cachesOf(r.page); return c[cache] && c[cache].length >= count && (await r.page.evaluate(() => !!navigator.serviceWorker.controller)); }, 40000);
    await sleep(500);
    await r.page.close();
    if (!ok) throw new Error('the worker with ' + cache + ' did not install');
  }
  // A page of this origin outside the app's scope: it sees Cache Storage and the registration, and opening it
  // starts no update check of its own (a navigation inside the scope does).
  async function outside(phone) { const page = await lib.coldPage(phone.context); await page.goto(site.url + '/__outside.html'); return page; }
  // Looks for a new worker now and says how it ends: 'activated', 'redundant' (its install failed), 'none', 'timeout'.
  async function update(phone) {
    const page = await outside(phone);
    const out = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration('/overload/');
      if (!reg) return 'no registration';
      let found = false;
      const end = new Promise((resolve) => {
        const watch = (w) => { if (!w) return; found = true; const look = () => { if (w.state === 'redundant' || w.state === 'activated') resolve(w.state); }; w.addEventListener('statechange', look); look(); };
        reg.addEventListener('updatefound', () => watch(reg.installing));
        watch(reg.installing);
      });
      await reg.update().catch(() => {});
      return Promise.race([end, new Promise((r) => setTimeout(() => r(found ? 'timeout' : 'none'), 30000))]);
    }).catch((e) => 'error: ' + String(e.message).split('\n')[0]);
    await lib.until(() => page.evaluate(async () => { const g = await navigator.serviceWorker.getRegistration('/overload/'); return !g || (!g.installing && !g.waiting); }), 20000);
    await sleep(500);
    return { out, page };
  }
  const counts = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.length]));
  const onceEach = (phone, label) => run.step(label, 'no worker file was installed twice (sealed phone, no routing)', async () => {
    const twice = phone.workers.installedTwice();
    need(!twice.length, 'installed more than once: ' + twice.map((x) => x.script.replace(site.url, '') + ' x' + x.times).join(', '));
    return phone.workers.installed().length + ' installs finished, ' + phone.workers.count() + ' worker versions in all';
  });

  try {
    // =====================================================================
    // stale: 3.1 published while an edge still has 3.0's train.css and backup.js
    // =====================================================================
    if (!ONLY || ONLY === 'stale') {
      const L = 'stale file, 3.0 -> 3.1';
      const phone = await makePhone();
      const STALE = ['train.css', 'backup.js'];
      let ok = await run.step(L, 'set-up: 3.0 installed under its own worker', async () => {
        await install(phone, base, C30, assetsOf(base).length);
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
        const stale = { test: (rel) => STALE.includes(rel), root: base };
        site.rules.push(stale);
        let before = null;
        ok = await run.step(L, 'the 3.1 install that gets 3.0\'s ' + STALE.join(' and ') + ' is refused; ' + C30 + ' stays as it was', async () => {
          const probe = await outside(phone);
          before = (await lib.cachesOf(probe))[C30].slice().sort();
          await probe.close();
          const { out, page } = await update(phone);
          const cs = await lib.cachesOf(page);
          await page.close();
          need(out === 'redundant', 'the 3.1 worker ended as: ' + out);
          need(!cs[C31] && JSON.stringify((cs[C30] || []).slice().sort()) === JSON.stringify(before), 'caches: ' + JSON.stringify(counts(cs)));
          return 'the 3.1 worker ended as ' + out + '; ' + C30 + ' unchanged (' + before.length + ' entries)';
        });
        await run.step(L, 'meanwhile the 3.1 page runs under 3.0\'s worker without the refused files, says why it looks plain, and nothing is stored under their 3.1 names', async () => {
          const r = await start(phone);
          const kept = await Promise.all(STALE.map((f) => lib.cacheText(r.page, C30, site.at(f + '?v=3.1'))));
          await r.page.close();
          const f = r.facts;
          need(f && f.started && f.versions.join() === '3.1' && f.rel['overload.js'] === '3.1', 'the page that ran: ' + brief(f));
          need(f.css['train-css'] === '' && f.rel['backup.js'] === undefined, 'a refused file ran: ' + brief(f));
          need(f.plain === PLAIN, 'the line at the top says: ' + f.plain);
          need(kept.every((t) => t === null), 'stored under a 3.1 name: ' + STALE.filter((x, i) => kept[i] !== null).join(', '));
          return '3.1 started without ' + STALE.join(' and ') + '; "' + f.plain.slice(0, 50) + '…"';
        });
        site.rules.length = 0;
        ok = ok && await run.step(L, 'the edge right again: the next start installs 3.1 (' + C31 + '), with 3.1\'s train.css and backup.js', async () => {
          const r = await start(phone);
          const cs = await lib.until(async () => { const c = await lib.cachesOf(r.page); return c[C31] && !c[C30] ? c : null; }, 40000);
          await r.page.close().catch(() => {});
          need(cs, 'no ' + C31 + ' after 40 s');
          const p = await outside(phone);
          const got = await Promise.all(STALE.map((x) => lib.cacheText(p, C31, site.at(x + '?v=3.1'))));
          await p.close();
          const wrong = STALE.filter((x, i) => got[i] !== read(s31, x));
          need(!wrong.length, 'not 3.1\'s in ' + C31 + ': ' + wrong.join(', '));
          return Object.keys(cs).join(', ') + '; ' + STALE.join(' and ') + ' are 3.1\'s';
        });
        if (ok) {
          await run.step(L, '3.1 starts whole, with signal and with none', async () => {
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
    // v28: 3.0 published while an edge has v2.8's backup.js and connector.js
    // =====================================================================
    if (!ONLY || ONLY === 'v28') {
      const L = 'v2.8 -> 3.0, stale file';
      const phone = await makePhone();
      const STALE = ['backup.js', 'connector.js'];
      let ok = await run.step(L, 'set-up: v2.8 installed under its own worker (' + C28 + ')', async () => {
        await install(phone, v28, C28, assetsOf(v28).length);
        const f = await startAndClose(phone);
        need(f && f.started && f.versions.join() === '2.8' && f.foodTab, brief(f));
        return C28;
      });
      if (ok) {
        site.root = base;
        site.rules.push({ test: (rel) => STALE.includes(rel), root: v28 });
        ok = await run.step(L, 'the 3.0 install that gets v2.8\'s ' + STALE.join(' and ') + ' is refused; ' + C28 + ' stays, and v2.8 starts with no signal', async () => {
          const { out, page } = await update(phone);
          const cs = await lib.cachesOf(page);
          await page.close();
          need(out === 'redundant', 'the 3.0 worker ended as: ' + out);
          need(!cs[C30] && cs[C28] && cs[C28].length >= assetsOf(v28).length, 'caches: ' + JSON.stringify(counts(cs)));
          site.cut();
          let off;
          try { off = await startAndClose(phone); } finally { site.down = false; }
          need(off && off.started && off.versions.join() === '2.8' && off.foodTab, 'with no signal: ' + brief(off));
          return 'the 3.0 worker ended as ' + out + '; v2.8 from ' + C28 + ' with no signal';
        });
        // Round 4, rel#2: v2.8's worker checks nothing, so a start meanwhile runs the 3.0 page with the stale files.
        ok = ok && await run.step(L, 'meanwhile a start under v2.8\'s worker gets the 3.0 page with v2.8\'s backup.js and connector.js: overload.js uses neither (no copies, no connector cards), Remove keeps the food log, and the line at the top says part did not load (rel#2)', async () => {
          const r = await start(phone);
          const page = r.page;
          try {
            const f = r.facts;
            need(f && f.started && f.versions.join() === '3.0', 'the page that ran: ' + brief(f));
            const mods = await page.evaluate(() => ({
              backup: !window.__overloadBackup ? 'missing' : window.__overloadBackup.release || (window.__overloadBackup.KEEP_REMOVALS ? '3.0 without a release' : "v2.8's"),
              conn: !window.__overloadConn ? 'missing' : window.__overloadConn.release || "v2.8's",
              worker: navigator.serviceWorker.controller ? new URL(navigator.serviceWorker.controller.scriptURL).pathname : null
            }));
            need(mods.backup === "v2.8's" && mods.conn === "v2.8's", 'the stale files did not run (the check lost its point): ' + JSON.stringify(mods));
            need(f.plain === PLAIN_JS, 'the line at the top says: ' + f.plain);
            await lib.openTab(page, 'settings');
            await page.waitForFunction(() => !/Looking for copies/.test((document.getElementById('safety-copies') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
            const settings = await page.evaluate(() => ({ copies: ((document.getElementById('safety-copies') || {}).textContent || '').trim(), conn: !!document.getElementById('conn-cards') }));
            need(settings.copies === 'Automatic copies are not available.' && !settings.conn, 'Settings shows: ' + JSON.stringify(settings));
            await page.click('#handover [data-action="handover-copy"]');
            await page.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('overload.backup')).split.copied; } catch (e) { return false; } }, null, { timeout: 8000 });
            await sleep(300);
            await page.click('#handover [data-action="handover-remove"]');
            await page.waitForFunction(() => /nothing was removed/.test((document.getElementById('toast') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
            await sleep(500);
            const after = await page.evaluate(() => ({ days: Object.keys(window.__overload.state.diary).length, toast: ((document.getElementById('toast') || {}).textContent || '').trim() }));
            const stored = await page.evaluate(() => window.__overloadBackup.list().then((l) => l.map((m) => m.id), () => ['(the list could not be read)']));
            need(after.days === Object.keys(fx.state.diary).length, 'food days on the phone after Remove: ' + after.days + '; toast: ' + after.toast);
            need(after.toast === 'The safety copy could not be stored, so nothing was removed. Try again.', 'the toast says: ' + after.toast);
            need(!stored.filter((id) => !/^day-/.test(id)).length, 'copies v2.8\'s backup.js stored in this 3.0 page: ' + stored.join(', '));   // the day copy is v2.8's own, from its start
            return 'v2.8\'s backup.js and connector.js ran and were not used; "' + after.toast + '"; ' + after.days + ' food days kept';
          } finally { await page.close().catch(() => {}); }
        });
        site.rules.length = 0;
        let page = null;
        ok = ok && await run.step(L, 'the edge right again: 3.0 installs (' + C30 + ') with its own backup.js and connector.js', async () => {
          const r = await start(phone);
          const cs = await lib.until(async () => { const c = await lib.cachesOf(r.page); return c[C30] && !c[C28] ? c : null; }, 40000);
          await r.page.close().catch(() => {});
          need(cs, 'no ' + C30 + ' after 40 s');
          const p = await start(phone);
          page = p.page;
          const got = await Promise.all(STALE.map((x) => lib.cacheText(page, C30, site.at(x + '?v=3.0'))));
          const wrong = STALE.filter((x, i) => got[i] !== read(base, x));
          need(!wrong.length, 'not 3.0\'s in ' + C30 + ': ' + wrong.map((x, i) => x + ' (' + (got[STALE.indexOf(x)] || 'missing').length + ' chars)').join(', '));
          need(whole(p.facts, '3.0') && p.facts.controlled, brief(p.facts));
          return Object.keys(cs).join(', ') + '; 3.0 whole under its worker';
        });
        if (ok) {
          await run.step(L, 'Remove the old food log twice (a food day arriving between): both removals keep a safety copy', async () => {
            const days = Object.keys(fx.state.diary).length;
            const remove = async () => {
              await lib.openTab(page, 'settings');
              await page.click('#handover [data-action="handover-copy"]');
              await page.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('overload.backup')).split.copied; } catch (e) { return false; } }, null, { timeout: 8000 });
              await sleep(300);
              await page.click('#handover [data-action="handover-remove"]');
              await page.waitForFunction(() => !Object.keys(window.__overload.state.diary).length, null, { timeout: 8000 });
              await sleep(800);
            };
            await remove();
            // A food day that arrives afterwards (from v2.8 on a half-arrived update, a roll-back or a second phone).
            await page.evaluate(() => {
              const s = JSON.parse(localStorage.getItem('overload.state.v1'));
              s.diary['2026-11-22'] = [{ id: 'late1', name: 'Banana', kcal: 105, p: 1, c: 27, f: 0, meal: 'Snack', t: Date.now() }];
              localStorage.setItem('overload.state.v1', JSON.stringify(s));
            });
            await page.close();
            page = (await start(phone)).page;
            await remove();
            const copies = await page.evaluate(() => window.__overloadBackup.list().then((l) => l.filter((m) => m.kind === 'foodremove').map((m) => m.foodDays)));
            const split = await page.evaluate(() => window.__overloadBackup.get('before-split').then((c) => (c ? c.text : null)));
            await page.close();
            need(copies.length === 2 && copies.includes(days) && copies.includes(1), 'removal copies, food days in each: ' + JSON.stringify(copies));
            need(split === fx.text, 'the copy "Before the split into two apps" is not v2.8\'s text byte for byte (' + (split == null ? 'missing' : split.length + ' of ' + fx.text.length + ' characters') + ')');
            return '2 removal copies, with ' + days + ' and 1 food days; the split copy is v2.8\'s text';
          });
        }
      }
      site.rules.length = 0; site.down = false;
      await onceEach(phone, L);
      await phone.close();
    }

    // =====================================================================
    // page: 3.1 installed; an edge with the previous release's page; a page of the next one
    // =====================================================================
    if (!ONLY || ONLY === 'page') {
      const L = 'stale page';
      const phone = await makePhone();
      let ok = await run.step(L, 'set-up: 3.0 installed, then 3.1 takes over whole (' + C31 + ')', async () => {
        await install(phone, base, C30, assetsOf(base).length);
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
          site.rules.push({ test: (rel) => rel === 'index.html', root: base });
          let f;
          try { f = await startAndClose(phone); } finally { site.rules.length = 0; }
          need(whole(f, '3.1'), 'the page that ran: ' + brief(f));
          return '3.1 started; the server had handed out 3.0\'s page';
        });
        await run.step(L, 'a 3.2 page that arrives before its worker is shown (3.2 whole), and the stored page stays 3.1\'s', async () => {
          site.root = s32;
          site.rules.push({ test: (rel) => rel === 'sw.js', drop: true });   // 3.2's worker does not get through yet
          let r;
          try { r = await start(phone); await sleep(700); } finally { site.rules.length = 0; site.root = s31; }
          const kept = await lib.cacheText(r.page, C31, site.at('index.html'));
          await r.page.close();
          need(whole(r.facts, '3.2'), 'the page that ran: ' + brief(r.facts));
          need(/\?v=3\.1/.test(kept || '') && !/\?v=3\.2/.test(kept || ''), 'the stored page is not 3.1\'s');
          return '3.2 ran; ' + C31 + ' still has the 3.1 page';
        });
      }
      site.rules.length = 0; site.down = false;
      await onceEach(phone, L);
      await phone.close();
    }

    // =====================================================================
    // cache: sw.js changed without a new cache name; that install fails on one file
    // =====================================================================
    if (!ONLY || ONLY === 'cache') {
      const L = 'same cache name';
      const edited = lib.copyTree(base);
      fs.writeFileSync(path.join(edited, 'sw.js'), read(base, 'sw.js').replace('const NET_WAIT = 3000;', 'const NET_WAIT = 2500;'));
      const phone = await makePhone();
      let ok = await run.step(L, 'set-up: 3.0 installed (' + C30 + '); the server then has a changed sw.js under the same cache name', async () => {
        await install(phone, base, C30, assetsOf(base).length);
        need(cacheOf(edited) === C30 && read(edited, 'sw.js') !== read(base, 'sw.js'), 'the edited worker is not a changed file with the same cache');
        return 'cache ' + cacheOf(edited) + ' in both';
      });
      if (ok) {
        await run.step(L, 'its install fails (icon-512.png does not arrive): ' + C30 + ' stays whole, and the app starts with no signal', async () => {
          site.root = edited;
          site.rules.push({ test: (rel) => rel === 'icon-512.png', drop: true });
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
          need(out === 'redundant', 'the changed worker ended as: ' + out);
          need(JSON.stringify((cs[C30] || []).slice().sort()) === JSON.stringify(was) && JSON.stringify(nowTexts) === JSON.stringify(wasTexts), C30 + ' changed: ' + was.filter((u, i) => nowTexts[i] !== wasTexts[i]).map((u) => u.replace(site.url, '')).join(', '));
          const lacking = assetsOf(base).map((a) => new URL(a, site.at('')).href).filter((u) => !(cs[C30] || []).includes(u));
          need(cs[C30] && !lacking.length && said === '3.0', 'caches: ' + JSON.stringify(counts(cs)) + '; lacking ' + lacking.join(', ') + '; "installed" says ' + said);
          site.cut();
          let off;
          try { off = await startAndClose(phone); } finally { site.down = false; }
          need(whole(off, '3.0'), 'with no signal: ' + brief(off));
          return 'the changed worker ended as ' + out + '; ' + C30 + ' whole; 3.0 starts with no signal';
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
      const FAST = ['overload.js', 'sync.js'];
      let ok = await run.step(L, 'set-up: 3.0 installed (' + C30 + ')', async () => {
        await install(phone, base, C30, assetsOf(base).length);
        return C30;
      });
      if (ok) {
        await run.step(L, 'a 3.1 install stopped during its downloads (every worker stopped, as when the app goes to the background) leaves no cache: nothing is stored before every file has arrived', async () => {
          site.root = s31;
          site.log.length = 0;
          site.rules.push({ test: (rel) => rel !== 'sw.js' && !FAST.includes(rel), delay: 6000 });
          const p = await outside(phone);
          p.evaluate(() => navigator.serviceWorker.getRegistration('/overload/').then((r) => r.update())).catch(() => {});
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
          const half = [['', 'index.html'], ['index.html', 'index.html'], ['programs.js?v=3.1', 'programs.js'], ['sync.js?v=3.1', 'sync.js'], ['overload.js?v=3.1', 'overload.js']];
          const p = await outside(phone);
          await p.evaluate(async ([cache, list]) => { await caches.delete(cache); const c = await caches.open(cache); for (const e of list) await c.put(e.url, new Response(e.body, { headers: { 'Content-Type': e.type } })); },
            [C31, half.map(([a, f]) => ({ url: site.at(a), body: read(s31, f), type: /\.html$/.test(f) ? 'text/html' : 'text/javascript' }))]);
          const cs = await lib.cachesOf(p);
          await p.close();
          need(cs[C31] && cs[C31].length === half.length, 'caches: ' + JSON.stringify(counts(cs)));
          return JSON.stringify(counts(cs));
        });
      }
      if (ok) {
        await run.step(L, 'the 3.1 page arrives, none of its files do: the rescue starts the whole 3.0, nothing comes from the half cache', async () => {
          site.rules.push({ test: (rel) => rel !== 'index.html', drop: true });   // sw.js too: no update check gets through
          let f;
          try { f = await startAndClose(phone); } finally { site.rules.length = 0; }
          need(f && f.started && f.rel['overload.js'] === '3.0' && !Object.values(f.rel).includes('3.1') && f.css['train-css'] === '3.0' && f.blobs >= 5, 'the page that ran: ' + brief(f));
          return f.blobs + ' scripts from the stored 3.0; no file of the half 3.1';
        });
        await run.step(L, '3.2 published, its page arrives without its main script: the rescue starts the whole 3.0, not the half 3.1', async () => {
          site.root = s32;
          site.rules.push({ test: (rel) => rel === 'overload.js' || rel === 'sw.js', drop: true });
          let f;
          try { f = await startAndClose(phone); } finally { site.rules.length = 0; }
          need(f && f.started && f.rel['overload.js'] === '3.0' && !Object.values(f.rel).includes('3.1'), 'the page that ran: ' + brief(f));
          return 'overload.js ran from the stored 3.0; no file of the half 3.1';
        });
        await run.step(L, 'the 3.2 install starts by deleting the half ' + C31 + ', and when it fails it leaves ' + C30 + ' alone', async () => {
          site.root = s32;
          site.rules.push({ test: (rel) => rel === 'icon-512.png', drop: true });
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
      // Stand-ins for the sync module: they note that they ran (the real one also needs the Firebase files).
      const syncOf = (v) => '/* release ' + v + ' (a stand-in) */\nwindow.__syncRuns = (window.__syncRuns || []).concat(' + JSON.stringify(v) + ');\n';
      const store = async (phone) => {
        const page = await phone.context.newPage();
        await page.goto(site.at('__blank.html'));
        const files = lib.versionedFiles(base).filter((f) => !f.startsWith('fuel/'));
        await page.evaluate(async ([list, at, done, cache]) => {
          const c = await caches.open(cache);
          for (const e of list) await c.put(at + e.f + '?v=3.0', new Response(e.body, { headers: { 'Content-Type': /\.css$/.test(e.f) ? 'text/css' : 'text/javascript' } }));
          await c.put(done, new Response('3.0'));
        }, [files.map((f) => ({ f, body: f === 'sync.js' ? syncOf('3.0') : read(base, f) })), site.at(''), DONE, C30]);
        await page.close();
      };
      for (const [title, syncFails, want] of [
        ['the 3.1 page whose overload.js fails and whose sync.js ran: the rescue starts 3.0 and runs no second sync module', false, ['3.1']],
        ['control: when sync.js failed too, the rescue runs 3.0\'s sync.js', true, ['3.0']]
      ]) {
        await run.step(L, title, async () => {
          const phone = await makePhone({ serviceWorkers: 'block' });
          try {
            site.root = s31;
            site.rules.length = 0;
            site.rules.push({ test: (rel) => rel === '__blank.html', body: '<!doctype html><title>blank</title>' });
            site.rules.push({ test: (rel) => rel === 'overload.js', status: 503 });
            site.rules.push(syncFails ? { test: (rel) => rel === 'sync.js', status: 503 } : { test: (rel) => rel === 'sync.js', body: syncOf('3.1') });
            await store(phone);
            const f = await startAndClose(phone);
            need(f && f.started && f.rel['overload.js'] === '3.0', 'the page that ran: ' + brief(f));
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
        site.rules.push({ test: (rel) => rel === 'icon-512.png', status: 404 });
        const { out, page } = await update(phone);
        await page.close();
        site.rules.length = 0;
        need(out === 'redundant', 'the 3.1 worker ended as: ' + out);
        return 'the 3.1 worker ended as ' + out;
      });
      if (ok) {
        await run.step(L, 'every worker stopped (as iOS does with an app in the background), then a start with no signal: the stored 3.0 page runs whole, not the 3.1 page from the HTTP cache (the sealed browser runs without ServiceWorkerAutoPreload: rel#4)', async () => {
          site.rules.push({ test: (rel) => rel === 'sw.js', drop: true });
          await phone.workers.cdp.send('ServiceWorker.stopAllWorkers');
          await sleep(3000);
          site.cut();
          // An ordinary page, not lib.coldPage: that one skips the HTTP cache, where Chromium's preload finds the 3.1 page.
          const page = await phone.context.newPage();
          let f = null;
          try {
            await page.goto(site.at('index.html'), { waitUntil: 'load', timeout: 30000 });
            await page.waitForFunction(() => !!window.__overload || (document.getElementById('boot-note') && /did not finish/.test(document.getElementById('boot-note').textContent)), null, { timeout: 25000 });
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
      const shots = path.resolve(String(args.shots || fs.mkdtempSync(path.join(require('os').tmpdir(), 'overload-line-'))));
      fs.mkdirSync(shots, { recursive: true });
      const INSET = 47;   // an iPhone's status bar, emulated (Emulation.setSafeAreaInsetsOverride)
      const cases = [['a script missing (shared/icons.js)', ['shared/icons.js'], PLAIN_JS], ['its own stylesheet missing (train.css)', ['train.css'], PLAIN], ['no stylesheet (shared/ui.css and train.css)', ['shared/ui.css', 'train.css'], PLAIN]];
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
            const cdp = await phone.context.newCDPSession(page);
            await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: INSET, bottom: 34, left: 0, right: 0 } });
            await page.goto(site.at('index.html'), { waitUntil: 'load', timeout: 30000 });
            await page.waitForFunction(() => !!window.__overload && !!document.getElementById('boot-plain'), null, { timeout: 15000 });
            await sleep(300);
            const t = await lib.topLine(page);
            const file = path.join(shots, 'overload-' + lost.map((f) => path.basename(f).replace(/\.\w+$/, '')).join('+') + '-' + width + '-' + scheme + '.png');
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
    run.say(false, 'train-release', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | '));
  }
  for (const p of phones) await p.close().catch(() => {});
  const hosts = [...new Set(browser.outside)];
  await browser.close();
  await site.stop();
  console.log('# requests to other hosts, all stopped in the browser: ' + (hosts.join(', ') || 'none'));
  run.done();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
