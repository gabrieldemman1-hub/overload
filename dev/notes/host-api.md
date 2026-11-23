# The interface between food.js and the rest

Scope: what `food.js` takes from its host (`app.js` today, a new small shell in Fuel), what the host calls on `food.js`, what `food.js` expects in the page, and what has to come out of the training app. Read from the code at v2.8 (branch `claude/split-training-diet`), then checked in a browser (section 9 says how).

Short version:

- `food.js` uses **six members** of `window.__overload` (`state`, `screen`, `saveFailed`, `save`, `render`, `lib`) and **twelve helpers** in `lib`. Nothing else. A shell of about 50 lines that offers exactly these ran the food flows listed in section 9 without an error (it is printed in section 12).
- The host calls **six members** of `window.__overloadFood`: `render` and `settingsCard` while drawing, and `click`, `submit`, `input`, `change` for events, which it routes by the prefix `food-`.
- The only element of the page `food.js` looks up by itself is `#sheet`. Everything else goes through the host's helpers.
- With the page in `/overload/fuel/` and `data/` and `vendor/` left where they are, **three string literals** in `food.js` must change (the food list and the barcode reader are asked for relative to the page). Nothing else in `food.js` has to change for it to work.
- The training app runs unchanged without `food.js`: every hook in `app.js` is guarded by `window.__overloadFood ? … : …`. Taking out one `<script>` tag and one tab button is enough for it to work; the rest is tidying, plus two places where the wording or behaviour would now be wrong (Reset, and the import question).

---

## 1. What food.js takes from the host

`food.js:23-25`:

```js
const O = window.__overload;
const { $, esc, uid, num, todayKey, addDays, fmtDate, openSheet, closeSheet, sheetHeader, toast, markDeleted } = O.lib;
const S = () => O.state;
```

This runs when the file is evaluated. So `window.__overload` and all twelve `lib` helpers must exist **before** `food.js` runs, and the helpers are captured once: replacing `lib.toast` later changes nothing for `food.js`. If `window.__overload` is missing at that moment `food.js` throws and `window.__overloadFood` never appears.

### 1.1 Members of `window.__overload`

| Member | Where food.js uses it | Host today | What food.js relies on |
| --- | --- | --- | --- |
| `state` (getter) | `food.js:25`, then `S()` everywhere | `app.js:2419` returns the live `state` variable | The **live object**, read again on every use. `food.js` changes it in place (`st.diary[day] = list`, `st.food.foods[id] = …`, `delete st.diary[day]`) and then calls `O.save()`. It never keeps the state object itself between taps, so the host may swap the whole object (cloud sync does, `app.js:480`). While an amount sheet is open it holds that one food object (`fu.fx.food`), but it looks the stored food up again by id before writing (`food.js:631, 703`). It reads and writes only: `diary`, `food.targets`, `food.foods`, `food.meals`, `deleted.food` (through `markDeleted`), and reads `bodyweight` and `settings.units` (section 7). |
| `screen` (getter) | `food.js:52, 402, 454, 477, 1140, 1171, 1174, 1184, 1190, 1198` | `app.js:2420` returns `ui.screen` | The string `'food'` exactly while the food screen is the one drawn in the page. See 4.4. |
| `saveFailed` (getter) | `food.js:655` only | `app.js:2421` | Read right after `O.save()`. True means the last save did not reach storage; the Add sheet then closes instead of showing a green "Added" line. Must be correct **as soon as `save()` returns**. |
| `save()` | 18 calls: `food.js:177, 258, 448, 645, 674, 705, 718, 742, 761, 796, 850, 863, 1083, 1099, 1100, 1105, 1111, 1137` | `app.js:324-342` | Synchronous. Writes the whole state. `food.js` **never uses the return value**. See 1.3. |
| `render()` | 18 calls: `food.js:448, 647, 655, 657, 674, 763, 798, 863, 1017, 1067, 1071, 1075, 1083, 1140, 1171, 1184, 1190, 1198` | `app.js:737-754` | Synchronous redraw of the current screen. See 1.4. |
| `lib` | `food.js:24` | `app.js:2426` | The twelve helpers below. |

Not used by `food.js` (checked with a recording proxy: no other member was read): `unreadable`, `safetyCopy`, `setState`, `computeNext`, `toast` (the top-level one), `checkinDone`, `noteUpdateReady`, `setSyncStatus`, `syncChanged`. Those serve `sync.js` (`state`, `setState`, `unreadable`, `saveFailed`, `safetyCopy`, `setSyncStatus`, `syncChanged`, `render`: `sync.js:40, 86, 162, 195-196, 246-249, 279, 309, 323, 401-403, 466-467`) and `connector.js` (`state`, `screen`, `save`, `render`, `checkinDone`, `lib.esc`, `lib.todayKey`, `lib.toast`: `connector.js:16-17`).

### 1.2 The twelve helpers in `lib`

| Helper | Host code | Behaviour food.js relies on |
| --- | --- | --- |
| `$(sel, el)` | `app.js:129` | `(el || document).querySelector(sel)`. Returns `null` when nothing matches (food.js tests for that). |
| `esc(s)` | `app.js:131` | Replaces `& < > " '` with entities; `null` and `undefined` become `''`. Every name, brand and id food.js puts in markup goes through it, including inside attribute values. |
| `uid()` | `app.js:130` | A new id, lower-case letters and digits only (up to 8 random base-36 characters plus 4 from the clock). Used for entries, saved meals and typed-in foods (`'c' + uid()`). |
| `num(v, d)` | `app.js:134` | `parseFloat(v)`, or `d` when that is not a finite number. Called with `0` and with `NaN` as `d`. |
| `todayKey(d)` | `app.js:136-140` | `'YYYY-MM-DD'` in the phone's **local** time, for now or for the `Date` given. These strings are the keys of `state.diary` (and the ids of the cloud's `foodDays` documents). Compared with `<`, `>=`, `===`. |
| `addDays(key, n)` | `app.js:153` | The day key `n` days from `key` (local calendar, so it is right across clock changes). |
| `fmtDate(key)` | `app.js:148-151` | `toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })`. Any stable text works; `retitle()` compares it with the sheet title's text (`food.js:1155`). |
| `openSheet(html, key)` | `app.js:1547-1556` | See 1.5. |
| `closeSheet()` | `app.js:1557` | See 1.5. |
| `sheetHeader(title, extra)` | `app.js:1558` | Returns `<div class="sheet-title"><h2>TITLE</h2><div class="row">EXTRA<button class="icon-btn" data-action="sheet-close">✕</button></div></div>`. `title` and `extra` are inserted **as HTML, not escaped**: food.js escapes what it passes (`food.js:491, 600, 751`). food.js later finds the title with `#sheet .sheet-title h2` and rewrites its `textContent` (`food.js:1152-1156`). |
| `toast(msg)` | `app.js:1955-1959` | Sets `#toast`'s **`textContent`** (plain text), shows it, hides it after 2.2 to 6 s (55 ms a character). A new toast replaces the one showing. food.js passes unescaped names (`food.js:742`: `'Saved "' + name + '"'`), so a shell that used `innerHTML` here would be wrong. `.toast` has `pointer-events: none` (`styles.css:311`), so it never takes a tap meant for what is under it (food rows, the Add sheet's list). |
| `markDeleted(kind, id)` | `app.js:498` | `state.deleted[kind][id] = Date.now()`. Does not save. food.js calls it only with `'food'` (`food.js:673, 1081`), then calls `O.save()`. `state.deleted.food` must exist or it throws after the diary was already changed in memory. |

### 1.3 `save()` in detail (`app.js:324-342`)

1. If the stored data could not be read at start (`ui.unreadable`), it returns `false` at once: nothing is written, no event (`app.js:325`).
2. `localStorage.setItem('overload.state.v1', JSON.stringify(state))` inside `try`; a throw means "not saved" (`app.js:327-328`).
3. Training only: refreshes the day's automatic copy when a workout was just finished (`app.js:330-331`).
4. When the result differs from last time it flips `ui.saveFailed` and draws or removes the fixed banner in `#save-warning` (`app.js:332-336`, `343-351`; `body.has-save-warning`, CSS variable `--save-warning-h`).
5. On failure it queues `toast(NOT_SAVED)` as a microtask, so it runs after the caller's own "Saved"/"Added" toast and replaces it (`app.js:339`).
6. It always dispatches `overload:save` on `document` (also on failure) (`app.js:340`). Listeners: `sync.js:470` (schedule an upload) and `connector.js:385`. food.js does not listen to it.
7. Returns `true` or `false` (`app.js:341`).

Checked: with storage made to fail, a Quick add from the Add sheet closed the sheet, showed "Not saved on this phone: the app's storage is full. Export a backup now.", and the banner; when storage worked again the next `save()` removed the banner.

### 1.4 `render()` in detail (`app.js:737-769`)

- Synchronous. food.js reads the page right after it (`food.js:657-658`: `O.render(); … $('#food-added')`).
- On the unreadable-data screen it draws that screen instead and returns (`app.js:739`).
- Otherwise `renderScreen()` (`app.js:755-769`): marks the active tab (`.tab` whose `data-screen` equals `ui.screen` gets class `active`, `app.js:759`), redraws `#topbar-right` (`app.js:760, 771-775`), then for `'food'`: `app.innerHTML = window.__overloadFood ? window.__overloadFood.render() : '<div class="empty">Loading…</div>'` (`app.js:763`).
- A throw inside the screen's draw is caught: `#app` shows "This screen could not be shown… Export backup" (`app.js:747-753`). One bad record cannot leave a blank app.
- It does **not** touch the sheet (`#sheet` is outside `#app`), does **not** move focus, and does **not** scroll. Checked: window scrolled to 700, `render()`, still 700. A sheet stays open over a redraw of the page behind it; food.js depends on that (`food.js:657`: redraw the day behind the Add sheet).
- It replaces all of `#app`, so every food row is a new element after each call. food.js copes (`food.js:400-401`).

How the screen changes by a tap (`ui.screen` is not saved anywhere; the other writers all set `'today'`: `app.js:464, 1884, 2031, 2381`):

- A tap on `.tab`: `ui.screen = tab.dataset.screen; render(); window.scrollTo(0, 0); scrollToNext();` (`app.js:2078-2079`). `scrollToNext()` only acts on Today during a workout.
- `data-action="goto-settings"` (the sync pill): `ui.screen = 'settings'; render(); window.scrollTo(0, 0);` (`app.js:2243`).

food.js is not told when the screen changes. It reads `O.screen` when it needs to know.

Scroll: `history.scrollRestoration = 'manual'` (`app.js:2391`). The page (the window) scrolls, not an inner box: food.js's drag uses `window.scrollBy` and `window.innerHeight` (`food.js:416-418`).

Cloud data arriving (`setState`, `app.js:478-488`): the state object is replaced (after `normalize`), written to storage directly (no `overload:save` event, so it does not trigger an upload by itself), and the screen redrawn with `renderWhenIdle()` (`app.js:491-496`): if a box **inside `#app`** has the keyboard, the redraw waits (polls every 700 ms) until it does not. A box inside a sheet does not count. Checked both: typing in a Food targets box in Settings held the redraw back; typing in the Add sheet's search box let `#app` redraw and the sheet and its focus stayed.

### 1.5 Sheets

Markup (`index.html:122-125`):

```html
<div id="sheet" class="sheet" hidden>
  <div class="sheet-backdrop" data-action="sheet-close"></div>
  <div class="sheet-panel" id="sheet-panel"></div>
</div>
```

`openSheet(html, key)` (`app.js:1547-1556`):

- `panel.innerHTML = html`, `#sheet.hidden = false`, `document.body.style.overflow = 'hidden'`.
- Works out what the sheet is: `'k:' + key` when a key is given, else `'t:' + the text of .sheet-title h2`. Stored in `panel.dataset.sheet` (it stays there after the sheet closes).
- `panel.scrollTop = 0` when the sheet was closed, or when it now shows something else. Redrawing the same sheet keeps its scroll position. food.js passes a key once: `'meal:' + id` for a saved meal (`food.js:756`), so renaming it (the title changes) does not jump to the top.
- It does **not** dispatch any event, does not focus anything, does not blur anything. Going from one sheet to another (Add → amount → back) is `openSheet` again with no close in between. food.js depends on that: its "trip" (`fu.trip`, `fu.sheetDay`, `fu.from`) lasts until the close event.

`closeSheet()` (`app.js:1557`), in this order: `ui.sheet = null`, `#sheet.hidden = true`, `#sheet-panel.innerHTML = ''`, `document.body.style.overflow = ''`, then `document.dispatchEvent(new CustomEvent('overload:sheetclose'))`, synchronously. food.js's listener (`food.js:1167-1172`) runs inside that call and expects the sheet to be hidden already: it stops the camera, clears `fu.form`, `fu.sheetDay`, `fu.trip`, `fu.from`, and may call `O.render()`.

How a sheet gets closed today, all of them through `closeSheet()`:

1. The ✕ that `sheetHeader` adds (`data-action="sheet-close"`).
2. A tap on the backdrop, which carries `data-action="sheet-close"` (`index.html:123`); handled at `app.js:2240`. Checked: closes, event fired, `overflow` reset.
3. food.js's own Done buttons with `data-action="sheet-close"` (`food.js:525, 1005`).
4. food.js calling `closeSheet()` after a save, delete or copy.

There is **no swipe-to-close and no Escape key** (no touch or key listener for sheets in `app.js`; checked: a downward swipe on the panel and Escape both left it open). The sheet covers the whole screen (`.sheet { position: fixed; inset: 0; z-index: 40 }`, `styles.css:295`; the tab bar is `z-index: 20`), so the tabs cannot be tapped while one is open.

food.js asks whether a sheet is open by reading `#sheet`'s `hidden` property (`food.js:54, 402, 684`). A shell that shows and hides the sheet with a class instead would make food.js think no sheet is ever open: the day could roll over under an open Add sheet and a drag could start behind one.

Focus: the host does nothing about focus for food. The tapped button keeps it when a sheet opens. Closing a sheet removes its boxes from the page; on a phone that should also close the keyboard (not checked on an iPhone).

In 3.0 (both apps, review finding look#6) the sheet is a dialog: `#sheet-panel` has `role="dialog"`, `aria-modal="true"` and `aria-labelledby="sheet-heading"`, and `openSheet` gives the title (`.sheet-title h2`) that id. A fresh sheet takes focus on its title (or, with keys, on a box marked `autofocus`); the top bar, `#save-warning`, `#app`, `#rest-timer` and the tab bar are `inert` until `closeSheet`, which gives focus back to what opened it (found again by tag and `data-…` attributes when a save drew it again). Escape closes the sheet, through `closeSheet`; Tab goes round inside it. After a touch none of this shows: no ring (`data-quiet-focus`), no scrolling, and no text box is focused. A redraw of the open sheet moves focus only when keys are in use and the focus went with the old content; food.js needs nothing new.

---

## 2. What the host calls on `window.__overloadFood`

`food.js:1193-1197` exports `{ render, click, input, change, submit, settingsCard, _ }`. `_` holds internals for tests and the console (`searchDb, loadDb, nutrition, unitOptions, convert, canonCode, fromOff, foundCode, fu`); no app code uses it.

| Call | Host line | When | Arguments |
| --- | --- | --- | --- |
| `render()` | `app.js:763` | Every `render()` while `ui.screen === 'food'` | none. Returns the whole screen as one HTML string, starting with `<div class="screen-title"><h1>Food</h1></div>` (`food.js:369`). **It has side effects**: it decides the day to show (`dayNow(true)`), and sets `fu.day`, `fu.drawn`, `fu.seen` (`food.js:333-335`). Call it only when the result goes on screen. |
| `settingsCard()` | `app.js:1500` | While drawing Settings, between the connector cards and the Backup card | none. Returns `<div class="group-title">Food targets</div><div class="card">…<div id="food-target-rows">…</div></div>` (`food.js:1001-1003`). Reads state only. |
| `click(a, d, btn)` | `app.js:2083` | A click on (or inside) an element with `data-action` starting `food-`, when that element is not `disabled` | `a` = the action string, `d` = `btn.dataset` (strings: `d.d`, `d.meal`, `d.id`, `d.src`, `d.i`), `btn` = the element (used once, `food.js:1033`). |
| `submit(form)` | `app.js:2252` | A `submit` event whose target's `id` starts with `food-`. The host calls `preventDefault()` first. | the form element. Forms: `#food-quick-form` (`food.js:773`), `#food-form` (`food.js:812`). |
| `input(el, f)` | `app.js:2311` | An `input` event on an element whose `data-field` starts with `food-` | `el`, `f = el.dataset.field`. Acts on `food-search`, `food-qty` (`food.js:1117-1126`). |
| `change(el, f)` | `app.js:2318` | A `change` event on such an element | same. Acts on `food-unit`, `food-target`, `food-photo` (`food.js:1127-1144`). |

The host lines, quoted:

```js
// app.js:2077-2083
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) { ui.screen = tab.dataset.screen; render(); window.scrollTo(0, 0); scrollToNext(); return; }
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  const a = btn.dataset.action, d = btn.dataset;
  if (a.startsWith('food-')) { if (window.__overloadFood) window.__overloadFood.click(a, d, btn); return; }
// app.js:2240
      case 'sheet-close': closeSheet(); break;
// app.js:2251-2252
document.addEventListener('submit', (e) => {
  if (/^food-/.test(e.target.id || '')) { e.preventDefault(); if (window.__overloadFood) window.__overloadFood.submit(e.target); return; }
// app.js:2309-2311
document.addEventListener('input', (e) => {
  const el = e.target; const f = el.dataset.field; if (!f) return;
  if (f.startsWith('food-')) { if (window.__overloadFood) window.__overloadFood.input(el, f); return; }
// app.js:2316-2318
document.addEventListener('change', (e) => {
  const el = e.target; const f = el.dataset.field; if (!f) return;
  if (f.startsWith('food-')) { if (window.__overloadFood) window.__overloadFood.change(el, f); return; }
```

All four host listeners are on `document`, in the bubbling phase. That matters: food.js adds its own **capturing** click listener on `document` (`food.js:476-481`) that calls `stopPropagation()` and `preventDefault()` to swallow (a) the click that ends a drag, (b) any click in the 350 ms after an Add, (c) a second click on the same spot within a second. Because it runs first and stops the event, the host's click handler never sees those clicks. Checked: a click on a tab right after an Add left the screen on Food. A shell that listened on `window`, or in the capturing phase, would get those clicks.

The 31 actions `click` handles (`food.js:1011-1116`): `food-day`, `food-add`, `food-back`, `food-pick`, `food-plus`, `food-online`, `food-db-retry`, `food-meal`, `food-save`, `food-delete`, `food-edit`, `food-fix`, `food-forget`, `food-quick`, `food-new`, `food-scan`, `food-type-code`, `food-targets`, `food-fav`, `food-meal-menu`, `food-copy-meal`, `food-copy-today`, `food-copy-day`, `food-clear-meal`, `food-save-meal`, `food-sm-open`, `food-sm-meal`, `food-sm-log`, `food-sm-remove`, `food-sm-rename`, `food-sm-delete`.

One action food.js emits but the **host** handles: `sheet-close`.

---

## 3. What food.js expects in the page

### 3.1 Elements of the page

| Element | Who uses it | Needed for |
| --- | --- | --- |
| `#sheet` with the `hidden` attribute | **food.js directly** (`food.js:54, 402, 684`), host `openSheet`/`closeSheet` | "Is a sheet open?" |
| `#sheet .sheet-title h2` | **food.js directly** (`food.js:1152`), made by host `sheetHeader` | Renaming an open Add sheet after midnight. It sets `h2.textContent`, so anything else inside the `h2` (an icon) would be wiped. |
| `#sheet-panel` | host only (`app.js:1549, 1557`) | Where the sheet's HTML goes; it is the scrolling box |
| `.sheet-backdrop[data-action="sheet-close"]` | host click handler | Closing by a tap outside |
| `#app` | host only (`app.js:756, 763`) | Where `render()`'s HTML goes. food.js never names `#app`; it finds its rows with `.f-meal .f-row[data-id]` anywhere in the document. |
| `#toast` | host `toast` (`app.js:1956`) | Messages |
| `.tab[data-screen]` buttons | host click handler (`app.js:2078, 759`) | Switching screen. food.js never names the tab bar, but assumes about 60 px of it at the bottom when a drag scrolls the page (`food.js:416`), and 80 px at the top (`EDGE`, `food.js:377`). |
| `#topbar-right`, `.topbar` | host only (`app.js:774, 1722`) | Not used by food.js |
| `#save-warning` | host `save` (`app.js:344`) | The storage-full banner |
| `document.body` | food.js (`food.js:407, 411, 442`), host (`app.js:1550`) | The drag ghost is appended to `body`; `body` gets class `f-dragging`; the host sets `body.style.overflow` |

Ids food.js creates itself (inside its screen or its sheets): `food-added`, `food-results`, `food-preview`, `food-quick-form`, `food-form`, `food-target-rows` (in the Settings card and in the targets sheet, never both at once), `scan-video`, `scan-status`, `scan-photo`.

Structure food.js's own code depends on (matters if `render()`'s markup is redesigned):

- Each meal is `.f-meal[data-meal="0..3"]`, and its food rows `.f-row[data-id]` and its `[data-action="food-add"]` button are **direct children** of it: the drop line is placed with `card.insertBefore(line, row-or-button)` (`food.js:430-433`), which throws if they are wrapped in another element.
- `.f-mealseg button[data-i]` (`food.js:1040, 1090`), `[data-action="food-save"]` (`food.js:621, 1041`), `[data-action="food-fav"]` (`food.js:706`), `[data-action="food-sm-log"]` (`food.js:1091`), `[data-field="food-qty"]` (`food.js:1131`), `.f-target-note` (`food.js:1139`).
- Glyphs written as text, also after a tap: `★ ☆` (`food.js:507, 515, 599, 707`), `✓ +` (`food.js:516, 1033`), `‹ ›` (`food.js:338-340`), `⋯` (`food.js:359`), `▥` (`food.js:494`), `✕` (`food.js:750`, and the host's `sheetHeader`), `‹ Back` (`food.js:595, 751, 891`). Swapping these for drawn icons means editing those lines, including the two that set `textContent` on tap (`food.js:707, 1033`).
- Native dialogs: `prompt` (`food.js:738, 1058, 1104`) and `confirm` (`food.js:861, 1079, 1110`).

### 3.2 CSS classes food.js emits

**Shared with the training screens** (defined in the general part of `styles.css`, also written by `app.js`):

- Layout and text: `screen-title` (95), `card` (114), `row` (158), `grow` (160), `muted` (152), `small` (153), `tiny` (154), `center` (155), `mt8` `mt12` `mt16` `mb8` (156)
- Buttons: `btn` with `small` `ghost` `subtle` `block` `danger` (123-135), `btn-row` (136), `icon-btn` (138)
- Forms: `field` (247), `field-row` (260), `input` `select` (249), `seg` and its `button.on` (266-268), `toggle-row` (262)
- Headings and notes: `group-title` (279), `banner` (333)
- Numbers: `stat-row` (323), `stat` with `.v` and `.k` (324-326)
- From the host's `sheetHeader`: `sheet-title` (304)
- `title`, `sub`, `chev`, `v`, `k` are shared **names** only: inside food rows they are styled by `.f-row .title`, `.f-row .sub`, `.f-row .chev`, `.f-macro .k`, `.f-macro .v` (`styles.css:422-431`), not by the training rules (`.list-item .title` and so on).

**Only used by food** (`styles.css:408-480`):

- Day screen: `f-daynav`, `f-daylabel`, `f-sum`, `f-kcal`, `f-big`, `f-left` (+ `over`), `f-bar` (its `span` + `m` or `over`), `f-macros`, `f-macro`, `f-meal`, `f-meal-head`, `f-row`, `f-rk`, `f-more`, `f-copyday`
- Drag: `f-lifted`, `f-ghost`, `f-drop-target`, `f-drop-line`, and `f-dragging` on `body`
- Add sheet: `f-searchrow`, `f-scanbtn`, `f-addbtns`, `f-added` (+ `none`), `f-qrow`, `f-qpick`, `f-plus`, `f-favmark`, `group-title first`
- Amount, meals, scan: `f-food-name`, `f-amount`, `f-preview`, `f-mealseg`, `f-star` (+ `on`), `f-menu`, `f-danger`, `f-static`, `f-x`, `f-scanview` with `.guide`
- `f-target-note`: no CSS, used only to find the element (`food.js:1139`)
- Ids with CSS: `#food-results` (440), `#food-added` (457)

Rules that sit in the food part of `styles.css` but are general: `.icon-btn:disabled` (411, training uses disabled icon buttons too, `app.js:1583-1584`), `.group-title.first` (441, only food writes `first`), `label.btn` (468, only food has a `<label class="btn">`, `food.js:894`), and the `.tab` font size under 380 px (469).

CSS that is part of how food works, not just how it looks:

- `.f-ghost { position: fixed; pointer-events: none; z-index: 60 }` (436). Without `pointer-events: none`, `document.elementFromPoint` (`food.js:424`) finds the ghost and no drop ever lands.
- `.f-meal .f-row[data-id] { user-select: none; -webkit-touch-callout: none }` (434) and `body.f-dragging *` (439). Without them a long press on an iPhone selects text or opens the callout instead of starting a drag.
- `#food-added { position: sticky; top: -16px; background: var(--bg-2) }` (457). The `-16px` and the colour match `.sheet-panel`'s padding and background (`styles.css:297-300`). Change one, change the other.
- `.toast { pointer-events: none }` (311).
- Colours: "over target" and destructive text use the brand colour (`.f-bar span.over` → `--accent`, 420; `.f-left.over` and `.f-danger` → `--accent-2`, 416, 478). Today the accent is red, so that reads as a warning. With a different accent per app it would not.

### 3.3 Inline styles food.js writes

- `food.js:327`: `style="width:NN.N%"` on the fill of every progress bar.
- `food.js:985`: `style="width:100px;text-align:center"` on the four target boxes.
- `food.js:406, 423`: `left`, `top`, `width` in px on the drag ghost.

That is all. (The host sets `document.body.style.overflow` while a sheet is open.)

---

## 4. Global events and timers

### 4.1 Listeners food.js installs on `document`

| Event | Line | Purpose |
| --- | --- | --- |
| `pointerdown` | `food.js:453-460` | On a food row while `O.screen === 'food'`: start a 300 ms hold timer (touch), or arm a drag (mouse) |
| `pointermove` (not passive) | `food.js:461-468` | Move the drag; moving more than 8 px before the hold ends cancels it (that is a scroll) |
| `pointerup`, `pointercancel` | `food.js:470-471` | Drop, or cancel |
| `touchmove` (not passive) | `food.js:473` | `preventDefault()` while dragging so the page does not scroll under the finger (needed on iOS) |
| `click` (**capturing**) | `food.js:476-481` | Swallows clicks as described in section 2; also notes the time and place of each tap, and `fu.seen` while on Food |
| `contextmenu` | `food.js:482` | No menu on a long press of a food row |
| `overload:sheetclose` | `food.js:1167-1172` | Cleans up after any sheet closes (camera off, trip ended), redraws if the date changed meanwhile |
| `visibilitychange` | `food.js:1173-1185` | Hidden: camera off, remember when and on which day. Visible: with a sheet open, after more than 30 minutes away mark "away" and, when the Add sheet was for the day that was today when the page was hidden and the date has changed since, move it to the new day (`moveTrip`), then rename it if needed; with no sheet, redraw if the day on screen is no longer the right one |

There is **no `pageshow` or `pagehide` listener** in food.js or app.js. Not found.

The host has its own `visibilitychange` (`app.js:2389`): redraw when the date changed and no sheet is open. It was registered first, so it runs before food.js's; food.js's own listener covers the same case, so a shell does not need it.

### 4.2 Timers

- `setInterval(…, 60000)` for the life of the page (`food.js:1188-1191`): with a sheet open, rename it if needed; otherwise, on Food, visible, no drag or press in progress, redraw when the day on screen is no longer right. This is what turns the screen over at midnight.
- `setInterval(…, 16)` only during a drag (`food.js:414-419`): scrolls the window near the top or bottom edge.
- `setTimeout` 300 ms hold (`food.js:458`), 400 ms click suppression after a drag (`food.js:444`), 120 ms between camera frames while scanning (`food.js:932`), 10 s limit on an Open Food Facts request (`food.js:282`).

### 4.3 The day roll-over (README "goes back to today on a new day or after 30 minutes away")

`dayNow(away)` (`food.js:58-61`): with a past day picked (`fu.day`) and no sheet open, the screen goes back to today when the date has changed since that day was picked (`fu.dayFrom`), or, on a redraw, when more than `AWAY_MS` = 30 minutes passed since `fu.seen`. `fu.seen` is set on every draw of the Food screen (`food.js:335`), on every click while on Food (`food.js:477`), and when the page is hidden while on Food (`food.js:1174`). All of it hangs on `O.screen`, `O.render()` and `#sheet.hidden`; nothing else from the host.

### 4.4 What food.js assumes about the screen named `food`

- `O.screen === 'food'` means: the HTML from `__overloadFood.render()` is what `#app` shows now. `screenDay()` (`food.js:52`) then trusts `fu.drawn` as "the day he is looking at", and taps act on that day.
- Drags only start, and the timers only redraw, while it is `'food'` (`food.js:402, 454, 1171, 1184, 1190`).
- A change of a target redraws the page only when on `'food'` (`food.js:1140`); in Settings only the note under the boxes is rewritten, on purpose ("rebuilding the boxes would lose the tap on the next one", `food.js:1138`).
- At the end of the file: `if (O.screen === 'food') O.render();` (`food.js:1198`). In the training app the first screen is always Today, so this never fires. **In Fuel it is how the first real screen gets drawn**: the shell's own first `render()` runs before food.js exists and must cope with that (draw a placeholder), then food.js calls `O.render()`.
- The tab can be labelled anything. The id must stay `'food'`, or ten lines of food.js change.

### 4.5 Camera

`navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })` (`food.js:901-902`) into `<video id="scan-video" playsinline muted>` (`food.js:892`). Frames are drawn to an off-screen canvas made when the file loads (`food.js:885-886`) and read by the browser's `BarcodeDetector` if it supports EAN/UPC, else by zxing (`food.js:870-884`). The camera is stopped on: a code found, Back, "Type the number", the sheet closing (the `overload:sheetclose` event), and the page being hidden. Fallback without a camera: a hidden `<input type="file" id="scan-photo" data-field="food-photo" accept="image/*" capture="environment">` opened by a `<label>` (`food.js:894-895`), which reaches food.js through the host's `change` routing. Also `navigator.vibrate` when present (`food.js:412, 952`), `navigator.onLine` for wording (`food.js:581, 976`).

---

## 5. Network and files

| What | Where in food.js | Resolved against | Today, page at `/overload/` | Page at `/overload/fuel/`, food.js unchanged |
| --- | --- | --- | --- | --- |
| Food list: `DB_URL = './data/foods.json?db=5'`, `fetch(DB_URL)` | `food.js:30, 157` | The **page's** address (a classic script's `fetch` uses the document's base, not the script's own address) | `/overload/data/foods.json?db=5` | `/overload/fuel/data/foods.json?db=5` → **404** |
| Barcode reader: `import(new URL('./vendor/zxing/reader/index.js', location.href).href)` | `food.js:879` | `location.href`, on purpose: "a rescued start runs this file from a blob: address" | `/overload/vendor/zxing/reader/index.js` | `/overload/fuel/vendor/zxing/reader/index.js` → **404** |
| Its wasm: `new URL('./vendor/zxing/' + p, location.href)` | `food.js:880` | `location.href` | `/overload/vendor/zxing/zxing_reader.wasm` | `/overload/fuel/vendor/zxing/zxing_reader.wasm` → **404** |
| `reader/index.js` imports `"../share.js"` | `vendor/zxing/reader/index.js:1` | That module's own address | `/overload/vendor/zxing/share.js` | follows the folder, wherever it is |
| Open Food Facts: `https://world.openfoodfacts.org` + `/api/v2/product/<code>.json?fields=…` and `/cgi/search.pl?…` | `food.js:31-32, 281-289, 311, 317` | absolute | same | same |

Where `food.js` itself lives does not matter for any of these. Only where the page lives.

Checked in a browser with the page served at `/fuel/index.html`:

- food.js unchanged: the Add sheet asked for `/fuel/data/foods.json?db=5` (404) and search showed "Could not load the food list. Check the connection and try again."; Scan asked for `/fuel/vendor/zxing/reader/index.js` (404) and showed "Camera did not start. Scan a photo or type the number." Favorites, Recent, Quick add, typed-in foods and everything already logged still worked.
- With `'./data/foods.json?db=5'` → `'../data/foods.json?db=5'` and `'./vendor/zxing/` → `'../vendor/zxing/` (both places): the list loaded from `/data/foods.json?db=5`, search returned 30 rows, and Scan loaded `/vendor/zxing/reader/index.js`, `/vendor/zxing/share.js`, `/vendor/zxing/zxing_reader.wasm`.

When the list is fetched: the first time an Add sheet opens with an empty search box (`food.js:498`), on the first search (`food.js:564`), on a scan (`food.js:963`), and when an old entry needs a portion that was cut before v2.8 (`food.js:685`). After it loads, `refreshStored()` (`food.js:167-179`) may correct stored foods from the list and call `O.save()`: a save that no tap caused.

Offline: `sw.js:13` stores `./data/foods.json?db=5` and `sw.js:19-21` the three zxing files. The `?db=` value must be the same string in food.js and in whichever service worker stores the list (README.md:338-339). Open Food Facts answers are never stored (`sw.js:76-78`).

Two ways to make the paths right in Fuel:

1. **Leave `data/` and `vendor/` where they are and change the three literals to `../`.** Nothing else moves: `.github/workflows/build-foods.yml:45, 60` keeps writing `data/foods.json`, `lab/scan.html:126-128` already uses `../vendor/zxing/` from a subfolder. Fuel's service worker stores `../data/foods.json?db=5` and `../vendor/zxing/*` (a worker serves every request its pages make, whatever the path). This is the smaller change and the one I recommend.
2. Move or copy `data/` and `vendor/zxing/` under `fuel/`: food.js stays byte-identical, but the food-list workflow, the `food-data` branch flow, `tools/` usage and `lab/scan.html` must follow.

A `<base href="../">` in Fuel's page is **not** a fix: it does not change `location.href` (the reader would still 404), and it would redirect every other relative address in the page, the service worker registration included.

---

## 6. Every reference to food in app.js

| Line | What it is | In a training app without Food |
| --- | --- | --- |
| `app.js:3` | Header comment: "The Food tab lives in food.js…" | Reword |
| `app.js:263` | `cleanValues`: `numFields(st.food.targets, …)` | **Keep.** The old food copy stays in the saved state and must stay valid for a roll-back and for the hand-over to Fuel |
| `app.js:264` | `cleanValues`: every `st.diary[day]` must be an array of objects, else dropped | **Keep** |
| `app.js:269` | `normalize`: `dropBadKeys` on `st.food`, its three parts, `st.diary`, `st.deleted` | **Keep** |
| `app.js:286` | `normalize`: deletion records of kinds `food`, `bw`, `sleep`, `workouts`, each pruned after 90 days | **Keep.** Note this is the one place where a plain start changes food-related data: `deleted.food` records older than 90 days are dropped at load and the result is saved at start (`app.js:2380`). v2.8 does the same |
| `app.js:293-297` | `normalize`: makes sure `st.food`, `.targets`, `.foods`, `.meals`, `st.diary` exist | **Keep** |
| `app.js:340` | `overload:save` event | Keep (sync, connector) |
| `app.js:381` | `exportDue()`: the export reminder is due only when there is a finished workout **or any food day** | Leave as it is. It only differs for a phone with food days and no finished workout, and while the old copy is there an export is still worth having |
| `app.js:404` | Automatic copies list: `· N food days` when the copy holds any (from `backup.js:55, 61`) | Keep: it says what the copy holds |
| `app.js:448-453` | `dataSummary()`: "N workouts (range), N food days." in the Import and Restore questions (`app.js:438-439, 2056`) | Keep the count when it is above 0; drop ", 0 food days". Import and Restore replace the whole state, the old food copy included (`replaceState`, `app.js:455-466`), so the question should keep saying so |
| `app.js:763` | `case 'food'` of the screen switch | Remove. Nothing can set `ui.screen` to `'food'` once the tab is gone: `app.js:2079` copies the tapped tab's `data-screen`, and the other writers set `'today'` or `'settings'` (`app.js:464, 1884, 2031, 2243, 2381`); it is not saved |
| `app.js:875` | "After the bathroom, before food" | Not the Food feature: a hint under the body weight box. Keep |
| `app.js:1500` | Settings: `window.__overloadFood ? window.__overloadFood.settingsCard() : ''` | Remove (already empty when food.js is not loaded) |
| `app.js:1557` | `closeSheet` dispatches `overload:sheetclose` | Harmless. Only food.js listens |
| `app.js:1966` | Export JSON writes the whole state | Keep: the export still carries the old food copy |
| `app.js:2083` | Click routing for `food-…` actions | Remove (inert without food.js) |
| `app.js:2238` | Reset: "Erase all exercises, program, history **and food log** on this phone?" then `state = seedState()` | **Decide.** Reset replaces the whole state, so it erases the old food copy too. Either keep the words (true while the copy is there), or make Reset carry `food`, `diary` and `deleted.food` over into the fresh state. Dropping the words and keeping the behaviour would erase food data without saying so |
| `app.js:2252` | Submit routing for forms whose id starts `food-` | Remove (inert) |
| `app.js:2311` | Input routing for `data-field="food-…"` | Remove (inert) |
| `app.js:2318` | Change routing for `data-field="food-…"` | Remove (inert) |
| `app.js:2418-2426` | `window.__overload`; comment "Shared with food.js" on `lib` | Keep `lib`: `connector.js:17` takes `esc`, `todayKey`, `toast` from it |

Asked about and **not found** in app.js: the weekly review has no food line (`app.js:1339-1380`: workouts, sets, tonnage, PRs, body weight, cardio, sleep). The Today notices have no food wording (`app.js:388-397`); only `exportDue()` above counts food days. The storage figure in those notices and in the Backup card (`storageUsed()`, `app.js:362-371`) counts everything stored, so it includes the old food copy until that is removed.

Outside app.js, for whoever owns those files:

- `index.html:115` the Food tab button; `index.html:132` the `food.js` script tag.
- `sw.js:11` (`./food.js?v=2.8`), `sw.js:13` (`./data/foods.json?db=5`), `sw.js:19-21` (zxing). The install is all or nothing (`sw.js:39-52`): a listed file that is no longer at that address makes every install fail, and the phone stays on v2.8 until a release with a correct list.
- `styles.css:408-480` the food rules (keep 411 and 469).
- `backup.js:55, 61` `foodDays` in each copy's summary.
- `connector.js:9, 19-20` the "Food log" reminder; `connector.js:285-286` reads `st.diary[today]` to tell the connector food was logged; `connector/worker.js:228, 254, 269` send it. The connector is not deployed today.
- `sync.js:33` (`food` and `deleted` in the core document), `sync.js:97-98, 147-150, 213-219, 285-309, 357-358, 388-396` (the `foodDays` documents).
- `README.md` (lines 7, 105-169, 181-184, 233-240, 258, 332-353).

The smallest change that takes Food out and leaves a working training app is the two lines of `index.html` plus the matching `sw.js` list. Checked: v2.8's `app.js` on a page without the Food tab and without `food.js` started with no error, every tab drew, Settings had no Food card, a stray `food-…` action did nothing, and after changes that saved, the stored state was identical to before, food data included.

---

## 7. Training data that food.js reads

Only one place, the protein guide under the targets (`targetNote()`, `food.js:989-1000`):

- `food.js:994`: `(st.bodyweight || []).filter((b) => b && +b.weight > 0).sort(by date).pop()`: the latest weigh-in with a weight.
- `food.js:996`: `st.settings.units === 'kg'`: pounds or kilograms. Read only when a weigh-in was found.
- `food.js:997`: the text, "Protein: 125 to 180 g a day suits your 180 lb (0.7 to 1 g per lb)."

Nothing else: no workouts, exercises, sleep, program or other settings (every `st.` and `S().` in the file: `diary`, `food.foods`, `food.meals`, `food.targets`, `bodyweight`, `settings.units`).

Smallest change that keeps it working in a separate app: **none in food.js.** Give Fuel's state a `settings` object with `units`, and a `bodyweight` array holding the latest `{ date, weight }` (or leave the array empty: the guide is simply not shown). Checked on the test shell: with `bodyweight: [{ date: '2026-01-01', weight: 180 }]` and `units: 'lb'` the line above appeared; with an empty array there was no line and no error. `settings` must be an object whenever `bodyweight` has an entry, or `targetNote()` throws and takes the Settings card and the targets sheet with it.

---

## 8. Proposal

### 8.1 What the new shell must implement

Keep the names `window.__overload`, `window.__overloadFood` and the event `overload:sheetclose`: they are internal, the two apps are separate pages, and every rename is an edit to food.js.

The shell script must be a classic script that has run before food.js is evaluated (not `type="module"`, not `async`; `defer` on both keeps the order).

**For food.js** (all of it is required):

| Function | Behaviour |
| --- | --- |
| `get state()` | The live state object. Must always have: `food.targets` (object with `kcal`, `protein`, `carbs`, `fat`, each a number or null), `food.foods` (object), `food.meals` (object; each meal has `name` and an `items` array), `diary` (object of day key → array of entries; food.js removes a day's key when its last entry goes, and cloud sync reads a missing key as "delete that day"), `deleted.food` (object), `settings` (object with `units`), `bodyweight` (array, may be empty). |
| `get screen()` | `'food'` exactly while the food screen is drawn in `#app`; another string for every other screen (Trends, Settings, Welcome, the unreadable-data screen). |
| `get saveFailed()` | Whether the last `save()` failed. Correct the moment `save()` returns. |
| `save()` → boolean | Synchronous. Write `JSON.stringify(state)` to `fuel.state.v1`; never write while the stored data is unreadable; on failure keep a banner up until a save works and show the "Not saved" toast after the caller's own toast (a microtask); tell the sync module (an event). |
| `render()` | Synchronous. Mark the active tab; for `'food'` set `#app.innerHTML = window.__overloadFood ? window.__overloadFood.render() : placeholder`; for Settings include `window.__overloadFood.settingsCard()`. Catch a throw and show an "Export" card instead of a blank screen. Never close or change the sheet, never move focus, never scroll. Must not be called for a redraw of Settings while one of its boxes has the keyboard (sync status changes must patch their own elements only, as `setSyncStatus` does at `app.js:2430-2436`). |
| `lib.$`, `lib.esc`, `lib.uid`, `lib.num`, `lib.todayKey`, `lib.addDays`, `lib.fmtDate` | As in `app.js:129-153` (copy them). |
| `lib.openSheet(html, key)` | As `app.js:1547-1556`: fill `#sheet-panel`, unhide `#sheet` (the `hidden` attribute), lock page scroll, reset the panel's scroll only for a different sheet. No event. (3.0 also makes it a dialog and moves focus into it: see the end of 1.5.) |
| `lib.closeSheet()` | As `app.js:1557`: hide, empty, unlock, **then** dispatch `overload:sheetclose` on `document`, synchronously. Every way of closing a sheet goes through it. |
| `lib.sheetHeader(title, extra)` | As `app.js:1558`: `.sheet-title` containing an `h2` with the title (HTML, not escaped) and a `data-action="sheet-close"` button. |
| `lib.toast(msg)` | As `app.js:1955-1959`: `textContent`, replaces the one showing, cannot be tapped. |
| `lib.markDeleted(kind, id)` | `state.deleted[kind][id] = Date.now()`, making the map first for `fav` and `custom` (which exist only once there is a record: Fuel's `food.js` writes them when he takes a star off and when he deletes a food of his own; review findings data#3, data#4). |

**For `fuel/sync.js`** (as built in 3.0; `sync.md` section 5 gives each contract). `fuel/sync.js` also reads `state`, `saveFailed` and `render` (when `syncChanged` is missing), and needs:

| Function | Behaviour |
| --- | --- |
| `setState(next)` | Replace the state with `next` (ignored unless `next.v === 1`, while unreadable, and while held at Add to Home Screen): `normalize`, write to `fuel.state.v1` without the save event, set `saveFailed` at once, end Welcome, redraw only when no box in `#app` has the keyboard. |
| `get unreadable()` | True while the stored data could not be read, and while the app waits at an Add to Home Screen screen (it has no data of its own there). Sync does nothing then; leaving either calls `__overloadSync.pushNow()`. |
| `safetyCopy(kind, force, text)` | Stores an automatic copy; for `'cloud'` the text is `JSON.stringify(state)` taken in the call. Resolves to whether it was stored (sync does not wait for it). |
| `setSyncStatus(status, msg)`, `syncChanged()` | Patch the top-bar pill, the status text and the Cloud sync card only; the whole screen is drawn again only on Welcome, which says whether he is signed in. |
| `get startedWithData()` | Whether the page started on saved data, as `load()` found it before anything could be tapped. Sync believes its note only then. `load()` itself removes the note (`fuel.sync.v1`) when nothing is stored or the stored data cannot be read. |

So Fuel's `window.__overload` has twelve members: the six for `food.js` and these six. `tests/fuel-shell.js` checks that list.

The other way, `fuel/fuel.js` reads three fields of the module's note (`fuel.sync.v1`) while the module has not loaded yet: `uid`, `email` and `signedOut`. A note that names an account and is not marked signed out counts as signed in for Reset and Restore (their questions, and the note is kept), as `syncOn` counts any note (review finding sync#2, `sync.md` 4.7).

**Event routing** (bubbling listeners on `document`, as `app.js:2077-2083, 2240, 2251-2252, 2309-2311, 2316-2318`):

- click: `.tab` → set the screen, `render()`, `window.scrollTo(0, 0)`; `[data-action]` not disabled → `food-…` to `__overloadFood.click(a, btn.dataset, btn)`; `sheet-close` → `closeSheet()`; the shell's own actions.
- submit: target id starts `food-` → `preventDefault()`, `__overloadFood.submit(form)`.
- input and change: `data-field` starts `food-` → `__overloadFood.input(el, f)` / `.change(el, f)`.

**The page** must have: `#app`; `#sheet` (hidden) containing `.sheet-backdrop[data-action="sheet-close"]` and `#sheet-panel`; `#toast`; `.tab[data-screen]` buttons, one of them `data-screen="food"`; a place for the storage-full banner. The window scrolls, not an inner box.

**What app.js did for food data that the shell must now do itself:**

- Normalise on load, on import and on data from the cloud, with the same rules: `app.js:269` (drop `__proto__`, `constructor`, `prototype` keys), `app.js:263` (targets are numbers or null), `app.js:264` (each day is an array of objects, else dropped), `app.js:284-290` (deletion records pruned after 90 days), `app.js:293-297` (the containers exist). v2.8 does not check the fields **inside** an entry; an importer should (section 10, hazard 9).
- `setState(next)` for sync with the "wait while a box in `#app` has the keyboard" rule (`app.js:478-496`).
- The unreadable-data path (`app.js:185-201, 1988-2033`): never save over stored text that could not be read.
- Automatic copies, export, theme, the update flow: the same as today, with Fuel's own keys.

### 8.2 Edits to food.js

**Cannot be avoided** (with the page in `fuel/` and `data/`, `vendor/` left at the root):

1. `food.js:30`: `'./data/foods.json?db=5'` → `'../data/foods.json?db=5'`.
2. `food.js:879`: `'./vendor/zxing/reader/index.js'` → `'../vendor/zxing/reader/index.js'`.
3. `food.js:880`: `'./vendor/zxing/'` → `'../vendor/zxing/'`.

Both must stay relative to `location.href` (the comment at `food.js:879` says why). If `data/` and `vendor/zxing/` are instead put under `fuel/`, there is no forced edit at all.

**Not forced; needed only if the product or the design asks:**

- `food.js:369`: the screen title `<h1>Food</h1>`.
- `food.js:1002, 1005`: "Food targets" and "These are also in Settings." (true as long as Fuel's Settings shows `settingsCard()`).
- `food.js:1-19, 1009`: comments that name app.js.
- New icons in place of text glyphs: the lines listed in 3.1, including the two that write a glyph on tap.
- Designed dialogs in place of `prompt` and `confirm`: `food.js:738, 861, 1058, 1079, 1104, 1110`.
- Any new layout of the day screen or of a sheet: `render()` (`food.js:332-370`) and the sheet builders return finished HTML, so structure changes are edits there. Colours, spacing and type can be done in CSS alone.

---

## 9. How this was checked

Three Playwright runs against a local server on 127.0.0.1 (every other host blocked, service workers blocked, nothing written to the repo):

1. **v2.8 as it is.** Members of `window.__overload` and `__overloadFood`; tab switch; `save()` returns `true` and fires `overload:save`; a sheet closes by the backdrop and fires `overload:sheetclose`; Escape and a swipe do not close it; `render()` keeps the scroll position; a tab switch scrolls to the top; `setState` waits for a box in `#app` and not for one in a sheet; a target changed in Settings saves without a redraw.
2. **food.js on a shell of about 50 lines** (section 12), page served from memory at `/fuel/index.html`, state under `fuel.state.v1` shaped as in the spec, the shell's `window.__overload` and `lib` wrapped in a proxy that records every member read. Flows run: add by search, favourite, amount and unit, Quick add, scan (reader files), Done, drag a row to another meal with the mouse, save as a meal (prompt), clear a meal (confirm, deletion records), edit and delete an entry, targets from the sheet and from Settings, the protein guide, previous day. Result: no member outside the lists in section 1 was read; no page error with the three path edits; the path failures in section 5 without them. Touch dragging was not run there (it uses the same code after the hold timer).
3. **Storage full, the click guard, and the training app without food.js** (results quoted in 1.3, 2 and 6).

Not checked here, because it needs a real iPhone: the camera, whether Safari offers `BarcodeDetector` (if not, zxing is what runs there), and the touch-and-hold drag under iOS scrolling.

---

## 10. Hazards

1. **Food list and scanner silently missing in Fuel.** Page-relative paths 404 from `fuel/`. Search then finds only his own foods and scanning cannot start; nothing is lost, but it looks broken. Precaution: the three edits in 8.2, and a test that searches and opens Scan from the Fuel page with the network limited to the local server.
2. **A service worker list that names a moved file.** `sw.js:39-52` fails the whole install if one listed file is missing, and the phone then stays on v2.8 until a release with a correct list. Precaution: when `food.js`, `data/foods.json` or `vendor/zxing/*` leave the root list or move, check every entry of both lists answers 200; keep `?db=` identical in food.js and the list that stores it.
3. **Reset in the training app erases the old food copy.** `app.js:2238` replaces the whole state. Precaution: keep the wording true, or carry `food`, `diary`, `deleted.food` across a Reset. Same thought for "Start fresh" (`app.js:2029`), where the old data was unreadable anyway.
4. **Import and Restore in the training app replace the old food copy** with whatever the file or copy holds (`app.js:455-466`). That is today's behaviour and a copy is taken first; keep the food-day count in the question so it is said.
5. **A sheet closed without `closeSheet()`.** A swipe-to-close or a redesigned backdrop that only hides the sheet leaves the camera running and food.js's trip state set. Precaution: one `closeSheet()`, used by every close path, that dispatches `overload:sheetclose` after hiding.
6. **Shell loaded after food.js** (module or async script). food.js throws at its first line and Fuel shows its placeholder forever, with the data untouched. Precaution: classic scripts in order; a test that `window.__overloadFood` exists after load.
7. **Missing containers in Fuel's state.** Without `deleted.food`, deleting an entry changes the diary in memory, then throws before saving (`food.js:671-674`); without `settings`, a stored body weight breaks the Settings card. Precaution: the shell's normalise guarantees every container in 8.1 after load, import and sync.
8. **The same field names in two apps.** Fuel's state has `settings` and `bodyweight` like Overload's. If Fuel's sync ever wrote them into the document Overload reads, Overload's settings and weigh-ins would be replaced by Fuel's two-field versions. Precaution: Fuel writes only its own document and the food days; test that it never writes `meta/state`.
9. **Wrong types from an import.** food.js adds entries up with `+` (`food.js:45-47`) and matches meals with `===` to a number (`food.js:354`). An entry whose `kcal` is text turns the day's total into a joined string; a `meal` of `"1"` shows in no meal but still counts. v2.8's normalise does not check these (`app.js:264`). Precaution: the importer makes `kcal`, `p`, `c`, `f`, `at` numbers and `meal` an integer 0 to 3, and drops what it cannot fix, after showing the count.
10. **Importing the old copy again much later.** Deletion records last 90 days (`app.js:285-290`). The old copy stays in Overload for good, so a second paste months later brings back entries deleted in Fuel more than 90 days ago, and saved foods or meals deleted in Fuel at any time (those have no deletion records: `food.js:862, 1099, 1111`). Precaution: Fuel remembers that the hand-over was done and warns before a second one; or keeps food deletion records for good. (Fuel 3.0 keeps the records for good, for entries, saved foods and saved meals (food.js got three `markDeleted` calls for that), notes the hand-over in `moved`, and says so when a copy is not newer than the last one brought in.)
11. **Redraws from sync while typing.** A shell that calls `render()` on every sync status change throws away the box being typed in on Settings. Precaution: patch the status elements only; redraw through the "wait while typing" rule.
12. **Drag broken by the redesign** (not data): an inner scrolling box instead of the window, rows no longer direct children of `.f-meal`, a ghost that takes pointer events, or lost `user-select: none`. Precaution: keep the rules in 3.1 and 3.2; test a drag after the restyle.
13. **Accent colour used as the warning colour** (not data): see 3.2. Precaution: a separate "over / danger" colour in the shared design tokens.
14. **Toast or sheet title built with `innerHTML` in the shell.** food.js passes raw names to `toast` and escaped HTML to `sheetHeader`. Mixing them up shows `&amp;` in titles, or lets a food name act as markup. Precaution: copy the two functions as they are.
15. **Both apps in one ordinary browser** (not the iPhone Home Screen): one storage, one quota. `storageUsed()` (`app.js:362-371`) counts every key, so each app's figure includes the other, and the food data is stored twice (old copy and Fuel's). Precaution: know it when reading the storage figure in tests; nothing to fix for the iPhone.

---

## 11. Open questions

1. Do `data/` and `vendor/zxing/` stay at the root (three edits in food.js, recommended) or move under `fuel/` (no edit in food.js, but the food-list workflow and `lab/scan.html` change)?
2. Does `food.js` move to `fuel/food.js` as the spec's layout says, or stay at the root and get loaded as `../food.js`? Either works for food.js; it changes the two service worker lists and `bump.sh`.
3. Reset in the training app: keep the old food copy, or erase it and say so?
4. Does the diet screen keep the id `'food'` while its tab is labelled "Today"? (Recommended: yes; otherwise ten lines of food.js change.)
5. Does the redesign want drawn icons and designed dialogs inside food screens? Both are edits to food.js (lines in 3.1), not CSS.
6. The food-log reminder: the connector is not deployed, and the spec drops the reminder. Should `connector.js` stop offering it in 3.0 and send `food: off` to a connector that may be deployed later?
7. On the owner's iPhone: is `BarcodeDetector` available (else zxing runs), and does a newly added Home Screen app ask for the camera again? Not answerable from the code.

---

## 12. Appendix: the test shell that ran food.js

This is the shell from check 2 in section 9, without the recording proxy. It is **not** the Fuel shell: it has no normalise, no unreadable-data path, no storage-full banner, no sync, no backups. It is here because it is the smallest thing that was seen to work, and each line maps to a row of 8.1.

```html
<main id="app" class="screen"></main>
<nav class="tabbar"><button class="tab" data-screen="food">Today</button><button class="tab" data-screen="settings">Settings</button></nav>
<div id="sheet" class="sheet" hidden><div class="sheet-backdrop" data-action="sheet-close"></div><div class="sheet-panel" id="sheet-panel"></div></div>
<div id="toast" class="toast" hidden></div>
<script> /* the shell below */ </script>
<script src="./food.js"></script>   <!-- with the three path edits of 8.2 -->
```

```js
(function () {
  'use strict';
  const KEY = 'fuel.state.v1';
  const $ = (sel, el) => (el || document).querySelector(sel);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  function todayKey(d) { d = d || new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function fmtDate(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function addDays(key, n) { const [y, m, d] = key.split('-').map(Number); return todayKey(new Date(y, m - 1, d + n)); }

  let state = null;
  try { state = JSON.parse(localStorage.getItem(KEY)); } catch (e) { state = null; }
  if (!state) state = { v: 1, app: 'fuel', settings: { units: 'lb', theme: 'system' }, food: { targets: { kcal: null, protein: null, carbs: null, fat: null }, foods: {}, meals: {} }, diary: {}, deleted: { food: {} }, bodyweight: [] };
  const ui = { screen: 'food', saveFailed: false };

  function save() { let ok = true; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { ok = false; } ui.saveFailed = !ok; document.dispatchEvent(new CustomEvent('overload:save')); return ok; }
  function render() {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === ui.screen));
    const F = window.__overloadFood;
    if (ui.screen === 'food') $('#app').innerHTML = F ? F.render() : '<div class="empty">Loading…</div>';
    else $('#app').innerHTML = '<div class="screen-title"><h1>Settings</h1></div>' + (F ? F.settingsCard() : '');
  }
  function openSheet(html, key) {
    const panel = $('#sheet-panel'), fresh = $('#sheet').hidden, was = panel.dataset.sheet;
    panel.innerHTML = html; $('#sheet').hidden = false; document.body.style.overflow = 'hidden';
    const h = panel.querySelector('.sheet-title h2'), now = key != null ? 'k:' + key : 't:' + (h ? h.textContent : '');
    panel.dataset.sheet = now;
    if (fresh || was !== now) panel.scrollTop = 0;
  }
  function closeSheet() { $('#sheet').hidden = true; $('#sheet-panel').innerHTML = ''; document.body.style.overflow = ''; document.dispatchEvent(new CustomEvent('overload:sheetclose')); }
  function sheetHeader(title, extra) { return '<div class="sheet-title"><h2>' + title + '</h2><div class="row">' + (extra || '') + '<button class="icon-btn" data-action="sheet-close">✕</button></div></div>'; }
  let toastHandle = null;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastHandle); toastHandle = setTimeout(() => { t.hidden = true; }, 2200); }
  function markDeleted(kind, id) { state.deleted[kind][id] = Date.now(); }

  window.__overload = {
    get state() { return state; }, get screen() { return ui.screen; }, get saveFailed() { return !!ui.saveFailed; },
    save, render,
    lib: { $, esc, uid, num, todayKey, addDays, fmtDate, openSheet, closeSheet, sheetHeader, toast, markDeleted }
  };

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) { ui.screen = tab.dataset.screen; render(); window.scrollTo(0, 0); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const a = btn.dataset.action;
    if (a.startsWith('food-')) { if (window.__overloadFood) window.__overloadFood.click(a, btn.dataset, btn); return; }
    if (a === 'sheet-close') closeSheet();
  });
  document.addEventListener('submit', (e) => { if (/^food-/.test(e.target.id || '')) { e.preventDefault(); if (window.__overloadFood) window.__overloadFood.submit(e.target); } });
  document.addEventListener('input', (e) => { const el = e.target, f = el.dataset.field; if (f && f.startsWith('food-') && window.__overloadFood) window.__overloadFood.input(el, f); });
  document.addEventListener('change', (e) => { const el = e.target, f = el.dataset.field; if (f && f.startsWith('food-') && window.__overloadFood) window.__overloadFood.change(el, f); });

  render();   // draws "Loading…"; food.js draws the real screen when it loads (food.js:1198)
})();
```
