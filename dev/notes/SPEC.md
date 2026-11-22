# Split and redesign: the spec

Status: DRAFT (decisions made before the code maps came back; section 12 lists what the maps must still settle).

The owner asked for two things:

1. Split Overload into two separate apps: a training app and a diet app. Keep all current data and separate it between the two.
2. Revamp the design.

One person uses the app, on an iPhone, from the Home Screen. Their only copy of the data may be the installed app's localStorage (cloud sync is optional and we cannot know whether it is on). So the first rule of this change is:

> **Nothing in this change may delete or rewrite data the owner already has.** The training app keeps carrying the food data it holds today until the owner removes it on purpose. A roll-back to v2.8 must find everything as v2.8 left it.

## 1. The two apps

| | Overload (training) | Fuel (diet) |
| --- | --- | --- |
| Address | `/overload/` (repo root, unchanged) | `/overload/fuel/` (new folder `fuel/`) |
| Home Screen icon | the one already installed keeps working | new: added from Safari |
| Storage key | `overload.state.v1` (unchanged) | `fuel.state.v1` |
| Other keys | `overload.sync.v1`, `overload.backup`, `overload.theme`, `overload.conn.*` | `fuel.sync.v1`, `fuel.backup`, `fuel.theme` |
| Automatic copies (IndexedDB) | `overload-copies` | `fuel-copies` |
| Offline cache name | `overload-vN` | `fuel-vN` (must NOT start with `overload-`: the root worker deletes those) |
| Service worker | `sw.js`, scope `/overload/`, ignores everything under `/overload/fuel/` | `fuel/sw.js`, scope `/overload/fuel/` |
| Tabs | Today, Program, Exercises, History, Settings | Today, Trends, Settings |
| Version | 3.0 | 3.0 (released together; `bump.sh` bumps both) |

"Fuel" is a working name held in one constant per file that shows it (manifest, page title, top bar), so renaming is a small change.

## 2. Who owns which data

- **Training (Overload):** settings (all training settings, theme, units), exercises, presc, program, workouts, active, bodyweight, sleep, templates, deleted.bw / deleted.sleep / deleted.workouts, libVersion, connector settings.
- **Food (Fuel):** food.targets, food.foods, food.meals, diary, deleted.food.
- **Copied once, then independent:** settings.units, settings.theme, and the latest body weight (Fuel uses it only for the protein guide under the targets; Fuel gets one editable "Body weight" number in Settings instead of weigh-ins).
- Weigh-ins and the morning check-in stay in Overload.

Fuel's saved state uses the same field names as today so `food.js` runs unchanged on it:

```js
{ v: 1, app: 'fuel', settings: { units, theme }, food: { targets, foods, meals }, diary: {}, deleted: { food: {} }, bodyweight: [ { date, weight } ] /* at most the latest */ }
```

## 3. Overload after the split

- No Food tab, no food card in Settings, no food-log reminder.
- `state.food`, `state.diary` and `state.deleted.food` stay in the saved state exactly as they are ("the old food copy"). `normalize` keeps validating them. Nothing in the app changes them.
- A card on Today, until dismissed, and a permanent card in Settings: **Food has moved to Fuel**, with
  1. Open Fuel in Safari (then Share, Add to Home Screen) and a Copy link fallback;
  2. Copy my food log (clipboard) and Save as a file (share sheet);
  3. when cloud sync is on: "Sign in to Fuel with the same email: your food log is already in your account";
  4. Remove the old food copy from Overload: destructive, asks twice, takes a safety copy first, never offered before a copy or file was made on this phone, and never automatic.
- Export JSON keeps writing the whole state (old food copy included while it exists).

## 4. Fuel

- A new shell (`fuel/app.js`) that gives `food.js` what it takes from `window.__overload` today, plus: Welcome (first start), Trends, Settings (targets, body weight for the protein guide, appearance, backup with automatic copies, cloud sync), the save-failed and unreadable-data paths, the update flow.
- First start with no data shows Welcome:
  - **Paste from Overload** (clipboard read on tap, with a text box fallback),
  - **Choose a file** (a food file from Overload, or any full Overload backup: Fuel takes only the food part),
  - **Sign in to cloud sync**,
  - **Start fresh**.
  - When this browser's storage also holds `overload.state.v1` with food in it (desktop, Android), a first choice "Bring it from Overload on this device" reads it directly.
- Importing into a Fuel that already has data merges and never replaces: entries by id (Fuel's copy wins for an id both have), foods and meals by id (Fuel's wins), targets only when Fuel has none, Fuel's deletion records respected. It shows what will be added before doing it and takes a safety copy first.
- On an iPhone, when the Fuel page is opened inside the installed Overload app (standalone, Overload's data present, not started from Fuel's own icon), it shows how to add Fuel to the Home Screen instead of running there, so the owner never logs food into the wrong storage.

## 5. The transfer payload

```js
{ kind: 'overload-food', v: 1, madeAt: <ms>, from: 'Overload 3.0',
  food: { targets, foods, meals }, diary: { 'YYYY-MM-DD': [entry] }, deleted: { food: { id: ms } },
  settings: { units, theme }, bodyweight: [ latest weigh-in or nothing ] }
```

- Clipboard text: `OVERLOAD-FOOD:1:` + base64 of the gzip of the JSON (CompressionStream); `OVERLOAD-FOOD:0:` + base64 of the UTF-8 JSON when gzip is not available. Fuel accepts both, and raw JSON.
- File: `overload-food-YYYY-MM-DD.json`, the JSON itself.

## 6. Cloud sync

Firestore today: `users/{uid}/meta/state` (`core`: one JSON string of settings, exercises, presc, program, active, bodyweight, sleep, templates, food, deleted), `users/{uid}/workouts/{id}`, `users/{uid}/foodDays/{date}`.

- **Overload 3.0** never reads, writes, merges or deletes `foodDays` again (push, listeners and the first link all drop it). The `food` key keeps riding along in `meta/state` unchanged, so the cloud's copy of targets, saved foods and meals is not destroyed by the update.
- **Fuel** owns `users/{uid}/meta/fuel` (`core`: JSON of settings, food, deleted.food, bodyweight) and `users/{uid}/foodDays/{date}` (same format as today). First sign-in with no `meta/fuel`: read `meta/state` and take its food part as the starting point; days merge entry by entry as today. Fuel uses its own Firebase app name and its own bookkeeping key so two apps on one browser profile do not share a session or a local cache.
- No change to `firestore.rules`.

## 7. Offline and updates

- Root worker: skip every request under `fuel/`; stop storing `data/foods.json` and `vendor/zxing/*`.
- Fuel worker: same all-or-nothing install and network-first behaviour; stores Fuel's files plus the shared files it loads from outside its folder (`../shared/*`, `../data/foods.json`, `../vendor/zxing/*`, Firebase SDK).
- The start-up rescue in each page only falls back to an older release of the SAME app and the same major version.

## 8. Reminders and WHOOP

Stay in Overload: morning check-in and workout reminders only. Fuel has none in 3.0.

## 9. Design

One design system shared by both apps (`shared/ui.css`: tokens and components), an accent per app, new inline-SVG icon set, new Home Screen icons, light and dark. Direction chosen from the design panel (see `dev/design/`).

## 10. Repo layout after the change

```
index.html  app.js  programs.js  connector.js  sync.js  backup.js  styles.css  sw.js  manifest.webmanifest  icon*   Overload
fuel/index.html  fuel/app.js  fuel/food.js  fuel/sync.js  fuel/fuel.css  fuel/sw.js  fuel/manifest.webmanifest  fuel/icon*   Fuel
shared/ui.css  (and shared/backup.js if both apps load it)                                                       both
data/foods.json  vendor/zxing/  tools/  .github/  connector/                                                    unchanged paths
tests/                                                                                                          fixtures and checks
```

## 11. Proof required before release

- v2.8 fixtures loaded into Overload 3.0: every training fact identical; the saved state still holds the food data byte for byte (same JSON for `food`, `diary`, `deleted.food`).
- Transfer round trip (clipboard text, file, same-storage, full backup file): Fuel shows the same days, entries and totals as v2.8 did.
- Sync, against a fake Firestore: Overload 3.0 issues no write or delete under `foodDays`; Fuel bootstraps from `meta/state`.
- Service workers: update from the real v2.8 worker to 3.0; both apps offline; neither worker touches the other's cache.
- Roll-back: state saved by 3.0 loads in v2.8 with food and training intact.
- Visual check of every screen and sheet, both themes, 320 to 430 px.

## 12. To settle from the code maps

- Exact list of fields (recents, favourites, barcodes, last amounts) and where they live.
- What the root worker does today for `fuel/` requests, and the first start under the old v2.8 worker.
- Whether unknown top-level fields survive load and save in v2.8 (for roll-back of the new `split` bookkeeping).
- The food-log reminder protocol.
