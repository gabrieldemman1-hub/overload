# Fuel

A personal food diary: calories, protein, carbs and fat. Vanilla JavaScript, no build step. It lives at
`/overload/fuel/` and is added to the iPhone's Home Screen from Safari as an app of its own.

Until 3.0 Fuel was the Food tab of Overload, the training app one folder up. The two are released together
under one number (`bump.sh` in the repo root sets it in both), but they are separate apps with separate data.
"Fuel" is a working name: it is written in `index.html`, `manifest.webmanifest`, and once in `fuel.js`
(`APP_NAME`).

## Files

| File | What |
| --- | --- |
| `index.html` | The page: top bar (Fuel's mark and the name of the screen), tab bar (Today, Trends, Settings), the sheet, the toast. `data-app="fuel"` on `<html>` gives the shared stylesheet Fuel's green. Applies the saved theme before first paint, and holds the start-up rescue (runs the previous release's stored files when this release's did not arrive). |
| `fuel.js` | The shell. Loads and saves the data, draws the frame, Welcome, Add to Home Screen, Trends and Settings, keeps the backups, brings the food log across from Overload, registers the offline worker. Offers `window.__overload` to `food.js` and `sync.js`. |
| `food.js` | The diary itself (Today and its sheets), moved here from the repo root. It runs on `window.__overload` exactly as it did in Overload. |
| `backup.js` | Automatic copies in IndexedDB (`fuel-copies`). Fuel's own copy of the training app's file. |
| `fuel.css` | The rules only Fuel needs: the calorie gauge and the macros, meals and food rows, the Add and amount sheets, the scanner, Trends, Welcome and Add to Home Screen. Loaded after `../shared/ui.css`. |
| `sync.js` | Cloud sync (optional). The app starts and works without it. Where its data is in the account: see below. |
| `sw.js` | The offline worker (cache `fuel-vN`, scope `/overload/fuel/`). Its install list names every versioned file the page loads, written as the page writes it (`sh bump.sh --check` in the repo root compares them). Until Fuel's own worker is active, Settings > About says the app is getting ready, or not ready, to work offline; a first install that failed is tried again each time the app comes back to the front. |
| `manifest.webmanifest`, `icon*.png`, `icon.svg` | What "Add to Home Screen" uses: a fork beside a plate with a leaf, on Fuel's green. `start_url` and `scope` must not change once the app is on a phone. |

Shared with the training app, one folder up, and left where they are:

| File | What |
| --- | --- |
| `../shared/ui.css` | The design both apps share: colours, type, and every shared component (buttons, cards, rows, sheets, the top bar and the tab bar). Each app sets its accent with `data-app`. |
| `../shared/icons.js` | The icon set: `icon('name')` gives an inline SVG. Fuel's mark in the top bar and the three tab icons are the same drawings, written out in `index.html`. |
| `../data/foods.json` | The food list. `food.js` asks for it one folder up from the page. |
| `../vendor/zxing/` | The barcode reader, loaded on the first scan. |

The look is described in `../dev/design/SYSTEM.md`; its reference screens are in `../dev/design/system/`.

The scripts are classic scripts in this order: `../shared/icons.js`, `backup.js`, `fuel.js`, `food.js`.
`fuel.js` and `food.js` draw their icons with `icon()` and still run if `icons.js` did not arrive (without
icons). `food.js` takes `window.__overload` and its twelve `lib` helpers while it loads, so `fuel.js` must
have run first. `sync.js` is a module and comes last. `window.__overload` has twelve members: the six
`food.js` uses (`state`, `screen`, `saveFailed`, `save`, `render`, `lib`) and six more for `sync.js`
(`setState`, `unreadable`, `safetyCopy`, `setSyncStatus`, `syncChanged`, and `startedWithData`: whether the
page started on saved data). `tests/fuel-shell.js` checks the list.

## How the data is kept

Everything is in `localStorage` on the device, under names of Fuel's own:

| Key | Holds |
| --- | --- |
| `fuel.state.v1` | The whole state, one JSON document (below). |
| `fuel.backup` | `{ since, lastExport, nagOff }`: this phone only. |
| `fuel.theme` | A mirror of the theme setting, read before first paint. |
| `fuel.sync.v1` | Cloud sync's note of what the account holds. |

```js
{ v: 1, app: 'fuel',
  settings: { units: 'lb' | 'kg', theme: 'system' | 'dark' | 'light' },
  food: { targets: { kcal, protein, carbs, fat }, foods: { id: food }, meals: { id: meal } },
  diary: { 'YYYY-MM-DD': [entry] },
  deleted: { food: { entryId: ms }, foods: { foodId: ms }, meals: { mealId: ms } },
  bodyweight: [ { date, weight } ],     // at most one: the number the protein guide uses
  moved: { from, at, days, entries, madeAt } | null }   // the hand-over from Overload
```

- The field names are the ones Overload used, which is why `food.js` runs unchanged.
- A Fuel state or file never has an `exercises` field. Overload's Import takes any file with `v: 1` and
  `exercises` for one of its own backups and replaces everything with it.
- `normalize` in `fuel.js` runs on load, on what cloud sync delivers and on everything an import reads. It
  makes sure every container exists, entries have an id and numbers, days are dates, and it keeps fields it
  does not know.
- Deletion records are kept for entries, saved foods and saved meals, and are never pruned. Overload keeps its
  old copy of the food log for good, so it can be imported again at any time, and nothing deleted in Fuel may
  come back with it.
- A save that fails (storage full) shows a banner until a save works. Stored data that cannot be read is
  never written over: the app shows "Your data" and lets the owner export it, restore a copy or start fresh.
- Automatic copies: one a day for the last 7 days (taken at start, brought up to date when the app goes to
  the background), and the latest one from before an import, a reset, a restore and a cloud sign-in (one of
  each kind: the next one of that kind replaces it). Settings lists them. Reset, Restore and an import wait
  for their copy: when it cannot be stored (IndexedDB does not answer), nothing is erased, replaced or added,
  and the app offers Export instead. A connection to the copies that the phone dropped is opened again by the
  next copy. The copy before a cloud sign-in is taken from the data as it was before the account's was merged
  in, and the sign-in does not wait for it.
- Export JSON writes the state itself as `fuel-backup-YYYY-MM-DD.json`.

## Cloud sync: where the data is in the account

Cloud sync is optional. It uses the same Firebase project and the same email and password as Overload, so
one account holds both apps' data, in documents of their own:

| In the account | Holds | Written by |
| --- | --- | --- |
| `users/{uid}/meta/fuel` | `{ core, updatedAt, v: 1 }`. `core` is one JSON text: units and theme, the food targets, saved foods, saved meals, the deletion records and the body weight. | Fuel |
| `users/{uid}/fuelDays/{YYYY-MM-DD}` | `{ data, updatedAt, v: 1 }`: one document for each day of the food log. | Fuel |
| `users/{uid}/meta/state`, `users/{uid}/workouts/{id}` | Overload's training data. | Overload |
| `users/{uid}/foodDays/{YYYY-MM-DD}` | The food log as Overload kept it up to 2.8. Overload 3.0 leaves it as it is. | Overload up to 2.8 |

- Fuel writes and listens only under `meta/fuel` and `fuelDays`. It never writes, deletes or listens to
  Overload's documents, so nothing either app does can change what the other finds.
- The first sign-in to an account that has no `meta/fuel` yet reads `meta/state` and `foodDays` once, to bring
  the food log across: days, targets, saved foods and meals, the deletion records of entries, units, theme
  and the latest weigh-in. It is added by the rules of an import (below; `addFromOverload` in `sync.js`
  repeats `planImport` in `fuel.js`, and a change to one must be made to both), so signing in and Paste from
  Overload, in either order, end the same and the second finds nothing new. Units and theme are taken when
  the phone holds no food of its own yet (signing in from Welcome leaves Welcome before the account answers).
  Entries without an id, which v2.8 never uploads, are left out; they come with Copy my food log.
  Nothing is sent before those reads have worked. After that Overload's copy is never read again: food logged
  later in an old Overload comes with Copy my food log.
- On the phone, `fuel.sync.v1` is sync's note of what the account holds of this phone's data (`{ uid, core,
  days }`, as fingerprints). A day leaves a phone only through deletion records, never because its document
  is missing in the account. `moved` is not part of `core`: it stays on each phone. A page that starts with no
  saved data removes the note (it would describe data that is gone, and the next upload would delete in the
  account what it lists), and sync believes a note only on a page that started on saved data
  (`window.__overload.startedWithData`, which `fuel.js` sets before anything can be tapped).
- The Firebase app has a name of its own (`fuel`), so where both apps share one browser storage they do not
  share a sign-in or an offline cache.
- `../firestore.rules` needs nothing for this: its one rule covers everything under `users/{uid}`.
- The three Firebase files are not in the worker's install list (a slow or blocked download must never keep
  the app from installing). The worker stores them once it is active, and whenever a page loads them.
- Reset and Restore replace the food log in the account too when signed in. They write no deletion records,
  so a second phone signed in that still holds the old log sends its days and saved foods back. Their
  questions say so: sign out on that phone first, and reset it there before signing in again (its note is
  then gone, and its next sign-in takes the account's copy).

## Where it runs on an iPhone

An iPhone keeps a separate storage for Safari and for each Home Screen app. Fuel checks
`navigator.standalone` (only iPhones and iPads have it):

- In a Safari tab it shows how to add Fuel to the Home Screen, with "Use it here anyway" (remembered for that
  tab only). When the tab already holds Fuel data, the screen says so first and offers Export: the Home Screen
  app starts empty, and its Welcome takes that Fuel backup under Choose a file.
- In a Home Screen app that holds Overload's data and none of Fuel's, the page was opened inside the installed
  Overload. It shows Open in Safari and Copy link, stores nothing and registers no worker.
- Otherwise it runs.

## The hand-over from Overload

Overload 3.0 no longer shows food, but keeps the food log it had. Its card "Food has moved to Fuel" offers
Copy my food log (text on the clipboard) and Save as a file. With no data of its own yet, Fuel opens on
Welcome: Paste from Overload, Choose a file, Sign in to cloud sync, Start fresh, and, where both apps share
one browser storage (a computer), Bring it from Overload on this device. The same import is in Settings later
("Bring food from Overload").

Fuel reads four things:

- the clipboard text: `OVERLOAD-FOOD:1:` + base64 of the gzipped JSON, or `OVERLOAD-FOOD:0:` + base64 of the
  JSON, both as UTF-8 bytes;
- the food file `overload-food-YYYY-MM-DD.json` (`{ kind: 'overload-food', v: 1, madeAt, from, food, diary,
  deleted: { food }, settings: { units, theme }, bodyweight }`);
- a full Overload backup: only the food part, units, theme and the latest weigh-in are taken. Nothing else of
  its settings is ever read (its connector key is a secret);
- a Fuel backup.

An import never removes, and adds only what is missing here, with one exception for saved foods:

- Entries go by day and id. An entry is already here when Fuel holds its id on the same day, and then Fuel's
  copy stays. (Before v2.5 an entry edited across midnight was kept on both days under one id; v2.8 shows
  both, and both arrive.) New entries go at the end of their day. An entry without an id gets one made from
  its day and what it holds, so a later copy does not add it again.
- Saved foods go by id. One Fuel already holds stays, and takes the copy's star when it has none. When the
  copy's is one he corrected or typed in (src `custom`) and Fuel's is the food list's own (src `usda` or
  `off`), the copy's whole food takes its place, with Fuel's last use, last amount and star kept. A food made
  or corrected in Fuel keeps its numbers.
- Saved meals go by id, and Fuel's stay. Targets and body weight are taken only when Fuel has none; units and
  theme only at Welcome. What was deleted in Fuel stays deleted, and the copy's deletion records come along
  for anything Fuel does not hold.

Before anything is added Fuel says what the copy holds, what is new and which saved foods are updated, keeps
a safety copy (and waits for it: when it cannot be stored, nothing is added; at Welcome there is nothing to
keep), and afterwards notes the
hand-over in `moved`. A copy that is not newer than the last one brought in is said to be so.

## Tests

From the repo root, each with its own local server (`--port=` changes it):

```bash
node tests/fuel-shell.js     # first start, a day of use, reload, the saved state's shape
node tests/fuel-import.js    # every way in from Overload, second imports, malformed input
node tests/fuel-guard.js     # Safari tab (with and without Fuel data), inside Overload, Home Screen app, a computer
node tests/fuel-backup.js    # export and import, automatic copies, restore, unreadable data, storage full, the share sheet
node tests/fuel-trends.js    # Trends left open over midnight, or found in the morning, follows the date
node tests/fuel-look.js      # Today's three macro cells at 320, 390 and 430 px
node tests/fuel-host.js      # what the shell gives cloud sync, with a stand-in for sync.js
node tests/fuel-update.js    # how the page takes a new offline worker, with stand-in workers
node tests/fuel-rescue.js    # the start-up rescue in index.html, with stored copies put there by hand
node tests/fuel-sync.js      # cloud sync against a stand-in for Firebase (tests/fake-firebase), next to Overload; sign-in against Paste
node tests/fuel-sw.js        # the offline worker with real service workers, alone and beside Overload's
```

`tests/fuel-common.js` is their shared helper. It builds what Overload hands over from the v2.8 fixtures and
the spec, not with the training app's code.
