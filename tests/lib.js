/* Test helper for Overload (and the apps split from it). CommonJS, no dependencies but Playwright.
 *
 *   const lib = require('./lib');
 *   const server = await lib.startServer(lib.REPO, 8310);          // python3 -m http.server on 127.0.0.1
 *   const browser = await lib.launch();                             // chromium, no options
 *   const fx = lib.loadFixture('v28-state');                        // { state, meta, text }
 *   const phone = await lib.newPhone(browser, { colorScheme: 'dark', now: fx.meta.now, timezoneId: fx.meta.tz });
 *   await lib.seedV28(phone.context, fx);                           // localStorage, before the app's scripts run
 *   const page = await lib.openApp(phone.context, server.url + '/index.html');
 *   await lib.openTab(page, 'history');
 *   const state = await lib.readStorage(page, 'overload.state.v1');
 *   await lib.shot(page, '/tmp/history.png');
 *   phone.assertClean();                                            // throws on any page error or console error
 *   await phone.close(); await browser.close(); await server.stop();
 *
 * Rules built in: every request that is not to http://127.0.0.1 is aborted (and listed in phone.blocked),
 * also requests made by a service worker; service workers are blocked unless asked for.
 *
 * One context is one "installed app": on an iPhone every Home Screen app has its own storage, so a test of
 * two apps that must not see each other's localStorage uses two contexts (two newPhone calls).
 */
'use strict';

// Requests made by a service worker go through context.route too (the default in this Playwright; the
// variable makes older ones do the same). Must be set before Playwright is loaded.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const REPO = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const LOCAL = 'http://127.0.0.1';
const STATE_KEY = 'overload.state.v1';
const SEED_MARK = '__tests.seeded';   // set by seedStorage in the page's localStorage; readStorage hides it
// The fixtures are built and replayed in this time zone. Their "now" is early evening there, which is
// already the next day in UTC: code that takes "today" from toISOString() shows the wrong day and fails.
const DEFAULT_TZ = 'America/Los_Angeles';
const PHONE = { width: 390, height: 844 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Static server
// ---------------------------------------------------------------------------
function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.setTimeout(1000, () => { req.destroy(); resolve(0); });
  });
}
/** Serves `dir` on 127.0.0.1:`port`. Resolves once it answers. { port, url, dir, stop() } */
async function startServer(dir, port) {
  if (!fs.existsSync(dir)) throw new Error('startServer: no such folder ' + dir);
  if (await ping(LOCAL + ':' + port + '/')) throw new Error('startServer: port ' + port + ' is already in use');
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', dir], { stdio: ['ignore', 'ignore', 'pipe'] });
  let exited = false, errText = '';
  proc.stderr.on('data', (b) => { if (errText.length < 2000) errText += b; });   // http.server logs every request to stderr
  proc.on('exit', () => { exited = true; });
  const url = LOCAL + ':' + port;
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error('startServer: python3 -m http.server stopped at once (port ' + port + '): ' + errText.trim());
    if (await ping(url + '/')) break;
    if (i === 99) { proc.kill(); throw new Error('startServer: no answer on ' + url); }
    await sleep(100);
  }
  const stop = () => new Promise((resolve) => { if (exited) return resolve(); proc.once('exit', () => resolve()); proc.kill(); });
  process.once('exit', () => { try { proc.kill(); } catch (e) { /* gone */ } });   // never leave a server behind
  return { port, url, dir, stop };
}

// ---------------------------------------------------------------------------
// Browser and phone-like context
// ---------------------------------------------------------------------------
function launch() { return chromium.launch(); }

/**
 * A context shaped like the owner's iPhone: 390x844, deviceScaleFactor 2, touch, mobile.
 * opts:
 *   colorScheme      'dark' (default) | 'light' | 'no-preference'   what the phone is set to (the app's own
 *                    theme setting, state.settings.theme, wins when it is not 'system')
 *   serviceWorkers   'block' (default) | 'allow'
 *   timezoneId       default America/Los_Angeles (DEFAULT_TZ)
 *   locale           default en-US
 *   now              a time (ms, Date or ISO text) the page's clock starts at and runs on from, timers included.
 *                    Give a fixture's meta.now so its "today" is today whenever the test runs. Omit for the real clock.
 *   allow            extra URL prefixes that may be fetched (default none: only http://127.0.0.1)
 * Returns { context, pageErrors, consoleErrors, blocked, badResponses, problems(), assertClean(), reset(), close() }.
 *   pageErrors     uncaught exceptions and unhandled rejections in any page of the context
 *   consoleErrors  console.error output, and the browser's own error lines (a 404, a refused script)
 *   blocked        requests to other hosts that were aborted here; their "Failed to load resource" console
 *                  lines are not counted as console errors
 *   badResponses   answers with status 400 or more from the local server
 */
async function newPhone(browser, opts) {
  opts = opts || {};
  const context = await browser.newContext({
    viewport: PHONE, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
    colorScheme: opts.colorScheme || 'dark',
    serviceWorkers: opts.serviceWorkers === 'allow' ? 'allow' : 'block',
    timezoneId: opts.timezoneId || DEFAULT_TZ,
    locale: opts.locale || 'en-US'
  });
  const allow = [LOCAL + ':', LOCAL + '/'].concat(opts.allow || []);
  const phone = { context, pageErrors: [], consoleErrors: [], blocked: [], badResponses: [] };
  const isLocal = (u) => allow.some((p) => u.startsWith(p)) || /^(data|blob|about):/.test(u);
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (isLocal(u)) return route.continue();
    phone.blocked.push(u);
    return route.abort();
  });
  context.on('weberror', (e) => { const err = e.error(); phone.pageErrors.push(String((err && (err.stack || err.message)) || err)); });
  context.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location() || {}, text = m.text();
    // The browser's line for a request this helper aborted: expected, kept in `blocked` only.
    if (/Failed to load resource/.test(text) && loc.url && !isLocal(loc.url)) return;
    phone.consoleErrors.push(text + (loc.url ? ' (' + loc.url + (loc.lineNumber ? ':' + loc.lineNumber : '') + ')' : ''));
  });
  context.on('response', (res) => { if (res.status() >= 400 && isLocal(res.url())) phone.badResponses.push(res.status() + ' ' + res.url()); });
  if (opts.now != null) await context.clock.install({ time: new Date(opts.now) });
  phone.problems = () => phone.pageErrors.map((t) => 'page error: ' + t).concat(phone.consoleErrors.map((t) => 'console error: ' + t));
  phone.assertClean = (label) => {
    const p = phone.problems();
    if (p.length) throw new Error((label ? label + ': ' : '') + p.length + ' error(s)\n  ' + p.join('\n  '));
  };
  phone.reset = () => { phone.pageErrors.length = 0; phone.consoleErrors.length = 0; phone.blocked.length = 0; phone.badResponses.length = 0; };
  phone.close = () => context.close();
  return phone;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
/**
 * Puts values into localStorage before any script of the page runs (context.addInitScript).
 * `map` is { key: value }: text is stored as it is, anything else as JSON. A value of null removes the key.
 * By default this happens once per context (a marker key, SEED_MARK, is left in localStorage), so a reload
 * or a second page shows what the app saved, not the fixture again. { always: true } seeds on every load.
 * Call it before the first page is opened. Seeding is per origin: every origin a page of this context opens
 * gets the same keys, once.
 */
async function seedStorage(context, map, opts) {
  const entries = Object.keys(map).map((k) => [k, map[k] == null ? null : typeof map[k] === 'string' ? map[k] : JSON.stringify(map[k])]);
  const always = !!(opts && opts.always);
  await context.addInitScript(({ entries, always, mark }) => {
    try {
      if (window.top !== window) return;                       // not in frames
      if (!always && localStorage.getItem(mark)) return;
      entries.forEach(([k, v]) => { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
      if (!always) localStorage.setItem(mark, '1');
    } catch (e) { /* about:blank and the like have no storage */ }
  }, { entries, always, mark: SEED_MARK });
}

/**
 * Seeds a v2.8 phone: the state under overload.state.v1, plus the two small keys v2.8 keeps beside it
 * (overload.theme, which index.html reads before first paint, and overload.backup = { since, lastExport }).
 * `fx` is what loadFixture returns, or a state object. opts.backup: false leaves overload.backup out,
 * an object replaces it. opts.theme: 'light' | 'dark' | 'system' changes settings.theme in the seeded copy
 * (the main fixtures force dark). opts.extra: more keys. opts.always: see seedStorage.
 */
async function seedV28(context, fx, opts) {
  opts = opts || {};
  let state = fx && fx.state ? fx.state : fx;
  const meta = (fx && fx.meta) || {};
  const map = {};
  map[STATE_KEY] = fx && fx.text ? fx.text : state;
  if (opts.theme) { state = JSON.parse(JSON.stringify(state)); state.settings.theme = opts.theme; map[STATE_KEY] = state; }
  map['overload.theme'] = (state.settings && state.settings.theme) || 'system';
  if (opts.backup !== false) map['overload.backup'] = opts.backup || meta.backup || { since: Date.now(), lastExport: Date.now() };
  Object.assign(map, opts.extra || {});
  await seedStorage(context, map, { always: opts.always });
}

/** localStorage of the page: one key (JSON parsed when it parses, else the text, null when absent) or, with no key, every key as text. */
async function readStorage(page, key) {
  if (key != null) {
    const raw = await page.evaluate((k) => localStorage.getItem(k), key);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (e) { return raw; }
  }
  return page.evaluate((mark) => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== mark) o[k] = localStorage.getItem(k); } return o; }, SEED_MARK);
}
/** The exact text stored under a key (no parsing). */
function readStorageText(page, key) { return page.evaluate((k) => localStorage.getItem(k), key); }

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
/**
 * Opens `url` in a new page of the context and waits until the app has started.
 * opts.ready: a function or expression evaluated in the page; default: window.__overload exists
 * (overload.js sets it last, and app.js in v2.8; the diet app's shell, fuel/fuel.js, offers the same object).
 * opts.dialogs: 'accept' (default) | 'dismiss' | 'none' | (dialog) => any. confirm() and prompt() would
 * otherwise hang the page. page.dialogs lists the messages seen.
 */
async function openApp(context, url, opts) {
  opts = opts || {};
  const page = await context.newPage();
  page.dialogs = [];
  const mode = opts.dialogs || 'accept';
  if (mode !== 'none') {
    page.on('dialog', (d) => {
      page.dialogs.push(d.type() + ': ' + d.message());
      if (typeof mode === 'function') return Promise.resolve(mode(d)).catch(() => {});
      return (mode === 'dismiss' ? d.dismiss() : d.accept()).catch(() => {});
    });
  }
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(opts.ready || (() => !!window.__overload), null, { timeout: opts.timeout || 15000 });
  return page;
}

/**
 * Taps the bottom tab with this data-screen name and waits until it is the active one.
 * food.js ignores every tap for 350 ms after a food is added (and for 1 s a tap on the same spot), so a
 * tap that did nothing is repeated after a moment.
 */
async function openTab(page, name) {
  const sel = '.tab[data-screen="' + name + '"]';
  for (let i = 0; i < 4; i++) {
    await page.click(sel);
    try { await page.waitForSelector(sel + '.active', { timeout: i < 3 ? 700 : 5000 }); return; } catch (e) { if (i === 3) throw e; }
  }
}

/** The names of the tabs in the tab bar, in order. */
function tabNames(page) { return page.evaluate(() => [...document.querySelectorAll('.tab[data-screen]')].map((t) => t.dataset.screen)); }

/** Screenshot to `file` (folders are created). opts.fullPage: the whole page, not just the 390x844 screen. */
async function shot(page, file, opts) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: !!(opts && opts.fullPage) });
  return file;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
/**
 * loadFixture('v28-state') -> { name, text, state, meta, facts }
 *   text   the exact text v2.8 had in localStorage (use this to seed, so the bytes are the app's own)
 *   state  the same, parsed
 *   meta   { now, today, tz, backup, ... } from v28-meta.json for this fixture: pass meta.now and meta.tz to newPhone
 *   facts  what the v2.8 app showed for it (v28-facts.json): numbers a test can assert
 */
function loadFixture(name) {
  const base = name.replace(/\.json$/, '');
  const text = fs.readFileSync(path.join(FIXTURES, base + '.json'), 'utf8').replace(/\n$/, '');
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(FIXTURES, f), 'utf8')); } catch (e) { return {}; } };
  const metaAll = read('v28-meta.json'), factsAll = read('v28-facts.json');
  const meta = Object.assign({}, metaAll.common || {}, (metaAll.fixtures || {})[base] || {});
  return { name: base, text, state: JSON.parse(text), meta, facts: (factsAll.fixtures || factsAll)[base] || {} };
}

/** todayKey as the app computes it, for a time in a time zone: 'YYYY-MM-DD'. */
function dayKey(ms, tz) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz || DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms == null ? Date.now() : ms));
  const g = (t) => p.find((x) => x.type === t).value;
  return g('year') + '-' + g('month') + '-' + g('day');
}

module.exports = {
  REPO, FIXTURES, LOCAL, STATE_KEY, SEED_MARK, DEFAULT_TZ, PHONE,
  sleep, startServer, launch, newPhone, seedStorage, seedV28, readStorage, readStorageText,
  openApp, openTab, tabNames, shot, loadFixture, dayKey, chromium
};
