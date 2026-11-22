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
| `index.html` | The page: top bar, tab bar (Today, Trends, Settings), the sheet, the toast. Applies the saved theme before first paint, and holds the start-up rescue (runs the previous release's stored files when this release's did not arrive). |
| `fuel.js` | The shell. Loads and saves the data, draws the frame, Trends and Settings, keeps the backups, brings the food log across from Overload, registers the offline worker. Offers `window.__overload` to `food.js` and `sync.js`. |
| `food.js` | The diary itself (Today), moved here from the repo root. It runs on `window.__overload` exactly as it did in Overload. |
| `backup.js` | Automatic copies in IndexedDB (`fuel-copies`). Fuel's own copy of the training app's file. |
| `fuel.css` | The few styles only Fuel has. Everything else comes from the stylesheet it shares with the training app. |
| `sync.js` | Cloud sync (optional). The app starts and works without it. |
| `sw.js` | The offline worker (cache `fuel-vN`, scope `/overload/fuel/`). |
| `manifest.webmanifest`, `icon*.png`, `icon.svg` | What "Add to Home Screen" uses. `start_url` and `scope` must not change once the app is on a phone. |

Shared with the training app and left where they are: `../data/foods.json` (the food list) and
`../vendor/zxing/` (the barcode reader). `food.js` asks for them one folder up from the page.

The scripts are classic scripts in this order: `backup.js`, `fuel.js`, `food.js`. `food.js` takes
`window.__overload` and its twelve `lib` helpers while it loads, so `fuel.js` must have run first.
`sync.js` is a module and comes last.

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
  the background), and one before each import, reset, restore and cloud sign-in. Settings lists them.
- Export JSON writes the state itself as `fuel-backup-YYYY-MM-DD.json`.

## Where it runs on an iPhone

An iPhone keeps a separate storage for Safari and for each Home Screen app. Fuel checks
`navigator.standalone` (only iPhones and iPads have it):

- In a Safari tab it shows how to add Fuel to the Home Screen, with "Use it here anyway" (remembered for that
  tab only).
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

An import never replaces and never removes. Entries, saved foods and saved meals are added by id, and what
Fuel already has stays as it is. Targets and body weight are taken only when Fuel has none; units and theme
only at Welcome. What was deleted in Fuel stays deleted. Before anything is added Fuel says what the copy
holds and what is new, keeps a safety copy, and afterwards notes the hand-over in `moved`. A copy that is not
newer than the last one brought in is said to be so.

## Tests

From the repo root, each with its own local server (`--port=` changes it):

```bash
node tests/fuel-shell.js     # first start, a day of use, reload, the saved state's shape
node tests/fuel-import.js    # every way in from Overload, second imports, malformed input
node tests/fuel-guard.js     # Safari tab, inside Overload, Home Screen app, a computer
node tests/fuel-backup.js    # export and import, automatic copies, restore, unreadable data, storage full
node tests/fuel-host.js      # what the shell gives cloud sync, with a stand-in for sync.js
node tests/fuel-update.js    # how the page takes a new offline worker, with stand-in workers
node tests/fuel-rescue.js    # the start-up rescue in index.html, with stored copies put there by hand
```

`tests/fuel-common.js` is their shared helper. It builds what Overload hands over from the v2.8 fixtures and
the spec, not with the training app's code.
