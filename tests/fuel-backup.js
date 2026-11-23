#!/usr/bin/env node
/* Fuel 3.0: what protects the data. Export and import, automatic copies, restore, data that cannot be read,
 * storage that is full.
 *
 *   node tests/fuel-backup.js [--port=8424]
 *
 * A Fuel that holds the food of the main v2.8 fixture (with a deleted saved food and meal on record, and the
 * note of the hand-over):
 *   - Export JSON writes fuel-backup-YYYY-MM-DD.json, the saved state itself, with no exercises field;
 *     importing that file into an empty Fuel gives the same stored data;
 *   - an automatic copy is taken at start, and brought up to date when the page is hidden;
 *   - Reset keeps a copy first, and Restore brings everything back as it was;
 *   - stored data that cannot be read (cut off, a newer version, not JSON) shows the "Your data" screen and
 *     is never written over, whatever is tapped; it can be exported exactly; Start fresh leaves it in the
 *     automatic copies;
 *   - Today reminds of a backup after two weeks without one (cloud sync off), and warns from 70% of storage;
 *   - when the phone refuses to store (setItem throws) the banner shows, the app keeps running on what is in
 *     memory, Export still works, and the banner goes when saving works again;
 *   - Reset, Restore and an import wait for their automatic copy: when it cannot be stored (IndexedDB does not
 *     answer, or refuses it) nothing is erased, replaced or added, and a sheet says so and offers Export; a
 *     transaction that never finishes is given up after 5 s the same way, and Reset and an import work again
 *     afterwards in the same session (review finding data#2);
 *   - a lost connection to the copies is opened again by the next copy, in the same session;
 *   - the storage meter and Today's warning count a log that cloud sync brought down (setState);
 *   - Export through the share sheet is noted only when the share went through (a double tap, a cancel, a
 *     share the phone refuses, a share that fails another way: that one offers the download); a sheet that never
 *     answers blocks a second tap for a minute only (review finding code#1);
 *   - Reset's question names everything it erases, the body weight, units and theme included (look#5).
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const fs = require('fs');
const lib = require('./lib');
const F = require('./fuel-common');

const args = F.args();
const PORT = Number(args.port) || 8424;
const run = F.runner('fuel-backup');
const { need, same } = run;
const fx = lib.loadFixture('v28-state');
const TODAY = fx.meta.today;
const COUNTS = fx.facts.counts;

// What Fuel holds some time after the hand-over: the fixture's food, two things deleted in Fuel, the note of the hand-over.
const HELD = F.fuelStateFrom(fx.state, { moved: { from: 'Overload 3.0', at: fx.meta.now - 3 * 864e5, days: COUNTS.foodDays, entries: COUNTS.foodEntries, madeAt: fx.meta.now - 3 * 864e5 - 60000 } });
HELD.deleted = { food: fx.state.deleted.food, foods: { cgone0food01: fx.meta.now - 2 * 864e5 }, meals: { gone0meal001: fx.meta.now - 864e5 } };
const HELD_TEXT = JSON.stringify(HELD);

const newPhone = (browser) => lib.newPhone(browser, { now: fx.meta.now, timezoneId: fx.meta.tz });
async function phoneWith(browser, text) {
  const phone = await newPhone(browser);
  await lib.seedStorage(phone.context, { 'fuel.state.v1': text, 'fuel.theme': 'dark' });
  return phone;
}
async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: dl.suggestedFilename(), path: await dl.path(), text: fs.readFileSync(await dl.path(), 'utf8') };
}

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  const tmp = F.tempDir();
  try {
    // ---------------------------------------------------------------- export, then import into an empty Fuel
    const phone = await phoneWith(browser, HELD_TEXT);
    let page = null, file = null;
    const step = (t, fn) => run.step('export and import', t, fn);
    await step('the app starts on its saved data and writes back the same', async () => {
      page = await F.open(phone, server);
      need((await F.screen(page)) === 'food', 'the screen is ' + (await F.screen(page)));
      same(await F.stored(page), HELD, 'the saved state after start');
      need((await F.storedText(page)) === HELD_TEXT, 'the saved text changed at start (same data, other bytes)');
      return HELD_TEXT.length.toLocaleString() + ' characters, byte for byte';
    });
    await step('Export JSON holds the saved state, and no exercises field', async () => {
      await lib.openTab(page, 'settings');
      const dl = await download(page, () => page.click('.backup-btns [data-action="export"]'));
      need(/^fuel-backup-2026-11-21\.json$/.test(dl.name), 'the file is called ' + dl.name);
      need(JSON.stringify(JSON.parse(dl.text)) === HELD_TEXT, 'the file differs from the stored data');
      const o = JSON.parse(dl.text);
      need(o.v === 1 && o.app === 'fuel' && !('exercises' in o) && !/"exercises"/.test(dl.text), 'v, app or exercises are not as they must be');
      need(/Last export: today/.test(await F.text(page, '#last-export')), 'Settings does not say the export was made');
      file = tmp.file(dl.name, dl.text);
      return dl.name + ', ' + dl.text.length.toLocaleString() + ' characters';
    });
    await step('importing that file into an empty Fuel gives the same stored data', async () => {
      const other = await newPhone(browser);
      try {
        const p2 = await F.open(other, server);
        need((await F.screen(p2)) === 'welcome', 'the other phone is not at Welcome');
        await F.chooseFile(p2, '[data-action="fuel-file"]', file);
        await F.toast(p2, /Brought in/);
        same(await F.stored(p2), HELD, 'the stored data on the other phone');
        const q = p2.dialogs[0] || '';
        need(/From: Fuel backup/.test(q) && q.includes('It holds ' + COUNTS.foodDays + ' days, 1,576 entries'), 'the question reads ' + q.replace(/\n/g, ' | '));
        const day = await F.readDay(p2);
        need(day.kcalLine === fx.facts.foodDays[0].kcalLine, 'Today reads ' + day.kcalLine);
        F.assertClean(other, 'import');
        return 'equal, key by key' + ((await F.storedText(p2)) === HELD_TEXT ? ', and byte for byte' : '');
      } finally { await other.close(); }
    });
    await step('Import JSON in Settings takes the same file and finds nothing new', async () => {
      const before = await F.storedText(page), asked = page.dialogs.length;
      await F.chooseFile(page, '.backup-btns [data-action="import"]', file);
      await page.waitForSelector('#fuel-import-msg');
      need(/^Nothing new/.test(await F.text(page, '#fuel-import-msg')), 'the sheet says ' + await F.text(page, '#fuel-import-msg'));
      need((await F.storedText(page)) === before && page.dialogs.length === asked, 'something changed');
      await F.closeSheet(page);
      return await F.text(page, '#last-export');
    });

    // ---------------------------------------------------------------- automatic copies
    const auto = (t, fn) => run.step('automatic copies', t, fn);
    const dayId = 'day-' + TODAY;
    await auto('a copy is taken at start', async () => {
      const c = await F.copy(page, dayId);
      need(c, 'no copy ' + dayId + '; there are: ' + (await F.copies(page)).map((m) => m.id).join(', '));
      need(c.text === HELD_TEXT, 'the copy differs from the stored data');
      need(c.kind === 'day' && c.days === COUNTS.foodDays && c.entries === COUNTS.foodEntries && c.first === '2026-08-02' && c.last === TODAY, 'its summary is ' + JSON.stringify({ kind: c.kind, days: c.days, entries: c.entries, first: c.first, last: c.last }));
      return c.days + ' food days, ' + c.entries + ' entries, ' + c.first + ' to ' + c.last;
    });
    await auto('Settings lists it, in Fuel\'s words', async () => {
      await page.waitForFunction(() => { const c = document.querySelector('#safety-copies'); return c && !/Looking for copies/.test(c.textContent); }, null, { timeout: 5000 });
      const row = await F.text(page, '#safety-copies .copy-row');
      need(/Sat, Nov 21/.test(row) && /110 food days/.test(row) && /1,576 entries/.test(row) && /Restore/.test(row), 'the row reads ' + row);
      need(!/workout/i.test(await F.text(page, '#app')), 'Settings talks about workouts');
      return row;
    });
    await auto('the copy is brought up to date when the page is hidden', async () => {
      await lib.openTab(page, 'food');
      await F.quickAdd(page, 2, 'Evening soup', 210, 9, 30, 6);
      const now = await F.storedText(page);
      need(/Evening soup/.test(now), 'the food was not saved');
      need(!/Evening soup/.test((await F.copy(page, dayId)).text), 'the copy already holds it before the page was hidden');
      await F.hide(page);
      const c = await F.copy(page, dayId, (x) => /Evening soup/.test(x.text));
      need(c && c.text === now, 'the copy was not refreshed with the food logged since');
      need(c.entries === COUNTS.foodEntries + 1, 'its summary counts ' + c.entries + ' entries');
      await F.show(page);
      return 'Evening soup is in ' + dayId;
    });

    // ---------------------------------------------------------------- reset and restore
    const back = (t, fn) => run.step('reset and restore', t, fn);
    let before = null;
    await back('Reset asks twice in Fuel\'s words, keeps a copy first, and empties the diary', async () => {
      before = await F.stored(page);
      await lib.openTab(page, 'settings');
      const asked = page.dialogs.length;
      await page.click('[data-action="reset"]');
      await F.toast(page, /Reset/);
      const qs = page.dialogs.slice(asked);
      // It names everything it erases: the body weight, units and theme too (review finding look#5).
      need(qs.length === 2 && qs[0].startsWith('confirm: Erase the food diary, saved foods, saved meals, targets and settings in Fuel on this phone, body weight, units and theme included?\n\n')
        && /110 food days/.test(qs[0]) && /Really erase everything in Fuel/.test(qs[1]), 'the questions: ' + qs.join(' / '));
      need(!qs.some((q) => /workout|exercise|program/i.test(q)), 'a question talks about training: ' + qs.join(' / '));
      const st = await F.stored(page);
      need(Object.keys(st.diary).length === 0 && Object.keys(st.food.foods).length === 0 && st.food.targets.kcal === null && st.moved === null, 'the state after Reset: ' + JSON.stringify(st).slice(0, 200));
      need(before.bodyweight.length === 1 && !st.bodyweight.length && st.settings.units === 'lb' && st.settings.theme === 'system', 'the body weight, units or theme after Reset: ' + JSON.stringify([before.bodyweight, st.bodyweight, st.settings]));
      const c = await F.copy(page, 'before-reset');
      same(JSON.parse(c.text), before, 'the copy "Before reset"');
      return qs[0].split('\n')[0].replace('confirm: ', '');
    });
    await back('Restore of that copy brings everything back', async () => {
      await page.waitForSelector('#safety-copies [data-action="restore-copy"][data-id="before-reset"]');
      const asked = page.dialogs.length;
      await page.click('#safety-copies [data-action="restore-copy"][data-id="before-reset"]');
      await F.toast(page, /Copy restored/);
      const q = page.dialogs[asked];
      need(/Replace the food log on this phone with the copy "Before reset"/.test(q) && /The copy: 110 food days \(Aug 2 – Nov 21\), 1,577 entries\./.test(q.replace(/ /g, ' ')) && /This phone now: no food days\./.test(q), 'the question reads ' + q.replace(/\n/g, ' | '));
      same(await F.stored(page), before, 'the stored data after Restore');
      const empty = await F.copy(page, 'before-restore');
      need(empty && Object.keys(JSON.parse(empty.text).diary).length === 0, 'no copy of what was there before the restore');
      await lib.openTab(page, 'food');
      const day = await F.readDay(page);
      need(day.entries === 11, 'Today shows ' + day.entries + ' entries');
      F.assertClean(phone, 'reset and restore');
      return day.kcalLine + ', ' + day.entries + ' entries';
    });
    await phone.close();

    // ---------------------------------------------------------------- data that cannot be read
    for (const [what, text] of [
      ['cut off', HELD_TEXT.slice(0, 150000)],
      ['of a newer version', JSON.stringify(Object.assign({}, HELD, { v: 2 }))],
      ['not JSON at all', 'OVERLOAD-FOOD:1:H4sIAAAA'],
      ['a list', '[1,2,3]']
    ]) {
      const label = 'stored data that is ' + what, bad = (t, fn) => run.step(label, t, fn);
      const p = await phoneWith(browser, text);
      let pg = null;
      await bad('shows "Your data" and never writes over it', async () => {
        // Cloud sync's note is on the phone too (set once, before the app's scripts; not again on a reload).
        await p.context.addInitScript(() => { try { if (!sessionStorage.getItem('t')) { sessionStorage.setItem('t', '1'); localStorage.setItem('fuel.sync.v1', '{"uid":"u1","core":"h1","days":{}}'); } } catch (e) { /* no storage */ } });
        pg = await F.open(p, server);
        const t = await F.text(pg, '#app');
        need(/Fuel could not read the data saved on this phone/.test(t) && /Nothing has been changed or deleted/.test(t) && /Export the unreadable copy/.test(t) && /Start fresh/.test(t), 'the screen reads ' + t.slice(0, 200));
        need((await F.screen(pg)) === 'unreadable' && (await pg.evaluate(() => window.__overload.unreadable)) === true, 'screen or unreadable flag wrong');
        const same0 = async (when) => need((await F.storedText(pg)) === text, 'the stored text changed ' + when);
        await same0('at start');
        need((await lib.readStorageText(pg, 'fuel.state.v1.bak')) === text, 'no second copy under fuel.state.v1.bak');
        need((await lib.readStorage(pg, 'fuel.sync.v1')) === null, 'cloud sync\'s note was kept: a later sign-in could delete from the cloud');
        // whatever is tapped or called
        for (const tab of ['food', 'trends', 'settings']) { await pg.click('.tab[data-screen="' + tab + '"]'); need(/could not read/.test(await F.text(pg, '#app')), 'the tab ' + tab + ' left the screen'); }
        const r = await pg.evaluate(() => { const o = window.__overload; const saved = o.save(); o.setState({ v: 1, app: 'fuel', diary: {} }); o.render(); return saved; });
        need(r === false, 'save() returned ' + r);
        await F.hide(pg); await F.show(pg);
        await same0('after taps, save, setState and going to the background');
        const c = await F.copy(pg, 'before-unreadable');
        need(c && c.text === text && c.kind === 'unreadable', 'the automatic copy of the unreadable text is ' + (c ? 'not the same text' : 'missing'));
        return 'the stored text is untouched (' + text.length.toLocaleString() + ' characters)';
      });
      await bad('Export the unreadable copy gives the exact text', async () => {
        const dl = await download(pg, () => pg.click('[data-action="unreadable-export"]'));
        need(dl.text === text && /^fuel-unreadable-2026-11-21\.json$/.test(dl.name), 'the file ' + dl.name + ' differs from the stored text');
        return dl.name;
      });
      if (what === 'cut off') await bad('Try again reloads and shows the same; Start fresh begins an empty diary and keeps the old text in the copies', async () => {
        await Promise.all([pg.waitForEvent('load'), pg.click('[data-action="unreadable-retry"]')]);
        await pg.waitForFunction(() => !!window.__overload && !!window.__overloadFood && /could not read/.test(document.querySelector('#app').textContent));
        need((await F.storedText(pg)) === text, 'the stored text changed over Try again');
        const asked = pg.dialogs.length;
        await pg.click('[data-action="unreadable-fresh"]');
        await F.toast(pg, /Started fresh/);
        need(/Start fresh with an empty food diary\?/.test(pg.dialogs[asked]) && /stays in Settings > Automatic copies/.test(pg.dialogs[asked]), 'the question reads ' + pg.dialogs[asked]);
        const st = await F.stored(pg);
        need(st.v === 1 && st.app === 'fuel' && Object.keys(st.diary).length === 0 && (await F.screen(pg)) === 'food', 'not an empty diary after Start fresh');
        need((await F.copy(pg, 'before-unreadable')).text === text, 'the unreadable text is gone from the copies');
        await pg.waitForFunction(() => localStorage.getItem('fuel.state.v1.bak') === null, null, { timeout: 5000 });
        await F.quickAdd(pg, 0, 'Toast', 120, 4, 20, 2);
        need((await F.stored(pg)).diary[TODAY].length === 1, 'saving does not work after Start fresh');
        await lib.openTab(pg, 'settings');
        await pg.waitForSelector('#safety-copies [data-action="export-copy"][data-id="before-unreadable"]');
        return 'empty diary; "Unreadable data" stays listed with Export';
      });
      await bad('no error', async () => { F.assertClean(p, label); });
      await p.close();
    }

    // ---------------------------------------------------------------- the reminders at the top of Today
    {
      const note = (t, fn) => run.step('reminders on Today', t, fn);
      const DAY = 864e5, now = fx.meta.now;
      const withInfo = async (info, extra) => { const p = await newPhone(browser); await lib.seedStorage(p.context, Object.assign({ 'fuel.state.v1': HELD_TEXT, 'fuel.theme': 'dark', 'fuel.backup': info }, extra || {})); return p; };
      const notice = (pg) => F.text(pg, '#today-notices .notice');
      let p = await withInfo({ since: now - 20 * DAY });
      await note('no export for two weeks and cloud sync off: Today says so, and the reminder can be put off', async () => {
        const pg = await F.open(p, server);
        const t = await notice(pg);
        need(/No backup yet, and cloud sync is off\./.test(t || ''), 'Today says ' + t);
        need((await F.readDay(pg)).entries === 10, 'the diary under the reminder is not whole');
        await pg.click('#today-notices [data-action="export-nag-off"]');
        need((await notice(pg)) === null && (await lib.readStorage(pg, 'fuel.backup')).nagOff > 0, 'the reminder did not go, or was not noted');
        await F.reload(pg);
        need((await notice(pg)) === null, 'the reminder came back after a reload');
        return t;
      });
      await p.close();
      // Before the sync module has loaded (here it never does: its files are not reachable), cloud sync's note
      // decides: one that names an account counts as on, one marked signed out does not.
      for (const [out, want] of [[false, null], [true, /No backup yet, and cloud sync is off\./]]) {
        p = await withInfo({ since: now - 20 * DAY }, { 'fuel.sync.v1': JSON.stringify(Object.assign({ uid: 'U1', email: 'owner@example.com', core: null, days: {} }, out ? { signedOut: true } : {})) });
        await note('no export for two weeks, the sync module not loaded, its note ' + (out ? 'marked signed out: the reminder shows' : 'naming an account: no reminder'), async () => {
          const pg = await F.open(p, server);
          await lib.sleep(300);
          need(await pg.evaluate(() => window.__overloadSync === undefined), 'a sync module is in the page');
          const t = await notice(pg);
          need(want ? want.test(t || '') : t === null, 'Today says ' + t);
          return t || 'no reminder';
        });
        await p.close();
      }
      p = await withInfo({ since: now - 60 * DAY, lastExport: now - 30 * DAY });
      await note('an old export: Today says how old; Export from there ends the reminder', async () => {
        const pg = await F.open(p, server);
        const t = await notice(pg);
        need(/Last backup 30 days ago, and cloud sync is off\./.test(t || ''), 'Today says ' + t);
        const dl = await download(pg, () => pg.click('#today-notices [data-action="export"]'));
        need(JSON.stringify(JSON.parse(dl.text)) === HELD_TEXT, 'the export differs from the stored data');
        await pg.waitForFunction(() => !document.querySelector('#today-notices .notice'));
        return t;
      });
      await p.close();
      p = await withInfo({ since: now, lastExport: now }, { 'other.site.data': 'x'.repeat(1700000) });
      await note('storage 70% full: Today warns, Settings shows how full', async () => {
        const pg = await F.open(p, server);
        const t = await notice(pg);
        need(/Storage is 8\d% full\. Export a backup now so nothing is lost\./.test(t || ''), 'Today says ' + t);
        await lib.openTab(pg, 'settings');
        const meter = await pg.evaluate(() => [document.querySelector('.vol-n').textContent, document.querySelector('.vol-n').className, document.querySelector('.store-bar .vol-fill').style.width]);
        need(/^8\d%$/.test(meter[0]) && /high/.test(meter[1]) && meter[2] === meter[0], 'the meter reads ' + meter.join(', '));
        F.assertClean(p, 'reminders');
        return t;
      });
      await p.close();
      p = await withInfo({ since: now - 5 * DAY });
      await note('otherwise Today has no reminder', async () => {
        const pg = await F.open(p, server);
        need((await notice(pg)) === null && (await F.count(pg, '#today-notices')) === 1, 'Today says ' + await notice(pg));
        F.assertClean(p, 'reminders');
      });
      await p.close();
    }

    // ---------------------------------------------------------------- storage that is full
    {
      const full = (t, fn) => run.step('storage full', t, fn);
      const p = await phoneWith(browser, HELD_TEXT);
      let pg = null;
      await full('a save that fails shows the banner and says so; the app keeps running', async () => {
        pg = await F.open(p, server);
        // From now on the phone refuses to store the diary (other keys still work).
        await pg.evaluate(() => {
          const real = Storage.prototype.setItem;
          window.__full = true;
          Storage.prototype.setItem = function (k, v) { if (window.__full && k === 'fuel.state.v1') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return real.call(this, k, v); };
        });
        await F.quickAdd(pg, 2, 'Late soup', 210, 9, 30, 6);
        await F.toast(pg, /Not saved on this phone: the app's storage is full/);
        need(await pg.isVisible('#save-warning'), 'no banner');
        const banner = await F.text(pg, '#save-warning');
        need(/The app's storage is full/.test(banner) && /not saved on this phone/.test(banner) && /Export backup/.test(banner), 'the banner reads ' + banner);
        need((await pg.evaluate(() => window.__overload.saveFailed)) === true, 'saveFailed is not set');
        need((await F.storedText(pg)) === HELD_TEXT, 'the stored text is not what it was before the failed save');
        const day = await F.readDay(pg);
        need((await F.screen(pg)) === 'food' && day.entries === 11 && day.meals[2].foods === 1, 'the diary does not show the unsaved food: ' + JSON.stringify(day.meals));
        return banner.slice(0, 80);
      });
      await full('every screen still works, and Export from the banner holds the unsaved food', async () => {
        await lib.openTab(pg, 'trends'); need(await F.count(pg, '.trend-day') === 14, 'Trends did not draw');
        await lib.openTab(pg, 'settings'); need(/Storage used/.test(await F.text(pg, '#app')), 'Settings did not draw');
        const dl = await download(pg, () => pg.click('#save-warning [data-action="export"]'));
        need(/Late soup/.test(dl.text) && JSON.parse(dl.text).diary[TODAY].length === 11, 'the export does not hold the unsaved food');
        await F.hide(pg);
        const c = await F.copy(pg, 'day-' + TODAY, (x) => /Late soup/.test(x.text));
        need(c && /Late soup/.test(c.text), 'the automatic copy (kept outside that storage) does not hold the unsaved food');
        await F.show(pg);
        return 'export ' + dl.name + ' and the automatic copy both hold it';
      });
      await full('when saving works again the banner goes', async () => {
        await pg.evaluate(() => { window.__full = false; });
        await lib.openTab(pg, 'food');
        await F.quickAdd(pg, 3, 'Apple', 95, 0, 25, 0);
        need(!(await pg.isVisible('#save-warning')) && (await pg.evaluate(() => window.__overload.saveFailed)) === false, 'the banner stayed');
        const st = await F.stored(pg);
        need(st.diary[TODAY].length === 12 && st.diary[TODAY].some((e) => e.name === 'Late soup'), 'the food from the failed save was not saved with the next one');
        F.assertClean(p, 'storage full');
        return '12 entries saved';
      });
      await p.close();
    }

    // ---------------------------------------------------------------- an automatic copy that cannot be stored (F1)
    // Reset, Restore and an import each promise a copy of what is here first, and it is the only way back. When
    // IndexedDB does not answer (Safari can leave the open request unanswered; backup.js gives up after 2 s),
    // or refuses the copy, nothing may be erased, replaced or added: the app says so and offers Export.
    {
      const nocopy = (t, fn) => run.step('a copy that cannot be stored', t, fn);
      const p = await phoneWith(browser, HELD_TEXT);
      await p.context.addInitScript(() => {
        const real = IDBFactory.prototype.open;
        window.__idbStuck = true;   // an open request that is never answered, until the test says otherwise
        IDBFactory.prototype.open = function () { if (window.__idbStuck) return { set onsuccess(f) {}, set onerror(f) {}, set onupgradeneeded(f) {}, set onblocked(f) {} }; return real.apply(this, arguments); };
      });
      let pg = null;
      const sheetMsg = () => F.text(pg, '#sheet:not([hidden]) .banner.warn');
      await nocopy('Reset while IndexedDB does not answer: nothing is erased; a sheet says why and offers Export', async () => {
        pg = await F.open(p, server);
        await lib.openTab(pg, 'settings');
        const asked = pg.dialogs.length;
        await pg.click('[data-action="reset"]');
        await pg.waitForSelector('#sheet:not([hidden]) .banner.warn', { timeout: 8000 });
        const qs = pg.dialogs.slice(asked), msg = await sheetMsg();
        need(qs.length === 2 && /The latest copy stays in Settings > Automatic copies/.test(qs[1]), 'the questions: ' + qs.join(' / '));
        need(msg === 'The automatic copy could not be stored, so nothing was erased. Export a backup first, then try again.', 'the sheet says: ' + msg);
        await lib.sleep(300);
        need((await F.storedText(pg)) === HELD_TEXT, 'the stored data changed');
        same(await F.live(pg), HELD, 'the data in memory');
        need(!/Reset/.test((await pg.evaluate(() => document.querySelector('#toast').textContent)) || ''), 'the toast says it was reset');
        const dl = await download(pg, () => pg.click('#sheet [data-action="export"]'));
        need(JSON.stringify(JSON.parse(dl.text)) === HELD_TEXT, 'the export from the sheet is not the stored data');
        need(/Last export: today/.test(await F.text(pg, '#last-export')), 'the export was not noted');
        await F.closeSheet(pg);
        return msg;
      });
      await nocopy('once IndexedDB answers again, Reset keeps its copy and erases', async () => {
        await pg.evaluate(() => { window.__idbStuck = false; });
        await pg.click('[data-action="reset"]');
        await F.toast(pg, /Reset: the food diary is empty/);
        const c = await F.copy(pg, 'before-reset');
        need(c && c.text === HELD_TEXT, 'the copy "Before reset" is ' + (c ? 'not the data that was here' : 'missing'));
        need(Object.keys((await F.stored(pg)).diary).length === 0, 'the diary was not emptied');
        return 'before-reset holds ' + c.days + ' food days';
      });
      await p.close();

      // The copy is refused (it never resolves true) while IndexedDB itself answers: Restore and import.
      const q = await phoneWith(browser, HELD_TEXT);
      const refuse = (page) => page.evaluate(() => { window.__overloadBackup.take = () => Promise.resolve(false); });
      await nocopy('Restore while the copy of what is here cannot be stored: nothing is replaced', async () => {
        pg = await F.open(q, server);
        need(await F.copy(pg, 'day-' + TODAY), 'no copy of today to restore');
        await F.quickAdd(pg, 1, 'Logged after the copy', 333, 9, 9, 9);   // so the copy differs from what is here
        const now = await F.storedText(pg);
        await refuse(pg);
        await lib.openTab(pg, 'settings');
        await pg.waitForSelector('#safety-copies [data-action="restore-copy"][data-id="day-' + TODAY + '"]');
        await pg.click('#safety-copies [data-action="restore-copy"][data-id="day-' + TODAY + '"]');
        await pg.waitForSelector('#sheet:not([hidden]) .banner.warn', { timeout: 8000 });
        const msg = await sheetMsg();
        need(msg === 'The automatic copy could not be stored, so nothing was replaced. Export a backup first, then try again.', 'the sheet says: ' + msg);
        need(await F.count(pg, '#sheet [data-action="export"]') === 1, 'the sheet offers no Export');
        await lib.sleep(300);
        need((await F.storedText(pg)) === now && /Logged after the copy/.test(now), 'the stored data was replaced');
        await F.closeSheet(pg);
        return msg;
      });
      await nocopy('an import while the copy cannot be stored: nothing is added; the import sheet says why and offers Export', async () => {
        const more = JSON.parse(await F.storedText(pg));
        more.diary[TODAY] = more.diary[TODAY].concat([{ id: 'fueltestnew1', food: null, meal: 3, qty: null, unit: null, amt: '', name: 'Only in the file', brand: '', kcal: 50, p: 1, c: 1, f: 1, at: fx.meta.now }]);
        const file = tmp.file('fuel-backup-more.json', JSON.stringify(more));
        const now = await F.storedText(pg), asked = pg.dialogs.length;
        await F.chooseFile(pg, '.backup-btns [data-action="import"]', file);
        await pg.waitForSelector('#sheet:not([hidden]) #fuel-import-msg', { timeout: 8000 });
        need(/A copy of what Fuel holds now is kept first/.test(pg.dialogs[asked] || ''), 'the question did not promise the copy: ' + pg.dialogs[asked]);
        const msg = await F.text(pg, '#fuel-import-msg');
        need(msg === 'The automatic copy could not be stored, so nothing was brought in. Export a backup first, then try again.', 'the sheet says: ' + msg);
        need(await F.count(pg, '#sheet [data-action="export"]') === 1, 'the sheet offers no Export');
        await lib.sleep(300);
        need((await F.storedText(pg)) === now && !/Only in the file/.test(await F.storedText(pg)), 'something was added');
        await F.closeSheet(pg);
        return msg;
      });
      await nocopy('cloud sync brings something while the copy is stored: Reset erases nothing, and says so', async () => {
        // A stand-in for setState arriving from cloud sync in the moment between the question and the copy.
        await pg.evaluate((day) => {
          window.__overloadBackup.take = (kind) => {
            if (kind === 'reset') { const O = window.__overload, s = JSON.parse(JSON.stringify(O.state)); s.diary[day] = s.diary[day].concat([{ id: 'fromcloud1', food: null, meal: 0, qty: null, unit: null, amt: '', name: 'From the other phone', brand: '', kcal: 10, p: 0, c: 0, f: 0, at: Date.now() }]); O.setState(s); }
            return Promise.resolve(true);
          };
        }, TODAY);
        await lib.openTab(pg, 'settings');
        await pg.click('[data-action="reset"]');
        const t = await F.toast(pg, /changed just now/);
        need(t === 'The food log changed just now. Nothing was erased.', 'the toast says: ' + t);
        const st = await F.stored(pg);
        need(Object.keys(st.diary).length === COUNTS.foodDays && st.diary[TODAY].some((e) => e.id === 'fromcloud1'), 'the data was erased, or what arrived is not there');
        F.assertClean(q, 'a copy that cannot be stored');
        return t;
      });
      await q.close();

      // A transaction of the copy store that never finishes (review finding data#2): the open is answered, but the
      // transaction neither completes nor fails. backup.js gives up after 5 s and lets the connection go: nothing is
      // erased or added, the sheet says why, and Reset and an import work again in the same session.
      const r = await phoneWith(browser, HELD_TEXT);
      await r.context.addInitScript(() => {
        const real = IDBDatabase.prototype.transaction;
        window.__txHang = false;
        IDBDatabase.prototype.transaction = function () {
          if (!window.__txHang) return real.apply(this, arguments);
          const req = () => ({}), store = { put: req, get: req, getAll: req, delete: req };
          return { objectStore: () => store, abort() {} };   // never calls oncomplete, onerror or onabort
        };
      });
      const hang = (on) => pg.evaluate((v) => { window.__txHang = v; }, on);
      await nocopy('Reset while a transaction of the copy store never finishes: nothing is erased; the sheet says why', async () => {
        pg = await F.open(r, server);
        need(await F.copy(pg, 'day-' + TODAY), 'no copy at start');
        await lib.openTab(pg, 'settings');
        await hang(true);
        const asked = pg.dialogs.length, t0 = Date.now();
        await pg.click('[data-action="reset"]');
        await pg.waitForSelector('#sheet:not([hidden]) .banner.warn', { timeout: 12000 });
        const msg = await sheetMsg(), took = (Date.now() - t0) / 1000;
        need(pg.dialogs.length - asked === 2, 'the questions: ' + pg.dialogs.slice(asked).join(' / '));
        need(msg === 'The automatic copy could not be stored, so nothing was erased. Export a backup first, then try again.', 'the sheet says: ' + msg);
        need((await F.storedText(pg)) === HELD_TEXT, 'the stored data changed');
        await F.closeSheet(pg);
        return msg + ' (after ' + took.toFixed(1) + ' s)';
      });
      await nocopy('once the store answers again, Reset asks again, keeps its copy and erases', async () => {
        await hang(false);
        const asked = pg.dialogs.length;
        await pg.click('[data-action="reset"]');
        await F.toast(pg, /Reset: the food diary is empty/);
        need(pg.dialogs.length - asked === 2, 'questions asked: ' + (pg.dialogs.length - asked));
        const c = await F.copy(pg, 'before-reset');
        need(c && c.text === HELD_TEXT, 'the copy "Before reset" is ' + (c ? 'not the data that was here' : 'missing'));
        return 'before-reset holds ' + c.days + ' food days';
      });
      await nocopy('an import while a transaction never finishes: nothing is added, the sheet says why; with the store back, the same file comes in', async () => {
        const file = tmp.file('fuel-backup-held.json', HELD_TEXT);
        const now = await F.storedText(pg);
        await hang(true);
        await F.chooseFile(pg, '.backup-btns [data-action="import"]', file);
        await pg.waitForSelector('#sheet:not([hidden]) #fuel-import-msg', { timeout: 12000 });
        const msg = await F.text(pg, '#fuel-import-msg');
        need(msg === 'The automatic copy could not be stored, so nothing was brought in. Export a backup first, then try again.', 'the sheet says: ' + msg);
        need((await F.storedText(pg)) === now, 'something was added');
        await F.closeSheet(pg);
        await hang(false);
        await F.chooseFile(pg, '.backup-btns [data-action="import"]', file);
        const t = await F.toast(pg, /Brought in/);
        need(Object.keys((await F.stored(pg)).diary).length === COUNTS.foodDays, 'the file did not come in');
        F.assertClean(r, 'a transaction that never finishes');
        return msg + ' | then: ' + t;
      });
      await r.close();
    }

    // ---------------------------------------------------------------- the connection to the copies is lost (U6)
    // An iPhone drops the IndexedDB connection of an app that comes back from the background. The next copy must
    // open it again instead of failing for the rest of the session. Here the open connection is closed from outside.
    {
      const lost = (t, fn) => run.step('a lost connection to the copies', t, fn);
      const p = await phoneWith(browser, HELD_TEXT);
      await p.context.addInitScript(() => {
        const real = IDBFactory.prototype.open;
        window.__dbs = [];
        IDBFactory.prototype.open = function () { const r = real.apply(this, arguments); r.addEventListener('success', () => window.__dbs.push(r.result)); return r; };
      });
      let pg = null;
      const cut = () => pg.evaluate(() => { const n = window.__dbs.length; window.__dbs.forEach((d) => d.close()); return n; });
      await lost('after the connection is lost, the next copy is stored and the list reads', async () => {
        pg = await F.open(p, server);
        need(await F.copy(pg, 'day-' + TODAY), 'no copy at start');
        const n = await cut();
        const took = await pg.evaluate(() => window.__overloadBackup.take('import', '{"v":1,"app":"fuel","diary":{}}'));
        need(took === true, 'take() after the connection was lost resolved ' + took);
        const ids = (await F.copies(pg)).map((m) => m.id).sort();
        same(ids, ['before-import', 'day-' + TODAY], 'the copies listed');
        await cut();
        await lib.openTab(pg, 'settings');
        await pg.waitForFunction(() => { const c = document.querySelector('#safety-copies'); return c && !/Looking for copies/.test(c.textContent); }, null, { timeout: 5000 });
        need(await F.count(pg, '#safety-copies .copy-row') === 2, 'Settings lists: ' + await F.text(pg, '#safety-copies'));
        return n + ' connection(s) closed; copy stored, ' + ids.length + ' listed';
      });
      await lost('Reset after the connection is lost keeps its copy', async () => {
        await cut();
        await pg.click('[data-action="reset"]');
        await F.toast(pg, /Reset: the food diary is empty/);
        const c = await F.copy(pg, 'before-reset');
        need(c && c.text === HELD_TEXT, 'the copy "Before reset" is ' + (c ? 'not the data' : 'missing'));
        F.assertClean(p, 'a lost connection');
        return 'before-reset: ' + c.days + ' food days';
      });
      await p.close();
    }

    // ---------------------------------------------------------------- the storage meter after cloud sync (F4)
    // Cloud sync brings the log down through setState. The meter and Today's warning count the app's data from
    // what was last stored, so setState must note that, as save() does.
    {
      const meter = (t, fn) => run.step('storage meter after cloud sync', t, fn);
      const p = await newPhone(browser);
      await meter('a big log arriving through setState: Settings and Today count it', async () => {
        const pg = await F.open(p, server);
        await pg.click('[data-action="fuel-fresh"]'); await pg.waitForSelector('.f-meal');
        // the account holds about two years: the fixture's 110 days repeated
        const big = F.fuelStateFrom(fx.state), days = Object.keys(big.diary);
        for (let k = 1; k <= 6; k++) days.forEach((d) => { const [y, m, dd] = d.split('-').map(Number); const nd = new Date(Date.UTC(y, m - 1, dd - 110 * k)).toISOString().slice(0, 10); big.diary[nd] = big.diary[d].map((e) => Object.assign({}, e, { id: e.id + 'k' + k })); });
        await pg.evaluate((s) => window.__overload.setState(s), big);
        await lib.sleep(300);
        const real = await pg.evaluate(() => { let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += k.length + localStorage.getItem(k).length; } return n; });
        const pct = Math.round(real / 2500000 * 100);
        need(pct >= 70, 'this check needs a log over 70% of the storage, it is ' + pct + '%');
        const notice = await F.text(pg, '#today-notices .notice');
        need(new RegExp('Storage is ' + pct + '% full').test(notice || ''), 'Today says: ' + notice);
        await lib.openTab(pg, 'settings');
        const shown = await pg.evaluate(() => document.querySelector('.vol-n').textContent);
        need(shown === pct + '%', 'Settings shows ' + shown + ', the storage is ' + pct + '% used');
        F.assertClean(p, 'storage meter');
        return real.toLocaleString() + ' characters: ' + shown + ' in Settings, and Today warns';
      });
      await p.close();
    }

    // ---------------------------------------------------------------- the share sheet (Export JSON)
    // Stand-ins for navigator.canShare and navigator.share that follow the Web Share standard: share() stays
    // pending while its sheet is open, a second call meanwhile is rejected with InvalidStateError, a cancel
    // rejects with AbortError, and a call that no tap started is rejected with NotAllowedError. Only a share that
    // went through counts as an export (same fault as U5/T1 in the training app).
    {
      const share = (t, fn) => run.step('export through the share sheet', t, fn);
      const p = await phoneWith(browser, HELD_TEXT);
      await p.context.addInitScript(() => {
        let open = null;
        window.__shares = []; window.__refuse = false; window.__hang = false; window.__fails = false;
        navigator.canShare = () => true;
        navigator.share = (data) => {
          if (window.__refuse) { window.__shares.push('refused: NotAllowedError'); return Promise.reject(new DOMException('Not allowed', 'NotAllowedError')); }
          // A sheet that never answers (review finding code#1), and one that fails in a way the standard does not name.
          if (window.__hang) { window.__shares.push('never answers'); return new Promise(() => {}); }
          if (window.__fails) { window.__shares.push('failed: TypeError'); return Promise.reject(new TypeError('share failed')); }
          if (open) { window.__shares.push('second: InvalidStateError'); return Promise.reject(new DOMException('An earlier share has not yet completed.', 'InvalidStateError')); }
          window.__shares.push('sheet open: ' + data.files[0].name);
          return new Promise((resolve, reject) => { open = { resolve, reject }; });
        };
        window.__endShare = (how) => { const o = open; open = null; if (!o) return false; if (how === 'save') o.resolve(); else o.reject(new DOMException('Share canceled', 'AbortError')); return true; };
      });
      const pg = await F.open(p, server);
      const downloads = [];
      pg.on('download', (d) => downloads.push(d.suggestedFilename()));
      const lastExport = async () => (await lib.readStorage(pg, 'fuel.backup') || {}).lastExport || null;
      await lib.openTab(pg, 'settings');
      await share('Export JSON tapped twice, then the share sheet cancelled: nothing is noted, nothing downloaded', async () => {
        await pg.click('.backup-btns [data-action="export"]');
        await pg.click('.backup-btns [data-action="export"]');
        await lib.sleep(300);
        need(await pg.evaluate(() => window.__endShare('cancel')), 'no share sheet was open');
        await lib.sleep(300);
        const calls = await pg.evaluate(() => window.__shares);
        need(downloads.length === 0, 'a download started: ' + downloads.join(', ') + ' (share calls: ' + calls.join(', ') + ')');
        need((await lastExport()) === null && /No export from this phone yet/.test(await F.text(pg, '#last-export')), 'the export is noted: ' + await F.text(pg, '#last-export'));
        return 'share calls: ' + calls.join(', ');
      });
      await share('a share the phone refuses (NotAllowedError): nothing is noted, nothing downloaded', async () => {
        await pg.evaluate(() => { window.__refuse = true; });
        await pg.click('.backup-btns [data-action="export"]');
        await lib.sleep(300);
        await pg.evaluate(() => { window.__refuse = false; });
        need(downloads.length === 0 && (await lastExport()) === null, 'downloads: ' + downloads.length + ', last export: ' + await lastExport());
        return (await pg.evaluate(() => window.__shares)).slice(-1)[0];
      });
      // Any other failure of the sheet: the file is offered as a download, but not counted as saved, so the
      // export reminder stays true (as in Overload).
      await share('a share that fails another way (TypeError): the download is offered, nothing is noted', async () => {
        await pg.evaluate(() => { window.__fails = true; });
        await pg.click('.backup-btns [data-action="export"]');
        await lib.sleep(400);
        await pg.evaluate(() => { window.__fails = false; });
        need(downloads.length === 1 && /^fuel-backup-\d{4}-\d{2}-\d{2}\.json$/.test(downloads[0]), 'downloads: ' + downloads.join(', '));
        need((await lastExport()) === null && /No export from this phone yet/.test(await F.text(pg, '#last-export')), 'the export is noted: ' + await F.text(pg, '#last-export'));
        downloads.length = 0;
        return (await pg.evaluate(() => window.__shares)).slice(-1)[0] + '; one download, not noted';
      });
      // A sheet that never answers: a tap within the minute after it opened does nothing (a second share would be
      // refused); after that a tap is let through, so Export is not dead for the rest of the session.
      await share('a share sheet that never answers: a tap within the minute does nothing, ten minutes later Export opens the sheet again', async () => {
        await pg.evaluate(() => { window.__hang = true; });
        await pg.click('.backup-btns [data-action="export"]');
        await lib.sleep(200);
        await pg.evaluate(() => { window.__hang = false; });
        await pg.clock.fastForward(20 * 1000);
        await pg.click('.backup-btns [data-action="export"]');
        await lib.sleep(200);
        const soon = (await pg.evaluate(() => window.__shares)).slice(-2);
        need(soon[1] === 'never answers', 'a tap 20 s later reached the share sheet: ' + soon.join(', '));
        await pg.clock.fastForward(10 * 60 * 1000);
        await pg.click('.backup-btns [data-action="export"]');
        await lib.sleep(200);
        const later = (await pg.evaluate(() => window.__shares)).slice(-1)[0];
        need(/^sheet open: fuel-backup-/.test(later), 'ten minutes later the tap did not reach the share sheet: ' + (await pg.evaluate(() => window.__shares)).join(', '));
        need(await pg.evaluate(() => window.__endShare('cancel')), 'no share sheet was open');
        await lib.sleep(200);
        need(downloads.length === 0 && (await lastExport()) === null, 'downloads: ' + downloads.length + ', last export: ' + await lastExport());
        return 'share calls: ' + (await pg.evaluate(() => window.__shares)).slice(-2).join(', ');
      });
      await share('a share that goes through is noted', async () => {
        await pg.click('.backup-btns [data-action="export"]');
        await lib.sleep(200);
        need(await pg.evaluate(() => window.__endShare('save')), 'no share sheet was open');
        await pg.waitForFunction(() => /Last export: today/.test(document.querySelector('#last-export').textContent), null, { timeout: 3000 });
        need(downloads.length === 0 && (await lastExport()) > 0, 'downloads: ' + downloads.length);
        F.assertClean(p, 'share sheet');
        return await F.text(pg, '#last-export');
      });
      await p.close();
    }
  } catch (e) {
    run.say(false, 'fuel-backup', 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' '));
  } finally {
    tmp.rm();
    await browser.close();
    await server.stop();
  }
  run.done();
})();
