// Builds the mockup pages (static HTML) from template strings, the same way the app builds its screens.
// Run: node tools/make.mjs   (writes ../*.html). No dependencies.
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ic = (name, cls = '') => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="icons.svg#i-${name}"/></svg>`;
const fmt = (n) => n.toLocaleString('en-US');

// ---------- shell ------------------------------------------------------------------------------
const STATUS = `<div class="mock-status" aria-hidden="true"><span>9:41</span><svg viewBox="0 0 68 12"><rect x="0" y="7" width="3" height="5" rx="1"/><rect x="5" y="5" width="3" height="7" rx="1"/><rect x="10" y="2.5" width="3" height="9.5" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/><path d="M31 2.2c2.3 0 4.4.9 6 2.4l-1.3 1.4a6.8 6.8 0 0 0-9.4 0L25 4.6a8.7 8.7 0 0 1 6-2.4zm0 3.8c1.3 0 2.5.5 3.4 1.4L31 11l-3.4-3.6c.9-.9 2.1-1.4 3.4-1.4z"/><rect x="43.5" y="0.5" width="21" height="11" rx="3.2" fill="none" stroke="currentColor" opacity=".45"/><rect x="45.5" y="2.5" width="15" height="7" rx="1.6"/><rect x="65.5" y="4" width="1.8" height="4" rx=".9" opacity=".5"/></svg></div>`;
const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="g-mark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--m1)"/><stop offset="1" style="stop-color:var(--m2)"/></linearGradient>
</defs></svg>`;

const TABS = {
  overload: [['today', 'Today', 'dumbbell'], ['program', 'Program', 'calendar'], ['exercises', 'Exercises', 'list'], ['history', 'History', 'chart'], ['settings', 'Settings', 'gear']],
  fuel: [['today', 'Today', 'fork'], ['trends', 'Trends', 'chart'], ['settings', 'Settings', 'gear']],
};
const tabbar = (app, active) => `<nav class="tabbar">${TABS[app].map(([id, label, icon]) =>
  `<button class="tab${id === active ? ' active' : ''}" data-screen="${id}"><span class="tab-icon">${ic(icon)}</span>${label}</button>`).join('')}</nav>`;

const BRAND = { overload: ['Overload', 'dumbbell'], fuel: ['Fuel', 'bolt'] };
const topbar = (app, { title, right = '', progress = '' } = {}) => `<header class="topbar"><div class="topbar-inner">
  <div class="brand"><span class="brand-mark">${ic(BRAND[app][1])}</span>${title || BRAND[app][0]}</div>
  <div class="topbar-right">${right}</div></div>${progress}</header>`;
const SYNCED = `<span class="pill sync-pill synced">${ic('cloud')}Synced</span>`;

function page({ file, app, title, body, tab, top = {}, bodyClass = '', after = '', screenClass = '', bare = false }) {
  const html = `<!doctype html>
<html lang="en" data-app="${app}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="ui.css">
<link rel="stylesheet" href="mock.css">
<script>
  // Mockup theme switch: add ?theme=light to the URL. Default is dark.
  var t = new URLSearchParams(location.search).get('theme');
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
</script>
</head>
<body class="${bodyClass}">
${DEFS}
${STATUS}
${bare ? '' : topbar(app, top)}
<main id="app" class="screen ${screenClass}">
${body}
</main>
${after}
${tab ? tabbar(app, tab) : ''}
<div class="mock-home" aria-hidden="true"></div>
</body>
</html>
`;
  writeFileSync(join(OUT, file), html);
  console.log('wrote', file);
}

// ---------- chart helpers ----------------------------------------------------------------------
const r1 = (n) => Math.round(n * 10) / 10;
function scale(d0, d1, r0, r1_) { return (v) => r0 + (v - d0) / (d1 - d0) * (r1_ - r0); }
// Column with a 4 px rounded data end and a square foot on the baseline.
function column(x, y, w, base, r = 4) {
  const h = base - y; if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${r1(x)} ${r1(base)}V${r1(y + rr)}a${rr} ${rr} 0 0 1 ${rr}-${rr}h${r1(w - 2 * rr)}a${rr} ${rr} 0 0 1 ${rr} ${rr}V${r1(base)}z`;
}

// =================================================================================================
// OVERLOAD
// =================================================================================================
const PUSH = [
  ['Cable Fly', 'Chest', 'Cable', 3, '10–12', 30, 11],
  ['Machine Chest Press', 'Chest', 'Machine', 3, '10–12', 150, 12],
  ['Machine Shoulder Press', 'Shoulders', 'Machine', 3, '10–12', 90, 10, 5],
  ['Cable Lateral Raise', 'Shoulders', 'Cable', 4, '12–15', 15, 13],
  ['Triceps Pushdown', 'Triceps', 'Cable', 3, '10–12', 55, 10, 5],
];
const PULL = [
  ['Lat Pulldown', 'Back', 'Cable', 3, '10–12'], ['Seated Cable Row', 'Back', 'Cable', 3, '10–12'],
  ['Straight-Arm Pulldown', 'Back', 'Cable', 3, '12–15'], ['Rear Delt Fly', 'Shoulders', 'Machine', 3, '12–15'],
  ['Cable Curl', 'Biceps', 'Cable', 3, '10–12'], ['Preacher Curl', 'Biceps', 'Machine', 2, '10–12'],
];
const WEEK = [['M', 'Mon', 16, 'Push', 'done'], ['T', 'Tue', 17, 'Pull', 'done'], ['W', 'Wed', 18, 'Legs', 'done'], ['T', 'Thu', 19, 'Push', 'today'], ['F', 'Fri', 20, 'Pull', 'planned'], ['S', 'Sat', 21, 'Legs', 'planned'], ['S', 'Sun', 22, 'Rest', 'rest']];

// ---------- train-today ------------------------------------------------------------------------
page({
  file: 'train-today.html', app: 'overload', title: 'Overload · Today', tab: 'today', top: { right: SYNCED },
  body: `
<div class="screen-title">
  <div><div class="cap">Thu, Nov 19</div><h1>Today</h1></div>
  <span class="pill lg accent">${ic('flame')}12 day streak</span>
</div>

<div class="day-strip" aria-label="This week">
  ${WEEK.map(([l, , , name, st]) => `<button class="day-chip ${st}"><span>${l}</span><span class="mark">${st === 'done' ? ic('check') : ''}</span><span class="tagline">${name}</span></button>`).join('\n  ')}
</div>

<div class="card pad0"><div class="fold-row">
  <span class="tile sm ok">${ic('check')}</span>
  <span class="grow"><span class="fold-k">Check-in</span>
    <span class="fold-v">${ic('scale', 's16')}<b class="num">182.4</b> lb<i></i>${ic('moon', 's16')}<b class="num">7h 12m</b></span></span>
  <button class="link muted" data-action="edit-checkin">Edit</button>
</div></div>

<section class="card hero lit">
  <div class="row between"><span class="cap">Today's workout</span><span class="pill">${ic('timer')}about 55 min</span></div>
  <div class="display-num mt8" style="font-size:48px">Push</div>
  <p class="soft small mt4">Chest, shoulders, triceps</p>
  <div class="stat-row mt16">
    <div class="stat"><div class="v">5</div><div class="k">Exercises</div></div>
    <div class="stat"><div class="v">16</div><div class="k">Sets</div></div>
    <div class="stat"><div class="v ok-text">+2</div><div class="k">Weights up</div></div>
  </div>
  <button class="btn lg block mt16" data-action="start">${ic('play')}Start workout</button>
  <div class="list mt12">
    ${PUSH.map(([n, , , s, r, w, g, up]) => `<div class="list-row compact"><span class="grow"><span class="title">${n}</span></span>${up ? `<span class="delta good">${ic('arrow-up')}${up} lb</span>` : ''}<span class="val">${w} lb<small>${s} × ${r} · goal ${g}</small></span></div>`).join('\n    ')}
    <div class="list-row compact"><span class="grow"><span class="title">Incline treadmill walk</span></span><span class="val">20 min<small>cardio</small></span></div>
  </div>
  <div class="row between mt8"><button class="link muted">Start as deload</button><button class="link muted">Start a different day</button></div>
</section>
`,
});

// ---------- train-workout / train-feedback ------------------------------------------------------
const wkTop = (elapsed, states) => ({
  title: `Push <span class="elapsed">${elapsed}</span>`,
  right: `<button class="btn small ghost" data-action="finish">Finish</button>`,
  progress: `<div class="topbar-progress" aria-label="Workout progress">${states.map((s) => `<i class="${s}"></i>`).join('')}</div>`,
});
const foldDone = (name, sub, pr) => `<div class="card ex-card done compact"><button class="ex-fold" data-action="open-entry">
  <span class="ex-fold-tick">${ic('check')}</span>
  <span class="grow"><span class="ex-fold-name">${name}</span><span class="ex-fold-sub">${sub}</span></span>
  ${pr ? `<span class="pill pr">${ic('trophy')}PR</span>` : ''}${ic('chev-r', 'chev')}
</button></div>`;
const foldNext = (n, name, sub, up) => `<div class="card ex-card compact"><button class="ex-fold" data-action="open-entry">
  <span class="ex-fold-n">${n}</span>
  <span class="grow"><span class="ex-fold-name">${name}</span><span class="ex-fold-sub">${sub}</span></span>
  ${up ? `<span class="delta good">${ic('arrow-up')}${up} lb</span>` : ''}${ic('chev-d', 'chev')}
</button></div>`;
const rirRow = (picked, idle) => `<tr class="rir-row${idle ? ' idle' : ''}"${idle ? ' aria-hidden="true"' : ''}><td colspan="4"><div class="rir-pick"><span class="rir-label">Reps left</span>${['3+', '2', '1', '0'].map((v) => `<button class="rir-btn${v === picked ? ' on' : ''}"${idle ? ' tabindex="-1" disabled' : ''}>${v}</button>`).join('')}</div></td></tr>`;
const setRow = (n, w, reps, state, goal) => `<tr class="set-row ${state}">
        <td class="n">${n}</td>
        <td><input class="set-input" type="number" inputmode="decimal" value="${w}" placeholder="lb" aria-label="Set ${n} weight"></td>
        <td><input class="set-input" type="number" inputmode="numeric" value="${reps}" placeholder="${goal}" aria-label="Set ${n} reps"></td>
        <td class="chk"><button class="check${state === 'done' ? ' on' : ''}" aria-label="Set ${n} done" aria-pressed="${state === 'done'}">${ic('check')}</button></td>
      </tr>`;
const upcoming = `
${foldNext(3, 'Machine Shoulder Press', '3 × 10–12 · 90 lb', 5)}
${foldNext(4, 'Cable Lateral Raise', '4 × 12–15 · 15 lb')}
${foldNext(5, 'Triceps Pushdown', '3 × 10–12 · 55 lb', 5)}
<section class="card" id="cardio-card">
  <div class="card-head"><div class="row"><span class="tile soft">${ic('heart')}</span><div><h2>Incline treadmill walk</h2><div class="meta">20 min after lifting</div></div></div></div>
  <div class="field-row">
    <div class="field"><label>Incline %</label><input class="input num" type="number" inputmode="decimal" value="10"></div>
    <div class="field"><label>Speed mph</label><input class="input num" type="number" inputmode="decimal" value="3.2"></div>
  </div>
  <div class="btn-row"><button class="btn ghost">${ic('timer')}Start 20:00</button><button class="btn subtle">Done</button></div>
</section>
<button class="btn lg block ghost" data-action="finish">Finish workout</button>`;

page({
  file: 'train-workout.html', app: 'overload', title: 'Overload · Workout', tab: 'today', bodyClass: 'has-rest', screenClass: 'in-workout',
  top: wkTop('18:42', ['done', 'now', '', '', '', '']),
  body: `
${foldDone('Cable Fly', '3 sets · next 35 lb', true)}

<section class="card ex-card" data-card="1">
  <div class="ex-head">
    <div class="row between">
      <div class="grow"><div class="ex-kicker">Chest · Machine · 2 of 5</div><div class="ex-name">Machine Chest Press</div></div>
      <button class="icon-btn plain" aria-label="Swap, remove, edit exercise">${ic('more')}</button>
    </div>
    <div class="ex-target" aria-label="Target: 150 pounds for 12 reps"><span class="big">150</span><span class="u">lb</span><span class="x">×</span><span class="big">12</span><span class="u">reps · 3 sets of 10–12</span></div>
    <div class="ex-meta">
      <span class="ex-note">${ic('edit')}Seat 4, pin 7</span>
      <span class="ex-last">${ic('clock')}Last time: 150 × 12, 12, 11</span>
    </div>
  </div>
  <div class="ex-body">
    <table class="set-table">
      <thead><tr><th class="n">Set</th><th>lb</th><th>Reps</th><th class="chk"></th></tr></thead>
      <tbody>
      ${setRow(1, 150, 12, 'done', 12)}
      ${rirRow('2')}
      ${setRow(2, 150, 12, 'done', 12)}
      ${rirRow('1')}
      ${setRow(3, 150, '', 'next', 12)}
      ${rirRow(null, true)}
      </tbody>
    </table>
    <div class="set-tools">
      <button class="btn small ghost">${ic('plus')}Set</button>
      <button class="btn small ghost">${ic('minus')}Set</button>
      <button class="btn small ghost">Warm-up</button>
    </div>
    <button class="btn block ghost mt12" data-action="finish-entry">Finish exercise</button>
  </div>
</section>
${upcoming}
`,
  after: `<div id="rest-timer" class="rest-timer" role="timer" aria-label="Rest timer">
  <div class="rest-timer-inner">
    <span class="rest-icon">${ic('timer')}</span>
    <div><div class="rest-label">Rest</div><div id="rest-time" class="rest-time">1:24</div></div>
    <div class="rest-actions"><button class="btn ghost small" data-action="rest-add">+30s</button><button class="btn ghost small" data-action="rest-skip">Skip</button></div>
  </div>
  <div class="rest-bar"><div id="rest-bar-fill" class="rest-bar-fill" style="width:70%"></div></div>
</div>`,
});

const choices = (label, opts, on, cols) => `<div class="q-label">${label}</div>
      <div class="choice-grid ${cols}">${opts.map((o, i) => `<button class="choice${i === on ? ' on' : ''}" aria-pressed="${i === on}">${o}</button>`).join('')}</div>`;
page({
  file: 'train-feedback.html', app: 'overload', title: 'Overload · Exercise finished', tab: 'today', screenClass: 'in-workout',
  top: wkTop('24:10', ['done', 'done', 'now', '', '', '']),
  body: `
${foldDone('Cable Fly', '3 sets · next 35 lb', true)}

<section class="card ex-card done" data-card="1">
  <div class="ex-head">
    <div class="row between">
      <div class="grow"><div class="ex-kicker">Chest · Machine · finished</div><div class="ex-name">Machine Chest Press</div></div>
      <span class="pill pr is-new">${ic('trophy')}PR</span>
    </div>
    <div class="ex-presc"><strong>150 lb</strong> × 12, 12, 12 · most reps at 150 lb</div>
  </div>
  <div class="ex-body">
    <div class="next-box up">
      <div class="row between"><span class="cap">Next time</span><span class="pill ok">${ic('arrow-up')}5 lb</span></div>
      <div class="next-main"><span class="big">155</span><span class="u">lb</span><span class="headline">goal 10</span></div>
      <ul><li>Hit 12 on every set → +5 lb, aim for 10</li><li>3 × 10–12, sets follow your answers below</li></ul>
    </div>
    <div class="prompt">
      <div class="prompt-q">How was it? <span class="hint">Optional, adjusts your sets</span></div>
      ${choices('Pump', ['Low / none', 'Moderate', 'Amazing'], 1, 'c3')}
      ${choices('Joint pain', ['None', 'A little', 'Moderate', 'A lot'], 0, 'c4')}
      ${choices('Workload', ['Easy', 'Pretty good', 'Pushed my limits', 'Too much'], 1, 'c4')}
    </div>
    <div class="card-actions"><button class="btn small subtle">${ic('edit')}Edit sets</button><button class="btn small subtle">Hide</button></div>
  </div>
</section>
${upcoming}
`,
});

// ---------- train-history ------------------------------------------------------------------------
function calendar() {
  const hit = new Set([2, 3, 5, 6, 7, 9, 10, 11, 12, 13, 14, 16, 17, 18]), pr = new Set([10, 14, 17]), miss = new Set([4]);
  const cells = [];
  for (let i = 0; i < 6; i++) cells.push('<span class="cal-cell empty"></span>');
  for (let d = 1; d <= 30; d++) {
    const dow = (d + 5) % 7;   // Nov 1 2026 is a Sunday; Monday-first grid
    let cls = d > 19 ? 'future' : dow === 6 ? 'rest' : '';
    if (hit.has(d)) cls = 'hit'; if (miss.has(d)) cls = 'miss'; if (d === 19) cls = 'today'; if (pr.has(d)) cls += ' pr';
    cells.push(`<button class="cal-cell ${cls}">${d}</button>`);
  }
  return `<div class="cal-grid">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span class="cal-head">${x}</span>`).join('')}\n    ${cells.join('')}</div>`;
}
function progressChart() {
  const pts = [['Oct 12', 185], ['Oct 15', 189], ['Oct 19', 187], ['Oct 22', 191], ['Oct 26', 196], ['Oct 29', 193], ['Nov 2', 173, 'deload'], ['Nov 5', 203], ['Nov 9', 200], ['Nov 12', 203], ['Nov 16', 205]];
  const W = 326, H = 168, L = 30, R = 20, T = 16, B = 24;
  const x = scale(0, pts.length - 1, L + 6, W - R), y = scale(170, 210, H - B, T);
  const line = pts.map((p, i) => [x(i), y(p[1]), p[2]]).filter((p) => !p[2]);
  const d = line.map((p, i) => (i ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1])).join('');
  const area = d + `L${r1(line[line.length - 1][0])} ${H - B}L${r1(line[0][0])} ${H - B}z`;
  const last = line[line.length - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated one-rep max for Machine Chest Press, 185 lb on Oct 12 rising to 205 lb on Nov 16">
    ${[170, 180, 190, 200, 210].map((v) => `<line class="grid" x1="${L}" x2="${W - 4}" y1="${r1(y(v))}" y2="${r1(y(v))}"/><text class="lbl" x="${L - 6}" y="${r1(y(v) + 3.5)}" text-anchor="end">${v}</text>`).join('')}
    <path class="area" d="${area}"/><path class="line" d="${d}"/>
    ${pts.map((p, i) => i === pts.length - 1 ? '' : `<circle class="pt${p[2] ? ' deload' : ''}" cx="${r1(x(i))}" cy="${r1(y(p[1]))}" r="${p[2] ? 4 : 4.5}"/>`).join('')}
    <circle class="pt end" cx="${r1(last[0])}" cy="${r1(last[1])}" r="6.5"/>
    <text class="lbl strong" x="${r1(last[0] + 1)}" y="${r1(last[1] - 12)}" text-anchor="end">205</text>
    <text class="lbl" x="${r1(x(6) + 9)}" y="${r1(y(173) + 3.5)}">deload</text>
    ${[0, 5, 10].map((i) => `<text class="lbl" x="${r1(x(i))}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 10 ? 'end' : 'middle'}">${pts[i][0]}</text>`).join('')}
  </svg>`;
}
function weightChart() {
  // 30 daily weigh-ins (two skipped) and their 7-day running average
  const noise = [0.5, -0.3, 0.8, 0.1, -0.6, 0.4, 0.9, -0.2, 0.3, -0.7, 0.6, 0.0, -0.4, 0.7, 0.2, -0.5, 0.3, 0.8, -0.6, 0.1, 0.5, -0.3, -0.8, 0.4, 0.2, -0.2, 0.6, -0.5, 0.1, -0.1];
  const days = noise.map((n, i) => (i === 8 || i === 21) ? null : r1(184.5 - i * 0.068 + n));
  const avg = days.map((_, i) => { const w = days.slice(Math.max(0, i - 6), i + 1).filter((v) => v != null); return w.reduce((a, b) => a + b, 0) / w.length; });
  const W = 326, H = 150, L = 30, R = 16, T = 12, B = 24;
  const x = scale(0, 29, L + 6, W - R), y = scale(181, 186, H - B, T);
  const d = avg.map((v, i) => (i ? 'L' : 'M') + r1(x(i)) + ' ' + r1(y(v))).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Body weight over 30 days: the 7-day average falls from 184.4 to 182.6 lb">
    ${[182, 184, 186].map((v) => `<line class="grid" x1="${L}" x2="${W - 4}" y1="${r1(y(v))}" y2="${r1(y(v))}"/><text class="lbl" x="${L - 6}" y="${r1(y(v) + 3.5)}" text-anchor="end">${v}</text>`).join('')}
    ${days.map((v, i) => v == null ? '' : `<circle class="pt faint" cx="${r1(x(i))}" cy="${r1(y(v))}" r="2.6"/>`).join('')}
    <path class="line avg" d="${d}"/>
    <circle class="pt end" cx="${r1(x(29))}" cy="${r1(y(avg[29]))}" r="6.5"/>
    <text class="lbl" x="${L + 6}" y="${H - 6}">Oct 21</text><text class="lbl" x="${r1(x(14))}" y="${H - 6}" text-anchor="middle">Nov 4</text><text class="lbl" x="${W - R}" y="${H - 6}" text-anchor="end">Today</text>
  </svg>`;
}
page({
  file: 'train-history.html', app: 'overload', title: 'Overload · History', tab: 'history', top: { right: SYNCED },
  body: `
<div class="screen-title"><h1>History</h1><span class="sub">126 workouts</span></div>

<section class="card hero lit streak">
  <span class="tile lg accent">${ic('flame')}</span>
  <div class="grow"><div class="hero-num">12</div><div class="cap">day streak</div></div>
  <div class="streak-side">
    <div><b class="num">14</b><span>this month</span></div>
    <div><b class="num">19</b><span>best streak</span></div>
  </div>
</section>

<section class="card">
  <div class="card-head"><button class="icon-btn plain" aria-label="Previous month">${ic('chev-l')}</button><h2>November 2026</h2><button class="icon-btn plain" aria-label="Next month" disabled>${ic('chev-r')}</button></div>
  ${calendar()}
  <div class="cal-key"><span><i class="key hit"></i>Trained</span><span><i class="key miss"></i>Missed</span><span><i class="key pr"></i>PR that day</span></div>
</section>

<section class="card">
  <div class="card-head"><h2>Weekly review</h2><button class="link">${ic('export')}Share</button></div>
  <div class="seg block mb12"><button class="on">This week</button><button>Last week</button></div>
  <div class="stat-grid">
    <div class="stat"><div class="v">3<small>/ 6</small></div><div class="k">Workouts</div></div>
    <div class="stat"><div class="v">48</div><div class="k">Sets</div></div>
    <div class="stat"><div class="v">41.2<small>k lb</small></div><div class="k">Tonnage</div></div>
    <div class="stat"><div class="v ok-text">4</div><div class="k">Weights up</div></div>
    <div class="stat"><div class="v gold-text">3</div><div class="k">PRs</div></div>
    <div class="stat"><div class="v">60<small>min</small></div><div class="k">Cardio</div></div>
  </div>
  <div class="list mt8">
    <div class="list-row compact">${ic('scale', 's20 muted')}<span class="grow title">Body weight</span><span class="delta">${ic('arrow-down')}0.6 lb</span><span class="val">182.4 lb</span></div>
    <div class="list-row compact">${ic('moon', 's20 muted')}<span class="grow title">Sleep, average</span><span class="val">7h 08m</span></div>
  </div>
</section>

<section class="card">
  <div class="card-head"><div><div class="cap">Progress</div><h2>Machine Chest Press</h2></div><button class="btn small ghost">Change${ic('chev-d')}</button></div>
  <div class="row between" style="align-items:flex-end">
    <div><span class="display-num">205</span> <span class="unit-lg">lb est. 1RM</span></div>
    <span class="pill ok">${ic('arrow-up')}20 lb in 5 weeks</span>
  </div>
  <p class="small muted mt4">Top set 150 lb × 11 on Nov 16</p>
  <div class="mt12">${progressChart()}</div>
  <div class="group-title" style="margin-left:0">Personal records</div>
  <div class="list">
    <div class="list-row"><span class="tile gold sm">${ic('trophy')}</span><span class="grow"><span class="title">Heaviest set</span><div class="sub">Nov 16</div></span><span class="val">150 lb × 11</span></div>
    <div class="list-row"><span class="tile gold sm">${ic('trophy')}</span><span class="grow"><span class="title">Best estimated 1RM</span><div class="sub">Nov 16</div></span><span class="val">205 lb</span></div>
    <div class="list-row"><span class="tile gold sm">${ic('trophy')}</span><span class="grow"><span class="title">Most reps at 145 lb</span><div class="sub">Nov 5</div></span><span class="val">12 reps</span></div>
  </div>
</section>

<section class="card">
  <div class="cap">Body weight · 7-day average</div>
  <div class="row between mt4 mb12" style="align-items:flex-end">
    <div><span class="display-num">182.6</span> <span class="unit-lg">lb</span></div>
    <span class="pill">${ic('arrow-down')}1.8 lb in 30 days</span>
  </div>
  ${weightChart()}
  <div class="legend mt8"><span><i class="key" style="background:var(--accent)"></i>7-day average</span><span><i class="key" style="background:var(--chart-muted)"></i>Daily weigh-in</span></div>
</section>
`,
});

// ---------- train-program -------------------------------------------------------------------------
const dayCard = (name, sched, list) => `<section class="card">
  <div class="card-head"><div><h2>${name}</h2><div class="meta">${sched} · ${list.length} exercises · ${list.reduce((a, e) => a + e[3], 0)} sets</div></div><button class="icon-btn" aria-label="Edit ${name}">${ic('edit')}</button></div>
  <div class="list">
    ${list.map((e) => `<div class="list-row compact"><span class="grow"><span class="title">${e[0]}</span><div class="sub">${e[1]} · ${e[2]}</div></span><span class="val">${e[3]} × ${e[4]}</span></div>`).join('\n    ')}
  </div>
</section>`;
page({
  file: 'train-program.html', app: 'overload', title: 'Overload · Program', tab: 'program', top: { right: SYNCED },
  body: `
<div class="screen-title"><h1>Program</h1><span class="sub">Push / Pull / Legs · 6 days</span></div>

<section class="card">
  <div class="card-head"><h2>Weekly schedule</h2><button class="link">Edit</button></div>
  <div class="day-strip sched">
    ${WEEK.map(([, d, , name, st]) => `<div class="day-chip ${st === 'today' ? 'today' : st === 'rest' ? 'rest' : ''}"><span>${d}</span><span class="d">${name}</span></div>`).join('\n    ')}
  </div>
</section>

<button class="list-item">
  <span class="tile accent">${ic('sparkle')}</span>
  <span class="grow"><span class="title">Program library</span><div class="sub">11 built-in programs: CBum, FST-7, RP-style PPL, arm focus</div></span>
  ${ic('chev-r', 'chev')}
</button>
<button class="list-item">
  <span class="tile">${ic('copy')}</span>
  <span class="grow"><span class="title">Templates</span><div class="sub">2 saved: Upper / Lower, My PPL (before RP)</div></span>
  ${ic('chev-r', 'chev')}
</button>

<div class="group-title">Training days</div>
${dayCard('Push', 'Mon · Thu', PUSH)}
${dayCard('Pull', 'Tue · Fri', PULL)}
<button class="btn ghost block">${ic('plus')}Add a training day</button>
`,
});

// ---------- train-settings -------------------------------------------------------------------------
const numField = (label, v) => `<div class="field"><label>${label}</label><input class="input num" type="number" inputmode="decimal" value="${v}"></div>`;
const sw = (on) => `<button class="switch${on ? ' on' : ''}" role="switch" aria-checked="${on}"></button>`;
page({
  file: 'train-settings.html', app: 'overload', title: 'Overload · Settings', tab: 'settings', top: { right: SYNCED },
  body: `
<div class="screen-title"><h1>Settings</h1><span class="sub">Version 3.0</span></div>

<section class="card">
  <div class="row" style="gap:12px;align-items:flex-start">
    <span class="tile fuel">${ic('bolt')}</span>
    <div class="grow"><h2>Food has moved to Fuel</h2><p class="small soft mt4">Calories and macros now live in their own app. Your food log stays on this phone until you move it.</p></div>
  </div>
  <ol class="steps mt16">
    <li class="done"><b>Add Fuel to your Home Screen.</b> Open it in Safari, then Share, Add to Home Screen.</li>
    <li class="done"><b>Copy your food log.</b> Targets, saved foods and 214 logged days.</li>
    <li><b>Open Fuel</b> and tap Paste from Overload.</li>
  </ol>
  <div class="btn-row mt4"><button class="btn small">${ic('external')}Open Fuel</button><button class="btn small ghost">${ic('copy')}Copy again</button></div>
</section>

<section class="card">
  <div class="toggle-row wrap"><div><div class="t">Appearance</div><div class="d">System follows your phone</div></div>
    <div class="seg block"><button class="on">System</button><button>Dark</button><button>Light</button></div></div>
  <div class="toggle-row"><div><div class="t">Rep range</div><div class="d">Hit the top on every set and the weight goes up</div></div>
    <div class="row" style="gap:6px"><input class="input num" style="width:60px" type="number" inputmode="numeric" value="10" aria-label="Lowest reps"><span class="muted">to</span><input class="input num" style="width:60px" type="number" inputmode="numeric" value="12" aria-label="Highest reps"></div></div>
  <div class="toggle-row"><div><div class="t">Rest timer</div><div class="d">Seconds, starts when you tick a set</div></div>
    <div class="stepper"><button aria-label="15 seconds less">${ic('minus')}</button><input type="number" inputmode="numeric" value="120" aria-label="Rest seconds"><button aria-label="15 seconds more">${ic('plus')}</button></div></div>
  <div class="toggle-row"><div><div class="t">Reps in reserve</div><div class="d">Four buttons under each ticked set</div></div>${sw(true)}</div>
  <div class="toggle-row"><div><div class="t">Sleep in the check-in</div><div class="d">Time asleep, REM and deep</div></div>${sw(true)}</div>
  <div class="toggle-row"><div><div class="t">Sound when rest is over</div><div class="d">The mute switch silences it</div></div>${sw(false)}</div>
</section>

<section class="card">
  <div class="card-head"><div><h2>Weight jumps</h2><div class="meta">lb added when you earn it. Override per exercise.</div></div></div>
  <div class="field-row">${numField('Barbell', 2.5)}${numField('Dumbbell', 5)}</div>
  <div class="field-row" style="margin-bottom:-16px">${numField('Machine', 5)}${numField('Cable', 5)}</div>
</section>

<section class="card">
  <div class="card-head"><div class="row"><span class="tile">${ic('file')}</span><div><h2>Backup</h2><div class="meta">Last export 6 days ago · 7 daily copies kept</div></div></div></div>
  <div class="row between small"><span class="soft">Storage used on this phone</span><b class="num">4%</b></div>
  <div class="bar thin mt8"><span class="muted" style="width:4%"></span></div>
  <div class="btn-row mt16"><button class="btn ghost">${ic('export')}Export</button><button class="btn ghost">${ic('import')}Import</button></div>
</section>

<section class="card">
  <h2>Reset all data</h2>
  <p class="small muted mt4">Erases every workout on this phone. It asks first and keeps a safety copy.</p>
  <button class="btn danger block mt12">${ic('trash')}Reset</button>
</section>
`,
  after: `<div class="toast" role="status">${ic('check')}Food log copied. Paste it in Fuel.</div>`,
});

// =================================================================================================
// FUEL
// =================================================================================================
const TARGET = { kcal: 2600, p: 190, c: 280, f: 80 };
const MEALS = [
  ['Breakfast', [
    ['Kodiak Power Waffles', '2 waffles (76 g)', 190, 12, 23, 7],
    ['Greek yogurt, nonfat, plain', '170 g', 100, 17, 6, 1],
    ['Fairlife 2% milk', '240 ml', 120, 13, 6, 4.5],
    ['Eggs, whole', '2 large (100 g)', 143, 13, 1, 10],
  ]],
  ['Lunch', [
    ['Chicken breast, cooked (roasted)', '200 g', 330, 62, 0, 7],
    ['White rice, cooked', '250 g', 325, 7, 70, 1],
    ['Broccoli, cooked', '120 g', 42, 3, 8, 0.5],
    ['Olive oil', '1 tsp (4.5 g)', 40, 0, 0, 4.5],
  ]],
  ['Dinner', []],
  ['Snacks', [
    ['Premier Protein shake, chocolate', '1 bottle (325 ml)', 160, 30, 5, 3],
  ]],
];
const sum = (rows, i) => rows.reduce((a, r) => a + r[i], 0);
const ALL = MEALS.flatMap((m) => m[1]);
const EATEN = { kcal: sum(ALL, 2), p: Math.round(sum(ALL, 3)), c: Math.round(sum(ALL, 4)), f: Math.round(sum(ALL, 5)) };
const LEFT = TARGET.kcal - EATEN.kcal;
const pct = (a, b) => Math.min(100, Math.round(a / b * 100));

const macro = (k, label, v, t) => `<div class="f-macro"><div class="k"><i class="dot ${k}"></i>${label}</div><div class="v">${v}<small> / ${t} g</small></div><div class="bar thin"><span class="${k}" style="width:${pct(v, t)}%"></span></div></div>`;
const foodRow = (r) => `<button class="f-row"><span class="grow"><span class="title">${r[0]}</span><div class="sub"><span>${r[1]}</span> · <span>P ${Math.round(r[3])} · C ${Math.round(r[4])} · F ${Math.round(r[5])}</span></div></span><span class="f-rk">${r[2]}<small>kcal</small></span></button>`;
const meal = ([name, rows]) => rows.length ? `<section class="card f-meal">
  <div class="f-meal-head"><h2>${name}</h2><div class="row"><span class="f-meal-kcal">${fmt(sum(rows, 2))} <small>kcal</small></span><button class="icon-btn f-more" aria-label="${name} menu">${ic('more')}</button></div></div>
  ${rows.map(foodRow).join('\n  ')}
  <button class="btn small tonal f-add">${ic('plus')}Add food</button>
</section>` : `<section class="card f-meal">
  <div class="f-meal-head"><h2>${name}</h2><div class="row"><span class="f-meal-kcal">0 <small>kcal</small></span><button class="icon-btn f-more" aria-label="${name} menu">${ic('more')}</button></div></div>
  <div class="empty inline"><span class="tile">${ic('fork')}</span><div><div class="t">Nothing logged yet</div><div>${fmt(LEFT)} kcal and ${TARGET.p - EATEN.p} g protein to go today.</div></div></div>
  <div class="btn-row mt12"><button class="btn small tonal">${ic('plus')}Add food</button><button class="btn small ghost">Copy yesterday</button></div>
</section>`;

const fuelToday = `
<div class="f-daynav">
  <button class="icon-btn" aria-label="Previous day">${ic('chev-l')}</button>
  <button class="f-daylabel">Today<small>Thu, Nov 19</small></button>
  <button class="icon-btn" aria-label="Next day" disabled>${ic('chev-r')}</button>
</div>

<section class="card hero lit f-sum">
  <div class="f-ringrow">
    <div class="f-side"><div class="v">${fmt(EATEN.kcal)}</div><div class="k">Eaten</div></div>
    <div class="ring-wrap f-ring">
      <svg class="ring" viewBox="0 0 120 120" role="img" aria-label="${fmt(EATEN.kcal)} of ${fmt(TARGET.kcal)} kcal eaten"><circle class="ring-track" cx="60" cy="60" r="52"/><circle class="ring-fill grad" cx="60" cy="60" r="52" pathLength="100" stroke-dasharray="${pct(EATEN.kcal, TARGET.kcal)} 100"/></svg>
      <div class="ring-center"><div class="f-big">${fmt(LEFT)}</div><div class="f-left">kcal left</div></div>
    </div>
    <div class="f-side"><div class="v">${fmt(TARGET.kcal)}</div><div class="k">Target</div></div>
  </div>
  <div class="f-macros">
    ${macro('p', 'Protein', EATEN.p, TARGET.p)}
    ${macro('c', 'Carbs', EATEN.c, TARGET.c)}
    ${macro('f', 'Fat', EATEN.f, TARGET.f)}
  </div>
</section>

${MEALS.map(meal).join('\n\n')}
`;
page({ file: 'fuel-today.html', app: 'fuel', title: 'Fuel · Today', tab: 'today', top: { right: SYNCED }, body: fuelToday });

// ---------- fuel-add -----------------------------------------------------------------------------
const quick = (title, sub, { fav, done } = {}) => `<div class="f-row f-qrow"><button class="f-qpick"><span class="grow"><span class="title">${fav ? ic('star', 'f-favmark') : ''}${title}</span><div class="sub">${sub}</div></span></button><button class="icon-btn f-plus${done ? ' done' : ''}" aria-label="${done ? 'Added' : 'Add'} ${title}"${done ? ' disabled' : ''}>${ic(done ? 'check' : 'plus')}</button></div>`;
page({
  file: 'fuel-add.html', app: 'fuel', title: 'Fuel · Add food', tab: 'today', top: { right: SYNCED }, bodyClass: 'has-sheet', body: fuelToday,
  after: `<div class="sheet" role="dialog" aria-label="Add to Dinner">
  <div class="sheet-backdrop"></div>
  <div class="sheet-panel tall">
    <div class="sheet-grab"></div>
    <div class="sheet-title"><h2>Add to Dinner</h2><button class="icon-btn round" aria-label="Close">${ic('close')}</button></div>
    <div class="f-searchrow">
      <label class="search">${ic('search')}<input class="input" type="search" placeholder="Search 8,600 foods" aria-label="Search foods"></label>
      <button class="icon-btn f-scanbtn" aria-label="Scan a barcode">${ic('barcode')}</button>
    </div>
    <div class="f-added" role="status">${ic('check')}<span class="grow"><b>Added:</b> Chicken breast, cooked (roasted), 200 g · 330 kcal</span><button class="btn small" data-action="done">Done</button></div>

    <div class="group-title">Saved meals</div>
    ${quick('Chicken and rice bowl', '3 foods · 697 kcal · P 72')}
    <div class="group-title">Favorites</div>
    ${quick('Chicken breast, cooked (roasted)', '200 g · 330 kcal · P 62', { fav: true, done: true })}
    ${quick('White rice, cooked', '250 g · 325 kcal · P 7', { fav: true })}
    ${quick('Greek yogurt, nonfat, plain', '170 g · 100 kcal · P 17', { fav: true })}
    <div class="group-title">Recent</div>
    ${quick('Premier Protein shake, chocolate', '1 bottle (325 ml) · 160 kcal · P 30')}
    ${quick('Kodiak Power Waffles', '2 waffles (76 g) · 190 kcal · P 12')}
    ${quick('Fairlife 2% milk', '240 ml · 120 kcal · P 13')}
    ${quick('Eggs, whole', '2 large (100 g) · 143 kcal · P 13')}
    ${quick('Banana', '1 medium (118 g) · 105 kcal · P 1')}
    <div class="f-addbtns"><button class="btn small ghost">Quick add</button><button class="btn small ghost">New food</button><button class="btn small ghost">Search brands</button></div>
  </div>
</div>`,
});

// ---------- fuel-amount ---------------------------------------------------------------------------
page({
  file: 'fuel-amount.html', app: 'fuel', title: 'Fuel · Amount', tab: 'today', top: { right: SYNCED }, bodyClass: 'has-sheet', body: fuelToday,
  after: `<div class="sheet" role="dialog" aria-label="Amount">
  <div class="sheet-backdrop"></div>
  <div class="sheet-panel">
    <div class="sheet-grab"></div>
    <div class="sheet-title" style="align-items:flex-start">
      <div class="grow"><div class="cap">USDA · 165 kcal per 100 g</div><h2 class="f-food-name mt4">Chicken breast, cooked (roasted)</h2></div>
      <button class="icon-btn round f-star on" aria-label="Favorite" aria-pressed="true">${ic('star')}</button>
    </div>

    <div class="f-amount">
      <div class="stepper lg"><button aria-label="Less">${ic('minus')}</button><input type="number" inputmode="decimal" value="200" aria-label="Amount"><button aria-label="More">${ic('plus')}</button></div>
      <div class="seg block"><button class="on">g</button><button>oz</button><button>serving (140 g)</button></div>
    </div>

    <div class="f-result">
      <div class="f-result-kcal"><span class="display-num">330</span><span class="unit-lg">kcal</span></div>
      <div class="f-result-macros">
        <div><div class="k"><i class="dot p"></i>Protein</div><div class="v">62<small>g</small></div></div>
        <div><div class="k"><i class="dot c"></i>Carbs</div><div class="v">0<small>g</small></div></div>
        <div><div class="k"><i class="dot f"></i>Fat</div><div class="v">7<small>g</small></div></div>
      </div>
    </div>

    <div class="q-label">Meal</div>
    <div class="seg block f-mealseg"><button>Breakfast</button><button>Lunch</button><button class="on">Dinner</button><button>Snacks</button></div>

    <button class="btn lg block mt16">Add to Dinner</button>
    <div class="center"><button class="link muted">Numbers wrong? Fix them</button></div>
  </div>
</div>`,
});

// ---------- fuel-trends ---------------------------------------------------------------------------
function kcalBars() {
  const days = [['F', 6, 2540], ['S', 7, 2840], ['S', 8, 2250], ['M', 9, 2560], ['T', 10, 2480], ['W', 11, null], ['T', 12, 2570], ['F', 13, 2600], ['S', 14, 2930], ['S', 15, null], ['M', 16, 2590], ['T', 17, 2710], ['W', 18, 2520], ['T', 19, 1450]];
  const W = 326, H = 196, L = 0, R = 38, T = 30, B = 24, base = H - B;
  const slot = (W - L - R) / days.length, bw = 14, y = scale(0, 3200, base, T);
  const sel = 11;
  const marks = days.map(([l, d, v], i) => {
    const x = L + i * slot + (slot - bw) / 2, today = i === days.length - 1;
    const lbl = `<text class="lbl${today ? ' strong' : ''}" x="${r1(x + bw / 2)}" y="${H - 7}" text-anchor="middle">${l}</text>`;
    if (v == null) return `<rect class="bar none" x="${r1(x)}" y="${base - 4}" width="${bw}" height="4" rx="2"/>${lbl}`;
    const cls = i === sel ? 'sel' : v > TARGET.kcal * 1.05 ? 'over' : '';
    return `<path class="bar ${cls}" ${today ? 'opacity="0.45" ' : ''}d="${column(x, y(v), bw, base)}"/>${lbl}`;
  }).join('\n    ');
  const sx = L + sel * slot + slot / 2, sy = y(days[sel][2]);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories for the last 14 days against a 2,600 kcal target. Two days over, two days not logged.">
    <line class="grid" x1="${L}" x2="${W - R}" y1="${base}" y2="${base}"/>
    ${marks}
    <line class="target" x1="${L}" x2="${W - R + 2}" y1="${r1(y(TARGET.kcal))}" y2="${r1(y(TARGET.kcal))}"/>
    <text class="lbl strong" x="${W}" y="${r1(y(TARGET.kcal) + 4)}" text-anchor="end">2,600</text>
    <g><rect class="tip-bg" x="${r1(sx - 52)}" y="${r1(sy - 31)}" width="104" height="23" rx="11.5"/><text class="tip-tx" x="${r1(sx)}" y="${r1(sy - 15.5)}" text-anchor="middle">Tue 17 · 2,710</text></g>
  </svg>`;
}
const avgRow = (k, label, a, b, t, u = '') => `<tr><td><span class="k">${k ? `<i class="dot" style="color:var(--macro-${k})"></i>` : ''}${label}</span></td><td>${a}<small>${u}</small></td><td class="prev">${b}<small>${u}</small></td><td class="prev">${t}<small>${u}</small></td></tr>`;
page({
  file: 'fuel-trends.html', app: 'fuel', title: 'Fuel · Trends', tab: 'trends', top: { right: SYNCED },
  body: `
<div class="screen-title"><h1>Trends</h1><span class="sub">Nov 6 to 19</span></div>

<section class="card hero lit">
  <div class="row between"><span class="cap">Average a day · 14 days</span><span class="pill ok lg">${ic('target')}On target</span></div>
  <div class="nowrap mt8"><span class="hero-num">2,599</span> <span class="unit-lg">kcal</span></div>
  <p class="small muted mt4">Target 2,600. Today is not counted until it ends.</p>
  <div class="mt16">${kcalBars()}</div>
  <div class="legend mt8"><span><i class="key sq" style="background:var(--accent)"></i>Within target</span><span><i class="key sq" style="background:var(--danger)"></i>Over by 5%+</span><span><i class="key sq" style="background:var(--track)"></i>Not logged</span></div>
</section>

<section class="card">
  <div class="card-head"><h2>Weekly averages</h2></div>
  <table class="avg-table">
    <thead><tr><th></th><th>This week</th><th>Last week</th><th>Target</th></tr></thead>
    <tbody>
      ${avgRow('', 'Calories', '2,607', '2,628', '2,600')}
      ${avgRow('p', 'Protein', 188, 181, 190, 'g')}
      ${avgRow('c', 'Carbs', 271, 280, 280, 'g')}
      ${avgRow('f', 'Fat', 83, 84, 80, 'g')}
    </tbody>
  </table>
</section>

<section class="card">
  <div class="card-head"><div><h2>Days logged</h2><div class="meta">12 of the last 14 days</div></div><span class="pill accent lg">${ic('flame')}4 in a row</span></div>
  <div class="logdots" aria-hidden="true">${[1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1].map((v, i) => `<i class="${v ? 'on' : ''}${i === 13 ? ' today' : ''}"></i>`).join('')}</div>
  <div class="row between tiny muted mt8"><span>Fri, Nov 6</span><span>Today</span></div>
</section>
`,
});

// ---------- fuel-welcome ---------------------------------------------------------------------------
page({
  file: 'fuel-welcome.html', app: 'fuel', title: 'Fuel · Welcome', bare: true, screenClass: 'no-tabs welcome',
  body: `
<img class="app-icon" src="icon-fuel.svg" alt="Fuel" width="84" height="84">
<h1>Welcome to Fuel</h1>
<p class="lede">Your food log has its own app now. Bring it across from Overload, it takes a minute.</p>

<div class="group-title" style="margin-top:28px">Bring my food log</div>
<button class="choice-card primary">
  <span class="tile lg overload">${ic('dumbbell')}</span>
  <span class="grow"><span class="title">Paste from Overload<span class="pill solid">Fastest</span></span><div class="sub">In Overload: Settings, Food has moved, Copy food log. Then tap here.</div></span>
  ${ic('chev-r', 'chev')}
</button>
<button class="choice-card">
  <span class="tile lg">${ic('file')}</span>
  <span class="grow"><span class="title">Choose a backup file</span><div class="sub">An Overload export (.json). Only food, targets and saved meals are read.</div></span>
  ${ic('chev-r', 'chev')}
</button>
<button class="choice-card">
  <span class="tile lg">${ic('cloud')}</span>
  <span class="grow"><span class="title">Sign in to cloud sync</span><div class="sub">The same account as Overload. Your log downloads to this phone.</div></span>
  ${ic('chev-r', 'chev')}
</button>

<div class="grow"></div>
<div class="center"><button class="link muted">Start fresh</button></div>
<p class="tiny muted center">Nothing is removed from Overload.</p>
`,
});

// ---------- components.html (the kit on one page; add ?app=fuel to see it in Fuel's colour) ----------
function sleepChart() {
  const nights = [[1.4, 1.7, 3.6], [1.1, 1.5, 4.1], [1.6, 1.9, 3.9], [0.9, 1.2, 4.0], [1.5, 1.8, 3.5], [1.7, 2.0, 4.2], [1.3, 1.6, 4.4], [1.2, 1.4, 3.8], [1.6, 1.8, 3.9], [1.0, 1.3, 3.6], [1.5, 2.1, 3.7], [1.4, 1.7, 4.0], [1.8, 1.9, 4.1], [1.3, 1.8, 4.1]];
  const W = 326, H = 130, L = 22, B = 18, T = 6, base = H - B, slot = (W - L) / nights.length, bw = 12, y = scale(0, 9, base, T), gap = 2;
  const bars = nights.map(([d, r, o], i) => {
    const x = L + i * slot + (slot - bw) / 2; let foot = base; const out = [];
    [[d, 'sl-deep'], [r, 'sl-rem'], [o, 'sl-other']].forEach(([v, cls], k) => {
      const top = foot - (base - y(v));
      // the two lower segments stop 2 px short, so the surface shows between fills; only the top one is rounded
      out.push(k === 2 ? `<path class="${cls}" d="${column(x, top, bw, foot)}"/>` : `<rect class="${cls}" x="${r1(x)}" y="${r1(top + gap)}" width="${bw}" height="${r1(foot - top - gap)}"/>`);
      foot = top;
    });
    return out.join('');
  }).join('\n    ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sleep for the last 14 nights, split into deep, REM and other">
    ${[0, 4, 8].map((v) => `<line class="grid" x1="${L}" x2="${W}" y1="${r1(y(v))}" y2="${r1(y(v))}"/><text class="lbl" x="${L - 5}" y="${r1(y(v) + 3.5)}" text-anchor="end">${v}h</text>`).join('')}
    ${bars}
    <text class="lbl" x="${L + 4}" y="${H - 4}">Nov 6</text><text class="lbl" x="${W}" y="${H - 4}" text-anchor="end">Last night</text>
  </svg>`;
}
const ringDemo = (cls, v, label, big) => `<div class="center"><div class="ring-wrap" style="width:72px;height:72px;margin:0 auto"><svg class="ring" viewBox="0 0 120 120" width="72" height="72"><circle class="ring-track" cx="60" cy="60" r="52"/><circle class="ring-fill ${cls}" cx="60" cy="60" r="52" pathLength="100" stroke-dasharray="${v} 100"/></svg><div class="ring-center"><b class="num" style="font-size:20px">${big}</b></div></div><div class="cap mt8">${label}</div></div>`;
page({
  file: 'components.html', app: 'overload', title: 'Athletic · Components', bare: true, screenClass: 'no-tabs kit',
  body: `
<script>if (new URLSearchParams(location.search).get('app') === 'fuel') document.documentElement.setAttribute('data-app', 'fuel');</script>
<div class="screen-title" style="margin-top:8px"><div><div class="cap">Athletic</div><h1>Components</h1></div><span class="sub">ui.css</span></div>

<div class="group-title">Buttons</div>
<section class="card stack" style="gap:10px">
  <button class="btn lg block">${ic('play')}Primary, large</button>
  <div class="btn-row"><button class="btn">Primary</button><button class="btn is-pressed">Pressed</button><button class="btn" disabled>Disabled</button></div>
  <div class="btn-row"><button class="btn ghost">Ghost</button><button class="btn subtle">Subtle</button><button class="btn tonal">Tonal</button></div>
  <div class="btn-row"><button class="btn inverse">Inverse</button><button class="btn success">Success</button><button class="btn danger">${ic('trash')}Danger</button></div>
  <div class="row" style="flex-wrap:wrap"><button class="btn small">Small</button><button class="btn small ghost">${ic('plus')}Set</button><button class="btn small subtle">Subtle</button><button class="btn small tonal">Tonal</button><button class="link">Text link</button></div>
  <div class="row" style="flex-wrap:wrap"><button class="icon-btn" aria-label="More">${ic('more')}</button><button class="icon-btn round" aria-label="Close">${ic('close')}</button><button class="icon-btn plain" aria-label="Swap">${ic('swap')}</button><button class="icon-btn" disabled aria-label="Next">${ic('chev-r')}</button><button class="check" aria-label="Empty tick">${ic('check')}</button><button class="check on" aria-label="Ticked">${ic('check')}</button></div>
</section>

<div class="group-title">Form controls</div>
<section class="card">
  <div class="field"><label>Exercise name</label><input class="input" value="Machine Chest Press"></div>
  <div class="field"><label>Focused</label><input class="input is-focus" placeholder="Seat height, handle, pin"></div>
  <div class="field-row"><div class="field"><label>Equipment</label><select class="select"><option>Machine</option></select></div><div class="field"><label>Weight jump</label><input class="input num" value="5"></div></div>
  <label class="search">${ic('search')}<input class="input" placeholder="Search exercises"></label>
  <div class="toggle-row mt12"><div><div class="t">Stepper</div><div class="d">Minus, a real input, plus</div></div><div class="stepper"><button aria-label="Less">${ic('minus')}</button><input type="number" value="120" aria-label="Seconds"><button aria-label="More">${ic('plus')}</button></div></div>
  <div class="toggle-row"><div><div class="t">Switch, on</div><div class="d">Green means on in both apps</div></div>${sw(true)}</div>
  <div class="toggle-row"><div><div class="t">Switch, off</div></div>${sw(false)}</div>
  <div class="toggle-row wrap"><div><div class="t">Segmented control</div><div class="d">The chosen segment is ink, not the accent</div></div><div class="seg block"><button>3 days</button><button class="on">4 days</button><button>5 days</button><button>6 days</button></div></div>
</section>

<div class="group-title">Pills, tags, tiles</div>
<section class="card">
  <div class="row" style="flex-wrap:wrap"><span class="pill">Chest</span><span class="pill accent">${ic('flame')}12 day streak</span><span class="pill solid">Fastest</span><span class="pill ok">${ic('arrow-up')}5 lb</span><span class="pill warn">Weigh-in due</span><span class="pill danger">Over by 240</span><span class="pill pr">${ic('trophy')}PR</span><span class="pill">Deload</span></div>
  <div class="row mt12" style="flex-wrap:wrap"><span class="tile">${ic('file')}</span><span class="tile soft">${ic('heart')}</span><span class="tile accent">${ic('sparkle')}</span><span class="tile ok">${ic('check')}</span><span class="tile gold">${ic('trophy')}</span><span class="tile overload">${ic('dumbbell')}</span><span class="tile fuel">${ic('bolt')}</span></div>
</section>

<div class="group-title">Messages</div>
<div class="notice">${ic('warn', 'lead')}<span>Last export was 16 days ago.</span><button class="btn small ghost">Export</button><button class="icon-btn plain" aria-label="Dismiss">${ic('close')}</button></div>
<div class="banner">${ic('info')}<span>Recovery is 31% today. Hold the weights, keep the reps.</span></div>
<div class="banner ok">${ic('check')}<span>Protein target hit. 192 of 190 g.</span></div>
<div class="banner danger">${ic('warn')}<span><b>Not saved on this phone.</b> Storage is full. Export now so nothing is lost.</span></div>
<div class="toast" style="position:static;margin-bottom:12px">${ic('check')}Saved as a meal</div>
<section class="card"><div class="empty"><span class="tile lg">${ic('dumbbell')}</span><div class="t">No workouts this week</div><div>Start today's workout and it shows up here.</div><button class="btn small tonal mt12">Go to Today</button></div></section>

<div class="group-title">Progress</div>
<section class="card">
  <div class="row between small"><span>Calories</span><b class="num">1,450 / 2,600</b></div><div class="bar thick mt8"><span style="width:56%"></span></div>
  <div class="row between small mt12"><span>Storage</span><b class="num">72%</b></div><div class="bar mt8"><span class="warn" style="width:72%"></span></div>
  <div class="row between small mt12"><span>Fat</span><b class="num">96 / 80 g</b></div><div class="bar thin mt8"><span class="over" style="width:100%"></span></div>
  <div class="row between mt16" style="gap:0">${ringDemo('grad', 56, 'Calories', '56%')}${ringDemo('p', 83, 'Protein', '157')}${ringDemo('ok', 100, 'Hit', ic('check'))}${ringDemo('over', 100, 'Over', '+12')}</div>
</section>
<section class="card">
  <div class="card-head"><h2>Sets per muscle</h2><span class="pill">target 10 to 20</span></div>
  ${[['Chest', 14, 'ok'], ['Back', 17, 'ok'], ['Shoulders', 8, 'low'], ['Biceps', 6, 'low'], ['Triceps', 10, 'ok'], ['Quads', 22, 'high']].map(([m, n, c]) => `<div class="vol-row"><span class="vol-name">${m}</span><span class="vol-bar"><i class="vol-fill ${c}" style="width:${Math.min(100, n / 24 * 100)}%"></i></span><span class="vol-n">${n}</span></div>`).join('\n  ')}
  <p class="tiny muted mt8">Amber is under target, green is in range, rose is over. The number carries it too.</p>
</section>
<section class="card">
  <div class="card-head"><div><h2>Sleep</h2><div class="meta">7-night average 7h 08m</div></div></div>
  ${sleepChart()}
  <div class="legend mt8"><span><i class="sl-key sl-deep"></i>Deep</span><span><i class="sl-key sl-rem"></i>REM</span><span><i class="sl-key sl-other"></i>Other</span></div>
</section>

<div class="group-title">Warm-up</div>
<section class="card"><div class="warmups" style="margin:0">
  <div class="warmup-row done"><span class="n">W1</span><span class="grow"><b>75</b> lb × <b>8</b></span><button class="check small on" aria-label="Warm-up 1 done">${ic('check')}</button></div>
  <div class="warmup-row"><span class="n">W2</span><span class="grow"><b>105</b> lb × <b>5</b></span><button class="check small" aria-label="Warm-up 2">${ic('check')}</button></div>
  <div class="warmup-row"><span class="n">W3</span><span class="grow"><b>127.5</b> lb × <b>3</b></span><button class="check small" aria-label="Warm-up 3">${ic('check')}</button></div>
</div></section>
`,
});

// ---------- icons.html ------------------------------------------------------------------------------
const sprite = readFileSync(join(OUT, 'icons.svg'), 'utf8');
const ids = [...sprite.matchAll(/<symbol id="i-([a-z-]+)"/g)].map((m) => m[1]);
const home = (cls, label) => `<div class="hs ${cls}"><div class="hs-row">
  <div class="hs-app"><img src="icon-overload.svg" alt=""><span>Overload</span></div>
  <div class="hs-app"><img src="icon-fuel.svg" alt=""><span>Fuel</span></div>
  <div class="hs-app"><i style="background:linear-gradient(#5d6470,#2e333c)"></i><span>Camera</span></div>
  <div class="hs-app"><i style="background:linear-gradient(#f4f5f7,#d9dce2)"></i><span>Notes</span></div>
</div><div class="hs-cap">${label}</div></div>`;
writeFileSync(join(OUT, 'icons.html'), `<!doctype html>
<html lang="en" data-app="overload">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Athletic · Icons</title>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="ui.css">
<script>
  var t = new URLSearchParams(location.search).get('theme');
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
</script>
<style>
  body { padding: 24px 16px 48px; max-width: 1100px; margin: 0 auto; }
  .big { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; }
  .big figure { margin: 0; text-align: center; }
  .big img { width: 100%; max-width: 320px; aspect-ratio: 1; border-radius: 22.37%; box-shadow: var(--e-2); display: block; margin: 0 auto 10px; }
  .big figcaption { font: var(--t-h3); } .big figcaption span { display: block; font: var(--t-small); color: var(--text-3); }
  .sizes { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 14px 18px; margin-top: 16px; }
  .sizes img { border-radius: 22.37%; display: block; }
  .sizes div { text-align: center; font: var(--t-small); color: var(--text-3); }
  .hs-wrap { display: grid; grid-template-columns: repeat(auto-fit, minmax(248px, 1fr)); gap: 12px; }
  .hs { border-radius: 28px; padding: 26px 14px 12px; }
  .hs.light { background: radial-gradient(120% 90% at 20% 0%, #ffd9c2, transparent 60%), linear-gradient(160deg, #bfe3ff, #f6efe6 60%, #ffe2ec); }
  .hs.dark { background: radial-gradient(120% 90% at 80% 0%, #2a3a66, transparent 60%), linear-gradient(160deg, #0b1020, #171a2b 60%, #2a1630); }
  .hs-row { display: grid; grid-template-columns: repeat(4, 1fr); justify-items: center; }
  .hs-app { display: flex; flex-direction: column; align-items: center; gap: 6px; font: 500 11.5px/1 var(--font-ui); }
  .hs-app img, .hs-app i { width: 60px; height: 60px; border-radius: 13.4px; display: block; }
  .hs.light .hs-app span { color: #14161c; } .hs.dark .hs-app span { color: #fff; }
  .hs-cap { margin-top: 16px; text-align: center; font: 600 11px/1 var(--font-ui); letter-spacing: .06em; text-transform: uppercase; }
  .hs.light .hs-cap { color: #5b6170; } .hs.dark .hs-cap { color: #a9afbe; }
  .set { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 8px; }
  .set div { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px 2px 10px; border-radius: 16px; background: var(--card-2); font: 600 10.5px/1.1 var(--font-ui); color: var(--text-3); text-align: center; }
  .set .ic { width: 28px; height: 28px; color: var(--text); }
  .tabs-demo { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(248px, 1fr)); }
  .tabs-demo .tabbar { position: static; border-radius: 22px; height: 64px; padding: 0 6px; box-shadow: var(--e-1); background: var(--card); }
  [data-app-scope="fuel"] { --a1: var(--fresh-1); --a2: var(--fresh-2); --a-ink: var(--fresh-ink); --a-rgb: 38 208 110; --accent-grad: linear-gradient(135deg, var(--fresh-1), var(--fresh-2)); --on-accent: var(--fresh-ink); --glow: 0 10px 28px -10px rgb(38 208 110 / .6); }
</style>
</head>
<body>
<div class="screen-title" style="margin-top:0"><div><div class="cap">Athletic</div><h1>Icons</h1></div></div>

<section class="card">
  <div class="card-head"><div><h2>App icons</h2><div class="meta">1024 px SVG masters: icon-overload.svg, icon-fuel.svg. Ink glyph on the app gradient.</div></div></div>
  <div class="big">
    <figure><img src="icon-overload.svg" alt="Overload icon"><figcaption>Overload<span>Heat, a loaded barbell tilted up</span></figcaption></figure>
    <figure><img src="icon-fuel.svg" alt="Fuel icon"><figcaption>Fuel<span>Fresh, a bolt</span></figcaption></figure>
  </div>
  <div class="sizes">
    ${[120, 87, 60, 40, 29].map((s) => `<div><img src="icon-overload.svg" width="${s}" height="${s}" alt=""><br>${s}</div><div><img src="icon-fuel.svg" width="${s}" height="${s}" alt=""><br>${s}</div>`).join('')}
  </div>
</section>

<section class="card">
  <div class="card-head"><div><h2>On the Home Screen</h2><div class="meta">60 px, next to each other</div></div></div>
  <div class="hs-wrap">${home('light', 'Light wallpaper')}${home('dark', 'Dark wallpaper')}</div>
</section>

<section class="card">
  <div class="card-head"><div><h2>Tab bars</h2><div class="meta">The current tab wears the app gradient</div></div></div>
  <div class="tabs-demo"><div>${tabbar('overload', 'today')}</div><div data-app-scope="fuel">${tabbar('fuel', 'today')}</div></div>
</section>

<section class="card">
  <div class="card-head"><div><h2>Icon set</h2><div class="meta">${ids.length} symbols in icons.svg · 24 px grid · filled bodies, 2.5 px round strokes · currentColor</div></div></div>
  <div class="set">${ids.map((id) => `<div>${ic(id)}${id}</div>`).join('')}</div>
</section>
</body>
</html>
`);
console.log('wrote icons.html');
