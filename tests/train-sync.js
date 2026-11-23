#!/usr/bin/env node
/* Cloud sync of the training app (Overload 3.0) against the fake Firebase in tests/fake-firebase/.
 *
 *   node tests/train-sync.js [--only=small|main] [--kind=account,flip,return,dates,expired,active,finish,relog,signin] [--base=v28] [--app=<folder>] [--port=8410]
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
 *   - Review round 3 (runs dates, expired, active):
 *     sync#3: weigh-ins and nights merge date by date against the note. A date corrected on one phone stands when
 *       the other phone changed that list (a date of its own) while it could not sync, offline or signed out. A
 *       Reset then brings back from a second phone on 3.0 only what it logged or changed since it last synced; from a
 *       phone on v2.8, everything (its own merge). v2.8 keeps the note's new part; 3.0 with a note from v2.8 loses
 *       nothing.
 *     sync#4: a weigh-in, night and workout deleted on the daily phone stay deleted when a phone is opened more than
 *       90 days later (their records gone), with or without its offline cache; that phone sends nothing. A workout
 *       whose queued write was lost with the SDK's offline store stays on its phone and is sent again (the note's
 *       `unsent`, which v2.8 keeps).
 *     code#4: a workout in progress on B (two sets ticked) stays in progress there with its sets and exercises when
 *       A imports, restores or resets (also with B closed and its cache cleared), B sends it again, and B can finish
 *       it with its sets. Finished or discarded on A, it ends on B. On a phone still on v2.8 a Reset elsewhere still
 *       erases it (v2.8's merge).
 *   - Review round 4 (runs finish, relog, signin; the last two not with --base=v28):
 *     sync#9: a workout finished on A while B's workouts answer comes 1.5 s after A's core (B sends its core, still
 *       naming the workout, in between): nothing is in progress afterwards, in the account, on B, or on A, where it
 *       showed the workout again with Finish. The run 'active' holds B's answer back the same way (it hit this
 *       order now and then by itself).
 *     sync#7: a weigh-in and a night deleted and logged again (the check-in, on A and on B; also as every version's
 *       check-in did it, without a time) stay in the account and on both phones, also when a core holding the record
 *       arrives in between; deleted again afterwards, they go everywhere; a phone still on v2.8 holding the record
 *       deletes them again (its merge).
 *     sync#10, #10b: signed out on 3.0, signed in on v2.8: a 3.0 start without the sync module counts as signed in
 *       (Reset says so, keeps the note, and stands). Signed in on 3.0, signed out on v2.8: it counts as signed in too
 *       (nothing it can read says otherwise); the Reset reaches the account at the next sign-in, as its question said.
 *   - Review round 5 (run relog): relog#1: logged again after a Reset, Import or Restore on A (B open, or B closed
 *       from before the replace until after the re-log), they stay in the account and on both phones, also logged
 *       once more and after B is opened again; and a night logged again keeps its time when the check-in is saved
 *       again with Edit while B, holding the record, is closed.
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
// Review round 3: weigh-ins and nights merged date by date (sync#3), deletions that outlive their records (sync#4),
// and a workout in progress on one phone while another resets, imports or restores (code#4)
// ---------------------------------------------------------------------------
const DAY_MS = 864e5;
const bwAt = (s, d) => { const x = (s.bodyweight || []).find((b) => b.date === d); return x ? x.weight : undefined; };
const nightAt = (s, d) => { const x = (s.sleep || []).find((n) => n.date === d); return x ? x.total : undefined; };
const signInPhone = (phone) => phone.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]);
const dayBefore = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') - n * DAY_MS).toISOString().slice(0, 10);
const listsOf = (s) => JSON.stringify([(s.bodyweight || []).map((b) => b.date + ':' + b.weight), (s.sleep || []).map((n) => n.date + ':' + n.total)]);
// A (seeded with the fixture) creates the account on v2.8 and goes on to 3.0; each other phone is new, on the
// version given, and signs in.
async function sharedAccount(run, fx, others) {
  const A = await makePhone(run, 'A', fx, 'v28');
  await A.open();
  await A.ev(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL, PASSWORD]);
  await settle(run);
  await A.restart('v30');
  await settle(run);
  const out = { A };
  for (const [name, version] of others) { const p = await makePhone(run, name, null, version); await p.open(); await signInPhone(p); await settle(run); out[name] = p; }
  return out;
}

// sync#3: a weigh-in or night corrected on one phone stands, also when the other phone changed that list (logged a
// date of its own) while it could not sync. What Reset on one phone brings back from a second one after that rule.
// And the note's new part (a hash of each date) for v2.8, which keeps it, and back on 3.0, which falls back safely.
async function datesRun(browser, trees, fx) {
  const T = fx.name + ' dates: ';
  const run = { browser, trees, meta: fx.meta, cloud: createCloud(), phones: [] };
  const { cloud } = run;
  const c = (ok, label, detail) => check(ok, T + label, detail);
  const { A, B } = await sharedAccount(run, fx, [['B', 'v30']]);
  const bwDates = fx.state.bodyweight.map((b) => b.date).sort(), nights = fx.state.sleep.map((n) => n.date).sort();
  c(listsOf(cloudCore(run)) === listsOf(await memState(B)) && bwDates.length >= 3 && nights.length >= 2, 'set-up: A (3.0) and B (3.0, a new phone) share the account', bwDates.length + ' weigh-ins, ' + nights.length + ' nights');
  const note = await noteOf(B);
  c(!!note.parts && !!note.parts.dates && Object.keys(note.parts.dates.bodyweight).length === bwDates.length && Object.keys(note.parts.dates.sleep).length === nights.length,
    'B\'s note holds a hash of each weigh-in and night of the core it names', note.parts && note.parts.dates ? Object.keys(note.parts.dates.bodyweight).length + ' and ' + Object.keys(note.parts.dates.sleep).length : 'no dates');

  const variants = ['offline', 'signed out'];
  for (let i = 0; i < variants.length; i++) {
    const how = variants[i], d = bwDates[i], n = nights[i], both = bwDates[2];
    const mineD = dayBefore(bwDates[0], 1 + i), mineN = dayBefore(nights[0], 1 + i);
    const fixedW = Math.round((bwAt(cloudCore(run), d) - 2.2) * 10) / 10, fixedT = nightAt(cloudCore(run), n) + 37;
    if (how === 'offline') { await B.page.close(); await B.device.setOffline(true); await B.open(); }
    else await B.ev(() => window.__overloadSync.signOut());
    await settle(run);
    // B logs a weigh-in and a night of dates of their own (both lists change on B); offline it also corrects a date A corrects too.
    await B.ev(([dw, dn, x]) => {
      const s = window.__overload.state;
      s.bodyweight.push({ date: dw, weight: 170.5 }); s.sleep.push({ date: dn, total: 430 });
      if (x) s.bodyweight.find((b) => b.date === x).weight = 150.1;
      window.__overload.save();
    }, [mineD, mineN, how === 'offline' ? both : null]);
    await settle(run);
    let mark = cloud.mark();
    await A.ev(([dw, w, dn, t, x]) => {
      const s = window.__overload.state;
      s.bodyweight.find((b) => b.date === dw).weight = w; s.sleep.find((y) => y.date === dn).total = t;
      if (x) s.bodyweight.find((b) => b.date === x).weight = 160.2;
      window.__overload.save();
    }, [d, fixedW, n, fixedT, how === 'offline' ? both : null]);
    await settle(run);
    c(bwAt(cloudCore(run), d) === fixedW && nightAt(cloudCore(run), n) === fixedT, how + ': A corrects the weigh-in of ' + d + ' and the night of ' + n + '; the account holds them', 'A\'s writes: ' + brief(cloud.writes({ who: 'A', from: mark })));
    mark = cloud.mark();
    if (how === 'offline') await B.device.setOffline(false); else await signInPhone(B);
    c(await settle(run), how + ': B syncs again; the phones come to rest');
    const a = await memState(A), b = await memState(B), core = cloudCore(run);
    const three = (f, date) => [f(core, date), f(a, date), f(b, date)];
    c(three(bwAt, d).every((x) => x === fixedW) && three(nightAt, n).every((x) => x === fixedT),
      how + ': A\'s corrections stand in the account, on A and on B (B changed those lists, not those dates)', 'weigh-in ' + three(bwAt, d).join(', ') + ' (A set ' + fixedW + '); night ' + three(nightAt, n).join(', ') + ' (A set ' + fixedT + '); B\'s writes: ' + brief(cloud.writes({ who: 'B', from: mark })));
    c(three(bwAt, mineD).every((x) => x === 170.5) && three(nightAt, mineN).every((x) => x === 430), how + ': B\'s own weigh-in and night reached the account and A', three(bwAt, mineD).join(', ') + '; ' + three(nightAt, mineN).join(', '));
    if (how === 'offline') c(three(bwAt, both).every((x) => x === 150.1), how + ': a date both phones corrected: B\'s change, not uploaded yet when A\'s arrived, wins everywhere (as for a setting)', three(bwAt, both).join(', '));
    c(listsOf(core) === listsOf(a) && listsOf(a) === listsOf(b), how + ': the account and both phones hold the same weigh-ins and nights, each date once');
  }

  // What Reset on A brings back from B (3.0) under that rule: only what B logged or changed since it last synced.
  let mark = cloud.mark();
  await uiReset(A);
  c(await settle(run), 'Reset on A with B (3.0) signed in; the phones come to rest');
  let ln = [cloudCore(run), await memState(A), await memState(B)].map((s) => s.bodyweight.length + '/' + s.sleep.length);
  c(ln.every((x) => x === '0/0'), 'Reset on A: no weigh-in or night comes back from B, which changed none since it last synced (weigh-ins/nights: account, A, B)', ln.join(', ') + '; writes: ' + brief(cloud.writes({ from: mark })));
  const p1 = bwDates[bwDates.length - 1], p2 = dayBefore(p1, 1), p3 = dayBefore(p1, 2);
  await A.ev(([x, y]) => { const s = window.__overload.state; s.bodyweight.push({ date: x, weight: 171 }, { date: y, weight: 172 }); window.__overload.save(); }, [p2, p3]);
  await settle(run);
  await B.ev(() => window.__overloadSync.signOut()); await settle(run);
  await B.ev((x) => { const s = window.__overload.state; s.bodyweight.push({ date: x, weight: 173 }); window.__overload.save(); }, p1);
  await uiReset(A); await settle(run);
  await signInPhone(B);
  c(await settle(run), 'A logs two weigh-ins, B (signed out) logs one more, A resets, B signs in again; the phones come to rest');
  ln = [cloudCore(run), await memState(A), await memState(B)].map((s) => s.bodyweight.map((x) => x.date).join(','));
  c(ln.every((x) => x === p1), 'only the weigh-in B logged while signed out comes back (account, A, B)', ln.join(' | ') + ' (B logged ' + p1 + ')');
  // A phone still on 2.8 merges as before: everything it holds comes back.
  const V = await makePhone(run, 'V', null, 'v28');
  await V.open(); await signInPhone(V); await settle(run);
  await A.ev(([x, y]) => { const s = window.__overload.state; s.bodyweight.push({ date: x, weight: 171 }, { date: y, weight: 172 }); window.__overload.save(); }, [p2, p3]);
  await settle(run);
  c((await memState(V)).bodyweight.length === 3, 'V (v2.8) signs in and holds the three weigh-ins');
  await uiReset(A);
  c(await settle(run), 'Reset on A with V (v2.8) and B (3.0) signed in; the phones come to rest');
  ln = [cloudCore(run), await memState(A), await memState(B), await memState(V)].map((s) => s.bodyweight.length);
  c(ln.every((x) => x === 3), 'with a phone still on 2.8 signed in, its weigh-ins come back (account, A, B, V hold 3): the question must still say so for such a phone', ln.join(', '));
  await V.page.close();

  // The note's parts on v2.8 and back: v2.8 keeps them as they are; 3.0 then merges by v2.8's rule until it has the
  // noted core again (here the first core it sees is the server's newer one: its offline cache is cleared), and
  // loses nothing.
  const before = await noteOf(B);
  await B.restart('v28'); await settle(run);
  await changeRest(B, 141); await settle(run);
  const onV28 = await noteOf(B);
  c(JSON.stringify(onV28.parts) === JSON.stringify(before.parts) && onV28.parts.core !== onV28.core, 'v2.8 on B keeps the note\'s parts, dates included, byte for byte (now for an older core, so not used)');
  await B.page.close();
  const fixD = (await memState(A)).bodyweight[0].date;
  await A.ev((x) => { const s = window.__overload.state; s.bodyweight.find((b) => b.date === x).weight = 168.8; s.sleep.push({ date: x, total: 401 }); window.__overload.save(); }, fixD);
  await settle(run);
  B.device.clearCache();
  await B.restart('v30');
  c(await settle(run), 'A corrects a weigh-in and logs a night while B is closed; B opens on 3.0 again with that note, its offline cache cleared; the phones come to rest');
  const bb = await memState(B), aa = await memState(A), cc = cloudCore(run), back = await noteOf(B);
  c(bwAt(bb, fixD) === 168.8 && nightAt(bb, fixD) === 401 && listsOf(bb) === listsOf(aa) && listsOf(aa) === listsOf(cc), 'B (3.0, note from v2.8) took A\'s correction and night; the account, A and B hold the same weigh-ins and nights', listsOf(bb) + ' | ' + listsOf(cc));
  c(!!back.parts && back.parts.core === back.core && !!back.parts.dates, 'B\'s note has parts with dates again, for the core it names');
  const errors = run.phones.reduce((all, p) => all.concat(p.pageErrors.map((t) => p.name + ': ' + t.split('\n')[0])), []);
  c(errors.length === 0, 'no page error on any phone', errors.slice(0, 3).join(' | '));
  for (const p of run.phones) await p.close();
}

// sync#4: a weigh-in, night and workout deleted on the daily phone do not come back when a phone put away for more
// than 90 days (its deletion records gone) is opened, with or without its offline cache. And the comparison that
// takes the workout away on a phone without its cache never takes one whose write from that phone may have been
// lost with the SDK's offline store: that one is sent again.
async function expiredRun(browser, trees, fx) {
  const T = fx.name + ' expired: ';
  const run = { browser, trees, meta: fx.meta, cloud: createCloud(), phones: [] };
  const { cloud } = run;
  const c = (ok, label, detail) => check(ok, T + label, detail);
  const { A, R, Q } = await sharedAccount(run, fx, [['R', 'v30'], ['Q', 'v30']]);
  await R.page.close(); await Q.page.close();
  const gone = await A.ev(() => {
    const s = window.__overload.state, now = Date.now(), b = s.bodyweight[0], n = s.sleep[0], w = s.workouts[0];
    s.bodyweight = s.bodyweight.filter((x) => x !== b); s.deleted.bw[b.date] = now;
    s.sleep = s.sleep.filter((x) => x !== n); s.deleted.sleep[n.date] = now;
    s.workouts = s.workouts.filter((x) => x !== w); s.deleted.workouts[w.id] = now;
    window.__overload.save();
    return { bw: b.date, sleep: n.date, workout: w.id };
  });
  await settle(run);
  const later = run.meta.now + 91 * DAY_MS;
  for (const p of [A, R, Q]) await p.context.clock.setSystemTime(new Date(later));
  await A.restart();
  const rest = cloudCore(run).settings.restSec + 15;
  await changeRest(A, rest);
  await settle(run);
  const c0 = cloudCore(run);
  c(!c0.deleted.bw[gone.bw] && !c0.deleted.sleep[gone.sleep] && !c0.deleted.workouts[gone.workout] && !cloud.get(WORKOUTS + '/' + gone.workout),
    'A deletes a weigh-in, a night and a workout; 91 days later it changes the rest time, and the account\'s core no longer names the deletions');
  const has = (s, ids) => ({ bw: s.bodyweight.some((x) => x.date === gone.bw), sleep: s.sleep.some((x) => x.date === gone.sleep), workout: ids ? ids.includes(gone.workout) : s.workouts.some((x) => x.id === gone.workout) });
  for (const [P, how] of [[R, 'with its offline cache'], [Q, 'with its offline cache cleared']]) {
    if (P === Q) Q.device.clearCache();
    const mark = cloud.mark();
    await P.open();
    c(await settle(run), P.name + ' (' + how + ') opens 91 days later, online, nothing touched; the phones come to rest');
    const p = await memState(P), a = await memState(A), ids = cloud.paths(WORKOUTS).map((x) => x.split('/').pop());
    const back = [has(cloudCore(run), ids), has(a), has(p)];
    c(!back.some((x) => x.bw || x.sleep), P.name + ' ' + how + ': the deleted weigh-in and night do not come back (account, A, ' + P.name + ')', JSON.stringify(back));
    c(!back.some((x) => x.workout), P.name + ' ' + how + ': the deleted workout does not come back (account, A, ' + P.name + ')', JSON.stringify(back));
    c(cloud.writes({ who: P.name, from: mark }).length === 0 && p.settings.restSec === rest && cloudCore(run).settings.restSec === rest, P.name + ' ' + how + ': it sent nothing, and took A\'s rest time', 'writes: ' + brief(cloud.writes({ who: P.name, from: mark })));
    c(listsOf(p) === listsOf(a) && p.workouts.length === a.workouts.length, P.name + ' ' + how + ': it holds what A holds');
  }

  // R logs a workout without signal and is closed; then the SDK's offline store is lost (cache and queued writes).
  await R.device.setOffline(true);
  await R.restart(); await settle(run, [R]);
  await addWorkout(R, 'testworkoutR1'); await settle(run, [R]);
  c(R.device.queued().some((w) => w.path === WORKOUTS + '/testworkoutR1') && !!((await noteOf(R)).unsent || {}).testworkoutR1, 'R logs a workout without signal: its write is queued, and the note marks it as not confirmed yet (unsent)', JSON.stringify(R.device.queued()));
  await R.page.close();
  R.device.loseOfflineStore();
  await R.device.setOffline(false);
  let mark = cloud.mark();
  await R.open();
  c(await settle(run), 'R\'s offline store is lost while it is closed (the queued write with it); R opens online; the phones come to rest');
  let r = await memState(R);
  c(r.workouts.some((w) => w.id === 'testworkoutR1'), 'R still holds the workout (the server lacks it, but its write from R was never confirmed)');
  c(!!cloud.get(WORKOUTS + '/testworkoutR1') && (await memState(A)).workouts.some((w) => w.id === 'testworkoutR1'), 'R sent it again: the account and A have it', 'R\'s writes: ' + brief(cloud.writes({ who: 'R', from: mark })));
  c(!(await noteOf(R)).unsent, 'once it was sent, the note lists nothing as unsent');

  // v2.8 keeps the new field as it is; back on 3.0 it clears itself once the server shows the write.
  await R.device.setOffline(true);
  await addWorkout(R, 'testworkoutR2'); await settle(run, [R]);
  const unsent = JSON.stringify((await noteOf(R)).unsent);
  await R.restart('v28'); await settle(run, [R]);
  await R.device.setOffline(false);
  c(await settle(run), 'R logs another workout without signal, opens on v2.8, the signal comes back; the phones come to rest');
  c(!!cloud.get(WORKOUTS + '/testworkoutR2') && JSON.stringify((await noteOf(R)).unsent) === unsent, 'v2.8 sent the queued workout and kept the note\'s unsent field as it was', unsent);
  await R.restart('v30'); await settle(run);
  await addWorkout(A, 'testworkoutA9'); await settle(run);
  r = await memState(R);
  c(!(await noteOf(R)).unsent && r.workouts.some((w) => w.id === 'testworkoutA9'), 'back on 3.0, the next snapshot from the server shows R\'s write: the note no longer lists it as unsent');
  const errors = run.phones.reduce((all, p) => all.concat(p.pageErrors.map((t) => p.name + ': ' + t.split('\n')[0])), []);
  c(errors.length === 0, 'no page error on any phone', errors.slice(0, 3).join(' | '));
  for (const p of run.phones) await p.close();
}

// code#4: a workout in progress on B, two sets ticked, while A resets, imports or restores. It stays on B with its
// sets and exercises, B sends it again, and B can finish it. Finished or discarded on A, it ends on B too.
async function activeRun(browser, trees, fx) {
  const T = fx.name + ' in progress: ';
  const run = { browser, trees, meta: fx.meta, cloud: createCloud(), phones: [] };
  const { cloud } = run;
  const c = (ok, label, detail) => check(ok, T + label, detail);
  const { A, B } = await sharedAccount(run, fx, [['B', 'v30']]);
  const fileText = JSON.stringify(fx.state, null, 2);
  const click = (phone, sel) => phone.page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error('nothing to click: ' + s); el.click(); }, sel);
  const workoutOn = (phone, id) => phone.ev((wid) => {
    const s = window.__overload.state, w = s.workouts.find((x) => x.id === wid), lib = new Set(s.exercises.map((e) => e.id));
    return { active: s.active === wid, activeId: s.active, there: !!w, finished: !!(w && w.finishedAt), ticked: w ? w.entries.reduce((n, e) => n + e.sets.filter((x) => x.done).length, 0) : 0,
      orphans: w ? w.entries.filter((e) => !lib.has(e.exId) || (e.swappedFrom && !lib.has(e.swappedFrom))).length : -1 };
  }, id);
  // Today's workout started on the phone, and two sets ticked (through the workout screen where it lets them be ticked,
  // else as the app stores a ticked set).
  async function start(phone) {
    await lib.openTab(phone.page, 'today');
    if (await phone.page.$('[data-action="start-workout"]:not([disabled])')) await click(phone, '[data-action="start-workout"]:not([disabled])');
    else {
      await phone.ev(() => {
        const s = window.__overload.state, L = window.__overload.lib, day = s.program.days.find((d) => d.exercises.length);
        const w = { id: L.uid(), date: L.todayKey(), startedAt: Date.now(), finishedAt: null, dayId: day.id, dayName: day.name, soreness: {},
          entries: day.exercises.map((exId) => ({ exId, plannedSets: 3, weightAtStart: 100, targetReps: 8, sets: [0, 1, 2].map(() => ({ weight: 100, reps: 0, done: false, rir: null })), pump: null, joint: null, workload: null, done: false, next: null, prevPresc: null, warmups: null, prs: [], swappedFrom: null, soreCut: false })) };
        s.workouts.push(w); s.active = w.id; window.__overload.save(); window.__overload.render();
      });
    }
    await phone.page.waitForFunction(() => !!window.__overload.state.active, null, { timeout: 5000 });
    await phone.page.evaluate(() => { for (let k = 0; k < 2; k++) { const b = document.querySelector('[data-action="toggle-set"]:not(.on)'); if (b) b.click(); } });
    const id = await phone.ev(() => window.__overload.state.active);
    const n = (await workoutOn(phone, id)).ticked;
    if (n < 2) {
      await phone.ev((k) => {
        const s = window.__overload.state, w = s.workouts.find((x) => x.id === s.active);
        w.entries.forEach((en) => en.sets.forEach((x) => { if (k > 0 && !x.done) { x.weight = x.weight || 100; x.reps = x.reps || en.targetReps || 8; x.done = true; k--; } }));
        window.__overload.save(); window.__overload.render();
      }, 2 - n);
    }
    await settle(run);
    return id;
  }
  async function finish(phone) { await lib.openTab(phone.page, 'today'); await click(phone, '[data-action="finish-workout"]'); }

  const rounds = [
    ['Import of a backup file on A', false, () => uiImport(A, fileText, fx.state.workouts.length)],
    ['Restore of the copy "Before import" on A', false, async () => { await settings(A); await A.page.click('#safety-copies [data-action="restore-copy"][data-id="before-import"]', { timeout: 8000 }); }],
    ['Import on A while B is closed, its offline cache cleared', true, () => uiImport(A, fileText, fx.state.workouts.length)],
    ['Reset on A', false, () => uiReset(A)]
  ];
  for (const [name, closed, act] of rounds) {
    const id = await start(B);
    const b0 = await workoutOn(B, id);
    c(b0.ticked === 2 && !!cloud.get(WORKOUTS + '/' + id) && (await workoutOn(A, id)).active, name + ': B starts a workout and ticks two sets; the account and A have it in progress', JSON.stringify(b0));
    if (closed) { await B.page.close(); B.device.clearCache(); }
    await act();
    if (closed) { await settle(run); await B.open(); }
    c(await settle(run), name + '; the phones come to rest');
    const b = await workoutOn(B, id), a = await workoutOn(A, id), core = cloudCore(run);
    c(b.active && b.there && !b.finished && b.ticked === 2, name + ': the workout is still in progress on B, with its two ticked sets', JSON.stringify(b));
    c(b.orphans === 0, name + ': every exercise it uses is in B\'s library (matched by name where the ids changed)', 'entries without their exercise: ' + b.orphans);
    c(!!cloud.get(WORKOUTS + '/' + id) && core.active === id, name + ': B sent it again: the account has its document and its core names it in progress', 'core.active ' + core.active);
    c(a.active && a.there && a.orphans === 0, name + ': it is in progress on A again too', JSON.stringify(a));
    await finish(B);
    c(await settle(run), name + ': B finishes the workout; the phones come to rest');
    const bf = await workoutOn(B, id), af = await workoutOn(A, id), doc = cloud.get(WORKOUTS + '/' + id);
    c(bf.there && bf.finished && bf.ticked >= 2 && bf.orphans === 0 && !bf.activeId, name + ': it is in B\'s history with its ticked sets, every exercise there', JSON.stringify(bf));
    c(!!doc && !!JSON.parse(doc.data).finishedAt && af.finished && !af.activeId && !cloudCore(run).active, name + ': the account and A have it finished; nothing is in progress anywhere', JSON.stringify(af));
  }

  // Finished or discarded on A, it ends on B as well (and nothing goes back and forth). The finished copy reaches B
  // more than a second after A's core (B's workouts listener is held back, review finding sync#9): B sends its core,
  // still naming the workout, in between. Without the hold this order came now and then by itself.
  let id = await start(B);
  const ws = await coreBeforeWorkouts(run, A, B, () => finish(A));
  c(await settle(run), 'B starts a workout, A finishes it, B gets A\'s core 1.5 s before the finished workout; the phones come to rest (no write loop)', 'writes in the gap: ' + ws);
  let b = await workoutOn(B, id);
  const af = await workoutOn(A, id);
  c(b.there && b.finished && !b.activeId && !cloudCore(run).active && af.finished && !af.activeId, 'finished on A: finished on B too, and nothing in progress anywhere (account, A, B)', 'B ' + JSON.stringify(b) + '; account core.active ' + cloudCore(run).active + '; A ' + JSON.stringify(af));
  id = await start(B);
  await lib.openTab(A.page, 'today'); await click(A, '[data-action="discard-workout"]');
  c(await settle(run), 'B starts a workout, A discards it; the phones come to rest (no write loop)');
  b = await workoutOn(B, id);
  c(!b.there && !b.activeId && !cloud.get(WORKOUTS + '/' + id) && !(await workoutOn(A, id)).there, 'discarded on A: gone from B and from the account', JSON.stringify(b));

  // A phone still on 2.8 has v2.8's merge: there the workout in progress is lost (the question must say so).
  await B.page.close();
  const V = await makePhone(run, 'V', null, 'v28');
  await V.open(); await signInPhone(V); await settle(run);
  id = await start(V);
  await uiReset(A);
  c(await settle(run), 'V (v2.8) has a workout in progress, A resets; the phones come to rest');
  const v = await workoutOn(V, id);
  c(!v.there && !v.activeId, 'on a phone still on 2.8 the workout in progress is erased by the Reset on A (v2.8\'s merge; the question must say so)', JSON.stringify(v));
  const errors = run.phones.reduce((all, p) => all.concat(p.pageErrors.map((t) => p.name + ': ' + t.split('\n')[0])), []);
  c(errors.length === 0, 'no page error on any phone', errors.slice(0, 3).join(' | '));
  for (const p of run.phones) await p.close();
}

// ---------------------------------------------------------------------------
// Review round 4: a workout finished on one phone (sync#9), a weigh-in or night logged again after it was deleted
// (sync#7), and what a start without the sync module believes after a sign-in or sign-out on v2.8 (sync#10, #10b)
// ---------------------------------------------------------------------------
// The phone's listener reads of its workouts wait until released: the order of review finding sync#9 (the core
// arrives more than a second before the workout it ends), as the verifier's a6-finished-comes-back.js holds it.
const holdWorkouts = (phone) => phone.ev(() => {
  if (!window.__heldBridge) {
    const orig = window.__heldBridge = window.__fakeFirebase; window.__held = [];
    window.__fakeFirebase = (op, p) => (window.__hold && op === 'fs.server' && p && p.via === 'listen' && /\/workouts$/.test(p.path)
      ? new Promise((r) => window.__held.push(() => r(orig(op, p)))) : orig(op, p));
  }
  window.__hold = true;
});
const releaseWorkouts = (phone) => phone.ev(() => { window.__hold = false; (window.__held || []).splice(0).forEach((f) => f()); });
const until = async (fn, what) => { for (let i = 0; i < 200; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('waited in vain: ' + what); };
// `act` on A ends B's workout in progress (Finish). B takes A's core while its workouts answer is held, B's own push
// goes in that gap, then the answer is let through. Returns the writes made meanwhile, for the detail of a check.
async function coreBeforeWorkouts(run, A, B, act) {
  await holdWorkouts(B);
  const mark = run.cloud.mark(), noteCore = async () => ((await noteOf(B)) || {}).core;
  const before = await noteCore();
  await act();
  await A.page.waitForFunction(() => !window.__overload.state.active, null, { timeout: 5000 });
  await A.page.clock.runFor(1100);
  await until(() => run.cloud.writes({ from: mark, who: 'A' }).some((w) => w.path === META && w.state === 'applied'), 'A\'s upload of its core');
  await until(async () => (await noteCore()) !== before, 'B taking A\'s core');
  await B.page.clock.runFor(1500);
  await new Promise((r) => setTimeout(r, 300));
  await releaseWorkouts(B);
  return brief(run.cloud.writes({ from: mark }));
}

// sync#9, the verifier's sequence (a6): B starts today's workout through the app and ticks two sets; A finishes it
// through the app; B's workouts answer comes 1.5 s after A's core. Nothing may be in progress afterwards: not in the
// account, not on B, and not on A, where he finished it (it showed the workout again, with Finish). Also after both
// are opened again.
async function finishRun(browser, trees, fx) {
  const T = fx.name + ' finished elsewhere: ';
  const run = { browser, trees, meta: fx.meta, cloud: createCloud(), phones: [] };
  const { cloud } = run;
  const c = (ok, label, detail) => check(ok, T + label, detail);
  const { A, B } = await sharedAccount(run, fx, [['B', 'v30']]);
  const click = (phone, sel) => phone.page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error('nothing to click: ' + s); el.click(); }, sel);
  await lib.openTab(B.page, 'today');
  await B.page.evaluate(() => {
    if (!document.querySelector('[data-action="start-workout"]:not([disabled])')) { const o = document.querySelector('[data-action="toggle-others"]'); if (o) o.click(); }
    document.querySelector('[data-action="start-workout"]:not([disabled])').click();
  });
  await B.page.waitForFunction(() => !!window.__overload.state.active, null, { timeout: 5000 });
  await B.page.evaluate(() => { for (let k = 0; k < 2; k++) { const b = document.querySelector('[data-action="toggle-set"]:not(.on)'); if (b) b.click(); } });
  await settle(run);
  const id = await B.ev(() => window.__overload.state.active);
  c(!!id && cloudCore(run).active === id && (await A.ev((w) => window.__overload.state.active === w, id)), 'B starts a workout and ticks two sets; the account and A have it in progress');
  await lib.openTab(A.page, 'today');
  const ws = await coreBeforeWorkouts(run, A, B, () => click(A, '[data-action="finish-workout"]'));
  c(await settle(run), 'A finishes it; B gets A\'s core 1.5 s before the finished workout; the phones come to rest (no write loop)', 'writes in the gap: ' + ws);
  const look = (P) => P.ev((w) => { const s = window.__overload.state, x = s.workouts.find((y) => y.id === w); return { active: s.active, finished: !!(x && x.finishedAt), finishButton: !!document.querySelector('[data-action="finish-workout"]') }; }, id);
  await lib.openTab(A.page, 'history'); await lib.openTab(A.page, 'today'); await lib.openTab(B.page, 'history'); await lib.openTab(B.page, 'today');
  let a = await look(A), b = await look(B);
  c(!cloudCore(run).active, 'nothing is in progress in the account', 'core.active ' + cloudCore(run).active + (cloudCore(run).active === id ? ' (the workout he finished)' : ''));
  c(!a.active && a.finished && !a.finishButton, 'A, where he finished it, does not show it in progress again (no Finish button)', JSON.stringify(a));
  c(!b.active && b.finished && !b.finishButton, 'B has it finished, nothing in progress', JSON.stringify(b));
  await A.restart(); await B.restart();
  c(await settle(run), 'both opened again; the phones come to rest');
  await lib.openTab(A.page, 'today');
  a = await look(A);
  c(!cloudCore(run).active && !a.active && !a.finishButton, 'after both were opened again: nothing in progress, in the account or on A', 'core.active ' + cloudCore(run).active + '; A ' + JSON.stringify(a));
  const errors = run.phones.reduce((all, p) => all.concat(p.pageErrors.map((t) => p.name + ': ' + t.split('\n')[0])), []);
  c(errors.length === 0, 'no page error on any phone', errors.slice(0, 3).join(' | '));
  for (const p of run.phones) await p.close();
}

// The app's own buttons: today's weigh-in and night deleted in Edit weigh-ins and Edit nights (History), and logged
// in the morning check-in (Today).
async function uiDeleteToday(phone, today) {
  const pg = phone.page;
  await lib.openTab(pg, 'today'); await lib.openTab(pg, 'history');
  await pg.click('[data-action="bw-list"]', { timeout: 5000 });
  await pg.click('#sheet [data-action="bw-delete"][data-date="' + today + '"]', { timeout: 5000 });
  await pg.click('#sheet .sheet-title [data-action="sheet-close"]');
  await pg.click('[data-action="sleep-list"]', { timeout: 5000 });
  await pg.click('#sheet [data-action="sleep-delete"][data-date="' + today + '"]', { timeout: 5000 });
  await pg.click('#sheet .sheet-title [data-action="sheet-close"]');
  await pg.waitForFunction((d) => { const s = window.__overload.state; return !s.bodyweight.some((x) => x.date === d) && !s.sleep.some((x) => x.date === d) && s.deleted.bw[d] && s.deleted.sleep[d]; }, today, { timeout: 5000 });
}
async function uiCheckin(phone, today, weight, minutes) {
  const pg = phone.page;
  await lib.openTab(pg, 'history'); await lib.openTab(pg, 'today');
  if (await pg.$('[data-action="checkin-edit"]')) await pg.click('[data-action="checkin-edit"]');
  await pg.fill('#bw-form input[name="weight"]', String(weight));
  await pg.fill('#bw-form input[name="totalH"]', String(Math.floor(minutes / 60)));
  await pg.fill('#bw-form input[name="totalM"]', String(minutes % 60));
  for (const k of ['remH', 'remM', 'deepH', 'deepM']) if (await pg.$('#bw-form input[name="' + k + '"]')) await pg.fill('#bw-form input[name="' + k + '"]', '');
  await pg.click('#bw-form button[type="submit"]');
  await pg.waitForFunction(([d, w, t]) => { const s = window.__overload.state; return s.bodyweight.some((x) => x.date === d && x.weight === w) && s.sleep.some((x) => x.date === d && x.total === t); }, [today, weight, minutes], { timeout: 5000 });
}

// sync#7: a weigh-in and a night deleted and then logged again stay, in the account and on every phone on 3.0. The
// app takes the deletion record away when it is logged again; the other phones still hold it, and their merges
// brought it back (and the entry went). Run through the app's buttons on A and on B, against a core that still holds
// the record arriving at A after it logged again, and as the check-in of every version did it (the record taken
// away, no time: the verifier's a4-relog-weighin.js). A deletion made after that still deletes it everywhere. A
// phone still on 2.8 that holds the record puts it back (dev/notes/sync.md says so).
async function relogRun(browser, trees, fx) {
  const T = fx.name + ' log again: ';
  const run = { browser, trees, meta: fx.meta, cloud: createCloud(), phones: [] };
  const { cloud } = run;
  const c = (ok, label, detail) => check(ok, T + label, detail);
  const { A, B } = await sharedAccount(run, fx, [['B', 'v30']]);
  const today = await A.ev(() => window.__overload.lib.todayKey());
  const units = (await memState(A)).settings.units;
  const three = async () => { const s = [cloudCore(run), await memState(A), await memState(B)]; return { bw: s.map((x) => bwAt(x, today)), night: s.map((x) => nightAt(x, today)), rec: s.map((x) => !!(x.deleted.bw[today] || x.deleted.sleep[today])), s }; };
  const show = (t) => 'weigh-in (account, A, B) ' + t.bw.join(', ') + '; night ' + t.night.join(', ') + '; a record of the date ' + t.rec.join(', ');
  const all = (t, w, n) => t.bw.every((x) => x === w) && t.night.every((x) => x === n) && !t.rec.some(Boolean);
  c(units === 'lb' || units === 'kg', 'set-up: A (3.0) and B (3.0, a new phone) share the account; today is ' + today);

  // 1. On A: deleted in Edit weigh-ins and Edit nights, then logged again in the check-in.
  await uiDeleteToday(A, today); await settle(run);
  let t = await three();
  c(t.bw.every((x) => x === undefined) && t.night.every((x) => x === undefined) && t.rec.every(Boolean), 'A deletes today\'s weigh-in and night: gone from the account and B, which hold the deletion records', show(t));
  let mark = cloud.mark();
  await uiCheckin(A, today, 181.2, 431); await settle(run);
  t = await three();
  c(all(t, 181.2, 431), 'A logs them again in the check-in: they stay, in the account, on A and on B, and no record of that date is left', show(t) + '; writes ' + brief(cloud.writes({ from: mark })));
  const aa = t.s[1];
  c(bwAt(aa, today) === 181.2 && typeof aa.bodyweight.find((x) => x.date === today).at === 'number' && typeof aa.sleep.find((x) => x.date === today).at === 'number', 'the two entries logged again carry the time they were logged again (at)');

  // 2. On B, which took A's deletion: A deletes, B logs them again.
  await uiDeleteToday(A, today); await settle(run);
  mark = cloud.mark();
  await uiCheckin(B, today, 179.9, 402); await settle(run);
  t = await three();
  c(all(t, 179.9, 402), 'A deletes them again, B logs them again: they stay everywhere', show(t) + '; writes ' + brief(cloud.writes({ from: mark })));

  // 3. A core that still holds the record reaches A after A logged them again, before A's own upload: B changes the
  // rest time and its core goes up in that second.
  await uiDeleteToday(A, today); await settle(run);
  const rest = (await memState(B)).settings.restSec + 11;
  await uiCheckin(A, today, 180.6, 415);
  await changeRest(B, rest);
  await B.page.clock.runFor(1100); await cloud.idle();
  await A.ev(() => 0); await cloud.idle();
  const bRecord = !!JSON.parse(cloud.get(META).core).deleted.bw[today];
  c(await settle(run), 'A deletes them, logs them again, and B\'s core with the record arrives before A\'s upload; the phones come to rest');
  t = await three();
  c(all(t, 180.6, 415) && t.s.every((x) => x.settings.restSec === rest), 'they stay everywhere, and B\'s rest time too', show(t) + '; B\'s core held the record when A took it: ' + bRecord);

  // 4. As the check-in of every version does it: the record taken away and the entry put in, no time (the
  // verifier's a4-relog-weighin.js). Cloud sync gives it the time at the save.
  await uiDeleteToday(A, today); await settle(run);
  mark = cloud.mark();
  await A.ev(([d, w, n]) => {
    const s = window.__overload.state;
    delete s.deleted.bw[d]; delete s.deleted.sleep[d];
    s.bodyweight.push({ date: d, weight: w }); s.sleep.push({ date: d, total: n, rem: null, deep: null });
    window.__overload.save();
  }, [today, 182.4, 444]);
  await settle(run);
  t = await three();
  c(all(t, 182.4, 444), 'logged again without a time (the record taken away, as the check-in does): they stay everywhere', show(t) + '; writes ' + brief(cloud.writes({ from: mark })));

  // 4b. Review finding relog#1, the Edit case: B takes A's deletion and is then closed; A logs them again, then saves
  // the check-in again with Edit (another weight, the night as it is filled in); B is opened. The night was written
  // anew without its time, so B's merge put the record back and deleted it everywhere.
  await uiDeleteToday(A, today); await settle(run);
  const bHeld = !!(await memState(B)).deleted.sleep[today];
  await B.page.close();
  await uiCheckin(A, today, 181.0, 433); await settle(run);
  await uiCheckin(A, today, 180.8, 433); await settle(run);
  const edited = (await memState(A)).sleep.find((x) => x.date === today) || null;
  await B.open(); await settle(run);
  t = await three();
  c(bHeld && all(t, 180.8, 433), 'B takes the deletion and is closed; A logs them again, then saves the check-in again with Edit (another weight, the night as filled in); B is opened: they stay everywhere', show(t) + '; B held the record: ' + bHeld + '; A\'s night after the Edit ' + JSON.stringify(edited));

  // 5. Deleted after that, on B: gone everywhere (the new record is later than the time it was logged again).
  await uiDeleteToday(B, today); await settle(run);
  t = await three();
  c(t.bw.every((x) => x === undefined) && t.night.every((x) => x === undefined) && t.rec.every(Boolean), 'B deletes them after that: gone from the account, A and B (a merge never brings back something deleted)', show(t));

  // 6. Not for a Reset, Import or Restore here: the questions say another phone deletes again what was deleted in
  // the last 90 days (tests/train-cloud.js 'Restore with two phones' runs it). And a phone still on 2.8 that holds
  // the record merges it back, so the entry goes everywhere.
  const V = await makePhone(run, 'V', null, 'v28');
  await V.open(); await signInPhone(V); await settle(run);
  c(!!(await memState(V)).deleted.bw[today], 'V (v2.8) signs in and holds the deletion record');
  await uiCheckin(A, today, 183.3, 420);
  c(await settle(run), 'A logs them again with V (v2.8) signed in; the phones come to rest (no write loop)');
  const v = await memState(V);
  t = await three();
  c(t.bw.every((x) => x === undefined) && bwAt(v, today) === undefined, 'with a phone still on 2.8 holding the record, the weigh-in logged again goes again (v2.8\'s merge; dev/notes/sync.md says so)', show(t) + '; V ' + bwAt(v, today));
  await V.page.close();

  // 7. Review finding relog#1: deleted, then a Reset, Import or Restore on A, then logged again in the check-in. The
  // replace took A's deletion records with it while B still holds them: B sends them back, or holds them until it is
  // opened. sync.js gives no time after a replace (it cannot tell an entry logged by hand from one the file or copy
  // brought back), so the check-in gives it where he logs it. With B open: logged again, logged once more, B closed
  // and opened again. With B closed before the replace: logged again, then B opened.
  let rest2 = 300;
  const withRest = () => { const f = JSON.parse(fx.text); f.settings.restSec = ++rest2; return f; };
  const restIs = (v) => A.page.waitForFunction((x) => window.__overload.state.settings.restSec === x, v, { timeout: 8000 });
  const replaceOn = {
    reset: () => uiReset(A),
    import: async () => {
      const f = withRest();
      await settings(A);
      await A.page.setInputFiles('#import-file', { name: 'overload-backup-2026-11-21.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(f)) }, { timeout: 5000 });
      await restIs(f.settings.restSec);
    },
    restore: async () => {
      const f = withRest();
      await A.ev((x) => window.__overloadBackup.take('import', x), JSON.stringify(f));   // the copy, in A's Automatic copies
      await lib.openTab(A.page, 'today'); await settings(A);
      await A.page.click('#safety-copies [data-action="restore-copy"][data-id="before-import"]', { timeout: 8000 });
      await restIs(f.settings.restSec);
    }
  };
  for (const closed of [false, true]) {
    for (const how of ['reset', 'import', 'restore']) {
      const L = how + (closed ? ' with B closed' : '') + ': ';
      const a0 = await memState(A);
      if (bwAt(a0, today) === undefined || nightAt(a0, today) === undefined) { await uiCheckin(A, today, 185.5, 425); await settle(run); }
      await uiDeleteToday(A, today); await settle(run);
      if (closed) await B.page.close();
      await replaceOn[how](); await settle(run);
      await uiCheckin(A, today, 186.1, 426); await settle(run);
      const a1 = await memState(A), entry = JSON.stringify([a1.bodyweight.find((x) => x.date === today) || null, a1.sleep.find((x) => x.date === today) || null]);
      if (!closed) {
        t = await three();
        c(all(t, 186.1, 426), L + 'A deletes today\'s weigh-in and night, then ' + (how === 'import' ? 'an ' : 'a ') + how + ' on A, then A logs them again in the check-in: they stay, in the account, on A and on B', show(t) + '; A\'s entries ' + entry);
        await uiCheckin(A, today, 186.4, 426); await settle(run);
        t = await three();
        c(all(t, 186.4, 426), L + 'A logs the weigh-in once more: it stays everywhere', show(t));
        await B.page.close();
      }
      await B.open(); await settle(run);
      t = await three();
      c(all(t, closed ? 186.1 : 186.4, 426), L + (closed ? 'A deletes them, B (holding the records) is closed, ' + (how === 'import' ? 'an ' : 'a ') + how + ' on A, A logs them again in the check-in, B is opened: they stay everywhere' : 'B closed and opened again: they stay everywhere'), show(t) + '; A\'s entries ' + entry);
    }
  }
  const errors = run.phones.reduce((all2, p) => all2.concat(p.pageErrors.map((x) => p.name + ': ' + x.split('\n')[0])), []);
  c(errors.length === 0, 'no page error on any phone', errors.slice(0, 3).join(' | '));
  for (const p of run.phones) await p.close();
}

// sync#10, sync#10b: what a start of 3.0 without the sync module takes the phone to be, after a sign-in or a sign-out
// made on v2.8 (a roll-back). Signed out, 3.0 keeps the note in a form of its own (its text ends with a line break);
// any save of it by a signed-in sync module ends that form, v2.8's included, which saves it after every sign-in. A
// sign-out on v2.8 writes nothing the app can read: the phone then counts as signed in (the questions say the
// account changes too, the note stays), and the next sign-in sends the Reset, as the question said.
async function signinRun(browser, trees, fx) {
  const T = fx.name + ' signed in on v2.8: ';
  const run = { browser, trees, meta: fx.meta, cloud: createCloud(), phones: [] };
  const { cloud } = run;
  const c = (ok, label, detail) => check(ok, T + label, detail);
  const { A } = await sharedAccount(run, fx, []);
  const raw = () => lib.readStorageText(A.page, NOTE);
  const WARN = 'You are signed in to cloud sync, so the training data in your account is erased too.';
  const counts = async () => { const a = await memState(A), core = cloudCore(run); return { a: a.workouts.length + '/' + a.bodyweight.length, acct: cloud.paths(WORKOUTS).length + '/' + core.bodyweight.length }; };
  // 3.0 alone: signed out the note takes that form, signed in again it loses it at once.
  await A.ev(() => window.__overloadSync.signOut()); await settle(run);
  let text = await raw();
  c(/\n$/.test(text) && JSON.parse(text).uid === 'U1', 'signed out on 3.0: the note stays, in its signed-out form (its text ends with a line break)', JSON.stringify(text.slice(-12)));
  await signInPhone(A);
  c(!/\n$/.test(await raw()), 'signed in again on 3.0: the note loses that form at once (before any upload)');
  await settle(run);

  // sync#10: signed out on 3.0, signed in on v2.8 (which changes nothing in the account), then 3.0 without the module.
  await A.ev(() => window.__overloadSync.signOut()); await settle(run);
  const content = JSON.stringify(JSON.parse(await raw()));
  await A.restart('v28'); await settle(run);
  let mark = cloud.mark();
  await signInPhone(A); await settle(run);
  text = await raw();
  c(!/\n$/.test(text), 'A runs v2.8 again and signs in there: v2.8 saved the note, without that form', 'its content ' + (JSON.stringify(JSON.parse(text)) === content ? 'unchanged' : 'changed') + '; v2.8\'s writes: ' + brief(cloud.writes({ who: 'A', from: mark })));
  await A.restart('v30', true);
  c(!(await A.ev(() => !!window.__overloadSync)), 'A starts 3.0 without the sync module');
  A.page.dialogs.length = 0;
  await uiReset(A);
  let q = A.page.dialogs.slice();
  c(q.length === 2 && q[0].includes(WARN) && !!JSON.parse(await raw()), 'Reset: the question says the account is erased too, and the note stays', q.join(' / ').replace(/\n/g, ' | ').slice(0, 300));
  await A.restart('v30'); await settle(run);
  let n = await counts();
  c(n.a === '0/0' && n.acct === '0/0' && (await A.ev(() => !!window.__overloadSync.user)), 'the next start with the module (signed in, from v2.8): the Reset stands on A and reached the account', 'workouts/weigh-ins: A ' + n.a + ', account ' + n.acct);

  // sync#10b: signed in on 3.0, signed out on v2.8, then 3.0 without the module.
  await addWorkout(A, 'testworkoutS1'); await settle(run);
  await A.restart('v28'); await settle(run);
  const before = await raw();
  await A.ev(() => window.__overloadSync.signOut()); await settle(run);
  c((await raw()) === before && !/\n$/.test(before), 'A runs v2.8 and signs out there: v2.8 leaves the note as it was');
  await A.restart('v30', true);
  A.page.dialogs.length = 0;
  await uiReset(A);
  q = A.page.dialogs.slice();
  c(q.length === 2 && q[0].includes(WARN) && !!JSON.parse(await raw()), 'Reset on 3.0 without the module: the phone counts as signed in (nothing tells it otherwise): the question says the account is erased too, and the note stays', q.join(' / ').replace(/\n/g, ' | ').slice(0, 300));
  await A.restart('v30'); await settle(run);
  n = await counts();
  c(n.a === '0/0' && n.acct === '1/0' && /\n$/.test(await raw()) && !(await A.ev(() => !!window.__overloadSync.user)), 'the next start with the module, signed out: nothing comes back to A, the account is not changed yet, and the note takes its signed-out form', 'A ' + n.a + ', account ' + n.acct);
  mark = cloud.mark();
  await signInPhone(A); await settle(run);
  n = await counts();
  c(n.a === '0/0' && n.acct === '0/0', 'signed in again: the Reset reaches the account, as its question said, and nothing comes back', 'A ' + n.a + ', account ' + n.acct + '; writes ' + brief(cloud.writes({ from: mark })));
  const errors = run.phones.reduce((all, p) => all.concat(p.pageErrors.map((x) => p.name + ': ' + x.split('\n')[0])), []);
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
  const runs = { account: accountRun, flip: flipRun, return: returnRun, dates: datesRun, expired: expiredRun, active: activeRun, finish: finishRun, relog: relogRun, signin: signinRun };
  // These check what 3.0's overload.js does beside sync.js (the check-in's time, the note's signed-out form): with
  // --base=v28 the 3.0 side has v2.8's app.js, so they do not apply there.
  const appOnly = ['relog', 'signin'];
  let kinds = args.kind ? String(args.kind).split(',') : Object.keys(runs);
  if (kinds.some((k) => !runs[k])) throw new Error('--kind= takes ' + Object.keys(runs).join(', '));
  if (trees.strict && kinds.some((k) => appOnly.includes(k))) { console.log('# not run with --base=v28 (they need 3.0\'s overload.js): ' + kinds.filter((k) => appOnly.includes(k)).join(', ')); kinds = kinds.filter((k) => !appOnly.includes(k)); }
  if (!args.only || args.only === 'small') kinds.forEach((k) => plan.push([k, small, main]));
  if (!args.only || args.only === 'main') kinds.forEach((k) => plan.push([k, main, small]));
  for (const [kind, fx, other] of plan) {
    try { await runs[kind](browser, trees, fx, other); }
    catch (e) { check(false, fx.name + (kind === 'account' ? '' : ' ' + kind) + ': the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
  }
  await browser.close();
  console.log('# ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
