/* Stand-in for https://www.gstatic.com/firebasejs/<version>/firebase-firestore.js. Tests only: see README.md.
 *
 * The documents live in the test process (route.js); this file is the part of the SDK that runs in the page.
 * It models what the apps' sync code depends on:
 *   - server reads (getDocFromServer, getDocsFromServer) that fail with 'unavailable' while offline;
 *   - listeners that first report what this device has cached (fromCache), then the server's differences,
 *     and never report a change of metadata alone;
 *   - writes that this page's listeners see at once, marked hasPendingWrites, before the server has them;
 *   - writes made offline that wait in a queue kept per device and are sent when it is online again, also
 *     when the page was reloaded in between.
 * Nothing here knows the names of apps, collections or documents.
 */
const bridge = (op, payload) => {
  if (typeof window.__fakeFirebase !== 'function') throw new Error('fake Firebase: this browser context is not attached to a fake cloud (tests/fake-firebase/route.js)');
  return window.__fakeFirebase(op, payload);
};
const fail = (code, text) => { const e = new Error('fake Firestore: ' + (text || code)); e.name = 'FirebaseError'; e.code = code; return e; };

const dbs = new Map();   // Firebase app name -> db, for this page

export function persistentLocalCache(settings) { return { kind: 'persistent', settings: settings || {} }; }
export function initializeFirestore(app, settings) {
  const name = (app && app.name) || '[DEFAULT]';
  if (!dbs.has(name)) {
    dbs.set(name, {
      type: 'firestore', app, name, settings: settings || {},
      listeners: new Set(),
      pending: new Map(),   // path -> { json | null, seq }: this page's writes the server has not confirmed yet
      waiting: new Map(),   // id of a batch queued offline -> the function that settles its commit()
      seq: 0,
      minRev: 0             // the cloud's revision at this page's last confirmed write: older answers are stale
    });
  }
  return dbs.get(name);
}
export function getFirestore(app) { return initializeFirestore(app); }

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------
// doc(db, 'users', uid, 'meta', 'state'), doc(db, 'users/' + uid + '/meta/state'), doc(collectionRef, id).
// Like the SDK, an empty segment or the wrong number of segments throws at once.
function ref(type, parent, segments) {
  let db, parts = [];
  if (parent && parent.type === 'firestore') db = parent;
  else if (parent && (parent.type === 'collection' || parent.type === 'document')) { db = parent.firestore; parts = parent.path.split('/'); }
  else throw fail('invalid-argument', 'the first argument must be a Firestore, a collection or a document');
  if (segments.some((s) => typeof s !== 'string')) throw fail('invalid-argument', 'path segments must be text');
  parts = parts.concat(segments.join('/').split('/'));
  if (!segments.length || parts.some((s) => !s)) throw fail('invalid-argument', 'empty path segment in "' + parts.join('/') + '"');
  if ((parts.length % 2 === 0) !== (type === 'document')) throw fail('invalid-argument', '"' + parts.join('/') + '" is not a ' + type + ' path (' + parts.length + ' segments)');
  return { type, firestore: db, path: parts.join('/'), id: parts[parts.length - 1] };
}
export function doc(parent, ...segments) { return ref('document', parent, segments); }
export function collection(parent, ...segments) { return ref('collection', parent, segments); }

const parentOf = (path) => path.slice(0, path.lastIndexOf('/'));
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------
function docSnap(db, path, json, pending, fromCache) {
  return {
    id: path.slice(path.lastIndexOf('/') + 1),
    ref: { type: 'document', firestore: db, path, id: path.slice(path.lastIndexOf('/') + 1) },
    exists: () => json != null,
    data: () => (json == null ? undefined : JSON.parse(json)),
    get: (field) => (json == null ? undefined : JSON.parse(json)[field]),
    metadata: { hasPendingWrites: !!pending, fromCache: !!fromCache }
  };
}
function querySnap(docs, changes, pending, fromCache) {
  return {
    docs, size: docs.length, empty: !docs.length,
    forEach: (f) => docs.forEach((d) => f(d)),
    docChanges: () => changes,
    metadata: { hasPendingWrites: !!pending, fromCache: !!fromCache }
  };
}

// ---------------------------------------------------------------------------
// Reads from the server
// ---------------------------------------------------------------------------
async function server(db, kind, path, via) {
  // An answer older than this page's last confirmed write would show the data from before that write: ask again.
  for (;;) {
    const r = await bridge('fs.server', { app: db.name, kind, path, via });
    if (r.error || r.rev >= db.minRev) return r;
  }
}
export async function getDocFromServer(docRef) {
  const db = docRef.firestore;
  const r = await server(db, 'doc', docRef.path, 'get');
  if (r.error) throw fail(r.error);
  return docSnap(db, docRef.path, r.json, false, false);
}
export async function getDocsFromServer(colRef) {
  const db = colRef.firestore;
  const r = await server(db, 'col', colRef.path, 'get');
  if (r.error) throw fail(r.error);
  return querySnap(r.docs.sort(byPath).map((d) => docSnap(db, d.path, d.json, false, false)), [], false, false);
}

// ---------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------
// The app's callback runs outside the stand-in's own promises: an error in it is the page's error, as with the SDK.
function hand(L, snap) { try { L.next(snap); } catch (e) { queueMicrotask(() => { throw e; }); } }

// One document. Reported when it is new to the listener or its content changed; never for metadata alone.
function deliverDoc(L, json, pending, fromCache) {
  const path = L.ref.path, had = L.view.has(path) ? L.view.get(path) : null;
  if (L.delivered && had === json) return;
  L.delivered = true;
  if (json == null) L.view.delete(path); else L.view.set(path, json);
  hand(L, docSnap(L.ref.firestore, path, json, pending, fromCache));
}
// A collection. rows: [{ path, json, pending }], everything in it now.
function deliverCol(L, rows, fromCache) {
  const db = L.ref.firestore, now = new Map(rows.map((r) => [r.path, r])), changes = [];
  now.forEach((r, path) => {
    const had = L.view.get(path);
    if (had === undefined) changes.push({ type: 'added', doc: docSnap(db, path, r.json, r.pending, fromCache) });
    else if (had !== r.json) changes.push({ type: 'modified', doc: docSnap(db, path, r.json, r.pending, fromCache) });
  });
  L.view.forEach((json, path) => { if (!now.has(path)) changes.push({ type: 'removed', doc: docSnap(db, path, json, false, fromCache) }); });
  if (L.delivered && !changes.length) return;
  L.delivered = true;
  L.view = new Map(rows.map((r) => [r.path, r.json]));
  const docs = rows.slice().sort(byPath).map((r) => docSnap(db, r.path, r.json, r.pending, fromCache));
  hand(L, querySnap(docs, changes, rows.some((r) => r.pending), fromCache));
}
// What the server (or the cache) holds, with this page's unconfirmed writes laid over it.
function overDoc(db, path, json, pending) {
  const p = db.pending.get(path);
  return p ? { json: p.json, pending: true } : { json, pending: !!pending };
}
function overCol(db, colPath, docs) {
  const rows = new Map(docs.map((d) => [d.path, { path: d.path, json: d.json, pending: !!d.pending }]));
  db.pending.forEach((p, path) => {
    if (parentOf(path) !== colPath) return;
    if (p.json == null) rows.delete(path); else rows.set(path, { path, json: p.json, pending: true });
  });
  return [...rows.values()];
}

function stop(L) { L.alive = false; L.ref.firestore.listeners.delete(L); }

// First what this device has cached, so a start without signal shows something.
async function startUp(L) {
  await null;
  if (!L.alive) return;
  const db = L.ref.firestore, isDoc = L.ref.type === 'document';
  const c = await bridge('fs.cached', { app: db.name, kind: isDoc ? 'doc' : 'col', path: L.ref.path });
  if (!L.alive || c.rev < db.minRev) return;   // older than this page's own last write: the server read that follows is enough
  if (isDoc) {
    const d = overDoc(db, L.ref.path, c.json, c.pending);
    if (c.known || d.pending) deliverDoc(L, d.json, d.pending, true);
  } else {
    const rows = overCol(db, L.ref.path, c.docs);
    if (rows.length) deliverCol(L, rows, true);
  }
}
// Then the server. Offline there is no answer: a listener with nothing cached still gets its first, empty,
// snapshot (fromCache), which is what the SDK does once it has given up waiting for the server.
async function read(L) {
  if (!L.alive) return;
  const db = L.ref.firestore, isDoc = L.ref.type === 'document';
  const r = await server(db, isDoc ? 'doc' : 'col', L.ref.path, 'listen');
  if (!L.alive) return;
  if (r.error === 'unavailable') {
    L.synced = false;
    if (L.delivered) return;
    if (isDoc) { const d = overDoc(db, L.ref.path, null, false); deliverDoc(L, d.json, d.pending, true); }
    else deliverCol(L, overCol(db, L.ref.path, []), true);
    return;
  }
  if (r.error) { stop(L); if (L.error) L.error(fail(r.error)); return; }   // rules: the listener is dead from here on
  L.synced = true;
  if (isDoc) { const d = overDoc(db, L.ref.path, r.json, false); deliverDoc(L, d.json, d.pending, false); }
  else deliverCol(L, overCol(db, L.ref.path, r.docs), false);
}
// One read after the other per listener, so an older answer can never land after a newer one.
function refresh(L) { L.chain = L.chain.then(() => read(L)).catch((e) => { queueMicrotask(() => { throw e; }); }); return L.chain; }
function refreshAll(db) { return Promise.all([...db.listeners].map(refresh)); }

// onSnapshot(ref, next, error?), onSnapshot(ref, options, next, error?), onSnapshot(ref, { next, error }).
// options.includeMetadataChanges is accepted and ignored: metadata-only changes are never reported.
export function onSnapshot(target, a, b, c) {
  let next, error;
  if (typeof a === 'function') { next = a; error = b; }
  else if (a && typeof a.next === 'function') { next = a.next.bind(a); error = a.error && a.error.bind(a); }
  else { next = b; error = c; }
  if (typeof next !== 'function') throw fail('invalid-argument', 'onSnapshot needs a function to call');
  const L = { ref: target, next, error, alive: true, view: new Map(), delivered: false, synced: false, chain: null };
  target.firestore.listeners.add(L);
  L.chain = startUp(L).catch((e) => { queueMicrotask(() => { throw e; }); });
  refresh(L);
  return () => stop(L);
}

// Called by route.js: something changed in the cloud, or this device is online again.
window.__fakeFirebaseRemote = () => Promise.all([...dbs.values()].map(refreshAll));
// Called by route.js when writes queued offline were sent: settles their commit() promises.
window.__fakeFirebaseFlushed = (results) => {
  results.forEach((r) => dbs.forEach((db) => { const settle = db.waiting.get(r.id); if (settle) { db.waiting.delete(r.id); settle(r); } }));
};

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
// Firestore refuses a field whose value is undefined. (Everything else goes through JSON here.)
function checkData(data, where) {
  if (data === undefined) throw fail('invalid-argument', 'undefined value at ' + where);
  if (data && typeof data === 'object') Object.keys(data).forEach((k) => checkData(data[k], where + '.' + k));
}
// This page's listeners see a write at once, marked hasPendingWrites, before the server has it.
function localChange(db, ops) {
  [...db.listeners].forEach((L) => {
    if (!L.alive) return;
    if (L.ref.type === 'document') {
      ops.forEach((o) => { if (o.path === L.ref.path) deliverDoc(L, o.type === 'set' ? o.json : null, true, !L.synced); });
      return;
    }
    const mine = ops.filter((o) => parentOf(o.path) === L.ref.path);
    if (!mine.length) return;
    const rows = new Map([...L.view].map(([path, json]) => [path, { path, json, pending: db.pending.has(path) }]));
    mine.forEach((o) => { if (o.type === 'set') rows.set(o.path, { path: o.path, json: o.json, pending: true }); else rows.delete(o.path); });
    deliverCol(L, [...rows.values()], !L.synced);
  });
}
async function send(db, ops) {
  if (!ops.length) return;
  if (ops.length > 500) throw fail('invalid-argument', 'a batch holds at most 500 writes');
  const seq = ++db.seq;
  ops.forEach((o) => db.pending.set(o.path, { json: o.type === 'set' ? o.json : null, seq }));
  await null;
  localChange(db, ops);
  let r = await bridge('fs.commit', { app: db.name, ops });
  // Offline: the batch waits in the device's queue. The promise settles when it was sent, like the SDK's
  // (which means: not while offline, and never for a page that was closed in between).
  if (r.queued) r = await new Promise((resolve) => db.waiting.set(r.queued, resolve));
  ops.forEach((o) => { const p = db.pending.get(o.path); if (p && p.seq === seq) db.pending.delete(o.path); });
  if (r.rev > db.minRev) db.minRev = r.rev;
  if (r.error) { refreshAll(db); throw fail(r.error); }   // refused as a whole: the listeners go back to what the server holds
}

export function writeBatch(db) {
  const ops = [];
  let sent = false;
  const add = (op) => { if (sent) throw fail('failed-precondition', 'this batch was already committed'); ops.push(op); return batch; };
  const batch = {
    set(docRef, data, options) {
      if (options) throw fail('unimplemented', 'set() with options (merge) is not modelled by the fake');
      if (!docRef || docRef.type !== 'document') throw fail('invalid-argument', 'set() needs a document reference');
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail('invalid-argument', 'a document must be an object');
      checkData(data, docRef.path);
      return add({ type: 'set', path: docRef.path, json: JSON.stringify(data) });
    },
    delete(docRef) {
      if (!docRef || docRef.type !== 'document') throw fail('invalid-argument', 'delete() needs a document reference');
      return add({ type: 'delete', path: docRef.path });
    },
    commit() { if (sent) return Promise.reject(fail('failed-precondition', 'this batch was already committed')); sent = true; return send(batch.firestore, ops); },
    firestore: db
  };
  return batch;
}
// One write each, for code that does not batch.
export function setDoc(docRef, data, options) { return writeBatch(docRef.firestore).set(docRef, data, options).commit(); }
export function deleteDoc(docRef) { return writeBatch(docRef.firestore).delete(docRef).commit(); }
