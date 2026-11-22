# Split and redesign: the spec (final for 3.0)

The owner asked for two things:

1. Split Overload into two separate apps: a training app and a diet app. Keep all current data and separate it between the two.
2. Revamp the design.

One person uses the app, on an iPhone, from the Home Screen. Their only copy of the data may be the installed app's localStorage (cloud sync is optional; we cannot know whether it is on). The first rule of this change:

> **Nothing in this change may delete or rewrite data the owner already has.** The training app keeps carrying the food data it holds today until the owner removes it on purpose. A roll-back to v2.8, or v2.8 starting again by itself during a half-arrived update, must find everything as v2.8 expects it.

The detailed findings behind every rule here are in the notes next to this file: `state.md`, `host-api.md`, `sync.md`, `offline.md`, `connector.md`, `ui-inventory.md`, `fixtures.md`. Where a note and this spec disagree, this spec wins; say so if you think the spec is wrong.

## 1. The two apps

| | Overload (training) | Fuel (diet) |
| --- | --- | --- |
| Address | `/overload/` (repo root, unchanged) | `/overload/fuel/` (new folder `fuel/`) |
| Home Screen icon | the installed one keeps working (iOS keeps its old picture) | new: added from Safari |
| Page | `index.html` | `fuel/index.html` |
| Main script | `app.js` | `fuel/fuel.js` (NOT `app.js`: the start-up rescue matches that name) |
| State key | `overload.state.v1` (unchanged, `v: 1`) | `fuel.state.v1` (`v: 1`, `app: 'fuel'`) |
| Other keys | `overload.sync.v1`, `overload.backup`, `overload.theme`, `overload.conn.*` (all unchanged) | `fuel.sync.v1`, `fuel.backup`, `fuel.theme` |
| Automatic copies (IndexedDB) | `overload-copies` (`backup.js`) | `fuel-copies` (`fuel/backup.js`, its own copy of the file) |
| Offline cache | `overload-vN` | `fuel-vN` (never a name starting `overload-`: the root worker deletes those) |
| Service worker | `sw.js`, scope `/overload/` | `fuel/sw.js`, registered as `./sw.js` from the Fuel page, scope `/overload/fuel/` |
| Manifest | `manifest.webmanifest`: `start_url`, `scope` and no `id`, exactly as today | `fuel/manifest.webmanifest`: `start_url: "./index.html"`, `scope: "./"`, no `id` |
| Cloud sync | `sync.js` (patched), Firebase default app, `meta/state` + `workouts` | `fuel/sync.js` (own copy), Firebase app named `fuel`, `meta/fuel` + `fuelDays` |
| Tabs | Today, Program, Exercises, History, Settings (screen names unchanged) | Today (screen name stays `food`), Trends, Settings |
| Version | 3.0 | 3.0 (always released together; `bump.sh` bumps both) |

Shared by both apps: `shared/ui.css` (the design system), `data/foods.json`, `vendor/zxing/`. Nothing else is shared; each app is otherwise self-contained in its folder.

"Fuel" is a working name. Keep it in as few places as possible (manifest, page title, top bar, a constant `APP_NAME` in `fuel/fuel.js`, the wording in Overload's hand-over card).

Paths that must not move or change: `sw.js`, `manifest.webmanifest` fields, `data/foods.json`, `tools/*`, `connector/**`, `connector.json`, `.nojekyll`, `.github/workflows/*`. Do not touch `connector/` or the workflows at all (a change there can start a deploy).

## 2. Who owns which data

- **Training (Overload):** settings (all of them, including connector settings and `reminders`), exercises, presc, program, workouts, active, bodyweight, sleep, templates, deleted.bw / deleted.sleep / deleted.workouts, libVersion.
- **Food (Fuel):** food.targets, food.foods (favourites, recents, last amounts, barcodes and custom foods are fields on these), food.meals, diary, deleted.food.
- **Copied once, then independent:** settings.units, settings.theme, and the latest body weight (Fuel uses it only for the protein guide under the targets). Nothing else from `settings` may ever reach Fuel: `settings.connKey` is a secret.
- Weigh-ins, sleep and the morning check-in stay in Overload.

Fuel's saved state keeps today's field names so `food.js` runs on it unchanged:

```js
{ v: 1, app: 'fuel',
  settings: { units: 'lb' | 'kg', theme: 'system' | 'dark' | 'light' },
  food: { targets: { kcal, protein, carbs, fat }, foods: { id: food }, meals: { id: meal } },
  diary: { 'YYYY-MM-DD': [entry] },
  deleted: { food: { entryId: ms }, foods: { foodId: ms }, meals: { mealId: ms } },   // never pruned in Fuel
  bodyweight: [ { date, weight } ],        // at most one item: the number used by the protein guide
  moved: { from, at, days, entries, madeAt } | null }   // record of the hand-over from Overload
```

A Fuel state, file or payload must never contain an `exercises` field (Overload's Import accepts any file with `v: 1` and an `exercises` array and replaces everything).

Fuel's own `normalize` guarantees every container above exists, coerces entry numbers (`kcal`, `p`, `c`, `f`, `at` to numbers, `meal` to 0..3), gives every entry an id, drops day keys that are not `YYYY-MM-DD`, and keeps unknown fields.

## 3. Overload 3.0

Kept exactly: the state key, `v: 1`, every existing field and its type, `settings.reminders.food`, `overload.sync.v1` in v2.8's meaning, the `overload:save` event, `window.__overload` (state, screen, save, render, toast, setState, computeNext, checkinDone, safetyCopy, lib with the same helpers, setSyncStatus, syncChanged, noteUpdateReady), screen names, `#bw-form`, the push handlers in `sw.js`.

Changed:

1. **No Food.** No Food tab, no `food.js` script, no food card in Settings. `state.food`, `state.diary` and `state.deleted.food` stay in the saved state as "the old food copy"; `normalize` keeps handling them; no code changes them except rule 5.
2. **First 3.0 start.** Before the first save, store the raw text of `overload.state.v1` with `window.__overloadBackup.take('split', raw)` (id `before-split`, never pruned; v2.8 lists and restores it). Record `split.at` (see 4).
3. **Hand-over card: "Food has moved to Fuel".** On Today until dismissed or done, and always in Settings. It offers, in this order:
   1. *Get Fuel*: a button that opens the Fuel address in Safari (`x-safari-https://` + host + path on iOS standalone; a normal new-tab link elsewhere) and a *Copy link* button, with the two instructions "In Safari tap Share, then Add to Home Screen".
   2. *Copy my food log* (clipboard) and *Save as a file* (share sheet, falling back to a download).
   3. In Fuel: *Paste from Overload*.
   4. A line for cloud-sync users: signing in to Fuel with the same email also brings the log across.
   5. *Remove the old food log from Overload*: see rule 5.
   The card shows what the copy holds (days, entries, saved foods, size). When the old food copy changed after the last copy or file (v2.8 can run again during a half-arrived update), the card comes back and says so.
4. **Per-phone bookkeeping** lives in the `overload.backup` localStorage object (unknown fields survive v2.8), never in the state: `split: { at, copied: { at, hash, days, entries }, filed: { at, hash }, removed: { at }, dismissed }`.
5. **Remove the old food log.** Only offered after a copy or file was made on this phone. Asks twice, takes a safety copy first (`take('foodremove', text)`), then empties `state.diary` only. `state.food` (the small catalogue) and `state.deleted.food` stay, so the cloud's legacy copy and a v2.8 roll-back stay sane.
6. **Reset, Import, Restore** never drop the old food copy: when the phone holds one, it is carried across; the file's food is used only when the phone has none. Their questions say so, and no longer say the food log or the account's food is erased. Import and Restore refuse a file that has `app` or `kind` set ("This is a Fuel file. Open it in Fuel.").
7. **Export JSON** is unchanged (whole state, old food copy included).
8. **Reminders:** the Food row is gone; the config sent to the connector always has `reminders.food.on = false` and no `done.food` (`connector.md` section 2.2). `settings.reminders.food` stays in the saved state.
9. **Cloud sync:** the patch in `sync.md` Appendix A: never read, write, merge or delete `foodDays`; re-send the food part the cloud already holds; send the core only after the cloud's core was seen in the session.
10. **Service worker:** the fetch handler returns early for `fuel/`, `data/` and `vendor/`; `food.js`, `data/foods.json` and `vendor/zxing/*` leave the install list; `notificationclick` ignores windows under `fuel/`; the page holds a pending reload while a sheet is open as well as during a workout or typing.
11. **Start-up rescue** (inline script in `index.html`): falls back only to an older release of this app with the same major version, matches the full path of this app's scripts, and handles every stylesheet link.

## 4. Fuel 3.0

- `fuel/fuel.js`: a classic script that runs before `fuel/food.js` and offers what `food.js` takes from `window.__overload` (`host-api.md` section 8 and 12): `state`, `screen` (exactly `'food'` while the diary is on screen), `saveFailed`, `save()`, `render()` (synchronous), `lib` with the twelve helpers, plus what `fuel/sync.js` needs (`setState`, `unreadable`, `safetyCopy`, `setSyncStatus`, `syncChanged`) and the `overload:save` / `overload:sheetclose` events with their current names.
- `fuel/food.js`: moved from the root with `git mv`; the three page-relative addresses become `../data/foods.json?db=5` and `../vendor/zxing/...`. Further edits only where the redesign needs them (icons, markup classes), never to its data handling.
- Screens: Today (the food diary), Trends (new, read-only: 14 days of calories against the target, averages for this week and last week, days logged), Settings (targets, body weight for the protein guide, units, appearance, backup with automatic copies and export/import, cloud sync, About with the version).
- Robustness copied from Overload: the save-failed banner, the unreadable-data screen, storage use, automatic copies (one a day kept 7 days, refreshed when the app goes to the background so the day's food is in it; plus one before each import, reset, restore, cloud first link), the update flow, the start-up rescue.
- **Where it runs on an iPhone** (`'standalone' in navigator`):
  - not standalone (a Safari tab): show "Add Fuel to your Home Screen" (Share, Add to Home Screen) with a quiet "Use it here anyway";
  - standalone, `overload.state.v1` present and no `fuel.state.v1`: this is Overload's own storage. Show the same instructions with *Open in Safari* and *Copy link*; take no data and do not register the worker.
  - otherwise run.
- **Welcome** (no Fuel data yet): *Paste from Overload*, *Choose a file*, *Sign in to cloud sync*, *Start fresh*; and, when this browser's storage holds `overload.state.v1` with food in it (desktop, Android), *Bring it from Overload on this device* first.
- **Import** accepts: the clipboard text, the food file, a full Overload backup (`v: 1` with `exercises`: only the food part, `settings.units`, `settings.theme` and the latest weigh-in are taken), a Fuel backup. It never replaces: entries merge by id (Fuel's copy wins for an id both have), foods and meals by id (Fuel's win), targets and body weight only when Fuel has none, Fuel's deletion records respected. It shows what will be added first, takes a safety copy, records `moved`, and warns when the payload is not newer than the last one imported.
- **Deletions in Fuel** are recorded for entries, foods and meals and never pruned, so a later import or cloud bootstrap cannot bring them back.

## 5. The hand-over payload

```js
{ kind: 'overload-food', v: 1, madeAt: <ms>, from: 'Overload 3.0',
  food: { targets, foods, meals }, diary: { 'YYYY-MM-DD': [entry] }, deleted: { food: { id: ms } },
  settings: { units, theme }, bodyweight: [ latest weigh-in ] or [] }
```

- The diary is copied as it is (entries whose food no longer exists and quick adds included).
- Clipboard text: `OVERLOAD-FOOD:1:` + base64 of the gzip (CompressionStream) of the compact JSON as UTF-8 bytes; `OVERLOAD-FOOD:0:` + base64 of the UTF-8 bytes when gzip is not available. Never `btoa` on the raw string (names hold non-Latin-1 characters).
- File: `overload-food-YYYY-MM-DD.json`, the compact JSON.

## 6. Cloud sync

Firestore today: `users/{uid}/meta/state` (`core`: one JSON text of settings, exercises, presc, program, active, bodyweight, sleep, templates, food, deleted), `users/{uid}/workouts/{id}`, `users/{uid}/foodDays/{date}`.

- **Overload 3.0:** `sync.md` section 3 and Appendix A.
- **Fuel:** `sync.md` section 4. Owns `users/{uid}/meta/fuel` (`core`: JSON text of settings, food, deleted, bodyweight) and `users/{uid}/fuelDays/{date}`. First sign-in when `meta/fuel` does not exist: read `meta/state` and `foodDays` once, read-only, take the food part, merge with what the phone has (the phone's copy wins by id), then write only its own documents. It never writes under `meta/state`, `workouts` or `foodDays`.
- No change to `firestore.rules`.
- Each `sync.js` stays one file with absolute imports only.

## 7. Design

Direction "Instrument" (`dev/design/a-instrument/`), with the changes in `dev/design/SYSTEM.md`. One design system in `shared/ui.css`, an accent per app (`data-app="overload"` vermilion, `data-app="fuel"` green), inline SVG icons, new Home Screen icons, light and dark. No behaviour changes ride along with the restyle except those listed in `SYSTEM.md`.

## 8. Proof required before release

- v2.8 fixtures in Overload 3.0: every training fact in `tests/fixtures/v28-facts.json` identical; `food` and `diary` in the saved state byte for byte; `deleted.food` equal after the 90-day rule; the active-workout fixture resumes where it was.
- Hand-over round trip with the main fixture by clipboard text (both encodings), file, full backup file and same-storage read: Fuel shows the three named food days with the same totals, 3 saved meals, 6 favourites, the recents; a second import adds nothing and brings nothing deleted back.
- Roll-back: state saved by 3.0 loads in v2.8 with the same training facts and food days; Settings draws.
- Sync against a fake Firestore: Overload 3.0 issues no set or delete under `foodDays` and leaves the food part of `meta/state` byte-identical through removal, Reset, Import, Restore and a new phone's first link; Fuel writes only `meta/fuel` and `fuelDays`.
- Service workers: update from the real v2.8 worker to 3.0; both apps start offline; neither worker stores or deletes the other's files; a slow or failing Fuel page under the 3.0 root worker is not answered with the training page.
- Visual check of every screen and sheet of both apps, both themes, 320 to 430 px wide; no text under AA contrast.
