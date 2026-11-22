// Renders every reference screen with Playwright and audits it. Usage: node tools/shoot.js [name-filter] [--no-contact] [--port 8449]
// Serves the repository root with "python3 -m http.server <port> --bind 127.0.0.1" and stops it when done.
// Every request that is not to 127.0.0.1 is aborted. Nothing leaves the machine.
// The audit (per page, theme and width): sideways overflow, clipped text, tap targets under 44 px, text under 11 px,
// the contrast of every text node as rendered (AA: 4.5, or 3 for large text), a button label that runs to a second line,
// an input whose value is wider than its box, a top bar whose parts overlap or whose title has collapsed, and a toast
// that is stretched or sits on a sheet's controls. It can be pointed at the real app:
//   node tools/shoot.js --url http://127.0.0.1:8449/index.html
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const SYS = path.join(__dirname, '..'), ROOT = path.join(SYS, '..', '..', '..');
const args = process.argv.slice(2), noContact = args.includes('--no-contact');
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const urlArg = opt('--url'), PORT = Number(opt('--port') || 8449);
const filter = args.find((a, i) => !a.startsWith('--') && !['--url', '--port'].includes(args[i - 1]));
const BASE = 'http://127.0.0.1:' + PORT + '/dev/design/system/';
const PAGES = JSON.parse(fs.readFileSync(path.join(__dirname, 'pages.json'), 'utf8'));
const WIDTHS = ['train-workout', 'train-workout-long', 'train-today-handover', 'fuel-today', 'fuel-add', 'fuel-amount', 'fuel-welcome'];   // also shot at 320 and 430

const { audit } = require('./audit.js');   // the checks themselves: one function, also usable on the running app

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((ok) => setTimeout(ok, 700));
  const browser = await chromium.launch();
  const shots = path.join(SYS, 'shots');
  fs.mkdirSync(path.join(shots, 'full'), { recursive: true });
  const ctx = async (w, h) => {
    const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: true });
    await c.route('**/*', (route) => (route.request().url().startsWith('http://127.0.0.1') ? route.continue() : route.abort()));
    return c;
  };
  const open = async (c, url) => {
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.log('  console error on ' + url + ': ' + m.text()); });
    page.on('requestfailed', (q) => console.log('  request failed on ' + url + ': ' + q.url()));
    await page.goto(url, { waitUntil: 'networkidle' });
    const y = await page.evaluate(() => Number(document.documentElement.getAttribute('data-shot-scroll') || 0));
    if (y) await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(100);
    return { page, y };
  };
  let problems = 0;
  try {
    if (urlArg) {   // audit any page (the real app) at the three widths, both themes as the page sets them
      for (const w of [320, 390, 430]) { const c = await ctx(w, 844); const { page } = await open(c, urlArg); problems += await audit(page, urlArg + ' ' + w); await c.close(); }
      return;
    }
    for (const theme of ['dark', 'light']) {
      const c = await ctx(390, 844);
      for (const name of PAGES) {
        if (filter && !name.includes(filter)) continue;
        const { page, y } = await open(c, BASE + name + '.html?theme=' + theme);
        await page.screenshot({ path: path.join(shots, name + '-' + theme + '.png') });
        problems += await audit(page, name + ' ' + theme + ' 390');
        // The whole page in one image: grow the viewport to the page height, so the fixed bars sit at the real bottom.
        if (y) await page.evaluate(() => window.scrollTo(0, 0));
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        if (h > 850 && !(await page.evaluate(() => { const s = document.getElementById('sheet'); return s && !s.hidden; }))) {
          await page.setViewportSize({ width: 390, height: h }); await page.waitForTimeout(60);
          await page.screenshot({ path: path.join(shots, 'full', name + '-' + theme + '-full.png') });
        }
        await page.close();
      }
      await c.close();
      for (const w of [320, 430]) {
        const n = await ctx(w, 844);
        for (const name of PAGES) {
          if (filter && !name.includes(filter)) continue;
          const { page } = await open(n, BASE + name + '.html?theme=' + theme);
          if (WIDTHS.includes(name)) await page.screenshot({ path: path.join(shots, name + '-' + w + '-' + theme + '.png') });
          problems += await audit(page, name + ' ' + theme + ' ' + w);   // every screen is audited at 320 and 430, only three are kept as pictures
          await page.close();
        }
        await n.close();
      }
    }
    if (!filter && !noContact) {
      for (const theme of ['dark', 'light']) {
        const c = await browser.newContext({ viewport: { width: 1560, height: 1000 }, deviceScaleFactor: 1.5 });
        await c.route('**/*', (route) => (route.request().url().startsWith('http://127.0.0.1') ? route.continue() : route.abort()));
        const page = await c.newPage();
        await page.goto(BASE + 'tools/contact.html?theme=' + theme, { waitUntil: 'networkidle' });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(shots, 'contact-' + theme + '.png'), fullPage: true });
        await c.close();
      }
    }
  } finally { await browser.close(); server.kill(); }
  console.log(problems ? 'done, ' + problems + ' page(s) with findings' : 'done, no findings');
})().catch((e) => { console.error(e); process.exit(1); });
