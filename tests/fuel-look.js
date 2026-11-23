#!/usr/bin/env node
/* Fuel 3.0: Today's three macro cells (protein, carbs, fat) under the gauge, at 320, 390 and 430 px wide; and the
 * look and accessibility of the frame Fuel shares with Overload (review round 3, findings look#3, look#6 to look#9).
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
 * The frame (the same checks as tests/train-look.js, on Fuel's screens):
 *   - Cloud sync status (look#3): every message fuel/sync.js can put in the pill (read from the file) stays inside
 *     the card at 320 and 390 px, dark and light, also in Welcome's sign-in sheet; a short one stays one line.
 *   - Sheets are dialogs (look#6): role="dialog", aria-modal, named by the title; focus moves in; the page behind is
 *     inert; Tab stays inside; Escape closes; focus goes back to what opened it, also after the Add trip drew the
 *     day again. By touch: no ring, no scrolling, no text box focused.
 *   - Every form field on Settings and the sheets has a name that holds its visible label (look#7).
 *   - The toast is a polite status; the shown tab is aria-current="page", Welcome marks none (look#8).
 *   - Keyboard focus never stops under the top bar or the tab bar, also with the safe areas (look#9).
 * Review round 4:
 *   - Inside the Add sheet ("Added" sticks at its top), the amount sheet when adding (its Add button sticks at the
 *     bottom) and a logged food's Edit, Tab and Shift+Tab stop only where the control is fully visible, at 320x568
 *     and 390x844; after a tap the sheet has no scroll padding (look#12).
 *   - Long unbroken texts at 320 px: food names, brands and saved meals of 60 characters on Today, in the Add sheet,
 *     the amount sheet and a saved meal; a 60-character search; a 60-digit barcode (Scan, Edit food); a 60-character
 *     email in Settings (also at 390 px and beside every status) and on Welcome. Each stays inside its card, nothing
 *     is cut, the page does not scroll sideways (look#13).
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const F = require('./fuel-common');

const args = F.args();
const PORT = Number(args.port) || 8429;
const run = F.runner('fuel-look');
const { need, same } = run;
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

// ---------------------------------------------------------------------------
// The frame Fuel shares with Overload (look#3, look#6 to look#9). The helpers are those of tests/train-look.js.
// ---------------------------------------------------------------------------
// The messages fuel/sync.js can show in #cloud-status (report() and friendly()), read from the file itself.
function syncMessages(file) {
  const src = fs.readFileSync(file, 'utf8');
  const map = (/function friendly\(e\) \{[\s\S]*?const map = \{([\s\S]*?)\n\s*\};/.exec(src) || [])[1] || '';
  const friendly = [...map.matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'")).concat(['Something went wrong.']);
  need(friendly.length >= 10, 'friendly() in ' + path.basename(file) + ' was not found (' + friendly.length + ' messages)');
  const retry = (/lastError = \(friendly\(e\) \|\| '[^']*'\) \+ '([^']+)'/.exec(src) || [])[1];
  need(retry, 'the "retrying" ending in ' + path.basename(file) + ' was not found');
  const raw = 'Firebase: Error (firestore/failed-precondition). https://console.firebase.google.com/project/overload-sync/firestore/indexes?create_composite=ClVwcm9qZWN0cy9vdmVybG9hZA';
  return [...new Set(['Synced', 'Synced 12:59 PM', 'Syncing…', 'Offline, will sync later', 'Connected'].concat(friendly, friendly.map((m) => m + retry), [raw, raw + retry]))];
}
const statusOf = (m) => (/^Synced/.test(m) ? 'synced' : /^Syncing/.test(m) ? 'syncing' : /^Offline/.test(m) ? 'offline' : m === 'Connected' ? 'synced' : 'error');
const fakeSync = (page, email) => page.evaluate((em) => {
  window.__overloadSync = { user: em ? { email: em, uid: 'u1' } : null, release: '3.0', signIn() { return Promise.reject(new Error('x')); }, createAccount() {}, resetPassword() {}, signOut() {}, pushNow() {} };
  window.__overload.syncChanged();
}, email);
const pillFacts = (page) => page.evaluate(() => {
  const p = document.querySelector('#cloud-status'), card = p.closest('.card, .sheet-panel'), b = p.getBoundingClientRect(), c = card.getBoundingClientRect(), cs = getComputedStyle(card);
  const row = p.closest('.toggle-row').firstElementChild.getBoundingClientRect();
  return { right: b.right, left: b.left, cardRight: c.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth), cardLeft: c.left + parseFloat(cs.paddingLeft), over: document.documentElement.scrollWidth - innerWidth, cut: p.scrollWidth > p.clientWidth + 1 || p.scrollHeight > p.clientHeight + 1, height: b.height, top: b.top, rowTop: row.top, rowBottom: row.bottom, text: p.textContent };
});
async function pillsFit(page, msgs) {
  need(msgs.length > 10, 'no messages to show');
  const bad = []; let tallest = 0;
  for (const m of msgs) {
    await page.evaluate(([s, t]) => window.__overload.setSyncStatus(s, t), [statusOf(m), m]);
    const f = await pillFacts(page);
    if (f.text !== m) bad.push('"' + m + '" shows as "' + f.text + '"');
    else if (f.over > 0 || f.right > f.cardRight + 0.5 || f.left < f.cardLeft - 0.5 || f.cut) bad.push('"' + m.slice(0, 50) + '": right edge ' + Math.round(f.right) + ' of ' + Math.round(f.cardRight) + ', page scrolls ' + f.over + ' px' + (f.cut ? ', cut' : ''));
    tallest = Math.max(tallest, f.height);
  }
  need(!bad.length, bad.length + ' run off: ' + bad.join(' | ').slice(0, 700));
  return 'the tallest is ' + Math.round(tallest) + ' px';
}
const fields = (page) => page.evaluate(() => {
  const vis = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]');
  const nameOf = (el) => {
    if ((el.getAttribute('aria-label') || '').trim()) return el.getAttribute('aria-label').trim();
    const lb = el.getAttribute('aria-labelledby'); if (lb) return lb.split(/\s+/).map((i) => (document.getElementById(i) || {}).textContent || '').join(' ').trim();
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && l.textContent.trim()) return l.textContent.trim(); }
    const w = el.closest('label'); if (w && w.textContent.trim()) return w.textContent.trim();
    return (el.title || '').trim();   // a placeholder is not a name
  };
  const shown = (el) => {
    const f = el.closest('.field'), l = f && f.querySelector(':scope > label');
    if (l) return l.textContent.trim();
    const r = el.closest('.toggle-row'); if (!r) return null;
    const first = r.firstElementChild; return ((first.children[0] && first.children[0].tagName === 'DIV' ? first.children[0] : first).textContent || '').trim();
  };
  return [...document.querySelectorAll('input, select, textarea')].filter((el) => el.type !== 'hidden' && el.type !== 'file' && vis(el))
    .map((el) => ({ what: el.tagName.toLowerCase() + (el.name ? '[name=' + el.name + ']' : '') + (el.dataset.field ? '[' + el.dataset.field + (el.dataset.k ? ':' + el.dataset.k : '') + ']' : ''), name: nameOf(el), label: shown(el) }));
});
function checkFields(list, where) {
  need(list.length, where + ': no field to check');
  const bad = list.filter((f) => !f.name || (f.label && !f.name.toLowerCase().includes(f.label.toLowerCase())));
  need(!bad.length, where + ': ' + bad.length + ' of ' + list.length + ' fields without a name that holds their label: ' + bad.map((f) => f.what + ' (name "' + f.name + '", label "' + f.label + '")').join(', ').slice(0, 900));
  return list.length + ' fields';
}
const focusFacts = (page) => page.evaluate(() => {
  const a = document.activeElement; if (!a || a === document.body) return null;
  const r = a.getBoundingClientRect(), top = document.querySelector('.topbar').getBoundingClientRect().bottom;
  const nav = document.querySelector('.tabbar'), bottom = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : innerHeight;
  const fixed = !!a.closest('.topbar, .tabbar, #sheet');
  return { what: a.tagName.toLowerCase() + (a.dataset && a.dataset.action ? '[' + a.dataset.action + ']' : '') + ' "' + (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 24) + '"', top: Math.round(r.top), bottom: Math.round(r.bottom), barBottom: Math.round(top), barTop: Math.round(bottom), under: !fixed && (r.top < top - 0.5 || r.bottom > bottom + 0.5) };
});
async function tabWalk(page, n) {
  await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement) document.activeElement.blur(); });
  const out = [];
  for (let i = 0; i < n; i++) { await page.keyboard.press('Tab'); const f = await focusFacts(page); if (f) out.push(f); }
  return out;
}
const outlineOfFocused = (page) => page.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? getComputedStyle(a).outlineStyle : 'none'; });
const htmlPadding = (page) => page.evaluate(() => { const s = getComputedStyle(document.documentElement); return { top: s.scrollPaddingTop, bottom: s.scrollPaddingBottom, keys: document.documentElement.classList.contains('keys') }; });
const sheetFacts = (page) => page.evaluate(() => {
  const p = document.querySelector('#sheet-panel'), h = p.querySelector('.sheet-title h2'), a = document.activeElement;
  const named = document.getElementById(p.getAttribute('aria-labelledby') || '');
  return { open: !document.querySelector('#sheet').hidden, role: p.getAttribute('role'), modal: p.getAttribute('aria-modal'), name: named ? named.textContent.trim() : null, title: h ? h.textContent.trim() : null,
    focusIn: !!(a && a.closest('#sheet')), focus: a ? a.tagName.toLowerCase() + (a.dataset && a.dataset.action ? '[' + a.dataset.action + ']' : '') : null,
    behind: [...document.querySelectorAll('body > .topbar, body > #app, body > .tabbar')].map((el) => el.inert) };
});
async function waitFocus(page, sel) {
  await page.waitForFunction((s) => { const a = document.activeElement; return !!a && a !== document.body && a.matches(s); }, sel, { timeout: 3000 }).catch(() => {});
  return page.evaluate((s) => { const a = document.activeElement; return !!a && a !== document.body && a.matches(s); }, sel);
}
async function keyOpen(page, sel) { await page.focus(sel); await page.keyboard.press('Enter'); await page.waitForSelector('#sheet:not([hidden])'); await lib.sleep(50); }
async function tabsStayIn(page, n) {
  const left = [], inside = () => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#sheet-panel'));
  for (let i = 0; i < n; i++) { await page.keyboard.press('Tab'); if (!(await inside())) left.push(await page.evaluate(() => (document.activeElement || document.body).tagName)); }
  for (let i = 0; i < n; i++) { await page.keyboard.press('Shift+Tab'); if (!(await inside())) left.push(await page.evaluate(() => (document.activeElement || document.body).tagName)); }
  return left;
}
async function fuelPhone(browser, server, opts) {
  opts = opts || {};
  const theme = opts.theme || 'dark';
  const phone = await lib.newPhone(browser, { now: fx.meta.now, timezoneId: fx.meta.tz, colorScheme: theme });
  if (opts.welcome) await lib.seedStorage(phone.context, { 'fuel.theme': theme });
  else await lib.seedStorage(phone.context, { 'fuel.state.v1': F.fuelStateFrom(fx.state, { settings: { units: 'lb', theme } }), 'fuel.theme': theme, 'fuel.backup': { since: fx.meta.now - 3 * 864e5, lastExport: fx.meta.now - 864e5 } });
  const page = await phone.context.newPage();
  page.dialogs = []; page.on('dialog', (d) => { page.dialogs.push(d.message()); d.accept().catch(() => {}); });
  if (opts.insets) { const cdp = await phone.context.newCDPSession(page); await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: opts.insets }); }
  await page.goto(server.url + F.PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__overload && !!window.__overloadFood, null, { timeout: 15000 });
  await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.hidden = true; });
  return { phone, page };
}
const clean = (name, phone) => run.step(name, 'no page errors, no console errors', async () => { F.assertClean(phone, name); });

async function frameCloud(browser, server) {
  const name = 'cloud status (look#3)';
  let msgs = [];
  await run.step(name, 'the messages are read from fuel/sync.js (friendly(), report(), the "retrying" ending)', async () => { msgs = syncMessages(path.join(lib.REPO, 'fuel', 'sync.js')); return msgs.length + ' messages'; });
  for (const theme of ['dark', 'light']) {
    const { phone, page } = await fuelPhone(browser, server, { theme });
    await lib.openTab(page, 'settings'); await fakeSync(page, 'owner.with.a.long.address@example.com');
    for (const width of [320, 390]) {
      await run.step(name, 'Settings, ' + width + ' px, ' + theme + ': every message stays inside the card, whole', async () => {
        await page.setViewportSize({ width, height: 844 }); await lib.sleep(60);
        return pillsFit(page, msgs);
      });
    }
    await run.step(name, 'Settings, 390 px, ' + theme + ': "Synced 12:59 PM" stays a one-line pill beside "Signed in", at the card\'s right edge', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await lib.sleep(60);
      await page.evaluate(() => window.__overload.setSyncStatus('synced', 'Synced 12:59 PM'));
      const f = await pillFacts(page);
      need(f.height < 30, 'the pill is ' + Math.round(f.height) + ' px tall');
      need(f.top >= f.rowTop - 1 && f.top < f.rowBottom, 'the pill (top ' + Math.round(f.top) + ') is not beside "Signed in" (' + Math.round(f.rowTop) + '..' + Math.round(f.rowBottom) + ')');
      need(Math.abs(f.right - f.cardRight) < 1, 'the pill ends at ' + Math.round(f.right) + ', the card at ' + Math.round(f.cardRight));
      return Math.round(f.height) + ' px tall';
    });
    for (const width of [320, 390]) {
      await run.step(name, 'Settings, ' + width + ' px, ' + theme + ': a 60-character email with no hyphen stays inside the card (look#13), beside a short and a long message', async () => {
        await page.setViewportSize({ width, height: 844 }); await fakeSync(page, LONG_EMAIL);
        const bad = [];
        for (const m of ['Synced 12:59 PM', msgs[msgs.length - 1]]) {
          await page.evaluate(([s, t]) => window.__overload.setSyncStatus(s, t), [statusOf(m), m]);
          const f = await longFacts(page);
          if (!(await page.evaluate((e) => document.querySelector('#cloud-card').textContent.includes(e), LONG_EMAIL))) bad.push('the email is not in the card');
          bad.push(...f.bad.map((x) => '"' + m.slice(0, 20) + '": ' + x));
          const p = await pillFacts(page); if (p.right > p.cardRight + 0.5 || p.cut) bad.push('"' + m.slice(0, 20) + '": the pill runs off');
        }
        need(!bad.length, bad.join(' | ').slice(0, 600));
      });
    }
    await clean(name + ', ' + theme, phone); await phone.close();
  }
  const { phone, page } = await fuelPhone(browser, server, { welcome: true });
  await run.step(name, 'Welcome\'s sign-in sheet, 320 px: every message stays inside the sheet, whole', async () => {
    await page.setViewportSize({ width: 320, height: 844 });
    await fakeSync(page, null);
    await page.click('[data-action="fuel-signin"]'); await page.waitForSelector('#sheet:not([hidden]) #cloud-card.in-sheet');
    await page.evaluate(() => { window.__overloadSync.user = { email: 'owner.with.a.long.address@example.com', uid: 'u1' }; window.__overload.syncChanged(); });
    await page.waitForSelector('#sheet #cloud-status');
    return pillsFit(page, msgs);
  });
  await clean(name + ', Welcome', phone); await phone.close();
}

async function frameSheets(browser, server) {
  const name = 'sheets (look#6)';
  {
    const { phone, page } = await fuelPhone(browser, server);
    const opener = '[data-action="food-add"][data-meal="0"]';
    await run.step(name, 'Today > Add food by keys: a dialog named by its title; focus moves in; the page behind is inert', async () => {
      await keyOpen(page, opener);
      const s = await sheetFacts(page);
      same([s.role, s.modal, s.name], ['dialog', 'true', s.title], 'role, aria-modal and name');
      need(/^Add to Breakfast/.test(s.name || ''), 'the dialog is named "' + s.name + '"');
      need(s.focusIn, 'focus is on ' + s.focus + ', outside the sheet');
      same(s.behind, [true, true, true], 'the top bar, the screen and the tab bar are inert');
      return 'named "' + s.name + '"';
    });
    await run.step(name, 'Tab and Shift+Tab, 20 times each, stay inside the sheet', async () => {
      const left = await tabsStayIn(page, 20);
      need(!left.length, left.length + ' presses left the sheet, to ' + left.join(', '));
    });
    await run.step(name, 'Escape closes it, focus goes back to Add food, and nothing is inert', async () => {
      await page.keyboard.press('Escape');
      need(!(await F.sheetOpen(page)), 'the sheet is still open');
      need(await waitFocus(page, opener), 'focus is on ' + (await page.evaluate(() => (document.activeElement || document.body).outerHTML.slice(0, 80))));
      same((await sheetFacts(page)).behind, [false, false, false], 'inert');
    });
    await run.step(name, 'Add food, then Quick add (a sheet that replaces it), saved by keys: back in Add; Escape closes; focus goes to Breakfast\'s Add food, drawn again', async () => {
      await keyOpen(page, opener);
      await page.evaluate((s) => { window.__testOldAdd = document.querySelector(s); }, opener);
      await page.focus('#sheet [data-action="food-quick"]'); await page.keyboard.press('Enter');
      await page.waitForSelector('#food-quick-form');
      same((await sheetFacts(page)).name, 'Quick add', 'the dialog\'s name');
      await page.focus('#food-quick-form [name="kcal"]'); await page.keyboard.type('321');
      await page.focus('#food-quick-form button[type="submit"]'); await page.keyboard.press('Enter');
      await page.waitForSelector('#sheet:not([hidden]) #food-added .f-added:not(.none)');
      await F.afterAdd();
      await page.keyboard.press('Escape');
      need(!(await F.sheetOpen(page)), 'the sheet is still open');
      need(await waitFocus(page, opener), 'focus is on ' + (await page.evaluate(() => (document.activeElement || document.body).outerHTML.slice(0, 80))));
      need(await page.evaluate((s) => document.querySelector(s) !== window.__testOldAdd && !window.__testOldAdd.isConnected, opener), 'Add food was not drawn again (the test is not testing a redraw)');
    });
    await clean(name, phone); await phone.close();
  }
  {
    const { phone, page } = await fuelPhone(browser, server);
    const opener = '[data-action="food-add"][data-meal="0"]';
    await run.step(name, 'by touch: a tap opens Add food, a search is typed, the close button closes it; no ring, no scrolling, no text box focused', async () => {
      await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), opener);
      const y = await page.evaluate(() => window.scrollY);
      await page.tap(opener); await page.waitForSelector('#sheet:not([hidden])');
      need((await sheetFacts(page)).focusIn, 'focus did not move into the sheet');
      same(await outlineOfFocused(page), 'none', 'the outline of the sheet\'s title');
      await page.tap('[data-field="food-search"]'); await page.keyboard.type('egg');
      await page.tap('#sheet .sheet-title [data-action="sheet-close"]');
      need(await waitFocus(page, opener), 'focus did not go back to Add food');
      same(await outlineOfFocused(page), 'none', 'the outline of Add food');
      same(await page.evaluate(() => window.scrollY), y, 'the page scrolled');
      same(await htmlPadding(page), { top: 'auto', bottom: 'auto', keys: false }, 'the page\'s scroll padding');
    });
    await clean(name + ', touch', phone); await phone.close();
  }
}

async function frameNames(browser, server) {
  const name = 'field names (look#7)';
  {
    const { phone, page } = await fuelPhone(browser, server);
    await run.step(name, 'the Add sheet, a food\'s amount, Quick add and New food', async () => {
      await F.gotoDay(page, 0);
      await page.click('[data-action="food-add"][data-meal="0"]'); await page.waitForSelector('#sheet:not([hidden]) #food-results');
      const a = checkFields(await fields(page), 'Add');
      await page.click('#food-results [data-action="food-pick"]'); await page.waitForSelector('[data-field="food-qty"]');
      const b = checkFields(await fields(page), 'amount');
      await page.click('[data-action="food-back"]'); await page.waitForSelector('#food-results');
      await page.click('[data-action="food-quick"]'); await page.waitForSelector('#food-quick-form');
      const c = checkFields(await fields(page), 'Quick add');
      await F.closeSheet(page); await F.afterAdd();
      await page.click('[data-action="food-add"][data-meal="0"]'); await page.waitForSelector('#food-results');
      await page.click('[data-action="food-new"]'); await page.waitForSelector('#food-form');
      const d = checkFields(await fields(page), 'New food');
      await F.closeSheet(page);
      return [a, b, c, d].join(', ');
    });
    await run.step(name, 'Settings (body weight, the targets, the cloud sign-in form), Daily targets (from Today) and Bring food from Overload', async () => {
      await lib.openTab(page, 'settings'); await fakeSync(page, null);
      need(await page.$('#cloud-form [name="email"]') && await page.$('[data-field="food-target"]'), 'the sign-in form or the targets are not shown');
      const a = checkFields(await fields(page), 'Settings');
      await lib.openTab(page, 'food');
      await page.click('[data-action="food-targets"]'); await page.waitForSelector('#sheet:not([hidden]) [data-field="food-target"]');
      const b = checkFields(await fields(page), 'Daily targets'); await F.closeSheet(page);
      await lib.openTab(page, 'settings');
      await page.click('[data-action="fuel-import"]'); await page.waitForSelector('#sheet:not([hidden])');
      await page.click('[data-action="fuel-paste-box"]'); await page.waitForSelector('#fuel-paste');
      const c = checkFields(await fields(page), 'Bring food from Overload'); await F.closeSheet(page);
      return [a, b, c].join(', ');
    });
    await clean(name, phone); await phone.close();
  }
  {
    const { phone, page } = await fuelPhone(browser, server, { welcome: true });
    await run.step(name, 'Welcome\'s sign-in sheet', async () => {
      await fakeSync(page, null);
      await page.click('[data-action="fuel-signin"]'); await page.waitForSelector('#sheet:not([hidden]) #cloud-form');
      return checkFields(await fields(page), 'sign-in sheet');
    });
    await clean(name + ', Welcome', phone); await phone.close();
  }
}

async function frameLiveAndTabs(browser, server) {
  const name = 'toast and tabs (look#8)';
  const marks = (page) => page.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.dataset.screen + '=' + t.getAttribute('aria-current')).join(' '));
  {
    const { phone, page } = await fuelPhone(browser, server);
    await run.step(name, 'the toast is a polite status, so it is read out', async () => {
      same(await page.evaluate(() => { const e = document.querySelector('#toast'); return [e.getAttribute('role'), e.getAttribute('aria-live')]; }), ['status', 'polite'], 'role and aria-live of #toast');
      await page.evaluate(() => window.__overload.lib.toast('Saved'));
      same(await F.toast(page, /Saved/), 'Saved', 'the toast');
    });
    await run.step(name, 'the shown tab, and only it, is aria-current="page"', async () => {
      same(await marks(page), 'food=page trends=null settings=null', 'on start');
      await lib.openTab(page, 'trends');
      same(await marks(page), 'food=null trends=page settings=null', 'after Trends');
      await lib.openTab(page, 'settings');
      same(await marks(page), 'food=null trends=null settings=page', 'after Settings');
    });
    await clean(name, phone); await phone.close();
  }
  {
    const { phone, page } = await fuelPhone(browser, server, { welcome: true });
    await run.step(name, 'Welcome marks no tab', async () => {
      need(await page.$('[data-action="fuel-signin"]'), 'Welcome is not shown');
      same(await page.evaluate(() => document.querySelectorAll('.tab[aria-current], .tab.active').length), 0, 'tabs marked');
    });
    await clean(name + ', Welcome', phone); await phone.close();
  }
}

async function frameFocus(browser, server) {
  const name = 'focus clear of the bars (look#9)';
  for (const insets of [null, { top: 47, bottom: 34, left: 0, right: 0 }]) {
    const tag = insets ? ' (safe areas 47/34)' : '';
    const { phone, page } = await fuelPhone(browser, server, { insets });
    await run.step(name, 'Today' + tag + ': 60 Tabs from the top, none stops under a bar; no scroll padding before a key or after a tap', async () => {
      same(await htmlPadding(page), { top: 'auto', bottom: 'auto', keys: false }, 'the scroll padding before any key (touch is unchanged)');
      const walk = await tabWalk(page, 60), under = walk.filter((f) => f.under);
      need(walk.length > 30, 'only ' + walk.length + ' stops');
      need(!under.length, under.length + ' stops under a bar: ' + under.slice(0, 4).map((f) => f.what + ' at ' + f.top + '..' + f.bottom + ' (clear: ' + f.barBottom + '..' + f.barTop + ')').join(', '));
      need((await htmlPadding(page)).keys, 'no scroll padding while keys are used');
      await page.tap('.tab[data-screen="settings"]');
      same(await htmlPadding(page), { top: 'auto', bottom: 'auto', keys: false }, 'the scroll padding after a tap');
      return walk.length + ' stops';
    });
    await run.step(name, 'Settings' + tag + ': 60 Tabs from the top, none stops under a bar', async () => {
      await lib.openTab(page, 'settings');
      const walk = await tabWalk(page, 60), under = walk.filter((f) => f.under);
      need(!under.length, under.length + ' stops under a bar: ' + under.slice(0, 4).map((f) => f.what + ' at ' + f.top + '..' + f.bottom + ' (clear: ' + f.barBottom + '..' + f.barTop + ')').join(', '));
      return walk.length + ' stops';
    });
    await clean(name + tag, phone); await phone.close();
  }
}

// ---------------------------------------------------------------------------
// Inside a sheet: a sticky footer (the amount sheet's Add) and the strip stuck at the Add sheet's top (look#12)
// ---------------------------------------------------------------------------
// Where the focused control is, and how much of it a sticky footer or the stuck "Added" strip covers. Fully visible
// means inside the panel and the screen, and under neither.
const sheetStop = (page) => page.evaluate(() => {
  const a = document.activeElement, p = document.querySelector('#sheet-panel');
  const what = a ? a.tagName.toLowerCase() + (a.dataset && a.dataset.action ? '[' + a.dataset.action + ']' : '') + ' "' + (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 24) + '"' : 'nothing';
  if (!a || !p.contains(a)) return { out: true, what };
  const r = a.getBoundingClientRect(), pr = p.getBoundingClientRect();
  const edges = [...p.querySelectorAll('.sheet-foot, #food-added')].filter((el) => getComputedStyle(el).position === 'sticky' && !el.contains(a));
  const covered = Math.max(0, ...edges.map((el) => { const e = el.getBoundingClientRect(); return Math.min(r.bottom, e.bottom) - Math.max(r.top, e.top); }));
  const outside = r.top < Math.max(pr.top, 0) - 0.5 || r.bottom > Math.min(pr.bottom, innerHeight) + 0.5;
  return { what, top: Math.round(r.top), bottom: Math.round(r.bottom), covered: Math.round(covered), outside };
});
// Tab n times, then Shift+Tab n times (both go round inside the sheet); every stop that is not fully visible.
async function sheetWalk(page, n) {
  const hidden = [], seen = new Set();
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < n; i++) {
      await page.keyboard.press(key); await lib.sleep(30);
      const s = await sheetStop(page);
      if (s.out) { hidden.push(key + ' left the sheet, to ' + s.what); break; }
      seen.add(s.what);
      if (s.covered > 0.5 || s.outside) hidden.push(key + ': ' + s.what + ' at ' + s.top + '..' + s.bottom + (s.covered > 0.5 ? ', ' + s.covered + ' px under a sticky edge' : ', outside the sheet'));
    }
  }
  return { hidden, stops: seen.size };
}
async function frameSheetEdges(browser, server) {
  const name = 'focus clear of a sheet\'s footer and its top strip (look#12)';
  for (const vp of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    const tag = vp.width + 'x' + vp.height;
    const { phone, page } = await fuelPhone(browser, server);
    await page.setViewportSize(vp);
    const opener = '[data-action="food-add"][data-meal="0"]';
    await run.step(name, tag + ', the Add sheet by keys ("Added" sticks at its top): Tab and Shift+Tab, 60 each, every stop fully visible', async () => {
      await keyOpen(page, opener); await page.waitForSelector('#food-results .f-row');
      need(await page.evaluate(() => getComputedStyle(document.querySelector('#food-added')).position === 'sticky'), 'the "Added" strip does not stick (the test is not testing it)');
      const w = await sheetWalk(page, 60);
      need(w.stops >= 30, 'only ' + w.stops + ' stops');
      need(!w.hidden.length, w.hidden.length + ' stops not fully visible: ' + w.hidden.slice(0, 5).join(' | '));
      return w.stops + ' stops';
    });
    await run.step(name, tag + ', a food\'s amount, to add (its Add button sticks at the bottom), by keys: Tab and Shift+Tab, 20 each, every stop fully visible', async () => {
      const pick = await page.evaluate(() => { const foods = window.__overload.state.food.foods; const b = [...document.querySelectorAll('#food-results [data-action="food-pick"]')].find((x) => { const f = foods[x.dataset.id]; return f && f.src === 'usda' && !f.barcode; }); if (!b) return null; b.setAttribute('data-test-pick', '1'); return true; });
      need(pick, 'no listed food without a barcode in the Add sheet');
      await page.focus('[data-test-pick="1"]'); await page.keyboard.press('Enter'); await page.waitForSelector('[data-field="food-qty"]');
      need(await page.evaluate(() => getComputedStyle(document.querySelector('#sheet .sheet-foot')).position === 'sticky'), 'the footer does not stick (the test is not testing it)');
      const w = await sheetWalk(page, 20);
      await page.keyboard.press('Escape'); await lib.sleep(60);
      need(!w.hidden.length, w.hidden.length + ' stops not fully visible: ' + w.hidden.slice(0, 5).join(' | '));
      return w.stops + ' stops';
    });
    await run.step(name, tag + ', a logged food\'s Edit by keys (Save, Remove: the footer scrolls with the sheet): Tab and Shift+Tab, 20 each, every stop fully visible', async () => {
      await F.afterAdd();
      await page.focus('.f-meal .f-row[data-id]'); await page.keyboard.press('Enter'); await page.waitForSelector('#sheet:not([hidden]) .sheet-foot');
      const w = await sheetWalk(page, 20);
      await page.keyboard.press('Escape'); await lib.sleep(60);
      need(!w.hidden.length, w.hidden.length + ' stops not fully visible: ' + w.hidden.slice(0, 5).join(' | '));
      return w.stops + ' stops';
    });
    await run.step(name, tag + ': by touch the sheet has no scroll padding (nothing changes for a tap)', async () => {
      await F.afterAdd();
      await page.tap(opener); await page.waitForSelector('#sheet:not([hidden]) #food-results');
      const pad = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('#sheet-panel')); return [s.scrollPaddingTop, s.scrollPaddingBottom, document.documentElement.classList.contains('keys')]; });
      same(pad, ['auto', 'auto', false], 'the sheet\'s scroll padding after a tap');
      await page.tap('#sheet .sheet-title [data-action="sheet-close"]');
    });
    await clean(name + ', ' + tag, phone); await phone.close();
  }
}

// ---------------------------------------------------------------------------
// Long unbroken texts (look#13): food names, brands, saved meals, barcodes, search text, the account email
// ---------------------------------------------------------------------------
const long60 = (base, i) => (base.replace(/[^A-Za-z0-9.@]/g, '') + 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ').slice(0, 57) + String(i).padStart(3, '0');
const LONG_EMAIL = 'alexander.maximilian.longname.familyname.second@examplemail.co';   // 60 characters, no hyphen
const LONG_CODE = '9876543210'.repeat(6);
// The same measure as tests/train-look.js: every text with a word of 24 characters or more stays inside the content box
// of each card, sheet and screen around it, nothing cuts it off, the page does not scroll sideways.
const longFacts = (page) => page.evaluate(() => {
  const bad = [], W = innerWidth, sheet = !document.querySelector('#sheet').hidden;
  const over = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - W;
  if (over > 0) bad.push('the page scrolls sideways by ' + over + ' px');
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '');
  const BOX = '.card, .sheet-panel, .banner, .rest-timer, .toast, .f-added, .screen';
  let n = 0;
  const check = (el, rects, text) => {
    const right = Math.max(...rects.map((q) => q.right)), left = Math.min(...rects.map((q) => q.left));
    let lr = W, ll = 0, cut = null, ellipsis = false;
    for (let b0 = el.closest(BOX); b0; b0 = b0.parentElement && b0.parentElement.closest(BOX)) { const b = b0.getBoundingClientRect(), s = getComputedStyle(b0); lr = Math.min(lr, b.right - parseFloat(s.paddingRight)); ll = Math.max(ll, b.left + parseFloat(s.paddingLeft)); }
    for (let x = el; x && x !== document.body; x = x.parentElement) {
      const s = getComputedStyle(x); if (s.overflowX === 'visible') continue;
      const b = x.getBoundingClientRect(); if (right <= b.right + 0.5 && left >= b.left - 0.5) continue;
      if (s.textOverflow === 'ellipsis' && s.whiteSpace === 'nowrap') ellipsis = true; else cut = x;
      break;
    }
    if (cut) bad.push('cut off by ' + name(cut) + ': ' + name(el) + ' "' + text.slice(0, 26) + '…" at ' + Math.round(left) + '..' + Math.round(right));
    else if (!ellipsis && (right > lr + 0.5 || left < ll - 0.5)) bad.push(name(el) + ' "' + text.slice(0, 26) + '…" at ' + Math.round(left) + '..' + Math.round(right) + ', its box ' + Math.round(ll) + '..' + Math.round(lr));
  };
  const walker = document.createTreeWalker(sheet ? document.querySelector('#sheet-panel') : document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!/\S{24,}/.test(t.nodeValue)) continue;
    const el = t.parentElement; if (!el || el.closest('[hidden], script, style, .sr, title, option, [inert]') || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
    let shown = true; for (let x = el; x && x !== document.body; x = x.parentElement) { const s = getComputedStyle(x); if ((s.clipPath && s.clipPath !== 'none') || x.getBoundingClientRect().width <= 1) { shown = false; break; } }
    if (!shown) continue;
    const r = document.createRange(); r.selectNodeContents(t);
    const rects = [...r.getClientRects()].filter((q) => q.width > 0.5); if (!rects.length) continue;
    n++; check(el, rects, t.nodeValue.trim());
  }
  return { bad, n };
});
async function longStep(page, where, minTexts) {
  await run.step('long unbroken texts (look#13)', '320 px: ' + where + ': every long word stays inside its card, nothing cut, no sideways scroll', async () => {
    await lib.sleep(80);
    const f = await longFacts(page);
    need(f.n >= (minTexts || 1), 'only ' + f.n + ' long texts on screen (the test is not testing them)');
    need(!f.bad.length, f.bad.length + ' run past their card: ' + f.bad.slice(0, 4).join(' | '));
    return f.n + ' long texts';
  });
}
// Fuel's food log with every food, brand and saved meal named by one 60-character word; some foods carry a 60-digit
// barcode; one of them is his own food (Edit food).
function longFuel() {
  const st = F.fuelStateFrom(JSON.parse(fx.text), { settings: { units: 'lb', theme: 'dark' } });
  let i = 0, own = null;
  Object.values(st.food.foods).forEach((f) => {
    f.name = long60('ChocolatePeanutButterProteinBarWithCrispyRice', i++);
    if (f.brand || i % 3 === 0) f.brand = long60('KirklandSignatureOrganicFarmersMarketSelection', i);
    if (i % 4 === 0) { f.barcode = LONG_CODE.slice(0, 58) + String(i).padStart(2, '0'); if (!own) { own = f; f.src = 'custom'; f.brand = long60('KirklandSignatureOrganicFarmersMarketSelection', i); } }
  });
  Object.values(st.food.meals).forEach((m, j) => { m.name = long60('MyUsualSundayBrunchWithEggsBaconAndPancakes', j); m.items.forEach((x, k) => { x.name = long60('ChocolatePeanutButterProteinBarWithCrispyRice', 500 + k); }); });
  Object.keys(st.diary).forEach((d) => st.diary[d].forEach((e, k) => { e.name = long60('ChocolatePeanutButterProteinBarWithCrispyRice', 700 + k); if (e.brand) e.brand = long60('KirklandSignatureOrganicFarmersMarketSelection', k); }));
  return { st, own: own && own.id };
}
async function frameLong(browser, server) {
  const name = 'long unbroken texts (look#13)';
  {
    const { st, own } = longFuel();
    const phone = await lib.newPhone(browser, { now: fx.meta.now, timezoneId: fx.meta.tz });
    await lib.seedStorage(phone.context, { 'fuel.state.v1': st, 'fuel.theme': 'dark', 'fuel.backup': { since: fx.meta.now - 3 * 864e5, lastExport: fx.meta.now - 864e5 } });
    const page = await F.open(phone, server); await page.setViewportSize({ width: 320, height: 844 });
    await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.hidden = true; });
    await longStep(page, 'Today: food names and brands', 10);
    await page.click('[data-action="food-add"][data-meal="0"]'); await page.waitForSelector('#sheet:not([hidden]) #food-results .f-row');
    await longStep(page, 'the Add sheet: saved meals, favorites, recent', 10);
    await page.click('#food-results [data-action="food-sm-open"]'); await page.waitForSelector('#sheet [data-action="food-back"]'); await longStep(page, 'a saved meal (sheet)', 2);
    await page.click('[data-action="food-back"]'); await page.waitForSelector('#food-results .f-row');
    await page.click('#food-results [data-action="food-pick"]'); await page.waitForSelector('[data-field="food-qty"]'); await longStep(page, 'a food\'s amount (sheet): its name is the title');
    await page.click('[data-action="food-back"]'); await page.waitForSelector('#food-results .f-row'); await F.afterAdd();
    await page.click('#food-results [data-action="food-plus"]'); await page.waitForSelector('#food-added .f-added:not(.none)'); await longStep(page, 'the Add sheet after +: "Added: …"', 10);
    await page.fill('[data-field="food-search"]', long60('ChocolatePeanutButterProteinBarWithCrispyRice', 1).slice(0, 50)); await page.waitForSelector('[data-action="food-online"]');
    await longStep(page, 'the Add sheet, searching a 50-character word: the results and "Search brands for …"', 2);
    await page.fill('[data-field="food-search"]', 'zz' + 'q'.repeat(58)); await page.waitForFunction(() => /qqqq”/.test((document.querySelector('[data-action="food-online"]') || {}).textContent || ''));
    await longStep(page, 'the Add sheet, a 60-character search with no match');
    await page.fill('[data-field="food-search"]', ''); await page.waitForSelector('#food-results .f-row');
    await page.click('[data-action="food-scan"]'); await page.waitForSelector('#scan-status');
    await page.waitForFunction(() => !/Starting/.test(document.querySelector('#scan-status').textContent));   // the camera has answered (here: it did not start)
    // What the scan sheet says while it looks a number up ("Looking up …"), with the 60 digits he typed.
    await page.evaluate((c) => { document.querySelector('#scan-status').textContent = 'Looking up ' + c + '…'; }, LONG_CODE);
    await longStep(page, 'Scan barcode, looking up a 60-digit number');
    need(own, 'no food of his own with a barcode');
    await page.evaluate((id) => window.__overloadFood._.foundCode(window.__overload.state.food.foods[id].barcode), own); await page.waitForSelector('[data-field="food-qty"]');
    await longStep(page, 'his own food found by its barcode (amount sheet, a long brand)', 2);
    await page.click('[data-action="food-fix"]'); await page.waitForSelector('#food-form');
    await run.step(name, '320 px: Edit food with a 60-digit barcode: its box holds the whole number, inside the sheet', async () => {
      const f = await page.evaluate(() => { const b = document.querySelector('#food-form [name="barcode"]'), r = b.getBoundingClientRect(), p = document.querySelector('#sheet-panel').getBoundingClientRect(); return { v: b.value.length, inside: r.left >= p.left && r.right <= p.right + 0.5, over: document.documentElement.scrollWidth - innerWidth }; });
      need(f.v === 60 && f.inside && f.over <= 0, JSON.stringify(f));
    });
    await F.closeSheet(page); await F.afterAdd();
    await lib.openTab(page, 'settings'); await fakeSync(page, LONG_EMAIL);
    await page.evaluate(() => window.__overload.setSyncStatus('synced', 'Synced 12:59 PM')); await longStep(page, 'Settings > Cloud sync, a 60-character email beside "Synced 12:59 PM"');
    await page.evaluate(() => window.__overload.lib.toast('Saved "' + Object.values(window.__overload.state.food.meals)[0].name + '"')); await page.waitForSelector('#toast:not([hidden])');
    await longStep(page, 'the toast, with a saved meal\'s name');
    await clean(name, phone); await phone.close();
  }
  {
    const { phone, page } = await fuelPhone(browser, server, { welcome: true });
    await page.setViewportSize({ width: 320, height: 844 });
    await fakeSync(page, LONG_EMAIL); await page.waitForFunction((e) => document.querySelector('#app').textContent.includes(e), LONG_EMAIL);
    await longStep(page, 'Welcome, signed in: "Signed in as …"');
    await clean(name + ', Welcome', phone); await phone.close();
  }
}

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
    await frameCloud(browser, server);
    await frameSheets(browser, server);
    await frameNames(browser, server);
    await frameLiveAndTabs(browser, server);
    await frameFocus(browser, server);
    await frameSheetEdges(browser, server);
    await frameLong(browser, server);
  } catch (e) {
    run.say(false, 'fuel-look', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
    await server.stop();
  }
  run.done();
})();
