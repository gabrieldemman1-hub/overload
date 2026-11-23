/* In-page half of make-v28.js. Injected with context.addInitScript before the app's own scripts.
 *
 * It does two things:
 *   1. Replaces the page's clock (Date) with one the simulation moves, and makes Math.random repeatable
 *      (the app's ids come from it), so a simulated day happens "on" that day and a re-run gives the same data.
 *   2. Offers window.SIM: a simulated person who uses the real app through its own event handlers
 *      (clicks, typing, form submits on the real DOM). Nothing here writes to the app's state directly,
 *      except the three lines marked DIRECT below.
 *
 * window.__SIM_CFG is set by an init script that make-v28.js adds just before this file.
 */
(function () {
  'use strict';
  if (window.top !== window) return;
  const CFG = window.__SIM_CFG;
  if (!CFG) return;

  // ---------------------------------------------------------------------------
  // Clock and random numbers
  // ---------------------------------------------------------------------------
  const RealDate = Date;
  let now = CFG.start;
  try { const s = Number(sessionStorage.getItem('__sim.now')); if (s) now = s; } catch (e) { /* no storage here */ }
  class SimDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  }
  window.Date = SimDate;
  const persist = () => { try { sessionStorage.setItem('__sim.now', String(now)); } catch (e) { /* ignore */ } };
  const clock = {
    now: () => now,
    set(ms) { if (ms < now) throw new Error('clock would go back: ' + new RealDate(now).toISOString() + ' -> ' + new RealDate(ms).toISOString()); now = ms; persist(); },
    add(ms) { now += Math.round(ms); persist(); },
    // at least this time of day (minutes after local midnight) on the simulated day; never moves back
    atLeast(dayStart, minutes) { const t = Math.round(dayStart + minutes * 60000); if (t > now) { now = t; persist(); } }
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // A stream of numbers for one purpose on one day: the same on every run, whatever happened before.
  const rngFor = (...keys) => mulberry32(hashStr(CFG.seed + '|' + keys.join('|')));
  const idRng = mulberry32(hashStr(CFG.seed + '|ids|' + now));
  Math.random = () => idRng();

  const pick = (r, list) => list[Math.floor(r() * list.length)];
  const between = (r, lo, hi) => lo + r() * (hi - lo);
  const chance = (r, p) => r() < p;
  function weighted(r, pairs) { const tot = pairs.reduce((n, p) => n + p[1], 0); let x = r() * tot; for (const p of pairs) { x -= p[1]; if (x < 0) return p[0]; } return pairs[pairs.length - 1][0]; }

  // ---------------------------------------------------------------------------
  // The page
  // ---------------------------------------------------------------------------
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const cssq = (s) => CSS.escape(String(s));
  function fail(msg) { throw new Error('SIM day ' + (cur ? cur.i + ' (' + cur.key + ')' : '?') + ': ' + msg); }
  function need(cond, msg) { if (!cond) fail(msg); }
  function el(x) { const e = typeof x === 'string' ? q(x) : x; if (!e) fail('not on screen: ' + x); return e; }
  let clickRng = mulberry32(1);
  // A tap: a second or more after the last one (the app ignores taps that come too fast after an Add).
  function click(x, dt) {
    const e = el(x);
    if (e.disabled) fail('disabled: ' + (typeof x === 'string' ? x : e.outerHTML.slice(0, 120)));
    clock.add(dt != null ? dt : 1600 + clickRng() * 2400);
    e.click();
  }
  // Typing into a box: the value, then the event the app listens for ('change' when the box is left, 'input' while typing).
  function type(x, value, evt) {
    const e = el(x);
    clock.add(1200 + clickRng() * 1800);
    e.value = String(value);
    e.dispatchEvent(new Event(evt || 'change', { bubbles: true }));
  }
  const fill = (form, name, value) => { const f = form.elements[name]; if (!f) fail('form has no field ' + name); f.value = value == null ? '' : String(value); };
  const realWait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, what, timeout) { const t0 = performance.now(); for (;;) { const v = fn(); if (v) return v; if (performance.now() - t0 > (timeout || 8000)) fail('timed out waiting for ' + what); await realWait(15); } }

  // confirm() and prompt(): answered by rule (first match wins), default OK / the suggested text.
  const dialogs = [];
  let rules = [];
  window.confirm = (msg) => { const r = rules.find((x) => x.re.test(msg)); const a = r ? r.answer : true; dialogs.push({ kind: 'confirm', msg: String(msg), answer: a, day: cur && cur.i }); return a; };
  window.prompt = (msg, def) => { const r = rules.find((x) => x.re.test(msg)); const a = r ? r.answer : def; dialogs.push({ kind: 'prompt', msg: String(msg), answer: a, day: cur && cur.i }); return a; };
  window.alert = (msg) => { dialogs.push({ kind: 'alert', msg: String(msg) }); };
  function withRules(list, fn) { const old = rules; rules = list.concat(old); try { return fn(); } finally { rules = old; } }

  const O = () => window.__overload;
  const S = () => O().state;
  const F = () => window.__overloadFood;
  const exByName = (name) => S().exercises.find((e) => e.name === name) || fail('no exercise called ' + name);
  const dayByName = (name) => S().program.days.find((d) => d.name === name) || fail('no program day called ' + name);
  const activeW = () => S().workouts.find((w) => w.id === S().active) || null;
  const todayKey = () => O().lib.todayKey();
  const addDays = (k, n) => O().lib.addDays(k, n);
  const goTab = (name) => { click('.tab[data-screen="' + name + '"]'); need(O().screen === name, 'tab ' + name + ' did not open'); };
  const closeSheet = () => { if (!q('#sheet').hidden) click('#sheet .sheet-title [data-action="sheet-close"]'); };
  const toastText = () => { const t = q('#toast'); return t && !t.hidden ? t.textContent : ''; };

  let cur = null;   // the simulated day: CFG.days[i]
  const log = [];   // notable things that happened, for the generator's report
  const note = (what, extra) => log.push(Object.assign({ day: cur ? cur.i : null, date: cur ? cur.key : null, what }, extra || {}));

  // ---------------------------------------------------------------------------
  // First day: settings, program, exercises
  // ---------------------------------------------------------------------------
  const PROGRAM = [
    { name: 'Push', ex: ['Flat Barbell Bench Press', 'Smith Machine Incline Press', 'Seated Dumbbell Shoulder Press', 'Cable Fly', 'Dumbbell Lateral Raise', 'Triceps Pushdown'] },
    { name: 'Pull', ex: ['Lat Pulldown', 'Chest-Supported Row', 'Seated Cable Row', 'Face Pull', 'EZ-Bar Curl', 'Hammer Curl'] },
    { name: 'Legs', ex: ['Back Squat', 'Romanian Deadlift', 'Leg Press', 'Lying Leg Curl', 'Leg Extension', 'Standing Calf Raise'] },
    { name: 'Upper', ex: ['Incline Dumbbell Press', 'Pull-Ups', 'Machine Shoulder Press', 'One-Arm Dumbbell Row', 'Assisted Dips', 'Incline Dumbbell Curl'] },
    { name: 'Lower', ex: ['Hack Squat', 'Hip Thrust', 'Seated Leg Curl', 'Leg Extension', 'Seated Calf Raise', 'Cable Crunch'] },
    { name: 'Arms & Abs', ex: ['Barbell Curl', 'Skull Crushers', 'Cable Rope Hammer Curl', 'Overhead Triceps Extension', 'Hanging Leg Raise'] }
  ];
  const CUSTOM_EX = { name: 'Smith Machine Incline Press', muscle: 'Chest', equipment: 'Machine', notes: 'Bench at 30°, bar to upper chest', restSec: 180 };
  // Edit exercise → Overrides and notes, typed on the first day.
  const OVERRIDES = [
    { name: 'Dumbbell Lateral Raise', increment: 2.5, repMin: 12, repMax: 15, restSec: 75, notes: 'Lean on the rack, pinkies up' },
    { name: 'Leg Press', increment: 10, repMin: 10, repMax: 15, restSec: 180, notes: 'Seat 4, feet high and wide', weight: 360 },
    { name: 'Standing Calf Raise', repMin: 10, repMax: 15, restSec: 90 },
    { name: 'Triceps Pushdown', increment: 2.5, notes: 'Rope, add-on plate for 2.5s' },
    { name: 'Flat Barbell Bench Press', restSec: 180, weight: 185 },
    { name: 'Back Squat', restSec: 210, notes: 'Low bar, belt on the top sets', weight: 225 },
    { name: 'Lat Pulldown', notes: 'Wide bar, thumbs over' }
  ];
  // The simulated lifter. w0: weight on the first day, r0: reps he can do with it fresh, gain: how much stronger
  // he gets (fraction, most of it early), fat: reps lost per set. bw: bodyweight move (reps only).
  const LIFTS = {
    'Flat Barbell Bench Press': { w0: 185, r0: 9.6, gain: 0.30 }, 'Smith Machine Incline Press': { w0: 135, r0: 10.4, gain: 0.32 },
    'Seated Dumbbell Shoulder Press': { w0: 50, r0: 9.3, gain: 0.34 }, 'Cable Fly': { w0: 30, r0: 12.5, gain: 0.5 },
    'Dumbbell Lateral Raise': { w0: 20, r0: 13.2, gain: 0.45 }, 'Triceps Pushdown': { w0: 50, r0: 11.4, gain: 0.4 },
    'Lat Pulldown': { w0: 140, r0: 10.2, gain: 0.3 }, 'Chest-Supported Row': { w0: 110, r0: 10.6, gain: 0.32 },
    'Seated Cable Row': { w0: 130, r0: 9.7, gain: 0.3 }, 'T-Bar Row': { w0: 90, r0: 10.3, gain: 0.34 }, 'Face Pull': { w0: 40, r0: 13.4, gain: 0.45 },
    'EZ-Bar Curl': { w0: 70, r0: 9.2, gain: 0.3 }, 'Hammer Curl': { w0: 30, r0: 10.5, gain: 0.4 },
    'Back Squat': { w0: 225, r0: 8.8, gain: 0.3 }, 'Romanian Deadlift': { w0: 205, r0: 9.4, gain: 0.32 }, 'Leg Press': { w0: 360, r0: 12.3, gain: 0.3 },
    'Lying Leg Curl': { w0: 90, r0: 10.3, gain: 0.34 }, 'Leg Extension': { w0: 130, r0: 11.2, gain: 0.3 }, 'Standing Calf Raise': { w0: 180, r0: 12.4, gain: 0.3 },
    'Incline Dumbbell Press': { w0: 65, r0: 9.4, gain: 0.32 }, 'Pull-Ups': { bw: true, r0: 8.4, gainReps: 5 }, 'Machine Shoulder Press': { w0: 100, r0: 10.4, gain: 0.32 },
    'One-Arm Dumbbell Row': { w0: 75, r0: 10.7, gain: 0.34 }, 'Assisted Dips': { w0: 50, r0: 9.2, gain: 0.26, assisted: 190 }, 'Incline Dumbbell Curl': { w0: 25, r0: 10.3, gain: 0.4 },
    'Hack Squat': { w0: 180, r0: 9.6, gain: 0.34 }, 'Hip Thrust': { w0: 225, r0: 10.4, gain: 0.36 }, 'Seated Leg Curl': { w0: 100, r0: 10.5, gain: 0.32 },
    'Seated Calf Raise': { w0: 90, r0: 12.2, gain: 0.34 }, 'Cable Crunch': { w0: 80, r0: 12.6, gain: 0.4 },
    'Barbell Curl': { w0: 65, r0: 9.5, gain: 0.3 }, 'Skull Crushers': { w0: 60, r0: 10.2, gain: 0.3 }, 'Cable Rope Hammer Curl': { w0: 45, r0: 11.3, gain: 0.4 },
    'Overhead Triceps Extension': { w0: 45, r0: 11.1, gain: 0.4 }, 'Hanging Leg Raise': { bw: true, r0: 10.6, gainReps: 4 },
    'Wide-Grip Lat Pulldown': { w0: 130, r0: 10.1, gain: 0.3 }, 'Machine Preacher Curl (old gym)': { w0: 60, r0: 10.4, gain: 0.3 },
    // the default program (the light user)
    'Incline Dumbbell Press#small': { w0: 45, r0: 10.2, gain: 0.3 }, 'Cable Fly#small': { w0: 25, r0: 12, gain: 0.3 }, 'Chest-Supported Row#small': { w0: 90, r0: 10.5, gain: 0.3 },
    'Romanian Deadlift#small': { w0: 135, r0: 10.3, gain: 0.3 }, 'Barbell Curl#small': { w0: 50, r0: 10.4, gain: 0.3 }, 'Rear Delt Fly': { w0: 70, r0: 12.2, gain: 0.3 },
    'Flat Barbell Bench Press#small': { w0: 135, r0: 10.1, gain: 0.3 }, 'Lat Pulldown#small': { w0: 110, r0: 10.6, gain: 0.3 }, 'Seated Cable Row#small': { w0: 100, r0: 10.4, gain: 0.3 },
    'Back Squat#small': { w0: 155, r0: 10.2, gain: 0.3 }, 'Leg Press#small': { w0: 230, r0: 11.2, gain: 0.3 }, 'Lying Leg Curl#small': { w0: 70, r0: 10.6, gain: 0.3 },
    'Leg Extension#small': { w0: 90, r0: 11.3, gain: 0.3 }, 'Standing Calf Raise#small': { w0: 120, r0: 11.4, gain: 0.3 }, 'Seated Dumbbell Shoulder Press#small': { w0: 35, r0: 10.3, gain: 0.3 },
    'Dumbbell Lateral Raise#small': { w0: 15, r0: 12.2, gain: 0.3 }, 'Triceps Pushdown#small': { w0: 40, r0: 11.2, gain: 0.3 }, 'Incline Dumbbell Curl#small': { w0: 20, r0: 10.4, gain: 0.3 },
    'Overhead Triceps Extension#small': { w0: 35, r0: 11.3, gain: 0.3 }
  };
  const liftFor = (name) => (CFG.mode === 'small' && LIFTS[name + '#small']) || LIFTS[name] || fail('no lifter numbers for ' + name);

  function setting(k, v) { type('[data-field="setting"][data-k="' + k + '"]', v); need(S().settings[k] === v, 'setting ' + k + ' is ' + S().settings[k]); }

  function setupFirstDay() {
    // Settings: not the defaults.
    goTab('settings');
    click('[data-action="set-theme"][data-v="dark"]');
    setting('increment', 5); setting('repMin', 8); setting('restSec', 150); setting('cardioMin', 25);
    type('[data-field="cardio-name"]', 'Incline walk');
    need(S().settings.theme === 'dark' && S().settings.cardioName === 'Incline walk', 'settings did not take');

    // Program: keep the app's default split as a template, then build a 5-day split with one extra day.
    goTab('program');
    withRules([{ re: /Name this template/, answer: 'Starter split (default)' }], () => click('[data-action="save-template"]'));
    need(S().templates.length === 1, 'template not saved');
    S().program.days.slice().forEach((d) => { click('[data-action="edit-day"][data-day="' + d.id + '"]'); click('[data-action="delete-day"]'); });
    need(S().program.days.length === 0, 'default days not deleted');
    PROGRAM.forEach((pd) => {
      click('[data-action="add-day"]');
      const day = S().program.days[S().program.days.length - 1];
      type('[data-field="day-name"]', pd.name);
      pd.ex.forEach((name) => {
        click('[data-action="pick-ex"]');
        if (name === CUSTOM_EX.name) {
          // not in the list: New, from the picker (the new exercise goes straight into the day)
          click('[data-action="pick-new-ex"]');
          const f = el('#ex-form');
          fill(f, 'name', CUSTOM_EX.name); fill(f, 'muscle', CUSTOM_EX.muscle); fill(f, 'equipment', CUSTOM_EX.equipment);
          fill(f, 'notes', CUSTOM_EX.notes); fill(f, 'restSec', CUSTOM_EX.restSec);
          click('#ex-form button[type="submit"]');
        } else {
          type('[data-field="pick-search"]', name.split(' ').slice(0, 2).join(' '), 'input');
          click('[data-action="pick-ex-choose"][data-ex="' + exByName(name).id + '"]');
        }
      });
      need(day.exercises.length === pd.ex.length && day.name === pd.name, 'day ' + pd.name + ' not built');
      closeSheet();
    });
    // One exercise moved up and back down in the day sheet (the arrows).
    const arms = dayByName('Arms & Abs');
    click('[data-action="edit-day"][data-day="' + arms.id + '"]');
    click('[data-action="day-move"][data-i="4"][data-d="-1"]'); click('[data-action="day-move"][data-i="3"][data-d="1"]');
    closeSheet();
    // Weekly schedule: five days on, in an order that makes the day the fixture is built a training day.
    CFG.schedule.forEach((name, wd) => {
      const sel = el('[data-field="schedule"][data-i="' + wd + '"]');
      const want = name ? dayByName(name).id : '';
      if (sel.value !== want) type(sel, want);
    });
    need(S().program.schedule.filter(Boolean).length === 5, 'schedule not set');

    // Exercises: overrides, notes and a few starting weights.
    goTab('exercises');
    OVERRIDES.forEach((o) => {
      const ex = exByName(o.name);
      click('#app [data-action="edit-ex"][data-ex="' + ex.id + '"]');
      const f = el('#ex-form');
      ['increment', 'repMin', 'repMax', 'restSec', 'notes', 'weight'].forEach((k) => { if (o[k] != null) fill(f, k, o[k]); });
      click('#ex-form button[type="submit"]');
      need(q('#sheet').hidden, 'exercise form did not close for ' + o.name + ': ' + toastText());
    });
    note('setup', { days: S().program.days.map((d) => d.name), schedule: CFG.schedule });
  }

  // ---------------------------------------------------------------------------
  // Morning check-in
  // ---------------------------------------------------------------------------
  const hm = (min) => [Math.floor(min / 60), Math.round(min % 60)];
  function checkin(d) {
    goTab('today');
    if (activeW()) return;
    const typeSleep = d.sleep && d.sleep.typed && !S().sleep.some((x) => x.date === d.key && x.src === 'whoop');
    if (d.bw == null && !typeSleep) return;
    const f = q('#bw-form'); if (!f) { note('check-in already done'); return; }
    if (d.bw != null && f.elements.weight) fill(f, 'weight', d.bwTypo != null ? d.bwTypo : d.bw);
    if (typeSleep && f.elements.totalH) {
      const s = d.sleep, t = hm(s.total); fill(f, 'totalH', t[0]); fill(f, 'totalM', t[1]);
      if (s.typed === 'full') { const r = hm(s.rem), p = hm(s.deep); fill(f, 'remH', r[0]); fill(f, 'remM', r[1]); fill(f, 'deepH', p[0]); fill(f, 'deepM', p[1]); }
    }
    click('#bw-form button[type="submit"]');
    need(/^Logged/.test(toastText()), 'check-in not saved: ' + toastText());
  }
  // A WHOOP night corrected by hand: Edit, change the minutes, Save (it stops being WHOOP's).
  function editNight(d) {
    goTab('today');
    click('[data-action="checkin-edit"]');
    const f = el('#bw-form');
    need(f.elements.totalM, 'no sleep boxes in the check-in');
    fill(f, 'totalM', (Number(f.elements.totalM.value) + 20) % 60);
    click('#bw-form button[type="submit"]');
    note('night edited by hand', { night: S().sleep.find((x) => x.date === d.key) });
  }

  // ---------------------------------------------------------------------------
  // Workouts
  // ---------------------------------------------------------------------------
  const sessionsOf = (exId) => S().workouts.filter((w) => w.finishedAt && !w.deload && w.entries.some((en) => en.exId === exId && en.sets.some((s) => s.done && s.reps > 0))).length;
  // Reps he has in him on a fresh first set at this weight today (Epley, from a strength that grows session by session).
  function freshReps(ex, weight, r, form) {
    const L = liftFor(ex.name), n = sessionsOf(ex.id), noise = between(r, -0.4, 0.4);
    if (L.bw) return L.r0 + L.gainReps * n / (n + 8) + form + noise;
    const load0 = L.assisted ? L.assisted - L.w0 : L.w0, load = L.assisted ? L.assisted - weight : weight;
    const strength = load0 * (1 + L.r0 / 30) * (1 + L.gain * n / (n + 10));
    return 30 * (strength / Math.max(load, 1) - 1) + form + noise;
  }
  const setSel = (kind, e, s) => '[data-' + (kind === 'tick' ? 'action="toggle-set"' : kind === 'rir' ? 'action="pick-rir"' : 'field="' + kind + '"') + '][data-e="' + e + '"][data-s="' + s + '"]';

  function startWorkout(dayName, deload) {
    goTab('today');
    need(!activeW(), 'a workout is already in progress');
    const day = dayByName(dayName), action = deload ? 'start-deload' : 'start-workout';
    let btn = q('[data-action="' + action + '"][data-day="' + day.id + '"]');
    if (!btn) { need(!deload, 'deload start needs the scheduled day'); if (q('[data-action="toggle-others"]')) click('[data-action="toggle-others"]'); btn = el('[data-action="start-workout"][data-day="' + day.id + '"]'); }
    click(btn);
    const w = activeW(); need(w && w.dayName === dayName, 'workout did not start');
    return w;
  }
  function answerSoreness(w, r, d) {
    const muscles = [...new Set(qa('#soreness-card [data-action="set-soreness"]').map((b) => b.dataset.m))];
    muscles.forEach((m) => {
      const v = d.sore != null ? d.sore : weighted(r, [[0, 12], [1, 33], [2, 47], [3, 8]]);
      click('[data-action="set-soreness"][data-m="' + cssq(m) + '"][data-v="' + v + '"]');
    });
    if (muscles.length) need(Object.keys(w.soreness).length === muscles.length, 'soreness answers missing');
  }

  // One exercise of the workout in progress. opts.maxTicks: stop after this many ticks (the "active" fixture).
  // Returns how many sets were ticked.
  function doEntry(w, idx, d, plan, opts) {
    opts = opts || {};
    const en = w.entries[idx], ex = S().exercises.find((e) => e.id === en.exId);
    const r = rngFor('entry', d.i, w.dayName, ex.name, idx);
    const evs = (plan.events || []).filter((e) => e.ex === ex.name);
    const ev = (t) => evs.find((e) => e.type === t);
    const restMs = (((ex.restSec || S().settings.restSec) + between(r, 20, 70)) * 1000);
    const repMin = ex.repMin || S().settings.repMin, repMax = Math.max(repMin, ex.repMax || S().settings.repMax);
    const loaded = ex.equipment !== 'Bodyweight';
    let weight = en.sets[0].weight;
    if (!(weight > 0) && loaded) { weight = liftFor(ex.name).w0; type(setSel('weight', idx, 0), weight); need(en.sets.every((s) => s.weight === weight), 'starting weight not carried to every set'); }
    // Warm-up ramp on the first exercise.
    if (idx === 0 && loaded && weight >= 60 && !plan.noWarmup && !opts.resume) {
      click('[data-action="gen-warmup"][data-e="' + idx + '"]');
      (en.warmups || []).forEach((wu, i) => { if (!(i === 0 && chance(r, 0.15))) click('[data-action="toggle-warmup"][data-e="' + idx + '"][data-s="' + i + '"]', 50000 + r() * 30000); });
    }
    if (ev('addSet')) click('[data-action="add-set"][data-e="' + idx + '"]');
    const goal = en.targetReps, cap = goal >= repMax ? Math.min(goal + 1, 25) : repMax;
    const fresh = freshReps(ex, weight, r, d.form || 0), fat = liftFor(ex.name).fat || 0.6;
    let nSets = en.sets.length, ticked = 0;
    if (w.deload) nSets = Math.max(1, Math.ceil(nSets / 2));
    else if (ev('skipLastSet') && nSets > 2) nSets -= 1;
    for (let i = 0; i < nSets; i++) {
      if (opts.maxTicks != null && ticked >= opts.maxTicks) return ticked;
      const s = en.sets[i];
      if (s.done) continue;
      // eff: what he could do on this set. He stops a rep or two short on the early sets when that still meets the goal.
      let eff = Math.floor(fresh - fat * i + between(r, -0.35, 0.35));
      const leave = weighted(r, i === nSets - 1 ? [[0, 60], [1, 40]] : [[0, 25], [1, 45], [2, 30]]);
      let reps = Math.max(1, Math.min(cap, Math.max(Math.min(goal, eff), eff - leave)));
      if (w.deload) reps = Math.max(1, Math.min(goal, eff - 3));
      const typo = ev('typo'); if (typo && typo.set === i) reps = typo.reps;
      const back = ev('backoff');
      if (back && i === nSets - 1 && i > 0) { type(setSel('weight', idx, i), weight - back.drop); eff += 3; reps = Math.max(1, Math.min(eff, cap)); }
      if (ev('typedNotTicked') && i === nSets - 1 && i > 0) { type(setSel('reps', idx, i), reps); continue; }   // typed, never ticked: Finish counts it
      // The reps box shows the goal: a tick on an empty box logs it. He types only when he got a different number.
      if (reps !== goal || chance(r, 0.2)) type(setSel('reps', idx, i), reps);
      click(setSel('tick', idx, i), restMs);
      need(s.done && s.reps === reps, 'set ' + (i + 1) + ' of ' + ex.name + ' not logged as ' + reps + ' (' + toastText() + ')');
      ticked++;
      if (S().settings.trackRir && chance(r, 0.86)) click('[data-action="pick-rir"][data-e="' + idx + '"][data-s="' + i + '"][data-v="' + Math.max(0, Math.min(3, w.deload ? 3 : eff - reps)) + '"]', 2500);
    }
    if (opts.maxTicks != null && ticked >= opts.maxTicks && en.sets.some((s) => !s.done)) return ticked;
    // How was it?
    if (!w.deload && chance(r, 0.88)) {
      const j3 = ev('joint3');
      const fb = { pump: weighted(r, [[0, 17], [1, 53], [2, 30]]), joint: j3 ? 3 : ev('joint2') ? 2 : weighted(r, [[0, 86], [1, 13], [2, 1]]), workload: weighted(r, [[0, 12], [1, 55], [2, 30], [3, 3]]) };
      ['pump', 'joint', 'workload'].forEach((k) => { if (k === 'joint' && fb.joint === 0 && chance(r, 0.5)) return; click('[data-action="set-fb"][data-e="' + idx + '"][data-f="' + k + '"][data-v="' + fb[k] + '"]', 2500); });
    }
    click('[data-action="finish-entry"][data-e="' + idx + '"]');
    need(en.done, ex.name + ' did not finish: ' + toastText());
    if (en.prs && en.prs.length) note('PR', { ex: ex.name, prs: en.prs.map((p) => p.text) });
    return ticked;
  }

  function doCardio(w, d, plan, r) {
    const c = w.cardio; if (!c) return;
    if (c.incline == null) type('[data-field="cardio"][data-k="incline"]', 10);
    if (c.speed == null) type('[data-field="cardio"][data-k="speed"]', 3.2);
    if (plan.cardio === 'harder') { type('[data-field="cardio"][data-k="incline"]', 12); type('[data-field="cardio"][data-k="speed"]', 3.4); }
    if (plan.cardio === 'short') type('[data-field="cardio"][data-k="min"]', 15);
    if (plan.cardio !== false) { click('[data-action="cardio-done"]', (w.cardio.min + between(r, 1, 4)) * 60000); need(w.cardio.done, 'cardio not logged'); }
  }

  // A whole workout from Start to Finish.
  function workout(d, plan) {
    const r = rngFor('workout', d.i, plan.day);
    clock.atLeast(d.t0, plan.at);
    let w = startWorkout(plan.day, plan.deload === 'start');
    answerSoreness(w, r, plan);
    let idx = 0;
    while (idx < w.entries.length) {
      const en = w.entries[idx], ex = S().exercises.find((e) => e.id === en.exId);
      const evs = (plan.events || []).filter((e) => e.ex === ex.name);
      const swap = evs.find((e) => e.type === 'swap' && !e.used);
      if (evs.find((e) => e.type === 'skip')) { idx++; continue; }   // left untouched: Finish asks, then drops it
      if (swap && !swap.after) {
        // The machine is taken: swap for today before logging anything.
        swap.used = true;
        click('[data-action="swap-entry"][data-e="' + idx + '"]'); click('[data-action="pick-ex-choose"][data-ex="' + exByName(swap.to).id + '"]');
        need(w.entries[idx].swappedFrom === ex.id, 'swap did not take');
        note('swap', { from: ex.name, to: swap.to, kept: false });
        continue;
      }
      if (swap && swap.after) {
        // One set in, then swap: the logged set is kept and the new exercise goes right after.
        swap.used = true;
        const n = w.entries.length;
        if (!(en.sets[0].weight > 0)) type(setSel('weight', idx, 0), liftFor(ex.name).w0);
        type(setSel('reps', idx, 0), Math.max(1, en.targetReps - 1)); click(setSel('tick', idx, 0), 150000);
        click('[data-action="swap-entry"][data-e="' + idx + '"]'); click('[data-action="pick-ex-choose"][data-ex="' + exByName(swap.to).id + '"]');
        need(w.entries.length === n + 1 && w.entries[idx].done && w.entries[idx + 1].swappedFrom === ex.id, 'swap after a set did not keep the set');
        note('swap', { from: ex.name, to: swap.to, kept: true });
        idx++; continue;
      }
      doEntry(w, idx, d, plan);
      if (plan.deload === 'toggle' && idx === 0) {
        // Decided mid-session that this is a deload: the switch puts the finished exercise's plan back.
        click('[data-action="toggle-deload"]'); need(w.deload === true && !w.entries[0].next, 'deload switch did not take');
        note('deload switched on mid-workout', { toast: toastText() });
      }
      idx++;
    }
    (plan.events || []).filter((e) => e.type === 'addNew').forEach((e) => {
      // + Exercise → New: a machine that is not in the list.
      click('[data-action="add-entry"]'); click('[data-action="pick-new-ex"]');
      const f = el('#ex-form'); fill(f, 'name', e.name); fill(f, 'muscle', e.muscle); fill(f, 'equipment', e.equipment);
      click('#ex-form button[type="submit"]');
      need(w.entries[w.entries.length - 1].exId === exByName(e.name).id, 'new exercise not added to the workout');
      doEntry(w, w.entries.length - 1, d, plan);
    });
    (plan.events || []).filter((e) => e.type === 'addExisting').forEach((e) => {
      click('[data-action="add-entry"]'); click('[data-action="pick-ex-choose"][data-ex="' + exByName(e.name).id + '"]');
      doEntry(w, w.entries.length - 1, d, plan);
    });
    doCardio(w, d, plan, r);
    const id = w.id;
    withRules([{ re: /^Log your/, answer: false }], () => click('[data-action="finish-workout"]'));
    w = S().workouts.find((x) => x.id === id);
    need(!S().active && w && w.finishedAt, 'workout did not finish');
    note('workout', { name: w.dayName, deload: !!w.deload, sets: w.entries.reduce((n, en) => n + en.sets.filter((s) => s.done).length, 0), cardio: !!w.cardio });
    return w;
  }

  // The workout in progress of the "active" fixture: about half of its sets ticked, the rest waiting.
  function halfWorkout(d, plan) {
    const r = rngFor('workout', d.i, plan.day);
    clock.atLeast(d.t0, plan.at);
    const w = startWorkout(plan.day, false);
    answerSoreness(w, r, plan);
    const total = w.entries.reduce((n, en) => n + en.sets.length, 0);
    let left = Math.ceil(total / 2);
    for (let idx = 0; idx < w.entries.length && left > 0; idx++) left -= doEntry(w, idx, d, plan, { maxTicks: left });
    const ticked = w.entries.reduce((n, en) => n + en.sets.filter((s) => s.done).length, 0);
    need(S().active === w.id && ticked >= Math.floor(total / 2) && ticked < total, 'half workout: ' + ticked + ' of ' + total);
    note('workout in progress', { name: w.dayName, sets: total, ticked, exercisesDone: w.entries.filter((en) => en.done).length });
    return { total, ticked };
  }

  // ---------------------------------------------------------------------------
  // Food
  // ---------------------------------------------------------------------------
  // How each food is found the first time. q: typed into Search, id: the row picked. code: the barcode typed
  // into "Type the number" (the scan sheet). form: typed in from the label (New food). quick: Quick add.
  const FOODS = {
    oats: { q: 'oats rolled', id: 'u173904' }, whey: { q: 'whey protein', id: 'u173180' }, banana: { q: 'banana', id: 'u173944' },
    blueberries: { q: 'blueberries', id: 'u171711' }, coffee: { q: 'coffee black', id: 'u171890' }, eggs: { q: 'egg scrambled', id: 'u172187' },
    avocado: { q: 'avocado', id: 'u171705' }, granola: { q: 'granola', id: 'u171646' }, strawberries: { q: 'strawberries', id: 'u167762' },
    honey: { q: 'honey', id: 'u169640' }, pb: { q: 'peanut butter', id: 'u324860' }, chicken: { q: 'chicken breast cooked', id: 'u171477' },
    rice: { q: 'white rice cooked', id: 'u168878' }, broccoli: { q: 'broccoli cooked', id: 'u169967' }, oil: { q: 'olive oil', id: 'u171413' },
    turkeyDeli: { q: 'turkey breast deli', id: 'u174572' }, cheddar: { q: 'cheddar', id: 'u328637' }, mayo: { q: 'mayonnaise', id: 'u171009' },
    apple: { q: 'apple', id: 'u171688' }, beef: { q: 'ground beef 93 cooked', id: 'u174755' }, beans: { q: 'black beans', id: 'u173735' },
    tortilla: { q: 'corn tortilla', id: 'u175036' }, tuna: { q: 'tuna canned', id: 'u334194' }, hummus: { q: 'hummus', id: 'u174289' },
    carrots: { q: 'carrots raw', id: 'u170393' }, salmon: { q: 'salmon cooked', id: 'u175168' }, sweetPotato: { q: 'sweet potato baked', id: 'u168483' },
    spinach: { q: 'spinach raw', id: 'u168462' }, pasta: { q: 'pasta cooked', id: 'u169737' }, turkey: { q: 'ground turkey cooked', id: 'u172851' },
    mozzarella: { q: 'mozzarella', id: 'u170847' }, steak: { q: 'sirloin steak cooked', id: 'u173118' }, potato: { q: 'potato baked', id: 'u170093' },
    butter: { q: 'butter', id: 'u173410' }, thigh: { q: 'chicken thigh cooked', id: 'u172388' }, quinoa: { q: 'quinoa', id: 'u168917' },
    romaine: { q: 'romaine', id: 'u169247' }, tomato: { q: 'tomato raw', id: 'u170457' }, cucumber: { q: 'cucumber', id: 'u168409' },
    almonds: { q: 'almonds', id: 'u170567' }, cottage: { q: 'cottage cheese 2%', id: 'u172182' }, orange: { q: 'orange', id: 'u169097' },
    grapes: { q: 'grapes', id: 'u174683' }, iceCream: { q: 'ice cream vanilla', id: 'u167575' }, bread: { q: 'whole wheat bread', id: 'u172688' },
    // packaged, by barcode
    almondMilk: { code: '096619533008', id: 'u2134434' }, questBar: { code: '793573238467', id: 'u1903553' }, premier: { code: '643843714118', id: 'u2491052' },
    corePower: { code: '011620021958', id: 'o11620021958' }, daves: { code: '013764027053', id: 'u2674263' }, chobani: { code: '894700010076', id: 'u2511770' },
    kodiak: { code: '705599012211', id: 'u2665708' }, fairlife: { code: '811620022057', id: 'u2624248' }, mission: { code: '073731071199', id: 'u1915298' },
    barilla: { code: '076808011586', id: 'u2570691' }, raos: { code: '747479000017', id: 'u2603273' }, oikos: { code: '036632019585', id: 'u2098766' },
    coldBrew: { code: '048500203781', id: 'u2577614' }, dietCoke: { code: '049000056181', id: 'u2622180' }, ksAlmonds: { code: '096619723829', id: 'u1901214' },
    rxbar: { code: '859162007200', id: 'u2628806' }, latte: { code: '604913100309', id: 'u489495' },
    // typed in from a label
    lasagna: { form: { name: 'Mom\'s lasagna', slabel: '1 piece', kcal: 420, p: 28, c: 34, f: 19 } },
    sourdough: { form: { name: 'Sourdough, corner bakery', slabel: '1 slice', sg: 48, kcal: 120, p: 4, c: 24, f: 0.5 } },
    cookie: { code: '850031234567', form: { name: 'Protein cookie, double chocolate', brand: 'Bakehouse Co', slabel: '1 cookie', sg: 70, kcal: 260, p: 16, c: 30, f: 9 } },
    cake: { form: { name: 'Office birthday cake', slabel: '1 slice', kcal: 350, p: 4, c: 50, f: 15 } },
    // quick adds (no food behind them)
    qBowl: { quick: { name: 'Chipotle chicken bowl', kcal: 780, p: 52, c: 70, f: 30 } }, qPizza: { quick: { name: 'Pizza, 3 slices', kcal: 870, p: 36, c: 102, f: 33 } },
    qSushi: { quick: { name: 'Sushi takeout', kcal: 640, p: 34, c: 88, f: 14 } }, qMacros: { quick: { name: '', p: 25, c: 30, f: 10 } },
    qBurger: { quick: { name: 'Burger and fries', kcal: 1050, p: 45, c: 95, f: 52 } }, qZero: { quick: { name: 'Black coffee, cafe', kcal: 0 } }
  };
  // Meals he eats. Each item: [food, unit, amounts to choose from, optional?]. Unit: g, oz, ml, floz, srv (the
  // label serving) or the start of a portion's name as the unit list shows it ("1 medium").
  const M = (...items) => items.map(([key, unit, qty, opt]) => ({ key, unit, qty: Array.isArray(qty) ? qty : [qty], opt: !!opt }));
  const MEALS = {
    breakfast: [
      ['oats', 45, M(['oats', 'g', [60, 80, 80, 90]], ['almondMilk', 'ml', [240, 250, 250, 300]], ['whey', '0.33 cup', [1, 1, 1.5]], ['banana', '1 medium', 1], ['blueberries', 'g', [75, 100], true], ['coffee', '1 cup', [1, 1, 2], true])],
      ['eggs', 25, M(['eggs', '1 large', [3, 3, 4]], ['daves', 'srv', [1, 2, 2]], ['avocado', '1 avocado', 0.5, true], ['coffee', '1 cup', [1, 2]], ['orange', '1 fruit', 1, true])],
      ['yogurt', 15, M(['chobani', 'srv', 1], ['granola', 'g', [40, 50]], ['strawberries', '1 cup, halves', 1], ['honey', '1 tbsp', 1, true], ['coffee', '1 cup', 1])],
      ['waffles', 15, M(['kodiak', 'srv', [1, 1.5]], ['pb', '2 tablespoon', [0.5, 1]], ['fairlife', 'ml', [240, 300]], ['banana', '1 medium', 1, true])]
    ],
    lunch: [
      ['bowl', 34, M(['chicken', 'g', [150, 170, 170, 200]], ['rice', '1 cup', [1, 1.5, 1.5]], ['broccoli', 'g', [120, 150]], ['oil', '1 tsp', [1, 2], true])],
      ['sandwich', 24, M(['daves', 'srv', 2], ['turkeyDeli', '1 slice (', [4, 5]], ['cheddar', '1 slice', 1], ['mayo', '1 tbsp', 1, true], ['apple', '1 medium', 1])],
      ['burrito', 18, M(['beef', 'g', [150, 170]], ['beans', '1 cup', 0.5], ['rice', '1 cup', 1], ['tortilla', '1 tortilla', [2, 3]], ['avocado', '1 avocado', 0.5, true])],
      ['tuna', 12, M(['tuna', '1 can drained', 1], ['mission', 'srv', 2], ['hummus', '1 tbsp', 2], ['carrots', 'g', 100], ['grapes', '1 cup', 1, true])],
      ['out', 12, M(['qBowl'], ['dietCoke', 'srv', 1, true])]
    ],
    dinner: [
      ['salmon', 24, M(['salmon', 'g', [150, 170, 200]], ['sweetPotato', '1 large', 1], ['spinach', '1 cup', 2], ['oil', '1 tablespoon', 1])],
      ['pasta', 24, M(['barilla', 'srv', [1.5, 2]], ['raos', 'srv', 1], ['turkey', 'g', [150, 170]], ['mozzarella', '1 oz', 1, true])],
      ['steak', 18, M(['steak', 'oz', [6, 8]], ['potato', '1 potato medium', 1], ['broccoli', 'g', 150], ['butter', '1 pat', [1, 2], true])],
      ['thighs', 20, M(['thigh', '1 thigh without skin', [2, 3]], ['quinoa', '1 cup', 1], ['romaine', '1 cup shredded', 2], ['tomato', 'g', 100, true], ['cucumber', '0.5 cup slices', 1, true], ['oil', '1 tsp', 2])],
      ['takeout', 14, M(['qPizza'])]
    ],
    snacks: [
      ['questBar', 'srv', 1], ['premier', 'srv', 1], ['corePower', 'srv', 1], ['almonds', 'g', [28, 40]], ['ksAlmonds', 'srv', 1], ['apple', '1 medium', 1], ['banana', '1 medium', 1],
      ['cottage', '1 cup (not packed)', [0.5, 1]], ['oikos', 'srv', 1], ['iceCream', '1 serving', [1, 2]], ['rxbar', 'srv', 1], ['coldBrew', 'floz', [12, 16]], ['latte', 'srv', 1],
      ['dietCoke', 'srv', 1], ['grapes', '1 cup', 1], ['pb', '2 tablespoon', 0.5], ['bread', '1 slice', [1, 2]]
    ]
  };
  const MEAL_NAMES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
  const FAVS = ['oats', 'whey', 'chicken', 'rice', 'questBar', 'almondMilk', 'chobani'];
  const isFav = (key) => CFG.mode === 'main' && FAVS.includes(key);   // starred the first time they are logged

  const dayEntries = (key) => S().diary[key] || [];
  const screenDay = () => F()._.fu.drawn || todayKey();
  function unitOf(food, spec) {
    const opts = F()._.unitOptions(food);
    const o = ['g', 'oz', 'ml', 'floz', 'srv'].includes(spec) ? opts.find((x) => x.u === spec) : opts.find((x) => x.label.toLowerCase().startsWith(String(spec).toLowerCase()));
    return o ? o.u : fail('food ' + food.name + ' has no unit "' + spec + '" (has ' + opts.map((x) => x.label).join(' | ') + ')');
  }
  function openAdd(meal) {
    if (O().screen !== 'food') goTab('food');
    const h = q('#sheet:not([hidden]) .sheet-title h2');
    if (h && q('#food-results') && h.textContent.startsWith('Add to ' + MEAL_NAMES[meal])) return;
    closeSheet();
    click('[data-action="food-add"][data-meal="' + meal + '"]');
    need(q('#food-results'), 'add sheet did not open');
  }
  function search(text) { const box = el('[data-field="food-search"]'); if (box.value !== text) type(box, text, 'input'); }
  // The amount sheet is open: set unit and amount, maybe star it, then Add.
  function amountAndSave(item, meal, star) {
    const x = F()._.fu.fx; need(x && q('#food-preview'), 'amount sheet is not open');
    const unit = unitOf(x.food, item.unit);
    if (x.unit !== unit) type('[data-field="food-unit"]', unit);
    if (x.qty !== item.q) type('[data-field="food-qty"]', item.q, 'input');
    need(F()._.fu.fx.unit === unit && F()._.fu.fx.qty === item.q, 'amount not set');
    if (x.meal !== meal) click('.f-mealseg [data-action="food-meal"][data-i="' + meal + '"]');
    if (star && !(S().food.foods[x.food.id] && S().food.foods[x.food.id].fav)) click('[data-action="food-fav"]');
    click('[data-action="food-save"]');
  }
  async function scanCode(code) {
    click('[data-action="food-scan"]');
    need(q('#scan-status'), 'scan sheet did not open');
    withRules([{ re: /Barcode number/, answer: code }], () => click('[data-action="food-type-code"]'));
    await waitFor(() => q('#food-preview') || q('#food-form'), 'the scanned product');
  }
  function fillFoodForm(form, code) {
    const f = el('#food-form');
    ['name', 'brand', 'slabel', 'sg', 'kcal', 'p', 'c', 'f'].forEach((k) => { if (form[k] != null) fill(f, k, form[k]); });
    if (code && !f.elements.barcode.value) fill(f, 'barcode', code);
    click('#food-form button[type="submit"]');
    need(q('#food-preview'), 'food form did not save: ' + toastText());
  }
  function quickAdd(qk, meal) {
    click('[data-action="food-quick"]');
    const f = el('#food-quick-form');
    ['name', 'kcal', 'p', 'c', 'f'].forEach((k) => { if (qk[k] != null) fill(f, k, qk[k]); });
    if (F()._.fu.fx.meal !== meal) click('#food-quick-form [data-action="food-meal"][data-i="' + meal + '"]');
    click('#food-quick-form button[type="submit"]');
  }
  const storedId = (key) => { const c = FOODS[key]; return c.id || c._id || null; };

  // Logs one food to a meal of the day on screen, the way he would: + on a Favorite or Recent row when the
  // remembered amount is the one he wants, else the row and a new amount, else search / barcode / label.
  async function addFood(item, meal) {
    const c = FOODS[item.key] || fail('no food ' + item.key);
    const day = screenDay(), before = dayEntries(day).length;
    openAdd(meal);
    if (c.quick) { search(''); quickAdd(c.quick, meal); }
    else {
      const id = storedId(item.key), stored = id && S().food.foods[id];
      if (stored) {
        search('');
        const row = q('#food-results [data-action="food-pick"][data-id="' + cssq(id) + '"]');
        const plus = q('#food-results [data-action="food-plus"][data-id="' + cssq(id) + '"]');
        const a = stored.last;
        if (plus && !plus.disabled && a && a.unit === unitOf(stored, item.unit) && a.qty === item.q) click(plus);
        else {
          if (row) click(row);
          else { search(stored.name.split(',')[0]); click('#food-results [data-action="food-pick"][data-src="mine"][data-id="' + cssq(id) + '"]'); }
          amountAndSave(item, meal, false);
        }
      } else if (c.code) {
        search('');
        await scanCode(c.code);
        if (q('#food-form')) { need(c.form, 'barcode ' + c.code + ' is not in the list'); fillFoodForm(c.form, c.code); c._id = F()._.fu.fx.food.id; note('custom food from an unknown barcode', { name: c.form.name, id: c._id }); }
        else need(F()._.fu.fx.food.id === c.id, 'barcode ' + c.code + ' gave ' + F()._.fu.fx.food.id + ', expected ' + c.id);
        amountAndSave(item, meal, isFav(item.key));
      } else if (c.form) {
        search('');
        click('[data-action="food-new"]');
        fillFoodForm(c.form);
        c._id = F()._.fu.fx.food.id; note('custom food typed in', { name: c.form.name, id: c._id });
        amountAndSave(item, meal, false);
      } else {
        search(c.q);
        await F()._.loadDb();
        await waitFor(() => q('#food-results [data-action="food-pick"][data-id="' + cssq(c.id) + '"]'), 'search result ' + c.q + ' → ' + c.id);
        click('#food-results [data-action="food-pick"][data-id="' + cssq(c.id) + '"]');
        amountAndSave(item, meal, isFav(item.key));
      }
    }
    need(dayEntries(day).length === before + 1, 'food not added: ' + item.key + ' (' + toastText() + ')');
    return dayEntries(day)[dayEntries(day).length - 1];
  }
  // Custom foods keep the id the app gave them; after a reload look it up again by name.
  function relinkCustom() { Object.values(FOODS).forEach((c) => { if (c.form && !c._id) { const f = Object.values(S().food.foods).find((x) => x.name === c.form.name); if (f) c._id = f.id; } }); }

  function chooseItems(list, r) { return list.map((it) => ({ key: it.key, unit: it.unit, q: it.qty.length ? pick(r, it.qty) : undefined, opt: it.opt })); }
  const haveFood = (key) => { const id = storedId(key); return !!(id && S().food.foods[id]); };
  // What he eats on a day. d.food can force a meal ('oats', 'bowl', 'none'...), d.food.full keeps every optional
  // item, d.food.snacks === 'shake' leaves only the shake.
  function planDay(d) {
    const r = rngFor('food', d.i), force = d.food || {};
    const out = { breakfast: null, lunch: null, dinner: null, snacks: [], shake: false };
    ['breakfast', 'lunch', 'dinner'].forEach((m) => {
      const name = force[m] || weighted(r, MEALS[m].map((x) => [x[0], x[1]]));
      if (name === 'none') { out[m] = { name, items: [] }; return; }
      const t = MEALS[m].find((x) => x[0] === name) || fail('no ' + m + ' called ' + name);
      let items = chooseItems(t[2], r).filter((it) => !it.opt || force.full || chance(r, 0.6));
      if (name === 'takeout') items = [{ key: pick(r, ['qPizza', 'qSushi', 'qBurger']) }];
      out[m] = { name, items };
    });
    const n = weighted(r, [[1, 25], [2, 45], [3, 30]]);
    const pool = MEALS.snacks.slice();
    for (let i = 0; i < n; i++) { const j = Math.floor(r() * pool.length), s = pool.splice(j, 1)[0]; out.snacks.push({ key: s[0], unit: s[1], q: Array.isArray(s[2]) ? pick(r, s[2]) : s[2] }); }
    // Foods he typed in himself come back now and then once they exist.
    if (haveFood('sourdough') && out.breakfast.name === 'eggs' && chance(r, 0.5)) out.breakfast.items.push({ key: 'sourdough', unit: pick(r, ['srv', 'g']), q: 0 });
    out.breakfast.items.forEach((it) => { if (it.key === 'sourdough') it.q = it.unit === 'g' ? pick(r, [50, 96]) : pick(r, [1, 2]); });
    if (haveFood('cookie') && chance(r, 0.12)) out.snacks.push({ key: 'cookie', unit: 'srv', q: 1 });
    if (haveFood('lasagna') && out.dinner.name === 'pasta' && chance(r, 0.3)) out.dinner = { name: 'lasagna', items: [{ key: 'lasagna', unit: 'srv', q: pick(r, [1, 1.5]) }, { key: 'romaine', unit: '1 cup shredded', q: 2 }, { key: 'oil', unit: '1 tsp', q: 1 }] };
    if (force.snacks === 'shake') out.snacks = [];
    out.shake = force.snacks === 'shake' || (!!d.workout && chance(r, 0.45));
    // 8 to 16 entries a day.
    const count = () => out.breakfast.items.length + out.lunch.items.length + out.dinner.items.length + out.snacks.length + (out.shake ? 2 : 0) + (d.extraItems || 0);
    while (count() > 15 && out.snacks.length > 1) out.snacks.pop();
    const extra = ['apple', 'almonds', 'dietCoke', 'orange', 'premier', 'cottage', 'grapes', 'oikos'].filter((k) => !out.snacks.some((s) => s.key === k));
    while (count() < 9 && extra.length) { const k = extra.shift(), s = MEALS.snacks.find((x) => x[0] === k) || ['orange', '1 fruit', 1]; out.snacks.push({ key: s[0], unit: s[1], q: Array.isArray(s[2]) ? s[2][0] : s[2] }); }
    return out;
  }
  const savedMeal = (name) => Object.values(S().food.meals).find((m) => m.name === name);
  // At most 16 entries a day: how many more fit, keeping room for `later` ones that are still to come.
  const room = (d, later) => 16 - dayEntries(d.key).length - (later || 0);
  const reserved = (d, whens) => (d.events || []).filter((e) => whens.includes(e.when) && e.type === 'addItem').length;
  // `later`: entries the rest of the day will still add (optional items and shortcuts give way to them).
  async function logMeal(d, mealIdx, planned, r, later) {
    const day = screenDay();
    if (!planned.items.length) return 'none';
    const fits = (n) => day !== d.key || room(d, later) >= n;
    // Shortcuts he uses when they fit: a saved meal, or yesterday's version of the meal.
    const sm = planned.saved && savedMeal(planned.saved);
    if (sm && chance(r, 0.65) && fits(sm.items.length)) {
      openAdd(mealIdx); search('');
      const before = dayEntries(day).length;
      click('#food-results [data-action="food-sm-open"][data-id="' + cssq(sm.id) + '"]');
      click('[data-action="food-sm-log"]');
      need(dayEntries(day).length === before + sm.items.length, 'saved meal not logged');
      closeSheet(); return 'saved meal';
    }
    const prev = dayEntries(addDays(day, -1)).filter((e) => e.meal === mealIdx);
    if (planned.copy && prev.length >= 2 && prev.length <= 5 && fits(prev.length) && !dayEntries(day).some((e) => e.meal === mealIdx)) {
      closeSheet();
      const before = dayEntries(day).length;
      click('[data-action="food-meal-menu"][data-meal="' + mealIdx + '"]');
      click('[data-action="food-copy-meal"]');
      need(dayEntries(day).length === before + prev.length, 'meal not copied');
      return 'copied';
    }
    for (let k = 0; k < planned.items.length; k++) {
      const it = planned.items[k], mustFollow = planned.items.slice(k + 1).filter((x) => !x.opt).length;
      if (it.opt && !fits(1 + mustFollow)) continue;
      await addFood(it, mealIdx);
    }
    closeSheet(); return 'items';
  }

  async function breakfast(d, plan) {
    const r = rngFor('meal', d.i, 0);
    clock.atLeast(d.t0, 6 * 60 + 40 + between(r, 0, 50));
    goTab('food');
    if (d.setTargets) {
      click('[data-action="food-targets"]');
      Object.keys(d.setTargets).forEach((k) => type('#sheet [data-field="food-target"][data-k="' + k + '"]', d.setTargets[k]));
      closeSheet();
      need(S().food.targets.kcal === d.setTargets.kcal, 'targets not set');
    }
    if (d.copyDay) {
      // Nothing logged yet today: one tap copies the whole day before (then he does not log the meals again).
      const before = dayEntries(d.key).length; need(!before, 'copy day needs an empty day');
      click('[data-action="food-copy-day"]');
      need(dayEntries(d.key).length > 0, 'day not copied'); note('copied the day before', { entries: dayEntries(d.key).length });
      return;
    }
    plan.breakfast.saved = plan.breakfast.name === 'oats' ? 'Usual breakfast' : null;
    plan.breakfast.copy = chance(r, 0.25);
    await logMeal(d, 0, plan.breakfast, r, 10);
  }
  async function lunch(d, plan) {
    const r = rngFor('meal', d.i, 1);
    clock.atLeast(d.t0, 12 * 60 + 5 + between(r, 0, 70));
    goTab('food');
    plan.lunch.saved = plan.lunch.name === 'bowl' ? 'Chicken rice bowl' : null;
    plan.lunch.copy = chance(r, 0.12);
    await logMeal(d, 1, plan.lunch, r, 5);
  }
  async function snack(d, plan, which) {
    const r = rngFor('meal', d.i, 3, which);
    const half = Math.ceil(plan.snacks.length / 2);
    const items = which === 0 ? plan.snacks.slice(0, half) : plan.snacks.slice(half);
    if (!items.length && !(which === 1 && plan.shake)) return;
    clock.atLeast(d.t0, (which === 0 ? 15 * 60 + 20 : 20 * 60 + 40) + between(r, 0, 40));
    goTab('food');
    // Still to come after this helping: dinner and the shake (first helping), and what the day's story adds.
    const later = which === 0 ? plan.dinner.items.filter((x) => !x.opt).length + (plan.shake ? 2 : 0) + reserved(d, ['afternoon', 'evening']) : reserved(d, ['evening']);
    if (which === 1 && plan.shake && room(d, later) >= 2) {
      // After training: the shake and a banana, in one tap once they are a saved meal.
      const sm = savedMeal('Shake + banana') || savedMeal('Post-workout shake');
      if (sm) { openAdd(3); search(''); click('#food-results [data-action="food-sm-open"][data-id="' + cssq(sm.id) + '"]'); click('[data-action="food-sm-log"]'); }
      else { await addFood({ key: 'corePower', unit: 'srv', q: 1 }, 3); await addFood({ key: 'banana', unit: '1 medium', q: 1 }, 3); }
    }
    for (const it of items) { if (room(d, later) < 1) break; await addFood(it, 3); }
    closeSheet();
  }
  async function dinner(d, plan) {
    const r = rngFor('meal', d.i, 2);
    clock.atLeast(d.t0, 19 * 60 + between(r, 0, 60));
    goTab('food');
    plan.dinner.copy = chance(r, 0.08);
    await logMeal(d, 2, plan.dinner, r, (plan.shake ? 2 : 0) + reserved(d, ['evening']));
  }

  // The light user: the day's foods are listed one by one in the config (d.items: { meal: [item] }).
  async function explicitMeals(d, meals) {
    for (const m of meals) {
      const items = (d.items && d.items[m]) || []; if (!items.length) continue;
      clock.atLeast(d.t0, [7 * 60 + 10, 12 * 60 + 30, 19 * 60 + 15, 15 * 60 + 45][m]);
      goTab('food');
      for (const it of items) await addFood(it, m);
      closeSheet();
    }
  }

  // ---- things he does to the food log now and then ----
  const openEntry = (e) => { closeSheet(); click('.f-meal [data-action="food-edit"][data-id="' + cssq(e.id) + '"]'); need(q('#food-preview') || q('#food-quick-form'), 'entry did not open'); };
  const lastOf = (key, meal, pred) => dayEntries(key).filter((e) => (meal == null || e.meal === meal) && (!pred || pred(e))).slice(-1)[0];
  const foodEvents = {
    saveMeal(d, a) {   // ⋯ → Save as a meal
      goTab('food');
      const items = dayEntries(d.key).filter((e) => e.meal === a.meal); need(items.length, 'nothing to save as a meal');
      click('[data-action="food-meal-menu"][data-meal="' + a.meal + '"]');
      withRules([{ re: /Name this meal/, answer: a.name }], () => click('[data-action="food-save-meal"]'));
      need(savedMeal(a.name), 'meal not saved'); note('saved meal', { name: a.name, items: items.length });
    },
    renameMeal(d, a) {
      goTab('food'); openAdd(3); search('');
      click('#food-results [data-action="food-sm-open"][data-id="' + cssq(savedMeal(a.from).id) + '"]');
      withRules([{ re: /Rename meal/, answer: a.to }], () => click('[data-action="food-sm-rename"]'));
      need(savedMeal(a.to), 'meal not renamed'); closeSheet(); note('saved meal renamed', a);
    },
    trimMeal(d, a) {   // drop one food from a saved meal
      goTab('food'); openAdd(1); search('');
      const m = savedMeal(a.name), n = m.items.length, i = m.items.findIndex((x) => /olive oil/i.test(x.name));
      click('#food-results [data-action="food-sm-open"][data-id="' + cssq(m.id) + '"]');
      click('[data-action="food-sm-remove"][data-i="' + (i >= 0 ? i : n - 1) + '"]');
      need(savedMeal(a.name).items.length === n - 1, 'saved meal item not removed'); closeSheet(); note('food dropped from a saved meal', { name: a.name });
    },
    moveByButton(d, a) {   // open a logged food, pick another meal, Save
      goTab('food');
      const e = lastOf(d.key, a.from); if (!e) return note('nothing to move');
      openEntry(e);
      click((q('#food-quick-form') ? '#food-quick-form ' : '.f-mealseg ') + '[data-action="food-meal"][data-i="' + a.to + '"]');
      click(q('#food-quick-form') ? '#food-quick-form button[type="submit"]' : '[data-action="food-save"]');
      need(dayEntries(d.key).find((x) => x.id === e.id).meal === a.to, 'entry not moved'); note('entry moved with the Meal buttons', { name: e.name, from: a.from, to: a.to, id: e.id });
    },
    editAmount(d) {
      goTab('food');
      const e = lastOf(d.key, null, (x) => x.unit === 'g' && x.qty >= 100 && !!S().food.foods[x.food]); if (!e) return note('edit amount skipped');
      openEntry(e); type('[data-field="food-qty"]', e.qty + 20, 'input'); click('[data-action="food-save"]');
      const now2 = dayEntries(d.key).find((x) => x.id === e.id);
      need(now2.qty === e.qty + 20 && now2.at === e.at, 'entry amount not changed'); note('entry amount edited', { name: e.name, id: e.id });
    },
    deleteEntry(d) {
      goTab('food');
      const e = lastOf(d.key, 3) || lastOf(d.key); if (!e || dayEntries(d.key).length <= 8) return;
      openEntry(e); click('[data-action="food-delete"]');
      need(S().deleted.food[e.id] && !dayEntries(d.key).some((x) => x.id === e.id), 'entry not deleted'); note('entry deleted', { name: e.name, id: e.id });
    },
    async clearMeal(d) {   // logged into the wrong meal, cleared, logged again where it belongs
      goTab('food');
      const items = [{ key: 'apple', unit: '1 medium', q: 1 }, { key: 'almonds', unit: 'g', q: 28 }];
      const before = dayEntries(d.key).filter((e) => e.meal === 0).map((e) => e.id);
      if (before.length) return note('clear meal skipped: breakfast not empty');
      for (const it of items) await addFood(it, 0);
      closeSheet();
      click('[data-action="food-meal-menu"][data-meal="0"]'); click('[data-action="food-clear-meal"]');
      need(!dayEntries(d.key).some((e) => e.meal === 0), 'meal not cleared'); note('meal cleared', { entries: items.length });
    },
    async backfill(d, a) {   // yesterday's forgotten food, added this morning
      goTab('food');
      click('[data-action="food-day"][data-d="-1"]');
      const y = addDays(d.key, -1); need(screenDay() === y, 'did not go to yesterday');
      if (dayEntries(y).length >= 16) { click('[data-action="food-day"][data-d="0"]'); return; }
      const e = await addFood(a.item, a.meal); closeSheet();
      need(dayEntries(y).some((x) => x.id === e.id), 'back-fill went to the wrong day');
      click('[data-action="food-day"][data-d="0"]'); need(screenDay() === d.key, 'did not come back to today');
      note('back-filled yesterday', { name: e.name });
    },
    copyToToday(d, a) {   // a past day's meal copied to today
      goTab('food');
      click('[data-action="food-day"][data-d="-1"]');
      const y = addDays(d.key, -1), n = dayEntries(y).filter((e) => e.meal === a.meal).length, before = dayEntries(d.key).length;
      if (!n || before + n > 16) { click('[data-action="food-day"][data-d="0"]'); return note('copy to today skipped'); }
      click('[data-action="food-meal-menu"][data-meal="' + a.meal + '"]'); click('[data-action="food-copy-today"]');
      need(dayEntries(d.key).length === before + n, 'meal not copied to today');
      click('[data-action="food-day"][data-d="0"]'); note('copied a meal to today', { entries: n });
    },
    fixLabel(d, a) {   // "Numbers wrong? Fix them" on a listed product: his copy takes its place, same id
      goTab('food');
      const id = storedId(a.key), e = lastOf(d.key, null, (x) => x.food === id); if (!e) return note('label fix skipped: not logged today');
      openEntry(e); click('[data-action="food-fix"]');
      const f = el('#food-form'); fill(f, 'kcal', a.kcal); fill(f, 'f', a.f);
      click('#food-form button[type="submit"]'); click('[data-action="food-save"]');
      need(S().food.foods[id].src === 'custom', 'label fix did not replace the product'); note('label corrected on a listed product', { id, name: S().food.foods[id].name });
    },
    forgetFood(d, a) {   // a typed-in food deleted: days already logged keep their numbers
      goTab('food'); openAdd(3);
      const id = storedId(a.key), name = S().food.foods[id].name;
      search(name.split(' ')[0]); click('#food-results [data-action="food-pick"][data-src="mine"][data-id="' + cssq(id) + '"]');
      click('[data-action="food-fix"]'); click('[data-action="food-forget"]');
      need(!S().food.foods[id], 'food not deleted'); note('custom food deleted', { id, name, entriesLeft: Object.values(S().diary).flat().filter((e) => e.food === id).length });
    },
    async addItem(d, a) {   // one more food, to a meal
      goTab('food');
      const e = await addFood(a.item, a.meal); closeSheet();
      if (a.note) note(a.note, { name: e.name, id: e.id });
    },
    unstar(d, a) {
      goTab('food'); openAdd(3); search('');
      const id = storedId(a.key);
      click('#food-results [data-action="food-pick"][data-id="' + cssq(id) + '"]'); click('[data-action="food-fav"]');
      need(!S().food.foods[id].fav, 'star not removed'); closeSheet(); note('favorite removed', { id });
    }
  };

  // ---------------------------------------------------------------------------
  // Other things he does now and then
  // ---------------------------------------------------------------------------
  const events = {
    saveTemplate(d, a) {
      goTab('program');
      withRules([{ re: /Name this template/, answer: a.name }], () => click('[data-action="save-template"]'));
      need(S().templates.some((t) => t.name === a.name), 'template not saved'); note('template saved', { name: a.name });
    },
    replaceInDay(d, a) {   // Program → Edit day: one exercise out, another in its place
      goTab('program');
      const day = dayByName(a.day), i = day.exercises.indexOf(exByName(a.out).id);
      click('[data-action="edit-day"][data-day="' + day.id + '"]');
      click('[data-action="day-remove-ex"][data-i="' + i + '"]');
      click('[data-action="pick-ex"]'); click('[data-action="pick-ex-choose"][data-ex="' + exByName(a.in).id + '"]');
      for (let j = day.exercises.length - 1; j > i; j--) click('[data-action="day-move"][data-i="' + j + '"][data-d="-1"]');
      need(day.exercises[i] === exByName(a.in).id, 'exercise not replaced'); closeSheet(); note('program changed', a);
    },
    deleteExercise(d, a) {
      goTab('exercises');
      const ex = exByName(a.name);
      click('#app [data-action="edit-ex"][data-ex="' + ex.id + '"]'); click('[data-action="delete-ex"]');
      need(!S().exercises.some((e) => e.id === ex.id), 'exercise not deleted');
      note('exercise deleted', { name: a.name, id: ex.id, sessions: S().workouts.filter((w) => w.entries.some((en) => en.exId === ex.id)).length });
    },
    editWorkout(d, a) {   // History → the workout → Edit sets: a typo fixed later
      goTab('history');
      const w = S().workouts.filter((x) => x.finishedAt && x.dayName === a.day).slice(-1)[0];
      const ei = w.entries.findIndex((en) => en.exId === exByName(a.ex).id), si = w.entries[ei].sets.findIndex((s) => s.reps === a.wrong);
      need(ei >= 0 && si >= 0, 'no set with the typo to fix');
      const before = JSON.stringify(S().presc[w.entries[ei].exId]);
      click('#app .list [data-action="view-workout"][data-w="' + w.id + '"]'); click('[data-action="edit-workout"]');
      const right = a.right != null ? a.right : Math.max(1, w.entries[ei].sets[Math.max(0, si - 1)].reps - 1);
      el('#edit-workout-form').elements['r-' + ei + '-' + si].value = String(right);
      click('#edit-workout-form button[type="submit"]');
      need(w.entries[ei].sets[si].reps === right, 'set not corrected');
      note('workout edited later', { workout: w.id, date: w.date, ex: a.ex, from: a.wrong, to: right, toast: toastText(), prescChanged: before !== JSON.stringify(S().presc[w.entries[ei].exId]) });
      closeSheet();
    },
    deleteWorkout(d, a) {
      goTab('history');
      const w = S().workouts.filter((x) => x.finishedAt && x.dayName === a.day).slice(-1)[0];
      click('#app .list [data-action="view-workout"][data-w="' + w.id + '"]'); click('[data-action="delete-workout"]');
      need(S().deleted.workouts[w.id] && !S().workouts.some((x) => x.id === w.id), 'workout not deleted'); note('workout deleted from History', { id: w.id, date: w.date });
    },
    discardWorkout(d, a) {   // started the wrong day, logged a set, discarded
      const w = startWorkout(a.day, false), id = w.id;
      const en = w.entries[0];
      if (!(en.sets[0].weight > 0)) type(setSel('weight', 0, 0), liftFor(S().exercises.find((e) => e.id === en.exId).name).w0);
      click(setSel('tick', 0, 0));
      click('[data-action="discard-workout"]');
      need(!S().active && S().deleted.workouts[id], 'workout not discarded'); note('workout discarded', { id });
    },
    junkWorkout(d, a) {   // one set on a rest day, finished, deleted from History the next day
      clock.atLeast(d.t0, 11 * 60);
      const w = startWorkout(a.day, false), id = w.id;
      doEntry(w, 0, d, { events: [], noWarmup: true });
      withRules([{ re: /not done/, answer: true }, { re: /^Log your/, answer: false }], () => click('[data-action="finish-workout"]'));
      need(!S().active && S().workouts.find((x) => x.id === id).finishedAt, 'junk workout did not finish');
    },
    deleteWeighIn(d, a) {
      goTab('history');
      const key = addDays(d.key, -a.daysBack);
      click('[data-action="bw-list"]'); click('[data-action="bw-delete"][data-date="' + key + '"]');
      need(S().deleted.bw[key] && !S().bodyweight.some((b) => b.date === key), 'weigh-in not deleted'); closeSheet(); note('weigh-in deleted', { date: key });
    },
    deleteNight(d, a) {
      goTab('history');
      const key = addDays(d.key, -a.daysBack);
      click('[data-action="sleep-list"]'); click('[data-action="sleep-delete"][data-date="' + key + '"]');
      need(S().deleted.sleep[key] && !S().sleep.some((x) => x.date === key), 'night not deleted'); closeSheet(); note('night deleted', { date: key });
    },
    exportBackup() {   // Settings → Export JSON (a download here; the share sheet on the phone)
      goTab('settings'); click('[data-action="export"]'); note('exported a backup');
    },
    async whoopSyncNow(d) {   // Settings → WHOOP → Sync now: recovery arrives for a night he typed in the morning
      goTab('settings');
      const C = window.__overloadConn._cs;
      await waitFor(() => q('[data-action="conn-whoop-sync"]'), 'the Sync now button');
      click('[data-action="conn-whoop-sync"]');
      await waitFor(() => !C.syncing && (S().sleep.find((x) => x.date === d.key) || {}).recovery != null, 'recovery for the typed night');
      note('WHOOP added recovery to a typed night', { night: S().sleep.find((x) => x.date === d.key) });
    },
    editNight(d) { editNight(d); }
  };
  async function runEvents(d, when) {
    for (const e of (d.events || []).filter((x) => x.when === when)) {
      const fn = foodEvents[e.type] || events[e.type] || fail('no such event ' + e.type);
      await fn(d, e);
      closeSheet();
    }
  }

  // ---------------------------------------------------------------------------
  // A day
  // ---------------------------------------------------------------------------
  const waitConn = async (d) => {
    if (!d.whoop) return;
    const C = window.__overloadConn._cs;
    await waitFor(() => C.lastSync > 0 && !C.syncing, 'the WHOOP sync');
    await realWait(30);
  };
  function begin(i) { cur = CFG.days[i]; clickRng = rngFor('clicks', i, now); relinkCustom(); return cur; }

  const SIM = {
    clock, dialogs, log, CFG,
    // Wake up: set-up on the first day, check-in, breakfast, an early workout if there is one, lunch.
    async morning(i) {
      const d = begin(i);
      await waitConn(d);
      if (d.setup) setupFirstDay();
      const plan = d.diary && !d.items ? planDay(d) : null; d._plan = plan;
      const early = d.workout && d.workout.at < 9 * 60;
      clock.atLeast(d.t0, 5 * 60 + 50);
      checkin(d);
      await runEvents(d, 'morning');
      if (early) { workout(d, d.workout); }
      if (plan) { await breakfast(d, plan); if (!d.copyDay) await lunch(d, plan); }
      if (d.items) await explicitMeals(d, [0, 1]);
      await runEvents(d, 'noon');
      closeSheet();
      return { dialogs: dialogs.length, log: log.length };
    },
    async afternoon(i) {
      const d = begin(i), plan = d.diary && !d.items ? d._plan || planDay(d) : null;
      if (plan && !d.copyDay) await snack(d, plan, 0);
      if (d.items) await explicitMeals(d, [3]);
      closeSheet();
      await runEvents(d, 'afternoon');
    },
    // Late afternoon workout, dinner, the last snack, and the odd correction before bed.
    async evening(i) {
      const d = begin(i), plan = d.diary && !d.items ? d._plan || planDay(d) : null;
      if (d.workout && d.workout.at >= 9 * 60) workout(d, d.workout);
      if (plan && !d.copyDay) { await dinner(d, plan); await snack(d, plan, 1); }
      if (d.items) await explicitMeals(d, [2]);
      closeSheet();
      await runEvents(d, 'evening');
      clock.atLeast(d.t0, 22 * 60);
      goTab('today');
    },
    startHalf(i) { const d = begin(i); return halfWorkout(d, d.workout); },
    // DIRECT: the connector link is taken out at the end, the way an Import that declines the link leaves it
    // (see the note in make-v28.js). Nothing else in the fixture is written past the app.
    dropConnector() { const s = S().settings; delete s.connUrl; delete s.connKey; O().save(); },
    // What the food screen needs for a drag with the real mouse (make-v28.js does the dragging).
    // a.kind 'toMeal': the first food of meal a.from to the end of meal a.to. 'reorder': the first food of
    // meal a.from to below the second one.
    dragPlan(i, a) {
      const d = begin(i); goTab('food'); closeSheet();
      const rows = qa('.f-meal[data-meal="' + a.from + '"] .f-row[data-id]');
      if (rows.length < (a.kind === 'reorder' ? 3 : 1)) return null;
      const upper = el('.f-meal[data-meal="' + Math.min(a.from, a.kind === 'reorder' ? a.from : a.to) + '"]');
      window.scrollTo(0, Math.max(0, window.scrollY + upper.getBoundingClientRect().top - 110));
      const rb = rows[0].getBoundingClientRect();
      const tb = a.kind === 'reorder' ? rows[1].getBoundingClientRect() : el('.f-meal[data-meal="' + a.to + '"] [data-action="food-add"]').getBoundingClientRect();
      const plan = { kind: a.kind, id: rows[0].dataset.id, order: dayEntries(d.key).map((e) => e.id).join(), meal: a.kind === 'reorder' ? a.from : a.to,
        from: { x: rb.left + rb.width / 2, y: rb.top + rb.height / 2 }, to: { x: tb.left + tb.width / 2, y: a.kind === 'reorder' ? tb.bottom - 4 : tb.top + tb.height / 2 }, vh: window.innerHeight };
      return plan.from.y > 80 && plan.from.y < plan.vh - 90 && plan.to.y > 80 && plan.to.y < plan.vh - 90 ? plan : null;
    },
    dragCheck(i, plan) {
      const d = begin(i); const e = dayEntries(d.key).find((x) => x.id === plan.id);
      const ok = !!e && e.meal === plan.meal && (plan.kind !== 'reorder' || dayEntries(d.key).map((x) => x.id).join() !== plan.order);
      if (ok) note(plan.kind === 'reorder' ? 'entry dragged to another spot in its meal' : 'entry dragged to another meal', { name: e.name, id: e.id, meal: plan.meal, at: e.at });
      return ok;
    }
  };
  window.SIM = SIM;
})();
