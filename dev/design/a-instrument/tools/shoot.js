// Renders every mockup with Playwright. Usage: node tools/shoot.js [name-filter]
// Starts its own static server on 127.0.0.1:8360 and stops it when done. Nothing leaves the machine.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..'), PORT = 8360, BASE = 'http://127.0.0.1:' + PORT + '/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
const SCREENS = ['train-today', 'train-workout', 'train-feedback', 'train-history', 'train-program', 'train-settings', 'fuel-today', 'fuel-add', 'fuel-amount', 'fuel-trends', 'fuel-welcome'];
const PAGES = SCREENS.concat(['icons', 'components']);
const NARROW = ['train-workout', 'fuel-today'];
const filter = process.argv[2];

async function audit(page, label) {
  // Layout checks the eye misses: sideways overflow, clipped text, tap targets under 44 px.
  const r = await page.evaluate(() => {
    const out = { overflowX: document.documentElement.scrollWidth - window.innerWidth, small: [], clipped: [] };
    const vis = (el) => { const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && el.getClientRects().length; };
    document.querySelectorAll('button, a[href], input, select, [role=switch]').forEach((el) => {
      if (!vis(el) || el.disabled) return;
      const b = el.getBoundingClientRect();
      if (b.width < 43.5 || b.height < 43.5) out.small.push((el.className || el.tagName) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height) + ' "' + (el.textContent || el.value || '').trim().slice(0, 18) + '"');
    });
    document.querySelectorAll('.screen *, .sheet-panel *, .topbar *, .tabbar *, .rest-timer *').forEach((el) => {
      if (!vis(el) || el.children.length || !el.textContent.trim()) return;
      const s = getComputedStyle(el);
      if (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none') return;
      if (el.scrollWidth > el.clientWidth + 1 && s.overflow !== 'visible') out.clipped.push((el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 24) + '"');
      const b = el.getBoundingClientRect();
      if (b.right > window.innerWidth + 0.5 || b.left < -0.5) out.clipped.push('off-screen: ' + (el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 24) + '"');
    });
    // Text contrast as rendered: every text node against the nearest painted background (WCAG AA: 4.5, or 3 for large text).
    const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const mix = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat([1]); };
    const bgOf = (el) => { const stack = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } } let base = [255, 255, 255, 1]; for (let i = stack.length - 1; i >= 0; i--) base = mix(stack[i], base); return base; };
    out.low = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue.trim()) continue;
      const el = node.parentElement; if (!el || !vis(el) || el.closest('script, style, [disabled], [aria-hidden="true"], .idle, svg')) continue;
      let op = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
      if (op < 1) continue;   // dimmed on purpose: inactive
      const s = getComputedStyle(el), bg = bgOf(el), fg = mix(parse(s.color), bg);
      const r = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
      const size = parseFloat(s.fontSize), large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
      if (r < (large ? 3 : 4.5)) out.low.push(r.toFixed(2) + ' "' + node.nodeValue.trim().slice(0, 20) + '" (' + (el.className || el.tagName) + ', ' + size + 'px)');
    }
    return out;
  });
  const msgs = [];
  if (r.low.length) msgs.push('low contrast: ' + [...new Set(r.low)].join(' | '));
  if (r.overflowX > 0) msgs.push('sideways overflow ' + r.overflowX + 'px');
  if (r.small.length) msgs.push('small targets: ' + r.small.join(' | '));
  if (r.clipped.length) msgs.push('clipped: ' + r.clipped.join(' | '));
  if (msgs.length) console.log('  ! ' + label + ': ' + msgs.join('\n      '));
}

(async () => {
  await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));
  const browser = await chromium.launch();
  const shots = path.join(ROOT, 'shots');
  fs.mkdirSync(path.join(shots, 'full'), { recursive: true });
  const ctx = async (w, h) => {
    const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await c.route('**/*', (route) => (route.request().url().startsWith('http://127.0.0.1') ? route.continue() : route.abort()));
    return c;
  };
  try {
    for (const theme of ['dark', 'light']) {
      const c = await ctx(390, 844);
      for (const name of PAGES) {
        if (filter && !name.includes(filter)) continue;
        const page = await c.newPage();
        page.on('console', (m) => { if (m.type() === 'error') console.log('  console error on ' + name + ': ' + m.text()); });
        page.on('requestfailed', (r) => console.log('  request failed on ' + name + ': ' + r.url()));
        await page.goto(BASE + name + '.html?theme=' + theme, { waitUntil: 'networkidle' });
        const y = await page.evaluate(() => Number(document.documentElement.getAttribute('data-shot-scroll') || 0));
        if (y) await page.evaluate((v) => window.scrollTo(0, v), y);
        await page.waitForTimeout(120);
        await page.screenshot({ path: path.join(shots, name + '-' + theme + '.png') });
        await audit(page, name + ' ' + theme + ' 390');
        // The whole page in one image: grow the viewport to the page height, so the fixed bars sit at the real bottom.
        if (y) await page.evaluate(() => window.scrollTo(0, 0));
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        if (h > 844) { await page.setViewportSize({ width: 390, height: h }); await page.waitForTimeout(80); await page.screenshot({ path: path.join(shots, 'full', name + '-' + theme + '-full.png') }); await page.setViewportSize({ width: 390, height: 844 }); }
        await page.close();
      }
      await c.close();
      const n = await ctx(320, 844);
      for (const name of NARROW) {
        if (filter && !name.includes(filter)) continue;
        const page = await n.newPage();
        await page.goto(BASE + name + '.html?theme=' + theme, { waitUntil: 'networkidle' });
        const y = await page.evaluate(() => Number(document.documentElement.getAttribute('data-shot-scroll') || 0));
        if (y) await page.evaluate((v) => window.scrollTo(0, v), y);
        await page.waitForTimeout(120);
        await page.screenshot({ path: path.join(shots, name + '-320-' + theme + '.png') });
        await audit(page, name + ' ' + theme + ' 320');
        await page.close();
      }
      await n.close();
    }
    // Every screen at 320 and 430 wide, for the audit only (dark): nothing may break at either width.
    for (const w of [320, 430]) {
      const c = await ctx(w, 844);
      for (const name of SCREENS) {
        if (filter && !name.includes(filter)) continue;
        const page = await c.newPage();
        await page.goto(BASE + name + '.html', { waitUntil: 'networkidle' });
        await audit(page, name + ' dark ' + w);
        if (w === 430) { fs.mkdirSync(path.join(shots, 'wide'), { recursive: true }); await page.screenshot({ path: path.join(shots, 'wide', name + '-430-dark.png') }); }
        await page.close();
      }
      await c.close();
    }
    // Contact sheets: the eleven screens in one image per theme.
    if (!filter) {
      for (const theme of ['dark', 'light']) {
        const c = await browser.newContext({ viewport: { width: 1380, height: 1000 }, deviceScaleFactor: 2 });
        await c.route('**/*', (route) => (route.request().url().startsWith('http://127.0.0.1') ? route.continue() : route.abort()));
        const page = await c.newPage();
        await page.goto(BASE + 'tools/contact.html?theme=' + theme, { waitUntil: 'networkidle' });
        await page.screenshot({ path: path.join(shots, 'contact-' + theme + '.png'), fullPage: true });
        await c.close();
      }
    }
  } finally { await browser.close(); server.close(); }
  console.log('done');
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
