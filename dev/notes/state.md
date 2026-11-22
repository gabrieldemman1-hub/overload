# The saved data (v2.8)

What Overload saves, where, in what shape, and what the split has to respect.
Code read in full: `app.js`, `food.js`, `sync.js`, `backup.js`, `connector.js`, `index.html`, `sw.js`.
Claims marked **(run)** were checked by running v2.8 in Chromium (Playwright, served from this repo, no outside host). Everything else is from reading the code. Nothing in the repo was changed.

Owner labels: **TRAINING** (stays in Overload), **FOOD** (goes to Fuel), **SHARED** (both sides read it today).

Line numbers are v2.8's (`app.js` there is `overload.js` in 3.0). Notes marked **In 3.0** say what 3.0 as released adds or changes (sections 1.1, 1.3, 4.3); everything else here is still true for 3.0's saved data. v2.8 reads and writes all of it (`tests/train-rollback.js`). Notes marked **In Fuel 3.0** (1.5, 6.3, hazards 11 and 16, questions 6 and 8) say what Fuel as released does.

---

## 1. Where data lives

### 1.1 localStorage keys

There are exactly eight names (one of them a prefix). `food.js` and `programs.js` never touch localStorage themselves.

| Key | Written by | Read by | Holds | Owner |
| --- | --- | --- | --- | --- |
| `overload.state.v1` | `save()` app.js:327, `setState()` app.js:482 | `load()` app.js:188; `storageUsed()` app.js:367; start-up rescue index.html:44 (only "is there data?") | The whole app state, one compact JSON document (section 2) | **SHARED** (training and food in one document) |
| `overload.state.v1.bak` | `load()` app.js:198, only when the stored data cannot be read | never read back by code; removed by `leaveUnreadable()` app.js:2010 once the same text is confirmed in IndexedDB | The exact unreadable text | SHARED |
| `overload.sync.v1` | `saveKnown()` sync.js:87; removed by `load()` app.js:199 (unreadable) and `forgetCloudIfSignedOut()` app.js:2043 (Reset / Import / Restore while signed out) | `loadKnown()` sync.js:71; `syncOn()` app.js:377 (present = "cloud sync counts as on" while sync.js is still loading) | Cloud bookkeeping: `{ uid, core: hash, workouts: { id: hash }, days: { 'YYYY-MM-DD': hash } }`. Hashes only, no data. `days` is the food log, `core` covers `food` and `deleted` too | **SHARED** |
| `overload.backup` | `setBackupInfo()` app.js:360, from boot app.js:2382 (`since`), `exported()` app.js:2035 (`lastExport`), `export-nag-off` app.js:2237 (`nagOff`) | `backupInfo()` app.js:359, `exportDue()` app.js:380, `lastExportText()` app.js:373 | `{ since, lastExport, nagOff }`, all ms. This phone only, never synced (app.js:13). Written with `Object.assign(old, patch)`, so **fields the code does not know survive (run)** | SHARED (one export covers both) |
| `overload.theme` | `applyTheme()` app.js:474 | inline script index.html:20, 25 (before first paint) | `'system'`, `'dark'` or `'light'`: a mirror of `state.settings.theme` | SHARED |
| `overload.conn.synced` | connector.js:143 | connector.js:141, 321 | ms of the last WHOOP sync | TRAINING |
| `overload.conn.pairing` | connector.js:162, 180, 191, 360 | connector.js:167 | ms when a WHOOP login was started, or `''` | TRAINING |
| `overload.conn.cfg` | connector.js:294 | connector.js:293 | Signature (address + JSON) of the reminder config last sent to the connector | TRAINING (it includes the food reminder, see 2.2) |

Not found: `overload.lib` or any other `overload.*` key. No sessionStorage use anywhere.

**In 3.0:**

- `overload.sync.v1` has one more field, `parts`, written by 3.0's `sync.js`: `{ core: hash, keys: { settings, exercises, presc, program, active, bodyweight, sleep, templates: hash }, food: hash, del: { bw: { date: ms }, sleep: { date: ms }, workouts: { id: ms } } }`. So the whole shape is `{ uid, core, workouts, days, parts }`, and the note is no longer hashes only: `parts.del` holds the training deletion records of the noted core themselves (a few small entries). v2.8 keeps the field unchanged; 3.0 uses it only while `parts.core` equals `core` (`sync.md` 1.1). `load()` in `overload.js` also removes the note when `overload.state.v1` is missing or empty (review finding S2), and `forgetSyncedDays` (Remove the old food log) takes removed days off `days`, keeping every other field.
- `overload.backup` also holds `split: { at, copied: { at, hash, days, entries }, filed: { at, hash }, removed: { at }, dismissed: hash }`, the hand-over bookkeeping of this phone (`SPEC.md` section 3, rule 4). v2.8 keeps it.
- One sessionStorage key, `overload.timer`: `{ end: ms, total: s, kind: 'rest' | 'cardio', next: text, workout: id }`, the rest or cardio timer that is running, so that a reload in the same session (the "Update ready" pill, or any reload) starts it again (`keepTimer`, `resumeTimer`). It is removed when the timer stops and when it is read at start. Per session, not part of the saved data or any backup; v2.8 ignores it.

After a first start of v2.8 the keys present are `overload.theme`, `overload.backup`, `overload.state.v1` **(run)**. `overload.conn.*` appear only when a connector address is set (`connector.json` has an empty `url`, and every write sits behind `url()`, connector.js:133, 159, 290). `overload.sync.v1` appears only after a first successful cloud link.

Not written by the app's own code but in the same storage when cloud sync is used: the Firebase SDK's own records (sign-in session and Firestore offline cache, IndexedDB, possibly small localStorage keys). **Not verified**: the SDK loads from `www.gstatic.com`, which I did not contact.

### 1.2 IndexedDB (backup.js)

Database `overload-copies`, version 1 (backup.js:10, 23), two stores keyed by `id` (backup.js:26-27): `meta` and `data`. Section 4.3.

### 1.3 Cache Storage and the rest

- Cache `overload-v23` (sw.js:2): app files, `data/foods.json?db=5`, the barcode reader. No user data. `activate` deletes every cache whose name starts with `overload-` except its own (sw.js:57); the start-up rescue also looks at caches starting with `overload-` (index.html:70).
- `navigator.storage.persist()` is requested at boot (app.js:2387).
- In memory only, never saved: `ui` (app.js:731), `timer`, `fu` (food.js:34: the day on screen, search text, the Add trip), `cs` (connector.js:21), the loaded food list `db` (food.js:153). (**In 3.0** a running `timer` is also kept in sessionStorage, `overload.timer`, 1.1; `food.js` is Fuel's.)
- **In 3.0** the training cache is `overload-v24` and holds no food list and no barcode reader. Files with `?v=` are answered from it for the whole release (`offline.md` section 10).

### 1.4 The cloud copy (when signed in)

| Firestore document | Field | Holds |
| --- | --- | --- |
| `users/{uid}/meta/state` | `core` | one JSON string of `CORE_KEYS` (sync.js:33): `settings, exercises, presc, program, active, bodyweight, sleep, templates, food, deleted` |
| `users/{uid}/workouts/{id}` | `data` | JSON of one workout |
| `users/{uid}/foodDays/{date}` | `data` | JSON of that day's entry array (`state.diary[date]`) |

Not uploaded: `v`, `libVersion`, and any top-level field not in `CORE_KEYS`. `firestore.rules:5` lets a signed-in user read and write any path under `users/{uid}/`, so a new document or collection needs no rules change.

### 1.5 Same site, same storage

The two apps will be on one origin. Installed to the iPhone Home Screen each has its own storage. In an ordinary browser tab (desktop, Android, Safari before installing) they **share** localStorage, IndexedDB and Cache Storage. So every name Fuel uses must differ from the ones above, and Fuel can read `overload.state.v1` directly there. `storageUsed()` counts every key of the origin, whoever wrote it (app.js:365-367).

**In Fuel 3.0** Fuel's own names are: localStorage `fuel.state.v1` (the state, `fuel/README.md`), `fuel.state.v1.bak` (only while stored text cannot be read; removed once the copy `before-unreadable` holds the same text), `fuel.sync.v1` (cloud sync's note, `{ uid, core, days }`), `fuel.backup` (`{ since, lastExport, nagOff }`), `fuel.theme`; sessionStorage `fuel.here` ("Use it here anyway" in a Safari tab); IndexedDB `fuel-copies`; cache `fuel-vN`. `load()` removes `fuel.sync.v1` when `fuel.state.v1` holds nothing or cannot be read, and tells cloud sync whether the page started on saved data (`window.__overload.startedWithData`). Fuel never writes a name starting `overload`; it reads `overload.state.v1` only for "Bring it from Overload on this device" (on Welcome and in the import sheet) and, on an iPhone, to tell that it was opened inside the installed Overload.

---

## 2. The state object

Top level, in the order a fresh v2.8 writes it **(run)**: `v, settings, exercises, presc, program, workouts, active, bodyweight, sleep, templates, libVersion, deleted, food, diary`. A fresh state is 13,050 characters, 11,847 of them the exercise list.

| Field | Type | Created | Normalized | Owner |
| --- | --- | --- | --- | --- |
| `v` | `1` | `seedState()` app.js:170 | `load()` accepts only `v === 1` (app.js:191); also checked by Import (app.js:2055), Restore (app.js:436), `setState` (app.js:479) | each app needs its own |
| `settings` | object | app.js:166, 170 | app.js:271 (defaults filled in), 226-229, 280, 291 | TRAINING, except `units` and `theme` (SHARED) |
| `exercises` | array | app.js:172-176 | app.js:273, 230-231, 299-306 | TRAINING |
| `presc` | `{ exId: presc }` | app.js:170; filled by `prescFor()` app.js:506 | app.js:275, 232-235 | TRAINING |
| `program` | `{ days, schedule }` | app.js:170, 177-180 | app.js:276-278, 236-238, 307-318 | TRAINING |
| `workouts` | array | app.js:170; `startWorkout()` app.js:1744 | app.js:274, 241-257 | TRAINING |
| `active` | workout id or `null` | app.js:170, 1747 | app.js:258; cleared when its workout is missing after Import / Restore (app.js:462) | TRAINING |
| `bodyweight` | `[{ date, weight }]` | app.js:170; `saveCheckin()` app.js:895 | app.js:281, 259-260 | TRAINING; food.js reads the latest one (2.10) |
| `sleep` | array | app.js:170; app.js:901-904; connector.js:126-127 | app.js:282, 261-262 | TRAINING |
| `templates` | array | app.js:170; app.js:1231, 1841 | app.js:292, 239-240 | TRAINING |
| `libVersion` | `3` after normalize | app.js:181, 310, 318 | app.js:299, 312 | TRAINING |
| `deleted` | `{ food, bw, sleep, workouts }` | `normalize()` app.js:284-290 | same, plus pruning | `deleted.food` FOOD, the other three TRAINING |
| `food` | `{ targets, foods, meals }` | `normalize()` app.js:293-296 | app.js:263, 269 | FOOD |
| `diary` | `{ 'YYYY-MM-DD': [entry] }` | `normalize()` app.js:297 | app.js:264 | FOOD |

Nothing else exists at the top level. Recents, favourites, remembered barcodes and last-used amounts are **not** separate tables: they are fields of the foods in `food.foods` (2.6).

### 2.1 What `normalize` and `cleanValues` do in general

- `normalize(st)` (app.js:267-321) works **in place** on the parsed object and returns it. It removes only the keys `__proto__`, `constructor`, `prototype` from `st`, `settings`, `presc`, `food`, `food.targets`, `food.foods`, `food.meals`, `diary`, `deleted` (app.js:269). It never removes a key it does not know.
- `cleanValues(st)` (app.js:224-265) fixes types of known fields only: numbers (`cleanNum`: numeric text becomes a number, anything else `null`), ids (`cleanId`: characters outside `A-Za-z0-9_.:-` become `_`), dates, list values. Array members that are not objects are dropped (`objects()` app.js:223).

### 2.2 `settings`, key by key

Defaults from `defaultSettings()` app.js:166. All are filled in on every load (app.js:271). The 15 numeric ones fall back to the default when not a number (app.js:226-227). The change handler for the number boxes is app.js:2351-2360.

| Key | Default | Meaning | Read | Written | Owner |
| --- | --- | --- | --- | --- | --- |
| `units` | `'lb'` | `'lb'` or `'kg'` (anything else becomes `'lb'`, app.js:228). Unit of every weight, weigh-ins included | app.js:571, 634, 854, 930, 967, 982, 1830 and about 20 labels; **food.js:996** | **no control writes it** (not found in any handler; it changes only through Import, cloud or the console) | **SHARED** |
| `theme` | `'system'` | `'system'`, `'dark'`, `'light'` (app.js:229) | `applyTheme()` app.js:469; app.js:1479 | app.js:2232; mirrored to `overload.theme` app.js:474 | **SHARED** |
| `increment` | 2.5 | weight jump: barbell and anything else | `incFor()` app.js:518 | app.js:2351 | TRAINING |
| `incDumbbell`, `incMachine`, `incCable` | 5, 5, 5 | weight jump by equipment | app.js:517 | app.js:2351 | TRAINING |
| `repMin`, `repMax` | 10, 12 | default rep range | `repRange()` app.js:510-511 | app.js:2351 | TRAINING |
| `restSec` | 120 | rest timer, seconds | app.js:520 | app.js:2351 | TRAINING |
| `maxSets` | 6 | set cap for feedback | app.js:723, 1161, 1186 | app.js:2351 | TRAINING |
| `defaultSets` | 3 | sets for a new exercise | app.js:506, 588, 1188, 1562 | app.js:2351 | TRAINING |
| `trackRir` | `true` | reps-in-reserve buttons | app.js:1027 | app.js:2190 | TRAINING |
| `weighEvery` | 1 | days between weigh-in prompts, 0 = off | app.js:831, 855 | app.js:2351; forced to 1 once when `checkinV` is missing (app.js:280) | TRAINING |
| `volumeMin`, `volumeMax` | 10, 20 | weekly sets target per muscle | app.js:720, 1305 | app.js:2351 | TRAINING |
| `warmupRest` | 45 | seconds between warm-up sets | app.js:2135 | app.js:2351 | TRAINING |
| `cardioOn`, `cardioMin`, `cardioName` | `true`, 20, `'Incline treadmill walk'` | cardio card | app.js:973-975, 1870 | app.js:2191, 2351, 2348 | TRAINING |
| `sleepOn` | `true` | sleep rows in the morning check-in | app.js:837, 855, 876 | app.js:2192 | TRAINING |
| `checkinV` | 1 | marker: the v2.2 check-in migration ran | app.js:270 | app.js:280 | TRAINING |
| `connKey` (no default) | absent | secret that pairs the app with the connector (sent as `Authorization: Bearer`) | connector.js:37, 91, 290, 385; Import and Restore treat it specially (app.js:457, 2058-2067) | connector.js:27, on the first connector call | TRAINING. **A secret: it is in every export file and in the cloud copy** |
| `connUrl` (no default) | absent | connector address | connector.js:24 | connector.js:71, 375 | TRAINING |
| `reminders` (no default) | absent | `{ checkin, workout, food: { on, time: 'HH:MM' } }`, defaults connector.js:19 | connector.js:286, 337-340 | connector.js:32, 367, 371 | TRAINING; `reminders.food` is the food-log reminder |
| `sleepSkip` (legacy) | absent | old list of dates | app.js:291 | moved into `deleted.sleep` and removed by normalize (app.js:291). If present and not an array, normalize throws and the data counts as unreadable **(run)** | TRAINING |

The food-log reminder, as far as the saved data goes: its switch and time are `settings.reminders.food`; "already done today" is worked out in `configNow()` from `state.diary[today].length` (connector.js:285) and sent to the connector with every save (connector.js:385). No other state is involved.

### 2.3 `exercises`, `presc`, `program`, `templates` (TRAINING)

- **Exercise** `{ id, name, muscle, equipment, increment, repMin, repMax, custom, notes?, restSec?, fixedSets? }`. Created app.js:173 (library), 304 (library v2), 1156-1159 (program library), 2284-2290 (form). `increment`, `repMin`, `repMax`, `restSec`, `fixedSets` are numbers or `null`; `notes` text or `null`. Cleaned app.js:231. Deleted app.js:2206-2215 (also removed from days and templates; `presc[id]` deleted).
- **`presc[exId]`** `{ weight, targetReps, sets, soreCut?, reasons: [text], updatedAt }`. Created `prescFor()` app.js:506 and app.js:1161; replaced after each finished exercise app.js:1785; edited app.js:2291-2297, 1193-1195; rolled back app.js:1798, 1808, 2226. Cleaned app.js:232-235.
- **`program`** `{ days: [{ id, name, exercises: [exId] }], schedule: [7 × dayId or null] }` (Mon to Sun). Written app.js:1236, 1847, 2161-2166, 2170, 2349-2350. Cleaned app.js:236-238.
- **Template** `{ id, name, days: [day], schedule, savedAt: 'YYYY-MM-DD' }`. Created app.js:1231, 1841; deleted app.js:2183. Cleaned app.js:239-240.

### 2.4 `workouts` (TRAINING)

Workout, created by `startWorkout()` app.js:1744:

```
{ id, date: 'YYYY-MM-DD', startedAt: ms, finishedAt: ms | null, dayId, dayName,
  soreness: { Muscle: 0..3 },          // app.js:2099
  entries: [entry],
  deload?: true,                       // app.js:1745, 1795, 1800 (absent on normal workouts)
  cardio?: { name, min, incline, speed, speedUnit: 'mph' | 'km/h', done, kcal? } }   // app.js:975, 1879
```

Entry, created by `newEntry()` app.js:1704:

```
{ exId, plannedSets, weightAtStart, targetReps,
  sets: [{ weight, reps, done, rir: null | 0..3, auto?: true }],   // auto: app.js:2116
  pump, joint, workload,               // null or an index, app.js:2147
  done, soreCut,                       // app.js:1778
  next: null | { weight, targetReps, sets, soreCut, reasons, updatedAt },   // computeNext, app.js:633
  prevPresc: null | a copy of presc before this session,                    // app.js:1779
  warmups: null | [{ weight, reps, done }],                                 // app.js:1833
  prs: [{ kind: 'weight' | 'e1rm' | 'reps', text }],                        // app.js:571-574
  swappedFrom: null | exId }                                                // app.js:1815
```

Cleaned app.js:241-257. On finish, entries not done are dropped and an unfinished cardio block is deleted (app.js:1878-1881). A workout of 6 exercises × 3 sets with cardio measured 3,782 characters **(run)**.

### 2.5 `active`, `bodyweight`, `sleep` (TRAINING)

- `active`: id of the workout in progress. Set app.js:1747, cleared app.js:1883, 1894.
- `bodyweight`: `[{ date, weight }]`, one per date, in `settings.units`. Written app.js:895, deleted app.js:2189 (recorded in `deleted.bw`). Read by the check-in, cardio calories (app.js:980), charts, the weekly review, **and food.js:994**.
- `sleep`: `[{ date, total, rem, deep, light?, recovery?, rhr?, hrv?, perf?, src?: 'whoop' }]`, minutes. Written app.js:901-904 and `mergeNights()` connector.js:114-130; deleted app.js:2197-2198.

### 2.6 `food` (FOOD)

Described in food.js:11-18. `normalize` only makes sure the three members exist (app.js:293-296) and cleans the four target numbers (app.js:263). **The contents of `food.foods` and `food.meals` are not validated at all.**

**`food.targets`** `{ kcal, protein, carbs, fat }`: a whole number above 0, or `null` for "no target". Written food.js:1133-1135. Read food.js:336, 343-351, 984-993.

**`food.foods`** `{ id: food }`: every food ever logged, typed in or starred. Nothing prunes it; only "Delete this food" removes one (food.js:862).

```
{ id,                 // 'u' + USDA number, an 'o…' list id, 'b' + barcode (Open Food Facts, or typed in with a barcode), 'c' + uid (typed in, no barcode): food.js:202, 304, 839
  src,                // 'usda' | 'off' | 'custom'  ('entry' and 'new' exist only in memory: food.js:629, 690, 972)
  name, brand,
  n: { kcal, p, c, f } | null,          // per 100 g, or per 100 ml for a drink
  serving: { label, g, n } | null,      // the label serving; n = per-serving numbers when there is no weight
  servings: [[label, grams]],           // USDA portions; ENTRIES POINT AT THEM BY POSITION ('s0', 's1' …)
  usda?,              // USDA's long description (searched too, food.js:247)
  barcode?,           // the remembered barcode
  liquid?: true,      // drink: ml and fl oz
  fav?: true,         // favourite
  used?: ms,          // last logged: this is what makes it a "recent"
  last?: { qty, unit } }   // last-used amount
```

Where each feature lives:

| Feature | Stored as | Written | Read |
| --- | --- | --- | --- |
| Favourites | `fav: true` on the food | `toggleFav()` food.js:700-705; kept across edits food.js:845; `moveStars()` food.js:255-259 | `favorites()` food.js:252 |
| Recents | `used` on the food (the 25 newest that are not favourites) | `saveEntry()` food.js:632; copies and saved meals food.js:717 | `recents()` food.js:260 |
| Last-used amount | `last: { qty, unit }` on the food | food.js:633 | `defaultAmount()` food.js:104-105 |
| Custom foods | `src: 'custom'` | `submitFoodForm()` food.js:841-849; deleted food.js:859-864 | food.js:237-243 |
| Corrected products | a `src: 'custom'` food saved under the product's own id | food.js:839 (`fu.form.replace`) | `ownCopy()` food.js:238-242 |
| Remembered barcodes | `barcode` on a stored food. A scanned product is stored when it is logged, starred or typed in, not by the scan alone | `storable()` food.js:664; food.js:842 | `foundCode()` food.js:958-961 (own foods first, `custom` winning), `ownCodes()` food.js:237 |
| Saved meals | `food.meals` | below | below |

`storable()` (food.js:661-667) is the exact list of fields copied from a listed or looked-up food. When the food list loads, `refreshStored()` (food.js:167-179) rewrites `n` and `servings` of stored non-custom foods from the list and saves.

**`food.meals`** `{ id: { id, name, items: [item], used?: ms } }`. An item is an entry without `id`, `meal`, `at`: `{ food, qty, unit, amt, name, brand, kcal, p, c, f }`. Created `saveMealAs()` food.js:741; `used` set food.js:761; items removed food.js:1098; renamed food.js:1105; deleted food.js:1099, 1111. Read `savedMeals()` food.js:261.

### 2.7 `diary` (FOOD)

`{ 'YYYY-MM-DD': [entry] }`. A day whose last entry is removed loses its key (food.js:672, 1082).

```
{ id, food: food id | null, meal: 0..3,      // Breakfast, Lunch, Dinner, Snacks (food.js:27)
  qty, unit,                                 // unit: 'g' | 'oz' | 'ml' | 'floz' | 'srv' | 's0', 's1', … ; both null for a quick add
  amt,                                       // the amount as text, e.g. '2 × 1 slice (34 g)' (it can hold '×', U+00D7)
  name, brand,
  kcal, p, c, f,                             // this entry's own numbers: kcal whole, the others to 0.1
  at: ms }                                   // order key for cloud merges; a drag can give a fraction (food.js:394)
```

- Created `saveEntry()` food.js:636-640, `submitQuick()` food.js:790-791, `addCopies()` food.js:713-714. Moved `moveEntry()` food.js:381-397. Deleted `deleteEntry()` food.js:668-676 and "Clear meal" food.js:1077-1083 (both record the id in `deleted.food`).
- The day's totals are the sum of the entries' own `kcal, p, c, f` (food.js:45-47, 336). They do not depend on `food.foods`. A food that is gone or has changed shape only changes how an entry opens for editing (food.js:688-692).
- Within a day the order is the array order (food.js:354); cloud sync re-sorts by `at` (sync.js:130).
- `normalize` checks only this (app.js:264): a day that is not an array is deleted; members that are not objects are dropped. **It does not check that the key is a date, nor any field of an entry.** A day `'not-a-date'` with `kcal: 'abc'` survived a load and save, and an empty array stays as a day **(run)**.

### 2.8 `deleted`

`{ food: { entryId: ms }, bw: { date: ms }, sleep: { date: ms }, workouts: { workoutId: ms } }`.

- The four maps are created by `normalize` (app.js:284-290), which also **drops every record older than 90 days on every load** (app.js:285-288) **(run)**.
- Written by `markDeleted()` app.js:498, called from app.js:1876, 1893, 2189, 2198, 2227 and **food.js:673, 1081**; `unmarkDeleted()` app.js:499 from app.js:893, 905.
- Read by connector.js:119 (`deleted.sleep`) and cloud sync (sync.js:108-118, 140-152, 268-270, 286, 354-356, 395). food.js never reads it.
- A kind the code does not know survives a load and save **(run)**, but `mergeDeleted()` (sync.js:108-118) rebuilds the object with the four kinds only.
- Deleting a custom food or a saved meal leaves **no** deletion record (food.js:862, 1099, 1111).

### 2.9 Fields used by both sides

| What | Training side | Food side |
| --- | --- | --- |
| `settings.units` | everywhere | food.js:996 only, for the protein hint |
| `settings.theme` | app.js:469 | none (food.js is styled by the page) |
| `bodyweight` | owner | food.js:994-997: the latest weigh-in with a weight above 0 gives "Protein: X to Y g a day" under the targets |
| `deleted` | `bw`, `sleep`, `workouts` | `food` (through `O.lib.markDeleted`, app.js:2426) |
| `diary` | counted by `exportDue()` app.js:381, `dataSummary()` app.js:451, `summary()` backup.js:61, the copy list app.js:404, `configNow()` connector.js:285 | owner |
| `food` | never read in app.js beyond normalize | owner |
| `settings.reminders.food` | connector.js (its row label connector.js:20) | none |

What `food.js` needs to exist in the state or it throws: `state.diary` (object), `state.food.targets / foods / meals`, `state.deleted.food` (object, for app.js:498), and `state.settings` once a body weight exists (food.js:996). `state.bodyweight` may be missing (food.js:994 guards it).

---

## 3. Load, normalize, save, setState, unreadable data

### 3.1 `load()` (app.js:185-201)

1. Reads `overload.state.v1`. Nothing there (null or empty text): returns `seedState()`, a new default state. This is not an error.
2. Parses it. If the result has `v === 1`, returns `normalize(parsed)`: the parsed object itself, changed in place.
3. Anything else goes to the unreadable path (3.5): `getItem` threw, the JSON did not parse, the value is not an object with `v === 1`, **or `normalize` threw**.

### 3.2 Boot (app.js:2377-2392)

`state = load()`, `applyTheme()`, then **`save()` straight away** unless unreadable (app.js:2380). So the first start of a new version writes the state back as the new code's `normalize` left it, before anything else. Then `overload.backup.since` is set if missing, the screen is drawn, and `safetyCopy('day')` runs (only if today has no copy yet).

### 3.3 `save()` (app.js:324-342)

- Returns `false` and does nothing while the data is unreadable (app.js:325).
- Writes `JSON.stringify(state)`: the **whole** document, compact, on every change. Remembers its length in `ui.savedChars`.
- If a workout was just finished, replaces today's automatic copy (app.js:330).
- On failure: `ui.saveFailed`, a banner that stays until a save works (app.js:343-351) and the message "Not saved on this phone…" (app.js:322, 339). The state stays in memory and the next save tries the whole document again.
- Always sends the `overload:save` event (app.js:340); sync.js (sync.js:470) and connector.js (connector.js:385) listen to it.

### 3.4 `setState(next)` (app.js:478-488), the cloud path

Ignored unless `next.v === 1` and the data is readable. `state = normalize(next)`, written straight to localStorage. No `overload:save` event, no automatic copy. sync.js always passes a copy of the current state with some keys replaced (`Object.assign({}, local, …)`, sync.js:247, 279, 309), or on a first link a deep copy of the local state with the cloud's keys laid over it (sync.js:346, 353).

### 3.5 Unreadable data (app.js:195-200, 1988-2033)

Checked with four cases: `v: 2`, cut-off JSON, the text `null`, and `settings.sleepSkip: 5` **(run)**. In each:

- `overload.state.v1` is left exactly as it was, and `save()` returns `false`.
- The same text is copied to `overload.state.v1.bak` (the write may fail silently when storage is short: it is a second full copy).
- `overload.sync.v1` is removed, so a later sign-in downloads and merges instead of deleting.
- The text is also stored as the automatic copy `before-unreadable` (app.js:2380).
- The app runs on a default state in memory and shows "Your data" (app.js:1988-2001): **Export the unreadable copy** (the exact stored text, as `overload-unreadable-YYYY-MM-DD.json`), **Try again** (reload), **Restore an automatic copy** (shown only if there is one), **Start fresh** (asks first).
- `setState`, `push()` and `link()` do nothing meanwhile (app.js:479; sync.js:195, 323).
- Leaving (Restore or Start fresh) calls `leaveUnreadable()` (app.js:2003-2011): saving works again, sync starts over, and `.bak` is removed once IndexedDB is confirmed to hold the same text.

### 3.6 Does a field the code does not know survive?

**Yes, through load, normalize and save, and through `setState`** **(run)**. I added a top-level object, a top-level number, a key in `settings`, in `food`, in `food.targets`, in a stored food, in a diary entry, in an exercise and in `deleted`, reloaded, saved again from the app, and called `setState` with a copy: all were still in localStorage. New top-level keys keep their place after `diary`.

It is **lost** when:

| Event | Why |
| --- | --- |
| Reset all data (app.js:2238) | `state = seedState()` |
| Import (app.js:2068), Restore (app.js:440) | the whole state is replaced by the file or copy. A file made by Export does carry the field, since Export writes the whole state |
| Start fresh after unreadable data (app.js:2029) | `seedState()` |
| A new phone, or a reinstall plus sign-in | top-level keys outside `CORE_KEYS` are never uploaded (sync.js:33, 91) |
| An unknown key inside `settings` | it is uploaded (`settings` goes up whole), but `mergeCore()` takes the cloud's `settings` whole whenever this phone did not change it (sync.js:135-139), so a key only this phone has can disappear |

So: the food fields the training app keeps carrying are safe across load and save. Bookkeeping about the split that belongs to **this phone** (a food copy was made here, the card was dismissed) is better kept in `overload.backup` or a key of its own than in the state: `overload.backup` is per phone, is not touched by Reset, Import, Restore or sync, and v2.8 keeps fields it does not know there **(run)**.

### 3.7 Is a load and save byte for byte?

For a state last saved by v2.8 **(run, 1.33 M-character state)**: `food.foods`, `food.meals`, `diary` and every training field came back identical, and a second load gave an identical document. Two things do change:

- `deleted.*`: records older than 90 days are dropped on each load (app.js:285-288). A check that `deleted.food` stays byte for byte fails as soon as a fixture holds an old record. v2.8 does the same on its next start, so nothing is lost that v2.8 would have kept.
- `food.targets`: rebuilt in the order `kcal, protein, carbs, fat` with numeric text turned into numbers (app.js:294, 263). A state v2.8 saved is already in that form.

With cloud sync, `mergeDeleted()` also re-sorts the keys of every `deleted` map (sync.js:115).

---

## 4. Export, import, automatic copies

### 4.1 Export (app.js:1965-1986)

- Content: `JSON.stringify(state, null, 2)`. **The file is the state itself**, pretty-printed with two spaces. No wrapper, no version of its own, no checksum. Parsed and written compactly it equals `overload.state.v1` exactly **(run)**.
- Name `overload-backup-YYYY-MM-DD.json`, type `application/json`, share title "Overload backup".
- Route: `navigator.share({ files })` when `navigator.canShare` says files work; otherwise a download link. Cancelling the share sheet counts as "not exported".
- On success `overload.backup.lastExport` is set (app.js:2034-2038).
- Size: 1.7 to 1.9 times the stored text (20,044 stored → 33,958 in the file; 1,329,025 → 2,537,032) **(run)**.
- Export buttons: Backup card (app.js:423), Today notices (app.js:391, 394), the storage-full banner (app.js:348), the "screen could not be shown" card (app.js:752).

**An export file holds everything needed to rebuild the food data elsewhere**: `food.targets`, `food.foods` (with favourites, recents, last amounts, barcodes, custom and corrected foods), `food.meals`, `diary`, `deleted.food`, plus `settings.units`, `settings.theme` and `bodyweight`. It also holds all training data and, when a connector was ever paired, `settings.connKey` and `settings.connUrl`.

### 4.2 Import (app.js:2050-2072, file box app.js:425, 2372)

1. The file box accepts `application/json,.json`. The text is parsed with a reviver that drops `__proto__`, `constructor`, `prototype` (app.js:203-204).
2. **The only checks: `parsed.v === 1` and `Array.isArray(parsed.exercises)`** (app.js:2055). Otherwise: "That file is not an Overload backup", nothing changes. Refused **(run)**: text that is not JSON, `v: 2`, a backup with `exercises` removed, `{ app: 'fuel', … }` without `v`, `{ v: 1, app: 'fuel', food, diary }` without `exercises`.
3. One question: "Replace everything on this phone with the backup?" with two lines from `dataSummary()` (app.js:449-453): `The backup: N workouts (first – last), M food days.` and the same for `This phone now`. Workouts = finished ones with a valid date; food days = the number of keys in `diary`. Then a line about a workout in progress (app.js:443-447) and, when signed in, that the cloud copy is replaced too (app.js:2046-2049).
4. Connector link: a file without one keeps this phone's; a different one is taken only after a second question and only if the address looks like `https://host` (app.js:2058-2067).
5. `replaceState(parsed, 'import', 'Backup restored')` (app.js:455-466): automatic copy `before-import` of what is here; `overload.sync.v1` removed when signed out; `state = normalize(parsed)`; rest timer stopped; `active` cleared if its workout is not in the file; theme applied; `save()`; redraw.

Import **replaces, it never merges**. Checked **(run)**:

- A file with `v: 1`, `exercises: []` and only food in it **was accepted**: workouts went from 1 to 0, the exercise list was rebuilt from scratch, `overload.sync.v1` was removed. The summary did say "The backup: 0 workouts".
- A training-only file (no `food`, no `diary`) was accepted and the phone's food went to 0 days and 0 foods.
- When signed in, the next push makes the cloud match the file: workouts and food days that are not in it are deleted there (sync.js:209-220).

### 4.3 Automatic copies (backup.js)

- Database `overload-copies`, version 1. Stores `meta` and `data`, both keyed by `id` (backup.js:10, 23-27). Opening gives up after 2 s (`OPEN_WAIT`, backup.js:12); every failure is swallowed.
- `meta` record: `{ id, kind, at: ms, chars, workouts, first, last, foodDays }` (backup.js:79, summary backup.js:54-64; counts are `null` when the text does not parse). `data` record: `{ id, text }`, the whole state as a JSON string.
- Ids: `day-YYYY-MM-DD` (local date) for `kind: 'day'`; `before-<kind>` for any other kind (backup.js:73), so there is only ever the latest of each kind.
- `KEEP_DAYS = 7` (backup.js:11): after a day copy is written, the 7 day copies with the newest ids stay and the rest are deleted (backup.js:81-85) **(run)**. That is the last 7 dates the app was opened on, not the last 7 calendar days. `before-*` copies are never pruned.
- When copies are taken:

| Kind | When | Where |
| --- | --- | --- |
| `day` | at start, only if today has none | app.js:2385 |
| `day` (forced) | when a workout is finished | app.js:330 |
| `import`, `restore` | just before Import or Restore replaces the state (not from the unreadable screen) | app.js:458 |
| `reset` | before Reset | app.js:2238 |
| `cloud` | on a first sign-in on this phone when the account already holds data | sync.js:401 |
| `unreadable` | at start, the exact unreadable text | app.js:2380 |

- **Today's copy does not follow the food log.** It is written at the first start of the day and again only when a workout is finished. In my run the copy taken after the workout showed 0 food days although three foods were logged afterwards.
- List and restore: Settings → Backup (app.js:400-430). `restoreCopy()` (app.js:432-441) applies the same check as Import (`v === 1` and an `exercises` array), asks with the two summary lines, keeps this phone's connector link (app.js:457), and calls `replaceState(parsed, 'restore', …)`, which first stores `before-restore`. A copy of kind `unreadable` gets Export, not Restore (app.js:405). A kind the list does not know shows as "Copy · date" with a Restore button that works (app.js:403) **(run, with a copy stored as `take('split', text)`)**.
- The API is `window.__overloadBackup = { take, list, get, KEEP_DAYS }` (backup.js:109). `take(kind, text, force)` accepts any kind name.

**In 3.0** (`backup.js` keeps its name and v2.8's API, plus `KEEP_REMOVALS`; v2.8 can run this file, `tests/train-backup.js`):

| Kind | Id | When | Kept |
| --- | --- | --- | --- |
| `split` | `before-split` | first start of 3.0: the stored text exactly as the last version left it (`noteSplit`) | never pruned, never written over |
| `foodremove` | `before-foodremove-<ms>` | before each "Remove the old food log"; it must be stored, or nothing is removed | one per removal, the newest 3 (`KEEP_REMOVALS`) |

- The other kinds are as above (only the latest of each). Restoring the `split` or a `foodremove` copy while the phone holds food days again puts the two food logs together (`SPEC.md` section 3, rule 6).
- A lost IndexedDB connection (an iPhone drops it for an app back from the background) is let go and opened again at the next call, and a failed transaction is tried once more on a fresh connection (review finding U6).

---

## 5. Storage limits and sizes

- `STORE_LIMIT = 2500000` characters (app.js:15). The comment says the iPhone's real limit is not measured; this is a guess. For comparison, this Chromium stopped at about 5.2 M characters for the whole origin **(run)**.
- `storageUsed()` (app.js:362-371): for every localStorage key of the origin, key length + value length, in characters; for `overload.state.v1` the length of the last successful save.
- Warnings: one line at the top of Today from 70% (app.js:390-391; hidden during a workout and on the unreadable screen); the Backup card shows the count and a bar (app.js:421-427); a failed save gives the banner and message of 3.3; while saving fails, sync does not write its bookkeeping (sync.js:86).
- Nothing in the code prunes or archives old workouts or old food days (not found). Both grow for ever.

### Size of a heavy user **(run)**

Built in the page with the shapes v2.8 writes, then saved by v2.8: 180 days of food at 15 entries a day, 300 different foods from the built-in list, 10 saved meals, 270 deletion records; 130 workouts (5 a week, 6 to 7 exercises × 3 sets, cardio), a weigh-in and a WHOOP night every day.

| Part | Characters | Per item |
| --- | --- | --- |
| `diary` | 596,801 | about 221 per entry, 3,300 per day |
| `food.foods` | 82,886 | about 276 per food |
| `food.meals` | 8,001 | about 800 per meal of 4 |
| `deleted.food` | 7,831 | 29 per record |
| `food.targets` | 48 | |
| **Food** | **695,567 (52%)** | |
| `workouts` | 579,773 | about 4,460 per workout, 3,200 per day |
| `sleep` | 21,961 | about 122 per WHOOP night |
| `presc` | 12,081 | |
| `exercises` | 11,847 | |
| `bodyweight` | 6,661 | 37 per weigh-in |
| `program`, `settings`, the rest | about 900 | |
| **Training** | **633,235 (48%)** | |
| **Whole state** | **1,329,025 = 53% of `STORE_LIMIT`** | |

Measured through the real screens: a diary entry 187 to 196 characters, a stored food 309 to 327, a saved meal of 4 items 591.

What this means after the split, at this rate of use:

- Fuel alone: about 0.70 M at 180 days (28% of the same guess), growing 3,300 a day. It reaches 70% after about 500 days of logging and 100% after about 720.
- Overload still carrying the old food copy: 53% on the day of the split, 0.70 M of it frozen food. Training reaches the 70% warning about 130 days later, against about 350 days later without the old copy.
- Saving the 1.33 M document took 17 ms in desktop Chromium. An iPhone was not measured.

Size of a transfer for this user: the food part as compact JSON 695,804 characters; pretty-printed 1.18 M; gzip 161,400 bytes; base64 of the gzip 215,200 characters; base64 without gzip 927,740 characters.

---

## 6. The food transfer payload

The draft spec (dev/notes/SPEC.md, section 5) already names an envelope. The fields below are what the code needs, checked against food.js.

### 6.1 Must contain

```js
{
  kind: 'overload-food',        // a format name of its own
  v: 1,                         // version of this payload (not the state's v)
  madeAt: <ms>, from: 'Overload <version>',
  counts: { days, entries, foods, favourites, meals },   // suggested: for the "what will be added" summary and as a cross-check

  food: {
    targets: { kcal, protein, carbs, fat },   // numbers or null
    foods:   { id: food },    // ALL of state.food.foods, every field of 2.6 untouched:
                              // id, src, name, brand, n, serving, servings (same order), usda, barcode, liquid, fav, used, last
    meals:   { id: meal }     // ALL of state.food.meals: id, name, items[], used
  },
  diary:   { 'YYYY-MM-DD': [entry] },   // every day; arrays in stored order; all 13 fields of 2.7, `at` included
  deleted: { food: { entryId: ms } },   // so a merge does not bring back entries deleted in the last 90 days
  settings: { units, theme },           // units decides the wording of the protein hint (food.js:996)
  bodyweight: [ { date, weight } ]      // only the latest weigh-in with weight > 0 (what food.js:994 picks), or []
}
```

How each thing the owner sees is covered:

| Seen in the app | Comes from |
| --- | --- |
| The same days and entries, in the same meals and order | `diary`, whole, array order and `meal` kept |
| The same totals | the entries' own `kcal, p, c, f` (food.js:45-47): nothing is recalculated from foods |
| Targets and the "adds up to" note | `food.targets` |
| Protein hint | `bodyweight` (latest) and `settings.units` |
| Favourites | `fav` on foods |
| Recents and their order | `used` on foods |
| Last-used amounts (what "+" logs) | `last` on foods, and the food's `serving` / `servings` so the unit still exists |
| Saved meals and their order | `food.meals` with `used` |
| Custom and corrected foods | foods with `src: 'custom'`, under their original ids |
| Remembered barcodes | `barcode` on foods |
| Editing an old entry with its amount | `entry.food` → `food.foods[id]`, and `entry.unit` (`s0`, `s1` …) → that food's `servings` by position |

Do not thin `food.foods` (for example to foods that entries point at): foods that are only starred, or only remembered for a barcode, would be lost. Do not re-order or shorten `servings`.

### 6.2 Must not contain

- `settings.connKey` (a secret), `settings.connUrl`, `settings.reminders`, or any setting other than `units` and `theme`.
- `exercises`, `presc`, `program`, `workouts`, `active`, `sleep`, `templates`, `libVersion`, `deleted.bw`, `deleted.sleep`, `deleted.workouts`, and the weigh-in history beyond the latest one.
- **A top-level `exercises` key of any kind.** Together with `v: 1` it is exactly what Overload's Import and Restore accept (app.js:2055, 436).
- Anything from `overload.sync.v1`, `overload.backup`, `overload.conn.*`; the account's email or uid.

### 6.3 What the receiver must do itself

- `normalize` does not validate food contents (2.6, 2.7), so Fuel has to: drop `__proto__` / `constructor` / `prototype` keys; accept only `YYYY-MM-DD` day keys with arrays of objects; require a text `id`, `meal` 0 to 3 (an entry with another value counts in the total but shows under no meal: food.js:336 against 354), finite numbers for `kcal, p, c, f` (anything else makes the totals `NaN`), text for `name, amt, brand`; require each food's key to equal its `id`.
- When reading a **full Overload backup** instead of a payload: take `food`, `diary`, `deleted.food`, `settings.units`, `settings.theme` and the latest `bodyweight`; ignore everything else, `settings.connKey` above all.
- Text encoding: `amt` holds `×` (U+00D7) whenever the amount is not 1 (food.js:101), and typed names can hold anything. Base64 must be made from UTF-8 bytes, not with `btoa` on the string.
- Use compact JSON; indenting nearly doubles it.

**In Fuel 3.0** (`normalize`, `incomingFrom`, `planImport`, `applyImport` in `fuel/fuel.js`): what arrives is cleaned as listed above, and what cannot be fixed is said in the question: numbers that cannot be read count as 0, an entry with no valid meal goes under Snacks, a missing time becomes just after the entry before it, an entry without an id gets one made from its day and what it holds as it arrived (identical ones on a day are counted), entries that are not objects and days that are not dates are left out. It is then added by the rules of SPEC section 4: entries by day and id, saved foods by id with Overload's star and his corrected numbers (`src: 'custom'` over a list copy) taken, saved meals by id, targets and body weight only when Fuel has none, units and theme only at Welcome, nothing deleted in Fuel brought back. The copy "Before import" is stored first, or nothing is added. The cloud's legacy copy, read at Fuel's first sign-in, is added by the same rules (`sync.md` 4.3).

---

## 7. Hazards

1. **A Fuel file can wipe training data.** Overload's Import and Restore accept anything with `v: 1` and an `exercises` array, and replace everything (run: a food-only file with `exercises: []` took the workouts to 0). *Precaution:* no file, state or payload Fuel writes may ever hold `exercises`; the planned Fuel state `{ v: 1, app: 'fuel', … }` is refused by v2.8 as long as that holds (run). Overload 3.0 should also refuse anything with `app` or `kind` set.
2. **Import, Restore and Reset in Overload replace the old food copy too.** A file without food empties it (run). *Precaution:* in 3.0, when the incoming file has no food and the phone has, keep the phone's `food`, `diary`, `deleted.food`, or say so in the question. `before-import` / `before-restore` / `before-reset` hold the previous state, but only the latest of each.
3. **Never change `v` or the key name of `overload.state.v1`, and never change the type of a field v2.8 knows.** After a roll-back v2.8 would open on the unreadable screen (`v` not 1), or `cleanValues` would turn the value into `null` or a default.
4. **Bookkeeping stored in the state is fragile.** A new top-level field survives load and save (run) but is lost on Reset, Import, Restore and Start fresh, and never reaches the cloud. *Precaution:* keep "a food copy was made on this phone" and the like in `overload.backup` (unknown fields survive v2.8, run) or in a key of its own.
5. **The proof "`deleted.food` byte for byte" cannot hold**: records older than 90 days are dropped on every load (app.js:285-288), and sync re-sorts the keys. *Precaution:* compare `food` and `diary` byte for byte, and `deleted.food` after the same 90-day rule.
6. **A v2.8 client and Fuel on the same `foodDays` documents fight.** (The draft spec lets Fuel own `users/{uid}/foodDays`.) A v2.8 Overload signed in to the same account (after a roll-back, on a second device, or on this phone before it has updated) still merges and writes those documents: (a) it merges by entry id against its **own** `deleted.food`, so an entry deleted in Fuel is put back and pushed (sync.js:290-305); (b) Reset or Import there deletes every food day in the cloud (sync.js:218-220), and Fuel's listener would then delete them locally (sync.js:291-296 if Fuel reuses that logic); (c) if Overload 3.0 ever empties its old food copy but leaves `days` in `overload.sync.v1`, a roll-back to v2.8 deletes every cloud food day at its first push. *Precaution:* give Fuel a collection of its own and read `foodDays` and `meta/state` only once, read-only; and whenever 3.0 stops syncing food days or removes the old copy, set `days` to `{}` in `overload.sync.v1` (v2.8 then adopts cloud days and deletes nothing).
7. **Emptying `food` in Overload's state empties it in `meta/state`**, the document the draft has Fuel start from on a first sign-in; other v2.8 devices adopt the empty value (sync.js:135-139). *Precaution:* do not upload an emptied `food` from Overload (leave the key as the cloud has it), or only after Fuel's own document exists.
8. **Names shared on one origin.** In an ordinary browser both apps share storage. If Fuel loads `backup.js` as it is, the two apps write the same `day-YYYY-MM-DD` record in `overload-copies` and overwrite each other's daily copy, and each lists the other's copies under Restore. *Precaution:* the database name (backup.js:10) must differ per app; so must every localStorage key; Fuel's cache name must not start with `overload-` (sw.js:57).
9. **Automatic copies are not a safety net for the upgrade.** The first 3.0 start saves the normalized state before the day copy is taken (app.js:2380, 2385); day copies last 7 opened days; today's copy misses food logged after it. *Precaution:* on the first 3.0 start, before the first save, store the raw text read from localStorage with `take('split', raw)`: it gets the id `before-split`, is never pruned, and v2.8 lists it as "Copy · date" with a working Restore (run).
10. **The old food copy takes room.** For a heavy user it is about 0.7 M of the 2.5 M guess, and Overload reaches the 70% warning months sooner (section 5). The warning text and the storage-full banner say nothing about it. *Precaution:* show its size next to "Remove the old food copy".
11. **A merge can bring deleted things back.** Entry deletions are remembered for 90 days only; deleted custom foods and saved meals are not remembered at all. Importing the old copy into Fuel again later puts back foods and meals deleted since, and entries deleted more than 90 days ago. *Precaution:* keep Fuel's deletion records longer, record food and meal deletions too, and warn when a payload's `madeAt` is not newer than the last one taken in. *In Fuel 3.0:* all three are done; records are never pruned.
12. **`settings.connKey` is a secret inside every export and in the cloud copy.** *Precaution:* never copy `settings` whole into Fuel or into the payload.
13. **The food reminder.** Its "done today" comes from `diary[today]` (connector.js:285). With the diary frozen it is never done, so a reminder that is on would fire every evening. The connector is not deployed today. *Precaution:* 3.0 sends `food.on = false` and drops the row (connector.js:20).
14. **food.js throws on a state without the shared pieces**: `deleted.food`, `diary`, `food.targets / foods / meals`, and `settings` once a body weight exists. *Precaution:* Fuel's own normalize guarantees them.
15. **Overload 3.0 still counts food days** in the import and restore questions, the copy list, the export reminder and the Reset question (app.js:451, 404, 381, 2238; backup.js:61). *Precaution:* reword them, or the owner reads "180 food days" in an app with no food.
16. **`overload.state.v1.bak`** is a second full copy in localStorage for as long as it exists. With a large state it can itself fill the storage. Fuel's shell should keep the same order: IndexedDB copy first, `.bak` removed once confirmed. *In Fuel 3.0:* it does (`leaveUnreadable`).

---

## 8. Open questions

1. Is cloud sync on on the owner's phone (is there an `overload.sync.v1`)? The code cannot tell us; it decides whether the cloud route exists at all.
2. How big is the owner's real data, and how much of it is food? Section 5 is a made-up heavy user.
3. The iPhone's real localStorage limit for a Home Screen app. `STORE_LIMIT` is a guess (app.js:14).
4. Which storage names the Firebase SDK uses (sign-in session, offline cache) and whether two apps on one origin collide there. I did not load the SDK.
5. Did the owner ever set a connector address or pair it (`settings.connUrl`, `connKey`, `reminders`)? If not, hazard 13 and the secret in hazard 12 do not apply to their data.
6. `settings.units` has no control in v2.8. The owner is presumably on `'lb'`; Fuel needs a place to set it if it keeps the protein hint. *In Fuel 3.0:* Settings > You has a Units switch, which converts the stored body weight.
7. How much text the iPhone clipboard and a paste into a web page take without trouble (215,000 to 930,000 characters for a heavy user). Not testable here.
8. Should a second import into Fuel be allowed at all once Fuel has its own entries, given hazard 11? *In Fuel 3.0:* yes. It adds only what is missing (with the star and his corrected numbers for saved foods both hold), brings nothing deleted in Fuel back, and says first when the copy is not newer than the last one brought in.
