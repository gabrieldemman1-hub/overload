#!/usr/bin/env node
/* Fuel 3.0: cloud sync (fuel/sync.js) against the fake Firebase in tests/fake-firebase/.
 *
 *   node tests/fuel-sync.js [--only=account|clipboard|solo] [--app=<folder>] [--port=8430]
 *
 * What must hold (SPEC section 6; dev/notes/sync.md sections 4 and 7):
 *   - Fuel writes only users/{uid}/meta/fuel and users/{uid}/fuelDays/{date}. It never writes or deletes
 *     below meta/state, workouts or foodDays, and never listens there. It reads meta/state and foodDays once,
 *     from the server, at the first sign-in to an account that has no meta/fuel yet.
 *   - That first sign-in, on an account that holds only what v2.8 uploaded (the main fixture): Fuel ends with
 *     the same food days, saved foods, saved meals, favourites and targets, shows the three named days as
 *     v2.8 showed them, and nothing of Overload's settings but units and theme reaches meta/fuel (the
 *     connector's key is in those settings).
 *   - The same first sign-in on a phone that already brought the food log across by Copy my food log, and
 *     went on from there: nothing is duplicated, nothing deleted in Fuel comes back.
 *   - A second Fuel phone: an added, an edited and a deleted entry, a deleted saved food and saved meal, a
 *     changed target and a day that lost its last entry travel both ways, and nothing deleted comes back,
 *     also not when a phone that was offline sends its old copies later.
 *   - Nothing is uploaded while the first server read has not worked.
 *   - Changes made while signed out are sent after signing in again.
 *   - A training app signed in to the same account at the same time (v2.8 in a storage of its own, and this
 *     tree's root app in the same storage as Fuel) is not affected by Fuel and does not affect it.
 *
 * How: every phone is a browser context with its own storage. The apps' files are answered from a folder on
 * disk by a Playwright route (nothing listens on the port), so a phone can be "offline" with its files
 * still there, as with a service worker. v2.8 is taken from git (commit 3b17963) into a temporary folder.
 * The three Firebase SDK files are the stand-ins of tests/fake-firebase/; no outside host is contacted.
 * Signing in and out, and the first logged food, go through Fuel's own screens. The other changes are made
 * in the app's state the way food.js makes them, followed by the app's own save(), which is all cloud sync
 * ever sees of a change.
 *
 *   --app=DIR   another folder to serve as 3.0 (default: the repo this file is in).
 *
 * Prints one PASS or FAIL line per check; exit code 1 when a check failed.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const lib = require('./lib');
const F = require('./fuel-common');
const { createCloud } = require('./fake-firebase/route');

const args = F.args();
const PORT = Number(args.port) || 8430;
const ORIGIN = lib.LOCAL + ':' + PORT;
const TREE = args.app ? path.resolve(String(args.app)) : lib.REPO;
const V28_COMMIT = '3b17963';
const EMAIL = 'owner@example.com', PASSWORD = 'correct horse';
const SECRET = 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00';   // stands in for Overload's settings.connKey

const FUEL_META = 'users/U1/meta/fuel', FUEL_DAYS = 'users/U1/fuelDays';
const OLD_META = 'users/U1/meta/state', OLD_DAYS = 'users/U1/foodDays', WORKOUTS = 'users/U1/workouts';
const FUEL_PATH = /^users\/U\d+\/(meta\/fuel|fuelDays\/\d{4}-\d{2}-\d{2})$/;      // everything Fuel may write
const OVERLOAD_PATH = /^users\/U\d+\/(meta\/state|workouts|foodDays)(\/|$)/;      // everything that is Overload's
const NOTE = 'fuel.sync.v1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };

const run = F.runner('fuel-sync');
const { need, same } = run;
const fx = lib.loadFixture('v28-state');
const NOW = fx.meta.now, TODAY = fx.meta.today, YESTERDAY = '2026-11-20';
const COUNTS = fx.facts.counts;
const DATES = Object.keys(fx.state.diary).sort();

// ---------------------------------------------------------------------------
// Folders and phones
// ---------------------------------------------------------------------------
const temp = [];
process.on('exit', () => temp.splice(0).forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* leave it */ } }));
function extractV28() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overload-v28-')); temp.push(dir);
  execSync('git -C "' + lib.REPO + '" archive ' + V28_COMMIT + ' | tar -x -C "' + dir + '"', { stdio: ['ignore', 'ignore', 'inherit'] });
  if (!fs.existsSync(path.join(dir, 'sync.js'))) throw new Error('could not extract v2.8 (' + V28_COMMIT + ') from git');
  return dir;
}
// Answers the site's address from the folder the phone is on.
async function serveTree(phone) {
  await phone.context.route(ORIGIN + '/**', (route) => {
    let p = decodeURIComponent(new URL(route.request().url()).pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(phone.tree, p);
    let ok = file.startsWith(phone.tree + path.sep);
    try { ok = ok && fs.statSync(file).isFile(); } catch (e) { ok = false; }
    if (!ok) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', headers: { 'cache-control': 'no-store' }, body: fs.readFileSync(file) });
  });
}
/** One phone: its own storage, one device of the fake cloud. opts.seed(context) puts data in before the first page. */
async function makePhone(world, name, tree, opts) {
  const phone = await lib.newPhone(world.browser, { now: NOW, timezoneId: fx.meta.tz });
  Object.assign(phone, { name, tree, pages: [] });
  await serveTree(phone);
  phone.device = await world.cloud.attach(phone.context, name);
  if (opts && opts.clipboard) await phone.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  if (opts && opts.seed) await opts.seed(phone.context);
  world.phones.push(phone);
  return phone;
}
// Fuel, started, with food.js and the sync module in the page. (The remembered sign-in follows a moment later: settle.)
async function openFuel(phone) {
  const page = await lib.openApp(phone.context, ORIGIN + F.PAGE);
  await page.waitForFunction(() => !!window.__overloadFood && !!window.__overloadSync, null, { timeout: 15000 });
  phone.pages.push(page); phone.fuel = page;
  return page;
}
// The training app of the phone's folder (v2.8, or this tree's root app), with its sync module.
async function openOverload(phone) {
  const page = await lib.openApp(phone.context, ORIGIN + '/index.html');
  await page.waitForFunction(() => !!window.__overloadSync, null, { timeout: 15000 });
  phone.pages.push(page); phone.app = page;
  return page;
}
async function closeFuel(phone) { await phone.fuel.close(); phone.pages = phone.pages.filter((p) => !p.isClosed()); phone.fuel = null; }

// Lets the phones and the cloud come to rest: push timers fire (one second after a save), writes arrive, the
// other phones' listeners run, and so on until nothing new is logged. False when they never stop.
async function settle(world) {
  const pages = () => world.phones.reduce((all, p) => all.concat(p.pages.filter((pg) => !pg.isClosed())), []);
  let last = -1, quiet = 0;
  for (let i = 0; i < 40; i++) {
    for (const pg of pages()) await pg.clock.runFor(1100).catch(() => {});
    await world.cloud.idle();
    for (const pg of pages()) await pg.evaluate(() => 0).catch(() => {});
    await world.cloud.idle();
    const n = world.cloud.log.length;
    if (n === last) { if (++quiet >= 2) return true; } else { quiet = 0; last = n; }
  }
  return false;
}
async function rest(world, what) { need(await settle(world), 'the phones never stopped writing to each other ' + (what || '')); }

// ---------------------------------------------------------------------------
// Reading the phones and the cloud
// ---------------------------------------------------------------------------
const list = (ws) => ws.map((w) => w.who + ' ' + w.type + ' ' + w.path.replace(/^users\/U\d+\//, '') + (w.state === 'applied' ? '' : ' (' + w.state + ')'));
const brief = (ws) => { const l = list(ws); return l.length ? l.length + ': ' + l.slice(0, 5).join(', ') + (l.length > 5 ? ', …' : '') : 'none'; };
const coreOfCloud = (cloud) => { const d = cloud.get(FUEL_META); return d ? JSON.parse(d.core) : null; };
const dayOfCloud = (cloud, date) => { const d = cloud.get(FUEL_DAYS + '/' + date); return d ? JSON.parse(d.data) : null; };
const noteOf = async (page) => JSON.parse((await lib.readStorageText(page, NOTE)) || 'null');
// Everything of Overload's in the account, as text: two of these are equal only when nothing changed, byte for byte.
const overloadDocs = (cloud) => JSON.stringify([cloud.snapshot('users/U1/meta/state'), cloud.text(OLD_META), cloud.snapshot(OLD_DAYS), cloud.snapshot(WORKOUTS)]);
// The part of a Fuel state that travels: what two phones on one account must agree on.
const travels = (st) => ({ settings: st.settings, food: st.food, deleted: st.deleted, bodyweight: st.bodyweight, diary: st.diary });
const ids = (list) => (list || []).map((e) => e.id);
const allIds = (diary) => Object.keys(diary).reduce((l, d) => l.concat(ids(diary[d])), []);
// Every write Fuel issued (its Firebase app is named 'fuel') must be to its own two places, whatever became of it.
function onlyFuelPaths(cloud, from) {
  const bad = cloud.writes({ app: 'fuel', from }).filter((w) => !FUEL_PATH.test(w.path));
  need(bad.length === 0, 'Fuel issued a write outside meta/fuel and fuelDays: ' + brief(bad));
}
// And nothing of Fuel's may read Overload's documents (after the one read of the first sign-in).
function noOverloadReads(cloud, from, who) {
  const bad = cloud.reads({ app: 'fuel', from, who }).filter((r) => OVERLOAD_PATH.test(r.path));
  need(bad.length === 0, 'Fuel read or listened to Overload\'s documents: ' + bad.map((r) => r.who + ' ' + r.type + ' ' + r.path + ' via ' + r.via).join(', '));
}

// ---------------------------------------------------------------------------
// What the person does
// ---------------------------------------------------------------------------
// The Cloud sync form, wherever it is (the sheet opened from Welcome, or the card in Settings).
async function useCloudForm(page, button) {
  await page.waitForSelector('#cloud-form');
  await page.fill('#cloud-form [name="email"]', EMAIL);
  await page.fill('#cloud-form [name="password"]', PASSWORD);
  await page.click(button || '#cloud-form button[type="submit"]');
  await page.waitForFunction(() => !!(window.__overloadSync && window.__overloadSync.user), null, { timeout: 8000 });
}
async function signInAtWelcome(page) {
  await page.click('[data-action="fuel-signin"]');
  await page.waitForSelector('#sheet:not([hidden]) #cloud-form');
  await useCloudForm(page);
}
async function signInInSettings(page) { await lib.openTab(page, 'settings'); await useCloudForm(page); }
async function signOutInSettings(page) {
  await lib.openTab(page, 'settings');
  await page.click('[data-action="cloud-signout"]');   // its question is answered yes
  await page.waitForFunction(() => !window.__overloadSync.user, null, { timeout: 8000 });
}
// The changes below are what food.js does to the state for each action, then the app's own save().
const addEntry = (page, date, id, name, kcal, foodId) => page.evaluate(([d, i, n, k, f]) => {
  const O = window.__overload, s = O.state, now = Date.now();
  if (f) { s.food.foods[f].used = now; s.food.foods[f].last = { qty: 1, unit: 'srv' }; }   // logging a saved food marks it used
  s.diary[d] = (s.diary[d] || []).concat([{ id: i, food: f || null, meal: 2, qty: f ? 1 : null, unit: f ? 'srv' : null, amt: '', name: n, brand: '', kcal: k, p: 10, c: 20, f: 5, at: now }]);
  O.save(); O.render();
}, [date, id, name, kcal, foodId || null]);
const editEntry = (page, date, id, kcal) => page.evaluate(([d, i, k]) => {
  const O = window.__overload, s = O.state;
  s.diary[d] = s.diary[d].map((e) => (e.id === i ? Object.assign({}, e, { kcal: k }) : e));
  O.save(); O.render();
}, [date, id, kcal]);
const deleteEntry = (page, date, id) => page.evaluate(([d, i]) => {
  const O = window.__overload, s = O.state;
  const rest = s.diary[d].filter((e) => e.id !== i);
  if (rest.length) s.diary[d] = rest; else delete s.diary[d];
  O.lib.markDeleted('food', i);
  O.save(); O.render();
}, [date, id]);
const deleteDay = (page, date) => page.evaluate((d) => {
  const O = window.__overload, s = O.state;
  s.diary[d].forEach((e) => O.lib.markDeleted('food', e.id));
  delete s.diary[d];
  O.save(); O.render();
}, date);
const deleteThing = (page, kind, id) => page.evaluate(([k, i]) => {
  const O = window.__overload;
  delete O.state.food[k][i]; O.lib.markDeleted(k, i);
  O.save(); O.render();
}, [kind, id]);
const setTarget = (page, key, value) => page.evaluate(([k, v]) => { const O = window.__overload; O.state.food.targets[k] = v; O.save(); O.render(); }, [key, value]);

// ---------------------------------------------------------------------------
// 1. An account that v2.8 filled; Fuel signs in for the first time; a second Fuel phone; the training apps
// ---------------------------------------------------------------------------
async function accountRun(browser, v28, setUpOnly) {
  const world = { browser, cloud: createCloud(), phones: [] };
  const { cloud } = world;
  const step = (label, title, fn) => run.step(label, title, fn);
  const out = { docs: null };   // Overload's documents as v2.8 wrote them, for the next run

  // ---- the account as v2.8 left it ----
  // The old phone: the main fixture, with a connector key in its settings (which v2.8 uploads in meta/state).
  const old = JSON.parse(fx.text);
  old.settings.connKey = SECRET;
  const V = await makePhone(world, 'V', v28, { seed: (context) => lib.seedV28(context, old) });
  let ok = await step('set-up', 'v2.8 uploads the main fixture: meta/state, ' + COUNTS.workouts + ' workouts, ' + COUNTS.foodDays + ' food days', async () => {
    await openOverload(V);
    await V.app.evaluate(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL, PASSWORD]);
    await rest(world);
    need(cloud.paths(WORKOUTS).length === COUNTS.workouts && cloud.paths(OLD_DAYS).length === COUNTS.foodDays && !!cloud.get(OLD_META), cloud.paths(WORKOUTS).length + ' workouts, ' + cloud.paths(OLD_DAYS).length + ' food days');
    need(cloud.text(OLD_META).includes(SECRET), 'the connector key is not in meta/state: the check that it stays out of meta/fuel would prove nothing');
    need(cloud.paths('users/U1').every((p) => OVERLOAD_PATH.test(p)), 'the account holds something else already');
    return cloud.paths('users/U1').length + ' documents, the connector key among Overload\'s settings';
  });
  if (!ok) return out;
  const overload0 = overloadDocs(cloud);
  out.docs = cloud.snapshot('users/U1');
  const afterSetUp = cloud.mark();
  const vState0 = await lib.readStorageText(V.app, lib.STATE_KEY);
  if (setUpOnly) { await V.close(); return out; }

  // ---- Fuel's first sign-in, on a phone with nothing ----
  const A = await makePhone(world, 'A', TREE);
  let a = null;
  const first = (title, fn) => step('first sign-in', title, fn);
  ok = await first('at Welcome, Sign in to cloud sync opens the diary and brings the account\'s food log down', async () => {
    a = await openFuel(A);
    need((await F.screen(a)) === 'welcome', 'a new phone is not at Welcome');
    await rest(world);
    need(cloud.writes({ who: 'A' }).length === 0 && cloud.reads({ who: 'A' }).length === 0, 'Fuel talked to the cloud before anyone signed in');
    await signInAtWelcome(a);
    await rest(world);
    need((await F.screen(a)) === 'food', 'the screen is ' + await F.screen(a));
    const st = await F.live(a);
    return Object.keys(st.diary).length + ' days on the phone';
  });
  if (!ok) return out;

  await first('Overload\'s documents were read once, from the server, after meta/fuel was found missing; none is listened to', async () => {
    const rs = cloud.reads({ who: 'A' });
    const got = (p, type) => rs.filter((r) => r.path === p && r.type === type && r.via === 'get');
    need(got(FUEL_META, 'get').length === 1 && got(FUEL_DAYS, 'list').length === 1, 'meta/fuel and fuelDays were not read from the server first');
    need(got(OLD_META, 'get').length === 1 && got(OLD_DAYS, 'list').length === 1, 'meta/state read ' + got(OLD_META, 'get').length + ' times, foodDays ' + got(OLD_DAYS, 'list').length + ' times');
    need(got(OLD_META, 'get')[0].n > got(FUEL_META, 'get')[0].n, 'Overload\'s core was read before meta/fuel was looked for');
    const more = rs.filter((r) => OVERLOAD_PATH.test(r.path) && !(r.via === 'get' && (r.path === OLD_META || r.path === OLD_DAYS)));
    need(more.length === 0, 'more was read or listened to: ' + more.map((r) => r.type + ' ' + r.path + ' via ' + r.via).join(', '));
    need(rs.some((r) => r.type === 'listen' && r.path === FUEL_META) && rs.some((r) => r.type === 'listen' && r.path === FUEL_DAYS), 'Fuel does not listen to its own documents');
    need(rs.every((r) => r.app === 'fuel') && A.device.apps.join() === 'fuel', 'the Firebase app is not named fuel: ' + A.device.apps.join());
    return 'get meta/fuel, list fuelDays, then get meta/state and list foodDays; listening to meta/fuel and fuelDays only';
  });

  await first('Fuel wrote only meta/fuel and one fuelDays document per day, in one upload, after the reads had worked', async () => {
    const ws = cloud.writes({ who: 'A' });
    onlyFuelPaths(cloud);
    need(ws.length === COUNTS.foodDays + 1 && ws.every((w) => w.type === 'set' && w.state === 'applied' && w.app === 'fuel'), 'writes: ' + brief(ws));
    need(ws.filter((w) => w.path === FUEL_META).length === 1, 'meta/fuel was written ' + ws.filter((w) => w.path === FUEL_META).length + ' times');
    same(ws.filter((w) => w.path !== FUEL_META).map((w) => w.path.slice(FUEL_DAYS.length + 1)).sort(), DATES, 'the days written');
    need(new Set(ws.map((w) => w.batch)).size === 1, 'the first upload went in ' + new Set(ws.map((w) => w.batch)).size + ' batches');
    const lastRead = Math.max(...cloud.reads({ who: 'A' }).filter((r) => r.via === 'get').map((r) => r.n));
    need(ws.every((w) => w.n > lastRead) && cloud.reads({ who: 'A' }).filter((r) => r.via === 'get').every((r) => r.ok), 'something was written before the server reads had answered');
    return ws.length + ' sets in one batch';
  });

  await first('meta/fuel holds settings (units and theme only), food, deleted and bodyweight; no connector key, nothing of training', async () => {
    const d = cloud.get(FUEL_META), text = cloud.text(FUEL_META);
    same(Object.keys(d).sort(), ['core', 'updatedAt', 'v'], 'the fields of meta/fuel');
    need(typeof d.core === 'string' && d.v === 1 && typeof d.updatedAt === 'number', 'meta/fuel is ' + text.slice(0, 80));
    const core = JSON.parse(d.core);
    same(Object.keys(core), ['settings', 'food', 'deleted', 'bodyweight'], 'the keys of the core');
    same(core.settings, { units: 'lb', theme: 'dark' }, 'settings');
    same(Object.keys(core.food), ['targets', 'foods', 'meals'], 'the keys of food');
    same(Object.keys(core.deleted), ['food', 'foods', 'meals'], 'the kinds of deletion records');
    same(core.bodyweight, [{ date: '2026-11-21', weight: 183.6 }], 'bodyweight');
    const hit = /connKey|connUrl|reminders|exercises|workouts|presc|sleep|templates|program|c0ffee00/.exec(text);
    need(!hit, 'meta/fuel holds "' + (hit && hit[0]) + '"');
    return d.core.length.toLocaleString() + ' characters; Overload\'s core is ' + cloud.get(OLD_META).core.length.toLocaleString();
  });

  await first('every fuelDays document is { data, updatedAt, v: 1 } with that day\'s entries exactly as v2.8 uploaded them', async () => {
    for (const date of DATES) {
      const d = cloud.get(FUEL_DAYS + '/' + date), o = cloud.get(OLD_DAYS + '/' + date);
      need(d && typeof d.data === 'string' && d.v === 1 && typeof d.updatedAt === 'number' && Object.keys(d).length === 3, 'fuelDays/' + date + ' is ' + JSON.stringify(d).slice(0, 80));
      need(d.data === o.data, 'fuelDays/' + date + ' differs from foodDays/' + date);
    }
    return DATES.length + ' days, byte for byte';
  });

  let stA = null;
  await first('the phone holds the same food days, saved foods, saved meals, favourites, targets and deletion records', async () => {
    stA = await F.stored(a);
    same(stA.diary, fx.state.diary, 'diary');
    same(stA.food.foods, fx.state.food.foods, 'food.foods');
    same(stA.food.meals, fx.state.food.meals, 'food.meals');
    same(stA.food.targets, fx.state.food.targets, 'food.targets');
    same(stA.deleted, { food: fx.state.deleted.food, foods: {}, meals: {} }, 'deleted');
    same(stA.settings, { units: 'lb', theme: 'dark' }, 'settings');
    same(stA.bodyweight, [{ date: '2026-11-21', weight: 183.6 }], 'bodyweight');
    same(Object.keys(stA), ['v', 'app', 'settings', 'food', 'diary', 'deleted', 'bodyweight', 'moved'], 'the top-level fields');
    const c = F.diaryCounts(stA.diary, stA.food.foods), foods = Object.values(stA.food.foods);
    need(c.days === COUNTS.foodDays && c.entries === COUNTS.foodEntries && c.quick === COUNTS.quickAddEntries && c.orphans === COUNTS.entriesOfDeletedFoods, JSON.stringify(c));
    need(foods.filter((f) => f.fav).length === COUNTS.favourites && Object.keys(stA.food.meals).length === COUNTS.savedMeals, 'favourites or saved meals are not all there');
    need(new Set(allIds(stA.diary)).size === COUNTS.foodEntries, 'entry ids are not unique');
    same(await F.live(a), stA, 'the state in memory against the saved one');
    const m = stA.moved;
    need(m && m.days === COUNTS.foodDays && m.entries === COUNTS.foodEntries && m.at > 0, 'moved is ' + JSON.stringify(m));
    need(!/connKey|c0ffee00|reminders|"exercises"/.test(JSON.stringify(await lib.readStorage(a))), 'something of Overload\'s settings is in the phone\'s storage');
    need((await lib.readStorage(a, 'fuel.theme')) === 'dark', 'the theme was not taken over');
    return c.days + ' days, ' + c.entries.toLocaleString() + ' entries, ' + foods.length + ' saved foods (' + COUNTS.favourites + ' favourites), ' + COUNTS.savedMeals + ' saved meals, targets ' + JSON.stringify(stA.food.targets);
  });

  for (const want of fx.facts.foodDays) {
    await first('the day ' + want.label + ' shows what v2.8 showed', async () => {
      await F.gotoDay(a, want.daysAgo);
      const got = await F.readDay(a);
      for (const k of ['date', 'label', 'kcal', 'kcalLine', 'left', 'protein', 'carbs', 'fat', 'entries']) need(got[k] === want[k], k + ' reads "' + got[k] + '", v2.8 showed "' + want[k] + '"');
      same(got.meals, want.meals, 'the meals');
      return got.kcalLine + ', ' + got.left + ', P ' + got.protein + ', C ' + got.carbs + ', F ' + got.fat + ', ' + got.entries + ' entries';
    });
  }
  await first('the Add sheet lists the saved meals, favourites and recents; Settings says the log was brought across', async () => {
    await F.gotoDay(a, 0);
    const sheet = await F.openAddSheet(a, 3);
    same(sheet.groups, fx.facts.addSheet.groups, 'the groups');
    same(sheet.favourites, fx.facts.addSheet.favourites, 'the favourites');
    await F.closeSheet(a);
    await lib.openTab(a, 'settings');
    const t = await F.text(a, '#app');
    need(/Brought across on .*: 110 days, 1,576 entries/.test(t), 'Settings does not say so');
    need(/Signed in/.test(await F.text(a, '#cloud-card')) && (await F.text(a, '#cloud-card')).includes(EMAIL), 'the Cloud sync card reads ' + await F.text(a, '#cloud-card'));
    await lib.openTab(a, 'food');
    return JSON.stringify(sheet.groups);
  });

  await first('the note fuel.sync.v1 lists the account, the core and every day; no "before cloud" copy of an empty phone', async () => {
    const n = await noteOf(a);
    need(n && n.uid === 'U1' && /^h/.test(n.core) && Object.keys(n.days).length === COUNTS.foodDays, 'the note is ' + JSON.stringify(n).slice(0, 120));
    same(Object.keys(n).sort(), ['core', 'days', 'uid'], 'the fields of the note');
    need(!(await F.copies(a)).some((c) => c.id === 'before-cloud'), 'a copy of the empty phone was kept as "before cloud"');
    need((await lib.readStorage(a, 'overload.sync.v1')) === null, 'Fuel wrote Overload\'s note');
    return Object.keys(n.days).length + ' days noted';
  });

  await first('nothing of Overload\'s in the account changed, byte for byte, and v2.8 next to it noticed nothing', async () => {
    need(overloadDocs(cloud) === overload0, 'meta/state, workouts or foodDays changed');
    need(cloud.writes({ from: afterSetUp }).every((w) => w.who === 'A'), 'someone else wrote: ' + brief(cloud.writes({ from: afterSetUp }).filter((w) => w.who !== 'A')));
    need((await lib.readStorageText(V.app, lib.STATE_KEY)) === vState0, 'the v2.8 phone\'s saved data changed');
    return cloud.paths(OLD_DAYS).length + ' food days, ' + cloud.paths(WORKOUTS).length + ' workouts and meta/state as they were';
  });

  await first('closed and opened again: nothing is read from Overload\'s documents, nothing is written', async () => {
    const mark = cloud.mark();
    await closeFuel(A);
    a = await openFuel(A);
    await rest(world);
    noOverloadReads(cloud, mark);
    need(cloud.reads({ who: 'A', from: mark }).every((r) => r.type === 'listen' || r.via === 'listen'), 'a known phone read from the server by itself');
    need(cloud.writes({ from: mark }).length === 0, 'writes: ' + brief(cloud.writes({ from: mark })));
    same(await F.stored(a), stA, 'the saved state after the restart');
    return 'listening to meta/fuel and fuelDays';
  });

  // ---- a second Fuel phone ----
  const B = await makePhone(world, 'B', TREE);
  let b = null;
  const two = (title, fn) => step('two phones', title, fn);
  ok = await two('a second phone signs in: it reads Fuel\'s documents only, gets the same data and has nothing to send', async () => {
    const mark = cloud.mark();
    b = await openFuel(B);
    await signInAtWelcome(b);
    await rest(world);
    const rs = cloud.reads({ who: 'B', from: mark });
    need(rs.some((r) => r.path === FUEL_META && r.via === 'get') && rs.some((r) => r.path === FUEL_DAYS && r.via === 'get'), 'meta/fuel and fuelDays were not read from the server');
    noOverloadReads(cloud, mark);
    need(cloud.writes({ from: mark }).length === 0, 'writes: ' + brief(cloud.writes({ from: mark })));
    same(travels(await F.stored(b)), travels(stA), 'the second phone\'s data against the first\'s');
    need((await F.screen(b)) === 'food', 'the screen is ' + await F.screen(b));
    return Object.keys((await F.stored(b)).diary).length + ' days, no write';
  });
  if (!ok) return out;

  // Things from the fixture that the next steps change.
  const E1 = fx.state.diary[YESTERDAY][0].id, E2 = fx.state.diary[TODAY][1].id, E3 = fx.state.diary[YESTERDAY][2].id;
  const plain = Object.keys(fx.state.food.foods).filter((id) => !fx.state.food.foods[id].fav).sort();
  const X = plain[0], Y = plain[1], Z = plain[2];
  const MEAL = Object.keys(fx.state.food.meals).sort()[0];
  const D0 = DATES[0];
  let soup = null;

  await two('A logs a food (Quick add, on its screen): B has it and shows it', async () => {
    const mark = cloud.mark();
    await F.gotoDay(a, 0); await F.gotoDay(b, 0);
    await F.quickAdd(a, 2, 'Sync test soup', 321, 20, 30, 10);
    await rest(world);
    const ws = cloud.writes({ from: mark });
    need(ws.length === 1 && ws[0].who === 'A' && ws[0].path === FUEL_DAYS + '/' + TODAY && ws[0].type === 'set', 'writes: ' + brief(ws));
    soup = (await F.live(b)).diary[TODAY].find((e) => e.name === 'Sync test soup');
    need(soup && soup.kcal === 321, 'the entry is not on B');
    const day = await F.readDay(b);
    need(day.entries === 11 && day.kcal === '1,578', 'B\'s screen shows ' + day.entries + ' entries and ' + day.kcal + ' kcal');
    same(await F.stored(b), await F.live(b), 'B\'s saved state against the one in memory');
    return 'one write (fuelDays/' + TODAY + '); B shows ' + day.kcalLine;
  });
  if (!soup) return out;

  await two('B edits that entry: A has the new number', async () => {
    const mark = cloud.mark();
    await editEntry(b, TODAY, soup.id, 350);
    await rest(world);
    const ws = cloud.writes({ from: mark });
    need(ws.length === 1 && ws[0].who === 'B' && ws[0].path === FUEL_DAYS + '/' + TODAY, 'writes: ' + brief(ws));
    need((await F.live(a)).diary[TODAY].find((e) => e.id === soup.id).kcal === 350, 'A still has the old number');
    need((await F.readDay(a)).kcal === '1,607', 'A\'s screen shows ' + (await F.readDay(a)).kcal);
    return 'A shows 1,607 kcal';
  });

  await two('B deletes an entry of yesterday: it is gone on A and in the account, with its deletion record', async () => {
    const mark = cloud.mark();
    await deleteEntry(b, YESTERDAY, E1);
    await rest(world);
    onlyFuelPaths(cloud, mark);
    need(cloud.writes({ from: mark }).every((w) => w.who === 'B'), 'A wrote in answer: ' + brief(cloud.writes({ from: mark, who: 'A' })));
    const sa = await F.live(a);
    need(!ids(sa.diary[YESTERDAY]).includes(E1) && sa.diary[YESTERDAY].length === 14, 'A still has it');
    need(sa.deleted.food[E1] > 0 && coreOfCloud(cloud).deleted.food[E1] > 0, 'the record did not travel');
    need(!ids(dayOfCloud(cloud, YESTERDAY)).includes(E1), 'the account\'s day still has it');
    return '14 entries left on both';
  });

  await two('A deletes a saved food, B deletes a saved meal: both are gone on the other phone', async () => {
    const mark = cloud.mark();
    await deleteThing(a, 'foods', X);
    await rest(world);
    await deleteThing(b, 'meals', MEAL);
    await rest(world);
    onlyFuelPaths(cloud, mark);
    const sa = await F.live(a), sb = await F.live(b), core = coreOfCloud(cloud);
    need(!sb.food.foods[X] && sb.deleted.foods[X] > 0, 'B still has the saved food ' + X);
    need(!sa.food.meals[MEAL] && sa.deleted.meals[MEAL] > 0, 'A still has the saved meal');
    need(!core.food.foods[X] && !core.food.meals[MEAL] && core.deleted.foods[X] > 0 && core.deleted.meals[MEAL] > 0, 'the account still has them, or not their records');
    need(Object.keys(sb.food.foods).length === COUNTS.savedFoods - 1 && Object.keys(sa.food.meals).length === COUNTS.savedMeals - 1, 'more than that went missing');
    const ws = cloud.writes({ from: mark });
    need(ws.length === 2 && ws.every((w) => w.path === FUEL_META), 'writes: ' + brief(ws));
    return '"' + fx.state.food.foods[X].name + '" and "' + fx.state.food.meals[MEAL].name + '"; two writes of meta/fuel';
  });

  await two('B changes a target: A has it and shows it', async () => {
    await setTarget(b, 'kcal', 2000);
    await rest(world);
    need((await F.live(a)).food.targets.kcal === 2000 && coreOfCloud(cloud).food.targets.kcal === 2000, 'the target did not travel');
    await F.gotoDay(a, 0);
    need(/\/ 2,000 kcal/.test((await F.readDay(a)).kcalLine), 'A\'s screen shows ' + (await F.readDay(a)).kcalLine);
    return (await F.readDay(a)).kcalLine;
  });

  await two('A removes every entry of a day: the day\'s document is deleted and B loses the day', async () => {
    const mark = cloud.mark();
    await deleteDay(a, D0);
    await rest(world);
    const ws = cloud.writes({ from: mark });
    need(ws.some((w) => w.type === 'delete' && w.path === FUEL_DAYS + '/' + D0 && w.who === 'A'), 'no delete of fuelDays/' + D0 + ': ' + brief(ws));
    need(ws.every((w) => w.who === 'A'), 'B wrote in answer (it put the day back?): ' + brief(ws.filter((w) => w.who !== 'A')));
    need(!cloud.get(FUEL_DAYS + '/' + D0) && !(await F.live(b)).diary[D0], 'the day is still there');
    need(!!cloud.get(OLD_DAYS + '/' + D0), 'Overload\'s document of that day is gone too');
    return D0 + ': deleted in fuelDays, still in foodDays';
  });

  const gone = (st) => [ids(st.diary[YESTERDAY]).includes(E1) && 'the deleted entry', st.food.foods[X] && 'the deleted food', st.food.meals[MEAL] && 'the deleted meal', st.diary[D0] && 'the deleted day'].filter(Boolean);
  await two('both phones hold the same, and nothing deleted came back after B was closed and opened again', async () => {
    same(travels(await F.live(a)), travels(await F.live(b)), 'A against B');
    const mark = cloud.mark();
    await closeFuel(B);
    b = await openFuel(B);
    await rest(world);
    need(cloud.writes({ from: mark }).length === 0, 'the restart wrote: ' + brief(cloud.writes({ from: mark })));
    for (const [name, pg] of [['A', a], ['B', b]]) need(gone(await F.live(pg)).length === 0, name + ' has ' + gone(await F.live(pg)).join(', ') + ' again');
    same(travels(await F.live(a)), travels(await F.live(b)), 'A against B after the restart');
    same(coreOfCloud(cloud).food, JSON.parse(JSON.stringify((await F.live(a)).food)), 'the account\'s saved foods, meals and targets against A\'s');
    need(cloud.paths(FUEL_DAYS).length === COUNTS.foodDays - 1, cloud.paths(FUEL_DAYS).length + ' days in the account');
    return cloud.paths(FUEL_DAYS).length + ' days in the account';
  });

  // ---- a phone that was offline sends its old copies later ----
  const late = (title, fn) => step('offline replay', title, fn);
  let wentOffline = 0;
  await late('B logs a saved food without signal; meanwhile A deletes an entry of that day and a saved food', async () => {
    await B.device.setOffline(true);
    const mark = wentOffline = cloud.mark();
    await addEntry(b, TODAY, 'fueltestlate1', 'Logged offline', 111, Z);
    await rest(world);
    const queued = cloud.writes({ who: 'B', from: mark });
    need(queued.length === 2 && queued.every((w) => w.state === 'queued') && queued.some((w) => w.path === FUEL_META) && queued.some((w) => w.path === FUEL_DAYS + '/' + TODAY), 'B\'s writes: ' + brief(queued));
    await deleteEntry(a, TODAY, E2);
    await deleteThing(a, 'foods', Y);
    await rest(world);
    need(!ids(dayOfCloud(cloud, TODAY)).includes(E2) && !coreOfCloud(cloud).food.foods[Y], 'A\'s deletions are not in the account');
    const sb = await F.live(b);
    need(ids(sb.diary[TODAY]).includes(E2) && !!sb.food.foods[Y], 'B knows already: this check needs it not to');
    return 'B holds a core and a day to send, both from before the deletions';
  });
  await late('B is online again and its old copies arrive: the deleted entry and food do not come back, B\'s new entry stays', async () => {
    const mark = cloud.mark();
    await B.device.setOffline(false);
    await rest(world);
    const sent = cloud.writes({ who: 'B', from: wentOffline }).filter((w) => w.path === FUEL_DAYS + '/' + TODAY && w.state === 'applied' && ids(JSON.parse(JSON.parse(w.json).data)).includes(E2));
    need(sent.length > 0, 'B\'s old copy of the day (with the deleted entry) never reached the account: this check needs it to');
    onlyFuelPaths(cloud, mark);
    const day = ids(dayOfCloud(cloud, TODAY)), core = coreOfCloud(cloud);
    need(!day.includes(E2), 'the deleted entry is back in the account');
    need(day.includes('fueltestlate1'), 'the entry logged offline is not in the account');
    need(!core.food.foods[Y] && core.deleted.foods[Y] > 0 && core.deleted.food[E2] > 0, 'the deleted food is back in the account, or the records are gone');
    need(core.food.foods[Z].used >= NOW, 'the food logged offline lost its "used" time');
    for (const [name, pg] of [['A', a], ['B', b]]) {
      const st = await F.live(pg);
      need(!ids(st.diary[TODAY]).includes(E2), name + ' has the deleted entry');
      need(ids(st.diary[TODAY]).includes('fueltestlate1'), name + ' lacks the entry logged offline');
      need(!st.food.foods[Y], name + ' has the deleted food');
      need(gone(st).length === 0, name + ' has ' + gone(st).join(', ') + ' again');
    }
    same(travels(await F.live(a)), travels(await F.live(b)), 'A against B');
    return 'writes after B came back: ' + brief(cloud.writes({ from: mark }));
  });

  // ---- the first server read fails ----
  const fail = (title, fn) => step('first read fails', title, fn);
  let bBefore = null;
  await fail('a phone without its note starts with no connection: nothing is uploaded, not even queued', async () => {
    // What a Restore or Reset while signed out leaves behind: the sign-in is remembered, the note is gone.
    await b.evaluate((k) => localStorage.removeItem(k), NOTE);
    await closeFuel(B);
    B.device.clearCache('fuel');
    await B.device.setOffline(true);
    const mark = cloud.mark();
    b = await openFuel(B);
    await rest(world);
    need((await b.evaluate(() => (window.__overloadSync.user || {}).uid)) === 'U1', 'the sign-in was not remembered');
    await addEntry(b, TODAY, 'fueltestfail1', 'Logged while the first read failed', 222);
    await deleteEntry(b, YESTERDAY, E3);
    await rest(world);
    await b.clock.runFor(20000);   // the first retry, 15 seconds later, fails too
    await rest(world);
    const ws = cloud.writes({ who: 'B', from: mark }), rs = cloud.reads({ who: 'B', from: mark }).filter((r) => r.via === 'get');
    need(ws.length === 0 && B.device.queued('fuel').length === 0, 'B issued writes: ' + brief(ws));
    need(rs.length >= 4 && rs.every((r) => !r.ok && r.error === 'unavailable'), 'the server reads: ' + rs.map((r) => r.path + ' ' + (r.ok ? 'ok' : r.error)).join(', '));
    need(!cloud.reads({ who: 'B', from: mark }).some((r) => r.type === 'listen'), 'a listener was started before a server read had worked');
    const err = await b.evaluate(() => window.__overloadSync.error);
    need(/Nothing was uploaded/.test(err), 'the status says "' + err + '"');
    need((await noteOf(b)) === null, 'a note was written');
    bBefore = await F.live(b);
    return rs.length + ' server reads failed; status: "' + err + '"';
  });
  await fail('with a connection the read works: the phone\'s new entry goes up, its deletion holds, nothing else changes', async () => {
    const mark = cloud.mark();
    await B.device.setOffline(false);
    await rest(world);
    onlyFuelPaths(cloud, mark);
    noOverloadReads(cloud, mark);   // meta/fuel exists: Overload's copy is not read again
    need((await b.evaluate(() => window.__overloadSync.error)) === '', 'the status still says "' + await b.evaluate(() => window.__overloadSync.error) + '"');
    need(ids(dayOfCloud(cloud, TODAY)).includes('fueltestfail1') && !ids(dayOfCloud(cloud, YESTERDAY)).includes(E3), 'the account does not have B\'s changes');
    const sa = await F.live(a), sb = await F.live(b);
    need(ids(sa.diary[TODAY]).includes('fueltestfail1') && !ids(sa.diary[YESTERDAY]).includes(E3), 'A does not have B\'s changes');
    same(travels(sa), travels(sb), 'A against B');
    same(travels(sb), travels(bBefore), 'B after the link against B before it');
    need((await noteOf(b)).uid === 'U1', 'no note after the link');
    need((await F.copy(b, 'before-cloud')) !== null, 'no "before cloud" copy of the phone\'s data was kept');
    return 'writes: ' + brief(cloud.writes({ from: mark }));
  });

  // ---- signed out, changes, signed in again ----
  const again = (title, fn) => step('sign out and in', title, fn);
  await again('signed out, the note stays; what is changed meanwhile is not sent', async () => {
    await signOutInSettings(a);
    const n = await noteOf(a);
    need(n && n.uid === 'U1' && Object.keys(n.days).length > 100, 'the note is ' + JSON.stringify(n).slice(0, 80));
    const mark = cloud.mark();
    await F.gotoDay(a, 0);
    await F.quickAdd(a, 0, 'Logged while signed out', 432, 1, 2, 3);
    await deleteEntry(a, YESTERDAY, fx.state.diary[YESTERDAY][3].id);
    await setTarget(a, 'fat', 66);
    await rest(world);
    need(cloud.writes({ who: 'A', from: mark }).length === 0, 'A wrote while signed out: ' + brief(cloud.writes({ who: 'A', from: mark })));
    return 'three changes waiting';
  });
  await again('signed in again (Settings): the three changes go up without a server read, and reach the other phone', async () => {
    const mark = cloud.mark();
    await signInInSettings(a);
    await rest(world);
    need(!cloud.reads({ who: 'A', from: mark }).some((r) => r.via === 'get'), 'a known phone read the account from the server (a first link, not a push)');
    onlyFuelPaths(cloud, mark);
    const day = dayOfCloud(cloud, TODAY), E4 = fx.state.diary[YESTERDAY][3].id;
    need(day.some((e) => e.name === 'Logged while signed out' && e.kcal === 432), 'the entry logged while signed out is not in the account');
    need(!ids(dayOfCloud(cloud, YESTERDAY)).includes(E4) && coreOfCloud(cloud).deleted.food[E4] > 0, 'the deletion made while signed out is not in the account');
    need(coreOfCloud(cloud).food.targets.fat === 66, 'the target changed while signed out is not in the account');
    const sb = await F.live(b);
    need(sb.diary[TODAY].some((e) => e.name === 'Logged while signed out') && !ids(sb.diary[YESTERDAY]).includes(E4) && sb.food.targets.fat === 66, 'B did not get them');
    same(travels(await F.live(a)), travels(sb), 'A against B');
    return 'writes: ' + brief(cloud.writes({ from: mark }));
  });

  // ---- things that must not go wrong ----
  const guard = (title, fn) => step('safeguards', title, fn);
  await guard('an upload the cloud refuses is sent again a minute later, and the note does not say "sent" meanwhile', async () => {
    const mark = cloud.mark(), noted = (await noteOf(a)).days[TODAY];
    A.device.rejectNext('permission-denied');
    await addEntry(a, TODAY, 'fueltestdeny1', 'Refused once', 77);
    await rest(world);
    const ws = cloud.writes({ who: 'A', from: mark });
    need(ws.length === 1 && ws[0].state === 'rejected' && ws[0].path === FUEL_DAYS + '/' + TODAY, 'writes: ' + brief(ws));
    need((await noteOf(a)).days[TODAY] === noted, 'the note says the day is in the account');
    const err = await a.evaluate(() => window.__overloadSync.error);
    need(/rules are blocking/.test(err), 'the status says "' + err + '"');
    await a.clock.runFor(61000);
    await rest(world);
    need(ids(dayOfCloud(cloud, TODAY)).includes('fueltestdeny1') && ids((await F.live(b)).diary[TODAY]).includes('fueltestdeny1'), 'the entry never arrived');
    need((await a.evaluate(() => window.__overloadSync.error)) === '', 'the status still says "' + await a.evaluate(() => window.__overloadSync.error) + '"');
    return 'refused, then taken: ' + brief(cloud.writes({ who: 'A', from: mark }));
  });

  await guard('a day whose name is not a date, and a day with an entry that has no id, are not uploaded and stop nothing', async () => {
    const mark = cloud.mark(), days = cloud.paths(FUEL_DAYS).length, errors = A.pageErrors.length;
    await a.evaluate(([today, yesterday]) => {
      const O = window.__overload, s = O.state;
      const e = (id) => ({ id, food: null, meal: 3, qty: null, unit: null, amt: '', name: 'Odd ' + id, brand: '', kcal: 1, p: 0, c: 0, f: 0, at: Date.now() });
      s.diary['2026/11/22'] = [e('fuelodd1')];   // as a document address this would have six parts
      s.diary[''] = [e('fuelodd2')];
      s.diary['tomorrow'] = [e('fuelodd3')];
      s.diary[yesterday] = s.diary[yesterday].concat([Object.assign(e('none'), { id: undefined })]);
      s.diary[today] = s.diary[today].concat([e('fueltestgood1')]);
      O.save();
    }, [TODAY, YESTERDAY]);
    await rest(world);
    const ws = cloud.writes({ from: mark });
    need(ws.length === 1 && ws[0].who === 'A' && ws[0].type === 'set' && ws[0].path === FUEL_DAYS + '/' + TODAY && ws[0].state === 'applied', 'writes: ' + brief(ws));
    need(cloud.paths(FUEL_DAYS).length === days && cloud.paths(FUEL_DAYS).every((p) => /\/fuelDays\/\d{4}-\d{2}-\d{2}$/.test(p)), 'the days in the account: ' + cloud.paths(FUEL_DAYS).length + ' (were ' + days + ')');
    need(!!cloud.get(FUEL_DAYS + '/' + YESTERDAY) && dayOfCloud(cloud, YESTERDAY).every((x) => typeof x.id === 'string'), 'yesterday was deleted in the account, or sent with an entry that has no id');
    need(A.pageErrors.length === errors, 'a page error: ' + A.pageErrors.slice(errors).join(' | ').slice(0, 200));
    need(ids((await F.live(b)).diary[TODAY]).includes('fueltestgood1'), 'the good entry of the same save did not travel');
    // The app repairs both at its next start (an id for the entry, the odd names dropped): then the day goes up.
    await closeFuel(A);
    a = await openFuel(A);
    await rest(world);
    const sa = await F.live(a);
    need(Object.keys(sa.diary).every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) && sa.diary[YESTERDAY].every((x) => typeof x.id === 'string' && x.id), 'the app did not repair its data at start');
    same(dayOfCloud(cloud, YESTERDAY), sa.diary[YESTERDAY], 'yesterday in the account against the phone\'s after the restart');
    same(travels(sa), travels(await F.live(b)), 'A against B');
    return 'one write (the good day); after a restart: ' + brief(cloud.writes({ from: mark }).slice(1));
  });

  await guard('a saved food deleted earlier is made again under its old id and logged: it is back on both phones, and stays', async () => {
    // X was deleted on A above; both phones and the account hold its record. Now B logs that listed food again:
    // food.js stores it under the same id, and fuel.js drops the record on that phone.
    const mark = cloud.mark();
    need((await F.live(a)).deleted.foods[X] > 0 && (await F.live(b)).deleted.foods[X] > 0, 'the record is not on both phones');
    await b.evaluate(([f, day]) => {
      const O = window.__overload, s = O.state, t = Date.now();
      s.food.foods[f.id] = Object.assign({}, f, { used: t, last: { qty: 1, unit: 'srv' } });
      s.diary[day] = s.diary[day].concat([{ id: 'fueltestagain1', food: f.id, meal: 1, qty: 1, unit: 'srv', amt: '', name: f.name, brand: '', kcal: 100, p: 1, c: 1, f: 1, at: t }]);
      O.save(); O.render();
    }, [fx.state.food.foods[X], TODAY]);
    await rest(world);
    const core = coreOfCloud(cloud);
    need(!!core.food.foods[X] && !core.deleted.foods[X], 'the account: food ' + !!core.food.foods[X] + ', record ' + core.deleted.foods[X]);
    for (const [name, pg] of [['A', a], ['B', b]]) { const st = await F.live(pg); need(!!st.food.foods[X] && !st.deleted.foods[X], name + ': food ' + !!st.food.foods[X] + ', record ' + st.deleted.foods[X]); }
    // (A may send the day once more, in the order of the entries' times: its clock is ahead of B's here. The
    // core it must not send again: that would be the two phones disagreeing about the food.)
    need(!cloud.writes({ from: mark, who: 'A' }).some((w) => w.path === FUEL_META), 'A sent the core in answer: ' + brief(cloud.writes({ from: mark, who: 'A' })));
    same(travels(await F.live(a)), travels(await F.live(b)), 'A against B');
    const again = cloud.mark();
    await closeFuel(A);
    a = await openFuel(A);
    await rest(world);
    need(cloud.writes({ from: again }).length === 0 && !!(await F.live(a)).food.foods[X] && !!(await F.live(b)).food.foods[X], 'it did not stay: ' + brief(cloud.writes({ from: again })));
    return '"' + fx.state.food.foods[X].name + '"; writes: ' + brief(cloud.writes({ from: mark }));
  });

  await guard('a phone that lost its saved data but kept its note starts at Welcome: the account\'s log comes down, nothing is deleted', async () => {
    const mark = cloud.mark(), days = JSON.stringify(cloud.snapshot(FUEL_DAYS)), core = cloud.get(FUEL_META).core, want = travels(await F.live(b));
    need((await noteOf(b)).uid === 'U1', 'B has no note');
    await b.evaluate((k) => localStorage.removeItem(k), F.KEY);
    await closeFuel(B);
    b = await openFuel(B);
    await rest(world);
    const ws = cloud.writes({ from: mark });
    need(!ws.some((w) => w.type === 'delete'), 'days were deleted in the account: ' + brief(ws.filter((w) => w.type === 'delete')));
    need(ws.length === 0 && JSON.stringify(cloud.snapshot(FUEL_DAYS)) === days && cloud.get(FUEL_META).core === core, 'the account changed: ' + brief(ws));
    need(cloud.reads({ who: 'B', from: mark }).some((r) => r.path === FUEL_META && r.via === 'get'), 'the account was not read first (the note was trusted)');
    same(travels(await F.live(b)), want, 'B\'s data after the start');
    need((await F.screen(b)) === 'food', 'the screen is ' + await F.screen(b));
    return Object.keys(want.diary).length + ' days back on the phone, no write';
  });

  // ---- the training apps on the same account ----
  const both = (title, fn) => step('training app', title, fn);
  await both('v2.8, signed in all along in its own storage: nothing changed for it, and it wrote nothing', async () => {
    need((await lib.readStorageText(V.app, lib.STATE_KEY)) === vState0, 'the v2.8 phone\'s saved data changed');
    need(overloadDocs(cloud) === overload0, 'meta/state, workouts or foodDays changed');
    need(cloud.writes({ from: afterSetUp }).every((w) => w.app === 'fuel'), 'the training app wrote: ' + brief(cloud.writes({ from: afterSetUp }).filter((w) => w.app !== 'fuel')));
    onlyFuelPaths(cloud);
    return cloud.writes({ app: 'fuel' }).length + ' writes by Fuel so far, all to meta/fuel and fuelDays';
  });
  let t = null, fuelA = null;
  await both('this tree\'s root app signs in next to Fuel, in the same storage: two sign-ins, and Fuel is left alone', async () => {
    fuelA = await F.storedText(a);
    const mark = cloud.mark();
    t = await openOverload(A);
    await t.evaluate(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]);
    await rest(world);
    need(A.device.user().uid === 'U1' && A.device.user('fuel').uid === 'U1' && A.device.apps.slice().sort().join() === '[DEFAULT],fuel', 'Firebase apps on the phone: ' + A.device.apps.join());
    need(cloud.writes({ app: 'fuel', from: mark }).length === 0, 'Fuel wrote: ' + brief(cloud.writes({ app: 'fuel', from: mark })));
    need(cloud.writes({ from: mark }).every((w) => OVERLOAD_PATH.test(w.path)), 'the training app wrote to Fuel\'s documents: ' + brief(cloud.writes({ from: mark }).filter((w) => !OVERLOAD_PATH.test(w.path))));
    need(!cloud.reads({ app: '[DEFAULT]', from: mark }).some((r) => /meta\/fuel|fuelDays/.test(r.path)), 'the training app read Fuel\'s documents');
    need((await F.storedText(a)) === fuelA, 'Fuel\'s saved data changed');
    const ts = await t.evaluate(() => JSON.parse(JSON.stringify(window.__overload.state)));
    need(ts.workouts.length === COUNTS.workouts, 'the training app has ' + ts.workouts.length + ' workouts');
    const keys = Object.keys(await lib.readStorage(a)).sort();
    need(keys.includes('overload.sync.v1') && keys.includes(NOTE) && keys.includes('overload.state.v1') && keys.includes(F.KEY), 'keys in the shared storage: ' + keys.join(', '));
    return ts.workouts.length + ' workouts in the training app; storage: ' + keys.join(', ');
  });
  await both('the training apps change settings and v2.8 logs food: Fuel reads nothing, writes nothing, changes nothing', async () => {
    if (!t) throw new Error('the root app did not start');
    const fuelB = await F.storedText(b), fuelCloud = JSON.stringify([cloud.snapshot('users/U1/meta/fuel'), cloud.text(FUEL_META), cloud.snapshot(FUEL_DAYS)]);
    fuelA = await F.storedText(a);
    const mark = cloud.mark();
    await t.evaluate(() => { const O = window.__overload; O.state.settings.restSec = O.state.settings.restSec === 120 ? 135 : 120; O.save(); });
    await rest(world);
    await V.app.evaluate((day) => {
      const O = window.__overload, s = O.state, now = Date.now(), gone = s.diary[day][0];
      s.diary[day] = s.diary[day].slice(1).concat([Object.assign({}, gone, { id: 'v28testentry', at: now })]);
      s.deleted.food[gone.id] = now; s.food.targets.kcal = 2100;
      O.save();
    }, TODAY);
    await rest(world);
    const ws = cloud.writes({ from: mark });
    need(ws.some((w) => w.path === OLD_DAYS + '/' + TODAY) && ws.some((w) => w.path === OLD_META), 'the training apps did not write what they changed: ' + brief(ws));
    need(ws.every((w) => w.app === '[DEFAULT]' && OVERLOAD_PATH.test(w.path)), 'someone wrote elsewhere: ' + brief(ws.filter((w) => w.app !== '[DEFAULT]' || !OVERLOAD_PATH.test(w.path))));
    // (The fake cloud serves a listener by reading its document again after every change in the account: those
    // reads of Fuel's own two places are its listeners at work, and they deliver nothing new here.)
    noOverloadReads(cloud, mark);
    need(cloud.reads({ app: 'fuel', from: mark }).every((r) => r.via === 'listen' && (r.path === FUEL_META || r.path === FUEL_DAYS)), 'Fuel read something by itself: ' + cloud.reads({ app: 'fuel', from: mark }).filter((r) => r.via !== 'listen').map((r) => r.who + ' ' + r.path).join(', '));
    need((await F.storedText(a)) === fuelA && (await F.storedText(b)) === fuelB, 'a Fuel phone\'s saved data changed');
    need(JSON.stringify([cloud.snapshot('users/U1/meta/fuel'), cloud.text(FUEL_META), cloud.snapshot(FUEL_DAYS)]) === fuelCloud, 'Fuel\'s documents changed');
    return 'the training apps wrote ' + brief(ws);
  });
  await both('Fuel logs a food: the training apps write nothing and keep their data; Overload\'s documents stay as they are', async () => {
    if (!t) throw new Error('the root app did not start');
    const docs = overloadDocs(cloud), vNow = await lib.readStorageText(V.app, lib.STATE_KEY), tNow = await lib.readStorageText(t, lib.STATE_KEY);
    const mark = cloud.mark();
    await addEntry(a, TODAY, 'fueltestnext1', 'Logged next to Overload', 99, Z);
    await rest(world);
    const ws = cloud.writes({ from: mark });
    need(ws.length === 2 && ws.every((w) => w.app === 'fuel' && w.who === 'A' && FUEL_PATH.test(w.path)), 'writes: ' + brief(ws));
    need(overloadDocs(cloud) === docs, 'meta/state, workouts or foodDays changed');
    need((await lib.readStorageText(V.app, lib.STATE_KEY)) === vNow && (await lib.readStorageText(t, lib.STATE_KEY)) === tNow, 'a training app\'s saved data changed');
    need((await F.live(b)).diary[TODAY].some((e) => e.id === 'fueltestnext1'), 'the other Fuel phone did not get the entry');
    return 'writes: ' + brief(ws);
  });

  await step('the whole run', 'no write or delete below meta/state, workouts or foodDays by Fuel; no page error on a Fuel phone', async () => {
    onlyFuelPaths(cloud);
    const fuel = cloud.writes({ app: 'fuel' });
    const lost = fuel.filter((w) => w.state !== 'applied');
    need(fuel.length > 0 && lost.length === 1 && lost[0].state === 'rejected', 'writes that were not taken, besides the one refused on purpose: ' + brief(lost));
    need(cloud.reads({ app: 'fuel' }).filter((r) => OVERLOAD_PATH.test(r.path)).length === 2, 'Overload\'s documents were read ' + cloud.reads({ app: 'fuel' }).filter((r) => OVERLOAD_PATH.test(r.path)).length + ' times in all');
    for (const p of [A, B]) F.assertClean(p, 'phone ' + p.name);
    return fuel.length + ' writes by Fuel, ' + fuel.filter((w) => w.type === 'delete').length + ' of them deletes (fuelDays)';
  });
  for (const p of world.phones) await p.close();
  return out;
}

// ---------------------------------------------------------------------------
// 2. The phone already brought the food log across with Copy my food log, and went on from there
// ---------------------------------------------------------------------------
async function clipboardRun(browser, docs) {
  const world = { browser, cloud: createCloud(), phones: [] };
  const { cloud } = world;
  const step = (title, fn) => run.step('clipboard first', title, fn);
  // The same account as v2.8 left it: its documents, text for text.
  cloud.addAccount(EMAIL, PASSWORD);
  Object.keys(docs).forEach((p) => cloud.docs.set(p, docs[p]));
  const overload0 = overloadDocs(cloud);
  const text = F.foodText(F.payloadFrom(fx.state, NOW - 60000), true);

  const E = fx.state.diary[YESTERDAY][0].id, M = fx.state.diary[TODAY][0];
  const X = Object.keys(fx.state.food.foods).filter((id) => !fx.state.food.foods[id].fav).sort()[0];
  const C = await makePhone(world, 'C', TREE, { clipboard: true });
  let c = null, before = null;
  let ok = await step('the food log is pasted at Welcome; then an entry and a saved food are deleted, an entry is added, one is edited', async () => {
    c = await openFuel(C);
    await c.evaluate((t) => navigator.clipboard.writeText(t), text);
    await c.click('[data-action="fuel-paste"]');
    await F.toast(c, /Brought in/);
    same((await F.stored(c)).diary, fx.state.diary, 'the diary after the paste');
    await deleteEntry(c, YESTERDAY, E);
    await deleteThing(c, 'foods', X);
    await addEntry(c, TODAY, 'fueltestown01', 'Logged in Fuel', 150);
    await editEntry(c, TODAY, M.id, M.kcal + 100);
    await rest(world);
    need(cloud.log.length === 0, 'Fuel talked to the cloud before anyone signed in');
    before = await F.storedText(c);
    return (before.length).toLocaleString() + ' characters saved on the phone';
  });
  if (!ok) return;

  await step('signing in (Settings) reads Overload\'s copy once and changes nothing on the phone: not one character', async () => {
    await signInInSettings(c);
    await rest(world);
    const rs = cloud.reads({ who: 'C' }).filter((r) => OVERLOAD_PATH.test(r.path));
    need(rs.length === 2 && rs.every((r) => r.via === 'get'), 'reads of Overload\'s documents: ' + rs.map((r) => r.type + ' ' + r.path + ' via ' + r.via).join(', '));
    const after = await F.storedText(c);
    need(after === before, 'the saved state changed: ' + F.diff(JSON.parse(after), JSON.parse(before)));
    same(await F.live(c), JSON.parse(before), 'the state in memory');
    return 'the same ' + after.length.toLocaleString() + ' characters';
  });

  await step('nothing is duplicated, nothing deleted in Fuel came back, what was changed in Fuel stayed', async () => {
    const st = await F.stored(c), all = allIds(st.diary);
    need(all.length === COUNTS.foodEntries && new Set(all).size === all.length, all.length + ' entries, ' + new Set(all).size + ' different ids');
    need(Object.keys(st.diary).length === COUNTS.foodDays && Object.keys(st.food.foods).length === COUNTS.savedFoods - 1 && Object.keys(st.food.meals).length === COUNTS.savedMeals, 'days, saved foods or saved meals: ' + Object.keys(st.diary).length + ', ' + Object.keys(st.food.foods).length + ', ' + Object.keys(st.food.meals).length);
    need(!all.includes(E) && st.deleted.food[E] > 0, 'the entry deleted in Fuel is back');
    need(!st.food.foods[X] && st.deleted.foods[X] > 0, 'the saved food deleted in Fuel is back');
    need(all.includes('fueltestown01') && st.diary[TODAY].find((e) => e.id === M.id).kcal === M.kcal + 100, 'the entry added or the one edited in Fuel is not as it was left');
    need(Object.keys(st.deleted.food).length === COUNTS.deleted.food + 1, Object.keys(st.deleted.food).length + ' deletion records for entries');
    return all.length.toLocaleString() + ' entries on ' + Object.keys(st.diary).length + ' days, each id once';
  });

  await step('the account now holds exactly the phone\'s food log in meta/fuel and fuelDays; Overload\'s documents are untouched', async () => {
    const st = await F.stored(c), ws = cloud.writes();
    need(ws.length === COUNTS.foodDays + 1 && ws.every((w) => w.who === 'C' && w.app === 'fuel' && w.type === 'set' && w.state === 'applied' && FUEL_PATH.test(w.path)), 'writes: ' + brief(ws));
    for (const date of DATES) {
      const d = cloud.get(FUEL_DAYS + '/' + date);
      need(d && d.data === JSON.stringify(st.diary[date]), 'fuelDays/' + date + ' is not the phone\'s day');
      if (date !== TODAY && date !== YESTERDAY) need(d.data === cloud.get(OLD_DAYS + '/' + date).data, 'fuelDays/' + date + ' differs from what v2.8 uploaded');
    }
    const core = coreOfCloud(cloud);
    same(core.food, st.food, 'the saved foods, meals and targets in meta/fuel');
    same(core.deleted, st.deleted, 'the deletion records in meta/fuel');
    need(!/connKey|c0ffee00|reminders|exercises/.test(cloud.text(FUEL_META)), 'meta/fuel holds something of Overload\'s settings');
    need(overloadDocs(cloud) === overload0, 'meta/state, workouts or foodDays changed');
    return ws.length + ' sets; ' + cloud.paths(OLD_DAYS).length + ' food days of Overload as they were';
  });

  await step('a copy of the phone\'s data from before the sign-in is kept ("before cloud")', async () => {
    const copy = await F.copy(c, 'before-cloud');
    need(copy && copy.text === before, copy ? 'the copy is not the state from before the sign-in' : 'there is no such copy');
    return copy.days + ' days, ' + copy.entries + ' entries';
  });

  // The other order: sign in first, paste later.
  const D = await makePhone(world, 'D', TREE);
  await step('another phone signs in first and pastes the same text afterwards: "Nothing new", and nothing is written', async () => {
    const d = await openFuel(D);
    await signInAtWelcome(d);
    await rest(world);
    same(travels(await F.stored(d)), travels(JSON.parse(before)), 'the second phone\'s data against the first\'s');
    noOverloadReads(cloud, 0, 'D');
    const mark = cloud.mark(), had = await F.storedText(d);
    await lib.openTab(d, 'settings');
    await d.click('[data-action="fuel-import"]');
    await d.click('[data-action="fuel-paste-box"]');
    await d.fill('#fuel-paste', text);
    await d.click('#fuel-paste-form button[type="submit"]');
    await d.waitForSelector('#fuel-import-msg', { timeout: 8000 });
    const msg = await F.text(d, '#fuel-import-msg');
    need(/Nothing new/.test(msg), 'the import said: ' + msg);
    await rest(world);
    need((await F.storedText(d)) === had && cloud.writes({ from: mark }).length === 0, 'something changed or was written: ' + brief(cloud.writes({ from: mark })));
    return msg;
  });

  // A Reset replaces the data without deletion records, and a day leaves a phone only through those: so a
  // second signed-in phone keeps its log and uploads it again. (With one phone the account is emptied: see
  // the run "one phone".)
  await step('Reset on one phone while another is signed in: the other keeps its food log, and it returns to the account', async () => {
    const d = D.fuel, had = await F.live(d), mark = cloud.mark();
    await lib.openTab(c, 'settings');
    await c.click('[data-action="reset"]');
    await F.toast(c, /Reset/);
    await rest(world);
    const ws = cloud.writes({ from: mark });
    need(ws.filter((w) => w.who === 'C' && w.type === 'delete').length === COUNTS.foodDays, 'the reset did not delete the days in the account: ' + brief(ws));
    onlyFuelPaths(cloud, mark);
    const now = await F.live(d);
    same(now.diary, had.diary, 'the other phone\'s diary');
    same(now.food.foods, had.food.foods, 'the other phone\'s saved foods');
    same(now.food.meals, had.food.meals, 'the other phone\'s saved meals');
    need(cloud.paths(FUEL_DAYS).length === COUNTS.foodDays, cloud.paths(FUEL_DAYS).length + ' days in the account');
    same((await F.live(c)).diary, had.diary, 'the diary on the phone that was reset, once the other had answered');
    same(travels(await F.live(c)), travels(now), 'the two phones');
    need(overloadDocs(cloud) === overload0, 'meta/state, workouts or foodDays changed');
    const t = now.food.targets;
    return 'the log is back on both and in the account; targets on both are now ' + JSON.stringify(t) + ', units ' + now.settings.units + ', theme ' + now.settings.theme;
  });

  await step('no write or delete below meta/state, workouts or foodDays; no page error', async () => {
    onlyFuelPaths(cloud);
    need(overloadDocs(cloud) === overload0, 'meta/state, workouts or foodDays changed');
    for (const p of world.phones) F.assertClean(p, 'phone ' + p.name);
    return cloud.writes().length + ' writes in all, every one by Fuel to its own documents';
  });
  for (const p of world.phones) await p.close();
}

// ---------------------------------------------------------------------------
// 3. One phone and a new account: Create account, Reset, Restore
// ---------------------------------------------------------------------------
async function soloRun(browser) {
  const world = { browser, cloud: createCloud(), phones: [] };
  const { cloud } = world;
  const step = (title, fn) => run.step('one phone', title, fn);
  const E = await makePhone(world, 'E', TREE);
  let e = null;
  const ok = await step('Start fresh, log two foods, set a target, Create account (Settings): the phone\'s data goes up, nothing comes down', async () => {
    e = await openFuel(E);
    await e.click('[data-action="fuel-fresh"]');
    await e.waitForSelector('.f-meal');
    await F.quickAdd(e, 0, 'Porridge', 300, 10, 50, 6);
    await F.quickAdd(e, 1, 'Soup', 250, 12, 30, 8);
    await setTarget(e, 'kcal', 2200);
    const before = await F.storedText(e);
    await lib.openTab(e, 'settings');
    await useCloudForm(e, '#cloud-form [data-action="cloud-signup"]');
    await rest(world);
    const ws = cloud.writes();
    need(ws.length === 2 && ws.every((w) => w.type === 'set' && w.state === 'applied') && ws.some((w) => w.path === FUEL_META) && ws.some((w) => w.path === FUEL_DAYS + '/' + TODAY), 'writes: ' + brief(ws));
    need((await F.storedText(e)) === before, 'the phone\'s data changed at the first link to an empty account');
    need(dayOfCloud(cloud, TODAY).length === 2 && coreOfCloud(cloud).food.targets.kcal === 2200, 'the account does not hold the phone\'s data');
    need((await F.stored(e)).moved === null && !(await F.copies(e)).some((x) => x.id === 'before-cloud'), 'a hand-over or a "before cloud" copy was noted although the account held nothing');
    return 'writes: ' + brief(ws);
  });
  if (ok) {
    await step('Reset all data, signed in: the question says the account is erased too, and it is', async () => {
      const mark = cloud.mark();
      await lib.openTab(e, 'settings');
      await e.click('[data-action="reset"]');
      await F.toast(e, /Reset/);
      await rest(world);
      need(e.dialogs.some((d) => /food log in your account \(owner@example\.com\) is erased too/.test(d)), 'the question did not say so: ' + e.dialogs.slice(-2).join(' / ').slice(0, 200));
      const core = coreOfCloud(cloud), ws = cloud.writes({ from: mark });
      need(cloud.paths(FUEL_DAYS).length === 0 && ws.some((w) => w.type === 'delete' && w.path === FUEL_DAYS + '/' + TODAY), 'the day is still in the account: ' + brief(ws));
      need(core.food.targets.kcal === null && Object.keys(core.food.foods).length === 0, 'the account\'s core still holds ' + JSON.stringify(core.food.targets));
      onlyFuelPaths(cloud, mark);
      return 'writes: ' + brief(ws);
    });
    await step('Restore the copy "Before reset", signed in: the account holds the food log again', async () => {
      await lib.openTab(e, 'settings');
      await e.click('#safety-copies [data-action="restore-copy"][data-id="before-reset"]', { timeout: 8000 });
      await F.toast(e, /Copy restored/);
      await rest(world);
      need(e.dialogs.some((d) => /is replaced too/.test(d)), 'the question did not say the account\'s copy is replaced');
      need((dayOfCloud(cloud, TODAY) || []).length === 2 && coreOfCloud(cloud).food.targets.kcal === 2200, 'the account does not hold the restored data');
      onlyFuelPaths(cloud);
      F.assertClean(E, 'phone E');
      return '2 entries and the target are in the account again';
    });
  }
  for (const p of world.phones) await p.close();
}

// ---------------------------------------------------------------------------
(async () => {
  console.log('# Fuel and the root app from ' + TREE + (TREE === lib.REPO ? ' (the working tree)' : ' (a copy)') + '; v2.8 from git ' + V28_COMMIT);
  const v28 = extractV28();
  const browser = await lib.launch();
  let docs = null;
  try {
    // The second run starts from the documents v2.8 uploaded in the first.
    const made = args.only === 'solo' ? null : await accountRun(browser, v28, args.only === 'clipboard').catch((e) => { run.say(false, 'account', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); return null; });
    docs = made && made.docs;
    if (args.only !== 'account' && args.only !== 'solo') {
      if (!docs) run.say(false, 'clipboard first', 'needs the account v2.8 fills in the first run', 'not run');
      else await clipboardRun(browser, docs).catch((e) => run.say(false, 'clipboard first', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')));
    }
    if (!args.only || args.only === 'solo') await soloRun(browser).catch((e) => run.say(false, 'one phone', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')));
  } finally {
    await browser.close();
  }
  run.done();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
