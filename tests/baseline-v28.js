#!/usr/bin/env node
/* Baseline gallery: what v2.8 looks like with real-looking data, before the redesign.
 *
 *   node tests/baseline-v28.js [--out=<folder>] [--port=8315] [--theme=dark|light]
 *
 * Screenshots of every screen and the main sheets, in dark and in light, from the fixtures in
 * tests/fixtures (main, active and small), plus a first start and the "data cannot be read" screen.
 * Writes <out>/dark/*.png, <out>/light/*.png and <out>/index.html. Nothing is written into the repo
 * unless --out points there. The phone is 390x844 at 2x, so a screen is 780x1688 px; "-full" shots are the
 * whole page. Fails on any page error or console error.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] == null ? true : m[2]] : [a, true]; }));
const OUT = path.resolve(typeof args.out === 'string' ? args.out : '/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/ov/baseline-data');
const PORT = Number(args.port) || 8315;
const THEMES = args.theme ? [args.theme] : ['dark', 'light'];
const shots = [];

async function session(browser, server, theme, fixture, opts, fn) {
  opts = opts || {};
  const fx = fixture ? lib.loadFixture(fixture) : null;
  const meta = lib.loadFixture('v28-state').meta;
  const phone = await lib.newPhone(browser, { colorScheme: theme, timezoneId: meta.tz, now: meta.now });
  if (fx) await lib.seedV28(phone.context, fx, Object.assign({ theme }, opts.seed || {}));
  else if (opts.storage) await lib.seedStorage(phone.context, opts.storage);
  const page = await lib.openApp(phone.context, server.url + '/index.html');
  const dir = path.join(OUT, theme);
  const snap = async (name, o) => {
    await page.waitForTimeout(320);   // a sheet slides in over 0.18 s
    await lib.shot(page, path.join(dir, name + '.png'), o);
    shots.push({ theme, name, full: !!(o && o.fullPage) });
  };
  const ctx = {
    page, snap, phone,
    tab: (n) => lib.openTab(page, n),
    click: (sel) => page.click(sel),
    close: async () => { if (await page.evaluate(() => !document.querySelector('#sheet').hidden)) await page.click('#sheet .sheet-title [data-action="sheet-close"]'); },
    top: () => page.evaluate(() => window.scrollTo(0, 0)),
    hideToast: () => page.evaluate(() => { document.querySelector('#toast').hidden = true; })
  };
  await fn(ctx);
  phone.assertClean('baseline ' + theme + ' ' + (fixture || 'no data'));
  await phone.close();
}

async function mainScreens(c) {
  const { page, snap, tab, click, close, top } = c;
  // Today
  await snap('01-today'); await snap('01-today-full', { fullPage: true });
  await click('[data-action="checkin-edit"]'); await snap('02-today-checkin-edit');
  await click('[data-action="checkin-cancel"]');
  await click('[data-action="toggle-others"]'); await page.evaluate(() => document.querySelector('.group-title').scrollIntoView({ block: 'center' })); await snap('03-today-start-a-different-day');
  await top();
  await page.evaluate(() => { const r = document.querySelector('.day-chip.rest'); if (r) r.click(); }); await snap('04-today-rest-day-selected');
  await click('.day-chip.today');
  await click('.card.flat .list .list-item >> nth=0'); await snap('05-today-edit-exercise-sheet'); await close();
  // Food
  await tab('food'); await snap('10-food-today'); await snap('10-food-today-full', { fullPage: true });
  await click('[data-action="food-day"][data-d="-1"]'); await snap('11-food-yesterday'); await snap('11-food-yesterday-full', { fullPage: true });
  await click('.f-meal .f-row[data-id] >> nth=1'); await snap('12-food-edit-entry-sheet'); await close();
  await click('[data-action="food-meal-menu"][data-meal="1"]'); await snap('13-food-meal-menu-sheet'); await close();
  await click('[data-action="food-day"][data-d="0"]');
  await click('[data-action="food-add"][data-meal="2"]'); await snap('14-food-add-sheet');
  await page.evaluate(() => { document.querySelector('#sheet-panel').scrollTop = 520; }); await snap('14-food-add-sheet-scrolled');
  await page.evaluate(() => { document.querySelector('#sheet-panel').scrollTop = 0; });
  await click('#food-results [data-action="food-sm-open"] >> nth=0'); await snap('15-food-saved-meal-sheet'); await click('[data-action="food-back"]');
  await click('#food-results [data-action="food-pick"] >> nth=0'); await snap('16-food-amount-sheet'); await click('[data-action="food-back"]');
  await page.fill('[data-field="food-search"]', 'chicken'); await page.waitForSelector('#food-results [data-action="food-pick"][data-src="usda"]'); await snap('17-food-search-results');
  await page.fill('[data-field="food-search"]', '');
  await click('[data-action="food-quick"]'); await snap('18-food-quick-add-sheet'); await close();
  await click('[data-action="food-add"][data-meal="2"]');
  await click('[data-action="food-new"]'); await snap('19-food-new-food-sheet'); await close();
  await click('[data-action="food-add"][data-meal="2"]');
  await click('[data-action="food-scan"] >> nth=0'); await page.waitForFunction(() => !/Starting camera/.test(document.querySelector('#scan-status').textContent), null, { timeout: 8000 }).catch(() => {}); await snap('20-food-scan-sheet-no-camera'); await close();
  // Program
  await tab('program'); await snap('30-program'); await snap('30-program-full', { fullPage: true });
  await click('[data-action="edit-day"] >> nth=0'); await snap('31-program-edit-day-sheet');
  await click('[data-action="pick-ex"]'); await snap('32-program-add-exercise-picker'); await close();
  await click('[data-action="program-view"] >> nth=0'); await snap('33-program-library-sheet'); await close();
  // Exercises
  await tab('exercises'); await snap('40-exercises'); await snap('40-exercises-full', { fullPage: true });
  await page.evaluate(() => { const b = [...document.querySelectorAll('#app .list-item')].find((x) => x.querySelector('.title').textContent === 'Dumbbell Lateral Raise'); b.click(); }); await snap('41-exercises-edit-sheet');
  await page.evaluate(() => { document.querySelector('#sheet-panel').scrollTop = 600; }); await snap('41-exercises-edit-sheet-scrolled'); await close();
  await click('[data-action="new-ex"]'); await snap('42-exercises-new-sheet'); await close();
  await page.fill('[data-field="search"]', 'curl'); await snap('43-exercises-search'); await page.fill('[data-field="search"]', '');
  // History
  await tab('history'); await snap('50-history'); await snap('50-history-full', { fullPage: true });
  await click('[data-action="review-set"][data-v="1"]'); await page.evaluate(() => document.querySelector('.review-list').closest('.card').scrollIntoView({ block: 'start' })); await page.evaluate(() => window.scrollBy(0, -70)); await snap('51-history-weekly-review-last-week');
  await click('[data-action="review-set"][data-v="0"]');
  await click('[data-action="cal-prev"]'); await page.evaluate(() => { document.querySelector('.cal-grid').closest('.card').scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await snap('52-history-calendar-previous-month');
  const bench = await page.evaluate(() => [...document.querySelectorAll('select[data-field="chart-ex"] option')].find((o) => o.textContent === 'Flat Barbell Bench Press').value);
  await page.selectOption('select[data-field="chart-ex"]', bench);
  await page.evaluate(() => { document.querySelector('select[data-field="chart-ex"]').closest('.card').scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await snap('53-history-progress-chart');
  await page.evaluate(() => { [...document.querySelectorAll('#app > .card')].find((x) => /^Body weight/.test(x.textContent.trim())).scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await snap('54-history-body-weight-and-sleep');
  await click('[data-action="bw-list"]'); await snap('55-history-weigh-ins-sheet'); await close();
  await click('[data-action="sleep-list"]'); await snap('56-history-sleep-sheet'); await close();
  await page.evaluate(() => { document.querySelector('#app > .list').previousElementSibling.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await snap('57-history-workout-list');
  await click('#app > .list [data-action="view-workout"] >> nth=3'); await snap('58-history-workout-sheet');
  await page.evaluate(() => { document.querySelector('#sheet-panel').scrollTop = 99999; }); await snap('58-history-workout-sheet-end');
  await click('#sheet [data-action="edit-workout"]'); await snap('59-history-edit-sets-sheet');
  await click('#edit-workout-form button[type="submit"]'); await page.waitForSelector('#toast:not([hidden])'); await snap('59-history-toast-after-save'); await c.hideToast(); await close();
  const deload = await page.evaluate(() => { const r = [...document.querySelectorAll('#app > .list [data-action="view-workout"]')].find((x) => /Deload/.test(x.textContent)); r.scrollIntoView({ block: 'center' }); return r.dataset.w; });
  await snap('60-history-deload-row'); await click('#app > .list [data-action="view-workout"][data-w="' + deload + '"]'); await snap('60-history-deload-workout-sheet'); await close();
  // Settings
  await tab('settings'); await page.waitForFunction(() => !/Looking for copies/.test(document.querySelector('#safety-copies').textContent)); await snap('70-settings'); await snap('70-settings-full', { fullPage: true });
}

async function activeScreens(c) {
  const { page, snap, click, close, top } = c;
  await snap('80-workout-as-opened');                    // the app scrolls to the next set
  await top(); await snap('80-workout-top'); await snap('80-workout-full', { fullPage: true });
  await click('[data-action="soreness-edit"]'); await top(); await snap('81-workout-soreness-check-in');
  await click('[data-action="soreness-done"]');
  await click('.ex-card.compact [data-action="open-entry"] >> nth=0'); await page.evaluate(() => { document.querySelector('.ex-card.done:not(.compact)').scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await snap('82-workout-finished-exercise-open');
  await click('[data-action="close-entry"]');
  await page.evaluate(() => { const card = [...document.querySelectorAll('.ex-card:not(.done)')][1]; card.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); });
  await click('.ex-card:not(.done) >> nth=1 >> [data-action="gen-warmup"]'); await snap('83-workout-exercise-with-warm-up');
  await click('.ex-card:not(.done) >> nth=0 >> .check:not(.on):not(.small)');   // tick the next set: rest timer
  await page.evaluate(() => { document.querySelector('.ex-card:not(.done)').scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await snap('84-workout-rest-timer-and-feedback');
  await page.evaluate(() => { const p = document.querySelector('.ex-card:not(.done) .prompt'); if (p) { p.scrollIntoView({ block: 'center' }); } }); await snap('84-workout-how-was-it');
  await click('[data-action="rest-skip"]');
  await click('.ex-card:not(.done) >> nth=1 >> [data-action="swap-entry"]'); await snap('85-workout-swap-exercise-picker'); await close();
  await page.evaluate(() => { document.querySelector('#cardio-card').scrollIntoView({ block: 'center' }); }); await snap('86-workout-cardio-and-finish');
  await top(); await click('[data-action="toggle-deload"]'); await page.evaluate(() => { document.querySelector('#toast').hidden = true; }); await snap('87-workout-deload-on');
  await click('[data-action="toggle-deload"]');
  await lib.openTab(page, 'food'); await snap('88-food-tab-during-a-workout');
}

async function smallScreens(c) {
  const { page, snap, tab, click, close } = c;
  await snap('90-light-user-today');
  await tab('food'); await snap('91-light-user-food-no-targets');
  await click('[data-action="food-targets"]'); await snap('92-light-user-food-targets-sheet'); await close();
  await click('[data-action="food-day"][data-d="-1"]'); await click('[data-action="food-day"][data-d="-1"]'); await snap('93-light-user-empty-food-day-copy-offer');
  await tab('history'); await snap('94-light-user-history-full', { fullPage: true });
  await tab('settings'); await page.evaluate(() => { [...document.querySelectorAll('.group-title')].find((g) => /WHOOP/.test(g.textContent)).scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await snap('95-settings-whoop-reminders-food-targets');
  await page.evaluate(() => { document.querySelector('#cloud-card').scrollIntoView({ block: 'center' }); }); await snap('96-settings-backup-cloud-danger');
}

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    for (const theme of THEMES) {
      await session(browser, server, theme, 'v28-state', null, mainScreens);
      await session(browser, server, theme, 'v28-state-active', null, activeScreens);
      await session(browser, server, theme, 'v28-state-small', null, smallScreens);
      // No export for a long time and cloud sync off: the reminder line on Today.
      await session(browser, server, theme, 'v28-state', { seed: { backup: { since: 1, lastExport: lib.loadFixture('v28-state').meta.now - 20 * 864e5 } } }, async (c) => { await c.snap('06-today-backup-reminder'); });
      // A first start: nothing saved yet.
      await session(browser, server, theme, null, { storage: { 'overload.theme': theme } }, async (c) => {
        await c.snap('97-first-start-today'); await c.tab('food'); await c.snap('97-first-start-food'); await c.tab('history'); await c.snap('97-first-start-history');
      });
      // Saved data that cannot be read.
      await session(browser, server, theme, null, { storage: { 'overload.theme': theme, 'overload.state.v1': '{"v":1,"settings":{"theme":"' + theme + '"},"exercises":[' } }, async (c) => { await c.snap('98-data-cannot-be-read'); });
      // The app's storage is full: the banner that stays until a save works again.
      await session(browser, server, theme, 'v28-state', null, async (c) => {
        await c.page.evaluate(() => {
          for (const size of [500000, 20000, 500, 10]) { try { for (let i = 0; i < 400; i++) localStorage.setItem('zz.fill.' + size + '.' + i, 'x'.repeat(size)); } catch (e) { /* full at this size */ } }
        });
        // The next thing logged no longer fits: a quick add.
        await c.tab('food'); await c.click('[data-action="food-add"][data-meal="3"]'); await c.click('[data-action="food-quick"]');
        await c.page.fill('#food-quick-form [name="kcal"]', '120'); await c.click('#food-quick-form button[type="submit"]');
        await c.page.waitForSelector('#save-warning:not([hidden])');
        await c.snap('99-storage-full-banner');
        await c.tab('settings'); await c.page.evaluate(() => { [...document.querySelectorAll('.group-title')].find((g) => /Backup/.test(g.textContent)).scrollIntoView({ block: 'start' }); window.scrollBy(0, -160); }); await c.snap('99-storage-full-settings-backup');
      });
      console.log(theme + ': ' + shots.filter((s) => s.theme === theme).length + ' screenshots');
    }
  } finally { await browser.close(); await server.stop(); }
  // A page to look through them.
  const names = [...new Set(shots.map((s) => s.name))];
  const html = '<!doctype html><meta charset="utf-8"><title>Overload v2.8 baseline</title><style>body{font:14px system-ui;margin:16px;background:#222;color:#eee}h2{margin:28px 0 8px;font-size:15px}.row{display:flex;gap:12px;align-items:flex-start}img{width:320px;border:1px solid #555;border-radius:8px}a{color:#9cf}</style>'
    + '<h1>Overload v2.8 with the main fixture: before the redesign</h1><p>' + names.length + ' views, ' + THEMES.join(' and ') + '. Click an image for full size.</p>'
    + names.map((n) => '<h2 id="' + n + '">' + n + '</h2><div class="row">' + THEMES.map((t) => '<a href="' + t + '/' + n + '.png"><img loading="lazy" src="' + t + '/' + n + '.png" alt="' + n + ' ' + t + '"></a>').join('') + '</div>').join('');
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  console.log('Gallery: ' + path.join(OUT, 'index.html'));
})().catch((e) => { console.error('FAILED: ' + (e && e.stack || e)); process.exit(1); });
