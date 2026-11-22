# Studio

Direction C for the redesign of Overload (training) and Fuel (diet).

## The direction

A training journal and a food diary, typeset like a quiet magazine. The page is warm paper (light) or warm
off-black (dark), never neutral grey. Hierarchy comes from type and air: each screen has one number that is the
biggest thing on it (the weight and reps you are about to type, the calories left, the streak), set tight and
large, with small tracked uppercase labels around it. There are almost no borders and no shadows; groups are made
by spacing and by one-step tone shifts (page, card, control fill). Colour is rationed: each app has one accent,
and it only ever means "do this now", "this is current" or "you earned this". Everything that is merely done is
ink. The one flourish is a serif italic "margin note" voice for exercise notes and reason lines. The two apps are
two plates: a weight plate and a dinner plate.

Light is the hero theme; dark is drawn separately, not inverted (its own surfaces, brighter accents with dark
text on them, its own chart steps).

## Files

| File | What it is |
| --- | --- |
| `tokens.css` | Every token, both themes, both apps |
| `ui.css` | The components, built only on the tokens |
| `icons.svg` | 43 icons as SVG symbols (`<svg class="i"><use href="#i-check"/></svg>`) |
| `app-icons.svg`, `icon-overload.svg`, `icon-fuel.svg` | The two Home Screen icons, 1024 px |
| `train-*.html`, `fuel-*.html` | The eleven screens. `?theme=light` switches, dark is the default |
| `icons.html`, `components.html` | Icon sheet with the Home Screen rows; every component state the screens do not show |
| `mock.css` | Mock only: fake status bar and home indicator, the icon-sheet layout. Do not ship |
| `src/`, `tools/build.js` | The screens are built from fragments so the shell and sprite are written once: `node tools/build.js` |
| `tools/shoot.js` | Renders `shots/` (serves the folder on 127.0.0.1 and stops): `node tools/shoot.js 8370` |
| `tools/contrast.js` | Measures the contrast pairs below from `tokens.css`: `node tools/contrast.js` |
| `tools/crop.js` | Helper used while reviewing: screenshots one slice of a long page |
| `shots/` | 390 x 844 @2x, dark and light, per screen (`-full` is the whole page), 320 and 430 px for the workout and Fuel Today, `contact-*.png` |

## The tokens that matter

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#141210` | `#F5F1E8` | Page |
| `--surface` | `#1D1A17` | `#FDFBF6` | Card, one step up from the page |
| `--surface-2` | `#272320` | `#FFFEFB` | Sheet |
| `--thumb` | `#4D463F` | `#FFFEFB` | The chosen segment: always lighter than the track it sits in |
| `--fill`, `--fill-2` | paper at 7.5% / 14% | ink at 6.5% / 12.5% | Inputs and tonal buttons; tracks and the idle tick |
| `--ink`, `--ink-2`, `--ink-3` | `#F3EDE3` `#C9C0B2` `#A39B8D` | `#1F1B16` `#4F483E` `#696155` | Text. All three pass AA on page, card and fill |
| `--ink-4` | `#6F685E` | `#8E867A` | Non-text marks only (3:1) |
| `--accent` / `--on-accent` | ember `#E8693C` / `#1C0E07`, herb `#93C97F` / `#0E1A0B` | ember `#B5421D` / `#FFF8F1`, herb `#2F6B3D` / `#F6FBF2` | Fills and the text on them |
| `--accent-ink` | `#F08158`, `#9FD28B` | `#A63A17`, `#2B6338` | The accent as text or icon |
| `--accent-soft` | accent at 15 to 16% | accent at 10 to 11% | The one tinted panel |
| `--dock-bg` | `#37312B` | `#211D18` | Rest timer and toast. In light it inverts: the one dark object |
| `--viz-1/2/3` | `#BD5235` `#AB932B` `#6A8CD8` | `#A8492B` `#B38A1E` `#4C6FAE` | Protein clay, carbs wheat, fat blueberry. Marks only |

Theme: `:root` is dark; `:root[data-theme="light"], :root:not([data-theme="dark"]).system-light` is light, the
same two mechanisms `styles.css` uses, one palette block each. App: `data-app="overload"` (default) or
`data-app="fuel"` on `<html>`. The app block is written once and only points `--accent*` at the ember or herb
values of whichever theme is active. Checked in a browser for all seven combinations.

## How the two apps differ

Same tokens, same components, same spacing. They differ in exactly four things:

1. Accent: Overload is deep ember, Fuel is fresh herb.
2. Glyph: weight plate (two rings) and dinner plate (ring and leaf). It is the Home Screen icon, the brand mark
   in the top bar and the Today tab.
3. Tab bar: five tabs and three.
4. Fuel alone uses the three macro colours, in small marks (a dot, a 6 px bar). Overload has no categorical
   colour at all.

`theme-color` should follow `--bg` (`#141210` / `#F5F1E8`) in both apps so the status bar is part of the page.

## Rules for whoever implements it

**Spacing.** A 4 px scale and nothing in between: 4, 8, 12, 16, 20, 24, 32, 40, 56 (`--s-1` to `--s-9`). Page
gutter 20 (16 under 360 px wide). Card padding 20. 12 between cards of one group, 32 between groups. That 32 is
what replaces borders, so do not close it up.

**Type.** System sans only (`--font`, and `--font-display` so large sizes get the display cut). Weights 400,
500, 600, 700, nothing else.

| Role | Size / line | Weight | Tracking |
| --- | --- | --- | --- |
| Hero number (`.hero`) | 64 / 0.95 | 600 | -0.045em, proportional digits |
| Screen title (`.display`, `.page-head h1`) | 34 / 1.06 | 700 | -0.03em |
| Lead card title (`.title`) | 26 / 1.12 | 700 | -0.03em |
| Card and exercise title (`.heading`, `.ex-name`) | 20 to 22 / 1.2 | 600 | -0.018em |
| Numbers you type (`.numfield input`) | 26 / 1 | 600 | tabular |
| Body | 16 / 1.45 | 400, 500 for row titles | |
| Small, caption | 14, 12.5 | 400 | |
| Eyebrow (`.eyebrow`) | 11 / 1.2 uppercase | 600 | +0.09em |
| Margin note (`.note`) | 16 / 1.4 serif italic | 400 | |

One hero number per screen. Numbers are always the sans: tabular in columns and inputs, proportional when they
stand alone. The serif italic is for notes and reason lines only, never numbers, never controls.

**Radius.** 8 tags, 12 chips and segmented thumbs, 16 inputs and number fields, 24 cards, 30 sheets and the
dock, full pill for buttons, circles for ticks and icon buttons.

**Elevation.** Three levels. 0: everything on the page, tone only, no shadow, no border. 1: the dock and the
toast (`--shadow-1`). 2: a sheet over a scrim (`--shadow-2`). Hairlines (`--line`) appear only between rows
inside a list.

**The accent.** Use it for, and only for: the single primary action of the screen (Start workout, Add to
Dinner), the thing that is current (today, the next set's tick and outline, the running ring, the active tab
icon, a switch that is on), and an achievement (PR tag, the streak pill, the next-time box). If a screen already
has an accent fill, the next button is tonal or ink. Done is ink: ticked sets, chosen chips, trained days.
Text in the accent uses `--accent-ink`, never `--accent`.

**Tap targets.** 44 px minimum everywhere. Set-row fields and the tick are 56 px (52 under 360 px wide). Small
buttons, segmented buttons, toggles and RIR chips look smaller and carry a pseudo-element that restores 44 px:
keep `position: relative` on them. Calendar days are 38 px discs on a 44 px pitch, so put the tap on the grid
cell.

**Set row.** `.set` is a 4-column grid (number, weight, reps, tick) with `.set-head` naming the columns once, so
fields hold only the number. States are classes on the row: `.done` (wells vanish, tick turns ink), `.next` (accent
outline and accent tick: this is the one thing to do), none (still to come). An empty reps box shows the goal as
its placeholder with the word "goal" under it, in CSS only (`:placeholder-shown`), and both go when a number is
typed. `.rir` sits under each set and is `.idle` until the set is ticked, so nothing below ever moves.

**Charts.** Inline SVG with the `.chart` classes: 2 px lines, r 4 to 5.5 dots with a 2 px surface ring, bars with
a 4 px round data end and a square foot, grid in `--line`, labels in ink tokens (text never takes the series
colour). The accent is the series; `--viz-mute` is context (last week). A deload is a hollow dot off the line.
Rings are two circles with `pathLength="100"`.

**Motion.** 120 ms for presses and ticks, 240 ms for sheets and toasts, all removed under
`prefers-reduced-motion`. Nothing animates between tapping a tick and the next set being ready.

**From today's class names.** `.set-row` becomes `.set` (a div grid instead of a table row), `.set-input` becomes
`label.numfield > input`, `.check` becomes `.tick`, `.rir-pick` / `.rir-btn` become `.rir` / `.rir button`,
`.choice-grid` becomes `.choices`, `.pill.pr` becomes `.tag.pr`, `.btn.ghost` / `.subtle` become plain `.btn`
(tonal) / `.btn.ghost`, `.btn.success` becomes `.btn.ink`, `.screen-title` becomes `.page-head`, `.tab-icon`
glyphs become `<svg class="i">`. `.ex-fold`, `.next-box`, `.choice`, `.card`, `.btn`, `.tab`, `.tabbar`,
`.topbar`, `.screen` keep their names. Put `icons.svg` inline once at the top of `<body>` and add a one-line
`icon(name)` helper for the HTML strings.

## The tab bar

Icons are drawn, labels are sentence case 10.5 px, the active tab is an accent icon over an ink label.

- **Overload, five:** Today, Program, Exercises, History, Settings. Food leaving turns six into five with no
  other change, so nothing the owner already reaches for moves. Each tab is at least 61 px wide at 320 px.
  Later, Exercises could fold into Program as a second view to make four, but not as part of this release.
- **Fuel, three:** Today, Trends, Settings. Adding food is an action, not a place: it stays on each meal, where
  the meal is already known. No tab was invented to fill the bar.

## Contrast, measured

WCAG 2 ratios from `tools/contrast.js`, with translucent fills composited first. Minimum 4.5 for text, 3 for
large text and essential marks. All 40 pairs pass in both themes.

| Pair | Dark | Light |
| --- | --- | --- |
| `--ink` on page / on card | 16.05 / 14.87 | 15.19 / 16.55 |
| `--ink-2` on card | 9.62 | 8.72 |
| `--ink-3` on page / card / fill over page (the worst case) | 6.79 / 6.29 / 5.74 | 5.41 / 5.90 / 4.81 |
| Text on an ink fill (ticked set, chosen chip) | 15.76 | 16.15 |
| Segmented control: chosen label on thumb / other labels on track | 7.97 / 8.78 | 16.97 / 7.11 |
| Overload: button text on ember | 5.84 | 5.30 |
| Overload: ember text on page / card / soft tint | 7.11 / 6.59 / 5.31 | 5.75 / 6.27 / 5.43 |
| Fuel: button text on herb | 9.31 | 6.08 |
| Fuel: herb text on page / card / soft tint | 10.74 / 9.95 / 7.34 | 6.33 / 6.90 / 5.90 |
| Accent fill against the card (ring, bar, icon): ember / herb | 5.38 / 8.99 | 5.40 / 6.17 |
| Rest dock: text / second line / ring (ember, herb) | 11.02 / 7.13 / 3.98, 6.66 | 15.02 / 9.31 / 5.67, 8.70 |
| Positive / warning / danger text on card | 9.22 / 9.10 / 7.05 | 6.26 / 5.95 / 6.82 |
| Danger on its tint (Reset) | 6.13 | 5.42 |
| Macro marks against the card: protein / carbs / fat | 3.65 / 5.72 / 5.24 | 5.56 / 3.09 / 4.84 |
| `--ink-4` marks on page / card | 3.40 / 3.15 | 3.19 / 3.48 |

The macro colours also pass the dataviz palette validator in both themes (lightness band, chroma, adjacent
colour-blind separation, normal-vision floor): worst pair clay and wheat, delta E 16.8 normal and 13.4 deutan in
light, 16.5 and 9.5 in dark. Every macro mark has its word beside it.

## What is still weak

- **Ember and danger are neighbours.** In Overload the destructive red sits close to the accent. Reset is told
  apart by its tinted fill, trash icon, wording and position at the very bottom, not by hue alone.
- **Fonts in the screenshots are stand-ins.** Chromium on Linux draws Inter for SF and Liberation Serif Italic
  for New York. Widths differ a little on the phone; the hero tracking (-0.045em) and the 4-across joint-pain
  chips are the two places to check on a real iPhone.
- **Not drawn:** the Exercises screen, the sleep chart, sets per muscle, the barcode camera, quick add and
  "fix the numbers" forms, cloud sync, WHOOP and reminders cards. They are meant to come from the same rows,
  fields, banners and chart classes, but nobody has looked at them yet.
- **The workout is tall.** With reps in reserve on, three sets fit above the rest dock at 390 x 844 and nothing
  more: the tools row and Finish are under the dock, and a four-set exercise always scrolls. It leans on the
  app's existing scroll-to-next-set. Under 360 px wide the dock drops its ring to keep the buttons at 44 px.
- **Dark theme, done marks.** Ticked sets and trained days are paper-coloured discs. Two or three in a workout
  are fine; a full month on History is the brightest thing on the screen in a dark gym. A softer done fill for
  dark is worth trying on the phone.
- **Charts are static.** One selected-point label is drawn to show the style; the tap layer that moves it is not
  built, and the calorie bars have no table view beyond the Averages card.
- **Carbs wheat is at the floor** against the light card (3.09:1), and clay and wheat are the closest pair.
- **The small plate mark** (two rings at 20 to 25 px) can read as a target. The grip slots that make the large
  icon a weight plate do not survive at tab size.
- **App icons** are SVG only and untested under the real iOS mask. `apple-touch-icon` needs PNGs rendered from
  `icon-overload.svg` and `icon-fuel.svg`.
- **Fuel's three tabs** look sparse on a 430 px wide phone.
