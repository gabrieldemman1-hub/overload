#!/usr/bin/env node
/* Fuel 3.0: Trends follows the date (dev/notes/review-findings.md, F3).
 *
 *   node tests/fuel-trends.js [--port=8428]
 *
 * Trends is drawn for one date. An iPhone resumes a Home Screen app rather than reloading it, so the Trends
 * screen left open on Sunday evening is what he finds on Monday morning. The page's clock is the test's, set to
 * Sunday 23:50 in Los Angeles, with the food log of the last 25 days:
 *   - left open past midnight: within a minute the chart ends on Monday, and the averages are the new week's
 *     (checked against a count made here);
 *   - put away for the night and brought back to the front: drawn for the new date at once;
 *   - an open sheet holds the redraw until it has closed, and so does a box with the keyboard;
 *   - on the same date it is never drawn again by itself, and the other screens are not touched.
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const lib = require('./lib');
const F = require('./fuel-common');

const args = F.args();
const PORT = Number(args.port) || 8428;
const run = F.runner('fuel-trends');
const { need, same } = run;
const TZ = 'America/Los_Angeles';
const SUNDAY_LATE = Date.parse('2026-11-09T07:50:00Z');   // Sunday 2026-11-08, 23:50 in Los Angeles
const MONDAY_MORNING = Date.parse('2026-11-09T15:30:00Z');   // Monday 2026-11-09, 07:30
const MIN = 60000;

// Dates as plain Y-M-D (no time zone), the same arithmetic as the reviewer's independent count.
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
const plus = (s, n) => { const [y, m, d] = s.split('-').map(Number); return fromUTC(Date.UTC(y, m - 1, d + n)); };
const dow = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const monday = (s) => plus(s, -((dow(s) + 6) % 7));

// 25 days back from `today`, every fourth day not logged, calories that vary.
function buildState(today) {
  const diary = {};
  for (let i = 0; i <= 25; i++) {
    if (i % 4 === 3) continue;
    const d = plus(today, -i), kcal = 1500 + i * 37;
    diary[d] = [
      { id: 'a' + i, food: null, meal: 0, qty: null, unit: null, amt: '', name: 'A', brand: '', kcal: kcal - 400, p: 30 + i, c: 100, f: 20, at: 1 + i },
      { id: 'b' + i, food: null, meal: 2, qty: null, unit: null, amt: '', name: 'B', brand: '', kcal: 400, p: 25, c: 33, f: 11, at: 2 + i }
    ];
  }
  return { v: 1, app: 'fuel', settings: { units: 'lb', theme: 'dark' }, food: { targets: { kcal: 2000, protein: 150, carbs: 220, fat: 70 }, foods: {}, meals: {} }, diary, deleted: { food: {}, foods: {}, meals: {} }, bodyweight: [], moved: null };
}
// What Trends must show on `today`: the 14 days, and the table (this week counts full days only; days logged counts today).
function expected(st, today) {
  const tot = (d) => (st.diary[d] ? st.diary[d].reduce((t, e) => ({ kcal: t.kcal + e.kcal, p: t.p + e.p, c: t.c + e.c, f: t.f + e.f }), { kcal: 0, p: 0, c: 0, f: 0 }) : null);
  const avg = (days) => { const g = days.map(tot).filter(Boolean); if (!g.length) return null; const s = g.reduce((t, x) => ({ kcal: t.kcal + x.kcal, p: t.p + x.p, c: t.c + x.c, f: t.f + x.f }), { kcal: 0, p: 0, c: 0, f: 0 }); return { kcal: s.kcal / g.length, p: s.p / g.length, c: s.c / g.length, f: s.f / g.length }; };
  const fmt = (x) => (x == null ? '–' : Math.round(x).toLocaleString('en-US'));
  const m = monday(today), thisWeek = [0, 1, 2, 3, 4, 5, 6].map((i) => plus(m, i)).filter((d) => d <= today), lastWeek = [0, 1, 2, 3, 4, 5, 6].map((i) => plus(m, i - 7));
  const a = avg(thisWeek.filter((d) => d < today)), b = avg(lastWeek);
  const days = []; for (let i = 13; i >= 0; i--) days.push(plus(today, -i));
  return { days, rows: [['Calories / 2,000', fmt(a && a.kcal), fmt(b && b.kcal)], ['Protein / 150 g', fmt(a && a.p), fmt(b && b.p)], ['Carbs / 220 g', fmt(a && a.c), fmt(b && b.c)], ['Fat / 70 g', fmt(a && a.f), fmt(b && b.f)],
    ['Days logged', thisWeek.filter((d) => st.diary[d]).length + ' of ' + thisWeek.length, lastWeek.filter((d) => st.diary[d]).length + ' of 7']] };
}
const SUN = lib.dayKey(SUNDAY_LATE, TZ), MON = plus(SUN, 1);
const STATE = buildState(SUN);

// What the Trends screen shows, and a mark on the drawn chart: a new draw replaces the chart, and the mark with it.
const read = (page) => page.evaluate(() => ({
  days: [...document.querySelectorAll('.trend-day')].map((g) => g.dataset.d),
  rows: [...document.querySelectorAll('.trend-table tbody tr')].map((r) => [...r.cells].map((x) => x.textContent.trim())),
  same: !!(document.querySelector('.trend-chart') || {}).__mark
}));
const mark = (page) => page.evaluate(() => { document.querySelector('.trend-chart').__mark = true; });
async function trendsAt(browser, server, now) {
  const phone = await lib.newPhone(browser, { now, timezoneId: TZ });
  await lib.seedStorage(phone.context, { 'fuel.state.v1': STATE, 'fuel.theme': 'dark' });
  const page = await F.open(phone, server);
  await lib.openTab(page, 'trends');
  await mark(page);
  return { phone, page };
}

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    const want = { sun: expected(STATE, SUN), mon: expected(STATE, MON) };
    need(SUN === '2026-11-08' && dow(SUN) === 0, 'the test clock is not on a Sunday: ' + SUN);

    // ---------------------------------------------------------------- left open over midnight
    {
      const step = (t, fn) => run.step('left open past midnight', t, fn);
      const { phone, page } = await trendsAt(browser, server, SUNDAY_LATE);
      await step('Sunday 23:50: Trends ends on Sunday, the week is the one that ends today', async () => {
        const got = await read(page);
        same(got.days, want.sun.days, 'the days of the chart');
        same(got.rows, want.sun.rows, 'the table');
        return 'last bar ' + got.days[13] + '; ' + got.rows[4].join(' | ');
      });
      await step('on the same date it is not drawn again by itself', async () => {
        await page.clock.runFor(5 * MIN);   // 23:55
        need((await read(page)).same, 'the chart was drawn again although the date did not change');
        return 'five minutes, one draw';
      });
      await step('within a minute after midnight it is drawn for Monday', async () => {
        await page.clock.runFor(6 * MIN);   // 00:01
        const got = await read(page);
        same(got.days, want.mon.days, 'the days of the chart');
        same(got.rows, want.mon.rows, 'the table');
        need((await F.screen(page)) === 'trends', 'the screen is ' + (await F.screen(page)));
        return 'last bar ' + got.days[13] + '; this week ' + got.rows[0][1] + ', last week ' + got.rows[0][2] + '; ' + got.rows[4].join(' | ');
      });
      await step('no error', async () => { F.assertClean(phone, 'left open'); });
      await phone.close();
    }

    // ---------------------------------------------------------------- back in the morning
    {
      const step = (t, fn) => run.step('back in the morning', t, fn);
      const { phone, page } = await trendsAt(browser, server, SUNDAY_LATE);
      await step('put away on Sunday night, brought back to the front on Monday: drawn for Monday at once', async () => {
        await F.hide(page);
        await page.clock.setSystemTime(MONDAY_MORNING);   // the night passes; no timer has run since
        await F.show(page);
        const got = await read(page);
        same(got.days, want.mon.days, 'the days of the chart');
        same(got.rows, want.mon.rows, 'the table');
        return 'last bar ' + got.days[13] + ', drawn on the return';
      });
      await step('no error', async () => { F.assertClean(phone, 'back in the morning'); });
      await phone.close();
    }

    // ---------------------------------------------------------------- what holds the redraw
    {
      const step = (t, fn) => run.step('held while busy', t, fn);
      const { phone, page } = await trendsAt(browser, server, SUNDAY_LATE);
      await step('a sheet open over midnight: not drawn under it; drawn once it has closed', async () => {
        await page.evaluate(() => { const L = window.__overload.lib; L.openSheet(L.sheetHeader('A sheet') + '<p>Open over midnight</p>'); });
        await page.clock.runFor(12 * MIN);   // 00:02
        need((await read(page)).same && await F.sheetOpen(page), 'Trends was drawn again under the open sheet');
        await F.closeSheet(page);
        await page.clock.runFor(MIN + 1000);
        const got = await read(page);
        same(got.days, want.mon.days, 'the days of the chart after the sheet closed');
        return 'held under the sheet, then last bar ' + got.days[13];
      });
      await phone.close();
      const two = await trendsAt(browser, server, SUNDAY_LATE);
      await step('a box with the keyboard: not drawn while it has it', async () => {
        const pg = two.page;
        await pg.evaluate(() => { const i = document.createElement('input'); i.id = 'test-box'; document.body.appendChild(i); i.focus(); });
        await pg.clock.runFor(12 * MIN);
        need((await read(pg)).same && (await pg.evaluate(() => document.activeElement.id)) === 'test-box', 'Trends was drawn again while a box had the keyboard');
        await pg.evaluate(() => document.activeElement.blur());
        await pg.clock.runFor(MIN + 1000);
        same((await read(pg)).days, want.mon.days, 'the days of the chart after the box let go');
        F.assertClean(two.phone, 'held while busy');
        return 'held while typing, then drawn';
      });
      await two.phone.close();
    }

    // ---------------------------------------------------------------- the other screens
    {
      const step = (t, fn) => run.step('other screens', t, fn);
      const phone = await lib.newPhone(browser, { now: SUNDAY_LATE, timezoneId: TZ });
      await lib.seedStorage(phone.context, { 'fuel.state.v1': STATE, 'fuel.theme': 'dark' });
      const page = await F.open(phone, server);
      await step('Settings left open over midnight is not drawn again (a box there could be in use)', async () => {
        await lib.openTab(page, 'trends');
        await lib.openTab(page, 'settings');
        await page.evaluate(() => { document.querySelector('#app .screen-title').__mark = true; });
        await page.clock.runFor(12 * MIN);
        await F.hide(page); await F.show(page);
        need(await page.evaluate(() => !!document.querySelector('#app .screen-title').__mark) && (await F.screen(page)) === 'settings', 'Settings was drawn again');
        F.assertClean(phone, 'other screens');
        return 'Settings untouched';
      });
      await phone.close();
    }
  } catch (e) {
    run.say(false, 'fuel-trends', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
    await server.stop();
  }
  run.done();
})();
