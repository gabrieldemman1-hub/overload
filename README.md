# Overload

A personal hypertrophy tracker for one phone. Log weight, sets and reps; the app
tells you what to lift next time based on the rep range and how you recovered.
Modelled on the RP Hypertrophy app's flow, without mesocycles; any workout can
be logged as a deload.
Food (calories, protein, carbs and fat against daily targets) is logged in a
separate app, Fuel: see Two apps below.

This repository holds both apps: Overload at the root, Fuel in `fuel/`, and the
files they share in `shared/`. They are released together under one number
(see Releases below).

No build step. Data lives in the browser on the phone, and optionally mirrors to
a Firebase account (see Cloud sync below) so it survives clearing the phone.

## Progression rules

Rep range defaults to 10–12 (change it in Settings, or per exercise).

| What you logged                    | Next time                                        |
| ---------------------------------- | ------------------------------------------------ |
| Every set hit 12                   | Weight goes up one jump (2.5 lb), goal back to 10 |
| Some sets hit 12                   | Same weight, push every set to 12                |
| Every set at least 10              | Same weight, goal is your lowest set + 1         |
| A set fell below 10                | Same weight, build back to 10                    |

Details:

- The rules are judged on the sets at the heaviest weight you used. Lighter
  back-off sets are logged but do not pull the next weight down.
- When one jump is big for the weight (5 lb on a 30 lb cable), the top of the
  range stretches first, to the reps that make the heavier weight still reach
  the bottom of the range (30 lb × 17 ≈ 35 lb × 10), at most 20. If even 20
  would not pay for the jump, the reason line suggests a smaller weight jump
  for that exercise (Edit exercise → Weight jump).
- Bodyweight moves with no added weight progress by reps only: the goal keeps
  going up past the range. Enter added weight (belt, vest) to switch to load.
- Assisted moves (any exercise with "assist" in the name) go the other way: the
  logged weight is the assistance, and progress takes it off.

Feedback after each exercise (pump, joint pain, workload) and a soreness
check-in at the start of the next session for that muscle adjust the number of
sets:

| Feedback                                      | Sets |
| --------------------------------------------- | ---- |
| Still sore, or moderate+ joint pain, or "too much" | −1   |
| Recovered early and low pump                  | +1   |
| Never sore and workload felt easy             | +1   |
| A set was cut for soreness and soreness has cleared | +1 (the cut set comes back) |
| Anything else                                 | keep |

Moderate joint pain blocks a weight increase for that session. "A lot" of joint
pain takes about 15% off the weight (at least one jump, never below one jump)
and suggests swapping the exercise. Sets are
capped between 1 and the "Max sets" setting (default 6). A +1 is also skipped
when the muscle's planned weekly sets (prescribed sets × times scheduled) would
go past the top of the weekly sets target in Settings (default 20).

## Also in the app

- **Fast logging.** The reps box shows the goal. Tap the tick beside an empty box to log the goal as done; type a number only when you missed or beat it. Unticking a set ticked that way empties it again. Sets you typed but did not tick are counted when you finish. A barbell, dumbbell, machine or cable set cannot be ticked at 0 lb. The minus Set button removes the last empty set (it asks before removing a logged one).
- **Back where you left off.** Opening the app or going back to Today during a workout scrolls to the next set, or to the check-in while it still has unanswered questions and nothing is ticked. The answered check-in folds to one line (Edit opens it) and finished exercises fold to one row with their sets, next weight and PR mark (tap to open).
- **Reps in reserve.** Optional. Each set has a row of four buttons under it (3+, 2, 1, 0), greyed out until you tick the set, so ticking never moves the sets below. Tap the reps you had left; tap the picked one again to clear it. 3+ on every set moves the weight up a session early when the jump is not a big one and the spare reps would pay for it.
- **Warm-up generator.** One tap builds a 50 / 70 / 85 percent ramp from your working weight, with its own shorter rest timer. Warm-ups never affect progression.
- **Swap.** Replace an exercise for today only, without touching the program. Sets you already logged are kept: that exercise is finished as it is and the new one goes right after it.
- **Deload.** Start as deload on Today (or the Deload switch in a workout) logs the session without changing any next-time weight, set count or goal, and without trophies. History tags it Deload, and the progress chart shows it as a hollow dot off the line (it does not count as your current top set).
- **During a workout.** The top bar shows the workout's name, exercises done, the time so far and one block per set, filled as sets are ticked. The rest timer sits above the tab bar and says what the rest is before ("Set 3 of 3 next").
- **Finishing.** Finish workout asks first when exercises still have unticked sets. The cardio card keeps its size after Done, so the next tap cannot land on Finish by mistake.
- **PR alerts.** Heaviest set, best estimated one-rep max, or most reps at a weight, flagged when you finish an exercise and listed under the progress chart.
- **Weekly volume.** Sets per muscle this week against a target range you set.
- **Body weight.** Weigh-in reminder at a frequency you choose, with a running-average chart and 30-day change.
- **Program templates.** Save a split and switch between them later.
- **Morning check-in.** The top of Today asks for body weight and last
  night's sleep (time asleep, REM, deep, in hours and minutes from your watch
  or sleep app). Once saved it shrinks to one line under the workout, with Edit.
  History charts the last 14 nights (deep / REM / other) with 7-night averages,
  and the weekly review shows average sleep and cardio minutes. Weigh-ins
  default to every day; change that or turn sleep off in Settings.
- **Cardio after lifting.** Every workout ends with a cardio card (default:
  20 min incline treadmill walk). Enter incline and speed (carried over from
  last time), start the 20:00 timer, and it logs itself when the time is up,
  or tap Done. Finishing without it asks whether to log it. History shows the
  minutes, incline, speed and an estimated calorie burn (ACSM walking formula,
  from your last weigh-in). Change the name, minutes or turn it off in
  Settings → Cardio.
- **Program library.** Eleven built-in programs on the Program tab: Chris
  Bumstead's 5-day split, Push/Pull/Legs, Olympia split and an Arnold-style
  split; Hany Rambod's FST-7 classic 5-day, FST-7 arms & calves twice, and the
  Phil Heath FST-7 split; a 6-day, machine- and cable-based Push/Pull/Legs
  on Renaissance Periodization's method (every muscle twice a week, sets
  added from your feedback, RIR 3→0, then a deload); and three arm-focused programs (RP's arm
  specialization, a full-body arms emphasis in the RP app's style, and an
  upper/lower arms emphasis). View shows the week and every exercise's sets ×
  reps; Use switches to it, saving your own days and schedule under Templates
  first. Every exercise gets the program's sets and rep range (and its note,
  if it has none); weights stay. When some exercises already have your own
  logged sets, it asks once whether to switch those too; OK gives them the
  program's sets and ranges, Cancel keeps yours. Switching back to a template
  does not bring your own sets and ranges back. FST-7 finishers are their own
  exercises ("Pec Deck (FST-7)"), always 7 sets with 35–50 s rest. Where a
  source was paywalled or thin, the program says what it was built from.
- **Consistency calendar and streak.** Training days by month: trained days are filled, deload days hollow, days still planned outlined, and a day with a PR has a dot. The streak counts scheduled days only.
- **Weekly review.** Workouts, sets, tonnage, weight increases, PRs and body weight trend for this week or last, with a Share button.
- **Equipment-aware jumps.** Barbell, dumbbell, machine and cable each have their own default weight jump (2.5 / 5 / 5 / 5 lb), with a per-exercise override.
- **Exercise notes and rest.** Seat height, handle, pin position, and a per-exercise rest time, shown and used during the workout.
- **Fix a past workout.** Edit the sets of any finished workout. Trophies are worked out again, and when it was the latest time you did an exercise and the correction changes how it went, next time's weight and goal follow. Deleting the latest workout for an exercise rolls its next-time weight back.
- **Sound when rest is over.** A short beep, since iPhones ignore web vibration. The phone's mute switch silences it, and no web app can alert you while the phone is locked.

## Two apps

Since 3.0 there are two apps on the same site. Each is added to the Home Screen
on its own and keeps its own data.

| | Overload (training) | Fuel (food) |
| --- | --- | --- |
| Address | the site itself | `fuel/` |
| In the repository | the root | `fuel/` (its own `README.md` says how it is built) |
| Holds | exercises, program, workouts, weigh-ins, sleep, WHOOP and reminders | food targets, saved foods and meals, the food diary |
| Saved under | `overload.state.v1` | `fuel.state.v1` |
| Offline cache | `overload-vN` (`sw.js`) | `fuel-vN` (`fuel/sw.js`) |

Both load the same stylesheet and icon set from `shared/`; Fuel also uses the
food list in `data/` and the barcode reader in `vendor/`. On an iPhone each
Home Screen app has its own storage, so the two never see each other's data.

Overload no longer shows or changes food. The food data it held stays in its
saved data on the phone (the "old food log") until you remove it yourself, so
updating loses nothing and v2.8 still finds everything after a roll-back. On
its first start 3.0 also keeps a copy of all data as it was: "Before the split
into two apps" under Settings → Backup → Automatic copies.

Moving the food log to Fuel is done from the card "Food has moved to Fuel". It
is on Today until you hide it, and always in full in Settings → Food. Once you
have copied the log or saved the file, the card on Today becomes a short one:
it says what to do next in Fuel and has Copy again (or Save again). A hidden
card comes back to Today when the food log on the phone changes.

1. **Get Fuel** opens `fuel/` in Safari; there, Share → Add to Home Screen.
   Copy link gives the address to paste into Safari if it does not open.
2. **Copy my food log** puts the log on the clipboard as text; **Save as a
   file** writes the same as `overload-food-YYYY-MM-DD.json`. Both hold the
   targets, saved foods and meals, every food day, the record of deleted
   entries, the units, the theme and the latest weigh-in, and nothing else (no
   training data, no connector key).
3. In Fuel: **Paste from Overload**, or Choose a file.

Fuel adds only what it does not have yet, with the favorite stars and the
numbers you corrected; nothing else there is replaced or removed. A star you
took off in Fuel, or a correction you deleted there, stays that way when the
log is brought in again (`fuel/README.md`).

With cloud sync, signing in to Fuel with the same email may bring some of the
food log across, but not always all of it: since 3.0 Overload no longer sends
the food log to the account, so the account can hold less than the phone. Copy
the log or save the file as well.

If food is logged in Overload again after a copy (an older version can still
start while an update has only half arrived), the card comes back and says so.

**Remove the old food log from Overload** (same card, in Settings) frees its
space once Fuel shows the log. It is offered only when the log was copied or
saved as it is now, asks twice, and empties the food days only; saved foods and
targets stay. Each removal first keeps a copy of everything ("Before removing
the old food log" in Automatic copies), and nothing is removed if that copy
cannot be stored, or if the list of copies cannot be read. The copies of the
last 3 removals are kept; the question says when an older one is let go, by its
date (and its time when another removal copy is from the same day). Signed in to cloud sync while an update has only
half arrived, it asks you to finish the update first (open Overload once with
good signal).

What was copied and when is noted on the phone beside the data
(`overload.backup` in the browser's storage), never in the data itself.

The clipboard text is `OVERLOAD-FOOD:1:` followed by base64 of the gzipped
JSON, or `OVERLOAD-FOOD:0:` and base64 of the JSON where the browser cannot
gzip. The format is in `dev/notes/SPEC.md`, section 5.

## Fuel: the food log

Since 3.0 this is the app Fuel (`fuel/`), not a tab of Overload. This section
says what it does; `fuel/README.md` says how it is built and how its data is
kept.

Fuel's Today screen tracks calories, protein, carbs and fat for each day, in
Breakfast, Lunch, Dinner and Snacks, against targets you set (Settings → Food
targets, or tap the target under the calorie gauge). Any target can be left
empty. Trends shows the last 14 days and this week's averages against last
week's.

Adding a food:

- **Search.** Your recent foods first, then about 7,700 common foods from USDA
  FoodData Central (public domain). 87 everyday foods ("Chicken breast, cooked
  (roasted)", "Milk, 2%", "Ground beef 93/7, raw") have short names and come
  first. Raw and cooked are separate entries; weigh and log the same one.
  The list is stored with the app, so search works offline.
- **Packaged foods.** About 650 popular products, weighted to Costco and
  California grocery stores (Eggo, Kodiak, PopCorners, Quest, Premier Protein,
  Fairlife, Chobani, Kirkland Signature, Trader Joe's, Dave's Killer Bread…),
  from USDA Branded Foods label data, a few from Open Food Facts. They open at
  the label serving ("2 waffles (70 g)"), drinks go in ml and fl oz, and their
  barcodes are in the list, so scanning them works offline too.
- **Store brands.** About 300 more from the stores I shop at: Sprouts,
  Albertsons/Safeway (Lucerne, Signature Select, Signature Farms, Signature
  Cafe, O Organics, Open Nature, Primo Taglio, Waterfront Bistro) and Costco
  (Kirkland Signature). Search the brand ("lucerne cottage", "sprouts ground
  turkey").
- **Brands.** "Search brands" looks the name up in Open Food Facts (needs a
  connection).
- **Scan a barcode.** Live camera, or Scan a photo, or type the number. Your
  own foods are checked first, then the built-in list, then Open Food Facts. Anything scanned or typed in is saved on
  the phone, so the next scan of that barcode is instant and works offline.
- **Not found?** Type it in once from the label (per serving, with the serving
  weight if you want grams and ounces too). The barcode is remembered. "Numbers
  wrong? Fix them" does the same for a product whose data is off, and your
  corrected version replaces the built-in one (its star and past entries stay).
- **Quick add.** Just calories and macros, no food. Leave calories empty and
  they are worked out from protein, carbs and fat; 0 is allowed.

Faster logging:

- **Several foods per trip.** After Add, the Add sheet stays open on the same
  list or search, with an "Added: …" line and Done. Favorites and Recent rows
  show what one tap logs, and their + logs it at once.
- **Favorites.** Tap the star on a food to keep it at the top of the add sheet
  and of search results.
- **Saved meals.** A meal's menu (the three dots) → Save as a meal. It then sits at the top of
  the add sheet (and in search); one tap logs every food in it to any meal.
  Rename it, drop a food from it, or delete it from the same sheet.
- **Copy.** The same menu copies yesterday's version of that meal, copies a past
  day's meal to today, or clears the meal. An empty day offers to copy the whole
  day before in one tap.
- **Move foods between meals.** Hold a logged food for a moment, then drag it to
  another meal (or to another spot in the same meal); with a mouse, just drag.
  Near the top or bottom of the screen the page scrolls. A quick swipe still
  scrolls and a tap still opens the food, whose Meal buttons also move it.

Amounts go in grams, ounces, the label serving, or a USDA serving (1 cup,
1 medium). Switching units keeps the weight: 200 g becomes 7.1 oz. A food
remembers the last amount you used; a food you never logged opens at its first
named portion, or at a whole one when the first is a cup (1 medium apple, half an
avocado), and a big dry cup (rice, flour, beans) opens at a quarter or half cup.
Each logged entry keeps its own numbers, so editing or deleting a
food later never changes past days, and opening an entry and saving it with the
same amount keeps them too.

Today goes back to the current day on a new day or after 30 minutes away. A past
day, or a sheet still open from yesterday, names that day in its title.

## Files

Overload, at the root:

| File                   | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `index.html`           | The page: top bar, tab bar, rest timer, sheet (a dialog: while it is open the page behind is inert, and Escape closes it), toast (read out by VoiceOver). Also the start-up rescue, which starts the previous release's stored files (same first number) when this release's did not arrive |
| `overload.js`          | State, progression algorithm, all screens, the hand-over of the food log to Fuel (`app.js` until 2.8: see Releases) |
| `connector.js`         | WHOOP sync and reminders in the app (talks to the connector) |
| `programs.js`          | Built-in program library (CBum, FST-7, arm programs) |
| `train.css`            | The rules only Overload needs (week strip, exercise card, set rows, rest timer). Loaded after `shared/ui.css` |
| `sync.js`              | Optional cloud sync via Firebase (training data only) |
| `backup.js`            | Automatic safety copies (IndexedDB): one a day, and one before an import, reset, restore, cloud sign-in or removal of the old food log, and at the split |
| `sw.js`                | Service worker so the app opens offline (cache `overload-vN`; see Releases) |
| `manifest.webmanifest` | Home-screen install metadata                 |
| `icon*.png`, `icon.svg`| App icons                                    |

Fuel, in `fuel/` (see `fuel/README.md`):

| File                   | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `fuel/index.html`, `fuel/fuel.js` | The page and the shell: data, Welcome, Trends, Settings, backups, the import from Overload |
| `fuel/food.js`         | The food diary and its sheets (until 2.8 this was `food.js` at the root) |
| `fuel/fuel.css`        | The rules only Fuel needs                    |
| `fuel/sync.js`, `fuel/backup.js`, `fuel/sw.js` | Fuel's own cloud sync, automatic copies and offline cache (`fuel-vN`) |
| `fuel/manifest.webmanifest`, `fuel/icon*` | Fuel's Home Screen metadata and icons |

Used by both apps, or by Fuel from outside its folder:

| File                   | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `shared/ui.css`        | The look both apps share: colours, type and every shared component. `data-app` on `<html>` picks the app's accent |
| `shared/icons.js`      | The icon set: `icon('name')` returns an inline SVG |
| `data/foods.json`      | USDA food list for Fuel, built by `tools/build_foods.py` |
| `vendor/zxing/`        | Barcode reader for Fuel (zxing-wasm 3.1.4, MIT), self-hosted |
| `firestore.rules`      | Firestore security rules to paste in Firebase (one rule covers both apps) |

Everything else:

| File                   | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `bump.sh`              | Sets the release number in both apps and checks the release (see Releases) |
| `connector/`           | The connector: a Cloudflare Worker (`worker.js`, `wrangler.toml`) |
| `connector.json`       | The connector's address, written by the Deploy connector action (see WHOOP below) |
| `.github/workflows/`   | GitHub Actions: deploy the connector, build the food list and its packaged foods |
| `tools/`               | Food list builder, everyday foods (`staples.tsv`), packaged foods (`branded_wishlist.txt` → `branded.tsv`) |
| `tests/`               | Tests for both apps (`train-*.js`, `fuel-*.js`; see Run it), made-up v2.8 data in `tests/fixtures/` and a stand-in for Firebase in `tests/fake-firebase/` |
| `dev/`                 | Notes for whoever works on the code: the spec of the split (`dev/notes/SPEC.md`), the builders' notes, the design system (`dev/design/SYSTEM.md`) |
| `lab/scan.html`        | Stand-alone barcode test page (not linked from the apps) |

## Run it

Any static file server works. For example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` for Overload and `http://localhost:8080/fuel/`
for Fuel. Serve the repository root, not `fuel/` alone: Fuel loads `shared/`,
`data/` and `vendor/` from one folder up. Opening Overload's `index.html`
directly from disk also works (the service worker is skipped in that case).

On a computer both apps share one browser storage, so Fuel offers to bring the
food log across on the spot. On an iPhone they do not: see Two apps.

The tests need Node and Playwright (Chromium). Each takes `--port=`: most start
a local server on that port, and the cloud tests answer the app's files inside
the browser instead. They never reach the internet: every request that is not
to 127.0.0.1 is stopped. The worker tests use a sealed browser (`tests/lib.js`)
that stops every other host itself, so their phones need no request routing,
which would make Chromium install the same worker again at every start. Run
them one at a time.

Overload:

```bash
node tests/train-upgrade.js    # 2.8 data opened by 3.0: nothing lost, every screen draws
node tests/train-handover.js   # the card "Food has moved to Fuel": copy, file, the short card, remove
node tests/train-replace.js    # Import, Restore and Reset keep the old food log, and their copy comes first
node tests/train-rollback.js   # 2.8 running again on data 3.0 has used
node tests/train-backup.js     # the automatic copies, also as 2.8 uses them (takes --port and the next one)
node tests/train-settings.js   # what Settings says about the copies, storage used and cloud sync
node tests/train-timer.js      # the rest and cardio timers across a reload
node tests/train-look.js       # the cloud status at 320 px, sheets as dialogs, field names, focus clear of the bars
node tests/train-rescue.js     # the start-up rescue in index.html
node tests/train-connector.js  # what is sent to the connector
node tests/train-sw.js         # the offline worker, with real service workers
node tests/train-mixed.js      # a release on weak signal: the page that runs is one release, never a mix
node tests/train-release.js    # stale server copies, an install cut off, the next releases: what the phone keeps
node tests/train-sync.js       # cloud sync against a stand-in for Firebase (--base=v28: beside 2.8's files)
node tests/train-cloud.js      # cloud sync with two phones: Reset, Import and Restore (also before cloud sync loads), signing out, saved data gone missing
node tests/train-bump.js       # bump.sh: which release numbers it takes and what it changes
```

Fuel (`fuel/README.md` says more):

```bash
node tests/fuel-shell.js       # first start, a day of use, reload, the saved state's shape
node tests/fuel-import.js      # every way in from Overload, second imports, malformed input
node tests/fuel-guard.js       # Safari tab, inside Overload, Home Screen app, a computer
node tests/fuel-backup.js      # export and import, automatic copies, restore, unreadable data, storage full
node tests/fuel-records.js     # a star taken off and a correction deleted in Fuel stay so
node tests/fuel-words.js       # what Welcome, the import, Backup, Cloud sync and sign-out say, against what happens
node tests/fuel-trends.js      # Trends left open over midnight follows the date
node tests/fuel-look.js        # Today's three macro cells at 320, 390 and 430 px; the frame as train-look.js checks it
node tests/fuel-host.js        # what the shell gives cloud sync
node tests/fuel-update.js      # how the page takes a new offline worker
node tests/fuel-rescue.js      # the start-up rescue in fuel/index.html
node tests/fuel-sync.js        # cloud sync against a stand-in for Firebase, next to Overload
node tests/fuel-sw.js          # the offline worker with real service workers, alone and beside Overload's
node tests/fuel-release.js     # stale server copies, an install cut off, the next releases: what the phone keeps
```

And the tools under them:

```bash
node tests/fake-firebase/selftest.js   # the stand-in for Firebase itself
node tests/smoke-v28.js        # every v2.8 fixture opens in v2.8 without an error
node tests/baseline-v28.js     # pictures of v2.8 with the fixtures, for comparing (--out=<folder>)
```

`tests/lib.js`, `tests/train-common.js` and `tests/fuel-common.js` are the
helpers they share; `tests/fixtures/` holds the made-up v2.8 data they start from.

## Put it on an iPhone

1. Host the folder somewhere with HTTPS. GitHub Pages is the easiest: push this
   folder to a repo, then Settings → Pages → deploy from the branch.
2. Open the page in Safari on the phone.
3. Tap Share, then **Add to Home Screen**.

It launches full screen, works offline, and keeps its data between launches.
After an update, open it once on Wi-Fi (Settings shows the new version) before you
rely on it offline. If an update only half arrived on a weak signal, the app starts
with the previous version it still has, or says it did not finish starting (what
you logged stays on the phone), and finishes the update next time there is signal.

Fuel is added the same way from its own address (`…/fuel/`), as a second Home
Screen app. Get Fuel on Overload's card "Food has moved to Fuel" opens that
address in Safari.

## Releases

Both apps are released together under one number. From the repository root:

```bash
sh bump.sh 3.1           # set the release to 3.1 in every place, then check
sh bump.sh --major 4.0   # the same, for a new first number
sh bump.sh --check       # change nothing, only check
```

A release number is two whole numbers with a dot, like `3.1`, and must be
higher than the current one (`3.10` comes after `3.9`). A new first number
needs `--major`: the start-up rescue only falls back to an older release with
the same first number, so a phone whose update to `4.0` arrives only half has
nothing to fall back to.

A new number changes the `?v=` on every file address in `index.html`, `sw.js`,
`fuel/index.html` and `fuel/sw.js`, `VERSION` in `overload.js` and `fuel/fuel.js`,
`release` in `sync.js`, the first line `/* release 3.0 … */` of every other
script and stylesheet the workers store (both apps and `shared/`), and moves
both offline cache names on by one (`overload-vN`, `fuel-vN`), also when only
one app changed. Commit the result and push; a phone picks the release up the
next time the app is opened with a connection.

Every change to a file the workers store, and to `sw.js` or `fuel/sw.js`
themselves, needs a new number. A worker answers an address with `?v=` from the
copy it stored when it installed, for the whole release, and never asks the
server for it again: GitHub Pages ignores `?v=`, so once the next release is
published it would answer the old addresses with the new files, and the old page
would run them. So a change pushed without a new number does not reach a phone
that already has the release. A changed worker that keeps its cache name would
install into the cache the phone runs from.

Every file with `?v=` names its release, and the workers check it. The install
refuses a file that does not name the release being installed (a server can
still hand out the previous release's copy for a few minutes), stores nothing
until every file has arrived and passed, and then writes an entry `installed`
that names the release; when it is refused, the phone stays on the release it
has and tries again at the next start. A file that the server hands out later
and that names another release is not run or stored either. Without its main
script the page's start-up rescue starts the stored release whose install
finished, or says the app did not finish starting. Without another script or a
stylesheet the app starts without it, and a line at the top says "Part of
Overload did not load" (or Fuel). Without `sync.js` the app runs without cloud
sync until the update has arrived. A page of an older release that the server
hands out is answered with the stored page of the release the phone has.

The names `app.js`, `styles.css` and `food.js` at the root stay unused. Phones
that still have 2.8 ask for them, and with nothing there 2.8's worker falls back
to its own stored copies, so a 2.8 page never runs newer code.

The check fails, with exit code 1, when:

- a `?v=` with another number is left, or the two `VERSION`s or `sync.js`'s
  `release` differ;
- `const VERSION = '` in `overload.js` or `fuel/fuel.js`, or `release: '` in
  `sync.js`, is there more than once (a comment counts too): the worker's
  install reads the release from it and would refuse the file;
- the first line `/* release … */` of another script or stylesheet with `?v=`
  in an install list names another release, or `/* release ` is in that file
  more than once or not at all: the workers would refuse the file;
- `app.js`, `styles.css` or `food.js` is at the root;
- a file in a worker's install list (`ASSETS` in `sw.js` and `fuel/sw.js`) is
  not on disk: that install would fail on every phone;
- a page loads a versioned file its worker's list does not name: the app would
  start without it when there is no signal;
- the food list's `?db=` differs between `fuel/food.js` and `fuel/sw.js`;
- `sw.js` or `fuel/sw.js` differs from the published one (`origin/main`, which
  GitHub Pages serves) but kept its cache name. This is not compared without
  git or `origin/main`, nor for a worker that is new since then.

So a new script or stylesheet goes into the page and into `ASSETS` of the same
app's worker, written the same way, one address per line, and its first line is
`/* release <number> (bump.sh sets this line; …) */`. Run the check before every
push that touches those files.

## Cloud sync (optional)

Settings → Cloud sync lets you sign in with an email and password. After that
every change is mirrored to Firebase (Firestore) under your account and pulled
back on any device you sign in on. Offline changes queue and send later. The
app works exactly the same signed out; it just stays on one phone.

Fuel has the same card and uses the same account. Each app syncs its own data
and nothing else: since 3.0 Overload syncs the training data only.

In Fuel two phones never undo each other's changes: entries, saved foods and
meals, targets, theme and units merge one by one, and a change made without
signal waits on the phone and goes up once the account's latest copy is in.
Reset and Restore in Fuel, signed in, change the food log in the account too;
another phone signed in follows, except for what was logged or changed on it
since it last synced. The questions say so (`fuel/README.md`).

The first sign-in on a phone reads the account from the server before sending
anything. If that read fails (no signal, rules), nothing is uploaded and it
retries, so a bad connection cannot overwrite the cloud copy.

Reset, Import and Restore say so when you are signed in, because they erase or
replace the training data in the account too; the food log in the account is
not changed by them. Another phone signed in to the same account does the
same, except for what was logged or changed on it since it last synced, and a
workout in progress there: those come back. After an Import or Restore it also
deletes again any workout, weigh-in or night deleted in the last 90 days. A
phone still on 2.8 sends back all of its weigh-ins and nights (after an Import
or Restore, for the dates the file or copy does not have) and loses a workout
in progress. To keep that phone out of it, sign out on it first and reset it
before it signs in again. The questions say this too. On a start where cloud
sync has not loaded yet (no signal before its files were stored), a phone that
was signed in counts as signed in for these three: the question says the
account changes too, and the change goes up once cloud sync runs.

Signing out keeps everything on the phone and in the account. What you log
while signed out is sent when you sign back in. A Reset, Import or Restore done
while signed out is not: signing in again brings back what the account holds.
The sign-out question says so. (In Fuel an import only adds, so what it brings
is sent too; Fuel's question names its Reset and Restore.)

Data layout in Firestore:

| Document                          | Contents                                          | Written by |
| --------------------------------- | ------------------------------------------------- | ---------- |
| `users/{uid}/meta/state`          | settings, exercises, prescriptions, program, weigh-ins, sleep, templates, deletion records; and the food targets, saved foods and meals as 2.8 left them | Overload |
| `users/{uid}/workouts/{id}`       | one document per workout                          | Overload |
| `users/{uid}/foodDays/{date}`     | the food log as Overload kept it up to 2.8        | nobody since 3.0 |
| `users/{uid}/meta/fuel`           | Fuel's units and theme, food targets, saved foods and meals, deletion records, body weight | Fuel |
| `users/{uid}/fuelDays/{date}`     | one document per day of Fuel's food log           | Fuel |

What changed for food in 3.0:

- Overload no longer reads, writes or deletes `foodDays`, and sends the food
  part of `meta/state` back exactly as the account already holds it. Food from
  the account is no longer merged into the old food log on the phone.
- A phone that signs in to Overload 3.0 for the first time gets the training
  data and no food. The food log reaches Fuel, not Overload.
- Fuel's first sign-in to an account without `meta/fuel` reads `meta/state`
  and `foodDays` once and brings that food log across. After that it uses only
  its own two places.
- The account can hold less food than a phone does (food logged while signed
  out, for example). Copy my food log on Overload's card carries everything
  the phone holds; signing in to Fuel may bring some of it across, but not
  always all of it, so copy the log or save the file as well.
- Phones still on 2.8 keep syncing food among themselves through `foodDays`.

Two phones never overwrite each other's lists: weigh-ins and nights merge by
date, even when a phone that was offline replays old writes. Deletions are
recorded (kept 90 days) so a merge never brings back something you deleted. A
change not uploaded yet wins over the cloud's copy. A phone on 3.0 sends its
settings, program, weigh-ins and nights only when it changed something in them
itself, and the first time after it opens only once it has taken in the
account's latest copy, so an old copy on one phone cannot undo what another
phone changed. A phone still on 2.8 can, so update both. On first sign-in a
phone's own workouts, templates, weigh-ins and nights are kept, and its
exercises are matched to the account's by name.

Firebase project setup (one time, in the Firebase console):

1. Authentication → Sign-in method → enable **Email/Password**.
2. Firestore Database → Rules → paste the contents of `firestore.rules` → Publish.

`sync.js` and `fuel/sync.js` hold the Firebase web config. Those values identify
the project; they are not secrets. Access is controlled by the rules above,
which only let a signed-in user read and write their own documents. The Firebase
version is written in `sync.js`, `fuel/sync.js` and `fuel/sw.js` and must be the
same in all three.

## WHOOP and reminders (optional)

A small connector (`connector/worker.js`) runs free on Cloudflare Workers. It
holds the WHOOP app secret, logs in to WHOOP for you, returns last night's
sleep and recovery to the app, and sends push reminders (morning check-in,
workout) at the times set in Settings → Reminders. It skips a
reminder once that thing is done in the app, and skips the workout reminder on
rest days. There is no food-log reminder since 3.0: Overload cannot know what
was logged in Fuel, so it always tells the connector that reminder is off.
The app pairs with it using a random key kept in Settings (synced);
the key never goes into a web address.

What fills in from WHOOP: time asleep (light + deep + REM), REM, deep,
recovery %, resting heart rate and HRV. Nights you typed yourself keep your
numbers; WHOOP only adds recovery. A red recovery (under 34%) puts a "hold the
weights" note on Today. Body weight stays manual.

One-time setup:

1. **Cloudflare** (free, no card): sign up at dash.cloudflare.com and open
   Workers & Pages once, which gives you a `something.workers.dev` subdomain.
   Note your **Account ID** (shown on the Workers & Pages page). Then My
   Profile → API Tokens → Create Token → template **Edit Cloudflare Workers**
   → Create, and copy the token.
2. **WHOOP**: at developer.whoop.com, log in with your WHOOP account and create
   an app (development apps work right away for up to 10 people). Scopes:
   read:sleep, read:recovery, read:profile (and offline if listed).
   Redirect URL: `https://overload-connector.<your-subdomain>.workers.dev/whoop/callback`.
   If it asks for a privacy policy link, use the app's address. Copy the
   **Client ID** and **Client Secret**.
3. **GitHub**: in this repository, Settings → Secrets and variables → Actions →
   New repository secret, four times: `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`, `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`.
4. Actions → **Deploy connector** → Run workflow. Its summary shows the
   connector's address and the exact WHOOP redirect URL. It writes the address
   to `connector.json`, which is how the app finds it.
5. Right after the first deploy (before anyone else can), on the phone, open
   Overload from its Home Screen icon: Settings → WHOOP → Connect WHOOP and
   log in. The last WHOOP page shows a 6-digit code: close the page, type the
   code in the WHOOP card and tap Pair. The code works for 10 minutes; after 5
   wrong tries, log in again. Then Settings → Reminders → Turn on reminders →
   Allow. (iPhone: iOS 16.4 or later, Home Screen app only.)

Pairing and fixing it later:

- Type the code only in Overload. A link from someone else that opens the WHOOP
  login cannot pair their app: only the person who sees the code can.
- New phone, app reinstalled, or data reset: Connect WHOOP on that phone and
  type the code (same WHOOP account). The old copy stops syncing, and its
  reminders stop until it is paired again.
- "WHOOP login expired" in Settings: tap Connect WHOOP and type the new code.
- "Different WHOOP account" or "paired with another copy of Overload" when
  you expected neither: in Cloudflare, Storage → KV → overload-connector,
  delete the `owner` entry, then Connect WHOOP again.

The workflow redeploys whenever `connector/` changes. Without the Cloudflare
secrets it does nothing. The wrangler version it uses is fixed in
`connector/package.json`; change it there to update.

## Backups

Without cloud sync, data lives only in that browser's storage. Settings →
Backup → Export JSON opens the share sheet (Save to Files, AirDrop, Mail) with
a file you can re-import later; Import shows what the file holds next to what
is on the phone before replacing anything. Import, Restore and Reset replace
the training data only (Reset also erases the settings, the WHOOP link
included; the question says so). An old food log still on the phone is carried over as
it is: the log, and the saved foods with the targets, each stay as they are,
and the file's are used only for a part the phone has none of. Restoring the
copy taken at the split or before a removal while the phone holds food days
again puts the two logs together. The question says what happens to each. A
file made by or for Fuel is refused ("This is a Fuel file. Open it in Fuel.").
With cloud sync on two phones, see Cloud sync above. iOS can clear website data
for a home-screen app if you delete the app, so export now and then. The Backup card
says when you last exported, and with cloud sync off Today reminds you after
14 days without one.

- **Automatic copies.** The app keeps its own copies on the phone (IndexedDB),
  as Settings → Backup says: one a day for the last 7 days; one each from
  before the last import, reset, restore and cloud sign-in; the copy from the
  split into two apps (the first start of 3.0), which is never replaced; and
  the copies from before the last 3 removals of the old food log. Settings →
  Backup lists them with Restore. Import, Restore and Reset wait for their copy:
  when it cannot be stored, nothing is replaced or erased, and a sheet offers
  Export ("The automatic copy could not be stored, so nothing was replaced.
  Export a backup first, then try again."). A second tap while one of them is
  under way does nothing. A copy store that does not answer is given up after a
  few seconds, so these never wait for ever.
  They live in the same browser storage, so they do not replace an export.
- **Storage used.** The Backup card shows how much of the app's storage is in
  use; Today warns from 70%. If saving ever fails, messages say "Not saved on
  this phone" and a banner stays up with an Export button until saving works
  again; a restart does not take that unsaved work out of the cloud copy.
- **Unreadable data.** If the saved data cannot be read at start, the app does
  not save over it: a screen offers Export (the exact stored text), Try again,
  Restore a copy and Start fresh. After Start fresh, signed in to cloud sync,
  the training data comes back from the account, but not the old food log.

## Rebuilding the food list

The food list is Fuel's. `data/foods.json` is generated, not edited by hand. Push a change to
`tools/build_foods.py`, `tools/staples.tsv` or `tools/branded.tsv` on the
`food-data` branch and the "Build food list" GitHub Action downloads USDA's SR
Legacy and Foundation Foods, adds the packaged products, rebuilds the file and
commits it to that branch; merge it into `main`. When the file changes, bump
`?db=` in both `fuel/food.js` (`DB_URL`) and `fuel/sw.js`, then run `sh bump.sh`
with the next release (for example `sh bump.sh 3.1`) before you push. Fuel's
worker stores the list under that address, and the changed `fuel/sw.js` must
install under a new cache name: under the old one it would install into the
cache the phone runs from. `sh bump.sh --check` fails when the two numbers
differ, and when `fuel/sw.js` changed but its cache name did not. (`bump.sh`
never changes `?db=` itself. Overload's `sw.js` no longer stores the food list.)

Packaged foods:

1. "Build branded food index" shrinks USDA Branded Foods (about 430,000
   products) to `branded_index.tsv.gz` on the `food-raw` branch.
2. Add a line to `tools/branded_wishlist.txt` (name | brand | words), then run
   `python3 tools/pick_branded.py branded_index.tsv.gz > tools/branded.tsv`
   and check the matches: the third column is USDA's description. Records whose
   calories do not fit their protein, carbs and fat are skipped.
   A name of `*` names the product from USDA's description; `*ALL*` takes
   every product of a brand (used for Sprouts and Kirkland Signature).
   Review and tidy the names in `tools/branded.tsv` before committing.
3. Products USDA lacks: "Fill foods from Open Food Facts" searches for them
   and commits `tools/branded_off.tsv`. Check it before building.

## Debugging

`window.__overload` exposes the live state and the `computeNext` function in the
browser console.
