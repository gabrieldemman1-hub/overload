#!/usr/bin/env node
/* Fuel 3.0: the shell as the host of cloud sync (what fuel/sync.js is given, dev/notes/sync.md section 5).
 *
 *   node tests/fuel-host.js [--port=8425]
 *
 * Cloud sync itself cannot run in tests (its Firebase files are on another host). Here a stand-in for
 * window.__overloadSync is put in the page, and the page is driven the way the real module drives it:
 *   - without the module the Cloud sync card says so and the app runs;
 *   - sign in (a wrong password shows the module's message), the signed-in card, sign out, in Fuel's words;
 *   - setSyncStatus and syncChanged change the pill and the card only: a box being typed in keeps its text;
 *   - setState replaces the data without the save event, cleans what it is given, and waits with the redraw
 *     while a box on the screen has the keyboard;
 *   - every save sends overload:save, every closed sheet overload:sheetclose;
 *   - safetyCopy('cloud') keeps "Before cloud sign-in";
 *   - at Welcome: signing in opens the diary, and data arriving from the account ends Welcome by itself;
 *   - leaving the unreadable-data screen asks the module to sync again; Reset says the account is erased too.
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const lib = require('./lib');
const F = require('./fuel-common');

const args = F.args();
const PORT = Number(args.port) || 8425;
const run = F.runner('fuel-host');
const { need, same } = run;
const fx = lib.loadFixture('v28-state');
const TODAY = fx.meta.today;

const newPhone = (browser) => lib.newPhone(browser, { now: fx.meta.now, timezoneId: fx.meta.tz });
// The stand-in: the members app code uses (user, signIn, createAccount, resetPassword, signOut, pushNow),
// telling the host what the real module tells it.
function standIn(page, user) {
  return page.evaluate((u) => {
    window.__calls = [];
    const host = window.__overload;
    window.__overloadSync = {
      user: u, lastSync: null, error: '',
      async signIn(email, password) {
        window.__calls.push(['signIn', email, password]);
        if (password !== 'right-password') throw new Error('Wrong password. Try again or tap Forgot password.');
        this.user = { email, uid: 'u1' }; host.setSyncStatus('syncing', 'Syncing…'); host.syncChanged();
      },
      async createAccount(email, password) { window.__calls.push(['createAccount', email, password]); this.user = { email, uid: 'u2' }; host.syncChanged(); },
      async resetPassword(email) { window.__calls.push(['resetPassword', email]); },
      async signOut() { window.__calls.push(['signOut']); this.user = null; host.setSyncStatus('off', ''); host.syncChanged(); },
      pushNow() { window.__calls.push(['pushNow']); }
    };
    host.syncChanged();
  }, user || null);
}
const calls = (page) => page.evaluate(() => window.__calls);
// Counts the two events the host sends, from now on.
const listen = (page) => page.evaluate(() => { window.__events = { save: 0, sheetclose: 0 }; if (!window.__listening) { window.__listening = true; document.addEventListener('overload:save', () => window.__events.save++); document.addEventListener('overload:sheetclose', () => window.__events.sheetclose++); } });
const events = (page) => page.evaluate(() => window.__events);
// A mark on the screen's first element: gone when #app was drawn again.
const mark = (page) => page.evaluate(() => { document.querySelector('#app').firstElementChild.__mark = true; });
const marked = (page) => page.evaluate(() => !!document.querySelector('#app').firstElementChild.__mark);

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    const phone = await newPhone(browser);
    let page = null;
    const step = (t, fn) => run.step('cloud sync\'s host', t, fn);

    await step('without the module the card says so, and the app runs', async () => {
      page = await F.open(phone, server);
      await page.click('[data-action="fuel-fresh"]');
      await page.waitForSelector('.f-meal');
      await F.quickAdd(page, 0, 'Porridge', 300, 10, 50, 6);
      await lib.openTab(page, 'settings');
      need(await page.evaluate(() => window.__overloadSync === undefined), 'a sync module is in the page: this test needs to put its own stand-in there');
      const t = await F.text(page, '#cloud-card');
      need(/Cloud sync is loading/.test(t) && (await F.count(page, '#cloud-form')) === 0, 'the card reads ' + t);
      need((await F.count(page, '.sync-pill')) === 0, 'a sync pill shows');
      return t.slice(0, 60);
    });

    await step('sign in: a wrong password shows the module\'s message; the right one signs in', async () => {
      await standIn(page);
      await page.waitForSelector('#cloud-form');
      await page.fill('#cloud-form [name="email"]', 'alex@example.com');
      await page.fill('#cloud-form [name="password"]', 'wrong');
      await page.click('#cloud-form button[type="submit"]');
      await page.waitForFunction(() => /Wrong password/.test(document.querySelector('#cloud-msg').textContent));
      need((await page.inputValue('#cloud-form [name="email"]')) === 'alex@example.com', 'the form was redrawn and lost the address');
      await page.fill('#cloud-form [name="password"]', 'right-password');
      await page.click('#cloud-form button[type="submit"]');
      await F.toast(page, /Signed in/);
      const t = await F.text(page, '#cloud-card');
      need(/Signed in/.test(t) && /alex@example\.com/.test(t) && /Sync now/.test(t) && /Sign out/.test(t) && (await F.count(page, '#cloud-form')) === 0, 'the card reads ' + t);
      same(await calls(page), [['signIn', 'alex@example.com', 'wrong'], ['signIn', 'alex@example.com', 'right-password']], 'what the module was asked');
      need((await F.screen(page)) === 'settings', 'signing in left Settings');
      return t.slice(0, 50);
    });

    await step('setSyncStatus and syncChanged touch the pill and the card only: typing is kept', async () => {
      await page.focus('[data-field="fuel-bw"]');
      await page.keyboard.type('77');   // typed, not yet left: no change event
      await mark(page);
      await page.evaluate(() => { const o = window.__overload; o.setSyncStatus('syncing', 'Syncing…'); o.setSyncStatus('synced', 'Synced just now'); o.syncChanged(); o.setSyncStatus('error', 'Offline'); o.setSyncStatus('synced', 'Synced just now'); });
      need(await marked(page), 'the screen was drawn again');
      need((await page.inputValue('[data-field="fuel-bw"]')) === '77' && (await page.evaluate(() => document.activeElement.dataset.field)) === 'fuel-bw', 'the box lost its text or the keyboard');
      const pill = await page.evaluate(() => { const p = document.querySelector('.sync-pill'); return p && [p.className, p.title]; });
      same(pill, ['pill sync-pill synced', 'Synced just now'], 'the pill in the top bar');
      const st = await page.evaluate(() => { const c = document.querySelector('#cloud-status'); return [c.textContent, c.className]; });
      same(st, ['Synced just now', 'pill cloud-status synced'], 'the status in the card');
      await page.keyboard.press('Tab');
      need((await F.stored(page)).bodyweight[0].weight === 77, 'the typed weight was not saved on leaving the box');
      return pill.join(', ');
    });

    await step('setState replaces the data, cleans it, sends no save event, and stores it', async () => {
      await listen(page);
      const next = await page.evaluate((day) => {
        const o = window.__overload, n = JSON.parse(JSON.stringify(o.state));
        n.diary[day].push({ id: 'cloud0entry1', food: null, meal: 2, qty: null, unit: null, amt: '', name: 'From another phone', brand: '', kcal: '450', p: 30, c: 40, f: 15, at: Date.now() });
        n.diary['2026-11-20'] = [{ name: 'No id', kcal: 100, p: 1, c: 1, f: 1, meal: 9 }];
        n.diary['yesterday'] = [{ id: 'x', kcal: 1, p: 0, c: 0, f: 0, meal: 0 }];
        n.food.targets.kcal = 2100; n.exercises = []; n.settings.connKey = 'secret'; n.settings.theme = 'light';
        delete n.deleted.meals;
        o.setState({ v: 2, app: 'fuel', diary: {} });   // not a state this version knows: ignored
        o.setState(n);
        return JSON.parse(JSON.stringify(o.state));
      }, TODAY);
      const st = await F.stored(page);
      same(st, next, 'the stored state against the one in memory');
      const e = st.diary[TODAY].find((x) => x.id === 'cloud0entry1'), y = st.diary['2026-11-20'][0];
      need(st.diary[TODAY].length === 2 && e.kcal === 450 && y.meal === 3 && typeof y.id === 'string' && y.id && typeof y.at === 'number', 'entries were not cleaned: ' + JSON.stringify([e, y]));
      need(!st.diary.yesterday && !('exercises' in st) && !('connKey' in st.settings) && st.deleted.meals && st.food.targets.kcal === 2100, 'the state was not made whole: ' + JSON.stringify([Object.keys(st), st.settings, Object.keys(st.deleted)]));
      need((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light' && (await lib.readStorage(page, 'fuel.theme')) === 'light', 'the theme that came with the data was not applied');
      same(await events(page), { save: 0, sheetclose: 0 }, 'events sent by setState');
      return st.diary[TODAY].length + ' entries today, target 2,100';
    });

    await step('data from the cloud does not redraw the screen under a box being typed in', async () => {
      await page.focus('[data-field="food-target"][data-k="protein"]');
      await page.keyboard.type('15');
      await mark(page);
      await page.evaluate(() => { const o = window.__overload, n = JSON.parse(JSON.stringify(o.state)); n.food.targets.fat = 70; o.setState(n); });
      await lib.sleep(1600);
      need(await marked(page) && (await page.inputValue('[data-field="food-target"][data-k="protein"]')) === '15', 'the screen was redrawn while typing');
      need((await F.stored(page)).food.targets.fat === 70, 'the data itself was not stored at once');
      await page.evaluate(() => document.activeElement.blur());
      await page.waitForFunction(() => !document.querySelector('#app').firstElementChild.__mark, null, { timeout: 4000 });
      need((await page.inputValue('[data-field="food-target"][data-k="fat"]')) === '70', 'the redraw after typing does not show the new data');
      await lib.openTab(page, 'food');
      const day = await F.readDay(page);
      need(day.entries === 2 && day.meals[2].foods === 1, 'Today does not show the entry from the cloud: ' + JSON.stringify(day.meals));
      return 'held back while typing, drawn after';
    });

    await step('every save sends overload:save, every closed sheet overload:sheetclose', async () => {
      await listen(page);
      await F.quickAdd(page, 3, 'Apple', 95, 0, 25, 0);   // one save, one sheet closed
      const a = await events(page);
      need(a.save === 1 && a.sheetclose === 1, 'after a quick add: ' + JSON.stringify(a));
      await page.click('[data-action="food-meal-menu"][data-meal="0"]');
      await page.waitForSelector('#sheet:not([hidden])');
      await page.click('.sheet-backdrop', { position: { x: 20, y: 20 } });
      need((await F.sheetOpen(page)) === false && (await events(page)).sheetclose === 2, 'a tap outside the sheet did not close it through the host');
      await page.evaluate(() => { window.__overload.lib.openSheet(window.__overload.lib.sheetHeader('Test &amp; title')); });
      need((await F.text(page, '#sheet .sheet-title h2')) === 'Test & title' && (await page.evaluate(() => document.body.style.overflow)) === 'hidden', 'openSheet or sheetHeader behave differently');
      await page.evaluate(() => { window.__overload.lib.toast('<b>plain</b> text'); window.__overload.lib.closeSheet(); });
      need((await F.text(page, '#toast')) === '<b>plain</b> text' && (await page.evaluate(() => document.querySelector('#sheet').hidden && document.body.style.overflow === '')), 'toast or closeSheet behave differently');
      same(await events(page), { save: 1, sheetclose: 3 }, 'the events in all');
      return JSON.stringify(await events(page));
    });

    await step('safetyCopy("cloud") keeps "Before cloud sign-in"', async () => {
      const text = await F.storedText(page);
      need((await page.evaluate(() => window.__overload.safetyCopy('cloud'))) === true, 'safetyCopy did not say the copy is stored');
      const c = await F.copy(page, 'before-cloud');
      need(c && c.text === text && c.kind === 'cloud', 'the copy is missing or differs');
      await lib.openTab(page, 'settings');
      await page.waitForFunction(() => /Before cloud sign-in/.test(document.querySelector('#safety-copies').textContent), null, { timeout: 5000 });
      return 'listed in Settings';
    });

    await step('Reset says the account is erased too; Sync now and Sign out reach the module', async () => {
      await page.evaluate(() => { window.__calls.length = 0; });
      const asked = page.dialogs.length;
      await page.click('[data-action="cloud-push"]');
      await F.toast(page, /Sync requested/);
      await page.evaluate(() => localStorage.setItem('fuel.sync.v1', '{"uid":"u1","core":"h1","days":{}}'));
      await page.click('[data-action="reset"]');
      await F.toast(page, /Reset/);
      const qs = page.dialogs.slice(asked);
      need(qs.length === 2 && /the food log in your account \(alex@example\.com\) is erased too/.test(qs[0]) && /Export a backup first/.test(qs[1]), 'the questions: ' + qs.join(' / '));
      need((await lib.readStorage(page, 'fuel.sync.v1')) !== null, 'signed in, cloud sync\'s note must stay (the module sends the reset to the account)');
      await page.click('[data-action="cloud-signout"]');
      await F.toast(page, /Signed out/);
      need(/Sign out\? Your food log stays on this phone and in the cloud/.test(page.dialogs[page.dialogs.length - 1]), 'the sign-out question reads ' + page.dialogs[page.dialogs.length - 1]);
      await page.waitForSelector('#cloud-form');
      need((await F.count(page, '.sync-pill')) === 0, 'the pill stayed after signing out');
      same(await calls(page), [['pushNow'], ['signOut']], 'what the module was asked');
      // Signed out, a reset forgets the note: the next sign-in then merges instead of deleting from the account.
      await page.click('[data-action="reset"]');
      await F.toast(page, /Reset/);
      need((await lib.readStorage(page, 'fuel.sync.v1')) === null, 'signed out, the note was kept over a reset');
      need(!/account/.test(page.dialogs[page.dialogs.length - 2]), 'signed out, the question still talks about the account');
      F.assertClean(phone, 'host');
      return qs[0].split('\n').pop();
    });
    await phone.close();

    // ---------------------------------------------------------------- Welcome and cloud sync
    const w = (t, fn) => run.step('Welcome and cloud sync', t, fn);
    const p2 = await newPhone(browser);
    await w('Sign in to cloud sync opens the form in a sheet; signing in opens the diary', async () => {
      const pg = await F.open(p2, server);
      await pg.click('[data-action="fuel-signin"]');
      need(/Cloud sync is loading/.test(await F.text(pg, '#sheet-panel')), 'without the module the sheet reads ' + await F.text(pg, '#sheet-panel'));
      await standIn(pg);
      await pg.waitForSelector('#sheet #cloud-form');
      need(Object.keys(await lib.readStorage(pg)).length === 0, 'something was stored at Welcome');
      await pg.fill('#cloud-form [name="email"]', 'alex@example.com');
      await pg.fill('#cloud-form [name="password"]', 'right-password');
      await pg.click('#cloud-form button[type="submit"]');
      await F.toast(pg, /Signed in/);
      need((await F.sheetOpen(pg)) === false && (await F.screen(pg)) === 'food' && await pg.isVisible('.tabbar'), 'the diary did not open');
      const st = await F.stored(pg);
      need(st && st.app === 'fuel' && Object.keys(st.diary).length === 0, 'no state of its own was stored');
      // what the account holds arrives a moment later
      await pg.evaluate((day) => { const o = window.__overload, n = JSON.parse(JSON.stringify(o.state)); n.diary[day] = [{ id: 'c1', food: null, meal: 0, qty: null, unit: null, amt: '', name: 'From the account', brand: '', kcal: 200, p: 1, c: 2, f: 3, at: 1 }]; o.setState(n); }, TODAY);
      need((await F.readDay(pg)).entries === 1, 'the data from the account is not on screen');
      F.assertClean(p2, 'welcome');
      return 'diary, then 1 entry from the account';
    });
    await p2.close();

    const p3 = await newPhone(browser);
    await w('already signed in with nothing stored: Welcome says so, and the account\'s data ends it', async () => {
      const pg = await F.open(p3, server);
      await standIn(pg, { email: 'alex@example.com', uid: 'u1' });
      await pg.waitForFunction(() => /Signed in as alex@example\.com/.test(document.querySelector('#app').textContent));
      need((await F.screen(pg)) === 'welcome' && Object.keys(await lib.readStorage(pg)).length === 0, 'Welcome ended or stored something by itself');
      await pg.evaluate((day) => { const o = window.__overload, n = JSON.parse(JSON.stringify(o.state)); n.diary[day] = [{ id: 'c1', food: null, meal: 1, qty: null, unit: null, amt: '', name: 'From the account', brand: '', kcal: 200, p: 1, c: 2, f: 3, at: 1 }]; n.settings.theme = 'dark'; o.setState(n); }, TODAY);
      await pg.waitForSelector('.f-meal');
      const day = await F.readDay(pg);
      need((await F.screen(pg)) === 'food' && day.entries === 1 && await pg.isVisible('.tabbar'), 'the diary did not open with the data');
      need((await F.stored(pg)).diary[TODAY].length === 1 && (await lib.readStorage(pg, 'fuel.theme')) === 'dark', 'the data or the theme was not stored');
      F.assertClean(p3, 'welcome, signed in');
      return day.kcalLine;
    });
    await p3.close();

    // ---------------------------------------------------------------- unreadable data and cloud sync
    const p4 = await newPhone(browser);
    await lib.seedStorage(p4.context, { 'fuel.state.v1': '{"v":1,"app":"fuel","diary":{"2026-11-2' });
    await run.step('unreadable data and cloud sync', 'the module is told to wait, and asked to sync again when he has chosen', async () => {
      const pg = await F.open(p4, server);
      await standIn(pg, { email: 'alex@example.com', uid: 'u1' });
      need((await pg.evaluate(() => window.__overload.unreadable)) === true, 'unreadable is not set');
      await pg.click('[data-action="unreadable-fresh"]');
      await F.toast(pg, /Started fresh/);
      need((await pg.evaluate(() => window.__overload.unreadable)) === false, 'unreadable stayed set');
      same(await calls(pg), [['pushNow']], 'what the module was asked');
      F.assertClean(p4, 'unreadable');
      return 'pushNow after Start fresh';
    });
    await p4.close();
  } catch (e) {
    run.say(false, 'fuel-host', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
    await server.stop();
  }
  run.done();
})();
