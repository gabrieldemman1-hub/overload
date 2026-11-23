#!/usr/bin/env node
/* Overload 3.0, Settings: what the Backup and Cloud sync cards say and count (review round 3).
 *
 *   node tests/train-settings.js [--port=8412]
 *
 *   - Automatic copies: the line says what is kept (review findings look#2, code#5): one a day for the last 7 days;
 *     one each from before the last import, reset, restore and cloud sign-in; the split copy; the copies from
 *     before the last 3 removals. After two imports one "Before import" is kept, from before the second.
 *   - Storage used counts the data cloud sync brings in (window.__overload.setState, as sync.js delivers it), not
 *     only what the app saved itself (code#7).
 *   - Cloud sync while the sync module has not loaded (here its Firebase files are refused, as on a start
 *     without signal before they were stored) says so in plain words, with no file name (look#11).
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const lib = require('./lib');
const T = require('./train-common');

const args = T.args();
const PORT = Number(args.port) || 8412;
const run = T.runner('train-settings');
const { need, same } = run;
const small = lib.loadFixture('v28-state-small'), heavy = lib.loadFixture('v28-state');
const tmp = T.tempDir('overload-settings-');
const KEPT = 'Kept on this phone: one a day for the last 7 days; one each from before the last import, reset, restore and cloud sign-in; '
  + 'the copy from the split into two apps; and the copies from before the last 3 removals of the old food log.';

async function phoneWith(browser, server, fx) {
  const phone = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
  await lib.seedV28(phone.context, fx);
  const page = await lib.openApp(phone.context, server.url + '/index.html');
  await T.copy(page, 'before-split');
  return { phone, page };
}
const errors = (name, phone) => { const p = phone.problems(); run.say(!p.length, name, 'no page errors, no console errors', p.join(' | ').slice(0, 400)); };
const line = (page, re) => page.evaluate((src) => { const p = [...document.querySelectorAll('#app p')].find((x) => new RegExp(src).test(x.textContent)); return p ? p.textContent : null; }, re.source);

async function copiesLine(browser, server) {
  const name = 'Automatic copies', { phone, page } = await phoneWith(browser, server, small);
  await run.step(name, 'the line names every kind of copy kept, and how many', async () => {
    await lib.openTab(page, 'settings');
    same(await line(page, /^Kept on this phone/), KEPT, 'the line');
    same(await page.evaluate(() => [window.__overloadBackup.KEEP_DAYS, window.__overloadBackup.KEEP_REMOVALS]), [7, 3], 'what backup.js keeps');
    return KEPT;
  });
  await run.step(name, 'two imports: one "Before import" is kept, from before the last one', async () => {
    await page.evaluate(() => { const s = window.__overload.state; s.settings.restSec = 111; window.__overload.save(); });
    for (const rest of [150, 180]) {
      const f = JSON.parse(small.text); f.settings.restSec = rest;
      await lib.openTab(page, 'settings');
      await page.evaluate(() => { document.querySelector('#toast').hidden = true; });
      await page.setInputFiles('#import-file', T.writeFile(tmp, 'overload-backup-' + rest + '.json', JSON.stringify(f)));
      await T.toast(page, /Backup restored/);
    }
    const imports = (await T.copies(page)).filter((m) => m.kind === 'import');
    same(imports.map((m) => m.id), ['before-import'], 'the "Before import" copies');
    same(JSON.parse((await T.copy(page, 'before-import')).text).settings.restSec, 150, 'the rest time in it');
  });
  errors(name, phone); await phone.close();
}

async function meter(browser, server) {
  const name = 'Storage used', { phone, page } = await phoneWith(browser, server, small);
  await run.step(name, 'data cloud sync brings in is counted at once, as it is stored', async () => {
    await page.evaluate((st) => window.__overload.setState(st), heavy.state);
    await lib.openTab(page, 'settings');
    const real = await page.evaluate(() => { let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += k.length + (localStorage.getItem(k) || '').length; } return n; });
    const shown = await page.evaluate(() => { const r = [...document.querySelectorAll('.toggle-row')].find((x) => /Storage used/.test(x.textContent)); const m = r && /([\d,]+) of about/.exec(r.textContent); return m ? +m[1].replace(/,/g, '') : null; });
    need(real > 500000, 'the heavy data is not stored: ' + real);
    same(shown, real, 'the characters Settings counts');
    return shown.toLocaleString() + ' characters';
  });
  errors(name, phone); await phone.close();
}

async function cloudCard(browser, server) {
  const name = 'Cloud sync card', { phone, page } = await phoneWith(browser, server, small);
  await run.step(name, 'without the sync module the card says so in plain words, with no file name', async () => {
    need(!(await page.evaluate(() => !!window.__overloadSync)), 'the sync module loaded');
    await lib.openTab(page, 'settings');
    const t = await T.text(page, '#cloud-card .card');
    same(t, 'Cloud sync is not available right now. It starts when the app opens with signal. Your data stays on this phone.', 'the card');
    need(!/\.js|module/.test(t), 'the card names a file or the module');
    return t;
  });
  // The sync module's own failure is not a page error of the app: leave it out of the count.
  const p = phone.problems().filter((x) => !/sync\.js|gstatic|firebase/i.test(x));
  run.say(!p.length, name, 'no page errors, no console errors (but the sync module\'s own)', p.join(' | ').slice(0, 400));
  await phone.close();
}

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    await copiesLine(browser, server);
    await meter(browser, server);
    await cloudCard(browser, server);
  } finally { await browser.close(); await server.stop(); T.removeDir(tmp); }
  run.done();
})().catch((e) => { console.error(e); T.removeDir(tmp); process.exit(1); });
