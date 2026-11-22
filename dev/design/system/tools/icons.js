// Home Screen icons. Usage: node tools/icons.js
//  1. writes icons.html: the candidates per app at 180 px and at 60 px on a light and a dark wallpaper;
//  2. writes the chosen ones to icons/overload/ and icons/fuel/ as icon.svg, icon-180.png and icon-512.png
//     (PNG rendered with Playwright from the SVG: full-bleed square, opaque, no rounded corners. iOS rounds them.)
//  3. shoots icons.html to shots/icons.png.
// Serves nothing: the pages are loaded from file:// and every other request is aborted.
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const SYS = path.join(__dirname, '..');
const INK = '#0c0d0e', OV = '#ff5a2e', FU = '#c4f03a', LIT = '#ffffff';
const svg = (tile, inner) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="' + tile + '"/>' + inner + '</svg>';
const pt = (cx, cy, r, deg) => (cx + r * Math.cos(deg * Math.PI / 180)).toFixed(1) + ' ' + (cy + r * Math.sin(deg * Math.PI / 180)).toFixed(1);
const arc = (cx, cy, r, from, to) => 'M' + pt(cx, cy, r, from) + 'A' + r + ' ' + r + ' 0 ' + (to - from > 180 ? 1 : 0) + ' 1 ' + pt(cx, cy, r, to);
const rect = (x, y, w, h, rx, fill, extra) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + rx + '" fill="' + fill + '"' + (extra || '') + '/>';

// ---- Overload: vermilion tile ---------------------------------------------------------------
const overload = {
  // A. Instrument's stepped plates: four plates rising along a bar, the tallest one lit.
  plates: { name: 'Stepped plates', note: 'Instrument\'s mark on the accent tile. Ownable, but still reads as signal bars or audio levels before it reads as plates.',
    svg: svg(OV, rect(140, 494, 744, 36, 18, INK, ' opacity=".4"') + rect(206, 402, 120, 220, 30, INK) + rect(368, 332, 120, 360, 30, INK) + rect(530, 262, 120, 500, 30, INK) + rect(692, 192, 120, 640, 30, LIT)) },
  // B. A weight plate seen face-on: three grip slots, hub and bore.
  plate: { name: 'Plate, face-on', note: 'Says "gym" to anyone who has loaded a bar. A circle in a tile: at 60 px it can pass for a record, a tyre or a camera lens, and it makes the two apps the same silhouette.',
    svg: svg(OV, '<circle cx="512" cy="512" r="356" fill="' + INK + '"/>'
      + [-90, 30, 150].map((a) => '<path d="' + arc(512, 512, 262, a - 27, a + 27) + '" fill="none" stroke="' + OV + '" stroke-width="74" stroke-linecap="round"/>').join('')
      + '<circle cx="512" cy="512" r="118" fill="none" stroke="' + OV + '" stroke-width="20"/><circle cx="512" cy="512" r="52" fill="' + OV + '"/>') },
  // C. A loaded barbell, side-on: the plates step up towards the middle (the stepped plates, made into the thing itself).
  barbell: { name: 'Loaded barbell', note: 'The one shape that means lifting at any size. The plates keep Instrument\'s steps; a wide silhouette, so it never pairs with Fuel\'s round one.',
    svg: svg(OV, rect(84, 486, 856, 52, 26, INK) + rect(188, 352, 108, 320, 38, INK) + rect(318, 232, 126, 560, 44, INK) + rect(580, 232, 126, 560, 44, INK) + rect(728, 352, 108, 320, 38, INK)) },
};
// ---- Fuel: volt-green tile -------------------------------------------------------------------
const RIM = arc(512, 512, 318, 132, 408);   // an open ring, 276 degrees, the gap at the bottom
const rim = (lit, w) => '<path d="' + RIM + '" fill="none" stroke="' + INK + '" stroke-width="' + w + '" stroke-linecap="round" opacity=".26"/><path d="' + RIM + '" fill="none" stroke="' + INK + '" stroke-width="' + w + '" stroke-linecap="round" pathLength="100" stroke-dasharray="' + lit + ' 100"/>';
// The chosen mark's geometry (also the source of 'mark-fuel' in shared/icons.js: the same numbers divided by 1024 / 24).
const PLATE = { cx: 606, cy: 512, r: 300 }, LEAF_K = 1.12, FORK_X = 186;
const leafAt = (cx, cy, k) => { const P = (x, y) => (cx + x * k).toFixed(0) + ' ' + (cy + y * k).toFixed(0);
  return { body: 'M' + P(-166, 178) + 'C' + P(-200, -30) + ' ' + P(-67, -178) + ' ' + P(167, -178) + 'C' + P(174, 51) + ' ' + P(34, 202) + ' ' + P(-166, 178) + 'Z', vein: 'M' + P(-96, 108) + 'L' + P(40, -38) }; };
const LEAF = leafAt(PLATE.cx, PLATE.cy, LEAF_K);
const FORK = 'M' + (FORK_X - 50) + ' 236v150a50 50 0 0 0 100 0V236M' + FORK_X + ' 236V788';
const fuel = {
  // A. Instrument's gauge: a half dial in five segments, three lit, with a needle.
  gauge: { name: 'Gauge', note: 'Instrument\'s mark on the accent tile. Reads as a speed test or a car dashboard: "fuel" by pun only, nothing says food.',
    svg: svg(FU, '<path d="' + arc(512, 640, 300, 180, 360) + '" fill="none" stroke="' + INK + '" stroke-width="128" pathLength="100" stroke-dasharray="18 2.5" opacity=".26"/>'
      + '<path d="' + arc(512, 640, 300, 180, 360) + '" fill="none" stroke="' + INK + '" stroke-width="128" pathLength="100" stroke-dasharray="18 2.5 18 2.5 18 100"/>'
      + '<path d="M512 640L' + pt(512, 640, 236, 291) + '" stroke="' + INK + '" stroke-width="40" stroke-linecap="round"/><circle cx="512" cy="640" r="50" fill="' + INK + '"/>') },
  // B. A leaf inside the calorie gauge (the first version's choice).
  leaf: { name: 'Leaf in the gauge', note: 'The rim is the app\'s gauge with a part lit. At 60 px the two-tone arc reads as an eco-mode or battery-saver meter before it reads as food, and the leaf is only a third of the tile.',
    svg: svg(FU, rim(68, 72)
      + '<path d="M361 686C327 478 460 330 694 330C701 559 561 710 361 686Z" fill="' + INK + '"/><path d="M404 643L586 448" fill="none" stroke="' + FU + '" stroke-width="36" stroke-linecap="round"/>') },
  // C. A bolt in the gauge.
  bolt: { name: 'Bolt in a gauge', note: 'Energy, clearly. But a bolt in a ring is the sign for charging, power and fast mode on a phone: it says battery before it says food.',
    svg: svg(FU, rim(68, 84) + '<path d="M566 296L394 544H506L462 728L640 468H524Z" fill="' + INK + '" stroke="' + INK + '" stroke-width="26" stroke-linejoin="round"/>') },
  // D. A fork beside a plate with a leaf on it: the plate solid, the leaf cut out of it in the tile's green.
  plate: { name: 'Fork, plate and leaf', note: 'Food at a glance: a fork says "eat" at any size, the plate is one heavy round shape like Overload\'s plates, and the leaf on it is the tile\'s own green. No meter, so nothing says battery.',
    svg: svg(FU, '<path fill="' + INK + '" fill-rule="evenodd" d="M' + (PLATE.cx - PLATE.r) + ' ' + PLATE.cy + 'a' + PLATE.r + ' ' + PLATE.r + ' 0 1 0 ' + 2 * PLATE.r + ' 0a' + PLATE.r + ' ' + PLATE.r + ' 0 1 0 -' + 2 * PLATE.r + ' 0Z' + LEAF.body + '"/>'
      + '<path d="' + LEAF.vein + '" fill="none" stroke="' + INK + '" stroke-width="32" stroke-linecap="round"/>'
      + '<path d="' + FORK + '" fill="none" stroke="' + INK + '" stroke-width="50" stroke-linecap="round" stroke-linejoin="round"/>') },
};
const CHOSEN = { overload: 'barbell', fuel: 'plate' };

// ---- icons.html ------------------------------------------------------------------------------
const data = (s) => 'data:image/svg+xml,' + encodeURIComponent(s);
const cand = (app, key, c) => '<figure class="cand' + (CHOSEN[app] === key ? ' chosen' : '') + '"><img class="big" src="' + data(c.svg) + '" alt="' + c.name + '"><figcaption><b>' + c.name + (CHOSEN[app] === key ? ' <span>chosen</span>' : '') + '</b>' + c.note + '</figcaption></figure>';
const home = (cls, label) => '<div class="wall ' + cls + '"><p>' + label + '</p><div class="rowi">'
  + Object.keys(overload).map((k) => '<span><img src="' + data(overload[k].svg) + '" alt=""><i>Overload</i></span>').join('')
  + Object.keys(fuel).map((k) => '<span><img src="' + data(fuel[k].svg) + '" alt=""><i>Fuel</i></span>').join('') + '</div>'
  + '<p class="mt">The chosen pair, with neighbours</p><div class="rowi">' + ['#2f6fed', '#1db954', '#f2f2f7', '#111'].map((c) => '<span><b class="ph" style="background:' + c + '"></b><i>App</i></span>').join('')
  + '<span><img src="' + data(overload[CHOSEN.overload].svg) + '" alt=""><i>Overload</i></span><span><img src="' + data(fuel[CHOSEN.fuel].svg) + '" alt=""><i>Fuel</i></span></div>'
  + '<p class="mt">Small: 40 px (Settings, Spotlight) and 29 px (notifications)</p><div class="rowi small"><img src="' + data(overload[CHOSEN.overload].svg) + '" alt=""><img src="' + data(fuel[CHOSEN.fuel].svg) + '" alt=""><img class="xs" src="' + data(overload[CHOSEN.overload].svg) + '" alt=""><img class="xs" src="' + data(fuel[CHOSEN.fuel].svg) + '" alt=""></div></div>';
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Home Screen icons: candidates and choice</title><style>'
  + 'body{margin:0;padding:32px;font:14px/1.45 -apple-system,"Inter",system-ui,sans-serif;background:#16181a;color:#d7dbdf;max-width:1180px}'
  + 'h1{font-size:22px;margin:0 0 4px}h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;margin:32px 0 14px;color:#9aa1a9}p{margin:0 0 12px}.lede{color:#9aa1a9;max-width:820px}'
  + '.cands{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.cands.four{grid-template-columns:repeat(4,1fr)}.cands.four .big{width:150px;height:150px}.cand{margin:0;padding:16px;border:1px solid #2c3035;border-radius:16px}.cand.chosen{border-color:#d7dbdf}'
  + '.big{display:block;width:180px;height:180px;border-radius:22.4%}figcaption{margin-top:12px;color:#9aa1a9;font-size:13px}figcaption b{display:block;color:#f2f3f4;font-size:15px;margin-bottom:2px}figcaption span{font-size:11px;letter-spacing:.08em;text-transform:uppercase;background:#f2f3f4;color:#111;border-radius:4px;padding:1px 6px;margin-left:6px}'
  + '.walls{display:grid;grid-template-columns:1fr 1fr;gap:20px}.wall{border-radius:24px;padding:20px 20px 24px}.wall p{font-size:12px;letter-spacing:.06em;text-transform:uppercase;margin:0 0 14px}.wall p.mt{margin-top:22px}'
  + '.wall.dark{background:linear-gradient(160deg,#101216,#1c2130 60%,#0b0c0f);color:#c9ced6}.wall.light{background:linear-gradient(160deg,#e9eef5,#cfd9e6 55%,#f3ede4);color:#3d4450}'
  + '.rowi{display:flex;gap:18px;flex-wrap:wrap}.rowi span{display:flex;flex-direction:column;align-items:center;gap:6px;width:60px}.rowi img,.ph{display:block;width:60px;height:60px;border-radius:22.4%}.rowi i{font-style:normal;font-size:11px;letter-spacing:0;text-transform:none}'
  + '.rowi.small{align-items:center;gap:14px}.rowi.small img{width:40px;height:40px}.rowi.small img.xs{width:29px;height:29px}'
  + '</style></head><body><h1>Home Screen icons</h1><p class="lede">Each tile is filled with its app\'s accent, so the two are found by colour first and told apart by shape second: Overload is a bar with plates, Fuel is a fork and a plate. The glyph is the dark ink that sits on every accent button in the apps. Shown with the corner mask iOS applies; the files are full-bleed squares.</p>'
  + '<h2>Overload: three candidates at 180 px</h2><div class="cands">' + Object.keys(overload).map((k) => cand('overload', k, overload[k])).join('') + '</div>'
  + '<h2>Fuel: four candidates at 150 px</h2><div class="cands four">' + Object.keys(fuel).map((k) => cand('fuel', k, fuel[k])).join('') + '</div>'
  + '<h2>At 60 px on the Home Screen</h2><div class="walls">' + home('dark', 'Dark wallpaper: all seven') + home('light', 'Light wallpaper: all seven') + '</div>'
  + '</body></html>\n';

(async () => {
  fs.writeFileSync(path.join(SYS, 'icons.html'), html);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1244, height: 900 }, deviceScaleFactor: 2 });
    await ctx.route('**/*', (r) => (/^(file|data):/.test(r.request().url()) ? r.continue() : r.abort()));
    const page = await ctx.newPage();
    await page.goto('file://' + path.join(SYS, 'icons.html'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SYS, 'shots', 'icons.png'), fullPage: true });
    await ctx.close();
    for (const [app, set] of [['overload', overload], ['fuel', fuel]]) {
      const dir = path.join(SYS, 'icons', app); fs.mkdirSync(dir, { recursive: true });
      const s = set[CHOSEN[app]].svg; fs.writeFileSync(path.join(dir, 'icon.svg'), s + '\n');
      for (const size of [180, 512]) {
        const c = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
        await c.route('**/*', (r) => (/^(file|data|about):/.test(r.request().url()) ? r.continue() : r.abort()));
        const p = await c.newPage();
        await p.goto('file://' + path.join(dir, 'icon.svg'));
        await p.screenshot({ path: path.join(dir, 'icon-' + size + '.png'), omitBackground: false, clip: { x: 0, y: 0, width: size, height: size } });
        await c.close();
      }
    }
  } finally { await browser.close(); }
  console.log('icons.html, shots/icons.png, icons/overload, icons/fuel written');
  if (process.argv.includes('--mark')) {   // the chosen Fuel mark on the 24 px grid, for 'mark-fuel' in shared/icons.js
    const q = (n) => (Math.round(n * 24 / 1024 * 100) / 100).toString(), sc = (d) => d.replace(/-?\d+(\.\d+)?/g, (m) => q(+m));
    const r = q(PLATE.r), l = leafAt(PLATE.cx, PLATE.cy, LEAF_K);
    console.log('<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M' + q(PLATE.cx - PLATE.r) + ' ' + q(PLATE.cy) + 'a' + r + ' ' + r + ' 0 1 0 ' + q(2 * PLATE.r) + ' 0a' + r + ' ' + r + ' 0 1 0 -' + q(2 * PLATE.r) + ' 0Z' + sc(l.body) + '"/>'
      + '<path d="' + sc(l.vein) + '" stroke-width="' + q(32) + '"/><path d="M' + q(FORK_X - 50) + ' ' + q(236) + 'v' + q(150) + 'a' + q(50) + ' ' + q(50) + ' 0 0 0 ' + q(100) + ' 0V' + q(236) + 'M' + q(FORK_X) + ' ' + q(236) + 'V' + q(788) + '" stroke-width="' + q(50) + '"/>');
  }
})().catch((e) => { console.error(e); process.exit(1); });
