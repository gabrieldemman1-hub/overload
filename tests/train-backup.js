#!/usr/bin/env node
/* backup.js, the training app's automatic copies (IndexedDB 'overload-copies').
 *
 *   node tests/train-backup.js [--port=8408]
 *
 *   - A lost connection to the copy store (an iPhone drops it for an app back from the background: "Connection to
 *     Indexed Database server lost") is forgotten and opened again: take(), list() and get() work at the next call
 *     in the same session, and "Remove the old food log" works at the first try, not only after a restart.
 *     Three ways in: the connection closed under the app, its close event, a transaction that cannot be started.
 *   - Each "Remove the old food log" keeps a copy of its own (before-foodremove-<time>) and the newest three are
 *     kept, a copy under the old single id among them: the list cannot grow without bound. Daily copies are
 *     still the last 7 dates; every other kind still keeps its one id.
 *   - v2.8 (git 3b17963) runs with this backup.js, as it can when a v2.8 page gets the new file on weak signal:
 *     it takes its daily copy, lists the copies, takes "Before reset" and restores it.
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const T = require('./train-common');

const args = T.args();
const PORT = Number(args.port) || 8408;
const run = T.runner('train-backup');
const { need, same } = run;
const fx = lib.loadFixture('v28-state-small');
// Keeps every database the page opens, so a test can close it from outside as the phone would.
const KEEP_DBS = () => { const real = indexedDB.open.bind(indexedDB); indexedDB.open = function () { const r = real.apply(null, arguments); r.addEventListener('success', () => { (window.__dbs = window.__dbs || []).push(r.result); }); return r; }; };
const B = (page, fn, arg) => page.evaluate(fn, arg);

async function phone(browser, server, opts) {
  opts = opts || {};
  const p = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
  await p.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await p.context.addInitScript(KEEP_DBS);
  await lib.seedV28(p.context, fx);
  const page = await lib.openApp(p.context, server.url + (opts.page || '/index.html'));
  if (!opts.page) await T.copy(page, 'before-split');
  return { p, page };
}
const errors = (name, p) => { const e = p.problems(); run.say(!e.length, name, 'no page errors, no console errors', e.join(' | ').slice(0, 400)); };

async function lostConnection(browser, server) {
  const name = 'lost connection', step = (title, fn) => run.step(name, title, fn);
  const { p, page } = await phone(browser, server);
  await step('the connection closed under the app: the next take, list and get work, in the same session', async () => {
    await B(page, () => window.__dbs.forEach((d) => d.close()));
    const took = await B(page, () => window.__overloadBackup.take('import', '{"v":1,"exercises":[],"workouts":[]}'));
    need(took === true, 'take() after the loss: ' + took);
    const list = await B(page, () => window.__overloadBackup.list().then((l) => l.map((m) => m.id), (e) => 'rejected: ' + e));
    need(Array.isArray(list) && list.includes('before-import') && list.includes('before-split'), 'list() after the loss: ' + JSON.stringify(list));
    const got = await B(page, () => window.__overloadBackup.get('before-split').then((c) => !!(c && c.text), (e) => 'rejected: ' + e));
    need(got === true, 'get() after the loss: ' + got);
    return list.join(', ');
  });
  await step('the connection closed under the app: Remove the old food log works at the first try', async () => {
    await B(page, () => window.__dbs.forEach((d) => d.close()));
    await lib.openTab(page, 'settings');
    await page.click('[data-action="handover-copy"]'); await T.toast(page, /Food log copied/);
    await page.click('[data-action="handover-remove"]');
    const t = await T.toast(page, /removed|Not saved|could not|changed/);
    need(t === 'Old food log removed from Overload', 'the app said: ' + t);
    const c = (await T.copies(page)).find((m) => m.kind === 'foodremove');
    need(c && (await T.copy(page, c.id)).text === fx.text, 'no safety copy of the log');
    return t;
  });
  await step('the database\'s close event (the phone ended the connection): the next call opens it again', async () => {
    const before = await B(page, () => window.__dbs.length);
    await B(page, () => window.__dbs[window.__dbs.length - 1].dispatchEvent(new Event('close')));
    need(await B(page, () => window.__overloadBackup.take('reset', '{"v":1,"exercises":[],"workouts":[]}')) === true, 'take() after the close event failed');
    need(await B(page, () => window.__dbs.length) === before + 1, 'the database was not opened again');
  });
  await step('a transaction that cannot be started (the connection is gone): tried once more on a fresh connection', async () => {
    await B(page, () => { const real = IDBDatabase.prototype.transaction; let once = true; IDBDatabase.prototype.transaction = function () { if (once) { once = false; throw new DOMException('The database connection is closing.', 'InvalidStateError'); } return real.apply(this, arguments); }; });
    need(await B(page, () => window.__overloadBackup.take('cloud', '{"v":1,"exercises":[],"workouts":[]}')) === true, 'take() failed');
    need(await B(page, () => window.__overloadBackup.get('before-cloud').then((c) => !!c)), 'the copy is not there');
  });
  await step('a database that does not open still gives up: take() resolves false, list() rejects', async () => {
    await B(page, () => { window.__dbs.forEach((d) => d.close()); indexedDB.open = () => { const r = {}; return r; }; });   // never answers
    await B(page, () => { window.__dbs[window.__dbs.length - 1].dispatchEvent(new Event('close')); });
    const pending = page.evaluate(async () => { const p1 = window.__overloadBackup.take('import', 'x'), p2 = window.__overloadBackup.list().then(() => 'listed', () => 'rejected'); return [await p1, await p2]; });
    await lib.sleep(100); await page.clock.runFor(2500);   // backup.js waits 2 s for an answer
    same(await pending, [false, 'rejected'], 'take() and list() with no database');
  });
  errors(name, p); await p.close();
}

// Review finding data#2: a transaction that neither completes nor fails (stand-in: its requests never answer) is
// given up after backup.js's time limit (5 s): take() resolves false, list() and get() reject, and the next call
// works. So Remove and Reset say so instead of waiting for ever, and work again in the same session.
const HANG = () => {
  const real = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function () {
    if (!window.__hang) return real.apply(this, arguments);
    window.__hung = (window.__hung || 0) + 1;
    const req = () => ({ onsuccess: null, onerror: null, result: undefined });
    const store = { put: req, get: req, getAll: req, delete: req };
    return { objectStore: () => store, abort() {}, oncomplete: null, onerror: null, onabort: null };
  };
};
async function hung(browser, server) {
  const name = 'a copy store that does not answer', step = (title, fn) => run.step(name, title, fn);
  const { p, page } = await phone(browser, server);
  await B(page, HANG);
  const hang = (on) => B(page, (v) => { window.__hang = v; }, on);
  await step('take() resolves false, list() and get() reject, after the time limit; then each works again', async () => {
    await hang(true);
    const pending = page.evaluate(async () => {
      const B = window.__overloadBackup, settle = (pr) => pr.then((v) => (v && v.length !== undefined ? 'listed' : v), () => 'rejected');
      return [await B.take('import', '{"v":1,"exercises":[],"workouts":[]}'), await settle(B.list()), await settle(B.get('before-split'))];
    });
    for (let i = 0; i < 4; i++) { await lib.sleep(100); await page.clock.runFor(5100); }
    same(await Promise.race([pending, lib.sleep(10000).then(() => 'no answer after 20 s of the page\'s clock')]), [false, 'rejected', 'rejected'], 'take(), list() and get() with a transaction that never answers');
    await hang(false);
    need(await B(page, () => window.__overloadBackup.take('import', '{"v":1,"exercises":[],"workouts":[]}')) === true, 'take() afterwards failed');
    need(await B(page, () => window.__overloadBackup.get('before-split').then((c) => !!(c && c.text), () => false)), 'get() afterwards failed');
  });
  await step('Remove the old food log: says the copies could not be read, removes nothing; then works in the same session', async () => {
    await lib.openTab(page, 'settings');
    await page.click('[data-action="handover-copy"]'); await T.toast(page, /Food log copied/);
    await hang(true);
    page.dialogs.length = 0;
    await page.click('[data-action="handover-remove"]');
    await lib.sleep(100); await page.clock.runFor(5100);
    const t = await T.toast(page, /removed|could not|changed/);
    same(t, 'The automatic copies could not be read, so nothing was removed. Try again.', 'the toast');
    need(!page.dialogs.length && Object.keys(JSON.parse(await lib.readStorageText(page, lib.STATE_KEY)).diary).length > 0, 'a question was asked or the log removed');
    await hang(false);
    await B(page, () => { document.querySelector('#toast').hidden = true; });
    await page.click('[data-action="handover-remove"]');
    same(await T.toast(page, /removed from|could not|changed/), 'Old food log removed from Overload', 'the second try');
    return t;
  });
  await step('Reset: a sheet says the automatic copy could not be stored, nothing is erased; then Reset works in the same session', async () => {
    const before = await lib.readStorageText(page, lib.STATE_KEY);
    await hang(true);
    page.dialogs.length = 0;
    await lib.openTab(page, 'settings');
    await page.click('[data-action="reset"]');
    await lib.sleep(100); await page.clock.runFor(5100);
    await page.waitForFunction(() => !document.querySelector('#sheet').hidden, null, { timeout: 8000 });
    same(await T.text(page, '#sheet .banner'), 'The automatic copy could not be stored, so nothing was erased. Export a backup first, then try again.', 'the sheet');
    need((await lib.readStorageText(page, lib.STATE_KEY)) === before, 'the data changed');
    await hang(false);
    await T.closeSheet(page);
    await page.click('[data-action="reset"]');
    await T.toast(page, /Reset to defaults/);
    need((await B(page, () => window.__overload.state.workouts.length)) === 0, 'not reset');
  });
  errors(name, p); await p.close();
}

async function pruning(browser, server) {
  const name = 'how many copies', step = (title, fn) => run.step(name, title, fn);
  const { p, page } = await phone(browser, server);
  await step('five removal copies: each has its own id, the newest three are kept (with the old single id among them)', async () => {
    // A copy under the single id that 3.0 used before (kind foodremove): the oldest of them.
    await B(page, () => new Promise((res, rej) => { const r = indexedDB.open('overload-copies', 1); r.onsuccess = () => { const t = r.result.transaction(['meta', 'data'], 'readwrite'); t.objectStore('meta').put({ id: 'before-foodremove', kind: 'foodremove', at: Date.now() - 864e5, chars: 3 }); t.objectStore('data').put({ id: 'before-foodremove', text: '{"v":1}' }); t.oncomplete = () => { r.result.close(); res(); }; t.onerror = rej; }; }));
    const ids = [];
    for (let i = 0; i < 5; i++) {
      await page.clock.runFor(1000);
      need(await B(page, (i) => window.__overloadBackup.take('foodremove', JSON.stringify({ v: 1, exercises: [], workouts: [], diary: { ['2026-11-1' + i]: [] }, n: i })), i) === true, 'take ' + (i + 1) + ' failed');
      ids.push((await T.copies(page)).filter((m) => m.kind === 'foodremove').map((m) => m.id));
    }
    same(ids.map((l) => l.length), [2, 3, 3, 3, 3], 'removal copies after each take');
    const last = ids[4];
    need(last.every((id) => /^before-foodremove-\d+$/.test(id)) && new Set(last).size === 3, 'the ids: ' + last.join(', '));
    const kept = [];
    for (const id of last) kept.push(JSON.parse((await T.copy(page, id, 0)).text).n);
    same(kept, [4, 3, 2], 'the copies kept (newest first)');
    need(!(await T.copy(page, 'before-foodremove', 0)) && !(await T.copy(page, ids[0][0], 0)), 'an older copy is still stored');
    return last.join(', ');
  });
  await step('daily copies: still the last 7 dates; the other kinds keep one id each', async () => {
    for (let i = 1; i <= 9; i++) { await page.clock.setSystemTime(fx.meta.now + i * 864e5); await B(page, () => window.__overloadBackup.take('day', '{"v":1,"exercises":[]}')); }
    const list = await T.copies(page);
    same(list.filter((m) => m.kind === 'day').length, 7, 'daily copies');
    for (const k of ['import', 'import', 'reset', 'restore', 'cloud', 'unreadable', 'split']) await B(page, (k) => window.__overloadBackup.take(k, '{"v":1}'), k);
    const ids = (await T.copies(page)).filter((m) => m.kind !== 'day' && m.kind !== 'foodremove').map((m) => m.id).sort();
    same(ids, ['before-cloud', 'before-import', 'before-reset', 'before-restore', 'before-split', 'before-unreadable'], 'the other copies');
    same(await B(page, () => [window.__overloadBackup.KEEP_DAYS, window.__overloadBackup.KEEP_REMOVALS]), [7, 3], 'KEEP_DAYS, KEEP_REMOVALS');
  });
  errors(name, p); await p.close();
}

// v2.8 with this backup.js: a v2.8 page can get the new file under its old name when it arrives in time.
async function v28WithThisFile(browser) {
  const name = 'v2.8 with this backup.js', step = (title, fn) => run.step(name, title, fn);
  const dir = T.extractV28();
  fs.copyFileSync(path.join(lib.REPO, 'backup.js'), path.join(dir, 'backup.js'));
  const server = await lib.startServer(dir, PORT + 1);
  try {
    const { p, page } = await phone(browser, server, { page: '/index.html' });
    await step('v2.8 starts, takes its daily copy and lists it', async () => {
      need(/app\.js\?v=2\.8$/.test(await page.evaluate(() => document.querySelector('script[src*="app.js"]').getAttribute('src'))), 'not v2.8\'s page');
      const c = await T.copy(page, 'day-' + fx.meta.today);
      need(c && c.text === fx.text, 'no daily copy with the data');
      await lib.openTab(page, 'settings');
      await page.waitForSelector('#safety-copies .copy-row', { timeout: 5000 });
      return (await T.copies(page)).map((m) => m.id).join(', ');
    });
    await step('v2.8: Reset takes "Before reset", and Restore of it brings the data back exactly', async () => {
      await page.click('[data-action="reset"]');
      await page.waitForFunction(() => window.__overload.state.workouts.length === 0, null, { timeout: 5000 });
      const c = await T.copy(page, 'before-reset');
      need(c && c.text === fx.text, 'no copy "Before reset" with the data');
      await lib.openTab(page, 'today'); await lib.openTab(page, 'settings');
      await page.waitForSelector('[data-action="restore-copy"][data-id="before-reset"]', { timeout: 5000 });
      await page.click('[data-action="restore-copy"][data-id="before-reset"]');
      await T.toast(page, /Copy restored|cannot be read|Not saved/);
      need((await lib.readStorageText(page, lib.STATE_KEY)) === fx.text, 'the data is not back');
    });
    errors(name, p); await p.close();
  } finally { await server.stop(); T.removeDir(dir); }
}

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    await lostConnection(browser, server);
    await hung(browser, server);
    await pruning(browser, server);
    await v28WithThisFile(browser);
  } finally { await browser.close(); await server.stop(); }
  run.done();
})().catch((e) => { console.error(e); process.exit(1); });
