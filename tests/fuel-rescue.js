#!/usr/bin/env node
/* Fuel 3.0: the start-up rescue in fuel/index.html.
 *
 *   node tests/fuel-rescue.js [--port=8427]
 *
 * The rescue runs when the page arrived but fuel.js did not. The test serves the repo's own page as "the next
 * release" (every ?v=3.0 turned into a later number), lets fuel.js of that release fail, and puts stored
 * copies into Cache Storage by hand, as Fuel's service worker would have left them:
 *   - an older release with the same first number (3.0 for a 3.1 page) is started from the stored copies:
 *     every script and both stylesheets, nothing asked of the network under the old names;
 *   - of two older releases the newer one is used;
 *   - never used: a release with another first number, a newer release, and copies kept in a cache that is
 *     not Fuel's (overload-…). The page then says "Fuel did not finish starting", and that what was logged
 *     is still on the phone when there is data (and only then).
 * Nothing is written to the repo: the changed page is answered from memory. Prints one PASS/FAIL line per
 * check and exits 1 if anything failed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const F = require('./fuel-common');

const args = F.args();
const PORT = Number(args.port) || 8427;
const run = F.runner('fuel-rescue');
const { need, same } = run;
const fx = lib.loadFixture('v28-state');
const read = (f) => fs.readFileSync(path.join(lib.REPO, f), 'utf8');
const HTML = read('fuel/index.html');

function pageOf(v) {
  if (!HTML.includes('?v=3.0')) throw new Error('fuel/index.html is not at ?v=3.0: this test needs updating');
  return HTML.split('?v=3.0').join('?v=' + v);
}
// What Fuel's worker would have stored for a release: its scripts and stylesheets, each marked so the test
// can tell a stored copy from one the server gave.
function stored(cache, v) {
  const js = 'text/javascript', css = 'text/css', at = (u) => ({ cache, url: u + '?v=' + v });
  return [
    Object.assign(at('/fuel/backup.js'), { type: js, body: read('fuel/backup.js') }),
    Object.assign(at('/fuel/fuel.js'), { type: js, body: read('fuel/fuel.js') + '\nwindow.__rescued = ' + JSON.stringify(v + ' from ' + cache) + ';\n' }),
    Object.assign(at('/fuel/food.js'), { type: js, body: read('fuel/food.js') }),
    Object.assign(at('/fuel/sync.js'), { type: js, body: 'window.__rescuedSync = ' + JSON.stringify(v) + ';\n' }),
    Object.assign(at('/styles.css'), { type: css, body: read('styles.css') + '\nbody { --stored-styles: ' + JSON.stringify(v) + '; }\n' }),
    Object.assign(at('/fuel/fuel.css'), { type: css, body: read('fuel/fuel.css') + '\nbody { --stored-fuel-css: ' + JSON.stringify(v) + '; }\n' })
  ];
}

// A phone that gets the page of release `v`, cannot get that release's fuel.js, and has `entries` in Cache Storage.
async function scene(browser, server, v, entries, seedData) {
  const phone = await lib.newPhone(browser, { now: fx.meta.now, timezoneId: fx.meta.tz });
  phone.asked = [];
  phone.context.on('request', (r) => phone.asked.push(r.url().replace(server.url, '')));
  await phone.context.route('**/fuel/blank.html', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }));
  await phone.context.route('**/fuel/index.html', (r) => r.fulfill({ contentType: 'text/html', body: pageOf(v) }));
  await phone.context.route('**/fuel/fuel.js?v=' + v, (r) => r.abort());
  if (seedData) await lib.seedStorage(phone.context, { 'fuel.state.v1': F.fuelStateFrom(fx.state) });
  const blank = await phone.context.newPage();
  await blank.goto(server.url + '/fuel/blank.html');
  await blank.evaluate(async (list) => { for (const e of list) { const c = await caches.open(e.cache); await c.put(e.url, new Response(e.body, { headers: { 'Content-Type': e.type } })); } }, entries);
  await blank.close();
  phone.asked.length = 0;
  const page = await phone.context.newPage();
  await page.goto(server.url + '/fuel/index.html', { waitUntil: 'load' });
  return { phone, page };
}
// The errors this scene must have and no others: this release's fuel.js did not load, so its food.js found no
// host (and sync.js, where it exists, may complain the same way).
function onlyExpected(phone, v) {
  return F.problems(phone).filter((t) => !(new RegExp('fuel\\.js\\?v=' + v.replace('.', '\\.')).test(t) || /Cannot read properties of undefined|undefined is not an object|__overload/.test(t)));
}
const note = (page) => F.text(page, '#boot-note');

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    await run.step('an older release, same first number', 'is started from the stored copies, with the data', async () => {
      const decoys = stored('fuel-v0', '2.9').concat(stored('overload-v24', '3.0').map((e) => Object.assign({}, e, { body: e.body.replace('from overload-v24', 'from the wrong cache') })));
      const { phone, page } = await scene(browser, server, '3.1', stored('fuel-v1', '3.0').concat(decoys), true);
      try {
        await page.waitForFunction(() => !!window.__overload && !!window.__overloadFood, null, { timeout: 15000 });
        const got = await page.evaluate(() => ({ from: window.__rescued, sync: window.__rescuedSync, backup: !!window.__overloadBackup,
          css: [getComputedStyle(document.body).getPropertyValue('--stored-styles').trim(), getComputedStyle(document.body).getPropertyValue('--stored-fuel-css').trim()],
          blobs: [...document.querySelectorAll('script[src^="blob:"]')].length, note: !!document.querySelector('#boot-note') }));
        need(got.from === '3.0 from fuel-v1', 'fuel.js ran from ' + got.from);
        same([got.sync, got.backup, got.css, got.blobs, got.note], ['3.0', true, ['"3.0"', '"3.0"'], 4, false], 'what the rescue started');
        const day = await F.readDay(page);
        need((await F.screen(page)) === 'food' && day.kcalLine === fx.facts.foodDays[0].kcalLine && day.entries === fx.facts.foodDays[0].entries, 'the diary shows ' + JSON.stringify(day).slice(0, 120));
        const old = phone.asked.filter((u) => /[?&]v=(3\.0|2\.9)/.test(u));
        need(!old.length, 'the network was asked for old files: ' + old.join(', '));
        // and the rescued app works: the food list (asked for from the page's address) and a quick add
        await F.quickAdd(page, 3, 'Apple', 95, 0, 25, 0);
        need((await F.stored(page)).diary[fx.meta.today].length === fx.facts.foodDays[0].entries + 1, 'the rescued app did not save');
        need(phone.asked.includes('/data/foods.json?db=5'), 'the rescued food.js did not ask for the food list one folder up');
        const bad = onlyExpected(phone, '3.1');
        need(!bad.length, 'other errors: ' + bad.join(' | '));
        return 'ran ' + got.from + '; ' + day.kcalLine;
      } finally { await phone.close(); }
    });

    await run.step('two older releases', 'the newer one is used', async () => {
      const { phone, page } = await scene(browser, server, '3.2', stored('fuel-v1', '3.0').concat(stored('fuel-v2', '3.1')), false);
      try {
        await page.waitForFunction(() => !!window.__overload && !!window.__overloadFood, null, { timeout: 15000 });
        const from = await page.evaluate(() => window.__rescued);
        need(from === '3.1 from fuel-v2', 'fuel.js ran from ' + from);
        need((await F.screen(page)) === 'welcome' && /Welcome to Fuel/.test(await F.text(page, '#app')), 'no Welcome after the rescue');
        return from;
      } finally { await phone.close(); }
    });

    for (const [what, v, entries, data, said] of [
      ['a release with another first number', '3.0', stored('fuel-v0', '2.9'), true, true],
      ['a newer release', '3.1', stored('fuel-v3', '3.2'), false, false],
      ['copies in the training app\'s cache', '3.1', stored('overload-v24', '3.0'), true, true],
      ['nothing stored', '3.1', [], false, false]
    ]) {
      await run.step(what, 'is not used: the page says it did not start' + (said ? ', and that the data is still there' : ''), async () => {
        const { phone, page } = await scene(browser, server, v, entries, data);
        try {
          await page.waitForSelector('#boot-note', { timeout: 10000 });
          await lib.sleep(600);
          const t = await note(page);
          need(/^Fuel did not finish starting\./.test(t) && /Close the app and open it again where there is signal or Wi-Fi\./.test(t), 'the note reads ' + t);
          need(/Everything you logged is still on this phone/.test(t) === said, 'the note reads ' + t);
          need(await page.evaluate(() => !window.__overload && !window.__rescued && !document.querySelector('script[src^="blob:"]')), 'something was started');
          if (data) need((await lib.readStorageText(page, 'fuel.state.v1')) === JSON.stringify(F.fuelStateFrom(fx.state)), 'the stored data changed');
          const bad = onlyExpected(phone, v);
          need(!bad.length, 'other errors: ' + bad.join(' | '));
          return t.slice(0, 80);
        } finally { await phone.close(); }
      });
    }
  } catch (e) {
    run.say(false, 'fuel-rescue', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
    await server.stop();
  }
  run.done();
})();
