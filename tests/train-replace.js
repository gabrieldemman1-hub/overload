#!/usr/bin/env node
/* Overload 3.0: Reset, Import and Restore never drop the old food copy, and never take a Fuel file.
 *
 *   node tests/train-replace.js [--port=8404]
 *
 * On the main v2.8 fixture (110 food days on the phone):
 *   - Reset all data: the training data goes back to a new install; food, diary and deleted.food stay byte for
 *     byte; the two questions say the food log is not erased.
 *   - Import JSON of another backup (the light user's): its training data replaces the phone's; the phone's
 *     food stays byte for byte; the question says so and still counts the food days of both.
 *   - Restore an automatic copy: the same.
 *   - After "Remove the old food log", restoring the copy taken before the removal brings the log back.
 * On an empty phone: Import of a backup with food takes the file's food (the stored text is the file's).
 * A Fuel-style file ({ v: 1, app: 'fuel', … }) and a hand-over payload file, each with and without an
 * exercises field, are refused with "This is a Fuel file. Open it in Fuel." and change nothing; so is a copy
 * of that shape under Restore.
 * Signed in to cloud sync (stand-in), the questions say the training data in the account is replaced and
 * the account's food log is not changed.
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const lib = require('./lib');
const T = require('./train-common');

const args = T.args();
const PORT = Number(args.port) || 8404;
const run = T.runner('train-replace');
const { need, same } = run;

const fx = lib.loadFixture('v28-state'), small = lib.loadFixture('v28-state-small');
const DAYS = Object.keys(fx.state.diary).length, FUEL_FILE = 'This is a Fuel file. Open it in Fuel.';
const TRAINING = ['settings', 'exercises', 'presc', 'program', 'workouts', 'active', 'bodyweight', 'sleep', 'templates', 'libVersion'];
const plain = (t) => String(t).replace(/ /g, ' ');   // the questions keep each date on one line with no-break spaces
const tmp = T.tempDir('overload-replace-');

// A phone with the main fixture (or nothing, with state: null). `answer.yes` decides how questions are answered.
async function phoneWith(browser, server, opts) {
  opts = opts || {};
  const phone = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
  if (opts.clipboard) await phone.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  if (opts.state !== null) await lib.seedV28(phone.context, fx);
  const answer = { yes: true };
  const page = await lib.openApp(phone.context, server.url + '/index.html', { dialogs: (d) => (answer.yes ? d.accept() : d.dismiss()) });
  await T.copy(page, 'before-split', opts.state === null ? 0 : 5000);   // let the first start settle
  return { phone, page, answer };
}
const text = (page) => lib.readStorageText(page, lib.STATE_KEY);
async function foodIsTheFixtures(page, what) {
  const got = T.foodTexts(JSON.parse(await text(page))), want = T.foodTexts(fx.state);
  need(got.food === want.food, what + ': food (saved foods, meals, targets) is not byte for byte the phone\'s');
  need(got.diary === want.diary, what + ': diary is not byte for byte the phone\'s');
  need(got.deleted === want.deleted, what + ': deleted.food is not the phone\'s');
}
function trainingIs(state, want, what) { TRAINING.forEach((k) => need(JSON.stringify(state[k]) === JSON.stringify(want[k]), what + ': ' + k + ' is not the backup\'s')); }
async function importFile(page, file) { await lib.openTab(page, 'settings'); await page.setInputFiles('#import-file', file); }
async function restore(page, id) {
  await lib.openTab(page, 'settings');
  await page.waitForSelector('[data-action="restore-copy"][data-id="' + id + '"]', { timeout: 5000 });
  await page.click('[data-action="restore-copy"][data-id="' + id + '"]');
}
const errors = (name, phone) => { const p = phone.problems(); run.say(!p.length, name, 'no page errors, no console errors', p.join(' | ').slice(0, 400)); };

async function reset(browser, server) {
  const name = 'reset', { phone, page } = await phoneWith(browser, server);
  await run.step(name, 'Reset all data keeps the old food copy byte for byte and says so', async () => {
    await lib.openTab(page, 'settings');
    await page.click('[data-action="reset"]');
    await T.toast(page, /Reset to defaults|Not saved/);
    const q = page.dialogs.map(plain);
    same(q.length, 2, 'the number of questions');
    need(q[0] === 'confirm: Erase all exercises, program and history on this phone?\n\nThe old food log (' + DAYS + ' days) is not erased. It stays on this phone until you remove it in Settings > Food.', 'the first question reads: ' + q[0]);
    need(q[1] === 'confirm: Really erase all training data?', 'the second question reads: ' + q[1]);
    need(!q.some((t) => /and food log|erase everything/i.test(t)), 'a question still claims the food log is erased');
    const now = JSON.parse(await text(page));
    need(now.workouts.length === 0 && now.bodyweight.length === 0 && now.sleep.length === 0 && now.templates.length === 0 && Object.keys(now.presc).length === 0, 'the training data was not reset');
    need(now.exercises.length === 80 && now.program.days.length === 3 && now.settings.repMin === 10 && now.settings.theme === 'system', 'not a new install\'s exercises, program and settings: ' + now.exercises.length + ' exercises, ' + now.program.days.length + ' days');
    await foodIsTheFixtures(page, 'after Reset');
    same(Object.keys(now), fx.facts.counts.topLevelKeys, 'the fields of the saved data');
    const c = await T.copy(page, 'before-reset');
    need(c && c.text === fx.text, 'the copy "Before reset" does not hold the data as it was');
    return q[0].split('\n').pop();
  });
  await run.step(name, 'after the reset the card on Today still offers the food log', async () => {
    await lib.openTab(page, 'today');
    need(/^Food has moved to Fuel/.test(await T.text(page, '#handover .card')) && (await T.text(page, '#handover .card')).includes(DAYS + ' days'), 'no hand-over card with the food days on Today');
  });
  errors(name, phone); await phone.close();
}

async function importOver(browser, server) {
  const name = 'import over food', { phone, page } = await phoneWith(browser, server);
  const file = T.writeFile(tmp, 'overload-backup-small.json', JSON.stringify(small.state, null, 2));   // as Export JSON writes it
  await run.step(name, 'Import JSON replaces the training data, keeps the phone\'s food byte for byte and says so', async () => {
    await importFile(page, file);
    await T.toast(page, /Backup restored|Not saved|not an Overload/);
    same(page.dialogs.length, 1, 'the number of questions');
    const q = plain(page.dialogs[0]).split('\n');
    need(q[0] === 'confirm: Replace the training data on this phone with the backup?', 'the question starts: ' + q[0]);
    need(/^The backup: 3 workouts \(.+\), 4 food days\.$/.test(q[2]), 'the backup\'s line reads: ' + q[2]);
    need(new RegExp('^This phone now: 70 workouts \\(.+\\), ' + DAYS + ' food days\\.$').test(q[3]), 'the phone\'s line reads: ' + q[3]);
    need(q[5] === 'The old food log on this phone (' + DAYS + ' days) stays as it is. Food in the backup is not used.', 'the food line reads: ' + q[5]);
    need(!/everything|erase/i.test(q.join(' ')), 'the question still says everything is replaced');
    const now = JSON.parse(await text(page));
    trainingIs(now, small.state, 'after Import');
    await foodIsTheFixtures(page, 'after Import');
    const c = await T.copy(page, 'before-import');
    need(c && c.text === fx.text, 'the copy "Before import" does not hold the data as it was');
    return q[5];
  });
  errors(name, phone); await phone.close();
}

async function importIntoEmpty(browser, server) {
  const name = 'import into an empty phone', { phone, page, answer } = await phoneWith(browser, server, { state: null });
  await run.step(name, 'Reset on a phone without food says nothing about food', async () => {
    answer.yes = false;
    await lib.openTab(page, 'settings'); await page.click('[data-action="reset"]');
    same(page.dialogs.map(plain), ['confirm: Erase all exercises, program and history on this phone?'], 'the question');
    answer.yes = true; page.dialogs.length = 0;
  });
  const file = T.writeFile(tmp, 'overload-backup-main.json', JSON.stringify(fx.state, null, 2));
  await run.step(name, 'Import of a backup with food takes the file\'s food: the stored text is the file\'s', async () => {
    await importFile(page, file);
    await T.toast(page, /Backup restored|Not saved|not an Overload/);
    same(page.dialogs.length, 1, 'the number of questions');
    const q = plain(page.dialogs[0]).split('\n');
    need(q[0] === 'confirm: Replace everything on this phone with the backup?', 'the question starts: ' + q[0]);
    need(new RegExp('^The backup: 70 workouts \\(.+\\), ' + DAYS + ' food days\\.$').test(q[2]), 'the backup\'s line reads: ' + q[2]);
    need(q[3] === 'This phone now: 0 workouts.', 'the phone\'s line reads: ' + q[3]);
    need(q[5] === 'The food log in the backup (' + DAYS + ' days) comes with it.', 'the food line reads: ' + q[5]);
    need((await text(page)) === fx.text, 'the stored text is not the backup\'s');
    await foodIsTheFixtures(page, 'after Import into an empty phone');
    return q[5];
  });
  errors(name, phone); await phone.close();
}

async function restoreOver(browser, server) {
  const name = 'restore over food', { phone, page } = await phoneWith(browser, server);
  await run.step(name, 'Restore of a copy replaces the training data, keeps the phone\'s food byte for byte and says so', async () => {
    need(await page.evaluate((t) => window.__overloadBackup.take('import', t), small.text), 'could not plant a copy');   // a copy holding other data: the light user's
    await restore(page, 'before-import');
    await T.toast(page, /Copy restored|Not saved|cannot be read/);
    same(page.dialogs.length, 1, 'the number of questions');
    const q = plain(page.dialogs[0]).split('\n');
    need(q[0] === 'confirm: Replace the training data on this phone with the copy "Before import"?', 'the question starts: ' + q[0]);
    need(/^The copy: 3 workouts \(.+\), 4 food days\.$/.test(q[2]), 'the copy\'s line reads: ' + q[2]);
    need(new RegExp('^This phone now: 70 workouts \\(.+\\), ' + DAYS + ' food days\\.$').test(q[3]), 'the phone\'s line reads: ' + q[3]);
    need(q[5] === 'The old food log on this phone (' + DAYS + ' days) stays as it is. Food in the copy is not used.', 'the food line reads: ' + q[5]);
    need(q[7] === 'A copy of what is on the phone now is kept first.', 'the last line reads: ' + q[7]);
    need(!/everything|erase/i.test(q.join(' ')), 'the question still says everything is replaced');
    trainingIs(JSON.parse(await text(page)), small.state, 'after Restore');
    await foodIsTheFixtures(page, 'after Restore');
    const c = await T.copy(page, 'before-restore');
    need(c && c.text === fx.text, 'the copy "Before restore" does not hold the data as it was');
    return q[5];
  });
  errors(name, phone); await phone.close();
}

async function restoreAfterRemove(browser, server) {
  const name = 'restore after Remove', { phone, page } = await phoneWith(browser, server, { clipboard: true });
  await run.step(name, 'the copy taken before the removal brings the food log back', async () => {
    await lib.openTab(page, 'settings');
    await page.click('[data-action="handover-copy"]'); await T.toast(page, /Food log copied/);
    await page.click('[data-action="handover-remove"]'); await T.toast(page, /Old food log removed/);
    same(JSON.parse(await text(page)).diary, {}, 'diary after the removal');
    page.dialogs.length = 0;
    await restore(page, 'before-foodremove');
    await T.toast(page, /Copy restored|Not saved|cannot be read/);
    const q = plain(page.dialogs[0]).split('\n');
    need(q[0] === 'confirm: Replace everything on this phone with the copy "Before removing the old food log"?', 'the question starts: ' + q[0]);
    need(q[5] === 'The food log in the copy (' + DAYS + ' days) comes with it.', 'the food line reads: ' + q[5]);
    need((await text(page)) === fx.text, 'the stored text is not what it was before the removal');
    await foodIsTheFixtures(page, 'after restoring the removal copy');
    return q[5];
  });
  errors(name, phone); await phone.close();
}

async function fuelFiles(browser, server) {
  const name = 'Fuel files', { phone, page } = await phoneWith(browser, server);
  const st = fx.state;
  const fuel = { v: 1, app: 'fuel', settings: { units: 'lb', theme: 'dark' }, food: st.food, diary: st.diary, deleted: { food: st.deleted.food, foods: {}, meals: {} }, bodyweight: [], moved: null };
  const payload = { kind: 'overload-food', v: 1, madeAt: fx.meta.now, from: 'Overload 3.0', food: st.food, diary: st.diary, deleted: { food: st.deleted.food }, settings: { units: 'lb', theme: 'dark' }, bodyweight: [] };
  const files = [
    ['a Fuel backup', fuel],
    ['a Fuel backup that also has an exercises list', Object.assign({}, fuel, { exercises: [] })],
    ['a food log saved for Fuel', payload],
    ['a food log saved for Fuel that also has an exercises list', Object.assign({}, payload, { exercises: [] })]
  ];
  for (let i = 0; i < files.length; i++) {
    await run.step(name, 'Import refuses ' + files[i][0] + ' and changes nothing', async () => {
      await page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
      await importFile(page, T.writeFile(tmp, 'fuel-' + i + '.json', files[i][1]));
      const t = await T.toast(page, /./);
      need(t === FUEL_FILE, 'the app said: ' + t);
      need(!page.dialogs.length, 'a question was asked: ' + page.dialogs.join(' / '));
      need((await text(page)) === fx.text, 'the data changed');
      need(!(await T.copy(page, 'before-import', 300)), 'a copy "Before import" was taken');
      return t;
    });
  }
  await run.step(name, 'a file that is no backup at all is still refused as before', async () => {
    await page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
    await importFile(page, T.writeFile(tmp, 'other.json', { v: 2, hello: 'world' }));
    need((await T.toast(page, /./)) === 'That file is not an Overload backup', 'the app said: ' + (await T.text(page, '#toast')));
    need((await text(page)) === fx.text && !page.dialogs.length, 'the data changed or a question was asked');
  });
  await run.step(name, 'Restore refuses a copy of that shape and changes nothing', async () => {
    need(await page.evaluate((t) => window.__overloadBackup.take('cloud', t), JSON.stringify(files[1][1])), 'could not plant a copy');
    await page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
    await lib.openTab(page, 'today');   // Settings is drawn again, with the planted copy in its list
    await restore(page, 'before-cloud');
    const t = await T.toast(page, /./);
    need(t === FUEL_FILE, 'the app said: ' + t);
    need(!page.dialogs.length && (await text(page)) === fx.text, 'a question was asked or the data changed');
    need(!(await T.copy(page, 'before-restore', 300)), 'a copy "Before restore" was taken');
    return t;
  });
  errors(name, phone); await phone.close();
}

async function signedIn(browser, server) {
  const name = 'signed in to cloud sync', { phone, page, answer } = await phoneWith(browser, server);
  const file = T.writeFile(tmp, 'overload-backup-small-2.json', small.text);
  await run.step(name, 'the questions say the account\'s training data goes too and its food log is not changed', async () => {
    answer.yes = false;   // read the questions, change nothing
    await page.evaluate(() => { window.__overloadSync = { user: { email: 'me@example.com', uid: 'u1' } }; });   // sync.js cannot load here (its Firebase files are on another host)
    await lib.openTab(page, 'settings');
    await page.click('[data-action="reset"]');
    await importFile(page, file);
    await page.waitForFunction(() => true); await lib.sleep(300);
    need(await page.evaluate((t) => window.__overloadBackup.take('import', t), small.text), 'could not plant a copy');
    await lib.openTab(page, 'today'); await restore(page, 'before-import');
    await lib.sleep(300);
    const q = page.dialogs.map(plain);
    same(q.length, 3, 'the number of questions');
    const tail = (verb) => '\n\nYou are signed in to cloud sync, so the training data in your account (me@example.com) is ' + verb + ' too. The food log in your account is not changed.';
    need(q[0].endsWith('It stays on this phone until you remove it in Settings > Food.' + tail('erased')), 'Reset asks: ' + q[0]);
    need(q[1].endsWith('Food in the backup is not used.' + tail('replaced')), 'Import asks: ' + q[1]);
    need(q[2].endsWith('A copy of what is on the phone now is kept first.' + tail('replaced')), 'Restore asks: ' + q[2]);
    need(!q.some((t) => /the copy in your account/.test(t)), 'a question still says the whole copy in the account is replaced');
    need((await text(page)) === fx.text, 'saying no changed the data');
    return tail('replaced').trim();
  });
  errors(name, phone); await phone.close();
}

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    await reset(browser, server);
    await importOver(browser, server);
    await importIntoEmpty(browser, server);
    await restoreOver(browser, server);
    await restoreAfterRemove(browser, server);
    await fuelFiles(browser, server);
    await signedIn(browser, server);
  } finally { await browser.close(); await server.stop(); T.removeDir(tmp); }
  run.done();
})().catch((e) => { console.error(e); T.removeDir(tmp); process.exit(1); });
