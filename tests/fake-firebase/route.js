/* A fake Firebase for Playwright tests: one "cloud" in the test process, any number of phones.
 *
 *   const { createCloud } = require('./fake-firebase/route');
 *   const cloud = createCloud();                         // accounts and documents, kept here in Node
 *   const A = await cloud.attach(phoneA.context, 'A');   // this context now gets the stand-in SDK
 *   const B = await cloud.attach(phoneB.context, 'B');   // a second phone on the same cloud
 *   ... open the app in each, sign in through the app ...
 *   await cloud.idle();                                  // every write delivered, every other phone told
 *   cloud.writes({ who: 'A' })                           // [{ who, app, uid, type: 'set' | 'delete', path, json, state }]
 *   cloud.get('users/U1/meta/state')                     // the document, parsed (cloud.text: its JSON text)
 *
 * A context that is attached answers the three SDK addresses the apps import
 * (https://www.gstatic.com/firebasejs/<any version>/firebase-{app,auth,firestore}.js) with the stand-ins in
 * this folder, and gets one function, window.__fakeFirebase, through which those stand-ins reach this file.
 * Nothing here knows the name of an app, a collection or a document. README.md says what is modelled.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// The SDK files the stand-ins replace, at any version (and with any query).
const SDK = /^https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-(app|auth|firestore)\.js(\?.*)?$/;
const WRITE = { set: true, delete: true };
const READ = { get: true, list: true, listen: true };

const parentOf = (p) => p.slice(0, p.lastIndexOf('/'));

/**
 * options.rules  true (default): the rule of firestore.rules is enforced, i.e. a signed-in user may read and
 *                write only below users/{own uid}/, and nobody else anything. false: everything is allowed.
 */
function createCloud(options) {
  const opts = Object.assign({ rules: true }, options);
  const docs = new Map();       // document path -> JSON text
  const accounts = new Map();   // email in lower case -> { uid, email, password }
  const devices = new Map();    // name -> device
  const log = [];               // every read, write and sign-in, in order
  const busy = new Set();       // promises of work in flight (for idle())
  let rev = 0;                  // goes up with every write the server takes
  let batches = 0;
  let calls = 0;                // how many times a page has called in (for idle())

  const track = (promise) => { busy.add(promise); promise.then(() => busy.delete(promise), () => busy.delete(promise)); return promise; };
  const note = (entry) => { entry.n = log.length; log.push(entry); return entry; };
  const allowed = (uid, p) => { if (!opts.rules) return true; const s = p.split('/'); return !!uid && s[0] === 'users' && s[1] === uid && s.length >= 3; };

  // ---- accounts ----
  function addAccount(email, password) {
    const key = String(email).trim().toLowerCase();
    if (accounts.has(key)) return accounts.get(key).uid;
    const acc = { uid: 'U' + (accounts.size + 1), email: String(email).trim(), password: String(password) };
    accounts.set(key, acc);
    return acc.uid;
  }
  function signIn(device, p, create) {
    const email = String(p.email || '').trim(), key = email.toLowerCase();
    if (device.offline) return { error: 'auth/network-request-failed' };
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return { error: 'auth/invalid-email' };
    if (!p.password) return { error: 'auth/missing-password' };
    let acc = accounts.get(key);
    if (create) {
      if (acc) return { error: 'auth/email-already-in-use' };
      if (p.password.length < 6) return { error: 'auth/weak-password' };
      addAccount(email, p.password); acc = accounts.get(key);
    } else if (!acc || acc.password !== p.password) return { error: 'auth/invalid-credential' };
    const user = { uid: acc.uid, email: acc.email };
    device.users[p.app] = user;
    note({ who: device.name, app: p.app, uid: user.uid, type: create ? 'create-account' : 'sign-in', path: '' });
    return { user };
  }

  // ---- the server's documents ----
  // One batch, taken or refused as a whole. ops: [{ type, path, json }]. Returns { rev } or { error, rev }.
  function apply(device, app, uid, ops, entries) {
    let error = null;
    if (device && device.rejects.length) error = device.rejects.shift();
    else if (ops.some((o) => !allowed(uid, o.path))) error = 'permission-denied';
    if (error) { entries.forEach((e) => { e.state = 'rejected'; e.error = error; }); return { error, rev }; }
    ops.forEach((o) => { if (o.type === 'set') docs.set(o.path, o.json); else docs.delete(o.path); });
    rev++;
    entries.forEach((e) => { e.state = 'applied'; e.rev = rev; });
    if (device) { const cache = cacheOf(device, app); ops.forEach((o) => { if (o.type === 'set') cache.set(o.path, o.json); else cache.delete(o.path); }); }
    return { rev };
  }
  const cacheOf = (device, app) => device.caches[app] || (device.caches[app] = new Map());
  const queueOf = (device, app) => device.queues[app] || (device.queues[app] = []);
  const logWrites = (who, app, uid, ops, state) => { const batch = ++batches; return ops.map((o) => note({ who, app, uid, type: o.type, path: o.path, json: o.type === 'set' ? o.json : undefined, batch, state })); };

  // Tell the pages that something changed, so their listeners read again. Not the page that made the change.
  function tell(exceptPage, onlyDevice) {
    devices.forEach((d) => {
      if (d.offline || (onlyDevice && d !== onlyDevice)) return;
      d.context.pages().forEach((page) => {
        if (page === exceptPage || page.isClosed()) return;
        track(page.evaluate(() => (window.__fakeFirebaseRemote ? window.__fakeFirebaseRemote() : null)).catch(() => {}));
      });
    });
  }

  // ---- what the stand-ins in the page ask for ----
  function handle(device, source, op, p) {
    calls++;
    const app = p.app || '[DEFAULT]';
    const user = device.users[app] || null, uid = user && user.uid;
    if (device.apps.indexOf(app) < 0) device.apps.push(app);
    switch (op) {
      case 'auth.current': return user;
      case 'auth.signIn': return signIn(device, Object.assign({}, p, { app }), false);
      case 'auth.create': return signIn(device, Object.assign({}, p, { app }), true);
      case 'auth.signOut': device.users[app] = null; note({ who: device.name, app, uid, type: 'sign-out', path: '' }); return {};
      case 'auth.reset': if (device.offline) return { error: 'auth/network-request-failed' }; note({ who: device.name, app, uid: null, type: 'password-reset', path: '', email: p.email }); return {};

      // What the device has cached, with its queued (offline) writes laid over it. Also the moment a listener starts.
      case 'fs.cached': {
        note({ who: device.name, app, uid, type: 'listen', path: p.path });
        const cache = cacheOf(device, app), over = new Map();
        queueOf(device, app).forEach((b) => b.ops.forEach((o) => over.set(o.path, o.type === 'set' ? o.json : null)));
        if (p.kind === 'doc') {
          const pending = over.has(p.path), json = pending ? over.get(p.path) : (cache.has(p.path) ? cache.get(p.path) : null);
          return { rev, known: pending || cache.has(p.path), json, pending };
        }
        const rows = new Map();
        cache.forEach((json, dp) => { if (parentOf(dp) === p.path) rows.set(dp, { path: dp, json, pending: false }); });
        over.forEach((json, dp) => { if (parentOf(dp) !== p.path) return; if (json == null) rows.delete(dp); else rows.set(dp, { path: dp, json, pending: true }); });
        return { rev, docs: [...rows.values()] };
      }

      // A read from the server itself: one document or one whole collection.
      case 'fs.server': {
        const entry = note({ who: device.name, app, uid, type: p.kind === 'doc' ? 'get' : 'list', path: p.path, via: p.via, ok: false });
        if (device.offline) { entry.error = 'unavailable'; return { error: 'unavailable', rev }; }
        if (!allowed(uid, p.path)) { entry.error = 'permission-denied'; return { error: 'permission-denied', rev }; }
        entry.ok = true;
        const cache = cacheOf(device, app);
        if (p.kind === 'doc') {
          const json = docs.has(p.path) ? docs.get(p.path) : null;
          if (json == null) cache.delete(p.path); else cache.set(p.path, json);
          return { rev, json };
        }
        const found = [];
        docs.forEach((json, dp) => { if (parentOf(dp) === p.path) found.push({ path: dp, json }); });
        [...cache.keys()].forEach((dp) => { if (parentOf(dp) === p.path) cache.delete(dp); });
        found.forEach((d) => cache.set(d.path, d.json));
        return { rev, docs: found };
      }

      // A batch of writes. Offline it is queued on the device and sent when the device is online again.
      case 'fs.commit': {
        const ops = (p.ops || []).map((o) => ({ type: o.type, path: o.path, json: o.json }));
        if (device.offline) {
          const id = 'q' + (++batches);
          queueOf(device, app).push({ id, uid, ops, entries: logWrites(device.name, app, uid, ops, 'queued') });
          return { queued: id };
        }
        const r = apply(device, app, uid, ops, logWrites(device.name, app, uid, ops, 'sent'));
        if (!r.error) tell(source && source.page);
        return r;
      }
      default: throw new Error('fake Firebase: unknown call ' + op);
    }
  }

  // Send what a device queued while it was offline, in order, and tell its pages how each batch went.
  function flush(device) {
    const results = [];
    Object.keys(device.queues).forEach((app) => {
      device.queues[app].splice(0).forEach((b) => results.push(Object.assign({ id: b.id }, apply(device, app, b.uid, b.ops, b.entries))));
    });
    if (!results.length) return false;
    device.context.pages().forEach((page) => {
      if (!page.isClosed()) track(page.evaluate((list) => (window.__fakeFirebaseFlushed ? window.__fakeFirebaseFlushed(list) : null), results).catch(() => {}));
    });
    return true;
  }

  /**
   * Makes a browser context one device of this cloud. `name` is the name it gets in the log.
   * Returns the device:
   *   name, context
   *   offline                 true while setOffline(true)
   *   setOffline(flag)        no network for the pages (navigator.onLine, online / offline events) AND no
   *                           answer from the cloud: server reads fail with 'unavailable', writes are queued.
   *                           Back online the queue is sent first, then every listener reads again.
   *   blockSdk(flag)          the three SDK addresses are refused, as when the SDK was never stored for
   *                           offline use: the app's sync module then does not load at all
   *   sdkRequests             every SDK address this context asked for
   *   rejectNext(code, n)     the next n batches from this device are refused with `code` (default
   *                           'permission-denied', once), as rules or quota would
   *   clearCache(app)         forget what the SDK had cached on this device (for one Firebase app name, or all)
   *   loseOfflineStore(app)   the SDK's whole offline store is lost (iOS cleared it, or the SDK ran on its memory
   *                           cache and the app was closed): what was cached AND the writes queued offline are
   *                           gone; those writes are never sent (logged with state 'lost'). Close the pages first.
   *   user(app)               who is signed in for that Firebase app name (default '[DEFAULT]'), or null
   *   apps                    the Firebase app names this device has used
   *   queued(app)             writes waiting for the network: [{ type, path }]
   */
  async function attach(context, name) {
    if (!name || devices.has(name)) throw new Error('fake Firebase: a device needs a name of its own (got ' + name + ')');
    const device = { name, context, offline: false, sdkBlocked: false, sdkRequests: [], users: {}, caches: {}, queues: {}, rejects: [], apps: [] };
    devices.set(name, device);
    device.setOffline = async (flag) => {
      flag = !!flag;
      if (flag) { device.offline = true; await context.setOffline(true); return; }
      const was = device.offline;
      device.offline = false;
      const sent = was && flush(device);
      await context.setOffline(false);
      if (was) tell(null, sent ? null : device);   // its own listeners catch up; the others only if something was sent
    };
    device.blockSdk = (flag) => { device.sdkBlocked = !!flag; };
    device.rejectNext = (code, n) => { for (let i = 0; i < (n || 1); i++) device.rejects.push(code || 'permission-denied'); };
    device.clearCache = (app) => { if (app) delete device.caches[app]; else device.caches = {}; };
    device.loseOfflineStore = (app) => {
      (app ? [app] : Object.keys(device.queues)).forEach((a) => {
        (device.queues[a] || []).forEach((b) => b.entries.forEach((e) => { e.state = 'lost'; }));
        delete device.queues[a];
      });
      device.clearCache(app);
    };
    device.user = (app) => device.users[app || '[DEFAULT]'] || null;
    device.queued = (app) => queueOf(device, app || '[DEFAULT]').reduce((all, b) => all.concat(b.ops.map((o) => ({ type: o.type, path: o.path }))), []);
    await context.exposeBinding('__fakeFirebase', (source, op, payload) => track(Promise.resolve().then(() => handle(device, source, op, payload || {}))));
    await context.route(SDK, (route) => {
      const url = route.request().url();
      device.sdkRequests.push(url);
      if (device.sdkBlocked) return route.abort();
      return route.fulfill({
        status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
        body: fs.readFileSync(path.join(__dirname, 'firebase-' + SDK.exec(url)[1] + '.js'), 'utf8')
      });
    });
    return device;
  }

  // ---- for the test ----
  const pick = (kinds, f) => {
    f = f || {};
    return log.filter((e) => kinds[e.type] && (f.who == null || e.who === f.who) && (f.app == null || e.app === f.app) && (f.from == null || e.n >= f.from) && (f.path == null || f.path.test(e.path)));
  };
  // A writer that is not a page (another app, the Firebase console): changes the documents and tells every phone.
  function direct(type, p, data, who) {
    const op = { type, path: p, json: type === 'set' ? JSON.stringify(data) : undefined };
    if (type === 'set') docs.set(p, op.json); else docs.delete(p);
    rev++;
    logWrites(who || 'test', null, null, [op], 'applied').forEach((e) => { e.rev = rev; });
    tell(null);
  }
  // Resolves when nothing is in flight any more: every call from a page answered, every page told about every
  // change and done with its listeners, and no page has anything more to ask. (Timers inside the apps, such as
  // a push one second after a save, are the test's business: move the page's clock, then call idle() again.)
  async function idle() {
    let seen = -1;
    for (let quiet = 0; quiet < 2;) {
      await Promise.allSettled([...busy]);
      // One round trip to every page: what a page had begun to ask before it has arrived here when it returns.
      const pages = [];
      devices.forEach((d) => d.context.pages().forEach((page) => { if (!page.isClosed()) pages.push(page); }));
      await Promise.all(pages.map((page) => page.evaluate(() => 0).catch(() => {})));
      await new Promise((r) => setImmediate(r));
      if (!busy.size && calls === seen) quiet++; else { quiet = 0; seen = calls; }
    }
  }

  return {
    attach, addAccount, idle,
    docs, log, devices,
    /** The cloud's revision: goes up by one with every batch the server takes. */
    get rev() { return rev; },
    /** Position in the log, for writes({ from }) and reads({ from }). */
    mark: () => log.length,
    /** Every set and delete that was issued, also those still queued offline or refused (see .state).
     *  filter: { who, app, from, path: RegExp }. Each: { n, who, app, uid, type, path, json, batch, state, rev, error }. */
    writes: (filter) => pick(WRITE, filter),
    /** Every read: 'get' (one document from the server), 'list' (a collection from the server), each with
     *  via: 'get' (asked once) or 'listen' (a listener reading), and 'listen' (a listener was started on path). */
    reads: (filter) => pick(READ, filter),
    /** A document, parsed; undefined when it does not exist. */
    get: (p) => (docs.has(p) ? JSON.parse(docs.get(p)) : undefined),
    /** A document's JSON text exactly as it was written; undefined when it does not exist. */
    text: (p) => docs.get(p),
    /** The paths of every document below a prefix (a collection path, or '' for all), sorted. */
    paths: (prefix) => [...docs.keys()].filter((p) => !prefix || p === prefix || p.startsWith(prefix.replace(/\/?$/, '/'))).sort(),
    /** { path: JSON text } of every document below a prefix: compare two of these to prove nothing changed. */
    snapshot: (prefix) => { const out = {}; [...docs.keys()].filter((p) => !prefix || p.startsWith(prefix.replace(/\/?$/, '/'))).sort().forEach((p) => { out[p] = docs.get(p); }); return out; },
    set: (p, data, who) => direct('set', p, data, who),
    delete: (p, who) => direct('delete', p, undefined, who)
  };
}

module.exports = { createCloud, SDK };
