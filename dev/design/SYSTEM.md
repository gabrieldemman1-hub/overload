# The design system for Overload 3.0 and Fuel 3.0

The implementer guide. It says what to load, what every class looks like, and exactly where the markup in
`app.js`, `connector.js`, `fuel/fuel.js`, `fuel/food.js` and the two `index.html` files has to change. Everything
not listed as a change keeps its markup and only changes its look.

| What | Where |
| --- | --- |
| Shared stylesheet (tokens and every shared component) | `shared/ui.css` |
| Icon set (`icon('name')`) | `shared/icons.js` |
| Overload-only rules | `dev/design/system/train.css` (to be moved to `./train.css`, section 2) |
| Fuel-only rules | `dev/design/system/fuel.css` (to be moved over `fuel/fuel.css`, which it replaces whole, section 2) |
| Reference screens, built from the markup below | `dev/design/system/*.html` (`?theme=light` for light) |
| Their screenshots, 390 x 844 @2x, dark and light | `dev/design/system/shots/` (`contact-dark.png`, `contact-light.png` first) |
| Home Screen icons | `dev/design/system/icons/overload/`, `dev/design/system/icons/fuel/`; candidates in `icons.html` |
| Tools | `dev/design/system/tools/`: `build.js` (the pages), `shoot.js` (shots), `audit.js` (the checks), `contrast.js`, `icons.js` |

The template strings the reference screens are built from are in `tools/pages-train.js`, `tools/pages-fuel.js` and
`tools/pages-misc.js`. They are written the way `app.js` writes markup (`'<button …>' + icon('check') + '</button>'`),
so a builder can be compared with them line by line. Where the code for a screen already exists (the hand-over
card in `app.js`, Welcome, Add to Home Screen, Trends, Settings and the two sheets in `fuel/fuel.js`), the reference
follows that code's structure and action names.

**The stylesheets already work on the markup as it is.** The current `app.js` and `fuel/fuel.js`, and the committed
v2.8, were run with the three stylesheets in place of `styles.css` and audited at 320 and 390 px in both themes: no
finding. So every markup change below is additive, and a screen that has not been converted yet still draws.

Contents: 1 the idea · 2 loading · 3 tokens · 4 type · 5 space, shape, layers · 6 the state language · 7 the shell
(top bar, tab bar, rest dock, sheet, toast) · 8 components · 9 every existing class, and what the tests read ·
10 markup changes by screen · 11 glyphs to icons · 12 inline styles · 13 charts · 14 colours outside the
stylesheet, icons, manifests · 15 contrast · 16 what changes in behaviour · 17 the judges' problems, one by one ·
18 left for later.

---

## 1. The idea

1. The screen is the display of a good piece of gym equipment: a graphite faceplate, hairline rules, no decoration.
2. Numbers lead. Every read-out is the system sans (SF Pro on the phone) at weight 700 with tabular figures, and it
   is bigger than the words around it. There is no monospace anywhere.
3. Words are quiet: sentence case, 15 px. Capitals are kept for the smallest labels only (11 px: SET, REPS, GOAL).
4. **Solid ink means recorded or chosen**: a ticked set, a picked answer, a trained day, the selected segment.
   It is never used for something still to do.
5. **An outline means you can tap or type here.** Things you type in are inset (darker than the card); things you
   press are raised (lighter than the card).
6. **The accent means live, or do this next**: one per app, Overload vermilion, Fuel green. Start, the next set's
   tick, the rest meter, the calorie gauge, the tab indicator. If more than about five things on a screen are
   accent, one of them should be ink.
7. **Danger is its own crimson**, never an accent: destructive buttons, errors, over target. It is far enough from
   Overload's vermilion to be told apart where the two sit side by side (Discard beside Finish workout).
8. Each app has one signature read-out, and it is a dark object in both themes: the rest dock with its tick meter
   (Overload), the half-dial calorie gauge (Fuel).
9. Light is the same instrument printed on paper. Only token values differ between themes and between apps.
10. Nothing moves under the finger: the restyle changes no height on tap, and no control changes place.

## 2. Loading

Overload (`index.html`):

```html
<html lang="en" data-app="overload">
…
<meta name="theme-color" content="#0a0b0c">
<link rel="stylesheet" href="./shared/ui.css?v=3.0">
<link rel="stylesheet" href="./train.css?v=3.0">
…
<script src="./shared/icons.js?v=3.0"></script>   <!-- before app.js: the builders call icon() -->
<script src="./app.js?v=3.0"></script>
```

Fuel (`fuel/index.html`): `<html lang="en" data-app="fuel">`, `../shared/ui.css?v=3.0`, `./fuel.css?v=3.0`,
`../shared/icons.js?v=3.0` before `fuel.js` and `food.js`.

- `data-app` is what switches the accent. Without it a page is Overload. (`fuel/index.html` has no `data-app` yet.)
- **Moving the two app stylesheets.** They sit in `dev/design/system/` only because the design work could not write
  into the apps' folders. In the commit that applies the design, `git mv dev/design/system/train.css train.css` and
  `git mv dev/design/system/fuel.css fuel/fuel.css`, then change the two paths in the constant `CSS` at the top of
  `dev/design/system/tools/lib.js` (`overload: '../../../train.css'`, `fuel: '../../../fuel/fuel.css'`) and run
  `node dev/design/system/tools/build.js`. There is then one copy of each, and the reference pages test the copy
  the apps load.
- **`fuel.css` replaces the existing `fuel/fuel.css` whole.** Every rule that file has is carried: `body.no-tabs
  .tabbar`, `.onboard`, `.install-steps`, `.link-text`, `.choice-card.first`, `.input.num`, `.cloud-msg`,
  `.cloud-status`, `.trend-hero`, `.trend-chart` and its `.bar` / `.axis` / `.target` / `.trend-day`, `.legend`,
  `.swatch`, `.table`. (`a.btn { text-decoration: none }` is in `.btn` itself now.) Nothing of the old file has
  to be kept by hand.
- **Three things go in together, in one commit:** the stylesheet swap, the top bar markup (7.1) and
  `renderTopbar` setting the title. With the stylesheets alone every screen would lose its visible title: the
  screen's `h1` is hidden by the new stylesheet and the bar would still say the app's name.
- Both stylesheets and `icons.js` go into each app's service-worker install list with the same `?v=` text as in the
  page, or the app starts unstyled offline (inventory 9.7). The start-up rescue must handle every stylesheet link
  (SPEC 3.11). `styles.css` is retired once these are in.
- The start-up note keeps its inline style: it must read with no stylesheet.
- `icons.js` is a classic script. `icon('check')` returns an `<svg class="ic" …>` string; `icon('check', 's')` adds
  a size class; `icon('trophy', 's', '🏆')` also writes the text alternative `<span class="sr">🏆</span>` after the
  drawing (section 9.2 says where that is needed); `window.__icons` holds the raw paths. An unknown name returns
  `''`, and so does a name such as `constructor`.
- **If `icons.js` did not arrive** (a half-arrived update: the start-up rescue only acts when `app.js` or `fuel.js`
  itself failed), every builder that calls `icon()` would throw and every screen would be the error card. So each
  script that calls it starts with one line, as the app already does for its other optional script
  (`window.__overloadBackup && …`):

```js
const icon = window.icon || (() => '');   // the first line inside the function that wraps app.js, connector.js, fuel/fuel.js and fuel/food.js
```

  Without the icons the app still works: buttons that hold only an icon keep their `aria-label` and their place.
- The themes work exactly as today: `:root` is dark; light is `:root[data-theme="light"]` and
  `:root:not([data-theme="dark"]).system-light`. `applyTheme` and the inline script before first paint need no
  change except the two `theme-color` values (section 14).

## 3. Tokens

All in `shared/ui.css`, section 0. Dark is the default block; the light block changes values only.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#0a0b0c` | `#f6f6f3` | the page |
| `--panel` | `#121416` | `#ffffff` | card, sheet |
| `--well` | `#0c0d0f` | `#ffffff` | something you type in (inset) |
| `--key` / `--key-2` | `#1c1f22` / `#272b2f` | `#efefeb` / `#e3e3dd` | something you press (raised) / while pressed |
| `--rule` / `--rule-2` | `#24282c` / `#33383d` | `#e3e2db` / `#d0cfc7` | hairline between things you read / meter track |
| `--edge` | `#676e76` | `#84847c` | outline of anything you can tap or type in: 3:1 or more on the page, a card, an input and a key (3.2 to 3.8). The rest dock has a lighter one of its own |
| `--ink` / `--ink-2` / `--ink-3` | `#f2f3f4` / `#b3b9c0` / `#8e959d` | `#0e0f11` / `#45494f` / `#5e6268` | text: primary / secondary / labels. All pass 4.5:1 on every surface |
| `--ink-4` | `#5d636a` | `#9a9c9d` | disabled and decoration only |
| `--solid` / `--on-solid` | `#bfc4ca` / `#0a0b0c` | `#17191c` / `#ffffff` | the "recorded / chosen" fill and what is written on it. In dark it is well under `--ink`, so the accent stays the brightest mark |
| `--accent` | Overload `#ff5a2e`, Fuel `#c4f03a` | Overload `#f04a1c`, Fuel `#46960a` | fills: primary button, meters, the live mark |
| `--accent-ink` | Overload `#ff6a42`, Fuel `#c4f03a` | Overload `#b82c07`, Fuel `#2c6a08` | the accent as text or icon |
| `--accent-wash` / `--accent-line` | 14% / 55% of the accent (Fuel 12% / 50%) | 9% / 50% (Fuel 10% / 50%) | tinted background / tinted outline |
| `--on-accent` | `#0a0b0c` | `#0a0b0c` | text on an accent fill: always the dark ink |
| `--btn` / `--btn-edge` | = `--accent` / none; Fuel `#c4f03a` / none | Overload = `--accent` / none; Fuel `#c4f03a` / `#46960a` | the primary button's fill and its 1 px edge. Fuel's button is volt in both themes; on paper volt is 1.3:1, so the leaf-green edge is its boundary |
| `--tile` / `--tile-ink` | Overload `#ff5a2e`, Fuel `#c4f03a` / `#0c0d0e` | the same | the app's Home Screen colour and the mark on it (`.app-tile`). **Fixed: it does not follow the theme** |
| `--ok` (`-ink`, `-wash`) | `#3ddc97` | `#008f72`, ink `#00694f` | good: weight went up, in range, synced |
| `--warn` (`-ink`, `-wash`) | `#f2b33d` | `#b57300`, ink `#835600` | take care: under target, deload, offline |
| `--bad` (`-ink`, `-wash`) | `#ff4d8f`, ink `#ff6b9f` | `#c4185f`, ink `#a3134f` | danger: destructive, error. A crimson: OKLab distance 10 to 15 from Overload's accent in each theme (it was 6 to 8) |
| `--over` / `--over-ink` | = `--bad` | = `--bad` | over target (one place to change it) |
| `--m-protein` / `--m-carbs` / `--m-fat` | `#f2f3f4` / `#5aa2ff` / `#d0a6ff` | `#0e0f11` / `#2467c7` / `#7a45c9` | the three macros; each also has its own mark (square, circle, diamond) |
| `--series-1..3` | `#dcdfe3` `#98a0a8` `#6a7179` | `#17191c` `#6e7279` `#8a8c90` | charts: an ordered neutral ramp; the third step is 3.4:1 or more on a card and 3.1 on the page |
| `--statusbar` | (none) | `#0a0b0c` | the strip behind the iPhone status bar (section 14) |

Mechanics worth knowing:

- **Accent per app.** The raw values are `--ov-accent…` and `--fu-accent…`; one rule maps `--accent`, `--accent-ink`,
  `--accent-wash`, `--accent-line`, `--btn`, `--btn-edge` and `--tile` from them: `:root, [data-app="overload"],
  .rest-timer` to Overload's, `[data-app="fuel"], .f-sum` to Fuel's. So `data-app` works on any element: the Fuel
  tile in Overload's hand-over card is `<span class="app-tile l" data-app="fuel">`, the Overload tile in Fuel's
  Welcome is `data-app="overload"`.
- **Dark objects.** `.rest-timer` and `.f-sum` are in the selector of the dark token block, so inside them every
  token has its dark value in both themes. To make another dark object, add its selector to that block, to the
  mapping rule of its app and to the alias rule.
- **The rest dock's own surface.** `.rest-timer` (in `train.css`) sets `--dock: #272b2f`, `--key: #343a40`,
  `--key-2: #3f454b`, `--rule-2: #4a5057` and `--edge: #868d95` for itself: it is a step lighter than a card, so
  it is an object on the dark page too, and its keys keep a 3:1 outline (4.3 against the dock, 3.4 against the key).
- **Old token names** (`--text`, `--muted`, `--border`, `--card`, `--card-2`, `--bg-2`, `--accent-2`,
  `--accent-soft`, `--green`, `--amber`, …) are aliased in a rule of their own, `:root, .rest-timer, .f-sum`, so a
  missed inline style still resolves, and resolves to the dark values inside the two dark objects. Remove that
  rule when no `var(--…)` of the old names is left in the code.
- Layout tokens: `--topbar-h: 52px`, `--tabbar-h: 58px`, `--dock-h: 88px` (0 in Fuel), `--sheet-top: 28px`,
  `--gutter` and `--pad` 16 px (12 px under 360 px wide), `--tap: 44px`, `--ctl: 48px`, `--set: 56px`.

## 4. Type

One family: `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, …` (`--font`). No web font, no monospace.

| Size | Token | Weight | Used for |
| --- | --- | --- | --- |
| 11 px, capitals, +0.06em | `--t-label` | 700 | column heads, read-out keys, GOAL, REPS LEFT, tab labels (tabs are sentence case). **Nothing is smaller.** |
| 12 px | (`.tiny`, pills) | 400 / 600 | footnotes, pills, legends |
| 13 px | `--t-small` | 400 to 700 | second lines, captions, field labels, section headings (`.group-title`, 700) |
| 15 px | `--t-body` | 400; row titles 600 | sentences, rows |
| 17 px | `--t-title` | 700 | card titles, top-bar title, exercise name, list numbers |
| 22 px | `--t-head` | 700 | sheet title, food name (in the amount sheet the food name is the title and "Add food" above it is a 13 px label) |
| 28 px (24 under 360) | `--t-display` | 700 | the workout name on Today, onboarding headline |
| 20 px | `--n-value` | 700 | a value in a read-out strip |
| 24 px (clamp 20 to 24) | `--n-field` | 700 | set fields |
| 34 px (28 under 360) | `--n-big` | 700 | the target line (in the exercise head and in the next-time box), the rest timer, the amount box, the three numbers that open History |
| 48 px (40 under 360) | (`.f-preview`) | 700 | the calories an amount adds, in the amount sheet |
| 52 px (46 under 360) | `--n-hero` | 700 | one per screen at most: kcal left, the Trends average |

- **Numbers need no wrapper.** Tabular figures are switched on by component (`.stat .v`, `.set-table`, `.rest-time`,
  `.f-rk`, `.cal-cell`, chart text, `.table td`, …; the lists are at the top of each stylesheet). Sentences keep
  proportional figures. Use `<span class="num">` only for a number that should lead inside running text, and
  `<span class="u">lb</span>` for a unit that should sit small beside a big number (never under 11 px).
- **Every number that is typed is a read-out too:** any `.input[type=number]` is 17 px / 700 with tabular figures,
  with or without the class `num` (the boxes of Edit exercise need no change). `.input.num` adds the centring and
  the fixed width.
- Inputs are 16 px or more (iOS zooms the page on focus below that): `.input` 16, number inputs 17, `.set-input`
  20 to 24, the amount box 34.
- Letter-spacing: -0.01 to -0.03em on 17 px and up, +0.06em on the 11 px capitals, 0 elsewhere.

## 5. Space, shape, layers

- A 4 px grid: 4, 8, 12, 16, 24, 32. Screen gutter 16 (12 under 360 px wide); inside a card or sheet 16 (12);
  between a section heading and its content 8; between sections 28; between cards 12.
- Radii: 2 px data marks, 6 px tags and reason boxes, 10 px inputs, buttons and keys, 14 px cards, 20 px the
  sheet's top corners. Only the switch and the quick-add key are round.
- No elevation on cards: a hairline (`--rule`) separates layers. Only the sheet, the rest dock, the toast, the
  save warning and the drag ghost sit above the page; in light they get a soft shadow.
- Tap targets: 44 x 44 px at least. Set-row weight, reps and tick are 56 px tall. Controls that look
  smaller than 44 px (pills in the top bar, the target chip on the gauge, the quick-add key) are 44 px elements
  with the visible shape drawn inside by `::before`. One exception, by necessity: a day of the Trends chart is a
  column the full height of the chart and about 20 px wide (13.4).
- Fixed layers (unchanged order): top bar and tab bar 20, status-bar strip 21, rest dock 25, save warning 30,
  sheet 40, toast 50, drag ghost 60.
- Numbers tied together: the screen's bottom padding is `--tabbar-h + safe + --dock-h + 24px`; the sheet is at
  most `min(88vh, 100vh - safe top - --topbar-h - 8px)` tall, so the strip of the top bar is always free above it
  (that is where the toast shows); `#food-added` sticks at `calc(-1 * var(--sheet-top))`; `food.js:377` assumes a
  60 px tab bar for drag auto-scroll (it is 58 now: no change needed). The toast no longer depends on the rest
  dock or the sheet, so the order of `#rest-timer`, `#sheet` and `#toast` in the page does not matter to it.
- Small phones (under 360 px wide): gutters 12, the week strip and the calendar card go edge to edge so their
  seven cells stay 44 px wide, the "/ 2:00" in the rest dock is dropped, hero numbers step down, buttons that sit
  side by side lose their icon, and during a workout the app's mark leaves the top bar (7.1).
- Motion: 120 ms transitions on presses and switches, declared with their rules and switched off, with every
  animation, by the `prefers-reduced-motion: reduce` block at the end of `shared/ui.css`. The two animations (the
  sheet coming up in 220 ms, the busy ring) are declared only under `prefers-reduced-motion: no-preference`. The
  rest meter moves in steps (no transition).

## 6. The state language

| It looks like | It means | Examples |
| --- | --- | --- |
| Solid ink (`--solid`) | recorded, chosen | `.check.on`, `.rir-btn.on`, `.choice.on`, `.seg button.on`, `.switch.on`, `.cal-cell.hit`, `.day-chip.done .d`, `.ex-fold-tick`, the tick before the name of a finished exercise, `.btn.success` ("Logged"), `.f-plus:disabled` (just logged), `.steps li.done`, `.pill.solid` |
| An `--edge` outline | you can tap or type here | `.input`, `.set-input`, `.btn.ghost`, `.btn.subtle`, `.rir-btn`, `.check`, `.choice-grid`, `.seg`, planned days, the buttons in a notice (Export), cardio's Done |
| A neutral key (`--key-2`) with an `--edge` ring | chosen, and it means "off" | the picked Off of an On / Off pair |
| No outline, bare ink numbers | recorded and at rest | a done set row (`.set-row.done .set-input`); the three reps-left keys beside a picked one (a faint `--rule-2` outline, still tappable) |
| The accent | live, next, or the one main action | `.btn`, `.set-row.next` (rail, tick), `.rest-bar-fill`, `.rest-label`, `.gauge-fill`, `.tab.active::before`, `.topbar-meter > span`, today's ring, `.pill.pr`, `.pt.now`, `.bar.now` |
| Danger crimson | destructive, error, more than 5% over target | `.btn.danger`, `.icon-btn.danger`, `.banner.danger`, `.input.error`, `.pill.red`, `.sync-pill.error`, `.gauge.over`, `.bar.over`, `.f-macro.over` |
| Amber | take care (always with a word or icon) | `.notice`, `.banner.warn`, `.pill.amber`, `.deload-toggle.on`, `.vol-fill.low` |
| Green | good (always with a word or icon) | `.pill.green`, `.ex-reason.green`, `.vol-fill.ok`, `.ok-ink` on "weight went up" |
| Faded (`--ink-4`, no fill, no outline) | not available yet | the four keys of `.rir-row.idle` (its REPS LEFT label stays `--ink-3`: readable), `:disabled` at 40% |

Two rules that follow from the table and are easy to get wrong:

- `.btn.success` is a **state** (solid ink: "Logged"), never an action. A thing still to do is `.btn`, `.btn.ghost`
  or `.btn.subtle`. A disabled `.btn.success` stays at full strength: the recorded state is never the faded one.
- `.pill.accent` is only for the one live thing in the top bar (Update ready). A day that has a workout, a muscle,
  a count, a red recovery are not "live": plain `.pill`, `.pill.solid` or a status pill (`.green`, `.amber`, `.red`).

Pressed states exist on everything tappable (`:active`); `.is-pressed` and `.is-focus` mirror them for documentation.
Keyboard focus is a 2 px `--accent-ink` ring 2 px off the control; where the control fills a box that clips
(`.ex-fold`, `.choice`, stepper keys, segments, calendar cells, tabs) the ring is drawn 2 px inside it. Inputs show
a 2 px accent border instead.

## 7. The shell

### 7.1 Top bar

It carries the app's mark and the **screen title**. Static markup (the meter comes **before** `.topbar-inner`: the
stylesheet draws it on the bar's bottom edge, and "the meter is showing" is what switches the bar to its workout
layout, with no class to set):

```html
<header class="topbar">
  <div id="topbar-meter" class="topbar-meter" hidden><span></span></div>
  <div class="topbar-inner">
    <div class="brand"><span class="brand-mark"><!-- icon('mark-overload') or icon('mark-fuel'), pasted as SVG --></span><span id="topbar-title" class="brand-title">Today</span></div>
    <div id="topbar-right" class="topbar-right"></div>
  </div>
</header>
```

The two marks, to paste into `.brand-mark` (they are `icon('mark-overload')` and `icon('mark-fuel')`, the drawings of
the two Home Screen icons on the 24 px grid):

```html
<!-- Overload -->
<svg class="ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><g fill="currentColor" stroke="none"><rect x="1.97" y="11.39" width="20.06" height="1.22" rx=".61"/><rect x="4.41" y="8.25" width="2.53" height="7.5" rx=".89"/><rect x="7.45" y="5.44" width="2.95" height="13.12" rx="1.03"/><rect x="13.6" y="5.44" width="2.95" height="13.12" rx="1.03"/><rect x="17.06" y="8.25" width="2.53" height="7.5" rx=".89"/></g></svg>
<!-- Fuel -->
<svg class="ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M7.17 12a7.03 7.03 0 1 0 14.06 0a7.03 7.03 0 1 0 -14.06 0ZM9.84 16.66C8.95 11.2 12.45 7.34 18.59 7.34C18.77 13.34 15.09 17.3 9.84 16.66Z"/><path d="M11.67 14.84L15.26 10.99" stroke-width=".75"/><path d="M3.19 5.53v3.52a1.17 1.17 0 0 0 2.34 0V5.53M4.36 5.53V18.47" stroke-width="1.17"/></svg>
```

In the top bar the mark is **ink on a neutral key** (`.brand-mark`): the accent is kept for what is live. The filled
tile in the app's Home Screen colour is `.app-tile` and is used where the app appears as an object (Welcome, Add
to Home Screen, the hand-over card): section 8.1.

`renderTopbar()` (the one place) sets the title, the right side and the meter:

| Where | `#topbar-title` | `#topbar-right` | `#topbar-meter` |
| --- | --- | --- | --- |
| Overload, any tab | `Today`, `Program`, `Exercises`, `History`, `Settings` (unreadable data: `Your data`) | Update pill, cloud pill | hidden |
| Overload, Today tab during a workout | the workout's name (`w.dayName`) | the read-out below, then the pills | shown: `style="--n:19"` (sets planned, at least 1), `<span style="width:26.3%">` (sets ticked / planned) |
| Fuel, diary | `Fuel` (the day switcher under it names the day) | Update pill, cloud pill | hidden |
| Fuel, other tabs | `Trends`, `Settings` | pills | hidden |
| Fuel, Welcome and Add to Home Screen | `Fuel` | the pills as `renderTopbar` writes them today (no cloud pill on Add to Home Screen) | hidden |

The workout's read-out and the pills, exactly:

```js
// exercises done / exercises, then the elapsed time
'<span class="tb-meta"><b>' + doneCount + '/' + w.entries.length + '</b><span class="tb-time"><span class="sep">·</span><span id="tb-elapsed">' + durationText(w) + '</span></span></span>'
// Update ready: icon and words (the words show on every screen; during a workout only the icon)
'<button class="pill accent" data-action="reload" aria-label="Update ready">' + icon('refresh', 'm') + '<span>Update ready</span></button>'
// cloud
'<button class="pill sync-pill ' + status + '" data-action="goto-settings" aria-label="Cloud sync: ' + status + '" title="' + esc(ui.sync.msg) + '">' + icon(name, 'm') + '</button>'
```

with `name` = `cloud-check` (synced), `sync` (syncing), `cloud-off` (offline), `warning` (error). Both pills are 44 px
targets. `setSyncStatus` (`app.js:2430`, and Fuel's copy) must set `pill.innerHTML = icon(name, 'm')` (it sets
`textContent` today, which would wipe the icon). `#topbar-meter`: set `hidden`, `style.setProperty('--n', Math.max(1, sets))`
and the span's `style.width`.

- **The elapsed time has two places.** `#tb-elapsed` is the one in the top bar. `#elapsed` stays where it is, in the
  screen's sub line (10.3), so the 30 s refresh (`app.js:2388`) updates both:
  `['#elapsed', '#tb-elapsed'].forEach((q) => { const el = $(q); if (el && w) el.textContent = durationText(w); })`.
- **What gives way when the bar is full** (a long workout name, a two-hour session, both pills: the reference is
  `train-workout-long.html`, shot at 320, 390 and 430). In this order, all in the stylesheet:
  1. the title is cut with an ellipsis, down to a minimum of about three letters (`.brand` has `min-width: 38px + 3em`);
  2. during a workout the Update pill is only its icon;
  3. under 360 px wide, during a workout, the app's mark is not shown;
  4. last, if there is still no room, the elapsed time drops out (`.tb-meta` is one line tall and clipped; the time
     wraps out of sight) and the exercise count stays.
  With "Legs B (hamstrings & glutes)", `12/14 · 1h 59m` and both pills the title reads "Legs B…" at 320 px,
  "Legs B (h…" at 390 and "Legs B (hamst…" at 430, and nothing overlaps (`tools/audit.js` checks it).
- Each screen keeps its `<div class="screen-title"><h1>…</h1>…</div>`. The `h1` stays in the page for assistive tech
  and the tests and is hidden from view; what is left of the row is its `.sub` line and its button (`+ Day`,
  `+ New`, `+ Exercise`). A row with only an `h1` takes no room. No builder has to drop its `h1`. The one exception
  is inside `.onboard` (Fuel's Welcome and Add to Home Screen), where the `h1` is the headline and shows.

### 7.2 Tab bar

```html
<nav class="tabbar">
  <button class="tab" data-screen="today"><span class="tab-icon">SVG</span>Today</button>
  <button class="tab" data-screen="program"><span class="tab-icon">SVG</span>Program</button>
  <button class="tab" data-screen="exercises"><span class="tab-icon">SVG</span>Exercises</button>
  <button class="tab" data-screen="history"><span class="tab-icon">SVG</span>History</button>
  <button class="tab" data-screen="settings"><span class="tab-icon">SVG</span>Settings</button>
</nav>
```

Fuel: three tabs, `data-screen="food"` (label Today), `"trends"`, `"settings"`. Tabs are equal width (78 px at
390 with five, 64 px at 320; 130 and 107 px with three). Labels are 11 px, sentence case. The active tab is ink
with a 32 x 2 px accent bar on the top edge. The eight icons (Settings is the same drawing in both apps):

```html
<!-- Overload: Today (dumbbell) -->
<svg class="ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 10v4M6.5 6.5v11M17.5 6.5v11M21 10v4M6.5 12h11"/></svg>
<!-- Overload: Program (calendar) -->
<svg class="ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>
<!-- Overload: Exercises (list) -->
<svg class="ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6h11.5M9 12h11.5M9 18h11.5"/><path d="M4.25 6h.01M4.25 12h.01M4.25 18h.01" stroke-width="2.6"/></svg>
<!-- Overload: History (chart) -->
<svg class="ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 4v16h16"/><path d="M8 15l3.5-4 3 2.5L20 7.5"/></svg>
<!-- Overload: Settings (settings) -->
<svg class="ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 8h8.5M17.5 8H20M4 16h2.5M11.5 16H20"/><circle cx="15" cy="8" r="2.5"/><circle cx="9" cy="16" r="2.5"/></svg>
<!-- Fuel: Today (gauge) -->
<svg class="ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.5 17a8.5 8.5 0 0 1 17 0"/><path d="M12 17l4-5.5"/><path d="M12 17h.01" stroke-width="2.8"/></svg>
<!-- Fuel: Trends (bars) -->
<svg class="ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4.5" y="12" width="3.5" height="8" rx=".9"/><rect x="10.25" y="4" width="3.5" height="16" rx=".9"/><rect x="16" y="8.5" width="3.5" height="11.5" rx=".9"/></svg>
<!-- Fuel: Settings: the same SVG as Overload's Settings -->
```

`.tab`, `.tab.active` and `data-screen` are unchanged, so the tests and `renderScreen` keep working.

### 7.3 Rest dock (Overload)

Docked full width on the tab bar, 82 px tall (75 at 320), a dark object in both themes and a step lighter than a
card (`--dock`, section 3), so it reads as an object on the dark page too. New static markup:

```html
<div id="rest-timer" class="rest-timer" hidden>
  <div class="rest-timer-inner">
    <div>
      <div class="rest-top"><span class="rest-label">Rest</span><span id="rest-next" class="rest-next"></span></div>
      <div class="rest-clock"><span id="rest-time" class="rest-time">2:00</span><span id="rest-of" class="rest-of"></span></div>
    </div>
    <div class="rest-actions">
      <button class="btn ghost small" data-action="rest-add">+30s</button>
      <button class="btn ghost small" data-action="rest-skip">Skip</button>
    </div>
  </div>
  <div class="rest-bar"><div id="rest-bar-fill" class="rest-bar-fill"></div></div>
</div>
```

- Ids and `.rest-label` are unchanged; `.rest-bar` stays after the inner block (CSS draws it on the top edge).
- New in `startTimer(sec, kind, next)`: `#rest-of` = `'/ ' + fmtTime(sec)` (set once; again after +30s), and
  `#rest-next` = the third argument, a ready line of text (`''` when there is none). `startTimer` cannot work it
  out itself (it is given seconds, not a set), so **the three callers pass it**:
  - `toggle-set` (`app.js:2117`, `startTimer(restFor(ex))`): after ticking set `i` of entry `en`, with
    `left = en.sets.filter((x) => !x.done).length` and `n = en.sets.length`:
    `left ? 'Set ' + (n - left + 1) + ' of ' + n + ' next' : nextEx ? 'Next: ' + nextEx.name : 'Last set done'`,
    where `nextEx` is the exercise of the first later entry that is not done;
  - `toggle-warmup` (2135): `'Warm-up'`;
  - `cardio-timer` (2153): the cardio's name (`c.name`).
  Both spans are optional: empty, they take no room, and the old static markup still works.
- `#rest-bar-fill` keeps `style.width = pct + '%'`. There is no CSS transition any more: the tick meter steps once
  a second. Both buttons are neutral keys whatever class they carry (v2.8 wrote Skip as a primary button; the
  stylesheet draws both as keys, and the new markup says `ghost` for both).

### 7.4 Sheet and toast

`#sheet`, `.sheet-backdrop`, `#sheet-panel`, `openSheet`, `closeSheet` are unchanged; the panel scrolls as a whole.
New look: 20 px top corners, a grabber drawn by CSS (decoration: there is still no swipe to close), 28 px top
padding (`--sheet-top`). Its height is at most `min(88vh, 100vh - safe top - 52px - 8px)`: 88vh as before on an
iPhone with a notch, and never so tall that it reaches the top bar.

```js
function sheetHeader(title, extra) { return '<div class="sheet-title"><h2>' + title + '</h2><div class="row">' + (extra || '')
  + '<button class="icon-btn" data-action="sheet-close" aria-label="Close">' + icon('close') + '</button></div></div>'; }
```

Optional sticky footer for a sheet's main button: wrap it, as the last child of the panel or of its form, in
`<div class="sheet-foot">…</div>`. Used in the reference for Edit exercise (Save) and the amount sheet (Add to
Dinner). Without the wrapper the button sits at the end of the content as today.

**A sheet is a dialog** (3.0). `#sheet-panel` has `role="dialog"`, `aria-modal="true"` and
`aria-labelledby="sheet-heading"`; `openSheet` gives the title's `h2` that id and `tabindex="-1"`. While a sheet is
open the page behind it (top bar, save warning, `#app`, rest dock, tab bar) is `inert`. A new sheet moves focus to
its title (to a box marked `autofocus` when keys are in use); Tab and Shift+Tab go round inside it; Escape closes it
through `closeSheet`, from a text box too; closing gives focus back to what opened it, found again by its tag and
`data-…` attributes when a save has drawn it again. After a touch none of it shows: no ring (`data-quiet-focus`), no
scrolling, and no text box is focused (that would bring up the keyboard). A new sheet goes through `openSheet` and
`closeSheet` and keeps its title as `.sheet-title h2`.

**Keys** (3.0). Tab, or a key pressed outside a text box, puts the class `keys` on `<html>`; the next touch takes it
off. While it is there the page has scroll padding the height of the top bar (and the save warning) above and of
the tab bar and the rest dock below, with the safe areas; and an open sheet's panel has scroll padding the height of
its sticky footer below and of a strip that sticks at its top (Fuel's "Added" line) above, which `openSheet`
measures into `--sheet-foot-h` and `--sheet-head-h` (again when they change size). So a control reached by Tab is
never under a bar or under Save. Without the class nothing moves: touch, and the app's own scrolling, are as before.

`#toast` is unchanged in markup (inverse colours, `pointer-events: none`). **It always shows at the top of the
screen, over the top bar** (6 px under the status bar): one line sits inside the bar, a long message runs a little
below it. It never covers a row, the rest dock, the tab bar or a sheet's controls; over a sheet a two-line toast
reaches the grabber at most, and taps pass through it. There is one position and no rule that depends on the rest dock or on
a sheet, so the three cannot disagree (the first version stretched the toast into a 595 px slab when a sheet was
opened while resting). `train-sheets-swap.html` is that state: resting, a sheet open, a toast.

### 7.5 Save warning, notices, banners

```html
<div id="save-warning" class="save-warning" role="alert" hidden></div>   <!-- unchanged; .banner.danger inside, body.has-save-warning, --save-warning-h -->
```

| Class | Looks like | Markup |
| --- | --- | --- |
| `.banner` | a quiet strip, accent icon | `'<div class="banner">' + icon('flame') + '<span>7-day streak. Keep it going.</span></div>'` |
| `.banner.warn` | amber wash, amber icon | red recovery, a scan message, offline |
| `.banner.ok` | green wash | "Brought across: 118 days…" |
| `.banner.danger` | panel, danger outline, shadow | the save warning; `<b>` is the danger crimson |
| `.notice` | amber wash with something to do | `'<div class="notice">' + icon('warning') + '<span>…</span><button class="btn small" data-action="export">Export</button><button class="icon-btn" … aria-label="Remind me in two weeks">' + icon('close', 'm') + '</button></div>'` |
| `.notice.plain` | the same shape, neutral | (not used by a screen today) |

The text of a banner or notice goes in a `<span>` (the icon and the text are flex items). A button in a notice is
drawn as an outlined key whatever its class (`.notice .btn`): it is something still to do, so it is not solid ink,
and it does not compete with Start workout on Today.

---

## 8. Components

Every component below is on `dev/design/system/components.html` in every state (`?theme=light`, `?app=fuel`).
"New" marks a class that does not exist in v2.8.

### 8.1 Shared

**Card and section.** `.card` is a module (panel fill, hairline, 14 px corners, 16 px padding); `.card.flat` is
transparent (a frame inside a sheet or another card). A card's title is 17 px / 700 however the markup spells it:
`<h2>` in `.card-head`, a `<b>` first in the card's first `.row`, a bare `<b>` first child, or an `<h3>`.

```html
<div class="card"><div class="card-head"><div><h2>Legs</h2><div class="meta">Mon · Thu · 6 exercises</div></div>
  <button class="btn small ghost" data-action="edit-day">Edit</button></div><div class="small muted">Hack Squat, …</div></div>
<div class="group-title">Program library</div>          <!-- 13 px / 700 with a hairline to the right; .first = no top gap -->
```

**Rows.** `.list` > `.list-item` (a `button` or a `div`): hairline between rows, 56 px minimum, never a box each.
`.title` 15 / 600 wraps anywhere; `.sub` 13 px `--ink-3` wraps; the last child is a chevron
(`'<span class="chev">' + icon('chevron-right', 'm') + '</span>'`), a button or an icon button.
`.toggle-row`: label and description left, one control right; the control wraps under the label when there is no
room (no four-line labels at 320 px). Two controls behave on their own, with no class to add: a `.seg` that does
not fit beside its label drops under it and **fills the row** (Appearance, at 390 px and below), and a text box
(`.input` that is not a number or a time) always takes a full row under its label, so its value is never cut (the
cardio name). `.toggle-row.stack` (new) puts the control row under the label (reminders); its gap is 8 px.

**Read-out strip.** `.stat-row` > `.stat` > `.v` then `.k` (markup unchanged; shown key above value, hairlines
between cells, values on one baseline, a long key wraps upward instead of being cut). A strip that is a direct
child of the screen (`.screen > .stat-row`: the three numbers that open History) is drawn at 34 px, so a number
leads that screen too.

**Buttons.**

| Class | Role | Look |
| --- | --- | --- |
| `.btn` | primary: one per screen or sheet | accent fill (`--btn`), dark ink label, 48 px. Fuel in light: volt with a leaf-green edge |
| `.btn.ghost` | secondary | raised key (`--key`) with an `--edge` outline, ink label |
| `.btn.subtle` | quiet: tools, Cancel, Back | outline only, `--ink-2` label |
| `.btn.danger` | destructive | danger outline and label, never filled |
| `.btn.success` | a recorded state ("Logged"), never an action | solid ink (the language of a ticked set); disabled it stays at full strength |
| `.btn.text` (new) | the quietest ("Start fresh", "Use it here anyway") | underlined text, still 44 px tall |
| `.small` / default / `.big` (new) | size | 44 / 48 / 56 px |
| `.block` | full width | the label may run to a second line: it is centred and the icon stays with the first word |
| `:disabled`, `[aria-disabled]` | not available | 40% opacity (except `.btn.success`) |
| `.busy` (new), `[aria-busy="true"]` | working | a ring turns left of the label (static under reduced motion), no pointer events |
| `.btn-row` | buttons side by side | equal widths while every label fits on one line; when they do not fit, the row breaks and each button takes a full line. **A label in a row never wraps.** Under 360 px the icons in a row are not shown |
| `.icon-btn` | icon only, 44 x 44, no outline | `.key` (new) = raised and outlined; `.danger` = danger ink; give each an `aria-label` |

An icon goes first inside a button (`icon('plus') + 'Day'`), or last when it points away (`'Get Fuel' + icon('external')`).
`.btn.small` is 44 px now, so the `min-height: 44px` patches (`.deload-start`, `.fold-row .btn`, `.notice .btn`,
`.copy-row .btn`, `.f-added .btn` …) are no longer needed; the classes still work. `a.btn` needs no
`style="text-decoration:none"`.

**Pills.** `.pill` (outlined tag, 12 px, sentence case), `.green`, `.amber`, `.red` (new), `.solid` (new: chosen or
scheduled), `.pr` (accent wash; put `icon('trophy')` before the text), and `.accent`, which is only for Update
ready. In the top bar a `button.pill` is a 44 px target; the accent one is outlined in `--accent-ink` (5.7:1 or more).

**Inputs.**

```html
<div class="field"><label>Name</label><input class="input" name="name" …></div>             <!-- label 13 / 600, sentence case -->
<div class="field-row"><div class="field">…</div><div class="field">…</div></div>
<select class="select">…</select>                                                           <!-- chevron drawn from tokens -->
<input class="input" type="number" …>                 <!-- any number input: 17 / 700, tabular (no class needed) -->
<input class="input num" type="number" …>            <!-- new: a centred number box, 88 px wide -->
<input class="input num n2" type="number" …>         <!-- new: the narrow one, 64 px (one of a pair, hours, minutes) -->
<div class="row tight">INPUT<span class="muted">–</span>INPUT</div>                           <!-- new .tight: 8 px gap -->
<div class="search">' + icon('search') + '<input class="input" type="search" …></div>       <!-- new: search field with its icon -->
<input class="input error" aria-invalid="true">  <div class="form-msg">Wrong password.</div> <!-- new: error state and message -->
<label class="input-unit"><input class="input num" …><span class="u">lb</span></label>       <!-- new, optional: value and unit in one outline -->
<textarea class="input" rows="3" …></textarea>                                              <!-- several lines (Fuel's paste box): 96 px or more, 12 px padding, no resize handle -->
```

Focus: accent border and ring. Disabled: no fill, `--ink-3` text (still readable on iOS). `input[type=time]` is
at most 150 px wide.

Every field is named (3.0): `aria-label` carries the text of its visible label, word for word
(`<div class="field"><label>Name</label><input class="input" name="name" aria-label="Name"></div>`; in a
`.toggle-row`, the row's label). Not `<label for>`: a tap on the label would focus the box and bring up the
keyboard, and some rows are on screen twice (Fuel's targets, in Settings and in their sheet). The look tests check
that each field's name holds its label.

**Stepper** (new, not used by a v2.8 screen; ready for the amount sheet):
`<div class="stepper"><button aria-label="Less">icon('minus')</button><input class="val" type="number"><button aria-label="More">icon('plus')</button></div>`, `.stepper.big` is 64 px tall with 34 px digits.

**Segmented control.** `.seg` > `button` (`.on` = solid ink), unchanged markup; 44 px segments. `.seg.block` (new)
and `.seg.f-mealseg` fill the width. **An On / Off pair** is recognised by how the app already writes it
(`data-v="1"` on the first button, `data-v="0"` on the second): a picked On is solid ink, a picked Off is a neutral
key with a ring, so on and off are not equally loud and a row of settings can be read without reading the words.
No markup change; a new On / Off pair must keep that `data-v` order.

**Switch** (new, optional replacement for an On / Off `.seg`):
`<button class="switch on" role="switch" aria-checked="true" aria-label="Sleep"></button>`, 52 x 30 px in a 44 px
target. The deload switch (`.deload-toggle .sw`) is the same size. The `.seg` keeps working.

**Meters and bars.** `.meter` (new) is the tick meter: `<div class="meter" style="--v:62%"></div>`, colours `.ink`
`.ok` `.warn` `.bad`. `.topbar-meter` is the stepped one in the top bar. `.vol-row` > `.vol-name`, `.vol-bar` >
`.vol-fill` (`.low` `.ok` `.high`), `.vol-n` are unchanged and also draw the storage meter.

**Table** (new, used by Trends): `<table class="table">`, `th` are 11 px capitals, `.r` is a right-aligned
number column (`td.r` 17 / 700, `td.r.prev` quieter), `<span class="of"> / 190 g</span>` for the target.

**Calendar.** `.cal-grid` > `.cal-head` x7, `.cal-cell` (a `button` when it has a workout). States: `.hit` trained
(solid cell), `.hit.deload` (hollow ink ring), `.plan` (new: outline), `.today` (accent ring), `.pr` (new: accent
dot), `.rest`, `.future`, `.empty`. The card gets `.cal-card` (new) so it can go edge to edge on small phones.
Under the grid: `.cal-legend` (new) with `<i class="cal-key hit">` / `deload` / `plan` / `pr`.

**Empty state.** `.empty`, optionally with an icon first and a `<b>` line:
`'<div class="empty">' + icon('dumbbell') + '<b>No workouts yet</b>Finish one and it shows up here.</div>'`.

**Steps** (new): `<ol class="steps"><li><b>Get Fuel</b> …</li>…</ol>` (numbered boxes; `li.done` is solid).
`ol.install-steps` (the class `fuel.js` writes) is drawn the same way.
**App tile** (new): `<span class="app-tile l" data-app="fuel">` + `icon('mark-fuel')` + `</span>`; sizes default 28,
`.l` 44, `.xl` 72 px. It is the app's Home Screen icon in small: `data-app` picks whose, and **its colour is fixed**
(`--tile`: Overload `#ff5a2e`, Fuel `#c4f03a`, mark `#0c0d0e`), the same in dark and in light, with a hairline edge
so the volt tile keeps a boundary on paper. "Open Fuel from its new icon" therefore sits under a tile of the icon's
colour. The mark in the top bar is not a tile (7.1).

### 8.2 Overload

**Week strip.** Seven `button.day-chip`: weekday letter, then the date in a 36 px cell. Trained = solid cell,
scheduled and still to come = outline, today = accent ring, rest or past = bare, selected = raised with an ink bar.

```html
<button class="day-chip past done" data-action="select-day" data-i="0" aria-label="Monday 16, trained"><span class="wd">M</span><span class="d">16</span></button>
<button class="day-chip today selected" data-action="select-day" data-i="5" aria-label="Saturday 21"><span class="wd">S</span><span class="d">21</span></button>
<button class="day-chip rest" …><span class="wd">S</span><span class="d">22</span></button>
```

**Today's card** (`.card.flat.today-card`: it keeps `flat`, which the tests find it by, and gains `today-card`,
which gives it the panel back): the name at 28 px, one line of facts, Start (`.btn.block.big`), a row of two 44 px
secondary buttons, then the exercise rows. See 10.2.

**Exercise card, open.**

```html
<div class="card ex-card" data-card="1"><div class="ex-head">
  <div class="row between"><div class="ex-name">Machine Chest Press</div><span class="row tight"><span class="pill">Chest</span></span></div>
  <div class="ex-target"><span class="num">150</span><span class="u">lb</span><span class="x">×</span><span class="num">12</span></div>
  <div class="ex-presc">3 sets · 10–12 reps</div>
  <div class="ex-last">Last time: 150×12, 150×11, 150×11</div>
  <div class="ex-note">' + icon('note', 's') + '<span>Seat 4, pin 7</span></div>
  <div class="ex-reason">Every set at least 10 → same weight, goal is your lowest set + 1</div>
</div><div class="ex-body"> … </div></div>
```

- `.ex-target` (new) is the big line: 34 px (28 under 360 px wide). With no weight it is
  `<span class="num">9</span><span class="u">reps</span>`.
- `.ex-reason`: neutral by default; `.green` when the plan went up; `.warn` (new) for a caution; `.pr` (new) for
  the record line (`icon('trophy', 's')` first).
- `.ex-note` is a quiet line with an icon, not a chip.
- The pills drop under the name when the name would get less than 200 px beside them (a PR pill and a long muscle
  name, or any pill pair at 320 px), so a long name is never squeezed into a narrow column.
- `.ex-card.done` that is open (not `.compact`) shows the solid tick of the folded row before its name, drawn by
  the stylesheet. No markup.

**Set table.** A real `<table class="set-table">` as today. Row states:

| Row | Wells | Tick | Extra |
| --- | --- | --- | --- |
| pending | outlined, 56 px | outlined | the goal is the reps placeholder, dimmed |
| `.set-row.next` (new class) | outlined | accent outline and wash | accent rail on the card's left edge, accent set number, `GOAL` under the dimmed number |
| `.set-row.done` | none: bare ink digits (the outline returns on focus) | solid ink | |
| exercise finished (`disabled`) | none, full ink | solid | |

```html
<tr class="set-row next"><td class="n">3</td>
 <td><input class="set-input" type="number" inputmode="decimal" … data-field="weight" data-e="1" data-s="2" aria-label="Set 3 weight"></td>
 <td><input class="set-input" type="number" inputmode="numeric" … placeholder="12" data-field="reps" data-e="1" data-s="2" aria-label="Set 3 reps"><span class="set-hint">Goal</span></td>
 <td class="chk"><button class="check" data-action="toggle-set" data-e="1" data-s="2" aria-label="Set 3 done" aria-pressed="false">' + icon('check') + '</button></td></tr>
```

`.set-hint` shows only in the `.next` row and only while the reps box is empty (`:placeholder-shown`), so typing
or ticking hides it with no script. It is tied to the reps box by `data-field="reps"`: the weight box of the next
row, whose placeholder is the unit, is left alone. **Write `.set-hint` only when `en.targetReps > 0`**: without a
goal the placeholder is the word "reps" and must not get GOAL under it.

**Reps in reserve.** `.rir-row` > `.rir-pick` > `.rir-label` + four `.rir-btn`: separate 44 px keys with 6 px gaps,
picked = solid ink. Once one is picked the other three step back (no fill, a faint outline, `--ink-3` digits;
still tappable), so a recorded row reads as recorded. `.rir-row.idle` (the set is not ticked yet): the label stays
readable (`--ink-3`), the four keys are bare faded digits with no outline and are not tappable, so a card still to
come is not a grid of boxes. Markup unchanged.

**Warm-ups.** `.warmups` (a quiet hairline frame, no dashes) > a `.row.between` with
`<span class="label">Warm-up</span>` and the clear button, then `.warmup-row` (`.done`) with `.n`, the weight and
reps in `<b>`, and a `.check.small` (44 px).

**Questions** (soreness, feedback). `.prompt` > `.prompt-q`, then per question a `<div class="label">` and a
`.choice-grid` of `.choice` buttons (`.on` = solid ink). The keys are joined in one outline; three answers sit in
a row, four make a 2 x 2 block. Markup unchanged apart from the label class.

**What comes next time.** `.next-box`: an 11 px `NEXT TIME` label, the target line again (`.ex-target`, 34 px:
"65 lb × 10"), the facts (`.ex-presc`: "3 sets · 10–12 reps"), then the reasons as bullets. The number leads here
as it does in the head. `.headline` (17 / 700) remains for "Deload: plan kept". Markup in 10.4.

**Cardio.** `#cardio-card` with `.cardio-line` (two lines in one grid cell, so Done changes no height). Before it is
logged, Done is an outlined key (`.btn.ghost`, something to do); after, "Logged" is solid ink at full strength
(`.btn.success` disabled, a recorded state). 10.5.

**Other.** `.ex-card.done.compact` > `.ex-fold` (tick badge, name that wraps, sub line, PR pill, chevron),
`.deload-toggle` (`.on` = amber) and `.deload-hint`, `.card.fold-row` (check-in done), `.checkin-done` (new class
on the saved morning check-in: title and Edit on the first line, the recovery pill on the second), `.set-tools`
(three across) and `.set-tools.secondary` (two across), `.hist-set` (label left, numbers right), `.pr-line` (new),
`.review-list` (hairline rows), `.set-lbl` (new: the "Set 1" label in Edit sets).

**Hand-over card** (SPEC 3.3; built by `handoverHtml` in `app.js`). `.card.handover` (new class) > `.handover-head`
(Fuel's tile, the title, on Today the hide button), the sentence, `ol.steps` with the two rows of keys and the
status line, the line for cloud sync users, `.handover-remove` (Settings only). There is **no accent button in
it**: all four are outlined keys, so on Today Start workout stays the one main action. In Settings the card is
drawn in full. On Today (`#handover[data-where="today"]`, as the code already marks it) the same markup is drawn
short by the stylesheet: a 36 px tile, no step headings, no fine print (`.more`), two rows of keys, the status and
"This card is also in Settings, under Food": 306 px tall at 390 px wide, so with the streak banner above the week
strip Start workout is still whole on the first screen at 390 x 844 (at 320 px wide its bottom edge meets the tab
bar). Every state and its markup: 10.11.

### 8.3 Fuel

**Day switcher.** `.f-daynav`: `icon-btn` previous, `.f-daylabel`, `icon-btn` next (unchanged, icons instead of
glyphs).

**Summary** (`.card.f-sum`, a dark object in both themes): v2.8's read-out kept in the page but hidden from view
(`.f-kcal.sr`, for assistive tech and the tests), then the gauge, its foot line, the three macros. Markup in
10.12. The gauge is 132 px tall at its full 264 px width, 176 px with the foot line. The big number is
`.gauge-num` (new); `.f-big` keeps its v2.8 meaning, calories eaten. States of `.gauge`: none (under target, and
up to 5% over it: the dial is full and the label says "kcal over", without alarm), `.over` (more than 5% over:
danger crimson, the same 5% rule as the macro bars and the Trends bars), `.none` (no target).

**Macros.** `.f-macros` > `.f-macro` x3 (`.k`, `.v`, `.f-bar > span`), unchanged. The order gives each its mark
and tone: protein a square in ink, carbs a blue circle, fat a violet diamond. "133 / 190 g": when the cell is too
narrow the target wraps under the value as one piece and the three bars stay level (320 px, or a four-digit
value). A macro over its target (more than 5% over) gets `.f-macro.over` and its bar `span.over`: danger crimson.
Anywhere else, put the mark by hand: `<i class="mk p"></i>`, `<i class="mk c"></i>`, `<i class="mk f"></i>`.

**Meals.** `.card.f-meal` is drawn as a section, not a box: `.f-meal-head` (name, kcal, `⋯` as
`icon('more')`), `.f-row` rows (`.title` two lines at most, `.sub` wraps and is never cut, `.f-rk` the calories
at 17 / 700), then `+ Add food`. Drag states `.f-lifted`, `.f-ghost`, `.f-drop-target`, `.f-drop-line`,
`body.f-dragging` and the `user-select` rule on `.f-meal .f-row[data-id]` are all kept.

**Add sheet.** `#food-added` (sticky) > `.f-added` / `.f-added.none`; `.f-searchrow` (search field and the
`.f-scanbtn` key); `.f-addbtns`; in `#food-results` the group titles and rows. Quick rows show the calories as a
number column before the `+` key; the key is a 44 px target with a 36 px outlined circle, solid ink with a check
once logged.

**Amount sheet.** `.f-food-name` 22 / 700 is the sheet's title (the header above it, "Add food" or "Edit", is
drawn as a 13 px label where `:has()` is known); `.f-amount` = the amount box (64 px tall, 34 px digits) and the
unit select; `.f-preview` = the calories this adds on a line of their own at 48 px ("325 kcal"), then the three
macros with their marks; `.seg.f-mealseg`; the save button. The markup stays four `.stat` cells.

**Scanner.** `.f-scanview` (black, 4:3) with `.guide`; `#scan-status`; two buttons.

**Trends** (new screen): a card with `.trend-hero` (the 52 px average and a side read-out), the bar chart whose
days can be tapped (13.4) and a `.legend`; `.group-title`; a card with the `.table`. **Welcome** and **Add to Home
Screen** (new screens): inside `main.screen`, with the top bar and without the tab bar (`body.no-tabs`, as
`fuel.js` sets it): `.onboard` > `.onboard-brand` (Fuel's tile at 72 px), the screen's `h1` (it shows here),
`.lede`, a `.list` of `.choice-card` buttons (`.first` = the recommended one) or `ol.install-steps`, `.foot`.
The same `.choice-card` rows are in the import sheet. Markup in 10.13.

---

## 9. Every existing class (inventory 5.3), and what the tests read

### 9.1 The classes

Nothing is renamed. "Restyled" means: keep the class and the markup, the look comes from the new stylesheets.

**Shell**

| Class | Status |
| --- | --- |
| `.topbar`, `.topbar-inner`, `.topbar-right` | restyled; markup change: `#topbar-meter` is added before `.topbar-inner` (7.1) |
| `.brand` | kept, markup change: the text goes in `<span id="topbar-title" class="brand-title">` and is the screen title (7.1) |
| `.brand-mark` | kept, markup change: holds the app's mark as inline SVG, ink on a neutral key (was an empty span drawn as a red diamond) |
| `.screen` | restyled |
| `.screen-title`, `.screen-title .sub` | restyled: the `h1` is hidden from view (kept for assistive tech and the tests), the row shows the sub line and the button. Workout: the sub line keeps its whole text; the count and the elapsed time, now shown in the top bar, are wrapped in `.sr` (10.3). Inside `.onboard` the `h1` shows |
| `.tabbar`, `.tab`, `.tab-icon`, `.tab.active` | kept, markup change: glyph to SVG; the Food tab goes (Overload), three tabs (Fuel) |
| `.rest-timer`, `.rest-timer-inner`, `.rest-label`, `.rest-time`, `.rest-actions`, `.rest-bar`, `.rest-bar-fill` | kept, markup change: new `.rest-top`, `.rest-next`, `.rest-clock`, `.rest-of` (7.3). The old markup still works |
| `.sheet`, `.sheet-backdrop`, `.sheet-panel`, `.sheet-title` | restyled (`@keyframes up` is now `sheet-up`, used only by the stylesheet) |
| `.toast` | restyled: always at the top of the screen (7.4) |
| `.save-warning`, `body.has-save-warning`, `.banner.danger` | restyled |

**Buttons**

| Class | Status |
| --- | --- |
| `.btn`, `:active`, `:disabled`, `.block`, `.ghost`, `.subtle`, `.danger`, `label.btn`, `.btn-row` | restyled |
| `.btn.small` | restyled: 44 px (was 40) |
| `.btn.success` | restyled: solid ink, not green, and only for a recorded state. Finish workout and cardio's Done no longer use it (10.3, 10.5); cardio's "Logged" keeps it |
| `.deload-start`, `.backup-btns`, `.copy-row`, `.f-addbtns`, `.fold-row .btn`, `.set-tools .btn`, `.notice .btn`, `.f-added .btn` | restyled (the 44 px patches are now the default) |
| `.icon-btn`, `.icon-btn.danger`, `:disabled` | restyled: 44 x 44, no outline; glyph to icon and an `aria-label` at every call site (section 11) |
| `.f-more`, `.f-x`, `.f-scanbtn`, `.f-plus`, `.f-star` | restyled; glyph to icon |
| `.f-daylabel` | restyled |
| `.check`, `.check.on`, `.check.small` | restyled; markup change: `✓` to `icon('check')`, plus `aria-label` and `aria-pressed` |

**Choices, switches, segmented controls**

| Class | Status |
| --- | --- |
| `.seg`, `.seg button`, `.on`, `.f-mealseg` | restyled (selected = solid ink; in an On / Off pair a picked Off is a neutral key, 8.1) |
| `.choice-grid`, `.choice`, `.choice.on` | restyled (joined keys; 3 across or 2 x 2 by count) |
| `.rir-row`, `.rir-pick`, `.rir-label`, `.rir-btn`, `.rir-btn.on`, `.rir-row.idle` | restyled (8.2) |
| `.day-strip`, `.day-chip`, `.today`, `.selected`, `.rest` | kept, markup change: `.wd` and `.d` spans, new `.done` and `.past` (10.2) |
| `.day-chip .dot` | removed (the date cell replaces it; still drawn if left in) |
| `.deload-bar`, `.deload-toggle`, `.sw`, `.on`, `.deload-hint` | restyled |

**Pills and banners**

| Class | Status |
| --- | --- |
| `.pill`, `.green`, `.amber` | restyled |
| `.pill.accent` | restyled, and kept for Update ready only. Markup change at the two other call sites: the red recovery pill becomes `.pill.red` (10.2), the training days in the program sheet become `.pill.solid` (10.9) |
| `.pill.pr` | restyled; `🏆` to `icon('trophy')` |
| `.sync-pill` + `.synced` `.syncing` `.offline` `.error` | kept, markup change: an icon instead of glyph text, set with `innerHTML` (7.1) |
| `.hist-set .pill`, `.ex-fold .pill` | restyled |
| `.banner` | kept, markup change: icon, then the text in a `<span>`; red recovery adds `.warn` |
| `.notice` | kept, markup change: `icon('warning')` first, `✕` to `icon('close', 'm')`. Its button is drawn as an outlined key |

**Inputs and forms**

| Class | Status |
| --- | --- |
| `.input`, `.select`, focus | restyled |
| `.field`, `.field label`, `.field-row` | restyled (labels are sentence case, 13 px) |
| `.toggle-row` | restyled; inline widths on its number boxes become `.input.num` (section 12) |
| `.set-input`, placeholder, focus, done | restyled; markup change: `<span class="set-hint">Goal</span>` after the reps box |
| `#cardio-card .input:disabled` | restyled |
| `.f-searchrow` | kept, markup change (recommended): the input sits in `.search` with its icon |
| `.f-amount` | restyled |

**Cards and boxes**

| Class | Status |
| --- | --- |
| `.card`, `.card.flat`, `.card-head`, `.meta`, `.card-actions` | restyled (Today's day card keeps `card flat` and gains `today-card`) |
| `.fold-row` | restyled |
| `.prompt`, `.prompt-q`, `.hint` | restyled (no box) |
| `.next-box`, `.headline` | kept, markup change: a `.label`, the `.ex-target` line and an `.ex-presc` line replace the one-line headline (10.4); `.headline` stays for "Deload: plan kept" |
| `.warmups`, `.warmup-row`, `.n`, `.done` | restyled; the inline-styled label becomes `<span class="label">` |
| `.stat-row`, `.stat`, `.v`, `.k` | restyled |
| `.empty` | restyled |

**Exercise card**

| Class | Status |
| --- | --- |
| `.ex-card`, `.ex-head`, `.ex-name`, `.ex-last`, `.ex-body` | restyled |
| `.ex-card.done` | restyled: no green border or gradient; an open finished card shows the solid tick before its name (the folded one is `.compact`, below) |
| `.ex-presc` | kept, markup change: it holds the facts ("3 sets · 10–12 reps"); the weight and goal move to the new `.ex-target` above it (10.4) |
| `.ex-reason`, `.green` | restyled (neutral by default); new `.warn`, `.pr` |
| `.ex-fold`, `.ex-fold-tick`, `.ex-fold-name`, `.ex-fold-sub`, `.chev` | restyled; glyphs to icons; the name wraps instead of being cut |
| `.ex-note` | kept, markup change: the pencil from CSS `content` goes; `icon('note', 's')` and the text in a `<span>` |
| `.set-table`, `th`, `.n`, `.chk`, `.set-row` | restyled; new `.set-row.next` |
| `.set-tools`, `.secondary` | restyled |
| `.cardio-line`, `.off` | restyled (same trick: both lines in one grid cell) |
| `compact` (no rule in v2.8) | now styled: the folded card is transparent |

**Lists and rows**

| Class | Status |
| --- | --- |
| `.list`, `.list-item`, `.title`, `.sub` | restyled (hairline rows) |
| `.chev` | kept, markup change: `›` to `icon('chevron-right', 'm')` (picker rows: `icon('plus', 'm')`) |
| `.group-title`, `.first` | restyled (inline tweaks on it are dropped, section 12) |
| `.hist-set`, `.nowrap`, `.review-list` | restyled |
| `.copy-row`, `.backup-btns`, `.store-bar` | restyled |
| `.f-row`, `.title`, `.sub`, `.f-rk` | restyled (the sub line wraps, it is never cut) |
| `.f-qrow`, `.f-qpick` | kept, markup change: a `.f-rk` calories cell before the `+` key (10.12) |
| `.f-static`, `.f-menu`, `.f-danger` | restyled |
| `.f-favmark` | kept, markup change: `★` to `icon('star-filled')` |

**Charts and meters**

| Class | Status |
| --- | --- |
| `.chart`, `.line`, `.pt`, `.grid`, `.lbl`, `.pt.faint`, `.pt.deload` | restyled; new geometry and `.pt.now` (section 13) |
| `.sl-deep`, `.sl-rem`, `.sl-other`, `.sl-key` | restyled (the neutral ramp) |
| `.vol-row`, `.vol-name`, `.vol-bar`, `.vol-fill` + `.low` `.ok` `.high`, `.vol-n` | restyled |
| `.f-bar`, `span`, `.m`, `.over` | restyled (macro bars; the calorie bar is replaced by the gauge) |
| `.cal-grid`, `.cal-head`, `.cal-cell` + `.empty` `.rest` `.future` `.hit` `.today` | restyled; new `.plan`, `.deload`, `.pr`; the card gets `.cal-card` (10.6; until it has the class, `.card:has(> .cal-grid)` finds it) |

**Food**

| Class | Status |
| --- | --- |
| `.f-daynav` | restyled |
| `.f-sum`, `.f-macros`, `.f-macro` | kept; `.f-sum` gets the gauge markup after the old read-out |
| `.f-kcal`, `.f-big`, `.f-left`, `.f-left.over` | kept with their v2.8 markup, text and meaning (`.f-big` = calories eaten); the block gains the class `sr` and is hidden from view (10.12). Without `sr` it is still drawn. `.f-big` is also the average on Trends |
| `.f-meal`, `.f-meal-head` | restyled (a section, not a box) |
| `.f-lifted`, `.f-ghost`, `.f-drop-target`, `.f-drop-line`, `body.f-dragging` | restyled |
| `.f-copyday` | restyled |
| `#food-added`, `.f-added`, `.none` | restyled (the sticky offset follows `--sheet-top`) |
| `.f-food-name`, `.f-preview` | restyled; recommended: units move into the value (10.12) |
| `.f-scanview`, `video`, `.guide` | restyled |
| `f-target-note` (no rule in v2.8) | now styled |

**Utilities**: `.muted`, `.small`, `.tiny`, `.center`, `.mt8`, `.mt12`, `.mt16`, `.mb8`, `.row`, `.between`, `.grow`,
`.stack` are kept with the same meaning. New: `.dim`, `.nowrap`, `.mt24`, `.row.tight`, `.row.wrap`, `.row.base`,
`.label`, `.num`, `.u`, `.accent-ink`, `.ok-ink`, `.warn-ink`, `.bad-ink`, `.sr` (hidden from view).

Names the JavaScript relies on (inventory 5.5) are all untouched: every id, `.tab`, `.topbar`, `.rest-label`,
`.sync-pill`, `.sheet-title h2`, `#app > .screen-title`, `.choice-grid`, `.set-row`, `.prompt`, `.f-meal`,
`.f-row[data-id]`, `.f-mealseg button`, `.f-target-note`, the state classes and every `data-*`.

### 9.2 What the tests read, and the hooks that keep it

The release proof (SPEC section 8) compares what the screens **say** with `tests/fixtures/v28-facts.json`, read
from the page by `tests/train-common.js`, `tests/fuel-common.js` and `tests/smoke-v28.js`. A redesign changes
text and structure in exactly those places, so each has a hook below. Followed as written, the facts the tests
read stay identical and no test has to change.

| The tests read | Read by | The design would change it because | The hook |
| --- | --- | --- | --- |
| `.card.flat h2`, `.card.flat .meta`, `.card.flat .list .list-item` on Today (`dayCard`, `dayMeta`, `plan`) | `readToday` in `tests/train-common.js`, `smoke-v28.js` | Today's card is a panel now | keep `flat`: `class="card flat today-card"`. The `.meta` text stays `'Saturday · 6 exercises'` (nothing is appended to it) |
| `.screen-title .sub` of the workout: `"Sat, Nov 21 · 2/6 done · 1h 0m"` | `readToday`, `readActive` | the count and the time moved to the top bar | the sub line keeps its text; the part after the date is wrapped in `<span class="sr">` and still holds `#elapsed` (10.3) |
| `.banner` on Today: `"🔥 7-day streak. Keep it going."` | `readToday` | the emoji is an icon | `icon('flame', '', '🔥 ')`: the glyph is the icon's text alternative |
| the check-in card's text: `"Morning check-in ✓Recovery 71%Edit183.6 lb · …"` | `readToday` | the tick is an icon; the pill sits on the second line | `icon('check', 's', '✓')`, and the markup keeps v2.8's order (title, pill, Edit): the stylesheet moves the pill (`.checkin-done`) |
| `.stat .v` on History: `"🔥 7"` | `readHistory` | icon | `icon('flame', 'm', '🔥 ')` |
| a workout row's whole text, and `/🏆 (\d+)/` in it: `"… · 1h 59m · 🚶 25 min · 🏆 1›"` | `readHistory` (`firstRow`, `rowsWithPr`, `prTotal`) | three glyphs are icons | `icon('heart', 's', '🚶')`, `icon('arrow-up', 's', '↑')`, `icon('trophy', 's', '🏆')` and, in these rows only, `icon('chevron-right', 'm', '›')`; the separators stay `' · '` (10.6) |
| the Weekly review card's text: `"…🏆 PRs: …"` | `readHistory` (`review`) | icon | `icon('trophy', 's', '🏆 ')` |
| the chart card's lines: `"🏆 Heaviest: 200 × 11 on …"` | `readChart` (`lines`) | icon | `icon('trophy', 's', '🏆 ')` |
| `svg.chart circle.pt` count = sessions | `readChart` (`dots`) | new `.pt.now`, `.pt.deload` marks | they are the same circles with one more class: the count is unchanged. (The body-weight chart gains one `circle.pt.now`; it is not counted) |
| `.f-big` = calories eaten, `.f-kcal > div:first-child` = `"1,257 / 2,400 kcal"`, `.f-left` = `"1,143 left"` | `readDay` in `tests/fuel-common.js`, `readFoodDay` in `train-common.js`, `smoke-v28.js`, and through them `fuel-import.js`, `fuel-backup.js`, `fuel-guard.js`, `fuel-shell.js`, `train-rollback.js` | the gauge shows what is left as its big number | the v2.8 block stays in the page, first in `.f-sum`, as `<div class="f-kcal sr">` with the same markup and text; the gauge's number is `.gauge-num` (10.12) |
| `.f-macros .f-macro:nth-child(n) .v` = `"103 / 190 g"` | `readDay` | none | unchanged (the target may wrap to a second line; the text is the same) |
| `.f-favmark`'s parent text minus `★` | the add-sheet readers in `fuel-common.js` and `train-rollback.js` | the star is an icon | none needed: the icon has no text, the name is what is left |
| `#handover .card` starting `"Food has moved to Fuel"`, its wordings, `#handover a.btn` with the text `Get Fuel`, `[data-action="handover-copy" / "-file" / "-link" / "-hide" / "-remove"]`, `#handover[data-where="today"] .card` | `train-handover.js`, `train-upgrade.js` | the card is restyled | the card keeps its wrapper, its texts, its actions and `a.btn`; the tile and the icons add no text (10.11) |
| Fuel's Welcome and Add to Home Screen: the sentences `Tap Share in Safari's toolbar`, `Choose Add to Home Screen`, `Open Fuel from its new icon`, … and the `href` of Open in Safari | `fuel-guard.js`, `fuel-shell.js` | icons are added inside the sentences | the icon goes right after the bold word with no space of its own (`'<b>Share</b>' + icon('share') + ' in Safari…'`), so the sentence reads the same; Open in Safari stays an `<a href="x-safari-…">` (10.13) |
| `.tabbar` is not visible on Welcome and Add to Home Screen | `fuel-guard.js` | `fuel/fuel.css` is replaced | `body.no-tabs .tabbar { display: none }` is in the new `fuel.css` |
| `.brand`'s text | `smoke-v28.js`, `train-upgrade.js` | it is the screen title now | nothing fails: it is only printed in the step's result ("Overload, 678 KB" becomes "Today, 678 KB") |

The rule behind the glyph rows: **where a glyph was part of a line of text, the icon that replaces it carries the
glyph as its text alternative** (the third argument of `icon()`, written as `<span class="sr">`). Assistive tech
goes on hearing "trophy 2"; the tests go on reading it. Where the glyph was the whole content of a button (✕, ⋯,
‹ ›) the button gets an `aria-label` instead and no text alternative. Row chevrons are decoration and get none,
except in History's workout rows, whose whole text is a recorded fact.

Not kept, on purpose: nothing. If a builder is changed beyond this guide (a new fact on the Today card's line, a
reworded check-in), the matching fact in `v28-facts.json` will differ and the reader in `tests/train-common.js`
has to be adjusted with it.

---

## 10. Markup changes, by screen

Line numbers are those of v2.8 for `app.js`, `food.js` and `connector.js` (the ones the inventory uses). The code
written since (`handoverHtml` and `fuelButtons` in `app.js`, all of `fuel/fuel.js`) is still moving, so it is
named by function only.
**Must** = the look depends on it. **Should** = recommended, the old markup still renders correctly. Everywhere a
glyph becomes an icon the rule is the same: `icon('name')` in place of the character, an `aria-label` on a button
that has no other text, and the glyph as the icon's third argument where it was part of a line of text (the full
list is in section 11, the reason in 9.2). Every script that calls `icon()` starts with the one-line fallback of
section 2.

### 10.1 `index.html` (both apps), must

Head: section 2. Body: the top bar (7.1), the rest dock (7.3, Overload only), the tab bar (7.2). Fuel's page is the
same shell without `#rest-timer`, with `data-app="fuel"` on `<html>`, three tabs and its own mark.

```html
<!-- old -->
<header class="topbar">
  <div class="topbar-inner">
    <div class="brand"><span class="brand-mark"></span>Overload</div>
    <div id="topbar-right" class="topbar-right"></div>
  </div>
</header>
<button class="tab" data-screen="today"><span class="tab-icon">▶</span>Today</button>
<!-- new: the meter first, the mark as SVG, the title in its span -->
<header class="topbar">
  <div id="topbar-meter" class="topbar-meter" hidden><span></span></div>
  <div class="topbar-inner">
    <div class="brand"><span class="brand-mark">SVG MARK</span><span id="topbar-title" class="brand-title">Today</span></div>
    <div id="topbar-right" class="topbar-right"></div>
  </div>
</header>
<button class="tab" data-screen="today"><span class="tab-icon">SVG</span>Today</button>
```

`renderTopbar` (`app.js:771`, and Fuel's in `fuel/fuel.js`): the three strings of 7.1, the title, and the meter.

### 10.2 Today (`renderToday` 779-823, `renderCheckinCard` 853-880, `noticesHtml` 388-397)

Week strip (must, for the date cells):

```js
// old (787)
'<button class="' + cls + '" data-action="select-day" data-i="' + i + '" aria-label="' + WEEKDAYS_LONG[i] + '">' + d[0] + '<span class="dot"></span></button>'
// new: cls also gets 'done' (a finished workout on that date) and 'past' (i < ti)
'<button class="' + cls + '" data-action="select-day" data-i="' + i + '" aria-label="' + WEEKDAYS_LONG[i] + ' ' + dayNum + (done ? ', trained' : dayId ? '' : ', rest day') + '">'
  + '<span class="wd">' + d[0] + '</span><span class="d">' + dayNum + '</span></button>'
```

`dayNum` is the day of the month of `addDays(weekStart(todayKey()), i)`; `done` is
`state.workouts.some((w) => w.finishedAt && w.date === thatKey)`.

The day's card (must):

```js
// old (809-812)
'<div class="card flat"><div class="card-head"><div><h2>' + esc(day.name) + '</h2><div class="meta">' + WEEKDAYS_LONG[ui.selectedDay] + ' · ' + day.exercises.length + ' exercises</div></div>'
+ '<button class="btn small subtle deload-start" data-action="start-deload" data-day="' + day.id + '" …>Start as deload</button></div>'
+ '<button class="btn block" data-action="start-workout" data-day="' + day.id + '" …>Start workout</button>'
+ '<div class="list mt12">' + items + '</div></div>' + otherHtml
// new: "flat" stays (the tests find the card by it), the meta line keeps its text
'<div class="card flat today-card"><div class="card-head"><div><h2>' + esc(day.name) + '</h2><div class="meta">' + WEEKDAYS_LONG[ui.selectedDay] + ' · ' + day.exercises.length + ' exercises</div></div></div>'
+ '<button class="btn block big" data-action="start-workout" data-day="' + day.id + '" …>' + icon('play') + 'Start workout</button>'
+ '<div class="btn-row mt8"><button class="btn small ghost deload-start" data-action="start-deload" data-day="' + day.id + '" …>Start as deload</button>'
+ (others.length && !ui.showOthers ? '<button class="btn small ghost" data-action="toggle-others">Start a different day</button>' : '') + '</div>'
+ '<div class="list mt12">' + items + '</div></div>' + otherHtml
```

`otherHtml` keeps its open form (the group title and the list of other days) and loses its closed form: the
`'<button class="btn subtle block mt8" data-action="toggle-others">Start a different day…</button>'` at 798 is the
button that moved into the card. On a rest day nothing changes (the list is the content).

Exercise rows in the card (806) and every other chevron: `'<span class="chev">›</span>'` becomes
`'<span class="chev">' + icon('chevron-right', 'm') + '</span>'`.

Banners (must):

```js
// old (817, 820)
'<div class="banner">🔥 ' + st.streak + '-day streak. Keep it going.</div>'
'<div class="banner">🔴 Recovery ' + night.recovery + '% (red). Train, but hold the weights and skip extra sets today.</div>'
// new (the streak's glyph is the icon's text alternative: the banner reads as before)
'<div class="banner">' + icon('flame', '', '🔥 ') + '<span>' + st.streak + '-day streak. Keep it going.</span></div>'
'<div class="banner warn">' + icon('warning') + '<span>Recovery ' + night.recovery + '% (red). Train, but hold the weights and skip extra sets today.</span></div>'
```

Recovery pill (`recBand`, 840), must: a red recovery is not the app's accent.
`['accent', 'red']` becomes `['red', 'red']`, so `recPill` writes `.pill.red` (`.pill.green` and `.pill.amber` are unchanged).

Notices (391, 394): add `icon('warning')` before the `<span>`; the dismiss button becomes
`'<button class="icon-btn" data-action="export-nag-off" aria-label="Remind me in two weeks">' + icon('close', 'm') + '</button>'`.

Morning check-in, done (864-866), must. The markup keeps its order (title, pill, Edit: the card's text is a fact
the tests read); the class `checkin-done` lets the stylesheet put the title and Edit on the first line and the pill
on the second, so the title row never wraps:

```js
// old
'<div class="card"><div class="row between"><b>Morning check-in ✓</b><div class="row" style="gap:6px">' + recPill + '<button class="btn small ghost" data-action="checkin-edit">Edit</button></div></div>'
// new
'<div class="card checkin-done"><div class="row between"><b>Morning check-in ' + icon('check', 's', '✓') + '</b><div class="row tight">' + recPill + '<button class="btn small ghost" data-action="checkin-edit">Edit</button></div></div>'
```

The two lines under it are unchanged.

Morning check-in, open (870-875): the inline styles go (section 12): `<div class="row" style="gap:6px">` becomes
`<div class="row tight">`; the hour and minute boxes are `class="input num n2"`; the weight box is
`class="input num"`.

### 10.3 Workout: header, check-in, finish (`renderActiveWorkout` 936-963)

```js
// old (957-958)
'<div class="screen-title"><div><h1>' + esc(w.dayName) + '</h1><span class="sub">' + fmtDate(w.date) + ' · ' + doneCount + '/' + w.entries.length + ' done · <span id="elapsed">' + durationText(w) + '</span></span></div>'
+ '<button class="btn small ghost" data-action="add-entry">+ Exercise</button></div>'
// new (must): the same text; the part that the top bar now shows is hidden from view, and #elapsed stays in it
'<div class="screen-title"><div><h1>' + esc(w.dayName) + '</h1><span class="sub">' + fmtDate(w.date) + '<span class="sr"> · ' + doneCount + '/' + w.entries.length + ' done · <span id="elapsed">' + durationText(w) + '</span></span></span></div>'
+ '<button class="btn small ghost" data-action="add-entry">' + icon('plus') + 'Exercise</button></div>'
```

The top bar gets the count and the time through `renderTopbar` (7.1), with the time in `#tb-elapsed`; the 30 s
refresh updates `#elapsed` and `#tb-elapsed`.

Soreness question (950), must: `'<span style="color:var(--accent-2)">' + esc(m.toLowerCase()) + '</span>'` becomes
`'<b>' + esc(m.toLowerCase()) + '</b>'`.

Finish row (962), must (neutral until every set is ticked, Discard is destructive):

```js
// old
'<div class="btn-row mt12"><button class="btn subtle" data-action="discard-workout">Discard</button><button class="btn success" data-action="finish-workout">Finish workout</button></div>'
// new
'<div class="btn-row mt12"><button class="btn danger" data-action="discard-workout">Discard</button>'
+ '<button class="btn' + (allTicked ? '' : ' ghost') + '" data-action="finish-workout">' + icon('flag') + 'Finish workout</button></div>'
```

`allTicked` = every entry is done or has every set ticked:
`w.entries.every((en) => en.done || (en.sets.length && en.sets.every((s) => s.done)))`.

### 10.4 Exercise card (`renderEntryCard` 1010-1085, `choiceRow` 1091-1094)

Folded row (1019-1021), must:

```js
// old
'<span class="ex-fold-tick">✓</span>' … (prs ? '<span class="pill pr">🏆 PR</span>' : '') + '<span class="chev">›</span>'
// new
'<span class="ex-fold-tick">' + icon('check') + '</span>' … (prs ? '<span class="pill pr">' + icon('trophy') + 'PR</span>' : '') + '<span class="chev">' + icon('chevron-right', 'm') + '</span>'
```

Head (1079-1083), must:

```js
// old
'<div class="row between"><div class="ex-name">' + esc(ex.name) + '</div><span class="row" style="gap:6px">' + prPill + '<span class="pill">' + esc(ex.muscle) + '</span></span></div>'
+ '<div class="ex-presc">' + p.sets + ' sets × ' + r.min + '–' + r.max + (p.weight > 0 ? ' @ <strong>' + fmtW(p.weight) + ' ' + units + '</strong>' : '') + ' · goal <strong>' + en.targetReps + ' reps</strong></div>'
+ '<div class="ex-last">' + esc(lastText) + '</div>' + swapNote
+ (ex.notes ? '<div class="ex-note">' + esc(ex.notes) + '</div>' : '')
+ (en.done && en.prs && en.prs.length ? '<div class="ex-reason green">🏆 ' + esc(prText) + '</div>' : '')
// new
'<div class="row between"><div class="ex-name">' + esc(ex.name) + '</div><span class="row tight">' + prPill + '<span class="pill">' + esc(ex.muscle) + '</span></span></div>'
+ '<div class="ex-target">' + (p.weight > 0 ? '<span class="num">' + fmtW(p.weight) + '</span><span class="u">' + units + '</span><span class="x">×</span>' : '')
  + '<span class="num">' + en.targetReps + '</span>' + (p.weight > 0 ? '' : '<span class="u">reps</span>') + '</div>'
+ '<div class="ex-presc">' + plural(p.sets, 'set') + ' · ' + r.min + '–' + r.max + ' reps' + (ex.equipment === 'Dumbbell' ? ' · each hand' : '') + '</div>'
+ '<div class="ex-last">' + esc(lastText) + '</div>' + swapNote
+ (ex.notes ? '<div class="ex-note">' + icon('note', 's') + '<span>' + esc(ex.notes) + '</span></div>' : '')
+ (en.done && en.prs && en.prs.length ? '<div class="ex-reason pr">' + icon('trophy', 's', '🏆 ') + esc(prText) + '</div>' : '')
```

`prPill` (1050) is `'<span class="pill pr">' + icon('trophy') + 'PR</span>'`. The reason box (1025) is unchanged
(`'ex-reason ' + (/\+/.test(reason) ? 'green' : '')`); add `warn` when the reason is a joint-pain one if that is
easy to tell (should).

Set row (1038-1043), must:

```js
// old
'<tr class="set-row ' + (s.done ? 'done' : '') + '">' … 
+ '<td><input class="set-input" type="number" inputmode="numeric" min="0" value="' + (s.reps || '') + '" placeholder="' + (en.targetReps || 'reps') + '" data-field="reps" … ></td>'
+ '<td class="chk"><button class="check ' + (s.done ? 'on' : '') + '" data-action="toggle-set" data-e="' + idx + '" data-s="' + i + '" …>✓</button></td>'
// new
'<tr class="set-row ' + (s.done ? 'done' : isNext ? 'next' : '') + '">' … 
+ '<td><input class="set-input" … data-field="reps" … aria-label="Set ' + (i + 1) + ' reps"><span class="set-hint">Goal</span></td>'
+ '<td class="chk"><button class="check ' + (s.done ? 'on' : '') + '" data-action="toggle-set" data-e="' + idx + '" data-s="' + i + '" aria-label="Set ' + (i + 1) + ' done" aria-pressed="' + !!s.done + '" …>' + icon('check') + '</button></td>'
```

`isNext` marks one row in the whole workout, the one `scrollToNext` goes to: the first unticked set of the first
entry that is not done (`idx === w.entries.findIndex((e) => !e.done && exById(e.exId))` and
`i === en.sets.findIndex((x) => !x.done)`). Add `aria-label="Set N weight"` to the weight box too (should).
The app redraws on every tick, so the class moves by itself.

**Write the hint only when there is a goal:** `(en.targetReps > 0 ? '<span class="set-hint">Goal</span>' : '')`.
With no goal the placeholder is the word "reps" (1040: `placeholder="' + (en.targetReps || 'reps') + '"`) and must
not get GOAL under it. The weight box keeps its unit placeholder and needs nothing: the stylesheet ties the hint
to `data-field="reps"`.

Next time (`nextBox`, 1064-1067), must: the number leads, as in the head.

```js
// old (1064)
nextBox = '<div class="next-box"><div class="headline">Next time: ' + en.next.sets + ' × ' + r.min + '–' + r.max + ' @ ' + fmtW(en.next.weight) + ' ' + state.settings.units + ', goal ' + en.next.targetReps + '</div>'
  + '<ul>' + en.next.reasons.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
// new
nextBox = '<div class="next-box"><div class="label">Next time</div>'
  + '<div class="ex-target">' + (en.next.weight > 0 ? '<span class="num">' + fmtW(en.next.weight) + '</span><span class="u">' + state.settings.units + '</span><span class="x">×</span>' : '')
  + '<span class="num">' + en.next.targetReps + '</span>' + (en.next.weight > 0 ? '' : '<span class="u">reps</span>') + '</div>'
  + '<div class="ex-presc">' + plural(en.next.sets, 'set') + ' · ' + r.min + '–' + r.max + ' reps' + (ex.equipment === 'Dumbbell' ? ' · each hand' : '') + '</div>'
  + '<ul>' + en.next.reasons.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
```

The deload form (1067, `<div class="headline">Deload: plan kept</div>` and its one bullet) is unchanged.

Warm-ups (1047-1048), must:

```js
// old
'<span class="tiny muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.05em">Warm-up</span><button class="btn small subtle" data-action="clear-warmup" data-e="' + idx + '">✕</button>'
… '<button class="check small ' + (wu.done ? 'on' : '') + '" data-action="toggle-warmup" …>✓</button>'
// new
'<span class="label">Warm-up</span><button class="btn small subtle" data-action="clear-warmup" data-e="' + idx + '" aria-label="Clear warm-ups">' + icon('close', 'm') + '</button>'
… '<button class="check small ' + (wu.done ? 'on' : '') + '" data-action="toggle-warmup" … aria-label="Warm-up ' + (i + 1) + ' done" aria-pressed="' + !!wu.done + '">' + icon('check') + '</button>'
```

Feedback label (`choiceRow` 1092), must:
`'<div class="tiny muted mt8 mb8" style="font-weight:700;text-transform:uppercase;letter-spacing:.05em">' + label + '</div>'`
becomes `'<div class="label">' + label + '</div>'`. Add `aria-pressed` to the `.choice` buttons (should).

Set tools (1073-1074), should: `+ Set` and `− Set` become `icon('plus') + 'Set'` and `icon('minus') + 'Set'`;
`Swap exercise` gets `icon('swap')` first. Classes unchanged. Finish exercise (1076) is unchanged: it already goes
from `ghost` to primary when every set is ticked.

### 10.5 Cardio card (`renderCardioCard` 992-1008), must

Done is something to do, Logged is a recorded state. In v2.8 both were `.btn.success`, so the unrecorded state was
the loud one and the recorded one was faded.

```js
// old (1005-1006)
? '<div class="btn-row"><button class="btn subtle" data-action="cardio-undo">Undo</button><button class="btn success" disabled>Logged ✓</button></div>'
: '<div class="btn-row"><button class="btn ghost" data-action="cardio-timer">…</button><button class="btn success" data-action="cardio-done">Done ✓</button></div>'
// new: Done is an outlined key; Logged stays .btn.success (solid ink, drawn at full strength although disabled)
? '<div class="btn-row"><button class="btn subtle" data-action="cardio-undo">Undo</button><button class="btn success" disabled>' + icon('check') + 'Logged</button></div>'
: '<div class="btn-row"><button class="btn ghost" data-action="cardio-timer">…</button><button class="btn ghost" data-action="cardio-done">' + icon('check') + 'Done</button></div>'
```

### 10.6 History (`renderHistory` 1260-1281 and the cards)

- Stat tile (1265), must: `(st.streak ? '🔥 ' + st.streak : '0')` becomes `(st.streak ? icon('flame', 'm', '🔥 ') + st.streak : '0')`.
  The strip itself needs no class: as the first thing on the screen it is drawn at 34 px.
- Workout rows (1276), must. Each fact becomes one piece that does not break inside, so the line wraps between
  facts and never leaves "min" or "· 1" alone on a line; the glyphs stay as the icons' text alternatives and the
  separators stay `' · '`, so the row reads exactly as before:

```js
// old: the .sub of a row
fmtDate(w.date) + ' · ' + plural(n, 'exercise') + ' · ' + plural(sets, 'set') + (durationText(w) ? ' · ' + durationText(w) : '')
  + (w.cardio && w.cardio.done ? ' · 🚶 ' + w.cardio.min + ' min' : '') + (ups ? ' · <span style="color:var(--green)">' + ups + ' weight ↑</span>' : '') + (prs ? ' · 🏆 ' + prs : '')
// new
const facts = [fmtDate(w.date), plural(n, 'exercise'), plural(sets, 'set')].concat(durationText(w) ? [durationText(w)] : [])
  .concat(w.cardio && w.cardio.done ? [icon('heart', 's', '🚶') + ' ' + w.cardio.min + ' min'] : [])
  .concat(ups ? ['<span class="ok-ink">' + ups + ' weight ' + icon('arrow-up', 's', '↑') + '</span>'] : [])
  .concat(prs ? [icon('trophy', 's', '🏆') + ' ' + prs] : []);
facts.map((x, i) => '<span class="nowrap">' + x + (i < facts.length - 1 ? ' ·' : '') + '</span>').join(' ')
// and the row's chevron keeps its glyph as text too (this row's whole text is a recorded fact):
'<span class="chev">' + icon('chevron-right', 'm', '›') + '</span>'
```

  (`n` stands for `w.entries.filter((e) => e.done).length`.)
- Weekly review (1377), must: `'<li><b>🏆 PRs:</b> '` becomes `'<li><b>' + icon('trophy', 's', '🏆 ') + 'PRs:</b> '`.
  Share (1379), should: `icon('share') + 'Share'`.
- Calendar (`renderCalendar` 1316-1337), must:

```js
// old (1330-1336)
const cls = ['cal-cell', ws.length ? 'hit' : '', key === today ? 'today' : '', key > today ? 'future' : '', rest && !ws.length ? 'rest' : ''].join(' ');
… '<div class="card"><div class="row between mb8"><button class="icon-btn" data-action="cal-prev">‹</button><b>…</b><button class="icon-btn" data-action="cal-next" …>›</button></div>'
+ '<div class="cal-grid">…</div>'
+ '<div class="tiny muted mt8">' + plural(count, 'training day') + ' this month. Faded days are rest days in your schedule.</div></div>'
// new
const cls = ['cal-cell', ws.length ? 'hit' : '', ws.length && ws.every((w) => w.deload) ? 'deload' : '', ws.some((w) => w.entries.some((e) => e.prs && e.prs.length)) ? 'pr' : '',
  key === today ? 'today' : '', key > today ? 'future' : '', rest && !ws.length ? 'rest' : '', !rest && !ws.length && key >= today ? 'plan' : ''].join(' ');
… '<div class="card cal-card"><div class="row between mb8"><button class="icon-btn" data-action="cal-prev" aria-label="Previous month">' + icon('chevron-left') + '</button><b>…</b>'
+ '<button class="icon-btn" data-action="cal-next" aria-label="Next month" …>' + icon('chevron-right') + '</button></div>'
+ '<div class="cal-grid">…</div>'
+ '<div class="cal-legend"><span><i class="cal-key hit"></i>Trained</span><span><i class="cal-key deload"></i>Deload</span><span><i class="cal-key plan"></i>Planned</span><span><i class="cal-key pr"></i>PR that day</span></div>'
+ '<div class="tiny muted mt8">' + plural(count, 'training day') + ' this month.</div></div>'
```

  Give a workout cell an `aria-label` (month, day, "workout", "PR", "deload"): the fill no longer says it in words.
- Progress (`renderChart` 1437-1472): geometry in 13.1; `'<div class="group-title" style="margin-top:14px">'` loses
  its style; `(s.pr ? ' 🏆' : '')` becomes `(s.pr ? ' ' + icon('trophy', 's', '🏆') : '')`; `'🏆 Heaviest: '` becomes
  `icon('trophy', 's', '🏆 ') + 'Heaviest: '`. Add the legend line (13.1).
- Body weight (13.2) and Sleep (13.3): geometry; the sleep legend row
  `'<div class="row tiny muted" style="gap:12px">…'` becomes `'<div class="legend">…'` (same three spans).

### 10.7 Program and Exercises (`renderProgram` 1097-1117, `renderExercises` 1242-1257)

- `+ Day` (1112) and `+ New` (1254), should: `icon('plus') + 'Day'`, `icon('plus') + 'New'`.
- A sub line beside the lone button (should), so the row is not a button with a blank to its left, as Today and
  the workout already have:
  `'<div class="screen-title"><h1>Program</h1><span class="sub">' + plural(state.program.days.length, 'day') + ' · ' + state.program.schedule.filter(Boolean).length + ' a week</span><button …>'` and
  `'<div class="screen-title"><h1>Exercises</h1><span class="sub">' + plural(state.exercises.length, 'exercise') + '</span><button …>'`.
- Schedule select (1106), must: drop `style="width:auto;min-width:170px"` (the row sizes it).
- Template delete (1110), must: `'<button class="icon-btn danger" data-action="delete-template" data-t="…">✕</button>'`
  becomes `'… aria-label="Delete template">' + icon('trash') + '</button>'`.
- Exercises search (1255) and the picker's (1606), should:
  `'<div class="search">' + icon('search') + '<input class="input" type="search" placeholder="Search" … data-field="search" aria-label="Search exercises"></div>'`.
  The handlers find the box by `data-field`, so the wrapper does not affect them.

### 10.8 Settings (`renderSettings` 1475-1505, `renderBackupCard` 420-430, `renderCloudCard` 1507-1527, `connector.js` 302-344)

- Number boxes (1480-1497), must: `class="input" style="width:90px;text-align:center"` becomes `class="input num"`;
  the 64 px ones become `class="input num n2"`; their `<div class="row">` becomes `<div class="row tight">`.
- Weigh-in select (1491) and the cardio name box (1496), must: drop the inline styles. Without its
  `style="max-width:200px"` the cardio name box takes a full row under "What" (with it, it is a 200 px box at the
  right, which still shows the whole default name).
- Version line (1504), should: `'<p class="version">Overload · v' + VERSION + '</p>'`.
- Reset (1503), should: `icon('trash') + 'Reset all data'`.
- Backup card: `'<div class="mt12">Automatic copies</div>'` (428) becomes `'<div class="mt12"><b>Automatic copies</b></div>'`
  (should); Export / Import (423) may take `icon('export')` / `icon('import')`.
- Cloud card, must: `'<div id="cloud-msg" class="small mb8" style="color:var(--accent-2)"></div>'` loses its style
  (the id is styled); the status pill `'<span class="pill" id="cloud-status" style="color:' + colour + '">'` becomes
  `'<span class="pill ' + st.status + '" id="cloud-status">'`, and `setSyncStatus` (2435) sets
  `el.className = 'pill ' + status` instead of `el.style.color`. `cloudColour` goes.
  The status is not always short (3.0): sync.js can show a sentence ("Could not reach the cloud. Nothing was
  uploaded; retrying.") or a raw Firebase error. `#cloud-status` may then wrap to several lines, and it drops under
  "Signed in" as a full-width block (the `.toggle-row` wraps); a short one stays a one-line pill beside it, at the
  card's right edge. It is never cut and never runs off the card (both apps; the look tests try every message).
- WHOOP card (`connector.js:311`), must: drop `style="flex:1;min-width:0"` on `#conn-code` (`.row > .input` does it).
- Reminders rows (`connector.js:338-340`), must:
  `'<div class="toggle-row" style="flex-direction:column;align-items:stretch;gap:8px">'` becomes `'<div class="toggle-row stack">'`;
  `'<div class="row between" style="gap:8px">'` becomes `'<div class="row between tight">'`; the time box loses `style="max-width:150px"`.
- The On / Off `.seg` controls need no change: the stylesheet tells an On / Off pair by its `data-v="1"` then
  `data-v="0"` and draws a picked Off as a neutral key (8.1). They may become `.switch` buttons later:
  `data-action` and `data-v` would move to one button, so it is a small handler change too.
- Appearance (1479) needs no change either: its three-way `.seg` fills the row under the label when it does not
  fit beside it.

### 10.9 Training sheets

- `sheetHeader` (1558): 7.4.
- Edit exercise (`sheetExercise` 1560-1577): drop `style="margin-top:6px"` on both group titles and the inline style on
  the `(blank = use settings)` span (keep `class="muted"`), must. Delete exercise becomes
  `class="btn danger block mt8"` with `icon('trash')` (should). Save may go in `.sheet-foot` (should).
- Edit day (`sheetDay` 1579-1591), must: `↑` `↓` `✕` become `icon('arrow-up')`, `icon('arrow-down')`, `icon('close')` with
  `aria-label="Move up"`, `"Move down"`, `"Remove from this day"`. Delete day becomes `btn danger` (should).
- Picker (1604), must: `'<span class="chev">+</span>'` becomes `'<span class="chev">' + icon('plus', 'm') + '</span>'`.
- Program sheet (1128-1137), must: `'<div class="row mb8" style="flex-wrap:wrap;gap:6px">'` becomes `'<div class="row wrap mb8">'`,
  and the week's pills (1129) lose the accent: `'<span class="pill' + (p.schedule[i] == null ? '' : ' accent') + '">'`
  becomes `'<span class="pill' + (p.schedule[i] == null ? '' : ' solid') + '">'`. A day that has a workout is
  chosen, not live; seven accent pills on one sheet broke rule 6. Reference: `train-sheets-program.html`.
- Edit exercise (1560-1577): the number boxes need no class (every `.input[type=number]` is 17 / 700).
- Workout detail (`sheetWorkout` 1610-1625), must:
  `'<div class="tiny mt8" style="color:var(--green)">🏆 ' + text + '</div>'` becomes
  `'<div class="pr-line">' + icon('trophy', 's') + '<span>' + text + '</span></div>'`;
  `'<div class="tiny mt8" style="color:var(--amber)">' + reason + '</div>'` becomes `'<div class="tiny muted mt8">' + reason + '</div>'`.
  Delete workout becomes `btn danger` (should).
- Edit sets (`sheetEditWorkout` 1632-1634), must: the label span becomes `'<span class="set-lbl">Set ' + (si + 1) + '</span>'`;
  both boxes become `class="input num fill"` (drop `style="text-align:center"`).
- Weigh-ins and Sleep (1692, 1407), must: the `✕` buttons become `icon('trash')` with `aria-label="Delete this weigh-in"` /
  `"Delete this night"`.

### 10.10 Unreadable data, the error card

Unchanged markup; `Export` buttons may take `icon('export')`, `Start fresh` `icon('trash')`. "Export the unreadable
copy" and "Try again" stay one `.btn-row`: at 390 px the two labels do not fit side by side on one line each, so
the row breaks and each button takes a full line (the wording is checked by the tests and stays). Reference:
`states-unreadable.html`, `states.html`.

### 10.11 The hand-over card (`handoverHtml`, `fuelButtons` in `app.js`; SPEC 3.3)

The card is built and tested (`tests/train-handover.js`); its wrapper `#handover[data-where]`, its states, its
wordings and its actions (`handover-copy`, `handover-file`, `handover-link`, `handover-hide`, `handover-remove`,
and Get Fuel as an `<a class="btn">`) all stay. The changes are classes, icons and the step list. No action is
added and nothing moves: the first version of this guide put a one-line notice with a new `handover-open` action
on Today; that is withdrawn.

`fuelButtons`, must. No accent button, no inline styles; the address hint is fine print (`more`):

```js
// old
const get = navigator.standalone === true
  ? '<a class="btn" style="text-decoration:none" href="' + esc('x-safari-https://' + location.host + u.pathname) + '">Get ' + FUEL + '</a>'
  : '<a class="btn" style="text-decoration:none" href="' + esc(u.href) + '" target="_blank" rel="noopener">Get ' + FUEL + '</a>';
return '<div class="btn-row mt8">' + get + '<button class="btn ghost" data-action="handover-link">Copy link</button></div>'
  + '<p class="tiny muted mt8" style="overflow-wrap:anywhere">In Safari tap Share, then Add to Home Screen. If Safari does not open, … ' + esc(u.host + u.pathname) + '</p>';
// new
const get = navigator.standalone === true
  ? '<a class="btn ghost" href="' + esc('x-safari-https://' + location.host + u.pathname) + '">Get ' + FUEL + icon('external') + '</a>'
  : '<a class="btn ghost" href="' + esc(u.href) + '" target="_blank" rel="noopener">Get ' + FUEL + icon('external') + '</a>';
return '<div class="btn-row mt8">' + get + '<button class="btn ghost" data-action="handover-link">' + icon('link') + 'Copy link</button></div>'
  + '<p class="tiny muted mt8 break more">In Safari tap Share, then Add to Home Screen. If Safari does not open, … ' + esc(u.host + u.pathname) + '</p>';
```

(The link's text stays exactly `Get Fuel`: the icon adds none. The sentence keeps its words; no icon goes inside it.)

`handoverHtml`, must. By state:

**Nothing to hand over, or the old log was removed** (Settings only):

```js
// old
return title + '<div class="card"><p class="small muted">Food is logged in a separate app, ' + FUEL + '.' + (h.removed ? ' The old food log was removed … .' : '') + '</p>' + fuelButtons() + '</div>';
// new
const tile = '<span class="app-tile l" data-app="fuel">' + icon('mark-fuel') + '</span>';
return title + '<div class="card handover"><div class="handover-head">' + tile + '<p class="small muted">Food is logged in a separate app, ' + FUEL + '.' + (h.removed ? ' The old food log was removed … .' : '') + '</p></div>' + fuelButtons() + '</div>';
```

**The log is here** (not copied yet; copied or saved, and current; or out of date). One return, as today:

```js
// old
return title + '<div class="card">'
  + '<div class="row between"><b>Food has moved to ' + FUEL + '</b>' + (today ? '<button class="icon-btn" data-action="handover-hide" aria-label="Hide this card">✕</button>' : '') + '</div>'
  + '<p class="small muted mt8">The food log is now its own app, … ' + holds + '. Nothing is taken away until you remove it yourself.</p>'
  + (h.stale ? '<div class="notice mt8"><span>The food log here changed after you … gets the rest.</span></div>' : '')
  + '<div class="mt12"><b>1. Get ' + FUEL + '</b></div>' + fuelButtons()
  + '<div class="mt12"><b>2. Take your food log along</b></div>'
  + '<button class="btn block mt8" data-action="handover-copy">Copy my food log</button><button class="btn ghost block mt8" data-action="handover-file">Save as a file</button>'
  + '<p class="small muted mt8">' + status + '</p>'
  + '<div class="mt12"><b>3. In ' + FUEL + ', tap Paste from Overload</b></div><p class="small muted">If you saved a file, tap Choose a file there instead.</p>'
  + cloud + remove
  + (today ? '<p class="tiny muted mt12">This card is also in Settings, under Food.</p>' : '') + '</div>';
// new
return title + '<div class="card handover">'
  + '<div class="handover-head">' + tile + '<b>Food has moved to ' + FUEL + '</b>' + (today ? '<button class="icon-btn" data-action="handover-hide" aria-label="Hide this card">' + icon('close') + '</button>' : '') + '</div>'
  + '<p class="small muted mt8">The food log is now its own app, … ' + holds + '. Nothing is taken away until you remove it yourself.</p>'
  + (h.stale ? '<div class="banner warn mt8">' + icon('warning') + '<span>The food log here changed after you … gets the rest.</span></div>' : '')
  + '<ol class="steps">'
  + '<li><b>Get ' + FUEL + '</b>' + fuelButtons() + '</li>'
  + '<li' + (h.current ? ' class="done"' : '') + '><b>Take your food log along</b>'
  +   '<div class="btn-row mt8"><button class="btn ghost" data-action="handover-copy">' + icon('copy') + 'Copy my food log</button><button class="btn ghost" data-action="handover-file">' + icon('export') + 'Save as a file</button></div>'
  +   '<p class="small muted mt8">' + status + '</p></li>'
  + '<li><b>In ' + FUEL + ', tap Paste from Overload</b><p class="small muted more">If you saved a file, tap Choose a file there instead.</p></li>'
  + '</ol>'
  + cloud + remove
  + (today ? '<p class="tiny muted mt12">This card is also in Settings, under Food.</p>' : '') + '</div>';
```

- The numbers "1.", "2.", "3." leave the text: `ol.steps` draws them. Step 2 is `done` (a solid number) when the
  last copy or file holds what is here now (`h.current`).
- `status`, `holds`, `cloud` and the stale sentence are unchanged. The stale message becomes a `.banner.warn`
  (it has nothing to tap, so it is not a `.notice`).
- `remove`, must:

```js
// old
'<div class="mt16"><b>When ' + FUEL + ' shows your food log</b></div><p class="small muted">You can remove … stay.</p>'
+ '<button class="btn danger block mt8" data-action="handover-remove">Remove the old food log from Overload</button>'
// new
'<div class="handover-remove"><b>When ' + FUEL + ' shows your food log</b><p class="small muted">You can remove … stay.</p>'
+ '<button class="btn danger block mt8" data-action="handover-remove">' + icon('trash') + 'Remove the old food log from Overload</button></div>'
```

What it looks like, with no further markup:

| Where and state | Drawn |
| --- | --- |
| Settings, not copied yet | the tile and title, the sentence, three numbered steps: `Get Fuel ↗` and `Copy link` side by side with the address hint under them; `Copy my food log` and `Save as a file` side by side at 390 px (the first a little wider) and one above the other at 320, "Not copied yet."; step 3 with its hint; the cloud line when sync is on |
| Settings, copied and current | the same with step 2 solid, "Copied today · Saved as a file today.", and under a hairline the remove block with its danger button (one line at 390 px, two centred lines at 320) |
| Settings or Today, out of date | the amber banner above the steps; step 2 not done; no remove block |
| Settings, nothing to hand over or removed | the tile, the one sentence, `Get Fuel ↗` and `Copy link`, the address hint |
| Today (`#handover[data-where="today"]`), not copied or out of date | the same markup drawn short by the stylesheet: tile, title and the hide button; the sentence; `Get Fuel ↗` / `Copy link` and `Copy my food log` / `Save as a file` as two rows of 44 px keys; the status line; "This card is also in Settings, under Food." The step numbers, the step headings and the two `.more` hints are not shown. 306 px tall at 390 px wide |

Reference: `train-today-handover.html` (Today, first start), `train-settings.html` (copied, with the remove block
and the cloud line), `components.html` (all five).

### 10.12 Fuel: the diary and its sheets (`fuel/food.js`)

Line numbers here are v2.8's `food.js`; in `fuel/food.js` they are one or two lines further on.

Day switcher (338-340), must: `‹` and `›` become `icon('chevron-left')` and `icon('chevron-right')` (the `aria-label`s exist).

Summary (342-351), must. `bar()` and `macroCell()` stay. **The whole `let head; if (t.kcal > 0) { … } else { … }`
block is replaced by the lines below** (both branches: `left` is declared inside the `if` today, so the new code
declares its own):

```js
// old (both branches)
let head;
if (t.kcal > 0) {
  const left = t.kcal - tot.kcal;
  head = '<div class="f-kcal"><div><span class="f-big">' + fmtK(tot.kcal) + '</span><span class="muted"> / ' + fmtK(t.kcal) + ' kcal</span></div>'
    + '<div class="f-left ' + (left < 0 ? 'over' : '') + '">' + (left >= 0 ? fmtK(left) + ' left' : fmtK(-left) + ' over') + '</div></div>' + bar(tot.kcal, t.kcal);
} else {
  head = '<div class="f-kcal"><div><span class="f-big">' + fmtK(tot.kcal) + '</span><span class="muted"> kcal</span></div>'
    + '<button class="btn small ghost" data-action="food-targets">Set target</button></div>';
}
// new
const has = t.kcal > 0, left = t.kcal - tot.kcal, over = has && left < 0;
const far = has && tot.kcal > t.kcal * 1.05;                      // the 5% rule of bar(): the one that colours
const p = has ? Math.min(100, tot.kcal / t.kcal * 100) : 0;       // eaten / target in percent, 0 to 100
const ARC = 'M14 128a118 118 0 0 1 236 0';
// 1. v2.8's read-out, word for word, hidden from view: assistive tech and the tests read it; .f-big is still calories eaten
let head = has
  ? '<div class="f-kcal sr"><div><span class="f-big">' + fmtK(tot.kcal) + '</span><span class="muted"> / ' + fmtK(t.kcal) + ' kcal</span></div>'
    + '<div class="f-left ' + (left < 0 ? 'over' : '') + '">' + (left >= 0 ? fmtK(left) + ' left' : fmtK(-left) + ' over') + '</div></div>'
  : '<div class="f-kcal sr"><div><span class="f-big">' + fmtK(tot.kcal) + '</span><span class="muted"> kcal</span></div></div>';
// 2. the gauge (a drawing: hidden from assistive tech, the block above says it)
head += '<div class="gauge' + (!has ? ' none' : far ? ' over' : '') + '">'
  + '<svg viewBox="0 0 264 132" aria-hidden="true" focusable="false">'
  + '<defs><mask id="gauge-ticks" maskUnits="userSpaceOnUse" x="0" y="0" width="264" height="140"><path d="' + ARC + '" fill="none" stroke="#fff" stroke-width="24" pathLength="244" stroke-dasharray="1.6 2.4"/></mask></defs>'
  + '<g mask="url(#gauge-ticks)"><path class="gauge-track" d="' + ARC + '"/><path class="gauge-fill" d="' + ARC + '" pathLength="100" stroke-dasharray="' + p.toFixed(1) + ' 100"/></g>'
  + '<path class="gauge-mark" d="' + ARC + '" pathLength="100" stroke-dasharray="0.7 100" stroke-dashoffset="' + (-Math.max(0, Math.min(99.3, p - 0.35))).toFixed(1) + '"/></svg>'
  + '<div class="gauge-read" aria-hidden="true"><div class="label">' + (!has ? 'kcal eaten' : over ? (far ? icon('warning', 's') : '') + 'kcal over' : 'kcal left') + '</div>'
  + '<div class="gauge-num">' + fmtK(!has ? tot.kcal : Math.abs(left)) + '</div></div></div>'
  + '<div class="gauge-foot">' + (has
    ? '<span aria-hidden="true"><b>' + fmtK(tot.kcal) + '</b> eaten</span><button class="gauge-target" data-action="food-targets" aria-label="Target ' + fmtK(t.kcal) + ' kcal. Change targets">of <b>' + fmtK(t.kcal) + '</b>' + icon('chevron-right', 's') + '</button>'
    : '<span>No calorie target</span><button class="gauge-target" data-action="food-targets">Set target' + icon('chevron-right', 's') + '</button>') + '</div>';
```

The line after it (`const summary = '<div class="card f-sum">' + head + '<div class="f-macros">' + …`) is unchanged.

- The whole of the script's work is the one number `p`: it goes into `stroke-dasharray` of the fill and (negated)
  into `stroke-dashoffset` of the marker. No trigonometry.
- The big number (`.gauge-num`, a new class) is what is **left**; eaten and target are on the foot line; the target
  is a button that opens the existing targets sheet (`food-targets`), with or without a target. The old calorie
  bar (`bar(tot.kcal, t.kcal)`) and the old Set target button are replaced by the gauge and its foot.
- **One threshold for the colour.** From 1 kcal over, the words say "kcal over" and the number is the overshoot;
  the dial is simply full. The danger colour and the warning icon come only with `far` (more than 5% over), the
  rule `bar()` uses for the macro bars and `trendChart` for the Trends bars, so the three never disagree.
- `macroCell` (330): add `over` to the cell class when the macro is over
  (`'<div class="f-macro' + (target > 0 && v > target * 1.05 ? ' over' : '') + '">'`, the same test as in `bar()`), should.

Meals (358-360), must: `⋯` becomes `icon('more')`; `'+ Add food'` becomes `icon('plus') + 'Add food'`.

Quick rows (`quickRow` 510-517), must (calories as a number column):

```js
// old
const sub = [f.brand && esc(f.brand), esc(amount) + ' · ' + fmtK(n.kcal) + ' kcal'].filter(Boolean).join(' · ');
return '<div class="f-row f-qrow"><button class="f-qpick" …><div class="grow"><div class="title">' + (f.fav ? '<span class="f-favmark">★</span> ' : '') + esc(f.name) + '</div><div class="sub">' + sub + '</div></div></button>'
  + '<button class="icon-btn f-plus" data-action="food-plus" data-id="…" aria-label="…"' + (done ? ' disabled' : '') + '>' + (done ? '✓' : '+') + '</button></div>';
// new
const sub = [esc(amount), f.brand && esc(f.brand)].filter(Boolean).join(' · ');
return '<div class="f-row f-qrow"><button class="f-qpick" …><div class="grow"><div class="title">' + (f.fav ? '<span class="f-favmark">' + icon('star-filled') + '</span> ' : '') + esc(f.name) + '</div><div class="sub">' + sub + '</div></div></button>'
  + '<div class="f-rk">' + fmtK(n.kcal) + '</div>'
  + '<button class="icon-btn f-plus" data-action="food-plus" data-id="…" aria-label="…"' + (done ? ' disabled' : '') + '>' + icon(done ? 'check' : 'plus') + '</button></div>';
```

The handler that flips the key after a tap (`food.js:1033`, `textContent = '✓'`) must set
`innerHTML = icon('check')`. Result rows and saved-meal rows (507, 534): `★` and `›` as above.

Add sheet (493-494), must for the button, should for the wrapper:

```js
'<div class="f-searchrow"><div class="search">' + icon('search') + '<input class="input" type="search" data-field="food-search" … aria-label="Search foods"></div>'
+ '<button class="icon-btn f-scanbtn" data-action="food-scan" aria-label="Scan a barcode">' + icon('barcode') + '</button></div>'
```

The help text at 548 says "Tap ☆ on a food": write "Tap the star on a food".

Amount sheet (`sheetAmount` 589-611), must: `'‹ Back'` becomes `icon('chevron-left') + 'Back'` (also 751, 891); the star
button (599) holds `icon('star-filled')` or `icon('star')`, and `food.js:707` sets `innerHTML`, not `textContent`.
The header stays `sheetHeader('Add food' …)` directly before `.f-food-name`: that order is what lets the
stylesheet draw the food's name as the title.
Preview (`renderPreview` 619), should (the unit beside the number, so the key fits its cell):
`cell(fmtG(n.p), 'Protein g')` becomes `cell(fmtG(n.p) + '<span class="u">g</span>', 'Protein')`, the same for carbs
and fat, and in the saved-meal sheet (748). The save button may go in `.sheet-foot` (should).

Saved meal (750): `✕` becomes `icon('close')`. Scanner (894): `Scan a photo` may take `icon('camera')`.
Targets (`targetRows` 985), must: `class="input" style="width:100px;text-align:center"` becomes `class="input num"`.

### 10.13 Fuel: the new screens and sheets (`fuel/fuel.js`, by function name)

All of these already draw correctly with the new stylesheets and no change (the audit was run on them). The
changes below add the icons, the tile and a few classes. Action names and wordings are the code's own.

**`renderTopbar`**, must: the title, and the two pills as in 7.1 (`setSyncStatus` then sets `innerHTML`).
`fuel/index.html`: the shell of 10.1 with three tabs (7.2), no `#rest-timer`, `data-app="fuel"` on `<html>`.

**Where these screens sit.** `render()` keeps `document.body.classList.toggle('no-tabs', …)`: on Welcome and
Add to Home Screen there is no tab bar (`body.no-tabs .tabbar` is in the new `fuel.css`), the top bar stays and
says Fuel, and the content is `'<div class="onboard">…</div>'` inside `main.screen`, as today. The screen's `h1`
is the headline there and shows.

**`renderGate`: Add to Home Screen**, should (it draws correctly unchanged):

```js
// old
const INSTALL_STEPS = '<li>Tap <b>Share</b> in Safari\'s toolbar.</li><li>Choose <b>Add to Home Screen</b>.</li><li>Open <b>' + APP_NAME + '</b> from its new icon.</li>';
$('#app').innerHTML = '<div class="onboard"><div class="screen-title"><h1>Add ' + APP_NAME + ' to your Home Screen</h1></div>'
  + (ui.gate === 'inside'
    ? '<p class="muted">This page opened inside Overload. …</p>'
      + '<ol class="install-steps"><li>Tap <b>Open in Safari</b> below.</li>' + INSTALL_STEPS + '</ol>'
      + '<a class="btn block" data-action="fuel-open-safari" href="' + esc('x-safari-' + url) + '">Open in Safari</a>'
      + '<button class="btn ghost block mt8" data-action="fuel-copy-link">Copy link</button>'
      + '<p class="small muted center mt8">If the button does nothing: …</p><p class="small muted center mt8 link-text">' + esc(url) + '</p>'
    : '<p class="muted">' + APP_NAME + ' works best as its own app: …</p>'
      + '<ol class="install-steps">' + INSTALL_STEPS + '</ol>'
      + '<div class="banner">On an iPhone, a Safari tab can lose its data … does not.</div>'
      + '<div class="center mt16"><button class="btn subtle" data-action="fuel-use-here">Use it here anyway</button></div>')
  + '</div>';
// new: the icon follows the bold word with no space of its own, so each sentence reads as before
const INSTALL_STEPS = '<li>Tap <b>Share</b>' + icon('share') + ' in Safari\'s toolbar.</li><li>Choose <b>Add to Home Screen</b>' + icon('add-square') + '.</li><li>Open <b>' + APP_NAME + '</b> from its new icon.</li>';
const BRAND = '<div class="onboard-brand"><span class="app-tile xl">' + icon('mark-fuel') + '</span></div>';   // the Home Screen icon, 72 px
$('#app').innerHTML = '<div class="onboard">' + BRAND + '<div class="screen-title"><h1>Add ' + APP_NAME + ' to your Home Screen</h1></div>'
  + (ui.gate === 'inside'
    ? '<p class="lede">This page opened inside Overload. …</p>'
      + '<ol class="install-steps"><li>Tap <b>Open in Safari</b> below.</li>' + INSTALL_STEPS + '</ol>'
      + '<a class="btn block big" data-action="fuel-open-safari" href="' + esc('x-safari-' + url) + '">Open in Safari' + icon('external') + '</a>'
      + '<button class="btn ghost block mt8" data-action="fuel-copy-link">' + icon('link') + 'Copy link</button>'
      + '<p class="small muted center mt8">If the button does nothing: …</p><p class="small muted center mt8 link-text">' + esc(url) + '</p>'
    : '<p class="lede">' + APP_NAME + ' works best as its own app: …</p>'
      + '<ol class="install-steps">' + INSTALL_STEPS + '</ol>'
      + '<div class="banner">' + icon('info') + '<span>On an iPhone, a Safari tab can lose its data … does not.</span></div>'
      + '<div class="foot"><button class="btn text" data-action="fuel-use-here">Use it here anyway</button></div>')
  + '</div>';
```

**Open in Safari stays an `<a class="btn" href="x-safari-…">`** (and Get Fuel in Overload's card stays an `<a>`): a
`<button data-action>` cannot hand over to Safari. The first version's reference pages drew them as buttons; they
are anchors now.

**`choiceRow` and `renderWelcome`**, should:

```js
// old
function choiceRow(action, title, sub, first) {
  return '<button class="list-item choice-card' + (first ? ' first' : '') + '" data-action="' + action + '"><div class="grow"><div class="title">' + title + '</div><div class="sub">' + sub + '</div></div><span class="chev">›</span></button>';
}
// new: an optional mark in front, the chevron as an icon
function choiceRow(action, title, sub, first, lead) {
  return '<button class="list-item choice-card' + (first ? ' first' : '') + '" data-action="' + action + '">' + (lead || '') + '<div class="grow"><div class="title">' + title + '</div><div class="sub">' + sub + '</div></div><span class="chev">' + icon('chevron-right', 'm') + '</span></button>';
}
const OV_TILE = '<span class="app-tile l" data-app="overload">' + icon('mark-overload') + '</span>';      // Overload's tile: where the food comes from
const lead = (name) => '<span class="lead">' + icon(name) + '</span>';
```

| Row | `lead` |
| --- | --- |
| `fuel-here` (Bring it from Overload on this device), `fuel-paste` (Paste from Overload) | `OV_TILE` |
| `fuel-file` (Choose a file) | `lead('file')` |
| `fuel-signin` (Sign in to cloud sync) | `lead('cloud')` |

`renderWelcome`: add `BRAND` before the `.screen-title`; `'<p class="muted mb8">'` becomes `'<p class="lede">'`;
`'<div class="list mt16">'` may lose `mt16`; the foot
`'<div class="center mt16"><button class="btn subtle" data-action="fuel-fresh">Start fresh</button><p class="small muted mt8">…</p></div>'`
becomes `'<div class="foot"><button class="btn text" data-action="fuel-fresh">Start fresh</button><p class="small muted">…</p></div>'`.
The rows stay `button.list-item.choice-card` inside `.list`: the stylesheet draws each as an outlined card (the
first one with the accent outline), also the last one.

**`sheetImport`: Bring food from Overload**, should: the message is a caution with an icon,
`'<div class="banner warn" id="fuel-import-msg" role="alert">' + icon('warning') + '<span>' + esc(opts.msg) + '</span></div>'`;
the two `choiceRow` calls take `OV_TILE` and `lead('file')`. The paste box stays
`<textarea class="input" id="fuel-paste" …>`: `textarea.input` is styled (12 px padding, 96 px or more, no resize
handle). Reference: `fuel-import.html`.

**`sheetCloud` and `cloudBody`**: no change. `#cloud-card.in-sheet`, `.cloud-msg` and
`.pill.cloud-status` (`synced`, `error`, else amber) are styled as the code writes them. Reference: `fuel-cloud.html`.

**`renderTrends`**, should; the structure stays (a card with the average and the chart, a card with the table):

- the caption over the average: `'<div class="tiny muted">Average a day, …</div>'` becomes `'<div class="label">…</div>'`;
- the side read-out: `'<div class="side small muted">'` becomes `'<div class="side' + (all.kcal > target * 1.05 ? ' over' : '') + '">'`;
- the legend: `'<div class="legend tiny muted">'` becomes `'<div class="legend">'`;
- in the table, `'<span class="muted"> / …</span>'` and `'<span class="muted"> of 6</span>'` may become `class="of"`
  (both are drawn the same), the last-week cells may take `class="r prev"`, and the three macro labels may take
  their marks: `'<i class="mk p"></i>Protein'`, `mk c`, `mk f`;
- `trendChart`: 13.4. Its `fill="currentColor"` and `stroke="currentColor"` attributes may stay: the
  classes set the colours.

**`renderSettings`**: no change needed. `F.settingsCard()` gets its number boxes from `targetRows`
(10.12); the body-weight row's `<div class="row">` may become `<div class="row tight">`; "Bring food from
Overload" may take `icon('clipboard')`, Reset `icon('trash')`. Reference: `fuel-settings.html`.

**`renderUnreadable`**: 10.10.

---

## 11. Glyphs to icons (inventory section 7)

`icon(name)` is 24 px; `icon(name, 'm')` 20 px; `icon(name, 's')` 16 px (inline in a line of text). One grid, one
stroke weight, `currentColor`, `aria-hidden`. A third argument is the icon's text alternative, written after the
drawing as `<span class="sr">…</span>`: pass the old glyph (with the space that followed it, if any) in the rows
marked **alt** below, so the line reads to assistive tech and to the tests as it did (9.2).

| Glyph | Where | Becomes |
| --- | --- | --- |
| ▶ ◉ ☰ ◆ ▤ ⚙ | tab bar | static SVG (7.2): `dumbbell` Today, `calendar` Program, `list` Exercises, `chart` History, `settings` Settings; Fuel: `gauge` Today, `bars` Trends, `settings`. The Food tab's ◉ goes |
| red diamond (CSS) | brand mark | the app's mark, `mark-overload` or `mark-fuel`: ink on a neutral key in the top bar; on the app's tile in `.app-tile` |
| (new) | Update ready, during a workout | `icon('refresh', 'm')` before `<span>Update ready</span>` (7.1) |
| ☁ ✓ / ☁ … / ☁ ⏸ / ☁ ! | cloud pill (`syncIcon`) | `icon('cloud-check', 'm')` / `icon('sync', 'm')` / `icon('cloud-off', 'm')` / `icon('warning', 'm')`; `innerHTML`, not `textContent` |
| ✓ | set tick, warm-up tick, folded badge | `icon('check')` |
| ✓ | "Morning check-in ✓" | `icon('check', 's', '✓')` after the words (**alt**) |
| ✓ | "Logged ✓", "Done ✓" | `icon('check')` before the word |
| ✓ | quick-add key once logged | `icon('check')` (`innerHTML`) |
| ✕ | close a sheet | `icon('close')`, `aria-label="Close"` |
| ✕ | dismiss a notice, clear warm-ups | `icon('close', 'm')` with an `aria-label` |
| ✕ | remove an exercise from a day, a food from a saved meal | `icon('close')`, `aria-label="Remove …"` |
| ✕ | delete a template, a weigh-in, a night | `icon('trash')` on `.icon-btn.danger`, `aria-label="Delete …"` |
| › | row chevrons | `icon('chevron-right', 'm')` inside `.chev`; in History's workout rows `icon('chevron-right', 'm', '›')` (**alt**) |
| ‹ › | calendar, day switcher | `icon('chevron-left')`, `icon('chevron-right')` |
| ‹ Back | sheets | `icon('chevron-left') + 'Back'` |
| › in "Settings › Safari › Camera" | a sentence | stays text |
| ↑ ↓ | move an exercise | `icon('arrow-up')`, `icon('arrow-down')` with `aria-label`s |
| ↑ in "weight ↑" | History rows | `icon('arrow-up', 's', '↑')` after the word, in `.ok-ink` (**alt**) |
| + | "+ Day", "+ New", "+ Exercise", "+ Set", "+ Add exercise", "+ Add food" | `icon('plus')` before the word |
| + | picker row, quick-add key | `icon('plus', 'm')` in `.chev`; `icon('plus')` in `.f-plus` |
| − | "− Set" | `icon('minus')` before the word |
| ⋯ | meal menu | `icon('more')` |
| ▥ | scan a barcode | `icon('barcode')` |
| ★ ☆ | favourite mark in rows | `icon('star-filled')` inside `.f-favmark` |
| ★ ☆ | the star button | `icon('star-filled')` when on, `icon('star')` when off (`innerHTML`) |
| ☆ in the help text | Add sheet | the words "the star" |
| ✎ (CSS `content`) | exercise note | `icon('note', 's')` in the markup |
| 🔥 | streak banner, stat tile | `icon('flame', '', '🔥 ')`, `icon('flame', 'm', '🔥 ')` (**alt**, with its space) |
| 🔴 | red recovery | `icon('warning')` in `.banner.warn` |
| 🏆 | PR pill | `icon('trophy')` in `.pill.pr` |
| 🏆 | History rows and recent sessions | `icon('trophy', 's', '🏆')` (**alt**) |
| 🏆 followed by a space | "🏆 PRs:" in the weekly review, "🏆 Heaviest:" under the chart, the PR line of an exercise | `icon('trophy', 's', '🏆 ')` (**alt**, with its space) |
| 🏆 in the PR toast (`app.js:1783`) | toast text | drop it (a toast is plain text) |
| 🚶 | cardio minutes in the workout list | `icon('heart', 's', '🚶')` (**alt**) |
| select arrow (CSS) | drop-downs | CSS, drawn from `--ink-3` |
| switch (CSS) | deload | CSS |
| → ≥ ≈ × · – | sentences | stay text |

Also in the set: `search`, `camera`, `timer`, `bolt`, `swap`, `edit`, `copy`, `link`, `external`, `undo`, `refresh`,
`play`, `flag`, `drag`, `share`, `add-square`, `cloud`, `export`, `import`, `clipboard`, `file`, `scale`, `moon`,
`pulse`, `target`, `bell`, `stack`, `leaf`, `info`, `chevron-down`, `chevron-up`. All 61 drawings are at the end
of `components.html`.

## 12. Inline styles (inventory 5.4)

| Inline style today | Where (v2.8) | Becomes |
| --- | --- | --- |
| `width:90px;text-align:center`, `width:100px;text-align:center` | `app.js:875`, `1480-1483`, `1485-1487`, `1489`, `1497`; `food.js:985` | `class="input num"` (88 px) |
| `width:62px` / `64px;text-align:center` | `app.js:871-872`, `1484`, `1490` | `class="input num n2"` (64 px) |
| `width:auto;min-width:170px` (schedule select), `width:auto` (weigh-in select) | `app.js:1106`, `1491` | nothing: `.toggle-row > .select` sizes it |
| `max-width:200px` (cardio name) | `app.js:1496` | nothing: a text box in a `.toggle-row` is sized by the row |
| `max-width:150px` (time box) | `connector.js:339` | nothing: `.input[type=time]` |
| `flex:1;min-width:0` (code box) | `connector.js:311` | nothing: `.row > .input` |
| `width:52px;flex-shrink:0;white-space:nowrap` ("Set 1") | `app.js:1632` | `class="set-lbl"` |
| `text-align:center` (Edit sets boxes) | `app.js:1633-1634` | `class="input num fill"` |
| `gap:6px`, `gap:8px` | `app.js:864`, `870`, `875`, `1079`; `connector.js:338` | `class="row tight"` |
| `gap:12px` | `app.js:1400` | `class="legend"` (the sleep legend) |
| `flex-wrap:wrap;gap:6px` | `app.js:1137` | `class="row wrap"` |
| `flex-direction:column;align-items:stretch;gap:8px` | `connector.js:338` | `class="toggle-row stack"` |
| `font-weight:700;text-transform:uppercase;letter-spacing:.05em` | `app.js:1047`, `1092` | `class="label"` |
| `margin-top:14px`, `margin-top:6px` on a `.group-title` | `app.js:1468`, `1569`, `1571` | nothing (the stylesheet spaces group titles in cards and forms) |
| `font-weight:500;text-transform:none;letter-spacing:0` | `app.js:1571` | nothing: `.group-title .muted` |
| `color:var(--accent-2)` (muscle name) | `app.js:950` | `<b>` |
| `color:var(--accent-2)` (cloud error line) | `app.js:1522` | nothing: `#cloud-msg` is styled |
| `color:var(--green)` ("weight ↑") | `app.js:1276` | `class="ok-ink"` |
| `color:var(--green)` (PR line in the workout sheet) | `app.js:1618` | `class="pr-line"` |
| `color:var(--amber)` (reason in the workout sheet) | `app.js:1620` | `class="tiny muted mt8"` |
| `color:<var>` from `cloudColour` | `app.js:1515`, `1528`, `2435` | a class on the pill: `synced`, `syncing`, `offline`, `error` |
| `text-decoration:none` on Get Fuel, `overflow-wrap:anywhere` on the address hint | `fuelButtons` in `app.js` | nothing (`.btn` has it); `class="… break more"` (10.11) |
| `width:100px;text-align:center` on the target boxes | `targetRows` in `fuel/food.js` | `class="input num"` (the row above: same line as `food.js:985`) |
| `width:N%` | `app.js:427`, `1310`; `food.js:327` | **stays** (a computed value) |
| `padding…;font-family…` on the start-up note | `index.html:45` | **stays** (must read with no stylesheet) |
| `--save-warning-h`, `body.style.overflow`, rest bar `width`, drag ghost `left` / `top` / `width` | `app.js:350`, `1550`, `1557`, `1940`; `food.js:406`, `423` | **stay** (computed values) |

New computed values the script sets: `style="--n:19"` (at least 1) and a `width` on the top-bar meter;
`stroke-dasharray` and `stroke-dashoffset` on the gauge.

## 13. Charts (inventory section 6)

Still inline SVG built as text, still no colour in the SVG: classes only. `.chart` is `width: 100%; height: auto`
(the height follows the viewBox, it is no longer fixed at 160 px). **Label text is 13 units** (`.chart .lbl`), so
it is still 11 px when a 320-unit chart is drawn 270 px wide at 320; the paddings below make room for it. Grid
labels sit at `x="0"` with `y = line + 4.5`; date labels at `y = H - 5`.

| | viewBox | padding L / R / T / B | Marks |
| --- | --- | --- | --- |
| 13.1 Progress (`renderChart`) | `0 0 320 168` | 40 / 12 / 12 / 26 | three `.grid` lines with `.lbl`; `path.line` through the non-deload sessions; `circle.pt` r 3.5 per session; deload `circle.pt.deload` (hollow, off the line); **the last non-deload point is `circle.pt.now` r 4.5** (accent); two date `.lbl` |
| 13.2 Body weight (`renderBwCard`) | `0 0 320 160` | 44 / 12 / 10 / 26 | `.grid` + `.lbl`; `circle.pt.faint` r 2.5 per weigh-in; `path.line` (7-entry running average); **a `circle.pt.now` r 4.5 on the last point of the average**; two date `.lbl` |
| 13.3 Sleep (`renderSleepCard`) | `0 0 320 160` | 30 / 6 / 8 / 26 | `.grid` at 0, 4, 8 h; per night a `<g>` of up to three `rect` (`.sl-deep`, `.sl-rem`, `.sl-other`), bar inset 2.5 units each side, **a 1.5-unit gap between the stacked parts**, `rx="1.5"` |
| 13.4 Calories, 14 days (Fuel Trends: `trendChart` in `fuel/fuel.js`, as built) | `0 0 320 176` | 4 / 46 (4 with no target) / 14 / 28 | `svg.chart.trend-chart`; `line.axis` on the baseline; per day a `<g class="trend-day" cursor="pointer" data-action="fuel-day" role="button" tabindex="0">` (the cursor is what lets the tap reach the page on an iPhone; the stylesheet sets it too) holding `rect.hit` (the whole column, the tap target), its `rect.bar` (`rx="2"`, inset 2 units each side) and its weekday letter `text.lbl` (today's `.lbl.strong`); `.bar.over` when more than 5% over the target; `.bar.now` for today so far; `.bar.none` (a 3-unit stub in `--edge`, so a day not logged is still seen) for a day not logged; `line.target` across at the target and `text.lbl.target-lbl` right of it (`x="320"`, `text-anchor="end"`) |

- Scale of 13.4: `top = max(target * 1.15, the largest day)`; `y(v) = padT + (1 - v / top) * (base - padT)` with
  `base = H - padB`.
- What the script computes is what it computes today (positions from values); only the constants, the two `.now`
  marks and the gap in the sleep bars are new. The exact functions are `chartProgress`, `chartWeight`,
  `chartSleep` and `chartTrend` in `tools/lib.js`: they can be copied. `chartTrend` writes the same structure as
  `trendChart` in `fuel/fuel.js`, which needs no change.
- **A day of the Trends chart can be tapped** (it opens that day in Today; the line under the table says "Tap a
  day to open it."). Its target is the whole column: the chart's height (about 180 px at 390) by one day's width
  (about 20 px; 16 px at 320). That is under 44 px wide and is the one such target in the two apps: fourteen days do not fit
  otherwise, the columns touch, and the day switcher on Today reaches the same days with 44 px buttons. Pressed, the
  column shows a `--key` band; with the keyboard, an accent outline.
- Legends are HTML: `<div class="legend"><span><i class="swatch now"></i>Latest</span>…</div>` with `.swatch`
  (`.s1` `.s2` `.s3` `.now` `.over` `.line` `.dot` `.ring` `.dash`) or `.sl-key`. Two or more series get one.
  A target is the one dashed line and is labelled on the line, not in the legend.
- Colour rules: series are the neutral ramp `--series-1..3`; the accent marks only "now"; `--over` marks over
  target; text never takes a series colour. Keep a `<title>` on each mark.
- Things that look like charts but are HTML: sets per muscle and the storage meter (`.vol-bar > .vol-fill`, inline
  width), macro bars (`.f-bar > span`), the rest meter (`#rest-bar-fill`, inline width, steps once a second), the
  top-bar meter, the calendar, the week strip. The calorie gauge is SVG (10.12).

## 14. Colours outside the stylesheet, icons, manifests

| Place | Dark | Light |
| --- | --- | --- |
| `<meta name="theme-color">` in both pages (the static value) | `#0a0b0c` | |
| `applyTheme` (`app.js:475`, and Fuel's copy): `meta.content = light ? … : …` | `#0a0b0c` | `#f6f6f3` |
| `manifest.webmanifest` and `fuel/manifest.webmanifest`: `background_color`, `theme_color` | `#0a0b0c` both | (a manifest has one value: the launch screen stays dark, as today) |

- **Status bar.** Both pages keep `apple-mobile-web-app-status-bar-style: black-translucent`: the page draws under
  the status bar and iOS writes the clock in white. On the light theme that was white on pale grey (inventory
  open question 2). `shared/ui.css` now paints a strip the height of the top inset in `--statusbar` (`#0a0b0c` in
  light, nothing in dark), so the clock is readable in both. In a browser tab the inset is 0 and the strip is
  not there. If the owner would rather have a light status bar in light mode, the only other route is the
  `default` bar style, which follows the phone's mode, not the app's setting.
- **Home Screen icons.** `dev/design/system/icons/overload/` and `…/fuel/`: `icon.svg` (1024 viewBox), `icon-180.png`,
  `icon-512.png`. Full-bleed squares, opaque, no rounded corners (iOS rounds them). Copy Overload's over the three
  files in the repository root (same names, so `index.html`, the manifest and `sw.js:114` need no change) and
  Fuel's into `fuel/`. An installed Overload keeps its old picture until it is added again.
  - **Overload: a loaded barbell** in the dark ink on a vermilion tile (`#ff5a2e`). It is the one shape that means
    lifting at 60 px and at 29 px; its plates step up towards the middle, which is Instrument's stepped-plates
    idea made into the thing itself; and it is wide, so it never has Fuel's silhouette. The face-on plate read as
    a record or a lens, and made both apps a circle in a tile; the stepped plates alone still read as signal bars.
  - **Fuel: a fork beside a plate with a leaf on it**, on a volt-green tile (`#c4f03a`). The fork says "eat" at any
    size; the plate is one heavy round shape, a relative of Overload's plates; the leaf is cut out of the plate, so
    it is the tile's own green. The first version's choice, a leaf inside the calorie gauge with part of the rim
    lit, read at 60 px as an eco-mode or battery-saver meter before it read as food, and its leaf was a third of
    the tile; the needle gauge read as a speed test; the bolt in a gauge read as charging. All four are on
    `icons.html`.
  - Both tiles use the dark-theme accents: they are the apps' real colours and neither is a colour iOS's own
    apps use, so the pair is found on a light or a dark wallpaper (`icons.html`, `shots/icons.png`).
- **The same two drawings inside the apps.** `icon('mark-overload')` and `icon('mark-fuel')` are the icons' glyphs
  on the 24 px grid (the numbers in `tools/icons.js` divided by 1024 / 24; `node tools/icons.js --mark` prints
  Fuel's). `.app-tile` shows one on the icon's own colour, in both themes; `.brand-mark` in the top bar shows it
  in ink on a neutral key.

## 15. Contrast

`node dev/design/system/tools/contrast.js` reads the token blocks of `shared/ui.css`, resolves them for the four
combinations and checks 65 pairs in each, then 9 for the rest dock on its own surfaces (269 checks, all pass;
`--md` prints the table). The pairs that decide:

| Pair | Needs | Dark, Overload | Dark, Fuel | Light, Overload | Light, Fuel |
| --- | --- | --- | --- | --- | --- |
| `--ink` on `--bg` / `--panel` / `--key` | 4.5 | 17.7 / 16.6 / 14.9 | same | 17.7 / 19.2 / 16.6 | same |
| `--ink-2` on `--bg` / `--panel` / `--key` | 4.5 | 10.0 / 9.3 / 8.4 | same | 8.4 / 9.1 / 7.9 | same |
| `--ink-3` on `--bg` / `--panel` / `--key` / `--key-2` | 4.5 | 6.5 / 6.1 / 5.5 / 4.7 | same | 5.7 / 6.1 / 5.3 / 4.8 | same |
| `--on-solid` on `--solid` (ticks, picked answers) | 4.5 | 11.2 | 11.2 | 17.6 | 17.6 |
| `--on-accent` on `--btn` (primary button) | 4.5 | 6.3 | 14.9 | 5.4 | 14.9 |
| `--on-accent` on `--accent` (the Added strip's Done, meters with text) | 4.5 | 6.3 | 14.9 | 5.4 | 5.3 |
| `--tile-ink` on `--tile` (the app tiles) | 4.5 | 6.3 | 14.7 | 6.3 | 14.7 |
| `--accent-ink` on `--bg` / `--panel` / `--key` (also the Update pill's outline, the focus ring) | 4.5 | 6.9 / 6.5 / 5.8 | 14.9 / 14.0 / 12.5 | 5.7 / 6.2 / 5.4 | 6.1 / 6.6 / 5.7 |
| `--accent-ink` on its wash over `--bg` / `--panel` | 4.5 | 6.0 / 5.5 | 11.7 / 10.6 | 5.1 / 5.5 | 5.5 / 5.9 |
| `--ok-ink` / `--warn-ink` / `--bad-ink` on `--panel` | 4.5 | 10.5 / 9.9 / 6.9 | same | 6.7 / 6.4 / 7.6 | same |
| status ink on its own wash (worst of bg, panel) | 4.5 | 8.2 / 7.8 / 6.0 | same | 5.5 / 5.2 / 6.2 | same |
| `--bad-ink` on `--bg` / `--key` (danger text, Discard) | 4.5 | 7.4 / 6.2 | same | 7.0 / 6.6 | same |
| `--edge` on `--bg` / `--panel` / `--well` / `--key` (control outlines) | 3 | 3.8 / 3.6 / 3.8 / 3.2 | same | 3.5 / 3.8 / 3.8 / 3.3 | same |
| the primary button's boundary on `--bg` / `--panel` (its fill; in Fuel light its edge) | 3 | 6.3 / 5.9 | 14.9 / 14.0 | 3.4 / 3.7 | 3.5 / 3.7 |
| `--accent` fill on `--bg` / `--panel` / `--key` | 3 | 6.3 / 5.9 / 5.3 | 14.9 / 14.0 / 12.5 | 3.4 / 3.7 / 3.2 | 3.5 / 3.7 / 3.2 |
| `--bad` (danger outline, over target) on `--bg` / `--panel` | 3 | 6.3 / 5.9 | same | 5.3 / 5.8 | same |
| `--m-carbs` / `--m-fat` on `--panel` | 3 | 7.1 / 9.3 | same | 5.5 / 6.0 | same |
| `--series-2` / `--series-3` on `--panel`; `--series-3` on `--bg` | 3 | 7.0 / 3.7; 4.0 | same | 4.8 / 3.4; 3.1 | same |
| rest dock: digits / context line / "/ 2:00" / REST on the dock | 4.5 | 12.8 / 7.2 / 4.7 / 5.0 | | the same: the dock is dark in light too | |
| rest dock: the meter on the dock; a key's outline against the dock / against the key | 3 | 4.6; 4.3 / 3.4 | | the same | |

Inside the two dark objects (rest dock, calorie summary) the dark columns apply in the light theme too.

**Danger against Overload's accent** (they sit side by side: Discard beside Finish, the error pill beside Update
ready, the save warning above Export backup). OKLab distance x 100, where 8 is the least for two colours that
must be told apart: fills 12.2 in dark and 15.2 in light, inks 11.5 in dark and 10.4 in light (the first
version: 8.1 and 6.0). Under simulated red-green colour blindness (protan and deutan) the four pairs stay at 9.7 or more. Danger still
never stands alone: it comes with a word or the trash or warning icon.

`node dev/design/system/tools/shoot.js` renders every reference screen and runs `tools/audit.js` on each (at 320,
390 and 430 px wide, both themes). The audit measures every text node as rendered against its painted background
and reports: text under AA, text under 11 px, tap targets under 44 px, clipped text, sideways overflow, **a button
label on two lines** (never in a row; a full-width button must fit at 390 px and up), **an input whose value is
wider than its box**, **a top bar whose parts overlap or whose title is under 40 px**, and **a toast that is
stretched or reaches a sheet's controls**. Current result: no finding on any of the 30 pages. The same function
was run on the real code with the new stylesheets (the current `app.js` and `fuel/fuel.js`, and v2.8, with the
tests' fixtures: Today, a workout while resting, every tab, Fuel's Welcome, both Add to Home Screen screens,
Trends, Settings, the add, amount, import and cloud sheets; 320 and 390 px, both themes): no finding. After the
restyle is applied, run it again on the app:
`const { audit } = require('./dev/design/system/tools/audit.js'); problems += await audit(page, 'Today 390 dark');`
from any Playwright test that has the page open, or `node dev/design/system/tools/shoot.js --url http://127.0.0.1:8449/index.html`
for a page that needs no data (it serves the repository root itself; `--port` changes the port).

Deliberate exceptions:

- disabled controls are faded (40%); the four keys of an idle reps-left row are faded digits with no outline (they
  are not controls until the set is ticked; the REPS LEFT label beside them is `--ink-3`, 6.1:1);
- recorded things step back: a done set's two boxes lose their outline (it returns on focus), and the three
  reps-left keys beside a picked one keep only a faint outline. Their digits are 4.5:1 or more and they stay
  tappable;
- a picked Off is a `--key-2` key with an `--edge` ring: the ring is 3.8:1 against the well around it (2.8 against
  the key inside it);
- icon-only buttons have no outline, their glyph (9:1 or more) is what identifies them;
- a day of the Trends chart is a target about 20 px wide (13.4);
- the sheet grabber, hairlines and meter tracks are decoration; `--ink-4` never carries text that matters.

## 16. What changes in behaviour

Only these. Nothing else moves, folds or changes meaning.

1. The top bar shows the screen title, and during a workout the workout's name, exercises done, elapsed time and
   the sets-done meter (7.1). When that does not all fit, the stylesheet gives room in a fixed order: the name is
   cut, Update ready becomes its icon, under 360 px the app's mark is dropped, and last the elapsed time.
2. Finish workout looks neutral until every set is ticked (10.3). Finish exercise already did.
3. The calorie target on the gauge is a button that opens the existing targets sheet (10.12).
4. Today's card: "Start a different day" sits beside "Start as deload" in the card (it was a button under the
   card). Same action, same list (10.2).
5. Things that are only shown, with no new interaction: dates and trained marks in the week strip; planned,
   deload and PR marks in the calendar; the "Set 3 of 3 next" line and the full rest in the dock; the calories
   column in quick rows; the big number in the food summary is what is left (it was what was eaten; both are
   still there).
6. The toast always shows at the top of the screen, over the top bar (CSS only). It was above the tab bar.
7. In the light theme a dark strip sits behind the status bar (CSS only, section 14).
8. The food summary turns to the danger colour from 5% over the calorie target, like the macro bars; between the
   target and 5% over it says "kcal over" without the colour (10.12). v2.8 coloured "N over" from 1 kcal.
9. The hand-over card on Today is drawn short (no step headings, no fine print); the full card is in Settings
   (CSS only: the markup and the actions are the same in both places, 10.11).
10. Cardio's Done is an outlined key and "Logged" is solid ink (it was the other way round in weight, 10.5); a red
    recovery pill is the danger colour, not the accent; both rest buttons are neutral keys.

Not done on purpose: no Undo, no folding of exercises still to come, no fourth tab layout, no moved controls,
no new action on the hand-over card, no new confirm dialogs (the browser's own `confirm()` and `prompt()` stay as
they are).

## 17. The judges' problems, one by one

| Problem (JUDGES.md) | Now | See |
| --- | --- | --- |
| Done set rows still look like pending rows | a done row has no wells: bare ink digits, solid tick; the next row is the only one with the rail, the accent tick and GOAL | `train-workout` |
| Picked reps-in-reserve key is a weak frame | solid ink; four separate 44 px keys with gaps | `train-workout` |
| 9.5 and 10 px labels | nothing under 11 px (the audit checks it); GOAL and REPS LEFT are 11 px capitals at weight 700; tab labels 11 px | all |
| Thin monospace digits, slashed zeros, holes at the comma and colon | no monospace: system sans, weight 700, tabular figures | all |
| No number leads the exercise card; index and time are small; the sets meter scrolls away | the target line at 34 px, in the head and again in the next-time box; `2/6 · 24m` at 15 px / 600 in the top bar; the sets meter is part of the top bar | `train-workout`, `train-feedback` |
| Today has no hero; deload and different-day are bare text | the workout name at 28 px with one line of facts, Start at 56 px, two real 44 px buttons | `train-today` |
| The dial is 235 px tall; macros are told apart only by a label | the gauge is 132 px (176 with its foot line); protein, carbs and fat each have a mark and a tone | `fuel-today` |
| Add sheet: heavy plus squares, calories buried | a round 36 px key in a 44 px target; calories are a right-aligned number column | `fuel-add` |
| Light rest dock is white on white | the dock is a dark object in both themes | `train-workout-light` |
| Near-black icon tiles, signal bars, speed test | accent tiles; a barbell, and a fork beside a plate with a leaf | `shots/icons.png` |
| Settings looks wire-framed; the toast lands on a row | inputs are inset wells and buttons raised keys, so the two no longer look alike; an Off is a quiet key and an On a solid one; labels are sentence case; the toast always shows over the top bar and never on a row | `train-settings`, `states` |
| Dashed note chip reads as a drop zone | a quiet line with an icon; warm-ups lose their dashes too | `train-workout` |
| Mono digits inside sentences | gone with the monospace | |
| Solid tick box on the check-in line looks like a control | a 16 px check after the words | `train-today` (scroll) |
| Calendar: a month does not read as a shape; planned and missed share a mark; no PR days | trained days are filled cells, planned days outlined, deload hollow, PR days dotted | `train-history` (scroll), `components` |
| Feedback looks like a form spec | joined answer keys, solid selection, 2 x 2 for four answers; the next-time box is a tinted block led by its number, not a frame | `train-feedback` |
| Trends: the legend wraps, the target is orphaned, over caps are tiny | a one-row legend; the target is labelled on its line; an over day is a whole bar in the danger colour | `fuel-trends` |
| Fuel in light loses its charge | the calorie summary is a dark object with the volt green in both themes, and the primary button is volt in light too (with a leaf-green edge) | `fuel-today-light`, `fuel-amount-light` |
| Capitals everywhere | capitals only on 11 px labels; titles, tabs, pills, section headings and field labels are sentence case | all |
| Numbers need `.num` and `.u` wrappers everywhere | none needed: tabular figures come from the component rules | section 4 |
| 136 inline style nudges in the mockups | the reference pages have none except computed widths (and the two documented stand-ins) | section 12 |
| Food sub line and folded exercise name are cut | both wrap | `fuel-today`, `train-workout-320` |
| The h1 is removed, buttons move into the top bar, nine render sites change | the h1 stays (hidden from view), buttons stay where they are; the title is set in `renderTopbar` | 7.1 |
| A softer done state in dark, so the next tick is the brightest mark | `--solid` is `#bfc4ca` in dark (it was `#dcdfe3`); the next tick has a stronger wash; a picked reps-left key's neighbours and idle rows step back | `train-workout-dark` |
| Upcoming exercise cards read as a wireframe | an idle reps-left row is four faded digits, not four boxes; the five set tools are still outlined buttons (section 18) | `shots/full/train-workout-*-full` |
| The gauge needle needs trigonometry; no state for no target or over | one number sets the fill and the marker; `.gauge.over` and `.gauge.none` are drawn | `fuel-today-over`, `fuel-today-none` |
| Select chevron is a hard-coded data URI; `--ink-4` on an empty-state icon | gradients from `--ink-3`; the empty-state icon is `--ink-3` | |
| The rest bar animates width inside a mask | no mask and no transition: the meter steps once a second | 7.3 |
| Behaviour changes ride along | five tabs, nothing folded, the check-in stays where it is; the list of what does change is section 16 | |
| Screens not drawn | Exercises, Fuel Settings, scanner, search results, soreness check-in, Edit exercise, picker, workout detail, the program sheet, the hand-over card in every state, Fuel's import and cloud sheets, unreadable data, start-up note, cloud, WHOOP, reminders and backup cards are drawn now | `shots/` |
| `ui.css` is 56 KB | see section 18 | |

## 18. Left for later, and what is still weak

- **Not seen on a phone.** The shots are Chromium on Linux with Inter standing in for SF Pro (`frame.css`). SF Pro's
  digits are a little narrower; the 24 px set digits at 320 px wide, the 52 px hero and the widths of button
  labels (the row of two keys in the hand-over card on Today fits with 2 px to spare in Inter) should be looked
  at on the device. Safe areas are simulated at iPhone sizes.
- **Three rules use `:has()`** (iOS 15.4 and later) and fall back to the plainer look without it: the three
  reps-left keys beside a picked one stepping back, the food name as the amount sheet's title, and the calendar
  card going edge to edge at 320 px before it has its class `cal-card`. `min-width: max-content` on buttons in a
  row (so a label never wraps) falls back, where it is not known, to labels that wrap in equal-width buttons.
- **The dark strip behind the status bar in the light theme** is a judgement call (section 14): on Fuel's Today it
  stacks a black strip, a pale bar and the dark gauge card. It is one token (`--statusbar`); the owner should see
  it on the phone, with and without, before it ships.
- **The hand-over card on Today still takes 306 px** until it is hidden or the log is copied. Start workout stays
  whole on the first screen at 390 x 844 with a streak banner above the week strip (by 2 px); with a backup notice
  as well, at 320 px wide, or on a shorter phone, it is partly or wholly under the fold. A one-line row that opens the card would be shorter, and
  would be a new action; it was not done (section 16).
- **The saved morning check-in is still a sentence** ("182.4 lb · Slept 7h 20m · REM …"). A read-out strip (weight,
  slept, recovery) would let the numbers lead; it means rebuilding the line the tests read as one fact, so it was
  left.
- **Size.** `shared/ui.css` is 57 KB (42 KB without comments, 15 KB gzipped); `train.css` 25 KB, `fuel.css` 20 KB.
  Each app loads 77 to 82 KB against 30 KB today. It is cached by the service worker, but it is the price of
  one shared file that also carries the other app's shared components, and of comments that say how to use it.
- **A set with reps in reserve is still 118 px.** Three sets fit above the rest dock at 844 px tall only when the
  page is scrolled to the exercise, which the app does. Folding the reps-in-reserve row into the set row is a
  behaviour change and was not done.
- **Set tools are still five outlined buttons per card.** They are real buttons at 44 px, as the rules ask, but
  they are the most wire-like part left. An overflow menu would fix it and would move controls.
- **Settings is still a long run of rows.** Calmer than before (an Off is quiet, numbers are heavy, a control that
  does not fit takes the row), but grouping the first card's fourteen rows under headings is a content change.
- **Fuel's light theme uses two greens**: volt for the gauge, the tiles and the primary button; the darker leaf
  green (`#46960a`) for the marks that sit on paper with no fill around them (tab indicator, today's bar, the
  first choice's outline, the button's edge). A volt green cannot reach 3:1 on white.
- **Danger and the Overload accent are both warm reds for some eyes.** They are now 10 or more apart (section 15)
  and danger is never a fill and always has a word or an icon next to it; the crimson is also pinker than a
  classic alarm red, which the owner may or may not like. It is one token pair per theme.
- **Reason boxes are neutral by default.** A caution (joint pain) looks like a routine reason unless the builder
  adds `warn` (10.4).
- **A day of the Trends chart is a 20 px wide target** (13.4): tall, touching its neighbours, and not the only way
  to reach a day, but under 44 px.
- **The toast covers the top bar's title and pills for its two seconds.** That was chosen over covering a row, the
  rest dock or a sheet; taps pass through it.
- **Sheets not composed as whole screens**: Edit day, Edit sets, Weigh-ins, Sleep, the meal menu, the saved-meal
  sheet, Quick add, New food, Daily targets, the WHOOP pairing states. Every component in them is on
  `components.html` and their markup changes are in section 10, but nobody has looked at them as pictures.
- **Native dialogs** (`confirm`, `prompt`: 28 call sites) are untouched and still look like the browser.
- **Charts are static** apart from the Trends days. `<title>` only; no tap-to-inspect. The 13-unit axis text is
  large at 430 px wide.
- **On / Off settings** are still two-segment controls (now told apart by weight); `.switch` is ready but needs the
  handlers changed (10.8).
- **Units in settings boxes** ("120" for the rest timer): `.input-unit` is ready, the rows were not changed.
- **The stepper** is styled but no screen uses it (an amount stepper would be new behaviour).
- **Old token aliases** (the rule `:root, .rest-timer, .f-sum { --text: … }` in `shared/ui.css`) should be deleted
  after the migration.
