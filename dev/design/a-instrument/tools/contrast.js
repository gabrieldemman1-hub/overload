// Contrast checker for the Instrument tokens. Usage: node tools/contrast.js
// Reads tokens.css, resolves the palettes for each theme x app, prints WCAG ratios for the pairs that matter.
const fs = require('fs'), path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
function block(selRe) { // collect declarations of every rule whose selector matches
  const out = {}; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) { if (!selRe.test(m[1].trim())) continue; m[2].split(';').forEach((d) => { const i = d.indexOf(':'); if (i < 0) return; const k = d.slice(0, i).trim(), v = d.slice(i + 1).trim(); if (k.startsWith('--')) out[k] = v; }); }
  return out;
}
const base = block(/^:root$/);
const light = block(/^:root\[data-theme="light"\]/);
const fuelDark = block(/^:root\[data-app="fuel"\]$/);
const fuelLight = block(/^:root\[data-app="fuel"\]\[data-theme="light"\]/);
const themes = {
  'dark / overload': Object.assign({}, base),
  'dark / fuel': Object.assign({}, base, fuelDark),
  'light / overload': Object.assign({}, base, light),
  'light / fuel': Object.assign({}, base, light, fuelDark, fuelLight),
};
const hex = (t, k, depth = 0) => { let v = t[k]; if (!v) throw new Error('missing ' + k); const m = /^var\((--[\w-]+)\)$/.exec(v); if (m && depth < 5) return hex(t, m[1], depth + 1); return v; };
const lum = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const pairs = [
  ['--ink', '--bg', 4.5], ['--ink', '--panel', 4.5], ['--ink', '--well', 4.5],
  ['--ink-2', '--bg', 4.5], ['--ink-2', '--panel', 4.5], ['--ink-2', '--well', 4.5],
  ['--ink-3', '--bg', 4.5], ['--ink-3', '--panel', 4.5], ['--ink-3', '--well', 4.5],
  ['--accent-ink', '--bg', 4.5], ['--accent-ink', '--panel', 4.5], ['--accent-ink', '--well', 4.5], ['--accent-ink', '--accent-wash-solid', 4.5],
  ['--on-accent', '--accent', 4.5], ['--accent', '--bg', 3], ['--accent', '--panel', 3],
  ['--ink', '--well-2', 4.5], ['--ink-2', '--well-2', 4.5], ['--ink-3', '--well-2', 4.5], ['--accent-ink', '--well-2', 4.5],
  ['--bg', '--ink', 4.5], /* inverted keys: done tick, selected segment */
  ['--edge', '--bg', 3], ['--edge', '--panel', 3],
  ['--ok-ink', '--bg', 4.5], ['--ok-ink', '--panel', 4.5], ['--warn-ink', '--bg', 4.5], ['--warn-ink', '--panel', 4.5], ['--bad-ink', '--bg', 4.5], ['--bad-ink', '--panel', 4.5],
  ['--ok', '--bg', 3], ['--warn', '--bg', 3], ['--bad', '--bg', 3],
  ['--series-1', '--bg', 3], ['--series-2', '--bg', 3], ['--series-3', '--bg', 1.5],
];
// Tinted backgrounds: an rgba() wash laid over a surface. [text, wash, surface, minimum]
const washes = [
  ['--accent-ink', '--accent-wash', '--bg', 4.5], ['--accent-ink', '--accent-wash', '--panel', 4.5], ['--ink', '--accent-wash', '--panel', 4.5],
  ['--ok-ink', '--ok-wash', '--bg', 4.5], ['--ok-ink', '--ok-wash', '--panel', 4.5],
  ['--warn-ink', '--warn-wash', '--bg', 4.5], ['--warn-ink', '--warn-wash', '--panel', 4.5],
  ['--bad-ink', '--bad-wash', '--bg', 4.5], ['--bad-ink', '--bad-wash', '--panel', 4.5],
];
const over = (rgba, surface) => { const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(rgba); if (!m) throw new Error('not rgba: ' + rgba); const a = +m[4]; const s = [1, 3, 5].map((i) => parseInt(surface.slice(i, i + 2), 16)); return '#' + [0, 1, 2].map((i) => Math.round(+m[i + 1] * a + s[i] * (1 - a)).toString(16).padStart(2, '0')).join(''); };
let fails = 0;
for (const [name, t] of Object.entries(themes)) {
  console.log('\n== ' + name + ' ==');
  for (const [fg, bg, min] of pairs) {
    let a, b; try { a = hex(t, fg); b = hex(t, bg); } catch (e) { console.log('  ' + e.message); continue; }
    if (!/^#/.test(a) || !/^#/.test(b)) { console.log('  skip ' + fg + ' on ' + bg + ' (' + a + ' / ' + b + ')'); continue; }
    const r = ratio(a, b); const ok = r >= min; if (!ok) fails++;
    console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' ' + r.toFixed(2).padStart(5) + ':1  ' + (fg + ' ' + a).padEnd(26) + ' on ' + (bg + ' ' + b).padEnd(30) + ' (min ' + min + ')');
  }
  for (const [fg, wash, surf, min] of washes) {
    const a = hex(t, fg), b = over(t[wash], hex(t, surf)); const r = ratio(a, b); const ok = r >= min; if (!ok) fails++;
    console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' ' + r.toFixed(2).padStart(5) + ':1  ' + (fg + ' ' + a).padEnd(26) + ' on ' + (wash + ' over ' + surf + ' ' + b).padEnd(30) + ' (min ' + min + ')');
  }
}
console.log('\n' + (fails ? fails + ' FAIL' : 'all pairs pass'));
process.exit(fails ? 1 : 0);
