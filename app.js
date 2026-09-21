/* Overload — personal hypertrophy tracker.
 * Vanilla JS, no build step. All data lives in localStorage on this device.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const STORAGE_KEY = 'overload.state.v1';
  const VERSION = '1.4';
  const MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs'];
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
    // Curl Fitness Costa Mesa: Newtech OnHim line, plate-loaded and cable pieces.
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
    return { units: 'lb', increment: 2.5, repMin: 10, repMax: 12, restSec: 120, maxSets: 6, defaultSets: 3, theme: 'system', trackRir: true, weighEvery: 7, volumeMin: 10, volumeMax: 20, warmupRest: 45, incDumbbell: 5, incMachine: 5, incCable: 5 };
  }

  function seedState() {
    const s = { v: 1, settings: defaultSettings(), exercises: [], presc: {}, program: { days: [], schedule: [null, null, null, null, null, null, null] }, workouts: [], active: null, bodyweight: [], templates: [] };
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
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1) {
          return normalize(parsed);
        }
      }
    } catch (e) { /* fall through */ }
    return seedState();
  }
  // Fill in fields added after v1 shipped so older saves keep working.
  function normalize(st) {
    st.settings = Object.assign(defaultSettings(), st.settings || {});
    if (!Array.isArray(st.bodyweight)) st.bodyweight = [];
    if (!Array.isArray(st.templates)) st.templates = [];
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
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save. Storage full?'); }
    document.dispatchEvent(new CustomEvent('overload:save'));
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
    if (!next || next.v !== 1) return;
    state = normalize(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    if (!activeWorkout()) state.active = null;
    applyTheme();
    render();
  }

  // Accessors
  const exById = (id) => state.exercises.find((e) => e.id === id);
  const dayById = (id) => state.program.days.find((d) => d.id === id);
  const activeWorkout = () => (state.active ? state.workouts.find((w) => w.id === state.active) : null);
  function prescFor(exId) {
    if (!state.presc[exId]) state.presc[exId] = { weight: 0, targetReps: repRange(exById(exId)).min, sets: state.settings.defaultSets, reasons: [], updatedAt: null };
    return state.presc[exId];
  }
  function repRange(ex) {
    return { min: (ex && ex.repMin) || state.settings.repMin, max: (ex && ex.repMax) || state.settings.repMax };
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
  // True when no later finished workout logged this exercise.
  function isLatestSessionFor(exId, w) {
    return !state.workouts.some((o) => o.id !== w.id && o.finishedAt && (o.startedAt || 0) > (w.startedAt || 0) && o.entries.some((en) => en.exId === exId && en.done));
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

  // Best weight / estimated 1RM / reps-at-weight for an exercise, excluding one workout.
  function bestBefore(exId, excludeWorkoutId) {
    const best = { weight: 0, e1rm: 0, repsAt: {}, sessions: 0 };
    state.workouts.forEach((w) => {
      if (!w.finishedAt || w.id === excludeWorkoutId) return;
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
  function detectPrs(exId, entry, workoutId) {
    const best = bestBefore(exId, workoutId);
    if (!best.sessions) return [];
    const prs = [];
    const done = entry.sets.filter((st) => st.done && st.reps > 0);
    const top = done.reduce((a, b) => (b.weight > a.weight ? b : a), { weight: 0, reps: 0 });
    if (top.weight > best.weight) prs.push({ kind: 'weight', text: 'Heaviest ever: ' + fmtW(top.weight) + ' ' + state.settings.units + ' × ' + top.reps });
    const bestE = done.reduce((a, b) => (e1rm(b.weight, b.reps) > e1rm(a.weight, a.reps) ? b : a));
    if (e1rm(bestE.weight, bestE.reps) > best.e1rm + 0.01 && !prs.length) prs.push({ kind: 'e1rm', text: 'Best set ever: ' + fmtW(bestE.weight) + ' × ' + bestE.reps });
    done.forEach((st) => { if (best.repsAt[st.weight] && st.reps > best.repsAt[st.weight] && !prs.some((x) => x.kind === 'reps')) prs.push({ kind: 'reps', text: 'Most reps at ' + fmtW(st.weight) + ': ' + st.reps + ' (was ' + best.repsAt[st.weight] + ')' }); });
    return prs;
  }

  // ---------------------------------------------------------------------------
  // Progression algorithm
  // ---------------------------------------------------------------------------
  /**
   * Given the exercise, its current prescription, the logged sets and feedback,
   * return the next prescription { weight, targetReps, sets, reasons[] } or null
   * if nothing was logged.
   *
   * Weight rule (rep-range progression):
   *   - every set >= repMax           -> weight + increment, target back to repMin
   *   - some sets hit repMax          -> hold weight, target repMax ("push the rest")
   *   - all sets >= repMin            -> hold weight, target = lowest reps + 1
   *   - any set < repMin              -> hold weight, target repMin
   * Joint pain "moderate" blocks the weight increase; "a lot" drops the weight.
   *
   * Set rule (recovery feedback):
   *   - still sore / joint pain >= moderate / workload too much -> -1 set
   *   - recovered early AND low pump                            -> +1 set
   *   - never sore AND workload easy                            -> +1 set
   */
  function computeNext(ex, presc, entry, soreness) {
    const done = entry.sets.filter((s) => s.done && s.reps > 0);
    if (!done.length) return null;
    const inc = incFor(ex);
    const { min: repMin, max: repMax } = repRange(ex);
    const weight = done[done.length - 1].weight;
    const fb = { pump: entry.pump, joint: entry.joint, workload: entry.workload, soreness };
    const reasons = [];
    const next = { weight, targetReps: presc.targetReps, sets: presc.sets, reasons, updatedAt: Date.now() };
    const unit = state.settings.units;

    const lowest = Math.min(...done.map((s) => s.reps));
    const allTop = done.every((s) => s.reps >= repMax);
    const anyTop = done.some((s) => s.reps >= repMax);
    const jointHold = fb.joint != null && fb.joint >= 2;
    const rirs = done.map((st) => st.rir).filter((v) => v != null);
    const easy = rirs.length === done.length && rirs.every((v) => v >= 3);

    if (allTop && !jointHold) {
      next.weight = round(weight + inc, 0.01);
      next.targetReps = repMin;
      reasons.push('Hit ' + repMax + ' on every set → +' + fmtW(inc) + ' ' + unit + ', aim for ' + repMin);
    } else if (allTop && jointHold) {
      next.targetReps = repMax;
      reasons.push('Hit ' + repMax + ' on every set, but holding weight because of joint pain');
    } else if (lowest >= repMin && easy && !jointHold) {
      next.weight = round(weight + inc, 0.01);
      next.targetReps = repMin;
      reasons.push('Every set had 3+ reps in reserve → +' + fmtW(inc) + ' ' + unit + ' early, aim for ' + repMin);
    } else if (anyTop) {
      next.targetReps = repMax;
      reasons.push('Some sets hit ' + repMax + ' → hold weight, push every set to ' + repMax);
    } else if (lowest >= repMin) {
      next.targetReps = clamp(lowest + 1, repMin, repMax);
      reasons.push('Every set ≥ ' + lowest + ' → hold weight, aim for ' + next.targetReps);
    } else {
      next.targetReps = repMin;
      reasons.push('A set fell below ' + repMin + ' → hold weight, build back to ' + repMin);
    }

    if (fb.joint === 3) {
      next.weight = Math.max(0, round(weight - 2 * inc, 0.01));
      next.targetReps = repMin;
      reasons.push('A lot of joint pain → dropped ' + fmtW(2 * inc) + ' ' + unit + '. Consider swapping this exercise');
    }

    let delta = 0;
    if (fb.soreness === 3) { delta = -1; reasons.push('Still sore → −1 set'); }
    else if (fb.joint != null && fb.joint >= 2) { delta = -1; reasons.push('Joint pain → −1 set'); }
    else if (fb.workload === 3) { delta = -1; reasons.push('Too much → −1 set'); }
    else if ((fb.soreness === 0 || fb.soreness === 1) && fb.pump === 0) { delta = 1; reasons.push('Recovered early with a low pump → +1 set'); }
    else if (fb.soreness === 0 && fb.workload === 0) { delta = 1; reasons.push('Never sore and felt easy → +1 set'); }
    next.sets = clamp(presc.sets + delta, 1, state.settings.maxSets);
    if (delta === 0 && fb.soreness != null) reasons.push('Recovery looks right → keep ' + next.sets + ' sets');
    return next;
  }

  // ---------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------
  const ui = { screen: 'today', selectedDay: weekdayIndex(), sheet: null, search: '', chartEx: null, sync: { status: 'off', msg: '' }, calOffset: 0, reviewOffset: 0, showOthers: false, updateReady: false };
  const timer = { end: 0, total: 0, handle: null };

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function render() {
    const app = $('#app');
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === ui.screen));
    renderTopbar();
    switch (ui.screen) {
      case 'today': app.innerHTML = renderToday(); break;
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
      body = '<div class="card flat"><div class="card-head"><div><h2>' + esc(day.name) + '</h2><div class="meta">' + WEEKDAYS_LONG[ui.selectedDay] + ' · ' + day.exercises.length + ' exercises</div></div></div>'
        + '<div class="list">' + (items || '<div class="empty">No exercises yet. Add some in Program.</div>') + '</div>'
        + '<button class="btn block mt12" data-action="start-workout" data-day="' + day.id + '" ' + (day.exercises.length ? '' : 'disabled') + '>Start workout</button></div>' + otherHtml;
    }
    const last = state.workouts.filter((x) => x.finishedAt).slice(-1)[0];
    const lastLine = last ? '<p class="muted small center mt8">Last workout: ' + esc(last.dayName) + ' · ' + fmtDate(last.date) + '</p>' : '';
    const st = streakInfo();
    const streakLine = st.streak > 1 ? '<div class="banner">🔥 ' + st.streak + '-day streak. Keep it going.</div>' : '';
    return '<div class="screen-title"><h1>Today</h1><span class="sub">' + fmtDate(todayKey()) + '</span></div>' + streakLine + stripHtml + body + renderBodyweightCard() + lastLine;
  }

  // ---- Body weight ---------------------------------------------------------
  function bwSorted() { return state.bodyweight.slice().sort((a, b) => (a.date < b.date ? -1 : 1)); }
  function renderBodyweightCard() {
    const every = state.settings.weighEvery;
    if (!every) return '';
    const list = bwSorted();
    const lastBw = list[list.length - 1];
    const today = todayKey();
    const due = !lastBw || daysBetween(lastBw.date, today) >= every;
    const nextKey = lastBw ? addDays(lastBw.date, every) : today;
    const sub = lastBw ? 'Last ' + fmtW(lastBw.weight) + ' ' + state.settings.units + ' on ' + fmtDate(lastBw.date) + (due ? '' : ' · next ' + fmtDate(nextKey)) : 'No weigh-ins yet';
    return '<div class="card"><div class="row between"><div class="grow"><div class="row"><b>Body weight</b>' + (due ? '<span class="pill amber">Weigh-in due</span>' : '') + '</div><div class="small muted">' + sub + '</div></div></div>'
      + '<form id="bw-form" class="row mt12"><input class="input grow" name="weight" type="number" inputmode="decimal" step="any" min="0" placeholder="' + (lastBw ? fmtW(lastBw.weight) : 'Weight') + '"><button class="btn" type="submit">Log</button></form></div>';
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

  function renderActiveWorkout(w) {
    const day = dayById(w.dayId);
    // Soreness prompts: one per muscle with prior history
    const muscles = [];
    w.entries.forEach((en) => { const ex = exById(en.exId); if (ex && !muscles.includes(ex.muscle)) muscles.push(ex.muscle); });
    const askable = muscles.filter((m) => w.entries.some((en) => { const ex = exById(en.exId); return ex && ex.muscle === m && lastEntryFor(en.exId); }));
    let sorenessHtml = '';
    if (askable.length) {
      sorenessHtml = '<div class="card"><h3 class="mb8">Check-in</h3>' + askable.map((m) => {
        const v = w.soreness[m];
        return '<div class="prompt"><div class="prompt-q">How sore did your <span style="color:var(--accent-2)">' + m.toLowerCase() + '</span> get after last time?</div>'
          + '<div class="choice-grid">' + SORENESS.map((lbl, i) => '<button class="choice ' + (v === i ? 'on' : '') + '" data-action="set-soreness" data-m="' + m + '" data-v="' + i + '">' + lbl + '</button>').join('') + '</div></div>';
      }).join('') + '</div>';
    }

    const cards = w.entries.map((en, idx) => renderEntryCard(w, en, idx)).join('');
    const doneCount = w.entries.filter((e) => e.done).length;
    return '<div class="screen-title"><div><h1>' + esc(w.dayName) + '</h1><span class="sub">' + fmtDate(w.date) + ' · ' + doneCount + '/' + w.entries.length + ' done · <span id="elapsed">' + durationText(w) + '</span></span></div>'
      + '<button class="btn small ghost" data-action="add-entry">+ Exercise</button></div>'
      + sorenessHtml + cards
      + '<div class="btn-row mt12"><button class="btn subtle" data-action="discard-workout">Discard</button><button class="btn success" data-action="finish-workout">Finish workout</button></div>';
  }

  function renderEntryCard(w, en, idx) {
    const ex = exById(en.exId);
    if (!ex) return '';
    const p = prescFor(en.exId);
    const r = repRange(ex);
    const last = lastEntryFor(en.exId);
    const lastText = last ? 'Last time: ' + last.entry.sets.filter((s) => s.done).map((s) => fmtW(s.weight) + '×' + s.reps).join(', ') : 'First time logging this';
    const reason = (!en.done && p.reasons && p.reasons.length) ? '<div class="ex-reason ' + (/\+/.test(p.reasons[0]) ? 'green' : '') + '">' + esc(p.reasons[0]) + '</div>' : '';

    const rir = !!state.settings.trackRir;
    const rows = en.sets.map((s, i) => '<tr class="set-row ' + (s.done ? 'done' : '') + '">'
      + '<td class="n">' + (i + 1) + '</td>'
      + '<td><input class="set-input" type="number" inputmode="decimal" step="any" min="0" value="' + (s.weight || '') + '" placeholder="' + state.settings.units + '" data-field="weight" data-e="' + idx + '" data-s="' + i + '" ' + (en.done ? 'disabled' : '') + '></td>'
      + '<td><input class="set-input" type="number" inputmode="numeric" min="0" value="' + (s.reps || '') + '" placeholder="reps" data-field="reps" data-e="' + idx + '" data-s="' + i + '" ' + (en.done ? 'disabled' : '') + '></td>'
      + (rir ? '<td class="rir"><button class="rir-btn ' + (s.rir != null ? 'on' : '') + '" data-action="cycle-rir" data-e="' + idx + '" data-s="' + i + '" ' + (en.done ? 'disabled' : '') + '>' + (s.rir != null ? s.rir : '–') + '</button></td>' : '')
      + '<td class="chk"><button class="check ' + (s.done ? 'on' : '') + '" data-action="toggle-set" data-e="' + idx + '" data-s="' + i + '" ' + (en.done ? 'disabled' : '') + '>✓</button></td>'
      + '</tr>').join('');

    let warmHtml = '';
    if (en.warmups && en.warmups.length && !en.done) {
      warmHtml = '<div class="warmups"><div class="row between"><span class="tiny muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.05em">Warm-up</span><button class="btn small subtle" data-action="clear-warmup" data-e="' + idx + '">✕</button></div>'
        + en.warmups.map((wu, i) => '<div class="warmup-row ' + (wu.done ? 'done' : '') + '"><span class="n">W' + (i + 1) + '</span><span class="grow"><b>' + fmtW(wu.weight) + '</b> ' + state.settings.units + ' × <b>' + wu.reps + '</b></span><button class="check small ' + (wu.done ? 'on' : '') + '" data-action="toggle-warmup" data-e="' + idx + '" data-s="' + i + '">✓</button></div>').join('') + '</div>';
    }
    const prPill = en.prs && en.prs.length ? '<span class="pill pr">🏆 PR</span>' : '';
    const swapNote = en.swappedFrom ? (function () { const o = exById(en.swappedFrom); return o ? '<div class="ex-last">Swapped in for ' + esc(o.name) + ' today</div>' : ''; })() : '';

    const allDone = en.sets.length > 0 && en.sets.every((s) => s.done);
    let feedback = '';
    if (!en.done && en.sets.some((s) => s.done)) {
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
    }

    const body = en.done
      ? '<div class="ex-body">' + nextBox + '<div class="card-actions"><button class="btn small subtle" data-action="reopen-entry" data-e="' + idx + '">Edit</button></div></div>'
      : '<div class="ex-body">' + warmHtml + '<table class="set-table"><thead><tr><th class="n">Set</th><th>' + state.settings.units + (ex.equipment === 'Dumbbell' ? ' (each)' : '') + '</th><th>Reps</th>' + (rir ? '<th class="rir" title="Reps in reserve">RIR</th>' : '') + '<th></th></tr></thead><tbody>' + rows + '</tbody></table>'
        + '<div class="set-tools"><button class="btn small ghost" data-action="add-set" data-e="' + idx + '">+ Set</button><button class="btn small subtle" data-action="remove-set" data-e="' + idx + '" ' + (en.sets.length <= 1 ? 'disabled' : '') + '>− Set</button><button class="btn small subtle" data-action="gen-warmup" data-e="' + idx + '" ' + (en.warmups && en.warmups.length ? 'disabled' : '') + '>Warm-up</button></div>'
        + '<div class="set-tools secondary"><button class="btn small subtle" data-action="swap-entry" data-e="' + idx + '">Swap exercise</button><button class="btn small subtle" data-action="remove-entry" data-e="' + idx + '">Remove</button></div>'
        + feedback
        + '<button class="btn block mt12 ' + (allDone ? '' : 'ghost') + '" data-action="finish-entry" data-e="' + idx + '" ' + (en.sets.some((s) => s.done) ? '' : 'disabled') + '>Finish exercise</button></div>';

    return '<div class="card ex-card ' + (en.done ? 'done' : '') + '"><div class="ex-head">'
      + '<div class="row between"><div class="ex-name">' + esc(ex.name) + '</div><span class="row" style="gap:6px">' + prPill + '<span class="pill">' + esc(ex.muscle) + '</span></span></div>'
      + '<div class="ex-presc">' + p.sets + ' sets × ' + r.min + '–' + r.max + (p.weight > 0 ? ' @ <strong>' + fmtW(p.weight) + ' ' + state.settings.units + '</strong>' : '') + ' · goal <strong>' + en.targetReps + ' reps</strong></div>'
      + '<div class="ex-last">' + esc(lastText) + '</div>' + swapNote
      + (ex.notes ? '<div class="ex-note">' + esc(ex.notes) + '</div>' : '')
      + (en.done && en.prs && en.prs.length ? '<div class="ex-reason green">🏆 ' + esc(en.prs.map((x) => x.text).join(' · ')) + '</div>' : '')
      + reason + '</div>' + body + '</div>';
  }

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

    const templates = state.templates.map((t) => '<div class="list-item"><div class="grow"><div class="title">' + esc(t.name) + '</div><div class="sub">' + plural(t.days.length, 'day') + ' · saved ' + fmtDate(t.savedAt) + '</div></div>'
      + '<button class="btn small ghost" data-action="use-template" data-t="' + t.id + '">Use</button><button class="icon-btn danger" data-action="delete-template" data-t="' + t.id + '">✕</button></div>').join('');

    return '<div class="screen-title"><h1>Program</h1><button class="btn small" data-action="add-day">+ Day</button></div>'
      + days + '<div class="group-title">Weekly schedule</div><div class="card">' + schedule + '</div>'
      + '<div class="group-title">Templates</div><div class="card"><p class="small muted mb8">Save this split so you can switch to another one later without rebuilding it. Weights and set counts live on the exercises, so they carry over.</p>'
      + '<div class="list">' + templates + '</div><button class="btn ghost block mt12" data-action="save-template">Save current program as template</button></div>';
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
      const ups = w.entries.filter((e) => e.next && e.next.weight > (e.weightAtStart || 0) && e.weightAtStart > 0).length;
      const prs = w.entries.filter((e) => e.prs && e.prs.length).length;
      return '<button class="list-item" data-action="view-workout" data-w="' + w.id + '"><div class="grow"><div class="title">' + esc(w.dayName) + '</div><div class="sub">' + fmtDate(w.date) + ' · ' + plural(w.entries.filter((e) => e.done).length, 'exercise') + ' · ' + plural(sets, 'set') + (durationText(w) ? ' · ' + durationText(w) : '') + (ups ? ' · <span style="color:var(--green)">' + ups + ' weight ↑</span>' : '') + (prs ? ' · 🏆 ' + prs : '') + '</div></div><span class="chev">›</span></button>';
    }).join('');

    return '<div class="screen-title"><h1>History</h1></div>' + stats + renderVolumeCard() + renderReviewCard() + renderCalendar() + chartSel + renderBwCard()
      + '<div class="group-title">Workouts</div><div class="list">' + (items || '<div class="empty">No workouts yet. Finish one and it shows up here.</div>') + '</div>';
  }

  // ---- Weekly volume -------------------------------------------------------
  function setsPerMuscle(fromKey, toKey) {
    const out = {};
    state.workouts.forEach((w) => {
      if (w.date < fromKey || w.date > toKey) return;
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
      if (en.next && en.weightAtStart > 0 && en.next.weight > en.weightAtStart) ups.push(name + ' → ' + fmtW(en.next.weight) + ' ' + state.settings.units);
    }));
    const vol = setsPerMuscle(start, end);
    const topMuscles = Object.keys(vol).sort((a, b) => vol[b] - vol[a]).slice(0, 3).map((m) => m + ' ' + vol[m]);
    const bw = bwSorted().filter((b) => b.date >= start && b.date <= end);
    const bwPrev = bwSorted().filter((b) => b.date >= addDays(start, -7) && b.date < start);
    const avg = (arr) => (arr.length ? arr.reduce((n, b) => n + b.weight, 0) / arr.length : null);
    return { start, end, workouts: ws.length, sets, tonnage, prs, ups, topMuscles, bwAvg: avg(bw), bwPrevAvg: avg(bwPrev) };
  }
  function reviewText(r) {
    const u = state.settings.units;
    const lines = ['Overload week of ' + fmtDate(r.start) + ' to ' + fmtDate(r.end), plural(r.workouts, 'workout') + ' · ' + plural(r.sets, 'set') + ' · ' + Math.round(r.tonnage).toLocaleString() + ' ' + u + ' lifted'];
    if (r.topMuscles.length) lines.push('Most sets: ' + r.topMuscles.join(', '));
    if (r.ups.length) lines.push('Weight up: ' + r.ups.join(', '));
    if (r.prs.length) lines.push('PRs: ' + r.prs.join('; '));
    if (r.bwAvg != null) lines.push('Body weight avg ' + fmtW(r.bwAvg) + ' ' + u + (r.bwPrevAvg != null ? ' (' + (r.bwAvg - r.bwPrevAvg >= 0 ? '+' : '') + fmtW(r.bwAvg - r.bwPrevAvg) + ' vs last week)' : ''));
    return lines.join('\n');
  }
  function renderReviewCard() {
    const r = weekReview(ui.reviewOffset);
    const u = state.settings.units;
    const seg = '<div class="seg"><button class="' + (ui.reviewOffset === 0 ? 'on' : '') + '" data-action="review-set" data-v="0">This week</button><button class="' + (ui.reviewOffset === 1 ? 'on' : '') + '" data-action="review-set" data-v="1">Last week</button></div>';
    const bwLine = r.bwAvg != null ? '<li>Body weight avg <b>' + fmtW(r.bwAvg) + ' ' + u + '</b>' + (r.bwPrevAvg != null ? ' <span class="muted">(' + (r.bwAvg - r.bwPrevAvg >= 0 ? '+' : '') + fmtW(r.bwAvg - r.bwPrevAvg) + ' vs the week before)</span>' : '') + '</li>' : '';
    const body = r.workouts
      ? '<div class="stat-row mb8"><div class="stat"><div class="v">' + r.workouts + '</div><div class="k">Workouts</div></div><div class="stat"><div class="v">' + r.sets + '</div><div class="k">Sets</div></div><div class="stat"><div class="v">' + (r.tonnage >= 10000 ? (r.tonnage / 1000).toFixed(1) + 'k' : Math.round(r.tonnage)) + '</div><div class="k">' + u + ' lifted</div></div></div>'
        + '<ul class="review-list">' + (r.ups.length ? '<li><b>Weight went up</b> on ' + esc(r.ups.join(', ')) + '</li>' : '<li>No weight increases yet this week.</li>') + (r.prs.length ? '<li><b>🏆 PRs:</b> ' + esc(r.prs.join('; ')) + '</li>' : '') + (r.topMuscles.length ? '<li>Most sets: ' + esc(r.topMuscles.join(', ')) + '</li>' : '') + bwLine + '</ul>'
      : '<div class="empty small">No workouts logged for this week' + bwLine.replace(/<\/?li>/g, ' ').replace(/<[^>]+>/g, '') + '.</div>';
    return '<div class="card"><div class="row between mb8"><b>Weekly review</b>' + seg + '</div>' + body + '<button class="btn ghost block mt8" data-action="review-share" ' + (r.workouts ? '' : 'disabled') + '>Share</button></div>';
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
        pts.push({ date: w.date, weight: top.weight, reps: top.reps, e1rm: top.weight * (1 + top.reps / 30) });
      });
    });
    if (pts.length < 1) return '<div class="empty small">Nothing logged yet.</div>';
    const W = 320, H = 160, padL = 34, padR = 10, padT = 12, padB = 22;
    const ys = pts.map((p) => p.weight);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi === lo) { lo -= 5; hi += 5; }
    const x = (i) => padL + (pts.length === 1 ? (W - padL - padR) / 2 : (i / (pts.length - 1)) * (W - padL - padR));
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const path = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.weight).toFixed(1)).join(' ');
    const grid = [lo, (lo + hi) / 2, hi].map((v) => '<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="lbl" x="2" y="' + (y(v) + 3).toFixed(1) + '">' + fmtW(v) + '</text>').join('');
    const dots = pts.map((p, i) => '<circle class="pt" cx="' + x(i).toFixed(1) + '" cy="' + y(p.weight).toFixed(1) + '" r="3.5"><title>' + p.date + ': ' + fmtW(p.weight) + '×' + p.reps + '</title></circle>').join('');
    const first = pts[0], lastP = pts[pts.length - 1];
    const labels = '<text class="lbl" x="' + padL + '" y="' + (H - 6) + '">' + fmtDate(first.date) + '</text><text class="lbl" x="' + (W - padR) + '" y="' + (H - 6) + '" text-anchor="end">' + fmtDate(lastP.date) + '</text>';
    const best = pts.reduce((a, b) => (b.e1rm > a.e1rm ? b : a));
    const heaviest = pts.reduce((a, b) => (b.weight > a.weight || (b.weight === a.weight && b.reps > a.reps) ? b : a));
    const prCount = state.workouts.reduce((n, w) => n + w.entries.filter((e) => e.exId === exId && e.prs && e.prs.length).length, 0);
    const sessions = [];
    state.workouts.forEach((w) => { if (!w.finishedAt) return; w.entries.forEach((e) => { if (e.exId !== exId) return; const done = e.sets.filter((s) => s.done && s.reps > 0); if (done.length) sessions.push({ date: w.date, text: done.map((s) => fmtW(s.weight) + '×' + s.reps).join(', '), pr: !!(e.prs && e.prs.length) }); }); });
    const recent = '<div class="group-title" style="margin-top:14px">Recent sessions</div>' + sessions.slice(-8).reverse().map((s) => '<div class="hist-set"><span>' + fmtDate(s.date) + (s.pr ? ' 🏆' : '') + '</span><span><b>' + s.text + '</b></span></div>').join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' + grid + '<path class="line" d="' + path + '"/>' + dots + labels + '</svg>'
      + '<div class="stat-row mt8"><div class="stat"><div class="v">' + fmtW(lastP.weight) + '</div><div class="k">Current top set</div></div><div class="stat"><div class="v">' + fmtW(best.weight) + '×' + best.reps + '</div><div class="k">Best set</div></div><div class="stat"><div class="v">' + pts.length + '</div><div class="k">Sessions</div></div></div>'
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
      + '<div class="toggle-row"><div><div>Reps in reserve</div><div class="small muted">RIR column on each set. 3+ on every set moves weight up early</div></div><div class="seg"><button class="' + (s.trackRir ? 'on' : '') + '" data-action="set-rir" data-v="1">On</button><button class="' + (!s.trackRir ? 'on' : '') + '" data-action="set-rir" data-v="0">Off</button></div></div>'
      + '<div class="toggle-row"><div><div>Warm-up rest</div><div class="small muted">Seconds between warm-up sets</div></div><input class="input" style="width:90px;text-align:center" type="number" inputmode="numeric" min="0" value="' + s.warmupRest + '" data-field="setting" data-k="warmupRest"></div>'
      + '<div class="toggle-row"><div><div>Weekly sets target</div><div class="small muted">Per muscle, for the volume chart</div></div><div class="row"><input class="input" style="width:64px;text-align:center" type="number" inputmode="numeric" min="0" value="' + s.volumeMin + '" data-field="setting" data-k="volumeMin"><span class="muted">–</span><input class="input" style="width:64px;text-align:center" type="number" inputmode="numeric" min="0" value="' + s.volumeMax + '" data-field="setting" data-k="volumeMax"></div></div>'
      + '<div class="toggle-row"><div><div>Weigh-in reminder</div><div class="small muted">How often the Today screen asks for your body weight</div></div><select class="select" style="width:auto" data-field="setting" data-k="weighEvery">' + [[0, 'Off'], [1, 'Every day'], [2, 'Every 2 days'], [3, 'Every 3 days'], [7, 'Weekly'], [14, 'Every 2 weeks']].map(([v, l]) => '<option value="' + v + '" ' + (s.weighEvery === v ? 'selected' : '') + '>' + l + '</option>').join('') + '</select></div>'
      + '</div>'
      + '<div class="group-title">Backup</div><div class="card"><p class="small muted mb8">Export a copy now and then. With cloud sync off, this phone is the only place your data lives.</p>'
      + '<div class="btn-row"><button class="btn ghost" data-action="export">Export JSON</button><button class="btn ghost" data-action="import">Import JSON</button></div>'
      + '<input type="file" accept="application/json,.json" id="import-file" hidden></div>'
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
      const colour = st.status === 'error' ? 'var(--accent-2)' : st.status === 'synced' ? 'var(--green)' : 'var(--amber)';
      body = '<div class="toggle-row"><div><div>Signed in</div><div class="small muted">' + esc(sync.user.email) + '</div></div><span class="pill" style="color:' + colour + '">' + esc(st.msg || 'Connected') + '</span></div>'
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
    return '<div class="group-title">Cloud sync</div><div class="card">' + body + '</div>';
  }

  async function cloudAction(kind) {
    const sync = window.__overloadSync; if (!sync) return;
    const form = $('#cloud-form'); const msg = $('#cloud-msg');
    const email = form ? form.elements.email.value : ''; const password = form ? form.elements.password.value : '';
    const say = (t) => { if (msg) msg.textContent = t; else toast(t); };
    try {
      if (kind === 'signin') { if (!email || !password) return say('Enter your email and password.'); await sync.signIn(email, password); toast('Signed in'); }
      if (kind === 'signup') { if (!email || !password) return say('Enter an email and a password of at least 6 characters.'); await sync.createAccount(email, password); toast('Account created'); }
      if (kind === 'reset') { if (!email) return say('Enter your email first.'); await sync.resetPassword(email); say('Reset email sent. Check your inbox.'); }
      if (kind === 'signout') { if (confirm('Sign out? Your data stays on this phone and in the cloud.')) { await sync.signOut(); toast('Signed out'); } }
      if (kind === 'push') { await sync.pushNow(); toast('Sync requested'); }
    } catch (e) { say(e.message || 'Something went wrong.'); }
  }

  // ---------------------------------------------------------------------------
  // Sheets
  // ---------------------------------------------------------------------------
  function openSheet(html) { ui.sheet = true; $('#sheet-panel').innerHTML = html; $('#sheet').hidden = false; document.body.style.overflow = 'hidden'; }
  function closeSheet() { ui.sheet = null; $('#sheet').hidden = true; $('#sheet-panel').innerHTML = ''; document.body.style.overflow = ''; }
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
      + '<div class="field-row"><div class="field"><label>Rest (seconds)</label><input class="input" name="restSec" type="number" inputmode="numeric" min="0" placeholder="' + state.settings.restSec + '" value="' + (ex.restSec || '') + '"></div><div class="field"></div><div class="field"></div></div>'
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
      + '<div class="btn-row mt8"><button class="btn subtle" data-action="dup-day" data-day="' + dayId + '">Duplicate day</button><button class="btn subtle" data-action="delete-day" data-day="' + dayId + '">Delete day</button></div>');
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
    openSheet(sheetHeader(esc(w.dayName)) + '<p class="small muted mb8">' + fmtDate(w.date) + (durationText(w) ? ' · ' + durationText(w) : '') + (sore ? ' · ' + esc(sore) : '') + '</p>' + (body || '<div class="empty">Nothing logged</div>')
      + '<div class="btn-row mt8"><button class="btn ghost" data-action="edit-workout" data-w="' + w.id + '">Edit sets</button><button class="btn subtle" data-action="delete-workout" data-w="' + w.id + '">Delete workout</button></div>');
  }

  // Fix a typo in a finished workout. Changes the log only; next-time prescriptions stay as computed.
  function sheetEditWorkout(wId) {
    const w = state.workouts.find((x) => x.id === wId); if (!w) return;
    const u = state.settings.units;
    const body = w.entries.map((en, ei) => { const ex = exById(en.exId);
      const rows = en.sets.map((s, si) => !s.done ? '' : '<div class="row mt8"><span class="muted small" style="width:52px;flex-shrink:0;white-space:nowrap">Set ' + (si + 1) + '</span>'
        + '<input class="input" style="text-align:center" type="number" inputmode="decimal" step="any" min="0" name="w-' + ei + '-' + si + '" value="' + (s.weight || '') + '" placeholder="' + u + '">'
        + '<input class="input" style="text-align:center" type="number" inputmode="numeric" min="0" name="r-' + ei + '-' + si + '" value="' + (s.reps || '') + '" placeholder="reps"></div>').join('');
      return rows ? '<div class="card flat"><b>' + esc(ex ? ex.name : 'Deleted exercise') + '</b>' + rows + '</div>' : ''; }).join('');
    openSheet(sheetHeader('Edit sets') + '<form id="edit-workout-form" data-w="' + w.id + '"><p class="small muted mb8">' + esc(w.dayName) + ' · ' + fmtDate(w.date) + '. This fixes the log only; the next-time weights already set are not recalculated.</p>'
      + body + '<button class="btn block mt12" type="submit">Save changes</button></form>');
  }

  function sheetBodyweight() {
    const list = bwSorted().slice().reverse();
    openSheet(sheetHeader('Weigh-ins') + '<div class="list">' + (list.map((b) => '<div class="list-item"><div class="grow"><div class="title">' + fmtW(b.weight) + ' ' + state.settings.units + '</div><div class="sub">' + fmtDate(b.date) + '</div></div><button class="icon-btn danger" data-action="bw-delete" data-date="' + b.date + '">✕</button></div>').join('') || '<div class="empty">Nothing yet</div>') + '</div>');
  }

  // ---------------------------------------------------------------------------
  // Workout actions
  // ---------------------------------------------------------------------------
  function newEntry(exId) {
    const p = prescFor(exId);
    const sets = [];
    for (let i = 0; i < p.sets; i++) sets.push({ weight: p.weight || 0, reps: 0, done: false, rir: null });
    return { exId, plannedSets: p.sets, weightAtStart: p.weight, targetReps: p.targetReps, sets, pump: null, joint: null, workload: null, done: false, next: null, prevPresc: null, warmups: null, prs: [], swappedFrom: null, soreCut: false };
  }

  function startWorkout(dayId) {
    const day = dayById(dayId); if (!day) return;
    const w = { id: uid(), date: todayKey(), startedAt: Date.now(), finishedAt: null, dayId, dayName: day.name, soreness: {}, entries: day.exercises.filter(exById).map(newEntry) };
    state.workouts.push(w);
    state.active = w.id;
    save(); render();
    window.scrollTo(0, 0);
  }

  function finishEntry(w, idx) {
    const en = w.entries[idx];
    const ex = exById(en.exId);
    if (!ex) { toast('That exercise was deleted'); return; }
    const p = prescFor(en.exId);
    // "Still sore" costs one set per muscle per session, on the first exercise finished for it.
    let sore = w.soreness[ex.muscle];
    const alreadyCut = sore === 3 && w.entries.some((o, j) => j !== idx && o.done && o.soreCut && exById(o.exId) && exById(o.exId).muscle === ex.muscle);
    if (alreadyCut) sore = undefined;
    const next = computeNext(ex, p, en, sore);
    if (!next) { toast('Log at least one set first'); return; }
    if (alreadyCut) next.reasons.push('Still sore → the set cut already landed on an earlier ' + ex.muscle.toLowerCase() + ' exercise');
    en.soreCut = sore === 3;
    en.prevPresc = JSON.parse(JSON.stringify(p));
    en.next = next;
    en.done = true;
    en.prs = detectPrs(en.exId, en, w.id);
    if (en.prs.length) toast('🏆 PR! ' + en.prs[0].text);
    state.presc[en.exId] = { weight: next.weight, targetReps: next.targetReps, sets: next.sets, reasons: next.reasons, updatedAt: next.updatedAt };
  }

  function reopenEntry(w, idx) {
    const en = w.entries[idx];
    if (en.prevPresc) state.presc[en.exId] = en.prevPresc;
    en.prevPresc = null; en.next = null; en.done = false; en.prs = []; en.soreCut = false;
  }

  function swapEntry(w, idx, exId) {
    const old = w.entries[idx]; if (!old) return;
    if (old.done) reopenEntry(w, idx);
    const ne = newEntry(exId);
    ne.swappedFrom = old.swappedFrom || old.exId;
    w.entries[idx] = ne;
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

  function logBodyweight(v) {
    if (!(v > 0)) { toast('Enter a weight'); return; }
    const today = todayKey();
    const existing = state.bodyweight.find((b) => b.date === today);
    if (existing) existing.weight = v; else state.bodyweight.push({ date: today, weight: v });
    save(); render(); toast('Logged ' + fmtW(v) + ' ' + state.settings.units);
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
    // Auto-finish anything with logged sets that wasn't marked done.
    w.entries.forEach((en, i) => { if (!en.done && exById(en.exId) && en.sets.some((s) => s.done && s.reps > 0)) finishEntry(w, i); });
    const logged = w.entries.some((en) => en.done);
    if (!logged) {
      if (!confirm('Nothing logged. Discard this workout?')) return;
      state.workouts = state.workouts.filter((x) => x.id !== w.id);
    } else {
      w.entries = w.entries.filter((en) => en.done);
      w.finishedAt = Date.now();
    }
    state.active = null;
    stopTimer(); save(); ui.screen = 'today'; render();
    if (logged) toast('Workout saved');
    window.scrollTo(0, 0);
  }

  function discardWorkout() {
    const w = activeWorkout(); if (!w) return;
    if (!confirm('Discard this workout? Logged sets will be lost.')) return;
    w.entries.forEach((en, i) => { if (en.done) reopenEntry(w, i); });
    state.workouts = state.workouts.filter((x) => x.id !== w.id);
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
  function startTimer(sec) {
    if (!sec) return;
    unlockAudio();
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
    if (left <= 0) { stopTimer(); beep(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); toast('Rest over'); }
  }
  function stopTimer() { clearInterval(timer.handle); timer.handle = null; $('#rest-timer').hidden = true; }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------
  let toastHandle = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastHandle); toastHandle = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // ---------------------------------------------------------------------------
  // Import / export
  // ---------------------------------------------------------------------------
  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'overload-backup-' + todayKey() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function importJson(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(r.result);
        if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.exercises)) throw new Error('bad');
        if (!confirm('Replace everything on this phone with the backup?')) return;
        state = normalize(parsed);
        if (!activeWorkout()) state.active = null;
        applyTheme(); save(); render(); toast('Backup restored');
      } catch (e) { toast('That file is not an Overload backup'); }
    };
    r.readAsText(file);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) { ui.screen = tab.dataset.screen; render(); window.scrollTo(0, 0); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const a = btn.dataset.action, d = btn.dataset;
    const w = activeWorkout();

    switch (a) {
      // Today
      case 'select-day': ui.selectedDay = +d.i; ui.showOthers = false; render(); break;
      case 'toggle-others': ui.showOthers = !ui.showOthers; render(); break;
      case 'reload': location.reload(); break;
      case 'start-workout': startWorkout(d.day); break;
      case 'set-soreness': w.soreness[d.m] = +d.v; save(); render(); break;
      case 'toggle-set': {
        const en = w.entries[+d.e], s = en.sets[+d.s];
        if (!s.done) {
          if (!(s.reps > 0)) { toast('Enter reps first'); return; }
          s.done = true; startTimer(restFor(exById(en.exId)));
        } else { s.done = false; }
        save(); render(); break;
      }
      case 'add-set': { const en = w.entries[+d.e]; const last = en.sets[en.sets.length - 1]; en.sets.push({ weight: last ? last.weight : 0, reps: 0, done: false, rir: null }); save(); render(); break; }
      case 'cycle-rir': { const s = w.entries[+d.e].sets[+d.s]; s.rir = s.rir == null ? 0 : s.rir >= 4 ? null : s.rir + 1; save(); btn.textContent = s.rir == null ? '–' : s.rir; btn.classList.toggle('on', s.rir != null); break; }
      case 'gen-warmup': genWarmups(w.entries[+d.e]); save(); render(); break;
      case 'clear-warmup': w.entries[+d.e].warmups = null; save(); render(); break;
      case 'toggle-warmup': { const wu = w.entries[+d.e].warmups[+d.s]; wu.done = !wu.done; if (wu.done) startTimer(state.settings.warmupRest); save(); render(); break; }
      case 'swap-entry': sheetPicker({ swap: +d.e }); break;
      case 'remove-set': { const en = w.entries[+d.e]; if (en.sets.length > 1) en.sets.pop(); save(); render(); break; }
      case 'set-fb': { const en = w.entries[+d.e]; en[d.f] = en[d.f] === +d.v ? null : +d.v; save(); render(); break; }
      case 'finish-entry': finishEntry(w, +d.e); save(); render(); break;
      case 'reopen-entry': reopenEntry(w, +d.e); save(); render(); break;
      case 'remove-entry': if (confirm('Remove this exercise from today?')) { if (w.entries[+d.e].done) reopenEntry(w, +d.e); w.entries.splice(+d.e, 1); save(); render(); } break;
      case 'add-entry': sheetPicker({ workout: true }); break;
      case 'finish-workout': finishWorkout(); break;
      case 'discard-workout': discardWorkout(); break;
      case 'rest-skip': stopTimer(); break;
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
        if (ui.pickTarget.day) { dayById(ui.pickTarget.day).exercises.push(d.ex); save(); sheetDay(ui.pickTarget.day); render(); }
        else if (ui.pickTarget.swap != null) { swapEntry(w, ui.pickTarget.swap, d.ex); save(); closeSheet(); render(); }
        else { w.entries.push(newEntry(d.ex)); save(); closeSheet(); render(); }
        break;
      }
      case 'save-template': saveTemplate(); break;
      case 'use-template': useTemplate(d.t); break;
      case 'delete-template': if (confirm('Delete this template?')) { state.templates = state.templates.filter((x) => x.id !== d.t); save(); render(); } break;
      case 'cal-prev': ui.calOffset--; render(); break;
      case 'cal-next': if (ui.calOffset < 0) { ui.calOffset++; render(); } break;
      case 'review-set': ui.reviewOffset = +d.v; render(); break;
      case 'review-share': shareReview(); break;
      case 'bw-list': sheetBodyweight(); break;
      case 'bw-delete': state.bodyweight = state.bodyweight.filter((b) => b.date !== d.date); save(); sheetBodyweight(); render(); break;
      case 'set-rir': state.settings.trackRir = d.v === '1'; save(); render(); break;
      case 'pick-new-ex': sheetExercise(null); break;

      // Exercises
      case 'edit-ex': sheetExercise(d.ex); break;
      case 'new-ex': ui.pickTarget = null; sheetExercise(null); break;
      case 'delete-ex': {
        const used = state.workouts.some((x) => x.entries.some((en) => en.exId === d.ex));
        if (!confirm(used ? 'Delete this exercise? Its history stays but shows as "Deleted exercise".' : 'Delete this exercise?')) break;
        state.exercises = state.exercises.filter((x) => x.id !== d.ex);
        state.program.days.forEach((day) => { day.exercises = day.exercises.filter((x) => x !== d.ex); });
        if (w) w.entries = w.entries.filter((en) => en.exId !== d.ex);
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
        state.workouts = state.workouts.filter((x) => x.id !== d.w);
        save(); closeSheet(); render(); break;
      }

      // Settings
      case 'set-theme': state.settings.theme = d.v; applyTheme(); save(); render(); break;
      case 'export': exportJson(); break;
      case 'import': $('#import-file').click(); break;
      case 'reset': if (confirm('Erase all exercises, program and history on this phone?') && confirm('Really erase everything?')) { state = seedState(); save(); render(); toast('Reset to defaults'); } break;

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
    if (e.target.closest('#cloud-form')) { e.preventDefault(); cloudAction('signin'); return; }
    if (e.target.closest('#bw-form')) { e.preventDefault(); logBodyweight(num(e.target.elements.weight.value, 0)); return; }
    const ef = e.target.closest('#edit-workout-form');
    if (ef) {
      e.preventDefault();
      const wk = state.workouts.find((x) => x.id === ef.dataset.w); if (!wk) return;
      const fd = new FormData(ef);
      wk.entries.forEach((en, ei) => en.sets.forEach((s, si) => {
        if (!s.done) return;
        const wv = fd.get('w-' + ei + '-' + si), rv = fd.get('r-' + ei + '-' + si);
        if (wv != null) s.weight = Math.max(0, num(wv, s.weight));
        if (rv != null) s.reps = Math.max(0, Math.round(num(rv, s.reps)));
      }));
      save(); sheetWorkout(wk.id); render(); toast('Workout updated');
      return;
    }
    const form = e.target.closest('#ex-form'); if (!form) return;
    e.preventDefault();
    const f = new FormData(form);
    const name = String(f.get('name') || '').trim(); if (!name) return;
    let ex = form.dataset.ex ? exById(form.dataset.ex) : null;
    if (!ex) { ex = { id: uid(), custom: true }; state.exercises.push(ex); }
    ex.name = name; ex.muscle = f.get('muscle'); ex.equipment = f.get('equipment');
    ex.increment = num(f.get('increment'), 0) > 0 ? num(f.get('increment'), 0) : null;
    ex.notes = String(f.get('notes') || '').trim() || null;
    ex.restSec = num(f.get('restSec'), 0) > 0 ? Math.round(num(f.get('restSec'), 0)) : null;
    ex.repMin = num(f.get('repMin'), 0) > 0 ? Math.round(num(f.get('repMin'), 0)) : null;
    ex.repMax = num(f.get('repMax'), 0) > 0 ? Math.round(num(f.get('repMax'), 0)) : null;
    if (ex.repMin && ex.repMax && ex.repMax < ex.repMin) ex.repMax = ex.repMin;
    const p = prescFor(ex.id);
    p.weight = Math.max(0, num(f.get('weight'), 0));
    p.sets = clamp(Math.round(num(f.get('sets'), p.sets)), 1, 20);
    p.targetReps = clamp(Math.round(num(f.get('targetReps'), p.targetReps)), 1, 100);
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
    if (f === 'search') { ui.search = el.value; const app = $('#app'); const html = renderExercises(); const tmp = document.createElement('div'); tmp.innerHTML = html; app.replaceChildren(...tmp.childNodes); const inp = $('[data-field="search"]'); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    else if (f === 'pick-search') { ui.pickSearch = el.value; renderPicker(); const inp = $('[data-field="pick-search"]'); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  });

  document.addEventListener('change', (e) => {
    const el = e.target; const f = el.dataset.field; if (!f) return;
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
        } else s.reps = Math.round(v);
        save(); break;
      }
      case 'schedule': state.program.schedule[+el.dataset.i] = el.value || null; save(); render(); break;
      case 'day-name': { const day = dayById(el.dataset.day); day.name = el.value.trim() || day.name; el.value = day.name; save(); render(); break; }
      case 'setting': {
        const k = el.dataset.k; const s = state.settings; let v = num(el.value, s[k]);
        if (k === 'increment' || k === 'incDumbbell' || k === 'incMachine' || k === 'incCable') v = Math.max(0.5, v);
        if (k === 'repMin' || k === 'repMax' || k === 'defaultSets' || k === 'maxSets') v = Math.max(1, Math.round(v));
        if (k === 'restSec' || k === 'warmupRest' || k === 'weighEvery' || k === 'volumeMin' || k === 'volumeMax') v = Math.max(0, Math.round(v));
        s[k] = v;
        if (s.repMax < s.repMin) s.repMax = s.repMin;
        if (s.volumeMax < s.volumeMin) s.volumeMax = s.volumeMin;
        save(); render(); break;
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
  save();
  if (activeWorkout()) ui.screen = 'today';
  render();
  setInterval(() => { const el = $('#elapsed'); const w = activeWorkout(); if (el && w) el.textContent = durationText(w); }, 30000);

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
    setState, computeNext, save, render, toast,
    noteUpdateReady() { ui.updateReady = true; renderTopbar(); },
    setSyncStatus(status, msg) {
      ui.sync = { status, msg: msg || '' };
      const pill = $('.sync-pill');
      if (pill) { pill.className = 'pill sync-pill ' + status; pill.textContent = syncIcon(status); pill.title = ui.sync.msg; }
      else if (status !== 'off') render();
      if (ui.screen === 'settings') render();
    }
  };
})();
