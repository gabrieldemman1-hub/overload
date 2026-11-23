# What the three judges said about the chosen direction (Instrument)

### Judge: gym-use
Problems found in Instrument:
- train-workout, done set rows: the weight and reps wells keep their outline (only dimmed to --rule-2), so the body of a done row looks like a pending row at arm's length; the 56 px tick square is the only strong 'done' cue. B tints the whole row and C removes the wells.
- train-workout, reps-in-reserve: the picked key is a 2 px frame on a slightly lighter key (.rir-btn.on), not a fill. Beside solid ticks it is the weakest 'chosen' state of the three.
- train-workout, labels: 'REPS LEFT' and the 'GOAL' hint are 9.5 px, tab labels 10 px (9.5 at 320), and 21 labels on this screen are 11 px. The word that separates a goal from a logged number is the smallest text in the app.
- All read-outs (set keys, rest timer, kcal dial): system monospace at weight 600 with a slashed zero (150, 2:00, RIR 0, 2,600). Thinner strokes than B's 700-800 rounded digits, and a slashed 0 can read as 8 at a glance. The README admits both points.
- train-workout, exercise header: what to lift is a 14 px sentence ('3 sets x 10-12 @ 150 lb - goal 12'); no number leads the card. Exercise index and elapsed time ('1/6 - 24:18') are small dim mono in the top bar and the SETS DONE 5/19 meter scrolls away.
- train-today: no hero number (admitted). Three equal 28 px stats (6 / 19 / 58 MIN) that are not what you need before lifting; 'Start as deload' and 'Start a different day' are bare text links.
- fuel-today: the tick dial spends about 235 px of height on one number, and the three macro bars are all neutral ink, so protein, carbs and fat are told apart only by reading an 11 px label.
- fuel-add: the + keys are outlined 44 px squares, the same shape as every other outlined control; kcal for a quick row is buried in the grey sub line instead of a number column.
- train-workout light theme: the rest dock is white on a near-white page with only a hairline and soft shadow, so the timer is less of an object than in dark.
- icons: both Home Screen icons are near-black graphite tiles with a small accent. On a dark wallpaper they merge with it and with each other in peripheral vision, and Overload's plates read as signal bars (admitted). Slowest of the three to find when pulling the phone out.
- train-settings, dark: every control outlined at 3:1 gives a wire-frame look (admitted), and the toast lands on top of a settings row.
Strengths to keep:
- train-workout: largest and most consistent controls, measured in the HTML: weight and reps keys 109x56 px, tick 56x56 px, reps-in-reserve keys 73x44 px (60x44 at 320). Every interactive element on every screen I measured is a real, painted 44 px or more at 390, 375 and 320 wide; it is the only direction with no exceptions.
- train-workout: best rest timer. 34 px digits (B 30, C 28), the full rest beside it (1:24 / 2:00), a full-width tick meter, and a docked full-width bar that sits on the tab bar instead of floating over rows. At 320 it drops the '/ 2:00' and keeps the digits and both 44 px buttons.
- State language does not depend on hue: solid ink = recorded, outline = tappable, accent = live. The next set gets an accent rail on the left edge, an accent set number and an accent-outlined tick; an empty reps box shows the goal dimmed with a GOAL label.
- fuel-today: 'kcal left' is a 64 px number and unmistakably the first thing seen; the first meal's full-width Add food key (358x44) is on the first screen; fuel-amount has a 56x70 stepper and a 56 px 'this adds' read-out.
- Four tabs in Overload (98 px each, 80 px at 320) and three in Fuel: the widest tab targets of the three directions.
- Nothing decorative: no gradients, glows, tiles or brand row; the top bar carries the screen title and is 96 px.
- Holds up best at 320: no sideways overflow, week strip goes full-bleed to keep 44 px cells, set keys stay 56 px tall, long names truncate instead of wrapping.
- train-feedback: joined 52 px answer keys with solid-ink selection and a 34 px next-time weight.
Ideas from the other directions worth grafting:
- From C (train-workout, .set.done): drop the wells on done set rows so recorded numbers are bare ink and the next row is the only boxed row. It fits A's own rule (outline = tappable, solid = recorded) and fixes A's weakest state.
- From B (train-workout, .ex-target): replace A's 14 px prescription sentence with a big target line, '150 lb x 12' at about 34 px, dropping to 28 px under 360 px wide so it does not wrap as B's does.
- From B: heavier digits without a slashed zero for set keys, rest timer and hero numbers (system rounded or system sans with tabular-nums at 700). Keep monospace only for small secondary read-outs if at all.
- From B and C (reps-in-reserve): make the picked key solid ink instead of A's 2 px frame, and separate the four keys with gaps as B does, keeping A's 44 px height.
- From C (rest dock): add the 'Set 3 of 3 next' context line, and in light theme invert the dock to a dark object so the timer stands out; keep A's docked full-width shape, 34 px digits and tick meter.
- From C (fuel-add): put Undo on the Added strip next to A's Done, and show kcal as a right-aligned number column on quick rows.
- From B (top bar): keep the per-exercise progress strip pinned under the top bar; A's sets-done meter scrolls away with the page.
- From C (train-feedback): lay the four-answer workload question out as a 2x2 grid of wide keys instead of four across.
- From B or C (app icons): fill each tile with the app's accent so the two apps can be found and told apart at a glance; C's weight plate and dinner plate with leaf say 'gym' and 'food' better than A's bars and B's bolt.
- Raise A's smallest text to B's floor: 'REPS LEFT' and the GOAL hint from 9.5 px to 11-12 px, tab labels from 10 px to 11 px.

### Judge: craft
Problems found in Instrument:
- fuel-today hero 1,278, fuel-trends 2,459, train-history 184.6 and 48.2k, rest dock 1:24: monospace gives the comma, point and colon a full cell, so every hero number has a hole in it (reads as 1 , 278).
- train-workout: weight box, reps box, tick, the four-up reps-left strip, +30s, Skip and the cards are all outlined rectangles of equal weight. Ticked rows keep the same boxes as editable ones, so the most-used screen reads as a wireframe.
- train-workout: the picked reps-left chip is a thick bright frame inside a hairline strip. It looks like a focus ring and contradicts solid ink for chosen on train-feedback and the segments.
- train-workout: the note chip (Seat 4, pin 7) has a dashed border and reads as an empty drop zone.
- train-workout prescription line and train-history weekly review rows: mono digits with slashed zeros inside sans sentences (3 sets x 10-12 @ 150 lb, Sleep avg 7h 08m), against the README's own rule.
- train-today: no hero; three equal 28 px read-outs. Start as deload and Start a different day are bare text with no edge, breaking outline means tappable. The solid tick box on the check-in line looks like a control.
- train-history calendar: a trained day is a 6 px square under the date, so a month of consistency does not read as a shape. Planned and missed share one hollow mark, and PR days are not marked.
- train-feedback: three stacked outlined segment frames plus the next-time box and tags look like a form spec.
- fuel-add: a column of eight identical outlined 44 px plus squares is heavier than the food names beside it.
- fuel-trends: the legend wraps and orphans the Target 2,600 line; the amber over-target caps are tiny.
- fuel-today light: volt lime becomes an ordinary mid green and the dial loses its charge, so Fuel in light is much less special than in dark.
- icons: both Home Screen icons are near-black tiles that lose their edge on a dark wallpaper and look like utilities. At 60 px Overload reads as signal bars or audio levels and Fuel as a speed test, neither as training or food, and the identifying colour covers roughly a tenth of the tile.
- Labels, top-bar titles, units and 10 px tab labels are all small tracked capitals. It is cold and tiring across a session, and wrong in tone for a food diary.
Strengths to keep:
- The most ownable identity: the tick-meter rest dock with 1:24 / 2:00 on train-workout, the ruled week strip with square marks on train-today, and the half-dial of ticks on fuel-today are signature objects nobody would mistake for another app.
- Strictest colour discipline: solid ink is recorded, outline is tappable, one signal colour is live or next. Charts are a neutral ramp with the accent only on the latest point, and macro bars are ink.
- Charts on train-history are the most disciplined: hairline grid, ink line, hollow deload dot off the line, mono axis labels, stat strip under the body-weight chart.
- True theme parity: light is the same instrument printed on paper, and every screen is equally finished in both.
- The apps are told apart by form as well as colour: straight meters and vermilion in Overload, the dial and volt lime in Fuel.
- Title lives in the top bar, so content starts at about 95 pt, the most economical header of the three.
- The active tab's top-edge accent indicator rhymes with the today underline on the week strip.
Ideas from the other directions worth grafting:
- From Instrument: show the full rest next to the countdown in the dock (1:24 / 2:00), and consider its tick-meter as the dock's progress instead of the small ring.
- From Instrument: put the screen title in the top bar and drop the separate brand wordmark row, at least on the workout screen, to recover about 100 pt of chrome.
- From Instrument: a top-edge accent indicator on the current tab (or Athletic's capsule), because Studio's current-tab state is too quiet.
- From Instrument and Athletic: one language for chosen. Use the ink fill for segmented controls too, so dark segments stop relying on a faint brown thumb.
- From Instrument: the principle of one signature read-out per app. Give Fuel Today an object as strong as Instrument's dial, for example the calorie progress drawn as the rim of the dinner plate so icon, mark and hero are one shape.
- From Instrument: mark days over target on the Fuel trends chart (its amber cap), and add its stat strip under the body-weight chart (latest, 7-entry average, 30-day change).
- From Instrument: neutral series with the accent only on the latest point as the rule for any chart that gains a second series.
- From Athletic: show the Overload app tile inside the Paste from Overload row on Fuel's welcome screen instead of a generic clipboard icon.
- From Athletic: the tapped-bar state with a tooltip pill for the calorie bars.
- From Athletic: the workout name under each day of the week strip (Push, Pull, Legs), if it fits without crowding the discs.
- From Athletic, as a principle: a softer done state in dark. Lower the luminance of ticked-set and trained-day discs so the ember next tick and today stay the brightest marks.
- From both: different silhouettes for the two Home Screen icons. Enlarge the leaf and drop the ghost ring on Fuel, and give the Overload plate heavier grip slots or a bar through it so it stops reading as a record and the two are not both a circle in a tile.

### Judge: build
Problems found in Instrument:
- Every screen: the monospace-numeral look depends on wrapping numbers in .num and units in .u throughout app.js and food.js (README step 6). Component rules cover set inputs, stats, macros and the rest clock, but the Today plan rows ('60 x12'), the last-time line, folded-exercise sub lines and history sets need new spans. Any miss gives mixed mono and sans numerals on the same screen.
- All eleven mock screens lean on 136 inline style nudges (61 unique): margin-top:6px twelve times, font-weight:500 nine times, font-size:64px on the fuel-today hero, negative margins on icon buttons. These are not in ui.css, several break the README's own 4 px grid, and the implementer must turn them into classes or the app will not match the shots.
- train-workout: the 'GOAL' hint under the reps box and the 'REPS LEFT' label are 9.5 px; tab labels and chart axis labels are 10 px. Too small for a phone read at arm's length in a gym.
- fuel-today and fuel-add: the food row sub line (.f-row .sub) is nowrap with ellipsis, so a long serving name cuts off the macros. train-workout at 320 px: the folded exercise name truncates to 'Incline Dumbbell...', which hides the word that tells two exercises apart.
- Top bar on every screen: the screen's h1 is removed and its buttons move into #topbar-right (nine render sites in app.js and food.js), the brand text must be wrapped in a span for the ellipsis to work, and no h1 is left on the page.
- fuel-today gauge: the needle (.gauge-mark) needs its endpoint computed in JavaScript, and no state is drawn for a day with no target (targets may be empty per the app README) or for a day over target. The hero also changes meaning from kcal eaten to kcal left.
- icons, Home Screen row on the dark wallpaper: both app icons are near-black tiles, so the tile edge disappears and the two apps differ only by a small glyph; the Overload mark reads as signal bars.
- Forms: the .select chevron is a data-URI SVG with the dark theme's #8a9199 hard-coded, so it does not follow the theme. Light --ink-4 is 2.57:1 and is used for the disabled stepper glyph and the empty-state icon.
- train-workout rest dock: .rest-bar-fill animates width inside a CSS mask for the whole rest period, a continuous repaint of a small strip; transform would avoid it.
- train-today, train-program and train-workout bundle behaviour changes into the look: four tabs with Exercises folded into Program, upcoming exercises folded shut, the check-in line moved above the workout. Each needs a decision and JavaScript beyond a stylesheet swap.
- train-settings: the toast lands on top of the 'Weight jump: barbell' row. ui.css is 56 KB against 29.6 KB today. Not drawn: the Exercises list, Fuel Settings, the scanner, search results, the soreness check-in.
Strengths to keep:
- Smallest markup change by a wide margin: ui.css still styles 190 of the 203 class names in today's styles.css, only 12 of the 862 class attributes in app.js/food.js/connector.js/index.html (1%) carry a class it drops, 13 of the 14 classes the app's own JS selects on and all 31 classes the smoke and baseline tests select on survive. The mockups use the app's real DOM (table.set-table, tr.set-row, input.set-input, button.check, #rest-timer).
- Best accessibility of the three, measured from tokens.css and from the rendered shots. Every text pair passes AA in both themes and both apps (tightest: Fuel light button label 4.83, Overload light accent text on its wash on the page 4.65, the light PR pill 4.61 as rendered). It is the only direction where every tappable control has a real boundary: the --edge outline is 3.2 to 3.7:1 on page, panel and input fill in both themes.
- Token system is complete and explicit: both themes, both apps including a dedicated Fuel-light block, status colours with separate ink and wash values, a neutral chart ramp, type and numeral scales, and the same data-theme plus .system-light mechanism the app uses today. The README gives an old-to-new token map (--card to --panel, --muted to --ink-3 and so on).
- Covers the most of the existing app: sets per muscle, sleep chart, past-set rows, review list, deload switch, warm-up block, cardio card, the fixed save-warning banner with its body.has-save-warning offset, barcode scan view, drag ghost and drop line, sync-pill states, rest-timer over state, and the toast moves up when the rest dock is showing. No new body or screen classes are needed for the rest dock.
- Cheapest to paint alongside C: no shadow on any card or row, the same two blurred bars the app has today, no decorative gradients. All four safe-area insets are handled, :focus-visible is defined, inputs that drop the outline get a border plus ring, and reduced motion switches everything off.
- Holds up with real names: the week strip shows dates and marks only, the Program schedule uses A/B/C letter tags instead of day names, and the top-bar title has an ellipsis rule. Real day names in programs.js run to 'Legs B (hamstrings & glutes)'.
- Ships an audit tool (tools/shoot.js) that checks every page for sideways overflow, clipped text, tap targets under 44 px and contrast as rendered, which can be pointed at the real app after the restyle.
Ideas from the other directions worth grafting:
- From B and C: write the food row sub line as two nowrap spans (amount, then macros) that wrap as whole units, replacing A's single nowrap-plus-ellipsis line on fuel-today and fuel-add.
- From C: let row titles wrap (overflow-wrap: anywhere) instead of truncating, for folded exercise rows and list rows, so 'Incline Dumbbell Press' never becomes 'Incline Dumbbell...'.
- From B: the floor on type size (nothing under 11 px). Raise A's 9.5 px 'GOAL' hint and 'REPS LEFT' label and its 10 px tab and chart labels.
- From B: draw the .select chevron from tokens with CSS gradients so it follows the theme, replacing A's data-URI SVG with a hard-coded dark grey.
- From B: the class-only discipline and the state classes on the components page (.is-pressed, .is-focus, .is-disabled). Fold A's 61 unique inline nudges into named classes before the stylesheet goes into the app.
- From B: '.set-input:disabled { opacity: 1; -webkit-text-fill-color: var(--ink) }' so disabled set fields stay readable on iOS.
- From B and C: keep five tabs and the per-screen h1 for this release, and defer A's four-tab layout and the title move into the top bar until after the split has shipped.
- From C: make data-app work on any element, so Overload's 'Food now lives in Fuel' card and Fuel's 'Paste from Overload' row can show the other app's accent without one-off colours.
- From C or B: accent-coloured Home Screen tiles (ember and herb, or Heat and Fresh) carrying A's plate and gauge glyphs, in place of A's two near-black tiles that vanish on a dark wallpaper.
- From B: the token layering where the app block sets only raw accent values and the theme blocks derive the rest, which would remove A's separate Fuel-light block.
- From C: declare animations only under prefers-reduced-motion: no-preference, on top of A's blanket override.

