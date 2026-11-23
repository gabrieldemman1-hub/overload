#!/usr/bin/env node
/* Checks the fake Firebase itself, without any app: the behaviours README.md promises.
 *
 *   node tests/fake-firebase/selftest.js [--port=8412]
 *
 * A bare page imports the three SDK addresses (answered by the stand-ins) and the test drives them directly.
 * Nothing listens on the port: the page is answered by a route. One PASS or FAIL line per check.
 */
'use strict';

const lib = require('../lib');
const { createCloud } = require('./route');

const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) || '').slice(7)) || 8412;
const URL0 = lib.LOCAL + ':' + PORT + '/selftest.html';
const PAGE = '<!doctype html><meta charset="utf-8"><title>fake Firebase self-test</title><script type="module">'
  + 'import * as app from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";'
  + 'import * as auth from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";'
  + 'import * as store from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";'
  + 'window.fb = { app, auth, store }; window.seen = [];'
  // start(name): one Firebase app with auth and Firestore; resolves with the remembered user's uid (or null)
  + 'window.start = (name) => new Promise((resolve) => { const a = app.initializeApp({ projectId: "p" }, name); const k = name || "default";'
  + '  window[k] = { app: a, auth: auth.getAuth(a), db: store.initializeFirestore(a, { localCache: store.persistentLocalCache() }) };'
  + '  auth.onAuthStateChanged(window[k].auth, (u) => { window[k].user = u; resolve(u && u.uid); }); });'
  // watch(k, kind, path): a listener whose snapshots are written down in window.seen
  + 'window.watch = (k, kind, path) => store.onSnapshot(kind === "doc" ? store.doc(window[k].db, path) : store.collection(window[k].db, path),'
  + '  (s) => window.seen.push(kind === "doc" ? { path, exists: s.exists(), data: s.exists() ? s.data() : null, pending: s.metadata.hasPendingWrites, cache: s.metadata.fromCache }'
  + '    : { path, changes: s.docChanges().map((c) => c.type + " " + c.doc.id + (c.doc.metadata.hasPendingWrites ? " pending" : "")), cache: s.metadata.fromCache }),'
  + '  (e) => window.seen.push({ path, error: e.code }));'
  + 'window.put = (k, path, data) => { const b = store.writeBatch(window[k].db); b.set(store.doc(window[k].db, path), data); return b.commit().then(() => "ok", (e) => e.code); };'
  + 'window.ready = true;</script>';

let failed = 0, passed = 0;
function check(ok, label, detail) { if (ok) passed++; else failed++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  — ' + detail : '')); }

async function device(browser, cloud, name) {
  const phone = await lib.newPhone(browser, {});
  await phone.context.route(lib.LOCAL + ':' + PORT + '/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }));
  phone.device = await cloud.attach(phone.context, name);
  phone.open = async () => { if (phone.page) await phone.page.close(); phone.page = await lib.openApp(phone.context, URL0, { ready: () => !!window.ready }); return phone.page; };
  phone.ev = (fn, arg) => phone.page.evaluate(fn, arg);
  phone.seen = () => phone.page.evaluate(() => window.seen.splice(0));
  return phone;
}

(async () => {
  const browser = await lib.launch();
  const cloud = createCloud();
  const A = await device(browser, cloud, 'A'), B = await device(browser, cloud, 'B');
  try {
    // ---- accounts and sign-in, per Firebase app name ----
    await A.open();
    check((await A.ev(() => window.start())) === null && (await A.ev(() => window.start('fuel'))) === null, 'a new device is signed out, in the default app and in a named one');
    const uid = await A.ev(() => window.fb.auth.createUserWithEmailAndPassword(window.default.auth, 'a@example.com', 'secret1').then((r) => r.user.uid));
    check(uid === 'U1' && (await A.ev(() => window.default.user.uid)) === 'U1' && (await A.ev(() => window.fuel.user)) === null, 'creating an account signs in that Firebase app only (the app named fuel stays signed out)');
    const errs = await A.ev(async () => {
      const code = (p) => p.then(() => 'ok', (e) => e.code), a = window.fb.auth, f = window.fuel.auth;
      return [await code(a.createUserWithEmailAndPassword(f, 'a@example.com', 'secret1')), await code(a.signInWithEmailAndPassword(f, 'a@example.com', 'wrong')),
        await code(a.signInWithEmailAndPassword(f, 'nobody@example.com', 'secret1')), await code(a.createUserWithEmailAndPassword(f, 'c@example.com', '123')), await code(a.signInWithEmailAndPassword(f, 'not an address', 'x'))];
    });
    check(errs.join(' ') === 'auth/email-already-in-use auth/invalid-credential auth/invalid-credential auth/weak-password auth/invalid-email', 'sign-in errors carry the SDK\'s codes', errs.join(' '));
    await A.ev(() => window.fb.auth.signInWithEmailAndPassword(window.fuel.auth, 'a@example.com', 'secret1'));
    check(A.device.user('fuel').uid === 'U1' && A.device.apps.join() === '[DEFAULT],fuel', 'the same account in the named app: same uid; the device lists both app names');

    // ---- writes, the log, the rules ----
    let mark = cloud.mark();
    const r1 = await A.ev(() => window.put('fuel', 'users/U1/meta/fuel', { core: 'x', v: 1 }));
    await cloud.idle();
    let ws = cloud.writes({ from: mark });
    check(r1 === 'ok' && ws.length === 1 && ws[0].who === 'A' && ws[0].app === 'fuel' && ws[0].type === 'set' && ws[0].path === 'users/U1/meta/fuel' && ws[0].state === 'applied' && cloud.get('users/U1/meta/fuel').core === 'x',
      'a write is in the cloud and in the log with device, app name, type and path');
    check(cloud.text('users/U1/meta/fuel') === '{"core":"x","v":1}', 'the document is kept as the JSON text that was written');
    mark = cloud.mark();
    const r2 = await A.ev(() => window.put('fuel', 'users/U2/meta/fuel', { core: 'y' }));
    check(r2 === 'permission-denied' && !cloud.get('users/U2/meta/fuel') && cloud.writes({ from: mark })[0].state === 'rejected', 'the rule of firestore.rules: a write below another uid is refused and logged as rejected');
    const bad = await A.ev(() => { const s = window.fb.store, d = window.fuel.db, out = []; ['users/U1/days/', 'users/U1/days'].forEach((p) => { try { s.doc(d, p); out.push('ok'); } catch (e) { out.push(e.code); } }); try { s.doc(d, 'users', 'U1', 'days', ''); out.push('ok'); } catch (e) { out.push(e.code); } return out.join(' '); });
    check(bad === 'invalid-argument invalid-argument invalid-argument', 'a document path with an empty or missing segment throws, as in the SDK', bad);

    // ---- listeners ----
    await A.ev(() => { window.watch('fuel', 'doc', 'users/U1/meta/fuel'); window.watch('fuel', 'col', 'users/U1/days'); window.watch('fuel', 'doc', 'users/U9/meta/fuel'); });
    await cloud.idle();
    let seen = await A.seen();
    check(seen.some((s) => s.path === 'users/U1/meta/fuel' && s.exists && s.data.core === 'x') && seen.some((s) => s.path === 'users/U1/days' && s.changes.length === 0 && !s.cache) && seen.some((s) => s.path === 'users/U9/meta/fuel' && s.error === 'permission-denied'),
      'listeners: a document, an empty collection, and an error for a path the rules forbid', JSON.stringify(seen).slice(0, 200));
    await A.ev(() => window.put('fuel', 'users/U1/days/2026-01-01', { data: '[]' }));
    await cloud.idle();
    seen = await A.seen();
    check(seen.length === 1 && seen[0].changes.join() === 'added 2026-01-01 pending', 'the page\'s own write reaches its listener once, marked hasPendingWrites; the server\'s confirmation is not reported again', JSON.stringify(seen));

    // ---- a second device on the same cloud ----
    await B.open();
    await B.ev(() => window.start('fuel'));
    await B.ev(() => window.fb.auth.signInWithEmailAndPassword(window.fuel.auth, 'a@example.com', 'secret1'));
    await B.ev(() => { window.watch('fuel', 'col', 'users/U1/days'); });
    await cloud.idle();
    check(JSON.stringify(await B.seen()) === JSON.stringify([{ path: 'users/U1/days', changes: ['added 2026-01-01'], cache: false }]), 'a second device sees the first one\'s document');
    await B.ev(() => window.put('fuel', 'users/U1/days/2026-01-02', { data: '[1]' }));
    await cloud.idle();
    seen = await A.seen();
    check(seen.length === 1 && seen[0].changes.join() === 'added 2026-01-02' && !seen[0].cache, 'a write on one device reaches the other\'s listener, not marked pending');
    await B.seen();   // B's own view of that write (pending) is not what the next step looks at

    // ---- offline ----
    await B.device.setOffline(true);
    const offRead = await B.ev(() => window.fb.store.getDocFromServer(window.fb.store.doc(window.fuel.db, 'users/U1/meta/fuel')).then(() => 'ok', (e) => e.code));
    const offSign = await B.ev(() => window.fb.auth.signInWithEmailAndPassword(window.fuel.auth, 'a@example.com', 'secret1').then(() => 'ok', (e) => e.code));
    check(offRead === 'unavailable' && offSign === 'auth/network-request-failed', 'offline: a server read fails with unavailable, a sign-in with auth/network-request-failed');
    mark = cloud.mark();
    await B.ev(() => { window.done = 'waiting'; window.put('fuel', 'users/U1/days/2026-01-03', { data: '[2]' }).then((r) => { window.done = r; }); });
    await cloud.idle();
    seen = await B.seen();
    check((await B.ev(() => window.done)) === 'waiting' && cloud.writes({ from: mark })[0].state === 'queued' && !cloud.get('users/U1/days/2026-01-03') && seen.length === 1 && seen[0].changes.join() === 'added 2026-01-03 pending',
      'offline: a write is queued (commit() does not settle), logged as queued, and shown to the page\'s own listener', JSON.stringify(seen));
    await B.open();   // the app is closed and opened again, still offline
    check((await B.ev(() => window.start('fuel'))) === 'U1', 'the sign-in is remembered over a restart, also offline');
    await B.ev(() => { window.watch('fuel', 'col', 'users/U1/days'); window.watch('fuel', 'doc', 'users/U1/meta/none'); });
    await cloud.idle();
    seen = await B.seen();
    const col = seen.find((s) => s.path === 'users/U1/days'), none = seen.find((s) => s.path === 'users/U1/meta/none');
    check(!!col && col.cache && col.changes.join() === 'added 2026-01-01,added 2026-01-02,added 2026-01-03 pending', 'after the restart the listener gets the cached documents and the queued write (fromCache, the queued one pending)', JSON.stringify(col));
    check(!!none && none.exists === false && none.cache === true, 'a document that is not cached is reported as not existing, fromCache, while offline');
    check(B.device.queued('fuel').length === 1, 'the device still holds the queued write');
    await B.device.setOffline(false);
    await cloud.idle();
    check(cloud.get('users/U1/days/2026-01-03').data === '[2]' && cloud.writes({ from: mark })[0].state === 'applied' && B.device.queued('fuel').length === 0, 'online again: the queued write is sent');
    seen = await A.seen();
    check(seen.length === 1 && seen[0].changes.join() === 'added 2026-01-03', 'and the other device gets it');
    check((await B.seen()).length === 0, 'the device that wrote it hears nothing more about it (only metadata changed)');

    // ---- the offline store lost (iOS cleared it, or the SDK ran on its memory cache and the app was closed) ----
    await B.device.setOffline(true);
    mark = cloud.mark();
    await B.ev(() => { window.put('fuel', 'users/U1/days/2026-01-04', { data: '[3]' }); });
    await cloud.idle();
    await B.page.close(); B.page = null;
    B.device.loseOfflineStore();
    check(B.device.queued('fuel').length === 0 && cloud.writes({ from: mark }).length === 1 && cloud.writes({ from: mark })[0].state === 'lost', 'the offline store lost: the write queued offline is gone, logged as lost');
    await B.device.setOffline(false);
    await B.open();
    await B.ev(() => window.start('fuel'));
    await B.ev(() => { window.watch('fuel', 'col', 'users/U1/days'); });
    await cloud.idle();
    seen = await B.seen();
    check(!cloud.get('users/U1/days/2026-01-04') && seen.length === 1 && !seen[0].cache && seen[0].changes.join() === 'added 2026-01-01,added 2026-01-02,added 2026-01-03',
      'online again the lost write never arrives, and with nothing cached the first snapshot is the server\'s', JSON.stringify(seen));
    check((await A.seen()).length === 0, 'the other device hears nothing of it');

    // ---- a writer that is not a page, and a refused batch ----
    cloud.delete('users/U1/days/2026-01-01');
    await cloud.idle();
    check((await A.seen())[0].changes.join() === 'removed 2026-01-01' && (await B.seen())[0].changes.join() === 'removed 2026-01-01', 'a change made by the test itself reaches every device');
    A.device.rejectNext('resource-exhausted');
    const r3 = await A.ev(() => window.put('fuel', 'users/U1/days/2026-01-09', { data: '[]' }));
    await cloud.idle();
    seen = await A.seen();
    check(r3 === 'resource-exhausted' && !cloud.get('users/U1/days/2026-01-09') && seen.map((s) => s.changes.join()).join(' | ') === 'added 2026-01-09 pending | removed 2026-01-09', 'a refused batch: commit() fails with the code and the listener goes back to what the server holds', JSON.stringify(seen));
    const errors = A.pageErrors.concat(B.pageErrors);
    check(errors.length === 0, 'no page error', errors.join(' | ').slice(0, 300));
  } catch (e) {
    check(false, 'the run stopped', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | '));
  }
  await browser.close();
  console.log('# ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
