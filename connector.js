/* Overload ↔ connector (connector/worker.js on Cloudflare): WHOOP sleep sync and push reminders.
 *
 * Loaded after app.js; plugs in through window.__overloadConn (Settings cards, actions)
 * and reads/writes state through window.__overload.
 *
 * Saved data (in state.settings, so it follows the cloud sync to other phones):
 *   connKey    random key that pairs this app with the connector (Authorization: Bearer)
 *   connUrl    the connector's address; connector.json (written by the deploy workflow) fills it
 *   reminders  { checkin, workout, food: { on, time: 'HH:MM' } }
 * WHOOP nights go into state.sleep as { date, total, rem, deep, light, recovery, rhr, hrv, perf, src: 'whoop' }.
 * A night typed in by hand keeps its numbers; WHOOP only adds recovery to it.
 */
(function () {
  'use strict';

  const O = window.__overload;
  const { esc, todayKey, toast } = O.lib;
  const S = () => O.state;
  const DEFAULT_REMINDERS = { checkin: { on: true, time: '07:30' }, workout: { on: true, time: '17:00' }, food: { on: false, time: '20:30' } };
  const LABELS = { checkin: ['Morning check-in', 'Weight and sleep. Skipped once logged'], workout: ['Workout', 'Training days only. Skipped once finished'], food: ['Food log', 'Evening nudge. Skipped if you logged food today'] };
  const cs = { status: null, loading: false, err: '', lastStatus: 0, lastSync: 0, syncing: false, pushOn: null };
  const local = { get: (k) => { try { return localStorage.getItem('overload.conn.' + k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem('overload.conn.' + k, v); } catch (e) { /* private mode */ } } };

  const url = () => (S().settings.connUrl || '').replace(/\/+$/, '');
  function key() {
    const s = S().settings;
    if (!s.connKey) { s.connKey = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join(''); O.save(); }
    return s.connKey;
  }
  function reminders() {
    const s = S().settings;
    if (!s.reminders) s.reminders = JSON.parse(JSON.stringify(DEFAULT_REMINDERS));
    return s.reminders;
  }
  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(url() + path, { method: opts.method || 'GET', headers: Object.assign({ Authorization: 'Bearer ' + key() }, opts.body ? { 'Content-Type': 'application/json' } : {}), body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || data.error || ('Connector ' + res.status)), { status: res.status, code: data.error, data });
    return data;
  }
  const rerender = () => { if (O.screen === 'settings' || O.screen === 'today' || O.screen === 'history') O.render(); };

  // ---------------------------------------------------------------------------
  // Finding and pairing with the connector
  // ---------------------------------------------------------------------------
  async function discover() {
    try {
      const res = await fetch('./connector.json', { cache: 'no-store' });
      if (!res.ok) return;
      const u = String((await res.json()).url || '').replace(/\/+$/, '');
      if (/^https:\/\//.test(u) && u !== S().settings.connUrl) { S().settings.connUrl = u; O.save(); }
    } catch (e) { /* not deployed yet */ }
  }
  async function refreshStatus(force) {
    if (!url() || cs.loading || (!force && Date.now() - cs.lastStatus < 60000)) return;
    cs.loading = true;
    try {
      try { cs.status = await api('/status'); }
      catch (e) {
        if (e.status !== 401) throw e;
        await api('/claim', { method: 'POST', body: { key: key() } });  // first use: pair this app
        cs.status = await api('/status');
      }
      cs.err = '';
    } catch (e) { cs.err = e.status === 403 ? (e.code === 'whoop-first' ? 'whoop-first' : 'paired') : (e.message || 'Could not reach the connector'); cs.pairedWhoop = !!(e.data && e.data.whoop); cs.status = null; }
    cs.loading = false; cs.lastStatus = Date.now();
    // The connector lost or never got this phone's latest settings: send them again.
    if (cs.status && cs.status.cfg && S().settings.connKey) {
      const mine = configNow(), theirs = cs.status.cfg;
      if (JSON.stringify([mine.tz, mine.reminders, mine.training]) !== JSON.stringify([theirs.tz, theirs.reminders, theirs.training])) pushConfig(true);
    }
    rerender();
  }

  // ---------------------------------------------------------------------------
  // WHOOP
  // ---------------------------------------------------------------------------
  function localDate(iso) { return todayKey(new Date(iso)); }
  // Merges WHOOP nights into state.sleep. Returns how many nights changed.
  function mergeNights(nights) {
    const st = S(); let changed = 0; const seen = new Set();
    nights.forEach((n) => {                  // newest first: the first night ending on a date is the one kept
      if (!(n.total > 0)) return;
      const date = localDate(n.end);
      if (seen.has(date) || (st.deleted && st.deleted.sleep[date])) return;  // deleted by you: stays deleted
      seen.add(date);
      const extra = { recovery: n.recovery, rhr: n.rhr, hrv: n.hrv, perf: n.performance };
      const i = st.sleep.findIndex((x) => x.date === date);
      const cur = i >= 0 ? st.sleep[i] : null;
      const next = cur && cur.src !== 'whoop'
        ? Object.assign({}, cur, extra)                                           // typed by hand: keep, add recovery
        : { date, total: n.total, rem: n.rem, deep: n.deep, light: n.light, ...extra, src: 'whoop' };
      if (!cur || JSON.stringify(cur) !== JSON.stringify(next)) { if (i >= 0) st.sleep[i] = next; else st.sleep.push(next); changed++; }
    });
    return changed;
  }
  async function syncWhoop(opts) {
    opts = opts || {};
    if (!url() || cs.syncing) return;
    if (!opts.force) {
      if (cs.status && !(cs.status.whoop && cs.status.whoop.connected)) return;
      const haveToday = S().sleep.some((x) => x.date === todayKey() && x.recovery != null);
      if (Date.now() - cs.lastSync < (haveToday ? 3 * 3600e3 : 10 * 60e3)) return;
    }
    cs.syncing = true;
    try {
      const days = opts.days || (Number(local.get('synced')) ? 3 : 30);
      const { nights } = await api('/whoop/sleep?days=' + days);
      cs.lastSync = Date.now(); local.set('synced', String(cs.lastSync));
      const n = mergeNights(nights || []);
      if (n) { O.save(); rerender(); }
      if (opts.toast) toast(n ? 'WHOOP: ' + n + (n === 1 ? ' night' : ' nights') + ' updated' : 'WHOOP: up to date');
    } catch (e) {
      if (e.status === 409 && cs.status && cs.status.whoop) cs.status.whoop.connected = false;
      if (opts.toast) toast(e.status === 409 ? 'WHOOP is not connected' : 'WHOOP sync failed: ' + e.message);
    }
    cs.syncing = false;
  }
  function connectWhoop() {
    if (!url()) return;
    // The WHOOP login opens in a browser sheet; when you come back the app checks the connection.
    const w = window.open(url() + '/whoop/login?key=' + encodeURIComponent(key()), '_blank');
    if (!w) location.href = url() + '/whoop/login?key=' + encodeURIComponent(key());
    cs.awaitingLogin = true;
  }
  async function disconnectWhoop() {
    if (!confirm('Disconnect WHOOP? Nights already synced stay in Overload.')) return;
    try { await api('/whoop/disconnect', { method: 'POST' }); toast('WHOOP disconnected'); } catch (e) { toast('Could not disconnect: ' + e.message); }
    refreshStatus(true);
  }

  // ---------------------------------------------------------------------------
  // Reminders (Web Push)
  // ---------------------------------------------------------------------------
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const iosNotInstalled = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches;
  function b64uToBytes(s) { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
  async function currentSub() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration(); if (!reg) return null;
    return reg.pushManager.getSubscription();
  }
  async function checkPush() { try { cs.pushOn = !!(await currentSub()) && Notification.permission === 'granted'; } catch (e) { cs.pushOn = false; } }
  async function enablePush() {
    if (!pushSupported()) { toast('This browser cannot show reminders'); return; }
    if (cs.enabling) return;             // a double tap would ask for two subscriptions
    cs.enabling = true;
    try { await enablePushOnce(false); } finally { cs.enabling = false; }
  }
  async function enablePushOnce(retry) {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications are blocked. Allow them for Overload in Settings'); return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      const { key: vapid } = await (await fetch(url() + '/push/key')).json();
      let sub = await reg.pushManager.getSubscription();
      if (sub) { const cur = sub.options && sub.options.applicationServerKey; if (cur && btoa(String.fromCharCode(...new Uint8Array(cur))) !== btoa(String.fromCharCode(...b64uToBytes(vapid)))) { await sub.unsubscribe(); sub = null; } }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(vapid) });
      await refreshStatus(true);
      if (cs.err === 'whoop-first') { toast('Connect WHOOP first: that pairs this phone with the connector'); O.render(); return; }
      try { await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), key: vapid } }); }
      catch (e) {
        if (e.status !== 409 || retry) throw e;
        await sub.unsubscribe();           // the connector's push key changed: subscribe again with the new one
        return enablePushOnce(true);
      }
      reminders(); O.save();
      await pushConfig(true);
      cs.pushOn = true; toast('Reminders on');
    } catch (e) { toast('Could not turn on reminders: ' + e.message); }
    O.render();
  }
  async function disablePush() {
    try {
      const sub = await currentSub();
      if (sub) { await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe(); }
    } catch (e) { /* ignore */ }
    cs.pushOn = false; toast('Reminders off on this phone'); O.render();
  }
  async function testPush() {
    try { const r = await api('/push/test', { method: 'POST' }); toast(r.sent ? 'Test sent' : 'No phone is subscribed'); } catch (e) { toast('Test failed: ' + e.message); }
  }

  // What the connector needs to decide which reminders are due: time zone, times, training days
  // and what is already done today. Sent when it changes.
  function configNow() {
    const st = S(), today = todayKey();
    const names = st.program.schedule.map((id) => { const d = id && st.program.days.find((x) => x.id === id); return d && d.exercises.length ? d.name : null; });
    const workoutDone = st.workouts.some((w) => w.finishedAt && w.date === today);
    const foodDone = !!(st.diary && st.diary[today] && st.diary[today].length);
    return { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, reminders: reminders(), training: names, done: { checkin: O.checkinDone && O.checkinDone() ? today : null, workout: workoutDone ? today : null, food: foodDone ? today : null } };
  }
  let pushTimer = null;
  async function pushConfig(now) {
    if (!url() || !S().settings.connKey) return;
    clearTimeout(pushTimer);             // a newer state replaces one still waiting to be sent
    const cfg = configNow(), sig = url() + JSON.stringify(cfg);
    if (!now && sig === local.get('cfg')) return;
    const send = async () => { try { await api('/config', { method: 'PUT', body: cfg }); local.set('cfg', sig); } catch (e) { /* try again on the next save */ } };
    if (now) return send();
    pushTimer = setTimeout(send, 1500);
  }

  // ---------------------------------------------------------------------------
  // Settings cards
  // ---------------------------------------------------------------------------
  function whoopCard() {
    if (!url()) {
      return '<div class="group-title">WHOOP</div><div class="card"><p class="small muted">Sleep, REM, deep and recovery from your WHOOP fill in on their own once the connector is set up (README → WHOOP and reminders).</p>'
        + '<div class="field mt8"><label>Connector address</label><input class="input" placeholder="https://overload-connector….workers.dev" data-field="conn-url"></div></div>';
    }
    const s = cs.status, w = s && s.whoop;
    let body;
    if (cs.err === 'whoop-first') body = '<p class="small muted mb8">Log in once and your sleep fills in every morning. This also pairs this phone with your connector (needed for reminders too).</p><button class="btn block" data-action="conn-whoop-connect">Connect WHOOP</button>';
    else if (cs.err === 'paired' && cs.pairedWhoop) body = '<p class="small">This connector is paired with another copy of Overload. Log in to WHOOP from here to pair this one.</p><button class="btn block mt8" data-action="conn-whoop-connect">Log in to WHOOP</button>';
    else if (cs.err === 'paired') body = '<p class="small">This connector is paired with another copy of Overload. To start over, delete the "owner" entry in the connector\'s KV storage (Cloudflare → Storage → KV → overload-connector).</p>';
    else if (cs.err) body = '<p class="small muted">' + esc(cs.err) + '</p><button class="btn ghost block mt8" data-action="conn-refresh">Try again</button>';
    else if (!s) body = '<p class="small muted">Checking…</p>';
    else if (w.connected) {
      const last = Number(local.get('synced'));
      body = '<div class="row between"><div><b>Connected</b>' + (w.name ? ' · ' + esc(w.name) : '') + '<div class="tiny muted">' + (last ? 'Last sync ' + new Date(last).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not synced yet') + '</div></div><span class="pill green">WHOOP</span></div>'
        + '<p class="tiny muted mt8">Time asleep, REM, deep and recovery fill in each morning. Nights you typed yourself keep your numbers.</p>'
        + '<div class="btn-row mt8"><button class="btn ghost" data-action="conn-whoop-sync">Sync now</button><button class="btn subtle" data-action="conn-whoop-disconnect">Disconnect</button></div>';
    } else if (!w.ready) body = '<p class="small muted">The connector is running, but the WHOOP keys are not set on it yet (WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET).</p>';
    else body = '<p class="small muted mb8">Log in once and your sleep fills in every morning.</p><button class="btn block" data-action="conn-whoop-connect">Connect WHOOP</button>';
    return '<div class="group-title">WHOOP</div><div class="card">' + body + '</div>';
  }
  function remindersCard() {
    let body;
    if (!url()) body = '<p class="small muted">Reminders need the connector (see WHOOP above).</p>';
    else if (iosNotInstalled()) body = '<p class="small">On iPhone, reminders work from the Home Screen app: Share → <b>Add to Home Screen</b>, then open Overload from that icon (iOS 16.4 or later).</p>';
    else if (!pushSupported()) body = '<p class="small muted">This browser cannot show reminders.</p>';
    else if (cs.pushOn === null) body = '<p class="small muted">Checking…</p>';
    else if (!cs.pushOn) body = '<p class="small muted mb8">A notification at the times you pick. Nothing is sent once you have done it.</p><button class="btn block" data-action="conn-push-on">Turn on reminders</button>';
    else {
      const r = reminders();
      body = Object.keys(LABELS).map((k) => '<div class="toggle-row" style="flex-direction:column;align-items:stretch;gap:8px"><div><div>' + LABELS[k][0] + '</div><div class="small muted">' + LABELS[k][1] + '</div></div><div class="row between" style="gap:8px">'
        + '<input class="input" type="time" style="max-width:150px" value="' + esc(r[k].time) + '" data-field="conn-time" data-k="' + k + '"' + (r[k].on ? '' : ' disabled') + '>'
        + '<div class="seg"><button class="' + (r[k].on ? 'on' : '') + '" data-action="conn-rem" data-k="' + k + '" data-v="1">On</button><button class="' + (!r[k].on ? 'on' : '') + '" data-action="conn-rem" data-k="' + k + '" data-v="0">Off</button></div></div></div>').join('')
        + '<div class="btn-row mt8"><button class="btn ghost" data-action="conn-push-test">Send a test</button><button class="btn subtle" data-action="conn-push-off">Turn off here</button></div>';
    }
    return '<div class="group-title">Reminders</div><div class="card">' + body + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Hooks for app.js
  // ---------------------------------------------------------------------------
  window.__overloadConn = {
    settingsCard() {
      if (url() && !cs.loading && Date.now() - cs.lastStatus > 60000) setTimeout(() => refreshStatus(), 0);
      if (cs.pushOn === null) checkPush().then(() => { if (O.screen === 'settings') O.render(); });
      return whoopCard() + remindersCard();
    },
    click(a, d) {
      switch (a) {
        case 'conn-whoop-connect': connectWhoop(); break;
        case 'conn-whoop-sync': syncWhoop({ force: true, toast: true, days: 7 }); break;
        case 'conn-whoop-disconnect': disconnectWhoop(); break;
        case 'conn-refresh': cs.err = ''; refreshStatus(true); break;
        case 'conn-push-on': enablePush(); break;
        case 'conn-push-off': disablePush(); break;
        case 'conn-push-test': testPush(); break;
        case 'conn-rem': reminders()[d.k].on = d.v === '1'; O.save(); O.render(); break;
      }
    },
    change(el, f) {
      if (f === 'conn-time' && /^\d{2}:\d{2}$/.test(el.value)) { reminders()[el.dataset.k].time = el.value; O.save(); }
      if (f === 'conn-url') {
        const u = el.value.trim().replace(/\/+$/, '');
        if (/^https:\/\/[^/]+$/.test(u)) { S().settings.connUrl = u; O.save(); cs.status = null; refreshStatus(true); O.render(); } else toast('Paste the https://… address from the deploy summary');
      }
    },
    // For tests
    _cs: cs, _syncWhoop: syncWhoop, _refresh: refreshStatus, _pushConfig: pushConfig
  };

  // Every save may change what is done today or the schedule: tell the connector (debounced, only on change).
  document.addEventListener('overload:save', () => { if (url() && S().settings.connKey) pushConfig(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !url()) return;
    if (cs.awaitingLogin) { cs.awaitingLogin = false; refreshStatus(true).then(() => syncWhoop({ force: true, toast: true })); return; }
    refreshStatus().then(() => syncWhoop());
  });
  discover().then(() => { if (!url()) return; refreshStatus(true).then(() => syncWhoop()); });
})();
