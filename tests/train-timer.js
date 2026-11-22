#!/usr/bin/env node
/* The rest and cardio timers across a reload (the "Update ready" pill tapped mid-workout, or any reload).
 *
 *   node tests/train-timer.js [--port=8409]
 *
 * On the active-workout fixture: a running timer is kept for the session (sessionStorage 'overload.timer':
 * end, total, kind, the dock's line, the workout it is for) and goes on after the reload with the time it had
 * left; when it ends it does what it would have done (Rest over; a cardio timer logs the cardio). +30s and Skip
 * are kept too. A cardio timer that ran out while the page was being loaded logs the cardio at start. A timer of
 * another workout, or of none, is not started. The pill is the page's own (noteUpdateReady, which the
 * controllerchange handler also uses); no real worker update runs here.
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const lib = require('./lib');
const T = require('./train-common');

const args = T.args();
const PORT = Number(args.port) || 8409;
const run = T.runner('train-timer');
const { need, same } = run;
const fx = lib.loadFixture('v28-state-active');
const TICK = '.ex-card:not(.compact) .check:not(.on):not(.small)';

const dock = (page) => page.evaluate(() => ({ shown: !document.querySelector('#rest-timer').hidden, label: document.querySelector('.rest-label').textContent, time: document.querySelector('#rest-time').textContent,
  of: document.querySelector('#rest-of').textContent, next: document.querySelector('#rest-next').textContent, kept: sessionStorage.getItem('overload.timer') }));
const secs = (t) => { const [m, s] = t.split(':').map(Number); return m * 60 + s; };
// The pill as a worker update shows it, then a tap on it: the page loads again.
async function updateReady(page) {
  await page.evaluate(() => window.__overload.noteUpdateReady());
  await page.click('[data-action="reload"]');
  await page.waitForLoadState('load');
  await page.waitForFunction(() => !!window.__overload, null, { timeout: 15000 });
}
const reload = async (page) => { await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => !!window.__overload, null, { timeout: 15000 }); };
const cardio = (page) => page.evaluate(() => { const s = window.__overload.state, w = s.workouts.find((x) => x.id === s.active); return w && w.cardio ? JSON.parse(JSON.stringify(w.cardio)) : null; });

async function rest(browser, server) {
  const name = 'rest timer', step = (title, fn) => run.step(name, title, fn);
  const phone = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
  await lib.seedV28(phone.context, fx);
  const page = await lib.openApp(phone.context, server.url + '/index.html');
  let was = null;
  await step('a set ticked, 20 s on, then Update ready: the rest goes on with the time it had left', async () => {
    await page.click(TICK);
    await page.clock.runFor(20000);
    was = await dock(page);
    need(was.shown && was.label === 'Rest' && was.kept, 'no rest timer before the reload: ' + JSON.stringify(was));
    await updateReady(page);
    const now = await dock(page);
    need(now.shown && now.label === 'Rest', 'no rest timer after the reload: ' + JSON.stringify(now));
    same([now.of, now.next], [was.of, was.next], 'the whole rest and the line under it');
    need(Math.abs(secs(now.time) - secs(was.time)) <= 1, 'the time left was ' + was.time + ', now ' + now.time);
    return was.time + ' ' + was.of + ' "' + was.next + '" -> ' + now.time;
  });
  await step('it ends when it would have: "Rest over", the dock goes, nothing is kept; a reload shows none', async () => {
    await page.clock.runFor((secs(was.time) + 1) * 1000);
    need((await T.toast(page, /Rest over/)) === 'Rest over', 'no "Rest over"');
    const d = await dock(page);
    need(!d.shown && d.kept === null, 'after the end: ' + JSON.stringify(d));
    await reload(page);
    need(!(await dock(page)).shown, 'a timer after the reload');
  });
  await step('+30s is kept across a reload; Skip leaves nothing to start again', async () => {
    await page.click(TICK);
    const a = await dock(page);
    await page.click('[data-action="rest-add"]');
    await reload(page);
    const b = await dock(page);
    need(b.shown && secs(b.of.replace('/ ', '')) === secs(a.of.replace('/ ', '')) + 30, 'the whole rest after +30s and a reload: ' + b.of + ' (it was ' + a.of + ')');
    await page.click('[data-action="rest-skip"]');
    await reload(page);
    need(!(await dock(page)).shown, 'a timer after Skip and a reload');
    return a.of + ' -> ' + b.of;
  });
  await step('a kept timer of another workout, or with no workout in progress, is not started', async () => {
    await page.evaluate(() => sessionStorage.setItem('overload.timer', JSON.stringify({ end: Date.now() + 60000, total: 90, kind: 'rest', next: 'x', workout: 'someother' })));
    await reload(page);
    need(!(await dock(page)).shown, 'another workout\'s timer was started');
    await page.click(TICK);
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('overload.state.v1')); s.active = null; localStorage.setItem('overload.state.v1', JSON.stringify(s)); });
    await reload(page);
    need(!(await dock(page)).shown, 'a timer with no workout in progress');
  });
  const p = phone.problems(); run.say(!p.length, name, 'no page errors, no console errors', p.join(' | ').slice(0, 400));
  await phone.close();
}

async function cardioTimer(browser, server) {
  const name = 'cardio timer', step = (title, fn) => run.step(name, title, fn);
  const phone = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
  await lib.seedV28(phone.context, fx);
  const page = await lib.openApp(phone.context, server.url + '/index.html');
  await step('a cardio timer running at Update ready goes on, and logs the cardio when it ends', async () => {
    const c0 = await cardio(page);
    need(c0 && !c0.done && c0.min > 0, 'no cardio to time: ' + JSON.stringify(c0));
    await page.click('[data-action="cardio-timer"]');
    await page.clock.runFor(60000);
    await updateReady(page);
    const d = await dock(page);
    need(d.shown && d.label === 'Cardio' && secs(d.of.replace('/ ', '')) === c0.min * 60, 'after the reload: ' + JSON.stringify(d));
    need((await T.text(page, '[data-action="cardio-timer"]')) === 'Restart timer', 'the card does not know its timer runs');
    await page.clock.runFor((secs(d.time) + 1) * 1000);
    need((await T.toast(page, /Cardio done/)) === 'Cardio done · ' + c0.min + ' min logged', 'the toast');
    need((await cardio(page)).done === true, 'the cardio was not logged');
    need((await lib.readStorage(page, lib.STATE_KEY)).workouts.find((w) => w.id === fx.state.active).cardio.done === true, 'the logged cardio is not saved');
    return d.time + ' ' + d.of + ' after the reload';
  });
  await step('a cardio timer that ran out while the page was loaded again logs the cardio at start', async () => {
    await page.click('[data-action="cardio-undo"]');
    need((await cardio(page)).done === false, 'Undo did not work');
    await page.click('[data-action="cardio-timer"]');
    await page.evaluate(() => { const t = JSON.parse(sessionStorage.getItem('overload.timer')); t.end = Date.now() - 2000; sessionStorage.setItem('overload.timer', JSON.stringify(t)); });   // as if the end passed during the reload
    await reload(page);
    need((await cardio(page)).done === true, 'the cardio was not logged at start');
    need(!(await dock(page)).shown, 'a timer is running');
    return (await T.text(page, '#toast'));
  });
  const p = phone.problems(); run.say(!p.length, name, 'no page errors, no console errors', p.join(' | ').slice(0, 400));
  await phone.close();
}

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    await rest(browser, server);
    await cardioTimer(browser, server);
  } finally { await browser.close(); await server.stop(); }
  run.done();
})().catch((e) => { console.error(e); process.exit(1); });
