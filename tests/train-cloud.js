#!/usr/bin/env node
/* Overload 3.0 and cloud sync, three cases at the edge of the app (tests/fake-firebase; no outside host).
 *
 *   node tests/train-cloud.js [--app=<folder>] [--port=8418]
 *
 *   - A note of what the cloud holds (overload.sync.v1) left in storage next to missing saved data
 *     (overload.state.v1 gone, the sign-in remembered): the start removes the note, so the sign-in that follows is
 *     a first link. Nothing is deleted in the account or on the second phone, and the account's workouts come
 *     down to this phone. (Before 3.0's fix the start kept the note and the push deleted every workout it listed.)
 *   - Reset while signed in, with a second phone signed in. The question says what happens (cloudNote; since
 *     review round 3 sync.js merges weigh-ins and nights date by date): the training data in the account is
 *     erased, and the other phone does the same, except for what was logged or changed on it since it last synced
 *     and its workout in progress, which come back; to be sure nothing comes back, sign that phone out first and
 *     reset it before it signs in again. Each part is checked: both signed in (nothing of the other phone's comes
 *     back but its workout in progress), the other phone signed out, a weigh-in logged there, then signed in
 *     again (that weigh-in comes back, nothing else), and signed out, reset, signed in (nothing comes back). No
 *     deletion records are written by Reset. (A phone still on 2.8 is run in tests/train-sync.js.)
 *   - Restore while signed in, with a second phone signed in. The copy is older: it lacks the latest weigh-in,
 *     night and workout, has another weight for a date both hold, and holds a workout, a weigh-in and a night that
 *     the second phone deleted since. The question says what happens, in Reset's words where they apply, and that
 *     the other phone deletes again what was deleted in the last 90 days; to keep only what is in the copy, sign
 *     that phone out first and reset it before it signs in again. Each part is checked on the account and both
 *     phones: both signed in (the copy's program, workouts and weights, the three deletions done again, nothing
 *     else of the other phone's back), signed out and in again without a reset (the same), and signed out, reset,
 *     signed in (exactly the copy's).
 *   - Before the sync module has loaded (its files refused: a start without signal before they were stored),
 *     signed in (review finding sync#2): Reset, Import and Restore say the account changes too ("your account":
 *     the note holds no email), keep the note, and the next start with the module sends them to the account and
 *     the other phone. Before, the note was removed and the next start brought the account's data back.
 *   - Signed out (the sign-out question says what a sign-in afterwards does): what is logged while signed out is
 *     sent at the next sign-in; a Reset done while signed out, also on a start without the sync module, is not:
 *     signing in again brings back what the account holds.
 *   - Data that cannot be read, then Start fresh while signed in: the screen says the training data comes back
 *     and the old food log does not, and that is what happens.
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
const { need, same } = run;
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
  const nBw = fx.state.bodyweight.length;
  const lists = async () => { const c = core(cloud), a = await A.live(), b = await B.live(), d = (s) => s.bodyweight.map((x) => x.date).join(',') + '|' + s.sleep.map((x) => x.date).join(','); return [d(c), d(a), d(b)]; };
  let inProgress = null;
  await step('both signed in: the question says what of the other phone\'s comes back, and only its workout in progress does', async () => {
    need(start.account[1] === nBw && start.B[1] === nBw, 'before: ' + show(start));
    await lib.openTab(B.page, 'today');
    await B.page.evaluate(() => {
      if (!document.querySelector('[data-action="start-workout"]:not([disabled])')) document.querySelector('[data-action="toggle-others"]').click();
      document.querySelector('[data-action="start-workout"]:not([disabled])').click();
    });
    await settle(world);
    inProgress = (await B.live()).active;
    need(inProgress && cloud.paths(WORKOUTS).some((p) => p.endsWith('/' + inProgress)), 'B\'s workout in progress is not in the account');
    const q = await reset(A);
    need(q[0].endsWith(T.cloudTail('erased', null, EMAIL)), 'the question reads: ' + q[0].replace(/\n/g, ' | '));
    await settle(world);
    const n = await counts(cloud, A, B), l = await lists(), b = await B.live();
    need(l.every((x) => x === '|'), 'weigh-ins or nights came back (account, A, B): ' + l.join('; '));
    need(b.active === inProgress && b.workouts.some((w) => w.id === inProgress && !w.finishedAt), 'B\'s workout in progress is gone from B');
    need(cloud.paths(WORKOUTS).length === 1 && cloud.paths(WORKOUTS)[0].endsWith('/' + inProgress), 'the account\'s workouts: ' + cloud.paths(WORKOUTS).join(', '));
    need(!Object.keys(core(cloud).deleted.bw || {}).length && !Object.keys(core(cloud).deleted.sleep || {}).length, 'Reset wrote deletion records');
    return show(n) + '; B\'s workout in progress kept, and back in the account';
  });
  await step('the other phone signed out, a weigh-in logged there, then signed in again: that weigh-in comes back, nothing else', async () => {
    await A.ev(() => { const s = window.__overload.state; s.bodyweight.push({ date: '2026-11-17', weight: 171 }); s.sleep.push({ date: '2026-11-17', total: 400 }); window.__overload.save(); });
    await settle(world);
    need((await B.live()).bodyweight.some((x) => x.date === '2026-11-17'), 'B did not get A\'s weigh-in');
    await B.ev(() => window.__overloadSync.signOut()); await settle(world);
    await B.ev(() => { const s = window.__overload.state; s.bodyweight.push({ date: '2026-11-18', weight: 173 }); window.__overload.save(); });
    await reset(A); await settle(world);
    let l = await lists();
    need(l[0] === '|' && l[1] === '|', 'with B signed out the account or A still has weigh-ins or nights: ' + l.join('; '));
    await B.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]); await settle(world);
    l = await lists();
    need(l.every((x) => x === '2026-11-18|'), 'B signed in again (account, A, B): ' + l.join('; ') + ' (B logged 2026-11-18 while signed out)');
    return l[0];
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
  // B changed nothing since it last synced but its deletions: the copy's data, less what B deleted (its deletion
  // records come back in the union), and nothing of B's own (its latest weigh-in, night and workout stay gone).
  const after = { workouts: ids(st.workouts.filter((w) => w.id !== goneW)), bw: dates(st.bodyweight.filter((x) => x.date !== goneBw)), sleep: dates(st.sleep.filter((x) => x.date !== goneNight)) };
  const exact = { workouts: ids(st.workouts), bw: dates(st.bodyweight), sleep: dates(st.sleep) };
  const tail = T.cloudTail('replaced', 'the copy', EMAIL);
  need(!after.bw.includes(lastBw) && !after.sleep.includes(lastNight) && !after.workouts.includes(lastW), 'the copy holds the latest weigh-in, night or workout');
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
  await step('both signed in: the question says what is deleted again and what comes back, and that is what happens', async () => {
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

// A start of A whose sync module does not run (the SDK refused), with the note still stored, and the next start with it.
async function startWithout(A) {
  if (A.page && !A.page.isClosed()) await A.page.close();
  A.device.blockSdk(true);
  A.page = await lib.openApp(A.context, ORIGIN + '/index.html');
  need(!(await A.ev(() => !!window.__overloadSync)), 'the sync module ran');
}
async function startWith(world, A) { A.device.blockSdk(false); await A.open(); await settle(world); }
const noteThere = async (A) => !!JSON.parse(await lib.readStorageText(A.page, NOTE));

// Review finding sync#2: signed in, on a start where the sync module has not run yet, Reset, Import and Restore
// say the account changes too, keep the note, and the next start with the module sends them.
async function beforeSyncLoads(browser) {
  const name = 'before the sync module loads', step = (title, fn) => run.step(name, title, fn);
  const world = { browser, cloud: createCloud(), phones: [] }, cloud = world.cloud;
  const tmp = T.tempDir('overload-cloud-');
  const A = await makePhone(world, 'A', true), B = await makePhone(world, 'B', false);
  await A.open(); await A.ev(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL, PASSWORD]); await settle(world);
  await B.open(); await B.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]); await settle(world);
  const program = (s) => s.program.days[0].name;
  await step('Reset: the question says the account is erased too, the note stays, and the next start sends the reset', async () => {
    need(cloud.paths(WORKOUTS).length === fx.state.workouts.length, 'the account has ' + cloud.paths(WORKOUTS).length + ' workouts');
    await startWithout(A);
    const q = await reset(A);
    need(q[0].endsWith(T.cloudTail('erased', null, '')), 'the first question reads: ' + q[0].replace(/\n/g, ' | '));
    same(q[1], 'confirm: Really erase all training data and settings? Export a backup first if you might want it back.', 'the second question');
    need(await noteThere(A), 'the note was removed');
    await startWith(world, A);
    const n = await counts(cloud, A, B);
    need(n.account.join() === '0,0,0' && n.A.join() === '0,0,0' && n.B.join() === '0,0,0', 'the reset did not reach the account and B: ' + show(n));
    return show(n);
  });
  await step('Import: the question says the account\'s training data is replaced too, and the next start sends the backup', async () => {
    const file = JSON.parse(fx.text); file.settings.restSec = 333; file.program.days[0].name = 'From the backup'; file.workouts = file.workouts.slice(0, 1);
    await startWithout(A);
    A.page.dialogs.length = 0;
    await lib.openTab(A.page, 'settings');
    await A.page.setInputFiles('#import-file', T.writeFile(tmp, 'overload-backup-2026-11-01.json', JSON.stringify(file)));
    await A.page.waitForFunction(() => window.__overload.state.settings.restSec === 333, null, { timeout: 8000 });
    need(A.page.dialogs.length === 1 && A.page.dialogs[0].endsWith(T.cloudTail('replaced', 'the backup', '')), 'the question reads: ' + A.page.dialogs.join(' / ').replace(/\n/g, ' | '));
    need(await noteThere(A), 'the note was removed');
    await startWith(world, A);
    const c = core(cloud), a = await A.live(), b = await B.live();
    need([c, a, b].every((s) => s.settings.restSec === 333 && program(s) === 'From the backup'), 'the backup\'s rest time and program (account, A, B): ' + [c, a, b].map((s) => s.settings.restSec + ' "' + program(s) + '"').join(', '));
    const want = file.workouts[0].id;
    need(cloud.paths(WORKOUTS).map((p) => p.split('/').pop()).join() === want && a.workouts.map((w) => w.id).join() === want && b.workouts.map((w) => w.id).join() === want, 'the backup\'s one workout (account, A, B): ' + [cloud.paths(WORKOUTS).length, a.workouts.length, b.workouts.length].join(', '));
    return 'restSec 333, "From the backup", 1 workout everywhere';
  });
  await step('Restore: the question says the account\'s training data is replaced too, and the next start sends the copy', async () => {
    const copy = JSON.parse(fx.text); copy.settings.restSec = 444; copy.program.days[0].name = 'From the copy';
    await startWithout(A);
    await A.ev((t) => window.__overloadBackup.take('import', t), JSON.stringify(copy));   // the copy, planted in A's Automatic copies
    A.page.dialogs.length = 0;
    await lib.openTab(A.page, 'settings');
    await A.page.waitForSelector('[data-action="restore-copy"][data-id="before-import"]', { timeout: 5000 });
    await A.page.click('[data-action="restore-copy"][data-id="before-import"]');
    await A.page.waitForFunction(() => window.__overload.state.settings.restSec === 444, null, { timeout: 8000 });
    need(A.page.dialogs.length === 1 && A.page.dialogs[0].endsWith('A copy of what is on the phone now is kept first.' + T.cloudTail('replaced', 'the copy', '')), 'the question reads: ' + A.page.dialogs.join(' / ').replace(/\n/g, ' | '));
    need(await noteThere(A), 'the note was removed');
    await startWith(world, A);
    const c = core(cloud), a = await A.live(), b = await B.live();
    need([c, a, b].every((s) => s.settings.restSec === 444 && program(s) === 'From the copy'), 'the copy\'s rest time and program (account, A, B): ' + [c, a, b].map((s) => s.settings.restSec + ' "' + program(s) + '"').join(', '));
    need(cloud.paths(WORKOUTS).length === copy.workouts.length && a.workouts.length === copy.workouts.length && b.workouts.length === copy.workouts.length, 'the copy\'s workouts (account, A, B): ' + [cloud.paths(WORKOUTS).length, a.workouts.length, b.workouts.length].join(', '));
    return 'restSec 444, "From the copy", ' + copy.workouts.length + ' workouts everywhere';
  });
  const probs = world.phones.reduce((l, p) => l.concat(p.problems()), []);
  run.say(!probs.length, name, 'no page errors, no console errors', probs.join(' | ').slice(0, 400));
  for (const p of world.phones) await p.close();
  T.removeDir(tmp);
}

// Review finding look#1: the sign-out question says what a sign-in afterwards does, and it is true. Also on a start
// without the sync module after signing out: the phone knows it signed out (overload.backup's signedOut).
async function signedOut(browser) {
  const name = 'signed out', step = (title, fn) => run.step(name, title, fn);
  const world = { browser, cloud: createCloud(), phones: [] }, cloud = world.cloud;
  const A = await makePhone(world, 'A', true);
  await A.open(); await A.ev(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL, PASSWORD]); await settle(world);
  const nW = cloud.paths(WORKOUTS).length, rest0 = core(cloud).settings.restSec;
  const signOut = async () => {
    A.page.dialogs.length = 0;
    await lib.openTab(A.page, 'settings');
    await A.page.click('[data-action="cloud-signout"]');
    await T.toast(A.page, /Signed out/);
    await settle(world);
    return A.page.dialogs.slice();
  };
  await step('the sign-out question: what is logged is sent at the next sign-in, a Reset, Import or Restore is not', async () => {
    const q = await signOut();
    same(q, ['confirm: Sign out? Your data stays on this phone and in the cloud. What you log while signed out is sent when you sign back in. A Reset, Import or Restore done while signed out is not: signing in again brings back what the account holds.'], 'the question');
    return q[0].replace(/^confirm: /, '');
  });
  await step('a weigh-in logged while signed out is sent at the next sign-in', async () => {
    await A.ev(() => { const s = window.__overload.state; s.bodyweight.push({ date: '2026-11-18', weight: 169.9 }); window.__overload.save(); });
    await settle(world);
    need(!core(cloud).bodyweight.some((x) => x.date === '2026-11-18'), 'sent while signed out');
    await A.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]); await settle(world);
    need(core(cloud).bodyweight.some((x) => x.date === '2026-11-18' && x.weight === 169.9), 'the account does not have it');
  });
  await step('signed out, then a start without the sync module: Reset does not speak of the account, and signing in brings its data back', async () => {
    await signOut();
    await startWithout(A);
    const q = await reset(A);
    need(!q.some((t) => /signed in to cloud sync|account/.test(t)), 'a question speaks of the account: ' + q.join(' / ').replace(/\n/g, ' | '));
    need(!(await noteThere(A)), 'the note was kept: the next sign-in would send the reset');
    const mark = cloud.mark();
    await startWith(world, A);
    need(!(await A.ev(() => !!window.__overloadSync.user)), 'signed in by itself');
    await A.ev(([e, p]) => window.__overloadSync.signIn(e, p), [EMAIL, PASSWORD]); await settle(world);
    const a = await A.live(), dels = cloud.writes({ from: mark }).filter((w) => w.type === 'delete');
    need(!dels.length && cloud.paths(WORKOUTS).length === nW, 'the account lost workouts: ' + brief(cloud.writes({ from: mark })));
    need(a.workouts.length === nW && a.settings.restSec === rest0 && a.bodyweight.some((x) => x.date === '2026-11-18'), 'A does not hold what the account holds: ' + a.workouts.length + ' workouts, restSec ' + a.settings.restSec);
    return 'A holds the account\'s ' + nW + ' workouts again; writes: ' + brief(cloud.writes({ from: mark }));
  });
  const probs = world.phones.reduce((l, p) => l.concat(p.problems()), []);
  run.say(!probs.length, name, 'no page errors, no console errors', probs.join(' | ').slice(0, 400));
  for (const p of world.phones) await p.close();
}

// The screen for saved data that cannot be read says what Start fresh brings back while signed in (review round 3,
// not-checked list): the training data, not the old food log (3.0 takes no food from the account).
async function unreadableFresh(browser) {
  const name = 'unreadable data', step = (title, fn) => run.step(name, title, fn);
  const world = { browser, cloud: createCloud(), phones: [] }, cloud = world.cloud;
  const A = await makePhone(world, 'A', true);
  await A.open(); await A.ev(([e, p]) => window.__overloadSync.createAccount(e, p), [EMAIL, PASSWORD]); await settle(world);
  const nW = cloud.paths(WORKOUTS).length, food0 = JSON.stringify(core(cloud).food);
  await step('Start fresh while signed in: the training data comes back from the account, the old food log does not, as the screen says', async () => {
    need(Object.keys((await A.live()).diary).length > 0, 'no old food log on A');
    await A.ev((k) => localStorage.setItem(k, '{"v":1,"exercises":[}'), lib.STATE_KEY);
    await A.open();
    const says = await T.text(A.page, '[data-action="unreadable-fresh"]');
    need(says !== null, 'no unreadable-data screen');
    const line = await A.ev(() => document.querySelector('[data-action="unreadable-fresh"]').closest('.card').querySelector('p').textContent);
    same(line, 'An empty app with the default program. If you used cloud sync, your training data comes back once you are signed in, but not the old food log.', 'the line');
    A.page.dialogs.length = 0;
    await A.page.click('[data-action="unreadable-fresh"]');
    await T.toast(A.page, /Started fresh/);
    await settle(world);
    const a = await A.live();
    need(a.workouts.length === nW, 'A holds ' + a.workouts.length + ' of the account\'s ' + nW + ' workouts');
    need(!Object.keys(a.diary).length, 'the old food log came back: ' + Object.keys(a.diary).length + ' days');
    need(JSON.stringify(core(cloud).food) === food0, 'the account\'s food part changed');
    return line;
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
    await beforeSyncLoads(browser);
    await signedOut(browser);
    await unreadableFresh(browser);
  } finally { await browser.close(); }
  run.done();
})().catch((e) => { console.error(e); process.exit(1); });
