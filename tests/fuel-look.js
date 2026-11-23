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
  } catch (e) {
    run.say(false, 'fuel-look', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
    await server.stop();
  }
  run.done();
})();
