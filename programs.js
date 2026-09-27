/* Overload — built-in program library, shown on the Program tab.
 * Each program: days (name, exercises as [name, sets, reps, note]) and a Mon..Sun schedule of day indexes.
 * Exercise names match the app's library where one fits; any other name is added on first use with the
 * muscle and equipment below. "(FST-7)" names become their own 7-set exercise with short rest.
 */
(function () {
  'use strict';

  // Exercises the programs use that are not in the built-in library: name -> [muscle, equipment].
  window.__overloadProgramExercises = {
    'Smith Machine Bench Press': ['Chest', 'Machine'],
    'Machine Incline Press': ['Chest', 'Machine'],
    'Incline Dumbbell Fly': ['Chest', 'Dumbbell'],
    'Reverse-Grip Lat Pulldown': ['Back', 'Cable'],
    'Rack Pull': ['Back', 'Barbell'],
    'Back Extension': ['Back', 'Bodyweight'],
    'Machine Lateral Raise': ['Shoulders', 'Machine'],
    'Cable Front Raise': ['Shoulders', 'Cable'],
    'Cable Rear Delt Fly': ['Shoulders', 'Cable'],
    'Dumbbell Shrug': ['Shoulders', 'Dumbbell'],
    'Incline Dumbbell Skull Crusher': ['Triceps', 'Dumbbell'],
    'Wrist Curl': ['Forearms', 'Dumbbell'],
    'Reverse Wrist Curl': ['Forearms', 'Dumbbell'],
    'Smith Machine Squat': ['Quads', 'Machine'],
    'Standing Leg Curl': ['Hamstrings', 'Machine'],
    'Reverse Hack Squat': ['Glutes', 'Machine'],
    'Hip Adduction': ['Glutes', 'Machine']
  };

  // Days shared between programs.
  const CB_QUADS = { name: 'Quads', ex: [
    ['Hip Adduction', 2, '15', 'Warm-up, supersetted with light leg extensions'],
    ['Hack Squat', 4, '10–12', 'Deep, slow 3–4 s lowering'],
    ['Leg Press', 3, '8–12'],
    ['Smith Machine Squat', 3, '8–10'],
    ['Leg Extension', 3, '15–20', 'Rest-pause on the last set']] };
  const CB_CHEST_BACK = { name: 'Chest & Back', ex: [
    ['Incline Dumbbell Press', 2, '6–8', 'Superset with underhand pulldown. Every rep a 1¼ rep (extra quarter at the bottom)'],
    ['Reverse-Grip Lat Pulldown', 2, '6–8', '1¼ reps'],
    ['T-Bar Row', 2, '6–8', 'Superset with incline machine press. Long pause at the bottom'],
    ['Machine Incline Press', 2, '6–8'],
    ['Pec Deck', 4, '10–12', 'Superset with machine pullover. Hold the stretch 10–15 s before each set'],
    ['Machine Pullover', 4, '10–12']] };
  const CB_HAMS = { name: 'Hamstrings', ex: [
    ['Lying Leg Curl', 3, '10–12', 'Single-leg warm-ups first. Point the toes, slow negative, drop set on the last set'],
    ['Seated Leg Curl', 3, '8–12', 'Squeeze at the bottom, slow negative'],
    ['Romanian Deadlift', 3, '10–12'],
    ['Standing Leg Curl', 3, '10–12']] };

  const FST_LEGS = [
    ['Leg Extension', 3, '8–12'],
    ['Back Squat', 4, '8–10'],
    ['Hack Squat', 3, '8–10'],
    ['Leg Press (FST-7)', 7, '8–12'],
    ['Lying Leg Curl', 4, '8–12'],
    ['Romanian Deadlift', 3, '8–10'],
    ['Seated Leg Curl (FST-7)', 7, '8–12']];
  const FST_CALVES = [
    ['Standing Calf Raise', 3, '10–12'],
    ['Seated Calf Raise (FST-7)', 7, '10–12']];
  const FST_BICEPS = [
    ['Dumbbell Curl', 4, '8–12', 'Alternating'],
    ['Preacher Curl', 3, '8–12'],
    ['EZ-Bar Curl (FST-7)', 7, '8–12']];
  const FST_TRICEPS = [
    ['Close-Grip Bench Press', 3, '8–10'],
    ['Dips', 3, '8–12'],
    ['Overhead Triceps Extension', 3, '8–10'],
    ['Triceps Pushdown (FST-7)', 7, '8–10']];
  const FST_BACK = [
    ['Pull-Ups', 4, '8–12', 'Wide grip. Use the lat pulldown if you cannot get 8'],
    ['Barbell Row', 4, '8–12'],
    ['Seated Cable Row', 3, '8–12'],
    ['Straight-Arm Pulldown (FST-7)', 7, '10–12', 'Rope. FST-7: 7 sets, 45–60 s rest. Stretch the lats between sets']];
  const FST_SHOULDERS = [
    ['Seated Dumbbell Shoulder Press', 4, '10–12', '90 s rest'],
    ['Cable Front Raise', 3, '10–12', '90 s rest'],
    ['Dumbbell Lateral Raise', 3, '10–12', '45 s rest']];
  const FST_HOW = 'FST-7 (Fascia Stretch Training): 3–4 heavy exercises first, then one machine or cable exercise for 7 sets of 8–12 with 30–45 s rest (45–60 s for chest, back and legs). Stretch the muscle and sip water between the 7 sets; chase the pump, not a max. Each FST-7 exercise is its own entry in the app, always 7 sets, so its lighter weights never mix with your normal ones.';

  window.__overloadPrograms = [
    {
      id: 'cbum-5day', name: 'CBum 5-Day Split', by: 'Chris Bumstead',
      about: 'His classic split: back, chest, hamstrings, shoulders and quads each get their own day, arms ride along with chest and shoulders.',
      how: 'Compounds 3–4 sets of 8–12, isolation 10–15. Lower for 3–4 s and pause in the stretch. Take the last set of each exercise to failure. Add weight once you hit the top of the range on every set.',
      source: 'Jacked Gorilla and Fitness Documentation write-ups of his 5-day split; shoulder and quad days built from his posted sessions (Generation Iron, BarBend, Fitness Volt)',
      days: [
        { name: 'Back', ex: [
          ['Deadlift', 4, '5–10', 'Pyramid: 10, 8, 8, 5'],
          ['Barbell Row', 4, '8–12'],
          ['Wide-Grip Lat Pulldown', 4, '12–15'],
          ['Straight-Arm Pulldown', 4, '12–15'],
          ['One-Arm Dumbbell Row', 4, '10–15'],
          ['Seated Cable Row', 3, '15–20'],
          ['Back Extension', 2, '15–20']] },
        { name: 'Chest & Biceps', ex: [
          ['Incline Dumbbell Press', 5, '10–15', 'Sets of 15, 15, 12, 12, 10'],
          ['Smith Machine Bench Press', 4, '8–12'],
          ['Incline Dumbbell Fly', 3, '12–15'],
          ['Cable Fly', 3, '12–15'],
          ['Barbell Curl', 3, '8–12'],
          ['Preacher Curl', 3, '10–12'],
          ['Hammer Curl', 3, '10–12']] },
        { name: 'Hamstrings & Glutes', ex: [
          ['Lying Leg Curl', 4, '12–15', 'Last set to failure'],
          ['Romanian Deadlift', 4, '15–20'],
          ['Standing Leg Curl', 4, '8–10'],
          ['Reverse Hack Squat', 4, '15–20'],
          ['Cable Kickback', 3, '12–15']] },
        { name: 'Shoulders & Triceps', ex: [
          ['Machine Lateral Raise', 2, '12–15', 'Pre-exhaust'],
          ['Seated Dumbbell Shoulder Press', 2, '6–10', 'After warm-up sets, 2 heavy sets'],
          ['Dumbbell Lateral Raise', 3, '12–15', 'Drop set on the last set'],
          ['Cable Lateral Raise', 3, '12–15'],
          ['Rear Delt Fly', 3, '12–15'],
          ['Incline Dumbbell Skull Crusher', 3, '10–12'],
          ['Overhead Triceps Extension', 3, '10–12'],
          ['Triceps Pushdown', 3, '12–15']] },
        { name: 'Quads', ex: [
          ['Smith Machine Squat', 5, '8–10'],
          ['Hack Squat', 4, '10–12'],
          ['Leg Press', 4, '10–12'],
          ['Walking Lunge', 3, '12', '12 steps per leg'],
          ['Leg Extension', 3, '15–20', 'Rest-pause on the last set']] }
      ],
      schedule: [0, 1, 2, 3, 4, null, null]
    },
    {
      id: 'cbum-ppl', name: 'CBum Push/Pull/Legs', by: 'Chris Bumstead',
      about: 'His widely shared 6-day PPL: an A and B version of each day, one chest-led and one delt-led push, upper-lat and lower-lat pulls, a hamstring and a quad leg day.',
      how: 'Do 2–3 warm-up sets before the first lift. "40-second sets" means pick a weight and keep repping for 40 s. Rest under a minute on lateral raises. Last set to failure.',
      source: 'The "Chris Bumstead PPL" PDF, as written up by Bodybuilding Meal Plan and Fitness Volt',
      days: [
        { name: 'Push A (chest)', short: 'Push A', ex: [
          ['Flat Barbell Bench Press', 3, '5–8', '2 heavy sets of 5–8, then a back-off set of 10–12. Flat or incline'],
          ['Seated Dumbbell Shoulder Press', 3, '10–12', 'Alternating arms'],
          ['Cable Fly', 4, '10–12', 'Superset with overhead triceps extension'],
          ['Overhead Triceps Extension', 4, '7–10'],
          ['Dumbbell Lateral Raise', 4, '10–12', 'Under 1 min rest'],
          ['Dips', 3, '8–15', 'To failure']] },
        { name: 'Pull A (upper lats)', short: 'Pull A', ex: [
          ['Lat Pulldown', 3, '8–10', 'Drop set on the last set'],
          ['Barbell Row', 3, '6–8', '2 sets of 6–8, then 1 of 10–12'],
          ['Incline Dumbbell Curl', 4, '10–12'],
          ['Pull-Ups', 3, '6–12', 'To failure'],
          ['EZ-Bar Curl', 2, '8–10', 'Then 2 × 40-second sets']] },
        { name: 'Legs A (hamstrings)', short: 'Legs A', ex: [
          ['Walking Lunge', 3, '12–15', 'Per leg, after 3 bodyweight warm-up sets'],
          ['Romanian Deadlift', 3, '10–12'],
          ['Hip Thrust', 3, '10–12'],
          ['Seated Calf Raise', 6, '10–12'],
          ['Lying Leg Curl', 2, '8–10', 'Then 2 × 40-second sets']] },
        { name: 'Push B (delts)', short: 'Push B', ex: [
          ['Close-Grip Bench Press', 3, '8–10'],
          ['Overhead Press', 3, '10–12', 'Standing'],
          ['Pec Deck', 3, '8–10', '1 set of 8–10, then 2 × 40-second sets'],
          ['Overhead Triceps Extension', 3, '10–12'],
          ['Dumbbell Lateral Raise', 4, '10–12', 'Superset with push-ups'],
          ['Push-Ups', 3, '10–25', 'To failure']] },
        { name: 'Pull B (lower lats)', short: 'Pull B', ex: [
          ['Pull-Ups', 3, '6–12', 'To failure'],
          ['Rack Pull', 2, '8–10', 'After 3 warm-up sets'],
          ['Hammer Curl', 3, '10–12'],
          ['Reverse-Grip Lat Pulldown', 3, '10–12'],
          ['Cable Curl', 3, '10–12'],
          ['Seated Cable Row', 2, '15–20', 'Drop sets, about 20 reps in total each']] },
        { name: 'Legs B (quads)', short: 'Legs B', ex: [
          ['Back Squat', 3, '8–10', 'Then 1 heavy set of 4–6'],
          ['Leg Press', 2, '15–25', '40-second sets, superset with leg press calf raises'],
          ['Leg Press Calf Raise', 2, '12–20', 'To failure'],
          ['Hip Adduction', 4, '10–12'],
          ['Standing Calf Raise', 4, '10–12', 'Then bounce reps to failure'],
          ['Leg Extension', 2, '10–12', 'Then 2 triple drop sets']] }
      ],
      schedule: [0, 1, 2, 3, 4, 5, null]
    },
    {
      id: 'cbum-olympia', name: 'CBum Olympia Split', by: 'Chris Bumstead',
      about: 'His recent prep and off-season layout: quads, chest & back supersets, an arm day of tri-sets, then shoulders and a hamstring day. He runs it 3 days on, 1 off; here it is fitted to a week.',
      how: 'Few, very hard sets: 1¼ reps, long pauses and stretch holds on chest and back, tri-sets on arms with about 90 s between rounds. Slow 3–4 s lowering throughout.',
      source: 'Fitness Volt (2023 split), BarBend (chest & back video, Feb 2024; hamstring day with Hany Rambod), Breaking Muscle (arm day), Generation Iron',
      days: [
        CB_QUADS,
        CB_CHEST_BACK,
        { name: 'Arms', ex: [
          ['Triceps Pushdown', 4, '10–12', 'Tri-set: pushdown → overhead extension → incline skull crusher, then rest'],
          ['Overhead Triceps Extension', 4, '10–12'],
          ['Incline Dumbbell Skull Crusher', 4, '10–12'],
          ['Preacher Curl', 4, '10–12', 'Tri-set: preacher → cable curl → incline curl, then rest'],
          ['Cable Curl', 4, '10–12'],
          ['Incline Dumbbell Curl', 4, '10–12'],
          ['Hammer Curl', 3, '8–15', 'To failure']] },
        { name: 'Shoulders', ex: [
          ['Machine Shoulder Press', 3, '10–12'],
          ['Machine Lateral Raise', 3, '12–15', 'Drop set on the last set'],
          ['Seated Dumbbell Shoulder Press', 4, '8–15', 'Sets of 12, 10, 8, then 15'],
          ['Cable Lateral Raise', 3, '12–15'],
          ['Cable Front Raise', 3, '12–15'],
          ['Rear Delt Fly', 3, '15']] },
        CB_HAMS
      ],
      schedule: [0, 1, 2, null, 3, 4, null]
    },
    {
      id: 'cbum-arnold', name: 'CBum Arnold-Style Split', by: 'Chris Bumstead',
      about: 'Chest & back together, shoulders & arms together, legs, twice a week. His app has an Arnold-style program, but its day-by-day contents are behind a paywall; this one is built from his posted chest & back, arm, shoulder and leg sessions.',
      how: 'Day one of each pair is his superset style, day two is heavier straight sets. Last set to failure, slow lowering, add weight at the top of the range.',
      source: 'Built from the sessions in his other programs here (BarBend, Fitness Volt, Breaking Muscle); not his app\'s exact program',
      days: [
        CB_CHEST_BACK,
        { name: 'Shoulders & Arms', ex: [
          ['Machine Shoulder Press', 3, '8–12'],
          ['Dumbbell Lateral Raise', 3, '12–15', 'Drop set on the last set'],
          ['Rear Delt Fly', 3, '12–15'],
          ['Triceps Pushdown', 3, '10–12', 'Superset with preacher curl'],
          ['Preacher Curl', 3, '10–12'],
          ['Overhead Triceps Extension', 3, '10–12', 'Superset with incline curl'],
          ['Incline Dumbbell Curl', 3, '10–12']] },
        CB_QUADS,
        { name: 'Chest & Back (heavy)', ex: [
          ['Incline Barbell Bench Press', 4, '6–10'],
          ['Barbell Row', 4, '8–12'],
          ['Flat Dumbbell Press', 3, '8–12'],
          ['Wide-Grip Lat Pulldown', 3, '10–12'],
          ['Cable Fly', 3, '12–15'],
          ['Seated Cable Row', 3, '10–12']] },
        { name: 'Hamstrings & Glutes', ex: CB_HAMS.ex.concat([
          ['Hip Thrust', 3, '10–12'],
          ['Standing Calf Raise', 4, '10–15']]) }
      ],
      schedule: [0, 1, 2, 3, 1, 4, null]
    },
    {
      id: 'fst7-classic', name: 'FST-7 Classic 5-Day', by: 'Hany Rambod',
      about: 'The original FST-7 split from Flex: chest, legs, back, shoulders, arms, with calves twice and an FST-7 finisher for every muscle.',
      how: FST_HOW,
      source: 'Hany Rambod & Joe Wuebben, Flex (June 2011), via Muscle & Brawn; some day contents filled from Rambod\'s sample workouts',
      days: [
        { name: 'Chest & Abs', short: 'Chest', ex: [
          ['Incline Dumbbell Press', 4, '8–10'],
          ['Flat Dumbbell Press', 4, '8–10'],
          ['Machine Incline Press', 3, '8–10'],
          ['Pec Deck (FST-7)', 7, '8–12', 'Or cable crossover. FST-7: 7 sets, 45–60 s rest. Stretch the pecs between sets'],
          ['Cable Crunch', 3, '12–15']] },
        { name: 'Legs & Calves', short: 'Legs', ex: FST_LEGS.concat(FST_CALVES) },
        { name: 'Back & Abs', short: 'Back', ex: FST_BACK.concat([['Hanging Leg Raise', 3, '10–15']]) },
        { name: 'Shoulders & Traps', short: 'Shoulders', ex: FST_SHOULDERS.concat([
          ['Cable Rear Delt Fly (FST-7)', 7, '10–12', 'Bent over. FST-7: 7 sets, 30 s rest. Machine lateral raise works too'],
          ['Dumbbell Shrug', 4, '8–12'],
          ['Machine Crunch', 3, '12–15']]) },
        { name: 'Arms & Calves', short: 'Arms', ex: FST_BICEPS.concat(FST_TRICEPS, FST_CALVES) }
      ],
      schedule: [0, 1, 2, null, 3, 4, null]
    },
    {
      id: 'fst7-twice', name: 'FST-7 Arms & Calves Twice', by: 'Hany Rambod',
      about: 'Rambod\'s split for lagging small parts: biceps, triceps and calves get an FST-7 finisher twice a week, big muscles once.',
      how: FST_HOW,
      source: 'Rambod sample split via Simply Shredded, Fit Society and The Barbell',
      days: [
        { name: 'Arms & Calves', short: 'Arms', ex: FST_BICEPS.concat(FST_TRICEPS, FST_CALVES) },
        { name: 'Legs', ex: FST_LEGS },
        { name: 'Chest & Triceps', short: 'Chest', ex: [
          ['Incline Dumbbell Press', 4, '8–12'],
          ['Incline Dumbbell Fly', 3, '8–12'],
          ['Flat Dumbbell Press', 3, '8–12'],
          ['Pec Deck (FST-7)', 7, '8–12', 'Or cable crossover. FST-7: 7 sets, 45–60 s rest. Stretch the pecs between sets'],
          ['Skull Crushers', 3, '8–12'],
          ['Overhead Triceps Extension (FST-7)', 7, '8–12']] },
        { name: 'Back & Calves', short: 'Back', ex: FST_BACK.concat(FST_CALVES) },
        { name: 'Shoulders & Biceps', short: 'Shoulders', ex: FST_SHOULDERS.concat([
          ['Machine Lateral Raise (FST-7)', 7, '10–12', 'Rambod\'s favorite FST-7 shoulder move. 30 s rest'],
          ['Dumbbell Curl', 3, '8–12'],
          ['Cable Curl (FST-7)', 7, '8–12']]) }
      ],
      schedule: [0, 1, null, 2, 3, 4, null]
    },
    {
      id: 'fst7-heath', name: 'Phil Heath FST-7 Split', by: 'Phil Heath & Hany Rambod',
      about: 'The split Rambod ran with 7× Mr. Olympia Phil Heath: legs, chest & triceps, back & biceps, shoulders & traps, and a big arm day (16 sets each for biceps and triceps).',
      how: FST_HOW,
      source: 'SetForSet and Jacked Gorilla write-ups of Heath\'s routine; exercise-level detail is thin, so the days follow Rambod\'s standard FST-7 choices',
      days: [
        { name: 'Legs', ex: FST_LEGS.concat(FST_CALVES) },
        { name: 'Chest & Triceps', short: 'Chest', ex: [
          ['Incline Barbell Bench Press', 4, '8–12'],
          ['Flat Barbell Bench Press', 3, '8–12'],
          ['Incline Dumbbell Fly', 3, '10–12'],
          ['Cable Fly (FST-7)', 7, '10–12'],
          ['Triceps Pushdown', 3, '10–12'],
          ['Overhead Triceps Extension', 3, '10–12']] },
        { name: 'Back & Biceps', short: 'Back', ex: [
          ['Pull-Ups', 4, '8–12', 'Wide grip'],
          ['T-Bar Row', 4, '8–12'],
          ['One-Arm Dumbbell Row', 3, '8–12'],
          ['Straight-Arm Pulldown (FST-7)', 7, '10–12'],
          ['Barbell Curl', 3, '8–12'],
          ['Hammer Curl', 3, '10–12']] },
        { name: 'Shoulders & Traps', short: 'Shoulders', ex: [
          ['Seated Dumbbell Shoulder Press', 4, '8–12'],
          ['Dumbbell Lateral Raise', 3, '10–12'],
          ['Rear Delt Fly', 3, '10–12'],
          ['Machine Lateral Raise (FST-7)', 7, '10–12'],
          ['Dumbbell Shrug', 4, '8–12']] },
        { name: 'Arms', ex: [
          ['Barbell Curl', 3, '8–12'],
          ['Incline Dumbbell Curl', 3, '10–12'],
          ['Preacher Curl', 3, '10–12'],
          ['Cable Curl (FST-7)', 7, '10–12'],
          ['Close-Grip Bench Press', 3, '8–10'],
          ['Skull Crushers', 3, '8–12'],
          ['Overhead Triceps Extension', 3, '10–12'],
          ['Triceps Pushdown (FST-7)', 7, '10–12']] }
      ],
      schedule: [0, 1, null, 2, 3, 4, null]
    },
    {
      id: 'rp-arms', name: 'Arm Specialization (RP)', by: 'Renaissance Periodization',
      about: 'RP\'s "new blueprint for massive arms": arms three times a week (heavy, moderate, light), one biceps, one triceps and one forearm exercise each time, everything else at maintenance.',
      how: 'Heavy day 5–10 reps, moderate 10–20, light 20–30. Start around 3 reps in reserve and get closer to failure each week; the app adds sets when your pump and soreness say you recover. Run 4–6 weeks, then deload a week. RP takes arms toward 20–30 sets a week: raise Settings → weekly volume target if you want the app to go past 20.',
      source: 'RP Strength video guides "The New Blueprint for Massive Arms" and "The Ultimate Arm Growth Specialization Program"; maintenance days are a simple fill-in',
      days: [
        { name: 'Arms Heavy + Legs', short: 'Arms heavy', ex: [
          ['Close-Grip Bench Press', 4, '5–10'],
          ['EZ-Bar Curl', 4, '5–10'],
          ['Reverse Curl', 4, '5–10'],
          ['Hack Squat', 2, '8–12'],
          ['Lying Leg Curl', 2, '10–15']] },
        { name: 'Chest, Back & Delts', short: 'Upper', ex: [
          ['Incline Dumbbell Press', 2, '8–12'],
          ['Lat Pulldown', 2, '10–15'],
          ['Chest-Supported Row', 2, '10–15'],
          ['Machine Lateral Raise', 2, '15–20']] },
        { name: 'Arms Moderate', ex: [
          ['Overhead Triceps Extension', 4, '10–20'],
          ['Incline Dumbbell Curl', 4, '10–20'],
          ['Wrist Curl', 4, '10–20']] },
        { name: 'Legs & Delts', short: 'Lower', ex: [
          ['Leg Press', 2, '10–15'],
          ['Seated Leg Curl', 2, '10–15'],
          ['Machine Chest Press', 2, '8–12'],
          ['Cable Lateral Raise', 2, '15–20']] },
        { name: 'Arms Light', ex: [
          ['Triceps Pushdown', 4, '20–30'],
          ['Cable Curl', 4, '20–30'],
          ['Reverse Wrist Curl', 4, '20–30']] }
      ],
      schedule: [0, 1, 2, 3, 4, null, null]
    },
    {
      id: 'arms-fullbody', name: 'Full Body, Arms Emphasis', by: 'RP Hypertrophy app style',
      about: 'Five full-body days with a biceps and a triceps slot every day, the way the RP app lays out an "emphasize arms" program. Other muscles get about two slots a week.',
      how: 'Two sets per slot to start (about 10 arm sets a week each). Reps alternate heavier and lighter days. Start around 3 reps in reserve, get closer to failure each week, deload after 4–6 weeks. The app adds sets from your feedback.',
      source: 'Modeled on the RP Hypertrophy app\'s arm-emphasis templates and RP\'s arm volume guidelines; not RP\'s exact template, which is only in their app',
      days: [
        { name: 'Full Body 1', short: 'Day 1', ex: [
          ['Incline Dumbbell Press', 2, '8–12'],
          ['Lat Pulldown', 2, '10–15'],
          ['Hack Squat', 2, '8–12'],
          ['EZ-Bar Curl', 2, '8–12'],
          ['Skull Crushers', 2, '8–12']] },
        { name: 'Full Body 2', short: 'Day 2', ex: [
          ['Chest-Supported Row', 2, '10–15'],
          ['Romanian Deadlift', 2, '8–12'],
          ['Cable Lateral Raise', 2, '12–20'],
          ['Incline Dumbbell Curl', 2, '12–20'],
          ['Overhead Triceps Extension', 2, '12–20']] },
        { name: 'Full Body 3', short: 'Day 3', ex: [
          ['Machine Chest Press', 2, '8–12'],
          ['Leg Press', 2, '10–15'],
          ['Pull-Ups', 2, '6–12'],
          ['Preacher Curl', 2, '8–12'],
          ['Close-Grip Bench Press', 2, '8–12']] },
        { name: 'Full Body 4', short: 'Day 4', ex: [
          ['Seated Cable Row', 2, '10–15'],
          ['Lying Leg Curl', 2, '10–15'],
          ['Dumbbell Lateral Raise', 2, '12–20'],
          ['Cable Curl', 2, '12–20'],
          ['Triceps Pushdown', 2, '12–20']] },
        { name: 'Full Body 5', short: 'Day 5', ex: [
          ['Pec Deck', 2, '10–15'],
          ['Bulgarian Split Squat', 2, '8–12'],
          ['Wide-Grip Lat Pulldown', 2, '10–15'],
          ['Hammer Curl', 2, '8–12'],
          ['Dips', 2, '8–15']] }
      ],
      schedule: [0, 1, 2, 3, 4, null, null]
    },
    {
      id: 'arms-upperlower', name: 'Upper/Lower, Arms Emphasis', by: 'RP-style, 4 days',
      about: 'Four days a week with arms on every day, including leg days, which is how Mike Israetel suggests spreading arm work instead of one arm day.',
      how: 'Three sets per exercise to start (12 arm sets a week each). Heavier arm work on upper days, pump work on lower days. Deload after 4–6 weeks.',
      source: 'Built on RP\'s arm guidelines (Israetel: train arms 2–4× a week, add them to leg days); not an RP app template',
      days: [
        { name: 'Upper A', ex: [
          ['Incline Dumbbell Press', 3, '8–12'],
          ['Chest-Supported Row', 3, '10–12'],
          ['Cable Lateral Raise', 3, '12–20'],
          ['EZ-Bar Curl', 3, '8–12'],
          ['Skull Crushers', 3, '8–12']] },
        { name: 'Lower A + Arms', short: 'Lower A', ex: [
          ['Hack Squat', 3, '8–12'],
          ['Romanian Deadlift', 3, '8–12'],
          ['Leg Extension', 2, '12–15'],
          ['Standing Calf Raise', 3, '10–15'],
          ['Incline Dumbbell Curl', 3, '10–15'],
          ['Overhead Triceps Extension', 3, '10–15']] },
        { name: 'Upper B', ex: [
          ['Machine Chest Press', 3, '8–12'],
          ['Lat Pulldown', 3, '10–12'],
          ['Dumbbell Lateral Raise', 3, '12–20'],
          ['Preacher Curl', 3, '10–15'],
          ['Close-Grip Bench Press', 3, '8–12']] },
        { name: 'Lower B + Arms', short: 'Lower B', ex: [
          ['Leg Press', 3, '10–15'],
          ['Lying Leg Curl', 3, '10–15'],
          ['Bulgarian Split Squat', 2, '8–12'],
          ['Seated Calf Raise', 3, '12–20'],
          ['Cable Curl', 3, '15–20'],
          ['Triceps Pushdown', 3, '15–20']] }
      ],
      schedule: [0, 1, null, 2, 3, null, null]
    }
  ];
})();
