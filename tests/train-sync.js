#!/usr/bin/env node
/* Cloud sync of the training app (Overload 3.0) against the fake Firebase in tests/fake-firebase/.
 *
 *   node tests/train-sync.js [--only=small|main] [--base=v28] [--app=<folder>] [--port=8410]
 *
 * What must hold (SPEC section 3 item 9, section 6 and section 8; dev/notes/sync.md section 3 and hazards 1, 2, 15):
 *   - Overload 3.0 writes only users/{uid}/meta/state and users/{uid}/workouts/{id}. It issues no set and no
 *     delete below foodDays, and it neither reads nor listens there.
 *   - The food part of the core in meta/state (food targets, saved foods, saved meals, food deletion records)
 *     stays byte for byte what the cloud held, through: removal of the old food copy, Reset, Import, Restore,
 *     a new phone's first link, a first link of a phone that holds another food copy.
 *   - A second phone that still runs v2.8 on the same account keeps its food, and settings and workouts
 *     travel both ways.
 *   - One phone flipping v2.8 -> 3.0 -> v2.8 (a half-arrived update, a roll-back) issues no food write or delete.
 *   - The core is not sent before the cloud's core was seen in the session, and the first core of a session not
 *     before the server's own core was taken in (a cached copy is not enough: review finding S1).
 *   - What is no change of the data does not count as one (review findings S1, S5): a phone opened more than 90 days
 *     later with nothing changed sends nothing (the app drops deletion records past 90 days at every start), with or
 *     without its offline cache; a 3.0 phone's old food copy does not make its old weigh-in win over a correction
 *     made on another phone. A change made without signal still goes up, merged with what the others changed.
 *   - The note keeps every field v2.8 wrote, byte for byte; 3.0 adds `parts`, which v2.8 keeps and 3.0 uses only
 *     for the core it was worked out from.
 *
 * How: every phone is a browser context with its own storage. The app's files are answered from a folder on
 * disk by a Playwright route (nothing listens on the port), so one phone can be switched between v2.8 (taken
 * from git, commit 3b17963, into a temporary folder) and 3.0 (the working tree) on the same storage, and a
 * phone can be "offline" with its app files still there, as with a service worker. The three Firebase SDK
 * files are the stand-ins of tests/fake-firebase/; no outside host is contacted.
 *
 *   --base=v28   run the 3.0 side as v2.8's own files plus this tree's sync.js. For use while the training
 *                app's other files are being changed and cannot be loaded. The checks about what the app's
 *                Reset, Import and Restore do then describe v2.8's app, and must be run again without the flag.
 *   --app=DIR    another folder to serve as 3.0 (default: the repo this file is in).
 *
 * The app-side actions: Reset, Import, Restore and the removal of the old food log are done through the app's
 * own buttons (Settings; the removal as the app asks for it: Save as a file first, then Remove). A changed
 * setting and a new workout are made in the app's state followed by the app's own save(), which is all cloud
 * sync ever sees of them; so are the removals that the app itself would not do (signed out, without the sync
 * module, the whole food copy) and, with --base=v28, every removal. Prints one PASS or FAIL line per check;
 * exit code 1 when a check failed.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const lib = require('./lib');
const { createCloud } = require('./fake-firebase/route');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] == null ? true : m[2]] : [a, true]; }));
const PORT = Number(args.port) || 8410;
const ORIGIN = lib.LOCAL + ':' + PORT;
const V28_COMMIT = '3b17963';
const EMAIL = 'owner@example.com', PASSWORD = 'correct horse';
const META = 'users/U1/meta/state', DAYS = 'users/U1/foodDays', WORKOUTS = 'users/U1/workouts';
const NOTE = 'overload.sync.v1';
const FOOD_PATH = /\/foodDays(\/|$)/;
const TRAINING_PATH = /^users\/U\d+\/(meta\/state|workouts\/[^/]+)$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };

let failed = 0, passed = 0;
function check(ok, label, detail) {
  if (ok) passed++; else failed++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  — ' + detail : ''));
  return !!ok;
}

// ---------------------------------------------------------------------------
// The two versions of the app, as folders
// ---------------------------------------------------------------------------
const temp = [];
function tempDir(name) { const d = fs.mkdtempSync(path.join(os.tmpdir(), name)); temp.push(d); return d; }
function cleanUp() { temp.splice(0).forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* leave it */ } }); }
process.on('exit', cleanUp);

function extractV28() {
  const dir = tempDir('overload-v28-');
  execSync('git -C "' + lib.REPO + '" archive ' + V28_COMMIT + ' | tar -x -C "' + dir + '"', { stdio: ['ignore', 'ignore', 'inherit'] });
  if (!fs.existsSync(path.join(dir, 'sync.js'))) throw new Error('could not extract v2.8 (' + V28_COMMIT + ') from git');
  return dir;
}
// v2.8's files with this tree's sync.js: the stand-in for 3.0 while the rest of the app is being changed.
function v28WithNewSync(v28, from) {
  const dir = tempDir('overload-v28sync-');
  fs.cpSync(v28, dir, { recursive: true });
  fs.copyFileSync(path.join(from, 'sync.js'), path.join(dir, 'sync.js'));
  return dir;
}

// ---------------------------------------------------------------------------
// Phones
// ---------------------------------------------------------------------------
// Answers the app's own address from the folder the phone is on right now.
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

/** One phone: its own storage, one device of the fake cloud. fx: the fixture to seed, or null for a new phone. */
async function makePhone(run, name, fx, version) {
  const phone = await lib.newPhone(run.browser, { now: run.meta.now, timezoneId: run.meta.tz });
  phone.name = name;
  phone.eras = [];   // which version issued which part of the cloud's log
  phone.setVersion = (v) => {
    const n = run.cloud.mark();
    if (phone.eras.length) phone.eras[phone.eras.length - 1].to = n;
    phone.version = v; phone.tree = run.trees[v];
    phone.eras.push({ version: v, from: n, to: Infinity });
  };
  phone.setVersion(version);
  await serveTree(phone);
  phone.device = await run.cloud.attach(phone.context, name);
  if (fx) await lib.seedV28(phone.context, fx);
  // Opens the app and waits until the sync module is there. (The remembered sign-in follows a moment later: settle.)
  // noSync: the Firebase SDK cannot be loaded on this start, so the sync module never runs.
  phone.open = async (noSync) => {
    phone.device.blockSdk(!!noSync);
    phone.page = await lib.openApp(phone.context, ORIGIN + '/index.html');
    if (!noSync) await phone.page.waitForFunction(() => !!window.__overloadSync, null, { timeout: 15000 });
    return phone.page;
  };
  // Close the app and start it again, on another version if one is named.
  phone.restart = async (v, noSync) => { if (phone.page) await phone.page.close(); if (v) phone.setVersion(v); return phone.open(noSync); };
  phone.ev = (fn, arg) => phone.page.evaluate(fn, arg);
  run.phones.push(phone);
  return phone;
}

// Lets the phones and the cloud come to rest: push timers fire (one second after a save), writes arrive, the
// other phones' listeners run, and so on until nothing new is logged. False when they never stop.
async function settle(run, phones) {
  phones = (phones || run.phones).filter((p) => p.page && !p.page.isClosed());
  let last = -1, quiet = 0;
  for (let i = 0; i < 40; i++) {
    for (const p of phones) await p.page.clock.runFor(1100).catch(() => {});
    await run.cloud.idle();
    for (const p of phones) await p.page.evaluate(() => 0).catch(() => {});
    await run.cloud.idle();
    const n = run.cloud.log.length;
    if (n === last) { if (++quiet >= 2) return true; } else { quiet = 0; last = n; }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Reading the phone and the cloud
// ---------------------------------------------------------------------------
// The three pieces of the old food copy, as text, from what the phone has stored.
function foodPieces(stateText) {
  const s = JSON.parse(stateText);
  return { food: JSON.stringify(s.food), diary: JSON.stringify(s.diary), del: JSON.stringify(s.deleted && s.deleted.food) };
}
const sameFood = (a, b) => a.food === b.food && a.diary === b.diary && a.del === b.del;
// For a phone on v2.8: its own merge puts the food deletion records in alphabetical order whenever a core
// arrives, so their text may be reordered. The same records, and food and diary byte for byte.
const sorted = (text) => { const o = JSON.parse(text || '{}'); return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])); };
const keptFood = (a, b) => a.food === b.food && a.diary === b.diary && sorted(a.del) === sorted(b.del);
const stored = (phone) => lib.readStorageText(phone.page, lib.STATE_KEY);
const storedFood = async (phone) => foodPieces(await stored(phone));
const noteOf = async (phone) => JSON.parse((await lib.readStorageText(phone.page, NOTE)) || 'null');
const memState = (phone) => phone.ev(() => JSON.parse(JSON.stringify(window.__overload.state)));

// The food part of the core in meta/state, as the exact piece of the stored text: the food targets, saved
// foods and saved meals, and the food deletion records right after them. Comparing two of these compares bytes.
function foodPartOf(coreText) {
  const core = JSON.parse(coreText);
  const piece = '"food":' + JSON.stringify(core.food) + ',"deleted":{"food":' + JSON.stringify(core.deleted.food);
  if (coreText.indexOf(piece) < 0) throw new Error('the core text does not hold its food part in one piece');
  return piece;
}
const cloudCore = (run) => { const d = run.cloud.get(META); return d ? JSON.parse(d.core) : null; };
const cloudFood = (run) => foodPartOf(run.cloud.get(META).core);
// The food part inside one logged write of meta/state.
const writtenFood = (w) => foodPartOf(JSON.parse(w.json).core);
// The whole log, in order: every core a phone on 3.0 wrote must carry the food part of the core the cloud held
// just before it. Returns the writes that did not.
function foodChangedBy30(run) {
  const on30 = (w) => run.phones.some((p) => p.name === w.who && p.eras.some((e) => e.version === 'v30' && w.n >= e.from && w.n < e.to));
  let held = null; const bad = [];
  run.cloud.writes().filter((w) => w.path === META && w.type === 'set' && w.state === 'applied').sort((a, b) => a.rev - b.rev).forEach((w) => {
    const food = writtenFood(w);
    if (held !== null && food !== held && on30(w)) bad.push(w);
    held = food;
  });
  return bad;
}
const list = (ws) => ws.map((w) => w.type + ' ' + w.path.replace('users/U1/', '') + (w.state === 'applied' ? '' : ' (' + w.state + ')'));
const brief = (ws) => { const l = list(ws); return l.length ? l.length + ': ' + l.slice(0, 4).join(', ') + (l.length > 4 ? ', …' : '') : 'none'; };

// ---------------------------------------------------------------------------
// What the person does
// ---------------------------------------------------------------------------
const changeRest = (phone, sec) => phone.ev((v) => { window.__overload.state.settings.restSec = v; window.__overload.save(); }, sec);
// A finished workout, as the app stores one: a copy of the newest (or a bare one on a phone without history).
const addWorkout = (phone, id) => phone.ev((newId) => {
  const s = window.__overload.state, last = s.workouts[s.workouts.length - 1], now = Date.now();
  const w = last ? JSON.parse(JSON.stringify(last)) : { date: window.__overload.lib.todayKey(), dayId: null, dayName: 'Test day', soreness: null, entries: [] };
  w.id = newId; w.startedAt = now - 3600e3; w.finishedAt = now;
  s.workouts.push(w); window.__overload.save();
}, id);
// What rule 5 of the spec does to the data: the diary is emptied, nothing else.
const removeDiary = (phone) => phone.ev(() => { window.__overload.state.diary = {}; window.__overload.save(); return JSON.parse(localStorage.getItem('overload.sync.v1') || 'null'); });
// Harsher than the spec allows the app to be: the whole old food copy gone.
const removeAllFood = (phone) => phone.ev(() => {
  const s = window.__overload.state;
  s.diary = {}; s.food = { targets: { kcal: null, protein: null, carbs: null, fat: null }, foods: {}, meals: {} }; s.deleted.food = {};
  window.__overload.save();
});
async function settings(phone) { await lib.openTab(phone.page, 'settings'); }
// The app's own removal (3.0, the card "Food has moved"): it is offered only after the log was copied or saved
// on this phone, so the log is saved as a file first; then Remove, and its two questions are answered yes.
// Returns false when the app has no such card (v2.8's files with the new sync.js).
async function uiRemoveFoodLog(phone) {
  await settings(phone);
  if (!(await phone.page.$('[data-action="handover-file"]'))) return false;
  const file = phone.page.waitForEvent('download', { timeout: 8000 });
  await phone.page.click('[data-action="handover-file"]');
  await file;
  await phone.page.click('[data-action="handover-remove"]', { timeout: 5000 });
  await phone.page.waitForFunction(() => Object.keys(window.__overload.state.diary).length === 0, null, { timeout: 8000 });
  return true;
}
async function uiReset(phone) {
  await settings(phone);
  await phone.page.click('[data-action="reset"]', { timeout: 5000 });
  await phone.page.waitForFunction(() => window.__overload.state.workouts.length === 0, null, { timeout: 5000 });
}
async function uiImport(phone, fileText, workouts) {
  await settings(phone);
  await phone.page.setInputFiles('#import-file', { name: 'overload-backup-2026-11-21.json', mimeType: 'application/json', buffer: Buffer.from(fileText) }, { timeout: 5000 });
  await phone.page.waitForFunction((n) => window.__overload.state.workouts.length === n, workouts, { timeout: 8000 });
}
async function uiRestore(phone, id, workouts) {
  await settings(phone);
  await phone.page.click('#safety-copies [data-action="restore-copy"][data-id="' + id + '"]', { timeout: 8000 });
  await phone.page.waitForFunction((n) => window.__overload.state.workouts.length === n, workouts, { timeout: 8000 });
}

// ---------------------------------------------------------------------------
// One account, three to five phones: everything except the flip
// ---------------------------------------------------------------------------
async function accountRun(browser, trees, fx, other) {
  const T = fx.name + ': ';
  const run = { browser, trees, meta: fx.meta, cloud: createCloud(), phones: [] };
  const { cloud } = run;
  const st = fx.state, nWorkouts = st.workouts.length, nDays = Object.keys(st.diary).length;
  const c = (ok, label, detail) => check(ok, T + label, detail);

  // ---- the account as v2.8 left it ----
  const A = await makePhone(run, 'A', fx, 'v28');
  await A.open();
  await A.ev(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL, PASSWORD]);
  await settle(run);
  c(cloud.paths(WORKOUTS).length === nWorkouts && cloud.paths(DAYS).length === nDays && !!cloud.get(META),
    'set-up: v2.8 uploaded the account (meta/state, ' + nWorkouts + ' workouts, ' + nDays + ' food days)',
    cloud.paths(WORKOUTS).length + ' workouts, ' + cloud.paths(DAYS).length + ' food days');
  const days0 = JSON.stringify(cloud.snapshot(DAYS));
  let food0 = cloudFood(run);
  const fixtureFood = foodPieces(fx.text);
  const note0 = await lib.readStorageText(A.page, NOTE);

  // ---- start signed in on 3.0 ----
  let mark = cloud.mark();
  await A.restart('v30');
  c(await settle(run), 'A starts on 3.0 and comes to rest');
  c((await A.ev(() => (window.__overloadSync.user || {}).uid)) === 'U1', 'A is still signed in on 3.0');
  let ws = cloud.writes({ from: mark });
  c(!ws.some((w) => FOOD_PATH.test(w.path)) && ws.every((w) => w.path === META), 'the 3.0 start writes nothing below foodDays or workouts', 'writes: ' + brief(ws));
  if (trees.strict) c(ws.length === 0, 'the 3.0 start writes nothing at all (v2.8 app files with the new sync.js)', 'writes: ' + brief(ws));
  c(cloud.reads({ who: 'A', from: mark, path: FOOD_PATH }).length === 0, '3.0 does not read foodDays and does not listen there');
  c(cloud.reads({ who: 'A', from: mark, path: /meta\/state$/ }).length > 0 && cloud.reads({ who: 'A', from: mark, path: /\/workouts$/ }).length > 0, '3.0 listens to meta/state and workouts');
  // One field is added to it: parts, worked out from the core the note names (the cached core is that one).
  const note1 = await lib.readStorageText(A.page, NOTE), parts1 = (JSON.parse(note1) || {}).parts;
  c(!!parts1 && note1 === note0.slice(0, -1) + ',"parts":' + JSON.stringify(parts1) + '}' && parts1.core === JSON.parse(note0).core,
    'the note overload.sync.v1 is exactly as v2.8 left it (food days included), with one field added: parts, for the core it names', String(note1).slice(0, 120));
  c(sameFood(await storedFood(A), fixtureFood), 'A\'s old food copy (food, diary, deleted.food) is the fixture\'s, byte for byte');
  c(cloudFood(run) === food0 && JSON.stringify(cloud.snapshot(DAYS)) === days0, 'cloud: food part of meta/state and all food days unchanged by the 3.0 start');
  c((await A.ev(() => window.__overloadSync.foodInCloud)) === true, 'foodInCloud is true: the note proves the account holds this phone\'s food log');

  // ---- a training setting, a workout ----
  mark = cloud.mark();
  const rest1 = st.settings.restSec === 120 ? 135 : 120;
  await changeRest(A, rest1); await settle(run);
  ws = cloud.writes({ from: mark });
  c(ws.length === 1 && ws[0].who === 'A' && ws[0].type === 'set' && ws[0].path === META, 'a changed training setting: one write, set meta/state', 'writes: ' + brief(ws));
  c(cloudCore(run).settings.restSec === rest1, 'the setting is in the cloud\'s core');
  c(cloudFood(run) === food0, 'the food part of meta/state is byte-identical after the setting change');

  mark = cloud.mark();
  await addWorkout(A, 'testworkoutA1'); await settle(run);
  ws = cloud.writes({ from: mark });
  c(ws.some((w) => w.type === 'set' && w.path === WORKOUTS + '/testworkoutA1') && ws.every((w) => TRAINING_PATH.test(w.path)), 'a new workout: written to workouts, and nothing outside meta/state and workouts', 'writes: ' + brief(ws));
  c(cloudFood(run) === food0 && JSON.stringify(cloud.snapshot(DAYS)) === days0, 'food part and food days unchanged after the workout');

  // ---- a second phone that stays on v2.8 ----
  const B = await makePhone(run, 'B', null, 'v28');
  await B.open();
  await B.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]);
  c(await settle(run), 'B (v2.8, a new phone) signs in and the phones come to rest');
  let b = await memState(B);
  c(Object.keys(b.diary).length === nDays && Object.keys(b.food.foods).length === Object.keys(st.food.foods).length && b.workouts.length === nWorkouts + 1,
    'B (v2.8) downloaded the account: food days, saved foods and workouts', Object.keys(b.diary).length + ' days, ' + Object.keys(b.food.foods).length + ' foods, ' + b.workouts.length + ' workouts');
  c(!cloud.writes({ who: 'A', from: mark }).some((w) => FOOD_PATH.test(w.path)) && sameFood(await storedFood(A), fixtureFood), 'A issued no food write while B joined, and A\'s old food copy did not change');
  food0 = cloudFood(run);   // B's v2.8 may have re-sent the core at its first link: that is v2.8's business
  let bFood = await storedFood(B);

  // settings and workouts, both ways
  mark = cloud.mark();
  const rest2 = rest1 + 15;
  await changeRest(A, rest2); c(await settle(run), 'A (3.0) changes a setting; the phones come to rest');
  c((await memState(B)).settings.restSec === rest2, 'A -> B: the setting arrived on the v2.8 phone');
  c(keptFood(await storedFood(B), bFood), 'B kept its food while taking A\'s core');
  await B.ev(() => { window.__overload.state.settings.increment = 7.5; window.__overload.save(); });
  c(await settle(run), 'B (v2.8) changes a setting; the phones come to rest');
  c((await memState(A)).settings.increment === 7.5, 'B -> A: the setting arrived on the 3.0 phone');
  await addWorkout(A, 'testworkoutA2'); await settle(run);
  c((await memState(B)).workouts.some((w) => w.id === 'testworkoutA2'), 'A -> B: the workout arrived on the v2.8 phone');
  await addWorkout(B, 'testworkoutB1'); await settle(run);
  c((await memState(A)).workouts.some((w) => w.id === 'testworkoutB1'), 'B -> A: the workout arrived on the 3.0 phone');
  ws = cloud.writes({ who: 'A', from: mark });
  c(ws.every((w) => TRAINING_PATH.test(w.path)), 'A wrote only meta/state and workouts during the exchange', 'A\'s writes: ' + brief(ws));
  c(sameFood(await storedFood(A), fixtureFood), 'A\'s old food copy still did not change');

  // B uses the Food tab of v2.8: an entry deleted and one logged in the newest day, a target changed,
  // a whole old day deleted, a new day started.
  mark = cloud.mark();
  const dates = Object.keys(st.diary).sort(), newest = dates[dates.length - 1], oldest = dates[0];
  await B.ev(([newestDay, oldestDay]) => {
    const s = window.__overload.state, now = Date.now();
    const gone = s.diary[newestDay][0];
    s.diary[newestDay] = s.diary[newestDay].slice(1).concat([Object.assign({}, gone, { id: 'testentryB01', at: now })]);
    s.deleted.food[gone.id] = now;
    s.diary[oldestDay].forEach((e) => { s.deleted.food[e.id] = now; });
    delete s.diary[oldestDay];
    s.diary['2026-01-05'] = [Object.assign({}, gone, { id: 'testentryB02', at: now + 1 })];
    s.food.targets.kcal = 2000;
    window.__overload.save();
  }, [newest, oldest]);
  c(await settle(run), 'B (v2.8) logs, deletes and changes a target; the phones come to rest (no write loop)');
  ws = cloud.writes({ from: mark });
  c(ws.some((w) => w.who === 'B' && w.path === DAYS + '/' + newest) && ws.some((w) => w.who === 'B' && w.type === 'delete' && w.path === DAYS + '/' + oldest) && ws.some((w) => w.who === 'B' && w.path === META),
    'B (v2.8) wrote its food changes: meta/state, a food day, a deleted food day', 'B\'s writes: ' + brief(ws.filter((w) => w.who === 'B')));
  c(ws.filter((w) => w.who === 'A').length === 0, 'A wrote nothing in answer to B\'s food changes', 'A\'s writes: ' + brief(ws.filter((w) => w.who === 'A')));
  c(sameFood(await storedFood(A), fixtureFood), 'A\'s old food copy did not take B\'s food changes (entries, deleted day, target, deletion records)');
  let foodB = cloudFood(run);
  c(foodB !== food0 && cloudCore(run).food.targets.kcal === 2000, 'the cloud\'s food part is now B\'s');
  const daysB = JSON.stringify(cloud.snapshot(DAYS));
  bFood = await storedFood(B);

  mark = cloud.mark();
  const rest3 = rest2 + 15;
  await changeRest(A, rest3); c(await settle(run), 'A changes a training setting after B\'s food changes; the phones come to rest');
  ws = cloud.writes({ who: 'A', from: mark });
  c(ws.length === 1 && ws[0].path === META, 'A wrote meta/state once', 'A\'s writes: ' + brief(ws));
  c(ws.length === 1 && writtenFood(ws[0]) === foodB, 'A\'s core carries the food part the cloud held (B\'s new one), byte for byte, not A\'s old copy');
  c((await memState(B)).settings.restSec === rest3 && keptFood(await storedFood(B), bFood), 'B got the setting and kept its food');
  // v2.8 sorts its deletion records when a core arrives and sends the core again: from here on that is the cloud's food part.
  const after = cloud.writes({ from: mark }).filter((w) => w.path === META);
  c(cloudFood(run) === foodB || after[after.length - 1].who === 'B', 'if the food part changed afterwards, it was B (v2.8) who wrote it', 'meta/state written by: ' + after.map((w) => w.who).join(', '));
  foodB = cloudFood(run); bFood = await storedFood(B);

  // ---- removal of the old food copy on A ----
  mark = cloud.mark();
  let byButton = false;
  try { byButton = await uiRemoveFoodLog(A); }
  catch (e) { c(false, 'removal through the app\'s own button (Save as a file, then Remove the old food log)', String(e.message).split('\n')[0]); }
  if (byButton) c(Object.keys((await memState(A)).diary).length === 0, 'removal through the app\'s own button (Save as a file, then Remove the old food log): the diary is empty');
  else console.log('# ' + T + 'the food log is removed in the app\'s state (' + (trees.strict ? 'v2.8\'s files have no card for it' : 'the app\'s button could not be used') + ')');
  const noteAfter = byButton ? await noteOf(A) : await removeDiary(A);
  c(noteAfter && Object.keys(noteAfter.days).length === 0, 'removal (diary emptied): the food days are forgotten in the note at once, in the same save');
  c(await settle(run), 'the phones come to rest after the removal');
  ws = cloud.writes({ from: mark });
  c(ws.length === 0, 'removal: no write at all', 'writes: ' + brief(ws));
  c(JSON.stringify(cloud.snapshot(DAYS)) === daysB && cloudFood(run) === foodB, 'removal: every food day and the food part of meta/state are still in the cloud, byte-identical');
  c(keptFood(await storedFood(B), bFood), 'removal: B kept its food days and saved foods');
  c((await A.ev(() => window.__overloadSync.foodInCloud)) === false, 'foodInCloud is false once the phone has no food days');
  mark = cloud.mark();
  await changeRest(A, rest3 + 15); await settle(run);
  c(cloud.writes({ who: 'A', from: mark }).length === 1 && cloudFood(run) === foodB, 'a setting change after the removal keeps the cloud\'s food part');
  await A.restart();
  await settle(run);
  mark = cloud.mark();
  await changeRest(A, rest3 + 30); await settle(run);
  ws = cloud.writes({ who: 'A', from: mark });
  c(ws.length === 1 && ws[0].path === META && cloudFood(run) === foodB && JSON.stringify(cloud.snapshot(DAYS)) === daysB, 'the same after A was closed and opened again', 'A\'s writes: ' + brief(ws));

  // ---- Reset, Import, Restore: the app's own buttons, signed in ----
  const before = (await memState(A)).workouts.length;
  mark = cloud.mark();
  await uiReset(A);
  c(await settle(run), 'Reset on A (signed in); the phones come to rest');
  ws = cloud.writes({ who: 'A', from: mark });
  c(ws.some((w) => w.type === 'delete' && /\/workouts\//.test(w.path)) && ws.some((w) => w.path === META), 'Reset: the training data in the account is replaced (workouts deleted, meta/state written)', 'A\'s writes: ' + brief(ws));
  c(ws.every((w) => TRAINING_PATH.test(w.path)), 'Reset: no set or delete below foodDays');
  c(cloudFood(run) === foodB && JSON.stringify(cloud.snapshot(DAYS)) === daysB, 'Reset: the food part of meta/state and every food day byte-identical');
  c(keptFood(await storedFood(B), bFood), 'Reset: B (v2.8) kept its food');

  mark = cloud.mark();
  await uiImport(A, JSON.stringify(fx.state, null, 2), nWorkouts);
  c(await settle(run), 'Import of a backup file on A; the phones come to rest');
  ws = cloud.writes({ who: 'A', from: mark });
  c(ws.filter((w) => w.type === 'set' && /\/workouts\//.test(w.path)).length === nWorkouts && ws.some((w) => w.path === META), 'Import: the file\'s training data goes to the account', 'A\'s writes: ' + brief(ws));
  c(ws.every((w) => TRAINING_PATH.test(w.path)), 'Import: no set or delete below foodDays');
  c(cloudFood(run) === foodB && JSON.stringify(cloud.snapshot(DAYS)) === daysB, 'Import: the food part of meta/state and every food day byte-identical');
  c(keptFood(await storedFood(B), bFood), 'Import: B (v2.8) kept its food');

  mark = cloud.mark();
  await uiRestore(A, 'before-reset', before);
  c(await settle(run), 'Restore of the automatic copy "Before reset" on A; the phones come to rest');
  ws = cloud.writes({ who: 'A', from: mark });
  c(ws.length > 0 && ws.every((w) => TRAINING_PATH.test(w.path)), 'Restore: training data written, no set or delete below foodDays', 'A\'s writes: ' + brief(ws));
  c(cloudFood(run) === foodB && JSON.stringify(cloud.snapshot(DAYS)) === daysB, 'Restore: the food part of meta/state and every food day byte-identical');
  c(keptFood(await storedFood(B), bFood), 'Restore: B (v2.8) kept its food');

  // ---- harsher than the app: the whole old food copy gone from A ----
  mark = cloud.mark();
  await removeAllFood(A); c(await settle(run), 'A loses its whole old food copy (food, diary, records); the phones come to rest');
  c(cloud.writes({ from: mark }).length === 0, 'no write at all, although A\'s food is now empty', 'writes: ' + brief(cloud.writes({ from: mark })));
  await changeRest(A, rest3 + 45); await settle(run);
  c(cloudFood(run) === foodB && cloudCore(run).settings.restSec === rest3 + 45, 'a later core from A still carries the cloud\'s food part, not A\'s empty one');
  c(keptFood(await storedFood(B), bFood), 'B (v2.8) kept its saved foods, meals and targets');

  // ---- a new phone's first link on 3.0 ----
  mark = cloud.mark();
  const C = await makePhone(run, 'C', null, 'v30');
  await C.open();
  await C.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]);
  c(await settle(run), 'C (3.0, a new phone) signs in; the phones come to rest');
  const rc = cloud.reads({ who: 'C', from: mark });
  c(rc.some((r) => r.type === 'get' && r.path === META) && rc.some((r) => r.type === 'list' && r.path === WORKOUTS) && !rc.some((r) => FOOD_PATH.test(r.path)), 'first link on 3.0 reads meta/state and workouts, never foodDays');
  let cs = await memState(C);
  c(cs.workouts.length === (await memState(A)).workouts.length && cs.settings.restSec === rest3 + 45, 'C took the account\'s training data', cs.workouts.length + ' workouts');
  c(Object.keys(cs.diary).length === 0 && Object.keys(cs.food.foods).length === 0 && Object.keys(cs.food.meals).length === 0, 'C took no food: diary, saved foods and meals stay empty');
  ws = cloud.writes({ who: 'C', from: mark });
  c(ws.every((w) => TRAINING_PATH.test(w.path)), 'C\'s first link: no set or delete below foodDays', 'C\'s writes: ' + brief(ws));
  c(cloudFood(run) === foodB && JSON.stringify(cloud.snapshot(DAYS)) === daysB, 'C\'s first link: the food part of meta/state and every food day byte-identical');
  c((await noteOf(C)).days && Object.keys((await noteOf(C)).days).length === 0 && (await C.ev(() => window.__overloadSync.foodInCloud)) === false, 'C\'s note lists no food days; foodInCloud is false there');
  mark = cloud.mark();
  await changeRest(C, rest3 + 60); await settle(run);
  ws = cloud.writes({ who: 'C', from: mark });
  c(ws.length === 1 && ws[0].path === META && cloudFood(run) === foodB, 'a setting changed on C: meta/state written with the cloud\'s food part, not C\'s empty one', 'C\'s writes: ' + brief(ws));

  // ---- a first link of a phone that holds another food copy ----
  if (other) {
    mark = cloud.mark();
    const D = await makePhone(run, 'D', other, 'v30');
    await D.open();
    const dFood = foodPieces(other.text);
    await D.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]);
    c(await settle(run), 'D (3.0, holding the ' + other.name + ' data) signs in to this account; the phones come to rest');
    c(sameFood(await storedFood(D), dFood), 'D\'s own old food copy is untouched by the first link (nothing merged in, nothing dropped)');
    ws = cloud.writes({ who: 'D', from: mark });
    c(ws.every((w) => TRAINING_PATH.test(w.path)) && !cloud.reads({ who: 'D', from: mark, path: FOOD_PATH }).length, 'D\'s first link: no read, set or delete below foodDays', 'D\'s writes: ' + brief(ws));
    c(cloudFood(run) === foodB && JSON.stringify(cloud.snapshot(DAYS)) === daysB, 'D\'s first link: the food part of meta/state and every food day byte-identical (D\'s food was not uploaded)');
    c(keptFood(await storedFood(B), bFood), 'B (v2.8) kept its food through D\'s first link');

    // The same phone signs in to an account that holds nothing yet. The first core creates the account's food
    // part from the phone's own; there is no food part to keep. Food days are not uploaded even then.
    mark = cloud.mark();
    await D.ev(() => window.__overloadSync.signOut());
    await D.ev(([e, p]) => window.__overloadSync.createAccount(e, p), ['second@example.com', PASSWORD]);
    c(await settle(run), 'D creates a second, empty account; the phones come to rest');
    ws = cloud.writes({ who: 'D', from: mark });
    c(ws.some((w) => w.path === 'users/U2/meta/state') && ws.length > 1 && ws.every((w) => /^users\/U2\/(meta\/state|workouts\/[^/]+)$/.test(w.path)), 'an empty account gets meta/state and workouts from the phone, and no food days', 'D\'s writes: ' + ws.length);
    const d2 = JSON.parse(cloud.get('users/U2/meta/state').core);
    c(JSON.stringify(d2.food) === dFood.food && JSON.stringify(d2.deleted.food) === dFood.del, 'the first core of an empty account carries the phone\'s own saved foods, meals and targets');
    c(cloudFood(run) === foodB && JSON.stringify(cloud.snapshot(DAYS)) === daysB && !cloud.writes({ from: mark, path: /^users\/U1\// }).some((w) => w.who === 'D'), 'the first account is untouched by it');
    c(sameFood(await storedFood(D), dFood), 'D\'s own old food copy is still untouched');
    await D.page.close();
  }

  // ---- the core waits for the cloud's core: offline at start, nothing cached ----
  await C.page.close();
  C.device.clearCache();
  await C.device.setOffline(true);
  await C.open();
  await settle(run, [C]);
  mark = cloud.mark();
  await changeRest(C, rest3 + 75);
  await addWorkout(C, 'testworkoutC1');
  await settle(run, [C]);
  ws = cloud.writes({ who: 'C', from: mark });
  c(ws.some((w) => w.path === WORKOUTS + '/testworkoutC1' && w.state === 'queued'), 'offline at start with nothing cached: the workout is queued', 'C\'s writes: ' + brief(ws));
  c(!ws.some((w) => w.path === META), 'offline at start with nothing cached: the core is NOT sent before the cloud\'s core was seen', 'C\'s writes: ' + brief(ws));
  await C.device.setOffline(false);
  c(await settle(run), 'C is online again; the phones come to rest');
  ws = cloud.writes({ who: 'C', from: mark });
  c(ws.some((w) => w.path === META && w.state === 'applied') && cloudCore(run).settings.restSec === rest3 + 75, 'once the cloud\'s core was seen the core goes', 'C\'s writes: ' + brief(ws));
  c(cloudFood(run) === foodB, 'and it carries the cloud\'s food part, not C\'s empty one');
  c(!!cloud.get(WORKOUTS + '/testworkoutC1'), 'the queued workout arrived');

  // ---- offline over a restart: the core this phone queued shows the food part to carry ----
  // The first change is made in a session that has seen the server's core, so it is queued. The second is made after
  // a restart without signal: that session has seen only the cached core, so the core waits for the server's own.
  await C.device.setOffline(true);
  mark = cloud.mark();
  await changeRest(C, rest3 + 90); await settle(run, [C]);
  await C.restart(); await settle(run, [C]);
  await changeRest(C, rest3 + 105); await settle(run, [C]);
  ws = cloud.writes({ who: 'C', from: mark });
  c(ws.length === 1 && ws[0].path === META && ws[0].state === 'queued', 'offline, with the app closed and opened in between: the change made before the restart is queued as a core; the one after it waits (the server\'s core not seen in that session)', 'C\'s writes: ' + brief(ws));
  c(ws.length === 1 && writtenFood(ws[0]) === foodB, 'the queued core carries the cloud\'s food part, byte for byte');
  await C.device.setOffline(false);
  c(await settle(run), 'C is online again; the phones come to rest');
  ws = cloud.writes({ who: 'C', from: mark }).filter((w) => w.path === META);
  const readC = cloud.reads({ who: 'C', from: mark, path: /meta\/state$/ }).filter((r) => r.type === 'get' && r.ok).map((r) => r.n);
  c(ws.length === 2 && ws.every((w) => w.state === 'applied') && readC.length > 0 && Math.min(...readC) < ws[1].n && writtenFood(ws[1]) === foodB,
    'online again: the waiting core goes after C read the account\'s core from the server, with the cloud\'s food part', 'C\'s cores: ' + brief(ws) + '; server reads of meta/state at ' + readC.join(', '));
  c(cloudCore(run).settings.restSec === rest3 + 105 && cloudFood(run) === foodB && JSON.stringify(cloud.snapshot(DAYS)) === daysB, 'both changes arrived; the food part and the food days are byte-identical');

  // ---- the whole run ----
  const by30 = cloud.writes().filter((w) => run.phones.some((p) => p.name === w.who && p.eras.some((e) => e.version === 'v30' && w.n >= e.from && w.n < e.to)));
  c(by30.length > 0 && by30.every((w) => TRAINING_PATH.test(w.path)), 'every write issued by a phone on 3.0 in this run went to meta/state or workouts', by30.length + ' writes, ' + by30.filter((w) => !TRAINING_PATH.test(w.path)).length + ' elsewhere');
  c(!by30.some((w) => FOOD_PATH.test(w.path)), 'no set or delete whose path holds /foodDays/ was issued by 3.0 in any scenario');
  const changed = foodChangedBy30(run);
  c(changed.length === 0, 'every core written on 3.0 carried the food part the cloud held just before it, byte for byte', by30.filter((w) => w.path === META).length + ' cores written on 3.0, ' + changed.length + ' with another food part');
  c(keptFood(await storedFood(B), bFood) && JSON.stringify(cloud.snapshot(DAYS)) === daysB, 'at the end B (v2.8) has its food and the cloud its food days');
  const errors = run.phones.reduce((all, p) => all.concat(p.pageErrors.map((t) => p.name + ': ' + t.split('\n')[0])), []);
  c(errors.length === 0, 'no page error on any phone', errors.slice(0, 3).join(' | '));
  for (const p of run.phones) await p.close();
}

// ---------------------------------------------------------------------------
// One phone that goes back and forth between v2.8 and 3.0
// ---------------------------------------------------------------------------
async function flipRun(browser, trees, fx) {
  const T = fx.name + ' flip: ';
  const run = { browser, trees, meta: fx.meta, cloud: createCloud(), phones: [] };
  const { cloud } = run;
  const c = (ok, label, detail) => check(ok, T + label, detail);
  const fixtureFood = foodPieces(fx.text), nDays = Object.keys(fx.state.diary).length;

  const P = await makePhone(run, 'P', fx, 'v28');
  await P.open();
  await P.ev(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL, PASSWORD]);
  await settle(run);
  const days0 = JSON.stringify(cloud.snapshot(DAYS)), food0 = cloudFood(run);
  c(cloud.paths(DAYS).length === nDays, 'set-up: v2.8 uploaded ' + nDays + ' food days');

  let rest = fx.state.settings.restSec === 120 ? 135 : 120;
  const order = ['v30', 'v28', 'v30', 'v28'];
  for (let i = 0; i < order.length; i++) {
    const v = order[i], name = (v === 'v30' ? '3.0' : 'v2.8') + ' (start ' + (i + 1) + ' of ' + order.length + ')';
    let mark = cloud.mark();
    await P.restart(v);
    c(await settle(run), name + ': starts and comes to rest');
    let ws = cloud.writes({ from: mark });
    c(!ws.some((w) => FOOD_PATH.test(w.path)), name + ': no food write or delete at the start', 'writes: ' + brief(ws));
    if (trees.strict || v === 'v28' || i > 0) c(ws.length === 0, name + ': no write at all at the start', 'writes: ' + brief(ws));
    mark = cloud.mark();
    rest += 15;
    await changeRest(P, rest); await settle(run);
    ws = cloud.writes({ from: mark });
    c(ws.length === 1 && ws[0].path === META, name + ': a changed setting is the only write', 'writes: ' + brief(ws));
    c(cloudFood(run) === food0 && JSON.stringify(cloud.snapshot(DAYS)) === days0, name + ': the cloud\'s food part and all ' + nDays + ' food days byte-identical');
    c(sameFood(await storedFood(P), fixtureFood), name + ': the phone\'s food and diary are the fixture\'s, byte for byte');
    // The note's parts: 3.0 keeps them for the core the note names. v2.8 keeps the field as it is when it sends a
    // core, so it then names an older core, and 3.0 does not use it.
    const n = await noteOf(P);
    if (v === 'v30') c(!!n.parts && n.parts.core === n.core, name + ': the note\'s parts are for the core it names');
    else c(!!n.parts && n.parts.core !== n.core, name + ': v2.8 kept the note\'s parts as they were (now for an older core, so not used)', n.parts ? 'parts for ' + n.parts.core + ', core ' + n.core : 'no parts');
  }
  c(!cloud.writes().some((w) => (w.type === 'delete' && FOOD_PATH.test(w.path))) && cloud.writes({ path: FOOD_PATH }).length === nDays, 'over all the flips: the only food writes ever issued are v2.8\'s first upload of ' + nDays + ' days; no delete');

  // Signed out, the food log is removed on 3.0; then v2.8 runs again and signs in. v2.8 deletes in the cloud
  // every day its note lists and the phone no longer has, so the note must have forgotten them already.
  await P.restart('v30'); await settle(run);
  await P.ev(() => window.__overloadSync.signOut());
  await settle(run);
  c(Object.keys((await noteOf(P)).days).length === nDays, 'signed out on 3.0: the note is kept, with its ' + nDays + ' food days');
  const noteNow = await removeDiary(P);
  c(noteNow && Object.keys(noteNow.days).length === 0 && noteNow.uid === 'U1', 'the food log removed while signed out: its days are forgotten in the stored note at once');
  let mark = cloud.mark();
  await P.restart('v28');
  await P.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]);
  c(await settle(run), 'v2.8 runs again on that data and signs in; comes to rest');
  let ws = cloud.writes({ from: mark });
  c(!ws.some((w) => w.type === 'delete' && FOOD_PATH.test(w.path)), 'v2.8 deleted no food day in the cloud', 'writes: ' + brief(ws));
  c(JSON.stringify(cloud.snapshot(DAYS)) === days0 && cloudFood(run) === food0, 'the cloud\'s food days and food part are byte-identical');
  c(Object.keys((await memState(P)).diary).length === nDays, 'v2.8 downloaded the food days again instead', Object.keys((await memState(P)).diary).length + ' days');

  // The food log is removed on a start where the sync module could not load (no signal, SDK not stored), so
  // nothing forgot the days at that moment. The next start with the module forgets them in its push; and a
  // batch the cloud refuses puts the note back as it was before the push, which must not bring them back.
  await P.restart('v30'); await settle(run);
  c(Object.keys((await noteOf(P)).days).length === nDays, 'back on 3.0 the note lists the ' + nDays + ' days again (as v2.8 noted them)');
  const coreBefore = (await noteOf(P)).core;
  await P.restart('v30', true);
  c((await P.ev(() => typeof window.__overloadSync)) === 'undefined', 'a start without the Firebase SDK: the app runs, the sync module does not');
  await P.ev((v) => { const s = window.__overload.state; s.diary = {}; s.settings.restSec = v; window.__overload.save(); }, rest + 15);
  c(Object.keys((await noteOf(P)).days).length === nDays, 'the food log removed on that start: nothing could forget the days yet (the note still lists them)');
  mark = cloud.mark();
  P.device.rejectNext('permission-denied');
  await P.restart('v30');
  await settle(run);
  ws = cloud.writes({ from: mark });
  c(ws.length === 1 && ws[0].state === 'rejected' && ws[0].path === META, 'the batch with the changed setting is refused by the cloud', 'writes: ' + brief(ws));
  let note = await noteOf(P);
  c(note.core === coreBefore, 'the note is rolled back: the core counts as not sent');
  c(Object.keys(note.days).length === 0, 'the food days stay forgotten after the roll-back (an older version could not delete them)');
  await P.page.clock.runFor(62000); await settle(run);   // the retry, a minute later
  c(cloud.writes({ from: mark }).some((w) => w.path === META && w.state === 'applied') && cloudCore(run).settings.restSec === rest + 15, 'the retry a minute later sends the core');
  c(JSON.stringify(cloud.snapshot(DAYS)) === days0 && cloudFood(run) === food0, 'the cloud\'s food days and food part are byte-identical at the end');
  const by30 = cloud.writes().filter((w) => P.eras.some((e) => e.version === 'v30' && w.n >= e.from && w.n < e.to));
  c(by30.every((w) => TRAINING_PATH.test(w.path)), 'every write issued on 3.0 went to meta/state or workouts', by30.length + ' writes');
  c(foodChangedBy30(run).length === 0, 'every core written on 3.0 carried the food part the cloud held just before it, byte for byte');
  c(P.pageErrors.length === 0, 'no page error', P.pageErrors.slice(0, 3).map((t) => t.split('\n')[0]).join(' | '));
  await P.close();
}

// ---------------------------------------------------------------------------
// Phones that come back (review findings S1 and S5): what is no change of the data must not count as one
// ---------------------------------------------------------------------------
// S5: a 3.0 phone's old food copy always differs from the account's food part once a phone on v2.8 has logged food;
// that must not make its old weigh-in win over a correction made on another phone.
// S1: the app drops deletion records older than 90 days at every start. A phone opened after more than 90 days,
// with nothing changed on it, must send nothing; and a phone that did change something without signal sends its
// core only once the server's own core was taken in, so what the other phones changed meanwhile stays.
async function returnRun(browser, trees, fx) {
  const T = fx.name + ' return: ';
  const run = { browser, trees, meta: fx.meta, cloud: createCloud(), phones: [] };
  const { cloud } = run;
  const c = (ok, label, detail) => check(ok, T + label, detail);
  const DAY = 864e5;
  const core = () => cloudCore(run);
  const bwOf = (list, date) => { const x = (list || []).find((b) => b.date === date); return x ? x.weight : undefined; };
  const signIn = (phone) => phone.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]);
  const setClock = (phone, ms) => phone.context.clock.setSystemTime(new Date(ms));
  const deleteWeighIn = (phone) => phone.ev(() => { const s = window.__overload.state, b = s.bodyweight[0]; s.bodyweight = s.bodyweight.slice(1); s.deleted.bw[b.date] = Date.now(); window.__overload.save(); return b.date; });
  const restAndDay = (s) => 'restSec ' + s.settings.restSec + ', day 1 "' + s.program.days[0].name + '"';

  // ---- the account: A (the daily phone) on 3.0, B on v2.8, R and Q (phones that are put away) on 3.0 ----
  const A = await makePhone(run, 'A', fx, 'v28');
  await A.open();
  await A.ev(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL, PASSWORD]);
  await settle(run);
  await A.restart('v30');
  const B = await makePhone(run, 'B', null, 'v28'), R = await makePhone(run, 'R', null, 'v30'), Q = await makePhone(run, 'Q', null, 'v30');
  for (const p of [B, R, Q]) { await p.open(); await signIn(p); await settle(run); }
  c(await settle(run), 'set-up: A, R and Q on 3.0 and B on v2.8 share the account and come to rest');

  // ---- S5: B changes the food part while A is open, then corrects a weigh-in while A is closed ----
  await B.ev(() => { const s = window.__overload.state; s.food.targets.kcal = 2345; window.__overload.save(); });
  c(await settle(run), 'B (v2.8) changes a food target while A is open; the phones come to rest');
  await A.page.close();
  const last = fx.state.bodyweight.slice().sort((x, y) => (x.date < y.date ? -1 : 1)).pop();
  const corrected = Math.round((last.weight - 1.4) * 10) / 10;
  await B.ev(([d, w]) => { const s = window.__overload.state; s.bodyweight.find((x) => x.date === d).weight = w; window.__overload.save(); }, [last.date, corrected]);
  await settle(run);
  c(bwOf(core().bodyweight, last.date) === corrected, 'B corrects the weigh-in of ' + last.date + ' from ' + last.weight + ' to ' + corrected + ' while A is closed');
  A.device.clearCache();
  let mark = cloud.mark();
  await A.open();
  c(await settle(run), 'A opens with nothing in its offline cache (its first core comes from the server); the phones come to rest');
  const v = [bwOf(core().bodyweight, last.date), bwOf((await memState(A)).bodyweight, last.date), bwOf((await memState(B)).bodyweight, last.date)];
  c(v.every((x) => x === corrected), 'A\'s old weigh-in does not overwrite the correction (its old food copy is no change): account, A and B hold ' + corrected,
    'account ' + v[0] + ', A ' + v[1] + ', B ' + v[2] + '; writes: ' + brief(cloud.writes({ from: mark })));
  await B.page.close();   // v2.8 cannot be kept from sending its whole core after 90 days: not this test's business

  // ---- S1: R and Q delete a weigh-in each, and are put away for 91 days ----
  await deleteWeighIn(R); await settle(run);
  await deleteWeighIn(Q); await settle(run);
  c(Object.keys(core().deleted.bw).length >= 2, 'R and Q each delete a weigh-in (a deletion record each); the account has the records', JSON.stringify(core().deleted.bw));
  await R.page.close(); await Q.page.close();
  const later = run.meta.now + 91 * DAY;
  for (const p of [A, R, Q]) await setClock(p, later);
  await A.restart();
  const rest = core().settings.restSec + 30, dayName = 'Renamed on A', fixed = Math.round((corrected - 0.6) * 10) / 10;
  await A.ev(([r, n, d, w]) => { const s = window.__overload.state; s.settings.restSec = r; s.program.days[0].name = n; s.bodyweight.find((x) => x.date === d).weight = w; window.__overload.save(); }, [rest, dayName, last.date, fixed]);
  c(await settle(run), '91 days later A changes the rest time, renames a program day and corrects the weigh-in of ' + last.date + ' to ' + fixed + '; the phones come to rest');
  c(core().settings.restSec === rest && core().program.days[0].name === dayName && bwOf(core().bodyweight, last.date) === fixed, 'the account holds A\'s changes', restAndDay(core()) + ', ' + last.date + ' ' + bwOf(core().bodyweight, last.date));

  // R: opened without signal, nothing touched, then the signal comes back.
  await setClock(R, later + 3600e3);
  await R.device.setOffline(true);
  mark = cloud.mark();
  await R.open();
  await settle(run, [R]);
  let ws = cloud.writes({ who: 'R', from: mark });
  c(ws.length === 0 && R.device.queued().length === 0, 'R, opened without signal 91 days later and not touched: nothing sent or queued (a deletion record past 90 days is no change)', 'R\'s writes: ' + brief(ws) + '; queued: ' + JSON.stringify(R.device.queued()));
  await R.device.setOffline(false);
  c(await settle(run), 'the signal is back on R; the phones come to rest');
  ws = cloud.writes({ who: 'R', from: mark });
  let a = await memState(A), r = await memState(R);
  c(ws.length === 0, 'R sent nothing when it came back', 'R\'s writes: ' + brief(ws));
  c(core().settings.restSec === rest && core().program.days[0].name === dayName && a.settings.restSec === rest && a.program.days[0].name === dayName,
    'A\'s rest time and program stand in the account and on A', 'account: ' + restAndDay(core()) + ' | A: ' + restAndDay(a));
  const bw3 = () => [bwOf(core().bodyweight, last.date), bwOf(a.bodyweight, last.date), bwOf(r.bodyweight, last.date)];
  c(bw3().every((x) => x === fixed), 'A\'s corrected weigh-in stands in the account and on A (R\'s old one did not win)', 'account, A, R: ' + bw3().join(', ') + ' (A set ' + fixed + ', R had ' + corrected + ')');
  c(r.settings.restSec === rest && r.program.days[0].name === dayName, 'R took them', 'R: ' + restAndDay(r));

  // Q: the same with nothing in its offline cache (its note alone must tell it that nothing changed).
  await setClock(Q, later + 7200e3);
  Q.device.clearCache();
  await Q.device.setOffline(true);
  mark = cloud.mark();
  await Q.open();
  await settle(run, [Q]);
  await Q.device.setOffline(false);
  c(await settle(run), 'Q, the same with nothing in its offline cache: opened without signal, then the signal is back; the phones come to rest');
  ws = cloud.writes({ who: 'Q', from: mark });
  a = await memState(A);
  const q = await memState(Q);
  c(ws.length === 0 && core().settings.restSec === rest && core().program.days[0].name === dayName && a.settings.restSec === rest && q.settings.restSec === rest && q.program.days[0].name === dayName
    && [core(), a, q].every((s) => bwOf(s.bodyweight, last.date) === fixed),
    'Q sent nothing; A\'s changes (rest time, program, weigh-in) stand in the account, on A and on Q', 'Q\'s writes: ' + brief(ws) + '; account: ' + restAndDay(core()) + ' | Q: ' + restAndDay(q) + ', ' + last.date + ' ' + bwOf(q.bodyweight, last.date));

  // ---- S1 with a real change: R logs a weigh-in without signal while A changed the rest time again ----
  await R.page.close();
  const rest2 = rest + 15;
  await changeRest(A, rest2);
  c(await settle(run), 'A changes the rest time again while R is closed');
  await R.device.setOffline(true);
  mark = cloud.mark();
  await R.open(); await settle(run, [R]);
  const today = await R.ev(() => window.__overload.lib.todayKey());
  await R.ev((d) => { const s = window.__overload.state; s.bodyweight = s.bodyweight.filter((b) => b.date !== d).concat([{ date: d, weight: 175.5 }]); window.__overload.save(); }, today);
  await settle(run, [R]);
  ws = cloud.writes({ who: 'R', from: mark });
  c(!ws.some((w) => w.path === META) && !R.device.queued().some((w) => w.path === META), 'R logs a weigh-in without signal: its core is not queued, the cached core is not the server\'s', 'R\'s writes: ' + brief(ws));
  await R.device.setOffline(false);
  c(await settle(run), 'the signal is back on R; the phones come to rest');
  ws = cloud.writes({ who: 'R', from: mark }).filter((w) => w.path === META);
  const seen = cloud.reads({ who: 'R', from: mark, path: /meta\/state$/ }).filter((x) => x.type === 'get' && x.ok).map((x) => x.n);
  c(ws.length >= 1 && ws.every((w) => w.state === 'applied') && seen.length > 0 && Math.min(...seen) < ws[0].n,
    'R\'s core went once the signal was back, after R had read the account\'s core from the server', 'R\'s cores: ' + brief(ws) + '; server reads of meta/state at ' + seen.join(', '));
  a = await memState(A); r = await memState(R);
  c(core().settings.restSec === rest2 && a.settings.restSec === rest2 && r.settings.restSec === rest2, 'A\'s new rest time stands everywhere (R did not send its old one over it)',
    'account ' + core().settings.restSec + ', A ' + a.settings.restSec + ', R ' + r.settings.restSec + ' (A set ' + rest2 + ')');
  c(bwOf(core().bodyweight, today) === 175.5 && bwOf(a.bodyweight, today) === 175.5 && bwOf(r.bodyweight, today) === 175.5, 'R\'s weigh-in reached the account and A',
    'account ' + bwOf(core().bodyweight, today) + ', A ' + bwOf(a.bodyweight, today));

  // ---- the whole run ----
  const by30 = cloud.writes().filter((w) => run.phones.some((p) => p.name === w.who && p.eras.some((e) => e.version === 'v30' && w.n >= e.from && w.n < e.to)));
  c(by30.every((w) => TRAINING_PATH.test(w.path)), 'every write issued on 3.0 went to meta/state or workouts', by30.length + ' writes');
  c(foodChangedBy30(run).length === 0, 'every core written on 3.0 carried the food part the cloud held just before it, byte for byte');
  const errors = run.phones.reduce((all, p) => all.concat(p.pageErrors.map((t) => p.name + ': ' + t.split('\n')[0])), []);
  c(errors.length === 0, 'no page error on any phone', errors.slice(0, 3).join(' | '));
  for (const p of run.phones) await p.close();
}

// ---------------------------------------------------------------------------
(async () => {
  const v28 = extractV28();
  const from = args.app ? path.resolve(String(args.app)) : lib.REPO;
  const trees = { v28, v30: args.base === 'v28' ? v28WithNewSync(v28, from) : from, strict: args.base === 'v28' };
  console.log('# 3.0 side: ' + (args.base === 'v28' ? 'v2.8 app files + sync.js from ' + from + ' (a copy)' : from) + '; v2.8 side: git ' + V28_COMMIT);
  const small = lib.loadFixture('v28-state-small'), main = lib.loadFixture('v28-state');
  const browser = await lib.launch();
  const plan = [];
  if (!args.only || args.only === 'small') plan.push(['account', small, main], ['flip', small], ['return', small]);
  if (!args.only || args.only === 'main') plan.push(['account', main, small], ['flip', main], ['return', main]);
  for (const [kind, fx, other] of plan) {
    try { if (kind === 'account') await accountRun(browser, trees, fx, other); else if (kind === 'flip') await flipRun(browser, trees, fx); else await returnRun(browser, trees, fx); }
    catch (e) { check(false, fx.name + (kind === 'account' ? '' : ' ' + kind) + ': the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
  }
  await browser.close();
  console.log('# ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
