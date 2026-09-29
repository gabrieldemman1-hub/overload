# Overload

A personal hypertrophy tracker for one phone. Log weight, sets and reps; the app
tells you what to lift next time based on the rep range and how you recovered.
Modelled on the RP Hypertrophy app's flow, but without mesocycles or deloads.
The Food tab logs calories, protein, carbs and fat against daily targets.

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
- When one jump is more than 10% of the weight (5 lb on a 25 lb dumbbell), the
  top of the range stretches by 2 reps first: 14 on every set, then the jump.
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
pain drops the weight two jumps and suggests swapping the exercise. Sets are
capped between 1 and the "Max sets" setting (default 6). A +1 is also skipped
when the muscle's planned weekly sets (prescribed sets × times scheduled) would
go past the top of the weekly sets target in Settings (default 20).

## Also in the app

- **Fast logging.** The reps box shows the goal. Tap ✓ on an empty box to log the goal as done; type a number only when you missed or beat it. Sets you typed but did not tick are counted when you finish.
- **Reps in reserve.** Optional RIR column per set. Taps go – → 3+ → 2 → 1 → 0. 3+ on every set moves the weight up a session early (not when the jump is a big one).
- **Warm-up generator.** One tap builds a 50 / 70 / 85 percent ramp from your working weight, with its own shorter rest timer. Warm-ups never affect progression.
- **Swap.** Replace an exercise for today only, without touching the program.
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
- **Program library.** Ten built-in programs on the Program tab: Chris
  Bumstead's 5-day split, Push/Pull/Legs, Olympia split and an Arnold-style
  split; Hany Rambod's FST-7 classic 5-day, FST-7 arms & calves twice, and the
  Phil Heath FST-7 split; and three arm-focused programs (RP's arm
  specialization, a full-body arms emphasis in the RP app's style, and an
  upper/lower arms emphasis). View shows the week and every exercise's sets ×
  reps; Use switches to it, saving your own program under Templates first.
  Exercises you already have keep their weights. FST-7 finishers are their own
  exercises ("Pec Deck (FST-7)"), always 7 sets with 35–50 s rest. Where a
  source was paywalled or thin, the program says what it was built from.
- **Consistency calendar and streak.** Training days by month, rest days faded, streak counted across scheduled days only.
- **Weekly review.** Workouts, sets, tonnage, weight increases, PRs and body weight trend for this week or last, with a Share button.
- **Equipment-aware jumps.** Barbell, dumbbell, machine and cable each have their own default weight jump (2.5 / 5 / 5 / 5 lb), with a per-exercise override.
- **Exercise notes and rest.** Seat height, handle, pin position, and a per-exercise rest time, shown and used during the workout.
- **Fix a past workout.** Edit the sets of any finished workout. Deleting the latest workout for an exercise rolls its next-time weight back.
- **Sound when rest is over.** A short beep, since iPhones ignore web vibration. The phone's mute switch silences it, and no web app can alert you while the phone is locked.

## Food log

The Food tab tracks calories, protein, carbs and fat for each day, in Breakfast,
Lunch, Dinner and Snacks, against targets you set (Settings → Food targets, or
Set target on the Food screen). Any target can be left empty.

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
  wrong? Fix them" does the same for a product whose data is off.
- **Quick add.** Just calories and macros, no food.

Faster logging:

- **Favorites.** Tap ☆ on a food to keep it at the top of the add sheet and of
  search results.
- **Saved meals.** A meal's ⋯ menu → Save as a meal. It then sits at the top of
  the add sheet (and in search); one tap logs every food in it to any meal.
  Rename it, drop a food from it, or delete it from the same sheet.
- **Copy.** The ⋯ menu copies yesterday's version of that meal, copies a past
  day's meal to today, or clears the meal. An empty day offers to copy the whole
  day before in one tap.
- **Move foods between meals.** Hold a logged food for a moment, then drag it to
  another meal (or to another spot in the same meal); with a mouse, just drag.
  Near the top or bottom of the screen the page scrolls. A quick swipe still
  scrolls and a tap still opens the food, whose Meal buttons also move it.

Amounts go in grams, ounces, the label serving, or a USDA serving (1 cup,
1 medium). Switching units keeps the weight: 200 g becomes 7.1 oz. A food
remembers the last amount you used. Each logged entry keeps its own numbers, so
editing or deleting a food later never changes past days.

## Files

| File                   | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `index.html`           | App shell and bottom tab bar                 |
| `app.js`               | State, progression algorithm, all screens    |
| `connector.js`         | WHOOP sync and reminders in the app (talks to the connector) |
| `connector/`           | The connector: a Cloudflare Worker (`worker.js`, `wrangler.toml`) |
| `programs.js`          | Built-in program library (CBum, FST-7, arm programs) |
| `styles.css`           | Dark theme with red accent                   |
| `food.js`              | Food tab: search, amounts, barcode scanning  |
| `data/foods.json`      | USDA food list, built by `tools/build_foods.py` |
| `tools/`               | Food list builder, everyday foods (`staples.tsv`), packaged foods (`branded_wishlist.txt` → `branded.tsv`) |
| `vendor/zxing/`        | Barcode reader (zxing-wasm 3.1.4, MIT), self-hosted |
| `lab/scan.html`        | Stand-alone barcode test page (not linked from the app) |
| `sync.js`              | Optional cloud sync via Firebase             |
| `firestore.rules`      | Firestore security rules to paste in Firebase|
| `sw.js`                | Service worker so the app opens offline      |
| `bump.sh`              | Bumps the version string everywhere at once  |
| `manifest.webmanifest` | Home-screen install metadata                 |
| `icon*.png`, `icon.svg`| App icons                                    |

## Run it

Any static file server works. For example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`. Opening `index.html` directly from disk also
works (the service worker is skipped in that case).

## Put it on an iPhone

1. Host the folder somewhere with HTTPS. GitHub Pages is the easiest: push this
   folder to a repo, then Settings → Pages → deploy from the branch.
2. Open the page in Safari on the phone.
3. Tap Share, then **Add to Home Screen**.

It launches full screen, works offline, and keeps its data between launches.

## Cloud sync (optional)

Settings → Cloud sync lets you sign in with an email and password. After that
every change is mirrored to Firebase (Firestore) under your account and pulled
back on any device you sign in on. Offline changes queue and send later. The
app works exactly the same signed out; it just stays on one phone.

The first sign-in on a phone reads the account from the server before sending
anything. If that read fails (no signal, rules), nothing is uploaded and it
retries, so a bad connection cannot overwrite the cloud copy. Reset and Import
say so when you are signed in, because they replace the cloud copy too.

Data layout in Firestore:

| Document                          | Contents                                          |
| --------------------------------- | ------------------------------------------------- |
| `users/{uid}/meta/state`          | settings, exercises, prescriptions, program, food targets, saved foods and meals |
| `users/{uid}/workouts/{id}`       | one document per workout                          |
| `users/{uid}/foodDays/{date}`     | one document per day of food log                  |

Two phones logging the same day keep both sets of entries when a phone first
signs in; after that the latest change to a day wins, as with workouts.

Firebase project setup (one time, in the Firebase console):

1. Authentication → Sign-in method → enable **Email/Password**.
2. Firestore Database → Rules → paste the contents of `firestore.rules` → Publish.

`sync.js` holds the Firebase web config. Those values identify the project;
they are not secrets. Access is controlled by the rules above, which only let a
signed-in user read and write their own documents.

## WHOOP and reminders (optional)

A small connector (`connector/worker.js`) runs free on Cloudflare Workers. It
holds the WHOOP app secret, logs in to WHOOP for you, returns last night's
sleep and recovery to the app, and sends push reminders (morning check-in,
workout, food log) at the times set in Settings → Reminders. It skips a
reminder once that thing is done in the app, and skips the workout reminder on
rest days. The app pairs with it using a random key kept in Settings (synced).

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
   read:sleep, read:recovery, read:cycles, read:profile (and offline if listed).
   Redirect URL: `https://overload-connector.<your-subdomain>.workers.dev/whoop/callback`.
   If it asks for a privacy policy link, use the app's address. Copy the
   **Client ID** and **Client Secret**.
3. **GitHub**: in this repository, Settings → Secrets and variables → Actions →
   New repository secret, four times: `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`, `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`.
4. Actions → **Deploy connector** → Run workflow. Its summary shows the
   connector's address and the exact WHOOP redirect URL. It writes the address
   to `connector.json`, which is how the app finds it.
5. On the phone, open Overload from its Home Screen icon: Settings → WHOOP →
   Connect WHOOP, log in, close the page. Settings → Reminders → Turn on
   reminders → Allow. (iPhone: iOS 16.4 or later, Home Screen app only.)

The workflow redeploys whenever `connector/` changes. Without the Cloudflare
secrets it does nothing.

## Backups

Without cloud sync, data lives only in that browser's storage. Settings →
Export JSON opens the share sheet (Save to Files, AirDrop, Mail) with a file
you can re-import later. iOS can clear website data for a home-screen app if
you delete the app, so export now and then. If the phone ever refuses to save,
a banner stays on screen with an Export button until saving works again.

## Rebuilding the food list

`data/foods.json` is generated, not edited by hand. Push a change to
`tools/build_foods.py`, `tools/staples.tsv` or `tools/branded.tsv` on the
`food-data` branch and the "Build food list" GitHub Action downloads USDA's SR
Legacy and Foundation Foods, adds the packaged products, rebuilds the file and
commits it to that branch; merge it into `main`. When the file changes, bump
`?db=` in both `food.js` (`DB_URL`) and `sw.js`.

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
