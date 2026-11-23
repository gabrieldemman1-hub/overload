# Direction B: Athletic

Bold and energetic, built around the number. Deep neutral surfaces, rounded numerals, and one
two-stop gradient per app: **Heat** (red to orange) for Overload, **Fresh** (green to lime) for Fuel.
The gradient always means "yours": the main action, the set you are on, progress, the days you
trained or logged. Text on it is dark ink, never white. Everything you select (a reps-in-reserve
chip, a segment, a feedback answer) turns to ink instead of colour, so an hour in the gym is black,
white, one gradient and a column of green ticks. Records get the only gold on the screen.

Open any mockup and add `?theme=light` for the light theme. Screenshots of everything are in `shots/`
(`contact-dark.png` and `contact-light.png` show all eleven screens at once).

## Files

| File | What it is |
| --- | --- |
| `tokens.css` | Every design token, both themes, both apps |
| `ui.css` | The components, built only on the tokens |
| `icons.svg` | 47 icons as SVG symbols (`i-check`, `i-dumbbell` ...) |
| `icon-overload.svg`, `icon-fuel.svg` | The two Home Screen icons, 1024 px masters |
| `train-*.html`, `fuel-*.html` | The eleven phone mockups |
| `icons.html` | App icons large and at 60 px on a light and a dark wallpaper, tab bars, the icon set |
| `components.html` | The kit on one page: every button variant and state, form controls, pills, messages, bars, rings, sleep chart. Add `&app=fuel` to see it in Fuel's colour |
| `mock.css` | Mockups only: the fake status bar and home indicator. Not for the app |
| `tools/make.mjs` | Builds the HTML pages from template strings (`node tools/make.mjs`) |
| `tools/shoot.js` | Renders `shots/` with Playwright (serve the folder on port 8365 first) |
| `tools/contrast.mjs` | Prints the contrast ratios quoted below (`node tools/contrast.mjs`) |

## The tokens that matter

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` / `--card` / `--card-2` | `#0B0C10` / `#181A21` / `#21242D` | `#F1F2F5` / `#FFFFFF` / `#F2F3F6` | page, card, control on a card |
| `--fill` | `#272B36` | `#E6E8EE` | neutral buttons and chips (visible on page and card) |
| `--text` / `--text-2` / `--text-3` | `#F5F6F8` / `#BDC1CC` / `#9096A5` | `#0E1016` / `#434956` / `#5F6573` | three text levels, all AA on every surface |
| `--accent-grad` | Heat `#FF3B30` to `#FF8A1F`, Fresh `#0FBF63` to `#A8EB45` | same | buttons, current tab, tiles. Always carries `--on-accent` ink |
| `--mark-grad` | same as the accent | deeper stops (`#FF3B30` to `#E05F00`, `#0D9A4F` to `#45991A`) | rings, bars, trained days. Deep enough for 3:1 on white |
| `--accent-text` | `#FF7A52` / `#4ADE8B` | `#C2310A` / `#0B6B34` | the accent as text or a thin outline |
| `--accent-soft` | accent at 16% | accent at 12% | tinted backgrounds (tonal button, rest timer) |
| `--inverse-bg` / `--inverse-text` | `#F5F6F8` / `#0B0C10` | `#0E1016` / `#FFFFFF` | anything chosen |
| `--ok` | `#34D17A` | `#14994F` | a ticked set, a logged food, a switch that is on |
| `--gold-grad` | `#FFE066` to `#FFB300` | same | personal records only |
| `--warn` / `--danger` | `#FFB224` / `#FF4D6D` | `#C77700` / `#D92B4B` | attention / destructive or over target |
| `--macro-p` / `-c` / `-f` | `#2E8CF0` / `#C78400` / `#E0489E` | `#0F6FD1` / `#A65E00` / `#C026A8` | protein, carbs, fat, everywhere they appear |
| `--font-round` | `ui-rounded` (SF Pro Rounded on the iPhone) | | numerals and headings |
| `--ctl` | 52 px | | weight box, reps box and tick in a set row |
| `--tap` | 44 px | | the smallest tap target |

Theme switching works exactly as `styles.css` does today: `:root` is dark, and one block
(`:root[data-theme="light"], :root:not([data-theme="dark"]).system-light`) is light. The app accent
switches with `data-app="overload"` (default) or `data-app="fuel"` on `<html>`. An app block only
sets raw stops; the theme blocks turn them into the tokens the components read, so there is no
theme-times-app matrix to maintain.

## How the two apps differ

Only these things change. Spacing, type, radius, components and icons are shared.

| | Overload | Fuel |
| --- | --- | --- |
| `<html data-app>` | `overload` | `fuel` |
| Gradient | Heat, red to orange | Fresh, green to lime |
| Home Screen icon | ink barbell tilted up, on Heat | ink bolt, on Fresh |
| Mark in the top bar | dumbbell tile | bolt tile |
| Glow behind the screen title | warm | green |
| Tabs | five | three |
| The one giant number | Today's day name and Start; the working weight during a workout | calories left, inside the ring |
| Extra colour | gold for records | three macro colours |

Either app can show the other's mark (`.tile.fuel`, `.tile.overload`): Overload's "Food has moved"
card and Fuel's "Paste from Overload" row use it.

## Rules for the implementer

**Spacing.** 4, 8, 12, 16, 20, 24, 32, 40 (`--s-1` to `--s-10`). Screen gutter 16 (12 under 360 px wide).
Card padding 16, hero card 20. 12 between cards. Rows are 56 tall, compact rows 44.

**Type.** Rounded face for every number and every heading, the plain system face for running text and labels.

| Token | Size | Use |
| --- | --- | --- |
| `--t-hero` | 64 / 800 | one per screen at most: the streak, average calories |
| `--t-display` | 40 / 800 | second-level figures: estimated 1RM, body weight, next weight |
| `--t-title` | 30 / 800 | screen title |
| `--t-h2` | 20 / 700 | card title, exercise name (21 / 800) |
| `--t-num` | 24 / 700 | set inputs, stat values |
| `--t-body` | 16 | text |
| `--t-sub`, `--t-small` | 14, 13 | secondary lines |
| `--t-cap` | 12 / 700, uppercase, tracking 0.07em | labels. Nothing is smaller except tab labels (11) |

Tabular figures only where digits line up or tick: set inputs, list columns, the rest timer, chart axes.
Big standalone figures stay proportional.

**Radius.** 12 chips and small buttons, 16 inputs and buttons and set-row controls, 22 cards,
28 hero cards and sheets, full for pills. Nothing is square.

**Elevation.** Three levels. `--e-1` cards, `--e-2` things that float (rest timer, toast),
`--e-3` sheets. `--glow` is only for the primary button and the current tab. No borders on cards.

**When to use the accent.** One gradient button per screen (Start workout, Add to Dinner, Open Fuel).
The current tab. The set you are on (outline of the tick). Progress: rings, bars, the rest timer,
trained days on the calendar and week strip, logged days. Never for selection, never for decoration,
never white text on it.

**What each colour means.**

| Colour | Means | Never |
| --- | --- | --- |
| App gradient | yours to do, or what you did | a selected option |
| Ink (inverse) | chosen: RIR chip, segment, feedback answer | |
| Green | confirmed: ticked set, logged food, weight went up, switch on | a brand colour in Overload |
| Gold | a personal record | anything else |
| Amber | needs attention: a due weigh-in, an old backup, under target | a filled button |
| Rose | destructive, joint pain, over target | a filled button (outline plus icon only) |
| Macro blue, amber, pink | protein, carbs, fat marks | text |

Text never wears a chart colour. A coloured dot or bar sits next to text in a text colour.

**Icons.** Inline `icons.svg` once at the top of `<body>` in each app (then `href="#i-check"`), or
keep the file and add it to the service worker's list. `class="ic"` is 24 px; `s14` to `s32` resize it.
Icons take the text colour.

**Rings.** Put this once in each page so `.ring-fill.grad` can find its gradient:

```html
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="g-mark" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" style="stop-color:var(--m1)"/><stop offset="1" style="stop-color:var(--m2)"/>
  </linearGradient></defs></svg>
```

**Charts.** Lines 2.5 px with a 13 px end dot ringed in the card colour, a 10% wash under the line,
hairline grid, one label on the last point. Columns are 14 px wide with a 4 px rounded top and a
square foot; days over target by 5% or more are rose, days not logged are a stub, today is faded
until it ends. The tapped bar turns to ink and gets a tooltip pill (needs a few lines of JavaScript;
the mockup shows the state). Stacked bars keep a 2 px gap between fills.

**Motion.** 120 ms press feedback, 240 ms for the sheet and for the tick landing (`pop`). The tick
is the only thing that animates when you log a set, and no height changes. All of it is off under
`prefers-reduced-motion`.

**Applying it to the current markup.** Most class names are the app's own, so the stylesheet swap
carries most of the work. The changes that need a line of JavaScript or HTML:

1. `<html data-app="overload">` or `"fuel"`, and `theme-color` `#0B0C10` (dark) / `#F1F2F5` (light).
2. Tab icons and the brand mark become `<svg class="ic"><use href="#i-..."/></svg>`. Tab labels are sentence case.
3. Add class `next` to the first `tr.set-row` that is not done. The tick button keeps `class="check"`; its content becomes the check icon (the text `✓` also works).
4. New small pieces: `.ex-kicker`, `.ex-target` (the big `150 lb × 12` line), `.ex-meta` around the note and last-time line, `.topbar-progress` (one `<i>` per exercise: `done`, `now` or empty), `.rest-icon`.
5. `.choice-grid` takes `c3` for pump and `c4` for the two four-answer questions (falls back to two columns on a 320 px phone).
6. `.pill.pr` is now gold with the trophy icon, in place of the green pill with an emoji.
7. On/Off settings can stay as `.seg`, or become `<button class="switch on" role="switch">`.
8. Food: `.f-sum` gets the ring (`.f-ringrow`, `.f-ring`, `.f-side`); the amount sheet uses `.stepper.lg` and `.f-result`; a food row's sub line wraps its amount and its macros in two `<span>`s so each stays whole.

## The tab bar

The current tab is a gradient capsule behind the icon with the label in full-strength text; the rest
are grey icons with labels. Labels always show.

- **Overload: Today, Program, Exercises, History, Settings.** Food leaves and nothing else moves, so
  Today stays under the left thumb and no habit breaks. Five tabs are 76 px wide at 390 px and 62 px at 320 px.
  Folding Exercises into Program would get to four wider tabs, but it changes where things are and is not needed for the split.
- **Fuel: Today, Trends, Settings.** Three wide targets. Adding food is not a tab and there is no
  centre plus button: you add from the meal it belongs to, which is one tap and already says which meal.

## Contrast, measured

WCAG ratios from `tools/contrast.mjs` (136 pairs, none failing). Soft backgrounds are measured as
they composite on the card. Text needs 4.5, large text and essential graphics 3.

| Pair | Dark | Light |
| --- | --- | --- |
| Text on page / on card | 18.1 / 16.1 | 17.0 / 19.0 |
| Secondary text on card | 9.7 | 9.0 |
| Muted text on card / on control / on neutral button | 5.9 / 5.2 / 4.8 | 5.8 / 5.3 / 4.8 |
| Chosen chip (inverse) | 18.1 | 19.0 |
| Overload: ink on Heat, red end to orange end | 5.4 to 8.1 | 5.4 to 8.1 |
| Overload: accent text on card / on its soft tint | 6.8 / 5.5 | 5.6 / 4.9 |
| Overload: marks against card (trained day, ring, bar) | 4.9 to 7.4 | 3.6 |
| Fuel: ink on Fresh, green end to lime end | 7.0 to 11.9 | 7.0 to 11.9 |
| Fuel: accent text on card / on its soft tint | 10.0 / 7.4 | 6.6 / 6.0 |
| Fuel: marks against card (ring, logged day) | 7.2 to 12.1 | 3.6 |
| Ink on the green tick | 8.6 | 4.6 |
| Green tick against the card | 8.7 | 3.7 |
| Numbers in a ticked set (text on green tint) | 12.3 | 16.6 |
| Empty tick outline against the card | 3.6 | 3.4 |
| Amber text on its tint | 8.4 | 6.5 |
| Rose text on card / on its tint | 6.6 / 5.6 | 6.0 / 5.2 |
| Gold ink on the PR pill | 9.3 to 12.8 | 9.3 to 12.8 |
| Macro marks against card: protein / carbs / fat | 5.1 / 5.6 / 4.6 | 5.0 / 5.0 / 5.1 |

The tightest pairs: Overload's accent text on its own soft tint in light (4.9), muted text on a
neutral button (4.8), ink on the green tick in light (4.6). White text on Heat is 3.5 at best (2.4 at the orange end) and is not used anywhere.

The three macro colours were checked for colour-blind separation with the palette validator
(protan and deutan, all pairs): worst pair 14.0 in dark, 9.1 in light, against a target of 8.
Macros are also always labelled, so colour is never the only cue.

## What is still weak

- **The screenshots are not the iPhone.** They were rendered on Linux, where `ui-rounded` falls back
  to Inter. SF Pro Rounded is rounder and a little wider: check the ring number, the set inputs and
  the four-across feedback answers on the phone before trusting the widths.
- **The workout screen is full.** With the timer docked, the third set row ends 28 px above it at
  390 x 844 and its greyed reps-in-reserve row is already under the timer. It works because the app
  scrolls to the next set, but a fourth set, a warm-up block or a long note always scroll. The big `150 lb × 12` line repeats what the boxes show; if it feels redundant in
  the gym it can drop to 28 px and give the height back.
- **Heat sits near the warning and danger hues.** They are kept apart by form (gradient fill with ink,
  against amber tint or rose outline with an icon), not by hue. Under red-green colour blindness the
  "now" and "done" segments of the progress strip are also close; order and the tick icon carry it.
- **Light theme loses some of Fresh.** To hold 3:1 on white, rings, bars and logged days use a deeper
  green in light mode; the lime only survives on buttons and the tab. Dark mode is the better-looking Fuel.
- **Seven columns at 320 px.** Week-strip chips are 37 px wide and calendar days 37 x 44. Seven
  44 px targets do not fit a 320 px screen; everything else meets 44.
- **Not drawn:** Exercises, Fuel's Settings, the open check-in form, the soreness check-in, deload mode,
  the cardio timer running, barcode scanning, past workouts and editing one, and the charts' tap layer.
  The pieces for all of them are in `components.html`, but they have not been composed or looked at.
- **The Fuel icon.** A bolt on green can read as a battery or charging app. It is clearly different
  from Overload at a glance, which was the brief, but a fork or an apple would say "food" faster.
- **Sleep colours** (deep, REM) are carried over from the current app and were not re-validated.
