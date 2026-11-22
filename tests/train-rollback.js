#!/usr/bin/env node
/* Roll-back: data used by Overload 3.0 must load in v2.8 as v2.8 expects it.
 *
 *   node tests/train-rollback.js [--port=8405]
 *
 * v2.8 is taken from git (commit 3b17963) into a temporary folder and served on the same address as the new
 * app, one after the other, so both run on the same localStorage and IndexedDB, as on the phone when an
 * update is rolled back or has only half arrived.
 *   1. Main fixture. 3.0: the card on Today hidden, a setting changed, the food log copied. Then v2.8: starts
 *      without the "could not read the data" screen and writes back the same bytes; every tab draws; the
 *      three named food days, the add sheet, Today, Exercises, History and the chart are as in
 *      v28-facts.json; Settings draws; the note about the split survives a write by v2.8; the copy taken
 *      before the split is listed and Restore gives back exactly the fixture text. Then 3.0 again: starts,
 *      and does not take the split copy a second time.
 *   2. Workout in progress. 3.0: one more set ticked. v2.8 resumes the workout with that set.
 *   3. After "Remove the old food log" in 3.0: v2.8 starts, shows an empty food day with the targets, saved
 *      meals and favourites still there, and restores the log from the copy taken before the removal.
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const lib = require('./lib');
const T = require('./train-common');

const args = T.args();
const PORT = Number(args.port) || 8405;
const run = T.runner('train-rollback');
const { need, same } = run;
const text = (page) => lib.readStorageText(page, lib.STATE_KEY);
const V28_TABS = ['today', 'food', 'program', 'exercises', 'history', 'settings'];

// One server at a time on the same port: the new app (the repo) or v2.8 (the extracted folder).
let server = null;
async function serve(dir) { if (server) await server.stop(); server = await lib.startServer(dir, PORT); return server; }
async function openV(phone, version) {
  const page = await lib.openApp(phone.context, server.url + '/index.html');
  const v = await page.evaluate(() => [...document.scripts].map((s) => (/app\.js\?v=([\d.]+)/.exec(s.getAttribute('src') || '') || [])[1]).filter(Boolean)[0]);
  if (v !== version) throw new Error('the page is version ' + v + ', expected ' + version);
  return page;
}
async function newPhone(browser, fx) {
  const phone = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
  await phone.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await lib.seedV28(phone.context, fx);
  return phone;
}
// The add-food sheet of v2.8, read as make-v28.js read it.
async function readAddSheet(page) {
  await page.click('[data-action="food-add"][data-meal="3"]');
  await page.waitForSelector('#sheet:not([hidden]) #food-results');
  const got = await page.evaluate(() => {
    const groups = {}; let g = null;
    [...document.querySelectorAll('#food-results > *')].forEach((n) => { if (n.classList.contains('group-title')) { g = n.textContent.trim(); groups[g] = 0; } else if (g && n.classList.contains('f-row')) groups[g]++; });
    return { title: document.querySelector('#sheet .sheet-title h2').textContent, groups, favourites: [...document.querySelectorAll('#food-results .f-favmark')].map((m) => m.parentNode.textContent.replace('★', '').trim()) };
  });
  await T.closeSheet(page);
  return got;
}
const errors = (name, phone) => { const p = phone.problems(); run.say(!p.length, name, 'no page errors, no console errors (3.0 and v2.8)', p.join(' | ').slice(0, 400)); if (phone.badResponses.length) run.say(false, name, 'no missing files', phone.badResponses.join(', ')); };

async function mainScenario(browser, v28) {
  const name = 'v28-state', fx = lib.loadFixture(name), facts = fx.facts, step = (title, fn) => run.step(name, title, fn);
  const phone = await newPhone(browser, fx);
  let used = null, split = null, firstCopy = null, page = null;

  await serve(lib.REPO);
  await step('3.0: hide the card, change a setting, copy the food log', async () => {
    page = await openV(phone, '3.0');
    firstCopy = await T.copy(page, 'before-split');
    need(firstCopy && firstCopy.text === fx.text, 'no split copy with the fixture text');
    await page.click('[data-action="handover-hide"]');
    await lib.openTab(page, 'settings');
    await page.click('[data-action="set-rir"][data-v="0"]');
    await page.click('[data-action="handover-copy"]'); await T.toast(page, /Food log copied/);
    used = await text(page); split = (await T.stored(page, 'overload.backup')).split;
    need(JSON.parse(used).settings.trackRir === false && used !== fx.text, 'the setting was not saved');
    need(split.copied && split.dismissed, 'the note is ' + JSON.stringify(split));
    await page.close();
    return 'note: ' + Object.keys(split).join(', ');
  });

  await serve(v28);
  const ok = await step('v2.8 starts on that data without the "could not read" screen and writes back the same bytes', async () => {
    page = await openV(phone, '2.8');
    need(await page.evaluate(() => window.__overload.state.v === 1 && !window.__overload.unreadable), 'v2.8 could not read the data');
    need((await T.text(page, '.screen-title h1')) === 'Today', 'v2.8 shows "' + (await T.text(page, '.screen-title h1')) + '"');
    same(await lib.tabNames(page), V28_TABS, 'the tab bar of v2.8');
    need((await text(page)) === used, 'v2.8 changed the stored text at its start');
  });
  if (ok) {
    await step('v2.8: Today is as in the fixture', async () => {
      const today = await T.readToday(page);
      Object.keys(facts.today).forEach((k) => same(today[k], facts.today[k], 'Today: ' + k));
      return today.dayCard + ' · ' + today.dayMeta;
    });
    for (const tab of V28_TABS) {
      await step('v2.8: tab ' + tab, async () => {
        await lib.openTab(page, tab);
        const body = await T.text(page, '#app');
        need(body && body.length > 40 && !/This screen could not be shown/.test(body), 'the screen is empty or could not be shown');
      });
    }
    await step('v2.8: the three named food days are as in the fixture', async () => {
      await lib.openTab(page, 'food');
      let at = 0; const seen = [];
      for (const want of facts.foodDays) {
        for (; at < want.daysAgo; at++) await page.click('[data-action="food-day"][data-d="-1"]');
        same(Object.assign({ daysAgo: want.daysAgo }, await T.readFoodDay(page)), want, 'the food day ' + want.date);
        seen.push(want.label + ' ' + want.kcalLine);
      }
      await page.click('[data-action="food-day"][data-d="0"]');
      return seen.join(' | ');
    });
    await step('v2.8: the add sheet lists the saved meals, favourites and recents of the fixture', async () => {
      const got = await readAddSheet(page);
      same(got, facts.addSheet, 'the add sheet');
      return JSON.stringify(got.groups);
    });
    await step('v2.8: Exercises, History and the progress chart are as in the fixture', async () => {
      same(await T.readExercises(page, facts.exercises.map((e) => e.name)), facts.exercises.map((e) => ({ name: e.name, line: e.line })), 'the next-time lines');
      const h = await T.readHistory(page);
      Object.keys(facts.history).forEach((k) => same(h[k], facts.history[k], 'History: ' + k));
      same(await T.readChart(page, facts.chart.exercise), facts.chart, 'the chart');
      return h.stats.map((s) => s.k + ' ' + s.v).join(', ');
    });
    await step('v2.8: Settings draws, with the food targets, the changed setting and the split copy in the list', async () => {
      await lib.openTab(page, 'settings');
      need((await T.text(page, '#app p.tiny.center')) === 'Overload · v2.8', 'the version line reads ' + (await T.text(page, '#app p.tiny.center')));
      need(await T.count(page, '[data-field="food-target"]') === 4, 'no food targets card');
      need(await T.count(page, '[data-action="set-rir"][data-v="0"].on') === 1, 'the setting changed in 3.0 is not shown');
      need(/Reminders/.test(await T.text(page, '#conn-cards')), 'the Reminders card is missing');
      await page.waitForSelector('[data-action="restore-copy"][data-id="before-split"]', { timeout: 5000 });
      const row = await page.evaluate(() => document.querySelector('[data-action="restore-copy"][data-id="before-split"]').closest('.copy-row').textContent.replace(/\s+/g, ' ').trim());
      need(/^Copy · Sat, Nov 21/.test(row) && /70 workouts/.test(row) && /110 food days/.test(row), 'the row reads: ' + row);
      return row;
    });
    await step('v2.8: the note about the split survives a write by v2.8 (Export JSON)', async () => {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
      need(/^overload-backup-/.test(dl.suggestedFilename()), 'no export');
      const b = await T.stored(page, 'overload.backup');
      need(b.lastExport > fx.meta.backup.lastExport, 'v2.8 did not write overload.backup');
      same(b.split, split, 'overload.backup.split');
    });
    await step('v2.8: Restore of the split copy gives back exactly the fixture text', async () => {
      page.dialogs.length = 0;
      await page.click('[data-action="restore-copy"][data-id="before-split"]');
      await T.toast(page, /Copy restored|cannot be read|Not saved/);
      need(page.dialogs.length === 1 && /^confirm: Replace everything on this phone with the copy "Copy"\?/.test(page.dialogs[0]), 'v2.8 asked: ' + page.dialogs.join(' / '));
      need((await text(page)) === fx.text, 'the stored text is not the fixture after the restore');
      return (await T.text(page, '#toast'));
    });
    await page.close();

    await serve(lib.REPO);
    await step('3.0 again: starts, keeps the split copy as it was, and the copied food log still counts', async () => {
      page = await openV(phone, '3.0');
      need(await page.evaluate(() => window.__overload.state.v === 1 && !window.__overload.unreadable), '3.0 could not read the data');
      need((await text(page)) === fx.text, '3.0 changed the stored text at its start');
      await lib.sleep(1200);
      const c = await T.copy(page, 'before-split', 0);
      need(c && c.at === firstCopy.at && c.text === fx.text, 'the split copy was written again or changed');
      same((await T.stored(page, 'overload.backup')).split, split, 'overload.backup.split');
      need(!(await T.count(page, '#handover .card')), 'the card is back on Today although the food log is as it was when copied');
      await page.close();
    });
  }
  errors(name, phone); await phone.close();
}

async function activeScenario(browser, v28) {
  const name = 'v28-state-active', fx = lib.loadFixture(name), facts = fx.facts, step = (title, fn) => run.step(name, title, fn);
  const phone = await newPhone(browser, fx);
  let used = null, page = null;
  await serve(lib.REPO);
  await step('3.0: tick the next set of the workout in progress', async () => {
    page = await openV(phone, '3.0');
    await T.copy(page, 'before-split');
    same((await T.readActive(page)).setsTicked, facts.active.setsTicked, 'the ticked sets at the start');
    await page.click('.ex-card:not(.compact) .check:not(.on):not(.small)');
    await page.click('[data-action="rest-skip"]');
    same((await T.readActive(page)).setsTicked, facts.active.setsTicked + 1, 'the ticked sets after the tap');
    used = await text(page);
    await page.close();
  });
  await serve(v28);
  await step('v2.8 resumes the same workout with that set, and writes back the same bytes', async () => {
    page = await openV(phone, '2.8');
    need(await page.evaluate(() => window.__overload.state.v === 1 && !window.__overload.unreadable), 'v2.8 could not read the data');
    const a = await T.readActive(page);
    need(await T.count(page, '[data-action="finish-workout"]') === 1 && a.title === facts.active.title, 'v2.8 does not show the workout in progress');
    same([a.setsTicked, a.sets, a.exercises, a.exercisesDone], [facts.active.setsTicked + 1, facts.active.sets, facts.active.exercises, facts.active.exercisesDone], 'sets ticked, sets, exercises, exercises done');
    need(await page.evaluate((id) => window.__overload.state.active === id, fx.state.active), 'another workout is active');
    need((await text(page)) === used, 'v2.8 changed the stored text at its start');
    await lib.openTab(page, 'food');
    need((await T.text(page, '.f-kcal > div:first-child')) === facts.foodDays[0].kcalLine, 'today\'s food reads ' + (await T.text(page, '.f-kcal > div:first-child')));
    await page.close();
    return a.title + ', ' + a.setsTicked + ' of ' + a.sets + ' sets ticked';
  });
  errors(name, phone); await phone.close();
}

async function removedScenario(browser, v28) {
  const name = 'after Remove', fx = lib.loadFixture('v28-state'), facts = fx.facts, step = (title, fn) => run.step(name, title, fn);
  const phone = await newPhone(browser, fx);
  let used = null, page = null;
  await serve(lib.REPO);
  await step('3.0: copy the food log, then remove the old food log', async () => {
    page = await openV(phone, '3.0');
    await T.copy(page, 'before-split');
    await lib.openTab(page, 'settings');
    await page.click('[data-action="handover-copy"]'); await T.toast(page, /Food log copied/);
    await page.click('[data-action="handover-remove"]'); await T.toast(page, /Old food log removed/);
    used = await text(page);
    same(JSON.parse(used).diary, {}, 'diary');
    const c = await T.copy(page, 'before-foodremove');
    need(c && c.text === fx.text, 'the copy taken before the removal does not hold the fixture text');
    await page.close();
  });
  await serve(v28);
  await step('v2.8 starts, every tab draws, food shows an empty day with targets, saved meals and favourites', async () => {
    page = await openV(phone, '2.8');
    need(await page.evaluate(() => window.__overload.state.v === 1 && !window.__overload.unreadable), 'v2.8 could not read the data');
    need((await text(page)) === used, 'v2.8 changed the stored text at its start');
    for (const tab of V28_TABS) { await lib.openTab(page, tab); need(!/This screen could not be shown/.test(await T.text(page, '#app')), 'tab ' + tab + ' could not be shown'); }
    await lib.openTab(page, 'food');
    const day = await T.readFoodDay(page);
    need(day.entries === 0 && day.kcalLine === '0 / 2,400 kcal', 'the food day reads ' + day.kcalLine + ' with ' + day.entries + ' foods');
    const sheet = await readAddSheet(page);
    same([sheet.groups['Saved meals'], sheet.groups.Favorites], [facts.addSheet.groups['Saved meals'], facts.addSheet.groups.Favorites], 'saved meals and favourites in the add sheet');
    same((await T.readHistory(page)).stats, facts.history.stats, 'History');
    return day.kcalLine + '; ' + JSON.stringify(sheet.groups);
  });
  await step('v2.8: Restore of the copy taken before the removal brings the food log back', async () => {
    await lib.openTab(page, 'settings');
    await page.waitForSelector('[data-action="restore-copy"][data-id="before-foodremove"]', { timeout: 5000 });
    await page.click('[data-action="restore-copy"][data-id="before-foodremove"]');
    await T.toast(page, /Copy restored|cannot be read|Not saved/);
    need((await text(page)) === fx.text, 'the stored text is not the fixture after the restore');
    await lib.openTab(page, 'food');
    need((await T.text(page, '.f-kcal > div:first-child')) === facts.foodDays[0].kcalLine, 'today\'s food reads ' + (await T.text(page, '.f-kcal > div:first-child')));
    await page.close();
    return facts.foodDays[0].kcalLine;
  });
  errors(name, phone); await phone.close();
}

(async () => {
  const v28 = T.extractV28();
  const browser = await lib.launch();
  try {
    await mainScenario(browser, v28);
    await activeScenario(browser, v28);
    await removedScenario(browser, v28);
  } finally { await browser.close(); if (server) await server.stop(); T.removeDir(v28); }
  run.done();
})().catch((e) => { console.error(e); process.exit(1); });
