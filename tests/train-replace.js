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
 *   - When the phone holds one part of the old food copy (food days, or saved foods and targets) and not the other,
 *     the Import question says which part comes from the file, and that is what happens.
 *   - Restore of the copy taken before a removal or at the split, while the phone holds food days again (v2.8 ran
 *     and logged food): the two logs are put together (the phone's entries as they are, its deletions kept).
 * On an empty phone: Import of a backup with food takes the file's food (the stored text is the file's).
 * A Fuel-style file ({ v: 1, app: 'fuel', … }) and a hand-over payload file, each with and without an
 * exercises field, are refused with "This is a Fuel file. Open it in Fuel." and change nothing; so is a copy
 * of that shape under Restore.
 * Signed in to cloud sync (stand-in), the questions say the training data in the account is replaced (Reset:
 * erased), what another phone signed in to it sends back and how to stop that, and that the account's food log
 * is not changed. (tests/train-cloud.js runs Reset and Restore with two phones on the fake cloud.)
 * Round 5, ask#1: with v2.8's backup.js on the page (no automatic copies), Reset, Import and Remove the old food log
 * refuse before any question ("Automatic copies are not available right now, …"), and nothing changes.
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
  if (opts.setup) await opts.setup(phone.context);   // e.g. another release's file for an address (routes added later win)
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
// The copy taken before the last "Remove the old food log" (each removal has one of its own).
const removalCopy = async (page) => (await T.copies(page)).find((m) => m.kind === 'foodremove');
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
    need(q[0] === 'confirm: Erase all exercises, program, history and settings on this phone?\n\nThe old food log (' + DAYS + ' days) is not erased. It stays on this phone until you remove it in Settings > Food.', 'the first question reads: ' + q[0]);
    need(q[1] === 'confirm: Really erase all training data and settings?', 'the second question reads: ' + q[1]);
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
    same(page.dialogs.map(plain), ['confirm: Erase all exercises, program, history and settings on this phone?'], 'the question');
    answer.yes = true; page.dialogs.length = 0;
  });
  // Review finding look#5: Reset erases the settings too, the WHOOP connector link among them, as in every version
  // before. The question names them; the link only when the phone has one.
  await run.step(name, 'Reset on a phone linked to a WHOOP connector says the link is erased too', async () => {
    answer.yes = false;
    await page.evaluate(() => { const s = window.__overload.state.settings; s.connUrl = 'https://connector.example'; s.connKey = 'k1'; window.__overload.save(); });
    await lib.openTab(page, 'today'); await lib.openTab(page, 'settings'); await page.click('[data-action="reset"]');
    same(page.dialogs.map(plain), ['confirm: Erase all exercises, program, history and settings on this phone, the WHOOP link included?'], 'the question');
    await page.evaluate(() => { const s = window.__overload.state.settings; delete s.connUrl; delete s.connKey; window.__overload.save(); });
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
    await restore(page, (await removalCopy(page)).id);
    await T.toast(page, /Copy restored|Not saved|cannot be read/);
    const q = plain(page.dialogs[0]).split('\n');
    // Review finding code#6: after Remove the saved foods and targets stay on the phone, so not "everything" is replaced.
    need(q[0] === 'confirm: Replace the training data on this phone with the copy "Before removing the old food log"?', 'the question starts: ' + q[0]);
    need(q[5] === 'The food log in the copy (' + DAYS + ' days) comes with it.', 'the food line reads: ' + q[5]);
    need((await text(page)) === fx.text, 'the stored text is not what it was before the removal');
    await foodIsTheFixtures(page, 'after restoring the removal copy');
    return q[5];
  });
  errors(name, phone); await phone.close();
}

// The phone holds one part of the old food copy and not the other: the question says which part comes from the
// file (T3). keepFoodCopy carries each part the phone has; the file's is used for a part the phone has none of.
async function partsFromFile(browser, server) {
  const name = 'one part on the phone';
  // A log made of quick adds only: food days, but no saved food, meal or target.
  const logOnly = JSON.parse(small.text);
  logOnly.food = { targets: { kcal: null, protein: null, carbs: null, fat: null }, foods: {}, meals: {} };
  {
    const phone = await lib.newPhone(browser, { timezoneId: small.meta.tz, now: small.meta.now });
    await lib.seedV28(phone.context, { state: logOnly, meta: small.meta });
    const page = await lib.openApp(phone.context, server.url + '/index.html');
    await T.copy(page, 'before-split');
    await run.step(name, 'food days but no saved foods: Import says the backup\'s saved foods, meals and targets are used, and they are', async () => {
      await importFile(page, T.writeFile(tmp, 'overload-backup-main-2.json', fx.text));
      await T.toast(page, /Backup restored|Not saved|not an Overload/);
      const q = plain(page.dialogs[0]).split('\n');
      need(q[5] === 'The old food log on this phone (4 days) stays as it is. The saved foods, saved meals and targets in the backup are used, because this phone has none.', 'the food line reads: ' + q[5]);
      const now = JSON.parse(await text(page));
      need(JSON.stringify(now.food) === JSON.stringify(fx.state.food), 'the saved foods are not the backup\'s');
      need(JSON.stringify(now.diary) === JSON.stringify(logOnly.diary), 'the food days are not the phone\'s');
      return q[5];
    });
    errors(name, phone); await phone.close();
  }
  {
    const { phone, page } = await phoneWith(browser, server, { clipboard: true });
    await run.step(name, 'saved foods but no food days (after Remove): Import says the phone\'s saved foods stay and the backup\'s log comes', async () => {
      await lib.openTab(page, 'settings');
      await page.click('[data-action="handover-copy"]'); await T.toast(page, /Food log copied/);
      await page.click('[data-action="handover-remove"]'); await T.toast(page, /Old food log removed/);
      page.dialogs.length = 0;
      await importFile(page, T.writeFile(tmp, 'overload-backup-small-3.json', small.text));
      await T.toast(page, /Backup restored|Not saved|not an Overload/);
      const q = plain(page.dialogs[0]).split('\n');
      need(q[0] === 'confirm: Replace the training data on this phone with the backup?', 'the question starts: ' + q[0]);   // code#6
      need(q[5] === 'The food log in the backup (4 days) comes with it. The saved foods, saved meals and targets on this phone stay as they are; those in the backup are not used.', 'the food line reads: ' + q[5]);
      const now = JSON.parse(await text(page));
      need(JSON.stringify(now.food) === JSON.stringify(fx.state.food), 'the saved foods are not the phone\'s');
      need(JSON.stringify(now.diary) === JSON.stringify(small.state.diary), 'the food days are not the backup\'s');
      return q[5];
    });
    errors(name, phone); await phone.close();
  }
}

// Restore of the copy taken before a removal, or at the split, while the phone holds food days again (v2.8 ran and
// logged food): the copy's log is put together with the phone's, not left out (U3).
async function mergeRestore(browser, server) {
  const name = 'restore puts the logs together';
  const today = fx.meta.today, days = Object.keys(fx.state.diary), gone = fx.state.diary[days[0]][0];
  // What v2.8 leaves when it runs once more: one food logged today, and one entry of the old log deleted (its record).
  const asV28 = (page, opts) => page.evaluate(([key, today, goneId, opts]) => {
    const s = JSON.parse(localStorage.getItem(key));
    (s.diary[today] = s.diary[today] || []).push({ id: 'late1', food: null, meal: 3, qty: null, unit: null, amt: '', name: 'Late snack', brand: '', kcal: 210, p: 4, c: 30, f: 8, at: Date.now() });
    if (opts.del) { Object.keys(s.diary).forEach((d) => { s.diary[d] = s.diary[d].filter((e) => e.id !== goneId); if (!s.diary[d].length) delete s.diary[d]; }); s.deleted.food[goneId] = Date.now(); }
    localStorage.setItem(key, JSON.stringify(s));
    return JSON.stringify(s);
  }, [lib.STATE_KEY, today, gone.id, opts || {}]);
  const reload = async (page) => { await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => !!window.__overload); };
  // The copy's log with the phone's: every day of the copy, the phone's entry today, the deleted entry not back.
  function checkMerged(now, phoneText, what) {
    const phoneSt = JSON.parse(phoneText);
    need(Object.keys(now.diary).length === days.length, what + ': ' + Object.keys(now.diary).length + ' food days, the copy had ' + days.length);
    const late = now.diary[today].filter((e) => e.id === 'late1');
    need(late.length === 1 && JSON.stringify(late[0]) === JSON.stringify(phoneSt.diary[today].find((e) => e.id === 'late1')), what + ': the entry logged on the phone is not there as it was');
    days.forEach((d) => { const want = fx.state.diary[d].filter((e) => !phoneSt.deleted.food[e.id]).map((e) => JSON.stringify(e)); const got = (now.diary[d] || []).filter((e) => e.id !== 'late1').map((e) => JSON.stringify(e)); same(got, want, what + ': day ' + d); });
    return Object.keys(now.diary).length + ' days, ' + Object.values(now.diary).reduce((n, l) => n + l.length, 0) + ' entries';
  }
  {
    const { phone, page } = await phoneWith(browser, server, { clipboard: true });
    await run.step(name, 'after Remove and a food logged in v2.8: Restore of the removal copy says so and brings the log back beside it', async () => {
      await lib.openTab(page, 'settings');
      await page.click('[data-action="handover-copy"]'); await T.toast(page, /Food log copied/);
      await page.click('[data-action="handover-remove"]'); await T.toast(page, /Old food log removed/);
      const phoneText = await asV28(page);
      await reload(page);
      page.dialogs.length = 0;
      await restore(page, (await removalCopy(page)).id);
      await T.toast(page, /Copy restored|Not saved|cannot be read/);
      const q = plain(page.dialogs[0]).split('\n');
      need(q[0] === 'confirm: Replace the training data on this phone with the copy "Before removing the old food log"?', 'the question starts: ' + q[0]);
      need(q[5] === 'The food log in the copy (' + DAYS + ' days) is put together with the old food log on this phone (1 day).', 'the food line reads: ' + q[5]);
      const now = JSON.parse(await text(page));
      const detail = checkMerged(now, phoneText, 'after the restore');
      need(JSON.stringify(now.food) === JSON.stringify(fx.state.food), 'the saved foods changed');
      trainingIs(now, fx.state, 'after the restore');
      const c = await T.copy(page, 'before-restore');
      need(c && c.text === phoneText, 'the copy "Before restore" does not hold what the phone held');
      return detail;
    });
    errors(name, phone); await phone.close();
  }
  {
    const { phone, page } = await phoneWith(browser, server);
    await run.step(name, 'v2.8 logged and deleted food after the split: Restore of the split copy keeps both, and the deletion', async () => {
      const phoneText = await asV28(page, { del: true });
      await reload(page);
      page.dialogs.length = 0;
      await restore(page, 'before-split');
      await T.toast(page, /Copy restored|Not saved|cannot be read/);
      const q = plain(page.dialogs[0]).split('\n');
      need(q[0] === 'confirm: Replace the training data on this phone with the copy "Before the split into two apps"?', 'the question starts: ' + q[0]);
      need(q[5] === 'The food log in the copy (' + DAYS + ' days) is put together with the old food log on this phone (' + Object.keys(JSON.parse(phoneText).diary).length + ' days).', 'the food line reads: ' + q[5]);
      const now = JSON.parse(await text(page));
      const detail = checkMerged(now, phoneText, 'after the restore');
      need(!Object.values(now.diary).some((l) => l.some((e) => e.id === gone.id)) && now.deleted.food[gone.id], 'the entry deleted in v2.8 came back, or its record is gone');
      return detail + '; the deleted entry stays deleted';
    });
    errors(name, phone); await phone.close();
  }
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

// Review findings data#1 and code#3: Restore, Import and Reset wait for the copy of what is here. When it cannot be
// stored (stand-in: the copy store refuses that one write, as a full store does with QuotaExceededError), nothing is
// replaced or erased, and a sheet says so, with Export. With the store working again the same session goes on.
async function copyNotKept(browser, server) {
  const name = 'copy not kept', { phone, page } = await phoneWith(browser, server);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v) { if (v && window.__refuse && v.id === window.__refuse) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return put.apply(this, arguments); };
  });
  need(await page.evaluate((t) => window.__overloadBackup.take('import', t), small.text), 'could not plant a copy');
  const file = T.writeFile(tmp, 'overload-backup-small-4.json', small.text);
  const cases = [
    ['Restore', 'before-restore', 'replaced', 'Restore a copy', () => restore(page, 'before-import')],
    ['Import', 'before-import', 'replaced', 'Import JSON', () => importFile(page, file)],
    ['Reset', 'before-reset', 'erased', 'Reset all data', async () => { await lib.openTab(page, 'settings'); await page.click('[data-action="reset"]'); }]
  ];
  for (const [what, id, did, title, act] of cases) {
    await run.step(name, what + ': its copy cannot be stored, so nothing is ' + did + '; a sheet says so and Export saves a backup', async () => {
      await T.closeSheet(page);
      await page.evaluate((i) => { window.__refuse = i; }, id);
      page.dialogs.length = 0;
      await act();
      await page.waitForFunction(() => !document.querySelector('#sheet').hidden, null, { timeout: 8000 });
      const msg = await T.text(page, '#sheet .banner');
      need(msg === 'The automatic copy could not be stored, so nothing was ' + did + '. Export a backup first, then try again.', 'the sheet says: ' + msg);
      same(await T.text(page, '#sheet .sheet-title h2'), title, 'the sheet\'s title');
      need(page.dialogs.length >= 1, 'no question was asked first');
      need((await text(page)) === fx.text, 'the stored data changed');
      need(await page.evaluate((n) => window.__overload.state.workouts.length === n && window.__overload.state.settings.restSec !== undefined, fx.state.workouts.length), 'the data in memory changed');
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#sheet [data-action="export"]')]);
      need(/^overload-backup-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), 'Export saved ' + dl.suggestedFilename());
      await page.evaluate(() => { window.__refuse = null; });
      return msg;
    });
  }
  await run.step(name, 'with the copy store working again, Reset works in the same session (nothing is left waiting)', async () => {
    await T.closeSheet(page);
    page.dialogs.length = 0;
    await lib.openTab(page, 'settings'); await page.click('[data-action="reset"]');
    await T.toast(page, /Reset to defaults/);
    const c = await T.copy(page, 'before-reset');
    need(c && c.text === fx.text, 'the copy "Before reset" does not hold the data as it was');
    need((await page.evaluate(() => window.__overload.state.workouts.length)) === 0, 'not reset');
  });
  errors(name, phone); await phone.close();
}

// The data changes while its copy is being stored (cloud sync brings some, through setState): the copy would not
// hold that, so nothing is replaced or erased, and the toast says so.
async function changedMeanwhile(browser, server) {
  const name = 'data changed during the copy', { phone, page } = await phoneWith(browser, server);
  need(await page.evaluate((t) => window.__overloadBackup.take('import', t), small.text), 'could not plant a copy');
  await page.evaluate(() => {
    const B = window.__overloadBackup, real = B.take;
    B.take = function () {
      if (window.__bring) { window.__bring = false; const st = JSON.parse(JSON.stringify(window.__overload.state)); st.settings.restSec += 1; window.__overload.setState(st); }
      return real.apply(this, arguments);
    };
  });
  const file = T.writeFile(tmp, 'overload-backup-small-5.json', small.text);
  const cases = [
    ['Restore', 'replaced', () => restore(page, 'before-import')],
    ['Import', 'replaced', () => importFile(page, file)],
    ['Reset', 'erased', async () => { await lib.openTab(page, 'settings'); await page.click('[data-action="reset"]'); }]
  ];
  for (const [what, did, act] of cases) {
    await run.step(name, what + ': the data changed while its copy was stored, so nothing is ' + did + ', and the toast says so', async () => {
      const rest = await page.evaluate(() => window.__overload.state.settings.restSec);
      await page.evaluate(() => { window.__bring = true; document.querySelector('#toast').hidden = true; });
      await act();
      const t = await T.toast(page, /./);
      need(t === 'The training data changed just now. Nothing was ' + did + '.', 'the app said: ' + t);
      const now = JSON.parse(await text(page));
      need(now.settings.restSec === rest + 1 && now.workouts.length === fx.state.workouts.length, 'the data is not what cloud sync brought: restSec ' + now.settings.restSec + ', ' + now.workouts.length + ' workouts');
      return t;
    });
  }
  errors(name, phone); await phone.close();
}

// Review finding code#2: a second tap while a Restore, Import or Reset is under way does nothing. Before, a double
// tap on Restore asked twice, and the second Restore stored the restored data as "Before restore".
async function doubleTaps(browser, server) {
  const name = 'second tap';
  {
    const { phone, page } = await phoneWith(browser, server);
    await run.step(name, 'a double tap on Restore asks once, and "Before restore" holds what was on the phone', async () => {
      need(await page.evaluate((t) => window.__overloadBackup.take('import', t), small.text), 'could not plant a copy');
      await page.evaluate(() => { const s = window.__overload.state; s.settings.restSec = 999; s.program.days[0].name = 'Changed after the copy'; window.__overload.save(); });
      const mine = await text(page);
      await lib.openTab(page, 'settings');
      await page.waitForSelector('[data-action="restore-copy"][data-id="before-import"]', { timeout: 5000 });
      page.dialogs.length = 0;
      await page.dblclick('[data-action="restore-copy"][data-id="before-import"]');
      await T.toast(page, /Copy restored|Not saved|cannot be read|could not/);
      await lib.sleep(1500);
      same(page.dialogs.length, 1, 'the number of questions');
      const c = await T.copy(page, 'before-restore');
      need(c && c.text === mine, '"Before restore" does not hold what was on the phone: restSec ' + (c && JSON.parse(c.text).settings.restSec));
      trainingIs(JSON.parse(await text(page)), small.state, 'after the restore');
      return '1 question; "Before restore" holds restSec 999';
    });
    errors(name, phone); await phone.close();
  }
  {
    const { phone, page } = await phoneWith(browser, server);
    // The copy store takes its time: each take() waits until the test lets it go.
    await page.evaluate(() => { const B = window.__overloadBackup, real = B.take; window.__held = []; B.take = function () { const a = arguments; return new Promise((r) => { window.__held.push(() => r(real.apply(B, a))); }); }; });
    const release = () => page.evaluate(() => { const l = window.__held.splice(0); l.forEach((f) => f()); return l.length; });
    await run.step(name, 'Reset tapped again while its copy is being stored: no more questions, one reset', async () => {
      await lib.openTab(page, 'settings');
      page.dialogs.length = 0;
      await page.click('[data-action="reset"]');
      await page.waitForFunction(() => window.__held.length === 1, null, { timeout: 5000 });
      await page.click('[data-action="reset"]');
      await lib.sleep(300);
      same(page.dialogs.length, 2, 'the number of questions');
      need((await page.evaluate(() => window.__overload.state.workouts.length)) === fx.state.workouts.length, 'erased before its copy was stored');
      same(await release(), 1, 'copies asked for');
      await T.toast(page, /Reset to defaults/);
      need((await page.evaluate(() => window.__overload.state.workouts.length)) === 0, 'not reset');
      const c = await T.copy(page, 'before-reset');
      need(c && c.text === fx.text, 'the copy "Before reset" does not hold the data as it was');
    });
    await run.step(name, 'a second Import while the first one\'s copy is being stored: no question, one import', async () => {
      const file = T.writeFile(tmp, 'overload-backup-main-6.json', fx.text);
      await page.evaluate(() => { document.querySelector('#toast').hidden = true; });
      page.dialogs.length = 0;
      await importFile(page, file);
      await page.waitForFunction(() => window.__held.length === 1, null, { timeout: 5000 });
      await importFile(page, T.writeFile(tmp, 'overload-backup-small-6.json', small.text));
      await lib.sleep(500);
      same(page.dialogs.length, 1, 'the number of questions');
      same(await release(), 1, 'copies asked for');
      await T.toast(page, /Backup restored/);
      trainingIs(JSON.parse(await text(page)), fx.state, 'after the import');
    });
    errors(name, phone); await phone.close();
  }
}

async function signedIn(browser, server) {
  const name = 'signed in to cloud sync', { phone, page, answer } = await phoneWith(browser, server);
  const file = T.writeFile(tmp, 'overload-backup-small-2.json', small.text);
  await run.step(name, 'the questions say the account\'s training data goes too and its food log is not changed', async () => {
    answer.yes = false;   // read the questions, change nothing
    // sync.js cannot load here (its Firebase files are on another host). The stand-in is this release's module (the
    // release backup.js names), signed in and linked: one of another release, signed in without a note of its
    // account, holds Reset, Import and Restore back (review finding v28#1).
    await page.evaluate(() => { window.__overloadSync = { release: window.__overloadBackup.release, user: { email: 'me@example.com', uid: 'u1' }, linked: true }; });
    await lib.openTab(page, 'settings');
    await page.click('[data-action="reset"]');
    await importFile(page, file);
    await page.waitForFunction(() => true); await lib.sleep(300);
    need(await page.evaluate((t) => window.__overloadBackup.take('import', t), small.text), 'could not plant a copy');
    await lib.openTab(page, 'today'); await restore(page, 'before-import');
    await lib.sleep(300);
    const q = page.dialogs.map(plain);
    same(q.length, 3, 'the number of questions');
    const tail = (verb, what) => T.cloudTail(verb, what, 'me@example.com');
    need(q[0].endsWith('It stays on this phone until you remove it in Settings > Food.' + tail('erased')), 'Reset asks: ' + q[0]);
    need(q[1].endsWith('Food in the backup is not used.' + tail('replaced', 'the backup')), 'Import asks: ' + q[1]);
    need(q[2].endsWith('A copy of what is on the phone now is kept first.' + tail('replaced', 'the copy')), 'Restore asks: ' + q[2]);
    need(!q.some((t) => /the copy in your account/.test(t)), 'a question still says the whole copy in the account is replaced');
    need((await text(page)) === fx.text, 'saying no changed the data');
    return tail('replaced', 'the backup').trim();
  });
  errors(name, phone); await phone.close();
}

// Round-5 finding ask#1: this page with v2.8's backup.js, as 2.8's worker can hand it out during the first starts of
// 3.0 (tests/train-release.js runs that with real workers). overload.js uses no copy module of another release, so no
// safety copy can be kept: Reset, Import and Remove the old food log refuse before asking anything (their questions
// promise a copy) and say what helps, and nothing changes. Reset and Import keep their sheet with Export.
async function noCopiesHere(browser, server) {
  const name = 'automatic copies not available';
  const v28Backup = require('child_process').execSync('git -C ' + JSON.stringify(lib.REPO) + ' show ' + T.V28 + ':backup.js').toString();
  const { phone, page } = await phoneWith(browser, server, { setup: (ctx) => ctx.route(/\/backup\.js(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: v28Backup })) });
  const file = T.writeFile(tmp, 'overload-backup-small-5.json', small.text);
  const NOT = (did) => 'Automatic copies are not available right now, so nothing was ' + did + '. Close Overload and open it again with good signal.';
  await run.step(name, 'set-up: the page runs v2.8\'s backup.js, which overload.js does not use (Settings: not available)', async () => {
    need(await page.evaluate(() => !!window.__overloadBackup && !('release' in window.__overloadBackup) && !window.__overloadBackup.KEEP_REMOVALS), 'the backup.js that ran is not v2.8\'s (the check lost its point)');
    await lib.openTab(page, 'settings');
    await page.waitForFunction(() => !/Looking for copies/.test((document.getElementById('safety-copies') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
    same(await T.text(page, '#safety-copies'), 'Automatic copies are not available.', 'the list of copies');
    return 'v2.8\'s backup.js ran';
  });
  for (const [what, did, title, act] of [
    ['Reset', 'erased', 'Reset all data', async () => { await lib.openTab(page, 'settings'); await page.click('[data-action="reset"]'); }],
    ['Import', 'replaced', 'Import JSON', () => importFile(page, file)]
  ]) {
    await run.step(name, what + ': refused before any question, in its sheet with Export: "' + NOT(did) + '"', async () => {
      await T.closeSheet(page);
      page.dialogs.length = 0;
      await act();
      await page.waitForFunction(() => !document.querySelector('#sheet').hidden, null, { timeout: 8000 }).catch(() => {});
      await lib.sleep(300);
      const sheet = await page.evaluate(() => ({ open: !document.querySelector('#sheet').hidden, title: ((document.querySelector('#sheet .sheet-title h2') || {}).textContent || '').trim(), text: ((document.querySelector('#sheet .banner') || {}).textContent || '').trim(), exp: !!document.querySelector('#sheet [data-action="export"]') }));
      const asked = page.dialogs.map((d) => JSON.stringify(plain(d).slice(0, 60)));
      need(!asked.length, 'asked first: ' + asked.join(', ') + '; then the sheet: ' + sheet.text);
      need(sheet.open && sheet.title === title && sheet.text === NOT(did) && sheet.exp, 'the sheet: ' + JSON.stringify(sheet));
      need((await text(page)) === fx.text, 'the stored data changed');
      return sheet.text;
    });
  }
  await run.step(name, 'Remove the old food log: refused before any question, with the toast "' + NOT('removed') + '"', async () => {
    await T.closeSheet(page);
    await lib.openTab(page, 'settings');
    const saved = page.waitForEvent('download', { timeout: 8000 });
    await page.click('[data-action="handover-file"]'); await saved;   // the log saved as a file first, as Remove asks
    page.dialogs.length = 0;
    await page.click('[data-action="handover-remove"]');
    const t = await T.toast(page, /nothing was removed|removed from|could not/);
    const asked = page.dialogs.map((d) => JSON.stringify(plain(d).slice(0, 60)));
    need(!asked.length, 'asked first: ' + asked.join(', ') + '; then: ' + t);
    same(t, NOT('removed'), 'the toast');
    const left = await page.evaluate(() => Object.keys(window.__overload.state.diary).length);
    need(left === DAYS && JSON.stringify(JSON.parse(await text(page)).diary) === JSON.stringify(fx.state.diary), 'food days left: ' + left + ' of ' + DAYS);
    return t;
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
    await partsFromFile(browser, server);
    await mergeRestore(browser, server);
    await fuelFiles(browser, server);
    await copyNotKept(browser, server);
    await changedMeanwhile(browser, server);
    await doubleTaps(browser, server);
    await signedIn(browser, server);
    await noCopiesHere(browser, server);
  } finally { await browser.close(); await server.stop(); T.removeDir(tmp); }
  run.done();
})().catch((e) => { console.error(e); T.removeDir(tmp); process.exit(1); });
