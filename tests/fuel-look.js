#!/usr/bin/env node
/* Fuel 3.0: Today's three macro cells (protein, carbs, fat) under the gauge, at 320, 390 and 430 px wide.
 *
 *   node tests/fuel-look.js [--port=8429]
 *
 * The three cells must have the same room, so that a target ("/ 240 g") wraps under its value in one cell only
 * where it would in the others. (The first restyle gave the middle cell padding on both sides and the outer
 * ones on one side: carbs had 10 px less, and at 390 px "176 / 240 g" wrapped there alone.) At each width:
 *   - the three cells' content boxes are the same width, and a hairline stands in the middle of each gap;
 *   - the day of the restyle's screenshot (103 / 190 g, 176 / 240 g, 17 / 75 g): no target wraps at 390 or 430;
 *   - a day with three-digit values and targets in all three cells: all three wrap, or none does;
 *   - the three bars stay level.
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const lib = require('./lib');
const F = require('./fuel-common');

const args = F.args();
const PORT = Number(args.port) || 8429;
const run = F.runner('fuel-look');
const { need } = run;
const fx = lib.loadFixture('v28-state');
const TODAY = fx.meta.today;

// One day whose macros add up to p, c, f, with these targets.
function dayState(p, c, f, targets) {
  const e = (id, meal, kcal, pp, cc, ff) => ({ id, food: null, meal, qty: null, unit: null, amt: '', name: 'Food ' + id, brand: '', kcal, p: pp, c: cc, f: ff, at: fx.meta.now - 3600000 + meal });
  return { v: 1, app: 'fuel', settings: { units: 'lb', theme: 'dark' }, food: { targets, foods: {}, meals: {} },
    diary: { [TODAY]: [e('m1', 0, 700, p - 40, c - 60, f - 7), e('m2', 2, 557, 40, 60, 7)] }, deleted: { food: {}, foods: {}, meals: {} }, bodyweight: [], moved: null };
}
const CASES = [
  { name: 'the screenshot\'s day (103 / 190 g, 176 / 240 g, 17 / 75 g)', state: dayState(103, 176, 17, { kcal: 2400, protein: 190, carbs: 240, fat: 75 }), wrapsAt: { 390: [false, false, false], 430: [false, false, false] } },
  { name: 'three-digit values and targets in every cell', state: dayState(103, 176, 117, { kcal: 2400, protein: 190, carbs: 240, fat: 175 }) }
];

// For each cell: its content-box width, whether the target sits on a line below the value, where the bar is;
// and for each hairline between two cells: how far it is from the content on either side.
const measure = (page) => page.evaluate(() => {
  const cells = [...document.querySelectorAll('.f-sum .f-macros .f-macro')];
  const box = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { left: r.left + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.paddingRight) }; };
  const out = cells.map((c) => {
    const b = box(c), v = c.querySelector('.v'), t = v.querySelector('.muted'), range = document.createRange();
    range.selectNodeContents(v.firstChild);
    const value = range.getBoundingClientRect(), target = t.getBoundingClientRect();
    return { width: b.right - b.left, left: b.left, right: b.right, wraps: target.top >= value.bottom - 1, text: v.textContent.replace(/\s+/g, ' ').trim(), bar: Math.round(c.querySelector('.f-bar').getBoundingClientRect().top) };
  });
  // The hairline is drawn by the second and third cell (a border on the cell itself, or its ::before): its x.
  const lines = cells.slice(1).map((c) => {
    const r = c.getBoundingClientRect(), s = getComputedStyle(c), before = getComputedStyle(c, '::before');
    if (parseFloat(s.borderLeftWidth) > 0) return r.left + parseFloat(s.borderLeftWidth) / 2;
    if (before.content !== 'none' && parseFloat(before.borderLeftWidth) > 0) return r.left + parseFloat(before.left) + parseFloat(before.borderLeftWidth) / 2;
    return null;
  });
  return { cells: out, lines };
});

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    for (const c of CASES) {
      const phone = await lib.newPhone(browser, { now: fx.meta.now, timezoneId: fx.meta.tz });
      await lib.seedStorage(phone.context, { 'fuel.state.v1': c.state, 'fuel.theme': 'dark' });
      const page = await F.open(phone, server);
      await page.waitForSelector('.f-sum .f-macros .f-macro');
      for (const width of [320, 390, 430]) {
        await run.step(c.name, width + ' px', async () => {
          await page.setViewportSize({ width, height: 844 });
          await lib.sleep(100);
          const m = await measure(page), w = m.cells.map((x) => x.width), wraps = m.cells.map((x) => x.wraps);
          need(m.cells.length === 3, m.cells.length + ' cells');
          if (c.wrapsAt && c.wrapsAt[width]) need(wraps.join() === c.wrapsAt[width].join(), 'targets on a line of their own: ' + m.cells.map((x, i) => x.text + (wraps[i] ? ' (wraps)' : '')).join(', ') + '; cell widths ' + w.map((x) => x.toFixed(1)).join(' / ') + ' px');
          if (!c.wrapsAt) need(wraps.every((x) => x === wraps[0]), 'the cells do not behave the same: ' + m.cells.map((x, i) => x.text + (wraps[i] ? ' (wraps)' : '')).join(', ') + '; cell widths ' + w.map((x) => x.toFixed(1)).join(' / ') + ' px');
          need(Math.max(...w) - Math.min(...w) < 0.5, 'the cells are not the same width: ' + w.map((x) => x.toFixed(1)).join(' / ') + ' px');
          m.lines.forEach((x, i) => {
            need(x != null, 'no hairline before cell ' + (i + 2));
            const gapL = x - m.cells[i].right, gapR = m.cells[i + 1].left - x;
            need(gapL >= 5 && gapR >= 5 && Math.abs(gapL - gapR) <= 1, 'the hairline before cell ' + (i + 2) + ' is ' + gapL.toFixed(1) + ' px from the content on its left and ' + gapR.toFixed(1) + ' px from the content on its right');
          });
          need(new Set(m.cells.map((x) => x.bar)).size === 1, 'the bars are not level: ' + m.cells.map((x) => x.bar).join(', '));
          return w.map((x) => x.toFixed(1)).join(' / ') + ' px; ' + m.cells.map((x, i) => x.text + (wraps[i] ? ' (wraps)' : '')).join(', ');
        });
      }
      await run.step(c.name, 'no error', async () => { F.assertClean(phone, c.name); });
      await phone.close();
    }
  } catch (e) {
    run.say(false, 'fuel-look', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
    await server.stop();
  }
  run.done();
})();
