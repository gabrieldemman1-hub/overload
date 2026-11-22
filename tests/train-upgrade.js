#!/usr/bin/env node
/* Overload 3.0 (the training app without Food) started on data saved by v2.8.
 *
 *   node tests/train-upgrade.js [--port=8402] [--only=v28-state]
 *
 * For each of the three v2.8 fixtures, with the clock at the fixture's own "now":
 *   - the app starts, has no Food tab and no food.js, and the connector (WHOOP, reminders) is still plugged in;
 *   - the stored text after the start is byte for byte the fixture; food and diary are, and deleted.food is
 *     what the 90-day rule leaves;
 *   - the copy "Before the split into two apps" is in IndexedDB and holds exactly the fixture text; the note
 *     about it is in overload.backup, not in the saved data;
 *   - every tab and the main sheets draw without a page error or console error;
 *   - what the training screens show is what v2.8 showed (tests/fixtures/v28-facts.json: Today, the workout in
 *     progress, Exercises, History, the progress chart);
 *   - the workout in progress resumes on the same workout with the same sets ticked;
 *   - a second start does not take the split copy again, and a copy that is there is never written over.
 * And a new install (nothing stored): no split copy is taken, on the first start or the second.
 * And a first start during which the phone's copy store does not answer: the next start keeps the copy.
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const lib = require('./lib');
const T = require('./train-common');

const args = T.args();
const PORT = Number(args.port) || 8402;
const FIXTURES = ['v28-state', 'v28-state-active', 'v28-state-small'].filter((n) => !args.only || args.only === n);
const run = T.runner('train-upgrade');
const { need, same } = run;

const reload = async (page) => { await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => !!window.__overload, null, { timeout: 15000 }); };
const ticks = (st) => { const w = st.workouts.find((x) => x.id === st.active); return w ? JSON.stringify(w.entries.map((e) => e.sets.map((s) => !!s.done))) : null; };

async function fixture(browser, server, name) {
  const fx = lib.loadFixture(name), st = fx.state, facts = fx.facts, finished = st.workouts.filter((w) => w.finishedAt);
  const phone = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
  await lib.seedV28(phone.context, fx);
  const step = (title, fn) => run.step(name, title, fn);
  let page = null, split = null, firstCopy = null;

  const started = await step('starts', async () => {
    page = await lib.openApp(phone.context, server.url + '/index.html');
    need(await page.evaluate(() => window.__overload.state.v === 1 && !window.__overload.unreadable), 'the app did not read the data');
    return (await T.text(page, '.brand')) + ', ' + Math.round(fx.text.length / 1024) + ' KB';
  });
  if (!started) { await phone.close(); return; }

  await step('no Food tab, no food.js, connector plugged in', async () => {
    same(await lib.tabNames(page), T.TABS, 'the tab bar');
    const got = await page.evaluate(() => ({ food: typeof window.__overloadFood, conn: typeof window.__overloadConn, scripts: [...document.scripts].map((s) => s.getAttribute('src') || '').filter(Boolean) }));
    need(got.food === 'undefined', 'window.__overloadFood exists');
    need(got.conn === 'object', 'window.__overloadConn is missing');
    need(!got.scripts.some((s) => /food\.js/.test(s)), 'the page still loads food.js');
    need(got.scripts.every((s) => /[?&]v=3\.0$/.test(s)), 'a script is not at ?v=3.0: ' + got.scripts.join(', '));
    return got.scripts.length + ' scripts, all ?v=3.0';
  });

  await step('the stored text after the start is the fixture, byte for byte', async () => {
    need((await lib.readStorageText(page, lib.STATE_KEY)) === fx.text, 'the stored text differs from the fixture after start');
  });
  await step('food and diary byte for byte; deleted.food as the 90-day rule leaves it', async () => {
    const raw = await lib.readStorageText(page, lib.STATE_KEY), now = JSON.parse(raw), want = T.foodTexts(st), got = T.foodTexts(now);
    // v2.8 writes food and diary last: the stored text must end with the very same characters.
    const tail = '"food":' + want.food + ',"diary":' + want.diary + '}';
    need(fx.text.endsWith(tail), 'the fixture does not end with its food and diary (the test needs another way to compare bytes)');
    need(raw.endsWith(tail), 'the stored text does not end with the fixture\'s food and diary');
    need(got.food === want.food && got.diary === want.diary, 'food or diary differ');
    same(now.deleted.food, T.prunedDeletions(st.deleted.food, fx.meta.now), 'deleted.food');
    return Object.keys(now.diary).length + ' days, ' + Object.keys(now.food.foods).length + ' saved foods, ' + Object.keys(now.deleted.food).length + ' deletion records';
  });

  await step('the copy "Before the split into two apps" holds exactly the fixture text', async () => {
    firstCopy = await T.copy(page, 'before-split');
    need(firstCopy, 'there is no copy before-split in IndexedDB');
    need(firstCopy.kind === 'split', 'its kind is ' + firstCopy.kind);
    need(firstCopy.text === fx.text, 'its text is not the fixture text (' + firstCopy.text.length + ' against ' + fx.text.length + ' characters)');
    need(firstCopy.workouts === finished.length && firstCopy.foodDays === Object.keys(st.diary).length, 'its summary reads ' + firstCopy.workouts + ' workouts, ' + firstCopy.foodDays + ' food days');
    return firstCopy.chars + ' characters';
  });
  await step('the note about the split is beside the data, not in it', async () => {
    await page.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('overload.backup')).split.at; } catch (e) { return false; } }, null, { timeout: 5000, polling: 100 });   // written once the copy is stored
    const b = await T.stored(page, 'overload.backup');
    split = b && b.split;
    need(split && typeof split.at === 'number' && split.at >= fx.meta.now && split.at <= firstCopy.at, 'overload.backup.split.at is ' + JSON.stringify(b) + ' (the copy is from ' + firstCopy.at + ')');
    same(Object.keys(split), ['at'], 'the note right after the first start');
    Object.keys(fx.meta.backup || {}).forEach((k) => need(b[k] === fx.meta.backup[k], 'overload.backup.' + k + ' changed'));
    same(Object.keys(await T.stored(page, lib.STATE_KEY)), facts.counts.topLevelKeys, 'the top-level fields of the saved data');
  });

  await step('Today shows what v2.8 showed', async () => {
    const today = await T.readToday(page);
    Object.keys(facts.today).forEach((k) => same(today[k], facts.today[k], 'Today: ' + k));
    return today.title + ' · ' + today.sub;
  });
  if (st.active) {
    await step('the workout in progress resumes: same workout, same sets ticked', async () => {
      const now = await page.evaluate(() => window.__overload.state);
      need(now.active === st.active, 'state.active is ' + now.active + ', expected ' + st.active);
      need(ticks(now) === ticks(st), 'the ticked sets differ from the fixture');
      same(await T.readActive(page), facts.active, 'the workout screen');
      need(await T.count(page, '[data-action="finish-workout"]'), 'Today does not show the workout');
      need(!(await T.count(page, '#handover .card')), 'the hand-over card is in the way of a workout in progress');
      return facts.active.title + ', ' + facts.active.setsTicked + ' of ' + facts.active.sets + ' sets ticked';
    });
  } else {
    await step('Today has the card "Food has moved to Fuel" with what the old food copy holds', async () => {
      const card = await T.text(page, '#handover .card');
      need(card && /^Food has moved to Fuel/.test(card), 'no hand-over card on Today');
      const c = facts.counts, days = c.foodDays + (c.foodDays === 1 ? ' day' : ' days'), entries = c.foodEntries.toLocaleString('en-US') + ' entries', foods = c.savedFoods + ' saved foods';
      [days, entries, foods].forEach((t) => need(card.includes(t), 'the card does not say "' + t + '": ' + card.slice(0, 200)));
      need(await T.count(page, '#handover [data-action="handover-copy"]') === 1 && await T.count(page, '#handover [data-action="handover-file"]') === 1, 'no Copy or Save button');
      return days + ', ' + entries + ', ' + foods;
    });
  }

  for (const tab of T.TABS) {
    await step('tab ' + tab, async () => {
      await lib.openTab(page, tab);
      const body = await T.text(page, '#app');
      need(body && body.length > 40, 'the screen is empty');
      need(!/This screen could not be shown/.test(body), 'the app says: this screen could not be shown');
      return (await T.text(page, '#app h1')) || '';
    });
  }

  await step('Exercises show what v2.8 showed', async () => {
    const got = await T.readExercises(page, facts.exercises.map((e) => e.name));
    same(got, facts.exercises.map((e) => ({ name: e.name, line: e.line })), 'the next-time lines');
    return got.map((e) => e.name + ': ' + e.line).join(' | ');
  });
  await step('History shows what v2.8 showed', async () => {
    const got = await T.readHistory(page);
    Object.keys(facts.history).forEach((k) => same(got[k], facts.history[k], 'History: ' + k));
    need(got.workoutRows === finished.length, got.workoutRows + ' workout rows, expected ' + finished.length);
    return got.stats.map((s) => s.k + ' ' + s.v).join(', ') + '; ' + got.rowsWithPr + ' rows with a trophy';
  });
  if (facts.chart) await step('the progress chart shows what v2.8 showed', async () => {
    same(await T.readChart(page, facts.chart.exercise), facts.chart, 'the chart of ' + facts.chart.exercise);
    return facts.chart.exercise + ', ' + facts.chart.dots + ' sessions';
  });

  // The main sheets.
  await step('sheets: a past workout and Edit sets', async () => {
    await lib.openTab(page, 'history');
    await page.click('#app > .list [data-action="view-workout"] >> nth=' + Math.min(finished.length - 1, 3));
    await page.waitForSelector('#sheet:not([hidden]) .hist-set');
    const title = await T.text(page, '#sheet .sheet-title h2');
    await page.click('#sheet [data-action="edit-workout"]'); await page.waitForSelector('#edit-workout-form input');
    await T.closeSheet(page);
    return title;
  });
  if (name === 'v28-state') await step('sheets: a workout with a deleted exercise', async () => {
    const ids = new Set(st.exercises.map((e) => e.id)), w = finished.find((x) => x.entries.some((en) => !ids.has(en.exId)));
    need(w, 'the fixture has no entry of a deleted exercise');
    await page.click('#app > .list [data-action="view-workout"][data-w="' + w.id + '"]');
    need(/Deleted exercise/.test(await T.text(page, '#sheet-panel')), 'the sheet does not say "Deleted exercise"');
    await page.click('#sheet [data-action="edit-workout"]'); await page.waitForSelector('#edit-workout-form input');
    await T.closeSheet(page);
    return w.dayName + ' ' + w.date;
  });
  await step('sheets: weigh-ins and nights', async () => {
    await page.click('[data-action="bw-list"]'); await page.waitForSelector('#sheet:not([hidden]) [data-action="bw-delete"]');
    const bw = await T.count(page, '#sheet [data-action="bw-delete"]');
    await T.closeSheet(page);
    await page.click('[data-action="sleep-list"]'); await page.waitForSelector('#sheet:not([hidden]) [data-action="sleep-delete"]');
    const nights = await T.count(page, '#sheet [data-action="sleep-delete"]');
    await T.closeSheet(page);
    need(bw === st.bodyweight.length && nights === st.sleep.length, bw + ' weigh-ins and ' + nights + ' nights listed, expected ' + st.bodyweight.length + ' and ' + st.sleep.length);
    return bw + ' weigh-ins, ' + nights + ' nights';
  });
  await step('sheets: a program day, the exercise picker, a library program', async () => {
    await lib.openTab(page, 'program');
    await page.click('[data-action="edit-day"] >> nth=0'); await page.waitForSelector('#sheet:not([hidden]) [data-field="day-name"]');
    await page.click('#sheet [data-action="pick-ex"]'); await page.waitForSelector('#sheet:not([hidden]) [data-field="pick-search"]');
    await T.closeSheet(page);
    await page.click('[data-action="program-view"] >> nth=0'); await page.waitForSelector('#sheet:not([hidden]) [data-action="program-use"]');
    const title = await T.text(page, '#sheet .sheet-title h2');
    await T.closeSheet(page);
    return title;
  });
  await step('sheets: edit an exercise, new exercise', async () => {
    await lib.openTab(page, 'exercises');
    await page.click('#app [data-action="edit-ex"] >> nth=0'); await page.waitForSelector('#sheet:not([hidden]) #ex-form');
    await T.closeSheet(page);
    await page.click('[data-action="new-ex"]'); await page.waitForSelector('#sheet:not([hidden]) #ex-form');
    await T.closeSheet(page);
  });

  await step('settings: v3.0, no food targets, the Food card, WHOOP and reminders, the split copy listed', async () => {
    await lib.openTab(page, 'settings');
    need((await T.text(page, '#app p.tiny.center')) === 'Overload · v3.0', 'the version line reads ' + (await T.text(page, '#app p.tiny.center')));
    need(await T.count(page, '[data-field="food-target"]') === 0, 'the food targets are still in Settings');
    need(/^Food has moved to Fuel/.test(await T.text(page, '#handover .card')), 'no Food card in Settings');
    need(/WHOOP/.test(await T.text(page, '#conn-cards')) && /Reminders/.test(await T.text(page, '#conn-cards')), 'the WHOOP and Reminders cards are missing');
    await page.waitForFunction(() => { const c = document.querySelector('#safety-copies'); return c && /Before the split into two apps/.test(c.textContent); }, null, { timeout: 5000 });
    need(await T.count(page, '[data-action="restore-copy"][data-id="before-split"]') === 1, 'no Restore button for the split copy');
    return (await T.text(page, '.copy-row')).slice(0, 90);
  });

  if (!st.active) await step('looking at every screen changed nothing', async () => {
    need((await lib.readStorageText(page, lib.STATE_KEY)) === fx.text, 'the stored text differs from the fixture');
  });
  if (st.active) await step('ticking the next set logs it and starts the rest timer', async () => {
    await lib.openTab(page, 'today');
    const before = (await T.readActive(page)).setsTicked;
    await page.click('.ex-card:not(.compact) .check:not(.on):not(.small)');
    const after = (await T.readActive(page)).setsTicked;
    need(after === before + 1, 'ticking a set did not log it');
    need(await page.evaluate(() => !document.querySelector('#rest-timer').hidden), 'the rest timer did not start');
    await page.click('[data-action="rest-skip"]');
    return after + ' sets ticked';
  });

  await step('a second start does not take the split copy again', async () => {
    await lib.openTab(page, 'settings');
    await page.click('[data-action="set-rir"][data-v="0"]');   // something saved by 3.0, so the stored text is no longer the fixture
    const before = await lib.readStorageText(page, lib.STATE_KEY);
    need(before !== fx.text && JSON.parse(before).settings.trackRir === false, 'the setting was not saved');
    await reload(page);
    await lib.sleep(1200);   // a copy would be written in the background
    need((await lib.readStorageText(page, lib.STATE_KEY)) === before, 'the second start changed the stored text');
    const again = await T.copy(page, 'before-split', 0), b = await T.stored(page, 'overload.backup');
    need(again && again.at === firstCopy.at, 'the split copy was written again (at ' + (again && again.at) + ', first ' + firstCopy.at + ')');
    need(again.text === fx.text, 'the split copy no longer holds the fixture text');
    need(b.split.at === split.at, 'overload.backup.split.at changed');
    const now = JSON.parse(before), want = T.foodTexts(st), got = T.foodTexts(now);
    need(got.food === want.food && got.diary === want.diary, 'food or diary differ after use and a second start');
    return 'copy from ' + new Date(again.at).toISOString() + ' untouched';
  });

  await step('even if the note were lost, the split copy is not written over', async () => {
    await page.evaluate(() => { const b = JSON.parse(localStorage.getItem('overload.backup')); delete b.split; localStorage.setItem('overload.backup', JSON.stringify(b)); });
    await reload(page);
    await lib.sleep(1200);
    const again = await T.copy(page, 'before-split', 0), b = await T.stored(page, 'overload.backup');
    need(again && again.at === firstCopy.at && again.text === fx.text, 'the split copy was written over with later data');
    need(b.split && typeof b.split.at === 'number', 'the start was not noted again');
  });

  await step('no question was asked', async () => { same(page.dialogs, [], 'the dialogs'); });
  const problems = phone.problems();
  run.say(!problems.length, name, 'no page errors, no console errors', problems.length ? problems.join(' | ').slice(0, 400) : 'requests to other hosts blocked: ' + [...new Set(phone.blocked.map((u) => new URL(u).host))].join(', '));
  run.say(!phone.badResponses.length, name, 'no missing files', phone.badResponses.join(', '));
  await phone.close();
}

// A new install: nothing stored, so there is nothing to keep a copy of.
async function freshInstall(browser, server) {
  const fx = lib.loadFixture('v28-state'), name = 'new install';
  const phone = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
  const step = (title, fn) => run.step(name, title, fn);
  let page = null;
  await step('starts and saves a new state', async () => {
    page = await lib.openApp(phone.context, server.url + '/index.html');
    const s = await T.stored(page, lib.STATE_KEY);
    need(s && s.v === 1 && s.exercises.length > 50 && !Object.keys(s.diary).length, 'no fresh state was saved');
  });
  if (page) {
    await step('no split copy on the first start or the second', async () => {
      await lib.sleep(1200);
      need(!(await T.copy(page, 'before-split', 0)), 'a split copy was taken on a new install');
      need(typeof (await T.stored(page, 'overload.backup')).split.at === 'number', 'the first start was not noted');
      await reload(page); await lib.sleep(1200);
      need(!(await T.copy(page, 'before-split', 0)), 'a split copy was taken on the second start of a new install');
      const ids = (await T.copies(page)).map((m) => m.id);
      need(ids.length === 1 && /^day-/.test(ids[0]), 'copies: ' + ids.join(', '));
      return 'copies: ' + ids.join(', ');
    });
    await step('no card on Today; Settings says where food is logged, with the link', async () => {
      need(!(await T.count(page, '#handover .card')), 'a hand-over card on Today with no food data');
      await lib.openTab(page, 'settings');
      const card = await T.text(page, '#handover .card');
      need(/^Food is logged in a separate app, Fuel\./.test(card), 'Settings reads: ' + card);
      need(!(await T.count(page, '[data-action="handover-copy"], [data-action="handover-remove"]')), 'Copy or Remove offered with nothing to copy');
      const href = await page.getAttribute('#handover a.btn', 'href');
      need(href === server.url + '/fuel/', 'Get Fuel points at ' + href);
      return href;
    });
    const problems = phone.problems();
    run.say(!problems.length, name, 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
  }
  await phone.close();
}

// The phone's copy store (IndexedDB) does not answer during the first start: nothing is noted, and the next
// start keeps the copy (of the data as it is by then; 3.0 has not changed food in between).
async function copyStoreDown(browser, server) {
  const fx = lib.loadFixture('v28-state-small'), name = 'copy store down at the first start';
  const phone = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
  await phone.context.addInitScript(() => {
    try {
      if (localStorage.getItem('__tests.idbDownOnce')) return;
      localStorage.setItem('__tests.idbDownOnce', '1');
      Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true });
    } catch (e) { /* no storage on this page */ }
  });
  await lib.seedV28(phone.context, fx);
  const step = (title, fn) => run.step(name, title, fn);
  let page = null, later = null;
  await step('the app starts and saves as usual, without a note about the split', async () => {
    page = await lib.openApp(phone.context, server.url + '/index.html');
    need(await page.evaluate(() => !window.indexedDB), 'IndexedDB is there (the test proves nothing)');
    need((await lib.readStorageText(page, lib.STATE_KEY)) === fx.text, 'the stored text differs from the fixture after start');
    await lib.sleep(800);
    need(!(await T.stored(page, 'overload.backup')).split, 'the split was noted although no copy could be stored');
    need(/^Food has moved to Fuel/.test(await T.text(page, '#handover .card')), 'no hand-over card');
  });
  await step('the next start keeps the copy and notes the split; the one after leaves it alone', async () => {
    await lib.openTab(page, 'settings');
    await page.click('[data-action="set-rir"][data-v="0"]');
    later = await lib.readStorageText(page, lib.STATE_KEY);
    await reload(page);
    const c = await T.copy(page, 'before-split');
    need(c && c.text === later, 'no split copy of the data as it was at the second start');
    need(T.foodTexts(JSON.parse(c.text)).diary === T.foodTexts(fx.state).diary && T.foodTexts(JSON.parse(c.text)).food === T.foodTexts(fx.state).food, 'the copy\'s food is not the fixture\'s');
    await page.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('overload.backup')).split.at; } catch (e) { return false; } }, null, { timeout: 5000, polling: 100 });
    await reload(page); await lib.sleep(1000);
    const again = await T.copy(page, 'before-split', 0);
    need(again && again.at === c.at && again.text === later, 'the copy was written again at the third start');
    return c.chars + ' characters';
  });
  const problems = phone.problems();
  run.say(!problems.length, name, 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
  await phone.close();
}

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    for (const n of FIXTURES) await fixture(browser, server, n);
    if (!args.only) { await freshInstall(browser, server); await copyStoreDown(browser, server); }
  } finally { await browser.close(); await server.stop(); }
  run.done();
})().catch((e) => { console.error(e); process.exit(1); });
