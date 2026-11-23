// Builds the mockups: wraps each fragment in src/ with the shared shell (head, icon sprite, top bar, tab bar)
// and writes one plain HTML file per screen next to tokens.css. No dependencies. Usage: node tools/build.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const sprite = fs.readFileSync(path.join(root, 'icons.svg'), 'utf8').replace(/<!--[\s\S]*?-->\s*/g, '').trim();

const appIcons = fs.readFileSync(path.join(root, 'app-icons.svg'), 'utf8').replace(/<!--[\s\S]*?-->\s*/g, '').trim();

// Stand-alone icon files for the manifests, cut from the same sprite.
for (const name of ['overload', 'fuel']) {
  const defs = /<defs>[\s\S]*?<\/defs>/.exec(appIcons)[0];
  const sym = new RegExp('<symbol id="app-' + name + '"[^>]*>([\\s\\S]*?)</symbol>').exec(appIcons)[1];
  fs.writeFileSync(path.join(root, 'icon-' + name + '.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">\n  ' + defs + sym.replace(/\n    /g, '\n  ') + '</svg>\n');
}

// ---- Charts: plain inline SVG, generated from the numbers so the geometry is exact. ----
const r1 = (n) => Math.round(n * 10) / 10;
// A bar with a 4px round data end and a square foot on the baseline.
const bar = (x, y, w, base, cls) => { const r = Math.min(4, w / 2, base - y); return '<path class="c-bar' + (cls ? ' ' + cls : '') + '" d="M' + r1(x) + ' ' + base + 'V' + r1(y + r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' -' + r + 'h' + r1(w - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r + 'V' + base + 'z"/>'; };

const CHARTS = {
  // Fuel Trends: 14 days of calories against the target.
  kcal() {
    const days = [['F', 2710], ['S', 2940], ['S', null], ['M', 2560], ['T', 2480], ['W', 2630], ['T', 2590], ['F', 2720], ['S', 3050], ['S', null], ['M', 2540], ['T', 2610], ['W', 2470], ['T', 1391]];
    const W = 310, PW = 270, top = 8, base = 140, max = 3200, slot = PW / 14, bw = 12, target = 2600;   // PW: plot width, the rest is the label margin
    const y = (v) => base - (v / max) * (base - top);
    let o = '<svg class="chart" viewBox="0 0 ' + W + ' 176" role="img" aria-label="Calories for the last 14 days against the 2,600 target. This week so far: 2,540, 2,610, 2,470 and 1,391 today.">';
    days.forEach(([d, v], i) => {
      const x = i * slot + (slot - bw) / 2, thisWeek = i >= 10, today = i === 13;
      if (v == null) o += '<circle cx="' + r1(x + bw / 2) + '" cy="' + (base - 5) + '" r="2" fill="none" stroke="var(--ink-4)" stroke-width="1.5"/>';
      else if (today) o += '<path d="M' + r1(x + 0.75) + ' ' + base + 'V' + r1(y(v) + 4) + 'a3.25 3.25 0 0 1 3.25 -3.25h' + r1(bw - 8) + 'a3.25 3.25 0 0 1 3.25 3.25V' + base + '" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.5"/>';
      else o += bar(x, y(v), bw, base, thisWeek ? 'on' : '');
      o += '<text x="' + r1(x + bw / 2) + '" y="' + (base + 16) + '" text-anchor="middle"' + (today ? ' style="fill:var(--ink);font-weight:700"' : '') + '>' + d + '</text>';
    });
    o += '<line class="c-base" x1="0" x2="' + PW + '" y1="' + base + '" y2="' + base + '"/>';
    o += '<line class="c-target" x1="0" x2="' + (PW + 4) + '" y1="' + r1(y(target)) + '" y2="' + r1(y(target)) + '"/>';
    o += '<text class="c-label" x="' + W + '" y="' + r1(y(target) + 4) + '" text-anchor="end">2,600</text><text x="' + W + '" y="' + r1(y(target) + 17) + '" text-anchor="end">target</text>';
    o += '<text class="c-label" x="' + W + '" y="' + r1(y(1391) + 9) + '" text-anchor="end">1,391</text><text x="' + W + '" y="' + r1(y(1391) + 22) + '" text-anchor="end">so far</text>';
    // week brackets under the day letters
    o += '<text x="' + r1(3 * slot + 2) + '" y="' + (base + 33) + '">Last week</text><text class="c-label" x="' + r1(10 * slot + 2) + '" y="' + (base + 33) + '" style="font-size:11px">This week</text>';
    return o + '</svg>';
  },
  // Overload History: top set per session for one exercise. The deload sits off the line as a hollow dot.
  press() {
    const pts = [['Aug 27', 135], ['Sep 3', 135], ['Sep 10', 140], ['Sep 17', 140], ['Sep 24', 140], ['Oct 1', 145], ['Oct 8', 145], ['Oct 15', 145], ['Oct 22', 130, 'deload'], ['Oct 29', 145], ['Nov 5', 150], ['Nov 12', 150]];
    const W = 310, top = 34, base = 132, lo = 127.5, hi = 152.5, x0 = 6, x1 = 270;
    const x = (i) => x0 + (i * (x1 - x0)) / (pts.length - 1), y = (v) => base - ((v - lo) / (hi - lo)) * (base - top);
    let o = '<svg class="chart" viewBox="0 0 ' + W + ' 156" role="img" aria-label="Machine Chest Press top set, last 12 sessions: 135 lb on Aug 27 to 150 lb on Nov 12, with a deload at 130 lb on Oct 22.">';
    [130, 140, 150].forEach((v) => { o += '<line class="c-grid" x1="0" x2="' + (W - 28) + '" y1="' + r1(y(v)) + '" y2="' + r1(y(v)) + '"/><text x="' + W + '" y="' + r1(y(v) + 4) + '" text-anchor="end">' + v + '</text>'; });
    const line = pts.map((p, i) => [x(i), y(p[1]), p[2]]).filter((p) => !p[2]);
    o += '<path class="c-area" d="M' + line.map((p) => r1(p[0]) + ' ' + r1(p[1])).join('L') + 'V' + base + 'H' + r1(line[0][0]) + 'z"/>';
    o += '<path class="c-line" d="M' + line.map((p) => r1(p[0]) + ' ' + r1(p[1])).join('L') + '"/>';
    pts.forEach((p, i) => { if (p[2]) o += '<circle class="c-dot hollow" cx="' + r1(x(i)) + '" cy="' + r1(y(p[1])) + '" r="4"/><text x="' + r1(x(i)) + '" y="' + r1(y(p[1]) + 17) + '" text-anchor="middle">deload</text>'; });
    const last = pts.length - 1, lx = x(last), ly = y(pts[last][1]);
    o += '<line class="c-cursor" x1="' + r1(lx) + '" x2="' + r1(lx) + '" y1="' + r1(ly) + '" y2="' + base + '"/>';
    o += '<circle class="c-dot end" cx="' + r1(lx) + '" cy="' + r1(ly) + '" r="5.5"/>';
    o += '<g class="c-tip" transform="translate(' + r1(lx - 134) + ' 0)"><rect width="142" height="26" rx="13"/><text x="71" y="17" text-anchor="middle">150 lb × 12 · Nov 12</text></g>';
    [0, 5, 11].forEach((i) => { o += '<text x="' + r1(x(i)) + '" y="' + (base + 18) + '" text-anchor="' + (i === 0 ? 'start' : i === 11 ? 'end' : 'middle') + '">' + pts[i][0] + '</text>'; });
    return o + '</svg>';
  },
  // Overload History: daily weigh-ins as quiet dots, the 7-day running average as the line.
  weight() {
    const n = 30; let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const all = []; for (let i = -6; i < n; i++) all.push(i === 9 || i === 10 || i === 22 ? null : 184.3 - (1.9 * i) / (n - 1) + (rnd() - 0.5) * 1.5);   // six earlier days feed the first averages
    all[all.length - 1] = 182.4;
    const raw = all.slice(6);
    const avg = raw.map((_, i) => { const w = all.slice(i, i + 7).filter((v) => v != null); return w.reduce((a, b) => a + b, 0) / w.length; });
    const W = 310, top = 8, base = 112, lo = 181.4, hi = 185.4, x0 = 4, x1 = 268;
    const x = (i) => x0 + (i * (x1 - x0)) / (n - 1), y = (v) => base - ((v - lo) / (hi - lo)) * (base - top);
    let o = '<svg class="chart" viewBox="0 0 ' + W + ' 136" role="img" aria-label="Body weight for 30 days: running average from 184.4 lb to 182.8 lb.">';
    [182, 183, 184, 185].forEach((v) => { o += '<line class="c-grid" x1="0" x2="' + (W - 28) + '" y1="' + r1(y(v)) + '" y2="' + r1(y(v)) + '"/><text x="' + W + '" y="' + r1(y(v) + 4) + '" text-anchor="end">' + v + '</text>'; });
    raw.forEach((v, i) => { if (v != null) o += '<circle class="c-dot raw" cx="' + r1(x(i)) + '" cy="' + r1(y(v)) + '" r="2"/>'; });
    o += '<path class="c-line" d="M' + avg.map((v, i) => r1(x(i)) + ' ' + r1(y(v))).join('L') + '"/>';
    o += '<circle class="c-dot end" cx="' + r1(x(n - 1)) + '" cy="' + r1(y(avg[n - 1])) + '" r="5"/>';
    [[0, 'Oct 21', 'start'], [15, 'Nov 5', 'middle'], [29, 'Nov 19', 'end']].forEach(([i, t, a]) => { o += '<text x="' + r1(x(i)) + '" y="' + (base + 18) + '" text-anchor="' + a + '">' + t + '</text>'; });
    return o + '</svg>';
  },
};

// {{name}} or {{name cls cls}} becomes an icon.
const icons = (html) => html.replace(/\{\{([a-z-]+)((?: [a-z-]+)*)\}\}/g, (_, n, c) => '<svg class="i' + c + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>');

const TABS = {
  overload: [['today', 'plate', 'Today'], ['program', 'program', 'Program'], ['exercises', 'dumbbell', 'Exercises'], ['history', 'history', 'History'], ['settings', 'settings', 'Settings']],
  fuel: [['today', 'dish', 'Today'], ['trends', 'bars', 'Trends'], ['settings', 'settings', 'Settings']],
};
const BRAND = { overload: ['plate', 'Overload'], fuel: ['dish', 'Fuel'] };
const STATUS = '<div class="m-status" aria-hidden="true"><span>9:41</span><svg viewBox="0 0 68 13"><rect x="0" y="8" width="3" height="5" rx="1"/><rect x="4.5" y="6" width="3" height="7" rx="1"/><rect x="9" y="3.5" width="3" height="9.5" rx="1"/><rect x="13.5" y="1" width="3" height="12" rx="1"/><path d="M30 3.2a8.6 8.6 0 0 1 6 2.4l-1.2 1.3a6.8 6.8 0 0 0-9.6 0L24 5.6a8.6 8.6 0 0 1 6-2.4zm0 3.6c1.4 0 2.6.5 3.6 1.4l-1.3 1.3a3.3 3.3 0 0 0-4.6 0l-1.3-1.3c1-.9 2.2-1.4 3.6-1.4zm0 3.4c.6 0 1.1.2 1.5.6L30 12.4l-1.5-1.6c.4-.4.9-.6 1.5-.6z"/><rect x="43" y="1" width="21" height="11.5" rx="3.4" fill="none" stroke="currentColor" stroke-opacity=".45"/><rect x="44.7" y="2.7" width="17.6" height="8.1" rx="2"/><rect x="65.3" y="4.6" width="1.6" height="4.3" rx=".8" fill-opacity=".5"/></svg></div>';

for (const file of fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.html')).sort()) {
  const raw = fs.readFileSync(path.join(root, 'src', file), 'utf8');
  const m = /^<!--(\{.*?\})-->\n/.exec(raw);
  if (!m) throw new Error(file + ': missing config comment');
  const cfg = JSON.parse(m[1]);
  let [main, overlay = ''] = raw.slice(m[0].length).split('<!--overlay-->');
  if (cfg.base) main = fs.readFileSync(path.join(root, 'src', cfg.base + '.html'), 'utf8').replace(/^<!--\{.*?\}-->\n/, '').split('<!--overlay-->')[0];   // a sheet shown over another screen
  const fill = (h) => h.replace(/<!--chart:(\w+)-->/g, (_, n) => CHARTS[n]())
    .replace('<!--icon-grid-->', () => [...sprite.matchAll(/<symbol id="i-([a-z-]+)"/g)].map((x) => '<div class="icon-cell">{{' + x[1] + '}}' + x[1] + '</div>').join('\n'));
  main = fill(main); overlay = fill(overlay);
  const chrome = cfg.chrome !== 'none';
  const b = BRAND[cfg.app];
  const top = chrome ? '<header class="topbar">\n  <div class="brand">{{' + b[0] + '}}' + b[1] + '</div>\n  <div class="topbar-actions">' + (cfg.actions || '<button class="icon-btn" aria-label="Cloud sync: up to date">{{cloud}}</button>') + '</div>\n</header>\n' : '';
  const tabs = chrome ? '<nav class="tabbar" aria-label="Sections">\n' + TABS[cfg.app].map((t) => '  <button class="tab' + (t[0] === cfg.tab ? ' on' : '') + '"' + (t[0] === cfg.tab ? ' aria-current="page"' : '') + '>{{' + t[1] + '}}<span>' + t[2] + '</span></button>').join('\n') + '\n</nav>\n' : '';
  const body = cfg.raw
    ? main
    : (cfg.phone === false ? '' : STATUS + '\n') + top + '<main class="screen' + (cfg.screen ? ' ' + cfg.screen : '') + '">\n' + main.trim() + '\n</main>\n' + tabs + overlay.trim() + (cfg.phone === false ? '' : '\n<div class="m-home" aria-hidden="true"></div>');
  const html = '<!doctype html>\n<html lang="en" data-app="' + cfg.app + '" data-theme="dark">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>' + cfg.title + '</title>\n<link rel="stylesheet" href="tokens.css">\n<link rel="stylesheet" href="ui.css">\n<link rel="stylesheet" href="mock.css">\n<script>\n  // Mock only: ?theme=light switches the theme, dark is the default.\n  var t = new URLSearchParams(location.search).get(\'theme\');\n  document.documentElement.setAttribute(\'data-theme\', t === \'light\' ? \'light\' : \'dark\');\n</script>\n</head>\n<body' + (cfg.body ? ' class="' + cfg.body + '"' : '') + '>\n' + sprite + (cfg.appIcons ? '\n' + appIcons : '') + '\n' + icons(body) + '\n</body>\n</html>\n';
  fs.writeFileSync(path.join(root, file), html);
  console.log('built ' + file);
}
