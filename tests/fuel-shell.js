#!/usr/bin/env node
/* Fuel 3.0, the diet app's shell: a first start, a day of ordinary use, a reload.
 *
 *   node tests/fuel-shell.js [--port=8421]
 *
 * A phone with nothing stored (no Overload data either), the clock at the fixtures' "now":
 *   - the first start shows Welcome and stores nothing; Start fresh gives an empty diary;
 *   - a food added by search (the built-in list is fetched from ../data/foods.json), one by Quick add, an
 *     amount edited, a food dragged to another meal, an entry deleted, a meal saved, the barcode reader's
 *     files found one folder up;
 *   - targets, body weight and units, the theme, the Trends screen;
 *   - after a reload everything is still there;
 *   - window.__overload offers exactly what the spec lists and food.js started on it;
 *   - the saved state has the shape of SPEC section 2 and no exercises field;
 *   - nothing was written under any overload.* name; no page error and no console error.
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const lib = require('./lib');
const F = require('./fuel-common');

const args = F.args();
const PORT = Number(args.port) || 8421;
const run = F.runner('fuel-shell');
const { need, same } = run;
const fx = lib.loadFixture('v28-state');   // only for its clock: "today" is 2026-11-21 in America/Los_Angeles
const TODAY = fx.meta.today;

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  const phone = await lib.newPhone(browser, { now: fx.meta.now, timezoneId: fx.meta.tz });
  const requests = [];
  phone.context.on('response', (r) => requests.push(r.status() + ' ' + new URL(r.url()).pathname + new URL(r.url()).search));
  let page = null;
  const step = (title, fn) => run.step('fresh phone', title, fn);
  const entries = async () => ((await F.stored(page)).diary[TODAY] || []);
  try {
    // ---- first start ----
    const started = await step('first start shows Welcome and stores nothing', async () => {
      page = await F.open(phone, server);
      need((await F.screen(page)) === 'welcome', 'the screen is "' + (await F.screen(page)) + '", expected welcome');
      const body = await F.text(page, '#app');
      for (const t of ['Welcome to Fuel', 'Paste from Overload', 'Choose a file', 'Sign in to cloud sync', 'Start fresh']) need(body.includes(t), 'Welcome does not offer "' + t + '"');
      need(!body.includes('on this device'), 'offers Overload data on this device, but there is none');
      need(!(await page.isVisible('.tabbar')), 'the tab bar shows on Welcome');
      const keys = Object.keys(await lib.readStorage(page));
      need(keys.length === 0, 'something was stored before he chose: ' + keys.join(', '));
      need((await page.evaluate(() => indexedDB.databases().then((l) => l.map((d) => d.name)))).length === 0, 'a database was made before he chose');
      return 'Welcome, 4 choices, nothing stored';
    });
    if (!started) throw new Error('the app did not start');

    await step('window.__overload is what the spec lists, and food.js runs on it', async () => {
      const api = await page.evaluate(() => ({ top: Object.keys(Object.getOwnPropertyDescriptors(window.__overload)).sort(), lib: Object.keys(window.__overload.lib).sort(),
        food: Object.keys(window.__overloadFood).sort(), types: ['save', 'render', 'setState', 'safetyCopy', 'setSyncStatus', 'syncChanged'].map((k) => typeof window.__overload[k]) }));
      same(api.top, ['lib', 'render', 'safetyCopy', 'save', 'saveFailed', 'screen', 'setState', 'setSyncStatus', 'state', 'syncChanged', 'unreadable'], 'window.__overload');
      same(api.lib, ['$', 'addDays', 'closeSheet', 'esc', 'fmtDate', 'markDeleted', 'num', 'openSheet', 'sheetHeader', 'toast', 'todayKey', 'uid'], 'window.__overload.lib');
      need(api.types.every((t) => t === 'function'), 'not all functions: ' + api.types.join(', '));
      same(api.food, ['_', 'change', 'click', 'input', 'render', 'settingsCard', 'submit'], 'window.__overloadFood');
      return '11 members, 12 helpers';
    });

    await step('Start fresh gives an empty diary', async () => {
      await page.click('[data-action="fuel-fresh"]');
      await page.waitForSelector('.f-meal');
      need((await F.screen(page)) === 'food', 'the screen is "' + (await F.screen(page)) + '"');
      need(await page.isVisible('.tabbar'), 'no tab bar');
      same(await lib.tabNames(page), ['food', 'trends', 'settings'], 'the tabs');
      const day = await F.readDay(page);
      need(day.date === TODAY && day.label === 'Today' && day.entries === 0 && day.kcal === '0', 'the day reads ' + JSON.stringify(day));
      const st = await F.stored(page);
      need(st && st.v === 1 && st.app === 'fuel' && Object.keys(st.diary).length === 0, 'the saved state is not an empty Fuel state');
      return 'Today, 0 kcal, 4 empty meals';
    });

    await step('Trends and Settings draw on an empty diary with no targets', async () => {
      await lib.openTab(page, 'trends');
      need(await F.count(page, '.trend-chart .trend-day') === 14 && await F.count(page, '.trend-chart .bar.none') === 14, 'not 14 empty days');
      need(await F.count(page, '.trend-chart .target') === 0 && await F.count(page, '.legend .swatch.over') === 0, 'a target line or "over target" shows without a target');
      const t = await F.text(page, '#app');
      need(/No full day logged in the last 14 days yet/.test(t) && !/NaN|undefined|null/.test(t), 'Trends reads ' + t.slice(0, 300));
      const rows = await page.evaluate(() => [...document.querySelectorAll('.trend-table tbody tr')].map((r) => [...r.cells].map((c) => c.textContent.trim()).join(' | ')));
      same(rows, ['Calories | – | –', 'Protein | – | –', 'Carbs | – | –', 'Fat | – | –', 'Days logged | 0 of 6 | 0 of 7'], 'the averages');
      await lib.openTab(page, 'settings');
      need(/Leave a box empty for no target/.test(await F.text(page, '#app')) && (await page.inputValue('[data-field="fuel-bw"]')) === '', 'Settings does not draw as expected');
      await lib.openTab(page, 'food');
      return rows[4];
    });

    // ---- a day of use ----
    let searched = null;
    await step('add a food by search (the built-in list comes from ../data/foods.json)', async () => {
      await page.click('[data-action="food-add"][data-meal="0"]');
      await page.waitForSelector('#sheet:not([hidden]) #food-results');
      await page.fill('[data-field="food-search"]', 'chicken breast');
      await page.waitForSelector('#food-results [data-action="food-pick"][data-src="usda"]', { timeout: 15000 });
      need(requests.includes('200 /data/foods.json?db=5'), 'the food list was not fetched from /data/foods.json?db=5: ' + requests.filter((r) => /foods/.test(r)).join(', '));
      const hits = await F.count(page, '#food-results [data-action="food-pick"]');
      await page.click('#food-results [data-action="food-pick"][data-src="usda"] >> nth=0');
      await page.waitForSelector('#food-preview .stat');
      searched = await F.text(page, '.f-food-name');
      await page.click('[data-action="food-save"]');
      await page.waitForSelector('#food-added .f-added:not(.none)');
      await F.afterAdd();
      await F.closeSheet(page);
      const list = await entries();
      need(list.length === 1 && list[0].name === searched && list[0].meal === 0 && list[0].kcal > 0, 'the diary holds ' + JSON.stringify(list).slice(0, 200));
      need((await F.readDay(page)).meals[0].foods === 1, 'Breakfast does not show the food');
      need(Object.keys((await F.stored(page)).food.foods).length === 1, 'the food itself was not kept for Recent');
      return hits + ' hits, added "' + searched + '", ' + list[0].kcal + ' kcal';
    });

    await step('add by Quick add', async () => {
      await F.quickAdd(page, 3, 'Trail mix', 300, 8, 30, 16);
      const list = await entries(), q = list.find((e) => e.name === 'Trail mix');
      need(list.length === 2 && q && q.kcal === 300 && q.p === 8 && q.c === 30 && q.f === 16 && q.meal === 3 && q.food === null, 'the diary holds ' + JSON.stringify(list).slice(0, 300));
      need(typeof q.id === 'string' && q.id && typeof q.at === 'number', 'the entry has no id or time');
      return 'Snacks: Trail mix, 300 kcal';
    });

    await step('edit an amount', async () => {
      const before = (await entries())[0];
      await page.click('.f-meal .f-row[data-id="' + before.id + '"]');
      await page.waitForSelector('#sheet:not([hidden]) [data-field="food-qty"]');
      const qty = Number(await page.inputValue('[data-field="food-qty"]'));
      await page.fill('[data-field="food-qty"]', String(qty * 2));
      await page.click('[data-action="food-save"]');
      await F.toast(page, /Saved/);
      const after = (await entries()).find((e) => e.id === before.id);
      need(after && after.qty === qty * 2 && Math.abs(after.kcal - before.kcal * 2) <= 1, 'the entry is ' + JSON.stringify(after) + ' after doubling ' + JSON.stringify(before));
      need((await entries()).length === 2, 'editing added or removed an entry');
      return before.kcal + ' kcal → ' + after.kcal + ' kcal';
    });

    await step('drag a food to another meal', async () => {
      await lib.sleep(500);
      const q = (await entries()).find((e) => e.name === 'Trail mix');
      const from = await page.locator('.f-meal .f-row[data-id="' + q.id + '"]').boundingBox();
      const to = await page.locator('.f-meal[data-meal="1"] [data-action="food-add"]').boundingBox();
      const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 }, b = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      await page.mouse.move(a.x, a.y + (b.y > a.y ? 14 : -14), { steps: 3 });
      await page.mouse.move(b.x, b.y, { steps: 12 });
      await page.mouse.up(); await lib.sleep(500);
      const moved = (await entries()).find((e) => e.id === q.id), day = await F.readDay(page);
      need(moved && moved.meal === 1, 'the entry is in meal ' + (moved && moved.meal) + ' after the drag');
      need(day.meals[1].foods === 1 && day.meals[3].foods === 0 && (await F.sheetOpen(page)) === false, 'the screen shows ' + JSON.stringify(day.meals));
      return 'Snacks → Lunch';
    });

    await step('delete an entry (a deletion record is kept)', async () => {
      await lib.sleep(500);
      const q = (await entries()).find((e) => e.name === 'Trail mix');
      await page.click('.f-meal .f-row[data-id="' + q.id + '"]');
      await page.waitForSelector('#food-quick-form [data-action="food-delete"]');
      await page.click('#food-quick-form [data-action="food-delete"]');
      await F.toast(page, /Removed/);
      const st = await F.stored(page);
      need(st.diary[TODAY].length === 1 && !st.diary[TODAY].some((e) => e.id === q.id), 'the entry is still there');
      need(st.deleted.food[q.id] > 0, 'no deletion record for the entry');
      return 'Trail mix removed';
    });

    await step('save a meal', async () => {
      await lib.sleep(500);
      await page.click('[data-action="food-meal-menu"][data-meal="0"]');
      await page.waitForSelector('#sheet:not([hidden]) [data-action="food-save-meal"]');
      await page.click('[data-action="food-save-meal"]');   // the name question is answered with its suggestion, "Breakfast"
      await F.toast(page, /Saved "Breakfast"/);
      const meals = Object.values((await F.stored(page)).food.meals);
      need(meals.length === 1 && meals[0].name === 'Breakfast' && meals[0].items.length === 1 && meals[0].items[0].name === searched, 'saved meals: ' + JSON.stringify(meals).slice(0, 200));
      need(page.dialogs.some((d) => /^prompt: Name this meal/.test(d)), 'the name was not asked');
      return '"Breakfast", 1 food';
    });

    await step('the barcode reader is found one folder up', async () => {
      await page.click('[data-action="food-add"][data-meal="1"]');
      await page.waitForSelector('#sheet:not([hidden]) #food-results');
      const [res] = await Promise.all([page.waitForResponse((r) => /\/vendor\/zxing\/reader\/index\.js/.test(r.url()), { timeout: 10000 }), page.click('.f-addbtns [data-action="food-scan"]')]);
      need(res.status() === 200 && new URL(res.url()).pathname === '/vendor/zxing/reader/index.js', 'the reader was asked for at ' + res.url() + ' (' + res.status() + ')');
      await page.waitForFunction(() => { const s = document.querySelector('#scan-status'); return s && !/Starting camera/.test(s.textContent); }, null, { timeout: 10000 });
      const status = await F.text(page, '#scan-status');
      await lib.sleep(300);
      await F.closeSheet(page);
      return 'no camera here: "' + status + '"';
    });

    await step('set targets', async () => {
      await lib.openTab(page, 'settings');
      need(await F.count(page, '[data-field="food-target"]') === 4, 'no targets card in Settings');
      for (const [k, v] of [['kcal', 2200], ['protein', 160], ['carbs', 250], ['fat', 62]]) await F.typeInto(page, '[data-field="food-target"][data-k="' + k + '"]', v);
      same((await F.stored(page)).food.targets, { kcal: 2200, protein: 160, carbs: 250, fat: 62 }, 'the saved targets');
      const note = await F.text(page, '.f-target-note');
      need(/add up to 2,198 kcal, in line with your 2,200 kcal target/.test(note), 'the note under the targets reads "' + note + '"');
      await lib.openTab(page, 'food');
      const day = await F.readDay(page);
      need(/ \/ 2,200 kcal$/.test(day.kcalLine) && / \/ 160 g$/.test(day.protein), 'Today does not show the targets: ' + day.kcalLine + ', ' + day.protein);
      return day.kcalLine;
    });

    await step('body weight and units, for the protein guide', async () => {
      await lib.openTab(page, 'settings');
      await F.typeInto(page, '[data-field="fuel-bw"]', '180');
      same((await F.stored(page)).bodyweight, [{ date: TODAY, weight: 180 }], 'the saved body weight');
      let note = await F.text(page, '.f-target-note');
      need(/Protein: 125 to 180 g a day suits your 180 lb/.test(note), 'the guide reads "' + note + '"');
      need(await F.count(page, '[data-field="food-target"]') === 4 && (await page.inputValue('[data-field="food-target"][data-k="kcal"]')) === '2200', 'the target boxes were redrawn or lost');
      await page.click('[data-action="fuel-units"][data-v="kg"]');
      const st = await F.stored(page);
      need(st.settings.units === 'kg' && st.bodyweight[0].weight === 81.6, 'after kg: ' + JSON.stringify([st.settings, st.bodyweight]));
      note = await F.text(page, '.f-target-note');
      need(/suits your 81\.6 kg \(1\.5 to 2\.2 g per kg\)/.test(note), 'the guide reads "' + note + '"');
      return '180 lb → 81.6 kg';
    });

    await step('switch theme', async () => {
      await page.click('[data-action="set-theme"][data-v="light"]');
      need((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light', 'data-theme is not light');
      need((await lib.readStorage(page, 'fuel.theme')) === 'light' && (await F.stored(page)).settings.theme === 'light', 'the theme was not saved');
      need((await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(243, 243, 245)', 'the page is not drawn light');
      return 'light';
    });

    await step('Settings shows backup, cloud sync and About', async () => {
      const body = await F.text(page, '#app');
      for (const t of ['Export JSON', 'Import JSON', 'Storage used', 'Automatic copies', 'Cloud sync', 'Bring food from Overload', 'Reset all data', 'Fuel · v3.0', 'Food data: USDA FoodData Central, Open Food Facts']) need(body.includes(t), 'Settings does not show "' + t + '"');
      need(!/workout|exercise/i.test(body), 'Settings talks about training: ' + (body.match(/.{30}(workout|exercise).{30}/i) || [''])[0]);
      return 'all there';
    });

    await step('Trends: 14 days, today so far, averages', async () => {
      await lib.openTab(page, 'trends');
      need(await F.count(page, '.trend-chart .trend-day') === 14, 'not 14 days in the chart');
      need(await F.count(page, '.trend-chart .bar.now') === 1 && await F.count(page, '.trend-chart .bar.none') === 13, 'bars: ' + await page.evaluate(() => [...document.querySelectorAll('.trend-chart .bar')].map((b) => b.getAttribute('class')).join(',')));
      need(await F.count(page, '.trend-chart .target') === 1, 'no target line');
      const fills = await page.evaluate(() => [...document.querySelectorAll('.trend-chart .bar')].map((b) => b.getAttribute('fill')));
      need(fills.every((f) => f === 'currentColor'), 'a bar has a colour of its own: ' + fills.join(','));
      const rows = await page.evaluate(() => [...document.querySelectorAll('.trend-table tbody tr')].map((r) => [...r.cells].map((c) => c.textContent.trim())));
      same(rows.map((r) => r[0]), ['Calories / 2,200', 'Protein / 160 g', 'Carbs / 250 g', 'Fat / 62 g', 'Days logged'], 'the rows of the averages');
      need(rows[0][1] === '–' && rows[4][1] === '1 of 6' && rows[4][2] === '0 of 7', 'this week reads ' + JSON.stringify(rows));   // Saturday: today is logged, but not a full day yet
      await page.click('.trend-chart .trend-day[data-d="' + TODAY + '"]');
      need((await F.screen(page)) === 'food' && (await F.readDay(page)).date === TODAY, 'tapping today did not open it');
      return rows[4].join(' | ');
    });

    // ---- reload ----
    const before = await F.storedText(page);
    await step('after a reload everything is there', async () => {
      await F.reload(page);
      need((await F.screen(page)) === 'food', 'the screen is "' + (await F.screen(page)) + '" after a reload');
      need((await F.storedText(page)) === before, 'the saved text changed over a reload');
      const day = await F.readDay(page), st = await F.live(page);
      need(day.entries === 1 && day.meals[0].foods === 1 && / \/ 2,200 kcal$/.test(day.kcalLine), 'Today reads ' + JSON.stringify(day));
      need(Object.keys(st.food.meals).length === 1 && st.settings.theme === 'light' && st.settings.units === 'kg' && st.bodyweight[0].weight === 81.6, 'the state after a reload: ' + JSON.stringify([st.settings, st.bodyweight]));
      need((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light', 'the theme was not applied at start');
      const sheet = await F.openAddSheet(page, 0);
      need(sheet.groups['Saved meals'] === 1 && sheet.groups.Recent === 1, 'the Add sheet lists ' + JSON.stringify(sheet.groups));
      await F.closeSheet(page);
      return day.kcalLine + ', 1 saved meal, light, kg';
    });

    await step('the saved state has the shape of the spec', async () => {
      const st = await F.stored(page);
      same(Object.keys(st), ['v', 'app', 'settings', 'food', 'diary', 'deleted', 'bodyweight', 'moved'], 'the top-level fields');
      need(st.v === 1 && st.app === 'fuel' && st.moved === null, 'v, app, moved: ' + JSON.stringify([st.v, st.app, st.moved]));
      same(st.settings, { units: 'kg', theme: 'light' }, 'settings');
      same(Object.keys(st.food), ['targets', 'foods', 'meals'], 'food');
      same(Object.keys(st.deleted), ['food', 'foods', 'meals'], 'deleted');
      need(Object.keys(st.deleted.food).length === 1, 'deleted.food holds ' + Object.keys(st.deleted.food).length + ' records');
      need(!('exercises' in st) && !/"exercises"/.test(before), 'there is an exercises field');
      const e = st.diary[TODAY][0];
      same(Object.keys(e).sort(), ['amt', 'at', 'brand', 'c', 'f', 'food', 'id', 'kcal', 'meal', 'name', 'p', 'qty', 'unit'], 'an entry');
      return before.length + ' characters';
    });

    await step('nothing was written under an overload.* name', async () => {
      const where = await page.evaluate(async () => ({
        local: Object.keys(localStorage), session: Object.keys(sessionStorage),
        dbs: (await indexedDB.databases()).map((d) => d.name), caches: await caches.keys() }));
      const bad = [].concat(where.local, where.session, where.dbs, where.caches).filter((k) => /^overload/.test(k));
      need(!bad.length, 'found ' + bad.join(', '));
      same(where.local.filter((k) => k !== lib.SEED_MARK).sort(), ['fuel.backup', 'fuel.state.v1', 'fuel.theme'], 'the keys in localStorage');
      same(where.dbs, ['fuel-copies'], 'the databases');
      return 'localStorage: ' + where.local.sort().join(', ') + '; IndexedDB: ' + where.dbs.join(', ');
    });

    await step('every file the page asked for was there', async () => {
      const bad = phone.badResponses.filter((r) => !/\/fuel\/(sync|sw)\.js/.test(r));
      need(!bad.length, bad.join(', '));
      // The only other host the page may ask is the one cloud sync's module takes its Firebase files from
      // (blocked in tests, so that module does not start). Nothing in this run may reach a food database.
      const other = phone.blocked.filter((u) => !/^https:\/\/www\.gstatic\.com\/firebasejs\//.test(u));
      need(!other.length, 'asked another host: ' + other.join(', '));
      const missing = phone.badResponses.map((r) => r.replace(/^.*\/fuel\//, 'fuel/').replace(/\?.*$/, ''));
      return missing.length ? 'not written yet (another step of this change): ' + [...new Set(missing)].join(', ') : 'all of them';
    });

    await step('no page error and no console error', async () => { F.assertClean(phone); return page.dialogs.length + ' questions asked: ' + page.dialogs.map((d) => d.split('\n')[0]).join(' / '); });
  } catch (e) {
    run.say(false, 'fresh phone', 'the run stopped', String((e && e.message) || e).split('\n')[0]);
  } finally {
    await browser.close();
    await server.stop();
  }
  run.done();
})();
