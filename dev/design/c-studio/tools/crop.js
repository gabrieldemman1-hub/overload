// One-off helper: screenshot part of a page. node tools/crop.js <page.html?theme=light> <out.png> <y> <height> [width]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const [, , url, out, y, h, w] = process.argv;
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': T[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
(async () => {
  await new Promise((r) => server.listen(8371, '127.0.0.1', r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: Number(w || 390), height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await ctx.route('**/*', (r) => (r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:8371/' + url);
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: Number(w || 390), height: full });
  await page.screenshot({ path: out, clip: { x: 0, y: Number(y), width: Number(w || 390), height: Math.min(Number(h), full - Number(y)) } });
  await browser.close(); server.close();
})();
