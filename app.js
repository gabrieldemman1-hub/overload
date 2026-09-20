/* Overload — personal hypertrophy tracker.
 * Vanilla JS, no build step. All data lives in localStorage on this device.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const STORAGE_KEY = 'overload.state.v1';
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
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function fmtW(n) { return (Math.round(n * 100) / 100).toString(); }
  function fmtTime(sec) { const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let state = null;

  function defaultSettings() {
    return { units: 'lb', increment: 2.5, repMin: 10, repMax: 12, restSec: 120, maxSets: 6, defaultSets: 3, theme: 'system' };
  }

  function seedState() {
    const s = { v: 1, settings: defaultSettings(), exercises: [], presc: {}, program: { days: [], schedule: [null, null, null, null, null, null, null] }, workouts: [], active: null };
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
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1) {
          parsed.settings = Object.assign(defaultSettings(), parsed.settings || {});
          return parsed;
        }
      }
    } catch (e) { /* fall through */ }
    return seedState();
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
    state = next;
    state.settings = Object.assign(defaultSettings(), state.settings || {});
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
  function incFor(ex) { return (ex && ex.increment) || state.settings.increment; }
  function lastEntryFor(exId) {
    for (let i = state.workouts.length - 1; i >= 0; i--) {
      const w = state.workouts[i];
      if (!w.finishedAt) continue;
      const en = w.entries.find((e) => e.exId === exId && e.sets.some((s) => s.done));
      if (en) return { workout: w, entry: en };
    }
    return null;
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

    if (allTop && !jointHold) {
      next.weight = round(weight + inc, 0.01);
      next.targetReps = repMin;
      reasons.push('Hit ' + repMax + ' on every set → +' + fmtW(inc) + ' ' + unit + ', aim for ' + repMin);
    } else if (allTop && jointHold) {
      next.targetReps = repMax;
      reasons.push('Hit ' + repMax + ' on every set, but holding weight because of joint pain');
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
  const ui = { screen: 'today', selectedDay: weekdayIndex(), sheet: null, search: '', chartEx: null, sync: { status: 'off', msg: '' } };
  const timer = { end: 0, total: 0, handle: null };

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function render() {
    const app = $('#app');
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === ui.screen));
    const right = $('#topbar-right');
    right.innerHTML = ui.sync.status === 'off' ? '' : '<button class="pill sync-pill ' + ui.sync.status + '" data-action="goto-settings" title="' + esc(ui.sync.msg) + '">' + syncIcon(ui.sync.status) + '</button>';
    switch (ui.screen) {
      case 'today': app.innerHTML = renderToday(); break;
      case 'program': app.innerHTML = renderProgram(); break;
      case 'exercises': app.innerHTML = renderExercises(); break;
      case 'history': app.innerHTML = renderHistory(); break;
      case 'settings': app.innerHTML = renderSettings(); break;
    }
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
    let body;
    if (!day) {
      body = '<div class="card"><div class="empty">Rest day.<br><span class="small">Pick another day above, or change the schedule in Program.</span></div></div>';
    } else {
      const items = day.exercises.map((exId) => {
        const ex = exById(exId); if (!ex) return '';
        const p = prescFor(exId);
        return '<div class="list-item"><div class="grow"><div class="title">' + esc(ex.name) + '</div><div class="sub">' + prescText(ex, p) + '</div></div></div>';
      }).join('');
      body = '<div class="card flat"><div class="card-head"><div><h2>' + esc(day.name) + '</h2><div class="meta">' + WEEKDAYS_LONG[ui.selectedDay] + ' · ' + day.exercises.length + ' exercises</div></div></div>'
        + '<div class="list">' + (items || '<div class="empty">No exercises yet. Add some in Program.</div>') + '</div>'
        + '<button class="btn block mt12" data-action="start-workout" data-day="' + day.id + '" ' + (day.exercises.length ? '' : 'disabled') + '>Start workout</button></div>';
    }
    const last = state.workouts.filter((x) => x.finishedAt).slice(-1)[0];
    const lastLine = last ? '<p class="muted small center mt8">Last workout: ' + esc(last.dayName) + ' · ' + fmtDate(last.date) + '</p>' : '';
    return '<div class="screen-title"><h1>Today</h1><span class="sub">' + fmtDate(todayKey()) + '</span></div>' + stripHtml + body + lastLine;
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
    return '<div class="screen-title"><div><h1>' + esc(w.dayName) + '</h1><span class="sub">' + fmtDate(w.date) + ' · ' + doneCount + '/' + w.entries.length + ' done</span></div>'
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

    const rows = en.sets.map((s, i) => '<tr class="set-row ' + (s.done ? 'done' : '') + '">'
      + '<td class="n">' + (i + 1) + '</td>'
      + '<td><input class="set-input" type="number" inputmode="decimal" step="any" min="0" value="' + (s.weight || '') + '" placeholder="' + state.settings.units + '" data-field="weight" data-e="' + idx + '" data-s="' + i + '" ' + (en.done ? 'disabled' : '') + '></td>'
      + '<td><input class="set-input" type="number" inputmode="numeric" min="0" value="' + (s.reps || '') + '" placeholder="reps" data-field="reps" data-e="' + idx + '" data-s="' + i + '" ' + (en.done ? 'disabled' : '') + '></td>'
      + '<td class="chk"><button class="check ' + (s.done ? 'on' : '') + '" data-action="toggle-set" data-e="' + idx + '" data-s="' + i + '" ' + (en.done ? 'disabled' : '') + '>✓</button></td>'
      + '</tr>').join('');

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
      : '<div class="ex-body"><table class="set-table"><thead><tr><th class="n">Set</th><th>' + state.settings.units + (ex.equipment === 'Dumbbell' ? ' (each)' : '') + '</th><th>Reps</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
        + '<div class="set-tools"><button class="btn small ghost" data-action="add-set" data-e="' + idx + '">+ Set</button><button class="btn small subtle" data-action="remove-set" data-e="' + idx + '" ' + (en.sets.length <= 1 ? 'disabled' : '') + '>− Set</button><span class="grow"></span><button class="btn small subtle" data-action="remove-entry" data-e="' + idx + '">Remove</button></div>'
        + feedback
        + '<button class="btn block mt12 ' + (allDone ? '' : 'ghost') + '" data-action="finish-entry" data-e="' + idx + '" ' + (en.sets.some((s) => s.done) ? '' : 'disabled') + '>Done with ' + esc(ex.name) + '</button></div>';

    return '<div class="card ex-card ' + (en.done ? 'done' : '') + '"><div class="ex-head">'
      + '<div class="row between"><div class="ex-name">' + esc(ex.name) + '</div><span class="pill">' + esc(ex.muscle) + '</span></div>'
      + '<div class="ex-presc">' + p.sets + ' sets × ' + r.min + '–' + r.max + (p.weight > 0 ? ' @ <strong>' + fmtW(p.weight) + ' ' + state.settings.units + '</strong>' : '') + ' · goal <strong>' + en.targetReps + ' reps</strong></div>'
      + '<div class="ex-last">' + esc(lastText) + '</div>'
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

    return '<div class="screen-title"><h1>Program</h1><button class="btn small" data-action="add-day">+ Day</button></div>'
      + days + '<div class="group-title">Weekly schedule</div><div class="card">' + schedule + '</div>';
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
    const weekAgo = Date.now() - 7 * 864e5;
    const thisWeek = done.filter((w) => w.finishedAt >= weekAgo).length;
    const totalSets = done.reduce((n, w) => n + w.entries.reduce((m, e) => m + e.sets.filter((s) => s.done).length, 0), 0);
    const stats = '<div class="stat-row mb8"><div class="stat"><div class="v">' + thisWeek + '</div><div class="k">Last 7 days</div></div><div class="stat"><div class="v">' + done.length + '</div><div class="k">Workouts</div></div><div class="stat"><div class="v">' + totalSets + '</div><div class="k">Sets logged</div></div></div>';

    const tracked = state.exercises.filter((e) => lastEntryFor(e.id));
    const chartSel = tracked.length ? '<div class="card"><div class="field"><label>Progress</label><select class="select" data-field="chart-ex"><option value="">Pick an exercise…</option>'
      + tracked.map((e) => '<option value="' + e.id + '" ' + (ui.chartEx === e.id ? 'selected' : '') + '>' + esc(e.name) + '</option>').join('') + '</select></div>'
      + (ui.chartEx ? renderChart(ui.chartEx) : '') + '</div>' : '';

    const items = done.map((w) => {
      const sets = w.entries.reduce((m, e) => m + e.sets.filter((s) => s.done).length, 0);
      const ups = w.entries.filter((e) => e.next && e.next.weight > (e.weightAtStart || 0) && e.weightAtStart > 0).length;
      return '<button class="list-item" data-action="view-workout" data-w="' + w.id + '"><div class="grow"><div class="title">' + esc(w.dayName) + '</div><div class="sub">' + fmtDate(w.date) + ' · ' + plural(w.entries.filter((e) => e.done).length, 'exercise') + ' · ' + plural(sets, 'set') + (ups ? ' · <span style="color:var(--green)">' + ups + ' weight ↑</span>' : '') + '</div></div><span class="chev">›</span></button>';
    }).join('');

    return '<div class="screen-title"><h1>History</h1></div>' + stats + chartSel + '<div class="list">' + (items || '<div class="empty">No workouts yet. Finish one and it shows up here.</div>') + '</div>';
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
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' + grid + '<path class="line" d="' + path + '"/>' + dots + labels + '</svg>'
      + '<div class="stat-row mt8"><div class="stat"><div class="v">' + fmtW(lastP.weight) + '</div><div class="k">Current top set</div></div><div class="stat"><div class="v">' + fmtW(best.weight) + '×' + best.reps + '</div><div class="k">Best set</div></div><div class="stat"><div class="v">' + pts.length + '</div><div class="k">Sessions</div></div></div>';
  }

  // ---- Settings ------------------------------------------------------------
  function renderSettings() {
    const s = state.settings;
    return '<div class="screen-title"><h1>Settings</h1></div>'
      + '<div class="card">'
      + '<div class="toggle-row"><div><div>Appearance</div><div class="small muted">System follows your phone</div></div><div class="seg">' + ['system', 'dark', 'light'].map((t) => '<button class="' + ((s.theme || 'system') === t ? 'on' : '') + '" data-action="set-theme" data-v="' + t + '">' + t[0].toUpperCase() + t.slice(1) + '</button>').join('') + '</div></div>'
      + '<div class="toggle-row"><div><div>Units</div><div class="small muted">Labels only, no conversion</div></div><div class="seg"><button class="' + (s.units === 'lb' ? 'on' : '') + '" data-action="set-units" data-v="lb">lb</button><button class="' + (s.units === 'kg' ? 'on' : '') + '" data-action="set-units" data-v="kg">kg</button></div></div>'
      + '<div class="toggle-row"><div><div>Weight jump</div><div class="small muted">Default increase, per exercise override in Exercises</div></div><input class="input" style="width:90px;text-align:center" type="number" inputmode="decimal" step="any" min="0" value="' + s.increment + '" data-field="setting" data-k="increment"></div>'
      + '<div class="toggle-row"><div><div>Rep range</div><div class="small muted">Hit the top on every set → weight goes up</div></div><div class="row"><input class="input" style="width:64px;text-align:center" type="number" inputmode="numeric" min="1" value="' + s.repMin + '" data-field="setting" data-k="repMin"><span class="muted">–</span><input class="input" style="width:64px;text-align:center" type="number" inputmode="numeric" min="1" value="' + s.repMax + '" data-field="setting" data-k="repMax"></div></div>'
      + '<div class="toggle-row"><div><div>Rest timer</div><div class="small muted">Seconds, starts when you check a set</div></div><input class="input" style="width:90px;text-align:center" type="number" inputmode="numeric" min="0" value="' + s.restSec + '" data-field="setting" data-k="restSec"></div>'
      + '<div class="toggle-row"><div><div>Starting sets</div><div class="small muted">For new exercises</div></div><input class="input" style="width:90px;text-align:center" type="number" inputmode="numeric" min="1" value="' + s.defaultSets + '" data-field="setting" data-k="defaultSets"></div>'
      + '<div class="toggle-row"><div><div>Max sets</div><div class="small muted">Feedback never pushes past this</div></div><input class="input" style="width:90px;text-align:center" type="number" inputmode="numeric" min="1" value="' + s.maxSets + '" data-field="setting" data-k="maxSets"></div>'
      + '</div>'
      + '<div class="group-title">Backup</div><div class="card"><p class="small muted mb8">Export a copy now and then. With cloud sync off, this phone is the only place your data lives.</p>'
      + '<div class="btn-row"><button class="btn ghost" data-action="export">Export JSON</button><button class="btn ghost" data-action="import">Import JSON</button></div>'
      + '<input type="file" accept="application/json,.json" id="import-file" hidden></div>'
      + renderCloudCard()
      + '<div class="group-title">Danger zone</div><div class="card"><button class="btn danger block" data-action="reset">Reset all data</button></div>'
      + '<p class="tiny muted center mt16">Overload · v1.1</p>';
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
      + '<div class="group-title" style="margin-top:6px">Current prescription</div>'
      + '<div class="field-row"><div class="field"><label>Weight (' + state.settings.units + ')</label><input class="input" name="weight" type="number" inputmode="decimal" step="any" min="0" value="' + (p.weight || '') + '"></div><div class="field"><label>Sets</label><input class="input" name="sets" type="number" inputmode="numeric" min="1" value="' + p.sets + '"></div><div class="field"><label>Goal reps</label><input class="input" name="targetReps" type="number" inputmode="numeric" min="1" value="' + p.targetReps + '"></div></div>'
      + '<div class="group-title" style="margin-top:6px">Overrides <span class="muted" style="font-weight:500;text-transform:none;letter-spacing:0">(blank = use settings)</span></div>'
      + '<div class="field-row"><div class="field"><label>Weight jump</label><input class="input" name="increment" type="number" inputmode="decimal" step="any" min="0" placeholder="' + state.settings.increment + '" value="' + (ex.increment || '') + '"></div><div class="field"><label>Rep min</label><input class="input" name="repMin" type="number" inputmode="numeric" min="1" placeholder="' + state.settings.repMin + '" value="' + (ex.repMin || '') + '"></div><div class="field"><label>Rep max</label><input class="input" name="repMax" type="number" inputmode="numeric" min="1" placeholder="' + state.settings.repMax + '" value="' + (ex.repMax || '') + '"></div></div>'
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
      + '<button class="btn subtle block mt8" data-action="delete-day" data-day="' + dayId + '">Delete day</button>');
  }

  function sheetPicker(target) {
    // target: { day } adds to a program day; { workout: true } adds to the active workout
    ui.pickTarget = target; ui.pickSearch = '';
    renderPicker();
  }
  function renderPicker() {
    const q = (ui.pickSearch || '').toLowerCase();
    const exclude = ui.pickTarget.day ? dayById(ui.pickTarget.day).exercises : activeWorkout().entries.map((e) => e.exId);
    const list = state.exercises.filter((e) => !exclude.includes(e.id) && (!q || e.name.toLowerCase().includes(q) || e.muscle.toLowerCase().includes(q)));
    const groups = MUSCLES.map((m) => { const items = list.filter((e) => e.muscle === m); if (!items.length) return '';
      return '<div class="group-title">' + m + '</div><div class="list">' + items.map((ex) => '<button class="list-item" data-action="pick-ex-choose" data-ex="' + ex.id + '"><div class="grow"><div class="title">' + esc(ex.name) + '</div><div class="sub">' + esc(ex.equipment) + '</div></div><span class="chev">+</span></button>').join('') + '</div>'; }).join('');
    openSheet(sheetHeader('Add exercise', '<button class="btn small ghost" data-action="pick-new-ex">New</button>')
      + '<input class="input" type="search" placeholder="Search" value="' + esc(ui.pickSearch || '') + '" data-field="pick-search" autofocus>'
      + (groups || '<div class="empty">No matches</div>'));
  }

  function sheetWorkout(wId) {
    const w = state.workouts.find((x) => x.id === wId); if (!w) return;
    const body = w.entries.map((en) => { const ex = exById(en.exId); const done = en.sets.filter((s) => s.done);
      if (!done.length) return '';
      const fb = [en.pump != null ? 'Pump: ' + PUMP[en.pump] : '', en.joint != null ? 'Joints: ' + JOINT[en.joint] : '', en.workload != null ? 'Workload: ' + WORKLOAD[en.workload] : ''].filter(Boolean).join(' · ');
      return '<div class="card flat"><div class="row between"><b>' + esc(ex ? ex.name : 'Deleted exercise') + '</b>' + (ex ? '<span class="pill">' + esc(ex.muscle) + '</span>' : '') + '</div>'
        + done.map((s, i) => '<div class="hist-set"><span>Set ' + (i + 1) + '</span><span><b>' + fmtW(s.weight) + '</b> ' + state.settings.units + ' × <b>' + s.reps + '</b></span></div>').join('')
        + (fb ? '<div class="tiny muted mt8">' + fb + '</div>' : '')
        + (en.next && en.next.reasons.length ? '<div class="tiny mt8" style="color:var(--amber)">' + esc(en.next.reasons[0]) + '</div>' : '') + '</div>'; }).join('');
    const sore = Object.keys(w.soreness || {}).map((m) => m + ': ' + SORENESS[w.soreness[m]]).join(' · ');
    openSheet(sheetHeader(esc(w.dayName)) + '<p class="small muted mb8">' + fmtDate(w.date) + (sore ? ' · ' + esc(sore) : '') + '</p>' + (body || '<div class="empty">Nothing logged</div>')
      + '<button class="btn subtle block mt8" data-action="delete-workout" data-w="' + w.id + '">Delete workout</button>');
  }

  // ---------------------------------------------------------------------------
  // Workout actions
  // ---------------------------------------------------------------------------
  function newEntry(exId) {
    const p = prescFor(exId);
    const sets = [];
    for (let i = 0; i < p.sets; i++) sets.push({ weight: p.weight || 0, reps: 0, done: false });
    return { exId, plannedSets: p.sets, weightAtStart: p.weight, targetReps: p.targetReps, sets, pump: null, joint: null, workload: null, done: false, next: null, prevPresc: null };
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
    const p = prescFor(en.exId);
    const next = computeNext(ex, p, en, w.soreness[ex.muscle]);
    if (!next) { toast('Log at least one set first'); return; }
    en.prevPresc = JSON.parse(JSON.stringify(p));
    en.next = next;
    en.done = true;
    state.presc[en.exId] = { weight: next.weight, targetReps: next.targetReps, sets: next.sets, reasons: next.reasons, updatedAt: next.updatedAt };
    stopTimer();
  }

  function reopenEntry(w, idx) {
    const en = w.entries[idx];
    if (en.prevPresc) state.presc[en.exId] = en.prevPresc;
    en.prevPresc = null; en.next = null; en.done = false;
  }

  function finishWorkout() {
    const w = activeWorkout(); if (!w) return;
    // Auto-finish anything with logged sets that wasn't marked done.
    w.entries.forEach((en, i) => { if (!en.done && en.sets.some((s) => s.done && s.reps > 0)) finishEntry(w, i); });
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
  function startTimer(sec) {
    if (!sec) return;
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
    if (left <= 0) { stopTimer(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); toast('Rest over'); }
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
        state = parsed; state.settings = Object.assign(defaultSettings(), state.settings || {});
        save(); render(); toast('Backup restored');
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
      case 'select-day': ui.selectedDay = +d.i; render(); break;
      case 'start-workout': startWorkout(d.day); break;
      case 'set-soreness': w.soreness[d.m] = +d.v; save(); render(); break;
      case 'toggle-set': {
        const en = w.entries[+d.e], s = en.sets[+d.s];
        if (!s.done) {
          if (!(s.reps > 0)) { toast('Enter reps first'); return; }
          s.done = true; startTimer(state.settings.restSec);
        } else { s.done = false; }
        save(); render(); break;
      }
      case 'add-set': { const en = w.entries[+d.e]; const last = en.sets[en.sets.length - 1]; en.sets.push({ weight: last ? last.weight : 0, reps: 0, done: false }); save(); render(); break; }
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
      case 'delete-day': if (confirm('Delete this day?')) { state.program.days = state.program.days.filter((x) => x.id !== d.day); state.program.schedule = state.program.schedule.map((x) => (x === d.day ? null : x)); save(); closeSheet(); render(); } break;
      case 'day-move': { const day = dayById(d.day); const i = +d.i, j = i + (+d.d); if (j < 0 || j >= day.exercises.length) break; [day.exercises[i], day.exercises[j]] = [day.exercises[j], day.exercises[i]]; save(); sheetDay(d.day); render(); break; }
      case 'day-remove-ex': { const day = dayById(d.day); day.exercises.splice(+d.i, 1); save(); sheetDay(d.day); render(); break; }
      case 'pick-ex': sheetPicker({ day: d.day }); break;
      case 'pick-ex-choose': {
        if (ui.pickTarget.day) { dayById(ui.pickTarget.day).exercises.push(d.ex); save(); sheetDay(ui.pickTarget.day); render(); }
        else { w.entries.push(newEntry(d.ex)); save(); closeSheet(); render(); }
        break;
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
        delete state.presc[d.ex];
        save(); closeSheet(); render(); break;
      }

      // History
      case 'view-workout': sheetWorkout(d.w); break;
      case 'delete-workout': if (confirm('Delete this workout from history? Prescriptions are not rolled back.')) { state.workouts = state.workouts.filter((x) => x.id !== d.w); save(); closeSheet(); render(); } break;

      // Settings
      case 'set-units': state.settings.units = d.v; save(); render(); break;
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
    const form = e.target.closest('#ex-form'); if (!form) return;
    e.preventDefault();
    const f = new FormData(form);
    const name = String(f.get('name') || '').trim(); if (!name) return;
    let ex = form.dataset.ex ? exById(form.dataset.ex) : null;
    if (!ex) { ex = { id: uid(), custom: true }; state.exercises.push(ex); }
    ex.name = name; ex.muscle = f.get('muscle'); ex.equipment = f.get('equipment');
    ex.increment = num(f.get('increment'), 0) > 0 ? num(f.get('increment'), 0) : null;
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
        if (k === 'increment') v = Math.max(0.5, v);
        if (k === 'repMin' || k === 'repMax' || k === 'defaultSets' || k === 'maxSets') v = Math.max(1, Math.round(v));
        if (k === 'restSec') v = Math.max(0, Math.round(v));
        s[k] = v;
        if (s.repMax < s.repMin) s.repMax = s.repMin;
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

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // API for sync.js (and console debugging).
  window.__overload = {
    get state() { return state; },
    setState, computeNext, save, render, toast,
    setSyncStatus(status, msg) {
      ui.sync = { status, msg: msg || '' };
      const pill = $('.sync-pill');
      if (pill) { pill.className = 'pill sync-pill ' + status; pill.textContent = syncIcon(status); pill.title = ui.sync.msg; }
      else if (status !== 'off') render();
      if (ui.screen === 'settings') render();
    }
  };
})();
