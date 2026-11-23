#!/usr/bin/env node
/* Overload 3.0: the look and accessibility of the shared frame (review round 3, findings look#3, look#6 to look#10).
 *
 *   node tests/train-look.js [--port=8436]
 *
 *   - Cloud sync status (look#3): every message sync.js can put in the pill (read from sync.js itself: each
 *     friendly() message, alone and with " Nothing was uploaded; retrying.", and report()'s own) stays inside the
 *     card at 320 and 390 px, dark and light: no sideways scroll, nothing cut. A short one stays on one line.
 *   - Sheets are dialogs (look#6): role="dialog", aria-modal, named by the title; focus moves into the sheet when it
 *     opens; the page behind is inert; Tab stays inside; Escape closes it; focus goes back to what opened it, also
 *     when that was drawn again by a save. By touch: no ring is drawn, the page does not scroll, no keyboard opens.
 *   - Every form field on the screens and sheets has a name, and the name holds its visible label (look#7).
 *   - The toast is announced (role="status", aria-live="polite") and the shown tab is aria-current="page" (look#8).
 *   - Keyboard focus never stops under the top bar, the rest dock or the tab bar, also with the iPhone's safe areas
 *     (look#9); scrolling by touch is unchanged (no scroll padding until a key is used).
 *   - Calendar day numbers have tabular figures (look#10).
 * Review round 4:
 *   - Inside a sheet whose Save sticks at the bottom (Edit exercise, New exercise), Tab and Shift+Tab never stop
 *     where Save covers the control, at 320x568 and 390x844; after a tap the sheet has no scroll padding (look#12).
 *   - Long unbroken texts at 320 px (exercise, day, template and cardio names of 60 characters, a 60-character email
 *     in Settings > Cloud sync, also at 390 px and beside every status): each stays inside its card, nothing is cut,
 *     the page does not scroll sideways (look#13).
 *   - Numbers that line up in rows have tabular figures: History's workout rows and their PR counts, the recovery
 *     average, the set lists of a past workout and of Edit sets (look#14).
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const T = require('./train-common');

const args = T.args();
const PORT = Number(args.port) || 8436;
const run = T.runner('train-look');
const { need, same } = run;
const heavy = lib.loadFixture('v28-state'), small = lib.loadFixture('v28-state-small'), active = lib.loadFixture('v28-state-active');

// ---------------------------------------------------------------------------
// The messages sync.js can show in #cloud-status (report() and friendly()), read from the file itself.
// ---------------------------------------------------------------------------
function syncMessages(file) {
  const src = fs.readFileSync(file, 'utf8');
  const map = (/function friendly\(e\) \{[\s\S]*?const map = \{([\s\S]*?)\n\s*\};/.exec(src) || [])[1] || '';
  const friendly = [...map.matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'")).concat(['Something went wrong.']);
  need(friendly.length >= 10, 'friendly() in ' + path.basename(file) + ' was not found (' + friendly.length + ' messages)');
  const retry = (/lastError = \(friendly\(e\) \|\| '[^']*'\) \+ '([^']+)'/.exec(src) || [])[1];
  need(retry, 'the "retrying" ending in ' + path.basename(file) + ' was not found');
  // A message Firebase gives that friendly() does not know is shown as it is: a long one, with a long word in it.
  const raw = 'Firebase: Error (firestore/failed-precondition). https://console.firebase.google.com/project/overload-sync/firestore/indexes?create_composite=ClVwcm9qZWN0cy9vdmVybG9hZA';
  return [...new Set(['Synced', 'Synced 12:59 PM', 'Syncing…', 'Offline, will sync later', 'Connected'].concat(friendly, friendly.map((m) => m + retry), [raw, raw + retry]))];
}
const statusOf = (m) => (/^Synced/.test(m) ? 'synced' : /^Syncing/.test(m) ? 'syncing' : /^Offline/.test(m) ? 'offline' : m === 'Connected' ? 'synced' : 'error');
// Pretends the sync module is loaded, signed in or out (null), as tests/fake-firebase is not needed for the card.
const fakeSync = (page, email) => page.evaluate((em) => {
  window.__overloadSync = { user: em ? { email: em, uid: 'u1' } : null, release: '3.0', foodInCloud: false, signIn() { return Promise.reject(new Error('x')); }, createAccount() {}, resetPassword() {}, signOut() {}, pushNow() {} };
  window.__overload.syncChanged();
}, email);
const pillFacts = (page) => page.evaluate(() => {
  const p = document.querySelector('#cloud-status'), card = p.closest('.card'), b = p.getBoundingClientRect(), c = card.getBoundingClientRect(), cs = getComputedStyle(card);
  const row = p.closest('.toggle-row').firstElementChild.getBoundingClientRect();
  return { right: b.right, left: b.left, cardRight: c.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth), cardLeft: c.left + parseFloat(cs.paddingLeft), over: document.documentElement.scrollWidth - innerWidth, cut: p.scrollWidth > p.clientWidth + 1 || p.scrollHeight > p.clientHeight + 1, height: b.height, top: b.top, rowTop: row.top, rowBottom: row.bottom, text: p.textContent };
});

// ---------------------------------------------------------------------------
// Form fields: the name assistive tech gives each one, and the label the screen shows next to it.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Focus and the fixed bars
// ---------------------------------------------------------------------------
const focusFacts = (page) => page.evaluate(() => {
  const a = document.activeElement; if (!a || a === document.body) return null;
  const r = a.getBoundingClientRect(), top = document.querySelector('.topbar').getBoundingClientRect().bottom;
  const nav = document.querySelector('.tabbar'), dock = document.querySelector('#rest-timer');
  const lows = [nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : innerHeight];
  if (dock && !dock.hidden && getComputedStyle(dock).display !== 'none') lows.push(dock.getBoundingClientRect().top);
  const bottom = Math.min(...lows), fixed = !!a.closest('.topbar, .tabbar, #rest-timer, #sheet');
  return { what: a.tagName.toLowerCase() + (a.dataset.action ? '[' + a.dataset.action + ']' : '') + ' "' + (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 24) + '"', top: Math.round(r.top), bottom: Math.round(r.bottom), barBottom: Math.round(top), barTop: Math.round(bottom), fixed, under: !fixed && (r.top < top - 0.5 || r.bottom > bottom + 0.5) };
});
async function tabWalk(page, n) {
  await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement) document.activeElement.blur(); });
  const out = [];
  for (let i = 0; i < n; i++) { await page.keyboard.press('Tab'); const f = await focusFacts(page); if (f) out.push(f); }
  return out;
}
const outlineOfFocused = (page) => page.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? getComputedStyle(a).outlineStyle : 'none'; });
const htmlPadding = (page) => page.evaluate(() => { const s = getComputedStyle(document.documentElement); return { top: s.scrollPaddingTop, bottom: s.scrollPaddingBottom, keys: document.documentElement.classList.contains('keys') }; });

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------
const sheetFacts = (page) => page.evaluate(() => {
  const p = document.querySelector('#sheet-panel'), h = p.querySelector('.sheet-title h2'), a = document.activeElement;
  const named = document.getElementById(p.getAttribute('aria-labelledby') || '');
  return { open: !document.querySelector('#sheet').hidden, role: p.getAttribute('role'), modal: p.getAttribute('aria-modal'), name: named ? named.textContent.trim() : null, title: h ? h.textContent.trim() : null,
    focusIn: !!(a && a.closest('#sheet')), focus: a ? a.tagName.toLowerCase() + (a.dataset && a.dataset.action ? '[' + a.dataset.action + ']' : '') : null,
    behind: [...document.querySelectorAll('body > .topbar, body > #app, body > .tabbar, body > #rest-timer')].map((el) => el.inert) };
});
const activeIs = (page, sel) => page.evaluate((s) => { const a = document.activeElement; return !!a && a !== document.body && a.matches(s); }, sel);
async function waitFocus(page, sel) { await page.waitForFunction((s) => { const a = document.activeElement; return !!a && a !== document.body && a.matches(s); }, sel, { timeout: 3000 }).catch(() => {}); return activeIs(page, sel); }
async function keyOpen(page, sel) {
  await page.focus(sel); await page.keyboard.press('Enter');
  await page.waitForSelector('#sheet:not([hidden])'); await lib.sleep(50);
}
async function tabsStayIn(page, n) {
  const left = [];
  for (let i = 0; i < n; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#sheet-panel')))) left.push(await page.evaluate(() => (document.activeElement || document.body).tagName)); }
  await page.keyboard.press('Shift+Tab');
  for (let i = 0; i < n; i++) { await page.keyboard.press('Shift+Tab'); if (!(await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#sheet-panel')))) left.push(await page.evaluate(() => (document.activeElement || document.body).tagName)); }
  return left;
}

async function phoneWith(browser, server, fx, opts) {
  opts = opts || {};
  const phone = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now, colorScheme: opts.theme || 'dark' });
  const st = JSON.parse(fx.text); st.settings.theme = opts.theme || 'dark';
  if (opts.mod) opts.mod(st);
  await lib.seedV28(phone.context, st, { backup: { since: fx.meta.now - 3 * 864e5, lastExport: fx.meta.now - 864e5, split: { at: 1, dismissed: 'x' } }, extra: opts.extra });
  const page = await phone.context.newPage();
  page.dialogs = []; page.on('dialog', (d) => { page.dialogs.push(d.message()); d.accept().catch(() => {}); });
  if (opts.insets) { const cdp = await phone.context.newCDPSession(page); await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: opts.insets }); }
  if (opts.width) await page.setViewportSize({ width: opts.width, height: 844 });
  await page.goto(server.url + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__overload, null, { timeout: 15000 });
  await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.hidden = true; });
  return { phone, page };
}
const errors = (name, phone) => { const p = phone.problems(); run.say(!p.length, name, 'no page errors, no console errors', p.join(' | ').slice(0, 400)); };

// ---------------------------------------------------------------------------
async function cloudStatus(browser, server) {
  const name = 'cloud status (look#3)';
  let msgs = [];
  await run.step(name, 'the messages are read from sync.js (friendly(), report(), the "retrying" ending)', async () => { msgs = syncMessages(path.join(lib.REPO, 'sync.js')); return msgs.length + ' messages'; });
  for (const theme of ['dark', 'light']) {
    const { phone, page } = await phoneWith(browser, server, small, { theme });
    await lib.openTab(page, 'settings'); await fakeSync(page, 'owner.with.a.long.address@example.com');
    for (const width of [320, 390]) {
      await run.step(name, width + ' px, ' + theme + ': each of the ' + msgs.length + ' messages sync.js can show stays inside the card, whole', async () => {
        need(msgs.length > 10, 'no messages to show');
        await page.setViewportSize({ width, height: 844 }); await lib.sleep(60);
        const bad = [];
        let tallest = 0;
        for (const m of msgs) {
          await page.evaluate(([s, t]) => window.__overload.setSyncStatus(s, t), [statusOf(m), m]);
          const f = await pillFacts(page);
          if (f.text !== m) bad.push('"' + m + '" shows as "' + f.text + '"');
          else if (f.over > 0 || f.right > f.cardRight + 0.5 || f.left < f.cardLeft - 0.5 || f.cut) bad.push('"' + m.slice(0, 50) + '": right edge ' + Math.round(f.right) + ' of ' + Math.round(f.cardRight) + ', page scrolls ' + f.over + ' px' + (f.cut ? ', cut' : ''));
          tallest = Math.max(tallest, f.height);
        }
        need(!bad.length, bad.length + ' run off: ' + bad.join(' | ').slice(0, 700));
        return 'the tallest is ' + Math.round(tallest) + ' px';
      });
    }
    await run.step(name, '390 px, ' + theme + ': "Synced 12:59 PM" stays a one-line pill beside "Signed in", at the card\'s right edge', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await lib.sleep(60);
      await page.evaluate(() => window.__overload.setSyncStatus('synced', 'Synced 12:59 PM'));
      const f = await pillFacts(page);
      need(f.height < 30, 'the pill is ' + Math.round(f.height) + ' px tall');
      need(f.top >= f.rowTop - 1 && f.top < f.rowBottom, 'the pill (top ' + Math.round(f.top) + ') is not beside "Signed in" (' + Math.round(f.rowTop) + '..' + Math.round(f.rowBottom) + ')');
      need(Math.abs(f.right - f.cardRight) < 1, 'the pill ends at ' + Math.round(f.right) + ', the card at ' + Math.round(f.cardRight));
      return Math.round(f.height) + ' px tall, right edge ' + Math.round(f.right);
    });
    for (const width of [320, 390]) {
      await run.step(name, width + ' px, ' + theme + ': a 60-character email with no hyphen stays inside the card (look#13), beside a short and a long message', async () => {
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
    errors(name + ', ' + theme, phone); await phone.close();
  }
}

async function sheets(browser, server) {
  const name = 'sheets (look#6)';
  {
    const { phone, page } = await phoneWith(browser, server, heavy);
    await run.step(name, 'History > Edit weigh-ins by keys: a dialog named by its title; focus moves in; the page behind is inert', async () => {
      await lib.openTab(page, 'history');
      await keyOpen(page, '[data-action="bw-list"]');
      const s = await sheetFacts(page);
      same([s.role, s.modal, s.name], ['dialog', 'true', 'Weigh-ins'], 'role, aria-modal and name');
      need(s.focusIn, 'focus is on ' + s.focus + ', outside the sheet');
      same(s.behind, [true, true, true, true], 'the top bar, the screen, the tab bar and the rest dock are inert');
      return 'focus on ' + s.focus;
    });
    await run.step(name, 'Tab and Shift+Tab, 20 times each, stay inside the sheet', async () => {
      const left = await tabsStayIn(page, 20);
      need(!left.length, left.length + ' presses left the sheet, to ' + left.join(', '));
    });
    await run.step(name, 'Escape closes it, focus goes back to Edit weigh-ins, and nothing is inert', async () => {
      await page.keyboard.press('Escape');
      need(!(await T.sheetOpen(page)), 'the sheet is still open');
      need(await waitFocus(page, '[data-action="bw-list"]'), 'focus is on ' + (await page.evaluate(() => document.activeElement.outerHTML.slice(0, 80))));
      same((await sheetFacts(page)).behind, [false, false, false, false], 'inert');
    });
    await run.step(name, 'Escape works from a text box in the sheet too (Exercises > an exercise, in its Name box)', async () => {
      await lib.openTab(page, 'exercises');
      await keyOpen(page, '#app [data-action="edit-ex"]');
      await page.focus('#ex-form [name="name"]'); await page.keyboard.press('Escape');
      need(!(await T.sheetOpen(page)), 'the sheet is still open');
      need(await waitFocus(page, '#app [data-action="edit-ex"]'), 'focus is not back on the exercise');
    });
    await run.step(name, 'Save by keys closes the sheet; focus goes to the same exercise, drawn again', async () => {
      const ex = await page.evaluate(() => document.querySelectorAll('#app [data-action="edit-ex"]')[2].dataset.ex);
      const sel = '#app [data-action="edit-ex"][data-ex="' + ex + '"]';
      await keyOpen(page, sel);
      await page.evaluate((s) => { window.__testOldRow = document.querySelector(s); }, sel);
      await page.focus('#ex-form [name="notes"]'); await page.keyboard.type(' x');
      await page.focus('#ex-form button[type="submit"]'); await page.keyboard.press('Enter');
      await page.waitForSelector('#sheet', { state: 'hidden' });
      need(await waitFocus(page, sel), 'focus is on ' + (await page.evaluate(() => (document.activeElement || document.body).outerHTML.slice(0, 80))));
      need(await page.evaluate((s) => document.querySelector(s) !== window.__testOldRow && !window.__testOldRow.isConnected, sel), 'the row was not drawn again (the test is not testing a redraw)');
    });
    await run.step(name, 'a sheet that replaces another (Edit day, then Add exercise): Escape closes it; focus goes back to that day\'s Edit', async () => {
      await lib.openTab(page, 'program');
      const sel = '[data-action="edit-day"]';
      await keyOpen(page, sel);
      await page.focus('#sheet [data-action="pick-ex"]'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => /Add exercise/.test(document.querySelector('#sheet .sheet-title h2').textContent));
      const s = await sheetFacts(page);
      same(s.name, 'Add exercise', 'the dialog\'s name');
      need(await activeIs(page, '[data-field="pick-search"]'), 'focus is on ' + s.focus + ', not on the search box (marked autofocus)');
      await page.keyboard.press('Escape');
      need(await waitFocus(page, sel), 'focus is not back on Edit');
    });
    errors(name, phone); await phone.close();
  }
  {
    const { phone, page } = await phoneWith(browser, server, heavy);
    await run.step(name, 'by touch: a tap opens Edit weigh-ins and its close button closes it; no ring, no scrolling, no scroll padding', async () => {
      await lib.openTab(page, 'history');
      await page.evaluate(() => document.querySelector('[data-action="bw-list"]').scrollIntoView({ block: 'center' }));
      const y = await page.evaluate(() => window.scrollY);
      await page.tap('[data-action="bw-list"]'); await page.waitForSelector('#sheet:not([hidden])');
      const s = await sheetFacts(page);
      need(s.focusIn, 'focus did not move into the sheet');
      same(await outlineOfFocused(page), 'none', 'the outline of the sheet\'s title');
      await page.tap('#sheet .sheet-title [data-action="sheet-close"]');
      need(await waitFocus(page, '[data-action="bw-list"]'), 'focus did not go back to Edit weigh-ins');
      same(await outlineOfFocused(page), 'none', 'the outline of Edit weigh-ins');
      same(await page.evaluate(() => window.scrollY), y, 'the page scrolled');
      same(await htmlPadding(page), { top: 'auto', bottom: 'auto', keys: false }, 'the page\'s scroll padding');
    });
    await run.step(name, 'by touch: a tap on Exercises > New opens the form; closing it never focuses a text box (no keyboard)', async () => {
      await lib.openTab(page, 'exercises');
      await page.tap('[data-field="search"]'); await page.keyboard.type('a');
      await page.tap('[data-action="new-ex"]'); await page.waitForSelector('#sheet:not([hidden])');
      await page.tap('#sheet .sheet-title [data-action="sheet-close"]'); await lib.sleep(150);
      const a = await page.evaluate(() => (document.activeElement || document.body).tagName);
      need(a !== 'INPUT', 'focus went back to the search box');
      return 'focus on ' + a;
    });
    errors(name + ', touch', phone); await phone.close();
  }
  {
    const { phone, page } = await phoneWith(browser, server, active);
    await run.step(name, 'as on an iPhone (a tapped button takes no focus): the exercise picker\'s search is autofocused the first time it opens, as before, and focus is not moved for it after', async () => {
      const seen = [];
      for (let i = 0; i < 2; i++) {
        seen.push(await page.evaluate(async () => {
          if (document.activeElement) document.activeElement.blur();
          document.querySelector('[data-action="add-entry"]').click();
          await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
          await new Promise((ok) => setTimeout(ok, 100));
          const a = document.activeElement, out = a === document.body ? 'body' : a.tagName.toLowerCase() + (a.dataset.field ? '[' + a.dataset.field + ']' : '');
          document.querySelector('#sheet [data-action="sheet-close"]').click();
          return out;
        }));
        await lib.sleep(150);
      }
      same(seen, ['input[pick-search]', 'body'], 'the focus after the first and the second opening');
      same(await htmlPadding(page), { top: 'auto', bottom: 'auto', keys: false }, 'the page\'s scroll padding');
    });
    errors(name + ', autofocus', phone); await phone.close();
  }
}

async function names(browser, server) {
  const name = 'field names (look#7)';
  {
    // Nothing logged this morning, and both questions on: the check-in asks for body weight and three sleep times.
    const checkin = (st) => { st.bodyweight = []; st.sleep = []; st.settings.weighEvery = 1; st.settings.sleepOn = true; };
    const { phone, page } = await phoneWith(browser, server, small, { mod: checkin });
    await run.step(name, 'Today with the morning check-in', async () => { need(await page.$('#bw-form'), 'no check-in on Today'); return checkFields(await fields(page), 'Today'); });
    await run.step(name, 'Program and its weekly schedule', async () => { await lib.openTab(page, 'program'); return checkFields(await fields(page), 'Program'); });
    await run.step(name, 'Edit day, Add exercise and New exercise (sheets)', async () => {
      await page.click('[data-action="edit-day"]'); await page.waitForSelector('#sheet:not([hidden])');
      const a = checkFields(await fields(page), 'Edit day');
      await page.click('#sheet [data-action="pick-ex"]'); await page.waitForSelector('[data-field="pick-search"]');
      const b = checkFields(await fields(page), 'Add exercise');
      await page.click('#sheet [data-action="pick-new-ex"]'); await page.waitForSelector('#ex-form');
      const c = checkFields(await fields(page), 'New exercise');
      await T.closeSheet(page);
      return [a, b, c].join(', ');
    });
    await run.step(name, 'Exercises and Edit exercise', async () => {
      await lib.openTab(page, 'exercises'); const a = checkFields(await fields(page), 'Exercises');
      await page.click('#app [data-action="edit-ex"]'); await page.waitForSelector('#ex-form');
      const b = checkFields(await fields(page), 'Edit exercise'); await T.closeSheet(page);
      return a + ', ' + b;
    });
    await run.step(name, 'History, a workout\'s Edit sets', async () => {
      await lib.openTab(page, 'history'); const a = checkFields(await fields(page), 'History');
      await page.click('#app [data-action="view-workout"]'); await page.waitForSelector('#sheet:not([hidden])');
      await page.click('[data-action="edit-workout"]'); await page.waitForSelector('#sheet input');
      const b = checkFields(await fields(page), 'Edit sets'); await T.closeSheet(page);
      return a + ', ' + b;
    });
    await run.step(name, 'Settings, with the connector address and the cloud sign-in form', async () => {
      await lib.openTab(page, 'settings'); await fakeSync(page, null);
      need(await page.$('#cloud-form [name="email"]') && await page.$('[data-field="conn-url"]'), 'the sign-in form or the connector address is not shown');
      return checkFields(await fields(page), 'Settings');
    });
    errors(name, phone); await phone.close();
  }
  {
    const { phone, page } = await phoneWith(browser, server, active);
    await run.step(name, 'a workout in progress, with its cardio card', async () => {
      need(await page.$('[data-field="cardio"]'), 'no cardio boxes on screen');
      return checkFields(await fields(page), 'workout');
    });
    errors(name + ', workout', phone); await phone.close();
  }
}

async function liveAndTabs(browser, server) {
  const name = 'toast and tabs (look#8)';
  const { phone, page } = await phoneWith(browser, server, small);
  await run.step(name, 'the toast is a polite status, so it is read out', async () => {
    const t = await page.evaluate(() => { const e = document.querySelector('#toast'); return [e.getAttribute('role'), e.getAttribute('aria-live')]; });
    same(t, ['status', 'polite'], 'role and aria-live of #toast');
    await page.evaluate(() => window.__overload.toast('Saved'));
    same(await T.toast(page, /Saved/), 'Saved', 'the toast');
  });
  await run.step(name, 'the shown tab, and only it, is aria-current="page", wherever the tab is changed', async () => {
    const marks = () => page.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.dataset.screen + '=' + t.getAttribute('aria-current')).join(' '));
    same(await marks(), 'today=page program=null exercises=null history=null settings=null', 'on start');
    await lib.openTab(page, 'history');
    same(await marks(), 'today=null program=null exercises=null history=page settings=null', 'after History');
    await page.evaluate(() => { const b = document.createElement('button'); b.dataset.action = 'goto-settings'; b.id = 'test-goto'; document.querySelector('#app').appendChild(b); });
    await page.click('#test-goto');
    same(await marks(), 'today=null program=null exercises=null history=null settings=page', 'after Settings opened from the cloud pill\'s action');
  });
  errors(name, phone); await phone.close();
  await run.step(name, 'the screen for unreadable data marks no tab', async () => {
    const p2 = await lib.newPhone(browser, { timezoneId: small.meta.tz, now: small.meta.now });
    await lib.seedStorage(p2.context, { 'overload.state.v1': '{"v":1,"exercises":[', 'overload.theme': 'dark', 'overload.backup': { since: 1, lastExport: small.meta.now } });
    const pg = await lib.openApp(p2.context, server.url + '/index.html');
    await pg.waitForFunction(() => /could not read/.test(document.querySelector('#app').textContent));
    same(await pg.evaluate(() => [...document.querySelectorAll('.tab[aria-current], .tab.active')].length), 0, 'tabs marked');
    await p2.close();
  });
}

async function focusClear(browser, server) {
  const name = 'focus clear of the bars (look#9)';
  for (const insets of [null, { top: 47, bottom: 34, left: 0, right: 0 }]) {
    const tag = insets ? ' (safe areas 47/34)' : '';
    {
      const { phone, page } = await phoneWith(browser, server, active, { insets });
      await run.step(name, 'a workout in progress, resting' + tag + ': 70 Tabs from the top, none stops under a bar or the rest dock', async () => {
        same(await htmlPadding(page), { top: 'auto', bottom: 'auto', keys: false }, 'the scroll padding before any key (touch is unchanged)');
        // Tick the next set that has its weight: the rest dock shows.
        const tick = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-action="toggle-set"]:not(.on):not([disabled])')].find((x) => { const w = document.querySelector('[data-field="weight"][data-e="' + x.dataset.e + '"][data-s="' + x.dataset.s + '"]'); return w && +w.value > 0; }); return b ? '[data-action="toggle-set"][data-e="' + b.dataset.e + '"][data-s="' + b.dataset.s + '"]' : null; });
        need(tick, 'no set to tick');
        await page.click(tick);
        await page.waitForFunction(() => !document.querySelector('#rest-timer').hidden, null, { timeout: 4000 });
        const walk = await tabWalk(page, 70), under = walk.filter((f) => f.under);
        need(walk.length > 40, 'only ' + walk.length + ' stops');
        need(!under.length, under.length + ' stops under a bar: ' + under.slice(0, 4).map((f) => f.what + ' at ' + f.top + '..' + f.bottom + ' (clear: ' + f.barBottom + '..' + f.barTop + ')').join(', '));
        const pad = await htmlPadding(page);
        need(pad.keys && pad.top !== 'auto', 'no scroll padding while keys are used: ' + JSON.stringify(pad));
        await page.tap('.tab[data-screen="today"]');
        same(await htmlPadding(page), { top: 'auto', bottom: 'auto', keys: false }, 'the scroll padding after a tap');
        return walk.length + ' stops';
      });
      errors(name + tag, phone); await phone.close();
    }
    {
      const { phone, page } = await phoneWith(browser, server, heavy, { insets });
      await run.step(name, 'Settings' + tag + ': 70 Tabs from the top, none stops under a bar', async () => {
        await lib.openTab(page, 'settings');
        const walk = await tabWalk(page, 70), under = walk.filter((f) => f.under);
        need(!under.length, under.length + ' stops under a bar: ' + under.slice(0, 4).map((f) => f.what + ' at ' + f.top + '..' + f.bottom + ' (clear: ' + f.barBottom + '..' + f.barTop + ')').join(', '));
        return walk.length + ' stops';
      });
      errors(name + ', Settings' + tag, phone); await phone.close();
    }
  }
}

// Inside an open sheet: where the focused control is, and how much of it a sticky footer (Save) or a strip stuck at the
// sheet's top covers. Fully visible means inside the panel and the screen, and under neither.
const sheetStop = (page) => page.evaluate(() => {
  const a = document.activeElement, p = document.querySelector('#sheet-panel');
  const what = a ? a.tagName.toLowerCase() + (a.dataset && a.dataset.action ? '[' + a.dataset.action + ']' : '') + ' "' + (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 24) + '"' : 'nothing';
  if (!a || !p.contains(a)) return { out: true, what };
  const r = a.getBoundingClientRect(), pr = p.getBoundingClientRect();
  const edges = [...p.querySelectorAll('.sheet-foot, #food-added')].filter((el) => getComputedStyle(el).position === 'sticky' && !el.contains(a));
  const covered = Math.max(0, ...edges.map((el) => { const e = el.getBoundingClientRect(); return Math.min(r.bottom, e.bottom) - Math.max(r.top, e.top); }));
  const outside = r.top < Math.max(pr.top, 0) - 0.5 || r.bottom > Math.min(pr.bottom, innerHeight) + 0.5;
  return { what, top: Math.round(r.top), bottom: Math.round(r.bottom), covered: Math.round(covered), outside, sticky: edges.length };
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

async function sheetEdgesFocus(browser, server) {
  const name = 'focus clear of a sheet\'s footer (look#12)';
  for (const vp of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    const tag = vp.width + 'x' + vp.height;
    const { phone, page } = await phoneWith(browser, server, heavy);
    await page.setViewportSize(vp);
    await lib.openTab(page, 'exercises');
    for (const [what, opener] of [['Edit exercise', '#app [data-action="edit-ex"]'], ['New exercise', '#app [data-action="new-ex"]']]) {
      await run.step(name, tag + ', ' + what + ' (Save sticks at the bottom) by keys: Tab and Shift+Tab, 30 each, every stop fully visible', async () => {
        await keyOpen(page, opener);
        need(await page.evaluate(() => getComputedStyle(document.querySelector('#sheet .sheet-foot')).position === 'sticky'), 'the sheet has no sticky footer (the test is not testing it)');
        need(await page.evaluate(() => document.querySelector('#sheet-panel').scrollHeight > document.querySelector('#sheet-panel').clientHeight + 40) || vp.height > 600, 'the sheet does not scroll at ' + tag);
        const w = await sheetWalk(page, 30);
        await page.keyboard.press('Escape'); await lib.sleep(60);
        need(w.stops >= 12, 'only ' + w.stops + ' stops');
        need(!w.hidden.length, w.hidden.length + ' stops not fully visible: ' + w.hidden.slice(0, 5).join(' | '));
        return w.stops + ' stops';
      });
    }
    await run.step(name, tag + ': by touch the sheet has no scroll padding (nothing changes for a tap)', async () => {
      await page.tap('#app [data-action="edit-ex"]'); await page.waitForSelector('#sheet:not([hidden]) .sheet-foot');
      const pad = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('#sheet-panel')); return [s.scrollPaddingTop, s.scrollPaddingBottom, document.documentElement.classList.contains('keys')]; });
      same(pad, ['auto', 'auto', false], 'the sheet\'s scroll padding after a tap');
      await page.tap('#sheet .sheet-title [data-action="sheet-close"]');
    });
    errors(name + ', ' + tag, phone); await phone.close();
  }
}

// ---------------------------------------------------------------------------
// Long unbroken texts (look#13)
// ---------------------------------------------------------------------------
// A 60-character word, made from base and numbered (so names stay unique).
const long60 = (base, i) => (base.replace(/[^A-Za-z0-9.@]/g, '') + 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ').slice(0, 57) + String(i).padStart(3, '0');
const LONG_EMAIL = 'alexander.maximilian.longname.familyname.second@examplemail.co';   // 60 characters, no hyphen
// Every text with a word of 24 characters or more: it must stay inside the content box of each card, sheet and screen
// around it, no box may cut it off, and the page must not scroll sideways. On an open sheet only the sheet counts.
// Text only assistive tech reads, and the two lines that end in "…" on purpose (the top bar's title, the rest dock's
// next exercise), are not counted.
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
  [...document.querySelectorAll(sheet ? '#sheet-panel select' : '#app select')].filter((s) => s.getClientRects().length).forEach((s) => { n++; check(s.parentElement, [s.getBoundingClientRect()], '<select> ' + (s.selectedOptions[0] ? s.selectedOptions[0].textContent : '')); });
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
// Overload's own words, 60 characters without a break: exercise, day and template names, the cardio's name.
function longNames(st) {
  st.exercises.forEach((e, i) => { e.name = long60('BulgarianSplitSquatWithDumbbellsPausedAtTheBottom', i); });
  st.program.days.forEach((d, i) => { d.name = long60('UpperBodyPowerAndHypertrophyDayWithExtraArms', i); });
  (st.workouts || []).forEach((w, i) => { if (w.dayName) w.dayName = long60('UpperBodyPowerAndHypertrophyDayWithExtraArms', i % 9); if (w.cardio) w.cardio.name = long60('InclineTreadmillWalkAtTwelvePercentThreePointFive', 0); });
  (st.templates || []).forEach((t, i) => { t.name = long60('MyFavouriteFourDayUpperLowerSplitFromLastWinter', i); });
  st.settings.cardioName = long60('InclineTreadmillWalkAtTwelvePercentThreePointFive', 0);
}
// A tab chosen by the page's own click: a page that scrolls sideways (the fault looked for here) puts the tab bar
// where a pointer cannot reach it.
async function tabTo(page, n) {
  await page.evaluate((x) => { window.scrollTo(0, 0); document.querySelector('.tab[data-screen="' + x + '"]').click(); }, n);
  await page.waitForSelector('.tab[data-screen="' + n + '"].active');
}
async function longTexts(browser, server) {
  const name = 'long unbroken texts (look#13)';
  {
    const { phone, page } = await phoneWith(browser, server, heavy, { mod: longNames, width: 320 });
    await longStep(page, 'Today, with the last workout\'s name');
    await page.$eval('[data-action="toggle-others"]', (e) => e.click()).catch(() => {}); await longStep(page, 'Today, the other days');
    await tabTo(page, 'program'); await longStep(page, 'Program: day names, their exercises, templates', 10);
    await page.$eval('[data-action="edit-day"]', (e) => e.click()); await page.waitForSelector('#sheet:not([hidden])'); await longStep(page, 'Edit day (sheet)', 3);
    await page.$eval('#sheet [data-action="pick-ex"]', (e) => e.click()); await page.waitForSelector('[data-field="pick-search"]'); await longStep(page, 'Add exercise (sheet)', 10);
    await page.$eval('#sheet .sheet-title [data-action="sheet-close"]', (e) => e.click());
    await tabTo(page, 'exercises'); await longStep(page, 'Exercises', 10);
    await page.$eval('#app [data-action="edit-ex"]', (e) => e.click()); await page.waitForSelector('#ex-form'); await longStep(page, 'Edit exercise (sheet)'); await page.$eval('#sheet .sheet-title [data-action="sheet-close"]', (e) => e.click());
    await tabTo(page, 'history'); await longStep(page, 'History: review, workouts', 10);
    const pick = await page.evaluate(() => { const o = [...document.querySelectorAll('select[data-field="chart-ex"] option')].filter((x) => x.value); return o.length ? o[0].value : null; });
    await page.selectOption('select[data-field="chart-ex"]', pick); await longStep(page, 'History with an exercise\'s chart', 10);
    const wid = await page.evaluate(() => window.__overload.state.workouts.filter((w) => w.finishedAt && w.cardio && w.cardio.done).concat(window.__overload.state.workouts.filter((w) => w.finishedAt))[0].id);
    await page.$eval('#app [data-action="view-workout"][data-w="' + wid + '"]', (e) => e.click()); await page.waitForSelector('#sheet:not([hidden])'); await longStep(page, 'a past workout (sheet), with its cardio', 3);
    await page.$eval('#sheet [data-action="edit-workout"]', (e) => e.click()); await page.waitForSelector('#edit-workout-form'); await longStep(page, 'Edit sets (sheet)', 2); await page.$eval('#sheet .sheet-title [data-action="sheet-close"]', (e) => e.click());
    await tabTo(page, 'settings'); await fakeSync(page, LONG_EMAIL);
    await page.evaluate(() => window.__overload.setSyncStatus('synced', 'Synced 12:59 PM')); await longStep(page, 'Settings > Cloud sync, a 60-character email beside "Synced 12:59 PM"');
    await page.evaluate(() => window.__overload.toast('New PR: ' + window.__overload.state.exercises[0].name)); await page.waitForSelector('#toast:not([hidden])');
    await longStep(page, 'the toast, with an exercise\'s name');
    errors(name, phone); await phone.close();
  }
  {
    const { phone, page } = await phoneWith(browser, server, active, { mod: longNames, width: 320 });
    await longStep(page, 'a workout in progress, with its cardio card', 5);
    await page.$eval('[data-action="swap-entry"]', (e) => e.click()); await page.waitForSelector('#sheet:not([hidden])'); await longStep(page, 'Swap exercise (sheet)', 10); await page.$eval('#sheet .sheet-title [data-action="sheet-close"]', (e) => e.click());
    errors(name + ', workout', phone); await phone.close();
  }
}

// ---------------------------------------------------------------------------
// Tabular figures in rows (look#14)
// ---------------------------------------------------------------------------
// The pure numbers on screen (a PR count, "56%"), found as the look reviewer's sweep finds them, that are drawn with
// proportional figures.
const figureFacts = (page, scope) => page.evaluate((sel) => {
  const root = document.querySelector(sel), prop = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const txt = t.nodeValue.trim(), el = t.parentElement;
    if (!/^[+\-−–]?[\d.,:]*\d[\d.,:]*%?$/.test(txt) || el.closest('svg, .sr, [hidden]') || !el.getClientRects().length) continue;
    if (!/tabular-nums/.test(getComputedStyle(el).fontVariantNumeric)) prop.push('"' + txt + '" in ' + el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : '') + ' < ' + el.parentElement.className);
  }
  return { prop };
}, scope);
async function rowFigures(browser, server) {
  const name = 'tabular figures in rows (look#14)';
  const { phone, page } = await phoneWith(browser, server, heavy);
  await lib.openTab(page, 'history');
  await run.step(name, 'History: every number that stands alone (the PR counts, the recovery average) has tabular figures', async () => {
    const f = await figureFacts(page, '#app');
    need(!f.prop.length, f.prop.length + ' with proportional figures: ' + [...new Set(f.prop)].slice(0, 6).join(', '));
    const prs = await page.evaluate(() => [...document.querySelectorAll('#app [data-action="view-workout"] .sub .nowrap')].filter((s) => s.querySelector('.ic') && /^\s*\d+$/.test(s.textContent.replace(/[^\d\s]/g, ''))).length);
    need(prs >= 5, 'only ' + prs + ' PR counts on screen');
    return prs + ' rows with a PR count';
  });
  await run.step(name, 'History: a past workout\'s facts line (date, counts, time, PRs) has tabular figures, and "Nov 11" is as wide as "Nov 20"', async () => {
    const f = await page.evaluate(() => {
      const subs = [...document.querySelectorAll('#app [data-action="view-workout"] .sub')];
      const firsts = subs.map((s) => s.querySelector('.nowrap')).filter(Boolean);
      const width = (re) => { const el = firsts.find((x) => re.test(x.textContent)); if (!el) return null; const r = document.createRange(); r.selectNodeContents(el.firstChild); const t = el.firstChild.nodeValue; const m = re.exec(t); r.setStart(el.firstChild, m.index); r.setEnd(el.firstChild, m.index + m[0].length); return r.getBoundingClientRect().width; };
      return { fonts: [...new Set(subs.map((s) => getComputedStyle(s).fontVariantNumeric))], w11: width(/\b11\b/), w20: width(/\b20\b/), rows: subs.length };
    });
    same(f.fonts, ['tabular-nums'], 'font-variant-numeric of the facts lines');
    need(f.w11 != null && f.w20 != null, 'no "11" and "20" among the dates');
    need(Math.abs(f.w11 - f.w20) < 0.5, '"11" is ' + f.w11.toFixed(1) + ' px, "20" is ' + f.w20.toFixed(1) + ' px');
    return f.rows + ' rows; "11" ' + f.w11.toFixed(1) + ' px, "20" ' + f.w20.toFixed(1) + ' px';
  });
  await run.step(name, 'a past workout (sheet) and Edit sets: the set list (Set 1, Set 2 …, the weights) has tabular figures', async () => {
    const wid = await page.evaluate(() => { const ws = window.__overload.state.workouts.filter((w) => w.finishedAt); return ws.sort((a, b) => b.entries.filter((e) => e.prs && e.prs.length).length - a.entries.filter((e) => e.prs && e.prs.length).length)[0].id; });
    await page.click('#app [data-action="view-workout"][data-w="' + wid + '"]'); await page.waitForSelector('#sheet:not([hidden]) .hist-set');
    const a = await page.evaluate(() => [...new Set([...document.querySelectorAll('#sheet .hist-set > span')].map((s) => getComputedStyle(s).fontVariantNumeric))]);
    const f = await figureFacts(page, '#sheet-panel');
    await page.click('#sheet [data-action="edit-workout"]'); await page.waitForSelector('#edit-workout-form .set-lbl');
    const b = await page.evaluate(() => [...new Set([...document.querySelectorAll('#sheet .set-lbl')].map((s) => getComputedStyle(s).fontVariantNumeric))]);
    await T.closeSheet(page);
    same(a, ['tabular-nums'], 'font-variant-numeric of the set rows (label and numbers)');
    same(b, ['tabular-nums'], 'font-variant-numeric of Edit sets\' "Set 1", "Set 2" …');
    need(!f.prop.length, f.prop.length + ' numbers with proportional figures in the sheet: ' + f.prop.slice(0, 4).join(', '));
  });
  errors(name, phone); await phone.close();
}

async function calendar(browser, server) {
  const name = 'calendar figures (look#10)';
  const { phone, page } = await phoneWith(browser, server, heavy);
  await run.step(name, 'the day numbers have tabular figures: "11" is as wide as "20"', async () => {
    await lib.openTab(page, 'history');
    const c = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.cal-cell')].filter((x) => x.textContent.trim());
      const w = (t) => { const el = cells.find((x) => x.textContent.trim() === t); const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; };
      return { fonts: [...new Set(cells.map((x) => getComputedStyle(x).fontVariantNumeric))], w11: w('11'), w20: w('20') };
    });
    same(c.fonts, ['tabular-nums'], 'font-variant-numeric of the day numbers');
    need(Math.abs(c.w11 - c.w20) < 0.5, '"11" is ' + c.w11.toFixed(1) + ' px, "20" is ' + c.w20.toFixed(1) + ' px');
    return '"11" ' + c.w11.toFixed(1) + ' px, "20" ' + c.w20.toFixed(1) + ' px';
  });
  errors(name, phone); await phone.close();
}

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    await cloudStatus(browser, server);
    await sheets(browser, server);
    await names(browser, server);
    await liveAndTabs(browser, server);
    await focusClear(browser, server);
    await sheetEdgesFocus(browser, server);
    await longTexts(browser, server);
    await rowFigures(browser, server);
    await calendar(browser, server);
  } catch (e) {
    run.say(false, 'train-look', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
    await server.stop();
  }
  run.done();
})();
