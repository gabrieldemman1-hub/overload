/* Overload connector — a Cloudflare Worker for one person.
 *
 * - WHOOP: holds the WHOOP app secret, does the OAuth login, refreshes tokens and returns
 *   last nights' sleep and recovery to the app.
 * - Reminders: stores the phone's Web Push subscription and, every 5 minutes (cron), sends
 *   the morning check-in, workout and food reminders that are due in the phone's time zone.
 *
 * The app proves who it is with a random key (Authorization: Bearer <key>). The first key to
 * claim the connector owns it; logging in to WHOOP again with the same WHOOP account re-pairs
 * a new key, so a lost key can be recovered.
 *
 * Storage (KV binding KV): owner, whoop (tokens), vapid (push keys), cfg (reminders), subs,
 * pending:<state> (OAuth logins in flight, 10 min).
 * Secrets: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET. Vars: APP_URL.
 */

const WHOOP_AUTH = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API = 'https://api.prod.whoop.com/developer/v2';
const SCOPES = 'read:sleep read:recovery read:cycles read:profile offline';
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
function page(title, body) {
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title>'
    + '<body style="font-family:-apple-system,system-ui,sans-serif;background:#111214;color:#eee;padding:32px 20px;line-height:1.5"><h2>' + title + '</h2>' + body + '</body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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
  if (!res.ok) throw new Error('WHOOP token ' + res.status + ': ' + (await res.text()).slice(0, 200));
  const t = await res.json();
  return { access: t.access_token, refresh: t.refresh_token, expires: Date.now() + (t.expires_in || 3600) * 1000 };
}
// Returns a valid access token, refreshing (and storing the rotated refresh token) when close to expiry.
async function whoopToken(env) {
  const w = await getJ(env, 'whoop');
  if (!w) return null;
  if (w.expires - Date.now() > 5 * 60 * 1000) return w.access;
  const t = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: w.refresh, scope: 'offline' });
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
  if (!res.ok) throw Object.assign(new Error('WHOOP ' + path + ' ' + res.status), { status: res.status === 401 ? 409 : 502 });
  return res.json();
}
const mins = (ms) => (ms == null ? null : Math.round(ms / 60000));
// Last `days` of main sleeps (naps left out), each with the recovery WHOOP scored from it.
async function whoopSleeps(env, days) {
  const start = new Date(Date.now() - (days + 1) * 86400000).toISOString();
  const token = await whoopToken(env);
  if (!token) throw Object.assign(new Error('WHOOP is not connected'), { status: 409 });
  const [sl, rc] = await Promise.all([
    whoopGet(env, '/activity/sleep', { start, limit: 25 }, token),
    whoopGet(env, '/recovery', { start, limit: 25 }, token)
  ]);
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
  const key = url.searchParams.get('key') || '';
  if (key.length < 16) return page('Missing key', '<p>Open this from Overload → Settings → WHOOP.</p>');
  if (!env.WHOOP_CLIENT_ID || !env.WHOOP_CLIENT_SECRET) return page('Not set up yet', '<p>The WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET secrets are missing on the connector.</p>');
  const state = randomHex(16);
  await putJ(env, 'pending:' + state, { keyHash: await sha256(key) }, { expirationTtl: 600 });
  const a = new URL(WHOOP_AUTH);
  a.searchParams.set('client_id', env.WHOOP_CLIENT_ID);
  a.searchParams.set('redirect_uri', url.origin + '/whoop/callback');
  a.searchParams.set('response_type', 'code');
  a.searchParams.set('scope', SCOPES);
  a.searchParams.set('state', state);
  return Response.redirect(a.toString(), 302);
}
async function whoopCallback(req, env, url) {
  const back = env.APP_URL ? '<p><a style="color:#ff5a4f" href="' + env.APP_URL + '">Back to Overload</a></p>' : '';
  if (url.searchParams.get('error')) return page('WHOOP not connected', '<p>' + (url.searchParams.get('error_description') || url.searchParams.get('error')).replace(/[<>&]/g, '') + '</p>' + back);
  const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
  const pending = state && await getJ(env, 'pending:' + state);
  if (!pending || !code) return page('Link expired', '<p>Start again from Overload → Settings → WHOOP.</p>' + back);
  await env.KV.delete('pending:' + state);
  const t = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: url.origin + '/whoop/callback' });
  const prof = await (await fetch(WHOOP_API + '/user/profile/basic', { headers: { Authorization: 'Bearer ' + t.access } })).json();
  const owner = (await getJ(env, 'owner')) || {};
  if (owner.whoopUser && owner.whoopUser !== prof.user_id) return page('Different WHOOP account', '<p>This connector already belongs to another WHOOP account.</p>');
  if (!owner.whoopUser && owner.keyHash && owner.keyHash !== pending.keyHash) return page('Different phone', '<p>This connector is paired with another copy of Overload.</p>');
  await putJ(env, 'owner', { keyHash: pending.keyHash, whoopUser: prof.user_id, name: prof.first_name || '' });
  await putJ(env, 'whoop', { ...t, since: new Date().toISOString() });
  return page('WHOOP connected ✓', '<p>Hi ' + String(prof.first_name || '').replace(/[<>&]/g, '') + '. Close this window and go back to Overload; your sleep fills in on its own.</p>' + back);
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
const DEFAULT_CFG = { tz: 'America/Los_Angeles', reminders: { checkin: { on: true, time: '07:30' }, workout: { on: true, time: '17:00' }, food: { on: false, time: '20:30' } }, training: [], done: {}, sent: {} };
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
  const cfg = (await getJ(env, 'cfg')) || DEFAULT_CFG;
  if (!((await getJ(env, 'subs')) || []).length) return [];
  const now = localNow(cfg.tz || DEFAULT_CFG.tz, when);
  const out = [];
  for (const kind of ['checkin', 'workout', 'food']) {
    const r = (cfg.reminders || {})[kind];
    if (!r || !r.on) continue;
    const [h, m] = String(r.time || '').split(':').map(Number);
    const at = h * 60 + m;
    if (!(now.min >= at && now.min - at < 180)) continue;          // due, and not hours late
    if ((cfg.sent || {})[kind] === now.date) continue;              // once a day
    if ((cfg.done || {})[kind] === now.date) continue;              // already done in the app
    if (kind === 'workout' && !(cfg.training || [])[now.wd]) continue; // rest day
    const msg = await reminderMessage(env, kind, cfg, now);
    await sendPush(env, msg);
    cfg.sent = { ...(cfg.sent || {}), [kind]: now.date };
    out.push(kind);
  }
  if (out.length) await putJ(env, 'cfg', cfg);
  return out;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function handle(req, env) {
  const url = new URL(req.url), p = url.pathname.replace(/\/+$/, '') || '/';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (p === '/') return json({ ok: true, app: 'overload-connector', whoopReady: !!(env.WHOOP_CLIENT_ID && env.WHOOP_CLIENT_SECRET) });
  if (p === '/whoop/login') return whoopLogin(req, env, url);
  if (p === '/whoop/callback') return whoopCallback(req, env, url).catch((e) => page('WHOOP not connected', '<p>' + String(e.message).replace(/[<>&]/g, '') + '</p><p>Try again from Overload → Settings → WHOOP.</p>'));
  if (p === '/push/key') return json({ key: (await vapidKeys(env)).publicKey });

  // Pair the app with the connector: the first key claims it.
  if (p === '/claim' && req.method === 'POST') {
    const key = ((await req.json().catch(() => ({}))).key || '');
    if (key.length < 16) return json({ error: 'bad key' }, 400);
    const owner = await getJ(env, 'owner'), h = await sha256(key);
    if (owner && owner.keyHash && owner.keyHash !== h) return json({ error: 'This connector is paired with another copy of Overload. Log in to WHOOP from this phone to re-pair.' }, 403);
    if (!owner) await putJ(env, 'owner', { keyHash: h });
    return json({ ok: true });
  }

  if (!(await authed(req, env))) return json({ error: 'unauthorized' }, 401);
  try {
    if (p === '/status') {
      const [owner, w, subs, cfg] = await Promise.all([getJ(env, 'owner'), getJ(env, 'whoop'), getJ(env, 'subs'), getJ(env, 'cfg')]);
      return json({ whoop: w ? { connected: true, name: owner.name || '', since: w.since } : { connected: false, ready: !!(env.WHOOP_CLIENT_ID && env.WHOOP_CLIENT_SECRET) }, subs: (subs || []).length, cfg: cfg || DEFAULT_CFG });
    }
    if (p === '/whoop/sleep') return json({ nights: await whoopSleeps(env, Math.min(30, Math.max(1, +url.searchParams.get('days') || 3))) });
    if (p === '/whoop/disconnect' && req.method === 'POST') {
      try { const t = await whoopToken(env); if (t) await fetch(WHOOP_API + '/user/access', { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } }); } catch (e) { /* revoke is best effort */ }
      await env.KV.delete('whoop');
      return json({ ok: true });
    }
    if (p === '/push/subscribe' && req.method === 'POST') {
      const sub = (await req.json()).subscription;
      if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return json({ error: 'bad subscription' }, 400);
      const subs = ((await getJ(env, 'subs')) || []).filter((s) => s.endpoint !== sub.endpoint);
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
      const b = await req.json(), old = (await getJ(env, 'cfg')) || DEFAULT_CFG;
      const cfg = { ...old, tz: b.tz || old.tz, reminders: b.reminders || old.reminders, training: Array.isArray(b.training) ? b.training.slice(0, 7) : old.training, done: b.done || old.done };
      try { localNow(cfg.tz); } catch (e) { cfg.tz = old.tz; }
      await putJ(env, 'cfg', cfg);
      return json({ ok: true });
    }
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }
  return json({ error: 'not found' }, 404);
}

export default {
  fetch: (req, env) => handle(req, env).catch((e) => json({ error: e.message }, 500)),
  scheduled: (event, env, ctx) => { ctx.waitUntil(runReminders(env, new Date(event.scheduledTime))); },
  _test: { runReminders, localNow } // used by the tests only
};
