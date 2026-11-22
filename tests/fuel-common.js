/* Shared by the tests of the diet app, Fuel (tests/fuel-*.js). Builds on tests/lib.js.
 *
 *   const F = require('./fuel-common');
 *   const run = F.runner('fuel-shell');                  // run.step(label, title, fn), run.need(cond, msg), run.done()
 *   const page = await F.open(phone, server);            // fuel/index.html, started
 *   const payload = F.payloadFrom(fx.state, Date.now()); // the hand-over payload of SPEC section 5, built from v2.8 data
 *   const text = F.foodText(payload, true);              // the clipboard text: gzip (true) or plain (false)
 *   const day = await F.readDay(page);                   // the food day on screen, read as make-v28.js read v2.8's
 *
 * Nothing here uses the training app's code: the "old phone" is a v2.8 fixture, and what it would hand over
 * is built here from the spec.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const lib = require('./lib');

const PAGE = '/fuel/index.html';
const KEY = 'fuel.state.v1';

/** --port=8421 --only=x  ->  { port: '8421', only: 'x' } */
function args() {
  return Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] == null ? true : m[2]] : [a, true]; }));
}

/** One PASS or FAIL line per check; done() prints the total and sets the exit code. */
function runner(name) {
  let failed = 0, passed = 0;
  const say = (ok, label, title, detail) => { if (ok) passed++; else failed++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  ' + title + (detail ? '  — ' + detail : '')); };
  const step = async (label, title, fn) => {
    try { const detail = await fn(); say(true, label, title, detail); return true; }
    catch (e) { say(false, label, title, String((e && e.message) || e).split('\n')[0].slice(0, 400)); return false; }
  };
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  const same = (got, want, what) => { const d = diff(got, want); if (d) throw new Error(what + ' differs at ' + d); };
  const done = () => { console.log('\n' + name + ': ' + (failed ? failed + ' of ' + (passed + failed) + ' checks FAILED' : 'all ' + passed + ' checks passed')); process.exitCode = failed ? 1 : 0; return failed; };
  return { say, step, need, same, done, get failed() { return failed; } };
}

/** Where two JSON values first differ ('' when they are equal). Key order does not count; array order does. */
function diff(a, b, at) {
  at = at || '$';
  if (a === b) return '';
  const isO = (x) => !!x && typeof x === 'object';
  if (!isO(a) || !isO(b) || Array.isArray(a) !== Array.isArray(b)) return at + ': ' + JSON.stringify(a === undefined ? '(missing)' : a).slice(0, 80) + ' against ' + JSON.stringify(b === undefined ? '(missing)' : b).slice(0, 80);
  const keys = Array.isArray(a) ? Array.from({ length: Math.max(a.length, b.length) }, (x, i) => i) : [...new Set(Object.keys(a).concat(Object.keys(b)))];
  for (const k of keys) { const d = diff(a[k], b[k], at + (Array.isArray(a) ? '[' + k + ']' : '.' + k)); if (d) return d; }
  return '';
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
// fuel/index.html loads two files that a later step of this change writes: sync.js (cloud sync, optional by
// design: the app must start without it) and sw.js (the offline copy). While such a file is not on disk the
// browser reports a 404 for it (for the worker, where service workers are allowed, in a line of its own
// that names no file). Those lines are expected and not counted, and only while the file really is not
// there; anything else is an error.
const notWritten = (name) => !fs.existsSync(path.join(lib.REPO, 'fuel', name));
function expected(line) {
  const m = /\/fuel\/(sync|sw)\.js(\?|\s|\)|$)/.exec(line);
  if (m && /404/.test(line)) return notWritten(m[1] + '.js');
  return /^(console error: )?A bad HTTP response code \(404\) was received when fetching the script\./.test(line) && notWritten('sw.js');
}
/** The page errors and console errors of a phone, without the expected ones above. */
function problems(phone) { return phone.problems().filter((t) => !expected(t)); }
function assertClean(phone, label) {
  const p = problems(phone);
  if (p.length) throw new Error((label ? label + ': ' : '') + p.length + ' error(s): ' + p.join(' | ').slice(0, 600));
}

/** Opens Fuel in a new page of the phone and waits until it has started (window.__overload) and food.js with it. */
async function open(phone, server, opts) {
  const page = await lib.openApp(phone.context, server.url + PAGE, opts);
  await page.waitForFunction(() => !!window.__overloadFood, null, { timeout: 15000 });
  return page;
}
async function reload(page) {
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__overload && !!window.__overloadFood, null, { timeout: 15000 });
}
const text = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const screen = (page) => page.evaluate(() => window.__overload.screen);
const sheetOpen = (page) => page.evaluate(() => !document.querySelector('#sheet').hidden);
async function closeSheet(page) { if (await sheetOpen(page)) await page.click('#sheet .sheet-title [data-action="sheet-close"]'); }
/** Waits until the toast shows text matching `re` and returns the text. */
async function toast(page, re) {
  await page.waitForFunction((src) => { const t = document.querySelector('#toast'); return !!t && !t.hidden && new RegExp(src).test(t.textContent); }, re.source, { timeout: 8000 });
  return page.evaluate(() => document.querySelector('#toast').textContent);
}
/** Fuel's saved state, parsed (null when nothing is stored), and its exact text. */
const stored = (page) => lib.readStorage(page, KEY);
const storedText = (page) => lib.readStorageText(page, KEY);
/** The state the running app holds in memory, as JSON. */
const live = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__overload.state)));
/** Sets a box the way typing and leaving it does (the app saves on the change event). */
async function typeInto(page, sel, value) { await page.fill(sel, String(value)); await page.dispatchEvent(sel, 'change'); }
/** food.js ignores taps for a moment after a food is added (350 ms anywhere, 1 s on the same spot). */
const afterAdd = () => lib.sleep(1100);

// ---------------------------------------------------------------------------
// The food diary on screen (food.js draws it)
// ---------------------------------------------------------------------------
/** The day on screen, read exactly as tests/fixtures/make-v28.js read it from v2.8 for v28-facts.json. */
function readDay(page) {
  return page.evaluate(() => {
    const t = (sel, root) => { const e = (root || document).querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
    return { date: window.__overloadFood._.fu.drawn, label: t('.f-daylabel'), kcal: t('.f-big'), kcalLine: t('.f-kcal > div:first-child'), left: t('.f-left'),
      protein: t('.f-macros .f-macro:nth-child(1) .v'), carbs: t('.f-macros .f-macro:nth-child(2) .v'), fat: t('.f-macros .f-macro:nth-child(3) .v'),
      meals: [...document.querySelectorAll('.f-meal')].map((c) => ({ name: t('h2', c), kcal: t('.f-meal-head .muted', c) || '', foods: c.querySelectorAll('.f-row[data-id]').length })),
      entries: document.querySelectorAll('.f-meal .f-row[data-id]').length };
  });
}
/** Shows Today's tab on the day `ago` days back, by the diary's own day buttons. */
async function gotoDay(page, ago) {
  await lib.openTab(page, 'food');
  await page.click('[data-action="food-day"][data-d="0"]');
  for (let i = 0; i < ago; i++) await page.click('[data-action="food-day"][data-d="-1"]');
}
/** Opens the Add sheet of a meal on the day on screen and reads its groups, as make-v28.js did; leaves it open. */
async function openAddSheet(page, meal) {
  await page.click('[data-action="food-add"][data-meal="' + meal + '"]');
  await page.waitForSelector('#sheet:not([hidden]) #food-results');
  return page.evaluate(() => {
    const groups = {}; let g = null;
    [...document.querySelectorAll('#food-results > *')].forEach((n) => { if (n.classList.contains('group-title')) { g = n.textContent.trim(); groups[g] = 0; } else if (g && n.classList.contains('f-row')) groups[g]++; });
    return { title: document.querySelector('#sheet .sheet-title h2').textContent, groups, favourites: [...document.querySelectorAll('#food-results .f-favmark')].map((m) => m.parentNode.textContent.replace('★', '').trim()) };
  });
}
/** Quick add from the day on screen: name, calories, protein, carbs, fat into a meal. Ends with the sheet closed. */
async function quickAdd(page, meal, name, kcal, p, c, f) {
  await page.click('[data-action="food-add"][data-meal="' + meal + '"]');
  await page.waitForSelector('#sheet:not([hidden]) #food-results');
  await page.click('[data-action="food-quick"]');
  await page.waitForSelector('#food-quick-form');
  await page.fill('#food-quick-form [name="name"]', name);
  await page.fill('#food-quick-form [name="kcal"]', String(kcal));
  await page.fill('#food-quick-form [name="p"]', String(p || 0));
  await page.fill('#food-quick-form [name="c"]', String(c || 0));
  await page.fill('#food-quick-form [name="f"]', String(f || 0));
  await page.click('#food-quick-form button[type="submit"]');
  // Saved: the Add list is back with the green "Added" line. If saving failed the sheet closes instead.
  await page.waitForFunction(() => document.querySelector('#sheet').hidden || !!document.querySelector('#food-added .f-added:not(.none)'), null, { timeout: 8000 });
  await afterAdd();
  await closeSheet(page);
}

// ---------------------------------------------------------------------------
// Automatic copies (IndexedDB, through fuel/backup.js as the app uses it)
// ---------------------------------------------------------------------------
/** One copy with its text, or null. Waits up to `wait` ms for `ok(copy)` (copies are written in the background). */
async function copy(page, id, ok, wait) {
  const until = Date.now() + (wait == null ? 6000 : wait);
  for (;;) {
    const c = await page.evaluate((i) => window.__overloadBackup.get(i).catch(() => null), id);
    if ((c && (!ok || ok(c))) || Date.now() >= until) return c;
    await lib.sleep(150);
  }
}
const copies = (page) => page.evaluate(() => window.__overloadBackup.list().catch(() => []));
/** What a real phone does when the app goes to the background, as far as the page can tell. */
function hide(page) {
  return page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
function show(page) {
  return page.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
}

// ---------------------------------------------------------------------------
// What Overload hands over (dev/notes/SPEC.md, section 5), built from a v2.8 state
// ---------------------------------------------------------------------------
/** The latest weigh-in with a weight, as the payload carries it: [ { date, weight } ] or []. */
function latestWeighIn(st) {
  const last = (st.bodyweight || []).filter((b) => b && +b.weight > 0).sort((a, b) => (a.date < b.date ? -1 : 1)).pop();
  return last ? [{ date: last.date, weight: last.weight }] : [];
}
function payloadFrom(st, madeAt) {
  return { kind: 'overload-food', v: 1, madeAt, from: 'Overload 3.0',
    food: { targets: st.food.targets, foods: st.food.foods, meals: st.food.meals }, diary: st.diary, deleted: { food: st.deleted.food },
    settings: { units: st.settings.units, theme: st.settings.theme }, bodyweight: latestWeighIn(st) };
}
/** The clipboard text: OVERLOAD-FOOD:1: + base64 of the gzip of the compact JSON as UTF-8, or OVERLOAD-FOOD:0: + base64 of the bytes. */
function foodText(payload, gzip) {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return gzip ? 'OVERLOAD-FOOD:1:' + zlib.gzipSync(bytes).toString('base64') : 'OVERLOAD-FOOD:0:' + bytes.toString('base64');
}
/** A saved Fuel state holding the food of a v2.8 state: what Fuel keeps after bringing that food log in. */
function fuelStateFrom(st, more) {
  return Object.assign({ v: 1, app: 'fuel', settings: { units: st.settings.units, theme: st.settings.theme },
    food: { targets: st.food.targets, foods: st.food.foods, meals: st.food.meals }, diary: st.diary,
    deleted: { food: st.deleted.food, foods: {}, meals: {} }, bodyweight: latestWeighIn(st), moved: null }, more || {});
}
/** A folder for the files a test hands to the page; rm() removes it. */
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-test-'));
  return { dir, file(name, content) { const f = path.join(dir, name); fs.writeFileSync(f, content); return f; }, rm() { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* gone */ } } };
}
/** Hands a file to the page through the button that asks for one (the file chooser the button opens). */
async function chooseFile(page, buttonSel, file) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click(buttonSel)]);
  await fc.setFiles(file);
}
/** Counts in a diary: days, entries, quick adds, entries whose food is not among `foods`. */
function diaryCounts(diary, foods) {
  const days = Object.keys(diary), all = days.reduce((l, d) => l.concat(diary[d]), []);
  return { days: days.length, entries: all.length, quick: all.filter((e) => e.food == null && e.qty == null).length, orphans: all.filter((e) => e.food && !foods[e.food]).length };
}

module.exports = {
  PAGE, KEY, args, runner, diff, problems, assertClean, open, reload, text, count, screen, sheetOpen, closeSheet, toast, stored, storedText, live,
  typeInto, afterAdd, readDay, gotoDay, openAddSheet, quickAdd, copy, copies, hide, show, latestWeighIn, payloadFrom, foodText, fuelStateFrom, tempDir, chooseFile, diaryCounts
};
