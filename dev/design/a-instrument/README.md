# Instrument

A design direction for Overload (training) and Fuel (diet): one system, two accents.

## The direction

The screen is the display of a good piece of gym equipment or a stopwatch. The surface is near-black graphite with hairline rules where the old app had boxes. Every measurement (weight, reps, kcal, time) is set in the system monospace, tabular, and is bigger than the words around it; words are quiet system sans, and labels are small tracked capitals. Colour is rationed: solid ink means "recorded" (a ticked set, a selected answer), an outline means "you can tap or type here", and the one accent per app means "this is live, or do this next" (the next set's tick, the rest timer, Start, the kcal dial). The signature read-outs are tick meters: a row of ticks for the rest timer, one block per set for workout progress, and a half dial of ticks for calories. The light theme is the same instrument printed on paper: black ink, the same hairlines, the same signal.

## Files

| File | What it is |
| --- | --- |
| `tokens.css` | Every token, both themes, both apps. `:root` is dark; one light block covers `data-theme="light"` and `.system-light`; `data-app="fuel"` switches the accent. |
| `ui.css` | Components. Class names follow `styles.css` wherever the component already exists. |
| `icons.svg` | 49 icons and the two top-bar marks as `<symbol>`s. 24 px grid, 1.5 px stroke, round caps and joins. |
| `icon-overload.svg`, `icon-fuel.svg` | App icons, 1024 px masters, full-bleed squares (iOS applies its own mask). |
| `train-*.html`, `fuel-*.html` | The eleven screen mockups. `?theme=light` switches the theme. |
| `icons.html` | App icons large, on a mock Home Screen row (dark and light wallpaper), small sizes, and the icon sheet. |
| `components.html` | Every component on one page, including the ones the screens do not show (weekly volume, sleep chart, banners, all button variants). `?app=fuel` for Fuel's accent. |
| `mock.css` | Mockups only: fake status bar and home indicator, iPhone safe-area sizes, and the fonts this render box has. Do not ship. |
| `shots/` | Every mockup at 390 x 844 @2x, dark and light; `train-workout` and `fuel-today` at 320; `contact-dark.png`, `contact-light.png`. `shots/full/` has each whole page in one image, `shots/wide/` has 430 px. |
| `tools/shoot.js` | Renders the shots and audits each page: sideways overflow, clipped text, tap targets under 44 px, text contrast as rendered. |
| `tools/contrast.js` | Reads `tokens.css` and prints the WCAG ratio of every pair that matters, per theme and app. |
| `tools/build_mocks.py` | Fills the generated parts of the mockups (chart geometry, the Today page behind the Fuel sheets, the icon sheet). |

## The tokens that matter

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#0a0b0c` | `#f7f7f4` | The faceplate. |
| `--panel` | `#111315` | `#ffffff` | A module: exercise card, sheet, rest dock. |
| `--well` / `--well-2` | `#171a1c` / `#212528` | `#ffffff` / `#ebebe6` | Inputs and keys / pressed key, neutral selection. |
| `--rule` / `--rule-2` | `#23272b` / `#30353a` | `#deddd6` / `#c9c8c0` | Hairlines between things you read / meter track. |
| `--edge` | `#636a71` | `#85857d` | Outline of anything you can tap or type in (3:1). |
| `--ink` / `--ink-2` / `--ink-3` | `#f2f3f4` / `#adb3ba` / `#8a9199` | `#0e0f11` / `#474b51` / `#62666c` | Text. All three pass 4.5:1 on every surface. `--ink-4` is for disabled and decoration only. |
| `--accent` | `#ff5a2e` Overload, `#c4f03a` Fuel | `#f04a1c` Overload, `#3d8f1f` Fuel | Fills: primary button, meters, the live mark. |
| `--accent-ink` | same as `--accent` | `#c2300a` Overload, `#2b6a12` Fuel | The accent as text or icon. |
| `--on-accent` | `#0a0b0c` | `#0a0b0c` | Legend on an accent fill. Always the dark ink, in both themes and both apps. |
| `--ok` `--warn` `--bad` (+ `-ink`, `-wash`) | `#3ddc97` `#f2b33d` `#ff5c70` | `#00997a` `#c27c00` `#d42a48` | States only, always next to a word or an icon. |
| `--series-1..3` | `#c5cad0` `#7f868e` `#474d53` | `#2b2e33` `#7c8087` `#adafb1` | Charts: an ordered neutral ramp. The accent marks "now". |
| `--font-num` | | | `ui-monospace, "SF Mono", ...` for every measurement. |
| `--key` / `--tap` | 56 px / 44 px | | Set-row controls / smallest tap target. |

## How the two apps differ

| | Overload | Fuel |
| --- | --- | --- |
| Accent | Vermilion `#ff5a2e` (light `#f04a1c`) | Volt green `#c4f03a` (light `#3d8f1f`) |
| Top-bar mark | Plates going up along a bar, the last one lit | A half dial, part lit, with a needle |
| Home Screen icon | Four plates on a bar, the tallest in vermilion | A gauge in five segments, three lit, with a needle |
| Signature read-out | Straight tick meters (rest timer, sets done) | The half-dial gauge (kcal left) |
| Tab bar | Today, Program, History, Settings | Today, Trends, Settings |

Everything else is shared: surfaces, type, spacing, every component. Set `data-app="fuel"` on `<html>` in Fuel; Overload needs nothing (it is the default).

## Rules for the implementer

**Space.** A 4 px grid: 4, 8, 12, 16, 24, 32, 48 (`--s-1` to `--s-7`). Screen gutter 16 px, 12 px under 360 px wide. Inside a module 16 px. Between a section label and its content 8 to 12 px; between sections 28 px.

**Type.** Words: 11 label (600, capitals, +0.08em), 13 small, 15 body, 17 title (700), 22 head (700). Numbers: 15 read-out, 20 value, 24 set field, 34 big, 56 hero (64 for the kcal dial). One hero number per screen at most. A number is `class="num"`; its unit is a separate `<span class="u">` in tracked capitals and is never monospace (`150` + `LB`, never `150 lb` in mono). Numbers inside a sentence stay in the text face. Monospace digits are loose at display sizes, so `--track-num` pulls them in (-0.03em, -0.05em on the hero).

**Shape.** 2 px data marks and tags, 6 px small keys, 10 px inputs, buttons and modules, 18 px sheet top corners. Nothing is fully round except the switch.

**Elevation.** None. Layers are separated by a hairline. Only the sheet, the rest dock and the toast sit above the page: in dark they get an edge line, in light an edge line and a soft shadow.

**The three meanings.**
- An `--edge` outline: you can tap or type here. Dividers use `--rule`, never `--edge`.
- Solid `--ink`: recorded. Ticked set, done exercise, selected segment or answer, the on switch, a confirm button (`.btn.success`).
- `--accent`: live or next. On any screen, at most: one primary button, the next set's tick and cursor, the running meter, the tab indicator, a PR tag. If more than about five things on a screen are accent, something should be ink instead.

**Status.** `--ok`, `--warn`, `--bad` only for states (weight went up, under target, over, destructive). Always with a word, a sign or an icon. `.btn.danger` is outlined, never filled.

**Tap targets.** 44 x 44 px minimum; set-row weight, reps and tick are 56 px tall. The switch element is 52 x 44 with the track drawn inside it. Seven-across strips (week, calendar) go full-bleed under 360 px so their cells stay 44 px wide.

**Icons.** `<svg class="ic"><use href="#i-name"/></svg>`. Sizes: `.ic` 24, `.m` 20, `.s` 16, `.l` 32; the smaller sizes get a heavier stroke in CSS so the line stays near 1.4 px. Paste `icons.svg` once into each app's `index.html` (it is 8 KB) and reference `#i-name`; the mockups reference the file. Do not write a double hyphen inside the sprite's comments: it breaks the XML and every icon after it disappears.

**Charts.** Hairline solid grid, mono labels in `--ink-3`, 2 px ink line, 12 px bars square at the base with a 2 px rounded data end, 2 px surface gap between stacked parts. The accent marks only "now" (latest point, today's bar). Text never takes a series colour. Two or more series get a legend. A target is a threshold, so it is the one dashed line. Give each mark a `<title>` with its date and value.

**Motion.** 120 ms for presses and switches, 220 ms for the sheet. Nothing animates when a set is ticked except the tick itself. `prefers-reduced-motion` turns all of it off.

**Fonts.** System only. `mock.css` adds Inter and JetBrains Mono behind the real stacks so this Linux box can render; on the phone SF Pro and SF Mono are used.

## Applying it to the existing markup

Old tokens map over: `--bg-2` → `--well`, `--card` → `--panel`, `--card-2` → `--well-2`, `--border` → `--rule` (dividers) or `--edge` (controls), `--text` → `--ink`, `--muted` → `--ink-3`, `--accent-2` → `--accent-ink`, `--accent-soft` → `--accent-wash`, `--green` → `--ink` for "done" and `--ok` for "good", `--amber` → `--warn`, `--radius` → `--r-3`.

These classes keep their names and markup and only change looks: `.topbar`, `.screen`, `.tabbar .tab`, `.card`, `.card-head`, `.btn` and its variants, `.btn-row`, `.icon-btn`, `.pill`, `.group-title`, `.list-item`, `.toggle-row`, `.stat-row .stat` (value then key in the markup, shown key above value), `.seg`, `.field .input .select`, `.set-table .set-row .set-input .check`, `.rir-pick .rir-btn`, `.warmups .warmup-row`, `.prompt .choice-grid .choice`, `.next-box`, `.ex-card .ex-head .ex-name .ex-presc .ex-last .ex-note .ex-reason .ex-body .ex-fold*`, `.rest-timer*`, `.sheet*`, `.toast`, `.banner`, `.notice`, `.cal-grid .cal-cell`, `.chart` and its marks, `.vol-*`, `.f-*`.

Markup that has to change:

1. Glyph characters become icons: the six tab glyphs, `✓` in `.check` and `.ex-fold-tick`, `›` in `.chev`, `⋯`, `✕`, `✎`, `☆`, and the emoji in pills and banners.
2. Top bar: `.brand-mark` is `<svg class="brand-mark"><use href="#i-mark-overload"/></svg>`, and the text next to it is the screen title. The `<h1>` in `.screen-title` goes; its buttons move to `#topbar-right`.
3. Set rows: add `next` to the first unticked `tr.set-row` of the workout; put `<span class="set-hint">goal</span>` after a reps input (it shows only while the box is empty); give the last `th`/`td` the class `chk`.
4. Week strip: each `.day-chip` gets `<span class="d">16</span>` and the class `done` when trained.
5. On/off settings: `<button class="switch on" role="switch" aria-checked="true">` instead of an On/Off `.seg` (the `.seg` still works if that is easier).
6. Numbers: wrap measurements in `.num`, units in `.u`.
7. Charts: add `now` to the last `.pt`; bars use `.bar`, `.bar.now`, `.bar.over`.
8. Fuel summary: the dial markup from `fuel-today.html` (two paths and a mask; the app sets `stroke-dasharray="<percent> 100"` on `.gauge-fill` and moves `.gauge-mark`).
9. `<meta name="theme-color">`: `#0a0b0c` dark, `#f7f7f4` light.

Each app needs only its own part of `ui.css`: Overload can drop section 14 (food), Fuel can drop sections 10 and 11 (workout, rest timer).

## The tab bar

The old bar had six destinations with text glyphs. Each app now has fewer, wider tabs.

**Overload: Today, Program, History, Settings (4).** Food leaves with Fuel. Exercises moves into Program as a second segment (Plan | Exercises): the exercise list is setup, used when planning, and during a workout an exercise's settings are one tap away on its card. Four tabs are 97 px wide at 390 px, which matters with sweaty hands. If Exercises must stay a tab, the bar holds five without changes (put it between Program and History with `#i-list`).

**Fuel: Today, Trends, Settings (3).** Adding food is an action, not a place, so it lives on each meal. Favorites, saved meals and scanning live in the Add sheet where they are used.

The active tab is ink with a 2 px accent indicator on the bar's top edge; the others are `--ink-3`. Labels are 10 px tracked capitals.

## Design decisions that change behaviour

These are in the mockups and are worth a decision each; the CSS does not depend on them.

- The saved morning check-in is one 48 px line above the workout, not a card below it.
- In a workout, exercises still to come are folded rows with a hollow index (01, 02); the one being done is open. Tapping a row opens it. Today the app shows them all open.
- Workout progress is a stepped meter, one block per set (5 / 19).
- Finish exercise and Finish workout are neutral keys until everything in them is ticked, then they turn accent.
- The rest dock shows the full rest next to the countdown (1:24 / 2:00).
- The picked reps-in-reserve button is a bright frame, not a solid block, so ticks stay the loudest thing in the card.
- The calendar uses the week strip's marks (solid square trained, hollow planned or missed, none on rest days) instead of filled cells.
- Fuel: the target is edited by tapping the 2,600 at the end of the dial. Trends shows the part of a day over target as an amber cap.

## Contrast, measured

`node tools/contrast.js` computes these from `tokens.css` (WCAG 2 ratio). `tools/shoot.js` also checks every rendered text node of every mockup against its painted background, in both themes: no text is under AA.

| Pair | Dark | Light | Needs |
| --- | --- | --- | --- |
| `--ink` on `--bg` / `--panel` / `--well` | 17.7 / 16.8 / 15.7 | 17.9 / 19.2 / 19.2 | 4.5 |
| `--ink-2` on `--bg` / `--panel` / `--well` | 9.3 / 8.8 / 8.3 | 8.2 / 8.8 / 8.8 | 4.5 |
| `--ink-3` on `--bg` / `--panel` / `--well` / `--well-2` | 6.2 / 5.8 / 5.5 / 4.85 | 5.4 / 5.8 / 5.8 / 4.83 | 4.5 |
| Inverted: `--bg` on `--ink` (ticks, selected segments) | 17.7 | 17.9 | 4.5 |
| Overload `--accent-ink` on `--bg` / `--panel` / `--well` | 6.3 / 6.0 / 5.6 | 5.3 / 5.6 / 5.6 | 4.5 |
| Overload `--accent-ink` on its wash | 5.5 | 4.65 | 4.5 |
| Overload `--on-accent` on `--accent` (button legend) | 6.3 | 5.4 | 4.5 |
| Overload `--accent` fill against `--bg` / `--panel` | 6.3 / 6.0 | 3.4 / 3.7 | 3 |
| Fuel `--accent-ink` on `--bg` / `--panel` / `--well` | 14.9 / 14.1 / 13.2 | 6.2 / 6.6 / 6.6 | 4.5 |
| Fuel `--accent-ink` on its wash | 11.8 | 5.4 | 4.5 |
| Fuel `--on-accent` on `--accent` | 14.9 | 4.83 | 4.5 |
| Fuel `--accent` fill against `--bg` / `--panel` | 14.9 / 14.1 | 3.8 / 4.1 | 3 |
| `--edge` (control outlines) on `--bg` / `--panel` | 3.6 / 3.4 | 3.5 / 3.7 | 3 |
| `--ok-ink` / `--warn-ink` / `--bad-ink` on `--bg` | 11.2 / 10.6 / 6.6 | 6.2 / 5.9 / 6.0 | 4.5 |
| Status text on its own wash (worst of bg, panel) | 8.3 / 7.9 / 5.3 | 5.5 / 5.2 / 5.2 | 4.5 |
| `--series-1` / `--series-2` marks on `--bg` | 11.9 / 5.4 | 12.7 / 3.7 | 3 |

Colour-blind separation (OKLab ΔE under simulated protan and deutan, from the dataviz validator; 8 is the target, 6 to 8 is allowed only with a second cue):

- The two accents against each other: 20.2 in dark; 7.1 in light. They never share a screen, and the mark, the title and the tab bar differ too.
- `--ok` against `--bad`: 9.2 in dark; 7.3 in light. Status always carries a word, sign or icon.
- The neutral chart ramp passes the ordinal checks in both themes.

## What is still weak

- **Not seen on a phone.** The shots are Chromium on Linux with Inter and JetBrains Mono standing in for SF Pro and SF Mono. SF Mono is a little wider and lighter: the 24 px set numerals at 320 px wide, the letter-spacing values and the hero sizes need a look on the real device. Safe areas are simulated at iPhone 14 sizes.
- **The light accents are close for red-green colour-blind eyes** (ΔE 7.1). A bluer Fuel green (`#1f9d55`, ΔE 8.5) separates better but drifts from the dark theme's volt; I kept the family resemblance.
- **Overload's Today has no hero number.** The workout name and Start lead; the three read-outs are 28 px. That seemed right before a workout, but it is the screen where "numbers lead" is weakest.
- **The Overload icon** can read as signal bars before it reads as plates. It is distinctive and pairs well with Fuel's gauge, but a first-time viewer may not see a barbell.
- **Dense forms look wire-framed in dark.** Giving every control a 3:1 outline is correct, but Settings shows a lot of outlines at once.
- **A set with reps in reserve costs 120 px.** Three sets fit above the rest dock at 844 px tall only when the page is scrolled to the exercise, which the app does. Four sets do not fit.
- **Mono in running lines** (`7h 08m`, `150×12 · 150×11`) is a little mechanical, and both monospace faces have a slashed zero, which not everyone likes in `150`.
- **Charts are static.** They have `<title>` tooltips but no tap-to-inspect layer, and the dataviz advice of proportional figures on hero numbers is deliberately not followed (the direction asks for monospace heroes).
- **Not drawn:** the Exercises list, Fuel Settings, the barcode scanner, search results, the soreness check-in. Their components exist in `ui.css` and `components.html`, but those screens have not been composed or looked at.
- **The toast covers a row** wherever it lands; it is short-lived, but in a still image it looks untidy.
- **`ui.css` is 56 KB** before each app drops the other's section, about twice the current stylesheet.
