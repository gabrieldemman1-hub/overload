#!/usr/bin/env node
/* Fuel 3.0: cloud sync (fuel/sync.js) against the fake Firebase in tests/fake-firebase/.
 *
 *   node tests/fuel-sync.js [--only=account|clipboard|returning|race|early|firstlink|lost|solo|rules] [--app=<folder>] [--port=8430]
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
 *   - That first sign-in brings the log by the rules of Paste from Overload (fuel.js planImport, review
 *     findings H1 and H4): a saved food both hold takes Overload's star, a list copy takes his corrected one,
 *     one he corrected in Fuel or deleted there stays as it is; an entry counts as already here only on the
 *     same day. Signing in and then pasting gives exactly what Paste alone gives, the paste finds nothing new,
 *     and pasting first and then signing in ends byte for byte the same (run "rules").
 *   - A second Fuel phone: an added, an edited and a deleted entry, a deleted saved food and saved meal, a
 *     changed target and a day that lost its last entry travel both ways, and nothing deleted comes back,
 *     also not when a phone that was offline sends its old copies later.
 *   - A phone never sends an old copy over another phone's changes (review finding sync#1): a change made
 *     without signal waits on the phone and goes up merged once the server's copy is in; a merge keeps a
 *     phone's value only for what it changed itself since the copy its note names (each target, the theme,
 *     units with the body weight, each saved food and meal, each entry). So another phone's edited entry,
 *     corrected food, target and theme stand when a phone comes back after a while without signal (run
 *     "returning"), when its uploads were held up on the way and land late ("queued replay"), and when two
 *     phones make the first sign-in at the same moment (run "race"). Every document says which copy its
 *     writer had (base), and the note keeps what it needs (parts, own).
 *   - Reset on one phone while another is signed in: the other follows, except for what was logged or
 *     changed on it since it last synced; the question says so, and its advice works.
 *   - Reset while signed in, on a start where the sync module has not loaded yet: the question says the account
 *     is erased too, the note stays, and the reset reaches the account once the module runs (sync#2, run "early").
 *   - An account that holds Overload's core but no food days gives what it has; the log pasted afterwards
 *     goes up without doubling anything. Signing in there takes none of Overload's deletion records, so that
 *     signing in and Paste from Overload end the same in either order there too (sync#5, run "rules").
 *   - Nothing is uploaded while the first server read has not worked; an upload the cloud refuses is sent
 *     again; a day whose name is not a date or an entry without an id is never sent; a note left behind on a
 *     phone that lost its data deletes nothing, also when the sync module arrives after Start fresh was tapped
 *     (and when the note cannot be removed at start); Reset and Restore while signed in change the account's
 *     copy; with a second phone signed in, the Reset question says what that phone does, and its advice works.
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
// A slow network for the sync module: the three Firebase files are held back until release(). fuel.js and
// food.js (classic scripts) have drawn the screen long before; the module runs only once its imports arrive.
// (A route added later is asked first; fallback hands the request on to the fake cloud's.)
const SDK = /^https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-(app|auth|firestore)\.js(\?.*)?$/;
async function holdSdk(phone) {
  let held = true; const waiting = [];
  await phone.context.route(SDK, async (route) => { if (held) await new Promise((r) => waiting.push(r)); return route.fallback(); });
  return { release() { held = false; waiting.splice(0).forEach((r) => r()); } };
}
// Firebase slow to say who is signed in (Auth's own storage slow, or IndexedDB not answering): the module has loaded and
// put window.__overloadSync in the page, and its onAuthStateChanged has not been called yet. The fake auth SDK is served
// with its first report held back until release(page) (review finding data#5, as the verifier's authwindow.js).
const AUTH_SDK = /^https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-auth\.js(\?.*)?$/;
async function holdAuth(phone) {
  const FIRST = 'ready(auth).then(() => { if (auth.subs.has(next)) next(auth.currentUser); });';
  const real = fs.readFileSync(path.join(__dirname, 'fake-firebase', 'firebase-auth.js'), 'utf8');
  if (!real.includes(FIRST)) throw new Error('the fake auth SDK changed: its first report cannot be held back here');
  const text = 'window.__authHeld = new Promise((r) => { window.__releaseAuth = r; });\n'
    + real.replace(FIRST, 'ready(auth).then(() => window.__authHeld).then(() => { if (auth.subs.has(next)) next(auth.currentUser); });');
  const serve = (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: text });
  await phone.context.route(AUTH_SDK, serve);
  return { async release(page) { await phone.context.unroute(AUTH_SDK, serve); if (!page.isClosed()) await page.evaluate(() => window.__releaseAuth && window.__releaseAuth()); } };
}
// Fuel, started, before its sync module has run (the page's load event waits for the module, so not openApp).
async function openFuelEarly(phone) {
  const page = await phone.context.newPage();
  page.dialogs = [];
  page.on('dialog', (d) => { page.dialogs.push(d.type() + ': ' + d.message()); d.accept().catch(() => {}); });
  await page.goto(ORIGIN + F.PAGE, { waitUntil: 'commit' });
  await page.waitForFunction(() => !!window.__overload && !!window.__overloadFood, null, { timeout: 15000 });
  phone.pages.push(page); phone.fuel = page;
  return page;
}

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
// The account's food log as one state: meta/fuel's core with the days of fuelDays.
function coreAndDays(cloud) {
  const diary = {};
  cloud.paths(FUEL_DAYS).forEach((p) => { diary[p.split('/').pop()] = JSON.parse(cloud.get(p).data); });
  return Object.assign({}, coreOfCloud(cloud), { diary });
}
// Holds a page's uploads on the way to the cloud, as when the connection drops without the phone noticing: the
// app's writes are issued, and wait (window.__held counts them) until release() lets them go, in order.
async function holdCommits(page) {
  await page.evaluate(() => {
    const real = window.__fakeFirebase, waiting = [];
    window.__held = 0;
    window.__releaseCommits = () => { window.__fakeFirebase = real; waiting.splice(0).forEach((r) => r()); };
    window.__fakeFirebase = (op, p) => (op === 'fs.commit' ? (window.__held++, new Promise((r) => waiting.push(r)).then(() => real(op, p))) : real(op, p));
  });
  return { release: () => page.evaluate(() => window.__releaseCommits()) };
}
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
    same(Object.keys(d).sort(), ['base', 'core', 'updatedAt', 'v'], 'the fields of meta/fuel');
    // base: the copy the writer had taken in; on an account new to Fuel there was none.
    need(typeof d.core === 'string' && d.v === 1 && typeof d.updatedAt === 'number' && d.base === null, 'meta/fuel is ' + text.slice(0, 80));
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

  await first('every fuelDays document is { data, updatedAt, v: 1, base: null } with that day\'s entries exactly as v2.8 uploaded them', async () => {
    for (const date of DATES) {
      const d = cloud.get(FUEL_DAYS + '/' + date), o = cloud.get(OLD_DAYS + '/' + date);
      need(d && typeof d.data === 'string' && d.v === 1 && typeof d.updatedAt === 'number' && d.base === null && Object.keys(d).length === 4, 'fuelDays/' + date + ' is ' + JSON.stringify(d).slice(0, 80));
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

  await first('the note fuel.sync.v1 lists the account, the core and every day, with their parts; no "before cloud" copy of an empty phone', async () => {
    const n = await noteOf(a), text = await lib.readStorageText(a, NOTE);
    need(n && n.uid === 'U1' && n.email === EMAIL && /^h/.test(n.core) && Object.keys(n.days).length === COUNTS.foodDays, 'the note is ' + JSON.stringify(n).slice(0, 120));
    same(Object.keys(n).sort(), ['core', 'days', 'email', 'own', 'parts', 'uid'], 'the fields of the note');
    // The parts name the copies the note names, and hold one short hash per item (no copy of the data itself).
    need(n.parts.core.h === n.core && DATES.every((d) => n.parts.days[d] && n.parts.days[d].h === n.days[d]), 'the parts do not name the noted copies');
    const entries = DATES.reduce((k, d) => k + n.parts.days[d].n.split(' ').length, 0);
    need(entries === COUNTS.foodEntries && !text.includes('"name"') && !text.includes('kcal'), entries + ' entry hashes, or data in the note');
    need(!(await F.copies(a)).some((c) => c.id === 'before-cloud'), 'a copy of the empty phone was kept as "before cloud"');
    need((await lib.readStorage(a, 'overload.sync.v1')) === null, 'Fuel wrote Overload\'s note');
    return Object.keys(n.days).length + ' days noted; the note is ' + text.length.toLocaleString() + ' characters';
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
    // (A may send the day once more, as it now has it, when its own upload timer runs before the day arrives.
    // What must never happen: a copy of the day with the deleted entry going up again, or A sending the core back.)
    const ws = cloud.writes({ from: mark });
    need(ws.filter((w) => w.type === 'set' && w.path === FUEL_DAYS + '/' + YESTERDAY).every((w) => !ids(JSON.parse(JSON.parse(w.json).data)).includes(E1)), 'the day went up with the deleted entry: ' + brief(ws));
    need(!ws.some((w) => w.who === 'A' && w.path === FUEL_META), 'A sent the core in answer: ' + brief(ws));
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
    // (B may delete the document once more, when its own upload timer runs before the news of the deletion arrives.)
    need(!ws.some((w) => w.type === 'set' && w.path === FUEL_DAYS + '/' + D0), 'the day was put back: ' + brief(ws.filter((w) => w.type === 'set')));
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

  // ---- a phone without signal: its change waits on the phone and goes up merged (review finding sync#1) ----
  // Meanwhile the other phone deletes an entry of that day and a saved food, edits another entry of that day,
  // corrects a saved food, changes a target and the theme. None of that may be undone by the phone coming back.
  const late = (title, fn) => step('without signal', title, fn);
  const E5 = fx.state.diary[TODAY][3].id, W = plain[4];
  const aChanges = (pg, gone1, food1, edit1, corr1, kcal, theme) => pg.evaluate(([d, g, f, e, c, k, t]) => {
    const O = window.__overload, s = O.state;
    s.diary[d] = s.diary[d].filter((x) => x.id !== g).map((x) => (x.id === e ? Object.assign({}, x, { kcal: x.kcal + 100 }) : x));
    O.lib.markDeleted('food', g);
    delete s.food.foods[f]; O.lib.markDeleted('foods', f);
    s.food.foods[c] = Object.assign({}, s.food.foods[c], { src: 'custom', n: Object.assign({}, s.food.foods[c].n, { kcal: 999 }) });
    s.food.targets.kcal = k; s.settings.theme = t;
    O.save(); O.render();
  }, [TODAY, gone1, food1, edit1, corr1, kcal, theme]);
  // A's changes, as they must stand on both phones and in the account.
  const aStands = (st, gone1, food1, edit1, editKcal, corr1, kcal, theme) => [
    ids(st.diary[TODAY]).includes(gone1) && 'the deleted entry is back', st.food.foods[food1] && 'the deleted food is back',
    ((st.diary[TODAY] || []).find((e) => e.id === edit1) || {}).kcal !== editKcal && 'the edited entry has ' + ((st.diary[TODAY] || []).find((e) => e.id === edit1) || {}).kcal,
    !(st.food.foods[corr1] && st.food.foods[corr1].n.kcal === 999 && st.food.foods[corr1].src === 'custom') && 'the corrected food is not as corrected',
    st.food.targets.kcal !== kcal && 'the target is ' + st.food.targets.kcal, st.settings.theme !== theme && 'the theme is ' + st.settings.theme
  ].filter(Boolean);
  await late('B logs a saved food without signal: nothing is sent or queued, it waits on the phone; meanwhile A changes six things', async () => {
    await B.device.setOffline(true);
    const mark = cloud.mark();
    await addEntry(b, TODAY, 'fueltestlate1', 'Logged offline', 111, Z);
    await rest(world);
    const ws = cloud.writes({ who: 'B', from: mark });
    need(ws.length === 0 && B.device.queued('fuel').length === 0, 'B issued writes: ' + brief(ws));
    need(ids((await F.stored(b)).diary[TODAY]).includes('fueltestlate1'), 'the entry is not saved on B');
    await aChanges(a, E2, Y, E5, W, 2468, 'light');
    await rest(world);
    const sb = await F.live(b);
    need(ids(sb.diary[TODAY]).includes(E2) && !!sb.food.foods[Y], 'B knows already: this check needs it not to');
    need(aStands(coreAndDays(cloud), E2, Y, E5, fx.state.diary[TODAY][3].kcal + 100, W, 2468, 'light').length === 0, 'A\'s changes are not in the account');
    return 'B holds a change to send, made on its copy from before A\'s';
  });
  await late('B is online again: its change goes up merged; A\'s changes stand on both phones and in the account, nothing deleted comes back', async () => {
    const mark = cloud.mark();
    await B.device.setOffline(false);
    await rest(world);
    onlyFuelPaths(cloud, mark);
    const ws = cloud.writes({ who: 'B', from: mark });
    need(ws.every((w) => w.type === 'set' && (w.path === FUEL_META || w.path === FUEL_DAYS + '/' + TODAY)), 'B wrote ' + brief(ws));
    need(ws.every((w) => !ids(w.path === FUEL_META ? [] : JSON.parse(JSON.parse(w.json).data)).includes(E2)), 'B sent the day with the deleted entry: ' + brief(ws));
    const core = coreOfCloud(cloud);
    need(core.deleted.foods[Y] > 0 && core.deleted.food[E2] > 0, 'the records are gone');
    need(core.food.foods[Z].used >= NOW, 'the food logged offline lost its "used" time');
    for (const [name, st] of [['the account', coreAndDays(cloud)], ['A', await F.live(a)], ['B', await F.live(b)]]) {
      const bad = aStands(st, E2, Y, E5, fx.state.diary[TODAY][3].kcal + 100, W, 2468, 'light');
      need(!bad.length, name + ': ' + bad.join(', '));
      need(ids(st.diary[TODAY]).includes('fueltestlate1'), name + ' lacks the entry logged offline');
      need(gone(st).length === 0, name + ' has ' + gone(st).join(', ') + ' again');
    }
    same(travels(await F.live(a)), travels(await F.live(b)), 'A against B');
    return 'writes after B came back: ' + brief(cloud.writes({ from: mark }));
  });

  // ---- uploads held up on the way: the phone thought it had signal, and its writes land late ----
  // (A connection that drops without the phone noticing: the SDK queues the writes and sends them later.) They
  // are B's copies from before A's changes, and arrive after them. A sees from their base that B did not have
  // its copies, keeps what it changed itself, and sends the merge; B takes it.
  const queued = (title, fn) => step('queued replay', title, fn);
  const E6 = fx.state.diary[TODAY][4].id, E7 = fx.state.diary[TODAY][5].id, Q = plain[5], W2 = plain[6];
  let held = null;
  await queued('B logs a saved food; its uploads are held up on the way; meanwhile A changes six things', async () => {
    held = await holdCommits(b);
    const mark = cloud.mark();
    await addEntry(b, TODAY, 'fueltestlate2', 'Held up on the way', 112, Z);
    await rest(world);
    need((await b.evaluate(() => window.__held)) === 1 && cloud.writes({ who: 'B', from: mark }).length === 0, 'B\'s upload is not held: ' + brief(cloud.writes({ who: 'B', from: mark })));
    await aChanges(a, E6, Q, E7, W2, 2333, 'dark');
    await rest(world);
    need(aStands(coreAndDays(cloud), E6, Q, E7, fx.state.diary[TODAY][5].kcal + 100, W2, 2333, 'dark').length === 0, 'A\'s changes are not in the account');
    return 'B\'s upload of the core and the day waits; A\'s changes are in the account';
  });
  await queued('B\'s held-up copies land after A\'s: A\'s changes stand on both phones and in the account, B\'s entry stays', async () => {
    const mark = cloud.mark();
    await held.release();
    await rest(world);
    const late2 = cloud.writes({ who: 'B', from: mark });
    need(late2.some((w) => w.path === FUEL_DAYS + '/' + TODAY && ids(JSON.parse(JSON.parse(w.json).data)).includes(E6)), 'B\'s old copy of the day never reached the account: this check needs it to: ' + brief(late2));
    onlyFuelPaths(cloud, mark);
    for (const [name, st] of [['the account', coreAndDays(cloud)], ['A', await F.live(a)], ['B', await F.live(b)]]) {
      const bad = aStands(st, E6, Q, E7, fx.state.diary[TODAY][5].kcal + 100, W2, 2333, 'dark');
      need(!bad.length, name + ': ' + bad.join(', '));
      need(ids(st.diary[TODAY]).includes('fueltestlate2') && ids(st.diary[TODAY]).includes('fueltestlate1'), name + ' lacks an entry B logged');
      need(gone(st).length === 0, name + ' has ' + gone(st).join(', ') + ' again');
    }
    same(travels(await F.live(a)), travels(await F.live(b)), 'A against B');
    return 'writes once they landed: ' + brief(cloud.writes({ from: mark }));
  });

  // ---- the first server read fails ----
  const fail = (title, fn) => step('first read fails', title, fn);
  let bBefore = null, bBeforeText = null;
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
    bBefore = await F.live(b); bBeforeText = await F.storedText(b);
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
    // The copy holds the phone's data as it was before the account's was merged in (its text is taken before setState).
    const copy = await F.copy(b, 'before-cloud', (c) => c.text === bBeforeText);
    need(copy && copy.text === bBeforeText, copy ? 'the "before cloud" copy is not the phone\'s data from before the link' : 'no "before cloud" copy of the phone\'s data was kept');
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
  await again('signed in again (Settings): no first link; once the server holds the copies the note names, the three changes go up and reach the other phone', async () => {
    const mark = cloud.mark();
    await signInInSettings(a);
    await rest(world);
    // Not a first link (that lists fuelDays): only the documents with something to send are asked for, to see that
    // the server holds the copies the note names (nothing changed there meanwhile, so no listener says so).
    const gets = cloud.reads({ who: 'A', from: mark }).filter((r) => r.via === 'get');
    const asked = [FUEL_META, FUEL_DAYS + '/' + TODAY, FUEL_DAYS + '/' + YESTERDAY];
    need(gets.every((r) => r.type === 'get' && asked.includes(r.path)) && asked.every((p) => gets.some((r) => r.path === p)), 'the server reads: ' + gets.map((r) => r.type + ' ' + r.path).join(', '));
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

  // The same with the sign-in remembered and a slow network: the sync module runs only once its imports have
  // arrived, and he can tap Start fresh on Welcome before that (dev/notes/review-findings.md, S2; the
  // reviewer's r8). Start fresh saves an empty diary, so by the time the module looks, saved data exists.
  // Twice: as it is, and with the note that cannot be removed at start, which leaves cloud sync's own guard
  // (window.__overload.startedWithData) as the only thing between the old note and the account.
  for (const stuck of [false, true]) {
    await guard('signed in, saved data lost, the sync module late, Start fresh tapped before it runs' + (stuck ? ', and the note cannot be removed at start' : '') + ': nothing is deleted', async () => {
      const days = JSON.stringify(cloud.snapshot(FUEL_DAYS)), core = cloud.get(FUEL_META).core, want = travels(await F.live(b));
      need((await noteOf(b)).uid === 'U1' && (await b.evaluate(() => !!window.__overloadSync.user)), 'B is not signed in with a note');
      if (stuck) {
        // From the next page on: the phone refuses to remove the note while a test key says so.
        await B.context.addInitScript(() => {
          const real = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function (k) { if (k === 'fuel.sync.v1' && localStorage.getItem('test.keepnote')) throw new DOMException('refused', 'SecurityError'); return real.call(this, k); };
        });
        await b.evaluate(() => localStorage.setItem('test.keepnote', '1'));
      }
      await b.evaluate((k) => localStorage.removeItem(k), F.KEY);
      await closeFuel(B);
      const sdk = await holdSdk(B), mark = cloud.mark();
      let note = null;
      try {
        b = await openFuelEarly(B);
        need((await F.screen(b)) === 'welcome' && !(await b.evaluate(() => !!window.__overloadSync)), 'this check needs Welcome before the sync module runs');
        note = await noteOf(b);
        if (stuck) need(note && note.uid === 'U1', 'this check needs the note to be left in storage');
        await b.click('[data-action="fuel-fresh"]');
        await b.waitForSelector('.f-meal');
        need((await F.stored(b)) !== null && Object.keys((await F.stored(b)).diary).length === 0, 'Start fresh did not save an empty diary');
      } finally {
        sdk.release();   // whatever happened above: the next checks need the module
        if (stuck) await b.evaluate(() => localStorage.removeItem('test.keepnote')).catch(() => {});
      }
      await b.waitForFunction(() => !!window.__overloadSync, null, { timeout: 15000 });
      await rest(world);
      const ws = cloud.writes({ from: mark });
      need(!ws.some((w) => w.type === 'delete'), 'days were deleted in the account: ' + brief(ws.filter((w) => w.type === 'delete')));
      need(JSON.stringify(cloud.snapshot(FUEL_DAYS)) === days && cloud.get(FUEL_META).core === core, 'the account changed: ' + brief(ws));
      need(cloud.reads({ who: 'B', from: mark }).some((r) => r.path === FUEL_META && r.via === 'get'), 'the account was not read first (the note was trusted)');
      same(travels(await F.live(b)), want, 'B\'s data once the module ran');
      return 'at Welcome the note was ' + (note ? 'still stored' : 'gone') + '; ' + Object.keys(want.diary).length + ' days back on the phone; writes: ' + brief(ws);
    });
  }

  await guard('the same when he was signed out, taps Start fresh and then signs in: the note left behind is gone at start, nothing is deleted', async () => {
    const days = JSON.stringify(cloud.snapshot(FUEL_DAYS)), core = cloud.get(FUEL_META).core, want = travels(await F.live(b));
    await signOutInSettings(b);
    need((await noteOf(b)).uid === 'U1', 'B has no note');
    await b.evaluate((k) => localStorage.removeItem(k), F.KEY);
    await closeFuel(B);
    const mark = cloud.mark();
    b = await openFuel(B);
    need((await F.screen(b)) === 'welcome', 'the screen is ' + await F.screen(b));
    need((await noteOf(b)) === null, 'the note is still stored next to no saved data');
    await b.click('[data-action="fuel-fresh"]');
    await b.waitForSelector('.f-meal');
    need(Object.keys((await F.stored(b)).diary).length === 0, 'this check needs an empty diary');
    await signInInSettings(b);
    await rest(world);
    const ws = cloud.writes({ from: mark });
    need(!ws.some((w) => w.type === 'delete'), 'days were deleted in the account: ' + brief(ws.filter((w) => w.type === 'delete')));
    need(ws.length === 0 && JSON.stringify(cloud.snapshot(FUEL_DAYS)) === days && cloud.get(FUEL_META).core === core, 'the account changed: ' + brief(ws));
    same(travels(await F.live(b)), want, 'B\'s data after signing in');
    return Object.keys(want.diary).length + ' days back on the phone, no write';
  });

  await guard('of the settings only units and theme are sent; a setting that only one phone has stays on that phone', async () => {
    await a.evaluate(() => { const O = window.__overload; O.state.settings.onlyHere = 'kept on this phone'; O.state.settings.theme = 'light'; O.save(); });
    await rest(world);
    same(coreOfCloud(cloud).settings, { units: 'lb', theme: 'light' }, 'settings in meta/fuel');
    need(!cloud.text(FUEL_META).includes('onlyHere'), 'the other setting is in meta/fuel');
    same((await F.live(b)).settings, { units: 'lb', theme: 'light' }, 'B\'s settings');
    await b.evaluate(() => { const O = window.__overload; O.state.settings.theme = 'dark'; O.save(); });
    await rest(world);
    same((await F.live(a)).settings, { units: 'lb', theme: 'dark', onlyHere: 'kept on this phone' }, 'A\'s settings after B changed the theme');
    await a.evaluate(() => { const O = window.__overload; delete O.state.settings.onlyHere; O.save(); });
    await rest(world);
    same(travels(await F.live(a)), travels(await F.live(b)), 'A against B');
    return 'meta/fuel: ' + JSON.stringify(coreOfCloud(cloud).settings);
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

  // A Reset replaces the data without deletion records. A second signed-in phone follows it: what its note says
  // the account held, it did not change since, and the account no longer holds, goes there too (review finding
  // sync#1: the cloud's absence of what the noted copy held means it was removed on another phone). What was
  // logged or changed on that phone since it last synced stays, and comes back. (With one phone the account is
  // emptied: see the run "one phone".) The question says so (review findings S3, sync#1), and the next step does
  // what it advises.
  await step('Reset on one phone while another is signed in: the other follows, except the entry it logged without signal, which comes back; the question says so', async () => {
    const d = D.fuel, mark = cloud.mark();
    await D.device.setOffline(true);
    await addEntry(d, TODAY, 'fueltestkeep1', 'Logged on the other phone', 123);
    await rest(world);
    await lib.openTab(c, 'settings');
    const asked = c.dialogs.length;
    await c.click('[data-action="reset"]');
    await F.toast(c, /Reset/);
    const q = c.dialogs.slice(asked).join(' / ');
    need(/the food log in your account \(owner@example\.com\) is erased too\. Another phone signed in to this account does the same, except for what was logged or changed on it since it last synced: that comes back\. To be sure nothing comes back, sign out on that phone first, and reset it before you sign in there again\./.test(q), 'the question reads: ' + q.replace(/\n+/g, ' | '));
    await rest(world);
    const ws = cloud.writes({ from: mark });
    need(ws.filter((w) => w.who === 'C' && w.type === 'delete').length === COUNTS.foodDays, 'the reset did not delete the days in the account: ' + brief(ws));
    await D.device.setOffline(false);
    await rest(world);
    onlyFuelPaths(cloud, mark);
    const sc = await F.live(c), sd = await F.live(d);
    for (const [name, st] of [['the account', coreAndDays(cloud)], ['C', sc], ['D', sd]]) {
      same(Object.keys(st.diary), [TODAY], name + '\'s days');
      same(ids(st.diary[TODAY]), ['fueltestkeep1'], name + '\'s entries');
      need(!Object.keys(st.food.foods).length && !Object.keys(st.food.meals).length && st.food.targets.kcal == null, name + ' holds ' + Object.keys(st.food.foods).length + ' saved foods, ' + Object.keys(st.food.meals).length + ' saved meals, target ' + st.food.targets.kcal);
    }
    same(travels(sc), travels(sd), 'the two phones');
    need(overloadDocs(cloud) === overload0, 'meta/state, workouts or foodDays changed');
    return 'the account and both phones hold the one entry logged on D; writes after D came back: ' + brief(cloud.writes({ from: mark }).filter((w) => w.who === 'D'));
  });

  // Signing the other phone out alone is not enough: at its next sign-in it sends what changed on it back (its
  // note is kept on sign-out). Reset there while signed out forgets the note, and its next sign-in takes the
  // account's copy.
  await step('as the question advises: sign out on the other phone and reset it, then Reset here; nothing comes back, also not when it signs in again', async () => {
    const d = D.fuel, mark = cloud.mark();
    await F.closeSheet(d);   // the import sheet of the paste above
    await signOutInSettings(d);
    await d.click('[data-action="reset"]');
    await F.toast(d, /Reset/);
    await lib.openTab(c, 'settings');
    await c.click('[data-action="reset"]');
    await F.toast(c, /Reset/);
    await rest(world);
    need(cloud.paths(FUEL_DAYS).length === 0, cloud.paths(FUEL_DAYS).length + ' days in the account after the reset');
    await signInInSettings(d);
    await rest(world);
    const sc = await F.live(c), sd = await F.live(d), core = coreOfCloud(cloud);
    need(cloud.paths(FUEL_DAYS).length === 0 && Object.keys(core.food.foods).length === 0 && Object.keys(core.food.meals).length === 0, 'the account holds ' + cloud.paths(FUEL_DAYS).length + ' days, ' + Object.keys(core.food.foods).length + ' saved foods');
    for (const [name, st] of [['C', sc], ['D', sd]]) need(Object.keys(st.diary).length === 0 && Object.keys(st.food.foods).length === 0 && Object.keys(st.food.meals).length === 0, name + ' holds ' + Object.keys(st.diary).length + ' days, ' + Object.keys(st.food.foods).length + ' saved foods');
    need(!!(await F.copy(d, 'before-reset')), 'the other phone kept no copy of its log');
    onlyFuelPaths(cloud, mark);
    need(overloadDocs(cloud) === overload0, 'meta/state, workouts or foodDays changed');
    return 'the account and both phones are empty; writes: ' + brief(cloud.writes({ from: mark }));
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
// 3. The account has Overload's core but no food days (cloud sync was turned on in Overload after 2.8, which
//    uploads no food): signing in brings what is there, and the log itself still comes by Copy my food log
// ---------------------------------------------------------------------------
async function noDaysRun(browser, docs) {
  const world = { browser, cloud: createCloud(), phones: [] };
  const { cloud } = world;
  const step = (title, fn) => run.step('account without food days', title, fn);
  cloud.addAccount(EMAIL, PASSWORD);
  Object.keys(docs).filter((p) => !p.startsWith(OLD_DAYS + '/')).forEach((p) => cloud.docs.set(p, docs[p]));
  const overload0 = overloadDocs(cloud);
  const G = await makePhone(world, 'G', TREE, { clipboard: true });
  let g = null;
  const ok = await step('signing in at Welcome brings saved foods, saved meals and targets; Settings still offers to bring the log', async () => {
    g = await openFuel(G);
    await signInAtWelcome(g);
    await rest(world);
    const st = await F.stored(g);
    same(st.food.foods, fx.state.food.foods, 'food.foods');
    same(st.food.meals, fx.state.food.meals, 'food.meals');
    same(st.food.targets, fx.state.food.targets, 'food.targets');
    need(Object.keys(st.diary).length === 0 && st.moved === null, 'diary days: ' + Object.keys(st.diary).length + ', moved: ' + JSON.stringify(st.moved));
    const ws = cloud.writes();
    need(ws.length === 1 && ws[0].path === FUEL_META && ws[0].state === 'applied', 'writes: ' + brief(ws));
    await lib.openTab(g, 'settings');
    need(/can be brought here at any time/.test(await F.text(g, '#app')), 'Settings says the log was brought across');
    return Object.keys(st.food.foods).length + ' saved foods, ' + Object.keys(st.food.meals).length + ' saved meals, no days; one write (meta/fuel)';
  });
  if (ok) {
    await step('then the food log is pasted (Settings): every day goes up to fuelDays, saved foods are not doubled', async () => {
      const mark = cloud.mark();
      await g.click('[data-action="fuel-import"]');
      await g.click('[data-action="fuel-paste-box"]');
      await g.fill('#fuel-paste', F.foodText(F.payloadFrom(fx.state, NOW - 60000), true));
      await g.click('#fuel-paste-form button[type="submit"]');
      await F.toast(g, /Brought in/);
      await rest(world);
      const st = await F.stored(g), ws = cloud.writes({ from: mark });
      same(st.diary, fx.state.diary, 'diary');
      same(st.food.foods, fx.state.food.foods, 'food.foods');
      need(ws.filter((w) => w.type === 'set' && w.path.startsWith(FUEL_DAYS + '/') && w.state === 'applied').length === COUNTS.foodDays && ws.every((w) => FUEL_PATH.test(w.path)), 'writes: ' + brief(ws));
      for (const date of DATES) need(cloud.get(FUEL_DAYS + '/' + date).data === JSON.stringify(st.diary[date]), 'fuelDays/' + date + ' is not the phone\'s day');
      same(coreOfCloud(cloud).deleted.food, fx.state.deleted.food, 'the deletion records in meta/fuel');
      need(overloadDocs(cloud) === overload0, 'meta/state or workouts changed');
      onlyFuelPaths(cloud);
      F.assertClean(G, 'phone G');
      return COUNTS.foodDays + ' days written; ' + Object.keys(st.food.foods).length + ' saved foods';
    });
  }
  for (const p of world.phones) await p.close();
}

// The account as v2.8 left it (its documents, text for text), for a run of its own.
function v28Account(docs) {
  const world = { browser: null, cloud: createCloud(), phones: [] };
  world.cloud.addAccount(EMAIL, PASSWORD);
  Object.keys(docs).forEach((p) => world.cloud.docs.set(p, docs[p]));
  return world;
}

// ---------------------------------------------------------------------------
// 4. A phone put away for a month comes back without signal and logs a saved food (review finding sync#1, the
//    reviewer's t6). Meanwhile the daily phone changed the targets and the theme, corrected a saved food and
//    edited an entry of an older day. Nothing of that may be undone, on either phone or in the account.
// ---------------------------------------------------------------------------
async function returningRun(browser, docs) {
  const world = v28Account(docs), { cloud } = world;
  world.browser = browser;
  const step = (title, fn) => run.step('returning phone', title, fn);
  const A = await makePhone(world, 'A', TREE), B = await makePhone(world, 'B', TREE);
  const OLD = '2026-11-19', M = fx.state.diary[OLD][2];
  const foods = Object.keys(fx.state.food.foods).sort(), Z = foods[3], W = foods[5];
  const later = NOW + 30 * 864e5;
  let a = null, b = null, today = null;
  const aStands = (st) => [
    !(st.food.targets.kcal === 2222 && st.food.targets.protein === 190 && st.food.targets.carbs === 200 && st.food.targets.fat === 70) && 'targets ' + JSON.stringify(st.food.targets),
    !(st.food.foods[W] && st.food.foods[W].src === 'custom' && st.food.foods[W].n.kcal === 777) && 'the corrected food has ' + (st.food.foods[W] && st.food.foods[W].n.kcal),
    st.settings.theme !== 'light' && 'theme ' + st.settings.theme,
    ((st.diary[OLD] || []).find((e) => e.id === M.id) || {}).kcal !== M.kcal + 50 && 'the edited entry has ' + ((st.diary[OLD] || []).find((e) => e.id === M.id) || {}).kcal
  ].filter(Boolean);
  const ok = await step('A and B sign in at Welcome; B is put away; 30 days later A changes the targets and the theme, corrects a saved food and edits an entry of ' + OLD, async () => {
    a = await openFuel(A); await signInAtWelcome(a); await rest(world);
    b = await openFuel(B); await signInAtWelcome(b); await rest(world);
    same(travels(await F.live(a)), travels(await F.live(b)), 'A against B');
    await closeFuel(B);
    for (const p of [A, B]) await p.context.clock.setSystemTime(new Date(later));
    await closeFuel(A); a = await openFuel(A); await rest(world);
    await a.evaluate(([w, d, m]) => {
      const O = window.__overload, s = O.state;
      s.food.targets = { kcal: 2222, protein: 190, carbs: 200, fat: 70 };
      s.food.foods[w] = Object.assign({}, s.food.foods[w], { src: 'custom', n: Object.assign({}, s.food.foods[w].n, { kcal: 777 }) });
      s.settings.theme = 'light';
      s.diary[d] = s.diary[d].map((e) => (e.id === m ? Object.assign({}, e, { kcal: e.kcal + 50 }) : e));
      O.save(); O.render();
    }, [W, OLD, M.id]);
    await rest(world);
    const bad = aStands(coreAndDays(cloud));
    need(!bad.length, 'the account: ' + bad.join(', '));
    return 'the account holds A\'s four changes';
  });
  if (ok) {
    await step('B is opened without signal and logs a saved food today: nothing is sent or queued', async () => {
      await B.device.setOffline(true);
      const mark = cloud.mark();
      b = await openFuel(B);
      await rest(world);
      today = await b.evaluate(() => window.__overload.lib.todayKey());
      await addEntry(b, today, 'fuelreturn01', 'Logged on the way back', 150, Z);
      await rest(world);
      need(cloud.writes({ who: 'B', from: mark }).length === 0 && B.device.queued('fuel').length === 0, 'B issued writes: ' + brief(cloud.writes({ who: 'B', from: mark })));
      need(aStands(await F.live(b)).length === 4, 'B knows already: this check needs it not to');
      return 'B holds its entry of ' + today + ', on its copy from a month ago';
    });
    await step('B gets signal: A\'s changes stand on both phones and in the account; B\'s entry and the food\'s new "used" time reach A', async () => {
      const mark = cloud.mark();
      await B.device.setOffline(false);
      await rest(world);
      onlyFuelPaths(cloud, mark);
      for (const [name, st] of [['the account', coreAndDays(cloud)], ['A', await F.live(a)], ['B', await F.live(b)]]) {
        const bad = aStands(st);
        need(!bad.length, name + ': ' + bad.join(', '));
        need((st.diary[today] || []).some((e) => e.id === 'fuelreturn01') && st.food.foods[Z].used >= later, name + ' lacks B\'s entry or the food\'s "used" time');
      }
      same(travels(await F.live(a)), travels(await F.live(b)), 'A against B');
      for (const p of [A, B]) F.assertClean(p, 'phone ' + p.name);
      return 'writes: ' + brief(cloud.writes({ from: mark }));
    });
  }
  for (const p of world.phones) await p.close();
}

// ---------------------------------------------------------------------------
// 5. Two phones make the first sign-in to an account Fuel never wrote to, at the same moment (review finding
//    sync#1, the reviewer's t4): both read the account before either upload lands. F1 had pasted the log and
//    used it (an entry deleted, one edited, one added, a saved food deleted); F2 is new. Both orders of landing.
// ---------------------------------------------------------------------------
async function raceRun(browser, docs, order) {
  const world = v28Account(docs), { cloud } = world;
  world.browser = browser;
  const step = (title, fn) => run.step('race (' + order + ' lands last)', title, fn);
  const text = F.foodText(F.payloadFrom(fx.state, NOW - 60000), true);
  const E = fx.state.diary[YESTERDAY][0].id, M = fx.state.diary[TODAY][1];
  const X = Object.keys(fx.state.food.foods).filter((id) => !fx.state.food.foods[id].fav).sort()[0];
  const F1 = await makePhone(world, 'F1', TREE, { clipboard: true }), F2 = await makePhone(world, 'F2', TREE);
  let f1 = null, f2 = null;
  const ok = await step('F1 pastes the log and uses it; then F1 and F2 sign in at once, and both read the account before either upload lands', async () => {
    f1 = await openFuel(F1);
    await f1.evaluate((t) => navigator.clipboard.writeText(t), text);
    await f1.click('[data-action="fuel-paste"]');
    await F.toast(f1, /Brought in/);
    await deleteEntry(f1, YESTERDAY, E);
    await editEntry(f1, TODAY, M.id, M.kcal + 100);
    await addEntry(f1, TODAY, 'fuelrace0001', 'Own on F1', 210);
    await deleteThing(f1, 'foods', X);
    f2 = await openFuel(F2);
    const h1 = await holdCommits(f1), h2 = await holdCommits(f2);
    await Promise.all([signInInSettings(f1), signInAtWelcome(f2)]);
    for (let i = 0; i < 200; i++) {
      if ((await f1.evaluate(() => window.__held)) > 0 && (await f2.evaluate(() => window.__held)) > 0) break;
      await f1.clock.runFor(100); await f2.clock.runFor(100); await cloud.idle();
    }
    need((await f1.evaluate(() => window.__held)) > 0 && (await f2.evaluate(() => window.__held)) > 0 && cloud.writes().length === 0, 'the two uploads are not both waiting');
    for (const h of order === 'F2' ? [h1, h2] : [h2, h1]) { await h.release(); await cloud.idle(); }
    await rest(world);
    return 'writes: ' + brief(cloud.writes());
  });
  if (ok) {
    await step('both phones and the account: F1\'s edit, its own entry and its deletions stand; 1,576 entries, each once; the same diary on both', async () => {
      for (const [name, st] of [['the account', coreAndDays(cloud)], ['F1', await F.live(f1)], ['F2', await F.live(f2)]]) {
        const all = allIds(st.diary);
        need(all.length === COUNTS.foodEntries && new Set(all).size === all.length, name + ': ' + all.length + ' entries, ' + new Set(all).size + ' ids');
        need(!all.includes(E) && all.includes('fuelrace0001') && !st.food.foods[X], name + ': the deleted entry ' + (all.includes(E) ? 'is back' : 'stays gone') + ', the own entry ' + (all.includes('fuelrace0001') ? 'is there' : 'is missing') + ', the deleted food ' + (st.food.foods[X] ? 'is back' : 'stays gone'));
        need(st.diary[TODAY].find((e) => e.id === M.id).kcal === M.kcal + 100, name + ': the entry edited on F1 has ' + st.diary[TODAY].find((e) => e.id === M.id).kcal + ' (F1 set ' + (M.kcal + 100) + ')');
      }
      same(travels(await F.live(f1)), travels(await F.live(f2)), 'F1 against F2');
      onlyFuelPaths(cloud);
      need(cloud.paths(OLD_DAYS).length === COUNTS.foodDays, 'Overload\'s food days changed');
      for (const p of [F1, F2]) F.assertClean(p, 'phone ' + p.name);
      return 'F1 wrote ' + cloud.writes({ who: 'F1' }).length + ', F2 ' + cloud.writes({ who: 'F2' }).length;
    });
  }
  for (const p of world.phones) await p.close();
}

// ---------------------------------------------------------------------------
// 6. Reset and Restore while signed in, on a start where the sync module has not loaded yet (review finding
//    sync#2, the reviewer's t8): the questions say the account changes too, the note stays, and the account
//    follows once the module runs.
// ---------------------------------------------------------------------------
async function earlyRun(browser, docs) {
  const world = v28Account(docs), { cloud } = world;
  world.browser = browser;
  const step = (title, fn) => run.step('before the module', title, fn);
  const A = await makePhone(world, 'A', TREE);
  let a = await openFuel(A);
  await signInAtWelcome(a);
  await rest(world);
  const overload0 = overloadDocs(cloud);
  await closeFuel(A);
  // Settings > Reset or a Restore, before the module has run; then the module arrives.
  const early = async (doIt) => {
    const sdk = await holdSdk(A);
    let said = null, kept = false;
    try {
      a = await openFuelEarly(A);
      need(!(await a.evaluate(() => !!window.__overloadSync)), 'this check needs the page to run before its sync module');
      const asked = a.dialogs.length;
      await lib.openTab(a, 'settings');
      await doIt(a);
      said = a.dialogs.slice(asked).join(' / ');
      kept = !!(await noteOf(a));
    } finally { sdk.release(); }
    await a.waitForFunction(() => !!window.__overloadSync, null, { timeout: 15000 });
    await rest(world);
    return { said, kept };
  };
  const ok = await step('Reset: the question says the account is erased too, the note stays, and once the module runs the account is empty and stays so', async () => {
    const mark = cloud.mark();
    const r = await early(async (pg) => { await pg.click('[data-action="reset"]'); await F.toast(pg, /Reset/); });
    need(/is erased too\. Another phone signed in to this account does the same/.test(r.said) && r.said.includes('(' + EMAIL + ')'), 'the question reads: ' + r.said.replace(/\n+/g, ' | '));
    need(r.kept, 'the note was removed');
    const st = await F.live(a), core = coreOfCloud(cloud);
    need(!Object.keys(st.diary).length && !Object.keys(st.food.foods).length, 'A holds ' + Object.keys(st.diary).length + ' days and ' + Object.keys(st.food.foods).length + ' saved foods again');
    need(cloud.paths(FUEL_DAYS).length === 0 && !Object.keys(core.food.foods).length && !Object.keys(core.food.meals).length, 'the account holds ' + cloud.paths(FUEL_DAYS).length + ' days, ' + Object.keys(core.food.foods).length + ' saved foods');
    onlyFuelPaths(cloud, mark);
    need(overloadDocs(cloud) === overload0, 'meta/state, workouts or foodDays changed');
    return 'writes once the module ran: ' + brief(cloud.writes({ from: mark }));
  });
  if (ok) {
    await step('Restore "Before reset": the question says the account is replaced too, and once the module runs the account holds the log again', async () => {
      await closeFuel(A);
      const mark = cloud.mark();
      const r = await early(async (pg) => {
        await pg.click('#safety-copies [data-action="restore-copy"][data-id="before-reset"]', { timeout: 8000 });
        await F.toast(pg, /Copy restored/);
      });
      need(/is replaced too\. Another phone signed in to this account does the same/.test(r.said), 'the question reads: ' + r.said.replace(/\n+/g, ' | '));
      need(r.kept, 'the note was removed');
      const st = await F.live(a);
      need(Object.keys(st.diary).length === COUNTS.foodDays && cloud.paths(FUEL_DAYS).length === COUNTS.foodDays, 'A holds ' + Object.keys(st.diary).length + ' days, the account ' + cloud.paths(FUEL_DAYS).length);
      same(coreAndDays(cloud).diary, st.diary, 'the account\'s diary against A\'s');
      same(coreOfCloud(cloud).food, JSON.parse(JSON.stringify(st.food)), 'the account\'s saved foods, meals and targets against A\'s');
      onlyFuelPaths(cloud, mark);
      need(overloadDocs(cloud) === overload0, 'meta/state, workouts or foodDays changed');
      F.assertClean(A, 'phone A');
      return 'writes once the module ran: ' + brief(cloud.writes({ from: mark }));
    });
  }
  // The same once the module has loaded, while Firebase has not said yet who is signed in (Auth's own storage slow,
  // or IndexedDB not answering): its user is null then, and that is not "signed out" (review finding data#5, the
  // verifier's authwindow.js). The note counts until the module has said so.
  const authEarly = async (doIt) => {
    await closeFuel(A);
    const auth = await holdAuth(A);
    let said = null, kept = false;
    try {
      a = await openFuel(A);
      need((await a.evaluate(() => window.__overloadSync.user)) === null, 'this check needs the module loaded and Firebase not answered yet');
      const asked = a.dialogs.length;
      await lib.openTab(a, 'settings');
      await doIt(a);
      said = a.dialogs.slice(asked).join(' / ');
      kept = !!(await noteOf(a));
    } finally { await auth.release(a); }
    await a.waitForFunction(() => !!window.__overloadSync.user, null, { timeout: 8000 });
    await rest(world);
    return { said, kept };
  };
  if (ok) {
    const ok2 = await step('Firebase has not answered yet (the module has loaded): Reset says the account is erased too, the note stays, and once Firebase answers the account is empty and stays so', async () => {
      const mark = cloud.mark();
      const r = await authEarly(async (pg) => { await pg.click('[data-action="reset"]'); await F.toast(pg, /Reset/); });
      need(/is erased too\. Another phone signed in to this account does the same/.test(r.said) && r.said.includes('(' + EMAIL + ')'), 'the question reads: ' + r.said.replace(/\n+/g, ' | '));
      need(r.kept, 'the note was removed: the next link is a first link, which brings the account\'s log back');
      const st = await F.live(a), core = coreOfCloud(cloud);
      need(!Object.keys(st.diary).length && !Object.keys(st.food.foods).length, 'A holds ' + Object.keys(st.diary).length + ' days and ' + Object.keys(st.food.foods).length + ' saved foods again');
      need(cloud.paths(FUEL_DAYS).length === 0 && !Object.keys(core.food.foods).length, 'the account holds ' + cloud.paths(FUEL_DAYS).length + ' days, ' + Object.keys(core.food.foods).length + ' saved foods');
      onlyFuelPaths(cloud, mark);
      need(overloadDocs(cloud) === overload0, 'meta/state, workouts or foodDays changed');
      return 'writes once Firebase answered: ' + brief(cloud.writes({ from: mark }));
    });
    if (ok2) {
      await step('Firebase has not answered yet: Restore "Before reset" says the account is replaced too, and once Firebase answers the account holds the log again', async () => {
        const mark = cloud.mark();
        const r = await authEarly(async (pg) => {
          await pg.click('#safety-copies [data-action="restore-copy"][data-id="before-reset"]', { timeout: 8000 });
          await F.toast(pg, /Copy restored/);
        });
        need(/is replaced too\. Another phone signed in to this account does the same/.test(r.said), 'the question reads: ' + r.said.replace(/\n+/g, ' | '));
        need(r.kept, 'the note was removed');
        const st = await F.live(a);
        need(Object.keys(st.diary).length === COUNTS.foodDays && cloud.paths(FUEL_DAYS).length === COUNTS.foodDays, 'A holds ' + Object.keys(st.diary).length + ' days, the account ' + cloud.paths(FUEL_DAYS).length);
        same(coreAndDays(cloud).diary, st.diary, 'the account\'s diary against A\'s');
        onlyFuelPaths(cloud, mark);
        F.assertClean(A, 'phone A');
        return 'writes once Firebase answered: ' + brief(cloud.writes({ from: mark }));
      });
    }
  }
  for (const p of world.phones) await p.close();
}

// ---------------------------------------------------------------------------
// 6b. Signed in, but the first link has not read the account yet (review finding sync#6, the verifier's a1): its read
//     from the server fails ("Could not reach the cloud. Nothing was uploaded; retrying."). Reset, Restore and the
//     imports do not start: no question, a toast says why, nothing changes (before, Reset went ahead and the link then
//     merged the account's log back over it, the account unchanged). The same on the next start after the app was
//     closed before a read worked (link#1): without the sync module ("Cloud sync is not available right now. ..."),
//     and with it before Firebase has answered ("still reading"). Once the read works they ask and reach the
//     account. A phone that linked before (it has a note) is not held up, also when it starts without signal.
// ---------------------------------------------------------------------------
async function firstLinkRun(browser, docs) {
  const world = v28Account(docs), { cloud } = world;
  world.browser = browser;
  const step = (title, fn) => run.step('first link not done', title, fn);
  const SAYS = 'Cloud sync is still reading your account. Try again once it says Synced.';
  const tmp = F.tempDir();
  const F1 = await makePhone(world, 'F1', TREE);
  let f1 = await openFuel(F1);
  await signInAtWelcome(f1);
  await rest(world);
  // F2: a phone of its own with the same log on it, never signed in.
  const logText = await F.storedText(f1);
  const F2 = await makePhone(world, 'F2', TREE, { clipboard: true, seed: (ctx) => lib.seedStorage(ctx, { [F.KEY]: logText }) });
  let f2 = await openFuel(F2);
  // F2's reads from the server itself (getDocFromServer, getDocsFromServer) answer 'unavailable' while `on`; sign-in
  // and the listeners are not touched. (On the page F2 shows now.)
  const failReads = (on) => f2.evaluate((x) => {
    if (!window.__origFake) {
      const orig = window.__origFake = window.__fakeFirebase;
      window.__fakeFirebase = (op, p) => (window.__failGet && op === 'fs.server' && p && p.via === 'get' ? Promise.resolve({ error: 'unavailable', rev: 0 }) : orig(op, p));
    }
    window.__failGet = x;
  }, on);
  const quiet = (pg) => pg.evaluate(() => { const t = document.querySelector('#toast'); t.hidden = true; t.textContent = ''; });
  const more = JSON.parse(logText);
  more.diary[TODAY] = more.diary[TODAY].concat([{ id: 'fuelfirst001', food: null, meal: 3, qty: null, unit: null, amt: '', name: 'From the backup', brand: '', kcal: 55, p: 1, c: 2, f: 3, at: NOW }]);
  const file = tmp.file('fuel-backup-2026-11-20.json', JSON.stringify(more));
  let ok = await step('signed in while the first read from the server fails: Reset, Restore, Import JSON, Paste from Overload, Choose a file and the paste box ask nothing, change nothing and send nothing; the toast says why', async () => {
    await failReads(true);
    await signInInSettings(f2);
    await rest(world);
    const st = await f2.evaluate((k) => ({ user: !!window.__overloadSync.user, linked: window.__overloadSync.linked, error: window.__overloadSync.error, note: localStorage.getItem(k) }), NOTE);
    need(st.user && /Could not reach the cloud/.test(st.error) && !st.note, 'F2 after signing in: ' + JSON.stringify(st));
    await f2.waitForSelector('#safety-copies [data-action="restore-copy"]', { timeout: 5000 });
    const before = await F.storedText(f2), mark = cloud.mark(), asked = f2.dialogs.length, said = [];
    await f2.evaluate((t) => navigator.clipboard.writeText(t), F.foodText(F.payloadFrom(fx.state, NOW - 60000), true));
    let choosers = 0; const onChooser = () => { choosers++; };
    f2.on('filechooser', onChooser);
    const tries = [
      ['Reset all data', () => f2.click('[data-action="reset"]')],
      ['Restore', () => f2.click('#safety-copies [data-action="restore-copy"]')],
      ['Import JSON', () => f2.click('[data-action="import"]')],
      ['a file given to Import', () => f2.setInputFiles('#import-file', file)],
      ['Paste from Overload', async () => { await f2.click('[data-action="fuel-import"]'); await f2.click('#sheet [data-action="fuel-paste"]'); }],
      ['Choose a file', () => f2.click('#sheet [data-action="fuel-file"]')],
      ['the paste box', async () => { await f2.click('#sheet [data-action="fuel-paste-box"]'); await f2.fill('#fuel-paste', F.foodText(F.payloadFrom(fx.state, NOW - 60000), true)); await f2.click('#fuel-paste-form button[type="submit"]'); }]
    ];
    for (const [what, act] of tries) {
      await quiet(f2); await act();
      said.push(what + ': ' + await F.toast(f2, /still reading/).catch(() => 'no such toast'));
      need(f2.dialogs.length === asked, what + ': questions were asked: ' + f2.dialogs.slice(asked).join(' / ').replace(/\n+/g, ' | ').slice(0, 300));
    }
    await rest(world);
    f2.off('filechooser', onChooser);
    await F.closeSheet(f2);
    need(said.every((t) => t.endsWith(': ' + SAYS)), 'the toasts: ' + said.join(' | '));
    need(!choosers, 'the file picker opened');
    need((await F.storedText(f2)) === before, 'F2\'s data changed');
    need(cloud.writes({ who: 'F2', from: mark }).length === 0, 'F2 wrote to the account: ' + brief(cloud.writes({ who: 'F2', from: mark })));
    need(await f2.evaluate(() => window.__overloadSync.linked === false), 'sync.js does not say it has not read the account yet (linked)');
    return SAYS;
  });
  // Review finding link#1 (the verifiers' b2-weak-first-signin.js --only=fuel and later-start.js fu-nosdk-reset,
  // fu-auth-reset): F2 is closed before a read has worked. The next start has no sync module (its files did not come:
  // no signal), or the module has loaded and Firebase has not answered yet. There is no note, so such a start took F2
  // for signed out: Reset went ahead, and the next link merged the account's log back over it (110 days back on F2,
  // the account unchanged). The first link still to be made is now kept across starts, in fuel.backup's `linking` (not
  // in the note, which sync.js would take as an account it has read), as overload.backup's in Overload.
  const NOT_NOW = 'Cloud sync is not available right now. It starts when the app opens with signal.';
  const linkingOf = (pg) => pg.evaluate(() => (JSON.parse(localStorage.getItem('fuel.backup') || '{}')).linking);
  const heldBack = async (says, where) => {
    await lib.openTab(f2, 'settings');
    await f2.waitForSelector('#safety-copies [data-action="restore-copy"]', { timeout: 5000 });
    const before = await F.storedText(f2), mark = cloud.mark(), asked = f2.dialogs.length, said = [];
    await f2.evaluate((t) => {
      window.__clipboardReads = 0;
      const read = navigator.clipboard.readText.bind(navigator.clipboard);
      navigator.clipboard.readText = () => { window.__clipboardReads++; return read(); };
      return navigator.clipboard.writeText(t);
    }, F.foodText(F.payloadFrom(fx.state, NOW - 60000), true));
    let choosers = 0; const onChooser = () => { choosers++; };
    f2.on('filechooser', onChooser);
    for (const [what, act] of [
      ['Reset all data', () => f2.click('[data-action="reset"]')],
      ['Restore', () => f2.click('#safety-copies [data-action="restore-copy"]')],
      ['Import JSON', () => f2.click('[data-action="import"]')],
      ['a file given to Import', () => f2.setInputFiles('#import-file', file)],
      ['Paste from Overload', async () => { await f2.click('[data-action="fuel-import"]'); await f2.click('#sheet [data-action="fuel-paste"]'); }],
      ['Choose a file', () => f2.click('#sheet [data-action="fuel-file"]')],
      ['the paste box', async () => { await f2.click('#sheet [data-action="fuel-paste-box"]'); await f2.fill('#fuel-paste', F.foodText(F.payloadFrom(fx.state, NOW - 60000), true)); await f2.click('#fuel-paste-form button[type="submit"]'); }]
    ]) {
      await quiet(f2); await act();
      said.push(what + ': ' + await F.toast(f2, /still reading|not available/).catch(() => 'no such toast'));
      need(f2.dialogs.length === asked, where + ', ' + what + ': questions were asked: ' + f2.dialogs.slice(asked).join(' / ').replace(/\n+/g, ' | ').slice(0, 300));
    }
    await rest(world);
    f2.off('filechooser', onChooser);
    await F.closeSheet(f2);
    need(said.every((t) => t.endsWith(': ' + says)), where + ', the toasts: ' + said.join(' | '));
    need(!choosers && (await f2.evaluate(() => window.__clipboardReads)) === 0, where + ': the file picker opened ' + choosers + ' times, the clipboard was read ' + await f2.evaluate(() => window.__clipboardReads) + ' times');
    need((await F.storedText(f2)) === before, where + ': F2\'s data changed');
    need(cloud.writes({ who: 'F2', from: mark }).length === 0, where + ': F2 wrote to the account: ' + brief(cloud.writes({ who: 'F2', from: mark })));
  };
  if (ok) {
    ok = await step('closed before a read worked; the next start has no sync module (no signal): Reset, Restore, Import JSON, Paste from Overload, Choose a file and the paste box ask nothing, change nothing and send nothing, and the toast says cloud sync is not available (link#1)', async () => {
      await closeFuel(F2);
      F2.device.blockSdk(true);
      f2 = await lib.openApp(F2.context, ORIGIN + F.PAGE);
      F2.pages.push(f2); F2.fuel = f2;
      await f2.waitForFunction(() => !!window.__overloadFood, null, { timeout: 15000 });
      await rest(world);
      need(!(await f2.evaluate(() => !!window.__overloadSync)), 'the sync module ran');
      need(!(await noteOf(f2)), 'F2 has a note');
      await heldBack(NOT_NOW, 'no module');
      const mark = await linkingOf(f2);
      need(mark === 'U1', 'fuel.backup\'s linking is ' + mark);
      return NOT_NOW + ' (fuel.backup\'s linking: ' + mark + ')';
    });
  }
  if (ok) {
    ok = await step('the next start, with the sync module but before Firebase has said who is signed in: the same, and the toast says it is still reading the account (link#1); once Firebase answers and the read still fails, they are held back as before', async () => {
      await closeFuel(F2);
      F2.device.blockSdk(false);
      const auth = await holdAuth(F2);
      try {
        f2 = await openFuel(F2);
        need((await f2.evaluate(() => window.__overloadSync.user)) === null, 'Firebase\'s first answer was not held back');
        await heldBack(SAYS, 'Firebase not answered');
        await failReads(true);
      } finally { await auth.release(f2); }
      await rest(world);
      const st = await f2.evaluate((k) => ({ user: !!window.__overloadSync.user, linked: window.__overloadSync.linked, error: window.__overloadSync.error, note: localStorage.getItem(k) }), NOTE);
      need(st.user && st.linked === false && /Could not reach the cloud/.test(st.error) && !st.note, 'F2 once Firebase answered: ' + JSON.stringify(st));
      await heldBack(SAYS, 'Firebase answered, the read failing');
      need((await linkingOf(f2)) === 'U1', 'fuel.backup\'s linking is ' + await linkingOf(f2));
      return SAYS;
    });
  }
  if (ok) {
    ok = await step('the read works (Sync now): F2 links, the card says Synced, and Choose a file then asks, adds and reaches the account and F1', async () => {
      await failReads(false);
      await lib.openTab(f2, 'settings');
      await f2.click('[data-action="cloud-push"]');
      await rest(world);
      const st = await f2.evaluate(() => ({ linked: window.__overloadSync.linked, status: (document.querySelector('#cloud-status') || {}).textContent }));
      need(st.linked === true && /^Synced/.test(st.status), 'F2: ' + JSON.stringify(st));
      const asked = f2.dialogs.length;
      await F.chooseFile(f2, '[data-action="import"]', file);
      await F.toast(f2, /Brought in 1 entry on 1 day/);
      need(f2.dialogs.length === asked + 1 && /^confirm: Bring this food log/.test(f2.dialogs[asked]), 'the import asked: ' + f2.dialogs.slice(asked).join(' / '));
      await rest(world);
      for (const [name, st2] of [['the account', coreAndDays(cloud)], ['F1', await F.live(f1)], ['F2', await F.live(f2)]]) need(ids(st2.diary[TODAY]).includes('fuelfirst001'), name + ' lacks the entry brought in');
      return 'the entry brought in is in the account and on both phones';
    });
  }
  if (ok) {
    await step('a phone that linked before, started without signal, is not held up: its Reset asks with the account sentence and reaches the account once online; F2 follows', async () => {
      await closeFuel(F1);
      await F1.device.setOffline(true);
      f1 = await openFuel(F1);
      await f1.waitForFunction(() => !!window.__overloadSync.user, null, { timeout: 8000 });
      need(await f1.evaluate(() => window.__overloadSync.linked === true), 'F1 counts as not linked on a start without signal');
      await lib.openTab(f1, 'settings');
      const asked = f1.dialogs.length;
      await f1.click('[data-action="reset"]');
      await F.toast(f1, /Reset/);
      need(/the food log in your account \(owner@example\.com\) is erased too/.test(f1.dialogs[asked] || ''), 'the question reads: ' + (f1.dialogs[asked] || '').replace(/\n+/g, ' | '));
      await F1.device.setOffline(false);
      await rest(world);
      for (const [name, st] of [['the account', coreAndDays(cloud)], ['F1', await F.live(f1)], ['F2', await F.live(f2)]]) need(!Object.keys(st.diary).length, name + ' holds ' + Object.keys(st.diary).length + ' days');
      return 'the account and both phones are empty';
    });
    await step('Restore "Before import" on F2: it asks, and the account and F1 hold the log again', async () => {
      await lib.openTab(f2, 'food'); await lib.openTab(f2, 'settings');
      const asked = f2.dialogs.length;
      await f2.click('#safety-copies [data-action="restore-copy"][data-id="before-import"]', { timeout: 8000 });
      await F.toast(f2, /Copy restored/);
      need(/the food log in your account \(owner@example\.com\) is replaced too/.test(f2.dialogs[asked] || ''), 'the question reads: ' + (f2.dialogs[asked] || '').replace(/\n+/g, ' | '));
      await rest(world);
      const st = await F.live(f2);
      need(Object.keys(st.diary).length === COUNTS.foodDays, 'F2 holds ' + Object.keys(st.diary).length + ' days');
      same(coreAndDays(cloud).diary, st.diary, 'the account\'s diary against F2\'s');
      same(travels(await F.live(f1)), travels(st), 'F1 against F2');
      onlyFuelPaths(cloud);
      for (const p of [F1, F2]) F.assertClean(p, 'phone ' + p.name);
      return COUNTS.foodDays + ' days in the account and on both phones';
    });
  }
  tmp.rm();
  for (const p of world.phones) await p.close();
}

// ---------------------------------------------------------------------------
// 6c. A phone that never heard back from an upload (review finding sync#8, the verifier's a2). B logs an entry; the
//     server takes the write, but the answer never reaches the page (the app was closed a moment after, as one does on
//     an iPhone). Then A resets or restores. The question promises that B does the same, except for what was logged or
//     changed on it since it last synced. So B must count the write as taken once anything shows it: a copy without
//     pending writes, the offline cache's too, or the server asked at B's next start (the SDK sends such a write again,
//     and its answer changes only metadata, which the listeners are not told of). And when a day leaves the account
//     while B's write of it is still not confirmed, B keeps only what it logged there itself, never the whole day.
// ---------------------------------------------------------------------------
async function lostAnswerRun(browser, docs) {
  const world = v28Account(docs), { cloud } = world;
  world.browser = browser;
  const step = (title, fn) => run.step('lost answer', title, fn);
  const A = await makePhone(world, 'A', TREE), B = await makePhone(world, 'B', TREE);
  let a = await openFuel(A); await signInAtWelcome(a); await rest(world);
  let b = await openFuel(B); await signInAtWelcome(b); await rest(world);
  // B's next uploads reach the server, and their answer never comes (commit() never settles on this page).
  const loseAnswers = (pg) => pg.evaluate(() => { const real = window.__fakeFirebase; window.__fakeFirebase = (op, p) => (op === 'fs.commit' ? (real(op, p), new Promise(() => {})) : real(op, p)); });
  const own = async (pg, date) => ((await noteOf(pg)).own.days[date] || []).map((w) => w.c || 0);
  const day = (st, date) => ids(st.diary[date]);
  const everywhere = async () => [['the account', coreAndDays(cloud)], ['A', await F.live(a)], ['B', await F.live(b)]];
  // From B's next page on, while test.cachePending names a day: the SDK's offline cache shows that day as still
  // waiting to go up (it keeps the write, and sends it again at the start), as the real SDK does after a lost answer.
  await B.context.addInitScript(() => {
    const real = window.__fakeFirebase;
    if (typeof real !== 'function') return;
    window.__cachePendingReady = true;
    window.__fakeFirebase = (op, p) => {
      const r = real(op, p), d = localStorage.getItem('test.cachePending');
      if (op !== 'fs.cached' || !d) return r;
      return Promise.resolve(r).then((c) => { (c && c.docs || []).forEach((x) => { if (x.path.endsWith('/fuelDays/' + d)) x.pending = true; }); return c; });
    };
  });
  const lostLog = async (date, id) => {
    await loseAnswers(b);
    const mark = cloud.mark();
    await addEntry(b, date, id, 'Logged, answer lost', 95);
    await rest(world);
    const ws = cloud.writes({ who: 'B', from: mark });
    need(ws.length === 1 && ws[0].path === FUEL_DAYS + '/' + date && ws[0].state === 'applied' && ids(dayOfCloud(cloud, date)).includes(id), 'B\'s write: ' + brief(ws));
    same(await own(b, date), [0], 'B\'s own writes of ' + date + ' (1: confirmed), before it is closed');
  };
  const quietToast = (pg) => pg.evaluate(() => { const t = document.querySelector('#toast'); t.hidden = true; t.textContent = ''; });
  const restoreOnA = async (id) => {
    await lib.openTab(a, 'food'); await lib.openTab(a, 'settings');
    const asked = a.dialogs.length;
    await quietToast(a);
    await a.click('#safety-copies [data-action="restore-copy"][data-id="' + id + '"]', { timeout: 8000 });
    await F.toast(a, /Copy restored/);
    need(/is replaced too\. Another phone signed in to this account does the same, except for what was logged or changed on it since it last synced: that comes back\./.test(a.dialogs[asked] || ''), 'the question reads: ' + (a.dialogs[asked] || '').replace(/\n+/g, ' | '));
  };
  const resetOnA = async () => {
    await lib.openTab(a, 'settings');
    const asked = a.dialogs.length;
    await quietToast(a);
    await a.click('[data-action="reset"]');
    await F.toast(a, /Reset/);
    need(/is erased too\. Another phone signed in to this account does the same, except for what was logged or changed on it since it last synced: that comes back\./.test(a.dialogs[asked] || ''), 'the question reads: ' + (a.dialogs[asked] || '').replace(/\n+/g, ' | '));
  };

  // (Each step goes on from what the one before left, whatever its outcome.)
  await step('B logs an entry today and never hears back; opened again without signal, B counts its write as taken, from the offline cache; and so after a start with signal (nothing changed there)', async () => {
    await lostLog(TODAY, 'fuellost0001');
    await closeFuel(B);
    await B.device.setOffline(true);
    b = await openFuel(B); await rest(world);
    const one = await own(b, TODAY);
    await closeFuel(B);
    await B.device.setOffline(false);
    b = await openFuel(B); await rest(world);
    same(one, [1], 'B\'s own writes of ' + TODAY + ' once opened again without signal (1: confirmed)');
    same(await own(b, TODAY), [1], 'B\'s own writes of ' + TODAY + ' once opened with signal');
    return TODAY + ': confirmed at the next start';
  });
  {
    await step('A restores a copy without today: B follows, and nothing of that day comes back (B logged its entry before it last synced)', async () => {
      await a.evaluate((d) => { const s = JSON.parse(JSON.stringify(window.__overload.state)); delete s.diary[d]; return window.__overloadBackup.take('import', JSON.stringify(s)); }, TODAY);
      const mark = cloud.mark();
      await restoreOnA('before-import');
      await rest(world);
      for (const [name, st] of await everywhere()) {
        need(!day(st, TODAY).length, name + ': ' + TODAY + ' holds ' + day(st, TODAY).length + ' entries (B logged 1 of them before it last synced)');
        need(Object.keys(st.diary).length === COUNTS.foodDays - 1, name + ' holds ' + Object.keys(st.diary).length + ' days');
      }
      return 'writes: ' + brief(cloud.writes({ from: mark }));
    });
  }
  {
    await step('B logs yesterday and never hears back; opened again while the SDK still holds that write (its cache shows it waiting), B asks the server for that day and counts the write as taken; A resets: nothing comes back', async () => {
      await lostLog(YESTERDAY, 'fuellost0002');
      await b.evaluate((d) => localStorage.setItem('test.cachePending', d), YESTERDAY);
      await closeFuel(B);
      const mark = cloud.mark();
      b = await openFuel(B);
      need(await b.evaluate(() => window.__cachePendingReady === true), 'this check needs the stand-in cache to show the write waiting');
      await rest(world);
      await b.evaluate(() => localStorage.removeItem('test.cachePending'));
      const asked = cloud.reads({ who: 'B', from: mark }).some((r) => r.type === 'get' && r.via === 'get' && r.path === FUEL_DAYS + '/' + YESTERDAY), mine = await own(b, YESTERDAY);
      await resetOnA();
      await rest(world);
      for (const [name, st] of await everywhere()) need(!Object.keys(st.diary).length, name + ' holds ' + Object.keys(st.diary).length + ' days: ' + Object.keys(st.diary).map((d) => d + ' ' + st.diary[d].length).join(', ').slice(0, 120));
      same(mine, [1], 'B\'s own writes of ' + YESTERDAY + ' once opened again (1: confirmed)');
      need(asked, 'B did not ask the server for ' + YESTERDAY);
      return 'B asked: ' + cloud.reads({ who: 'B', from: mark }).filter((r) => r.via === 'get').map((r) => r.path.replace(/^users\/U\d+\//, '')).join(', ');
    });
  }
  {
    await step('B logs and never hears back, and its SDK\'s offline store is lost; A resets before B opens again: B keeps only the entry it logged, not the day, and sends it back', async () => {
      await restoreOnA('before-reset');
      await rest(world);
      need(Object.keys((await F.live(b)).diary).length === COUNTS.foodDays - 1, 'B does not hold the log again');
      const n = (await F.live(b)).diary[YESTERDAY].length;
      await lostLog(YESTERDAY, 'fuellost0003');
      await closeFuel(B);
      B.device.loseOfflineStore('fuel');
      await resetOnA();
      await rest(world);
      b = await openFuel(B);
      await rest(world);
      for (const [name, st] of await everywhere()) {
        same(Object.keys(st.diary), [YESTERDAY], name + '\'s days');
        same(day(st, YESTERDAY), ['fuellost0003'], name + '\'s entries of ' + YESTERDAY + ' (B logged 1 of the ' + (n + 1) + ')');
      }
      same(travels(await F.live(a)), travels(await F.live(b)), 'A against B');
      onlyFuelPaths(cloud);
      for (const p of [A, B]) F.assertClean(p, 'phone ' + p.name);
      return YESTERDAY + ' holds only B\'s entry, in the account and on both phones';
    });
  }
  for (const p of world.phones) await p.close();
}

// ---------------------------------------------------------------------------
// 7. One phone and a new account: Create account, Reset, Restore
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
// 5. Sign-in brings Overload's food log by the rules of Paste from Overload (planImport in fuel.js, made for
//    review findings H1 and H4): an account holding a starred food and a corrected food that Fuel also holds,
//    and entry ids on two days. Three phones start from the same saved Fuel: one only pastes (what Paste
//    alone gives), one signs in and then pastes, one pastes and then signs in.
// ---------------------------------------------------------------------------
// Settings > Bring food from Overload > the box, the text typed in, Bring it in. Returns what it said:
// { toast } when something was brought in, { msg } when the sheet answered (Nothing new, an error).
async function pasteInSettings(page, text) {
  await F.closeSheet(page);
  await page.evaluate(() => { document.querySelector('#toast').hidden = true; });
  await lib.openTab(page, 'settings');
  await page.click('[data-action="fuel-import"]');
  await page.click('[data-action="fuel-paste-box"]');
  await page.fill('#fuel-paste', text);
  await page.click('#fuel-paste-form button[type="submit"]');
  await page.waitForFunction(() => { const t = document.querySelector('#toast'); return !!document.querySelector('#fuel-import-msg') || (!t.hidden && /Brought in|Updated/.test(t.textContent)); }, null, { timeout: 8000 });
  const said = await page.evaluate(() => { const m = document.querySelector('#fuel-import-msg'); return m ? { msg: m.textContent.replace(/\s+/g, ' ').trim() } : { toast: document.querySelector('#toast').textContent }; });
  await F.closeSheet(page);
  return said;
}
async function sameRulesRun(browser, v28) {
  const world = { browser, cloud: createCloud(), phones: [] };
  const { cloud } = world;
  const step = (title, fn) => run.step('sign-in and paste', title, fn);

  // ---- the account: v2.8 with the main fixture and two entries kept on two days (as v1.6 to v2.4 wrote one
  // edited across midnight), uploaded by v2.8 itself; then one of them removed from one of its days there ----
  const DAY_A = '2026-11-17', DAY_B = '2026-11-18', DAY_C = '2026-11-14', DAY_D = '2026-11-15';
  const old = JSON.parse(fx.text);
  const twin = (from, to) => { const e = old.diary[from][old.diary[from].length - 1]; old.diary[to].push(Object.assign({}, e, { qty: (e.qty || 1) * 2, kcal: e.kcal * 2, p: e.p * 2, c: e.c * 2, f: e.f * 2 })); return e.id; };
  const X = twin(DAY_A, DAY_B), Y = twin(DAY_C, DAY_D);
  const V = await makePhone(world, 'V', v28, { seed: (context) => lib.seedV28(context, old) });
  let text = null, docs = null;
  const ok = await step('v2.8 uploads it, then removes one of the two copies of an entry: the account and v2.8 hold the same log', async () => {
    await openOverload(V);
    await V.app.evaluate(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL, PASSWORD]);
    await rest(world);
    await V.app.evaluate(([d, id]) => { const O = window.__overload, s = O.state; s.diary[d] = s.diary[d].filter((e) => e.id !== id); O.lib.markDeleted('food', id); O.save(); }, [DAY_D, Y]);
    await rest(world);
    const st = JSON.parse(await lib.readStorageText(V.app, lib.STATE_KEY)), core = JSON.parse(cloud.get(OLD_META).core);
    for (const [d, id, here] of [[DAY_A, X, true], [DAY_B, X, true], [DAY_C, Y, true], [DAY_D, Y, false]]) {
      need(ids(st.diary[d]).includes(id) === here && ids(JSON.parse(cloud.get(OLD_DAYS + '/' + d).data)).includes(id) === here, d + ' in v2.8 or in the account does not hold ' + id + ' as this run needs');
    }
    need(st.deleted.food[Y] > 0 && core.deleted.food[Y] > 0, 'the removal is not recorded');
    same(core.food, st.food, 'the account\'s saved foods, meals and targets against v2.8\'s');
    need(st.food.foods.u1903553.src === 'custom' && st.food.foods.u1903553.fav && st.food.foods.u173904.fav, 'the bar or the oats are not as the run needs');
    text = F.foodText(F.payloadFrom(st, NOW - 60000), true);   // Copy my food log of that same log
    docs = cloud.snapshot('users/U1');
    return 'X ' + X + ' on ' + DAY_A + ' and ' + DAY_B + '; Y ' + Y + ' on ' + DAY_C + ', removed from ' + DAY_D;
  });
  await V.close();
  if (!ok) return;
  const overload0 = overloadDocs(cloud);

  // ---- the same saved Fuel on three phones: started fresh, then used for a while ----
  const T0 = NOW - 3 * 864e5, OL = fx.state.food.foods;
  const BAR = 'u1903553', OATS = 'u173904', WHEY = 'u173180', COOKIE = 'b0850031234567', EGG = 'u172187', GONE = 'cv6244zzsrdxu';
  const unstarred = (f) => { const c = Object.assign({}, f); delete c.fav; return c; };
  const E_DEL = fx.state.diary[YESTERDAY][0].id, M = fx.state.diary[TODAY][1], XA = fx.state.diary[DAY_A].slice(-1)[0];
  const OWN = F.fuelStateFrom(fx.state, {
    food: { targets: { kcal: null, protein: null, carbs: null, fat: null }, meals: {}, foods: {
      [OATS]: Object.assign(unstarred(OL[OATS]), { used: T0 }),   // logged from the food list; a favourite in Overload
      // the food list's own copy; in Overload a favourite, its label numbers corrected there (src custom)
      [BAR]: Object.assign(unstarred(OL[BAR]), { src: 'usda', barcode: '793573238467', n: { kcal: 300, p: 30, c: 37.5, f: 11.7 }, used: T0, last: { qty: 2, unit: 'srv' } }),
      // corrected in Fuel (src custom); a plain list copy and a favourite in Overload
      [WHEY]: { id: WHEY, src: 'custom', name: 'Whey, my scoop', brand: '', n: { kcal: 400, p: 80, c: 8, f: 5 }, serving: { label: '1 scoop', g: 30, n: null }, servings: [], used: T0 },
      // scanned in Fuel (Open Food Facts); typed in from the label in Overload
      [COOKIE]: { id: COOKIE, src: 'off', name: 'Protein Cookie Double Chocolate', brand: 'Bakehouse', barcode: '0850031234567', n: { kcal: 350, p: 20, c: 45, f: 12 }, serving: { label: '1 cookie (70 g)', g: 70, n: null }, servings: [], used: T0, last: { qty: 2, unit: 'srv' } },
      [EGG]: Object.assign({}, OL[EGG], { used: T0 })   // the same list copy on both sides
    } },
    diary: {
      [TODAY]: [{ id: 'own0entry001', food: null, meal: 1, qty: null, unit: null, amt: '', name: 'Own lunch', brand: '', kcal: 555, p: 30, c: 40, f: 20, at: NOW - 7200000 }, Object.assign({}, M, { kcal: M.kcal + 100 })],
      [DAY_A]: [XA]   // X on its first day only
    },
    deleted: { food: { [E_DEL]: T0 }, foods: { [GONE]: T0 }, meals: {} }, bodyweight: [], moved: null
  });
  const seed = (context) => lib.seedStorage(context, { 'fuel.state.v1': JSON.stringify(OWN), 'fuel.theme': 'dark' });
  const travelsOf = (st) => ({ diary: JSON.stringify(st.diary), food: JSON.stringify(st.food) });
  // Nothing twice: every day holds each id once; X on both its days, Y on the one v2.8 still shows.
  const once = (st) => {
    const twice = Object.keys(st.diary).filter((d) => new Set(ids(st.diary[d])).size !== st.diary[d].length);
    need(!twice.length, 'an id twice on ' + twice.join(', '));
    const where = (id) => Object.keys(st.diary).filter((d) => ids(st.diary[d]).includes(id)).sort().join(' ');
    need(where(X) === DAY_A + ' ' + DAY_B && where(Y) === DAY_C && where(E_DEL) === '', 'X is on ' + where(X) + ', Y on ' + where(Y) + ', the entry deleted in Fuel on ' + (where(E_DEL) || 'no day'));
  };

  // ---- Paste alone ----
  const P = await makePhone(world, 'P', TREE, { seed });
  let ref = null, refSaid = null, start = null;
  if (!await step('Paste alone (no cloud): what an import of this log gives', async () => {
    const p = await openFuel(P);
    need((await F.screen(p)) === 'food', 'Fuel did not start on its saved data');
    start = await F.storedText(p);
    const said = await pasteInSettings(p, text);
    need(/^Brought in .*Updated 4 saved foods\.$/.test(said.toast || ''), 'the paste said ' + JSON.stringify(said));
    refSaid = said.toast;
    ref = await F.stored(p);
    const fo = ref.food.foods, mine = OWN.food.foods;
    same(fo[OATS], Object.assign({}, mine[OATS], { fav: true }), 'the oats');
    same(fo[BAR], Object.assign({}, OL[BAR], { used: T0, last: mine[BAR].last, fav: true }), 'the bar');
    same(fo[WHEY], Object.assign({}, mine[WHEY], { fav: true }), 'the whey he corrected in Fuel');
    same(fo[COOKIE], Object.assign({}, OL[COOKIE], { used: T0, last: mine[COOKIE].last }), 'the cookie');
    same(fo[EGG], mine[EGG], 'the egg');
    need(!fo[GONE] && ref.deleted.foods[GONE] === T0, 'the food deleted in Fuel came back');
    once(ref);
    need(ref.diary[TODAY].find((e) => e.id === M.id).kcal === M.kcal + 100 && !ref.deleted.food[Y], 'the entry edited in Fuel, or the record of Y');
    need(cloud.writes({ who: 'P' }).length === 0 && cloud.reads({ who: 'P' }).length === 0, 'the phone talked to the cloud');
    return said.toast;
  })) return;

  // ---- Sign in, then paste ----
  const Q = await makePhone(world, 'Q', TREE, { seed });
  let q = null, qSt = null;
  await step('sign in first (Settings): Overload\'s copy is read once, and the phone then holds exactly what Paste alone gives', async () => {
    q = await openFuel(Q);
    const before = await F.storedText(q);
    need(before === start, 'the two phones did not start from the same saved data');
    await signInInSettings(q);
    await rest(world);
    const rs = cloud.reads({ who: 'Q' }).filter((x) => OVERLOAD_PATH.test(x.path));
    need(rs.length === 2 && rs.every((x) => x.via === 'get'), 'reads of Overload\'s documents: ' + rs.map((x) => x.type + ' ' + x.path + ' via ' + x.via).join(', '));
    qSt = await F.stored(q);
    const got = travelsOf(qSt), want = travelsOf(ref);
    need(got.diary === want.diary, 'the diary differs from Paste alone at ' + (F.diff(qSt.diary, ref.diary) || 'the order of keys'));
    need(got.food === want.food, 'the saved foods, meals or targets differ from Paste alone at ' + (F.diff(qSt.food, ref.food) || 'the order of keys'));
    same(qSt.deleted, ref.deleted, 'the deletion records'); same(qSt.bodyweight, ref.bodyweight, 'the body weight'); same(qSt.settings, ref.settings, 'settings');
    once(qSt);
    const copy = await F.copy(q, 'before-cloud', (c) => c.text === before);
    need(copy && copy.text === before, copy ? 'the copy "before cloud" is not the state from before the sign-in' : 'there is no copy "before cloud"');
    return Object.keys(qSt.diary).length + ' days, ' + allIds(qSt.diary).length.toLocaleString() + ' entries, byte for byte as after Paste alone';
  });
  await step('then Paste the same log: "Nothing new", nothing changes and nothing is written', async () => {
    const had = await F.storedText(q), mark = cloud.mark();
    const said = await pasteInSettings(q, text);
    need(/^Nothing new/.test(said.msg || ''), 'the paste said ' + JSON.stringify(said));
    await rest(world);
    need((await F.storedText(q)) === had && cloud.writes({ from: mark }).length === 0, 'something changed or was written: ' + brief(cloud.writes({ from: mark })));
    return said.msg;
  });
  await step('the account holds exactly the phone\'s food log in meta/fuel and fuelDays; Overload\'s documents are untouched', async () => {
    const st = await F.stored(q), ws = cloud.writes({ who: 'Q' });
    need(ws.length === Object.keys(st.diary).length + 1 && ws.every((w) => w.app === 'fuel' && w.type === 'set' && w.state === 'applied' && FUEL_PATH.test(w.path)), 'writes: ' + brief(ws));
    for (const date of Object.keys(st.diary)) need(cloud.text(FUEL_DAYS + '/' + date) && cloud.get(FUEL_DAYS + '/' + date).data === JSON.stringify(st.diary[date]), 'fuelDays/' + date + ' is not the phone\'s day');
    same(coreOfCloud(cloud).food, st.food, 'the saved foods, meals and targets in meta/fuel');
    need(overloadDocs(cloud) === overload0, 'meta/state, workouts or foodDays changed');
    onlyFuelPaths(cloud);
    return ws.length + ' sets';
  });

  // ---- Paste, then sign in (an account of its own, holding the same documents v2.8 uploaded) ----
  const world2 = { browser, cloud: createCloud(), phones: [] }, cloud2 = world2.cloud;
  cloud2.addAccount(EMAIL, PASSWORD);
  Object.keys(docs).forEach((p) => cloud2.docs.set(p, docs[p]));
  const R = await makePhone(world2, 'R', TREE, { seed });
  let r = null;
  await step('paste first, then sign in: the sign-in changes nothing on the phone, not one character', async () => {
    r = await openFuel(R);
    need((await F.storedText(r)) === start, 'this phone did not start from the same saved data');
    const said = await pasteInSettings(r, text);
    need(said.toast === refSaid, 'the paste said ' + JSON.stringify(said) + ', on the phone that only pasted "' + refSaid + '"');
    const pasted = await F.storedText(r);
    need(travelsOf(JSON.parse(pasted)).diary === travelsOf(ref).diary && travelsOf(JSON.parse(pasted)).food === travelsOf(ref).food, 'the paste here did not give what it gave on the first phone');
    await signInInSettings(r);
    await rest(world2);
    need(cloud2.reads({ who: 'R' }).filter((x) => OVERLOAD_PATH.test(x.path)).length === 2, 'Overload\'s copy was not read at the sign-in');
    const after = await F.storedText(r);
    need(after === pasted, 'the sign-in changed the saved data at ' + F.diff(JSON.parse(after), JSON.parse(pasted)));
    const copy = await F.copy(r, 'before-cloud', (c) => c.text === pasted);
    need(copy && copy.text === pasted, copy ? 'the copy "before cloud" is not the state from before the sign-in' : 'there is no copy "before cloud"');
    const again = await pasteInSettings(r, text);
    need(/^Nothing new/.test(again.msg || '') && (await F.storedText(r)) === pasted, 'a second paste said ' + JSON.stringify(again) + ', or the saved data changed');
    need(overloadDocs(cloud2) === overload0, 'meta/state, workouts or foodDays changed');
    onlyFuelPaths(cloud2);
    return 'the same ' + after.length.toLocaleString() + ' characters; a second paste: ' + again.msg;
  });
  await step('both orders end byte for byte the same in the diary and the saved foods, meals and targets; no page error', async () => {
    const a = await F.stored(q), b = await F.stored(r);
    need(travelsOf(a).diary === travelsOf(b).diary, 'the diaries differ at ' + (F.diff(a.diary, b.diary) || 'the order of keys'));
    need(travelsOf(a).food === travelsOf(b).food, 'the foods differ at ' + (F.diff(a.food, b.food) || 'the order of keys'));
    same(a.deleted, b.deleted, 'the deletion records'); same(a.bodyweight, b.bodyweight, 'the body weight');
    once(a); once(b);
    for (const p of [P, Q, R]) F.assertClean(p, 'phone ' + p.name);
    return JSON.stringify(a.diary).length.toLocaleString() + ' characters of diary, ' + JSON.stringify(a.food).length.toLocaleString() + ' of food, on both';
  });

  // ---- the same on an account that holds Overload's core but no food days (cloud sync was turned on in Overload
  // after 2.8, which uploads no food days; the reviewer's t3). Overload's deletion records hold Y's, the copy v2.8
  // removed from one of its two days: they protect nothing there, and sign-in takes none of them, so the paste
  // that comes after brings Y on the day v2.8 still shows it, as Paste alone does (review finding sync#5) ----
  const noDays = {};
  Object.keys(docs).filter((p) => !p.startsWith(OLD_DAYS + '/')).forEach((p) => { noDays[p] = docs[p]; });
  const worlds = [0, 1].map(() => { const w = { browser, cloud: createCloud(), phones: [] }; w.cloud.addAccount(EMAIL, PASSWORD); Object.keys(noDays).forEach((p) => w.cloud.docs.set(p, noDays[p])); return w; });
  const ends = [];
  await step('an account without food days: sign in, then paste, gives exactly what Paste alone gives, with ' + Y + ' on ' + DAY_C, async () => {
    const w = worlds[0], S = await makePhone(w, 'S', TREE, { seed }), s = await openFuel(S);
    need(JSON.parse(w.cloud.get(OLD_META).core).deleted.food[Y] > 0 && !w.cloud.paths(OLD_DAYS).length, 'this check needs Y\'s record in meta/state and no food days');
    await signInInSettings(s);
    await rest(w);
    need(!(await F.stored(s)).deleted.food[Y], 'the sign-in took Overload\'s record of ' + Y);
    await pasteInSettings(s, text);
    await rest(w);
    const st = await F.stored(s); ends.push(st);
    need(travelsOf(st).diary === travelsOf(ref).diary, 'the diary differs from Paste alone at ' + (F.diff(st.diary, ref.diary) || 'the order of keys'));
    need(travelsOf(st).food === travelsOf(ref).food, 'the saved foods, meals or targets differ from Paste alone at ' + (F.diff(st.food, ref.food) || 'the order of keys'));
    same(st.deleted, ref.deleted, 'the deletion records');
    once(st);
    for (const date of Object.keys(st.diary)) need(w.cloud.get(FUEL_DAYS + '/' + date) && w.cloud.get(FUEL_DAYS + '/' + date).data === JSON.stringify(st.diary[date]), 'fuelDays/' + date + ' is not the phone\'s day');
    onlyFuelPaths(w.cloud);
    F.assertClean(S, 'phone S');
    return Object.keys(st.diary).length + ' days, ' + allIds(st.diary).length.toLocaleString() + ' entries';
  });
  await step('an account without food days: paste, then sign in, ends byte for byte the same as sign in, then paste', async () => {
    const w = worlds[1], T = await makePhone(w, 'T', TREE, { seed }), t = await openFuel(T);
    await pasteInSettings(t, text);
    const pasted = await F.storedText(t);
    await signInInSettings(t);
    await rest(w);
    const st = await F.stored(t);
    const p0 = JSON.parse(pasted);
    need(travelsOf(st).diary === travelsOf(p0).diary && travelsOf(st).food === travelsOf(p0).food, 'the sign-in changed the diary or the saved foods at ' + (F.diff(st.diary, p0.diary) || F.diff(st.food, p0.food) || 'the order of keys'));
    need(ends.length === 1, 'this check needs the other order\'s result');
    need(travelsOf(st).diary === travelsOf(ends[0]).diary && travelsOf(st).food === travelsOf(ends[0]).food, 'the two orders differ at ' + (F.diff(st.diary, ends[0].diary) || F.diff(st.food, ends[0].food) || 'the order of keys'));
    same(st.deleted, ends[0].deleted, 'the deletion records');
    once(st);
    onlyFuelPaths(w.cloud);
    F.assertClean(T, 'phone T');
    return 'the same ' + JSON.stringify(st.diary).length.toLocaleString() + ' characters of diary';
  });
  for (const p of world.phones.concat(world2.phones, worlds[0].phones, worlds[1].phones)) await p.close();
}

// ---------------------------------------------------------------------------
(async () => {
  console.log('# Fuel and the root app from ' + TREE + (TREE === lib.REPO ? ' (the working tree)' : ' (a copy)') + '; v2.8 from git ' + V28_COMMIT);
  const v28 = extractV28();
  const browser = await lib.launch();
  let docs = null;
  try {
    // The later runs start from the documents v2.8 uploaded in the first.
    const stopped = (label) => (e) => run.say(false, label, 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | '));
    const later = ['clipboard', 'returning', 'race', 'early', 'firstlink', 'lost'];
    const made = args.only === 'solo' || args.only === 'rules' ? null : await accountRun(browser, v28, later.includes(args.only)).catch((e) => { stopped('account')(e); return null; });
    docs = made && made.docs;
    const want = (k) => !args.only || args.only === k;
    if (later.some(want) && !docs) run.say(false, 'clipboard first', 'needs the account v2.8 fills in the first run', 'not run');
    if (docs && want('clipboard')) await clipboardRun(browser, docs).catch(stopped('clipboard first'));
    if (docs && want('clipboard')) await noDaysRun(browser, docs).catch(stopped('account without food days'));
    if (docs && want('returning')) await returningRun(browser, docs).catch(stopped('returning phone'));
    if (docs && want('race')) for (const last of ['F2', 'F1']) await raceRun(browser, docs, last).catch(stopped('race (' + last + ' lands last)'));
    if (docs && want('early')) await earlyRun(browser, docs).catch(stopped('before the module'));
    if (docs && want('firstlink')) await firstLinkRun(browser, docs).catch(stopped('first link not done'));
    if (docs && want('lost')) await lostAnswerRun(browser, docs).catch(stopped('lost answer'));
    if (!args.only || args.only === 'solo') await soloRun(browser).catch((e) => run.say(false, 'one phone', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')));
    // Sign-in and Paste from Overload, in both orders: an account of its own, which v2.8 fills.
    if (!args.only || args.only === 'rules') await sameRulesRun(browser, v28).catch((e) => run.say(false, 'sign-in and paste', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')));
  } finally {
    await browser.close();
  }
  run.done();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
