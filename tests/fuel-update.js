#!/usr/bin/env node
/* Fuel 3.0: how the page takes an update of its offline worker (the code in fuel/fuel.js, not the worker).
 *
 *   node tests/fuel-update.js [--port=8426]
 *
 * The page's part is tested with stand-in workers, so it does not depend on what fuel/sw.js stores: the test
 * copies the page's own files into a temporary folder and puts a three-line worker beside them, which it
 * rewrites to make "a new release". A second stand-in plays the training app's worker, one folder up.
 *   - a first install does not reload the page and shows no "Updating…";
 *   - an update while nothing is going on shows "Updating…" and reloads once;
 *   - an update while a sheet is open, or while a box has the keyboard, does not reload: the top bar offers
 *     "Update ready", and what was typed is still there; a tap on it reloads;
 *   - a page that the training app's worker controlled when it loaded is not reloaded when Fuel's own
 *     worker takes over from it (nothing about the page is out of date), and is reloaded by Fuel's next update;
 *   - a first install that fails leaves no registration: Settings says the app is not ready to work offline,
 *     and coming back to the front registers the worker again (dev/notes/review-findings.md, O3).
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const F = require('./fuel-common');

const args = F.args();
const PORT = Number(args.port) || 8426;
const run = F.runner('fuel-update');
const { need, same } = run;

// The site, in a folder of its own: Fuel's page files, the stylesheet and icons it shares, and stand-in workers.
function buildSite(tmp) {
  const fuel = path.join(tmp.dir, 'fuel');
  fs.mkdirSync(fuel);
  for (const f of ['index.html', 'fuel.js', 'food.js', 'backup.js', 'fuel.css', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png']) fs.copyFileSync(path.join(lib.REPO, 'fuel', f), path.join(fuel, f));
  fs.mkdirSync(path.join(tmp.dir, 'shared'));
  for (const f of ['ui.css', 'icons.js']) fs.copyFileSync(path.join(lib.REPO, 'shared', f), path.join(tmp.dir, 'shared', f));
  fs.mkdirSync(path.join(tmp.dir, 'data'));
  fs.copyFileSync(path.join(lib.REPO, 'data', 'foods.json'), path.join(tmp.dir, 'data', 'foods.json'));   // the Add sheet asks for the food list when it opens
  fs.writeFileSync(path.join(fuel, 'sync.js'), '// cloud sync is not part of this test\n');
  // The training app's place: a page that registers a worker for the whole site, as its real one does.
  fs.writeFileSync(path.join(tmp.dir, 'index.html'), '<!doctype html><title>training app (stand-in)</title><script>navigator.serviceWorker.register("./sw.js");</script>');
  fs.writeFileSync(path.join(tmp.dir, 'sw.js'), worker('the training app, stand-in'));
  release(tmp, 1);
}
// Takes over at once, like the real workers; answers nothing itself (every request goes to the network).
const worker = (what) => '// ' + what + '\nself.addEventListener("install", () => self.skipWaiting());\nself.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));\nself.addEventListener("fetch", () => {});\n';
const release = (tmp, n) => fs.writeFileSync(path.join(tmp.dir, 'fuel', 'sw.js'), worker('Fuel, stand-in, release ' + n));
// An install that fails, as the real all-or-nothing one does when one of its files does not arrive.
const failing = (tmp) => fs.writeFileSync(path.join(tmp.dir, 'fuel', 'sw.js'), '// Fuel, stand-in: one of its files did not arrive\nself.addEventListener("install", (e) => e.waitUntil(Promise.reject(new Error("a file did not arrive"))));\n');
// A good release whose install takes a moment (the real one downloads about 2 MB).
const slow = (tmp, n) => fs.writeFileSync(path.join(tmp.dir, 'fuel', 'sw.js'), '// Fuel, stand-in, release ' + n + ', a slow install\nself.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(new Promise((r) => setTimeout(r, 2500))); });\nself.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));\nself.addEventListener("fetch", () => {});\n');

async function newPhone(browser) {
  const phone = await lib.newPhone(browser, { serviceWorkers: 'allow' });
  // Kept across reloads of a tab: how often the page loaded, and every message it showed.
  await phone.context.addInitScript(() => {
    if (window.top !== window) return;
    try { sessionStorage.setItem('loads', String((+sessionStorage.getItem('loads') || 0) + 1)); } catch (e) { return; }   // about:blank has no storage
    const c = navigator.serviceWorker && navigator.serviceWorker.controller;
    window.__firstController = c ? new URL(c.scriptURL).pathname : null;   // the worker in control when this page loaded
    document.addEventListener('DOMContentLoaded', () => {
      const t = document.querySelector('#toast'); if (!t) return;
      new MutationObserver(() => { if (!t.hidden && t.textContent) sessionStorage.setItem('toasts', (sessionStorage.getItem('toasts') || '') + t.textContent + '|'); }).observe(t, { childList: true, attributes: true, characterData: true, subtree: true });
    });
  });
  return phone;
}
const loads = (page) => page.evaluate(() => +sessionStorage.getItem('loads'));
const toasts = (page) => page.evaluate(() => sessionStorage.getItem('toasts') || '');
const controller = (page) => page.evaluate(() => (navigator.serviceWorker.controller ? new URL(navigator.serviceWorker.controller.scriptURL).pathname : null));
const fuelInControl = (page) => page.waitForFunction(() => !!navigator.serviceWorker.controller && /\/fuel\/sw\.js$/.test(navigator.serviceWorker.controller.scriptURL), null, { timeout: 15000 });
// The app comes back to the foreground: that is when it looks for an update.
const comeBack = (page) => F.show(page);
const pill = (page) => F.count(page, '#topbar-right [data-action="reload"]');
async function reloaded(page, from) { await page.waitForFunction((n) => +sessionStorage.getItem('loads') > n && !!window.__overload && !!window.__overloadFood, from, { timeout: 15000 }); }

(async () => {
  const tmp = F.tempDir();
  buildSite(tmp);
  const server = await lib.startServer(tmp.dir, PORT);
  const browser = await lib.launch();
  let n = 1;
  try {
    // ---------------------------------------------------------------- Fuel alone (its own Home Screen app)
    const phone = await newPhone(browser);
    let page = null;
    const step = (t, fn) => run.step('Fuel alone', t, fn);
    await step('a first install does not reload the page', async () => {
      page = await F.open(phone, server);
      need((await page.evaluate(() => window.__firstController)) === null, 'a worker controlled the page when it loaded, before any was installed');
      await page.click('[data-action="fuel-fresh"]');
      await page.waitForSelector('.f-meal');
      await fuelInControl(page);
      await lib.sleep(1200);
      need((await loads(page)) === 1, 'the page loaded ' + (await loads(page)) + ' times');
      need(!/Updating/.test(await toasts(page)) && (await pill(page)) === 0, 'it said "Updating…" or offered "Update ready" on a first install: ' + await toasts(page));
      return 'controlled by ' + await controller(page) + ', loaded once';
    });
    await step('an update while nothing is going on says "Updating…" and reloads once', async () => {
      await F.quickAdd(page, 0, 'Toast', 120, 4, 20, 2);
      await lib.sleep(300);
      release(tmp, ++n);
      await comeBack(page);
      await reloaded(page, 1);
      await lib.sleep(1500);
      need((await loads(page)) === 2, 'the page loaded ' + (await loads(page)) + ' times');
      need(/Updating…/.test(await toasts(page)), 'no "Updating…": ' + await toasts(page));
      need((await F.screen(page)) === 'food' && (await F.readDay(page)).entries === 1, 'the diary is not as it was after the reload');
      return 'loaded twice; messages: ' + (await toasts(page)).replace(/\|/g, ' / ');
    });
    await step('an update while a sheet is open does not reload: "Update ready" is offered', async () => {
      await page.click('[data-action="food-add"][data-meal="1"]');
      await page.waitForSelector('#sheet:not([hidden]) [data-field="food-search"]');
      await page.fill('[data-field="food-search"]', 'my own soup');
      await page.evaluate(() => document.activeElement.blur());   // the sheet alone must hold the reload, not the keyboard
      release(tmp, ++n);
      await comeBack(page);
      await page.waitForSelector('#topbar-right [data-action="reload"]', { timeout: 15000 });
      await lib.sleep(1500);
      need((await loads(page)) === 2, 'the page was reloaded under the open sheet');
      need((await F.sheetOpen(page)) && (await page.inputValue('[data-field="food-search"]')) === 'my own soup', 'the sheet or what was typed in it is gone');
      await F.closeSheet(page);
      need((await pill(page)) === 1 && /Update ready/.test(await F.text(page, '#topbar-right')), 'the offer went away with the sheet');
      await page.click('#topbar-right [data-action="reload"]');
      await reloaded(page, 2);
      need((await loads(page)) === 3 && (await pill(page)) === 0, 'the tap on "Update ready" did not reload once');
      return 'held until the tap';
    });
    await step('an update while a box has the keyboard does not reload either', async () => {
      await lib.openTab(page, 'settings');
      await page.focus('[data-field="fuel-bw"]');
      await page.keyboard.type('81.5');
      release(tmp, ++n);
      await comeBack(page);
      await page.waitForSelector('#topbar-right [data-action="reload"]', { timeout: 15000 });
      await lib.sleep(1500);
      need((await loads(page)) === 3 && (await page.inputValue('[data-field="fuel-bw"]')) === '81.5', 'the page was reloaded while typing, or the typing is gone');
      await page.keyboard.press('Tab');
      need((await F.stored(page)).bodyweight[0].weight === 81.5, 'what was typed was not saved');
      F.assertClean(phone, 'Fuel alone');
      return 'held; 81.5 saved';
    });
    await phone.close();

    // ---------------------------------------------------------------- one storage for both apps
    const both = await newPhone(browser);
    const two = (t, fn) => run.step('both apps in one storage', t, fn);
    let fp = null;
    await two('a Fuel page loaded under the training app\'s worker is not reloaded when Fuel\'s own takes over', async () => {
      const root = await both.context.newPage();
      await root.goto(server.url + '/index.html');
      await root.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
      fp = await F.open(both, server);
      const at = await fp.evaluate(() => window.__firstController);
      need(at === '/sw.js', 'the page was not under the training app\'s worker when it loaded (it was under ' + at + '): this check needs that');
      await fp.click('[data-action="fuel-fresh"]');
      await fp.waitForSelector('.f-meal');
      await fuelInControl(fp);
      await lib.sleep(1500);
      need((await loads(fp)) === 1, 'the page loaded ' + (await loads(fp)) + ' times');
      need(!/Updating/.test(await toasts(fp)) && (await pill(fp)) === 0, 'it said "Updating…" or offered "Update ready": ' + await toasts(fp));
      await root.close();
      return 'first under ' + at + ', then /fuel/sw.js; loaded once';
    });
    await two('Fuel\'s next update reloads it', async () => {
      release(tmp, ++n);
      await comeBack(fp);
      await reloaded(fp, 1);
      need((await loads(fp)) === 2 && (await controller(fp)) === '/fuel/sw.js', 'loads: ' + (await loads(fp)) + ', controller: ' + await controller(fp));
      F.assertClean(both, 'both apps');
      return 'loaded twice';
    });
    await both.close();

    // ---------------------------------------------------------------- a first install that fails (O3)
    // One of the worker's files does not arrive, so its first install fails and the browser keeps no
    // registration. An iPhone resumes a Home Screen app rather than reloading it: coming back to the front must
    // register the worker again (update() on the registration that is gone fetches nothing), and Settings says
    // that the app cannot open without signal yet until its worker is active.
    const first = await newPhone(browser);
    const fail = (t, fn) => run.step('a first install that fails', t, fn);
    const regs = (page) => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => ({ scope: new URL(r.scope).pathname, active: !!r.active, installing: !!r.installing, waiting: !!r.waiting })));
    const note = (page) => F.text(page, '#offline-note');
    // Polls from here: page.waitForFunction does not wait for a promise that its function returns.
    const until = async (fn, ms) => { const end = Date.now() + ms; for (;;) { if (await fn()) return true; if (Date.now() > end) return false; await lib.sleep(150); } };
    let ip = null;
    await fail('the install fails: no registration is left, and Settings says the app is not ready to work offline', async () => {
      failing(tmp);
      const asked = [];
      first.context.on('request', (r) => { if (/\/fuel\/sw\.js$/.test(r.url().split('?')[0])) asked.push(r.url()); });
      ip = await F.open(first, server);
      await ip.click('[data-action="fuel-fresh"]');
      await ip.waitForSelector('.f-meal');
      await lib.openTab(ip, 'settings');
      // The registration exists from before its script is fetched until its install fails.
      need(await until(async () => asked.length > 0 && (await regs(ip)).length === 0, 15000), 'the worker was not asked for, or the failed install left ' + JSON.stringify(await regs(ip)));
      need(!(await controller(ip)), 'a worker controls the page');
      await ip.waitForFunction(() => /Not ready/.test((document.querySelector('#offline-note') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
      const t = await note(ip);
      need(t === 'Not ready to work offline yet. Open Fuel again with good signal.', 'Settings says: ' + t);
      return 'registrations: ' + JSON.stringify(await regs(ip)) + '; "' + t + '"';
    });
    await fail('back in front with good signal: the worker is registered again and installs; the note follows it, without a reload', async () => {
      // He comes back later, not within milliseconds: the browser is done clearing the failed registration.
      await lib.sleep(2000);
      slow(tmp, ++n);
      await comeBack(ip);
      need(await until(async () => (await regs(ip)).length > 0, 8000), 'coming back to the front registered nothing: registrations ' + JSON.stringify(await regs(ip)));
      await ip.waitForFunction(() => { const e = document.querySelector('#offline-note'); return !!e && /Getting ready to work offline/.test(e.textContent); }, null, { timeout: 15000 });
      const getting = await note(ip);
      await fuelInControl(ip);
      await ip.waitForFunction(() => !document.querySelector('#offline-note'), null, { timeout: 15000 });
      const r = await regs(ip);
      need(r.length === 1 && r[0].scope === '/fuel/' && r[0].active, 'registrations: ' + JSON.stringify(r));
      need((await loads(ip)) === 1 && (await F.screen(ip)) === 'settings', 'the page was reloaded, or left Settings');
      return '"' + getting + '", then none; ' + JSON.stringify(r);
    });
    await fail('a later return to the front only looks for an update', async () => {
      const before = await regs(ip);
      await comeBack(ip);
      await lib.sleep(1500);
      same(await regs(ip), before, 'the registrations');
      need((await note(ip)) === null && (await loads(ip)) === 1, 'the note came back, or the page reloaded');
      return 'unchanged';
    });
    await first.close();
  } catch (e) {
    run.say(false, 'fuel-update', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
    await server.stop();
    tmp.rm();
  }
  run.done();
})();
