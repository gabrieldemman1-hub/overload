# Interface inventory of Overload v2.8 (for the split and the redesign)

Scope: everything the user sees in `index.html`, `app.js`, `food.js`, `connector.js` and `styles.css` at v2.8
(branch `claude/split-training-diet`, identical to main). No source file was changed to write this.
Line references are `file:line` in that tree.

Contents

0. How this was made, and where the screenshots are
1. The shell: top bar, tab bar, rest timer, toast, sheet, save warning, start-up notes
2. Screens of the training side (Today, workout, Program, Exercises, History, Settings)
3. The Food screen and its sheets
4. All sheets in one table, and the native dialogs
5. Styles: tokens, themes, class map by component, inline styles, hooks the JavaScript relies on
6. Charts
7. Icons and glyphs
8. Critique of the current look and use, with evidence
9. Layout constraints the redesign must respect
10. Open questions

---

## 0. How this was made

- Read `index.html`, `app.js`, `food.js`, `connector.js`, `styles.css` in full.
- Ran v2.8 in Chromium through Playwright at 390x844, device scale 2, touch, mobile, service workers blocked, every
  request not to `http://127.0.0.1` aborted (the only ones attempted: the three Firebase modules `sync.js` imports
  from `www.gstatic.com`, and the Open Food Facts search I triggered to see its error state). Clock set to
  Sat, Nov 21 2026 17:40 Los Angeles (the fixtures' "now"), so Today is a training day.
- **Screenshots** (279 PNG files, 780 px wide = 390 CSS px):
  `/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/ov/ui-shots/`
  - `fresh-dark-NN-name.png`, `fresh-light-NN-name.png`: fresh start (no saved data), then a check-in, food
    logged, a workout started, logged and finished, a second workout started. `-full` = whole page (the fixed tab
    bar is painted once, in the middle of a full-page picture: ignore it there).
  - `rich-dark-…`, `rich-light-…`: the 16-week fixture `tests/fixtures/v28-state.json` (and `-active` for a workout
    in progress), for charts and long lists.
  - `special-…`: unreadable-data screen, start-up note, "screen could not be shown" card, and 320 px wide.
  - `extra-…`: states that needed a stub in the page (export reminder, WHOOP rows, Cloud sync signed out and in,
    WHOOP and Reminders cards). The stubs made no network requests.
  - `_sheets/*.png`: contact sheets of the above, four per row, file name under each picture. Start there.
- The scripts are beside them in `…/scratchpad/ov/ui-work/` (`shots.js`, `extra.js`, `measure.js`, `classes.js`,
  `contrast.js`). They use `tests/lib.js`.
- Limits of the pictures: Chromium on Linux, not Safari on an iPhone. The font stack starts with `-apple-system`
  (`styles.css:62`), so on the phone the text is SF Pro and the glyph icons and emoji are Apple's; here they are
  fallback fonts. Safe-area insets are 0 here. See section 10.

Measured at 390x844 (no insets):

| Thing | Size |
| --- | --- |
| Top bar | 57 px (56 + 1 px border), fixed |
| Tab bar | 66 px, fixed; tabs are not equal width (Today 54 px, Exercises and Settings wider) |
| Screen padding | 72 px top, 16 px sides, 162 px bottom (`styles.css:92`) |
| Card content width | 324 px (390 - 2x16 - 2x16 - borders) |
| Rest timer | 366x68 px at y 700 to 768, 10 px above the tab bar |
| Toast | bottom edge 20 px above the tab bar; 92 px above it while the timer shows; up to 358 px wide, 79 px tall for a long message |
| Sheet panel | at most 88vh = 743 px, top edge at y 101; covers the tab bar |
| Set row | 62 px; "Reps left" row under it 52 px; weight box 107x50, reps box 97x50, tick 50x50 |
| One open exercise card, 3 sets | 665 px with reps in reserve on, 509 px with it off |
| Page heights (fresh) | Today 1,609; workout with 7 exercises 5,400 to 6,000; Program 2,544; Exercises 7,450; History 2,372 (empty); Settings 3,450; Food 1,012 (empty) |
| Page heights (fixture) | History 10,295 (12 screens); Program 3,133; Food day 1,666; workout in progress 4,411 |

---

## 1. The shell

All of it is static markup in `index.html`; `app.js` fills it.

| Piece | Markup | Code | What it shows, states, controls |
| --- | --- | --- | --- |
| **Top bar** | `index.html:89-94` (`header.topbar`, `.brand`, `.brand-mark`, `#topbar-right`) | `renderTopbar` `app.js:771-775`, `syncIcon` `app.js:776`, `setSyncStatus` `app.js:2430-2436` | Left: a red diamond and "OVERLOAD" (uppercase by CSS). Right, both optional: pill "Update ready" (`.pill.accent`, action `reload`; shown when a new version arrived mid-workout or while typing, `app.js:2403`, `2427`) and the cloud pill (`.pill.sync-pill` + `synced` / `syncing` / `offline` / `error`; text `☁ ✓`, `☁ …`, `☁ ⏸`, `☁ !`; tap goes to Settings; hidden when signed out). Translucent with blur. No title, no back button, no per-screen actions. Pictures: `fresh-dark-114-topbar-pills`, `fresh-dark-115-topbar-sync-error`, `extra-dark-06-topbar-sync-offline`. |
| **Tab bar** | `index.html:113-120` (`nav.tabbar`, six `button.tab[data-screen]`, each a `span.tab-icon` glyph and a label) | active class set in `renderScreen` `app.js:759`; tap handler `app.js:2078-2079` (sets `ui.screen`, renders, scrolls to top, then `scrollToNext`) | Today, Food, Program, Exercises, History, Settings. One state: `.active` (text colour `--accent-2`). No badge, no pressed state. On the unreadable-data screen no tab is active (`app.js:1989`). The tab bar stays visible on every screen, also on the start-up note. |
| **Rest timer** | `index.html:99-111` (`#rest-timer`, `.rest-label`, `#rest-time`, `+30s`, `Skip`, `#rest-bar-fill`) | `startTimer` `app.js:1925-1936`, `tick` `1937-1948`, `stopTimer` `1949`, `beep` `1910-1924`; actions `rest-add`, `rest-skip` `app.js:2157-2158` | A floating card above the tab bar. Label "Rest" or "Cardio" (`app.js:1930`), time `m:ss`, a bar that empties. Starts on ticking a set (`app.js:2117`), a warm-up (`2135`) or the cardio timer (`2153`). A cardio timer is not replaced by a rest timer (`1927`). At zero: hides, beeps, toast "Rest over" / "Cardio done · N min logged". It is global: it stays up on every tab and over nothing else (`fresh-dark-121-save-warning-settings` shows it on Settings). Not shown above an open sheet (sheet z-index 40, timer 25). |
| **Toast** | `index.html:127` (`#toast`) | `toast` `app.js:1955-1959` | One line or a few, centred, inverse colours (`--text` background, `--bg` text). Lives 2.2 to 6 s by length. `pointer-events: none`. One at a time; a new one replaces the old. Sits above the tab bar, and above the rest timer when that shows (`styles.css:314`). z-index 50, so it also shows over a sheet, at the same height (`fresh-dark-18-food-amount-starred-toast`). |
| **Sheet** | `index.html:122-125` (`#sheet`, `.sheet-backdrop[data-action=sheet-close]`, `#sheet-panel`) | `openSheet` `app.js:1547-1556`, `closeSheet` `1557`, `sheetHeader` `1558` | Bottom sheet. See 9.3 for how it scrolls. Header: `h2` title, optional extra buttons, a 40x40 `✕`. Closes by `✕`, by a tap on the backdrop, or by code. No drag handle, no swipe to close, no Escape key. |
| **Save warning** | `index.html:96` (`#save-warning`, `role="alert"`) | `renderSaveWarning` `app.js:343-351`; toggled in `save` `app.js:332-336` | When writing to localStorage fails: a red-outlined banner fixed under the top bar with "The app's storage is full…" and a full-width "Export backup" button. The screen is pushed down by the banner's height through `--save-warning-h` and `body.has-save-warning` (`styles.css:338`). Stays until a save works. Pictures: `fresh-dark-120-save-warning`. |
| **Start-up notes** | built by the inline script `index.html:37-84`, markup at `index.html:45-48` | `say()` `index.html:39-55` | Shown in `#app` when `app.js` has not started: after 8 s "Overload is still starting. The signal is weak, so this can take a while." and, when it cannot start, "Overload did not finish starting." + "Close the app and open it again where there is signal or Wi-Fi." Both add " Everything you logged is still on this phone." when the state key exists. A `div#boot-note.empty` with an inline style, so it reads even with no stylesheet. Picture: `special-dark-02-boot-note-did-not-start`. |
| **"Loading…"** | `app.js:763` | | `<div class="empty">Loading…</div>` on the Food tab until `food.js` has run. |
| **Screen could not be shown** | `app.js:747-753` | `render` catch | A card: "This screen could not be shown. Your saved data has not changed…", the error message in small muted text, "Export backup". Picture: `special-dark-03-screen-could-not-be-shown`. |
| **Unreadable data** | `renderUnreadable` `app.js:1988-2001`; actions `app.js:2012-2033` | | Title "Your data". Card 1: "Overload could not read the data saved on this phone." + explanation; buttons "Export the unreadable copy" (only when there is text) and "Try again". Section "Restore an automatic copy" (hidden until a copy exists; list filled by `fillCopies(true)` `app.js:408-419`). Section "Start fresh" with a `.btn.danger` button. No tab active; other tabs do nothing useful (render always shows this screen, `app.js:739`). Picture: `special-dark-01-unreadable-data`. |
| **Update toast** | `app.js:2410` | | Toast "Updating…" when a new service worker is installed; then a reload, or the "Update ready" pill. |

---

## 2. Training screens

Every screen starts with `div.screen-title` holding an `h1` and, on some, a sub line or a button.

### 2.1 Today (no workout in progress)

`renderToday` `app.js:779-823`. Pictures: `fresh-dark-01-today(-full)`, `-02-today-restday`, `-03-today-other-days`,
`rich-dark-01-today`, `extra-dark-01-today-notice-export-due-whoop-red-recovery`.

Order on the page (`app.js:822`): title "Today" + date · notices · streak banner · red-recovery banner · morning
check-in (while not done) · day strip · the day's card · "Start a different day" · morning check-in (once done) ·
"Last workout" line.

| Part | Code | Shows | States | Controls |
| --- | --- | --- | --- | --- |
| Notices `#today-notices` | `noticesHtml` `app.js:388-397`, inserted by `render` `app.js:742-745`, refreshed by `refreshNotices` `398` | One `.notice` line | none; "Storage is N% full…" (from 70%); "Last backup N days ago / No backup yet, and cloud sync is off." | "Export" (`.btn.small`, action `export`); on the backup one also `✕` (`export-nag-off`, 44x44) |
| Streak banner | `app.js:817` | `.banner`: "🔥 N-day streak. Keep it going." | only when the streak is over 1 | none |
| Red recovery banner | `app.js:819-820` | `.banner`: "🔴 Recovery N% (red). Train, but hold the weights and skip extra sets today." | only with a WHOOP recovery under 34 today, on today's training day | none |
| Day strip | `app.js:784-789` | seven `.day-chip` buttons M T W T F S S, a dot under today | `.today` (dot), `.selected` (red tint and border), `.rest` (55% opacity) | tap selects the day (`select-day`) |
| Day card (training day) | `app.js:803-812` | `.card.flat`: day name `h2`, "Saturday · 7 exercises", then one `.list-item` per exercise: name and `prescText` ("3 × 10–12 @ **40 lb** each · goal 11", or "**set weight**" before a weight exists, `app.js:928-932`) | no exercises: "No exercises yet. Add some in Program." and both start buttons disabled | "Start as deload" (`.btn.small.subtle.deload-start`, 44 px), "Start workout" (`.btn.block`), each exercise row opens Edit exercise (`edit-ex`) |
| Rest day | `app.js:801` | `.card` with `.empty`: "Rest day. Nothing scheduled. Start any day below if you feel like lifting." and the list of days | | |
| Start a different day | `app.js:793-798` | collapsed: one `.btn.subtle.block` "Start a different day…"; open (always open on a rest day): `.group-title` and a `.list` of the other days with "N exercises" and "· not on the schedule" | | "Start" per day (`.btn.small.ghost`, 64x40) |
| Last workout line | `app.js:814-815` | "Last workout: Legs · Thu, Nov 19" small, muted, centred | absent before the first workout | none |

**Morning check-in** — `renderCheckinCard` `app.js:853-880`, save `saveCheckin` `app.js:881-910`.
Pictures: `fresh-dark-01-today`, `-04-today-checkin-filled`, `-05-today-checkin-saved-toast`,
`-06-today-bottom-checkin-folded`, `extra-dark-02-today-checkin-done-whoop-pill`.

- Not shown at all when weigh-ins and sleep are both off (`app.js:855`).
- Open form (`#checkin-card`, `form#bw-form`): title "Morning check-in" and a pill "Weigh-in due" (amber). Rows
  (`.toggle-row`): Body weight (one number box, unit after it, hint "Last 182.4 lb · Sat, Nov 21" or "After the
  bathroom, before food"), then either three hour/minute pairs (Time asleep, REM, Deep) or, when WHOOP already
  filled last night, one read-only row "Sleep from WHOOP" with the sleep line and a recovery pill
  (`app.js:876-878`). Buttons: "Save" and, when editing, "Cancel".
- Validation is by toast (`app.js:886-890`): "Enter your weight or sleep", "Enter a weight", "Enter total time
  asleep too", "Time asleep looks off: …", "REM + deep is more than total sleep". Success toast "Logged 182.4 lb ·
  7h 20m sleep".
- Done (`app.js:859-867`): one card under the workout with "Morning check-in ✓", recovery pill (green 67+, amber
  34 to 66, red under 34: `recBand` `app.js:840`), "Edit" button, a line "182.4 lb · Slept 7h 20m · REM 1h 40m
  (23%) · deep 1h 10m (16%)" (+ " (WHOOP)"), and a 7-night average line when there are 2 nights or more.
- It is "done" when no weigh-in is due and, with sleep on, a night exists for today (`checkinDone` `app.js:835-838`).

### 2.2 Workout in progress (the Today tab while `state.active` is set)

`renderActiveWorkout` `app.js:936-963`. Pictures: `fresh-dark-80…97`, `fresh-dark-110…113`,
`rich-dark-60-active-workout-…`, `rich-dark-61-active-workout-top`.

| Part | Code | Shows | States | Controls |
| --- | --- | --- | --- | --- |
| Title | `app.js:957-958` | day name `h1`; sub "Sat, Nov 21 · 2/6 done · 1h 0m" (`#elapsed` is refreshed every 30 s, `app.js:2388`) | | "+ Exercise" (`.btn.small.ghost`, 101x40) opens the picker |
| Deload switch | `app.js:959-960` | `button.deload-toggle` (a pill with a small switch) "Deload session" | off; on (amber) with a hint box `.deload-hint` | tap toggles (`toggle-deload`), toast says what changed (`app.js:2094-2098`) |
| Soreness check-in `#soreness-card` | `app.js:939-953` | One question per muscle that has history: "How sore did your **shoulders** get after last time?" (muscle in red by inline style) with four `.choice` buttons in a 2x2 grid: Never got sore, Healed a while ago, Healed just in time, Still sore | absent on a first workout; open; all answered: folded to one row "Check-in done" + "Edit"; editing: open with a "Done" button | `set-soreness`, `soreness-edit`, `soreness-done` |
| Exercise card, open | `renderEntryCard` `app.js:1010-1085` | Head: name, pills (🏆 PR, muscle), prescription line "3 sets × 10–12 @ **40 lb** · goal **11 reps**", "Last time: 40×10, 40×11, 40×10" (or "(deload)", or "First time logging this"), "Swapped in for X today", note (`.ex-note`, with a pencil glyph from CSS), reason box (`.ex-reason`, amber, or green when the text contains "+", `app.js:1025`). Body: warm-up box, the set table, tools, feedback, finish | see rows below | |
| Set row | `app.js:1038-1043` | set number, weight box (placeholder: the unit), reps box (placeholder: the goal reps, or "reps"), tick button | not done; done (green border and tint on the boxes, green tick); disabled when the exercise is finished | typing saves on blur (`change`, `app.js:2322-2335`): a new weight is copied down to later unticked sets that had the old one. Tick: needs a weight on loaded equipment (toast "Enter the weight first", focuses the box), an empty reps box logs the goal (`app.js:2104-2123`) and starts the rest timer |
| Reps-in-reserve row | `rirRow` `app.js:1031-1037` | under every set when the setting is on: label "Reps left" and four buttons 3+, 2, 1, 0 | idle (set not ticked): 35% opacity, not tappable, `aria-hidden`; active; one picked (amber) | `pick-rir`; tapping the picked one clears it; updated in place without a redraw (`app.js:2125-2132`) |
| Warm-ups | `app.js:1045-1049`, built by `genWarmups` `app.js:1825-1836` | dashed box "WARM-UP" with rows "W1 **70** lb × **8**" and a 40x40 tick each | none; listed; a row done (60% opacity) | "Warm-up" button builds them; `✕` clears; tick starts the warm-up rest timer |
| Set tools | `app.js:1073-1074` | three buttons "+ Set", "− Set", "Warm-up", then two "Swap exercise", "Remove" (all `.btn.small`, 40 px high) | "− Set" disabled with one set; "Warm-up" disabled once built | `add-set`, `remove-set` (asks before removing a logged one), `gen-warmup`, `swap-entry` (picker), `remove-entry` (confirm) |
| Feedback | `app.js:1054-1061`, `choiceRow` `1091-1094` | appears after the first tick, not in a deload: "How was it? (optional, adjusts your sets)" and three groups of `.choice` buttons: Pump (3), Joint pain (4), Workload (4) | each choice on/off | `set-fb` toggles |
| Finish exercise | `app.js:1076` | full-width button | disabled until a set is ticked or has reps; ghost until every set is ticked, then red | `finish-entry` |
| Exercise card, finished and folded | `app.js:1015-1022` | one green row: tick badge, name (one line, ellipsis), "3 sets · next 40 lb" (or "next goal 11 reps"), 🏆 PR pill, chevron | | tap opens (`open-entry`) |
| Exercise card, finished and open | `app.js:1062-1071`, `1083` | green-tinted head, green PR box, `.next-box` "Next time: 3 × 10–12 @ 40 lb, goal 11" with the reasons as bullets (or "Deload: plan kept") | | "Edit" (reopens), "Hide" (folds) |
| Cardio card `#cardio-card` | `renderCardioCard` `app.js:992-1008` | name, pill "Cardio" / "Done", three number boxes (Minutes, Incline %, Speed mph or km/h), a line "Last time: …" or "First time logging cardio" / "Today: 20 min · 10% incline · 3.2 mph · ≈228 kcal" | not done; timer running (button reads "Restart timer", the rest timer shows "Cardio"); done (boxes disabled, "Undo" and a disabled "Logged ✓"). The layout is the same in every state on purpose (`app.js:997-1003`) | `cardio-timer`, `cardio-done`, `cardio-undo`; absent when cardio is off |
| Finish row | `app.js:962` | "Discard" (`.btn.subtle`) and "Finish workout" (`.btn.success`, green) | | both confirm with native dialogs (`app.js:1866`, `1871`, `1875`, `1891`) |

Opening the app or the Today tab during a workout scrolls to the next set (`scrollToNext` `app.js:1717-1740`).
Folding a card keeps what is below it in place (`renderKeeping` `app.js:1709-1714`).

### 2.3 Program

`renderProgram` `app.js:1097-1117`. Pictures: `fresh-dark-40-program(-full)`, `-45-program-templates-bottom`,
`-46-program-schedule`, `rich-dark-20-program`.

| Part | Code | Shows | Controls |
| --- | --- | --- | --- |
| Title | `app.js:1112` | "Program" | "+ Day" (`.btn.small`, red, 67x40): adds "New day" and opens its sheet |
| Day cards | `app.js:1098-1104` | per day: name `h2`, "Mon · Thu · 6 exercises" or "Not scheduled · …", the exercise names as one comma-separated muted paragraph | "Edit" (`.btn.small.ghost`) opens Edit day |
| Weekly schedule | `app.js:1106-1107` | group title, one card, seven `.toggle-row`s: weekday name and a `<select>` (Rest, or a day), inline width | `change` saves and redraws (`app.js:2349`) |
| Program library | `renderLibrary` `app.js:1121-1125` | group title, a `.list` of 11 `.list-item` buttons: name, "Chris Bumstead · 5 days a week", chevron | opens the program sheet |
| Templates | `app.js:1109-1116` | group title, a card with an explanation, a `.list` of saved templates ("3 days · saved Sat, Nov 21"), a button | per template "Use" and `✕` (both confirm); "Save current program as template" asks the name with `prompt()` (`app.js:1839`) |

Empty states: no days → only the title and the lower sections; no templates → an empty list.

### 2.4 Exercises

`renderExercises` `app.js:1242-1257`. Pictures: `fresh-dark-50-exercises`, `-51-exercises-search`,
`-52-exercises-no-match`.

- Title "Exercises" and "+ New" (`.btn.small`, 72x40).
- A search box (`type="search"`, `data-field="search"`). Every keystroke rebuilds the list and puts the caret
  back (`app.js:2312`).
- Groups by muscle (`.group-title`), each a `.list` of `.list-item` buttons: name; sub line "3 × goal 11 @ 40 lb"
  when a weight exists, else the equipment and "· custom"; chevron. Tap opens Edit exercise.
- Empty state: "No matches".
- 80 exercises on a fresh start: the page is 7,450 px.

### 2.5 History

`renderHistory` `app.js:1260-1281`. Pictures: `fresh-dark-60-history-empty(-full)`, `fresh-dark-100…105`,
`rich-dark-40…49`.

Order: stats · sets per muscle · weekly review · calendar · progress · body weight · sleep · workouts.

| Card | Code | Shows | States | Controls |
| --- | --- | --- | --- | --- |
| Stat tiles | `app.js:1265` | three `.stat` tiles: "🔥 7 Day streak", "12 This month", "70 Workouts" | "0" with no fire at zero | none |
| This week's sets per muscle | `renderVolumeCard` `app.js:1298-1313` | title, pill "target 10–20", one `.vol-row` per muscle in the program or trained this week: name, bar, count; a legend sentence | bar and number amber under target, green in range, red over; absent when no muscle applies | none |
| Weekly review | `renderReviewCard` `app.js:1369-1380`, data `weekReview` `1340-1357` | title and a two-way `.seg` (This week / Last week); three tiles (Workouts, Sets, lb lifted); a bullet list: weight increases, 🏆 PRs, most sets, body weight average, cardio minutes, sleep average | empty: "No workouts logged for this week." (still lists body weight, cardio, sleep) | `review-set`; "Share" (`.btn.ghost.block`, disabled with no workouts): system share sheet or clipboard (`shareReview` `app.js:1851-1857`) |
| Calendar | `renderCalendar` `app.js:1316-1337` | `‹` month `›`, a 7-column grid, one cell per day, a count sentence | cell: plain; `.hit` (green, a workout, is a button); `.today` (red ring); `.rest` (40%); `.future` (35%); `.empty` filler. `›` disabled in the current month | `cal-prev`, `cal-next`; a hit cell opens the workout sheet |
| Progress | `app.js:1268-1270`, `renderChart` `1437-1472` | label "Progress", a `<select>` of exercises with history; once picked: line chart of the top set weight per session, three tiles (Current top set, Best set, Sessions), three lines (🏆 Heaviest, Est. 1RM, PR sessions), "Recent sessions" (last 8, with 🏆 and a Deload pill) | absent with no history; "Pick an exercise…"; "Nothing logged yet." | the select (`chart-ex`) |
| Body weight | `renderBwCard` `app.js:1411-1435` | title, pill "96 weigh-ins", chart (dots and a running-average line, last 60), three tiles (Latest, 7-entry avg, 30-day change), a legend sentence | absent with no weigh-ins | "Edit weigh-ins" opens a sheet |
| Sleep | `renderSleepCard` `app.js:1383-1404` | title, a button "101 nights", stacked bar chart of the last 14 nights, a three-item legend, three tiles (7-night avg with the change in minutes, REM avg, Deep avg), a recovery line when WHOOP data exists | absent with no nights | the button opens the Sleep sheet |
| Workouts | `app.js:1272-1280` | group title, a `.list`: per workout the day name (+ Deload pill) and a sub line "Fri, Nov 20 · 6 exercises · 26 sets · 1h 59m · 🚶 25 min · 1 weight ↑ · 🏆 1" | empty: "No workouts yet. Finish one and it shows up here." | a row opens the workout sheet. All workouts are listed, no paging |

### 2.6 Settings

`renderSettings` `app.js:1475-1505`. Pictures: `fresh-dark-70-settings(-full)`, `-71…73`, `extra-dark-03…09`.
Every row is a `.toggle-row`: label and a small muted description on the left, one control on the right.
Number boxes save on blur and are patched in place, never redrawn (`app.js:2351-2368`).

| # | Card | Code | Rows and controls |
| --- | --- | --- | --- |
| 1 | (no heading) | `app.js:1478-1493` | Appearance: `.seg` System / Dark / Light (`set-theme`). Weight jump: barbell, dumbbell, machine, cable (four number boxes). Rep range (two boxes with a dash). Rest timer (seconds). Starting sets. Max sets. Reps in reserve: `.seg` On / Off. Warm-up rest. Weekly sets target (two boxes). Weigh-in reminder: `<select>` (Off, Every day, Every 2 days, Every 3 days, Weekly, Every 2 weeks). Sleep: `.seg` On / Off. |
| 2 | Cardio | `app.js:1494-1498` | Cardio after lifting: `.seg` On / Off. When on: What (text box), Minutes. |
| 3 | WHOOP | `whoopCard` `connector.js:302-328` | States: no connector address (text and a "Connector address" box: this is what shows today, `connector.json` has an empty url); pairing (text, code box, "Pair", message, "Cancel"); "whoop-first" (text, "Connect WHOOP"); paired elsewhere (two texts); error (message, "Try again"); "Checking…"; login expired; connected ("Connected · name", last sync, pill WHOOP, "Sync now", "Disconnect"); keys not set; not connected ("Connect WHOOP"). |
| 4 | Reminders | `remindersCard` `connector.js:329-344` | States: needs the connector (today); iPhone not installed; not supported; "Checking…"; off ("Turn on reminders"); on: three rows (Morning check-in, Workout, Food log), each a native `type="time"` box and a `.seg` On / Off, then "Send a test" and "Turn off here". |
| 5 | Food targets | `settingsCard` `food.js:1001-1003`, rows `targetRows` `983-987`, note `targetNote` `989-1000` | Calories, Protein, Carbs, Fat (number boxes, empty = no target), then a note comparing the macros with the calorie target and a protein guide from the last weigh-in. |
| 6 | Backup | `renderBackupCard` `app.js:420-430`, rows `copyRow` `401-407`, list `fillCopies` `408-419` | Text; "Export JSON" and "Import JSON" (two `.btn.ghost`); "Last export: …"; Storage used (text, a meter bar reusing `.vol-bar`, a percentage, green or red from 70%); "Automatic copies" with text and a `.list` of copies (title, "3 workouts · Nov 12 – Nov 19 · 4 food days", a "Restore" or "Export" button). List states: "Looking for copies…", "No copies yet.", "Automatic copies are not available (in this browser)." |
| 7 | Cloud sync `#cloud-card` | `renderCloudCard` `app.js:1507-1527` | States: module not loaded ("Cloud sync is loading. If this never changes…": what a blocked or offline start shows); signed out (text, Email, Password, a red message line `#cloud-msg`, "Sign in", "Create account", "Forgot password"); signed in ("Signed in" + email, a status pill coloured by inline style, text, "Sync now", "Sign out"). |
| 8 | Danger zone | `app.js:1503` | "Reset all data" (`.btn.danger.block`), two native confirms (`app.js:2238`). |
| 9 | Version | `app.js:1504` | "Overload · v2.8", tiny, centred. |

There is no control for units: `settings.units` is only ever `lb` unless a backup or the cloud copy says `kg`
(`app.js:166`, `228`; nothing in `renderSettings` writes it).

---

## 3. Food

One screen, `render` `food.js:332-370`, reached through `window.__overloadFood.render()` (`app.js:763`). Events
named `food-*` are forwarded from `app.js` (`2083`, `2252`, `2311`, `2318`).

### 3.1 Day view

Pictures: `fresh-dark-10-food-empty`, `-26-food-day(-full)`, `-32-food-yesterday-empty-copy`, `-33-food-past-day`,
`rich-dark-10-food-day(-full)`, `rich-dark-14-food-yesterday`.

| Part | Code | Shows | States | Controls |
| --- | --- | --- | --- | --- |
| Title | `food.js:369` | "Food" | | none |
| Day switcher | `food.js:338-340` | `‹`, a label button ("Today", "Yesterday" or a date), `›` | `›` disabled on today | `food-day` with -1 / 0 / +1; the label goes back to today |
| Totals card `.f-sum` | `food.js:342-351`, `bar` `324-328`, `macroCell` `329-331` | with a calorie target: big number "1,257", "/ 2,400 kcal", "1,143 left" in green or "N over" in red, an 8 px bar; without: big number, "kcal", a "Set target" button. Then three macro cells (Protein, Carbs, Fat): label, "103 / 190 g", a 5 px bar | bar green, red when over 105% of the target (`food.js:326`); macro bars grey (`.m`) and red when over; no bar fill without a target | "Set target" opens the targets sheet (only shown while no calorie target is set) |
| Copy the day before | `food.js:363-367` | on an empty day when the day before has entries: one button "Copy yesterday · 3 foods · 488 kcal" | | `food-copy-day` |
| Meal cards `.f-meal[data-meal]` x4 | `food.js:353-361` | head: Breakfast / Lunch / Dinner / Snacks `h2`, "596 kcal", a `⋯` button (32x32). Rows `.f-row[data-id]`: name (two lines at most), "amount · brand", kcal. Then "+ Add food" (`.btn.subtle.small.block`, 40 px) | empty meal: head and the button only | row tap opens the amount sheet in edit mode; `⋯` opens the meal menu; "+ Add food" opens the add sheet |
| Tip | `food.js:368` | "Hold a food, then drag it to another meal." tiny, centred, when the day has entries | | |
| Drag between meals | `food.js:377-482` | hold 300 ms then drag (mouse: just drag). The row dims (`.f-lifted`), a copy follows the finger (`.f-ghost`, red border), the target card gets a red outline (`.f-drop-target`), a red 3 px line shows the drop place (`.f-drop-line`), the page scrolls near the edges (80 px zones, `food.js:416-418`). Toast "Moved to Lunch" | Pictures: `fresh-dark-35-food-dragging`, `-36-food-drag-dropped-toast` | pointer events on `document`; relies on `.f-meal`, `.f-row[data-id]`, `[data-action="food-add"]` |

### 3.2 Add sheet

`sheetAdd` `food.js:487-499`, list `renderResults` `food.js:537-576`. Pictures: `fresh-dark-13…16`, `-19`, `-20`,
`-30`, `rich-dark-11-…`, `rich-dark-12-…`.

- Title "Add to Breakfast" (+ " · Yesterday" or a date for a past day).
- `#food-added` (sticky at the top of the sheet): `addedLine` `food.js:520-526`. Empty: a dashed box "Foods you add
  show here." Filled: green box "**Added:** Oats, rolled, dry · Chicken breast, raw" (newest first, two lines at
  most) and a red "Done" button. Same height in both states on purpose.
- Search row: a search box "Search foods" and a 44x44 icon button (barcode glyph) that also starts the scanner.
- Three equal buttons: "Scan barcode", "Quick add", "New food" (`.btn.ghost.small`, 40 px).
- `#food-results`:
  - nothing typed, nothing saved: a help paragraph (`food.js:548`);
  - nothing typed: "Saved meals" (rows open the saved-meal sheet), "Favorites", "Recent" (up to 25). Favourite and
    recent rows are `quickRow` `food.js:510-517`: name with a ★ mark, "amount · kcal", and a 44x44 `+` that logs
    it in one tap and turns into a green `✓` (disabled);
  - typed: "Saved meals", "Your foods" (up to 8), "Common foods" (up to 30 `resultRow`s `food.js:500-508`: name,
    "165 kcal / 100 g · P 31 C 0 F 3.6", chevron), then "Brands and packaged foods".
  - list states: "Loading the food list…"; load error + "Try again"; "No common food matches. Try fewer words, or
    search brands below."
  - brand states: a button "Search brands for “chicken breast”"; "Searching Open Food Facts…"; results; "Nothing
    found. Scanning the barcode works better for packaged foods."; error "You are offline. Brand search needs a
    connection." / "Brand search did not answer. Try again, or scan the barcode."
- After a food is added the sheet stays open on the same list (`stayForMore` `food.js:652-660`).

### 3.3 Amount sheet (add and edit)

`sheetAmount` `food.js:589-611`, preview `renderPreview` `615-622`. Pictures: `fresh-dark-17-food-amount`,
`-18-…-starred-toast`, `-27-food-edit-entry(-bottom)`.

- Header: "Add food" (+ day) or "Edit"; "‹ Back" (only when it came from the add sheet); a star button
  (☆ / ★, amber when on; not shown for an entry whose food is gone); `✕`.
- Food name (18 px bold), source line (brand · USDA / Open Food Facts / Your food).
- Amount: a number box (110 px, 20 px bold, centred) and a unit `<select>` (label serving, USDA servings, g, oz,
  or ml, fl oz). Changing the unit converts the number.
- `#food-preview`: four `.stat` tiles (kcal, Protein g, Carbs g, Fat g), or "Enter an amount." (and the save
  button disabled).
- "Meal": a four-way `.seg.f-mealseg`.
- "Add to Breakfast" / "Save" (red, full width); in edit mode "Remove from Breakfast" (`.btn.danger`); and, for
  some foods, a subtle "Edit food" or "Numbers wrong? Fix them" (opens the food form).

### 3.4 Other food sheets

| Sheet | Code | Content | Controls |
| --- | --- | --- | --- |
| Quick add / Edit quick add | `sheetQuick` `food.js:769-781`, submit `782-799` | form `#food-quick-form`: Name (optional), Calories (placeholder "from protein, carbs, fat"), Protein g, Carbs g, Fat g, Meal `.seg` | "Add" / "Save"; "Remove" in edit mode. Error toast "Enter calories, or protein, carbs and fat". Picture `fresh-dark-21-food-quick-add` |
| New food / Edit food | `sheetFoodForm` `food.js:802-826`, submit `827-858` | optional `.banner` message (from a scan), form `#food-form`: Name, Brand, Barcode, heading "Nutrition label", Serving size, Serving weight g (or ml), a hint, Calories per serving, Protein, Carbs, Fat | "Save food"; "Delete this food" for own foods (confirm). Then it goes to the amount sheet. Pictures `fresh-dark-22…23` |
| Scan barcode | `sheetScan` `food.js:890-897`, camera `898-934`, photo `935-947`, lookup `949-978` | "‹ Back", a 4:3 black video box with a white guide frame, a status line `#scan-status` | status texts: "Starting camera…", "Hold the barcode inside the box.", "Looking up 0123…", "Camera access is off. Allow it in Settings › Safari › Camera, or scan a photo.", "Camera did not start. Scan a photo or type the number.", "Reading the photo…", "No barcode in that photo. …", "Could not read that photo.". Buttons: "Scan a photo" (a `label.btn` for a hidden file input with `capture`), "Type the number" (native `prompt()`, `food.js:1058`). Picture `fresh-dark-25-food-scan-camera-failed` |
| Daily targets | `sheetTargets` `food.js:1004-1006` | the same four rows and note as the Settings card | "Done". Pictures `fresh-dark-11…12` |
| Meal menu | `sheetMealMenu` `food.js:723-735` | title = the meal; a list of text rows (`.f-menu`): "Copy yesterday’s Breakfast" (+ count), "Save as a meal", "Copy to today" (past days), "Clear Breakfast" (red text) | empty: "Nothing to copy, save or clear here yet." "Save as a meal" asks the name with `prompt()` (`food.js:738`); "Clear" confirms. Pictures `fresh-dark-28`, `-34` |
| Saved meal | `sheetSavedMeal` `food.js:744-757` | title = its name, "‹ Back", four total tiles, its foods (name, amount, kcal, a 32x32 `✕`), Meal `.seg`, "Add 3 foods to Dinner", "Rename" (`prompt()`), "Delete meal" (confirm) | Picture `fresh-dark-31-food-saved-meal` |

---

## 4. All sheets, and the native dialogs

| Sheet | Opened by | Function | Key (`data-sheet`) |
| --- | --- | --- | --- |
| Edit exercise / New exercise | exercise rows (Today, Exercises), "+ New", picker "New" | `sheetExercise` `app.js:1560-1577`; submit `app.js:2272-2306` | title |
| Edit day | "Edit" on a day, "+ Day", "Duplicate day" | `sheetDay` `app.js:1579-1591` | `day:<id>` |
| Add exercise / Swap exercise (picker) | "+ Add exercise" in Edit day, "+ Exercise" and "Swap exercise" in a workout | `sheetPicker` `app.js:1593-1597`, `renderPicker` `1598-1608` | title |
| Program (library) | a library row | `sheetProgram` `app.js:1127-1143` | title |
| Workout detail | a History row or calendar day | `sheetWorkout` `app.js:1610-1625` | title |
| Edit sets | "Edit sets" in the workout sheet | `sheetEditWorkout` `app.js:1628-1638`; submit `app.js:2255-2271` | title |
| Weigh-ins | "Edit weigh-ins" | `sheetBodyweight` `app.js:1690-1693` | title |
| Sleep | "N nights" | `sheetSleep` `app.js:1405-1408` | title |
| Food: add, amount, quick add, food form, scan, targets, meal menu, saved meal | see section 3 | `food.js` | title; saved meal `meal:<id>` |

Contents of the training sheets:

- **Edit exercise** (`fresh-dark-53-sheet-edit-exercise(-bottom)`): form `#ex-form`: Name; Muscle and Equipment
  selects; Notes; heading "Current prescription" with Weight, Sets, Goal reps; heading "Overrides (blank = use
  settings)" with Weight jump, Rep min, Rep max, Rest (seconds), Fixed sets; "Save"; "Delete exercise"
  (`.btn.subtle`, confirm). Errors by toast after blurring the field (`app.js:2279-2281`).
- **Edit day** (`fresh-dark-41-sheet-edit-day(-bottom)`): Name box (saves on blur); a list of the day's exercises,
  each with `↑`, `↓`, `✕` icon buttons (40x40); "+ Add exercise" (red); "Duplicate day" and "Delete day" (subtle).
  Empty: "No exercises yet".
- **Picker** (`fresh-dark-42-sheet-picker`, `-92`, `-93`): header button "New"; a search box with `autofocus`;
  groups by muscle; rows with the name, the equipment and a `+`. Exercises already in the day or workout are left
  out. Empty: "No matches". Choosing one for a day keeps the Edit day sheet open; for a workout it closes.
- **Program** (`fresh-dark-44-sheet-program-view(-bottom)`): author and description; seven pills for the week
  ("Mon Back", "Sat Rest"; training days red-tinted); an optional "how" card; one `.card.flat` per day with rows
  "name [new] … [FST-7] 4 × 8–12" and small notes; a long explanatory paragraph with the source; "Use this
  program" (two possible confirms, `app.js:1218`, `1226`).
- **Workout detail** (`rich-dark-48-sheet-workout(-bottom)`): a muted line (Deload pill, date, duration, soreness
  answers); per exercise a `.card.flat`: name (+ "(swap)"), muscle pill, "Warm-up" row, "Set 1 … **70** lb × **12**
  · 0 RIR" rows, a green 🏆 line, a feedback line, the first reason in amber; a cardio card; "Edit sets" and
  "Delete workout". Empty: "Nothing logged".
- **Edit sets** (`rich-dark-49-sheet-edit-sets`): an explanatory paragraph; per exercise a card with one row per
  done set: "Set 1", weight box, reps box; "Save changes".
- **Weigh-ins**, **Sleep** (`fresh-dark-104`, `-105`): a list, each row a value, a date line and a red `✕`
  (deletes at once, no confirm). Empty: "Nothing yet".

**Native dialogs.** Every confirmation and every name entry is a browser `confirm()` or `prompt()`; they cannot be
styled and are part of the look today.

- `confirm()`: `app.js:439` (restore a copy), `1218`, `1226` (use a program), `1539` (sign out), `1846` (use a
  template), `1866`, `1871`, `1875` (finish workout), `1891` (discard), `2028` (start fresh), `2056`, `2064`
  (import), `2143` (remove a logged set), `2150` (remove exercise), `2164` (delete day), `2183` (delete template),
  `2208` (delete exercise), `2225` (delete workout), `2238` twice (reset); `food.js:861` (delete food), `1079`
  (clear meal), `1110` (delete saved meal); `connector.js:204` (disconnect WHOOP).
- `prompt()`: `app.js:1839` (template name); `food.js:738` (meal name), `1058` (barcode number), `1104` (rename
  meal).

---

## 5. Styles

`styles.css` is one file, 480 lines, no build, no imports, no web fonts, no images. One media query
(`styles.css:469`, tabs at 380 px or less). No `prefers-color-scheme` and no `prefers-reduced-motion` rules.

### 5.1 Custom properties (`styles.css:1-57`)

| Token | Dark (`:root`, `1-30`) | Light (`33-57`) | Used for |
| --- | --- | --- | --- |
| `--bg` | `#111214` | `#f3f3f5` | page; toast text |
| `--bg-2` | `#191a1d` | `#ffffff` | sheet panel, inputs, `.card.flat`, tiles, bar tracks |
| `--card` | `#1f2024` | `#ffffff` | cards, list items, day chips, choices |
| `--card-2` | `#26272c` | `#ececf0` | ghost buttons, icon buttons, pills, rest timer, next box |
| `--border` | `#303237` | `#d9d9df` | every 1 px border, chart grid, the "light sleep" bar |
| `--text` | `#f2f2f2` | `#16171a` | text; toast background |
| `--muted` | `#9a9ca3` | `#676a74` | secondary text, labels, inactive tabs |
| `--accent` | `#e5322d` | `#dc2f2a` | primary buttons, selected segment, focus border, chart line, rest bar, drag marks |
| `--accent-2` | `#ff5a4f` | `#c4231f` | active tab, danger text, chart points, selected choice text |
| `--accent-soft` | `rgba(229,50,45,.16)` | `rgba(220,47,42,.12)` | banner, selected day chip and choice, accent pill |
| `--green` | `#3ecf6e` | `#1e9a4e` | success button, tick on, bars in range, "left" |
| `--green-soft` | `rgba(62,207,110,.16)` | `rgba(30,154,78,.14)` | finished exercise row, green pill, added line |
| `--amber` | `#f5b342` | `#a8720f` | deload on, RIR picked, star on, under-target bars |
| `--amber-soft` | `rgba(245,179,66,.16)` | `rgba(168,114,15,.14)` | reason box, notice, amber pill |
| `--amber-text` | `#f5b342` | `#845700` | text on amber-soft |
| `--green-text` | `#3ecf6e` | `#136f37` | text on green-soft |
| `--muted-on-green` | `#aeb0b7` | `#5c5f68` | sub line of the folded finished exercise |
| `--sl-deep` | `#5b6cff` | `#3f4fd6` | sleep chart, deep |
| `--sl-rem` | `#a78bfa` | `#8b6cf0` | sleep chart, REM |
| `--radius` | `14px` | same | `.card` only; every other radius is a literal |
| `--tabbar-h` | `66px` | same | tab bar, screen padding, rest timer and toast position |
| `--topbar-h` | `56px` | same | top bar, screen padding, save warning position |
| `--safe-top`, `--safe-bottom` | `env(safe-area-inset-top / -bottom, 0px)` | same | see 9.1 |
| `--bar-bg` | `rgba(17,18,20,.92)` | `rgba(243,243,245,.92)` | top bar and tab bar behind the blur |
| `--shadow` | `rgba(0,0,0,.45)` | `rgba(0,0,0,.18)` | rest timer, toast, drag ghost |
| `color-scheme` | `dark` | `light` | native controls (select, time, scrollbars) |
| `--save-warning-h` | set from JavaScript (`app.js:350`), read at `styles.css:338` | | height of the save warning |

There are no tokens for spacing, type sizes, radii (other than the card's) or control heights. Literal values in
use: font sizes 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 22, 24, 28 px; weights 500, 600, 700 (24 rules), 800;
radii 2, 3, 8, 10, 12, 14, 16, 20, 999 px and 50%; control heights 28, 32, 40, 44, 46, 48, 50, 52, 56, 60 px.

Colours written outside the tokens: `#fff` (`styles.css:124` button text, `198` switch knob, `268` selected
segment text), `#05130a` (`134`, `188`, `226`: text on green), `rgba(62,207,110,.5)` and `.08` (`184`, `221`: the
dark theme's green, also used in the light theme), `rgba(0,0,0,.5)` (`296` backdrop), `rgba(0,0,0,.35)` (`198`,
`339`), `#1b1c20` (`339` fallback), `#000`, `rgba(255,255,255,.85)`, `rgba(0,0,0,.25)` (`453-455` scanner).
Outside the stylesheet: `index.html:8` (`theme-color` `#111214`), `app.js:475` (`#f3f3f5` / `#111214`),
`manifest.webmanifest` (`background_color` and `theme_color` `#111214`), `icon.svg` (`#111214`, `#e5322d`,
`#f2f2f2`).

### 5.2 How the themes work

- The setting is `state.settings.theme`: `system` (default), `dark` or `light` (`app.js:166`, `229`), changed by the
  Appearance control (`app.js:2232`).
- `applyTheme` (`app.js:468-476`): for `light` / `dark` it sets `data-theme` on `<html>`, otherwise removes it; it
  toggles the class `system-light` on `<html>` when the setting is `system` and the phone is in light mode; it
  copies the setting to `localStorage['overload.theme']`; it sets the `theme-color` meta to `#f3f3f5` or
  `#111214`. It runs at start (`app.js:2378`), when the phone's mode changes (`2379`), after a theme tap, an
  import or restore (`465`) and when cloud data arrives (`486`).
- Before first paint, the inline script `index.html:18-27` does the same from `localStorage['overload.theme']`
  alone, so there is no flash. It does not set the `theme-color` meta.
- The stylesheet has one light selector: `:root[data-theme="light"], :root:not([data-theme="dark"]).system-light`
  (`styles.css:33-34`). Dark is the plain `:root`. Light only changes token values; no other rule differs.
- For the diet app: the key name `overload.theme` is written in two places (`index.html:20`, `25` and
  `app.js:474`); the plan gives Fuel its own key.

### 5.3 Class map by component

"Used in" lists the builder; the number after `styles.css` is where the rule is.

**Shell**

| Class | `styles.css` | Used in |
| --- | --- | --- |
| `.topbar`, `.topbar-inner`, `.brand`, `.brand-mark`, `.topbar-right` | 76-82, 83-86, 87, 88, 89 | `index.html:89-93` |
| `.screen` | 91-94, 338 | `index.html:97` |
| `.screen-title`, `.screen-title .sub` | 95, 96 | every screen (`app.js:822`, `957`, `1112`, `1254`, `1279`, `1477`, `1992`; `food.js:369`) |
| `.tabbar`, `.tab`, `.tab-icon`, `.tab.active` | 98-105, 106-110 (+469), 111, 112 | `index.html:113-120`; `app.js:759` |
| `.rest-timer`, `-inner`, `.rest-label`, `.rest-time`, `.rest-actions`, `.rest-bar`, `.rest-bar-fill` | 282-286, 287, 288, 289, 290, 291, 292 | `index.html:99-111` |
| `.sheet`, `.sheet-backdrop`, `.sheet-panel`, `@keyframes up`, `.sheet-title` | 295, 296, 297-302, 303, 304 | `index.html:122-125`; `app.js:1558` |
| `.toast` | 306-312, 314 | `index.html:127` |
| `.save-warning`, `body.has-save-warning`, `.banner.danger` | 335-336, 338, 339-340 | `index.html:96`; `app.js:346-347` |

**Buttons**

| Class | `styles.css` | Notes |
| --- | --- | --- |
| `.btn` | 123-127 | red, white text, 48 px, radius 12, 16 px bold |
| `.btn:active`, `:disabled` | 128, 135 | brightness 0.9; opacity 0.45 |
| `.btn.block` | 129 | full width |
| `.btn.small` | 130 | 40 px, 14 px text |
| `.btn.ghost` | 131 | grey fill, border: the normal secondary |
| `.btn.subtle` | 132 | transparent, muted text, border |
| `.btn.danger` | 133 | transparent, red text, red border |
| `.btn.success` | 134 | green, dark text ("Finish workout", "Done ✓") |
| `label.btn` | 468 | "Scan a photo" |
| `.btn-row` | 136-137 | equal-width buttons in a row |
| context overrides | 203, 207, 228, 344, 347, 462, 467 | `.deload-start`, `.fold-row .btn`, `.ex-card .card-actions .btn`, `.set-tools .btn`, `.notice .btn`, `.copy-row .btn`, `.backup-btns .btn`, `.f-added .btn`, `.f-addbtns .btn`: mostly `min-height: 44px` patches |
| `.icon-btn`, `.danger`, `:disabled` | 138-141, 142, 411 | 40x40, grey; (`.notice .icon-btn` 44x44 at 345) |
| `.f-more`, `.f-x`, `.f-scanbtn`, `.f-plus`, `.f-star` | 472, 480, 444, 465-466, 473-474 | food variants: 32x32, 32x32, 44x44, 44x44 (+ green done state), star |
| `.f-daylabel` | 410 | the day label button |
| `.check`, `.check.on`, `.check.small` | 222-225, 226, 371 | set tick 50x50; warm-up tick 40x40 |

**Choices, switches, segmented controls**

| Class | `styles.css` | Used in |
| --- | --- | --- |
| `.seg`, `.seg button`, `.on` | 266, 267, 268 | `app.js:1372`, `1479`, `1488`, `1492`, `1495`; `connector.js:340`; `food.js:606`, `754`, `778` |
| `.f-mealseg` | 451-452 | full-width four-way meal control |
| `.choice-grid`, `.choice`, `.on` | 235, 236-239, 240 | soreness (`app.js:951`), feedback (`1093`) |
| `.rir-row`, `.rir-pick`, `.rir-label`, `.rir-btn`, `.on`, `.idle` | 356, 357, 358, 359, 360, 362-363 | `app.js:1032-1036` |
| `.day-strip`, `.day-chip`, `.dot`, `.today`, `.selected`, `.rest` | 164, 165-168, 169, 170, 171, 172 | `app.js:786-789` |
| `.deload-bar`, `.deload-toggle`, `.sw`, `.on`, `.deload-hint` | 195, 196, 197-198, 199-201, 202 | `app.js:959-960` |

**Pills and banners**

| Class | `styles.css` | Used in |
| --- | --- | --- |
| `.pill`, `.accent`, `.green`, `.amber` | 144-147, 148, 149, 150 | muscle, "Cardio", "target", counts; "Update ready", program days; "Done", WHOOP; "Weigh-in due", Deload, FST-7; recovery pill takes any of the three (`app.js:840-841`) |
| `.pill.pr` | 374 (192 inside a folded row) | 🏆 PR |
| `.sync-pill` + `.synced`, `.syncing`, `.offline`, `.error` | 350, 351, 352, 353 | `app.js:773`, `2433` |
| `.hist-set .pill`, `.ex-fold .pill` | 329, 191 | small pill in rows |
| `.banner` | 333 | streak, red recovery (`app.js:817`, `820`), scan message (`food.js:811`) |
| `.notice` | 342-345 | Today notices |

**Inputs and forms**

| Class | `styles.css` | Used in |
| --- | --- | --- |
| `.input`, `.select`, focus | 249-253, 254 (+259 arrow) | every form |
| `.field`, `.field label`, `.field-row` | 247, 248, 260-261 | sheet forms, cardio card |
| `.toggle-row` | 262-265 | Settings, schedule, check-in, targets, reminders |
| `.set-input`, placeholder, focus, done | 215-218, 219, 220, 221 | set table |
| `#cardio-card .input:disabled` | 255 | cardio done |
| `.f-searchrow`, `.f-amount` | 442-443, 446-447 | add sheet, amount sheet |

**Cards and boxes**

| Class | `styles.css` | Used in |
| --- | --- | --- |
| `.card`, `.card.flat` | 114-117, 118 | everywhere; flat = `--bg-2` background |
| `.card-head`, `.meta`, `.card-actions` | 119 (+204), 120, 121 | day cards; finished exercise |
| `.fold-row` | 206 | "Check-in done" |
| `.prompt`, `.prompt-q`, `.hint` | 232, 233, 234 | soreness and feedback questions |
| `.next-box`, `.headline` | 242-244 | next-time box |
| `.warmups`, `.warmup-row`, `.n`, `.done` | 366, 367-370 | warm-ups |
| `.stat-row`, `.stat`, `.v`, `.k` | 323, 324, 325, 326 | History tiles; food preview (`.f-preview` overrides 448-450) |
| `.empty` | 161 | empty states, start-up note |

**Exercise card**

| Class | `styles.css` | Used in |
| --- | --- | --- |
| `.ex-card`, `.ex-head`, `.ex-name`, `.ex-presc`, `.ex-last`, `.ex-reason` (+`.green`), `.ex-body` | 175, 176, 177, 178 (+180), 179, 181-182, 183 | `app.js:1078-1084` |
| `.ex-card.done` | 184-185 | finished |
| `.ex-fold`, `-tick`, `-name`, `-sub`, `.chev` | 187, 188, 189, 190, 193 | folded row `app.js:1019-1021` |
| `.ex-note` | 406-407 | note; the pencil is CSS `content` |
| `.set-table`, `th`, `.n`, `.chk`, `.set-row` | 209-214, 221 | `app.js:1038-1043`, `1072` (a real `<table>`) |
| `.set-tools`, `.secondary` | 227-229 | tools |
| `.cardio-line`, `.off` | 256-258 | two texts in one grid cell |

**Lists and rows**

| Class | `styles.css` | Used in |
| --- | --- | --- |
| `.list`, `.list-item`, `.title`, `.sub`, `.chev` | 271, 272-275, 276, 277, 278 | exercise, day, workout, template, copy, weigh-in, sleep, picker rows |
| `.group-title`, `.first` | 279, 440-441 | section labels |
| `.hist-set`, `.nowrap` | 328-331, 330 | set lines in sheets, program rows, recent sessions |
| `.review-list` | 396-397 | weekly review bullets; chart facts |
| `.copy-row`, `.backup-btns`, `.store-bar` | 344, 347, 346 | Backup card |
| `.f-row`, `.title`, `.sub`, `.chev`, `.f-rk` | 428, 429, 430, 431, 432 | food rows everywhere |
| `.f-qrow`, `.f-qpick`, `.f-static`, `.f-menu`, `.f-danger`, `.f-favmark` | 463, 464, 479, 477, 478, 475 | quick rows, saved-meal rows, meal menu |

**Charts and meters**

| Class | `styles.css` | Used in |
| --- | --- | --- |
| `.chart`, `.line`, `.pt`, `.grid`, `.lbl`, `.pt.faint`, `.pt.deload` | 317, 318, 319, 320, 321, 398, 399 | the three SVG charts |
| `.sl-deep`, `.sl-rem`, `.sl-other`, `.sl-key` | 400, 401, 402, 403 | sleep bars and legend |
| `.vol-row`, `.vol-name`, `.vol-bar`, `.vol-fill` (+`.low` `.ok` `.high`), `.vol-n` | 377, 378, 379, 380-381, 382-383 | sets per muscle; storage meter |
| `.f-bar`, `span`, `.m`, `.over` | 417, 418, 419, 420 (+425) | food target bars |
| `.cal-grid`, `.cal-head`, `.cal-cell` (+`.empty` `.rest` `.future` `.hit` `.today`) | 386, 387, 388-393 | calendar |

**Food screen**

| Class | `styles.css` | Used in |
| --- | --- | --- |
| `.f-daynav` | 409 | day switcher |
| `.f-sum`, `.f-kcal`, `.f-big`, `.f-left` (+`.over`), `.f-macros`, `.f-macro` | 412, 413, 414, 415-416, 421, 422-425 | totals card |
| `.f-meal`, `.f-meal-head` | 426 (+434), 427 (+471) | meal cards |
| `.f-lifted`, `.f-ghost`, `.f-drop-target`, `.f-drop-line`, `body.f-dragging` | 435, 436, 437, 438, 439 | drag |
| `.f-copyday` | 476 | copy button |
| `#food-added`, `.f-added` (+`.none`), `.f-addbtns` | 457, 458-462, 467 | add sheet |
| `.f-food-name`, `.f-preview` | 445, 448-450 | amount sheet |
| `.f-scanview`, `video`, `.guide` | 453, 454, 455 | scanner |

**Utilities**: `.muted` 152, `.small` 153, `.tiny` 154, `.center` 155, `.mt8` `.mt12` `.mt16` `.mb8` 156,
`.row` 158, `.between` 159, `.grow` 160. `.small` is also a button and tick modifier (130, 371).

**Classes in the markup with no rule**: `compact` (`app.js:1019`), `f-target-note` (`food.js:986`, a hook for
`food.js:1139`). **Rule with no use**: `.stack` (`styles.css:157`).

**What `food.js` needs from the stylesheet** (so a separate stylesheet for the diet app has all of it): every
`.f-*` rule and `#food-added` (`styles.css:408-480`), plus the shared ones: `screen-title`, `card`, `btn` (+
`block`, `small`, `ghost`, `subtle`, `danger`), `btn-row`, `icon-btn` (+ `:disabled`), `input`, `select`, `field`,
`field-row`, `toggle-row`, `seg`, `stat-row`, `stat`, `group-title`, `banner`, `row`, `grow`, `chev`, `muted`,
`small`, `tiny`, `center`, `mt8`, `mt12`, `mt16`, `mb8`, `empty`, and through `sheetHeader` / `openSheet` /
`toast` (`app.js:1547-1558`, `1955`): `sheet`, `sheet-backdrop`, `sheet-panel`, `sheet-title`, `toast`.

### 5.4 Inline styles written from JavaScript

They bypass the stylesheet; a new design has to replace or accept each.

| What | Where |
| --- | --- |
| Fixed widths and centring of number boxes: `width:62px` / `64px` / `90px` / `100px;text-align:center` | `app.js:871`, `872`, `875`, `1480-1487`, `1489`, `1490`, `1497`; `food.js:985` |
| Other box sizes: `width:auto;min-width:170px` (schedule select), `width:auto` (weigh-in select), `max-width:200px` (cardio name), `max-width:150px` (time box), `flex:1;min-width:0` (code box), `width:52px;flex-shrink:0;white-space:nowrap` ("Set 1" label), `text-align:center` | `app.js:1106`, `1491`, `1496`; `connector.js:339`, `311`; `app.js:1632`, `1633`, `1634` |
| Gaps and wrapping: `gap:6px`, `gap:12px`, `flex-wrap:wrap;gap:6px`, `flex-direction:column;align-items:stretch;gap:8px`, `gap:8px` | `app.js:864`, `870`, `875`, `1079`; `1400`; `1137`; `connector.js:338` |
| A label style spelled out: `font-weight:700;text-transform:uppercase;letter-spacing:.05em` | `app.js:1047` (WARM-UP), `1092` (PUMP, JOINT PAIN, WORKLOAD) |
| Heading tweaks: `margin-top:14px`, `margin-top:6px`, `font-weight:500;text-transform:none;letter-spacing:0` | `app.js:1468`; `1569`, `1571` |
| Colours: `color:var(--accent-2)` (muscle name; cloud error line), `color:var(--green)` ("weight ↑"; PR line), `color:var(--amber)` (reason line), `color:<var>` from `cloudColour` | `app.js:950`, `1522`; `1276`, `1618`; `1620`; `1515` with `1528` |
| Data-driven widths `width:N%` | `app.js:427`, `1310`; `food.js:327` |
| Start-up note: `padding:24px 8px;line-height:1.5;font-family:-apple-system,system-ui,sans-serif` | `index.html:45` |
| `.style` from code: `--save-warning-h`; `body.style.overflow` for the sheet; rest bar width; cloud status colour; drag ghost `left` / `top` / `width` | `app.js:350`; `1550`, `1557`; `1940`; `2435`; `food.js:406`, `423` |

### 5.5 Names the JavaScript relies on

Restyle freely, but these are selectors in code. Renaming one breaks behaviour without an error.

- Ids: `#app`, `#topbar-right`, `#save-warning`, `#rest-timer`, `#rest-time`, `#rest-bar-fill`, `#sheet`,
  `#sheet-panel`, `#toast`, `#boot-note` (`index.html`); `#today-notices`, `#checkin-card`, `#bw-form`,
  `#soreness-card`, `#elapsed`, `#cardio-card`, `#cardio-today`, `#ex-form`, `#edit-workout-form`,
  `#import-file`, `#last-export`, `#safety-copies`, `#restore-section`, `#cloud-card`, `#cloud-form`,
  `#cloud-msg`, `#cloud-status` (`app.js`); `#food-added`, `#food-results`, `#food-preview`, `#food-quick-form`,
  `#food-form`, `#food-target-rows`, `#scan-video`, `#scan-status`, `#scan-photo` (`food.js`); `#conn-cards`,
  `#conn-code` (`connector.js`).
- Classes used as selectors: `.tab` (`app.js:759`, `1989`, `2078`; also `tests/lib.js`), `.topbar` (`1722`),
  `.rest-label` (`1930`), `.sync-pill` (`2432`), `.sheet-title h2` (`1551`; `food.js:1152`), `#app > .screen-title`
  (`743`), `.choice-grid` (`1724`), `.set-row` (`1733`), `.prompt` (`1736`), `.f-meal` and `.f-row[data-id]`
  (`food.js:401`, `425`, `430`, `455`, `482`), `.f-mealseg button` (`food.js:1040`, `1090`), `.f-target-note`
  (`food.js:1139`), `link[rel="stylesheet"]` and `script[src]` (`index.html:51`, `63`, `75`).
- Attributes: `data-action` (77 values in `app.js`, 32 in `food.js`, 10 in `connector.js`, 3 in `index.html`),
  `data-field` (`weight`, `reps`, `cardio`, `cardio-name`, `schedule`, `day-name`, `setting`, `chart-ex`, `search`,
  `pick-search`, `food-search`, `food-qty`, `food-unit`, `food-target`, `food-photo`, `conn-code`, `conn-time`,
  `conn-url`), `data-screen`, `data-card`, `data-meal`, `data-e`, `data-s`, `data-v`, `data-k`, `data-id`, form
  field `name`s.
- State classes toggled from code: `active`, `on`, `done`, `has-save-warning`, `system-light`, `f-lifted`,
  `f-ghost`, `f-drop-target`, `f-drop-line`, `f-dragging`.

---

## 6. Charts

All three charts are **inline SVG built as text** in `app.js`. No canvas, no library. Each is
`<svg class="chart" viewBox="0 0 320 H">`; CSS makes it 100% wide and 160 px high (`styles.css:317`).

| Chart | Code | Built from | Sizes written in code |
| --- | --- | --- | --- |
| Sleep, last 14 nights | `renderSleepCard` `app.js:1383-1404` (SVG at `1387-1395`, `1399`) | per night a `<g>` with a `<title>` and up to three stacked `<rect>`s (`sl-deep`, `sl-rem`, `sl-other`), grid lines and labels at 0, 4, 8 h, date labels | 320x150; padding 26 / 6 / 8 / 22; bar corner 1.5; top of scale = 9 h or the longest night |
| Body weight, last 60 | `renderBwCard` `app.js:1411-1435` (SVG at `1417-1425`, `1431`) | grid at low / mid / high, a `<circle class="pt faint" r="2.5">` per weigh-in with a `<title>`, a `<path class="line">` of the 7-entry running average, two date labels | 320x150; padding 36 / 10 / 10 / 22 |
| Exercise progress | `renderChart` `app.js:1437-1472` (SVG at `1450-1462`, `1469`) | grid, a `<path class="line">` through the top-set weights (deload sessions left out), a `<circle class="pt" r="3.5">` per session (`pt deload` = hollow), two date labels | 320x160; padding 34 / 10 / 12 / 22 |

- **No colour is written into the SVG.** Everything comes from classes: line `--accent` 2.5 px, points
  `--accent-2`, grid `--border` 1 px, labels `--muted` 10 px, hollow deload point `--card` fill with `--accent-2`
  stroke, sleep `--sl-deep` / `--sl-rem` / `--border` (`styles.css:318-321`, `398-402`). A new palette changes the
  charts by changing tokens.
- The geometry (size, padding, radii, label positions `x="2"`, three grid lines) is hard-coded in the three
  functions. `<title>` tooltips do nothing on a touch screen; there is no tap interaction on any chart.
- Things that look like charts but are HTML: sets-per-muscle bars and the storage meter (`.vol-bar` > `.vol-fill`
  with an inline width, `app.js:1310`, `427`), the food target bars (`.f-bar > span`, `food.js:327`), the rest
  bar (`#rest-bar-fill`, width set by `app.js:1940` with a 1 s CSS transition), the calendar (a CSS grid).
- The only canvas is off-screen, for barcode frames (`food.js:885-886`). It is never shown.
- The Food screen has no chart and no trend view. A "Trends" tab for the diet app would be new code.

---

## 7. Icons and glyphs

There are no image or SVG icons in the interface. Every icon is a text character. How each one looks depends on
the device's fonts (see section 10).

| Glyph | Code point | Where | Meaning |
| --- | --- | --- | --- |
| ▶ | U+25B6 | `index.html:114` | tab Today |
| ◉ | U+25C9 | `index.html:115` | tab Food |
| ☰ | U+2630 | `index.html:116` | tab Program |
| ◆ | U+25C6 | `index.html:117` | tab Exercises |
| ▤ | U+25A4 | `index.html:118` | tab History |
| ⚙ | U+2699 | `index.html:119` | tab Settings |
| red diamond | CSS shape | `styles.css:88` | brand mark (a rotated 12 px square) |
| ☁ with ✓ … ⏸ ! | U+2601, U+2713, U+2026, U+23F8 | `app.js:776` | cloud pill: synced, syncing, offline, error |
| ✓ | U+2713 | `app.js:1042`, `1048` (ticks), `1019` (folded badge), `864` ("Morning check-in ✓"), `1005`, `1006` ("Logged ✓", "Done ✓"); `food.js:516`, `1033` (added) | done |
| ✕ | U+2715 | `app.js:1558` (close sheet), `394` (dismiss notice), `1047` (clear warm-ups), `1110`, `1407`, `1585`, `1692` (delete row); `food.js:750` (remove from saved meal) | close, dismiss, clear and delete |
| › ‹ | U+203A, U+2039 | chevrons on rows `app.js:806`, `1021`, `1124`, `1251`, `1276`; `food.js:507`, `534`; calendar `app.js:1334`; day switcher `food.js:338`, `340`; "‹ Back" `food.js:595`, `751`, `891`; inside a sentence `food.js:912` | go, previous, next, back |
| ↑ ↓ | U+2191, U+2193 | `app.js:1583`, `1584` (move exercise); `1276` ("weight ↑") | move; went up |
| + − | ASCII plus, U+2212 | "+ Day" `app.js:1112`, "+ New" `1254`, "+ Exercise" `958`, "+ Set" / "− Set" `1073`, "+ Add exercise" `1589`, picker row `1604`; "+ Add food" `food.js:360`, quick add `food.js:516` | add, remove |
| ⋯ | U+22EF | `food.js:359` | meal menu |
| ▥ | U+25A5 | `food.js:494` | scan a barcode |
| ★ ☆ | U+2605, U+2606 | `food.js:507`, `515` (mark in rows), `599`, `707` (star button), `548` (help text) | favourite |
| ✎ | U+270E | `styles.css:407` | before an exercise note |
| 🔥 | U+1F525 | `app.js:817` (streak banner), `1265` (stat tile) | streak |
| 🔴 | U+1F534 | `app.js:820` | red recovery |
| 🏆 | U+1F3C6 | `app.js:1021`, `1050` (PR pill), `1083`, `1618` (PR line), `1276`, `1377`, `1468`, `1471` (History), `1783` (toast) | personal record |
| 🚶 | U+1F6B6 | `app.js:1276` | cardio minutes in the workout list |
| select arrow | CSS gradients | `styles.css:259` | drop-down |
| switch | CSS | `styles.css:197-198` | deload |
| text arrows → ≥ ≈ × · – | | reason lines (`app.js:662-724`), prescriptions, separators | part of sentences, not icons |

App icons: `icon.svg`, `icon-180.png`, `icon-512.png` (a dumbbell, red and white on `#111214`), used by
`index.html:14-15`, `manifest.webmanifest`, and for notifications (`sw.js:114`).

---

## 8. Critique

Frank, for the designer. Picture names are in the screenshots folder (prefix `fresh-dark-` unless another is
given; each has a `-light-` twin).

### 8.1 Hierarchy

1. **Everything is the same box.** Cards, rows, inputs, tiles, choices and buttons are all rounded rectangles
   with a 1 px `--border` line (1.3 to 1.5 : 1 against what is behind it), nested up to three deep (Today's day
   card holds exercise cards: `01-today`; sheets hold cards that hold rows: `41-sheet-edit-day`,
   `rich-dark-48-sheet-workout`). Nothing recedes, so nothing stands out.
2. **Red means six things.** Brand, primary action, selected (segment, day, choice, tab), focus, danger, and
   "over target". A selected "Off" is solid red (`extra-dark-07-settings-whoop-connected-reminders-on`). The
   selected "None" for joint pain looks like an error (`86-workout-feedback-answered`). "Save" (solid red) sits on
   "Remove from Breakfast" (red outline) (`27-food-edit-entry`). The rest timer's "Skip" is the reddest thing on
   the workout screen (`83-workout-set-ticked-rest-timer`).
3. **Today opens on a form.** The morning check-in (five number boxes, about 390 px) is first; "Start workout"
   ends 8 px above the tab bar on the first screen (`01-today`). With the export notice and a recovery banner it
   is pushed off the screen (`extra-dark-01-…`).
4. **The number you lift for is the faintest.** The goal reps is the reps box's placeholder: browser default
   grey, 15 px, weight 500 (`styles.css:219` sets no colour), next to a 19 px bold weight
   (`82-workout-weight-typed`). The prescription line above is 14 px muted. After a tick the logged reps look the
   same as typed ones, so you cannot tell "logged the goal" from "typed".
5. **The workout is a very long page of identical heavy cards.** One open exercise is 665 px for three sets; a
   seven-exercise day is 5,400 to 6,000 px (`80-workout-start-full`). Each card repeats six tool buttons and a
   dimmed "Reps left" row under every set (`80-workout-start`). "Finish workout" is at the very bottom; nothing
   is sticky; progress ("2/6 done") is in 14 px grey under the title.
6. **History is 12 screens with real data** (`rich-dark-40-history-full`), and the list of workouts, the thing the
   tab is named for, comes last, after seven cards. The weekly review's PR bullet is one unbroken paragraph of 20
   lines (`rich-dark-43-history-weekly-review`). "Recent sessions" wraps its dates to make room for the sets
   (`rich-dark-42-history-progress-chart-lower`).
7. **Settings is one undivided list.** The first card has no heading and 13 unrelated rows (appearance, weight
   jumps, rep range, timers, sleep); the page is 3,450 px (`70-settings-full`). Units are missing from the boxes
   ("Rest timer 120"; the unit is only in the grey description).
8. **Food totals are small for the main thing on the screen**: 28 px calories, then three macro cells with 5 px
   grey bars; the macros have no colour identity, so the three bars read as one (`rich-dark-10-food-day`).
   "Set target" disappears once a calorie target exists; after that, targets can only be changed in Settings.

### 8.2 Density and scale

- 13 font sizes between 10 and 28 px, nine corner radii, ten control heights, none of them tokens (5.1). Sizes
  that differ by one pixel sit side by side (13 / 14 / 15 / 16).
- Nearly all text is bold: 700 is used in 24 rules and 800 in 6. With titles, values, labels and buttons all
  bold, weight carries no meaning.
- Small uppercase letter-spaced labels (10 to 12 px) are everywhere: tabs, field labels, section titles, tile
  labels, table headers, the rest label, macro labels. It reads as a dashboard, and 10 to 11 px is small.
- Spacing glitches: the folded check-in card touches the "Start a different day…" button above it, with no gap
  (`extra-dark-02-today-checkin-done-whoop-pill`, `fresh-light-06-today-bottom-checkin-folded`); the recovery pill
  in that card wraps to two lines and breaks the row (`extra-dark-02-…`); settings rows wrap to four lines at
  320 px (`special-w320-05-settings`).

### 8.3 Tap targets under 44 px

Measured on the running app (width x height in CSS px). The common cause: `.btn.small` is 40 px and `.icon-btn`
is 40x40, and both are used far more than the full-size button.

| Size | Control | Where |
| --- | --- | --- |
| 98x25 | "Update ready" pill | top bar (`114-topbar-pills`) |
| 46x28 | cloud pill | top bar |
| 32x32 | `⋯` meal menu | every meal card (`10-food-empty`) |
| 32x32 | `✕` remove a food from a saved meal | `31-food-saved-meal` |
| 40x40 | `✕` close sheet | every sheet |
| 40x40 | `‹` `›` day switcher (Food), `‹` `›` calendar | `10-food-empty`, `60-history-empty` |
| 40x40 | `↑` `↓` `✕` in Edit day; `✕` on weigh-ins, nights, templates | `41-sheet-edit-day`, `104`, `105`, `rich-dark-20-program` |
| 40x40 | star (favourite); warm-up tick | `17-food-amount`, `89-workout-warmups` |
| 42x40 | "On" / "Off" segments; `✕` clear warm-ups | `70-settings`, `89-workout-warmups` |
| 41x41 | calendar day with a workout | `100-history-one-workout` |
| 54 to 89 x 40 | theme segments, "This week" / "Last week", the four-way meal control | `70-settings`, `60-history-empty`, `17-food-amount` |
| any x 40 | every `.btn.small`: "+ Set", "− Set", "Warm-up", "Swap exercise", "Remove", "+ Exercise", "+30s", "Skip", "+ Day", "+ New", "Edit", "Use", "Start", "New", "‹ Back", "Scan barcode", "Quick add", "New food", "+ Add food", "Set target", "Scan a photo", "Type the number", "Rename", "Delete meal", "Edit weigh-ins", "N nights", the day label on Food | workout, Program, Exercises, Food |
| 34x56, 41x65 | day chips and tabs, only at 320 px wide | `special-w320-01-today` |

The controls used most in the gym are the right size: set boxes and ticks 50 px, RIR buttons 63x44, choices
140x50, "Start workout" 48 px. Gaps between neighbours are small though: 6 px between RIR buttons and 10 px
between the tick and the reps box.

### 8.4 Contrast (WCAG ratio, computed from the tokens)

| Pair | Dark | Light | Note |
| --- | --- | --- | --- |
| text on card | 14.5 | 17.9 | fine |
| muted on card / on page | 5.9 / 6.8 | 5.4 / 4.9 | fine; light is close to the limit on grey buttons (4.6) |
| white on the red button | 4.35 | 4.68 | dark theme just under 4.5 for 14 to 16 px bold |
| green text on card ("1,143 left", "weight ↑", PR line) | 8.0 | **3.6** | light theme fails (`fresh-light-26-food-day`, `rich-light-47-history-workout-list`) |
| green pill and calendar "hit" day (green on green-soft) | 5.9 | **3.1** | light theme fails (`rich-light-46-history-calendar`) |
| amber reason line in the workout sheet (`--amber` on `--bg-2`) | 9.5 | **4.1** | light theme fails at 12 px (`rich-light-48-sheet-workout`) |
| placeholder (goal reps, units) on input | **3.8** | 4.6 | Chromium's default `#757575`; Safari's default differs; the stylesheet does not set it |
| idle "Reps left" row (35% opacity) | 1.9 | 1.6 | meant to be faint, but the label is unreadable |
| rest-day chip (55% opacity) | 2.9 | 2.2 | |
| borders on anything | 1.3 to 1.5 | 1.3 to 1.4 | inputs and cards are told apart by a line this faint; in the light theme white cards on `#f3f3f5` barely separate (`fresh-light-01-today`) |
| "Light / other" sleep bars (`--border`) | 1.3 | 1.4 | the largest part of each bar is nearly invisible (`rich-dark-45-history-sleep`) |
| progress line `--accent` on card | 3.7 | 4.7 | fine for a 2.5 px line |

### 8.5 Consistency

- **Five ways to pick one of several**: segmented control (theme, On / Off, meal, week), 2x2 choice grid
  (soreness, feedback), a row of four buttons (reps left), native select (schedule, weigh-in, unit, chart
  exercise), day chips. Their selected states are solid red, red tint, amber tint, native, red tint.
- **On / Off** is a two-button segmented control in Settings and a real switch for Deload.
- **Destructive actions** come in three looks: red-outlined button ("Reset all data", "Delete meal", "Remove from
  Breakfast"), neutral subtle button ("Delete exercise", "Delete day", "Delete workout", "Discard": `53-…-bottom`,
  `41-…-bottom`, `102-sheet-workout`), and a red `✕` icon. The `✕` on weigh-ins and nights deletes at once.
- **`✕` means four things**: close a sheet, dismiss a notice, clear warm-ups, delete a row.
- **Card titles** are made four ways: `.group-title` above the card, `<h3>` inside (`app.js:948`), a bare `<b>` in
  a row (`app.js:864`, `1312`, `1379`), and a tiny uppercase label styled inline (`app.js:1047`, `1092`).
- **Confirmations and names use the browser's own dialogs** (26 `confirm` and 4 `prompt` call sites): a different
  look from the app, and on the phone they carry the site's address.
- **Two scan buttons side by side** in the add sheet: the icon button next to the search box and "Scan barcode"
  under it (`13-food-add-empty`).
- **Sheets**: no handle, no swipe to close, title on the left and a boxed `✕`; "‹ Back" exists in three food
  sheets but "New exercise" opened from the picker has no way back to the picker (`43-sheet-new-exercise`), and
  "New food" has none back to the add sheet (`22-food-new-food`).
- **Emoji next to geometric glyphs**: 🔥 🏆 🚶 🔴 in colour beside ▶ ◉ ☰ ◆ ▤ ⚙ ✕ ✓ in one colour. The tab icons are
  arbitrary shapes (a circle for Food, a diamond for Exercises, a striped square for History); they do not say
  what the tab is.

### 8.6 Feedback and behaviour

- **No pressed state.** `-webkit-tap-highlight-color: transparent` on everything (`styles.css:59`), and only
  `.btn` has `:active`. Rows, tabs, chips, choices, ticks, icon buttons and segments give no sign of a tap until
  the screen redraws. No `:focus-visible` style for buttons.
- **The toast covers controls in a sheet.** It keeps its place above the tab bar even though the sheet covers the
  tab bar: "Added to favorites" hides the meal selector (`18-food-amount-starred-toast`); "Saved "Breakfast""
  hides the list (`29-food-meal-saved-toast`).
- **The rest timer covers 68 px of content** on every tab and has no way to hide it other than Skip
  (`121-save-warning-settings`). Its buttons are 40 px high.
- **Disabled is used for "done"**: "Logged ✓" is a green button at 45% opacity (`97-workout-cardio-done`), the same
  look as the unavailable "Finish exercise" (`95-workout-cardio-and-finish`).
- **Empty states** are one grey centred sentence each (`52-exercises-no-match`, `60-history-empty`); the empty
  History still draws the volume card with eight empty bars.
- **Errors**: form errors are toasts that vanish; the cloud form has an inline red line; the scanner has a status
  line. Three patterns.
- **Search in the add sheet** returns up to 30 two-line rows with long USDA names; the brand search button is at
  the end of them (`14-food-add-search`, `15-food-add-search-bottom`).

### 8.7 What feels dated

Dark grey cards with hairline borders and a red accent; uppercase letter-spaced micro labels; heavy system font
everywhere; Unicode symbols as icons; no depth and almost no motion (one 180 ms sheet fade, one bar transition);
the light theme is the dark layout with the colours inverted (white cards on pale grey, low separation, a dark
splash screen and dark icon). The app looks like a careful developer tool, not like something made for a gym
floor: the layout is the same weight at every level and the eye has to read to find the next action.

What is good and should survive: the big 50 px set boxes and ticks; the one-tap "tick logs the goal"; layouts
that do not move under the finger (RIR rows, cardio card, added line); folded finished exercises; the green
"added" line with Done; plain, specific wording; every state has a sentence.

---

## 9. Layout constraints the redesign must respect

### 9.1 Viewport and safe areas

- `index.html:5`: `width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1`. The page draws under
  the status bar and the home indicator. `apple-mobile-web-app-status-bar-style` is `black-translucent`
  (`index.html:11`); the manifest is `display: standalone`, `orientation: portrait`.
- Insets are read once into `--safe-top` and `--safe-bottom` (`styles.css:25-26`) and used by: top bar padding
  (`78`), screen padding top and bottom (`92`), tab bar height and padding (`100-101`), rest timer position
  (`283`), sheet panel bottom padding (`300`), toast position (`308`, `314`), save warning position (`335`),
  screen padding with the warning (`338`). Left and right insets are not handled (portrait only).
- `.screen` is `max-width: 640px`, centred (`93`); the save warning matches it (`335`).
- Keep input text at 16 px or more: smaller makes iOS zoom the page on focus. Today `.input` is 16, `.set-input`
  19, the amount box 20.

### 9.2 Fixed layers

| Layer | z-index | Rule |
| --- | --- | --- |
| top bar, tab bar | 20 | `styles.css:77`, `99` |
| rest timer | 25 | `283` |
| save warning | 30 | `335` |
| sheet (backdrop and panel) | 40 | `295` |
| toast | 50 | `309` |
| drag ghost | 60 | `436` |

Numbers tied to the bars' sizes, to change together:

- `--tabbar-h` and `--topbar-h` (`styles.css:23-24`).
- The screen's bottom padding is tab bar + 96 px so the last control clears the rest timer (`92`).
- The toast's raised position assumes "the timer is about 68 px tall": the literal `92px` in `styles.css:314`.
  That rule also needs `#rest-timer` to come before `#toast` in the page (`index.html:99`, `127`).
- Drag auto-scroll assumes a 60 px tab bar and 80 px edge zones (`food.js:377`, `416`).
- `scrollToNext` measures the bottom of `.topbar` and of `#save-warning` (`app.js:1721-1722`).
- `body.has-save-warning .screen` adds `--save-warning-h` (`styles.css:338`, set by `app.js:350`).

### 9.3 The sheet

- `#sheet` is `position: fixed; inset: 0`. The panel is anchored to the bottom, `max-height: 88vh`,
  `overflow-y: auto`, padding 16 px plus the bottom inset (`styles.css:297-302`). The whole panel scrolls, header
  included; nothing in it is pinned except `#food-added`.
- `#food-added` is `position: sticky; top: -16px` (`styles.css:457`): the -16 px cancels the panel's 16 px
  padding. Change one, change the other.
- Opening sets `document.body.style.overflow = 'hidden'`; closing clears it (`app.js:1550`, `1557`).
- A sheet that replaces another starts at the top; a redraw of the same sheet keeps its scroll position. "Same" is
  decided by the key passed to `openSheet`, or else by the text of `.sheet-title h2` (`app.js:1549-1555`).
  `food.js` also rewrites that `h2` when the day changes (`retitle` `food.js:1151-1158`). The header must keep an
  `h2` inside `.sheet-title`.
- Closing dispatches `overload:sheetclose` on `document` (`app.js:1557`); `food.js` stops the camera and clears
  its state on it (`food.js:1167-1172`). Any new way to close a sheet (swipe, Escape) must go through
  `closeSheet`.
- The height is in `vh`, not `dvh`: the panel does not shrink when the keyboard opens.
- After choosing an exercise for a day, code scrolls the panel so "+ Add exercise" is in view
  (`app.js:2172-2173`).
- One sheet at a time: a sheet opened from a sheet replaces its content (there is no stack; "Back" buttons
  re-open the previous one by hand).

### 9.4 Keyboards and number boxes

- Number boxes are `type="number"` with `inputmode="decimal"` (weights, amounts, incline, speed) or
  `inputmode="numeric"` (reps, sets, minutes, hours), `step="any"` where decimals are allowed. The barcode and
  pairing-code boxes are text with `inputmode="numeric"` (`food.js:814`; `connector.js:311`).
- Values are saved on `change` (when the box loses focus), not while typing (`app.js:2316-2371`). Exceptions:
  the two exercise searches and the food search and amount, which react to every keystroke (`app.js:2309-2314`;
  `food.js:1117-1126`).
- **Do not redraw the screen when a number box changes.** The handlers patch the page in place on purpose,
  because a redraw on blur swallows the tap that caused the blur: set boxes (`app.js:2322-2335`), cardio
  (`2336-2347`), settings (`2351-2368`), food targets (`food.js:1133-1140`), reps in reserve (`app.js:2125-2132`).
- **Do not let heights change when something is ticked.** The idle "Reps left" rows exist so ticking a set moves
  nothing (`app.js:1028-1037`); the cardio card keeps its size when done (`997-1003`); the added line is always
  there (`food.js:518-521`); folding a finished exercise keeps the next card in place (`renderKeeping`
  `app.js:1709-1714`); after an add, taps are ignored for 350 ms and the same spot for 1 s (`food.js:527-532`).
  A redesign that animates or resizes these has to keep the "nothing moves under the finger" rule.
- Data arriving from the cloud waits to redraw until no box in `#app` has focus (`renderWhenIdle`
  `app.js:491-496`); the connector cards do the same (`connector.js:46-54`).
- A tick with no weight scrolls the weight box to the middle and focuses it (`app.js:2110-2111`). A refused form
  blurs the field so the toast is not behind the keyboard (`app.js:2279`).
- The picker's search has `autofocus` and gets focus again after each keystroke redraw (`app.js:1606`,
  `2312-2313`).
- `form` submits are caught on `document` by id: `#bw-form`, `#cloud-form`, `#ex-form`, `#edit-workout-form`,
  `#food-quick-form`, `#food-form` (`app.js:2251-2307`). The keyboard's Go key submits them.

### 9.5 The tab bar in each app

- Tabs are static markup; `data-screen` is the screen's name and `renderScreen` switches on it
  (`app.js:761-768`). `.tab { flex: 1 }` with content-sized minimums, so widths are unequal today.
- Six tabs at 390 px: 54 to 75 px each, 11 px labels. At 320 px the bar overflows and "SETTINGS" is cut
  (`special-w320-01-today`); the media query at `styles.css:469` only shrinks the letters.
- Training app with five tabs: 78 px each at 390, 64 px at 320. Diet app with three: 130 px each. Both have room
  for a proper icon and a 12 px label, and the 380 px rule can go.
- `goto-settings` (the cloud pill) sets `ui.screen = 'settings'` (`app.js:2243`). The app opens on Today and goes
  back to Today after a workout (`app.js:731`, `1884`, `2381`).
- Removing the Food tab from the training app: `renderScreen` already copes with a missing `__overloadFood`
  (`app.js:763`), and Settings only adds the Food targets card when it exists (`app.js:1500`).

### 9.6 Text built in JavaScript that can be long

| Text | Where | How it is held today |
| --- | --- | --- |
| Day names (typed) | Today card, workout title, Program, History | wraps (`styles.css:204`); at 320 px the workout title takes two lines beside "+ Exercise" (`special-w320-02-workout`) |
| Exercise names (typed, or from programs: "Newtech Seated Row (Outward grip)") | everywhere | wraps in open cards and rows (`276`); one line with ellipsis when folded (`189`) |
| Template names ("My program (before Push/Pull/Legs, 6 Days (RP-style)) · Sat, Nov 21 (2)") | Program | breaks after `/` (`app.js:1109`) and anywhere (`276`) |
| Reason lines, up to about 170 characters ("A lot of joint pain → this is already the lightest step, so the weight stays. Consider swapping this exercise") | open exercise card, next box, workout sheet | wrap |
| Prescription line with units and "each" | exercise card, Today rows | wraps |
| Weekly review bullets (every PR of the week in one item) | History | wraps, unbounded |
| History row sub line (date, counts, duration, cardio, weight ups, PRs) | History | wraps to two or three lines |
| Soreness summary in the workout sheet | sheet | wraps |
| Food names from USDA ("Chicken, broilers or fryers, rotisserie, original seasoning, breast, meat and skin, cooked") | food rows | two lines, then cut (`429`) |
| Amount labels ("1 medium (7" to 7-7/8" long) (118 g)") | food rows, unit select | wrap in rows; the select cuts |
| Sheet titles ("Add to Breakfast · Thu, Nov 19", a saved meal's name, a program's name) | sheet header | wrap beside the buttons |
| Added line | add sheet | two lines, then cut (`460`) |
| Toasts, up to about 130 characters ("Now using X · 4 new exercises · 12 exercises set to the program's sets and reps") | toast | wrap, width up to the screen minus 32 px |
| Program texts (`about`, `how`, `source`, notes in `programs.js`) | program sheet | wrap |
| Messages from outside: cloud errors (`sync.js`), connector errors and the WHOOP name (`connector.js:39`, `88`, `322`), the render error (`app.js:751`) | Settings, error card | wrap; length unknown |
| Dates | everywhere | `toLocaleDateString(undefined, …)`: the phone's language decides the length |
| Numbers | tiles | "102.0k", "1h 29m", "70×12" at 22 px in a third-width tile: about 7 characters fit |

### 9.7 Other constraints

- **One stylesheet per app, loaded with `?v=`.** The start-up rescue (`index.html:51`, `75-78`) and the offline
  cache list (`sw.js:3-23`) know one `styles.css?v=…`. A second stylesheet, a web font or icon files must be added
  to the cache list of the app that uses them and are not covered by the rescue as written.
- **The start-up note must read with no stylesheet** (it carries an inline style, `index.html:45`), and the first
  script must run before paint to set the theme.
- **Icons**: if text glyphs are replaced, inline SVG in the markup needs no extra file and no cache entry.
- **No build step**: no preprocessor, no bundler. `bump.sh` rewrites `?v=` in `index.html` and `sw.js` only.
- **Hex colours outside the stylesheet** to change with a new palette: `index.html:8`, `app.js:475`,
  `manifest.webmanifest`, `icon.svg`, the two PNG icons.
- **`.card.flat` and the sheet share `--bg-2`**: flat cards inside a sheet are told apart by the border alone.
- **Tests** in `tests/` find tabs by `.tab[data-screen]` and `.tab.active`, and many controls by `data-action`.

---

## 10. Open questions

1. **How the icons look on the owner's iPhone.** ▶ ⚙ ☁ ⏸ have emoji forms; iOS may draw them as colour emoji, in
   which case the active tab's red does not apply to them. My pictures are Chromium on Linux. Not answerable from
   the code.
2. **Status bar in the light theme.** With `black-translucent` the status bar text is white and the page draws
   under it; the light top bar is pale grey. Whether the clock and battery are readable in the light theme on the
   phone could not be checked here.
3. **Which theme the owner uses**, and whether the phone is in light mode by day (the default is System).
4. **Placeholder colour in Safari.** The goal reps shows as a placeholder with the browser's default colour.
5. **Does the page behind a sheet stay still on iOS** with only `overflow: hidden` on `body`, and does the keyboard
   cover the bottom buttons of a tall sheet (88vh)?
6. **Units.** There is no kilograms control. Is that wanted in the new Settings?
7. **Native dialogs.** Are the 30 `confirm` / `prompt` call sites in scope for the redesign, or left as they are?
8. **The diet app's Trends tab** has no existing screen or chart to restyle; what it shows is a product decision.
9. **Where food targets are edited in the diet app** once a calorie target exists (today: only Settings).
10. **`lab/scan.html`** (not linked from the app) was not inventoried.
