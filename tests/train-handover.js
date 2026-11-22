#!/usr/bin/env node
/* Overload 3.0: handing the food log over to Fuel (the card "Food has moved to Fuel").
 *
 *   node tests/train-handover.js [--port=8403]
 *
 * On the main v2.8 fixture, with a connector key and names outside Latin-1 added to it:
 *   - Copy my food log: the clipboard text decodes (gzip form; plain form with CompressionStream removed; and
 *     when the button is tapped before the text is ready) and holds the food data key by key: food, diary,
 *     deleted.food, units, theme, the latest weigh-in. No other setting, no exercises field, no connKey.
 *   - Save as a file: overload-food-YYYY-MM-DD.json, compact JSON, the same content.
 *   - What was copied when is noted in overload.backup; the saved data does not change.
 *   - The card leaves Today when hidden or done, and comes back when the old food copy changes afterwards
 *     (as when v2.8 runs again during a half-arrived update and food is logged in it).
 *   - Remove the old food log: refused before any copy and after the log changed; after a copy it asks twice,
 *     keeps a safety copy first, empties diary only, leaves food and deleted.food alone, and takes the removed
 *     days off cloud sync's note. Saying no to the question removes nothing.
 *   - Get Fuel: a normal link in a browser, the x-safari-https address in a Home Screen app; Copy link.
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const fs = require('fs');
const lib = require('./lib');
const T = require('./train-common');

const args = T.args();
const PORT = Number(args.port) || 8403;
const run = T.runner('train-handover');
const { need, same } = run;
const SECRET = 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00';   // stands in for settings.connKey
const NOTE = { uid: 'u1', core: 'h1abc.2s', workouts: { w1: 'h1.1' }, days: { '2026-11-20': 'h2.2', '2026-11-21': 'h3.3', '2026-01-01': 'h4.4' } };   // cloud sync's note, as v2.8 leaves it

const fx = lib.loadFixture('v28-state');
// The fixture plus what a hand-over must cope with: a secret in settings, and names btoa() cannot take.
function seedState() {
  const st = JSON.parse(fx.text);
  st.settings.connKey = SECRET;
  st.diary[fx.meta.today][0].name = 'Müsli “extra” 餃子 🍜 ×2';
  st.food.foods[Object.keys(st.food.foods)[0]].name = 'Ελληνικό γιαούρτι 🥛';
  return st;
}
async function phoneWith(browser, opts) {
  opts = opts || {};
  const phone = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
  await phone.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  if (opts.init) await phone.context.addInitScript(opts.init);
  if (opts.state !== null) await lib.seedV28(phone.context, { state: opts.state || seedState(), meta: fx.meta }, { extra: opts.extra });
  return phone;
}
const open = (phone, server, o) => lib.openApp(phone.context, server.url + '/index.html', o);
const reload = async (page) => { await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => !!window.__overload, null, { timeout: 15000 }); };
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const split = async (page) => ((await T.stored(page, 'overload.backup')) || {}).split || {};
const todayCard = (page) => T.count(page, '#handover[data-where="today"] .card');
// Tap Copy my food log and return what reached the clipboard.
async function copyLog(page) {
  await page.evaluate(() => navigator.clipboard.writeText('nothing yet'));
  await page.click('[data-action="handover-copy"]');
  await T.toast(page, /Food log copied|Could not copy/);
  return clip(page);
}
// What v2.8 leaves when it runs once more on this data and a food is logged in it.
async function logFoodAsV28(page) {
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key)), day = Object.keys(s.diary).sort().pop();
    s.diary[day].push(Object.assign({}, s.diary[day][0], { id: 'late' + Date.now().toString(36), name: 'Late snack', at: Date.now() }));
    localStorage.setItem(key, JSON.stringify(s));
  }, lib.STATE_KEY);
  await reload(page);
}

// The payload against the saved data, key by key.
function checkPayload(payload, json, state) {
  same(Object.keys(payload).sort(), ['bodyweight', 'deleted', 'diary', 'food', 'from', 'kind', 'madeAt', 'settings', 'v'], 'the payload\'s fields');
  need(payload.kind === 'overload-food' && payload.v === 1 && payload.from === 'Overload 3.0', 'kind / v / from: ' + [payload.kind, payload.v, payload.from].join(' / '));
  need(typeof payload.madeAt === 'number' && payload.madeAt >= fx.meta.now && payload.madeAt < fx.meta.now + 36e5, 'madeAt is ' + payload.madeAt);
  need(!('exercises' in payload), 'the payload has an exercises field');
  same(Object.keys(payload.food).sort(), ['foods', 'meals', 'targets'], 'food');
  same(payload.food.targets, state.food.targets, 'food.targets');
  same(Object.keys(payload.food.foods), Object.keys(state.food.foods), 'the saved foods\' ids and order');
  Object.keys(state.food.foods).forEach((id) => same(payload.food.foods[id], state.food.foods[id], 'saved food ' + id));
  same(Object.keys(payload.food.meals), Object.keys(state.food.meals), 'the saved meals\' ids and order');
  Object.keys(state.food.meals).forEach((id) => same(payload.food.meals[id], state.food.meals[id], 'saved meal ' + id));
  same(Object.keys(payload.diary), Object.keys(state.diary), 'the diary\'s days and their order');
  Object.keys(state.diary).forEach((d) => same(payload.diary[d], state.diary[d], 'diary day ' + d));
  same(Object.keys(payload.deleted), ['food'], 'deleted');
  same(payload.deleted.food, state.deleted.food, 'deleted.food');
  same(payload.settings, { units: state.settings.units, theme: state.settings.theme }, 'settings (units and theme only)');
  same(payload.bodyweight, T.latestWeighIn(state), 'the latest weigh-in');
  need(!json.includes(SECRET) && !/connKey|connUrl|"reminders"|"workouts"|"presc"|"program"/.test(json), 'the text holds something that is not food (a setting, the connector key, training data)');
  need(json === JSON.stringify(payload), 'the JSON is not compact');
  const entries = Object.keys(payload.diary).reduce((n, d) => n + payload.diary[d].length, 0);
  return Object.keys(payload.diary).length + ' days, ' + entries + ' entries, ' + Object.keys(payload.food.foods).length + ' foods, ' + Object.keys(payload.food.meals).length + ' meals, weigh-in ' + JSON.stringify(payload.bodyweight[0] || null);
}

// --- Copy, file, bookkeeping, the card coming back, Remove ---------------------------------------------
async function mainFlow(browser, server) {
  const name = 'main', step = (title, fn) => run.step(name, title, fn);
  const phone = await phoneWith(browser, { extra: { 'overload.sync.v1': NOTE } });
  const page = await open(phone, server);
  const base = await lib.readStorageText(page, lib.STATE_KEY), state = JSON.parse(base);
  let hash1 = null;

  await step('the seeded data holds the connector key and the odd names, and Today shows the card', async () => {
    need(state.settings.connKey === SECRET && /餃子/.test(state.diary[fx.meta.today][0].name), 'the seed did not reach the app');
    need(await todayCard(page) === 1, 'no card on Today');
    need(/^Food has moved to Fuel/.test(await T.text(page, '#handover .card')), 'the card reads: ' + (await T.text(page, '#handover .card')).slice(0, 80));
    need(/Not copied yet\./.test(await T.text(page, '#handover .card')), 'the card does not say "Not copied yet."');
  });
  await step('Get Fuel is a normal link to fuel/ in a new tab; Copy link copies the address', async () => {
    const a = await page.evaluate(() => { const l = document.querySelector('#handover a.btn'); return { text: l.textContent, href: l.getAttribute('href'), target: l.target }; });
    same(a, { text: 'Get Fuel', href: server.url + '/fuel/', target: '_blank' }, 'the Get Fuel link');
    await page.click('[data-action="handover-link"]'); await T.toast(page, /Link copied/);
    need((await clip(page)) === server.url + '/fuel/', 'the clipboard holds ' + (await clip(page)).slice(0, 80));
    need(/In Safari tap Share, then Add to Home Screen/.test(await T.text(page, '#handover .card')), 'the Add to Home Screen instruction is missing');
    return a.href;
  });
  await step('Remove is not offered before any copy, and refused when asked for anyway', async () => {
    await lib.openTab(page, 'settings');
    need(/^Food has moved to Fuel/.test(await T.text(page, '#handover .card')), 'no Food card in Settings');
    need(!(await T.count(page, '[data-action="handover-remove"]')), 'Remove is offered before any copy');
    await page.evaluate(() => { const b = document.createElement('button'); b.id = 'forced-remove'; b.dataset.action = 'handover-remove'; b.textContent = 'x'; document.querySelector('#app').appendChild(b); });
    await page.click('#forced-remove');
    const t = await T.toast(page, /first|removed/);
    need(t === 'Copy your food log or save it as a file first.', 'the app said: ' + t);
    need(!page.dialogs.length, 'a question was asked: ' + page.dialogs.join(' / '));
    need((await lib.readStorageText(page, lib.STATE_KEY)) === base, 'the data changed');
    need(!(await T.copy(page, 'before-foodremove', 300)), 'a removal copy was taken');
    return t;
  });

  await step('Copy my food log: the clipboard text (gzip form) holds the food data key by key', async () => {
    await lib.openTab(page, 'today');
    const text = await copyLog(page), got = T.decodeFoodText(text);
    need(got.mode === '1', 'the text is not the gzip form: ' + text.slice(0, 20));
    const what = checkPayload(got.payload, got.json, state);
    return text.length + ' characters on the clipboard for ' + got.json.length + ' of JSON; ' + what;
  });
  await step('after the copy the card leaves Today and Settings says "Copied today."', async () => {
    need(await todayCard(page) === 0, 'the card is still on Today');
    await lib.openTab(page, 'settings');
    need(/Copied today\./.test(await T.text(page, '#handover .card')), 'Settings does not say "Copied today."');
    need(/Using cloud sync\? Signing in to Fuel with the same email also brings across the food log your account holds\. This phone may hold more, so copy it from here as well\./.test(await T.text(page, '#handover .card')), 'no line for cloud sync users (the phone holds a sync note)');
  });
  await step('Save as a file: overload-food-YYYY-MM-DD.json, compact, the same content', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="handover-file"]')]);
    need(dl.suggestedFilename() === 'overload-food-' + fx.meta.today + '.json', 'the file is called ' + dl.suggestedFilename());
    const json = fs.readFileSync(await dl.path(), 'utf8');
    const what = checkPayload(JSON.parse(json), json, state);
    await T.toast(page, /saved as a file/);
    need(/Copied today · Saved as a file today\./.test(await T.text(page, '#handover .card')), 'the card does not say "Copied today · Saved as a file today."');
    return dl.suggestedFilename() + ', ' + json.length + ' characters; ' + what;
  });
  await step('what was copied is noted in overload.backup; the saved data did not change', async () => {
    const s = await split(page);
    need(s.copied && typeof s.copied.at === 'number' && typeof s.copied.hash === 'string', 'split.copied is ' + JSON.stringify(s.copied));
    same([s.copied.days, s.copied.entries], [fx.facts.counts.foodDays, fx.facts.counts.foodEntries], 'the days and entries noted');
    need(s.filed && typeof s.filed.at === 'number' && s.filed.hash === s.copied.hash, 'split.filed is ' + JSON.stringify(s.filed));
    same(Object.keys(s).sort(), ['at', 'copied', 'filed'], 'the note');
    hash1 = s.copied.hash;
    need((await lib.readStorageText(page, lib.STATE_KEY)) === base, 'the saved data changed');
    need(!/"split"|"copied"|"dismissed"/.test(base), 'bookkeeping in the saved data');
    return JSON.stringify(s.copied);
  });
  await step('Remove is now offered', async () => { need(await T.count(page, '[data-action="handover-remove"]') === 1, 'Remove is not offered after a copy'); });

  await step('food logged afterwards (v2.8 running once more): the card comes back and says so', async () => {
    await logFoodAsV28(page);
    need(await todayCard(page) === 1, 'the card did not come back on Today');
    const card = await T.text(page, '#handover .card');
    // The file was the last thing made, so the card speaks of the file.
    need(/The food log here changed after you saved it as a file on Sat, Nov 21\. Save it again so Fuel gets the rest\./.test(card), 'the card does not say the log changed: ' + card.slice(0, 260));
    need(card.includes((fx.facts.counts.foodEntries + 1).toLocaleString('en-US') + ' entries'), 'the card does not count the new entry');
    await lib.openTab(page, 'settings');
    need(!(await T.count(page, '[data-action="handover-remove"]')), 'Remove is offered although the copy is out of date');
    need(/The file from Sat, Nov 21 is out of date\./.test(await T.text(page, '#handover .card')), 'Settings does not say the file is out of date');
  });
  let before = null, state2 = null;
  await step('copied again: the text holds the new entry, the card leaves Today, Remove is back', async () => {
    before = await lib.readStorageText(page, lib.STATE_KEY); state2 = JSON.parse(before);
    const got = T.decodeFoodText(await copyLog(page));
    checkPayload(got.payload, got.json, state2);
    const s = await split(page);
    need(s.copied.hash !== hash1 && s.copied.entries === fx.facts.counts.foodEntries + 1, 'the note was not renewed: ' + JSON.stringify(s.copied));
    need(await T.count(page, '[data-action="handover-remove"]') === 1, 'Remove is not offered');
    await lib.openTab(page, 'today');
    need(await todayCard(page) === 0, 'the card is still on Today');
    return JSON.stringify(s.copied);
  });

  await step('Remove asks twice, keeps a safety copy first, and empties diary only', async () => {
    await lib.openTab(page, 'settings');
    page.dialogs.length = 0;
    await page.click('[data-action="handover-remove"]');
    const t = await T.toast(page, /removed|Not saved|could not|changed/);
    need(t === 'Old food log removed from Overload', 'the app said: ' + t);
    need(page.dialogs.length === 2 && /^confirm: Remove the old food log from Overload\?/.test(page.dialogs[0]) && /^confirm: Really remove the old food log from Overload\?/.test(page.dialogs[1]), 'the questions were: ' + page.dialogs.join(' / '));
    need(/110 days of food \(1,577 entries\)/.test(page.dialogs[0]) && /A safety copy is kept first/.test(page.dialogs[0]), 'the first question reads: ' + page.dialogs[0]);
    const after = JSON.parse(await lib.readStorageText(page, lib.STATE_KEY));
    same(after.diary, {}, 'diary');
    need(JSON.stringify(after.food) === JSON.stringify(state2.food), 'food changed');
    need(JSON.stringify(after.deleted) === JSON.stringify(state2.deleted), 'deleted changed');
    same(Object.keys(after), Object.keys(state2), 'the fields of the saved data');
    need(JSON.stringify(Object.assign({}, after, { diary: state2.diary })) === before, 'something besides diary changed');
    const c = await T.copy(page, 'before-foodremove'), s = await split(page);
    need(c && c.kind === 'foodremove' && c.text === before, 'the safety copy does not hold the data as it was before the removal');
    need(s.removed && typeof s.removed.at === 'number' && c.at <= s.removed.at, 'split.removed is ' + JSON.stringify(s.removed) + ', the copy is from ' + c.at);
    return 'diary emptied; ' + Object.keys(after.food.foods).length + ' saved foods and ' + Object.keys(after.deleted.food).length + ' deletion records kept; safety copy of ' + c.chars + ' characters';
  });
  await step('after the removal: no card on Today, Settings says so and lists the safety copy, the sync note forgot the days', async () => {
    const card = await T.text(page, '#handover .card');
    need(/^Food is logged in a separate app, Fuel\. The old food log was removed from Overload on Sat, Nov 21\./.test(card), 'Settings reads: ' + card.slice(0, 160));
    need(!(await T.count(page, '[data-action="handover-copy"], [data-action="handover-remove"]')), 'Copy or Remove still offered');
    await page.waitForFunction(() => /Before removing the old food log/.test(document.querySelector('#safety-copies').textContent), null, { timeout: 5000 });
    same(await T.stored(page, 'overload.sync.v1'), Object.assign({}, NOTE, { days: {} }), 'cloud sync\'s note');
    await lib.openTab(page, 'today');
    need(await todayCard(page) === 0, 'a card on Today after the removal');
    await reload(page);
    need(await todayCard(page) === 0, 'a card on Today after the removal and a restart');
    same((await T.stored(page, lib.STATE_KEY)).diary, {}, 'diary after a restart');
  });
  await step('food logged after the removal (v2.8 once more): the card is back', async () => {
    await page.evaluate((key) => { const s = JSON.parse(localStorage.getItem(key)); s.diary['2026-11-22'] = [{ id: 'again1', food: null, meal: 0, qty: null, unit: null, amt: '', name: 'Coffee', brand: '', kcal: 5, p: 0, c: 1, f: 0, at: Date.now() }]; localStorage.setItem(key, JSON.stringify(s)); }, lib.STATE_KEY);
    await reload(page);
    need(await todayCard(page) === 1, 'the card did not come back');
    need(/1 day, 1 entry/.test(await T.text(page, '#handover .card')), 'the card reads: ' + (await T.text(page, '#handover .card')).slice(0, 200));
  });

  const problems = phone.problems();
  run.say(!problems.length, name, 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
  await phone.close();
}

// --- The plain form, where the browser cannot gzip ------------------------------------------------------
async function plainForm(browser, server) {
  const name = 'no CompressionStream';
  const phone = await phoneWith(browser, { init: () => { try { delete window.CompressionStream; } catch (e) { /* below */ } if (window.CompressionStream) window.CompressionStream = undefined; } });
  const page = await open(phone, server);
  await run.step(name, 'Copy my food log: the plain form decodes to the same food data', async () => {
    need(await page.evaluate(() => !window.CompressionStream), 'CompressionStream is still there');
    const state = JSON.parse(await lib.readStorageText(page, lib.STATE_KEY));
    await lib.openTab(page, 'settings');
    const text = await copyLog(page), got = T.decodeFoodText(text);
    need(got.mode === '0', 'the text is not the plain form: ' + text.slice(0, 20));
    return text.length + ' characters; ' + checkPayload(got.payload, got.json, state);
  });
  const problems = phone.problems();
  run.say(!problems.length, name, 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
  await phone.close();
}

// --- Tapped before the text is ready (gzip made slow) ----------------------------------------------------
async function earlyTap(browser, server) {
  const name = 'early tap';
  const phone = await phoneWith(browser, { init: () => { const real = Response.prototype.arrayBuffer; Response.prototype.arrayBuffer = function () { return new Promise((r) => setTimeout(r, 1500)).then(() => real.call(this)); }; } });
  const page = await open(phone, server);
  await run.step(name, 'a tap on Copy while the text is still being made copies it all the same', async () => {
    const state = JSON.parse(await lib.readStorageText(page, lib.STATE_KEY));
    const t0 = Date.now(), got = T.decodeFoodText(await copyLog(page)), took = Date.now() - t0;
    need(took > 500, 'the text was ready at the tap (' + took + ' ms): this run did not test the early tap');
    need(got.mode === '1', 'not the gzip form');
    need((await split(page)).copied, 'the copy was not noted');
    return checkPayload(got.payload, got.json, state);
  });
  const problems = phone.problems();
  run.say(!problems.length, name, 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
  await phone.close();
}

// --- Hide on Today -------------------------------------------------------------------------------------
async function hideFlow(browser, server) {
  const name = 'hide', step = (title, fn) => run.step(name, title, fn);
  const phone = await phoneWith(browser, { state: JSON.parse(fx.text) });
  const page = await open(phone, server);
  await step('the card leaves Today when hidden, stays hidden after a restart, and stays in Settings', async () => {
    need(await todayCard(page) === 1, 'no card on Today');
    await page.click('[data-action="handover-hide"]');
    need(await todayCard(page) === 0, 'the card is still on Today');
    const s = await split(page);
    need(typeof s.dismissed === 'string' && s.dismissed && !s.copied, 'split is ' + JSON.stringify(s));
    need((await lib.readStorageText(page, lib.STATE_KEY)) === fx.text, 'hiding the card changed the saved data');
    await reload(page);
    need(await todayCard(page) === 0, 'the card is back after a restart');
    await lib.openTab(page, 'settings');
    need(/^Food has moved to Fuel/.test(await T.text(page, '#handover .card')) && await T.count(page, '[data-action="handover-copy"]') === 1, 'the card is not in Settings');
    need(!(await T.count(page, '#handover [data-action="handover-hide"]')), 'the Settings card can be hidden');
    need(!/Using cloud sync/.test(await T.text(page, '#handover .card')), 'the cloud sync line shows on a phone that never synced');
    return 'dismissed: ' + s.dismissed;
  });
  await step('the old food copy changes afterwards: the card is back on Today', async () => {
    await logFoodAsV28(page);
    need(await todayCard(page) === 1, 'the card did not come back');
    need(!/changed after you copied/.test(await T.text(page, '#handover .card')), 'the card speaks of a copy that was never made');
  });
  await step('signed in, and sync.js says the account holds the whole food log: the card says signing in is enough', async () => {
    await page.evaluate(() => { window.__overloadSync = { user: { email: 'me@example.com', uid: 'u1' }, foodInCloud: true }; });   // a stand-in: sync.js cannot load in tests
    await lib.openTab(page, 'settings');
    need(/Using cloud sync\? Your whole food log is in your account\. Signing in to Fuel with the same email brings it across too\./.test(await T.text(page, '#handover .card')), 'the card reads: ' + (await T.text(page, '#handover .card')).slice(-260));
    await page.evaluate(() => { window.__overloadSync.foodInCloud = false; });
    await lib.openTab(page, 'today'); await lib.openTab(page, 'settings');
    need(/This phone may hold more, so copy it from here as well\./.test(await T.text(page, '#handover .card')), 'the card does not ask for a copy when the account may be behind');
  });
  const problems = phone.problems();
  run.say(!problems.length, name, 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
  await phone.close();
}

// --- Saying no to Remove ---------------------------------------------------------------------------------
async function declined(browser, server) {
  const name = 'remove declined';
  const phone = await phoneWith(browser, { state: JSON.parse(fx.text) });
  const answers = [];
  const page = await open(phone, server, { dialogs: (d) => { answers.push(d.message()); return answers.length === 1 ? d.accept() : d.dismiss(); } });
  await run.step(name, 'yes to the first question and no to the second removes nothing', async () => {
    await lib.openTab(page, 'settings');
    await copyLog(page);
    await page.click('[data-action="handover-remove"]');
    await lib.sleep(800);
    need(answers.length === 2, answers.length + ' questions asked');
    need((await lib.readStorageText(page, lib.STATE_KEY)) === fx.text, 'the data changed');
    need(!(await T.copy(page, 'before-foodremove', 0)), 'a removal copy was taken');
    need(!(await split(page)).removed, 'a removal was noted');
    need(await T.count(page, '[data-action="handover-remove"]') === 1, 'Remove is no longer offered');
  });
  await phone.close();
}

// --- A Home Screen app on an iPhone ----------------------------------------------------------------------
async function standalone(browser, server) {
  const name = 'Home Screen app';
  const phone = await phoneWith(browser, { state: JSON.parse(fx.text), init: () => { Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true }); } });
  const page = await open(phone, server);
  await run.step(name, 'Get Fuel uses the x-safari-https address; Copy link gives the plain one', async () => {
    const a = await page.evaluate(() => { const l = document.querySelector('#handover a.btn'); return { href: l.getAttribute('href'), target: l.getAttribute('target') }; });
    same(a, { href: 'x-safari-https://127.0.0.1:' + PORT + '/fuel/', target: null }, 'the Get Fuel link');
    await page.click('[data-action="handover-link"]'); await T.toast(page, /Link copied/);
    need((await clip(page)) === server.url + '/fuel/', 'the clipboard holds ' + (await clip(page)).slice(0, 80));
    return a.href;
  });
  await phone.close();
}

// --- The light user: no targets, no favourites ------------------------------------------------------------
async function smallUser(browser, server) {
  const name = 'v28-state-small', sm = lib.loadFixture(name);
  const phone = await lib.newPhone(browser, { timezoneId: sm.meta.tz, now: sm.meta.now });
  await phone.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await lib.seedV28(phone.context, sm);
  const page = await open(phone, server);
  await run.step(name, 'Copy my food log holds the light user\'s food data key by key', async () => {
    const got = T.decodeFoodText(await copyLog(page));
    same(got.payload.food.targets, { kcal: null, protein: null, carbs: null, fat: null }, 'the targets');
    return checkPayload(got.payload, got.json, sm.state);
  });
  await run.step(name, 'food logged after the copy: the card comes back and asks for another copy', async () => {
    need(await todayCard(page) === 0, 'the card is still on Today after the copy');
    await logFoodAsV28(page);
    const card = await T.text(page, '#handover .card');
    need(/The food log here changed after you copied it on Sat, Nov 21\. Copy it again so Fuel gets the rest\./.test(card || ''), 'the card reads: ' + String(card).slice(0, 260));
    need(/The copy from Sat, Nov 21 is out of date\./.test(card), 'the card does not say the copy is out of date');
  });
  const problems = phone.problems();
  run.say(!problems.length, name, 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
  await phone.close();
}

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    await mainFlow(browser, server);
    await plainForm(browser, server);
    await earlyTap(browser, server);
    await hideFlow(browser, server);
    await declined(browser, server);
    await standalone(browser, server);
    await smallUser(browser, server);
  } finally { await browser.close(); await server.stop(); }
  run.done();
})().catch((e) => { console.error(e); process.exit(1); });
