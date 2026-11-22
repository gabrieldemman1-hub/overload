#!/usr/bin/env node
/* Fuel 3.0: bringing the food log across from Overload.
 *
 *   node tests/fuel-import.js [--port=8422]
 *
 * The "old phone" is the main v2.8 fixture. What Overload 3.0 would hand over is built here from SPEC
 * section 5, not with the training app's code. For the clipboard and same-storage routes the fixture gets two
 * names btoa() cannot take and a connector secret in its settings; the two file routes carry the fixture
 * exactly as it is (the backup file with the connector settings on top). Each route starts from a Fuel with
 * nothing stored:
 *   - the clipboard text, gzip form and plain form;
 *   - the food file; a full Overload backup file; Overload's data in the same storage.
 * After each: the data equals the old phone's key by key (diary, saved foods, saved meals, targets, deletion
 * records, units, theme, the latest weigh-in); the three food days named in tests/fixtures/README.md show
 * what v2.8 showed; the Add sheet lists 3 saved meals, 6 favourites and the recents; entries whose food was
 * deleted and quick adds are there; nothing of Overload's settings came along.
 * Then: a second import adds nothing; an entry, a saved food and a saved meal deleted in Fuel do not come
 * back; a copy that is not newer is said to be so; a Fuel with its own entries and targets keeps them;
 * malformed text and files are refused or cleaned with a message, and nothing ever throws.
 * Saved foods both sides hold (review finding H1): after Start fresh and two foods logged from the food list,
 * the import gives them Overload's star and the bar's corrected numbers (Fuel's last use and amount stay),
 * the question says so, the numbers survive the food list loading, a second import adds nothing, and a
 * backup of the result comes back exactly; with foods made, corrected or deleted in Fuel, Fuel's stay.
 * An entry id on two days arrives on both (H4); entries without an id keep the same made-up id when the
 * entries before them change, twins included, so a later copy does not add them again (H5).
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const lib = require('./lib');
const F = require('./fuel-common');

const args = F.args();
const PORT = Number(args.port) || 8422;
const run = F.runner('fuel-import');
const { need, same } = run;

const fx = lib.loadFixture('v28-state');
const TODAY = fx.meta.today, NOW = fx.meta.now;
const SECRET = 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00';   // stands in for settings.connKey
const ODD_NAME = 'Müsli “extra” 餃子 🍜 ×2';                    // not Latin-1: base64 must be made from UTF-8 bytes
// The old phone: the fixture, plus what a hand-over must cope with.
function oldPhone() {
  const st = JSON.parse(fx.text);
  st.diary[TODAY][0].name = ODD_NAME;
  st.food.meals.twbis5m0bdnt.name = 'Shake + banana 🍌 Ελληνικά';
  st.settings.connKey = SECRET;
  st.settings.connUrl = 'https://connector.example.workers.dev';
  return st;
}
const OLD = oldPhone();
// The fixture exactly as it is, for the two file routes: what arrives must equal the fixture itself. (The
// backup file gets the connector settings on top, which are no part of the food.)
const PURE = JSON.parse(fx.text);
const PURE_WITH_SECRET = JSON.parse(fx.text);
Object.assign(PURE_WITH_SECRET.settings, { connKey: SECRET, connUrl: 'https://connector.example.workers.dev' });
const COUNTS = fx.facts.counts;
const PAYLOAD = F.payloadFrom(OLD, NOW - 60000);   // "Copy my food log", a minute ago
const n = (x) => x.toLocaleString('en-US');

async function newPhone(browser, opts) {
  const phone = await lib.newPhone(browser, { now: NOW, timezoneId: fx.meta.tz });
  if (!opts || opts.clipboard !== false) await phone.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  return phone;
}
const setClipboard = (page, text) => page.evaluate((t) => navigator.clipboard.writeText(t), text);
const importMsg = async (page) => { await page.waitForSelector('#fuel-import-msg', { timeout: 8000 }); return F.text(page, '#fuel-import-msg'); };
const lastQuestion = (page) => (page.dialogs.filter((d) => /^confirm: Bring this food log/.test(d)).pop() || '');
// Pasting into the box of the import sheet, as the phone's Paste does: the text arrives with the paste event.
async function pasteIntoBox(page, text) {
  await page.waitForSelector('#fuel-paste');
  await page.evaluate((t) => {
    const dt = new DataTransfer(); dt.setData('text/plain', t);
    document.querySelector('#fuel-paste').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}
// Settings > Bring food from Overload > the box.
async function openBox(page) {
  await F.closeSheet(page);
  await lib.openTab(page, 'settings');
  await page.click('[data-action="fuel-import"]');
  await page.click('[data-action="fuel-paste-box"]');
  await page.waitForSelector('#fuel-paste');
}
// Typing a text into the box and tapping "Bring it in".
async function submitText(page, text) {
  await openBox(page);
  await page.fill('#fuel-paste', text);
  await page.click('#fuel-paste-form button[type="submit"]');
}
// Logging a food from the food list on the day on screen: search, pick it, Add. Returns the preview's text.
async function logListed(page, meal, query, id) {
  await page.click('[data-action="food-add"][data-meal="' + meal + '"]');
  await page.waitForSelector('#sheet:not([hidden]) #food-results');
  await page.fill('[data-field="food-search"]', query);
  await page.waitForSelector('#food-results [data-action="food-pick"][data-id="' + id + '"]', { timeout: 15000 });
  await page.click('#food-results [data-action="food-pick"][data-id="' + id + '"]');
  await page.waitForSelector('#food-preview .stat');
  const shown = await F.text(page, '#food-preview');
  await page.click('[data-action="food-save"]');
  await page.waitForFunction(() => document.querySelector('#sheet').hidden || !!document.querySelector('#food-added .f-added:not(.none)'), null, { timeout: 8000 });
  await F.afterAdd(); await F.closeSheet(page);
  return shown;
}
const dayAgo = (day) => Math.round((Date.parse(TODAY) - Date.parse(day)) / 864e5);
const kcalOf = (list) => list.reduce((s, e) => s + e.kcal, 0);
const unstarred = (food) => { const f = Object.assign({}, food); delete f.fav; return f; };

// Everything a route must show once the old phone's food is in a Fuel that had nothing.
async function checkImported(label, phone, page, from, old) {
  old = old || OLD;   // what was handed over (the odd entries looked up below have the same ids in both)
  const step = (title, fn) => run.step(label, title, fn);
  let st = null;

  await step('asked first, saying what will be added', async () => {
    const q = lastQuestion(page);
    need(q, 'no question was asked; dialogs: ' + page.dialogs.join(' / ').slice(0, 200));
    for (const t of ['From: ' + from, 'It holds ' + n(COUNTS.foodDays) + ' days, ' + n(COUNTS.foodEntries) + ' entries, ' + COUNTS.savedFoods + ' saved foods, ' + COUNTS.savedMeals + ' saved meals.',
      'New here: ' + n(COUNTS.foodEntries) + ' entries on ' + COUNTS.foodDays + ' days, ' + COUNTS.savedFoods + ' saved foods, ' + COUNTS.savedMeals + ' saved meals, the daily targets, your body weight.',
      'Nothing in Fuel is replaced or removed.']) need(q.includes(t), 'the question does not say "' + t + '": ' + q.replace(/\n/g, ' | '));
    need(!/Already in Fuel|not brought back|left out|could not be read|not newer/.test(q), 'the question mentions things that did not happen: ' + q.replace(/\n/g, ' | '));
    return q.split('\n')[2];
  });

  await step('the diary equals the old phone\'s, key by key', async () => {
    st = await F.stored(page);
    need(st && st.v === 1 && st.app === 'fuel', 'no Fuel state was saved');
    same(st.diary, old.diary, 'diary');
    const c = F.diaryCounts(st.diary, st.food.foods);
    need(c.days === COUNTS.foodDays && c.entries === COUNTS.foodEntries, c.days + ' days, ' + c.entries + ' entries');
    need(c.quick === COUNTS.quickAddEntries && c.orphans === COUNTS.entriesOfDeletedFoods, c.quick + ' quick adds and ' + c.orphans + ' entries of deleted foods, expected ' + COUNTS.quickAddEntries + ' and ' + COUNTS.entriesOfDeletedFoods);
    need(st.diary[TODAY][0].name === old.diary[TODAY][0].name, 'the first name of today arrived as "' + st.diary[TODAY][0].name + '"');
    same(await F.live(page), st, 'the state in memory against the saved one');
    return c.days + ' days, ' + n(c.entries) + ' entries, ' + c.quick + ' quick adds, ' + c.orphans + ' of deleted foods' + (old === OLD ? ' (with the name "' + ODD_NAME + '")' : ' (the fixture itself)');
  });

  await step('saved foods, saved meals and targets equal the old phone\'s', async () => {
    same(st.food.foods, old.food.foods, 'food.foods');
    same(st.food.meals, old.food.meals, 'food.meals');
    same(st.food.targets, old.food.targets, 'food.targets');
    same(Object.keys(st.food).sort(), ['foods', 'meals', 'targets'], 'the fields of food');
    const foods = Object.values(st.food.foods);
    need(foods.filter((f) => f.fav).length === COUNTS.favourites && foods.filter((f) => f.src === 'custom').length === COUNTS.customFoods && foods.filter((f) => f.barcode).length === COUNTS.foodsWithBarcode, 'favourites, custom foods or barcodes are not all there');
    return foods.length + ' foods (' + COUNTS.favourites + ' favourites, ' + COUNTS.customFoods + ' custom, ' + COUNTS.foodsWithBarcode + ' barcodes), ' + Object.keys(st.food.meals).length + ' meals, ' + JSON.stringify(st.food.targets);
  });

  await step('deletion records, units, theme, latest weigh-in, and the note of the hand-over', async () => {
    same(st.deleted, { food: old.deleted.food, foods: {}, meals: {} }, 'deleted');
    same(st.settings, { units: 'lb', theme: 'dark' }, 'settings');
    same(st.bodyweight, [{ date: '2026-11-21', weight: 183.6 }], 'bodyweight');
    need((await lib.readStorage(page, 'fuel.theme')) === 'dark' && (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark', 'the theme was not taken over');
    const m = st.moved;
    need(m && m.days === COUNTS.foodDays && m.entries === COUNTS.foodEntries && typeof m.at === 'number' && typeof m.madeAt === 'number' && m.from === from, 'moved is ' + JSON.stringify(m));
    same(Object.keys(st), ['v', 'app', 'settings', 'food', 'diary', 'deleted', 'bodyweight', 'moved'], 'the top-level fields');
    return 'moved: ' + JSON.stringify(m);
  });

  await step('nothing else of Overload came along (no exercises, no connector key, no reminders)', async () => {
    await F.copy(page, 'day-' + TODAY);   // written in the background right after the import
    const all = await page.evaluate(async () => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!/^overload\./.test(k)) out['localStorage ' + k] = localStorage.getItem(k); }
      for (let i = 0; i < sessionStorage.length; i++) out['sessionStorage ' + sessionStorage.key(i)] = sessionStorage.getItem(sessionStorage.key(i));
      for (const m of await window.__overloadBackup.list()) out['copy ' + m.id] = (await window.__overloadBackup.get(m.id)).text;
      return out;
    });
    for (const k of Object.keys(all)) {
      const hit = /connKey|connUrl|reminders|"exercises"|"workouts"|"presc"|"sleep"|c0ffee00|connector\.example/.exec(all[k]);
      need(!hit, k + ' holds "' + (hit && hit[0]) + '"');
    }
    need(Object.keys(all).some((k) => /^copy day-/.test(k)), 'no automatic copy was taken after the import: ' + Object.keys(all).join(', '));
    same(JSON.parse(all['copy day-' + TODAY]), st, 'today\'s automatic copy against the saved state');
    return Object.keys(all).join(', ');
  });

  // ---- what the screens show ----
  for (const want of fx.facts.foodDays) {
    await step('the day ' + want.label + ' shows what v2.8 showed', async () => {
      await F.gotoDay(page, want.daysAgo);
      const got = await F.readDay(page);
      for (const k of ['date', 'label', 'kcal', 'kcalLine', 'left', 'protein', 'carbs', 'fat', 'entries']) need(got[k] === want[k], k + ' reads "' + got[k] + '", v2.8 showed "' + want[k] + '"');
      same(got.meals, want.meals, 'the meals');
      return got.kcalLine + ', ' + got.left + ', P ' + got.protein + ', C ' + got.carbs + ', F ' + got.fat + ', ' + got.entries + ' entries';
    });
  }
  await step('the Add sheet lists the saved meals, favourites and recents', async () => {
    await F.gotoDay(page, 0);
    const sheet = await F.openAddSheet(page, 3);
    same(sheet.groups, fx.facts.addSheet.groups, 'the groups');
    same(sheet.favourites, fx.facts.addSheet.favourites, 'the favourites');
    need(sheet.title === fx.facts.addSheet.title, 'the sheet is titled "' + sheet.title + '"');
    await F.closeSheet(page);
    return JSON.stringify(sheet.groups);
  });
  await step('an entry whose food was deleted opens; a quick add opens', async () => {
    const day = Object.keys(OLD.diary).reverse().find((k) => OLD.diary[k].some((e) => e.food && !OLD.food.foods[e.food]));
    const e = OLD.diary[day].find((x) => x.food && !OLD.food.foods[x.food]);
    await F.gotoDay(page, Math.round((Date.parse(TODAY) - Date.parse(day)) / 864e5));
    need((await F.readDay(page)).date === day, 'could not open ' + day);
    await page.click('.f-meal .f-row[data-id="' + e.id + '"]');
    await page.waitForSelector('#food-preview .stat');
    need((await F.text(page, '.f-food-name')) === e.name, 'the sheet shows "' + (await F.text(page, '.f-food-name')) + '"');
    await F.closeSheet(page);
    const qd = Object.keys(OLD.diary).reverse().find((k) => OLD.diary[k].some((x) => x.food == null && x.qty == null));
    const q = OLD.diary[qd].find((x) => x.food == null && x.qty == null);
    await F.gotoDay(page, Math.round((Date.parse(TODAY) - Date.parse(qd)) / 864e5));
    await page.click('.f-meal .f-row[data-id="' + q.id + '"]');
    await page.waitForSelector('#food-quick-form');
    need((await page.inputValue('#food-quick-form [name="kcal"]')) === String(q.kcal), 'the quick add shows ' + (await page.inputValue('#food-quick-form [name="kcal"]')) + ' kcal');
    await F.closeSheet(page);
    await F.gotoDay(page, 0);
    return e.name + ' (' + day + '), ' + q.name + ' ' + q.kcal + ' kcal (' + qd + ')';
  });
  await step('looking at it changed nothing; no error', async () => {
    same(await F.stored(page), st, 'the saved state after looking around');
    F.assertClean(phone, label);
  });
  return st;
}

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  const tmp = F.tempDir();
  const gzipText = F.foodText(PAYLOAD, true), plainText = F.foodText(PAYLOAD, false);
  try {
    // ---------------------------------------------------------------- 1. clipboard, gzip
    const p1 = await newPhone(browser);
    let page1 = null, st1 = null;
    await run.step('clipboard (gzip)', 'Welcome > Paste from Overload reads the clipboard', async () => {
      page1 = await F.open(p1, server);
      need((await F.screen(page1)) === 'welcome', 'not at Welcome');
      await setClipboard(page1, gzipText);
      await page1.click('[data-action="fuel-paste"]');
      const t = await F.toast(page1, /Brought in/);
      need((await F.screen(page1)) === 'food', 'the diary did not open after the import');
      return gzipText.length.toLocaleString() + ' characters; "' + t + '"';
    });
    if (page1) st1 = await checkImported('clipboard (gzip)', p1, page1, 'Overload 3.0');

    // ---------------------------------------------------------------- 2. clipboard, plain
    const p2 = await newPhone(browser);
    let page2 = null;
    await run.step('clipboard (plain)', 'Welcome > Paste from Overload reads the clipboard', async () => {
      page2 = await F.open(p2, server);
      await setClipboard(page2, plainText);
      await page2.click('[data-action="fuel-paste"]');
      await F.toast(page2, /Brought in/);
      return plainText.length.toLocaleString() + ' characters';
    });
    if (page2) await checkImported('clipboard (plain)', p2, page2, 'Overload 3.0');
    await p2.close();

    // ---------------------------------------------------------------- 3. the food file
    const p3 = await newPhone(browser);
    let page3 = null;
    const foodFile = tmp.file('overload-food-' + TODAY + '.json', JSON.stringify(F.payloadFrom(PURE, NOW - 60000)));
    await run.step('food file', 'saying no to the question brings nothing in', async () => {
      let first = true;
      page3 = await F.open(p3, server, { dialogs: (d) => { if (first && /Bring this food log/.test(d.message())) { first = false; return d.dismiss(); } return d.accept(); } });
      await F.chooseFile(page3, '[data-action="fuel-file"]', foodFile);
      await page3.waitForFunction(() => true); await lib.sleep(800);
      need(page3.dialogs.length === 1, 'the question was not asked');
      need((await F.screen(page3)) === 'welcome' && Object.keys(await lib.readStorage(page3)).length === 0, 'something happened although he said no');
      return 'still at Welcome, nothing stored';
    });
    await run.step('food file', 'Welcome > Choose a file takes overload-food-YYYY-MM-DD.json', async () => {
      await F.chooseFile(page3, '[data-action="fuel-file"]', foodFile);
      await F.toast(page3, /Brought in/);
      return require('fs').statSync(foodFile).size.toLocaleString() + ' bytes';
    });
    if (page3) await checkImported('food file', p3, page3, 'Overload 3.0', PURE);
    await p3.close();

    // ---------------------------------------------------------------- 4. a full Overload backup
    const p4 = await newPhone(browser);
    let page4 = null;
    const backupFile = tmp.file('overload-backup-' + TODAY + '.json', JSON.stringify(PURE_WITH_SECRET, null, 2));   // as Export JSON writes it
    await run.step('Overload backup file', 'Welcome > Choose a file takes a full backup, the food part only', async () => {
      need(/"connKey": "c0ffee00/.test(require('fs').readFileSync(backupFile, 'utf8')), 'the test file holds no connector key');
      page4 = await F.open(p4, server);
      await F.chooseFile(page4, '[data-action="fuel-file"]', backupFile);
      await F.toast(page4, /Brought in/);
      return require('fs').statSync(backupFile).size.toLocaleString() + ' bytes, with settings.connKey, connUrl and reminders in it';
    });
    if (page4) await checkImported('Overload backup file', p4, page4, 'Overload backup', PURE);
    await p4.close();

    // ---------------------------------------------------------------- 5. Overload's data in the same storage
    const p5 = await newPhone(browser);
    let page5 = null;
    await lib.seedV28(p5.context, { state: OLD, meta: fx.meta });
    const seeded = { 'overload.state.v1': JSON.stringify(OLD), 'overload.theme': 'dark', 'overload.backup': JSON.stringify(fx.meta.backup) };
    await run.step('same storage', 'Welcome offers "Bring it from Overload on this device" first, and it works', async () => {
      page5 = await F.open(p5, server);
      const first = await page5.evaluate(() => { const b = document.querySelector('#app .choice-card'); return [b.dataset.action, b.textContent.replace(/\s+/g, ' ').trim()]; });
      need(first[0] === 'fuel-here' && /Bring it from Overload on this device/.test(first[1]) && first[1].includes(COUNTS.foodDays + ' days, ' + n(COUNTS.foodEntries) + ' entries'), 'the first choice is ' + JSON.stringify(first));
      const before = Object.keys(await lib.readStorage(page5)).sort();
      same(before, Object.keys(seeded).sort(), 'the keys before he chose');
      await page5.click('[data-action="fuel-here"]');
      await F.toast(page5, /Brought in/);
      return first[1];
    });
    if (page5) {
      await checkImported('same storage', p5, page5, 'Overload on this device');
      await run.step('same storage', 'Overload\'s own keys are byte for byte what they were', async () => {
        const all = await lib.readStorage(page5);
        for (const k of Object.keys(seeded)) need(all[k] === seeded[k], k + ' changed');
        same(Object.keys(all).filter((k) => /^overload/.test(k)).sort(), Object.keys(seeded).sort(), 'the overload.* keys');
        need((await page5.evaluate(() => indexedDB.databases().then((l) => l.map((d) => d.name)))).join() === 'fuel-copies', 'another database than fuel-copies exists');
        return Object.keys(all).sort().join(', ');
      });
    }
    await p5.close();

    // ---------------------------------------------------------------- Trends, on the imported data
    if (st1) await run.step('clipboard (gzip)', 'Trends shows the last 14 days and the week averages of the imported log', async () => {
      await lib.openTab(page1, 'trends');
      const tot = (d) => (OLD.diary[d] || []).reduce((t, e) => ({ kcal: t.kcal + e.kcal, p: t.p + e.p }), { kcal: 0, p: 0 });
      const days = (from, to) => Object.keys(OLD.diary).filter((d) => d >= from && d <= to);
      const avg = (list, k) => Math.round(list.reduce((s, d) => s + tot(d)[k], 0) / list.length).toLocaleString('en-US');
      const thisWeek = days('2026-11-16', '2026-11-20'), lastWeek = days('2026-11-09', '2026-11-15');   // Monday to yesterday; the week before
      const rows = await page1.evaluate(() => [...document.querySelectorAll('.trend-table tbody tr')].map((r) => [...r.cells].map((c) => c.textContent.trim())));
      same(rows[0], ['Calories / 2,400', avg(thisWeek, 'kcal'), avg(lastWeek, 'kcal')], 'the calories row');
      same(rows[1], ['Protein / 190 g', avg(thisWeek, 'p'), avg(lastWeek, 'p')], 'the protein row');
      same(rows[4], ['Days logged', (thisWeek.length + 1) + ' of 6', lastWeek.length + ' of 7'], 'the days row');
      const bars = await page1.evaluate(() => [...document.querySelectorAll('.trend-chart .trend-day')].map((g) => g.dataset.d + ' ' + g.querySelector('.bar').getAttribute('class')));
      need(bars.length === 14 && bars[0].startsWith('2026-11-08') && bars[13] === TODAY + ' bar now', 'the bars are ' + bars.join(', '));
      for (const b of bars.slice(0, 13)) { const d = b.slice(0, 10), k = tot(d).kcal; need(b.slice(11) === (!OLD.diary[d] ? 'bar none' : k > 2400 * 1.05 ? 'bar over' : 'bar'), d + ' (' + k + ' kcal) is drawn as "' + b.slice(11) + '"'); }
      await page1.click('.trend-chart .trend-day[data-d="2026-11-20"]');
      const y = await F.readDay(page1), want = fx.facts.foodDays[1];
      need((await F.screen(page1)) === 'food' && y.date === want.date && y.label === 'Yesterday' && y.kcalLine === want.kcalLine, 'tapping Friday opened ' + JSON.stringify(y).slice(0, 120));
      await F.gotoDay(page1, 0);
      return rows[0].join(' | ') + '; ' + rows[4].join(' | ') + '; ' + bars.filter((b) => / over$/.test(b)).length + ' days over target';
    });

    // ---------------------------------------------------------------- again, and after deleting in Fuel
    if (st1) {
      const again = (title, fn) => run.step('a second import', title, fn);
      await again('the same copy again adds nothing', async () => {
        const before = await F.storedText(page1), asked = page1.dialogs.length;
        await lib.openTab(page1, 'settings');
        need(/Brought across on Sat, Nov 21: 110 days, 1,576 entries/.test(await F.text(page1, '#app')), 'Settings does not say when the log was brought across');
        await page1.click('[data-action="fuel-import"]');
        await page1.click('#sheet [data-action="fuel-paste"]');   // the clipboard still holds the copy
        const msg = await importMsg(page1);
        need(/^Nothing new/.test(msg), 'the sheet says "' + msg + '"');
        need(page1.dialogs.length === asked, 'a question was asked although there is nothing to add');
        need((await F.storedText(page1)) === before, 'the saved data changed');
        await submitText(page1, plainText);   // and the plain form, typed into the box
        need(/^Nothing new/.test(await importMsg(page1)) && (await F.storedText(page1)) === before, 'the plain form of the same copy changed something');
        await F.closeSheet(page1);
        return msg;
      });

      const gone = { entry: OLD.diary[TODAY][1], food: 'cv6244zzsrdxu', meal: 'twbis5m0bdnt' };   // Mom's lasagna; Shake + banana
      await again('delete an entry, a saved food and a saved meal in Fuel', async () => {
        await F.gotoDay(page1, 0);
        await page1.click('.f-meal .f-row[data-id="' + gone.entry.id + '"]');
        await page1.click('#sheet [data-action="food-delete"]');
        await F.toast(page1, /Removed/);
        await lib.sleep(500);
        // the saved food: found by search, opened, Edit food, Delete this food
        await page1.click('[data-action="food-add"][data-meal="2"]');
        await page1.fill('[data-field="food-search"]', 'lasagna');
        await page1.click('#food-results [data-action="food-pick"][data-id="' + gone.food + '"]');
        await page1.click('[data-action="food-fix"]');
        await page1.click('[data-action="food-forget"]');
        await F.toast(page1, /Food deleted/);
        // the saved meal: from the Add sheet's list
        await page1.click('[data-action="food-add"][data-meal="2"]');
        await page1.click('#food-results [data-action="food-sm-open"][data-id="' + gone.meal + '"]');
        await page1.click('[data-action="food-sm-delete"]');
        await F.toast(page1, /Meal deleted/);
        await lib.sleep(400);
        await F.closeSheet(page1);
        const st = await F.stored(page1);
        need(!st.diary[TODAY].some((e) => e.id === gone.entry.id) && !st.food.foods[gone.food] && !st.food.meals[gone.meal], 'something is still there');
        need(st.deleted.food[gone.entry.id] > 0 && st.deleted.foods[gone.food] > 0 && st.deleted.meals[gone.meal] > 0, 'a deletion record is missing: ' + JSON.stringify([st.deleted.foods, st.deleted.meals]));
        need(page1.dialogs.filter((d) => /^confirm: Delete/.test(d)).length === 2, 'the two delete questions were not asked');
        return gone.entry.name + '; ' + OLD.food.foods[gone.food].name + '; ' + OLD.food.meals[gone.meal].name;
      });
      await again('the same copy again: none of the three comes back', async () => {
        const before = await F.storedText(page1);
        await submitText(page1, gzipText);
        const msg = await importMsg(page1);
        need(/^Nothing new/.test(msg) && /deleted here/.test(msg), 'the sheet says "' + msg + '"');
        need((await F.storedText(page1)) === before, 'the saved data changed');
        await F.closeSheet(page1);
        return msg;
      });
      await again('a newer copy with one more entry adds that entry only, and says what stays deleted', async () => {
        const later = JSON.parse(JSON.stringify(OLD));   // v2.8 ran once more on the old phone and a food was logged in it
        later.diary[TODAY].push({ id: 'late0apple01', food: null, meal: 3, qty: null, unit: null, amt: '', name: 'Late apple', brand: '', kcal: 95, p: 0.5, c: 25, f: 0.3, at: NOW - 1000 });
        const before = await F.stored(page1);
        await submitText(page1, F.foodText(F.payloadFrom(later, NOW - 500), true));
        await F.toast(page1, /Brought in 1 entry on 1 day/);
        const q = lastQuestion(page1);
        for (const t of ['New here: 1 entry on 1 day.', 'Already in Fuel, left as they are: ' + n(COUNTS.foodEntries - 1) + ' entries, ' + (COUNTS.savedFoods - 1) + ' saved foods, ' + (COUNTS.savedMeals - 1) + ' saved meals.',
          'Deleted in Fuel, not brought back: 1 entry, 1 saved food, 1 saved meal.', 'A copy of what Fuel holds now is kept first.']) need(q.includes(t), 'the question does not say "' + t + '": ' + q.replace(/\n/g, ' | '));
        need(!/not newer/.test(q), 'a newer copy was called not newer');
        const st = await F.stored(page1);
        need(st.diary[TODAY].some((e) => e.id === 'late0apple01') && F.diaryCounts(st.diary, {}).entries === COUNTS.foodEntries, 'the new entry is not there, or the count is off');
        need(!st.diary[TODAY].some((e) => e.id === gone.entry.id) && !st.food.foods[gone.food] && !st.food.meals[gone.meal], 'something deleted came back');
        same(st.deleted, before.deleted, 'the deletion records');
        same(st.food, before.food, 'saved foods, meals and targets');
        const copy = await F.copy(page1, 'before-import');
        need(copy && !/late0apple01/.test(copy.text) && JSON.parse(copy.text).diary[TODAY].length === before.diary[TODAY].length, 'no safety copy of what Fuel held before');
        return q.split('\n').slice(5, 8).join(' | ');
      });
      await again('a copy that is not newer than the last one is said to be so', async () => {
        const older = JSON.parse(JSON.stringify(OLD));
        older.diary[TODAY].push({ id: 'old0cracker1', food: null, meal: 3, qty: null, unit: null, amt: '', name: 'Cracker', brand: '', kcal: 20, p: 0, c: 4, f: 0.5, at: NOW - 5000 });
        await submitText(page1, F.foodText(F.payloadFrom(older, NOW - 3600000), false));
        await F.toast(page1, /Brought in 1 entry/);
        const q = lastQuestion(page1);
        need(/Note: this copy is not newer than the one you brought in on Sat, Nov 21/.test(q), 'no warning: ' + q.replace(/\n/g, ' | '));
        return q.split('\n').find((l) => /^Note/.test(l));
      });
      await again('no error', async () => { F.assertClean(p1); });
    }
    await p1.close();

    // ---------------------------------------------------------------- a Fuel with its own entries and targets
    const p6 = await newPhone(browser, { clipboard: false });
    let page6 = null, own = null;
    const mine = (title, fn) => run.step('Fuel with its own data', title, fn);
    await mine('a food logged, a target and a body weight set in Fuel first', async () => {
      page6 = await F.open(p6, server);
      await page6.click('[data-action="fuel-fresh"]');
      await page6.waitForSelector('.f-meal');
      await F.quickAdd(page6, 1, 'Own lunch', 555, 30, 40, 20);
      await lib.openTab(page6, 'settings');
      await F.typeInto(page6, '[data-field="food-target"][data-k="kcal"]', 1800);
      await page6.click('[data-action="fuel-units"][data-v="kg"]');
      await F.typeInto(page6, '[data-field="fuel-bw"]', 70);
      own = await F.stored(page6);
      need(own.diary[TODAY].length === 1 && own.food.targets.kcal === 1800 && own.bodyweight[0].weight === 70, 'the set-up failed: ' + JSON.stringify(own).slice(0, 300));
      return 'Own lunch 555 kcal, target 1,800 kcal, 70 kg';
    });
    await mine('without clipboard access, Paste from Overload offers a box, and a paste into it works', async () => {
      await page6.click('[data-action="fuel-import"]');
      await page6.click('#sheet [data-action="fuel-paste"]');
      const msg = await importMsg(page6);
      need(/could not read the clipboard/.test(msg), 'the sheet says "' + msg + '"');
      await pasteIntoBox(page6, gzipText);
      await F.toast(page6, /Brought in/);
      need((await F.sheetOpen(page6)) === false, 'the sheet stayed open');
      return msg;
    });
    await mine('Fuel\'s own entry, targets, units, theme and body weight are kept; the rest is added', async () => {
      const st = await F.stored(page6), q = lastQuestion(page6);
      same(st.diary[TODAY], own.diary[TODAY].concat(OLD.diary[TODAY]), 'today');
      const rest = Object.assign({}, st.diary); delete rest[TODAY];
      const oldRest = Object.assign({}, OLD.diary); delete oldRest[TODAY];
      same(rest, oldRest, 'the other days');
      same(st.food.targets, { kcal: 1800, protein: null, carbs: null, fat: null }, 'the targets');
      same(st.settings, { units: 'kg', theme: 'system' }, 'settings');
      same(st.bodyweight, own.bodyweight, 'body weight');
      same(st.food.foods, OLD.food.foods, 'saved foods'); same(st.food.meals, OLD.food.meals, 'saved meals');
      need(!/the daily targets|your body weight/.test(q.split('\n').find((l) => /^New here/.test(l))), 'the question says targets or body weight are taken: ' + q.replace(/\n/g, ' | '));
      need(/A copy of what Fuel holds now is kept first/.test(q), 'the question does not mention the safety copy');
      const copy = await F.copy(page6, 'before-import');
      same(JSON.parse(copy.text), own, 'the copy "Before import"');
      await F.gotoDay(page6, 0);
      const day = await F.readDay(page6);
      need(day.entries === 11 && day.kcalLine === '1,812 / 1,800 kcal', 'Today reads ' + day.kcalLine + ' with ' + day.entries + ' entries');
      return day.kcalLine + ', ' + day.entries + ' entries; ' + F.diaryCounts(st.diary, {}).entries + ' in all';
    });

    // ---------------------------------------------------------------- malformed input
    const bad = (title, fn) => run.step('malformed input', title, fn);
    const unchanged = async (what, fn) => {
      const before = await F.storedText(page6), asked = page6.dialogs.length;
      const msg = await fn();
      need((await F.storedText(page6)) === before, what + ': the saved data changed');
      need(page6.dialogs.length === asked, what + ': a question was asked');
      return msg;
    };
    const CUT = /cut off or damaged/, NOT = /not a food log from Overload or a Fuel backup/;
    for (const [what, text, re] of [
      ['a wrong prefix', 'UNDERLOAD-FOOD:1:' + gzipText.slice(16), NOT],
      ['other text', 'Dinner at 8? Bring the lasagna.', NOT],
      ['a form this version does not know', 'OVERLOAD-FOOD:7:' + gzipText.slice(16), /newer version of Overload/],
      ['gzip text cut off', gzipText.slice(0, 20001), CUT],
      ['gzip text with a piece missing', gzipText.slice(0, 5000) + gzipText.slice(5400), CUT],
      ['plain text cut off', plainText.slice(0, 90001), CUT],
      ['only the prefix', 'OVERLOAD-FOOD:1:', CUT],
      ['the prefix cut off', 'OVERLOAD-FOO', CUT],
      ['characters that are not base64', 'OVERLOAD-FOOD:0:***not base64***', CUT],
      ['JSON cut off', JSON.stringify(PAYLOAD).slice(0, 4000), CUT],
      ['JSON of something else', '{"hello":"world","v":1}', NOT],
      ['a list', 'OVERLOAD-FOOD:0:' + Buffer.from('[1,2,3]').toString('base64'), NOT]
    ]) {
      await bad(what + ' is refused with a message', () => unchanged(what, async () => {
        await submitText(page6, text);
        const msg = await importMsg(page6);
        need(re.test(msg), 'the sheet says "' + msg + '"');
        return msg;
      }));
    }
    await bad('where the browser cannot unpack gzip, the gzip form is refused with the way out; the plain form still works', () => unchanged('no gzip', async () => {
      await page6.evaluate(() => { window.__realDS = window.DecompressionStream; window.DecompressionStream = undefined; });
      try {
        await submitText(page6, gzipText);
        const msg = await importMsg(page6);
        need(/cannot open the compressed copy/.test(msg) && /Save as a file/.test(msg), 'the sheet says "' + msg + '"');
        await submitText(page6, plainText);   // everything in it is here already: read, and nothing new
        need(/^Nothing new/.test(await importMsg(page6)), 'the plain form was not read: "' + await importMsg(page6) + '"');
        return msg;
      } finally { await page6.evaluate(() => { window.DecompressionStream = window.__realDS; }); }
    }));
    for (const [what, name, content, re] of [
      ['an empty file', 'empty.json', '', /nothing to read/],
      ['a file holding null', 'null.json', 'null', NOT],
      ['an Overload backup of another version', 'v2.json', JSON.stringify({ v: 2, exercises: [], diary: OLD.diary, food: OLD.food }), NOT],
      ['a Fuel backup of a newer version', 'fuel-v2.json', JSON.stringify({ v: 2, app: 'fuel', diary: {} }), /newer version of Fuel/],
      ['a food log of a newer form', 'food-v2.json', JSON.stringify(Object.assign({}, PAYLOAD, { v: 2 })), /newer version of Overload/],
      ['a copy that holds no food', 'none.json', JSON.stringify({ kind: 'overload-food', v: 1, madeAt: NOW }), /holds no food/]
    ]) {
      await bad(what + ' is refused with a message', () => unchanged(what, async () => {
        await openBox(page6);
        await F.chooseFile(page6, '#sheet [data-action="fuel-file"]', tmp.file(name, content));
        await page6.waitForFunction((src) => { const m = document.querySelector('#fuel-import-msg'); return !!m && new RegExp(src).test(m.textContent); }, re.source, { timeout: 8000 });
        return F.text(page6, '#fuel-import-msg');
      }));
    }
    await bad('a Fuel backup with text where numbers belong is cleaned, and says so', async () => {
      const file = tmp.file('fuel-odd.json', JSON.stringify({ v: 1, app: 'fuel', exercises: [], settings: { units: 'kg', theme: 'light', connKey: SECRET },
        food: { targets: { kcal: 'lots' }, foods: { x1: 'not a food', cgood1: { id: 'other', src: 'custom', name: 7, n: { kcal: '250', p: 'x' }, serving: 'bowl', servings: 'none' } }, meals: { m9: { name: '', items: 'none' } } },
        diary: { '2026-11-19': [{ id: 'bad0kcal0001', name: 'Mystery stew', kcal: 'abc', p: '12', c: null, f: { g: 3 }, meal: '1', at: 'noon' }, 'not an entry', { name: 'No id, no meal', kcal: 40, p: 1, c: 2, f: 3 }] },
        deleted: { food: 'none', foods: { zz: 'yesterday' } }, bodyweight: 'heavy', moved: 'yes' }));
      await openBox(page6);
      await F.chooseFile(page6, '#sheet [data-action="fuel-file"]', file);
      await F.toast(page6, /Brought in 2 entries on 1 day, 1 saved food, 1 saved meal/);
      const q = lastQuestion(page6), st = await F.stored(page6);
      for (const t of ['1 entry left out: not readable.', '1 entry had numbers that could not be read: those count as 0.', '1 entry named no meal: it is under Snacks.']) need(q.includes(t), 'the question does not say "' + t + '": ' + q.replace(/\n/g, ' | '));
      const day = st.diary['2026-11-19'], e = day.find((x) => x.id === 'bad0kcal0001'), other = day.find((x) => x.name === 'No id, no meal');
      need(e && e.kcal === 0 && e.p === 12 && e.c === 0 && e.f === 0 && e.meal === 1 && typeof e.at === 'number', 'the entry was stored as ' + JSON.stringify(e));
      need(other && typeof other.id === 'string' && other.id.length > 4 && other.meal === 3 && typeof other.at === 'number', 'the entry without an id was stored as ' + JSON.stringify(other));
      need(day.length === OLD.diary['2026-11-19'].length + 2, 'the day has ' + day.length + ' entries');
      const f = st.food.foods.cgood1;
      need(f && f.id === 'cgood1' && f.name === '7' && f.n.kcal === 250 && f.n.p === 0 && f.serving === null && Array.isArray(f.servings) && !st.food.foods.x1, 'the food was stored as ' + JSON.stringify(f));
      need(st.food.meals.m9 && st.food.meals.m9.name === 'Meal' && Array.isArray(st.food.meals.m9.items), 'the meal was stored as ' + JSON.stringify(st.food.meals.m9));
      same([st.settings, st.food.targets.kcal, st.bodyweight], [{ units: 'kg', theme: 'system' }, 1800, own.bodyweight], 'what Fuel keeps of its own');
      need(!/"exercises"|connKey|c0ffee00/.test(await F.storedText(page6)), 'exercises or the connector key reached Fuel\'s data');
      await F.gotoDay(page6, 2);
      const shown = await F.readDay(page6);
      need(shown.date === '2026-11-19' && /^[\d,]+$/.test(shown.kcal) && !/NaN|undefined|abc/.test(JSON.stringify(shown)), 'the day shows ' + JSON.stringify(shown).slice(0, 200));
      await F.gotoDay(page6, 0);
      return q.split('\n').find((l) => /left out|could not be read/.test(l));
    });
    await bad('days whose name is not a date are left out, and it says so', async () => {
      const ok = { id: 'good0entry01', food: null, meal: 0, qty: null, unit: null, amt: '', name: 'Toast', brand: '', kcal: 120, p: 4, c: 20, f: 2, at: NOW - 86400000 * 5 };
      const file = tmp.file('fuel-days.json', JSON.stringify({ v: 1, app: 'fuel', diary: { 'not-a-date': [Object.assign({}, ok, { id: 'x1' })], '2026/11/16': [Object.assign({}, ok, { id: 'x2' })], '2026-11-16': [ok], '2026-11-15': 'nothing', __proto__x: [] } }));
      const before = await F.stored(page6);
      await openBox(page6);
      await F.chooseFile(page6, '#sheet [data-action="fuel-file"]', file);
      await F.toast(page6, /Brought in 1 entry on 1 day/);
      const q = lastQuestion(page6), st = await F.stored(page6);
      need(/4 days left out: their names are not dates\./.test(q), 'the question does not say so: ' + q.replace(/\n/g, ' | '));
      same(Object.keys(st.diary).sort(), Object.keys(before.diary).sort(), 'the days in the diary');
      need(st.diary['2026-11-16'].some((e) => e.id === 'good0entry01') && !JSON.stringify(st.diary).includes('"x1"'), 'the good entry is missing or a bad one came in');
      return q.split('\n').find((l) => /left out/.test(l));
    });
    await bad('after all of it the app runs, and nothing was thrown', async () => {
      await F.reload(page6);
      need((await F.screen(page6)) === 'food' && (await F.readDay(page6)).entries === 11, 'the diary did not come back after a reload');
      await lib.openTab(page6, 'trends'); await lib.openTab(page6, 'settings'); await lib.openTab(page6, 'food');
      F.assertClean(p6);
      return page6.dialogs.length + ' questions asked in all';
    });
    await p6.close();

    // ---------------------------------------------------------------- Start fresh, then the food log (H1)
    // He starts fresh in Fuel and logs from the food list two foods he also has in Overload: the oats (a
    // favourite there) and the protein bar (a favourite there, its label numbers corrected there: src custom,
    // 316.7 kcal per 100 g where the list says 300). A week later he brings the log across.
    const BAR = 'u1903553', OATS = 'u173904', OL_FOODS = PURE.food.foods;
    const pureText = F.foodText(F.payloadFrom(PURE, NOW - 60000), true);
    const fresh = (title, fn) => run.step('Start fresh, then the food log', title, fn);
    const p7 = await newPhone(browser, { clipboard: false });
    let page7 = null, listed = null, merged = null;
    await fresh('Start fresh; the oats and the protein bar logged from the food list', async () => {
      page7 = await F.open(p7, server);
      await page7.click('[data-action="fuel-fresh"]');
      await page7.waitForSelector('.f-meal');
      await logListed(page7, 0, 'oats rolled', OATS);
      const shown = await logListed(page7, 3, 'quest bar cookies', BAR);
      listed = await F.stored(page7);
      const o = listed.food.foods[OATS], b = listed.food.foods[BAR];
      need(o && o.src === 'usda' && !o.fav && b && b.src === 'usda' && !b.fav && b.n.kcal === 300 && b.used > 0 && b.last && listed.diary[TODAY].length === 2, 'Fuel holds ' + JSON.stringify([o, b]).slice(0, 300));
      return 'the bar from the list: src ' + b.src + ', ' + b.n.kcal + ' kcal per 100 g, barcode ' + b.barcode + ' (' + shown.slice(0, 12) + ')';
    });
    await fresh('the question says what is new and that the two saved foods are updated from Overload', async () => {
      await submitText(page7, pureText);
      const t = await F.toast(page7, /Brought in/);
      const foods = (COUNTS.savedFoods - 2) + ' saved foods, ' + COUNTS.savedMeals + ' saved meals';
      need(t === 'Brought in ' + n(COUNTS.foodEntries) + ' entries on ' + COUNTS.foodDays + ' days, ' + foods + '. Updated 2 saved foods.', 'the toast says "' + t + '"');
      const q = lastQuestion(page7);
      for (const s of ['New here: ' + n(COUNTS.foodEntries) + ' entries on ' + COUNTS.foodDays + ' days, ' + foods + ', the daily targets, your body weight.',
        '2 saved foods updated from Overload: the favorite star, your corrected numbers.', 'Nothing else in Fuel is replaced or removed. A copy of what Fuel holds now is kept first.']) need(q.includes(s), 'the question does not say "' + s + '": ' + q.replace(/\n/g, ' | '));
      need(!/Already in Fuel|Nothing in Fuel/.test(q), 'the question says something else: ' + q.replace(/\n/g, ' | '));
      return q.split('\n').filter((l) => /updated from|Nothing else/.test(l)).join(' | ');
    });
    await fresh('the bar is his corrected copy and every favourite is one; Fuel\'s last use and amount stay', async () => {
      merged = await F.stored(page7);
      const lf = listed.food.foods;
      same(merged.food.foods[BAR], Object.assign({}, OL_FOODS[BAR], { used: lf[BAR].used, last: lf[BAR].last, fav: true }), 'the bar');
      same(merged.food.foods[OATS], Object.assign({}, lf[OATS], { fav: true }), 'the oats');
      const rest = Object.assign({}, merged.food.foods), restOl = Object.assign({}, OL_FOODS);
      [BAR, OATS].forEach((id) => { delete rest[id]; delete restOl[id]; });
      same(rest, restOl, 'the other saved foods');
      same(merged.food.meals, PURE.food.meals, 'the saved meals');
      same(merged.diary[TODAY], listed.diary[TODAY].concat(PURE.diary[TODAY]), 'today');
      const days = Object.assign({}, merged.diary), oldDays = Object.assign({}, PURE.diary); delete days[TODAY]; delete oldDays[TODAY];
      same(days, oldDays, 'the other days');
      await F.gotoDay(page7, 0);
      const sheet = await F.openAddSheet(page7, 3);
      same(sheet.favourites, fx.facts.addSheet.favourites, 'the favourites in the Add sheet');
      await F.closeSheet(page7);
      return 'bar: src ' + merged.food.foods[BAR].src + ', ' + merged.food.foods[BAR].n.kcal.toFixed(1) + ' kcal per 100 g, barcode ' + merged.food.foods[BAR].barcode + '; ' + sheet.favourites.length + ' favourites';
    });
    await fresh('his numbers stay once the food list is loaded, and a bar now counts 190 kcal, not 180', async () => {
      await F.closeSheet(page7);
      await F.gotoDay(page7, 0);
      await page7.click('[data-action="food-add"][data-meal="3"]');
      await page7.waitForSelector('#sheet:not([hidden]) #food-results');
      await page7.fill('[data-field="food-search"]', 'quest bar cookies');
      await page7.evaluate(() => window.__overloadFood._.loadDb().then(() => true));   // the search loads the food list, which brings its own copies up to date
      await lib.sleep(300);
      await page7.click('#food-results [data-action="food-pick"][data-id="' + BAR + '"]');
      await page7.waitForSelector('#food-preview .stat');
      const kcal = await F.text(page7, '#food-preview .stat .v');
      await F.closeSheet(page7);
      same((await F.stored(page7)).food.foods[BAR], merged.food.foods[BAR], 'the bar after the food list loaded');
      need(kcal === '190', 'one bar shows ' + kcal + ' kcal');
      return '1 bar: ' + kcal + ' kcal';
    });
    await fresh('the same copy again adds nothing', async () => {
      const before = await F.storedText(page7), asked = page7.dialogs.length;
      await submitText(page7, pureText);
      const msg = await importMsg(page7);
      need(/^Nothing new/.test(msg), 'the sheet says "' + msg + '"');
      need(page7.dialogs.length === asked && (await F.storedText(page7)) === before, 'a question was asked or the saved data changed');
      await F.closeSheet(page7);
      return msg;
    });
    await fresh('a backup of it comes back exactly, into a new Fuel and into this one', async () => {
      const mine = await F.stored(page7);
      await lib.openTab(page7, 'settings');
      const [dl] = await Promise.all([page7.waitForEvent('download'), page7.click('[data-action="export"]')]);
      const file = require('path').join(tmp.dir, dl.suggestedFilename());
      await dl.saveAs(file);
      const p7b = await newPhone(browser, { clipboard: false });
      try {
        const other = await F.open(p7b, server);
        await F.chooseFile(other, '[data-action="fuel-file"]', file);
        await F.toast(other, /Brought in/);
        same(await F.stored(other), mine, 'a new Fuel against the one exported');
        F.assertClean(p7b, 'the new Fuel');
      } finally { await p7b.close(); }
      await openBox(page7);
      await F.chooseFile(page7, '#sheet [data-action="fuel-file"]', file);
      const msg = await importMsg(page7);
      need(/^Nothing new/.test(msg) && (await F.storedText(page7)) === JSON.stringify(mine), 'into the same Fuel: "' + msg + '", or the saved data changed');
      await F.closeSheet(page7);
      F.assertClean(p7);
      return dl.suggestedFilename() + '; ' + msg;
    });
    await p7.close();

    // ---------------------------------------------------------------- saved foods made, corrected or deleted in Fuel (H1)
    const T0 = NOW - 3 * 864e5, COOKIE = 'b0850031234567', WHEY = 'u173180', EGG = 'u172187';
    const OWN = F.fuelStateFrom(PURE, { food: { targets: { kcal: null, protein: null, carbs: null, fat: null }, meals: {}, foods: {
      // corrected in Fuel too (other numbers than in Overload, no star): stays as it is, and gets Overload's star
      [BAR]: Object.assign(unstarred(OL_FOODS[BAR]), { n: { kcal: 320, p: 33, c: 37, f: 13 }, used: T0, last: { qty: 2, unit: 'srv' } }),
      // corrected in Fuel, a plain list copy in Overload (starred there): stays as it is, and gets the star
      [WHEY]: { id: WHEY, src: 'custom', name: 'Whey, my scoop', brand: '', n: { kcal: 400, p: 80, c: 8, f: 5 }, serving: { label: '1 scoop', g: 30, n: null }, servings: [], used: T0 },
      // scanned in Fuel (Open Food Facts), typed in from the label in Overload: Overload's numbers are taken
      [COOKIE]: { id: COOKIE, src: 'off', name: 'Protein Cookie Double Chocolate', brand: 'Bakehouse', barcode: '0850031234567', n: { kcal: 350, p: 20, c: 45, f: 12 }, serving: { label: '1 cookie (70 g)', g: 70, n: null }, servings: [], used: T0, last: { qty: 2, unit: 'srv' } },
      // list copies on both sides: Fuel's stay, star or no star, numbers or not
      [OATS]: Object.assign({}, OL_FOODS[OATS], { n: { kcal: 375, p: 13, c: 68, f: 6.5 }, used: T0 }),
      [EGG]: Object.assign({}, OL_FOODS[EGG], { used: T0, last: { qty: 2, unit: 's0' } })
    } }, diary: { [TODAY]: [{ id: 'own0entry001', food: null, meal: 1, qty: null, unit: null, amt: '', name: 'Own lunch', brand: '', kcal: 555, p: 30, c: 40, f: 20, at: NOW - 7200000 }] },
    deleted: { food: {}, foods: { cv6244zzsrdxu: T0, cvvpk4s5y0vtb: T0 }, meals: {} }, bodyweight: [], moved: null });
    const ownFoods = (title, fn) => run.step('Fuel\'s own saved foods', title, fn);
    const p10 = await newPhone(browser, { clipboard: false });
    await lib.seedStorage(p10.context, { 'fuel.state.v1': JSON.stringify(OWN), 'fuel.theme': 'dark' });
    let page10 = null;
    await ownFoods('foods made or corrected in Fuel keep their numbers; a list copy takes his corrected one; deleted ones stay deleted', async () => {
      page10 = await F.open(p10, server);
      need((await F.screen(page10)) === 'food', 'Fuel did not start on its saved data');
      await submitText(page10, pureText);
      const t = await F.toast(page10, /Brought in/);
      const q = lastQuestion(page10), st = await F.stored(page10), mine = OWN.food.foods;
      for (const s of ['New here: ' + n(COUNTS.foodEntries) + ' entries on ' + COUNTS.foodDays + ' days, ' + (COUNTS.savedFoods - 7) + ' saved foods, ' + COUNTS.savedMeals + ' saved meals, the daily targets, your body weight.',
        '3 saved foods updated from Overload: the favorite star, your corrected numbers.', 'Already in Fuel, left as they are: 2 saved foods.', 'Deleted in Fuel, not brought back: 2 saved foods.',
        'Nothing else in Fuel is replaced or removed.']) need(q.includes(s), 'the question does not say "' + s + '": ' + q.replace(/\n/g, ' | '));
      need(/Updated 3 saved foods\.$/.test(t), 'the toast says "' + t + '"');
      same(st.food.foods[BAR], Object.assign({}, mine[BAR], { fav: true }), 'the bar he corrected in Fuel');
      same(st.food.foods[WHEY], Object.assign({}, mine[WHEY], { fav: true }), 'the whey he corrected in Fuel');
      same(st.food.foods[COOKIE], Object.assign({}, OL_FOODS[COOKIE], { used: T0, last: mine[COOKIE].last }), 'the scanned cookie');
      same(st.food.foods[OATS], mine[OATS], 'the oats'); same(st.food.foods[EGG], mine[EGG], 'the egg');
      need(!st.food.foods.cv6244zzsrdxu && !st.food.foods.cvvpk4s5y0vtb, 'a food deleted in Fuel came back');
      same(st.deleted.foods, OWN.deleted.foods, 'the deletion records of saved foods');
      same(st.diary[TODAY], OWN.diary[TODAY].concat(PURE.diary[TODAY]), 'today');
      const copy = await F.copy(page10, 'before-import');
      same(JSON.parse(copy.text), OWN, 'the copy "Before import"');
      return q.split('\n').filter((l) => /updated from|left as|not brought/.test(l)).join(' | ');
    });
    await ownFoods('the same copy again adds nothing', async () => {
      const before = await F.storedText(page10);
      await submitText(page10, pureText);
      const msg = await importMsg(page10);
      need(/^Nothing new/.test(msg) && (await F.storedText(page10)) === before, 'the sheet says "' + msg + '", or the saved data changed');
      await F.closeSheet(page10);
      return msg;
    });
    await ownFoods('a copy whose only news is a star: the question and the message say just that', async () => {
      const starred = JSON.parse(fx.text); starred.food.foods[EGG].fav = true;   // starred in Overload since
      const before = await F.stored(page10);
      await page10.evaluate(() => { document.querySelector('#toast').hidden = true; });
      await submitText(page10, F.foodText(F.payloadFrom(starred, NOW - 400), true));
      const t = await F.toast(page10, /Updated/);
      const q = lastQuestion(page10), st = await F.stored(page10);
      need(t === 'Updated 1 saved food.', 'the toast says "' + t + '"');
      need(q.includes('1 saved food updated from Overload: the favorite star.') && q.includes('Nothing in Fuel is replaced or removed.') && !/New here|corrected numbers|Nothing else/.test(q), 'the question says: ' + q.replace(/\n/g, ' | '));
      before.food.foods[EGG].fav = true;
      same(st.food, before.food, 'the saved foods, meals and targets'); same(st.diary, before.diary, 'the diary'); same(st.deleted, before.deleted, 'the deletion records');
      F.assertClean(p10);
      return q.split('\n').filter((l) => /updated from/.test(l)).join(' | ');
    });
    await p10.close();

    // ---------------------------------------------------------------- one entry id on two days (H4)
    // Versions 1.6 to 2.4 kept an entry edited across midnight on both days under one id; v2.8 shows both.
    const DAY_A = '2026-11-17', DAY_B = '2026-11-18';
    const DUP = JSON.parse(fx.text), twin = DUP.diary[DAY_A][DUP.diary[DAY_A].length - 1];
    DUP.diary[DAY_B].push(Object.assign({}, twin, { qty: (twin.qty || 1) * 2, kcal: twin.kcal * 2, p: twin.p * 2, c: twin.c * 2, f: twin.f * 2 }));
    const dupFile = tmp.file('overload-food-dup.json', JSON.stringify(F.payloadFrom(DUP, NOW - 60000)));
    const two = (title, fn) => run.step('one id on two days', title, fn);
    const p8 = await newPhone(browser, { clipboard: false });
    let page8 = null;
    await two('Welcome > Choose a file: the entry arrives on both days', async () => {
      page8 = await F.open(p8, server);
      await F.chooseFile(page8, '[data-action="fuel-file"]', dupFile);
      await F.toast(page8, /Brought in/);
      const q = lastQuestion(page8), st = await F.stored(page8);
      need(q.includes('New here: ' + n(COUNTS.foodEntries + 1) + ' entries on ' + COUNTS.foodDays + ' days,') && !/Already in Fuel/.test(q), 'the question says: ' + q.replace(/\n/g, ' | '));
      same(st.diary, DUP.diary, 'the diary');
      for (const d of [DAY_A, DAY_B]) {
        await F.gotoDay(page8, dayAgo(d));
        const got = await F.readDay(page8);
        need(got.date === d && got.entries === DUP.diary[d].length && got.kcal === kcalOf(DUP.diary[d]).toLocaleString('en-US'), d + ' shows ' + got.kcal + ' kcal, ' + got.entries + ' entries; Overload has ' + kcalOf(DUP.diary[d]) + ', ' + DUP.diary[d].length);
      }
      await F.gotoDay(page8, 0);
      return twin.name + ' (' + twin.id + ') on ' + DAY_A + ' (' + twin.kcal + ' kcal) and ' + DAY_B + ' (' + twin.kcal * 2 + ' kcal)';
    });
    await two('the same file again adds nothing', async () => {
      const before = await F.storedText(page8);
      await openBox(page8);
      await F.chooseFile(page8, '#sheet [data-action="fuel-file"]', dupFile);
      const msg = await importMsg(page8);
      need(/^Nothing new/.test(msg) && (await F.storedText(page8)) === before, 'the sheet says "' + msg + '", or the saved data changed');
      await F.closeSheet(page8);
      return msg;
    });
    await two('removed from one day in Fuel: the other day keeps it, and the file does not bring it back', async () => {
      await F.gotoDay(page8, dayAgo(DAY_B));
      need((await F.count(page8, '.f-meal .f-row[data-id="' + twin.id + '"]')) === 1, 'the entry is not on ' + DAY_B);
      await page8.click('.f-meal .f-row[data-id="' + twin.id + '"]');
      await page8.click('#sheet [data-action="food-delete"]');
      await F.toast(page8, /Removed/);
      await lib.sleep(500);
      const before = await F.storedText(page8);
      await openBox(page8);
      await F.chooseFile(page8, '#sheet [data-action="fuel-file"]', dupFile);
      const msg = await importMsg(page8);
      need(/^Nothing new/.test(msg) && /deleted here/.test(msg) && (await F.storedText(page8)) === before, 'the sheet says "' + msg + '", or the saved data changed');
      await F.closeSheet(page8);
      const st = await F.stored(page8);
      need(st.deleted.food[twin.id] > 0 && st.diary[DAY_A].some((e) => e.id === twin.id) && !st.diary[DAY_B].some((e) => e.id === twin.id), 'the entry is ' + JSON.stringify([DAY_A, st.diary[DAY_A].some((e) => e.id === twin.id), DAY_B, st.diary[DAY_B].some((e) => e.id === twin.id)]));
      F.assertClean(p8);
      return msg;
    });
    await p8.close();

    // ---------------------------------------------------------------- entries without an id (H5)
    // v2.8 always writes an id; a hand-edited or damaged save may not. Two such entries on one day, without a
    // time either (Fuel fills it in from the entry before), and two identical ones on the next day.
    const D1 = '2026-11-15', D2 = '2026-11-16';
    const NOID = JSON.parse(fx.text);
    NOID.diary[D1] = NOID.diary[D1].slice(0, 3);
    [1, 2].forEach((i) => { delete NOID.diary[D1][i].id; delete NOID.diary[D1][i].at; });
    const cake = { food: null, meal: 3, qty: null, unit: null, amt: '', name: 'Rice cake', brand: '', kcal: 35, p: 0.7, c: 7.3, f: 0.3, at: Date.parse(D2 + 'T20:00:00Z') };
    NOID.diary[D2].push(Object.assign({}, cake), Object.assign({}, cake));
    // Later in Overload: the first entry of each of the two days deleted (as v2.8's Remove does), one food logged today.
    const NOID2 = JSON.parse(JSON.stringify(NOID));
    [D1, D2].forEach((d) => { NOID2.deleted.food[NOID2.diary[d].shift().id] = NOW - 5000; });
    NOID2.diary[TODAY].push({ id: 'late0apple02', food: null, meal: 3, qty: null, unit: null, amt: '', name: 'Late apple', brand: '', kcal: 95, p: 0.5, c: 25, f: 0.3, at: NOW - 1000 });
    const noid = (title, fn) => run.step('entries without an id', title, fn);
    const p9 = await newPhone(browser, { clipboard: false });
    let page9 = null, ids = null;
    const idsOf = (st) => [D1, D2].map((d) => st.diary[d].map((e) => e.id));
    await noid('they arrive with an id each, twins too, and the same copy again adds nothing', async () => {
      page9 = await F.open(p9, server);
      await F.chooseFile(page9, '[data-action="fuel-file"]', tmp.file('overload-food-noid.json', JSON.stringify(F.payloadFrom(NOID, NOW - 60000))));
      await F.toast(page9, /Brought in/);
      const st = await F.stored(page9);
      ids = idsOf(st);
      need(st.diary[D1].length === 3 && st.diary[D2].length === NOID.diary[D2].length, D1 + ' has ' + st.diary[D1].length + ' entries, ' + D2 + ' ' + st.diary[D2].length);
      const made = [st.diary[D1][1].id, st.diary[D1][2].id].concat(ids[1].slice(-2));
      need(made.every((id) => /^n[0-9a-z]{6,}$/.test(id)) && new Set(made).size === 4 && typeof st.diary[D1][2].at === 'number', 'the made-up ids are ' + JSON.stringify(made) + ', time ' + st.diary[D1][2].at);
      const before = await F.storedText(page9);
      await submitText(page9, F.foodText(F.payloadFrom(NOID, NOW - 60000), false));
      const msg = await importMsg(page9);
      need(/^Nothing new/.test(msg) && (await F.storedText(page9)) === before, 'the same copy again: "' + msg + '"');
      await F.closeSheet(page9);
      return made.join(', ');
    });
    await noid('a later copy, after the entries before them were deleted in Overload, adds only the new entry', async () => {
      await page9.evaluate(() => { document.querySelector('#toast').hidden = true; });   // the first import's message may still show
      await submitText(page9, F.foodText(F.payloadFrom(NOID2, NOW - 500), true));
      const t = await F.toast(page9, /Brought in/);
      const q = lastQuestion(page9), st = await F.stored(page9);
      need(t === 'Brought in 1 entry on 1 day.' && q.includes('New here: 1 entry on 1 day.'), 'the toast says "' + t + '"; the question: ' + q.replace(/\n/g, ' | '));
      same(idsOf(st), ids, 'the ids of the two days');
      need(st.diary[TODAY].some((e) => e.id === 'late0apple02'), 'the new entry is not there');
      for (const d of [D1, D2]) {
        await F.gotoDay(page9, dayAgo(d));
        const got = await F.readDay(page9);
        need(got.entries === NOID.diary[d].length && got.kcal === kcalOf(NOID.diary[d]).toLocaleString('en-US'), d + ' shows ' + got.kcal + ' kcal, ' + got.entries + ' entries; expected ' + kcalOf(NOID.diary[d]) + ', ' + NOID.diary[d].length);
      }
      await F.gotoDay(page9, 0);
      F.assertClean(p9);
      return D1 + ': ' + st.diary[D1].length + ' entries, ' + D2 + ': ' + st.diary[D2].length;
    });
    await p9.close();
  } catch (e) {
    run.say(false, 'fuel-import', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' '));
  } finally {
    tmp.rm();
    await browser.close();
    await server.stop();
  }
  run.done();
})();
