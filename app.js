/* Overload — personal hypertrophy tracker.
 * Vanilla JS, no build step. All data lives in localStorage on this device.
 * The Food tab lives in food.js, which plugs in through window.__overloadFood.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const STORAGE_KEY = 'overload.state.v1';
  const SYNC_KEY = 'overload.sync.v1';   // cloud sync's note of what the cloud holds (sync.js)
  const BACKUP_KEY = 'overload.backup';  // { since, lastExport, nagOff } (ms): this phone only, never synced
  // How much the app can count on saving. The iPhone's real limit is not measured; this is a safe guess.
  const STORE_LIMIT = 2500000;
  const VERSION = '2.8';
  const MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs'];
  const EQUIPMENT = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Other'];
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const SORENESS = ['Never got sore', 'Healed a while ago', 'Healed just in time', 'Still sore'];
  const PUMP = ['Low / none', 'Moderate', 'Amazing'];
  const JOINT = ['None', 'A little', 'Moderate', 'A lot'];
  const WORKLOAD = ['Easy', 'Pretty good', 'Pushed my limits', 'Too much'];

  // Built-in library: [name, muscle, equipment]
  const LIBRARY = [
    ['Flat Barbell Bench Press', 'Chest', 'Barbell'],
    ['Incline Barbell Bench Press', 'Chest', 'Barbell'],
    ['Flat Dumbbell Press', 'Chest', 'Dumbbell'],
    ['Incline Dumbbell Press', 'Chest', 'Dumbbell'],
    ['Machine Chest Press', 'Chest', 'Machine'],
    ['Pec Deck', 'Chest', 'Machine'],
    ['Cable Fly', 'Chest', 'Cable'],
    ['Dips', 'Chest', 'Bodyweight'],
    ['Push-Ups', 'Chest', 'Bodyweight'],
    ['Lat Pulldown', 'Back', 'Cable'],
    ['Pull-Ups', 'Back', 'Bodyweight'],
    ['Chin-Ups', 'Back', 'Bodyweight'],
    ['Seated Cable Row', 'Back', 'Cable'],
    ['Chest-Supported Row', 'Back', 'Machine'],
    ['Barbell Row', 'Back', 'Barbell'],
    ['One-Arm Dumbbell Row', 'Back', 'Dumbbell'],
    ['T-Bar Row', 'Back', 'Machine'],
    ['Straight-Arm Pulldown', 'Back', 'Cable'],
    ['Deadlift', 'Back', 'Barbell'],
    ['Overhead Press', 'Shoulders', 'Barbell'],
    ['Seated Dumbbell Shoulder Press', 'Shoulders', 'Dumbbell'],
    ['Machine Shoulder Press', 'Shoulders', 'Machine'],
    ['Dumbbell Lateral Raise', 'Shoulders', 'Dumbbell'],
    ['Cable Lateral Raise', 'Shoulders', 'Cable'],
    ['Rear Delt Fly', 'Shoulders', 'Machine'],
    ['Face Pull', 'Shoulders', 'Cable'],
    ['Upright Row', 'Shoulders', 'Cable'],
    ['Barbell Curl', 'Biceps', 'Barbell'],
    ['Dumbbell Curl', 'Biceps', 'Dumbbell'],
    ['Incline Dumbbell Curl', 'Biceps', 'Dumbbell'],
    ['Hammer Curl', 'Biceps', 'Dumbbell'],
    ['Preacher Curl', 'Biceps', 'Machine'],
    ['Cable Curl', 'Biceps', 'Cable'],
    ['Triceps Pushdown', 'Triceps', 'Cable'],
    ['Overhead Triceps Extension', 'Triceps', 'Cable'],
    ['Skull Crushers', 'Triceps', 'Barbell'],
    ['Close-Grip Bench Press', 'Triceps', 'Barbell'],
    ['Dumbbell Kickback', 'Triceps', 'Dumbbell'],
    ['Assisted Dips', 'Triceps', 'Machine'],
    ['Back Squat', 'Quads', 'Barbell'],
    ['Front Squat', 'Quads', 'Barbell'],
    ['Leg Press', 'Quads', 'Machine'],
    ['Hack Squat', 'Quads', 'Machine'],
    ['Leg Extension', 'Quads', 'Machine'],
    ['Bulgarian Split Squat', 'Quads', 'Dumbbell'],
    ['Walking Lunge', 'Quads', 'Dumbbell'],
    ['Romanian Deadlift', 'Hamstrings', 'Barbell'],
    ['Dumbbell Romanian Deadlift', 'Hamstrings', 'Dumbbell'],
    ['Lying Leg Curl', 'Hamstrings', 'Machine'],
    ['Seated Leg Curl', 'Hamstrings', 'Machine'],
    ['Good Morning', 'Hamstrings', 'Barbell'],
    ['Hip Thrust', 'Glutes', 'Barbell'],
    ['Glute Bridge', 'Glutes', 'Barbell'],
    ['Cable Kickback', 'Glutes', 'Cable'],
    ['Standing Calf Raise', 'Calves', 'Machine'],
    ['Seated Calf Raise', 'Calves', 'Machine'],
    ['Leg Press Calf Raise', 'Calves', 'Machine'],
    ['Cable Crunch', 'Abs', 'Cable'],
    ['Hanging Leg Raise', 'Abs', 'Bodyweight'],
    ['Machine Crunch', 'Abs', 'Machine'],
    ['Plank', 'Abs', 'Bodyweight']
  ];

  // Additions after v1 shipped. Existing saves pick these up once via normalize().
  const LIBRARY_V2 = [
    // Newtech machine line, plate-loaded and cable pieces.
    ['Newtech Lat Pulldown', 'Back', 'Machine'],
    ['Newtech Seated Row (Inward grip)', 'Back', 'Machine'],
    ['Newtech Seated Row (Outward grip)', 'Back', 'Machine'],
    ['Plate-Loaded High Row', 'Back', 'Machine'],
    ['Plate-Loaded Low Row', 'Back', 'Machine'],
    ['Plate-Loaded Iso-Lateral Row', 'Back', 'Machine'],
    ['Plate-Loaded Lat Pulldown', 'Back', 'Machine'],
    ['Machine Pullover', 'Back', 'Machine'],
    ['Cable Pullover (rope)', 'Back', 'Cable'],
    ['Wide-Grip Lat Pulldown', 'Back', 'Cable'],
    ['Close-Grip Lat Pulldown (V-bar)', 'Back', 'Cable'],
    ['Single-Arm Cable Row', 'Back', 'Cable'],
    ['Machine Biceps Curl', 'Biceps', 'Machine'],
    ['EZ-Bar Curl', 'Biceps', 'Barbell'],
    ['Cable Bayesian Curl', 'Biceps', 'Cable'],
    ['Spider Curl', 'Biceps', 'Dumbbell'],
    ['Concentration Curl', 'Biceps', 'Dumbbell'],
    ['Reverse Curl', 'Biceps', 'Barbell'],
    ['Cable Rope Hammer Curl', 'Biceps', 'Cable']
  ];
  const LIB_VERSION = 2;
  const ONE_OFF_DAY = { name: 'Back & Biceps', exercises: ['Newtech Lat Pulldown', 'Newtech Seated Row (Outward grip)', 'Plate-Loaded High Row', 'Straight-Arm Pulldown', 'EZ-Bar Curl', 'Incline Dumbbell Curl', 'Preacher Curl', 'Cable Rope Hammer Curl'] };

  // Default program: Mon chest/back, Tue legs, Wed shoulders/arms, repeat Thu-Sat, Sun rest.
  const DEFAULT_DAYS = [
    { name: 'Chest & Back', exercises: ['Incline Dumbbell Press', 'Flat Barbell Bench Press', 'Cable Fly', 'Lat Pulldown', 'Chest-Supported Row', 'Seated Cable Row'] },
    { name: 'Legs', exercises: ['Back Squat', 'Romanian Deadlift', 'Leg Press', 'Lying Leg Curl', 'Leg Extension', 'Standing Calf Raise'] },
    { name: 'Shoulders & Arms', exercises: ['Seated Dumbbell Shoulder Press', 'Dumbbell Lateral Raise', 'Rear Delt Fly', 'Barbell Curl', 'Triceps Pushdown', 'Incline Dumbbell Curl', 'Overhead Triceps Extension'] }
  ];
  const DEFAULT_SCHEDULE = [0, 1, 2, 0, 1, 2, null]; // indexes into DEFAULT_DAYS, Mon..Sun

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const $ = (sel, el) => (el || document).querySelector(sel);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const round = (n, step) => Math.round(n / step) * step;
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

  function todayKey(d) {
    d = d || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  // A date range for the backup questions and the copy list. Years show when it is not all this year.
  function fmtRange(a, b, weekday) {
    const yr = String(new Date().getFullYear()), years = String(a).slice(0, 4) !== yr || String(b).slice(0, 4) !== yr;
    const f = (key) => { const [y, m, d] = String(key).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, Object.assign({ month: 'short', day: 'numeric' }, years ? { year: 'numeric' } : weekday ? { weekday: 'short' } : {})).replace(/ /g, '\u00a0'); };   // each date stays on one line
    return f(a) + ' – ' + f(b);
  }
  function weekdayIndex(d) { return ((d || new Date()).getDay() + 6) % 7; } // Mon=0..Sun=6
  function fmtDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function daysBetween(a, b) { const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5); }
  function addDays(key, n) { const [y, m, d] = key.split('-').map(Number); return todayKey(new Date(y, m - 1, d + n)); }
  function weekStart(key) { const [y, m, d] = key.split('-').map(Number); const dt = new Date(y, m - 1, d); return addDays(key, -((dt.getDay() + 6) % 7)); }
  function e1rm(w, r) { return w * (1 + r / 30); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function fmtW(n) { return (Math.round(n * 100) / 100).toString(); }
  function fmtTime(sec) { const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let state = null;

  function defaultSettings() {
    return { units: 'lb', increment: 2.5, repMin: 10, repMax: 12, restSec: 120, maxSets: 6, defaultSets: 3, theme: 'system', trackRir: true, weighEvery: 1, volumeMin: 10, volumeMax: 20, warmupRest: 45, incDumbbell: 5, incMachine: 5, incCable: 5, cardioOn: true, cardioMin: 20, cardioName: 'Incline treadmill walk', sleepOn: true, checkinV: 1 };
  }

  function seedState() {
    const s = { v: 1, settings: defaultSettings(), exercises: [], presc: {}, program: { days: [], schedule: [null, null, null, null, null, null, null] }, workouts: [], active: null, bodyweight: [], sleep: [], templates: [] };
    const byName = {};
    LIBRARY.forEach(([name, muscle, equipment]) => {
      const ex = { id: uid(), name, muscle, equipment, increment: null, repMin: null, repMax: null, custom: false };
      s.exercises.push(ex);
      byName[name] = ex.id;
    });
    DEFAULT_DAYS.forEach((d) => {
      s.program.days.push({ id: uid(), name: d.name, exercises: d.exercises.map((n) => byName[n]).filter(Boolean) });
    });
    s.program.schedule = DEFAULT_SCHEDULE.map((i) => (i == null ? null : s.program.days[i].id));
    s.libVersion = 1;
    return normalize(s);
  }

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return seedState();   // first start: nothing saved yet
      const parsed = JSON.parse(raw);
      if (parsed && parsed.v === 1) {
        return normalize(parsed);
      }
    } catch (e) { /* fall through */ }
    // Saved data that cannot be read (damaged, or written by a newer version): never save over it. Keep a copy,
    // forget what cloud sync knew (a later sign-in then downloads instead of deleting), and let him choose.
    ui.unreadable = { raw };
    if (raw) { try { localStorage.setItem(STORAGE_KEY + '.bak', raw); } catch (e) { /* ignore */ } }
    try { localStorage.removeItem(SYNC_KEY); } catch (e) { /* ignore */ }
    return seedState();   // in memory only, so the app can run; nothing is saved until he chooses
  }
  // ---- Values from a backup file or the cloud: the right type, so nothing can show up as page markup ----
  const BAD_KEY = /^(__proto__|constructor|prototype)$/;
  const noProto = (k, v) => (BAD_KEY.test(k) ? undefined : v);   // JSON.parse reviver for imported files
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  function dropBadKeys(o) { if (isObj(o)) Object.keys(o).forEach((k) => { if (BAD_KEY.test(k)) delete o[k]; }); }
  // Numbers stay numbers, numeric text becomes a number, null / '' stay as they are (they mean "not set"); anything else is dropped.
  function cleanNum(v) {
    if (v == null || v === '') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    return typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null;
  }
  const numFields = (o, keys) => { if (isObj(o)) keys.forEach((k) => { if (k in o) o[k] = cleanNum(o[k]); }); };
  // Ids are made of letters and digits; anything else is replaced the same way everywhere, so references still match.
  function cleanId(v) {
    if (v == null) return v;
    const s = String(v).replace(/[^A-Za-z0-9_.:-]/g, '_');
    return s in Object.prototype ? 'x' + s : s;   // "constructor", "toString"… would reach built-in objects
  }
  const idField = (o, k) => { if (k in o) o[k] = cleanId(o[k]); };   // only where the field exists: older saves stay as they are
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const inList = (v, list) => (list.includes(v) ? v : String(v == null ? '' : v).replace(/[<>&"']/g, ''));
  const objects = (list) => (Array.isArray(list) ? list.filter(isObj) : []);
  function cleanValues(st) {
    const s = st.settings, d = defaultSettings();
    ['increment', 'incDumbbell', 'incMachine', 'incCable', 'repMin', 'repMax', 'restSec', 'warmupRest', 'defaultSets', 'maxSets', 'volumeMin', 'volumeMax', 'weighEvery', 'cardioMin', 'checkinV']
      .forEach((k) => { const v = cleanNum(s[k]); s[k] = typeof v === 'number' ? v : d[k]; });
    if (s.units !== 'lb' && s.units !== 'kg') s.units = 'lb';
    if (!['system', 'dark', 'light'].includes(s.theme)) s.theme = 'system';
    st.exercises = objects(st.exercises);
    st.exercises.forEach((e) => { idField(e, 'id'); if ('muscle' in e) e.muscle = inList(e.muscle, MUSCLES); if ('equipment' in e) e.equipment = inList(e.equipment, EQUIPMENT); numFields(e, ['increment', 'repMin', 'repMax', 'restSec', 'fixedSets']); });
    if (Object.keys(st.presc).some((k) => cleanId(k) !== k || !isObj(st.presc[k]))) {
      const p = {}; Object.keys(st.presc).forEach((k) => { if (isObj(st.presc[k])) p[cleanId(k)] = st.presc[k]; }); st.presc = p;
    }
    Object.keys(st.presc).forEach((k) => numFields(st.presc[k], ['weight', 'targetReps', 'sets', 'updatedAt']));
    const cleanDay = (dy) => { idField(dy, 'id'); dy.exercises = (Array.isArray(dy.exercises) ? dy.exercises : []).map(cleanId); return dy; };
    st.program.days = objects(st.program.days).map(cleanDay);
    st.program.schedule = st.program.schedule.map(cleanId);
    st.templates = objects(st.templates);
    st.templates.forEach((t) => { idField(t, 'id'); t.days = objects(t.days).map(cleanDay); if (Array.isArray(t.schedule)) t.schedule = t.schedule.map(cleanId); if (!isDate(t.savedAt)) t.savedAt = todayKey(); });
    st.workouts = objects(st.workouts);
    st.workouts.forEach((w) => {
      idField(w, 'id'); idField(w, 'dayId');
      numFields(w, ['startedAt', 'finishedAt']);
      if (!isDate(w.date)) w.date = todayKey(new Date(w.startedAt || w.finishedAt || Date.now()));
      if (isObj(w.soreness)) { dropBadKeys(w.soreness); Object.keys(w.soreness).forEach((m) => { w.soreness[m] = cleanNum(w.soreness[m]); }); }
      if (w.cardio != null && !isObj(w.cardio)) delete w.cardio;
      if (w.cardio) { numFields(w.cardio, ['min', 'incline', 'speed', 'kcal']); if (w.cardio.speedUnit !== 'mph' && w.cardio.speedUnit !== 'km/h') w.cardio.speedUnit = s.units === 'kg' ? 'km/h' : 'mph'; }
      w.entries = objects(w.entries);
      w.entries.forEach((en) => {
        idField(en, 'exId'); idField(en, 'swappedFrom');
        numFields(en, ['plannedSets', 'weightAtStart', 'targetReps', 'pump', 'joint', 'workload']);
        en.sets = objects(en.sets); en.sets.forEach((x) => numFields(x, ['weight', 'reps', 'rir']));
        if (Array.isArray(en.warmups)) { en.warmups = objects(en.warmups); en.warmups.forEach((x) => numFields(x, ['weight', 'reps'])); }
        numFields(en.next, ['weight', 'targetReps', 'sets', 'updatedAt']); numFields(en.prevPresc, ['weight', 'targetReps', 'sets', 'updatedAt']);
      });
    });
    idField(st, 'active');
    st.bodyweight = objects(st.bodyweight).filter((b) => isDate(b.date));
    st.bodyweight.forEach((b) => numFields(b, ['weight']));
    st.sleep = objects(st.sleep).filter((n) => isDate(n.date));
    st.sleep.forEach((n) => numFields(n, ['total', 'rem', 'deep', 'light', 'recovery', 'rhr', 'hrv', 'perf']));
    numFields(st.food.targets, ['kcal', 'protein', 'carbs', 'fat']);
    Object.keys(st.diary).forEach((k) => { if (Array.isArray(st.diary[k])) st.diary[k] = objects(st.diary[k]); else delete st.diary[k]; });
  }
  // Fill in fields added after v1 shipped so older saves keep working.
  function normalize(st) {
    // Keys that would change how objects behave (only a hand-made file can hold them).
    [st, st.settings, st.presc, st.food, st.food && st.food.targets, st.food && st.food.foods, st.food && st.food.meals, st.diary, st.deleted].forEach(dropBadKeys);
    const hadCheckin = !!(st.settings && st.settings.checkinV);
    st.settings = Object.assign(defaultSettings(), isObj(st.settings) ? st.settings : {});
    // A partial backup or cloud copy must not leave the app unable to render.
    if (!Array.isArray(st.exercises)) st.exercises = [];
    if (!Array.isArray(st.workouts)) st.workouts = [];
    if (!st.presc || typeof st.presc !== 'object') st.presc = {};
    if (!st.program || typeof st.program !== 'object') st.program = {};
    if (!Array.isArray(st.program.days)) st.program.days = [];
    if (!Array.isArray(st.program.schedule) || st.program.schedule.length !== 7) st.program.schedule = [null, null, null, null, null, null, null];
    // v2.2 morning check-in: weigh in every day (asked for once; change it in Settings after).
    if (!hadCheckin) { st.settings.weighEvery = 1; st.settings.checkinV = 1; }
    if (!Array.isArray(st.bodyweight)) st.bodyweight = [];
    if (!Array.isArray(st.sleep)) st.sleep = [];
    // Deletion records, so cloud sync merges never bring back something deleted on another phone.
    if (!st.deleted || typeof st.deleted !== 'object') st.deleted = {};
    const cutoff = Date.now() - 90 * 864e5;
    ['food', 'bw', 'sleep', 'workouts'].forEach((k) => {
      const m = st.deleted[k] && typeof st.deleted[k] === 'object' ? st.deleted[k] : {};
      Object.keys(m).forEach((id) => { if (!(m[id] > cutoff)) delete m[id]; });
      st.deleted[k] = m;
    });
    if (st.settings.sleepSkip) { st.settings.sleepSkip.forEach((d) => { st.deleted.sleep[d] = Date.now(); }); delete st.settings.sleepSkip; }
    if (!Array.isArray(st.templates)) st.templates = [];
    if (!st.food || typeof st.food !== 'object') st.food = {};
    st.food.targets = Object.assign({ kcal: null, protein: null, carbs: null, fat: null }, st.food.targets || {});
    if (!st.food.foods || typeof st.food.foods !== 'object') st.food.foods = {};
    if (!st.food.meals || typeof st.food.meals !== 'object') st.food.meals = {};
    if (!st.diary || typeof st.diary !== 'object' || Array.isArray(st.diary)) st.diary = {};
    cleanValues(st);
    if ((st.libVersion || 1) < 2) {
      const byName = {};
      st.exercises.forEach((e) => { byName[e.name.toLowerCase()] = e.id; });
      LIBRARY_V2.forEach(([name, muscle, equipment]) => {
        if (byName[name.toLowerCase()]) return;
        const ex = { id: uid(), name, muscle, equipment, increment: null, repMin: null, repMax: null, custom: false };
        st.exercises.push(ex); byName[name.toLowerCase()] = ex.id;
      });
      if (!st.program.days.some((d) => d.name === ONE_OFF_DAY.name)) {
        st.program.days.push({ id: uid(), name: ONE_OFF_DAY.name, exercises: ONE_OFF_DAY.exercises.map((n) => byName[n.toLowerCase()]).filter(Boolean) });
      }
      st.libVersion = 2;
    }
    if ((st.libVersion || 1) < 3) {
      // The Back & Biceps day was a one-off. Drop it only if it is still exactly as added and not on the schedule.
      const idsByName = {};
      st.exercises.forEach((e) => { idsByName[e.name.toLowerCase()] = e.id; });
      const want = JSON.stringify(ONE_OFF_DAY.exercises.map((n) => idsByName[n.toLowerCase()]).filter(Boolean));
      st.program.days = st.program.days.filter((d) => !(d.name === ONE_OFF_DAY.name && !st.program.schedule.includes(d.id) && JSON.stringify(d.exercises) === want));
      st.libVersion = 3;
    }
    return st;
  }
  const NOT_SAVED = 'Not saved on this phone: the app\'s storage is full. Export a backup now.';
  // Returns whether the data reached this phone's storage.
  function save() {
    if (ui.unreadable) return false;   // the stored data could not be read: never write over it
    let ok = true, text = null;
    try { text = JSON.stringify(state); localStorage.setItem(STORAGE_KEY, text); ui.savedChars = text.length; }
    catch (e) { ok = false; }
    // A workout was just finished: refresh today's automatic copy so it includes it.
    if (ui.lastActive && !state.active) { const w = state.workouts.find((x) => x.id === ui.lastActive); if (w && w.finishedAt) safetyCopy('day', true, text); }
    ui.lastActive = state.active;
    if (ok !== !ui.saveFailed) {
      // Stays on screen until a save works: a toast is too easy to miss when data is at stake.
      ui.saveFailed = !ok;
      renderSaveWarning();
    }
    // A "Saved" / "Added" / "Workout saved" message shown right after this would not be true.
    // This runs after the caller's own message, so it replaces it.
    if (!ok && ui.booted) Promise.resolve().then(() => toast(NOT_SAVED));
    document.dispatchEvent(new CustomEvent('overload:save'));
    return ok;
  }
  function renderSaveWarning() {
    const el = $('#save-warning'); if (!el) return;
    el.hidden = !ui.saveFailed;
    document.body.classList.toggle('has-save-warning', !!ui.saveFailed);
    el.innerHTML = ui.saveFailed ? '<div class="banner danger"><b>The app\'s storage is full.</b> Your latest changes are not saved on this phone and are lost if the app closes. '
      + 'Export a backup now. Freeing space on the phone does not help: this limit belongs to the app.<div class="btn-row mt8"><button class="btn" data-action="export">Export backup</button></div></div>' : '';
    // The banner is fixed under the top bar; the screen starts below it (see .has-save-warning in styles.css).
    document.documentElement.style.setProperty('--save-warning-h', ui.saveFailed ? el.offsetHeight + 'px' : '0px');
  }
  // ---- Automatic copies, storage use, last export (backup.js keeps the copies in IndexedDB) ----
  // Before an import, reset or restore the text is taken now (the data is replaced right after);
  // the daily copy builds it only if today has none yet.
  function safetyCopy(kind, force, text) {
    const B = window.__overloadBackup;
    try { return B ? B.take(kind, text || (kind === 'day' ? () => JSON.stringify(state) : JSON.stringify(state)), force) : Promise.resolve(false); } catch (e) { return Promise.resolve(false); }
  }
  function backupInfo() { try { return JSON.parse(localStorage.getItem(BACKUP_KEY)) || {}; } catch (e) { return {}; } }
  function setBackupInfo(patch) { try { localStorage.setItem(BACKUP_KEY, JSON.stringify(Object.assign(backupInfo(), patch))); } catch (e) { /* ignore */ } }
  // Characters stored by this site (key + value, as browsers count them), the app's data counted from its last save.
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
  function syncOn() {
    const sync = window.__overloadSync;
    if (sync) return !!sync.user;
    try { return !!localStorage.getItem(SYNC_KEY); } catch (e) { return false; }   // still loading: linked phones count as on
  }
  // Cloud sync off and no export for 14 days (counted from the first start of this version when there is none).
  function exportDue() {
    if (syncOn() || !(state.workouts.some((w) => w.finishedAt) || Object.keys(state.diary).length)) return false;
    const b = backupInfo(), now = Date.now(), two = 14 * 864e5;
    if (b.nagOff && now - b.nagOff < two) return false;
    const from = b.lastExport || b.since;
    return !!from && now - from > two;
  }
  // One line at the top of Today: storage nearly full, or the export reminder.
  function noticesHtml() {
    if (ui.unreadable || activeWorkout()) return '';
    const pct = Math.round(storageUsed() / STORE_LIMIT * 100);
    if (pct >= 70) return '<div class="notice"><span>Storage is ' + pct + '% full. Export a backup now so nothing is lost.</span><button class="btn small" data-action="export">Export</button></div>';
    if (exportDue()) {
      const t = backupInfo().lastExport;
      return '<div class="notice"><span>' + (t ? 'Last backup ' + agoText(t) : 'No backup yet') + ', and cloud sync is off.</span><button class="btn small" data-action="export">Export</button><button class="icon-btn" data-action="export-nag-off" aria-label="Remind me in two weeks">✕</button></div>';
    }
    return '';
  }
  function refreshNotices() { const el = $('#today-notices'); if (el) el.innerHTML = noticesHtml(); }
  // Settings: the list of automatic copies is read from IndexedDB after the screen is drawn.
  const COPY_KINDS = { import: 'Before import', reset: 'Before reset', restore: 'Before restore', cloud: 'Before cloud sign-in', unreadable: 'Unreadable data' };
  function copyRow(m) {
    const when = fmtDate(todayKey(new Date(m.at))) + (m.kind === 'day' ? '' : ', ' + new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    const title = m.kind === 'day' ? when : (COPY_KINDS[m.kind] || 'Copy') + ' · ' + when;
    const sub = m.workouts == null ? 'As it was found. Export it if you might need it.' : plural(+m.workouts || 0, 'workout') + (m.first ? ' · ' + fmtRange(m.first, m.last || m.first) : '') + (m.foodDays ? ' · ' + plural(+m.foodDays, 'food day') : '');
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
    return '<div class="group-title">Backup</div><div class="card"><p class="small muted mb8">Export a copy now and then. With cloud sync off, this phone is the only place your data lives.</p>'
      + '<div class="btn-row backup-btns"><button class="btn ghost" data-action="export">Export JSON</button><button class="btn ghost" data-action="import">Import JSON</button></div>'
      + '<p class="small muted mt8" id="last-export">' + lastExportText() + '</p>'
      + '<input type="file" accept="application/json,.json" id="import-file" hidden>'
      + '<div class="toggle-row"><div><div>Storage used</div><div class="small muted">' + used.toLocaleString() + ' of about ' + STORE_LIMIT.toLocaleString() + ' characters the app can safely use. Today warns at 70%.</div>'
      + '<span class="vol-bar store-bar"><span class="vol-fill ' + cls + '" style="width:' + Math.min(100, pct) + '%"></span></span></div><span class="vol-n ' + cls + '">' + pct + '%</span></div>'
      + '<div class="mt12">Automatic copies</div><p class="small muted mb8">Kept on this phone: one a day for the last ' + ((window.__overloadBackup && window.__overloadBackup.KEEP_DAYS) || 7) + ' days, and one taken before each import, reset, restore or cloud sign-in.</p>'
      + '<div id="safety-copies">' + (ui.copiesHtml || '<p class="small muted">Looking for copies…</p>') + '</div></div>';
  }
  // Restore an automatic copy: confirm, keep a copy of what is here now, then replace.
  async function restoreCopy(id) {
    const B = window.__overloadBackup; if (!B) return;
    let rec = null, parsed = null;
    try { rec = await B.get(id); parsed = rec && JSON.parse(rec.text, noProto); } catch (e) { parsed = null; }
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.exercises)) { toast('That copy cannot be read'); return; }
    const what = rec.kind === 'day' ? 'the copy from ' + fmtDate(todayKey(new Date(rec.at))) : 'the copy "' + (COPY_KINDS[rec.kind] || 'Copy') + '"';
    const here = ui.unreadable ? '' : '\n' + dataSummary(state, 'This phone now') + activeLine(parsed, 'the copy') + '\n\nA copy of what is on the phone now is kept first.' + cloudNote('replaced');
    if (!confirm('Replace everything on this phone with ' + what + '?\n\n' + dataSummary(parsed, 'The copy') + here)) return;
    replaceState(parsed, 'restore', 'Copy restored');
  }
  // The questions' line about a workout in progress. A copy or backup taken during it holds the same workout as it was then.
  function activeLine(parsed, what) {
    const w = activeWorkout(); if (!w) return '';
    const same = parsed.active === w.id && Array.isArray(parsed.workouts) && parsed.workouts.some((x) => x && x.id === w.id && !x.finishedAt);
    return same ? '\nThe workout in progress goes back to how it was in ' + what + '.' : '\nThe workout in progress will be lost.';
  }
  // Workouts, their date range and food days, for the questions before data is replaced.
  function dataSummary(st, label) {
    const ws = (Array.isArray(st.workouts) ? st.workouts : []).filter((w) => w && w.finishedAt && typeof w.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.date)).map((w) => w.date).sort();
    const days = st.diary && typeof st.diary === 'object' ? Object.keys(st.diary).length : 0;
    return label + ': ' + plural(ws.length, 'workout') + (ws.length ? ' (' + fmtRange(ws[0], ws[ws.length - 1], true) + ')' : '') + ', ' + plural(days, 'food day') + '.';
  }
  // Import and Restore: keep a copy of what is here, then put the new data in place.
  function replaceState(parsed, kind, done) {
    // An older copy may hold an older WHOOP connector link: this phone keeps its own.
    if (kind === 'restore' && !ui.unreadable && isObj(parsed.settings)) ['connUrl', 'connKey'].forEach((k) => { if (state.settings[k]) parsed.settings[k] = state.settings[k]; });
    if (!ui.unreadable) safetyCopy(kind);
    forgetCloudIfSignedOut();
    state = normalize(parsed);
    stopTimer();   // it was counting rest for a set of the data just replaced
    if (!activeWorkout()) state.active = null;
    ui.lastActive = state.active;
    if (ui.unreadable) { leaveUnreadable(); ui.screen = 'today'; }
    applyTheme(); const ok = save(); render(); toast(ok ? done : NOT_SAVED);
  }
  // Theme: 'system' follows the phone, 'dark' / 'light' force one.
  function applyTheme() {
    const t = state.settings.theme || 'system';
    const root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    const light = t === 'light' || (t === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
    root.classList.toggle('system-light', t === 'system' && light);
    try { localStorage.setItem('overload.theme', t); } catch (e) { /* ignore */ }
    const meta = $('meta[name="theme-color"]'); if (meta) meta.content = light ? '#f3f3f5' : '#111214';
  }
  // Replace the whole state (used by cloud sync when remote data arrives).
  function setState(next) {
    if (!next || next.v !== 1 || ui.unreadable) return;
    state = normalize(next);
    let ok = true;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { ok = false; }
    if (ok !== !ui.saveFailed) { ui.saveFailed = !ok; renderSaveWarning(); }
    // Keep state.active even if that workout is not here yet: cloud sync can deliver the settings
    // before the workout itself, and clearing it would end the workout on the other phone too.
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

  function markDeleted(kind, id) { state.deleted[kind][id] = Date.now(); }
  function unmarkDeleted(kind, id) { delete state.deleted[kind][id]; }

  // Accessors
  const exById = (id) => state.exercises.find((e) => e.id === id);
  const dayById = (id) => state.program.days.find((d) => d.id === id);
  const activeWorkout = () => (state.active ? state.workouts.find((w) => w.id === state.active) : null);
  function prescFor(exId) {
    if (!state.presc[exId]) { const ex = exById(exId); state.presc[exId] = { weight: 0, targetReps: repRange(ex).min, sets: (ex && ex.fixedSets) || state.settings.defaultSets, reasons: [], updatedAt: null }; }
    return state.presc[exId];
  }
  function repRange(ex) {
    const min = (ex && ex.repMin) || state.settings.repMin;
    return { min, max: Math.max(min, (ex && ex.repMax) || state.settings.repMax) };
  }
  // Weight jump: per-exercise override, else a default by equipment, else the global setting.
  function incFor(ex) {
    if (ex && ex.increment) return ex.increment;
    const s = state.settings;
    const by = { Dumbbell: s.incDumbbell, Machine: s.incMachine, Cable: s.incCable };
    return (ex && by[ex.equipment]) || s.increment;
  }
  function restFor(ex) { return (ex && ex.restSec) || state.settings.restSec; }
  function durationText(w) {
    if (!w || !w.startedAt) return '';
    const m = Math.max(1, Math.round(((w.finishedAt || Date.now()) - w.startedAt) / 60000));
    return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min';
  }
  // True when no later workout (finished, or the one in progress) logged this exercise. A deload session does not
  // count: it never changes a plan, so the plan still comes from the session before it.
  function isLatestSessionFor(exId, w) {
    return !state.workouts.some((o) => o.id !== w.id && !o.deload && (o.finishedAt || o.id === state.active) && (o.startedAt || 0) > (w.startedAt || 0) && o.entries.some((en) => en.exId === exId && en.done));
  }
  function lastEntryFor(exId) {
    for (let i = state.workouts.length - 1; i >= 0; i--) {
      const w = state.workouts[i];
      if (!w.finishedAt) continue;
      const en = w.entries.find((e) => e.exId === exId && e.sets.some((s) => s.done));
      if (en) return { workout: w, entry: en };
    }
    return null;
  }

  // Best weight / estimated 1RM / reps-at-weight for an exercise, excluding one workout
  // (and, given upTo, every workout not started before that one).
  function bestBefore(exId, excludeWorkoutId, upTo) {
    const best = { weight: 0, e1rm: 0, repsAt: {}, sessions: 0 };
    state.workouts.forEach((w) => {
      if (!w.finishedAt || w.id === excludeWorkoutId) return;
      if (upTo && !(w.startedAt && upTo.startedAt ? w.startedAt < upTo.startedAt : w.date < upTo.date)) return;
      w.entries.forEach((en) => {
        if (en.exId !== exId) return;
        let any = false;
        en.sets.forEach((st) => {
          if (!st.done || !(st.reps > 0)) return;
          any = true;
          if (st.weight > best.weight) best.weight = st.weight;
          if (e1rm(st.weight, st.reps) > best.e1rm) best.e1rm = e1rm(st.weight, st.reps);
          best.repsAt[st.weight] = Math.max(best.repsAt[st.weight] || 0, st.reps);
        });
        if (any) best.sessions++;
      });
    });
    return best;
  }
  function detectPrs(exId, entry, workoutId, upTo) {
    const best = bestBefore(exId, workoutId, upTo);
    if (!best.sessions) return [];
    const prs = [];
    const done = entry.sets.filter((st) => st.done && st.reps > 0);
    if (!done.length) return prs;
    const top = done.reduce((a, b) => (b.weight > a.weight ? b : a), { weight: 0, reps: 0 });
    const assisted = isAssisted(exById(exId));
    if (top.weight > best.weight && !assisted) prs.push({ kind: 'weight', text: 'Heaviest ever: ' + fmtW(top.weight) + ' ' + state.settings.units + ' × ' + top.reps });
    const bestE = done.reduce((a, b) => (e1rm(b.weight, b.reps) > e1rm(a.weight, a.reps) ? b : a));
    if (e1rm(bestE.weight, bestE.reps) > best.e1rm + 0.01 && !prs.length && !assisted) prs.push({ kind: 'e1rm', text: 'Best set ever: ' + fmtW(bestE.weight) + ' × ' + bestE.reps });
    done.forEach((st) => { if (best.repsAt[st.weight] && st.reps > best.repsAt[st.weight] && !prs.some((x) => x.kind === 'reps')) prs.push({ kind: 'reps', text: 'Most reps at ' + fmtW(st.weight) + ': ' + st.reps + ' (was ' + best.repsAt[st.weight] + ')' }); });
    return prs;
  }

  // ---------------------------------------------------------------------------
  // Progression algorithm
  // ---------------------------------------------------------------------------
  // Assisted moves (the machine takes weight off you): less weight is progress.
  function isAssisted(ex) { return !!ex && /assist/i.test(ex.name); }
  // Planned working sets per week for a muscle: prescribed sets × how often each exercise is scheduled.
  function plannedWeeklySets(muscle) {
    let n = 0;
    state.program.schedule.forEach((dayId) => {
      const day = dayId && dayById(dayId); if (!day) return;
      day.exercises.forEach((id) => { const ex = exById(id); if (ex && ex.muscle === muscle) n += (state.presc[id] ? state.presc[id].sets : state.settings.defaultSets); });
    });
    return n;
  }
  function timesPerWeek(exId) {
    let n = 0;
    state.program.schedule.forEach((dayId) => { const day = dayId && dayById(dayId); if (day) n += day.exercises.filter((id) => id === exId).length; });
    return n;
  }
  /**
   * Given the exercise, its current prescription, the logged sets and feedback,
   * return the next prescription { weight, targetReps, sets, soreCut, reasons[] }
   * or null if nothing was logged.
   *
   * Weight rule (rep-range progression), judged on the sets at the top weight
   * used, so lighter back-off sets never drag the next weight down:
   *   - every top set >= repMax       -> weight + increment, target back to repMin
   *   - some sets hit repMax          -> hold weight, target repMax ("push the rest")
   *   - all sets >= repMin            -> hold weight, target = lowest reps + 1
   *   - any set < repMin              -> hold weight, target repMin
   * When one increment is big for the weight (light cables and dumbbells), the
   * top of the range stretches to the reps that pay for the jump (at most 20).
   * Bodyweight moves with no added load progress by reps only. Assisted moves
   * progress by taking assistance off.
   * Joint pain "moderate" blocks the weight increase; "a lot" backs the load off.
   *
   * Set rule (recovery feedback):
   *   - still sore / joint pain >= moderate / workload too much -> -1 set
   *   - a set cut for soreness last time and soreness has cleared -> +1 set back
   *   - recovered early AND low pump                            -> +1 set
   *   - never sore AND workload easy                            -> +1 set
   * A +1 never pushes the muscle's planned weekly sets past the volume target.
   * Exercises with fixed sets (FST-7 finishers: always 7) skip the set rule.
   */
  function computeNext(ex, presc, entry, soreness) {
    const logged = entry.sets.filter((s) => s.done && s.reps > 0);
    if (!logged.length) return null;
    const inc = incFor(ex);
    const { min: repMin, max: repMax } = repRange(ex);
    const assisted = isAssisted(ex);
    // Top weight = heaviest load for normal lifts, least assistance for assisted ones.
    const weight = assisted ? Math.min(...logged.map((s) => s.weight)) : Math.max(...logged.map((s) => s.weight));
    const done = logged.filter((s) => s.weight === weight);
    const fb = { pump: entry.pump, joint: entry.joint, workload: entry.workload, soreness };
    const reasons = [];
    const next = { weight, targetReps: presc.targetReps, sets: presc.sets, soreCut: !!presc.soreCut, reasons, updatedAt: Date.now() };
    const unit = state.settings.units;
    const repsOnly = weight === 0 && (ex.equipment === 'Bodyweight' || assisted);
    // A jump that is big for the load needs more reps first, enough that the first sets after it still reach
    // the bottom of the range (Epley: 30 lb × 17 ≈ 35 lb × 10). Capped at 20 reps; past that a smaller jump suits.
    let top = repMax, tooBig = false, need = 0;
    if (!assisted && !repsOnly && weight > 0) {
      if (ex.equipment === 'Bodyweight') { if (inc / weight > 0.1) top = repMax + 2; }  // added load on a bodyweight move
      else {
        need = Math.ceil(30 * ((weight + inc) * (1 + repMin / 30) / weight - 1) - 1e-9);
        const cap = Math.max(repMax, 20);
        top = Math.min(Math.max(repMax, need), cap); tooBig = need > cap;
      }
    }
    const big = top > repMax;
    const stepped = assisted ? Math.max(0, round(weight - inc, 0.01)) : round(weight + inc, 0.01);
    const stepText = assisted ? '−' + fmtW(inc) + ' ' + unit + ' assistance' : '+' + fmtW(inc) + ' ' + unit;

    const lowest = Math.min(...done.map((s) => s.reps));
    const allTop = done.every((s) => s.reps >= top);
    const anyTop = done.some((s) => s.reps >= repMax);
    const jointHold = fb.joint != null && fb.joint >= 2;
    const rirs = done.map((st) => st.rir).filter((v) => v != null);
    const easy = rirs.length === done.length && rirs.every((v) => v >= 3);
    const backoff = done.length < logged.length ? ' (judged on your ' + fmtW(weight) + ' ' + unit + ' sets)' : '';

    if (repsOnly) {
      // No load to add: keep adding reps past the range. Log added weight (belt, vest) to switch to load.
      if (jointHold && lowest >= repMin) { next.targetReps = Math.max(presc.targetReps, repMin); reasons.push('Holding reps because of joint pain'); }
      else if (lowest >= repMin) { next.targetReps = lowest + 1; reasons.push('Bodyweight: every set ≥ ' + lowest + ' → aim for ' + next.targetReps + '. Enter added weight when you want to load it'); }
      else { next.targetReps = repMin; reasons.push('A set fell below ' + repMin + ' → build back to ' + repMin); }
    } else if (allTop && !jointHold) {
      next.weight = stepped;
      next.targetReps = repMin;
      reasons.push('Hit ' + top + ' on every set → ' + stepText + ', aim for ' + repMin + backoff);
    } else if (allTop && jointHold) {
      next.targetReps = top;
      reasons.push('Hit ' + top + ' on every set, but holding weight because of joint pain');
    } else if (lowest >= repMin && easy && !jointHold && !big && lowest + 3 >= need) {
      // 3+ in reserve: at least lowest + 3 were there, so jump early only when that pays for the jump.
      next.weight = stepped;
      next.targetReps = repMin;
      reasons.push('Every set had 3+ reps in reserve → ' + stepText + ' early, aim for ' + repMin);
    } else if (big && done.every((s) => s.reps >= repMax)) {
      next.targetReps = clamp(lowest + 1, repMax + 1, top);
      reasons.push(fmtW(weight) + ' → ' + fmtW(stepped) + ' ' + unit + ' is a big jump: earn it with ' + top + ' reps on every set');
    } else if (anyTop) {
      next.targetReps = repMax;
      reasons.push('Some sets hit ' + repMax + ' → hold weight, push every set to ' + repMax + backoff);
    } else if (lowest >= repMin) {
      next.targetReps = clamp(lowest + 1, repMin, repMax);
      reasons.push('Every set ≥ ' + lowest + ' → hold weight, aim for ' + next.targetReps + backoff);
    } else {
      next.targetReps = repMin;
      reasons.push('A set fell below ' + repMin + ' → hold weight, build back to ' + repMin + backoff);
    }
    // More reps than the cap would be needed to pay for one jump: say so whatever this session gave.
    if (tooBig) reasons[0] += '. A smaller weight jump would suit this exercise (Edit exercise → Weight jump)';

    if (fb.joint === 3) {
      // Replaces the rep line above (reasons[0]): weight and goal no longer follow it, and the card shows the first line.
      next.targetReps = repMin;
      if (repsOnly) reasons[0] = 'A lot of joint pain → back to ' + repMin + ' reps. Consider swapping this exercise';
      else if (assisted) { next.weight = round(weight + 2 * inc, 0.01); reasons[0] = 'A lot of joint pain → ' + fmtW(2 * inc) + ' ' + unit + ' more assistance, aim for ' + repMin + '. Consider swapping this exercise'; }
      else {
        // About 15% off, rounded to the weight jump and at least one jump, but never below one jump.
        next.weight = weight > inc ? Math.max(inc, round(weight - Math.max(inc, round(weight * 0.15, inc)), 0.01)) : weight;
        const off = round(weight - next.weight, 0.01);
        reasons[0] = off > 0 ? 'A lot of joint pain → dropped ' + fmtW(off) + ' ' + unit + ', aim for ' + repMin + '. Consider swapping this exercise'
          : 'A lot of joint pain → this is already the lightest step, so the weight stays. Consider swapping this exercise';
      }
    }

    if (ex.fixedSets) {
      next.sets = ex.fixedSets; next.soreCut = false;
      if (fb.soreness === 3 || (fb.joint != null && fb.joint >= 2) || fb.workload === 3) reasons.push('Sets stay at ' + ex.fixedSets + ' (fixed for this exercise). Go lighter if recovery is struggling');
      return next;
    }
    let delta = 0, restore = false, capped = false;
    if (fb.soreness === 3) { delta = -1; next.soreCut = !!presc.soreCut || presc.sets > 1; reasons.push('Still sore → −1 set'); }
    else if (fb.joint != null && fb.joint >= 2) { delta = -1; reasons.push('Joint pain → −1 set'); }
    else if (fb.workload === 3) { delta = -1; reasons.push('Too much → −1 set'); }
    else if (presc.soreCut && fb.soreness != null) { delta = 1; restore = true; next.soreCut = false; reasons.push('Soreness cleared → the set it cut is back'); }
    else if ((fb.soreness === 0 || fb.soreness === 1) && fb.pump === 0) { delta = 1; reasons.push('Recovered early with a low pump → +1 set'); }
    else if (fb.soreness === 0 && fb.workload === 0) { delta = 1; reasons.push('Never sore and felt easy → +1 set'); }
    if (delta > 0 && !restore) {
      // Weekly volume cap: adding a set here adds it every time the exercise is scheduled.
      const planned = plannedWeeklySets(ex.muscle), add = Math.max(1, timesPerWeek(ex.id)), cap = state.settings.volumeMax;
      if (cap > 0 && planned + add > cap) { delta = 0; capped = true; reasons.pop(); reasons.push(ex.muscle + ' is already at ' + planned + ' planned sets a week (target up to ' + cap + ') → keep ' + presc.sets + ' sets'); }
    }
    next.sets = clamp(presc.sets + delta, 1, Math.max(state.settings.maxSets, presc.sets));
    if (delta === 0 && fb.soreness != null && !capped) reasons.push('Recovery looks right → keep ' + next.sets + ' sets');
    return next;
  }

  // ---------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------
  const ui = { screen: 'today', selectedDay: weekdayIndex(), dayKey: todayKey(), saveFailed: false, sheet: null, search: '', chartEx: null, sync: { status: 'off', msg: '' }, calOffset: 0, reviewOffset: 0, showOthers: false, updateReady: false };
  const timer = { end: 0, total: 0, handle: null, kind: 'rest' };

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function render() {
    if (ui.renderLater) { clearInterval(ui.renderLater); ui.renderLater = null; }   // this draw brings the screen up to date
    if (ui.unreadable) { renderUnreadable(); return; }
    try {
      renderScreen();
      if (ui.screen === 'today' && !activeWorkout()) {
        const html = '<div id="today-notices">' + noticesHtml() + '</div>', t = $('#app > .screen-title');
        if (t) t.insertAdjacentHTML('afterend', html); else $('#app').insertAdjacentHTML('afterbegin', html);
      }
      if (ui.screen === 'settings') fillCopies();
    } catch (e) {
      // One bad record (or a bug) must not leave a blank screen: say so and offer Export. The other tabs keep working.
      console.error(e);
      $('#app').innerHTML = '<div class="card mt16"><p><b>This screen could not be shown.</b> Your saved data has not changed. Export a backup to keep it safe, then try another tab.</p>'
        + '<p class="small muted mt8">' + esc((e && e.message) || e) + '</p>'
        + '<div class="btn-row mt12"><button class="btn" data-action="export">Export backup</button></div></div>';
    }
  }
  function renderScreen() {
    const app = $('#app');
    // Opened yesterday and still open: the selected day moves on with the date.
    if (ui.dayKey !== todayKey()) { ui.dayKey = todayKey(); ui.selectedDay = weekdayIndex(); ui.showOthers = false; }
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === ui.screen));
    renderTopbar();
    switch (ui.screen) {
      case 'today': app.innerHTML = renderToday(); break;
      case 'food': app.innerHTML = window.__overloadFood ? window.__overloadFood.render() : '<div class="empty">Loading…</div>'; break;
      case 'program': app.innerHTML = renderProgram(); break;
      case 'exercises': app.innerHTML = renderExercises(); break;
      case 'history': app.innerHTML = renderHistory(); break;
      case 'settings': app.innerHTML = renderSettings(); break;
    }
  }

  function renderTopbar() {
    const upd = ui.updateReady ? '<button class="pill accent" data-action="reload">Update ready</button>' : '';
    const sync = ui.sync.status === 'off' ? '' : '<button class="pill sync-pill ' + ui.sync.status + '" data-action="goto-settings" title="' + esc(ui.sync.msg) + '">' + syncIcon(ui.sync.status) + '</button>';
    $('#topbar-right').innerHTML = upd + sync;
  }
  function syncIcon(st) { return { synced: '☁ ✓', syncing: '☁ …', offline: '☁ ⏸', error: '☁ !' }[st] || '☁'; }

  // ---- Today ---------------------------------------------------------------
  function renderToday() {
    const w = activeWorkout();
    if (w) return renderActiveWorkout(w);

    const ti = weekdayIndex();
    const strip = WEEKDAYS.map((d, i) => {
      const dayId = state.program.schedule[i];
      const cls = ['day-chip', i === ti ? 'today' : '', i === ui.selectedDay ? 'selected' : '', dayId ? '' : 'rest'].join(' ');
      return '<button class="' + cls + '" data-action="select-day" data-i="' + i + '" aria-label="' + WEEKDAYS_LONG[i] + '">' + d[0] + '<span class="dot"></span></button>';
    }).join('');
    const stripHtml = '<div class="day-strip">' + strip + '</div>';

    const dayId = state.program.schedule[ui.selectedDay];
    const day = dayId ? dayById(dayId) : null;
    const others = state.program.days.filter((d) => !day || d.id !== day.id);
    const otherList = others.length ? '<div class="list">' + others.map((d) => '<div class="list-item"><div class="grow"><div class="title">' + esc(d.name) + '</div><div class="sub">' + plural(d.exercises.length, 'exercise') + (state.program.schedule.includes(d.id) ? '' : ' · not on the schedule') + '</div></div><button class="btn small ghost" data-action="start-workout" data-day="' + d.id + '" ' + (d.exercises.length ? '' : 'disabled') + '>Start</button></div>').join('') + '</div>' : '';
    // On a rest day the list is the main content; on a training day it hides behind a button.
    const otherHtml = !others.length ? '' : (!day || ui.showOthers)
      ? '<div class="group-title">Start a different day</div>' + otherList
      : '<button class="btn subtle block mt8" data-action="toggle-others">Start a different day…</button>';
    let body;
    if (!day) {
      body = '<div class="card"><div class="empty">Rest day.<br><span class="small">Nothing scheduled. Start any day below if you feel like lifting.</span></div></div>' + otherHtml;
    } else {
      const items = day.exercises.map((exId) => {
        const ex = exById(exId); if (!ex) return '';
        const p = prescFor(exId);
        return '<button class="list-item" data-action="edit-ex" data-ex="' + ex.id + '"><div class="grow"><div class="title">' + esc(ex.name) + '</div><div class="sub">' + prescText(ex, p) + '</div></div><span class="chev">›</span></button>';
      }).join('');
      // Start sits right under the day name so it is on the first screen, above the exercise list.
      body = '<div class="card flat"><div class="card-head"><div><h2>' + esc(day.name) + '</h2><div class="meta">' + WEEKDAYS_LONG[ui.selectedDay] + ' · ' + day.exercises.length + ' exercises</div></div>'
        + '<button class="btn small subtle deload-start" data-action="start-deload" data-day="' + day.id + '" ' + (day.exercises.length ? '' : 'disabled') + '>Start as deload</button></div>'
        + '<button class="btn block" data-action="start-workout" data-day="' + day.id + '" ' + (day.exercises.length ? '' : 'disabled') + '>Start workout</button>'
        + '<div class="list mt12">' + (items || '<div class="empty">No exercises yet. Add some in Program.</div>') + '</div></div>' + otherHtml;
    }
    const last = state.workouts.filter((x) => x.finishedAt).slice(-1)[0];
    const lastLine = last ? '<p class="muted small center mt8">Last workout: ' + esc(last.dayName) + ' · ' + fmtDate(last.date) + '</p>' : '';
    const st = streakInfo();
    const streakLine = st.streak > 1 ? '<div class="banner">🔥 ' + st.streak + '-day streak. Keep it going.</div>' : '';
    const night = state.sleep.find((x) => x.date === todayKey());
    const redLine = day && night && night.recovery != null && night.recovery < 34 && ui.selectedDay === weekdayIndex()
      ? '<div class="banner">🔴 Recovery ' + night.recovery + '% (red). Train, but hold the weights and skip extra sets today.</div>' : '';
    const checkin = renderCheckinCard();
    return '<div class="screen-title"><h1>Today</h1><span class="sub">' + fmtDate(todayKey()) + '</span></div>' + streakLine + redLine + (checkinDone() ? '' : checkin) + stripHtml + body + (checkinDone() ? checkin : '') + lastLine;
  }

  // ---- Body weight ---------------------------------------------------------
  function bwSorted() { return state.bodyweight.slice().sort((a, b) => (a.date < b.date ? -1 : 1)); }
  // ---- Morning check-in: body weight and last night's sleep ----------------
  const sleepSorted = () => state.sleep.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const fmtHM = (min) => (min == null ? '–' : Math.floor(min / 60) + 'h ' + String(Math.round(min % 60)).padStart(2, '0') + 'm');
  function weighDue() {
    const every = state.settings.weighEvery; if (!every) return false;
    const last = bwSorted().slice(-1)[0];
    return !last || daysBetween(last.date, todayKey()) >= every;
  }
  function checkinDone() {
    const today = todayKey();
    return !ui.checkinEdit && !weighDue() && (!state.settings.sleepOn || state.sleep.some((x) => x.date === today));
  }
  // WHOOP recovery bands: green 67–100, yellow 34–66, red 0–33.
  const recBand = (r) => (r >= 67 ? ['green', 'green'] : r >= 34 ? ['amber', 'yellow'] : ['accent', 'red']);
  const recPill = (r) => (r == null ? '' : '<span class="pill ' + recBand(r)[0] + '">Recovery ' + r + '%</span>');
  function sleepAvg(days, endKey, fromKey) {
    const to = endKey || todayKey(), from = fromKey || addDays(to, -(days - 1));
    const list = state.sleep.filter((x) => x.date >= from && x.date <= to && x.total > 0);
    if (!list.length) return null;
    const avg = (k) => { const v = list.filter((x) => x[k] != null); return v.length ? v.reduce((n, x) => n + x[k], 0) / v.length : null; };
    return { n: list.length, total: avg('total'), rem: avg('rem'), deep: avg('deep'), recovery: avg('recovery'), rhr: avg('rhr'), hrv: avg('hrv') };
  }
  function sleepLine(x) {
    const pct = (v) => (v != null && x.total ? ' (' + Math.round(v / x.total * 100) + '%)' : '');
    return 'Slept ' + fmtHM(x.total) + (x.rem != null ? ' · REM ' + fmtHM(x.rem) + pct(x.rem) : '') + (x.deep != null ? ' · deep ' + fmtHM(x.deep) + pct(x.deep) : '');
  }
  function renderCheckinCard() {
    const s = state.settings, today = todayKey(), u = s.units;
    if (!s.weighEvery && !s.sleepOn) return '';
    const bwToday = state.bodyweight.find((b) => b.date === today);
    const slToday = state.sleep.find((x) => x.date === today);
    const lastBw = bwSorted().slice(-1)[0];
    if (checkinDone()) {
      const parts = [];
      if (bwToday) parts.push(fmtW(bwToday.weight) + ' ' + u);
      else if (lastBw && s.weighEvery) parts.push('Next weigh-in ' + fmtDate(addDays(lastBw.date, s.weighEvery)));
      const avg = sleepAvg(7);
      return '<div class="card"><div class="row between"><b>Morning check-in ✓</b><div class="row" style="gap:6px">' + (slToday ? recPill(slToday.recovery) : '') + '<button class="btn small ghost" data-action="checkin-edit">Edit</button></div></div>'
        + '<div class="small mt8">' + esc(parts.concat(slToday ? [sleepLine(slToday) + (slToday.src === 'whoop' ? ' (WHOOP)' : '')] : []).join(' · ')) + '</div>'
        + (avg && avg.n > 1 ? '<div class="tiny muted mt8">7-night average ' + fmtHM(avg.total) + (avg.rem != null ? ' · REM ' + fmtHM(avg.rem) : '') + (avg.deep != null ? ' · deep ' + fmtHM(avg.deep) : '') + '</div>' : '') + '</div>';
    }
    const due = weighDue();
    const showWeight = s.weighEvery && (due || bwToday || ui.checkinEdit);
    const hm = (label, k, min, hint) => '<div class="toggle-row"><div><div>' + label + '</div>' + (hint ? '<div class="tiny muted">' + hint + '</div>' : '') + '</div><div class="row" style="gap:6px">'
      + '<input class="input" style="width:62px;text-align:center" name="' + k + 'H" type="number" inputmode="numeric" min="0" max="16" placeholder="h" value="' + (min != null ? Math.floor(min / 60) : '') + '"><span class="muted">h</span>'
      + '<input class="input" style="width:62px;text-align:center" name="' + k + 'M" type="number" inputmode="numeric" min="0" max="59" placeholder="m" value="' + (min != null ? Math.round(min % 60) : '') + '"><span class="muted">m</span></div></div>';
    return '<div class="card" id="checkin-card"><div class="row between"><b>Morning check-in</b>' + (due ? '<span class="pill amber">Weigh-in due</span>' : '') + '</div>'
      + '<form id="bw-form" class="mt8">'
      + (showWeight ? '<div class="toggle-row"><div><div>Body weight</div><div class="tiny muted">' + (lastBw ? 'Last ' + fmtW(lastBw.weight) + ' ' + u + ' · ' + fmtDate(lastBw.date) : 'After the bathroom, before food') + '</div></div><div class="row" style="gap:6px"><input class="input" style="width:100px;text-align:center" name="weight" type="number" inputmode="decimal" step="any" min="0" placeholder="' + (lastBw ? fmtW(lastBw.weight) : u) + '" value="' + (bwToday ? fmtW(bwToday.weight) : '') + '"><span class="muted">' + u + '</span></div></div>' : '')
      + (!s.sleepOn ? '' : slToday && slToday.src === 'whoop' && !ui.checkinEdit
        ? '<div class="toggle-row"><div><div>Sleep <span class="tiny muted">from WHOOP</span></div><div class="small">' + esc(sleepLine(slToday)) + '</div></div>' + recPill(slToday.recovery) + '</div>'
        : hm('Time asleep', 'total', slToday ? slToday.total : null, 'From your watch or sleep app') + hm('REM', 'rem', slToday ? slToday.rem : null) + hm('Deep', 'deep', slToday ? slToday.deep : null))
      + '<div class="btn-row mt8">' + (ui.checkinEdit ? '<button class="btn subtle" type="button" data-action="checkin-cancel">Cancel</button>' : '') + '<button class="btn" type="submit">Save</button></div></form></div>';
  }
  function saveCheckin(form) {
    const f = new FormData(form), today = todayKey();
    const mins = (k) => { const h = f.get(k + 'H'), m = f.get(k + 'M'); if ((h == null || h === '') && (m == null || m === '')) return null; return Math.max(0, Math.round(num(h, 0) * 60 + num(m, 0))); };
    const wt = f.get('weight') != null && f.get('weight') !== '' ? num(f.get('weight'), 0) : null;
    const total = mins('total'), rem = mins('rem'), deep = mins('deep');
    if (wt == null && total == null && rem == null && deep == null) { toast(state.settings.sleepOn ? 'Enter your weight or sleep' : 'Enter a weight'); return; }
    if (wt != null && !(wt > 0)) { toast('Enter a weight'); return; }
    if ((rem != null || deep != null) && total == null) { toast('Enter total time asleep too'); return; }
    if (total != null && (total < 30 || total > 16 * 60)) { toast('Time asleep looks off: ' + fmtHM(total)); return; }
    if (total != null && (rem || 0) + (deep || 0) > total) { toast('REM + deep is more than total sleep'); return; }
    const done = [];
    if (wt != null) {
      unmarkDeleted('bw', today);
      const ex = state.bodyweight.find((b) => b.date === today);
      if (ex) ex.weight = wt; else state.bodyweight.push({ date: today, weight: wt });
      done.push(fmtW(wt) + ' ' + state.settings.units);
    }
    if (total != null) {
      const prev = state.sleep.find((x) => x.date === today) || {};
      const same = prev.total === total && prev.rem === rem && prev.deep === deep;
      const next = { date: today, total, rem, deep };
      ['recovery', 'rhr', 'hrv', 'perf', 'light'].forEach((k) => { if (prev[k] != null && (k !== 'light' || same)) next[k] = prev[k]; });
      if (same && prev.src) next.src = prev.src;  // unchanged WHOOP night stays WHOOP's
      state.sleep = state.sleep.filter((x) => x.date !== today).concat([next]);
      unmarkDeleted('sleep', today);
      done.push(fmtHM(total) + ' sleep');
    }
    ui.checkinEdit = false;
    save(); render(); toast('Logged ' + done.join(' · '));
  }

  // ---- Streak --------------------------------------------------------------
  function streakInfo() {
    const dates = new Set(state.workouts.filter((w) => w.finishedAt).map((w) => w.date));
    const today = todayKey();
    let streak = 0, key = today;
    for (let i = 0; i < 400; i++) {
      const wd = ((new Date(key.replace(/-/g, '/')).getDay()) + 6) % 7;
      if (dates.has(key)) streak++;
      else if (state.program.schedule[wd] == null) { /* rest day, keep going */ }
      else if (key === today) { /* not trained yet today */ }
      else break;
      key = addDays(key, -1);
    }
    return { streak };
  }

  function prescText(ex, p) {
    const r = repRange(ex);
    const wt = p.weight > 0 ? '<strong>' + fmtW(p.weight) + ' ' + state.settings.units + '</strong>' + (ex.equipment === 'Dumbbell' ? ' each' : '') : '<strong>set weight</strong>';
    return p.sets + ' × ' + r.min + '–' + r.max + ' @ ' + wt + ' · goal ' + p.targetReps;
  }

  // Finished exercises the person opened again (they show as one-line rows otherwise). Not saved.
  const openDone = new WeakSet();
  function renderActiveWorkout(w) {
    const day = dayById(w.dayId);
    // Soreness prompts: one per muscle with prior history
    const muscles = [];
    w.entries.forEach((en) => { const ex = exById(en.exId); if (ex && !muscles.includes(ex.muscle)) muscles.push(ex.muscle); });
    const askable = muscles.filter((m) => w.entries.some((en) => { const ex = exById(en.exId); return ex && ex.muscle === m && lastEntryFor(en.exId); }));
    let sorenessHtml = '';
    const editing = ui.sorenessEdit === w.id;
    if (askable.length && !editing && askable.every((m) => w.soreness[m] != null)) {
      // Every question answered: fold to one line.
      sorenessHtml = '<div class="card fold-row" id="soreness-card"><b>Check-in done</b><button class="btn small ghost" data-action="soreness-edit">Edit</button></div>';
    } else if (askable.length) {
      sorenessHtml = '<div class="card" id="soreness-card"><h3 class="mb8">Check-in</h3>' + askable.map((m) => {
        const v = w.soreness[m];
        return '<div class="prompt"><div class="prompt-q">How sore did your <span style="color:var(--accent-2)">' + esc(m.toLowerCase()) + '</span> get after last time?</div>'
          + '<div class="choice-grid">' + SORENESS.map((lbl, i) => '<button class="choice ' + (v === i ? 'on' : '') + '" data-action="set-soreness" data-m="' + esc(m) + '" data-v="' + i + '">' + lbl + '</button>').join('') + '</div></div>';
      }).join('') + (editing ? '<button class="btn ghost block" data-action="soreness-done">Done</button>' : '') + '</div>';
    }

    const cards = w.entries.map((en, idx) => renderEntryCard(w, en, idx)).join('');
    const doneCount = w.entries.filter((e) => e.done).length;
    return '<div class="screen-title"><div><h1>' + esc(w.dayName) + '</h1><span class="sub">' + fmtDate(w.date) + ' · ' + doneCount + '/' + w.entries.length + ' done · <span id="elapsed">' + durationText(w) + '</span></span></div>'
      + '<button class="btn small ghost" data-action="add-entry">+ Exercise</button></div>'
      + '<div class="deload-bar"><button class="deload-toggle' + (w.deload ? ' on' : '') + '" data-action="toggle-deload" aria-pressed="' + !!w.deload + '"><span class="sw"></span>Deload session</button>'
      + (w.deload ? '<div class="small deload-hint">Deload: keep your weights (or a little lighter), do about half the sets, stop 3 or more reps short.</div>' : '') + '</div>'
      + sorenessHtml + cards + renderCardioCard(w)
      + '<div class="btn-row mt12"><button class="btn subtle" data-action="discard-workout">Discard</button><button class="btn success" data-action="finish-workout">Finish workout</button></div>';
  }

  // ---- Cardio after lifting -----------------------------------------------
  // One cardio block at the end of each workout (Settings → Cardio). Incline and speed carry over from last time.
  const speedUnit = () => (state.settings.units === 'kg' ? 'km/h' : 'mph');
  function lastCardio() {
    for (let i = state.workouts.length - 1; i >= 0; i--) { const c = state.workouts[i].cardio; if (state.workouts[i].finishedAt && c && c.done) return c; }
    return null;
  }
  function ensureCardio(w) {
    if (w.cardio || !state.settings.cardioOn) return w.cardio;
    const last = lastCardio();
    w.cardio = { name: state.settings.cardioName || 'Cardio', min: state.settings.cardioMin || 20, incline: last ? last.incline : null, speed: last ? last.speed : null, speedUnit: speedUnit(), done: false };
    return w.cardio;
  }
  // Walking energy cost (ACSM): VO2 = 0.1·speed + 1.8·speed·grade + 3.5 ml/kg/min, speed in m/min; ~5 kcal per litre O2.
  function cardioKcal(c) {
    const bw = bwSorted().slice(-1)[0];
    if (!bw || !(c.speed > 0) || !(c.min > 0)) return null;
    const kg = state.settings.units === 'kg' ? bw.weight : bw.weight * 0.4536;
    const mpm = c.speed * (c.speedUnit === 'km/h' ? 1000 / 60 : 1609.34 / 60);
    if (mpm > 134) return null; // over ~5 mph is running; the walking formula no longer fits
    const vo2 = 0.1 * mpm + 1.8 * mpm * ((c.incline || 0) / 100) + 3.5;
    return Math.round(vo2 * kg / 1000 * 5 * c.min);
  }
  function cardioText(c) {
    const kcal = c.kcal != null ? c.kcal : cardioKcal(c);
    return c.min + ' min' + (c.incline != null ? ' · ' + fmtW(c.incline) + '% incline' : '') + (c.speed ? ' · ' + fmtW(c.speed) + ' ' + (c.speedUnit || speedUnit()) : '') + (kcal ? ' · ≈' + kcal + ' kcal' : '');
  }
  function renderCardioCard(w) {
    const c = ensureCardio(w); if (!c) return '';
    const running = timer.handle && timer.kind === 'cardio';
    const last = lastCardio();
    const field = (label, k, val, step) => '<div class="field"><label>' + label + '</label><input class="input" type="number" inputmode="decimal" step="' + step + '" min="0" value="' + (val == null ? '' : esc(val)) + '" data-field="cardio" data-k="' + k + '"' + (c.done ? ' disabled' : '') + '></div>';
    // Done keeps the same layout, so nothing slides under the finger that tapped Done: Undo takes the timer
    // button's place and a disabled "Logged" sits where Done was.
    return '<div class="card' + (c.done ? ' flat' : '') + '" id="cardio-card"><div class="row between"><h3>' + esc(c.name) + '</h3>' + (c.done ? '<span class="pill green">Done</span>' : '<span class="pill">Cardio</span>') + '</div>'
      + '<div class="field-row mt8">' + field('Minutes', 'min', c.min, '1') + field('Incline %', 'incline', c.incline, '0.5') + field('Speed ' + esc(c.speedUnit || speedUnit()), 'speed', c.speed, '0.1') + '</div>'
      // Last time before Done, today's summary after. Both sit in one spot and it keeps the taller one's height, so Done never changes it.
      + '<div class="tiny muted mb8 cardio-line"><span' + (c.done ? ' class="off"' : '') + '>' + esc(last ? 'Last time: ' + cardioText(last) : 'First time logging cardio') + '</span>'
      + '<span id="cardio-today"' + (c.done ? '' : ' class="off"') + '>Today: ' + esc(cardioText(c)) + '</span></div>'
      + (c.done
        ? '<div class="btn-row"><button class="btn subtle" data-action="cardio-undo">Undo</button><button class="btn success" disabled>Logged ✓</button></div>'
        : '<div class="btn-row"><button class="btn ghost" data-action="cardio-timer">' + (running ? 'Restart timer' : 'Start ' + c.min + ':00 timer') + '</button><button class="btn success" data-action="cardio-done">Done ✓</button></div>')
      + '</div>';
  }

  function renderEntryCard(w, en, idx) {
    const ex = exById(en.exId);
    if (!ex) return '';
    const p = prescFor(en.exId);
    const r = repRange(ex);
    if (en.done && !openDone.has(en)) {
      // A finished exercise folds to one row: name, sets done, PR mark, next time's weight. Tap to open the full card.
      const n = en.sets.filter((s) => s.done && s.reps > 0).length;
      const nx = en.next || p;
      return '<div class="card ex-card done compact" data-card="' + idx + '"><button class="ex-fold" data-action="open-entry" data-e="' + idx + '"><span class="ex-fold-tick">✓</span>'
        + '<span class="grow"><span class="ex-fold-name">' + esc(ex.name) + '</span><span class="ex-fold-sub">' + plural(n, 'set') + ' · next ' + (nx.weight > 0 ? esc(fmtW(nx.weight)) + ' ' + state.settings.units : 'goal ' + esc(nx.targetReps) + ' reps') + '</span></span>'
        + (en.prs && en.prs.length ? '<span class="pill pr">🏆 PR</span>' : '') + '<span class="chev">›</span></button></div>';
    }
    const last = lastEntryFor(en.exId);
    const lastText = last ? 'Last time' + (last.workout.deload ? ' (deload)' : '') + ': ' + last.entry.sets.filter((s) => s.done).map((s) => fmtW(s.weight) + '×' + s.reps).join(', ') : 'First time logging this';
    const reason = (!en.done && p.reasons && p.reasons.length) ? '<div class="ex-reason ' + (/\+/.test(p.reasons[0]) ? 'green' : '') + '">' + esc(p.reasons[0]) + '</div>' : '';

    const rir = !!state.settings.trackRir;
    // Reps in reserve: once a set is ticked, four buttons under it (3+ 2 1 0). One tap picks, tapping the picked one clears it.
    // Every set of an open exercise has its row, greyed out until the set is ticked, so ticking or unticking changes
    // no heights: the ticks below stay where they were (catching up on several sets must not land on a RIR button).
    const rirRow = (s, i) => {
      if (!s.done) return '<tr class="rir-row idle" aria-hidden="true"><td colspan="4"><div class="rir-pick"><span class="rir-label">Reps left</span>'
        + [3, 2, 1, 0].map((v) => '<button class="rir-btn" tabindex="-1" disabled>' + rirText(v) + '</button>').join('') + '</div></td></tr>';
      return '<tr class="rir-row"><td colspan="4"><div class="rir-pick"><span class="rir-label">Reps left</span>'
        + [3, 2, 1, 0].map((v) => { const on = rirIs(s.rir, v); return '<button class="rir-btn' + (on ? ' on' : '') + '" aria-pressed="' + on + '" aria-label="Set ' + (i + 1) + ': ' + rirText(v) + ' reps left" data-action="pick-rir" data-e="' + idx + '" data-s="' + i + '" data-v="' + v + '">' + rirText(v) + '</button>'; }).join('')
        + '</div></td></tr>';
    };
    const rows = en.sets.map((s, i) => '<tr class="set-row ' + (s.done ? 'done' : '') + '">'
      + '<td class="n">' + (i + 1) + '</td>'
      + '<td><input class="set-input" type="number" inputmode="decimal" step="any" min="0" value="' + (s.weight || '') + '" placeholder="' + state.settings.units + '" data-field="weight" data-e="' + idx + '" data-s="' + i + '" ' + (en.done ? 'disabled' : '') + '></td>'
      + '<td><input class="set-input" type="number" inputmode="numeric" min="0" value="' + (s.reps || '') + '" placeholder="' + (en.targetReps || 'reps') + '" data-field="reps" data-e="' + idx + '" data-s="' + i + '" ' + (en.done ? 'disabled' : '') + '></td>'
      + '<td class="chk"><button class="check ' + (s.done ? 'on' : '') + '" data-action="toggle-set" data-e="' + idx + '" data-s="' + i + '" ' + (en.done ? 'disabled' : '') + '>✓</button></td>'
      + '</tr>' + (rir && !en.done ? rirRow(s, i) : '')).join('');

    let warmHtml = '';
    if (en.warmups && en.warmups.length && !en.done) {
      warmHtml = '<div class="warmups"><div class="row between"><span class="tiny muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.05em">Warm-up</span><button class="btn small subtle" data-action="clear-warmup" data-e="' + idx + '">✕</button></div>'
        + en.warmups.map((wu, i) => '<div class="warmup-row ' + (wu.done ? 'done' : '') + '"><span class="n">W' + (i + 1) + '</span><span class="grow"><b>' + fmtW(wu.weight) + '</b> ' + state.settings.units + ' × <b>' + wu.reps + '</b></span><button class="check small ' + (wu.done ? 'on' : '') + '" data-action="toggle-warmup" data-e="' + idx + '" data-s="' + i + '">✓</button></div>').join('') + '</div>';
    }
    const prPill = en.prs && en.prs.length ? '<span class="pill pr">🏆 PR</span>' : '';
    const swapNote = en.swappedFrom ? (function () { const o = exById(en.swappedFrom); return o ? '<div class="ex-last">Swapped in for ' + esc(o.name) + ' today</div>' : ''; })() : '';

    const allDone = en.sets.length > 0 && en.sets.every((s) => s.done);
    let feedback = '';
    if (!en.done && en.sets.some((s) => s.done) && !w.deload) {
      feedback = '<div class="prompt mt12"><div class="prompt-q">How was it? <span class="hint">(optional, adjusts your sets)</span></div>'
        + choiceRow('Pump', PUMP, en.pump, idx, 'pump')
        + choiceRow('Joint pain', JOINT, en.joint, idx, 'joint')
        + choiceRow('Workload', WORKLOAD, en.workload, idx, 'workload')
        + '</div>';
    }
    let nextBox = '';
    if (en.done && en.next) {
      nextBox = '<div class="next-box"><div class="headline">Next time: ' + en.next.sets + ' × ' + r.min + '–' + r.max + ' @ ' + fmtW(en.next.weight) + ' ' + state.settings.units + ', goal ' + en.next.targetReps + '</div>'
        + '<ul>' + en.next.reasons.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
    } else if (en.done && w.deload) {
      nextBox = '<div class="next-box"><div class="headline">Deload: plan kept</div><ul><li>' + esc('Next time stays ' + p.sets + ' × ' + r.min + '–' + r.max + (p.weight > 0 ? ' @ ' + fmtW(p.weight) + ' ' + state.settings.units : '') + ', goal ' + p.targetReps) + '</li></ul></div>';
    }

    const body = en.done
      ? '<div class="ex-body">' + nextBox + '<div class="card-actions"><button class="btn small subtle" data-action="reopen-entry" data-e="' + idx + '">Edit</button><button class="btn small subtle" data-action="close-entry" data-e="' + idx + '">Hide</button></div></div>'
      : '<div class="ex-body">' + warmHtml + '<table class="set-table"><thead><tr><th class="n">Set</th><th>' + state.settings.units + (ex.equipment === 'Dumbbell' ? ' (each)' : '') + '</th><th>Reps</th>' + '<th></th></tr></thead><tbody>' + rows + '</tbody></table>'
        + '<div class="set-tools"><button class="btn small ghost" data-action="add-set" data-e="' + idx + '">+ Set</button><button class="btn small subtle" data-action="remove-set" data-e="' + idx + '" ' + (en.sets.length <= 1 ? 'disabled' : '') + '>− Set</button><button class="btn small subtle" data-action="gen-warmup" data-e="' + idx + '" ' + (en.warmups && en.warmups.length ? 'disabled' : '') + '>Warm-up</button></div>'
        + '<div class="set-tools secondary"><button class="btn small subtle" data-action="swap-entry" data-e="' + idx + '">Swap exercise</button><button class="btn small subtle" data-action="remove-entry" data-e="' + idx + '">Remove</button></div>'
        + feedback
        + '<button class="btn block mt12 ' + (allDone ? '' : 'ghost') + '" data-action="finish-entry" data-e="' + idx + '" ' + (en.sets.some((s) => s.done || s.reps > 0) ? '' : 'disabled') + '>Finish exercise</button></div>';

    return '<div class="card ex-card ' + (en.done ? 'done' : '') + '" data-card="' + idx + '"><div class="ex-head">'
      + '<div class="row between"><div class="ex-name">' + esc(ex.name) + '</div><span class="row" style="gap:6px">' + prPill + '<span class="pill">' + esc(ex.muscle) + '</span></span></div>'
      + '<div class="ex-presc">' + p.sets + ' sets × ' + r.min + '–' + r.max + (p.weight > 0 ? ' @ <strong>' + fmtW(p.weight) + ' ' + state.settings.units + '</strong>' : '') + ' · goal <strong>' + en.targetReps + ' reps</strong></div>'
      + '<div class="ex-last">' + esc(lastText) + '</div>' + swapNote
      + (ex.notes ? '<div class="ex-note">' + esc(ex.notes) + '</div>' : '')
      + (en.done && en.prs && en.prs.length ? '<div class="ex-reason green">🏆 ' + esc(en.prs.map((x) => x.text).join(' · ')) + '</div>' : '')
      + reason + '</div>' + body + '</div>';
  }

  // RIR: 3 means "3 or more" (enough to count as easy), so the button reads 3+.
  function rirText(v) { return v == null ? '–' : v >= 3 ? '3+' : String(v); }
  function rirIs(stored, v) { return stored != null && (stored === v || (v === 3 && stored >= 3)); }

  function choiceRow(label, opts, val, idx, field) {
    return '<div class="tiny muted mt8 mb8" style="font-weight:700;text-transform:uppercase;letter-spacing:.05em">' + label + '</div><div class="choice-grid">'
      + opts.map((o, i) => '<button class="choice ' + (val === i ? 'on' : '') + '" data-action="set-fb" data-e="' + idx + '" data-f="' + field + '" data-v="' + i + '">' + o + '</button>').join('') + '</div>';
  }

  // ---- Program -------------------------------------------------------------
  function renderProgram() {
    const days = state.program.days.map((d) => {
      const names = d.exercises.map((id) => { const ex = exById(id); return ex ? esc(ex.name) : ''; }).filter(Boolean);
      const sched = WEEKDAYS.filter((_, i) => state.program.schedule[i] === d.id).join(' · ');
      return '<div class="card"><div class="card-head"><div><h2>' + esc(d.name) + '</h2><div class="meta">' + (sched || 'Not scheduled') + ' · ' + plural(d.exercises.length, 'exercise') + '</div></div>'
        + '<button class="btn small ghost" data-action="edit-day" data-day="' + d.id + '">Edit</button></div>'
        + '<div class="small muted">' + (names.join(', ') || 'No exercises') + '</div></div>';
    }).join('');

    const schedule = WEEKDAYS_LONG.map((d, i) => '<div class="toggle-row"><span>' + d + '</span><select class="select" style="width:auto;min-width:170px" data-field="schedule" data-i="' + i + '">'
      + '<option value="">Rest</option>' + state.program.days.map((x) => '<option value="' + x.id + '" ' + (state.program.schedule[i] === x.id ? 'selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></div>').join('');

    const templates = state.templates.map((t) => '<div class="list-item"><div class="grow"><div class="title">' + esc(t.name).replace(/\//g, '/<wbr>') + '</div><div class="sub">' + plural(t.days.length, 'day') + ' · saved ' + fmtDate(t.savedAt) + '</div></div>'
      + '<button class="btn small ghost" data-action="use-template" data-t="' + t.id + '">Use</button><button class="icon-btn danger" data-action="delete-template" data-t="' + t.id + '">✕</button></div>').join('');

    return '<div class="screen-title"><h1>Program</h1><button class="btn small" data-action="add-day">+ Day</button></div>'
      + days + '<div class="group-title">Weekly schedule</div><div class="card">' + schedule + '</div>'
      + renderLibrary()
      + '<div class="group-title">Templates</div><div class="card"><p class="small muted mb8">Save this split so you can switch to another one later without rebuilding it. Weights and set counts live on the exercises, so they carry over.</p>'
      + '<div class="list">' + templates + '</div><button class="btn ghost block mt12" data-action="save-template">Save current program as template</button></div>';
  }

  // Built-in programs (programs.js). Listed on the Program screen; View shows the plan, Use switches to it.
  const programs = () => window.__overloadPrograms || [];
  function renderLibrary() {
    const list = programs(); if (!list.length) return '';
    return '<div class="group-title">Program library</div><div class="list">' + list.map((p) => '<button class="list-item" data-action="program-view" data-p="' + p.id + '"><div class="grow"><div class="title">' + esc(p.name) + '</div><div class="sub">'
      + esc(p.by) + ' · ' + plural(p.schedule.filter((x) => x != null).length, 'day') + ' a week</div></div><span class="chev">›</span></button>').join('') + '</div>';
  }
  function exByName(name) { const n = name.toLowerCase(); return state.exercises.find((e) => e.name.toLowerCase() === n); }
  function sheetProgram(id) {
    const p = programs().find((x) => x.id === id); if (!p) return;
    const week = WEEKDAYS.map((d, i) => '<span class="pill' + (p.schedule[i] == null ? '' : ' accent') + '">' + d + ' ' + (p.schedule[i] == null ? 'Rest' : esc(p.days[p.schedule[i]].short || p.days[p.schedule[i]].name)) + '</span>').join(' ');
    const days = p.days.map((d) => '<div class="card flat"><b>' + esc(d.name) + '</b>' + d.ex.map(([name, sets, reps, note]) => {
      const fst = /\(FST-7\)$/.test(name);
      return '<div class="hist-set"><span>' + esc(name) + (exByName(name) ? '' : ' <span class="pill">new</span>') + '</span><span class="nowrap">' + (fst ? '<span class="pill amber">FST-7</span> ' : '') + sets + ' × ' + esc(reps) + '</span></div>'
        + (note ? '<div class="tiny muted mb8">' + esc(note) + '</div>' : '');
    }).join('') + '</div>').join('');
    openSheet(sheetHeader(esc(p.name))
      + '<p class="small muted mb8">' + esc(p.by) + '. ' + esc(p.about) + '</p>'
      + '<div class="row mb8" style="flex-wrap:wrap;gap:6px">' + week + '</div>'
      + (p.how ? '<div class="card flat small">' + esc(p.how) + '</div>' : '')
      + days
      + '<p class="tiny muted mt8">Sets × reps as the program writes them. Using it gives every exercise these sets and rep ranges; exercises marked <b>new</b> are added to your list. Your weights stay. If some exercises already have your own logged sets, you are asked first whether to switch those too.'
      + (p.source ? ' Source: ' + esc(p.source) + '.' : '') + '</p>'
      + '<button class="btn block mt12" data-action="program-use" data-p="' + p.id + '">Use this program</button>');
  }
  // Adds any exercise the program needs that you do not have yet. FST-7 finishers are their own
  // exercise ("Pec Deck (FST-7)") so their lighter 7-set weights never mix with your normal ones.
  function ensureProgramExercise(name, sets, reps, note) {
    let ex = exByName(name); if (ex) return ex.id;
    const fst = /\s*\(FST-7\)$/.test(name);
    const base = exByName(name.replace(/\s*\(FST-7\)$/, ''));
    const baseName = name.replace(/\s*\(FST-7\)$/, '');
    const builtIn = LIBRARY.concat(LIBRARY_V2).find((x) => x[0].toLowerCase() === baseName.toLowerCase());
    const lib = (window.__overloadProgramExercises || {})[baseName] || (builtIn ? builtIn.slice(1) : []);
    const [lo, hi] = String(reps).split(/[–-]/).map((x) => parseInt(x, 10));
    const muscle = (base && base.muscle) || lib[0] || 'Chest';
    const big = ['Chest', 'Back', 'Quads', 'Hamstrings', 'Glutes'].includes(muscle);
    ex = { id: uid(), name, muscle, equipment: (base && base.equipment) || lib[1] || 'Machine', increment: null,
      repMin: lo > 0 ? lo : null, repMax: hi >= lo ? hi : (lo > 0 ? lo : null), custom: true,
      notes: programNote(name, muscle, note),
      restSec: fst ? (big ? 50 : 35) : null, fixedSets: fst ? 7 : null };
    state.exercises.push(ex);
    state.presc[ex.id] = { weight: 0, targetReps: ex.repMin || state.settings.repMin, sets: fst ? 7 : clamp(sets, 1, state.settings.maxSets), reasons: [], updatedAt: null };
    return ex.id;
  }
  function programNote(name, muscle, note) {
    if (!/\(FST-7\)$/.test(name)) return note || null;
    return 'FST-7: 7 sets, ' + (['Chest', 'Back', 'Quads', 'Hamstrings', 'Glutes'].includes(muscle) ? '45–60' : '30–45') + ' s rest. Stretch the muscle and sip water between sets';
  }
  // After a rep range change the goal starts at the new bottom; an old reason line would contradict it.
  function goalToRange(ex, p) {
    const r = repRange(ex);
    p.targetReps = r.min;
    if (p.reasons && p.reasons.length) p.reasons = ['New rep range ' + r.min + '–' + r.max + ' → aim for ' + r.min];
  }
  // True when the exercise has a done set with reps in a finished workout or in the one in progress.
  function everLogged(exId) {
    return state.workouts.some((w) => (w.finishedAt || w.id === state.active) && w.entries.some((en) => en.exId === exId && en.sets.some((s) => s.done && s.reps > 0)));
  }
  // Give an exercise you already have a program row's rep range and set count, and its note when asked and the
  // exercise has none. Weights stay; fixed sets (FST-7) stay. Returns true when the range or set count
  // changes (with dry set, only says whether they would).
  function applyProgramRow(ex, row, withNote, dry) {
    const [name, sets, reps, note] = row;
    const [lo, hi] = String(reps).split(/[–-]/).map((x) => parseInt(x, 10));
    const repMin = lo > 0 ? lo : null, repMax = hi >= lo ? hi : repMin;
    const was = repRange(ex), p = state.presc[ex.id];
    const newSets = ex.fixedSets || clamp(sets, 1, state.settings.maxSets);
    const rangeChanged = !!repMin && (was.min !== repMin || was.max !== repMax);
    const setsChanged = newSets !== (p ? p.sets : ex.fixedSets || state.settings.defaultSets);
    const newNote = withNote && !ex.notes ? programNote(name, ex.muscle, note) : null;
    if (dry) return rangeChanged || setsChanged;
    if (repMin) { ex.repMin = repMin; ex.repMax = repMax; }
    if (newNote) ex.notes = newNote;
    const pp = prescFor(ex.id);
    pp.sets = newSets; pp.soreCut = false;  // the program's count is the new baseline: no cut set to give back
    if (rangeChanged) goalToRange(ex, pp);
    // Undoing a later Edit or deleting a workout restores the numbers from before it: keep those on the program too.
    state.workouts.forEach((w) => w.entries.forEach((en) => {
      if (en.exId !== ex.id || !en.prevPresc) return;
      en.prevPresc.sets = newSets; en.prevPresc.soreCut = false;
      if (rangeChanged) goalToRange(ex, en.prevPresc);
    }));
    return rangeChanged || setsChanged;
  }
  // A program's shape by names, so an untouched copy of a template or built-in program is recognized.
  function programSig(days, schedule, nameOf) {
    return JSON.stringify([days.map((d) => [d.name, d.exercises.map(nameOf)]), schedule.map((i) => (i == null ? null : days[i].name))]);
  }
  function alreadySaved() {
    const exName = (id) => { const e = exById(id); return e ? e.name.toLowerCase() : id; };
    const idx = (days, sched) => sched.map((id) => { const i = days.findIndex((d) => d.id === id); return i < 0 ? null : i; });
    const cur = programSig(state.program.days, idx(state.program.days, state.program.schedule), exName);
    return state.templates.some((t) => programSig(t.days, idx(t.days, t.schedule), exName) === cur)
      || programs().some((p) => programSig(p.days.map((d) => ({ name: d.name, exercises: d.ex.map((e) => e[0]) })), p.schedule, (n) => n.toLowerCase()) === cur);
  }
  function useProgram(id) {
    const p = programs().find((x) => x.id === id); if (!p) return;
    const keep = state.program.days.length && !alreadySaved();
    if (!confirm('Switch to "' + p.name + '"? Your days and weekly schedule are replaced.' + (keep ? ' Your current days and schedule are saved under Templates first, so you can switch back to them.' : ''))) return;
    // Exercises you already have take the program's numbers from their first row in it. Ask before
    // changing ones you have logged sets for.
    const first = {};
    p.days.forEach((d) => d.ex.forEach((row) => { const k = row[0].toLowerCase(); if (!first[k]) first[k] = row; }));
    const mine = Object.keys(first).map((k) => exByName(first[k][0])).filter(Boolean);
    const logged = new Set(mine.filter((ex) => everLogged(ex.id)).map((ex) => ex.id));
    const ask = mine.filter((ex) => logged.has(ex.id) && applyProgramRow(ex, first[ex.name.toLowerCase()], false, true)).length;
    const switchLogged = ask > 0 && confirm(plural(ask, 'exercise') + ' in this program already ' + (ask === 1 ? 'has' : 'have') + ' your own logged sets. Also switch ' + (ask === 1 ? 'it' : 'them') + ' to the program\'s sets and rep ranges? Your weights stay. Switching back later does not bring your own sets and ranges back.');
    // A copy saved by an earlier apply has the same name: add the date (and a number if needed) so they differ.
    let tName = 'My program (before ' + p.name + ')';
    const taken = (n) => (state.templates || []).some((t) => t && t.name === n);
    if (taken(tName)) { const base = tName + ' · ' + fmtDate(todayKey()); tName = base; for (let n = 2; taken(tName); n++) tName = base + ' (' + n + ')'; }
    if (keep) state.templates.push({ id: uid(), name: tName, days: JSON.parse(JSON.stringify(state.program.days)), schedule: state.program.schedule.slice(), savedAt: todayKey() });
    let changed = 0;
    mine.forEach((ex) => { if ((!logged.has(ex.id) || switchLogged) && applyProgramRow(ex, first[ex.name.toLowerCase()], !logged.has(ex.id))) changed++; });
    const before = state.exercises.length;
    const days = p.days.map((d) => ({ id: uid(), name: d.name, exercises: d.ex.map(([name, sets, reps, note]) => ensureProgramExercise(name, sets, reps, note)) }));
    state.program = { days, schedule: p.schedule.map((i) => (i == null ? null : days[i].id)) };
    const added = state.exercises.length - before;
    save(); closeSheet(); render(); toast('Now using ' + p.name + (added ? ' · ' + plural(added, 'new exercise') : '') + (changed ? ' · ' + plural(changed, 'exercise') + ' set to the program\'s sets and reps' : ''));
  }

  // ---- Exercises -----------------------------------------------------------
  function renderExercises() {
    const q = ui.search.trim().toLowerCase();
    const list = state.exercises.filter((e) => !q || e.name.toLowerCase().includes(q) || e.muscle.toLowerCase().includes(q));
    const groups = MUSCLES.map((m) => {
      const items = list.filter((e) => e.muscle === m);
      if (!items.length) return '';
      return '<div class="group-title">' + m + '</div><div class="list">' + items.map((ex) => {
        const p = state.presc[ex.id];
        const sub = p && p.weight > 0 ? p.sets + ' × goal ' + p.targetReps + ' @ ' + fmtW(p.weight) + ' ' + state.settings.units : esc(ex.equipment) + (ex.custom ? ' · custom' : '');
        return '<button class="list-item" data-action="edit-ex" data-ex="' + ex.id + '"><div class="grow"><div class="title">' + esc(ex.name) + '</div><div class="sub">' + sub + '</div></div><span class="chev">›</span></button>';
      }).join('') + '</div>';
    }).join('');
    return '<div class="screen-title"><h1>Exercises</h1><button class="btn small" data-action="new-ex">+ New</button></div>'
      + '<input class="input" type="search" placeholder="Search" value="' + esc(ui.search) + '" data-field="search">'
      + (groups || '<div class="empty">No matches</div>');
  }

  // ---- History -------------------------------------------------------------
  function renderHistory() {
    const done = state.workouts.filter((w) => w.finishedAt).slice().reverse();
    const monthKey = todayKey().slice(0, 7);
    const thisMonth = done.filter((w) => w.date.slice(0, 7) === monthKey).length;
    const st = streakInfo();
    const stats = '<div class="stat-row mb8"><div class="stat"><div class="v">' + (st.streak ? '🔥 ' + st.streak : '0') + '</div><div class="k">Day streak</div></div><div class="stat"><div class="v">' + thisMonth + '</div><div class="k">This month</div></div><div class="stat"><div class="v">' + done.length + '</div><div class="k">Workouts</div></div></div>';

    const tracked = state.exercises.filter((e) => lastEntryFor(e.id));
    const chartSel = tracked.length ? '<div class="card"><div class="field"><label>Progress</label><select class="select" data-field="chart-ex"><option value="">Pick an exercise…</option>'
      + tracked.map((e) => '<option value="' + e.id + '" ' + (ui.chartEx === e.id ? 'selected' : '') + '>' + esc(e.name) + '</option>').join('') + '</select></div>'
      + (ui.chartEx ? renderChart(ui.chartEx) : '') + '</div>' : '';

    const items = done.map((w) => {
      const sets = w.entries.reduce((m, e) => m + e.sets.filter((s) => s.done).length, 0);
      const ups = w.entries.filter((e) => wentUp(e)).length;
      const prs = w.entries.filter((e) => e.prs && e.prs.length).length;
      return '<button class="list-item" data-action="view-workout" data-w="' + w.id + '"><div class="grow"><div class="title">' + esc(w.dayName) + (w.deload ? ' <span class="pill amber">Deload</span>' : '') + '</div><div class="sub">' + fmtDate(w.date) + ' · ' + plural(w.entries.filter((e) => e.done).length, 'exercise') + ' · ' + plural(sets, 'set') + (durationText(w) ? ' · ' + durationText(w) : '') + (w.cardio && w.cardio.done ? ' · 🚶 ' + w.cardio.min + ' min' : '') + (ups ? ' · <span style="color:var(--green)">' + ups + ' weight ↑</span>' : '') + (prs ? ' · 🏆 ' + prs : '') + '</div></div><span class="chev">›</span></button>';
    }).join('');

    return '<div class="screen-title"><h1>History</h1></div>' + stats + renderVolumeCard() + renderReviewCard() + renderCalendar() + chartSel + renderBwCard() + renderSleepCard()
      + '<div class="group-title">Workouts</div><div class="list">' + (items || '<div class="empty">No workouts yet. Finish one and it shows up here.</div>') + '</div>';
  }

  // ---- Weekly volume -------------------------------------------------------
  // Progress on the load: heavier, or for assisted lifts less assistance.
  function wentUp(en) {
    if (!en.next || !(en.weightAtStart > 0)) return false;
    return isAssisted(exById(en.exId)) ? en.next.weight < en.weightAtStart : en.next.weight > en.weightAtStart;
  }
  function setsPerMuscle(fromKey, toKey, finishedOnly) {
    const out = {};
    state.workouts.forEach((w) => {
      if (w.date < fromKey || w.date > toKey) return;
      if (finishedOnly && !w.finishedAt) return;
      w.entries.forEach((en) => { const ex = exById(en.exId); if (!ex) return; const n = en.sets.filter((s) => s.done && s.reps > 0).length; if (n) out[ex.muscle] = (out[ex.muscle] || 0) + n; });
    });
    return out;
  }
  function renderVolumeCard() {
    const from = weekStart(todayKey()), to = addDays(from, 6);
    const vol = setsPerMuscle(from, to);
    const inProgram = new Set();
    state.program.schedule.forEach((dayId) => { const d = dayId && dayById(dayId); if (d) d.exercises.forEach((id) => { const ex = exById(id); if (ex) inProgram.add(ex.muscle); }); });
    const muscles = MUSCLES.filter((m) => vol[m] || inProgram.has(m));
    if (!muscles.length) return '';
    const lo = state.settings.volumeMin, hi = state.settings.volumeMax;
    const rows = muscles.map((m) => {
      const n = vol[m] || 0;
      const cls = n >= hi ? 'high' : n >= lo ? 'ok' : 'low';
      const pct = Math.min(100, Math.round((n / Math.max(hi, 1)) * 100));
      return '<div class="vol-row"><span class="vol-name">' + m + '</span><span class="vol-bar"><span class="vol-fill ' + cls + '" style="width:' + pct + '%"></span></span><span class="vol-n ' + cls + '">' + n + '</span></div>';
    }).join('');
    return '<div class="card"><div class="row between mb8"><b>This week\'s sets per muscle</b><span class="pill">target ' + lo + '–' + hi + '</span></div>' + rows + '<div class="tiny muted mt8">' + fmtDate(from) + ' to ' + fmtDate(to) + '. Amber is under target, green is in range, red is over.</div></div>';
  }

  // ---- Consistency calendar ------------------------------------------------
  function renderCalendar() {
    const now = new Date(); const base = new Date(now.getFullYear(), now.getMonth() + ui.calOffset, 1);
    const y = base.getFullYear(), m = base.getMonth();
    const first = (base.getDay() + 6) % 7; const daysIn = new Date(y, m + 1, 0).getDate();
    const byDate = {};
    state.workouts.forEach((w) => { if (w.finishedAt) (byDate[w.date] = byDate[w.date] || []).push(w); });
    const today = todayKey();
    let cells = '';
    for (let i = 0; i < first; i++) cells += '<span class="cal-cell empty"></span>';
    for (let d = 1; d <= daysIn; d++) {
      const key = todayKey(new Date(y, m, d));
      const ws = byDate[key] || [];
      const wd = (new Date(y, m, d).getDay() + 6) % 7;
      const rest = state.program.schedule[wd] == null;
      const cls = ['cal-cell', ws.length ? 'hit' : '', key === today ? 'today' : '', key > today ? 'future' : '', rest && !ws.length ? 'rest' : ''].join(' ');
      cells += ws.length ? '<button class="' + cls + '" data-action="view-workout" data-w="' + ws[0].id + '" title="' + esc(ws.map((w) => w.dayName).join(', ')) + '">' + d + '</button>' : '<span class="' + cls + '">' + d + '</span>';
    }
    const count = Object.keys(byDate).filter((k) => k.slice(0, 7) === (y + '-' + String(m + 1).padStart(2, '0'))).length;
    return '<div class="card"><div class="row between mb8"><button class="icon-btn" data-action="cal-prev">‹</button><b>' + base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) + '</b><button class="icon-btn" data-action="cal-next" ' + (ui.calOffset >= 0 ? 'disabled' : '') + '>›</button></div>'
      + '<div class="cal-grid">' + WEEKDAYS.map((d) => '<span class="cal-head">' + d[0] + '</span>').join('') + cells + '</div>'
      + '<div class="tiny muted mt8">' + plural(count, 'training day') + ' this month. Faded days are rest days in your schedule.</div></div>';
  }

  // ---- Weekly review -------------------------------------------------------
  function weekReview(offset) {
    const start = addDays(weekStart(todayKey()), -7 * offset), end = addDays(start, 6);
    const ws = state.workouts.filter((w) => w.finishedAt && w.date >= start && w.date <= end);
    let sets = 0, tonnage = 0; const prs = [], ups = [];
    ws.forEach((w) => w.entries.forEach((en) => {
      const ex = exById(en.exId); const name = ex ? ex.name : 'Deleted exercise';
      en.sets.forEach((s) => { if (s.done && s.reps > 0) { sets++; tonnage += s.weight * s.reps; } });
      (en.prs || []).forEach((p) => prs.push(name + ': ' + p.text));
      if (wentUp(en)) ups.push(name + ' → ' + fmtW(en.next.weight) + ' ' + state.settings.units);
    }));
    const vol = setsPerMuscle(start, end, true);
    const topMuscles = Object.keys(vol).sort((a, b) => vol[b] - vol[a]).slice(0, 3).map((m) => m + ' ' + vol[m]);
    const bw = bwSorted().filter((b) => b.date >= start && b.date <= end);
    const bwPrev = bwSorted().filter((b) => b.date >= addDays(start, -7) && b.date < start);
    const avg = (arr) => (arr.length ? arr.reduce((n, b) => n + b.weight, 0) / arr.length : null);
    const cardioMin = ws.reduce((n, w) => n + (w.cardio && w.cardio.done ? w.cardio.min : 0), 0);
    return { start, end, workouts: ws.length, sets, tonnage, prs, ups, topMuscles, bwAvg: avg(bw), bwPrevAvg: avg(bwPrev), sleep: sleepAvg(7, end < todayKey() ? end : todayKey(), start), cardioMin };
  }
  function reviewText(r) {
    const u = state.settings.units;
    const lines = ['Overload week of ' + fmtDate(r.start) + ' to ' + fmtDate(r.end), plural(r.workouts, 'workout') + ' · ' + plural(r.sets, 'set') + ' · ' + Math.round(r.tonnage).toLocaleString() + ' ' + u + ' lifted'];
    if (r.topMuscles.length) lines.push('Most sets: ' + r.topMuscles.join(', '));
    if (r.ups.length) lines.push('Weight up: ' + r.ups.join(', '));
    if (r.prs.length) lines.push('PRs: ' + r.prs.join('; '));
    if (r.bwAvg != null) lines.push('Body weight avg ' + fmtW(r.bwAvg) + ' ' + u + (r.bwPrevAvg != null ? ' (' + (r.bwAvg - r.bwPrevAvg >= 0 ? '+' : '') + fmtW(r.bwAvg - r.bwPrevAvg) + ' vs last week)' : ''));
    if (r.cardioMin) lines.push('Cardio ' + r.cardioMin + ' min');
    if (r.sleep) lines.push('Sleep avg ' + fmtHM(r.sleep.total) + (r.sleep.rem != null ? ', REM ' + fmtHM(r.sleep.rem) : '') + (r.sleep.deep != null ? ', deep ' + fmtHM(r.sleep.deep) : '') + (r.sleep.recovery != null ? ', recovery ' + Math.round(r.sleep.recovery) + '%' : ''));
    return lines.join('\n');
  }
  function renderReviewCard() {
    const r = weekReview(ui.reviewOffset);
    const u = state.settings.units;
    const seg = '<div class="seg"><button class="' + (ui.reviewOffset === 0 ? 'on' : '') + '" data-action="review-set" data-v="0">This week</button><button class="' + (ui.reviewOffset === 1 ? 'on' : '') + '" data-action="review-set" data-v="1">Last week</button></div>';
    const bwLine = r.bwAvg != null ? '<li>Body weight avg <b>' + fmtW(r.bwAvg) + ' ' + u + '</b>' + (r.bwPrevAvg != null ? ' <span class="muted">(' + (r.bwAvg - r.bwPrevAvg >= 0 ? '+' : '') + fmtW(r.bwAvg - r.bwPrevAvg) + ' vs the week before)</span>' : '') + '</li>' : '';
    const extra = (r.cardioMin ? '<li>Cardio <b>' + r.cardioMin + ' min</b></li>' : '') + (r.sleep ? '<li>Sleep avg <b>' + fmtHM(r.sleep.total) + '</b>' + (r.sleep.rem != null ? ' · REM ' + fmtHM(r.sleep.rem) : '') + (r.sleep.deep != null ? ' · deep ' + fmtHM(r.sleep.deep) : '') + (r.sleep.recovery != null ? ' · recovery ' + Math.round(r.sleep.recovery) + '%' : '') + ' <span class="muted">(' + plural(r.sleep.n, 'night') + ')</span></li>' : '');
    const body = r.workouts
      ? '<div class="stat-row mb8"><div class="stat"><div class="v">' + r.workouts + '</div><div class="k">Workouts</div></div><div class="stat"><div class="v">' + r.sets + '</div><div class="k">Sets</div></div><div class="stat"><div class="v">' + (r.tonnage >= 10000 ? (r.tonnage / 1000).toFixed(1) + 'k' : Math.round(r.tonnage)) + '</div><div class="k">' + u + ' lifted</div></div></div>'
        + '<ul class="review-list">' + (r.ups.length ? '<li><b>Weight went up</b> on ' + esc(r.ups.join(', ')) + '</li>' : '<li>No weight increases yet this week.</li>') + (r.prs.length ? '<li><b>🏆 PRs:</b> ' + esc(r.prs.join('; ')) + '</li>' : '') + (r.topMuscles.length ? '<li>Most sets: ' + esc(r.topMuscles.join(', ')) + '</li>' : '') + bwLine + extra + '</ul>'
      : '<div class="empty small">No workouts logged for this week.</div>' + (bwLine || extra ? '<ul class="review-list">' + bwLine + extra + '</ul>' : '');
    return '<div class="card"><div class="row between mb8"><b>Weekly review</b>' + seg + '</div>' + body + '<button class="btn ghost block mt8" data-action="review-share" ' + (r.workouts ? '' : 'disabled') + '>Share</button></div>';
  }

  // ---- Sleep chart: last 14 nights, deep / REM / other stacked ------------------
  function renderSleepCard() {
    const list = sleepSorted(); if (!list.length) return '';
    const days = []; for (let i = 13; i >= 0; i--) days.push(addDays(todayKey(), -i));
    const by = {}; list.forEach((x) => { by[x.date] = x; });
    const W = 320, H = 150, padL = 26, padR = 6, padT = 8, padB = 22, top = Math.max(9 * 60, ...days.map((k) => (by[k] ? by[k].total : 0)));
    const bw = (W - padL - padR) / days.length;
    const y = (m) => padT + (1 - m / top) * (H - padT - padB);
    const bars = days.map((k, i) => { const x = by[k]; if (!x) return ''; const x0 = (padL + i * bw + 2).toFixed(1), w = (bw - 4).toFixed(1);
      const deep = x.deep || 0, rem = x.rem || 0;
      const seg = (from, to, cls) => (to > from ? '<rect class="' + cls + '" x="' + x0 + '" y="' + y(to).toFixed(1) + '" width="' + w + '" height="' + (y(from) - y(to)).toFixed(1) + '" rx="1.5"/>' : '');
      return '<g><title>' + fmtDate(k) + ': ' + sleepLine(x) + '</title>' + seg(0, deep, 'sl-deep') + seg(deep, deep + rem, 'sl-rem') + seg(deep + rem, x.total, 'sl-other') + '</g>'; }).join('');
    const grid = [0, 4, 8].map((h) => '<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(h * 60).toFixed(1) + '" y2="' + y(h * 60).toFixed(1) + '"/><text class="lbl" x="2" y="' + (y(h * 60) + 3).toFixed(1) + '">' + h + 'h</text>').join('');
    const labels = '<text class="lbl" x="' + padL + '" y="' + (H - 6) + '">' + fmtDate(days[0]) + '</text><text class="lbl" x="' + (W - padR) + '" y="' + (H - 6) + '" text-anchor="end">Today</text>';
    const a = sleepAvg(7), p = sleepAvg(7, addDays(todayKey(), -7));
    const diff = a && p ? Math.round(a.total - p.total) : null;
    return '<div class="card"><div class="row between mb8"><b>Sleep</b><button class="btn small ghost" data-action="sleep-list">' + plural(list.length, 'night') + '</button></div>'
      + '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' + grid + bars + labels + '</svg>'
      + '<div class="row tiny muted" style="gap:12px"><span><span class="sl-key sl-deep"></span>Deep</span><span><span class="sl-key sl-rem"></span>REM</span><span><span class="sl-key sl-other"></span>Light / other</span></div>'
      + (a ? '<div class="stat-row mt8"><div class="stat"><div class="v">' + fmtHM(a.total) + '</div><div class="k">7-night avg' + (diff != null ? ' (' + (diff >= 0 ? '+' : '−') + Math.abs(diff) + ' min)' : '') + '</div></div><div class="stat"><div class="v">' + fmtHM(a.rem) + '</div><div class="k">REM avg</div></div><div class="stat"><div class="v">' + fmtHM(a.deep) + '</div><div class="k">Deep avg</div></div></div>' : '')
      + (a && a.recovery != null ? '<div class="small mt8">Recovery avg <b>' + Math.round(a.recovery) + '%</b>' + (a.rhr != null ? ' · resting HR ' + Math.round(a.rhr) : '') + (a.hrv != null ? ' · HRV ' + Math.round(a.hrv) + ' ms' : '') + ' <span class="muted">(7 nights)</span></div>' : '')
      + '</div>';
  }
  function sheetSleep() {
    const list = sleepSorted().reverse();
    openSheet(sheetHeader('Sleep') + '<div class="list">' + (list.map((x) => '<div class="list-item"><div class="grow"><div class="title">' + fmtHM(x.total) + '</div><div class="sub">' + fmtDate(x.date) + (x.rem != null ? ' · REM ' + fmtHM(x.rem) : '') + (x.deep != null ? ' · deep ' + fmtHM(x.deep) : '') + (x.recovery != null ? ' · recovery ' + x.recovery + '%' : '') + (x.src === 'whoop' ? ' · WHOOP' : '') + '</div></div><button class="icon-btn danger" data-action="sleep-delete" data-date="' + x.date + '">✕</button></div>').join('') || '<div class="empty">Nothing yet</div>') + '</div>');
  }

  // ---- Body weight chart ---------------------------------------------------
  function renderBwCard() {
    const list = bwSorted();
    if (!list.length) return '';
    const u = state.settings.units;
    const recent = list.slice(-60);
    const avg = recent.map((b, i) => { const win = recent.slice(Math.max(0, i - 6), i + 1); return win.reduce((n, x) => n + x.weight, 0) / win.length; });
    const W = 320, H = 150, padL = 36, padR = 10, padT = 10, padB = 22;
    const ys = recent.map((b) => b.weight);
    let lo = Math.min(...ys), hi = Math.max(...ys); if (hi - lo < 2) { lo -= 1; hi += 1; }
    const x = (i) => padL + (recent.length === 1 ? (W - padL - padR) / 2 : (i / (recent.length - 1)) * (W - padL - padR));
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const line = (arr) => arr.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
    const grid = [lo, (lo + hi) / 2, hi].map((v) => '<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="lbl" x="2" y="' + (y(v) + 3).toFixed(1) + '">' + fmtW(Math.round(v * 10) / 10) + '</text>').join('');
    const dots = recent.map((b, i) => '<circle class="pt faint" cx="' + x(i).toFixed(1) + '" cy="' + y(b.weight).toFixed(1) + '" r="2.5"><title>' + b.date + ': ' + fmtW(b.weight) + '</title></circle>').join('');
    const labels = '<text class="lbl" x="' + padL + '" y="' + (H - 6) + '">' + fmtDate(recent[0].date) + '</text><text class="lbl" x="' + (W - padR) + '" y="' + (H - 6) + '" text-anchor="end">' + fmtDate(recent[recent.length - 1].date) + '</text>';
    const latest = list[list.length - 1];
    const monthAgo = addDays(latest.date, -30);
    const ref = list.filter((b) => b.date <= monthAgo).slice(-1)[0];
    const change = ref ? latest.weight - ref.weight : null;
    return '<div class="card"><div class="row between mb8"><b>Body weight</b><span class="pill">' + plural(list.length, 'weigh-in') + '</span></div>'
      + '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' + grid + dots + '<path class="line" d="' + line(avg) + '"/>' + labels + '</svg>'
      + '<div class="stat-row mt8"><div class="stat"><div class="v">' + fmtW(latest.weight) + '</div><div class="k">Latest</div></div><div class="stat"><div class="v">' + fmtW(Math.round(avg[avg.length - 1] * 10) / 10) + '</div><div class="k">7-entry avg</div></div><div class="stat"><div class="v">' + (change == null ? '–' : (change >= 0 ? '+' : '') + fmtW(Math.round(change * 10) / 10)) + '</div><div class="k">30-day change</div></div></div>'
      + '<div class="tiny muted mt8">Dots are weigh-ins, the line is the running average. ' + u + '.</div>'
      + '<button class="btn subtle small mt8" data-action="bw-list">Edit weigh-ins</button></div>';
  }

  function renderChart(exId) {
    const pts = [];
    state.workouts.forEach((w) => {
      if (!w.finishedAt) return;
      w.entries.forEach((e) => {
        if (e.exId !== exId) return;
        const done = e.sets.filter((s) => s.done && s.reps > 0);
        if (!done.length) return;
        const top = done.reduce((a, b) => (b.weight > a.weight || (b.weight === a.weight && b.reps > a.reps) ? b : a));
        pts.push({ date: w.date, weight: top.weight, reps: top.reps, e1rm: top.weight * (1 + top.reps / 30), deload: !!w.deload });
      });
    });
    if (pts.length < 1) return '<div class="empty small">Nothing logged yet.</div>';
    const W = 320, H = 160, padL = 34, padR = 10, padT = 12, padB = 22;
    const ys = pts.map((p) => p.weight);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi === lo) { lo -= 5; hi += 5; }
    const x = (i) => padL + (pts.length === 1 ? (W - padL - padR) / 2 : (i / (pts.length - 1)) * (W - padL - padR));
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    // Deload sessions are lighter on purpose: hollow dots, left out of the line and of "Current top set".
    const lined = pts.some((p) => !p.deload) ? pts.map((p, i) => ({ p, i })).filter((o) => !o.p.deload) : pts.map((p, i) => ({ p, i }));
    const path = lined.map((o, j) => (j ? 'L' : 'M') + x(o.i).toFixed(1) + ' ' + y(o.p.weight).toFixed(1)).join(' ');
    const grid = [lo, (lo + hi) / 2, hi].map((v) => '<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="lbl" x="2" y="' + (y(v) + 3).toFixed(1) + '">' + fmtW(v) + '</text>').join('');
    const dots = pts.map((p, i) => '<circle class="pt' + (p.deload ? ' deload' : '') + '" cx="' + x(i).toFixed(1) + '" cy="' + y(p.weight).toFixed(1) + '" r="3.5"><title>' + p.date + ': ' + fmtW(p.weight) + '×' + p.reps + (p.deload ? ' (deload)' : '') + '</title></circle>').join('');
    const first = pts[0], lastP = pts[pts.length - 1], curP = lined[lined.length - 1].p;
    const labels = '<text class="lbl" x="' + padL + '" y="' + (H - 6) + '">' + fmtDate(first.date) + '</text><text class="lbl" x="' + (W - padR) + '" y="' + (H - 6) + '" text-anchor="end">' + fmtDate(lastP.date) + '</text>';
    const best = pts.reduce((a, b) => (b.e1rm > a.e1rm ? b : a));
    const heaviest = pts.reduce((a, b) => (b.weight > a.weight || (b.weight === a.weight && b.reps > a.reps) ? b : a));
    const prCount = state.workouts.reduce((n, w) => n + w.entries.filter((e) => e.exId === exId && e.prs && e.prs.length).length, 0);
    const sessions = [];
    state.workouts.forEach((w) => { if (!w.finishedAt) return; w.entries.forEach((e) => { if (e.exId !== exId) return; const done = e.sets.filter((s) => s.done && s.reps > 0); if (done.length) sessions.push({ date: w.date, text: done.map((s) => fmtW(s.weight) + '×' + s.reps).join(', '), pr: !!(e.prs && e.prs.length), deload: !!w.deload }); }); });
    const recent = '<div class="group-title" style="margin-top:14px">Recent sessions</div>' + sessions.slice(-8).reverse().map((s) => '<div class="hist-set"><span>' + fmtDate(s.date) + (s.pr ? ' 🏆' : '') + (s.deload ? ' <span class="pill amber">Deload</span>' : '') + '</span><span><b>' + s.text + '</b></span></div>').join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' + grid + '<path class="line" d="' + path + '"/>' + dots + labels + '</svg>'
      + '<div class="stat-row mt8"><div class="stat"><div class="v">' + fmtW(curP.weight) + '</div><div class="k">Current top set</div></div><div class="stat"><div class="v">' + fmtW(best.weight) + '×' + best.reps + '</div><div class="k">Best set</div></div><div class="stat"><div class="v">' + pts.length + '</div><div class="k">Sessions</div></div></div>'
      + '<div class="review-list mt8 small"><div>🏆 Heaviest: <b>' + fmtW(heaviest.weight) + ' × ' + heaviest.reps + '</b> on ' + fmtDate(heaviest.date) + '</div><div>Est. 1RM: <b>' + fmtW(Math.round(best.e1rm)) + ' ' + state.settings.units + '</b> from ' + fmtW(best.weight) + ' × ' + best.reps + '</div><div>' + plural(prCount, 'PR session') + ' logged</div></div>' + recent;
  }

  // ---- Settings ------------------------------------------------------------
  function renderSettings() {
    const s = state.settings;
    return '<div class="screen-title"><h1>Settings</h1></div>'
      + '<div class="card">'
      + '<div class="toggle-row"><div><div>Appearance</div><div class="small muted">System follows your phone</div></div><div class="seg">' + ['system', 'dark', 'light'].map((t) => '<button class="' + ((s.theme || 'system') === t ? 'on' : '') + '" data-action="set-theme" data-v="' + t + '">' + t[0].toUpperCase() + t.slice(1) + '</button>').join('') + '</div></div>'
      + '<div class="toggle-row"><div><div>Weight jump: barbell</div><div class="small muted">Also cable-free moves and anything else. Per exercise override in Exercises</div></div><input class="input" style="width:90px;text-align:center" type="number" inputmode="decimal" step="any" min="0" value="' + s.increment + '" data-field="setting" data-k="increment"></div>'
      + '<div class="toggle-row"><div><div>Weight jump: dumbbell</div><div class="small muted">Per hand. Most racks go up in 5s</div></div><input class="input" style="width:90px;text-align:center" type="number" inputmode="decimal" step="any" min="0" value="' + s.incDumbbell + '" data-field="setting" data-k="incDumbbell"></div>'
      + '<div class="toggle-row"><div><div>Weight jump: machine</div><div class="small muted">Stack pin or plate-loaded</div></div><input class="input" style="width:90px;text-align:center" type="number" inputmode="decimal" step="any" min="0" value="' + s.incMachine + '" data-field="setting" data-k="incMachine"></div>'
      + '<div class="toggle-row"><div><div>Weight jump: cable</div><div class="small muted">Cable stack</div></div><input class="input" style="width:90px;text-align:center" type="number" inputmode="decimal" step="any" min="0" value="' + s.incCable + '" data-field="setting" data-k="incCable"></div>'
      + '<div class="toggle-row"><div><div>Rep range</div><div class="small muted">Hit the top on every set → weight goes up</div></div><div class="row"><input class="input" style="width:64px;text-align:center" type="number" inputmode="numeric" min="1" value="' + s.repMin + '" data-field="setting" data-k="repMin"><span class="muted">–</span><input class="input" style="width:64px;text-align:center" type="number" inputmode="numeric" min="1" value="' + s.repMax + '" data-field="setting" data-k="repMax"></div></div>'
      + '<div class="toggle-row"><div><div>Rest timer</div><div class="small muted">Seconds, starts when you check a set</div></div><input class="input" style="width:90px;text-align:center" type="number" inputmode="numeric" min="0" value="' + s.restSec + '" data-field="setting" data-k="restSec"></div>'
      + '<div class="toggle-row"><div><div>Starting sets</div><div class="small muted">For new exercises</div></div><input class="input" style="width:90px;text-align:center" type="number" inputmode="numeric" min="1" value="' + s.defaultSets + '" data-field="setting" data-k="defaultSets"></div>'
      + '<div class="toggle-row"><div><div>Max sets</div><div class="small muted">Feedback never pushes past this</div></div><input class="input" style="width:90px;text-align:center" type="number" inputmode="numeric" min="1" value="' + s.maxSets + '" data-field="setting" data-k="maxSets"></div>'
      + '<div class="toggle-row"><div><div>Reps in reserve</div><div class="small muted">After you tick a set, tap how many reps you had left (3+, 2, 1, 0). 3+ on every set moves weight up early</div></div><div class="seg"><button class="' + (s.trackRir ? 'on' : '') + '" data-action="set-rir" data-v="1">On</button><button class="' + (!s.trackRir ? 'on' : '') + '" data-action="set-rir" data-v="0">Off</button></div></div>'
      + '<div class="toggle-row"><div><div>Warm-up rest</div><div class="small muted">Seconds between warm-up sets</div></div><input class="input" style="width:90px;text-align:center" type="number" inputmode="numeric" min="0" value="' + s.warmupRest + '" data-field="setting" data-k="warmupRest"></div>'
      + '<div class="toggle-row"><div><div>Weekly sets target</div><div class="small muted">Per muscle, for the volume chart</div></div><div class="row"><input class="input" style="width:64px;text-align:center" type="number" inputmode="numeric" min="0" value="' + s.volumeMin + '" data-field="setting" data-k="volumeMin"><span class="muted">–</span><input class="input" style="width:64px;text-align:center" type="number" inputmode="numeric" min="0" value="' + s.volumeMax + '" data-field="setting" data-k="volumeMax"></div></div>'
      + '<div class="toggle-row"><div><div>Weigh-in reminder</div><div class="small muted">How often the Today screen asks for your body weight</div></div><select class="select" style="width:auto" data-field="setting" data-k="weighEvery">' + [[0, 'Off'], [1, 'Every day'], [2, 'Every 2 days'], [3, 'Every 3 days'], [7, 'Weekly'], [14, 'Every 2 weeks']].map(([v, l]) => '<option value="' + v + '" ' + (s.weighEvery === v ? 'selected' : '') + '>' + l + '</option>').join('') + '</select></div>'
      + '<div class="toggle-row"><div><div>Sleep</div><div class="small muted">Time asleep, REM and deep in the morning check-in</div></div><div class="seg"><button class="' + (s.sleepOn ? 'on' : '') + '" data-action="set-sleep" data-v="1">On</button><button class="' + (!s.sleepOn ? 'on' : '') + '" data-action="set-sleep" data-v="0">Off</button></div></div>'
      + '</div>'
      + '<div class="group-title">Cardio</div><div class="card">'
      + '<div class="toggle-row"><div><div>Cardio after lifting</div><div class="small muted">Adds a cardio card with a timer to the end of every workout</div></div><div class="seg"><button class="' + (s.cardioOn ? 'on' : '') + '" data-action="set-cardio" data-v="1">On</button><button class="' + (!s.cardioOn ? 'on' : '') + '" data-action="set-cardio" data-v="0">Off</button></div></div>'
      + (s.cardioOn ? '<div class="toggle-row"><div><div>What</div></div><input class="input" style="max-width:200px" value="' + esc(s.cardioName) + '" data-field="cardio-name"></div>'
        + '<div class="toggle-row"><div><div>Minutes</div></div><input class="input" style="width:90px;text-align:center" type="number" inputmode="numeric" min="1" value="' + s.cardioMin + '" data-field="setting" data-k="cardioMin"></div>' : '')
      + '</div>'
      + (window.__overloadConn ? window.__overloadConn.settingsCard() : '')
      + (window.__overloadFood ? window.__overloadFood.settingsCard() : '')
      + renderBackupCard()
      + renderCloudCard()
      + '<div class="group-title">Danger zone</div><div class="card"><button class="btn danger block" data-action="reset">Reset all data</button></div>'
      + '<p class="tiny muted center mt16">Overload · v' + VERSION + '</p>';
  }

  function renderCloudCard() {
    const sync = window.__overloadSync;
    let body;
    if (!sync) {
      body = '<p class="small muted">Cloud sync is loading. If this never changes, the sync module could not load (offline, or sync.js is missing).</p>';
    } else if (sync.user) {
      const st = ui.sync;
      const colour = cloudColour(st.status);
      body = '<div class="toggle-row"><div><div>Signed in</div><div class="small muted">' + esc(sync.user.email) + '</div></div><span class="pill" id="cloud-status" style="color:' + colour + '">' + esc(st.msg || 'Connected') + '</span></div>'
        + '<p class="small muted mt8">Every change is mirrored to your account. Offline changes are queued and sent when you are back online.</p>'
        + '<div class="btn-row mt12"><button class="btn ghost" data-action="cloud-push">Sync now</button><button class="btn subtle" data-action="cloud-signout">Sign out</button></div>';
    } else {
      body = '<p class="small muted mb8">Sign in to keep your data in the cloud so it survives clearing this phone and follows you to a new one. First time here? Enter an email and password and tap Create account.</p>'
        + '<form id="cloud-form"><div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="username" inputmode="email" required></div>'
        + '<div class="field"><label>Password</label><input class="input" name="password" type="password" autocomplete="current-password" required></div>'
        + '<div id="cloud-msg" class="small mb8" style="color:var(--accent-2)"></div>'
        + '<div class="btn-row"><button class="btn" type="submit">Sign in</button><button class="btn ghost" type="button" data-action="cloud-signup">Create account</button></div>'
        + '<button class="btn subtle block mt8" type="button" data-action="cloud-reset">Forgot password</button></form>';
    }
    return '<div id="cloud-card"><div class="group-title">Cloud sync</div><div class="card">' + body + '</div></div>';
  }
  function cloudColour(status) { return status === 'error' ? 'var(--accent-2)' : status === 'synced' ? 'var(--green)' : 'var(--amber)'; }

  async function cloudAction(kind) {
    const sync = window.__overloadSync; if (!sync) return;
    const form = $('#cloud-form'); const msg = $('#cloud-msg');
    const email = form ? form.elements.email.value : ''; const password = form ? form.elements.password.value : '';
    const say = (t) => { if (msg) msg.textContent = t; else toast(t); };
    try {
      if (kind === 'signin') { if (!email || !password) return say('Enter your email and password.'); await sync.signIn(email, password); toast('Signed in'); }
      if (kind === 'signup') { if (!email || !password) return say('Enter an email and a password of at least 6 characters.'); await sync.createAccount(email, password); toast('Account created'); }
      if (kind === 'reset') { if (!email) return say('Enter your email first.'); await sync.resetPassword(email); say('Reset email sent. Check your inbox.'); }
      if (kind === 'signout') { if (confirm('Sign out? Your data stays on this phone and in the cloud. Changes you make while signed out are sent when you sign back in.')) { await sync.signOut(); toast('Signed out'); } }
      if (kind === 'push') { await sync.pushNow(); toast('Sync requested'); }
    } catch (e) { say(e.message || 'Something went wrong.'); }
  }

  // ---------------------------------------------------------------------------
  // Sheets
  // ---------------------------------------------------------------------------
  function openSheet(html, key) {
    // key names what the sheet shows (for example 'day:' + id); without one the title does.
    const panel = $('#sheet-panel'), fresh = $('#sheet').hidden, was = panel.dataset.sheet;
    ui.sheet = true; panel.innerHTML = html; $('#sheet').hidden = false; document.body.style.overflow = 'hidden';
    const h = panel.querySelector('.sheet-title h2'), now = key != null ? 'k:' + key : 't:' + (h ? h.textContent : '');
    panel.dataset.sheet = now;
    // A new sheet starts at its top, also when it replaces another one (Edit sets from a workout,
    // Duplicate day); redrawing the open one (a renamed meal, a moved exercise) keeps its place.
    if (fresh || was !== now) panel.scrollTop = 0;
  }
  function closeSheet() { ui.sheet = null; $('#sheet').hidden = true; $('#sheet-panel').innerHTML = ''; document.body.style.overflow = ''; document.dispatchEvent(new CustomEvent('overload:sheetclose')); }
  function sheetHeader(title, extra) { return '<div class="sheet-title"><h2>' + title + '</h2><div class="row">' + (extra || '') + '<button class="icon-btn" data-action="sheet-close">✕</button></div></div>'; }

  function sheetExercise(exId) {
    const ex = exId ? exById(exId) : { id: null, name: '', muscle: 'Chest', equipment: 'Dumbbell', increment: null, repMin: null, repMax: null, custom: true };
    const p = exId ? prescFor(exId) : { weight: 0, targetReps: state.settings.repMin, sets: state.settings.defaultSets };
    const opt = (arr, v) => arr.map((o) => '<option ' + (o === v ? 'selected' : '') + '>' + o + '</option>').join('');
    openSheet(sheetHeader(exId ? 'Edit exercise' : 'New exercise')
      + '<form id="ex-form" data-ex="' + (ex.id || '') + '">'
      + '<div class="field"><label>Name</label><input class="input" name="name" required value="' + esc(ex.name) + '" placeholder="e.g. Incline Dumbbell Press"></div>'
      + '<div class="field-row"><div class="field"><label>Muscle</label><select class="select" name="muscle">' + opt(MUSCLES, ex.muscle) + '</select></div><div class="field"><label>Equipment</label><select class="select" name="equipment">' + opt(EQUIPMENT, ex.equipment) + '</select></div></div>'
      + '<div class="field"><label>Notes</label><input class="input" name="notes" value="' + esc(ex.notes || '') + '" placeholder="Seat 4, handles high, pin at 7…"></div>'
      + '<div class="group-title" style="margin-top:6px">Current prescription</div>'
      + '<div class="field-row"><div class="field"><label>Weight (' + state.settings.units + ')</label><input class="input" name="weight" type="number" inputmode="decimal" step="any" min="0" value="' + (p.weight || '') + '"></div><div class="field"><label>Sets</label><input class="input" name="sets" type="number" inputmode="numeric" min="1" value="' + p.sets + '"></div><div class="field"><label>Goal reps</label><input class="input" name="targetReps" type="number" inputmode="numeric" min="1" value="' + p.targetReps + '"></div></div>'
      + '<div class="group-title" style="margin-top:6px">Overrides <span class="muted" style="font-weight:500;text-transform:none;letter-spacing:0">(blank = use settings)</span></div>'
      + '<div class="field-row"><div class="field"><label>Weight jump</label><input class="input" name="increment" type="number" inputmode="decimal" step="any" min="0" placeholder="' + state.settings.increment + '" value="' + (ex.increment || '') + '"></div><div class="field"><label>Rep min</label><input class="input" name="repMin" type="number" inputmode="numeric" min="1" placeholder="' + state.settings.repMin + '" value="' + (ex.repMin || '') + '"></div><div class="field"><label>Rep max</label><input class="input" name="repMax" type="number" inputmode="numeric" min="1" placeholder="' + state.settings.repMax + '" value="' + (ex.repMax || '') + '"></div></div>'
      + '<div class="field-row"><div class="field"><label>Rest (seconds)</label><input class="input" name="restSec" type="number" inputmode="numeric" min="0" placeholder="' + state.settings.restSec + '" value="' + (ex.restSec || '') + '"></div><div class="field"><label>Fixed sets</label><input class="input" name="fixedSets" type="number" inputmode="numeric" min="1" placeholder="auto" value="' + (ex.fixedSets || '') + '"></div><div class="field"></div></div>'
      + '<button class="btn block mt8" type="submit">Save</button>'
      + (exId ? '<button class="btn subtle block mt8" type="button" data-action="delete-ex" data-ex="' + exId + '">Delete exercise</button>' : '')
      + '</form>');
  }

  function sheetDay(dayId) {
    const d = dayById(dayId); if (!d) return;
    const items = d.exercises.map((exId, i) => { const ex = exById(exId); if (!ex) return '';
      return '<div class="list-item"><div class="grow"><div class="title">' + esc(ex.name) + '</div><div class="sub">' + esc(ex.muscle) + '</div></div>'
        + '<button class="icon-btn" data-action="day-move" data-day="' + dayId + '" data-i="' + i + '" data-d="-1" ' + (i === 0 ? 'disabled' : '') + '>↑</button>'
        + '<button class="icon-btn" data-action="day-move" data-day="' + dayId + '" data-i="' + i + '" data-d="1" ' + (i === d.exercises.length - 1 ? 'disabled' : '') + '>↓</button>'
        + '<button class="icon-btn danger" data-action="day-remove-ex" data-day="' + dayId + '" data-i="' + i + '">✕</button></div>'; }).join('');
    openSheet(sheetHeader('Edit day')
      + '<div class="field"><label>Name</label><input class="input" value="' + esc(d.name) + '" data-field="day-name" data-day="' + dayId + '"></div>'
      + '<div class="list">' + (items || '<div class="empty small">No exercises yet</div>') + '</div>'
      + '<button class="btn block mt12" data-action="pick-ex" data-day="' + dayId + '">+ Add exercise</button>'
      + '<div class="btn-row mt8"><button class="btn subtle" data-action="dup-day" data-day="' + dayId + '">Duplicate day</button><button class="btn subtle" data-action="delete-day" data-day="' + dayId + '">Delete day</button></div>', 'day:' + dayId);
  }

  function sheetPicker(target) {
    // target: { day } adds to a program day; { workout: true } adds to the active workout
    ui.pickTarget = target; ui.pickSearch = '';
    renderPicker();
  }
  function renderPicker() {
    const q = (ui.pickSearch || '').toLowerCase();
    const exclude = ui.pickTarget.day ? dayById(ui.pickTarget.day).exercises : activeWorkout().entries.map((e) => e.exId);
    const title = ui.pickTarget.swap != null ? 'Swap exercise' : 'Add exercise';
    const list = state.exercises.filter((e) => !exclude.includes(e.id) && (!q || e.name.toLowerCase().includes(q) || e.muscle.toLowerCase().includes(q)));
    const groups = MUSCLES.map((m) => { const items = list.filter((e) => e.muscle === m); if (!items.length) return '';
      return '<div class="group-title">' + m + '</div><div class="list">' + items.map((ex) => '<button class="list-item" data-action="pick-ex-choose" data-ex="' + ex.id + '"><div class="grow"><div class="title">' + esc(ex.name) + '</div><div class="sub">' + esc(ex.equipment) + '</div></div><span class="chev">+</span></button>').join('') + '</div>'; }).join('');
    openSheet(sheetHeader(title, '<button class="btn small ghost" data-action="pick-new-ex">New</button>')
      + '<input class="input" type="search" placeholder="Search" value="' + esc(ui.pickSearch || '') + '" data-field="pick-search" autofocus>'
      + (groups || '<div class="empty">No matches</div>'));
  }

  function sheetWorkout(wId) {
    const w = state.workouts.find((x) => x.id === wId); if (!w) return;
    const body = w.entries.map((en) => { const ex = exById(en.exId); const done = en.sets.filter((s) => s.done);
      if (!done.length) return '';
      const fb = [en.pump != null ? 'Pump: ' + PUMP[en.pump] : '', en.joint != null ? 'Joints: ' + JOINT[en.joint] : '', en.workload != null ? 'Workload: ' + WORKLOAD[en.workload] : ''].filter(Boolean).join(' · ');
      return '<div class="card flat"><div class="row between"><b>' + esc(ex ? ex.name : 'Deleted exercise') + (en.swappedFrom ? ' <span class="muted small">(swap)</span>' : '') + '</b>' + (ex ? '<span class="pill">' + esc(ex.muscle) + '</span>' : '') + '</div>'
        + (en.warmups && en.warmups.some((x) => x.done) ? '<div class="hist-set"><span>Warm-up</span><span>' + en.warmups.filter((x) => x.done).map((x) => fmtW(x.weight) + '×' + x.reps).join(', ') + '</span></div>' : '')
        + done.map((s, i) => '<div class="hist-set"><span>Set ' + (i + 1) + '</span><span><b>' + fmtW(s.weight) + '</b> ' + state.settings.units + ' × <b>' + s.reps + '</b>' + (s.rir != null ? ' <span class="muted">· ' + s.rir + ' RIR</span>' : '') + '</span></div>').join('')
        + (en.prs && en.prs.length ? '<div class="tiny mt8" style="color:var(--green)">🏆 ' + esc(en.prs.map((x) => x.text).join(' · ')) + '</div>' : '')
        + (fb ? '<div class="tiny muted mt8">' + fb + '</div>' : '')
        + (en.next && en.next.reasons.length ? '<div class="tiny mt8" style="color:var(--amber)">' + esc(en.next.reasons[0]) + '</div>' : '') + '</div>'; }).join('');
    const sore = Object.keys(w.soreness || {}).map((m) => m + ': ' + SORENESS[w.soreness[m]]).join(' · ');
    openSheet(sheetHeader(esc(w.dayName)) + '<p class="small muted mb8">' + (w.deload ? '<span class="pill amber">Deload</span> ' : '') + fmtDate(w.date) + (durationText(w) ? ' · ' + durationText(w) : '') + (sore ? ' · ' + esc(sore) : '') + '</p>' + (body || (w.cardio ? '' : '<div class="empty">Nothing logged</div>'))
      + (w.cardio && w.cardio.done ? '<div class="card flat"><div class="row between"><b>' + esc(w.cardio.name) + '</b><span class="pill">Cardio</span></div><div class="hist-set"><span>' + esc(cardioText(w.cardio)) + '</span></div></div>' : '')
      + '<div class="btn-row mt8"><button class="btn ghost" data-action="edit-workout" data-w="' + w.id + '">Edit sets</button><button class="btn subtle" data-action="delete-workout" data-w="' + w.id + '">Delete workout</button></div>');
  }

  // Fix a typo in a finished workout. Trophies follow; next time is redone only where this is the latest session.
  function sheetEditWorkout(wId) {
    const w = state.workouts.find((x) => x.id === wId); if (!w) return;
    const u = state.settings.units;
    const body = w.entries.map((en, ei) => { const ex = exById(en.exId);
      const rows = en.sets.map((s, si) => !s.done ? '' : '<div class="row mt8"><span class="muted small" style="width:52px;flex-shrink:0;white-space:nowrap">Set ' + (si + 1) + '</span>'
        + '<input class="input" style="text-align:center" type="number" inputmode="decimal" step="any" min="0" name="w-' + ei + '-' + si + '" value="' + (s.weight || '') + '" placeholder="' + u + '">'
        + '<input class="input" style="text-align:center" type="number" inputmode="numeric" min="0" name="r-' + ei + '-' + si + '" value="' + (s.reps || '') + '" placeholder="reps"></div>').join('');
      return rows ? '<div class="card flat"><b>' + esc(ex ? ex.name : 'Deleted exercise') + '</b>' + rows + '</div>' : ''; }).join('');
    openSheet(sheetHeader('Edit sets') + '<form id="edit-workout-form" data-w="' + w.id + '"><p class="small muted mb8">' + esc(w.dayName) + ' · ' + fmtDate(w.date) + '. ' + (w.deload ? 'Deload workout: corrections fix the log only. Next-time numbers and trophies stay as they are.' : 'Trophies follow your corrections. If this is the latest time you did an exercise and a correction changes how it went, its next-time numbers are worked out again with its current rep range. Older sessions keep the ones already set.') + '</p>'
      + body + '<button class="btn block mt12" type="submit">Save changes</button></form>');
  }
  // After sets of a finished workout are corrected (changed: entry -> its sets before the correction): redo the
  // trophies of each corrected exercise, here and in its later sessions, against the workouts before each. Where
  // this is the exercise's latest session, judge it the way finishing it did, from the prescription in force
  // before it, with the sets before and after the correction: next time follows only when the two differ, so a
  // correction that changes nothing moves nothing (also when the rules or the rep range changed since). The set
  // count does not depend on weights or reps, so it stays, unless the session goes from no reps to some or back.
  // Numbers changed since (by hand or by a program) are kept. Returns the names of exercises whose next time changed.
  function recalcEdited(wk, changed) {
    const names = [];
    const before = (a, b) => (a.startedAt && b.startedAt ? a.startedAt < b.startedAt : a.date < b.date);
    changed.forEach((oldSets, en) => {
      const ex = exById(en.exId);
      if (!ex) return;
      if (!wk.deload) en.prs = detectPrs(en.exId, en, wk.id, wk);
      state.workouts.forEach((o) => {
        if (o.deload || !(o.finishedAt || o.id === state.active) || !before(wk, o)) return;
        o.entries.forEach((oe) => { if (oe.exId === en.exId && oe.done) oe.prs = detectPrs(oe.exId, oe, o.id, o); });
      });
      if (wk.deload || !en.next || !en.prevPresc || !isLatestSessionFor(en.exId, wk)) return;
      // The same soreness the finish used: one "Still sore" cut per muscle, on the entry that took it.
      let sore = wk.soreness ? wk.soreness[ex.muscle] : undefined;
      const alreadyCut = sore === 3 && !en.soreCut && wk.entries.some((o) => o !== en && o.soreCut && exById(o.exId) && exById(o.exId).muscle === ex.muscle);
      if (alreadyCut) sore = undefined;
      const judge = (sets) => {
        const base = JSON.parse(JSON.stringify(en.prevPresc)), cur = state.presc[en.exId];
        state.presc[en.exId] = base;  // the weekly volume cap counts this exercise as it was before the session
        try { return computeNext(ex, base, Object.assign({}, en, { sets }), sore); } finally { if (cur) state.presc[en.exId] = cur; else delete state.presc[en.exId]; }
      };
      const was = judge(oldSets), now = judge(en.sets), old = en.next;
      if (now && alreadyCut) now.reasons.push('Still sore → the set cut already landed on an earlier ' + ex.muscle.toLowerCase() + ' exercise');
      let res;
      if (!now) res = Object.assign(JSON.parse(JSON.stringify(en.prevPresc)), { updatedAt: Date.now() });  // no reps left: as before the session
      else if (!was) res = now;  // reps again after none
      else if (was.weight !== now.weight || was.targetReps !== now.targetReps) res = Object.assign({}, old, { weight: now.weight, targetReps: now.targetReps, reasons: now.reasons, updatedAt: now.updatedAt });
      else return;
      if (!res.reasons) res.reasons = [];
      const p = prescFor(en.exId);
      let moved = false;
      const since = (k) => (k === 'soreCut' ? !!p[k] !== !!old[k] : p[k] !== old[k]);  // changed since: keep
      const take = (k) => { const v = k === 'soreCut' ? !!res[k] : res[k]; if (p[k] !== v) moved = true; p[k] = v; };
      if (!since('weight')) take('weight');
      if (!since('targetReps') && p.weight === res.weight) take('targetReps');  // a goal belongs to the weight it was worked out for
      if (!since('sets')) take('sets');
      if (!since('soreCut')) take('soreCut');
      if (p.weight === res.weight && p.targetReps === res.targetReps) p.reasons = res.reasons;  // the first line names both
      en.next = res;
      if (moved) { p.updatedAt = res.updatedAt; names.push(ex.name); }
    });
    return names;
  }

  function sheetBodyweight() {
    const list = bwSorted().slice().reverse();
    openSheet(sheetHeader('Weigh-ins') + '<div class="list">' + (list.map((b) => '<div class="list-item"><div class="grow"><div class="title">' + fmtW(b.weight) + ' ' + state.settings.units + '</div><div class="sub">' + fmtDate(b.date) + '</div></div><button class="icon-btn danger" data-action="bw-delete" data-date="' + b.date + '">✕</button></div>').join('') || '<div class="empty">Nothing yet</div>') + '</div>');
  }

  // ---------------------------------------------------------------------------
  // Workout actions
  // ---------------------------------------------------------------------------
  // Equipment where a set always has a load; a tick with no weight there would log 0.
  const LOADED = ['Barbell', 'Dumbbell', 'Machine', 'Cable'];
  function newEntry(exId) {
    const p = prescFor(exId);
    const sets = [];
    for (let i = 0; i < p.sets; i++) sets.push({ weight: p.weight || 0, reps: 0, done: false, rir: null });
    return { exId, plannedSets: p.sets, weightAtStart: p.weight, targetReps: p.targetReps, sets, pump: null, joint: null, workload: null, done: false, next: null, prevPresc: null, warmups: null, prs: [], swappedFrom: null, soreCut: false };
  }

  // Redraw, keeping the bottom edge of one element where it was on screen, so a card that folds up
  // does not pull what is below it under the finger.
  function renderKeeping(sel) {
    const el = $(sel); const before = el ? el.getBoundingClientRect().bottom : 0;
    render();
    const now = el && $(sel);
    if (now) window.scrollBy(0, now.getBoundingClientRect().bottom - before);
  }
  // Bring the next thing to log up under the top bar: the first unticked set of the first unfinished exercise
  // (the card top while nothing is ticked yet, so its name shows). Used only when the app opens and on switching to Today.
  function scrollToNext() {
    const w = activeWorkout(); if (!w || ui.screen !== 'today') return;
    // The check-in decides set cuts, so while it has unanswered questions and nothing is logged yet, show it instead.
    // Measured from the bottom of the top bar, or of the storage-full banner when it shows.
    const warn = $('#save-warning');
    const bar = Math.max($('.topbar').getBoundingClientRect().bottom, warn && !warn.hidden ? warn.getBoundingClientRect().bottom : 0);
    const checkin = $('#soreness-card');
    if (checkin && checkin.querySelector('.choice-grid') && !w.entries.some((en) => en.done || en.sets.some((s) => s.done))) {
      window.scrollTo(0, Math.max(0, window.scrollY + checkin.getBoundingClientRect().top - bar - 8));
      return;
    }
    const idx = w.entries.findIndex((en) => !en.done && exById(en.exId));
    const card = idx >= 0 ? $('[data-card="' + idx + '"]') : null;
    let target;
    if (card) {
      const en = w.entries[idx], si = en.sets.findIndex((s) => !s.done);
      const row = si >= 0 ? card.querySelectorAll('.set-row')[si] : null;
      if (!en.sets.some((s) => s.done)) target = card;
      else if (row) target = row.previousElementSibling || row;  // the set just done (and its RIR) stays in view above it
      else target = card.querySelector('.prompt') || card.querySelector('[data-action="finish-entry"]');
    } else target = $('#cardio-card') || $('[data-action="finish-workout"]');
    if (!target) return;
    window.scrollTo(0, Math.max(0, window.scrollY + target.getBoundingClientRect().top - bar - 8));
  }

  function startWorkout(dayId, deload) {
    const day = dayById(dayId); if (!day) return;
    const w = { id: uid(), date: todayKey(), startedAt: Date.now(), finishedAt: null, dayId, dayName: day.name, soreness: {}, entries: day.exercises.filter(exById).map(newEntry) };
    if (deload) w.deload = true;  // optional field: absent on normal workouts
    state.workouts.push(w);
    state.active = w.id;
    save(); render();
    window.scrollTo(0, 0);
  }

  // Sets with reps typed in but never ticked were still lifted. Count them.
  function tickTyped(en) {
    let n = 0;
    en.sets.forEach((s) => { if (!s.done && s.reps > 0) { s.done = true; n++; } });
    return n;
  }
  function finishEntry(w, idx) {
    const en = w.entries[idx];
    const ex = exById(en.exId);
    if (!ex) { toast('That exercise was deleted'); return 0; }
    const ticked = tickTyped(en);
    const p = prescFor(en.exId);
    if (w.deload) {
      // A deload keeps the sets but leaves the plan alone: no next-time change, no PR, no set rule, nothing to roll back.
      if (!en.sets.some((s) => s.done && s.reps > 0)) { toast('Log at least one set first'); return 0; }
      en.done = true; en.next = null; en.prevPresc = null; en.prs = []; en.soreCut = false;
      if (ticked) toast('Counted ' + plural(ticked, 'set') + ' you typed but did not tick');
      return ticked;
    }
    // "Still sore" costs one set per muscle per session, on the first exercise finished for it.
    let sore = w.soreness[ex.muscle];
    const alreadyCut = sore === 3 && w.entries.some((o, j) => j !== idx && o.done && o.soreCut && exById(o.exId) && exById(o.exId).muscle === ex.muscle);
    if (alreadyCut) sore = undefined;
    const next = computeNext(ex, p, en, sore);
    if (!next) { toast('Log at least one set first'); return 0; }
    if (alreadyCut) next.reasons.push('Still sore → the set cut already landed on an earlier ' + ex.muscle.toLowerCase() + ' exercise');
    en.soreCut = sore === 3 && !ex.fixedSets && p.sets > 1;
    en.prevPresc = JSON.parse(JSON.stringify(p));
    en.next = next;
    en.done = true;
    en.prs = detectPrs(en.exId, en, w.id);
    if (en.prs.length) toast('🏆 PR! ' + en.prs[0].text);
    else if (ticked) toast('Counted ' + plural(ticked, 'set') + ' you typed but did not tick');
    state.presc[en.exId] = { weight: next.weight, targetReps: next.targetReps, sets: next.sets, soreCut: next.soreCut, reasons: next.reasons, updatedAt: next.updatedAt };
    return ticked;
  }

  // Deload on: exercises already finished in this workout get back the plan they had before it.
  // Deload off: exercises finished during the deload are judged as usual now.
  function setDeload(w, on) {
    const done = w.entries.filter((en) => en.done && exById(en.exId));
    let n = 0;
    if (on) {
      w.deload = true;
      // Latest finished first, so an exercise logged twice ends on its earliest before-copy.
      done.filter((en) => en.next && en.prevPresc).sort((a, b) => (b.next.updatedAt || 0) - (a.next.updatedAt || 0))
        .forEach((en) => { state.presc[en.exId] = en.prevPresc; en.prevPresc = null; en.next = null; en.prs = []; en.soreCut = false; n++; });
    } else {
      delete w.deload;
      done.forEach((en) => { if (!en.next) { en.done = false; finishEntry(w, w.entries.indexOf(en)); if (en.done) n++; } });
    }
    return n;  // how many finished exercises changed
  }

  function reopenEntry(w, idx) {
    const en = w.entries[idx];
    if (en.prevPresc) state.presc[en.exId] = en.prevPresc;
    en.prevPresc = null; en.next = null; en.done = false; en.prs = []; en.soreCut = false;
  }

  function swapEntry(w, idx, exId) {
    const old = w.entries[idx]; if (!old) return;
    const ne = newEntry(exId);
    ne.swappedFrom = old.swappedFrom || old.exId;
    // Sets already logged are kept: finish the old exercise as it is (like Finish exercise) and add the new one after it.
    if (!old.done && exById(old.exId) && old.sets.some((s) => s.reps > 0)) {
      finishEntry(w, idx);
      if (old.done && !old.prs.length) toast(exById(old.exId).name + ' kept with ' + plural(old.sets.filter((s) => s.done && s.reps > 0).length, 'set') + ' logged');
    }
    if (old.done) w.entries.splice(idx + 1, 0, ne);
    else w.entries[idx] = ne;
  }

  function genWarmups(en) {
    const ex = exById(en.exId);
    const work = (en.sets[0] && en.sets[0].weight) || prescFor(en.exId).weight || 0;
    if (!(work > 0)) { toast('Enter your working weight first'); return; }
    if (ex && ex.equipment === 'Bodyweight') { toast('No warm-up needed for bodyweight moves'); return; }
    const step = state.settings.units === 'kg' ? 2.5 : 5;
    const scheme = [[0.5, 8], [0.7, 5], [0.85, 3]];
    const out = []; const seen = {};
    scheme.forEach(([pct, reps]) => { const wt = round(work * pct, step); if (wt >= step && wt < work && !seen[wt]) { seen[wt] = 1; out.push({ weight: wt, reps, done: false }); } });
    if (!out.length) { toast('Working weight is too light for a ramp-up'); return; }
    en.warmups = out;
  }

  function saveTemplate() {
    const name = prompt('Name this template', state.program.days.map((d) => d.name).join(' / ').slice(0, 40));
    if (!name) return;
    state.templates.push({ id: uid(), name: name.trim(), days: JSON.parse(JSON.stringify(state.program.days)), schedule: state.program.schedule.slice(), savedAt: todayKey() });
    save(); render(); toast('Template saved');
  }
  function useTemplate(id) {
    const t = state.templates.find((x) => x.id === id); if (!t) return;
    if (!confirm('Switch to "' + t.name + '"? Your current days and schedule will be replaced. Save them as a template first if you want them back.')) return;
    state.program = { days: JSON.parse(JSON.stringify(t.days)), schedule: t.schedule.slice() };
    save(); render(); toast('Now using ' + t.name);
  }

  async function shareReview() {
    const text = reviewText(weekReview(ui.reviewOffset));
    try {
      if (navigator.share) { await navigator.share({ title: 'Overload weekly review', text }); return; }
      await navigator.clipboard.writeText(text); toast('Copied to clipboard');
    } catch (e) { if (e && e.name !== 'AbortError') toast('Could not share'); }
  }

  function finishWorkout() {
    const w = activeWorkout(); if (!w) return;
    // Exercises still open: ask once, before anything changes, so Cancel goes straight back to the workout.
    // One with every set ticked is done in all but name (it is finished below without asking).
    // In a deload, doing some of the sets is the plan: an exercise with a ticked set is not "not done".
    const open = w.entries.filter((en) => !en.done && exById(en.exId) && !(en.sets.length && en.sets.every((s) => s.done)) && !(w.deload && en.sets.some((s) => s.done && s.reps > 0))).length;
    const anyLogged = w.entries.some((en) => en.done || en.sets.some((s) => s.reps > 0)) || !!(w.cardio && w.cardio.done);
    if (open && anyLogged && !confirm(plural(open, 'exercise') + ' not done. Finish anyway?')) return;
    // Auto-finish anything with logged sets that wasn't marked done, counting typed-but-unticked sets.
    let ticked = 0;
    w.entries.forEach((en, i) => { if (!en.done && exById(en.exId) && en.sets.some((s) => s.reps > 0)) ticked += finishEntry(w, i); });
    if (w.cardio && !w.cardio.done && state.settings.cardioOn && w.cardio.min > 0) {
      if (confirm('Log your ' + w.cardio.min + ' min ' + w.cardio.name.toLowerCase() + ' with this workout?\n\nOK logs it. Cancel finishes without cardio.')) w.cardio.done = true;
    }
    const logged = w.entries.some((en) => en.done) || !!(w.cardio && w.cardio.done);
    if (!logged) {
      if (!confirm('Nothing logged. Discard this workout?')) return;
      state.workouts = state.workouts.filter((x) => x.id !== w.id); markDeleted('workouts', w.id);
    } else {
      if (w.cardio && !w.cardio.done) delete w.cardio;
      if (w.cardio) w.cardio.kcal = cardioKcal(w.cardio);  // today's body weight, kept for history
      w.entries = w.entries.filter((en) => en.done);
      w.finishedAt = Date.now();
    }
    state.active = null;
    stopTimer(); save(); ui.screen = 'today'; render();
    if (logged) toast(ticked ? 'Workout saved. Counted ' + plural(ticked, 'set') + ' you typed but did not tick' : 'Workout saved');
    window.scrollTo(0, 0);
  }

  function discardWorkout() {
    const w = activeWorkout(); if (!w) return;
    if (!confirm('Discard this workout? Logged sets will be lost.')) return;
    w.entries.forEach((en, i) => { if (en.done) reopenEntry(w, i); });
    state.workouts = state.workouts.filter((x) => x.id !== w.id); markDeleted('workouts', w.id);
    state.active = null;
    stopTimer(); save(); render();
  }

  // ---------------------------------------------------------------------------
  // Rest timer
  // ---------------------------------------------------------------------------
  // A short beep when rest is over. iPhones ignore navigator.vibrate, so sound is the only cue.
  // The audio context has to be created inside a tap, which startTimer always is.
  let audioCtx = null;
  function unlockAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }
  function beep() {
    if (!audioCtx) return;
    try {
      const t = audioCtx.currentTime;
      [0, 0.2, 0.4].forEach((off) => {
        const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t + off);
        g.gain.exponentialRampToValueAtTime(0.5, t + off + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.16);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t + off); o.stop(t + off + 0.18);
      });
    } catch (e) { /* ignore */ }
  }
  function startTimer(sec, kind) {
    if (!sec) return;
    if (timer.handle && timer.kind === 'cardio' && kind !== 'cardio') return;  // cardio keeps running
    unlockAudio();
    timer.kind = kind || 'rest';
    const label = $('.rest-label'); if (label) label.textContent = timer.kind === 'cardio' ? 'Cardio' : 'Rest';
    timer.total = sec; timer.end = Date.now() + sec * 1000;
    $('#rest-timer').hidden = false;
    tick();
    clearInterval(timer.handle);
    timer.handle = setInterval(tick, 500);
  }
  function tick() {
    const left = Math.max(0, Math.ceil((timer.end - Date.now()) / 1000));
    $('#rest-time').textContent = fmtTime(left);
    $('#rest-bar-fill').style.width = (left / timer.total * 100) + '%';
    if (left <= 0) {
      const kind = timer.kind;
      stopTimer(); beep(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      const w = activeWorkout();
      if (kind === 'cardio' && w && w.cardio) { w.cardio.done = true; save(); render(); toast('Cardio done · ' + w.cardio.min + ' min logged'); }
      else toast(kind === 'cardio' ? 'Cardio done' : 'Rest over');
    }
  }
  function stopTimer() { clearInterval(timer.handle); timer.handle = null; timer.kind = 'rest'; $('#rest-timer').hidden = true; }

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
  // Import / export
  // ---------------------------------------------------------------------------
  // On iPhone the share sheet is the reliable way out of a home-screen app (Save to Files, AirDrop, Mail).
  async function exportJson() {
    if (await shareFile(JSON.stringify(state, null, 2), 'overload-backup-' + todayKey() + '.json', 'Overload backup')) exported();
  }
  // Resolves true when the file was handed over (false when he cancelled the share sheet).
  async function shareFile(text, name, title) {
    try {
      const file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return true;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
    }
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  }
  // ---- Saved data that could not be read at start ----
  function renderUnreadable() {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    renderTopbar();
    const raw = ui.unreadable.raw;
    $('#app').innerHTML = '<div class="screen-title"><h1>Your data</h1></div>'
      + '<div class="card"><p><b>Overload could not read the data saved on this phone.</b></p>'
      + '<p class="small muted mt8">' + (raw ? 'Nothing has been changed or deleted. Save a copy of it first, then choose what to do.' : 'The phone did not let the app read its storage. Try again first.') + '</p>'
      + '<div class="list mt12">' + (raw ? '<button class="btn block" data-action="unreadable-export">Export the unreadable copy</button>' : '')
      + '<button class="btn ghost block" data-action="unreadable-retry">Try again</button></div></div>'
      + '<div id="restore-section" hidden><div class="group-title">Restore an automatic copy</div><div class="card"><div id="safety-copies"></div></div></div>'
      + '<div class="group-title">Start fresh</div><div class="card"><p class="small muted mb8">An empty app with the default program. If you used cloud sync, your cloud copy comes back once you are signed in.</p>'
      + '<button class="btn danger block" data-action="unreadable-fresh">Start fresh</button></div>';
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
    if (a === 'unreadable-export') { if (raw) shareFile(raw, 'overload-unreadable-' + todayKey() + '.json', 'Overload data that could not be read'); return; }
    if (a === 'export-copy') {
      const B = window.__overloadBackup; let c = null;
      try { c = B && await B.get(d.id); } catch (e) { c = null; }
      if (c) shareFile(c.text, 'overload-unreadable-' + todayKey(new Date(c.at)) + '.json', 'Overload data that could not be read'); else toast('Could not read that copy');
      return;
    }
    if (a === 'unreadable-fresh') {
      if (!ui.unreadable) return;
      let kept = false;
      try { const c = raw && window.__overloadBackup && await window.__overloadBackup.get('before-unreadable'); kept = !!(c && c.text === raw); } catch (e) { kept = false; }
      const msg = !raw ? 'Start fresh? The app could not read its storage, so it cannot tell what is there. Starting fresh replaces it.'
        : 'Start fresh with an empty app?\n\n' + (kept ? 'The data that could not be read stays in Settings > Automatic copies, where you can export it.' : 'Export the unreadable copy first if you might need it: it is not kept anywhere else.');
      if (!confirm(msg)) return;
      state = seedState(); ui.lastActive = null;
      leaveUnreadable();
      applyTheme(); const ok = save(); ui.screen = 'today'; render(); toast(ok ? 'Started fresh' : NOT_SAVED);
    }
  }
  function exported() {
    setBackupInfo({ lastExport: Date.now() });
    const el = $('#last-export'); if (el) el.textContent = lastExportText();
    refreshNotices();
  }
  // Signed out, a reset or import must not keep the note of what the cloud holds: the next sign-in would treat
  // everything missing here as deleted and remove it from the cloud. Without the note, sign-in merges the cloud back.
  function forgetCloudIfSignedOut() {
    const sync = window.__overloadSync;
    if (!(sync && sync.user)) { try { localStorage.removeItem(SYNC_KEY); } catch (e) { /* ignore */ } }
  }
  // Signed in, a reset or import syncs out and replaces the cloud copy too. Say so.
  function cloudNote(verb) {
    const sync = window.__overloadSync;
    return sync && sync.user ? '\n\nYou are signed in to cloud sync, so the copy in your account (' + sync.user.email + ') is ' + verb + ' too.' : '';
  }
  function importJson(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(r.result, noProto);
        if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.exercises)) throw new Error('bad');
        if (!confirm('Replace everything on this phone with the backup?\n\n' + dataSummary(parsed, 'The backup') + '\n' + dataSummary(state, 'This phone now')
          + activeLine(parsed, 'the backup') + cloudNote('replaced'))) return;
        // A backup carries the WHOOP connector link. Take it from the file only when he says so;
        // a backup without one (made before pairing) keeps this phone's link.
        const cur = state.settings, inc = isObj(parsed.settings) ? parsed.settings : (parsed.settings = {});
        if (!inc.connUrl && !inc.connKey) ['connUrl', 'connKey'].forEach((k) => { if (cur[k]) inc[k] = cur[k]; });
        else if (inc.connUrl !== cur.connUrl || inc.connKey !== cur.connKey) {
          const okUrl = typeof inc.connUrl === 'string' && /^https:\/\/[^/@\s"'<>]+$/.test(inc.connUrl);
          if (!(okUrl && confirm('This backup is linked to a WHOOP connector at ' + inc.connUrl + '. Use that link on this phone?\n\nCancel keeps ' + (cur.connUrl ? 'this phone\'s own link.' : 'this phone without one.')))) {
            ['connUrl', 'connKey'].forEach((k) => { if (cur[k]) inc[k] = cur[k]; else delete inc[k]; });
          }
        }
        replaceState(parsed, 'import', 'Backup restored');
      } catch (e) { toast('That file is not an Overload backup'); }
    };
    r.readAsText(file);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) { ui.screen = tab.dataset.screen; render(); window.scrollTo(0, 0); scrollToNext(); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const a = btn.dataset.action, d = btn.dataset;
    if (a.startsWith('food-')) { if (window.__overloadFood) window.__overloadFood.click(a, d, btn); return; }
    if (a.startsWith('conn-')) { if (window.__overloadConn) window.__overloadConn.click(a, d, btn); return; }
    const w = activeWorkout();

    switch (a) {
      // Today
      case 'select-day': ui.selectedDay = +d.i; ui.showOthers = false; render(); break;
      case 'toggle-others': ui.showOthers = !ui.showOthers; render(); break;
      case 'reload': location.reload(); break;
      case 'start-workout': startWorkout(d.day); break;
      case 'start-deload': startWorkout(d.day, true); break;
      case 'toggle-deload': {
        const n = setDeload(w, !w.deload); save(); render();
        toast(w.deload ? 'Deload on' + (n ? ' · next-time plans put back for ' + plural(n, 'finished exercise') : '') : 'Deload off' + (n ? ' · ' + plural(n, 'finished exercise') + ' judged as usual' : ''));
        break;
      }
      case 'set-soreness': w.soreness[d.m] = +d.v; save(); renderKeeping('#soreness-card'); break;
      case 'soreness-edit': ui.sorenessEdit = w.id; render(); break;
      case 'soreness-done': ui.sorenessEdit = null; renderKeeping('#soreness-card'); break;
      case 'open-entry': openDone.add(w.entries[+d.e]); render(); break;
      case 'close-entry': openDone.delete(w.entries[+d.e]); renderKeeping('[data-card="' + d.e + '"]'); break;
      case 'toggle-set': {
        const en = w.entries[+d.e], s = en.sets[+d.s];
        if (!s.done) {
          // A loaded lift with no weight would be logged at 0. Ask for the weight instead.
          const ex = exById(en.exId);
          if (!(s.weight > 0) && ex && LOADED.includes(ex.equipment) && !isAssisted(ex)) {
            const inp = $('[data-field="weight"][data-e="' + d.e + '"][data-s="' + d.s + '"]');
            if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus({ preventScroll: true }); }  // above the message, not under it
            toast('Enter the weight first');
            return;
          }
          // Empty reps box: one tap logs the goal shown in it (marked, so unticking takes it back out).
          if (!(s.reps > 0)) { if (!(en.targetReps > 0)) { toast('Enter reps first'); return; } s.reps = en.targetReps; s.auto = true; }
          s.done = true; startTimer(restFor(ex));
        } else {
          s.done = false; s.rir = null;  // its RIR row is hidden while unticked, so a picked value must not linger and count later
          if (s.auto) { s.reps = 0; delete s.auto; }  // reps typed by hand stay
        }
        save(); render(); break;
      }
      case 'add-set': { const en = w.entries[+d.e]; const last = en.sets[en.sets.length - 1]; en.sets.push({ weight: last ? last.weight : 0, reps: 0, done: false, rir: null }); save(); render(); break; }
      case 'pick-rir': {
        const s = w.entries[+d.e].sets[+d.s];
        s.rir = rirIs(s.rir, +d.v) ? null : +d.v;
        save();
        // Update the four buttons in place (no redraw needed).
        btn.parentNode.querySelectorAll('[data-action="pick-rir"]').forEach((b) => { const on = rirIs(s.rir, +b.dataset.v); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
        break;
      }
      case 'gen-warmup': genWarmups(w.entries[+d.e]); save(); render(); break;
      case 'clear-warmup': w.entries[+d.e].warmups = null; save(); render(); break;
      case 'toggle-warmup': { const wu = w.entries[+d.e].warmups[+d.s]; wu.done = !wu.done; if (wu.done) startTimer(state.settings.warmupRest); save(); render(); break; }
      case 'swap-entry': sheetPicker({ swap: +d.e }); break;
      case 'remove-set': {
        const en = w.entries[+d.e]; if (en.sets.length <= 1) break;
        // Take the last empty set. If every set is ticked or has reps typed, ask before removing the last one.
        let i = en.sets.length - 1; while (i >= 0 && (en.sets[i].done || en.sets[i].reps > 0)) i--;
        if (i < 0) {
          i = en.sets.length - 1; const s = en.sets[i];
          if (!confirm('Set ' + (i + 1) + ' is ' + (s.done ? 'ticked' : 'filled in') + ': ' + fmtW(s.weight) + ' ' + state.settings.units + ' × ' + s.reps + '. Remove it?')) break;
        }
        en.sets.splice(i, 1); save(); render(); break;
      }
      case 'set-fb': { const en = w.entries[+d.e]; en[d.f] = en[d.f] === +d.v ? null : +d.v; save(); render(); break; }
      case 'finish-entry': finishEntry(w, +d.e); openDone.delete(w.entries[+d.e]); save(); renderKeeping('[data-card="' + d.e + '"]'); break;
      case 'reopen-entry': reopenEntry(w, +d.e); save(); render(); break;
      case 'remove-entry': if (confirm('Remove this exercise from today?')) { if (w.entries[+d.e].done) reopenEntry(w, +d.e); w.entries.splice(+d.e, 1); save(); render(); } break;
      case 'add-entry': sheetPicker({ workout: true }); break;
      case 'finish-workout': finishWorkout(); break;
      case 'cardio-timer': { const c = ensureCardio(w); if (!c || !(c.min > 0)) break; startTimer(Math.round(c.min * 60), 'cardio'); render(); break; }
      case 'cardio-done': { const c = ensureCardio(w); if (!c) break; if (timer.kind === 'cardio') stopTimer(); c.done = true; save(); render(); toast('Cardio logged'); break; }
      case 'cardio-undo': if (w && w.cardio) { w.cardio.done = false; save(); render(); } break;
      case 'discard-workout': discardWorkout(); break;
      case 'rest-skip': { const k = timer.kind; stopTimer(); if (k === 'cardio') render(); break; }
      case 'rest-add': timer.end += 30000; timer.total += 30; tick(); break;

      // Program
      case 'add-day': { const day = { id: uid(), name: 'New day', exercises: [] }; state.program.days.push(day); save(); render(); sheetDay(day.id); break; }
      case 'edit-day': sheetDay(d.day); break;
      case 'dup-day': { const src = dayById(d.day); if (!src) break; const copy = { id: uid(), name: src.name + ' copy', exercises: src.exercises.slice() }; state.program.days.push(copy); save(); render(); sheetDay(copy.id); toast('Day duplicated'); break; }
      case 'delete-day': if (confirm('Delete this day?')) { state.program.days = state.program.days.filter((x) => x.id !== d.day); state.program.schedule = state.program.schedule.map((x) => (x === d.day ? null : x)); save(); closeSheet(); render(); } break;
      case 'day-move': { const day = dayById(d.day); const i = +d.i, j = i + (+d.d); if (j < 0 || j >= day.exercises.length) break; [day.exercises[i], day.exercises[j]] = [day.exercises[j], day.exercises[i]]; save(); sheetDay(d.day); render(); break; }
      case 'day-remove-ex': { const day = dayById(d.day); day.exercises.splice(+d.i, 1); save(); sheetDay(d.day); render(); break; }
      case 'pick-ex': sheetPicker({ day: d.day }); break;
      case 'pick-ex-choose': {
        if (ui.pickTarget.day) {
          dayById(ui.pickTarget.day).exercises.push(d.ex); save(); sheetDay(ui.pickTarget.day); render();
          // show the exercise just added (last in the list) and the button to add another
          const panel = $('#sheet-panel'), add = panel.querySelector('[data-action="pick-ex"]');
          if (add) { const over = add.getBoundingClientRect().bottom + 12 - panel.getBoundingClientRect().bottom; if (over > 0) panel.scrollTop += over; }
        }
        else if (ui.pickTarget.swap != null) { swapEntry(w, ui.pickTarget.swap, d.ex); save(); closeSheet(); render(); }
        else { w.entries.push(newEntry(d.ex)); save(); closeSheet(); render(); }
        break;
      }
      case 'save-template': saveTemplate(); break;
      case 'program-view': sheetProgram(d.p); break;
      case 'program-use': useProgram(d.p); break;
      case 'use-template': useTemplate(d.t); break;
      case 'delete-template': if (confirm('Delete this template?')) { state.templates = state.templates.filter((x) => x.id !== d.t); save(); render(); } break;
      case 'cal-prev': ui.calOffset--; render(); break;
      case 'cal-next': if (ui.calOffset < 0) { ui.calOffset++; render(); } break;
      case 'review-set': ui.reviewOffset = +d.v; render(); break;
      case 'review-share': shareReview(); break;
      case 'bw-list': sheetBodyweight(); break;
      case 'bw-delete': state.bodyweight = state.bodyweight.filter((b) => b.date !== d.date); markDeleted('bw', d.date); save(); sheetBodyweight(); render(); break;
      case 'set-rir': state.settings.trackRir = d.v === '1'; save(); render(); break;
      case 'set-cardio': state.settings.cardioOn = d.v === '1'; save(); render(); break;
      case 'set-sleep': state.settings.sleepOn = d.v === '1'; save(); render(); break;
      case 'checkin-edit': ui.checkinEdit = true; render(); break;
      case 'checkin-cancel': ui.checkinEdit = false; render(); break;
      case 'sleep-list': sheetSleep(); break;
      case 'sleep-delete': {
        state.sleep = state.sleep.filter((x) => x.date !== d.date);
        markDeleted('sleep', d.date);  // also keeps WHOOP from bringing it back
        save(); sheetSleep(); render(); break;
      }
      case 'pick-new-ex': sheetExercise(null); break;

      // Exercises
      case 'edit-ex': sheetExercise(d.ex); break;
      case 'new-ex': ui.pickTarget = null; sheetExercise(null); break;
      case 'delete-ex': {
        const used = state.workouts.some((x) => x.entries.some((en) => en.exId === d.ex));
        if (!confirm(used ? 'Delete this exercise? Its history stays but shows as "Deleted exercise".' : 'Delete this exercise?')) break;
        state.exercises = state.exercises.filter((x) => x.id !== d.ex);
        state.program.days.forEach((day) => { day.exercises = day.exercises.filter((x) => x !== d.ex); });
        state.templates.forEach((t) => t.days.forEach((day) => { day.exercises = day.exercises.filter((x) => x !== d.ex); }));
        if (w) w.entries = w.entries.filter((en) => en.exId !== d.ex || en.done);  // sets already logged today stay
        delete state.presc[d.ex];
        save(); closeSheet(); render(); break;
      }

      // History
      case 'view-workout': sheetWorkout(d.w); break;
      case 'edit-workout': sheetEditWorkout(d.w); break;
      case 'delete-workout': {
        const wk = state.workouts.find((x) => x.id === d.w); if (!wk) break;
        // Roll next-time weights back for exercises this workout was the latest session of.
        const back = wk.entries.filter((en) => en.done && en.prevPresc && exById(en.exId) && isLatestSessionFor(en.exId, wk));
        const msg = back.length ? 'Delete this workout? Next-time weights for ' + plural(back.length, 'exercise') + ' go back to what they were before it.' : 'Delete this workout from history?';
        if (!confirm(msg)) break;
        back.forEach((en) => { state.presc[en.exId] = JSON.parse(JSON.stringify(en.prevPresc)); });
        state.workouts = state.workouts.filter((x) => x.id !== d.w); markDeleted('workouts', d.w);
        save(); closeSheet(); render(); break;
      }

      // Settings
      case 'set-theme': state.settings.theme = d.v; applyTheme(); save(); render(); break;
      case 'export': exportJson(); break;
      case 'import': $('#import-file').click(); break;
      case 'restore-copy': restoreCopy(d.id); break;
      case 'export-copy': case 'unreadable-export': case 'unreadable-retry': case 'unreadable-fresh': unreadableAction(a, d); break;
      case 'export-nag-off': setBackupInfo({ nagOff: Date.now() }); refreshNotices(); break;
      case 'reset': if (confirm('Erase all exercises, program, history and food log on this phone?' + cloudNote('erased')) && confirm('Really erase everything?' + (cloudNote('erased') ? ' Export a backup first if you might want it back.' : ''))) { safetyCopy('reset'); forgetCloudIfSignedOut(); state = seedState(); save(); render(); toast('Reset to defaults'); } break;

      case 'sheet-close': closeSheet(); break;

      // Cloud
      case 'goto-settings': ui.screen = 'settings'; render(); window.scrollTo(0, 0); break;
      case 'cloud-signup': cloudAction('signup'); break;
      case 'cloud-reset': cloudAction('reset'); break;
      case 'cloud-signout': cloudAction('signout'); break;
      case 'cloud-push': cloudAction('push'); break;
    }
  });

  document.addEventListener('submit', (e) => {
    if (/^food-/.test(e.target.id || '')) { e.preventDefault(); if (window.__overloadFood) window.__overloadFood.submit(e.target); return; }
    if (e.target.closest('#cloud-form')) { e.preventDefault(); cloudAction('signin'); return; }
    if (e.target.closest('#bw-form')) { e.preventDefault(); saveCheckin(e.target.closest('#bw-form')); return; }
    const ef = e.target.closest('#edit-workout-form');
    if (ef) {
      e.preventDefault();
      const wk = state.workouts.find((x) => x.id === ef.dataset.w); if (!wk) return;
      const fd = new FormData(ef);
      const changed = new Map();  // entry -> its sets before the correction
      wk.entries.forEach((en, ei) => { const oldSets = JSON.parse(JSON.stringify(en.sets)); en.sets.forEach((s, si) => {
        if (!s.done) return;
        const wv = fd.get('w-' + ei + '-' + si), rv = fd.get('r-' + ei + '-' + si), was = s.weight + '×' + s.reps;
        if (wv != null) s.weight = Math.max(0, num(wv, s.weight));
        if (rv != null) s.reps = Math.max(0, Math.round(num(rv, s.reps)));
        if (s.weight + '×' + s.reps !== was) changed.set(en, oldSets);
      }); });
      const redone = recalcEdited(wk, changed);
      save(); sheetWorkout(wk.id); render(); toast('Workout updated' + (redone.length ? ' · next time recalculated for ' + (redone.length > 2 ? plural(redone.length, 'exercise') : redone.join(' and ')) : ''));
      return;
    }
    const form = e.target.closest('#ex-form'); if (!form) return;
    e.preventDefault();
    const f = new FormData(form);
    const name = String(f.get('name') || '').trim(); if (!name) return;
    // A rep range needs both ends, low to high (one box alone used to give a one-number range like 10–10).
    const repMin = num(f.get('repMin'), 0) > 0 ? Math.round(num(f.get('repMin'), 0)) : null;
    const repMax = num(f.get('repMax'), 0) > 0 ? Math.round(num(f.get('repMax'), 0)) : null;
    const refuse = (msg) => { if (document.activeElement) document.activeElement.blur(); toast(msg); };  // keyboard down, so the message shows
    if (!repMin !== !repMax) { refuse('Fill in both Rep min and Rep max, or leave both blank'); return; }
    if (repMin && repMax < repMin) { refuse('Rep min is higher than Rep max'); return; }
    let ex = form.dataset.ex ? exById(form.dataset.ex) : null;
    const oldRange = repRange(ex);
    if (!ex) { ex = { id: uid(), custom: true }; state.exercises.push(ex); }
    ex.name = name; ex.muscle = f.get('muscle'); ex.equipment = f.get('equipment');
    ex.increment = num(f.get('increment'), 0) > 0 ? num(f.get('increment'), 0) : null;
    ex.notes = String(f.get('notes') || '').trim() || null;
    ex.restSec = num(f.get('restSec'), 0) > 0 ? Math.round(num(f.get('restSec'), 0)) : null;
    ex.repMin = repMin; ex.repMax = repMax;
    ex.fixedSets = num(f.get('fixedSets'), 0) > 0 ? clamp(Math.round(num(f.get('fixedSets'), 0)), 1, 20) : null;
    const p = prescFor(ex.id);
    p.weight = Math.max(0, num(f.get('weight'), 0));
    p.sets = ex.fixedSets || clamp(Math.round(num(f.get('sets'), p.sets)), 1, 20);
    p.targetReps = clamp(Math.round(num(f.get('targetReps'), p.targetReps)), 1, 100);
    // A new range moves the goal to its bottom, unless the goal was typed in this same save.
    const goalBox = form.elements.targetReps, r = repRange(ex);
    if ((r.min !== oldRange.min || r.max !== oldRange.max) && (!goalBox || goalBox.value === goalBox.defaultValue || goalBox.value === '')) goalToRange(ex, p);
    save();
    // If we came from the picker, add the new exercise to its target.
    if (ui.pickTarget && !form.dataset.ex) {
      if (ui.pickTarget.day) { dayById(ui.pickTarget.day).exercises.push(ex.id); sheetDay(ui.pickTarget.day); }
      else if (ui.pickTarget.swap != null && activeWorkout()) { swapEntry(activeWorkout(), ui.pickTarget.swap, ex.id); closeSheet(); }
      else if (ui.pickTarget.workout && activeWorkout()) { activeWorkout().entries.push(newEntry(ex.id)); closeSheet(); }
      ui.pickTarget = null; save();
    } else closeSheet();
    render();
  });

  document.addEventListener('input', (e) => {
    const el = e.target; const f = el.dataset.field; if (!f) return;
    if (f.startsWith('food-')) { if (window.__overloadFood) window.__overloadFood.input(el, f); return; }
    if (f === 'search') { ui.search = el.value; const app = $('#app'); const html = renderExercises(); const tmp = document.createElement('div'); tmp.innerHTML = html; app.replaceChildren(...tmp.childNodes); const inp = $('[data-field="search"]'); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    else if (f === 'pick-search') { ui.pickSearch = el.value; renderPicker(); const inp = $('[data-field="pick-search"]'); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  });

  document.addEventListener('change', (e) => {
    const el = e.target; const f = el.dataset.field; if (!f) return;
    if (f.startsWith('food-')) { if (window.__overloadFood) window.__overloadFood.change(el, f); return; }
    if (f.startsWith('conn-')) { if (window.__overloadConn) window.__overloadConn.change(el, f); return; }
    const w = activeWorkout();
    switch (f) {
      case 'weight': case 'reps': {
        const en = w.entries[+el.dataset.e]; const i = +el.dataset.s; const s = en.sets[i];
        const v = Math.max(0, num(el.value, 0));
        if (f === 'weight') {
          const old = s.weight; s.weight = v;
          // Carry the new weight to later, not-yet-done sets that still had the old value.
          en.sets.forEach((x, j) => { if (j > i && !x.done && x.weight === old) x.weight = v; });
          document.querySelectorAll('[data-field="weight"][data-e="' + el.dataset.e + '"]').forEach((inp) => { inp.value = en.sets[+inp.dataset.s].weight || ''; });
        } else {
          s.reps = Math.round(v); delete s.auto;
          const fin = $('[data-action="finish-entry"][data-e="' + el.dataset.e + '"]'); if (fin && s.reps > 0) fin.disabled = false;
        }
        save(); break;
      }
      case 'cardio': {
        const c = w && ensureCardio(w); if (!c) break;
        const v = el.value === '' ? null : Math.max(0, num(el.value, 0));
        if (el.dataset.k === 'min') c.min = v ? Math.round(v) : (state.settings.cardioMin || 20); else c[el.dataset.k] = v;
        save();
        // Patch in place: rebuilding the screen here would swallow the tap that moved focus away.
        el.value = c[el.dataset.k] == null ? '' : c[el.dataset.k];
        const tb = $('[data-action="cardio-timer"]');
        if (el.dataset.k === 'min' && tb && !(timer.handle && timer.kind === 'cardio')) tb.textContent = 'Start ' + c.min + ':00 timer';
        const today = $('#cardio-today'); if (today) today.textContent = 'Today: ' + cardioText(c);
        break;
      }
      case 'cardio-name': state.settings.cardioName = el.value.trim() || 'Cardio'; el.value = state.settings.cardioName; save(); break;
      case 'schedule': state.program.schedule[+el.dataset.i] = el.value || null; save(); render(); break;
      case 'day-name': { const day = dayById(el.dataset.day); day.name = el.value.trim() || day.name; el.value = day.name; save(); render(); break; }
      case 'setting': {
        const k = el.dataset.k; const s = state.settings; let v = num(el.value, s[k]);
        if (k === 'increment' || k === 'incDumbbell' || k === 'incMachine' || k === 'incCable') v = Math.max(0.5, v);
        if (k === 'repMin' || k === 'repMax' || k === 'defaultSets' || k === 'maxSets') v = Math.max(1, Math.round(v));
        if (k === 'restSec' || k === 'warmupRest' || k === 'weighEvery' || k === 'volumeMin' || k === 'volumeMax') v = Math.max(0, Math.round(v));
        if (k === 'cardioMin') v = clamp(Math.round(v), 1, 240);
        s[k] = v;
        if (s.repMax < s.repMin) s.repMax = s.repMin;
        if (s.volumeMax < s.volumeMin) s.volumeMax = s.volumeMin;
        save();
        if (el.tagName === 'SELECT') { render(); break; }
        // A number box: show the cleaned value (and its partner's) in place. Rebuilding the screen would swallow the next tap.
        el.value = s[k];
        const pair = { repMin: 'repMax', repMax: 'repMin', volumeMin: 'volumeMax', volumeMax: 'volumeMin' }[k];
        const other = pair && $('[data-field="setting"][data-k="' + pair + '"]');
        if (other && other !== document.activeElement) other.value = s[pair];
        break;
      }
      case 'chart-ex': ui.chartEx = el.value || null; render(); break;
    }
  });
  document.addEventListener('change', (e) => { if (e.target.id === 'import-file' && e.target.files[0]) { importJson(e.target.files[0]); e.target.value = ''; } });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  state = load();
  applyTheme();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  if (ui.unreadable) { if (ui.unreadable.raw) safetyCopy('unreadable', true, ui.unreadable.raw); } else save();
  if (activeWorkout()) ui.screen = 'today';
  if (!backupInfo().since) setBackupInfo({ since: Date.now() });
  render();
  ui.booted = true;
  if (!ui.unreadable) safetyCopy('day');
  // Ask the browser to keep this app's storage when the phone runs low on space (no question is shown on iPhone).
  try { navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {}); } catch (e) { /* not available */ }
  setInterval(() => { const el = $('#elapsed'); const w = activeWorkout(); if (el && w) el.textContent = durationText(w); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ui.dayKey !== todayKey() && !ui.sheet) render(); });
  // A workout in progress opens at the next set, not at the top (and the browser must not restore an old position over it).
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) { /* ignore */ }
  scrollToNext();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // When a new service worker takes over, reload once so the new files are
    // what is running. Everything is saved on every change, so this is safe.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return;
      // Mid-workout, or while typing, a reload could eat what is in the box. Offer it instead.
      const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (activeWorkout() || typing) { ui.updateReady = true; renderTopbar(); return; }
      reloading = true; location.reload();
    });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
      reg.update().catch(() => {});
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Updating…'); });
      });
    }).catch(() => {});
    // Also look for updates whenever the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {}); });
  }

  // API for sync.js (and console debugging).
  window.__overload = {
    get state() { return state; },
    get screen() { return ui.screen; },
    get saveFailed() { return !!ui.saveFailed; },
    get unreadable() { return !!ui.unreadable; },   // sync waits while the stored data could not be read
    safetyCopy,
    setState, computeNext, save, render, toast, checkinDone,
    // Shared with food.js
    lib: { $, esc, uid, num, todayKey, addDays, fmtDate, openSheet, closeSheet, sheetHeader, toast, markDeleted },
    noteUpdateReady() { ui.updateReady = true; renderTopbar(); },
    // Sync status: only the top-bar pill and the status text in Settings change. Redrawing the screen here
    // threw away whatever was being typed in Settings (it changes twice for every upload).
    setSyncStatus(status, msg) {
      ui.sync = { status, msg: msg || '' };
      const pill = $('.sync-pill');
      if (pill && status !== 'off') { pill.className = 'pill sync-pill ' + status; pill.textContent = syncIcon(status); pill.title = ui.sync.msg; }
      else renderTopbar();
      const cs = $('#cloud-status'); if (cs) { cs.textContent = ui.sync.msg || 'Connected'; cs.style.color = cloudColour(status); }
    },
    // Signed in or out: redraw the pill and the Cloud sync card only, not the screen.
    syncChanged() {
      renderTopbar();
      const card = $('#cloud-card');
      if (card) { const tmp = document.createElement('div'); tmp.innerHTML = renderCloudCard(); if (!card.isEqualNode(tmp.firstElementChild)) card.replaceWith(tmp.firstElementChild); }
      refreshNotices();   // the export reminder depends on cloud sync
    }
  };
})();
