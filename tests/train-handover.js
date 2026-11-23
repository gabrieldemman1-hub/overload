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
// The copies taken before "Remove the old food log", newest first (each removal has one of its own).
const removalCopies = async (page) => (await T.copies(page)).filter((m) => m.kind === 'foodremove');
// The short card Today keeps after a copy or a file: its text, its link and its keys.
const shortCard = (page) => page.evaluate(() => {
  const c = document.querySelector('#handover[data-where="today"] .card'); if (!c) return null;
  const link = c.querySelector('a.btn');
  const msg = c.querySelector(':scope > p.small');
  return { text: msg ? msg.textContent : null, title: (c.querySelector('.handover-head b') || {}).textContent || null, getFuel: link ? link.textContent : null, href: link ? link.getAttribute('href') : null,
    keys: [...c.querySelectorAll('button[data-action]')].map((b) => b.dataset.action + ':' + b.textContent.trim()) };
});
const COPIED = 'Copied. Open Fuel and tap Paste from Overload.', FILED = 'Saved as a file. Open Fuel and tap Choose a file.';
const CLOUD_LINE = 'Using cloud sync? Copy the food log or save it as a file from here as well. Signing in to Fuel with the same email may bring some of it across, but not always all of it.';
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
    await lib.sleep(300);
    need(!(await removalCopies(page)).length, 'a removal copy was taken');
    return t;
  });

  await step('Copy my food log: the clipboard text (gzip form) holds the food data key by key', async () => {
    await lib.openTab(page, 'today');
    const text = await copyLog(page), got = T.decodeFoodText(text);
    need(got.mode === '1', 'the text is not the gzip form: ' + text.slice(0, 20));
    const what = checkPayload(got.payload, got.json, state);
    return text.length + ' characters on the clipboard for ' + got.json.length + ' of JSON; ' + what;
  });
  await step('after the copy Today keeps a short card: what to do next, Get Fuel, Copy link, Copy again (H2)', async () => {
    const c = await shortCard(page);
    need(c, 'no card on Today after the copy');
    need(c.text === COPIED && c.title === 'Food has moved to Fuel', 'the short card reads: ' + c.title + ' / ' + c.text);
    same([c.getFuel, c.href], ['Get Fuel', server.url + '/fuel/'], 'its Get Fuel link');
    same(c.keys, ['handover-hide:', 'handover-link:Copy link', 'handover-copy:Copy again'], 'its keys');
    await reload(page);
    need((await shortCard(page) || {}).text === COPIED, 'the short card is gone after a restart');
    return c.text;
  });
  await step('Copy again on the short card copies the same text again; Settings says "Copied today."', async () => {
    await page.evaluate(() => navigator.clipboard.writeText('nothing yet'));
    await page.click('#handover[data-where="today"] [data-action="handover-copy"]');
    await T.toast(page, /Food log copied/);
    checkPayload(T.decodeFoodText(await clip(page)).payload, T.decodeFoodText(await clip(page)).json, state);
    need((await shortCard(page) || {}).text === COPIED, 'the short card changed');
    await lib.openTab(page, 'settings');
    need(/Copied today\./.test(await T.text(page, '#handover .card')), 'Settings does not say "Copied today."');
    const card = await T.text(page, '#handover .card');
    need(card.includes(CLOUD_LINE), 'the line for cloud sync users (the phone holds a sync note) reads: ' + (card.match(/Using cloud sync\?[^]*$/) || [''])[0].slice(0, 200));
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
  await step('copied again: the text holds the new entry, Today has the short card again, Remove is back', async () => {
    before = await lib.readStorageText(page, lib.STATE_KEY); state2 = JSON.parse(before);
    const got = T.decodeFoodText(await copyLog(page));
    checkPayload(got.payload, got.json, state2);
    const s = await split(page);
    need(s.copied.hash !== hash1 && s.copied.entries === fx.facts.counts.foodEntries + 1, 'the note was not renewed: ' + JSON.stringify(s.copied));
    need(await T.count(page, '[data-action="handover-remove"]') === 1, 'Remove is not offered');
    await lib.openTab(page, 'today');
    need((await shortCard(page) || {}).text === COPIED, 'Today does not show the short card');
    need(!(await T.count(page, '#handover[data-where="today"] [data-action="handover-remove"]')), 'Remove is offered on Today');
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
    const list = await removalCopies(page);
    need(list.length === 1 && /^before-foodremove-\d+$/.test(list[0].id), 'the removal copies are ' + JSON.stringify(list.map((m) => m.id)));
    const c = await T.copy(page, list[0].id), s = await split(page);
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
  await step('signed in: the card always asks for a copy or a file, also when sync.js says the account holds the log (S4)', async () => {
    await page.evaluate(() => { window.__overloadSync = { user: { email: 'me@example.com', uid: 'u1' }, foodInCloud: true }; });   // a stand-in: sync.js cannot load in tests
    await lib.openTab(page, 'settings');
    let card = await T.text(page, '#handover .card');
    need(card.includes(CLOUD_LINE), 'with foodInCloud true the card reads: ' + card.slice(-260));
    need(!/whole food log is in your account|brings it across too/.test(card), 'the card still says signing in to Fuel brings the whole log across');
    await page.evaluate(() => { window.__overloadSync.foodInCloud = false; });
    await lib.openTab(page, 'today'); await lib.openTab(page, 'settings');
    card = await T.text(page, '#handover .card');
    need(card.includes(CLOUD_LINE), 'with foodInCloud false the card reads: ' + card.slice(-260));
    return CLOUD_LINE;
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
    need(!(await removalCopies(page)).length, 'a removal copy was taken');
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
  await run.step(name, 'food logged after the copy: the card comes back in full and asks for another copy', async () => {
    need((await shortCard(page) || {}).text === COPIED, 'Today does not show the short card after the copy');
    await logFoodAsV28(page);
    const card = await T.text(page, '#handover .card');
    need(/The food log here changed after you copied it on Sat, Nov 21\. Copy it again so Fuel gets the rest\./.test(card || ''), 'the card reads: ' + String(card).slice(0, 260));
    need(/The copy from Sat, Nov 21 is out of date\./.test(card), 'the card does not say the copy is out of date');
  });
  const problems = phone.problems();
  run.say(!problems.length, name, 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
  await phone.close();
}

// --- Today after Save as a file, and hiding the short card (H2) ------------------------------------------
async function shortAfterFile(browser, server) {
  const name = 'short card', step = (title, fn) => run.step(name, title, fn);
  const phone = await phoneWith(browser, { state: JSON.parse(fx.text) });
  const page = await open(phone, server);
  await step('Save as a file on Today: the short card says to choose the file in Fuel, with Save again', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#handover[data-where="today"] [data-action="handover-file"]')]);
    need(/^overload-food-/.test(dl.suggestedFilename()), 'no file');
    await T.toast(page, /saved as a file/);
    const c = await shortCard(page);
    need(c && c.text === FILED, 'the short card reads: ' + (c ? c.text : '(none)'));
    same(c.keys, ['handover-hide:', 'handover-link:Copy link', 'handover-file:Save again'], 'its keys');
    need(c.getFuel === 'Get Fuel', 'no Get Fuel link');
    return c.text;
  });
  await step('then Copy my food log in Settings: the short card speaks of the copy, the newer of the two', async () => {
    await lib.openTab(page, 'settings'); await copyLog(page); await lib.openTab(page, 'today');
    need((await shortCard(page) || {}).text === COPIED, 'the short card reads: ' + ((await shortCard(page)) || {}).text);
  });
  await step('hidden, the short card stays away after a restart; the full card is still in Settings', async () => {
    await page.click('#handover[data-where="today"] [data-action="handover-hide"]');
    need((await T.toast(page, /Hidden/)) === 'Hidden here. It stays in Settings > Food.', 'the toast');
    need(await todayCard(page) === 0, 'the card is still on Today');
    await reload(page);
    need(await todayCard(page) === 0, 'the card is back after a restart');
    await lib.openTab(page, 'settings');
    need(/^Food has moved to Fuel/.test(await T.text(page, '#handover .card')) && /Copied today/.test(await T.text(page, '#handover .card')), 'Settings lost the card');
  });
  await step('a double tap on Copy my food log on Today: the second tap lands on the short card, nothing else opens', async () => {
    const p2 = await open(await phoneWith(browser, { state: JSON.parse(fx.text) }), server);
    await p2.evaluate(() => window.__overload._handover.text());
    const btn = p2.locator('#handover[data-where="today"] [data-action="handover-copy"]');
    await btn.scrollIntoViewIfNeeded();
    const box = await btn.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    await p2.mouse.click(x, y);
    await T.toast(p2, /Food log copied/);
    const under = await p2.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y), b = e && e.closest('[data-action], a, .card'); return b ? (b.dataset.action || b.className) + ' ' + b.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) : 'nothing'; }, [x, y]);
    await p2.mouse.click(x, y);
    await lib.sleep(400);
    need(await p2.evaluate(() => document.querySelector('#sheet').hidden), 'a sheet opened under the second tap (' + under + ')');
    need(/^handover-copy |^card handover/.test(under), 'the second tap lands on ' + under);
    await p2.context().close();
    return 'second tap on: ' + under;
  });
  const problems = phone.problems();
  run.say(!problems.length, name, 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
  await phone.close();
}

// --- What the clipboard text carries, made again when the weigh-in or the theme changed (H3) -----------
async function freshText(browser, server) {
  const name = 'weigh-in and theme';
  const st = JSON.parse(fx.text);
  st.bodyweight = st.bodyweight.filter((b) => b.date !== fx.meta.today);   // this morning's weigh-in is not done yet
  const phone = await phoneWith(browser, { state: st });
  const page = await open(phone, server);
  await run.step(name, 'a weigh-in and a new theme in the same session reach the clipboard text; madeAt is when it was made', async () => {
    const first = T.decodeFoodText(await page.evaluate(() => window.__overload._handover.text())).payload;   // ready, as a moment after the card is drawn
    need(first.bodyweight[0].date !== fx.meta.today && first.settings.theme === 'dark', 'the first text: ' + JSON.stringify([first.bodyweight, first.settings]));
    await page.clock.runFor(60000);
    await page.fill('#bw-form input[name="weight"]', '179.4');
    await page.click('#bw-form button[type="submit"]');
    await lib.openTab(page, 'settings');
    const changedAt = await page.evaluate(() => Date.now());
    await page.click('[data-action="set-theme"][data-v="light"]');
    await lib.openTab(page, 'today');
    const got = T.decodeFoodText(await copyLog(page)).payload;
    same(got.bodyweight, [{ date: fx.meta.today, weight: 179.4 }], 'the weigh-in in the text');
    need(got.settings.theme === 'light', 'the theme in the text is ' + got.settings.theme);
    need(got.madeAt >= changedAt, 'madeAt is ' + (changedAt - got.madeAt) + ' ms before the change');
    same(got.diary, st.diary, 'the diary');
    return JSON.stringify(got.bodyweight) + ', theme ' + got.settings.theme;
  });
  const problems = phone.problems();
  run.say(!problems.length, name, 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
  await phone.close();
}

// --- A phone whose storage is full: the note of the copy is kept in memory (U4) --------------------------
// A stand-in quota: setItem throws QuotaExceededError once keys + values would pass what v2.8 left plus 20
// characters, the old value staying in place, as browsers do.
const FULL = (slack) => {
  if (window.top !== window) return;
  const used = () => { let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('__t')) continue; n += k.length + localStorage.getItem(k).length; } return n; };
  const real = Storage.prototype.setItem;
  let limit = null;
  Storage.prototype.setItem = function (k, v) {
    if (this !== localStorage || k.startsWith('__t')) return real.apply(this, arguments);
    if (limit == null) { limit = +localStorage.getItem('__t.limit') || (used() + slack); real.call(localStorage, '__t.limit', String(limit)); }
    const old = localStorage.getItem(k), next = used() - (old == null ? 0 : k.length + old.length) + k.length + String(v).length;
    if (next > limit) throw new DOMException('quota', 'QuotaExceededError');
    return real.apply(this, arguments);
  };
};
async function storageFull(browser, server) {
  const name = 'storage full', step = (title, fn) => run.step(name, title, fn);
  const phone = await phoneWith(browser, { state: JSON.parse(fx.text) });
  await phone.context.addInitScript(FULL, 20);
  const page = await open(phone, server);
  await step('the stored note of the split could not be written (the stand-in quota works)', async () => {
    await T.copy(page, 'before-split'); await lib.sleep(300);
    need(!(await split(page)).at, 'split.at was stored: the quota stand-in did not hold');
    need((await lib.readStorageText(page, lib.STATE_KEY)) === fx.text, 'the data changed');
  });
  await step('Copy my food log: the card says "Copied today." and Remove is offered, though nothing could be noted', async () => {
    await lib.openTab(page, 'settings');
    const t = T.decodeFoodText(await copyLog(page));
    need(t.payload.diary && Object.keys(t.payload.diary).length === fx.facts.counts.foodDays, 'the clipboard text');
    need(!(await split(page)).copied, 'the note reached storage: the stand-in did not hold');
    need(/Copied today\./.test(await T.text(page, '#handover .card')), 'the card says: ' + ((await T.text(page, '#handover .card')).match(/(Not copied yet|Copied [a-z]+)\./) || ['?'])[0]);
    need(await T.count(page, '[data-action="handover-remove"]') === 1, 'Remove is not offered');
  });
  await step('Save as a file: the card says so as well', async () => {
    await Promise.all([page.waitForEvent('download'), page.click('[data-action="handover-file"]')]);
    await T.toast(page, /saved as a file/);
    need(/Copied today · Saved as a file today\./.test(await T.text(page, '#handover .card')), 'the card: ' + (await T.text(page, '#handover .card')).slice(0, 300));
  });
  await step('Remove frees the room, and then the whole note is stored', async () => {
    await page.click('[data-action="handover-remove"]');
    need((await T.toast(page, /removed|Not saved|could not|changed/)) === 'Old food log removed from Overload', 'the toast: ' + await T.text(page, '#toast'));
    const s = await split(page);
    need(s.copied && s.filed && s.removed && s.at, 'the stored note: ' + JSON.stringify(s));
    same(JSON.parse(await lib.readStorageText(page, lib.STATE_KEY)).diary, {}, 'the diary');
    return Object.keys(s).join(', ');
  });
  const problems = phone.problems();
  run.say(!problems.length, name, 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
  await phone.close();
}

// --- The share sheet (U5, T1). Chromium here has no share sheet: navigator.canShare and navigator.share are
// stand-ins that behave as the Web Share standard says (a share stays pending while the sheet is open, a second
// share() meanwhile is rejected with InvalidStateError, a cancel rejects with AbortError). __shareMode picks
// what the next sheet does: 'hold' (until __endShare(result)), or an error name to reject with at once.
const SHARE = () => {
  let open = null;
  window.__shares = []; window.__shareMode = 'hold';
  navigator.canShare = (d) => !window.__noShare && !!(d && d.files);
  navigator.share = (data) => {
    if (open) { window.__shares.push('second: InvalidStateError'); return Promise.reject(new DOMException('An earlier share has not yet completed.', 'InvalidStateError')); }
    const name = data.files && data.files[0] && data.files[0].name;
    if (window.__shareMode !== 'hold') { window.__shares.push(name + ': ' + window.__shareMode); return Promise.reject(new DOMException('no', window.__shareMode)); }
    window.__shares.push(name + ': sheet open');
    return new Promise((resolve, reject) => { open = { resolve, reject }; });
  };
  window.__endShare = (how) => { if (!open) return; const o = open; open = null; window.__shares.push('sheet ' + how); if (how === 'saved') o.resolve(); else o.reject(new DOMException('Share canceled', 'AbortError')); };
};
async function shareSheet(browser, server) {
  const name = 'share sheet', step = (title, fn) => run.step(name, title, fn);
  const phone = await phoneWith(browser, { state: JSON.parse(fx.text), init: SHARE });
  const page = await open(phone, server);
  let downloads = 0; page.on('download', (d) => { downloads++; d.cancel().catch(() => {}); });
  const shares = () => page.evaluate(() => window.__shares.splice(0));
  await lib.openTab(page, 'settings');
  await step('Save as a file tapped twice, then the sheet cancelled: one sheet, nothing saved, nothing noted, no Remove', async () => {
    await page.evaluate(() => { const b = document.querySelector('[data-action="handover-file"]'); b.click(); b.click(); });
    await lib.sleep(300);
    await page.evaluate(() => window.__endShare('cancelled'));
    await lib.sleep(300);
    const seen = await shares();
    same(seen, ['overload-food-' + fx.meta.today + '.json: sheet open', 'sheet cancelled'], 'what the share sheet saw');
    need(!downloads, downloads + ' downloads started');
    need(!(await split(page)).filed, 'noted as saved: ' + JSON.stringify((await split(page)).filed));
    need(/Not copied yet\./.test(await T.text(page, '#handover .card')) && !(await T.count(page, '[data-action="handover-remove"]')), 'the card says it was saved, or Remove is offered');
    return seen.join(' -> ');
  });
  for (const err of ['InvalidStateError', 'NotAllowedError']) {
    await step('the sheet refuses with ' + err + ': treated as a cancel (no download, nothing noted)', async () => {
      await page.evaluate((e) => { window.__shareMode = e; }, err);
      await page.click('[data-action="handover-file"]'); await lib.sleep(400);
      await page.evaluate(() => { window.__shareMode = 'hold'; });
      need(!downloads, downloads + ' downloads started');
      need(!(await split(page)).filed, 'noted as saved');
      return (await shares()).join(' -> ');
    });
  }
  await step('another failure of the sheet: the download is still offered, but not counted as saved', async () => {
    await page.evaluate(() => { window.__shareMode = 'DataError'; });
    await page.click('[data-action="handover-file"]'); await lib.sleep(600);
    await page.evaluate(() => { window.__shareMode = 'hold'; });
    need(downloads === 1, downloads + ' downloads');
    need(!(await split(page)).filed, 'noted as saved');
    downloads = 0; await shares();
  });
  await step('the sheet finishes: noted once, the card says so and offers Remove', async () => {
    await page.click('[data-action="handover-file"]'); await lib.sleep(200);
    await page.click('[data-action="handover-file"]'); await lib.sleep(200);   // a second tap while it is open: ignored
    await page.evaluate(() => window.__endShare('saved'));
    await T.toast(page, /saved as a file/);
    const s = await split(page);
    need(s.filed && s.filed.at, 'not noted');
    need(/Saved as a file today\./.test(await T.text(page, '#handover .card')) && await T.count(page, '[data-action="handover-remove"]') === 1, 'the card');
    need(!downloads, 'a download started');
    return (await shares()).join(' -> ');
  });
  await step('Export JSON tapped twice and cancelled: one sheet, the last export is not noted', async () => {
    const was = ((await T.stored(page, 'overload.backup')) || {}).lastExport;
    await page.evaluate(() => { const b = document.querySelector('[data-action="export"]'); b.click(); b.click(); });
    await lib.sleep(300);
    await page.evaluate(() => window.__endShare('cancelled'));
    await lib.sleep(300);
    const seen = await shares();
    need(seen.length === 2 && /^overload-backup-.*: sheet open$/.test(seen[0]), 'what the share sheet saw: ' + seen.join(' -> '));
    need(((await T.stored(page, 'overload.backup')) || {}).lastExport === was && !downloads, 'the export was noted, or a download started');
    return seen.join(' -> ');
  });
  await step('a phone whose share sheet cannot take files: the download is the way, and it counts', async () => {
    await page.evaluate(() => { window.__noShare = true; });
    const was = ((await T.stored(page, 'overload.backup')) || {}).lastExport;
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
    need(/^overload-backup-/.test(dl.suggestedFilename()), 'no export file');
    await lib.sleep(200);
    need(((await T.stored(page, 'overload.backup')) || {}).lastExport > was, 'the export was not noted');
  });
  const problems = phone.problems();
  run.say(!problems.length, name, 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
  await phone.close();
}

// --- Several removals: each keeps a safety copy of its own, the last three are kept (U3) -------------------
async function removals(browser, server) {
  const name = 'several removals', step = (title, fn) => run.step(name, title, fn);
  const sm = lib.loadFixture('v28-state-small');
  const phone = await lib.newPhone(browser, { timezoneId: sm.meta.tz, now: sm.meta.now });
  await phone.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await lib.seedV28(phone.context, sm);
  const page = await open(phone, server);
  await T.copy(page, 'before-split');
  const texts = [];
  // One removal: the log as v2.8 would have it (one food logged in it), copied, removed.
  const removeOnce = async (i) => {
    if (i) await page.evaluate(([key, i]) => { const s = JSON.parse(localStorage.getItem(key)); s.diary['2026-11-' + (10 + i)] = [{ id: 'again' + i, food: null, meal: 0, qty: null, unit: null, amt: '', name: 'Logged in v2.8, ' + i, brand: '', kcal: 100 + i, p: 1, c: 2, f: 3, at: Date.now() }]; localStorage.setItem(key, JSON.stringify(s)); }, [lib.STATE_KEY, i]);
    await reload(page);
    await page.clock.runFor(600e3);   // ten minutes between removals
    texts.push(await lib.readStorageText(page, lib.STATE_KEY));
    await lib.openTab(page, 'settings');
    await copyLog(page);
    page.dialogs.length = 0;
    await page.click('[data-action="handover-remove"]');
    need((await T.toast(page, /removed|could not|changed/)) === 'Old food log removed from Overload', 'removal ' + (i + 1) + ': ' + await T.text(page, '#toast'));
    return page.dialogs[0] || '';
  };
  await step('three removals: three safety copies, each holding the log it removed; no question speaks of letting one go', async () => {
    const qs = [];
    for (let i = 0; i < 3; i++) qs.push(await removeOnce(i));
    const list = await removalCopies(page);
    need(list.length === 3 && new Set(list.map((m) => m.id)).size === 3, 'removal copies: ' + JSON.stringify(list.map((m) => m.id)));
    for (let i = 0; i < 3; i++) need((await T.copy(page, list[2 - i].id)).text === texts[i], 'the copy of removal ' + (i + 1) + ' does not hold what it removed');
    need(!qs.some((q) => /let go/.test(q)), 'a question says a copy is let go: ' + qs.find((q) => /let go/.test(q)));
    return list.map((m) => m.id + ' ' + m.foodDays + ' days').join(', ');
  });
  // All the removals are from one day, so the question names the copy let go by its date and time, as Settings lists
  // it (review round 3, not-checked list: before, it said only the date, which three copies share).
  await step('the fourth removal says which copy is let go (by date and time: the others are from the same day), and only the last three are kept', async () => {
    const oldest = (await removalCopies(page)).pop();
    const q = await removeOnce(3);
    const when = await page.evaluate((at) => new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), oldest.at);
    need(q.includes('\n\nSettings keeps the copies of the last 3 removals, so the copy from ' + when + ' is let go.'), 'the question reads: ' + q.replace(/\n/g, ' | '));
    const list = await removalCopies(page);
    need(list.length === 3 && !list.some((m) => m.id === oldest.id), 'removal copies: ' + JSON.stringify(list.map((m) => m.id)));
    need((await T.copy(page, list[0].id)).text === texts[3], 'the newest copy does not hold what the fourth removal removed');
    await page.waitForFunction((gone) => document.querySelector('#safety-copies .copy-row') && !document.querySelector('[data-action="restore-copy"][data-id="' + gone + '"]'), oldest.id, { timeout: 5000 });
    const rows = await page.evaluate(() => [...document.querySelectorAll('#safety-copies .copy-row .title')].map((t) => t.textContent).filter((t) => /^Before removing the old food log/.test(t)));
    need(rows.length === 3, 'Settings lists ' + rows.length + ' removal copies');
    return q.split('\n\n')[3];
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
    await shortAfterFile(browser, server);
    await freshText(browser, server);
    await storageFull(browser, server);
    await shareSheet(browser, server);
    await removals(browser, server);
  } finally { await browser.close(); await server.stop(); }
  run.done();
})().catch((e) => { console.error(e); process.exit(1); });
