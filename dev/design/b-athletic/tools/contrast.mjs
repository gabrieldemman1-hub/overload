// Measures the WCAG contrast of the main colour pairs in tokens.css. Run: node tools/contrast.mjs
const lin = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
const lum = (h) => { const [r, g, b] = lin(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const over = (fg, a, bg) => toHex(hex(fg).map((v, i) => v * a + hex(bg)[i] * (1 - a)));
const T = {
  dark: { bg: '#0B0C10', bg2: '#111318', card: '#181A21', card2: '#21242D', card3: '#2B2F3A', fill: '#272B36', line3: '#6A7182', text: '#F5F6F8', text2: '#BDC1CC', text3: '#9096A5', inv: '#F5F6F8', invText: '#0B0C10',
    ok: '#34D17A', okInk: '#04210F', okText: '#4ADE8B', okSoftA: 0.14, okBase: '#34D17A', warnText: '#FFC555', warnBase: '#FFB224', warnA: 0.14, dangerText: '#FF7088', dangerBase: '#FF4D6D', dangerA: 0.14, danger: '#FF4D6D', goldText: '#FFD25A', goldBase: '#FFC83C', goldA: 0.14,
    mp: '#2E8CF0', mc: '#C78400', mf: '#E0489E', softA: 0.16, track: '#2B2F3A', chartMuted: '#4A5060',
    apps: { overload: { a1: '#FF3B30', a2: '#FF8A1F', m1: '#FF3B30', m2: '#FF8A1F', ink: '#1F0A03', text: '#FF7A52', mark: '#FF5A24', rgb: '#FF5A24' }, fuel: { a1: '#0FBF63', a2: '#A8EB45', m1: '#0FBF63', m2: '#A8EB45', ink: '#04210F', text: '#4ADE8B', mark: '#2BD06E', rgb: '#26D06E' } } },
  light: { bg: '#F1F2F5', bg2: '#E7E9EE', card: '#FFFFFF', card2: '#F2F3F6', card3: '#E4E6EC', fill: '#E6E8EE', line3: '#868C9B', text: '#0E1016', text2: '#434956', text3: '#5F6573', inv: '#0E1016', invText: '#FFFFFF',
    ok: '#14994F', okInk: '#04210F', okText: '#0B6B34', okSoftA: 0.12, okBase: '#14994F', warnText: '#7A4A00', warnBase: '#C77700', warnA: 0.13, dangerText: '#C01F3F', dangerBase: '#D92B4B', dangerA: 0.10, danger: '#D92B4B', goldText: '#7A5200', goldBase: '#FFBE28', goldA: 0.22,
    mp: '#0F6FD1', mc: '#A65E00', mf: '#C026A8', softA: 0.12, track: '#ECEEF2', chartMuted: '#B4B9C5',
    apps: { overload: { a1: '#FF3B30', a2: '#FF8A1F', m1: '#FF3B30', m2: '#E05F00', ink: '#1F0A03', text: '#C2310A', mark: '#E8481A', rgb: '#FF5A24' }, fuel: { a1: '#0FBF63', a2: '#A8EB45', m1: '#0D9A4F', m2: '#45991A', ink: '#04210F', text: '#0B6B34', mark: '#12974E', rgb: '#26D06E' } } },
};
const rows = [];
const add = (theme, what, fg, bg, need) => { const r = contrast(fg, bg); rows.push([theme, what, fg, bg, r.toFixed(2), need, r >= need ? 'ok' : 'FAIL']); };
for (const [name, t] of Object.entries(T)) {
  add(name, 'text on bg', t.text, t.bg, 4.5); add(name, 'text on card', t.text, t.card, 4.5); add(name, 'text on card-2', t.text, t.card2, 4.5);
  add(name, 'text-2 on card', t.text2, t.card, 4.5); add(name, 'text-2 on bg', t.text2, t.bg, 4.5); add(name, 'text-2 on fill', t.text2, t.fill, 4.5); add(name, 'text-2 on card-2', t.text2, t.card2, 4.5);
  add(name, 'text-3 on bg', t.text3, t.bg, 4.5); add(name, 'text-3 on card', t.text3, t.card, 4.5); add(name, 'text-3 on card-2', t.text3, t.card2, 4.5); add(name, 'text-3 on bg-2', t.text3, t.bg2, 4.5); add(name, 'text-3 on fill', t.text3, t.fill, 4.5);
  add(name, 'inverse text on inverse', t.invText, t.inv, 4.5);
  add(name, 'ok ink on ok', t.okInk, t.ok, 4.5); add(name, 'ok fill vs card (tick)', t.ok, t.card, 3);
  const okSoft = over(t.okBase, t.okSoftA, t.card); add(name, 'ok-text on ok-soft/card', t.okText, okSoft, 4.5); add(name, 'text on ok-soft/card (done set)', t.text, okSoft, 4.5); add(name, 'text-2 on ok-soft/card', t.text2, okSoft, 4.5);
  add(name, 'ok-text on card', t.okText, t.card, 4.5); add(name, 'ok-text on card-2', t.okText, t.card2, 4.5);
  add(name, 'warn-text on warn-soft/card', t.warnText, over(t.warnBase, t.warnA, t.card), 4.5);
  add(name, 'danger-text on card', t.dangerText, t.card, 4.5); add(name, 'danger-text on danger-soft/card', t.dangerText, over(t.dangerBase, t.dangerA, t.card), 4.5); add(name, 'danger line vs card', t.danger, t.card, 3);
  add(name, 'gold-text on card-2', t.goldText, t.card2, 4.5); add(name, 'gold-text on gold-soft/card', t.goldText, over(t.goldBase, t.goldA, t.card), 4.5);
  add(name, 'gold ink on gold start', '#2B1B00', '#FFE066', 4.5); add(name, 'gold ink on gold end', '#2B1B00', '#FFB300', 4.5);
  add(name, 'line-3 (empty tick) vs card', t.line3, t.card, 3);
  add(name, 'macro protein vs card', t.mp, t.card, 3); add(name, 'macro carbs vs card', t.mc, t.card, 3); add(name, 'macro fat vs card', t.mf, t.card, 3);
  for (const [app, a] of Object.entries(t.apps)) {
    add(name, app + ': ink on gradient start', a.ink, a.a1, 4.5); add(name, app + ': ink on gradient end', a.ink, a.a2, 4.5);
    add(name, app + ': accent-text on bg', a.text, t.bg, 4.5); add(name, app + ': accent-text on card', a.text, t.card, 4.5); add(name, app + ': accent-text on card-2', a.text, t.card2, 4.5);
    const soft = over(a.rgb, t.softA, t.card); add(name, app + ': accent-text on accent-soft/card', a.text, soft, 4.5); add(name, app + ': text on accent-soft/card', t.text, soft, 4.5);
    const soft2 = over(a.rgb, t.softA, t.card2); add(name, app + ': text-2 on rest timer (soft/card-2)', t.text2, soft2, 4.5);
    add(name, app + ': accent mark vs card (lines, bars)', a.mark, t.card, 3);
    add(name, app + ': mark gradient start vs card', a.m1, t.card, 3); add(name, app + ': mark gradient end vs card', a.m2, t.card, 3);
    add(name, app + ': mark gradient start vs bg', a.m1, t.bg, 3); add(name, app + ': mark gradient end vs bg', a.m2, t.bg, 3);
    add(name, app + ': mark gradient start vs track', a.m1, t.track, 3); add(name, app + ': mark gradient end vs track', a.m2, t.track, 3);
    add(name, app + ': ink on mark gradient start', a.ink, a.m1, 4.5); add(name, app + ': ink on mark gradient end', a.ink, a.m2, 4.5);
    add(name, 'ok fill vs bg (progress strip)', t.ok, t.bg, 3);
  }
}
for (const r of rows) console.log(r.join(' | '));
console.log('FAILS:', rows.filter((r) => r[6] === 'FAIL').length);
