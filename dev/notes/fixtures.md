# Fixtures, test helper and baseline for v2.8

Everything here was built against the untouched v2.8 code (branch `claude/split-training-diet`, same as
`main`). No app file was changed. New files are under `tests/` only; the gallery is outside the repo.

## What exists now

| Path | What |
| --- | --- |
| `tests/lib.js` | Helper for Playwright tests: static server, phone-like context, storage seeding, tabs, storage read-back, screenshots, fixture loader. |
| `tests/fixtures/make-v28.js` | Builds the fixtures by using the real v2.8 app for 113 simulated days. |
| `tests/fixtures/sim-page.js` | The in-page half of the generator: a clock the simulation moves, and a simulated person who taps and types. |
| `tests/fixtures/v28-state.json` | Main fixture: heavy user, 16 weeks, no workout in progress. 699,190 bytes. |
| `tests/fixtures/v28-state-active.json` | The same data plus today's workout in progress (11 of 22 sets ticked). 702,765 bytes. |
| `tests/fixtures/v28-state-small.json` | Light user: 3 workouts, 4 food days, no targets, default settings. 37,126 bytes. |
| `tests/fixtures/v28-meta.json` | Time zone, "today", "now" (ms), default settings, weekly schedule, the `overload.backup` value per fixture. |
| `tests/fixtures/v28-facts.json` | Per fixture: counts from the data, and what the v2.8 screens show (to assert against). |
| `tests/fixtures/v28-story.json` | What the simulated person did, by date, and every confirm/prompt the app showed with the answer. |
| `tests/fixtures/README.md` | The numbers, the named facts, the dated story. Generated: do not edit. |
| `tests/smoke-v28.js` | Loads each fixture into v2.8 and walks the app. PASS/FAIL list, exit code 1 on failure. |
| `tests/baseline-v28.js` | Screenshots of every screen and the main sheets, dark and light. |
| `/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/ov/baseline-data/` | The gallery: `dark/` and `light/` with 74 PNGs each, and `index.html` showing both side by side. |

## How to run

All from the repo root. Each script starts and stops its own server (`python3 -m http.server`, 127.0.0.1).
`--port=` changes the port; the defaults are in my range (8310-8319), so use your own.

```bash
node tests/fixtures/make-v28.js                 # all three fixtures + meta + facts + story + README, about 100 s (port 8313)
node tests/fixtures/make-v28.js --only=small    # just the light user, 4 s
node tests/fixtures/make-v28.js --today=2026-11-23 --out=/some/folder   # another last day, somewhere else
node tests/smoke-v28.js                         # 73 steps, about 40 s (port 8316); --real-clock, --only=v28-state
node tests/baseline-v28.js                      # gallery into the scratchpad folder above, about 75 s (port 8315); --out=, --theme=dark
```

Using a fixture in a test (the same lines are in `tests/fixtures/README.md`):

```js
const lib = require('./lib');
const fx = lib.loadFixture('v28-state');                       // { text, state, meta, facts }
const server = await lib.startServer(lib.REPO, 8317);
const browser = await lib.launch();
const phone = await lib.newPhone(browser, { now: fx.meta.now, timezoneId: fx.meta.tz });
await lib.seedV28(phone.context, fx);                           // localStorage, before the app's scripts, once per context
const page = await lib.openApp(phone.context, server.url + '/index.html');
await lib.openTab(page, 'history');
const state = await lib.readStorage(page, 'overload.state.v1');
phone.assertClean();                                            // throws on a page error or console error
```

## How the helper behaves (things to know before writing tests)

- **Network.** `newPhone` aborts every request that is not to `http://127.0.0.1` and lists it in
  `phone.blocked`. This also holds for requests made by a service worker (checked: with
  `serviceWorkers: 'allow'` the worker's gstatic fetches are aborted and the cache holds 18 local files only).
  The browser's "Failed to load resource" line for an aborted request is not counted as a console error.
- **Cloud sync never loads in tests.** `sync.js` imports Firebase from gstatic (sync.js:14-21), which is
  blocked, so `window.__overloadSync` does not exist. Settings then shows "Cloud sync is loading…" (3.0: "Cloud sync is not available right now…")
  (app.js:1511) and `syncOn()` falls back to "is there an `overload.sync.v1` key" (app.js:374-378). Nothing
  about cloud sync can be tested until someone writes a local stand-in for the three Firebase modules
  (`context.route` + `route.fulfill`).
- **Clock.** `newPhone({ now })` starts the page's clock at that time and lets it run (timers included).
  The fixtures are meant to be opened at `meta.now` in `meta.tz`: then "today" is the fixture's last day on
  any day the test runs. Without `now` the real clock is used and the data just looks older.
- **Time zone.** Default `America/Los_Angeles`. The fixtures' now is 17:40 there, which is 01:40 the next
  day in UTC. Code that takes "today" from `toISOString()` shows the wrong day against these fixtures.
  The app itself uses local dates everywhere (`todayKey`, app.js:136-140).
- **Seeding is once per context.** `seedStorage` uses `context.addInitScript`, which runs on every load;
  a marker key `__tests.seeded` in localStorage stops it from seeding again, so a reload shows what the app
  saved. `lib.readStorage(page)` hides the marker. `{ always: true }` reseeds on every load.
- **One context = one installed app.** Two pages in one context share localStorage (same origin), like two
  Safari tabs on `/overload/` and `/overload/fuel/`. Two contexts are two Home Screen apps with separate
  storage. Tests of the hand-over need two contexts; tests of "the two apps side by side in Safari" need one.
- **Taps right after adding a food are swallowed by the app.** food.js ignores every click anywhere on the
  page for 350 ms after an Add (`quiet`, food.js:529, checked in the capture listener at food.js:476-481)
  and, for one second, a click on the same spot (`guardSpot`, food.js:532). `lib.openTab` repeats a tap
  that did nothing. In your own steps wait about half a second after an Add before the next tap.
- **Dialogs.** `openApp` accepts `confirm`/`prompt` by default and lists them in `page.dialogs`.
- **Ready.** `openApp` waits for `window.__overload`. For a page that has no such object pass `{ ready }`.
- **Themes.** The main fixtures have `settings.theme: "dark"`, which beats the phone's setting.
  `lib.seedV28(context, fx, { theme: 'light' })` seeds a copy with the theme changed.

## What the fixtures hold

Full tables are in `tests/fixtures/README.md`. In short, for `v28-state.json`:

- 81 exercises (80 built in, 1 custom), 8 with overrides or notes; a 6-day program with 5 days on the
  weekly schedule; 2 templates; 37 prescriptions.
- 70 finished workouts from 2026-08-01 to 2026-11-20: 418 exercise entries, 1,303 sets done, 17 sets left
  unticked, 1,104 sets with RIR, 70 warm-up ramps, 352 entries with feedback, 234 entries with a PR in
  62 workouts, 3 swapped-in entries, 2 deload workouts, 57 with cardio, 2 entries of a deleted exercise,
  1 workout corrected later.
- 96 weigh-ins; 101 nights (63 from WHOOP, 8 typed with WHOOP recovery added, 30 typed only).
- Food: targets 2400 / 190 / 240 / 75; 110 days, 1,576 entries (9 to 16 a day); 64 saved foods (18 with a
  barcode, 7 drinks); 4 foods with `src: custom` (3 typed in, one of them by an unknown barcode, plus one
  listed product whose label was corrected); 6 favourites; 3 saved meals; 39 quick adds; 71 entries in ml or
  fl oz; 2 entries whose food was deleted later; 3 entries with a fractional `at` (dragged).
- Deletion records: 11 food, 2 bw, 2 sleep, 2 workouts.
- Settings off the defaults: `increment` 5, `repMin` 8, `restSec` 150, `theme` dark, `cardioMin` 25,
  `cardioName` "Incline walk", and `reminders` (left by the connector).

Sizes that matter for the hand-over: of the 699 KB, `workouts` is 343 KB and `diary` 296 KB. The food part
(`food` + `diary` + `deleted.food`) is **319,300 bytes** as compact JSON, 573,250 pretty-printed the way
Export JSON writes, 44,878 gzipped (59,840 as base64 of the gzip). One diary entry is about 188 bytes, one
workout about 4.9 KB. The app's own storage budget is 2,500,000 characters (app.js:15); this fixture is at 28%.

Fields found in the data, so nothing is forgotten in a copy or a check:

- top level: `v, settings, exercises, presc, program, workouts, active, bodyweight, sleep, templates, libVersion, deleted, food, diary`
- workout: `id, date, startedAt, finishedAt, dayId, dayName, soreness, entries, cardio?, deload?`
- entry: `exId, plannedSets, weightAtStart, targetReps, sets, pump, joint, workload, done, next, prevPresc, warmups, prs, swappedFrom, soreCut`
- set: `weight, reps, done, rir, auto?`; cardio: `name, min, incline, speed, speedUnit, done, kcal`
- night: `date, total, rem, deep, light?, recovery?, rhr?, hrv?, perf?, src?`
- saved food: `id, src, name, brand, n, serving, servings, usda?, barcode?, liquid?, used?, last?, fav?`
- diary entry: `id, food, meal, qty, unit, amt, name, brand, kcal, p, c, f, at`
- saved meal: `id, name, items[], used?`; item: a diary entry without `id, meal, at`

## How the fixtures were made

`make-v28.js` opens the real app and injects `sim-page.js` before the app's scripts. That file replaces
`Date` in the page with a clock the simulation moves, makes `Math.random` repeatable (the app's ids come
from it), answers `confirm`/`prompt` by rule, and offers `window.SIM`. SIM does everything through the
app's own event handlers on the real DOM: `element.click()`, `value` plus an `input` or `change` event,
taps on submit buttons. Four food moves are real mouse drags done from Node. The page is reloaded every
simulated morning, so v2.8 loaded, normalized and saved the data more than 113 times. At the end the text in
`localStorage['overload.state.v1']` is written out as it is; the script checks that a plain reload does
not change it.

Then each fixture is opened in a fresh context with the clock at `meta.now`; the script checks that v2.8
stores back the same bytes, and reads the numbers for `v28-facts.json` and the README off the screens.

Two things are not the app's own doing, and both are stated in the header of `make-v28.js`:

1. WHOOP nights went through the app's real connector code (`discover`, `refreshStatus`, `syncWhoop`,
   `mergeNights`, connector.js:66-130), but the connector was faked inside the browser with
   `route.fulfill` on a made-up https host. Nothing left the machine.
2. After the last sync `settings.connUrl` and `settings.connKey` are deleted from the state by hand (the
   one direct write, `SIM.dropConnector`). A fixture with a connector link would make every later test
   call a connector that does not exist. v2.8 leaves the same shape when a backup is imported and its
   connector link is declined (app.js:2060-2067). `settings.reminders` stays, as it does there.

The same day and seed give the same bytes: three full runs gave the same sha256 for all three files
(`53db76a6…` main, `9d47e0d5…` active, `e89ed995…` small).

## What I verified

- `node tests/smoke-v28.js`: 73 steps pass. For each fixture, and the main one again in light: the app
  starts and reads the data; the stored text is byte for byte the fixture after start; all six tabs draw;
  Today offers the expected day (or shows the workout in progress, and ticking a set logs it and starts
  the rest timer); a past workout opens with its sets and the Edit sets form; the progress chart of Flat
  Barbell Bench Press has 14 points; yesterday's food day has the expected foods and calorie line; the add
  sheet lists saved meals, favourites and recents, a search finds built-in foods (so `data/foods.json`
  loaded) and a result opens with its numbers; Settings shows v2.8, the four food targets and the list of
  automatic copies; the numbers match `v28-facts.json`; no page error and no console error.
- Odd corners of the main fixture also pass: a workout holding a deleted exercise opens and can be edited;
  an entry whose food was deleted opens as one serving of the logged amount.
- After visiting every screen the stored text is still the fixture (main and small).
- **Export then import is lossless in v2.8**: Export JSON gives a file whose content, re-serialized, equals
  the stored text; importing that file into an empty app gives the same bytes back (all three fixtures,
  including the one with a workout in progress). The file is named `overload-backup-YYYY-MM-DD.json`.
- `--real-clock` passes today (the fixture's day).
- A build for a Monday (`--today=2026-11-23`) works and tells the same story: 70 workouts, 110 food days,
  1,576 entries, the same next-time lines for the four named exercises.
- The gallery was looked at: Today with the plan and streak, the food day with totals, the bench press
  chart with a deload dot, the workout in progress with the rest timer, the add sheet with saved meals and
  favourites, light and dark.
- In 113 simulated days, thousands of taps and 50 dialogs, **v2.8 raised no page error and no console error**.

## What the gallery shows

`dark/` and `light/`, 74 views each: Today (plan, check-in edit, other days, rest day, edit exercise,
backup reminder), Food (today, yesterday, edit entry, meal menu, add sheet, saved meal, amount, search,
quick add, new food, scan without a camera), Program (days, edit day, picker, library program), Exercises
(list, edit, new, search), History (stats, weekly review, calendar, chart, body weight and sleep, weigh-in
and sleep lists, workout sheet, edit sets, toast, deload), Settings, the workout in progress (as opened,
top, full, soreness check-in, finished exercise, warm-up, rest timer, feedback, swap, cardio, deload on,
Food tab during a workout), the light user (Today, Food without targets, targets sheet, empty day with the
copy offer, History, WHOOP / Reminders / Food targets and Backup / Cloud / Danger cards), a first start,
the "data cannot be read" screen, and the storage-full banner. `-full` files are whole pages.

## Surprises while building the data

None of these is a crash. They are behaviours a test or a migration can trip over.

1. **Drawing a screen changes what the next save writes.** `prescFor` creates a prescription record for
   every exercise it is asked about and that has none (app.js:505-508), and Today asks for each exercise
   of the selected day. Steps: start the app with no data (0 prescriptions stored at start), open
   Settings, tap Reps in reserve Off: 7 prescriptions are now stored (on a Saturday). `ensureCardio` does
   the same for a workout's cardio block (app.js:972-977). So "the bytes did not change" can only be
   asserted right after start, or after actions known not to save. With the fixtures it holds after
   visiting every screen, because every listed exercise already has its record.
2. **A rep range changed in Settings does not move goals that already exist.** The Settings handler
   (app.js:2351-2368) does not touch prescriptions; only an exercise's own range does (`goalToRange`,
   app.js:1169). Combined with point 1: in the fixture the range went from 10-12 to 8-12 on the first day,
   and the five exercises Today had already drawn started with "8-12 · goal 10". One record of that kind
   is still there for an exercise never logged (Rear Delt Fly: weight 0, goal 10).
   Because the default program's day depends on the weekday, a fixture built on another weekday differs a
   little in training numbers (same story, same totals for workouts and food).
3. **Deletion records expire by themselves.** `normalize` drops records older than 90 days at every start
   (app.js:285-289). The oldest record in the main fixture is 72 days old at `meta.now`. With the real
   clock, from 18 days after the build the app writes back different bytes on first load. Use `meta.now`.
4. **Sets ticked without typing carry `auto: true` for good** (app.js:2116), and unticked sets stay in a
   finished workout with `done: false, reps: 0` (only whole entries are dropped at Finish, app.js:1880).
   514 and 17 of them in the main fixture.
5. **`at` of a diary entry is not always a whole number, and not unique by construction.** A dragged entry
   gets the mean of its neighbours (food.js:394), so `x.5` values exist; copies get `now + i` (food.js:714).
   Cloud sync orders a day by `at`.
6. **A corrected listed product keeps the product's id but changes shape.** "Numbers wrong? Fix them"
   stores it under the same `u…` id with `src: custom` (food.js:839), per-100 g numbers that are no longer
   round (`316.6666666666667` kcal, food.js:843), an empty `servings` list, and the barcode with a leading
   zero added (13 digits, where the list has 12).
7. **A deleted custom food leaves entries pointing at nothing** (`forgetFood`, food.js:859-864). v2.8
   opens such an entry as one serving of the logged amount (food.js:689-692). Two in the main fixture.
8. **A mistyped weigh-in is accepted.** The check-in only requires a weight above 0 (app.js:887): 18.6 for
   186 is stored, drawn on the chart and used for cardio calories and the protein note until it is deleted.
9. **`settings.reminders` appears only after the connector was used** (connector.js:30-34). It holds a
   `food` reminder next to `checkin` and `workout`, so it belongs to both future apps.
10. **The app's storage counts as full only when the data grows.** Filling the origin's storage and saving
    the same-sized state still works; the banner came with the next food added. The gallery has it.
11. **Chromium here has no `navigator.canShare`**, so Export JSON goes down the download branch
    (app.js:1969-1986). The share-sheet branch the iPhone uses is not exercised by any test here.
12. **An unknown barcode cannot reach Open Food Facts in tests**, so the app always takes its "Could not
    reach the food database" branch (food.js:974-977) and offers the label form. The "found" and
    "not in the database" branches need a stand-in answer.

## Hazards for the planned change, seen from here

1. **Losing food data shapes in the copy.** The hand-over must carry `food.targets`, `food.foods` (with
   `fav`, `last`, `used`, custom foods, the corrected `u1903553`), `food.meals`, every `diary` day, and
   `deleted.food`. Precaution: after the hand-over, compare with `fx.state` key by key, and assert the three
   food days and the add-sheet counts from `v28-facts.json` in the new app.
2. **Entries of deleted foods and quick adds.** 2 entries have a `food` id that is not in `food.foods`,
   39 have `food: null` and `qty: null`. A copy that "cleans up" by joining entries to foods drops them.
   Precaution: copy `diary` as it is; the smoke test's "entry whose food was deleted" step is the model.
3. **Size of a pasted hand-over.** 319 KB of food JSON (573 KB pretty) is a lot for a clipboard and a
   text box on a phone; gzip brings it to 45 KB. Precaution: test the real size with this fixture, in
   both directions, not with the small one.
4. **The training app must keep opening old data unchanged.** v2.8 round-trips these fixtures byte for
   byte. Precaution: the same check on the new training app, allowing only the differences that are
   decided (and none in `food`, `diary`, `deleted.food`, which it must leave alone). A roll-back test:
   data saved by the new training app must load in v2.8 (serve the v2.8 files from git) and show the same
   three food days.
5. **A workout in progress across the update.** Use `v28-state-active`: 2 exercises finished, one half
   done, cardio not done, `state.active` set. The new training app must open on that workout with 11 sets
   ticked.
6. **Shared keys in Safari.** In a browser tab both apps share localStorage. `overload.theme`,
   `overload.backup` and the seed marker are per origin, not per app. Precaution: test both apps in one
   context as well as in two.
7. **Tests that pass for the wrong reason.** A tap swallowed by the food guard, or a state that was
   reseeded on reload, makes a test look at the wrong thing. Precaution: use `lib.openTab`, wait after an
   Add, and assert a visible result after every step, as `sim-page.js` does with `need(...)`.
8. **`tests/` goes live with the site.** GitHub Pages serves the whole repo (`.nojekyll`), so
   `/overload/tests/` and its 1.7 MB would be public once merged. The data is made up, and the app never
   requests it. Decide whether that is fine or whether `tests/` stays off `main`.

## Open questions

- The real phone's data was written by every version since v1 (first commit 2026-09-20, so about nine
  weeks, not sixteen). These fixtures are pure v2.8. Shapes that only older versions wrote and v2.8 keeps
  (a corrected product saved under a new id next to the original, portions cut to 8, entries without
  `at`) are not in them. Is a real export from the phone available to test with?
- Does the owner use cloud sync or the WHOOP connector today? The fixtures have neither (`overload.sync.v1`
  absent, no connector link), and neither can be exercised in tests without stand-ins.
- Which app keeps `settings.reminders.food`, body weight (the food targets note reads it) and sleep?
- Should `tests/` be deployed with the site?
