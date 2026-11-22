// Reference screens shared by both apps: states (banners, pills, toast, empty and error states), the
// unreadable-data screen, and the components page (every component in every state).
'use strict';
const L = require('./lib.js');
const T = require('./pages-train.js').bits;
const F = require('./pages-fuel.js').bits;
const { icon, screen, sheetHeader, syncPill, updatePill, tbMeta, chev, listBtn, listDiv, toggleRow, numBox, seg, onOff, stat, field } = L;

const h = (t) => '<div class="ref-h">' + t + '</div>', n = (t) => '<div class="ref-n">' + t + '</div>';

// ---- states -----------------------------------------------------------------------------
const saveWarning = '<div class="banner danger"><b>The app\'s storage is full.</b> Your latest changes are not saved on this phone and are lost if the app closes. Export a backup now. Freeing space on the phone does not help: this limit belongs to the app.<div class="btn-row mt8"><button class="btn" data-action="export">' + icon('export') + 'Export backup</button></div></div>';
const errorCard = '<div class="card mt16"><p><b>This screen could not be shown.</b> Your saved data has not changed. Export a backup to keep it safe, then try another tab.</p><p class="small muted mt8">Cannot read properties of undefined (reading \'sets\')</p><div class="btn-row mt12"><button class="btn" data-action="export">' + icon('export') + 'Export backup</button></div></div>';
const noticeStorage = '<div class="notice">' + icon('warning') + '<span>Storage is 74% full. Export a backup now so nothing is lost.</span><button class="btn small" data-action="export">Export</button></div>';
const noticeBackup = '<div class="notice">' + icon('warning') + '<span>Last backup 16 days ago, and cloud sync is off.</span><button class="btn small" data-action="export">Export</button><button class="icon-btn" data-action="export-nag-off" aria-label="Remind me in two weeks">' + icon('close', 'm') + '</button></div>';
const redRecovery = '<div class="banner warn">' + icon('warning') + '<span>Recovery 31% (red). Train, but hold the weights and skip extra sets today.</span></div>';
const restDay = '<div class="card"><div class="empty">' + icon('moon') + '<b>Rest day</b>Nothing scheduled. Start any day below if you feel like lifting.</div></div>';
const statesBody = '<div class="screen-title"><h1>Today</h1><span class="sub">Sat, Nov 21</span></div>'
  + '<div id="today-notices">' + noticeBackup + '</div>' + redRecovery
  + h('Notices on Today (one at a time in the app)') + noticeStorage
  + h('Banners') + T.streak
  + '<div class="banner ok">' + icon('check') + '<span>Brought across: 118 days, 2,304 entries, 212 saved foods.</span></div>'
  + '<div class="banner warn">' + icon('warning') + '<span>This barcode is not in the list yet. Type it in once from the label and it is remembered.</span></div>'
  + '<div class="banner warn">' + icon('cloud-off') + '<span>You are offline. Changes are kept on this phone and sent when you are back.</span></div>'
  + h('A screen that could not be drawn') + errorCard
  + h('Empty states') + restDay
  + '<div class="list"><div class="empty">' + icon('dumbbell') + '<b>No workouts yet</b>Finish one and it shows up here.</div></div>'
  + '<div class="empty">No matches</div><div class="empty">Loading…</div>'
  + '<div class="card"><div class="empty small">No workouts logged for this week.</div><button class="btn ghost block mt8" disabled>' + icon('share') + 'Share</button></div>'
  + h('Cloud sync is still loading') + '<div class="card"><p class="small muted">Cloud sync is loading. If this never changes, the sync module could not load (offline, or sync.js is missing).</p></div>'
  + h('Start-up note (reads with no stylesheet: keeps its inline style)') + '<div id="boot-note" class="empty" style="padding:24px 8px;line-height:1.5;font-family:-apple-system,system-ui,sans-serif">Overload is still starting. The signal is weak, so this can take a while. Everything you logged is still on this phone.</div>';
const unreadableBody = '<div class="screen-title"><h1>Your data</h1></div>'
  + '<div class="card"><p><b>Overload could not read the data saved on this phone.</b></p><p class="small muted mt8">Nothing has been changed or deleted. The app will not save over it. Export the copy as it is, then try again or restore an automatic copy.</p>'
  + '<div class="btn-row mt12"><button class="btn" data-action="export-raw">' + icon('export') + 'Export the unreadable copy</button><button class="btn ghost" data-action="retry">Try again</button></div></div>'
  + '<div id="restore-section"><div class="group-title">Restore an automatic copy</div><div class="card"><div id="safety-copies"><div class="list">'
  + listDiv('Fri, Nov 20', '69 workouts · Jul 26 – Nov 19 · 117 food days', '<button class="btn small ghost">Restore</button>', 'copy-row') + listDiv('Thu, Nov 19', '68 workouts · Jul 26 – Nov 17 · 116 food days', '<button class="btn small ghost">Restore</button>', 'copy-row')
  + listDiv('Before import · Sat, Nov 7, 9:12 PM', '61 workouts · Jul 26 – Nov 6 · 104 food days', '<button class="btn small ghost">Restore</button>', 'copy-row') + '</div></div></div></div>'
  + '<div class="group-title">Start fresh</div><div class="card"><p class="small muted mb8">Only if nothing above works. The unreadable copy is kept as an automatic copy first.</p><button class="btn danger block" data-action="start-fresh">' + icon('trash') + 'Start fresh</button></div>';

// ---- components ---------------------------------------------------------------------------
const btns = h('Buttons')
  + n('.btn (primary) · .btn.ghost (secondary) · .btn.subtle (quiet) · .btn.danger · .btn.success (a recorded state, never an action; full strength although disabled) · .btn.text')
  + '<div class="row wrap"><button class="btn">Save</button><button class="btn ghost">Sync now</button><button class="btn subtle">Cancel</button></div>'
  + '<div class="row wrap mt8"><button class="btn danger">' + icon('trash') + 'Delete</button><button class="btn success" disabled>' + icon('check') + 'Logged</button><button class="btn text">Start fresh</button></div>'
  + n('States: pressed (.is-pressed mirrors :active) · disabled · busy (.busy or aria-busy)')
  + '<div class="row wrap"><button class="btn is-pressed">Pressed</button><button class="btn" disabled>Disabled</button><button class="btn busy">Saving</button></div>'
  + '<div class="row wrap mt8"><button class="btn ghost is-pressed">Pressed</button><button class="btn ghost" disabled>Disabled</button><button class="btn ghost" aria-busy="true">Syncing</button></div>'
  + n('.small (44 px) · default (48 px) · .big (56 px) · .block')
  + '<div class="row wrap"><button class="btn small">' + icon('plus') + 'Day</button><button class="btn small ghost">Edit</button><button class="btn small subtle">' + icon('chevron-left') + 'Back</button><button class="btn small danger">Delete meal</button></div>'
  + '<button class="btn block big mt8">' + icon('play') + 'Start workout</button><button class="btn ghost block mt8">Save current program as template</button>'
  + n('.btn-row: equal widths while the labels fit on one line; otherwise the row breaks and each button takes a line')
  + '<div class="btn-row"><button class="btn ghost">' + icon('export') + 'Export JSON</button><button class="btn ghost">' + icon('import') + 'Import JSON</button></div>'
  + '<div class="btn-row mt8"><button class="btn ghost small">Scan barcode</button><button class="btn ghost small">Quick add</button><button class="btn ghost small">New food</button></div>'
  + '<div class="btn-row mt8"><button class="btn">' + icon('export') + 'Export the unreadable copy</button><button class="btn ghost">Try again</button></div>'
  + n('.btn.block with a long label: it runs to a second line, centred, the icon with the first word')
  + '<div data-audit="wrap-ok"><button class="btn danger block">' + icon('trash') + 'Remove the old food log from Overload and keep a safety copy</button></div>'
  + n('.icon-btn · .icon-btn.key · .icon-btn.danger · disabled · pressed')
  + '<div class="row wrap"><button class="icon-btn" aria-label="Close">' + icon('close') + '</button><button class="icon-btn" aria-label="More">' + icon('more') + '</button><button class="icon-btn key" aria-label="Scan">' + icon('barcode') + '</button><button class="icon-btn danger" aria-label="Delete">' + icon('trash') + '</button><button class="icon-btn" aria-label="Next" disabled>' + icon('chevron-right') + '</button><button class="icon-btn is-pressed" aria-label="Up">' + icon('arrow-up') + '</button><button class="icon-btn" aria-label="Favorite">' + icon('star') + '</button><button class="icon-btn f-star on" aria-label="Favorite" aria-pressed="true">' + icon('star-filled') + '</button></div>';
const pills = h('Pills and tags')
  + '<div class="row wrap"><span class="pill">Chest</span><span class="pill">target 10–20</span><span class="pill solid">Mon Back</span><span class="pill">Wed Rest</span>' + T.prPill + '<span class="pill green">Recovery 71%</span><span class="pill amber">Weigh-in due</span><span class="pill amber">Deload</span><span class="pill red">Recovery 31%</span><span class="pill solid">Done</span></div>'
  + n('.pill.accent is only for the one live thing in the top bar: Update ready. Beside it the cloud pill in its four states (synced, syncing, offline, error). 44 px targets.')
  + '<div class="topbar-right">' + updatePill() + syncPill('synced') + syncPill('syncing') + syncPill('offline') + syncPill('error') + '</div>'
  + n('During a workout the top bar shows exercises done and the time; Update ready is then only its icon (the screen train-workout-long)') + '<div class="topbar-right">' + tbMeta('2/6', '24m') + '</div>';
const forms = h('Inputs')
  + field('Name', '<input class="input" value="Machine Chest Press">') + field('Notes (placeholder)', '<input class="input" placeholder="Seat 4, handles high, pin at 7…">')
  + '<div class="field-row">' + field('Focus (.is-focus mirrors :focus)', '<input class="input is-focus" value="150">') + field('Error', '<input class="input error" value="12345">') + '</div><div class="form-msg">Wrong password. Try again or tap Forgot password.</div>'
  + '<div class="field-row">' + field('Disabled', '<input class="input" value="20" disabled>') + field('Select', '<select class="select"><option>Machine</option></select>') + '</div>'
  + n('Search: .search wraps the icon and the input') + '<div class="search">' + icon('search') + '<input class="input" type="search" placeholder="Search foods"></div>'
  + n('Number boxes: .input.num (88 px) · .input.num.n2 (64 px) · a pair · .input-unit · time')
  + '<div class="row wrap">' + numBox(2.5) + numBox(12, '', 'n2') + '<div class="row tight">' + numBox(10, '', 'n2') + '<span class="muted">–</span>' + numBox(12, '', 'n2') + '</div></div>'
  + '<div class="row wrap mt8"><label class="input-unit"><input class="input num" type="number" value="120" aria-label="Rest"><span class="u">s</span></label><label class="input-unit"><input class="input num" type="number" value="182.4" aria-label="Body weight"><span class="u">lb</span></label><input class="input" type="time" value="07:30" aria-label="Time"></div>'
  + n('Stepper · .stepper.big')
  + '<div class="stepper"><button aria-label="Less">' + icon('minus') + '</button><input class="val" type="number" value="3" aria-label="Sets"><button aria-label="More">' + icon('plus') + '</button></div> '
  + '<div class="stepper"><button aria-label="Less" disabled>' + icon('minus') + '</button><input class="val" type="number" value="1" aria-label="Sets"><button aria-label="More">' + icon('plus') + '</button></div>'
  + '<div class="stepper big mt8"><button aria-label="Less">' + icon('minus') + '</button><input class="val" type="number" value="250" aria-label="Amount"><button aria-label="More">' + icon('plus') + '</button></div>'
  + n('Segmented control: the chosen position is solid ink; in an On / Off pair a picked Off is a neutral key. .seg · .seg.block · .seg.f-mealseg')
  + '<div class="row wrap">' + seg(['System', 'Dark', 'Light'], 1) + onOff(true) + onOff(false) + '</div><div class="mt8">' + seg(['This week', 'Last week'], 0, 'block') + '</div><div class="mt8">' + F.mealSeg(2) + '</div>'
  + n('Switch (may replace an On / Off segment): off · on · disabled')
  + '<div class="row"><button class="switch" role="switch" aria-checked="false" aria-label="Sleep"></button><button class="switch on" role="switch" aria-checked="true" aria-label="Sleep"></button><button class="switch" role="switch" aria-checked="false" aria-label="Sleep" disabled></button></div>'
  + n('Rows: .toggle-row (label and description left, one control right) · .toggle-row.stack')
  + '<div class="card">' + toggleRow('Rest timer', 'Seconds, starts when you check a set', numBox(120)) + toggleRow('Reps in reserve', 'After you tick a set, tap how many reps you had left', onOff(true)) + toggleRow('Weigh-in reminder', 'How often Today asks for your body weight', '<select class="select"><option>Every day</option></select>') + toggleRow('Sleep', '', '<button class="switch on" role="switch" aria-checked="true" aria-label="Sleep"></button>') + '</div>';
const notices = h('Notices and banners')
  + T.streak + '<div class="banner ok">' + icon('check') + '<span>Brought across: 118 days, 2,304 entries.</span></div>' + redRecovery
  + noticeBackup
  + n('Save warning (.save-warning > .banner.danger), pinned under the top bar in the app') + '<div class="save-warning ref-static">' + saveWarning + '</div>'
  + n('Toast (always at the top of the screen, over the top bar)') + '<div class="toast ref-static">Logged 182.4 lb · 7h 20m sleep</div>';
const meters = h('Meters and bars')
  + n('.meter (tick meter): accent · .ink · .ok · .warn · .bad') + '<div class="meter" style="--v:62%"></div><div class="meter ink mt8" style="--v:40%"></div><div class="meter ok mt8" style="--v:80%"></div><div class="meter warn mt8" style="--v:30%"></div><div class="meter bad mt8" style="--v:100%"></div>'
  + n('.topbar-meter: one block per set (5 of 19)') + '<div class="topbar-meter" style="--n:19"><span style="width:26.3%"></span></div>'
  + n('.vol-row: low · ok · high; the storage meter uses the same bar') + [['Chest', 12, 'ok'], ['Shoulders', 8, 'low'], ['Quads', 21, 'high']].map((v) => '<div class="vol-row"><span class="vol-name">' + v[0] + '</span><span class="vol-bar"><span class="vol-fill ' + v[2] + '" style="width:' + Math.min(100, v[1] * 5) + '%"></span></span><span class="vol-n ' + v[2] + '">' + v[1] + '</span></div>').join('');
const structure = h('Cards, sections, rows')
  + '<div class="card"><div class="card-head"><div><h2>Legs</h2><div class="meta">Mon · Thu · 6 exercises</div></div><button class="btn small ghost">Edit</button></div><div class="small muted">Hack Squat, Hip Thrust, Seated Leg Curl, Leg Extension, Seated Calf Raise, Cable Crunch</div></div>'
  + '<div class="card flat"><div class="row between"><b>.card.flat</b><span class="pill">Quads</span></div><p class="small muted mt8">Transparent: a hairline frame inside a sheet or a card.</p></div>'
  + '<div class="group-title">Program library</div><div class="list">' + listBtn('Push/Pull/Legs, 6 days (RP-style)', 'Renaissance Periodization method · 6 days a week') + listDiv('Legs', '6 exercises · not on the schedule', '<button class="btn small ghost">Start</button>') + listDiv('182.4 lb', 'Sat, Nov 21', '<button class="icon-btn danger" aria-label="Delete">' + icon('trash') + '</button>') + '</div>'
  + n('.stat-row: key above value (the markup stays value, then key)') + '<div class="stat-row">' + stat(icon('flame', 'm', '🔥 ') + '7', 'Day streak') + stat(12, 'This month') + stat('62.4k', 'lb lifted') + '</div>'
  + n('.table') + '<table class="table"><thead><tr><th>Per logged day</th><th class="r">This week</th><th class="r">Last week</th></tr></thead><tbody><tr><td>' + F.mk('p') + 'Protein<span class="of"> / 190 g</span></td><td class="r">184</td><td class="r prev">178</td></tr><tr><td>Days logged</td><td class="r">5<span class="of">of 6</span></td><td class="r prev">6<span class="of">of 7</span></td></tr></tbody></table>'
  + n('.empty (icon and bold line are optional)') + '<div class="empty">' + icon('dumbbell') + '<b>No workouts yet</b>Finish one and it shows up here.</div>'
  + n('.steps') + '<ol class="steps"><li class="done"><b>Get Fuel.</b> Open it in Safari and add it to your Home Screen.</li><li><b>Copy your food log.</b></li><li>In Fuel, choose <b>Paste from Overload</b>.</li></ol>';
const textarea = n('A box for several lines: textarea.input') + '<textarea class="input" rows="3" placeholder="OVERLOAD-FOOD:…"></textarea>';
const cal = h('Week strip and calendar')
  + n('Trained = solid cell · planned = outline · today = accent ring · rest and past = bare · selected = raised with an ink bar')
  + T.weekStrip(5) + T.calendarCard();
const pts = [140, 142.5, 145, 130, 147.5, 150].map((w, i) => ({ w, deload: i === 3, label: '' }));
const charts = h('Charts')
  + n('.line · .pt · .pt.now · .pt.deload · .grid · .lbl') + L.chartProgress(pts, 'Sep 5', 'Nov 14')
  + n('.bar · .bar.over · .bar.now · .bar.none · .target · .target-lbl') + L.chartTrend(F.tdays, 2600)
  + '<div class="legend"><span><i class="swatch"></i>Logged</span><span><i class="swatch over"></i>Over target</span><span><i class="swatch now"></i>Today so far</span><span><i class="swatch line"></i>Average</span><span><i class="swatch dot"></i>Weigh-in</span><span><i class="swatch ring"></i>Deload</span><span><i class="swatch dash"></i>Target</span><span><i class="swatch s1"></i>Deep</span><span><i class="swatch s2"></i>REM</span><span><i class="swatch s3"></i>Light</span></div>'
  + n('.delta') + '<div class="row"><span class="delta up">+5 lb</span><span class="delta down">−0.4</span><span class="delta">0</span></div>';
const workout = h('Workout (Overload)')
  + n('Set rows: done · next · pending · and reps in reserve: picked, open, idle')
  + T.exCard({ e: 9, name: 'Newtech Seated Row (Outward grip)', muscle: 'Back', pr: true, target: T.exTarget(102.5, 10), presc: '4 sets · 8–12 reps', last: 'Last time (deload): 90×10, 90×10', note: 'Seat 4, pin 7, chest pad two holes out', reason: 'A lot of joint pain → this is already the lightest step, so the weight stays. Consider swapping this exercise', reasonCls: 'warn',
    body: T.warmups(9) + T.setTable(T.setRow(9, 0, 'done', 102.5, 10, 10) + T.rirRow(9, 0, 1) + T.setRow(9, 1, 'done', 102.5, 9, 10) + T.rirRow(9, 1, -1) + T.setRow(9, 2, 'next', 102.5, '', 10) + T.rirRow(9, 2, -1, true) + T.setRow(9, 3, '', '', '', 10) + T.rirRow(9, 3, -1, true)) + T.setTools(9, true)
      + T.feedback(1, 3, 2) + '<button class="btn block mt12 ghost" data-action="finish-entry">Finish exercise</button>' })
  + n('No weight (bodyweight): the target is the reps') + T.exCard({ e: 8, name: 'Pull-Up', muscle: 'Back', target: T.exTarget(0, 9), presc: '3 sets · bodyweight', last: 'First time logging this', reason: 'Every set hit 12 → weight up one jump (+5 lb)', reasonCls: 'green', body: T.setTable(T.setRow(8, 0, 'next', '', '', 9)) })
  + n('Finished: folded, and a finished set table (inputs disabled)') + T.folded(7, 'Chest-Supported Row', '3 sets · next goal 11 reps', false) + T.folded(6, 'Incline Dumbbell Press', '3 sets · next 65 lb', true)
  + '<div class="card ex-card done"><div class="ex-body">' + T.setTable(T.setRow(5, 0, 'done', 60, 12, 12, true) + T.setRow(5, 1, 'done', 60, 12, 12, true)) + '</div></div>'
  + n('Check-in: open, and folded') + T.sorenessOpen + T.sorenessFolded
  + n('Deload switch: off · on with its hint') + '<div class="deload-bar"><button class="deload-toggle" aria-pressed="false"><span class="sw"></span>Deload session</button></div>'
  + '<div class="deload-bar"><button class="deload-toggle on" aria-pressed="true"><span class="sw"></span>Deload session</button><div class="small deload-hint">Deload: keep your weights (or a little lighter), do about half the sets, stop 3 or more reps short.</div></div>'
  + n('Cardio: before and after Done (same height)') + T.cardio(false) + T.cardio(true)
  + n('Finish row: neutral until every set is ticked, then the accent') + T.finishRow(false) + T.finishRow(true)
  + n('Rest dock (pinned above the tab bar in the app): rest, and cardio') + '<div class="ref-static rest-timer">' + L.restDock({ label: 'Rest', next: 'Set 3 of 3 next', time: '1:24', of: '2:00', pct: 70 }).replace(/^<div id="rest-timer" class="rest-timer">\n/, '').replace(/<\/div>$/, '') + '</div>'
  + '<div class="ref-static rest-timer">' + L.restDock({ label: 'Cardio', next: 'Incline treadmill walk', time: '18:42', of: '20:00', pct: 93 }).replace(/^<div id="rest-timer" class="rest-timer">\n/, '').replace(/<\/div>$/, '') + '</div>'
  + n('Hand-over card in Settings: not copied yet (with the line for cloud sync users)') + T.handover('settings', 'new', true)
  + n('The log changed after the copy') + T.handover('settings', 'stale')
  + n('Copied: step 2 is done and the remove block shows') + T.handover('settings', 'copied')
  + n('Nothing to hand over, or the old log was removed') + T.handover('settings', 'none')
  + n('On Today (#handover[data-where="today"]): the same markup, drawn short') + '<div id="handover" data-where="today">' + T.handover('today', 'stale') + '</div>'
  + n('Program sheet: the week as pills (a training day is solid, a rest day plain)') + '<div class="row wrap">' + T.WEEK.map((d) => '<span class="pill' + (d[1] ? ' solid' : '') + '">' + d[0] + ' ' + (d[1] || 'Rest') + '</span>').join(' ') + '</div>';
const fuel = h('Food (Fuel)')
  + n('Summary: under target · a little over (up to 5%: the words say so, no alarm) · more than 5% over · no target') + F.summary(1322, 2600, F.MACROS) + F.summary(2690, 2600, [['Protein', 196, 190], ['Carbs', 283, 280], ['Fat', 81, 80]]) + F.summary(2812, 2600, [['Protein', 171, 190], ['Carbs', 302, 280], ['Fat', 96, 80]]) + F.summary(1322, 0, [['Protein', 1203, 0], ['Carbs', 113, 0], ['Fat', 34, 0]])
  + n('Macro marks anywhere: .mk.p · .mk.c · .mk.f') + '<p>' + F.mk('p') + 'Protein &nbsp; ' + F.mk('c') + 'Carbs &nbsp; ' + F.mk('f') + 'Fat</p>'
  + n('Meal with rows; a lifted row and the drop line while dragging; the drop target') + F.meal(0, 'Breakfast', [['Kodiak Power Waffles', '2 waffles (76 g) · Kodiak', 190], ['Chicken, broilers or fryers, rotisserie, original seasoning, breast, meat and skin, cooked', '1 medium (7" to 7-7/8" long) (118 g) · Kirkland Signature', 215]])
  + '<div class="card f-meal f-drop-target" data-meal="1"><div class="f-meal-head"><h2>Lunch</h2><div class="row"><span class="muted small">330 kcal</span><button class="icon-btn f-more" aria-label="Lunch options">' + icon('more') + '</button></div></div>'
  + '<button class="f-row f-lifted" data-id="x1"><div class="grow"><div class="title">Chicken breast, cooked (roasted)</div><div class="sub">200 g</div></div><div class="f-rk">330</div></button><div class="f-drop-line"></div>'
  + '<button class="btn subtle small block mt8">' + icon('plus') + 'Add food</button></div>'
  + n('The copy that follows the finger (.f-ghost)') + '<div class="f-row f-ghost ref-static"><div class="grow"><div class="title">Chicken breast, cooked (roasted)</div><div class="sub">200 g</div></div><div class="f-rk">330</div></div>'
  + n('Added strip: empty · filled') + F.addedLine('') + '<div class="mt8">' + F.addedLine('Greek yogurt, nonfat, plain · Kodiak Power Waffles (Breakfast)') + '</div>'
  + n('Quick rows (one tap logs): idle · just logged; result row; saved meal row') + F.quickRow('q1', 'Fairlife milk, 2%', '1 cup (240 ml) · Fairlife', 120, true) + F.quickRow('q2', 'Greek yogurt, nonfat, plain', '170 g · Chobani', 100, true, true) + F.resultRow('Chicken breast, raw', '120 kcal / 100 g · P 22.5 C 0 F 2.6') + F.mealRow('Post-workout shake', '2 foods · 310 kcal')
  + n('Meal menu rows (.f-menu, .f-danger)') + '<div class="f-menu"><button class="f-row"><div class="grow"><div class="title">Copy yesterday’s Breakfast</div><div class="sub">3 foods · 525 kcal</div></div></button><button class="f-row"><div class="grow"><div class="title">Save as a meal</div><div class="sub">Log these 3 again in one tap</div></div></button><button class="f-row"><div class="grow"><div class="title f-danger">Clear Breakfast</div></div></button></div>'
  + n('Scanner view') + '<div class="f-scanview"><div class="guide"></div></div><p id="scan-status" class="small muted center mt8">Camera access is off. Allow it in Settings › Safari › Camera, or scan a photo.</p>'
  + n('Ways in (Welcome, the import sheet): .list > .list-item.choice-card · .first') + '<div class="list">' + F.choice('fuel-paste', F.tile('overload', 'l'), 'Paste from Overload', 'In Overload, tap Copy my food log. Then tap here.', true) + F.choice('fuel-file', F.lead('file'), 'Choose a file', 'The food file or a backup saved from Overload.') + '</div>'
  + n('App tiles: .app-tile · .l · .xl, with data-app') + '<div class="row wrap">' + F.tile('overload') + F.tile('fuel') + F.tile('overload', 'l') + F.tile('fuel', 'l') + F.tile('overload', 'xl') + F.tile('fuel', 'xl') + '</div>';
const type = h('Type and numbers')
  + '<h1>Head 22 / 700: sheet title</h1><h2 class="mt8">Title 17 / 700: card title</h2><p class="mt8">Body 15: rows and sentences. <b>Bold is ink.</b> <span class="dim">Secondary is ink-2.</span> <span class="muted">Captions are ink-3.</span></p>'
  + '<p class="small mt8">Small 13: secondary lines, field labels.</p><p class="tiny muted">Tiny 12: footnotes.</p><div class="label mt8">Label 11: capitals, the floor</div>'
  + '<div class="row base mt12"><span class="num n-hero">1,278</span><span class="num n-big">1:24</span><span class="num">150<span class="u">lb</span></span></div>'
  + n('Focus ring (keyboard): 2 px accent ink, 2 px off the control') + '<div class="row wrap"><button class="btn ghost" style="outline:2px solid var(--accent-ink);outline-offset:2px">Focused</button><span class="muted small">(the one inline style on this page: a stand-in for :focus-visible)</span></div>';
const sheetParts = h('Sheet parts')
  + '<div class="sheet-panel ref-static">' + sheetHeader('Add to Breakfast · Thu, Nov 19', '<button class="btn subtle small">' + icon('chevron-left') + 'Back</button>') + '<p class="small muted">Header: title, optional buttons, close. The panel scrolls as a whole; .sheet-foot sticks to its bottom.</p><div class="sheet-foot"><button class="btn block">Add to Breakfast</button></div></div>';
const iconNames = Object.keys(require('../../../../shared/icons.js').icons);
const iconSheet = h('Icons (shared/icons.js): ' + iconNames.length + ' drawings') + '<div class="row wrap">' + iconNames.filter((x) => !/^mark-/.test(x)).map((x) => '<span class="icon-btn" title="' + x + '">' + icon(x) + '</span>').join('') + '</div>'
  + n('Sizes: .l 32 · default 24 · .m 20 · .s 16') + '<div class="row">' + icon('trophy', 'l') + icon('trophy') + icon('trophy', 'm') + icon('trophy', 's') + '</div>';
const componentsBody = '<div class="screen-title"><h1>Components</h1><span class="sub">Every component, every state. ?theme=light and ?app=fuel switch the tokens.</span></div>'
  + type + btns + pills + forms + textarea + notices + meters + structure + cal + charts + workout + fuel + sheetParts + iconSheet;

module.exports = { pages: {
  'states': { title: 'States: banners, pills, toast, empty and error states', bodyClass: 'has-save-warning', body: '<style>:root{--save-warning-h:190px}</style>' + screen({ active: 'today', title: 'Today', right: updatePill() + syncPill('error'), warn: saveWarning, body: statesBody, toast: 'Not saved on this phone. Export a backup.' }) },
  'states-unreadable': { title: 'States: the data on this phone cannot be read', body: screen({ active: '', title: 'Your data', body: unreadableBody }) },
  'components': { title: 'Components', bothCss: true, body: screen({ active: 'settings', title: 'Components', right: syncPill('synced'), body: componentsBody }) },
} };
