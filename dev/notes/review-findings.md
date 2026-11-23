# Review findings on the built split (frozen tree d2cc29b)

Six independent reviewers tried to break the build before the new look was applied. Every finding below was
reproduced by a script of theirs unless it says otherwise. Their scripts are in the scratch folders named under
"evidence"; they point at the frozen tree, so pass your own tree or adapt the path when you rerun one.

IDs (U1, H2, S3 ...) are used by the fix plan.

## upgrade

The upgrade itself holds: on v2.8 data, 3.0's first start, first save, a day of use and every v2.8/3.0 flip I tried left the food and training data byte for byte as v2.8 would, and the split copy survived every failure I gave it. I found six problems, none of them in that ordinary path.

The two that matter share one cause the notes do not know about. offline.md (T8, H5) assumes that on a slow start "v2.8 starts", so the two versions only alternate. They can also mix. v2.8's worker asks the server first for `app.js?v=2.8`, the server ignores the `?v=` and answers with 3.0's file, and the worker stores it under the v2.8 name. So v2.8's stored page (six tabs, v2.8's food.js) runs 3.0's app.js, with or without signal afterwards.

- **High:** in the mix where sync.js is still v2.8's, "Remove the old food log" deletes the account's food log in the cloud and empties the diary on a second v2.8 device, while its question says the cloud is not changed. It needs cloud sync on, that particular mix, and Copy plus Remove in the same session, so it is narrow; the guard is a few lines.
- **Medium:** the mixed page itself. On this tree all 14 mixes start cleanly and training works; the visible harm is a Food tab that does nothing. The redesigned tree is not covered: v2.8's page loads only styles.css, so run e8 and e14 on it before release.
- **Medium:** the safety copy of Remove is one slot. After v2.8 has run again and logged one food, Restore of that copy refuses to bring the log back, and the only way forward (Remove again) overwrites it.
- **Low (three):** a full localStorage makes Copy say "copied" while nothing is noted and Remove is never offered; a double tap on Save as a file then Cancel is recorded as saved; a lost IndexedDB connection makes Remove fail until the app is restarted.

Two of the low ones and the cloud effects rest on stand-ins (share sheet, closed IndexedDB connection, tests/fake-firebase); nothing ran on an iPhone or against real Firebase.

Everything is in /tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-upgrade/ (rv.js is the helper; each eN script runs on its own with node). No server is left running and the frozen tree is unchanged.

### U1 [high] When a half-arrived update leaves v2.8's page running 3.0's app.js beside v2.8's sync.js, "Remove the old food log" deletes the whole food log from the cloud account and from a second signed-in v2.8 device, while its question says the cloud is not changed.

- Reproduced: yes
- Code: app.js:2340-2343 (removeFoodLog empties state.diary and saves); app.js:2315-2322 (forgetSyncedDays only edits the note in localStorage, v2.8's sync.js holds it in memory); app.js:2333 (the promise in the question); v2.8 sync.js:218-219 at 3b17963 (the delete); root cause is the mixed page of the next finding

**Sequence**

1. v2.8 is installed and signed in to cloud sync; optionally a second device on v2.8 uses the same account.
2. 3.0 is released. Overload is opened on weak signal: the page request takes over 3 s, so v2.8's worker serves its stored v2.8 page. `app.js?v=2.8` is answered by the server in time (with 3.0's app.js), `sync.js?v=2.8` is not, so the stored v2.8 sync.js runs.
3. The owner follows the card: Copy my food log, then Remove the old food log, and confirms twice. The first question says "The food log in your cloud account is not changed."
4. app.js empties the diary and saves. v2.8's sync.js sees the days gone, deletes every `foodDays` document, and the other v2.8 device's listener removes those days from its own diary.
Phone A still holds the log in the copy "Before removing the old food log".

**Evidence**

The mix arises under the real v2.8 worker:
/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-upgrade/e8-mixed-release.js --slow=sync.js
  scripts this page runs: app.js = 3.0, sync.js = v2.8, connector.js = 3.0, programs.js = v2.8, food.js = v2.8
  (programs.js is the same file in both releases)

The consequence, against tests/fake-firebase with the mix built as a folder:
/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-upgrade/e9-mixed-remove-cloud.js
  2. running: the page of 2.8 (6 tabs), app.js says "Overload · v3.0", signed in as me@example.com
  the question said: The food log in your cloud account is not changed.
  BROKEN 3. ... 0 of 4 food days left in the cloud; writes under foodDays: delete 2026-11-15 [applied], delete 2026-11-18 [applied], delete 2026-11-20 [applied], delete 2026-11-21 [applied]
  BROKEN 4. ... 0 of 4 food days left on device B; its Food tab: 0 kcal

Control with 3.0's own page (`--pure`): 4 of 4 days left in the cloud, no write under foodDays, device B keeps 4 of 4.

**Suggested fix**

In removeFoodLog, refuse ("Finish updating Overload first") when the loaded sync module is not 3.0's, for example `window.__overloadSync` exists without the `foodInCloud` member, or when app.js is not running in its own page (its script tag's `?v=` differs from VERSION, or the page has a Food tab). The root fix of the next finding removes the mix altogether. Keep e9 as a regression test.

### U2 [medium] After the release, a start on weak signal runs 3.0's app.js inside v2.8's stored page (six tabs, a Food tab that does nothing, v2.8's food.js loaded), and v2.8's offline copy is overwritten with 3.0's files so the same mix starts with no signal too.

- Reproduced: yes
- Code: index.html:98,140-144 and app.js, sync.js, connector.js, programs.js, backup.js, styles.css: 3.0 keeps v2.8's file names, so the server answers `?v=2.8` requests with 3.0's files; v2.8 sw.js:82-97 at 3b17963 (server first, stored copy after 3 s, every answer stored under the asked name); sw.js:87-102 keeps the same logic for 3.0 to 3.1; dev/notes/offline.md:363 (T8) and H5 say "v2.8 starts"

**Sequence**

1. v2.8 is installed with its worker and offline copy. 3.0 is published.
2. Overload is opened where the page request takes over 3 s or fails: the worker serves the stored v2.8 page.
3. That page asks for `app.js?v=2.8` and the rest, server first. Each answer that arrives within 3 s is 3.0's file and runs in the v2.8 page; each later answer is stored under the v2.8 name.
4. From then on, with no signal, the stored v2.8 page runs 3.0's app.js until 3.0's worker has installed once.
5. If a workout is in progress the reload is held, so the mixed page is used for the whole workout.
On this tree the mixed page works for training. The redesigned 3.0 would draw its new markup in a page that loads only styles.css (no shared/ui.css, train.css or shared/icons.js); that is not tested.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-upgrade/e8-mixed-release.js (real workers; page delayed 4 s; one install file missing so 3.0's worker cannot take over)
  2. weak signal after the release: the page asks for app.js?v=2.8; tabs: today,food,program,exercises,history,settings; Settings says "Overload · v3.0"; food.js plugged in: object
  v2.8's offline copy now holds: ... "connector.js?v=2.8":"3.0 text","app.js?v=2.8":"3.0 text" ...
  tap on the Food tab: active tab is food, the screen shows "Settings"
  BROKEN 3. offline, v2.8's stored page runs v2.8's files — it runs "Overload · v3.0" in the v2.8 page

With every script slow as well (`--slow=app.js,sync.js,connector.js,programs.js,backup.js,styles.css`), the first start is pure v2.8, the late answers are stored, and the next start with no signal is the mix (same BROKEN line 3).

What holds on this tree:
/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-upgrade/e10-all-mixes.js: all 14 mixes start with no page error.
/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-upgrade/e14-mixed-workout.js: 7 ok (workout resumes, sets tick, split copy taken).

**Suggested fix**

Root fix: give 3.0's scripts and stylesheet names that v2.8's page never asks for, and leave nothing at app.js, sync.js, connector.js, programs.js, backup.js and styles.css. v2.8's worker then gets 404 and falls back to its stored v2.8 files, so a v2.8 page is always pure v2.8, as the notes assume.
Minimum: let app.js notice at start that it is not in its own page, hide the Food tab, hold Remove, and keep asking for the update.
Either way, run e8 and e14 on the redesigned tree before release. For 3.1, have sw.js serve `?v=<this release>` files from its own cache and never refresh them from the network.

### U3 [medium] The copy "Before removing the old food log" cannot give the log back once the phone holds a single new food day, and removing that day overwrites the copy.

- Reproduced: yes
- Code: backup.js:73 (one id per kind: `'before-' + kind`); app.js:2336 (`take('foodremove')` replaces the previous one); app.js:517-521 keepFoodCopy and app.js:482-486 foodLine (the phone's diary wins as soon as it has one day)

**Sequence**

1. 3.0: Copy my food log, then Remove. The copy "Before removing the old food log" holds the log.
2. v2.8 starts again (half-arrived update, no signal) and the owner logs one food in its Food tab.
3. 3.0 again: the card is back with "1 day, 1 entry".
4. The owner tries Settings > Automatic copies > Before removing the old food log > Restore. The question says "The old food log on this phone (1 day) stays as it is. Food in the copy is not used." Accepting rolls the training data back and still leaves 1 food day.
5. The only way to make the phone hold none is Copy and Remove again. That writes a new copy over the first: it now holds 1 day.
Afterwards the removed log is only in "Before the split into two apps" (as it was at the split; food logged in v2.8 after that is not in it) and in daily copies for at most 7 opened days. The same happens when an Import brings an older diary back after Remove.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-upgrade/e4-remove-flip.js (v2.8 from git on the same storage)
  1. 3.0: copied and removed. Copies hold: before-foodremove:4d before-split:4d day-2026-11-21:4d
  BROKEN restoring the copy "Before removing the old food log" brings the removed log back — the phone holds 1 food day(s) after the restore; the copy held 4
  5. Copied and removed again. Copies hold: before-foodremove:1d before-restore:1d before-split:4d day-2026-11-21:4d
  BROKEN the copy "Before removing the old food log" still holds the log removed the first time — it now holds 1 food day(s); the first removal took 4

The same two BROKEN lines with real service workers and v2.8 restarting by itself offline:
/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-upgrade/e7-real-worker-flip.js

**Suggested fix**

Keep every removal's copy: give each its own id (`before-foodremove-<ms>`), or do not replace a stored one that holds days the new one lacks. When the copy being restored is of kind foodremove or split, bring its diary back by merging it with the phone's days (union by day and entry id, the phone winning for an id both have) instead of dropping it, and say so in the question.

### U4 [low] On a phone whose localStorage is full, "Copy my food log" and "Save as a file" say they worked but nothing is noted, so the card stays at "Not copied yet." and Remove, the one action that would free the room, is never offered.

- Reproduced: yes
- Code: app.js:368 (setBackupInfo swallows the failed write); app.js:2229-2230 and 2236-2237 (the toast is shown whether or not the note was stored); app.js:2295 (Remove needs the stored note)

**Sequence**

1. localStorage is full to within about 100 characters (the state where the "storage is full" banner appears).
2. 3.0 starts; the data and the split copy are fine, but `split.at` cannot be written.
3. Copy my food log: the clipboard gets the text and the toast says "Food log copied", but the card says "Not copied yet." and Remove is not offered. Save as a file behaves the same.
4. Reset and Import keep the food log, so they do not shrink it either. The owner has to delete training data before the hand-over can be noted.
The owner is at roughly 0.7 of 2.5 million characters, so this is not close today.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-upgrade/e2-storage-full.js (stand-in quota: setItem throws once the total passes what v2.8 left plus 20 characters)
  ok first start: the data is as v2.8 left it — save failed banner: false
  split noted in overload.backup: null
  after Copy my food log: toast "Food log copied. Open Fuel and tap Paste from Overload."; clipboard holds 61404 chars
  BROKEN after a successful copy the card says so — Not copied yet.
  BROKEN Remove is offered after the copy (the only way to free the food log's 296 KB)
  BROKEN after Save as a file the card says so

**Suggested fix**

Let setSplit report whether the note was stored. When it was not, keep it in memory for the session so the card and Remove work (Remove frees the room and the note can then be written), and do not show a success toast the card contradicts.

### U5 [low] "Save as a file" tapped twice and then cancelled is noted as saved: the card says "Saved as a file today." and offers Remove.

- Reproduced: yes
- Code: app.js:2024-2041 (shareFile: every failure of navigator.share except AbortError falls through to the download and returns true); app.js:2233-2237 (saveFoodFile records `filed` on true)

**Sequence**

1. Settings > Food > Save as a file, tapped twice.
2. The first tap opens the share sheet. The second share() is rejected with InvalidStateError, shareFile falls through to the download link and returns true, and `split.filed` is written while the sheet is still open.
3. The owner cancels the sheet.
4. The card reads "Saved as a file today." and Remove is offered.
Remove still asks twice and keeps its safety copy.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-upgrade/e12-file-double-tap.js
Chromium has no share sheet, so navigator.canShare and navigator.share are stand-ins that follow the Web Share standard (pending while open, a second call rejected with InvalidStateError, cancel rejects with AbortError).
  what happened: share sheet opened with overload-food-2026-11-21.json -> second share(): InvalidStateError -> sheet cancelled: AbortError; downloads started by the fallback: 1
  BROKEN the share sheet was cancelled: nothing is noted as saved — overload.backup.split.filed = {"at":1795311600255,"hash":"hmojr31nswhzh.6y9"}
  BROKEN the card does not say "Saved as a file today."
  BROKEN Remove is still not offered — Remove buttons: 1
Control (`--once`, one tap and a cancel): 4 ok, nothing noted.
In Chromium the fallback does start a download. Whether an iPhone Home Screen app gives the owner a file from that link while the sheet is open could not be run here.

**Suggested fix**

Ignore a second tap while a share is open. Treat InvalidStateError and NotAllowedError like a cancel (return false). Record `filed` only when share() resolved, or when the download is the only route because the phone has no canShare.

### U6 [low] Once the connection to the copy store is lost in a session, "Remove the old food log" answers "The safety copy could not be stored... Try again" every time until the app is restarted.

- Reproduced: yes
- Code: backup.js:13-40 (the opened database is kept for the whole session; it is forgotten only when the open fails or on versionchange; no onclose handler; a failed transaction in run(), backup.js:42-51, does not reset it); app.js:2338 (the message)

**Sequence**

1. 3.0 starts and backup.js opens `overload-copies` once.
2. The connection dies. An iPhone is known to do this to a Home Screen app that comes back from the background ("Connection to Indexed Database server lost"); I could not produce that here.
3. Every later take() in the session fails: Remove says "Try again" and trying again never works. The copies before Reset and Import are skipped silently too, as in v2.8.
4. After closing and reopening the app, Remove works.
Nothing is removed without a copy, so no data is at risk from Remove.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-upgrade/e6-remove-half.js, case (d). The lost connection is simulated by closing the open database from outside.
  BROKEN (d) after the copy store's connection was lost, "Try again" works at some point in the same session — The safety copy could not be stored, so noth / The safety copy could not be stored, so noth / The safety copy could not be stored, so noth
  (d) after restarting the app: Old food log removed from Overload

**Suggested fix**

In backup.js (both copies: root and fuel/), forget the opened database when a transaction cannot be started or fails, and on the database's close event, so the next call opens it again. Retry take() once after reopening.

### What held

- Odd stored states: for 10 states (unknown fields at every level, reminders.food on with a connector key, old and odd deletion records, odd diary keys and entries, integer-like food ids, legacy sleepSkip, no food fields, food null, lone surrogates), 3.0's first start stores the same text as v2.8's own start, before-split holds the seeded text exactly, and food, diary and deleted.food are v2.8's bytes after a day of use and two restarts. Ran e1-odd-states.js: 61 ok, 1 flagged that is a Date.now() stamp v2.8 writes too.
- The builders' tests pass on the frozen tree on my ports: train-upgrade 89, train-handover 27, train-replace 21, train-rollback 24, train-rescue 14.
- Split copy when the copy store is slow or failing: unanswered at the first try, the retry 5 s later stores v2.8's text even though 3.0 had saved something else meanwhile; never answering, the next start stores it; a reload 0, 3, 10, 30 or 80 ms into the first start still ends with copy and data equal to the fixture; a full copy store leaves nothing half-written and Remove refuses. Ran e3-split-copy.js: 13 ok, 1 flagged that is my stand-in's own error.
- First 3.0 start under the real v2.8 worker takes the split copy of exactly what v2.8 left; v2.8 restarting by itself offline reads what 3.0 left, including after Remove. Ran e7-real-worker-flip.js.
- Unreadable stored text at the first 3.0 start (cut-off, v: 2, the text null, sleepSkip a number): the text is untouched, kept in .bak and as "Unreadable data", no split copy is made of it, Restore of v2.8's daily copy gives the data back byte for byte, the split is noted afterwards and .bak is cleared. A leftover .bak key and an empty stored text also behave. Ran e15-unreadable.js: 27 ok.
- Remove half-happening: a save that fails after the safety copy removes nothing in memory or storage, notes nothing, and the next working save writes the log back whole; a double tap removes once after two questions. Ran e6-remove-half.js (a) and (b). Case (c), closing the app mid-way, is by reading only: in all four runs the page closed before the removal had started.
- Import with 15 files on 3 kinds of phone (45 runs): Fuel backups and hand-over files are refused, also with an exercises list added; cut-off and throwing files change nothing; wrong-typed files import after a question; the phone's food stays byte for byte whenever it had any; the next start always reads the data and every tab draws. Ran e5-import-matrix.js: 43 ok, 2 flagged that are my check's artefact (a file with the same training data, so nothing to change).
- Back to v2.8 and forward again after each step (first start, hide, copy, file, Reset, Import, Remove, Restore): v2.8 reads the data, writes back the same bytes, every tab draws; 3.0 starts on the same bytes with the split copy untouched. Ran e13-flipflop.js: 18 ok.
- Dates: opened just before and after midnight, a day later in Tokyo, in Kiritimati, 89 and 91 days on, and with the clock set back a year: food and diary byte for byte, deleted.food exactly what the 90-day rule leaves, the card still knows the copy. Ran e11-dates.js: 21 ok.
- A phone full to the brim at the first 3.0 start: the data stays as v2.8 left it, no save-failed banner, the split copy is stored in IndexedDB. Ran e2-storage-full.js (its bookkeeping problem is the fourth finding).
- Bookkeeping in overload.backup.split, by reading and through the runs above: Remove is offered only on a hash match and is re-checked in removeFoodLog; "removed" counts only while the diary is empty. The two ways I found to make the card wrong are the storage-full and double-tap findings.

### Not checked

- Anything on a real iPhone: IndexedDB in a Home Screen app (unanswered open, connection lost after background, quota), the share sheet and whether the fallback download yields a file, the clipboard, and the real localStorage limit. The double-tap and lost-connection findings rest on stand-ins.
- The real Firebase SDK. The cloud effects of the first finding ran against tests/fake-firebase with v2.8's real sync.js; I did not review sync.js beyond what app.js relies on.
- The redesigned markup and CSS, which are not in the frozen tree. In particular 3.0's redesigned app.js inside v2.8's page, which loads only styles.css: run e8-mixed-release.js and e14-mixed-workout.js on the final tree.
- How often a slow page with fast scripts happens on the owner's network. The mechanism is proven with real workers; the frequency cannot be measured here.
- Fuel's side of the hand-over (Paste from Overload, Choose a file, its guard inside Overload's storage) and connector.js beyond checking that settings.reminders and connKey stay unchanged in the saved data.
- The start-up rescue in index.html: I re-ran train-rescue.js (14 pass) and read the script, with no new attack.
- Remove when cloud data arrives during the safety copy: with 3.0's sync.js food never arrives from the cloud, so I could not reach that branch.

## handover

The hand-over holds on its main path. With Overload 3.0's own Copy my food log / Save as a file and Fuel's own Paste / box / Choose a file, Fuel showed for every day exactly what v2.8 (git 3b17963) showed, for the heavy fixture, the light fixture and three generated logs (1 year kg, 500 dirty days lb without targets, 3 years). I found no data loss or corruption in a plausible sequence, and the storage guard held. Five smaller problems are proven below: one medium, four low.

Sizes and times (desktop Chromium, tap to toast):
- Heavy fixture: 61,408 characters on the clipboard (gzip form), about 426,000 in the plain form, 319,056 as a file. Import takes 0.10 to 0.14 s. Fuel stores 319,123 characters, 13% of its 2,500,000.
- Generated 3-year log (13,710 entries): 813,728 characters gzip form, about 3.77 million plain. Import takes 0.27 to 0.47 s. Fuel stores 2,745,106 characters; Today then says "Storage is 110% full".
- Over the browser's real limit: the toast and banner say "Not saved", nothing is half-written, and the next save that works stores everything.

Everything is in /tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-handover/. Run each script with `node <script>` from that folder; they use ports 8610 (frozen tree) and 8611 (v2.8, which rh.js extracts into review-handover/v28 if missing). A script exits 1 when its problem shows. No server is left running.

### H1 [medium] After "Start fresh" in Fuel, a later import quietly drops the favourite star and the owner's corrected label numbers for every food he logged in Fuel in the meantime, and no later import can bring them.

- Reproduced: yes
- Code: fuel/fuel.js:973-977 (planImport `things`: a food id Fuel already holds is skipped whole), fuel/fuel.js:1031 (applyImport)

**Sequence**

1. Fuel: Welcome > Start fresh (Welcome says "You can still bring your log across later, in Settings").
2. During the week he logs his usual foods from the food list. Listed and barcode foods get the same ids as in Overload (u+number, b+barcode). In the script: Oats (a favourite in Overload) and the Quest bar (a favourite, and corrected in Overload to 316.7 kcal per 100 g where the list says 300).
3. Overload 3.0: Copy my food log. Fuel: Settings > Bring food from Overload > paste.
4. The question says "Already in Fuel, left as they are: 2 saved foods". Fuel keeps its plain list copies: 4 of 6 favourites remain, and the bar stays at 300 kcal per 100 g with src usda, so every bar logged from now on counts 180 instead of 190 kcal.
5. A second import leaves them again. "Delete this food" is only offered for custom foods (fuel/food.js:825), so the only way back is to redo the correction and the stars by hand.
This follows SPEC section 4 ("foods and meals by id (Fuel's win)"), but the spec does not name this consequence. On this path the overlap is the norm, because favourites are the foods he logs most. Past days are not affected: all 109 earlier days matched v2.8.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-handover/fresh-then-import.js
  question: ... New here: 1,576 entries on 110 days, 62 saved foods, 3 saved meals, the daily targets, your body weight. | Already in Fuel, left as they are: 2 saved foods.
  PASS  every earlier day (109) shows what v2.8 showed
  FAIL  all 6 favourites are favourites in Fuel: NOT u173904:Oats, rolled, dry ; u1903553:Quest Bar, Cookies & Cream (Fuel has 4)
  FAIL  the bar keeps the numbers he corrected: Fuel has src usda, 300 kcal per 100 g, barcode 793573238467 (Overload: custom, 316.7, barcode 0793573238467)

**Suggested fix**

When both sides hold a food id, merge instead of skipping. Keep Fuel's `used` and `last`. Take `fav` from Overload's copy when Fuel's has none. When Overload's copy is src 'custom' and Fuel's is an untouched list copy (src usda or off), take Overload's numbers, serving and barcode. Say it in the question, for example "2 saved foods updated from Overload: favourite, your corrected numbers".

### H2 [low] Tapping "Copy my food log" (or "Save as a file") on Today removes the whole card at once, including "Get Fuel", so an owner who copies before getting Fuel is told to open an app he does not have and Today no longer says where to get it.

- Reproduced: yes
- Code: app.js:2269 (`today: f.any && !removed && !current && ...`), app.js:2275, app.js:2229-2230 and 2236-2237 (refreshHandover then toast)

**Sequence**

1. Overload 3.0 on Today: the card shows 1. Get Fuel, 2. Copy my food log, 3. Paste.
2. He taps Copy my food log first.
3. The toast says "Food log copied. Open Fuel and tap Paste from Overload." for about 3 s. The card is gone in the same instant, and after a restart too; nothing on Today mentions Fuel any more. The link is only in Settings > Food, and the line that said so was on the card that vanished.
4. The same happens when the paste later fails (clipboard overwritten by Copy link, for instance) and he comes back to copy again.
5. Because the card (about 575 px tall) disappears under the finger, a double tap lands on the exercise row that moves up and opens "Edit exercise".
This is SPEC 3.3's rule ("on Today until dismissed or done") taken literally; the dead end is its consequence.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-handover/today-card.js
  Today before: card true, Get Fuel link ["x-safari-https://127.0.0.1:8610/fuel/"]
  toast: "Food log copied. Open Fuel and tap Paste from Overload."
  Today after the tap: card false, Get Fuel link [], the word Fuel anywhere on Today: false
  FAIL  after a restart Today offers the way to get Fuel (card false, mentions Fuel: false)
/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-handover/doubletap.js
  second tap 300 ms after the first: lands on edit-ex "Hip Thrust4 × 8–12 @ 250 lb · goal 12›" -> ... sheet open: true ("Edit exercise")

**Suggested fix**

After a copy or file, keep a short card on Today in the same place until he hides it: "Copied. Open Fuel and tap Paste from Overload", with Get Fuel, Copy link and Copy again. At the least, make the toast say "Get Fuel is in Settings > Food".

### H3 [low] "Copy my food log" hands over the body weight and theme as they were when the card was drawn, so a weigh-in saved in the same session does not reach Fuel, while "Save as a file" carries the new one.

- Reproduced: yes
- Code: app.js:2211-2217 (prepareFoodText keeps the text while the food+diary hash is unchanged), app.js:2173 (the hash covers food and diary only), app.js:2182-2188 (the payload also holds bodyweight, settings, deleted.food, madeAt), app.js:2219

**Sequence**

1. Morning: Overload 3.0 opens on Today. The card is drawn and the clipboard text is prepared, with yesterday's weigh-in (183.6).
2. He saves the morning check-in (179.4) on the same screen and changes Appearance to Light.
3. He taps Copy my food log. Food and diary did not change, so the prepared text is reused.
4. Fuel > Settings > Body weight shows 183.6 and the protein guide uses it; Fuel takes the dark theme.
The same staleness applies for as long as the page stays open (an iPhone can keep the app for days). `madeAt`, shown in Fuel's question as "made ...", is also the drawing time, not the tap.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-handover/stale-weight.js
  Overload now: latest weigh-in {"date":"2026-11-21","weight":179.4}, theme light
  clipboard payload: bodyweight [{"date":"2026-11-20","weight":183.6}], theme dark
  file payload:      bodyweight [{"date":"2026-11-21","weight":179.4}], theme light
  FAIL  Fuel > Settings > Body weight shows 183.6 (Overload's latest is 179.4)

**Suggested fix**

Key the prepared text on everything the payload holds: the food hash plus JSON of the latest weigh-in, units, theme and deleted.food. The check-in and Settings already redraw the card, so warmFoodText would then prepare a new text ahead of the tap.

### H4 [low] An entry whose id sits on two days in Overload's data arrives in Fuel on the first day only, so the second day shows less than v2.8 did.

- Reproduced: yes
- Code: fuel/fuel.js:963-970 (planImport: `have` is one set of ids across all days; the second occurrence counts as "already here")

**Sequence**

1. Overload's diary has the same entry id on 2026-11-17 and, with an edited amount, on 2026-11-18. Versions 1.6 to 2.4 wrote this when a logged food was opened before midnight and saved after it (git 81aade2 food.js:488 `day = dayKey()`; fixed in v2.5, b6d73b3 food.js:509). v2.8 keeps and shows both.
2. Overload 3.0: Copy my food log. Fuel at Welcome: Paste from Overload.
3. Fuel imports 1,576 of 1,577 entries. The question for an empty Fuel says "Already in Fuel, left as they are: 1 entry".
4. 2026-11-18 shows 2,152 kcal and 13 entries where v2.8 showed 2,362 and 14.
For this owner the chance is small: the Food tab shipped on 2026-09-27 (v1.6) and the midnight fix on 2026-09-29 (v2.5).

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-handover/dup-id.js
  PASS  v2.8 keeps the entry on both days; it shows 2026-11-17: 2,534 / 2,400 kcal, 15 entries; 2026-11-18: 2,362 / 2,400 kcal, 14 entries
  Fuel asked: ... New here: 1,576 entries on 110 days ... | Already in Fuel, left as they are: 1 entry.
  FAIL  ... 2026-11-18 kcalLine: v2.8 "2,362 / 2,400 kcal" / Fuel "2,152 / 2,400 kcal" ;; ... 2026-11-18 entries: v2.8 "14" / Fuel "13"
  FAIL  Fuel holds 1576 entries; Overload holds 1,577

**Suggested fix**

Count an entry as "already here" only when Fuel holds that id on the same day: key the set by day + id. Deletion records stay by id.

### H5 [low] Entries without an id are added a second time by a later copy when their place in the day's list changed in Overload.

- Reproduced: yes
- Code: fuel/fuel.js:163 (the made-up id is hash(day # position # entry)), fuel/fuel.js:151-160 (a missing time is derived from the entry before it and is part of the hashed text)

**Sequence**

1. A day in Overload has three entries, the second and third without an id. v2.8 never writes such entries; this needs a hand-edited or damaged save.
2. Copy A into Fuel: correct, and the same copy again adds nothing.
3. In Overload the first entry of that day is deleted, as v2.8's Remove does, and a food is logged on another day.
4. Copy B into Fuel: the two entries get new made-up ids because their positions moved, and are added again. The day shows 5 entries and 599 kcal instead of 3 and 436.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-handover/noid-shift.js
  PASS  copy A: 2026-11-15 in Fuel 436 kcal, 3 entries (v2.8: 436 kcal, 3)
  PASS  copy A again: nothing new
  after copy B: toast "Brought in 3 entries on 2 days."
  FAIL  copy B: 2026-11-15 in Fuel has 5 entries, 599 kcal ...: Egg, scrambled 273 | Whole wheat bread 161 | Coffee, black 2 | Whole wheat bread 161 | Coffee, black 2

**Suggested fix**

Make the id from the day and the entry's own content as it arrived (before a time is filled in), plus a counter for identical twins on that day, not from its position.

### What held

- Every day equal to v2.8, real code on both sides (e2e-roundtrip.js): heavy fixture 110 days, light fixture 4, generated 366 days kg, 449 dirty days lb without targets, 1,096 days; each by clipboard gzip form, plain :0: form and file. Calorie line, left, protein, carbs, fat, entry count, per-meal subtotals and every row matched v2.8; all checks passed.
- Saved foods, favourites, recents, last amounts, barcodes, custom foods, saved meals and targets equal v2.8 on all five logs and three routes (same script). Only data differences: `usda: null` is dropped and entries without an id get one.
- Names with accents, emoji, quotes, HTML, right-to-left text, tabs and line breaks came through both encodings unchanged and drew without error (generated logs in e2e-roundtrip.js).
- Overload 3.0 leaves food and diary in its own storage byte for byte after Copy and Save as a file, and the clipboard text holds them exactly as v2.8 stored them (e2e-roundtrip.js).
- Size: a 3-year log (813,728 characters) imports by a real Control+V paste into the box in 0.2 s (real-paste.js).
- Over the storage limit (limit.js): at Welcome the toast and banner say "Not saved", there is no "Brought in", nothing is written and a restart shows Welcome again; with own data the stored text stays unchanged and the next save after room is freed stores all 1,578 entries.
- Damaged and wrong input (damaged.js, 34 inputs): cut or altered gzip and plain texts, the text twice, curly quotes, zero-width space, a link, cut JSON, PNG, empty file, 3 MB of zeros, CSV and a sync note are all refused with a message and no change. Line breaks, spaces, tabs and non-breaking spaces inside the data, a BOM, UTF-16, a v2.8 backup (pasted or file) and the text saved as .txt are read correctly. A good import still works afterwards.
- Fuzz (fuzz.js): 500 parseable payloads with random fields replaced by junk (two seeds; hand-over payload, Fuel backup, full Overload state), every question answered Yes: 0 unexpected exceptions, 0 page errors, Fuel's state kept its rules and still drew.
- Order and repetition with v2.8 running in between (seq-order.js): a double tap on Paste asks one question; the entry logged in v2.8 after copy A arrives with copy B; the entry edited on both sides keeps Fuel's version; the entry deleted in Fuel stays deleted; A after B says "Nothing new"; Overload's card returns on Today saying the log changed. An entry deleted in v2.8 after the first copy stays in Fuel, as the spec says.
- A Fuel backup as input (fuel-backup-roundtrip.js): into the same Fuel nothing changes; into a new Fuel, as file and as pasted text, the saved state equals the exported one including all three kinds of deletion records; Overload's copy afterwards brings nothing back.
- Storage guard inside the installed Overload (guard.js part 1, navigator.standalone true): after tapping every control twice, background, pagehide, save, setState, safetyCopy and a reload, Overload's four keys and its overload-copies database are byte for byte the same, nothing new is stored, no cache, and Overload starts afterwards. Nothing can be typed there, so no food can be lost.
- Shared storage in an ordinary browser (guard.js part 2): Bring it from Overload on this device, logging, background copy, Reset, Restore, Fuel's own unreadable-data screen and Start fresh never changed an overload.* key or copy; no connector key, exercises or workouts reached Fuel's keys.
- Body weight and units (e2e-roundtrip.js, units.js): at Welcome units and weight arrive as they are, kg and lb, and the protein guide text equals v2.8's. After Start fresh, 83.3 kg arrives as 183.6 lb, 183.6 lb as 83.3 kg in a Fuel set to kg, and a weight set in Fuel is kept.
- The builders' tests for this area pass on the frozen tree on my ports: tests/fuel-import.js 94 of 94 (8612), tests/train-handover.js 27 of 27 (8613), tests/fuel-guard.js 15 of 15 (8614).

### Not checked

- Anything on a real iPhone: the Paste bubble of navigator.clipboard.readText(), whether the clipboard takes 61,000 or more characters, the share sheet branch of Save as a file, the x-safari-https link, and whether a Home Screen app really starts with empty storage. Chromium only here.
- The cloud route of the hand-over (signing in to Fuel, alone or combined with a paste). I did not run tests/fuel-sync.js or the fake Firebase.
- Service workers during the hand-over (a reload while a question is open, Fuel's first start offline). All my runs had workers blocked.
- "Remove the old food log" and what follows it (safety copies, v2.8 afterwards, Restore). I only read that code. By reading backup.js's fixed id 'before-foodremove', a second Remove after v2.8 logged again would overwrite the first safety copy; 'before-split' would still hold the log. Not run.
- A real export from the owner's phone. All data was v2.8 fixtures or generated; the two odd shapes I found (an id on two days, entries without id) were made by hand.
- The real storage limit of an iPhone Home Screen app. Chromium allowed about 5.24 million characters here.
- The redesign: all runs were against the frozen tree d2cc29b with its current markup; my scripts use the builders' selectors and will need the same updates as their tests.

## sync

I attacked cloud sync with three kinds of client on one account (v2.8, Overload 3.0, Fuel 3.0), using the tree's own fake Firebase and helpers. Before writing anything new I re-ran the existing tests on my ports: fuel-sync 52/52, train-sync --only=small 139/139. No server was started and nothing is left running.

My scripts and their outputs are in /tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-sync/: h.js, r1 to r9 and out-*.txt. The folder also holds common.js, q1-*.js, r1-note-outlives.js, r2-fuel-note.js and r3-three-clients.js. I did not write those; another reviewer seems to share the folder.

Six findings, most severe first:
1. **(High, since v2.8, not fixed by 3.0.)** A second phone, on v2.8 or 3.0, that comes back after weeks and is opened without signal sends its whole old core, even though nothing was changed on it. Every phone then takes that old core, so settings and the program are reverted. Exercises and next-time weights are in the same core, so they would go back too (not checked separately).
2. **(Medium.)** The builder's hazard is real in the training app. A sync note left next to missing saved data deletes every workout in the account and on the second phone, and replaces the core. None of the app's own routes create that state, so the trigger is outside the app. The fix is one line in load(). Fuel's guard against the same hazard has a timing hole.
3. **(Medium.)** In Fuel, Reset and Restore with a second signed-in phone do not do what the question promises. The whole log comes back on both phones and in the account, so Restore cannot undo a mistaken import.
4. **(Medium.)** Overload's hand-over card says "Your whole food log is in your account. Signing in to Fuel … brings it across too." It keeps saying this after Fuel has already signed in, and Fuel never gets food that v2.8 logs afterwards.
5. **(Low.)** The training builder's item 1 is real: with no offline cache, the 3.0 phone's old weigh-in overwrites a correction made on the other phone.
6. **(Low, same in v2.8.)** Overload's Reset with a second phone signed in leaves every weigh-in and night in the account, although the question says the training data there is erased.

What held:
- Fuel's first sign-in when the first read fails halfway.
- Switching to another account and back: nothing deleted.
- Overload 3.0 never writes below foodDays.
- firestore.rules allows Fuel's two new places.

### S1 [high] A second phone (v2.8 or 3.0) opened without signal after some weeks, with nothing changed on it, reverts the training settings and program on every phone and in the account.

- Reproduced: yes
- Code: app.js:293-298 (normalize drops deletion records older than 90 days at every load, so the phone's core no longer matches its note); sync.js:286 and 244 (the cached snapshot counts as 'seen', so push sends the whole stale core); v2.8 sync.js push (no guard at all)

**Sequence**

1. Phone A (3.0, used daily) and phone B share an account. A deletion record exists on B (for example a deleted weigh-in). 2. B is not used for a while; meanwhile A changes the rest time and renames a program day. 3. Once that record is more than 90 days old, B is opened in a gym without signal. Nothing is touched. B's load drops the expired record, so B's core differs from its note. 4. The cached core snapshot arrives, and B queues its whole old core. 5. When signal returns, the queued core lands. A is not 'ahead', so it takes B's old values for every core key. That makes it worse than the limit documented in sync.md 1.10.2 and build-notes: B made no edit at all, and the changes A made to any key are lost, not only one thing edited on both phones.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-sync/r9-returning-phone.js (out-r9-v28.txt, out-r9-v30.txt). Same result with B on v2.8 and on 3.0:
# account after A's changes: restSec 150, day 1 "Renamed on A"
# B opened offline; queued: [{"type":"set","path":"users/U1/meta/state"}]
# writes: 1: B set meta/state
# account now: restSec 120, day 1 "Chest & Back" | A: restSec 120, day 1 "Chest & Back"
FAIL  B (3.0), opened after 91 days without signal and not touched, does not revert A's settings and program

**Suggested fix**

In the root sync.js, allow the first core upload of a session only after the server's own core has been seen and merged, not a cached snapshot. With includeMetadataChanges false that transition is never delivered, so either do one getDocFromServer(metaRef()) and merge before the first core push, or listen with includeMetadataChanges: true and wait for !fromCache. Also stop expired-record pruning alone from counting as a local change: compare the core without records older than 90 days, or prune only inside push. v2.8 phones keep this behaviour; nothing in 3.0 can change that.

### S2 [medium] Training app: a sync note left in storage next to missing saved data makes the next start delete every workout in the account (and on the other phone) and overwrite the core with a fresh install's. Fuel's guard against the same thing fails when the SDK loads late.

- Reproduced: yes
- Code: app.js:195 (load: no saved data -> seedState, the note is kept); app.js:2654 (the fresh state is saved at start, before the sync module runs); sync.js:336-342 (known-phone path), sync.js:251-253 (push deletes every noted workout that is missing); fuel/fuel.js:99 (Welcome keeps the note); fuel/sync.js:69-70 and 479 (noteTrusted is read when the module runs, after its gstatic imports)

**Sequence**

Overload: A is signed in on 3.0 with a note; phone B is signed in too. overload.state.v1 goes missing while the note and the Firebase sign-in stay. A opens: load() starts from the fresh default state and saves it. sync.js takes the known-phone path, push deletes all 3 workouts and sets meta/state from that fresh state, and B loses its 3 workouts as well. v2.8 does the same.
Which of the app's own routes can leave a note next to missing data? None. Unreadable data and Reset while signed out remove the note (run). Import and Restore use the same forgetCloudIfSignedOut (by reading). Sign-out keeps the note but also the data. A failed save keeps the old data and does not write the note. So the trigger is the state key alone going missing outside the app.
Fuel: the same state with the sign-in remembered. Because fuel.js draws Welcome before the module's imports arrive, he can tap Start fresh first. fuel.state.v1 then exists when noteTrusted is read, the leftover note is believed, and all 4 fuelDays are deleted.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-sync/r1-note-without-data.js (out-r1.txt):
# 3.0 as it is: writes after reopening A: 5: A set meta/state, A delete workouts/x9ffu9osxdxz, A delete workouts/npc8chszovkj, A delete workouts/77lufjyv0h4p, ...
FAIL  3.0: ... -- 3 workout deletes; account 3 -> 0 workouts; second phone B 3 -> 0
FAIL  v2.8: the same -- 3 workout deletes
FAIL  3.0 with Fuel's guard in sync.js: nothing deleted ... -- 3 workout deletes (app.js saves before the module runs)
PASS  patched 3.0: nothing deleted, and the account's workouts come down to A -- 0 deletes; A holds 3
PASS  routes: unreadable data at start removes the note / Reset while signed out removes the note / sign-out keeps the note AND the data
/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-sync/r8-fuel-guard-timing.js (out-r8.txt):
PASS  SDK at once: ... 0 deletes
# SDK late: writes after Start fresh: 5: B set meta/fuel, B delete fuelDays/2026-11-15, ... ; account now 0 days
FAIL  SDK late (Start fresh tapped before the module ran): nothing deleted -- 4 deletes; account 4 -> 0 days

**Suggested fix**

Smallest safe fix, already tested in a patched copy (tree-fix-r1): in app.js load(), when nothing is stored, remove the note before returning seedState(): `if (!raw) { try { localStorage.removeItem(SYNC_KEY); } catch (e) {} return seedState(); }`. The next sign-in is then a first link, which downloads and deletes nothing. A Fuel-style noteTrusted guard in the root sync.js does NOT work, because app.js saves a fresh state before the module runs (shown). Make the same one-line change in fuel/fuel.js load() at the Welcome branch; Fuel's noteTrusted guard can stay as a second layer. A v2.8 run on such storage before 3.0 has run cannot be protected.

### S3 [medium] Fuel: Reset and Restore while a second Fuel phone is signed in do not erase or replace the account's food log as the question promises. The log comes back on both phones, so a mistaken import cannot be undone with Restore.

- Reproduced: yes
- Code: fuel/fuel.js:876-885 (cloudNote, resetAll), fuel/fuel.js:390-407 (restoreCopy, replaceState: no deletion records written); fuel/sync.js:349-357 (a removed day keeps every entry without a record and is uploaded again), fuel/sync.js:212-219 and 403-406 (saved foods and meals are a union)

**Sequence**

1. A starts fresh, logs 2 foods and creates the account; B signs in. 2. On A he pastes a food log by mistake (4 days, 13 saved foods). 3. He restores 'Before import' on A. The question says '…the food log in your account (owner@example.com) is replaced too.' 4. A deletes the 3 imported days in the account. B gets 'removed', keeps the entries because it has no records for them, and uploads them again; A takes them back. 5. The same happens with Reset ('…is erased too'): A, B and the account keep all 4 days and 13 saved foods; only the targets are cleared. The builder reported this half of it for Reset. Restore is affected in the same way, and the phone that was reset or restored gets the log back too.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-sync/r2-fuel-restore-two-phones.js (out-r2.txt):
# Restore question: ... You are signed in to cloud sync, so the food log in your account (owner@example.com) is replaced too.
# A right after the restore: days 2026-11-21
# writes after the restore: 10: A set meta/fuel, A set fuelDays/2026-11-21, A delete fuelDays/2026-11-15, A delete fuelDays/2026-11-18, A delete fuelDays/2026-11-20, B set meta/fuel, B set fuelDays/2026-11-21, B set fuelDays/2026-11-15, B set fuelDays/2026-11-18, B set fuelDays/2026-11-20
FAIL  Restore "Before import" with a second phone signed in: ... -- 4 of 4 imported days are back on A, 4 in the account
# after the reset: A days 4, A saved foods 13, A targets {"kcal":null,...} | B days 4 | account days 4, account saved foods 13
FAIL  Reset with a second phone signed in: A and the account are empty afterwards -- A 4 days, account 4 days

**Suggested fix**

Either make the text true by having Reset and Restore write deletion records (deleted.food, foods, meals at Date.now()) for every entry, saved food and saved meal that disappears from the phone, so other phones drop them through the core. Or change both questions to say that other phones signed in to this account keep their copy and send it back, and to sign them out and reset them first. Restore also needs a rule for records the other phone holds for entries the copy brings back.

### S4 [medium] Overload 3.0's hand-over card says 'Your whole food log is in your account. Signing in to Fuel with the same email brings it across too' after Fuel has already signed in, when Fuel will never get food that v2.8 logs afterwards.

- Reproduced: yes
- Code: app.js:2289-2293 (card line chosen by foodInCloud alone); sync.js:443-449 (foodInCloud checks the note against the phone and never knows whether Fuel has already bootstrapped); fuel/sync.js:502 (meta/state and foodDays are read only while meta/fuel does not exist)

**Sequence**

1. A is linked on v2.8 and updated to 3.0; the card says the whole log is in the account. 2. Fuel, in its own Home Screen storage, signs in, brings the 4 days and creates meta/fuel. 3. v2.8 runs again on A (a half-arrived update), and he logs a food in v2.8's Food tab; v2.8 uploads foodDays/2026-11-21 and notes it. 4. Back on 3.0, foodInCloud is still true and the card repeats the claim. 5. Fuel, reopened, does not have the entry and never will, because it no longer reads Overload's copy. Remove is not offered without a copy or file, so nothing is lost, but the card steers him away from Copy my food log.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-sync/r3-card-claim.js (out-r3.txt):
# Fuel signed in: 4 days; meta/fuel exists: true
# v2.8 wrote: 1: A set foodDays/2026-11-21
# 3.0 card now: Using cloud sync? Your whole food log is in your account. Signing in to Fuel with the same email brings it across too. (foodInCloud true)
# Fuel, reopened: has the v2.8 entry: false; Overload's foodDays/2026-11-21 has it: true
FAIL  the card does not tell him signing in to Fuel brings the whole log across while Fuel never will get part of it

**Suggested fix**

Drop the 'whole food log is in your account … brings it across too' sentence and always point to Copy my food log or Save as a file, mentioning sign-in only as an extra. Alternatively, show it only while the old food copy has not changed since split.at and Fuel cannot have bootstrapped yet, which this app cannot know without reading meta/fuel.

### S5 [low] Training builder's item 1, confirmed: when the first core snapshot comes from the server (no offline cache), a 3.0 phone's old weigh-in (or night) for a date both phones have overwrites a correction made on the other phone.

- Reproduced: yes
- Code: sync.js:170 (localAhead = hash(coreJson(local)) !== known.core, where coreJson uses the phone's own food part while cloudFood is still undefined); sync.js:180-181 (bodyweight and sleep: the phone's entry wins when localAhead)

**Sequence**

1. A (3.0) and B (v2.8) share an account. 2. B changes a food target while A is open; A's note now hashes a core with B's food part, while A's own old food copy stays as it was. Any food logged on B has the same effect. 3. A is closed; B corrects the 2026-11-21 weigh-in from 170.2 to 168.8. 4. A opens with no offline cache. The first snapshot differs from the note, and A counts as 'ahead' only because its frozen food differs. A's 170.2 wins and is sent, and B takes it back. With the cache, B's correction stands. When there is no persistent cache (IndexedDB unusable, the SDK falling back to memory), this happens at every start.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-sync/r4-first-snapshot-weighin.js (out-r4.txt):
PASS  with the offline cache: B's corrected weigh-in stands everywhere -- account 168.8, A 168.8, B 168.8
# no cache: after A opened: writes 1: A set meta/state; account 170.2, A 170.2, B 170.2
FAIL  without the offline cache: B's corrected weigh-in stands everywhere -- account 170.2, A 170.2, B 170.2 (B wrote 168.8, A had 170.2)

**Suggested fix**

Work out localAhead without the food part. For example, keep in the note an extra hash of the core without food and deleted.food (v2.8 keeps unknown fields of overload.sync.v1) and compare that. Or, while cloudFood is undefined, build the comparison core with the incoming remote's food part substituted.

### S6 [low] Overload: Reset while signed in, with a second phone signed in, leaves every weigh-in and night in the account and brings them back to the reset phone, although the question says the training data in the account is erased too. v2.8 behaves the same.

- Reproduced: yes
- Code: app.js:2103-2116 (cloudNote, resetAll: no deletion records); sync.js:180-181 (bodyweight and sleep are unions by date on the other phone)

**Sequence**

1. A and B (3.0 or v2.8) are signed in. 2. Reset on A; the question ends '…the training data in your account (owner@example.com) is erased too.' 3. A deletes the workouts and sends a fresh core. B unions its 5 weigh-ins and 3 nights back into the core and sends it, and A takes them. Workouts are erased as promised. The same happens with both phones on v2.8.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-sync/r6-overload-reset-two-phones.js (out-r6.txt, out-r6-v28.txt, out-r6-allv28.txt):
# A right after Reset: 0 weigh-ins, 0 nights
# writes: 5: A set meta/state, A delete workouts/..., A delete workouts/..., A delete workouts/..., B set meta/state
# after rest: account 0 workouts, 5 weigh-ins, 3 nights | A 0 workouts, 5 weigh-ins, 3 nights | B 0 workouts, 5 weigh-ins
FAIL  Reset with a second phone signed in: no weigh-in or night is left ... (identical with both phones on v2.8)

**Suggested fix**

Have Reset write deleted.bw and deleted.sleep records for every date it removes, which v2.8 phones respect through mergeDeleted. Or reword the question to say that weigh-ins and nights on other signed-in phones come back.

### What held

- Existing tests re-run on my ports: tests/fuel-sync.js --port=8620 52/52 pass; tests/train-sync.js --only=small --port=8621 139/139 pass (run-fuel-sync.txt, run-train-sync.txt).
- Fuel's first sign-in when the read fails halfway (meta/fuel and fuelDays read, then meta/state and foodDays fail): nothing written or queued, saved data unchanged, no note, no listener, status 'Nothing was uploaded; retrying'; the retry 15 s later brings and uploads the 4 days. r5-fuel-halfway-read.js, with fake-halfway/route.js (a copy of the fake that can fail only matching server reads).
- Signing out and into a second account that already holds data, then back, for Overload 3.0 and Fuel: nothing deleted in either account, no write below foodDays, nothing written by Fuel under meta/state. The accounts end up holding each other's data, which is v2.8's first-link merge. r7-other-account.js.
- The app's own routes never leave the training note next to missing data: unreadable data and Reset while signed out remove the note, sign-out keeps both (r1 'routes' checks). Import and Restore use the same forgetCloudIfSignedOut (by reading app.js:500-504, 2097-2100).
- Fuel's noteTrusted guard holds when the SDK arrives before Welcome is used (r8 run 1: 0 deletes).
- firestore.rules as in the repo: `match /users/{uid}/{document=**}` with the uid check covers users/{uid}/meta/fuel and users/{uid}/fuelDays/{date}, reads and lists included, so no change is needed. The fake enforces the same rule and every Fuel write in fuel-sync and my runs was accepted.
- Overload 3.0 and Fuel on one account: Overload issued no set or delete below foodDays and read nothing of Fuel's; Fuel wrote only meta/fuel and fuelDays in every run (r3, r5, r7 and the existing tests).
- Training builder's item 2 (a known phone that starts offline on an account with no core document), by reasoning: a known phone implies an earlier online first link, which uploads the core at once (cloudFood = null), and a queued core shows up later as a pending-write snapshot. Only a refused first batch, the app closed within 60 s, then an offline start reaches it. The cost is the core waiting one session; nothing is written wrongly.

### Not checked

- The real Firebase SDK. In particular, the online slow-network form of finding 1: a cached snapshot followed by the server's arriving more than 1 s later should do the same as the offline start, but the fake answers at once. Also whether the SDK falls back to a memory cache on iOS, which would make finding 5 happen at every start.
- Whether an iPhone can lose overload.state.v1 or fuel.state.v1 while keeping the .sync.v1 key and the Firebase sign-in, which is the trigger of finding 2. I found no route inside the apps.
- tests/train-sync.js with the main fixture and --base=v28; I ran only the small fixture.
- A Fuel first upload of more than 399 days (several batches, one refused), and two Fuel phones running the legacy bootstrap at the same moment.
- A stale replayed 3.0 core reverting the legacy food part before Fuel's first sign-in (documented in sync.md 3.4).
- A failed save (storage full) during an Import or Restore while signed in. By reading, the note is not written while saveFailed, but the cloud then holds the imported data while the phone keeps its old data; not run.
- Whether finding 1 also reverts exercises added on A and next-time weights (presc) in the same run. Only settings.restSec and the program day name were measured; the others live in the same core key set.

## offline

The update, the start-up rescue, bump.sh, the install lists and the manifests mostly hold. Every way a v2.8 owner can be caught by the update (idle, mid-workout, typing, on the old Food tab) keeps all ticks and saved data. Every half-arrived combination starts, or says 'did not finish starting' where the spec intends. The 3.1 rehearsal with shared files and a cut network holds for both apps. Overload's manifest is unchanged, and Fuel is a separate installable app.\n\nOne high finding. Both workers fetch network-first and store every answer under the address that was asked for, and GitHub Pages ignores the ?v= query. So a slow, weak-signal start after a release replaces the stored older release's scripts with the new ones under the old names, and runs that mix offline. With 3.0's app.js next to v2.8's sync.js, the hand-over card's Remove deleted every foodDays document in the account: 4 of 4 with the fake Firebase, 0 in the control run. Meanwhile the question tells the owner the cloud is not changed.\n\nThree smaller findings:\n- An open v2.8 sheet's typed values are lost when the 3.0 worker takes over (medium).\n- Fuel's first install, if it fails once, is never retried on resume (medium).\n- Tapping 'Update ready' mid-workout drops the running timer (low).\n\nScripts and outputs are in /tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-offline/. I rebuilt h.js there, the helper the earlier s1, s3 and s6 scripts use, and checked it with them. No server is left running and the frozen tree is unchanged.

### O1 [high] After a weak-signal first start, the phone keeps a copy that mixes two releases. When that copy holds 3.0's app.js next to v2.8's sync.js, the card's 'Remove the old food log' deletes every foodDays document in the cloud account, while its question says the cloud log is not changed

- Reproduced: yes
- Code: sw.js:89-96 and fuel/sw.js:130-137 (every ok network answer is stored over the entry the install put there, under the request's ?v= address); v2.8 sw.js:84-88 (the same code, on the phone now); sw.js:42-49 and fuel/sw.js:59-66 (the install checks the ?v= of the page only, never the scripts); app.js:2327-2345 removeFoodLog (does not check which sync module is running, and says 'The food log in your cloud account is not changed')

**Sequence**

1. The phone runs v2.8 under its worker (overload-v23) with cloud sync signed in. 3.0 is published.
2. The owner opens Overload on a weak signal. The page takes more than 3 s, so the v2.8 worker answers with its stored v2.8 page.
3. That page asks for ./app.js?v=2.8, ./sync.js?v=2.8 and the rest. GitHub Pages ignores the query and sends the 3.0 files. The v2.8 worker fetches network-first, so it runs them and stores them over its installed copies under the 2.8 names. It does this even when an answer arrives after its 3 s fallback.
4. The signal drops before every answer is back (here sync.js, which is fetched later) and before the 3.0 worker's install gets through. overload-v23 now holds v2.8's page, 3.0's app.js and v2.8's sync.js. Every offline or slow start runs that mix until the 3.0 install succeeds.
5. The mix shows the 3.0 card 'Food has moved to Fuel'. The owner taps Save as a file, then Remove, then yes and yes.
6. v2.8's sync.js pushes from its in-memory note and deletes every foodDays document the phone no longer has. Offline, the deletes wait in Firestore's queue. A second phone still on v2.8 then drops those days from its own diary (v2.8 sync.js:290-295), and Fuel's first sign-in finds no food days.
The same mechanism has other effects. When every 2.8-named file was overwritten, the phone runs all of 3.0's code in v2.8's page, offline too, and the Food tab button highlights but changes nothing. In 3.0's own workers it recurs at the next release: overload-v24 and fuel-v1 end up holding 3.1's app.js and fuel.js under the 3.0 names and run them offline inside the 3.0 page. The rescue also assumes the stored older release is intact.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-offline/s11-mix-sync.js (fake Firebase from tests/fake-firebase, real workers).
--mode=mix (s11-mix.out):
  '3. ... {"page":"2.8","appRuns":"3.0","syncIs":"2.8 (no foodInCloud)","signedIn":true,"removeOffered":true}'
  '5. deletes under foodDays issued by this phone: ["2026-11-15 (applied)","2026-11-18 (applied)","2026-11-20 (applied)","2026-11-21 (applied)"]'
  '6. foodDays in the account after: 0 of 4'
--mode=control, same flow with sync.js arriving (s11-control.out):
  '5. deletes ... []'
  '6. ... 4 of 4'
/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-offline/s8-mix.js --pair=28-30 --slow-files (s8-28-30-slow.out):
  launch 1 runs 2.8.
  Right after it, 'app.js?v=2.8':'VERSION 3.0' but 'sync.js?v=2.8':'23794 bytes' (v2.8's). After 6 s, 27121 bytes (3.0's).
  '7. launch 2 (no network): ... page 2.8..., runs 3.0, tabs [today, food, ...]'
  '8. ... tap on the Food tab: {"screen":"food" ... "app":"Settings...'
--pair=30-31 --slow-files (s8-30-31-slow.out):
  ''app.js?v=3.0':'VERSION 3.1''
  '6. launch 2 (no network): page 3.0..., runs 3.1'
/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-offline/s8b-fuel-mix.js (s8b.out):
  ''fuel/fuel.js?v=3.0':'VERSION 3.1''
  '4. launch 2 (no network): page 3.0, runs 3.1'

**Suggested fix**

For this release (the v2.8 worker cannot be changed): have sync.js expose its release (for example window.__overloadSync.release = '3.0'; the foodInCloud getter also tells the two apart). In removeFoodLog, while signed in, refuse to remove unless 3.0's sync module is the one running ('Finish the update first: open Overload once with good signal'), and print 'not changed' only in that case. Better still, app.js can compare the v= of its own script tag with VERSION and, when they differ, stay in a safe mode: no Remove, and no Food tab in the stored v2.8 page.
For later releases, in sw.js and fuel/sw.js: answer a same-origin address that carries ?v= from the worker's own cache first, and never write over an entry at run time, so only the install writes versioned entries. In the install, also read the main script (app.js / fuel.js) and check that it says const VERSION = '<RELEASE>', the way pageFits checks the page.

### O2 [medium] A v2.8 sheet with typed but unsaved values (Edit sets, New exercise, Edit day) is wiped when the 3.0 worker takes over, because v2.8 reloads unless a workout is active or a field has focus

- Reproduced: yes
- Code: v2.8 app.js:2399-2404 (on the phone; holds the reload only for activeWorkout() or a focused field); sw.js:50 (skipWaiting) and sw.js:58 (clients.claim), which put the open v2.8 page under the new worker at once

**Sequence**

1. The v2.8 app is open (or resumed from the background) with History > a workout > Edit sets. The owner changes a box (70 to 999) and closes the keyboard, so nothing has focus.
2. v2.8 checks for an update, at start or when the app comes back to the front. The 3.0 worker installs, skips waiting and claims the page.
3. The v2.8 page gets controllerchange. No workout is active and nothing is focused, so it reloads straight away. The sheet and the unsaved 999 are gone, and the page is 3.0.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-offline/s1-states.js --only=C --port=8630 (s1-BC.out):
  '[C] edit-workout sheet open in v2.8, a box changed 70 -> 999, nothing focused'
  '[C] after the 3.0 worker took over: {"loads":3,"versions":["3.0",...],"sheet":false,"pill":false,"screen":"today"}'
  '[C] the typed 999 is anywhere in the saved state: false'
With a focused field (D) or a workout (B) the reload is held and nothing is lost.

**Suggested fix**

In 3.0's sw.js, do not skip waiting while a window that is not a 3.0 page is open. For example, on install send a message to every window and treat any that does not answer within about 1 s as an older release; then stay waiting and let a 3.0 page (when nothing is open in it) or the next cold start activate the worker, using registration.waiting.postMessage. Otherwise accept the behaviour and list it as a known limit.

### O3 [medium] If Fuel's very first install fails once (one of its 19 files does not arrive), bringing the app back to the front never retries it, so Fuel has no offline copy until a cold start with signal, and nothing tells the owner

- Reproduced: yes
- Code: fuel/fuel.js:1245 (visibilitychange calls reg.update() on the registration kept from register(); after a failed first install the browser has removed that registration, so the call rejects silently); fuel/sw.js:56-69 (all-or-nothing install, 2.3 MB)

**Sequence**

1. On its first launch, the new Fuel Home Screen app registers fuel/sw.js. One file of the install list fails (here the wasm answers 503, like a dropped connection), so the install fails and no registration is left.
2. The owner keeps using Fuel online. An iPhone resumes a Home Screen app rather than reloading it, and on each resume the page calls reg.update() on the removed registration: nothing is fetched.
3. Later Fuel is started from cold with no signal (the gym). It does not open.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-offline/s10-fuel-first-install.js --port=8632 (s10.out):
  '1. first visit, one file fails: registrations, caches: {"regs":[],"caches":[]}'
  '2. what the page says about working offline: nothing'
  '3. after three returns to the front with good signal: requests for the worker or its files: []'
  '5. then a start with no network: {"error":"page.goto: net::ERR_EMPTY_RESPONSE ..."}'
  '6. control: a cold start with signal installs fuel-v1: true'

**Suggested fix**

In startWorker's visibilitychange handler (and once a few seconds after an install fails), when reg is missing or has no active, waiting or installing worker, call sw.register('./sw.js', { updateViaCache: 'none' }) again instead of reg.update(). Optionally show 'Offline copy not ready yet' in Settings until reg.active is set.

### O4 [low] Tapping 'Update ready' during a workout reloads the page and drops a running rest (or cardio) timer; the workout and its ticks are kept (pre-existing behaviour, but the pill invites exactly this tap)

- Reproduced: yes
- Code: app.js:1980-2004 (the timer lives only in memory: timer.end and timer.kind); app.js:2363 (the reload action)

**Sequence**

1. The v2.8 page is held under the 3.0 worker during a workout, with the 'Update ready' pill shown.
2. The owner ticks a set, so the rest timer starts, then taps the pill.
3. 3.0 opens on the workout with every tick, but the countdown is gone. A cardio timer would also lose its automatic cardio log when it ends.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-offline/s1-states.js --only=B --port=8630 (s1-BC.out):
  '[B] offline, ticked another set in the held v2.8 page; sets done: 13', then the pill is tapped a few seconds later
  '[B] 3.0 shows the workout in progress: {"finish":true,"ticked":4,"restShown":false}'
  '[B] sets done in the saved state: 13'

**Suggested fix**

Keep timer.end, timer.total and timer.kind in sessionStorage (or on the active workout) and restart the countdown at start when its end is still ahead. Or keep the pill hidden while a timer runs.

### What held

- The builders' worker tests pass on my ports against the frozen tree: tests/train-sw.js --port=8638 gives 34 of 34, tests/fuel-sw.js --port=8639 gives 28 of 28 (outputs in review-offline/run-train-sw.out and run-fuel-sw.out).
- v2.8 open when the 3.0 worker takes over (s1-states.js; s1.out, s1b.out, s1-BC.out). Idle on Today: it reloads into 3.0, food and diary are byte for byte the same, and the before-split copy equals the v2.8 text. Mid-workout with the rest timer running: the reload is held, the pill shows and the timer keeps going. Sets ticked offline in the held page are kept, and 'Update ready' offline opens 3.0 on the workout. Typing: held, and the value submitted in the held page is kept. Old Food tab while typing: held, and food logged in the held page reaches 3.0 and its before-split copy. Nothing ticked or saved was lost in any state.
- Half-arrived updates (s3-matrix.js; s3-root-28-30.out, s3-root-30-31.out, s3-fuel-30-31.out; a combination re-run with the rebuilt h.js). Each of page, worker, main script, other scripts and stylesheets was made old, missing (404) or dropped. In every combination the app started, except a 3.0 page whose app.js failed under v2.8's worker, which shows 'did not finish starting' as SPEC 3.11 intends. The next offline start always started, the update completed once everything answered, and the saved data was unchanged. For a 3.1 page the rescue picks 3.0, never 2.8 for 3.0, and searches only its own app's caches.
- Next release with the redesign's shared files (s9-next-release.js, s9.out). ./shared/ui.css and ./shared/icons.js were added at the marked lines in both pages and both install lists. 'sh bump.sh --check' passes. 'sh bump.sh 3.1' changes exactly the six files, leaves no ?v=3.0, and moves the caches to overload-v25 and fuel-v2. Both apps were walked 3.0 to 3.1 with the network cut during the new worker's install: the old copy stayed whole and the next offline start ran 3.0. When the network went right after the 3.1 page arrived, the rescue ran 3.0 from the stored copies, shared files included (6 files for Overload, 5 for Fuel). With signal back the update completed and 3.1 started offline. Saved data was unchanged and there were no page errors.
- Install lists against what the pages load (s6-lists.js, s6.out). No file the pages reference is missing from the lists, and every listed file is stored. The only extra entries are connector.json and the three Firebase files. Overload 3.0 offline through every tab works. Fuel offline finds listed foods, loads the barcode reader and its wasm, and loads the sync module.
- Manifests (s6.out lines 19-22). Overload's manifest.webmanifest is byte-identical to v2.8's: start /overload/index.html, scope /overload/, no id. Fuel is a separate app: start /overload/fuel/index.html, scope /overload/fuel/, no id, with its own title and icon links.
- Neither worker stores or deletes the other app's files. The root worker leaves fuel/, data/ and vendor/ to the browser. A missing or slow Fuel page under the 3.0 root worker is never answered with the training page. fuel-v1 survives a training release and overload-v24 survives a Fuel release (train-sw.js, fuel-sw.js, s3 caches).

### Not checked

- Anything on a real iPhone or in Safari: which worker controls a page during Fuel's first install, claim and controllerchange timing, how often a Home Screen app is cold-started rather than resumed (this decides how long finding 3 lasts), and whether the share sheet or clipboard flows can be cut by the reload.
- GitHub Pages' real CDN and the browser's HTTP cache: Playwright routing turns the HTTP cache off. My server, like Pages, serves by path and ignores the query. I did not check whether a stale edge can serve old content under a new ?v= address.
- The real Firebase SDK. Finding 1's cloud part ran on tests/fake-firebase. I did not run a second v2.8 phone receiving the foodDays deletes; that it drops those days is from reading v2.8 sync.js:290-295.
- What the redesigned 3.0 app.js does inside v2.8's page (finding 1). The redesigned markup and scripts are not in the frozen tree. The v2.8 page does not load shared/ui.css, shared/icons.js or train.css, so the mix would run the redesigned code without them.
- The push handler and notificationclick (headless Chromium cannot tap a notification).
- A roll-back to v2.8 published over 3.0. By the mechanism of finding 1, the 3.0 worker would store v2.8's files under the 3.0 names until v2.8's worker installs. I did not run it.
- The Firebase files not being in Overload's install list after the update: offline, sync does not load until one online start (s6.out lines 10-13). offline.md and sync.md section 6 already document this, so I did not report it.

## fuel-data

Fuel's data layer mostly holds. I found two medium problems and two low ones, all reproduced; none corrupts data while the owner does nothing unusual.

The two medium problems:
- **Reset can erase without a copy.** It does not wait for its automatic copy. When IndexedDB is not answering, it erases everything (110 days, 1,576 entries in the run) while its second question says "The latest copy stays in Settings > Automatic copies". No copy exists afterwards.
- **Food logged in a Safari tab gets stranded.** The Safari screen keeps telling the owner to add Fuel to the Home Screen and never mentions the food already logged in that tab. The new Home Screen app opens on an empty Welcome that does not mention a Fuel backup either. Without cloud sync, that food stays in Safari storage, which Safari clears after about a week without a visit.

The two low problems:
- Trends is not redrawn when the date changes, so in the morning it still shows yesterday as "Today so far" and last week's averages as "This week".
- After cloud sync brings the log down, the storage meter and the 70% warning read about 0% until the next save or restart (83% was actually used in the run).

What holds:
- The same 19 tap steps in v2.8's Food tab and in Fuel give identical stored food, diary and deletion records, apart from the intended new records for deleted foods and meals.
- food.js differs from v2.8 only in comments, three addresses and three deletion records.
- Loading and saving leaves a v2.8 log unchanged, and unknown fields are kept.
- A markup payload in every text field and id ran no script on any screen or sheet.
- Trends arithmetic matches an independent count in five cases, including two daylight-saving changes.
- Switching units moves the stored weight by 0.1 lb at most, once.
- Nothing can be entered while the app waits at the Add to Home Screen screen.
- Deletion records cannot remove a live entry, food or meal on one phone, and they grow by about 30 characters each.

The reproduction scripts and the v2.8 copy they compare against are in /tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-fuel-data/. Each takes --tree= and --port=, uses ports 8640 to 8646, and leaves no server running.

### F1 [medium] Reset erases the whole food log without keeping a copy when IndexedDB is not answering, even though its second question promises "The latest copy stays in Settings > Automatic copies"

- Reproduced: yes
- Code: fuel/fuel.js:880-885 (resetAll: safetyCopy('reset') is not awaited and its result is never checked; the promise is in the text at 882); fuel/backup.js:17-43 (open gives up after 2 s and take() resolves false)

**Sequence**

1. IndexedDB stops answering. backup.js's own comment says Safari can leave the open request unanswered, and iOS can also drop the IndexedDB connection after the app has been in the background. Settings then already says "Automatic copies are not available in this browser."
2. The owner taps Reset all data and confirms the first question.
3. The second question says "Really erase everything in Fuel? The latest copy stays in Settings > Automatic copies." He confirms, trusting that.
4. The state is replaced and saved. No copy named 'before-reset' exists, and when IndexedDB works again the list of copies is empty. 110 days and 1,576 entries are gone from the phone.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-fuel-data/reset-no-copy.js prints:
  before: 110 food days stored; copies list: "Automatic copies are not available in this browser."
  confirm: ... Really erase everything in Fuel? The latest copy stays in Settings > Automatic copies.
  after: 0 food days stored
  automatic copies once IndexedDB answers again: []
The import question makes the same unchecked promise (fuel.js:1017 and 1029, "A copy of what Fuel holds now is kept first"). That one is harmless because an import only adds.

**Suggested fix**

Do what Overload 3.0's Remove does. Await safetyCopy('reset') and, when it resolves false, do not erase. Instead say that the copy could not be stored and offer Export JSON first. Alternatively, drop the promise from the question when copies are unavailable.

### F2 [medium] Food logged in a Safari tab is stranded once the owner follows the screen's own advice to add Fuel to the Home Screen: nothing tells him to bring it along

- Reproduced: yes
- Code: fuel/fuel.js:505-509 (gateNow: 'install' whether or not this tab holds data), 512-530 (renderGate: same text with or without data), 571-583 (renderWelcome: the 'Choose a file' line at 579 names only Overload's files)

**Sequence**

1. On an earlier visit in Safari the owner tapped "Use it here anyway", brought the log in and logged food there.
2. On the next visit (a new tab) Fuel shows "Add Fuel to your Home Screen" again. It warns that a Safari tab can lose its data after about a week and that the Home Screen app does not. It says nothing about the food already logged in this tab.
3. He follows the steps. The Home Screen app has its own empty storage and opens on Welcome. Welcome offers Paste from Overload and Choose a file ("The food file or a backup saved from Overload"), and mentions neither the Safari tab nor a Fuel backup.
4. Pasting from Overload brings in Overload's old log without the days logged in Safari. Unless cloud sync is on, those days remain only in Safari's storage. Nothing points him there, and Safari clears that storage after about a week without a visit.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-fuel-data/gate-stranded.js prints:
  new Safari tab, screen "install", data in this tab: 7 entries today, 4 days
  mentions the data here / exporting it: false
  Home Screen app, screen "welcome", stored: []
  mentions a Fuel backup or the Safari tab: false

**Suggested fix**

When the Safari tab holds Fuel data (ui.welcome is false at the 'install' gate), say so on that screen and offer Export JSON (the share sheet: Save to Files) before the Add to Home Screen steps. In Welcome, name a Fuel backup under Choose a file, since the import already accepts one.

### F3 [low] Trends is not redrawn when the date changes: back in the morning it still shows yesterday as "Today so far" and last week's numbers under "This week"

- Reproduced: yes
- Code: fuel/fuel.js:638-664 (renderTrends reads todayKey() only when it draws); fuel/fuel.js:1252 (the only visibilitychange handler of the shell refreshes the copy and never redraws). food.js redraws Today over midnight (food.js:1174-1192), but nothing redraws Trends.

**Sequence**

1. The owner leaves Fuel on the Trends tab on Sunday evening and puts the phone away.
2. On Monday morning he opens it again. iOS resumes the page and visibilitychange fires.
3. The chart still ends on Sunday, with Sunday marked as today so far. The hero average and "This week" are still last week's (shown as 1,825, which is now last week). "Days logged 6 of 7" also belongs to last week. It stays like that until he taps a tab.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-fuel-data/trends.js prints, for the case 'Sunday 23:50, LA':
  Trends left open past midnight: last bar is 2026-11-08 (the date now is 2026-11-09)
  back in the morning (hidden, shown again): last bar is 2026-11-08, table: Calories / 2,000 | 1,825 | 1,885 ; ... Days logged | 6 of 7 | 5 of 7

**Suggested fix**

Remember the date the screen was drawn for. On visibilitychange (visible) and on a one-minute timer, call render() when ui.screen === 'trends', no sheet is open and todayKey() has changed.

### F4 [low] The storage meter and the 70% warning read almost empty after cloud sync has brought the log down, until the next save or restart

- Reproduced: yes
- Code: fuel/fuel.js:421-431 (setState stores the text but leaves ui.savedChars unchanged); fuel/fuel.js:311-320 (storageUsed uses ui.savedChars for fuel.state.v1 whenever it is set); fuel/fuel.js:268 (only save() sets it)

**Sequence**

1. On a new phone the owner signs in from Welcome. signedIn() saves the empty state, so savedChars is about 300.
2. sync.js delivers the account's log through setState. In the run that is 758 days, about 2.08 million characters, 83% of STORE_LIMIT.
3. Settings says "302 of about 2,500,000 characters ... 0%" and Today shows no storage warning. Only the next save() or a restart shows 83%.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-fuel-data/meter-after-setstate.js prints:
  stored now: 2,079,842 characters (83% of the 2,500,000 the app counts on), 758 days
  Today notice: ""
  Settings: "Storage used302 of about 2,500,000 characters ... 0%"
  after a restart, Settings: "Storage used2,079,842 of about 2,500,000 ... 83%"

**Suggested fix**

In setState, keep the stored text and set ui.savedChars = text.length when setItem succeeds, as save() does.

### What held

- fuel/food.js against v2.8's food.js (diff): 11 lines differ. Four are comments, three are the page-relative addresses (../data/foods.json?db=5 and ../vendor/zxing/ twice), and three add markDeleted('foods'/'meals') in forgetFood, food-sm-remove (when the last item goes) and food-sm-delete. All are intended, and none changes what an entry or a food holds.
- Same taps give the same stored data: /tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-fuel-data/diff-taps.js drives v2.8's Food tab and Fuel's Today with the same 19 tap steps from the small fixture. The steps cover targets, add by search with a unit and amount change, + on a recent, quick add from macros, edit the unit, favourite, drag to another meal, a new food with a barcode, Edit food, save a meal, log it into Dinner, rename it, remove an item, copy to today, copy the day before, copy a meal, clear a meal, delete an entry, delete a custom food and delete a saved meal. Result: 'food + diary + deleted.food, ids renamed, times blanked: IDENTICAL', 'order of entry times within each day: IDENTICAL', the same 5 dialog texts, 0 page errors. The only extra data in Fuel is the intended records deleted.foods ['b0787692835614'] and one deleted.meals.
- normalize on v2.8 data: every write path in v2.8's food.js already stores the types normalize enforces (barcodes in data/foods.json are strings, last.qty is a number, serving.g is null or above 0, meal is 0 to 3, every entry has an id and an at). A v2.8 log therefore loads and saves unchanged. The existing tests/fuel-backup.js 'writes back the same' check confirms it byte for byte; I ran it with --port=8647 and all 29 checks passed. Unknown fields on entries, foods, meals and at the top level are kept. Fuel drops only empty days, keys that are not dates and entries that are not objects, and v2.8 cannot write any of those.
- Markup injection: /tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-fuel-data/xss.js imports a Fuel backup with an <img onerror> / <svg onload> / quote-breaking payload in every text field and every id: food id, name, brand, usda, barcode, serving label, servings labels, entry id/name/amt/brand, quick-add name, meal id/name, item name/amt/brand, record id, moved.from. It then opens Today, yesterday, the Add sheet (meals, favourites, recents and a search), the saved-meal sheet, the amount sheet, the Edit food form, the edit sheet of each entry, the meal menu, Trends and Settings. The script ran 0 times and 0 planted elements appeared, while the payload showed as text 3 to 13 times per screen. Reading the code confirms that the barcode, Open Food Facts and food-list texts also pass through esc(), and that toast() uses textContent.
- Trends arithmetic: /tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-fuel-data/trends.js compares the bars, the this-week and last-week averages, days logged and the hero against an independent count. The five cases are a Saturday evening in LA, Monday 00:30 after the US clocks went back, a Sunday, Monday 00:30 in Santiago after midnight was skipped, and Auckland. All cases agree: today is left out of the averages, weeks start on Monday, a day counts as over above 105% of the target, and today counts in days logged.
- Units switch: /tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-fuel-data/units-drift.js shows that lb to kg to lb changes 1,093 of 2,001 values from 100.0 to 300.0 lb, by one 0.1 lb step at most and only on the first round trip (150.0 becomes 149.9). Ten round trips drift no further, and kg to lb to kg is exact. The protein guide rounds to 5 g, so it does not change.
- Add-to-Home-Screen hold: nothing can be entered there. Reading fuel.js: renderGate draws no inputs, the tab bar is hidden, and a tab tap only draws the gate again. save(), setState(), safetyCopy(), refreshDayCopy() and applyTheme's storage write return early while ui.gate is set, and window.__overload.unreadable is true, so sync.js's link() and push() wait. Nothing that is typed is dropped. The risk is the stranded Safari-tab data reported above.
- Deletion records: a record is written only when something is deleted (diff-taps shows 3 entries, 1 food and 1 meal). dropStaleRecords runs at every save, so a food or meal never stands next to its record once a save has happened. planImport skips what Fuel recorded as deleted, and it takes an incoming record only for something Fuel does not hold or is not adding. No local path makes a live entry and its record coexist on one phone, because entries never reuse ids (uid() for every new entry and copy). Growth is about 30 characters per record. The fixture has 11 entry records in 4 months, which is negligible next to the diary at about 270 characters per entry.
- Unreadable data and storage full: read against the code and the existing fuel-backup.js checks. Data that cannot be read is never written over, a copy goes to before-unreadable and to fuel.state.v1.bak, and Start fresh and Restore leave that screen correctly. When storage is full the banner stays up, the app runs on memory, and Export and the daily copy at background both hold the food that was not saved.

### Not checked

- Anything on a real iPhone. Not checked: navigator.standalone, whether IndexedDB really stalls there (finding 1 uses a stand-in that never answers, the case backup.js's OPEN_WAIT exists for), whether the copy at background completes before iOS suspends the page, the share-sheet Export, and the real localStorage limit behind STORE_LIMIT.
- Whether iOS copies Safari's website data into a newly added Home Screen app. If it copied localStorage, a Fuel Home Screen app whose Safari storage once held overload.state.v1 would show the 'inside' gate (fuel.js:508) with no way forward, and the Safari-tab finding would change. This cannot be tested here.
- Open Food Facts lookups and search: the host is blocked under the rules. fromOff and resultRow were reviewed by reading only, and every name and brand passes through esc().
- fuel/sync.js merges (mergeCore, settle, applyDeleted, link) beyond how fuel.js's setState and records feed them. They belong to another reviewer's area.
- forgetCloudIfSignedOut (fuel.js:871-874) removes the sync note when sync.js has not loaded yet, for example offline on an early start, even if the owner is signed in. The next sign-in could then merge the account back into a Reset or Restore. That code is unchanged from v2.8 and sits on the sync boundary, so I did not run it.
- Food logs much larger than the reproductions use (two years ran in meter-after-setstate.js), and performance at that size.

## train-code

The training app's 3.0 changes in app.js, index.html, connector.js and bump.sh hold up. The same training session tapped through in v2.8 and in 3.0 stores byte-identical data on all three fixtures, including resuming a workout in progress. No code path reaches a food screen or food hook. The food reminder always goes to the connector as off, and the unchanged connector handles that. New markup escapes everything that comes from stored data. Reset, Import and Restore keep their order of operations, Remove is guarded, and the rescue and the reload hold behave as specified. Three low findings, each reproduced: (1) a double tap on 'Save as a file' makes the second share() fail. The code then falls back to a download and reports success, so the log counts as saved even if the owner cancels the share sheet, and Remove becomes available (the safety copy still allows an undo). (2) bump.sh accepts release numbers that are lower, repeated or malformed ('2.9', '3.0', '31', '3.01', '3.1.0'), which defeats the rescue's same-first-number fallback. (3) Import's question says the backup's food is not used, but a phone with food days and no saved foods takes the backup's saved foods, meals and targets. Scripts are in /tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-train-code/ (session-compare.js, handover-paths.js, import-wording.js, bump-typos.sh). The existing train-handover (27/27) and train-replace (21/21) tests pass here on ports 8653 and 8654. All my servers are stopped; the one on 8646 is not mine.

### T1 [low] Tapping 'Save as a file' twice says the food log was saved and unlocks 'Remove', even when the owner then cancels the share sheet

- Reproduced: yes
- Code: app.js:2024-2041 (shareFile: any share() error other than AbortError falls through to the download and returns true); app.js:2233-2238 (saveFoodFile records split.filed on true); app.js:2263 and 2295 (filed with the current hash makes Remove available)

**Sequence**

1. In Settings > Food, the owner double-taps 'Save as a file'. 2. The first tap opens the share sheet; its share() call is still pending. 3. The second tap calls share() again. Browsers reject that call at once with InvalidStateError ('an earlier share has not yet completed'; WebKit and Chromium both follow the Web Share spec here). 4. shareFile treats any error other than AbortError as 'no share sheet' and falls back to an <a download> blob click, then returns true. 5. split.filed is written with the current hash, and the toast says 'Food log saved as a file. In Fuel, tap Choose a file.' 6. The owner closes the share sheet without saving. The first call rejects with AbortError and returns quietly, so the success toast stays. 7. The card now says 'Saved as a file today.' and offers 'Remove the old food log from Overload'. Accepting both questions empties the diary. The 'before-foodremove' safety copy is kept, so this can be undone.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-train-code/handover-paths.js (node handover-paths.js --port=8652). Output: '[double tap]  share calls: ["first: sheet open","second: InvalidStateError","first: cancelled"]' / '[double tap]  toast: "Food log saved as a file. In Fuel, tap Choose a file."  downloads: 1  split.filed: {"at":1795311600568,"hash":"hmojr31nswhzh.6y9"}' / 'Remove offered: true' / 'after Remove (two questions accepted): diary days 4 -> 0; ... safety copy kept: true'. In Chromium the fallback download did write a file. Not verified: whether an <a download> blob click saves anything in an iPhone Home Screen app. Export JSON in v2.8 has the same shareFile behaviour; what is new in 3.0 is that this result now unlocks Remove.

**Suggested fix**

In shareFile, return false (or retry later) on InvalidStateError and NotAllowedError instead of falling back to a download. Use the download only when navigator.canShare is missing or says no. Also ignore taps on handover-file (and export) while a share is pending, with a module flag such as ui.sharing.

### T2 [low] bump.sh accepts a release number that is not higher than the current one, or is malformed ('2.9', '3.0' again, '31', '3.01', '3.1.0'), and the start-up rescue then cannot fall back to the right release

- Reproduced: yes
- Code: bump.sh:60 (the only check is the character set: case "$NEW" in *[!0-9.]*|.*|*.|*..*); index.html:70-71 (the rescue compares only the first two numbers, as integers)

**Sequence**

1. The release step types the number wrong, for example 'sh bump.sh 2.9' or '31' for 3.1, '3.01', '3.1.0', or runs 'sh bump.sh 3.0' again, which the build notes say not to do. 2. bump.sh rewrites every ?v=, both VERSIONs and both cache names, prints 'ok', and exits 0. 3. Effects: VERSION can go backwards. '3.0' again only moves the caches on (overload-v25, fuel-v2). The rescue in index.html treats '3.01', '3.1' and '3.1.0' as the same release, so none is 'older' than another. '31' and '2.9' have a different first number from every 3.x release, so a half-arrived update to or from them cannot fall back and shows the 'did not finish starting' note offline.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-train-code/bump-teypos.sh does not exist; the script is /tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-train-code/bump-typos.sh (dash bump-typos.sh; it runs bump.sh under dash on throw-away copies). Output: '[2.9]    exit 0 | 3.0 -> 2.9, caches: overload-v25, fuel-v2 ok: ...', '[3.0]    exit 0 | 3.0 -> 3.0, caches: overload-v25, fuel-v2 ok', '[31]     exit 0 | 3.0 -> 31 ...', '[3.01]   exit 0 ...', '[3.1.0]  exit 0 ...'. Refused correctly: '3.1.', 'v3.1', '3.1 ', '3,1' and the empty argument (exit 1, nothing changed).

**Suggested fix**

Accept only MAJOR.MINOR (case "$NEW" in [0-9]*.[0-9]* with no third part, and no leading zero in MINOR). Refuse a number that is not greater than the current VERSION when compared as two integers (the same rule the rescue uses). Refuse a different first number unless a flag such as --major is given.

### T3 [low] Import's question says 'Food in the backup is not used', but when the phone's old food copy has days and no saved foods, meals or targets, the backup's saved foods, meals and targets are taken in

- Reproduced: yes
- Code: app.js:482-486 (foodLine wording); app.js:517-521 (keepFoodCopy carries state.food only when f.catalogue is true); the same wording is used for Restore (app.js:469)

**Sequence**

1. The phone's old food copy holds food days but no saved food, meal or target (a log made only of quick adds). 2. The owner imports a backup that has saved foods and targets. 3. The question says 'The old food log on this phone (4 days) stays as it is. Food in the backup is not used.' 4. After Import, state.food is the backup's: 64 saved foods, 3 meals, a 2400 kcal target. The phone's diary is kept. 5. The old food copy has now changed, which SPEC 3.1 says only Remove may do. Its hash changes, so after an earlier copy the card comes back saying the log 'changed after you copied it'.

**Evidence**

/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-train-code/import-wording.js (node import-wording.js --port=8655). Output: 'question (food line): "The old food log on this phone (4 days) stays as it is. Food in the backup is not used."' / 'after Import: saved foods 64 (phone had 0, backup 64), meals 3 , kcal target 2400 (phone had null)' / 'food days kept from the phone: true'. Rare in practice: food.js stores every searched food as a saved food.

**Suggested fix**

Either carry the phone's whole old food copy whenever it has any part (f.any), or make foodLine say which parts come from the file. For example: 'The old food log on this phone stays; the saved foods and targets in the backup are used because this phone has none.'

### What held

- Training session parity: the same taps in v2.8 (3b17963) and 3.0 store byte-identical overload.state.v1, with a sim clock and seeded Math.random. Taps: start workout, soreness, change a weight, tick sets, typed reps, RIR, feedback, finish exercise, swap an exercise through the picker, cardio, Finish with 'Finish anyway'. Fixtures v28-state-small (38,774 chars) and v28-state (696,359 chars); with v28-state-active: resume, tick, finish (697,358 chars). Identical, no page errors, same dialogs, same overload.backup apart from split. Script: /tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/review-train-code/session-compare.js --port=8650 [--fixture=...]
- Food leftovers: no code path reaches a 'food' screen. v2.8 never stored a screen name, neither version reads ?screen=, the only switch on data-screen is the tab bar, and the connector's food push carries url = APP_URL. renderScreen has no case for 'food'. Click, input, change and submit no longer route food-*, and no such element exists. Checked by reading app.js, sw.js and connector/worker.js, plus a grep of all root scripts.
- Food reminder: configNow always sends reminders.food = {on:false, time} and done without food. The unchanged connector/worker.js (PUT /config takes b.reminders and b.done; runReminders skips a kind that is off) handles this. LABELS without food leaves only two rows, and conn-rem/conn-time act only on drawn rows (connector.js:23, 284-289, 341, 370-374).
- Clipboard paths: permission denied (writeText and write reject) and no navigator.clipboard both show 'Could not copy the food log. Use Save as a file instead.' with no split.copied. Copy link without the API shows the address in the toast. No page errors. Gzip-missing and early-tap paths are covered by the existing tests (handover-paths.js; tests/train-handover.js --port=8653: 27/27).
- Share sheet: resolve records split.filed and shows the right toast; cancel (AbortError) records nothing and shows no toast (handover-paths.js). Single taps are correct; only the double tap fails (finding 1).
- Escaping: every new piece of markup (handoverHtml, fuelButtons, COPY_KINDS labels) holds only numbers, dates made by the app, the FUEL constant and esc()'d URLs. The e-mail goes only into confirm() text, and toasts use textContent.
- Reset, Import and Restore as rewritten: safetyCopy stringifies before keepFoodCopy and normalize; keepFoodCopy runs before state is replaced; the foodFacts cache is keyed on object identity and recomputed after each replace. Fuel and hand-over files are refused before the backup check. tests/train-replace.js --port=8654: 21/21.
- Remove: offered only while the last copy or file matches the hash. It asks twice, awaits the safety copy, re-checks the hash, empties diary only, and puts the diary back if save fails. forgetSyncedDays runs only after a successful save. A second tap is blocked by ui.removing or f.days (read from the code).
- First 3.0 start: noteSplit takes the raw text read before the first save, sets split.at only after the copy is stored, never writes over an existing before-split, and on the unreadable path sets the note without a copy (code read; the upgrade tests cover it).
- Start-up rescue: only overload- caches are searched, the main script is matched by full path, and 'older' compares two integer parts with the same major. With no fallback it always ends in the 'did not finish starting' note, never a blank page. Nothing in it reloads, so there is no reload loop. The v2.8 worker never stores the 3.0 page (pageFits), so a half-arrived update shows the note once and then v2.8 again. Read index.html:42-96 against v2.8 sw.js; train-rescue.js covers the cache cases.
- Reload hold: it holds during a workout, while typing, or with a sheet open, and waits for a tap on 'Update ready' or the next start, as v2.8 did. It never reloads on its own while any of these is true (app.js:2671-2679).
- bump.sh: --check passes under dash on the frozen tree. The usage, empty argument and bad-character cases are refused before anything changes. Only POSIX constructs are used (no sed -i, BRE with literal ?, $(( )), ${a%%\?*}).

### Not checked

- BSD sed and grep on a Mac: there are no BSD tools here. By reading only, every sed and grep use is POSIX BRE/ERE that BSD accepts; the one doubtful construct is '\]' in sed -n "/const ASSETS = \[/,/^\];/p", which is undefined in POSIX but taken as a literal ']' by both GNU and BSD.
- Anything on a real iPhone: whether x-safari-https opens Safari from the Home Screen app and what happens when it does not; whether Safari's ClipboardItem with a promise accepts a slow gzip; whether an <a download> blob click saves a file in a Home Screen app (this decides how bad finding 1 is); what the share sheet returns when Save to Files is cancelled inside Files.
- The reload hold under a real service-worker update (only the code was read; the builders' test uses a stand-in controllerchange). A reload during the await in Remove or Copy, after the questions, would leave nothing removed or nothing noted. That is not data loss, and it was not run.
- A second device on v2.8 that shares the connector key: the two phones could keep re-sending reminders.food on and off to the connector at each status check. Reasoned from connector.js:96 and 292-299, not run.
- Storage-full paths: setSplit failing silently would show 'copied' while Remove is never offered. Not run, and not plausible at today's data size.
- sync.js and sw.js: outside this area.
