#!/usr/bin/env node
/* Overload 3.0: the start-up rescue in index.html, and the reload after an update.
 *
 *   node tests/train-rescue.js [--port=8406]
 *
 * The rescue runs when the page arrived but overload.js did not. The test serves the repo's own page as "the next
 * release" (every ?v=3.0 turned into ?v=3.1, and a second stylesheet added), lets overload.js?v=3.1 fail, and puts
 * stored copies into Cache Storage by hand, as the service worker would have left them:
 *   - an older release with the same first number (3.0 for the 3.1 page) is started from the stored copies,
 *     every script and every stylesheet;
 *   - of two older releases the newer one is used;
 *   - a release with another first number (2.8) is never used; nor a newer one; nor copies in a cache that is
 *     not this app's (fuel-…); nor a stored fuel/overload.js, which is another app's file. The page then says
 *     "Overload did not finish starting" and that what was logged is still on the phone.
 * Stylesheets that are slow to arrive (two of them): after 8 s the page stops waiting for them, the app
 * starts, and they apply when they arrive.
 * The reload after an update (a new service worker taking over): held back while a sheet is open, with the
 * "Update ready" pill instead; done at once otherwise. The service worker is stood in for (tests block real
 * ones): the page is told it had a controller, then gets the controllerchange event.
 * Nothing is written to the repo: the changed pages are answered from memory. Prints one PASS/FAIL line per
 * check and exits 1 if anything failed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const T = require('./train-common');

const args = T.args();
const PORT = Number(args.port) || 8406;
const run = T.runner('train-rescue');
const { need, same } = run;
const fx = lib.loadFixture('v28-state-small');
const HTML = fs.readFileSync(path.join(lib.REPO, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(lib.REPO, 'overload.js'), 'utf8');
const EXTRA_CSS = 'body { --rescue-test: 1; }';

// The page of a later release: the repo's page with another release number and one more stylesheet.
function pageOf(v) {
  if (!HTML.includes('?v=3.0')) throw new Error('index.html is not at ?v=3.0: this test needs updating');
  return HTML.split('?v=3.0').join('?v=' + v).replace('</head>', '  <link rel="stylesheet" href="./extra.css?v=' + v + '">\n</head>');
}
// The files a page asks for (scripts and stylesheets), as paths without the release.
const FILES = [...pageOf('9.9').matchAll(/(?:src|href)="\.\/([^"?]+)\?v=9\.9"/g)].map((m) => m[1]);

// A phone whose page is release `v`, with overload.js of that release failing to load.
async function phone(browser, v, seed) {
  const p = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
  if (seed) await lib.seedV28(p.context, fx);
  await p.context.route('**/blank.html', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }));
  await p.context.route('**/extra.css*', (r) => r.fulfill({ contentType: 'text/css', body: EXTRA_CSS }));
  await p.context.route('**/index.html', (r) => r.fulfill({ contentType: 'text/html', body: pageOf(v) }));
  await p.context.route('**/overload.js?v=' + v, (r) => r.abort());
  return p;
}
// Puts stored copies into Cache Storage: [{ cache, url, from }] copies a file of the server, [{ cache, url, body }] stores text.
async function store(page, base, entries) {
  await page.goto(base + '/blank.html');
  await page.evaluate(async (list) => {
    for (const e of list) {
      const c = await caches.open(e.cache);
      const res = e.body != null ? new Response(e.body, { headers: { 'Content-Type': /\.css/.test(e.url) ? 'text/css' : 'text/javascript' } }) : await fetch(e.from, { cache: 'no-store' });
      if (!res.ok) throw new Error('could not read ' + e.from);
      await c.put(e.url, res);
    }
  }, entries);
}
// A whole release in a cache: every file of the page under ?v=<v>; `appBody` replaces overload.js.
const release = (base, cache, v, appBody) => FILES.map((f) => (f === 'overload.js' && appBody != null ? { cache, url: base + '/' + f + '?v=' + v, body: appBody } : { cache, url: base + '/' + f + '?v=' + v, from: base + '/' + f }));
const versionShown = async (page) => { await lib.openTab(page, 'settings'); return T.text(page, '#app p.version'); };
// Waits for the rescue to give up (its last word) and returns what the page says.
async function gaveUp(page, base) {
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => { const n = document.getElementById('boot-note'); return !!n && /did not finish starting/.test(n.textContent); }, null, { timeout: 15000 });
  return page.evaluate(() => ({ note: document.getElementById('boot-note').textContent, started: !!window.__overload, decoy: !!window.__decoy, blobs: document.querySelectorAll('script[src^="blob:"], link[href^="blob:"]').length }));
}

async function rescues(browser, server) {
  const base = server.url, name = 'rescue';
  await run.step(name, 'the test page asks for the app\'s scripts and two stylesheets', async () => {
    need(FILES.includes('overload.js') && FILES.filter((f) => /\.css$/.test(f)).length >= 2 && FILES.filter((f) => /\.js$/.test(f)).length >= 4, 'files: ' + FILES.join(', '));
    need(!FILES.some((f) => /food\.js/.test(f)), 'the page asks for food.js');
    return FILES.join(', ');
  });

  await run.step(name, 'an older release with the same first number is started from the stored copies, every script and stylesheet', async () => {
    const p = await phone(browser, '3.1', true), page = await p.context.newPage();
    try {
      await store(page, base, release(base, 'overload-v24', '3.0'));
      await page.goto(base + '/index.html', { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__overload, null, { timeout: 15000 });
      const got = await page.evaluate(() => ({ scripts: document.querySelectorAll('script[src^="blob:"]').length, sheets: document.querySelectorAll('link[rel="stylesheet"][href^="blob:"]').length, note: !!document.getElementById('boot-note'), workouts: window.__overload.state.workouts.length }));
      same(got.scripts, FILES.filter((f) => /\.js$/.test(f)).length, 'scripts started from stored copies');
      same(got.sheets, FILES.filter((f) => /\.css$/.test(f)).length, 'stylesheets added from stored copies');
      need(!got.note && got.workouts === fx.state.workouts.length, 'the app did not draw the saved data');
      need((await versionShown(page)) === 'Overload · v3.0', 'the app that started is not 3.0');
      // connector.js of the release whose overload.js failed finds no app to plug into and stops: that one error is expected.
      const errors = p.pageErrors.filter((e) => !/Cannot read properties of undefined \(reading 'lib'\)/.test(e));
      need(errors.length === 0, 'page errors: ' + errors.join(' | ').slice(0, 300));
      return got.scripts + ' scripts and ' + got.sheets + ' stylesheets from the stored 3.0';
    } finally { await p.close(); }
  });

  await run.step(name, 'of two older releases the newer one is used', async () => {
    const p = await phone(browser, '3.2', true), page = await p.context.newPage();
    try {
      await store(page, base, release(base, 'overload-v24', '3.0').concat(release(base, 'overload-v25', '3.1', APP.replace("const VERSION = '3.0'", "const VERSION = '3.1'"))));
      await page.goto(base + '/index.html', { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__overload, null, { timeout: 15000 });
      need((await versionShown(page)) === 'Overload · v3.1', 'the app that started reads ' + (await T.text(page, '#app p.version')));
      return 'the 3.2 page started the stored 3.1';
    } finally { await p.close(); }
  });

  const refused = [
    ['a release with another first number (2.8) is never used', '3.1', (b) => release(b, 'overload-v23', '2.8', 'window.__decoy = true;')],
    ['a newer release is not used', '3.1', (b) => release(b, 'overload-v26', '3.2', 'window.__decoy = true;')],
    ['copies in a cache that is not this app\'s are not used', '3.1', (b) => release(b, 'fuel-v1', '3.0', 'window.__decoy = true;')],
    ['a stored fuel/overload.js is not taken for this app\'s', '3.1', (b) => [{ cache: 'overload-v24', url: b + '/fuel/overload.js?v=3.0', body: 'window.__decoy = true;' }].concat(release(b, 'overload-v24', '3.0').filter((e) => !/\/overload\.js\?/.test(e.url)))]
  ];
  for (const [title, v, entries] of refused) {
    await run.step(name, title, async () => {
      const p = await phone(browser, v, true), page = await p.context.newPage();
      try {
        await store(page, base, entries(base));
        const got = await gaveUp(page, base);
        need(!got.started && !got.decoy && got.blobs === 0, 'something was started from stored copies: ' + JSON.stringify(got));
        need(got.note === 'Overload did not finish starting. Everything you logged is still on this phone.Close the app and open it again where there is signal or Wi-Fi.', 'the page says: ' + got.note);
        need((await lib.readStorageText(page, lib.STATE_KEY)) === fx.text, 'the saved data changed');
        return got.note.slice(0, 80);
      } finally { await p.close(); }
    });
  }
  await run.step(name, 'with nothing saved the note does not speak of logged data', async () => {
    const p = await phone(browser, '3.1', false), page = await p.context.newPage();
    try {
      const got = await gaveUp(page, base);
      need(got.note === 'Overload did not finish starting.Close the app and open it again where there is signal or Wi-Fi.', 'the page says: ' + got.note);
    } finally { await p.close(); }
  });
}

// Stylesheets that are slow to arrive hold back the scripts at the end of the page, so nothing starts and
// nothing is drawn. After 8 s the page swaps each waiting stylesheet for a copy that does not hold anything
// back (and says it is still starting, until the app draws itself). Every one must be swapped: the page's own
// (shared/ui.css and train.css) and the one this test adds.
async function slowStart(browser, server) {
  const name = 'slow start';
  const p = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
  await lib.seedV28(p.context, fx);
  let waiting = 0, release = null;
  const held = new Promise((r) => { release = r; });
  await p.context.route('**/index.html', (r) => r.fulfill({ contentType: 'text/html', body: pageOf('3.0') }));   // this release, plus one more stylesheet
  const CSS = FILES.filter((f) => /\.css$/.test(f));   // the page's own stylesheets and the extra one
  await p.context.route('**/*.css*', async (r) => { waiting++; await held; r.continue(); });
  await p.context.route('**/extra.css*', async (r) => { waiting++; await held; r.fulfill({ contentType: 'text/css', body: EXTRA_CSS }); });   // registered last: it answers for extra.css
  const page = await p.context.newPage();
  const sheets = () => page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => !!l.sheet));
  await run.step(name, 'every stylesheet still on its way: after 8 s the app starts all the same, and they apply when they arrive', async () => {
    need(CSS.length >= 2, 'the test page has ' + CSS.length + ' stylesheets, expected two or more');
    await page.goto(server.url + '/index.html', { waitUntil: 'commit' });
    for (let i = 0; i < 50 && waiting < CSS.length; i++) await lib.sleep(100);
    await lib.sleep(700);
    need(waiting === CSS.length, waiting + ' stylesheets are being waited for, expected ' + CSS.length);
    need(await page.evaluate(() => !window.__overload && document.readyState === 'loading'), 'the page did not wait for its stylesheets (the test proves nothing)');
    await p.context.clock.fastForward(8100);
    await page.waitForFunction(() => !!window.__overload, null, { timeout: 8000, polling: 100 });
    same(await sheets(), CSS.map(() => false), 'the stylesheets while they are still on their way');
    need(await page.evaluate(() => !document.getElementById('boot-note') && window.__overload.state.workouts.length > 0), 'the app did not draw the saved data');
    release();
    await page.waitForFunction(() => [...document.querySelectorAll('link[rel="stylesheet"]')].every((l) => !!l.sheet), null, { timeout: 8000, polling: 100 });
    need((await lib.readStorageText(page, lib.STATE_KEY)) === fx.text, 'the saved data changed');
    return 'started with ' + (await sheets()).length + ' stylesheets applied afterwards';
  });
  const problems = p.problems();
  run.say(!problems.length, name, 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
  await p.close();
}

async function reloads(browser, server) {
  const name = 'reload after an update';
  // The page is told a service worker controlled it when it loaded; the test then sends the event a new worker causes.
  const hadController = () => { try { Object.defineProperty(navigator.serviceWorker, 'controller', { get: () => ({ scriptURL: location.origin + '/sw.js' }), configurable: true }); } catch (e) { /* no service workers here */ } };
  const takeOver = (page) => page.evaluate(() => { window.__before = true; navigator.serviceWorker.dispatchEvent(new Event('controllerchange')); });
  const p = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
  await p.context.addInitScript(hadController);
  await lib.seedV28(p.context, fx);
  const page = await lib.openApp(p.context, server.url + '/index.html');
  await run.step(name, 'held back while a sheet is open: the Update ready pill shows instead', async () => {
    await lib.openTab(page, 'exercises');
    await page.click('[data-action="new-ex"]'); await page.waitForSelector('#sheet:not([hidden]) #ex-form');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());   // not typing: only the sheet holds it
    need(await page.evaluate(() => !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || document.body).tagName)), 'a box has the keyboard');
    await takeOver(page);
    await lib.sleep(700);
    need(await page.evaluate(() => window.__before === true), 'the page reloaded under an open sheet');
    need(await T.sheetOpen(page), 'the sheet closed');
    need((await T.text(page, '#topbar-right [data-action="reload"]')) === 'Update ready', 'no Update ready pill');
  });
  await run.step(name, 'a tap on Update ready reloads', async () => {
    await T.closeSheet(page);
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#topbar-right [data-action="reload"]')]);
    await page.waitForFunction(() => !!window.__overload && window.__before === undefined, null, { timeout: 15000 });
  });
  await run.step(name, 'with no sheet, no typing and no workout the page reloads by itself', async () => {
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), takeOver(page).catch(() => {})]);   // the page may be gone before the call answers
    await page.waitForFunction(() => !!window.__overload && window.__before === undefined, null, { timeout: 15000 });
    need(!(await T.count(page, '#topbar-right [data-action="reload"]')), 'the pill shows after the reload');
  });
  const problems = p.problems();
  run.say(!problems.length, name, 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
  await p.close();
}

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    await rescues(browser, server);
    await slowStart(browser, server);
    await reloads(browser, server);
  } finally { await browser.close(); await server.stop(); }
  run.done();
})().catch((e) => { console.error(e); process.exit(1); });
