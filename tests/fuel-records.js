#!/usr/bin/env node
/* Fuel 3.0: a star he took off and a correction he deleted stay so (review findings data#3 and data#4).
 *
 *   node tests/fuel-records.js [--port=8433]
 *
 * Fuel keeps two more records beside its deletion records: deleted.fav (a star taken off a saved food, also by
 * deleting the food; it goes when the food is starred again) and deleted.custom (a food of his own, or his
 * correction of a listed product, deleted; it stays when the food list's copy of the product is logged again).
 * Copy my food log, a Fuel backup and the first cloud sign-in (fuel/sync.js addFromOverload) then take neither
 * that star nor that correction from Overload's copy. Everything through Fuel's own screens, from the main v2.8
 * fixture, where the oats are a favourite and the Quest Bar is a favourite he corrected (src custom):
 *   - pasted into a new Fuel; the oats un-starred; the bar he corrected deleted, then the food list's bar logged:
 *     the records are kept, and the deletion question still says days already logged keep their numbers;
 *   - a later Copy my food log with one entry more: that entry comes in, the oats stay without a star, the bar
 *     stays the food list's (300 kcal per 100 g) without a star, and the question updates no saved food;
 *   - a Fuel backup of that phone in a new Fuel: the records come along, and the same copy adds nothing there;
 *   - the oats starred again: their record goes, the bar's stay;
 *   - the first sign-in to an account that holds only Overload's copy (meta/state and foodDays as v2.8 writes
 *     them) on a phone in the same state: the same saved foods and diary as the paste gave, byte for byte; the
 *     account's meta/fuel carries the records; a second Fuel phone that signs in gets them, and the same copy
 *     pasted there changes nothing; the oats starred again on one phone are starred on the other, and their
 *     record is gone on both and in the account.
 * The fake Firebase of tests/fake-firebase; no other host is contacted. Prints one PASS/FAIL line per check and
 * exits 1 if anything failed.
 */
'use strict';
const fs = require('fs');
const lib = require('./lib');
const F = require('./fuel-common');
const { createCloud } = require('./fake-firebase/route');

const args = F.args();
const PORT = Number(args.port) || 8433;
const run = F.runner('fuel-records');
const { need, same } = run;
const fx = lib.loadFixture('v28-state');
const NOW = fx.meta.now, TODAY = fx.meta.today;
const EMAIL = 'owner@example.com', PASSWORD = 'correct horse';
const OATS = 'u173904', BAR = 'u1903553';
const FUEL_META = 'users/U1/meta/fuel';

// Copy my food log: A as Overload had it at the hand-over, B a day later with one entry more (v2.8 ran once
// more during a half-arrived update and he logged a snack there).
const OLD = JSON.parse(fx.text);
const textA = F.foodText(F.payloadFrom(OLD, NOW - 864e5), true);
const LATER = JSON.parse(fx.text);
LATER.diary[TODAY] = LATER.diary[TODAY].concat([{ id: 'v28late0snack', food: null, meal: 3, qty: null, unit: null, amt: '', name: 'Late snack in v2.8', brand: '', kcal: 210, p: 4, c: 30, f: 8, at: NOW - 60000 }]);
const textB = F.foodText(F.payloadFrom(LATER, NOW - 30000), true);

async function newPhone(browser, cloud, name) {
  const phone = await lib.newPhone(browser, { now: NOW, timezoneId: fx.meta.tz });
  await phone.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  if (cloud) phone.device = await cloud.attach(phone.context, name);
  return phone;
}
// The Add sheet of Breakfast on Today, a food picked from it (Favorites, Recents, or a search), its amount sheet.
async function addSheet(page) {
  await F.closeSheet(page);
  await lib.openTab(page, 'food');
  await page.click('[data-action="food-add"][data-meal="0"]');
  await page.waitForSelector('#sheet:not([hidden]) #food-results');
}
async function pick(page, id, search) {
  if (search) await page.fill('#sheet [data-field="food-search"]', search);
  const sel = '#food-results [data-action="food-pick"][data-id="' + id + '"]';
  await page.waitForSelector(sel, { timeout: 15000 });
  await page.click(sel);
  await page.waitForSelector('#sheet:not([hidden]) [data-action="food-save"]');
}
async function tapStar(page, id, re) {
  await addSheet(page); await pick(page, id);
  await page.click('#sheet [data-action="food-fav"]');
  const t = await F.toast(page, re);
  await F.closeSheet(page);
  return t;
}
// Settings > Bring food from Overload > the box: the text typed in and "Bring it in". { toast } or { msg }.
async function paste(page, text) {
  await F.closeSheet(page);
  await page.evaluate(() => { document.querySelector('#toast').hidden = true; });
  await lib.openTab(page, 'settings');
  await page.click('[data-action="fuel-import"]');
  await page.click('[data-action="fuel-paste-box"]');
  await page.fill('#fuel-paste', text);
  await page.click('#fuel-paste-form button[type="submit"]');
  await page.waitForFunction(() => { const t = document.querySelector('#toast'); return !!document.querySelector('#fuel-import-msg') || (!t.hidden && /Brought in|Updated/.test(t.textContent)); }, null, { timeout: 8000 });
  const said = await page.evaluate(() => { const m = document.querySelector('#fuel-import-msg'); return m ? { msg: m.textContent.replace(/\s+/g, ' ').trim() } : { toast: document.querySelector('#toast').textContent }; });
  await F.closeSheet(page);
  return said;
}
const lastQuestion = (page) => (page.dialogs.filter((d) => /^confirm: Bring this food log/.test(d)).pop() || '');
const records = (st) => ({ fav: Object.keys((st.deleted && st.deleted.fav) || {}).sort(), custom: Object.keys((st.deleted && st.deleted.custom) || {}).sort() });
const travels = (st) => JSON.stringify({ diary: st.diary, food: st.food });

async function signIn(page) {
  await lib.openTab(page, 'settings');
  await page.waitForSelector('#cloud-form');
  await page.fill('#cloud-form [name="email"]', EMAIL);
  await page.fill('#cloud-form [name="password"]', PASSWORD);
  await page.click('#cloud-form button[type="submit"]');
  await page.waitForFunction(() => !!(window.__overloadSync && window.__overloadSync.user), null, { timeout: 8000 });
}
// Timers (a push one second after a save), writes, the other phones' listeners, until nothing new is logged.
async function settle(cloud, pages) {
  let last = -1, quiet = 0;
  for (let i = 0; i < 40; i++) {
    for (const pg of pages) if (!pg.isClosed()) await pg.clock.runFor(1100).catch(() => {});
    await cloud.idle();
    const n = cloud.log.length;
    if (n === last) { if (++quiet >= 2) return; } else { quiet = 0; last = n; }
  }
  throw new Error('the phones never stopped writing');
}

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  const tmp = F.tempDir();
  let afterUse = null, afterB = null;
  try {
    // ---------------------------------------------------------------- Copy my food log, and a Fuel backup
    {
      const step = (t, fn) => run.step('paste', t, fn);
      const A = await newPhone(browser);
      const a = await F.open(A, server);
      await step('Welcome > Paste from Overload brings the log, the oats and the corrected bar starred', async () => {
        await a.evaluate((t) => navigator.clipboard.writeText(t), textA);
        await a.click('[data-action="fuel-paste"]');
        const t = await F.toast(a, /Brought in/);
        const st = await F.stored(a);
        need(st.food.foods[OATS].fav && st.food.foods[BAR].fav && st.food.foods[BAR].src === 'custom', 'the oats or the bar are not as the fixture has them');
        same(records(st), { fav: [], custom: [] }, 'the records after the paste');
        need(!('fav' in st.deleted) && !('custom' in st.deleted), 'empty records were stored: ' + JSON.stringify(Object.keys(st.deleted)));
        return t;
      });
      await step('the oats un-starred, the corrected bar deleted, the food list\'s bar logged: the records are kept', async () => {
        const t1 = await tapStar(a, OATS, /favorites/);
        need(t1 === 'Removed from favorites', 'the toast says ' + t1);
        await addSheet(a); await pick(a, BAR);
        await a.click('#sheet [data-action="food-fix"]');
        await a.waitForSelector('#sheet [data-action="food-forget"]');
        const asked = a.dialogs.length;
        await a.click('#sheet [data-action="food-forget"]');
        await F.toast(a, /Food deleted/);
        const q = a.dialogs.slice(asked).join(' | ');
        need(q === 'confirm: Delete "Quest Bar, Cookies & Cream"? Days already logged keep their numbers.', 'the question: ' + q);
        let st = await F.stored(a);
        need(!st.food.foods[BAR] && st.deleted.foods[BAR] > 0, 'the bar was not deleted');
        await addSheet(a); await pick(a, BAR, 'quest bar cookies cream');
        await a.click('#sheet [data-action="food-save"]');
        await a.waitForFunction(() => document.querySelector('#sheet').hidden || !!document.querySelector('#food-added .f-added:not(.none)'), null, { timeout: 8000 });
        await F.afterAdd(); await F.closeSheet(a);
        st = await F.stored(a);
        const bar = st.food.foods[BAR];
        need(bar && bar.src === 'usda' && !bar.fav && bar.n.kcal === 300 && !st.deleted.foods[BAR], 'the bar is ' + JSON.stringify(bar).slice(0, 160) + '; its deletion record ' + st.deleted.foods[BAR]);
        need(!st.food.foods[OATS].fav, 'the oats are starred');
        same(records(st), { fav: [BAR, OATS].sort(), custom: [BAR] }, 'the records');
        need(st.deleted.fav[OATS] > 0 && st.deleted.custom[BAR] > 0, 'a record has no time: ' + JSON.stringify([st.deleted.fav, st.deleted.custom]));
        afterUse = await F.storedText(a);
        return 'fav: ' + records(st).fav.join(', ') + '; custom: ' + records(st).custom.join(', ') + '; the bar is the list\'s, ' + bar.n.kcal + ' kcal per 100 g';
      });
      await step('a later copy with one entry more: the entry comes in; no star and no correction come back', async () => {
        const before = await F.stored(a);
        const said = await paste(a, textB);
        const q = lastQuestion(a), st = await F.stored(a);
        need(said.toast === 'Brought in 1 entry on 1 day.', 'the paste said ' + JSON.stringify(said));
        need(q.includes('New here: 1 entry on 1 day.') && !/updated from/.test(q), 'the question: ' + q.replace(/\n/g, ' | '));
        need(!st.food.foods[OATS].fav, 'the oats are starred again');
        const bar = st.food.foods[BAR];
        need(bar.src === 'usda' && !bar.fav && bar.n.kcal === 300, 'the bar is ' + bar.src + (bar.fav ? ', starred' : '') + ', ' + bar.n.kcal + ' kcal per 100 g');
        same(st.food, before.food, 'the saved foods, meals and targets');
        same(records(st), records(before), 'the records');
        need(st.diary[TODAY].some((e) => e.id === 'v28late0snack'), 'the new entry is not there');
        afterB = st;
        return said.toast + ' ' + q.split('\n').filter((l) => /Already in/.test(l)).join('');
      });
      let file = null;
      await step('a Fuel backup of it in a new Fuel: the records come along, and the same copy adds nothing there', async () => {
        await lib.openTab(a, 'settings');
        const [dl] = await Promise.all([a.waitForEvent('download'), a.click('.backup-btns [data-action="export"]')]);
        file = tmp.file('fuel-backup.json', fs.readFileSync(await dl.path(), 'utf8'));
        const C = await newPhone(browser);
        try {
          const c = await F.open(C, server);
          await F.chooseFile(c, '[data-action="fuel-file"]', file);
          await F.toast(c, /Brought in/);
          const st = await F.stored(c);
          same(st.deleted, afterB.deleted, 'the records on the new Fuel');
          same(st.food, afterB.food, 'the saved foods');
          const said = await paste(c, textB);
          need(/^Nothing new/.test(said.msg || ''), 'the copy pasted there said ' + JSON.stringify(said));
          same((await F.stored(c)).food, afterB.food, 'the saved foods after the paste');
          F.assertClean(C, 'the new Fuel');
          return said.msg;
        } finally { await C.close(); }
      });
      await step('the oats starred again: their record goes, the bar\'s stay', async () => {
        const t = await tapStar(a, OATS, /favorites/);
        const st = await F.stored(a);
        need(t === 'Added to favorites' && st.food.foods[OATS].fav, 'the toast says ' + t);
        same(records(st), { fav: [BAR], custom: [BAR] }, 'the records');
        F.assertClean(A, 'the pasting phone');
        return t;
      });
      await A.close();
    }

    // ---------------------------------------------------------------- the first cloud sign-in
    // The phone's state as the steps above leave it before copy B (taken from them when they ran, else made the
    // way food.js makes it: the oats without their star, the food list's bar in place of his corrected one, the
    // records of both), so that this part tells by itself whether fuel/sync.js keeps to the records.
    {
      const step = (t, fn) => run.step('sign-in', t, fn);
      let used = afterUse;
      if (!used) {
        const st = F.fuelStateFrom(OLD), T1 = NOW - 7200000;
        delete st.food.foods[OATS].fav;
        st.food.foods[BAR] = { id: BAR, src: 'usda', name: 'Quest Bar, Cookies & Cream', brand: '', n: { kcal: 300, p: 35, c: 36.7, f: 13.3 }, serving: { label: '1 bar', g: 60, n: null }, servings: [], barcode: '0793573238467', used: T1, last: { qty: 1, unit: 'srv' } };
        st.deleted.fav = { [OATS]: T1 - 60000, [BAR]: T1 - 30000 }; st.deleted.custom = { [BAR]: T1 - 30000 };
        used = JSON.stringify(st);
      }
      const cloud = createCloud();
      cloud.addAccount(EMAIL, PASSWORD);
      // What v2.8 uploads: meta/state (its core) and one foodDays document per day: here, copy B's log.
      const core = {}; ['settings', 'exercises', 'presc', 'program', 'active', 'bodyweight', 'sleep', 'templates', 'food', 'deleted'].forEach((k) => { core[k] = LATER[k]; });
      cloud.set('users/U1/meta/state', { core: JSON.stringify(core), updatedAt: NOW - 30000, v: 1 }, 'v2.8');
      Object.keys(LATER.diary).forEach((d) => cloud.set('users/U1/foodDays/' + d, { data: JSON.stringify(LATER.diary[d]), updatedAt: NOW - 30000, v: 1 }, 'v2.8'));
      // What Paste from Overload of copy B gives on a phone in that state (no cloud): the reference.
      let ref = null;
      {
        const P = await newPhone(browser);
        await lib.seedStorage(P.context, { 'fuel.state.v1': used, 'fuel.theme': 'dark' });
        const p = await F.open(P, server);
        await paste(p, textB);
        ref = await F.stored(p);
        await P.close();
      }
      const pages = [];
      const S = await newPhone(browser, cloud, 'S');
      await lib.seedStorage(S.context, { 'fuel.state.v1': used, 'fuel.theme': 'dark' });
      const s = await F.open(S, server); pages.push(s);
      await s.waitForFunction(() => !!window.__overloadSync, null, { timeout: 15000 });
      await step('a phone in that state signs in to an account that holds only Overload\'s copy: no star and no correction come back, and it holds what the paste gave, byte for byte', async () => {
        need((await F.storedText(s)) === used, 'the phone did not start from the state before the paste');
        await signIn(s);
        await settle(cloud, pages);
        const st = await F.stored(s);
        need(!st.food.foods[OATS].fav && st.food.foods[BAR].src === 'usda' && !st.food.foods[BAR].fav, 'the oats are ' + (st.food.foods[OATS].fav ? '' : 'not ') + 'starred; the bar is ' + st.food.foods[BAR].src + (st.food.foods[BAR].fav ? ', starred' : ''));
        need(st.diary[TODAY].some((e) => e.id === 'v28late0snack'), 'the sign-in did not bring the log');
        need(travels(st) === travels(ref), 'the diary or the saved foods differ from the paste at ' + (F.diff(st.diary, ref.diary) || F.diff(st.food, ref.food) || 'the order of keys'));
        same(records(st), records(JSON.parse(used)), 'the records');
        return Object.keys(st.diary).length + ' days; the oats without a star, the bar the food list\'s';
      });
      await step('the account\'s meta/fuel carries the records', async () => {
        const c = JSON.parse(cloud.get(FUEL_META).core);
        same(records(c), records(JSON.parse(used)), 'the records in meta/fuel');
        return JSON.stringify(records(c));
      });
      const T = await newPhone(browser, cloud, 'T');
      const t = await F.open(T, server); pages.push(t);
      await t.waitForFunction(() => !!window.__overloadSync, null, { timeout: 15000 });
      await step('a second Fuel phone signs in from Welcome: it gets the records, and the same copy pasted there changes nothing', async () => {
        await t.click('[data-action="fuel-signin"]');
        await t.waitForSelector('#sheet:not([hidden]) #cloud-form');
        await t.fill('#cloud-form [name="email"]', EMAIL);
        await t.fill('#cloud-form [name="password"]', PASSWORD);
        await t.click('#cloud-form button[type="submit"]');
        await t.waitForFunction(() => !!(window.__overloadSync && window.__overloadSync.user), null, { timeout: 8000 });
        await settle(cloud, pages);
        const st = await F.stored(t);
        same(records(st), records(JSON.parse(used)), 'the records on the second phone');
        need(!st.food.foods[OATS].fav && st.food.foods[BAR].src === 'usda', 'the oats or the bar on the second phone');
        const before = await F.storedText(t);
        const said = await paste(t, textB);
        need(/^Nothing new/.test(said.msg || '') && (await F.storedText(t)) === before, 'the paste said ' + JSON.stringify(said) + ', or the saved data changed');
        return said.msg;
      });
      await step('the oats starred again on one phone: starred on the other, and their record gone on both and in the account', async () => {
        await tapStar(s, OATS, /Added to favorites/);
        await settle(cloud, pages);
        const a1 = await F.stored(s), b1 = await F.stored(t), c = JSON.parse(cloud.get(FUEL_META).core);
        need(a1.food.foods[OATS].fav && b1.food.foods[OATS].fav, 'the oats are starred on ' + [a1, b1].map((x) => !!x.food.foods[OATS].fav).join(' and '));
        for (const [who, x] of [['this phone', a1], ['the other phone', b1], ['the account', c]]) same(records(x), { fav: [BAR], custom: [BAR] }, 'the records on ' + who);
        F.assertClean(S, 'phone S'); F.assertClean(T, 'phone T');
        return 'records everywhere: ' + JSON.stringify(records(c));
      });
      await S.close(); await T.close();
    }
  } catch (e) {
    run.say(false, 'fuel-records', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' '));
  } finally {
    tmp.rm();
    await browser.close();
    await server.stop();
  }
  run.done();
})();
