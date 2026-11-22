// Renders the mockups to shots/. Usage: node tools/shoot.js [port] [name-filter]
// Serve the folder first: python3 -m http.server 8365 --bind 127.0.0.1 --directory <this folder>
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const port = process.argv[2] || '8365', only = process.argv[3] || '';
const base = `http://127.0.0.1:${port}/`, out = path.join(__dirname, '..', 'shots');
const phones = ['train-today', 'train-workout', 'train-feedback', 'train-history', 'train-program', 'train-settings', 'fuel-today', 'fuel-add', 'fuel-amount', 'fuel-trends', 'fuel-welcome'];
const full = ['train-today', 'train-workout', 'train-feedback', 'train-history', 'train-program', 'train-settings', 'fuel-today', 'fuel-trends'];
const narrow = ['train-workout', 'fuel-today'];

(async () => {
  const browser = await chromium.launch();
  const ctxFor = async (width, height) => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    await ctx.route('**/*', (r) => (r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort()));
    return ctx;
  };
  const shot = async (ctx, name, theme, file, opts = {}, query = '') => {
    const p = await ctx.newPage();
    const errs = [];
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('requestfailed', (r) => errs.push('failed ' + r.url()));
    await p.goto(`${base}${name}.html?theme=${theme}${query}`, { waitUntil: 'networkidle' });
    await p.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    // overflow check: nothing may be wider than the viewport
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 0) console.log('  !! horizontal overflow', name, theme, over, 'px');
    if (opts.fullPage) {
      // Grow the viewport to the page instead of stitching, so the fixed bars sit at the bottom of the image.
      const h = await p.evaluate(() => document.documentElement.scrollHeight);
      await p.setViewportSize({ width: p.viewportSize().width, height: Math.max(h, p.viewportSize().height) });
      await p.screenshot({ path: path.join(out, file) });
    } else await p.screenshot({ path: path.join(out, file), ...opts });
    if (errs.length) console.log('  !!', name, errs.join(' | '));
    await p.close();
  };
  for (const theme of ['dark', 'light']) {
    const ctx = await ctxFor(390, 844);
    for (const name of phones) {
      if (only && !name.includes(only)) continue;
      await shot(ctx, name, theme, `${name}-${theme}.png`);
      if (full.includes(name)) await shot(ctx, name, theme, `${name}-${theme}-full.png`, { fullPage: true });
    }
    await ctx.close();
    const small = await ctxFor(320, 568);
    for (const name of narrow) { if (only && !name.includes(only)) continue; await shot(small, name, theme, `${name}-320-${theme}.png`); await shot(small, name, theme, `${name}-320-${theme}-full.png`, { fullPage: true }); }
    await small.close();
    const wide = await ctxFor(430, 932);
    for (const name of narrow) { if (only && !name.includes(only)) continue; await shot(wide, name, theme, `${name}-430-${theme}.png`); }
    await wide.close();
    if (!only || 'components'.includes(only)) {
      const k = await ctxFor(390, 844);
      await shot(k, 'components', theme, `components-${theme}.png`, { fullPage: true });
      await shot(k, 'components', theme, `components-fuel-${theme}.png`, { fullPage: true }, '&app=fuel');
      await k.close();
    }
    if (!only || 'icons'.includes(only)) {
      const ic = await ctxFor(390, 844); await shot(ic, 'icons', theme, `icons-${theme}.png`, { fullPage: true }); await ic.close();
      const icw = await ctxFor(1100, 800); await shot(icw, 'icons', theme, `icons-wide-${theme}.png`, { fullPage: true }); await icw.close();
    }
    if (!only || 'contact'.includes(only)) {
      const c = await browser.newContext({ viewport: { width: 11 * 250 + 12 * 20, height: 620 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
      await c.route('**/*', (r) => (r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort()));
      const p = await c.newPage();
      await p.goto(`${base}shots/contact.html?theme=${theme}`, { waitUntil: 'networkidle' });
      await p.screenshot({ path: path.join(out, `contact-${theme}.png`), fullPage: true });
      await c.close();
    }
  }
  await browser.close();
})();
