#!/usr/bin/env node
/* Fuel 3.0: what Fuel tells him about bringing the food log in and about cloud sync, against what it does
 * (review findings look#4, look#11 and look#1, and the Welcome lede from the look reviewer's notes).
 *
 *   node tests/fuel-words.js [--port=8434]
 *
 *   - Welcome: Paste and a file bring the log in one step; signing in is not promised to bring all of it (the
 *     words of Overload's card: "may bring some of it across, but not always all of it");
 *   - Settings > From Overload (before and after a hand-over), the import sheet, and Settings > Backup say the
 *     same: only what is missing is added, with the favorite stars and the numbers he corrected; nothing else is
 *     replaced or removed. A paste of a copy in which a food Fuel holds is starred stars it (as they say);
 *   - Settings > Cloud sync while the sync module has not loaded says so in plain words, without a file name;
 *   - the sign-out question says what a later sign-in does, and it is so on the fake cloud: an entry logged
 *     while signed out is sent at the next sign-in; after a Reset done while signed out, signing in brings
 *     back what the account holds.
 * The fake Firebase of tests/fake-firebase; no other host is contacted. Prints one PASS/FAIL line per check and
 * exits 1 if anything failed.
 */
'use strict';
const lib = require('./lib');
const F = require('./fuel-common');
const { createCloud } = require('./fake-firebase/route');

const args = F.args();
const PORT = Number(args.port) || 8434;
const run = F.runner('fuel-words');
const { need } = run;
const fx = lib.loadFixture('v28-state-small');
const NOW = fx.meta.now, TODAY = fx.meta.today;
const EMAIL = 'owner@example.com', PASSWORD = 'correct horse';

const ADDS_ONLY = 'Only what is missing here is added, with the favorite stars and the numbers you corrected in Overload. Nothing else is replaced or removed.';
const BACKUP_LINE = 'Import adds only what is missing here, with the favorite stars and the numbers you corrected there. Nothing else is replaced or removed.';
const SIGN_OUT = 'confirm: Sign out? Your food log stays on this phone and in the cloud. What you log while signed out is sent when you sign back in. '
  + 'A Reset or Restore done while signed out is not: signing in again brings back what the account holds.';
const NO_MODULE = 'Cloud sync is not available right now. It starts when the app opens with signal. Your food log stays on this phone.';

async function newPhone(browser, cloud, name) {
  const phone = await lib.newPhone(browser, { now: NOW, timezoneId: fx.meta.tz });
  await phone.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  if (cloud) await cloud.attach(phone.context, name);
  return phone;
}
const fromOverloadCard = (page) => page.evaluate(() => { const g = [...document.querySelectorAll('#app .group-title')].find((x) => x.textContent === 'From Overload'); return g ? g.nextElementSibling.querySelector('p').textContent.replace(/\s+/g, ' ').trim() : null; });
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
  try {
    // ---------------------------------------------------------------- Welcome
    {
      const P = await newPhone(browser);
      const page = await F.open(P, server);
      await run.step('Welcome', 'the lede promises one step for Paste and a file, and not that signing in brings all of it', async () => {
        const lede = await F.text(page, '#app .lede');
        need(lede === 'Fuel is the food half of Overload, now its own app. Paste your food log from Overload, or choose its file, and your days, targets, favorites and saved meals come across in one step. '
          + 'Signing in with the same email may bring some of it across, but not always all of it. Nothing is removed from Overload.', 'the lede reads: ' + lede);
        F.assertClean(P, 'Welcome');
        return lede.split('. ').slice(2, 3).join('');
      });
      await P.close();
    }

    // ---------------------------------------------------------------- what bringing food in changes
    {
      const step = (t, fn) => run.step('bringing food in', t, fn);
      const st = JSON.parse(fx.text), id = 'u172187';   // the egg: starred in this copy, not in Fuel
      st.food.foods[id].fav = true;
      const mine = F.fuelStateFrom(JSON.parse(fx.text)); delete mine.food.foods[id].fav;
      const P = await newPhone(browser);
      await lib.seedStorage(P.context, { 'fuel.state.v1': mine, 'fuel.theme': 'dark' });
      const page = await F.open(P, server);
      await step('Settings > From Overload, the import sheet and Settings > Backup say the same: the favorite stars come too, nothing else is replaced', async () => {
        await lib.openTab(page, 'settings');
        const card = await fromOverloadCard(page);
        need(card === 'The food log you kept in Overload can be brought here at any time. ' + ADDS_ONLY, 'From Overload says: ' + card);
        const backup = await page.evaluate(() => document.querySelector('#last-export').closest('.card').textContent.replace(/\s+/g, ' '));
        need(backup.includes(BACKUP_LINE), 'the Backup card says: ' + backup.slice(0, 300));
        await page.click('[data-action="fuel-import"]');
        await page.waitForSelector('#sheet:not([hidden])');
        const sheet = await F.text(page, '#sheet-panel p.small');
        need(sheet === 'In Overload, open the card "Food has moved to Fuel" and tap Copy my food log, or Save as a file. Then come back here. ' + ADDS_ONLY, 'the sheet says: ' + sheet);
        return ADDS_ONLY;
      });
      await step('a paste does what they say: the star comes, nothing else changes', async () => {
        const before = await F.stored(page);
        await page.click('[data-action="fuel-paste-box"]');
        await page.fill('#fuel-paste', F.foodText(F.payloadFrom(st, NOW), true));
        await page.click('#fuel-paste-form button[type="submit"]');
        const t = await F.toast(page, /Updated/);
        const after = await F.stored(page);
        need(after.food.foods[id].fav === true, 'the star did not come');
        before.food.foods[id].fav = true;
        run.same(after.food, before.food, 'the saved foods, meals and targets'); run.same(after.diary, before.diary, 'the diary');
        await lib.openTab(page, 'settings');
        const card = await fromOverloadCard(page);
        need(card === 'Brought across on Sat, Nov 21: 4 days, 24 entries. ' + ADDS_ONLY, 'From Overload now says: ' + card);
        F.assertClean(P, 'bringing food in');
        return t + ' | ' + card.split('. ')[0];
      });
      await P.close();
    }

    // ---------------------------------------------------------------- Cloud sync without its module
    {
      const P = await newPhone(browser);   // every host but this one is refused: the Firebase files do not load
      await lib.seedStorage(P.context, { 'fuel.state.v1': F.fuelStateFrom(JSON.parse(fx.text)), 'fuel.theme': 'dark' });
      const page = await F.open(P, server);
      await run.step('cloud sync', 'without the sync module, the card says so in plain words and names no file', async () => {
        await lib.sleep(500);
        need(await page.evaluate(() => window.__overloadSync === undefined), 'a sync module is in the page');
        await lib.openTab(page, 'settings');
        const t = await F.text(page, '#cloud-card .card');
        need(t === NO_MODULE && !/sync\.js|module/.test(t), 'the card reads: ' + t);
        return t;
      });
      await P.close();
    }

    // ---------------------------------------------------------------- the sign-out question, and what it says
    {
      const step = (t, fn) => run.step('signing out', t, fn);
      const cloud = createCloud();
      const P = await newPhone(browser, cloud, 'F');
      await lib.seedStorage(P.context, { 'fuel.state.v1': F.fuelStateFrom(JSON.parse(fx.text)), 'fuel.theme': 'dark' });
      const page = await F.open(P, server), pages = [page];
      await page.waitForFunction(() => !!window.__overloadSync, null, { timeout: 15000 });
      const accountDays = () => cloud.paths('users/U1/fuelDays').length;
      const accountHas = (entryId) => cloud.paths('users/U1/fuelDays').some((p) => JSON.parse(cloud.get(p).data).some((e) => e.id === entryId));
      const signInAgain = async () => {
        await lib.openTab(page, 'settings');
        await page.waitForSelector('#cloud-form');
        await page.fill('#cloud-form [name="email"]', EMAIL);
        await page.fill('#cloud-form [name="password"]', PASSWORD);
        await page.click('#cloud-form button[type="submit"]');
        await page.waitForFunction(() => !!(window.__overloadSync && window.__overloadSync.user), null, { timeout: 8000 });
        await settle(cloud, pages);
      };
      const signOut = async () => {
        await lib.openTab(page, 'settings');
        const asked = page.dialogs.length;
        await page.click('[data-action="cloud-signout"]');
        await page.waitForFunction(() => !window.__overloadSync.user, null, { timeout: 8000 });
        await settle(cloud, pages);
        return page.dialogs.slice(asked);
      };
      await step('the question says what a later sign-in does', async () => {
        await page.evaluate(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL, PASSWORD]);
        await settle(cloud, pages);
        need(accountDays() === 4, 'the account holds ' + accountDays() + ' food days');
        const q = await signOut();
        need(q.length === 1 && q[0] === SIGN_OUT, 'the question: ' + q.join(' / '));
        return q[0].replace('confirm: ', '').split('. ').slice(2).join('. ');
      });
      await step('"What you log while signed out is sent when you sign back in": it is', async () => {
        await lib.openTab(page, 'food');
        await F.quickAdd(page, 2, 'Logged while signed out', 432, 20, 30, 10);
        const e = (await F.stored(page)).diary[TODAY].find((x) => x.name === 'Logged while signed out');
        need(e && !accountHas(e.id), 'the entry is not on the phone, or already in the account');
        await signInAgain();
        need(accountHas(e.id), 'the entry logged while signed out is not in the account');
        return 'entry ' + e.id + ' is in the account';
      });
      await step('"A Reset or Restore done while signed out is not: signing in again brings back what the account holds": so it is', async () => {
        await signOut();
        await lib.openTab(page, 'settings');
        await page.click('[data-action="reset"]');
        await F.toast(page, /Reset: the food diary is empty/);
        need(!Object.keys((await F.stored(page)).diary).length, 'the reset did not empty the diary');
        await signInAgain();
        const days = Object.keys((await F.stored(page)).diary).length;
        need(days === 4 && accountDays() === 4, 'after signing in again: ' + days + ' food days on the phone, ' + accountDays() + ' in the account');
        F.assertClean(P, 'signing out');
        return days + ' food days back on the phone';
      });
      await P.close();
    }
  } catch (e) {
    run.say(false, 'fuel-words', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
    await server.stop();
  }
  run.done();
})();
