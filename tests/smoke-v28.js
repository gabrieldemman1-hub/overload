#!/usr/bin/env node
/* Smoke test: every v2.8 fixture opens in the v2.8 app without an error.
 *
 *   node tests/smoke-v28.js [--port=8316] [--real-clock] [--only=v28-state]
 *
 * For each fixture: seed localStorage, start the app, open every tab, a past workout, the progress chart
 * of one exercise, a past food day, the add-food sheet (with a search in the built-in list) and Settings.
 * A step fails when what it looks for is not on screen; a fixture fails on any page error or console error.
 * The clock runs from the fixture's own "now" (v28-meta.json), so this passes on any day; --real-clock
 * uses the machine's clock instead (the fixture's "today" is then in the past).
 * Prints one PASS/FAIL line per step and exits 1 if anything failed.
 */
'use strict';
const lib = require('./lib');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] == null ? true : m[2]] : [a, true]; }));
const PORT = Number(args.port) || 8316;
const FIXTURES = ['v28-state', 'v28-state-active', 'v28-state-small'].filter((n) => !args.only || args.only === n);
const TABS = ['today', 'food', 'program', 'exercises', 'history', 'settings'];

let failed = 0;
const say = (ok, name, step, detail) => { if (!ok) failed++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  ' + step + (detail ? '  — ' + detail : '')); };

async function run(browser, server, name, variant) {
  const fx = lib.loadFixture(name);
  const label = name + (variant ? ' [' + variant + ']' : '');
  const phone = await lib.newPhone(browser, { colorScheme: variant === 'light' ? 'light' : 'dark', timezoneId: fx.meta.tz, now: args['real-clock'] ? undefined : fx.meta.now });
  await lib.seedV28(phone.context, fx, variant === 'light' ? { theme: 'light' } : {});
  let page = null;
  const step = async (title, fn) => {
    try { const detail = await fn(); say(true, label, title, detail); return true; }
    catch (e) { say(false, label, title, String((e && e.message) || e).split('\n')[0]); return false; }
  };
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  const text = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
  const count = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
  const closeSheet = async () => { if (await page.evaluate(() => !document.querySelector('#sheet').hidden)) await page.click('#sheet .sheet-title [data-action="sheet-close"]'); };
  const st = fx.state, facts = fx.facts, finished = st.workouts.filter((w) => w.finishedAt);

  const started = await step('starts', async () => {
    page = await lib.openApp(phone.context, server.url + '/index.html');
    need(await page.evaluate(() => window.__overload.state.v === 1 && !window.__overload.unreadable), 'the app did not read the data');
    return (await text('.brand')) + ', ' + Math.round(fx.text.length / 1024) + ' KB';
  });
  if (!started) { await phone.close(); return; }

  if (!variant && !args['real-clock']) {
    await step('saves back the same bytes', async () => {
      need((await lib.readStorageText(page, lib.STATE_KEY)) === fx.text, 'the stored text differs from the fixture after start');
    });
  }
  if (variant === 'light') await step('light theme applied', async () => { need((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light', 'data-theme is not light'); });

  for (const tab of TABS) {
    await step('tab ' + tab, async () => {
      await lib.openTab(page, tab);
      const body = await text('#app');
      need(body && body.length > 40, 'the screen is empty');
      need(!/This screen could not be shown/.test(body), 'the app says: this screen could not be shown');
      return (await text('#app h1')) || '';
    });
  }

  await step('today', async () => {
    await lib.openTab(page, 'today');
    if (st.active) {
      need(await count('[data-action="finish-workout"]'), 'no workout in progress on Today');
      const before = await page.evaluate(() => { const s = window.__overload.state; return s.workouts.find((w) => w.id === s.active).entries.reduce((n, e) => n + e.sets.filter((x) => x.done).length, 0); });
      need(before === facts.active.setsTicked, 'ticked sets: ' + before + ', expected ' + facts.active.setsTicked);
      await page.click('.ex-card:not(.compact) .check:not(.on):not(.small)');   // tick the next set
      const after = await page.evaluate(() => { const s = window.__overload.state; return s.workouts.find((w) => w.id === s.active).entries.reduce((n, e) => n + e.sets.filter((x) => x.done).length, 0); });
      need(after === before + 1, 'ticking a set did not log it');
      need(await page.evaluate(() => !document.querySelector('#rest-timer').hidden), 'the rest timer did not start');
      await page.click('[data-action="rest-skip"]');
      return (await text('.screen-title h1')) + ', ' + after + ' sets ticked';
    }
    need(await count('[data-action="start-workout"]'), 'no Start button on Today');
    if (!args['real-clock'] && facts.today) need((await text('.card.flat h2')) === facts.today.dayCard, 'Today offers "' + (await text('.card.flat h2')) + '", expected "' + facts.today.dayCard + '"');
    return (await text('.card.flat h2')) || 'rest day';
  });

  await step('history: a past workout', async () => {
    await lib.openTab(page, 'history');
    const rows = await count('#app > .list [data-action="view-workout"]');
    need(rows === finished.length, rows + ' workout rows, expected ' + finished.length);
    const pick = Math.min(rows - 1, 3);
    await page.click('#app > .list [data-action="view-workout"] >> nth=' + pick);
    await page.waitForSelector('#sheet:not([hidden]) .hist-set');
    const title = await text('#sheet .sheet-title h2'), sets = await count('#sheet .hist-set');
    await page.click('#sheet [data-action="edit-workout"]');
    await page.waitForSelector('#edit-workout-form input');
    await closeSheet();
    return title + ', ' + sets + ' lines';
  });

  await step('history: progress chart', async () => {
    const options = await page.evaluate(() => [...document.querySelectorAll('select[data-field="chart-ex"] option')].filter((o) => o.value).map((o) => [o.value, o.textContent]));
    need(options.length, 'no exercise to chart');
    const want = options.find((o) => o[1] === 'Flat Barbell Bench Press') || options[0];
    await page.selectOption('select[data-field="chart-ex"]', want[0]);
    await page.waitForSelector('select[data-field="chart-ex"] ~ svg.chart, .card svg.chart circle.pt');
    const dots = await page.evaluate(() => document.querySelector('select[data-field="chart-ex"]').closest('.card').querySelectorAll('circle.pt').length);
    need(dots > 0, 'the chart has no points');
    if (facts.chart && want[1] === facts.chart.exercise) need(dots === facts.chart.dots, dots + ' points, expected ' + facts.chart.dots);
    return want[1] + ', ' + dots + ' sessions';
  });

  await step('food: a past day', async () => {
    await lib.openTab(page, 'food');
    if (!args['real-clock'] && facts.foodDays) need((await text('.f-kcal > div:first-child')) === facts.foodDays[0].kcalLine, 'today reads "' + (await text('.f-kcal > div:first-child')) + '", expected "' + facts.foodDays[0].kcalLine + '"');
    await page.click('[data-action="food-day"][data-d="-1"]');
    const label = await text('.f-daylabel'), rows = await count('.f-meal .f-row[data-id]');
    if (!args['real-clock'] && facts.foodDays) {
      const y = facts.foodDays.find((d) => d.daysAgo === 1);
      need(rows === y.entries && (await text('.f-kcal > div:first-child')) === y.kcalLine, 'yesterday reads "' + (await text('.f-kcal > div:first-child')) + '" with ' + rows + ' foods, expected "' + y.kcalLine + '" with ' + y.entries);
    }
    need(rows > 0, 'no foods on ' + label);
    await page.click('.f-meal .f-row[data-id] >> nth=0');   // open a logged food
    await page.waitForSelector('#sheet:not([hidden]) #food-preview, #sheet:not([hidden]) #food-quick-form');
    await closeSheet();
    await page.click('[data-action="food-day"][data-d="0"]');
    return label + ', ' + rows + ' foods, ' + (await text('.f-big')) + ' kcal on today';
  });

  await step('food: add sheet and search', async () => {
    await page.click('[data-action="food-add"][data-meal="3"]');
    await page.waitForSelector('#sheet:not([hidden]) #food-results');
    const recents = await count('#food-results .f-row');
    await page.fill('[data-field="food-search"]', 'chicken breast');
    await page.waitForSelector('#food-results [data-action="food-pick"][data-src="usda"]', { timeout: 15000 });   // the built-in list (data/foods.json) loaded
    const hits = await count('#food-results [data-action="food-pick"]');
    await page.click('#food-results [data-action="food-pick"][data-src="usda"] >> nth=0');
    await page.waitForSelector('#food-preview .stat');
    const food = await text('.f-food-name');
    await closeSheet();
    need(!(await page.evaluate(() => window.__overload.saveFailed)), 'saving failed');
    return recents + ' rows before typing, ' + hits + ' hits, opened "' + food + '"';
  });

  await step('settings', async () => {
    await lib.openTab(page, 'settings');
    need(/v2\.8/.test(await text('#app p.tiny.center')), 'no version line');
    need(await count('[data-field="food-target"]') === 4, 'no food targets card');
    await page.waitForFunction(() => { const c = document.querySelector('#safety-copies'); return c && !/Looking for copies/.test(c.textContent); }, null, { timeout: 5000 });
    return (await text('#app p.tiny.center')) + '; ' + (await text('#safety-copies')).slice(0, 60);
  });

  if (!variant && !args['real-clock'] && facts.history) {
    await step('numbers match v28-facts.json', async () => {
      await lib.openTab(page, 'history');
      const stats = await page.evaluate(() => [...document.querySelectorAll('#app > .stat-row .stat')].map((s) => s.querySelector('.k').textContent + ' ' + s.querySelector('.v').textContent).join(', '));
      const want = facts.history.stats.map((s) => s.k + ' ' + s.v).join(', ');
      need(stats === want, 'History reads "' + stats + '", expected "' + want + '"');
      await lib.openTab(page, 'exercises');
      for (const e of facts.exercises || []) {
        const line = await page.evaluate((n) => { const b = [...document.querySelectorAll('#app .list-item')].find((x) => x.querySelector('.title').textContent === n); return b ? b.querySelector('.sub').textContent.replace(/\s+/g, ' ').trim() : null; }, e.name);
        if (!st.active) need(line === e.line, e.name + ' reads "' + line + '", expected "' + e.line + '"');
      }
      return stats;
    });
  }

  // The odd corners of the heavy fixture: history of a deleted exercise, an entry whose food is gone.
  if (!variant && name === 'v28-state') {
    await step('history: workout with a deleted exercise', async () => {
      const ids = new Set(st.exercises.map((e) => e.id));
      const w = finished.find((x) => x.entries.some((en) => !ids.has(en.exId)));
      need(w, 'the fixture has no entry of a deleted exercise');
      await lib.openTab(page, 'history');
      await page.click('#app > .list [data-action="view-workout"][data-w="' + w.id + '"]');
      need(/Deleted exercise/.test(await text('#sheet-panel')), 'the sheet does not say "Deleted exercise"');
      await page.click('#sheet [data-action="edit-workout"]'); await page.waitForSelector('#edit-workout-form input');
      await closeSheet();
      return w.dayName + ' ' + w.date;
    });
    await step('food: entry whose food was deleted', async () => {
      const day = Object.keys(st.diary).reverse().find((k) => st.diary[k].some((e) => e.food && !st.food.foods[e.food]));
      need(day, 'the fixture has no entry of a deleted food');
      const e = st.diary[day].find((x) => x.food && !st.food.foods[x.food]);
      await lib.openTab(page, 'food');
      for (let i = 0; i < 200 && (await page.evaluate(() => window.__overloadFood._.fu.drawn)) !== day; i++) await page.click('[data-action="food-day"][data-d="-1"]');
      await page.click('.f-meal .f-row[data-id="' + e.id + '"]');
      await page.waitForSelector('#food-preview .stat');
      const units = await page.evaluate(() => [...document.querySelectorAll('[data-field="food-unit"] option')].map((o) => o.textContent));
      need(units.length === 1, 'expected one unit (the logged amount as one serving), got ' + units.join(' | '));
      await closeSheet(); await page.click('[data-action="food-day"][data-d="0"]');
      return e.name + ' on ' + day + ', unit "' + units[0] + '"';
    });
  }

  // Export JSON gives the data; importing that file into an empty app gives the same bytes back.
  if (!variant && !args['real-clock']) {
    let file = null, current = null;
    if (!st.active) await step('looking at every screen changed nothing', async () => { need((await lib.readStorageText(page, lib.STATE_KEY)) === fx.text, 'the stored text differs from the fixture'); });
    await step('settings: Export JSON holds the data', async () => {
      await lib.openTab(page, 'settings');
      current = await lib.readStorageText(page, lib.STATE_KEY);   // the active fixture has one more set ticked by now
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
      file = await dl.path();
      const out = require('fs').readFileSync(file, 'utf8');
      need(JSON.stringify(JSON.parse(out)) === current, 'the exported file differs from the stored data');
      need(/^overload-backup-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), 'file name ' + dl.suggestedFilename());
      return dl.suggestedFilename() + ', ' + out.length + ' characters (pretty-printed)';
    });
    if (file) await step('settings: Import JSON of that file into an empty app', async () => {
      const other = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
      try {
        const p2 = await lib.openApp(other.context, server.url + '/index.html');
        await lib.openTab(p2, 'settings');
        await p2.setInputFiles('#import-file', file);
        await p2.waitForFunction(() => /Backup restored|Not saved/.test(document.querySelector('#toast').textContent), null, { timeout: 8000 });
        need((await lib.readStorageText(p2, lib.STATE_KEY)) === current, 'after the import the stored text differs from what was exported');
        need(p2.dialogs.length === 1 && /Replace everything on this phone with the backup/.test(p2.dialogs[0]), 'unexpected questions: ' + p2.dialogs.join(' / '));
        other.assertClean('import');
        return p2.dialogs[0].split('\n').slice(2, 4).join(' | ').replace('confirm: ', '');
      } finally { await other.close(); }
    });
  }

  const problems = phone.problems();
  say(!problems.length, label, 'no page errors, no console errors', problems.length ? problems.join(' | ').slice(0, 400) : 'requests to other hosts blocked: ' + [...new Set(phone.blocked.map((u) => new URL(u).host))].join(', '));
  if (phone.badResponses.length) say(false, label, 'no missing files', phone.badResponses.join(', '));
  await phone.close();
}

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    for (const name of FIXTURES) await run(browser, server, name);
    if (FIXTURES.includes('v28-state')) await run(browser, server, 'v28-state', 'light');
  } finally { await browser.close(); await server.stop(); }
  console.log('\n' + (failed ? failed + ' step(s) FAILED' : 'All steps passed'));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
