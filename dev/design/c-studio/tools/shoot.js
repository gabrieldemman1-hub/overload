// Renders every mockup to shots/ with Playwright (chromium), dark and light, at 390x844 @2x.
// Usage: node tools/shoot.js [port] [name-filter]   (serves the folder itself on 127.0.0.1 and stops when done)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const port = Number(process.argv[2] || 8370);
const filter = process.argv[3] || '';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
const SCREENS = ['train-today', 'train-workout', 'train-feedback', 'train-history', 'train-program', 'train-settings', 'fuel-today', 'fuel-add', 'fuel-amount', 'fuel-trends', 'fuel-welcome'];

(async () => {
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + port + '/';
  const browser = await chromium.launch();
  const open = async (w, h) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, serviceWorkers: 'block', reducedMotion: 'reduce' });
    await ctx.route('**/*', (r) => (r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort()));
    return ctx;
  };
  const out = (n) => path.join(root, 'shots', n);
  const want = (n) => !filter || n.includes(filter);
  const overflow = [];
  for (const [w, names] of [[390, SCREENS.concat('icons', 'components')], [320, ['train-workout', 'fuel-today']], [430, ['train-workout', 'fuel-today']]]) {
    const ctx = await open(w, 844);
    const page = await ctx.newPage();
    for (const name of names.filter(want)) {
      for (const theme of ['dark', 'light']) {
        await page.goto(base + name + '.html?theme=' + theme);
        await page.waitForLoadState('networkidle');
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        if (sw > w) overflow.push(name + ' @' + w + ' ' + theme + ': scrollWidth ' + sw);
        const suffix = w === 390 ? '' : '-' + w;
        if (name !== 'icons' && name !== 'components') await page.screenshot({ path: out(name + suffix + '-' + theme + '.png') });
        if (w === 390) {   // the whole page: grow the viewport instead of fullPage, so the fixed bars stay at the top and bottom
          const h = await page.evaluate(() => document.documentElement.scrollHeight);
          await page.setViewportSize({ width: w, height: Math.max(844, h) });
          await page.screenshot({ path: out(name + '-' + theme + (name === 'icons' || name === 'components' ? '' : '-full') + '.png') });
          await page.setViewportSize({ width: w, height: 844 });
        }
      }
    }
    await ctx.close();
  }
  // Contact sheets: the eleven phone screens side by side.
  if (!filter) {
    for (const theme of ['dark', 'light']) {
      for (const kind of ['', '-full']) {
        const bg = theme === 'dark' ? '#0B0A09' : '#E7E1D5', fg = theme === 'dark' ? '#C9C0B2' : '#4F483E';
        const cell = (n) => '<figure><img src="' + n + '-' + theme + kind + '.png"><figcaption>' + n + '</figcaption></figure>';
        const row = (label, list) => '<h2>' + label + '</h2><div>' + list.map(cell).join('') + '</div>';
        const html = '<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:28px 28px 8px;background:' + bg + ';font:600 13px -apple-system,system-ui,sans-serif;color:' + fg + '}h2{margin:0 0 14px;font-size:13px;letter-spacing:.14em;text-transform:uppercase}div{display:flex;gap:20px;align-items:flex-start;margin-bottom:28px}figure{margin:0}img{display:block;width:300px;border-radius:26px}figcaption{margin-top:10px;text-align:center;letter-spacing:.02em}</style>'
          + row('Overload', SCREENS.filter((n) => n.startsWith('train'))) + row('Fuel', SCREENS.filter((n) => n.startsWith('fuel')));
        fs.writeFileSync(out('_contact.html'), html);
        const ctx = await open(6 * 320 + 36, 760);
        const page = await ctx.newPage();
        await page.goto(base + 'shots/_contact.html');
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: out('contact' + kind + '-' + theme + '.png'), fullPage: true });
        await ctx.close();
      }
    }
    fs.unlinkSync(out('_contact.html'));
  }
  await browser.close();
  server.close();
  console.log(overflow.length ? 'HORIZONTAL OVERFLOW:\n  ' + overflow.join('\n  ') : 'no horizontal overflow');
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
