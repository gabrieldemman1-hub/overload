/* Shared by the tests of the training app without Food (tests/train-*.js). Builds on tests/lib.js.
 *
 *   const T = require('./train-common');
 *   const run = T.runner('train-upgrade');             // run.step(label, title, fn), run.need(cond, msg), run.done()
 *   const facts = await T.readTraining(page, names);   // what the screens show, read the way make-v28.js read v28-facts.json
 *   const copy = await T.copy(page, 'before-split');   // an automatic copy from IndexedDB (backup.js), or null
 *   const payload = T.decodeFoodText(clipboardText);   // the hand-over text, both encodings
 *   const dir = T.extractV28();                        // v2.8 from git, in a temporary folder (T.removeDir(dir) after)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const lib = require('./lib');

const V28 = '3b17963';   // the commit of v2.8, the version on the phone before the split
const TABS = ['today', 'program', 'exercises', 'history', 'settings'];

/** --port=8402 --only=v28-state  ->  { port: '8402', only: 'v28-state' } */
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
  const same = (got, want, what) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a !== b) throw new Error(what + ' is ' + (a || '').slice(0, 160) + ', expected ' + (b || '').slice(0, 160)); };
  const done = () => { console.log('\n' + name + ': ' + (failed ? failed + ' of ' + (passed + failed) + ' checks FAILED' : 'all ' + passed + ' checks passed')); process.exitCode = failed ? 1 : 0; return failed; };
  return { say, step, need, same, done, get failed() { return failed; } };
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
const text = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const sheetOpen = (page) => page.evaluate(() => !document.querySelector('#sheet').hidden);
async function closeSheet(page) { if (await sheetOpen(page)) await page.click('#sheet .sheet-title [data-action="sheet-close"]'); }
/** Waits until the toast shows text matching `re` and returns the text. */
async function toast(page, re) {
  await page.waitForFunction((src) => { const t = document.querySelector('#toast'); return !!t && !t.hidden && new RegExp(src).test(t.textContent); }, re.source, { timeout: 8000 });
  return page.evaluate(() => document.querySelector('#toast').textContent);
}
/** The parsed value of a localStorage key (null when absent). */
const stored = (page, key) => lib.readStorage(page, key);

// ---------------------------------------------------------------------------
// Automatic copies (IndexedDB, through backup.js as the app uses it)
// ---------------------------------------------------------------------------
/** One copy with its text, or null. Waits up to `wait` ms for it to appear (copies are written in the background). */
async function copy(page, id, wait) {
  const until = Date.now() + (wait == null ? 5000 : wait);
  for (;;) {
    const c = await page.evaluate((i) => window.__overloadBackup.get(i).catch(() => null), id);
    if (c || Date.now() >= until) return c;
    await lib.sleep(150);
  }
}
/** The list of copies without their text, newest first. */
const copies = (page) => page.evaluate(() => window.__overloadBackup.list().catch(() => []));

// ---------------------------------------------------------------------------
// What the training screens show. Read exactly as tests/fixtures/make-v28.js read them from v2.8 for
// v28-facts.json, so the two can be compared key by key.
// ---------------------------------------------------------------------------
function readToday(page) {
  return page.evaluate(() => {
    const t = (sel, root) => { const e = (root || document).querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
    const active = !!document.querySelector('[data-action="finish-workout"]');
    return { title: t('.screen-title h1'), sub: t('.screen-title .sub'), activeWorkout: active, streakBanner: t('.banner'), checkin: t('#app .card b') && [...document.querySelectorAll('#app .card')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).find((x) => /^Morning check-in/.test(x)) || null,
      dayCard: active ? null : t('.card.flat h2'), dayMeta: active ? null : t('.card.flat .meta'),
      plan: active ? null : [...document.querySelectorAll('.card.flat .list .list-item')].map((b) => ({ name: t('.title', b), text: t('.sub', b) })),
      lastWorkout: t('p.muted.small.center') };
  });
}
function readActive(page) {
  return page.evaluate(() => {
    const w = window.__overload.state.workouts.find((x) => x.id === window.__overload.state.active);
    return { title: document.querySelector('.screen-title h1').textContent, sub: document.querySelector('.screen-title .sub').textContent.replace(/\s+/g, ' ').trim(), exercises: w.entries.length, exercisesDone: w.entries.filter((e) => e.done).length, sets: w.entries.reduce((n, e) => n + e.sets.length, 0), setsTicked: w.entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0), foldedCards: document.querySelectorAll('.ex-card.compact').length, openCards: document.querySelectorAll('.ex-card:not(.compact)').length };
  });
}
/** The Exercises tab's line for each named exercise: [{ name, line }] */
async function readExercises(page, names) {
  await lib.openTab(page, 'exercises');
  return page.evaluate((list) => list.map((name) => { const b = [...document.querySelectorAll('#app .list-item')].find((x) => x.querySelector('.title').textContent === name); return { name, line: b ? b.querySelector('.sub').textContent.replace(/\s+/g, ' ').trim() : null }; }), names);
}
async function readHistory(page) {
  await lib.openTab(page, 'history');
  return page.evaluate(() => {
    const t = (e) => e.textContent.replace(/\s+/g, ' ').trim();
    const stats = [...document.querySelectorAll('#app > .stat-row .stat')].map((s) => ({ k: t(s.querySelector('.k')), v: t(s.querySelector('.v')) }));
    const rows = [...document.querySelectorAll('#app > .list [data-action="view-workout"]')];
    const prs = rows.map((r) => { const m = /🏆 (\d+)/.exec(r.textContent); return m ? +m[1] : 0; });
    const cards = [...document.querySelectorAll('#app > .card')].map((c) => t(c.querySelector('b') || c.querySelector('label') || c));
    return { stats, workoutRows: rows.length, rowsWithPr: prs.filter(Boolean).length, prTotal: prs.reduce((a, b) => a + b, 0), deloadRows: rows.filter((r) => /Deload/.test(r.textContent)).length,
      firstRow: rows[0] ? t(rows[0]) : null, cards, review: t([...document.querySelectorAll('#app > .card')].find((c) => /Weekly review/.test(c.textContent))),
      bodyWeight: (() => { const c = [...document.querySelectorAll('#app > .card')].find((x) => /^Body weight/.test(t(x))); return c ? [...c.querySelectorAll('.stat')].map((s) => ({ k: t(s.querySelector('.k')), v: t(s.querySelector('.v')) })).concat([{ k: 'Pill', v: t(c.querySelector('.pill')) }]) : null; })(),
      sleep: (() => { const c = [...document.querySelectorAll('#app > .card')].find((x) => /^Sleep/.test(t(x))); return c ? { nights: t(c.querySelector('[data-action="sleep-list"]')), stats: [...c.querySelectorAll('.stat')].map((s) => ({ k: t(s.querySelector('.k')), v: t(s.querySelector('.v')) })) } : null; })() };
  });
}
/** The progress chart of one exercise on History (the tab must be open), or null when it cannot be chosen. */
async function readChart(page, name) {
  const opt = await page.evaluate((n) => { const o = [...document.querySelectorAll('select[data-field="chart-ex"] option')].find((x) => x.textContent === n); return o ? o.value : null; }, name);
  if (!opt) return null;
  await page.selectOption('select[data-field="chart-ex"]', opt);
  return page.evaluate((n) => {
    const t = (e) => e.textContent.replace(/\s+/g, ' ').trim();
    const card = document.querySelector('select[data-field="chart-ex"]').closest('.card');
    return { exercise: n, stats: [...card.querySelectorAll('.stat')].map((s) => ({ k: t(s.querySelector('.k')), v: t(s.querySelector('.v')) })), lines: [...card.querySelectorAll('.review-list > div')].map(t), dots: card.querySelectorAll('svg.chart circle.pt').length, recentSessions: card.querySelectorAll('.hist-set').length };
  }, name);
}
/** A v2.8 food day as its Food tab shows it (only v2.8 has that tab; used by the roll-back test). */
function readFoodDay(page) {
  return page.evaluate(() => {
    const t = (sel, root) => { const e = (root || document).querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
    return { date: window.__overloadFood._.fu.drawn, label: t('.f-daylabel'), kcal: t('.f-big'), kcalLine: t('.f-kcal > div:first-child'), left: t('.f-left'),
      protein: t('.f-macros .f-macro:nth-child(1) .v'), carbs: t('.f-macros .f-macro:nth-child(2) .v'), fat: t('.f-macros .f-macro:nth-child(3) .v'),
      meals: [...document.querySelectorAll('.f-meal')].map((c) => ({ name: t('h2', c), kcal: t('.f-meal-head .muted', c) || '', foods: c.querySelectorAll('.f-row[data-id]').length })),
      entries: document.querySelectorAll('.f-meal .f-row[data-id]').length };
  });
}

// ---------------------------------------------------------------------------
// The hand-over text and the food data
// ---------------------------------------------------------------------------
/** 'OVERLOAD-FOOD:1:<base64 of gzip>' or 'OVERLOAD-FOOD:0:<base64>' -> { mode, json, payload } */
function decodeFoodText(clip) {
  const m = /^OVERLOAD-FOOD:([01]):([A-Za-z0-9+/]+=*)$/.exec(clip || '');
  if (!m) throw new Error('not a hand-over text: ' + String(clip).slice(0, 60));
  const bytes = Buffer.from(m[2], 'base64');
  const json = (m[1] === '1' ? zlib.gunzipSync(bytes) : bytes).toString('utf8');
  return { mode: m[1], json, payload: JSON.parse(json) };
}
/** The food part of a state as text, for "byte for byte" checks: food, diary, deleted.food. */
function foodTexts(state) {
  return { food: JSON.stringify(state.food), diary: JSON.stringify(state.diary), deleted: JSON.stringify((state.deleted || {}).food) };
}
/** deleted.food as the app leaves it after a load at `now`: records older than 90 days are dropped (app.js normalize). */
function prunedDeletions(map, now) {
  const out = {}, cutoff = now - 90 * 864e5;
  Object.keys(map || {}).forEach((id) => { if (map[id] > cutoff) out[id] = map[id]; });
  return out;
}
/** The latest weigh-in with a weight, as food.js picks it for its protein guide: [{ date, weight }] or []. */
function latestWeighIn(state) {
  const b = (state.bodyweight || []).filter((x) => x && +x.weight > 0).sort((a, c) => (a.date < c.date ? -1 : 1)).pop();
  return b ? [{ date: b.date, weight: b.weight }] : [];
}

// ---------------------------------------------------------------------------
// v2.8 from git, and temporary files
// ---------------------------------------------------------------------------
function tempDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function removeDir(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* leave it */ } }
/** Extracts v2.8 (read-only use of git) into a new temporary folder and returns the folder. */
function extractV28() {
  const dir = tempDir('overload-v28-');
  execSync('git -C ' + JSON.stringify(lib.REPO) + ' archive ' + V28 + ' | tar -x -C ' + JSON.stringify(dir), { stdio: ['ignore', 'ignore', 'pipe'] });
  if (!/const VERSION = '2\.8'/.test(fs.readFileSync(path.join(dir, 'app.js'), 'utf8'))) throw new Error('extractV28: the extracted app.js is not v2.8');
  return dir;
}
/** Writes `content` (text, or an object as JSON) to a file in `dir` and returns its path. */
function writeFile(dir, name, content) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

module.exports = {
  V28, TABS, args, runner, text, count, sheetOpen, closeSheet, toast, stored, copy, copies,
  readToday, readActive, readExercises, readHistory, readChart, readFoodDay,
  decodeFoodText, foodTexts, prunedDeletions, latestWeighIn, tempDir, removeDir, extractV28, writeFile
};
