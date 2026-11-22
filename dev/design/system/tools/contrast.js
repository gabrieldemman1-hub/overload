// Contrast checker for the tokens in shared/ui.css. Usage: node tools/contrast.js [--md]
// Reads the token blocks, resolves them for each theme x app, and prints the WCAG 2 ratio of every pair the
// components use: text (needs 4.5, or 3 when large), and fills / outlines that carry meaning (need 3: an outline is
// measured against the surface around the control). Then the rest dock, which has surface values of its own
// (read from train.css) and is dark in both themes. Exits 1 if any pair fails. --md prints the table used in dev/design/SYSTEM.md.
'use strict';
const fs = require('fs'), path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'shared', 'ui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
function block(test) {   // custom properties of every rule whose selector passes the test
  const out = {}; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) { if (!test(m[1].trim().replace(/\s+/g, ' '))) continue; m[2].split(';').forEach((d) => { const i = d.indexOf(':'); if (i < 0) return; const k = d.slice(0, i).trim(); if (k.startsWith('--')) out[k] = d.slice(i + 1).trim(); }); }
  return out;
}
const dark = block((s) => s === ':root, .rest-timer, .f-sum');
const light = block((s) => s.indexOf(':root[data-theme="light"]') === 0);
const root = block((s) => s === ':root');   // tokens that do not follow the theme (the Home Screen tile colours are among them)
const mapOv = block((s) => s === ':root, [data-app="overload"], .rest-timer');
const mapFu = block((s) => s === '[data-app="fuel"], .f-sum');
if (!dark['--bg'] || !light['--bg'] || !mapOv['--accent'] || !mapFu['--accent']) { console.error('token blocks not found in shared/ui.css'); process.exit(2); }
const themes = {
  'dark / overload': Object.assign({}, root, dark, mapOv), 'dark / fuel': Object.assign({}, root, dark, mapFu),
  'light / overload': Object.assign({}, root, dark, light, mapOv), 'light / fuel': Object.assign({}, root, dark, light, mapFu),
};
const val = (t, k, depth = 0) => { const v = t[k]; if (v == null) throw new Error('missing ' + k); const m = /^var\((--[\w-]+)\)$/.exec(v); return m && depth < 6 ? val(t, m[1], depth + 1) : v; };
const rgb = (c) => { if (c === 'transparent') return [0, 0, 0, 0]; let m = /^#([0-9a-f]{6})$/i.exec(c); if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat([1]); m = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(c); if (m) return [+m[1], +m[2], +m[3], +m[4]]; throw new Error('not a colour: ' + c); };
const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat([1]);
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// [foreground, background (a token, or "wash over surface"), minimum, what it is]
const T = 4.5, G = 3;
const pairs = [
  ['--ink', '--bg', T, 'text'], ['--ink', '--panel', T, 'text on a card or sheet'], ['--ink', '--key', T, 'label on a key'],
  ['--ink-2', '--bg', T, 'secondary text'], ['--ink-2', '--panel', T, ''], ['--ink-2', '--key', T, ''], ['--ink-2', '--key-2', T, 'on a pressed key'],
  ['--ink-3', '--bg', T, 'labels, captions'], ['--ink-3', '--panel', T, ''], ['--ink-3', '--well', T, 'placeholder in an input'], ['--ink-3', '--key', T, ''], ['--ink-3', '--key-2', T, ''],
  ['--on-solid', '--solid', T, 'tick, picked answer, selected segment'], ['--bg', '--ink', T, 'toast'],
  ['--on-accent', '--accent', T, 'label on an accent fill'], ['--on-accent', '--btn', T, 'label on the primary button'],
  ['--tile-ink', '--tile', T, 'the mark on the app tile'],
  ['--accent-ink', '--bg', T, 'accent as text, the outline of the Update ready pill, the focus ring'], ['--accent-ink', '--panel', T, ''], ['--accent-ink', '--key', T, ''],
  ['--accent-ink', '--accent-wash over --bg', T, 'PR pill, Update ready'], ['--accent-ink', '--accent-wash over --panel', T, 'next tick, Added strip'],
  ['--ink', '--accent-wash over --panel', T, 'text in the Added strip'],
  ['--ok-ink', '--bg', T, 'status text'], ['--ok-ink', '--panel', T, ''], ['--ok-ink', '--ok-wash over --panel', T, 'green pill'], ['--ok-ink', '--ok-wash over --bg', T, ''],
  ['--warn-ink', '--bg', T, ''], ['--warn-ink', '--panel', T, ''], ['--warn-ink', '--warn-wash over --panel', T, 'amber pill'], ['--warn-ink', '--warn-wash over --bg', T, ''],
  ['--bad-ink', '--bg', T, 'danger text'], ['--bad-ink', '--panel', T, 'danger button label'], ['--bad-ink', '--bad-wash over --panel', T, 'red pill'], ['--bad-ink', '--bad-wash over --bg', T, ''],
  ['--ink', '--warn-wash over --bg', T, 'text in a notice'], ['--ink', '--ok-wash over --bg', T, 'text in an ok banner'],
  ['--edge', '--bg', G, 'outline of a control'], ['--edge', '--panel', G, ''], ['--edge', '--well', G, 'outline of an input'], ['--edge', '--key', G, 'outline of a key'],
  ['--ink', '--key-2', T, 'a picked Off, a pressed key'], ['--edge', '--key-2', 1, 'the ring of a picked Off (it is measured against the well around it: see --edge on --well)'],
  ['--btn-or-edge', '--bg', G, 'boundary of the primary button (its fill, or its edge where the fill is volt on paper)'], ['--btn-or-edge', '--panel', G, ''],
  ['--accent', '--bg', G, 'accent fill, ring, meter'], ['--accent', '--panel', G, ''], ['--accent', '--key', G, 'rest meter on the dock'],
  ['--solid', '--bg', G, 'recorded fill'], ['--solid', '--panel', G, ''],
  ['--bad', '--bg', G, 'danger outline, over target'], ['--bad', '--panel', G, ''], ['--bad-ink', '--key', T, 'danger text on a key'],
  ['--ok', '--panel', G, 'bar in range'], ['--warn', '--panel', G, 'bar under target'],
  ['--m-protein', '--panel', G, 'macro mark and bar'], ['--m-carbs', '--panel', G, ''], ['--m-fat', '--panel', G, ''], ['--m-carbs', '--bg', G, ''], ['--m-fat', '--bg', G, ''],
  ['--series-1', '--panel', G, 'chart line, deep sleep'], ['--series-2', '--panel', G, 'bars, REM'], ['--series-2', '--bg', G, ''], ['--series-3', '--panel', G, 'light sleep, the third step of the ramp'], ['--series-3', '--bg', G, 'the same, should a chart sit on the page'],
];
const md = process.argv.includes('--md');
const col = (t, spec) => {
  if (spec === '--btn-or-edge') { const e = rgb(val(t, '--btn-edge')); return e[3] > 0 ? e : rgb(val(t, '--btn')); }   // the edge where there is one, else the fill
  if (spec[0] === '#') return rgb(spec);
  const m = /^(--[\w-]+) over (--[\w-]+)$/.exec(spec); return m ? over(rgb(val(t, m[1])), rgb(val(t, m[2]))) : rgb(val(t, spec)); };
let fails = 0; const rows = {};
for (const [name, t] of Object.entries(themes)) {
  if (!md) console.log('\n== ' + name + ' ==');
  for (const [fg, bg, min, what] of pairs) {
    const r = ratio(col(t, fg), col(t, bg)), ok = r >= min; if (!ok) fails++;
    (rows[fg + ' on ' + bg] = rows[fg + ' on ' + bg] || { min, what, v: {} }).v[name] = r.toFixed(2) + (ok ? '' : ' FAIL');
    if (!md) console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' ' + r.toFixed(2).padStart(5) + ':1  ' + (fg + ' on ' + bg).padEnd(46) + ' min ' + min + (what ? '   ' + what : ''));
  }
}
// The rest dock: the dark tokens with Overload's accent, on the dock's own surfaces (declared on .rest-timer in train.css).
const tcss = fs.readFileSync(path.join(__dirname, '..', 'train.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const dockRule = /\.rest-timer\s*\{([^}]*)\}/.exec(tcss), dockT = Object.assign({}, themes['dark / overload']);
if (!dockRule) { console.error('.rest-timer not found in train.css'); process.exit(2); }
dockRule[1].split(';').forEach((d) => { const i = d.indexOf(':'); if (i < 0) return; const k = d.slice(0, i).trim(); if (k.startsWith('--')) dockT[k] = d.slice(i + 1).trim(); });
const dockPairs = [['--ink', '--dock', T, 'the timer digits'], ['--ink-2', '--dock', T, 'the context line'], ['--ink-3', '--dock', T, '/ 2:00'], ['--accent-ink', '--dock', T, 'REST'],
  ['--accent', '--dock', G, 'the tick meter'], ['--rule-2', '--dock', 1, 'the meter track (decoration)'], ['--ink', '--key', T, 'label on a dock key'], ['--edge', '--dock', G, 'outline of a dock key'], ['--edge', '--key', G, 'the same, against the key']];
if (!md) console.log('\n== the rest dock (dark in both themes) ==');
for (const [fg, bg, min, what] of dockPairs) {
  const r = ratio(col(dockT, fg), col(dockT, bg)), ok = r >= min; if (!ok) fails++;
  if (!md) console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' ' + r.toFixed(2).padStart(5) + ':1  ' + (fg + ' on ' + bg).padEnd(46) + ' min ' + min + (what ? '   ' + what : ''));
  else rows['dock: ' + fg + ' on ' + bg] = { min, what, v: Object.fromEntries(Object.keys(themes).map((n) => [n, r.toFixed(2) + (ok ? '' : ' FAIL')])) };
}
if (md) {
  const names = Object.keys(themes);
  console.log('| Pair | Needs | ' + names.join(' | ') + ' | Used for |\n| --- | --- | ' + names.map(() => '---').join(' | ') + ' | --- |');
  for (const [k, o] of Object.entries(rows)) console.log('| `' + k.replace(' on ', '` on `').replace(' over ', '` over `') + '` | ' + o.min + ' | ' + names.map((n) => o.v[n]).join(' | ') + ' | ' + o.what + ' |');
}
console.log('\n' + (fails ? fails + ' pair(s) FAIL' : 'all ' + (pairs.length * 4 + dockPairs.length) + ' checks pass'));
process.exit(fails ? 1 : 0);
