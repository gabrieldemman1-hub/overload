/* Fuel — a personal food diary: calories, protein, carbs and fat.
 * Vanilla JS, no build step. All data lives in localStorage on this device.
 *
 * Until 3.0 this was the Food tab of Overload (the training app, one folder up). The diary itself is still
 * food.js, which runs here as it ran there: this file is the shell around it. It loads and saves the data,
 * draws the frame (tabs, sheets, messages), adds the Trends and Settings screens, keeps the backups, and brings
 * the food log across from Overload. food.js and sync.js reach it through window.__overload (the name Overload
 * uses; the two apps are separate pages, and keeping the name means food.js needed no change).
 *
 * The pieces that protect the data (load, save, the storage-full banner, the unreadable-data screen, automatic
 * copies, the update flow) are Overload's own, copied from its main script (app.js then, overload.js now) and trimmed.
 */
(function () {
  'use strict';
  const icon = window.icon || (() => '');   // ../shared/icons.js. If it did not arrive the app still runs, without its icons

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const APP_NAME = 'Fuel';               // a working name: keep it here (and in the page, the manifest)
  const VERSION = '3.0';
  const STORAGE_KEY = 'fuel.state.v1';
  const SYNC_KEY = 'fuel.sync.v1';       // cloud sync's note of what the cloud holds (sync.js)
  const BACKUP_KEY = 'fuel.backup';      // { since, lastExport, nagOff } (ms): this phone only, never synced
  const THEME_KEY = 'fuel.theme';        // read by the page before first paint
  const HERE_KEY = 'fuel.here';          // sessionStorage: "Use it here anyway" was tapped in this Safari tab
  // Overload's saved data. Only ever read, and only where both apps share one storage (an ordinary browser,
  // or this page opened inside the installed Overload). Nothing in this file writes a key starting "overload.".
  const OVERLOAD_KEY = 'overload.state.v1';
  // How much the app can count on saving. The iPhone's real limit is not measured; this is a safe guess.
  const STORE_LIMIT = 2500000;
  const TEXT_PREFIX = 'OVERLOAD-FOOD:';  // the food log as text, copied in Overload: + '1:' gzip, or '0:' plain, then base64

  // ---------------------------------------------------------------------------
  // Helpers (the first seven and the sheet and toast functions further down are what food.js takes from lib)
  // ---------------------------------------------------------------------------
  const $ = (sel, el) => (el || document).querySelector(sel);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

  function todayKey(d) {
    d = d || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function fmtDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function addDays(key, n) { const [y, m, d] = key.split('-').map(Number); return todayKey(new Date(y, m - 1, d + n)); }
  // A date range for the backup questions and the copy list. Years show when it is not all this year.
  function fmtRange(a, b) {
    const yr = String(new Date().getFullYear()), years = String(a).slice(0, 4) !== yr || String(b).slice(0, 4) !== yr;
    const f = (key) => { const [y, m, d] = String(key).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, Object.assign({ month: 'short', day: 'numeric' }, years ? { year: 'numeric' } : {})).replace(/ /g, ' '); };   // each date stays on one line
    return a === b ? f(a) : f(a) + ' – ' + f(b);
  }
  function daysBetween(a, b) { const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5); }
  function weekStart(key) { const [y, m, d] = key.split('-').map(Number); const dt = new Date(y, m - 1, d); return addDays(key, -((dt.getDay() + 6) % 7)); }   // the Monday
  // "1 day", "2 days"; "1 entry", "1,576 entries" (the second word when adding an s is not enough).
  function plural(n, word, many) { return Number(n).toLocaleString() + ' ' + (n === 1 ? word : many || word + 's'); }
  const fmtK = (n) => Math.round(n).toLocaleString();
  function fmtWhen(ms) { return fmtDate(todayKey(new Date(ms))) + ', ' + new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  // A short fingerprint of a text (the one cloud sync uses), as letters and digits. Only used to give an entry
  // that came without an id the same id every time it is read.
  function hashOf(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  // { v: 1, app: 'fuel',
  //   settings: { units: 'lb' | 'kg', theme: 'system' | 'dark' | 'light' },
  //   food: { targets: { kcal, protein, carbs, fat }, foods: { id: food }, meals: { id: meal } },
  //   diary: { 'YYYY-MM-DD': [entry] },
  //   deleted: { food: { entryId: ms }, foods: { foodId: ms }, meals: { mealId: ms },   never pruned
  //              fav: { foodId: ms }, custom: { foodId: ms } },   only once there is one (see normalize)
  //   bodyweight: [ { date, weight } ],   at most one: the number the protein guide under the targets uses
  //   moved: { from, at, days, entries, madeAt } | null }   the hand-over from Overload, once it happened
  // The field names are the ones Overload used, so food.js runs on this unchanged. There is never an
  // "exercises" field: with v: 1 that is what Overload's Import takes for one of its own backups, and it
  // would replace everything there.
  let state = null;

  function freshState() {
    return normalize({ v: 1, app: 'fuel', settings: {}, food: {}, diary: {}, deleted: {}, bodyweight: [], moved: null });
  }

  // Whether the page started on saved data, as load() found it before anything could be tapped. Cloud sync
  // believes its note only then (see `startedWithData` at the end of this file).
  let startedWithData = false;
  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      startedWithData = !!raw;
      if (!raw) {
        // Nothing saved yet: Welcome asks where to begin, and nothing is stored until he says. A note of what
        // the cloud holds can only describe data that is no longer here (the storage lost it): with the note,
        // the next upload would delete in the account everything it lists. Without it a sign-in downloads.
        try { localStorage.removeItem(SYNC_KEY); } catch (e) { /* ignore */ }
        ui.welcome = true; return freshState();
      }
      const parsed = JSON.parse(raw);
      if (isObj(parsed) && parsed.v === 1) return normalize(parsed);
    } catch (e) { /* fall through */ }
    // Saved data that cannot be read (damaged, or written by a newer version): never save over it. Keep a copy,
    // forget what cloud sync knew (a later sign-in then downloads instead of deleting), and let him choose.
    ui.unreadable = { raw };
    if (raw) { try { localStorage.setItem(STORAGE_KEY + '.bak', raw); } catch (e) { /* ignore */ } }
    try { localStorage.removeItem(SYNC_KEY); } catch (e) { /* ignore */ }
    return freshState();   // in memory only, so the app can run; nothing is saved until he chooses
  }

  // ---- Values from storage, a file, a pasted text or the cloud: the right type, so food.js can add them up
  // ---- and nothing can show up as page markup. Only what is wrong is touched; fields this file does not know stay.
  const BAD_KEY = /^(__proto__|constructor|prototype)$/;
  const noProto = (k, v) => (BAD_KEY.test(k) ? undefined : v);   // JSON.parse reviver for files and pasted text
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);   // an id is looked up as an own key only
  // The deletion records beside food, foods and meals that exist only once there is one (see normalize).
  const MORE_RECORDS = ['fav', 'custom'];
  function dropBadKeys(o) { if (isObj(o)) Object.keys(o).forEach((k) => { if (BAD_KEY.test(k)) delete o[k]; }); }
  // Numbers stay numbers, numeric text becomes a number, null / '' stay as they are (they mean "not set"); anything else is dropped.
  function cleanNum(v) {
    if (v == null || v === '') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    return typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null;
  }
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  // A number that food.js adds up or multiplies (calories and grams): numeric text becomes the number, anything
  // else counts as 0. Text would turn a day's total into joined-up text, a missing value into "NaN".
  function amount(v) { const n = cleanNum(v); return typeof n === 'number' ? n : 0; }
  // Returns whether anything had to be changed.
  function amounts(o) { let fixed = false; ['kcal', 'p', 'c', 'f'].forEach((k) => { if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) { o[k] = amount(o[k]); fixed = true; } }); return fixed; }
  // The id of the food an entry was logged from. "constructor", "toString"… would reach built-in objects when looked up.
  function cleanRef(v) { const s = String(v); return s in Object.prototype ? 'x' + s : s; }
  // One logged food, or one item of a saved meal (the same without id, meal and time).
  function cleanItem(e) {
    const fixed = amounts(e);
    if ('name' in e && typeof e.name !== 'string') e.name = e.name == null ? 'Food' : String(e.name);
    ['amt', 'brand'].forEach((k) => { if (k in e && typeof e[k] !== 'string') e[k] = e[k] == null || typeof e[k] === 'object' ? '' : String(e[k]); });
    if (e.food != null) e.food = cleanRef(e.food);
    return fixed;
  }
  // rep (optional) counts what was wrong, for the question before an import.
  function cleanDiary(diary, rep) {
    Object.keys(diary).forEach((day) => {
      const list = diary[day];
      // A day is 'YYYY-MM-DD' with a list of entries. Anything else cannot be shown, and a name with a "/"
      // in it would stop cloud sync.
      if (!isDate(day) || !Array.isArray(list)) { if (rep) rep.badDays++; delete diary[day]; return; }
      const good = list.every(isObj) ? list : list.filter(isObj);
      if (rep) rep.badEntries += list.length - good.length;
      if (!good.length) { delete diary[day]; return; }   // a day with nothing in it is no day (food.js drops the key with the last entry)
      if (good !== list) diary[day] = good;
      const [y, m, d] = day.split('-').map(Number);
      let after = new Date(y, m - 1, d).getTime();
      const twins = new Map();   // entries without an id that hold exactly the same, on this day: how many so far
      good.forEach((e) => {
        // Everything is merged by day and id. An entry without one gets an id made from its day and what it
        // holds as it arrived (before a time or a meal is filled in below), never from its place in the list:
        // the same entry gets the same id every time it is read, also after the entries before it changed, so
        // a later import does not add it again. Identical ones on the same day are told apart by a count.
        let made = null;
        if (typeof e.id !== 'string' || !e.id) {
          if (typeof e.id === 'number') made = String(e.id);
          else {
            const held = JSON.stringify(e), k = twins.get(held) || 0;
            twins.set(held, k + 1);
            made = 'n' + hashOf(day + '#' + held + (k ? '#' + k : ''));
          }
        }
        const fixed = cleanItem(e);
        // Breakfast, Lunch, Dinner, Snacks are 0 to 3. An entry with another value would count in the day's
        // total and show under no meal: it goes to Snacks.
        const meal = typeof e.meal === 'string' && e.meal.trim() !== '' ? +e.meal : e.meal;
        if (meal === 0 || meal === 1 || meal === 2 || meal === 3) e.meal = meal; else { e.meal = 3; if (rep) rep.noMeal++; }
        // The time orders a day when cloud sync merges it. Without one: just after the entry before it.
        if (typeof e.at !== 'number' || !Number.isFinite(e.at)) { const t = cleanNum(e.at); e.at = typeof t === 'number' ? t : after; }
        after = e.at + 1;
        if (made !== null) e.id = made;
        if (fixed && rep) rep.fixed++;
      });
    });
  }
  function cleanFoods(foods) {
    Object.keys(foods).forEach((id) => {
      const f = foods[id];
      if (!isObj(f)) { delete foods[id]; return; }
      if (f.id !== id) f.id = id;   // rows in the Add sheet find their food by this
      if (typeof f.name !== 'string') f.name = f.name == null ? 'Food' : String(f.name);   // the lists are sorted by name
      if ('brand' in f && typeof f.brand !== 'string') f.brand = '';
      if ('usda' in f && typeof f.usda !== 'string') delete f.usda;
      if ('barcode' in f && typeof f.barcode !== 'string') { if (f.barcode == null) delete f.barcode; else f.barcode = String(f.barcode); }
      if (f.n != null) { if (isObj(f.n)) amounts(f.n); else f.n = null; }
      if (f.serving != null) {
        if (!isObj(f.serving)) f.serving = null;
        else {
          const sv = f.serving;
          if (typeof sv.label !== 'string') sv.label = sv.label == null ? '1 serving' : String(sv.label);
          if (sv.g != null && !(typeof sv.g === 'number' && sv.g > 0)) sv.g = amount(sv.g) > 0 ? amount(sv.g) : null;
          if (sv.n != null) { if (isObj(sv.n)) amounts(sv.n); else sv.n = null; }
        }
      }
      // Entries point at a portion by its place in this list (s0, s1…): a bad one is repaired where it is, never taken out.
      if (f.servings != null) {
        if (!Array.isArray(f.servings)) f.servings = [];
        else f.servings.forEach((sv, i) => {
          if (!Array.isArray(sv)) { f.servings[i] = ['serving', 0]; return; }
          if (typeof sv[0] !== 'string') sv[0] = String(sv[0]);
          if (typeof sv[1] !== 'number' || !Number.isFinite(sv[1])) sv[1] = amount(sv[1]);
        });
      }
      if (f.last != null && !(isObj(f.last) && typeof f.last.qty === 'number' && typeof f.last.unit === 'string')) delete f.last;
      if ('used' in f && typeof f.used !== 'number') { const t = cleanNum(f.used); if (typeof t === 'number') f.used = t; else delete f.used; }
    });
  }
  function cleanMeals(meals) {
    Object.keys(meals).forEach((id) => {
      const m = meals[id];
      if (!isObj(m)) { delete meals[id]; return; }
      if (m.id !== id) m.id = id;
      if (typeof m.name !== 'string' || !m.name) m.name = m.name == null || m.name === '' ? 'Meal' : String(m.name);
      if (!Array.isArray(m.items)) m.items = []; else if (!m.items.every(isObj)) m.items = m.items.filter(isObj);
      m.items.forEach(cleanItem);
      if ('used' in m && typeof m.used !== 'number') { const t = cleanNum(m.used); if (typeof t === 'number') m.used = t; else delete m.used; }
    });
  }
  // Makes any value a state the app and food.js can run on: every container exists, entries have ids and
  // numbers, days are dates. Used on load, on what cloud sync delivers, and on everything an import reads.
  // Works in place and never throws.
  function normalize(st, rep) {
    // Keys that would change how objects behave (only a hand-made file can hold them).
    [st, st.settings, st.food, st.food && st.food.targets, st.food && st.food.foods, st.food && st.food.meals, st.diary, st.deleted].forEach(dropBadKeys);
    st.v = 1; st.app = 'fuel';
    delete st.exercises;   // never in a Fuel state or file: see the note above `state`
    st.settings = Object.assign({ units: 'lb', theme: 'system' }, isObj(st.settings) ? st.settings : {});
    if (st.settings.units !== 'lb' && st.settings.units !== 'kg') st.settings.units = 'lb';
    if (!['system', 'dark', 'light'].includes(st.settings.theme)) st.settings.theme = 'system';
    // Overload's other settings never belong here; its connector key is a secret. An import takes units and
    // theme by name, so these cannot arrive that way. This is the second lock on the same door.
    ['connKey', 'connUrl', 'reminders'].forEach((k) => { delete st.settings[k]; });
    if (!isObj(st.food)) st.food = {};
    st.food.targets = Object.assign({ kcal: null, protein: null, carbs: null, fat: null }, isObj(st.food.targets) ? st.food.targets : {});
    ['kcal', 'protein', 'carbs', 'fat'].forEach((k) => { st.food.targets[k] = cleanNum(st.food.targets[k]); });
    if (!isObj(st.food.foods)) st.food.foods = {};
    if (!isObj(st.food.meals)) st.food.meals = {};
    cleanFoods(st.food.foods);
    cleanMeals(st.food.meals);
    if (!isObj(st.diary)) st.diary = {};
    cleanDiary(st.diary, rep);
    // Deletion records for entries (food), saved foods and saved meals, so that a later import or cloud merge
    // never brings back something deleted here. They are never pruned: Overload keeps its old copy of the
    // food log for good, and it can be imported again at any time.
    if (!isObj(st.deleted)) st.deleted = {};
    const times = (m) => { dropBadKeys(m); Object.keys(m).forEach((id) => { const t = cleanNum(m[id]); m[id] = typeof t === 'number' && t > 0 ? t : Date.now(); }); return m; };
    ['food', 'foods', 'meals'].forEach((k) => { st.deleted[k] = times(isObj(st.deleted[k]) ? st.deleted[k] : {}); });
    // Two more records, there only once one is needed (a state without them is stored as before), kept and synced
    // like the others: fav, a star he took off a saved food here (review finding data#3); custom, a food he made
    // or corrected (src custom) and deleted here (data#4). An import then takes neither that star nor that
    // correction from a copy. A record of a star goes when the food is starred again (dropStars).
    MORE_RECORDS.forEach((k) => {
      if (!(k in st.deleted)) return;
      if (isObj(st.deleted[k])) times(st.deleted[k]); else delete st.deleted[k];
    });
    dropStars(st);
    // Body weight is Overload's. Fuel keeps one number, the latest, for the protein guide under the targets.
    const bw = (Array.isArray(st.bodyweight) ? st.bodyweight : []).filter((b) => isObj(b) && isDate(b.date));
    bw.forEach((b) => { b.weight = cleanNum(b.weight); });
    const weighed = bw.filter((b) => b.weight > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
    st.bodyweight = weighed.length ? [weighed[weighed.length - 1]] : [];
    st.moved = isObj(st.moved) ? st.moved : null;
    return st;
  }
  // A saved food can come back under its old id: the same barcode typed in again, or a listed product logged
  // again after his corrected copy of it was deleted. It is then not deleted any more, and its record must
  // go, or a later cloud merge could take the food away again. (Meals and entries get a new id every time.)
  // The record of a deleted correction (custom) stays when the food list's copy is logged again: it is that
  // correction an import must not bring back.
  function dropStaleRecords() {
    const gone = state.deleted;
    Object.keys(gone.foods).forEach((id) => { if (state.food.foods[id]) delete gone.foods[id]; });
    Object.keys(gone.meals).forEach((id) => { if (state.food.meals[id]) delete gone.meals[id]; });
    dropStars(state);
  }
  // A star taken off and put back: its record goes (from a sync merge too: a star and its record cannot both stand).
  function dropStars(st) {
    const fav = st.deleted.fav; if (!isObj(fav)) return;
    Object.keys(fav).forEach((id) => { if (own(st.food.foods, id) && st.food.foods[id].fav) delete fav[id]; });
    if (!Object.keys(fav).length) delete st.deleted.fav;
  }

  const NOT_SAVED = 'Not saved on this phone: the app\'s storage is full. Export a backup now.';
  // Returns whether the data reached this phone's storage.
  function save() {
    if (ui.unreadable) return false;   // the stored data could not be read: never write over it
    if (ui.gate) return false;         // held at "Add to Home Screen": this may be another app's storage, nothing is kept in it
    if (ui.welcome) leaveWelcome();    // the first save is the beginning of this phone's own data
    let ok = true, text = null;
    try { dropStaleRecords(); text = JSON.stringify(state); localStorage.setItem(STORAGE_KEY, text); ui.savedChars = text.length; }
    catch (e) { ok = false; }
    if (ui.booted) ui.copyDue = true;   // today's automatic copy is brought up to date when the app goes to the background
    if (ok !== !ui.saveFailed) {
      // Stays on screen until a save works: a toast is too easy to miss when data is at stake.
      ui.saveFailed = !ok;
      renderSaveWarning();
    }
    // An "Added" / "Saved" message shown right after this would not be true.
    // This runs after the caller's own message, so it replaces it.
    if (!ok && ui.booted) Promise.resolve().then(() => toast(NOT_SAVED));
    document.dispatchEvent(new CustomEvent('overload:save'));   // cloud sync listens (the event keeps Overload's name, as food.js and sync.js know it)
    return ok;
  }
  function renderSaveWarning() {
    const el = $('#save-warning'); if (!el) return;
    el.hidden = !ui.saveFailed;
    document.body.classList.toggle('has-save-warning', !!ui.saveFailed);
    el.innerHTML = ui.saveFailed ? '<div class="banner danger"><b>The app\'s storage is full.</b> Your latest changes are not saved on this phone and are lost if the app closes. '
      + 'Export a backup now. Freeing space on the phone does not help: this limit belongs to the app.<div class="btn-row mt8"><button class="btn" data-action="export">' + icon('export') + 'Export backup</button></div></div>' : '';
    // The banner is fixed under the top bar; the screen starts below it (see .has-save-warning in the stylesheet).
    document.documentElement.style.setProperty('--save-warning-h', ui.saveFailed ? el.offsetHeight + 'px' : '0px');
  }

  // ---- Automatic copies, storage use, last export (backup.js keeps the copies in IndexedDB) ----
  // Before an import, reset or restore the text is taken now (the data changes right after);
  // the daily copy builds it only if today has none yet, unless it is forced.
  function safetyCopy(kind, force, text) {
    const B = window.__overloadBackup;
    if (ui.gate) return Promise.resolve(false);
    try { return B ? B.take(kind, text || (kind === 'day' ? () => JSON.stringify(state) : JSON.stringify(state)), force) : Promise.resolve(false); } catch (e) { return Promise.resolve(false); }
  }
  // Today's copy is first taken when the app starts. Food logged after that would not be in it, so it is
  // written again when the app goes to the background, if anything was saved meanwhile.
  function refreshDayCopy() {
    if (!ui.copyDue || ui.unreadable || ui.welcome || ui.gate) return;
    ui.copyDue = false;
    safetyCopy('day', true, JSON.stringify(state));
  }
  function backupInfo() { try { return JSON.parse(localStorage.getItem(BACKUP_KEY)) || {}; } catch (e) { return {}; } }
  function setBackupInfo(patch) { try { localStorage.setItem(BACKUP_KEY, JSON.stringify(Object.assign(backupInfo(), patch))); } catch (e) { /* ignore */ } }
  // Characters stored by this site (key + value, as browsers count them), the app's data counted from its last save.
  // In an ordinary browser that includes what Overload keeps: the two apps share one storage and one limit there.
  function storageUsed() {
    let n = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        n += k.length + (k === STORAGE_KEY && ui.savedChars != null ? ui.savedChars : (localStorage.getItem(k) || '').length);
      }
    } catch (e) { /* ignore */ }
    return n;
  }
  function agoText(ms) { const d = daysBetween(todayKey(new Date(ms)), todayKey()); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; }
  function lastExportText() { const t = backupInfo().lastExport; return t ? 'Last export: ' + agoText(t) + '.' : 'No export from this phone yet.'; }
  function syncOn() { return !!cloudAccount(); }   // before the module has reported: a phone signed in when it last ran counts as on (not one signed out since)
  // Cloud sync off and no export for 14 days (counted from the first start when there is none).
  function exportDue() {
    if (syncOn() || !Object.keys(state.diary).length) return false;
    const b = backupInfo(), now = Date.now(), two = 14 * 864e5;
    if (b.nagOff && now - b.nagOff < two) return false;
    const from = b.lastExport || b.since;
    return !!from && now - from > two;
  }
  // One line at the top of Today: storage nearly full, or the export reminder.
  function noticesHtml() {
    if (ui.unreadable) return '';
    const pct = Math.round(storageUsed() / STORE_LIMIT * 100);
    if (pct >= 70) return '<div class="notice">' + icon('warning') + '<span>Storage is ' + pct + '% full. Export a backup now so nothing is lost.</span><button class="btn small" data-action="export">Export</button></div>';
    if (exportDue()) {
      const t = backupInfo().lastExport;
      return '<div class="notice">' + icon('warning') + '<span>' + (t ? 'Last backup ' + agoText(t) : 'No backup yet') + ', and cloud sync is off.</span><button class="btn small" data-action="export">Export</button><button class="icon-btn" data-action="export-nag-off" aria-label="Remind me in two weeks">' + icon('close', 'm') + '</button></div>';
    }
    return '';
  }
  function refreshNotices() { const el = $('#today-notices'); if (el) el.innerHTML = noticesHtml(); }
  // What a state holds, for the questions before data is replaced: "110 food days (Aug 2 – Nov 21), 1,576 entries".
  function dataSummary(st) {
    const diary = isObj(st.diary) ? st.diary : {};
    const days = Object.keys(diary).filter((k) => Array.isArray(diary[k]) && diary[k].length).sort();
    if (!days.length) return 'no food days';
    return plural(days.length, 'food day') + ' (' + fmtRange(days[0], days[days.length - 1]) + '), ' + plural(days.reduce((n, k) => n + diary[k].length, 0), 'entry', 'entries');
  }
  // Settings: the list of automatic copies is read from IndexedDB after the screen is drawn.
  const COPY_KINDS = { import: 'Before import', reset: 'Before reset', restore: 'Before restore', cloud: 'Before cloud sign-in', unreadable: 'Unreadable data' };
  function copyRow(m) {
    const when = fmtDate(todayKey(new Date(m.at))) + (m.kind === 'day' ? '' : ', ' + new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    const title = m.kind === 'day' ? when : (COPY_KINDS[m.kind] || 'Copy') + ' · ' + when;
    const sub = m.days == null ? 'As it was found. Export it if you might need it.'
      : !m.days ? 'No food days'
      : plural(+m.days, 'food day') + (m.first ? ' · ' + fmtRange(m.first, m.last || m.first) : '') + ' · ' + plural(+m.entries || 0, 'entry', 'entries');
    const btn = m.kind === 'unreadable' ? '<button class="btn small ghost" data-action="export-copy" data-id="' + esc(m.id) + '">Export</button>' : '<button class="btn small ghost" data-action="restore-copy" data-id="' + esc(m.id) + '">Restore</button>';
    return '<div class="list-item copy-row"><div class="grow"><div class="title">' + esc(title) + '</div><div class="sub">' + esc(sub) + '</div></div>' + btn + '</div>';
  }
  function fillCopies(restorableOnly) {
    const el = $('#safety-copies'); if (!el) return;
    const B = window.__overloadBackup;
    const none = (t) => { const box = $('#safety-copies'); if (box) box.innerHTML = '<p class="small muted">' + t + '</p>'; };
    if (!B) { none('Automatic copies are not available.'); return; }
    B.list().then((list) => {
      if (restorableOnly) list = list.filter((m) => m.kind !== 'unreadable');
      ui.copiesHtml = list.length ? '<div class="list">' + list.map(copyRow).join('') + '</div>' : '<p class="small muted">No copies yet.</p>';
      const box = $('#safety-copies'); if (box) box.innerHTML = ui.copiesHtml;
      const sec = $('#restore-section'); if (sec) sec.hidden = !list.length;   // unreadable screen: offered only if there is one
    }, () => { none('Automatic copies are not available in this browser.'); const sec = $('#restore-section'); if (sec) sec.hidden = true; });
  }
  function renderBackupCard() {
    const used = storageUsed(), pct = Math.round(used / STORE_LIMIT * 100), cls = pct >= 70 ? 'high' : 'ok';
    return '<div class="group-title">Backup</div><div class="card"><p class="small muted mb8">Export a copy now and then. With cloud sync off, this phone is the only place your food log lives.</p>'
      + '<div class="btn-row backup-btns"><button class="btn ghost" data-action="export">' + icon('export') + 'Export JSON</button><button class="btn ghost" data-action="import">' + icon('import') + 'Import JSON</button></div>'
      + '<p class="small muted mt8" id="last-export">' + lastExportText() + '</p>'
      + '<p class="small muted mt8">Import adds only what is missing here, with the favorite stars and the numbers you corrected there. Nothing else is replaced or removed.</p>'
      + '<div class="toggle-row"><div><div>Storage used</div><div class="small muted">' + used.toLocaleString() + ' of about ' + STORE_LIMIT.toLocaleString() + ' characters the app can safely use. Today warns at 70%.</div>'
      + '<span class="vol-bar store-bar"><span class="vol-fill ' + cls + '" style="width:' + Math.min(100, pct) + '%"></span></span></div><span class="vol-n ' + cls + '">' + pct + '%</span></div>'
      + '<div class="mt12"><b>Automatic copies</b></div><p class="small muted mb8">Kept on this phone: one a day for the last ' + ((window.__overloadBackup && window.__overloadBackup.KEEP_DAYS) || 7) + ' days (brought up to date when you leave the app), and one each from before the last import, reset, restore and cloud sign-in.</p>'
      + '<div id="safety-copies">' + (ui.copiesHtml || '<p class="small muted">Looking for copies…</p>') + '</div></div>';
  }
  // Restore an automatic copy: confirm, keep a copy of what is here now, then replace.
  async function restoreCopy(id) {
    const B = window.__overloadBackup; if (!B || ui.replacing || cloudStillReading()) return;
    let rec = null, parsed = null;
    try { rec = await B.get(id); parsed = rec && JSON.parse(rec.text, noProto); } catch (e) { parsed = null; }
    if (!isObj(parsed) || parsed.v !== 1 || parsed.app !== 'fuel') { toast('That copy cannot be read'); return; }
    const what = rec.kind === 'day' ? 'the copy from ' + fmtDate(todayKey(new Date(rec.at))) : 'the copy "' + (COPY_KINDS[rec.kind] || 'Copy') + '"';
    const here = ui.unreadable ? '' : '\nThis phone now: ' + dataSummary(state) + '.\n\nA copy of what is on the phone now is kept first.' + cloudNote('replaced');
    if (!confirm('Replace the food log on this phone with ' + what + '?\n\nThe copy: ' + dataSummary(parsed) + '.' + here)) return;
    await replaceState(parsed, 'restore', 'Copy restored');
  }
  // Restore: keep a copy of what is here, then put the copy in place. (An import never comes this way: it adds.)
  // The copy of what is here is stored first, as the question said: if it cannot be, nothing is replaced.
  async function replaceState(parsed, kind, done) {
    if (ui.replacing) return;
    ui.replacing = true;
    try {
      if (!ui.unreadable) { const c = await copyFirst(kind); if (c !== 'kept') { notDone(c, 'Restore a copy', 'replaced'); return; } }
      forgetCloudIfSignedOut();
      state = normalize(parsed);
      if (ui.unreadable) { leaveUnreadable(); ui.screen = 'food'; }
      applyTheme(); const ok = save(); render(); toast(ok ? done : NOT_SAVED);
    } finally { ui.replacing = false; }
  }
  // The copy of what is here, taken before a reset, a restore or an import. The question before each says it is
  // kept, and it is the way back if the step was a mistake, so the step waits for it: 'kept' when it is stored
  // and nothing changed meanwhile, 'failed' when it could not be stored (IndexedDB did not answer, or refused
  // it), 'changed' when cloud sync brought something while it was being stored (the copy would not hold that).
  async function copyFirst(kind) {
    const text = JSON.stringify(state);
    if (!(await safetyCopy(kind, false, text))) return 'failed';
    return JSON.stringify(state) === text ? 'kept' : 'changed';
  }
  const copyFailedText = (did) => 'The automatic copy could not be stored, so nothing was ' + did + '. Export a backup first, then try again.';
  // Nothing was done because the copy was not kept. Export is a button of its own in a sheet, so the share sheet
  // opens from a tap of his (an iPhone opens it only from a tap).
  function notDone(c, title, did) {
    if (c !== 'failed') { toast('The food log changed just now. Nothing was ' + did + '.'); return; }
    openSheet(sheetHeader(title) + '<div class="banner warn" role="alert">' + icon('warning') + '<span>' + copyFailedText(did) + '</span></div>'
      + '<button class="btn block" data-action="export">' + icon('export') + 'Export backup</button>', 'copy-failed');
  }

  // Theme: 'system' follows the phone, 'dark' / 'light' force one.
  function applyTheme() {
    const t = state.settings.theme || 'system';
    const root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    const light = t === 'light' || (t === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
    root.classList.toggle('system-light', t === 'system' && light);
    // Not while the app waits at "Add to Home Screen" or at Welcome: nothing is stored before he begins.
    if (!ui.gate && !ui.welcome) { try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ } }
    const meta = $('meta[name="theme-color"]'); if (meta) meta.content = light ? '#f6f6f3' : '#0a0b0c';   // --bg of each theme (shared/ui.css)
  }
  // Replace the whole state (used by cloud sync when remote data arrives).
  function setState(next) {
    if (!next || next.v !== 1 || ui.unreadable || ui.gate) return;
    state = normalize(next);
    if (ui.welcome) leaveWelcome();   // the food log came down from his account: that is the beginning
    let ok = true;
    // The storage meter counts the app's data from what was last stored (see storageUsed), here as in save().
    try { const text = JSON.stringify(state); localStorage.setItem(STORAGE_KEY, text); ui.savedChars = text.length; } catch (e) { ok = false; }
    if (ok !== !ui.saveFailed) { ui.saveFailed = !ok; renderSaveWarning(); }
    ui.copyDue = true;
    applyTheme();
    renderWhenIdle();
  }
  // Data from the cloud must not redraw the screen under a box being typed in (the keyboard closes and the
  // typing is lost). Wait until no box on the screen has the keyboard, then draw once.
  function typingInApp() { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('#app')); }
  function renderWhenIdle() {
    if (!typingInApp()) { render(); return; }
    if (ui.renderLater) return;
    ui.renderLater = setInterval(() => { if (typingInApp()) return; clearInterval(ui.renderLater); ui.renderLater = null; render(); }, 700);
  }

  function markDeleted(kind, id) { (state.deleted[kind] || (state.deleted[kind] = {}))[id] = Date.now(); }   // fav and custom are made with their first record

  // ---------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------
  // screen: 'food' (the diary: the tab says Today, the name is the one food.js knows), 'trends' or 'settings'.
  // gate: 'install' | 'inside' | null, welcome, unreadable: screens that stand in front of those three.
  // replacing: a reset or restore waits for its automatic copy; sharing: when the share sheet was opened (ms, 0: not open); trendsFor: the date Trends was drawn for.
  const ui = { screen: 'food', gate: null, welcome: false, unreadable: null, saveFailed: false, sheet: null, sync: { status: 'off', msg: '' }, updateReady: false, booted: false, copyDue: false, here: null,
    replacing: false, sharing: 0, trendsFor: null };
  // What is on screen. food.js acts on the diary only while this is exactly 'food'.
  function shown() { return ui.gate ? 'install' : ui.unreadable ? 'unreadable' : ui.welcome ? 'welcome' : ui.screen; }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function render() {
    if (ui.renderLater) { clearInterval(ui.renderLater); ui.renderLater = null; }   // this draw brings the screen up to date
    document.body.classList.toggle('no-tabs', !!(ui.gate || ui.welcome));   // nowhere to go yet
    if (ui.gate) { renderGate(); return; }
    if (ui.unreadable) { renderUnreadable(); return; }
    if (ui.welcome) { renderWelcome(); return; }
    try {
      renderScreen();
      if (ui.screen === 'food') {
        const html = '<div id="today-notices">' + noticesHtml() + '</div>', t = $('#app > .screen-title');
        if (t) t.insertAdjacentHTML('afterend', html); else $('#app').insertAdjacentHTML('afterbegin', html);
      }
      if (ui.screen === 'settings') fillCopies();
    } catch (e) {
      // One bad record (or a bug) must not leave a blank screen: say so and offer Export. The other tabs keep working.
      console.error(e);
      $('#app').innerHTML = '<div class="card mt16"><p><b>This screen could not be shown.</b> Your saved data has not changed. Export a backup to keep it safe, then try another tab.</p>'
        + '<p class="small muted mt8">' + esc((e && e.message) || e) + '</p>'
        + '<div class="btn-row mt12"><button class="btn" data-action="export">' + icon('export') + 'Export backup</button></div></div>';
    }
  }
  // The tab of the screen shown: lit, and named the current page for assistive tech. null: none.
  function markTabs(active) {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.screen === active;
      t.classList.toggle('active', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
  }
  function renderScreen() {
    const app = $('#app'), F = window.__overloadFood;
    markTabs(ui.screen);
    renderTopbar();
    switch (ui.screen) {
      // food.js draws the first real screen itself when it has loaded (this file runs before it).
      case 'food': app.innerHTML = F ? F.render() : '<div class="empty">Loading…</div>'; break;
      case 'trends': app.innerHTML = renderTrends(); break;
      case 'settings': app.innerHTML = renderSettings(); break;
    }
  }
  // The top bar names the screen (the screen's own h1 is hidden from view, except on Welcome and Add to Home
  // Screen, where it is the headline). The diary says the app's name: the day switcher under it names the day.
  const TITLES = { trends: 'Trends', settings: 'Settings', unreadable: 'Your data' };
  function renderTopbar() {
    const title = $('#topbar-title'); if (title) title.textContent = TITLES[shown()] || APP_NAME;
    const upd = ui.updateReady ? '<button class="pill accent" data-action="reload" aria-label="Update ready">' + icon('refresh', 'm') + '<span>Update ready</span></button>' : '';
    const sync = ui.sync.status === 'off' || ui.gate ? '' : '<button class="pill sync-pill ' + ui.sync.status + '" data-action="goto-settings" aria-label="Cloud sync: ' + ui.sync.status + '" title="' + esc(ui.sync.msg) + '">' + syncIcon(ui.sync.status) + '</button>';
    $('#topbar-right').innerHTML = upd + sync;
  }
  function syncIcon(st) { return icon({ synced: 'cloud-check', syncing: 'sync', offline: 'cloud-off', error: 'warning' }[st] || 'cloud', 'm'); }

  // ---- Where it runs on an iPhone --------------------------------------------
  // An iPhone keeps a separate storage for Safari and for every Home Screen app. Fuel's data must live in
  // Fuel's own Home Screen app: a Safari tab can lose its data after a week without a visit, and a page
  // opened by a link inside the installed Overload runs on Overload's storage.
  //   'install': a Safari tab. Show how to add Fuel to the Home Screen; "Use it here anyway" goes on.
  //   'inside':  a Home Screen app that holds Overload's data and none of Fuel's: this is Overload's own app.
  //              Show the way to Safari. Take no data, store nothing, do not register the offline worker.
  // Only iPhones and iPads have navigator.standalone; every other browser just runs.
  function hasOverloadData() { try { return !!localStorage.getItem(OVERLOAD_KEY); } catch (e) { return false; } }
  function useHere() { try { return sessionStorage.getItem(HERE_KEY) === '1'; } catch (e) { return false; } }
  function gateNow() {
    if (!('standalone' in navigator)) return null;
    if (navigator.standalone !== true) return useHere() ? null : 'install';
    return ui.welcome && hasOverloadData() ? 'inside' : null;
  }
  function fuelAddress() { return new URL('./', location.href).href.split(/[?#]/)[0]; }
  // Each icon follows its bold word with no space of its own, so the sentence reads as it did without it.
  const INSTALL_STEPS = '<li>Tap <b>Share</b>' + icon('share') + ' in Safari\'s toolbar.</li><li>Choose <b>Add to Home Screen</b>' + icon('add-square') + '.</li><li>Open <b>' + APP_NAME + '</b> from its new icon.</li>';
  const BRAND = '<div class="onboard-brand"><span class="app-tile xl">' + icon('mark-fuel') + '</span></div>';   // the Home Screen icon, as he will find it there
  // What this Safari tab holds of Fuel's own ("Use it here anyway" was tapped on an earlier visit), or null.
  // The Home Screen app has a storage of its own and starts empty: this is what would stay behind in the tab,
  // which Safari clears after about a week without a visit. (Data that cannot be read is offered for export
  // on its own screen, once he goes on here.)
  function tabHolds() {
    if (ui.welcome || ui.unreadable) return null;
    const f = state.food, days = Object.keys(state.diary);
    const any = days.length || Object.keys(f.foods).length || Object.keys(f.meals).length || ['kcal', 'protein', 'carbs', 'fat'].some((k) => f.targets[k] > 0);
    return any ? { days: days.length, entries: days.reduce((n, d) => n + state.diary[d].length, 0) } : null;
  }
  function renderGate() {
    markTabs(null);
    renderTopbar();
    const url = fuelAddress(), held = ui.gate === 'install' ? tabHolds() : null;
    $('#app').innerHTML = '<div class="onboard">' + BRAND + '<div class="screen-title"><h1>Add ' + APP_NAME + ' to your Home Screen</h1></div>'
      + (ui.gate === 'inside'
        ? '<p class="lede">This page opened inside Overload. ' + APP_NAME + ' keeps its own data, so it has to be added from Safari.</p>'
          + '<ol class="install-steps"><li>Tap <b>Open in Safari</b> below.</li>' + INSTALL_STEPS + '</ol>'
          // The x-safari address asks the iPhone to open the page in Safari itself. A plain link would stay inside this app,
          // and a button cannot hand over to Safari at all: this stays a link.
          + '<a class="btn block big" data-action="fuel-open-safari" href="' + esc('x-safari-' + url) + '">Open in Safari' + icon('external') + '</a>'
          + '<button class="btn ghost block mt8" data-action="fuel-copy-link">' + icon('link') + 'Copy link</button>'
          + '<p class="small muted center mt8">If the button does nothing: copy the link, open Safari and paste it there.</p>'
          + '<p class="small muted center mt8 link-text">' + esc(url) + '</p>'
        : '<p class="lede">' + APP_NAME + ' works best as its own app: it opens full screen, works offline and keeps its data between visits.</p>'
          // Before the steps: once the Home Screen app is open, this tab's data is out of reach.
          + (held ? '<div class="banner warn">' + icon('warning') + '<span>This Safari tab holds the food log you kept here' + (held.days ? ': ' + plural(held.days, 'day') + ', ' + plural(held.entries, 'entry', 'entries') : '')
            + '. The Home Screen app starts empty, so export a backup first and choose that file in the app.</span></div>'
            + '<button class="btn block mb8" data-action="export">' + icon('export') + 'Export backup</button>' : '')
          + '<ol class="install-steps">' + INSTALL_STEPS + '</ol>'
          + '<div class="banner">' + icon('info') + '<span>On an iPhone, a Safari tab can lose its data after about a week without a visit. The Home Screen app does not.</span></div>'
          + '<div class="foot"><button class="btn text" data-action="fuel-use-here">Use it here anyway</button></div>')
      + '</div>';
  }

  // "Use it here anyway": remembered for this tab only, so the next visit shows the way to the Home Screen again.
  function useItHere() {
    try { sessionStorage.setItem(HERE_KEY, '1'); } catch (e) { /* then it is asked again after a reload */ }
    ui.gate = null;
    start(); window.scrollTo(0, 0);
    // Cloud sync was told to wait (see `unreadable` at the end of this file): it may go on now.
    const sync = window.__overloadSync;
    if (sync && sync.user && sync.pushNow) Promise.resolve(sync.pushNow()).catch(() => {});
  }

  // ---- Welcome: no data of Fuel's own yet -------------------------------------
  // Overload's saved data where it is in this same storage (an ordinary browser on a computer or an Android
  // phone), parsed, or null. Read only. Never used on an iPhone inside Overload: see 'inside' above.
  function readOverload() {
    try {
      const o = JSON.parse(localStorage.getItem(OVERLOAD_KEY), noProto);
      return isObj(o) && o.v === 1 && Array.isArray(o.exercises) ? o : null;
    } catch (e) { return null; }   // not there, or not readable: nothing to offer
  }
  // How much food it holds: { days, entries }, or null when there is none to bring. Counted once.
  function overloadHere() {
    if (ui.here !== null) return ui.here || null;
    ui.here = false;
    const o = readOverload();
    if (o) {
      const diary = isObj(o.diary) ? o.diary : {}, food = isObj(o.food) ? o.food : {};
      const days = Object.keys(diary).filter((k) => Array.isArray(diary[k]) && diary[k].length);
      const saved = ['foods', 'meals'].some((k) => isObj(food[k]) && Object.keys(food[k]).length);
      if (days.length || saved) ui.here = { days: days.length, entries: days.reduce((n, k) => n + diary[k].length, 0) };
    }
    return ui.here || null;
  }
  // One way in. `mark` goes in front: Overload's tile where the food comes from Overload, else an icon.
  function choiceRow(action, title, sub, first, mark) {
    return '<button class="list-item choice-card' + (first ? ' first' : '') + '" data-action="' + action + '">' + (mark || '') + '<div class="grow"><div class="title">' + title + '</div><div class="sub">' + sub + '</div></div><span class="chev">' + icon('chevron-right', 'm') + '</span></button>';
  }
  const OV_TILE = '<span class="app-tile l" data-app="overload">' + icon('mark-overload') + '</span>';
  const lead = (name) => '<span class="lead">' + icon(name) + '</span>';
  function hereRow(first) {
    const h = overloadHere();
    return h ? choiceRow('fuel-here', 'Bring it from Overload on this device', 'Found in this browser: ' + plural(h.days, 'day') + ', ' + plural(h.entries, 'entry', 'entries') + '.', first, OV_TILE) : '';
  }
  function renderWelcome() {
    markTabs(null);
    renderTopbar();
    const sync = window.__overloadSync, here = hereRow(true);
    $('#app').innerHTML = '<div class="onboard">' + BRAND + '<div class="screen-title"><h1>Welcome to ' + APP_NAME + '</h1></div>'
      // Not "in one step" for the sign-in: Overload's card says it may not bring all of the log (look reviewer).
      + '<p class="lede">' + APP_NAME + ' is the food half of Overload, now its own app. Paste your food log from Overload, or choose its file, and your days, targets, favorites and saved meals come across in one step. '
      + 'Signing in with the same email may bring some of it across, but not always all of it. Nothing is removed from Overload.</p>'
      + '<div class="list">' + here
      + choiceRow('fuel-paste', 'Paste from Overload', 'In Overload, tap Copy my food log. Then tap here.', !here, OV_TILE)
      + choiceRow('fuel-file', 'Choose a file', 'The food file, a full Overload backup, or a ' + APP_NAME + ' backup.', false, lead('file'))
      + choiceRow('fuel-signin', 'Sign in to cloud sync', sync && sync.user ? 'Signed in as ' + esc(sync.user.email) + '. Tap to go on.' : 'The same email and password as in Overload.', false, lead('cloud'))
      + '</div><div class="foot"><button class="btn text" data-action="fuel-fresh">Start fresh</button>'
      + '<p class="small muted">You can still bring your log across later, in Settings.</p></div></div>';
  }
  // He chose where to begin. From here on the app keeps its own data on this phone.
  function leaveWelcome() {
    if (!ui.welcome) return;
    ui.welcome = false; ui.screen = 'food';
    applyTheme();   // now also remembered for the next start
    if (!backupInfo().since) setBackupInfo({ since: Date.now() });
  }
  function startFresh() {
    leaveWelcome();
    const ok = save(); render();
    if (ok) toast('Ready. Tap + Add food to log your first meal.');
  }

  // ---- Trends ---------------------------------------------------------------
  // Read only: the last 14 days of calories against the target, and what a logged day came to on average
  // this week and last week. Today is still being eaten, so it shows as a bar but joins the averages tomorrow.
  function dayTotal(day) {
    const list = state.diary[day];
    if (!Array.isArray(list) || !list.length) return null;
    return list.reduce((t, e) => ({ kcal: t.kcal + e.kcal, p: t.p + e.p, c: t.c + e.c, f: t.f + e.f }), { kcal: 0, p: 0, c: 0, f: 0 });
  }
  // The average of the logged days among these; null when none is logged.
  function average(days) {
    const got = days.map(dayTotal).filter(Boolean), n = got.length;
    if (!n) return null;
    const s = got.reduce((t, x) => ({ kcal: t.kcal + x.kcal, p: t.p + x.p, c: t.c + x.c, f: t.f + x.f }), { kcal: 0, p: 0, c: 0, f: 0 });
    return { n, kcal: s.kcal / n, p: s.p / n, c: s.c / n, f: s.f / n };
  }
  // Bars take their colour from CSS (currentColor): .bar logged, .bar.over more than 5% over the target (the
  // diary's own rule), .bar.now today so far, .bar.none not logged. Each day is a button that opens it in Today.
  function trendChart(days, today, target) {
    const W = 320, H = 176, padL = 4, padR = target ? 46 : 4, padT = 14, padB = 28, r1 = (n) => Math.round(n * 10) / 10;
    const totals = days.map(dayTotal);
    const top = Math.max(target * 1.15, ...totals.map((t) => (t ? t.kcal : 0))) || 1;
    const bw = (W - padL - padR) / days.length, base = H - padB, y = (v) => padT + (1 - v / top) * (base - padT);
    const cols = days.map((day, i) => {
      const t = totals[i], x0 = r1(padL + i * bw + 2), w = r1(bw - 4), [yy, mm, dd] = day.split('-').map(Number);
      const letter = new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { weekday: 'narrow' });
      const label = fmtDate(day) + ': ' + (t ? fmtK(t.kcal) + ' kcal' : 'not logged');
      const cls = !t ? 'bar none' : day === today ? 'bar now' : target && t.kcal > target * 1.05 ? 'bar over' : 'bar';
      const bar = t ? '<rect class="' + cls + '" fill="currentColor" x="' + x0 + '" y="' + r1(y(t.kcal)) + '" width="' + w + '" height="' + r1(Math.max(1, base - y(t.kcal))) + '" rx="2"/>'
        : '<rect class="' + cls + '" fill="currentColor" x="' + x0 + '" y="' + (base - 3) + '" width="' + w + '" height="3" rx="1"/>';
      // cursor="pointer" is not decoration. Safari on an iPhone passes a tap on a shape like this on to the
      // page's click handler only when the shape counts as something to press; a pointer cursor makes it
      // count. (Buttons count by themselves. Not checked on a phone: keep it unless it has been.)
      return '<g class="trend-day" cursor="pointer" data-action="fuel-day" data-d="' + day + '" role="button" tabindex="0" aria-label="' + esc(label) + '. Open this day."><title>' + esc(label) + '</title>'
        + '<rect class="hit" fill="none" pointer-events="all" x="' + r1(padL + i * bw) + '" y="0" width="' + r1(bw) + '" height="' + H + '"/>' + bar
        + '<text class="lbl' + (day === today ? ' strong' : '') + '" x="' + r1(padL + i * bw + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(letter) + '</text></g>';
    }).join('');
    const line = target ? '<line class="target" stroke="currentColor" x1="' + padL + '" x2="' + (W - padR + 4) + '" y1="' + r1(y(target)) + '" y2="' + r1(y(target)) + '"/>'
      + '<text class="lbl target-lbl" x="' + W + '" y="' + r1(y(target) + 4.5) + '" text-anchor="end">' + fmtK(target) + '</text>' : '';
    return '<svg class="chart trend-chart" viewBox="0 0 ' + W + ' ' + H + '" role="group" aria-label="Calories per day, last 14 days">'
      + '<line class="axis" stroke="currentColor" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + base + '" y2="' + base + '"/>' + cols + line + '</svg>';
  }
  function renderTrends() {
    const today = todayKey(), t = state.food.targets, target = t.kcal > 0 ? t.kcal : 0;
    ui.trendsFor = today;   // the date this is drawn for: see redrawTrends
    const days = []; for (let i = 13; i >= 0; i--) days.push(addDays(today, -i));
    const week = (monday) => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
    const thisWeek = week(weekStart(today)).filter((d) => d <= today), lastWeek = week(addDays(weekStart(today), -7));
    const full = (list) => list.filter((d) => d < today);
    const all = average(full(days)), a = average(full(thisWeek)), b = average(lastWeek);
    const logged = (list) => list.filter((d) => dayTotal(d)).length;
    const g = (x) => (x == null ? '–' : fmtK(x));
    const of = (v, unit) => (v > 0 ? '<span class="of"> / ' + fmtK(v) + (unit || '') + '</span>' : '');
    const mk = (c) => '<i class="mk ' + c + '"></i>';   // the macro's own mark, as in the diary's summary
    const row = (k, label, av, bv) => '<tr data-k="' + k + '"><td>' + label + '</td><td class="r">' + av + '</td><td class="r prev">' + bv + '</td></tr>';
    const hero = all
      ? '<div class="trend-hero"><div><div class="label">Average a day, ' + plural(all.n, 'full day') + '</div><div><span class="f-big">' + fmtK(all.kcal) + '</span><span class="muted"> kcal</span></div></div>'
        + (target ? '<div class="side' + (all.kcal > target * 1.05 ? ' over' : '') + '"><b>' + Math.round(all.kcal / target * 100) + '%</b> of ' + fmtK(target) + ' target</div>' : '') + '</div>'
      : '<p class="muted mb8">No full day logged in the last 14 days yet.</p>';
    return '<div class="screen-title"><h1>Trends</h1><span class="sub">Last 14 days</span></div>'
      + '<div class="card">' + hero + trendChart(days, today, target)
      + '<div class="legend"><span><i class="swatch"></i>Logged</span>' + (target ? '<span><i class="swatch over"></i>Over target</span>' : '') + '<span><i class="swatch now"></i>Today so far</span></div></div>'
      + '<div class="group-title">Daily averages</div><div class="card"><table class="table trend-table"><thead><tr><th>Per logged day</th><th class="r">This week</th><th class="r">Last week</th></tr></thead><tbody>'
      + row('kcal', 'Calories' + of(t.kcal), g(a && a.kcal), g(b && b.kcal))
      + row('p', mk('p') + 'Protein' + of(t.protein, ' g'), g(a && a.p), g(b && b.p))
      + row('c', mk('c') + 'Carbs' + of(t.carbs, ' g'), g(a && a.c), g(b && b.c))
      + row('f', mk('f') + 'Fat' + of(t.fat, ' g'), g(a && a.f), g(b && b.f))
      + row('days', 'Days logged', logged(thisWeek) + '<span class="of"> of ' + thisWeek.length + '</span>', logged(lastWeek) + '<span class="of"> of 7</span>')
      + '</tbody></table></div>'
      + '<p class="tiny muted center mt8">Averages count full days only: today joins tomorrow. Weeks start on Monday. ' + (target ? 'A day is over target from 5% above it. ' : '') + 'Tap a day to open it.</p>';
  }
  // Trends left on screen past midnight, or found there in the morning (an iPhone resumes the app, it does not
  // reload it), would still show yesterday as today. It is drawn again for the new date, when the app comes back
  // to the front and once a minute, but not under an open sheet or a box being typed in.
  function redrawTrends() {
    if (shown() !== 'trends' || !ui.trendsFor || ui.trendsFor === todayKey() || ui.sheet) return;
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    render();
  }
  // Open one day in Today. food.js owns which day is on screen; its own day buttons are the way in:
  // first back to today, then that many days back.
  function openDay(day) {
    const F = window.__overloadFood, today = todayKey();
    if (!isDate(day) || day > today) return;
    ui.screen = 'food';
    if (F) { F.click('food-day', { d: '0' }); const back = daysBetween(day, today); if (back > 0) F.click('food-day', { d: String(-back) }); }
    else render();
    window.scrollTo(0, 0);
  }

  // ---- Settings ------------------------------------------------------------
  function renderSettings() {
    const s = state.settings, F = window.__overloadFood, bw = state.bodyweight[0];
    const seg = (action, list, on) => '<div class="seg">' + list.map(([v, label]) => '<button class="' + (on === v ? 'on' : '') + '" data-action="' + action + '" data-v="' + v + '">' + label + '</button>').join('') + '</div>';
    return '<div class="screen-title"><h1>Settings</h1></div>'
      + (F ? F.settingsCard() : '')
      + '<div class="group-title">You</div><div class="card">'
      + '<div class="toggle-row"><div><div>Body weight</div><div class="small muted">Only used for the protein guide under the targets</div></div><div class="row tight"><input class="input num" type="number" inputmode="decimal" step="any" min="0" placeholder="–" value="' + (bw ? esc(bw.weight) : '') + '" data-field="fuel-bw" aria-label="Body weight"><span class="muted">' + s.units + '</span></div></div>'
      + '<div class="toggle-row"><div><div>Units</div><div class="small muted">For body weight</div></div>' + seg('fuel-units', [['lb', 'lb'], ['kg', 'kg']], s.units) + '</div>'
      + '<div class="toggle-row"><div><div>Appearance</div><div class="small muted">System follows your phone</div></div>' + seg('set-theme', [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']], s.theme || 'system') + '</div>'
      + '</div>'
      + renderBackupCard()
      + renderCloudCard()
      + '<div class="group-title">From Overload</div><div class="card"><p class="small muted mb8">' + movedText() + '</p>'
      + '<button class="btn ghost block" data-action="fuel-import">' + icon('clipboard') + 'Bring food from Overload</button></div>'
      + '<div class="group-title">Danger zone</div><div class="card"><button class="btn danger block" data-action="reset">' + icon('trash') + 'Reset all data</button></div>'
      + '<div class="group-title">About</div><div class="card" id="about-card"><p><b>' + APP_NAME + '</b> · v' + VERSION + '</p>' + offlineNote() + '<p class="small muted mt8">Food data: USDA FoodData Central, Open Food Facts.</p></div>';
  }
  function movedText() {
    const m = state.moved;
    if (!m || !(m.at > 0)) return 'The food log you kept in Overload can be brought here at any time. ' + ADDS_ONLY;
    return 'Brought across on ' + esc(fmtDate(todayKey(new Date(m.at)))) + ': ' + plural(+m.days || 0, 'day') + ', ' + plural(+m.entries || 0, 'entry', 'entries') + '. ' + ADDS_ONLY;
  }
  // What bringing the food log from Overload changes, said the same way here, in the import sheet and (for any
  // file) on the Backup card (review finding look#4: the favorite stars were left out here).
  const ADDS_ONLY = 'Only what is missing here is added, with the favorite stars and the numbers you corrected in Overload. Nothing else is replaced or removed.';
  // The guide under the targets is food.js's. After a change here only that note is drawn again: rebuilding
  // the boxes would lose the tap on the next one.
  function refreshTargetNote() {
    const F = window.__overloadFood; if (!F) return;
    const tmp = document.createElement('div'); tmp.innerHTML = F.settingsCard();
    const note = $('.f-target-note', tmp);
    if (note) document.querySelectorAll('#app .f-target-note').forEach((n) => { n.innerHTML = note.innerHTML; });
  }
  function setBodyWeight(el) {
    const v = Math.round(num(el.value, 0) * 10) / 10;
    state.bodyweight = v > 0 ? [{ date: todayKey(), weight: v }] : [];
    el.value = v > 0 ? v : '';
    save(); refreshTargetNote();
  }
  // The stored weight is a number in the chosen unit, so it is converted with it (183.6 lb is 83.3 kg).
  function setUnits(units) {
    if (units !== 'lb' && units !== 'kg' || units === state.settings.units) return;
    const bw = state.bodyweight[0];
    if (bw) bw.weight = Math.round((units === 'kg' ? bw.weight / 2.20462 : bw.weight * 2.20462) * 10) / 10;
    state.settings.units = units;
    save(); render();
  }

  function cloudBody() {
    const sync = window.__overloadSync;
    // The sync module has not loaded (its files did not arrive: a start without signal before they were stored), or not yet.
    if (!sync) return '<p class="small muted">Cloud sync is not available right now. It starts when the app opens with signal. Your food log stays on this phone.</p>';
    if (sync.user) {
      const st = ui.sync;
      return '<div class="toggle-row"><div><div>Signed in</div><div class="small muted">' + esc(sync.user.email) + '</div></div><span class="pill cloud-status ' + esc(st.status) + '" id="cloud-status">' + esc(st.msg || 'Connected') + '</span></div>'
        + '<p class="small muted mt8">Every change is mirrored to your account. Offline changes are queued and sent when you are back online.</p>'
        + '<div class="btn-row mt12"><button class="btn ghost" data-action="cloud-push">' + icon('sync') + 'Sync now</button><button class="btn subtle" data-action="cloud-signout">Sign out</button></div>';
    }
    return '<p class="small muted mb8">Sign in to keep your food log in the cloud so it survives clearing this phone and follows you to a new one. Use the same email and password as in Overload: the food log that account holds comes across the first time. New here? Enter an email and a password and tap Create account.</p>'
      + '<form id="cloud-form"><div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="username" inputmode="email" required aria-label="Email"></div>'
      + '<div class="field"><label>Password</label><input class="input" name="password" type="password" autocomplete="current-password" required aria-label="Password"></div>'
      + '<div id="cloud-msg" class="small mb8 cloud-msg"></div>'
      + '<div class="btn-row"><button class="btn" type="submit">Sign in</button><button class="btn ghost" type="button" data-action="cloud-signup">Create account</button></div>'
      + '<button class="btn subtle block mt8" type="button" data-action="cloud-reset">Forgot password</button></form>';
  }
  function renderCloudCard() { return '<div id="cloud-card"><div class="group-title">Cloud sync</div><div class="card">' + cloudBody() + '</div></div>'; }
  // The same card in a sheet, for Welcome (which has no Settings yet).
  function sheetCloud() { openSheet(sheetHeader('Cloud sync') + '<div id="cloud-card" class="in-sheet">' + cloudBody() + '</div>', 'cloud'); }

  async function cloudAction(kind) {
    const sync = window.__overloadSync; if (!sync) return;
    const form = $('#cloud-form'); const msg = $('#cloud-msg');
    const email = form ? form.elements.email.value : ''; const password = form ? form.elements.password.value : '';
    const say = (t) => { if (msg) msg.textContent = t; else toast(t); };
    try {
      if (kind === 'signin') { if (!email || !password) return say('Enter your email and password.'); await sync.signIn(email, password); signedIn('Signed in'); }
      if (kind === 'signup') { if (!email || !password) return say('Enter an email and a password of at least 6 characters.'); await sync.createAccount(email, password); signedIn('Account created'); }
      if (kind === 'reset') { if (!email) return say('Enter your email first.'); await sync.resetPassword(email); say('Reset email sent. Check your inbox.'); }
      // What a sign-in after this does: sync.js keeps its note (marked signed out), so what was logged meanwhile is
      // sent; a Reset or Restore meanwhile removes the note (forgetCloudIfSignedOut), so the account's copy comes
      // back (review finding look#1). An import only adds, and keeps the note: what it added is sent.
      if (kind === 'signout') { if (confirm('Sign out? Your food log stays on this phone and in the cloud. What you log while signed out is sent when you sign back in. A Reset or Restore done while signed out is not: signing in again brings back what the account holds.')) { await sync.signOut(); toast('Signed out'); } }
      if (kind === 'push') { await sync.pushNow(); toast('Sync requested'); }
    } catch (e) { say(e.message || 'Something went wrong.'); }
  }
  // Signing in from Welcome is a way to begin: its sheet closes, the diary opens, and what the account holds
  // arrives through setState (before or after this: either order ends the same).
  function signedIn(text) {
    if ($('#cloud-card.in-sheet')) closeSheet();
    if (ui.welcome) { leaveWelcome(); save(); render(); }
    toast(text);
  }

  // ---------------------------------------------------------------------------
  // Sheets (food.js opens its own through these)
  // ---------------------------------------------------------------------------
  // A sheet is a dialog (#sheet-panel in index.html: role="dialog", aria-modal, named by the title, which gets the id
  // sheet-heading). While one is open the page behind it is inert; focus moves to its title when it opens, Escape
  // closes it, and closing gives focus back to what opened it (drawn again by then, often). Touch sees none of it: a
  // focus moved here after a touch draws no ring (data-quiet-focus), scrolls nothing, and never goes to a text box
  // (that would bring up the keyboard). The training app's sheet code (overload.js) is the same.
  const sheetNav = { keys: false, tapped: null, opener: null };
  const BEHIND = 'body > .topbar, body > #save-warning, body > #app, body > .tabbar';
  const typingBox = (el) => !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
    || (el.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(el.type)));
  // Keys or touch: keys are Tab, or a key pressed outside a text box (the phone's own keyboard types in boxes too).
  // <html class="keys"> gives the page its scroll padding (shared/ui.css), so Tab never stops under a bar.
  function usingKeys(on) {
    if (sheetNav.keys === on) return;
    sheetNav.keys = on; document.documentElement.classList.toggle('keys', on);
    if (on) document.querySelectorAll('[data-quiet-focus]').forEach((el) => el.removeAttribute('data-quiet-focus'));
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' || (!typingBox(e.target) && !/^(Shift|Control|Alt|Meta|CapsLock|Fn)$/.test(e.key))) usingKeys(true);
    if (e.key === 'Escape' && ui.sheet && !e.isComposing) { e.preventDefault(); closeSheet(); }
    if (e.key === 'Tab' && ui.sheet) tabRound(e);
  }, true);
  // Tab goes round inside the open sheet: from its last control to its first, and with Shift from the first (or the
  // title) to the last.
  function tabRound(e) {
    const panel = $('#sheet-panel'), a = document.activeElement;
    const all = [...panel.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    if (!all.length) return;
    const i = all.indexOf(a), inside = panel.contains(a);
    if (e.shiftKey ? !inside || i <= 0 : !inside || i === all.length - 1) { e.preventDefault(); (e.shiftKey ? all[all.length - 1] : all[0]).focus(); }
  }
  // A touch is a pointerdown (no touchstart listener: the page had none, and one can change how a tap looks on iOS).
  ['pointerdown', 'mousedown'].forEach((type) => document.addEventListener(type, () => usingKeys(false), true));
  // What was tapped last outside a sheet: on an iPhone a tapped button does not take focus, so this is what opened it.
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('button, a[href], input, select, textarea, [tabindex], [data-action]');
    if (t && !t.closest('#sheet')) sheetNav.tapped = t;
  }, true);
  function quietFocus(el) {
    if (!sheetNav.keys) { el.setAttribute('data-quiet-focus', ''); el.addEventListener('blur', () => el.removeAttribute('data-quiet-focus'), { once: true }); }
    el.focus({ preventScroll: !sheetNav.keys });
  }
  // The control in the opener's place after a redraw: the same tag with the same data-… attributes.
  function drawnAgain(el) {
    const keys = Object.keys(el.dataset).filter((k) => k !== 'quietFocus'); if (!keys.length) return null;
    return document.querySelector(el.tagName.toLowerCase() + keys.map((k) => '[data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + '="' + CSS.escape(el.dataset[k]) + '"]').join(''));
  }
  function focusBack(el) {
    const a = document.activeElement;
    if (ui.sheet || (a && a !== document.body && !a.closest('#sheet'))) return;   // a sheet again, or focus went somewhere on purpose
    if (!el.isConnected) el = drawnAgain(el);
    if (!el || !el.getClientRects().length || el.closest('[inert]') || (!sheetNav.keys && typingBox(el))) return;
    quietFocus(el);
  }
  // Tab inside a sheet never stops under its sticky footer (.sheet-foot, the amount sheet's Add) or a strip that sticks
  // at its top (#food-added in the Add sheet): their heights go to --sheet-foot-h and --sheet-head-h on the panel, which
  // shared/ui.css makes the panel's scroll padding while keys are used. Measured when the sheet is drawn, and again when
  // one of them changes size. The training app's is the same.
  let sheetEdgeWatch = null;
  function sheetEdges(panel) {
    if (sheetEdgeWatch) { sheetEdgeWatch.disconnect(); sheetEdgeWatch = null; }
    const stuck = [...panel.querySelectorAll(':scope > *, :scope > form > *')].filter((el) => getComputedStyle(el).position === 'sticky');
    const foot = stuck.find((el) => getComputedStyle(el).bottom !== 'auto'), head = stuck.find((el) => getComputedStyle(el).top !== 'auto');
    const measure = () => {
      panel.style.setProperty('--sheet-foot-h', (foot && foot.isConnected ? foot.offsetHeight : 0) + 'px');
      panel.style.setProperty('--sheet-head-h', (head && head.isConnected ? head.offsetHeight : 0) + 'px');
    };
    measure();
    if ((foot || head) && typeof ResizeObserver === 'function') { sheetEdgeWatch = new ResizeObserver(measure); [foot, head].forEach((el) => { if (el) sheetEdgeWatch.observe(el); }); }
  }
  function openSheet(html, key) {
    // key names what the sheet shows (for example 'meal:' + id); without one the title does.
    const panel = $('#sheet-panel'), fresh = $('#sheet').hidden, was = panel.dataset.sheet;
    const hadFocus = !fresh && panel.contains(document.activeElement);
    if (fresh) {
      const a = document.activeElement, t = sheetNav.tapped;
      sheetNav.opener = a && a !== document.body && !panel.contains(a) && (sheetNav.keys || !typingBox(a)) ? a : t && t.isConnected ? t : null;
    }
    ui.sheet = true; panel.innerHTML = html; $('#sheet').hidden = false; document.body.style.overflow = 'hidden';
    const h = panel.querySelector('.sheet-title h2'), now = key != null ? 'k:' + key : 't:' + (h ? h.textContent : '');
    panel.dataset.sheet = now;
    sheetEdges(panel);
    // A new sheet starts at its top, also when it replaces another one;
    // redrawing the open one (a renamed meal) keeps its place.
    if (fresh || was !== now) panel.scrollTop = 0;
    if (h) { h.id = 'sheet-heading'; h.tabIndex = -1; }
    // Into the sheet when it opens; after a redraw only when keys are in use and the focus went with the old content.
    // A box marked autofocus is where keys go; after a touch the browser handles it as it always did, so focus is not
    // moved for it.
    const auto = panel.querySelector('[autofocus]');
    if (fresh || (hadFocus && sheetNav.keys && !panel.contains(document.activeElement))) {
      if (auto) { if (sheetNav.keys) quietFocus(auto); } else if (h) quietFocus(h);
    }
    if (fresh) document.querySelectorAll(BEHIND).forEach((el) => { el.inert = true; });
  }
  // Every way of closing a sheet comes through here: food.js turns the camera off and ends its Add trip on the event.
  function closeSheet() {
    ui.sheet = null; $('#sheet').hidden = true; $('#sheet-panel').innerHTML = ''; document.body.style.overflow = '';
    sheetEdges($('#sheet-panel'));   // nothing sticks now: 0 px, and nothing is watched
    document.querySelectorAll(BEHIND).forEach((el) => { el.inert = false; });
    const opener = sheetNav.opener; sheetNav.opener = null;
    if (opener) setTimeout(() => focusBack(opener), 0);   // after the redraw that usually follows (save, then render)
    document.dispatchEvent(new CustomEvent('overload:sheetclose'));
  }
  function sheetHeader(title, extra) { return '<div class="sheet-title"><h2>' + title + '</h2><div class="row">' + (extra || '') + '<button class="icon-btn" data-action="sheet-close" aria-label="Close">' + icon('close') + '</button></div></div>'; }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------
  let toastHandle = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    // Long messages stay longer (about 55 ms a character, 2.2 to 6 s) so they can be read.
    clearTimeout(toastHandle); toastHandle = setTimeout(() => { t.hidden = true; }, Math.min(6000, Math.max(2200, String(msg).length * 55)));
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  // On iPhone the share sheet is the reliable way out of a home-screen app (Save to Files, AirDrop, Mail).
  async function exportJson() {
    if (await shareFile(JSON.stringify(state, null, 2), 'fuel-backup-' + todayKey() + '.json', APP_NAME + ' backup')) exported();
  }
  // Resolves true when the file was handed over: the share sheet took it, or, with no share sheet, the download
  // started. False when he cancelled the share sheet, and when the phone would not open it: a second share while
  // one is open is refused (InvalidStateError), and so is one that no tap of his started (NotAllowedError). A
  // download then would count as saved while nothing may be. A second tap while the share sheet is open does
  // nothing. Any other failure of the sheet still offers the download, but does not count it, as it cannot be
  // told whether a file came of it (Overload's shareFile does the same).
  async function shareFile(text, name, title) {
    // A sheet opened in the last minute is still open (a second share() would be refused); after that a tap is
    // let through, so a sheet that never answers cannot block saving for the rest of the session (review finding code#1).
    if (ui.sharing && Date.now() - ui.sharing < 60000) return false;
    let file = null, canShare = false;
    try { file = new File([text], name, { type: 'application/json' }); canShare = !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { canShare = false; }
    if (canShare) {
      const mine = ui.sharing = Date.now();
      try { await navigator.share({ files: [file], title }); return true; }
      catch (e) { if (e && (e.name === 'AbortError' || e.name === 'InvalidStateError' || e.name === 'NotAllowedError')) return false; }
      finally { if (ui.sharing === mine) ui.sharing = 0; }
      download(text, name);
      return false;
    }
    download(text, name);
    return true;
  }
  function download(text, name) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function exported() {
    setBackupInfo({ lastExport: Date.now() });
    const el = $('#last-export'); if (el) el.textContent = lastExportText();
    refreshNotices();
  }

  // ---- Saved data that could not be read at start ----
  function renderUnreadable() {
    markTabs(null);
    renderTopbar();
    const raw = ui.unreadable.raw;
    $('#app').innerHTML = '<div class="screen-title"><h1>Your data</h1></div>'
      + '<div class="card"><p><b>' + APP_NAME + ' could not read the data saved on this phone.</b></p>'
      + '<p class="small muted mt8">' + (raw ? 'Nothing has been changed or deleted. Save a copy of it first, then choose what to do.' : 'The phone did not let the app read its storage. Try again first.') + '</p>'
      // One row: where the two labels do not fit side by side (a phone) it breaks, and each button takes a full line.
      + '<div class="btn-row mt12">' + (raw ? '<button class="btn" data-action="unreadable-export">' + icon('export') + 'Export the unreadable copy</button>' : '')
      + '<button class="btn ghost" data-action="unreadable-retry">Try again</button></div></div>'
      + '<div id="restore-section" hidden><div class="group-title">Restore an automatic copy</div><div class="card"><div id="safety-copies"></div></div></div>'
      + '<div class="group-title">Start fresh</div><div class="card"><p class="small muted mb8">An empty food diary. If you used cloud sync, your cloud copy comes back once you are signed in.</p>'
      + '<button class="btn danger block" data-action="unreadable-fresh">' + icon('trash') + 'Start fresh</button></div>';
    fillCopies(true);
  }
  // He chose: the data now in memory is the app's again. Sync starts over with a full download and merge.
  function leaveUnreadable() {
    const raw = ui.unreadable && ui.unreadable.raw;
    ui.unreadable = null;
    const sync = window.__overloadSync;
    if (sync && sync.user && sync.pushNow) Promise.resolve(sync.pushNow()).catch(() => {});
    // The hidden copy takes room from the app: drop it once the automatic copy of the same text is confirmed.
    const B = window.__overloadBackup;
    if (raw && B) B.get('before-unreadable').then((c) => { if (c && c.text === raw) { try { localStorage.removeItem(STORAGE_KEY + '.bak'); } catch (e) { /* ignore */ } } }, () => {});
  }
  async function unreadableAction(a, d) {
    const raw = ui.unreadable && ui.unreadable.raw;
    if (a === 'unreadable-retry') { location.reload(); return; }
    if (a === 'unreadable-export') { if (raw) shareFile(raw, 'fuel-unreadable-' + todayKey() + '.json', APP_NAME + ' data that could not be read'); return; }
    if (a === 'export-copy') {
      const B = window.__overloadBackup; let c = null;
      try { c = B && await B.get(d.id); } catch (e) { c = null; }
      if (c) shareFile(c.text, 'fuel-unreadable-' + todayKey(new Date(c.at)) + '.json', APP_NAME + ' data that could not be read'); else toast('Could not read that copy');
      return;
    }
    if (a === 'unreadable-fresh') {
      if (!ui.unreadable) return;
      let kept = false;
      try { const c = raw && window.__overloadBackup && await window.__overloadBackup.get('before-unreadable'); kept = !!(c && c.text === raw); } catch (e) { kept = false; }
      const msg = !raw ? 'Start fresh? The app could not read its storage, so it cannot tell what is there. Starting fresh replaces it.'
        : 'Start fresh with an empty food diary?\n\n' + (kept ? 'The data that could not be read stays in Settings > Automatic copies, where you can export it.' : 'Export the unreadable copy first if you might need it: it is not kept anywhere else.');
      if (!confirm(msg)) return;
      state = freshState();
      leaveUnreadable();
      applyTheme(); const ok = save(); ui.screen = 'food'; render(); toast(ok ? 'Started fresh' : NOT_SAVED);
    }
  }
  // Signed in to cloud sync, as far as Reset, Restore and the export reminder go: { email } (email may be '') or null.
  // Once the sync module has said who is signed in (syncChanged, which sync.js calls at each sign-in and sign-out and
  // once at every start, when Firebase first answers), its word counts. Before that (its files are slow to come, or
  // this start has no signal; or the module has loaded and Firebase has not answered yet), a note that names an
  // account and is not marked signed out (sync.js marks it) counts as signed in: it stays, and the next link sends the
  // reset or restore (review findings sync#2, data#5), as Overload's cloudAccount does.
  function cloudAccount() {
    const sync = window.__overloadSync;
    if (sync && sync.user) return { email: sync.user.email || '' };
    if (sync && ui.authSeen) return null;
    const note = syncNote();
    return note ? { email: typeof note.email === 'string' ? note.email : '' } : null;
  }
  function syncNote() {
    try { const n = JSON.parse(localStorage.getItem(SYNC_KEY)); return isObj(n) && typeof n.uid === 'string' && n.uid && !n.signedOut ? n : null; } catch (e) { return null; }
  }
  // Signed out, a reset or restore must not keep the note of what the cloud holds: the next sign-in would treat
  // everything missing here as deleted and remove it from the cloud. Without the note, sign-in merges the cloud back.
  function forgetCloudIfSignedOut() {
    if (!cloudAccount()) { try { localStorage.removeItem(SYNC_KEY); } catch (e) { /* ignore */ } }
  }
  // Signed in, but cloud sync has not read the account yet (sync.js `linked`: the first read from the server is under
  // way, or failed and is tried again). A Reset, Restore or import now would be undone without a word: once the read
  // works, the first link merges the account's data back over it, and the account is not changed (review finding
  // sync#6). So none of them starts, and the toast says when they can, in Overload's words. A phone that linked
  // before (it has a note) is linked at once, offline too. A sync module of another release has no `linked` and
  // holds nothing up. Not on the unreadable-data screen: nothing syncs there.
  function cloudStillReading() {
    const sync = window.__overloadSync;
    if (ui.unreadable || !sync || !sync.user || sync.linked !== false) return false;
    toast('Cloud sync is still reading your account. Try again once it says Synced.');
    return true;
  }
  // Signed in, a reset or restore syncs out and replaces the cloud copy too. Say so, and what another phone
  // signed in to the account does: it follows (sync.js), except for what was logged or changed on it since it
  // last synced, which it keeps and sends back. Signing it out is not enough: it sends that at its next sign-in.
  // Reset there while signed out, and its next sign-in takes the account's copy instead.
  function cloudNote(verb) {
    const acct = cloudAccount();
    if (!acct) return '';
    const email = acct.email;
    return '\n\nYou are signed in to cloud sync, so the food log in your account' + (email ? ' (' + email + ')' : '') + ' is ' + verb + ' too. '
      + 'Another phone signed in to this account does the same, except for what was logged or changed on it since it last synced: that comes back. To be sure nothing comes back, sign out on that phone first, and reset it before you sign in there again.';
  }
  async function resetAll() {
    if (ui.replacing || cloudStillReading()) return;
    // Everything it erases is named (review finding look#5), as Overload's Reset now names its settings and link.
    if (!confirm('Erase the food diary, saved foods, saved meals, targets and settings in ' + APP_NAME + ' on this phone, body weight, units and theme included?\n\nThis phone now: ' + dataSummary(state) + '.' + cloudNote('erased'))) return;
    if (!confirm('Really erase everything in ' + APP_NAME + '?' + (cloudNote('erased') ? ' Export a backup first if you might want it back.' : ' The latest copy stays in Settings > Automatic copies.'))) return;
    ui.replacing = true;
    try {
      // The copy "Before reset" is stored first (the second question promises it): if it cannot be, nothing is erased.
      const c = await copyFirst('reset');
      if (c !== 'kept') { notDone(c, 'Reset all data', 'erased'); return; }
      forgetCloudIfSignedOut();
      state = freshState(); applyTheme(); save(); render(); toast('Reset: the food diary is empty');
    } finally { ui.replacing = false; }
  }

  // ---------------------------------------------------------------------------
  // Bringing food in: from Overload (a pasted text, its food file, a full backup, or its data in this same
  // storage) and from a Fuel backup. An import never removes: it adds what is missing here.
  //   entries        by day and id; an entry Fuel already has on that day stays as Fuel has it
  //   meals          by id; Fuel's stay
  //   foods          by id; Fuel's stay, and take two things from the copy: the star when Fuel's has none, and
  //                  numbers he corrected or typed in (src custom) over the food list's own copy (src usda or off).
  //                  A food made or corrected in Fuel is never changed; its last use and last amount stay Fuel's.
  //                  Not the star of a food whose star he took off in Fuel (deleted.fav), and not a correction of
  //                  his that he deleted in Fuel (deleted.custom), also after the food list's copy was logged again.
  //   targets, body weight   only when Fuel has none
  //   units, theme   only at Welcome, when Fuel has nothing of its own yet
  //   deleted here   stays deleted (the deletion records)
  // From Overload's settings only units and theme are ever read, by name: its connector key is a secret.
  // The first cloud sign-in to an account Fuel has never written to brings Overload's copy by the same rules
  // (addFromOverload in sync.js): a change to one is a change to both, or the two ways in stop agreeing
  // (tests/fuel-sync.js, run "rules").
  // ---------------------------------------------------------------------------
  const NOT_FOOD = 'That is not a food log from Overload or a ' + APP_NAME + ' backup.';
  const CUT_OFF = 'The text is cut off or damaged, so it cannot be read. Copy it again in Overload, or use Save as a file there and choose that file here.';
  function fail(msg) { const e = new Error(msg); e.said = true; return e; }   // an error whose message is meant for him

  function bytesFromBase64(b64) {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  // What a pasted text or a file's text holds, parsed. The text is JSON itself (a file), or the clipboard
  // form: OVERLOAD-FOOD:1: + base64 of the gzipped JSON, or OVERLOAD-FOOD:0: + base64 of the JSON, both as
  // UTF-8 bytes. Rejects with a message for him; never anything else.
  async function decodeFoodText(text) {
    const t = String(text == null ? '' : text).replace(/^﻿/, '').trim();
    if (!t) throw fail('There is nothing to read. In Overload, tap Copy my food log first.');
    if (t[0] === '{') {
      try { return JSON.parse(t, noProto); } catch (e) { throw fail(CUT_OFF); }
    }
    const m = /^OVERLOAD-FOOD:([^:]*):/.exec(t);
    if (!m) throw fail(t.indexOf(TEXT_PREFIX.slice(0, 8)) === 0 ? CUT_OFF : NOT_FOOD);
    if (m[1] !== '0' && m[1] !== '1') throw fail('This food log was copied by a newer version of Overload than this ' + APP_NAME + ' knows. Update ' + APP_NAME + ' and try again.');
    try {
      let bytes = bytesFromBase64(t.slice(m[0].length).replace(/\s+/g, ''));
      if (m[1] === '1') {
        if (!window.DecompressionStream) throw fail('This browser cannot open the compressed copy. In Overload, use Save as a file and choose that file here.');
        bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      }
      const o = JSON.parse(new TextDecoder().decode(bytes), noProto);
      if (!isObj(o)) throw fail(NOT_FOOD);
      return o;
    } catch (e) { throw e && e.said ? e : fail(CUT_OFF); }
  }
  // The food part of what was read, as a small state of its own (cleaned like any other), with where it came
  // from. `how`: { here: true } for Overload's data in this storage, { madeAt } for a file's date.
  function incomingFrom(o, how) {
    how = how || {};
    if (!isObj(o)) throw fail(NOT_FOOD);
    const pick = (x) => (isObj(x) ? x : {});
    const two = (s) => ({ units: pick(s).units, theme: pick(s).theme });   // the only two settings ever read from Overload
    let kind, from, madeAt = null, src;
    if (o.app === 'fuel') {
      if (o.v !== 1) throw fail('That file was made by a newer version of ' + APP_NAME + '. Update ' + APP_NAME + ' and try again.');
      kind = 'fuel'; from = APP_NAME + ' backup';
      src = { settings: two(o.settings), food: o.food, diary: o.diary, deleted: { food: pick(o.deleted).food, foods: pick(o.deleted).foods, meals: pick(o.deleted).meals, fav: pick(o.deleted).fav, custom: pick(o.deleted).custom }, bodyweight: o.bodyweight, moved: o.moved };
    } else if (o.kind === 'overload-food') {
      if (o.v !== 1) throw fail('This food log was made by a newer version of Overload than this ' + APP_NAME + ' knows. Update ' + APP_NAME + ' and try again.');
      kind = 'payload'; from = typeof o.from === 'string' && o.from ? o.from.slice(0, 40) : 'Overload';
      madeAt = cleanNum(o.madeAt);
      src = { settings: two(o.settings), food: o.food, diary: o.diary, deleted: { food: pick(o.deleted).food }, bodyweight: o.bodyweight };
    } else if (o.v === 1 && Array.isArray(o.exercises) && o.kind == null) {
      // A full Overload backup (or its saved data itself): the food part only. normalize keeps the latest weigh-in.
      kind = 'backup'; from = how.here ? 'Overload on this device' : 'Overload backup';
      src = { settings: two(o.settings), food: o.food, diary: o.diary, deleted: { food: pick(o.deleted).food }, bodyweight: o.bodyweight };
    } else throw fail(NOT_FOOD);
    if (typeof madeAt !== 'number') madeAt = how.here ? Date.now() : typeof how.madeAt === 'number' ? how.madeAt : null;
    const rep = { badDays: 0, badEntries: 0, fixed: 0, noMeal: 0 };
    const st = normalize(Object.assign({ v: 1 }, src), rep);
    const days = Object.keys(st.diary);
    return { kind, from, madeAt, rep, state: st, days: days.length, entries: days.reduce((n, d) => n + st.diary[d].length, 0),
      foods: Object.keys(st.food.foods).length, meals: Object.keys(st.food.meals).length };
  }
  // What bringing it in would add, worked out against what Fuel holds now. Changes nothing.
  function planImport(inc) {
    const st = state, from = inc.state, gone = st.deleted;
    const p = { days: {}, addDays: 0, addEntries: 0, sameEntries: 0, goneEntries: 0, foods: [], sameFoods: 0, goneFoods: 0, meals: [], sameMeals: 0, goneMeals: 0,
      updated: [], targets: false, weight: null, settings: null, records: { food: {}, foods: {}, meals: {}, fav: {}, custom: {} }, moved: null };
    // An entry is already here when Fuel holds its id on the same day. Before v2.5 an entry edited across
    // midnight was kept on both days under one id, and v2.8 shows both. Deletion records go by id alone.
    const here = new Set(), held = new Set();   // day + id of every entry here; the ids alone
    const dayId = (day, id) => day + '#' + id;
    Object.keys(st.diary).forEach((d) => st.diary[d].forEach((e) => { here.add(dayId(d, e.id)); held.add(e.id); }));
    Object.keys(from.diary).forEach((day) => {
      const add = from.diary[day].filter((e) => {
        if (gone.food[e.id]) { p.goneEntries++; return false; }   // deleted here: it does not come back
        if (here.has(dayId(day, e.id))) { p.sameEntries++; return false; }    // already here: Fuel's copy stays
        here.add(dayId(day, e.id)); held.add(e.id); return true;
      });
      if (add.length) { p.days[day] = add; p.addDays++; p.addEntries += add.length; }
    });
    // A saved food both hold: Fuel's stays, and takes the star when it has none. When the copy's is one he
    // corrected or typed in (src custom) and Fuel's is the food list's own, untouched (src usda or off), the
    // copy's numbers, serving and barcode are taken: the whole food as he made it. A food made or corrected
    // in Fuel (src custom) is never changed. Fuel's last use and last amount always stay.
    // The copy's star only for a food whose star he never took off in Fuel (review finding data#3), and his
    // correction only when he did not delete it in Fuel (data#4): logging the food list's copy again afterwards
    // does not bring that correction back, and neither does a food Fuel no longer holds.
    const unstarred = isObj(gone.fav) ? gone.fav : {}, uncorrected = isObj(gone.custom) ? gone.custom : {};
    Object.keys(from.food.foods).forEach((id) => {
      const mine = st.food.foods[id], theirs = from.food.foods[id];
      if (gone.foods[id]) { p.goneFoods++; return; }
      if (!mine) { if (theirs.src === 'custom' && own(uncorrected, id)) p.goneFoods++; else p.foods.push(id); return; }
      const fav = !mine.fav && !!theirs.fav && !own(unstarred, id), fix = theirs.src === 'custom' && (mine.src === 'usda' || mine.src === 'off') && !own(uncorrected, id);
      if (fav || fix) p.updated.push({ id, fav, fix }); else p.sameFoods++;
    });
    Object.keys(from.food.meals).forEach((id) => {
      if (gone.meals[id]) p.goneMeals++; else if (st.food.meals[id]) p.sameMeals++; else p.meals.push(id);
    });
    const set = (t) => ['kcal', 'protein', 'carbs', 'fat'].some((k) => t[k] > 0);
    p.targets = !set(st.food.targets) && set(from.food.targets);
    const w = from.bodyweight[0];
    if (!st.bodyweight.length && w) {
      // The number is in the unit of where it comes from. At Welcome that unit comes along; later Fuel keeps its own.
      const same = ui.welcome || from.settings.units === st.settings.units;
      p.weight = { date: w.date, weight: same ? w.weight : Math.round((st.settings.units === 'kg' ? w.weight / 2.20462 : w.weight * 2.20462) * 10) / 10 };
    }
    if (ui.welcome) p.settings = { units: from.settings.units, theme: from.settings.theme };
    // Its deletion records come along too (a later cloud sign-in must not bring back what was deleted in
    // Overload), except for anything Fuel holds: that stays, so it must not be marked as deleted.
    Object.keys(from.deleted.food).forEach((id) => { if (!held.has(id) && !gone.food[id]) p.records.food[id] = from.deleted.food[id]; });
    ['foods', 'meals'].forEach((kind) => Object.keys(from.deleted[kind]).forEach((id) => {
      if (!st.food[kind][id] && !gone[kind][id] && p[kind].indexOf(id) < 0) p.records[kind][id] = from.deleted[kind][id];
    }));
    // A Fuel backup's records of stars taken off and of corrections deleted come along as well (an Overload copy
    // has none), except a star's for a food starred here: that star stands.
    MORE_RECORDS.forEach((kind) => Object.keys(isObj(from.deleted[kind]) ? from.deleted[kind] : {}).forEach((id) => {
      const mine = st.food.foods[id];
      if (!own(kind === 'fav' ? unstarred : uncorrected, id) && !(kind === 'fav' && mine && mine.fav)) p.records[kind][id] = from.deleted[kind][id];
    }));
    if (inc.kind === 'fuel') { if (!st.moved && from.moved) p.moved = from.moved; }
    else p.moved = { from: inc.from, at: Date.now(), days: inc.days, entries: inc.entries, madeAt: inc.madeAt };
    p.adds = !!(p.addEntries || p.foods.length || p.updated.length || p.meals.length || p.targets || p.weight);
    p.quiet = Object.keys(p.records).some((k) => Object.keys(p.records[k]).length);   // bookkeeping only: nothing he would see
    return p;
  }
  const commas = (list) => list.filter(Boolean).join(', ');
  // The question before anything is added: what the copy holds, what is new, what stays as it is.
  function importQuestion(inc, p, how) {
    const last = state.moved, rep = inc.rep;
    const lines = ['Bring this food log into ' + APP_NAME + '?', '',
      'From: ' + inc.from + (how.here || !inc.madeAt ? '' : (inc.kind === 'payload' ? ', made ' : ', file dated ') + fmtWhen(inc.madeAt)) + '.',
      'It holds ' + commas([plural(inc.days, 'day'), plural(inc.entries, 'entry', 'entries'), plural(inc.foods, 'saved food'), plural(inc.meals, 'saved meal')]) + '.', ''];
    const added = commas([p.addEntries && plural(p.addEntries, 'entry', 'entries') + ' on ' + plural(p.addDays, 'day'), p.foods.length && plural(p.foods.length, 'saved food'),
      p.meals.length && plural(p.meals.length, 'saved meal'), p.targets && 'the daily targets', p.weight && 'your body weight']);
    if (added) lines.push('New here: ' + added + '.');
    const fixes = p.updated.some((u) => u.fix);
    if (p.updated.length) {
      lines.push(plural(p.updated.length, 'saved food') + ' updated from ' + (inc.kind === 'fuel' ? 'the backup' : 'Overload') + ': '
        + commas([p.updated.some((u) => u.fav) && 'the favorite star', fixes && 'your corrected numbers']) + '.');
    }
    const same = commas([p.sameEntries && plural(p.sameEntries, 'entry', 'entries'), p.sameFoods && plural(p.sameFoods, 'saved food'), p.sameMeals && plural(p.sameMeals, 'saved meal')]);
    if (same) lines.push('Already in ' + APP_NAME + ', left as they are: ' + same + '.');
    const gone = commas([p.goneEntries && plural(p.goneEntries, 'entry', 'entries'), p.goneFoods && plural(p.goneFoods, 'saved food'), p.goneMeals && plural(p.goneMeals, 'saved meal')]);
    if (gone) lines.push('Deleted in ' + APP_NAME + ', not brought back: ' + gone + '.');
    const bad = importNotes(rep);
    if (bad) lines.push('', bad);
    if (inc.kind !== 'fuel' && last && typeof last.madeAt === 'number' && typeof inc.madeAt === 'number' && inc.madeAt <= last.madeAt) {
      lines.push('', 'Note: this copy is not newer than the one you brought in on ' + fmtDate(todayKey(new Date(last.at || last.madeAt))) + '. If you logged food in Overload since, make a new copy there first.');
    }
    lines.push('', 'Nothing ' + (fixes ? 'else ' : '') + 'in ' + APP_NAME + ' is replaced or removed.' + (ui.welcome ? '' : ' A copy of what ' + APP_NAME + ' holds now is kept first.'));
    return lines.join('\n');
  }
  // What could not be read in the copy, in words.
  function importNotes(rep) {
    return [rep.badDays && plural(rep.badDays, 'day') + ' left out: ' + (rep.badDays === 1 ? 'its name is not a date.' : 'their names are not dates.'),
      rep.badEntries && plural(rep.badEntries, 'entry', 'entries') + ' left out: not readable.',
      rep.fixed && plural(rep.fixed, 'entry', 'entries') + ' had numbers that could not be read: those count as 0.',
      rep.noMeal && plural(rep.noMeal, 'entry', 'entries') + ' named no meal: ' + (rep.noMeal === 1 ? 'it is' : 'they are') + ' under Snacks.'].filter(Boolean).join(' ');
  }
  // An import's new deletion records into a state. fav and custom are made only when a record of theirs comes.
  function keepRecords(st, records) {
    Object.keys(records).forEach((k) => { if (Object.keys(records[k]).length) st.deleted[k] = Object.assign(st.deleted[k] || {}, records[k]); });
  }
  // The copy "Before import" of what Fuel held is stored before this runs (importFrom).
  function applyImport(inc, p) {
    const st = state, from = inc.state;
    Object.keys(p.days).forEach((day) => { st.diary[day] = (st.diary[day] || []).concat(p.days[day]); });
    // A food new here comes without the copy's star when he took that star off here before (it left Fuel since).
    p.foods.forEach((id) => {
      let f = from.food.foods[id];
      if (f.fav && isObj(st.deleted.fav) && own(st.deleted.fav, id)) { f = Object.assign({}, f); delete f.fav; }
      st.food.foods[id] = f;
    });
    // Saved foods both hold (planImport says which and why): the star, or his corrected copy in place of the
    // food list's, with Fuel's last use, last amount and star kept (the copy's star only where planImport takes it).
    p.updated.forEach((u) => {
      const mine = st.food.foods[u.id], theirs = from.food.foods[u.id];
      if (!u.fix) { mine.fav = true; return; }
      const f = Object.assign({}, theirs);
      delete f.used; delete f.last; delete f.fav;
      if ('used' in mine) f.used = mine.used;
      if ('last' in mine) f.last = mine.last;
      if (mine.fav || u.fav) f.fav = true;
      st.food.foods[u.id] = f;
    });
    p.meals.forEach((id) => { st.food.meals[id] = from.food.meals[id]; });
    if (p.targets) ['kcal', 'protein', 'carbs', 'fat'].forEach((k) => { st.food.targets[k] = from.food.targets[k]; });
    if (p.settings) { st.settings.units = p.settings.units; st.settings.theme = p.settings.theme; }
    if (p.weight) st.bodyweight = [p.weight];
    keepRecords(st, p.records);
    if (p.moved) st.moved = p.moved;
    leaveWelcome();
    applyTheme();
    const ok = save();
    // The same goes straight into today's automatic copy: the food log is now in two places on this phone.
    ui.copyDue = false; safetyCopy('day', true, JSON.stringify(st));
    return ok;
  }
  // One import from start to finish. `get` gives the parsed data (or rejects with a message for him).
  async function importFrom(get, how) {
    if (ui.unreadable || ui.gate || ui.importing || cloudStillReading()) return;   // review finding sync#6
    ui.importing = true;
    try {
      const inc = incomingFrom(await get(), how), p = planImport(inc);
      if (!p.adds) {
        // Nothing he would see. Deletion records that are new are still kept, quietly; at Welcome nothing begins.
        if (p.quiet && !ui.welcome) { keepRecords(state, p.records); save(); }
        const none = inc.entries || inc.foods || inc.meals ? 'Nothing new: everything in this copy is already in ' + APP_NAME + ', or was deleted here.' : 'That copy holds no food.';
        importSaid(none + (importNotes(inc.rep) ? ' ' + importNotes(inc.rep) : ''));
        return;
      }
      if (!confirm(importQuestion(inc, p, how || {}))) return;
      // What Fuel holds now goes into the copy "Before import" first, as the question said: it is the way back
      // from an import that was a mistake. If it cannot be stored, nothing is added. (At Welcome there is
      // nothing to keep a copy of.)
      if (!ui.welcome) {
        const c = await copyFirst('import');
        if (c === 'failed') { sheetImport({ msg: copyFailedText('brought in'), backup: true }); return; }
        if (c === 'changed') { importSaid('The food log changed just now. Nothing was brought in.'); return; }
      }
      const ok = applyImport(inc, p);
      if (ui.sheet) closeSheet();
      render(); window.scrollTo(0, 0);
      if (ok) {
        let brought = commas([p.addEntries && plural(p.addEntries, 'entry', 'entries') + ' on ' + plural(p.addDays, 'day'), p.foods.length && plural(p.foods.length, 'saved food'), p.meals.length && plural(p.meals.length, 'saved meal')]);
        if (!brought && (p.targets || p.weight)) brought = 'your targets';
        toast([brought && 'Brought in ' + brought + '.', p.updated.length && 'Updated ' + plural(p.updated.length, 'saved food') + '.'].filter(Boolean).join(' '));
      }
    } catch (e) {
      if (!(e && e.said)) console.error(e);
      importSaid(e && e.said ? e.message : 'That could not be read. Nothing was changed.');
    } finally { ui.importing = false; }
  }
  const importText = (text, how) => importFrom(() => decodeFoodText(text), how);
  function importFile(file) {
    importFrom(() => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(decodeFoodText(r.result));
      r.onerror = () => reject(fail('That file could not be read.'));
      r.readAsText(file);
    }), { madeAt: file.lastModified });
  }
  // Overload's data in this same storage, read as it is now (it may have changed since Welcome counted it).
  function importHere() {
    importFrom(() => { const o = readOverload(); return o ? Promise.resolve(o) : Promise.reject(fail('Overload has no food log in this browser.')); }, { here: true });
  }
  // Paste from Overload: the clipboard is read on the tap. An iPhone shows a small Paste bubble first; where
  // reading is refused or missing, the sheet offers a box to paste into instead.
  async function pasteFromOverload() {
    if (cloudStillReading()) return;   // before the clipboard is read (an iPhone shows its Paste bubble for that)
    let text = null;
    try { if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText(); } catch (e) { text = null; }
    if (text == null) { sheetImport({ box: true, msg: APP_NAME + ' could not read the clipboard here. Paste the copied text into the box below.' }); return; }
    if (!String(text).trim()) { sheetImport({ box: true, msg: 'The clipboard is empty. In Overload, tap Copy my food log, then come back and tap Paste from Overload.' }); return; }
    importText(text);
  }
  // A message about an import: in the import sheet (opened if need be), where it stays until he has read it.
  function importSaid(msg) { sheetImport({ box: !!$('#fuel-paste'), msg }); }
  function sheetImport(opts) {
    opts = opts || {};
    openSheet(sheetHeader('Bring food from Overload')
      + (opts.msg ? '<div class="banner warn" id="fuel-import-msg" role="alert">' + icon('warning') + '<span>' + esc(opts.msg) + '</span></div>' : '')
      + (opts.backup ? '<button class="btn block mb8" data-action="export">' + icon('export') + 'Export backup</button>' : '')   // the copy could not be kept: a backup first
      + '<p class="small muted mb8">In Overload, open the card "Food has moved to ' + APP_NAME + '" and tap Copy my food log, or Save as a file. Then come back here. ' + ADDS_ONLY + '</p>'
      + '<div class="list">' + hereRow(false)
      + choiceRow('fuel-paste', 'Paste from Overload', 'Reads the food log you copied in Overload.', false, OV_TILE)
      + choiceRow('fuel-file', 'Choose a file', 'The food file, a full Overload backup, or a ' + APP_NAME + ' backup.', false, lead('file')) + '</div>'
      + (opts.box ? '<form id="fuel-paste-form" class="mt16"><div class="field"><label for="fuel-paste">Or paste the copied text here</label>'
        + '<textarea class="input" id="fuel-paste" name="text" data-field="fuel-paste" rows="3" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="OVERLOAD-FOOD:…"></textarea></div>'
        + '<button class="btn block" type="submit">Bring it in</button></form>'
        : '<button class="btn subtle block mt12" data-action="fuel-paste-box">Paste into a box instead</button>'), 'import');
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  // Bubbling listeners on document: food.js's own capturing listener swallows the stray second tap after an
  // Add before it gets here.
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) { ui.screen = tab.dataset.screen; render(); window.scrollTo(0, 0); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const a = btn.dataset.action, d = btn.dataset;
    if (a.startsWith('food-')) { if (window.__overloadFood) window.__overloadFood.click(a, d, btn); return; }

    switch (a) {
      case 'reload': location.reload(); break;
      case 'sheet-close': closeSheet(); break;

      // Where it runs, Welcome
      case 'fuel-use-here': useItHere(); break;
      case 'fuel-copy-link':
        Promise.resolve().then(() => navigator.clipboard.writeText(fuelAddress())).then(() => toast('Link copied. Open Safari and paste it.'), () => toast('Could not copy. The address is written under the button.'));
        break;
      case 'fuel-fresh': startFresh(); break;
      case 'fuel-signin': { const sync = window.__overloadSync; if (sync && sync.user) signedIn('Signed in'); else sheetCloud(); break; }

      // Bringing food in
      case 'fuel-import': sheetImport(); break;
      case 'fuel-paste': pasteFromOverload(); break;
      case 'fuel-paste-box': sheetImport({ box: true }); break;
      case 'fuel-file': case 'import': if (!cloudStillReading()) $('#import-file').click(); break;   // review finding sync#6
      case 'fuel-here': importHere(); break;

      // Trends
      case 'fuel-day': openDay(d.d); break;

      // Settings
      case 'set-theme': state.settings.theme = d.v; applyTheme(); save(); render(); break;
      case 'fuel-units': setUnits(d.v); break;
      case 'export': exportJson(); break;
      case 'restore-copy': restoreCopy(d.id); break;
      case 'export-copy': case 'unreadable-export': case 'unreadable-retry': case 'unreadable-fresh': unreadableAction(a, d); break;
      case 'export-nag-off': setBackupInfo({ nagOff: Date.now() }); refreshNotices(); break;
      case 'reset': resetAll(); break;

      // Cloud
      case 'goto-settings': ui.screen = 'settings'; render(); window.scrollTo(0, 0); break;
      case 'cloud-signup': cloudAction('signup'); break;
      case 'cloud-reset': cloudAction('reset'); break;
      case 'cloud-signout': cloudAction('signout'); break;
      case 'cloud-push': cloudAction('push'); break;
    }
  });
  // A day of the Trends chart is a drawn button, not a real one: Enter and Space press it.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const day = e.target.closest && e.target.closest('.trend-day');
    if (day) { e.preventDefault(); openDay(day.dataset.d); }
  });

  document.addEventListener('submit', (e) => {
    if (/^food-/.test(e.target.id || '')) { e.preventDefault(); if (window.__overloadFood) window.__overloadFood.submit(e.target); return; }
    if (e.target.closest('#cloud-form')) { e.preventDefault(); cloudAction('signin'); return; }
    if (e.target.id === 'fuel-paste-form') { e.preventDefault(); importText(e.target.elements.text.value); }
  });

  document.addEventListener('input', (e) => {
    const el = e.target; const f = el.dataset.field; if (!f) return;
    if (f.startsWith('food-')) { if (window.__overloadFood) window.__overloadFood.input(el, f); }
  });

  document.addEventListener('change', (e) => {
    const el = e.target; const f = el.dataset.field;
    if (el.id === 'import-file') { if (el.files[0]) { importFile(el.files[0]); el.value = ''; } return; }
    if (!f) return;
    if (f.startsWith('food-')) { if (window.__overloadFood) window.__overloadFood.change(el, f); return; }
    if (f === 'fuel-bw') setBodyWeight(el);
  });
  // Pasting into the box: the text is taken from the paste itself. Letting the box show a whole food log
  // (hundreds of thousands of characters) can stall a phone.
  document.addEventListener('paste', (e) => {
    const el = e.target;
    if (!el || !el.dataset || el.dataset.field !== 'fuel-paste') return;
    const text = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (!text) return;   // nothing to take: the box gets whatever the browser pastes, and "Bring it in" reads that
    e.preventDefault();
    importText(text);
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  // Everything that stores something or reaches out waits in start(): held at "Add to Home Screen" the app
  // only draws that screen, and "Use it here anyway" starts it.
  function start() {
    applyTheme();
    if (ui.unreadable) { if (ui.unreadable.raw) safetyCopy('unreadable', true, ui.unreadable.raw); }
    else if (!ui.welcome) save();
    if (!ui.welcome && !backupInfo().since) setBackupInfo({ since: Date.now() });
    render();
    ui.booted = true;
    if (!ui.unreadable && !ui.welcome) safetyCopy('day');
    // Ask the browser to keep this app's storage when the phone runs low on space (no question is shown on iPhone).
    try { navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {}); } catch (e) { /* not available */ }
    startWorker();
  }

  // The offline copy (sw.js, next to this page) and its updates.
  let workerStarted = false;
  function startWorker() {
    if (workerStarted || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
    workerStarted = true;
    const sw = navigator.serviceWorker, mine = new URL('./sw.js', location.href).href;
    // Is the worker in control Fuel's own? Where both apps share a storage, the training app's worker (one
    // folder up, wider scope) controls this page until Fuel's has installed. That one does not count: when
    // Fuel's worker takes over from it, nothing about this page is out of date.
    const ours = () => !!(sw.controller && String(sw.controller.scriptURL).split(/[?#]/)[0] === mine);
    // When a new worker of this app takes over, reload once so the new files are what is running.
    // Everything is saved on every change, so this is safe.
    let had = ours(), reloading = false;
    sw.addEventListener('controllerchange', () => {
      const before = had; had = ours() || had;
      if (reloading || !before) return;
      // While typing, a reload could eat what is in the box; with a sheet open it would close what he is in
      // the middle of (an Add trip, an import). Offer it instead.
      const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (typing || ui.sheet) { ui.updateReady = true; renderTopbar(); return; }
      reloading = true; location.reload();
    });
    // The registration object is kept: getRegistration() would give the training app's while its worker controls this page.
    const watch = (w) => { if (w) w.addEventListener('statechange', refreshOffline); };
    const register = () => sw.register('./sw.js', { updateViaCache: 'none' }).then((r) => {
      if (!r) throw new Error('no registration');
      const fresh = r !== swReg;
      swReg = r; swKnown = true;
      r.update().catch(() => {});
      if (fresh) {
        r.addEventListener('updatefound', () => {
          const nw = r.installing; if (!nw) return;
          watch(nw);
          nw.addEventListener('statechange', () => { if (nw.state === 'installed' && ours()) toast('Updating…'); });
        });
        watch(r.installing); watch(r.waiting);
      }
      refreshOffline();
    }).catch(() => { swKnown = true; refreshOffline(); });
    register();
    // Also look for updates whenever the app comes back to the foreground. A first install that failed (one of
    // its files did not arrive) leaves no registration behind, and update() on the one kept here then fetches
    // nothing: register again instead, or the app would not open offline until a cold start with signal.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (!swReg || !(swReg.active || swReg.waiting || swReg.installing)) register();
      else swReg.update().catch(() => {});
    });
  }
  // Fuel's own registration, once register() has answered (swKnown), whatever it answered.
  let swReg = null, swKnown = false;
  // Settings says so while the app cannot open without signal: until its own worker is active (that worker
  // keeps the offline copy). Nothing is said where there is no worker at all (a file, a browser without one).
  function offlineNote() {
    if (!workerStarted || !swKnown || (swReg && swReg.active)) return '';
    return swReg && (swReg.installing || swReg.waiting)
      ? '<div class="banner mt12" id="offline-note">' + icon('sync') + '<span>Getting ready to work offline…</span></div>'
      : '<div class="banner warn mt12" id="offline-note">' + icon('cloud-off') + '<span>Not ready to work offline yet. Open ' + APP_NAME + ' again with good signal.</span></div>';
  }
  // The note in place, as the worker moves on (Settings is not redrawn for it: that would lose what is being typed).
  function refreshOffline() {
    const html = offlineNote(), el = $('#offline-note'), about = $('#about-card');
    if (el) { if (html) el.outerHTML = html; else el.remove(); }
    else if (html && about && about.firstElementChild) about.firstElementChild.insertAdjacentHTML('afterend', html);
  }

  state = load();
  ui.gate = gateNow();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  // Going to the background (or being closed): today's automatic copy takes in what was logged since.
  // Back in front: Trends follows the date.
  document.addEventListener('visibilitychange', () => { if (document.hidden) refreshDayCopy(); else redrawTrends(); });
  setInterval(redrawTrends, 60000);
  window.addEventListener('pagehide', refreshDayCopy);
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) { /* ignore */ }

  // For food.js and sync.js (and console debugging). The names are the ones Overload offers (overload.js).
  window.__overload = {
    get state() { return state; },
    get screen() { return shown(); },   // 'food' exactly while the diary is what #app shows
    get saveFailed() { return !!ui.saveFailed; },
    // Sync waits while the stored data could not be read, and while the app is held at "Add to Home Screen"
    // (it runs on no data of its own then, possibly in another app's storage).
    get unreadable() { return !!(ui.unreadable || ui.gate); },
    // Did this page start on saved data? Cloud sync believes its note of what the account holds only then. It
    // cannot look for itself: it runs after its imports from another host arrive, which can take seconds, and
    // by then Start fresh (or an import) may have saved new data.
    get startedWithData() { return startedWithData; },
    safetyCopy,
    setState, save, render,
    // What food.js is built on
    lib: { $, esc, uid, num, todayKey, addDays, fmtDate, openSheet, closeSheet, sheetHeader, toast, markDeleted },
    // Sync status: only the top-bar pill and the status text in Settings change. Redrawing the screen here
    // would throw away whatever is being typed in Settings (it changes twice for every upload).
    setSyncStatus(status, msg) {
      ui.sync = { status, msg: msg || '' };
      const pill = $('.sync-pill');
      if (pill && status !== 'off') { pill.className = 'pill sync-pill ' + status; pill.innerHTML = syncIcon(status); pill.setAttribute('aria-label', 'Cloud sync: ' + status); pill.title = ui.sync.msg; }
      else renderTopbar();
      const cs = $('#cloud-status'); if (cs) { cs.textContent = ui.sync.msg || 'Connected'; cs.className = 'pill cloud-status ' + status; }
    },
    // Signed in or out: redraw the pill and the Cloud sync card only, not the screen.
    syncChanged() {
      if (window.__overloadSync) ui.authSeen = true;   // the module has said who is signed in (cloudAccount)
      renderTopbar();
      const card = $('#cloud-card');
      if (card) {
        const tmp = document.createElement('div');
        tmp.innerHTML = card.classList.contains('in-sheet') ? '<div id="cloud-card" class="in-sheet">' + cloudBody() + '</div>' : renderCloudCard();
        if (!card.isEqualNode(tmp.firstElementChild)) card.replaceWith(tmp.firstElementChild);
      }
      refreshNotices();   // the export reminder depends on cloud sync
      if (ui.welcome && !ui.gate && !ui.sheet) render();   // Welcome says whether he is signed in
    }
  };

  if (ui.gate) { applyTheme(); render(); } else start();
})();
