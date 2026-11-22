#!/usr/bin/env node
/* Overload 3.0 and cloud sync, three cases at the edge of the app (tests/fake-firebase; no outside host).
 *
 *   node tests/train-cloud.js [--app=<folder>] [--port=8418]
 *
 *   - A note of what the cloud holds (overload.sync.v1) left in storage next to missing saved data
 *     (overload.state.v1 gone, the sign-in remembered): the start removes the note, so the sign-in that follows is
 *     a first link. Nothing is deleted in the account or on the second phone, and the account's workouts come
 *     down to this phone. (Before 3.0's fix the start kept the note and the push deleted every workout it listed.)
 *   - Reset while signed in, with a second phone signed in. The question says what happens: the training data in
 *     the account is erased, but weigh-ins and nights on another signed-in phone come back from it; to erase those
 *     as well, sign that phone out first and reset it before it signs in again. Each part is checked: both signed
 *     in (they come back), the other phone signed out and then in again without a reset (they come back), and
 *     signed out, reset, signed in (nothing comes back). No deletion records are written by Reset.
 *   - Restore while signed in, with a second phone signed in. The copy is older: it lacks the latest weigh-in,
 *     night and workout, has another weight for a date both hold, and holds a workout, a weigh-in and a night that
 *     the second phone deleted since. The question says what happens, in Reset's words where they apply: the
 *     training data in the account is replaced, but weigh-ins and nights on the other phone come back for dates
 *     the copy does not have, and that phone deletes again what was deleted in the last 90 days; to keep only
 *     what is in the copy, sign that phone out first and reset it before it signs in again. Each part is checked
 *     on the account and both phones: both signed in (the copy's program, workouts and weights; the other
 *     phone's weigh-in and night back; the three deletions done again), signed out and in again without a reset
 *     (the same), and signed out, reset, signed in (exactly the copy's).
 * The app's files are answered from a folder by a Playwright route (nothing listens on the port).
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const T = require('./train-common');
const { createCloud } = require('./fake-firebase/route');

const args = T.args();
const PORT = Number(args.port) || 8418;
const ORIGIN = lib.LOCAL + ':' + PORT;
const TREE = path.resolve(args.app || lib.REPO);
const EMAIL = 'owner@example.com', PASSWORD = 'correct horse';
const META = 'users/U1/meta/state', WORKOUTS = 'users/U1/workouts', NOTE = 'overload.sync.v1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const run = T.runner('train-cloud');
const { need } = run;
const fx = lib.loadFixture('v28-state-small');

async function makePhone(world, name, seed) {
  const phone = await lib.newPhone(world.browser, { now: fx.meta.now, timezoneId: fx.meta.tz });
  phone.name = name;
  await phone.context.route(ORIGIN + '/**', (route) => {
    let p = decodeURIComponent(new URL(route.request().url()).pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(TREE, p);
    let ok = file.startsWith(TREE + path.sep);
    try { ok = ok && fs.statSync(file).isFile(); } catch (e) { ok = false; }
    if (!ok) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', headers: { 'cache-control': 'no-store' }, body: fs.readFileSync(file) });
  });
  phone.device = await world.cloud.attach(phone.context, name);
  if (seed) await lib.seedV28(phone.context, fx);
  phone.open = async () => {
    if (phone.page && !phone.page.isClosed()) await phone.page.close();
    phone.page = await lib.openApp(phone.context, ORIGIN + '/index.html');
    await phone.page.waitForFunction(() => !!window.__overloadSync, null, { timeout: 15000 });
    return phone.page;
  };
  phone.ev = (fn, arg) => phone.page.evaluate(fn, arg);
  phone.live = () => phone.ev(() => JSON.parse(JSON.stringify(window.__overload.state)));
  world.phones.push(phone);
  return phone;
}
// The phones and the cloud come to rest: push timers (one second after a save) fire, writes arrive, listeners run.
async function settle(world) {
  const pages = () => world.phones.map((p) => p.page).filter((pg) => pg && !pg.isClosed());
  let last = -1, quiet = 0;
  for (let i = 0; i < 40; i++) {
    for (const pg of pages()) await pg.clock.runFor(1100).catch(() => {});
    await world.cloud.idle();
    for (const pg of pages()) await pg.evaluate(() => 0).catch(() => {});
    await world.cloud.idle();
    const n = world.cloud.log.length;
    if (n === last) { if (++quiet >= 2) return; } else { quiet = 0; last = n; }
  }
}
const brief = (ws) => ws.length ? ws.length + ': ' + ws.slice(0, 5).map((w) => w.who + ' ' + w.type + ' ' + w.path.replace(/^users\/U\d+\//, '')).join(', ') + (ws.length > 5 ? ', ...' : '') : 'none';
const core = (cloud) => JSON.parse(cloud.get(META).core);
async function reset(phone) {
  phone.page.dialogs.length = 0;
  await lib.openTab(phone.page, 'settings');
  await phone.page.click('[data-action="reset"]');
  await phone.page.waitForFunction(() => window.__overload.state.workouts.length === 0 && window.__overload.state.bodyweight.length === 0, null, { timeout: 5000 });
  return phone.page.dialogs.slice();
}
const counts = async (cloud, A, B) => {
  const c = core(cloud), a = await A.live(), b = await B.live();
  return { account: [cloud.paths(WORKOUTS).length, c.bodyweight.length, c.sleep.length], A: [a.workouts.length, a.bodyweight.length, a.sleep.length], B: [b.workouts.length, b.bodyweight.length, b.sleep.length] };
};
const show = (n) => 'workouts, weigh-ins, nights: account ' + n.account.join('/') + ', A ' + n.A.join('/') + ', B ' + n.B.join('/');

async function noteWithoutData(browser) {
  const name = 'note without data', step = (title, fn) => run.step(name, title, fn);
  const world = { browser, cloud: createCloud(), phones: [] }, cloud = world.cloud;
  const A = await makePhone(world, 'A', true), B = await makePhone(world, 'B', false);
  await A.open(); await A.ev(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL, PASSWORD]); await settle(world);
  await B.open(); await B.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]); await settle(world);
  const nW = cloud.paths(WORKOUTS).length, core0 = cloud.text(META);
  await step('two phones signed in, the account holds the workouts', async () => {
    need(nW === fx.state.workouts.length && (await B.live()).workouts.length === nW, 'account ' + nW + ' workouts, B ' + (await B.live()).workouts.length);
    need(!!JSON.parse(await lib.readStorageText(A.page, NOTE)), 'A has no note');
    return nW + ' workouts';
  });
  await step('A\'s saved data goes missing (the note and the sign-in stay): its start removes the note, and deletes nothing', async () => {
    const note = await lib.readStorageText(A.page, NOTE);
    await A.ev((k) => localStorage.removeItem(k), lib.STATE_KEY);
    A.device.blockSdk(true);   // first only the app, without the sync module: what does the start do with the note?
    await A.page.close();
    A.page = await lib.openApp(A.context, ORIGIN + '/index.html');
    need(note && (await lib.readStorageText(A.page, NOTE)) === null, 'the note is still there after the start: ' + String(await lib.readStorageText(A.page, NOTE)).slice(0, 80));
    A.device.blockSdk(false);
    const mark = cloud.mark();
    await A.open();
    await settle(world);
    const ws = cloud.writes({ from: mark }), dels = ws.filter((w) => w.type === 'delete');
    need(!dels.length, 'writes after A opened: ' + brief(ws));
    need(cloud.paths(WORKOUTS).length === nW && (await B.live()).workouts.length === nW, 'the account holds ' + cloud.paths(WORKOUTS).length + ', B ' + (await B.live()).workouts.length + ' of ' + nW + ' workouts');
    need((await A.live()).workouts.length === nW, 'A holds ' + (await A.live()).workouts.length + ' of the account\'s ' + nW + ' workouts');
    const was = JSON.parse(JSON.parse(core0).core), c = core(cloud);
    need(JSON.stringify(c.program) === JSON.stringify(was.program) && JSON.stringify(c.settings) === JSON.stringify(was.settings), 'the account\'s program or settings changed');
    return 'writes: ' + brief(ws) + '; A holds ' + (await A.live()).workouts.length + ' workouts';
  });
  const probs = world.phones.reduce((l, p) => l.concat(p.problems()), []);
  run.say(!probs.length, name, 'no page errors, no console errors', probs.join(' | ').slice(0, 400));
  for (const p of world.phones) await p.close();
}

async function resetTwoPhones(browser) {
  const name = 'Reset with two phones', step = (title, fn) => run.step(name, title, fn);
  const world = { browser, cloud: createCloud(), phones: [] }, cloud = world.cloud;
  const A = await makePhone(world, 'A', true), B = await makePhone(world, 'B', false);
  await A.open(); await A.ev(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL, PASSWORD]); await settle(world);
  await B.open(); await B.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]); await settle(world);
  const start = await counts(cloud, A, B);
  const nBw = fx.state.bodyweight.length, nSl = fx.state.sleep.length;
  await step('both signed in: the question says weigh-ins and nights come back from the other phone, and they do', async () => {
    need(start.account[1] === nBw && start.B[1] === nBw, 'before: ' + show(start));
    const q = await reset(A);
    need(q[0].endsWith('\n\nYou are signed in to cloud sync, so the training data in your account (' + EMAIL + ') is erased too. Weigh-ins and nights on another phone signed in to it come back from that phone. To erase those as well, sign out on that phone first and reset it before it signs in again. The food log in your account is not changed.'), 'the question reads: ' + q[0].replace(/\n/g, ' | '));
    await settle(world);
    const n = await counts(cloud, A, B);
    need(n.account[0] === 0 && n.A[0] === 0 && n.B[0] === 0, 'workouts are not erased: ' + show(n));
    need(n.account[1] === nBw && n.account[2] === nSl && n.A[1] === nBw, 'the weigh-ins and nights did not come back as the question says: ' + show(n));
    need(!Object.keys(core(cloud).deleted.bw || {}).length && !Object.keys(core(cloud).deleted.sleep || {}).length, 'Reset wrote deletion records');
    return show(n);
  });
  await step('the other phone signed out first, then signed in again without a reset: they come back (so the question asks for a reset)', async () => {
    await B.ev(() => window.__overloadSync.signOut()); await settle(world);
    await reset(A); await settle(world);
    let n = await counts(cloud, A, B);
    need(n.account[1] === 0 && n.A[1] === 0, 'with B signed out the account still has weigh-ins: ' + show(n));
    await B.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]); await settle(world);
    n = await counts(cloud, A, B);
    need(n.account[1] === nBw && n.A[1] === nBw, 'B signed in again: ' + show(n));
    return show(n);
  });
  await step('the other phone signed out, reset, signed in again: nothing comes back', async () => {
    await B.ev(() => window.__overloadSync.signOut()); await settle(world);
    await reset(A); await settle(world);
    await reset(B); await settle(world);
    await B.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]); await settle(world);
    const n = await counts(cloud, A, B);
    need(n.account.join() === '0,0,0' && n.A.join() === '0,0,0' && n.B.join() === '0,0,0', show(n));
    return show(n);
  });
  const probs = world.phones.reduce((l, p) => l.concat(p.problems()), []);
  run.say(!probs.length, name, 'no page errors, no console errors', probs.join(' | ').slice(0, 400));
  for (const p of world.phones) await p.close();
}

// Restore on A of an older copy while B is signed in to the same account (Import asks the same, with "the backup").
async function restoreTwoPhones(browser) {
  const name = 'Restore with two phones', step = (title, fn) => run.step(name, title, fn);
  const world = { browser, cloud: createCloud(), phones: [] }, cloud = world.cloud;
  const A = await makePhone(world, 'A', true), B = await makePhone(world, 'B', false);
  await A.open(); await A.ev(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL, PASSWORD]); await settle(world);
  await B.open(); await B.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]); await settle(world);
  // The copy: the data as it was a little earlier. The latest weigh-in, night and workout are not in it yet, the
  // weigh-in of a date both hold has another weight, and the program has a name the account's has not.
  const all = JSON.parse(fx.text), dates = (l) => l.map((x) => x.date).join(','), ids = (l) => l.map((w) => w.id).sort().join(',');
  const lastBw = all.bodyweight[all.bodyweight.length - 1].date, lastNight = all.sleep[all.sleep.length - 1].date, lastW = all.workouts[all.workouts.length - 1].id;
  const st = JSON.parse(fx.text);
  st.bodyweight = st.bodyweight.filter((x) => x.date !== lastBw);
  st.sleep = st.sleep.filter((x) => x.date !== lastNight);
  st.workouts = st.workouts.filter((w) => w.id !== lastW);
  const both = st.bodyweight[st.bodyweight.length - 1]; both.weight = +(both.weight + 1.3).toFixed(1);
  st.program.name = 'From the copy';
  const copyText = JSON.stringify(st);
  // What B deletes after the copy was made: one workout, one weigh-in and one night the copy holds.
  const goneW = st.workouts[0].id, goneBw = st.bodyweight[0].date, goneNight = st.sleep[0].date;
  const after = { workouts: ids(st.workouts.filter((w) => w.id !== goneW)), bw: dates(st.bodyweight.filter((x) => x.date !== goneBw)) + ',' + lastBw, sleep: dates(st.sleep.filter((x) => x.date !== goneNight)) + ',' + lastNight };
  const exact = { workouts: ids(st.workouts), bw: dates(st.bodyweight), sleep: dates(st.sleep) };
  const tail = '\n\nYou are signed in to cloud sync, so the training data in your account (' + EMAIL + ') is replaced too. Weigh-ins and nights on another phone signed in to it come back from that phone for dates the copy does not have. That phone also deletes again any workout, weigh-in or night deleted in the last 90 days. To keep only what is in the copy, sign out on that phone first and reset it before it signs in again. The food log in your account is not changed.';
  const looks = async () => {
    const c = core(cloud), a = await A.live(), b = await B.live();
    const one = (s, ws) => ({ workouts: ids(ws), bw: dates(s.bodyweight), sleep: dates(s.sleep), program: s.program.name, both: (s.bodyweight.find((x) => x.date === both.date) || {}).weight });
    return { account: one(c, cloud.paths(WORKOUTS).map((p) => ({ id: p.split('/').pop() }))), A: one(a, a.workouts), B: one(b, b.workouts) };
  };
  const tell = (n) => ['account', 'A', 'B'].map((k) => k + ' ' + n[k].workouts + ' | ' + n[k].bw + ' | ' + n[k].sleep + ' | ' + n[k].program + ' ' + n[k].both).join('; ');
  const allAre = (n, want, what) => ['account', 'A', 'B'].forEach((k) => {
    need(n[k].program === 'From the copy' && n[k].both === both.weight, what + ': the copy\'s program or weight is not on ' + k + ': ' + tell(n));
    need(n[k].workouts === want.workouts && n[k].bw === want.bw && n[k].sleep === want.sleep, what + ': ' + k + ' is not as the question says: ' + tell(n));
  });
  await A.ev((t) => window.__overloadBackup.take('import', t), copyText);   // the copy, planted in A's Automatic copies
  async function restore() {
    A.page.dialogs.length = 0;
    await lib.openTab(A.page, 'today'); await lib.openTab(A.page, 'settings');   // the list of copies is drawn again
    await A.page.waitForSelector('[data-action="restore-copy"][data-id="before-import"]', { timeout: 5000 });
    await A.page.click('[data-action="restore-copy"][data-id="before-import"]');
    await A.page.waitForFunction((d) => window.__overload.state.bodyweight.map((x) => x.date).join(',') === d, exact.bw, { timeout: 5000 });
    return A.page.dialogs.slice();
  }
  await step('B deletes a workout, a weigh-in and a night the copy holds; the account and A have the deletion records', async () => {
    const pg = B.page;
    await lib.openTab(pg, 'history');
    await pg.click('.list-item[data-action="view-workout"][data-w="' + goneW + '"]');
    await pg.click('#sheet [data-action="delete-workout"][data-w="' + goneW + '"]');
    await pg.waitForFunction((id) => !window.__overload.state.workouts.some((w) => w.id === id), goneW, { timeout: 5000 });
    await pg.click('[data-action="bw-list"]');
    await pg.click('#sheet [data-action="bw-delete"][data-date="' + goneBw + '"]');
    await T.closeSheet(pg);
    await pg.click('[data-action="sleep-list"]');
    await pg.click('#sheet [data-action="sleep-delete"][data-date="' + goneNight + '"]');
    await T.closeSheet(pg);
    await settle(world);
    const c = core(cloud), a = await A.live();
    need(c.deleted.workouts[goneW] && c.deleted.bw[goneBw] && c.deleted.sleep[goneNight], 'the account\'s deletion records: ' + JSON.stringify(c.deleted));
    need(!a.workouts.some((w) => w.id === goneW) && !a.bodyweight.some((x) => x.date === goneBw) && !a.sleep.some((x) => x.date === goneNight), 'A still holds what B deleted');
    return 'deleted ' + goneW + ', weigh-in ' + goneBw + ', night ' + goneNight;
  });
  await step('both signed in: the question says what comes back and what is deleted again, and that is what happens', async () => {
    const q = await restore();
    need(q.length === 1 && q[0].startsWith('confirm: Replace the training data on this phone with the copy "Before import"?'), 'the questions: ' + q.join(' / ').replace(/\n/g, ' | '));
    need(q[0].endsWith(tail), 'the question reads: ' + q[0].replace(/\n/g, ' | '));
    await settle(world);
    const n = await looks();
    allAre(n, after, 'after the restore');
    need(!n.account.workouts.split(',').includes(lastW), 'the workout the copy does not have is still in the account');
    return tell(n);
  });
  await step('the other phone signed out first, then signed in again without a reset: the same comes back (so the question asks for a reset)', async () => {
    await B.ev(() => window.__overloadSync.signOut()); await settle(world);
    await restore(); await settle(world);
    let n = await looks();
    need(n.account.bw === exact.bw && n.account.sleep === exact.sleep && n.account.workouts === exact.workouts, 'with B signed out the account is not the copy: ' + tell(n));
    await B.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]); await settle(world);
    n = await looks();
    allAre(n, after, 'B signed in again');
    return tell(n);
  });
  await step('the other phone signed out, reset, signed in again: exactly what is in the copy, everywhere', async () => {
    await B.ev(() => window.__overloadSync.signOut()); await settle(world);
    await restore(); await settle(world);
    await reset(B); await settle(world);
    await B.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]); await settle(world);
    const n = await looks();
    allAre(n, exact, 'B reset and signed in');
    const d = core(cloud).deleted;
    need(!d.workouts[goneW] && !d.bw[goneBw] && !d.sleep[goneNight], 'the account still has the deletion records: ' + JSON.stringify(d));
    return tell(n);
  });
  const probs = world.phones.reduce((l, p) => l.concat(p.problems()), []);
  run.say(!probs.length, name, 'no page errors, no console errors', probs.join(' | ').slice(0, 400));
  for (const p of world.phones) await p.close();
}

(async () => {
  const browser = await lib.launch();
  try {
    await noteWithoutData(browser);
    await resetTwoPhones(browser);
    await restoreTwoPhones(browser);
  } finally { await browser.close(); }
  run.done();
})().catch((e) => { console.error(e); process.exit(1); });
