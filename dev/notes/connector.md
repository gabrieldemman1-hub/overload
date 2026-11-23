# WHOOP and reminders: how it works today, and what the split must do

Scope: `connector.js` (392 lines), `connector/worker.js` (417 lines), `connector/wrangler.toml`,
`connector/package.json`, `connector.json`, `.github/workflows/deploy-connector.yml`, the push part of
`sw.js`, and the places in `app.js` and `sync.js` they touch. All read in full at v2.8 (branch
`claude/split-training-diet`). No source file was changed. Facts marked **(run)** were also checked by
running the code (section 7).

## 0. Short answer

- The feature is optional and **off today**: `connector.json` is `{ "url": "" }` and has never held an
  address in git history (one commit, e6a5334). With no address the app makes no connector call, creates
  no key, saves no `reminders` and writes no `overload.conn.*` key **(run)**.
- The connector knows what is "done" only from what the app last sent it (`PUT /config`). Food is "done"
  when `state.diary[today]` has at least one entry on this phone (`connector.js:285`).
- After the split the training app no longer adds to `state.diary`, so food would never be "done" again.
  A food reminder that is on would fire **every evening**, whatever was logged in the diet app, and its
  Settings row would still say "Skipped if you logged food today" **(run)**.
- Smallest fix: three code lines in `connector.js` (drop the Food row; always send the food reminder as
  off; stop sending a food "done"). **Nothing has to change in `worker.js`**, and today's worker code
  works with the changed app **(run)**. Do not touch `connector/` at all in this release.
- Do **not** remove `settings.reminders.food` from the saved state: v2.8 then cannot draw Settings
  after a roll-back **(run)**.

## 1. What the feature does today

### 1.1 The parts

| Part | Where it runs | What it does |
| --- | --- | --- |
| `connector.js` | in the app, loaded after `app.js` and `food.js` (`index.html:133`) | Finds the connector, pairs with it, pulls WHOOP nights into `state.sleep`, turns Web Push on, tells the connector the reminder times and what is done today, and draws the WHOOP and Reminders cards in Settings. Plugs in as `window.__overloadConn` (`connector.js:349-380`). |
| `connector/worker.js` | a Cloudflare Worker named `overload-connector` (`connector/wrangler.toml:2`), one owner | Holds the WHOOP app secret and tokens, does the WHOOP login, returns nights, stores the push subscriptions, and every 5 minutes (`wrangler.toml:15`, `worker.js:415`) sends the reminders that are due. |
| `sw.js:109-124` | the app's service worker | Shows a pushed reminder as a notification (`push`, `sw.js:110-116`) and opens or focuses the app on tap (`notificationclick`, `sw.js:117-123`). |
| `connector.json` | repo root, served with the app | `{ "url": "…" }`: the connector's address. Written by the deploy workflow. Empty today. |
| `deploy-connector.yml` | GitHub Actions | Deploys `connector/` and commits `connector.json`. |

### 1.2 Where everything is stored, and whether it is synced

| Data | Where | Written at | Synced? |
| --- | --- | --- | --- |
| `settings.connUrl` | `overload.state.v1` → `settings` | `connector.js:71` (from `connector.json`), `connector.js:375` (typed in Settings) | **Yes.** `settings` is one of sync's `CORE_KEYS` (`sync.js:33`) and goes whole into `users/{uid}/meta/state` (`sync.js:91-92, 201`). Also in every export file. |
| `settings.connKey` | same | `connector.js:25-29`, made on the first connector call: 20 random bytes as 40 hex characters | **Yes**, same way. It is a secret. |
| `settings.reminders` | same | `connector.js:30-34` (defaults, only when the whole object is missing), `connector.js:367` (On/Off), `connector.js:371` (time) | **Yes**, same way. Shape: `{ checkin: {on, time}, workout: {on, time}, food: {on, time} }`, defaults `connector.js:19` (food is off by default). |
| WHOOP nights | `state.sleep[]` as `{ date, total, rem, deep, light, recovery, rhr, hrv, perf, src: 'whoop' }` | `mergeNights`, `connector.js:114-130` | Yes (`sleep` is a core key, merged by date). |
| `overload.conn.synced` | localStorage | `connector.js:143` | No. Time of the last WHOOP sync. |
| `overload.conn.pairing` | localStorage | `connector.js:162, 180, 191, 360` | No. When a WHOOP login was started. |
| `overload.conn.cfg` | localStorage | `connector.js:294` | No. Address + JSON of the config last sent, so the same config is not sent twice (`connector.js:292-293`). |
| `cs` | memory only | `connector.js:21` | No. |
| On the connector (Workers KV) | `owner` `{keyHash, whoopUser?, name?}`, `whoop` (tokens), `vapid` (push keys), `cfg`, `subs` (at most 5), `sent`, `pair`, `pair:tries:<id>` | `worker.js:15-16` | Not part of the app's data. |

How sync treats the three settings: `settings` is taken whole from one side (`mergeCore`, `sync.js:132-144`),
and on a phone's first sign-in the account's `settings` replace the phone's (`sync.js:349-353`). So a second
phone signed in to the same account gets the same key and counts as the same owner. Import and Restore keep
this phone's link unless the owner says otherwise (`app.js:457`, `app.js:2058-2067`). Reset drops all three
(`app.js:2238`, `seedState`).

`normalize` does not check `connUrl`, `connKey` or `reminders` (`app.js:224-229` only cleans the listed
settings; `app.js:271` keeps unknown keys). They survive load and save untouched.

### 1.3 The protocol (app → worker)

Every app call goes through `api()` (`connector.js:35-41`): `fetch(connUrl + path)` with
`Authorization: Bearer <connKey>` and JSON bodies. A non-2xx answer becomes an error carrying `status`,
`code` (the answer's `error`) and `data`. CORS allows any origin (`worker.js:27`). The key is never put in
an address.

No key needed:

| Endpoint | Sent by the app | Worker | Answer |
| --- | --- | --- | --- |
| `OPTIONS *` | browser preflight | `worker.js:314` | 204 |
| `GET /` | not used by the app (the deploy workflow's health check, `deploy-connector.yml:105-108`) | `worker.js:315` | `{ ok, app: 'overload-connector', whoopReady }` |
| `GET /whoop/login` | opened in a browser sheet, `connector.js:163` | `worker.js:124-136` | 302 to WHOOP, sets cookie `ows` (10 min) |
| `GET /whoop/callback` | WHOOP redirects the browser there | `worker.js:142-166` | A page with a 6-digit code. Stores `pair` (code hash, WHOOP tokens, WHOOP user) for 10 min |
| `GET /push/key` | plain `fetch`, no key, `connector.js:250` | `worker.js:318` | `{ key }`: the connector's push (VAPID) public key |
| `POST /claim` | `{ key }` (and the header), `connector.js:81`, when `/status` answered 401 | `worker.js:321-332` | `{ ok }` if this key already owns it, or no owner and no WHOOP secrets (first key wins). 403 `paired` (another key owns it), 403 `whoop-first` (WHOOP secrets set: pair through the WHOOP login), 400 `bad key` |
| `POST /pair` | `{ code }` + the header, `connector.js:177` | `worker.js:335-364` | `{ ok, name }`: this key becomes the owner, the WHOOP tokens are stored. 403 `bad-code` with `left`, 410 `no-login`, 429 `busy`, 403 `paired` |

Key needed (`worker.js:366`: 401 `{ error: 'unauthorized' }` unless the SHA-256 of the key equals `owner.keyHash`, `worker.js:46-51`):

| Endpoint | Sent by the app | Worker | Answer |
| --- | --- | --- | --- |
| `GET /status` | `connector.js:78, 82` | `worker.js:368-371` | `{ whoop: {connected:true, name, since} or {connected:false, ready}, subs: <count>, cfg }` (`cfg` is the stored one or the defaults, `worker.js:228`) |
| `GET /whoop/sleep?days=N` | `connector.js:142`; N is 30 on the first sync, 3 later, 7 for "Sync now" (`connector.js:141, 361`) | `worker.js:372`, `94-122` | `{ nights: [{ id, start, end, tz, total, light, deep, rem, awake, inBed, performance, recovery, rhr, hrv }] }`, minutes, newest first, naps left out |
| `POST /whoop/disconnect` | `connector.js:205` | `worker.js:373-377` | `{ ok }`; deletes `whoop` |
| `POST /push/subscribe` | `{ subscription: sub.toJSON(), key: <push public key> }`, `connector.js:230, 256` | `worker.js:378-390` | `{ ok, subs }`. 400 unless the endpoint is Apple, Google, Mozilla or Microsoft push (`worker.js:294-301`). 409 `push key changed` |
| `POST /push/unsubscribe` | `{ endpoint }`, `connector.js:271` | `worker.js:391-395` | `{ ok }` |
| `POST /push/test` | `connector.js:276` | `worker.js:396-399` | `{ ok, sent }` |
| `PUT /config` | `{ tz, reminders, training, done }`, `connector.js:294` | `worker.js:400-406` | `{ ok }` |

`PUT /config` in detail, because the split depends on it. The app's body is built by `configNow()`
(`connector.js:281-287`):

```js
{ tz: 'America/Los_Angeles',                       // the phone's time zone
  reminders: settings.reminders,                   // { checkin, workout, food: { on, time } } as saved
  training: ['Chest & Back', 'Legs', …, null],     // 7 names Mon..Sun; null = rest day or a day with no exercises
  done: { checkin: '2026-11-21' | null, workout: … | null, food: … | null } }   // today's date when done
```

The worker stores it as `cfg` and **replaces `reminders`, `training` and `done` whole** with what was sent
(`worker.js:402`); nothing is merged per reminder. It does not check the contents.

When the app sends it:

- on every save: `app.js:340` fires `overload:save`, `connector.js:385` calls `pushConfig()`, which waits
  1.5 s and sends only when the config differs from the last one sent (`connector.js:289-297`);
- at each status check, when the connector's `tz`, `reminders` or `training` differ from the phone's
  (`connector.js:91-94`). `done` is not part of that comparison;
- right after reminders are turned on (`connector.js:263`).

A failed send is retried only at the next save (`connector.js:294`). Data arriving from cloud sync
(`setState`, `app.js:478-488`) fires no `overload:save`, so something done on another phone is not reported
until this phone saves something itself.

### 1.4 Pairing and the key

1. `discover()` reads `./connector.json` (`connector.js:66-73`) and saves an `https://` address as
   `settings.connUrl`. Or the owner types the address in Settings (`connector.js:305, 373-375`).
2. `refreshStatus()` calls `/status` (`connector.js:74-97`). `key()` creates `settings.connKey` on that
   first call. A 401 leads to `POST /claim`:
   - no owner, WHOOP not set up on the connector: this key becomes the owner (reminders only);
   - WHOOP set up: 403 `whoop-first`; the card says Connect WHOOP;
   - another key owns it: 403 `paired`.
3. Connect WHOOP (`connector.js:158-166`) opens `/whoop/login`. After the WHOOP login the last page shows
   a 6-digit code. The app sends it with its key (`POST /pair`, `connector.js:168-202`). 5 wrong codes or
   10 minutes end that login (`worker.js:26, 342-355`).
4. A new key that pairs replaces the owner, and the old key's push subscriptions are deleted
   (`setOwner`, `worker.js:304-307`). The app sends its own subscription again at every start
   (`resendSub`, `connector.js:223-238`, called at `connector.js:95`).

The worker keeps only a hash of the key. The key itself lives in `settings.connKey`: in the saved state, in
every export file and in the cloud copy.

### 1.5 Reminders: the path of one notification

1. Turn on reminders (`enablePushOnce`, `connector.js:245-267`): ask permission, subscribe on **this page's
   service worker registration** (`navigator.serviceWorker.ready`) with the connector's push key, send the
   subscription (`/push/subscribe`), save the default `reminders`, send the config. iPhone: Home Screen app
   only (`connector.js:213, 332`).
2. Every 5 minutes the worker runs `runReminders` (`worker.js:256-291`). For `checkin`, `workout`, `food`
   in that order (`worker.js:269`) a reminder is sent when all of these hold:
   - there is at least one subscription (`worker.js:258`);
   - it is on (`worker.js:271`);
   - the local time (in `cfg.tz`) is at or up to 3 hours after its time, rounded down to 5 minutes
     (`worker.js:272-274`);
   - it was not already sent today (`sent[kind]`, `worker.js:275`);
   - **`cfg.done[kind]` is not today's date** (`worker.js:276`);
   - for `workout`: today is a training day, `cfg.training[weekday]` is set (`worker.js:277`).
3. The message (`worker.js:238-255`) is `{ title, body, tag, url }` with `url` = `APP_URL`
   (`wrangler.toml:8`, the training app's address). It goes to **every** stored subscription
   (`sendPush`, `worker.js:207-221`).
4. `sw.js:110-116` shows it; a tap focuses an open window whose address starts with the worker's scope, or
   opens `url` (`sw.js:117-123`).

### 1.6 How each reminder decides it is "done"

All three are worked out in the app, in `configNow()` (`connector.js:281-287`), with `today = todayKey()`
(the phone's local date, `app.js:136-140`), and sent as today's date or `null`.

| Reminder | "Done" when | State fields | Lines |
| --- | --- | --- | --- |
| Morning check-in | `window.__overload.checkinDone()` is true: the check-in is not open for editing, **and** no weigh-in is due, **and** (sleep is off **or** there is a night dated today) | `settings.weighEvery`, `bodyweight[].date` (latest), `settings.sleepOn`, `sleep[].date`; plus `ui.checkinEdit` (memory only) | `connector.js:286`; `checkinDone` `app.js:835-838`; `weighDue` `app.js:830-834`; exported at `app.js:2424` |
| Workout | a workout has `finishedAt` set and `date === today` (`date` is the day it was **started**, `app.js:1744`; `finishedAt` set at `app.js:1881`; a deload counts) | `workouts[].finishedAt`, `workouts[].date` | `connector.js:284, 286` |
| Food log | `state.diary[today]` exists and has at least one entry | `diary[<today>]` | `connector.js:285, 286` |

Side effects worth knowing: a WHOOP night merged for today can complete the check-in with nobody tapping
anything (when no weigh-in is due); with weigh-ins and sleep both off the check-in is always "done"; and the
workout reminder also needs a training day (`training`, `connector.js:283`: `program.schedule` mapped to day
names, Monday first, the same order as the worker's weekday, `app.js:147`, `worker.js:234`).

### 1.7 What `connector.js` needs from the rest of the app

Anyone reshaping `app.js`, `index.html`, `sw.js` or the styles must keep these, or change `connector.js` with them.

- `window.__overload` must exist before `connector.js` runs (`connector.js:16`), with:
  `lib.esc`, `lib.todayKey`, `lib.toast` (`connector.js:17`; `lib` is the object `app.js:2425-2426` labels
  "Shared with food.js"), `state` (getter), `save()`, `render()`, `screen` (getter), `checkinDone`.
- State it reads: `settings.connUrl`, `settings.connKey`, `settings.reminders`, `sleep`, `deleted.sleep`
  (`connector.js:119`), `active`, `program.schedule`, `program.days[].{id,name,exercises}`,
  `workouts[].{finishedAt,date}`, and `diary` (only at `connector.js:285`). It writes `settings.connUrl`,
  `settings.connKey`, `settings.reminders` and `sleep`.
- The `overload:save` event on `document` (`app.js:340` → `connector.js:385`).
- Routing in `app.js`: Settings calls `settingsCard()` (`app.js:1499`); clicks on `data-action="conn-…"`
  go to `click()` (`app.js:2084`); `change` on `data-field="conn-…"` goes to `change()` (`app.js:2319`).
  Actions: `conn-whoop-connect`, `conn-pair`, `conn-pair-cancel`, `conn-whoop-sync`, `conn-whoop-disconnect`,
  `conn-refresh`, `conn-push-on`, `conn-push-off`, `conn-push-test`, `conn-rem`. Fields: `conn-url`,
  `conn-code`, `conn-time`.
- Screen names `'settings'`, `'today'`, `'history'` (`connector.js:49, 58, 60`) and the check-in form's id
  `#bw-form` (`connector.js:59`, the form at `app.js:874`): used to avoid redrawing over something typed.
- Its own ids: `conn-cards`, `conn-code`. Classes it uses: `group-title card small muted tiny field input row
  between btn block ghost subtle btn-row pill green toggle-row seg on mt8 mb8`, plus four inline styles
  (`connector.js:311, 338-340`).
- `sw.js:109-124` (the `push` and `notificationclick` handlers) and the service worker registered for the
  app's own page (`app.js:2406`).

`connector.js` does not use `window.__overloadFood` or anything from `food.js`.

## 2. After the split: the food-log reminder

### 2.1 What happens if nothing is changed

The training app keeps the old food copy (`state.diary`) but stops adding to it. `connector.js:285` keeps
reading it:

- From the day after the update `diary[today]` never exists, so `done.food` is `null` every day. On the day
  of the update itself it is "done" only if food was logged in v2.8 earlier that day.
- Food reminder **off** (the default, `connector.js:19`; also the worker's default, `worker.js:228`): nothing
  is sent. But the row is still offered in Settings and can be turned on.
- Food reminder **on**: the worker sends "Log today's food" every evening at the set time, whatever was
  logged in the diet app. The tap opens the training app, which has no food log. The Settings row keeps
  saying "Evening nudge. Skipped if you logged food today", which is no longer true.
- Removing the old food copy later changes nothing here (`connector.js:285` copes with an empty `diary`).

Checked **(run)**: v2.8 `connector.js`, food reminder on, entries only on a past day → the app sent
`reminders.food = { on: true, time: '20:30' }`, `done.food = null`; the real `worker.js`, given that body,
sent `food` at 20:35 that day, the next day and the day after, and not twice on one day.

This only bites when a connector is paired. Today none is (section 0).

### 2.2 The smallest change (training app only)

In `connector.js`, three code lines:

```js
// connector.js:20  drop the Food row; the card draws one row per key of LABELS (connector.js:338)
const LABELS = { checkin: ['Morning check-in', 'Weight and sleep. Skipped once logged'], workout: ['Workout', 'Training days only. Skipped once finished'] };

// connector.js:285  replace the foodDone line
const r = reminders();

// connector.js:286  send the food reminder as off, and say nothing about food being done
return { tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  reminders: { checkin: r.checkin, workout: r.workout, food: { on: false, time: (r.food && r.food.time) || '20:30' } },
  training: names,
  done: { checkin: O.checkinDone && O.checkinDone() ? today : null, workout: workoutDone ? today : null } };
```

Leave as they are, on purpose:

- `DEFAULT_REMINDERS` (`connector.js:19`) keeps its `food: { on: false, time: '20:30' }`, so a `reminders`
  object first saved by the new version has the shape v2.8 expects.
- The saved `settings.reminders.food` is never changed or removed. The new version only overrides what it
  **sends**. `configNow()` is the single place both senders use (`connector.js:92, 292`), so the status
  comparison at `connector.js:93` stays consistent.

Also update the words: the comment at `connector.js:9`, and `README.md:257-258` ("morning check-in, workout,
food log").

Result **(run, with the change applied to an in-memory copy of `connector.js`)**:

- Settings → Reminders shows two rows, Morning check-in and Workout. Turning one off still saves and
  sends the config (the time boxes use the same untouched code, `connector.js:371`; not clicked in the run).
- The first start after the update sends `PUT /config` once with `reminders.food.on = false` and
  `done = { checkin, workout }` (the status check sees the difference, `connector.js:91-94`). A second
  status check sends nothing more, so there is no resend loop.
- The saved state still holds `settings.reminders.food` exactly as before (`{ on: true, time: '20:30' }` in
  the test).
- A state with no `reminders.food` at all, or no `reminders` yet, also works.
- With no connector address: no calls, nothing saved, same cards as v2.8.

Optional hardening, not needed for the split: make `reminders()` (`connector.js:30-34`) fill in a missing
`checkin`, `workout` or `food` from the defaults. Today a `reminders` object that lacks a kind (from a
hand-edited backup or cloud copy) makes Settings fail to draw when reminders are on.

### 2.3 Does the worker have to change? No.

| App | Worker | Result |
| --- | --- | --- |
| new (3.0) | today's `worker.js`, deployed later from the unchanged folder | Works **(run)**: `food` is skipped at `worker.js:271` because it is off; check-in and workout are sent as before. Leaving the `food` key out of `reminders` instead of sending it off also works **(run)**; off is the clearer of the two. |
| new (3.0) | a worker that never received a config | Works: the worker's defaults have food off (`worker.js:228`). |
| new (3.0) | a worker still holding a v2.8 config with food on | Fixed at the first start with signal (status check), or at the first save. |
| v2.8 after a roll-back | any | Works as before the update: v2.8 sends the saved `settings.reminders` again, food on if it was on. Needs `reminders.food` still in the saved state (hazard 2). |

Nothing in `worker.js` must change. Recommended: **do not edit anything under `connector/` or the workflow
file in this release.** Any push to `main` that touches them starts the Deploy connector workflow
(`deploy-connector.yml:10-13`). Without the Cloudflare secrets it stops with a notice
(`deploy-connector.yml:41-44`); with them it deploys, commits `connector.json` to `main` and asks for a Pages
build (`deploy-connector.yml:119-146`). The food code left in the worker (`worker.js:6, 228, 241, 254, 269`)
is harmless and can be tidied the next time the worker is deployed for another reason.

## 3. Could the diet app have its own food-log reminder later?

Yes, but not with this worker as it is, and not without a deploy. A push subscription belongs to one
service worker registration, so the diet app would subscribe through its own worker (`fuel/sw.js`), which
needs its own `push` and `notificationclick` handlers, and on an iPhone it must be installed on the Home
Screen and ask for permission itself. The connector today is built for one app: one owner key (a second key
that pairs takes the connector over and wipes the first app's subscriptions, `worker.js:304-307, 360`), one
`cfg` that each `PUT /config` replaces whole (`worker.js:402`, so the two apps would wipe each other's times
and "done" marks), one subscription list that every reminder is sent to (`worker.js:207-221`), and one
address a tap opens (`APP_URL`, `wrangler.toml:8`). A diet reminder therefore needs worker changes: a way for
a second app to prove itself (a second key, or the same key carried across on purpose), config and "done"
kept per app or merged per reminder, subscriptions marked with their app so the food reminder goes only to
the diet app and opens its address, and the diet app sending "food logged today" from its own diary on each
save. It also needs the owner to set up Cloudflare, which has not happened. Until then the diet app can only
remind in the app itself, when it is opened.

## 4. Other coupling to food, and text that names it

Code:

- `connector.js:285` is the only place these files read food data.
- `connector.js:17` takes `esc`, `todayKey`, `toast` from `window.__overload.lib`, the object `app.js:2425-2426`
  calls "Shared with food.js". It must stay when `food.js` leaves the training app.
- `app.js:1499-1500`: the connector's cards sit right above the Food targets card in Settings. Removing line
  1500 does not affect line 1499.
- `app.js:2083-2084` and `app.js:2318-2319`: the `food-` and `conn-` prefixes are routed side by side and are
  independent.
- `index.html:132-133` and `sw.js:11-12` list `food.js` then `connector.js`.
- `worker.js`: the `food` kind in the defaults (`:228`), the loop (`:269`), the WHOOP lookup skipped for it
  (`:241`), its message (`:254`), and `sent.food` in KV.

Words the owner can see:

- `connector.js:20`: "Food log" / "Evening nudge. Skipped if you logged food today" (removed by 2.2).
- `worker.js:254`: notification "Log today's food" / "Add what you ate so today's calories and protein are
  right." Never sent once the app sends food as off.
- `README.md:257-258`: "sends push reminders (morning check-in, workout, food log)".

Words only in comments: `connector.js:9`, `worker.js:5-6`.

Nothing in `connector.js`, `worker.js`, `wrangler.toml` or `deploy-connector.yml` names "the Food tab".
The worker's pages and the deploy summary name "Overload → Settings → WHOOP" (`worker.js:145, 156, 163, 317`,
`deploy-connector.yml:115`), and `connector.js` has "Allow them for Overload in Settings" (`:247`) and "open
Overload from that icon" (`:332`). Keep the app name, the Settings tab and the "WHOOP" card title, or these
go stale (the worker's own text cannot change without a deploy).

## 5. Hazards and precautions

1. **Food reminder left as it is.** With a paired connector and the food reminder on, it fires every evening
   and the Settings row lies. *Precaution:* the change in 2.2.
2. **Removing or reshaping `settings.reminders.food` in the saved state.** After a roll-back, v2.8 draws one
   row per kind and reads `r.food.time` (`connector.js:339`); v2.8 fills defaults only when the whole
   `reminders` object is missing (`connector.js:30-34`). **(run)**: with reminders on and no `food` key,
   Settings shows "This screen could not be shown … Cannot read properties of undefined (reading 'time')".
   *Precaution:* never delete, rename or rewrite `settings.reminders`, `connUrl` or `connKey` in any
   migration or clean-up; override only what is sent.
3. **Trimming `window.__overload`.** Without `lib` (or `esc`/`todayKey`/`toast` in it) `connector.js` throws
   at line 17 while loading; `app.js:1499` then quietly shows no WHOOP and no Reminders card and WHOOP sync
   stops. Without `checkinDone` the app reports the check-in as never done (`connector.js:286`) and the
   morning reminder fires every day. *Precaution:* keep `lib.{esc,todayKey,toast}`, `state`, `save`,
   `render`, `screen`, `checkinDone`; add "`window.__overloadConn` exists and Settings shows the WHOOP card"
   to the smoke test.
4. **`overload:save`.** It is the only trigger that tells the connector something is done. *Precaution:*
   `save()` keeps firing it under that name in the training app.
5. **Service worker.** Reminders need `sw.js:109-124` and the same registration (the subscription belongs to
   it). *Precaution:* keep both handlers in the root worker when it is rewritten for the split. Also
   `sw.js:121` takes any open window whose address starts with the root scope; a diet-app window under
   `/overload/fuel/` matches that too, so in a browser where both are open a tap on a training reminder
   could bring the diet app forward (by the Service Worker rules; not run here). *Precaution:* skip windows
   under `scope + 'fuel/'`.
6. **The diet app must never get the connector link.** `settings.connKey` and `connUrl` are in the saved
   state, every full backup and the cloud's `meta/state`. If the diet app carried them and ran
   `connector.js`, its `PUT /config` would replace the training app's training days and "done" marks
   (`worker.js:402`); if it paired with a new key it would take the connector over and wipe the training
   app's subscriptions (`worker.js:304-307`). *Precaution:* the diet app does not load `connector.js`; the
   transfer text, the food file, the full-backup reader, the same-device reader and the cloud bootstrap take
   named food fields only, never `settings` whole.
7. **Touching `connector/` or the workflow.** Starts a deploy run on `main` (section 2.3). *Precaution:*
   leave them unchanged in this release.
8. **Redesign.** `connector.js` builds its own HTML (classes and inline styles in 1.7) and relies on
   `#bw-form` and the screen names. If `#bw-form` is renamed, a WHOOP night that arrives while a check-in is
   half typed redraws Today over it (`connector.js:57-61`). *Precaution:* restyle those classes, keep the id
   and the screen names or change `connector.js:49, 58-60` in the same commit, and look at the WHOOP and
   Reminders cards in every state (no address, checking, connect, code box, connected, expired; reminders
   off, rows) in both themes.
9. **The key is a secret in exports and in the cloud copy** (as today). *Precaution:* nothing new should
   print or copy it; the food transfer must not include it (see 6).
10. **Rescue start** (`index.html:29-85`): if `app.js` of the new release cannot load, the previous release's
    scripts run, v2.8 `connector.js` included, and send the old-style config for that session. The next
    normal start corrects it. No precaution needed beyond 2.

## 6. Open questions

1. Does the owner's real saved state hold `settings.connUrl`, `connKey` or `reminders` (an address typed by
   hand)? The workflow never published an address, so probably not, but the code cannot say.
2. Are the Cloudflare or WHOOP secrets set in the GitHub repository? If they are, any change under
   `connector/` deploys a worker on push to `main`.
3. On an iPhone, are two Home Screen apps from the same site fully separate for service workers, push
   permission and open windows? It decides whether hazard 5's wrong-window case can happen there and how a
   diet-app reminder would behave. Not answerable from the code.
4. Does the owner want a food reminder in the diet app at all? If yes, it is a separate piece of work
   (section 3) with a worker deploy.
5. Should the WHOOP and Reminders cards still show in Settings while no connector is set up? Today they
   show a setup hint and a "Connector address" box (`connector.js:303-306, 331`). A design decision.

## 7. How this was checked

Run on this machine only; nothing left the machine (requests to any host but `127.0.0.1` were aborted; the
only ones attempted were the Firebase SDK files from `www.gstatic.com`).

- **App side:** the real v2.8 files served locally, Chromium through Playwright, service workers blocked,
  time zone America/Los_Angeles. The connector was faked inside the page (a `fetch` wrapper answering
  `/status` and `/config` for a made-up address). For the proposed version, the three lines of 2.2 were
  applied to a copy of `connector.js` in memory and served in place of the file. Nine starts: no address
  (v2.8 and proposed); food reminder on with a frozen diary (v2.8 and proposed); food logged today (v2.8 and
  proposed); `reminders` without a `food` key (v2.8 and proposed); no `reminders` saved (proposed).
- **Worker side:** the real `connector/worker.js` imported in Node 22 with an in-memory KV and a stand-in
  push service, driven through its own `fetch` handler (`/claim`, `/push/key`, `/push/subscribe`,
  `/config`, `/status`) and `_test.runReminders` at chosen local times, using the exact bodies the app
  sent in the runs above.

The script was a throw-away and is not in the repo. Worth adding to `tests/` when the change is made: the
`PUT /config` body has `reminders.food.on === false` and no `done.food`; Settings shows two reminder rows;
the saved `settings.reminders` is byte-for-byte what it was; `worker.js` given that body sends `checkin` and
`workout` and never `food`.
