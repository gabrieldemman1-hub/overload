#!/usr/bin/env node
/* Fuel 3.0: where it runs on an iPhone.
 *
 *   node tests/fuel-guard.js [--port=8423]
 *
 * An iPhone keeps a separate storage for Safari and for every Home Screen app, and tells a page which it is in
 * through navigator.standalone (no other browser has that property). Here the property is defined before the
 * page's scripts run, and service workers are allowed, with a note taken of every registration the page asks for.
 *   - a Safari tab (standalone false): "Add Fuel to your Home Screen" with Share and Add to Home Screen;
 *     nothing is stored, nothing registered, cloud sync is told to wait; "Use it here anyway" goes on, for
 *     that tab only;
 *   - a Home Screen app that holds Overload's data and none of Fuel's (the page was opened inside the
 *     installed Overload): the same instructions with Open in Safari and Copy link; nothing is stored, no
 *     worker, Overload's data is neither read into Fuel nor changed;
 *   - a Home Screen app without Overload's data (Fuel's own): runs, Welcome first;
 *   - a Home Screen app that holds both: runs;
 *   - a browser without the property and with Overload's data (a computer): runs, and Welcome offers
 *     "Bring it from Overload on this device".
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const lib = require('./lib');
const F = require('./fuel-common');

const args = F.args();
const PORT = Number(args.port) || 8423;
const run = F.runner('fuel-guard');
const { need, same } = run;
const fx = lib.loadFixture('v28-state');
const ADDRESS = lib.LOCAL + ':' + PORT + '/fuel/';

// A phone whose pages see navigator.standalone = `standalone` (undefined: the property does not exist), and
// which notes every service worker registration a page asks for in window.__registered.
async function phoneAs(browser, standalone, seed) {
  const phone = await lib.newPhone(browser, { now: fx.meta.now, timezoneId: fx.meta.tz, serviceWorkers: 'allow' });
  await phone.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await phone.context.addInitScript((v) => {
    if (v !== null) Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => v });
    window.__registered = [];
    if (window.ServiceWorkerContainer) {
      const real = ServiceWorkerContainer.prototype.register;
      ServiceWorkerContainer.prototype.register = function (url, o) { window.__registered.push(String(url)); return real.call(this, url, o); };
    }
  }, standalone === undefined ? null : standalone);
  if (seed) await seed(phone.context);
  return phone;
}
const seedOverload = (context) => lib.seedV28(context, fx);
const seedBoth = (context) => lib.seedV28(context, fx, { extra: { 'fuel.state.v1': F.fuelStateFrom(fx.state) } });
const seedFuel = (context) => lib.seedStorage(context, { 'fuel.state.v1': F.fuelStateFrom(fx.state) });
// Everything a page can have stored, by name.
const everything = (page) => page.evaluate(async (mark) => ({
  local: Object.keys(localStorage).filter((k) => k !== mark).sort(), session: Object.keys(sessionStorage).sort(),
  dbs: (await indexedDB.databases()).map((d) => d.name).sort(), caches: (await caches.keys()).sort(), registered: window.__registered }), lib.SEED_MARK);
const body = (page) => F.text(page, '#app');

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    // ---------------------------------------------------------------- a Safari tab
    {
      const label = 'Safari tab', step = (t, fn) => run.step(label, t, fn);
      const phone = await phoneAs(browser, false);
      let page = null;
      await step('shows how to add Fuel to the Home Screen', async () => {
        page = await F.open(phone, server);
        need(await page.evaluate(() => 'standalone' in navigator && navigator.standalone === false), 'the test did not set navigator.standalone');
        const t = await body(page);
        for (const s of ['Add Fuel to your Home Screen', 'Tap Share in Safari\'s toolbar', 'Choose Add to Home Screen', 'Open Fuel from its new icon', 'Use it here anyway']) need(t.includes(s), 'the screen does not say "' + s + '": ' + t);
        need(!/Open in Safari|Welcome|Bring it from Overload/.test(t), 'the screen offers more than it should: ' + t);
        need((await F.screen(page)) !== 'food' && !(await page.isVisible('.tabbar')), 'the diary or the tab bar is there');
        return t.slice(0, 60);
      });
      await step('stores nothing, registers no worker, and tells cloud sync to wait', async () => {
        await lib.sleep(600);
        same(await everything(page), { local: [], session: [], dbs: [], caches: [], registered: [] }, 'what is stored');
        const api = await page.evaluate(() => ({ unreadable: window.__overload.unreadable, saved: window.__overload.save(), copy: null }));
        need(api.unreadable === true && api.saved === false, 'unreadable: ' + api.unreadable + ', save(): ' + api.saved);
        await page.evaluate(() => { window.__overload.setState({ v: 1, app: 'fuel', diary: { '2026-11-21': [{ id: 'a', kcal: 1, p: 0, c: 0, f: 0, meal: 0 }] } }); return window.__overload.safetyCopy('day', true); });
        same(await everything(page), { local: [], session: [], dbs: [], caches: [], registered: [] }, 'what is stored after save, setState and safetyCopy');
        need((await F.screen(page)) === 'install', 'the screen changed to ' + (await F.screen(page)));
        return 'nothing in localStorage, sessionStorage, IndexedDB or Cache Storage';
      });
      await step('"Use it here anyway" goes on to Welcome, and the worker is registered', async () => {
        await page.click('[data-action="fuel-use-here"]');
        await page.waitForFunction(() => window.__overload.screen === 'welcome');
        need(/Welcome to Fuel/.test(await body(page)), 'no Welcome');
        const all = await everything(page);
        same(all.registered, ['./sw.js'], 'the registrations asked for');
        same([all.local, all.session], [[], ['fuel.here']], 'what is stored at Welcome');
        need((await page.evaluate(() => window.__overload.unreadable)) === false, 'cloud sync is still told to wait');
        return 'registered ./sw.js';
      });
      await step('Start fresh, then a reload in the same tab: no question again', async () => {
        await page.click('[data-action="fuel-fresh"]');
        await page.waitForSelector('.f-meal');
        await F.quickAdd(page, 0, 'Toast', 120, 4, 20, 2);
        await F.reload(page);
        need((await F.screen(page)) === 'food' && (await F.readDay(page)).entries === 1, 'after a reload the screen is ' + (await F.screen(page)));
        return 'the diary, 1 entry';
      });
      await step('a new tab shows the way to the Home Screen again, then the same data', async () => {
        const tab = await F.open(phone, server);
        need((await F.screen(tab)) === 'install' && /Add Fuel to your Home Screen/.test(await body(tab)), 'the new tab shows ' + (await F.screen(tab)));
        const before = await F.storedText(tab);
        await lib.sleep(400);
        need((await F.storedText(tab)) === before && (await tab.evaluate(() => window.__registered.length)) === 0, 'the waiting tab stored or registered something');
        await tab.click('[data-action="fuel-use-here"]');
        await tab.waitForSelector('.f-meal');
        need((await F.readDay(tab)).entries === 1, 'the entry logged in the other tab is not there');
        await tab.close();
        return 'asked again, then the diary with 1 entry';
      });
      await step('no error', async () => { F.assertClean(phone, label); });
      await phone.close();
    }

    // ---------------------------------------------------------------- inside the installed Overload
    {
      const label = 'inside Overload', step = (t, fn) => run.step(label, t, fn);
      const phone = await phoneAs(browser, true, seedOverload);
      const seeded = { 'overload.backup': JSON.stringify(fx.meta.backup), 'overload.state.v1': fx.text, 'overload.theme': 'dark' };
      let page = null;
      await step('shows Open in Safari and Copy link', async () => {
        page = await F.open(phone, server);
        const t = await body(page);
        for (const s of ['Add Fuel to your Home Screen', 'This page opened inside Overload', 'Tap Open in Safari below', 'Tap Share in Safari\'s toolbar', 'Choose Add to Home Screen', 'Open in Safari', 'Copy link', ADDRESS]) need(t.includes(s), 'the screen does not say "' + s + '": ' + t);
        need(!/Use it here anyway|Welcome|Bring it from Overload|Start fresh/.test(t), 'the screen offers more than it should: ' + t);
        const href = await page.getAttribute('[data-action="fuel-open-safari"]', 'href');
        need(href === 'x-safari-' + ADDRESS, 'Open in Safari points at ' + href);
        need((await F.screen(page)) !== 'food' && !(await page.isVisible('.tabbar')), 'the diary or the tab bar is there');
        return href;
      });
      await step('takes no data, stores nothing, registers no worker', async () => {
        await lib.sleep(600);
        const check = async (when) => {
          same(await everything(page), { local: Object.keys(seeded), session: [], dbs: [], caches: [], registered: [] }, 'what is stored ' + when);
          const all = await lib.readStorage(page);
          for (const k of Object.keys(seeded)) need(all[k] === seeded[k], k + ' changed ' + when);
        };
        await check('at start');
        const api = await page.evaluate(() => ({ unreadable: window.__overload.unreadable, saved: window.__overload.save(), days: Object.keys(window.__overload.state.diary).length }));
        need(api.unreadable === true && api.saved === false && api.days === 0, 'unreadable ' + api.unreadable + ', save() ' + api.saved + ', ' + api.days + ' days in memory');
        await page.evaluate(() => { window.__overload.setState({ v: 1, app: 'fuel', diary: {} }); window.__overload.render(); return window.__overload.safetyCopy('day', true); });
        await check('after save, setState, render and safetyCopy');
        return 'only Overload\'s three keys, byte for byte';
      });
      await step('Copy link puts Fuel\'s address on the clipboard', async () => {
        await page.click('[data-action="fuel-copy-link"]');
        await F.toast(page, /Link copied/);
        const clip = await page.evaluate(() => navigator.clipboard.readText());
        need(clip === ADDRESS, 'the clipboard holds ' + clip);
        return clip;
      });
      await step('a reload shows the same; still nothing stored', async () => {
        await F.reload(page);
        need(/This page opened inside Overload/.test(await body(page)), 'the screen changed');
        same(await everything(page), { local: Object.keys(seeded), session: [], dbs: [], caches: [], registered: [] }, 'what is stored');
        F.assertClean(phone, label);
        return 'the same';
      });
      await phone.close();
    }

    // ---------------------------------------------------------------- Fuel's own Home Screen app
    {
      const label = 'Fuel\'s Home Screen app', step = (t, fn) => run.step(label, t, fn);
      const phone = await phoneAs(browser, true);
      await step('with nothing stored: runs, Welcome first, the worker is registered', async () => {
        const page = await F.open(phone, server);
        need((await F.screen(page)) === 'welcome', 'the screen is ' + (await F.screen(page)));
        const t = await body(page);
        need(/Welcome to Fuel/.test(t) && !/Home Screen|on this device/.test(t), 'Welcome reads: ' + t);
        need((await page.evaluate(() => window.__overload.unreadable)) === false, 'cloud sync is told to wait');
        await page.click('[data-action="fuel-fresh"]');
        await page.waitForSelector('.f-meal');
        const all = await everything(page);
        same(all.registered, ['./sw.js'], 'the registrations asked for');
        same(all.local, ['fuel.backup', 'fuel.state.v1', 'fuel.theme'], 'the keys in localStorage');
        F.assertClean(phone, label);
        return 'Welcome, Start fresh, the diary';
      });
      await phone.close();

      const withData = await phoneAs(browser, true, seedFuel);
      await step('with its data: runs straight into the diary', async () => {
        const page = await F.open(withData, server);
        const day = await F.readDay(page);
        need((await F.screen(page)) === 'food' && day.kcalLine === fx.facts.foodDays[0].kcalLine && day.entries === fx.facts.foodDays[0].entries, 'the screen is ' + (await F.screen(page)) + ', ' + JSON.stringify(day).slice(0, 120));
        F.assertClean(withData, label);
        return day.kcalLine;
      });
      await withData.close();
    }

    // ---------------------------------------------------------------- a Home Screen app that holds both
    {
      const label = 'both apps\' data in one Home Screen app';
      const phone = await phoneAs(browser, true, seedBoth);
      await run.step(label, 'runs: Fuel has data of its own there', async () => {
        const page = await F.open(phone, server);
        need((await F.screen(page)) === 'food' && (await F.readDay(page)).entries === fx.facts.foodDays[0].entries, 'the screen is ' + (await F.screen(page)));
        need((await lib.readStorageText(page, 'overload.state.v1')) === fx.text, 'Overload\'s data changed');
        F.assertClean(phone, label);
        return 'the diary';
      });
      await phone.close();
    }

    // ---------------------------------------------------------------- a computer
    {
      const label = 'a browser without navigator.standalone';
      const phone = await phoneAs(browser, undefined, seedOverload);
      await run.step(label, 'with Overload\'s data in the same storage: Welcome offers to bring it from this device', async () => {
        const page = await F.open(phone, server);
        need(await page.evaluate(() => !('standalone' in navigator)), 'this browser has navigator.standalone');
        need((await F.screen(page)) === 'welcome', 'the screen is ' + (await F.screen(page)));
        const choices = await page.evaluate(() => [...document.querySelectorAll('#app .choice-card')].map((b) => b.dataset.action));
        same(choices, ['fuel-here', 'fuel-paste', 'fuel-file', 'fuel-signin'], 'the choices');
        const t = await F.text(page, '#app .choice-card');
        need(/Bring it from Overload on this device/.test(t) && /110 days, 1,576 entries/.test(t), 'the first choice reads ' + t);
        const all = await everything(page);
        same([all.local, all.session, all.dbs], [['overload.backup', 'overload.state.v1', 'overload.theme'], [], []], 'what is stored at Welcome');
        need((await lib.readStorageText(page, 'overload.state.v1')) === fx.text, 'Overload\'s data changed');
        F.assertClean(phone, label);
        return t;
      });
      await phone.close();
      const bare = await phoneAs(browser, undefined);
      await run.step(label, 'with nothing stored: Welcome, without that offer', async () => {
        const page = await F.open(bare, server);
        const choices = await page.evaluate(() => [...document.querySelectorAll('#app .choice-card')].map((b) => b.dataset.action));
        same(choices, ['fuel-paste', 'fuel-file', 'fuel-signin'], 'the choices');
        F.assertClean(bare, label);
        return choices.join(', ');
      });
      await bare.close();
    }
  } catch (e) {
    run.say(false, 'fuel-guard', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
    await server.stop();
  }
  run.done();
})();
