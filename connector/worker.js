/* Overload connector — a Cloudflare Worker for one person.
 *
 * - WHOOP: holds the WHOOP app secret, does the OAuth login, refreshes tokens and returns
 *   last nights' sleep and recovery to the app.
 * - Reminders: stores the phone's Web Push subscription and, every 5 minutes (cron), sends
 *   the morning check-in, workout and food reminders that are due in the phone's time zone.
 *
 * The app proves who it is with a random key (Authorization: Bearer <key>). With WHOOP set up,
 * pairing goes through the WHOOP login: its last page shows a 6-digit code, and the app sends that
 * code with its key (POST /pair). Only the person looking at that page sees the code, so a link
 * from someone else cannot pair their key, and 5 wrong codes end that login. Logging in to WHOOP
 * again with the same WHOOP account pairs a new key, so a lost key can be recovered. Without
 * WHOOP set up, the first key to claim the connector owns it. The key never goes into an address.
 *
 * Storage (KV binding KV): owner, whoop (tokens), vapid (push keys), cfg (reminders), subs, sent,
 * pair (a finished WHOOP login waiting for its code, 10 min), pair:tries:<id> (codes tried for it).
 * KV refuses a second write to the same key within a second: a request writes each key at most once,
 * and the reminder job waits a second between its writes to `sent`.
 * Secrets: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET. Vars: APP_URL.
 */

const WHOOP_AUTH = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API = 'https://api.prod.whoop.com/developer/v2';
const SCOPES = 'read:sleep read:recovery read:profile offline';
const PAIR_TTL = 600, PAIR_TRIES = 5;   // a WHOOP login waits 10 minutes for its code; 5 wrong codes end it
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const enc = new TextEncoder();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...arrs) => { const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0; arrs.forEach((a) => { out.set(a, o); o += a.length; }); return out; };
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) { return b64u(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function getJ(env, k) { const v = await env.KV.get(k); return v ? JSON.parse(v) : null; }
const putJ = (env, k, v, opts) => env.KV.put(k, JSON.stringify(v), opts);
function page(title, body, headers) {
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title>'
    + '<body style="font-family:-apple-system,system-ui,sans-serif;background:#111214;color:#eee;padding:32px 20px;line-height:1.5"><h2>' + title + '</h2>' + body + '</body>', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}

async function authed(req, env) {
  const m = /^Bearer\s+(\S{16,})$/.exec(req.headers.get('Authorization') || '');
  if (!m) return false;
  const owner = await getJ(env, 'owner');
  return !!(owner && owner.keyHash === await sha256(m[1]));
}

// ---------------------------------------------------------------------------
// WHOOP
// ---------------------------------------------------------------------------
async function tokenRequest(env, params) {
  const res = await fetch(WHOOP_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: env.WHOOP_CLIENT_ID, client_secret: env.WHOOP_CLIENT_SECRET }) });
  if (!res.ok) throw Object.assign(new Error('WHOOP token ' + res.status + ': ' + (await res.text()).slice(0, 200)), { whoopStatus: res.status });
  const t = await res.json();
  return { access: t.access_token, refresh: t.refresh_token, expires: Date.now() + (t.expires_in || 3600) * 1000 };
}
// Returns a valid access token, refreshing (and storing the rotated refresh token) when close to expiry.
async function whoopToken(env) {
  const w = await getJ(env, 'whoop');
  if (!w) return null;
  if (w.expires - Date.now() > 5 * 60 * 1000) return w.access;
  let t;
  try { t = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: w.refresh, scope: 'offline' }); }
  catch (e) {
    // Another request may have renewed it a moment ago (WHOOP accepts each renewal token once).
    const now = await getJ(env, 'whoop');
    if (now && now.refresh !== w.refresh && now.expires - Date.now() > 60 * 1000) return now.access;
    // Only WHOOP refusing the renewal means the login is gone; anything else is an outage.
    if (e.whoopStatus === 400 || e.whoopStatus === 401) throw Object.assign(new Error('WHOOP login expired. Connect WHOOP again'), { status: 409, expired: true });
    throw Object.assign(new Error('WHOOP is not answering. Try again later'), { status: 502 });
  }
  await putJ(env, 'whoop', { ...w, ...t, refresh: t.refresh || w.refresh });
  return t.access;
}
// Pass the token when making several calls at once, so an expired token is refreshed only once
// (WHOOP rotates refresh tokens: a second refresh with the old one would fail).
async function whoopGet(env, path, params, token) {
  token = token || await whoopToken(env);
  if (!token) throw Object.assign(new Error('WHOOP is not connected'), { status: 409 });
  const url = new URL(WHOOP_API + path);
  Object.entries(params || {}).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw Object.assign(new Error('WHOOP ' + path + ' ' + res.status), { status: res.status === 401 ? 409 : 502, expired: res.status === 401 });
  return res.json();
}
const mins = (ms) => (ms == null ? null : Math.round(ms / 60000));
// Last `days` of main sleeps (naps left out), each with the recovery WHOOP scored from it.
async function whoopSleeps(env, days) {
  const start = new Date(Date.now() - (days + 1) * 86400000).toISOString();
  const token = await whoopToken(env);
  if (!token) throw Object.assign(new Error('WHOOP is not connected'), { status: 409 });
  // WHOOP pages at 25 records; a 30-day first sync (with naps) can need more than one page.
  const all = async (path) => {
    let records = [], next = null;
    for (let i = 0; i < 6; i++) {
      const r = await whoopGet(env, path, { start, limit: 25, nextToken: next }, token);
      records = records.concat(r.records || []);
      next = r.next_token; if (!next) break;
    }
    return { records };
  };
  const [sl, rc] = await Promise.all([all('/activity/sleep'), all('/recovery')]);
  const recBySleep = {};
  (rc.records || []).forEach((r) => { if (r.score_state === 'SCORED' && r.score) recBySleep[r.sleep_id] = r.score; });
  return (sl.records || []).filter((s) => !s.nap && s.score_state === 'SCORED' && s.score && s.score.stage_summary).map((s) => {
    const st = s.score.stage_summary, r = recBySleep[s.id];
    const light = st.total_light_sleep_time_milli, deep = st.total_slow_wave_sleep_time_milli, rem = st.total_rem_sleep_time_milli;
    return {
      id: s.id, start: s.start, end: s.end, tz: s.timezone_offset,
      total: mins(light + deep + rem), light: mins(light), deep: mins(deep), rem: mins(rem),
      awake: mins(st.total_awake_time_milli), inBed: mins(st.total_in_bed_time_milli),
      performance: s.score.sleep_performance_percentage == null ? null : Math.round(s.score.sleep_performance_percentage),
      recovery: r ? Math.round(r.recovery_score) : null, rhr: r ? Math.round(r.resting_heart_rate) : null, hrv: r ? Math.round(r.hrv_rmssd_milli) : null
    };
  }).sort((a, b) => (a.end < b.end ? 1 : -1));
}

async function whoopLogin(req, env, url) {
  if (!env.WHOOP_CLIENT_ID || !env.WHOOP_CLIENT_SECRET) return page('Not set up yet', '<p>The WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET secrets are missing on the connector.</p>');
  // Anyone can open this address, so it stores nothing and takes no key. The state (time + random)
  // lives only in this browser's cookie, and only this browser can finish the login.
  const state = Date.now().toString(36) + '.' + randomHex(16);
  const a = new URL(WHOOP_AUTH);
  a.searchParams.set('client_id', env.WHOOP_CLIENT_ID);
  a.searchParams.set('redirect_uri', url.origin + '/whoop/callback');
  a.searchParams.set('response_type', 'code');
  a.searchParams.set('scope', SCOPES);
  a.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: { Location: a.toString(), 'Set-Cookie': 'ows=' + state + '; HttpOnly; Secure; SameSite=Lax; Path=/whoop; Max-Age=' + PAIR_TTL, 'Cache-Control': 'no-store' } });
}
function cookie(req, name) {
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(req.headers.get('Cookie') || '');
  return m ? m[1] : '';
}
const stateAge = (s) => { const m = /^([0-9a-z]{6,12})\.[0-9a-f]{32}$/.exec(s); return m ? Date.now() - parseInt(m[1], 36) : Infinity; };
async function whoopCallback(req, env, url) {
  // No link back to the app on these pages: on iPhone they open in Safari's sheet, and a link would
  // open a different, empty copy of Overload there (Safari's storage).
  const back = '<p>Close this page and try again from Overload → Settings → WHOOP.</p>';
  const done = { 'Set-Cookie': 'ows=; HttpOnly; Secure; SameSite=Lax; Path=/whoop; Max-Age=0' };   // this login is used up
  if (url.searchParams.get('error')) return page('WHOOP not connected', '<p>' + (url.searchParams.get('error_description') || url.searchParams.get('error')).replace(/[<>&]/g, '') + '</p>' + back);
  const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
  const age = stateAge(state);
  if (!code || !(age > -60000 && age < PAIR_TTL * 1000)) return page('Link expired', '<p>This WHOOP login is too old.</p>' + back);
  if (cookie(req, 'ows') !== state) return page('Start from Overload', '<p>This WHOOP login was not started from this browser.</p>' + back);
  const t = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: url.origin + '/whoop/callback' });
  const res = await fetch(WHOOP_API + '/user/profile/basic', { headers: { Authorization: 'Bearer ' + t.access } });
  const prof = res.ok ? await res.json().catch(() => null) : null;
  // Without WHOOP saying whose account this is, nothing is paired.
  if (!prof || prof.user_id == null) return page('WHOOP did not answer', '<p>Nothing was paired. Wait a minute, then close this page and try again from Overload → Settings → WHOOP. If this keeps happening, check that your WHOOP app has the read:profile permission.</p>', done);
  const owner = (await getJ(env, 'owner')) || {};
  if (owner.whoopUser && owner.whoopUser !== prof.user_id) return page('Different WHOOP account', '<p>This connector already belongs to another WHOOP account. To start over, delete the "owner" entry in the connector\'s KV storage (Cloudflare dashboard → Storage → KV → overload-connector).</p>', done);
  // Pairing finishes in the app with this code (POST /pair): only whoever sees this page has it.
  const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  const name = String(prof.first_name || '').slice(0, 60);
  await putJ(env, 'pair', { id: randomHex(8), codeHash: await sha256('pair:' + pin), exp: Date.now() + PAIR_TTL * 1000, whoopUser: prof.user_id, name, whoop: { ...t, since: new Date().toISOString() } }, { expirationTtl: PAIR_TTL });
  return page('WHOOP connected ✓', '<p>Hi' + (name ? ' ' + name.replace(/[<>&]/g, '') : '') + '. To finish, close this page and type this code in Overload → Settings → WHOOP:</p>'
    + '<p id="code" style="font-size:40px;font-weight:700;letter-spacing:6px;margin:12px 0">' + pin.slice(0, 3) + ' ' + pin.slice(3) + '</p>'
    + '<p>It works for 10 minutes. Type it only in Overload; nobody else ever needs it.</p>', done);
}

// ---------------------------------------------------------------------------
// Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID), WebCrypto only
// ---------------------------------------------------------------------------
async function vapidKeys(env) {
  let v = await getJ(env, 'vapid');
  if (v) return v;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  v = { publicKey: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
  await putJ(env, 'vapid', v);
  return v;
}
async function vapidAuth(env, endpoint) {
  const v = await vapidKeys(env);
  const key = await crypto.subtle.importKey('jwk', v.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.APP_URL || 'mailto:overload@example.com' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + v.publicKey;
}
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}
async function encryptPayload(sub, text) {
  const uaPublic = unb64u(sub.keys.p256dh), authSecret = unb64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}
// Sends to every saved subscription; drops the ones the push service says are gone.
async function sendPush(env, msg) {
  const subs = (await getJ(env, 'subs')) || [];
  let sent = 0; const keep = [];
  for (const sub of subs) {
    try {
      const res = await fetch(sub.endpoint, { method: 'POST', body: await encryptPayload(sub, JSON.stringify(msg)),
        headers: { Authorization: await vapidAuth(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '14400', Urgency: 'normal' } });
      if (res.status === 404 || res.status === 410) continue;
      if (res.ok) sent++;
    } catch (e) { /* network blip: keep the subscription */ }
    keep.push(sub);
  }
  if (keep.length !== subs.length) await putJ(env, 'subs', keep);
  return sent;
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------
// cfg is written only by the app (PUT /config); `sent` has its own key, written only by the cron job,
// so the two never overwrite each other.
const DEFAULT_CFG = { tz: 'America/Los_Angeles', reminders: { checkin: { on: true, time: '07:30' }, workout: { on: true, time: '17:00' }, food: { on: false, time: '20:30' } }, training: [], done: {} };
const defaultCfg = () => JSON.parse(JSON.stringify(DEFAULT_CFG));
function localNow(tz, now) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(now || new Date()).forEach((x) => { p[x.type] = x.value; });
  return { date: p.year + '-' + p.month + '-' + p.day, min: +p.hour * 60 + +p.minute, wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) };
}
const hm = (m) => Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
function recoveryWord(r) { return r >= 67 ? 'green' : r >= 34 ? 'yellow' : 'red'; }
async function reminderMessage(env, kind, cfg, now) {
  const url = env.APP_URL || '/';
  let night = null;
  if (kind !== 'food' && await env.KV.get('whoop')) { try { night = (await whoopSleeps(env, 1))[0] || null; } catch (e) { night = null; } }
  // Only a night that ended today counts ("last night").
  if (night && localNow(cfg.tz, new Date(night.end)).date !== now.date) night = null;
  if (kind === 'checkin') {
    return { title: 'Morning check-in', tag: 'checkin', url,
      body: night ? 'Slept ' + hm(night.total) + (night.recovery != null ? ' · recovery ' + night.recovery + '%' : '') + '. Log your weight.' : 'Log your weight and last night\'s sleep.' };
  }
  if (kind === 'workout') {
    const name = (cfg.training || [])[now.wd] || 'Workout';
    const low = night && night.recovery != null && night.recovery < 34;
    return { title: name + ' today', tag: 'workout', url,
      body: low ? 'Recovery ' + night.recovery + '% (red). Train, but hold the weights and skip extra sets.' : 'Scheduled for today. Tap to start' + (night && night.recovery != null ? ' · recovery ' + night.recovery + '% (' + recoveryWord(night.recovery) + ')' : '') + '.' };
  }
  return { title: 'Log today\'s food', tag: 'food', url, body: 'Add what you ate so today\'s calories and protein are right.' };
}
async function runReminders(env, when) {
  const cfg = (await getJ(env, 'cfg')) || defaultCfg();
  if (!((await getJ(env, 'subs')) || []).length) return [];
  const now = localNow(cfg.tz || DEFAULT_CFG.tz, when);
  const sent = (await getJ(env, 'sent')) || {};
  const out = [];
  // KV refuses a second write to one key within a second: space the writes to `sent` in this run.
  let lastPut = 0;
  const putSent = async () => {
    const gap = 1100 - (Date.now() - lastPut);
    if (lastPut && gap > 0) await new Promise((r) => setTimeout(r, gap));
    try { await putJ(env, 'sent', sent); } finally { lastPut = Date.now(); }
  };
  for (const kind of ['checkin', 'workout', 'food']) {
    const r = (cfg.reminders || {})[kind];
    if (!r || !r.on) continue;
    const [h, m] = String(r.time || '').split(':').map(Number);
    const at = Math.floor((h * 60 + m) / 5) * 5;                    // cron runs every 5 min: 23:58 fires at 23:55
    if (!(now.min >= at && now.min - at < 180)) continue;          // due, and not hours late
    if (sent[kind] === now.date) continue;                          // once a day
    if ((cfg.done || {})[kind] === now.date) continue;              // already done in the app
    if (kind === 'workout' && !(cfg.training || [])[now.wd]) continue; // rest day
    const msg = await reminderMessage(env, kind, cfg, now);
    // Mark it sent before sending: if the mark cannot be saved, skip it (no reminder beats 36 repeats).
    const before = sent[kind];
    sent[kind] = now.date;
    try { await putSent(); } catch (e) { sent[kind] = before; continue; }
    if (!(await sendPush(env, msg))) {                               // not delivered: take the mark back, try again in 5 min
      sent[kind] = before;
      try { await putSent(); } catch (e) { /* the mark stays: no retry today, never a repeat */ }
      continue;
    }
    out.push(kind);
  }
  return out;
}

// Reminders go only to real push services (the worker posts every reminder to these addresses).
const PUSH_HOST = /^(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
function pushSubOk(sub) {
  try {
    const u = new URL(sub.endpoint);
    return typeof sub.endpoint === 'string' && sub.endpoint.length < 1024 && u.protocol === 'https:' && !u.port && !u.username && PUSH_HOST.test(u.hostname)
      && unb64u(sub.keys.p256dh).length === 65 && unb64u(sub.keys.auth).length === 16;
  } catch (e) { return false; }
}
// A new key owns the connector: the reminder destinations added under the old key go with it
// (the app sends its own again after pairing and on every start).
async function setOwner(env, old, owner) {
  if ((!old || old.keyHash !== owner.keyHash) && await env.KV.get('subs')) await env.KV.delete('subs');
  await putJ(env, 'owner', owner);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function handle(req, env) {
  const url = new URL(req.url), p = url.pathname.replace(/\/+$/, '') || '/';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (p === '/') return json({ ok: true, app: 'overload-connector', whoopReady: !!(env.WHOOP_CLIENT_ID && env.WHOOP_CLIENT_SECRET) });
  if (p === '/whoop/login') return whoopLogin(req, env, url);
  if (p === '/whoop/callback') return whoopCallback(req, env, url).catch((e) => page('WHOOP not connected', '<p>' + String(e.message).replace(/[<>&]/g, '') + '</p><p>Close this page and try again from Overload → Settings → WHOOP.</p>'));
  if (p === '/push/key') return json({ key: (await vapidKeys(env)).publicKey });

  // Pair the app with the connector: the first key claims it.
  if (p === '/claim' && req.method === 'POST') {
    const b = await req.json().catch(() => null), key = b && typeof b.key === 'string' ? b.key : '';
    if (key.length < 16) return json({ error: 'bad key' }, 400);
    const owner = await getJ(env, 'owner'), h = await sha256(key);
    if (owner && owner.keyHash === h) return json({ ok: true });
    if (owner && owner.whoopUser) return json({ error: 'paired', whoop: true, message: 'Paired with another copy of Overload. Connect WHOOP from this phone and type the code to pair it.' }, 403);
    if (owner) return json({ error: 'paired', whoop: false, message: 'Paired with another copy of Overload.' }, 403);
    // With WHOOP set up, the first pairing happens through the WHOOP login and its code instead.
    if (env.WHOOP_CLIENT_ID && env.WHOOP_CLIENT_SECRET) return json({ error: 'whoop-first', message: 'Connect WHOOP to pair this phone.' }, 403);
    await setOwner(env, owner, { keyHash: h });
    return json({ ok: true });
  }

  // Finish pairing after a WHOOP login: the app sends its key (header) and the code that page showed.
  if (p === '/pair' && req.method === 'POST') {
    const m = /^Bearer\s+(\S{16,200})$/.exec(req.headers.get('Authorization') || '');
    if (!m) return json({ error: 'bad key' }, 400);
    const b = await req.json().catch(() => null), code = String((b && b.code) || '').replace(/\D/g, '');
    const pend = await getJ(env, 'pair');
    const again = 'Tap Connect WHOOP and log in again.';
    const endLogin = async () => { try { await env.KV.delete('pair'); } catch (e) { /* it runs out in 10 minutes anyway */ } };
    if (!pend || !(pend.exp > Date.now())) return json({ error: 'no-login', message: 'That code has run out. ' + again }, 410);
    // Count the try before checking it, under its own key (this request then writes each key once).
    // Each try carries a random mark: when another guess was saved at the same moment, only the one
    // whose mark is stored goes on, so a burst of guesses cannot skip the count.
    const tk = 'pair:tries:' + pend.id, tries = ((await getJ(env, tk)) || {}).n || 0;
    if (tries >= PAIR_TRIES) { await endLogin(); return json({ error: 'bad-code', left: 0, message: 'Too many wrong codes. ' + again }, 403); }
    const mark = randomHex(8), busy = () => json({ error: 'busy', message: 'The connector is busy. Wait a moment and tap Pair again.' }, 429);
    try { await putJ(env, tk, { n: tries + 1, mark }, { expirationTtl: Math.max(60, Math.ceil((pend.exp - Date.now()) / 1000)) }); } catch (e) { return busy(); }
    if (((await getJ(env, tk)) || {}).mark !== mark) return busy();
    if (code.length !== 6 || await sha256('pair:' + code) !== pend.codeHash) {
      const left = PAIR_TRIES - tries - 1;
      if (!left) await endLogin();
      return json({ error: 'bad-code', left, message: left ? 'Wrong code. ' + left + (left === 1 ? ' try' : ' tries') + ' left.' : 'Too many wrong codes. ' + again }, 403);
    }
    const owner = await getJ(env, 'owner'), h = await sha256(m[1]);
    if (owner && owner.whoopUser && owner.whoopUser !== pend.whoopUser) return json({ error: 'paired', message: 'This connector belongs to another WHOOP account.' }, 403);
    // Paired for reminders before WHOOP was set up: only that same copy of the app may add WHOOP.
    if (owner && !owner.whoopUser && owner.keyHash !== h) return json({ error: 'paired', message: 'This connector is paired with another copy of Overload. To start over, delete the "owner" entry in the connector\'s KV storage (Cloudflare → Storage → KV → overload-connector).' }, 403);
    await setOwner(env, owner, { keyHash: h, whoopUser: pend.whoopUser, name: pend.name });
    await putJ(env, 'whoop', pend.whoop);
    await endLogin();      // already paired: if this fails, the code (which only he has) runs out on its own
    return json({ ok: true, name: pend.name });
  }

  if (!(await authed(req, env))) return json({ error: 'unauthorized' }, 401);
  try {
    if (p === '/status') {
      const [owner, w, subs, cfg] = await Promise.all([getJ(env, 'owner'), getJ(env, 'whoop'), getJ(env, 'subs'), getJ(env, 'cfg')]);
      return json({ whoop: w ? { connected: true, name: owner.name || '', since: w.since } : { connected: false, ready: !!(env.WHOOP_CLIENT_ID && env.WHOOP_CLIENT_SECRET) }, subs: (subs || []).length, cfg: cfg || defaultCfg() });
    }
    if (p === '/whoop/sleep') return json({ nights: await whoopSleeps(env, Math.min(30, Math.max(1, +url.searchParams.get('days') || 3))) });
    if (p === '/whoop/disconnect' && req.method === 'POST') {
      try { const t = await whoopToken(env); if (t) await fetch(WHOOP_API + '/user/access', { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } }); } catch (e) { /* revoke is best effort */ }
      await env.KV.delete('whoop');
      return json({ ok: true });
    }
    if (p === '/push/subscribe' && req.method === 'POST') {
      const body = await req.json().catch(() => null), sub = body && body.subscription;
      if (!pushSubOk(sub)) return json({ error: 'bad subscription', message: 'Reminders only go through the phone\'s own push service (Apple, Google, Mozilla or Microsoft).' }, 400);
      // A subscription made with a different push key would get 403 on every send.
      if (body.key && body.key !== (await vapidKeys(env)).publicKey) return json({ error: 'push key changed', key: (await vapidKeys(env)).publicKey }, 409);
      const stored = (await getJ(env, 'subs')) || [];
      // The app sends its subscription again on every start: nothing to write when it is already there.
      if (stored.some((s) => s.endpoint === sub.endpoint && s.keys && s.keys.p256dh === sub.keys.p256dh && s.keys.auth === sub.keys.auth)) return json({ ok: true, subs: stored.length });
      const subs = stored.filter((s) => s.endpoint !== sub.endpoint);
      subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
      await putJ(env, 'subs', subs.slice(-5));
      return json({ ok: true, subs: subs.length });
    }
    if (p === '/push/unsubscribe' && req.method === 'POST') {
      const ep = (await req.json()).endpoint;
      await putJ(env, 'subs', ((await getJ(env, 'subs')) || []).filter((s) => s.endpoint !== ep));
      return json({ ok: true });
    }
    if (p === '/push/test' && req.method === 'POST') {
      const sent = await sendPush(env, { title: 'Overload', body: 'Reminders are on ✓', tag: 'test', url: env.APP_URL || '/' });
      return json({ ok: sent > 0, sent });
    }
    if (p === '/config' && req.method === 'PUT') {
      const b = await req.json(), old = (await getJ(env, 'cfg')) || defaultCfg();
      const cfg = { tz: b.tz || old.tz, reminders: b.reminders || old.reminders, training: Array.isArray(b.training) ? b.training.slice(0, 7) : old.training, done: b.done || old.done };
      try { localNow(cfg.tz); } catch (e) { cfg.tz = old.tz; }
      await putJ(env, 'cfg', cfg);
      return json({ ok: true });
    }
  } catch (e) {
    return json({ error: e.message, ...(e.expired ? { expired: true } : {}) }, e.status || 500);
  }
  return json({ error: 'not found' }, 404);
}

export default {
  fetch: (req, env) => handle(req, env).catch((e) => json({ error: e.message }, 500)),
  scheduled: (event, env, ctx) => { ctx.waitUntil(runReminders(env, new Date(event.scheduledTime))); },
  _test: { runReminders, localNow } // used by the tests only
};
