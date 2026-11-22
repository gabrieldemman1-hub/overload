// Reference screens of Fuel (diet). Each value is the markup inside the page, as fuel.js / food.js should build it.
'use strict';
const L = require('./lib.js');
const T = require('./pages-train.js').bits;
const { icon, esc, screen, sheetHeader, syncPill, updatePill, chev, toggleRow, numBox, seg, stat, field } = L;
const k = (n) => n.toLocaleString('en-US');

// ---- Today ---------------------------------------------------------------------------
const dayNav = (label, last) => '<div class="f-daynav"><button class="icon-btn" data-action="food-day" data-d="-1" aria-label="Previous day">' + icon('chevron-left') + '</button>'
  + '<button class="f-daylabel" data-action="food-day" data-d="0">' + label + '</button>'
  + '<button class="icon-btn" data-action="food-day" data-d="1" aria-label="Next day"' + (last ? ' disabled' : '') + '>' + icon('chevron-right') + '</button></div>';
const macroCell = (label, v, target, over) => '<div class="f-macro' + (over ? ' over' : '') + '"><div class="k">' + label + '</div><div class="v">' + v + '<span class="muted">' + (target ? ' / ' + target : '') + ' g</span></div>'
  + '<div class="f-bar"><span class="' + (over ? 'over' : 'm') + '" style="width:' + (target ? Math.min(100, v / target * 100).toFixed(1) : 0) + '%"></span></div></div>';
// The summary card. eaten, target (0 = none), macros [[label, v, target]].
// First the v2.8 read-out, kept in the page but hidden from view (.f-kcal.sr): assistive tech and the tests read
// "1,322 / 2,600 kcal" and "1,278 left" from it, and .f-big is still calories eaten. Then the gauge.
function summary(eaten, target, macros) {
  const has = target > 0, left = target - eaten, over = has && left < 0, far = has && eaten > target * 1.05;   // far: the app's 5% rule, the one that colours
  const p = has ? Math.min(100, eaten / target * 100) : 0;
  const old = has ? '<div class="f-kcal sr"><div><span class="f-big">' + k(eaten) + '</span><span class="muted"> / ' + k(target) + ' kcal</span></div><div class="f-left ' + (left < 0 ? 'over' : '') + '">' + (left >= 0 ? k(left) + ' left' : k(-left) + ' over') + '</div></div>'
    : '<div class="f-kcal sr"><div><span class="f-big">' + k(eaten) + '</span><span class="muted"> kcal</span></div></div>';
  const g = L.gauge(p, !has ? 'none' : far ? 'over' : '')
    + '  <div class="gauge-read" aria-hidden="true"><div class="label">' + (!has ? 'kcal eaten' : over ? (far ? icon('warning', 's') : '') + 'kcal over' : 'kcal left') + '</div><div class="gauge-num">' + k(!has ? eaten : Math.abs(left)) + '</div></div>\n</div>\n'
    + '<div class="gauge-foot">' + (has ? '<span aria-hidden="true"><b>' + k(eaten) + '</b> eaten</span><button class="gauge-target" data-action="food-targets" aria-label="Target ' + k(target) + ' kcal. Change targets">of <b>' + k(target) + '</b>' + icon('chevron-right', 's') + '</button>'
      : '<span>No calorie target</span><button class="gauge-target" data-action="food-targets">Set target' + icon('chevron-right', 's') + '</button>') + '</div>';
  return '<div class="card f-sum">' + old + '\n' + g + '\n<div class="f-macros">' + macros.map((m) => macroCell(m[0], m[1], m[2], m[2] && m[1] > m[2] * 1.05)).join('') + '</div></div>';
}
const foodRow = (id, name, sub, kcal) => '<button class="f-row" data-action="food-edit" data-id="' + id + '"><div class="grow"><div class="title">' + esc(name) + '</div><div class="sub">' + esc(sub) + '</div></div><div class="f-rk">' + k(kcal) + '</div></button>';
const meal = (mi, name, items) => '<div class="card f-meal" data-meal="' + mi + '"><div class="f-meal-head"><h2>' + name + '</h2><div class="row"><span class="muted small">' + (items.length ? k(items.reduce((n, e) => n + e[2], 0)) + ' kcal' : '') + '</span>'
  + '<button class="icon-btn f-more" data-action="food-meal-menu" data-meal="' + mi + '" aria-label="' + name + ' options">' + icon('more') + '</button></div></div>'
  + items.map((e, i) => foodRow('m' + mi + i, e[0], e[1], e[2])).join('')
  + '<button class="btn subtle small block mt8" data-action="food-add" data-meal="' + mi + '">' + icon('plus') + 'Add food</button></div>';
const MEALS = [
  ['Breakfast', [['Kodiak Power Waffles', '2 waffles (76 g) · Kodiak', 190], ['Eggs, large', '3 eggs (150 g)', 215], ['Fairlife milk, 2%', '1 cup (240 ml) · Fairlife', 120]]],
  ['Lunch', [['Chicken breast, cooked (roasted)', '200 g', 330], ['Rice, white, cooked', '250 g', 325], ['Avocado', '1/2 avocado (75 g)', 120]]],
  ['Dinner', []],
  ['Snacks', [['Greek yogurt, nonfat, plain', '170 g · Chobani', 100]]],
];
const todayBody = (eaten, target, macros) => '<div class="screen-title"><h1>Food</h1></div>' + dayNav('Today', true) + summary(eaten, target, macros)
  + MEALS.map((m, i) => meal(i, m[0], m[1])).join('') + '<p class="tiny muted center mt16">Hold a food, then drag it to another meal.</p>';
const MACROS = [['Protein', 133, 190], ['Carbs', 113, 280], ['Fat', 34, 80]];

// ---- Add sheet -----------------------------------------------------------------------
const star = '<span class="f-favmark">' + icon('star-filled') + '</span> ';
const quickRow = (id, name, sub, kcal, fav, done) => '<div class="f-row f-qrow"><button class="f-qpick" data-action="food-pick" data-src="mine" data-id="' + id + '"><div class="grow"><div class="title">' + (fav ? star : '') + esc(name) + '</div><div class="sub">' + esc(sub) + '</div></div></button>'
  + '<div class="f-rk">' + k(kcal) + '</div><button class="icon-btn f-plus" data-action="food-plus" data-id="' + id + '" aria-label="Add ' + esc(sub.split(' · ')[0] + ' ' + name) + '"' + (done ? ' disabled' : '') + '>' + icon(done ? 'check' : 'plus') + '</button></div>';
const mealRow = (name, sub) => '<button class="f-row" data-action="food-sm-open"><div class="grow"><div class="title">' + esc(name) + '</div><div class="sub">' + sub + '</div></div>' + chev() + '</button>';
const resultRow = (name, sub, fav) => '<button class="f-row" data-action="food-pick"><div class="grow"><div class="title">' + (fav ? star : '') + esc(name) + '</div><div class="sub">' + sub + '</div></div>' + chev() + '</button>';
const addedLine = (names) => names ? '<div class="f-added"><div class="grow small"><b>Added:</b> ' + names + '</div><button class="btn small" data-action="sheet-close">Done</button></div>' : '<div class="f-added none"><div class="grow small muted">Foods you add show here.</div></div>';
const addTop = (title, added, q) => sheetHeader(title) + '<div id="food-added">' + addedLine(added) + '</div>'
  + '<div class="f-searchrow"><div class="search">' + icon('search') + '<input class="input" type="search" data-field="food-search" placeholder="Search foods" autocomplete="off" autocorrect="off" enterkeyhint="search" value="' + (q || '') + '" aria-label="Search foods"></div>'
  + '<button class="icon-btn f-scanbtn" data-action="food-scan" aria-label="Scan a barcode">' + icon('barcode') + '</button></div>'
  + '<div class="btn-row mt8 f-addbtns"><button class="btn ghost small" data-action="food-scan">Scan barcode</button><button class="btn ghost small" data-action="food-quick">Quick add</button><button class="btn ghost small" data-action="food-new">New food</button></div>';
const sheetAdd = addTop('Add to Snacks', 'Greek yogurt, nonfat, plain')
  + '<div id="food-results" class="mt12"><div class="group-title first">Saved meals</div>' + mealRow('Post-workout shake', '2 foods · 310 kcal')
  + '<div class="group-title">Favorites</div>' + quickRow('f1', 'Greek yogurt, nonfat, plain', '170 g · Chobani', 100, true, true) + quickRow('f2', 'Fairlife milk, 2%', '1 cup (240 ml) · Fairlife', 120, true) + quickRow('f3', 'Kodiak Power Waffles', '2 waffles (76 g) · Kodiak', 190, true)
  + '<div class="group-title">Recent</div>' + quickRow('r1', 'Chicken breast, cooked (roasted)', '200 g', 330) + quickRow('r2', 'Rice, white, cooked', '250 g', 325) + quickRow('r3', 'Banana', '1 medium (7" to 7-7/8" long) (118 g)', 105) + quickRow('r4', 'Almonds, dry roasted, without salt added', '28 g', 170) + '</div>';
const sheetSearch = addTop('Add to Dinner', '', 'chicken breast')
  + '<div id="food-results" class="mt12"><div class="group-title first">Your foods</div>' + resultRow('Chicken breast, cooked (roasted)', '165 kcal / 100 g · P 31 C 0 F 3.6', true)
  + '<div class="group-title">Common foods</div>' + resultRow('Chicken breast, raw', '120 kcal / 100 g · P 22.5 C 0 F 2.6') + resultRow('Chicken, broilers or fryers, rotisserie, original seasoning, breast, meat and skin, cooked', '175 kcal / 100 g · P 26.4 C 0 F 7.7')
  + resultRow('Chicken breast tenders, breaded, uncooked', '263 kcal / 100 g · P 14.7 C 15 F 15.8')
  + '<div class="group-title">Brands and packaged foods</div><p class="small muted mb8">You are offline. Brand search needs a connection.</p><button class="btn ghost block" data-action="food-online">Search brands for “chicken breast”</button></div>';

// ---- Amount sheet ----------------------------------------------------------------------
const mealSeg = (on) => '<div class="seg f-mealseg">' + ['Breakfast', 'Lunch', 'Dinner', 'Snacks'].map((m, i) => '<button class="' + (i === on ? 'on' : '') + '" data-action="food-meal" data-i="' + i + '">' + m + '</button>').join('') + '</div>';
const sheetAmount = sheetHeader('Add food', '<button class="btn subtle small" data-action="food-back">' + icon('chevron-left') + 'Back</button><button class="icon-btn f-star on" data-action="food-fav" aria-label="Favorite" aria-pressed="true">' + icon('star-filled') + '</button>')
  + '<div class="f-food-name">Rice, white, cooked</div><div class="small muted mb8">USDA</div>'
  + '<div class="f-amount"><input class="input" type="number" inputmode="decimal" step="any" min="0" data-field="food-qty" value="250" aria-label="Amount"><select class="select" data-field="food-unit" aria-label="Unit"><option>g</option><option>oz</option><option>1 cup (158 g)</option></select></div>'
  + '<div id="food-preview" class="f-preview mt12"><div class="stat-row">' + stat('325', 'kcal') + stat('6.7<span class="u">g</span>', 'Protein') + stat('70.5<span class="u">g</span>', 'Carbs') + stat('0.7<span class="u">g</span>', 'Fat') + '</div></div>'
  + '<div class="field mt12"><label>Meal</label>' + mealSeg(2) + '</div>'
  + '<div class="sheet-foot"><button class="btn block" data-action="food-save">Add to Dinner</button></div>';
const sheetScan = sheetHeader('Scan barcode', '<button class="btn subtle small" data-action="food-back">' + icon('chevron-left') + 'Back</button>')
  + '<div class="f-scanview"><video id="scan-video" playsinline muted></video><div class="guide"></div></div>'
  + '<p id="scan-status" class="small muted center mt8">Hold the barcode inside the box.</p>'
  + '<div class="btn-row mt8"><label class="btn ghost small" for="scan-photo">' + icon('camera') + 'Scan a photo</label><button class="btn ghost small" data-action="food-type-code">Type the number</button></div>'
  + '<input type="file" id="scan-photo" data-field="food-photo" accept="image/*" capture="environment" hidden>';
const targetRows = '<div id="food-target-rows">' + [['Calories', 'kcal a day', 2600], ['Protein', 'grams a day', 190], ['Carbs', 'grams a day', 280], ['Fat', 'grams a day', 80]].map((r) => toggleRow(r[0], r[1], '<input class="input num" type="number" inputmode="numeric" min="0" placeholder="–" value="' + r[2] + '" data-field="food-target">')).join('')
  + '<div class="f-target-note"><p class="small muted mt8">Protein, carbs and fat add up to 2,600 kcal, in line with your 2,600 kcal target.</p><p class="small muted mt8">Protein: 130 to 180 g a day suits your 182.4 lb (0.7 to 1 g per lb).</p></div></div>';

// ---- Trends ----------------------------------------------------------------------------
// The structure is renderTrends in fuel/fuel.js (a card with the average and the chart, a card with the table).
const letters = ['S', 'S', 'M', 'T', 'W', 'T', 'F', 'S', 'S', 'M', 'T', 'W', 'T', 'F', 'S'];
const kc = [2480, 2710, 2390, 2560, 2610, 2450, 2880, 2520, null, 2590, 2440, 2630, 2570, 1322];
const tdays = kc.map((v, i) => ({ kcal: v, letter: letters[i + 1], today: i === kc.length - 1, label: 'Nov ' + (8 + i), date: '2026-11-' + String(8 + i).padStart(2, '0') }));
const mk = (c) => '<i class="mk ' + c + '"></i>';
const trow = (key, label, a, b) => '<tr data-k="' + key + '"><td>' + label + '</td><td class="r">' + a + '</td><td class="r prev">' + b + '</td></tr>';
const of = (t) => '<span class="of"> / ' + t + '</span>';
const trendsBody = '<div class="screen-title"><h1>Trends</h1><span class="sub">Last 14 days</span></div>'
  + '<div class="card"><div class="trend-hero"><div><div class="label">Average a day, 12 full days</div><div><span class="f-big">2,569</span><span class="muted"> kcal</span></div></div><div class="side"><b>99%</b> of 2,600 target</div></div>'
  + L.chartTrend(tdays, 2600)
  + '<div class="legend"><span><i class="swatch"></i>Logged</span><span><i class="swatch over"></i>Over target</span><span><i class="swatch now"></i>Today so far</span></div></div>'
  + '<div class="group-title">Daily averages</div>'
  + '<div class="card"><table class="table trend-table"><thead><tr><th>Per logged day</th><th class="r">This week</th><th class="r">Last week</th></tr></thead><tbody>'
  + trow('kcal', 'Calories' + of('2,600'), '2,552', '2,583') + trow('p', mk('p') + 'Protein' + of('190 g'), '184', '178') + trow('c', mk('c') + 'Carbs' + of('280 g'), '271', '288') + trow('f', mk('f') + 'Fat' + of('80 g'), '79', '83')
  + trow('days', 'Days logged', '5<span class="of"> of 6</span>', '6<span class="of"> of 7</span>') + '</tbody></table></div>'
  + '<p class="tiny muted center mt8">Averages count full days only: today joins tomorrow. Weeks start on Monday. A day is over target from 5% above it. Tap a day to open it.</p>';

// ---- Settings --------------------------------------------------------------------------
const settingsBody = '<div class="screen-title"><h1>Settings</h1></div>'
  + '<div class="group-title first">Food targets</div><div class="card"><p class="small muted">Leave a box empty for no target.</p>' + targetRows + '</div>'
  + '<div class="group-title">You</div><div class="card">'
  + toggleRow('Body weight', 'Only used for the protein guide under the targets', '<div class="row tight">' + numBox('182.4', 'data-field="fuel-bw" aria-label="Body weight"') + '<span class="muted">lb</span></div>')
  + toggleRow('Units', 'For body weight', seg(['lb', 'kg'], 0))
  + toggleRow('Appearance', 'System follows your phone', seg(['System', 'Dark', 'Light'], 0)) + '</div>'
  + T.backupCard('fuel') + T.cloudCard('out')
  + '<div class="group-title">From Overload</div><div class="card"><p class="small muted mb8">Brought across on Sat, Nov 21: 118 days, 2,304 entries. Bringing it again only adds what is new.</p><button class="btn ghost block" data-action="fuel-import">' + icon('clipboard') + 'Bring food from Overload</button></div>'
  + T.dangerZone
  + '<div class="group-title">About</div><div class="card"><p><b>Fuel</b> · v3.0</p><p class="small muted mt8">Food data: USDA FoodData Central, Open Food Facts.</p></div>';

// ---- Welcome and Add to Home Screen ---------------------------------------------------
// As fuel.js draws them: inside main.screen, the top bar in place, body.no-tabs (no tab bar). The h1 shows on these two screens.
const tile = (app, size) => '<span class="app-tile' + (size ? ' ' + size : '') + '" data-app="' + app + '">' + L.MARK[app] + '</span>';
const lead = (name) => '<span class="lead">' + icon(name) + '</span>';
// choiceRow in fuel.js, with a mark in front (new) and the chevron as an icon.
const choice = (action, lead, title, sub, first) => '<button class="list-item choice-card' + (first ? ' first' : '') + '" data-action="' + action + '">' + (lead || '') + '<div class="grow"><div class="title">' + title + '</div><div class="sub">' + sub + '</div></div><span class="chev">' + icon('chevron-right', 'm') + '</span></button>';
const brandRow = '<div class="onboard-brand">' + tile('fuel', 'xl') + '</div>';
const welcome = '<div class="onboard">' + brandRow + '<div class="screen-title"><h1>Welcome to Fuel</h1></div>'
  + '<p class="lede">Fuel is the food half of Overload, now its own app. Your days, targets, favorites and saved meals come across in one step. Nothing is removed from Overload.</p>'
  + '<div class="list">' + choice('fuel-paste', tile('overload', 'l'), 'Paste from Overload', 'In Overload, tap Copy my food log. Then tap here.', true)
  + choice('fuel-file', lead('file'), 'Choose a file', 'The food file or a backup saved from Overload.')
  + choice('fuel-signin', lead('cloud'), 'Sign in to cloud sync', 'The same email and password as in Overload.') + '</div>'
  + '<div class="foot"><button class="btn text" data-action="fuel-fresh">Start fresh</button><p class="small muted">You can still bring your log across later, in Settings.</p></div></div>';
const STEPS = '<li>Tap <b>Share</b>' + icon('share') + ' in Safari\'s toolbar.</li><li>Choose <b>Add to Home Screen</b>' + icon('add-square') + '.</li><li>Open <b>Fuel</b> from its new icon.</li>';
const install = (inside) => '<div class="onboard">' + brandRow + '<div class="screen-title"><h1>Add Fuel to your Home Screen</h1></div>'
  + (inside ? '<p class="lede">This page opened inside Overload. Fuel keeps its own data, so it has to be added from Safari.</p>'
      + '<ol class="install-steps"><li>Tap <b>Open in Safari</b> below.</li>' + STEPS + '</ol>'
      + '<a class="btn block big" data-action="fuel-open-safari" href="x-safari-https://example.github.io/overload/fuel/">Open in Safari' + icon('external') + '</a>'
      + '<button class="btn ghost block mt8" data-action="fuel-copy-link">' + icon('link') + 'Copy link</button>'
      + '<p class="small muted center mt8">If the button does nothing: copy the link, open Safari and paste it there.</p><p class="small muted center mt8 link-text">https://example.github.io/overload/fuel/</p>'
    : '<p class="lede">Fuel works best as its own app: it opens full screen, works offline and keeps its data between visits.</p>'
      + '<ol class="install-steps">' + STEPS + '</ol>'
      + '<div class="banner">' + icon('info') + '<span>On an iPhone, a Safari tab can lose its data after a few weeks without a visit. The Home Screen app does not.</span></div>'
      + '<div class="foot"><button class="btn text" data-action="fuel-use-here">Use it here anyway</button></div>')
  + '</div>';
// The two sheets fuel.js opens from Welcome and from Settings.
const sheetImport = sheetHeader('Bring food from Overload')
  + '<div class="banner warn" id="fuel-import-msg" role="alert">' + icon('warning') + '<span>Fuel could not read the clipboard here. Paste the copied text into the box below.</span></div>'
  + '<p class="small muted mb8">In Overload, open the card "Food has moved to Fuel" and tap Copy my food log, or Save as a file. Then come back here. Only what is missing here is added: nothing in Fuel is replaced or removed.</p>'
  + '<div class="list">' + choice('fuel-paste', tile('overload', 'l'), 'Paste from Overload', 'Reads the food log you copied in Overload.') + choice('fuel-file', lead('file'), 'Choose a file', 'The food file, a full Overload backup, or a Fuel backup.') + '</div>'
  + '<form id="fuel-paste-form" class="mt16"><div class="field"><label for="fuel-paste">Or paste the copied text here</label>'
  + '<textarea class="input" id="fuel-paste" name="text" data-field="fuel-paste" rows="3" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="OVERLOAD-FOOD:…">OVERLOAD-FOOD:1:H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTtVRKi1OLQIAAAD//w==</textarea></div>'
  + '<button class="btn block" type="submit">Bring it in</button></form>';
const sheetCloud = sheetHeader('Cloud sync') + '<div id="cloud-card" class="in-sheet">'
  + '<p class="small muted mb8">Sign in to keep your food log in the cloud so it survives clearing this phone and follows you to a new one. Use the same email and password as in Overload: the food log that account holds comes across the first time.</p>'
  + '<form id="cloud-form">' + field('Email', '<input class="input" name="email" type="email" autocomplete="username" inputmode="email" value="alex@example.com" required>') + field('Password', '<input class="input" name="password" type="password" autocomplete="current-password" value="12345678" required>')
  + '<div id="cloud-msg" class="small mb8 cloud-msg"></div>'
  + '<div class="btn-row"><button class="btn" type="submit">Sign in</button><button class="btn ghost" type="button" data-action="cloud-signup">Create account</button></div>'
  + '<button class="btn subtle block mt8" type="button" data-action="cloud-reset">Forgot password</button></form></div>';

const base = { app: 'fuel' };
const today = (o) => screen({ ...base, active: 'food', title: 'Fuel', right: syncPill('synced'), body: todayBody(1322, 2600, MACROS), ...o });
const onboard = (body, o) => screen({ ...base, active: '', title: 'Fuel', body, ...o });
module.exports = {
  bits: { summary, macroCell, meal, foodRow, quickRow, resultRow, mealRow, addedLine, mealSeg, targetRows, dayNav, sheetScan, tile, choice, lead, MACROS, mk, tdays },
  pages: {
    'fuel-today': { app: 'fuel', title: 'Fuel: Today', body: today({}) },
    'fuel-today-over': { app: 'fuel', title: 'Fuel: Today, over target', body: screen({ ...base, active: 'food', title: 'Fuel', right: syncPill('offline'), body: todayBody(2812, 2600, [['Protein', 171, 190], ['Carbs', 302, 280], ['Fat', 96, 80]]) }) },
    'fuel-today-none': { app: 'fuel', title: 'Fuel: Today, no target', body: screen({ ...base, active: 'food', title: 'Fuel', body: todayBody(1322, 0, [['Protein', 133, 0], ['Carbs', 113, 0], ['Fat', 34, 0]]) }) },
    'fuel-add': { app: 'fuel', title: 'Fuel: Add sheet', body: today({ sheet: sheetAdd }) },
    'fuel-search': { app: 'fuel', title: 'Fuel: Add sheet, search results', body: today({ sheet: sheetSearch }) },
    'fuel-amount': { app: 'fuel', title: 'Fuel: Amount sheet', body: today({ sheet: sheetAmount }) },
    'fuel-scan': { app: 'fuel', title: 'Fuel: Scan barcode sheet', body: today({ sheet: sheetScan, toast: 'Added to favorites' }) },
    'fuel-trends': { app: 'fuel', title: 'Fuel: Trends', body: screen({ ...base, active: 'trends', title: 'Trends', right: syncPill('synced'), body: trendsBody }) },
    'fuel-settings': { app: 'fuel', title: 'Fuel: Settings', body: screen({ ...base, active: 'settings', title: 'Settings', right: syncPill('synced'), body: settingsBody }) },
    'fuel-welcome': { app: 'fuel', title: 'Fuel: Welcome', bodyClass: 'no-tabs', body: onboard(welcome) },
    'fuel-install': { app: 'fuel', title: 'Fuel: Add to Home Screen (in a Safari tab)', bodyClass: 'no-tabs', body: onboard(install(false)) },
    'fuel-install-inside': { app: 'fuel', title: 'Fuel: Add to Home Screen (opened inside Overload)', bodyClass: 'no-tabs', body: onboard(install(true)) },
    'fuel-import': { app: 'fuel', title: 'Fuel: Bring food from Overload sheet (from Welcome, with the paste box)', bodyClass: 'no-tabs', body: onboard(welcome, { sheet: sheetImport }) },
    'fuel-cloud': { app: 'fuel', title: 'Fuel: Cloud sync sheet (from Welcome)', bodyClass: 'no-tabs', body: onboard(welcome, { sheet: sheetCloud, right: updatePill() }) },
  },
};
