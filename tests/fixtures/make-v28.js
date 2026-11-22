#!/usr/bin/env node
/* Builds the v2.8 data fixtures by using the real v2.8 app for sixteen simulated weeks.
 *
 *   node tests/fixtures/make-v28.js                 all three fixtures, dated from today (America/Los_Angeles)
 *   node tests/fixtures/make-v28.js --today=2026-11-21 --port=8313 --seed=overload-v28 --only=main|small
 *
 * How: the untouched app is served from the repo and opened in Chromium. tests/fixtures/sim-page.js is
 * injected before the app's scripts: it replaces the page's clock and offers window.SIM, a simulated
 * person who taps and types through the app's own event handlers (start workout, tick sets, feedback,
 * finish; search, scan, add and move foods; settings; program; deletions). The page is reloaded every
 * simulated morning, so the app loads, normalizes and saves its data about 113 times on the way.
 * What the app has in localStorage['overload.state.v1'] at the end is the fixture, byte for byte.
 *
 * Written here: v28-state.json, v28-state-active.json, v28-state-small.json, v28-meta.json,
 * v28-facts.json and README.md (the numbers in the last two are read back from the app's screens).
 *
 * Not from the app (said plainly, there are two such things):
 *   - WHOOP nights come through the app's own connector code, but from a connector faked inside the
 *     browser (route.fulfill on a made-up https host; nothing leaves the machine).
 *   - After the last simulated sync the connector link (settings.connUrl, settings.connKey) is deleted
 *     from the state by hand: the real connector is not deployed, and a fixture that carried a link would
 *     make every later test try to call it. The app itself leaves the same shape when a backup is imported
 *     and its connector link is declined. settings.reminders stays, as it does there.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('../lib');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] == null ? true : m[2]] : [a, true]; }));
const TZ = lib.DEFAULT_TZ;
const PORT = Number(args.port) || 8313;
const SEED = String(args.seed || 'overload-v28');
const OUT = path.resolve(args.out || __dirname);
const TODAY = typeof args.today === 'string' ? args.today : lib.dayKey(Date.now(), TZ);
const ONLY = typeof args.only === 'string' ? args.only : '';
const VERBOSE = !!args.verbose;
const CONN = 'https://overload-connector.fixture.workers.dev';   // never contacted: answered inside the browser
const NOW_MINUTES = 17 * 60 + 40;   // the fixtures' "now": 17:40 on the last day

// ---------------------------------------------------------------------------
// Dates in the fixture's time zone
// ---------------------------------------------------------------------------
function tzOffset(ms) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000;
}
function localMidnight(key) { const [y, m, d] = key.split('-').map(Number); const guess = Date.UTC(y, m - 1, d); const t = guess - tzOffset(guess); return guess - tzOffset(t); }
function addDaysKey(key, n) { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function weekday(key) { const [y, m, d] = key.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; }   // Mon=0
function fmtDay(key) { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); }

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const rngFor = (...keys) => mulberry32(hashStr(SEED + '|node|' + keys.join('|')));
const gauss = (r) => (r() + r() + r() + r() - 2) / 0.5774;   // about N(0, 1)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// The plan: who did what on which day. Everything is counted in days before the last day ("ago"),
// so the same story is told whatever day the script runs.
// ---------------------------------------------------------------------------
function buildMain(today) {
  const N = 112;
  const CYCLE = { 0: 'Lower', 1: 'Upper', 2: 'Legs', 3: null, 4: 'Pull', 5: 'Push', 6: null };   // by ago % 7: the last day is a Lower day
  const schedule = Array(7).fill(null);
  for (let c = 0; c < 7; c++) schedule[(weekday(today) - c + 70) % 7] = CYCLE[c];
  const missed = new Set([103, 92, 79, 78, 77, 61, 46, 37, 36, 28, 23, 18, 11]);   // flu at 79-77, a trip at 37-36
  const extra = new Set([94, 59, 31]);                                               // "Arms & Abs" on a rest day
  const noDiary = new Set([112, 78, 36]);
  const noWeighIn = new Set([78, 77, 37, 36, 104, 97, 89, 83, 71, 66, 55, 49, 27, 19, 8]);
  const EV = {}, WEV = {};
  const ev = (ago, when, type, more) => (EV[ago] = EV[ago] || []).push(Object.assign({ when, type }, more || {}));
  const wev = (ago, type, ex, more) => (WEV[ago] = WEV[ago] || []).push(Object.assign({ type, ex }, more || {}));
  const item = (key, unit, q) => ({ key, unit, q });

  // Training
  wev(81, 'swap', 'Lat Pulldown', { to: 'Wide-Grip Lat Pulldown' });
  wev(74, 'skip', 'Face Pull');
  ev(70, 'evening', 'saveTemplate', { name: 'PPL + Upper/Lower v1' });
  ev(70, 'evening', 'replaceInDay', { day: 'Pull', out: 'Seated Cable Row', in: 'T-Bar Row' });
  wev(67, 'addNew', null, { name: 'Machine Preacher Curl (old gym)', muscle: 'Biceps', equipment: 'Machine' });
  wev(65, 'joint2', 'Back Squat');
  wev(60, 'addExisting', null, { name: 'Machine Preacher Curl (old gym)' });
  wev(58, 'skipLastSet', 'Leg Press');
  ev(52, 'afternoon', 'junkWorkout', { day: 'Arms & Abs' });
  ev(51, 'evening', 'deleteWorkout', { day: 'Arms & Abs' });
  wev(47, 'skipLastSet', 'Cable Fly');
  wev(44, 'backoff', 'Back Squat', { drop: 20 });
  ev(40, 'evening', 'deleteExercise', { name: 'Machine Preacher Curl (old gym)' });
  wev(39, 'addSet', 'Lat Pulldown');
  wev(33, 'joint3', 'Seated Dumbbell Shoulder Press');
  wev(32, 'typedNotTicked', 'Hammer Curl');
  ev(30, 'afternoon', 'discardWorkout', { day: 'Upper' });
  wev(26, 'swap', 'Seated Dumbbell Shoulder Press', { to: 'Machine Shoulder Press' });
  wev(26, 'typo', 'Flat Barbell Bench Press', { set: 1, reps: 19 });
  ev(25, 'evening', 'editWorkout', { day: 'Push', ex: 'Flat Barbell Bench Press', wrong: 19 });
  wev(21, 'skip', 'Cable Crunch');
  wev(16, 'swap', 'Lying Leg Curl', { to: 'Seated Leg Curl', after: true });
  wev(14, 'typedNotTicked', 'Seated Calf Raise');
  wev(9, 'backoff', 'Back Squat', { drop: 20 });
  ev(60, 'evening', 'exportBackup'); ev(9, 'evening', 'exportBackup');

  // Body weight and sleep
  ev(40, 'morning', 'deleteWeighIn', { daysBack: 1 });   // 18.6 typed for 186-something the day before
  ev(12, 'morning', 'deleteWeighIn', { daysBack: 1 });
  ev(48, 'morning', 'editNight');
  ev(30, 'morning', 'deleteNight', { daysBack: 1 });
  ev(9, 'morning', 'deleteNight', { daysBack: 1 });
  [63, 42, 17].forEach((a) => ev(a, 'afternoon', 'whoopSyncNow'));

  // Food
  ev(108, 'noon', 'saveMeal', { meal: 0, name: 'Usual breakfast' });
  ev(100, 'evening', 'addItem', { meal: 2, item: item('lasagna', 'srv', 1) });
  ev(95, 'morning', 'addItem', { meal: 0, item: item('sourdough', 'srv', 2) });
  ev(90, 'evening', 'saveMeal', { meal: 3, name: 'Post-workout shake' });
  ev(85, 'afternoon', 'addItem', { meal: 3, item: item('cookie', 'srv', 1) });
  ev(66, 'afternoon', 'addItem', { meal: 3, item: item('qMacros'), note: 'quick add with macros only' });
  ev(62, 'evening', 'renameMeal', { from: 'Post-workout shake', to: 'Shake + banana' });
  ev(58, 'noon', 'saveMeal', { meal: 1, name: 'Chicken rice bowl' });
  ev(45, 'afternoon', 'addItem', { meal: 3, item: item('questBar', 'srv', 1) });
  ev(45, 'evening', 'fixLabel', { key: 'questBar', kcal: 190, f: 8 });
  ev(39, 'noon', 'copyToToday', { meal: 1 });
  ev(38, 'afternoon', 'addItem', { meal: 3, item: item('cake', 'srv', 1) });
  ev(35, 'evening', 'unstar', { key: 'rice' });
  ev(34, 'afternoon', 'addItem', { meal: 3, item: item('cake', 'srv', 1) });
  ev(31, 'afternoon', 'addItem', { meal: 3, item: item('qZero'), note: 'quick add with 0 kcal' });
  ev(30, 'evening', 'forgetFood', { key: 'cake' });
  ev(20, 'noon', 'trimMeal', { name: 'Chicken rice bowl' });
  [72, 55, 41, 29, 15, 6, 2].forEach((a) => ev(a, 'evening', 'deleteEntry'));
  [48, 19].forEach((a) => ev(a, 'morning', 'clearMeal'));
  [[97, 3, 2], [81, 3, 1], [64, 2, 3], [43, 3, 0], [22, 1, 2], [5, 3, 2]].forEach(([a, from, to]) => ev(a, 'evening', 'moveByButton', { from, to }));
  [83, 69, 50, 33, 14, 4].forEach((a) => ev(a, 'evening', 'editAmount'));
  [[88, 'iceCream', '1 serving', 1, 2], [57, 'premier', 'srv', 1, 3], [24, 'almonds', 'g', 28, 3]].forEach(([a, k, u, q, meal]) => ev(a, 'morning', 'backfill', { meal, item: item(k, u, q) }));
  const drags = { 74: { kind: 'toMeal', from: 1, to: 0 }, 52: { kind: 'reorder', from: 1 }, 21: { kind: 'toMeal', from: 1, to: 0 }, 3: { kind: 'reorder', from: 1 } };
  const forced = { 108: { breakfast: 'oats', full: true }, 90: { snacks: 'shake' }, 58: { lunch: 'bowl', full: true }, 39: { lunch: 'none' }, 37: { lunch: 'out', dinner: 'takeout' }, 35: { lunch: 'out', dinner: 'takeout' }, 45: { dinner: 'salmon' }, 0: { breakfast: 'oats', lunch: 'bowl' } };

  const days = [];
  for (let i = 0; i <= N; i++) {
    const ago = N - i, key = addDaysKey(today, -ago), r = rngFor('day', i);
    const d = { i, key, ago, wd: weekday(key), t0: localMidnight(key), events: EV[ago] || [], diary: !noDiary.has(ago), whoop: ago <= 70, form: Math.round((r() - 0.5) * 100) / 100 };
    if (ago >= 72 && ago <= 76) d.form -= 1.2;                       // back from the flu
    if (i === 0) d.setup = true;
    if (ago === 111) d.setTargets = { kcal: 2400, protein: 190, carbs: 240, fat: 75 };
    if (ago === 44) d.copyDay = true;
    if (forced[ago]) d.food = forced[ago];
    if (drags[ago]) d.drag = drags[ago];
    d.extraItems = d.events.filter((e) => e.type === 'addItem' || e.type === 'copyToToday').length * 2;
    // Body weight: 192.6 lb drifting down to about 183.5, most mornings.
    if (!noWeighIn.has(ago)) d.bw = Math.round((192.6 - 0.081 * i + 0.5 * Math.sin(i / 3.1) + 0.55 * gauss(r)) * 10) / 10;
    if (ago === 41) d.bwTypo = Math.round(d.bw) / 10;
    // Sleep. Typed in for the first six weeks, from the WHOOP band after that.
    const total = Math.round(clamp(425 + 42 * gauss(r), 305, 545)), rem = Math.round(total * (0.19 + 0.06 * r())), deep = Math.round(total * (0.15 + 0.06 * r()));
    const sl = { total, rem, deep, light: total - rem - deep, recovery: Math.round(clamp(60 + (total - 425) / 3 + 17 * gauss(r), 14, 97)), rhr: Math.round(clamp(53 + 2.5 * gauss(r), 47, 61)), hrv: Math.round(clamp(66 + 11 * gauss(r), 38, 98)), perf: Math.round(clamp(84 + (total - 425) / 6 + 6 * gauss(r), 55, 100)) };
    sl.band = ago <= 74 && ![58, 36, 10].includes(ago);           // the band has a night for this date
    sl.withhold = [63, 42, 17].includes(ago);                      // ...but it reaches the phone only in the afternoon
    const x = r();
    if (ago > 70) sl.typed = [78, 36].includes(ago) ? false : x < 0.6 ? 'full' : x < 0.8 ? 'total' : false;
    else sl.typed = sl.withhold || ago === 10 ? 'full' : ago === 58 ? 'total' : false;
    if (sl.withhold) { sl.typedTotal = Math.round(total / 5) * 5; }
    if (ago === 0) { sl.recovery = 71; }                           // green today
    if (ago === 20) { sl.recovery = 29; }                          // one red morning
    d.sleep = sl;
    // Training
    const name = extra.has(ago) ? 'Arms & Abs' : missed.has(ago) ? null : CYCLE[ago % 7];
    if (name) {
      const special = WEV[ago] || EV[ago] || ago === 0 || i === 0;
      const early = !special && r() < 0.12;
      d.workout = { day: name, at: ago === 0 ? NOW_MINUTES - 60 : early ? 365 + Math.round(r() * 20) : 1005 + Math.round(r() * 50), events: WEV[ago] || [] };
      if (ago === 54) d.workout.deload = 'start';
      if (ago === 53) d.workout.deload = 'toggle';
      const c = r();
      d.workout.cardio = ago === 60 ? 'harder' : ago === 27 ? 'short' : c < 0.17 && ago !== 0 && i !== 0 ? false : true;
    }
    days.push(d);
  }
  return { mode: 'main', seed: SEED, start: days[0].t0 + 330 * 60000, schedule, days, N };
}

// The light user: twelve days, the app's default program and settings, three workouts, four food days.
function buildSmall(today) {
  const N = 12, days = [];
  const item = (key, unit, q) => ({ key, unit, q });
  const workouts = { 9: 'Chest & Back', 5: 'Legs', 2: 'Shoulders & Arms' };
  const food = {
    6: { 0: [item('eggs', '1 large', 3), item('bread', '1 slice', 2), item('coffee', '1 cup', 1)], 1: [item('chicken', 'g', 150), item('rice', '1 cup', 1)], 2: [item('qPizza')] },
    3: { 0: [item('oats', 'g', 60), item('banana', '1 medium', 1)], 1: [item('tuna', '1 can drained', 1), item('bread', '1 slice', 2), item('apple', '1 medium', 1)], 3: [item('questBar', 'srv', 1)] },
    1: { 0: [item('eggs', '1 large', 3), item('bread', '1 slice', 2)], 2: [item('salmon', 'g', 170), item('rice', '1 cup', 1.5), item('broccoli', 'g', 120)], 3: [item('almonds', 'g', 28)] },
    0: { 0: [item('oats', 'g', 60), item('banana', '1 medium', 1), item('coffee', '1 cup', 1)], 1: [item('chicken', 'g', 170), item('rice', '1 cup', 1), item('apple', '1 medium', 1)] }
  };
  const weigh = { 12: 171.4, 9: 171.0, 5: 170.6, 2: 170.9, 0: 170.2 }, slept = { 9: [412, 'total'], 2: [455, 'full'], 0: [431, 'full'] };
  for (let i = 0; i <= N; i++) {
    const ago = N - i, key = addDaysKey(today, -ago);
    const d = { i, key, ago, wd: weekday(key), t0: localMidnight(key), events: [], diary: !!food[ago], whoop: false, form: 0, items: food[ago] || null };
    if (weigh[ago]) d.bw = weigh[ago];
    if (slept[ago]) { const t = slept[ago][0]; d.sleep = { total: t, rem: Math.round(t * 0.22), deep: Math.round(t * 0.17), typed: slept[ago][1] }; } else d.sleep = { typed: false };
    if (workouts[ago]) d.workout = { day: workouts[ago], at: 1080, events: [], cardio: ago === 9, noWarmup: ago !== 5 };
    days.push(d);
  }
  return { mode: 'small', seed: SEED + '|small', start: days[0].t0 + 330 * 60000, schedule: null, days, N };
}

// ---------------------------------------------------------------------------
// Running a plan in the browser
// ---------------------------------------------------------------------------
async function runPlan(browser, server, cfg, snapshots) {
  const phone = await lib.newPhone(browser, { colorScheme: 'dark', timezoneId: TZ });
  const { context } = phone;
  const stub = { i: 0, released: false, on: false, calls: 0 };
  // The connector, faked inside the browser. connector.json names it from the day the band arrives.
  await context.route('**/connector.json*', (route) => (stub.on ? route.fulfill({ json: { url: CONN } }) : route.continue()));
  await context.route(CONN + '/**', (route) => {
    const req = route.request(), u = new URL(req.url()), cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT' };
    const json = (body, status) => route.fulfill({ status: status || 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    stub.calls++;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname === '/status') return json({ whoop: { connected: true, ready: true, name: 'Fixture', since: '2026-01-01T00:00:00Z' }, cfg: null });
    if (u.pathname === '/whoop/sleep') {
      const n = Number(u.searchParams.get('days')) || 3, nights = [];
      for (let j = stub.i; j > stub.i - n && j >= 0; j--) {
        const d = cfg.days[j], s = d.sleep;
        if (!s || !s.band || (j === stub.i && s.withhold && !stub.released)) continue;
        nights.push({ end: new Date(d.t0 + 365 * 60000).toISOString(), total: s.total, rem: s.rem, deep: s.deep, light: s.light, recovery: s.recovery, rhr: s.rhr, hrv: s.hrv, performance: s.perf });
      }
      return json({ nights });
    }
    if (u.pathname === '/config' || u.pathname === '/claim') return json({});
    return json({ error: 'not-found' }, 404);
  });
  // In-page config: the typed sleep of a "withheld" morning is what he remembered, rounded.
  const pageCfg = JSON.parse(JSON.stringify(cfg));
  pageCfg.days.forEach((d) => { if (d.sleep && d.sleep.typedTotal) d.sleep = Object.assign({}, d.sleep, { total: d.sleep.typedTotal, rem: Math.round(d.sleep.rem / 5) * 5, deep: Math.round(d.sleep.deep / 5) * 5 }); });
  await context.addInitScript((c) => { if (window.top === window) window.__SIM_CFG = c; }, pageCfg);
  await context.addInitScript({ path: path.join(__dirname, 'sim-page.js') });

  const page = await context.newPage();
  page.on('download', (dl) => { dl.cancel().catch(() => {}); });
  const ready = () => page.waitForFunction(() => !!(window.__overload && window.__overloadFood && window.__overloadConn && window.SIM), null, { timeout: 20000 });
  const notes = { log: [], dialogs: [] };
  const drain = async () => { const x = await page.evaluate(() => (window.SIM ? { log: window.SIM.log.splice(0), dialogs: window.SIM.dialogs.splice(0), now: window.SIM.clock.now() } : { log: [], dialogs: [], now: 0 })); notes.log.push(...x.log); notes.dialogs.push(...x.dialogs); return x.now; };
  // Reload the app at a time of the simulated day (never earlier than the page's clock already is).
  const wake = async (ms) => {
    const now = await drain();
    if (now > ms) throw new Error('The simulated clock (' + new Date(now).toISOString() + ') is already past ' + new Date(ms).toISOString());
    await page.evaluate((t) => sessionStorage.setItem('__sim.now', String(t)), ms); await page.reload({ waitUntil: 'load' }); await ready();
  };
  const sim = (fn, ...a) => page.evaluate(([fn, a]) => window.SIM[fn](...a), [fn, a]);
  const stored = () => page.evaluate(() => localStorage.getItem('overload.state.v1'));
  const check = (where) => { const p = phone.problems(); if (p.length) throw new Error('Errors in the page ' + where + ':\n  ' + p.join('\n  ')); };

  await page.goto(server.url + '/index.html', { waitUntil: 'load' });
  await ready();
  const out = {}, t0 = Date.now();
  const last = cfg.days[cfg.days.length - 1];
  for (const d of cfg.days) {
    const r = rngFor('wake', cfg.mode, d.i);
    stub.i = d.i; stub.released = false; stub.on = !!d.whoop;
    await wake(d.t0 + (340 + Math.round(r() * 20)) * 60000);
    await sim('morning', d.i);
    if (d.drag) {
      const plan = await sim('dragPlan', d.i, d.drag);
      if (!plan) console.log('  day ' + d.i + ': drag skipped (rows not on screen)');
      else {
        await page.mouse.move(plan.from.x, plan.from.y); await page.mouse.down();
        await page.mouse.move(plan.from.x, plan.from.y + (plan.to.y > plan.from.y ? 14 : -14), { steps: 3 });
        await page.mouse.move(plan.to.x, plan.to.y, { steps: 12 });
        await page.mouse.up(); await page.waitForTimeout(480);
        if (!(await sim('dragCheck', d.i, plan))) throw new Error('day ' + d.i + ': the dragged food did not move');
      }
    }
    stub.released = true;
    await sim('afternoon', d.i);
    if (d !== last) await sim('evening', d.i);
    check('on day ' + d.i + ' (' + d.key + ')');
    if (VERBOSE || d.i % 14 === 0) console.log('  ' + cfg.mode + ' day ' + String(d.i).padStart(3) + ' ' + d.key + '  ' + Math.round((Date.now() - t0) / 1000) + ' s  ' + Math.round((await stored()).length / 1024) + ' KB');
  }
  // The last day stops at 17:10: nothing in progress. Then the two snapshots.
  const snap = async (name, minutes) => {
    await wake(last.t0 + minutes * 60000);
    const a = await stored();
    await page.reload({ waitUntil: 'load' }); await ready();
    const b = await stored();
    if (a !== b) throw new Error(name + ': the app changed its saved data on a plain reload');
    out[name] = a;
  };
  if (cfg.days.some((d) => d.whoop)) { stub.on = false; await sim('dropConnector'); }
  await snap('main', NOW_MINUTES - 62);
  if (snapshots.includes('active')) {
    await wake(last.t0 + (NOW_MINUTES - 61) * 60000);
    out.half = await sim('startHalf', last.i);
    await snap('active', NOW_MINUTES);
  }
  check('at the end');
  out.backup = JSON.parse(await page.evaluate(() => localStorage.getItem('overload.backup')));
  out.keys = Object.keys(await lib.readStorage(page));
  await drain();
  out.log = notes.log; out.dialogs = notes.dialogs;
  out.blocked = [...new Set(phone.blocked.map((u) => new URL(u).origin))];
  out.stubCalls = stub.calls;
  await phone.close();
  return out;
}

// ---------------------------------------------------------------------------
// Counting what a fixture holds, and reading what the v2.8 app shows for it
// ---------------------------------------------------------------------------
function countState(text) {
  const st = JSON.parse(text);
  const done = st.workouts.filter((w) => w.finishedAt);
  const sets = (w) => w.entries.reduce((n, en) => n + en.sets.filter((s) => s.done && s.reps > 0).length, 0);
  const entries = Object.values(st.diary).flat();
  const foods = Object.values(st.food.foods);
  const perDay = Object.values(st.diary).map((l) => l.length);
  const exIds = new Set(st.exercises.map((e) => e.id));
  const dates = done.map((w) => w.date).sort();
  return {
    bytes: Buffer.byteLength(text, 'utf8'), chars: text.length,
    exercises: st.exercises.length, customExercises: st.exercises.filter((e) => e.custom).length,
    exercisesWithOverrides: st.exercises.filter((e) => e.increment || e.repMin || e.restSec || e.notes).length,
    programDays: st.program.days.length, scheduledDays: st.program.schedule.filter(Boolean).length, templates: st.templates.length,
    workouts: st.workouts.length, finishedWorkouts: done.length, activeWorkout: !!st.active,
    firstWorkout: dates[0] || null, lastWorkout: dates[dates.length - 1] || null,
    deloadWorkouts: done.filter((w) => w.deload).length, workoutsWithCardio: done.filter((w) => w.cardio && w.cardio.done).length,
    exerciseEntries: done.reduce((n, w) => n + w.entries.length, 0), sets: done.reduce((n, w) => n + sets(w), 0),
    setsNotDone: done.reduce((n, w) => n + w.entries.reduce((m, en) => m + en.sets.filter((s) => !s.done).length, 0), 0),
    setsTickedWithoutTyping: done.reduce((n, w) => n + w.entries.reduce((m, en) => m + en.sets.filter((s) => s.auto).length, 0), 0),
    setsWithRir: done.reduce((n, w) => n + w.entries.reduce((m, en) => m + en.sets.filter((s) => s.rir != null).length, 0), 0),
    entriesWithWarmups: done.reduce((n, w) => n + w.entries.filter((en) => en.warmups && en.warmups.length).length, 0),
    entriesWithFeedback: done.reduce((n, w) => n + w.entries.filter((en) => en.pump != null || en.joint != null || en.workload != null).length, 0),
    entriesWithPrs: done.reduce((n, w) => n + w.entries.filter((en) => en.prs && en.prs.length).length, 0),
    workoutsWithPrs: done.filter((w) => w.entries.some((en) => en.prs && en.prs.length)).length,
    swappedEntries: done.reduce((n, w) => n + w.entries.filter((en) => en.swappedFrom).length, 0),
    entriesOfDeletedExercises: done.reduce((n, w) => n + w.entries.filter((en) => !exIds.has(en.exId)).length, 0),
    prescriptions: Object.keys(st.presc).length,
    bodyWeightDays: st.bodyweight.length, nights: st.sleep.length, nightsFromWhoop: st.sleep.filter((n) => n.src === 'whoop').length,
    nightsTypedWithRecovery: st.sleep.filter((n) => n.src !== 'whoop' && n.recovery != null).length, nightsTypedOnly: st.sleep.filter((n) => n.src !== 'whoop' && n.recovery == null).length,
    foodDays: Object.keys(st.diary).length, foodEntries: entries.length, minEntriesADay: perDay.length ? Math.min(...perDay) : 0, maxEntriesADay: perDay.length ? Math.max(...perDay) : 0,
    quickAddEntries: entries.filter((e) => !e.food && e.qty == null).length, entriesInMl: entries.filter((e) => e.unit === 'ml' || e.unit === 'floz').length,
    entriesOfDeletedFoods: entries.filter((e) => e.food && !st.food.foods[e.food]).length,
    entriesWithFractionalAt: entries.filter((e) => e.at !== Math.round(e.at)).length,
    savedFoods: foods.length, customFoods: foods.filter((f) => f.src === 'custom').length, customFoodsWithBarcode: foods.filter((f) => f.src === 'custom' && f.barcode).length,
    correctedListedFoods: foods.filter((f) => f.src === 'custom' && /^[uo]\d/.test(f.id)).length,
    foodsWithBarcode: foods.filter((f) => f.barcode).length, liquidFoods: foods.filter((f) => f.liquid).length, favourites: foods.filter((f) => f.fav).length,
    savedMeals: Object.keys(st.food.meals).length, targets: st.food.targets,
    deleted: { food: Object.keys(st.deleted.food).length, bw: Object.keys(st.deleted.bw).length, sleep: Object.keys(st.deleted.sleep).length, workouts: Object.keys(st.deleted.workouts).length },
    settings: st.settings, topLevelKeys: Object.keys(st)
  };
}

// Opens the fixture in a fresh phone with the clock at its "now" and reads numbers off the screens.
async function readFacts(browser, server, name, text, meta, foodDaysAgo, exercises) {
  const phone = await lib.newPhone(browser, { colorScheme: 'dark', timezoneId: TZ, now: meta.now });
  await lib.seedV28(phone.context, { text, state: JSON.parse(text), meta });
  const page = await lib.openApp(phone.context, server.url + '/index.html');
  const facts = { roundTrip: (await lib.readStorageText(page, lib.STATE_KEY)) === text };
  facts.today = await page.evaluate(() => {
    const t = (sel, root) => { const e = (root || document).querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
    const active = !!document.querySelector('[data-action="finish-workout"]');
    return { title: t('.screen-title h1'), sub: t('.screen-title .sub'), activeWorkout: active, streakBanner: t('.banner'), checkin: t('#app .card b') && [...document.querySelectorAll('#app .card')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).find((x) => /^Morning check-in/.test(x)) || null,
      dayCard: active ? null : t('.card.flat h2'), dayMeta: active ? null : t('.card.flat .meta'),
      plan: active ? null : [...document.querySelectorAll('.card.flat .list .list-item')].map((b) => ({ name: t('.title', b), text: t('.sub', b) })),
      lastWorkout: t('p.muted.small.center') };
  });
  if (facts.today.activeWorkout) {
    facts.active = await page.evaluate(() => {
      const w = window.__overload.state.workouts.find((x) => x.id === window.__overload.state.active);
      return { title: document.querySelector('.screen-title h1').textContent, sub: document.querySelector('.screen-title .sub').textContent.replace(/\s+/g, ' ').trim(), exercises: w.entries.length, exercisesDone: w.entries.filter((e) => e.done).length, sets: w.entries.reduce((n, e) => n + e.sets.length, 0), setsTicked: w.entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0), foldedCards: document.querySelectorAll('.ex-card.compact').length, openCards: document.querySelectorAll('.ex-card:not(.compact)').length };
    });
  }
  // Food days, as the Food tab shows them.
  await lib.openTab(page, 'food');
  const readFood = () => page.evaluate(() => {
    const t = (sel, root) => { const e = (root || document).querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
    const day = window.__overloadFood._.fu.drawn;
    return { date: day, label: t('.f-daylabel'), kcal: t('.f-big'), kcalLine: t('.f-kcal > div:first-child'), left: t('.f-left'),
      protein: t('.f-macros .f-macro:nth-child(1) .v'), carbs: t('.f-macros .f-macro:nth-child(2) .v'), fat: t('.f-macros .f-macro:nth-child(3) .v'),
      meals: [...document.querySelectorAll('.f-meal')].map((c) => ({ name: t('h2', c), kcal: t('.f-meal-head .muted', c) || '', foods: c.querySelectorAll('.f-row[data-id]').length })),
      entries: document.querySelectorAll('.f-meal .f-row[data-id]').length };
  });
  facts.foodDays = [];
  let at = 0;
  for (const ago of foodDaysAgo) {
    for (; at < ago; at++) await page.click('[data-action="food-day"][data-d="-1"]');
    facts.foodDays.push(Object.assign({ daysAgo: ago }, await readFood()));
  }
  await page.click('[data-action="food-day"][data-d="0"]');
  await page.click('[data-action="food-add"][data-meal="3"]');
  facts.addSheet = await page.evaluate(() => {
    const groups = {}; let g = null;
    [...document.querySelectorAll('#food-results > *')].forEach((n) => { if (n.classList.contains('group-title')) { g = n.textContent.trim(); groups[g] = 0; } else if (g && n.classList.contains('f-row')) groups[g]++; });
    return { title: document.querySelector('#sheet .sheet-title h2').textContent, groups, favourites: [...document.querySelectorAll('#food-results .f-favmark')].map((m) => m.parentNode.textContent.replace('★', '').trim()) };
  });
  await page.click('#sheet .sheet-title [data-action="sheet-close"]');
  // Training: next time for a few exercises, and History.
  await lib.openTab(page, 'exercises');
  facts.exercises = await page.evaluate((names) => names.map((name) => { const b = [...document.querySelectorAll('#app .list-item')].find((x) => x.querySelector('.title').textContent === name); return { name, line: b ? b.querySelector('.sub').textContent.replace(/\s+/g, ' ').trim() : null }; }), exercises);
  facts.exercises.forEach((e) => { const st = JSON.parse(text), ex = st.exercises.find((x) => x.name === e.name), p = ex && st.presc[ex.id]; if (p) Object.assign(e, { weight: p.weight, sets: p.sets, goal: p.targetReps, reason: (p.reasons || [])[0] || null }); });
  await lib.openTab(page, 'history');
  facts.history = await page.evaluate(() => {
    const t = (e) => e.textContent.replace(/\s+/g, ' ').trim();
    const stats = [...document.querySelectorAll('#app > .stat-row .stat')].map((s) => ({ k: t(s.querySelector('.k')), v: t(s.querySelector('.v')) }));
    const rows = [...document.querySelectorAll('#app > .list [data-action="view-workout"]')];
    const prs = rows.map((r) => { const m = /🏆 (\d+)/.exec(r.textContent); return m ? +m[1] : 0; });
    const cards = [...document.querySelectorAll('#app > .card')].map((c) => t(c.querySelector('b') || c.querySelector('label') || c));
    return { stats, workoutRows: rows.length, rowsWithPr: prs.filter(Boolean).length, prTotal: prs.reduce((a, b) => a + b, 0), deloadRows: rows.filter((r) => /Deload/.test(r.textContent)).length,
      firstRow: rows[0] ? t(rows[0]) : null, cards, review: t([...document.querySelectorAll('#app > .card')].find((c) => /Weekly review/.test(c.textContent))),
      bodyWeight: (() => { const c = [...document.querySelectorAll('#app > .card')].find((x) => /^Body weight/.test(t(x))); return c ? [...c.querySelectorAll('.stat')].map((s) => ({ k: t(s.querySelector('.k')), v: t(s.querySelector('.v')) })).concat([{ k: 'Pill', v: t(c.querySelector('.pill')) }]) : null; })(),
      sleep: (() => { const c = [...document.querySelectorAll('#app > .card')].find((x) => /^Sleep/.test(t(x))); return c ? { nights: t(c.querySelector('[data-action="sleep-list"]')), stats: [...c.querySelectorAll('.stat')].map((s) => ({ k: t(s.querySelector('.k')), v: t(s.querySelector('.v')) })) } : null; })() };
  });
  if (exercises.length && (await page.$('select[data-field="chart-ex"]'))) {
    const opt = await page.evaluate((name) => { const o = [...document.querySelectorAll('select[data-field="chart-ex"] option')].find((x) => x.textContent === name); return o ? o.value : null; }, exercises[0]);
    if (opt) {
      await page.selectOption('select[data-field="chart-ex"]', opt);
      facts.chart = await page.evaluate((name) => {
        const t = (e) => e.textContent.replace(/\s+/g, ' ').trim();
        const card = document.querySelector('select[data-field="chart-ex"]').closest('.card');
        return { exercise: name, stats: [...card.querySelectorAll('.stat')].map((s) => ({ k: t(s.querySelector('.k')), v: t(s.querySelector('.v')) })), lines: [...card.querySelectorAll('.review-list > div')].map(t), dots: card.querySelectorAll('svg.chart circle.pt').length, recentSessions: card.querySelectorAll('.hist-set').length };
      }, exercises[0]);
    }
  }
  await lib.openTab(page, 'settings');
  facts.settings = await page.evaluate(() => ({ version: (document.querySelector('#app p.tiny.center') || {}).textContent, storage: [...document.querySelectorAll('.toggle-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()).find((x) => /^Storage used/.test(x)) || null, theme: document.documentElement.getAttribute('data-theme') }));
  facts.roundTripAfterUse = (await lib.readStorageText(page, lib.STATE_KEY)) === text;
  phone.assertClean('reading facts for ' + name);
  await phone.close();
  return facts;
}

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------
function readme(all, meta, story) {
  const f = (n) => all[n], c = (n) => f(n).counts, x = (n) => f(n).facts;
  const names = ['v28-state', 'v28-state-active', 'v28-state-small'];
  const row = (label, get) => '| ' + label + ' | ' + names.map((n) => get(c(n), x(n), n)).join(' | ') + ' |';
  const num = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
  const foodLine = (d) => '| ' + d.label + ' | ' + d.date + ' | ' + d.daysAgo + ' | ' + d.kcalLine + (d.left ? ', ' + d.left : '') + ' | ' + d.protein + ' | ' + d.carbs + ' | ' + d.fat + ' | ' + d.entries + ' | ' + d.meals.map((m) => m.name[0] + ' ' + (m.kcal || '–')).join(', ') + ' |';
  const main = x('v28-state'), act = x('v28-state-active'), small = x('v28-state-small');
  const stat = (list, k) => (list.find((s) => s.k.startsWith(k)) || {}).v;
  const L = [];
  L.push('# v2.8 data fixtures');
  L.push('');
  L.push('Generated by `tests/fixtures/make-v28.js`. Do not edit by hand: run the script again.');
  L.push('The numbers on this page are also in `v28-facts.json` (for tests) and `v28-meta.json`.');
  L.push('');
  L.push('- Built on ' + meta.common.generated.slice(0, 10) + ' (UTC) for "today" = **' + fmtDay(meta.common.today) + '** in ' + meta.common.tz + '.');
  L.push('- The fixtures\' "now" is **17:40 that day** (`meta.now` = ' + meta.common.now + ' ms, ' + new Date(meta.common.now).toISOString() + '). In UTC that is already the next day, on purpose.');
  L.push('- Tests give `meta.now` and `meta.tz` to `lib.newPhone`, so the fixture\'s today stays today whenever the test runs. With the real clock the data simply looks older every day.');
  L.push('- Each `.json` is the exact text v2.8 kept in `localStorage["overload.state.v1"]` (one line, no trailing newline). Loaded into v2.8 at `meta.now`, the app writes back the same bytes (`roundTrip` in the facts).');
  L.push('');
  L.push('## The three fixtures');
  L.push('');
  L.push('| | `v28-state.json` | `v28-state-active.json` | `v28-state-small.json` |');
  L.push('| --- | --- | --- | --- |');
  L.push(row('Who', (_, __, n) => (n === 'v28-state' ? 'Heavy user, 16 weeks, nothing in progress' : n === 'v28-state-active' ? 'The same data at the same moment, plus today\'s workout, started at 16:40 and half done' : 'Light user, 12 days, default program and settings')));
  L.push(row('Size in bytes', (k) => num(k.bytes)));
  L.push(row('Finished workouts', (k) => k.finishedWorkouts + (k.firstWorkout ? ' (' + k.firstWorkout + ' to ' + k.lastWorkout + ')' : '')));
  L.push(row('Workout in progress', (k, fx) => (k.activeWorkout ? 'yes: ' + fx.active.title + ', ' + fx.active.setsTicked + ' of ' + fx.active.sets + ' sets ticked, ' + fx.active.exercisesDone + ' of ' + fx.active.exercises + ' exercises finished' : 'no')));
  L.push(row('Sets done (finished workouts)', (k) => num(k.sets)));
  L.push(row('Exercise entries in finished workouts', (k) => num(k.exerciseEntries)));
  L.push(row('Deload workouts', (k) => k.deloadWorkouts));
  L.push(row('Workouts with cardio logged', (k) => k.workoutsWithCardio));
  L.push(row('Entries with a PR / workouts with a PR', (k) => k.entriesWithPrs + ' / ' + k.workoutsWithPrs));
  L.push(row('Swapped-in entries', (k) => k.swappedEntries));
  L.push(row('Entries of a deleted exercise', (k) => k.entriesOfDeletedExercises));
  L.push(row('Entries with warm-ups / with feedback', (k) => k.entriesWithWarmups + ' / ' + k.entriesWithFeedback));
  L.push(row('Sets with RIR / ticked without typing (`auto`) / left unticked', (k) => k.setsWithRir + ' / ' + k.setsTickedWithoutTyping + ' / ' + k.setsNotDone));
  L.push(row('Exercises (custom) / with overrides or notes', (k) => k.exercises + ' (' + k.customExercises + ') / ' + k.exercisesWithOverrides));
  L.push(row('Program days / days of the week with training / templates', (k) => k.programDays + ' / ' + k.scheduledDays + ' / ' + k.templates));
  L.push(row('Body-weight days', (k) => k.bodyWeightDays));
  L.push(row('Nights: all / WHOOP / typed with WHOOP recovery / typed only', (k) => k.nights + ' / ' + k.nightsFromWhoop + ' / ' + k.nightsTypedWithRecovery + ' / ' + k.nightsTypedOnly));
  L.push(row('Food days', (k) => k.foodDays));
  L.push(row('Food entries (fewest to most in a day)', (k) => num(k.foodEntries) + ' (' + k.minEntriesADay + ' to ' + k.maxEntriesADay + ')'));
  L.push(row('Quick-add entries / entries in ml or fl oz', (k) => k.quickAddEntries + ' / ' + k.entriesInMl));
  L.push(row('Entries whose food was deleted later', (k) => k.entriesOfDeletedFoods));
  L.push(row('Entries with a fractional `at` (dragged)', (k) => k.entriesWithFractionalAt));
  L.push(row('Saved foods / with a barcode / drinks', (k) => k.savedFoods + ' / ' + k.foodsWithBarcode + ' / ' + k.liquidFoods));
  L.push(row('Custom foods (`src: custom`) / with a barcode / corrected listed products', (k) => k.customFoods + ' / ' + k.customFoodsWithBarcode + ' / ' + k.correctedListedFoods));
  L.push(row('Favourites', (k) => k.favourites));
  L.push(row('Saved meals', (k) => k.savedMeals));
  L.push(row('Food targets (kcal / protein / carbs / fat)', (k) => (k.targets.kcal ? [k.targets.kcal, k.targets.protein, k.targets.carbs, k.targets.fat].join(' / ') : 'none')));
  L.push(row('Deletion records: food / bw / sleep / workouts', (k) => [k.deleted.food, k.deleted.bw, k.deleted.sleep, k.deleted.workouts].join(' / ')));
  L.push(row('Settings that differ from the defaults', (k) => { const d = meta.common.defaultSettings; const diff = Object.keys(k.settings).filter((s) => JSON.stringify(k.settings[s]) !== JSON.stringify(d[s])); return diff.length ? diff.map((s) => '`' + s + '` ' + (typeof k.settings[s] === 'object' ? '(object)' : JSON.stringify(k.settings[s]))).join(', ') : 'none'; }));
  L.push('');
  L.push('The typed-in custom foods of the main fixture are three (' + story.customTyped.map((n) => '"' + n + '"').join(', ') + '; the last was found by an unknown barcode) plus one listed product whose label was corrected ("' + story.corrected + '": `src: custom` under the product\'s own `u…` id). A fourth typed-in food ("Office birthday cake") was logged twice and then deleted: its entries point at a food id that no longer exists.');
  L.push('');
  L.push('`v28-state-active.json` is the main fixture plus the workout in progress: the same finished workouts, food, weigh-ins and nights. The prescriptions of the exercises already finished in that workout have moved on, and their entries carry `next` and `prevPresc`.');
  L.push('');
  L.push('## Facts to assert');
  L.push('');
  L.push('Read from the v2.8 screens with the clock at `meta.now`. Machine-readable in `v28-facts.json`.');
  L.push('');
  L.push('### Three food days (main fixture; the active one shows the same)');
  L.push('');
  L.push('| Food tab label | Date | Days ago | Calories line | Protein | Carbs | Fat | Entries | Meals (B, L, D, S) |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  main.foodDays.forEach((d) => L.push(foodLine(d)));
  L.push('');
  L.push('Light user: ' + small.foodDays.map((d) => d.label + ' (' + d.date + '): ' + d.kcalLine + ', P ' + d.protein + ', C ' + d.carbs + ', F ' + d.fat + ', ' + d.entries + ' entries').join('; ') + '.');
  L.push('');
  L.push('The add-food sheet of the main fixture lists: ' + Object.keys(main.addSheet.groups).map((g) => g + ' ' + main.addSheet.groups[g]).join(', ') + '.');
  L.push('');
  L.push('### Training (main fixture)');
  L.push('');
  main.exercises.forEach((e) => L.push('- **' + e.name + '**, next time: ' + e.sets + ' sets at **' + e.weight + ' lb**, goal **' + e.goal + '** reps. Exercises tab line: "' + e.line + '". Reason line: "' + e.reason + '".'));
  L.push('- **History**: ' + main.history.stats.map((s) => s.k + ' ' + s.v).join(', ') + '. ' + main.history.workoutRows + ' workout rows, **' + main.history.rowsWithPr + ' of them show a 🏆**, and the 🏆 counts add up to **' + main.history.prTotal + '**; ' + main.history.deloadRows + ' rows are tagged Deload.');
  if (main.chart) L.push('- **Progress chart, ' + main.chart.exercise + '**: ' + main.chart.stats.map((s) => s.k + ' ' + s.v).join(', ') + '; ' + main.chart.lines.join('; ') + '; ' + main.chart.dots + ' dots.');
  L.push('- **Today** (main): "' + main.today.dayCard + '" (' + main.today.dayMeta + '), Start workout offered, streak banner "' + main.today.streakBanner + '". First line of the plan: ' + main.today.plan[0].name + ' — "' + main.today.plan[0].text + '".');
  L.push('- **Today** (active): the workout "' + act.active.title + '" (' + act.active.sub + '), ' + act.active.foldedCards + ' finished exercises folded to one row, ' + act.active.openCards + ' cards open.');
  L.push('- **Body weight card**: ' + main.history.bodyWeight.filter((s) => s.k !== 'Pill').map((s) => s.k + ' ' + s.v).join(', ') + ', ' + stat(main.history.bodyWeight, 'Pill') + '. **Sleep card**: ' + main.history.sleep.nights + ', ' + main.history.sleep.stats.map((s) => s.k + ' ' + s.v).join(', ') + '.');
  L.push('- Light user: History shows ' + small.history.stats.map((s) => s.k + ' ' + s.v).join(', ') + '; Today offers "' + small.today.dayCard + '"' + (small.today.dayCard ? '' : ' (a rest day: the list of days)') + '.');
  L.push('');
  L.push('## What happened in the main fixture, with dates');
  L.push('');
  L.push('The schedule is built around the last day so that it is a training day: ' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => d + ' ' + (meta.common.schedule[i] || 'rest')).join(', ') + '. A sixth day, "Arms & Abs", is in the program but not on the schedule.');
  L.push('');
  L.push('| Date | What |');
  L.push('| --- | --- |');
  story.rows.forEach((r) => L.push('| ' + r[0] + ' | ' + r[1] + ' |'));
  L.push('');
  L.push('## Files');
  L.push('');
  L.push('| File | What |');
  L.push('| --- | --- |');
  L.push('| `v28-state.json`, `v28-state-active.json`, `v28-state-small.json` | The fixtures. |');
  L.push('| `v28-meta.json` | `common` (time zone, today, now, the app\'s default settings, the weekly schedule) and per fixture the `overload.backup` value. `lib.loadFixture(name).meta` merges the two. |');
  L.push('| `v28-facts.json` | Per fixture: `counts` (from the data) and what the v2.8 screens showed (`today`, `foodDays`, `addSheet`, `exercises`, `history`, `chart`, `settings`, `active`). `lib.loadFixture(name).facts`. |');
  L.push('| `v28-story.json` | Everything notable the simulated person did, by date (`log`), and every confirm / prompt the app showed with the answer given (`dialogs`). |');
  L.push('| `make-v28.js`, `sim-page.js` | The generator: Node side (the plan, the fake connector, snapshots, this page) and in-page side (the clock and the simulated person). |');
  L.push('');
  L.push('## Using a fixture in a test');
  L.push('');
  L.push('```js');
  L.push('const lib = require(\'../lib\');                                   // tests/lib.js');
  L.push('const fx = lib.loadFixture(\'v28-state\');                         // { text, state, meta, facts }');
  L.push('const server = await lib.startServer(lib.REPO, 8317);');
  L.push('const browser = await lib.launch();');
  L.push('const phone = await lib.newPhone(browser, { now: fx.meta.now, timezoneId: fx.meta.tz });');
  L.push('await lib.seedV28(phone.context, fx);                             // before the app\'s scripts run, once per context');
  L.push('const page = await lib.openApp(phone.context, server.url + \'/index.html\');');
  L.push('await lib.openTab(page, \'history\');');
  L.push('// ... then compare the screen, or lib.readStorage(page, \'overload.state.v1\'), with fx.state and fx.facts');
  L.push('phone.assertClean();');
  L.push('```');
  L.push('');
  L.push('Regenerate with `node tests/fixtures/make-v28.js` (about two minutes; `--today=YYYY-MM-DD` pins the last day, `--only=small` or `--only=main` builds a part). The same day and seed give the same bytes. Check with `node tests/smoke-v28.js`.');
  L.push('');
  L.push('Built on another day the story is the same (70 workouts, 110 food days, the same events the same number of days before the last day), but some training numbers move a little: the first time v2.8 draws Today it creates prescriptions for the default program\'s exercises of that weekday, with the default goal of 10 reps, before the rep range is changed to 8-12, and which exercises those are depends on the weekday of the first day. Built on a Monday, "this week" holds only the last day, so History\'s weekly review has no workouts in it.');
  L.push('');
  L.push('## Beside the state');
  L.push('');
  L.push('v2.8 keeps two more small keys, which `lib.seedV28` also sets: `overload.theme` (`' + JSON.parse(all['v28-state'].text).settings.theme + '` here) and `overload.backup` (`' + JSON.stringify(meta.fixtures['v28-state'].backup) + '`: first start and last export, in ms). The fixtures have no `overload.sync.v1` (cloud sync never signed in) and no `overload.conn.*`.');
  L.push('');
  L.push('The theme is forced to dark in the main fixtures. For light screens seed with `lib.seedV28(context, fx, { theme: \'light\' })`, or `{ theme: \'system\' }` and a `colorScheme`.');
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
(async () => {
  const started = Date.now();
  console.log('Fixtures for today = ' + TODAY + ' (' + TZ + '), seed "' + SEED + '", into ' + OUT);
  fs.mkdirSync(OUT, { recursive: true });
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  const all = {}, metaPath = path.join(OUT, 'v28-meta.json'), factsPath = path.join(OUT, 'v28-facts.json');
  try {
    const now = localMidnight(TODAY) + NOW_MINUTES * 60000;
    const defaults = await (async () => {   // the app's own default settings, from a first start
      const phone = await lib.newPhone(browser, { timezoneId: TZ, now });
      const page = await lib.openApp(phone.context, server.url + '/index.html');
      const s = (await lib.readStorage(page, lib.STATE_KEY)).settings; await phone.close(); return s;
    })();
    const meta = { common: { generated: new Date().toISOString(), generator: 'tests/fixtures/make-v28.js', appVersion: '2.8', seed: SEED, tz: TZ, today: TODAY, now, nowLocal: TODAY + ' 17:40', defaultSettings: defaults }, fixtures: {} };
    const facts = { generated: meta.common.generated, today: TODAY, fixtures: {} };
    let story = null;
    if (ONLY !== 'small') {
      const cfg = buildMain(TODAY);
      meta.common.schedule = cfg.schedule;
      console.log('Main: ' + cfg.days.length + ' days from ' + cfg.days[0].key + ', ' + cfg.days.filter((d) => d.workout).length + ' workouts planned');
      const res = await runPlan(browser, server, cfg, ['main', 'active']);
      all['v28-state'] = { text: res.main }; all['v28-state-active'] = { text: res.active };
      meta.fixtures['v28-state'] = { backup: res.backup }; meta.fixtures['v28-state-active'] = { backup: res.backup };
      meta.common.otherKeysOnThePhone = res.keys; meta.common.blockedHosts = res.blocked;
      story = { cfg, res };
      console.log('  connector stub answered ' + res.stubCalls + ' calls; hosts blocked: ' + (res.blocked.join(', ') || 'none') + '; dialogs answered: ' + res.dialogs.length);
    }
    if (ONLY !== 'main') {
      const cfg = buildSmall(TODAY);
      console.log('Small: ' + cfg.days.length + ' days from ' + cfg.days[0].key);
      const res = await runPlan(browser, server, cfg, ['main']);
      all['v28-state-small'] = { text: res.main };
      meta.fixtures['v28-state-small'] = { backup: res.backup };
    }
    // Write the states first, then read the facts back from the app.
    for (const n of Object.keys(all)) { fs.writeFileSync(path.join(OUT, n + '.json'), all[n].text); all[n].counts = countState(all[n].text); }
    const exercises = ['Flat Barbell Bench Press', 'Leg Press', 'Dumbbell Lateral Raise', 'Pull-Ups'];
    for (const n of Object.keys(all)) {
      const small = n === 'v28-state-small';
      all[n].facts = await readFacts(browser, server, n, all[n].text, Object.assign({}, meta.common, meta.fixtures[n]), small ? [0, 1, 3] : [0, 1, 30], small ? ['Flat Barbell Bench Press', 'Back Squat'] : exercises);
      if (!all[n].facts.roundTrip) throw new Error(n + ': v2.8 changed the data when it loaded it (round trip failed)');
      facts.fixtures[n] = Object.assign({ counts: all[n].counts }, all[n].facts);
      console.log('  ' + n + ': ' + all[n].counts.bytes + ' bytes, ' + all[n].counts.finishedWorkouts + ' workouts, ' + all[n].counts.foodDays + ' food days, round trip ok');
    }
    if (ONLY) {   // a partial run keeps the other fixtures' entries
      const oldM = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null, oldF = fs.existsSync(factsPath) ? JSON.parse(fs.readFileSync(factsPath, 'utf8')) : null;
      if (oldM && oldM.common.today === TODAY) { meta.fixtures = Object.assign({}, oldM.fixtures, meta.fixtures); if (!meta.common.schedule) Object.assign(meta.common, { schedule: oldM.common.schedule, otherKeysOnThePhone: oldM.common.otherKeysOnThePhone, blockedHosts: oldM.common.blockedHosts }); }
      if (oldF && oldF.today === TODAY) facts.fixtures = Object.assign({}, oldF.fixtures, facts.fixtures);
    }
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    fs.writeFileSync(factsPath, JSON.stringify(facts, null, 2) + '\n');
    if (story) fs.writeFileSync(path.join(OUT, 'v28-story.json'), JSON.stringify({ today: TODAY, log: story.res.log, dialogs: story.res.dialogs }, null, 1) + '\n');
    if (!ONLY) {
      const st = JSON.parse(all['v28-state'].text);
      const rows = buildStory(story.cfg, st);
      const custom = Object.values(st.food.foods).filter((f) => f.src === 'custom');
      fs.writeFileSync(path.join(OUT, 'README.md'), readme(all, meta, { rows, customTyped: custom.filter((f) => !/^[uo]\d/.test(f.id)).map((f) => f.name), corrected: (custom.find((f) => /^[uo]\d/.test(f.id)) || {}).name }));
    }
    console.log('Done in ' + Math.round((Date.now() - started) / 1000) + ' s.');
  } finally {
    await browser.close();
    await server.stop();
  }
})().catch((e) => { console.error('\nFAILED: ' + (e && e.stack || e)); process.exit(1); });

// The dated list for the README: what the plan did on which day (dates from the plan, checked against the state).
function buildStory(cfg, st) {
  const byAgo = (a) => cfg.days[cfg.N - a].key;
  const rows = [];
  const add = (ago, what) => rows.push([byAgo(ago), what, ago]);
  add(112, 'First day: settings changed, the default split saved as the template "Starter split (default)", a 5-day split built (Push, Pull, Legs, Upper, Lower) plus "Arms & Abs", custom exercise "Smith Machine Incline Press" made from the picker, overrides typed for 7 exercises, first workout.');
  add(111, 'Food log starts; targets set from the Food screen.');
  add(108, 'Breakfast saved as the meal "Usual breakfast".');
  add(100, 'Custom food "Mom\'s lasagna" (a serving with no weight, so it can only be logged in servings).');
  add(95, 'Custom food "Sourdough, corner bakery" (serving with a weight, so also in g and oz).');
  add(90, 'Snacks saved as the meal "Post-workout shake" (renamed "Shake + banana" ' + byAgo(62) + ').');
  add(85, 'Barcode 850031234567 typed in, not in the list, Open Food Facts not reachable: typed from the label, saved as `b0850031234567`.');
  add(81, 'Lat Pulldown swapped for Wide-Grip Lat Pulldown for the day (`swappedFrom`).');
  add(79, 'Flu: three scheduled workouts missed (' + byAgo(79) + ' to ' + byAgo(77) + '), no food log on ' + byAgo(78) + '.');
  add(70, 'Template "PPL + Upper/Lower v1" saved, then Seated Cable Row replaced by T-Bar Row in Pull. The WHOOP band arrives: nights come from the (faked) connector from here on. Of the four nights before it (' + byAgo(74) + ' to ' + byAgo(71) + '), those typed by hand get recovery added and the others arrive as WHOOP nights.');
  add(67, '"Machine Preacher Curl (old gym)" made from + Exercise in a workout, used again ' + byAgo(60) + ', deleted ' + byAgo(40) + ': its two entries show as "Deleted exercise".');
  add(58, 'Lunch saved as the meal "Chicken rice bowl" (its olive oil dropped from the saved meal ' + byAgo(20) + ').');
  add(54, 'Deload workout started with "Start as deload". Next day (' + byAgo(53) + ') a second one switched to deload after the first exercise was finished.');
  add(52, 'One-set "Arms & Abs" workout on a rest day, deleted from History the next day (a `deleted.workouts` record; the curl\'s next-time numbers rolled back).');
  add(48, 'A WHOOP night corrected by hand in the check-in (it loses `src` and `light`, keeps recovery).');
  add(45, 'Quest Bar label corrected with "Numbers wrong? Fix them": the food keeps its id `u1903553`, now `src: custom`.');
  add(44, 'Empty day filled with "Copy yesterday".');
  add(41, 'Weigh-in typed as 18.x instead of 18x.x; deleted the next morning (`deleted.bw`). The weigh-in of ' + byAgo(13) + ' deleted ' + byAgo(12) + '.');
  add(39, 'Yesterday\'s lunch copied to today from the meal menu.');
  add(38, '"Office birthday cake" typed in and logged, logged again ' + byAgo(34) + ', the food deleted ' + byAgo(30) + ' (its two entries keep their numbers and a dangling `food` id).');
  add(37, 'A trip: two workouts missed, restaurant quick adds, no food log on ' + byAgo(36) + '.');
  add(33, 'Seated Dumbbell Shoulder Press: joint pain "A lot" (weight dropped by the app). Next Push day (' + byAgo(26) + ') it is swapped for Machine Shoulder Press.');
  add(30, 'Wrong day (Upper) started and discarded (`deleted.workouts`). The WHOOP night of ' + byAgo(31) + ' deleted (`deleted.sleep`); the typed night of ' + byAgo(10) + ' deleted ' + byAgo(9) + '.');
  add(26, 'Bench press set typed as 19 reps; corrected the next day with History → Edit sets (trophies and next time worked out again).');
  add(16, 'Lying Leg Curl swapped for Seated Leg Curl after one set: both entries are in the workout.');
  add(9, 'Export JSON (the second one; the first was ' + byAgo(60) + ').');
  add(0, 'The last day: check-in done (WHOOP night, recovery 71%), breakfast, lunch and a snack logged. In the active fixture the Lower workout was started at 16:40.');
  // A few checks that the story is true.
  const has = (cond, what) => { if (!cond) throw new Error('The README story does not match the data: ' + what); };
  has(st.templates.length === 2, 'two templates');
  has(Object.values(st.food.meals).some((m) => m.name === 'Shake + banana'), 'renamed saved meal');
  has(st.food.foods.u1903553 && st.food.foods.u1903553.src === 'custom', 'corrected Quest bar');
  has(st.food.foods.b0850031234567, 'barcode food');
  has(st.workouts.filter((w) => w.deload).length === 2, 'two deloads');
  has(Object.keys(st.deleted.workouts).length === 2, 'two deleted workouts');
  rows.sort((a, b) => b[2] - a[2]);
  return rows.map((r) => [r[0], r[1]]);
}
