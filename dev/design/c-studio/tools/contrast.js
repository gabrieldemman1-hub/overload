// Measures WCAG contrast for the pairs that matter, straight from tokens.css.
// Usage: node tools/contrast.js
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'tokens.css'), 'utf8');

function block(startRe) {
  const m = startRe.exec(css);
  const open = css.indexOf('{', m.index);
  const close = css.indexOf('\n}', open);
  const out = {};
  css.slice(open, close).replace(/(--[\w-]+):\s*([^;]+);/g, (_, k, v) => { out[k] = v.trim(); return ''; });
  return out;
}
const dark = block(/:root \{\s*color-scheme: dark/);
const light = block(/:root\[data-theme="light"\],/);

function parse(c) {
  c = c.trim();
  if (c[0] === '#') { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]; }
  const m = /rgba?\(([^)]+)\)/.exec(c); const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]];
}
const over = (fg, bg) => { const a = fg[3]; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1); };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// [label, foreground token, background stack (bottom first), minimum]
const pairs = [
  ['ink on page', '--ink', ['--bg'], 4.5],
  ['ink on surface', '--ink', ['--surface'], 4.5],
  ['ink-2 on surface', '--ink-2', ['--surface'], 4.5],
  ['ink-3 on page', '--ink-3', ['--bg'], 4.5],
  ['ink-3 on surface', '--ink-3', ['--surface'], 4.5],
  ['ink-3 on fill over surface', '--ink-3', ['--surface', '--fill'], 4.5],
  ['ink-3 on fill over page', '--ink-3', ['--bg', '--fill'], 4.5],
  ['ink-3 on sheet', '--ink-3', ['--surface-2'], 4.5],
  ['on-ink on ink (ticked set, chosen chip)', '--on-ink', ['--ink'], 4.5],
  ['ink on the chosen segment', '--ink', ['--thumb'], 4.5],
  ['ink-2 on the segmented track over page', '--ink-2', ['--bg', '--fill'], 4.5],
  ['dock ink on dock', '--dock-ink', ['--dock-bg'], 4.5],
  ['dock ink-2 on dock', '--dock-ink-2', ['--dock-bg'], 4.5],
  ['EMBER on-accent on accent (button)', '--ember-on', ['--ember'], 4.5],
  ['EMBER accent-ink on page', '--ember-ink', ['--bg'], 4.5],
  ['EMBER accent-ink on surface', '--ember-ink', ['--surface'], 4.5],
  ['EMBER accent-ink on accent-soft over surface', '--ember-ink', ['--surface', '--ember-soft'], 4.5],
  ['EMBER accent fill vs surface (icon, ring)', '--ember', ['--surface'], 3],
  ['EMBER dock accent on dock (ring)', '--ember-dock', ['--dock-bg'], 3],
  ['HERB dock accent on dock (ring)', '--herb-dock', ['--dock-bg'], 3],
  ['HERB on-accent on accent (button)', '--herb-on', ['--herb'], 4.5],
  ['HERB accent-ink on page', '--herb-ink', ['--bg'], 4.5],
  ['HERB accent-ink on surface', '--herb-ink', ['--surface'], 4.5],
  ['HERB accent-ink on accent-soft over surface', '--herb-ink', ['--surface', '--herb-soft'], 4.5],
  ['HERB accent-ink on accent-soft over sheet', '--herb-ink', ['--surface-2', '--herb-soft'], 4.5],
  ['HERB accent fill vs surface (bar, ring)', '--herb', ['--surface'], 3],
  ['pos on surface', '--pos', ['--surface'], 4.5],
  ['warn on surface', '--warn', ['--surface'], 4.5],
  ['warn on warn-soft over surface', '--warn', ['--surface', '--warn-soft'], 4.5],
  ['neg on surface', '--neg', ['--surface'], 4.5],
  ['neg on neg-soft over surface', '--neg', ['--surface', '--neg-soft'], 4.5],
  ['viz protein vs surface', '--viz-1', ['--surface'], 3],
  ['viz carbs vs surface', '--viz-2', ['--surface'], 3],
  ['viz fat vs surface', '--viz-3', ['--surface'], 3],
  ['idle tick icon (ink-2) on fill-2 over surface', '--ink-2', ['--surface', '--fill-2'], 3],
  ['ink-4 mark on page (planned-day ring, chevron)', '--ink-4', ['--bg'], 3],
  ['ink-4 mark on surface', '--ink-4', ['--surface'], 3],
  ['EMBER accent-ink on accent-soft over page (streak pill)', '--ember-ink', ['--bg', '--ember-soft'], 4.5],
  ['HERB accent-ink on accent-soft over page', '--herb-ink', ['--bg', '--herb-soft'], 4.5],
  ['neg on neg-soft over page (Reset)', '--neg', ['--bg', '--neg-soft'], 4.5],
];

let bad = 0;
for (const [name, t] of [['DARK', dark], ['LIGHT', light]]) {
  console.log('\n' + name);
  for (const [label, fg, bgs, min] of pairs) {
    let bg = parse(t[bgs[0]]);
    for (const b of bgs.slice(1)) bg = over(parse(t[b]), bg);
    const f = Array.isArray(fg) ? parse(t[fg[0]]).slice(0, 3).concat(fg[1]) : parse(t[fg]);
    const r = ratio(over(f, bg), bg);
    const ok = r >= min;
    if (!ok) bad++;
    console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' ' + r.toFixed(2).padStart(5) + ' (min ' + min + ')  ' + label);
  }
}
console.log(bad ? '\n' + bad + ' pair(s) below the minimum' : '\nAll pairs pass');
process.exit(bad ? 1 : 0);
