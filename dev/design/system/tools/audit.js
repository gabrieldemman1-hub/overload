// The audit used by tools/shoot.js: audit(page, label) inspects one rendered Playwright page, prints what it finds and
// returns the number of kinds of finding (0 = clean). It only reads the page, so it can be run on the real app too:
//   const { audit } = require('./dev/design/system/tools/audit.js');  problems += await audit(page, 'Today 390 dark');
// Checks: sideways overflow; text cut off or off-screen; tap targets under 44 px; text under 11 px; contrast of every text
// node as rendered (AA: 4.5, or 3 for large text); a button label on two lines; an input value wider than its box;
// a top bar whose parts overlap or whose title has collapsed; a toast that is stretched or sits on a sheet's controls.
'use strict';

async function audit(page, label) {
  const r = await page.evaluate(() => {
    const out = { overflowX: document.documentElement.scrollWidth - window.innerWidth, small: [], clipped: [], low: [], tiny: [], wrapped: [], bar: [], toast: [] };
    const vis = (el) => { const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && el.getClientRects().length; };
    const name = (el) => (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : el.tagName.toLowerCase());
    // (The days of the Trends chart are svg <g role="button"> columns about 20 px wide: the one documented exception, not listed here.)
    document.querySelectorAll('button, a[href], input, select, textarea, label.btn, [role=switch]').forEach((el) => {
      if (!vis(el) || el.disabled || el.type === 'file' || el.closest('[aria-hidden="true"]')) return;
      const b = el.getBoundingClientRect();
      if (b.width < 43.5 || b.height < 43.5) out.small.push(name(el) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height) + ' "' + (el.textContent || el.value || '').trim().slice(0, 18) + '"');
    });
    document.querySelectorAll('.screen *, .sheet-panel *, .topbar *, .tabbar *, .rest-timer *, .onboard *').forEach((el) => {
      if (!vis(el) || el.children.length || !el.textContent.trim() || el.getBoundingClientRect().width <= 1) return;   // 1 px wide = hidden on purpose (the screen's h1)
      const s = getComputedStyle(el);
      if (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none') return;
      if (el.scrollWidth > el.clientWidth + 1 && s.overflow !== 'visible') out.clipped.push(name(el) + ' "' + el.textContent.trim().slice(0, 24) + '"');
      const b = el.getBoundingClientRect();
      if (b.right > window.innerWidth + 0.5 || b.left < -0.5) out.clipped.push('off-screen: ' + name(el) + ' "' + el.textContent.trim().slice(0, 24) + '"');
    });
    // A button's label on more than one line. Buttons in a row never wrap; a full-width button must fit at 390 px and up.
    // (data-audit="wrap-ok" marks the one sample on the components page that shows how a long label wraps.)
    document.querySelectorAll('.btn, .pill, .tab, .seg button, .rir-btn').forEach((el) => {
      if (!vis(el) || el.closest('[data-audit="wrap-ok"]')) return;
      if (el.classList.contains('block') && window.innerWidth < 390) return;   // a full-width button may wrap under the reference width (it is drawn for it)
      const tops = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) { if (!t.nodeValue.trim() || t.parentElement.closest('.sr, .tab-icon')) continue; const r = document.createRange(); r.selectNodeContents(t); for (const q of r.getClientRects()) if (q.width > 1 && !tops.some((y) => Math.abs(y - q.top) < 6)) tops.push(q.top); }
      if (tops.length > 1) out.wrapped.push(name(el) + ' "' + el.textContent.trim().slice(0, 28) + '" on ' + tops.length + ' lines');
    });
    // A typed value wider than its box.
    document.querySelectorAll('input.input, input.set-input, .stepper .val').forEach((el) => {
      if (!vis(el) || !el.value || el.type === 'time') return;
      if (el.scrollWidth > el.clientWidth + 1) out.clipped.push('value cut: ' + name(el) + ' "' + el.value.slice(0, 24) + '" (' + el.scrollWidth + ' in ' + el.clientWidth + ' px)');
    });
    // The top bar: nothing overlaps, the title keeps room for a word, the exercise count is whole.
    (() => { const tb = document.querySelector('.topbar-inner'); if (!tb || !vis(tb)) return;
      const title = tb.querySelector('.brand-title'), right = tb.querySelector('.topbar-right'), kids = [...tb.querySelectorAll('.brand-mark, .brand-title, .topbar-right > *')].filter(vis);
      if (title && vis(title) && title.textContent.trim() && title.getBoundingClientRect().width < 40) out.bar.push('title is ' + Math.round(title.getBoundingClientRect().width) + ' px wide');
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) { const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect(); if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5) out.bar.push(name(kids[i]) + ' overlaps ' + name(kids[j])); }
      const n = right && right.querySelector('.tb-meta b'); if (n && n.getBoundingClientRect().left < right.querySelector('.tb-meta').getBoundingClientRect().left - 0.5) out.bar.push('the exercise count is cut');
      if (right && right.getBoundingClientRect().right > window.innerWidth) out.bar.push('the right side runs off the screen'); })();
    // The toast: one block near the top; over a sheet it may cover the grabber, never the sheet's title or controls.
    (() => { const t = document.querySelector('.toast:not(.ref-static)'); if (!t || !vis(t)) return; const b = t.getBoundingClientRect();
      if (b.height > 120) out.toast.push('the toast is ' + Math.round(b.height) + ' px tall');
      const sp = document.querySelector('.sheet:not([hidden]) .sheet-panel'); if (sp && b.bottom > sp.getBoundingClientRect().top + 28) out.toast.push('the toast reaches ' + Math.round(b.bottom - sp.getBoundingClientRect().top) + ' px into the sheet'); })();
    const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const mix = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat([1]); };
    // The painted background behind an element: its own and its ancestors' background colours, and the ::before
    // that draws the cell or chip behind some controls (calendar cells, top-bar pills).
    const bgOf = (el) => { const stack = [];
      const ps = getComputedStyle(el, '::before'), pb = parse(ps.backgroundColor); if (ps.content !== 'none' && ps.zIndex === '-1' && pb[3] > 0) stack.push(pb);
      if (!(stack.length && stack[0][3] >= 1)) for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } }
      let base = parse(getComputedStyle(document.documentElement).backgroundColor); if (base[3] < 1) base = [255, 255, 255, 1];
      for (let i = stack.length - 1; i >= 0; i--) base = mix(stack[i], base); return base; };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue.trim()) continue;
      const el = node.parentElement; if (!el || !vis(el) || el.getBoundingClientRect().width <= 1 || el.closest('script, style, title, [disabled], [aria-hidden="true"], .idle, [hidden]')) continue;
      const s = getComputedStyle(el), svg = el.closest('svg');
      // Size as drawn: text inside a chart scales with the SVG.
      let size = parseFloat(s.fontSize);
      if (svg && svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width) size *= svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      if (size < 10.95) out.tiny.push(size.toFixed(1) + 'px "' + node.nodeValue.trim().slice(0, 20) + '" (' + name(el) + ')');
      let op = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
      if (op < 1) continue;   // dimmed on purpose
      const bg = bgOf(svg ? svg.parentElement : el), fg = mix(parse(svg ? s.fill : s.color), bg);
      const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
      const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) out.low.push(ratio.toFixed(2) + ' "' + node.nodeValue.trim().slice(0, 20) + '" (' + name(el) + ', ' + size.toFixed(0) + 'px)');
    }
    return out;
  });
  const msgs = [];
  if (r.low.length) msgs.push('low contrast: ' + [...new Set(r.low)].join(' | '));
  if (r.tiny.length) msgs.push('text under 11 px: ' + [...new Set(r.tiny)].join(' | '));
  if (r.overflowX > 0) msgs.push('sideways overflow ' + r.overflowX + 'px');
  if (r.small.length) msgs.push('small targets: ' + [...new Set(r.small)].join(' | '));
  if (r.clipped.length) msgs.push('clipped: ' + [...new Set(r.clipped)].join(' | '));
  if (r.wrapped.length) msgs.push('label on two lines: ' + [...new Set(r.wrapped)].join(' | '));
  if (r.bar.length) msgs.push('top bar: ' + [...new Set(r.bar)].join(' | '));
  if (r.toast.length) msgs.push('toast: ' + [...new Set(r.toast)].join(' | '));
  if (msgs.length) console.log('  ! ' + label + ':\n      ' + msgs.join('\n      '));
  return msgs.length;
}

module.exports = { audit };
