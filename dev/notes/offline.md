# Offline cache, start-up and updates

What this note covers: how the offline copy and the update work in v2.8, and what the split into two apps
(Overload at `/overload/`, Fuel at `/overload/fuel/`) needs from the service workers, the manifests, `bump.sh`
and the GitHub workflows. Line references are to v2.8 (`3b17963`).

This note was written before 3.0 was built. Section 10 ("Since the fixes") says how 3.0 works as released,
after the review (`review-findings.md` U1, U2, O1, O4, T2), and section 11 what the final review changed in the
release mechanics (upgrade#1 to #5). Where they and the earlier sections disagree about 3.0, the later section
and the code are right. The main script of 3.0 is `overload.js`; `app.js` below is v2.8's.

Three kinds of statement are kept apart:

- **Code**: read from the source, with file:line.
- **Seen in Chromium**: run with a real service worker (Chromium 157, Playwright 1.63) against copies of the
  repo outside the repo. Section 3 lists the runs.
- **iPhone**: Chromium is not Safari. Nothing about iOS was run. Section 4 marks each point *known* (long
  standing, widely documented behaviour) or *uncertain*.

## 0. The short version

1. The root worker `sw.js` has scope `/overload/`, so it also controls every page under `/overload/fuel/` until
   the diet app's own worker is active. Today it answers such a page with the **training page** whenever the
   network is slow (over 3 s), down, or returns an error. It also stores everything such a page loads into
   the training cache. The root worker must skip `fuel/`.
2. The root worker deletes **every cache whose name starts with `overload-`** except its own at each release
   (`sw.js:57`). The diet cache must be called `fuel-vN`. Seen in Chromium: `overload-fuel-v9` was deleted,
   `fuel-v1` survived.
3. Once the diet worker is active it handles every request made by a diet page, including files outside its
   folder (`../data/foods.json`, `../vendor/zxing/*`, `../shared/*`). The root worker never sees them. Each
   worker keeps its page; neither steals the other's (seen in Chromium).
4. `food.js` builds three addresses from the page's own address (`food.js:30`, `food.js:879`, `food.js:880`).
   Under `/overload/fuel/` they point at files that do not exist. They need `../`.
5. The first start of 3.0 on the phone is served by the old v2.8 worker. With good signal the new page runs
   once, the new worker installs, and the page reloads itself within seconds. With a slow page (over 3 s) or
   no signal the phone starts **v2.8 from its cache, Food tab included**, until the new worker has installed.
   v2.8 can therefore still run, and change food data, after 3.0 has run. In 3.0 as released that start is
   pure v2.8 (section 10): 3.0's main script and stylesheets have names v2.8's page never asks for.
6. The Home Screen icon already on the phone keeps working and keeps its data only if `start_url`
   (`./index.html`), `scope` (`./`) and the worker's address (`/overload/sw.js`) stay as they are. Its picture
   and name will not change. Deleting and re-adding the icon deletes that app's data.

## 1. How it works today (v2.8)

### 1.1 Where the version lives

| What | Where | Value |
| --- | --- | --- |
| Release number | `app.js:16` `const VERSION = '2.8'` (shown at `app.js:1504`, "Overload · v2.8") | 2.8 |
| File addresses | `?v=2.8` on the stylesheet (`index.html:86`) and six scripts (`index.html:129-134`), and on the same seven files in `sw.js:6-12` | 2.8 |
| Cache name | `sw.js:2` `const CACHE = 'overload-v23'` | counter, +1 per release |
| Food list | `?db=5` in `food.js:30` and `sw.js:13`; changed by hand when the list is rebuilt (`README.md:338-339`) | 5 |
| Release the worker belongs to | `sw.js:31` `RELEASE`: the `?v=` of the first entry of `ASSETS` that has one | 2.8 |

`bump.sh` changes the first three in one go (section 6).

### 1.2 The stored files

`sw.js:3-22` lists 17 addresses: `./`, `./index.html`, the stylesheet, the six scripts, `./data/foods.json?db=5`,
the manifest, three icons and the three barcode reader files under `./vendor/zxing/`.

Seen in Chromium: after the first visit the cache `overload-v23` holds exactly those 17 entries, 2,616,063 bytes.
The food list (1,205,540), the barcode reader (953,527 + 40,496 + 10,947) and `food.js` (80,371) are 2,290,881
bytes of that, 88%. Without them the training app's cache is about 325 KB.

### 1.3 Install: all or nothing

`sw.js:39-52`.

- Every entry of `ASSETS` is fetched with `cache: 'reload'` (`sw.js:42`), so the browser's own HTTP cache is
  bypassed (GitHub Pages sends `max-age=600`).
- A response that is not `ok` throws (`sw.js:43`).
- The two page entries (`./` and `./index.html`) are read as text and checked with `pageFits` (`sw.js:44-48`).
  `pageFits` (`sw.js:32`) is true when the HTML contains `?v=<RELEASE>` somewhere. A page from another release
  throws "is not from this release". This covers the minutes after a release when the server can still hand
  out the old page.
- If everything was stored, `self.skipWaiting()` (`sw.js:50`). If anything threw, the new cache is deleted and
  the install fails (`sw.js:50`). The worker already on the phone and its cache stay as they were. The next
  update check tries again from zero.

Seen in Chromium:
- New `sw.js` but `app.js?v=3.0` answering 503: no `overload-v24`, the v2.8 worker stays active, its cache is
  kept (run T9.1).
- New `sw.js` but the old page still served: same result (T10.1). At the next check, with the right page, the
  update completes (T10.2).

`pageFits` and the page check are new in v2.8 (`git log -S pageFits -- sw.js` gives only `3b17963`). Workers of
v2.7 and older store any page.

### 1.4 Activate: which caches are deleted

`sw.js:54-60`. The line that matters for the split, `sw.js:57`:

```js
.then((keys) => Promise.all(keys.filter((k) => k.startsWith('overload-') && k !== CACHE).map((k) => caches.delete(k))))  // other sites share this origin
```

Every cache on the origin whose name starts with `overload-`, except this release's, is deleted. Then
`self.clients.claim()` (`sw.js:58`) takes over the pages already open, which fires `controllerchange` in them.

Why the prefix matters: Cache Storage belongs to the origin (`https://<owner>.github.io`), not to the folder.
The owner's other sites on that origin see the same list of caches. The prefix keeps this worker from deleting
theirs. It also means that anything named `overload-…` is this worker's to delete.

Workers before v2.5 had no prefix test: they deleted every cache except their own (`git show 81aade2:sw.js`,
`keys.filter((k) => k !== CACHE)`). That only runs when such a worker activates, so it matters only for a
roll-back to a release older than v2.5.

### 1.5 Fetch: network first, cached copy after 3 seconds

`sw.js:73-107`.

- Only `GET` (`sw.js:74`). Only same-origin addresses and `www.gstatic.com` (the Firebase scripts `sync.js`
  imports) (`sw.js:76-78`). Everything else (Open Food Facts, Firestore, the connector) is not touched.
- **Same origin means the whole origin**, not just `/overload/`. Whatever a controlled page asks for on the
  origin goes through here.
- The network request is made with `cache: 'no-cache'` for same-origin addresses (`fresh`, `sw.js:26`, used at
  `sw.js:84`), so a stale copy from the HTTP cache is never used.
- Every `ok` response is stored in `CACHE` under the request's address (`sw.js:85-88`). One exception: the
  app's own page (`scope` or `scope + 'index.html'`, `sw.js:81`) is stored only when `pageFits` (`sw.js:87`).
  So besides the 17 listed files the cache also collects `connector.json` (asked by `connector.js:68`), the
  Firebase scripts, and any other same-origin file a controlled page loaded.
- The answer (`sw.js:93-106`):
  - network answered `ok` (or a redirect): that response;
  - network has not answered after `NET_WAIT` = 3000 ms (`sw.js:72`, `sw.js:97`): the stored copy if there is
    one, and the late network answer still refreshes the cache;
  - network answered with an error status (`sw.js:101`) or failed (`sw.js:102-105`): the stored copy if there
    is one, otherwise the error.
- The stored copy (`cached`, `sw.js:82`): `caches.match(e.request)`, which searches **all caches of the origin**
  for the exact address including the query. For a navigation with no exact match it falls back to
  `caches.match('./index.html')`, which is `/overload/index.html`.

That last fallback is not limited to the app's own page. Any navigation inside the scope that is slow, offline
or answers 404 gets the training page (seen in Chromium, section 2.2).

### 1.6 How the page learns about an update

`app.js:2394-2415`.

1. On every start the page registers `./sw.js` with `updateViaCache: 'none'` (`app.js:2406`) and calls
   `reg.update()` (`app.js:2407`). It calls `update()` again every time the app comes back to the front
   (`visibilitychange`, `app.js:2414`). An iPhone resumes a Home Screen app instead of reloading it, so this is
   the check that usually finds a release.
2. When a new worker reaches the state `installed` and a worker already controls the page, the page shows the
   toast `Updating…` (`app.js:2408-2410`).
3. The new worker skipped waiting (`sw.js:50`), so it activates at once, deletes the old cache and claims the
   page. The page gets `controllerchange` (`app.js:2399-2405`):
   - `hadController` is false (the page was loaded with no worker, i.e. the very first install): nothing;
   - a workout is active, or an input, textarea or select has focus: no reload. `ui.updateReady = true` and the
     top bar shows an **Update ready** pill (`app.js:772`). Tapping it reloads (`app.js:2091`);
   - otherwise `location.reload()` straight away.
4. `noteUpdateReady()` (`app.js:2427`) sets the same flag. Nothing in the repo calls it (`grep -rn
   noteUpdateReady` finds only its definition). It is a leftover on `window.__overload`.

Seen in Chromium (T11, T12), in order, as the page saw it:
- first ever install: `controllerchange`, no reload, no toast;
- update while idle: `toast: Updating…`, `controllerchange`, page load (the reload);
- update while a Settings number box had focus: `toast: Updating…`, `controllerchange`, `pill: Update ready`,
  no reload. The page was still v2.8 with its Food tab. After a tap on the pill it was 3.0.

While the reload is held back the old page runs under the new worker and the old cache is gone. Seen: that
old page's request for `./data/foods.json?db=5` with no network failed (T11), because the new training
worker no longer stores the food list.

### 1.7 Start-up rescue in `index.html`

Second inline script, `index.html:29-85`. It sits before the stylesheet link (`index.html:86`). (The first
inline script, `index.html:16-28`, only applies the saved theme from `localStorage['overload.theme']`.)

Purpose: the page arrived but `app.js` did not load, for example the first start after a release on a weak
signal. Instead of a blank screen it runs the previous release's files that are still stored.

What it does:
- records every script or stylesheet that failed to load (`index.html:57`);
- after 8 s with nothing drawn, writes "Overload is still starting…" into `#app` (`index.html:56`, `say`,
  `index.html:39-55`). It adds "Everything you logged is still on this phone." when
  `localStorage['overload.state.v1']` exists (`index.html:44`);
- on `load`, if `window.__overload` exists the release started and it stops (`index.html:59`);
- otherwise it finds the main script: the `<script src>` whose address matches `/\/app\.js[?&]/`
  (`index.html:66`). If that script is not among the failed ones it only writes the final note
  ("Overload did not finish starting… Close the app and open it again where there is signal or Wi-Fi.");
- it reads the page's release from that script's `v=` (`index.html:64`, `index.html:68`), opens every cache
  whose name starts with `overload-` (`index.html:70`) and looks for a stored address matching
  `/\/app\.js[?&]/` with a different `v=` (`index.html:73`). The last one found wins;
- for every `<script src>` of the page and the first stylesheet it swaps the `v=` to that older release
  (`index.html:65`, `index.html:76`), reads the stored copy with `caches.match` (all caches), turns the bytes
  into `blob:` addresses and adds them to the page in order (`index.html:77-79`). 4 s later it writes the final
  note if the app still has not started (`index.html:80`).

What it assumes:

| Assumption | Line |
| --- | --- |
| Cache names start with `overload-` | `index.html:70` |
| The main script is the one whose address contains `/app.js?` | `index.html:66`, `index.html:73` |
| Every file carries its release as `v=` | `index.html:64-65` |
| `window.__overload` means "started" | `index.html:41`, `index.html:59` |
| The data key is `overload.state.v1` | `index.html:44` |
| The page has `#app`; one stylesheet link | `index.html:40`, `index.html:75` |
| The older release's scripts work with **this** release's HTML | whole script |
| Running a script twice is harmless | comment `index.html:33-34` |

Seen in Chromium (T9): v3 page, `app.js?v=3.0` answering 503, v2.8 worker in control. The rescue started the
app from five stored v2.8 scripts as `blob:` addresses. It worked because my stand-in v3 page was the v2.8 page
minus the Food tab. With a redesigned page it would be v2.8 code on v3 HTML.

The rescue is new in v2.8.

## 2. The planned layout

Training app at the repo root, worker `/overload/sw.js`, scope `/overload/`.
Diet app in `fuel/`, worker `/overload/fuel/sw.js`, scope `/overload/fuel/`.

GitHub Pages cannot send the `Service-Worker-Allowed` header, so a worker's widest scope is its own folder.
The root worker file must stay at the repo root. The diet worker must be a file inside `fuel/`.

### 2.1 Which worker controls a page under `/overload/fuel/`

"The storage" below means one browser storage: the installed Overload app, the installed Fuel app and Safari
are three separate ones on the iPhone (section 4).

| State of the storage | Page under `/overload/fuel/` is controlled by | Seen |
| --- | --- | --- |
| No worker at all (a fresh Fuel Home Screen app) | nobody; plain network | T5.0 |
| Root worker active, no diet registration | **the root worker**: it gets the navigation and every request the page makes | T2a, T5b-A |
| Root worker active, diet worker registered and still installing | the page that registered: still the root worker. A new navigation during the install: **also the root worker** in Chromium | T3.1, T6.1 |
| Diet worker active | the diet worker. It claims the open page (`clients.claim()`): `controllerchange` fires in the page | T3.2, T6.2 |
| Both active, later | each page by its own worker. A release of one never moves the other's pages | T4.1, T4.2 |
| Only the diet worker; then the training page is opened | training page: nobody at load, then its own worker after install | T5.3 |

Details that follow from this:

- The match is by longest scope. A navigation to `/overload/fuel/…` goes to the diet registration once it has
  an active worker; `/overload/…` anywhere else goes to the root worker.
- The service worker spec says a navigation is uncontrolled while the best matching registration has no
  active worker. Chromium kept the root worker in control in that window (T6.1). Safari may do either. The
  design must work both ways.
- On a diet page that the root worker controls, `navigator.serviceWorker.getRegistration()` and
  `navigator.serviceWorker.ready` give the **root** registration (T2a, T5b-A). After the diet registration
  exists they give the diet one (T3.2). The diet page should keep the registration object that `register()`
  returns and call `update()` on that.
- On such a page `navigator.serviceWorker.controller` is set at load. A copy of `app.js:2397`
  (`hadController`) would be true, so when the diet worker claims the page the copied handler **reloads it**
  (or shows Update ready), and `app.js:2410` would show `Updating…` on a first install. In the diet page,
  count a controller only when its `scriptURL` is the diet worker's.
- Opening a diet page that the root worker handles also starts an update check of the root worker. Seen
  (T3b): with only the diet page open and the training page never fetched, the root worker went from v2.8 to
  v3 within 4 s, `overload-v23` was deleted and `overload-v24` created. The diet page saw one
  `controllerchange`, to the diet worker; the new root worker did not take it.

### 2.2 What the root worker does today for the diet app

Seen in Chromium with the unchanged v2.8 worker in control and the diet files on the server (T2):

| Case | Result |
| --- | --- |
| `fuel/probe.html`, good network | Served from the network. Stored in `overload-v23`. So were `fuel/fuel.js?v=3.0`, `../data/foods.json?db=5&probe=1` and `../vendor/zxing/share.js?probe=1` that the page asked for |
| `fuel/missing.html`, server says 404 | The **training page** (title "Overload") at the fuel address. Its scripts resolve to `/overload/fuel/app.js?v=2.8` and so on, which do not exist. After a few seconds: "Overload did not finish starting." |
| `fuel/`, server takes 5 s | After 3.03 s the **training page**, same dead end. The late real page is stored afterwards |
| `fuel/other.html`, no network | The **training page** |
| `/othersite/` (another folder of the origin) | Not controlled. Out of scope |

Requests made **by a diet page to files outside its folder**:

- while the root worker controls that page: the root worker answers them, network first, and stores them in
  the training cache (T2a);
- once the diet worker controls the page: the diet worker answers them. `../data/foods.json?db=5&probe=2`,
  `../vendor/zxing/share.js?probe=2`, `../styles.css?v=3.0&probe=2` and the reader module with its import all
  appeared in the diet worker's log and in `fuel-v1` only. Nothing was added to `overload-v23` (T3.3).

Scope decides which **pages** a worker controls. It does not limit which addresses that page's requests may
have.

### 2.3 What must change in the root worker

1. **Stop storing the food files.** Remove from `ASSETS`: `./food.js?v=…` (`sw.js:11`),
   `./data/foods.json?db=5` (`sw.js:13`), the comment and the three reader files (`sw.js:18-21`). Mind the comma
   after `./icon-512.png` (`sw.js:17`).
2. **Leave the diet app alone.** In the fetch handler, right after `scope` is known (`sw.js:80`) and before the
   network request is started (`sw.js:84`):

   ```js
   // The diet app (fuel/) has its own worker; the food list and the barcode reader are its files.
   if (sameOrigin && url.pathname.startsWith(scope) && /^(fuel|data|vendor)(\/|$)/.test(url.pathname.slice(scope.length))) return;
   ```

   Returning without `respondWith` lets the browser fetch as if there were no worker. `data` and `vendor` are
   in the list so that a diet page the root worker still controls (before the diet worker has claimed it) does
   not fill the training cache with 2.2 MB again.
3. **Reminders.** `notificationclick` focuses any open window whose address starts with the scope
   (`sw.js:121`). A diet window in the same storage matches. Exclude addresses under `scope + 'fuel/'`. Not an
   issue on the iPhone if the two apps are separate Home Screen apps, and the connector is not deployed, but it
   is one line.
4. Keep as they are: the cache prefix `overload-`, the file name and place of `sw.js`, `'./'` and
   `'./index.html'` in `ASSETS`.

Seen in Chromium with change 1 and change 2 (as `/^(fuel|data|vendor)\//`) applied to a copy (T5b): a diet page
the root worker controls loads from the network; nothing under `fuel/`, `data/` or `vendor/` is stored in
`overload-v24`; `fuel/missing.html` shows the server's own 404; a 5 s page arrives after 5 s as the diet page;
with no network the browser shows its own error page. `lab/scan.html` is still controlled by the root worker.
The root worker still answers and stores `../styles.css?v=3.0` and `../connector.json` for such a page, which
is harmless.

A diet page that the root worker controls gets no offline help from it. That is right: the diet worker takes
over a few seconds later.

### 2.4 The diet worker

A copy of `sw.js` with these differences:

| Item | Root | Diet |
| --- | --- | --- |
| Cache name | `overload-vN` | `fuel-vN` |
| Old caches deleted on activate | names starting `overload-` | names starting `fuel-` only |
| Files | own files | own files with `./`, plus `../data/foods.json?db=5`, `../vendor/zxing/reader/index.js`, `../vendor/zxing/share.js`, `../vendor/zxing/zxing_reader.wasm`, and any `../shared/…` file |
| Stored copy lookup | `caches.match` over all caches (`sw.js:82`) | better: only its own cache, `caches.open(CACHE).then((c) => c.match(…))` |
| Page fallback | `./index.html` = `/overload/index.html` | `./index.html` = `/overload/fuel/index.html` (relative addresses in a worker resolve against the worker file) |
| Push handlers (`sw.js:110-124`) | keep | none (no reminders in Fuel) |
| `www.gstatic.com` rule (`sw.js:77`) | keep | keep if Fuel has cloud sync |

Seen in Chromium with such a worker (`fuel-v1`, ten entries):
- relative `../` entries in `ASSETS` are stored under `/overload/data/…` and `/overload/vendor/…` (T3.2);
- with no network the diet page starts, reads the food list, imports the reader module and fetches the wasm
  file, all from `fuel-v1` (T3.7);
- with no network `fuel/other.html` gets the diet page, not the training page (T3.7);
- a storage with only the diet app has only the diet registration and only `fuel-v1` (T5.1), 2,215,757 bytes
  in my minimal version. The training address is simply unreachable offline there (T5.2).

Why "only its own cache": `caches.match` searches every cache of the origin. Seen: a training **page** found
the food list through `caches.match` although only `fuel-v1` held it (T3.7). Addresses carry the folder and the
`?v=`, so a wrong hit is unlikely, but reading one's own cache removes the question.

### 2.5 Cache names

Seen in Chromium (T4), with both apps installed and extra caches made by hand:

| Cache | After a training release (`overload-v24` → `v25`) | After a diet release (`fuel-v1` → `v2`) |
| --- | --- | --- |
| `overload-v24` | deleted | |
| `overload-fuel-v9` | **deleted** | |
| `overload-copies-cache` | **deleted** | |
| `fuel-v1` | kept | deleted |
| `fuel-old-v0` | kept | deleted |
| `fuelish` | kept | kept |
| `othersite-v1` | kept | kept |
| `overload-v25` | | kept |

Rules:
- the diet cache is `fuel-v1`, `fuel-v2`, …;
- nothing else may ever be put in a Cache Storage cache named `overload-…` or `fuel-…`;
- this is about Cache Storage only. The automatic copies live in IndexedDB (`backup.js:10`,
  `overload-copies`), which these workers never touch.

### 2.6 The first start of 3.0 on the phone

The installed Overload app has the v2.8 worker and `overload-v23`. Seen in Chromium:

**Good signal (T7).**
1. The v2.8 worker fetches the page from the network and hands over the 3.0 page. It does not store it
   (`pageFits`, `sw.js:87`): the page kept in `overload-v23` is still 2.8.
2. The 3.0 page loads its 3.0 files through the v2.8 worker, which stores them in `overload-v23` under their new
   names (six entries with `3.0`). **The 3.0 code runs once under the old worker.**
3. The page registers `sw.js`. The 3.0 worker installs (about 325 KB), activates, deletes `overload-v23`, claims
   the page. The page shows `Updating…` and reloads itself (unless a workout is active or a box has focus).
4. After the reload: 3.0 page, 3.0 worker, cache `overload-v24`. With no network it starts as 3.0.
5. `localStorage['overload.state.v1']` was not touched by any of this: a diary entry written before the update
   was there after it, and `state.food` was identical. Workers cannot reach localStorage.

**Slow page, over 3 s (T8).** The v2.8 worker answers with its stored page after 3.07 s: **v2.8 starts, with
the Food tab and `food.js`**. The 3.0 page that arrives late is not stored. The v2.8 page registers `sw.js`
like any other start, the 3.0 worker installs when the network allows, and the page reloads into 3.0. With no
network at all, v2.8 keeps starting until there is one.

(Corrected after the review, U2 and O1.) T8 ran with a stand-in 3.0 that kept v2.8's file names. With those
names the v2.8 page, which asks the server first, got 3.0's `app.js` (and the rest) under `?v=2.8`, ran it and
stored it under v2.8's names, because GitHub Pages ignores the query: "v2.8 starts" was then a mix. In 3.0 as
released the main script is `overload.js` and the stylesheets are `shared/ui.css` and `train.css`; `app.js`,
`styles.css` and `food.js` do not exist on the server (`bump.sh` fails if one does). The v2.8 page's requests for
them get a 404, and v2.8's worker answers with its own stored copies, so the page that starts is pure v2.8.
`sync.js`, `connector.js`, `programs.js` and `backup.js` kept their names, so that page can still get 3.0's
copies of those: `tests/train-sync.js --base=v28` and `tests/train-backup.js` run that combination, and
`tests/train-mixed.js` lists it.

**The page arrives but a 3.0 file does not (T9).** The worker's install fails and nothing changes. In the
page, the rescue of section 1.7 ran v2.8 files in T9. 3.0's rescue no longer does that: it falls back only to
an older release with the same first number, so a 3.0 page without its main script says "Overload did not
finish starting." From 3.1 on it starts the stored 3.0 (section 10).

**Old page still served with the new worker file (T10).** Install fails, v2.8 keeps running, the next check
succeeds.

What this means for the change:

- For some time v2.8 and 3.0 can **alternate** on the phone: 3.0 when the page arrives quickly, v2.8 when it
  does not, until the 3.0 worker's install has gone through once. The saved state written by 3.0 must load in
  v2.8, and v2.8 will still show and change food data.
- Step 3 reloads the page a few seconds after 3.0 first appears. Anything 3.0 shows on its first start (a
  "Food has moved" sheet, an export in progress) is cut off unless the reload is also held back while a sheet
  is open. Today it is held back only for an active workout or a focused field (`app.js:2402-2403`).
- If the app on the phone has not been opened online since v2.8 was published (its commit is dated
  11 Nov 2026) it runs v2.7 or older. That worker has no `pageFits`: it stores the 3.0 page in its old cache,
  and a weak-signal start can then show a page whose files are not stored. The 3.0 page's own rescue is the
  only help there.

The diet app's first start: a fresh Home Screen app has no worker (T5). The page loads from the network,
registers `fuel/sw.js`, which downloads about 2.3 MB. Until that install is done the app is not available
offline. If the diet page is first opened in a storage that has a root worker (Safari where Overload was once
opened, or a link inside the installed Overload), the cases of section 2.2 apply for that first page.

### 2.7 `food.js` addresses

`food.js` resolves three addresses against the page, not against itself:

| Line | Code | Under `/overload/fuel/` it becomes |
| --- | --- | --- |
| `food.js:30` | `const DB_URL = './data/foods.json?db=5'` (used by `fetch` at `food.js:157`) | `/overload/fuel/data/foods.json?db=5`, which does not exist |
| `food.js:879` | `import(new URL('./vendor/zxing/reader/index.js', location.href).href)` | `/overload/fuel/vendor/zxing/reader/index.js`, which does not exist |
| `food.js:880` | `new URL('./vendor/zxing/' + p, location.href)` for the wasm file | same folder, does not exist |

They use `location.href` on purpose: a rescued start runs the file from a `blob:` address (comment at
`food.js:879`). In the diet app they need `../data/…` and `../vendor/zxing/…`. The `?db=` in the diet copy of
`food.js` and in `fuel/sw.js` must be the same, or the list is fetched under an address that is not stored and
search stops working offline.

`grep` finds no other page-relative address in `food.js`. In the training files there are two: `./sw.js`
(`app.js:2406`) and `./connector.json` (`connector.js:68`).

## 3. The Chromium runs

Set-up: copies of the repo under
`/tmp/claude-0/-home-user-crucible-college-/8b00a1f0-61c9-5de5-a7bf-97a560532c0a/scratchpad/ov-offline/`
(a session folder that can be cleared), served under `/overload/` on 127.0.0.1 by a small Node server that can
delay a path, answer it with an error, or drop every connection ("no network"). Scripts in `scripts/` there,
outputs in `t*.out`.

- `site-a`: v2.8 byte for byte, except that `sync.js` imports the Firebase files from a dead local address.
- `site-c`: stand-in 3.0. `./bump.sh 3.0` run in the copy; Food tab button and `food.js` tag removed from
  `index.html`; `sw.js` changed as in 2.3 (plus a test-only log); a minimal `fuel/` with `index.html`,
  `probe.html` (registers nothing), `fuel.js`, `manifest.webmanifest`, icons and `sw.js` as in 2.4.
- `site-d`: the same as release 3.1 (`overload-v25`, `fuel-v2`).
- Each run used a fresh browser context, which has its own storage like a separate app. No request left
  127.0.0.1 (checked in every run).

| Run | What | Result |
| --- | --- | --- |
| T1 | v2.8 first visit, reload, start with no network | 17 entries, 2.6 MB; starts offline |
| T2 | pages under `fuel/` with the v2.8 worker | section 2.2 |
| T3 | storage with v2.8 worker opens the diet app, then both apps, then no network | sections 2.1, 2.2, 2.4 |
| T3b | same start, only the diet page ever opened | the root worker updated itself to v3 anyway (2.1) |
| T4 | a release of each app, extra caches | section 2.5; no page changed hands |
| T5 | fresh storage, diet app first, then the training app | section 2.1, 2.4 |
| T5b | proposed root worker and diet pages it controls | section 2.3 |
| T6 | navigation while the diet worker installs | root worker still in control (Chromium) |
| T7-T10 | first start of 3.0 under the v2.8 worker | section 2.6 |
| T9.2 | rescue with `/overload/fuel/app.js?v=1.0` stored in `overload-v23` | rescue picked `1.0`, found no files, "did not finish starting" |
| T9.3 | same with `?v=3.0` (the page's own number) | rescue worked |
| T11, T12 | update while idle, while typing; first install | section 1.6 |
| T13 | manifest `id`, `start_url`, `scope` as Chromium resolves them | section 5 |

Not verified, because it needs Safari on iOS:
- that a Home Screen app, Safari and a second Home Screen app have separate workers and caches;
- which worker controls a navigation while the best matching registration is still installing (T6);
- that `clients.claim()` and `controllerchange` behave the same;
- timing of update checks when an app is resumed;
- everything in section 4.

Also not covered: the 10 minute `max-age` of GitHub Pages. Playwright's request routing switches the HTTP
cache off. What the code does about it (`cache: 'reload'`, `cache: 'no-cache'`, `updateViaCache: 'none'`) is
read from the source only.

## 4. iPhone specifics

Each line: **known** = long-standing, widely documented behaviour; **uncertain** = I could not confirm it.
None of it was tested here.

**Storage**
- known: a Home Screen app does not share localStorage, IndexedDB, Cache Storage or service workers with
  Safari.
- known: every Home Screen icon is its own app with its own storage, also for two icons from one site. The
  Fuel icon starts with empty storage and no worker, whatever Overload or Safari hold.
- known: deleting a Home Screen icon deletes that app's storage (`README.md:315-316` says the same).
- known: Safari removes a site's script-written storage after 7 days without a visit. Home Screen apps are
  exempt. A diet app used only in a Safari tab is not.
- uncertain: whether anything (cookies) is copied from Safari into the new app when it is added. Assume
  nothing: the apps keep their data in localStorage and IndexedDB, and a Firebase sign-in will have to be
  repeated in Fuel.
- uncertain: whether the first launch of a new icon can use anything Safari had cached. Assume not: the first
  launch of Fuel needs a connection.

**What an icon opens**
- known: with a manifest, the icon opens `start_url`, and navigations inside `scope` stay in the app.
- code: `manifest.webmanifest` has had `start_url: "./index.html"` and `scope: "./"` since the first commit
  (`0e4d926`, its only one). The icon on the phone opens `/overload/index.html`.
- So after the change the existing icon opens the same address in the same storage, gets 3.0 through the
  update of section 2.6 and keeps its data. Nothing has to be added again.
- known (by wide report), uncertain in detail: the name and picture of an icon are fixed when it is added,
  and iOS does not re-read the manifest of an installed app. The redesigned Overload icon will **not** appear
  on the phone. Getting it means deleting and re-adding the icon, which deletes the data of that app.

**Following a link from a Home Screen app**
- known: a link to an address inside the app's scope opens inside the app. `/overload/fuel/` is inside
  Overload's scope (`/overload/`). A link or redirect to `./fuel/` from the installed Overload therefore opens
  the diet page **inside the Overload app**: Overload's storage, Overload's worker, no Safari toolbar, no
  Add to Home Screen.
- known: a link outside the scope opens in an in-app Safari view on top of the app, with a control to
  continue in Safari. From Fuel (scope `/overload/fuel/`) a link to `../` is outside its scope.
- known: iOS does not hand a link over to another installed web app.
- uncertain: which storage that in-app view uses.
- uncertain: what `target="_blank"` or `window.open` does for an address inside the scope.
- Consequence: there is no dependable way to send the owner from the installed Overload to Safari. The
  repo has no address outside Overload's scope. Most dependable: show the address and a Copy link button, and
  say "open Safari, paste". `navigator.share({ url })` opens the share sheet; whether it offers Safari is
  uncertain. `x-safari-https://…` links are undocumented and uncertain.

**Two apps from one site**
- known: possible. Each Add to Home Screen takes the manifest, `apple-touch-icon` and
  `apple-mobile-web-app-title` of the page that is open. From iOS 16.4 a web app is identified by the manifest
  `id`, which defaults to `start_url`. Different `start_url`, different apps.
- uncertain: how a future iOS treats a scope nested inside another app's scope. Today each app applies only
  its own scope to its own window.

**Clipboard**
- known: `navigator.clipboard.writeText()` works in Safari and in Home Screen apps when called directly in a
  tap handler. `app.js:1855` already has such a call, but only as a fallback that an iPhone never reaches.
- known: if the text is produced asynchronously first (gzip with `CompressionStream` is asynchronous), Safari
  can refuse the write because the tap is over. Either prepare the text before the tap, or call
  `navigator.clipboard.write([new ClipboardItem({ 'text/plain': promiseOfBlob })])` inside the tap, which
  Safari supports for this.
- known: `navigator.clipboard.readText()` needs a tap, and iOS shows a small Paste bubble that must be
  tapped. Uncertain: whether text copied in the Overload app counts as "same site" in the Fuel app (probably
  not, so expect the bubble).
- known: a text box the owner pastes into always works. Read it from the `paste` event rather than letting
  the box display megabytes.
- uncertain: size limits. A year of diary is likely several hundred KB of JSON; no documented limit applies,
  but it is untested.

**Files**
- known: `<input type="file">` opens the Files picker in a Home Screen app. Overload's import already uses
  one (`app.js:425`, `accept="application/json,.json"`, `app.js:2372`).
- known: `navigator.share({ files: [...] })` opens the share sheet with Save to Files. Overload's export
  already uses it (`app.js:1969-1974`), with an `<a download>` fallback (`app.js:1979-1984`) that is not
  dependable in a Home Screen app.

**Other**
- known: Web Push only reaches Home Screen apps, iOS 16.4 or later (`README.md:292`). The subscription belongs
  to the root worker's registration (`connector.js:217`, `connector.js:249`).
- uncertain: `apple-mobile-web-app-status-bar-style` is `black-translucent` (`index.html:11`): white status
  bar text over the page, read when the app launches. It cannot follow the in-app theme switch
  (`app.js:475` only changes `theme-color`). Check the light theme's top bar on the phone.

## 5. Manifests and meta tags

### Overload (`manifest.webmanifest`, 16 lines)

| Field | Today | For 3.0 |
| --- | --- | --- |
| `name`, `short_name` | `Overload` | keep |
| `start_url` | `./index.html` | **keep exactly** |
| `scope` | `./` | **keep exactly** |
| `id` | absent, so it is the start address | **keep absent** |
| `display`, `orientation` | `standalone`, `portrait` | keep |
| `description` | "Personal hypertrophy tracker with rep-range progression." | free |
| `background_color`, `theme_color` | `#111214` | free (new design) |
| `icons` | `./icon-180.png`, `./icon-512.png`, `./icon.svg` | free; if a file name changes also change `index.html:14-15`, `sw.js:15-17` and `sw.js:114` |

### Fuel (`fuel/manifest.webmanifest`, new)

```json
{
  "name": "Fuel",
  "short_name": "Fuel",
  "description": "Calories and macros.",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#……",
  "theme_color": "#……",
  "icons": [
    { "src": "./icon-180.png", "sizes": "180x180", "type": "image/png" },
    { "src": "./icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "./icon.svg", "sizes": "any", "type": "image/svg+xml" }
  ]
}
```

- Relative values resolve against the manifest's own address: `start_url` becomes `/overload/fuel/index.html`,
  `scope` `/overload/fuel/` (seen in Chromium, T13).
- `id`: leave it out, or write the full path. A relative `id` resolves against the **site root**, not the
  folder. Seen in Chromium: `"id": "./index.html"` in a manifest under `/overload/fuel2/` gave the id
  `/index.html`; no `id` gave `/overload/fuel/index.html`; `"id": "/overload/fuel3/"` gave that.
- Once the owner has added Fuel, its `start_url` and `id` are as fixed as Overload's.
- A query on `start_url` (to tell "opened from the icon") works with the worker as written: the page test
  compares the path only (`sw.js:81`), and the stored-copy fallback returns `./index.html` for a navigation with
  no exact match (`sw.js:82`). The page would also be stored once more under the address with the query.
- The 180 px icon should have no transparency (iOS paints transparent areas black).

### Tags in each page

Overload has these at `index.html:5-15`. Fuel needs the same set with its own values.

| Tag | Overload (today) | Fuel |
| --- | --- | --- |
| `<meta name="viewport">` | `width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1` (`index.html:5`) | same |
| `<title>` | `Overload` (`index.html:6`) | `Fuel` |
| `<meta name="description">` | `index.html:7` | own text |
| `<meta name="theme-color">` | `#111214` (`index.html:8`); `app.js:475` rewrites it to `#f3f3f5` or `#111214` | the design's colours, in the tag and in the shell's theme code |
| `apple-mobile-web-app-capable`, `mobile-web-app-capable` | `yes` (`index.html:9-10`) | same |
| `apple-mobile-web-app-status-bar-style` | `black-translucent` (`index.html:11`) | same, or decided with the design |
| `apple-mobile-web-app-title` | `Overload` (`index.html:12`) | `Fuel` (this is the name offered under the icon) |
| `<link rel="manifest">` | `./manifest.webmanifest` (`index.html:13`) | `./manifest.webmanifest`, i.e. Fuel's own |
| `<link rel="apple-touch-icon">` | `./icon-180.png` (`index.html:14`) | `./icon-180.png`, i.e. `fuel/icon-180.png` |
| `<link rel="icon">` | `./icon.svg` (`index.html:15`) | Fuel's own |
| Theme script | reads `overload.theme` (`index.html:20`, `index.html:25`) | reads Fuel's own key |
| Start-up rescue | `index.html:29-85` | a copy with Fuel's cache prefix, main script, data key (table in 1.7) |

All of Fuel's addresses in `fuel/index.html` should be written with `./` (own files) or `../` (shared files).
A `<base>` tag would also move `./sw.js` and must not be used.

## 6. `bump.sh` and versions

Today (`bump.sh`, 14 lines): reads the old release from `app.js` (`bump.sh:8`) and the cache counter from
`sw.js` (`bump.sh:9`); replaces `?v=OLD` in `index.html` and `sw.js` (`bump.sh:10`); adds 1 to the cache counter
(`bump.sh:11`); sets `VERSION` in `app.js` (`bump.sh:12`); prints how many lines now carry the new `?v=`
(`bump.sh:14`, 14 today). It does not know `fuel/`, and it does not touch `?db=`.

Proposal:

1. **One release number for the whole repo**, the same in both apps (3.0, 3.1, …). Reasons: shared files are
   referenced by both pages and both workers under one `?v=`; `pageFits` (`sw.js:32`) and the rescue
   (`index.html:73`) both compare numbers and stay simple; one number to tell the owner. T9.2 against T9.3
   shows one case where two different numbers hurt.
2. **Two cache names with their own counters**: `overload-v24` (next after 23) and `fuel-v1`. Both go up at
   every release, also when only one app changed. A worker file that did not change byte for byte never
   updates, and a page with a new `?v=` and an old worker cannot install (`pageFits`), so "bump both" is the
   safe rule.
3. `bump.sh` does, for `<new>`:
   - `?v=OLD` → `?v=NEW` in `index.html`, `sw.js`, `fuel/index.html`, `fuel/sw.js`;
   - `overload-vN` → `N+1` in `sw.js`, `fuel-vM` → `M+1` in `fuel/sw.js`;
   - `VERSION` in `app.js` and in the diet shell;
   - then checks: no `?v=OLD` left in those four files; every `?v=` in each page is the new one; the `?db=`
     in the diet copy of `food.js` equals the one in `fuel/sw.js`; and fails loudly otherwise.
4. Cost per release: Overload downloads about 0.3 MB again, Fuel about 2.3 MB (the food list and the barcode
   reader), as today in total. If that is too much later, the diet worker's install can copy an entry from
   the previous `fuel-` cache when its address carries its own version and is unchanged (`foods.json?db=5`);
   the reader files would need a version in their address first. Not needed for 3.0.
5. The rescue should accept an older release only of the same app and the same major number (SPEC section 7):
   compare the full path of the main script, not `/app.js`, and compare the part before the first dot of `v=`.
   Calling the diet shell something other than `app.js` removes the T9.2 case as well.

Built as proposed, with the training app's main script renamed `overload.js`, and extended after the review
(T2): see section 10.

Roll-back: publishing the v2.8 files again works for the training app. Its `sw.js` differs from 3.0's, so it
installs, recreates `overload-v23` and deletes `overload-v24`. It leaves `fuel-…` caches alone (prefix test,
v2.5 and later). A storage where a diet worker is active keeps running the diet app from its cache; the diet
worker's update check just fails while `fuel/sw.js` is gone. So after a roll-back, 3.0 may be published again only
unchanged; a fix needs a number higher than any published before (round-5 finding pub#1: `fuel/sw.js` byte for byte
the same never installs again, and the changed pages would run with `fuel-v1`'s old files). `sh bump.sh --check`
compares with the newest published commit that carries the tree's release, not only with `origin/main`'s newest
commit. Publish the v2.8 files as a new commit on top of `main` (`git revert`, or a commit of v2.8's files), never by
moving `main` back with a force-push: the check sees only `origin/main`'s history and this clone's record of what
`origin/main` was (its reflog, round 6 fp#1), and a clone made after the force-push has no such record.
`sh bump.sh <N>` numbers both caches above every published one (round 6 cache#1), so a fix after a roll-back of 3.1
never takes 3.1's `overload-v25` or `fuel-v2`.

## 7. Paths the workflows and tools depend on

| Path | Used by | Note |
| --- | --- | --- |
| `data/foods.json` | written by `build-foods.yml:45`, committed at `build-foods.yml:60`; read by `food.js:30`, `sw.js:13` | **must not move.** Built on the `food-data` branch and merged into `main` (`README.md:334-339`) |
| `tools/build_foods.py` | run at `build-foods.yml:45`; trigger path `build-foods.yml:8` | reads `tools/staples.tsv` (`build_foods.py:111`), `tools/branded.tsv` (`:176`), `tools/branded_off.tsv` (`:199`) next to itself |
| `tools/staples.tsv`, `tools/branded.tsv`, `tools/branded_off.tsv` | trigger paths `build-foods.yml:8` | must stay next to the scripts |
| `tools/off_fill.py` | run at `off-fill.yml:20`, trigger `off-fill.yml:8` | reads `tools/branded_wishlist.txt` (`off_fill.py:36`), `tools/branded.tsv` (`:64`), `tools/branded_off.tsv` (`:66`); output committed as `tools/branded_off.tsv` (`off-fill.yml:20`, `:26`) |
| `tools/build_branded_index.py` | run at `build-branded-index.yml:35`, trigger `:9` | output goes to the orphan branch `food-raw` as `branded_index.tsv.gz` and `release.txt` (`:42-49`); read back at `build-foods.yml:34-36` |
| `tools/pick_branded.py`, `tools/branded_wishlist.txt` | run by hand (`README.md:345-346`) | reads the wishlist next to itself (`pick_branded.py:56`) |
| `connector/**` | trigger `deploy-connector.yml:13`; `working-directory: connector` (`:70`, `:75`, `:83`); `connector/wrangler.toml` edited at `:65`; `connector/package.json` pins wrangler | **must not move** |
| `connector.json` (repo root) | written at `deploy-connector.yml:135`, committed to `main` (`:141-144`); read by `connector.js:68` as `./connector.json` | stays at the root with the training app. Today `{ "url": "" }` |
| `connector/wrangler.toml` `APP_URL` | `https://gabrieldemman1-hub.github.io/overload/`, used for the notification link and the push sender id (`connector/worker.js:183`, `:239`) | still right: the training app keeps that address |
| `.nojekyll` (empty, repo root) | GitHub Pages | keeps Pages from running Jekyll, so every file is published as it is. Must stay at the root. It covers `fuel/` too |
| `.github/workflows/*.yml` | each lists itself as a trigger path | names must not change |

Other facts:
- Three workflows run only on the branch `food-data` (`build-foods.yml:7`, `off-fill.yml:7`,
  `build-branded-index.yml:8`). Only `deploy-connector.yml` runs on `main`, and only when `connector/**` or the
  workflow file changes (`deploy-connector.yml:11-13`). Without the Cloudflare secrets it prints a notice and
  does nothing (`deploy-connector.yml:41-44`). So editing `connector/worker.js` for 3.0 (for example the food
  reminder, `connector/worker.js:254`) starts that workflow on the push to `main`.
- `build-foods.yml:51` sends the origin `https://gabrieldemman1-hub.github.io` in a test request to Open Food
  Facts. The diet app has the same origin, so nothing changes there.
- The branches `food-data` and `food-raw` are not in this clone (`git branch -a` shows only `main`). I did not
  look at them. If `food.js` moves into `fuel/`, the next merge of `food-data` into `main` has to be checked
  for a second copy at the old place.
- `vendor/zxing/` is used by `food.js:879-880`, `sw.js:19-21` and `lab/scan.html:126-128` (as `../vendor/zxing/`).
  No workflow touches it. Leaving it where it is keeps `lab/scan.html` working.
- Pages publishes the whole `main` branch. `dev/` and `tests/` would be reachable at `/overload/dev/…` once
  they are on `main`.

## 8. Hazards

| # | What can go wrong | Precaution |
| --- | --- | --- |
| H1 | A diet page handled by the root worker gets the **training page** on a slow, failed or 404 answer (T2). The owner sees "Overload did not finish starting" at the Fuel address | Skip `fuel/` in the 3.0 root worker (2.3). The v2.8 worker cannot be changed any more: tell the owner to open Fuel the first time with good signal. Opening it also updates the root worker in that storage (T3b) |
| H2 | A cache named `overload-…` is deleted at the next training release (`sw.js:57`; T4) | Diet cache `fuel-vN`. Diet worker deletes only `fuel-…` |
| H3 | The owner deletes the old icon to get the new picture or name. iOS deletes that app's data | Say so in the release note and in the app. The new icon cannot reach the existing Home Screen icon |
| H4 | Fuel is used in the wrong storage: opened by a link inside the installed Overload (in scope, section 4), or in a Safari tab before it is added to the Home Screen. What is logged there is not in the Fuel app | In Fuel, on an iPhone and not standalone: show how to add it and take no data. Standalone with `overload.state.v1` present and no Fuel data: it is running inside Overload, show the same. Do not register `fuel/sw.js` in those cases |
| H5 | v2.8 runs again after 3.0 has run (slow start, no signal), until the 3.0 worker is installed (T8). It shows the Food tab, changes food data, and syncs `foodDays`. In 3.0 as released it is pure v2.8 (`app.js`, `styles.css`, `food.js` are not on the server; section 10), and 3.0's rescue no longer starts v2.8 (T9) | State written by 3.0 must load in v2.8. The transfer to Fuel must cope with food changed after the copy was made (merge by id; offer the copy again when the food part changed). The sync split must cope with a v2.8 client. Remove refuses beside a sync module of another release |
| H6 | The page reloads by itself seconds after 3.0 first starts (T7, T11). A first-run sheet or a copy in progress is lost. A diet page first opened under a root worker is reloaded when its own worker takes over (2.1) | Hold the reload while a sheet is open as well. Keep first-run state in storage, not in memory. In the diet page, treat only the diet worker as "had a controller" |
| H7 | The rescue runs older files against a newer page. Across the redesign that is v2.8 code on 3.0 HTML. A stray `fuel/app.js` entry in a training cache makes it pick the wrong release (T9.2) | Same app and same major release only; match the full path; do not name the diet shell `app.js`, or keep one release number (T9.3). Done in 3.0: same first number only, full path of `./overload.js` (and `./fuel.js` in Fuel), one release number |
| H8 | `food.js` under `fuel/` asks for `fuel/data/foods.json` and `fuel/vendor/…` (2.7): no food search, no scanner. A `?db=` mismatch breaks search offline only, which is easy to miss | `../` in three places. `bump.sh` checks `?db=`. Test the diet app with no network |
| H9 | `bump.sh` forgets `fuel/`: the diet app never updates, or its page and worker disagree and every install fails | Extend `bump.sh` with the checks of section 6 |
| H10 | Root `start_url`, `scope` or `id` changed, or `sw.js` moved | Keep them (section 5, 2). A relative `id` points at the site root (T13) |
| H11 | A 3.0 page whose reload is held back keeps running v2.8 under the 3.0 worker; its Food tab cannot load the food list offline (T11) | Accept; it ends at the reload |
| H12 | `caches.match` in a worker or page finds an entry in another app's or another site's cache | Diet worker reads only its own cache |
| H13 | A roll-back to a release older than v2.5 deletes every cache on the origin, the diet app's and other sites' included | Roll back to v2.8, not further |
| H14 | `notificationclick` focuses a diet window instead of opening Overload when both run in one storage (`sw.js:121`) | Exclude `fuel/` (2.3) |

## 9. Open questions

1. iPhone: are worker registrations and caches of a Home Screen app really separate from Safari's and from a
   second Home Screen app's on the owner's iOS version? Everything here assumes yes. It decides whether cases
   T2 and T3 can happen on the phone at all outside the "link inside Overload" path.
2. iPhone: what is the best way to get from the installed Overload to Safari at the Fuel address (Copy link,
   share sheet, `x-safari-https:`)? Needs the phone.
3. iPhone: does iOS ever refresh the name, icon or scope of an installed web app?
4. iPhone: does `navigator.clipboard.readText()` work in a Home Screen app for text copied in another one,
   and how large can the text be?
5. Which release is on the phone now? Settings shows it ("Overload · v2.8"). If it is older than v2.8 the
   worker in control has no `pageFits` and the page has no rescue.
6. Is Overload also open in Safari or on another device (an old worker and old data there)?
7. Safari during a first diet worker install: root worker in control (as Chromium) or nobody (as the spec)?
8. Should the diet page refuse to run when not standalone on an iPhone (H4), or only warn? A product decision.
9. Do the `food-data` and `food-raw` branches hold anything that conflicts with moving `food.js`? Not in this
   clone.

## 10. Since the fixes (3.0 as released)

Read from `sw.js`, `fuel/sw.js`, `index.html`, `overload.js`, `sync.js` and `bump.sh` of 3.0, and run by
`tests/train-sw.js`, `tests/train-mixed.js`, `tests/train-rescue.js`, `tests/train-timer.js`,
`tests/train-bump.js` and `tests/fuel-sw.js` (Chromium, real workers, a local server that ignores the query as
GitHub Pages does).

**Names.** The training app's main script is `overload.js` (it was `app.js`); its stylesheets are
`shared/ui.css` and `train.css` (v2.8 had `styles.css`); `food.js` lives in `fuel/`. Those three v2.8 names stay
unused at the root, and `bump.sh` fails when one exists: v2.8's stored page asks the server for them, and with
nothing there v2.8's worker answers from its own copies, so a v2.8 page never runs 3.0's main script (U1, U2,
section 2.6). `sync.js`, `connector.js`, `programs.js` and `backup.js` kept their names (a v2.8 page can get
3.0's copies of them; that combination is tested).

**Fetch: `?v=` files cache-first.** A same-site address with `?v=` (not a page) is answered from this worker's
own cache (`caches.open(CACHE)`, not every cache of the origin); the network is asked only when the entry is
missing, and its answer is then stored as before. The copies the install stored are therefore the release's
files for the whole release: the server, which ignores `?v=`, cannot replace them with the next release's once
that is published (O1). Pages, files without `?v=`, the food list under `?db=` (Fuel) and the Firebase SDK stay
network-first, with the stored copy after `NET_WAIT` (3 s) or on an error, as in section 1.5. Consequence: a
change pushed without a new release number never reaches a phone that has the release (corrected in section 12:
the changed page does, and runs with the old copies of the other files).

**Install.** Still all or nothing (1.3). Beside `pageFits` for the two page entries, it reads the release marker
of the main script and refuses the install unless the marker is there exactly once and names this release:
`const VERSION = '<release>'` in `overload.js` (root) and in `fuel.js` (Fuel), and, in the root worker,
`release: '<release>'` in `sync.js`. A main script or sync module left over from the previous release (a server
can still hand one out for minutes after a release) therefore fails the install, and the phone stays on the
release it has.

**At run time: the 409.** When the network is asked for a main script or (root) `sync.js` under a `?v=` and its
marker names another release (or more than one), the worker answers `409 Another release` instead, and stores
nothing. A page whose main script got the 409 does not start it: the start-up rescue takes over. A `sync.js`
that got it is not run, and the app runs without cloud sync until the update has arrived. A file without a
marker (v2.8's `sync.js`) is accepted, so a roll-back to v2.8 is not affected. (Changed since: every versioned
file now has a marker, and one without is refused too; a roll-back still works, see section 11.)

**Start-up rescue.** The main script is found by its full path (`./overload.js`; Fuel: `./fuel.js`), only
caches of the app's own prefix are read, and only an older release with the same first number is used (3.0 for
a 3.1 page, never 2.8 for a 3.0 page). Every script and stylesheet is swapped to that release. Without such a
release the page says "Overload did not finish starting." For the first update from v2.8 the rescue therefore
never runs v2.8 code on the 3.0 page; v2.8 itself starts instead when its worker answers with its stored page
(T8). `bump.sh` needs `--major` for a new first number, because the rescue has nothing to fall back to then.

**bump.sh** (T2): a release number is two whole numbers with a dot, no leading zero, higher than the current
one compared number by number; `--major` for a new first number. It sets `?v=` in the four files, `VERSION` in
`overload.js` and `fuel/fuel.js`, `release` in `sync.js`, and both cache names. `--check` (and every bump) fails
when a `?v=`, `VERSION` or `release` differs, when a release marker is there more than once (a comment counts),
when `app.js`, `styles.css` or `food.js` is at the root, when an install list names a file that is not on disk,
when a page loads a versioned file its worker does not list, and when `?db=` differs between `fuel/food.js` and
`fuel/sw.js`.

**Reload during a workout** (O4). The page still holds the update's reload during a workout, while typing and
while a sheet is open ("Update ready" instead). A running rest or cardio timer is kept in `sessionStorage`
(`overload.timer`) and started again after the reload; a cardio timer that ran out meanwhile logs the cardio.
This helps from 3.0 on: v2.8 kept the timer in memory only, so the update from v2.8 itself drops it.

**Seen with real workers** (`tests/train-mixed.js`): v2.8 installed, then this tree on the server, with the page
slow, the scripts fast, every script slow, the page fast, and no signal: the page that runs is pure v2.8 or pure
3.0, never a mix, and v2.8's stored page, `app.js`, `styles.css` and `food.js` keep v2.8's bytes. A rehearsed 3.1
(made by `bump.sh` in a copy): with the page slow the stored 3.0 runs only 3.0's files, also with no signal, and
its stored copies are not overwritten; with the page fast 3.1 runs whole; when 3.1's main script does not arrive
the rescue runs the stored 3.0 whole; an install whose main script or sync module is not 3.1's is refused.

Not covered here, as before: Safari and iOS, and how GitHub Pages' CDN behaves. A stale edge that serves one
file without a marker (a stylesheet, `programs.js`) under a new `?v=` during an install would be kept for the
whole release. (Fixed since: section 11.)

## 11. Since the final review (release mechanics)

Findings upgrade#1 to #5 of the final review and one item of the code review's list. Read from `sw.js`,
`fuel/sw.js`, `index.html`, `fuel/index.html` and `bump.sh`, and run by `tests/train-release.js` and
`tests/fuel-release.js` (a sealed browser, real workers, a server that ignores the query), `tests/train-sw.js`,
`tests/fuel-sw.js`, `tests/train-mixed.js` and `tests/train-bump.js`.

**Every versioned file names its release.** Besides `VERSION` (both main scripts) and `release:` (Overload's
`sync.js`), every other script and stylesheet with `?v=` in an install list starts with the line
`/* release 3.0 (bump.sh sets this line; …) */`: `programs.js`, `backup.js`, `connector.js`, `train.css`,
`shared/ui.css`, `shared/icons.js`, `fuel/food.js`, `fuel/sync.js`, `fuel/backup.js`, `fuel/fuel.css`. The workers
read the release after `/* release ` and want it exactly once. The install refuses every versioned file whose
mark is not the release of its address, so v2.8's `backup.js` and `connector.js` (no mark) from a stale edge
fail the 3.0 install: the phone stays on v2.8 and the next start tries again (upgrade#1: a second "Remove the old
food log" no longer writes over the first one's safety copy). At run time (no stored entry, the network asked)
such a file, or one without a mark, gets `409 Another release` and is not stored, whatever its kind.

**A page that lost a file.** Without its main script the rescue takes over, as before. A page whose main script
ran but which lost a classic script or a stylesheet (refused, or not arrived) starts without it, and its start-up
script puts a line above everything: "Part of Overload did not load, so it looks plain." for a stylesheet, "…,
so some of it may not work." for a script, then "Everything you logged is still on this phone." (when there is
data) and "Close the app and open it again where there is signal or Wi-Fi." Fuel's page says "Part of Fuel …".
Module scripts are left out (`sync.js` cannot load offline when the Firebase files are not stored).

**Install: delete unfinished caches, download and check everything, then store.** At the start of each install
the app's caches that are not `CACHE` and lack the entry `installed` are deleted (`overload-vN` above 23, since
2.8's `overload-v23` never has the entry and may belong to the running worker; `fuel-vN`). Then every file of
the list is fetched whole and checked (page fits, marks), and only then are they put into `CACHE`, with
`installed` (its text is the release) last. An install that fails or is stopped while downloading changes no
cache at all (upgrade#4: no half-filled cache from a worker stopped in the background). One that fails while
storing deletes `CACHE` only if it was not there before (`caches.has`), since it may be the cache the running
worker serves from (upgrade#3: a changed worker under the same cache name).

**Lookups in the worker's own cache only.** `cached()` of both workers opens `CACHE`; nothing searches every
cache of the origin. (Fuel's `keepSdk` still copies the Firebase files from its previous caches at activate.)

**Pages from the network.** One that asks for this release's files is stored and shown, as before. One whose
every `?v=` is newer than the worker's release is shown but not stored (an update on its way). Any other (an
older release from an edge that has not caught up, or a page with no `?v=`) is answered with the stored page
when there is one (upgrade#2: after an update, an old page no longer ends in "did not finish starting").
Releases compare as two whole numbers, as in the rescue. A roll-back to v2.8 still works: until v2.8's worker
has installed and taken over, the phone shows its stored 3.0 page (reviewer's `s3-rollback.js`, rerun).

**Start-up rescue.** It uses only caches that hold `installed`: of those whose release is older than the page's
and has the same first number, the newest, and it takes every file from that one cache (a main script missing
there: the note). A module script that loaded is not run a second time from the stored copy: at a 3.0 -> 3.1
update where `overload.js?v=3.1` failed but `sync.js?v=3.1` ran, 3.0's `sync.js` would have been a second sync
module on the same Firebase app.

**bump.sh.** It sets the first-line marks with every new number, and `--check` fails when one names another
release or is not there exactly once. `--check` also fails when `sw.js` or `fuel/sw.js` differs from the published
one while its cache name is the same. "Published" is `origin/main` (GitHub Pages serves `main`), not `HEAD`: a
change committed but not pushed is still caught, and an unpublished release under development is compared with
what phones have. The comparison is skipped without git, without `origin/main`, outside the repository's own
root, and for a worker that is new since then (`fuel/sw.js` against 2.8's `main`). README "Rebuilding the food
list" now says to run `sh bump.sh` with the next release after moving `?db=`.

**Tests see what a phone keeps** (upgrade#5). `tests/lib.js` has a sealed mode: `launch({ sealed: true })` makes
every host but 127.0.0.1 unresolvable and sends every other request to a proxy in the test process that refuses
it; `newPhone({ sealed: true })` has no routing. Under Playwright routing Chromium installed the same `sw.js`
again at every start (14 times for one phone of `train-sw.js` with routed phones). `lib.watchWorkers` counts
worker versions over CDP, and the worker tests fail when the same worker file finished installing twice.
`lib.coldPage` opens a page whose requests skip the browser's memory and HTTP caches, as a Home Screen app's cold
start does; without routing a reload otherwise takes scripts from memory and the worker never sees them. Tests
that need the stand-in Firebase files (routing) keep routed phones: `train-mixed.js` before 3.0, `fuel-sw.js`
phones 1, 3, 5 and 6, `train-sync.js`, `fuel-sync.js` and the other cloud tests.

Not covered, as before: WebKit on an iPhone (whether it stops a worker mid-install, its caches), and how long
GitHub Pages' edges hand out old files.

## 12. Review round 4 (release: rel#1 to rel#6)

Run by `tests/train-bump.js`, `tests/train-release.js` (sections v28, preload, line), `tests/fuel-release.js`
(preload, line) and `tests/train-mixed.js` (sync28).

**A change under the published release** (rel#1). Section 10 said such a change never reaches a phone. The page
does: it is network first and stored whenever it names the release (`pageFits`), while every `?v=` file stays the
stored copy. So the phone ran the new page with the old scripts and stylesheets, also offline, for the whole
release; two branches that each ran `sh bump.sh 3.1` merge cleanly and lead there too. `bump.sh` (check 5) now
reads the published release (`VERSION` in `origin/main`'s `overload.js`); when it is the tree's, every page and
every `?v=` file in the install list of a worker that was published must equal its published copy, or the check
fails naming the file and the next number. Skipped where the worker comparison is skipped. Files without `?v=`
(icons, manifest, food list, barcode reader) are left out: they are network first, so a change reaches phones.

**Not in git, not published** (rel#3). In a git repository (run from its root) the check fails for a file of an
install list, a page or a worker that git does not track, and names files with changes not committed yet in a
warning (not a failure).

**2.8's worker in charge** (rel#2, rel#6). During the first starts of 3.0 on a phone that had 2.8, 2.8's worker
(network first, checks nothing) hands out whatever the server has. For the names both releases use, the 3.0 page
could run 2.8's `backup.js`, `connector.js` and `sync.js`; `programs.js` differs only in its first line, the
stylesheets and `shared/icons.js` are new names, and `fuel/` has no 2.8 files. `backup.js` and `connector.js` now
carry `release: '3.0'` (set and checked by `bump.sh`, like `sync.js`'s), and `overload.js` uses a helper module
only when it names `VERSION` (`part`): otherwise no automatic copies (Remove, Reset, Import and Restore refuse, as
without `backup.js`), no WHOOP or Reminders card, and the cloud card says sync is not available. A sync module of
another release is given nothing: the host's `unreadable` is true beside one, so 2.8's `link()` and `push()`
return at once (it had brought an old food log removed on 3.0 back onto the phone: `sync.md` 3.3). The page's
load handler asks `window.__overload.otherParts()` and shows the line "Part of Overload did not load, so some of
it may not work." for any of them. 2.8's `connector.js`, once it has run, still reacts to saves and returns to the
app (WHOOP nights, its reminder times with the food reminder) until 3.0 has taken over.

**The line at the top** (rel#5) hides nothing, below the status bar. With `shared/ui.css` the top bar is fixed at
the top, so the line is fixed there too and takes the place of the status bar's strip: its padding starts with
`env(safe-area-inset-top)`, and the page sets `--safe-top` to its height, which moves the bar, the screen, the
save warning, the toasts and the sheets down by it (on resize too). Without the stylesheet the line is the first
thing on the page and pushes the rest down. Checked at 390 and 320 px, dark and light, with a 47 px inset
emulated (`Emulation.setSafeAreaInsetsOverride`), with a script missing, without the app's stylesheet and without
any: the line overlaps nothing of the top bar, the screen or the tab bar.

**The sealed browser runs without `ServiceWorkerAutoPreload`** (rel#4). That Chromium feature answers the first
navigation after a stopped worker starts again from the HTTP cache, where a failed install's `cache: 'reload'`
fetch has just put the next release's page; WebKit asks the worker. A test that stops workers over CDP now sees
the stored page, as a phone does. `lib.coldPage` skips the HTTP cache, which also hid the difference, so the
preload checks start an ordinary page.

Not covered: WebKit and a real notch; a phone with no worker at all (a Safari tab) meeting a stale `fuel/`
file of another 3.x release, since only Overload's helper modules name a release the page reads.

## 13. Review rounds 5 and 6 (release: pub#1, pub#2, split#1, pill#1, ask#1; round 6: fp#1, cache#1, hint#1, order#1)

Run by `tests/train-bump.js`, `tests/train-release.js` (section v28), `tests/train-mixed.js` (sync28) and
`tests/train-replace.js` (automatic copies not available).

**Published before, not only now** (pub#1). Check 5 read the published release only from `origin/main`'s newest
commit. After a roll-back (v2.8's files published again, section 6) that is 2.8, so a 3.0 changed and published
again under 3.0 passed, and phones that kept `fuel-v1` (and a phone not opened during the roll-back, `overload-v24`)
ran the new pages with their old files: `fuel/sw.js` byte for byte the same never installs again. `bump.sh` now
compares with the newest commit on `origin/main`'s own line (its first parents, each of them the published site
for a while) whose `overload.js` carries the tree's release: the pages, the `?v=` files and the workers under the
same cache name, with the same messages. The same 3.0 published again unchanged passes; a fix needs a number higher
than any published before.

**Fetched first** (pub#2). `origin/main` is the copy of the last fetch: with a pull request merged on GitHub and
not fetched, a second branch with the same number passed. `bump.sh` now runs `git fetch -q origin main` (at most
about 20 s: `timeout` where there is one, and git's low-speed limit) when a remote `origin` exists, and prints
`published: origin/main at <commit>, release <N>`. A fetch that fails is a warning with the date of the copy it
compared with; `BUMP_NO_FETCH=1` compares with the copy without fetching (the tests' copies of this repository,
whose origin is GitHub, and any agent here).

**2.8's helper modules during the first starts of 3.0** (split#1, pill#1, ask#1; round 4, rel#2 and rel#6, made
them unused). The split copy is the one exception: with 2.8's `backup.js` on the page, `keepSplitCopy` stores it
through 2.8's `take('split', raw)`, which writes `before-split` exactly as 3.0's does, and 2.8 never clears it out.
Before, the copy waited for a start with 3.0's `backup.js` and then held what 3.0 had saved meanwhile (a setting
changed in that start). `setSyncStatus` ignores what a sync module of another release reports: 2.8's said "Synced"
whenever the signal dropped or came back, while the card said sync is not available. Without a `backup.js` of this
release, Remove the old food log, Reset and Import refuse before their questions (which promise a safety copy), with
"Automatic copies are not available right now, so nothing was … Close Overload and open it again with good signal."
(Remove: a toast; Reset and Import: their sheet with Export). With the module there and a copy that cannot be
stored, the order stays: the questions, then the refusal.

Not covered: a start where no `backup.js` loaded at all still leaves the split copy to a later start, which then
holds what was saved meanwhile.

Round 6, run by `tests/train-bump.js` (fp#1, cache#1, hint#1, and a fresh and a shallow clone):

**Rolled back by a force-push** (fp#1). Moving `main` back to v2.8's commit (`git push -f`) leaves no commit of
`origin/main`'s history that carries 3.0, so a changed 3.0 passed again; when the force-push was made elsewhere, the
round-5 fetch took away the stale `origin/main` that had refused it. "Published" is now `origin/main`'s own line and
then each commit this clone saw `origin/main` at that is not on it, with its own first parents (`git log -g`, newest
first; an entry whose commit is gone is skipped), read once by `read_published` before the change and the checks.
The fetch writes that record, so a force-push made elsewhere counts once it is fetched here. Each entry's old value
counts too: `git gc` drops an entry about 30 days after its commit left `origin/main`, but the force-push's own
entry, which names what `main` was before it, stays 30 days after the force-push. A shallow clone (a cloud session
clones 50 commits) fetches `main` with `--unshallow` first; when that fails, or with `BUMP_NO_FETCH`, a line warns
"this clone has origin/main's history only back to <date> (a shallow clone), …" (`SHALLOW_CUT`: a commit of the
clone's `shallow` file on the published line). A clone made after the force-push (a fresh clone's record is empty)
cannot know: section 6 and README say to roll back with a new commit instead.

**Cache names above every published one** (cache#1). After 3.1 was rolled back (`git revert`), `sh bump.sh 3.2` took
the tree's cache number + 1, `overload-v25` and `fuel-v2`, 3.1's own, and phones still on 3.1 installed 3.2 into the
cache their running worker serves from. `sh bump.sh <N>` now takes one more than the highest of the tree's and every
published worker's. Check 5 also compares a worker with the newest published commit whose worker had its cache name
("… differs from the published one (origin/main at <commit>, release 3.1), but its cache is still overload-v25"). The
newest only: a branch merged with all its commits (fast-forward or rebase) puts workers on `main`'s line that changed
under one name before it was published, and comparing with each of them would refuse every later check.

**The next number** (hint#1). The FAILED lines name one more than the highest release published (rolled back or not)
and the tree's, not the tree's + 1, and when the tree's release is below it, one line says so: "release 3.1 was
published before (rolled back): a fix needs 3.2" ("release 3.1 is published: …" on a branch older than the tip).

Not covered (order#1): the check sees a pull request only once it is merged. Two release pull requests checked while
both are open pass, and merging both on GitHub publishes the second one's changes under the first one's number. README
says to run the check on a branch again right before its pull request is merged, after merging `main` into it.
