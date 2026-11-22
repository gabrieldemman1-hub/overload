# Cloud sync (v2.8), and what the split needs from it

Read in full: `sync.js` (472 lines), and in `app.js` everything that touches sync (`SYNC_KEY`, `syncOn`, `setState`, the Cloud sync card, `cloudAction`, `leaveUnreadable`, `forgetCloudIfSignedOut`, `cloudNote`, Import, Reset, the `window.__overload` object), plus `index.html`, `sw.js`, `backup.js`, `firestore.rules`, and the parts of `food.js` that write the food log.

How claims were checked:

- **(run)** means: v2.8 was run in Chromium (Playwright, served from this repo on 127.0.0.1) against a **fake Firebase** that I wrote. The three SDK files that `sync.js` imports from `www.gstatic.com` were answered locally with small stand-ins; no outside host was contacted. The fake is in Appendix B. It models server reads, batches, and listeners (cached view first, then the server's differences); it is not the real SDK.
- **(SDK)** means: the claim rests on how the real Firebase SDK behaves, from its documentation. I could not run the real SDK here.
- Everything else is from reading the code.

Nothing in the repo was changed. The only file written is this note.

Short names used below: **T** = the training app (Overload), **F** = the diet app (Fuel), **old food copy** = `state.food`, `state.diary` and `state.deleted.food` that T keeps carrying.

This note was written before 3.0 was built; line numbers are v2.8's. Paragraphs marked **In 3.0** (1.1, 1.4, 1.5, 1.9, 1.10) and the notes in section 7 describe T's `sync.js` and `overload.js` (the main script, `app.js` up to 2.8) as released, after the review findings S1, S2, S4, S5 and S6. Where they and the rest differ about 3.0, they and the code are right.

Paragraphs marked **In Fuel 3.0** (4.3, 4.4, after the host interface in section 5, and two notes in section 7) do the same for F's `fuel/sync.js` and `fuel/fuel.js`.

---

## 1. The protocol as it is in v2.8

### 1.1 Where things are

Firebase project `overload-6b7e8` (`sync.js:23-30`), SDK 10.14.1 loaded from `www.gstatic.com` (`sync.js:14-21`), Firebase app created with the **default name** (`sync.js:36`), Auth with email and password (`sync.js:37`), Firestore with the persistent (IndexedDB) cache (`sync.js:38`).

Three places in Firestore, all under `users/{uid}`. Shapes checked **(run)**:

| Path | Document | Built at |
| --- | --- | --- |
| `users/{uid}/meta/state` | `{ core: <text>, updatedAt: <ms>, v: 1 }`. `core` is one JSON text of an object with exactly `CORE_KEYS`, in that order | `sync.js:202` |
| `users/{uid}/workouts/{workoutId}` | `{ data: <text>, updatedAt: <ms>, v: 1 }`. `data` is the JSON of one workout | `sync.js:207` |
| `users/{uid}/foodDays/{YYYY-MM-DD}` | `{ data: <text>, updatedAt: <ms>, v: 1 }`. `data` is the JSON of that day's entry array (`state.diary[date]`) | `sync.js:216` |

- `CORE_KEYS` (`sync.js:33`): `settings, exercises, presc, program, active, bodyweight, sleep, templates, food, deleted`. So the core holds the **food targets, saved foods and saved meals** (`food`) and **all four kinds of deletion records** (`deleted.food`, `.bw`, `.sleep`, `.workouts`).
- Not uploaded: `v`, `libVersion`, and any other top-level field of the state.
- The comment at `sync.js:7-9` leaves out the `v: 1` field. Nothing ever reads `updatedAt` or `v` back: listeners read only `core` and `data`. A new field in a document is ignored by v2.8.
- The core is one text. A write replaces the whole core. For the heavy test fixture the core is 59,400 characters, 22,551 of them the food part **(run)**. Every logged food changes `food.foods[id].used` and `.last` (`food.js:632-633`), so every logged food re-sends the whole core as well as the day.

On the phone, one localStorage key: `overload.sync.v1` (`SYNC_KEY`, `sync.js:32`, `app.js:12`). It is the note of **what the cloud is known to hold** (`known`, `sync.js:42`):

```
{ uid, core: hash | null, workouts: { workoutId: hash }, days: { 'YYYY-MM-DD': hash } }
```

- Hashes only, never data (`hash()`, `sync.js:57-66`: `'h' + two base-36 numbers + '.' + length`). Older versions stored full JSON; `loadKnown()` turns those into hashes and adds `days: {}` when missing (`sync.js:69-80`). `loadKnown()` returns nothing unless the object has `workouts` (`sync.js:72`).
- `saveKnown()` (`sync.js:84-88`) does **not** write while the app cannot save its own data (`host().saveFailed`). Reason in the comment at `sync.js:81-83`: a stale note is safe (the next start takes the cloud's copies back), a too-new note is not.
- sync.js itself never removes the key. Only app.js does: when the saved data is unreadable (`app.js:199`), and on Reset, Import or Restore **while signed out** (`forgetCloudIfSignedOut`, `app.js:2041-2044`, called at `app.js:459` and `app.js:2238`). Checked for Reset **(run)**.
- v2.8 keeps a field it does not know in this object across a restart and a push **(run)**.

**In 3.0** (after the review, S1 and S2) the note has one more field, `parts`, written by 3.0's `sync.js` (`partsOf`) from the same core text that `core` is the hash of:

```
{ uid, core: hash | null, workouts: { workoutId: hash }, days: { 'YYYY-MM-DD': hash },
  parts: { core: hash, keys: { settings, exercises, presc, program, active, bodyweight, sleep, templates: hash },
           food: hash, del: { bw: { date: ms }, sleep: { date: ms }, workouts: { id: ms } } } }
```

- `parts.core` names the core the parts belong to. They are used only while it equals `known.core` (`notedParts`); v2.8 keeps the field as it is, so once v2.8 sends or takes a core the parts name an older one and 3.0 ignores them (until it next sends or takes a core, or works them out from the noted core in hand).
- `keys` holds one hash per training key, `food` one hash of the food part (`food` and `deleted.food`), and `del` the training deletion records themselves (a few small entries, not hashes). The note is no longer hashes only: about 350 characters more on the small fixture, 520 on the heavy one.
- With the parts a phone can tell, also after a restart and without the offline cache, which keys it changed itself since that core (1.4, 1.5).
- 3.0's `overload.js` also removes the note at start when `overload.state.v1` is missing or empty (S2): a note cannot belong to no data, and the next sign-in is then a first link, which deletes nothing. `forgetSyncedDays` (Remove the old food log) parses and writes the whole object, `parts` included.

Other module state (`sync.js:40-50`, `106`), all in memory only: `user`, `unsubs`, `pushTimer`, `inflight`, `lastSync`, `lastError`, `linking`, `linkTimer`, `linkTries`, and **`baseCore`**: the core as the cloud last held it, used to tell which key this phone changed. `baseCore` is empty after every restart until a core is pushed or received.

### 1.2 What starts it

- `index.html:134` loads `sync.js` as a module, after `app.js`. It reaches the app only through `window.__overload` (`host()`, `sync.js:40`).
- `onAuthStateChanged` (`sync.js:462-468`): signed in → `link()`; signed out → listeners off, `known = null`, status "off". Then `host().syncChanged()`.
- `document` event `overload:save` (sent by `save()`, `app.js:340`) → `schedulePush()` (`sync.js:470`): one push 1 second after the last save (`sync.js:188-192`). It does nothing without a user or without `known`.
- `online` → status, and either restart the first link (`user && !known && !linking`) or schedule a push; `offline` → status (`sync.js:471-472`).

### 1.3 `link()`: a phone meets an account (`sync.js:320-422`)

1. Nothing happens while the app's data is unreadable (`sync.js:323`).
2. **Known phone** (`sync.js:324-331`): the stored note names this account (`stored.uid === user.uid`) → `known = stored`, `listen()`, `schedulePush()`. No server read. Changes made while signed out or offline go up as a normal push, **including deletes**.
3. **First link** (no note, or a note for another account). Nothing is uploaded and no listener runs until one read from the server has worked:
   - Reads **from the server, not the cache**: `meta/state`, all `workouts`, all `foodDays` (`getDocFromServer`, `getDocsFromServer`, `sync.js:342`).
   - Starts from a deep copy of the local state (`sync.js:346`).
   - If the account has a core (`sync.js:348-378`): every core key of the cloud **replaces** the phone's (`Object.assign(next, cloud)`, `sync.js:353`). Then the lists are put back together:
     - deletion records: union, the later time wins (`mergeDeleted`, `sync.js:354`);
     - weigh-ins and nights: union by date, the cloud's wins for a date both have, minus deleted ones (`sync.js:355-356`);
     - saved foods: union by id, the cloud's wins (`sync.js:358`). **Targets and saved meals are simply the cloud's**: a meal saved only on this phone is lost and the phone's targets are replaced even by empty ones **(run)**;
     - exercises are matched to the account's by name, workouts and templates are re-pointed (`sync.js:360-377`); the phone's finished workouts are kept (only if it has history, else only the one in progress).
   - Cloud workouts are laid over by id, the cloud's wins (`sync.js:379-387`).
   - Food days (`sync.js:388-397`): starts from the phone's diary; each cloud day is merged entry by entry with `mergeDay(cloudEntries, localEntries, deleted.food)`: **the cloud's copy wins for an id both have, entries only on the phone are kept**, deleted ids are dropped **(run)**. Days only on the phone stay.
   - `applyDeleted(next)` (`sync.js:399`).
   - **Safety copy**: when the account had a core, `host().safetyCopy('cloud')` is called before the phone's data is replaced (`sync.js:401`). It is stored by backup.js as `before-cloud` (only the latest one is kept) **(run)**. The text is taken at once, the write is not waited for.
   - `known = fresh` (the hashes of exactly what was read), `setState(next)`, `saveKnown()`, then `listen()` and `push()`. The push uploads whatever the merge holds and the cloud did not: on an empty account, everything.
   - Read failed (`sync.js:407-414`): `known` stays empty, message "… Nothing was uploaded; retrying.", retry after 15 s, doubling to at most 300 s; `online` and the Sync now button (`pushNow`, `sync.js:455-459`) retry at once.

### 1.4 `push()`: local state against the note (`sync.js:194-234`)

Does nothing without a user, without `known`, or while the data is unreadable (`sync.js:195`). It never reads the cloud. It compares the state with `known` and writes the differences:

| What | Compared | Written | Deleted in the cloud |
| --- | --- | --- | --- |
| Core | `hash(coreJson(state))` against `known.core` | `set meta/state` with the whole core (`sync.js:202`) | never |
| Each workout | hash of its JSON against `known.workouts[id]` | `set workouts/{id}` (`sync.js:207`) | **every id in `known.workouts` that is no longer in the state** (`sync.js:209-211`) |
| Each food day | hash of the day's JSON against `known.days[date]` | `set foodDays/{date}` (`sync.js:216`) | **every date in `known.days` that is no longer in `state.diary`** (`sync.js:218-220`) |

- The note is updated and saved **before** the writes are sent (`sync.js:221`).
- Writes go in batches of 400 (`BATCH_LIMIT`, `sync.js:34`, `227-233`). The batches are not waited for one after the other.
- A rejected batch: `lastError`, the whole note is put back to what it was before this push (`rollback`, `sync.js:226`), and a new push is scheduled after 60 s.
- Offline, `commit()` does not answer; the SDK keeps the write on disk and sends it later, also after a restart **(SDK)**. The status then reads "Offline, will sync later".
- So "deleted in the cloud" follows from **absence**: anything the note lists and the state no longer has is deleted. Reset, Import and Restore while signed in therefore replace the cloud copy; that is why they warn (`cloudNote`, `app.js:2046-2049`). Checked **(run)**: Reset while signed in deleted all 3 workouts and all 4 food days and wrote a core with empty food.

**In 3.0** (Appendix A, then the fixes S1 and S5) the core row reads differently; workouts are as above, and no food day is ever written or deleted:

- The core goes only when the cloud's core has been seen in this session (`cloudFood !== undefined`), its hash differs from `known.core`, **and** this phone is ahead (`coreAhead`): with the note's parts, a training key differs from its noted hash, or the food part as sent from here differs from the noted one, or a deletion record younger than 90 days differs. Records past their 90 days (the app drops them at every start) and this phone's old food copy do not count. Without parts (a note written by v2.8) the whole core text is compared, as in v2.8.
- The first core of a session waits until the server's own core has been taken in (`serverSeen`): a listener snapshot that is not from the offline cache, or one `getDocFromServer` (`readServerCore`). That read only confirms: it is taken when it is the noted core or the account has none, and otherwise the listener brings the newer core and merges it. With no signal the read fails and is asked again when the signal returns, at the next save, and after 15 s doubling to 300 s. A change made offline therefore stays in localStorage and goes up merged once the server's core is in; it is not queued in the SDK. Workouts are still sent or queued at once.
- While the core waits (`coreHeld`), the status reads "Syncing…" (signal) or "Offline, will sync later" instead of "Synced".
- After sending, `known.core`, `baseCore`, `cloudFood` and `known.parts` describe what was sent.
- A first link sets `serverSeen` (it read the server itself). Sign-out and every link forget it (`forgetServer`).

### 1.5 `listen()`: three live listeners (`sync.js:239-313`)

All three skip their own unsent writes (`hasPendingWrites`) and anything whose hash equals the note.

**Core, `meta/state`** (`sync.js:241-251`). A core that differs from `known.core`:

- `mergeCore(local, remote)` (`sync.js:132-144`):
  - `localAhead` = the phone's core differs from `known.core` (it has something not uploaded).
  - For each key: the phone's value stays only if `localAhead` **and** `baseCore` is known **and** this key differs from `baseCore`; otherwise the cloud's value is taken, **whole** (a missing key in the cloud keeps the phone's). After a restart `baseCore` is empty, so the cloud wins every key.
  - `deleted` is always the union (`mergeDeleted`, `sync.js:108-118`): four kinds only, the later time wins, ids sorted so two phones write the same text.
  - `bodyweight` and `sleep` are always unions by date (`unionByDate`, `sync.js:120-125`), the phone's entry winning when `localAhead`, else the cloud's; deleted dates are dropped.
- `applyDeleted` (`sync.js:146-153`): removes diary entries whose id is in `deleted.food` (and a day left empty), and workouts whose id is in `deleted.workouts` (except the one in progress).
- `known.core = hash(remote)`, `baseCore = remote`, `setState(next)`, `saveKnown()`, then `schedulePush()`: if the merge differs from what the cloud sent, the merged core goes back up.

**In 3.0** (Appendix A, then S1 and S5; `takeCore` and `mergeCore` in `sync.js`):

- A snapshot with this phone's own pending writes, or whose hash is `known.core`, only notes the cloud's food part (`cloudFood`); with a note from v2.8 and the noted core in hand, the parts are worked out then.
- `mergeCore` is per key. With the note's parts a key is "this phone's" when its hash differs from the noted one: that key stays, every other key is the cloud's (a key missing in the cloud keeps the phone's). This holds after a restart too, so `baseCore` matters only without parts (a note from v2.8, where the v2.8 rule above applies, with the remote's food part standing in until the cloud's is known). The key `food` is never merged; the phone's `deleted.food` is kept.
- Weigh-ins and nights: still unions by date minus deleted dates, but per list: this phone's entry wins a date both have only when it changed **that** list itself (with parts; without, when the core is ahead as in v2.8). So a phone whose old copy of a weigh-in differs no longer overwrites a correction another phone made (S5).
- `applyDeleted` removes workouts only (the old food copy is not filtered).
- The `foodDays` listener is gone.

What this means for Reset, Import and Restore on a phone signed in beside a second signed-in phone (run in `tests/train-cloud.js`): they write no deletion records, so the second phone has not changed the weigh-ins or nights lists itself and takes the replacing phone's entry for every date both have, but keeps its own entries for other dates, and its deletion records come back in the union. Its weigh-ins and nights for dates the new data lacks come back to the account and to the first phone, and after an Import or Restore a workout, weigh-in or night that its deletion records name (the last 90 days) is deleted again, although the file holds it. The questions say so (`cloudNote` in `overload.js`).

**Workouts** (`sync.js:253-281`). Removed in the cloud and known here → removed here. Added or changed → replaces the phone's copy (the cloud's wins); but a workout this phone deleted (in `deleted.workouts`, and not in progress) is not taken: its hash is noted and the next push deletes it again.

**Food days** (`sync.js:283-312`). For each changed day, `localAhead` = the phone's day differs from `known.days[date]`:

- **Removed in the cloud** (`sync.js:291-296`): ignored if the note does not list the day. Otherwise the phone's day is **deleted**, unless the phone is ahead: then its entries (minus deleted ids) stay and are pushed back.
- **Added or changed** (`sync.js:297-305`): `mergeDay` (`sync.js:127-131`) of the two copies; the cloud's entry wins for the same id unless the phone is ahead; **entries only one side has are always kept**; ids in the phone's own `deleted.food` are dropped; the result is sorted by `at`. If the result differs from the text the cloud sent, it is pushed back (`pushBack`, `sync.js:305`, `311`).

How entries merge by id, exactly (`mergeDay(first, second, gone)`): a map from `entry.id` is filled from `second`, then every entry of `first` is set on top; ids in `gone` are removed; the list is sorted by `at`. Entry ids come from `uid()` (`app.js:130`: 8 random characters and 4 of the clock) at `food.js:637`, `713`, `790`. The same entry arriving by two routes has the same id and stays one entry. **Entries without an id all collapse into one** (three entries in, one out, in a direct call of the function): v2.8 never writes such an entry, a hand-made file could.

Deletions therefore travel in two ways: a whole day by the document disappearing; a single entry by a record in `deleted.food` in the **core**. A phone that does not get the record puts the entry back (section 2). Records are dropped after 90 days on every load (`app.js:285-288`).

### 1.6 Sign-out (`sync.js:445-454`, `462-468`)

Timers cleared, listeners off, `known = null` in memory, then `signOut`. **The stored note is kept** on purpose (`sync.js:448-450`): signing back in to the same account takes the known-phone path and sends the changes made meanwhile **(run)**. That includes deletes. The note is dropped only by Reset, Import or Restore while signed out (`app.js:2041-2044`), which turns the next sign-in into a first link (download and merge, nothing deleted). Signing in to a **different** account is a first link too: the phone's data is merged into that account.

### 1.7 Errors and status

- Sign-in, create account, password reset: Firebase error codes become sentences (`friendly`, `sync.js:165-183`) and are thrown to `cloudAction` (`app.js:1530-1542`), which shows them in the card.
- First link: see 1.3. Push: see 1.4.
- A listener error sets `lastError` (`sync.js:251`, `281`, `312`). The listener is then dead; nothing restarts it before the next `link()` (restart or sign-in).
- A cloud document that is not text, not JSON, or (for a day) not an array is skipped silently (`sync.js:244-245`, `266-267`, `299-301`, `380-381`, `391-393`). Cloud text is parsed without `__proto__`, `constructor`, `prototype` keys (`parse`, `sync.js:90`).
- Status (`report`, `sync.js:155-163`) → `host().setSyncStatus(status, msg)`: `off`, `error`, `syncing`, `offline`, `synced`. `lastError` clears on the next successful batch or link, or a sign-in attempt.

### 1.8 Unreadable data, and storage full

- `load()` finds data it cannot read (`app.js:195-200`): it keeps the text, **removes `overload.sync.v1`**, and runs on a default state in memory. `link()` and `push()` do nothing meanwhile (`sync.js:323`, `195`), and `setState` is refused (`app.js:479`). No read, no write. Nothing tells the owner that sync is paused: the status is simply not updated.
- When the owner chooses (Restore a copy, or Start fresh), `leaveUnreadable()` calls `pushNow()` (`app.js:2003-2007`), which starts `link()`. The note is gone, so it is a **first link**: the cloud copy is downloaded and merged, nothing is deleted there.
- Storage full (`saveFailed`): the note is not written (1.1), so after a restart the phone takes the cloud's newer copies back instead of deleting them.

### 1.9 The app.js side

- `window.__overload` (`app.js:2418-2444`) is the whole interface; section 5 lists it.
- `setState(next)` (`app.js:478-488`): ignored unless `next.v === 1` and the data is readable; `normalize`, write to localStorage, **no `overload:save` event**, redraw only when no box in the app has the keyboard (`app.js:491-496`).
- Cloud sync card in Settings (`renderCloudCard`, `app.js:1507-1527`, placed at `app.js:1502`): "loading" while `window.__overloadSync` does not exist; a sign-in form; or the address, the status text `#cloud-status`, Sync now and Sign out. Actions: form submit → `signin` (`app.js:2253`); `cloud-signup`, `cloud-reset`, `cloud-signout`, `cloud-push` (`app.js:2244-2247`). The pill in the top bar (`app.js:771-776`) opens Settings.
- `syncOn()` (`app.js:374-378`): signed in; or, while sync.js has not loaded, "the note exists". Used by the export reminder (`app.js:380-386`).
- `cloudNote(verb)` (`app.js:2046-2049`) adds "You are signed in to cloud sync, so the copy in your account (…) is replaced/erased too" to the Import, Restore and Reset questions (`app.js:2057`, `438`, `2238`). In 3.0, `cloudNote(verb, what)` in `overload.js` says "the training data in your account (…)", says what a second signed-in phone sends back (and, for Import and Restore, deletes again; see 1.5) and how to stop it, and that the food log in the account is not changed.
- `window.__overloadSync` (`sync.js:427-460`): `user` (`{ email, uid }` or null), `lastSync`, `error`, `signIn`, `createAccount`, `resetPassword`, `signOut`, `pushNow`. Only app.js uses it.

### 1.10 Easy to miss

1. A push that throws while a batch is being built leaves the note saying "sent": the note is saved at `sync.js:221`, the document references are made at `sync.js:229`. A day key that is empty or holds `/` makes the SDK throw there **(SDK)**; `normalize` does not check day keys (`app.js:264`).
2. The core is last-writer-wins at document level. A phone that was offline replays its old whole core when it reconnects; other phones that are not "ahead" then adopt it key by key. Only weigh-ins, nights, deletion records, workouts and food entries are protected by merging.
   **In 3.0** (S1) much less of this is left: a 3.0 phone sends its core only when it changed a training key or a live deletion record itself, the first one of a session only after the server's core was taken in (merged first), and a merge keeps the phone's value only for the keys it changed (1.4, 1.5). What remains: a change made offline in a session that **had** seen the server's core before the signal dropped is queued in the SDK at once and replays as last-writer-wins (`serverSeen` is not forgotten when the signal drops; on iOS the events for that are unreliable); and a phone still on v2.8 behaves as described above (the review's `r9-returning-phone.js` with the second phone on v2.8: it sends its whole old core once its deletion records expire; `tests/train-sync.js` returnRun closes its v2.8 phone before the 91-day jump for that reason).
3. `known.days` and the days listener make every signed-in phone a full mirror of the food log.
4. An empty day array (`[]`) counts as a day (`!diary[date]` is false).

---

## 2. What v2.8's sync would do to food after the split

Assumption, as planned: T still holds the old food copy and never changes it through its screens; F writes `users/{uid}/foodDays/{date}` in today's format, and keeps its own deletion records in its own document (not in `meta/state`). T runs `sync.js` as it is. Every row was traced in the code and then run against the fake cloud (small fixture: 4 food days, 24 entries, 13 saved foods) **(run)**.

| Case | What T's sync does (code) | Cloud `foodDays` | Food part of `meta/state` | T's old food copy |
| --- | --- | --- | --- | --- |
| **(a)** F edits an entry | Days listener (`sync.js:297-305`): T is not ahead, so the cloud's entry wins; `setState` | not written by T | not touched | **changed** to F's version |
| **(a)** F adds an entry or a new day | Same path; the entry or day is adopted, `known.days` records it | not written by T | not touched | **grows** with everything F logs |
| **(b)** F deletes one entry, others remain | The merge keeps T's copy of that entry (T has no deletion record for it), the result differs from the cloud's text → `pushBack` → `push()` sets the day (`sync.js:305`, `311`, `216`) | **overwritten by T: the deleted entry is back.** When F removes it again, T puts it back again: 3 rounds run, 3 times back. Both apps open = an endless loop of writes | not touched | keeps the entry |
| **(b)** F deletes a whole day | `removed` branch (`sync.js:291-296`): T is not ahead → its day is deleted | not written by T (the deletion stands) | not touched | **loses that day** |
| **(c)** the old food copy is removed from T's data (`diary = {}`, `food` emptied) | `push()`: the core differs → `set meta/state` (`sync.js:202`); every date in `known.days` is missing locally → `delete foodDays/{date}` (`sync.js:218-220`) | **every day deleted** (run: 4 → 0), including days F created after the split, because T's listener had noted them | **overwritten with empty targets, foods and meals** (run: 13 foods → 0). Other v2.8 phones adopt the empty value (`sync.js:138`) | – |
| Reset or Import in T while signed in | Same as (c) | **every day deleted** (run for Reset) | overwritten | – |
| T does a first link while it still has the copy (new sign-in after Reset/Import/Restore while signed out, unreadable data, another account) | `link()` merges cloud-first and keeps what only the phone has; `push()` sets it | **entries and whole days that F deleted come back** (run, with the note removed by hand: one entry and one day back) | the cloud's food plus saved foods only the phone has; written only if that differs | merged |

Two more consequences:

- In (c) with `known.days` emptied first (so nothing is deleted), the days listener downloads the whole food log into T again at the next start (`sync.js:297-304`, a day the note does not list is simply adopted). With the code as it is the removal either destroys the cloud copy or does not stick.
- If F reuses the days listener as it is, T's deletes in (c) arrive in F as `removed` and F deletes its own days (`sync.js:291-296`). (c) or a Reset in T would then empty the food log everywhere.

**Answer:** with the code as it is, (a) does not overwrite or delete cloud data but T's copy is not frozen; (b) entry: cloud data is overwritten (the entry comes back, repeatedly); (b) whole day: nothing in the cloud is overwritten, T's copy loses the day; (c): every cloud food day is deleted and the food part of `meta/state` is overwritten with nothing.

---

## 3. Proposed change to T's sync

### 3.1 The change

A patch of `sync.js` only: 29 lines added, 71 removed. The full diff is in Appendix A; it applies cleanly to v2.8 (`git apply --check`). It was run as a patched copy served in place of `sync.js`; the repo file is untouched.

| # | Where (v2.8 lines) | Change | Why |
| --- | --- | --- | --- |
| 1 | `sync.js:91` `coreOf` | New variable `cloudFood`: the food part (`food`, and `deleted.food`) of the cloud's core as last seen. When it is known, the core T sends carries **that**, not the phone's | T never changes the food part of the cloud core, whatever happens to the phone's copy |
| 2 | `sync.js:135-140` `mergeCore` | Skip the key `food`; keep the phone's `deleted.food` | T never merges cloud food into the old food copy |
| 3 | `sync.js:147-150` `applyDeleted` | Workouts only; the diary is not filtered | A food deletion record from another phone must not remove entries from the old copy |
| 4 | `sync.js:202` `push` | The core is sent only once the cloud's core has been seen in this session (`cloudFood !== undefined`); after sending, `cloudFood` is what was sent | Without it, a start with no cached copy could send the phone's food |
| 5 | `sync.js:213-220` `push` | No `set` and no `delete` of a food day. A date in `known.days` whose day is gone from the phone is only **forgotten** | No write under `foodDays`, ever. Forgetting makes an older version started on this data unable to delete it (3.3) |
| 6 | `sync.js:241-248` core listener | Notes `cloudFood` from every snapshot, its own unsent writes included; first sight schedules a push | Source of `cloudFood`; the SDK's cache holds it across restarts **(SDK)** |
| 7 | `sync.js:283-312` | The `foodDays` listener is removed | No read, no merge |
| 8 | `sync.js:342`, `353-358`, `388-397` `link` | No read of `foodDays`; the phone's `food` and `deleted.food` are put back after the cloud's core is laid over; no diary merge; `cloudFood` taken from the server read | A first link neither downloads food into T nor uploads T's |
| 9 | `sync.js:465`, `322` | `cloudFood` forgotten on sign-out and at the start of `link()` | Another account's food part is not this one's |
| – | `sync.js:97-98`, `126-131` | `dayRef`, `daysCol`, `mergeDay` are no longer used | |

Not changed: the key `overload.sync.v1` and its shape; the Firebase app name; the document `meta/state`, its shape and the order of `CORE_KEYS` (so the text T sends is byte for byte what v2.8 expects); everything about workouts, weigh-ins, nights, settings, program, templates.

When the account has no core yet (first upload), the phone's own `food` goes up, as in v2.8. That creates the food part; it does not change one.

### 3.2 What was run with the patch **(run)**

Phone A (small fixture) and phone B, both linked on v2.8; then A switches to the patch while B stays on v2.8.

| Step | Result |
| --- | --- |
| A starts on the patch | no write; no read of `foodDays`; note unchanged |
| B (v2.8) logs a food, deletes an entry, changes a target | B writes `meta/state` and one food day. A: no write, old food copy unchanged |
| A changes a training setting | A writes `meta/state`; its food part is **B's new one** (target 2000, B's deletion record), not A's old copy. B gets the setting and keeps its food |
| A adds a workout | one `workouts` write; B has it |
| A's old food copy is removed (`diary = {}`, `food` emptied) | **no write at all**; cloud food days 4 → 4; cloud food part unchanged; `known.days` becomes `{}`; B keeps 4 days and 13 foods |
| A changes a setting afterwards, also after a restart | `meta/state` written with the cloud's food part unchanged |
| A: Reset all data, signed in | workouts deleted and the training core replaced (as today); food days and the cloud food part untouched; B keeps its food |
| New phone C on the patch, first sign-in | reads `meta/state` and `workouts` only; C's `food` and `diary` stay empty; no write; a later setting change keeps the cloud food part |
| A offline at start, nothing cached | the workout is queued, the core is **not** sent until the cloud's core is seen; then it goes |
| One phone, heavy fixture (110 food days, 70 workouts), flipping v2.8 → patch → v2.8 → patch → v2.8 | no write at any start; the only writes are the setting changes; cloud food part and all 110 days byte-identical throughout; the phone's `food` and `diary` byte-identical to the fixture |

No page error in any run.

### 3.3 An older version running on the same data again

This is not only a deliberate roll-back. The update itself can do it: a new page fetched online runs the new files under the old service worker (`sw.js:84-88`), and the next start without signal gets the old stored page again (`sw.js:82`) until the new worker has installed. So **v2.8's `sync.js` can run after the new one has run**. The bookkeeping has to be right for both.

With the patch, `overload.sync.v1` keeps v2.8's meaning, and:

- `days` is left exactly as v2.8 wrote it while the phone's days are there, so v2.8 sees itself as "not ahead" and uploads nothing (flip test above). With a second phone that stayed on v2.8 and changed food meanwhile, the returning v2.8 and that phone exchanged one round of merges and ended equal (run): the returning phone sent its core once (its frozen food deletion records differ from the cloud's) and one entry the other phone had deleted went up once from the stale copy and was removed again by that phone's record. Nothing was deleted.
- A day gone from the phone is forgotten, so v2.8 cannot delete it in the cloud (`sync.js:218-220` only deletes dates the note lists). Run: after the diary was removed under the patch and v2.8 came back, v2.8 **downloaded** the days again and deleted nothing.
- A phone first linked under the patch has `days: {}`. v2.8 would then upload that phone's days (run: 4 `set`, no delete). That is v2.8 doing its normal job on the legacy collection.

What the bookkeeping cannot fix: v2.8 pushes its core whenever the phone's core differs from the note. So if the phone's `food` no longer equals the cloud's food part, a v2.8 start uploads the phone's. Run: `food` emptied under the patch, then v2.8 → the cloud's food part was emptied and phone B lost its 13 saved foods. Two ways to close this, both run:

1. **"Remove the old food copy" empties `diary` only and leaves `state.food` alone.** `diary` is the bulk (86% of the food data in the heavy user of `dev/notes/state.md` section 5). Run: v2.8 afterwards left the cloud's food part as it was, deleted nothing and downloaded the days back (with the same one round of merges as above when a second v2.8 phone was there). This is what I recommend.
2. If `food` must go too: at that moment store the account id in the note in a form v2.8 does not recognise (for example `uid: 'v3:' + uid`, with the new `link()` accepting both forms; this is not in Appendix A). v2.8 then takes the first-link path: full download and merge, nothing deleted (`sync.js:325`). Run, with the note changed by hand before v2.8 started: food, days and workouts came back, no write. Cost: a first link lets the cloud win for settings, program and next-time weights, so use it only for this case, not in general.

The same holds for Reset, Import and Restore in the new T if they replace `state.food`: either they carry the phone's `food` across, or they mark the note as in 2.

### 3.4 What remains

- **Two devices and a stale replay.** The patch sends the food part it last saw. A T phone that changed training data offline replays that core later; if a v2.8 phone changed food in between, the food part goes back to the older one and the v2.8 phone adopts it. v2.8 has this between any two phones today (1.10 point 2). It can only touch the legacy copy in `meta/state`, never F's own documents (section 4).
- **A v2.8 phone that changes food after the split, then T rolled back to v2.8:** T's frozen `food` differs from the cloud's and v2.8 uploads it. Needs two devices and a roll-back.
- **Changes v2.8 had not uploaded when the new version took over** (logged in the last second before the app closed, or while signed out) stay on the phone only. The cloud's legacy food copy can be behind the phone's old food copy. See hazard 9.

### 3.5 A smaller alternative, and why not

Only steps 3, 5, 7 and the food-days parts of 8 (delete the three `foodDays` blocks and the diary filter), leaving `food` as an ordinary core key in both directions. That is enough only while nothing ever changes `state.food` on any T phone. It fails the requirement the moment the old copy is removed, or T is Reset, or a backup is imported: the phone's `food` is then uploaded over the cloud's (section 2, case (c), core part). It also lets a v2.8 phone's Reset empty T's old copy of `food`. The nine steps put the rule in one place instead of in every screen that can replace the state.

---

## 4. F's sync

### 4.1 Which documents

Evaluated: `users/{uid}/meta/fuel` plus the existing `users/{uid}/foodDays/{date}`.

- **`meta/fuel`: yes.** A document of its own means F and T can never overwrite each other's core. Shape as today's: `{ core: <text>, updatedAt, v: 1 }`, core keys `settings` (`units`, `theme` only), `food` (`targets`, `foods`, `meals`), `deleted` (`food` only), `bodyweight` (at most the latest). For the heavy fixture that is about 23,000 characters instead of 59,400.
- **The existing `foodDays`: no. F should own a new collection, `users/{uid}/fuelDays/{date}`, same document shape, and read `foodDays` once, read-only.** Reasons, all from section 2:
  - Any phone running v2.8's sync on the account (the owner's phone before the update lands or while it flips, a roll-back, a second device) merges `foodDays` by entry id against **its own** deletion records. F's records are in `meta/fuel`, which v2.8 never reads. Every entry F deletes from a day that still has entries is put back, and both apps then rewrite the day in turn. No code in 3.0 can prevent that; only v2.8's own code runs there.
  - Reset or Import on such a phone deletes every `foodDays` document (run), and F's listener would then delete F's days.
  - With a collection of its own, nothing an Overload of any version does can reach F's log, and nothing F does can change what a roll-back to v2.8 finds.
  - Cost: a one-time copy at first sign-in (one write per day), and food logged later in an old Overload does not appear in F by itself.

If the decision is still to share `foodDays`, the first two points are accepted risks, and the patch should then note every local day as "the cloud has this" (`known.days[date] = hash(local day)`), also on a first link, so that a v2.8 start lets the cloud win.

### 4.2 Constants that must differ

| | T (Overload) | F (Fuel) |
| --- | --- | --- |
| Firebase app | default name, **unchanged** | `initializeApp(firebaseConfig, 'fuel')` |
| Bookkeeping key | `overload.sync.v1` | `fuel.sync.v1` |
| Bookkeeping shape | `{ uid, core, workouts, days }` | `{ uid, core, days }` (`loadKnown` must not require `workouts`, `sync.js:72`) |
| Core document | `users/{uid}/meta/state` | `users/{uid}/meta/fuel` |
| Core keys | as today | `settings, food, deleted, bodyweight` |
| Deletion kinds | `bw, sleep, workouts` merged; `food` carried | `food` |
| Collection | `workouts` | `fuelDays` |
| Legacy reads | none | `meta/state` and `foodDays`, once, from the server, only when `meta/fuel` does not exist |

The Firebase app name matters where both apps share one browser profile (desktop, Android, Safari before installing): with the same name they would share the sign-in session and the Firestore offline cache, and the persistent cache is for one tab at a time **(SDK)**. Do not rename T's: that would sign the owner out and strand writes still queued on the phone **(SDK)**. On the iPhone each Home Screen app has its own storage, so the owner signs in to F once with the same email and password in any case.

### 4.3 First sign-in

Same rule as today: read from the server first; until that works nothing is uploaded.

```
read meta/fuel and fuelDays/* from the server
if meta/fuel exists:                      // F's own data is in the account: a normal first link
    settings: the cloud's
    targets:  the cloud's, unless it has none and the phone has
    foods, meals: union by id, the cloud's wins        (v2.8 unions foods only: sync.js:358)
    deleted.food: union, later time wins               (mergeDeleted)
    each cloud day: mergeDay(cloudEntries, localEntries, deleted.food)   // cloud wins by id, as sync.js:395
    known = hashes of what was read
else:                                     // legacy bootstrap, read-only
    read meta/state and foodDays/* from the server
    from the legacy core take ONLY: food.targets, food.foods, food.meals, deleted.food,
                                    settings.units, settings.theme, the latest weigh-in with weight > 0
    targets:  the phone's if it has any, else legacy
    foods, meals: union by id, THE PHONE'S WINS
    deleted.food: union
    each legacy day: mergeDay(localEntries, legacyEntries, deleted.food)   // the phone's wins by id; legacy fills gaps
    known = { uid, core: null, days: {} }              // nothing of F's is in the cloud yet
safety copy of what is on the phone ('cloud'), setState, save the note, listen, push
```

- The push after a legacy bootstrap only sets: `meta/fuel` and one `fuelDays` document per day. With `days: {}` in the note there is nothing it could delete. Up to 399 days go with the core in one batch, which the server takes or refuses as a whole; more days mean more batches (`sync.js:227-233`). To be exact about "bootstrap done", write a field in `meta/fuel` (for example `legacy: 'done'`) only after every batch was accepted, and repeat the legacy merge on a first link that finds `meta/fuel` without it. The merge is safe to repeat.
- Never copy `settings` whole from `meta/state`: it holds `connKey`, the connector secret (`dev/notes/state.md` 2.2).
- Never write `meta/state`, `workouts` or `foodDays` from F.
- After the bootstrap F never reads the legacy documents again by itself. A button "bring my food from my Overload account again" could run the same merge by hand.

**In Fuel 3.0** (`link`, `takeCore`, `fromOverload` and `addFromOverload` in `fuel/sync.js`). The first branch is as sketched, with saved foods and meals settled against their deletion records (one used after its record was written counts as back), and the account's body weight taken or, when it has none, the phone's converted to the account's units. The legacy bootstrap differs from the sketch:

- It only adds, by the rules of an import (`planImport` in `fuel/fuel.js`, SPEC section 4), repeated in `addFromOverload` (a change to one must be made to both):
  - entries by day and id, added at the end of their day: an entry is already here only when the phone holds its id on that same day (before v2.5 an entry edited across midnight was kept on both days under one id, and v2.8 shows both); one the phone deleted stays deleted (by id);
  - saved foods by id: the phone's stays and takes Overload's star when it has none; when Overload's is `src: 'custom'` and the phone's is the food list's own (`src: 'usda'` or `'off'`), Overload's whole food takes its place, with the phone's `used`, `last` and star kept; a food that is `src: 'custom'` on the phone keeps its numbers (it can still take the star); one deleted on the phone stays deleted;
  - saved meals by id (the phone's stay); targets and body weight only when the phone has none; units and theme only when the phone holds no food of its own (signing in from Welcome leaves Welcome before the account answers, so "at Welcome" cannot be the test here);
  - Overload's records of entries are taken for every entry the phone does not hold. They do not filter what is brought: an entry still in a legacy day arrives, as v2.8 shows it there (one copy of an entry kept on two days, whose other copy was removed in v2.8, is such an entry), and Paste from Overload does the same. The union-and-filter of the sketch would also delete an entry the phone holds whenever Overload has a record for it.
- Entries without an id in a legacy day are left out: v2.8 never uploads them, and Copy my food log carries them.
- No `legacy: 'done'` field: up to 399 days go with the core in one batch; more go in several, and a refused one is sent again a minute later.
- The copy `'cloud'` is taken only when the account held something and the phone holds food. Its text is the phone's state before `setState` (taken in the call: everything before it changed a copy); the sign-in does not wait for it to be stored.

### 4.4 Food already brought across by clipboard or file

Nothing is duplicated, because every route carries the entries with their original ids and all merging is by id (1.5):

- Paste first, sign in later: the legacy bootstrap merges with the phone's copy winning; the cloud only adds entries, foods and meals the phone lacks.
- Sign in first, paste later: the import merges into F the same way (F's copy wins, spec section 4), and the next push uploads the days that changed.
- Both orders end with the union of entries, minus the union of deletion records.

Three conditions:

1. The transfer payload carries entries whole, with `id` and `at`, and `deleted.food`.
2. F gives an id to any entry that has none **before** the first merge or upload (1.5: entries without an id collapse).
3. F does not drop its food deletion records after 90 days the way `app.js:285-288` does. The legacy copies stay around for good; an entry deleted in F comes back from them once its record is gone. Keeping every record costs 29 characters each.

**In Fuel 3.0** all three hold (records for entries, saved foods and saved meals are never pruned), and the two orders end byte for byte the same in the diary and the saved foods, meals and targets, not just with the same union: the bootstrap and the import share their rules (4.3), so whichever comes first brings the log and the second finds nothing new ("Nothing new: everything in this copy is already in Fuel, or was deleted here."). `tests/fuel-sync.js` run "rules" proves it on an account v2.8 filled: a starred food and a corrected food the phone also holds, an entry id on two days, and one removed from one of its two days in v2.8; sign in then paste, and paste then sign in, against Paste alone. What still differs is `moved` (per phone, not synced): it names whichever route came first.

### 4.5 `firestore.rules`

```
match /users/{uid}/{document=**} { allow read, write: if request.auth != null && request.auth.uid == uid; }
```

(`firestore.rules:5-7`.) The wildcard covers every document at any depth under `users/{uid}`, so `meta/fuel` and `fuelDays/{date}` are allowed, reads and lists included. **No rules change is needed**, provided the rules published in the Firebase console are this file (the README says to paste it; I cannot check the console).

### 4.6 Two cheap protections for F's listener

- A day may disappear on the phone only through deletion records, not because a document vanished: on `removed`, keep the entries that are not in `deleted.food`. A real deletion on another F device arrives with its records (same batch); a wrong delete from anywhere else then cannot empty the log.
- Check day keys (`YYYY-MM-DD`) before building a batch (1.10 point 1).

---

## 5. One module or two copies

About 265 of the 472 lines do not care which app they serve: imports and config, hashing and the note, status and error text, the push skeleton, the core listener, the link skeleton with its retry, the public object, the events. About 85 lines are training only (workouts push and listener, matching exercises and templates by name, weigh-ins and nights). About 58 are food only (`mergeDay`, days push, days listener, the day merge in `link`).

**Recommendation: two copies for 3.0, not one configurable module.**

- T's file must change as little as possible: it protects the owner's training data and has to keep working with v2.8 phones. Appendix A is 29 lines in, 71 out, each one explainable. Turning the file into a module with a configuration object rewrites all of it at the same moment its meaning changes, with no tests in the repo yet.
- F's file is new in any case: a copy with the workouts code and the name matching cut, the days code kept, the legacy bootstrap added, and the constants of 4.2. About 320 lines.
- What differs is not just names: one collection replaces by id with delete records, the other merges entry by entry; one carries a foreign food part, the other bootstraps from legacy documents. A shared module would need a strategy per collection, which is more code than the two inline versions.
- Keep each `sync.js` a **single file whose only imports are absolute URLs**. The start-up rescue runs stored scripts from blob addresses (`index.html:60-79`); a relative import inside a module cannot resolve from there, and `bump.sh` does not touch `sync.js`.

Sharing can come later, once the fake-Firestore tests exist.

### The host interface

What `sync.js` needs from the page. F's shell must provide the same.

| Member | Used at | Contract |
| --- | --- | --- |
| `window.__overload` | `sync.js:40` | Must exist before the module runs (a classic script before the module tag). `push()` and `link()` do not check for it |
| `state` (getter) | `sync.js:196`, `246`, `255`, `285`, `344` | The live state. T: `workouts` must be an array. Core keys are read by name |
| `setState(next)` | `sync.js:249`, `279`, `309`, `403` | Replace the state with `next` (always a copy of the current state with keys replaced, so `v` and other top-level fields ride along). Must: normalise; write to storage **without** sending the save event; set `saveFailed` synchronously if the write fails (the note is saved right after, `sync.js:249`); do nothing while unreadable; not redraw under a box being typed in |
| `unreadable` (getter) | `sync.js:195`, `323` | True while the stored data could not be read: sync does nothing. On leaving that state the host calls `__overloadSync.pushNow()` (`app.js:2007`), and it must have removed the note when it found the data unreadable (`app.js:199`) |
| `saveFailed` (getter) | `sync.js:86` | True while the last save failed: the note is not written |
| `safetyCopy(kind)` | `sync.js:401` | Optional. Called with `'cloud'` before a first link replaces the phone's data. Must take the text at once. Fuel: `JSON.stringify(state)` in the call, stored as `before-cloud` in the background; `fuel/sync.js` calls it before `setState` and does not wait |
| `startedWithData` (getter) | `fuel/sync.js` (`noteTrusted`) | Fuel only: whether the page started on saved data, as `load()` found it before anything could be tapped. The note is believed only when it is true. When the shell does not offer it (an older `fuel.js`), the module looks at `fuel.state.v1` itself |
| `setSyncStatus(status, msg)` | `sync.js:162` | `off, error, syncing, offline, synced`. Called twice per upload: patch the pill and the status text only (`app.js:2430-2436`) |
| `syncChanged()` | `sync.js:467` | Optional (falls back to `render()`). Signed in or out: redraw the pill and the card only |
| event `overload:save` on `document` | `sync.js:470` | After every save by the app itself |
| The note's key | `app.js:199`, `2043`, `377` | The host removes it on unreadable data and on Reset, Import, Restore while signed out; it may read "does it exist" while the module loads. 3.0's `overload.js` also removes it at start when `overload.state.v1` is missing or empty (S2) |

And what the page gets: `window.__overloadSync` (1.9).

**In Fuel 3.0** `window.__overload` has twelve members: `state`, `screen`, `saveFailed`, `save`, `render`, `lib` (for `food.js`) and `setState`, `unreadable` (also true while the app waits at Add to Home Screen), `safetyCopy`, `setSyncStatus`, `syncChanged`, `startedWithData` (for `fuel/sync.js`); `tests/fuel-shell.js` checks the list. `fuel.js` removes the note `fuel.sync.v1` in `load()` when `fuel.state.v1` holds nothing or cannot be read, and on Reset and Restore while signed out; not on an import, which only adds.

---

## 6. The Firebase SDK offline

How it works today:

- `sync.js` imports three files from `https://www.gstatic.com/firebasejs/10.14.1/` (`sync.js:14-21`). They are **not** in the worker's install list (`sw.js:3-22`).
- The worker's fetch handler treats `www.gstatic.com` as cacheable (`sw.js:77`), fetches network-first and stores every good answer in the app's cache (`sw.js:84-88`); offline it answers from the cache (`sw.js:82`).
- So the SDK is stored only when it is fetched **while the worker controls the page**. Run with the real `sw.js` **(run)**:

| Start | Sync module | SDK files in the cache |
| --- | --- | --- |
| 1st, online (the page loads before the worker controls it) | loads | none |
| 2nd, offline | **does not load**; the app works | none |
| 3rd, online | loads | 3, in `overload-v23` |
| 4th, offline | loads | 3 |

- Without the module the app runs on local data; Settings shows "Cloud sync is loading…" (`app.js:1511`). Changes made then go up at the next start with the module (a push compares the state with the note).
- `activate` deletes every other `overload-` cache (`sw.js:57`), and the stored SDK with it. After each release the SDK has to be fetched once more online.

What F needs:

1. **The same rule in F's worker**: treat `www.gstatic.com` as cacheable and store into F's own cache. A worker handles all requests of the pages it controls, whatever host they go to, so F's worker serves F's pages only.
2. F's cache name must not start with `overload-` (`sw.js:57` would delete it, in a shared browser profile).
3. On the iPhone F's Home Screen app starts with empty storage: the SDK is stored at F's **second** online start. To have it from the first: after `navigator.serviceWorker.ready`, fetch the three addresses once from the page (the worker then stores them); and copy the `gstatic` entries from the old cache into the new one in `activate` before deleting the old.
4. Do not put the three addresses into the all-or-nothing install list unless a blocked or slow `gstatic` is allowed to stop the whole app from installing. Sync is optional; installing is not.
5. Same SDK version in both apps (one download where they share a profile).
6. Prefer `caches.open(CACHE).then((c) => c.match(…))` over `caches.match(…)` in F's worker: `caches.match` looks in every cache of the site, the other app's included.
7. Firestore and sign-in traffic goes to other hosts and is not cached (`sw.js:78`); queued writes live in the SDK's own IndexedDB **(SDK)**.

Not verified: whether the real `firebase-auth.js` and `firebase-firestore.js` pull further files from `gstatic` (the rule at `sw.js:77` would store them too).

---

## 7. Hazards

1. **The old code deletes by absence.** With v2.8's `push()`, a diary that loses days deletes those days in the cloud (`sync.js:218-220`), and an emptied `food` is uploaded (`sync.js:202`). *Precaution:* Appendix A; a fake-Firestore test that T issues no `set` or `delete` whose path holds `/foodDays/` and that the food part of `meta/state` is byte-identical after: removal of the old copy, Reset, Import, Restore, a new phone's first link.
2. **v2.8 runs again after 3.0** (half-arrived update, roll-back, second device). *Precaution:* never assume it is gone; keep `overload.sync.v1` in v2.8's meaning; F's days in a collection v2.8 does not know (4.1).
3. **Shared `foodDays`: entries deleted in F come back, with an endless write loop, and a Reset in an old Overload empties F's log.** *Precaution:* 4.1.
4. **Removing `state.food` from T, then v2.8 starts:** the cloud's food part is emptied and other v2.8 phones lose their saved foods (run). *Precaution:* 3.3, way 1 or 2.
5. **F's copy of `sync.js` pointing at `meta/state` or `workouts`.** One push would replace T's core with F's: `settings` shrinks to two keys, so every Overload phone takes them (`sync.js:138`), falls back to default training settings (`app.js:271`) and loses the connector link; a v2.8 phone also takes F's `food` whole. (Weigh-ins survive: they are merged by date.) *Precaution:* the table in 4.2; a test that every path F writes is `meta/fuel` or `fuelDays/…`, and that F reads `meta/state` and `foodDays` only in the bootstrap.
6. **The connector secret.** `meta/state` holds `settings.connKey`. *Precaution:* F takes `units` and `theme` only (4.3).
7. **v2.8's first link drops the phone's own saved meals and targets** (run). *Precaution:* F unions meals and keeps the phone's targets when the cloud has none (4.3).
8. **Deletion records expire after 90 days; the legacy copies do not.** *Precaution:* F keeps its food deletion records (4.4, condition 3). *In Fuel 3.0:* done, for entries, saved foods and saved meals.
9. **The account's legacy food can be behind the phone's.** T on 3.0 never uploads food; whatever v2.8 had not sent stays on the phone, and a phone that first signs in under 3.0 has no food days in the account at all. *Precaution:* show "Sign in to Fuel with the same email: your food log is already in your account" only when the note proves it: every day of `state.diary` has `known.days[date] === hash(JSON of that day)` and the note lists no other day (`hash` is private to `sync.js:57-66`, so `sync.js` should offer this as a getter on `window.__overloadSync`). Otherwise point to Copy or Save as a file, which carry the phone's full copy. F merges both routes without duplicates (4.4). *In 3.0 after the review (S4):* the card never says signing in is enough, even when `foodInCloud` is true (F reads Overload's account copy only at its first sign-in, so food logged by an older version after that only goes across by Copy or a file). It always says: "Using cloud sync? Copy the food log or save it as a file from here as well. Signing in to Fuel with the same email may bring some of it across, but not always all of it."
10. **Entries without an id, day keys that are not dates.** The first collapse in a merge; the second can make a push throw after the note was saved (1.10 point 1). *Precaution:* F checks both on load, import and before upload. *In Fuel 3.0:* done (`normalize` in `fuel.js` at load, import and `setState`; `push` in `fuel/sync.js` sends no day whose name is not a date or that holds an entry without an id).
11. **One browser profile, one Firebase app name.** *Precaution:* F uses a named app; T keeps the default (4.2).
12. **A relative import in a sync module** breaks the start-up rescue for sync. *Precaution:* single-file modules (section 5).
13. **The SDK is not stored on the first start** and is lost at every release until the next online start (section 6). *Precaution:* section 6, points 1 to 4. Never make the app's start depend on the module.
14. **Wording.** In 3.0 the Reset question still says "and food log" and that the account's copy "is erased too" (`app.js:2238`, `2046-2049`). With the patch the account's food is not touched. *Precaution:* reword, so the owner is not told something false. *Done in 3.0:* `cloudNote` (1.9) says the training data is erased or replaced, what a second signed-in phone sends back or deletes again, and that the food log in the account is not changed.
15. **The guards at start.** 3.0 sends the core only after seeing the cloud's (`cloudFood`), and the first core of a session only after the server's own core was taken in (`serverSeen`, 1.4). If someone later "simplifies" the first away, a start with no cached core sends the phone's food; without the second, a phone opened after weeks sends its cached old core over what the other phones changed (S1). *Precaution:* keep both guards and their tests in `tests/train-sync.js` (the "offline at start, nothing cached" case of 3.2, "offline over a restart", and the phones that come back in returnRun). Keep `readServerCore` confirm-only (`takeCore(snap, true)`): letting it merge would let an older answer arrive after a newer listener snapshot and be sent. Keep `RECORD_DAYS` in `sync.js` in step with the 90 days of `normalize` in `overload.js`.
16. **A core document has a size limit of 1 MiB** **(SDK)**. `food.foods` is never pruned. Far away today (59,400 characters in the heavy fixture), and moving food to `meta/fuel` makes both cores smaller. A refused write shows as a sync error and is retried every 60 s (`sync.js:231`).

---

## 8. Open questions

1. Is cloud sync on on the owner's phone? Nothing in the repo can tell. If it is off, sections 3 and 4 only matter from the day it is turned on.
2. Are the rules published in the Firebase console the ones in `firestore.rules`? If they were narrowed by hand, F's first read of `meta/fuel` fails with "Firestore rules are blocking this account" and nothing is written.
3. Does a second device exist that would stay on v2.8? It decides how much the two-device cases in 3.4 matter.
4. Decision: F's days in `fuelDays` (recommended) or in `foodDays` (the draft spec, section 6).
5. Decision: does "Remove the old food copy" empty `diary` only (recommended, 3.3) or `food` too.
6. Decision: do Reset, Import and Restore in T carry the phone's `food` and `diary` across, or replace them. The patch protects the cloud either way; 3.3 applies when they replace `food`.
7. Real-SDK behaviour I could not run: the order of cached, pending and server snapshots; that a persistent cache reports documents deleted while the app was closed as `removed`; the fall back to a memory cache when IndexedDB cannot be used; the storage names per Firebase app name. The fake models the documented behaviour. A test against the Firebase emulator would settle these, if one may be installed.
8. How long must `meta/state` keep its food part? It is needed for F's first sign-in and for v2.8 phones. Dropping it later is a separate, deliberate release.

---

## Appendix A. The proposed patch to `sync.js`

Against v2.8. Checked with `git apply --check`; run as described in 3.2 and 3.3.

````diff
--- a/sync.js
+++ b/sync.js
@@ -88,14 +88,20 @@
 }
 // Cloud documents are parsed without keys that would change how objects behave (__proto__ and the like).
 const parse = (t) => JSON.parse(t, (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype' ? undefined : v));
-function coreOf(s) { const o = {}; CORE_KEYS.forEach((k) => { o[k] = s[k]; }); return o; }
+// Food moved to the diet app. This app no longer reads or changes food, on the phone or in the cloud:
+// the core document is sent with the food part the cloud already holds, and foodDays is never touched.
+let cloudFood;   // undefined: the cloud's core not seen yet in this session; null: the account has no core; else its food part
+const foodPart = (core) => ({ food: core.food, del: core.deleted && core.deleted.food });
+function coreOf(s) {
+  const o = {}; CORE_KEYS.forEach((k) => { o[k] = s[k]; });
+  if (cloudFood) { o.food = cloudFood.food; o.deleted = Object.assign({}, s.deleted, { food: cloudFood.del }); }
+  return o;
+}
 function coreJson(s) { return JSON.stringify(coreOf(s)); }
 
 function metaRef() { return doc(db, 'users', user.uid, 'meta', 'state'); }
 function workoutRef(id) { return doc(db, 'users', user.uid, 'workouts', id); }
 function workoutsCol() { return collection(db, 'users', user.uid, 'workouts'); }
-function dayRef(date) { return doc(db, 'users', user.uid, 'foodDays', date); }
-function daysCol() { return collection(db, 'users', user.uid, 'foodDays'); }
 // ---------------------------------------------------------------------------
 // Merging. Two phones can change the same data, and Firestore replays a phone's
 // offline writes as-is when it reconnects. So lists are merged, never replaced:
@@ -123,31 +129,24 @@
   (first || []).forEach((x) => by.set(x.date, x));
   return [...by.values()].filter((x) => !(gone && gone[x.date])).sort((a, b) => (a.date < b.date ? -1 : 1));
 }
-// Two copies of one day's food log: every entry from both, `first` winning for the same entry.
-function mergeDay(first, second, gone) {
-  const byId = new Map((second || []).map((e) => [e.id, e]));
-  (first || []).forEach((e) => byId.set(e.id, e));
-  return [...byId.values()].filter((e) => !(gone && gone[e.id])).sort((a, b) => (a.at || 0) - (b.at || 0));
-}
 function mergeCore(local, remote) {
   const localAhead = hash(coreJson(local)) !== known.core;
   const out = {};
   CORE_KEYS.forEach((k) => {
     // A key this phone changed and has not uploaded yet stays; otherwise the cloud's copy.
+    if (k === 'food') return;
     const changedHere = localAhead && baseCore && JSON.stringify(local[k]) !== JSON.stringify(baseCore[k]);
     out[k] = changedHere || remote[k] === undefined ? local[k] : remote[k];
   });
   out.deleted = mergeDeleted(local.deleted, remote.deleted);
+  out.deleted.food = (local.deleted && local.deleted.food) || {};
   out.bodyweight = localAhead ? unionByDate(local.bodyweight, remote.bodyweight, out.deleted.bw) : unionByDate(remote.bodyweight, local.bodyweight, out.deleted.bw);
   out.sleep = localAhead ? unionByDate(local.sleep, remote.sleep, out.deleted.sleep) : unionByDate(remote.sleep, local.sleep, out.deleted.sleep);
   return out;
 }
 // Drop anything the deletion records say is gone (after new records arrive from another phone).
 function applyDeleted(st) {
-  const del = st.deleted || {}; const food = del.food || {}, ws = del.workouts || {};
-  const diary = {};
-  Object.keys(st.diary || {}).forEach((d) => { const list = st.diary[d].filter((e) => !food[e.id]); if (list.length) diary[d] = list; });
-  st.diary = diary;
+  const ws = (st.deleted || {}).workouts || {};
   st.workouts = (st.workouts || []).filter((w) => !ws[w.id] || w.id === st.active);
   return st;
 }
@@ -199,7 +198,7 @@
   const before = JSON.stringify(known);   // what the cloud held before this push, for rollback on failure
 
   const cj = coreJson(s), ch = hash(cj);
-  if (ch !== known.core) { ops.push((b) => b.set(metaRef(), { core: cj, updatedAt: now, v: 1 })); known.core = ch; baseCore = JSON.parse(cj); }
+  if (cloudFood !== undefined && ch !== known.core) { ops.push((b) => b.set(metaRef(), { core: cj, updatedAt: now, v: 1 })); known.core = ch; baseCore = JSON.parse(cj); cloudFood = foodPart(baseCore); }
 
   const seen = {};
   s.workouts.forEach((w) => {
@@ -210,14 +209,10 @@
     if (!seen[id]) { ops.push((b) => b.delete(workoutRef(id))); delete known.workouts[id]; }
   });
 
+  // Food days: nothing is sent. A day that is gone from this phone is only forgotten, so that an older
+  // version of the app started on this data could never delete it in the cloud.
   const diary = s.diary || {};
-  Object.keys(diary).forEach((date) => {
-    const j = JSON.stringify(diary[date]), h = hash(j);
-    if (known.days[date] !== h) { ops.push((b) => b.set(dayRef(date), { data: j, updatedAt: now, v: 1 })); known.days[date] = h; }
-  });
-  Object.keys(known.days).forEach((date) => {
-    if (!diary[date]) { ops.push((b) => b.delete(dayRef(date))); delete known.days[date]; }
-  });
+  Object.keys(known.days).forEach((date) => { if (!diary[date]) delete known.days[date]; });
   saveKnown();
   if (!ops.length) return;
 
@@ -239,13 +234,15 @@
 function listen() {
   stopListening();
   unsubs.push(onSnapshot(metaRef(), { includeMetadataChanges: false }, (snap) => {
-    if (!snap.exists() || snap.metadata.hasPendingWrites) return;
+    const unseen = cloudFood === undefined;
+    if (!snap.exists()) { if (unseen && !snap.metadata.fromCache) { cloudFood = null; schedulePush(); } return; }
     const remote = snap.data().core;
-    if (typeof remote !== 'string' || hash(remote) === known.core) return;
+    if (typeof remote !== 'string') return;
     let core; try { core = parse(remote); } catch (e) { return; }
+    if (snap.metadata.hasPendingWrites || hash(remote) === known.core) { cloudFood = foodPart(core); if (unseen) schedulePush(); return; }
     const local = host().state;
-    const next = applyDeleted(Object.assign({}, local, mergeCore(local, core)));
-    known.core = hash(remote); baseCore = core;
+    const next = applyDeleted(Object.assign({}, local, mergeCore(local, core)));   // before cloudFood moves on: mergeCore compares with the core known so far
+    known.core = hash(remote); baseCore = core; cloudFood = foodPart(core);
     host().setState(next); saveKnown();   // after the app's own save, so a failed save is known
     schedulePush();   // the merge may hold something the cloud lacks; push() only sends what differs
   }, (e) => { lastError = friendly(e); report(); }));
@@ -279,37 +276,6 @@
     host().setState(Object.assign({}, host().state, { workouts: list }));
     saveKnown();
   }, (e) => { lastError = friendly(e); report(); }));
-
-  unsubs.push(onSnapshot(daysCol(), (qs) => {
-    let changed = false, pushBack = false;
-    const diary = Object.assign({}, host().state.diary);
-    const gone = ((host().state.deleted || {}).food) || {};
-    qs.docChanges().forEach((ch) => {
-      if (ch.doc.metadata.hasPendingWrites) return;
-      const date = ch.doc.id;
-      const localAhead = diary[date] && hash(JSON.stringify(diary[date])) !== known.days[date];
-      if (ch.type === 'removed') {
-        if (known.days[date] === undefined) return;
-        delete known.days[date]; changed = true;
-        // Entries logged here and not uploaded yet survive the other phone clearing the day.
-        const keep = localAhead ? diary[date].filter((e) => !gone[e.id]) : [];
-        if (keep.length) { diary[date] = keep; pushBack = true; } else delete diary[date];
-      } else {
-        const j = ch.doc.data().data;
-        if (typeof j !== 'string' || known.days[date] === hash(j)) return;
-        let entries; try { entries = parse(j); } catch (e) { return; }
-        if (!Array.isArray(entries)) return;
-        const merged = localAhead ? mergeDay(diary[date], entries, gone) : mergeDay(entries, diary[date], gone);
-        if (merged.length) diary[date] = merged; else delete diary[date];
-        known.days[date] = hash(j); changed = true;
-        if (JSON.stringify(merged) !== j) pushBack = true;
-      }
-    });
-    if (!changed) return;
-    host().setState(Object.assign({}, host().state, { diary }));
-    saveKnown();
-    if (pushBack) schedulePush();
-  }, (e) => { lastError = friendly(e); report(); }));
 }
 
 function stopListening() { unsubs.forEach((u) => u()); unsubs = []; }
@@ -320,6 +286,7 @@
 async function link() {
   const h = host();
   clearTimeout(linkTimer);
+  cloudFood = undefined;
   if (h.unreadable) return;   // the app could not read its saved data: nothing syncs until he chooses what to do
   const stored = loadKnown();
   if (stored && stored.uid === user.uid) {
@@ -339,7 +306,7 @@
   linking = uid;
   inflight++; report();
   try {
-    const [meta, ws, ds] = await Promise.all([getDocFromServer(metaRef()), getDocsFromServer(workoutsCol()), getDocsFromServer(daysCol())]);
+    const [meta, ws] = await Promise.all([getDocFromServer(metaRef()), getDocsFromServer(workoutsCol())]);
     if (!user || user.uid !== uid) return;
     const local = h.state;
     const localHasHistory = local.workouts.some((w) => w.finishedAt);
@@ -350,12 +317,13 @@
       fresh.core = hash(meta.data().core);
       const cloud = parse(meta.data().core);
       baseCore = cloud;
+      const mine = { food: next.food, del: (next.deleted || {}).food || {} };
       Object.assign(next, cloud);
+      next.food = mine.food;
       next.deleted = mergeDeleted(local.deleted, cloud.deleted);
+      next.deleted.food = mine.del;
       next.bodyweight = unionByDate(cloud.bodyweight, local.bodyweight, next.deleted.bw);
       next.sleep = unionByDate(cloud.sleep, local.sleep, next.deleted.sleep);
-      // Foods saved only on this phone are kept alongside the account's.
-      if (local.food && local.food.foods && next.food) next.food.foods = Object.assign({}, local.food.foods, next.food.foods || {});
       // This phone's workouts and templates use its own exercise ids: match them to the account's by name.
       next.exercises = (next.exercises || []).slice();
       next.presc = Object.assign({}, next.presc || {});
@@ -385,18 +353,8 @@
     });
     next.workouts.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
     if (next.active && !next.workouts.some((w) => w.id === next.active)) next.active = null;
-    // Food days are merged entry by entry, so neither phone's log is lost.
-    next.diary = Object.assign({}, local.diary || {});
-    ds.forEach((d) => {
-      const j = d.data().data; if (typeof j !== 'string') return;
-      let entries; try { entries = parse(j); } catch (e) { return; }
-      if (!Array.isArray(entries)) return;
-      fresh.days[d.id] = hash(j);
-      const merged = mergeDay(entries, next.diary[d.id], (next.deleted || {}).food);
-      if (merged.length) next.diary[d.id] = merged; else delete next.diary[d.id];
-    });
-
     applyDeleted(next);
+    cloudFood = meta.exists() && typeof meta.data().core === 'string' ? foodPart(parse(meta.data().core)) : null;
     // The account's settings and program are about to replace this phone's: keep a copy of what is here first.
     if (fresh.core && h.safetyCopy) h.safetyCopy('cloud');
     known = fresh;
@@ -462,7 +420,7 @@
 onAuthStateChanged(auth, (u) => {
   user = u;
   if (u) link();
-  else { stopListening(); known = null; report(); }
+  else { stopListening(); known = null; cloudFood = undefined; report(); }
   const h = host();
   if (h) { if (h.syncChanged) h.syncChanged(); else h.render(); }   // only the sync parts, not the whole screen
 });
````

Also to update with it: the header comment (`sync.js:1-13`), the README's cloud section, and the wording in hazard 14.

---

## Appendix B. The fake Firebase used for the runs

It lived in a temporary folder and is not in the repo. It is small enough to rebuild from this description; the test that the spec asks for ("against a fake Firestore", spec section 11) can start from it.

- **Routing.** `context.route('**/*')`: requests to `http://127.0.0.1` continue; the three addresses `https://www.gstatic.com/firebasejs/10.14.1/firebase-{app,auth,firestore}.js` are answered with `route.fulfill` (`contentType: 'text/javascript'`, header `access-control-allow-origin: *`) from the stand-ins below; everything else is aborted. For "offline", abort the three addresses too: `context.setOffline(true)` alone does not stop a fulfilled route.
- **The cloud** is a `Map` of path → document in the Node process, with a log of every write `{ who, type: 'set' | 'delete', path }` and of every read. Pages reach it through three `context.exposeBinding` functions: `__fc_get(path)`, `__fc_list(collectionPath)`, `__fc_commit(who, ops)`. After a commit every other page is told to refresh its listeners (`page.evaluate(() => window.__fcRemote())`). A second writer that is not a page (the "diet app" in section 2) changes the map directly and notifies all pages.
- **`firebase-app.js`**: `initializeApp(cfg, name)` returns `{ name: name || '[DEFAULT]' }`.
- **`firebase-auth.js`**: `getAuth`; `onAuthStateChanged(auth, f)` calls `f` with the user kept in localStorage `fake.auth` (null at first); `signInWithEmailAndPassword` and `createUserWithEmailAndPassword` set `{ uid: 'U1', email }`; `signOut` clears it; `sendPasswordResetEmail` does nothing.
- **`firebase-firestore.js`**:
  - `initializeFirestore`, `persistentLocalCache`: placeholders. `doc(db, ...segments)` → `{ kind: 'doc', path, id }`; `collection(db, ...segments)` → `{ kind: 'col', path }`.
  - `getDocFromServer(ref)` → `{ id, exists(), data(), metadata: { hasPendingWrites: false, fromCache: false } }`; `getDocsFromServer(col)` → `{ forEach }`. Both throw `{ code: 'unavailable' }` when `window.__fcOffline` is set.
  - `onSnapshot(ref, [options], next)`: keeps a view per listener (path → JSON text). First it delivers what a per-page cache (localStorage `fake.fscache`) holds, with `fromCache: true`; then it reads the server and delivers the differences. For a collection: `{ docChanges() }` with `added`, `modified`, `removed`. For a document: a snapshot whenever the text changed, and once at the start even when the document does not exist. Returns an unsubscribe function.
  - `writeBatch()` → `{ set(ref, data), delete(ref), commit() }`. `commit()` first changes the cache and the views of this page's listeners **without calling them** (in the real SDK these arrive with `hasPendingWrites`, which `sync.js` skips), then sends the ops to the cloud. With `__fcOffline` it returns a promise that never settles.
- **A phone** is one browser context (own storage) with `serviceWorkers: 'block'` (except for section 6), an init script that sets `window.__fcClient` (the name in the log) and seeds `overload.state.v1` once, and `page.on('dialog', (d) => d.accept())`.
- **Running the patch**: `context.route('**/sync.js*', …)` answering with the patched text; `context.unroute` switches the same storage back to v2.8.
- **Fixtures**: `tests/fixtures/v28-state-small.json` and `v28-state.json` (the exact text of `overload.state.v1`).

What the fake does not model: real latency and ordering between listeners, the SDK's own persistence format, auth errors, rules, size limits.

### The Firestore stand-in, as run

Served in place of `firebase-firestore.js`. `window.__fc_get`, `__fc_list` and `__fc_commit` are the three bindings described above; `window.__fcClient` is the phone's name in the log.

````js
const client = () => window.__fcClient || 'client';
const listeners = new Set();
const CK = 'fake.fscache';
let cache = {}; try { cache = JSON.parse(localStorage.getItem(CK)) || {}; } catch (e) {}
const saveCache = () => { try { localStorage.setItem(CK, JSON.stringify(cache)); } catch (e) {} };
const parentOf = (p) => p.split('/').slice(0, -1).join('/');
export function initializeFirestore(app) { return { app }; }
export function persistentLocalCache() { return { kind: 'persistent' }; }
export function doc(db, ...seg) { return { kind: 'doc', path: seg.join('/'), id: seg[seg.length - 1] }; }
export function collection(db, ...seg) { return { kind: 'col', path: seg.join('/') }; }
const snapOf = (path, json, fromCache) => ({ id: path.split('/').pop(), exists: () => json != null, data: () => (json == null ? undefined : JSON.parse(json)), metadata: { hasPendingWrites: false, fromCache: !!fromCache } });
const offline = () => { if (window.__fcOffline) { const e = new Error('offline'); e.code = 'unavailable'; throw e; } };
export async function getDocFromServer(ref) { offline(); const d = await window.__fc_get(ref.path); return snapOf(ref.path, d == null ? null : JSON.stringify(d)); }
export async function getDocsFromServer(col) { offline(); const list = await window.__fc_list(col.path); return { forEach(f) { list.forEach((x) => f(snapOf(x.path, JSON.stringify(x.data)))); } }; }
function deliverDoc(L, json, fromCache) {
  const p = L.ref.path;
  if (L.delivered && (L.view[p] === undefined ? null : L.view[p]) === json) return;
  L.delivered = true; if (json == null) delete L.view[p]; else L.view[p] = json;
  if (!fromCache) { if (json == null) delete cache[p]; else cache[p] = json; saveCache(); }
  L.next(snapOf(p, json, fromCache));
}
function deliverCol(L, map, fromCache) {   // map: path -> json
  const changes = [];
  Object.keys(map).forEach((p) => { if (L.view[p] === undefined) changes.push({ type: 'added', doc: snapOf(p, map[p], fromCache) }); else if (L.view[p] !== map[p]) changes.push({ type: 'modified', doc: snapOf(p, map[p], fromCache) }); });
  Object.keys(L.view).forEach((p) => { if (map[p] === undefined) changes.push({ type: 'removed', doc: snapOf(p, L.view[p], fromCache) }); });
  L.view = Object.assign({}, map);
  if (!fromCache) { Object.keys(cache).forEach((p) => { if (parentOf(p) === L.ref.path) delete cache[p]; }); Object.assign(cache, map); saveCache(); }
  if (!changes.length && L.delivered) return;
  L.delivered = true;
  L.next({ docChanges: () => changes, metadata: { fromCache: !!fromCache } });
}
async function refresh(L) {
  if (window.__fcOffline) return;
  if (L.ref.kind === 'doc') { const d = await window.__fc_get(L.ref.path); if (L.alive) deliverDoc(L, d == null ? null : JSON.stringify(d)); }
  else { const list = await window.__fc_list(L.ref.path); const map = {}; list.forEach((x) => { map[x.path] = JSON.stringify(x.data); }); if (L.alive) deliverCol(L, map); }
}
export function onSnapshot(ref, a, b) {
  const next = typeof a === 'function' ? a : b;
  const L = { ref, next, alive: true, view: {}, delivered: false };
  listeners.add(L);
  (async () => {
    await null; if (!L.alive) return;
    if (ref.kind === 'doc') { if (cache[ref.path] !== undefined) deliverDoc(L, cache[ref.path], true); }
    else { const map = {}; Object.keys(cache).forEach((p) => { if (parentOf(p) === ref.path) map[p] = cache[p]; }); if (Object.keys(map).length) deliverCol(L, map, true); }
    await refresh(L);
  })();
  return () => { L.alive = false; listeners.delete(L); };
}
window.__fcRemote = async () => { for (const L of [...listeners]) await refresh(L); };
export function writeBatch() {
  const ops = [];
  return {
    set(ref, data) { ops.push({ type: 'set', path: ref.path, data }); },
    delete(ref) { ops.push({ type: 'delete', path: ref.path }); },
    async commit() {
      // The local view changes at once and silently (the real SDK reports these with hasPendingWrites).
      ops.forEach((o) => {
        const json = o.type === 'set' ? JSON.stringify(o.data) : undefined;
        if (json === undefined) delete cache[o.path]; else cache[o.path] = json;
        listeners.forEach((L) => { if (L.ref.path === o.path || (L.ref.kind === 'col' && parentOf(o.path) === L.ref.path)) { if (json === undefined) delete L.view[o.path]; else L.view[o.path] = json; } });
      });
      saveCache();
      (window.__fcCommits = window.__fcCommits || []).push(ops.map((o) => o.type + ' ' + o.path));
      if (window.__fcOffline) return new Promise(() => {});
      if (window.__fcReject) { const e = new Error('denied'); e.code = 'permission-denied'; throw e; }
      await window.__fc_commit(client(), ops);
    }
  };
}
````
