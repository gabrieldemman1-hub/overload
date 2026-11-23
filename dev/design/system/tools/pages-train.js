// Reference screens of Overload (training). Each value is the markup inside the page, as app.js should build it.
'use strict';
const L = require('./lib.js');
const { icon, esc, screen, sheetHeader, syncPill, updatePill, tbMeta, chev, listBtn, listDiv, toggleRow, numBox, seg, onOff, stat, field } = L;

const U = 'lb';
// ---- shared data ------------------------------------------------------------------
const DAY = [
  ['Incline Dumbbell Press', 'Chest', 'Dumbbell', 3, '10–12', 60, 12, true],
  ['Machine Chest Press', 'Chest', 'Machine', 3, '10–12', 150, 12],
  ['Cable Fly', 'Chest', 'Cable', 3, '10–12', 30, 11],
  ['Lat Pulldown', 'Back', 'Cable', 3, '10–12', 140, 12],
  ['Chest-Supported Row', 'Back', 'Machine', 3, '10–12', 90, 10],
  ['Seated Cable Row', 'Back', 'Cable', 4, '10–12', 130, 10],
];
const prescText = (e) => e[3] + ' × ' + e[4] + ' @ <strong>' + e[5] + ' ' + U + '</strong>' + (e[7] ? ' each' : '') + ' · goal ' + e[6];

// ---- Today -------------------------------------------------------------------------
function weekStrip(sel) {
  // [letter, date, long name, classes]
  const days = [['M', 16, 'Monday', 'past done'], ['T', 17, 'Tuesday', 'past done'], ['W', 18, 'Wednesday', 'past rest'], ['T', 19, 'Thursday', 'past done'], ['F', 20, 'Friday', 'past done'], ['S', 21, 'Saturday', 'today'], ['S', 22, 'Sunday', 'rest']];
  return '<div class="day-strip">' + days.map((d, i) => '<button class="day-chip ' + d[3] + (i === sel ? ' selected' : '') + '" data-action="select-day" data-i="' + i + '" aria-label="' + d[2] + ' ' + d[1] + (/done/.test(d[3]) ? ', trained' : /rest/.test(d[3]) ? ', rest day' : '') + '"><span class="wd">' + d[0] + '</span><span class="d">' + d[1] + '</span></button>').join('') + '</div>';
}
// The hand-over card as app.js builds it (handoverHtml). where: 'today' | 'settings'. state: 'new' (not copied yet), 'stale'
// (the log changed after the copy), 'copied' (the copy is current: Settings only, with the remove block), 'none' (nothing to hand over).
const fuelTile = (size) => '<span class="app-tile' + (size ? ' ' + size : '') + '" data-app="fuel">' + L.MARK.fuel + '</span>';
const fuelButtons = () => '<div class="btn-row mt8"><a class="btn ghost" href="fuel/" target="_blank" rel="noopener">Get Fuel' + icon('external') + '</a><button class="btn ghost" data-action="handover-link">' + icon('link') + 'Copy link</button></div>'
  + '<p class="tiny muted mt8 break more">In Safari tap Share, then Add to Home Screen. If Safari does not open, tap Copy link and paste it into Safari\'s address bar: example.github.io/overload/fuel/</p>';
function handover(where, state, cloud) {
  const today = where === 'today', title = today ? '' : '<div class="group-title">Food</div>';
  if (state === 'none') return title + '<div class="card handover"><div class="handover-head">' + fuelTile('l') + '<p class="small muted">Food is logged in a separate app, Fuel. The old food log was removed from Overload on Sat, Nov 21.</p></div>' + fuelButtons() + '</div>';
  const status = state === 'stale' ? 'The copy from Thu, Nov 19 is out of date.' : state === 'copied' ? 'Copied today · Saved as a file today.' : 'Not copied yet.';
  return title + '<div class="card handover">'
    + '<div class="handover-head">' + fuelTile('l') + '<b>Food has moved to Fuel</b>' + (today ? '<button class="icon-btn" data-action="handover-hide" aria-label="Hide this card">' + icon('close') + '</button>' : '') + '</div>'
    + '<p class="small muted mt8">The food log is now its own app, Fuel. Your log is still on this phone: 118 days, 2,304 entries, 212 saved foods, 3 saved meals (about 412 KB). Nothing is taken away until you remove it yourself.</p>'
    + (state === 'stale' ? '<div class="banner warn mt8">' + icon('warning') + '<span>The food log here changed after you copied it on Thu, Nov 19. Copy it again so Fuel gets the rest.</span></div>' : '')
    + '<ol class="steps"><li><b>Get Fuel</b>' + fuelButtons() + '</li>'
    + '<li' + (state === 'copied' ? ' class="done"' : '') + '><b>Take your food log along</b><div class="btn-row mt8"><button class="btn ghost" data-action="handover-copy">' + icon('copy') + 'Copy my food log</button><button class="btn ghost" data-action="handover-file">' + icon('export') + 'Save as a file</button></div>'
    + '<p class="small muted mt8">' + status + '</p></li>'
    + '<li><b>In Fuel, tap Paste from Overload</b><p class="small muted more">If you saved a file, tap Choose a file there instead.</p></li></ol>'
    + (cloud ? '<p class="small muted mt12">Using cloud sync? Signing in to Fuel with the same email also brings across the food log your account holds. This phone may hold more, so copy it from here as well.</p>' : '')
    + (!today && state === 'copied' ? '<div class="handover-remove"><b>When Fuel shows your food log</b><p class="small muted">You can remove the old food log from Overload. That frees about 398 KB on this phone. A safety copy is kept first, and your saved foods and targets stay.</p>'
      + '<button class="btn danger block mt8" data-action="handover-remove">' + icon('trash') + 'Remove the old food log from Overload</button></div>' : '')
    + (today ? '<p class="tiny muted mt12">This card is also in Settings, under Food.</p>' : '') + '</div>';
}
const handoverToday = '<div id="handover" data-where="today">' + handover('today', 'new') + '</div>';
const todayCard = '<div class="card flat today-card"><div class="card-head"><div><h2>Chest &amp; Back</h2><div class="meta">Saturday · 6 exercises</div></div></div>'
  + '<button class="btn block big" data-action="start-workout" data-day="d1">' + icon('play') + 'Start workout</button>'
  + '<div class="btn-row mt8"><button class="btn small ghost deload-start" data-action="start-deload" data-day="d1">Start as deload</button><button class="btn small ghost" data-action="toggle-others">Start a different day</button></div>'
  + '<div class="list mt12">' + DAY.map((e, i) => listBtn(esc(e[0]), prescText(e), 'data-action="edit-ex" data-ex="e' + i + '"')).join('') + '</div></div>';
// The markup keeps v2.8's order (title, pill, Edit); the stylesheet puts the pill on the second line.
const checkinDone = '<div class="card checkin-done"><div class="row between"><b>Morning check-in ' + icon('check', 's', '✓') + '</b><div class="row tight"><span class="pill green">Recovery 71%</span><button class="btn small ghost" data-action="checkin-edit">Edit</button></div></div>'
  + '<div class="small mt8">182.4 lb · Slept 7h 20m · REM 1h 40m (23%) · deep 1h 10m (16%) (WHOOP)</div>'
  + '<div class="tiny muted mt8">7-night average 7h 08m · REM 1h 35m · deep 1h 05m</div></div>';
const streak = '<div class="banner">' + icon('flame', '', '🔥 ') + '<span>7-day streak. Keep it going.</span></div>';
const todayTop = '<div class="screen-title"><h1>Today</h1><span class="sub">Sat, Nov 21</span></div>';
const todayRest = weekStrip(5) + todayCard + checkinDone + '<p class="muted small center mt8">Last workout: Shoulders &amp; Arms · Fri, Nov 20</p>';
const todayBody = todayTop + '<div id="today-notices"></div>' + streak + todayRest;
// The first start of 3.0: the hand-over card is on Today until it is hidden or the log was copied.
const todayHandoverBody = todayTop + '<div id="today-notices"></div>' + handoverToday + streak + todayRest;

// ---- Workout ---------------------------------------------------------------------
const rirRow = (e, i, picked, idle) => idle
  ? '<tr class="rir-row idle" aria-hidden="true"><td colspan="4"><div class="rir-pick"><span class="rir-label">Reps left</span>' + ['3+', '2', '1', '0'].map((t) => '<button class="rir-btn" tabindex="-1" disabled>' + t + '</button>').join('') + '</div></td></tr>'
  : '<tr class="rir-row"><td colspan="4"><div class="rir-pick"><span class="rir-label">Reps left</span>' + ['3+', '2', '1', '0'].map((t, k) => '<button class="rir-btn' + (k === picked ? ' on' : '') + '" aria-pressed="' + (k === picked) + '" aria-label="Set ' + (i + 1) + ': ' + t + ' reps left" data-action="pick-rir" data-e="' + e + '" data-s="' + i + '" data-v="' + (3 - k) + '">' + t + '</button>').join('') + '</div></td></tr>';
// state: 'done' | 'next' | ''. reps '' = empty box (the goal shows as the placeholder).
// goal 0 = no goal yet: the placeholder is the word "reps" and no hint is written.
const setRow = (e, i, state, w, reps, goal, dis) => '<tr class="set-row' + (state ? ' ' + state : '') + '">'
  + '<td class="n">' + (i + 1) + '</td>'
  + '<td><input class="set-input" type="number" inputmode="decimal" step="any" min="0" value="' + w + '" placeholder="' + U + '" data-field="weight" data-e="' + e + '" data-s="' + i + '" aria-label="Set ' + (i + 1) + ' weight"' + (dis ? ' disabled' : '') + '></td>'
  + '<td><input class="set-input" type="number" inputmode="numeric" min="0" value="' + reps + '" placeholder="' + (goal || 'reps') + '" data-field="reps" data-e="' + e + '" data-s="' + i + '" aria-label="Set ' + (i + 1) + ' reps"' + (dis ? ' disabled' : '') + '>' + (goal ? '<span class="set-hint">Goal</span>' : '') + '</td>'
  + '<td class="chk"><button class="check' + (state === 'done' ? ' on' : '') + '" data-action="toggle-set" data-e="' + e + '" data-s="' + i + '" aria-label="Set ' + (i + 1) + ' done" aria-pressed="' + (state === 'done') + '"' + (dis ? ' disabled' : '') + '>' + icon('check') + '</button></td></tr>';
const setTable = (rows, each) => '<table class="set-table"><thead><tr><th class="n">Set</th><th>' + U + (each ? ' (each)' : '') + '</th><th>Reps</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
const setTools = (e, warmDone) => '<div class="set-tools"><button class="btn small ghost" data-action="add-set" data-e="' + e + '">' + icon('plus') + 'Set</button><button class="btn small subtle" data-action="remove-set" data-e="' + e + '">' + icon('minus') + 'Set</button><button class="btn small subtle" data-action="gen-warmup" data-e="' + e + '"' + (warmDone ? ' disabled' : '') + '>Warm-up</button></div>'
  + '<div class="set-tools secondary"><button class="btn small subtle" data-action="swap-entry" data-e="' + e + '">' + icon('swap') + 'Swap exercise</button><button class="btn small subtle" data-action="remove-entry" data-e="' + e + '">Remove</button></div>';
const choiceRow = (label, opts, on) => '<div class="label">' + label + '</div><div class="choice-grid">' + opts.map((o, i) => '<button class="choice' + (i === on ? ' on' : '') + '" data-action="set-fb" aria-pressed="' + (i === on) + '">' + o + '</button>').join('') + '</div>';
const PUMP = ['Low / none', 'Moderate', 'Amazing'], JOINT = ['None', 'A little', 'Moderate', 'A lot'], WORK = ['Easy', 'Pretty good', 'Pushed my limits', 'Too much'];
const SORE = ['Never got sore', 'Healed a while ago', 'Healed just in time', 'Still sore'];
const feedback = (a, b, c) => '<div class="prompt mt12"><div class="prompt-q">How was it? <span class="hint">(optional, adjusts your sets)</span></div>' + choiceRow('Pump', PUMP, a) + choiceRow('Joint pain', JOINT, b) + choiceRow('Workload', WORK, c) + '</div>';
const exTarget = (w, reps) => '<div class="ex-target">' + (w ? '<span class="num">' + w + '</span><span class="u">' + U + '</span><span class="x">×</span>' : '') + '<span class="num">' + reps + '</span>' + (w ? '' : '<span class="u">reps</span>') + '</div>';
const prPill = '<span class="pill pr">' + icon('trophy') + 'PR</span>';
const folded = (e, name, sub, pr) => '<div class="card ex-card done compact" data-card="' + e + '"><button class="ex-fold" data-action="open-entry" data-e="' + e + '"><span class="ex-fold-tick">' + icon('check') + '</span>'
  + '<span class="grow"><span class="ex-fold-name">' + esc(name) + '</span><span class="ex-fold-sub">' + sub + '</span></span>' + (pr ? prPill : '') + chev() + '</button></div>';
// An open exercise card. o: { e, name, muscle, target, presc, last, note, reason, reasonCls, pr, body }
const exCard = (o) => '<div class="card ex-card' + (o.done ? ' done' : '') + '" data-card="' + o.e + '"><div class="ex-head">'
  + '<div class="row between"><div class="ex-name">' + esc(o.name) + '</div><span class="row tight">' + (o.pr ? prPill : '') + '<span class="pill">' + o.muscle + '</span></span></div>'
  + o.target + '<div class="ex-presc">' + o.presc + '</div>'
  + '<div class="ex-last">' + o.last + '</div>'
  + (o.note ? '<div class="ex-note">' + icon('note', 's') + '<span>' + esc(o.note) + '</span></div>' : '')
  + (o.prLine ? '<div class="ex-reason pr">' + icon('trophy', 's', '🏆 ') + esc(o.prLine) + '</div>' : '')
  + (o.reason ? '<div class="ex-reason' + (o.reasonCls ? ' ' + o.reasonCls : '') + '">' + esc(o.reason) + '</div>' : '')
  + '</div><div class="ex-body">' + o.body + '</div></div>';
const warmups = (e) => '<div class="warmups"><div class="row between"><span class="label">Warm-up</span><button class="btn small subtle" data-action="clear-warmup" data-e="' + e + '" aria-label="Clear warm-ups">' + icon('close', 'm') + '</button></div>'
  + [[15, 8, true], [20, 5, false], [25, 3, false]].map((w, i) => '<div class="warmup-row' + (w[2] ? ' done' : '') + '"><span class="n">W' + (i + 1) + '</span><span class="grow"><b>' + w[0] + '</b> ' + U + ' × <b>' + w[1] + '</b></span><button class="check small' + (w[2] ? ' on' : '') + '" data-action="toggle-warmup" data-e="' + e + '" data-s="' + i + '" aria-label="Warm-up ' + (i + 1) + ' done" aria-pressed="' + w[2] + '">' + icon('check') + '</button></div>').join('') + '</div>';
const cardio = (done) => '<div class="card' + (done ? ' flat' : '') + '" id="cardio-card"><div class="row between"><h3>Incline treadmill walk</h3>' + (done ? '<span class="pill green">Done</span>' : '<span class="pill">Cardio</span>') + '</div>'
  + '<div class="field-row mt8">' + [['Minutes', 20], ['Incline %', 10], ['Speed mph', 3.2]].map((f) => field(f[0], '<input class="input" type="number" inputmode="decimal" min="0" value="' + f[1] + '" data-field="cardio"' + (done ? ' disabled' : '') + '>')).join('') + '</div>'
  + '<div class="tiny muted mb8 cardio-line"><span' + (done ? ' class="off"' : '') + '>Last time: 20 min · 10% incline · 3.2 mph · ≈228 kcal</span><span id="cardio-today"' + (done ? '' : ' class="off"') + '>Today: 20 min · 10% incline · 3.2 mph · ≈228 kcal</span></div>'
  // Done is something to do (an outlined key); Logged is a recorded state (solid ink, full strength).
  + (done ? '<div class="btn-row"><button class="btn subtle" data-action="cardio-undo">Undo</button><button class="btn success" disabled>' + icon('check', '', '✓') + 'Logged</button></div>'
    : '<div class="btn-row"><button class="btn ghost" data-action="cardio-timer">Start 20:00 timer</button><button class="btn ghost" data-action="cardio-done">' + icon('check', '', '✓') + 'Done</button></div>') + '</div>';
const workoutHeadOf = (name, count, time) => '<div class="screen-title"><div><h1>' + name + '</h1><span class="sub">Sat, Nov 21<span class="sr"> · ' + count + ' done · <span id="elapsed">' + time + '</span></span></span></div><button class="btn small ghost" data-action="add-entry">' + icon('plus') + 'Exercise</button></div>'
  + '<div class="deload-bar"><button class="deload-toggle" data-action="toggle-deload" aria-pressed="false"><span class="sw"></span>Deload session</button></div>';
const workoutHead = workoutHeadOf('Chest &amp; Back', '2/6', '24m');
const sorenessFolded = '<div class="card fold-row" id="soreness-card"><b>Check-in done</b><button class="btn small ghost" data-action="soreness-edit">Edit</button></div>';
const sorenessOpen = '<div class="card" id="soreness-card"><h3 class="mb8">Check-in</h3>'
  + [['chest', 1], ['back', -1]].map((m) => '<div class="prompt"><div class="prompt-q">How sore did your <b>' + m[0] + '</b> get after last time?</div><div class="choice-grid">' + SORE.map((s, i) => '<button class="choice' + (i === m[1] ? ' on' : '') + '" data-action="set-soreness" aria-pressed="' + (i === m[1]) + '">' + s + '</button>').join('') + '</div></div>').join('') + '</div>';
const finishRow = (allTicked) => '<div class="btn-row mt12"><button class="btn danger" data-action="discard-workout">Discard</button><button class="btn' + (allTicked ? '' : ' ghost') + '" data-action="finish-workout">' + icon('flag') + 'Finish workout</button></div>';

const pressOpen = (thirdDone, fb) => exCard({ e: 1, name: 'Machine Chest Press', muscle: 'Chest', target: exTarget(150, 12), presc: '3 sets · 10–12 reps', last: 'Last time: 150×12, 150×11, 150×11', note: 'Seat 4, pin 7',
  body: setTable(setRow(1, 0, 'done', 150, 12, 12) + rirRow(1, 0, 1) + setRow(1, 1, 'done', 150, 12, 12) + rirRow(1, 1, 2)
      + (thirdDone ? setRow(1, 2, 'done', 150, 11, 12) + rirRow(1, 2, 3) : setRow(1, 2, 'next', 150, '', 12) + rirRow(1, 2, -1, true)))
    + setTools(1) + fb
    + '<button class="btn block mt12' + (thirdDone ? '' : ' ghost') + '" data-action="finish-entry" data-e="1">Finish exercise</button>' });
const flyOpen = exCard({ e: 2, name: 'Cable Fly', muscle: 'Chest', target: exTarget(30, 11), presc: '3 sets · 10–12 reps', last: 'Last time: 30×11, 30×10, 30×10', reason: 'Every set at least 10 → same weight, goal is your lowest set + 1',
  body: warmups(2) + setTable(setRow(2, 0, '', 30, '', 11) + rirRow(2, 0, -1, true) + setRow(2, 1, '', 30, '', 11) + rirRow(2, 1, -1, true) + setRow(2, 2, '', 30, '', 11) + rirRow(2, 2, -1, true))
    + setTools(2, true) + '<button class="btn block mt12 ghost" data-action="finish-entry" data-e="2" disabled>Finish exercise</button>' });
const workoutBody = workoutHead + sorenessFolded
  + folded(0, 'Incline Dumbbell Press', '3 sets · next 65 lb', true)
  + pressOpen(false, feedback(-1, -1, -1)) + flyOpen + cardio(false) + finishRow(false);

const pressDoneOpen = exCard({ e: 0, done: true, name: 'Incline Dumbbell Press', muscle: 'Chest', pr: true, target: exTarget(60, 12), presc: '3 sets · 10–12 reps · each hand', last: 'Last time: 60×12, 60×11, 60×11',
  prLine: 'Most reps at 60 lb: 12 · Best estimated 1RM: 84 lb',
  body: '<div class="next-box"><div class="label">Next time</div>' + exTarget(65, 10) + '<div class="ex-presc">3 sets · 10–12 reps · each hand</div><ul><li>Every set hit 12 → weight up one jump (5 lb), goal back to 10</li><li>Recovered on time, moderate pump, no joint pain → keep 3 sets</li></ul></div>'
    + '<div class="card-actions"><button class="btn small subtle" data-action="reopen-entry" data-e="0">Edit</button><button class="btn small subtle" data-action="close-entry" data-e="0">Hide</button></div>' });
const feedbackBody = workoutHeadOf('Chest &amp; Back', '2/6', '31m') + sorenessOpen + pressDoneOpen + pressOpen(true, feedback(1, 0, 1)) + cardio(true) + finishRow(false);
// The worst case for the top bar and the exercise head: the longest day name in programs.js, a two-hour session, both pills,
// a long exercise name with two pills, four-digit weights.
const longOpen = exCard({ e: 1, name: 'Newtech Seated Row (Outward grip, both handles)', muscle: 'Hamstrings', pr: true, target: exTarget('1012.5', 100), presc: '12 sets · 100–120 reps · each hand', last: 'Last time: 1012.5×100, 1012.5×100, 1012.5×99, 1010×100 (deload)', note: 'Seat 4, pin 7, handles on the outer holes, feet on the upper plate',
  body: setTable(setRow(1, 0, 'done', '1012.5', 100, 100) + rirRow(1, 0, 1) + setRow(1, 1, 'next', '', '', 100) + rirRow(1, 1, -1, true) + setRow(1, 2, '', '', '', 0) + rirRow(1, 2, -1, true))
    + setTools(1) + '<button class="btn block mt12 ghost" data-action="finish-entry" data-e="1">Finish exercise</button>' });
const longBody = workoutHeadOf('Legs B (hamstrings &amp; glutes)', '12/14', '1h 59m') + sorenessFolded
  + folded(0, 'Newtech Seated Row (Outward grip, both handles)', '12 sets · next 1012.5 lb', true) + longOpen + cardio(false) + finishRow(false);

// ---- History ----------------------------------------------------------------------
const vol = [['Chest', 12, 'ok'], ['Back', 13, 'ok'], ['Shoulders', 8, 'low'], ['Biceps', 6, 'low'], ['Triceps', 9, 'low'], ['Quads', 21, 'high'], ['Hamstrings', 10, 'ok'], ['Glutes', 4, 'low'], ['Calves', 6, 'low']];
const volumeCard = '<div class="card"><div class="row between mb8"><b>This week\'s sets per muscle</b><span class="pill">target 10–20</span></div>'
  + vol.map((v) => '<div class="vol-row"><span class="vol-name">' + v[0] + '</span><span class="vol-bar"><span class="vol-fill ' + v[2] + '" style="width:' + Math.min(100, Math.round(v[1] / 20 * 100)) + '%"></span></span><span class="vol-n ' + v[2] + '">' + v[1] + '</span></div>').join('')
  + '<div class="tiny muted mt8">Mon, Nov 16 to Sun, Nov 22. Amber is under target, green is in range, red is over.</div></div>';
const reviewCard = '<div class="card"><div class="row between mb8"><b>Weekly review</b><div class="seg"><button class="on" data-action="review-set" data-v="0">This week</button><button data-action="review-set" data-v="1">Last week</button></div></div>'
  + '<div class="stat-row mb8">' + stat(4, 'Workouts') + stat(76, 'Sets') + stat('62.4k', U + ' lifted') + '</div>'
  + '<ul class="review-list"><li><b>Weight went up</b> on Incline Dumbbell Press → 65 lb, Leg Press → 320 lb</li><li><b>' + icon('trophy', 's', '🏆 ') + 'PRs:</b> Incline Dumbbell Press: most reps at 60 lb (12); Hack Squat: heaviest set 195 lb × 12</li><li>Most sets: Quads 21, Back 13, Chest 12</li>'
  + '<li>Body weight avg <b>182.6 lb</b> <span class="muted">(−0.4 vs the week before)</span></li><li>Cardio <b>80 min</b></li><li>Sleep avg <b>7h 08m</b> · REM 1h 35m · deep 1h 05m · recovery 64% <span class="muted">(6 nights)</span></li></ul>'
  + '<button class="btn ghost block mt8" data-action="review-share">' + icon('share') + 'Share</button></div>';
function calendarCard() {
  // November 2026 starts on a Sunday (six fillers). Today is the 21st.
  const hit = { 2: '', 3: '', 5: '', 6: 'pr', 9: '', 10: '', 12: 'deload', 13: 'deload', 16: '', 17: 'pr', 19: '', 20: '' }, rest = [1, 4, 8, 11, 15, 18, 22, 25, 29];
  let cells = ''; for (let i = 0; i < 6; i++) cells += '<span class="cal-cell empty"></span>';
  for (let d = 1; d <= 30; d++) {
    const cls = ['cal-cell', d in hit ? 'hit ' + hit[d] : '', d === 21 ? 'today' : '', d > 21 ? 'future' : '', rest.includes(d) && !(d in hit) ? 'rest' : '', d >= 21 && !rest.includes(d) && !(d in hit) ? 'plan' : ''].filter(Boolean).join(' ');
    cells += d in hit ? '<button class="' + cls + '" data-action="view-workout" data-w="w' + d + '" aria-label="November ' + d + ': workout' + (hit[d] === 'pr' ? ', PR' : hit[d] === 'deload' ? ', deload' : '') + '">' + d + '</button>' : '<span class="' + cls + '">' + d + '</span>';
  }
  return '<div class="card cal-card"><div class="row between mb8"><button class="icon-btn" data-action="cal-prev" aria-label="Previous month">' + icon('chevron-left') + '</button><b>November 2026</b><button class="icon-btn" data-action="cal-next" aria-label="Next month" disabled>' + icon('chevron-right') + '</button></div>'
    + '<div class="cal-grid">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => '<span class="cal-head">' + d + '</span>').join('') + cells + '</div>'
    + '<div class="cal-legend"><span><i class="cal-key hit"></i>Trained</span><span><i class="cal-key deload"></i>Deload</span><span><i class="cal-key plan"></i>Planned</span><span><i class="cal-key pr"></i>PR that day</span></div>'
    + '<div class="tiny muted mt8">12 training days this month.</div></div>';
}
const progPts = [140, 140, 142.5, 142.5, 145, 145, 130, 145, 147.5, 147.5, 150, 150].map((w, i) => ({ w, deload: i === 6, label: 'Session ' + (i + 1) + ': ' + w + ' lb' }));
const progressCard = '<div class="card">' + field('Progress', '<select class="select" data-field="chart-ex"><option>Machine Chest Press</option></select>')
  + L.chartProgress(progPts, 'Sep 5', 'Nov 14')
  + '<div class="legend"><span><i class="swatch now"></i>Latest</span><span><i class="swatch ring"></i>Deload (off the line)</span></div>'
  + '<div class="stat-row mt8">' + stat(150, 'Current top set') + stat('150×12', 'Best set') + stat(12, 'Sessions') + '</div>'
  + '<div class="review-list mt8 small"><div>' + icon('trophy', 's', '🏆 ') + 'Heaviest: <b>150 × 12</b> on Sat, Nov 14</div><div>Est. 1RM: <b>210 lb</b> from 150 × 12</div><div>4 PR sessions logged</div></div>'
  + '<div class="group-title">Recent sessions</div>'
  + [['Sat, Nov 14', '150×12, 150×11, 150×11', true], ['Sat, Nov 7', '150×11, 150×10, 150×10'], ['Sat, Oct 31', '147.5×12, 147.5×12, 147.5×12', true], ['Sat, Oct 24', '147.5×12, 147.5×11, 147.5×10'], ['Sat, Oct 17', '130×10, 130×10', false, true]].map((s) => '<div class="hist-set"><span>' + s[0] + (s[2] ? ' ' + icon('trophy', 's', '🏆') : '') + (s[3] ? ' <span class="pill amber">Deload</span>' : '') + '</span><span><b>' + s[1] + '</b></span></div>').join('') + '</div>';
const bw = []; for (let i = 0; i < 60; i++) bw.push(Math.round((185.4 - i * 0.045 + Math.sin(i * 1.7) * 0.7 + Math.cos(i * 0.6) * 0.5) * 10) / 10);
const bwCard = '<div class="card"><div class="row between mb8"><b>Body weight</b><span class="pill">96 weigh-ins</span></div>' + L.chartWeight(bw, 'Sep 23', 'Nov 21')
  + '<div class="legend"><span><i class="swatch dot"></i>Weigh-in</span><span><i class="swatch line"></i>Running average</span></div>'
  + '<div class="stat-row mt8">' + stat('182.4', 'Latest') + stat('182.6', '7-entry avg') + stat('−1.8', '30-day change') + '</div>'
  + '<div class="tiny muted mt8">Dots are weigh-ins, the line is the running average. lb.</div><button class="btn subtle small mt8" data-action="bw-list">Edit weigh-ins</button></div>';
const nights = [432, 405, 458, 0, 471, 420, 395, 440, 468, 412, 450, 0, 427, 440].map((t, i) => (t ? { total: t, rem: Math.round(t * (0.2 + (i % 3) * 0.02)), deep: Math.round(t * (0.14 + (i % 4) * 0.012)) } : null));
const sleepCard = '<div class="card"><div class="row between mb8"><b>Sleep</b><button class="btn small ghost" data-action="sleep-list">101 nights</button></div>' + L.chartSleep(nights, 'Nov 8')
  + '<div class="legend"><span><i class="sl-key sl-deep"></i>Deep</span><span><i class="sl-key sl-rem"></i>REM</span><span><i class="sl-key sl-other"></i>Light / other</span></div>'
  + '<div class="stat-row mt8">' + stat('7h 08m', '7-night avg (+12 min)') + stat('1h 35m', 'REM avg') + stat('1h 05m', 'Deep avg') + '</div>'
  + '<div class="small mt8">Recovery avg <b>64%</b> · resting HR 52 · HRV 61 ms <span class="muted">(7 nights)</span></div></div>';
// A workout row's second line: each fact is one piece that does not break inside; the pieces wrap as wholes.
// The glyphs v2.8 wrote stay as the icons' text alternatives, so the line reads the same to assistive tech and to the tests.
const wline = (date, n, sets, dur, o) => { o = o || {}; const parts = [date, n + ' exercises', sets + ' sets', dur]
  .concat(o.cardio ? [icon('heart', 's', '🚶') + ' ' + o.cardio + ' min'] : []).concat(o.ups ? ['<span class="ok-ink">' + o.ups + ' weight ' + icon('arrow-up', 's', '↑') + '</span>'] : []).concat(o.prs ? [icon('trophy', 's', '🏆') + ' ' + o.prs] : []);
  return parts.map((x, i) => '<span class="nowrap">' + x + (i < parts.length - 1 ? ' ·' : '') + '</span>').join(' '); };
const workouts = [['Shoulders &amp; Arms', wline('Fri, Nov 20', 7, 24, '1h 12m', { cardio: 20 })], ['Legs', wline('Thu, Nov 19', 6, 21, '1h 05m', { cardio: 20, ups: 1, prs: 1 })],
  ['Shoulders &amp; Arms', wline('Tue, Nov 17', 7, 24, '1h 09m', { ups: 2, prs: 1 })], ['Legs', wline('Mon, Nov 16', 6, 21, '58m')],
  ['Chest &amp; Back', wline('Sat, Nov 14', 6, 19, '1h 02m', { cardio: 20, prs: 2 })], ['Legs <span class="pill amber">Deload</span>', wline('Fri, Nov 13', 6, 11, '36m')]];
const historyBody = '<div class="screen-title"><h1>History</h1></div>'
  + '<div class="stat-row mb8">' + stat(icon('flame', 'm', '🔥 ') + '7', 'Day streak') + stat(12, 'This month') + stat(70, 'Workouts') + '</div>'
  + volumeCard + reviewCard + calendarCard() + progressCard + bwCard + sleepCard
  + '<div class="group-title">Workouts</div><div class="list">' + workouts.map((w, i) => listBtn(w[0], w[1], 'data-action="view-workout" data-w="w' + i + '"', '<span class="chev">' + icon('chevron-right', 'm', '›') + '</span>')).join('') + '</div>';

// ---- Program ----------------------------------------------------------------------
const PDAYS = [['Chest &amp; Back', 'Sat · 6 exercises', 'Incline Dumbbell Press, Machine Chest Press, Cable Fly, Lat Pulldown, Chest-Supported Row, Seated Cable Row'],
  ['Legs', 'Mon · Thu · 6 exercises', 'Hack Squat, Hip Thrust, Seated Leg Curl, Leg Extension, Seated Calf Raise, Cable Crunch'],
  ['Shoulders &amp; Arms', 'Tue · Fri · 7 exercises', 'Machine Shoulder Press, Cable Lateral Raise, Reverse Pec Deck, EZ-Bar Curl, Incline Dumbbell Curl, Rope Pushdown, Overhead Cable Extension']];
const sched = [['Monday', 1], ['Tuesday', 2], ['Wednesday', -1], ['Thursday', 1], ['Friday', 2], ['Saturday', 0], ['Sunday', -1]];
const LIB = [['Chris Bumstead: 5-day split', 'Chris Bumstead · 5 days a week'], ['Push/Pull/Legs (CBum)', 'Chris Bumstead · 6 days a week'], ['FST-7 classic 5-day', 'Hany Rambod · 5 days a week'], ['Push/Pull/Legs, 6 days (RP-style)', 'Renaissance Periodization method · 6 days a week'], ['Arm specialization (RP)', 'Renaissance Periodization · 5 days a week']];
const programBody = '<div class="screen-title"><h1>Program</h1><span class="sub">3 days · 5 a week</span><button class="btn small" data-action="add-day">' + icon('plus') + 'Day</button></div>'
  + PDAYS.map((d, i) => '<div class="card"><div class="card-head"><div><h2>' + d[0] + '</h2><div class="meta">' + d[1] + '</div></div><button class="btn small ghost" data-action="edit-day" data-day="d' + i + '">Edit</button></div><div class="small muted">' + d[2] + '</div></div>').join('')
  + '<div class="group-title">Weekly schedule</div><div class="card">' + sched.map((s, i) => '<div class="toggle-row"><span>' + s[0] + '</span><select class="select" data-field="schedule" data-i="' + i + '"><option value="">Rest</option>' + PDAYS.map((d, k) => '<option' + (k === s[1] ? ' selected' : '') + '>' + d[0] + '</option>').join('') + '</select></div>').join('') + '</div>'
  + '<div class="group-title">Program library</div><div class="list">' + LIB.map((p, i) => listBtn(esc(p[0]), esc(p[1]), 'data-action="program-view" data-p="p' + i + '"')).join('') + '</div>'
  + '<div class="group-title">Templates</div><div class="card"><p class="small muted mb8">Save this split so you can switch to another one later without rebuilding it. Weights and set counts live on the exercises, so they carry over.</p>'
  + '<div class="list">' + listDiv('My program (before Push/<wbr>Pull/<wbr>Legs, 6 Days (RP-style)) · Sat, Nov 7', '3 days · saved Sat, Nov 7', '<button class="btn small ghost" data-action="use-template">Use</button><button class="icon-btn danger" data-action="delete-template" aria-label="Delete template">' + icon('trash') + '</button>') + '</div>'
  + '<button class="btn ghost block mt12" data-action="save-template">Save current program as template</button></div>';

// ---- Exercises ---------------------------------------------------------------------
const EX = { Chest: [['Cable Fly', '3 × goal 11 @ 30 lb'], ['Incline Dumbbell Press', '3 × goal 12 @ 60 lb'], ['Machine Chest Press', '3 × goal 12 @ 150 lb'], ['Pec Deck (FST-7)', 'Machine']],
  Back: [['Chest-Supported Row', '3 × goal 10 @ 90 lb'], ['Lat Pulldown', '3 × goal 12 @ 140 lb'], ['Newtech Seated Row (Outward grip)', 'Machine · custom'], ['Seated Cable Row', '4 × goal 10 @ 130 lb']],
  Shoulders: [['Cable Lateral Raise', '4 × goal 14 @ 15 lb'], ['Machine Shoulder Press', '3 × goal 11 @ 95 lb'], ['Reverse Pec Deck', '3 × goal 12 @ 85 lb']] };
const exercisesBody = '<div class="screen-title"><h1>Exercises</h1><span class="sub">42 exercises · 11 muscles</span><button class="btn small" data-action="new-ex">' + icon('plus') + 'New</button></div>'
  + '<div class="search">' + icon('search') + '<input class="input" type="search" placeholder="Search" value="" data-field="search" aria-label="Search exercises"></div>'
  + Object.keys(EX).map((m) => '<div class="group-title">' + m + '</div><div class="list">' + EX[m].map((e, i) => listBtn(esc(e[0]), e[1], 'data-action="edit-ex" data-ex="' + m + i + '"')).join('') + '</div>').join('');

// ---- Settings ----------------------------------------------------------------------
const handoverSettings = '<div id="handover" data-where="settings">' + handover('settings', 'copied', true) + '</div>';
const n90 = (v, k) => numBox(v, 'data-field="setting" data-k="' + k + '"'), pair = (a, b) => '<div class="row tight">' + numBox(a, '', 'n2') + '<span class="muted">–</span>' + numBox(b, '', 'n2') + '</div>';
const settingsMain = '<div class="card">'
  + toggleRow('Appearance', 'System follows your phone', seg(['System', 'Dark', 'Light'], 1))
  + toggleRow('Weight jump: barbell', 'Also cable-free moves and anything else. Per exercise override in Exercises', n90(2.5, 'increment'))
  + toggleRow('Weight jump: dumbbell', 'Per hand. Most racks go up in 5s', n90(5, 'incDumbbell'))
  + toggleRow('Weight jump: machine', 'Stack pin or plate-loaded', n90(5, 'incMachine'))
  + toggleRow('Weight jump: cable', 'Cable stack', n90(5, 'incCable'))
  + toggleRow('Rep range', 'Hit the top on every set → weight goes up', pair(10, 12))
  + toggleRow('Rest timer', 'Seconds, starts when you check a set', n90(120, 'restSec'))
  + toggleRow('Starting sets', 'For new exercises', n90(3, 'defaultSets'))
  + toggleRow('Max sets', 'Feedback never pushes past this', n90(6, 'maxSets'))
  + toggleRow('Reps in reserve', 'After you tick a set, tap how many reps you had left (3+, 2, 1, 0). 3+ on every set moves weight up early', onOff(true, 'set-rir'))
  + toggleRow('Warm-up rest', 'Seconds between warm-up sets', n90(60, 'warmupRest'))
  + toggleRow('Weekly sets target', 'Per muscle, for the volume chart', pair(10, 20))
  + toggleRow('Weigh-in reminder', 'How often the Today screen asks for your body weight', '<select class="select" data-field="setting" data-k="weighEvery"><option>Every day</option></select>')
  + toggleRow('Sleep', 'Time asleep, REM and deep in the morning check-in', onOff(false, 'set-sleep')) + '</div>';
const cardioSettings = '<div class="group-title">Cardio</div><div class="card">' + toggleRow('Cardio after lifting', 'Adds a cardio card with a timer to the end of every workout', onOff(true, 'set-cardio'))
  + '<div class="toggle-row"><div><div>What</div></div><input class="input" value="Incline treadmill walk" data-field="cardio-name"></div>' + toggleRow('Minutes', '', n90(20, 'cardioMin')) + '</div>';
const whoopCard = '<div class="group-title">WHOOP</div><div class="card"><div class="row between"><div><b>Connected</b> · Alex<div class="tiny muted">Last sync Nov 21, 6:42 AM</div></div><span class="pill green">WHOOP</span></div>'
  + '<p class="tiny muted mt8">Time asleep, REM, deep and recovery fill in each morning. Nights you typed yourself keep your numbers.</p>'
  + '<div class="btn-row mt8"><button class="btn ghost" data-action="conn-whoop-sync">' + icon('sync') + 'Sync now</button><button class="btn subtle" data-action="conn-whoop-disconnect">Disconnect</button></div></div>';
const remRow = (label, desc, time, on) => '<div class="toggle-row stack"><div><div>' + label + '</div><div class="small muted">' + desc + '</div></div><div class="row between tight"><input class="input" type="time" value="' + time + '" data-field="conn-time"' + (on ? '' : ' disabled') + '>' + onOff(on) + '</div></div>';
const remindersCard = '<div class="group-title">Reminders</div><div class="card">' + remRow('Morning check-in', 'Weight and sleep, if not logged yet', '07:30', true) + remRow('Workout', 'On training days, if you have not started', '17:00', false)
  + '<div class="btn-row mt8"><button class="btn ghost" data-action="conn-push-test">' + icon('bell') + 'Send a test</button><button class="btn subtle" data-action="conn-push-off">Turn off here</button></div></div>';
const copyRow = (t, s, b) => listDiv(t, s, '<button class="btn small ghost">' + b + '</button>', 'copy-row');
const backupCard = (app) => '<div class="group-title">Backup</div><div class="card"><p class="small muted mb8">Export a copy now and then. With cloud sync off, this phone is the only place your data lives.</p>'
  + '<div class="btn-row backup-btns"><button class="btn ghost" data-action="export">' + icon('export') + 'Export JSON</button><button class="btn ghost" data-action="import">' + icon('import') + 'Import JSON</button></div>'
  + '<p class="small muted mt8" id="last-export">Last export: 9 days ago.</p>'
  + '<div class="toggle-row"><div><div>Storage used</div><div class="small muted">' + (app === 'fuel' ? '412,880' : '1,204,310') + ' of about 4,500,000 characters the app can safely use. Today warns at 70%.</div><span class="vol-bar store-bar"><span class="vol-fill ok" style="width:' + (app === 'fuel' ? 9 : 27) + '%"></span></span></div><span class="vol-n ok">' + (app === 'fuel' ? 9 : 27) + '%</span></div>'
  + '<div class="mt12"><b>Automatic copies</b></div><p class="small muted mb8">Kept on this phone: one a day for the last 7 days, and one taken before each import, reset, restore or cloud sign-in.</p>'
  + '<div id="safety-copies"><div class="list">' + (app === 'fuel'
    ? copyRow('Sat, Nov 21', '118 food days · Jul 26 – Nov 21', 'Restore') + copyRow('Fri, Nov 20', '117 food days · Jul 26 – Nov 20', 'Restore') + copyRow('Before import · Thu, Nov 19, 8:14 PM', 'Empty', 'Restore')
    : copyRow('Sat, Nov 21', '70 workouts · Jul 26 – Nov 20 · 118 food days', 'Restore') + copyRow('Fri, Nov 20', '69 workouts · Jul 26 – Nov 19 · 117 food days', 'Restore') + copyRow('Before the split · Sat, Nov 21, 7:02 AM', '70 workouts · Jul 26 – Nov 20 · 118 food days', 'Restore')) + '</div></div></div>';
const cloudCard = (state) => '<div id="cloud-card"><div class="group-title">Cloud sync</div><div class="card">' + (state === 'in'
  ? '<div class="toggle-row"><div><div>Signed in</div><div class="small muted">alex@example.com</div></div><span class="pill synced" id="cloud-status">Synced just now</span></div>'
    + '<p class="small muted mt8">Every change is mirrored to your account. Offline changes are queued and sent when you are back online.</p>'
    + '<div class="btn-row mt12"><button class="btn ghost" data-action="cloud-push">' + icon('sync') + 'Sync now</button><button class="btn subtle" data-action="cloud-signout">Sign out</button></div>'
  : '<p class="small muted mb8">Sign in to keep your data in the cloud so it survives clearing this phone and follows you to a new one. First time here? Enter an email and password and tap Create account.</p>'
    + '<form id="cloud-form">' + field('Email', '<input class="input" name="email" type="email" autocomplete="username" inputmode="email" value="alex@example.com" required>') + field('Password', '<input class="input error" name="password" type="password" autocomplete="current-password" value="12345" required aria-invalid="true">')
    + '<div id="cloud-msg" class="small mb8">Wrong password. Try again or tap Forgot password.</div>'
    + '<div class="btn-row"><button class="btn" type="submit">Sign in</button><button class="btn ghost" type="button" data-action="cloud-signup">Create account</button></div>'
    + '<button class="btn subtle block mt8" type="button" data-action="cloud-reset">Forgot password</button></form>') + '</div></div>';
const dangerZone = '<div class="group-title">Danger zone</div><div class="card"><button class="btn danger block" data-action="reset">' + icon('trash') + 'Reset all data</button></div>';
const settingsBody = '<div class="screen-title"><h1>Settings</h1></div>' + settingsMain + cardioSettings + whoopCard + remindersCard + handoverSettings + backupCard('overload') + cloudCard('in') + dangerZone + '<p class="version">Overload · v3.0</p>';

// ---- Sheets -------------------------------------------------------------------------
const sel = (opts, on) => '<select class="select">' + opts.map((o) => '<option' + (o === on ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>';
const nf = (label, v, ph) => field(label, '<input class="input" type="number" inputmode="decimal" step="any" min="0" value="' + v + '"' + (ph != null ? ' placeholder="' + ph + '"' : '') + '>');
const sheetExercise = sheetHeader('Edit exercise')
  + '<form id="ex-form" data-ex="e1">' + field('Name', '<input class="input" name="name" required value="Machine Chest Press" placeholder="e.g. Incline Dumbbell Press">')
  + '<div class="field-row">' + field('Muscle', sel(['Chest', 'Back', 'Shoulders'], 'Chest')) + field('Equipment', sel(['Barbell', 'Dumbbell', 'Machine', 'Cable'], 'Machine')) + '</div>'
  + field('Notes', '<input class="input" name="notes" value="Seat 4, pin 7" placeholder="Seat 4, handles high, pin at 7…">')
  + '<div class="group-title">Current prescription</div><div class="field-row">' + nf('Weight (lb)', 150) + nf('Sets', 3) + nf('Goal reps', 12) + '</div>'
  + '<div class="group-title">Overrides <span class="muted">(blank = use settings)</span></div><div class="field-row">' + nf('Weight jump', '', 5) + nf('Rep min', '', 10) + nf('Rep max', '', 12) + '</div>'
  + '<div class="field-row">' + nf('Rest (seconds)', '', 120) + nf('Fixed sets', '', 'auto') + '<div class="field"></div></div>'
  + '<button class="btn danger block" type="button" data-action="delete-ex" data-ex="e1">' + icon('trash') + 'Delete exercise</button>'
  + '<div class="sheet-foot"><button class="btn block" type="submit">Save</button></div></form>';
const PICK = { Chest: [['Dumbbell Bench Press', 'Dumbbell'], ['Incline Machine Press', 'Machine'], ['Pec Deck', 'Machine'], ['Smith Machine Incline Press', 'Barbell']], Shoulders: [['Cable Lateral Raise', 'Cable'], ['Machine Shoulder Press', 'Machine']] };
const sheetPicker = sheetHeader('Swap exercise', '<button class="btn small ghost" data-action="pick-new-ex">New</button>')
  + '<div class="search">' + icon('search') + '<input class="input" type="search" placeholder="Search" value="" data-field="pick-search" aria-label="Search exercises"></div>'
  + Object.keys(PICK).map((m) => '<div class="group-title">' + m + '</div><div class="list">' + PICK[m].map((e, i) => listBtn(esc(e[0]), e[1], 'data-action="pick-ex-choose" data-ex="p' + i + '"', '<span class="chev">' + icon('plus', 'm') + '</span>')).join('') + '</div>').join('');
const sheetWorkout = sheetHeader('Legs') + '<p class="small muted mb8">Thu, Nov 19 · 1h 05m · Quads: Healed just in time · Hamstrings: Never got sore</p>'
  + '<div class="card flat"><div class="row between"><b>Hack Squat</b><span class="pill">Quads</span></div><div class="hist-set"><span>Warm-up</span><span>95×8, 135×5, 165×3</span></div>'
  + [12, 12, 11, 10].map((r, i) => '<div class="hist-set"><span>Set ' + (i + 1) + '</span><span><b>195</b> lb × <b>' + r + '</b> <span class="muted">· ' + Math.max(0, 2 - i) + ' RIR</span></span></div>').join('')
  + '<div class="pr-line">' + icon('trophy', 's') + '<span>Heaviest set: 195 lb × 12</span></div><div class="tiny muted mt8">Pump: Amazing · Joints: None · Workload: Pretty good</div><div class="tiny muted mt8">Some sets hit 12 → same weight, push every set to 12</div></div>'
  + '<div class="card flat"><div class="row between"><b>Incline treadmill walk</b><span class="pill">Cardio</span></div><div class="hist-set"><span>20 min · 10% incline · 3.2 mph · ≈228 kcal</span></div></div>'
  + '<div class="btn-row mt8"><button class="btn ghost" data-action="edit-workout">' + icon('edit') + 'Edit sets</button><button class="btn danger" data-action="delete-workout">Delete workout</button></div>';

// The program sheet (app.js 1128-1146). The week is seven plain pills: a day that has a workout is not "live", so no accent.
const WEEK = [['Mon', 'Back'], ['Tue', 'Chest & Biceps'], ['Wed', null], ['Thu', 'Shoulders & Triceps'], ['Fri', 'Legs'], ['Sat', 'Arms'], ['Sun', null]];
const sheetProgram = sheetHeader('Arm specialization (RP)') + '<p class="small muted mb8">Renaissance Periodization. Arms twice a week with the rest of the body at maintenance volume.</p>'
  + '<div class="row wrap mb8">' + WEEK.map((d) => '<span class="pill' + (d[1] ? ' solid' : '') + '">' + d[0] + ' ' + (d[1] ? esc(d[1]) : 'Rest') + '</span>').join(' ') + '</div>'
  + '<div class="card flat small">Add a set to an arm exercise when the pump was low and you recovered early; hold everything else where it is.</div>'
  + [['Back', [['Lat Pulldown', 3, '10–12'], ['Chest-Supported Row', 3, '10–12'], ['Straight-Arm Pulldown', 2, '12–15', true]]], ['Chest & Biceps', [['Incline Dumbbell Press', 3, '8–12'], ['Pec Deck (FST-7)', 7, '10–12', false, true], ['EZ-Bar Curl', 4, '8–12']]]]
    .map((d) => '<div class="card flat"><b>' + esc(d[0]) + '</b>' + d[1].map((e) => '<div class="hist-set"><span>' + esc(e[0]) + (e[3] ? ' <span class="pill">new</span>' : '') + '</span><span class="nowrap">' + (e[4] ? '<span class="pill amber">FST-7</span> ' : '') + e[1] + ' × ' + e[2] + '</span></div>').join('') + '</div>').join('')
  + '<p class="tiny muted mt8">Sets × reps as the program writes them. Exercises marked <b>new</b> are added to your list. Your weights stay.</p>'
  + '<button class="btn block mt12" data-action="program-use" data-p="p4">Use this program</button>';

const base = { app: 'overload' };
const workoutBar = { ...base, active: 'today', title: 'Chest & Back', right: tbMeta('2/6', '24m'), meter: { n: 19, done: 5 } };
module.exports = {
  bits: { weekStrip, todayCard, checkinDone, exCard, exTarget, setTable, setRow, rirRow, setTools, choiceRow, feedback, folded, warmups, cardio, sorenessOpen, sorenessFolded, finishRow, volumeCard, calendarCard, backupCard, cloudCard, handover, fuelTile, whoopCard, remindersCard, PUMP, JOINT, WORK, SORE, prPill, sheetWorkout, dangerZone, streak, WEEK },
  pages: {
    'train-today': { title: 'Overload: Today', body: screen({ ...base, active: 'today', title: 'Today', right: syncPill('synced'), body: todayBody }) },
    'train-today-handover': { title: 'Overload: Today on the first start of 3.0, with the hand-over card', body: screen({ ...base, active: 'today', title: 'Today', right: syncPill('synced'), body: todayHandoverBody }) },
    'train-workout': { title: 'Overload: workout in progress', scroll: 176, body: screen({ ...workoutBar, body: workoutBody, dock: { label: 'Rest', next: 'Set 3 of 3 next', time: '1:24', of: '2:00', pct: 70 } }) },
    'train-workout-long': { title: 'Overload: workout, the worst case for the top bar (long name, two hours, both pills)', body: screen({ ...base, active: 'today', title: 'Legs B (hamstrings & glutes)', right: tbMeta('12/14', '1h 59m') + updatePill() + syncPill('error'), meter: { n: 64, done: 49 }, body: longBody, dock: { label: 'Rest', next: 'Next: Newtech Seated Row (Outward grip)', time: '12:24', of: '20:00', pct: 62 } }) },
    'train-feedback': { title: 'Overload: a finished exercise with what comes next time, and the feedback questions', scroll: 470, body: screen({ ...base, active: 'today', title: 'Chest & Back', right: tbMeta('2/6', '31m'), meter: { n: 19, done: 6 }, body: feedbackBody }) },
    'train-history': { title: 'Overload: History', body: screen({ ...base, active: 'history', title: 'History', right: syncPill('synced'), body: historyBody }) },
    'train-program': { title: 'Overload: Program', body: screen({ ...base, active: 'program', title: 'Program', right: syncPill('synced'), body: programBody }) },
    'train-exercises': { title: 'Overload: Exercises', body: screen({ ...base, active: 'exercises', title: 'Exercises', right: syncPill('synced'), body: exercisesBody }) },
    'train-settings': { title: 'Overload: Settings', body: screen({ ...base, active: 'settings', title: 'Settings', right: syncPill('synced'), body: settingsBody }) },
    'train-sheets': { title: 'Overload: Edit exercise sheet', body: screen({ ...base, active: 'today', title: 'Today', right: syncPill('synced'), body: todayBody, sheet: sheetExercise }) },
    // Resting, a sheet open and a toast at once: an everyday state in the gym.
    'train-sheets-swap': { title: 'Overload: Swap exercise sheet, while resting, with a toast', scroll: 176, body: screen({ ...workoutBar, body: workoutBody, dock: { label: 'Rest', next: 'Set 3 of 3 next', time: '1:24', of: '2:00', pct: 70 }, sheet: sheetPicker, toast: 'Enter the weight first' }) },
    'train-sheets-workout': { title: 'Overload: workout detail sheet', body: screen({ ...base, active: 'history', title: 'History', right: syncPill('synced'), body: historyBody, sheet: sheetWorkout, toast: 'Saved · Hack Squat next time: 200 lb' }) },
    'train-sheets-program': { title: 'Overload: program sheet', body: screen({ ...base, active: 'program', title: 'Program', right: syncPill('synced'), body: programBody, sheet: sheetProgram }) },
  },
};
