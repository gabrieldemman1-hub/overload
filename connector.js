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
  const cs = { status: null, loading: false, err: '', lastStatus: 0, lastSync: 0, syncing: false, pushOn: null, expired: false, code: '', pairMsg: '', lastTouch: 0, cardsHtml: '' };
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
    const data = (await res.json().catch(() => ({}))) || {};
    if (!res.ok) throw Object.assign(new Error(data.message || data.error || ('Connector ' + res.status)), { status: res.status, code: data.error, data });
    return data;
  }
  // An answer from the connector redraws only the two cards in Settings, never the whole screen, and
  // not while a box has the keyboard or a finger just touched the screen (that would close the
  // keyboard or swallow the tap): it waits and checks again. `now` is for taps on these cards.
  let cardTimer = null;
  const busy = () => { const a = document.activeElement; return !!(a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) || Date.now() - cs.lastTouch < 800; };
  function redrawCards(now) {
    clearTimeout(cardTimer);
    const box = O.screen === 'settings' && document.getElementById('conn-cards');
    if (!box) return;
    if (!now && busy()) { cardTimer = setTimeout(redrawCards, 1000); return; }
    const html = whoopCard() + remindersCard();
    if (html !== cs.cardsHtml) { cs.cardsHtml = html; box.innerHTML = html; }
  }
  // New WHOOP nights show on Today (not during a workout) and History; redraw them only when nothing
  // is being typed (otherwise the nights are saved already and appear at the next redraw).
  function nightsArrived() {
    if (O.screen === 'settings') return redrawCards();
    const typed = [...document.querySelectorAll('#bw-form input')].some((i) => i.value !== i.defaultValue);
    if (((O.screen === 'today' && !S().active) || O.screen === 'history') && !busy() && !typed) O.render();
  }

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
      const st = cs.status;   // keep only an answer of the expected shape
      if (!st || typeof st !== 'object' || !st.whoop || typeof st.whoop !== 'object' || typeof st.whoop.connected !== 'boolean') throw new Error('The connector sent an answer Overload does not understand');
      if (!st.cfg || typeof st.cfg !== 'object') st.cfg = null;
      cs.err = '';
    } catch (e) { cs.err = e.status === 403 ? (e.code === 'whoop-first' ? 'whoop-first' : 'paired') : (e.message || 'Could not reach the connector'); cs.pairedWhoop = !!(e.data && e.data.whoop); cs.status = null; }
    cs.loading = false; cs.lastStatus = Date.now();
    // The connector lost or never got this phone's latest settings: send them again.
    if (cs.status && cs.status.cfg && S().settings.connKey) {
      const mine = configNow(), theirs = cs.status.cfg;
      if (JSON.stringify([mine.tz, mine.reminders, mine.training]) !== JSON.stringify([theirs.tz, theirs.reminders, theirs.training])) pushConfig(true);
    }
    if (cs.status && !cs.subSent) resendSub();
    redrawCards();
  }

  // ---------------------------------------------------------------------------
  // WHOOP
  // ---------------------------------------------------------------------------
  function localDate(iso) { return todayKey(new Date(iso)); }
  // Only real numbers are kept from the connector: a night needs a valid end time and 30 min to 16 h
  // asleep; a stage longer than the night, or a value out of range, is dropped (null).
  const inRange = (v, lo, hi) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null);
  function cleanNight(n) {
    if (!n || typeof n !== 'object' || typeof n.end !== 'string' || isNaN(Date.parse(n.end))) return null;
    const total = inRange(n.total, 30, 960);
    if (total == null) return null;
    const part = (v) => { const x = inRange(v, 0, 960); return x != null && x <= total ? x : null; };
    return { end: n.end, total, rem: part(n.rem), deep: part(n.deep), light: part(n.light), recovery: inRange(n.recovery, 0, 100), rhr: inRange(n.rhr, 20, 250), hrv: inRange(n.hrv, 1, 500), performance: inRange(n.performance, 0, 100) };
  }
  // Merges WHOOP nights into state.sleep. Returns how many nights changed.
  function mergeNights(nights) {
    const st = S(); let changed = 0; const seen = new Set();
    (Array.isArray(nights) ? nights : []).map(cleanNight).forEach((n) => {   // newest first: the first night ending on a date is the one kept
      if (!n) return;
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
      const n = mergeNights(nights);
      cs.expired = false;
      if (n) { O.save(); nightsArrived(); } else redrawCards();
      if (opts.toast) toast(n ? 'WHOOP: ' + n + (n === 1 ? ' night' : ' nights') + ' updated' : 'WHOOP: up to date');
    } catch (e) {
      // 409: either the WHOOP login on the connector has expired (Connect WHOOP again) or there is none.
      const expired = e.status === 409 && !!(e.data && (e.data.expired || /expired/i.test(e.data.error || '')));
      if (expired) cs.expired = true;
      else if (e.status === 409 && cs.status && cs.status.whoop) cs.status.whoop = { connected: false, ready: true };
      if (opts.toast) toast(expired ? 'WHOOP login expired. Connect WHOOP again' : e.status === 409 ? 'WHOOP is not connected' : 'WHOOP sync failed: ' + e.message);
      redrawCards();
    }
    cs.syncing = false;
  }
  function connectWhoop() {
    if (!url()) return;
    // The WHOOP login opens in a browser sheet; its last page shows a code that is typed in here.
    // The key never goes into that address, so a link from someone else cannot pair their copy.
    local.set('pairing', String(Date.now())); cs.code = ''; cs.pairMsg = ''; cs.awaitingLogin = true;
    const w = window.open(url() + '/whoop/login', '_blank');
    if (!w) { location.href = url() + '/whoop/login'; return; }
    redrawCards(true);
  }
  const pairingOpen = () => Date.now() - Number(local.get('pairing') || 0) < 10 * 60e3;
  async function pairWhoop() {
    const box = document.getElementById('conn-code');
    const code = String(box ? box.value : cs.code).replace(/\D/g, '');
    if (code.length !== 6) { toast('Type the 6-digit code from the WHOOP page'); return; }
    if (cs.pairing) return;
    cs.pairing = true; cs.code = code;
    const idle = async () => { while (cs.loading) await new Promise((res) => setTimeout(res, 200)); };   // a status check started earlier would be out of date
    const w0 = cs.status && cs.status.whoop, since0 = w0 && w0.connected ? String(w0.since || '') : null;
    let name = null, retype = false;
    try { name = (await api('/pair', { method: 'POST', body: { code } })).name || ''; }
    catch (e) {
      if (e.status === 403 && e.code === 'bad-code' && e.data && e.data.left > 0) { cs.code = ''; retype = true; cs.pairMsg = e.message; }   // wrong code: empty box
      else if (e.status === 403 || e.status === 410) { local.set('pairing', ''); cs.code = ''; cs.pairMsg = e.message; }   // this login is over
      else {
        // No clear answer (no connection, or the connector stumbled, maybe after pairing): ask it.
        await idle(); await refreshStatus(true);
        const w = cs.status && cs.status.whoop;
        if (w && w.connected && String(w.since || '') !== since0) name = String(w.name || '');   // a new WHOOP login is stored for this phone
        else cs.pairMsg = e.status === 429 && e.data && e.data.message ? e.data.message : 'Could not reach the connector. Check your connection and tap Pair again.';
      }
    }
    cs.pairing = false;
    if (name !== null) {
      local.set('pairing', ''); cs.code = ''; cs.pairMsg = ''; cs.err = ''; cs.expired = false; cs.subSent = false;
      toast('WHOOP connected' + (name ? ' · ' + name : ''));
      await idle(); await refreshStatus(true);
      redrawCards(true);
      syncWhoop({ force: true });
      return;
    }
    toast(cs.pairMsg);
    redrawCards(true);
    const box2 = retype && document.getElementById('conn-code');
    if (box2) box2.focus();
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
  // Pairing a new key empties the connector's list of reminder destinations, so this phone sends its
  // own again on every start and after pairing (the connector writes nothing when it is already there).
  async function resendSub(again) {
    cs.subSent = true;
    try {
      const sub = await currentSub();
      if (!sub || Notification.permission !== 'granted') return;
      const k = sub.options && sub.options.applicationServerKey;
      const key = k ? btoa(String.fromCharCode(...new Uint8Array(k))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : undefined;
      await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), key } });
    } catch (e) {
      if (e.status === 409) { cs.pushOn = false; redrawCards(); return; }   // push key changed: offer Turn on reminders again
      // Right after pairing the connector may refuse a quick second change to its list: try again in
      // 2 seconds, then at the next status check.
      if (!again) { await new Promise((res) => setTimeout(res, 2000)); return resendSub(true); }
      cs.subSent = false;
    }
  }
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
      if (cs.err === 'whoop-first') { toast('Connect WHOOP first: that pairs this phone with the connector'); redrawCards(true); return; }
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
    redrawCards(true);
  }
  async function disablePush() {
    try {
      const sub = await currentSub();
      if (sub) { await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe(); }
    } catch (e) { /* ignore */ }
    cs.pushOn = false; toast('Reminders off on this phone'); redrawCards(true);
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
    if (pairingOpen()) {
      body = '<p class="small mb8">At the end of the WHOOP login, a page shows a 6-digit code. Type it here to finish.</p>'
        + '<div class="row"><input class="input" id="conn-code" data-field="conn-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123 456" aria-label="Code from the WHOOP page" value="' + esc(cs.code) + '" style="flex:1;min-width:0"><button class="btn" data-action="conn-pair">Pair</button></div>'
        + (cs.pairMsg ? '<p class="small mt8">' + esc(cs.pairMsg) + '</p>' : '')
        + '<button class="btn subtle block mt8" data-action="conn-pair-cancel">Cancel</button>';
    } else if (cs.err === 'whoop-first') body = '<p class="small muted mb8">Log in once and your sleep fills in every morning. The last WHOOP page shows a code; typing it here pairs this phone with your connector (needed for reminders too).</p><button class="btn block" data-action="conn-whoop-connect">Connect WHOOP</button>';
    else if (cs.err === 'paired' && cs.pairedWhoop) body = '<p class="small">This connector is paired with another copy of Overload. To use it from this phone, connect WHOOP here and type the code it shows. The other copy then stops syncing.</p><button class="btn block mt8" data-action="conn-whoop-connect">Connect WHOOP</button>';
    else if (cs.err === 'paired') body = '<p class="small">This connector is paired with another copy of Overload. To start over, delete the "owner" entry in the connector\'s KV storage (Cloudflare → Storage → KV → overload-connector).</p>';
    else if (cs.err) body = '<p class="small muted">' + esc(cs.err) + '</p><button class="btn ghost block mt8" data-action="conn-refresh">Try again</button>';
    else if (!s) body = '<p class="small muted">Checking…</p>';
    else if (w.connected && cs.expired) body = '<p class="small"><b>WHOOP login expired</b></p><p class="small muted mb8">Sleep stopped filling in. Log in to WHOOP again to fix it.</p><button class="btn block" data-action="conn-whoop-connect">Connect WHOOP</button>';
    else if (w.connected) {
      const last = Number(local.get('synced'));
      body = '<div class="row between"><div><b>Connected</b>' + (w.name ? ' · ' + esc(String(w.name)) : '') + '<div class="tiny muted">' + (last ? 'Last sync ' + new Date(last).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not synced yet') + '</div></div><span class="pill green">WHOOP</span></div>'
        + '<p class="tiny muted mt8">Time asleep, REM, deep and recovery fill in each morning. Nights you typed yourself keep your numbers.</p>'
        + '<div class="btn-row mt8"><button class="btn ghost" data-action="conn-whoop-sync">Sync now</button><button class="btn subtle" data-action="conn-whoop-disconnect">Disconnect</button></div>';
    } else if (w.ready === false) body = '<p class="small muted">The connector is running, but the WHOOP keys are not set on it yet (WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET).</p>';
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
      if (cs.pushOn === null) checkPush().then(() => redrawCards());
      cs.cardsHtml = whoopCard() + remindersCard();
      return '<div id="conn-cards">' + cs.cardsHtml + '</div>';
    },
    click(a, d) {
      switch (a) {
        case 'conn-whoop-connect': connectWhoop(); break;
        case 'conn-pair': pairWhoop(); break;
        case 'conn-pair-cancel': local.set('pairing', ''); cs.code = ''; cs.pairMsg = ''; cs.awaitingLogin = false; redrawCards(true); break;
        case 'conn-whoop-sync': syncWhoop({ force: true, toast: true, days: 7 }); break;
        case 'conn-whoop-disconnect': disconnectWhoop(); break;
        case 'conn-refresh': cs.err = ''; refreshStatus(true); break;
        case 'conn-push-on': enablePush(); break;
        case 'conn-push-off': disablePush(); break;
        case 'conn-push-test': testPush(); break;
        case 'conn-rem': reminders()[d.k].on = d.v === '1'; O.save(); redrawCards(true); break;
      }
    },
    change(el, f) {
      if (f === 'conn-time' && /^\d{2}:\d{2}$/.test(el.value)) { reminders()[el.dataset.k].time = el.value; O.save(); }
      if (f === 'conn-code') cs.code = el.value;
      if (f === 'conn-url') {
        const u = el.value.trim().replace(/\/+$/, '');
        if (/^https:\/\/[^/]+$/.test(u)) { S().settings.connUrl = u; O.save(); cs.status = null; refreshStatus(true); redrawCards(true); } else toast('Paste the https://… address from the deploy summary');
      }
    },
    // For tests
    _cs: cs, _syncWhoop: syncWhoop, _refresh: refreshStatus, _pushConfig: pushConfig
  };
  document.addEventListener('pointerdown', () => { cs.lastTouch = Date.now(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.id === 'conn-code') { e.preventDefault(); pairWhoop(); } });

  // Every save may change what is done today or the schedule: tell the connector (debounced, only on change).
  document.addEventListener('overload:save', () => { if (url() && S().settings.connKey) pushConfig(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !url()) return;
    if (cs.awaitingLogin) { cs.awaitingLogin = false; refreshStatus(true); return; }   // back from the WHOOP login: the code box is waiting
    refreshStatus().then(() => syncWhoop());
  });
  discover().then(() => { if (!url()) return; refreshStatus(true).then(() => syncWhoop()); });
})();
