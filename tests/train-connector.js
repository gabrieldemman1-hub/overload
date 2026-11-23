#!/usr/bin/env node
/* Overload 3.0 and the connector (WHOOP, reminders): the food-log reminder is always sent as off.
 *
 *   node tests/train-connector.js [--port=8407]
 *
 * The training app no longer knows whether food was logged, so a food reminder left on would fire every
 * evening. With a connector address, a key and a food reminder that is ON in the saved settings:
 *   - the config sent to the connector has reminders.food.on = false (the saved time kept), the two other
 *     reminders as saved, and "done" for check-in and workout only;
 *   - it is sent once: a second status check, and a save that changes nothing the connector needs, send nothing;
 *   - the saved settings.reminders is left exactly as it was (v2.8 needs reminders.food to draw Settings);
 *   - Settings > Reminders offers two rows, Morning check-in and Workout.
 * The connector is a stand-in answered inside the test (https://connector.test); nothing leaves the machine.
 * Prints one PASS/FAIL line per check and exits 1 if anything failed.
 */
'use strict';
const lib = require('./lib');
const T = require('./train-common');

const args = T.args();
const PORT = Number(args.port) || 8407;
const run = T.runner('train-connector');
const { need, same } = run;
const HOST = 'https://connector.test';
const fx = lib.loadFixture('v28-state');

(async () => {
  const server = await lib.startServer(lib.REPO, PORT);
  const browser = await lib.launch();
  try {
    const state = JSON.parse(fx.text);
    state.settings.reminders = { checkin: { on: true, time: '07:30' }, workout: { on: false, time: '17:00' }, food: { on: true, time: '21:15' } };
    state.settings.connUrl = HOST; state.settings.connKey = 'ab'.repeat(20);
    const saved = JSON.stringify(state.settings.reminders);

    const phone = await lib.newPhone(browser, { timezoneId: fx.meta.tz, now: fx.meta.now });
    await lib.seedV28(phone.context, { state, meta: fx.meta });
    // The stand-in connector. It starts with the config v2.8 last sent: food on, and food "done" in it.
    const calls = [], puts = [];
    let cfg = { tz: fx.meta.tz, reminders: JSON.parse(saved), training: [], done: { checkin: null, workout: null, food: null } };
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await phone.context.route(HOST + '/**', (route) => {
      const req = route.request(), path = new URL(req.url()).pathname;
      calls.push(req.method() + ' ' + path);
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const json = (o, status) => route.fulfill({ status: status || 200, headers: cors, contentType: 'application/json', body: JSON.stringify(o) });
      if (req.headers().authorization !== 'Bearer ' + state.settings.connKey) return json({ error: 'unauthorized' }, 401);
      if (req.method() === 'GET' && path === '/status') return json({ whoop: { connected: false, ready: false }, subs: 0, cfg });
      if (req.method() === 'PUT' && path === '/config') { cfg = JSON.parse(req.postData()); puts.push(cfg); return json({ ok: true }); }
      return json({ error: 'not found' }, 404);
    });
    const page = await lib.openApp(phone.context, server.url + '/index.html');
    const step = (title, fn) => run.step('connector', title, fn);

    await step('the config is sent with the food reminder off and nothing said about food being done', async () => {
      for (let i = 0; i < 60 && !puts.length; i++) await lib.sleep(100);
      need(puts.length === 1, puts.length + ' configs sent; calls: ' + calls.join(', '));
      const c = puts[0];
      same(c.reminders, { checkin: { on: true, time: '07:30' }, workout: { on: false, time: '17:00' }, food: { on: false, time: '21:15' } }, 'reminders');
      same(Object.keys(c.done), ['checkin', 'workout'], 'the kinds in "done"');
      same(c.done, { checkin: fx.meta.today, workout: null }, 'done');   // the fixture's check-in is done today; no workout was finished today
      same(c.tz, fx.meta.tz, 'tz');
      same(c.training, fx.meta.schedule, 'the training days');
      return JSON.stringify(c.reminders.food) + ', done ' + JSON.stringify(c.done);
    });
    await step('it is sent once: not again at the next status check, nor after a save that changes nothing the connector needs', async () => {
      await page.evaluate(() => window.__overloadConn._refresh(true));
      await lib.openTab(page, 'settings');
      await page.click('[data-action="set-rir"][data-v="0"]');   // a save
      await lib.sleep(2200);                                      // longer than the 1.5 s the app waits before sending
      need(puts.length === 1, puts.length + ' configs sent; calls: ' + calls.join(', '));
      need(calls.filter((c) => c === 'GET /status').length >= 2, 'the second status check did not happen: ' + calls.join(', '));
    });
    await step('the saved settings.reminders is exactly as it was', async () => {
      const now = await T.stored(page, lib.STATE_KEY);
      need(JSON.stringify(now.settings.reminders) === saved, 'settings.reminders is now ' + JSON.stringify(now.settings.reminders));
      need(now.settings.connKey === state.settings.connKey && now.settings.connUrl === HOST, 'the connector link changed');
      return saved;
    });
    await step('Settings > Reminders offers Morning check-in and Workout, no Food log', async () => {
      need(await page.evaluate(() => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window), 'this browser cannot show reminders, so the rows cannot be drawn');
      await page.evaluate(() => { window.__overloadConn._cs.pushOn = true; });   // as if reminders were turned on on this phone
      await lib.openTab(page, 'today'); await lib.openTab(page, 'settings');
      const rows = await page.evaluate(() => [...document.querySelectorAll('#conn-cards [data-field="conn-time"]')].map((i) => i.dataset.k + ' ' + i.value));
      same(rows, ['checkin 07:30', 'workout 17:00'], 'the reminder rows');
      need(!/Food log|logged food/.test(await T.text(page, '#conn-cards')), 'the cards still speak of the food log');
      return rows.join(', ');
    });
    const problems = phone.problems();
    run.say(!problems.length, 'connector', 'no page errors, no console errors', problems.join(' | ').slice(0, 400));
    run.say(!phone.blocked.some((u) => u.startsWith(HOST)), 'connector', 'every connector call was answered by the stand-in', phone.blocked.filter((u) => u.startsWith(HOST)).join(', '));
    await phone.close();
  } finally { await browser.close(); await server.stop(); }
  run.done();
})().catch((e) => { console.error(e); process.exit(1); });
